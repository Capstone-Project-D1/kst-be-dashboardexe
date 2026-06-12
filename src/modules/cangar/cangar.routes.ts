import { Router } from "express";
import { authMiddleware } from "../../middlewares/auth.middleware.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { canAccessKst } from "../../utils/rbac.js";
import { AppError, fail, ok } from "../../utils/response.js";
import {
  getBooking,
  getBookingById,
  getContract,
  getDashboardSummary,
  getHealth,
  getKeuangan,
  getKeuanganRekap,
  getStok,
  getStokItems,
  getSummary,
} from "./cangarWp.service.js";
import { CangarWpError } from "./cangarWp.client.js";

const router = Router();

function routeParam(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

function sendCangarError(res: Parameters<typeof fail>[0], error: unknown) {
  if (error instanceof CangarWpError) return fail(res, error.code, error.message);
  if (error instanceof AppError) return fail(res, error.code, error.message);
  return fail(res, 500, error instanceof Error ? error.message : "Terjadi kesalahan pada gateway Cangar.");
}

function assertCangarAccess(req: Parameters<typeof authMiddleware>[0]) {
  if (!req.user || !canAccessKst(req.user, "cangar")) {
    throw new AppError(403, "Tidak memiliki akses ke KST Cangar.");
  }
}

router.get(
  "/health",
  asyncHandler(async (_req, res) => {
    try {
      return ok(res, await getHealth());
    } catch (error) {
      return sendCangarError(res, error);
    }
  }),
);

router.use(authMiddleware);
router.use((req, _res, next) => {
  assertCangarAccess(req);
  next();
});

router.get(
  "/contract",
  asyncHandler(async (_req, res) => {
    try {
      return ok(res, await getContract());
    } catch (error) {
      return sendCangarError(res, error);
    }
  }),
);

router.get(
  "/data/summary",
  asyncHandler(async (_req, res) => {
    try {
      return ok(res, await getSummary());
    } catch (error) {
      return sendCangarError(res, error);
    }
  }),
);

router.get(
  "/data/stok",
  asyncHandler(async (req, res) => {
    try {
      return ok(res, await getStok(req.query));
    } catch (error) {
      return sendCangarError(res, error);
    }
  }),
);

router.get(
  "/data/stok/items",
  asyncHandler(async (req, res) => {
    try {
      return ok(res, await getStokItems(req.query));
    } catch (error) {
      return sendCangarError(res, error);
    }
  }),
);

router.get(
  "/data/booking",
  asyncHandler(async (req, res) => {
    try {
      return ok(res, await getBooking(req.query));
    } catch (error) {
      return sendCangarError(res, error);
    }
  }),
);

router.get(
  "/data/booking/:id",
  asyncHandler(async (req, res) => {
    try {
      return ok(res, await getBookingById(routeParam(req.params.id)));
    } catch (error) {
      return sendCangarError(res, error);
    }
  }),
);

router.get(
  "/data/keuangan",
  asyncHandler(async (req, res) => {
    try {
      return ok(res, await getKeuangan(req.query));
    } catch (error) {
      return sendCangarError(res, error);
    }
  }),
);

router.get(
  "/data/keuangan/rekap",
  asyncHandler(async (req, res) => {
    try {
      return ok(res, await getKeuanganRekap(req.query));
    } catch (error) {
      return sendCangarError(res, error);
    }
  }),
);

router.get(
  "/dashboard-summary",
  asyncHandler(async (req, res) => {
    try {
      return ok(res, await getDashboardSummary(req.query));
    } catch (error) {
      return sendCangarError(res, error);
    }
  }),
);

export default router;
