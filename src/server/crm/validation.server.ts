import "@tanstack/react-start/server-only";
import { z } from "zod";
import {
  decimalStringToPaise,
  isValidInrAmount,
  parseStrictInrInputToPaise,
  sumPaise,
} from "../db/money.server";
import { isValidCalendarDay, parseBusinessDateTimeToUtc } from "./dates.server";

export const LEAD_STATUSES = ["new", "contacted", "qualified", "proposal", "won", "lost"] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

export const LEAD_PRIORITIES = ["hot", "warm", "cold"] as const;
export type LeadPriority = (typeof LEAD_PRIORITIES)[number];

export const LEAD_SOURCES = [
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
export type LeadSource = (typeof LEAD_SOURCES)[number];

export const QUICK_STATUSES = [
  "interested",
  "callback",
  "not_picked",
  "busy",
  "not_interested",
  "switched_off",
] as const;
export type QuickStatus = (typeof QUICK_STATUSES)[number];

export const QUICK_LABEL: Record<QuickStatus, string> = {
  interested: "Interested",
  callback: "Call back",
  not_picked: "Not picked",
  busy: "Busy",
  not_interested: "Not interested",
  switched_off: "Switched off",
};

export const FOLLOWUP_TYPES = ["call", "whatsapp", "meeting", "email"] as const;
export type FollowUpType = (typeof FOLLOWUP_TYPES)[number];

export const WA_PURPOSES = ["followup", "quotation", "samples", "custom"] as const;
export type WaPurpose = (typeof WA_PURPOSES)[number];

export const WA_PURPOSE_LABEL: Record<WaPurpose, string> = {
  followup: "Follow-up",
  quotation: "Quotation",
  samples: "Samples / Demos",
  custom: "Custom message",
};

/**
 * Only explicit manual owner confirmation is permitted in B2B4.
 * Never accept "delivered", "read", or "verified_sent" without WhatsApp Business API webhooks.
 */
export const WA_CONFIRMATION_STATUSES = ["owner_confirmed_sent"] as const;
export type WaConfirmationStatus = (typeof WA_CONFIRMATION_STATUSES)[number];

/**
 * Mirrors src/lib/crm/whatsapp.ts `waNumber`.
 * Normalizes a 10-digit Indian mobile (or 0-prefixed 11-digit / 91-prefixed 12-digit)
 * to `91XXXXXXXXXX`; returns `null` if invalid.
 */
export function normalizeWhatsAppRecipientPhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  const local =
    digits.length === 10
      ? digits
      : digits.length === 11 && digits.startsWith("0")
        ? digits.slice(1)
        : digits.length === 12 && digits.startsWith("91")
          ? digits.slice(2)
          : null;
  return local && /^[6-9]\d{9}$/.test(local) ? `91${local}` : null;
}

