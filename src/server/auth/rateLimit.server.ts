import "@tanstack/react-start/server-only";
import { createHash } from "node:crypto";
import { and, eq, inArray, lte } from "drizzle-orm";
import type { CrmDatabase } from "../db/index.server";
import { crmAuthRateLimits } from "../db/schema.server";
import { addSeconds, parseUtcDateTime, toMysqlUtcDateTime } from "../db/utc.server";
import { isMysqlDuplicateKeyError } from "../crm/errors.server";

export interface RateLimitPolicy {
  maxAttempts: number;
  windowSeconds: number;
  lockoutSeconds: number;
}

export interface RateLimitStateSnapshot {
  attemptCount: number;
  windowStartedAt: string;
  blockedUntil: string | null;
}

export interface RateLimitCheckResult {
  blocked: boolean;
  retryAfterSeconds: number;
}

/**
 * Evaluates whether an existing rate-limit row currently blocks requests at `now`.
 */
export function evaluateRateLimitBlock(
  existing: RateLimitStateSnapshot | null,
  policy: RateLimitPolicy,
  now: Date,
): RateLimitCheckResult {
  if (!existing || !existing.blockedUntil) {
    return { blocked: false, retryAfterSeconds: 0 };
  }
  const blockedUntil = parseUtcDateTime(existing.blockedUntil);
  if (Number.isNaN(blockedUntil.getTime()) || now >= blockedUntil) {
    return { blocked: false, retryAfterSeconds: 0 };
  }
  const remainingMs = blockedUntil.getTime() - now.getTime();
  return {
    blocked: true,
    retryAfterSeconds: Math.max(1, Math.ceil(remainingMs / 1000)),
  };
}

/**
 * Pure deterministic transition on a failed login attempt for unit testing and MySQL writes.
 */
export function nextRateLimitStateOnFailure(
  existing: RateLimitStateSnapshot | null,
  policy: RateLimitPolicy,
  now: Date,
): { nextState: RateLimitStateSnapshot; blocked: boolean; retryAfterSeconds: number } {
  const nowStr = toMysqlUtcDateTime(now);
  const existingCheck = evaluateRateLimitBlock(existing, policy, now);
  if (existingCheck.blocked && existing) {
    return {
      nextState: existing,
      blocked: true,
      retryAfterSeconds: existingCheck.retryAfterSeconds,
    };
  }

  let resetWindow = !existing;
  if (existing) {
    const windowEnd = addSeconds(parseUtcDateTime(existing.windowStartedAt), policy.windowSeconds);
    const prevBlockExpired =
      existing.blockedUntil !== null && now >= parseUtcDateTime(existing.blockedUntil);
    if (Number.isNaN(windowEnd.getTime()) || now >= windowEnd || prevBlockExpired) {
      resetWindow = true;
    }
  }

  const nextCount = resetWindow ? 1 : (existing?.attemptCount ?? 0) + 1;
  const nextWindowStart = resetWindow ? nowStr : existing!.windowStartedAt;

  if (nextCount >= policy.maxAttempts) {
    const blockedUntilDate = addSeconds(now, policy.lockoutSeconds);
    return {
      nextState: {
        attemptCount: nextCount,
        windowStartedAt: nextWindowStart,
        blockedUntil: toMysqlUtcDateTime(blockedUntilDate),
      },
      blocked: true,
      retryAfterSeconds: Math.max(1, policy.lockoutSeconds),
    };
  }

  return {
    nextState: {
      attemptCount: nextCount,
      windowStartedAt: nextWindowStart,
      blockedUntil: null,
    },
    blocked: false,
    retryAfterSeconds: 0,
  };
}

