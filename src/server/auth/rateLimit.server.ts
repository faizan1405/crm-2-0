import "@tanstack/react-start/server-only";
import { and, eq, inArray, lte } from "drizzle-orm";
import type { CrmDatabase } from "../db/index.server";
import { crmAuthRateLimits } from "../db/schema.server";
import { addSeconds, parseUtcDateTime, toMysqlUtcDateTime } from "../db/utc.server";

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
