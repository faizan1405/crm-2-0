import { z } from "zod";

export const LEAD_SOURCES_API = [
  "Website",
  "Referral",
  "Instagram",
  "Google Ads",
  "LinkedIn",
  "Walk-in",
  "WhatsApp",
  "Meta Ads",
  "Facebook",
  "Google",
  "IndiaMART",
  "Direct Enquiry",
  "Other",
] as const;

export const LEAD_STATUSES_API = [
  "new",
  "contacted",
  "qualified",
  "proposal",
  "won",
  "lost",
] as const;

export const LEAD_PRIORITIES_API = ["hot", "warm", "cold"] as const;

export const QUICK_STATUSES_API = [
  "interested",
  "callback",
  "not_picked",
  "busy",
  "not_interested",
  "switched_off",
] as const;

export const LEAD_LIFECYCLE_API = ["active", "waste", "deleted"] as const;

export const MANUAL_ACTIVITY_TYPES_API = ["note", "meeting", "email"] as const;

export const ALL_ACTIVITY_TYPES_API = [
  "created",
  "merged",
  "waste",
  "restored",
  "quick",
  "call",
  "whatsapp",
  "email",
  "meeting",
  "note",
  "status",
  "payment",
  "followup",
  "edit",
] as const;

export const FOLLOWUP_TYPES_API = ["call", "whatsapp", "meeting", "email"] as const;

export const CALL_OUTCOMES_API = [
  "Connected",
  "Not picked",
  "Busy",
  "Call back later",
  "Interested",
  "Not interested",
  "Qualified",
  "Proposal Sent",
  "Won",
  "Lost",
] as const;

export const WA_PURPOSES_API = ["followup", "quotation", "samples", "custom"] as const;
export const WA_CONFIRMATION_STATUSES_API = ["owner_confirmed_sent"] as const;

export type LeadSourceApi = (typeof LEAD_SOURCES_API)[number];
export type LeadStatusApi = (typeof LEAD_STATUSES_API)[number];
export type LeadPriorityApi = (typeof LEAD_PRIORITIES_API)[number];
export type QuickStatusApi = (typeof QUICK_STATUSES_API)[number];
export type LeadLifecycleApi = (typeof LEAD_LIFECYCLE_API)[number];
export type ManualActivityTypeApi = (typeof MANUAL_ACTIVITY_TYPES_API)[number];
export type ActivityTypeApi = (typeof ALL_ACTIVITY_TYPES_API)[number];
export type FollowUpTypeApi = (typeof FOLLOWUP_TYPES_API)[number];
export type CallOutcomeApi = (typeof CALL_OUTCOMES_API)[number];
export type WaPurposeApi = (typeof WA_PURPOSES_API)[number];
export type WaConfirmationStatusApi = (typeof WA_CONFIRMATION_STATUSES_API)[number];

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const CALENDAR_YMD_HM_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?$/;

function isValidCalendarDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
}

/**
 * Validates and converts either an explicit ISO timestamp (with offset/Z) or a naive
 * `YYYY-MM-DDTHH:mm` business datetime-local string into a canonical `Asia/Kolkata` ISO string.
 * Mirrors `dates.server.ts` calendar rollover checks so dates like `2026-02-30T10:00` fail cleanly.
 */
export function parseIstDateTimeInput(
  raw: string,
): { ok: true; utcIso: string; istInput: string; istDate: string } | { ok: false; error: string } {
  const value = raw.trim();
  if (!value) {
    return { ok: false, error: "Choose a valid date and time." };
  }

  const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value);
  if (hasZone) {
    const datePrefix = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/);
    if (datePrefix) {
      const y = Number(datePrefix[1]);
      const m = Number(datePrefix[2]);
      const d = Number(datePrefix[3]);
      const hh = Number(datePrefix[4]);
      const mm = Number(datePrefix[5]);
      const ss = Number(datePrefix[6] ?? "0");
      if (!isValidCalendarDate(y, m, d) || hh > 23 || mm > 59 || ss > 59) {
        return { ok: false, error: "Date or time value is outside valid calendar bounds." };
      }
    }
    const offsetMatch = value.match(/([+-])(\d{2}):?(\d{2})$/);
    if (offsetMatch) {
      const oh = Number(offsetMatch[2]);
      const om = Number(offsetMatch[3]);
      if (oh > 23 || om > 59) {
        return { ok: false, error: "Timezone offset is invalid." };
      }
    }
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      return { ok: false, error: "Invalid ISO date/time." };
    }
    const istWall = new Date(parsed.getTime() + IST_OFFSET_MS);
    const pad = (n: number) => String(n).padStart(2, "0");
    const istDate = `${istWall.getUTCFullYear()}-${pad(istWall.getUTCMonth() + 1)}-${pad(istWall.getUTCDate())}`;
    const istTime = `${pad(istWall.getUTCHours())}:${pad(istWall.getUTCMinutes())}`;
    return { ok: true, utcIso: parsed.toISOString(), istInput: `${istDate}T${istTime}`, istDate };
  }

  const m = value.match(CALENDAR_YMD_HM_RE);
  if (!m) {
    return { ok: false, error: "Enter a valid date and time in IST." };
  }

  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const hour = Number(m[4]);
  const minute = Number(m[5]);
  const second = Number(m[6] ?? "0");

  if (!isValidCalendarDate(year, month, day)) {
    return { ok: false, error: "That calendar date does not exist." };
  }
  if (hour > 23 || minute > 59 || second > 59) {
    return { ok: false, error: "Time must be between 00:00 and 23:59." };
  }

  const utcMs = Date.UTC(year, month - 1, day, hour, minute, second) - IST_OFFSET_MS;
  const pad = (n: number) => String(n).padStart(2, "0");
  const istDate = `${year}-${pad(month)}-${pad(day)}`;
  return {
    ok: true,
    utcIso: new Date(utcMs).toISOString(),
    istInput: `${istDate}T${pad(hour)}:${pad(minute)}`,
    istDate,
  };
}

