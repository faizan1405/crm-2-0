import "@tanstack/react-start/server-only";
import crypto from "node:crypto";
import type { ServerEnv } from "../config/env.server";
import { sanitizeRedirectTarget } from "../../lib/auth/redirect";

export { sanitizeRedirectTarget };

export const SESSION_TOKEN_BYTES = 32;
const TOKEN_FORMAT = /^[A-Za-z0-9_-]{32,128}$/;

export function generateSessionToken(): string {
  return crypto.randomBytes(SESSION_TOKEN_BYTES).toString("base64url");
}

export function isPlausibleSessionToken(token: string | null | undefined): token is string {
  return typeof token === "string" && TOKEN_FORMAT.test(token);
}

/** One-way SHA-256 hex digest of an opaque session token; only this hash is persisted in MySQL. */
export function hashSessionToken(token: string): string {
  return crypto.createHash("sha256").update(token, "utf8").digest("hex");
}

/** One-way SHA-256 hex digest for email/UA audit & rate-limit keys (never stores plaintext email). */
export function hashAuditIdentifier(value: string): string {
  return crypto.createHash("sha256").update(value.trim().toLowerCase(), "utf8").digest("hex");
}

export function generateServerId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

export function maskIpPrefix(ip: string): string {
  const cleaned = ip.trim();
  if (!cleaned || cleaned === "local") return "local";

  const ipv4Clean = cleaned.startsWith("::ffff:") ? cleaned.slice(7) : cleaned;
  const v4Parts = ipv4Clean.split(".");
  if (v4Parts.length === 4 && v4Parts.every((seg) => /^\d{1,3}$/.test(seg) && Number(seg) <= 255)) {
    return `${v4Parts[0]}.${v4Parts[1]}.${v4Parts[2]}.0/24`;
  }

  if (cleaned.includes(":")) {
    const groups = cleaned.split(":").filter(Boolean).slice(0, 3);
    if (groups.length > 0) {
      return `${groups.join(":")}::/48`;
    }
  }

  return "unknown";
}

function normalizeCandidateIp(raw: string): string {
  let value = raw.trim();
  if (value.startsWith("[") && value.includes("]")) {
    value = value.slice(1, value.indexOf("]"));
  } else if (/^\d{1,3}(?:\.\d{1,3}){3}:\d+$/.test(value)) {
    value = value.slice(0, value.lastIndexOf(":"));
  }
  return value.slice(0, 64);
}

/**
 * Extracts client IP cleanly. Forwarded proxy headers (`x-forwarded-for`, `x-real-ip`) are ONLY
 * read when `AUTH_TRUST_PROXY=true` to prevent trivial rate-limit bypass via header spoofing.
 */
export function getClientIp(request: Request, env: Pick<ServerEnv, "AUTH_TRUST_PROXY">): string {
  if (env.AUTH_TRUST_PROXY) {
    const xff = request.headers.get("x-forwarded-for");
    if (xff) {
      const first = xff.split(",")[0];
      if (first) {
        const cleaned = normalizeCandidateIp(first);
        if (cleaned) return cleaned;
      }
    }
    const realIp = request.headers.get("x-real-ip");
    if (realIp) {
      const cleaned = normalizeCandidateIp(realIp);
      if (cleaned) return cleaned;
    }
  }

  return "local";
}

export function hashUserAgent(request: Request): string | null {
  const ua = request.headers.get("user-agent")?.trim();
  if (!ua) return null;
  return crypto.createHash("sha256").update(ua.slice(0, 512), "utf8").digest("hex");
}

export function parseCookies(cookieHeader: string | null): Record<string, string> {
  if (!cookieHeader) return {};
  const result: Record<string, string> = {};
  const pairs = cookieHeader.split(";");
  for (const pair of pairs) {
    const eqIndex = pair.indexOf("=");
    if (eqIndex <= 0) continue;
    const key = pair.slice(0, eqIndex).trim();
    const rawVal = pair.slice(eqIndex + 1).trim();
    if (!key) continue;
    try {
      result[key] = decodeURIComponent(rawVal);
    } catch {
      result[key] = rawVal;
    }
  }
  return result;
}

export function readSessionCookie(request: Request, cookieName: string): string | null {
  const cookies = parseCookies(request.headers.get("cookie"));
  const val = cookies[cookieName];
  return typeof val === "string" && val.length > 0 ? val : null;
}

export function isLoopbackHostname(hostname: string): boolean {
  const cleaned = hostname
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "");
  return cleaned === "127.0.0.1" || cleaned === "localhost" || cleaned === "::1";
}

function getEffectiveProtocolAndHost(
  request: Request,
  env: Pick<ServerEnv, "AUTH_TRUST_PROXY">,
): { protocol: "http:" | "https:"; host: string | null; hostname: string } {
  let urlProtocol: "http:" | "https:" = "http:";
  let urlHost: string | null = null;
  let urlHostname = "127.0.0.1";

  try {
    const parsed = new URL(request.url, "http://127.0.0.1");
    urlProtocol = parsed.protocol === "https:" ? "https:" : "http:";
    urlHost = parsed.host || null;
    urlHostname = parsed.hostname;
  } catch {
    // Keep safe defaults
  }

  let effectiveProtocol: "http:" | "https:" = urlProtocol;
  if (env.AUTH_TRUST_PROXY) {
    const forwardedProto = request.headers
      .get("x-forwarded-proto")
      ?.split(",")[0]
      ?.trim()
      .toLowerCase();
    if (forwardedProto === "https") effectiveProtocol = "https:";
    else if (forwardedProto === "http") effectiveProtocol = "http:";
  }

  const headerHost = (
    env.AUTH_TRUST_PROXY
      ? (request.headers.get("x-forwarded-host")?.split(",")[0]?.trim() ??
        request.headers.get("host")?.trim())
      : request.headers.get("host")?.trim()
  )
    ?.toLowerCase()
    .trim();

  const resolvedHost = headerHost || urlHost || "127.0.0.1";
  let resolvedHostname = urlHostname;
  try {
    resolvedHostname = new URL(`${effectiveProtocol}//${resolvedHost}`).hostname;
  } catch {
    // fallback to urlHostname
  }

  return { protocol: effectiveProtocol, host: resolvedHost, hostname: resolvedHostname };
}

