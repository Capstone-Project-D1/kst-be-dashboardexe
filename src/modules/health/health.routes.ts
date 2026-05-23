import { Router } from "express";
import { prisma } from "../../db/prisma.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { ok } from "../../utils/response.js";

const router = Router();

router.get(
  "/",
  asyncHandler(async (_req, res) => {
    await prisma.$queryRaw`SELECT 1`;
    return ok(res, {
      status: "ok",
      service: "kst-be-dashboardexe",
      database: "ok",
    });
  }),
);

export default router;
