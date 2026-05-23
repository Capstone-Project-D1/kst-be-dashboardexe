import crypto from "node:crypto";
import { PrismaClient, Role, UserStatus, type KstIdentifier, type Prisma } from "@prisma/client";
import { hashPassword } from "../src/utils/password.js";

const prisma = new PrismaClient();

const users = [
  {
    username: "superadmin",
    email: "superadmin@kst-ub.ac.id",
    password: "SuperAdmin123!",
    name: "Super Admin DIKST",
    role: Role.super_admin,
    kstIdentifier: null,
  },
  {
    username: "manajemen",
    email: "manajemen@kst-ub.ac.id",
    password: "Manajemen123!",
    name: "Manajemen KST",
    role: Role.manajemen,
    kstIdentifier: null,
  },
  {
    username: "operator_ngijo",
    email: "operator.ngijo@kst-ub.ac.id",
    password: "Operator123!",
    name: "Operator KST Ngijo",
    role: Role.operator,
    kstIdentifier: "ngijo" as KstIdentifier,
  },
  {
    username: "operator_cangar",
    email: "operator.cangar@kst-ub.ac.id",
    password: "Operator123!",
    name: "Operator KST Cangar",
    role: Role.operator,
    kstIdentifier: "cangar" as KstIdentifier,
  },
  {
    username: "operator_jatikerto",
    email: "operator.jatikerto@kst-ub.ac.id",
    password: "Operator123!",
    name: "Operator KST Jatikerto",
    role: Role.operator,
    kstIdentifier: "jatikerto" as KstIdentifier,
  },
];

const common = { year: "2026", month: "Mei" };

