import {
  apiErrorEnvelopeSchema,
  duplicateLeadConflictSchema,
  followupConflictSchema,
  staleConflictSchema,
  type DuplicateLeadConflict,
  type FollowUpConflictInfo,
  type StaleConflict,
} from "./schemas";

export interface ApiErrorOptions {
  status: number;
  code: string;
  message: string;
  details?: Record<string, unknown> | undefined;
  conflict?: Record<string, unknown> | undefined;
  retryAfterSeconds?: number | undefined;
  cause?: unknown;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: Record<string, unknown> | undefined;
  readonly conflict: Record<string, unknown> | undefined;
  readonly retryAfterSeconds: number | undefined;

  constructor(opts: ApiErrorOptions) {
    super(opts.message, opts.cause !== undefined ? { cause: opts.cause } : undefined);
    this.name = "ApiError";
    this.status = opts.status;
    this.code = opts.code;
    this.details = opts.details;
    this.conflict = opts.conflict;
    this.retryAfterSeconds = opts.retryAfterSeconds;
  }

  get isAuthError(): boolean {
    return this.status === 401;
  }

  get isForbiddenError(): boolean {
    return this.status === 403;
  }

  get isConflictError(): boolean {
    return this.status === 409;
  }

  get isUnavailableError(): boolean {
    return (
      this.status === 503 ||
      this.status === 0 ||
      this.code === "crm_unavailable" ||
      this.code === "auth_unavailable"
    );
  }

  get isRetryableTransient(): boolean {
    return (
      this.status === 0 ||
      this.status === 502 ||
      this.status === 503 ||
      this.status === 504 ||
      this.code === "network_error" ||
      this.code === "timeout_error"
    );
  }
}

export function isApiError(value: unknown): value is ApiError {
  return value instanceof ApiError;
}

export async function parseApiErrorResponse(response: Response): Promise<ApiError> {
  const retryAfterHeader = response.headers.get("retry-after");
  const retryAfterParsed = retryAfterHeader ? Number(retryAfterHeader) : undefined;
  const fallbackRetryAfter =
    retryAfterParsed !== undefined && Number.isFinite(retryAfterParsed)
      ? retryAfterParsed
      : undefined;

  let rawBody: unknown = null;
  try {
    rawBody = await response.json();
  } catch {
    rawBody = null;
  }

  const envelope = apiErrorEnvelopeSchema.safeParse(rawBody);
  if (envelope.success) {
    const err = envelope.data.error;
    return new ApiError({
      status: response.status,
      code: err.code,
      message: err.message,
      details: err.details,
      conflict: err.conflict,
      retryAfterSeconds: err.retryAfterSeconds ?? fallbackRetryAfter,
    });
  }

  if (response.status === 401) {
    return new ApiError({
      status: 401,
      code: "unauthenticated",
      message: "Your session expired. Sign in again to continue.",
    });
  }
  if (response.status === 403) {
    return new ApiError({
      status: 403,
      code: "forbidden",
      message: "Request was blocked by origin/CSRF policy.",
    });
  }
  if (response.status === 503) {
    return new ApiError({
      status: 503,
      code: "crm_unavailable",
      message: "Database service is temporarily unavailable. Your changes were not saved.",
    });
  }

  return new ApiError({
    status: response.status,
    code: `http_${response.status}`,
    message: `Server returned an unexpected error (${response.status}).`,
  });
}

export function extractDuplicateLeadConflict(error: unknown): DuplicateLeadConflict | null {
  if (!isApiError(error) || error.code !== "duplicate_lead" || !error.conflict) {
    return null;
  }
  const parsed = duplicateLeadConflictSchema.safeParse(error.conflict);
  return parsed.success ? parsed.data : null;
}

export function extractStaleConflict(error: unknown): StaleConflict | null {
  if (!isApiError(error) || error.code !== "stale_conflict" || !error.conflict) {
    return null;
  }
  const parsed = staleConflictSchema.safeParse(error.conflict);
  return parsed.success ? parsed.data : null;
}

export function extractFollowUpConflict(error: unknown): FollowUpConflictInfo | null {
  if (
    !isApiError(error) ||
    (error.code !== "followup_conflict" && error.code !== "stale_conflict") ||
    !error.conflict
  ) {
    return null;
  }
  const parsed = followupConflictSchema.safeParse(error.conflict);
  return parsed.success ? parsed.data : null;
}

export function extractFieldValidationErrors(error: unknown): Record<string, string> {
  if (!isApiError(error) || error.code !== "validation_error" || !error.details) {
    return {};
  }
  const out: Record<string, string> = {};
  for (const [key, val] of Object.entries(error.details)) {
    if (typeof val === "string" && val.trim()) {
      out[key] = val;
    }
  }
  return out;
}

export function extractSettingsOrGoalFieldErrors(error: unknown): Record<string, string> {
  if (!isApiError(error) || !error.details) {
    return {};
  }
  if (
    error.code !== "validation_error" &&
    error.code !== "secret_detected" &&
    error.code !== "unsupported_metric" &&
    error.code !== "forbidden_setting_key"
  ) {
    return {};
  }
  const out: Record<string, string> = {};
  for (const [key, val] of Object.entries(error.details)) {
    if (typeof val === "string" && val.trim()) {
      out[key] = val;
    }
  }
  return out;
}

export function extractForbiddenSettingKey(error: unknown): string | null {
  if (!isApiError(error) || error.code !== "forbidden_setting_key" || !error.details) {
    return null;
  }
  const key = error.details["key"];
  return typeof key === "string" && key.trim() ? key.trim() : null;
}

export function isArchivedGoalError(error: unknown): boolean {
  return (
    isApiError(error) && (error.code === "goal_archived" || error.code === "goal_already_archived")
  );
}

export function formatApiErrorMessage(
  error: unknown,
  fallback = "Could not complete request. Nothing was saved.",
): string {
  if (isApiError(error)) {
    if (error.status === 507 || error.code === "storage_quota_exceeded") {
      const used =
        typeof error.details?.["usedMiB"] === "number" ? error.details["usedMiB"] : undefined;
      const quota =
        typeof error.details?.["quotaMiB"] === "number" ? error.details["quotaMiB"] : undefined;
      const usageSummary =
        used !== undefined && quota !== undefined ? ` (${used} MiB / ${quota} MiB used)` : "";
      return `Payment proof storage limit reached${usageSummary}. New receipt uploads are paused to protect CRM database stability; existing proofs and payment recording continue working.`;
    }
    if (error.code === "storage_capacity_unavailable") {
      return "Unable to verify payment proof storage capacity safely right now. Proof uploads are temporarily paused while payment records remain unaffected.";
    }
    if (
      error.status === 503 ||
      error.code === "crm_unavailable" ||
      error.code === "auth_unavailable"
    ) {
      return "CRM database is unavailable right now. Your input is still here — try again once connected.";
    }
    if (error.code === "network_error") {
      return "Unable to reach the CRM server. Check your connection and try again.";
    }
    if (error.code === "timeout_error") {
      return "Request timed out before the server responded. Nothing was committed.";
    }
    return error.message || fallback;
  }
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return fallback;
}
