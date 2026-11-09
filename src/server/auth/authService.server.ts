import "@tanstack/react-start/server-only";
import { and, eq, isNull } from "drizzle-orm";
import type { ServerEnv } from "../config/env.server";
import { getDatabase, type CrmDatabase } from "../db/index.server";
import { crmAuthAudit, crmSessions, crmUsers } from "../db/schema.server";
import { addSeconds, parseUtcDateTime, toMysqlUtcDateTime } from "../db/utc.server";
import {
  hashPassword,
  isValidAccountEmail,
  normalizeAccountEmail,
  validateLoginPasswordInput,
  verifyDummyPassword,
  verifyPassword,
} from "./password.server";
import {
  checkLoginRateLimits,
  clearRateLimitsOnLoginSuccess,
  recordFailedLoginAttempt,
  type RateLimitPolicy,
} from "./rateLimit.server";
import type { PublicOwnerUser, RequestAuthContextState } from "./requestContext.server";
import {
  generateServerId,
  generateSessionToken,
  getClientIp,
  hashAuditIdentifier,
  hashSessionToken,
  hashUserAgent,
  isPlausibleSessionToken,
  maskIpPrefix,
} from "./security.server";

export type SessionResolution =
  | {
      status: "authenticated";
      sessionId: string;
      user: PublicOwnerUser;
      idleExpiresAt: string;
      expiresAt: string;
    }
  | {
      status: "unauthenticated";
      reason:
        | "missing"
        | "malformed"
        | "not_found"
        | "revoked"
        | "idle_expired"
        | "absolute_expired"
        | "inactive_user"
        | "non_owner";
    }
  | {
      status: "unconfigured";
    }
  | {
      status: "db_error";
    };

export type LoginResult =
  | {
      ok: true;
      token: string;
      maxAgeSeconds: number;
      user: PublicOwnerUser;
      idleExpiresAt: string;
      expiresAt: string;
    }
  | {
      ok: false;
      status: 400 | 401 | 429 | 503;
      code: "validation_error" | "invalid_credentials" | "rate_limited" | "auth_unavailable";
      message: string;
      retryAfterSeconds?: number;
    };

export type LogoutResult =
  | {
      ok: true;
      revokedCount: number;
    }
  | {
      ok: false;
      status: 401 | 503;
      code: "unauthenticated" | "auth_unavailable";
      message: string;
    };

export interface EvaluatedSessionRecord {
  roleId: string;
  accountStatus: string;
  expiresAt: string;
  idleExpiresAt: string;
  revokedAt: string | null;
}

/**
 * Pure session validity check usable in both unit tests and live MySQL lookups.
 */
export function evaluateStoredSessionValidity(
  record: EvaluatedSessionRecord,
  now: Date,
):
  | { valid: true; absExpiry: Date; idleExpiry: Date }
  | {
      valid: false;
      reason: "revoked" | "inactive_user" | "non_owner" | "absolute_expired" | "idle_expired";
    } {
  if (record.revokedAt !== null) {
    return { valid: false, reason: "revoked" };
  }
  if (record.accountStatus !== "active") {
    return { valid: false, reason: "inactive_user" };
  }
  if (record.roleId !== "owner") {
    return { valid: false, reason: "non_owner" };
  }

  const absExpiry = parseUtcDateTime(record.expiresAt);
  const idleExpiry = parseUtcDateTime(record.idleExpiresAt);
  if (Number.isNaN(absExpiry.getTime()) || now >= absExpiry) {
    return { valid: false, reason: "absolute_expired" };
  }
  if (Number.isNaN(idleExpiry.getTime()) || now >= idleExpiry) {
    return { valid: false, reason: "idle_expired" };
  }

  return { valid: true, absExpiry, idleExpiry };
}

export function toRequestAuthContext(res: SessionResolution): RequestAuthContextState {
  if (res.status === "authenticated") {
    return {
      authenticated: true,
      user: res.user,
      idleExpiresAt: res.idleExpiresAt,
      expiresAt: res.expiresAt,
    };
  }
  if (res.status === "unconfigured") {
    return {
      authenticated: false,
      user: null,
      idleExpiresAt: null,
      expiresAt: null,
      reason: "unconfigured",
    };
  }
  if (res.status === "db_error") {
    return {
      authenticated: false,
      user: null,
      idleExpiresAt: null,
      expiresAt: null,
      reason: "db_error",
    };
  }
  return {
    authenticated: false,
    user: null,
    idleExpiresAt: null,
    expiresAt: null,
    reason: res.reason,
  };
}

