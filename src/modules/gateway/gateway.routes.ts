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

const NGIJO_NUMBER_PATHS = new Set([
  "/data/tracker-inovasi/projek-aktif",
  "/data/tracker-inovasi/avg-trl",
  "/data/tracker-inovasi/paten-tertunda",
  "/data/tracker-inovasi/kolaborasi",
  "/data/keberlanjutan/energi-terbarukan",
  "/data/keberlanjutan/green-performance",
  "/data/keberlanjutan/air-daur-ulang",
  "/data/keberlanjutan/metrik-limbah",
]);

const NGIJO_TABLE_PATHS = new Set([
  "/data/penelitian/aktif",
  "/data/keberlanjutan/sensor-feed",
]);

const NGIJO_TIME_SERIES_PATHS = new Set([
  "/data/keberlanjutan/dinamika-energi",
]);

// Unified "Penelitian" naming exposed to the frontend maps to the real
// upstream Ngijo table path (/penelitian/aktif). The legacy "tracker-inovasi"
// table path is kept as a backward-compatible alias so old clients don't 404.
const NGIJO_PATH_REMAP: Record<string, string> = {
  "/data/penelitian": "/data/penelitian/aktif",
  "/data/tracker-inovasi": "/data/penelitian/aktif",
};

function remapNgijoPath(path: string) {
  return NGIJO_PATH_REMAP[path] ?? path;
}

function ngijoUnavailableFallback(path: string, error: unknown) {
  if (!(error instanceof GatewayError) || error.code !== 503) return null;

  const warning = error.warning || "Data Ngijo belum tersedia dari upstream.";
  if (NGIJO_NUMBER_PATHS.has(path)) {
    return { data: { typeName: "number", value: null }, warning };
  }
  if (NGIJO_TABLE_PATHS.has(path)) {
    return { data: { typeName: "table", items: [] }, warning };
  }
  if (NGIJO_TIME_SERIES_PATHS.has(path)) {
    return { data: { typeName: "timeSeries", value: [] }, warning };
  }

  return null;
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
      const kstIdentifier = parseKstIdentifier(req.params.kstIdentifier);
      const rawPath = `/${routeParam(req.params[0])}`;
      const targetPath = kstIdentifier === "ngijo" ? remapNgijoPath(rawPath) : rawPath;
      try {
        const result = await proxyGatewayRequest(req, kstIdentifier, targetPath, method.toUpperCase());
        return ok(res, result.response, result.status);
      } catch (error) {
        if (method === "get" && kstIdentifier === "ngijo") {
          const fallback = ngijoUnavailableFallback(targetPath, error);
          if (fallback) return ok(res, fallback);
        }

        return sendGatewayError(res, error);
      }
    }),
  );
}

export default router;
