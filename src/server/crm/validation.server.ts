import "@tanstack/react-start/server-only";
import { z } from "zod";
import { isValidInrAmount } from "../db/money.server";
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
