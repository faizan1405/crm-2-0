import "@tanstack/react-start/server-only";
import { and, desc, eq, sql } from "drizzle-orm";
import { generateServerId } from "../auth/security.server";
import type { CrmDatabase } from "../db/index.server";
import {
  crmDeals,
  crmFinanceEvents,
  crmLeadActivities,
  crmPaymentProofs,
  crmPayments,
} from "../db/schema.server";
import { toMysqlUtcDateTime } from "../db/utc.server";
import { getProofStorageBackend, type ProofStorageBackend } from "../storage/proofStorage.server";
import type { MariadbQuotaPolicy } from "../config/env.server";
import {
  enforceMariadbProofQuota,
  markMariadbQuotaCheckedInScope,
  withMariadbCapacityWriteLock,
  type MariadbCapacityLogEvent,
} from "../storage/mariadbCapacity.server";
import { toIstParts } from "./dates.server";
import { CrmServiceError } from "./errors.server";
import { hashIdempotentRequest, runWithIdempotency } from "./idempotency.server";
import {
  toFinanceEventDto,
  toPaymentProofDto,
  type FinanceEventDto,
  type PaymentProofDto,
  type PaymentProofRow,
} from "./mappers.server";
import type {
  ListProofHistoryQuery,
  RemoveProofInput,
  ReplaceProofInput,
} from "./validation.server";

export interface AttachProofPayload {
  originalFileName: string;
  declaredMimeType?: string | null | undefined;
  streamOrBuffer: Buffer | Uint8Array | NodeJS.ReadableStream | ReadableStream<Uint8Array>;
  maxBytes?: number | undefined;
}

function assertProofStorageOperational(storage: ProofStorageBackend): void {
  const health = storage.healthSummary();
  if (health.failClosed || !health.writable) {
    throw new CrmServiceError(
      503,
      health.blockedCode ?? "storage_not_configured",
      health.reasons?.[0] ??
        "Private payment proof storage is not durably configured for this runtime.",
    );
  }
}

interface CapacityHookableStorage extends ProofStorageBackend {
  resolveCapacityOptions?: () => {
    policy: MariadbQuotaPolicy;
    retainHistoricalBlobs: boolean;
    onCapacityEvent?: ((entry: MariadbCapacityLogEvent) => void) | undefined;
  };
}

function resolveMariadbCapacitySettings(
  storage: ProofStorageBackend,
  options?: {
    quotaPolicy?: MariadbQuotaPolicy | undefined;
    retainHistoricalBlobs?: boolean | undefined;
    onCapacityEvent?: ((entry: MariadbCapacityLogEvent) => void) | undefined;
  },
) {
  const isMariadb = storage.driver === "mariadb-blob";
  const hookable = storage as CapacityHookableStorage;
  const fromStorage =
    isMariadb && typeof hookable.resolveCapacityOptions === "function"
      ? hookable.resolveCapacityOptions()
      : undefined;

  return {
    isMariadb,
    policy: options?.quotaPolicy ?? fromStorage?.policy,
    retainHistoricalBlobs: options?.retainHistoricalBlobs ?? fromStorage?.retainHistoricalBlobs ?? true,
    onCapacityEvent: options?.onCapacityEvent ?? fromStorage?.onCapacityEvent,
  };
}

