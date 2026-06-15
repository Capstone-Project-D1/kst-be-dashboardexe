import { Router } from "express";
import { authMiddleware } from "../../middlewares/auth.middleware.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { canAccessKst } from "../../utils/rbac.js";
import { AppError, fail, ok } from "../../utils/response.js";
import { CangarWpError } from "./cangarWp.client.js";
import {
  getLegacyBooklistSummary,
  getLegacyPelanggan,
  getLegacyReservasi,
  getLegacyStokOpname,
  getLegacyStokSummary,
} from "./cangar.compat.service.js";

const router = Router();

router.use((_req, res, next) => {
  res.setHeader("X-KST-Data-Source", "cangar-wp");
  next();
});

function sendCompatError(res: Parameters<typeof fail>[0], error: unknown) {
  if (error instanceof CangarWpError) return fail(res, error.code, error.message);
  if (error instanceof AppError) return fail(res, error.code, error.message);
  return fail(res, 500, error instanceof Error ? error.message : "Terjadi kesalahan pada compatibility Cangar.");
}

router.use(authMiddleware);
router.use((req, _res, next) => {
  if (!req.user || !canAccessKst(req.user, "cangar")) {
    throw new AppError(403, "Tidak memiliki akses ke KST Cangar.");
  }
  next();
});

router.get(
  "/stok-opname/summary",
  asyncHandler(async (req, res) => {
    try {
      return ok(res, await getLegacyStokSummary(req.query));
    } catch (error) {
      return sendCompatError(res, error);
    }
  }),
);

router.get(
  "/stok-opname",
  asyncHandler(async (req, res) => {
    try {
      return ok(res, await getLegacyStokOpname(req.query));
    } catch (error) {
      return sendCompatError(res, error);
    }
  }),
);

router.get(
  "/booklist-atp/summary",
  asyncHandler(async (req, res) => {
    try {
      return ok(res, await getLegacyBooklistSummary(req.query));
    } catch (error) {
      return sendCompatError(res, error);
    }
  }),
);

router.get(
  "/booklist-atp/reservasi",
  asyncHandler(async (req, res) => {
    try {
      return ok(res, await getLegacyReservasi(req.query));
    } catch (error) {
      return sendCompatError(res, error);
    }
  }),
);

router.get(
  "/booklist-atp/pelanggan",
  asyncHandler(async (req, res) => {
    try {
      return ok(res, await getLegacyPelanggan(req.query));
    } catch (error) {
      return sendCompatError(res, error);
    }
  }),
);

export default router;
