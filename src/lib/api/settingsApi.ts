import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useResolvedAuthState } from "@/lib/auth/authClient";
import { apiRequest, createIdempotencyKey } from "./client";
import {
  DEFAULT_LEAD_SORTS_API,
  SETTINGS_AUDIT_SECTIONS_API,
  ownerSettingsGetResponseSchema,
  ownerSettingsUpdateResponseSchema,
  settingsAuditListResponseSchema,
  settingsDefinitionsResponseSchema,
  type DefaultLeadSortApi,
  type OwnerSettingsDto,
  type OwnerSettingsGetResponse,
  type OwnerSettingsUpdateResponse,
  type SettingsAuditListResponse,
  type SettingsAuditSectionApi,
  type SettingsDefinitionsResponse,
} from "./schemas";

export { createIdempotencyKey } from "./client";

// ---------------------------------------------------------------------------
// Constants & Pure Validation Helpers
// ---------------------------------------------------------------------------

export const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const BUSINESS_PHONE_REGEX = /^[+\d\s().-]{7,32}$/;
const SIMPLE_EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const DEFAULT_LEAD_SORT_LABELS: Record<DefaultLeadSortApi, string> = {
  recent: "Newest first",
  score: "Highest score",
  value: "Highest value",
};

export const SETTINGS_AUDIT_SECTION_LABELS: Record<SettingsAuditSectionApi, string> = {
  all: "All sections",
  profile: "Profile & Business",
  crm: "Regional & CRM",
  notifications: "Notifications & Alerts",
  mixed: "Multiple sections",
};

export const SETTINGS_FIELD_LABELS: Record<string, string> = {
  ownerDisplayName: "Owner display name",
  businessName: "Business name",
  profileEmail: "Business email",
  businessPhone: "Business phone",
  businessWebsite: "Website",
  businessAddress: "Business address",
  gstin: "GSTIN",
  paymentInstructions: "Payment instructions",
  businessTimezone: "Business timezone",
  currencyCode: "Currency",
  defaultLeadSort: "Default lead sort",
  notifyFollowUps: "Follow-up reminders",
  notifyPayments: "Payment alerts",
  notifyDigest: "Morning digest",
  notifyGoalAchieved: "Goal achieved alerts",
  notifyTeamGoal: "Team goal alerts",
  notifyMilestone: "Halfway milestone alerts",
  notifyOverdue: "Severe overdue alerts",
  overdueThreshold: "Overdue threshold",
};

export interface SettingsFormDraft {
  ownerDisplayName: string;
  businessName: string;
  profileEmail: string;
  businessPhone: string;
  businessWebsite: string;
  businessAddress: string;
  gstin: string;
  paymentInstructions: string;
  defaultLeadSort: DefaultLeadSortApi;
  notifyFollowUps: boolean;
  notifyPayments: boolean;
  notifyDigest: boolean;
  notifyGoalAchieved: boolean;
  notifyTeamGoal: boolean;
  notifyMilestone: boolean;
  notifyOverdue: boolean;
  overdueThreshold: string;
}

export function dtoToSettingsDraft(dto: OwnerSettingsDto): SettingsFormDraft {
  return {
    ownerDisplayName: dto.ownerDisplayName ?? "",
    businessName: dto.businessName ?? "",
    profileEmail: dto.profileEmail ?? "",
    businessPhone: dto.businessPhone ?? "",
    businessWebsite: dto.businessWebsite ?? "",
    businessAddress: dto.businessAddress ?? "",
    gstin: dto.gstin ?? "",
    paymentInstructions: dto.paymentInstructions ?? "",
    defaultLeadSort: dto.defaultLeadSort,
    notifyFollowUps: dto.notifyFollowUps,
    notifyPayments: dto.notifyPayments,
    notifyDigest: dto.notifyDigest,
    notifyGoalAchieved: dto.notifyGoalAchieved,
    notifyTeamGoal: dto.notifyTeamGoal,
    notifyMilestone: dto.notifyMilestone,
    notifyOverdue: dto.notifyOverdue,
    overdueThreshold: String(dto.overdueThreshold),
  };
}

/**
 * Normalizes blank form strings to `null` so cleared optional profile fields
 * explicitly send `null` to B6A instead of invalid empty strings `""`.
 */
export function normalizeNullableTextInput(
  raw: string,
  options?: { multiline?: boolean },
): string | null {
  const normalized = options?.multiline ? raw.replace(/\r\n?/g, "\n").trim() : raw.trim();
  return normalized.length === 0 ? null : normalized;
}

function hasDisallowedControlChars(value: string, allowNewlines: boolean): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code === 0x7f) return true;
    if (code <= 0x1f) {
      if (allowNewlines && (code === 0x09 || code === 0x0a || code === 0x0d)) continue;
      return true;
    }
  }
  return false;
}

