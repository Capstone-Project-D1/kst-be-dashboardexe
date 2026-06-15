import type { Request } from "express";
import { logger } from "../../config/logger.js";
import {
  assertGatewayAccess,
  forwardHeaders,
  queryStringFromRequest,
} from "../gateway/gateway.service.js";
import { requestJatikerto } from "./jatikerto.client.js";

export const jatikertoUpstreamDataEndpoints = [
  "/data/pertanian/items",
  "/data/peternakan/items",
  "/data/kemitraan/items",
  "/data/akademik/items",
  "/data/konservasi/hewan",
  "/data/konservasi/tanaman",
];

export function proxyJatikertoRequest(req: Request, path: string, method = req.method) {
  assertGatewayAccess(req, "jatikerto", method);
  return requestJatikerto({
    method,
    path,
    queryString: queryStringFromRequest(req),
    headers: forwardHeaders(req, "jatikerto"),
    body: req.body,
  });
}

/* ---------------------------------------------------------------------------
 * Dashboard summary adapter for Jatikerto.
 *
 * Upstream Jatikerto does NOT expose a /dashboard/summary endpoint.
 * Instead we call the 6 data endpoints in parallel and derive the
 * aggregate metrics the FE expects.
 * -------------------------------------------------------------------------*/

function extractItemCount(payload: unknown): number {
  if (Array.isArray(payload)) return payload.length;
  if (payload && typeof payload === "object") {
    const p = payload as Record<string, unknown>;

    // Try explicit count / total fields first
    for (const key of ["total", "count", "totalItems", "total_items"]) {
      const v = p[key];
      if (typeof v === "number" && Number.isFinite(v)) return v;
    }

    // Unwrap standard response wrapper { response: ... }
    if ("response" in p) return extractItemCount(p.response);

    // Try common array wrapper keys
    for (const key of ["items", "data", "rows", "records", "value"]) {
      if (Array.isArray(p[key])) return (p[key] as unknown[]).length;
    }
  }
  return 0;
}

type EndpointResult = { path: string; count: number; ok: boolean };

async function fetchEndpoint(
  req: Request,
  path: string,
): Promise<EndpointResult> {
  try {
    const result = await requestJatikerto({
      method: "GET",
      path,
      queryString: queryStringFromRequest(req),
      headers: forwardHeaders(req, "jatikerto"),
    });
    return { path, count: extractItemCount(result.payload), ok: true };
  } catch (error) {
    logger.warn({ error, path }, "Jatikerto dashboard sub-fetch failed");
    return { path, count: 0, ok: false };
  }
}

export async function getJatikertoDashboardSummary(req: Request) {
  const results = await Promise.allSettled(
    jatikertoUpstreamDataEndpoints.map((path) => fetchEndpoint(req, path)),
  );

  const settled = results.map((r) =>
    r.status === "fulfilled" ? r.value : { path: "", count: 0, ok: false },
  );

  const successCount = settled.filter((r) => r.ok).length;
  if (successCount === 0) {
    throw new Error("Semua endpoint data Jatikerto gagal dihubungi.");
  }

  const countOf = (path: string) =>
    settled.find((r) => r.path === path)?.count ?? 0;

  const pertanian = countOf("/data/pertanian/items");
  const peternakan = countOf("/data/peternakan/items");
  const kemitraan = countOf("/data/kemitraan/items");

  return {
    // ── Visitors: null — Jatikerto has no visitor/reservation endpoint ──
    totalVisitors: null,
    todayVisitors: null,
    weekVisitors: null,

    // ── Production: row count with metadata ─────────────────────────────
    totalProduction: pertanian + peternakan,
    productionMetricType: "row_count" as const,
    productionMessage: "Dihitung dari jumlah entri pertanian dan peternakan.",

    // ── Operations: null — no operational-status field exists ────────────
    activeOperations: null,

    // ── Sustainability: null — no official sustainability indicator ──────
    greenPerformance: null,

    // ── Partnerships: from /data/kemitraan/items ✓ ──────────────────────
    totalMitra: kemitraan,
    totalPartners: kemitraan,

    // ── Metadata: documents why fields are null ─────────────────────────
    _unavailableFields: {
      totalVisitors: "Endpoint pengunjung/reservasi Jatikerto belum tersedia.",
      todayVisitors: "Endpoint pengunjung/reservasi Jatikerto belum tersedia.",
      weekVisitors: "Endpoint pengunjung/reservasi Jatikerto belum tersedia.",
      activeOperations: "Tidak ada field status operasional aktif di upstream Jatikerto.",
      greenPerformance: "Indikator sustainability resmi belum tersedia.",
    },
  };
}