export async function attachPaymentProofRecord(
  db: CrmDatabase,
  ownerUserId: string,
  actorUserId: string,
  paymentId: string,
  payload: AttachProofPayload,
  options?: {
    idempotencyKey?: string | null | undefined;
    now?: Date | undefined;
    storageBackend?: ProofStorageBackend | undefined;
    hooks?: { afterPrimaryWrite?: () => void } | undefined;
    quotaPolicy?: MariadbQuotaPolicy | undefined;
    onCapacityEvent?: ((entry: MariadbCapacityLogEvent) => void) | undefined;
  },
): Promise<{
  status: number;
  replayed: boolean;
  body: {
    ok: true;
    proof: PaymentProofDto;
    auditEvent: FinanceEventDto;
  };
}> {
  const now = options?.now ?? new Date();
  const nowUtc = toMysqlUtcDateTime(now);
  const istDate = toIstParts(now).istDate;
  const storage = options?.storageBackend ?? getProofStorageBackend();
  assertProofStorageOperational(storage);

  // Step 1: Stage upload and validate file integrity, headers, declared MIME, and magic signature
  const staged = await storage.stageUpload({
    ownerUserId,
    originalFileName: payload.originalFileName,
    declaredMimeType: payload.declaredMimeType,
    streamOrBuffer: payload.streamOrBuffer,
    maxBytes: payload.maxBytes,
  });

  const idemKey = options?.idempotencyKey ?? null;
  const scope = `payment-proof:attach:${paymentId}`;
  const requestHash = hashIdempotentRequest(scope, {
    paymentId,
    sha256: staged.sha256,
    byteSize: staged.byteSize,
    originalName: staged.descriptor.sanitizedFileName,
  });

  let newlyPersistedKey: string | null = null;

  const capacitySettings = resolveMariadbCapacitySettings(storage, options);

  try {
    const runAttachTransaction = () =>
      runWithIdempotency<{
        ok: true;
        proof: PaymentProofDto;
        auditEvent: FinanceEventDto;
      }>(db, { ownerUserId, scope, idemKey, requestHash, now }, async (tx) => {
        // Step 2: Lock the payment row
        const paymentRows = await tx
          .select()
          .from(crmPayments)
          .where(and(eq(crmPayments.id, paymentId), eq(crmPayments.ownerUserId, ownerUserId)))
          .limit(1)
          .for("update");
        const payment = paymentRows[0];
        if (!payment) {
          throw new CrmServiceError(404, "not_found", "Payment not found.");
        }

        if (payment.voided) {
          throw new CrmServiceError(
            409,
            "payment_already_voided",
            "Cannot attach proof to a voided payment; voided transactions are immutable historical records.",
            { conflict: { paymentId: payment.id, status: payment.status } },
          );
        }

        // Step 3: Lock the deal row
        const dealRows = await tx
          .select()
          .from(crmDeals)
          .where(and(eq(crmDeals.id, payment.dealId), eq(crmDeals.ownerUserId, ownerUserId)))
          .limit(1)
          .for("update");
        const deal = dealRows[0];
        if (!deal || deal.status === "cancelled") {
          throw new CrmServiceError(
            409,
            "deal_cancelled",
            "Cannot attach proof to a payment on a cancelled deal.",
            { conflict: { dealId: payment.dealId } },
          );
        }

        // Step 4: Check if an active proof already exists
        const existingActiveRows = await tx
          .select()
          .from(crmPaymentProofs)
          .where(
            and(
              eq(crmPaymentProofs.ownerUserId, ownerUserId),
              eq(crmPaymentProofs.paymentId, paymentId),
              eq(crmPaymentProofs.activePaymentLock, paymentId),
            ),
          )
          .limit(1)
          .for("update");

        if (existingActiveRows[0]) {
          throw new CrmServiceError(
            409,
            "proof_already_exists",
            "Payment already has an active proof attachment. Use replace or remove to update.",
            { conflict: { paymentId, proofId: existingActiveRows[0].id } },
          );
        }

        // Step 4.5: Fail-closed MariaDB capacity limit enforcement under serialized write lock
        if (capacitySettings.isMariadb) {
          await enforceMariadbProofQuota({
            db,
            operation: "upload",
            paymentId,
            incomingBytes: staged.byteSize,
            retainHistoricalBlobs: capacitySettings.retainHistoricalBlobs,
            policy: capacitySettings.policy,
            onCapacityEvent: capacitySettings.onCapacityEvent,
          });
          markMariadbQuotaCheckedInScope(db);
        }

        // Step 5: Move staged file to permanent private storage and verify persisted integrity
      const proofId = generateServerId("proof");
      const persisted = await storage.persistStagedProof({
        ownerUserId,
        proofId,
        tempKey: staged.tempKey,
        ext: staged.descriptor.fileExtension,
        expectedSha256: staged.sha256,
        expectedByteSize: staged.byteSize,
      });
      newlyPersistedKey = persisted.storageKey;

      // Step 6: Insert proof row
      const newProofRow = {
        id: proofId,
        ownerUserId,
        paymentId,
        dealId: payment.dealId,
        legacyAttachmentId: null,
        originalFileName: staged.descriptor.sanitizedFileName,
        fileExtension: staged.descriptor.fileExtension,
        mimeType: staged.descriptor.mimeType,
        fileSize: persisted.byteSize,
        sha256Hash: persisted.sha256,
        storageDriver: storage.driver,
        storageKey: persisted.storageKey,
        storageStatus: "verified" as const,
        storageProviderId: storage.driver,
        verifiedAt: nowUtc,
        verificationError: null,
        lifecycleStatus: "active" as const,
        activePaymentLock: paymentId,
        replacedByProofId: null,
        replacementReason: null,
        removalReason: null,
        uploadedByUserId: actorUserId,
        removedByUserId: null,
        version: 1,
        uploadedAt: nowUtc,
        removedAt: null,
        createdAt: nowUtc,
        updatedAt: nowUtc,
      };

      await tx.insert(crmPaymentProofs).values(newProofRow);

      // Step 7: Record financial audit event
      const financeEventId = generateServerId("fevt");
      const financeEventRow = {
        id: financeEventId,
        ownerUserId,
        dealId: payment.dealId,
        paymentId,
        leadId: deal.leadId,
        actorUserId,
        eventType: "proof.uploaded" as const,
        summary: `Payment proof attached: "${staged.descriptor.sanitizedFileName}" (${staged.descriptor.mimeType}, ${staged.byteSize} bytes)`,
        reason: null,
        amountSnapshot: payment.amount,
        beforeJson: null,
        afterJson: JSON.stringify({
          proofId,
          fileName: staged.descriptor.sanitizedFileName,
          mimeType: staged.descriptor.mimeType,
          fileSize: staged.byteSize,
          sha256: staged.sha256,
        }),
        leadActivityId: null as string | null,
        opId: null,
        occurredAt: nowUtc,
        occurredIstDate: istDate,
        createdAt: nowUtc,
      };

      if (deal.leadId) {
        const activityId = generateServerId("act");
        await tx.insert(crmLeadActivities).values({
          id: activityId,
          legacyId: null,
          ownerUserId,
          leadId: deal.leadId,
          actorUserId,
          type: "payment",
          text: `Payment proof attached for ₹${payment.amount}: "${staged.descriptor.sanitizedFileName}"`,
          outcome: null,
          occurredAt: nowUtc,
          opId: null,
          idempotencyKey: null,
          createdAt: nowUtc,
        });
        financeEventRow.leadActivityId = activityId;
      }

      await tx.insert(crmFinanceEvents).values(financeEventRow);

      options?.hooks?.afterPrimaryWrite?.();

      return {
        status: 201,
        resourceId: proofId,
        body: {
          ok: true as const,
          proof: toPaymentProofDto(newProofRow as PaymentProofRow),
          auditEvent: toFinanceEventDto(financeEventRow),
        },
      };
    });

    const result = capacitySettings.isMariadb
      ? await withMariadbCapacityWriteLock(db, runAttachTransaction)
      : await runAttachTransaction();

    if (result.replayed) {
      await storage.deleteTemp(staged.tempKey).catch(() => undefined);
    }

    return result;
  } catch (err) {
    // If the database transaction failed after writing the file, purge the newly persisted file (orphan prevention)
    if (newlyPersistedKey) {
      await storage.deletePrivateObject(newlyPersistedKey).catch(() => undefined);
    } else {
      await storage.deleteTemp(staged.tempKey).catch(() => undefined);
    }
    throw err;
  }
}