function isValidHttpWebsiteUrl(raw: string): boolean {
  if (/\s/.test(raw)) return false;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  if (!parsed.hostname || !parsed.hostname.includes(".")) return false;
  if (parsed.username || parsed.password) return false;
  return true;
}

function isValidPhoneText(raw: string): boolean {
  if (!BUSINESS_PHONE_REGEX.test(raw)) return false;
  const digits = raw.replace(/\D/g, "");
  return digits.length >= 7 && digits.length <= 15;
}

export function clientValidateSettingsField(
  field: keyof SettingsFormDraft,
  draft: SettingsFormDraft,
): string | null {
  switch (field) {
    case "ownerDisplayName": {
      const v = normalizeNullableTextInput(draft.ownerDisplayName);
      if (v === null) return null;
      if (v.length > 120) return "Owner display name must be 120 characters or fewer.";
      if (hasDisallowedControlChars(v, false)) {
        return "Owner display name contains invalid control characters.";
      }
      return null;
    }
    case "businessName": {
      const v = normalizeNullableTextInput(draft.businessName);
      if (v === null) return null;
      if (v.length > 160) return "Business name must be 160 characters or fewer.";
      if (hasDisallowedControlChars(v, false)) {
        return "Business name contains invalid control characters.";
      }
      return null;
    }
    case "profileEmail": {
      const v = normalizeNullableTextInput(draft.profileEmail);
      if (v === null) return null;
      const lower = v.toLowerCase();
      if (lower.length > 191) return "Profile email must be 191 characters or fewer.";
      if (!SIMPLE_EMAIL_REGEX.test(lower)) return "Enter a valid email address.";
      return null;
    }
    case "businessPhone": {
      const v = normalizeNullableTextInput(draft.businessPhone);
      if (v === null) return null;
      if (hasDisallowedControlChars(v, false) || !isValidPhoneText(v)) {
        return "Enter a valid business phone number (7 to 15 digits).";
      }
      return null;
    }
    case "businessWebsite": {
      const v = normalizeNullableTextInput(draft.businessWebsite);
      if (v === null) return null;
      if (v.length > 255 || hasDisallowedControlChars(v, false)) {
        return "Website URL must be 255 characters or fewer.";
      }
      if (!isValidHttpWebsiteUrl(v)) {
        return "Enter a valid http:// or https:// website URL without embedded credentials.";
      }
      return null;
    }
    case "businessAddress": {
      const v = normalizeNullableTextInput(draft.businessAddress, { multiline: true });
      if (v === null) return null;
      if (v.length > 1000) return "Business address must be 1000 characters or fewer.";
      if (hasDisallowedControlChars(v, true)) {
        return "Business address contains invalid control characters.";
      }
      return null;
    }
    case "gstin": {
      const v = normalizeNullableTextInput(draft.gstin);
      if (v === null) return null;
      const upper = v.toUpperCase();
      if (!GSTIN_REGEX.test(upper)) {
        return "Enter a valid 15-character Indian GSTIN (e.g. 27ABCDE1234F1Z5).";
      }
      return null;
    }
    case "paymentInstructions": {
      const v = normalizeNullableTextInput(draft.paymentInstructions, { multiline: true });
      if (v === null) return null;
      if (v.length > 2000) return "Payment instructions must be 2000 characters or fewer.";
      if (hasDisallowedControlChars(v, true)) {
        return "Payment instructions contain invalid control characters.";
      }
      return null;
    }
    case "defaultLeadSort": {
      if (!DEFAULT_LEAD_SORTS_API.includes(draft.defaultLeadSort)) {
        return "Choose a valid lead sort option.";
      }
      return null;
    }
    case "overdueThreshold": {
      const trimmed = draft.overdueThreshold.trim();
      if (!/^\d+$/.test(trimmed)) {
        return "Overdue threshold must be a whole number between 1 and 1000.";
      }
      const n = Number(trimmed);
      if (!Number.isInteger(n) || n < 1 || n > 1000) {
        return "Overdue threshold must be between 1 and 1000.";
      }
      return null;
    }
    default:
      return null;
  }
}

export function clientValidateSettingsDraft(draft: SettingsFormDraft): Record<string, string> {
  const fields: (keyof SettingsFormDraft)[] = [
    "ownerDisplayName",
    "businessName",
    "profileEmail",
    "businessPhone",
    "businessWebsite",
    "businessAddress",
    "gstin",
    "paymentInstructions",
    "defaultLeadSort",
    "overdueThreshold",
  ];
  const errors: Record<string, string> = {};
  for (const field of fields) {
    const msg = clientValidateSettingsField(field, draft);
    if (msg) errors[field] = msg;
  }
  return errors;
}

