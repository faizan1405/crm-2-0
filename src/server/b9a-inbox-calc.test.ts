import fs from "node:fs";
import path from "node:path";
import { getTableColumns, getTableName } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  computeAgeDays,
  evaluateDuplicateMatch,
  firstContactState,
  isContactPending,
  isWithinDays,
  normalizeEmail,
  normalizePhone,
  normName,
  pairKey,
  pairSignature,
} from "./crm/inboxCalc.server";
import {
  appSchema,
  crmCoreSchema,
  crmDuplicateCandidates,
  crmInboxSchema,
  crmLeadInboxItems,
  crmLeadRelationshipHistory,
  crmLeadRelationships,
} from "./db/schema.server";

describe("Checkpoint B9A — Smart Inbox & Lead Relationships Schema & Calculation Suite", () => {
  describe("1. Drizzle Schema & Migration 0011 Forward Safety", () => {
    it("exports all 4 inbox tables in crmInboxSchema, crmCoreSchema, and appSchema", () => {
      expect(getTableName(crmLeadInboxItems)).toBe("crm_lead_inbox_items");
      expect(getTableName(crmDuplicateCandidates)).toBe("crm_duplicate_candidates");
      expect(getTableName(crmLeadRelationships)).toBe("crm_lead_relationships");
      expect(getTableName(crmLeadRelationshipHistory)).toBe("crm_lead_relationship_history");

      expect(crmInboxSchema.crmLeadInboxItems).toBe(crmLeadInboxItems);
      expect(crmInboxSchema.crmDuplicateCandidates).toBe(crmDuplicateCandidates);
      expect(crmInboxSchema.crmLeadRelationships).toBe(crmLeadRelationships);
      expect(crmInboxSchema.crmLeadRelationshipHistory).toBe(crmLeadRelationshipHistory);

      expect(crmCoreSchema.crmLeadInboxItems).toBe(crmLeadInboxItems);
      expect(crmCoreSchema.crmDuplicateCandidates).toBe(crmDuplicateCandidates);
      expect(crmCoreSchema.crmLeadRelationships).toBe(crmLeadRelationships);
      expect(crmCoreSchema.crmLeadRelationshipHistory).toBe(crmLeadRelationshipHistory);

      expect(appSchema.crmLeadInboxItems).toBe(crmLeadInboxItems);
      expect(appSchema.crmDuplicateCandidates).toBe(crmDuplicateCandidates);
      expect(appSchema.crmLeadRelationships).toBe(crmLeadRelationships);
      expect(appSchema.crmLeadRelationshipHistory).toBe(crmLeadRelationshipHistory);
    });

    it("verifies crmLeadInboxItems column definitions", () => {
      const cols = Object.keys(getTableColumns(crmLeadInboxItems));
      expect(cols).toEqual(
        expect.arrayContaining([
          "id",
          "leadId",
          "ownerUserId",
          "status",
          "reviewedAt",
          "flaggedAt",
          "flagNote",
          "version",
          "createdAt",
          "updatedAt",
        ]),
      );
    });

    it("verifies crmDuplicateCandidates column definitions", () => {
      const cols = Object.keys(getTableColumns(crmDuplicateCandidates));
      expect(cols).toEqual(
        expect.arrayContaining([
          "id",
          "ownerUserId",
          "pairKey",
          "leadAId",
          "leadBId",
          "reasonsJson",
          "strength",
          "status",
          "pairSignature",
          "reopened",
          "decisionKind",
          "decisionNote",
          "decidedAt",
          "decidedByUserId",
          "version",
          "createdAt",
          "updatedAt",
        ]),
      );
    });

    it("verifies crmLeadRelationships column definitions", () => {
      const cols = Object.keys(getTableColumns(crmLeadRelationships));
      expect(cols).toEqual(
        expect.arrayContaining([
          "id",
          "ownerUserId",
          "pairKey",
          "leadAId",
          "leadBId",
          "kind",
          "signature",
          "note",
          "version",
          "createdAt",
          "updatedAt",
        ]),
      );
    });

    it("verifies crmLeadRelationshipHistory column definitions", () => {
      const cols = Object.keys(getTableColumns(crmLeadRelationshipHistory));
      expect(cols).toEqual(
        expect.arrayContaining([
          "id",
          "ownerUserId",
          "pairKey",
          "leadAId",
          "leadBId",
          "candidateId",
          "action",
          "kind",
          "previousKind",
          "signature",
          "note",
          "actorUserId",
          "createdAt",
        ]),
      );
    });

    it("verifies migration 0011_b9a_smart_inbox_relationships.sql exists on disk and defines all 4 tables", () => {
      const migrationPath = path.resolve(
        process.cwd(),
        "src/server/db/migrations/0011_b9a_smart_inbox_relationships.sql",
      );
      expect(fs.existsSync(migrationPath)).toBe(true);
      const sql = fs.readFileSync(migrationPath, "utf-8");

      expect(sql).toContain("`crm_lead_inbox_items`");
      expect(sql).toContain("`crm_duplicate_candidates`");
      expect(sql).toContain("`crm_lead_relationships`");
      expect(sql).toContain("`crm_lead_relationship_history`");

      // Verify indexes and constraints
      expect(sql).toContain("idx_crm_lead_inbox_items_owner_status");
      expect(sql).toContain("idx_crm_dup_candidates_owner_status");
      expect(sql).toContain("idx_crm_lead_rel_owner_kind");
      expect(sql).toContain("idx_crm_inbox_audit_owner_pair");
    });
  });

  describe("2. Pure Phone Normalization", () => {
    it("normalizes bare 10-digit Indian numbers (starting with 6-9) to 91XXXXXXXXXX", () => {
      expect(normalizePhone("9876543210")).toBe("919876543210");
      expect(normalizePhone("8888888888")).toBe("918888888888");
      expect(normalizePhone("7000000000")).toBe("917000000000");
      expect(normalizePhone("6123456789")).toBe("916123456789");
    });

    it("normalizes Indian numbers with leading 0 to 91XXXXXXXXXX", () => {
      expect(normalizePhone("09876543210")).toBe("919876543210");
      expect(normalizePhone("0 98765 43210")).toBe("919876543210");
    });

    it("normalizes Indian numbers with explicit +91 country code", () => {
      expect(normalizePhone("+91 98765-43210")).toBe("919876543210");
      expect(normalizePhone("+919876543210")).toBe("919876543210");
      expect(normalizePhone("+91 (0) 98765 43210")).toBe("919876543210");
    });

    it("normalizes numbers already starting with 91", () => {
      expect(normalizePhone("919876543210")).toBe("919876543210");
    });

    it("preserves international numbers with non-Indian country codes", () => {
      expect(normalizePhone("+1 (555) 234-5678")).toBe("15552345678");
      expect(normalizePhone("+44 20 7946 0958")).toBe("442079460958");
      expect(normalizePhone("+971 50 123 4567")).toBe("971501234567");
      expect(normalizePhone("001 555 234 5678")).toBe("15552345678");
    });

    it("ensures US numbers never match Indian numbers with identical digits", () => {
      const usPhone = normalizePhone("+1 9876543210");
      const inPhone = normalizePhone("+91 9876543210");
      expect(usPhone).toBe("19876543210");
      expect(inPhone).toBe("919876543210");
      expect(usPhone).not.toBe(inPhone);
    });

    it("returns undefined for null, undefined, empty string, or too short input", () => {
      expect(normalizePhone(null)).toBeUndefined();
      expect(normalizePhone(undefined)).toBeUndefined();
      expect(normalizePhone("")).toBeUndefined();
      expect(normalizePhone("   ")).toBeUndefined();
      expect(normalizePhone("123")).toBeUndefined();
      expect(normalizePhone("abcd")).toBeUndefined();
    });
  });

  describe("3. Pure Email Normalization", () => {
    it("lowercases and trims valid email addresses", () => {
      expect(normalizeEmail("  Test.User@Example.COM ")).toBe("test.user@example.com");
      expect(normalizeEmail("rajesh.kumar@scaleflow.ai")).toBe("rajesh.kumar@scaleflow.ai");
    });

    it("preserves plus addressing and dots without destroying provider semantics", () => {
      expect(normalizeEmail("sales+demo@enterprise.co.in")).toBe("sales+demo@enterprise.co.in");
      expect(normalizeEmail("a.b.c@gmail.com")).toBe("a.b.c@gmail.com");
    });

    it("returns undefined for invalid email formats, null, or empty string", () => {
      expect(normalizeEmail(null)).toBeUndefined();
      expect(normalizeEmail(undefined)).toBeUndefined();
      expect(normalizeEmail("")).toBeUndefined();
      expect(normalizeEmail("not-an-email")).toBeUndefined();
      expect(normalizeEmail("@missing-user.com")).toBeUndefined();
      expect(normalizeEmail("user@missing-tld")).toBeUndefined();
    });
  });

  describe("4. Name Normalization & Canonical Pair Keys", () => {
    it("normalizes names by removing punctuation and collapsing spaces", () => {
      expect(normName("  Acme & Co., Ltd.  ")).toBe("acme co ltd");
      expect(normName("Dr. Rajesh Kumar-Sharma")).toBe("dr rajesh kumar sharma");
      expect(normName("")).toBe("");
      expect(normName(null)).toBe("");
    });

    it("orders pair keys canonically with smaller ID first", () => {
      expect(pairKey("lead_001", "lead_002")).toBe("lead_001|lead_002");
      expect(pairKey("lead_002", "lead_001")).toBe("lead_001|lead_002");
      expect(pairKey("lead_z", "lead_a")).toBe("lead_a|lead_z");
    });

    it("throws an error when trying to pair a lead with itself", () => {
      expect(() => pairKey("lead_001", "lead_001")).toThrow("Self-referencing lead pair is invalid");
    });
  });

  describe("5. Pair Signatures for Reopening Detection", () => {
    const lead1 = { phone: "+91 9876543210", email: "rajesh@acme.com" };
    const lead2 = { phone: "09876543210", email: "info@acme.com" };

    it("computes symmetric pair signatures regardless of argument order", () => {
      const sig1 = pairSignature(lead1, lead2);
      const sig2 = pairSignature(lead2, lead1);
      expect(sig1).toBe(sig2);
    });

    it("detects phone mutations and produces a different signature", () => {
      const sigOriginal = pairSignature(lead1, lead2);
      const lead1UpdatedPhone = { ...lead1, phone: "+91 9999988888" };
      const sigChanged = pairSignature(lead1UpdatedPhone, lead2);
      expect(sigOriginal).not.toBe(sigChanged);
    });

    it("detects email mutations and produces a different signature", () => {
      const sigOriginal = pairSignature(lead1, lead2);
      const lead2UpdatedEmail = { ...lead2, email: "other@acme.com" };
      const sigChanged = pairSignature(lead1, lead2UpdatedEmail);
      expect(sigOriginal).not.toBe(sigChanged);
    });
  });

  describe("6. Duplicate Match Evaluation", () => {
    const baseLeadA = {
      id: "lead_a",
      name: "Rajesh Kumar",
      phone: "+91 9876543210",
      email: "rajesh@acme.com",
      company: "Acme Enterprises",
    };

    it("identifies exact phone match as a confirmed match", () => {
      const leadB = {
        id: "lead_b",
        name: "R. Kumar",
        phone: "09876543210", // matches normalized
        email: "other@domain.com",
        company: "Different Corp",
      };
      const res = evaluateDuplicateMatch(baseLeadA, leadB);
      expect(res.isMatch).toBe(true);
      expect(res.strength).toBe("confirmed");
      expect(res.reasons).toEqual(["phone"]);
    });

    it("identifies exact email match as a confirmed match", () => {
      const leadB = {
        id: "lead_b",
        name: "Different Person",
        phone: "+91 8888877777",
        email: "RAJESH@ACME.COM", // case insensitive match
        company: "Different Corp",
      };
      const res = evaluateDuplicateMatch(baseLeadA, leadB);
      expect(res.isMatch).toBe(true);
      expect(res.strength).toBe("confirmed");
      expect(res.reasons).toEqual(["email"]);
    });

    it("identifies both phone and email matches", () => {
      const leadB = {
        id: "lead_b",
        name: "Rajesh K",
        phone: "919876543210",
        email: "rajesh@acme.com",
        company: "Any Company",
      };
      const res = evaluateDuplicateMatch(baseLeadA, leadB);
      expect(res.isMatch).toBe(true);
      expect(res.strength).toBe("confirmed");
      expect(res.reasons).toEqual(expect.arrayContaining(["phone", "email"]));
    });

    it("marks name + company match as suggested possible match when phone and email differ", () => {
      const leadB = {
        id: "lead_b",
        name: "rajesh kumar",
        phone: "+91 7777766666",
        email: "office@acme.com",
        company: "ACME ENTERPRISES",
      };
      const res = evaluateDuplicateMatch(baseLeadA, leadB);
      expect(res.isMatch).toBe(true);
      expect(res.strength).toBe("suggested");
      expect(res.reasons).toEqual(["possible"]);
    });

    it("NEVER treats identical name alone as a duplicate match", () => {
      const leadB = {
        id: "lead_b",
        name: "Rajesh Kumar",
        phone: "+91 7777766666",
        email: "different@domain.com",
        company: "Unrelated Pvt Ltd",
      };
      const res = evaluateDuplicateMatch(baseLeadA, leadB);
      expect(res.isMatch).toBe(false);
      expect(res.reasons).toHaveLength(0);
    });

    it("NEVER treats identical company alone as a duplicate match", () => {
      const leadB = {
        id: "lead_b",
        name: "Pooja Verma",
        phone: "+91 7777766666",
        email: "pooja@acme.com",
        company: "Acme Enterprises",
      };
      const res = evaluateDuplicateMatch(baseLeadA, leadB);
      expect(res.isMatch).toBe(false);
      expect(res.reasons).toHaveLength(0);
    });

    it("returns no match when comparing the same lead ID with itself", () => {
      const res = evaluateDuplicateMatch(baseLeadA, baseLeadA);
      expect(res.isMatch).toBe(false);
      expect(res.reasons).toHaveLength(0);
    });
  });

  describe("7. First Contact State Derivation", () => {
    it("returns 'established' when any call has 'Connected' outcome", () => {
      const activities = [
        { type: "call", outcome: "No Answer" },
        { type: "call", outcome: "Connected" },
      ];
      expect(firstContactState(activities, [])).toBe("established");
    });

    it("returns 'attempted' when calls have non-connected outcomes and no connected call", () => {
      const activities = [
        { type: "call", outcome: "Busy" },
        { type: "call", outcome: "Voicemail" },
      ];
      expect(firstContactState(activities, [])).toBe("attempted");
    });

    it("returns 'outbound' when whatsapp activity exists and no calls", () => {
      const activities = [{ type: "whatsapp", outcome: "sent" }];
      expect(firstContactState(activities, [])).toBe("outbound");
    });

    it("returns 'followup_only' when follow-ups exist but NO calls or whatsapp messages occurred", () => {
      const followUps = [{ completedAt: null, cancelledAt: null }];
      expect(firstContactState([], followUps)).toBe("followup_only");
    });

    it("returns 'not_contacted' when no activities and no pending follow-ups exist", () => {
      expect(firstContactState([], [])).toBe("not_contacted");
      expect(
        firstContactState(
          [],
          [{ completedAt: "2026-11-10T10:00:00Z", cancelledAt: null }],
        ),
      ).toBe("not_contacted");
    });

    it("correctly identifies pending contact state", () => {
      expect(isContactPending("not_contacted")).toBe(true);
      expect(isContactPending("followup_only")).toBe(true);
      expect(isContactPending("outbound")).toBe(false);
      expect(isContactPending("attempted")).toBe(false);
      expect(isContactPending("established")).toBe(false);
    });
  });

  describe("8. Inbox Age & Recency Calculations", () => {
    const fixedNow = new Date("2026-11-11T12:00:00Z");

    it("computes lead intake age in whole days correctly", () => {
      expect(computeAgeDays("2026-11-11T12:00:00Z", fixedNow)).toBe(0);
      expect(computeAgeDays("2026-11-10T12:00:00Z", fixedNow)).toBe(1);
      expect(computeAgeDays("2026-11-06T12:00:00Z", fixedNow)).toBe(5);
      expect(computeAgeDays("invalid-date", fixedNow)).toBe(0);
    });

    it("determines whether an ISO timestamp is within a given day window", () => {
      expect(isWithinDays("2026-11-10T12:00:00Z", 3, fixedNow)).toBe(true);
      expect(isWithinDays("2026-11-05T12:00:00Z", 3, fixedNow)).toBe(false);
      expect(isWithinDays("2026-11-05T12:00:00Z", 7, fixedNow)).toBe(true);
      expect(isWithinDays(null, 7, fixedNow)).toBe(false);
      expect(isWithinDays("invalid-date", 7, fixedNow)).toBe(false);
    });
  });
});