export function formatIsoToIstInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return "";
  const wall = new Date(parsed.getTime() + IST_OFFSET_MS);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${wall.getUTCFullYear()}-${pad(wall.getUTCMonth() + 1)}-${pad(wall.getUTCDate())}T${pad(wall.getUTCHours())}:${pad(wall.getUTCMinutes())}`;
}

export const leadDtoSchema = z.object({
  id: z.string(),
  legacyId: z.string().nullable(),
  name: z.string(),
  phone: z.string(),
  email: z.string().optional(),
  company: z.string().optional(),
  requirement: z.string().optional(),
  source: z.enum(LEAD_SOURCES_API),
  status: z.enum(LEAD_STATUSES_API),
  priority: z.enum(LEAD_PRIORITIES_API),
  aiScore: z.number().optional(),
  quotedAmount: z.number().optional(),
  budget: z.number().optional(),
  lastContact: z.string().optional(),
  nextFollowUp: z.string().optional(),
  notes: z.string().optional(),
  pinned: z.boolean(),
  quickStatus: z.enum(QUICK_STATUSES_API).optional(),
  lostReason: z.string().optional(),
  lifecycleStatus: z.enum(LEAD_LIFECYCLE_API),
  archivedAt: z.string().optional(),
  archiveReason: z.string().optional(),
  tagIds: z.array(z.string()),
  fieldValues: z.record(z.string(), z.unknown()),
  version: z.number().int().min(1),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type LeadDto = z.infer<typeof leadDtoSchema>;

export const leadActivityDtoSchema = z.object({
  id: z.string(),
  legacyId: z.string().nullable(),
  leadId: z.string(),
  actorUserId: z.string(),
  type: z.enum(ALL_ACTIVITY_TYPES_API),
  text: z.string(),
  outcome: z.string().optional(),
  opId: z.string().optional(),
  at: z.string(),
  createdAt: z.string(),
});

export type LeadActivityDto = z.infer<typeof leadActivityDtoSchema>;

export const followUpDtoSchema = z.object({
  id: z.string(),
  legacyId: z.string().nullable(),
  leadId: z.string(),
  type: z.enum(FOLLOWUP_TYPES_API),
  dueAt: z.string(),
  dueAtIst: z.string(),
  dueIstDate: z.string(),
  dueIstTime: z.string(),
  note: z.string().optional(),
  completedAt: z.string().optional(),
  cancelledAt: z.string().optional(),
  cancelReason: z.string().optional(),
  replacedBy: z.string().optional(),
  opId: z.string().optional(),
  status: z.enum(["pending", "completed", "cancelled"]),
  version: z.number().int().min(1),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type FollowUpDto = z.infer<typeof followUpDtoSchema>;

export const followUpWithLeadDtoSchema = followUpDtoSchema.extend({
  bucket: z.enum(["overdue", "today", "upcoming", "done"]).optional(),
  lead: z.object({
    id: z.string(),
    name: z.string(),
    phone: z.string(),
    company: z.string().optional(),
    status: z.enum(LEAD_STATUSES_API),
    priority: z.enum(LEAD_PRIORITIES_API),
    lifecycleStatus: z.enum(LEAD_LIFECYCLE_API),
  }),
});

export type FollowUpWithLeadDto = z.infer<typeof followUpWithLeadDtoSchema>;

export const callLogDtoSchema = z.object({
  id: z.string(),
  legacyId: z.string().nullable(),
  leadId: z.string(),
  actorUserId: z.string(),
  outcome: z.enum(CALL_OUTCOMES_API),
  connected: z.boolean(),
  recordingSource: z.literal("user_recorded"),
  notes: z.string().optional(),
  dialSource: z.string(),
  stageBefore: z.enum(LEAD_STATUSES_API),
  stageAfter: z.enum(LEAD_STATUSES_API),
  quickStatusBefore: z.enum(QUICK_STATUSES_API).optional(),
  quickStatusAfter: z.enum(QUICK_STATUSES_API).optional(),
  leadActivityId: z.string(),
  opId: z.string().optional(),
  at: z.string(),
  atIst: z.string(),
  occurredIstDate: z.string(),
  occurredIstTime: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type CallLogDto = z.infer<typeof callLogDtoSchema>;

export const callLogWithLeadDtoSchema = callLogDtoSchema.extend({
  lead: z.object({
    id: z.string(),
    name: z.string(),
    phone: z.string(),
    company: z.string().optional(),
    status: z.enum(LEAD_STATUSES_API),
    priority: z.enum(LEAD_PRIORITIES_API),
    lifecycleStatus: z.enum(LEAD_LIFECYCLE_API),
  }),
});

export type CallLogWithLeadDto = z.infer<typeof callLogWithLeadDtoSchema>;

export const callSummarySchema = z.object({
  total: z.number().int().min(0),
  connected: z.number().int().min(0),
  attempts: z.number().int().min(0),
});

export type CallLogSummary = z.infer<typeof callSummarySchema>;

export const waMessageDtoSchema = z.object({
  id: z.string(),
  legacyId: z.string().nullable(),
  leadId: z.string(),
  actorUserId: z.string(),
  purpose: z.enum(WA_PURPOSES_API),
  templateId: z.string().optional(),
  templateName: z.string().optional(),
  recipientPhone: z.string(),
  messageText: z.string(),
  confirmationStatus: z.literal("owner_confirmed_sent"),
  composerSource: z.string(),
  leadActivityId: z.string(),
  opId: z.string().optional(),
  confirmedAt: z.string(),
  confirmedAtIst: z.string(),
  confirmedIstDate: z.string(),
  confirmedIstTime: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type WaMessageDto = z.infer<typeof waMessageDtoSchema>;

export const waMessageWithLeadDtoSchema = waMessageDtoSchema.extend({
  lead: z.object({
    id: z.string(),
    name: z.string(),
    phone: z.string(),
    company: z.string().optional(),
    status: z.enum(LEAD_STATUSES_API),
    priority: z.enum(LEAD_PRIORITIES_API),
    lifecycleStatus: z.enum(LEAD_LIFECYCLE_API),
  }),
});

export type WaMessageWithLeadDto = z.infer<typeof waMessageWithLeadDtoSchema>;

export const leadsListResponseSchema = z.object({
  ok: z.literal(true),
  items: z.array(leadDtoSchema),
  total: z.number().int().min(0),
  limit: z.number().int().min(1),
  offset: z.number().int().min(0),
  stageCounts: z.record(z.string(), z.number().int().min(0)),
});

export type LeadsListResponse = z.infer<typeof leadsListResponseSchema>;

export const leadGetResponseSchema = z.object({
  ok: z.literal(true),
  lead: leadDtoSchema,
});

export const leadCreateResponseSchema = z.object({
  ok: z.literal(true),
  lead: leadDtoSchema,
  activity: leadActivityDtoSchema,
});

export const leadUpdateResponseSchema = z.object({
  ok: z.literal(true),
  lead: leadDtoSchema,
  activities: z.array(leadActivityDtoSchema),
});

export const leadArchiveRestoreResponseSchema = z.object({
  ok: z.literal(true),
  lead: leadDtoSchema,
  activity: leadActivityDtoSchema,
});

export const leadActivitiesListResponseSchema = z.object({
  ok: z.literal(true),
  leadId: z.string(),
  items: z.array(leadActivityDtoSchema),
  total: z.number().int().min(0),
  limit: z.number().int().min(1),
  offset: z.number().int().min(0),
});

export const leadActivityCreateResponseSchema = z.object({
  ok: z.literal(true),
  activity: leadActivityDtoSchema,
});

export const followUpsListResponseSchema = z.object({
  ok: z.literal(true),
  items: z.array(followUpWithLeadDtoSchema),
  total: z.number().int().min(0),
  limit: z.number().int().min(1),
  offset: z.number().int().min(0),
  summary: z.object({
    overdue: z.number().int().min(0),
    today: z.number().int().min(0),
    upcoming: z.number().int().min(0),
    done: z.number().int().min(0),
    pending: z.number().int().min(0),
  }),
});

export type FollowUpsListResponse = z.infer<typeof followUpsListResponseSchema>;

export const leadFollowUpsListResponseSchema = z.object({
  ok: z.literal(true),
  leadId: z.string(),
  items: z.array(followUpDtoSchema),
  activeFollowUpId: z.string().nullable(),
});

export const followUpGetResponseSchema = z.object({
  ok: z.literal(true),
  followUp: followUpDtoSchema,
});

export const followUpCreateResponseSchema = z.object({
  ok: z.literal(true),
  followUp: followUpDtoSchema,
  replacedFollowUpId: z.string().nullable(),
  leadNextFollowUp: z.string().nullable(),
  activity: leadActivityDtoSchema,
});

export const followUpUpdateResponseSchema = z.object({
  ok: z.literal(true),
  followUp: followUpDtoSchema,
  leadNextFollowUp: z.string().nullable(),
  activity: leadActivityDtoSchema.nullable(),
});

export const followUpCompleteResponseSchema = z.object({
  ok: z.literal(true),
  followUp: followUpDtoSchema,
  leadLastContact: z.string().nullable(),
  leadNextFollowUp: z.string().nullable(),
  activity: leadActivityDtoSchema,
});

export const followUpCancelResponseSchema = z.object({
  ok: z.literal(true),
  followUp: followUpDtoSchema,
  leadNextFollowUp: z.string().nullable(),
  activity: leadActivityDtoSchema,
});

export const callsListResponseSchema = z.object({
  ok: z.literal(true),
  items: z.array(callLogWithLeadDtoSchema),
  total: z.number().int().min(0),
  limit: z.number().int().min(1),
  offset: z.number().int().min(0),
  summary: callSummarySchema,
});

export type CallsListResponse = z.infer<typeof callsListResponseSchema>;

export const leadCallsListResponseSchema = z.object({
  ok: z.literal(true),
  leadId: z.string(),
  items: z.array(callLogDtoSchema),
  total: z.number().int().min(0),
  limit: z.number().int().min(1),
  offset: z.number().int().min(0),
  summary: callSummarySchema,
});

export type LeadCallsListResponse = z.infer<typeof leadCallsListResponseSchema>;

export const callGetResponseSchema = z.object({
  ok: z.literal(true),
  call: callLogDtoSchema,
});

export const callCreateResponseSchema = z.object({
  ok: z.literal(true),
  call: callLogDtoSchema,
  lead: leadDtoSchema,
  activities: z.array(leadActivityDtoSchema),
});

export type CallCreateResponse = z.infer<typeof callCreateResponseSchema>;

export const waMessagesListResponseSchema = z.object({
  ok: z.literal(true),
  items: z.array(waMessageWithLeadDtoSchema),
  total: z.number().int().min(0),
  limit: z.number().int().min(1),
  offset: z.number().int().min(0),
});

export type WaMessagesListResponse = z.infer<typeof waMessagesListResponseSchema>;

export const leadWaMessagesListResponseSchema = z.object({
  ok: z.literal(true),
  leadId: z.string(),
  items: z.array(waMessageDtoSchema),
  total: z.number().int().min(0),
  limit: z.number().int().min(1),
  offset: z.number().int().min(0),
});

export type LeadWaMessagesListResponse = z.infer<typeof leadWaMessagesListResponseSchema>;

export const waMessageGetResponseSchema = z.object({
  ok: z.literal(true),
  message: waMessageDtoSchema,
});

export const waMessageCreateResponseSchema = z.object({
  ok: z.literal(true),
  message: waMessageDtoSchema,
  lead: leadDtoSchema,
  activity: leadActivityDtoSchema,
});

export type WaMessageCreateResponse = z.infer<typeof waMessageCreateResponseSchema>;

export const duplicateMatchSchema = z.object({
  id: z.string(),
  name: z.string(),
  phone: z.string(),
  email: z.string().optional(),
  status: z.string(),
  lifecycleStatus: z.string(),
  matchReasons: z.array(z.enum(["phone", "email"])),
});

export type DuplicateMatchDto = z.infer<typeof duplicateMatchSchema>;

export const duplicateLeadConflictSchema = z.object({
  matchReasons: z.array(z.enum(["phone", "email"])),
  matches: z.array(duplicateMatchSchema),
});

export type DuplicateLeadConflict = z.infer<typeof duplicateLeadConflictSchema>;

export const staleConflictSchema = z.object({
  resource: z.enum(["lead", "followup", "deal", "payment"]),
  id: z.string(),
  expectedVersion: z.number().int().optional(),
  currentVersion: z.number().int().optional(),
});

export type StaleConflict = z.infer<typeof staleConflictSchema>;

// ---------------------------------------------------------------------------
// Checkpoint B3C — Deals, Payments, Proofs & Financial Schemas
// ---------------------------------------------------------------------------

export const CLIENT_TYPES_API = ["crm", "other"] as const;
export type ClientTypeApi = (typeof CLIENT_TYPES_API)[number];

export const DEAL_STATUSES_API = ["active", "won", "lost", "cancelled"] as const;
export type DealStatusApi = (typeof DEAL_STATUSES_API)[number];

export const PAYMENT_STATUSES_API = ["paid", "partial", "unpaid", "overdue", "cancelled"] as const;
export type PaymentStatusApi = (typeof PAYMENT_STATUSES_API)[number];

export const PAYMENT_METHODS_API = ["UPI", "Bank Transfer", "Cash", "Card", "Cheque"] as const;
export type PaymentMethodApi = (typeof PAYMENT_METHODS_API)[number];

export const PAYMENT_TYPES_API = ["advance", "milestone", "final", "other"] as const;
export type PaymentTypeApi = (typeof PAYMENT_TYPES_API)[number];

export const PROOF_KINDS_API = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
] as const;
export type ProofKindApi = (typeof PROOF_KINDS_API)[number];

export const PROOF_LIFECYCLE_API = ["active", "replaced", "removed"] as const;
export type ProofLifecycleApi = (typeof PROOF_LIFECYCLE_API)[number];

export const paymentProofDtoSchema = z.object({
  id: z.string(),
  legacyAttachmentId: z.string().nullable().optional(),
  paymentId: z.string(),
  dealId: z.string(),
  originalFileName: z.string(),
  fileExtension: z.string(),
  mimeType: z.enum(PROOF_KINDS_API),
  fileSize: z.number().int().min(1),
  sha256: z.string(),
  storageDriver: z.string(),
  lifecycleStatus: z.enum(PROOF_LIFECYCLE_API),
  version: z.number().int().min(1),
  uploadedByUserId: z.string(),
  uploadedAt: z.string(),
  removedAt: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  downloadUrl: z.string(),
});
export type PaymentProofDto = z.infer<typeof paymentProofDtoSchema>;

export const dealMilestoneDtoSchema = z.object({
  id: z.string(),
  legacyId: z.string().nullable().optional(),
  label: z.string(),
  amount: z.number(),
  amountDecimal: z.string(),
  amountPaise: z.number().int(),
  dueDate: z.string(),
  sortOrder: z.number().int(),
});
export type DealMilestoneDto = z.infer<typeof dealMilestoneDtoSchema>;

export const dealFinancialSummaryDtoSchema = z.object({
  dealId: z.string(),
  dealStatus: z.enum(DEAL_STATUSES_API),
  paymentStatus: z.enum(PAYMENT_STATUSES_API),
  isOverdue: z.boolean(),
  dueDate: z.string().nullable(),
  quotedAmount: z.number(),
  quotedAmountDecimal: z.string(),
  quotedAmountPaise: z.number().int(),
  finalAmount: z.number(),
  finalAmountDecimal: z.string(),
  finalAmountPaise: z.number().int(),
  collected: z.number(),
  collectedDecimal: z.string(),
  collectedPaise: z.number().int(),
  realizedRevenue: z.number(),
  realizedRevenueDecimal: z.string(),
  realizedRevenuePaise: z.number().int(),
  outstanding: z.number(),
  outstandingDecimal: z.string(),
  outstandingPaise: z.number().int(),
  overdue: z.number(),
  overdueDecimal: z.string(),
  overduePaise: z.number().int(),
  voidedAmount: z.number(),
  voidedDecimal: z.string(),
  voidedPaise: z.number().int(),
  activePaymentCount: z.number().int(),
  voidedPaymentCount: z.number().int(),
  collectionRate: z.number().nullable(),
  lastPaymentDate: z.string().nullable(),
  nextMilestone: z
    .object({
      id: z.string(),
      label: z.string(),
      amount: z.number(),
      amountDecimal: z.string(),
      amountPaise: z.number().int(),
      dueDate: z.string(),
    })
    .nullable(),
});
export type DealFinancialSummaryDto = z.infer<typeof dealFinancialSummaryDtoSchema>;

export const dealDtoSchema = z.object({
  id: z.string(),
  legacyId: z.string().nullable().optional(),
  leadId: z.string().optional(),
  clientType: z.enum(CLIENT_TYPES_API),
  clientName: z.string(),
  company: z.string().optional(),
  phone: z.string().optional(),
  name: z.string(),
  quotedAmount: z.number(),
  quotedAmountDecimal: z.string(),
  quotedAmountPaise: z.number().int(),
  finalAmount: z.number(),
  finalAmountDecimal: z.string(),
  finalAmountPaise: z.number().int(),
  status: z.enum(DEAL_STATUSES_API),
  dueDate: z.string().optional(),
  milestones: z.array(dealMilestoneDtoSchema).default([]),
  notes: z.string().optional(),
  wonAt: z.string().optional(),
  wonIstDate: z.string().optional(),
  wonDateVerifiedAt: z.string().optional(),
  wonDateVerifiedByUserId: z.string().optional(),
  cancelledAt: z.string().optional(),
  cancelledIstDate: z.string().optional(),
  cancelledByUserId: z.string().optional(),
  cancelReason: z.string().optional(),
  opId: z.string().optional(),
  createdByUserId: z.string(),
  updatedByUserId: z.string(),
  version: z.number().int().min(1),
  createdAt: z.string(),
  updatedAt: z.string(),
  financialSummary: dealFinancialSummaryDtoSchema,
});
export type DealDto = z.infer<typeof dealDtoSchema>;

export const paymentDtoSchema = z.object({
  id: z.string(),
  legacyId: z.string().nullable().optional(),
  dealId: z.string(),
  amount: z.number(),
  amountDecimal: z.string(),
  amountPaise: z.number().int(),
  date: z.string(),
  method: z.enum(PAYMENT_METHODS_API),
  type: z.enum(PAYMENT_TYPES_API),
  reference: z.string().optional(),
  notes: z.string().optional(),
  status: z.enum(["posted", "voided"]),
  voided: z.boolean(),
  voidedAt: z.string().optional(),
  voidedIstDate: z.string().optional(),
  voidedByUserId: z.string().optional(),
  voidReason: z.string().optional(),
  opId: z.string().optional(),
  recordedByUserId: z.string(),
  updatedByUserId: z.string(),
  version: z.number().int().min(1),
  hasProof: z.boolean().optional(),
  proof: paymentProofDtoSchema.nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type PaymentDto = z.infer<typeof paymentDtoSchema>;

export const financeEventDtoSchema = z.object({
  id: z.string(),
  dealId: z.string(),
  paymentId: z.string().optional(),
  leadId: z.string().optional(),
  actorUserId: z.string(),
  eventType: z.string(),
  summary: z.string(),
  reason: z.string().optional(),
  amount: z.number().optional(),
  amountDecimal: z.string().optional(),
  amountPaise: z.number().int().optional(),
  before: z.record(z.string(), z.unknown()).optional(),
  after: z.record(z.string(), z.unknown()).optional(),
  leadActivityId: z.string().optional(),
  opId: z.string().optional(),
  at: z.string(),
  occurredIstDate: z.string(),
  createdAt: z.string(),
});
export type FinanceEventDto = z.infer<typeof financeEventDtoSchema>;

export const ownerFinanceSummaryDtoSchema = z.object({
  todayIstDate: z.string(),
  period: z.enum(["all_time", "this_month", "last_month", "custom"]).or(z.string()),
  fromIstDate: z.string().nullable(),
  toIstDate: z.string().nullable(),
  totalBooked: z.number(),
  totalBookedDecimal: z.string(),
  totalBookedPaise: z.number().int(),
  activeBooked: z.number(),
  activeBookedDecimal: z.string(),
  activeBookedPaise: z.number().int(),
  cancelledBooked: z.number(),
  cancelledBookedDecimal: z.string(),
  cancelledBookedPaise: z.number().int(),
  cashCollected: z.number(),
  cashCollectedDecimal: z.string(),
  cashCollectedPaise: z.number().int(),
  activeCashCollected: z.number(),
  activeCashCollectedDecimal: z.string(),
  activeCashCollectedPaise: z.number().int(),
  cancelledCashCollected: z.number(),
  cancelledCashCollectedDecimal: z.string(),
  cancelledCashCollectedPaise: z.number().int(),
  outstanding: z.number(),
  outstandingDecimal: z.string(),
  outstandingPaise: z.number().int(),
  overdue: z.number(),
  overdueDecimal: z.string(),
  overduePaise: z.number().int(),
  voidedAmount: z.number(),
  voidedDecimal: z.string(),
  voidedPaise: z.number().int(),
  activeDealCount: z.number().int(),
  cancelledDealCount: z.number().int(),
  activePaymentCount: z.number().int(),
  voidedPaymentCount: z.number().int(),
  collectionRate: z.number().nullable(),
}).passthrough();
export type OwnerFinanceSummaryDto = z.infer<typeof ownerFinanceSummaryDtoSchema>;

// API Response Envelopes
export const dealsListResponseSchema = z.object({
  ok: z.literal(true),
  items: z.array(dealDtoSchema),
  total: z.number().int().min(0),
  limit: z.number().int().min(1),
  offset: z.number().int().min(0),
});
export type DealsListResponse = z.infer<typeof dealsListResponseSchema>;

export const dealGetResponseSchema = z.object({
  ok: z.literal(true),
  deal: dealDtoSchema,
});

export const dealCreateResponseSchema = z.object({
  ok: z.literal(true),
  deal: dealDtoSchema,
  activity: leadActivityDtoSchema.optional(),
});
export type DealCreateResponse = z.infer<typeof dealCreateResponseSchema>;

export const dealUpdateResponseSchema = z.object({
  ok: z.literal(true),
  deal: dealDtoSchema,
});

export const dealStatusChangeResponseSchema = z.object({
  ok: z.literal(true),
  deal: dealDtoSchema,
  activity: leadActivityDtoSchema.optional(),
});

export const dealCancelResponseSchema = z.object({
  ok: z.literal(true),
  deal: dealDtoSchema,
  activity: leadActivityDtoSchema.optional(),
});

export const dealVerifyWonResponseSchema = z.object({
  ok: z.literal(true),
  deal: dealDtoSchema,
  activity: leadActivityDtoSchema.optional(),
});

export const dealSummaryResponseSchema = z.object({
  ok: z.literal(true),
  dealId: z.string(),
  summary: dealFinancialSummaryDtoSchema,
});

export const dealAuditListResponseSchema = z.object({
  ok: z.literal(true),
  dealId: z.string().optional(),
  events: z.array(financeEventDtoSchema).optional().default([]),
  items: z.array(financeEventDtoSchema).optional().default([]),
  total: z.number().int().min(0),
  limit: z.number().int().min(1),
  offset: z.number().int().min(0),
});
export type DealAuditListResponse = z.infer<typeof dealAuditListResponseSchema>;

export const ownerFinanceSummaryResponseSchema = z.object({
  ok: z.literal(true),
  summary: ownerFinanceSummaryDtoSchema,
});

export const paymentsListResponseSchema = z.object({
  ok: z.literal(true),
  items: z.array(paymentDtoSchema),
  total: z.number().int().min(0),
  limit: z.number().int().min(1),
  offset: z.number().int().min(0),
});
export type PaymentsListResponse = z.infer<typeof paymentsListResponseSchema>;

export const paymentGetResponseSchema = z.object({
  ok: z.literal(true),
  payment: paymentDtoSchema,
});

export const paymentCreateResponseSchema = z.object({
  ok: z.literal(true),
  payment: paymentDtoSchema,
  dealSummary: dealFinancialSummaryDtoSchema,
  activity: leadActivityDtoSchema.optional(),
});
export type PaymentCreateResponse = z.infer<typeof paymentCreateResponseSchema>;

export const paymentVoidResponseSchema = z.object({
  ok: z.literal(true),
  payment: paymentDtoSchema,
  dealSummary: dealFinancialSummaryDtoSchema,
  activity: leadActivityDtoSchema.optional(),
});
export type PaymentVoidResponse = z.infer<typeof paymentVoidResponseSchema>;

export const proofGetResponseSchema = z.object({
  ok: z.literal(true),
  proof: paymentProofDtoSchema,
});

export const proofHistoryResponseSchema = z.object({
  ok: z.literal(true),
  paymentId: z.string(),
  items: z.array(paymentProofDtoSchema),
  total: z.number().int().min(0),
  limit: z.number().int().min(1),
  offset: z.number().int().min(0),
});
export type ProofHistoryResponse = z.infer<typeof proofHistoryResponseSchema>;

export const proofAttachResponseSchema = z.object({
  ok: z.literal(true),
  proof: paymentProofDtoSchema,
});
export type ProofAttachResponse = z.infer<typeof proofAttachResponseSchema>;

export const proofReplaceResponseSchema = z.object({
  ok: z.literal(true),
  proof: paymentProofDtoSchema,
  previousProof: paymentProofDtoSchema.optional(),
  replacedProof: paymentProofDtoSchema.optional(),
  auditEvent: financeEventDtoSchema.optional(),
});
export type ProofReplaceResponse = z.infer<typeof proofReplaceResponseSchema>;

export const proofRemoveResponseSchema = z.object({
  ok: z.literal(true),
  proof: paymentProofDtoSchema.optional(),
  removedProof: paymentProofDtoSchema.optional(),
  auditEvent: financeEventDtoSchema.optional(),
});
export type ProofRemoveResponse = z.infer<typeof proofRemoveResponseSchema>;

// ---------------------------------------------------------------------------
// Checkpoint B4A — Quotation Templates & Quotation DTOs & Responses
// ---------------------------------------------------------------------------

export const QUOTATION_STATUSES_API = ["draft", "sent", "accepted", "rejected"] as const;
export type QuotationStatusApi = (typeof QUOTATION_STATUSES_API)[number];

export const QUOTATION_DISCOUNT_TYPES_API = ["none", "flat", "percent"] as const;
export type QuotationDiscountTypeApi = (typeof QUOTATION_DISCOUNT_TYPES_API)[number];

export const quotationTemplateDtoSchema = z.object({
  id: z.string(),
  ownerUserId: z.string(),
  name: z.string(),
  priceType: z.enum(["fixed", "custom"]),
  priceAmount: z.number().nullable(),
  priceAmountDecimal: z.string().nullable(),
  priceAmountPaise: z.number().int().nullable(),
  priceLabel: z.string().nullable(),
  currency: z.literal("INR"),
  messageBody: z.string(),
  isActive: z.boolean(),
  sortOrder: z.number().int(),
  version: z.number().int().min(1),
  archivedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type QuotationTemplateDto = z.infer<typeof quotationTemplateDtoSchema>;

export const quotationItemDtoSchema = z.object({
  id: z.string(),
  quotationId: z.string(),
  description: z.string(),
  quantity: z.number(),
  quantityDecimal: z.string(),
  unitPrice: z.number(),
  unitPriceDecimal: z.string(),
  totalAmount: z.number(),
  totalAmountDecimal: z.string(),
  sortOrder: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type QuotationItemDto = z.infer<typeof quotationItemDtoSchema>;

export const quotationMilestoneDtoSchema = z.object({
  id: z.string(),
  quotationId: z.string(),
  label: z.string(),
  percentage: z.number(),
  percentageDecimal: z.string(),
  amount: z.number(),
  amountDecimal: z.string(),
  dueDate: z.string().nullable(),
  sortOrder: z.number().int(),
  createdAt: z.string(),
});
export type QuotationMilestoneDto = z.infer<typeof quotationMilestoneDtoSchema>;

export const quotationRevisionDtoSchema = z.object({
  id: z.string(),
  quotationId: z.string(),
  revisionNumber: z.number().int(),
  snapshot: z.record(z.string(), z.unknown()),
  changeSummary: z.string().nullable(),
  createdByUserId: z.string(),
  createdAt: z.string(),
});
export type QuotationRevisionDto = z.infer<typeof quotationRevisionDtoSchema>;

export const quotationAuditEventDtoSchema = z.object({
  id: z.string(),
  quotationId: z.string(),
  ownerUserId: z.string(),
  actorUserId: z.string(),
  eventType: z.string(),
  summary: z.string(),
  details: z.record(z.string(), z.unknown()).nullable(),
  occurredIstDate: z.string(),
  createdAt: z.string(),
});
export type QuotationAuditEventDto = z.infer<typeof quotationAuditEventDtoSchema>;

export const quotationDtoSchema = z.object({
  id: z.string(),
  ownerUserId: z.string(),
  leadId: z.string().nullable(),
  dealId: z.string().nullable(),
  templateId: z.string().nullable(),
  legacyId: z.string().nullable(),
  quotationNumber: z.string(),
  title: z.string(),
  clientName: z.string(),
  clientCompany: z.string().nullable(),
  currency: z.literal("INR"),
  subtotal: z.number(),
  subtotalDecimal: z.string(),
  discountType: z.enum(QUOTATION_DISCOUNT_TYPES_API),
  discountValue: z.number(),
  discountValueDecimal: z.string(),
  discountAmount: z.number(),
  discountAmountDecimal: z.string(),
  taxableAmount: z.number(),
  taxableAmountDecimal: z.string(),
  gstEnabled: z.boolean(),
  gstRate: z.number(),
  gstRateDecimal: z.string(),
  gstAmount: z.number(),
  gstAmountDecimal: z.string(),
  totalAmount: z.number(),
  totalAmountDecimal: z.string(),
  status: z.enum(QUOTATION_STATUSES_API),
  issueIstDate: z.string(),
  validUntilIstDate: z.string().nullable(),
  paymentTerms: z.string().nullable(),
  notes: z.string().nullable(),
  messageBody: z.string().nullable(),
  userConfirmedSent: z.boolean(),
  sentAt: z.string().nullable(),
  acceptedAt: z.string().nullable(),
  rejectedAt: z.string().nullable(),
  version: z.number().int().min(1),
  archivedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  items: z.array(quotationItemDtoSchema),
  milestones: z.array(quotationMilestoneDtoSchema),
});
export type QuotationDto = z.infer<typeof quotationDtoSchema>;

export const quotationTemplatesListResponseSchema = z.object({
  ok: z.literal(true),
  items: z.array(quotationTemplateDtoSchema),
  total: z.number().int().min(0),
});
export type QuotationTemplatesListResponse = z.infer<typeof quotationTemplatesListResponseSchema>;

export const quotationTemplateGetResponseSchema = z.object({
  ok: z.literal(true),
  template: quotationTemplateDtoSchema,
});
export type QuotationTemplateGetResponse = z.infer<typeof quotationTemplateGetResponseSchema>;

export const quotationTemplateCreateResponseSchema = z.object({
  ok: z.literal(true),
  template: quotationTemplateDtoSchema,
});
export type QuotationTemplateCreateResponse = z.infer<typeof quotationTemplateCreateResponseSchema>;

export const quotationTemplateUpdateResponseSchema = z.object({
  ok: z.literal(true),
  template: quotationTemplateDtoSchema,
});
export type QuotationTemplateUpdateResponse = z.infer<typeof quotationTemplateUpdateResponseSchema>;

export const quotationTemplateDeleteResponseSchema = z.object({
  ok: z.literal(true),
  template: quotationTemplateDtoSchema,
});
export type QuotationTemplateDeleteResponse = z.infer<typeof quotationTemplateDeleteResponseSchema>;

export const quotationTemplateDuplicateResponseSchema = z.object({
  ok: z.literal(true),
  template: quotationTemplateDtoSchema,
});
export type QuotationTemplateDuplicateResponse = z.infer<typeof quotationTemplateDuplicateResponseSchema>;

export const quotationTemplateReorderResponseSchema = z.object({
  ok: z.literal(true),
  reorderedCount: z.number().int().min(0),
});
export type QuotationTemplateReorderResponse = z.infer<typeof quotationTemplateReorderResponseSchema>;

export const quotationsListResponseSchema = z.object({
  ok: z.literal(true),
  items: z.array(quotationDtoSchema),
  total: z.number().int().min(0),
  limit: z.number().int().min(1),
  offset: z.number().int().min(0),
});
export type QuotationsListResponse = z.infer<typeof quotationsListResponseSchema>;

export const quotationGetResponseSchema = z.object({
  ok: z.literal(true),
  quotation: quotationDtoSchema,
});
export type QuotationGetResponse = z.infer<typeof quotationGetResponseSchema>;

export const quotationCreateResponseSchema = z.object({
  ok: z.literal(true),
  quotation: quotationDtoSchema,
});
export type QuotationCreateResponse = z.infer<typeof quotationCreateResponseSchema>;

export const quotationUpdateResponseSchema = z.object({
  ok: z.literal(true),
  quotation: quotationDtoSchema,
});
export type QuotationUpdateResponse = z.infer<typeof quotationUpdateResponseSchema>;

export const quotationStatusResponseSchema = z.object({
  ok: z.literal(true),
  quotation: quotationDtoSchema,
});
export type QuotationStatusResponse = z.infer<typeof quotationStatusResponseSchema>;

export const quotationArchiveResponseSchema = z.object({
  ok: z.literal(true),
  quotation: quotationDtoSchema,
});
export type QuotationArchiveResponse = z.infer<typeof quotationArchiveResponseSchema>;

export const quotationRestoreResponseSchema = z.object({
  ok: z.literal(true),
  quotation: quotationDtoSchema,
});
export type QuotationRestoreResponse = z.infer<typeof quotationRestoreResponseSchema>;

export const quotationRevisionsResponseSchema = z.object({
  ok: z.literal(true),
  quotationId: z.string(),
  items: z.array(quotationRevisionDtoSchema),
  total: z.number().int().min(0),
  limit: z.number().int().min(1),
  offset: z.number().int().min(0),
});
export type QuotationRevisionsResponse = z.infer<typeof quotationRevisionsResponseSchema>;

export const quotationAuditResponseSchema = z.object({
  ok: z.literal(true),
  quotationId: z.string(),
  items: z.array(quotationAuditEventDtoSchema),
  total: z.number().int().min(0),
  limit: z.number().int().min(1),
  offset: z.number().int().min(0),
});
export type QuotationAuditResponse = z.infer<typeof quotationAuditResponseSchema>;

export const leadQuotationsListResponseSchema = z.object({
  ok: z.literal(true),
  leadId: z.string(),
  items: z.array(quotationDtoSchema),
  total: z.number().int().min(0),
  limit: z.number().int().min(1).default(50),
  offset: z.number().int().min(0).default(0),
});
export type LeadQuotationsListResponse = z.infer<typeof leadQuotationsListResponseSchema>;

export const followupConflictSchema = z.object({
  activeFollowUp: followUpDtoSchema.optional(),
  expectedActiveFollowUpId: z.string().optional(),
  currentActiveFollowUp: followUpDtoSchema.optional(),
  existingFollowUp: followUpDtoSchema.optional(),
});

export type FollowUpConflictInfo = z.infer<typeof followupConflictSchema>;

export const apiErrorEnvelopeSchema = z.object({
  ok: z.literal(false),
  authenticated: z.boolean().optional(),
  error: z.object({
    code: z.string(),
    message: z.string(),
    reason: z.string().optional(),
    retryAfterSeconds: z.number().optional(),
    details: z.record(z.string(), z.unknown()).optional(),
    conflict: z.record(z.string(), z.unknown()).optional(),
  }),
});


// ============================================================================
// B5A / B5B PROJECTS, MILESTONES, TASKS, DELIVERABLES, SUPPORT SCHEMAS
// ============================================================================

export const PROJECT_STATUSES_API = [
  "accepted",
  "booked",
  "awaiting_client",
  "ready",
  "in_progress",
  "on_hold",
  "completed",
  "cancelled",
] as const;
export type ProjectStatusApi = (typeof PROJECT_STATUSES_API)[number];

export const PROJECT_STAGES_API = [
  "discovery",
  "awaiting_content",
  "design",
  "development",
  "testing",
  "client_review",
  "ready_to_launch",
  "delivered",
  "support",
] as const;
export type ProjectStageApi = (typeof PROJECT_STAGES_API)[number];

export const PROJECT_PRIORITIES_API = ["high", "normal", "low"] as const;
export type ProjectPriorityApi = (typeof PROJECT_PRIORITIES_API)[number];

export const SUPPORT_STATUSES_API = ["not_set", "not_included", "scheduled", "active", "ended"] as const;
export type SupportStatusApi = (typeof SUPPORT_STATUSES_API)[number];

export const SUPPORT_KINDS_API = ["bug", "technical", "content", "integration", "general"] as const;
export type SupportKindApi = (typeof SUPPORT_KINDS_API)[number];

export const REQUEST_STATUSES_API = ["open", "in_progress", "resolved", "closed"] as const;
export type RequestStatusApi = (typeof REQUEST_STATUSES_API)[number];

export const SUPPORT_COVERAGES_API = ["undecided", "included", "billable"] as const;
export type SupportCoverageApi = (typeof SUPPORT_COVERAGES_API)[number];

export const DELIVERABLE_STATUSES_API = ["draft", "review", "approved", "rejected", "delivered"] as const;
export type DeliverableStatusApi = (typeof DELIVERABLE_STATUSES_API)[number];

export const DELIVERABLE_REVISION_STATUSES_API = ["submitted", "in_review", "changes_requested", "approved"] as const;
export type DeliverableRevisionStatusApi = (typeof DELIVERABLE_REVISION_STATUSES_API)[number];

export const checkItemSchema = z.object({
  id: z.string(),
  label: z.string(),
  done: z.boolean(),
  doneAt: z.string().optional(),
  note: z.string().optional(),
});
export type CheckItemDto = z.infer<typeof checkItemSchema>;

export const projectDependencySchema = z.object({
  id: z.string(),
  label: z.string(),
  done: z.boolean(),
  doneAt: z.string().optional(),
});
export type ProjectDependencyDto = z.infer<typeof projectDependencySchema>;

export const projectLinkSchema = z.object({
  id: z.string(),
  label: z.string(),
  url: z.string(),
  addedAt: z.string(),
});
export type ProjectLinkDto = z.infer<typeof projectLinkSchema>;

export const projectDeliverySchema = z.object({
  date: z.string(),
  url: z.string().optional(),
  notes: z.string().optional(),
  deliveredBy: z.string(),
  approval: z.enum(["pending", "approved", "not_required"]),
  override: z.string().optional(),
  incomplete: z.array(z.string()),
});
export type ProjectDeliveryDto = z.infer<typeof projectDeliverySchema>;

export const projectSupportSchema = z.object({
  included: z.boolean().nullable(),
  months: z.number().optional(),
  start: z.string().optional(),
  end: z.string().optional(),
  description: z.string().optional(),
});
export type ProjectSupportDto = z.infer<typeof projectSupportSchema>;

export const projectDtoSchema = z.object({
  id: z.string(),
  ownerUserId: z.string(),
  name: z.string(),
  clientName: z.string(),
  company: z.string().nullable(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  leadId: z.string().nullable(),
  dealId: z.string().nullable(),
  templateId: z.string().nullable(),
  legacyId: z.string().nullable(),
  type: z.string(),
  scope: z.string().nullable(),
  bookingDate: z.string().nullable(),
  plannedStart: z.string().nullable(),
  actualStart: z.string().nullable(),
  targetDelivery: z.string().nullable(),
  status: z.enum(PROJECT_STATUSES_API),
  stage: z.enum(PROJECT_STAGES_API),
  priority: z.enum(PROJECT_PRIORITIES_API),
  projectOwnerId: z.string().nullable(),
  memberIds: z.array(z.string()),
  dependencies: z.array(projectDependencySchema),
  requirements: z.array(checkItemSchema),
  qa: z.array(checkItemSchema),
  handover: z.array(checkItemSchema),
  links: z.array(projectLinkSchema),
  delivery: projectDeliverySchema.nullable(),
  support: projectSupportSchema,
  carried: z.record(z.string(), z.unknown()),
  notes: z.string().nullable(),
  reviewFlag: z.string().nullable(),
  attention: z
    .object({
      reason: z.string(),
      at: z.string(),
      ruleId: z.string().optional(),
    })
    .nullable(),
  archived: z.boolean(),
  archivedAt: z.string().nullable(),
  version: z.number().int(),
  progress: z.object({
    total: z.number().int(),
    done: z.number().int(),
    pct: z.number().int().nullable(),
    text: z.string(),
  }),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ProjectDto = z.infer<typeof projectDtoSchema>;

export const projectMilestoneDtoSchema = z.object({
  id: z.string(),
  ownerUserId: z.string(),
  projectId: z.string(),
  title: z.string(),
  dueDate: z.string().nullable(),
  sortOrder: z.number().int(),
  status: z.enum(["open", "completed"]),
  completedAt: z.string().nullable(),
  version: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ProjectMilestoneDto = z.infer<typeof projectMilestoneDtoSchema>;

export const projectTaskDtoSchema = z.object({
  id: z.string(),
  ownerUserId: z.string(),
  projectId: z.string(),
  milestoneId: z.string().nullable(),
  title: z.string(),
  notes: z.string().nullable(),
  assigneeId: z.string().nullable(),
  dueDate: z.string().nullable(),
  priority: z.enum(PROJECT_PRIORITIES_API),
  status: z.enum(["open", "done"]),
  completedAt: z.string().nullable(),
  completedBy: z.string().nullable(),
  sortOrder: z.number().int(),
  version: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ProjectTaskDto = z.infer<typeof projectTaskDtoSchema>;

export const projectDeliverableDtoSchema = z.object({
  id: z.string(),
  ownerUserId: z.string(),
  projectId: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  category: z.string(),
  status: z.enum(DELIVERABLE_STATUSES_API),
  dueDate: z.string().nullable(),
  deliveredAt: z.string().nullable(),
  revisionCount: z.number().int(),
  latestRevisionNotes: z.string().nullable(),
  clientFeedback: z.string().nullable(),
  version: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ProjectDeliverableDto = z.infer<typeof projectDeliverableDtoSchema>;

export const projectDeliverableRevisionDtoSchema = z.object({
  id: z.string(),
  deliverableId: z.string(),
  revisionNumber: z.number().int(),
  title: z.string().nullable(),
  summary: z.string(),
  fileUrl: z.string().nullable(),
  notes: z.string().nullable(),
  clientFeedback: z.string().nullable(),
  status: z.enum(DELIVERABLE_REVISION_STATUSES_API),
  createdByUserId: z.string(),
  createdAt: z.string(),
});
export type ProjectDeliverableRevisionDto = z.infer<typeof projectDeliverableRevisionDtoSchema>;

export const clientSupportTicketDtoSchema = z.object({
  id: z.string(),
  ownerUserId: z.string(),
  projectId: z.string(),
  kind: z.enum(SUPPORT_KINDS_API),
  title: z.string(),
  description: z.string().nullable(),
  priority: z.enum(PROJECT_PRIORITIES_API),
  assigneeId: z.string().nullable(),
  dueDate: z.string().nullable(),
  status: z.enum(REQUEST_STATUSES_API),
  resolution: z.string().nullable(),
  resolvedAt: z.string().nullable(),
  resolvedByUserId: z.string().nullable(),
  coverage: z.enum(SUPPORT_COVERAGES_API),
  version: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ClientSupportTicketDto = z.infer<typeof clientSupportTicketDtoSchema>;

export const projectTemplateDtoSchema = z.object({
  id: z.string(),
  ownerUserId: z.string(),
  name: z.string(),
  type: z.string(),
  builtIn: z.boolean(),
  milestones: z.array(z.string()),
  tasks: z.array(
    z.object({
      title: z.string(),
      milestone: z.string().optional(),
    }),
  ),
  requirements: z.array(z.string()),
  qa: z.array(z.string()),
  handover: z.array(z.string()),
  archived: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ProjectTemplateDto = z.infer<typeof projectTemplateDtoSchema>;

export const projectAuditEventDtoSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  ownerUserId: z.string(),
  actorUserId: z.string(),
  eventType: z.string(),
  summary: z.string(),
  details: z.record(z.string(), z.unknown()).nullable(),
  occurredIstDate: z.string(),
  createdAt: z.string(),
});
export type ProjectAuditEventDto = z.infer<typeof projectAuditEventDtoSchema>;

export const projectsListResponseSchema = z.object({
  ok: z.literal(true),
  items: z.array(projectDtoSchema),
  total: z.number().int(),
  limit: z.number().int(),
  offset: z.number().int(),
});
export type ProjectsListResponse = z.infer<typeof projectsListResponseSchema>;

export const projectDetailsResponseSchema = z.object({
  ok: z.literal(true),
  project: projectDtoSchema,
  milestones: z.array(projectMilestoneDtoSchema),
  tasks: z.array(projectTaskDtoSchema),
  deliverables: z.array(projectDeliverableDtoSchema),
  supportTickets: z.array(clientSupportTicketDtoSchema),
  recentAuditEvents: z.array(projectAuditEventDtoSchema),
});
export type ProjectDetailsResponse = z.infer<typeof projectDetailsResponseSchema>;

export const projectCreateResponseSchema = z.object({
  ok: z.literal(true),
  project: projectDtoSchema,
});
export type ProjectCreateResponse = z.infer<typeof projectCreateResponseSchema>;

export const projectUpdateResponseSchema = z.object({
  ok: z.literal(true),
  project: projectDtoSchema,
});
export type ProjectUpdateResponse = z.infer<typeof projectUpdateResponseSchema>;

export const projectOverviewMetricsResponseSchema = z.object({
  ok: z.literal(true),
  metrics: z.object({
    active: z.number(),
    awaiting: z.number(),
    inProgress: z.number(),
    overdue: z.number(),
    delivered: z.number(),
    openTasks: z.number(),
    upcomingMilestones: z.number(),
    openRequests: z.number(),
  }),
  attention: z.array(
    z.object({
      id: z.string(),
      projectId: z.string(),
      kind: z.string(),
      text: z.string(),
    }),
  ),
});
export type ProjectOverviewMetricsResponse = z.infer<typeof projectOverviewMetricsResponseSchema>;

export const projectMilestoneCreateResponseSchema = z.object({
  ok: z.literal(true),
  milestone: projectMilestoneDtoSchema,
});
export type ProjectMilestoneCreateResponse = z.infer<typeof projectMilestoneCreateResponseSchema>;

export const projectMilestoneUpdateResponseSchema = z.object({
  ok: z.literal(true),
  milestone: projectMilestoneDtoSchema,
});
export type ProjectMilestoneUpdateResponse = z.infer<typeof projectMilestoneUpdateResponseSchema>;

export const projectTaskCreateResponseSchema = z.object({
  ok: z.literal(true),
  task: projectTaskDtoSchema,
});
export type ProjectTaskCreateResponse = z.infer<typeof projectTaskCreateResponseSchema>;

export const projectTaskUpdateResponseSchema = z.object({
  ok: z.literal(true),
  task: projectTaskDtoSchema,
});
export type ProjectTaskUpdateResponse = z.infer<typeof projectTaskUpdateResponseSchema>;

export const projectDeliverableCreateResponseSchema = z.object({
  ok: z.literal(true),
  deliverable: projectDeliverableDtoSchema,
});
export type ProjectDeliverableCreateResponse = z.infer<typeof projectDeliverableCreateResponseSchema>;

export const projectDeliverableRevisionCreateResponseSchema = z.object({
  ok: z.literal(true),
  deliverable: projectDeliverableDtoSchema,
  revision: projectDeliverableRevisionDtoSchema,
});
export type ProjectDeliverableRevisionCreateResponse = z.infer<
  typeof projectDeliverableRevisionCreateResponseSchema
>;

export const projectSupportTicketCreateResponseSchema = z.object({
  ok: z.literal(true),
  ticket: clientSupportTicketDtoSchema,
});
export type ProjectSupportTicketCreateResponse = z.infer<typeof projectSupportTicketCreateResponseSchema>;

export const projectSupportTicketUpdateResponseSchema = z.object({
  ok: z.literal(true),
  ticket: clientSupportTicketDtoSchema,
});
export type ProjectSupportTicketUpdateResponse = z.infer<typeof projectSupportTicketUpdateResponseSchema>;

export const projectTemplatesListResponseSchema = z.object({
  ok: z.literal(true),
  items: z.array(projectTemplateDtoSchema),
});
export type ProjectTemplatesListResponse = z.infer<typeof projectTemplatesListResponseSchema>;

export const projectTemplateSaveResponseSchema = z.object({
  ok: z.literal(true),
  template: projectTemplateDtoSchema,
});
export type ProjectTemplateSaveResponse = z.infer<typeof projectTemplateSaveResponseSchema>;
