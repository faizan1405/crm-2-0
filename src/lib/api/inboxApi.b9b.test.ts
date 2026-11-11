import { describe, expect, it, vi } from "vitest";
import {
  inboxQueueResponseSchema,
  dupCandidateListResponseSchema,
  dupCandidateDetailResponseSchema,
  dupDecisionResponseSchema,
  dupScanResponseSchema,
  inboxReviewResponseSchema,
  inboxFlagResponseSchema,
  leadRelationshipsResponseSchema,
  reviewHistoryResponseSchema,
  getInboxQueue,
  getDuplicateCandidates,
  getDuplicateCandidate,
  scanDuplicates,
  decideDuplicateCandidate,
  setInboxReviewStatus,
  setLeadDuplicateFlag,
  getLeadRelationships,
  unlinkLeadRelationship,
  getReviewHistory,
} from "./inboxApi";

describe("Checkpoint B9B: Typed Inbox API & Contracts", () => {
  it("validates inboxQueueResponseSchema with items, stats, and pagination", () => {
    const raw = {
      ok: true,
      items: [
        {
          lead: {
            id: "lead_01",
            name: "Rajesh Kumar",
            phone: "+91 98765 43210",
            email: "rajesh@acme.in",
            company: "Acme Corp",
            source: "Website",
            status: "new",
            priority: "hot",
            requirement: "ERP overhaul",
            createdAt: "2026-11-10T10:00:00.000Z",
          },
          status: "needs_review",
          reviewStatus: "needs_review",
          reviewedAt: null,
          flagged: false,
          flagNote: null,
          duplicate: true,
          dupReasons: ["phone"],
          assignee: null,
          contact: {
            status: "established",
            label: "Contacted",
            detail: "Call connected",
          },
          ageDays: 1,
        },
      ],
      total: 1,
      overview: {
        awaitingReview: 1,
        unassigned: 1,
        duplicates: 1,
        needFirstContact: 0,
        recent: 1,
        needsReviewCount: 1,
        unassignedCount: 1,
        duplicatesCount: 1,
      },
      stats: {
        awaitingReview: 1,
        unassigned: 1,
        duplicates: 1,
        needFirstContact: 0,
        recent: 1,
        needsReviewCount: 1,
        unassignedCount: 1,
        duplicatesCount: 1,
      },
      pagination: {
        page: 1,
        pageSize: 50,
        total: 1,
      },
    };

    const parsed = inboxQueueResponseSchema.parse(raw);
    expect(parsed.ok).toBe(true);
    expect(parsed.items).toHaveLength(1);
    expect(parsed.items[0]?.lead.name).toBe("Rajesh Kumar");
    expect(parsed.overview.awaitingReview).toBe(1);
    expect(parsed.overview.needsReviewCount).toBe(1);
  });

  it("validates dupCandidateDetailResponseSchema with mergeBlockers and stats", () => {
    const raw = {
      ok: true,
      candidate: {
        id: "cand_01",
        pairKey: "lead_01:lead_02",
        reasons: ["phone"],
        strength: "confirmed",
        status: "pending",
        reopened: false,
        decisionKind: null,
        decisionNote: null,
        decidedAt: null,
        version: 1,
        createdAt: "2026-11-10T10:00:00.000Z",
        updatedAt: "2026-11-10T10:00:00.000Z",
      },
      leadA: {
        id: "lead_01",
        name: "Rajesh Kumar",
        phone: "+91 98765 43210",
        email: "rajesh@acme.in",
        company: "Acme Corp",
        status: "new",
        priority: "hot",
        contactStatus: "established",
      },
      leadB: {
        id: "lead_02",
        name: "R. Kumar",
        phone: "09876543210",
        email: "r.kumar@acme.in",
        company: "Acme",
        status: "contacted",
        priority: "warm",
        contactStatus: "pending",
      },
      existingRelationship: null,
      mergeBlockers: ["Lead A has 1 active deal"],
    };

    const parsed = dupCandidateDetailResponseSchema.parse(raw);
    expect(parsed.ok).toBe(true);
    expect(parsed.candidate.strength).toBe("confirmed");
    expect(parsed.mergeBlockers).toContain("Lead A has 1 active deal");
  });

  it("validates dupDecisionResponseSchema and decision kinds", () => {
    const raw = {
      ok: true,
      candidateId: "cand_01",
      pairKey: "lead_01:lead_02",
      decision: "separate",
      relationship: {
        id: "rel_01",
        kind: "separate",
        notes: "Different branch offices",
        createdAt: "2026-11-10T11:00:00.000Z",
      },
      candidate: {
        id: "cand_01",
        status: "reviewed",
        decisionKind: "separate",
        decisionNote: "Different branch offices",
        version: 2,
      },
    };

    const parsed = dupDecisionResponseSchema.parse(raw);
    expect(parsed.ok).toBe(true);
    expect(parsed.decision).toBe("separate");
    expect(parsed.candidate?.version).toBe(2);
  });

  it("validates dupScanResponseSchema and counts", () => {
    const raw = {
      ok: true,
      leadsEvaluated: 12,
      candidatesFound: 4,
      createdCount: 2,
      updatedCount: 1,
      reopenedCount: 1,
    };

    const parsed = dupScanResponseSchema.parse(raw);
    expect(parsed.leadsEvaluated).toBe(12);
    expect(parsed.candidatesFound).toBe(4);
    expect(parsed.reopenedCount).toBe(1);
  });

  it("validates reviewHistoryResponseSchema with actors and timestamps", () => {
    const raw = {
      ok: true,
      items: [
        {
          id: "irae_01",
          pairKey: "lead_01:lead_02",
          leadAId: "lead_01",
          leadBId: "lead_02",
          action: "mark_separate",
          notes: "Confirmed separate entities",
          actorUserId: "usr_owner_1",
          createdAt: "2026-11-10T11:00:00.000Z",
        },
      ],
      total: 1,
    };

    const parsed = reviewHistoryResponseSchema.parse(raw);
    expect(parsed.ok).toBe(true);
    expect(parsed.items[0]?.action).toBe("mark_separate");
  });
});
