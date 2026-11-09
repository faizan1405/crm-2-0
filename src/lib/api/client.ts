import type { z } from "zod";
import { clearClientAuthState, sanitizeRedirectTarget } from "@/lib/auth/authClient";
import { ApiError, parseApiErrorResponse } from "./errors";

export interface ApiRequestOptions<TSchema extends z.ZodTypeAny> {
  path: string;
  method?: "GET" | "HEAD" | "POST" | "PATCH" | "PUT" | "DELETE";
  query?: Record<string, string | number | boolean | undefined | null>;
  body?: unknown;
  schema: TSchema;
  /** Optional explicit Idempotency-Key. Required if non-GET/HEAD requests should retry transient errors. */
  idempotencyKey?: string;
  timeoutMs?: number;
  /** Override max transient retries on safe GET/HEAD or keyed mutations (defaults to 2; 0 disables retries). */
  maxRetries?: number;
  signal?: AbortSignal;
  /** Dependency-injection hooks primarily for deterministic unit tests. */
  fetchImpl?: typeof fetch;
  sleepImpl?: (ms: number) => Promise<void>;
  onUnauthorized?: () => void;
}

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_TRANSIENT_RETRIES = 2;

export function createIdempotencyKey(): string {
  if (
    typeof globalThis.crypto !== "undefined" &&
    typeof globalThis.crypto.randomUUID === "function"
  ) {
    return `sf_${globalThis.crypto.randomUUID()}`;
  }
  const rand = Math.random().toString(36).slice(2, 12);
  return `sf_${Date.now().toString(36)}_${rand}`;
}

export function buildApiUrl(
  path: string,
  query?: Record<string, string | number | boolean | undefined | null>,
): string {
  if (!query) return path;
  const params = new URLSearchParams();
  for (const [key, val] of Object.entries(query)) {
    if (val === undefined || val === null || val === "") continue;
    params.set(key, String(val));
  }
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

function defaultRedirectToLogin(): void {
  if (typeof window === "undefined") return;
  if (window.location.pathname === "/login") return;
  const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  const safe = sanitizeRedirectTarget(current);
  const params = new URLSearchParams();
  if (safe !== "/") params.set("redirect", safe);
  params.set("reason", "expired");
  const qs = params.toString();
  window.location.replace(qs ? `/login?${qs}` : "/login");
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isAbortError(err: unknown): boolean {
  return Boolean(
    err &&
    typeof err === "object" &&
    ("name" in err ? (err as { name: unknown }).name === "AbortError" : false),
  );
}

/**
 * Shared typed JSON HTTP client for CRM V2 backend endpoints.
 *
 * Security & retry invariants:
 * - Always `credentials: "same-origin"` and `cache: "no-store"` (zero tokens in JS storage).
 * - Sends explicit `Accept: application/json` and `Content-Type: application/json` on JSON payloads.
 * - Retries transient network/503 errors ONLY for idempotent `GET`/`HEAD` requests OR mutations
 *   carrying an explicit `Idempotency-Key` header. Unkeyed `POST`/`PATCH`/`DELETE` NEVER auto-retry.
 * - `401` clears client auth state immediately and transitions cleanly to `/login`.
 */
export async function apiRequest<TSchema extends z.ZodTypeAny>(
  options: ApiRequestOptions<TSchema>,
): Promise<z.infer<TSchema>> {
  const method = (options.method ?? "GET").toUpperCase() as NonNullable<
    ApiRequestOptions<TSchema>["method"]
  >;
  const fetchFn = options.fetchImpl ?? fetch;
  const sleepFn = options.sleepImpl ?? defaultSleep;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const canRetryMethod = method === "GET" || method === "HEAD" || Boolean(options.idempotencyKey);
  const retryBudget = canRetryMethod
    ? Math.max(0, options.maxRetries ?? DEFAULT_MAX_TRANSIENT_RETRIES)
    : 0;

  const url = buildApiUrl(options.path, options.query);
  const hasJsonBody = options.body !== undefined;
  const headers: Record<string, string> = {
    Accept: "application/json",
  };
  if (hasJsonBody) {
    headers["Content-Type"] = "application/json";
  }
  if (options.idempotencyKey) {
    headers["Idempotency-Key"] = options.idempotencyKey;
  }

  let attempt = 0;
  while (true) {
    const controller = new AbortController();
    let timedOut = false;
    const onCallerAbort = () => controller.abort();
    if (options.signal) {
      if (options.signal.aborted) {
        controller.abort();
      } else {
        options.signal.addEventListener("abort", onCallerAbort, { once: true });
      }
    }
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);

    let response: Response;
    try {
      response = await fetchFn(url, {
        method,
        credentials: "same-origin",
        cache: "no-store",
        headers,
        ...(hasJsonBody ? { body: JSON.stringify(options.body) } : {}),
        signal: controller.signal,
      });
    } catch (networkErr) {
      clearTimeout(timer);
      if (options.signal) options.signal.removeEventListener("abort", onCallerAbort);

      if (options.signal?.aborted && !timedOut) {
        throw new ApiError({
          status: 0,
          code: "aborted",
          message: "Request was cancelled.",
          cause: networkErr,
        });
      }

      const apiErr = new ApiError({
        status: 0,
        code: isAbortError(networkErr) && timedOut ? "timeout_error" : "network_error",
        message: timedOut
          ? "Request timed out before the server responded."
          : "Unable to reach the CRM server.",
        cause: networkErr,
      });

      if (attempt < retryBudget) {
        attempt += 1;
        await sleepFn(200 * attempt);
        continue;
      }
      throw apiErr;
    }

    clearTimeout(timer);
    if (options.signal) options.signal.removeEventListener("abort", onCallerAbort);

    if (response.status === 401) {
      const authErr = await parseApiErrorResponse(response);
      clearClientAuthState();
      if (options.onUnauthorized) {
        options.onUnauthorized();
      } else {
        defaultRedirectToLogin();
      }
      throw authErr;
    }

    if (!response.ok) {
      const apiErr = await parseApiErrorResponse(response);
      if (apiErr.isRetryableTransient && attempt < retryBudget) {
        attempt += 1;
        await sleepFn(200 * attempt);
        continue;
      }
      throw apiErr;
    }

    let rawJson: unknown;
    try {
      rawJson = await response.json();
    } catch (parseErr) {
      throw new ApiError({
        status: response.status,
        code: "invalid_json",
        message: "Server returned an invalid JSON payload.",
        cause: parseErr,
      });
    }

    const parsed = options.schema.safeParse(rawJson);
    if (!parsed.success) {
      throw new ApiError({
        status: response.status,
        code: "invalid_response_schema",
        message: "Server response did not match the expected API contract.",
      });
    }

    return parsed.data;
  }
}
