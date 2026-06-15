import type { KstIdentifier } from "@prisma/client";
import type { Request } from "express";
import jwt from "jsonwebtoken";
import { logger } from "../../config/logger.js";
import type { AuthUser } from "../../types/domain.js";
import { canAccessKst } from "../../utils/rbac.js";
import { AppError } from "../../utils/response.js";
import { getCangarDashboardPath, getExecutiveDashboardSummary } from "../cangar/cangarWp.service.js";
import { getJatikertoDashboardSummary } from "../jatikerto/jatikerto.service.js";
import { GatewayError, requestUpstream, type GatewayResult } from "./gateway.client.js";
import { getUpstreamConfig, KST_IDENTIFIERS } from "./upstream.config.js";

type ContractResponse = {
  kstIdentifier: KstIdentifier;
  version: string;
  contract: unknown[];
  warning?: string;
};

type DashboardSource = {
  kstIdentifier: KstIdentifier;
  data: any;
  warning?: string;
  unavailable?: boolean;
};

type SourceStatus = {
  status: "success" | "unavailable" | "error";
  data?: any;
  message?: string;
};

type SourcesMap = Record<string, SourceStatus>;

export function parseKstIdentifier(value: string | string[] | undefined): KstIdentifier {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (candidate === "ngijo" || candidate === "cangar" || candidate === "jatikerto") {
    return candidate;
  }
  throw new AppError(404, "KST tidak terdaftar.");
}

export function queryStringFromRequest(req: Request) {
  const index = req.originalUrl.indexOf("?");
  return index >= 0 ? req.originalUrl.slice(index) : "";
}

type GatewayAuthUser = AuthUser & {
  iat?: number;
  exp?: number;
};

function upstreamRoleForUser(user: AuthUser, kstIdentifier: KstIdentifier) {
  if (!canAccessKst(user, kstIdentifier)) return null;
  if (user.activeRole === "manajemen") return "viewer";
  return "admin";
}

function upstreamAuthorization(req: Request, kstIdentifier: KstIdentifier) {
  const authorization = req.header("authorization");
  const upstream = getUpstreamConfig(kstIdentifier);
  if (!authorization || !upstream.rewriteAuthorization) return authorization;

  const user = req.user as GatewayAuthUser;
  const upstreamRole = upstreamRoleForUser(user, kstIdentifier);
  if (!upstreamRole) return authorization;

  const payload: Record<string, unknown> = {
    sub: user.sub,
    userid: user.sub,
    username: user.username,
    email: user.email,
    name: user.name,
    roles: { [upstream.upstreamIdentifier]: [upstreamRole] },
    pictureUri: user.pictureUri ?? null,
  };

  if (user.iat) payload.iat = user.iat;
  if (user.exp) payload.exp = user.exp;

  return `Bearer ${jwt.sign(payload, upstream.jwtSecret!, {
    ...(upstream.jwtIssuer ? { issuer: upstream.jwtIssuer } : {}),
    ...(upstream.jwtAudience ? { audience: upstream.jwtAudience } : {}),
  })}`;
}

export function forwardHeaders(req: Request, kstIdentifier: KstIdentifier) {
  const headers: Record<string, string> = {};
  const authorization = upstreamAuthorization(req, kstIdentifier);
  const contentType = req.header("content-type");

  if (authorization) headers.Authorization = authorization;
  if (contentType) headers["Content-Type"] = contentType;

  return headers;
}

function allowedKstForUser(user: AuthUser) {
  return KST_IDENTIFIERS.filter((kstIdentifier) => canAccessKst(user, kstIdentifier));
}

export function assertGatewayAccess(req: Request, kstIdentifier: KstIdentifier, method: string) {
  const user = req.user!;
  if (!canAccessKst(user, kstIdentifier)) throw new AppError(403, "Tidak memiliki akses ke KST ini.");
  if (user.activeRole === "manajemen" && !["GET", "HEAD"].includes(method.toUpperCase())) {
    throw new AppError(403, "Role manajemen hanya boleh melihat data.");
  }
}

