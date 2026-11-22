import "@tanstack/react-start/server-only";

export type OperationalLogLevel = "INFO" | "WARN" | "ERROR";

export interface OperationalLogRecord {
  timestamp: string;
  level: OperationalLogLevel;
  message: string;
  event: string;
  service: "scale-flow-crm-v2";
  meta?: Record<string, unknown>;
}

export interface SanitizedErrorSummary {
  timestamp: string;
  event: string;
  code: string;
  path: string;
  status: number;
}

export interface MonitoringCountersSnapshot {
  startedAt: string;
  uptimeSeconds: number;
  unhandledErrorsTotal: number;
  lastUnhandledErrorAt: string | null;
  lastUnhandledErrorCode: string | null;
  proofUploadFailuresTotal: number;
  lastProofUploadFailureAt: string | null;
  lastProofUploadFailureCode: string | null;
  authFailuresTotal: number;
  lastAuthFailureAt: string | null;
  lastAuthFailureReason: string | null;
  dbConnectivityFailuresTotal: number;
  lastDbFailureAt: string | null;
  recentErrors: SanitizedErrorSummary[];
}

const SENSITIVE_KEY_PATTERN =
  /pass(word)?|secret|token|cookie|auth(orization)?|api[_-]?key|dsn|database_url|private[_-]?key|session[_-]?hash|credential/i;

const MAX_RECENT_ERRORS = 20;

const processStartedAtMs = Date.now();
const processStartedAtIso = new Date(processStartedAtMs).toISOString();

let unhandledErrorsTotal = 0;
let lastUnhandledErrorAt: string | null = null;
let lastUnhandledErrorCode: string | null = null;

let proofUploadFailuresTotal = 0;
let lastProofUploadFailureAt: string | null = null;
let lastProofUploadFailureCode: string | null = null;

let authFailuresTotal = 0;
let lastAuthFailureAt: string | null = null;
let lastAuthFailureReason: string | null = null;

let dbConnectivityFailuresTotal = 0;
let lastDbFailureAt: string | null = null;

const recentErrors: SanitizedErrorSummary[] = [];

/**
 * Recursively strips secret/credential keys and truncates long strings so
 * runtime logs never leak passwords, cookies, DSNs, or customer PII.
 */
export function sanitizeLogMeta(value: unknown, depth = 0): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const out: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      out[key] = "[REDACTED]";
      continue;
    }
    if (raw === null || raw === undefined) {
      out[key] = raw;
    } else if (typeof raw === "number" || typeof raw === "boolean") {
      out[key] = raw;
    } else if (typeof raw === "string") {
      // Mask inline DSNs or bearer tokens if accidentally included
      const scrubbed = raw
        .replace(/mysql:\/\/[^\s]+/gi, "mysql://[REDACTED]")
        .replace(/Bearer\s+[^\s]+/gi, "Bearer [REDACTED]");
      out[key] = scrubbed.length > 240 ? `${scrubbed.slice(0, 240)}…` : scrubbed;
    } else if (depth < 2 && typeof raw === "object" && !Array.isArray(raw)) {
      out[key] = sanitizeLogMeta(raw, depth + 1);
    } else {
      out[key] = "[OBJECT]";
    }
  }
  return out;
}

function pushRecentError(summary: SanitizedErrorSummary): void {
  recentErrors.unshift(summary);
  if (recentErrors.length > MAX_RECENT_ERRORS) {
    recentErrors.length = MAX_RECENT_ERRORS;
  }
}

/**
 * Emits single-line JSON compatible with Hostinger `hosting_nodejs_runtime-logs`
 * (requires `timestamp`, `level`, and `message` top-level JSON fields).
 */
export function logOperationalEvent(
  level: OperationalLogLevel,
  event: string,
  message: string,
  meta?: Record<string, unknown>,
  now: Date = new Date(),
): OperationalLogRecord {
  const safeMeta = sanitizeLogMeta(meta);
  const record: OperationalLogRecord = {
    timestamp: now.toISOString(),
    level,
    message,
    event,
    service: "scale-flow-crm-v2",
    ...(safeMeta && Object.keys(safeMeta).length > 0 ? { meta: safeMeta } : {}),
  };

  const line = JSON.stringify(record);
  if (level === "ERROR") {
    console.error(line);
  } else if (level === "WARN") {
    console.warn(line);
  } else {
    console.log(line);
  }
  return record;
}

