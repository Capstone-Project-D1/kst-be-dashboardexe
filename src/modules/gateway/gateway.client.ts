import type { KstIdentifier } from "@prisma/client";
import { logger } from "../../config/logger.js";
import { getUpstreamConfig, upstreamTimeoutMs } from "./upstream.config.js";

export type GatewayRequestOptions = {
  kstIdentifier: KstIdentifier;
  method: string;
  path: string;
  queryString?: string;
  headers?: Record<string, string>;
  body?: unknown;
};

export type GatewayResult = {
  status: number;
  payload: unknown;
  response: unknown;
};

export class GatewayError extends Error {
  constructor(
    public code: number,
    message: string,
    public warning: string,
    public details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

function joinUrl(baseUrl: string, path: string, queryString = "") {
  const base = baseUrl.replace(/\/+$/, "");
  const cleanPath = path.trim() ? `/${path.replace(/^\/+/, "")}` : "";
  return `${base}${cleanPath}${queryString}`;
}

function isStandardResponse(payload: unknown): payload is { response: unknown } {
  return Boolean(payload && typeof payload === "object" && "response" in payload);
}

function standardResponse(payload: unknown) {
  return isStandardResponse(payload) ? payload.response : payload;
}

async function parseUpstreamResponse(response: Response) {
  const text = await response.text();
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function upstreamErrorMessage(kstIdentifier: KstIdentifier, payload: unknown, status: number) {
  if (payload && typeof payload === "object" && "error" in payload) {
    const error = (payload as { error?: { message?: unknown } }).error;
    if (error?.message) return String(error.message);
  }

  return `API KST ${kstIdentifier} mengembalikan status ${status}.`;
}

export async function requestUpstream(options: GatewayRequestOptions): Promise<GatewayResult> {
  const upstream = getUpstreamConfig(options.kstIdentifier);
  if (!upstream.baseUrl) {
    throw new GatewayError(
      503,
      `Base URL backend KST ${options.kstIdentifier} belum dikonfigurasi.`,
      `Backend KST ${options.kstIdentifier} belum dikonfigurasi di ${upstream.envName}.`,
      { kstIdentifier: options.kstIdentifier, envName: upstream.envName },
    );
  }

  const method = options.method.toUpperCase();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), upstreamTimeoutMs);
  const headers = { ...(options.headers ?? {}) };
  const init: RequestInit = { method, headers, signal: controller.signal };

  if (!["GET", "HEAD"].includes(method)) {
    headers["Content-Type"] ??= "application/json";
    init.body = typeof options.body === "string" ? options.body : JSON.stringify(options.body ?? {});
  }

  const url = joinUrl(upstream.baseUrl, options.path, options.queryString);

  try {
    const response = await fetch(url, init);
    const payload = await parseUpstreamResponse(response);

    if (!response.ok) {
      const message = upstreamErrorMessage(options.kstIdentifier, payload, response.status);
      throw new GatewayError(
        response.status >= 500 ? 503 : response.status,
        message,
        `Backend KST ${options.kstIdentifier} gagal merespons request.`,
        { kstIdentifier: options.kstIdentifier, upstreamStatus: response.status, path: options.path },
      );
    }

    return {
      status: response.status,
      payload,
      response: standardResponse(payload),
    };
  } catch (error) {
    if (error instanceof GatewayError) throw error;

    const isTimeout = error instanceof Error && error.name === "AbortError";
    const message = isTimeout
      ? `API KST ${options.kstIdentifier} timeout setelah ${upstreamTimeoutMs}ms.`
      : `API KST ${options.kstIdentifier} tidak bisa dihubungi.`;

    logger.error(
      { error, kstIdentifier: options.kstIdentifier, path: options.path, method },
      "Upstream KST request failed",
    );

    throw new GatewayError(
      503,
      message,
      isTimeout
        ? `Backend KST ${options.kstIdentifier} timeout.`
        : `Backend KST ${options.kstIdentifier} sedang tidak tersedia.`,
      { kstIdentifier: options.kstIdentifier, path: options.path, timeoutMs: upstreamTimeoutMs },
    );
  } finally {
    clearTimeout(timeout);
  }
}