export async function proxyGatewayRequest(
  req: Request,
  kstIdentifier: KstIdentifier,
  path: string,
  method = req.method,
): Promise<GatewayResult> {
  assertGatewayAccess(req, kstIdentifier, method);
  return requestUpstream({
    kstIdentifier,
    method,
    path,
    queryString: queryStringFromRequest(req),
    headers: forwardHeaders(req, kstIdentifier),
    body: req.body,
  });
}

function allowedOperationsForRole(role: string, operations: string[]) {
  if (role === "super_admin") return operations;
  if (role === "manajemen") return operations.filter((operation) => operation === "read");
  return operations.filter((operation) => ["read", "write", "delete"].includes(operation));
}

function filterContractOperations(node: any, role: string): any {
  if (Array.isArray(node)) return node.map((item) => filterContractOperations(item, role));
  if (!node || typeof node !== "object") return node;
  if (Array.isArray(node.operations)) {
    return { ...node, operations: allowedOperationsForRole(role, node.operations) };
  }
  if (Array.isArray(node.items)) {
    return { ...node, items: node.items.map((item: any) => filterContractOperations(item, role)) };
  }
  return node;
}

function contractPayload(kstIdentifier: KstIdentifier, payload: unknown, role: string): ContractResponse {
  const body =
    typeof payload === "object" && payload && "response" in payload
      ? (payload as { response: unknown }).response
      : payload;

  if (typeof body === "object" && body && !Array.isArray(body)) {
    const contractBody = body as { version?: unknown; contract?: unknown };
    const contract = Array.isArray(contractBody.contract) ? contractBody.contract : [];
    return {
      kstIdentifier,
      version: String(contractBody.version ?? "unknown"),
      contract: filterContractOperations(contract, role),
    };
  }

  const contract = Array.isArray(body) ? body : [];
  return {
    kstIdentifier,
    version: "unknown",
    contract: filterContractOperations(contract, role),
  };
}

export async function aggregateContracts(req: Request, queryStringOverride?: string): Promise<ContractResponse[]> {
  const kstIdentifiers = allowedKstForUser(req.user!);
  const results = await Promise.all(
    kstIdentifiers.map(async (kstIdentifier) => {
      try {
        const result = await requestUpstream({
          kstIdentifier,
          method: "GET",
          path: "/contract",
          queryString: queryStringOverride ?? queryStringFromRequest(req),
          headers: forwardHeaders(req, kstIdentifier),
        });
        return contractPayload(kstIdentifier, result.payload, req.user!.activeRole);
      } catch (error) {
        const warning =
          error instanceof GatewayError
            ? error.warning
            : `Contract KST ${kstIdentifier} belum tersedia.`;
        logger.warn({ error, kstIdentifier }, "KST contract fetch failed");
        return { kstIdentifier, version: "unknown", contract: [], warning };
      }
    }),
  );

  return results;
}