export const CALL_OUTCOMES = [
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
export type CallOutcome = (typeof CALL_OUTCOMES)[number];

/**
 * Mirrors src/lib/crm/calllog.ts `isConnectedOutcome`.
 * "Not picked" and "Busy" are dial attempts only and NEVER count as successful contact.
 */
export function isConnectedCallOutcome(outcome: CallOutcome): boolean {
  return outcome !== "Not picked" && outcome !== "Busy";
}

/**
 * Mirrors src/lib/crm/calllog.ts `outcomeStage`.
 */
export function resolveOutcomeStage(outcome: CallOutcome, current: LeadStatus): LeadStatus {
  const map: Partial<Record<CallOutcome, LeadStatus>> = {
    Qualified: "qualified",
    "Proposal Sent": "proposal",
    Won: "won",
    Lost: "lost",
    "Not interested": "lost",
  };
  if (map[outcome]) return map[outcome]!;
  if ((outcome === "Connected" || outcome === "Interested") && current === "new") {
    return "contacted";
  }
  return current;
}

/** Moving to Won or Lost from a call needs explicit confirmation. */
export function needsCallStageConfirmation(target: LeadStatus, current: LeadStatus): boolean {
  return target !== current && (target === "won" || target === "lost");
}

/**
 * Mirrors src/lib/crm/calllog.ts `quickAfterCall`.
 * A connected outcome clears stale unreachable markers (`not_picked` / `busy`).
 */
export function resolveQuickStatusAfterCall(
  outcome: CallOutcome,
  current: QuickStatus | null,
): { set: boolean; value: QuickStatus | null } {
  const map: Partial<Record<CallOutcome, QuickStatus>> = {
    "Not picked": "not_picked",
    Busy: "busy",
    "Call back later": "callback",
    Interested: "interested",
    "Not interested": "not_interested",
  };
  const mapped = map[outcome];
  if (mapped) return { set: true, value: mapped };
  if (isConnectedCallOutcome(outcome) && (current === "not_picked" || current === "busy")) {
    return { set: true, value: null };
  }
  return { set: false, value: current };
}

export const ALL_ACTIVITY_TYPES = [
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
export type ActivityType = (typeof ALL_ACTIVITY_TYPES)[number];

/**
 * Only non-fabricated manual interaction entries may be posted directly to
 * `/api/v1/leads/:id/activities`. Call attempts, WhatsApp sends, stage/status transitions,
 * follow-up logs, archive/restore entries, and payment entries cannot be forged directly.
 */
export const MANUAL_ACTIVITY_TYPES = ["note", "meeting", "email"] as const;
export type ManualActivityType = (typeof MANUAL_ACTIVITY_TYPES)[number];

export const LEAD_LIFECYCLE_STATUSES = ["active", "waste", "deleted"] as const;
export type LeadLifecycleStatus = (typeof LEAD_LIFECYCLE_STATUSES)[number];

const EMAIL_RE =
  /^[A-Za-z0-9._+-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)*\.[A-Za-z]{2,}$/;

export function isValidLeadPhone(raw: string): boolean {
  return /^(?:91)?[6-9]\d{9}$/.test(raw.replace(/\D/g, ""));
}

export function extractLeadPhoneKey(raw: string): string {
  return raw.replace(/\D/g, "").slice(-10);
}

export function isValidLeadEmail(raw: string): boolean {
  return EMAIL_RE.test(raw.trim());
}

export function normalizeLeadEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

const TRACKED_EDIT_FIELDS = {
  phone: "phone",
  email: "email",
  company: "company",
  source: "lead source",
} as const;

/** Privacy-safe contact edit summary matching src/lib/crm/leadtools.ts `editSummary`. */
export function buildLeadEditSummary(
  prev: Partial<Record<keyof typeof TRACKED_EDIT_FIELDS, string | null | undefined>>,
  next: Partial<Record<keyof typeof TRACKED_EDIT_FIELDS, string | null | undefined>>,
): string | null {
  const norm = (v: unknown) => (v === undefined || v === null ? "" : String(v).trim());
  const changed = (Object.keys(TRACKED_EDIT_FIELDS) as (keyof typeof TRACKED_EDIT_FIELDS)[])
    .filter((k) => k in next && norm(next[k]) !== norm(prev[k]))
    .map((k) => TRACKED_EDIT_FIELDS[k]);
  return changed.length ? `Contact details updated: ${changed.join(", ")} changed` : null;
}

const optionalTrimmedString = (max: number) =>
  z.preprocess(
    (v) =>
      typeof v === "string" && v.trim() === "" ? undefined : typeof v === "string" ? v.trim() : v,
    z.string().min(1).max(max).optional(),
  );

const nullableTrimmedString = (max: number) =>
  z.preprocess(
    (v) =>
      v === null
        ? null
        : typeof v === "string" && v.trim() === ""
          ? null
          : typeof v === "string"
            ? v.trim()
            : v,
    z.string().min(1).max(max).nullable().optional(),
  );

const optionalMoneySchema = z
  .number({ invalid_type_error: "Amounts must be finite numbers." })
  .refine((v) => isValidInrAmount(v), {
    message: "Amounts must be zero or greater with at most 2 decimal places.",
  })
  .optional();

const nullableMoneySchema = z
  .number({ invalid_type_error: "Amounts must be finite numbers." })
  .refine((v) => isValidInrAmount(v), {
    message: "Amounts must be zero or greater with at most 2 decimal places.",
  })
  .nullable()
  .optional();

export const createLeadBodySchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "Name and a valid 10-digit phone are required")
      .max(120, "Name must be 120 characters or fewer"),
    phone: z
      .string()
      .trim()
      .max(32)
      .refine(isValidLeadPhone, "Name and a valid 10-digit phone are required"),
    email: optionalTrimmedString(160).refine(
      (v) => v === undefined || isValidLeadEmail(v),
      "Invalid email",
    ),
    company: optionalTrimmedString(160),
    requirement: optionalTrimmedString(2000),
    source: z.enum(LEAD_SOURCES).default("Website"),
    status: z.enum(LEAD_STATUSES).default("new"),
    priority: z.enum(LEAD_PRIORITIES).default("warm"),
    aiScore: z.number().int().min(0).max(100).optional(),
    quotedAmount: optionalMoneySchema,
    budget: optionalMoneySchema,
    notes: optionalTrimmedString(20_000),
    pinned: z.boolean().default(false),
    quickStatus: z.enum(QUICK_STATUSES).optional(),
    lostReason: optionalTrimmedString(500),
    tagIds: z.array(z.string().trim().min(1).max(64)).max(50).optional(),
    fieldValues: z.record(z.string().trim().min(1).max(64), z.unknown()).optional(),
    allowDuplicate: z.boolean().default(false),
    idempotencyKey: optionalTrimmedString(128),
  })
  .superRefine((val, ctx) => {
    if (val.status === "lost" && !val.lostReason) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["lostReason"],
        message: "Add a lost reason",
      });
    }
  });

