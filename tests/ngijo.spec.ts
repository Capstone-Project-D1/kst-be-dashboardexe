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
process.env.NGIJO_API_BASE_URL = "https://kst-ngijo.up.railway.app/api/integration";
process.env.CANGAR_API_BASE_URL = "";
process.env.JATIKERTO_API_BASE_URL = "";
process.env.UPSTREAM_TIMEOUT_MS = "5000";

let app: any;
let fetchMock: ReturnType<typeof vi.fn>;
let superAdminToken = "";
let fetchNgijoTable: (path: string, queryString?: string) => Promise<unknown[] | null>;
let fetchNgijoTimeSeries: (path: string, queryString?: string) => Promise<unknown[] | null>;

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function ngijoNumber(value: number | null) {
  return jsonResponse({
    timestamp: "2026-06-16T00:00:00.000Z",
    response: { data: { value } },
  });
}

describe("Ngijo integration gateway", () => {
  beforeAll(async () => {
    ({ app } = await import("../src/app.js"));
    ({ fetchNgijoTable, fetchNgijoTimeSeries } = await import("../src/modules/ngijo/ngijo.service.js"));

    superAdminToken = jwt.sign(
      {
        sub: "super-admin",
        username: "superadmin",
        email: "superadmin@kst-ub.ac.id",
        name: "Super Admin",
        activeRole: "super_admin",
        kstAccess: ["ngijo"],
        permissions: ["read", "write", "delete", "approve", "manage_users", "download_report"],
      },
      process.env.JWT_ACCESS_SECRET!,
    );
  });

  beforeEach(() => {
    fetchMock = vi.fn(async () => jsonResponse({ timestamp: "kst", response: { ok: true } }));
    vi.stubGlobal("fetch", fetchMock);
  });

  it("proxies Ngijo health without forwarding Authorization", async () => {
    const res = await request(app)
      .get("/kst/ngijo/health")
      .set("Authorization", `Bearer ${superAdminToken}`);

    expect(res.status).toBe(200);
    expect(fetchMock.mock.calls[0][0]).toBe("https://kst-ngijo.up.railway.app/api/integration/health");
    expect((fetchMock.mock.calls[0][1] as any).headers.Authorization).toBeUndefined();
  });

  it("reads the Ngijo contract endpoint", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        timestamp: "kst",
        response: { version: "0.0.1", contract: [{ path: "/tracker-inovasi/projek-aktif" }] },
      }),
    );

    const res = await request(app)
      .get("/kst/ngijo/contract")
      .set("Authorization", `Bearer ${superAdminToken}`);

    expect(res.status).toBe(200);
    expect(fetchMock.mock.calls[0][0]).toBe("https://kst-ngijo.up.railway.app/api/integration/contract");
    expect(res.body.response).toEqual({
      version: "0.0.1",
      contract: [{ path: "/tracker-inovasi/projek-aktif" }],
    });
  });

  it("keeps Ngijo number response under response.data.value for generic data proxy", async () => {
    fetchMock.mockResolvedValueOnce(ngijoNumber(42));

    const res = await request(app)
      .get("/kst/ngijo/data/tracker-inovasi/projek-aktif")
      .set("Authorization", `Bearer ${superAdminToken}`);

    expect(res.status).toBe(200);
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://kst-ngijo.up.railway.app/api/integration/data/tracker-inovasi/projek-aktif",
    );
    expect(res.body.response).toEqual({ data: { value: 42 } });
  });

  it("returns an empty Ngijo table fallback when a known table upstream is unavailable", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ timestamp: "kst", error: { message: "upstream failed" } }, 500),
    );

    const res = await request(app)
      .get("/kst/ngijo/data/keberlanjutan/sensor-feed?offset=0&limit=50&sort_col=-1")
      .set("Authorization", `Bearer ${superAdminToken}`);

    expect(res.status).toBe(200);
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://kst-ngijo.up.railway.app/api/integration/data/keberlanjutan/sensor-feed?offset=0&limit=50&sort_col=-1",
    );
    expect(res.body.response).toEqual({
      data: { typeName: "table", items: [] },
      warning: "Backend KST ngijo gagal merespons request.",
    });
  });

  it("parses Ngijo table responses from response.data.items", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        timestamp: "kst",
        response: { data: { items: [{ id: "sensor-1" }] } },
      }),
    );

    const rows = await fetchNgijoTable("/keberlanjutan/sensor-feed", "?offset=0&limit=1&sort_col=0");

    expect(rows).toEqual([{ id: "sensor-1" }]);
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://kst-ngijo.up.railway.app/api/integration/data/keberlanjutan/sensor-feed?offset=0&limit=1&sort_col=0",
    );
  });

  it("parses Ngijo timeSeries responses from response.data.value", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        timestamp: "kst",
        response: { data: { value: [{ time: 1, value: 12 }] } },
      }),
    );

    const points = await fetchNgijoTimeSeries("/keberlanjutan/dinamika-energi", "?start_time=0&end_time=10&limit=1");

    expect(points).toEqual([{ time: 1, value: 12 }]);
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://kst-ngijo.up.railway.app/api/integration/data/keberlanjutan/dinamika-energi?start_time=0&end_time=10&limit=1",
    );
  });

  it("builds Ngijo dashboard summary without coercing unavailable null values to 0", async () => {
    fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith("/health")) return jsonResponse({ timestamp: "kst", response: { status: "ok" } });
      if (url.endsWith("/tracker-inovasi/projek-aktif")) return ngijoNumber(17);
      if (url.endsWith("/tracker-inovasi/avg-trl")) return ngijoNumber(6.4);
      if (url.endsWith("/tracker-inovasi/paten-tertunda")) return ngijoNumber(3);
      if (url.endsWith("/tracker-inovasi/kolaborasi")) return ngijoNumber(9);
      if (url.endsWith("/keberlanjutan/green-performance")) return ngijoNumber(87);
      return ngijoNumber(null);
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await request(app)
      .get("/dashboard/summary")
      .set("Authorization", `Bearer ${superAdminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.response).toMatchObject({
      activeKst: 1,
      totalKst: 3,
      totalVisitors: null,
      todayVisitors: null,
      weekVisitors: null,
      totalProduction: 17,
      greenPerformance: 87,
      totalMitra: 9,
      totalPartners: 9,
    });
    expect(res.body.response.sources.ngijo).toEqual({
      status: "success",
      data: expect.objectContaining({
        totalProjects: 17,
        avgTrl: 6.4,
        pendingPatents: 3,
        renewableEnergy: null,
        recycledWater: null,
        wasteMetric: null,
      }),
    });
  });
});
