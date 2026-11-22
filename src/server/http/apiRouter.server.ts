import "@tanstack/react-start/server-only";
import { isCrmV2DefaultBackend, isLeadPilotAvailable, loadServerEnv } from "../config/env.server";
import { getHealthStatus } from "../health/health.server";
import {
  loginOwnerAccount,
  logoutAllSessions,
  logoutCurrentSession,
  resolveAuthenticatedSession,
  toRequestAuthContext,
} from "../auth/authService.server";
import { runWithRequestAuthContext } from "../auth/requestContext.server";
import {
  buildClearSessionCookie,
  buildSessionCookie,
  getClientIp,
  maskIpPrefix,
  readSessionCookie,
  sanitizeRedirectTarget,
  shouldUseSecureCookie,
  verifyCsrfAndOrigin,
} from "../auth/security.server";
import { handleCrmApiRequest } from "./crmRoutes.server";
import {
  recordAuthFailure,
  recordUnhandledApiError,
} from "../monitoring/logger.server";
import { getOwnerMonitoringSnapshot } from "../monitoring/monitoringService.server";

const API_SECURITY_HEADERS: Record<string, string> = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  pragma: "no-cache",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "no-referrer",
};

const SSR_SECURITY_HEADERS: Record<string, string> = {
  "cache-control": "no-store, private",
  pragma: "no-cache",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "no-referrer",
};

const MAX_AUTH_JSON_BYTES = 16 * 1024;

function jsonResponse(
  body: unknown,
  status: number,
  extraHeaders?: Record<string, string>,
): Response {
  const headers = new Headers(API_SECURITY_HEADERS);
  if (extraHeaders) {
    for (const [k, v] of Object.entries(extraHeaders)) {
      headers.append(k, v);
    }
  }
  return new Response(JSON.stringify(body), { status, headers });
}

export function normalizePathname(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl, "http://127.0.0.1");
    return parsed.pathname.length > 1 && parsed.pathname.endsWith("/")
      ? parsed.pathname.slice(0, -1)
      : parsed.pathname;
  } catch {
    return "/";
  }
}

/** True when a request targets `/api` or `/api/*` and must be handled outside React SSR. */
export function isApiRequestPath(pathname: string): boolean {
  return pathname === "/api" || pathname.startsWith("/api/");
}

export function isStaticOrDevAssetPath(pathname: string): boolean {
  return (
    pathname.startsWith("/assets/") ||
    pathname.startsWith("/@") ||
    pathname.startsWith("/node_modules/") ||
    pathname.startsWith("/src/") ||
    pathname === "/favicon.ico" ||
    pathname === "/robots.txt" ||
    pathname === "/sitemap.xml" ||
    pathname === "/styles.css"
  );
}

export function isServerFunctionPath(pathname: string): boolean {
  return (
    pathname === "/_serverFn" ||
    pathname.startsWith("/_serverFn/") ||
    pathname === "/_server" ||
    pathname.startsWith("/_server/")
  );
}

async function parseBoundedJsonBody(
  request: Request,
): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; message: string }> {
  const contentLength = request.headers.get("content-length");
  if (contentLength && Number(contentLength) > MAX_AUTH_JSON_BYTES) {
    return { ok: false, message: "Request body is too large." };
  }

  try {
    const rawText = await request.text();
    if (Buffer.byteLength(rawText, "utf8") > MAX_AUTH_JSON_BYTES) {
      return { ok: false, message: "Request body is too large." };
    }
    if (!rawText.trim()) {
      return { ok: true, data: {} };
    }
    const parsed: unknown = JSON.parse(rawText);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { ok: false, message: "Request body must be a JSON object." };
    }
    return { ok: true, data: parsed as Record<string, unknown> };
  } catch {
    return { ok: false, message: "Malformed JSON request body." };
  }
}

function shouldClearRejectedSessionCookie(reason: string): boolean {
  return reason !== "missing";
}

/**
 * Handles `/api/*` endpoints with structured JSON + security headers.
 * Returns `null` for non-API requests so `src/server.ts` routes SSR/serverFn safely.
 */