export async function replacePaymentProofRecord(
  db: CrmDatabase,
  ownerUserId: string,
  actorUserId: string,
  paymentId: string,
  payload: AttachProofPayload,
  input: ReplaceProofInput,
  options?: {
    idempotencyKey?: string | null | undefined;
    now?: Date | undefined;
    storageBackend?: ProofStorageBackend | undefined;
    hooks?: { afterPrimaryWrite?: () => void } | undefined;
    quotaPolicy?: MariadbQuotaPolicy | undefined;
    retainHistoricalBlobs?: boolean | undefined;
    onCapacityEvent?: ((entry: MariadbCapacityLogEvent) => void) | undefined;
  },
): Promise<{
  status: number;
  replayed: boolean;
  body: {
    ok: true;
    proof: PaymentProofDto;
    previousProof: PaymentProofDto;
    auditEvent: FinanceEventDto;
  };
}> {
  const now = options?.now ?? new Date();
  const nowUtc = toMysqlUtcDateTime(now);
  const istDate = toIstParts(now).istDate;
  const storage = options?.storageBackend ?? getProofStorageBackend();
  assertProofStorageOperational(storage);

  // Step 1: Stage upload and validate file integrity
  const staged = await storage.stageUpload({
    ownerUserId,
    originalFileName: payload.originalFileName,
    declaredMimeType: payload.declaredMimeType,
    streamOrBuffer: payload.streamOrBuffer,
    maxBytes: payload.maxBytes,
  });

  const idemKey = options?.idempotencyKey ?? null;
  const scope = `payment-proof:replace:${paymentId}`;
  const requestHash = hashIdempotentRequest(scope, {
    paymentId,
    sha256: staged.sha256,
    byteSize: staged.byteSize,
    originalName: staged.descriptor.sanitizedFileName,
    reason: input.reason ?? null,
  });

  let newlyPersistedKey: string | null = null;
  const capacitySettings = resolveMariadbCapacitySettings(storage, options);

  try {
    const runReplaceTransaction = () =>
      runWithIdempotency<{
        ok: true;
        proof: PaymentProofDto;
        previousProof: PaymentProofDto;
        auditEvent: FinanceEventDto;
      }>(db, { ownerUserId, scope, idemKey, requestHash, now }, async (tx) => {
      // Step 2: Lock the payment row
      const paymentRows = await tx
        .select()
        .from(crmPayments)
        .where(and(eq(crmPayments.id, paymentId), eq(crmPayments.ownerUserId, ownerUserId)))
        .limit(1)
        .for("update");
      const payment = paymentRows[0];
      if (!payment) {
        throw new CrmServiceError(404, "not_found", "Payment not found.");
      }

      if (payment.voided) {
        throw new CrmServiceError(
          409,
          "payment_already_voided",
          "Cannot replace proof on a voided payment; voided transactions are immutable historical records.",
          { conflict: { paymentId: payment.id, status: payment.status } },
        );
      }

      // Step 3: Lock deal row
      const dealRows = await tx
        .select()
        .from(crmDeals)
        .where(and(eq(crmDeals.id, payment.dealId), eq(crmDeals.ownerUserId, ownerUserId)))
        .limit(1)
        .for("update");
      const deal = dealRows[0];
      if (!deal || deal.status === "cancelled") {
        throw new CrmServiceError(
          409,
          "deal_cancelled",
          "Cannot replace proof on a payment belonging to a cancelled deal.",
          { conflict: { dealId: payment.dealId } },
        );
      }

      // Step 4: Lock existing active proof
      const existingActiveRows = await tx
        .select()
        .from(crmPaymentProofs)
        .where(
          and(
            eq(crmPaymentProofs.ownerUserId, ownerUserId),
            eq(crmPaymentProofs.paymentId, paymentId),
            eq(crmPaymentProofs.activePaymentLock, paymentId),
          ),
        )
        .limit(1)
        .for("update");
      const oldProof = existingActiveRows[0];

      if (!oldProof) {
        throw new CrmServiceError(
          404,
          "proof_not_found",
          "No active payment proof found to replace.",
          { conflict: { paymentId } },
        );
      }

      if (
        input.expectedProofVersion !== undefined &&
        oldProof.version !== input.expectedProofVersion
      ) {
        throw new CrmServiceError(
          409,
          "stale_conflict",
          "Payment proof was modified concurrently; reload and retry.",
          {
            conflict: {
              resource: "proof",
              id: oldProof.id,
              expectedVersion: input.expectedProofVersion,
              currentVersion: oldProof.version,
            },
          },
        );
      }

      // Step 4.5: Fail-closed MariaDB capacity limit enforcement under serialized write lock
      if (capacitySettings.isMariadb) {
        await enforceMariadbProofQuota({
          db,
          operation: "replace",
          paymentId,
          incomingBytes: staged.byteSize,
          existingProofBytes: oldProof.fileSize,
          retainHistoricalBlobs: capacitySettings.retainHistoricalBlobs,
          policy: capacitySettings.policy,
          onCapacityEvent: capacitySettings.onCapacityEvent,
        });
        markMariadbQuotaCheckedInScope(db);
      }

      // Step 5: Move new staged file to permanent private storage and verify persisted integrity
      const newProofId = generateServerId("proof");
      const persisted = await storage.persistStagedProof({
        ownerUserId,
        proofId: newProofId,
        tempKey: staged.tempKey,
        ext: staged.descriptor.fileExtension,
        expectedSha256: staged.sha256,
        expectedByteSize: staged.byteSize,
      });
      newlyPersistedKey = persisted.storageKey;

      // Step 6: Release active_payment_lock and mark old proof as replaced
      // Note: replacedByProofId is set after inserting newProofRow to satisfy foreign-key constraint.
      const updatedOldProof: PaymentProofRow = {
        ...oldProof,
        lifecycleStatus: "replaced",
        activePaymentLock: null,
        replacedByProofId: newProofId,
        replacementReason: input.reason ?? "Replaced with updated attachment.",
        version: oldProof.version + 1,
        updatedAt: nowUtc,
      };

      await tx
        .update(crmPaymentProofs)
        .set({
          lifecycleStatus: "replaced",
          activePaymentLock: null,
          replacementReason: input.reason ?? "Replaced with updated attachment.",
          version: sql`${crmPaymentProofs.version} + 1`,
          updatedAt: nowUtc,
        })
        .where(
          and(
            eq(crmPaymentProofs.id, oldProof.id),
            eq(crmPaymentProofs.ownerUserId, ownerUserId),
            eq(crmPaymentProofs.version, oldProof.version),
          ),
        );

      // Step 7: Insert new proof row
      const newProofRow: PaymentProofRow = {
        id: newProofId,
        ownerUserId,
        paymentId,
        dealId: payment.dealId,
        legacyAttachmentId: null,
        originalFileName: staged.descriptor.sanitizedFileName,
        fileExtension: staged.descriptor.fileExtension,
        mimeType: staged.descriptor.mimeType,
        fileSize: persisted.byteSize,
        sha256Hash: persisted.sha256,
        storageDriver: storage.driver,
        storageKey: persisted.storageKey,
        storageStatus: "verified",
        storageProviderId: storage.driver,
        verifiedAt: nowUtc,
        verificationError: null,
        lifecycleStatus: "active",
        activePaymentLock: paymentId,
        replacedByProofId: null,
        replacementReason: null,
        removalReason: null,
        uploadedByUserId: actorUserId,
        removedByUserId: null,
        version: 1,
        uploadedAt: nowUtc,
        removedAt: null,
        createdAt: nowUtc,
        updatedAt: nowUtc,
      };

      await tx.insert(crmPaymentProofs).values(newProofRow);

      // Link old proof to newly inserted proof to satisfy FK constraint
      await tx
        .update(crmPaymentProofs)
        .set({
          replacedByProofId: newProofId,
        })
        .where(eq(crmPaymentProofs.id, oldProof.id));

      // Step 8: Record financial audit event
      const financeEventId = generateServerId("fevt");
      const financeEventRow = {
        id: financeEventId,
        ownerUserId,
        dealId: payment.dealId,
        paymentId,
        leadId: deal.leadId,
        actorUserId,
        eventType: "proof.replaced" as const,
        summary: `Payment proof replaced: "${staged.descriptor.sanitizedFileName}" replaced "${oldProof.originalFileName}"`,
        reason: input.reason ?? null,
        amountSnapshot: payment.amount,
        beforeJson: JSON.stringify({
          previousProofId: oldProof.id,
          fileName: oldProof.originalFileName,
          mimeType: oldProof.mimeType,
          fileSize: oldProof.fileSize,
        }),
        afterJson: JSON.stringify({
          newProofId,
          fileName: staged.descriptor.sanitizedFileName,
          mimeType: staged.descriptor.mimeType,
          fileSize: staged.byteSize,
          sha256: staged.sha256,
        }),
        leadActivityId: null as string | null,
        opId: null,
        occurredAt: nowUtc,
        occurredIstDate: istDate,
        createdAt: nowUtc,
      };

      if (deal.leadId) {
        const activityId = generateServerId("act");
        await tx.insert(crmLeadActivities).values({
          id: activityId,
          legacyId: null,
          ownerUserId,
          leadId: deal.leadId,
          actorUserId,
          type: "payment",
          text: `Payment proof replaced for ₹${payment.amount}: "${staged.descriptor.sanitizedFileName}"`,
          outcome: null,
          occurredAt: nowUtc,
          opId: null,
          idempotencyKey: null,
          createdAt: nowUtc,
        });
        financeEventRow.leadActivityId = activityId;
      }

      await tx.insert(crmFinanceEvents).values(financeEventRow);

      options?.hooks?.afterPrimaryWrite?.();

      return {
        status: 200,
        resourceId: newProofId,
        body: {
          ok: true as const,
          proof: toPaymentProofDto(newProofRow),
          previousProof: toPaymentProofDto(updatedOldProof),
          auditEvent: toFinanceEventDto(financeEventRow),
        },
      };
    });

    const result = capacitySettings.isMariadb
      ? await withMariadbCapacityWriteLock(db, runReplaceTransaction)
      : await runReplaceTransaction();

    if (result.replayed) {
      await storage.deleteTemp(staged.tempKey).catch(() => undefined);
    }

    return result;
  } catch (err) {
    if (newlyPersistedKey) {
      await storage.deletePrivateObject(newlyPersistedKey).catch(() => undefined);
    } else {
      await storage.deleteTemp(staged.tempKey).catch(() => undefined);
    }
    throw err;
  }
}

