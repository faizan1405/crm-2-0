import "@tanstack/react-start/server-only";
import { z } from "zod";
import { isValidCalendarDay } from "./dates.server";

export const FIELD_TYPES = [
  "text",
  "longtext",
  "number",
  "currency",
  "date",
  "checkbox",
  "select",
  "multiselect",
  "url",
  "email",
  "phone",
] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

export const TAG_COLORS = ["graphite", "green", "amber", "rose", "sky", "violet"] as const;
export type TagColor = (typeof TAG_COLORS)[number];

export const TAG_SCOPES = ["lead", "project", "both"] as const;
export type TagScope = (typeof TAG_SCOPES)[number];

export const VIEW_VISIBILITIES = ["personal", "shared", "company"] as const;
export type ViewVisibility = (typeof VIEW_VISIBILITIES)[number];

export const VIEW_SORTS = ["recent", "score", "value", "name", "updated"] as const;
export type ViewSort = (typeof VIEW_SORTS)[number];

export const FILTER_OPS = [
  "is",
  "is_not",
  "any_of",
  "contains",
  "equals",
  "gt",
  "lt",
  "between",
  "before",
  "after",
  "on",
  "within_days",
  "today",
  "overdue",
  "yes",
  "no",
  "contains_any",
  "contains_all",
  "empty",
  "not_empty",
] as const;
export type Op = (typeof FILTER_OPS)[number];

export const RESERVED_FIELD_IDS = [
  "id",
  "name",
  "phone",
  "email",
  "company",
  "requirement",
  "source",
  "status",
  "stage",
  "priority",
  "assignee",
  "assigned",
  "created",
  "createdAt",
  "updatedAt",
  "lastContact",
  "nextFollowUp",
  "quickStatus",
  "tags",
  "notes",
  "pinned",
  "budget",
  "quotedAmount",
  "search",
  "inbox",
  "contact",
  "followupDue",
] as const;

export const SENSITIVE_NAME_REGEX = /pass(word|wd)|api[ _-]?key|secret|token|credential/i;

const CUSTOM_EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export interface StoredOption {
  id: string;
  label: string;
  archived?: boolean | undefined;
}

export interface MoneyValue {
  amount: number;
  currency: string;
}

export type CustomFieldValue = string | number | boolean | string[] | MoneyValue | undefined;