export type CreateLeadInput = z.infer<typeof createLeadBodySchema>;

export const updateLeadBodySchema = z
  .object({
    version: z.number().int().min(1, "Expected integer record version >= 1."),
    name: z
      .string()
      .trim()
      .min(1, "Name is required")
      .max(120, "Name must be 120 characters or fewer")
      .optional(),
    phone: z
      .string()
      .trim()
      .max(32)
      .refine(isValidLeadPhone, "Enter a valid 10-digit mobile number")
      .optional(),
    email: nullableTrimmedString(160).refine(
      (v) => v === undefined || v === null || isValidLeadEmail(v),
      "Invalid email",
    ),
    company: nullableTrimmedString(160),
    requirement: nullableTrimmedString(2000),
    source: z.enum(LEAD_SOURCES).optional(),
    status: z.enum(LEAD_STATUSES).optional(),
    priority: z.enum(LEAD_PRIORITIES).optional(),
    aiScore: z.number().int().min(0).max(100).nullable().optional(),
    quotedAmount: nullableMoneySchema,
    budget: nullableMoneySchema,
    notes: nullableTrimmedString(20_000),
    pinned: z.boolean().optional(),
    quickStatus: z.enum(QUICK_STATUSES).nullable().optional(),
    lostReason: nullableTrimmedString(500),
    tagIds: z.array(z.string().trim().min(1).max(64)).max(50).optional(),
    fieldValues: z.record(z.string().trim().min(1).max(64), z.unknown()).optional(),
    allowDuplicate: z.boolean().default(false),
  })
  .superRefine((val, ctx) => {
    const mutableKeys = [
      "name",
      "phone",
      "email",
      "company",
      "requirement",
      "source",
      "status",
      "priority",
      "aiScore",
      "quotedAmount",
      "budget",
      "notes",
      "pinned",
      "quickStatus",
      "lostReason",
      "tagIds",
      "fieldValues",
    ] as const;
    if (!mutableKeys.some((k) => val[k] !== undefined)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Provide at least one lead field to update.",
      });
    }
  });

export type UpdateLeadInput = z.infer<typeof updateLeadBodySchema>;

export const archiveLeadBodySchema = z.object({
  kind: z.enum(["waste", "deleted"]).default("deleted"),
  reason: optionalTrimmedString(500),
  version: z.number().int().min(1, "Expected integer record version >= 1."),
  idempotencyKey: optionalTrimmedString(128),
});

export type ArchiveLeadInput = z.infer<typeof archiveLeadBodySchema>;

export const restoreLeadBodySchema = z.object({
  version: z.number().int().min(1).optional(),
  idempotencyKey: optionalTrimmedString(128),
});

export type RestoreLeadInput = z.infer<typeof restoreLeadBodySchema>;

