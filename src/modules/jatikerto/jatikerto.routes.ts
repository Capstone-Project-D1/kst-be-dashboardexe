import { Router } from "express";
import type { Response } from "express";
import { authMiddleware } from "../../middlewares/auth.middleware.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { AppError, fail, ok } from "../../utils/response.js";
import { GatewayError } from "../gateway/gateway.client.js";
import { proxyJatikertoRequest } from "./jatikerto.service.js";

const router = Router();

router.use((_req, res, next) => {
  res.setHeader("X-KST-Data-Source", "jatikerto-api");
  next();
});

function routeParam(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

function sendJatikertoError(res: Response, error: unknown) {
  if (error instanceof GatewayError) return fail(res, error.code, error.message);
  if (error instanceof AppError) return fail(res, error.code, error.message);
  return fail(res, 500, error instanceof Error ? error.message : "Terjadi kesalahan pada adapter Jatikerto.");
}

router.use(authMiddleware);

for (const method of ["get", "post", "patch", "put", "delete"] as const) {
  router[method](
    "/*",
    asyncHandler(async (req, res) => {
      try {
        const targetPath = `/${routeParam(req.params[0])}`;
        const result = await proxyJatikertoRequest(req, targetPath, method.toUpperCase());
        return ok(res, result.response, result.status);
      } catch (error) {
        return sendJatikertoError(res, error);
      }
    }),
  );
}

export default router;