export async function checkLoginRateLimits(
  db: CrmDatabase,
  keys: { ipEmailKey: string; emailGlobalKey: string },
  policy: RateLimitPolicy,
  now: Date = new Date(),
): Promise<RateLimitCheckResult> {
  const rows = await db
    .select()
    .from(crmAuthRateLimits)
    .where(inArray(crmAuthRateLimits.limitKey, [keys.ipEmailKey, keys.emailGlobalKey]));

  let maxRetryAfter = 0;
  for (const row of rows) {
    const isGlobal = row.limitKey === keys.emailGlobalKey;
    const bucketPolicy: RateLimitPolicy = isGlobal
      ? { ...policy, maxAttempts: policy.maxAttempts * 3 }
      : policy;
    const status = evaluateRateLimitBlock(
      {
        attemptCount: row.attemptCount,
        windowStartedAt: row.windowStartedAt,
        blockedUntil: row.blockedUntil,
      },
      bucketPolicy,
      now,
    );
    if (status.blocked && status.retryAfterSeconds > maxRetryAfter) {
      maxRetryAfter = status.retryAfterSeconds;
    }
  }

  return {
    blocked: maxRetryAfter > 0,
    retryAfterSeconds: maxRetryAfter,
  };
}

export async function recordFailedLoginAttempt(
  db: CrmDatabase,
  keys: { ipEmailKey: string; emailGlobalKey: string },
  policy: RateLimitPolicy,
  now: Date = new Date(),
): Promise<RateLimitCheckResult> {
  const nowStr = toMysqlUtcDateTime(now);
  let maxRetryAfter = 0;

  const updates: Array<{ key: string; policy: RateLimitPolicy }> = [
    { key: keys.ipEmailKey, policy },
    { key: keys.emailGlobalKey, policy: { ...policy, maxAttempts: policy.maxAttempts * 3 } },
  ];

  await db.transaction(async (tx) => {
    for (const item of updates) {
      const existingRows = await tx
        .select()
        .from(crmAuthRateLimits)
        .where(eq(crmAuthRateLimits.limitKey, item.key))
        .limit(1);
      const row = existingRows[0];
      const existing: RateLimitStateSnapshot | null = row
        ? {
            attemptCount: row.attemptCount,
            windowStartedAt: row.windowStartedAt,
            blockedUntil: row.blockedUntil,
          }
        : null;

      const transition = nextRateLimitStateOnFailure(existing, item.policy, now);
      if (transition.blocked && transition.retryAfterSeconds > maxRetryAfter) {
        maxRetryAfter = transition.retryAfterSeconds;
      }

      if (row) {
        await tx
          .update(crmAuthRateLimits)
          .set({
            attemptCount: transition.nextState.attemptCount,
            windowStartedAt: transition.nextState.windowStartedAt,
            blockedUntil: transition.nextState.blockedUntil,
            updatedAt: nowStr,
          })
          .where(eq(crmAuthRateLimits.limitKey, item.key));
      } else {
        await tx.insert(crmAuthRateLimits).values({
          limitKey: item.key,
          attemptCount: transition.nextState.attemptCount,
          windowStartedAt: transition.nextState.windowStartedAt,
          blockedUntil: transition.nextState.blockedUntil,
          updatedAt: nowStr,
        });
      }
    }

    // Best-effort bounded cleanup of stale unlocked buckets older than window + lockout.
    const cutoff = toMysqlUtcDateTime(
      addSeconds(now, -(policy.windowSeconds + policy.lockoutSeconds + 3600)),
    );
    await tx.delete(crmAuthRateLimits).where(and(lte(crmAuthRateLimits.updatedAt, cutoff)));
  });

  return {
    blocked: maxRetryAfter > 0,
    retryAfterSeconds: maxRetryAfter,
  };
}

export async function clearRateLimitsOnLoginSuccess(
  db: CrmDatabase,
  keys: { ipEmailKey: string; emailGlobalKey: string },
): Promise<void> {
  await db
    .delete(crmAuthRateLimits)
    .where(inArray(crmAuthRateLimits.limitKey, [keys.ipEmailKey, keys.emailGlobalKey]));
}

export interface FixedWindowRateLimitPolicy {
  maxRequests: number;
  windowSeconds: number;
}

export interface FixedWindowRateLimitResult {
  blocked: boolean;
  retryAfterSeconds: number;
  remaining: number;
}

/**
 * Pure state transition for fixed-window request rate limiting.
 */