async function appendAuditEvent(
  db: CrmDatabase,
  entry: {
    userId: string | null;
    eventType: string;
    emailHash?: string | null;
    sessionId?: string | null;
    ipPrefix?: string | null;
    detail?: string | null;
    now: Date;
  },
): Promise<void> {
  await db.insert(crmAuthAudit).values({
    id: generateServerId("audit"),
    userId: entry.userId,
    eventType: entry.eventType,
    emailHash: entry.emailHash ?? null,
    sessionId: entry.sessionId ?? null,
    ipPrefix: entry.ipPrefix ?? null,
    detail: entry.detail ? entry.detail.slice(0, 255) : null,
    createdAt: toMysqlUtcDateTime(entry.now),
  });
}

function buildRateLimitKeys(ipPrefix: string, normalizedEmail: string) {
  return {
    ipEmailKey: hashAuditIdentifier(`rl:ip_email:${ipPrefix}:${normalizedEmail}`),
    emailGlobalKey: hashAuditIdentifier(`rl:email:${normalizedEmail}`),
  };
}

function getRateLimitPolicy(env: ServerEnv): RateLimitPolicy {
  return {
    maxAttempts: env.AUTH_RATE_LIMIT_MAX_ATTEMPTS,
    windowSeconds: env.AUTH_RATE_LIMIT_WINDOW_SECONDS,
    lockoutSeconds: env.AUTH_LOCKOUT_SECONDS,
  };
}

/**
 * Resolves an opaque session cookie token against MySQL.
 * Fails closed (`unconfigured` / `db_error` / `unauthenticated`) on any anomaly.
 */
export async function resolveAuthenticatedSession(
  token: string | null | undefined,
  env: ServerEnv,
  options: { now?: Date; ipPrefix?: string; slideIdle?: boolean } = {},
): Promise<SessionResolution> {
  const now = options.now ?? new Date();
  const db = getDatabase();
  if (!db) {
    return { status: "unconfigured" };
  }

  if (!token) {
    return { status: "unauthenticated", reason: "missing" };
  }
  if (!isPlausibleSessionToken(token)) {
    return { status: "unauthenticated", reason: "malformed" };
  }

  try {
    const tokenHash = hashSessionToken(token);
    const rows = await db
      .select({
        sessionId: crmSessions.id,
        userId: crmSessions.userId,
        expiresAt: crmSessions.expiresAt,
        idleExpiresAt: crmSessions.idleExpiresAt,
        revokedAt: crmSessions.revokedAt,
        userEmail: crmUsers.email,
        userName: crmUsers.name,
        userRoleId: crmUsers.roleId,
        userAccountStatus: crmUsers.accountStatus,
      })
      .from(crmSessions)
      .innerJoin(crmUsers, eq(crmSessions.userId, crmUsers.id))
      .where(eq(crmSessions.tokenHash, tokenHash))
      .limit(1);

    const row = rows[0];
    if (!row) {
      return { status: "unauthenticated", reason: "not_found" };
    }

    const validity = evaluateStoredSessionValidity(
      {
        roleId: row.userRoleId,
        accountStatus: row.userAccountStatus,
        expiresAt: row.expiresAt,
        idleExpiresAt: row.idleExpiresAt,
        revokedAt: row.revokedAt,
      },
      now,
    );

    if (!validity.valid) {
      if (validity.reason !== "revoked") {
        const nowStr = toMysqlUtcDateTime(now);
        await db
          .update(crmSessions)
          .set({ revokedAt: nowStr, revokeReason: validity.reason })
          .where(and(eq(crmSessions.id, row.sessionId), isNull(crmSessions.revokedAt)));
        await appendAuditEvent(db, {
          userId: row.userId,
          eventType:
            validity.reason === "idle_expired" || validity.reason === "absolute_expired"
              ? "session_expired"
              : "session_revoked",
          sessionId: row.sessionId,
          ipPrefix: options.ipPrefix ?? null,
          detail: validity.reason,
          now,
        });
      }
      return { status: "unauthenticated", reason: validity.reason };
    }

    let nextIdleExpiry = validity.idleExpiry;
    if (options.slideIdle !== false) {
      const candidateIdleMs = Math.min(
        addSeconds(now, env.SESSION_IDLE_TTL_SECONDS).getTime(),
        validity.absExpiry.getTime(),
      );
      nextIdleExpiry = new Date(candidateIdleMs);
      await db
        .update(crmSessions)
        .set({
          idleExpiresAt: toMysqlUtcDateTime(nextIdleExpiry),
          lastSeenAt: toMysqlUtcDateTime(now),
        })
        .where(and(eq(crmSessions.id, row.sessionId), isNull(crmSessions.revokedAt)));
    }

    return {
      status: "authenticated",
      sessionId: row.sessionId,
      user: {
        id: row.userId,
        email: row.userEmail,
        name: row.userName,
        roleId: "owner",
      },
      idleExpiresAt: nextIdleExpiry.toISOString(),
      expiresAt: validity.absExpiry.toISOString(),
    };
  } catch (error) {
    console.error("[authService] Session validation failure", {
      name: error instanceof Error ? error.name : "Error",
    });
    return { status: "db_error" };
  }
}

