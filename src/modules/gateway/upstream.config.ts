import type { KstIdentifier } from "@prisma/client";
import { env } from "../../config/env.js";

export const KST_IDENTIFIERS: KstIdentifier[] = ["ngijo", "cangar", "jatikerto"];

export type UpstreamConfig = {
  kstIdentifier: KstIdentifier;
  upstreamIdentifier: string;
  envName: "NGIJO_API_BASE_URL" | "CANGAR_API_BASE_URL" | "JATIKERTO_API_BASE_URL";
  baseUrl: string | null;
  jwtSecret?: string;
  jwtIssuer?: string;
  jwtAudience?: string;
  rewriteAuthorization?: boolean;
  forwardAuthorization?: boolean;
};

export const upstreamTimeoutMs = env.UPSTREAM_TIMEOUT_MS;

export const upstreamServices: Record<KstIdentifier, UpstreamConfig> = {
  ngijo: {
    kstIdentifier: "ngijo",
    upstreamIdentifier: "kst_ngijo",
    envName: "NGIJO_API_BASE_URL",
    baseUrl: env.NGIJO_API_BASE_URL || null,
    forwardAuthorization: false,
  },
  cangar: {
    kstIdentifier: "cangar",
    upstreamIdentifier: "cangar",
    envName: "CANGAR_API_BASE_URL",
    baseUrl: env.CANGAR_API_BASE_URL || null,
  },
  jatikerto: {
    kstIdentifier: "jatikerto",
    upstreamIdentifier: "kst_jatikerto",
    envName: "JATIKERTO_API_BASE_URL",
    baseUrl: env.JATIKERTO_API_BASE_URL || null,
    jwtSecret: env.JATIKERTO_JWT_SECRET || env.JWT_ACCESS_SECRET,
    jwtIssuer: "stp-ub-system",
    jwtAudience: "kst-dashboard",
    rewriteAuthorization: true,
  },
};

export function getUpstreamConfig(kstIdentifier: KstIdentifier) {
  return upstreamServices[kstIdentifier];
}