export const listLeadsQuerySchema = z.object({
  q: optionalTrimmedString(120),
  lifecycle: z.enum(["active", "waste", "deleted", "all"]).default("active"),
  status: z.enum(["all", ...LEAD_STATUSES]).default("all"),
  source: z.enum(["all", ...LEAD_SOURCES]).default("all"),
  priority: z.enum(["all", ...LEAD_PRIORITIES]).default("all"),
  quickStatus: z.enum(["all", "none", ...QUICK_STATUSES]).default("all"),
  followUp: z.enum(["all", "overdue", "today", "week", "none"]).default("all"),
  createdFrom: optionalTrimmedString(10).refine(
    (v) => v === undefined || isValidCalendarDay(v),
    "createdFrom must be a valid YYYY-MM-DD calendar date",
  ),
  createdTo: optionalTrimmedString(10).refine(
    (v) => v === undefined || isValidCalendarDay(v),
    "createdTo must be a valid YYYY-MM-DD calendar date",
  ),
  tagId: optionalTrimmedString(64),
  sort: z.enum(["recent", "updated", "score", "value", "name"]).default("recent"),
  pinnedFirst: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export type ListLeadsQuery = z.infer<typeof listLeadsQuerySchema>;

export const listActivitiesQuerySchema = z.object({
  type: z.enum(["all", ...ALL_ACTIVITY_TYPES]).default("all"),
  limit: z.coerce.number().int().min(1).max(200).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

export type ListActivitiesQuery = z.infer<typeof listActivitiesQuerySchema>;

export const createActivityBodySchema = z.object({
  type: z.string().trim().min(1).max(32),
  text: z.string().trim().min(1, "Activity note cannot be empty").max(5000),
  opId: optionalTrimmedString(128),
  idempotencyKey: optionalTrimmedString(128),
});

export type CreateActivityInput = z.infer<typeof createActivityBodySchema>;

export const listFollowUpsQuerySchema = z.object({
  leadId: optionalTrimmedString(64),
  bucket: z.enum(["all", "pending", "overdue", "today", "upcoming", "done"]).default("all"),
  dateIst: optionalTrimmedString(10).refine(
    (v) => v === undefined || isValidCalendarDay(v),
    "dateIst must be a valid YYYY-MM-DD calendar date",
  ),
  type: z.enum(["all", ...FOLLOWUP_TYPES]).default("all"),
  leadLifecycle: z.enum(["active", "all", "waste", "deleted"]).default("active"),
  limit: z.coerce.number().int().min(1).max(200).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

export type ListFollowUpsQuery = z.infer<typeof listFollowUpsQuerySchema>;

export const createFollowUpBodySchema = z.object({
  leadId: z.string().trim().min(1, "Lead is required").max(64),
  type: z.enum(FOLLOWUP_TYPES),
  dueAt: z
    .string()
    .trim()
    .min(1, "Choose a valid date and time")
    .max(64)
    .refine((v) => parseBusinessDateTimeToUtc(v).ok, "Choose a valid date and time"),
  note: optionalTrimmedString(1000),
  replaceActiveFollowUpId: optionalTrimmedString(64),
  opId: optionalTrimmedString(128),
  idempotencyKey: optionalTrimmedString(128),
});

export type CreateFollowUpInput = z.infer<typeof createFollowUpBodySchema>;

export const updateFollowUpBodySchema = z
  .object({
    version: z.number().int().min(1, "Expected integer record version >= 1."),
    dueAt: z
      .string()
      .trim()
      .min(1)
      .max(64)
      .refine((v) => parseBusinessDateTimeToUtc(v).ok, "Choose a valid date and time")
      .optional(),
    note: nullableTrimmedString(1000),
  })
  .superRefine((val, ctx) => {
    if (val.dueAt === undefined && val.note === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Provide dueAt or note to update this follow-up.",
      });
    }
  });

export type UpdateFollowUpInput = z.infer<typeof updateFollowUpBodySchema>;

export const completeFollowUpBodySchema = z.object({
  version: z.number().int().min(1, "Expected integer record version >= 1."),
  idempotencyKey: optionalTrimmedString(128),
});

export type CompleteFollowUpInput = z.infer<typeof completeFollowUpBodySchema>;

export const cancelFollowUpBodySchema = z.object({
  version: z.number().int().min(1, "Expected integer record version >= 1."),
  reason: optionalTrimmedString(255),
  idempotencyKey: optionalTrimmedString(128),
});

export type CancelFollowUpInput = z.infer<typeof cancelFollowUpBodySchema>;

export const createCallLogBodySchema = z.object({
  leadId: z.string().trim().min(1, "Lead is required").max(64),
  outcome: z.enum(CALL_OUTCOMES, {
    errorMap: () => ({ message: "Pick a valid call outcome" }),
  }),
  notes: optionalTrimmedString(5000),
  stage: z.enum(LEAD_STATUSES).optional(),
  confirmed: z.boolean().default(false),
  lostReason: optionalTrimmedString(500),
  dialSource: z.preprocess(
    (v) =>
      typeof v === "string" && v.trim() === "" ? undefined : typeof v === "string" ? v.trim() : v,
    z.string().min(1).max(64).default("CRM"),
  ),
  expectedLeadVersion: z.number().int().min(1, "Expected integer record version >= 1.").optional(),
  opId: optionalTrimmedString(128),
  idempotencyKey: optionalTrimmedString(128),
});

export type CreateCallLogInput = z.infer<typeof createCallLogBodySchema>;

export const listCallsQuerySchema = z.object({
  leadId: optionalTrimmedString(64),
  outcome: z.enum(["all", ...CALL_OUTCOMES]).default("all"),
  connected: z.enum(["all", "true", "false"]).default("all"),
  dateIst: optionalTrimmedString(10).refine(
    (v) => v === undefined || isValidCalendarDay(v),
    "dateIst must be a valid YYYY-MM-DD calendar date",
  ),
  leadLifecycle: z.enum(["active", "all", "waste", "deleted"]).default("active"),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export type ListCallsQuery = z.infer<typeof listCallsQuerySchema>;

export const listLeadCallsQuerySchema = z.object({
  outcome: z.enum(["all", ...CALL_OUTCOMES]).default("all"),
  connected: z.enum(["all", "true", "false"]).default("all"),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export type ListLeadCallsQuery = z.infer<typeof listLeadCallsQuerySchema>;

export const createWhatsAppLogBodySchema = z.object({
  leadId: z.string().trim().min(1, "Lead is required").max(64),
  purpose: z.enum(WA_PURPOSES, {
    errorMap: () => ({ message: "Pick a valid WhatsApp message purpose" }),
  }),
  templateId: optionalTrimmedString(64),
  templateName: optionalTrimmedString(120),
  recipientPhone: optionalTrimmedString(32).refine(
    (v) => v === undefined || normalizeWhatsAppRecipientPhone(v) !== null,
    "Phone number must be a valid Indian mobile for WhatsApp.",
  ),
  messageText: z
    .string({ required_error: "Write or paste a WhatsApp message before confirming send." })
    .transform((v) => v.replace(/\r\n?/g, "\n").trim())
    .refine((v) => v.length >= 1, "Write or paste a WhatsApp message before confirming send.")
    .refine((v) => v.length <= 4096, "WhatsApp message cannot exceed 4096 characters."),
  confirmedSent: z.literal(true, {
    errorMap: () => ({
      message: "Confirm you actually sent the message in WhatsApp before logging.",
    }),
  }),
  confirmationStatus: z
    .enum(WA_CONFIRMATION_STATUSES, {
      errorMap: () => ({
        message: "Only manual owner confirmation ('owner_confirmed_sent') is supported.",
      }),
    })
    .default("owner_confirmed_sent"),
  composerSource: z.preprocess(
    (v) =>
      typeof v === "string" && v.trim() === "" ? undefined : typeof v === "string" ? v.trim() : v,
    z.string().min(1).max(64).default("CRM"),
  ),
  expectedLeadVersion: z.number().int().min(1, "Expected integer record version >= 1.").optional(),
  opId: optionalTrimmedString(128),
  idempotencyKey: optionalTrimmedString(128),
});

export type CreateWhatsAppLogInput = z.infer<typeof createWhatsAppLogBodySchema>;

export const listWhatsAppQuerySchema = z.object({
  leadId: optionalTrimmedString(64),
  purpose: z.enum(["all", ...WA_PURPOSES]).default("all"),
  dateIst: optionalTrimmedString(10).refine(
    (v) => v === undefined || isValidCalendarDay(v),
    "dateIst must be a valid YYYY-MM-DD calendar date",
  ),
  leadLifecycle: z.enum(["active", "all", "waste", "deleted"]).default("active"),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export type ListWhatsAppQuery = z.infer<typeof listWhatsAppQuerySchema>;

export const listLeadWhatsAppQuerySchema = z.object({
  purpose: z.enum(["all", ...WA_PURPOSES]).default("all"),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export type ListLeadWhatsAppQuery = z.infer<typeof listLeadWhatsAppQuerySchema>;

// ---------------------------------------------------------------------------
// Checkpoint B3A — Deals, Milestones, Payments & Financial Ledger Schemas
// ---------------------------------------------------------------------------

export const CLIENT_TYPES = ["crm", "other"] as const;
export type ClientType = (typeof CLIENT_TYPES)[number];

export const DEAL_STATUSES = ["active", "completed", "on_hold", "cancelled"] as const;
export type DealStatus = (typeof DEAL_STATUSES)[number];

export const NON_CANCELLED_DEAL_STATUSES = ["active", "completed", "on_hold"] as const;
export type NonCancelledDealStatus = (typeof NON_CANCELLED_DEAL_STATUSES)[number];

export const PAYMENT_STATUSES = ["paid", "partial", "unpaid", "overdue", "cancelled"] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const PAYMENT_METHODS = ["UPI", "Bank Transfer", "Cash", "Card", "Cheque"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_TYPES = ["advance", "milestone", "final", "other"] as const;
export type PaymentType = (typeof PAYMENT_TYPES)[number];

export const PAYMENT_RECORD_STATUSES = ["posted", "voided"] as const;
export type PaymentRecordStatus = (typeof PAYMENT_RECORD_STATUSES)[number];

export const FINANCE_EVENT_TYPES = [
  "deal.created",
  "deal.updated",
  "deal.status_changed",
  "deal.cancelled",
  "deal.won_date_verified",
  "payment.recorded",
  "payment.voided",
] as const;
export type FinanceEventType = (typeof FINANCE_EVENT_TYPES)[number];

function buildStrictMoneySchema(options: { allowZero: boolean }) {
  return z.unknown().transform((val, ctx): string => {
    const parsed = parseStrictInrInputToPaise(val, { allowZero: options.allowZero });
    if (!parsed.ok) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: parsed.message,
      });
      return z.NEVER;
    }
    return parsed.decimal;
  });
}

const positiveMoneyDecimalSchema = buildStrictMoneySchema({ allowZero: false });
const nonNegativeMoneyDecimalSchema = buildStrictMoneySchema({ allowZero: true });

export const dealMilestoneInputSchema = z
  .object({
    id: optionalTrimmedString(64),
    label: z
      .string()
      .trim()
      .min(1, "Milestone label is required")
      .max(160, "Milestone label must be 160 characters or fewer"),
    amount: positiveMoneyDecimalSchema,
    dueDate: z
      .string()
      .trim()
      .refine(isValidCalendarDay, "Milestone dueDate must be a valid YYYY-MM-DD calendar date"),
  })
  .strict();

export type DealMilestoneInput = z.infer<typeof dealMilestoneInputSchema>;

export const createDealBodySchema = z
  .object({
    clientType: z.enum(CLIENT_TYPES, {
      errorMap: () => ({ message: "clientType must be 'crm' or 'other'." }),
    }),
    leadId: optionalTrimmedString(64),
    clientName: optionalTrimmedString(160),
    company: optionalTrimmedString(160),
    phone: optionalTrimmedString(32).refine(
      (v) => v === undefined || isValidLeadPhone(v),
      "Enter a valid 10-digit mobile number",
    ),
    name: z
      .string()
      .trim()
      .min(1, "Deal name is required")
      .max(160, "Deal name must be 160 characters or fewer"),
    quotedAmount: nonNegativeMoneyDecimalSchema.optional(),
    finalAmount: positiveMoneyDecimalSchema,
    status: z.enum(NON_CANCELLED_DEAL_STATUSES).default("active"),
    dueDate: optionalTrimmedString(10).refine(
      (v) => v === undefined || isValidCalendarDay(v),
      "dueDate must be a valid YYYY-MM-DD calendar date",
    ),
    milestones: z.array(dealMilestoneInputSchema).max(50).default([]),
    notes: optionalTrimmedString(20_000),
    allowDuplicate: z.boolean().default(false),
    opId: optionalTrimmedString(128),
    idempotencyKey: optionalTrimmedString(128),
  })
  .strict()
  .superRefine((val, ctx) => {
    if (val.clientType === "crm" && !val.leadId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["leadId"],
        message: "leadId is required when clientType is 'crm'.",
      });
    }
    if (val.clientType === "other" && val.leadId !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["leadId"],
        message: "leadId must not be set when clientType is 'other'.",
      });
    }
    if (val.clientType === "other" && !val.clientName) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["clientName"],
        message: "clientName is required when clientType is 'other'.",
      });
    }
    if (val.milestones.length > 0) {
      const milestoneSum = sumPaise(val.milestones.map((m) => decimalStringToPaise(m.amount)));
      const finalPaise = decimalStringToPaise(val.finalAmount);
      if (milestoneSum > finalPaise) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["milestones"],
          message: "Total milestone amounts cannot exceed the agreed deal finalAmount.",
        });
      }
    }
  });