export async function removePaymentProofRecord(
  db: CrmDatabase,
  ownerUserId: string,
  actorUserId: string,
  paymentId: string,
  input: RemoveProofInput,
  options?: {
    idempotencyKey?: string | null | undefined;
    now?: Date | undefined;
    storageBackend?: ProofStorageBackend | undefined;
    hooks?: { afterPrimaryWrite?: () => void } | undefined;
  },
): Promise<{
  status: number;
  replayed: boolean;
  body: {
    ok: true;
    proof: PaymentProofDto;
    auditEvent: FinanceEventDto;
  };
}> {
  const now = options?.now ?? new Date();
  const nowUtc = toMysqlUtcDateTime(now);
  const istDate = toIstParts(now).istDate;

  const idemKey = options?.idempotencyKey ?? null;
  const scope = `payment-proof:remove:${paymentId}`;
  const requestHash = hashIdempotentRequest(scope, {
    paymentId,
    reason: input.reason ?? null,
  });

  return runWithIdempotency<{
    ok: true;
    proof: PaymentProofDto;
    auditEvent: FinanceEventDto;
  }>(db, { ownerUserId, scope, idemKey, requestHash, now }, async (tx) => {
    // Step 1: Lock payment row
    const paymentRows = await tx
      .select()
      .from(crmPayments)
      .where(and(eq(crmPayments.id, paymentId), eq(crmPayments.ownerUserId, ownerUserId)))
      .limit(1)
      .for("update");
    const payment = paymentRows[0];
    if (!payment) {
      throw new CrmServiceError(404, "not_found", "Payment not found.");
    }

    if (payment.voided) {
      throw new CrmServiceError(
        409,
        "payment_already_voided",
        "Cannot remove proof from a voided payment; voided transactions are immutable historical records.",
        { conflict: { paymentId: payment.id, status: payment.status } },
      );
    }

    // Step 2: Lock deal row
    const dealRows = await tx
      .select()
      .from(crmDeals)
      .where(and(eq(crmDeals.id, payment.dealId), eq(crmDeals.ownerUserId, ownerUserId)))
      .limit(1)
      .for("update");
    const deal = dealRows[0];
    if (!deal || deal.status === "cancelled") {
      throw new CrmServiceError(
        409,
        "deal_cancelled",
        "Cannot remove proof from a payment on a cancelled deal.",
        { conflict: { dealId: payment.dealId } },
      );
    }

    // Step 3: Lock existing active proof
    const existingActiveRows = await tx
      .select()
      .from(crmPaymentProofs)
      .where(
        and(
          eq(crmPaymentProofs.ownerUserId, ownerUserId),
          eq(crmPaymentProofs.paymentId, paymentId),
          eq(crmPaymentProofs.activePaymentLock, paymentId),
        ),
      )
      .limit(1)
      .for("update");
    const oldProof = existingActiveRows[0];

    if (!oldProof) {
      throw new CrmServiceError(
        404,
        "proof_not_found",
        "No active payment proof found to remove.",
        { conflict: { paymentId } },
      );
    }

    if (
      input.expectedProofVersion !== undefined &&
      oldProof.version !== input.expectedProofVersion
    ) {
      throw new CrmServiceError(
        409,
        "stale_conflict",
        "Payment proof was modified concurrently; reload and retry.",
        {
          conflict: {
            resource: "proof",
            id: oldProof.id,
            expectedVersion: input.expectedProofVersion,
            currentVersion: oldProof.version,
          },
        },
      );
    }

    // Step 4: Deactivate proof (physical file remains preserved in storage for audit retention)
    const updatedProof: PaymentProofRow = {
      ...oldProof,
      lifecycleStatus: "removed",
      activePaymentLock: null,
      removalReason: input.reason ?? "Proof removed by Owner.",
      removedByUserId: actorUserId,
      removedAt: nowUtc,
      version: oldProof.version + 1,
      updatedAt: nowUtc,
    };

    await tx
      .update(crmPaymentProofs)
      .set({
        lifecycleStatus: "removed",
        activePaymentLock: null,
        removalReason: input.reason ?? "Proof removed by Owner.",
        removedByUserId: actorUserId,
        removedAt: nowUtc,
        version: sql`${crmPaymentProofs.version} + 1`,
        updatedAt: nowUtc,
      })
      .where(
        and(
          eq(crmPaymentProofs.id, oldProof.id),
          eq(crmPaymentProofs.ownerUserId, ownerUserId),
          eq(crmPaymentProofs.version, oldProof.version),
        ),
      );

    // Step 5: Record financial audit event
    const financeEventId = generateServerId("fevt");
    const financeEventRow = {
      id: financeEventId,
      ownerUserId,
      dealId: payment.dealId,
      paymentId,
      leadId: deal.leadId,
      actorUserId,
      eventType: "proof.removed" as const,
      summary: `Payment proof removed: "${oldProof.originalFileName}"`,
      reason: input.reason ?? null,
      amountSnapshot: payment.amount,
      beforeJson: JSON.stringify({
        proofId: oldProof.id,
        fileName: oldProof.originalFileName,
        fileSize: oldProof.fileSize,
      }),
      afterJson: null,
      leadActivityId: null as string | null,
      opId: null,
      occurredAt: nowUtc,
      occurredIstDate: istDate,
      createdAt: nowUtc,
    };

    if (deal.leadId) {
      const activityId = generateServerId("act");
      await tx.insert(crmLeadActivities).values({
        id: activityId,
        legacyId: null,
        ownerUserId,
        leadId: deal.leadId,
        actorUserId,
        type: "payment",
        text: `Payment proof removed for ₹${payment.amount}: "${oldProof.originalFileName}"`,
        outcome: null,
        occurredAt: nowUtc,
        opId: null,
        idempotencyKey: null,
        createdAt: nowUtc,
      });
      financeEventRow.leadActivityId = activityId;
    }

    await tx.insert(crmFinanceEvents).values(financeEventRow);

    options?.hooks?.afterPrimaryWrite?.();

    return {
      status: 200,
      resourceId: oldProof.id,
      body: {
        ok: true as const,
        proof: toPaymentProofDto(updatedProof),
        auditEvent: toFinanceEventDto(financeEventRow),
      },
    };
  });
}

