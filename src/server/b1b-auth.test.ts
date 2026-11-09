import { describe, expect, it, vi } from "vitest";
import { parseServerEnv } from "./config/env.server";
import {
  hashPassword,
  isValidAccountEmail,
  normalizeAccountEmail,
  SCRYPT_PARAMS,
  validateLoginPasswordInput,
  validatePasswordPolicy,
  verifyDummyPassword,
  verifyPassword,
} from "./auth/password.server";
import {
  buildClearSessionCookie,
  buildSessionCookie,
  generateSessionToken,
  getClientIp,
  hashSessionToken,
  isPlausibleSessionToken,
  maskIpPrefix,
  sanitizeRedirectTarget,
  shouldUseSecureCookie,
  verifyCsrfAndOrigin,
} from "./auth/security.server";
import { evaluateRateLimitBlock, nextRateLimitStateOnFailure } from "./auth/rateLimit.server";
import { evaluateStoredSessionValidity } from "./auth/authService.server";
import { getRequestAuthContext } from "./auth/requestContext.server";
import { executeProtectedSsrRequest, handleApiRequest } from "./http/apiRouter.server";

describe("B1B Password Hashing & Validation", () => {
  it("hashes with random 16-byte salt and scrypt N=32768,r=8,p=1 and verifies cleanly", async () => {
    const hash1 = await hashPassword("ValidOwnerPass2026!");
    const hash2 = await hashPassword("ValidOwnerPass2026!");

    expect(hash1).toMatch(/^scrypt\$N=32768,r=8,p=1\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/);
    expect(hash1).not.toBe(hash2);
    expect(SCRYPT_PARAMS.N).toBe(32_768);

    expect(await verifyPassword("ValidOwnerPass2026!", hash1)).toBe(true);
    expect(await verifyPassword("ValidOwnerPass2026!", hash2)).toBe(true);
    expect(await verifyPassword("WrongOwnerPass2026!", hash1)).toBe(false);
    expect(await verifyPassword("", hash1)).toBe(false);
    expect(await verifyPassword("a".repeat(200), hash1)).toBe(false);
  });

  it("rejects malformed hashes, weak policy passwords, and supports dummy verification", async () => {
    expect(validatePasswordPolicy("short1")).toMatch(/at least 10/i);
    expect(validatePasswordPolicy("onlylettersonlyletters")).toMatch(/letter and one number/i);
    expect(validatePasswordPolicy(" leading1234")).toMatch(/space/i);
    expect(validatePasswordPolicy(`${"a".repeat(120)}123456789`)).toMatch(/at most 128/i);
    expect(validatePasswordPolicy("StrongPass123!")).toBeNull();

    expect(validateLoginPasswordInput("any1")).toBe(true);
    expect(validateLoginPasswordInput("")).toBe(false);
    expect(validateLoginPasswordInput("x".repeat(129))).toBe(false);

    expect(await verifyPassword("ValidOwnerPass2026!", "plain-text-hash")).toBe(false);
    expect(await verifyPassword("ValidOwnerPass2026!", "scrypt$N=2,r=8,p=1$aa$bb")).toBe(false);

    expect(isValidAccountEmail("Owner@ScaleFlow.in")).toBe(true);
    expect(normalizeAccountEmail("  Owner@ScaleFlow.in  ")).toBe("owner@scaleflow.in");
    expect(isValidAccountEmail("bad-email")).toBe(false);

    await expect(verifyDummyPassword("AttemptPass123")).resolves.toBeUndefined();
  });
});

