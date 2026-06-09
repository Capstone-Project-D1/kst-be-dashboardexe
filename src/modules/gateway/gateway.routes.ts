import { Router } from "express";
import type { Request, Response } from "express";
import { authMiddleware } from "../../middlewares/auth.middleware.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { AppError, fail, ok } from "../../utils/response.js";
import { GatewayError } from "./gateway.client.js";
import { aggregateContracts, parseKstIdentifier, proxyGatewayRequest } from "./gateway.service.js";

const router = Router();
export const kstGatewayRoutes = Router();

router.use(authMiddleware);

function routeParam(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

function sendGatewayError(res: Response, error: unknown) {
  if (error instanceof GatewayError) {
    return fail(res, error.code, error.message);
  }
  if (error instanceof AppError) {
    return fail(res, error.code, error.message);
  }

  return fail(res, 500, error instanceof Error ? error.message : "Terjadi kesalahan pada gateway.");
}

router.get(
  "/gateway/:kst/health",
  asyncHandler(async (req, res) => {
    try {
      const kstIdentifier = parseKstIdentifier(req.params.kst);
      const result = await proxyGatewayRequest(req, kstIdentifier, "/health", "GET");
      return ok(res, result.response, result.status);
    } catch (error) {
      return sendGatewayError(res, error);
    }
  }),
);

router.get(
  "/gateway/:kst/contract",
  asyncHandler(async (req, res) => {
    try {
      const kstIdentifier = parseKstIdentifier(req.params.kst);
      const result = await proxyGatewayRequest(req, kstIdentifier, "/contract", "GET");
      return ok(res, result.response, result.status);
    } catch (error) {
      return sendGatewayError(res, error);
    }
  }),
);

for (const method of ["get", "post", "patch", "put"] as const) {
  router[method](
    "/gateway/:kst/data/*",
    asyncHandler(async (req, res) => {
      try {
        const kstIdentifier = parseKstIdentifier(req.params.kst);
        const dataPath = routeParam(req.params[0]);
        const result = await proxyGatewayRequest(req, kstIdentifier, `/data/${dataPath}`, method.toUpperCase());
        return ok(res, result.response, result.status);
      } catch (error) {
        return sendGatewayError(res, error);
      }
    }),
  );
}

router.post(
  "/gateway/:kst/query",
  asyncHandler(async (req, res) => {
    try {
      const kstIdentifier = parseKstIdentifier(req.params.kst);
      const result = await proxyGatewayRequest(req, kstIdentifier, "/query", "POST");
      return ok(res, result.response, result.status);
    } catch (error) {
      return sendGatewayError(res, error);
    }
  }),
);

router.get(
  "/contract",
  asyncHandler(async (req, res) => {
    try {
      const contracts = await aggregateContracts(req);
      return ok(res, contracts);
    } catch (error) {
      return sendGatewayError(res, error);
    }
  }),
);

for (const method of ["get", "post", "patch", "put", "delete"] as const) {
  kstGatewayRoutes[method](
    "/kst/:kstIdentifier/*",
    authMiddleware,
    asyncHandler(async (req: Request, res) => {
      try {
        const kstIdentifier = parseKstIdentifier(req.params.kstIdentifier);
        const targetPath = `/${routeParam(req.params[0])}`;
        const result = await proxyGatewayRequest(req, kstIdentifier, targetPath, method.toUpperCase());
        return ok(res, result.response, result.status);
      } catch (error) {
        return sendGatewayError(res, error);
      }
    }),
  );
}

export default router;