export async function getActivePaymentProof(
  db: CrmDatabase,
  ownerUserId: string,
  paymentId: string,
): Promise<PaymentProofDto | null> {
  const rows = await db
    .select()
    .from(crmPaymentProofs)
    .where(
      and(
        eq(crmPaymentProofs.ownerUserId, ownerUserId),
        eq(crmPaymentProofs.paymentId, paymentId),
        eq(crmPaymentProofs.activePaymentLock, paymentId),
      ),
    )
    .limit(1);

  return rows[0] ? toPaymentProofDto(rows[0]) : null;
}

export async function listPaymentProofHistory(
  db: CrmDatabase,
  ownerUserId: string,
  paymentId: string,
  query: ListProofHistoryQuery,
): Promise<{ items: PaymentProofDto[]; total: number }> {
  // First ensure payment exists and belongs to owner
  const paymentRows = await db
    .select({ id: crmPayments.id })
    .from(crmPayments)
    .where(and(eq(crmPayments.id, paymentId), eq(crmPayments.ownerUserId, ownerUserId)))
    .limit(1);

  if (!paymentRows[0]) {
    throw new CrmServiceError(404, "not_found", "Payment not found.");
  }

  const [countRows, proofRows] = await Promise.all([
    db
      .select({ count: sql<number>`count(*)` })
      .from(crmPaymentProofs)
      .where(
        and(
          eq(crmPaymentProofs.ownerUserId, ownerUserId),
          eq(crmPaymentProofs.paymentId, paymentId),
        ),
      ),
    db
      .select()
      .from(crmPaymentProofs)
      .where(
        and(
          eq(crmPaymentProofs.ownerUserId, ownerUserId),
          eq(crmPaymentProofs.paymentId, paymentId),
        ),
      )
      .orderBy(desc(crmPaymentProofs.uploadedAt), desc(crmPaymentProofs.id))
      .limit(query.limit)
      .offset(query.offset),
  ]);

  const total = Number(countRows[0]?.count ?? 0);
  return {
    items: proofRows.map(toPaymentProofDto),
    total,
  };
}

