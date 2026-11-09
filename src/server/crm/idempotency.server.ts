import "@tanstack/react-start/server-only";
import crypto from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { CrmDatabase } from "../db/index.server";
import { crmIdempotencyKeys } from "../db/schema.server";
import { parseUtcDateTime, toMysqlUtcDateTime } from "../db/utc.server";
import { generateServerId } from "../auth/security.server";
import { CrmServiceError, isMysqlDuplicateKeyError } from "./errors.server";

export type CrmTransaction = Parameters<Parameters<CrmDatabase["transaction"]>[0]>[0];
export type CrmDbExecutor = CrmDatabase | CrmTransaction;

export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60_000;
const IDEM_KEY_MAX_LENGTH = 128;

function hasControlCharacters(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) {
      return true;
    }
  }
  return false;
}

/**
 * Produces deterministic JSON-compatible structure with sorted object keys for request hashing.
 */
export function canonicalizeValue(value: unknown): unknown {
  if (value === null || value === undefined) {
    return null;
  }
  if (Array.isArray(value)) {
    return value.map((item) => (item === undefined ? null : canonicalizeValue(item)));
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b));
    for (const [k, v] of entries) {
      out[k] = canonicalizeValue(v);
    }
    return out;
  }
  return value;
}

export function hashIdempotentRequest(scope: string, payload: unknown): string {
  const encoded = JSON.stringify({
    scope,
    payload: canonicalizeValue(payload),
  });
  return crypto.createHash("sha256").update(encoded, "utf8").digest("hex");
}

export function resolveEffectiveIdempotencyKey(options: {
  headerKey?: string | null | undefined;
  bodyKey?: string | null | undefined;
  opId?: string | null | undefined;
}): string | null {
  const header = options.headerKey?.trim() || null;
  const body = options.bodyKey?.trim() || null;
  const op = options.opId?.trim() || null;

  for (const candidate of [header, body, op]) {
    if (!candidate) continue;
    if (candidate.length > IDEM_KEY_MAX_LENGTH || hasControlCharacters(candidate)) {
      throw new CrmServiceError(
        400,
        "validation_error",
        "Idempotency key must be 128 characters or fewer and contain no control characters.",
      );
    }
  }

  if (header && body && header !== body) {
    throw new CrmServiceError(
      400,
      "validation_error",
      "Idempotency-Key header does not match body idempotencyKey.",
    );
  }

  return header ?? body ?? op ?? null;
}

export type IdempotencyLookupResult<TBody> =
  { hit: false } | { hit: true; status: number; body: TBody };

export async function findOrVerifyIdempotencyReplay<TBody>(
  tx: CrmTransaction,
  params: {
    ownerUserId: string;
    scope: string;
    idemKey: string;
    requestHash: string;
    now: Date;
  },
): Promise<IdempotencyLookupResult<TBody>> {
  const rows = await tx
    .select()
    .from(crmIdempotencyKeys)
    .where(
      and(
        eq(crmIdempotencyKeys.ownerUserId, params.ownerUserId),
        eq(crmIdempotencyKeys.scope, params.scope),
        eq(crmIdempotencyKeys.idemKey, params.idemKey),
      ),
    )
    .limit(1)
    .for("update");

  const existing = rows[0];
  if (!existing) {
    return { hit: false };
  }

  const expiresAt = parseUtcDateTime(existing.expiresAt);
  if (!Number.isNaN(expiresAt.getTime()) && params.now >= expiresAt) {
    await tx.delete(crmIdempotencyKeys).where(eq(crmIdempotencyKeys.id, existing.id));
    return { hit: false };
  }

  if (existing.requestHash !== params.requestHash) {
    throw new CrmServiceError(
      409,
      "idempotency_key_mismatch",
      "Idempotency key was already used with a different request payload.",
    );
  }

  return {
    hit: true,
    status: existing.responseStatus,
    body: JSON.parse(existing.responseBodyJson) as TBody,
  };
}

export async function storeIdempotencyResponse(
  tx: CrmTransaction,
  params: {
    ownerUserId: string;
    scope: string;
    idemKey: string;
    requestHash: string;
    resourceId: string | null;
    responseStatus: number;
    responseBody: unknown;
    now: Date;
  },
): Promise<void> {
  const nowStr = toMysqlUtcDateTime(params.now);
  const expiresAtStr = toMysqlUtcDateTime(new Date(params.now.getTime() + IDEMPOTENCY_TTL_MS));
  await tx.insert(crmIdempotencyKeys).values({
    id: generateServerId("idem"),
    ownerUserId: params.ownerUserId,
    scope: params.scope,
    idemKey: params.idemKey,
    requestHash: params.requestHash,
    resourceId: params.resourceId,
    responseStatus: params.responseStatus,
    responseBodyJson: JSON.stringify(params.responseBody),
    createdAt: nowStr,
    expiresAt: expiresAtStr,
  });
}

/**
 * Runs a transactional operation with optional idempotency replay protection,
 * safely handling concurrent duplicate requests that race on the unique key.
 */
export async function runWithIdempotency<TBody>(
  db: CrmDatabase,
  options: {
    ownerUserId: string;
    scope: string;
    idemKey: string | null;
    requestHash: string;
    now: Date;
  },
  work: (tx: CrmTransaction) => Promise<{ status: number; body: TBody; resourceId: string | null }>,
): Promise<{ status: number; body: TBody; replayed: boolean }> {
  const execute = () =>
    db.transaction(async (tx) => {
      if (options.idemKey) {
        const hit = await findOrVerifyIdempotencyReplay<TBody>(tx, {
          ownerUserId: options.ownerUserId,
          scope: options.scope,
          idemKey: options.idemKey,
          requestHash: options.requestHash,
          now: options.now,
        });
        if (hit.hit) {
          return { status: hit.status, body: hit.body, replayed: true };
        }
      }

      const result = await work(tx);

      if (options.idemKey) {
        await storeIdempotencyResponse(tx, {
          ownerUserId: options.ownerUserId,
          scope: options.scope,
          idemKey: options.idemKey,
          requestHash: options.requestHash,
          resourceId: result.resourceId,
          responseStatus: result.status,
          responseBody: result.body,
          now: options.now,
        });
      }

      return { status: result.status, body: result.body, replayed: false };
    });

  try {
    return await execute();
  } catch (error) {
    if (options.idemKey && isMysqlDuplicateKeyError(error)) {
      const winner = await db.transaction(async (tx) =>
        findOrVerifyIdempotencyReplay<TBody>(tx, {
          ownerUserId: options.ownerUserId,
          scope: options.scope,
          idemKey: options.idemKey!,
          requestHash: options.requestHash,
          now: options.now,
        }),
      );
      if (winner.hit) {
        return { status: winner.status, body: winner.body, replayed: true };
      }
    }
    throw error;
  }
}