describe("B1B Session Tokens, Cookie Flags, CSRF & Redirect Hygiene", () => {
  it("generates opaque tokens whose SHA-256 digests differ from raw tokens", () => {
    const t1 = generateSessionToken();
    const t2 = generateSessionToken();
    expect(t1).not.toBe(t2);
    expect(isPlausibleSessionToken(t1)).toBe(true);
    expect(isPlausibleSessionToken("short")).toBe(false);
    expect(isPlausibleSessionToken("bad$token!".repeat(6))).toBe(false);

    const h1 = hashSessionToken(t1);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
    expect(h1).not.toBe(t1);
  });

  it("enforces HttpOnly, SameSite=Lax, and production Secure cookie rules", () => {
    const prodDomainEnv = parseServerEnv({
      NODE_ENV: "production",
      APP_ORIGIN: "https://crmv2.joinscaleflow.in",
    });
    expect(
      shouldUseSecureCookie(new Request("https://crmv2.joinscaleflow.in/"), prodDomainEnv),
    ).toBe(true);

    const prodNoOrigin = parseServerEnv({ NODE_ENV: "production" });
    expect(
      shouldUseSecureCookie(
        new Request("http://crmv2.joinscaleflow.in/", {
          headers: { host: "crmv2.joinscaleflow.in" },
        }),
        prodNoOrigin,
      ),
    ).toBe(true);

    const prodLoopbackDev = parseServerEnv({ NODE_ENV: "production" });
    expect(
      shouldUseSecureCookie(
        new Request("http://127.0.0.1:4173/", { headers: { host: "127.0.0.1:4173" } }),
        prodLoopbackDev,
      ),
    ).toBe(false);

    const proxyHttps = parseServerEnv({ NODE_ENV: "production", AUTH_TRUST_PROXY: "true" });
    expect(
      shouldUseSecureCookie(
        new Request("http://127.0.0.1:3000/", {
          headers: { host: "127.0.0.1:3000", "x-forwarded-proto": "https" },
        }),
        proxyHttps,
      ),
    ).toBe(true);

    const cookie = buildSessionCookie("opaque_tok", {
      cookieName: "sf_session",
      maxAgeSeconds: 3600,
      secure: true,
    });
    expect(cookie).toContain("sf_session=opaque_tok");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain("Max-Age=3600");
    expect(cookie).toContain("Secure");

    const cleared = buildClearSessionCookie({ cookieName: "sf_session", secure: true });
    expect(cleared).toContain("sf_session=;");
    expect(cleared).toContain("Max-Age=0");
    expect(cleared).toContain("HttpOnly");
    expect(cleared).toContain("Secure");
  });

  it("blocks cross-site CSRF origins and invalid redirects", () => {
    const env = parseServerEnv({ APP_ORIGIN: "https://crmv2.example.com" });

    expect(
      verifyCsrfAndOrigin(
        new Request("https://crmv2.example.com/api/v1/auth/login", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: "https://crmv2.example.com",
            "sec-fetch-site": "same-origin",
          },
        }),
        env,
        { requireJsonContentType: true },
      ).ok,
    ).toBe(true);

    expect(
      verifyCsrfAndOrigin(
        new Request("https://crmv2.example.com/api/v1/auth/login", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: "https://evil.example.net",
            "sec-fetch-site": "cross-site",
          },
        }),
        env,
        { requireJsonContentType: true },
      ).ok,
    ).toBe(false);

    expect(
      verifyCsrfAndOrigin(
        new Request("https://crmv2.example.com/api/v1/auth/logout", {
          method: "POST",
          headers: {
            "content-type": "text/plain",
            origin: "https://crmv2.example.com",
          },
        }),
        env,
        { requireJsonContentType: true },
      ).ok,
    ).toBe(false);

    expect(sanitizeRedirectTarget("/leads")).toBe("/leads");
    expect(sanitizeRedirectTarget("/projects/p_1?tab=tasks")).toBe("/projects/p_1?tab=tasks");
    expect(sanitizeRedirectTarget("https://evil.com/phish")).toBe("/");
    expect(sanitizeRedirectTarget("//evil.com")).toBe("/");
    expect(sanitizeRedirectTarget("/\\evil.com")).toBe("/");
    expect(sanitizeRedirectTarget("/login?redirect=/deals")).toBe("/");
    expect(sanitizeRedirectTarget("/api/v1/auth/session")).toBe("/");
    expect(sanitizeRedirectTarget("/_serverFn/test")).toBe("/");
  });

  it("only reads proxy headers when AUTH_TRUST_PROXY=true and masks IP prefixes", () => {
    const spoofReq = new Request("http://127.0.0.1:4173/api/v1/auth/login", {
      headers: { "x-forwarded-for": "203.0.113.42" },
    });
    expect(getClientIp(spoofReq, { AUTH_TRUST_PROXY: false })).toBe("local");
    expect(getClientIp(spoofReq, { AUTH_TRUST_PROXY: true })).toBe("203.0.113.42");
    expect(maskIpPrefix("203.0.113.42")).toBe("203.0.113.0/24");
  });
});

