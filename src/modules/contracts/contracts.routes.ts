import { Router } from "express";
import { authMiddleware } from "../../middlewares/auth.middleware.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { ok } from "../../utils/response.js";
import { aggregateContracts } from "../gateway/gateway.service.js";

const router = Router();

router.get(
  "/",
  authMiddleware,
  asyncHandler(async (req, res) => {
    const contracts = await aggregateContracts(req);
    return ok(res, contracts);
  }),
);

export default router;