export async function readPaymentProofContent(
  db: CrmDatabase,
  ownerUserId: string,
  paymentId: string,
  options?: {
    proofId?: string | undefined;
    storageBackend?: ProofStorageBackend | undefined;
    verifyIntegrity?: boolean | undefined;
  },
): Promise<{
  stream: NodeJS.ReadableStream;
  proof: PaymentProofDto;
  byteSize: number;
}> {
  // Ensure payment belongs to Owner
  const paymentRows = await db
    .select()
    .from(crmPayments)
    .where(and(eq(crmPayments.id, paymentId), eq(crmPayments.ownerUserId, ownerUserId)))
    .limit(1);

  if (!paymentRows[0]) {
    throw new CrmServiceError(404, "not_found", "Payment not found.");
  }

  let proofRow: PaymentProofRow | undefined;

  if (options?.proofId) {
    const rows = await db
      .select()
      .from(crmPaymentProofs)
      .where(
        and(
          eq(crmPaymentProofs.id, options.proofId),
          eq(crmPaymentProofs.paymentId, paymentId),
          eq(crmPaymentProofs.ownerUserId, ownerUserId),
        ),
      )
      .limit(1);
    proofRow = rows[0];
  } else {
    // Default to active proof
    const rows = await db
      .select()
      .from(crmPaymentProofs)
      .where(
        and(
          eq(crmPaymentProofs.paymentId, paymentId),
          eq(crmPaymentProofs.ownerUserId, ownerUserId),
          eq(crmPaymentProofs.activePaymentLock, paymentId),
        ),
      )
      .limit(1);
    proofRow = rows[0];
  }

  if (!proofRow) {
    throw new CrmServiceError(404, "proof_not_found", "Payment proof not found.");
  }

  const storage = options?.storageBackend ?? getProofStorageBackend();
  const shouldVerify = options?.verifyIntegrity ?? true;

  if (shouldVerify) {
    const verified = await storage.getPrivateObject(proofRow.storageKey, {
      sha256: proofRow.sha256Hash,
      byteSize: proofRow.fileSize,
    });
    if (!verified) {
      throw new CrmServiceError(
        500,
        "storage_error",
        "Payment proof file is missing from private storage.",
        { details: { proofId: proofRow.id, status: "missing" } },
      );
    }

    return {
      stream: verified.stream,
      proof: toPaymentProofDto(proofRow),
      byteSize: verified.byteSize,
    };
  }

  const fileContent = await storage.readProofStream(proofRow.storageKey);

  if (!fileContent) {
    throw new CrmServiceError(
      500,
      "storage_error",
      "Payment proof file is missing from private storage.",
      { details: { proofId: proofRow.id, status: "missing" } },
    );
  }

  return {
    stream: fileContent.stream,
    proof: toPaymentProofDto(proofRow),
    byteSize: fileContent.byteSize,
  };
}