export type CreateDealInput = z.infer<typeof createDealBodySchema>;

export const updateDealBodySchema = z
  .object({
    version: z.number().int().min(1, "Expected integer record version >= 1."),
    name: z
      .string()
      .trim()
      .min(1, "Deal name is required")
      .max(160, "Deal name must be 160 characters or fewer")
      .optional(),
    clientName: optionalTrimmedString(160),
    company: nullableTrimmedString(160),
    phone: nullableTrimmedString(32).refine(
      (v) => v === undefined || v === null || isValidLeadPhone(v),
      "Enter a valid 10-digit mobile number",
    ),
    quotedAmount: nonNegativeMoneyDecimalSchema.optional(),
    finalAmount: positiveMoneyDecimalSchema.optional(),
    status: z.enum(DEAL_STATUSES).optional(),
    cancelReason: optionalTrimmedString(500),
    dueDate: nullableTrimmedString(10).refine(
      (v) => v === undefined || v === null || isValidCalendarDay(v),
      "dueDate must be a valid YYYY-MM-DD calendar date",
    ),
    milestones: z.array(dealMilestoneInputSchema).max(50).optional(),
    notes: nullableTrimmedString(20_000),
    idempotencyKey: optionalTrimmedString(128),
  })
  .strict()
  .superRefine((val, ctx) => {
    const mutableKeys = [
      "name",
      "clientName",
      "company",
      "phone",
      "quotedAmount",
      "finalAmount",
      "status",
      "dueDate",
      "milestones",
      "notes",
    ] as const;
    if (!mutableKeys.some((k) => val[k] !== undefined)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Provide at least one deal field to update.",
      });
    }
  });