export function recordUnhandledApiError(params: {
  path: string;
  method: string;
  code?: string;
  status?: number;
  error?: unknown;
  now?: Date;
}): void {
  const now = params.now ?? new Date();
  const code = params.code ?? "internal_error";
  const status = params.status ?? 500;
  const errName = params.error instanceof Error ? params.error.name : typeof params.error;

  unhandledErrorsTotal += 1;
  lastUnhandledErrorAt = now.toISOString();
  lastUnhandledErrorCode = code;

  pushRecentError({
    timestamp: now.toISOString(),
    event: "api_unhandled_error",
    code,
    path: params.path,
    status,
  });

  logOperationalEvent(
    "ERROR",
    "api_unhandled_error",
    `Unhandled API error (${status}) on ${params.method} ${params.path}`,
    {
      method: params.method,
      path: params.path,
      status,
      code,
      errorType: errName,
    },
    now,
  );
}

export function recordProofUploadFailure(params: {
  path: string;
  code: string;
  status: number;
  now?: Date;
}): void {
  const now = params.now ?? new Date();
  proofUploadFailuresTotal += 1;
  lastProofUploadFailureAt = now.toISOString();
  lastProofUploadFailureCode = params.code;

  pushRecentError({
    timestamp: now.toISOString(),
    event: "proof_upload_failed",
    code: params.code,
    path: params.path,
    status: params.status,
  });

  const level: OperationalLogLevel = params.status >= 500 ? "ERROR" : "WARN";
  logOperationalEvent(
    level,
    "proof_upload_failed",
    `Payment proof operation failed (${params.status} ${params.code})`,
    {
      path: params.path,
      code: params.code,
      status: params.status,
    },
    now,
  );
}

export function recordAuthFailure(params: {
  event: "auth_login_failed" | "auth_session_rejected" | "auth_unavailable";
  reason: string;
  status: number;
  path: string;
  ipPrefix?: string;
  now?: Date;
}): void {
  const now = params.now ?? new Date();
  authFailuresTotal += 1;
  lastAuthFailureAt = now.toISOString();
  lastAuthFailureReason = params.reason;

  if (params.status >= 500 || params.reason === "rate_limited") {
    pushRecentError({
      timestamp: now.toISOString(),
      event: params.event,
      code: params.reason,
      path: params.path,
      status: params.status,
    });
  }

  const level: OperationalLogLevel = params.status >= 500 ? "ERROR" : "WARN";
  logOperationalEvent(
    level,
    params.event,
    `Auth event ${params.event} (${params.reason})`,
    {
      reason: params.reason,
      status: params.status,
      path: params.path,
      ...(params.ipPrefix ? { ipPrefix: params.ipPrefix } : {}),
    },
    now,
  );
}

export function recordDbConnectivityFailure(params: { reason: string; now?: Date }): void {
  const now = params.now ?? new Date();
  dbConnectivityFailuresTotal += 1;
  lastDbFailureAt = now.toISOString();

  pushRecentError({
    timestamp: now.toISOString(),
    event: "db_connectivity_failed",
    code: "db_unreachable",
    path: "/api/v1/monitoring/summary",
    status: 503,
  });

  logOperationalEvent(
    "ERROR",
    "db_connectivity_failed",
    `Database connectivity check failed: ${params.reason}`,
    { reason: params.reason },
    now,
  );
}

export function getMonitoringCountersSnapshot(now: Date = new Date()): MonitoringCountersSnapshot {
  const uptimeSeconds = Math.max(0, Math.floor((now.getTime() - processStartedAtMs) / 1000));
  return {
    startedAt: processStartedAtIso,
    uptimeSeconds,
    unhandledErrorsTotal,
    lastUnhandledErrorAt,
    lastUnhandledErrorCode,
    proofUploadFailuresTotal,
    lastProofUploadFailureAt,
    lastProofUploadFailureCode,
    authFailuresTotal,
    lastAuthFailureAt,
    lastAuthFailureReason,
    dbConnectivityFailuresTotal,
    lastDbFailureAt,
    recentErrors: [...recentErrors],
  };
}

/** Test-only helper to reset in-process counters between test cases. */
export function resetMonitoringTelemetryForTests(): void {
  unhandledErrorsTotal = 0;
  lastUnhandledErrorAt = null;
  lastUnhandledErrorCode = null;
  proofUploadFailuresTotal = 0;
  lastProofUploadFailureAt = null;
  lastProofUploadFailureCode = null;
  authFailuresTotal = 0;
  lastAuthFailureAt = null;
  lastAuthFailureReason = null;
  dbConnectivityFailuresTotal = 0;
  lastDbFailureAt = null;
  recentErrors.length = 0;
}
