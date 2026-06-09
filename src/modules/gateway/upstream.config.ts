import type { KstIdentifier } from "@prisma/client";
import { env } from "../../config/env.js";

export const KST_IDENTIFIERS: KstIdentifier[] = ["ngijo", "cangar", "jatikerto"];

export type UpstreamConfig = {
  kstIdentifier: KstIdentifier;
  envName: "NGIJO_API_BASE_URL" | "CANGAR_API_BASE_URL" | "JATIKERTO_API_BASE_URL";
  baseUrl: string | null;
};

export const upstreamTimeoutMs = env.UPSTREAM_TIMEOUT_MS;

export const upstreamServices: Record<KstIdentifier, UpstreamConfig> = {
  ngijo: {
    kstIdentifier: "ngijo",
    envName: "NGIJO_API_BASE_URL",
    baseUrl: env.NGIJO_API_BASE_URL || null,
  },
  cangar: {
    kstIdentifier: "cangar",
    envName: "CANGAR_API_BASE_URL",
    baseUrl: env.CANGAR_API_BASE_URL || null,
  },
  jatikerto: {
    kstIdentifier: "jatikerto",
    envName: "JATIKERTO_API_BASE_URL",
    baseUrl: env.JATIKERTO_API_BASE_URL || null,
  },
};

export function getUpstreamConfig(kstIdentifier: KstIdentifier) {
  return upstreamServices[kstIdentifier];
}