export async function handleApiRequest(request: Request): Promise<Response | null> {
  const pathname = normalizePathname(request.url);
  if (!isApiRequestPath(pathname)) {
    return null;
  }

  try {
    if (pathname === "/api/v1/health") {
      if (request.method === "GET") {
        const payload = await getHealthStatus();
        return jsonResponse(payload, 200);
      }
      if (request.method === "HEAD") {
        await getHealthStatus();
        return new Response(null, {
          status: 200,
          headers: API_SECURITY_HEADERS,
        });
      }
      return jsonResponse(
        {
          ok: false,
          error: {
            code: "method_not_allowed",
            message: "Only GET and HEAD are supported on /api/v1/health.",
          },
        },
        405,
        { allow: "GET, HEAD" },
      );
    }

    const env = loadServerEnv();
    const secureCookie = shouldUseSecureCookie(request, env);

    if (pathname === "/api/v1/auth/session") {
      if (request.method !== "GET") {
        return jsonResponse(
          {
            ok: false,
            error: {
              code: "method_not_allowed",
              message: "Only GET is supported on /api/v1/auth/session.",
            },
          },
          405,
          { allow: "GET" },
        );
      }

      const token = readSessionCookie(request, env.SESSION_COOKIE_NAME);
      const ipPrefix = maskIpPrefix(getClientIp(request, env));
      const resolved = await resolveAuthenticatedSession(token, env, { ipPrefix });

      if (resolved.status === "unconfigured" || resolved.status === "db_error") {
        return jsonResponse(
          {
            ok: false,
            authenticated: false,
            error: {
              code: "auth_unavailable",
              message: "Authentication database is unavailable.",
            },
          },
          503,
        );
      }

      if (resolved.status === "unauthenticated") {
        if (resolved.reason !== "missing") {
          recordAuthFailure({
            event: "auth_session_rejected",
            reason: resolved.reason,
            status: 401,
            path: pathname,
            ipPrefix,
          });
        }
        const headers: Record<string, string> | undefined =
          token && shouldClearRejectedSessionCookie(resolved.reason)
            ? {
                "set-cookie": buildClearSessionCookie({
                  cookieName: env.SESSION_COOKIE_NAME,
                  secure: secureCookie,
                }),
              }
            : undefined;
        return jsonResponse(
          {
            ok: false,
            authenticated: false,
            error: {
              code: "unauthenticated",
              reason: resolved.reason,
              message: "Authentication required.",
            },
          },
          401,
          headers,
        );
      }

      return jsonResponse(
        {
          ok: true,
          authenticated: true,
          user: resolved.user,
          session: {
            idleExpiresAt: resolved.idleExpiresAt,
            expiresAt: resolved.expiresAt,
          },
          features: {
            leadPilotAvailable: isLeadPilotAvailable(env),
            crmV2DefaultBackend: isCrmV2DefaultBackend(env),
          },
        },
        200,
      );
    }

    if (pathname === "/api/v1/auth/login") {
      if (request.method !== "POST") {
        return jsonResponse(
          {
            ok: false,
            error: {
              code: "method_not_allowed",
              message: "Only POST is supported on /api/v1/auth/login.",
            },
          },
          405,
          { allow: "POST" },
        );
      }

      const csrf = verifyCsrfAndOrigin(request, env, { requireJsonContentType: true });
      if (!csrf.ok) {
        return jsonResponse(
          {
            ok: false,
            authenticated: false,
            error: { code: csrf.code, message: csrf.message },
          },
          403,
        );
      }

      const parsedBody = await parseBoundedJsonBody(request);
      if (!parsedBody.ok) {
        return jsonResponse(
          {
            ok: false,
            authenticated: false,
            error: { code: "validation_error", message: parsedBody.message },
          },
          400,
        );
      }

      const result = await loginOwnerAccount(
        {
          email: parsedBody.data["email"],
          password: parsedBody.data["password"],
          request,
        },
        env,
      );

      if (!result.ok) {
        recordAuthFailure({
          event: result.status === 503 ? "auth_unavailable" : "auth_login_failed",
          reason: result.code,
          status: result.status,
          path: pathname,
          ipPrefix: maskIpPrefix(getClientIp(request, env)),
        });
        const extraHeaders =
          result.status === 429 && result.retryAfterSeconds !== undefined
            ? { "retry-after": String(result.retryAfterSeconds) }
            : undefined;
        return jsonResponse(
          {
            ok: false,
            authenticated: false,
            error: {
              code: result.code,
              message: result.message,
              ...(result.retryAfterSeconds !== undefined
                ? { retryAfterSeconds: result.retryAfterSeconds }
                : {}),
            },
          },
          result.status,
          extraHeaders,
        );
      }

      const setCookie = buildSessionCookie(result.token, {
        cookieName: env.SESSION_COOKIE_NAME,
        maxAgeSeconds: result.maxAgeSeconds,
        secure: secureCookie,
      });

      return jsonResponse(
        {
          ok: true,
          authenticated: true,
          user: result.user,
          session: {
            idleExpiresAt: result.idleExpiresAt,
            expiresAt: result.expiresAt,
          },
          features: {
            leadPilotAvailable: isLeadPilotAvailable(env),
            crmV2DefaultBackend: isCrmV2DefaultBackend(env),
          },
        },
        200,
        { "set-cookie": setCookie },
      );
    }

    if (pathname === "/api/v1/auth/logout") {
      if (request.method !== "POST") {
        return jsonResponse(
          {
            ok: false,
            error: {
              code: "method_not_allowed",
              message: "Only POST is supported on /api/v1/auth/logout.",
            },
          },
          405,
          { allow: "POST" },
        );
      }

      const csrf = verifyCsrfAndOrigin(request, env, { requireJsonContentType: true });
      if (!csrf.ok) {
        return jsonResponse(
          {
            ok: false,
            error: { code: csrf.code, message: csrf.message },
          },
          403,
        );
      }

      const token = readSessionCookie(request, env.SESSION_COOKIE_NAME);
      const result = await logoutCurrentSession(token, request, env);
      const clearCookie = buildClearSessionCookie({
        cookieName: env.SESSION_COOKIE_NAME,
        secure: secureCookie,
      });

      if (!result.ok) {
        return jsonResponse(
          {
            ok: false,
            authenticated: false,
            error: { code: result.code, message: result.message },
          },
          result.status,
          token && result.status === 401 ? { "set-cookie": clearCookie } : undefined,
        );
      }

      return jsonResponse(
        {
          ok: true,
          authenticated: false,
          revoked: true,
          revokedCount: result.revokedCount,
        },
        200,
        { "set-cookie": clearCookie },
      );
    }

    if (pathname === "/api/v1/auth/logout-all") {
      if (request.method !== "POST") {
        return jsonResponse(
          {
            ok: false,
            error: {
              code: "method_not_allowed",
              message: "Only POST is supported on /api/v1/auth/logout-all.",
            },
          },
          405,
          { allow: "POST" },
        );
      }

      const csrf = verifyCsrfAndOrigin(request, env, { requireJsonContentType: true });
      if (!csrf.ok) {
        return jsonResponse(
          {
            ok: false,
            error: { code: csrf.code, message: csrf.message },
          },
          403,
        );
      }

      const token = readSessionCookie(request, env.SESSION_COOKIE_NAME);
      const result = await logoutAllSessions(token, request, env);
      const clearCookie = buildClearSessionCookie({
        cookieName: env.SESSION_COOKIE_NAME,
        secure: secureCookie,
      });

      if (!result.ok) {
        return jsonResponse(
          {
            ok: false,
            authenticated: false,
            error: { code: result.code, message: result.message },
          },
          result.status,
          token && result.status === 401 ? { "set-cookie": clearCookie } : undefined,
        );
      }

      return jsonResponse(
        {
          ok: true,
          authenticated: false,
          revoked: true,
          revokedCount: result.revokedCount,
        },
        200,
        { "set-cookie": clearCookie },
      );
    }

    if (pathname === "/api/v1/monitoring/summary") {
      if (request.method !== "GET") {
        return jsonResponse(
          {
            ok: false,
            error: {
              code: "method_not_allowed",
              message: "Only GET is supported on /api/v1/monitoring/summary.",
            },
          },
          405,
          { allow: "GET" },
        );
      }

      const token = readSessionCookie(request, env.SESSION_COOKIE_NAME);
      const ipPrefix = maskIpPrefix(getClientIp(request, env));
      const resolved = await resolveAuthenticatedSession(token, env, { ipPrefix });
      if (resolved.status === "unconfigured" || resolved.status === "db_error") {
        return jsonResponse(
          {
            ok: false,
            error: {
              code: "auth_unavailable",
              message: "Authentication database is unavailable.",
            },
          },
          503,
        );
      }
      if (resolved.status !== "authenticated") {
        return jsonResponse(
          {
            ok: false,
            error: {
              code: "unauthenticated",
              message: "Authentication required.",
            },
          },
          401,
        );
      }

      const snapshot = await getOwnerMonitoringSnapshot(resolved.user.id, { env });
      return jsonResponse(snapshot, 200);
    }

    const crmResponse = await handleCrmApiRequest(request, pathname, env);
    if (crmResponse) {
      return crmResponse;
    }

    return jsonResponse(
      {
        ok: false,
        error: {
          code: "not_found",
          message: "API endpoint not found.",
        },
      },
      404,
    );
  } catch (error) {
    recordUnhandledApiError({
      path: pathname,
      method: request.method,
      error,
    });
    return jsonResponse(
      {
        ok: false,
        error: {
          code: "internal_error",
          message: "Internal server error.",
        },
      },
      500,
    );
  }
}

