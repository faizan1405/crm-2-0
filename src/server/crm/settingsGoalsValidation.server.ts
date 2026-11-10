import "@tanstack/react-start/server-only";
import { z } from "zod";
import { MAX_DECIMAL_15_2_PAISE, parseStrictInrInputToPaise } from "../db/money.server";
import { isValidCalendarDay } from "./dates.server";
import { CrmServiceError } from "./errors.server";
import {
  GOAL_METRIC_KEYS,
  GOAL_METRIC_MAP,
  GOAL_PERIODS,
  GOAL_STATUSES,
  isGoalMetricKey,
  type GoalMetricKey,
  type GoalTargetUnit,
} from "./goalsCalc.server";
import { looksLikeSecret, SECRET_ERROR } from "./projectsCalc.server";
import { isValidLeadEmail } from "./validation.server";

export const DEFAULT_LEAD_SORTS = ["recent", "score", "value"] as const;
export type DefaultLeadSort = (typeof DEFAULT_LEAD_SORTS)[number];

export const BUSINESS_TIMEZONE_FIXED = "Asia/Kolkata" as const;
export const CURRENCY_CODE_FIXED = "INR" as const;

export const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const BUSINESS_PHONE_REGEX = /^[+\d\s().-]{7,32}$/;

/**
 * Normalized lowercase keys blocked unconditionally across Business Settings payloads
 * so clients can never inject credentials, roles, tokens, private paths, or feature-gate overrides.
 */
export const FORBIDDEN_SETTING_KEYS_NORMALIZED = new Set<string>([
  "password",
  "passwordhash",
  "currentpassword",
  "newpassword",
  "confirmpassword",
  "pwd",
  "passcode",
  "pin",
  "otp",
  "role",
  "roleid",
  "accountstatus",
  "permissions",
  "permission",
  "isadmin",
  "admin",
  "owneruserid",
  "userid",
  "apikey",
  "openrouterapikey",
  "openrouterkey",
  "metaadskey",
  "metaadsapikey",
  "metaadstoken",
  "webhooksecret",
  "secret",
  "authsecret",
  "sessionsecret",
  "token",
  "sessiontoken",
  "accesstoken",
  "refreshtoken",
  "csrfsecret",
  "bankpassword",
  "bankpin",
  "bankcredentials",
  "cardcvv",
  "cvv",
  "cpanellogin",
  "proofstoragedir",
  "proofstoragepath",
  "storagedriver",
  "proofstoragedriver",
  "databaseurl",
  "dbpassword",
  "dbhost",
  "dbuser",
  "dbname",
  "leadpilotavailable",
  "devleadpilot",
  "bypassauth",
  "bypasscsrf",
  "overridepermissions",
  "skipvalidation",
  "productiongate",
  "sessioncookiename",
]);

function normalizeSettingKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function findForbiddenSettingKey(value: unknown, depth = 0): string | null {
  if (depth > 8 || value === null || typeof value !== "object") {
    return null;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const hit = findForbiddenSettingKey(item, depth + 1);
      if (hit) return hit;
    }
    return null;
  }
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const normalized = normalizeSettingKey(k);
    if (FORBIDDEN_SETTING_KEYS_NORMALIZED.has(normalized)) {
      return k;
    }
    const nested = findForbiddenSettingKey(v, depth + 1);
    if (nested) return nested;
  }
  return null;
}

/** Rejects dangerous credential/role/gate override keys before schema parsing runs. */
export function assertNoForbiddenSettingKeys(raw: Record<string, unknown>): void {
  const hit = findForbiddenSettingKey(raw);
  if (hit) {
    throw new CrmServiceError(
      403,
      "forbidden_setting_key",
      `Setting key '${hit}' is forbidden. Passwords, roles, API keys, bank credentials, session tokens, private storage paths, and production feature gates cannot be modified via Business Settings.`,
      { details: { key: hit } },
    );
  }
}

function hasDisallowedControlChars(value: string, options?: { allowNewlines?: boolean }): boolean {
  const allowNewlines = options?.allowNewlines ?? false;
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code === 0x7f) return true;
    if (code <= 0x1f) {
      if (allowNewlines && (code === 0x09 || code === 0x0a || code === 0x0d)) {
        continue;
      }
      return true;
    }
  }
  return false;
}

function assertNoSecretsInTexts(fields: Array<[string, string | null | undefined]>): void {
  for (const [field, value] of fields) {
    if (!value) continue;
    if (looksLikeSecret(value)) {
      throw new CrmServiceError(400, "secret_detected", SECRET_ERROR, {
        details: { [field]: SECRET_ERROR },
      });
    }
  }
}