export interface UpdateOwnerSettingsPayload {
  ownerDisplayName?: string | null | undefined;
  businessName?: string | null | undefined;
  profileEmail?: string | null | undefined;
  businessPhone?: string | null | undefined;
  businessWebsite?: string | null | undefined;
  businessAddress?: string | null | undefined;
  gstin?: string | null | undefined;
  paymentInstructions?: string | null | undefined;
  businessTimezone?: "Asia/Kolkata" | undefined;
  currencyCode?: "INR" | undefined;
  defaultLeadSort?: DefaultLeadSortApi | undefined;
  notifyFollowUps?: boolean | undefined;
  notifyPayments?: boolean | undefined;
  notifyDigest?: boolean | undefined;
  notifyGoalAchieved?: boolean | undefined;
  notifyTeamGoal?: boolean | undefined;
  notifyMilestone?: boolean | undefined;
  notifyOverdue?: boolean | undefined;
  overdueThreshold?: number | undefined;
  expectedVersion?: number | undefined;
  idempotencyKey?: string | undefined;
}

export function buildSettingsDiffPayload(
  baseline: OwnerSettingsDto,
  draft: SettingsFormDraft,
): { hasChanges: boolean; changedKeys: string[]; payload: UpdateOwnerSettingsPayload } {
  const payload: UpdateOwnerSettingsPayload = {};
  const changedKeys: string[] = [];

  const nextDisplay = normalizeNullableTextInput(draft.ownerDisplayName);
  if (nextDisplay !== baseline.ownerDisplayName) {
    payload.ownerDisplayName = nextDisplay;
    changedKeys.push("ownerDisplayName");
  }

  const nextBusiness = normalizeNullableTextInput(draft.businessName);
  if (nextBusiness !== baseline.businessName) {
    payload.businessName = nextBusiness;
    changedKeys.push("businessName");
  }

  const rawEmail = normalizeNullableTextInput(draft.profileEmail);
  const nextEmail = rawEmail ? rawEmail.toLowerCase() : null;
  if (nextEmail !== baseline.profileEmail) {
    payload.profileEmail = nextEmail;
    changedKeys.push("profileEmail");
  }

  const nextPhone = normalizeNullableTextInput(draft.businessPhone);
  if (nextPhone !== baseline.businessPhone) {
    payload.businessPhone = nextPhone;
    changedKeys.push("businessPhone");
  }

  const nextWebsite = normalizeNullableTextInput(draft.businessWebsite);
  if (nextWebsite !== baseline.businessWebsite) {
    payload.businessWebsite = nextWebsite;
    changedKeys.push("businessWebsite");
  }

  const nextAddress = normalizeNullableTextInput(draft.businessAddress, { multiline: true });
  if (nextAddress !== baseline.businessAddress) {
    payload.businessAddress = nextAddress;
    changedKeys.push("businessAddress");
  }

  const rawGstin = normalizeNullableTextInput(draft.gstin);
  const nextGstin = rawGstin ? rawGstin.toUpperCase() : null;
  if (nextGstin !== baseline.gstin) {
    payload.gstin = nextGstin;
    changedKeys.push("gstin");
  }

  const nextPayment = normalizeNullableTextInput(draft.paymentInstructions, { multiline: true });
  if (nextPayment !== baseline.paymentInstructions) {
    payload.paymentInstructions = nextPayment;
    changedKeys.push("paymentInstructions");
  }

  if (draft.defaultLeadSort !== baseline.defaultLeadSort) {
    payload.defaultLeadSort = draft.defaultLeadSort;
    changedKeys.push("defaultLeadSort");
  }

  const booleanFields = [
    "notifyFollowUps",
    "notifyPayments",
    "notifyDigest",
    "notifyGoalAchieved",
    "notifyTeamGoal",
    "notifyMilestone",
    "notifyOverdue",
  ] as const;

  for (const key of booleanFields) {
    if (draft[key] !== baseline[key]) {
      payload[key] = draft[key];
      changedKeys.push(key);
    }
  }

  const thresholdNum = Number(draft.overdueThreshold.trim());
  if (Number.isInteger(thresholdNum) && thresholdNum !== baseline.overdueThreshold) {
    payload.overdueThreshold = thresholdNum;
    changedKeys.push("overdueThreshold");
  }

  return {
    hasChanges: changedKeys.length > 0,
    changedKeys,
    payload,
  };
}

// ---------------------------------------------------------------------------
// Query Keys (Owner-Session Isolated)
// ---------------------------------------------------------------------------

export interface SettingsAuditFilters {
  section?: SettingsAuditSectionApi | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
}

