import jwt from "jsonwebtoken";
import request from "supertest";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

process.env.NODE_ENV = "test";
process.env.PORT = "8000";
process.env.DATABASE_URL ??= "postgresql://postgres:postgres@localhost:5432/kst_dashboardexe";
process.env.JWT_ACCESS_SECRET = "test-access-secret-minimum-16";
process.env.JWT_REFRESH_SECRET = "test-refresh-secret-minimum-16";
process.env.ACCESS_TOKEN_TTL = "15m";
process.env.REFRESH_TOKEN_TTL_DAYS = "7";
process.env.CORS_ORIGIN = "http://localhost:5173";
process.env.COOKIE_SECURE = "false";
process.env.COOKIE_SAME_SITE = "lax";
process.env.NGIJO_API_BASE_URL = "";
process.env.CANGAR_API_BASE_URL = "http://localhost/kstcangar/wordpress/wp-json/kstcangar/v1";
process.env.CANGAR_API_USERNAME = "service-account";
process.env.CANGAR_API_PASSWORD = "service-password";
process.env.JATIKERTO_API_BASE_URL = "";
process.env.UPSTREAM_TIMEOUT_MS = "5000";

let app: any;
let clearCangarAccessToken: () => void;
let fetchMock: ReturnType<typeof vi.fn>;
let superAdminToken = "";
let operatorNgijoToken = "";

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("Cangar WordPress gateway", () => {
  beforeAll(async () => {
    ({ app } = await import("../src/app.js"));
    ({ clearCangarAccessToken } = await import("../src/modules/cangar/cangarWp.client.js"));

    superAdminToken = jwt.sign(
      {
        sub: "super-admin",
        username: "superadmin",
        email: "superadmin@kst-ub.ac.id",
        name: "Super Admin",
        activeRole: "super_admin",
        kstAccess: ["ngijo", "cangar", "jatikerto"],
        permissions: ["read", "write", "delete", "approve", "manage_users", "download_report"],
      },
      process.env.JWT_ACCESS_SECRET!,
    );
    operatorNgijoToken = jwt.sign(
      {
        sub: "operator-ngijo",
        username: "operator_ngijo",
        email: "operator.ngijo@kst-ub.ac.id",
        name: "Operator Ngijo",
        activeRole: "operator",
        kstAccess: ["ngijo"],
        permissions: ["read", "submit_edit", "download_report"],
      },
      process.env.JWT_ACCESS_SECRET!,
    );
  });

  beforeEach(() => {
    clearCangarAccessToken();
    fetchMock = vi.fn(async () => jsonResponse({ timestamp: "kst", response: { ok: true } }));
    vi.stubGlobal("fetch", fetchMock);
  });

  it("proxies public Cangar health without service-account login", async () => {
    const res = await request(app).get("/api/kst/cangar/health");

    expect(res.status).toBe(200);
    expect(res.body.response).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(
      "http://localhost/kstcangar/wordpress/wp-json/kstcangar/v1/health",
    );
    expect((fetchMock.mock.calls[0][1] as any).headers.Authorization).toBeUndefined();
  });

  it("logs in once and reuses the Cangar token for protected requests", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ response: { accessToken: "wp-token" } }))
      .mockResolvedValueOnce(jsonResponse({ response: { version: "1.0.0", contract: [] } }))
      .mockResolvedValueOnce(jsonResponse({ response: { total: 10 } }));

    const contract = await request(app)
      .get("/api/kst/cangar/contract")
      .set("Authorization", `Bearer ${superAdminToken}`);
    const summary = await request(app)
      .get("/api/kst/cangar/data/summary")
      .set("Authorization", `Bearer ${superAdminToken}`);

    expect(contract.status).toBe(200);
    expect(summary.status).toBe(200);
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      "http://localhost/kstcangar/wordpress/wp-json/kstcangar/v1/auth/login",
      "http://localhost/kstcangar/wordpress/wp-json/kstcangar/v1/contract",
      "http://localhost/kstcangar/wordpress/wp-json/kstcangar/v1/data/summary",
    ]);
    expect((fetchMock.mock.calls[1][1] as any).headers.Authorization).toBe("Bearer wp-token");
    expect((fetchMock.mock.calls[2][1] as any).headers.Authorization).toBe("Bearer wp-token");
  });

  it("re-logins and retries once when Cangar returns 401", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ response: { accessToken: "old-token" } }))
      .mockResolvedValueOnce(jsonResponse({ error: { message: "Token expired" } }, 401))
      .mockResolvedValueOnce(jsonResponse({ response: { accessToken: "new-token" } }))
      .mockResolvedValueOnce(jsonResponse({ response: { total: 12 } }));

    const res = await request(app)
      .get("/api/kst/cangar/data/summary")
      .set("Authorization", `Bearer ${superAdminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.response).toEqual({ total: 12 });
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      "http://localhost/kstcangar/wordpress/wp-json/kstcangar/v1/auth/login",
      "http://localhost/kstcangar/wordpress/wp-json/kstcangar/v1/data/summary",
      "http://localhost/kstcangar/wordpress/wp-json/kstcangar/v1/auth/login",
      "http://localhost/kstcangar/wordpress/wp-json/kstcangar/v1/data/summary",
    ]);
    expect((fetchMock.mock.calls[1][1] as any).headers.Authorization).toBe("Bearer old-token");
    expect((fetchMock.mock.calls[3][1] as any).headers.Authorization).toBe("Bearer new-token");
  });

  it("keeps gateway RBAC before calling Cangar", async () => {
    const res = await request(app)
      .get("/api/kst/cangar/data/summary")
      .set("Authorization", `Bearer ${operatorNgijoToken}`);

    expect(res.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("injects Cangar WordPress data into GET /dashboard/summary", async () => {
    fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith("/auth/login"))
        return jsonResponse({ response: { accessToken: "wp-token" } });
      if (url.endsWith("/data/summary")) {
        return jsonResponse({
          response: {
            total_booking: 5,
            today_visitors: 2,
            week_visitors: 4,
            greenPerformance: 88,
          },
        });
      }
      if (url.endsWith("/data/stok?week=2026-W20")) {
        return jsonResponse({ response: { stok_keluar: 4, items: [{ total_keluar: 4 }] } });
      }
      if (url.endsWith("/data/booking")) {
        return jsonResponse({
          response: {
            bookings: [{ guest_count: 3 }, { guest_count: 4 }],
          },
        });
      }
      if (url.endsWith("/data/keuangan/rekap?month=2026-05")) {
        return jsonResponse({ response: { total_income: 250000 } });
      }
      return jsonResponse({ error: { message: "Unexpected URL" } }, 500);
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await request(app)
      .get("/dashboard/summary")
      .set("Authorization", `Bearer ${superAdminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.response).toMatchObject({
      totalVisitors: 7,
      todayVisitors: 2,
      weekVisitors: 4,
      activeKst: 1,
      totalKst: 3,
      totalProduction: 4,
      activeOperations: 5,
      greenPerformance: 88,
    });
    expect(res.body.response.sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kstIdentifier: "cangar",
          data: expect.objectContaining({
            totalVisitors: 7,
            activeOperations: 5,
          }),
        }),
      ]),
    );
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual(
      expect.arrayContaining([
        "http://localhost/kstcangar/wordpress/wp-json/kstcangar/v1/auth/login",
        "http://localhost/kstcangar/wordpress/wp-json/kstcangar/v1/data/summary",
        "http://localhost/kstcangar/wordpress/wp-json/kstcangar/v1/data/stok?week=2026-W20",
        "http://localhost/kstcangar/wordpress/wp-json/kstcangar/v1/data/booking",
        "http://localhost/kstcangar/wordpress/wp-json/kstcangar/v1/data/keuangan/rekap?month=2026-05",
      ]),
    );
  });

  it("keeps GET /dashboard/summary successful when Cangar WordPress fails", async () => {
    fetchMock = vi.fn(async () => jsonResponse({ error: { message: "Cangar unavailable" } }, 503));
    vi.stubGlobal("fetch", fetchMock);

    const res = await request(app)
      .get("/dashboard/summary")
      .set("Authorization", `Bearer ${superAdminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.response).toMatchObject({
      totalVisitors: 0,
      todayVisitors: 0,
      weekVisitors: 0,
      activeKst: 0,
      totalKst: 3,
      totalProduction: 0,
      activeOperations: 0,
      greenPerformance: 0,
    });
    expect(res.body.response.sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kstIdentifier: "cangar",
          data: null,
          warning: "Dashboard KST cangar dari WordPress belum tersedia.",
        }),
      ]),
    );
  });

  it("maps legacy stok opname endpoints to frontend-compatible shapes", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ response: { accessToken: "wp-token" } }))
      .mockResolvedValueOnce(
        jsonResponse({
          response: {
            total_barang: 2,
            stok_masuk: 15,
            stok_keluar: 7,
            selisih: 1,
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          response: {
            items: [
              {
                id: "stok-1",
                nama_barang: "Kentang",
                satuan: "Kg",
                stok_awal: 10,
                stok_masuk: 5,
                stok_keluar: 2,
                stok_akhir: 13,
                stok_fisik: 14,
              },
            ],
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          response: {
            items: [
              {
                id: "stok-1",
                nama_barang: "Kentang",
                satuan: "Kg",
                stok_awal: 10,
                stok_masuk: 5,
                stok_keluar: 2,
                stok_akhir: 13,
                stok_fisik: 14,
              },
            ],
          },
        }),
      );

    const summary = await request(app)
      .get("/kst/cangar/stok-opname/summary")
      .set("Authorization", `Bearer ${superAdminToken}`);
    const table = await request(app)
      .get("/kst/cangar/stok-opname?year=2026&month=5&limit=50")
      .set("Authorization", `Bearer ${superAdminToken}`);

    expect(summary.status).toBe(200);
    expect(summary.body.response).toEqual({
      total_barang: 2,
      stok_masuk: 15,
      stok_keluar: 7,
      selisih: 1,
    });
    expect(table.status).toBe(200);
    expect(table.body.response.items[0]).toMatchObject({
      id: "stok-1",
      name: "Kentang",
      satuan: "Kg",
      stockAwal: 10,
      stockAkhir: 13,
      stockFisik: 14,
      totalMasuk: 5,
      totalKeluar: 2,
      total: 13,
    });
  });

  it("maps legacy booklist ATP endpoints to frontend-compatible shapes", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ response: { accessToken: "wp-token" } }))
      .mockResolvedValueOnce(jsonResponse({ response: { total_booking: 1 } }))
      .mockResolvedValueOnce(
        jsonResponse({
          response: {
            bookings: [
              {
                id: "booking-1",
                customer_name: "Ahmad",
                check_in: "2026-05-01",
                check_out: "2026-05-02",
                room_type: "Glamping",
                unit_number: "A1",
                total_harga: 150000,
                status: "paid",
                phone: "0812",
                city: "Malang",
                guest_count: 2,
              },
            ],
          },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ response: { total_income: 150000 } }))
      .mockResolvedValueOnce(
        jsonResponse({
          response: {
            bookings: [
              {
                id: "booking-1",
                customer_name: "Ahmad",
                check_in: "2026-05-01",
                check_out: "2026-05-02",
                room_type: "Glamping",
                unit_number: "A1",
                total_harga: 150000,
                status: "paid",
              },
            ],
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          response: {
            bookings: [
              {
                id: "booking-1",
                customer_name: "Ahmad",
                phone: "0812",
                city: "Malang",
                guest_count: 2,
                total_harga: 150000,
                status: "paid",
              },
            ],
          },
        }),
      );

    const summary = await request(app)
      .get("/kst/cangar/booklist-atp/summary?year=2026&month=5")
      .set("Authorization", `Bearer ${superAdminToken}`);
    const reservasi = await request(app)
      .get("/kst/cangar/booklist-atp/reservasi?year=2026&month=5&limit=50")
      .set("Authorization", `Bearer ${superAdminToken}`);
    const pelanggan = await request(app)
      .get("/kst/cangar/booklist-atp/pelanggan?year=2026&month=5&limit=50")
      .set("Authorization", `Bearer ${superAdminToken}`);

    expect(summary.status).toBe(200);
    expect(summary.body.response).toMatchObject({
      total_booking: 1,
      total_pendapatan: 150000,
      lunas: 1,
      belum_lunas: 0,
    });
    expect(reservasi.status).toBe(200);
    expect(reservasi.body.response.items[0]).toMatchObject({
      id: "booking-1",
      nama: "Ahmad",
      checkIn: "2026-05-01",
      checkOut: "2026-05-02",
      tipe: "Glamping",
      noUnit: "A1",
      harga: 150000,
      status: "Lunas",
    });
    expect(pelanggan.status).toBe(200);
    expect(pelanggan.body.response.items[0]).toMatchObject({
      id: "booking-1",
      nama: "Ahmad",
      domisili: "Malang",
      kontak: "0812",
      jumlahTamu: 2,
      harga: 150000,
      status: "Lunas",
    });
  });
});