function isValidHttpWebsiteUrl(raw: string): boolean {
  if (/\s/.test(raw)) return false;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return false;
  }
  if (!parsed.hostname || !parsed.hostname.includes(".")) {
    return false;
  }
  if (parsed.username || parsed.password) {
    return false;
  }
  return true;
}

function isValidPhoneText(raw: string): boolean {
  if (!BUSINESS_PHONE_REGEX.test(raw)) return false;
  const digits = raw.replace(/\D/g, "");
  return digits.length >= 7 && digits.length <= 15;
}

const nullableSingleLineText = (label: string, max: number) =>
  z
    .string({ invalid_type_error: `${label} must be text or null.` })
    .transform((v) => v.trim())
    .refine((v) => v.length >= 1, `${label} cannot be blank; pass null to clear.`)
    .refine((v) => v.length <= max, `${label} must be ${max} characters or fewer.`)
    .refine(
      (v) => !hasDisallowedControlChars(v, { allowNewlines: false }),
      `${label} contains invalid control characters.`,
    )
    .nullable()
    .optional();

const nullableMultiLineText = (label: string, max: number) =>
  z
    .string({ invalid_type_error: `${label} must be text or null.` })
    .transform((v) => v.replace(/\r\n?/g, "\n").trim())
    .refine((v) => v.length >= 1, `${label} cannot be blank; pass null to clear.`)
    .refine((v) => v.length <= max, `${label} must be ${max} characters or fewer.`)
    .refine(
      (v) => !hasDisallowedControlChars(v, { allowNewlines: true }),
      `${label} contains invalid control characters.`,
    )
    .nullable()
    .optional();

const optionalIdemKeySchema = z
  .string()
  .transform((v) => v.trim())
  .refine((v) => v.length >= 1 && v.length <= 128, "idempotencyKey must be 1 to 128 characters.")
  .refine(
    (v) => !hasDisallowedControlChars(v, { allowNewlines: false }),
    "idempotencyKey contains invalid control characters.",
  )
  .optional();

export const UPDATABLE_SETTINGS_FIELDS = [
  "ownerDisplayName",
  "businessName",
  "profileEmail",
  "businessPhone",
  "businessWebsite",
  "businessAddress",
  "gstin",
  "paymentInstructions",
  "businessTimezone",
  "currencyCode",
  "defaultLeadSort",
  "notifyFollowUps",
  "notifyPayments",
  "notifyDigest",
  "notifyGoalAchieved",
  "notifyTeamGoal",
  "notifyMilestone",
  "notifyOverdue",
  "overdueThreshold",
] as const;

export const updateSettingsBodySchema = z
  .object({
    ownerDisplayName: nullableSingleLineText("Owner display name", 120),
    businessName: nullableSingleLineText("Business name", 160),
    profileEmail: z
      .string({ invalid_type_error: "Profile email must be text or null." })
      .transform((v) => v.trim().toLowerCase())
      .refine((v) => v.length >= 1 && v.length <= 191, "Profile email must be 1 to 191 characters.")
      .refine((v) => isValidLeadEmail(v), "Enter a valid email address.")
      .nullable()
      .optional(),
    businessPhone: z
      .string({ invalid_type_error: "Business phone must be text or null." })
      .transform((v) => v.trim())
      .refine(
        (v) => !hasDisallowedControlChars(v) && isValidPhoneText(v),
        "Enter a valid business phone number (7 to 15 digits).",
      )
      .nullable()
      .optional(),
    businessWebsite: z
      .string({ invalid_type_error: "Business website must be text or null." })
      .transform((v) => v.trim())
      .refine(
        (v) => v.length >= 1 && v.length <= 255 && !hasDisallowedControlChars(v),
        "Website URL must be 255 characters or fewer.",
      )
      .refine(
        (v) => isValidHttpWebsiteUrl(v),
        "Enter a valid http:// or https:// website URL without embedded credentials.",
      )
      .nullable()
      .optional(),
    businessAddress: nullableMultiLineText("Business address", 1000),
    gstin: z
      .string({ invalid_type_error: "GSTIN must be text or null." })
      .transform((v) => v.trim().toUpperCase())
      .refine((v) => GSTIN_REGEX.test(v), "Enter a valid 15-character Indian GSTIN.")
      .nullable()
      .optional(),
    paymentInstructions: nullableMultiLineText("Payment instructions", 2000),
    businessTimezone: z
      .literal(BUSINESS_TIMEZONE_FIXED, {
        errorMap: () => ({ message: "Only Asia/Kolkata business timezone is supported." }),
      })
      .optional(),
    currencyCode: z
      .literal(CURRENCY_CODE_FIXED, {
        errorMap: () => ({ message: "Only INR currency is supported." }),
      })
      .optional(),
    defaultLeadSort: z
      .enum(DEFAULT_LEAD_SORTS, {
        errorMap: () => ({ message: "defaultLeadSort must be 'recent', 'score', or 'value'." }),
      })
      .optional(),
    notifyFollowUps: z.boolean().optional(),
    notifyPayments: z.boolean().optional(),
    notifyDigest: z.boolean().optional(),
    notifyGoalAchieved: z.boolean().optional(),
    notifyTeamGoal: z.boolean().optional(),
    notifyMilestone: z.boolean().optional(),
    notifyOverdue: z.boolean().optional(),
    overdueThreshold: z
      .number({ invalid_type_error: "overdueThreshold must be a positive integer." })
      .int("overdueThreshold must be a whole number.")
      .min(1, "overdueThreshold must be at least 1.")
      .max(1000, "overdueThreshold cannot exceed 1000.")
      .optional(),
    expectedVersion: z.number().int().min(0).optional(),
    idempotencyKey: optionalIdemKeySchema,
  })
  .strict()
  .superRefine((val, ctx) => {
    const hasField = UPDATABLE_SETTINGS_FIELDS.some((k) => val[k] !== undefined);
    if (!hasField) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Provide at least one permitted business setting field to update.",
      });
    }
  });

