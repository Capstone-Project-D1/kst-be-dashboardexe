import { logger } from "../../config/logger.js";
import { requestUpstream } from "../gateway/gateway.client.js";

type DataEnvelope = {
  data?: {
    value?: unknown;
    items?: unknown;
  };
};

type NgijoMetric = {
  key: string;
  path: string;
};

const NGIJO_NUMBERS: NgijoMetric[] = [
  { key: "totalProjects", path: "/tracker-inovasi/projek-aktif" },
  { key: "avgTrl", path: "/tracker-inovasi/avg-trl" },
  { key: "pendingPatents", path: "/tracker-inovasi/paten-tertunda" },
  { key: "totalMitra", path: "/tracker-inovasi/kolaborasi" },
  { key: "renewableEnergy", path: "/keberlanjutan/energi-terbarukan" },
  { key: "greenPerformance", path: "/keberlanjutan/green-performance" },
  { key: "recycledWater", path: "/keberlanjutan/air-daur-ulang" },
  { key: "wasteMetric", path: "/keberlanjutan/metrik-limbah" },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function dataEnvelope(payload: unknown): DataEnvelope | null {
  if (!isRecord(payload)) return null;
  if (isRecord(payload.response)) return dataEnvelope(payload.response);
  return payload;
}

export function parseNgijoNumber(payload: unknown): number | null {
  const value = dataEnvelope(payload)?.data?.value;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function parseNgijoTable(payload: unknown): unknown[] | null {
  const items = dataEnvelope(payload)?.data?.items;
  return Array.isArray(items) ? items : null;
}

export function parseNgijoTimeSeries(payload: unknown): unknown[] | null {
  const value = dataEnvelope(payload)?.data?.value;
  return Array.isArray(value) ? value : null;
}

export async function fetchNgijoHealth() {
  const result = await requestUpstream({
    kstIdentifier: "ngijo",
    method: "GET",
    path: "/health",
  });
  return result.response;
}

export async function fetchNgijoContract() {
  const result = await requestUpstream({
    kstIdentifier: "ngijo",
    method: "GET",
    path: "/contract",
  });
  return result.response;
}

export async function fetchNgijoNumber(path: string): Promise<number | null> {
  const result = await requestUpstream({
    kstIdentifier: "ngijo",
    method: "GET",
    path: `/data${path}`,
  });
  return parseNgijoNumber(result.response);
}

export async function fetchNgijoTable(path: string, queryString = ""): Promise<unknown[] | null> {
  const result = await requestUpstream({
    kstIdentifier: "ngijo",
    method: "GET",
    path: `/data${path}`,
    queryString,
  });
  return parseNgijoTable(result.response);
}

export async function fetchNgijoTimeSeries(path: string, queryString = ""): Promise<unknown[] | null> {
  const result = await requestUpstream({
    kstIdentifier: "ngijo",
    method: "GET",
    path: `/data${path}`,
    queryString,
  });
  return parseNgijoTimeSeries(result.response);
}

async function nullableMetric(metric: NgijoMetric): Promise<[string, number | null]> {
  try {
    return [metric.key, await fetchNgijoNumber(metric.path)];
  } catch (error) {
    logger.warn({ error, path: metric.path }, "Ngijo dashboard metric fetch failed");
    return [metric.key, null];
  }
}

export async function getNgijoDashboardSummary() {
  await fetchNgijoHealth();

  const metricEntries = await Promise.all(NGIJO_NUMBERS.map(nullableMetric));
  const metrics = Object.fromEntries(metricEntries) as Record<string, number | null>;

  return {
    totalVisitors: null,
    todayVisitors: null,
    weekVisitors: null,
    totalProduction: metrics.totalProjects,
    totalProjects: metrics.totalProjects,
    activeResearchProjects: metrics.totalProjects,
    activeOperations: null,
    greenPerformance: metrics.greenPerformance,
    totalMitra: metrics.totalMitra,
    totalPartners: metrics.totalMitra,
    avgTrl: metrics.avgTrl,
    pendingPatents: metrics.pendingPatents,
    renewableEnergy: metrics.renewableEnergy,
    recycledWater: metrics.recycledWater,
    wasteMetric: metrics.wasteMetric,
    _unavailableFields: {
      totalVisitors: "Endpoint pengunjung Ngijo belum tersedia.",
      todayVisitors: "Endpoint pengunjung Ngijo belum tersedia.",
      weekVisitors: "Endpoint pengunjung Ngijo belum tersedia.",
      activeOperations: "Endpoint operasional aktif Ngijo belum tersedia.",
    },
  };
}