const entries: Array<{
  kstIdentifier: KstIdentifier;
  path: string;
  name: string;
  description: string;
  dataType: Prisma.InputJsonValue;
  operations?: string[];
  params?: Prisma.InputJsonValue;
  data: Prisma.InputJsonValue;
}> = [
  {
    kstIdentifier: "ngijo",
    path: "/dashboard/summary",
    name: "Dashboard Summary",
    description: "Ringkasan lintas KST untuk halaman dashboard.",
    dataType: { typeName: "table" },
    operations: ["read"],
    data: {
      totalVisitors: 10,
      todayVisitors: 10,
      weekVisitors: 10,
      activeKst: 3,
      totalKst: 5,
      totalProduction: 1500,
      activeOperations: 1500,
      greenPerformance: 94,
    },
  },
  {
    kstIdentifier: "ngijo",
    path: "/dashboard/collaboration",
    name: "Dashboard Collaboration",
    description: "Grafik mitra dan kolaborasi enam bulan terakhir.",
    dataType: { typeName: "timeSeries" },
    operations: ["read"],
    data: {
      typeName: "timeSeries",
      value: [
        { month: "Januari", ngijo: 400, jatikerto: 600 },
        { month: "Februari", ngijo: 550, jatikerto: 350 },
        { month: "Maret", ngijo: 450, jatikerto: 550 },
        { month: "April", ngijo: 580, jatikerto: 420 },
        { month: "Mei", ngijo: 480, jatikerto: 400 },
        { month: "Juni", ngijo: 500, jatikerto: 600 },
      ],
    },
  },
  {
    kstIdentifier: "ngijo",
    path: "/dashboard/research-projects",
    name: "Dashboard Research Projects",
    description: "Grafik proyek riset aktif.",
    dataType: { typeName: "timeSeries" },
    operations: ["read"],
    data: {
      typeName: "timeSeries",
      value: [
        { month: "Jan", value: 1000 },
        { month: "Feb", value: 1400 },
        { month: "Mar", value: 1200 },
        { month: "Apr", value: 800 },
        { month: "May", value: 1100 },
        { month: "Jun", value: 1500 },
      ],
    },
  },
  {
    kstIdentifier: "ngijo",
    path: "/tracker-inovasi/summary",
    name: "Summary Tracker Inovasi",
    description: "Kartu ringkasan tracker inovasi.",
    dataType: { typeName: "table" },
    operations: ["read"],
    data: {
      total_aktif: 42,
      total_aktif_trend: 12.5,
      rata_rata_trl: 5.4,
      rata_rata_trl_trend: -20,
      paten_tertunda: 8,
      paten_tertunda_trend: 12.5,
      kolaborasi: 156,
      kolaborasi_trend: 12.5,
    },
  },
  {
    kstIdentifier: "ngijo",
    path: "/tracker-inovasi",
    name: "Tracker Inovasi",
    description: "Proyek riset dan inovasi KST Ngijo.",
    dataType: { typeName: "table" },
    data: {
      typeName: "table",
      items: [
        { id: "ngijo-ti-1", ...common, namaProyek: "Biomass Circular Recovery", idProyek: "KST-2024-001", kepalaRiset: "Dr. Aris Sudarsono", domain: "Waste Management", trlLevel: 7, trlLabel: "Demonstration Stage" },
        { id: "ngijo-ti-2", ...common, month: "April", namaProyek: "Solar-Powered Water Purification", idProyek: "KST-2024-002", kepalaRiset: "Eng. Maya Santoso", domain: "Clean Water Technology", trlLevel: 5, trlLabel: "Prototype Development" },
        { id: "ngijo-ti-3", ...common, namaProyek: "AI-Driven Crop Monitoring", idProyek: "KST-2024-003", kepalaRiset: "Dr. Raden Wijaya", domain: "Agricultural Tech", trlLevel: 6, trlLabel: "Pilot Testing" },
      ],
    },
  },
  {
    kstIdentifier: "ngijo",
    path: "/keberlanjutan/green-performance",
    name: "Green Performance",
    description: "Skor kinerja hijau.",
    dataType: { typeName: "number", unit: "score" },
    operations: ["read"],
    data: { value: 94, label: "Excellent", trend: 12 },
  },
  {
    kstIdentifier: "ngijo",
    path: "/keberlanjutan/water-lifecycle",
    name: "Water Lifecycle",
    description: "Siklus hidup air.",
    dataType: { typeName: "table" },
    operations: ["read"],
    data: { items: [{ name: "Daur Ulang", value: 14200, fill: "#27A376" }, { name: "Sumber Segar", value: 6700, fill: "#3B82F6" }] },
  },
  {
    kstIdentifier: "ngijo",
    path: "/keberlanjutan/waste-metrics",
    name: "Waste Metrics",
    description: "Metrik limbah mingguan.",
    dataType: { typeName: "timeSeries" },
    operations: ["read"],
    data: { typeName: "timeSeries", value: [{ day: "Senin", mendatang: 8, diproses: 5 }, { day: "Selasa", mendatang: 10, diproses: 7 }, { day: "Rabu", mendatang: 6, diproses: 4 }] },
  },
  {
    kstIdentifier: "ngijo",
    path: "/keberlanjutan/energy-dynamics",
    name: "Energy Dynamics",
    description: "Dinamika energi.",
    dataType: { typeName: "timeSeries" },
    operations: ["read"],
    data: { typeName: "timeSeries", value: [{ month: "Jan", daya: 400, konsumsi: 300 }, { month: "Feb", daya: 500, konsumsi: 350 }, { month: "Mar", daya: 550, konsumsi: 420 }] },
  },
  {
    kstIdentifier: "ngijo",
    path: "/keberlanjutan/renewable-energy",
    name: "Renewable Energy",
    description: "Total energi terbarukan per sumber.",
    dataType: { typeName: "table" },
    operations: ["read"],
    data: { total: 1284.5, unit: "MWh", items: [{ label: "Solar Array", value: 742 }, { label: "Wind Turbines", value: 310 }, { label: "Biomass", value: 232 }] },
  },
  {
    kstIdentifier: "ngijo",
    path: "/keberlanjutan/sensors",
    name: "Sensors",
    description: "Real-time sensor feed.",
    dataType: { typeName: "table" },
    data: { typeName: "table", items: [
      { id: "sensor-1", ...common, lokasi: "North Solar Grid A-12", tipe: "Photovoltaic Output", baca: "428.4 kW", status: "Optimal", tren: "up" },
      { id: "sensor-2", ...common, lokasi: "Western Water Rec. Station", tipe: "Flow Rate Monitor", baca: "12.5 L/sec", status: "Optimal", tren: "up" },
      { id: "sensor-3", ...common, lokasi: "East Wind Corridor T-7", tipe: "Turbine RPM Sensor", baca: "1,842 RPM", status: "Warning", tren: "down" },
    ] },
  },
  {
    kstIdentifier: "cangar",
    path: "/stok-opname/summary",
    name: "Summary Stok Opname",
    description: "Ringkasan stok opname.",
    dataType: { typeName: "table" },
    operations: ["read"],
    data: { total_barang: 10, stok_masuk: 4500, stok_keluar: 2450, selisih: -25 },
  },
  {
    kstIdentifier: "cangar",
    path: "/stok-opname",
    name: "Stok Opname",
    description: "Inventori barang Cangar.",
    dataType: { typeName: "table" },
    data: { typeName: "table", items: [
      { id: "stok-1", ...common, name: "Kentang Granola", satuan: "Kg", stockAwal: 500, retur: 10, keteranganRetur: "Kualitas tidak sesuai", stockAkhir: 650, stockFisik: 635, selisih: -5, keteranganSelisih: "Selisih perhitungan", barangMasuk: [50,60,70,50,60,30,30], barangKeluar: [50,60,70,50,60,30,30], totalMasuk: 500, totalKeluar: 200, total: 500 },
      { id: "stok-2", ...common, name: "Stroberi", satuan: "Kg", stockAwal: 600, retur: 12, keteranganRetur: "Sebagian busuk", stockAkhir: 720, stockFisik: 710, selisih: -10, keteranganSelisih: "Selisih timbang", barangMasuk: [60,70,80,55,65,35,40], barangKeluar: [40,50,60,45,55,30,35], totalMasuk: 600, totalKeluar: 315, total: 600 },
    ] },
  },
  {
    kstIdentifier: "cangar",
    path: "/booklist-atp/summary",
    name: "Summary Booklist ATP",
    description: "Ringkasan reservasi ATP.",
    dataType: { typeName: "table" },
    operations: ["read"],
    data: { total_booking: 10, total_booking_trend: 12.5, total_pendapatan: 1800000, total_pendapatan_trend: -20, lunas: 6, belum_lunas: 4 },
  },
  {
    kstIdentifier: "cangar",
    path: "/booklist-atp/reservasi",
    name: "Reservasi Booklist ATP",
    description: "Data reservasi wisata Cangar.",
    dataType: { typeName: "table" },
    data: { typeName: "table", items: [
      { id: "res-1", ...common, nama: "Ahmad Rizki", checkIn: "2026-05-01", checkOut: "2026-05-03", tipe: "Glamping Deluxe", noUnit: "Deluxe 3", harga: "Rp 1.500.000", status: "Lunas", keterangan: "Transfer Bank" },
      { id: "res-2", ...common, nama: "Siti Nurhaliza", checkIn: "2026-05-02", checkOut: "2026-05-06", tipe: "Villa Family", noUnit: "Villa 5", harga: "Rp 2.800.000", status: "Lunas", keterangan: "Kartu Kredit" },
      { id: "res-3", ...common, nama: "Budi Santoso", checkIn: "2026-05-03", checkOut: "2026-05-04", tipe: "Camping Ground", noUnit: "Tenda Standard", harga: "Rp 500.000", status: "Belum Lunas", keterangan: "Cash" },
    ] },
  },
  {
    kstIdentifier: "cangar",
    path: "/booklist-atp/pelanggan",
    name: "Pelanggan Booklist ATP",
    description: "Data pelanggan wisata Cangar.",
    dataType: { typeName: "table" },
    data: { typeName: "table", items: [
      { id: "pel-1", ...common, nama: "Ahmad Rizki", domisili: "Malang, Jawa Timur", kontak: "08123456890", jumlahTamu: 4, harga: "Rp 1.500.000", status: "Lunas", keterangan: "Transfer Bank" },
      { id: "pel-2", ...common, nama: "Siti Nurhaliza", domisili: "Surabaya, Jawa Timur", kontak: "08234567901", jumlahTamu: 5, harga: "Rp 2.800.000", status: "Lunas", keterangan: "Kartu Kredit" },
    ] },
  },
  {
    kstIdentifier: "jatikerto",
    path: "/pertanian",
    name: "Pertanian",
    description: "Data komoditas pertanian.",
    dataType: { typeName: "table" },
    data: { typeName: "table", items: [
      { id: "pert-1", ...common, nama: "Melon Golden Aroma", proyeksiPanen: 1500, satuan: "Kg", luasUsaha: "500 m2", masaTanamBulan: 3, masaTanamTahun: "4 Kali", keterangan: "Keterangan" },
      { id: "pert-2", ...common, nama: "Apple Fuji", proyeksiPanen: 1200, satuan: "Kg", luasUsaha: "600 m2", masaTanamBulan: 5, masaTanamTahun: "3 Kali", keterangan: "Segar dan renyah" },
    ] },
  },
  {
    kstIdentifier: "jatikerto",
    path: "/peternakan",
    name: "Peternakan",
    description: "Data komoditas peternakan.",
    dataType: { typeName: "table" },
    data: { typeName: "table", items: [
      { id: "pet-1", ...common, namaKomoditas: "Sapi", jumlah: 1500, satuan: "Ekor", luasUsaha: "700 m2", ketersediaanBulan: 1, ketersediaanTahun: "1 Kali", keterangan: "Keterangan" },
      { id: "pet-2", ...common, namaKomoditas: "Kambing", jumlah: 800, satuan: "Ekor", luasUsaha: "400 m2", ketersediaanBulan: 2, ketersediaanTahun: "2 Kali", keterangan: "Rutin setiap pagi" },
    ] },
  },
  {
    kstIdentifier: "jatikerto",
    path: "/konservasi",
    name: "Konservasi",
    description: "Data konservasi hewan dan tumbuhan.",
    dataType: { typeName: "table" },
    data: { typeName: "table", items: [
      { id: "kon-1", ...common, view: "konservasi-hewan", namaKomoditas: "Rusa Totol", foto: "https://images.unsplash.com/photo-1484406566174-9da000fda645?w=300&h=160&fit=crop", jumlah: 8, satuan: "Ekor", keterangan: "Keterangan dari hewan dan gambar" },
      { id: "kon-2", ...common, view: "konservasi-tumbuhan", namaKomoditas: "Anggrek Bulan", foto: "https://images.unsplash.com/photo-1566907225470-b77b78824271?w=300&h=160&fit=crop", jumlah: 35, satuan: "Pohon", keterangan: "Tanaman konservasi" },
    ] },
  },
  {
    kstIdentifier: "jatikerto",
    path: "/pelayanan-akademik",
    name: "Pelayanan Akademik",
    description: "Data mahasiswa penelitian.",
    dataType: { typeName: "table" },
    data: { typeName: "table", items: [
      { id: "akd-1", ...common, namaMahasiswa: "Mahasiswa 1", dosenPembimbing: "Dr. Dosen Pembimbing", programStudi: "Teknik Informatika", mulai: "Desember", selesai: "Januari", luasan: "150 m2", judulPenelitian: "Judul penelitian panjang" },
      { id: "akd-2", ...common, namaMahasiswa: "Mahasiswa 2", dosenPembimbing: "Dosen Pembimbing 2", programStudi: "Sistem Informasi", mulai: "Januari", selesai: "Februari", luasan: "200 m2", judulPenelitian: "Analisis Efektivitas Metode Baru" },
    ] },
  },
  {
    kstIdentifier: "jatikerto",
    path: "/kemitraan",
    name: "Kemitraan",
    description: "Data mitra kerja sama.",
    dataType: { typeName: "table" },
    data: { typeName: "table", items: [
      { id: "mitra-1", ...common, mitra: "PT Teknologi Informasi dan Inovasi Digital Nusantara", bidangKerjasama: "Pengembangan Sistem Informasi Pertanian Cerdas", jangkaWaktuKontrak: "8 Mei 2026 - 8 Mei 2027", keterangan: "-" },
      { id: "mitra-2", ...common, mitra: "CV Agro Sejahtera Mandiri", bidangKerjasama: "Pertanian", jangkaWaktuKontrak: "15 Juni 2026 - 15 Juni 2027", keterangan: "-" },
    ] },
  },
];

