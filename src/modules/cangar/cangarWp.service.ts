import type { Request } from "express";
import { requestCangar } from "./cangarWp.client.js";

type JsonRecord = Record<string, unknown>;

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

function toNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const normalized = value.replace(/[^\d,-.]/g, "").replace(",", ".");
    const parsed = Number(normalized);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function firstNumber(record: unknown, keys: string[], paths: string[][] = []) {
  return toNumber(directValue(record, keys) ?? nestedValue(record, paths));
}

function firstNumberFrom(records: unknown[], keys: string[], paths: string[][] = []) {
  for (const record of records) {
    const value = firstNumber(record, keys, paths);
    if (value !== null) return value;
  }
  return null;
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
    const nested = extractArray(value, keys);
    if (nested.length > 0) return nested;
  }

  return [];
}

function parseJsonValue(value: unknown) {
  if (typeof value !== "string") return value;

  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function dataPayload(payload: unknown) {
  const data = directValue(payload, ["data"]);
  if (!isRecord(data)) return payload;

  const value = directValue(data, ["value"]);
  const parsedValue = parseJsonValue(value);
  if (isRecord(parsedValue)) return parsedValue;
  if (Array.isArray(parsedValue)) return { ...data, items: parsedValue };

  return data;
}

function firstAvailableNumber(...values: Array<number | null>) {
  return values.find((value): value is number => value !== null) ?? 0;
}

function sumItemNumbers(items: unknown[], keys: string[], paths: string[][] = []): number {
  return items.reduce<number>((total, item) => total + (firstNumber(item, keys, paths) ?? 0), 0);
}

function queryStringFromObject(query: Request["query"], defaults?: Record<string, string>) {
  const params = new URLSearchParams(defaults);

  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") continue;
    params.delete(key);

    if (Array.isArray(value)) {
      for (const item of value) {
        if (item !== undefined && item !== null && item !== "") params.append(key, String(item));
      }
      continue;
    }

    if (typeof value === "object") continue;
    params.set(key, String(value));
  }

  const queryString = params.toString();
  return queryString ? `?${queryString}` : "";
}

export async function getHealth() {
  const result = await requestCangar("/health", { skipAuth: true });
  return result.response;
}

export async function getContract() {
  const result = await requestCangar("/contract");
  return result.response;
}

export async function getSummary() {
  const result = await requestCangar("/data/summary");
  return result.response;
}

export async function getStok(query: Request["query"]) {
  const result = await requestCangar("/data/stok", { queryString: queryStringFromObject(query) });
  return result.response;
}

export async function getStokItems(query: Request["query"]) {
  const result = await requestCangar("/data/stok/items", {
    queryString: queryStringFromObject(query),
  });
  return result.response;
}

export async function getBooking(query: Request["query"]) {
  const result = await requestCangar("/data/booking", {
    queryString: queryStringFromObject(query),
  });
  return result.response;
}

export async function getBookingById(id: string) {
  const result = await requestCangar(`/data/booking/${encodeURIComponent(id)}`);
  return result.response;
}

export async function getKeuangan(query: Request["query"]) {
  const result = await requestCangar("/data/keuangan", {
    queryString: queryStringFromObject(query),
  });
  return result.response;
}

export async function getKeuanganRekap(query: Request["query"]) {
  const result = await requestCangar("/data/keuangan/rekap", {
    queryString: queryStringFromObject(query),
  });
  return result.response;
}

export async function getDashboardSummary(query: Request["query"]) {
  const summary = await getSummary();
  const stok = await getStok({ ...query, week: query.week ?? "2026-W20" });
  const booking = await getBooking(query);
  const keuangan = await getKeuanganRekap({ ...query, month: query.month ?? "2026-05" });

  return {
    summary,
    stok,
    booking,
    keuangan,
  };
}

