import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { apiRequest, createIdempotencyKey } from "./client";
import { leadKeys } from "./leadsApi";

// ============================================================================
// SCHEMAS & TYPES
// ============================================================================

export const INBOX_CATEGORIES = [
  "all",
  "needs_review",
  "unassigned",
  "newly_assigned",
  "duplicates",
  "recently_reviewed",
] as const;
export type InboxCategory = (typeof INBOX_CATEGORIES)[number];

export const INBOX_STATUSES = ["needs_review", "reviewed"] as const;
export type InboxStatus = (typeof INBOX_STATUSES)[number];

export const DUP_REASONS = ["phone", "email", "name_company", "possible"] as const;
export type DupReason = (typeof DUP_REASONS)[number];

export const DUP_STRENGTHS = ["confirmed", "suggested"] as const;
export type DupStrength = (typeof DUP_STRENGTHS)[number];

export const DUP_DECISIONS = ["separate", "related", "dismiss"] as const;
export type DupDecision = (typeof DUP_DECISIONS)[number];

export const FIRST_CONTACT_STATUSES = [
  "not_contacted",
  "attempted",
  "established",
  "outbound",
  "followup_only",
] as const;
export type FirstContactStatus = (typeof FIRST_CONTACT_STATUSES)[number];

export const firstContactDtoSchema = z.union([
  z.object({
    status: z.string(),
    label: z.string().optional(),
    detail: z.string().optional(),
    lastAt: z.string().nullable().optional(),
    nextAt: z.string().nullable().optional(),
  }),
  z.string(),
]);
export type FirstContactDto = z.infer<typeof firstContactDtoSchema>;

export const inboxLeadSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  phone: z.string(),
  email: z.string().nullable().optional(),
  company: z.string().nullable().optional(),
  source: z.string(),
  status: z.string(),
  priority: z.string(),
  requirement: z.string().nullable().optional(),
  createdAt: z.string(),
});
export type InboxLeadSummary = z.infer<typeof inboxLeadSummarySchema>;

export const inboxRowDtoSchema = z.object({
  lead: inboxLeadSummarySchema,
  status: z.enum(INBOX_STATUSES),
  reviewStatus: z.enum(INBOX_STATUSES).optional(),
  reviewedAt: z.string().nullable().optional(),
  flagged: z.boolean(),
  flagNote: z.string().nullable().optional(),
  duplicate: z.boolean(),
  dupReasons: z.array(z.string()),
  assignee: z.string().nullable().optional(),
  contact: firstContactDtoSchema,
  ageDays: z.number(),
});
export type InboxRowDto = z.infer<typeof inboxRowDtoSchema>;

export const inboxOverviewDtoSchema = z.object({
  awaitingReview: z.number(),
  unassigned: z.number(),
  duplicates: z.number(),
  needFirstContact: z.number(),
  recent: z.number(),
  needsReviewCount: z.number().optional(),
  unassignedCount: z.number().optional(),
  duplicatesCount: z.number().optional(),
});
export type InboxOverviewDto = z.infer<typeof inboxOverviewDtoSchema>;

export const inboxPaginationSchema = z.object({
  page: z.number(),
  pageSize: z.number(),
  total: z.number(),
});
export type InboxPagination = z.infer<typeof inboxPaginationSchema>;

export const inboxQueueResponseSchema = z.object({
  ok: z.literal(true),
  items: z.array(inboxRowDtoSchema),
  total: z.number(),
  overview: inboxOverviewDtoSchema,
  stats: inboxOverviewDtoSchema.optional(),
  pagination: inboxPaginationSchema.optional(),
});
export type InboxQueueResponse = z.infer<typeof inboxQueueResponseSchema>;

export const dupCandidateLeadSchema = z.object({
  id: z.string(),
  name: z.string(),
  phone: z.string(),
  email: z.string().nullable().optional(),
  company: z.string().nullable().optional(),
  status: z.string(),
  priority: z.string(),
  source: z.string().optional(),
  createdAt: z.string().optional(),
  contactStatus: z
    .object({
      status: z.string(),
      label: z.string().optional(),
      detail: z.string().optional(),
    })
    .optional(),
  stats: z
    .object({
      dealsCount: z.number().optional(),
      totalDealValuePaise: z.number().optional(),
      paymentsCount: z.number().optional(),
      totalPaidPaise: z.number().optional(),
      callsCount: z.number().optional(),
      quotationsCount: z.number().optional(),
      projectsCount: z.number().optional(),
    })
    .optional(),
});
export type DupCandidateLead = z.infer<typeof dupCandidateLeadSchema>;

