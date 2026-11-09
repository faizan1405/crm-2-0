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