describe("B1B Rate Limiting & Session Expiry Evaluation", () => {
  const policy = { maxAttempts: 5, windowSeconds: 900, lockoutSeconds: 900 };

  it("locks out at threshold and recovers after window/lockout expires", () => {
    const t0 = new Date("2026-11-09T10:00:00.000Z");
    let snap = null;

    for (let i = 1; i <= 4; i += 1) {
      const res = nextRateLimitStateOnFailure(snap, policy, new Date(t0.getTime() + i * 1000));
      expect(res.blocked).toBe(false);
      expect(res.nextState.attemptCount).toBe(i);
      snap = res.nextState;
    }

    const fifth = nextRateLimitStateOnFailure(snap, policy, new Date(t0.getTime() + 5000));
    expect(fifth.blocked).toBe(true);
    expect(fifth.retryAfterSeconds).toBe(900);

    const duringLockout = evaluateRateLimitBlock(
      fifth.nextState,
      policy,
      new Date(t0.getTime() + 100_000),
    );
    expect(duringLockout.blocked).toBe(true);
    expect(duringLockout.retryAfterSeconds).toBeGreaterThan(700);

    const afterLockout = evaluateRateLimitBlock(
      fifth.nextState,
      policy,
      new Date(t0.getTime() + 906_000),
    );
    expect(afterLockout.blocked).toBe(false);

    const postExpiry = nextRateLimitStateOnFailure(
      fifth.nextState,
      policy,
      new Date(t0.getTime() + 906_000),
    );
    expect(postExpiry.blocked).toBe(false);
    expect(postExpiry.nextState.attemptCount).toBe(1);
  });

  it("evaluates active, idle-expired, absolute-expired, revoked, inactive, and non-owner sessions", () => {
    const now = new Date("2026-11-09T12:00:00.000Z");
    const base = {
      roleId: "owner",
      accountStatus: "active",
      expiresAt: "2026-11-10 12:00:00.000",
      idleExpiresAt: "2026-11-09 14:00:00.000",
      revokedAt: null,
    };

    expect(evaluateStoredSessionValidity(base, now).valid).toBe(true);
    expect(
      evaluateStoredSessionValidity({ ...base, idleExpiresAt: "2026-11-09 12:00:00.000" }, now),
    ).toEqual({ valid: false, reason: "idle_expired" });
    expect(
      evaluateStoredSessionValidity({ ...base, expiresAt: "2026-11-09 11:59:59.000" }, now),
    ).toEqual({ valid: false, reason: "absolute_expired" });
    expect(
      evaluateStoredSessionValidity({ ...base, revokedAt: "2026-11-09 11:30:00.000" }, now),
    ).toEqual({ valid: false, reason: "revoked" });
    expect(evaluateStoredSessionValidity({ ...base, accountStatus: "inactive" }, now)).toEqual({
      valid: false,
      reason: "inactive_user",
    });
    expect(evaluateStoredSessionValidity({ ...base, roleId: "salesperson" }, now)).toEqual({
      valid: false,
      reason: "non_owner",
    });
  });
});

describe("B1B Fail-Closed API & SSR Gate (unconfigured DB / unauthenticated)", () => {
  it("fails closed on GET /api/v1/auth/session and /api/v1/auth/* CSRF/validation", async () => {
    const resSession = await handleApiRequest(
      new Request("http://127.0.0.1:4173/api/v1/auth/session"),
    );
    expect(resSession).not.toBeNull();
    expect(resSession!.status).toBe(503);
    const bodySession = (await resSession!.json()) as { authenticated: boolean; ok: boolean };
    expect(bodySession.ok).toBe(false);
    expect(bodySession.authenticated).toBe(false);

    const crossSiteLogin = await handleApiRequest(
      new Request("http://127.0.0.1:4173/api/v1/auth/login", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://attacker.example",
          "sec-fetch-site": "cross-site",
        },
        body: JSON.stringify({ email: "x@example.com", password: "ValidPassword1!" }),
      }),
    );
    expect(crossSiteLogin!.status).toBe(403);

    const badLogin = await handleApiRequest(
      new Request("http://127.0.0.1:4173/api/v1/auth/login", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://127.0.0.1:4173",
          "sec-fetch-site": "same-origin",
        },
        body: JSON.stringify({ email: "bad", password: "" }),
      }),
    );
    expect(badLogin!.status).toBe(400);

    const methodCheck = await handleApiRequest(
      new Request("http://127.0.0.1:4173/api/v1/auth/logout", { method: "GET" }),
    );
    expect(methodCheck!.status).toBe(405);
  });

  it("blocks protected SSR deep links & /_serverFn before rendering CRM markup", async () => {
    for (const target of ["/", "/leads", "/deals", "/projects", "/data-vault", "/leads.js"]) {
      const ssrSpy = vi.fn(() => new Response("<html>CRM DATA</html>", { status: 200 }));
      const res = await executeProtectedSsrRequest(
        new Request(`http://127.0.0.1:4173${target}`),
        ssrSpy,
      );
      expect(ssrSpy).not.toHaveBeenCalled();
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toMatch(/^\/login/);
      expect(res.headers.get("cache-control")).toContain("no-store");
    }

    const fnSpy = vi.fn(() => new Response("{}", { status: 200 }));
    const fnRes = await executeProtectedSsrRequest(
      new Request("http://127.0.0.1:4173/_serverFn/something", { method: "POST" }),
      fnSpy,
    );
    expect(fnSpy).not.toHaveBeenCalled();
    expect([401, 503]).toContain(fnRes.status);

    let capturedCtxAuthenticated: boolean | null = null;
    const loginRes = await executeProtectedSsrRequest(
      new Request("http://127.0.0.1:4173/login"),
      () => {
        capturedCtxAuthenticated = getRequestAuthContext().authenticated;
        return new Response("<html>Login</html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        });
      },
    );
    expect(loginRes.status).toBe(200);
    expect(capturedCtxAuthenticated).toBe(false);
    expect(loginRes.headers.get("cache-control")).toContain("no-store");
    expect(loginRes.headers.get("x-frame-options")).toBe("DENY");
  });
});
