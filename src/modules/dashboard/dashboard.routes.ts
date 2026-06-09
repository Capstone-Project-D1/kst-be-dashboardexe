import { Router } from "express";
import { authMiddleware } from "../../middlewares/auth.middleware.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { ok } from "../../utils/response.js";
import { aggregateDashboardSummary, aggregateDashboardTimeSeries } from "../gateway/gateway.service.js";

const router = Router();

router.use(authMiddleware);

router.get(
  "/summary",
  asyncHandler(async (req, res) => {
    const data = await aggregateDashboardSummary(req);
    return ok(res, data);
  }),
);

router.get(
  "/collaboration",
  asyncHandler(async (req, res) => {
    const data = await aggregateDashboardTimeSeries(req, "/dashboard/collaboration");
    return ok(res, data);
  }),
);

router.get(
  "/research-projects",
  asyncHandler(async (req, res) => {
    const data = await aggregateDashboardTimeSeries(req, "/dashboard/research-projects");
    return ok(res, data);
  }),
);

export default router;