export function nextFixedWindowRateLimitState(
  existing: RateLimitStateSnapshot | null,
  policy: FixedWindowRateLimitPolicy,
  now: Date,
): {
  nextState: RateLimitStateSnapshot;
  blocked: boolean;
  retryAfterSeconds: number;
  remaining: number;
} {
  const nowStr = toMysqlUtcDateTime(now);
  let resetWindow = !existing;
  let windowEnd: Date | null = null;
  if (existing) {
    windowEnd = addSeconds(parseUtcDateTime(existing.windowStartedAt), policy.windowSeconds);
    if (Number.isNaN(windowEnd.getTime()) || now >= windowEnd) {
      resetWindow = true;
    }
  }

  if (resetWindow || !existing || !windowEnd) {
    return {
      nextState: {
        attemptCount: 1,
        windowStartedAt: nowStr,
        blockedUntil: null,
      },
      blocked: false,
      retryAfterSeconds: 0,
      remaining: Math.max(0, policy.maxRequests - 1),
    };
  }

  if (existing.attemptCount >= policy.maxRequests) {
    const retryAfterSeconds = Math.max(1, Math.ceil((windowEnd.getTime() - now.getTime()) / 1000));
    return {
      nextState: {
        attemptCount: existing.attemptCount,
        windowStartedAt: existing.windowStartedAt,
        blockedUntil: toMysqlUtcDateTime(windowEnd),
      },
      blocked: true,
      retryAfterSeconds,
      remaining: 0,
    };
  }

  const nextCount = existing.attemptCount + 1;
  return {
    nextState: {
      attemptCount: nextCount,
      windowStartedAt: existing.windowStartedAt,
      blockedUntil: null,
    },
    blocked: false,
    retryAfterSeconds: 0,
    remaining: Math.max(0, policy.maxRequests - nextCount),
  };
}

/**
 * Consumes one request token from a MySQL-backed fixed-window rate limiter keyed by a 64-char hash.
 */
export async function consumeFixedWindowRateLimit(
  db: CrmDatabase,
  rawLimitKey: string,
  policy: FixedWindowRateLimitPolicy,
  now: Date = new Date(),
): Promise<FixedWindowRateLimitResult> {
  const hashedKey = createHash("sha256").update(rawLimitKey).digest("hex");
  const nowStr = toMysqlUtcDateTime(now);

  return db.transaction(async (tx) => {
    let rows = await tx
      .select()
      .from(crmAuthRateLimits)
      .where(eq(crmAuthRateLimits.limitKey, hashedKey))
      .for("update")
      .limit(1);

    if (!rows[0]) {
      const initial = nextFixedWindowRateLimitState(null, policy, now);
      try {
        await tx.insert(crmAuthRateLimits).values({
          limitKey: hashedKey,
          attemptCount: initial.nextState.attemptCount,
          windowStartedAt: initial.nextState.windowStartedAt,
          blockedUntil: initial.nextState.blockedUntil,
          updatedAt: nowStr,
        });
        return {
          blocked: initial.blocked,
          retryAfterSeconds: initial.retryAfterSeconds,
          remaining: initial.remaining,
        };
      } catch (err) {
        if (!isMysqlDuplicateKeyError(err)) {
          throw err;
        }
        rows = await tx
          .select()
          .from(crmAuthRateLimits)
          .where(eq(crmAuthRateLimits.limitKey, hashedKey))
          .for("update")
          .limit(1);
      }
    }

    const row = rows[0];
    const transition = nextFixedWindowRateLimitState(
      row
        ? {
            attemptCount: row.attemptCount,
            windowStartedAt: row.windowStartedAt,
            blockedUntil: row.blockedUntil,
          }
        : null,
      policy,
      now,
    );

    await tx
      .update(crmAuthRateLimits)
      .set({
        attemptCount: transition.nextState.attemptCount,
        windowStartedAt: transition.nextState.windowStartedAt,
        blockedUntil: transition.nextState.blockedUntil,
        updatedAt: nowStr,
      })
      .where(eq(crmAuthRateLimits.limitKey, hashedKey));

    return {
      blocked: transition.blocked,
      retryAfterSeconds: transition.retryAfterSeconds,
      remaining: transition.remaining,
    };
  });
}
