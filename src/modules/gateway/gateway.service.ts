import type { KstIdentifier } from "@prisma/client";
import type { Request } from "express";
import { logger } from "../../config/logger.js";
import type { AuthUser } from "../../types/domain.js";
import { canAccessKst } from "../../utils/rbac.js";
import { AppError } from "../../utils/response.js";
import { GatewayError, requestUpstream, type GatewayResult } from "./gateway.client.js";
import { KST_IDENTIFIERS } from "./upstream.config.js";

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
};

export function parseKstIdentifier(value: string | string[] | undefined): KstIdentifier {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (candidate === "ngijo" || candidate === "cangar" || candidate === "jatikerto") {
    return candidate;
  }
  throw new AppError(404, "KST tidak terdaftar.");
}

function queryString(req: Request) {
  const index = req.originalUrl.indexOf("?");
  return index >= 0 ? req.originalUrl.slice(index) : "";
}

function forwardHeaders(req: Request) {
  const headers: Record<string, string> = {};
  const authorization = req.header("authorization");
  const contentType = req.header("content-type");

  if (authorization) headers.Authorization = authorization;
  if (contentType) headers["Content-Type"] = contentType;

  return headers;
}

function allowedKstForUser(user: AuthUser) {
  return KST_IDENTIFIERS.filter((kstIdentifier) => canAccessKst(user, kstIdentifier));
}

function assertGatewayAccess(req: Request, kstIdentifier: KstIdentifier, method: string) {
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
    queryString: queryString(req),
    headers: forwardHeaders(req),
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
          queryString: queryStringOverride ?? queryString(req),
          headers: forwardHeaders(req),
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
  try {
    const result = await requestUpstream({
      kstIdentifier,
      method: "GET",
      path,
      queryString: queryString(req),
      headers: forwardHeaders(req),
    });
    return { kstIdentifier, data: result.response } satisfies DashboardSource;
  } catch (error) {
    const warning =
      error instanceof GatewayError
        ? error.warning
        : `Dashboard KST ${kstIdentifier} belum tersedia.`;
    logger.warn({ error, kstIdentifier, path }, "KST dashboard fetch failed");
    return { kstIdentifier, data: null, warning } satisfies DashboardSource;
  }
}

async function dashboardSources(req: Request, path: string) {
  const kstIdentifiers = allowedKstForUser(req.user!);
  return Promise.all(kstIdentifiers.map((kstIdentifier) => fetchDashboardSource(req, kstIdentifier, path)));
}

function numberValue(source: DashboardSource, key: string) {
  const value = source.data?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function averageValue(sources: DashboardSource[], key: string) {
  const values = sources
    .map((source) => source.data?.[key])
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (values.length === 0) return 0;
  return Math.round((values.reduce((total, value) => total + value, 0) / values.length) * 100) / 100;
}

export async function aggregateDashboardSummary(req: Request) {
  const sources = await dashboardSources(req, "/dashboard/summary");
  const warnings = sources.flatMap((source) => (source.warning ? [source.warning] : []));
  const contracts = sources.some((source) => source.data)
    ? []
    : await aggregateContracts(req, "");

  return {
    totalVisitors: sources.reduce((total, source) => total + numberValue(source, "totalVisitors"), 0),
    todayVisitors: sources.reduce((total, source) => total + numberValue(source, "todayVisitors"), 0),
    weekVisitors: sources.reduce((total, source) => total + numberValue(source, "weekVisitors"), 0),
    activeKst: sources.filter((source) => source.data).length,
    totalKst: allowedKstForUser(req.user!).length,
    totalProduction: sources.reduce((total, source) => total + numberValue(source, "totalProduction"), 0),
    activeOperations: sources.reduce((total, source) => total + numberValue(source, "activeOperations"), 0),
    greenPerformance: averageValue(sources, "greenPerformance"),
    totalContracts: contracts.reduce((total, item) => total + item.contract.length, 0),
    message: sources.some((source) => source.data) ? undefined : "Data dashboard belum tersedia.",
    sources,
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
    sources,
    warnings: sources.flatMap((source) => (source.warning ? [source.warning] : [])),
  };
}
