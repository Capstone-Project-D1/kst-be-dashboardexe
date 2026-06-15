import { Router } from "express";
import type { DataChangeMethod } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../../db/prisma.js";
import { authMiddleware } from "../../middlewares/auth.middleware.js";
import { validate } from "../../middlewares/validate.middleware.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { ok } from "../../utils/response.js";
import { kstSchema } from "../auth/auth.schemas.js";
import { materializeData, mutateData, readData } from "./data.service.js";

const router = Router();

const querySchema = z.object({
  queries: z.array(z.object({ code: z.string().min(1), params: z.record(z.any()).optional() })).max(80),
});

router.use(authMiddleware);
router.use((_req, res, next) => {
  res.setHeader("X-KST-Data-Source", "local-prisma");
  next();
});

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

export default router;
