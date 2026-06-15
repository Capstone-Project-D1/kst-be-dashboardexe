import { env } from "../../config/env.js";
import { logger } from "../../config/logger.js";

export type CangarRequestOptions = {
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  queryString?: string;
  skipAuth?: boolean;
};

export type CangarResult = {
  status: number;
  payload: unknown;
  response: unknown;
};

export class CangarWpError extends Error {
  constructor(
    public code: number,
    message: string,
    public details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

let cachedAccessToken: string | null = null;
let loginPromise: Promise<string> | null = null;

function baseUrl() {
  const url = env.CANGAR_API_BASE_URL.trim();
  if (!url) {
    throw new CangarWpError(503, "Base URL API Cangar belum dikonfigurasi.", {
      envName: "CANGAR_API_BASE_URL",
    });
  }
  return url.replace(/\/+$/, "");
}

function joinUrl(path: string, queryString = "") {
  const cleanPath = path.trim() ? `/${path.replace(/^\/+/, "")}` : "";
  return `${baseUrl()}${cleanPath}${queryString}`;
}

function isStandardResponse(payload: unknown): payload is { response: unknown } {
  return Boolean(payload && typeof payload === "object" && "response" in payload);
}

function standardResponse(payload: unknown) {
  return isStandardResponse(payload) ? payload.response : payload;
}

async function parseJsonResponse(response: Response) {
  const text = await response.text();
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function objectValue(payload: unknown, key: string) {
  if (!payload || typeof payload !== "object") return undefined;
  return (payload as Record<string, unknown>)[key];
}

function findAccessToken(payload: unknown): string | null {
  const candidates = [
    objectValue(payload, "accessToken"),
    objectValue(payload, "access_token"),
    objectValue(payload, "token"),
    objectValue(payload, "jwt"),
    objectValue(objectValue(payload, "response"), "accessToken"),
    objectValue(objectValue(payload, "response"), "access_token"),
    objectValue(objectValue(payload, "response"), "token"),
    objectValue(objectValue(payload, "response"), "jwt"),
    objectValue(objectValue(payload, "data"), "accessToken"),
    objectValue(objectValue(payload, "data"), "access_token"),
    objectValue(objectValue(payload, "data"), "token"),
    objectValue(objectValue(payload, "data"), "jwt"),
    objectValue(objectValue(objectValue(payload, "response"), "data"), "accessToken"),
    objectValue(objectValue(objectValue(payload, "response"), "data"), "access_token"),
    objectValue(objectValue(objectValue(payload, "response"), "data"), "token"),
    objectValue(objectValue(objectValue(payload, "response"), "data"), "jwt"),
  ];

  const token = candidates.find((value): value is string => typeof value === "string" && value.length > 0);
  return token ?? null;
}

function upstreamErrorMessage(payload: unknown, status: number) {
  if (payload && typeof payload === "object" && "error" in payload) {
    const error = (payload as { error?: { message?: unknown } }).error;
    if (error?.message) return String(error.message);
  }

  const message = objectValue(payload, "message");
  if (typeof message === "string" && message) return message;

  return `API Cangar mengembalikan status ${status}.`;
}

function timeoutMessage() {
  return `API Cangar timeout setelah ${env.UPSTREAM_TIMEOUT_MS}ms.`;
}

async function fetchCangar(url: string, init: RequestInit, path: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), env.UPSTREAM_TIMEOUT_MS);

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    const isTimeout = error instanceof Error && error.name === "AbortError";
    logger.error({ error, path }, "Cangar upstream request failed");
    throw new CangarWpError(isTimeout ? 504 : 503, isTimeout ? timeoutMessage() : "API Cangar tidak bisa dihubungi.", {
      path,
      timeoutMs: env.UPSTREAM_TIMEOUT_MS,
    });
  } finally {
    clearTimeout(timeout);
  }
}

export function clearCangarAccessToken() {
  cachedAccessToken = null;
}

export async function loginCangar() {
  if (!env.CANGAR_API_USERNAME || !env.CANGAR_API_PASSWORD) {
    throw new CangarWpError(503, "Credential service account Cangar belum dikonfigurasi.", {
      envNames: ["CANGAR_API_USERNAME", "CANGAR_API_PASSWORD"],
    });
  }

  const response = await fetchCangar(joinUrl("/auth/login"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: env.CANGAR_API_USERNAME,
      password: env.CANGAR_API_PASSWORD,
    }),
  }, "/auth/login");
  const payload = await parseJsonResponse(response);

  if (!response.ok) {
    throw new CangarWpError(response.status >= 500 ? 503 : response.status, upstreamErrorMessage(payload, response.status), {
      upstreamStatus: response.status,
      path: "/auth/login",
    });
  }

  const token = findAccessToken(payload);
  if (!token) {
    throw new CangarWpError(502, "Response login Cangar tidak berisi access token.", {
      path: "/auth/login",
    });
  }

  cachedAccessToken = token;
  return token;
}

export async function getCangarAccessToken() {
  if (cachedAccessToken) return cachedAccessToken;
  if (!loginPromise) {
    loginPromise = loginCangar().finally(() => {
      loginPromise = null;
    });
  }
  return loginPromise;
}

async function requestCangarOnce(path: string, options: CangarRequestOptions) {
  const method = (options.method ?? "GET").toUpperCase();
  const headers = { ...(options.headers ?? {}) };
  const init: RequestInit = { method, headers };

  if (!options.skipAuth) {
    headers.Authorization = `Bearer ${await getCangarAccessToken()}`;
  }

  if (!["GET", "HEAD"].includes(method)) {
    headers["Content-Type"] ??= "application/json";
    init.body = typeof options.body === "string" ? options.body : JSON.stringify(options.body ?? {});
  }

  const response = await fetchCangar(joinUrl(path, options.queryString), init, path);
  const payload = await parseJsonResponse(response);

  return { httpResponse: response, payload };
}

export async function requestCangar(path: string, options: CangarRequestOptions = {}): Promise<CangarResult> {
  const first = await requestCangarOnce(path, options);
  let response = first.httpResponse;
  let payload = first.payload;

  if (!options.skipAuth && response.status === 401) {
    clearCangarAccessToken();
    logger.warn({ path }, "Cangar access token rejected, retrying once after login");
    const retry = await requestCangarOnce(path, options);
    response = retry.httpResponse;
    payload = retry.payload;
  }

  if (!response.ok) {
    throw new CangarWpError(response.status >= 500 ? 503 : response.status, upstreamErrorMessage(payload, response.status), {
      upstreamStatus: response.status,
      path,
    });
  }

  return {
    status: response.status,
    payload,
    response: standardResponse(payload),
  };
}
