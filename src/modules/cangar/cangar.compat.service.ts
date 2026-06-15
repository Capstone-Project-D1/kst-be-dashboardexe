import type { Request } from "express";
import { getBooking, getKeuanganRekap, getStok, getStokItems, getSummary } from "./cangarWp.service.js";

type JsonRecord = Record<string, unknown>;

type LegacyStokRow = ReturnType<typeof mapStokRow>;
type LegacyBookingRow = ReturnType<typeof mapBookingRow>;

const MONTHS: Record<string, string> = {
  januari: "01",
  februari: "02",
  maret: "03",
  april: "04",
  mei: "05",
  juni: "06",
  juli: "07",
  agustus: "08",
  september: "09",
  oktober: "10",
  november: "11",
  desember: "12",
};

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function directValue(record: unknown, keys: string[]) {
  if (!isRecord(record)) return undefined;
  const lowerKeyMap = new Map(Object.keys(record).map((key) => [key.toLowerCase(), key]));

  for (const key of keys) {
    const exact = record[key];
    if (exact !== undefined && exact !== null) return exact;

    const actualKey = lowerKeyMap.get(key.toLowerCase());
    if (actualKey) {
      const value = record[actualKey];
      if (value !== undefined && value !== null) return value;
    }
  }

  return undefined;
}

function nestedValue(record: unknown, paths: string[][]) {
  for (const path of paths) {
    let current = record;
    for (const key of path) {
      current = directValue(current, [key]);
      if (current === undefined || current === null) break;
    }
    if (current !== undefined && current !== null) return current;
  }
  return undefined;
}

function toNumber(value: unknown, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const normalized = value.replace(/[^\d,-.]/g, "").replace(",", ".");
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

function toStringValue(value: unknown, fallback = "") {
  if (value === undefined || value === null || value === "") return fallback;
  return String(value);
}

function firstNumber(record: unknown, keys: string[], paths: string[][] = [], fallback = 0) {
  return toNumber(directValue(record, keys) ?? nestedValue(record, paths), fallback);
}

function firstString(record: unknown, keys: string[], fallback = "") {
  return toStringValue(directValue(record, keys), fallback);
}

function extractArray(payload: unknown, keys: string[]): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (!isRecord(payload)) return [];

  for (const key of keys) {
    const value = directValue(payload, [key]);
    if (Array.isArray(value)) return value;
  }

  for (const key of keys) {
    const value = directValue(payload, [key]);
    const nested: unknown[] = extractArray(value, keys);
    if (nested.length > 0) return nested;
  }

  return [];
}

function queryStringValue(value: Request["query"][string]) {
  if (Array.isArray(value)) return value[0] ? String(value[0]) : undefined;
  if (typeof value === "string") return value;
  return undefined;
}

function pad2(value: number) {
  return String(value).padStart(2, "0");
}

function currentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}`;
}

function currentIsoWeek() {
  const now = new Date();
  const date = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${pad2(week)}`;
}

function monthQuery(query: Request["query"]) {
  const year = queryStringValue(query.year) ?? "2026";
  const rawMonth = queryStringValue(query.month);
  if (!rawMonth || rawMonth === "Semua Bulan") return undefined;

  const lower = rawMonth.toLowerCase();
  const month = MONTHS[lower] ?? rawMonth.padStart(2, "0");
  return /^\d{2}$/.test(month) ? `${year}-${month}` : rawMonth;
}

function limitItems<T>(items: T[], query: Request["query"]) {
  const limit = toNumber(queryStringValue(query.limit), items.length);
  return limit > 0 ? items.slice(0, limit) : items;
}

function stokQuery(query: Request["query"]) {
  return {
    week: queryStringValue(query.week) ?? currentIsoWeek(),
  };
}

function bookingQuery(query: Request["query"]) {
  const month = monthQuery(query);
  const status = queryStringValue(query.status);
  return {
    ...(month ? { month } : {}),
    ...(status ? { status } : {}),
  };
}

function keuanganRekapQuery(query: Request["query"]) {
  return {
    month: monthQuery(query) ?? currentMonth(),
  };
}