export async function loginOwnerAccount(
  input: { email: unknown; password: unknown; request: Request },
  env: ServerEnv,
  now: Date = new Date(),
): Promise<LoginResult> {
  if (typeof input.email !== "string" || !isValidAccountEmail(input.email)) {
    return {
      ok: false,
      status: 400,
      code: "validation_error",
      message: "Enter a valid email address.",
    };
  }
  if (!validateLoginPasswordInput(input.password)) {
    return {
      ok: false,
      status: 400,
      code: "validation_error",
      message: "Enter your password.",
    };
  }

  const db = getDatabase();
  if (!db) {
    return {
      ok: false,
      status: 503,
      code: "auth_unavailable",
      message: "Authentication database is not configured.",
    };
  }

  const normalizedEmail = normalizeAccountEmail(input.email);
  const ipPrefix = maskIpPrefix(getClientIp(input.request, env));
  const emailHash = hashAuditIdentifier(normalizedEmail);
  const uaHash = hashUserAgent(input.request);
  const rlKeys = buildRateLimitKeys(ipPrefix, normalizedEmail);
  const rlPolicy = getRateLimitPolicy(env);

  try {
    const preCheck = await checkLoginRateLimits(db, rlKeys, rlPolicy, now);
    if (preCheck.blocked) {
      await appendAuditEvent(db, {
        userId: null,
        eventType: "login_rate_limited",
        emailHash,
        ipPrefix,
        detail: "active_lockout",
        now,
      });
      return {
        ok: false,
        status: 429,
        code: "rate_limited",
        message: `Too many failed sign-in attempts. Wait ${preCheck.retryAfterSeconds} seconds before trying again.`,
        retryAfterSeconds: preCheck.retryAfterSeconds,
      };
    }

    const users = await db
      .select({
        id: crmUsers.id,
        email: crmUsers.email,
        name: crmUsers.name,
        roleId: crmUsers.roleId,
        accountStatus: crmUsers.accountStatus,
        passwordHash: crmUsers.passwordHash,
      })
      .from(crmUsers)
      .where(eq(crmUsers.email, normalizedEmail))
      .limit(1);

    const user = users[0];
    let verified = false;
    let failureDetail = "unknown_email";

    if (user && user.roleId === "owner" && user.accountStatus === "active") {
      verified = await verifyPassword(input.password, user.passwordHash);
      if (!verified) {
        failureDetail = "bad_password";
      }
    } else {
      await verifyDummyPassword(input.password);
      if (user) {
        failureDetail = user.roleId !== "owner" ? "non_owner_role" : `status_${user.accountStatus}`;
      }
    }

    if (!verified || !user) {
      const nextRl = await recordFailedLoginAttempt(db, rlKeys, rlPolicy, now);
      await appendAuditEvent(db, {
        userId: user ? user.id : null,
        eventType: "login_failed",
        emailHash,
        ipPrefix,
        detail: failureDetail,
        now,
      });

      if (nextRl.blocked) {
        await appendAuditEvent(db, {
          userId: user ? user.id : null,
          eventType: "login_rate_limited",
          emailHash,
          ipPrefix,
          detail: "threshold_reached",
          now,
        });
        return {
          ok: false,
          status: 429,
          code: "rate_limited",
          message: `Too many failed sign-in attempts. Wait ${nextRl.retryAfterSeconds} seconds before trying again.`,
          retryAfterSeconds: nextRl.retryAfterSeconds,
        };
      }

      return {
        ok: false,
        status: 401,
        code: "invalid_credentials",
        message: "Invalid email or password.",
      };
    }

    const rawToken = generateSessionToken();
    const tokenHash = hashSessionToken(rawToken);
    const sessionId = generateServerId("sess");
    const absExpiry = addSeconds(now, env.SESSION_ABSOLUTE_TTL_SECONDS);
    const idleExpiry = addSeconds(
      now,
      Math.min(env.SESSION_IDLE_TTL_SECONDS, env.SESSION_ABSOLUTE_TTL_SECONDS),
    );
    const nowStr = toMysqlUtcDateTime(now);

    await db.transaction(async (tx) => {
      await tx.insert(crmSessions).values({
        id: sessionId,
        userId: user.id,
        tokenHash,
        expiresAt: toMysqlUtcDateTime(absExpiry),
        idleExpiresAt: toMysqlUtcDateTime(idleExpiry),
        lastSeenAt: nowStr,
        revokedAt: null,
        revokeReason: null,
        ipPrefix,
        userAgentHash: uaHash,
        createdAt: nowStr,
      });

      await tx
        .update(crmUsers)
        .set({
          lastLoginAt: nowStr,
          updatedAt: nowStr,
        })
        .where(eq(crmUsers.id, user.id));

      await tx.insert(crmAuthAudit).values({
        id: generateServerId("audit"),
        userId: user.id,
        eventType: "login_success",
        emailHash,
        sessionId,
        ipPrefix,
        detail: null,
        createdAt: nowStr,
      });
    });

    await clearRateLimitsOnLoginSuccess(db, rlKeys);

    return {
      ok: true,
      token: rawToken,
      maxAgeSeconds: env.SESSION_ABSOLUTE_TTL_SECONDS,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        roleId: "owner",
      },
      idleExpiresAt: idleExpiry.toISOString(),
      expiresAt: absExpiry.toISOString(),
    };
  } catch (error) {
    console.error("[authService] Login failure", {
      name: error instanceof Error ? error.name : "Error",
    });
    return {
      ok: false,
      status: 503,
      code: "auth_unavailable",
      message: "Authentication service is temporarily unavailable.",
    };
  }
}

