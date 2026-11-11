import "@tanstack/react-start/server-only";
import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type { CrmDatabase } from "../db/index.server";
import {
  crmDuplicateCandidates,
  crmFollowUps,
  crmLeadActivities,
  crmLeadInboxItems,
  crmLeadRelationshipHistory,
  crmLeadRelationships,
  crmLeads,
  crmDeals,
  crmPayments,
} from "../db/schema.server";
import { toMysqlUtcDateTime } from "../db/utc.server";
import {
  computeAgeDays,
  evaluateDuplicateMatch,
  firstContactState,
  isContactPending,
  isWithinDays,
  pairKey,
  pairSignature,
  RECENT_DAYS,
  RECENT_REVIEW_DAYS,
  type DupReason,
  type DupStrength,
  type FirstContact,
  type InboxCategory,
  type InboxStatus,
  type RelationKind,
} from "./inboxCalc.server";
import {
  hashIdempotentRequest,
  runWithIdempotency,
  type CrmDbExecutor,
  type CrmTransaction,
} from "./idempotency.server";
import { CrmServiceError } from "./errors.server";
import type {
  DupCandidateDecisionBody,
  DupCandidatesQuery,
  InboxFlagBody,
  InboxQueueQuery,
  InboxReviewBody,
  ReviewHistoryQuery,
} from "./inboxValidation.server";

export interface InboxRowDto {
  lead: {
    id: string;
    name: string;
    phone: string;
    email: string | null;
    company: string | null;
    source: string;
    status: string;
    priority: string;
    requirement: string | null;
    createdAt: string;
  };
  status: InboxStatus;
  reviewStatus: InboxStatus;
  reviewedAt: string | null;
  flagged: boolean;
  flagNote: string | null;
  duplicate: boolean;
  dupReasons: DupReason[];
  assignee: string | null;
  contact: FirstContact;
  ageDays: number;
}

export interface InboxOverviewDto {
  awaitingReview: number;
  unassigned: number;
  duplicates: number;
  needFirstContact: number;
  recent: number;
  needsReviewCount: number;
  unassignedCount: number;
  duplicatesCount: number;
}

export interface InboxQueueResponse {
  items: InboxRowDto[];
  total: number;
  overview: InboxOverviewDto;
  stats: InboxOverviewDto;
  pagination: {
    page: number;
    pageSize: number;
    total: number;
  };
}