function mapStokRow(item: unknown, index: number) {
  const stockAwal = firstNumber(item, ["stockAwal", "stok_awal", "stock_awal", "initial_stock", "stokAwal"]);
  const stockAkhir = firstNumber(item, ["stockAkhir", "stok_akhir", "stock_akhir", "ending_stock", "stokAkhir"]);
  const stockFisik = firstNumber(item, ["stockFisik", "stok_fisik", "physical_stock", "stokFisik"], [
    ["stok", "fisik"],
  ]);
  const totalMasuk = firstNumber(item, ["totalMasuk", "total_masuk", "stok_masuk", "barang_masuk", "stock_in"]);
  const totalKeluar = firstNumber(item, ["totalKeluar", "total_keluar", "stok_keluar", "barang_keluar", "stock_out"]);
  const selisih = firstNumber(item, ["selisih", "difference"], [], stockFisik - stockAkhir);

  return {
    id: firstString(item, ["id", "ID", "uuid", "kode"], String(index + 1)),
    name: firstString(item, ["name", "nama", "nama_barang", "barang", "item_name"], "-"),
    satuan: firstString(item, ["satuan", "unit", "uom"], "-"),
    stockAwal,
    retur: firstNumber(item, ["retur", "return", "returned"]),
    keteranganRetur: firstString(item, ["keteranganRetur", "keterangan_retur", "retur_note", "return_note"]),
    stockAkhir,
    stockFisik,
    selisih,
    keteranganSelisih: firstString(item, ["keteranganSelisih", "keterangan_selisih", "selisih_note", "difference_note"]),
    barangMasuk: directValue(item, ["barangMasuk", "barang_masuk"]) ?? [],
    barangKeluar: directValue(item, ["barangKeluar", "barang_keluar"]) ?? [],
    totalMasuk,
    totalKeluar,
    total: firstNumber(item, ["total", "jumlah"], [], stockAkhir || stockFisik || totalMasuk - totalKeluar),
  };
}

function normalizedStatus(value: unknown) {
  const status = toStringValue(value, "-");
  const lower = status.toLowerCase();
  if (["paid", "lunas", "confirmed", "validated"].includes(lower)) return "Lunas";
  if (["pending", "unpaid", "belum lunas", "dp"].includes(lower)) return "Belum Lunas";
  return status;
}

function mapBookingRow(item: unknown, index: number) {
  return {
    id: firstString(item, ["id", "ID", "booking_id", "kode"], String(index + 1)),
    no: firstNumber(item, ["no", "number"], [], index + 1),
    nama: firstString(item, ["nama", "name", "customer_name", "nama_pelanggan", "guest_name"], "-"),
    checkIn: firstString(item, ["checkIn", "check_in", "checkin", "start_date", "tanggal_mulai"]),
    checkOut: firstString(item, ["checkOut", "check_out", "checkout", "end_date", "tanggal_selesai"]),
    tipe: firstString(item, ["tipe", "type", "room_type", "jenis", "unit_type"], "-"),
    noUnit: firstString(item, ["noUnit", "no_unit", "unit", "unit_number", "room_number"], "-"),
    harga: directValue(item, ["harga", "price", "amount", "total", "total_harga"]) ?? 0,
    status: normalizedStatus(directValue(item, ["status", "payment_status", "booking_status"])),
    keterangan: firstString(item, ["keterangan", "note", "notes", "description", "payment_method"]),
  };
}

function mapCustomerRow(item: unknown, index: number) {
  const customer = directValue(item, ["customer", "pelanggan", "guest"]);
  return {
    id: firstString(item, ["id", "ID", "booking_id", "kode"], String(index + 1)),
    no: firstNumber(item, ["no", "number"], [], index + 1),
    nama: firstString(customer ?? item, ["nama", "name", "customer_name", "nama_pelanggan", "guest_name"], "-"),
    domisili: firstString(customer ?? item, ["domisili", "alamat", "address", "city", "origin"]),
    kontak: firstString(customer ?? item, ["kontak", "phone", "telephone", "whatsapp", "no_hp", "contact"]),
    jumlahTamu: firstNumber(item, ["jumlahTamu", "jumlah_tamu", "guest_count", "pax", "guests"]),
    harga: directValue(item, ["harga", "price", "amount", "total", "total_harga"]) ?? 0,
    status: normalizedStatus(directValue(item, ["status", "payment_status", "booking_status"])),
    keterangan: firstString(item, ["keterangan", "note", "notes", "description", "payment_method"]),
  };
}

function stokItemsFromPayload(payload: unknown) {
  return extractArray(payload, ["items", "stok", "stock", "stocks", "data", "rows", "records", "value"]);
}

function bookingItemsFromPayload(payload: unknown) {
  return extractArray(payload, ["items", "bookings", "booking", "reservasi", "data", "rows", "records", "value"]);
}

