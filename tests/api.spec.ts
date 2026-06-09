import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";

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
process.env.CANGAR_API_BASE_URL = "";
process.env.JATIKERTO_API_BASE_URL = "";
process.env.UPSTREAM_TIMEOUT_MS = "5000";

let app: any;
let prisma: any;
let superAdminToken = "";
let manajemenToken = "";
let operatorNgijoToken = "";

async function login(usernameOrEmail: string, password: string) {
  const res = await request(app).post("/auth/login").send({ usernameOrEmail, password });
  expect(res.status).toBe(200);
  return res.body.response.accessToken as string;
}

describe("KST Executive Dashboard API", () => {
  beforeAll(async () => {
    ({ app } = await import("../src/app.js"));
    ({ prisma } = await import("../src/db/prisma.js"));
    superAdminToken = await login("superadmin", "SuperAdmin123!");
    manajemenToken = await login("manajemen", "Manajemen123!");
    operatorNgijoToken = await login("operator_ngijo", "Operator123!");
  });

  it("register user pending approval", async () => {
    const email = `pending.${Date.now()}@kst-ub.ac.id`;
    const res = await request(app).post("/auth/register").send({
      username: `pending_${Date.now()}`,
      email,
      password: "Password123!",
      name: "Pending User",
      requestedRole: "operator",
      requestedKstIdentifier: "ngijo",
    });
    expect(res.status).toBe(201);
    expect(res.body.response.status).toBe("pending_approval");
  });

  it("login ditolak jika user pending", async () => {
    const email = `pending-login.${Date.now()}@kst-ub.ac.id`;
    await request(app).post("/auth/register").send({
      username: `pending_login_${Date.now()}`,
      email,
      password: "Password123!",
      name: "Pending Login",
      requestedRole: "manajemen",
    });
    const res = await request(app)
      .post("/auth/login")
      .send({ usernameOrEmail: email, password: "Password123!" });
    expect(res.status).toBe(403);
  });

  it("super_admin login berhasil", async () => {
    expect(superAdminToken).toEqual(expect.any(String));
  });

  it("super_admin approve registration", async () => {
    const email = `approval.${Date.now()}@kst-ub.ac.id`;
    const reg = await request(app).post("/auth/register").send({
      username: `approval_${Date.now()}`,
      email,
      password: "Password123!",
      name: "Approval User",
      requestedRole: "manajemen",
    });
    const id = reg.body.response.registrationRequestId;
    const approved = await request(app)
      .post(`/approvals/registrations/${id}/approve`)
      .set("Authorization", `Bearer ${superAdminToken}`)
      .send();
    expect(approved.status).toBe(200);
    expect(approved.body.response.status).toBe("approved");
  });

  it("manajemen tidak bisa write data", async () => {
    const res = await request(app)
      .post("/data/kemitraan?kstIdentifier=jatikerto")
      .set("Authorization", `Bearer ${manajemenToken}`)
      .send({ mitra: "PT Read Only" });
    expect(res.status).toBe(403);
  });

  it("operator submit edit fallback lokal menghasilkan data_change_request pending", async () => {
    const res = await request(app)
      .patch("/data/tracker-inovasi?kstIdentifier=ngijo&id=ngijo-ti-1")
      .set("Authorization", `Bearer ${operatorNgijoToken}`)
      .send({ domain: "Updated Domain" });
    expect(res.status).toBe(200);
    expect(res.body.response.status).toBe("pending");
  });

  it("super_admin approve data_change_request dan data berubah", async () => {
    const submit = await request(app)
      .patch("/data/tracker-inovasi?kstIdentifier=ngijo&id=ngijo-ti-2")
      .set("Authorization", `Bearer ${operatorNgijoToken}`)
      .send({ domain: "Approved Domain" });
    const approve = await request(app)
      .post(`/approvals/data-changes/${submit.body.response.changeRequestId}/approve`)
      .set("Authorization", `Bearer ${superAdminToken}`)
      .send();
    expect(approve.status).toBe(200);
    const list = await request(app)
      .get("/data/tracker-inovasi?search=Approved Domain")
      .set("Authorization", `Bearer ${superAdminToken}`);
    expect(list.body.response.data.items[0].domain).toBe("Approved Domain");
  });

  it("operator tidak bisa akses KST lain", async () => {
    const res = await request(app)
      .get("/kst/cangar/stok-opname")
      .set("Authorization", `Bearer ${operatorNgijoToken}`);
    expect(res.status).toBe(403);
  });

  it("GET /contract menghasilkan operations sesuai role", async () => {
    const res = await request(app).get("/contract").set("Authorization", `Bearer ${manajemenToken}`);
    expect(res.status).toBe(200);
    expect(res.body.response).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kstIdentifier: "ngijo",
          version: "unknown",
          contract: [],
          warning: expect.any(String),
        }),
      ]),
    );
  });

  it("POST /query support partial item error", async () => {
    const entry = await prisma.dataEntry.findFirst({ where: { path: "/tracker-inovasi" } });
    const res = await request(app)
      .post("/query")
      .set("Authorization", `Bearer ${superAdminToken}`)
      .send({ queries: [{ code: entry.code, params: { limit: 1 } }, { code: "missing-code" }] });
    expect(res.status).toBe(200);
    expect(res.body.response[0].data.items).toHaveLength(1);
    expect(res.body.response[1].error.code).toBe(404);
  });
});