export interface ProofConsistencyItemReport {
  proofId: string;
  paymentId: string;
  lifecycleStatus: string;
  verificationStatus: "verified" | "missing" | "size_mismatch" | "checksum_mismatch" | "unreadable";
  persistedStorageStatus: "verified" | "missing" | "corrupted";
  expectedBytes: number;
  actualBytes: number;
  reason?: string;
}

export async function verifyPaymentProofStorage(
  db: CrmDatabase,
  ownerUserId: string,
  paymentId: string,
  options?: {
    proofId?: string | undefined;
    storageBackend?: ProofStorageBackend | undefined;
    persistStatus?: boolean | undefined;
    now?: Date | undefined;
  },
): Promise<ProofConsistencyItemReport> {
  const nowUtc = toMysqlUtcDateTime(options?.now ?? new Date());
  const rows = options?.proofId
    ? await db
        .select()
        .from(crmPaymentProofs)
        .where(
          and(
            eq(crmPaymentProofs.id, options.proofId),
            eq(crmPaymentProofs.paymentId, paymentId),
            eq(crmPaymentProofs.ownerUserId, ownerUserId),
          ),
        )
        .limit(1)
    : await db
        .select()
        .from(crmPaymentProofs)
        .where(
          and(
            eq(crmPaymentProofs.paymentId, paymentId),
            eq(crmPaymentProofs.ownerUserId, ownerUserId),
            eq(crmPaymentProofs.activePaymentLock, paymentId),
          ),
        )
        .limit(1);

  const proofRow = rows[0];
  if (!proofRow) {
    throw new CrmServiceError(404, "proof_not_found", "Payment proof not found.");
  }

  const storage = options?.storageBackend ?? getProofStorageBackend();
  const verification = await storage.verifyPrivateObject(proofRow.storageKey, {
    sha256: proofRow.sha256Hash,
    byteSize: proofRow.fileSize,
  });

  const persistedStorageStatus: "verified" | "missing" | "corrupted" = verification.ok
    ? "verified"
    : verification.status === "missing"
      ? "missing"
      : "corrupted";
  const safeError = verification.ok
    ? null
    : (verification.reason ?? "Integrity verification failed.").slice(0, 250);

  if (options?.persistStatus !== false) {
    await db
      .update(crmPaymentProofs)
      .set({
        storageStatus: persistedStorageStatus,
        verifiedAt: nowUtc,
        verificationError: safeError,
        updatedAt: nowUtc,
      })
      .where(
        and(eq(crmPaymentProofs.id, proofRow.id), eq(crmPaymentProofs.ownerUserId, ownerUserId)),
      );
  }

  return {
    proofId: proofRow.id,
    paymentId: proofRow.paymentId,
    lifecycleStatus: proofRow.lifecycleStatus,
    verificationStatus: verification.status,
    persistedStorageStatus,
    expectedBytes: proofRow.fileSize,
    actualBytes: verification.byteSize,
    ...(safeError ? { reason: safeError } : {}),
  };
}