function buildContract(kstIdentifier: KstIdentifier) {
  const filtered = entries.filter((entry) => entry.kstIdentifier === kstIdentifier);
  const categoryName =
    kstIdentifier === "ngijo" ? "KST Ngijo" : kstIdentifier === "cangar" ? "KST Cangar" : "KST Jatikerto";
  return {
    version: "0.0.1",
    contract: [
      {
        name: categoryName,
        path: `/${kstIdentifier}/`,
        iconUri: null,
        description: `Kontrak data ${categoryName}`,
        items: filtered.map((entry) => ({
          name: entry.name,
          path: entry.path,
          code: "",
          iconUri: null,
          description: entry.description,
          dataType: entry.dataType,
          operations: entry.operations ?? ["read", "write", "delete"],
          params: entry.params ?? [],
        })),
      },
    ],
  };
}

async function main() {
  for (const seedUser of users) {
    const passwordHash = await hashPassword(seedUser.password);
    const user = await prisma.user.upsert({
      where: { email: seedUser.email },
      update: {
        username: seedUser.username,
        name: seedUser.name,
        passwordHash,
        status: UserStatus.active,
      },
      create: {
        username: seedUser.username,
        email: seedUser.email,
        passwordHash,
        name: seedUser.name,
        status: UserStatus.active,
      },
    });
    await prisma.userRole.deleteMany({ where: { userId: user.id } });
    await prisma.userRole.create({
      data: {
        userId: user.id,
        role: seedUser.role,
        kstIdentifier: seedUser.role === Role.operator ? seedUser.kstIdentifier : null,
        isActive: true,
      },
    });
  }

  const codeByKey = new Map<string, string>();
  for (const entry of entries) {
    const existing = await prisma.dataEntry.findUnique({
      where: { kstIdentifier_path: { kstIdentifier: entry.kstIdentifier, path: entry.path } },
    });
    const code = existing?.code ?? crypto.randomUUID();
    codeByKey.set(`${entry.kstIdentifier}:${entry.path}`, code);
    await prisma.dataEntry.upsert({
      where: { kstIdentifier_path: { kstIdentifier: entry.kstIdentifier, path: entry.path } },
      update: {
        name: entry.name,
        description: entry.description,
        dataType: entry.dataType,
        operations: entry.operations ?? ["read", "write", "delete"],
        params: entry.params ?? [],
        data: entry.data,
      },
      create: {
        kstIdentifier: entry.kstIdentifier,
        path: entry.path,
        code,
        name: entry.name,
        description: entry.description,
        dataType: entry.dataType,
        operations: entry.operations ?? ["read", "write", "delete"],
        params: entry.params ?? [],
        data: entry.data,
      },
    });
  }

  for (const kst of ["ngijo", "cangar", "jatikerto"] as KstIdentifier[]) {
    const contract = buildContract(kst);
    for (const item of contract.contract[0].items) {
      item.code = codeByKey.get(`${kst}:${item.path}`) ?? "";
    }
    await prisma.dataContract.upsert({
      where: { kstIdentifier_version: { kstIdentifier: kst, version: "0.0.1" } },
      update: { contractJson: contract },
      create: { kstIdentifier: kst, version: "0.0.1", contractJson: contract },
    });
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