export type UpdateDealInput = z.infer<typeof updateDealBodySchema>;

export const changeDealStatusBodySchema = z
  .object({
    version: z.number().int().min(1, "Expected integer record version >= 1."),
    status: z.enum(DEAL_STATUSES, {
      errorMap: () => ({ message: "Select a valid deal status." }),
    }),
    reason: optionalTrimmedString(500),
    idempotencyKey: optionalTrimmedString(128),
  })
  .strict();

export type ChangeDealStatusInput = z.infer<typeof changeDealStatusBodySchema>;

export const cancelDealBodySchema = z
  .object({
    version: z.number().int().min(1, "Expected integer record version >= 1."),
    reason: optionalTrimmedString(500),
    idempotencyKey: optionalTrimmedString(128),
  })
  .strict();

export type CancelDealInput = z.infer<typeof cancelDealBodySchema>;

export const verifyDealWonDateBodySchema = z
  .object({
    version: z.number().int().min(1, "Expected integer record version >= 1."),
    wonDate: z
      .string()
      .trim()
      .refine(
        (v) => isValidCalendarDay(v) && v >= "2000-01-01",
        "wonDate must be a valid YYYY-MM-DD calendar date from 2000-01-01 onward.",
      ),
    idempotencyKey: optionalTrimmedString(128),
  })
  .strict();

