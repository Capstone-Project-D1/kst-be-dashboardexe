import { Router } from "express";
import { authMiddleware } from "../../middlewares/auth.middleware.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { ok } from "../../utils/response.js";
import { readData } from "../data/data.service.js";

const router = Router();

router.use(authMiddleware);

router.get(
  "/summary",
  asyncHandler(async (req, res) => {
    const data = await readData("/dashboard/summary", req.user!, {}, "ngijo");
    return ok(res, data.data);
  }),
);

router.get(
  "/collaboration",
  asyncHandler(async (req, res) => {
    const data = await readData("/dashboard/collaboration", req.user!, req.query as any, "ngijo");
    return ok(res, data.data);
  }),
);

router.get(
  "/research-projects",
  asyncHandler(async (req, res) => {
    const data = await readData("/dashboard/research-projects", req.user!, req.query as any, "ngijo");
    return ok(res, data.data);
  }),
);

export default router;