export const settingsKeys = {
  root: ["crm", "settings"] as const,
  byOwner: (ownerId: string | null | undefined) =>
    [...settingsKeys.root, ownerId ?? "anonymous"] as const,
  current: (ownerId: string | null | undefined) =>
    [...settingsKeys.byOwner(ownerId), "current"] as const,
  definitions: (ownerId: string | null | undefined) =>
    [...settingsKeys.byOwner(ownerId), "definitions"] as const,
  auditRoot: (ownerId: string | null | undefined) =>
    [...settingsKeys.byOwner(ownerId), "audit"] as const,
  audit: (ownerId: string | null | undefined, filters: SettingsAuditFilters = {}) =>
    [...settingsKeys.auditRoot(ownerId), filters] as const,
};

// ---------------------------------------------------------------------------
// API Client Functions
// ---------------------------------------------------------------------------

export async function getOwnerSettings(options?: {
  signal?: AbortSignal;
}): Promise<OwnerSettingsGetResponse> {
  return apiRequest({
    path: "/api/v1/settings",
    method: "GET",
    schema: ownerSettingsGetResponseSchema,
    ...(options?.signal ? { signal: options.signal } : {}),
  });
}

export async function updateOwnerSettings(
  payload: UpdateOwnerSettingsPayload,
  options?: { method?: "PUT" | "PATCH" | undefined; idempotencyKey?: string | undefined },
): Promise<OwnerSettingsUpdateResponse> {
  const idempotencyKey =
    options?.idempotencyKey ?? payload.idempotencyKey ?? createIdempotencyKey();
  return apiRequest({
    path: "/api/v1/settings",
    method: options?.method ?? "PATCH",
    idempotencyKey,
    body: { ...payload, idempotencyKey },
    schema: ownerSettingsUpdateResponseSchema,
  });
}

export async function getSettingsDefinitions(options?: {
  signal?: AbortSignal;
}): Promise<SettingsDefinitionsResponse> {
  return apiRequest({
    path: "/api/v1/settings/definitions",
    method: "GET",
    schema: settingsDefinitionsResponseSchema,
    ...(options?.signal ? { signal: options.signal } : {}),
  });
}

export async function listSettingsAudit(
  filters: SettingsAuditFilters = {},
  options?: { signal?: AbortSignal },
): Promise<SettingsAuditListResponse> {
  return apiRequest({
    path: "/api/v1/settings/audit",
    method: "GET",
    query: {
      section: filters.section ?? "all",
      limit: filters.limit,
      offset: filters.offset,
    },
    schema: settingsAuditListResponseSchema,
    ...(options?.signal ? { signal: options.signal } : {}),
  });
}

// ---------------------------------------------------------------------------
// React Query Hooks
// ---------------------------------------------------------------------------

export function useOwnerSettingsQuery(enabled = true) {
  const { status, user } = useResolvedAuthState();
  const ownerId = user?.id;
  return useQuery({
    queryKey: settingsKeys.current(ownerId),
    queryFn: ({ signal }) => getOwnerSettings({ signal }),
    enabled: enabled && status === "authenticated",
    staleTime: 10_000,
    retry: false,
  });
}

export function useSettingsDefinitionsQuery(enabled = true) {
  const { status, user } = useResolvedAuthState();
  const ownerId = user?.id;
  return useQuery({
    queryKey: settingsKeys.definitions(ownerId),
    queryFn: ({ signal }) => getSettingsDefinitions({ signal }),
    enabled: enabled && status === "authenticated",
    staleTime: 60_000,
    retry: false,
  });
}

export function useSettingsAuditQuery(filters: SettingsAuditFilters = {}, enabled = true) {
  const { status, user } = useResolvedAuthState();
  const ownerId = user?.id;
  return useQuery({
    queryKey: settingsKeys.audit(ownerId, filters),
    queryFn: ({ signal }) => listSettingsAudit(filters, { signal }),
    enabled: enabled && status === "authenticated",
    staleTime: 10_000,
    retry: false,
  });
}

export function useUpdateOwnerSettingsMutation() {
  const queryClient = useQueryClient();
  const { user } = useResolvedAuthState();
  const ownerId = user?.id;

  return useMutation({
    mutationFn: ({
      payload,
      method,
      idempotencyKey,
    }: {
      payload: UpdateOwnerSettingsPayload;
      method?: "PUT" | "PATCH" | undefined;
      idempotencyKey?: string | undefined;
    }) => updateOwnerSettings(payload, { method, idempotencyKey }),
    onSuccess: (data) => {
      queryClient.setQueryData<OwnerSettingsGetResponse>(settingsKeys.current(ownerId), {
        ok: true,
        settings: data.settings,
      });
      void queryClient.invalidateQueries({ queryKey: settingsKeys.current(ownerId) });
      if (data.changed) {
        void queryClient.invalidateQueries({ queryKey: settingsKeys.auditRoot(ownerId) });
      }
    },
  });
}