export async function getExecutiveDashboardSummary(query: Request["query"]) {
  const [summaryResult, stokResult, bookingResult, keuanganResult] = await Promise.allSettled([
    getSummary(),
    getStok({ ...query, week: query.week ?? "2026-W20" }),
    getBooking(query),
    getKeuanganRekap({ ...query, month: query.month ?? "2026-05" }),
  ]);

  const summary = summaryResult.status === "fulfilled" ? summaryResult.value : null;
  const stok = stokResult.status === "fulfilled" ? stokResult.value : null;
  const booking = bookingResult.status === "fulfilled" ? bookingResult.value : null;
  const keuangan = keuanganResult.status === "fulfilled" ? keuanganResult.value : null;

  if (!summary && !stok && !booking && !keuangan) {
    throw summaryResult.status === "rejected"
      ? summaryResult.reason
      : new Error("Data dashboard Cangar belum tersedia.");
  }

  const summaryData = dataPayload(summary);
  const stokData = dataPayload(stok);
  const bookingData = dataPayload(booking);
  const summarySources = [summaryData, summary];
  const stokSources = [stokData, stok];
  const bookingSources = [bookingData, booking];
  const bookings = extractArray(booking, [
    "items",
    "bookings",
    "booking",
    "reservasi",
    "data",
    "rows",
    "records",
    "value",
  ]);
  const stokItems = extractArray(stok, [
    "items",
    "stok",
    "stock",
    "stocks",
    "data",
    "rows",
    "records",
    "value",
  ]);
  const activeBookingCount =
    (firstNumberFrom(summarySources, ["pending", "booking_pending"], [["booking", "pending"]]) ??
      0) +
    (firstNumberFrom(
      summarySources,
      ["confirmed_month", "booking_confirmed_month"],
      [["booking", "confirmed_month"]],
    ) ?? 0);
  const bookingCount = firstAvailableNumber(
    firstNumberFrom(
      summarySources,
      ["total_booking", "totalBooking", "booking_total"],
      [
        ["booking", "total"],
        ["booking", "confirmed_month"],
      ],
    ),
    firstNumberFrom(bookingSources, [
      "total_booking",
      "totalBooking",
      "booking_total",
      "total",
      "count",
    ]),
    bookings.length,
  );
  const guestCount = sumItemNumbers(bookings, [
    "jumlahTamu",
    "jumlah_tamu",
    "guest_count",
    "pax",
    "guests",
  ]);
  const stokOut = firstAvailableNumber(
    firstNumberFrom(
      summarySources,
      ["stok_keluar", "stokKeluar", "stock_out", "total_keluar"],
      [["stok", "keluar"]],
    ),
    firstNumberFrom(stokSources, ["stok_keluar", "stokKeluar", "stock_out", "total_keluar"]),
    sumItemNumbers(stokItems, [
      "totalKeluar",
      "total_keluar",
      "stok_keluar",
      "barang_keluar",
      "stock_out",
    ]),
  );

  return {
    totalVisitors: firstAvailableNumber(
      firstNumberFrom(summarySources, [
        "totalVisitors",
        "total_visitors",
        "total_pengunjung",
        "jumlah_pengunjung",
      ]),
      firstNumberFrom(bookingSources, [
        "totalVisitors",
        "total_visitors",
        "total_pengunjung",
        "jumlah_pengunjung",
      ]),
      guestCount > 0 ? guestCount : bookingCount,
    ),
    todayVisitors: firstAvailableNumber(
      firstNumberFrom(
        summarySources,
        ["todayVisitors", "today_visitors", "pengunjung_hari_ini", "booking_today"],
        [["booking", "today"]],
      ),
      firstNumberFrom(bookingSources, [
        "todayVisitors",
        "today_visitors",
        "pengunjung_hari_ini",
        "booking_today",
      ]),
    ),
    weekVisitors: firstAvailableNumber(
      firstNumberFrom(summarySources, [
        "weekVisitors",
        "week_visitors",
        "pengunjung_minggu_ini",
        "booking_week",
      ]),
      firstNumberFrom(bookingSources, [
        "weekVisitors",
        "week_visitors",
        "pengunjung_minggu_ini",
        "booking_week",
      ]),
    ),
    totalProduction: firstAvailableNumber(
      firstNumberFrom(summarySources, [
        "totalProduction",
        "total_production",
        "hasil_produksi",
        "production_total",
      ]),
      firstNumberFrom(stokSources, [
        "totalProduction",
        "total_production",
        "hasil_produksi",
        "production_total",
      ]),
      stokOut,
    ),
    activeOperations: firstAvailableNumber(
      firstNumberFrom(summarySources, ["activeOperations", "active_operations", "operasi_aktif"]),
      firstNumberFrom(stokSources, ["activeOperations", "active_operations", "operasi_aktif"]),
      activeBookingCount > 0 ? activeBookingCount : null,
      bookingCount,
      firstNumberFrom(
        summarySources,
        ["total_barang", "totalBarang", "total_items", "total_stok"],
        [["stok", "total"]],
      ),
      firstNumberFrom(stokSources, ["total_barang", "totalBarang", "total_items", "total_stok"]),
      stokItems.length,
    ),
    greenPerformance: firstAvailableNumber(
      firstNumberFrom(summarySources, [
        "greenPerformance",
        "green_performance",
        "sustainabilityScore",
        "sustainability_score",
      ]),
      firstNumberFrom(stokSources, [
        "greenPerformance",
        "green_performance",
        "sustainabilityScore",
        "sustainability_score",
      ]),
    ),
  };
}