export type VerifyDealWonDateInput = z.infer<typeof verifyDealWonDateBodySchema>;

export const listDealsQuerySchema = z.object({
  q: optionalTrimmedString(120),
  status: z.enum(["all", ...DEAL_STATUSES]).default("all"),
  paymentStatus: z.enum(["all", "due", ...PAYMENT_STATUSES]).default("all"),
  clientType: z.enum(["all", ...CLIENT_TYPES]).default("all"),
  leadId: optionalTrimmedString(64),
  wonFrom: optionalTrimmedString(10).refine(
    (v) => v === undefined || isValidCalendarDay(v),
    "wonFrom must be a valid YYYY-MM-DD calendar date",
  ),
  wonTo: optionalTrimmedString(10).refine(
    (v) => v === undefined || isValidCalendarDay(v),
    "wonTo must be a valid YYYY-MM-DD calendar date",
  ),
  sort: z.enum(["recent", "due", "amount", "outstanding"]).default("recent"),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export type ListDealsQuery = z.infer<typeof listDealsQuerySchema>;

const paymentBaseFields = {
  amount: positiveMoneyDecimalSchema,
  date: optionalTrimmedString(10).refine(
    (v) => v === undefined || isValidCalendarDay(v),
    "date must be a valid YYYY-MM-DD calendar date",
  ),
  method: z.enum(PAYMENT_METHODS, {
    errorMap: () => ({ message: "Select a valid payment method." }),
  }),
  type: z
    .enum(PAYMENT_TYPES, {
      errorMap: () => ({ message: "Select a valid payment type." }),
    })
    .default("milestone"),
  reference: optionalTrimmedString(160),
  notes: optionalTrimmedString(5000),
  expectedDealVersion: z.number().int().min(1, "Expected integer record version >= 1.").optional(),
  opId: optionalTrimmedString(128),
  idempotencyKey: optionalTrimmedString(128),
};

export const createPaymentBodySchema = z.object(paymentBaseFields).strict();
export type CreatePaymentInput = z.infer<typeof createPaymentBodySchema>;

export const createPaymentWithDealBodySchema = z
  .object({
    dealId: z.string().trim().min(1, "dealId is required").max(64),
    ...paymentBaseFields,
  })
  .strict();
export type CreatePaymentWithDealInput = z.infer<typeof createPaymentWithDealBodySchema>;

export const voidPaymentBodySchema = z
  .object({
    reason: z
      .string({ required_error: "An explicit void reason is required." })
      .trim()
      .min(1, "An explicit void reason is required.")
      .max(500, "Void reason must be 500 characters or fewer."),
    expectedVersion: z.number().int().min(1, "Expected integer record version >= 1.").optional(),
    opId: optionalTrimmedString(128),
    idempotencyKey: optionalTrimmedString(128),
  })
  .strict();
export type VoidPaymentInput = z.infer<typeof voidPaymentBodySchema>;

export const listDealPaymentsQuerySchema = z.object({
  includeVoided: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
  method: z.enum(["all", ...PAYMENT_METHODS]).default("all"),
  type: z.enum(["all", ...PAYMENT_TYPES]).default("all"),
  dateFrom: optionalTrimmedString(10).refine(
    (v) => v === undefined || isValidCalendarDay(v),
    "dateFrom must be a valid YYYY-MM-DD calendar date",
  ),
  dateTo: optionalTrimmedString(10).refine(
    (v) => v === undefined || isValidCalendarDay(v),
    "dateTo must be a valid YYYY-MM-DD calendar date",
  ),
  limit: z.coerce.number().int().min(1).max(200).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});
export type ListDealPaymentsQuery = z.infer<typeof listDealPaymentsQuerySchema>;

export const listPaymentsQuerySchema = listDealPaymentsQuerySchema.extend({
  dealId: optionalTrimmedString(64),
});
export type ListPaymentsQuery = z.infer<typeof listPaymentsQuerySchema>;

export const listDealAuditQuerySchema = z.object({
  eventType: z.enum(["all", ...FINANCE_EVENT_TYPES]).default("all"),
  limit: z.coerce.number().int().min(1).max(200).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});
export type ListDealAuditQuery = z.infer<typeof listDealAuditQuerySchema>;

export const financeSummaryQuerySchema = z
  .object({
    from: optionalTrimmedString(10).refine(
      (v) => v === undefined || isValidCalendarDay(v),
      "from must be a valid YYYY-MM-DD calendar date",
    ),
    to: optionalTrimmedString(10).refine(
      (v) => v === undefined || isValidCalendarDay(v),
      "to must be a valid YYYY-MM-DD calendar date",
    ),
  })
  .superRefine((val, ctx) => {
    if (val.from && val.to && val.from > val.to) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["from"],
        message: "'from' date cannot be after 'to' date.",
      });
    }
  });
export type FinanceSummaryQuery = z.infer<typeof financeSummaryQuerySchema>;
