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
  streamOrBuffer: Buffer | Uint8Array | NodeJS.ReadableStream | ReadableStream<Uint8Array>;
  maxBytes?: number | undefined;
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

  // Step 1: Stage upload and validate file integrity, headers and mime signature
  const staged = await storage.stageUpload({
    ownerUserId,
    originalFileName: payload.originalFileName,
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

  try {
    const result = await runWithIdempotency<{
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

      // Step 5: Move staged file to permanent private storage
      const proofId = generateServerId("proof");
      const persisted = await storage.persistStagedProof({
        ownerUserId,
        proofId,
        tempKey: staged.tempKey,
        ext: staged.descriptor.fileExtension,
        expectedSha256: staged.sha256,
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
        fileSize: staged.byteSize,
        sha256Hash: staged.sha256,
        storageDriver: storage.driver,
        storageKey: persisted.storageKey,
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

    return result;
  } catch (err) {
    // If the database transaction failed after writing the file, purge the newly persisted file (orphan prevention)
    if (newlyPersistedKey) {
      await storage.deleteProof(newlyPersistedKey).catch(() => undefined);
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

  // Step 1: Stage upload and validate file integrity
  const staged = await storage.stageUpload({
    ownerUserId,
    originalFileName: payload.originalFileName,
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

  try {
    const result = await runWithIdempotency<{
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

      // Step 5: Move new staged file to permanent private storage
      const newProofId = generateServerId("proof");
      const persisted = await storage.persistStagedProof({
        ownerUserId,
        proofId: newProofId,
        tempKey: staged.tempKey,
        ext: staged.descriptor.fileExtension,
        expectedSha256: staged.sha256,
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
        fileSize: staged.byteSize,
        sha256Hash: staged.sha256,
        storageDriver: storage.driver,
        storageKey: persisted.storageKey,
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

    return result;
  } catch (err) {
    if (newlyPersistedKey) {
      await storage.deleteProof(newlyPersistedKey).catch(() => undefined);
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
  const fileContent = await storage.readProofStream(proofRow.storageKey);

  if (!fileContent) {
    throw new CrmServiceError(
      500,
      "storage_error",
      "Payment proof file is missing from private storage.",
      { details: { storageKey: proofRow.storageKey } },
    );
  }

  return {
    stream: fileContent.stream,
    proof: toPaymentProofDto(proofRow),
    byteSize: fileContent.byteSize,
  };
}

export async function reconcileOrphanProofFiles(
  db: CrmDatabase,
  options?: {
    storageBackend?: ProofStorageBackend | undefined;
    deleteOrphans?: boolean | undefined;
    minAgeMs?: number | undefined;
  },
): Promise<{
  activeDbCount: number;
  unreferencedFiles: string[];
  deletedOrphans: string[];
  missingKeys: string[];
  gracePeriodSkippedCount: number;
}> {
  const storage = options?.storageBackend ?? getProofStorageBackend();
  const rows = await db
    .select({ storageKey: crmPaymentProofs.storageKey })
    .from(crmPaymentProofs);

  const activeKeys = new Set(rows.map((r) => r.storageKey));
  const { unreferencedFiles, missingKeys, gracePeriodSkippedCount } = await storage.reconcileStorage(
    activeKeys,
    options?.minAgeMs !== undefined ? { minAgeMs: options.minAgeMs } : undefined,
  );

  const deletedOrphans: string[] = [];
  if (options?.deleteOrphans) {
    for (const file of unreferencedFiles) {
      const deleted = await storage.deleteProof(file);
      if (deleted) {
        deletedOrphans.push(file);
      }
    }
  }

  return {
    activeDbCount: activeKeys.size,
    unreferencedFiles,
    deletedOrphans,
    missingKeys,
    gracePeriodSkippedCount,
  };
}