export const dupCandidateDtoSchema = z.object({
  id: z.string(),
  pairKey: z.string(),
  leadA: dupCandidateLeadSchema,
  leadB: dupCandidateLeadSchema,
  reasons: z.array(z.string()),
  strength: z.enum(DUP_STRENGTHS),
  status: z.enum(["pending", "reviewed", "dismissed"]),
  reopened: z.boolean().optional(),
  decisionKind: z.enum(DUP_DECISIONS).nullable().optional(),
  decisionNote: z.string().nullable().optional(),
  decidedAt: z.string().nullable().optional(),
  version: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type DupCandidateDto = z.infer<typeof dupCandidateDtoSchema>;

export const dupCandidateListResponseSchema = z.object({
  ok: z.literal(true),
  items: z.array(dupCandidateDtoSchema),
  total: z.number(),
});
export type DupCandidateListResponse = z.infer<typeof dupCandidateListResponseSchema>;

export const dupCandidateDetailSchema = dupCandidateDtoSchema.extend({
  existingRelationship: z
    .object({
      kind: z.enum(["separate", "related"]),
      notes: z.string().nullable().optional(),
      decidedAt: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
  mergeBlockers: z.array(z.string()).optional(),
});
export type DupCandidateDetail = z.infer<typeof dupCandidateDetailSchema>;

export const dupCandidateDetailResponseSchema = z.object({
  ok: z.literal(true),
  candidate: z.object({
    id: z.string(),
    pairKey: z.string(),
    reasons: z.array(z.string()),
    strength: z.string(),
    status: z.string(),
    reopened: z.boolean().optional(),
    decisionKind: z.string().nullable().optional(),
    decisionNote: z.string().nullable().optional(),
    decidedAt: z.string().nullable().optional(),
    version: z.number(),
    createdAt: z.string(),
    updatedAt: z.string(),
  }),
  leadA: z.record(z.unknown()),
  leadB: z.record(z.unknown()),
  statsA: z.record(z.unknown()).optional(),
  statsB: z.record(z.unknown()).optional(),
  mergeBlockers: z.array(z.string()).optional(),
  existingRelationship: z
    .object({
      kind: z.enum(["separate", "related"]),
      notes: z.string().nullable().optional(),
      decidedAt: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
});
export type DupCandidateDetailResponse = z.infer<typeof dupCandidateDetailResponseSchema>;

export const dupDecisionResponseSchema = z.object({
  ok: z.literal(true),
  candidateId: z.string(),
  pairKey: z.string(),
  kind: z.string().optional(),
  decision: z.enum(DUP_DECISIONS).optional(),
  relationship: z
    .object({
      id: z.string(),
      kind: z.string(),
      notes: z.string().nullable().optional(),
      createdAt: z.string().optional(),
    })
    .nullable()
    .optional(),
  candidate: z
    .object({
      id: z.string(),
      status: z.string(),
      decisionKind: z.string().nullable().optional(),
      decisionNote: z.string().nullable().optional(),
      version: z.number(),
    })
    .optional(),
});
export type DupDecisionResponse = z.infer<typeof dupDecisionResponseSchema>;

export const dupScanResponseSchema = z.object({
  ok: z.literal(true),
  scannedCount: z.number().optional(),
  leadsEvaluated: z.number().optional(),
  candidatesFound: z.number(),
  createdCount: z.number().optional(),
  updatedCount: z.number().optional(),
  reopenedCount: z.number().optional(),
});
export type DupScanResponse = z.infer<typeof dupScanResponseSchema>;

export const inboxReviewResponseSchema = z.object({
  ok: z.literal(true),
  affectedCount: z.number(),
  updatedCount: z.number().optional(),
  action: z.string().optional(),
});
export type InboxReviewResponse = z.infer<typeof inboxReviewResponseSchema>;

export const inboxFlagResponseSchema = z.object({
  ok: z.literal(true),
  leadId: z.string(),
  flagged: z.boolean(),
  flagNote: z.string().nullable().optional(),
});
export type InboxFlagResponse = z.infer<typeof inboxFlagResponseSchema>;

export const leadRelationshipItemSchema = z.object({
  id: z.string().optional(),
  relationshipId: z.string().optional(),
  pairKey: z.string(),
  otherLead: z.object({
    id: z.string(),
    name: z.string(),
    phone: z.string(),
    email: z.string().nullable().optional(),
    company: z.string().nullable().optional(),
    status: z.string().optional(),
    priority: z.string().optional(),
  }),
  kind: z.enum(["separate", "related"]),
  note: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string().optional(),
});
export type LeadRelationshipItem = z.infer<typeof leadRelationshipItemSchema>;

export const leadRelationshipsResponseSchema = z.object({
  ok: z.literal(true),
  items: z.array(leadRelationshipItemSchema),
});
export type LeadRelationshipsResponse = z.infer<typeof leadRelationshipsResponseSchema>;

export const unlinkRelationshipResponseSchema = z.object({
  ok: z.literal(true),
  unlinked: z.boolean().optional(),
  pairKey: z.string(),
});
export type UnlinkRelationshipResponse = z.infer<typeof unlinkRelationshipResponseSchema>;

export const reviewHistoryItemSchema = z.object({
  id: z.string(),
  pairKey: z.string().nullable().optional(),
  leadAId: z.string().nullable().optional(),
  leadBId: z.string().nullable().optional(),
  action: z.string(),
  note: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  metadata: z.unknown().optional(),
  actorUserId: z.string().nullable().optional(),
  createdAt: z.string(),
});
export type ReviewHistoryItem = z.infer<typeof reviewHistoryItemSchema>;

export const reviewHistoryResponseSchema = z.object({
  ok: z.literal(true),
  items: z.array(reviewHistoryItemSchema),
  total: z.number(),
});
export type ReviewHistoryResponse = z.infer<typeof reviewHistoryResponseSchema>;

// ============================================================================
// QUERY KEYS
// ============================================================================

export const inboxKeys = {
  all: ["inbox"] as const,
  queue: (filters?: Record<string, unknown>) =>
    [...inboxKeys.all, "queue", filters ?? {}] as const,
  candidates: (filters?: Record<string, unknown>) =>
    [...inboxKeys.all, "candidates", filters ?? {}] as const,
  candidate: (id: string) => [...inboxKeys.all, "candidate", id] as const,
  leadRelationships: (leadId: string) =>
    [...inboxKeys.all, "relationships", leadId] as const,
  reviewHistory: (filters?: Record<string, unknown>) =>
    [...inboxKeys.all, "history", filters ?? {}] as const,
};

// ============================================================================
// API FUNCTIONS
// ============================================================================

export interface InboxQueueQueryParams {
  category?: InboxCategory | undefined;
  q?: string | undefined;
  search?: string | undefined;
  source?: string | undefined;
  assignee?: string | undefined;
  priority?: string | undefined;
  stage?: string | undefined;
  status?: string | undefined;
  createdDays?: number | undefined;
  contactedDays?: number | undefined;
  firstContactPending?: boolean | undefined;
  duplicate?: boolean | undefined;
  page?: number | undefined;
  pageSize?: number | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
}

export async function getInboxQueue(
  params?: InboxQueueQueryParams,
  signal?: AbortSignal,
): Promise<InboxQueueResponse> {
  return apiRequest({
    path: "/api/v1/inbox",
    method: "GET",
    query: params as Record<string, string | number | boolean | undefined | null>,
    schema: inboxQueueResponseSchema,
    ...(signal ? { signal } : {}),
  });
}

export interface DupCandidatesQueryParams {
  status?: "pending" | "reviewed" | "dismissed" | "all" | undefined;
  strength?: "confirmed" | "suggested" | "all" | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
}

export async function getDuplicateCandidates(
  params?: DupCandidatesQueryParams,
  signal?: AbortSignal,
): Promise<DupCandidateListResponse> {
  return apiRequest({
    path: "/api/v1/inbox/candidates",
    method: "GET",
    query: params as Record<string, string | number | boolean | undefined | null>,
    schema: dupCandidateListResponseSchema,
    ...(signal ? { signal } : {}),
  });
}

export async function getDuplicateCandidate(
  id: string,
  signal?: AbortSignal,
): Promise<DupCandidateDetail> {
  const res = await apiRequest({
    path: `/api/v1/inbox/candidates/${encodeURIComponent(id)}`,
    method: "GET",
    schema: dupCandidateDetailResponseSchema,
    ...(signal ? { signal } : {}),
  });
  const c = res.candidate;
  const rawA = res.leadA as Record<string, unknown>;
  const rawB = res.leadB as Record<string, unknown>;
  const leadA: DupCandidateLead = {
    id: String(rawA["id"] ?? ""),
    name: String(rawA["name"] ?? ""),
    phone: String(rawA["phone"] ?? ""),
    email: rawA["email"] ? String(rawA["email"]) : null,
    company: rawA["company"] ? String(rawA["company"]) : null,
    status: String(rawA["status"] ?? "new"),
    priority: String(rawA["priority"] ?? "warm"),
    source: rawA["source"] ? String(rawA["source"]) : undefined,
    createdAt: rawA["createdAt"] ? String(rawA["createdAt"]) : undefined,
    contactStatus: rawA["contactStatus"] as DupCandidateLead["contactStatus"],
  };
  const leadB: DupCandidateLead = {
    id: String(rawB["id"] ?? ""),
    name: String(rawB["name"] ?? ""),
    phone: String(rawB["phone"] ?? ""),
    email: rawB["email"] ? String(rawB["email"]) : null,
    company: rawB["company"] ? String(rawB["company"]) : null,
    status: String(rawB["status"] ?? "new"),
    priority: String(rawB["priority"] ?? "warm"),
    source: rawB["source"] ? String(rawB["source"]) : undefined,
    createdAt: rawB["createdAt"] ? String(rawB["createdAt"]) : undefined,
    contactStatus: rawB["contactStatus"] as DupCandidateLead["contactStatus"],
  };

  return {
    id: c.id,
    pairKey: c.pairKey,
    reasons: c.reasons,
    strength: c.strength as "confirmed" | "suggested",
    status: c.status as "pending" | "reviewed" | "dismissed",
    reopened: c.reopened,
    decisionKind: c.decisionKind as "separate" | "related" | "dismiss" | null | undefined,
    decisionNote: c.decisionNote,
    decidedAt: c.decidedAt,
    version: c.version,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    leadA,
    leadB,
    mergeBlockers: res.mergeBlockers,
    existingRelationship: res.existingRelationship,
  };
}

export async function scanDuplicates(signal?: AbortSignal): Promise<DupScanResponse> {
  const idemKey = createIdempotencyKey();
  return apiRequest({
    path: "/api/v1/inbox/scan",
    method: "POST",
    body: { idempotencyKey: idemKey },
    idempotencyKey: idemKey,
    schema: dupScanResponseSchema,
    ...(signal ? { signal } : {}),
  });
}

export interface DecideDuplicateCandidateInput {
  decision: DupDecision;
  note?: string | undefined;
  notes?: string | undefined;
  expectedVersion?: number | undefined;
  idempotencyKey?: string | undefined;
}

export async function decideDuplicateCandidate(
  id: string,
  input: DecideDuplicateCandidateInput,
): Promise<DupDecisionResponse> {
  const idemKey = input.idempotencyKey ?? createIdempotencyKey();
  return apiRequest({
    path: `/api/v1/inbox/candidates/${encodeURIComponent(id)}/decision`,
    method: "POST",
    body: { ...input, idempotencyKey: idemKey },
    idempotencyKey: idemKey,
    schema: dupDecisionResponseSchema,
  });
}

export interface SetInboxReviewStatusInput {
  leadIds: string[];
  action?: "mark_reviewed" | "unmark_reviewed" | undefined;
  status?: "reviewed" | "needs_review" | undefined;
  idempotencyKey?: string | undefined;
}

export async function setInboxReviewStatus(
  input: SetInboxReviewStatusInput,
): Promise<InboxReviewResponse> {
  const idemKey = input.idempotencyKey ?? createIdempotencyKey();
  return apiRequest({
    path: "/api/v1/inbox/review",
    method: "POST",
    body: { ...input, idempotencyKey: idemKey },
    idempotencyKey: idemKey,
    schema: inboxReviewResponseSchema,
  });
}

export interface SetLeadDuplicateFlagInput {
  leadId: string;
  action?: "flag" | "unflag" | undefined;
  flagged?: boolean | undefined;
  note?: string | undefined;
  idempotencyKey?: string | undefined;
}

export async function setLeadDuplicateFlag(
  input: SetLeadDuplicateFlagInput,
): Promise<InboxFlagResponse> {
  const idemKey = input.idempotencyKey ?? createIdempotencyKey();
  return apiRequest({
    path: "/api/v1/inbox/flag",
    method: "POST",
    body: { ...input, idempotencyKey: idemKey },
    idempotencyKey: idemKey,
    schema: inboxFlagResponseSchema,
  });
}

export async function getLeadRelationships(
  leadId: string,
  signal?: AbortSignal,
): Promise<LeadRelationshipItem[]> {
  const res = await apiRequest({
    path: `/api/v1/leads/${encodeURIComponent(leadId)}/relationships`,
    method: "GET",
    schema: leadRelationshipsResponseSchema,
    ...(signal ? { signal } : {}),
  });
  return res.items;
}

export async function unlinkLeadRelationship(
  pairKey: string,
): Promise<UnlinkRelationshipResponse> {
  return apiRequest({
    path: `/api/v1/leads/relationships/${encodeURIComponent(pairKey)}`,
    method: "DELETE",
    schema: unlinkRelationshipResponseSchema,
  });
}

export interface ReviewHistoryQueryParams {
  pairKey?: string | undefined;
  leadId?: string | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
}

export async function getReviewHistory(
  params?: ReviewHistoryQueryParams,
  signal?: AbortSignal,
): Promise<ReviewHistoryResponse> {
  return apiRequest({
    path: "/api/v1/inbox/review-history",
    method: "GET",
    query: params as Record<string, string | number | boolean | undefined | null>,
    schema: reviewHistoryResponseSchema,
    ...(signal ? { signal } : {}),
  });
}

// ============================================================================
// REACT QUERY HOOKS
// ============================================================================

export function useInboxQueueQuery(params?: InboxQueueQueryParams) {
  return useQuery({
    queryKey: inboxKeys.queue(params as Record<string, unknown>),
    queryFn: ({ signal }) => getInboxQueue(params, signal),
    staleTime: 10_000,
  });
}

export function useDuplicateCandidatesQuery(params?: DupCandidatesQueryParams) {
  return useQuery({
    queryKey: inboxKeys.candidates(params as Record<string, unknown>),
    queryFn: ({ signal }) => getDuplicateCandidates(params, signal),
    staleTime: 15_000,
  });
}

export function useDuplicateCandidateQuery(id: string | null | undefined) {
  return useQuery({
    queryKey: inboxKeys.candidate(id ?? ""),
    queryFn: ({ signal }) => getDuplicateCandidate(id!, signal),
    enabled: Boolean(id),
    staleTime: 5_000,
  });
}

export function useScanDuplicatesMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => scanDuplicates(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: inboxKeys.all });
    },
  });
}

export function useDecideDuplicateCandidateMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: DecideDuplicateCandidateInput }) =>
      decideDuplicateCandidate(id, input),
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: inboxKeys.all });
      void queryClient.invalidateQueries({ queryKey: leadKeys.all });
    },
  });
}

export function useSetInboxReviewStatusMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: SetInboxReviewStatusInput) => setInboxReviewStatus(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: inboxKeys.all });
    },
  });
}

export function useSetLeadDuplicateFlagMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: SetLeadDuplicateFlagInput) => setLeadDuplicateFlag(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: inboxKeys.all });
    },
  });
}

export function useLeadRelationshipsQuery(leadId: string | null | undefined) {
  return useQuery({
    queryKey: inboxKeys.leadRelationships(leadId ?? ""),
    queryFn: ({ signal }) => getLeadRelationships(leadId!, signal),
    enabled: Boolean(leadId),
    staleTime: 10_000,
  });
}

export function useUnlinkLeadRelationshipMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (pairKey: string) => unlinkLeadRelationship(pairKey),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: inboxKeys.all });
      void queryClient.invalidateQueries({ queryKey: leadKeys.all });
    },
  });
}

export function useReviewHistoryQuery(params?: ReviewHistoryQueryParams) {
  return useQuery({
    queryKey: inboxKeys.reviewHistory(params as Record<string, unknown>),
    queryFn: ({ signal }) => getReviewHistory(params, signal),
    staleTime: 15_000,
  });
}
