import "@tanstack/react-start/server-only";

export type CrmErrorCode =
  | "validation_error"
  | "activity_type_not_permitted"
  | "not_found"
  | "duplicate_lead"
  | "duplicate_deal"
  | "stale_conflict"
  | "followup_conflict"
  | "followup_already_closed"
  | "call_op_conflict"
  | "call_conflict"
  | "whatsapp_op_conflict"
  | "whatsapp_conflict"
  | "deal_op_conflict"
  | "deal_cancelled"
  | "deal_already_cancelled"
  | "deal_amount_below_collected"
  | "deal_won_date_already_set"
  | "payment_op_conflict"
  | "overpayment"
  | "payment_already_voided"
  | "lead_archived"
  | "lead_already_archived"
  | "lead_not_archived"
  | "proof_already_exists"
  | "proof_not_found"
  | "invalid_file_type"
  | "file_too_large"
  | "empty_file"
  | "file_corrupted"
  | "storage_error"
  | "duplicate_quotation"
  | "quotation_not_found"
  | "deal_not_found"
  | "lead_not_found"
  | "project_not_found"
  | "project_already_active"
  | "milestone_not_found"
  | "task_not_found"
  | "deliverable_not_found"
  | "ticket_not_found"
  | "template_not_found"
  | "invalid_dates"
  | "secret_detected"
  | "delivery_unrecorded"
  | "delivery_error"
  | "already_delivered"
  | "support_error"
  | "empty_note"
  | "item_not_found"
  | "dependency_not_found"
  | "resolution_required"
  | "idempotency_key_mismatch"
  | "goal_not_found"
  | "goal_archived"
  | "goal_already_archived"
  | "forbidden_setting_key"
  | "unsupported_metric"
  | "crm_unavailable";

export interface CrmErrorPayload {
  code: CrmErrorCode;
  message: string;
  details?: Record<string, unknown>;
  conflict?: Record<string, unknown>;
}

export class CrmServiceError extends Error {
  readonly status: 400 | 403 | 404 | 409 | 500 | 503;
  readonly code: CrmErrorCode;
  readonly details: Record<string, unknown> | undefined;
  readonly conflict: Record<string, unknown> | undefined;

  constructor(
    status: 400 | 403 | 404 | 409 | 500 | 503,
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