export type UpdateSettingsInput = z.infer<typeof updateSettingsBodySchema>;

export function parseUpdateSettingsBody(raw: Record<string, unknown>): UpdateSettingsInput {
  assertNoForbiddenSettingKeys(raw);
  const parsed = updateSettingsBodySchema.parse(raw);
  assertNoSecretsInTexts([
    ["ownerDisplayName", parsed.ownerDisplayName],
    ["businessName", parsed.businessName],
    ["businessAddress", parsed.businessAddress],
    ["paymentInstructions", parsed.paymentInstructions],
  ]);
  return parsed;
}

export const listSettingsAuditQuerySchema = z.object({
  section: z.enum(["all", "profile", "crm", "notifications", "mixed"]).default("all"),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
export type ListSettingsAuditQuery = z.infer<typeof listSettingsAuditQuerySchema>;

// ---------------------------------------------------------------------------
// Sales Goals Validation & Exact Target Parsing
// ---------------------------------------------------------------------------

export const COUNT_GOAL_MAX = 1_000_000_000;

export interface ParsedGoalTarget {
  targetUnit: GoalTargetUnit;
  targetCount: number | null;
  targetAmount: string | null;
}

/**
 * Parses a goal target against the authoritative metric unit (`count` or `inr`).
 * - `null` or `undefined` remains explicitly unset (`targetCount: null, targetAmount: null`).
 * - `0`, negatives, floats for counts, >2 decimals for INR, NaN, booleans, scientific notation,
 *   and malformed strings are strictly rejected.
 */
export function parseGoalTargetForMetric(
  metric: GoalMetricKey,
  rawTarget: unknown,
): ParsedGoalTarget {
  const unit = GOAL_METRIC_MAP[metric].unit;
  if (rawTarget === null || rawTarget === undefined) {
    return { targetUnit: unit, targetCount: null, targetAmount: null };
  }

  if (unit === "count") {
    let countNum: number;
    if (typeof rawTarget === "number") {
      if (!Number.isFinite(rawTarget) || !Number.isInteger(rawTarget)) {
        throw new CrmServiceError(
          400,
          "validation_error",
          "Count goal target must be a finite positive whole number.",
          { details: { target: "Must be a positive whole number." } },
        );
      }
      countNum = rawTarget;
    } else if (typeof rawTarget === "string") {
      const trimmed = rawTarget.trim();
      if (!/^\d{1,10}$/.test(trimmed)) {
        throw new CrmServiceError(
          400,
          "validation_error",
          "Count goal target must be a positive whole number without decimals or signs.",
          { details: { target: "Must be a positive whole number." } },
        );
      }
      countNum = Number(trimmed);
    } else {
      throw new CrmServiceError(
        400,
        "validation_error",
        "Count goal target must be an integer or null.",
        {
          details: { target: "Invalid count target type." },
        },
      );
    }

    if (countNum <= 0 || countNum > COUNT_GOAL_MAX) {
      throw new CrmServiceError(
        400,
        "validation_error",
        `Count goal target must be between 1 and ${COUNT_GOAL_MAX}. Pass null to leave target unset.`,
        { details: { target: "Target must be >= 1." } },
      );
    }
    return { targetUnit: "count", targetCount: countNum, targetAmount: null };
  }

  const parsed = parseStrictInrInputToPaise(rawTarget, { allowZero: false });
  if (!parsed.ok) {
    throw new CrmServiceError(400, "validation_error", parsed.message, {
      details: { target: parsed.message },
    });
  }
  if (parsed.paise > MAX_DECIMAL_15_2_PAISE) {
    throw new CrmServiceError(
      400,
      "validation_error",
      "Monetary target exceeds supported DECIMAL(15,2) bound.",
    );
  }
  return {
    targetUnit: "inr",
    targetCount: null,
    targetAmount: parsed.decimal,
  };
}

const goalNameSchema = z
  .string({ required_error: "Goal name is required." })
  .transform((v) => v.trim())
  .refine((v) => v.length >= 1, "Goal name is required.")
  .refine((v) => v.length <= 120, "Goal name must be 120 characters or fewer.")
  .refine(
    (v) => !hasDisallowedControlChars(v, { allowNewlines: false }),
    "Goal name contains invalid control characters.",
  );

const goalDaySchema = (fieldLabel: string) =>
  z
    .string({ invalid_type_error: `${fieldLabel} must be YYYY-MM-DD.` })
    .transform((v) => v.trim())
    .refine(
      (v) => /^\d{4}-\d{2}-\d{2}$/.test(v) && isValidCalendarDay(v),
      `${fieldLabel} must be a valid YYYY-MM-DD calendar date.`,
    );

export const createGoalBodySchema = z
  .object({
    name: goalNameSchema,
    metric: z.enum(GOAL_METRIC_KEYS, {
      errorMap: () => ({ message: "Unsupported goal metric." }),
    }),
    scope: z.enum(["owner", "team"]).default("owner"),
    period: z.enum(GOAL_PERIODS, {
      errorMap: () => ({ message: "Goal period must be daily, weekly, monthly, or custom." }),
    }),
    target: z.unknown().optional(),
    customFromIst: goalDaySchema("customFromIst").nullable().optional(),
    customToIst: goalDaySchema("customToIst").nullable().optional(),
    effectiveFromIst: goalDaySchema("effectiveFromIst").optional(),
    legacyId: z
      .string()
      .transform((v) => v.trim())
      .refine((v) => v.length >= 1 && v.length <= 64 && !hasDisallowedControlChars(v))
      .optional(),
    idempotencyKey: optionalIdemKeySchema,
  })
  .strict()
  .superRefine((val, ctx) => {
    if (val.period === "custom") {
      if (!val.customFromIst || !val.customToIst) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["customFromIst"],
          message: "customFromIst and customToIst are required for custom-period goals.",
        });
      } else if (val.customFromIst > val.customToIst) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["customFromIst"],
          message: "customFromIst cannot be after customToIst.",
        });
      }
    } else if (
      (val.customFromIst !== undefined && val.customFromIst !== null) ||
      (val.customToIst !== undefined && val.customToIst !== null)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["customFromIst"],
        message: "customFromIst and customToIst can only be set on custom-period goals.",
      });
    }
  });