/**
 * Sets `Secure` in production/non-loopback deployments and whenever the effective URL or
 * `APP_ORIGIN` uses HTTPS. Only permits omitting `Secure` on explicit HTTP loopback hosts so local
 * built-server testing in Chromium works without weakening production security.
 */
export function shouldUseSecureCookie(
  request: Request,
  env: Pick<ServerEnv, "NODE_ENV" | "APP_ORIGIN" | "AUTH_TRUST_PROXY">,
): boolean {
  if (env.APP_ORIGIN) {
    try {
      const originUrl = new URL(env.APP_ORIGIN);
      if (originUrl.protocol === "https:") return true;
      if (originUrl.protocol === "http:" && isLoopbackHostname(originUrl.hostname)) {
        return false;
      }
    } catch {
      // Ignore malformed APP_ORIGIN fallback
    }
  }

  const effective = getEffectiveProtocolAndHost(request, env);
  if (effective.protocol === "https:") return true;
  if (env.NODE_ENV === "production" && !isLoopbackHostname(effective.hostname)) {
    return true;
  }
  return false;
}

export function buildSessionCookie(
  token: string,
  options: { cookieName: string; maxAgeSeconds: number; secure: boolean },
): string {
  const maxAge = Math.max(1, Math.floor(options.maxAgeSeconds));
  const parts = [
    `${options.cookieName}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAge}`,
  ];
  if (options.secure) {
    parts.push("Secure");
  }
  return parts.join("; ");
}

export function buildClearSessionCookie(options: { cookieName: string; secure: boolean }): string {
  const parts = [
    `${options.cookieName}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
    "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
  ];
  if (options.secure) {
    parts.push("Secure");
  }
  return parts.join("; ");
}

export type CsrfCheckResult = { ok: true } | { ok: false; code: "csrf_rejected"; message: string };

/**
 * Validates same-origin CSRF defenses on state-changing auth requests:
 * - Rejects cross-site/same-site `Sec-Fetch-Site` headers (allows only `"same-origin"` when sent).
 * - Requires `Origin` or `Referer` (when present) to match `APP_ORIGIN` or effective request origin.
 * - Requires `application/json` Content-Type when checked with `requireJsonContentType`.
 */
export function verifyCsrfAndOrigin(
  request: Request,
  env: Pick<ServerEnv, "APP_ORIGIN" | "AUTH_TRUST_PROXY">,
  options: { requireJsonContentType?: boolean } = {},
): CsrfCheckResult {
  const fetchSite = request.headers.get("sec-fetch-site")?.trim().toLowerCase();
  if (fetchSite && fetchSite !== "same-origin") {
    return {
      ok: false,
      code: "csrf_rejected",
      message: "Cross-site requests are not permitted.",
    };
  }

  const allowedOrigins = new Set<string>();
  const effective = getEffectiveProtocolAndHost(request, env);
  if (effective.host) {
    try {
      allowedOrigins.add(new URL(`${effective.protocol}//${effective.host}`).origin);
    } catch {
      // ignore invalid host
    }
  }
  if (env.APP_ORIGIN) {
    try {
      allowedOrigins.add(new URL(env.APP_ORIGIN).origin);
    } catch {
      // ignore
    }
  }

  const originHeader = request.headers.get("origin");
  if (originHeader !== null) {
    const cleaned = originHeader.trim();
    if (!cleaned || cleaned.toLowerCase() === "null") {
      return {
        ok: false,
        code: "csrf_rejected",
        message: "Missing or null Origin header.",
      };
    }
    try {
      const parsedOrigin = new URL(cleaned).origin;
      const matchesAllowed = env.APP_ORIGIN
        ? parsedOrigin === new URL(env.APP_ORIGIN).origin
        : allowedOrigins.has(parsedOrigin);
      if (!matchesAllowed) {
        return {
          ok: false,
          code: "csrf_rejected",
          message: "Request origin does not match application origin.",
        };
      }
    } catch {
      return {
        ok: false,
        code: "csrf_rejected",
        message: "Malformed Origin header.",
      };
    }
  } else {
    const refererHeader = request.headers.get("referer");
    if (refererHeader) {
      try {
        const parsedReferer = new URL(refererHeader).origin;
        const matchesAllowed = env.APP_ORIGIN
          ? parsedReferer === new URL(env.APP_ORIGIN).origin
          : allowedOrigins.has(parsedReferer);
        if (!matchesAllowed) {
          return {
            ok: false,
            code: "csrf_rejected",
            message: "Request referer does not match application origin.",
          };
        }
      } catch {
        return {
          ok: false,
          code: "csrf_rejected",
          message: "Malformed Referer header.",
        };
      }
    }
  }

  if (options.requireJsonContentType) {
    const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
    if (!contentType.includes("application/json")) {
      return {
        ok: false,
        code: "csrf_rejected",
        message: "Expected application/json request content type.",
      };
    }
  }

  return { ok: true };
}
