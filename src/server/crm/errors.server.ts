import "@tanstack/react-start/server-only";

export type CrmErrorCode =
  | "validation_error"
  | "activity_type_not_permitted"
  | "not_found"
  | "duplicate_lead"
  | "stale_conflict"
  | "followup_conflict"
  | "followup_already_closed"
  | "call_op_conflict"
  | "call_conflict"
  | "whatsapp_op_conflict"
  | "whatsapp_conflict"
  | "lead_archived"
  | "lead_already_archived"
  | "lead_not_archived"
  | "idempotency_key_mismatch"
  | "crm_unavailable";

export interface CrmErrorPayload {
  code: CrmErrorCode;
  message: string;
  details?: Record<string, unknown>;
  conflict?: Record<string, unknown>;
}

export class CrmServiceError extends Error {
  readonly status: 400 | 403 | 404 | 409 | 503;
  readonly code: CrmErrorCode;
  readonly details: Record<string, unknown> | undefined;
  readonly conflict: Record<string, unknown> | undefined;

  constructor(
    status: 400 | 403 | 404 | 409 | 503,
    code: CrmErrorCode,
    message: string,
    options?: {
      details?: Record<string, unknown>;
      conflict?: Record<string, unknown>;
    },
  ) {
    super(message);
    this.name = "CrmServiceError";
    this.status = status;
    this.code = code;
    this.details = options?.details;
    this.conflict = options?.conflict;
  }

  toResponseBody(): { ok: false; error: CrmErrorPayload } {
    return {
      ok: false,
      error: {
        code: this.code,
        message: this.message,
        ...(this.details ? { details: this.details } : {}),
        ...(this.conflict ? { conflict: this.conflict } : {}),
      },
    };
  }
}

export function isMysqlDuplicateKeyError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { code?: unknown; errno?: unknown; cause?: unknown };
  if (e.code === "ER_DUP_ENTRY" || e.errno === 1062) return true;
  if (e.cause && typeof e.cause === "object") {
    return isMysqlDuplicateKeyError(e.cause);
  }
  return false;
}