export async function getLegacyStokSummary(query: Request["query"]) {
  const [summary, stokPayload] = await Promise.all([
    getSummary().catch(() => null),
    getStok(stokQuery(query)).catch(() => null),
  ]);
  const stokItems = stokItemsFromPayload(stokPayload);
  const mappedStok: LegacyStokRow[] = stokItems.map(mapStokRow);

  const stokMasuk =
    firstNumber(summary, ["stok_masuk", "stokMasuk", "stock_in", "total_masuk"], [["stok", "masuk"]]) ||
    mappedStok.reduce((total: number, item: LegacyStokRow) => total + item.totalMasuk, 0);
  const stokKeluar =
    firstNumber(summary, ["stok_keluar", "stokKeluar", "stock_out", "total_keluar"], [["stok", "keluar"]]) ||
    mappedStok.reduce((total: number, item: LegacyStokRow) => total + item.totalKeluar, 0);
  const selisih =
    firstNumber(summary, ["selisih", "difference"], [["stok", "selisih"]]) ||
    mappedStok.reduce((total: number, item: LegacyStokRow) => total + item.selisih, 0);

  return {
    total_barang:
      firstNumber(summary, ["total_barang", "totalBarang", "total_items", "total_stok"], [["stok", "total"]]) ||
      mappedStok.length,
    stok_masuk: stokMasuk,
    stok_keluar: stokKeluar,
    selisih,
  };
}

export async function getLegacyStokOpname(query: Request["query"]) {
  const stok = await getStok(stokQuery(query)).catch(() => null);
  let items = stokItemsFromPayload(stok);

  if (items.length === 0) {
    const stokItems = await getStokItems(stokQuery(query)).catch(() => null);
    items = stokItemsFromPayload(stokItems);
  }

  return {
    items: limitItems(items.map(mapStokRow), query),
  };
}

export async function getLegacyBooklistSummary(query: Request["query"]) {
  const [summary, bookingPayload, keuanganPayload] = await Promise.all([
    getSummary().catch(() => null),
    getBooking(bookingQuery(query)).catch(() => null),
    getKeuanganRekap(keuanganRekapQuery(query)).catch(() => null),
  ]);
  const bookings: LegacyBookingRow[] = bookingItemsFromPayload(bookingPayload).map(mapBookingRow);
  const totalPendapatan =
    firstNumber(summary, ["total_pendapatan", "totalPendapatan", "revenue", "income"], [["booking", "pendapatan"]]) ||
    firstNumber(keuanganPayload, ["total_pendapatan", "totalPendapatan", "revenue", "income", "total_income"]) ||
    bookings.reduce((total: number, item: LegacyBookingRow) => total + toNumber(item.harga), 0);

  return {
    total_booking:
      firstNumber(summary, ["total_booking", "totalBooking", "booking_total"], [["booking", "total"]]) ||
      bookings.length,
    total_booking_trend: firstNumber(summary, ["total_booking_trend", "booking_trend", "totalBookingTrend"]),
    total_pendapatan: totalPendapatan,
    total_pendapatan_trend: firstNumber(summary, [
      "total_pendapatan_trend",
      "pendapatan_trend",
      "totalPendapatanTrend",
    ]),
    lunas:
      firstNumber(summary, ["lunas", "paid", "confirmed"], [["booking", "lunas"]]) ||
      bookings.filter((item: LegacyBookingRow) => item.status === "Lunas").length,
    belum_lunas:
      firstNumber(summary, ["belum_lunas", "belumLunas", "pending", "unpaid"], [["booking", "belum_lunas"]]) ||
      bookings.filter((item: LegacyBookingRow) => item.status === "Belum Lunas").length,
    trends: extractArray(summary, ["trends", "trend", "charts", "series"]),
  };
}

export async function getLegacyReservasi(query: Request["query"]) {
  const booking = await getBooking(bookingQuery(query)).catch(() => null);
  return {
    items: limitItems(bookingItemsFromPayload(booking).map(mapBookingRow), query),
  };
}

export async function getLegacyPelanggan(query: Request["query"]) {
  const booking = await getBooking(bookingQuery(query)).catch(() => null);
  const customers = extractArray(booking, ["pelanggan", "customers", "guests", "items", "booking", "bookings", "data"]);
  return {
    items: limitItems(customers.map(mapCustomerRow), query),
  };
}
