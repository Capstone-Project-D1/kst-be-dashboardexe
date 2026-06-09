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
process.env.NGIJO_API_BASE_URL = "http://localhost:5001/api";
process.env.CANGAR_API_BASE_URL = "http://localhost:5002/api";
process.env.JATIKERTO_API_BASE_URL = "http://localhost:5000/api";
process.env.UPSTREAM_TIMEOUT_MS = "5000";

let app: any;
let fetchMock: ReturnType<typeof vi.fn>;
let superAdminToken = "";
let operatorNgijoToken = "";

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("KST gateway API", () => {
  beforeAll(async () => {
    ({ app } = await import("../src/app.js"));
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
    fetchMock = vi.fn(async () => jsonResponse({ timestamp: "kst", response: { ok: true } }));
    vi.stubGlobal("fetch", fetchMock);
  });

  it("forwards health requests to the registered KST service", async () => {
    const res = await request(app)
      .get("/api/gateway/jatikerto/health")
      .set("Authorization", `Bearer ${superAdminToken}`);

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith("http://localhost:5000/api/health", {
      method: "GET",
      headers: { Authorization: `Bearer ${superAdminToken}` },
      signal: expect.any(AbortSignal),
    } as any);
  });

  it("forwards contract query parameters", async () => {
    await request(app)
      .get("/api/gateway/jatikerto/contract?permission=rw")
      .set("Authorization", `Bearer ${superAdminToken}`);

    expect(fetchMock.mock.calls[0][0]).toBe("http://localhost:5000/api/contract?permission=rw");
  });

  it("forwards data path and query parameters", async () => {
    await request(app)
      .get("/api/gateway/jatikerto/data/pertanian/items?offset=0&limit=5")
      .set("Authorization", `Bearer ${superAdminToken}`);

    expect(fetchMock.mock.calls[0][0]).toBe(
      "http://localhost:5000/api/data/pertanian/items?offset=0&limit=5",
    );
  });

  it("proxies public /kst routes to the selected upstream backend", async () => {
    await request(app)
      .get("/kst/ngijo/data/tracker-inovasi?limit=5")
      .set("Authorization", `Bearer ${superAdminToken}`);

    expect(fetchMock.mock.calls[0][0]).toBe("http://localhost:5001/api/data/tracker-inovasi?limit=5");
  });

  it("forwards query request bodies and Authorization", async () => {
    await request(app)
      .post("/api/gateway/jatikerto/query")
      .set("Authorization", `Bearer ${superAdminToken}`)
      .send({ queries: [{ code: "pertanian.items" }] });

    expect(fetchMock).toHaveBeenCalledWith("http://localhost:5000/api/query", {
      method: "POST",
      headers: { Authorization: `Bearer ${superAdminToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ queries: [{ code: "pertanian.items" }] }),
      signal: expect.any(AbortSignal),
    } as any);
  });

  it("returns 404 for unregistered KST services", async () => {
    const res = await request(app)
      .get("/api/gateway/kst_ngijo/health")
      .set("Authorization", `Bearer ${superAdminToken}`);

    expect(res.status).toBe(404);
    expect(res.body.response).toBeNull();
    expect(res.body.error.code).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns standard 503 errors when a KST service is unreachable", async () => {
    fetchMock.mockRejectedValueOnce(new Error("connect ECONNREFUSED"));

    const res = await request(app)
      .get("/api/gateway/jatikerto/health")
      .set("Authorization", `Bearer ${superAdminToken}`);

    expect(res.status).toBe(503);
    expect(res.body.response).toBeNull();
    expect(res.body.error).toEqual({
      code: 503,
      message: "API KST jatikerto tidak bisa dihubungi.",
    });
  });

  it("aggregates contracts from registered KST services", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          timestamp: "kst",
          response: {
            version: "0.0.1",
            contract: [{ path: "/tracker-inovasi", operations: ["read", "write"] }],
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          timestamp: "kst",
          response: {
            version: "0.0.1",
            contract: [{ path: "/stok-opname", operations: ["read", "write"] }],
          },
        }),
      )
      .mockResolvedValueOnce(
      jsonResponse({
        timestamp: "kst",
        response: {
          version: "0.0.1",
          contract: [{ path: "/pertanian/items", operations: ["read", "write"] }],
        },
      }),
      );

    const res = await request(app)
      .get("/api/contract?permission=rw")
      .set("Authorization", `Bearer ${superAdminToken}`);

    expect(res.status).toBe(200);
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      "http://localhost:5001/api/contract?permission=rw",
      "http://localhost:5002/api/contract?permission=rw",
      "http://localhost:5000/api/contract?permission=rw",
    ]);
    expect(res.body.response).toEqual([
      {
        kstIdentifier: "ngijo",
        version: "0.0.1",
        contract: [{ path: "/tracker-inovasi", operations: ["read", "write"] }],
      },
      {
        kstIdentifier: "cangar",
        version: "0.0.1",
        contract: [{ path: "/stok-opname", operations: ["read", "write"] }],
      },
      {
        kstIdentifier: "jatikerto",
        version: "0.0.1",
        contract: [{ path: "/pertanian/items", operations: ["read", "write"] }],
      },
    ]);
  });

  it("returns partial contracts with warnings when one upstream fails", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          response: { version: "1.0.0", contract: [{ path: "/tracker-inovasi", operations: ["read"] }] },
        }),
      )
      .mockRejectedValueOnce(new Error("connect ECONNREFUSED"))
      .mockResolvedValueOnce(jsonResponse({ response: { version: "1.0.0", contract: [] } }));

    const res = await request(app).get("/contract").set("Authorization", `Bearer ${superAdminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.response[0].contract).toHaveLength(1);
    expect(res.body.response[1]).toMatchObject({
      kstIdentifier: "cangar",
      version: "unknown",
      contract: [],
      warning: "Backend KST cangar sedang tidak tersedia.",
    });
  });

  it("keeps operator RBAC on proxied KST routes", async () => {
    const res = await request(app)
      .get("/kst/cangar/data/stok-opname")
      .set("Authorization", `Bearer ${operatorNgijoToken}`);

    expect(res.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