export function slugify(str: string): string {
  return str
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

export function generateFieldId(label: string, takenIds: string[]): string {
  const base = `cf_${slugify(label) || "field"}`;
  let candidate = base;
  let counter = 2;
  const takenSet = new Set(takenIds);
  while (takenSet.has(candidate)) {
    candidate = `${base}_${counter++}`;
  }
  return candidate;
}

export function generateTagId(name: string, takenIds: string[]): string {
  const base = `tag_${slugify(name) || "tag"}`;
  let candidate = base;
  let counter = 2;
  const takenSet = new Set(takenIds);
  while (takenSet.has(candidate)) {
    candidate = `${base}_${counter++}`;
  }
  return candidate;
}

export function generateOptionId(label: string, takenIds: string[]): string {
  const base = `opt_${slugify(label) || "option"}`;
  let candidate = base;
  let counter = 2;
  const takenSet = new Set(takenIds);
  while (takenSet.has(candidate)) {
    candidate = `${base}_${counter++}`;
  }
  return candidate;
}

export function isChoiceType(type: FieldType): boolean {
  return type === "select" || type === "multiselect";
}

export function validateCustomFieldDef(def: {
  id?: string | undefined;
  label: string;
  type: FieldType;
  entity?: ("lead" | "project") | undefined;
  visibility?: ("team" | "owner") | undefined;
  editable?: ("team" | "owner") | undefined;
  options?: StoredOption[] | undefined;
  defaultValue?: unknown;
  currency?: string | null | undefined;
  existingFields?: Array<{ id: string; label: string; status: string }> | undefined;
}): string | null {
  const labelClean = def.label.trim();
  if (!labelClean) return "Give the field a name.";
  if (labelClean.length > 60) return "Keep the name under 60 characters.";

  if (SENSITIVE_NAME_REGEX.test(labelClean)) {
    return "Don't keep passwords, API keys or credentials in custom fields — note where they are stored instead.";
  }

  if (
    RESERVED_FIELD_IDS.map((x) => x.toLowerCase()).includes(
      labelClean.toLowerCase().replace(/\s+/g, ""),
    )
  ) {
    return "That name belongs to a built-in field.";
  }

  if (def.id) {
    if (
      !/^cf_[a-z0-9_]+$/.test(def.id) ||
      (RESERVED_FIELD_IDS as readonly string[]).includes(def.id)
    ) {
      return "This internal id is reserved or invalid.";
    }
  }

  if (def.existingFields) {
    const dupe = def.existingFields.find(
      (f) =>
        f.id !== def.id &&
        f.status === "active" &&
        f.label.trim().toLowerCase() === labelClean.toLowerCase(),
    );
    if (dupe) {
      return "Another active field already uses this name.";
    }
  }

  if (isChoiceType(def.type)) {
    const liveOptions = (def.options ?? []).filter((o) => !o.archived);
    if (liveOptions.length === 0) {
      return "Add at least one option.";
    }
    if (liveOptions.some((o) => !o.label.trim())) {
      return "Options can't be blank.";
    }
    const optionLabels = liveOptions.map((o) => o.label.trim().toLowerCase());
    if (new Set(optionLabels).size !== optionLabels.length) {
      return "Two options have the same name.";
    }
  }

  if (def.visibility === "owner" && def.editable === "team") {
    return "Employees can't edit a field they can't see.";
  }

  if (def.defaultValue !== undefined && def.defaultValue !== null && def.defaultValue !== "") {
    const parsed = parseCustomFieldValue(
      {
        fieldType: def.type,
        options: def.options ?? [],
        currency: def.currency ?? null,
      },
      def.defaultValue,
    );
    if (!parsed.ok) {
      return `Default value: ${parsed.error}`;
    }
  }

  return null;
}

export function parseCustomFieldValue(
  def: {
    fieldType: FieldType;
    options: StoredOption[];
    currency: string | null;
  },
  raw: unknown,
): { ok: true; value: CustomFieldValue } | { ok: false; error: string } {
  if (def.fieldType === "checkbox") {
    if (raw === undefined || raw === null || raw === "") {
      return { ok: true, value: undefined };
    }
    return typeof raw === "boolean"
      ? { ok: true, value: raw }
      : { ok: false, error: "Choose yes or no." };
  }

  if (
    raw === undefined ||
    raw === null ||
    (typeof raw === "string" && raw.trim() === "") ||
    (Array.isArray(raw) && raw.length === 0)
  ) {
    return { ok: true, value: undefined };
  }

  const str = typeof raw === "string" ? raw.trim() : undefined;
  const liveOptions = new Set(def.options.filter((o) => !o.archived).map((o) => o.id));

  switch (def.fieldType) {
    case "text":
      return str !== undefined
        ? str.length <= 200
          ? { ok: true, value: str }
          : { ok: false, error: "Keep it under 200 characters." }
        : { ok: false, error: "Enter text." };

    case "longtext":
      return str !== undefined
        ? str.length <= 5000
          ? { ok: true, value: str }
          : { ok: false, error: "Keep it under 5,000 characters." }
        : { ok: false, error: "Enter text." };

    case "number": {
      const cleaned = str?.replace(/,/g, "");
      const num =
        typeof raw === "number"
          ? raw
          : cleaned !== undefined && /^-?\d+(?:\.\d+)?$/.test(cleaned)
            ? Number(cleaned)
            : Number.NaN;
      return Number.isFinite(num)
        ? { ok: true, value: num }
        : { ok: false, error: "Enter a number." };
    }

    case "currency": {
      let amount = Number.NaN;
      let currency = def.currency ?? "INR";
      if (typeof raw === "object" && raw !== null && "amount" in raw) {
        const rec = raw as { amount?: unknown; currency?: unknown };
        amount = typeof rec.amount === "number" ? rec.amount : Number.NaN;
        if (typeof rec.currency === "string" && rec.currency.trim()) {
          currency = rec.currency.trim();
        }
      } else if (typeof raw === "number") {
        amount = raw;
      } else if (str !== undefined) {
        const cleaned = str.replace(/[₹,\s]/g, "");
        if (/^\d+(?:\.\d{1,2})?$/.test(cleaned)) {
          amount = Number(cleaned);
        }
      }
      if (!Number.isFinite(amount) || amount < 0) {
        return { ok: false, error: "Enter an amount of zero or more." };
      }
      return {
        ok: true,
        value: { amount: Math.round(amount * 100) / 100, currency },
      };
    }

    case "date":
      return str !== undefined && isValidCalendarDay(str)
        ? { ok: true, value: str }
        : { ok: false, error: "Pick a valid date." };

    case "select":
      return str !== undefined && liveOptions.has(str)
        ? { ok: true, value: str }
        : { ok: false, error: "Pick one of the listed options." };

    case "multiselect": {
      if (!Array.isArray(raw) || raw.some((item) => typeof item !== "string")) {
        return { ok: false, error: "Pick from the listed options." };
      }
      const unique = [...new Set(raw as string[])];
      return unique.every((id) => liveOptions.has(id))
        ? { ok: true, value: unique }
        : { ok: false, error: "One of the chosen options no longer exists." };
    }

    case "url": {
      if (str === undefined || /\s/.test(str)) {
        return { ok: false, error: "Enter a web address." };
      }
      try {
        const u = new URL(/^https?:\/\//i.test(str) ? str : `https://${str}`);
        return (u.protocol === "https:" || u.protocol === "http:") && u.hostname.includes(".")
          ? { ok: true, value: u.toString() }
          : { ok: false, error: "Enter a valid web address." };
      } catch {
        return { ok: false, error: "Enter a valid web address." };
      }
    }

    case "email":
      return str !== undefined && CUSTOM_EMAIL_REGEX.test(str)
        ? { ok: true, value: str.toLowerCase() }
        : { ok: false, error: "Enter a valid email address." };

    case "phone": {
      const d = (str ?? "").replace(/[\s()-]/g, "");
      return /^\+?\d{7,15}$/.test(d)
        ? { ok: true, value: d }
        : { ok: false, error: "Enter 7–15 digits, optionally starting with +." };
    }

    default:
      return { ok: false, error: "Unsupported custom field type." };
  }
}

/**
 * Converts a stored field value to a new type if convertible without guessing.
 * Returns undefined if conversion cannot be performed cleanly.
 */
export function convertFieldValue(
  val: unknown,
  fromDef: { fieldType: FieldType; options: StoredOption[]; currency: string | null },
  toDef: { fieldType: FieldType; options: StoredOption[]; currency: string | null },
): unknown | undefined {
  if (val === undefined || val === null) return undefined;
  if (fromDef.fieldType === toDef.fieldType) return val;

  const text =
    fromDef.fieldType === "currency"
      ? typeof val === "object" && val !== null && "amount" in val
        ? String((val as MoneyValue).amount)
        : String(val)
      : fromDef.fieldType === "select"
        ? fromDef.options.find((o) => o.id === val)?.label
        : typeof val === "string" || typeof val === "number"
          ? String(val)
          : undefined;

  if (toDef.fieldType === "multiselect" && fromDef.fieldType === "select") {
    return toDef.options.some((o) => o.id === val && !o.archived) ? [val as string] : undefined;
  }

  if (toDef.fieldType === "select") {
    const match = toDef.options.find(
      (o) =>
        !o.archived && (o.id === val || (text && o.label.toLowerCase() === text.toLowerCase())),
    );
    return match?.id;
  }

  if (
    toDef.fieldType === "checkbox" ||
    fromDef.fieldType === "checkbox" ||
    fromDef.fieldType === "multiselect" ||
    text === undefined
  ) {
    return undefined;
  }

  const rawForTo =
    toDef.fieldType === "currency"
      ? Number(text)
      : toDef.fieldType === "number" && fromDef.fieldType === "currency"
        ? typeof val === "object" && val !== null && "amount" in val
          ? (val as MoneyValue).amount
          : Number(text)
        : text;

  const res = parseCustomFieldValue(toDef, rawForTo);
  return res.ok ? res.value : undefined;
}

const optionalTrimmedString = (max: number) =>
  z.preprocess(
    (v) =>
      v === null || (typeof v === "string" && v.trim() === "")
        ? undefined
        : typeof v === "string"
          ? v.trim()
          : v,
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
    z.string().max(max).nullable().optional(),
  );

export const fieldOptionSchema = z.object({
  id: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .optional()
    .transform((val) => val && val.length > 0 ? val : `opt_${Math.random().toString(36).slice(2, 10)}`),
  label: z.string().trim().min(1).max(120),
  archived: z.boolean().optional(),
});

export const createCustomFieldBodySchema = z.object({
  id: optionalTrimmedString(64),
  entity: z.enum(["lead", "project"]).default("lead"),
  label: z
    .string()
    .trim()
    .min(1, "Give the field a name.")
    .max(60, "Keep the name under 60 characters."),
  type: z.enum(FIELD_TYPES),
  description: nullableTrimmedString(255),
  required: z.boolean().default(false),
  defaultValue: z.unknown().optional(),
  options: z.array(fieldOptionSchema).optional(),
  order: z.number().int().min(0).default(0),
  highlight: z.boolean().default(false),
  visibility: z.enum(["team", "owner"]).default("team"),
  editable: z.enum(["team", "owner"]).default("team"),
  currency: optionalTrimmedString(8),
  idempotencyKey: optionalTrimmedString(128),
});

export type CreateCustomFieldInput = z.infer<typeof createCustomFieldBodySchema>;

export const updateCustomFieldBodySchema = z.object({
  label: z.string().trim().min(1).max(60).optional(),
  type: z.enum(FIELD_TYPES).optional(),
  description: nullableTrimmedString(255),
  required: z.boolean().optional(),
  defaultValue: z.unknown().optional(),
  options: z.array(fieldOptionSchema).optional(),
  order: z.number().int().min(0).optional(),
  highlight: z.boolean().optional(),
  visibility: z.enum(["team", "owner"]).optional(),
  editable: z.enum(["team", "owner"]).optional(),
  currency: optionalTrimmedString(8),
  expectedVersion: z.number().int().min(1).optional(),
});

export type UpdateCustomFieldInput = z.infer<typeof updateCustomFieldBodySchema>;

export const setLeadCustomFieldValuesBodySchema = z.object({
  values: z.record(z.string().trim().min(1).max(64), z.unknown()),
});

export type SetLeadCustomFieldValuesInput = z.infer<typeof setLeadCustomFieldValuesBodySchema>;

export const createTagBodySchema = z.object({
  id: optionalTrimmedString(64),
  name: z
    .string()
    .trim()
    .min(1, "Give the tag a name.")
    .max(32, "Keep tag names under 32 characters."),
  description: nullableTrimmedString(255),
  color: z.enum(TAG_COLORS).default("graphite"),
  scope: z.enum(TAG_SCOPES).default("lead"),
  idempotencyKey: optionalTrimmedString(128),
});

export type CreateTagInput = z.infer<typeof createTagBodySchema>;

export const updateTagBodySchema = z.object({
  name: z.string().trim().min(1).max(32).optional(),
  description: nullableTrimmedString(255),
  color: z.enum(TAG_COLORS).optional(),
  scope: z.enum(TAG_SCOPES).optional(),
  expectedVersion: z.number().int().min(1).optional(),
});

export type UpdateTagInput = z.infer<typeof updateTagBodySchema>;

export const addTagToLeadBodySchema = z.object({
  tagId: z.string().trim().min(1).max(64),
});

export type AddTagToLeadInput = z.infer<typeof addTagToLeadBodySchema>;

export const bulkTagLeadsBodySchema = z.object({
  leadIds: z.array(z.string().trim().min(1).max(64)).min(1, "Select at least one lead").max(200),
  tagId: z.string().trim().min(1).max(64),
  mode: z.enum(["add", "remove"]),
});

export type BulkTagLeadsInput = z.infer<typeof bulkTagLeadsBodySchema>;

export const viewConditionSchema = z.object({
  id: z.string().trim().min(1).max(64),
  field: z.string().trim().min(1).max(64),
  op: z.enum(FILTER_OPS),
  value: z.unknown().optional(),
});

export type ViewCondition = z.infer<typeof viewConditionSchema>;

export const viewFilterSchema = z.object({
  mode: z.enum(["and", "or"]).default("and"),
  conditions: z.array(viewConditionSchema).max(20, "Use at most 20 conditions."),
});

export type ViewFilter = z.infer<typeof viewFilterSchema>;

export const createSavedViewBodySchema = z.object({
  id: optionalTrimmedString(64),
  name: z.string().trim().min(1, "Name the view.").max(50, "Keep the name under 50 characters."),
  visibility: z.enum(VIEW_VISIBILITIES).default("company"),
  filter: viewFilterSchema,
  sort: z.enum(VIEW_SORTS).default("recent"),
  columns: z.array(z.string().trim().min(1).max(64)).max(50).optional(),
  isDefault: z.boolean().default(false),
  isPinned: z.boolean().default(false),
  idempotencyKey: optionalTrimmedString(128),
});

export type CreateSavedViewInput = z.infer<typeof createSavedViewBodySchema>;

export const updateSavedViewBodySchema = z.object({
  name: z.string().trim().min(1).max(50).optional(),
  visibility: z.enum(VIEW_VISIBILITIES).optional(),
  filter: viewFilterSchema.optional(),
  sort: z.enum(VIEW_SORTS).optional(),
  columns: z.array(z.string().trim().min(1).max(64)).max(50).optional(),
  isDefault: z.boolean().optional(),
  isPinned: z.boolean().optional(),
  expectedVersion: z.number().int().min(1).optional(),
});

export type UpdateSavedViewInput = z.infer<typeof updateSavedViewBodySchema>;