async function fetchDashboardSource(req: Request, kstIdentifier: KstIdentifier, path: string) {
  // ── Cangar adapter (summary) ─────────────────────────────────────────
  if (kstIdentifier === "cangar" && path === "/dashboard/summary") {
    try {
      const data = await getExecutiveDashboardSummary(req.query);
      return { kstIdentifier, data } satisfies DashboardSource;
    } catch (error) {
      logger.warn({ error, kstIdentifier, path }, "Cangar WordPress dashboard summary fetch failed");
      return {
        kstIdentifier,
        data: null,
        warning: "Dashboard KST cangar dari WordPress belum tersedia.",
      } satisfies DashboardSource;
    }
  }

  // ── Cangar adapter (other dashboard paths) ──────────────────────────
  if (kstIdentifier === "cangar") {
    try {
      const data = await getCangarDashboardPath(path, req.query);
      return { kstIdentifier, data } satisfies DashboardSource;
    } catch (error) {
      logger.warn({ error, kstIdentifier, path }, "Cangar WordPress dashboard fetch failed");
      return {
        kstIdentifier,
        data: null,
        warning: "Dashboard KST cangar dari WordPress belum tersedia.",
      } satisfies DashboardSource;
    }
  }

  // ── Jatikerto adapter (summary & collaboration) ─────────────────────
  // Upstream Jatikerto does not expose /dashboard/summary.
  // Aggregate from the 6 data-level endpoints instead.
  if (kstIdentifier === "jatikerto" && path === "/dashboard/summary") {
    try {
      const data = await getJatikertoDashboardSummary(req);
      return { kstIdentifier, data } satisfies DashboardSource;
    } catch (error) {
      logger.warn({ error, kstIdentifier, path }, "Jatikerto dashboard summary aggregation failed");
      return {
        kstIdentifier,
        data: null,
        warning: "Dashboard KST jatikerto: gagal mengagregasi data dari upstream.",
      } satisfies DashboardSource;
    }
  }

  if (kstIdentifier === "jatikerto" && path === "/dashboard/collaboration") {
    return {
      kstIdentifier,
      data: null,
      warning: "Tren 6 bulan untuk Jatikerto belum tersedia karena tidak ada field tanggal kemitraan.",
      unavailable: true,
    } satisfies DashboardSource;
  }

  // ── Generic upstream pass-through ───────────────────────────────────
  // Check if baseUrl is configured; if not, mark as unavailable
  const upstreamCfg = getUpstreamConfig(kstIdentifier);
  if (!upstreamCfg.baseUrl) {
    logger.info({ kstIdentifier, path }, "KST upstream not configured, marking unavailable");
    return {
      kstIdentifier,
      data: null,
      warning: `Backend KST ${kstIdentifier} belum dikonfigurasi.`,
      unavailable: true,
    } satisfies DashboardSource;
  }

  try {
    const result = await requestUpstream({
      kstIdentifier,
      method: "GET",
      path,
      queryString: queryStringFromRequest(req),
      headers: forwardHeaders(req, kstIdentifier),
    });
    if (result.response === null || typeof result.response !== "object") {
      logger.warn({ kstIdentifier, path, response: result.response }, "KST dashboard response schema mismatch");
      return {
        kstIdentifier,
        data: null,
        warning: `Dashboard KST ${kstIdentifier} mengembalikan format response yang tidak sesuai.`,
      } satisfies DashboardSource;
    }
    return { kstIdentifier, data: result.response } satisfies DashboardSource;
  } catch (error) {
    const isUnavailable =
      error instanceof GatewayError && error.code === 503 &&
      error.message.includes("belum dikonfigurasi");
    const warning =
      error instanceof GatewayError
        ? error.warning
        : `Dashboard KST ${kstIdentifier} belum tersedia.`;
    logger.warn({ error, kstIdentifier, path }, "KST dashboard fetch failed");
    return {
      kstIdentifier,
      data: null,
      warning,
      unavailable: isUnavailable,
    } satisfies DashboardSource;
  }
}

async function dashboardSources(req: Request, path: string) {
  const kstIdentifiers = allowedKstForUser(req.user!);
  return Promise.all(kstIdentifiers.map((kstIdentifier) => fetchDashboardSource(req, kstIdentifier, path)));
}

function buildSourcesMap(sources: DashboardSource[]): SourcesMap {
  const map: SourcesMap = {};
  for (const source of sources) {
    if (source.data) {
      map[source.kstIdentifier] = { status: "success", data: source.data };
    } else if (source.unavailable) {
      map[source.kstIdentifier] = { status: "unavailable", message: "Belum terintegrasi" };
    } else {
      map[source.kstIdentifier] = {
        status: "error",
        message: source.warning ?? `Dashboard KST ${source.kstIdentifier} belum tersedia.`,
      };
    }
  }

  // Ensure all 3 KSTs are always present in the map
  for (const kst of KST_IDENTIFIERS) {
    if (!map[kst]) {
      map[kst] = { status: "unavailable", message: "Belum terintegrasi" };
    }
  }

  return map;
}