export async function logoutCurrentSession(
  token: string | null | undefined,
  request: Request,
  env: ServerEnv,
  now: Date = new Date(),
): Promise<LogoutResult> {
  const ipPrefix = maskIpPrefix(getClientIp(request, env));
  const resolved = await resolveAuthenticatedSession(token, env, {
    now,
    ipPrefix,
    slideIdle: false,
  });

  if (resolved.status === "unconfigured" || resolved.status === "db_error") {
    return {
      ok: false,
      status: 503,
      code: "auth_unavailable",
      message: "Authentication database is unavailable.",
    };
  }
  if (resolved.status !== "authenticated") {
    return {
      ok: false,
      status: 401,
      code: "unauthenticated",
      message: "Authentication required.",
    };
  }

  const db = getDatabase();
  if (!db) {
    return {
      ok: false,
      status: 503,
      code: "auth_unavailable",
      message: "Authentication database is unavailable.",
    };
  }

  const nowStr = toMysqlUtcDateTime(now);
  try {
    await db.transaction(async (tx) => {
      await tx
        .update(crmSessions)
        .set({ revokedAt: nowStr, revokeReason: "logout" })
        .where(and(eq(crmSessions.id, resolved.sessionId), isNull(crmSessions.revokedAt)));

      await tx.insert(crmAuthAudit).values({
        id: generateServerId("audit"),
        userId: resolved.user.id,
        eventType: "logout",
        emailHash: hashAuditIdentifier(resolved.user.email),
        sessionId: resolved.sessionId,
        ipPrefix,
        detail: "single_session",
        createdAt: nowStr,
      });
    });

    return { ok: true, revokedCount: 1 };
  } catch (error) {
    console.error("[authService] Logout failure", {
      name: error instanceof Error ? error.name : "Error",
    });
    return {
      ok: false,
      status: 503,
      code: "auth_unavailable",
      message: "Unable to complete sign-out right now.",
    };
  }
}