export type CreateGoalInput = z.infer<typeof createGoalBodySchema> & {
  parsedTarget: ParsedGoalTarget;
};

export function parseCreateGoalBody(raw: Record<string, unknown>): CreateGoalInput {
  assertNoForbiddenSettingKeys(raw);

  if (typeof raw["metric"] === "string" && !isGoalMetricKey(raw["metric"])) {
    throw new CrmServiceError(
      400,
      "unsupported_metric",
      `Unsupported goal metric '${raw["metric"]}'. Only verifiable B5C analytics metrics can be configured as goals.`,
      { details: { metric: "Unsupported or unmeasurable goal metric." } },
    );
  }
  if (raw["scope"] === "employee") {
    throw new CrmServiceError(
      400,
      "validation_error",
      "Employee-scoped goals require Team CRM authentication (not enabled yet). Choose 'owner' or 'team'.",
      { details: { scope: "Employee scope is not available in single-owner mode." } },
    );
  }

  const parsed = createGoalBodySchema.parse(raw);
  assertNoSecretsInTexts([["name", parsed.name]]);
  const parsedTarget = parseGoalTargetForMetric(parsed.metric, parsed.target);
  return { ...parsed, parsedTarget };
}

export const updateGoalBodySchema = z
  .object({
    expectedVersion: z
      .number({
        required_error: "expectedVersion is required when updating a goal.",
        invalid_type_error: "expectedVersion must be a positive integer.",
      })
      .int("expectedVersion must be an integer.")
      .min(1, "expectedVersion must be >= 1."),
    name: goalNameSchema.optional(),
    metric: z
      .enum(GOAL_METRIC_KEYS, {
        errorMap: () => ({ message: "Unsupported goal metric." }),
      })
      .optional(),
    scope: z.enum(["owner", "team"]).optional(),
    period: z.enum(GOAL_PERIODS).optional(),
    target: z.unknown().optional(),
    customFromIst: goalDaySchema("customFromIst").nullable().optional(),
    customToIst: goalDaySchema("customToIst").nullable().optional(),
    effectiveFromIst: goalDaySchema("effectiveFromIst").optional(),
    changeNote: z
      .string()
      .transform((v) => v.trim())
      .refine((v) => v.length >= 1 && v.length <= 200 && !hasDisallowedControlChars(v))
      .optional(),
    idempotencyKey: optionalIdemKeySchema,
  })
  .strict()
  .superRefine((val, ctx) => {
    const updatable = [
      "name",
      "metric",
      "scope",
      "period",
      "target",
      "customFromIst",
      "customToIst",
      "effectiveFromIst",
    ] as const;
    if (!updatable.some((k) => val[k] !== undefined)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Provide at least one goal field to update.",
      });
    }
  });