export function withSsrSecurityHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [k, v] of Object.entries(SSR_SECURITY_HEADERS)) {
    headers.set(k, v);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * Fail-closed SSR & server-function security gate for `src/server.ts`.
 * Unauthenticated requests to CRM pages redirect (`302`) to `/login?redirect=...` before any CRM
 * route renders; unauthenticated `/_serverFn/*` requests fail closed with `401`.
 */
export async function executeProtectedSsrRequest(
  request: Request,
  renderSsr: () => Promise<Response> | Response,
): Promise<Response> {
  const apiResponse = await handleApiRequest(request);
  if (apiResponse) {
    return apiResponse;
  }

  let pathname = "/";
  let search = "";
  let redirectParam: string | null = null;
  try {
    const parsedUrl = new URL(request.url, "http://127.0.0.1");
    pathname = normalizePathname(request.url);
    search = parsedUrl.search;
    redirectParam = parsedUrl.searchParams.get("redirect");
  } catch {
    pathname = "/";
  }

  if (isStaticOrDevAssetPath(pathname)) {
    return renderSsr();
  }

  const env = loadServerEnv();
  const secureCookie = shouldUseSecureCookie(request, env);
  const token = readSessionCookie(request, env.SESSION_COOKIE_NAME);
  const ipPrefix = maskIpPrefix(getClientIp(request, env));

  const isServerFn = isServerFunctionPath(pathname);
  const isLoginPage = pathname === "/login";

  const resolved = await resolveAuthenticatedSession(token, env, {
    ipPrefix,
    slideIdle: !isLoginPage,
  });

  if (isServerFn) {
    if (resolved.status !== "authenticated") {
      const headers: Record<string, string> | undefined =
        token && resolved.status === "unauthenticated"
          ? {
              "set-cookie": buildClearSessionCookie({
                cookieName: env.SESSION_COOKIE_NAME,
                secure: secureCookie,
              }),
            }
          : undefined;
      return jsonResponse(
        {
          ok: false,
          authenticated: false,
          error: {
            code: resolved.status === "unauthenticated" ? "unauthenticated" : "auth_unavailable",
            message: "Authentication required.",
          },
        },
        resolved.status === "unauthenticated" ? 401 : 503,
        headers,
      );
    }

    const authContext = toRequestAuthContext(resolved, env);
    return runWithRequestAuthContext(authContext, async () => {
      const res = await renderSsr();
      return withSsrSecurityHeaders(res);
    });
  }

  if (isLoginPage) {
    if (resolved.status === "authenticated") {
      const target = sanitizeRedirectTarget(redirectParam);
      const headers = new Headers(SSR_SECURITY_HEADERS);
      headers.set("location", target);
      return new Response(null, { status: 302, headers });
    }

    const authContext = toRequestAuthContext(resolved, env);
    const clearCookie =
      token &&
      resolved.status === "unauthenticated" &&
      shouldClearRejectedSessionCookie(resolved.reason)
        ? buildClearSessionCookie({
            cookieName: env.SESSION_COOKIE_NAME,
            secure: secureCookie,
          })
        : null;

    const response = await runWithRequestAuthContext(authContext, async () => {
      return renderSsr();
    });
    const secured = withSsrSecurityHeaders(response);
    if (clearCookie) {
      secured.headers.append("set-cookie", clearCookie);
    }
    return secured;
  }

  // All non-login, non-asset, non-API routes MUST fail closed when unauthenticated.
  if (resolved.status !== "authenticated") {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return jsonResponse(
        {
          ok: false,
          authenticated: false,
          error: { code: "unauthenticated", message: "Authentication required." },
        },
        401,
      );
    }

    const rawRequestedTarget = `${pathname}${search}`;
    const safeTarget = sanitizeRedirectTarget(rawRequestedTarget);
    const params = new URLSearchParams();
    if (safeTarget !== "/") {
      params.set("redirect", safeTarget);
    }
    if (resolved.status === "unconfigured" || resolved.status === "db_error") {
      params.set("reason", "db_unavailable");
    } else if (
      resolved.status === "unauthenticated" &&
      (resolved.reason === "idle_expired" || resolved.reason === "absolute_expired")
    ) {
      params.set("reason", "expired");
    }
    const qs = params.toString();
    const location = qs ? `/login?${qs}` : "/login";

    const headers = new Headers(SSR_SECURITY_HEADERS);
    headers.set("location", location);
    if (
      token &&
      resolved.status === "unauthenticated" &&
      shouldClearRejectedSessionCookie(resolved.reason)
    ) {
      headers.set(
        "set-cookie",
        buildClearSessionCookie({
          cookieName: env.SESSION_COOKIE_NAME,
          secure: secureCookie,
        }),
      );
    }
    return new Response(null, { status: 302, headers });
  }

  const authContext = toRequestAuthContext(resolved, env);
  return runWithRequestAuthContext(authContext, async () => {
    const response = await renderSsr();
    return withSsrSecurityHeaders(response);
  });
}
