import "@tanstack/react-start/server-only";
import { z } from "zod";

export const inboxCategoryEnum = z.enum([
  "all",
  "needs_review",
  "unassigned",
  "newly_assigned",
  "duplicates",
  "recently_reviewed",
]);

export const leadStageEnum = z.enum([
  "new",
  "contacted",
  "qualified",
  "proposal",
  "won",
  "lost",
]);

export const leadPriorityEnum = z.enum(["hot", "warm", "cold"]);

export const inboxStatusEnum = z.enum(["needs_review", "reviewed"]);

export const dupCandidateStatusEnum = z.enum([
  "pending",
  "reviewed",
  "dismissed",
]);

export const dupDecisionEnum = z.enum(["separate", "related", "dismiss"]);

export const inboxQueueQuerySchema = z
  .object({
    category: inboxCategoryEnum.default("all"),
    q: z.string().trim().optional(),
    search: z.string().trim().optional(),
    source: z.string().trim().optional(),
    assignee: z.string().trim().optional(),
    priority: z.union([leadPriorityEnum, z.literal("all")]).default("all"),
    stage: z.union([leadStageEnum, z.literal("all")]).default("all"),
    status: z.union([inboxStatusEnum, z.literal("all")]).default("all"),
    createdDays: z.coerce.number().int().min(1).max(365).optional(),
    contactedDays: z.coerce.number().int().min(1).max(365).optional(),
    firstContactPending: z
      .union([z.boolean(), z.string().transform((v) => v === "true" || v === "1")])
      .optional(),
    duplicate: z
      .union([z.boolean(), z.string().transform((v) => v === "true" || v === "1")])
      .optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
    offset: z.coerce.number().int().min(0).default(0),
    page: z.coerce.number().int().min(1).optional(),
    pageSize: z.coerce.number().int().min(1).max(200).optional(),
  })
  .transform((v) => {
    const limit = v.pageSize ?? v.limit;
    const offset = v.page ? (v.page - 1) * limit : v.offset;
    const q = v.search ?? v.q;
    return { ...v, limit, offset, q };
  });

export type InboxQueueQuery = z.infer<typeof inboxQueueQuerySchema>;

export const inboxReviewBodySchema = z
  .object({
    leadIds: z.array(z.string().trim().min(1)).min(1).max(100),
    action: z.enum(["mark_reviewed", "unmark_reviewed"]).optional(),
    status: z.enum(["reviewed", "needs_review"]).optional(),
    idempotencyKey: z.string().trim().max(128).optional(),
  })
  .transform((v) => ({
    ...v,
    action: (v.action ?? (v.status === "reviewed" ? "mark_reviewed" : "unmark_reviewed")) as
      | "mark_reviewed"
      | "unmark_reviewed",
  }));

export type InboxReviewBody = z.infer<typeof inboxReviewBodySchema>;

export const inboxFlagBodySchema = z
  .object({
    leadId: z.string().trim().min(1),
    action: z.enum(["flag", "unflag"]).optional(),
    flagged: z.boolean().optional(),
    note: z.string().trim().max(255).optional(),
    idempotencyKey: z.string().trim().max(128).optional(),
  })
  .transform((v) => ({
    ...v,
    action: (v.action ?? (v.flagged === false ? "unflag" : "flag")) as "flag" | "unflag",
  }));

export type InboxFlagBody = z.infer<typeof inboxFlagBodySchema>;

export const dupCandidatesQuerySchema = z.object({
  status: z.union([dupCandidateStatusEnum, z.literal("all")]).default("pending"),
  strength: z.enum(["confirmed", "suggested", "all"]).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export type DupCandidatesQuery = z.infer<typeof dupCandidatesQuerySchema>;

export const dupCandidateDecisionBodySchema = z.object({
  decision: dupDecisionEnum,
  note: z.string().trim().max(255).optional(),
  notes: z.string().trim().max(255).optional(),
  expectedVersion: z.number().int().min(1).optional(),
  idempotencyKey: z.string().trim().max(128).optional(),
});

export type DupCandidateDecisionBody = z.infer<typeof dupCandidateDecisionBodySchema>;

export const dupScanBodySchema = z.object({
  idempotencyKey: z.string().trim().max(128).optional(),
});

export type DupScanBody = z.infer<typeof dupScanBodySchema>;

export const reviewHistoryQuerySchema = z.object({
  pairKey: z.string().trim().optional(),
  leadId: z.string().trim().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export type ReviewHistoryQuery = z.infer<typeof reviewHistoryQuerySchema>;
