import { Router } from "express";
import type { DataChangeMethod } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../../db/prisma.js";
import { authMiddleware } from "../../middlewares/auth.middleware.js";
import { validate } from "../../middlewares/validate.middleware.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { ok } from "../../utils/response.js";
import { kstSchema } from "../auth/auth.schemas.js";
import { materializeData, mutateData, readData, toPageContainer } from "./data.service.js";

const router = Router();

const querySchema = z.object({
  queries: z.array(z.object({ code: z.string().min(1), params: z.record(z.any()).optional() })).max(80),
});

router.use(authMiddleware);

router.post(
  "/query",
  validate({ body: querySchema }),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof querySchema>;
    const results = await Promise.all(
      body.queries.map(async (query) => {
        const entry = await prisma.dataEntry.findUnique({ where: { code: query.code } });
        if (!entry) {
          return {
            code: query.code,
            createdAt: null,
            updatedAt: null,
            data: null,
            error: { code: 404, message: "Kode data tidak ditemukan." },
          };
        }
        if (req.user!.activeRole === "operator" && !req.user!.kstAccess.includes(entry.kstIdentifier)) {
          return {
            code: query.code,
            createdAt: entry.createdAt.toISOString(),
            updatedAt: entry.updatedAt?.toISOString() ?? null,
            data: null,
            error: { code: 403, message: "Tidak memiliki akses ke KST ini." },
          };
        }
        return {
          code: entry.code,
          createdAt: entry.createdAt.toISOString(),
          updatedAt: entry.updatedAt?.toISOString() ?? null,
          data: materializeData(entry, query.params ?? {}),
        };
      }),
    );
    return ok(res, results);
  }),
);

router.get(
  "/data/*",
  asyncHandler(async (req, res) => {
    const data = await readData(req.params[0], req.user!, req.query as Record<string, any>);
    return ok(res, data);
  }),
);

for (const method of ["post", "put", "patch", "delete"] as const) {
  router[method](
    "/data/*",
    asyncHandler(async (req, res) => {
      const path = `/${req.params[0]}`;
      const kstIdentifier = kstSchema.parse(req.query.kstIdentifier ?? req.body?.kstIdentifier);
      const mutationMethod: DataChangeMethod =
        method === "post" ? "create" : method === "delete" ? "delete" : method === "put" ? "update" : "patch";
      const response = await mutateData(req, {
        path,
        kstIdentifier,
        method: mutationMethod,
        body: req.body ?? {},
        rowId: req.query.id ? String(req.query.id) : undefined,
      });
      return ok(res, response, method === "post" ? 201 : 200);
    }),
  );
}

export function mountCompatibilityRoutes(router: Router) {
  const direct = (url: string, kstIdentifier: any, path: string) => {
    router.get(
      url,
      authMiddleware,
      asyncHandler(async (req, res) => {
        const data = await readData(path, req.user!, req.query as Record<string, any>, kstIdentifier);
        return ok(res, data.data);
      }),
    );
  };

  const table = (method: "get" | "post" | "patch" | "delete", url: string, kstIdentifier: any, path: string) => {
    router[method](
      url,
      authMiddleware,
      asyncHandler(async (req, res) => {
        if (method === "get") {
          const data = await readData(path, req.user!, req.query as Record<string, any>, kstIdentifier);
          return ok(res, toPageContainer(data));
        }
        const response = await mutateData(req, {
          path,
          kstIdentifier,
          method: method === "post" ? "create" : method === "delete" ? "delete" : "patch",
          body: req.body ?? {},
          rowId: String(req.params.id),
        });
        return ok(res, response, method === "post" ? 201 : 200);
      }),
    );
  };

  direct("/kst/ngijo/tracker-inovasi/summary", "ngijo", "/tracker-inovasi/summary");
  table("get", "/kst/ngijo/tracker-inovasi", "ngijo", "/tracker-inovasi");
  table("post", "/kst/ngijo/tracker-inovasi", "ngijo", "/tracker-inovasi");
  table("patch", "/kst/ngijo/tracker-inovasi/:id", "ngijo", "/tracker-inovasi");
  table("delete", "/kst/ngijo/tracker-inovasi/:id", "ngijo", "/tracker-inovasi");

  direct("/kst/ngijo/keberlanjutan/green-performance", "ngijo", "/keberlanjutan/green-performance");
  direct("/kst/ngijo/keberlanjutan/water-lifecycle", "ngijo", "/keberlanjutan/water-lifecycle");
  direct("/kst/ngijo/keberlanjutan/waste-metrics", "ngijo", "/keberlanjutan/waste-metrics");
  direct("/kst/ngijo/keberlanjutan/energy-dynamics", "ngijo", "/keberlanjutan/energy-dynamics");
  direct("/kst/ngijo/keberlanjutan/renewable-energy", "ngijo", "/keberlanjutan/renewable-energy");
  table("get", "/kst/ngijo/keberlanjutan/sensors", "ngijo", "/keberlanjutan/sensors");
  table("post", "/kst/ngijo/keberlanjutan/sensors", "ngijo", "/keberlanjutan/sensors");
  table("patch", "/kst/ngijo/keberlanjutan/sensors/:id", "ngijo", "/keberlanjutan/sensors");
  table("delete", "/kst/ngijo/keberlanjutan/sensors/:id", "ngijo", "/keberlanjutan/sensors");

  direct("/kst/cangar/stok-opname/summary", "cangar", "/stok-opname/summary");
  table("get", "/kst/cangar/stok-opname", "cangar", "/stok-opname");
  table("post", "/kst/cangar/stok-opname", "cangar", "/stok-opname");
  table("patch", "/kst/cangar/stok-opname/:id", "cangar", "/stok-opname");
  table("delete", "/kst/cangar/stok-opname/:id", "cangar", "/stok-opname");

  direct("/kst/cangar/booklist-atp/summary", "cangar", "/booklist-atp/summary");
  table("get", "/kst/cangar/booklist-atp/reservasi", "cangar", "/booklist-atp/reservasi");
  table("post", "/kst/cangar/booklist-atp/reservasi", "cangar", "/booklist-atp/reservasi");
  table("patch", "/kst/cangar/booklist-atp/reservasi/:id", "cangar", "/booklist-atp/reservasi");
  table("delete", "/kst/cangar/booklist-atp/reservasi/:id", "cangar", "/booklist-atp/reservasi");
  table("get", "/kst/cangar/booklist-atp/pelanggan", "cangar", "/booklist-atp/pelanggan");

  for (const module of ["pertanian", "peternakan", "konservasi", "pelayanan-akademik", "kemitraan"]) {
    table("get", `/kst/jatikerto/${module}`, "jatikerto", `/${module}`);
    table("post", `/kst/jatikerto/${module}`, "jatikerto", `/${module}`);
    table("patch", `/kst/jatikerto/${module}/:id`, "jatikerto", `/${module}`);
    table("delete", `/kst/jatikerto/${module}/:id`, "jatikerto", `/${module}`);
  }
}

export default router;