export async function logoutAllSessions(
  token: string | null | undefined,
  request: Request,
  env: ServerEnv,
  now: Date = new Date(),
): Promise<LogoutResult> {
  const ipPrefix = maskIpPrefix(getClientIp(request, env));
  const resolved = await resolveAuthenticatedSession(token, env, {
    now,
    ipPrefix,
    slideIdle: false,
  });

  if (resolved.status === "unconfigured" || resolved.status === "db_error") {
    return {
      ok: false,
      status: 503,
      code: "auth_unavailable",
      message: "Authentication database is unavailable.",
    };
  }
  if (resolved.status !== "authenticated") {
    return {
      ok: false,
      status: 401,
      code: "unauthenticated",
      message: "Authentication required.",
    };
  }

  const db = getDatabase();
  if (!db) {
    return {
      ok: false,
      status: 503,
      code: "auth_unavailable",
      message: "Authentication database is unavailable.",
    };
  }

  const nowStr = toMysqlUtcDateTime(now);
  try {
    const activeRows = await db
      .select({ id: crmSessions.id })
      .from(crmSessions)
      .where(and(eq(crmSessions.userId, resolved.user.id), isNull(crmSessions.revokedAt)));

    await db.transaction(async (tx) => {
      await tx
        .update(crmSessions)
        .set({ revokedAt: nowStr, revokeReason: "logout_all" })
        .where(and(eq(crmSessions.userId, resolved.user.id), isNull(crmSessions.revokedAt)));

      await tx.insert(crmAuthAudit).values({
        id: generateServerId("audit"),
        userId: resolved.user.id,
        eventType: "logout_all",
        emailHash: hashAuditIdentifier(resolved.user.email),
        sessionId: resolved.sessionId,
        ipPrefix,
        detail: `revoked_${activeRows.length}`,
        createdAt: nowStr,
      });
    });

    return { ok: true, revokedCount: activeRows.length };
  } catch (error) {
    console.error("[authService] Logout-all failure", {
      name: error instanceof Error ? error.name : "Error",
    });
    return {
      ok: false,
      status: 503,
      code: "auth_unavailable",
      message: "Unable to revoke active sessions right now.",
    };
  }
}

/**
 * Isolated helper used by server bootstrap tests (and mirrored in `scripts/bootstrap-owner.mjs`).
 * Never holds default/hardcoded credentials.
 */
export async function upsertOwnerBootstrapAccount(
  db: CrmDatabase,
  input: {
    email: string;
    name: string;
    password: string;
    resetPassword?: boolean;
  },
  now: Date = new Date(),
): Promise<{ status: "created" | "password_reset"; userId: string; email: string }> {
  if (!isValidAccountEmail(input.email)) {
    throw new Error("Bootstrap owner email is invalid.");
  }
  const normalizedEmail = normalizeAccountEmail(input.email);
  const trimmedName = input.name.trim() || "Owner";
  if (trimmedName.length > 120) {
    throw new Error("Bootstrap owner name must be 120 characters or fewer.");
  }

  const passwordHash = await hashPassword(input.password);
  const nowStr = toMysqlUtcDateTime(now);

  const existingOwners = await db
    .select({ id: crmUsers.id, email: crmUsers.email, version: crmUsers.version })
    .from(crmUsers)
    .where(eq(crmUsers.roleId, "owner"))
    .limit(1);

  const existingOwner = existingOwners[0];
  if (!existingOwner) {
    const conflictingEmail = await db
      .select({ id: crmUsers.id })
      .from(crmUsers)
      .where(eq(crmUsers.email, normalizedEmail))
      .limit(1);
    if (conflictingEmail[0]) {
      throw new Error("That email is already assigned to another non-owner record.");
    }

    const userId = generateServerId("usr_owner");
    await db.transaction(async (tx) => {
      await tx.insert(crmUsers).values({
        id: userId,
        email: normalizedEmail,
        name: trimmedName,
        roleId: "owner",
        accountStatus: "active",
        passwordHash,
        lastLoginAt: null,
        version: 1,
        createdAt: nowStr,
        updatedAt: nowStr,
      });
      await tx.insert(crmAuthAudit).values({
        id: generateServerId("audit"),
        userId,
        eventType: "owner_bootstrapped",
        emailHash: hashAuditIdentifier(normalizedEmail),
        sessionId: null,
        ipPrefix: "cli",
        detail: "created",
        createdAt: nowStr,
      });
    });
    return { status: "created", userId, email: normalizedEmail };
  }

  if (!input.resetPassword) {
    throw new Error("Owner account already exists. Pass --reset-password to rotate password.");
  }

  await db.transaction(async (tx) => {
    await tx
      .update(crmUsers)
      .set({
        email: normalizedEmail,
        name: trimmedName,
        accountStatus: "active",
        passwordHash,
        version: existingOwner.version + 1,
        updatedAt: nowStr,
      })
      .where(eq(crmUsers.id, existingOwner.id));

    await tx
      .update(crmSessions)
      .set({ revokedAt: nowStr, revokeReason: "password_reset" })
      .where(and(eq(crmSessions.userId, existingOwner.id), isNull(crmSessions.revokedAt)));

    await tx.insert(crmAuthAudit).values({
      id: generateServerId("audit"),
      userId: existingOwner.id,
      eventType: "owner_password_reset",
      emailHash: hashAuditIdentifier(normalizedEmail),
      sessionId: null,
      ipPrefix: "cli",
      detail: "sessions_revoked",
      createdAt: nowStr,
    });
  });

  return { status: "password_reset", userId: existingOwner.id, email: normalizedEmail };
}