export interface DupCandidateDto {
  id: string;
  pairKey: string;
  leadA: {
    id: string;
    name: string;
    phone: string;
    email: string | null;
    company: string | null;
    status: string;
    priority: string;
  };
  leadB: {
    id: string;
    name: string;
    phone: string;
    email: string | null;
    company: string | null;
    status: string;
    priority: string;
  };
  reasons: DupReason[];
  strength: DupStrength;
  status: string;
  reopened: boolean;
  decisionKind: string | null;
  decisionNote: string | null;
  decidedAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * Retrieve the Smart Inbox queue with comprehensive filtering, search, and overview metrics.
 */
export async function getInboxQueueRecord(
  db: CrmDbExecutor,
  ownerUserId: string,
  query: InboxQueueQuery,
  now = new Date(),
): Promise<InboxQueueResponse> {
  // 1. Fetch active leads (lifecycleStatus !== 'deleted')
  const leads = await db
    .select({
      id: crmLeads.id,
      name: crmLeads.name,
      phone: crmLeads.phone,
      email: crmLeads.email,
      company: crmLeads.company,
      source: crmLeads.source,
      status: crmLeads.status,
      priority: crmLeads.priority,
      requirement: crmLeads.requirement,
      createdAt: crmLeads.createdAt,
      lifecycleStatus: crmLeads.lifecycleStatus,
    })
    .from(crmLeads)
    .where(
      and(
        eq(crmLeads.ownerUserId, ownerUserId),
        sql`${crmLeads.lifecycleStatus} != 'deleted'`,
      ),
    )
    .orderBy(desc(crmLeads.createdAt));

  if (leads.length === 0) {
    const emptyOverview: InboxOverviewDto = {
      awaitingReview: 0,
      unassigned: 0,
      duplicates: 0,
      needFirstContact: 0,
      recent: 0,
      needsReviewCount: 0,
      unassignedCount: 0,
      duplicatesCount: 0,
    };
    return {
      items: [],
      total: 0,
      overview: emptyOverview,
      stats: emptyOverview,
      pagination: {
        page: Math.floor(query.offset / query.limit) + 1,
        pageSize: query.limit,
        total: 0,
      },
    };
  }

  const leadIds = leads.map((l: { id: string }) => l.id);

  // 2. Fetch inbox metadata
  const inboxItems = await db
    .select({
      id: crmLeadInboxItems.id,
      leadId: crmLeadInboxItems.leadId,
      status: crmLeadInboxItems.status,
      reviewedAt: crmLeadInboxItems.reviewedAt,
      flaggedAt: crmLeadInboxItems.flaggedAt,
      flagNote: crmLeadInboxItems.flagNote,
      version: crmLeadInboxItems.version,
    })
    .from(crmLeadInboxItems)
    .where(
      and(
        eq(crmLeadInboxItems.ownerUserId, ownerUserId),
        inArray(crmLeadInboxItems.leadId, leadIds),
      ),
    );

  const inboxMetaMap = new Map<string, (typeof inboxItems)[number]>(
    inboxItems.map((item: (typeof inboxItems)[number]) => [item.leadId, item]),
  );

  // 3. Fetch active duplicate candidates (pending)
  const dupCandidates = await db
    .select({
      leadAId: crmDuplicateCandidates.leadAId,
      leadBId: crmDuplicateCandidates.leadBId,
      reasonsJson: crmDuplicateCandidates.reasonsJson,
    })
    .from(crmDuplicateCandidates)
    .where(
      and(
        eq(crmDuplicateCandidates.ownerUserId, ownerUserId),
        eq(crmDuplicateCandidates.status, "pending"),
      ),
    );

  const dupLeadIdMap = new Map<string, Set<DupReason>>();
  for (const c of dupCandidates) {
    let reasons: DupReason[] = [];
    try {
      reasons = JSON.parse(c.reasonsJson);
    } catch {}

    if (!dupLeadIdMap.has(c.leadAId)) dupLeadIdMap.set(c.leadAId, new Set());
    if (!dupLeadIdMap.has(c.leadBId)) dupLeadIdMap.set(c.leadBId, new Set());

    for (const r of reasons) {
      dupLeadIdMap.get(c.leadAId)!.add(r);
      dupLeadIdMap.get(c.leadBId)!.add(r);
    }
  }

  // 4. Fetch activities and follow-ups to compute contact status
  const activities = await db
    .select({
      leadId: crmLeadActivities.leadId,
      type: crmLeadActivities.type,
      outcome: crmLeadActivities.outcome,
    })
    .from(crmLeadActivities)
    .where(
      and(
        eq(crmLeadActivities.ownerUserId, ownerUserId),
        inArray(crmLeadActivities.leadId, leadIds),
      ),
    );

  const followUps = await db
    .select({
      leadId: crmFollowUps.leadId,
      completedAt: crmFollowUps.completedAt,
      cancelledAt: crmFollowUps.cancelledAt,
    })
    .from(crmFollowUps)
    .where(
      and(
        eq(crmFollowUps.ownerUserId, ownerUserId),
        inArray(crmFollowUps.leadId, leadIds),
      ),
    );

  const activitiesMap = new Map<string, typeof activities>();
  for (const a of activities) {
    if (!activitiesMap.has(a.leadId)) activitiesMap.set(a.leadId, []);
    activitiesMap.get(a.leadId)!.push(a);
  }

  const followUpsMap = new Map<string, typeof followUps>();
  for (const f of followUps) {
    if (!followUpsMap.has(f.leadId)) followUpsMap.set(f.leadId, []);
    followUpsMap.get(f.leadId)!.push(f);
  }

  // 5. Build full row models
  const allRows: InboxRowDto[] = leads.map((l: (typeof leads)[number]) => {
    const meta = inboxMetaMap.get(l.id);
    const candidateReasons = Array.from(dupLeadIdMap.get(l.id) ?? []);
    const isFlagged = Boolean(meta?.flaggedAt);
    const isDuplicate = candidateReasons.length > 0 || isFlagged;

    const leadActs = activitiesMap.get(l.id) ?? [];
    const leadFus = followUpsMap.get(l.id) ?? [];
    const contact = firstContactState(leadActs, leadFus);
    const ageDays = computeAgeDays(l.createdAt, now);

    return {
      lead: {
        id: l.id,
        name: l.name,
        phone: l.phone,
        email: l.email,
        company: l.company,
        source: l.source,
        status: l.status,
        priority: l.priority,
        requirement: l.requirement,
        createdAt: l.createdAt,
      },
      status: (meta?.status as InboxStatus) || "needs_review",
      reviewStatus: (meta?.status as InboxStatus) || "needs_review",
      reviewedAt: meta?.reviewedAt ?? null,
      flagged: isFlagged,
      flagNote: meta?.flagNote ?? null,
      duplicate: isDuplicate,
      dupReasons: candidateReasons,
      assignee: null, // Employee team assignment is deferred
      contact,
      ageDays,
    };
  });

  // 6. Compute overview metrics
  const openRows = allRows.filter((r) => r.lead.status !== "won" && r.lead.status !== "lost");
  const awaitingReviewCount = openRows.filter((r) => r.status === "needs_review").length;
  const unassignedCount = openRows.length;
  const duplicatesCount = allRows.filter((r) => r.duplicate).length;

  const overview: InboxOverviewDto = {
    awaitingReview: awaitingReviewCount,
    unassigned: unassignedCount,
    duplicates: duplicatesCount,
    needFirstContact: openRows.filter((r) => isContactPending(r.contact)).length,
    recent: allRows.filter((r) => isWithinDays(r.lead.createdAt, RECENT_DAYS, now)).length,
    needsReviewCount: awaitingReviewCount,
    unassignedCount,
    duplicatesCount,
  };

  // 7. Filter rows by category
  const filteredByCategory = allRows.filter((r) => {
    const isOpen = r.lead.status !== "won" && r.lead.status !== "lost";
    const isIntake = isOpen && (r.status === "needs_review" || isWithinDays(r.reviewedAt, RECENT_REVIEW_DAYS, now));

    switch (query.category) {
      case "all":
        return isIntake;
      case "needs_review":
        return isOpen && r.status === "needs_review";
      case "unassigned":
        return isIntake && !r.assignee;
      case "newly_assigned":
        return false; // Team assignment deferred
      case "duplicates":
        return r.duplicate;
      case "recently_reviewed":
        return r.status === "reviewed" && isWithinDays(r.reviewedAt, RECENT_REVIEW_DAYS, now);
      default:
        return true;
    }
  });

  // 8. Filter by secondary filters & search
  const qClean = query.q?.trim().toLowerCase();
  const qDigits = qClean?.replace(/\D/g, "");

  const finalFiltered = filteredByCategory.filter((r) => {
    const l = r.lead;

    if (qClean) {
      const matchText =
        l.name.toLowerCase().includes(qClean) ||
        (l.email?.toLowerCase().includes(qClean) ?? false) ||
        (l.company?.toLowerCase().includes(qClean) ?? false);
      const matchPhone = qDigits && qDigits.length >= 3 && l.phone.replace(/\D/g, "").includes(qDigits);

      if (!matchText && !matchPhone) return false;
    }

    if (query.source && query.source !== "all" && l.source !== query.source) return false;
    if (query.priority && query.priority !== "all" && l.priority !== query.priority) return false;
    if (query.stage && query.stage !== "all" && l.status !== query.stage) return false;
    if (query.status && query.status !== "all" && r.status !== query.status) return false;

    if (query.createdDays && !isWithinDays(l.createdAt, query.createdDays, now)) return false;
    if (query.firstContactPending && !isContactPending(r.contact)) return false;
    if (query.duplicate && !r.duplicate) return false;

    return true;
  });

  const total = finalFiltered.length;
  const paginated = finalFiltered.slice(query.offset, query.offset + query.limit);

  return {
    items: paginated,
    total,
    overview,
    stats: overview,
    pagination: {
      page: Math.floor(query.offset / query.limit) + 1,
      pageSize: query.limit,
      total,
    },
  };
}

/**
 * Mark leads as reviewed or move them back to needs_review.
 */
export async function setInboxReviewStatusRecord(
  db: CrmDatabase,
  ownerUserId: string,
  actorUserId: string,
  input: InboxReviewBody,
  now: Date = new Date(),
): Promise<{ status: number; replayed: boolean; body: { ok: true; affectedCount: number; action: string } }> {
  const idemKey = input.idempotencyKey ?? null;
  const requestHash = hashIdempotentRequest(`inbox:review:${ownerUserId}`, input);

  return runWithIdempotency<{ ok: true; affectedCount: number; action: string }>(
    db,
    {
      ownerUserId,
      scope: `inbox:review:${ownerUserId}`,
      idemKey,
      requestHash,
      now,
    },
    async (tx: CrmTransaction) => {
      // 1. Verify all leadIds belong to this owner
      const validLeads = await tx
        .select({ id: crmLeads.id })
        .from(crmLeads)
        .where(
          and(
            eq(crmLeads.ownerUserId, ownerUserId),
            inArray(crmLeads.id, input.leadIds),
          ),
        );

      const validIdSet = new Set(validLeads.map((l: { id: string }) => l.id));
      const targetIds = input.leadIds.filter((id) => validIdSet.has(id));

      if (targetIds.length === 0) {
        return {
          status: 200,
          resourceId: null,
          body: { ok: true, affectedCount: 0, action: input.action },
        };
      }

      const nowStr = toMysqlUtcDateTime(now);

      for (const leadId of targetIds) {
        const existing = await tx
          .select()
          .from(crmLeadInboxItems)
          .where(
            and(
              eq(crmLeadInboxItems.ownerUserId, ownerUserId),
              eq(crmLeadInboxItems.leadId, leadId),
            ),
          )
          .limit(1);

        if (input.action === "mark_reviewed") {
          if (existing.length === 0) {
            await tx.insert(crmLeadInboxItems).values({
              id: `inbx_${randomUUID().replace(/-/g, "").slice(0, 24)}`,
              ownerUserId,
              leadId,
              status: "reviewed",
              reviewedAt: nowStr,
              createdAt: nowStr,
              updatedAt: nowStr,
            });
          } else {
            await tx
              .update(crmLeadInboxItems)
              .set({
                status: "reviewed",
                reviewedAt: nowStr,
                updatedAt: nowStr,
                version: existing[0]!.version + 1,
              })
              .where(eq(crmLeadInboxItems.id, existing[0]!.id));
          }

          // Record audit event
          await tx.insert(crmLeadRelationshipHistory).values({
            id: `irae_${randomUUID().replace(/-/g, "").slice(0, 24)}`,
            ownerUserId,
            leadAId: leadId,
            action: "mark_reviewed",
            actorUserId,
            createdAt: nowStr,
          });
        } else {
          // unmark_reviewed
          if (existing.length > 0) {
            await tx
              .update(crmLeadInboxItems)
              .set({
                status: "needs_review",
                reviewedAt: null,
                updatedAt: nowStr,
                version: existing[0]!.version + 1,
              })
              .where(eq(crmLeadInboxItems.id, existing[0]!.id));

            // Record audit event
            await tx.insert(crmLeadRelationshipHistory).values({
              id: `irae_${randomUUID().replace(/-/g, "").slice(0, 24)}`,
              ownerUserId,
              leadAId: leadId,
              action: "unmark_reviewed",
              actorUserId,
              createdAt: nowStr,
            });
          }
        }
      }

      return {
        status: 200,
        resourceId: targetIds[0] ?? null,
        body: {
          ok: true,
          affectedCount: targetIds.length,
          updatedCount: targetIds.length,
          action: input.action,
        },
      };
    },
  );
}

/**
 * Manually flag or unflag a lead as a possible duplicate.
 */
export async function setLeadDuplicateFlagRecord(
  db: CrmDatabase,
  ownerUserId: string,
  actorUserId: string,
  input: InboxFlagBody,
  now: Date = new Date(),
): Promise<{ status: number; replayed: boolean; body: { ok: true; leadId: string; flagged: boolean; flagNote: string | null } }> {
  const idemKey = input.idempotencyKey ?? null;
  const requestHash = hashIdempotentRequest(`inbox:flag:${ownerUserId}`, input);

  return runWithIdempotency<{ ok: true; leadId: string; flagged: boolean; flagNote: string | null }>(
    db,
    {
      ownerUserId,
      scope: `inbox:flag:${ownerUserId}`,
      idemKey,
      requestHash,
      now,
    },
    async (tx: CrmTransaction) => {
      const lead = await tx
        .select({ id: crmLeads.id })
        .from(crmLeads)
        .where(
          and(
            eq(crmLeads.ownerUserId, ownerUserId),
            eq(crmLeads.id, input.leadId),
          ),
        )
        .limit(1);

      if (lead.length === 0) {
        throw new CrmServiceError(404, "lead_not_found", "Lead not found or access denied.");
      }

      const nowStr = toMysqlUtcDateTime(now);
      const existing = await tx
        .select()
        .from(crmLeadInboxItems)
        .where(
          and(
            eq(crmLeadInboxItems.ownerUserId, ownerUserId),
            eq(crmLeadInboxItems.leadId, input.leadId),
          ),
        )
        .limit(1);

      const isFlag = input.action === "flag";
      const noteClean = isFlag && input.note ? input.note.trim() : null;

      if (existing.length === 0) {
        await tx.insert(crmLeadInboxItems).values({
          id: `inbx_${randomUUID().replace(/-/g, "").slice(0, 24)}`,
          ownerUserId,
          leadId: input.leadId,
          status: "needs_review",
          flaggedAt: isFlag ? nowStr : null,
          flagNote: noteClean,
          createdAt: nowStr,
          updatedAt: nowStr,
        });
      } else {
        await tx
          .update(crmLeadInboxItems)
          .set({
            flaggedAt: isFlag ? nowStr : null,
            flagNote: noteClean,
            updatedAt: nowStr,
            version: existing[0]!.version + 1,
          })
          .where(eq(crmLeadInboxItems.id, existing[0]!.id));
      }

      // Record audit event
      await tx.insert(crmLeadRelationshipHistory).values({
        id: `irae_${randomUUID().replace(/-/g, "").slice(0, 24)}`,
        ownerUserId,
        leadAId: input.leadId,
        action: isFlag ? "flag_duplicate" : "unflag_duplicate",
        note: noteClean,
        actorUserId,
        createdAt: nowStr,
      });

      return {
        status: 200,
        resourceId: input.leadId,
        body: {
          ok: true,
          leadId: input.leadId,
          flagged: isFlag,
          flagNote: noteClean,
        },
      };
    },
  );
}

/**
 * Scan all active leads belonging to the Owner, detect duplicate candidates across normalized phone,
 * email and name+company, and insert or reopen candidate records.
 */
export async function scanDuplicateCandidatesRecord(
  db: CrmDatabase,
  ownerUserId: string,
  now: Date = new Date(),
): Promise<{ ok: true; scannedCount: number; candidatesFound: number }> {
  return db.transaction(async (tx: CrmTransaction) => {
    const leads = await tx
      .select({
        id: crmLeads.id,
        name: crmLeads.name,
        phone: crmLeads.phone,
        email: crmLeads.email,
        company: crmLeads.company,
      })
      .from(crmLeads)
      .where(
        and(
          eq(crmLeads.ownerUserId, ownerUserId),
          sql`${crmLeads.lifecycleStatus} != 'deleted'`,
        ),
      );

    if (leads.length < 2) {
      return { ok: true, scannedCount: leads.length, candidatesFound: 0 };
    }

    // Fetch existing relationships
    const existingRelations = await tx
      .select()
      .from(crmLeadRelationships)
      .where(eq(crmLeadRelationships.ownerUserId, ownerUserId));

    const relMap = new Map(existingRelations.map((r) => [r.pairKey, r]));

    // Fetch existing candidates
    const existingCandidates = await tx
      .select()
      .from(crmDuplicateCandidates)
      .where(eq(crmDuplicateCandidates.ownerUserId, ownerUserId));

    const candMap = new Map(existingCandidates.map((c) => [c.pairKey, c]));

    const nowStr = toMysqlUtcDateTime(now);
    let foundCount = 0;

    // Detect pairs
    for (let i = 0; i < leads.length; i++) {
      for (let j = i + 1; j < leads.length; j++) {
        const la = leads[i]!;
        const lb = leads[j]!;

        const evalResult = evaluateDuplicateMatch(la, lb);
        if (!evalResult.isMatch) continue;

        foundCount++;
        const pKey = pairKey(la.id, lb.id);
        const sig = pairSignature(la, lb);
        const existingRel = relMap.get(pKey);

        const [firstId, secondId] = la.id < lb.id ? [la.id, lb.id] : [lb.id, la.id];
        const reasonsStr = JSON.stringify(evalResult.reasons);

        if (existingRel) {
          // If relationship exists and signature matches, it's settled.
          if (existingRel.signature === sig) {
            continue;
          }
          // Signature changed! Reopen candidate
          const existingCand = candMap.get(pKey);
          if (existingCand) {
            await tx
              .update(crmDuplicateCandidates)
              .set({
                status: "pending",
                reopened: true,
                reasonsJson: reasonsStr,
                strength: evalResult.strength,
                pairSignature: sig,
                updatedAt: nowStr,
                version: existingCand.version + 1,
              })
              .where(eq(crmDuplicateCandidates.id, existingCand.id));
          } else {
            await tx.insert(crmDuplicateCandidates).values({
              id: `dupc_${randomUUID().replace(/-/g, "").slice(0, 24)}`,
              ownerUserId,
              leadAId: firstId,
              leadBId: secondId,
              pairKey: pKey,
              reasonsJson: reasonsStr,
              strength: evalResult.strength,
              status: "pending",
              pairSignature: sig,
              reopened: true,
              createdAt: nowStr,
              updatedAt: nowStr,
            });
          }
        } else {
          // No relation exists. Create or update candidate
          const existingCand = candMap.get(pKey);
          if (!existingCand) {
            await tx.insert(crmDuplicateCandidates).values({
              id: `dupc_${randomUUID().replace(/-/g, "").slice(0, 24)}`,
              ownerUserId,
              leadAId: firstId,
              leadBId: secondId,
              pairKey: pKey,
              reasonsJson: reasonsStr,
              strength: evalResult.strength,
              status: "pending",
              pairSignature: sig,
              reopened: false,
              createdAt: nowStr,
              updatedAt: nowStr,
            });
          } else if (existingCand.status === "pending" || existingCand.pairSignature !== sig) {
            await tx
              .update(crmDuplicateCandidates)
              .set({
                status: "pending",
                reasonsJson: reasonsStr,
                strength: evalResult.strength,
                pairSignature: sig,
                updatedAt: nowStr,
                version: existingCand.version + 1,
              })
              .where(eq(crmDuplicateCandidates.id, existingCand.id));
          }
        }
      }
    }

    return {
      ok: true,
      scannedCount: leads.length,
      candidatesFound: foundCount,
    };
  });
}

/**
 * List duplicate candidates with pagination and status filter.
 */
export async function listDuplicateCandidatesRecord(
  db: CrmDbExecutor,
  ownerUserId: string,
  query: DupCandidatesQuery,
): Promise<{ items: DupCandidateDto[]; total: number }> {
  const conditions = [eq(crmDuplicateCandidates.ownerUserId, ownerUserId)];
  if (query.status && query.status !== "all") {
    conditions.push(eq(crmDuplicateCandidates.status, query.status));
  }
  if (query.strength && query.strength !== "all") {
    conditions.push(eq(crmDuplicateCandidates.strength, query.strength));
  }

  const [candidates, countResult] = await Promise.all([
    db
      .select()
      .from(crmDuplicateCandidates)
      .where(and(...conditions))
      .orderBy(desc(crmDuplicateCandidates.createdAt))
      .limit(query.limit)
      .offset(query.offset),
    db
      .select({ count: sql<number>`count(*)` })
      .from(crmDuplicateCandidates)
      .where(and(...conditions)),
  ]);

  const total = Number(countResult[0]?.count ?? 0);
  if (candidates.length === 0) {
    return { items: [], total };
  }

  // Hydrate Lead A and Lead B info
  const leadIdSet = new Set<string>();
  for (const c of candidates) {
    leadIdSet.add(c.leadAId);
    leadIdSet.add(c.leadBId);
  }

  const leads = await db
    .select({
      id: crmLeads.id,
      name: crmLeads.name,
      phone: crmLeads.phone,
      email: crmLeads.email,
      company: crmLeads.company,
      status: crmLeads.status,
      priority: crmLeads.priority,
    })
    .from(crmLeads)
    .where(
      and(
        eq(crmLeads.ownerUserId, ownerUserId),
        inArray(crmLeads.id, Array.from(leadIdSet)),
      ),
    );

  const leadMap = new Map(leads.map((l: (typeof leads)[number]) => [l.id, l]));

  const items: DupCandidateDto[] = candidates.map((c: (typeof candidates)[number]) => {
    let reasons: DupReason[] = [];
    try {
      reasons = JSON.parse(c.reasonsJson);
    } catch {}

    const leadA = leadMap.get(c.leadAId) ?? {
      id: c.leadAId,
      name: "Deleted Lead",
      phone: "",
      email: null,
      company: null,
      status: "lost",
      priority: "cold",
    };

    const leadB = leadMap.get(c.leadBId) ?? {
      id: c.leadBId,
      name: "Deleted Lead",
      phone: "",
      email: null,
      company: null,
      status: "lost",
      priority: "cold",
    };

    return {
      id: c.id,
      pairKey: c.pairKey,
      leadA,
      leadB,
      reasons,
      strength: c.strength as DupStrength,
      status: c.status,
      reopened: c.reopened,
      decisionKind: c.decisionKind,
      decisionNote: c.decisionNote,
      decidedAt: c.decidedAt,
      version: c.version,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
    };
  });

  return { items, total };
}

/**
 * Retrieve a specific duplicate candidate with detailed comparison metrics.
 */
export async function getDuplicateCandidateRecord(
  db: CrmDbExecutor,
  ownerUserId: string,
  candidateId: string,
) {
  const candidates = await db
    .select()
    .from(crmDuplicateCandidates)
    .where(
      and(
        eq(crmDuplicateCandidates.ownerUserId, ownerUserId),
        eq(crmDuplicateCandidates.id, candidateId),
      ),
    )
    .limit(1);

  if (candidates.length === 0) {
    throw new CrmServiceError(404, "candidate_not_found", "Duplicate candidate not found.");
  }

  const c = candidates[0]!;

  const leads = await db
    .select()
    .from(crmLeads)
    .where(
      and(
        eq(crmLeads.ownerUserId, ownerUserId),
        inArray(crmLeads.id, [c.leadAId, c.leadBId]),
      ),
    );

  const la = leads.find((l: (typeof leads)[number]) => l.id === c.leadAId);
  const lb = leads.find((l: (typeof leads)[number]) => l.id === c.leadBId);

  if (!la || !lb) {
    throw new CrmServiceError(404, "lead_not_found", "One or both leads not found.");
  }

  // Gather stats for Lead A and Lead B (notes, acts, followups, deals, payments)
  const getLeadStats = async (leadId: string) => {
    const [acts, fus, deals] = await Promise.all([
      db
        .select({ type: crmLeadActivities.type, outcome: crmLeadActivities.outcome })
        .from(crmLeadActivities)
        .where(
          and(
            eq(crmLeadActivities.ownerUserId, ownerUserId),
            eq(crmLeadActivities.leadId, leadId),
          ),
        ),
      db
        .select({ completedAt: crmFollowUps.completedAt, cancelledAt: crmFollowUps.cancelledAt })
        .from(crmFollowUps)
        .where(
          and(
            eq(crmFollowUps.ownerUserId, ownerUserId),
            eq(crmFollowUps.leadId, leadId),
          ),
        ),
      db
        .select({ id: crmDeals.id })
        .from(crmDeals)
        .where(
          and(
            eq(crmDeals.ownerUserId, ownerUserId),
            eq(crmDeals.leadId, leadId),
          ),
        ),
    ]);

    const contactStatus = firstContactState(acts, fus);

    const dealIds = deals.map((d: { id: string }) => d.id);
    let paymentsCount = 0;
    let paidAmount = 0;

    if (dealIds.length > 0) {
      const pmts = await db
        .select({ amount: crmPayments.amount })
        .from(crmPayments)
        .where(
          and(
            eq(crmPayments.ownerUserId, ownerUserId),
            inArray(crmPayments.dealId, dealIds),
            eq(crmPayments.voided, false),
          ),
        );
      paymentsCount = pmts.length;
      paidAmount = pmts.reduce((acc: number, p: { amount: string }) => acc + Number(p.amount || 0), 0);
    }

    return {
      contactStatus,
      activitiesCount: acts.length,
      followUpsCount: fus.length,
      dealsCount: deals.length,
      paymentsCount,
      paidAmount,
    };
  };

  const [statsA, statsB] = await Promise.all([getLeadStats(la.id), getLeadStats(lb.id)]);

  let reasons: DupReason[] = [];
  try {
    reasons = JSON.parse(c.reasonsJson);
  } catch {}

  return {
    candidate: {
      id: c.id,
      pairKey: c.pairKey,
      reasons,
      strength: c.strength as DupStrength,
      status: c.status,
      reopened: c.reopened,
      decisionKind: c.decisionKind,
      decisionNote: c.decisionNote,
      decidedAt: c.decidedAt,
      version: c.version,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
    },
    leadA: { ...la, contactStatus: statsA.contactStatus },
    leadB: { ...lb, contactStatus: statsB.contactStatus },
    statsA,
    statsB,
    mergeBlockers: [
      "Safe merging needs the secure backend so every linked record moves in one step. Use Mark as Related for now — nothing is lost.",
      ...(statsA.paymentsCount || statsB.paymentsCount ? ["Payments or payment proof files are linked to these records."] : []),
      ...(statsA.dealsCount || statsB.dealsCount ? ["Deals are linked to these records."] : []),
    ],
  };
}

/**
 * Record Owner decision on a duplicate candidate (separate, related, or dismiss).
 * Enforces optimistic concurrency, updates candidate, writes relationship and audit event.
 */
export async function decideDuplicateCandidateRecord(
  db: CrmDatabase,
  ownerUserId: string,
  actorUserId: string,
  candidateId: string,
  input: DupCandidateDecisionBody,
  now: Date = new Date(),
): Promise<{ status: number; replayed: boolean; body: { ok: true; candidateId: string; pairKey: string; kind: string } }> {
  const idemKey = input.idempotencyKey ?? null;
  const requestHash = hashIdempotentRequest(`inbox:decide:${candidateId}`, input);

  return runWithIdempotency<{ ok: true; candidateId: string; pairKey: string; kind: string }>(
    db,
    {
      ownerUserId,
      scope: `inbox:decide:${candidateId}`,
      idemKey,
      requestHash,
      now,
    },
    async (tx: CrmTransaction) => {
      const candidates = await tx
        .select()
        .from(crmDuplicateCandidates)
        .where(
          and(
            eq(crmDuplicateCandidates.ownerUserId, ownerUserId),
            eq(crmDuplicateCandidates.id, candidateId),
          ),
        )
        .limit(1);

      if (candidates.length === 0) {
        throw new CrmServiceError(404, "candidate_not_found", "Duplicate candidate not found.");
      }

      const c = candidates[0]!;

      // Optimistic concurrency check
      if (input.expectedVersion !== undefined && c.version !== input.expectedVersion) {
        throw new CrmServiceError(
          409,
          "stale_conflict",
          `Conflict: duplicate candidate was modified by another session (expected version ${input.expectedVersion}, found ${c.version}).`,
          { conflict: { currentVersion: c.version, expectedVersion: input.expectedVersion } },
        );
      }

      const nowStr = toMysqlUtcDateTime(now);
      const noteClean = (input.note ?? input.notes)?.trim() || null;

      // Fetch leads to verify current signature
      const leads = await tx
        .select({ id: crmLeads.id, phone: crmLeads.phone, email: crmLeads.email })
        .from(crmLeads)
        .where(
          and(
            eq(crmLeads.ownerUserId, ownerUserId),
            inArray(crmLeads.id, [c.leadAId, c.leadBId]),
          ),
        );

      const la = leads.find((l: (typeof leads)[number]) => l.id === c.leadAId);
      const lb = leads.find((l: (typeof leads)[number]) => l.id === c.leadBId);

      const currentSig = la && lb ? pairSignature(la, lb) : c.pairSignature;
      const nextVersion = c.version + 1;

      if (input.decision === "dismiss") {
        await tx
          .update(crmDuplicateCandidates)
          .set({
            status: "dismissed",
            decisionKind: "dismissed",
            decisionNote: noteClean,
            decidedAt: nowStr,
            decidedByUserId: actorUserId,
            version: nextVersion,
            updatedAt: nowStr,
          })
          .where(eq(crmDuplicateCandidates.id, c.id));

        await tx.insert(crmLeadRelationshipHistory).values({
          id: `irae_${randomUUID().replace(/-/g, "").slice(0, 24)}`,
          ownerUserId,
          pairKey: c.pairKey,
          leadAId: c.leadAId,
          leadBId: c.leadBId,
          candidateId: c.id,
          action: "dismiss",
          kind: null,
          previousKind: c.decisionKind ?? null,
          signature: currentSig,
          note: noteClean,
          actorUserId,
          createdAt: nowStr,
        });

        return {
          status: 200,
          resourceId: c.id,
          body: {
            ok: true,
            candidateId: c.id,
            pairKey: c.pairKey,
            kind: "dismissed",
          },
        };
      }

      // decision is "separate" or "related"
      const kind: RelationKind = input.decision;

      await tx
        .update(crmDuplicateCandidates)
        .set({
          status: "reviewed",
          decisionKind: kind,
          decisionNote: noteClean,
          decidedAt: nowStr,
          decidedByUserId: actorUserId,
          version: nextVersion,
          updatedAt: nowStr,
        })
        .where(eq(crmDuplicateCandidates.id, c.id));

      // Upsert relationship
      const existingRel = await tx
        .select()
        .from(crmLeadRelationships)
        .where(
          and(
            eq(crmLeadRelationships.ownerUserId, ownerUserId),
            eq(crmLeadRelationships.pairKey, c.pairKey),
          ),
        )
        .limit(1);

      if (existingRel.length === 0) {
        await tx.insert(crmLeadRelationships).values({
          id: `lrel_${randomUUID().replace(/-/g, "").slice(0, 24)}`,
          ownerUserId,
          leadAId: c.leadAId,
          leadBId: c.leadBId,
          pairKey: c.pairKey,
          kind,
          signature: currentSig,
          note: noteClean,
          createdAt: nowStr,
          updatedAt: nowStr,
        });
      } else {
        await tx
          .update(crmLeadRelationships)
          .set({
            kind,
            signature: currentSig,
            note: noteClean,
            updatedAt: nowStr,
            version: existingRel[0]!.version + 1,
          })
          .where(eq(crmLeadRelationships.id, existingRel[0]!.id));
      }

      // Clear duplicate flags on both leads
      await tx
        .update(crmLeadInboxItems)
        .set({
          flaggedAt: null,
          flagNote: null,
          updatedAt: nowStr,
        })
        .where(
          and(
            eq(crmLeadInboxItems.ownerUserId, ownerUserId),
            inArray(crmLeadInboxItems.leadId, [c.leadAId, c.leadBId]),
          ),
        );

      // Audit event
      await tx.insert(crmLeadRelationshipHistory).values({
        id: `irae_${randomUUID().replace(/-/g, "").slice(0, 24)}`,
        ownerUserId,
        pairKey: c.pairKey,
        leadAId: c.leadAId,
        leadBId: c.leadBId,
        candidateId: c.id,
        action: kind === "separate" ? "mark_separate" : "mark_related",
        kind,
        previousKind: existingRel[0]?.kind ?? c.decisionKind ?? null,
        signature: currentSig,
        note: noteClean,
        actorUserId,
        createdAt: nowStr,
      });

      return {
        status: 200,
        resourceId: c.id,
        body: {
          ok: true,
          candidateId: c.id,
          pairKey: c.pairKey,
          kind,
        },
      };
    },
  );
}

/**
 * Get active relationships for a lead.
 */
export async function getLeadRelationshipsRecord(
  db: CrmDbExecutor,
  ownerUserId: string,
  leadId: string,
) {
  const rels = await db
    .select()
    .from(crmLeadRelationships)
    .where(
      and(
        eq(crmLeadRelationships.ownerUserId, ownerUserId),
        or(
          eq(crmLeadRelationships.leadAId, leadId),
          eq(crmLeadRelationships.leadBId, leadId),
        ),
      ),
    );

  if (rels.length === 0) {
    return { items: [] };
  }

  const otherLeadIds = rels.map((r: (typeof rels)[number]) => (r.leadAId === leadId ? r.leadBId : r.leadAId));

  const otherLeads = await db
    .select({
      id: crmLeads.id,
      name: crmLeads.name,
      phone: crmLeads.phone,
      email: crmLeads.email,
      company: crmLeads.company,
      status: crmLeads.status,
      priority: crmLeads.priority,
    })
    .from(crmLeads)
    .where(
      and(
        eq(crmLeads.ownerUserId, ownerUserId),
        inArray(crmLeads.id, otherLeadIds),
      ),
    );

  const otherLeadMap = new Map(otherLeads.map((l: (typeof otherLeads)[number]) => [l.id, l]));

  const items = rels.map((r: (typeof rels)[number]) => {
    const otherId = r.leadAId === leadId ? r.leadBId : r.leadAId;
    return {
      id: r.id,
      pairKey: r.pairKey,
      kind: r.kind,
      note: r.note,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      otherLead: otherLeadMap.get(otherId) ?? {
        id: otherId,
        name: "Unknown Lead",
        phone: "",
        email: null,
        company: null,
        status: "lost",
        priority: "cold",
      },
    };
  });

  return { items };
}

/**
 * Remove/unlink an existing relationship between two leads.
 */
export async function deleteLeadRelationshipRecord(
  db: CrmDatabase,
  ownerUserId: string,
  actorUserId: string,
  pairKeyToUnlink: string,
  now: Date = new Date(),
): Promise<{ ok: true; pairKey: string }> {
  return db.transaction(async (tx: CrmTransaction) => {
    const existing = await tx
      .select()
      .from(crmLeadRelationships)
      .where(
        and(
          eq(crmLeadRelationships.ownerUserId, ownerUserId),
          eq(crmLeadRelationships.pairKey, pairKeyToUnlink),
        ),
      )
      .limit(1);

    if (existing.length === 0) {
      throw new CrmServiceError(404, "relationship_not_found", "Relationship not found.");
    }

    const rel = existing[0]!;

    await tx
      .delete(crmLeadRelationships)
      .where(eq(crmLeadRelationships.id, rel.id));

    const nowStr = toMysqlUtcDateTime(now);

    // Audit event
    await tx.insert(crmLeadRelationshipHistory).values({
      id: `irae_${randomUUID().replace(/-/g, "").slice(0, 24)}`,
      ownerUserId,
      pairKey: rel.pairKey,
      leadAId: rel.leadAId,
      leadBId: rel.leadBId,
      action: "unlink",
      kind: null,
      previousKind: rel.kind,
      signature: rel.signature,
      note: rel.note,
      actorUserId,
      createdAt: nowStr,
    });

    return { ok: true, pairKey: pairKeyToUnlink };
  });
}

/**
 * Query paginated audit history of review decisions.
 */
export async function getReviewHistoryRecord(
  db: CrmDbExecutor,
  ownerUserId: string,
  query: ReviewHistoryQuery,
) {
  const conditions = [eq(crmLeadRelationshipHistory.ownerUserId, ownerUserId)];

  if (query.pairKey) {
    conditions.push(eq(crmLeadRelationshipHistory.pairKey, query.pairKey));
  }

  if (query.leadId) {
    conditions.push(
      or(
        eq(crmLeadRelationshipHistory.leadAId, query.leadId),
        eq(crmLeadRelationshipHistory.leadBId, query.leadId),
      )!,
    );
  }

  const [items, countResult] = await Promise.all([
    db
      .select()
      .from(crmLeadRelationshipHistory)
      .where(and(...conditions))
      .orderBy(desc(crmLeadRelationshipHistory.createdAt))
      .limit(query.limit)
      .offset(query.offset),
    db
      .select({ count: sql<number>`count(*)` })
      .from(crmLeadRelationshipHistory)
      .where(and(...conditions)),
  ]);

  return {
    items,
    total: Number(countResult[0]?.count ?? 0),
  };
}
