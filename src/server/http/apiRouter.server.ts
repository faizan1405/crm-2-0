import "@tanstack/react-start/server-only";
import { getHealthStatus } from "../health/health.server";

const API_SECURITY_HEADERS: Record<string, string> = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "no-referrer",
};

function jsonResponse(
  body: unknown,
  status: number,
  extraHeaders?: Record<string, string>,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...API_SECURITY_HEADERS,
      ...extraHeaders,
    },
  });
}

function normalizePathname(rawUrl: string): string {
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

/**
 * Handles `/api/*` endpoints with structured JSON + security headers.
 * Returns `null` for non-API requests so TanStack Start SSR handles page routes.
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
    console.error("[apiRouter] Unhandled API error", {
      pathname,
      method: request.method,
      name: error instanceof Error ? error.name : "Error",
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