export async function inspectOwnerProofStorageConsistency(
  db: CrmDatabase,
  ownerUserId: string,
  options?: {
    storageBackend?: ProofStorageBackend | undefined;
    persistStatus?: boolean | undefined;
    minAgeMs?: number | undefined;
    now?: Date | undefined;
  },
): Promise<{
  totalProofRecords: number;
  activeProofRecords: number;
  historicalProofRecords: number;
  verifiedCount: number;
  missingCount: number;
  corruptedCount: number;
  orphanFileCount: number;
  staleTempCount: number;
  items: ProofConsistencyItemReport[];
}> {
  const storage = options?.storageBackend ?? getProofStorageBackend();
  const nowUtc = toMysqlUtcDateTime(options?.now ?? new Date());
  const rows = await db
    .select()
    .from(crmPaymentProofs)
    .where(eq(crmPaymentProofs.ownerUserId, ownerUserId));

  let activeProofRecords = 0;
  let historicalProofRecords = 0;
  let verifiedCount = 0;
  let missingCount = 0;
  let corruptedCount = 0;
  const items: ProofConsistencyItemReport[] = [];

  for (const row of rows) {
    if (row.activePaymentLock === row.paymentId && row.lifecycleStatus === "active") {
      activeProofRecords++;
    } else {
      historicalProofRecords++;
    }

    const verification = await storage.verifyPrivateObject(row.storageKey, {
      sha256: row.sha256Hash,
      byteSize: row.fileSize,
    });
    const persistedStorageStatus: "verified" | "missing" | "corrupted" = verification.ok
      ? "verified"
      : verification.status === "missing"
        ? "missing"
        : "corrupted";
    const safeError = verification.ok
      ? null
      : (verification.reason ?? "Integrity verification failed.").slice(0, 250);

    if (persistedStorageStatus === "verified") verifiedCount++;
    else if (persistedStorageStatus === "missing") missingCount++;
    else corruptedCount++;

    if (options?.persistStatus) {
      await db
        .update(crmPaymentProofs)
        .set({
          storageStatus: persistedStorageStatus,
          verifiedAt: nowUtc,
          verificationError: safeError,
          updatedAt: nowUtc,
        })
        .where(and(eq(crmPaymentProofs.id, row.id), eq(crmPaymentProofs.ownerUserId, ownerUserId)));
    }

    items.push({
      proofId: row.id,
      paymentId: row.paymentId,
      lifecycleStatus: row.lifecycleStatus,
      verificationStatus: verification.status,
      persistedStorageStatus,
      expectedBytes: row.fileSize,
      actualBytes: verification.byteSize,
      ...(safeError ? { reason: safeError } : {}),
    });
  }

  // Only inspect global storage orphans against ALL DB rows across all owners so Owner A doesn't count Owner B files as orphans
  const allRows = await db
    .select({ storageKey: crmPaymentProofs.storageKey })
    .from(crmPaymentProofs);
  const allReferencedKeys = new Set(allRows.map((r) => r.storageKey));
  let orphanFileCount = 0;
  let staleTempCount = 0;
  if (!storage.healthSummary().failClosed) {
    const orphans = await storage.listOrphanedObjects(allReferencedKeys, {
      minAgeMs: options?.minAgeMs ?? 15 * 60 * 1000,
    });
    orphanFileCount = orphans.unreferencedFiles.length;
    staleTempCount = orphans.staleTempFiles.length;
  }

  return {
    totalProofRecords: rows.length,
    activeProofRecords,
    historicalProofRecords,
    verifiedCount,
    missingCount,
    corruptedCount,
    orphanFileCount,
    staleTempCount,
    items,
  };
}

export async function reconcileOrphanProofFiles(
  db: CrmDatabase,
  options?: {
    storageBackend?: ProofStorageBackend | undefined;
    deleteOrphans?: boolean | undefined;
    minAgeMs?: number | undefined;
    tempMaxAgeMs?: number | undefined;
  },
): Promise<{
  activeDbCount: number;
  unreferencedFiles: string[];
  deletedOrphans: string[];
  missingKeys: string[];
  gracePeriodSkippedCount: number;
  staleTempFiles: string[];
  deletedTempFiles: number;
}> {
  const storage = options?.storageBackend ?? getProofStorageBackend();
  const rows = await db.select({ storageKey: crmPaymentProofs.storageKey }).from(crmPaymentProofs);

  const activeKeys = new Set(rows.map((r) => r.storageKey));
  const { unreferencedFiles, missingKeys, gracePeriodSkippedCount, staleTempFiles } =
    await storage.listOrphanedObjects(activeKeys, {
      minAgeMs: options?.minAgeMs,
      tempMaxAgeMs: options?.tempMaxAgeMs,
    });

  const deletedOrphans: string[] = [];
  let deletedTempFiles = 0;
  if (options?.deleteOrphans) {
    for (const file of unreferencedFiles) {
      const deleted = await storage.deletePrivateObject(file);
      if (deleted) {
        deletedOrphans.push(file);
      }
    }
    if (staleTempFiles.length > 0) {
      deletedTempFiles = await storage.cleanupAbandonedTemp(options?.tempMaxAgeMs ?? 3_600_000);
    }
  }

  return {
    activeDbCount: activeKeys.size,
    unreferencedFiles,
    deletedOrphans,
    missingKeys,
    gracePeriodSkippedCount,
    staleTempFiles,
    deletedTempFiles,
  };
}