export type UpdateGoalInput = z.infer<typeof updateGoalBodySchema> & {
  hasTargetField: boolean;
};

export function parseUpdateGoalBody(raw: Record<string, unknown>): UpdateGoalInput {
  assertNoForbiddenSettingKeys(raw);

  if (typeof raw["metric"] === "string" && !isGoalMetricKey(raw["metric"])) {
    throw new CrmServiceError(
      400,
      "unsupported_metric",
      `Unsupported goal metric '${raw["metric"]}'. Only verifiable B5C analytics metrics can be configured as goals.`,
      { details: { metric: "Unsupported or unmeasurable goal metric." } },
    );
  }
  if (raw["scope"] === "employee") {
    throw new CrmServiceError(
      400,
      "validation_error",
      "Employee-scoped goals require Team CRM authentication (not enabled yet).",
      { details: { scope: "Employee scope is not available in single-owner mode." } },
    );
  }

  const parsed = updateGoalBodySchema.parse(raw);
  assertNoSecretsInTexts([
    ["name", parsed.name],
    ["changeNote", parsed.changeNote],
  ]);

  return {
    ...parsed,
    hasTargetField: Object.prototype.hasOwnProperty.call(raw, "target"),
  };
}

export const changeGoalStatusBodySchema = z
  .object({
    status: z.enum(["active", "paused"], {
      errorMap: () => ({
        message: "Status transition must be 'active' or 'paused'. Use /archive to archive.",
      }),
    }),
    reason: z
      .string()
      .transform((v) => v.trim())
      .refine((v) => v.length >= 1 && v.length <= 200 && !hasDisallowedControlChars(v))
      .optional(),
    expectedVersion: z.number().int().min(1).optional(),
    idempotencyKey: optionalIdemKeySchema,
  })
  .strict();

export type ChangeGoalStatusInput = z.infer<typeof changeGoalStatusBodySchema>;

export const archiveGoalBodySchema = z
  .object({
    reason: z
      .string()
      .transform((v) => v.trim())
      .refine((v) => v.length >= 1 && v.length <= 255 && !hasDisallowedControlChars(v))
      .optional(),
    expectedVersion: z.number().int().min(1).optional(),
    idempotencyKey: optionalIdemKeySchema,
  })
  .strict();

export type ArchiveGoalInput = z.infer<typeof archiveGoalBodySchema>;

export const listGoalsQuerySchema = z.object({
  status: z.enum(["all", ...GOAL_STATUSES]).default("all"),
  metric: z.enum(["all", ...GOAL_METRIC_KEYS]).default("all"),
  period: z.enum(["all", ...GOAL_PERIODS]).default("all"),
  includeArchived: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  limit: z.coerce.number().int().min(1).max(200).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});
export type ListGoalsQuery = z.infer<typeof listGoalsQuerySchema>;

export const listGoalRevisionsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});
export type ListGoalRevisionsQuery = z.infer<typeof listGoalRevisionsQuerySchema>;

export const goalProgressQuerySchema = z.object({
  asOf: goalDaySchema("asOf").optional(),
});
export type GoalProgressQuery = z.infer<typeof goalProgressQuerySchema>;