function numberValue(source: DashboardSource, key: string) {
  const value = source.data?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/**
 * Sum numeric values across sources, returning null if ALL sources have
 * null/undefined for the given key. This prevents null fields from
 * being silently coerced to 0.
 */
function nullableSum(sources: DashboardSource[], key: string): number | null {
  let total = 0;
  let hasAny = false;
  for (const source of sources) {
    const value = source.data?.[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      total += value;
      hasAny = true;
    }
  }
  return hasAny ? total : null;
}

/**
 * Average numeric values across sources, returning null if ALL sources
 * have null/undefined for the given key.
 */
function nullableAverage(sources: DashboardSource[], key: string): number | null {
  const values = sources
    .map((source) => source.data?.[key])
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (values.length === 0) return null;
  return Math.round((values.reduce((total, value) => total + value, 0) / values.length) * 100) / 100;
}

/**
 * Collect productionMetadata from any source that provides
 * a productionMetricType (e.g. Jatikerto "row_count").
 */
function collectProductionMetadata(sources: DashboardSource[]) {
  const metadata: Record<string, { metricType: string; message: string }> = {};
  for (const source of sources) {
    const metricType = source.data?.productionMetricType;
    const message = source.data?.productionMessage;
    if (typeof metricType === "string") {
      metadata[source.kstIdentifier] = {
        metricType,
        message: typeof message === "string" ? message : "",
      };
    }
  }
  return Object.keys(metadata).length > 0 ? metadata : undefined;
}

export async function aggregateDashboardSummary(req: Request) {
  const sources = await dashboardSources(req, "/dashboard/summary");
  const sourcesMap = buildSourcesMap(sources);
  const warnings = sources.flatMap((source) => (source.warning ? [source.warning] : []));
  const contracts = sources.some((source) => source.data)
    ? []
    : await aggregateContracts(req, "");

  return {
    // ── Visitors: null-aware — null means "no data source", not 0 ────
    totalVisitors: nullableSum(sources, "totalVisitors"),
    todayVisitors: nullableSum(sources, "todayVisitors"),
    weekVisitors: nullableSum(sources, "weekVisitors"),

    // ── KST status: from source.status, not truthy source.data ──────
    activeKst: Object.values(sourcesMap).filter((s) => s.status === "success").length,
    totalKst: allowedKstForUser(req.user!).length,

    // ── Production: sum with metadata ───────────────────────────────
    totalProduction: nullableSum(sources, "totalProduction"),
    productionMetadata: collectProductionMetadata(sources),

    // ── Operations: null-aware ──────────────────────────────────────
    activeOperations: nullableSum(sources, "activeOperations"),

    // ── Sustainability: null-aware average ──────────────────────────
    greenPerformance: nullableAverage(sources, "greenPerformance"),

    totalContracts: contracts.reduce((total, item) => total + item.contract.length, 0),
    totalMitra: sources.reduce((total, source) => total + numberValue(source, "totalMitra"), 0),
    totalPartners: sources.reduce((total, source) => total + numberValue(source, "totalPartners"), 0),
    message: sources.some((source) => source.data) ? undefined : "Data dashboard belum tersedia.",
    sources: sourcesMap,
    warnings,
  };
}

function mergeTimeSeries(sources: DashboardSource[]) {
  return sources.flatMap((source) => {
    const value = source.data?.typeName === "timeSeries" ? source.data.value : source.data?.value;
    if (!Array.isArray(value)) return [];
    return value.map((item) =>
      item && typeof item === "object" ? { ...item, kstIdentifier: source.kstIdentifier } : item,
    );
  });
}

export async function aggregateDashboardTimeSeries(req: Request, path: string) {
  const sources = await dashboardSources(req, path);
  const value = mergeTimeSeries(sources);

  return {
    typeName: "timeSeries",
    value,
    message: value.length > 0 ? undefined : "Data belum tersedia.",
    sources: buildSourcesMap(sources),
    warnings: sources.flatMap((source) => (source.warning ? [source.warning] : [])),
  };
}
