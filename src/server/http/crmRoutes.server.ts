import "@tanstack/react-start/server-only";
import { sql } from "drizzle-orm";
import { Readable } from "node:stream";
import { z, ZodError } from "zod";
import { resolveAuthenticatedSession } from "../auth/authService.server";
import { consumeFixedWindowRateLimit } from "../auth/rateLimit.server";
import {
  buildClearSessionCookie,
  getClientIp,
  maskIpPrefix,
  readSessionCookie,
  shouldUseSecureCookie,
  verifyCsrfAndOrigin,
} from "../auth/security.server";
import {
  type ServerEnv,
  getAutomationTestRateLimitPolicy,
  isLeadPilotAvailable,
  verifyDisposableAutomationTestDatabaseConfig,
} from "../config/env.server";
import { createLeadActivity, listLeadActivities } from "../crm/activitiesService.server";
import {
  createCallLogRecord,
  getCallLogRecord,
  listCallLogs,
  listCallLogsForLead,
} from "../crm/callsService.server";
import {
  cancelDealRecord,
  changeDealStatusRecord,
  createDealRecord,
  getDealRecord,
  getDealSummaryRecord,
  getOwnerFinanceSummary,
  listDealAuditHistory,
  listDealsRecords,
  updateDealRecord,
  verifyDealWonDateRecord,
} from "../crm/dealsService.server";
import { CrmServiceError } from "../crm/errors.server";
import {
  cancelFollowUpRecord,
  completeFollowUpRecord,
  createFollowUpRecord,
  getFollowUpRecord,
  listFollowUps,
  listFollowUpsForLead,
  rescheduleFollowUpRecord,
} from "../crm/followupsService.server";
import {
  getDashboardOverview,
  getFunnelAnalytics,
  getCommunicationsAnalytics,
  getFinanceAnalytics,
  getQuotationsAnalytics,
  getProjectsAnalytics,
  getPerformanceAnalytics,
  getTrendsAnalytics,
} from "../crm/analyticsService.server";
import {
  ANALYTICS_PERIODS,
  type AnalyticsPeriod,
  type Granularity,
} from "../crm/analyticsCalc.server";
import { isValidCalendarDay } from "../crm/dates.server";
import { resolveEffectiveIdempotencyKey } from "../crm/idempotency.server";
import {
  archiveLeadRecord,
  createLeadRecord,
  getLeadRecord,
  listLeadsRecords,
  restoreLeadRecord,
  updateLeadRecord,
} from "../crm/leadsService.server";
import {
  createPaymentRecord,
  getPaymentRecord,
  listAllPayments,
  listPaymentsForDeal,
  voidPaymentRecord,
} from "../crm/paymentsService.server";
import {
  attachPaymentProofRecord,
  getActivePaymentProof,
  listPaymentProofHistory,
  readPaymentProofContent,
  removePaymentProofRecord,
  replacePaymentProofRecord,
} from "../crm/proofService.server";
import {
  archiveQuotationRecord,
  changeQuotationStatusRecord,
  createQuotationRecord,
  createQuotationTemplateRecord,
  deleteQuotationTemplateRecord,
  duplicateQuotationTemplateRecord,
  getQuotationRecord,
  getQuotationTemplateRecord,
  listQuotationAuditEventsRecord,
  listQuotationRevisionsRecord,
  listQuotationsRecords,
  listQuotationTemplatesRecords,
  reorderQuotationTemplatesRecord,
  restoreQuotationRecord,
  updateQuotationRecord,
  updateQuotationTemplateRecord,
} from "../crm/quotationsService.server";
import {
  addDeliverableRevisionRecord,
  addProjectNoteRecord,
  archiveProjectRecord,
  configureProjectSupportRecord,
  createDeliverableRecord,
  createMilestoneRecord,
  createProjectRecord,
  createSupportTicketRecord,
  createTaskRecord,
  deliverProjectRecord,
  getProjectDetailsRecord,
  getProjectOverviewMetricsRecord,
  listProjectTemplatesRecord,
  listProjectsRecords,
  moveProjectStageRecord,
  reopenSupportTicketRecord,
  resolveSupportTicketRecord,
  saveProjectTemplateRecord,
  setProjectStatusRecord,
  setTaskDoneRecord,
  toggleChecklistItemRecord,
  toggleDependencyItemRecord,
  undoProjectStageRecord,
  updateDeliverableRecord,
  updateMilestoneRecord,
  updateProjectRecord,
  updateSupportTicketRecord,
  updateTaskRecord,
} from "../crm/projectsService.server";
import {
  addDeliverableRevisionBodySchema,
  addProjectNoteBodySchema,
  archiveLeadBodySchema,
  archiveProjectBodySchema,
  archiveQuotationBodySchema,
  cancelDealBodySchema,
  cancelFollowUpBodySchema,
  changeDealStatusBodySchema,
  changeQuotationStatusBodySchema,
  completeFollowUpBodySchema,
  completeTaskBodySchema,
  configureProjectSupportBodySchema,
  createActivityBodySchema,
  createCallLogBodySchema,
  createDealBodySchema,
  createDeliverableBodySchema,
  createFollowUpBodySchema,
  createLeadBodySchema,
  createMilestoneBodySchema,
  createPaymentBodySchema,
  createPaymentWithDealBodySchema,
  createProjectBodySchema,
  createQuotationBodySchema,
  createQuotationTemplateBodySchema,
  createSupportTicketBodySchema,
  createTaskBodySchema,
  createWhatsAppLogBodySchema,
  deliverProjectBodySchema,
  financeSummaryQuerySchema,
  listActivitiesQuerySchema,
  listCallsQuerySchema,
  listDealAuditQuerySchema,
  listDealPaymentsQuerySchema,
  listDealsQuerySchema,
  listDeliverablesQuerySchema,
  listFollowUpsQuerySchema,
  listLeadCallsQuerySchema,
  listLeadWhatsAppQuerySchema,
  listLeadsQuerySchema,
  listPaymentsQuerySchema,
  listProjectTemplatesQuerySchema,
  listProjectsQuerySchema,
  listProofHistoryQuerySchema,
  listQuotationAuditQuerySchema,
  listQuotationRevisionsQuerySchema,
  listQuotationsQuerySchema,
  listQuotationTemplatesQuerySchema,
  listSupportTicketsQuerySchema,
  listTasksQuerySchema,
  listWhatsAppQuerySchema,
  moveProjectStageBodySchema,
  removeProofBodySchema,
  reopenSupportTicketBodySchema,
  reorderQuotationTemplatesBodySchema,
  replaceProofBodySchema,
  resolveSupportTicketBodySchema,
  restoreLeadBodySchema,
  restoreQuotationBodySchema,
  saveProjectTemplateBodySchema,
  setProjectStatusBodySchema,
  toggleChecklistItemBodySchema,
  toggleDependencyItemBodySchema,
  undoProjectStageBodySchema,
  updateDealBodySchema,
  updateDeliverableBodySchema,
  updateFollowUpBodySchema,
  updateLeadBodySchema,
  updateMilestoneBodySchema,
  updateProjectBodySchema,
  updateQuotationBodySchema,
  updateQuotationTemplateBodySchema,
  updateSupportTicketBodySchema,
  updateTaskBodySchema,
  verifyDealWonDateBodySchema,
  voidPaymentBodySchema,
} from "../crm/validation.server";
import {
  archiveGoalRecord,
  changeGoalStatusRecord,
  createGoalRecord,
  getGoalProgressRecord,
  getGoalRecord,
  listActiveGoalsProgressRecord,
  listGoalRevisionsRecord,
  listGoalsRecord,
  updateGoalRecord,
} from "../crm/goalsService.server";
import {
  getOwnerSettingsRecord,
  getSettingsDefinitionsRecord,
  listSettingsAuditEventsRecord,
  updateOwnerSettingsRecord,
} from "../crm/settingsService.server";
import {
  getVaultCoverage,
  generateSyntheticBackupArchive,
  inspectUploadedArchive,
  runUploadedArchiveDryRun,
  parseArchiveUpload,
} from "../vault/vaultService.server";
import {
  archiveCustomFieldRecord,
  createCustomFieldRecord,
  getCustomFieldRecord,
  getLeadCustomFieldValuesRecord,
  listCustomFieldsRecord,
  setLeadCustomFieldValuesRecord,
  updateCustomFieldRecord,
} from "../crm/customFieldsService.server";
import {
  addTagToLeadRecord,
  archiveTagRecord,
  bulkTagLeadsRecord,
  createTagRecord,
  getLeadTagsRecord,
  getTagRecord,
  listTagsRecord,
  removeTagFromLeadRecord,
  updateTagRecord,
} from "../crm/tagsService.server";
import {
  archiveSavedViewRecord,
  createSavedViewRecord,
  duplicateSavedViewRecord,
  getSavedViewRecord,
  listSavedViewsRecord,
  updateSavedViewRecord,
} from "../crm/savedViewsService.server";
import {
  addTagToLeadBodySchema,
  bulkTagLeadsBodySchema,
  createCustomFieldBodySchema,
  createSavedViewBodySchema,
  createTagBodySchema,
  setLeadCustomFieldValuesBodySchema,
  updateCustomFieldBodySchema,
  updateSavedViewBodySchema,
  updateTagBodySchema,
} from "../crm/customFieldsValidation.server";
import {
  getInboxQueueRecord,
  setInboxReviewStatusRecord,
  setLeadDuplicateFlagRecord,
  scanDuplicateCandidatesRecord,
  listDuplicateCandidatesRecord,
  getDuplicateCandidateRecord,
  decideDuplicateCandidateRecord,
  getLeadRelationshipsRecord,
  deleteLeadRelationshipRecord,
  getReviewHistoryRecord,
} from "../crm/inboxService.server";
import {
  inboxQueueQuerySchema,
  inboxReviewBodySchema,
  inboxFlagBodySchema,
  dupCandidatesQuerySchema,
  dupCandidateDecisionBodySchema,
  dupScanBodySchema,
  reviewHistoryQuerySchema,
} from "../crm/inboxValidation.server";
import {
  archiveGoalBodySchema,
  changeGoalStatusBodySchema,
  goalProgressQuerySchema,
  listGoalRevisionsQuerySchema,
  listGoalsQuerySchema,
  listSettingsAuditQuerySchema,
  parseCreateGoalBody,
  parseUpdateGoalBody,
  parseUpdateSettingsBody,
} from "../crm/settingsGoalsValidation.server";
import {
  createWhatsAppLogRecord,
  getWhatsAppLogRecord,
  listWhatsAppLogs,
  listWhatsAppLogsForLead,
} from "../crm/whatsappService.server";
import {
  listAutomationRulesRecord,
  getAutomationRuleRecord,
  createAutomationRuleRecord,
  updateAutomationRuleRecord,
  duplicateAutomationRuleRecord,
  archiveAutomationRuleRecord,
  getAutomationRuleRevisionsRecord,
  simulateAutomationRuleRecord,
  getAutomationDefinitions,
} from "../crm/automationService.server";
import { executeAutomationRuleRecord } from "../crm/automationExecution.server";
import { getDatabase, type CrmDatabase } from "../db/index.server";

const CRM_API_HEADERS: Record<string, string> = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  pragma: "no-cache",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "no-referrer",
};

const MAX_CRM_JSON_BYTES = 64 * 1024;

function jsonResponse(
  body: unknown,
  status: number,
  extraHeaders?: Record<string, string>,
): Response {
  const headers = new Headers(CRM_API_HEADERS);
  if (extraHeaders) {
    for (const [k, v] of Object.entries(extraHeaders)) {
      headers.append(k, v);
    }
  }
  return new Response(JSON.stringify(body), { status, headers });
}

function methodNotAllowed(allowed: string[]): Response {
  return jsonResponse(
    {
      ok: false,
      error: {
        code: "method_not_allowed",
        message: `Only ${allowed.join(", ")} supported on this endpoint.`,
      },
    },
    405,
    { allow: allowed.join(", ") },
  );
}

function zodErrorResponse(err: ZodError): Response {
  const details: Record<string, string> = {};
  for (const issue of err.issues) {
    const key = issue.path.length > 0 ? issue.path.join(".") : "_";
    if (!details[key]) {
      details[key] = issue.message;
    }
  }
  const message = err.issues[0]?.message ?? "Invalid request payload.";
  return jsonResponse(
    {
      ok: false,
      error: {
        code: "validation_error",
        message,
        details,
      },
    },
    400,
  );
}

async function parseJsonObject(
  request: Request,
  options: { allowEmpty?: boolean } = {},
): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; response: Response }> {
  const contentLength = request.headers.get("content-length");
  if (contentLength && Number(contentLength) > MAX_CRM_JSON_BYTES) {
    return {
      ok: false,
      response: jsonResponse(
        { ok: false, error: { code: "validation_error", message: "Request body is too large." } },
        400,
      ),
    };
  }

  let rawText: string;
  try {
    rawText = await request.text();
  } catch {
    return {
      ok: false,
      response: jsonResponse(
        { ok: false, error: { code: "validation_error", message: "Unable to read request body." } },
        400,
      ),
    };
  }

  if (Buffer.byteLength(rawText, "utf8") > MAX_CRM_JSON_BYTES) {
    return {
      ok: false,
      response: jsonResponse(
        { ok: false, error: { code: "validation_error", message: "Request body is too large." } },
        400,
      ),
    };
  }

  if (!rawText.trim()) {
    if (options.allowEmpty) {
      return { ok: true, data: {} };
    }
    return {
      ok: false,
      response: jsonResponse(
        {
          ok: false,
          error: { code: "validation_error", message: "JSON request body is required." },
        },
        400,
      ),
    };
  }

  try {
    const parsed: unknown = JSON.parse(rawText);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {
        ok: false,
        response: jsonResponse(
          {
            ok: false,
            error: { code: "validation_error", message: "Request body must be a JSON object." },
          },
          400,
        ),
      };
    }
    return { ok: true, data: parsed as Record<string, unknown> };
  } catch {
    return {
      ok: false,
      response: jsonResponse(
        { ok: false, error: { code: "validation_error", message: "Malformed JSON request body." } },
        400,
      ),
    };
  }
}

interface ParsedProofUpload {
  originalFileName: string;
  fileBuffer: Buffer;
  reason?: string | undefined;
  idempotencyKey?: string | undefined;
}

const MAX_PROOF_BYTES = 10 * 1024 * 1024; // 10 MiB

async function parseProofUploadRequest(
  request: Request,
): Promise<{ ok: true; payload: ParsedProofUpload } | { ok: false; response: Response }> {
  const clHeader = request.headers.get("content-length");
  if (clHeader && Number(clHeader) > MAX_PROOF_BYTES) {
    return {
      ok: false,
      response: jsonResponse(
        {
          ok: false,
          error: {
            code: "file_too_large",
            message: "Payment proof file exceeds the 10 MiB size limit.",
          },
        },
        400,
      ),
    };
  }

  const contentType = (request.headers.get("content-type") ?? "").toLowerCase();

  // 1. Multipart form data
  if (contentType.startsWith("multipart/form-data")) {
    try {
      const formData = await request.formData();
      const fileEntry = formData.get("file") ?? formData.get("proof");
      if (!fileEntry || typeof fileEntry === "string") {
        return {
          ok: false,
          response: jsonResponse(
            {
              ok: false,
              error: {
                code: "validation_error",
                message: "A file must be attached in field 'file' or 'proof'.",
              },
            },
            400,
          ),
        };
      }

      const file = fileEntry as unknown as {
        name?: string;
        arrayBuffer: () => Promise<ArrayBuffer>;
      };
      const originalFileName = file.name || "payment-proof";
      const arrayBuffer = await file.arrayBuffer();
      const fileBuffer = Buffer.from(arrayBuffer);

      if (fileBuffer.length === 0) {
        return {
          ok: false,
          response: jsonResponse(
            {
              ok: false,
              error: {
                code: "empty_file",
                message: "Payment proof file is empty (0 bytes).",
              },
            },
            400,
          ),
        };
      }

      if (fileBuffer.length > MAX_PROOF_BYTES) {
        return {
          ok: false,
          response: jsonResponse(
            {
              ok: false,
              error: {
                code: "file_too_large",
                message: "Payment proof file exceeds the 10 MiB size limit.",
              },
            },
            400,
          ),
        };
      }

      const reasonVal = formData.get("reason");
      const reason =
        typeof reasonVal === "string" && reasonVal.trim() ? reasonVal.trim() : undefined;
      const idKeyVal = formData.get("idempotencyKey");
      const idempotencyKey =
        typeof idKeyVal === "string" && idKeyVal.trim()
          ? idKeyVal.trim()
          : (request.headers.get("idempotency-key") ?? undefined);

      return {
        ok: true,
        payload: {
          originalFileName,
          fileBuffer,
          reason,
          idempotencyKey,
        },
      };
    } catch (err) {
      return {
        ok: false,
        response: jsonResponse(
          {
            ok: false,
            error: {
              code: "validation_error",
              message:
                "Unable to parse multipart form data: " +
                (err instanceof Error ? err.message : String(err)),
            },
          },
          400,
        ),
      };
    }
  }

  // 2. JSON Base64 upload
  if (contentType.includes("application/json")) {
    const parsedJson = await parseJsonObject(request);
    if (!parsedJson.ok) return parsedJson;
    const data = parsedJson.data;

    const base64Val = data["contentBase64"];
    const base64 = typeof base64Val === "string" ? base64Val.trim() : "";
    if (!base64) {
      return {
        ok: false,
        response: jsonResponse(
          {
            ok: false,
            error: {
              code: "validation_error",
              message: "Missing 'contentBase64' field in JSON upload.",
            },
          },
          400,
        ),
      };
    }

    let fileBuffer: Buffer;
    try {
      fileBuffer = Buffer.from(base64, "base64");
    } catch {
      return {
        ok: false,
        response: jsonResponse(
          {
            ok: false,
            error: {
              code: "validation_error",
              message: "Invalid base64 encoding in 'contentBase64'.",
            },
          },
          400,
        ),
      };
    }

    if (fileBuffer.length === 0) {
      return {
        ok: false,
        response: jsonResponse(
          {
            ok: false,
            error: {
              code: "empty_file",
              message: "Payment proof file is empty (0 bytes).",
            },
          },
          400,
        ),
      };
    }

    if (fileBuffer.length > MAX_PROOF_BYTES) {
      return {
        ok: false,
        response: jsonResponse(
          {
            ok: false,
            error: {
              code: "file_too_large",
              message: "Payment proof file exceeds the 10 MiB size limit.",
            },
          },
          400,
        ),
      };
    }

    const fileNameVal = data["fileName"] ?? data["originalFileName"];
    const fileName =
      typeof fileNameVal === "string" && fileNameVal.trim() ? fileNameVal.trim() : "payment-proof";
    const reasonVal = data["reason"];
    const reason = typeof reasonVal === "string" && reasonVal.trim() ? reasonVal.trim() : undefined;
    const idempotencyKeyVal = data["idempotencyKey"];
    const idempotencyKey =
      typeof idempotencyKeyVal === "string" && idempotencyKeyVal.trim()
        ? idempotencyKeyVal.trim()
        : (request.headers.get("idempotency-key") ?? undefined);

    return {
      ok: true,
      payload: {
        originalFileName: fileName,
        fileBuffer,
        reason,
        idempotencyKey,
      },
    };
  }

  // 3. Raw binary stream
  try {
    const arrayBuffer = await request.arrayBuffer();
    const fileBuffer = Buffer.from(arrayBuffer);

    if (fileBuffer.length === 0) {
      return {
        ok: false,
        response: jsonResponse(
          {
            ok: false,
            error: {
              code: "empty_file",
              message: "Payment proof file is empty (0 bytes).",
            },
          },
          400,
        ),
      };
    }

    if (fileBuffer.length > MAX_PROOF_BYTES) {
      return {
        ok: false,
        response: jsonResponse(
          {
            ok: false,
            error: {
              code: "file_too_large",
              message: "Payment proof file exceeds the 10 MiB size limit.",
            },
          },
          400,
        ),
      };
    }

    const fileNameHeader = request.headers.get("x-file-name");
    const originalFileName = fileNameHeader
      ? decodeURIComponent(fileNameHeader.trim())
      : "payment-proof";
    const reasonHeader = request.headers.get("x-reason");
    const reason = reasonHeader ? decodeURIComponent(reasonHeader.trim()) : undefined;
    const idempotencyKey = request.headers.get("idempotency-key") ?? undefined;

    return {
      ok: true,
      payload: {
        originalFileName,
        fileBuffer,
        reason,
        idempotencyKey,
      },
    };
  } catch (err) {
    return {
      ok: false,
      response: jsonResponse(
        {
          ok: false,
          error: {
            code: "validation_error",
            message:
              "Unable to read binary request body: " +
              (err instanceof Error ? err.message : String(err)),
          },
        },
        400,
      ),
    };
  }
}

async function requireAuthenticatedOwnerDb(
  request: Request,
  env: ServerEnv,
): Promise<{ ok: true; db: CrmDatabase; userId: string } | { ok: false; response: Response }> {
  const token = readSessionCookie(request, env.SESSION_COOKIE_NAME);
  const ipPrefix = maskIpPrefix(getClientIp(request, env));
  const resolved = await resolveAuthenticatedSession(token, env, { ipPrefix, slideIdle: true });

  if (resolved.status === "unconfigured" || resolved.status === "db_error") {
    return {
      ok: false,
      response: jsonResponse(
        {
          ok: false,
          authenticated: false,
          error: {
            code: "crm_unavailable",
            message: "CRM database is unavailable.",
          },
        },
        503,
      ),
    };
  }

  if (resolved.status !== "authenticated") {
    const secureCookie = shouldUseSecureCookie(request, env);
    const headers: Record<string, string> | undefined =
      token && resolved.reason !== "missing"
        ? {
            "set-cookie": buildClearSessionCookie({
              cookieName: env.SESSION_COOKIE_NAME,
              secure: secureCookie,
            }),
          }
        : undefined;
    return {
      ok: false,
      response: jsonResponse(
        {
          ok: false,
          authenticated: false,
          error: {
            code: "unauthenticated",
            reason: resolved.reason,
            message: "Authentication required.",
          },
        },
        401,
        headers,
      ),
    };
  }

  if (resolved.user.roleId !== "owner") {
    return {
      ok: false,
      response: jsonResponse(
        {
          ok: false,
          error: {
            code: "forbidden",
            message: "Owner access is required.",
          },
        },
        403,
      ),
    };
  }

  const db = getDatabase();
  if (!db) {
    return {
      ok: false,
      response: jsonResponse(
        {
          ok: false,
          error: {
            code: "crm_unavailable",
            message: "CRM database is unavailable.",
          },
        },
        503,
      ),
    };
  }

  return { ok: true, db, userId: resolved.user.id };
}

function decodeIdSegment(
  raw: string,
): { ok: true; value: string } | { ok: false; response: Response } {
  try {
    const decoded = decodeURIComponent(raw).trim();
    if (!decoded || decoded.length > 64) {
      return {
        ok: false,
        response: jsonResponse(
          { ok: false, error: { code: "not_found", message: "Resource not found." } },
          404,
        ),
      };
    }
    return { ok: true, value: decoded };
  } catch {
    return {
      ok: false,
      response: jsonResponse(
        {
          ok: false,
          error: { code: "validation_error", message: "Malformed resource identifier." },
        },
        400,
      ),
    };
  }
}

function searchParamsObject(requestUrl: URL): Record<string, string> {
  const out: Record<string, string> = {};
  requestUrl.searchParams.forEach((value, key) => {
    out[key] = value;
  });
  return out;
}

function crmErrorResponse(error: unknown): Response {
  if (error instanceof CrmServiceError) {
    return jsonResponse(error.toResponseBody(), error.status);
  }
  if (error instanceof ZodError) {
    return zodErrorResponse(error);
  }
  throw error;
}

function csrfRejectResponse(code: string, message: string): Response {
  return jsonResponse({ ok: false, error: { code, message } }, 403);
}

function hasRequestBodyHint(request: Request): boolean {
  const len = Number(request.headers.get("content-length") ?? "0");
  const transferEncoding = request.headers.get("transfer-encoding");
  return len > 0 || Boolean(transferEncoding);
}

const analyticsQuerySchema = z
  .object({
    period: z.enum(ANALYTICS_PERIODS as unknown as [string, ...string[]]).optional(),
    from: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid from date (expected YYYY-MM-DD)")
      .refine((v) => isValidCalendarDay(v), "from must be a valid calendar date")
      .optional(),
    to: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid to date (expected YYYY-MM-DD)")
      .refine((v) => isValidCalendarDay(v), "to must be a valid calendar date")
      .optional(),
    granularity: z.enum(["day", "week", "month"]).optional(),
  })
  .refine(
    (data) => {
      if (data.from && data.to) {
        return data.from <= data.to;
      }
      return true;
    },
    {
      message: "'from' date cannot be after 'to' date",
      path: ["from"],
    },
  );

/**
 * Handles all Core CRM `/api/v1/leads*`, `/api/v1/follow-ups*`, `/api/v1/calls*`,
 * `/api/v1/whatsapp-messages*`, `/api/v1/deals*`, `/api/v1/payments*`, `/api/v1/finance*`,
 * `/api/v1/quotation-templates*`, `/api/v1/quotations*`, `/api/v1/projects*`, and `/api/v1/analytics*`
 * endpoints. Returns `null` if the pathname does not match any CRM route.
 */
export async function handleCrmApiRequest(
  request: Request,
  pathname: string,
  env: ServerEnv,
): Promise<Response | null> {
  if (
    !pathname.startsWith("/api/v1/leads") &&
    !pathname.startsWith("/api/v1/follow-ups") &&
    !pathname.startsWith("/api/v1/calls") &&
    !pathname.startsWith("/api/v1/whatsapp-messages") &&
    !pathname.startsWith("/api/v1/deals") &&
    !pathname.startsWith("/api/v1/payments") &&
    !pathname.startsWith("/api/v1/finance") &&
    !pathname.startsWith("/api/v1/quotation-templates") &&
    !pathname.startsWith("/api/v1/quotations") &&
    !pathname.startsWith("/api/v1/projects") &&
    !pathname.startsWith("/api/v1/project-milestones") &&
    !pathname.startsWith("/api/v1/tasks") &&
    !pathname.startsWith("/api/v1/deliverables") &&
    !pathname.startsWith("/api/v1/support-tickets") &&
    !pathname.startsWith("/api/v1/project-templates") &&
    !pathname.startsWith("/api/v1/analytics") &&
    !pathname.startsWith("/api/v1/settings") &&
    !pathname.startsWith("/api/v1/goals") &&
    !pathname.startsWith("/api/v1/custom-fields") &&
    !pathname.startsWith("/api/v1/tags") &&
    !pathname.startsWith("/api/v1/saved-views") &&
    !pathname.startsWith("/api/v1/inbox") &&
    !pathname.startsWith("/api/v1/vault") &&
    !pathname.startsWith("/api/v1/automations")
  ) {
    return null;
  }

  const segments = pathname.split("/").filter(Boolean);
  // Expect prefix ["api", "v1", resource, ...]
  if (segments[0] !== "api" || segments[1] !== "v1") {
    return null;
  }

  const resource = segments[2];
  const parsedUrl = new URL(request.url, "http://127.0.0.1");

  try {
    if (resource === "leads") {
      // GET|POST /api/v1/leads
      if (segments.length === 3) {
        if (request.method === "GET") {
          const auth = await requireAuthenticatedOwnerDb(request, env);
          if (!auth.ok) return auth.response;

          const query = listLeadsQuerySchema.parse(searchParamsObject(parsedUrl));
          const result = await listLeadsRecords(auth.db, auth.userId, query);
          return jsonResponse({ ok: true, ...result }, 200);
        }

        if (request.method === "POST") {
          const csrf = verifyCsrfAndOrigin(request, env, { requireJsonContentType: true });
          if (!csrf.ok) return csrfRejectResponse(csrf.code, csrf.message);

          const auth = await requireAuthenticatedOwnerDb(request, env);
          if (!auth.ok) return auth.response;

          const parsedBody = await parseJsonObject(request);
          if (!parsedBody.ok) return parsedBody.response;

          const input = createLeadBodySchema.parse(parsedBody.data);
          const idemKey = resolveEffectiveIdempotencyKey({
            headerKey: request.headers.get("idempotency-key"),
            bodyKey: input.idempotencyKey,
          });

          const res = await createLeadRecord(auth.db, auth.userId, auth.userId, input, {
            idempotencyKey: idemKey,
          });
          return jsonResponse(
            res.body,
            res.status,
            res.replayed ? { "x-idempotency-replayed": "true" } : undefined,
          );
        }

        return methodNotAllowed(["GET", "POST"]);
      }

      // POST /api/v1/leads/bulk-tag or /api/v1/leads/bulk-tags
      if (segments.length === 4 && (segments[3] === "bulk-tag" || segments[3] === "bulk-tags")) {
        if (request.method !== "POST") return methodNotAllowed(["POST"]);
        const csrf = verifyCsrfAndOrigin(request, env, { requireJsonContentType: true });
        if (!csrf.ok) return csrfRejectResponse(csrf.code, csrf.message);

        const auth = await requireAuthenticatedOwnerDb(request, env);
        if (!auth.ok) return auth.response;

        const parsedBody = await parseJsonObject(request);
        if (!parsedBody.ok) return parsedBody.response;

        const input = bulkTagLeadsBodySchema.parse(parsedBody.data);
        const result = await bulkTagLeadsRecord(auth.db, auth.userId, input);
        return jsonResponse(result, 200);
      }

      // DELETE /api/v1/leads/relationships/:key
      if (segments.length === 5 && segments[3] === "relationships") {
        if (request.method !== "DELETE") return methodNotAllowed(["DELETE"]);
        const csrf = verifyCsrfAndOrigin(request, env, { requireJsonContentType: false });
        if (!csrf.ok) return csrfRejectResponse(csrf.code, csrf.message);

        const auth = await requireAuthenticatedOwnerDb(request, env);
        if (!auth.ok) return auth.response;

        const pairKey = decodeURIComponent(segments[4] ?? "");
        const result = await deleteLeadRelationshipRecord(auth.db, auth.userId, auth.userId, pairKey);
        return jsonResponse(result, 200);
      }

      const idSeg = decodeIdSegment(segments[3] ?? "");
      if (!idSeg.ok) return idSeg.response;
      const leadId = idSeg.value;

      // GET|PATCH|DELETE /api/v1/leads/:id
      if (segments.length === 4) {
        if (request.method === "GET") {
          const auth = await requireAuthenticatedOwnerDb(request, env);
          if (!auth.ok) return auth.response;

          const lead = await getLeadRecord(auth.db, auth.userId, leadId);
          return jsonResponse({ ok: true, lead }, 200);
        }

        if (request.method === "PATCH") {
          const csrf = verifyCsrfAndOrigin(request, env, { requireJsonContentType: true });
          if (!csrf.ok) return csrfRejectResponse(csrf.code, csrf.message);

          const auth = await requireAuthenticatedOwnerDb(request, env);
          if (!auth.ok) return auth.response;

          const parsedBody = await parseJsonObject(request);
          if (!parsedBody.ok) return parsedBody.response;

          const input = updateLeadBodySchema.parse(parsedBody.data);
          const idemKey = resolveEffectiveIdempotencyKey({
            headerKey: request.headers.get("idempotency-key"),
          });

          const res = await updateLeadRecord(auth.db, auth.userId, auth.userId, leadId, input, {
            idempotencyKey: idemKey,
          });
          return jsonResponse(
            res.body,
            res.status,
            res.replayed ? { "x-idempotency-replayed": "true" } : undefined,
          );
        }

        if (request.method === "DELETE") {
          const hasBody = hasRequestBodyHint(request);
          const csrf = verifyCsrfAndOrigin(request, env, { requireJsonContentType: hasBody });
          if (!csrf.ok) return csrfRejectResponse(csrf.code, csrf.message);

          const auth = await requireAuthenticatedOwnerDb(request, env);
          if (!auth.ok) return auth.response;

          let reason: string | undefined;
          let version: number | undefined;
          let bodyIdemKey: string | undefined;

          if (hasBody) {
            const parsedBody = await parseJsonObject(request, { allowEmpty: true });
            if (!parsedBody.ok) return parsedBody.response;
            if (Object.keys(parsedBody.data).length > 0) {
              const delParsed = archiveLeadBodySchema
                .pick({ reason: true, version: true, idempotencyKey: true })
                .partial({ version: true })
                .parse(parsedBody.data);
              reason = delParsed.reason;
              version = delParsed.version;
              bodyIdemKey = delParsed.idempotencyKey;
            }
          }

          const rawVersionParam = parsedUrl.searchParams.get("version");
          if (version === undefined && rawVersionParam !== null) {
            const vNum = Number(rawVersionParam);
            if (!Number.isInteger(vNum) || vNum < 1) {
              return jsonResponse(
                {
                  ok: false,
                  error: {
                    code: "validation_error",
                    message: "Query version must be an integer >= 1.",
                  },
                },
                400,
              );
            }
            version = vNum;
          }

          const idemKey = resolveEffectiveIdempotencyKey({
            headerKey: request.headers.get("idempotency-key"),
            bodyKey: bodyIdemKey,
          });

          const res = await archiveLeadRecord(auth.db, auth.userId, auth.userId, leadId, {
            kind: "deleted",
            reason,
            version,
            idempotencyKey: idemKey,
          });
          return jsonResponse(
            res.body,
            res.status,
            res.replayed ? { "x-idempotency-replayed": "true" } : undefined,
          );
        }

        return methodNotAllowed(["GET", "PATCH", "DELETE"]);
      }

      if (segments.length === 5) {
        const subresource = segments[4];

        // POST /api/v1/leads/:id/archive
        if (subresource === "archive") {
          if (request.method !== "POST") return methodNotAllowed(["POST"]);

          const csrf = verifyCsrfAndOrigin(request, env, { requireJsonContentType: true });
          if (!csrf.ok) return csrfRejectResponse(csrf.code, csrf.message);

          const auth = await requireAuthenticatedOwnerDb(request, env);
          if (!auth.ok) return auth.response;

          const parsedBody = await parseJsonObject(request);
          if (!parsedBody.ok) return parsedBody.response;

          const input = archiveLeadBodySchema.parse(parsedBody.data);
          const idemKey = resolveEffectiveIdempotencyKey({
            headerKey: request.headers.get("idempotency-key"),
            bodyKey: input.idempotencyKey,
          });

          const res = await archiveLeadRecord(auth.db, auth.userId, auth.userId, leadId, {
            kind: input.kind,
            reason: input.reason,
            version: input.version,
            idempotencyKey: idemKey,
          });
          return jsonResponse(
            res.body,
            res.status,
            res.replayed ? { "x-idempotency-replayed": "true" } : undefined,
          );
        }

        // POST /api/v1/leads/:id/restore
        if (subresource === "restore") {
          if (request.method !== "POST") return methodNotAllowed(["POST"]);

          const csrf = verifyCsrfAndOrigin(request, env, { requireJsonContentType: true });
          if (!csrf.ok) return csrfRejectResponse(csrf.code, csrf.message);

          const auth = await requireAuthenticatedOwnerDb(request, env);
          if (!auth.ok) return auth.response;

          const parsedBody = await parseJsonObject(request, { allowEmpty: true });
          if (!parsedBody.ok) return parsedBody.response;

          const input = restoreLeadBodySchema.parse(parsedBody.data);
          const idemKey = resolveEffectiveIdempotencyKey({
            headerKey: request.headers.get("idempotency-key"),
            bodyKey: input.idempotencyKey,
          });

          const res = await restoreLeadRecord(auth.db, auth.userId, auth.userId, leadId, {
            version: input.version,
            idempotencyKey: idemKey,
          });
          return jsonResponse(
            res.body,
            res.status,
            res.replayed ? { "x-idempotency-replayed": "true" } : undefined,
          );
        }

        // GET|POST /api/v1/leads/:id/activities
        if (subresource === "activities") {
          if (request.method === "GET") {
            const auth = await requireAuthenticatedOwnerDb(request, env);
            if (!auth.ok) return auth.response;

            const query = listActivitiesQuerySchema.parse(searchParamsObject(parsedUrl));
            const result = await listLeadActivities(auth.db, auth.userId, leadId, query);
            return jsonResponse({ ok: true, ...result }, 200);
          }

          if (request.method === "POST") {
            const csrf = verifyCsrfAndOrigin(request, env, { requireJsonContentType: true });
            if (!csrf.ok) return csrfRejectResponse(csrf.code, csrf.message);

            const auth = await requireAuthenticatedOwnerDb(request, env);
            if (!auth.ok) return auth.response;

            const parsedBody = await parseJsonObject(request);
            if (!parsedBody.ok) return parsedBody.response;

            const input = createActivityBodySchema.parse(parsedBody.data);
            const idemKey = resolveEffectiveIdempotencyKey({
              headerKey: request.headers.get("idempotency-key"),
              bodyKey: input.idempotencyKey,
              opId: input.opId,
            });

            const res = await createLeadActivity(auth.db, auth.userId, auth.userId, leadId, input, {
              idempotencyKey: idemKey,
            });
            return jsonResponse(
              res.body,
              res.status,
              res.replayed ? { "x-idempotency-replayed": "true" } : undefined,
            );
          }

          return methodNotAllowed(["GET", "POST"]);
        }

        // GET /api/v1/leads/:id/follow-ups
        if (subresource === "follow-ups") {
          if (request.method !== "GET") return methodNotAllowed(["GET"]);

          const auth = await requireAuthenticatedOwnerDb(request, env);
          if (!auth.ok) return auth.response;

          const result = await listFollowUpsForLead(auth.db, auth.userId, leadId);
          return jsonResponse({ ok: true, ...result }, 200);
        }

        // GET /api/v1/leads/:id/calls
        if (subresource === "calls") {
          if (request.method !== "GET") return methodNotAllowed(["GET"]);

          const auth = await requireAuthenticatedOwnerDb(request, env);
          if (!auth.ok) return auth.response;

          const query = listLeadCallsQuerySchema.parse(searchParamsObject(parsedUrl));
          const result = await listCallLogsForLead(auth.db, auth.userId, leadId, query);
          return jsonResponse({ ok: true, ...result }, 200);
        }

        // GET /api/v1/leads/:id/whatsapp-messages
        if (subresource === "whatsapp-messages") {
          if (request.method !== "GET") return methodNotAllowed(["GET"]);

          const auth = await requireAuthenticatedOwnerDb(request, env);
          if (!auth.ok) return auth.response;

          const query = listLeadWhatsAppQuerySchema.parse(searchParamsObject(parsedUrl));
          const result = await listWhatsAppLogsForLead(auth.db, auth.userId, leadId, query);
          return jsonResponse({ ok: true, ...result }, 200);
        }

        // GET /api/v1/leads/:id/deals
        if (subresource === "deals") {
          if (request.method !== "GET") return methodNotAllowed(["GET"]);

          const auth = await requireAuthenticatedOwnerDb(request, env);
          if (!auth.ok) return auth.response;

          // Verify Lead exists & belongs to Owner before listing its Deals.
          await getLeadRecord(auth.db, auth.userId, leadId);
          const query = listDealsQuerySchema.parse({
            ...searchParamsObject(parsedUrl),
            leadId,
          });
          const result = await listDealsRecords(auth.db, auth.userId, query);
          return jsonResponse({ ok: true, ...result }, 200);
        }

        // GET /api/v1/leads/:id/quotations
        if (subresource === "quotations") {
          if (request.method !== "GET") return methodNotAllowed(["GET"]);

          const auth = await requireAuthenticatedOwnerDb(request, env);
          if (!auth.ok) return auth.response;

          // Verify Lead exists & belongs to Owner before listing its Quotations.
          await getLeadRecord(auth.db, auth.userId, leadId);
          const result = await listQuotationsRecords(auth.db, auth.userId, { leadId });
          return jsonResponse(
            {
              ok: true,
              leadId,
              items: result.items,
              total: result.total,
              limit: result.limit,
              offset: result.offset,
            },
            200,
          );
        }

        // GET|PUT /api/v1/leads/:id/custom-fields
        if (subresource === "custom-fields") {
          if (request.method === "GET") {
            const auth = await requireAuthenticatedOwnerDb(request, env);
            if (!auth.ok) return auth.response;

            const result = await getLeadCustomFieldValuesRecord(auth.db, auth.userId, leadId);
            return jsonResponse({ ok: true, ...result }, 200);
          }

          if (request.method === "PUT") {
            const csrf = verifyCsrfAndOrigin(request, env, { requireJsonContentType: true });
            if (!csrf.ok) return csrfRejectResponse(csrf.code, csrf.message);

            const auth = await requireAuthenticatedOwnerDb(request, env);
            if (!auth.ok) return auth.response;

            const parsedBody = await parseJsonObject(request);
            if (!parsedBody.ok) return parsedBody.response;

            const input = setLeadCustomFieldValuesBodySchema.parse(parsedBody.data);
            const result = await setLeadCustomFieldValuesRecord(
              auth.db,
              auth.userId,
              leadId,
              input.values,
            );
            return jsonResponse(result, 200);
          }

          return methodNotAllowed(["GET", "PUT"]);
        }

        // GET|POST /api/v1/leads/:id/tags
        if (subresource === "tags") {
          if (request.method === "GET") {
            const auth = await requireAuthenticatedOwnerDb(request, env);
            if (!auth.ok) return auth.response;

            const result = await getLeadTagsRecord(auth.db, auth.userId, leadId);
            return jsonResponse({ ok: true, ...result }, 200);
          }

          if (request.method === "POST") {
            const csrf = verifyCsrfAndOrigin(request, env, { requireJsonContentType: true });
            if (!csrf.ok) return csrfRejectResponse(csrf.code, csrf.message);

            const auth = await requireAuthenticatedOwnerDb(request, env);
            if (!auth.ok) return auth.response;

            const parsedBody = await parseJsonObject(request);
            if (!parsedBody.ok) return parsedBody.response;

            const input = addTagToLeadBodySchema.parse(parsedBody.data);
            const result = await addTagToLeadRecord(auth.db, auth.userId, leadId, input.tagId);
            return jsonResponse(result, 200);
          }

          return methodNotAllowed(["GET", "POST"]);
        }

        // GET /api/v1/leads/:id/relationships
        if (subresource === "relationships") {
          if (request.method !== "GET") return methodNotAllowed(["GET"]);

          const auth = await requireAuthenticatedOwnerDb(request, env);
          if (!auth.ok) return auth.response;

          const result = await getLeadRelationshipsRecord(auth.db, auth.userId, leadId);
          return jsonResponse({ ok: true, ...result }, 200);
        }
      }

      if (segments.length === 6 && segments[4] === "tags") {
        const idSeg2 = decodeIdSegment(segments[5] ?? "");
        if (!idSeg2.ok) return idSeg2.response;
        const tagId = idSeg2.value;

        // DELETE /api/v1/leads/:id/tags/:tagId
        if (request.method === "DELETE") {
          const csrf = verifyCsrfAndOrigin(request, env, { requireJsonContentType: false });
          if (!csrf.ok) return csrfRejectResponse(csrf.code, csrf.message);

          const auth = await requireAuthenticatedOwnerDb(request, env);
          if (!auth.ok) return auth.response;

          const result = await removeTagFromLeadRecord(auth.db, auth.userId, leadId, tagId);
          return jsonResponse(result, 200);
        }

        return methodNotAllowed(["DELETE"]);
      }

      return null;
    }

    if (resource === "follow-ups") {
      // GET|POST /api/v1/follow-ups
      if (segments.length === 3) {
        if (request.method === "GET") {
          const auth = await requireAuthenticatedOwnerDb(request, env);
          if (!auth.ok) return auth.response;

          const query = listFollowUpsQuerySchema.parse(searchParamsObject(parsedUrl));
          const result = await listFollowUps(auth.db, auth.userId, query);
          return jsonResponse({ ok: true, ...result }, 200);
        }

        if (request.method === "POST") {
          const csrf = verifyCsrfAndOrigin(request, env, { requireJsonContentType: true });
          if (!csrf.ok) return csrfRejectResponse(csrf.code, csrf.message);

          const auth = await requireAuthenticatedOwnerDb(request, env);
          if (!auth.ok) return auth.response;

          const parsedBody = await parseJsonObject(request);
          if (!parsedBody.ok) return parsedBody.response;

          const input = createFollowUpBodySchema.parse(parsedBody.data);
          const idemKey = resolveEffectiveIdempotencyKey({
            headerKey: request.headers.get("idempotency-key"),
            bodyKey: input.idempotencyKey,
            opId: input.opId,
          });

          const res = await createFollowUpRecord(auth.db, auth.userId, auth.userId, input, {
            idempotencyKey: idemKey,
          });
          return jsonResponse(
            res.body,
            res.status,
            res.replayed ? { "x-idempotency-replayed": "true" } : undefined,
          );
        }

        return methodNotAllowed(["GET", "POST"]);
      }

      const idSeg = decodeIdSegment(segments[3] ?? "");
      if (!idSeg.ok) return idSeg.response;
      const followUpId = idSeg.value;

      // GET|PATCH /api/v1/follow-ups/:id
      if (segments.length === 4) {
        if (request.method === "GET") {
          const auth = await requireAuthenticatedOwnerDb(request, env);
          if (!auth.ok) return auth.response;

          const followUp = await getFollowUpRecord(auth.db, auth.userId, followUpId);
          return jsonResponse({ ok: true, followUp }, 200);
        }

        if (request.method === "PATCH") {
          const csrf = verifyCsrfAndOrigin(request, env, { requireJsonContentType: true });
          if (!csrf.ok) return csrfRejectResponse(csrf.code, csrf.message);

          const auth = await requireAuthenticatedOwnerDb(request, env);
          if (!auth.ok) return auth.response;

          const parsedBody = await parseJsonObject(request);
          if (!parsedBody.ok) return parsedBody.response;

          const input = updateFollowUpBodySchema.parse(parsedBody.data);
          const idemKey = resolveEffectiveIdempotencyKey({
            headerKey: request.headers.get("idempotency-key"),
          });

          const res = await rescheduleFollowUpRecord(
            auth.db,
            auth.userId,
            auth.userId,
            followUpId,
            input,
            { idempotencyKey: idemKey },
          );
          return jsonResponse(
            res.body,
            res.status,
            res.replayed ? { "x-idempotency-replayed": "true" } : undefined,
          );
        }

        return methodNotAllowed(["GET", "PATCH"]);
      }

      if (segments.length === 5) {
        const action = segments[4];

        // POST /api/v1/follow-ups/:id/complete
        if (action === "complete") {
          if (request.method !== "POST") return methodNotAllowed(["POST"]);

          const csrf = verifyCsrfAndOrigin(request, env, { requireJsonContentType: true });
          if (!csrf.ok) return csrfRejectResponse(csrf.code, csrf.message);

          const auth = await requireAuthenticatedOwnerDb(request, env);
          if (!auth.ok) return auth.response;

          const parsedBody = await parseJsonObject(request);
          if (!parsedBody.ok) return parsedBody.response;

          const input = completeFollowUpBodySchema.parse(parsedBody.data);
          const idemKey = resolveEffectiveIdempotencyKey({
            headerKey: request.headers.get("idempotency-key"),
            bodyKey: input.idempotencyKey,
          });

          const res = await completeFollowUpRecord(
            auth.db,
            auth.userId,
            auth.userId,
            followUpId,
            input,
            { idempotencyKey: idemKey },
          );
          return jsonResponse(
            res.body,
            res.status,
            res.replayed ? { "x-idempotency-replayed": "true" } : undefined,
          );
        }

        // POST /api/v1/follow-ups/:id/cancel
        if (action === "cancel") {
          if (request.method !== "POST") return methodNotAllowed(["POST"]);

          const csrf = verifyCsrfAndOrigin(request, env, { requireJsonContentType: true });
          if (!csrf.ok) return csrfRejectResponse(csrf.code, csrf.message);

          const auth = await requireAuthenticatedOwnerDb(request, env);
          if (!auth.ok) return auth.response;

          const parsedBody = await parseJsonObject(request);
          if (!parsedBody.ok) return parsedBody.response;

          const input = cancelFollowUpBodySchema.parse(parsedBody.data);
          const idemKey = resolveEffectiveIdempotencyKey({
            headerKey: request.headers.get("idempotency-key"),
            bodyKey: input.idempotencyKey,
          });

          const res = await cancelFollowUpRecord(
            auth.db,
            auth.userId,
            auth.userId,
            followUpId,
            input,
            { idempotencyKey: idemKey },
          );
          return jsonResponse(
            res.body,
            res.status,
            res.replayed ? { "x-idempotency-replayed": "true" } : undefined,
          );
        }
      }

      return null;
    }

    if (resource === "calls") {
      // GET|POST /api/v1/calls
      if (segments.length === 3) {
        if (request.method === "GET") {
          const auth = await requireAuthenticatedOwnerDb(request, env);
          if (!auth.ok) return auth.response;

          const query = listCallsQuerySchema.parse(searchParamsObject(parsedUrl));
          const result = await listCallLogs(auth.db, auth.userId, query);
          return jsonResponse({ ok: true, ...result }, 200);
        }

        if (request.method === "POST") {
          const csrf = verifyCsrfAndOrigin(request, env, { requireJsonContentType: true });
          if (!csrf.ok) return csrfRejectResponse(csrf.code, csrf.message);

          const auth = await requireAuthenticatedOwnerDb(request, env);
          if (!auth.ok) return auth.response;

          const parsedBody = await parseJsonObject(request);
          if (!parsedBody.ok) return parsedBody.response;

          const input = createCallLogBodySchema.parse(parsedBody.data);
          const idemKey = resolveEffectiveIdempotencyKey({
            headerKey: request.headers.get("idempotency-key"),
            bodyKey: input.idempotencyKey,
            opId: input.opId,
          });

          const res = await createCallLogRecord(auth.db, auth.userId, auth.userId, input, {
            idempotencyKey: idemKey,
          });
          return jsonResponse(
            res.body,
            res.status,
            res.replayed ? { "x-idempotency-replayed": "true" } : undefined,
          );
        }

        return methodNotAllowed(["GET", "POST"]);
      }

      // GET /api/v1/calls/:id
      if (segments.length === 4) {
        const idSeg = decodeIdSegment(segments[3] ?? "");
        if (!idSeg.ok) return idSeg.response;
        const callId = idSeg.value;

        if (request.method === "GET") {
          const auth = await requireAuthenticatedOwnerDb(request, env);
          if (!auth.ok) return auth.response;

          const call = await getCallLogRecord(auth.db, auth.userId, callId);
          return jsonResponse({ ok: true, call }, 200);
        }

        return methodNotAllowed(["GET"]);
      }

      return null;
    }

    if (resource === "whatsapp-messages") {
      // GET|POST /api/v1/whatsapp-messages
      if (segments.length === 3) {
        if (request.method === "GET") {
          const auth = await requireAuthenticatedOwnerDb(request, env);
          if (!auth.ok) return auth.response;

          const query = listWhatsAppQuerySchema.parse(searchParamsObject(parsedUrl));
          const result = await listWhatsAppLogs(auth.db, auth.userId, query);
          return jsonResponse({ ok: true, ...result }, 200);
        }

        if (request.method === "POST") {
          const csrf = verifyCsrfAndOrigin(request, env, { requireJsonContentType: true });
          if (!csrf.ok) return csrfRejectResponse(csrf.code, csrf.message);

          const auth = await requireAuthenticatedOwnerDb(request, env);
          if (!auth.ok) return auth.response;

          const parsedBody = await parseJsonObject(request);
          if (!parsedBody.ok) return parsedBody.response;

          const input = createWhatsAppLogBodySchema.parse(parsedBody.data);
          const idemKey = resolveEffectiveIdempotencyKey({
            headerKey: request.headers.get("idempotency-key"),
            bodyKey: input.idempotencyKey,
            opId: input.opId,
          });

          const res = await createWhatsAppLogRecord(auth.db, auth.userId, auth.userId, input, {
            idempotencyKey: idemKey,
          });
          return jsonResponse(
            res.body,
            res.status,
            res.replayed ? { "x-idempotency-replayed": "true" } : undefined,
          );
        }

        return methodNotAllowed(["GET", "POST"]);
      }

      // GET /api/v1/whatsapp-messages/:id
      if (segments.length === 4) {
        const idSeg = decodeIdSegment(segments[3] ?? "");
        if (!idSeg.ok) return idSeg.response;
        const messageId = idSeg.value;

        if (request.method === "GET") {
          const auth = await requireAuthenticatedOwnerDb(request, env);
          if (!auth.ok) return auth.response;

          const message = await getWhatsAppLogRecord(auth.db, auth.userId, messageId);
          return jsonResponse({ ok: true, message }, 200);
        }

        return methodNotAllowed(["GET"]);
      }

      return null;
    }

    if (resource === "deals") {
      // GET|POST /api/v1/deals
      if (segments.length === 3) {
        if (request.method === "GET") {
          const auth = await requireAuthenticatedOwnerDb(request, env);
          if (!auth.ok) return auth.response;

          const query = listDealsQuerySchema.parse(searchParamsObject(parsedUrl));
          const result = await listDealsRecords(auth.db, auth.userId, query);
          return jsonResponse({ ok: true, ...result }, 200);
        }

        if (request.method === "POST") {
          const csrf = verifyCsrfAndOrigin(request, env, { requireJsonContentType: true });
          if (!csrf.ok) return csrfRejectResponse(csrf.code, csrf.message);

          const auth = await requireAuthenticatedOwnerDb(request, env);
          if (!auth.ok) return auth.response;

          const parsedBody = await parseJsonObject(request);
          if (!parsedBody.ok) return parsedBody.response;

          const input = createDealBodySchema.parse(parsedBody.data);
          const idemKey = resolveEffectiveIdempotencyKey({
            headerKey: request.headers.get("idempotency-key"),
            bodyKey: input.idempotencyKey,
            opId: input.opId,
          });

          const res = await createDealRecord(auth.db, auth.userId, auth.userId, input, {
            idempotencyKey: idemKey,
          });
          return jsonResponse(
            res.body,
            res.status,
            res.replayed ? { "x-idempotency-replayed": "true" } : undefined,
          );
        }

        return methodNotAllowed(["GET", "POST"]);
      }

      const idSeg = decodeIdSegment(segments[3] ?? "");
      if (!idSeg.ok) return idSeg.response;
      const dealId = idSeg.value;

      // GET|PATCH /api/v1/deals/:id
      if (segments.length === 4) {
        if (request.method === "GET") {
          const auth = await requireAuthenticatedOwnerDb(request, env);
          if (!auth.ok) return auth.response;

          const result = await getDealRecord(auth.db, auth.userId, dealId);
          return jsonResponse({ ok: true, ...result }, 200);
        }

        if (request.method === "PATCH") {
          const csrf = verifyCsrfAndOrigin(request, env, { requireJsonContentType: true });
          if (!csrf.ok) return csrfRejectResponse(csrf.code, csrf.message);

          const auth = await requireAuthenticatedOwnerDb(request, env);
          if (!auth.ok) return auth.response;

          const parsedBody = await parseJsonObject(request);
          if (!parsedBody.ok) return parsedBody.response;

          const input = updateDealBodySchema.parse(parsedBody.data);
          const idemKey = resolveEffectiveIdempotencyKey({
            headerKey: request.headers.get("idempotency-key"),
            bodyKey: input.idempotencyKey,
          });

          const res = await updateDealRecord(auth.db, auth.userId, auth.userId, dealId, input, {
            idempotencyKey: idemKey,
          });
          return jsonResponse(
            res.body,
            res.status,
            res.replayed ? { "x-idempotency-replayed": "true" } : undefined,
          );
        }

        return methodNotAllowed(["GET", "PATCH"]);
      }

      if (segments.length === 5) {
        const subresource = segments[4];

        // POST /api/v1/deals/:id/status
        if (subresource === "status") {
          if (request.method !== "POST") return methodNotAllowed(["POST"]);

          const csrf = verifyCsrfAndOrigin(request, env, { requireJsonContentType: true });
          if (!csrf.ok) return csrfRejectResponse(csrf.code, csrf.message);

          const auth = await requireAuthenticatedOwnerDb(request, env);
          if (!auth.ok) return auth.response;

          const parsedBody = await parseJsonObject(request);
          if (!parsedBody.ok) return parsedBody.response;

          const input = changeDealStatusBodySchema.parse(parsedBody.data);
          const idemKey = resolveEffectiveIdempotencyKey({
            headerKey: request.headers.get("idempotency-key"),
            bodyKey: input.idempotencyKey,
          });

          const res = await changeDealStatusRecord(
            auth.db,
            auth.userId,
            auth.userId,
            dealId,
            input,
            { idempotencyKey: idemKey },
          );
          return jsonResponse(
            res.body,
            res.status,
            res.replayed ? { "x-idempotency-replayed": "true" } : undefined,
          );
        }

        // POST /api/v1/deals/:id/cancel
        if (subresource === "cancel") {
          if (request.method !== "POST") return methodNotAllowed(["POST"]);

          const csrf = verifyCsrfAndOrigin(request, env, { requireJsonContentType: true });
          if (!csrf.ok) return csrfRejectResponse(csrf.code, csrf.message);

          const auth = await requireAuthenticatedOwnerDb(request, env);
          if (!auth.ok) return auth.response;

          const parsedBody = await parseJsonObject(request);
          if (!parsedBody.ok) return parsedBody.response;

          const input = cancelDealBodySchema.parse(parsedBody.data);
          const idemKey = resolveEffectiveIdempotencyKey({
            headerKey: request.headers.get("idempotency-key"),
            bodyKey: input.idempotencyKey,
          });

          const res = await cancelDealRecord(auth.db, auth.userId, auth.userId, dealId, input, {
            idempotencyKey: idemKey,
          });
          return jsonResponse(
            res.body,
            res.status,
            res.replayed ? { "x-idempotency-replayed": "true" } : undefined,
          );
        }

        // POST /api/v1/deals/:id/verify-won-date
        if (subresource === "verify-won-date") {
          if (request.method !== "POST") return methodNotAllowed(["POST"]);

          const csrf = verifyCsrfAndOrigin(request, env, { requireJsonContentType: true });
          if (!csrf.ok) return csrfRejectResponse(csrf.code, csrf.message);

          const auth = await requireAuthenticatedOwnerDb(request, env);
          if (!auth.ok) return auth.response;

          const parsedBody = await parseJsonObject(request);
          if (!parsedBody.ok) return parsedBody.response;

          const input = verifyDealWonDateBodySchema.parse(parsedBody.data);
          const idemKey = resolveEffectiveIdempotencyKey({
            headerKey: request.headers.get("idempotency-key"),
            bodyKey: input.idempotencyKey,
          });

          const res = await verifyDealWonDateRecord(
            auth.db,
            auth.userId,
            auth.userId,
            dealId,
            input,
            { idempotencyKey: idemKey },
          );
          return jsonResponse(
            res.body,
            res.status,
            res.replayed ? { "x-idempotency-replayed": "true" } : undefined,
          );
        }

        // GET /api/v1/deals/:id/summary
        if (subresource === "summary") {
          if (request.method !== "GET") return methodNotAllowed(["GET"]);

          const auth = await requireAuthenticatedOwnerDb(request, env);
          if (!auth.ok) return auth.response;

          const summary = await getDealSummaryRecord(auth.db, auth.userId, dealId);
          return jsonResponse({ ok: true, summary }, 200);
        }

        // GET /api/v1/deals/:id/audit or /api/v1/deals/:id/audit-history
        if (subresource === "audit" || subresource === "audit-history") {
          if (request.method !== "GET") return methodNotAllowed(["GET"]);

          const auth = await requireAuthenticatedOwnerDb(request, env);
          if (!auth.ok) return auth.response;

          const query = listDealAuditQuerySchema.parse(searchParamsObject(parsedUrl));
          const result = await listDealAuditHistory(auth.db, auth.userId, dealId, query);
          return jsonResponse(
            {
              ok: true,
              dealId,
              events: result.items,
              items: result.items,
              total: result.total,
              limit: result.limit,
              offset: result.offset,
            },
            200,
          );
        }

        // GET|POST /api/v1/deals/:id/payments
        if (subresource === "payments") {
          if (request.method === "GET") {
            const auth = await requireAuthenticatedOwnerDb(request, env);
            if (!auth.ok) return auth.response;

            const query = listDealPaymentsQuerySchema.parse(searchParamsObject(parsedUrl));
            const result = await listPaymentsForDeal(auth.db, auth.userId, dealId, query);
            return jsonResponse({ ok: true, ...result }, 200);
          }

          if (request.method === "POST") {
            const csrf = verifyCsrfAndOrigin(request, env, { requireJsonContentType: true });
            if (!csrf.ok) return csrfRejectResponse(csrf.code, csrf.message);

            const auth = await requireAuthenticatedOwnerDb(request, env);
            if (!auth.ok) return auth.response;

            const parsedBody = await parseJsonObject(request);
            if (!parsedBody.ok) return parsedBody.response;

            const input = createPaymentBodySchema.parse(parsedBody.data);
            const idemKey = resolveEffectiveIdempotencyKey({
              headerKey: request.headers.get("idempotency-key"),
              bodyKey: input.idempotencyKey,
              opId: input.opId,
            });

            const res = await createPaymentRecord(
              auth.db,
              auth.userId,
              auth.userId,
              dealId,
              input,
              {
                idempotencyKey: idemKey,
              },
            );
            return jsonResponse(
              res.body,
              res.status,
              res.replayed ? { "x-idempotency-replayed": "true" } : undefined,
            );
          }

          return methodNotAllowed(["GET", "POST"]);
        }
      }

      return null;
    }

    if (resource === "payments") {
      // GET|POST /api/v1/payments
      if (segments.length === 3) {
        if (request.method === "GET") {
          const auth = await requireAuthenticatedOwnerDb(request, env);
          if (!auth.ok) return auth.response;

          const query = listPaymentsQuerySchema.parse(searchParamsObject(parsedUrl));
          const result = await listAllPayments(auth.db, auth.userId, query);
          return jsonResponse({ ok: true, ...result }, 200);
        }

        if (request.method === "POST") {
          const csrf = verifyCsrfAndOrigin(request, env, { requireJsonContentType: true });
          if (!csrf.ok) return csrfRejectResponse(csrf.code, csrf.message);

          const auth = await requireAuthenticatedOwnerDb(request, env);
          if (!auth.ok) return auth.response;

          const parsedBody = await parseJsonObject(request);
          if (!parsedBody.ok) return parsedBody.response;

          const parsed = createPaymentWithDealBodySchema.parse(parsedBody.data);
          const { dealId, ...paymentInput } = parsed;
          const idemKey = resolveEffectiveIdempotencyKey({
            headerKey: request.headers.get("idempotency-key"),
            bodyKey: paymentInput.idempotencyKey,
            opId: paymentInput.opId,
          });

          const res = await createPaymentRecord(
            auth.db,
            auth.userId,
            auth.userId,
            dealId,
            paymentInput,
            { idempotencyKey: idemKey },
          );
          return jsonResponse(
            res.body,
            res.status,
            res.replayed ? { "x-idempotency-replayed": "true" } : undefined,
          );
        }

        return methodNotAllowed(["GET", "POST"]);
      }

      const idSeg = decodeIdSegment(segments[3] ?? "");
      if (!idSeg.ok) return idSeg.response;
      const paymentId = idSeg.value;

      // GET /api/v1/payments/:id
      if (segments.length === 4) {
        if (request.method === "GET") {
          const auth = await requireAuthenticatedOwnerDb(request, env);
          if (!auth.ok) return auth.response;

          const payment = await getPaymentRecord(auth.db, auth.userId, paymentId);
          return jsonResponse({ ok: true, payment }, 200);
        }

        return methodNotAllowed(["GET"]);
      }

      // POST /api/v1/payments/:id/void
      if (segments.length === 5 && segments[4] === "void") {
        if (request.method !== "POST") return methodNotAllowed(["POST"]);

        const csrf = verifyCsrfAndOrigin(request, env, { requireJsonContentType: true });
        if (!csrf.ok) return csrfRejectResponse(csrf.code, csrf.message);

        const auth = await requireAuthenticatedOwnerDb(request, env);
        if (!auth.ok) return auth.response;

        const parsedBody = await parseJsonObject(request);
        if (!parsedBody.ok) return parsedBody.response;

        const input = voidPaymentBodySchema.parse(parsedBody.data);
        const idemKey = resolveEffectiveIdempotencyKey({
          headerKey: request.headers.get("idempotency-key"),
          bodyKey: input.idempotencyKey,
          opId: input.opId,
        });

        const res = await voidPaymentRecord(auth.db, auth.userId, auth.userId, paymentId, input, {
          idempotencyKey: idemKey,
        });
        return jsonResponse(
          res.body,
          res.status,
          res.replayed ? { "x-idempotency-replayed": "true" } : undefined,
        );
      }

      // Proof subroutes: /api/v1/payments/:id/proof*
      if (segments[4] === "proof") {
        // Subresource actions: /api/v1/payments/:id/proof/:action
        if (segments.length === 6) {
          const action = segments[5];

          // POST /api/v1/payments/:id/proof/replace
          if (action === "replace") {
            if (request.method !== "POST") return methodNotAllowed(["POST"]);

            const csrf = verifyCsrfAndOrigin(request, env, { requireJsonContentType: false });
            if (!csrf.ok) return csrfRejectResponse(csrf.code, csrf.message);

            const auth = await requireAuthenticatedOwnerDb(request, env);
            if (!auth.ok) return auth.response;

            const upload = await parseProofUploadRequest(request);
            if (!upload.ok) return upload.response;

            const replaceInput = replaceProofBodySchema.parse({ reason: upload.payload.reason });
            const idemKey = resolveEffectiveIdempotencyKey({
              headerKey: request.headers.get("idempotency-key"),
              bodyKey: upload.payload.idempotencyKey,
            });

            const res = await replacePaymentProofRecord(
              auth.db,
              auth.userId,
              auth.userId,
              paymentId,
              {
                originalFileName: upload.payload.originalFileName,
                streamOrBuffer: upload.payload.fileBuffer,
              },
              replaceInput,
              { idempotencyKey: idemKey },
            );

            return jsonResponse(
              res.body,
              res.status,
              res.replayed ? { "x-idempotency-replayed": "true" } : undefined,
            );
          }

          // GET /api/v1/payments/:id/proof/download
          if (action === "download") {
            if (request.method !== "GET") return methodNotAllowed(["GET"]);

            const auth = await requireAuthenticatedOwnerDb(request, env);
            if (!auth.ok) return auth.response;

            const proofIdParam = parsedUrl.searchParams.get("proofId") || undefined;
            const downloadRes = await readPaymentProofContent(auth.db, auth.userId, paymentId, {
              proofId: proofIdParam,
            });

            const isDownload =
              parsedUrl.searchParams.get("download") === "1" ||
              parsedUrl.searchParams.get("download") === "true";
            const dispositionType = isDownload ? "attachment" : "inline";
            const safeName = downloadRes.proof.originalFileName.replace(/["\r\n\\]/g, "_");

            const headers = new Headers();
            headers.set("content-type", downloadRes.proof.mimeType);
            headers.set("content-length", String(downloadRes.byteSize));
            headers.set(
              "content-disposition",
              `${dispositionType}; filename="${safeName}"; filename*=UTF-8''${encodeURIComponent(downloadRes.proof.originalFileName)}`,
            );
            headers.set("x-content-type-options", "nosniff");
            headers.set("cache-control", "private, no-store, must-revalidate");
            headers.set("pragma", "no-cache");
            headers.set("x-frame-options", "DENY");
            headers.set("referrer-policy", "no-referrer");

            if (downloadRes.proof.mimeType === "application/pdf") {
              headers.set(
                "content-security-policy",
                "default-src 'none'; style-src 'unsafe-inline'; sandbox",
              );
            }

            const webStream = Readable.toWeb(downloadRes.stream as Readable);
            return new Response(webStream as unknown as BodyInit, { status: 200, headers });
          }

          // GET /api/v1/payments/:id/proof/history
          if (action === "history") {
            if (request.method !== "GET") return methodNotAllowed(["GET"]);

            const auth = await requireAuthenticatedOwnerDb(request, env);
            if (!auth.ok) return auth.response;

            const query = listProofHistoryQuerySchema.parse(searchParamsObject(parsedUrl));
            const result = await listPaymentProofHistory(auth.db, auth.userId, paymentId, query);
            return jsonResponse({ ok: true, ...result }, 200);
          }

          return null;
        }

        // Direct proof endpoint: /api/v1/payments/:id/proof
        if (segments.length === 5) {
          // GET /api/v1/payments/:id/proof (Active proof metadata)
          if (request.method === "GET") {
            const auth = await requireAuthenticatedOwnerDb(request, env);
            if (!auth.ok) return auth.response;

            const proof = await getActivePaymentProof(auth.db, auth.userId, paymentId);
            if (!proof) {
              throw new CrmServiceError(404, "proof_not_found", "No active payment proof found.");
            }
            return jsonResponse({ ok: true, proof }, 200);
          }

          // POST /api/v1/payments/:id/proof (Attach proof)
          if (request.method === "POST") {
            const csrf = verifyCsrfAndOrigin(request, env, { requireJsonContentType: false });
            if (!csrf.ok) return csrfRejectResponse(csrf.code, csrf.message);

            const auth = await requireAuthenticatedOwnerDb(request, env);
            if (!auth.ok) return auth.response;

            const upload = await parseProofUploadRequest(request);
            if (!upload.ok) return upload.response;

            const idemKey = resolveEffectiveIdempotencyKey({
              headerKey: request.headers.get("idempotency-key"),
              bodyKey: upload.payload.idempotencyKey,
            });

            const res = await attachPaymentProofRecord(
              auth.db,
              auth.userId,
              auth.userId,
              paymentId,
              {
                originalFileName: upload.payload.originalFileName,
                streamOrBuffer: upload.payload.fileBuffer,
              },
              { idempotencyKey: idemKey },
            );

            return jsonResponse(
              res.body,
              res.status,
              res.replayed ? { "x-idempotency-replayed": "true" } : undefined,
            );
          }

          // PUT /api/v1/payments/:id/proof (Replace proof)
          if (request.method === "PUT") {
            const csrf = verifyCsrfAndOrigin(request, env, { requireJsonContentType: false });
            if (!csrf.ok) return csrfRejectResponse(csrf.code, csrf.message);

            const auth = await requireAuthenticatedOwnerDb(request, env);
            if (!auth.ok) return auth.response;

            const upload = await parseProofUploadRequest(request);
            if (!upload.ok) return upload.response;

            const replaceInput = replaceProofBodySchema.parse({ reason: upload.payload.reason });
            const idemKey = resolveEffectiveIdempotencyKey({
              headerKey: request.headers.get("idempotency-key"),
              bodyKey: upload.payload.idempotencyKey,
            });

            const res = await replacePaymentProofRecord(
              auth.db,
              auth.userId,
              auth.userId,
              paymentId,
              {
                originalFileName: upload.payload.originalFileName,
                streamOrBuffer: upload.payload.fileBuffer,
              },
              replaceInput,
              { idempotencyKey: idemKey },
            );

            return jsonResponse(
              res.body,
              res.status,
              res.replayed ? { "x-idempotency-replayed": "true" } : undefined,
            );
          }

          // DELETE /api/v1/payments/:id/proof (Remove proof)
          if (request.method === "DELETE") {
            const csrf = verifyCsrfAndOrigin(request, env, { requireJsonContentType: false });
            if (!csrf.ok) return csrfRejectResponse(csrf.code, csrf.message);

            const auth = await requireAuthenticatedOwnerDb(request, env);
            if (!auth.ok) return auth.response;

            let reason: string | undefined;
            if (hasRequestBodyHint(request)) {
              const parsed = await parseJsonObject(request, { allowEmpty: true });
              if (parsed.ok && parsed.data["reason"]) {
                reason = String(parsed.data["reason"]);
              }
            }
            if (!reason) {
              reason =
                parsedUrl.searchParams.get("reason") ||
                request.headers.get("x-reason") ||
                undefined;
            }

            const removeInput = removeProofBodySchema.parse({ reason });
            const res = await removePaymentProofRecord(
              auth.db,
              auth.userId,
              auth.userId,
              paymentId,
              removeInput,
            );

            return jsonResponse(res.body, res.status);
          }

          return methodNotAllowed(["GET", "POST", "PUT", "DELETE"]);
        }
      }

      return null;
    }

    if (resource === "finance") {
      // GET /api/v1/finance/summary
      if (segments.length === 4 && segments[3] === "summary") {
        if (request.method !== "GET") return methodNotAllowed(["GET"]);

        const auth = await requireAuthenticatedOwnerDb(request, env);
        if (!auth.ok) return auth.response;

        const query = financeSummaryQuerySchema.parse(searchParamsObject(parsedUrl));
        const summary = await getOwnerFinanceSummary(auth.db, auth.userId, query);

        const totalBookedPaise =
          summary.totals.totalValuePaise + summary.exclusions.cancelledBookedValuePaise;
        const cashCollectedPaise =
          summary.totals.collectedPaise + summary.exclusions.cancelledDealPaymentsExcludedPaise;

        const payload = {
          ...summary,
          todayIstDate: summary.todayIstDate,
          period: ((query as Record<string, unknown>)["period"] as string) ?? "all_time",
          fromIstDate: query.from ?? null,
          toIstDate: query.to ?? null,
          totalBooked: totalBookedPaise / 100,
          totalBookedDecimal: (totalBookedPaise / 100).toFixed(2),
          totalBookedPaise,
          activeBooked: summary.totals.totalValue,
          activeBookedDecimal: summary.totals.totalValueDecimal,
          activeBookedPaise: summary.totals.totalValuePaise,
          cancelledBooked: summary.exclusions.cancelledBookedValue,
          cancelledBookedDecimal: summary.exclusions.cancelledBookedValueDecimal,
          cancelledBookedPaise: summary.exclusions.cancelledBookedValuePaise,
          cashCollected: cashCollectedPaise / 100,
          cashCollectedDecimal: (cashCollectedPaise / 100).toFixed(2),
          cashCollectedPaise,
          activeCashCollected: summary.totals.collected,
          activeCashCollectedDecimal: summary.totals.collectedDecimal,
          activeCashCollectedPaise: summary.totals.collectedPaise,
          cancelledCashCollected: summary.exclusions.cancelledDealPaymentsExcluded,
          cancelledCashCollectedDecimal: summary.exclusions.cancelledDealPaymentsExcludedDecimal,
          cancelledCashCollectedPaise: summary.exclusions.cancelledDealPaymentsExcludedPaise,
          outstanding: summary.totals.outstanding,
          outstandingDecimal: summary.totals.outstandingDecimal,
          outstandingPaise: summary.totals.outstandingPaise,
          overdue: summary.totals.overdue,
          overdueDecimal: summary.totals.overdueDecimal,
          overduePaise: summary.totals.overduePaise,
          voidedAmount: summary.exclusions.voidedAmount,
          voidedDecimal: summary.exclusions.voidedAmountDecimal,
          voidedPaise: summary.exclusions.voidedAmountPaise,
          activeDealCount:
            (summary.counts.byDealStatus.active ?? 0) +
            (summary.counts.byDealStatus.completed ?? 0) +
            (summary.counts.byDealStatus.on_hold ?? 0),
          cancelledDealCount: summary.exclusions.cancelledDealCount,
          activePaymentCount:
            (summary.counts.byPaymentStatus.paid ?? 0) +
            (summary.counts.byPaymentStatus.partial ?? 0),
          voidedPaymentCount: summary.exclusions.voidedPaymentCount,
          collectionRate: summary.totals.collectionRate,
        };
        return jsonResponse({ ok: true, summary: payload }, 200);
      }

      return null;
    }

    if (resource === "quotation-templates") {
      // GET|POST /api/v1/quotation-templates
      if (segments.length === 3) {
        if (request.method === "GET") {
          const auth = await requireAuthenticatedOwnerDb(request, env);
          if (!auth.ok) return auth.response;

          const query = listQuotationTemplatesQuerySchema.parse(searchParamsObject(parsedUrl));
          const items = await listQuotationTemplatesRecords(auth.db, auth.userId, query);
          return jsonResponse({ ok: true, items, total: items.length }, 200);
        }

        if (request.method === "POST") {
          const csrf = verifyCsrfAndOrigin(request, env, { requireJsonContentType: true });
          if (!csrf.ok) return csrfRejectResponse(csrf.code, csrf.message);

          const auth = await requireAuthenticatedOwnerDb(request, env);
          if (!auth.ok) return auth.response;

          const parsedBody = await parseJsonObject(request);
          if (!parsedBody.ok) return parsedBody.response;

          const input = createQuotationTemplateBodySchema.parse(parsedBody.data);
          const template = await createQuotationTemplateRecord(auth.db, auth.userId, input);
          return jsonResponse({ ok: true, template }, 201);
        }

        return methodNotAllowed(["GET", "POST"]);
      }

      if (segments.length === 4) {
        const seg = segments[3]!;

        // POST /api/v1/quotation-templates/reorder
        if (seg === "reorder") {
          if (request.method !== "POST") return methodNotAllowed(["POST"]);

          const csrf = verifyCsrfAndOrigin(request, env, { requireJsonContentType: true });
          if (!csrf.ok) return csrfRejectResponse(csrf.code, csrf.message);

          const auth = await requireAuthenticatedOwnerDb(request, env);
          if (!auth.ok) return auth.response;

          const parsedBody = await parseJsonObject(request);
          if (!parsedBody.ok) return parsedBody.response;

          const input = reorderQuotationTemplatesBodySchema.parse(parsedBody.data);
          const result = await reorderQuotationTemplatesRecord(
            auth.db,
            auth.userId,
            input.templateIds,
          );
          return jsonResponse({ ok: true, reorderedCount: result.reorderedCount }, 200);
        }

        const templateId = seg;

        // GET /api/v1/quotation-templates/:id
        if (request.method === "GET") {
          const auth = await requireAuthenticatedOwnerDb(request, env);
          if (!auth.ok) return auth.response;

          const template = await getQuotationTemplateRecord(auth.db, auth.userId, templateId);
          if (!template) {
            return jsonResponse(
              { ok: false, error: { code: "not_found", message: "Quotation template not found." } },
              404,
            );
          }
          return jsonResponse({ ok: true, template }, 200);
        }

        // PATCH /api/v1/quotation-templates/:id
        if (request.method === "PATCH") {
          const csrf = verifyCsrfAndOrigin(request, env, { requireJsonContentType: true });
          if (!csrf.ok) return csrfRejectResponse(csrf.code, csrf.message);

          const auth = await requireAuthenticatedOwnerDb(request, env);
          if (!auth.ok) return auth.response;

          const parsedBody = await parseJsonObject(request);
          if (!parsedBody.ok) return parsedBody.response;

          const input = updateQuotationTemplateBodySchema.parse(parsedBody.data);
          const template = await updateQuotationTemplateRecord(
            auth.db,
            auth.userId,
            templateId,
            input,
          );
          return jsonResponse({ ok: true, template }, 200);
        }

        // DELETE /api/v1/quotation-templates/:id
        if (request.method === "DELETE") {
          const csrf = verifyCsrfAndOrigin(request, env, { requireJsonContentType: false });
          if (!csrf.ok) return csrfRejectResponse(csrf.code, csrf.message);

          const auth = await requireAuthenticatedOwnerDb(request, env);
          if (!auth.ok) return auth.response;

          const template = await deleteQuotationTemplateRecord(auth.db, auth.userId, templateId);
          return jsonResponse({ ok: true, template }, 200);
        }

        return methodNotAllowed(["GET", "PATCH", "DELETE"]);
      }

      if (segments.length === 5) {
        const templateId = segments[3]!;
        const sub = segments[4]!;

        // POST /api/v1/quotation-templates/:id/duplicate
        if (sub === "duplicate") {
          if (request.method !== "POST") return methodNotAllowed(["POST"]);

          const csrf = verifyCsrfAndOrigin(request, env, { requireJsonContentType: false });
          if (!csrf.ok) return csrfRejectResponse(csrf.code, csrf.message);

          const auth = await requireAuthenticatedOwnerDb(request, env);
          if (!auth.ok) return auth.response;

          const template = await duplicateQuotationTemplateRecord(auth.db, auth.userId, templateId);
          return jsonResponse({ ok: true, template }, 201);
        }
      }

      return null;
    }

    if (resource === "quotations") {
      // GET|POST /api/v1/quotations
      if (segments.length === 3) {
        if (request.method === "GET") {
          const auth = await requireAuthenticatedOwnerDb(request, env);
          if (!auth.ok) return auth.response;

          const query = listQuotationsQuerySchema.parse(searchParamsObject(parsedUrl));
          const result = await listQuotationsRecords(auth.db, auth.userId, query);
          return jsonResponse({ ok: true, ...result }, 200);
        }

        if (request.method === "POST") {
          const csrf = verifyCsrfAndOrigin(request, env, { requireJsonContentType: true });
          if (!csrf.ok) return csrfRejectResponse(csrf.code, csrf.message);

          const auth = await requireAuthenticatedOwnerDb(request, env);
          if (!auth.ok) return auth.response;

          const parsedBody = await parseJsonObject(request);
          if (!parsedBody.ok) return parsedBody.response;

          const input = createQuotationBodySchema.parse(parsedBody.data);
          const idemKey = resolveEffectiveIdempotencyKey({
            headerKey: request.headers.get("idempotency-key"),
            bodyKey: input.idempotencyKey,
          });

          const res = await createQuotationRecord(auth.db, auth.userId, auth.userId, input, {
            idempotencyKey: idemKey,
          });
          return jsonResponse(
            res.body,
            res.status,
            res.replayed ? { "x-idempotency-replayed": "true" } : undefined,
          );
        }

        return methodNotAllowed(["GET", "POST"]);
      }

      if (segments.length === 4) {
        const quotationId = segments[3]!;

        // GET /api/v1/quotations/:id
        if (request.method === "GET") {
          const auth = await requireAuthenticatedOwnerDb(request, env);
          if (!auth.ok) return auth.response;

          const quotation = await getQuotationRecord(auth.db, auth.userId, quotationId);
          if (!quotation) {
            return jsonResponse(
              { ok: false, error: { code: "not_found", message: "Quotation not found." } },
              404,
            );
          }
          return jsonResponse({ ok: true, quotation }, 200);
        }

        // PATCH /api/v1/quotations/:id
        if (request.method === "PATCH") {
          const csrf = verifyCsrfAndOrigin(request, env, { requireJsonContentType: true });
          if (!csrf.ok) return csrfRejectResponse(csrf.code, csrf.message);

          const auth = await requireAuthenticatedOwnerDb(request, env);
          if (!auth.ok) return auth.response;

          const parsedBody = await parseJsonObject(request);
          if (!parsedBody.ok) return parsedBody.response;

          const input = updateQuotationBodySchema.parse(parsedBody.data);
          const idemKey = resolveEffectiveIdempotencyKey({
            headerKey: request.headers.get("idempotency-key"),
            bodyKey: input.idempotencyKey,
          });

          const res = await updateQuotationRecord(
            auth.db,
            auth.userId,
            auth.userId,
            quotationId,
            input,
            {
              idempotencyKey: idemKey,
            },
          );
          return jsonResponse(
            res.body,
            res.status,
            res.replayed ? { "x-idempotency-replayed": "true" } : undefined,
          );
        }

        // DELETE /api/v1/quotations/:id (archive)
        if (request.method === "DELETE") {
          const hasBody = hasRequestBodyHint(request);
          const csrf = verifyCsrfAndOrigin(request, env, { requireJsonContentType: hasBody });
          if (!csrf.ok) return csrfRejectResponse(csrf.code, csrf.message);

          const auth = await requireAuthenticatedOwnerDb(request, env);
          if (!auth.ok) return auth.response;

          let reason: string | undefined;
          let bodyIdemKey: string | undefined;
          if (hasBody) {
            const parsedBody = await parseJsonObject(request, { allowEmpty: true });
            if (!parsedBody.ok) return parsedBody.response;
            if (Object.keys(parsedBody.data).length > 0) {
              const input = archiveQuotationBodySchema.parse(parsedBody.data);
              reason = input.reason;
              bodyIdemKey = input.idempotencyKey;
            }
          }

          const idemKey = resolveEffectiveIdempotencyKey({
            headerKey: request.headers.get("idempotency-key"),
            bodyKey: bodyIdemKey,
          });

          const res = await archiveQuotationRecord(
            auth.db,
            auth.userId,
            auth.userId,
            quotationId,
            reason,
            {
              idempotencyKey: idemKey,
            },
          );
          return jsonResponse(
            res.body,
            res.status,
            res.replayed ? { "x-idempotency-replayed": "true" } : undefined,
          );
        }

        return methodNotAllowed(["GET", "PATCH", "DELETE"]);
      }

      if (segments.length === 5) {
        const quotationId = segments[3]!;
        const sub = segments[4]!;

        // POST /api/v1/quotations/:id/status
        if (sub === "status") {
          if (request.method !== "POST") return methodNotAllowed(["POST"]);

          const csrf = verifyCsrfAndOrigin(request, env, { requireJsonContentType: true });
          if (!csrf.ok) return csrfRejectResponse(csrf.code, csrf.message);

          const auth = await requireAuthenticatedOwnerDb(request, env);
          if (!auth.ok) return auth.response;

          const parsedBody = await parseJsonObject(request);
          if (!parsedBody.ok) return parsedBody.response;

          const input = changeQuotationStatusBodySchema.parse(parsedBody.data);
          const idemKey = resolveEffectiveIdempotencyKey({
            headerKey: request.headers.get("idempotency-key"),
            bodyKey: input.idempotencyKey,
          });

          const res = await changeQuotationStatusRecord(
            auth.db,
            auth.userId,
            auth.userId,
            quotationId,
            { status: input.status, reason: input.reason, expectedVersion: input.expectedVersion },
            { idempotencyKey: idemKey },
          );
          return jsonResponse(
            res.body,
            res.status,
            res.replayed ? { "x-idempotency-replayed": "true" } : undefined,
          );
        }

        // POST /api/v1/quotations/:id/archive
        if (sub === "archive") {
          if (request.method !== "POST") return methodNotAllowed(["POST"]);

          const csrf = verifyCsrfAndOrigin(request, env, { requireJsonContentType: false });
          if (!csrf.ok) return csrfRejectResponse(csrf.code, csrf.message);

          const auth = await requireAuthenticatedOwnerDb(request, env);
          if (!auth.ok) return auth.response;

          const parsedBody = await parseJsonObject(request, { allowEmpty: true });
          if (!parsedBody.ok) return parsedBody.response;

          const input = archiveQuotationBodySchema.parse(parsedBody.data);
          const idemKey = resolveEffectiveIdempotencyKey({
            headerKey: request.headers.get("idempotency-key"),
            bodyKey: input.idempotencyKey,
          });

          const res = await archiveQuotationRecord(
            auth.db,
            auth.userId,
            auth.userId,
            quotationId,
            input.reason,
            { idempotencyKey: idemKey },
          );
          return jsonResponse(
            res.body,
            res.status,
            res.replayed ? { "x-idempotency-replayed": "true" } : undefined,
          );
        }

        // POST /api/v1/quotations/:id/restore
        if (sub === "restore") {
          if (request.method !== "POST") return methodNotAllowed(["POST"]);

          const csrf = verifyCsrfAndOrigin(request, env, { requireJsonContentType: false });
          if (!csrf.ok) return csrfRejectResponse(csrf.code, csrf.message);

          const auth = await requireAuthenticatedOwnerDb(request, env);
          if (!auth.ok) return auth.response;

          const parsedBody = await parseJsonObject(request, { allowEmpty: true });
          if (!parsedBody.ok) return parsedBody.response;

          const input = restoreQuotationBodySchema.parse(parsedBody.data);
          const idemKey = resolveEffectiveIdempotencyKey({
            headerKey: request.headers.get("idempotency-key"),
            bodyKey: input.idempotencyKey,
          });

          const res = await restoreQuotationRecord(auth.db, auth.userId, auth.userId, quotationId, {
            idempotencyKey: idemKey,
          });
          return jsonResponse(
            res.body,
            res.status,
            res.replayed ? { "x-idempotency-replayed": "true" } : undefined,
          );
        }

        // GET /api/v1/quotations/:id/revisions
        if (sub === "revisions") {
          if (request.method !== "GET") return methodNotAllowed(["GET"]);

          const auth = await requireAuthenticatedOwnerDb(request, env);
          if (!auth.ok) return auth.response;

          const query = listQuotationRevisionsQuerySchema.parse(searchParamsObject(parsedUrl));
          const result = await listQuotationRevisionsRecord(
            auth.db,
            auth.userId,
            quotationId,
            query,
          );
          return jsonResponse({ ok: true, quotationId, ...result }, 200);
        }

        // GET /api/v1/quotations/:id/audit
        if (sub === "audit") {
          if (request.method !== "GET") return methodNotAllowed(["GET"]);

          const auth = await requireAuthenticatedOwnerDb(request, env);
          if (!auth.ok) return auth.response;

          const query = listQuotationAuditQuerySchema.parse(searchParamsObject(parsedUrl));
          const result = await listQuotationAuditEventsRecord(
            auth.db,
            auth.userId,
            quotationId,
            query,
          );
          return jsonResponse({ ok: true, quotationId, ...result }, 200);
        }
      }

      return null;
    }

    // =======================================================================
    // PROJECTS & PROJECT WORKSPACE (CHECKPOINT B5A)
    // =======================================================================
    if (resource === "projects") {
      // GET /api/v1/projects/summary/metrics
      if (segments.length === 5 && segments[3] === "summary" && segments[4] === "metrics") {
        if (request.method !== "GET") return methodNotAllowed(["GET"]);

        const auth = await requireAuthenticatedOwnerDb(request, env);
        if (!auth.ok) return auth.response;

        const overview = await getProjectOverviewMetricsRecord(auth.db, auth.userId);
        return jsonResponse({ ok: true, ...overview }, 200);
      }

      // GET|POST /api/v1/projects
      if (segments.length === 3) {
        if (request.method === "GET") {
          const auth = await requireAuthenticatedOwnerDb(request, env);
          if (!auth.ok) return auth.response;

          const query = listProjectsQuerySchema.parse(searchParamsObject(parsedUrl));
          const result = await listProjectsRecords(auth.db, auth.userId, query);
          return jsonResponse({ ok: true, ...result }, 200);
        }

        if (request.method === "POST") {
          const csrf = verifyCsrfAndOrigin(request, env, { requireJsonContentType: true });
          if (!csrf.ok) return csrfRejectResponse(csrf.code, csrf.message);

          const auth = await requireAuthenticatedOwnerDb(request, env);
          if (!auth.ok) return auth.response;

          const parsedBody = await parseJsonObject(request);
          if (!parsedBody.ok) return parsedBody.response;

          const input = createProjectBodySchema.parse(parsedBody.data);
          const idempotencyKey = resolveEffectiveIdempotencyKey({
            headerKey: request.headers.get("idempotency-key"),
            bodyKey: input.idempotencyKey,
          });

          const result = await createProjectRecord(auth.db, auth.userId, auth.userId, {
            ...input,
            idempotencyKey: idempotencyKey ?? undefined,
          });

          return jsonResponse(
            result.body,
            result.status,
            result.replayed ? { "x-idempotent-replay": "true" } : undefined,
          );
        }

        return methodNotAllowed(["GET", "POST"]);
      }

      // Routes under /api/v1/projects/:id
      if (segments.length >= 4) {
        const projectId = segments[3]!;

        // GET /api/v1/projects/:id
        if (segments.length === 4) {
          if (request.method === "GET") {
            const auth = await requireAuthenticatedOwnerDb(request, env);
            if (!auth.ok) return auth.response;

            const details = await getProjectDetailsRecord(auth.db, auth.userId, projectId);
            if (!details) {
              return jsonResponse(
                { ok: false, error: { code: "project_not_found", message: "Project not found." } },
                404,
              );
            }
            return jsonResponse({ ok: true, ...details }, 200);
          }

          if (request.method === "PATCH") {
            const csrf = verifyCsrfAndOrigin(request, env, { requireJsonContentType: true });
            if (!csrf.ok) return csrfRejectResponse(csrf.code, csrf.message);

            const auth = await requireAuthenticatedOwnerDb(request, env);
            if (!auth.ok) return auth.response;

            const parsedBody = await parseJsonObject(request);
            if (!parsedBody.ok) return parsedBody.response;

            const input = updateProjectBodySchema.parse(parsedBody.data);
            const project = await updateProjectRecord(
              auth.db,
              auth.userId,
              auth.userId,
              projectId,
              input,
            );
            return jsonResponse({ ok: true, project }, 200);
          }

          return methodNotAllowed(["GET", "PATCH"]);
        }

        const sub = segments[4];

        // POST /api/v1/projects/:id/status
        if (sub === "status" && segments.length === 5) {
          if (request.method !== "POST") return methodNotAllowed(["POST"]);

          const csrf = verifyCsrfAndOrigin(request, env, { requireJsonContentType: true });
          if (!csrf.ok) return csrfRejectResponse(csrf.code, csrf.message);

          const auth = await requireAuthenticatedOwnerDb(request, env);
          if (!auth.ok) return auth.response;

          const parsedBody = await parseJsonObject(request);
          if (!parsedBody.ok) return parsedBody.response;

          const input = setProjectStatusBodySchema.parse(parsedBody.data);
          const project = await setProjectStatusRecord(
            auth.db,
            auth.userId,
            auth.userId,
            projectId,
            input,
          );
          return jsonResponse({ ok: true, project }, 200);
        }

        // POST /api/v1/projects/:id/stage
        if (sub === "stage" && segments.length === 5) {
          if (request.method !== "POST") return methodNotAllowed(["POST"]);

          const csrf = verifyCsrfAndOrigin(request, env, { requireJsonContentType: true });
          if (!csrf.ok) return csrfRejectResponse(csrf.code, csrf.message);

          const auth = await requireAuthenticatedOwnerDb(request, env);
          if (!auth.ok) return auth.response;

          const parsedBody = await parseJsonObject(request);
          if (!parsedBody.ok) return parsedBody.response;

          const input = moveProjectStageBodySchema.parse(parsedBody.data);
          const result = await moveProjectStageRecord(
            auth.db,
            auth.userId,
            auth.userId,
            projectId,
            input,
          );
          return jsonResponse({ ok: true, ...result }, 200);
        }

        // POST /api/v1/projects/:id/stage/undo
        if (sub === "stage" && segments.length === 6 && segments[5] === "undo") {
          if (request.method !== "POST") return methodNotAllowed(["POST"]);

          const csrf = verifyCsrfAndOrigin(request, env, { requireJsonContentType: true });
          if (!csrf.ok) return csrfRejectResponse(csrf.code, csrf.message);

          const auth = await requireAuthenticatedOwnerDb(request, env);
          if (!auth.ok) return auth.response;

          const parsedBody = await parseJsonObject(request);
          if (!parsedBody.ok) return parsedBody.response;

          const input = undoProjectStageBodySchema.parse(parsedBody.data);
          const project = await undoProjectStageRecord(
            auth.db,
            auth.userId,
            auth.userId,
            projectId,
            input,
          );
          return jsonResponse({ ok: true, project }, 200);
        }

        // POST /api/v1/projects/:id/delivery
        if (sub === "delivery" && segments.length === 5) {
          if (request.method !== "POST") return methodNotAllowed(["POST"]);

          const csrf = verifyCsrfAndOrigin(request, env, { requireJsonContentType: true });
          if (!csrf.ok) return csrfRejectResponse(csrf.code, csrf.message);

          const auth = await requireAuthenticatedOwnerDb(request, env);
          if (!auth.ok) return auth.response;

          const parsedBody = await parseJsonObject(request);
          if (!parsedBody.ok) return parsedBody.response;

          const input = deliverProjectBodySchema.parse(parsedBody.data);
          const project = await deliverProjectRecord(
            auth.db,
            auth.userId,
            auth.userId,
            projectId,
            input,
          );
          return jsonResponse({ ok: true, project }, 200);
        }

        // POST /api/v1/projects/:id/support
        if (sub === "support" && segments.length === 5) {
          if (request.method !== "POST") return methodNotAllowed(["POST"]);

          const csrf = verifyCsrfAndOrigin(request, env, { requireJsonContentType: true });
          if (!csrf.ok) return csrfRejectResponse(csrf.code, csrf.message);

          const auth = await requireAuthenticatedOwnerDb(request, env);
          if (!auth.ok) return auth.response;

          const parsedBody = await parseJsonObject(request);
          if (!parsedBody.ok) return parsedBody.response;

          const input = configureProjectSupportBodySchema.parse(parsedBody.data);
          const project = await configureProjectSupportRecord(
            auth.db,
            auth.userId,
            auth.userId,
            projectId,
            input,
          );
          return jsonResponse({ ok: true, project }, 200);
        }

        // POST /api/v1/projects/:id/archive
        if (sub === "archive" && segments.length === 5) {
          if (request.method !== "POST") return methodNotAllowed(["POST"]);

          const csrf = verifyCsrfAndOrigin(request, env, { requireJsonContentType: true });
          if (!csrf.ok) return csrfRejectResponse(csrf.code, csrf.message);

          const auth = await requireAuthenticatedOwnerDb(request, env);
          if (!auth.ok) return auth.response;

          const parsedBody = await parseJsonObject(request);
          if (!parsedBody.ok) return parsedBody.response;

          const input = archiveProjectBodySchema.parse(parsedBody.data);
          const result = await archiveProjectRecord(
            auth.db,
            auth.userId,
            auth.userId,
            projectId,
            input,
          );
          return jsonResponse({ ok: true, ...result }, 200);
        }

        // POST /api/v1/projects/:id/notes
        if (sub === "notes" && segments.length === 5) {
          if (request.method !== "POST") return methodNotAllowed(["POST"]);

          const csrf = verifyCsrfAndOrigin(request, env, { requireJsonContentType: true });
          if (!csrf.ok) return csrfRejectResponse(csrf.code, csrf.message);

          const auth = await requireAuthenticatedOwnerDb(request, env);
          if (!auth.ok) return auth.response;

          const parsedBody = await parseJsonObject(request);
          if (!parsedBody.ok) return parsedBody.response;

          const input = addProjectNoteBodySchema.parse(parsedBody.data);
          const event = await addProjectNoteRecord(
            auth.db,
            auth.userId,
            auth.userId,
            projectId,
            input.text,
          );
          return jsonResponse({ ok: true, event }, 201);
        }

        // POST /api/v1/projects/:id/checklists/:list/toggle
        if (sub === "checklists" && segments.length === 7 && segments[6] === "toggle") {
          if (request.method !== "POST") return methodNotAllowed(["POST"]);

          const listName = segments[5];
          if (listName !== "requirements" && listName !== "qa" && listName !== "handover") {
            return jsonResponse(
              {
                ok: false,
                error: { code: "validation_error", message: "Invalid checklist name." },
              },
              400,
            );
          }

          const csrf = verifyCsrfAndOrigin(request, env, { requireJsonContentType: true });
          if (!csrf.ok) return csrfRejectResponse(csrf.code, csrf.message);

          const auth = await requireAuthenticatedOwnerDb(request, env);
          if (!auth.ok) return auth.response;

          const parsedBody = await parseJsonObject(request);
          if (!parsedBody.ok) return parsedBody.response;

          const input = toggleChecklistItemBodySchema.parse(parsedBody.data);
          const project = await toggleChecklistItemRecord(
            auth.db,
            auth.userId,
            auth.userId,
            projectId,
            listName,
            input.itemId,
            input.expectedVersion,
          );
          return jsonResponse({ ok: true, project }, 200);
        }

        // POST /api/v1/projects/:id/dependencies/toggle
        if (sub === "dependencies" && segments.length === 6 && segments[5] === "toggle") {
          if (request.method !== "POST") return methodNotAllowed(["POST"]);

          const csrf = verifyCsrfAndOrigin(request, env, { requireJsonContentType: true });
          if (!csrf.ok) return csrfRejectResponse(csrf.code, csrf.message);

          const auth = await requireAuthenticatedOwnerDb(request, env);
          if (!auth.ok) return auth.response;

          const parsedBody = await parseJsonObject(request);
          if (!parsedBody.ok) return parsedBody.response;

          const input = toggleDependencyItemBodySchema.parse(parsedBody.data);
          const project = await toggleDependencyItemRecord(
            auth.db,
            auth.userId,
            auth.userId,
            projectId,
            input.depId,
            input.expectedVersion,
          );
          return jsonResponse({ ok: true, project }, 200);
        }

        // POST /api/v1/projects/:id/milestones
        if (sub === "milestones" && segments.length === 5) {
          if (request.method !== "POST") return methodNotAllowed(["POST"]);

          const csrf = verifyCsrfAndOrigin(request, env, { requireJsonContentType: true });
          if (!csrf.ok) return csrfRejectResponse(csrf.code, csrf.message);

          const auth = await requireAuthenticatedOwnerDb(request, env);
          if (!auth.ok) return auth.response;

          const parsedBody = await parseJsonObject(request);
          if (!parsedBody.ok) return parsedBody.response;

          const input = createMilestoneBodySchema.parse(parsedBody.data);
          const milestone = await createMilestoneRecord(
            auth.db,
            auth.userId,
            auth.userId,
            projectId,
            input,
          );
          return jsonResponse({ ok: true, milestone }, 201);
        }

        // POST /api/v1/projects/:id/tasks
        if (sub === "tasks" && segments.length === 5) {
          if (request.method !== "POST") return methodNotAllowed(["POST"]);

          const csrf = verifyCsrfAndOrigin(request, env, { requireJsonContentType: true });
          if (!csrf.ok) return csrfRejectResponse(csrf.code, csrf.message);

          const auth = await requireAuthenticatedOwnerDb(request, env);
          if (!auth.ok) return auth.response;

          const parsedBody = await parseJsonObject(request);
          if (!parsedBody.ok) return parsedBody.response;

          const input = createTaskBodySchema.parse(parsedBody.data);
          const idempotencyKey = resolveEffectiveIdempotencyKey({
            headerKey: request.headers.get("idempotency-key"),
            bodyKey: input.idempotencyKey,
          });

          const result = await createTaskRecord(auth.db, auth.userId, auth.userId, projectId, {
            ...input,
            idempotencyKey: idempotencyKey ?? undefined,
          });

          return jsonResponse(
            result.body,
            result.status,
            result.replayed ? { "x-idempotent-replay": "true" } : undefined,
          );
        }

        // POST /api/v1/projects/:id/deliverables
        if (sub === "deliverables" && segments.length === 5) {
          if (request.method !== "POST") return methodNotAllowed(["POST"]);

          const csrf = verifyCsrfAndOrigin(request, env, { requireJsonContentType: true });
          if (!csrf.ok) return csrfRejectResponse(csrf.code, csrf.message);

          const auth = await requireAuthenticatedOwnerDb(request, env);
          if (!auth.ok) return auth.response;

          const parsedBody = await parseJsonObject(request);
          if (!parsedBody.ok) return parsedBody.response;

          const input = createDeliverableBodySchema.parse(parsedBody.data);
          const idempotencyKey = resolveEffectiveIdempotencyKey({
            headerKey: request.headers.get("idempotency-key"),
            bodyKey: input.idempotencyKey,
          });

          const result = await createDeliverableRecord(
            auth.db,
            auth.userId,
            auth.userId,
            projectId,
            {
              ...input,
              idempotencyKey: idempotencyKey ?? undefined,
            },
          );

          return jsonResponse(
            result.body,
            result.status,
            result.replayed ? { "x-idempotent-replay": "true" } : undefined,
          );
        }

        // POST /api/v1/projects/:id/support-tickets
        if (sub === "support-tickets" && segments.length === 5) {
          if (request.method !== "POST") return methodNotAllowed(["POST"]);

          const csrf = verifyCsrfAndOrigin(request, env, { requireJsonContentType: true });
          if (!csrf.ok) return csrfRejectResponse(csrf.code, csrf.message);

          const auth = await requireAuthenticatedOwnerDb(request, env);
          if (!auth.ok) return auth.response;

          const parsedBody = await parseJsonObject(request);
          if (!parsedBody.ok) return parsedBody.response;

          const input = createSupportTicketBodySchema.parse(parsedBody.data);
          const idempotencyKey = resolveEffectiveIdempotencyKey({
            headerKey: request.headers.get("idempotency-key"),
            bodyKey: input.idempotencyKey,
          });

          const result = await createSupportTicketRecord(
            auth.db,
            auth.userId,
            auth.userId,
            projectId,
            {
              ...input,
              idempotencyKey: idempotencyKey ?? undefined,
            },
          );

          return jsonResponse(
            result.body,
            result.status,
            result.replayed ? { "x-idempotent-replay": "true" } : undefined,
          );
        }
      }

      return null;
    }

    // =======================================================================
    // MILESTONES INDEPENDENT ENDPOINTS
    // =======================================================================
    if (resource === "project-milestones") {
      if (segments.length === 4) {
        const milestoneId = segments[3]!;
        if (request.method === "PATCH") {
          const csrf = verifyCsrfAndOrigin(request, env, { requireJsonContentType: true });
          if (!csrf.ok) return csrfRejectResponse(csrf.code, csrf.message);

          const auth = await requireAuthenticatedOwnerDb(request, env);
          if (!auth.ok) return auth.response;

          const parsedBody = await parseJsonObject(request);
          if (!parsedBody.ok) return parsedBody.response;

          const input = updateMilestoneBodySchema.parse(parsedBody.data);
          const milestone = await updateMilestoneRecord(
            auth.db,
            auth.userId,
            auth.userId,
            milestoneId,
            input,
          );
          return jsonResponse({ ok: true, milestone }, 200);
        }

        return methodNotAllowed(["PATCH"]);
      }

      return null;
    }

    // =======================================================================
    // TASKS INDEPENDENT ENDPOINTS
    // =======================================================================
    if (resource === "tasks") {
      if (segments.length >= 4) {
        const taskId = segments[3]!;

        // PATCH /api/v1/tasks/:id
        if (segments.length === 4) {
          if (request.method === "PATCH") {
            const csrf = verifyCsrfAndOrigin(request, env, { requireJsonContentType: true });
            if (!csrf.ok) return csrfRejectResponse(csrf.code, csrf.message);

            const auth = await requireAuthenticatedOwnerDb(request, env);
            if (!auth.ok) return auth.response;

            const parsedBody = await parseJsonObject(request);
            if (!parsedBody.ok) return parsedBody.response;

            const input = updateTaskBodySchema.parse(parsedBody.data);
            const task = await updateTaskRecord(auth.db, auth.userId, auth.userId, taskId, input);
            return jsonResponse({ ok: true, task }, 200);
          }

          return methodNotAllowed(["PATCH"]);
        }

        const sub = segments[4];

        // POST /api/v1/tasks/:id/done
        if (sub === "done" && segments.length === 5) {
          if (request.method !== "POST") return methodNotAllowed(["POST"]);

          const csrf = verifyCsrfAndOrigin(request, env, { requireJsonContentType: true });
          if (!csrf.ok) return csrfRejectResponse(csrf.code, csrf.message);

          const auth = await requireAuthenticatedOwnerDb(request, env);
          if (!auth.ok) return auth.response;

          const parsedBody = await parseJsonObject(request);
          if (!parsedBody.ok) return parsedBody.response;

          const input = completeTaskBodySchema.parse(parsedBody.data);
          const task = await setTaskDoneRecord(
            auth.db,
            auth.userId,
            auth.userId,
            taskId,
            input.done,
            input.expectedVersion,
          );
          return jsonResponse({ ok: true, task }, 200);
        }
      }

      return null;
    }

    // =======================================================================
    // DELIVERABLES REVISIONS ENDPOINTS
    // =======================================================================
    if (resource === "deliverables") {
      if (segments.length === 5 && segments[4] === "revisions") {
        const deliverableId = segments[3]!;
        if (request.method !== "POST") return methodNotAllowed(["POST"]);

        const csrf = verifyCsrfAndOrigin(request, env, { requireJsonContentType: true });
        if (!csrf.ok) return csrfRejectResponse(csrf.code, csrf.message);

        const auth = await requireAuthenticatedOwnerDb(request, env);
        if (!auth.ok) return auth.response;

        const parsedBody = await parseJsonObject(request);
        if (!parsedBody.ok) return parsedBody.response;

        const input = addDeliverableRevisionBodySchema.parse(parsedBody.data);
        const result = await addDeliverableRevisionRecord(
          auth.db,
          auth.userId,
          auth.userId,
          deliverableId,
          input,
        );
        return jsonResponse({ ok: true, ...result }, 201);
      }

      return null;
    }

    // =======================================================================
    // SUPPORT TICKETS ENDPOINTS
    // =======================================================================
    if (resource === "support-tickets") {
      if (segments.length >= 4) {
        const ticketId = segments[3]!;

        // PATCH /api/v1/support-tickets/:id
        if (segments.length === 4) {
          if (request.method === "PATCH") {
            const csrf = verifyCsrfAndOrigin(request, env, { requireJsonContentType: true });
            if (!csrf.ok) return csrfRejectResponse(csrf.code, csrf.message);

            const auth = await requireAuthenticatedOwnerDb(request, env);
            if (!auth.ok) return auth.response;

            const parsedBody = await parseJsonObject(request);
            if (!parsedBody.ok) return parsedBody.response;

            const input = updateSupportTicketBodySchema.parse(parsedBody.data);
            const ticket = await updateSupportTicketRecord(
              auth.db,
              auth.userId,
              auth.userId,
              ticketId,
              input,
            );
            return jsonResponse({ ok: true, ticket }, 200);
          }

          return methodNotAllowed(["PATCH"]);
        }

        const sub = segments[4];

        // POST /api/v1/support-tickets/:id/resolve
        if (sub === "resolve" && segments.length === 5) {
          if (request.method !== "POST") return methodNotAllowed(["POST"]);

          const csrf = verifyCsrfAndOrigin(request, env, { requireJsonContentType: true });
          if (!csrf.ok) return csrfRejectResponse(csrf.code, csrf.message);

          const auth = await requireAuthenticatedOwnerDb(request, env);
          if (!auth.ok) return auth.response;

          const parsedBody = await parseJsonObject(request);
          if (!parsedBody.ok) return parsedBody.response;

          const input = resolveSupportTicketBodySchema.parse(parsedBody.data);
          const ticket = await resolveSupportTicketRecord(
            auth.db,
            auth.userId,
            auth.userId,
            ticketId,
            input.resolution,
            input.expectedVersion,
          );
          return jsonResponse({ ok: true, ticket }, 200);
        }

        // POST /api/v1/support-tickets/:id/reopen
        if (sub === "reopen" && segments.length === 5) {
          if (request.method !== "POST") return methodNotAllowed(["POST"]);

          const csrf = verifyCsrfAndOrigin(request, env, { requireJsonContentType: true });
          if (!csrf.ok) return csrfRejectResponse(csrf.code, csrf.message);

          const auth = await requireAuthenticatedOwnerDb(request, env);
          if (!auth.ok) return auth.response;

          const parsedBody = await parseJsonObject(request, { allowEmpty: true });
          if (!parsedBody.ok) return parsedBody.response;

          const input = reopenSupportTicketBodySchema.parse(parsedBody.data ?? {});
          const ticket = await reopenSupportTicketRecord(
            auth.db,
            auth.userId,
            auth.userId,
            ticketId,
            input.reason,
            input.expectedVersion,
          );
          return jsonResponse({ ok: true, ticket }, 200);
        }
      }

      return null;
    }

    // =======================================================================
    // PROJECT TEMPLATES ENDPOINTS
    // =======================================================================
    if (resource === "project-templates") {
      if (segments.length === 3) {
        if (request.method === "GET") {
          const auth = await requireAuthenticatedOwnerDb(request, env);
          if (!auth.ok) return auth.response;

          const query = listProjectTemplatesQuerySchema.parse(searchParamsObject(parsedUrl));
          const templates = await listProjectTemplatesRecord(
            auth.db,
            auth.userId,
            query.includeArchived,
          );
          return jsonResponse({ ok: true, items: templates }, 200);
        }

        if (request.method === "POST") {
          const csrf = verifyCsrfAndOrigin(request, env, { requireJsonContentType: true });
          if (!csrf.ok) return csrfRejectResponse(csrf.code, csrf.message);

          const auth = await requireAuthenticatedOwnerDb(request, env);
          if (!auth.ok) return auth.response;

          const parsedBody = await parseJsonObject(request);
          if (!parsedBody.ok) return parsedBody.response;

          const input = saveProjectTemplateBodySchema.parse(parsedBody.data);
          const template = await saveProjectTemplateRecord(auth.db, auth.userId, input);
          return jsonResponse({ ok: true, template }, 200);
        }

        return methodNotAllowed(["GET", "POST"]);
      }

      return null;
    }

    // =======================================================================
    // ANALYTICS & REPORTING ENDPOINTS (B5C)
    // =======================================================================
    if (resource === "analytics") {
      const sub = segments[3];
      const KNOWN_SUBS = [
        "dashboard",
        "funnel",
        "communications",
        "finance",
        "quotations",
        "projects",
        "performance",
        "trends",
      ];

      if (segments.length === 4 && sub && KNOWN_SUBS.includes(sub)) {
        if (request.method !== "GET") {
          return methodNotAllowed(["GET"]);
        }

        const auth = await requireAuthenticatedOwnerDb(request, env);
        if (!auth.ok) return auth.response;

        const rawQuery = searchParamsObject(parsedUrl);
        const query = analyticsQuerySchema.parse(rawQuery);
        const period = (query.period as AnalyticsPeriod) || undefined;

        if (sub === "dashboard") {
          const result = await getDashboardOverview(auth.db, auth.userId);
          return jsonResponse(result, 200);
        }

        if (sub === "funnel") {
          const result = await getFunnelAnalytics(
            auth.db,
            auth.userId,
            period,
            query.from,
            query.to,
          );
          return jsonResponse(result, 200);
        }

        if (sub === "communications") {
          const result = await getCommunicationsAnalytics(
            auth.db,
            auth.userId,
            period,
            query.from,
            query.to,
          );
          return jsonResponse(result, 200);
        }

        if (sub === "finance") {
          const result = await getFinanceAnalytics(
            auth.db,
            auth.userId,
            period,
            query.from,
            query.to,
          );
          return jsonResponse(result, 200);
        }

        if (sub === "quotations") {
          const result = await getQuotationsAnalytics(
            auth.db,
            auth.userId,
            period,
            query.from,
            query.to,
          );
          return jsonResponse(result, 200);
        }

        if (sub === "projects") {
          const result = await getProjectsAnalytics(
            auth.db,
            auth.userId,
            period,
            query.from,
            query.to,
          );
          return jsonResponse(result, 200);
        }

        if (sub === "performance") {
          const result = await getPerformanceAnalytics(
            auth.db,
            auth.userId,
            period,
            query.from,
            query.to,
          );
          return jsonResponse(result, 200);
        }

        if (sub === "trends") {
          const result = await getTrendsAnalytics(
            auth.db,
            auth.userId,
            period,
            query.granularity as Granularity,
            query.from,
            query.to,
          );
          return jsonResponse(result, 200);
        }
      }

      return null;
    }

    // =======================================================================
    // OWNER BUSINESS SETTINGS & DEFINITIONS ENDPOINTS (B6A)
    // =======================================================================
    if (resource === "settings") {
      // GET|PUT|PATCH /api/v1/settings
      if (segments.length === 3) {
        if (request.method === "GET") {
          const auth = await requireAuthenticatedOwnerDb(request, env);
          if (!auth.ok) return auth.response;

          const settings = await getOwnerSettingsRecord(auth.db, auth.userId);
          return jsonResponse({ ok: true, settings }, 200);
        }

        if (request.method === "PUT" || request.method === "PATCH") {
          const csrf = verifyCsrfAndOrigin(request, env, { requireJsonContentType: true });
          if (!csrf.ok) return csrfRejectResponse(csrf.code, csrf.message);

          const auth = await requireAuthenticatedOwnerDb(request, env);
          if (!auth.ok) return auth.response;

          const parsedBody = await parseJsonObject(request);
          if (!parsedBody.ok) return parsedBody.response;

          const input = parseUpdateSettingsBody(parsedBody.data);
          const idemKey = resolveEffectiveIdempotencyKey({
            headerKey: request.headers.get("idempotency-key"),
            bodyKey: input.idempotencyKey,
          });

          const res = await updateOwnerSettingsRecord(auth.db, auth.userId, auth.userId, input, {
            idempotencyKey: idemKey,
          });
          return jsonResponse(
            res.body,
            res.status,
            res.replayed ? { "x-idempotency-replayed": "true" } : undefined,
          );
        }

        return methodNotAllowed(["GET", "PUT", "PATCH"]);
      }

      const sub = segments[3];

      // GET /api/v1/settings/definitions
      if (segments.length === 4 && sub === "definitions") {
        if (request.method !== "GET") return methodNotAllowed(["GET"]);

        const auth = await requireAuthenticatedOwnerDb(request, env);
        if (!auth.ok) return auth.response;

        return jsonResponse(getSettingsDefinitionsRecord(), 200);
      }

      // GET /api/v1/settings/audit
      if (segments.length === 4 && sub === "audit") {
        if (request.method !== "GET") return methodNotAllowed(["GET"]);

        const auth = await requireAuthenticatedOwnerDb(request, env);
        if (!auth.ok) return auth.response;

        const query = listSettingsAuditQuerySchema.parse(searchParamsObject(parsedUrl));
        const result = await listSettingsAuditEventsRecord(auth.db, auth.userId, query);
        return jsonResponse({ ok: true, ...result }, 200);
      }

      return null;
    }

    // =======================================================================
    // OWNER SALES GOALS & GOAL PROGRESS ENDPOINTS (B6A)
    // =======================================================================
    if (resource === "goals") {
      // GET|POST /api/v1/goals
      if (segments.length === 3) {
        if (request.method === "GET") {
          const auth = await requireAuthenticatedOwnerDb(request, env);
          if (!auth.ok) return auth.response;

          const query = listGoalsQuerySchema.parse(searchParamsObject(parsedUrl));
          const result = await listGoalsRecord(auth.db, auth.userId, query);
          return jsonResponse({ ok: true, ...result }, 200);
        }

        if (request.method === "POST") {
          const csrf = verifyCsrfAndOrigin(request, env, { requireJsonContentType: true });
          if (!csrf.ok) return csrfRejectResponse(csrf.code, csrf.message);

          const auth = await requireAuthenticatedOwnerDb(request, env);
          if (!auth.ok) return auth.response;

          const parsedBody = await parseJsonObject(request);
          if (!parsedBody.ok) return parsedBody.response;

          const input = parseCreateGoalBody(parsedBody.data);
          const idemKey = resolveEffectiveIdempotencyKey({
            headerKey: request.headers.get("idempotency-key"),
            bodyKey: input.idempotencyKey,
          });

          const res = await createGoalRecord(auth.db, auth.userId, auth.userId, input, {
            idempotencyKey: idemKey,
          });
          return jsonResponse(
            res.body,
            res.status,
            res.replayed ? { "x-idempotency-replayed": "true" } : undefined,
          );
        }

        return methodNotAllowed(["GET", "POST"]);
      }

      // GET /api/v1/goals/progress
      if (segments.length === 4 && segments[3] === "progress") {
        if (request.method !== "GET") return methodNotAllowed(["GET"]);

        const auth = await requireAuthenticatedOwnerDb(request, env);
        if (!auth.ok) return auth.response;

        const query = goalProgressQuerySchema.parse(searchParamsObject(parsedUrl));
        const result = await listActiveGoalsProgressRecord(auth.db, auth.userId, query);
        return jsonResponse(result, 200);
      }

      const idSeg = decodeIdSegment(segments[3] ?? "");
      if (!idSeg.ok) return idSeg.response;
      const goalId = idSeg.value;

      // GET|PATCH /api/v1/goals/:id
      if (segments.length === 4) {
        if (request.method === "GET") {
          const auth = await requireAuthenticatedOwnerDb(request, env);
          if (!auth.ok) return auth.response;

          const result = await getGoalRecord(auth.db, auth.userId, goalId);
          return jsonResponse({ ok: true, ...result }, 200);
        }

        if (request.method === "PATCH") {
          const csrf = verifyCsrfAndOrigin(request, env, { requireJsonContentType: true });
          if (!csrf.ok) return csrfRejectResponse(csrf.code, csrf.message);

          const auth = await requireAuthenticatedOwnerDb(request, env);
          if (!auth.ok) return auth.response;

          const parsedBody = await parseJsonObject(request);
          if (!parsedBody.ok) return parsedBody.response;

          const input = parseUpdateGoalBody(parsedBody.data);
          const idemKey = resolveEffectiveIdempotencyKey({
            headerKey: request.headers.get("idempotency-key"),
            bodyKey: input.idempotencyKey,
          });

          const res = await updateGoalRecord(auth.db, auth.userId, auth.userId, goalId, input, {
            idempotencyKey: idemKey,
          });
          return jsonResponse(
            res.body,
            res.status,
            res.replayed ? { "x-idempotency-replayed": "true" } : undefined,
          );
        }

        return methodNotAllowed(["GET", "PATCH"]);
      }

      if (segments.length === 5) {
        const sub = segments[4];

        // POST|PATCH /api/v1/goals/:id/status
        if (sub === "status") {
          if (request.method !== "POST" && request.method !== "PATCH") {
            return methodNotAllowed(["POST", "PATCH"]);
          }

          const csrf = verifyCsrfAndOrigin(request, env, { requireJsonContentType: true });
          if (!csrf.ok) return csrfRejectResponse(csrf.code, csrf.message);

          const auth = await requireAuthenticatedOwnerDb(request, env);
          if (!auth.ok) return auth.response;

          const parsedBody = await parseJsonObject(request);
          if (!parsedBody.ok) return parsedBody.response;

          const input = changeGoalStatusBodySchema.parse(parsedBody.data);
          const idemKey = resolveEffectiveIdempotencyKey({
            headerKey: request.headers.get("idempotency-key"),
            bodyKey: input.idempotencyKey,
          });

          const res = await changeGoalStatusRecord(
            auth.db,
            auth.userId,
            auth.userId,
            goalId,
            input,
            { idempotencyKey: idemKey },
          );
          return jsonResponse(
            res.body,
            res.status,
            res.replayed ? { "x-idempotency-replayed": "true" } : undefined,
          );
        }

        // POST /api/v1/goals/:id/archive
        if (sub === "archive") {
          if (request.method !== "POST") return methodNotAllowed(["POST"]);

          const hasBody = hasRequestBodyHint(request);
          const csrf = verifyCsrfAndOrigin(request, env, { requireJsonContentType: hasBody });
          if (!csrf.ok) return csrfRejectResponse(csrf.code, csrf.message);

          const auth = await requireAuthenticatedOwnerDb(request, env);
          if (!auth.ok) return auth.response;

          const parsedBody = await parseJsonObject(request, { allowEmpty: true });
          if (!parsedBody.ok) return parsedBody.response;

          const input = archiveGoalBodySchema.parse(parsedBody.data);
          const idemKey = resolveEffectiveIdempotencyKey({
            headerKey: request.headers.get("idempotency-key"),
            bodyKey: input.idempotencyKey,
          });

          const res = await archiveGoalRecord(auth.db, auth.userId, auth.userId, goalId, input, {
            idempotencyKey: idemKey,
          });
          return jsonResponse(
            res.body,
            res.status,
            res.replayed ? { "x-idempotency-replayed": "true" } : undefined,
          );
        }

        // GET /api/v1/goals/:id/revisions
        if (sub === "revisions") {
          if (request.method !== "GET") return methodNotAllowed(["GET"]);

          const auth = await requireAuthenticatedOwnerDb(request, env);
          if (!auth.ok) return auth.response;

          const query = listGoalRevisionsQuerySchema.parse(searchParamsObject(parsedUrl));
          const result = await listGoalRevisionsRecord(auth.db, auth.userId, goalId, query);
          return jsonResponse({ ok: true, ...result }, 200);
        }

        // GET /api/v1/goals/:id/progress
        if (sub === "progress") {
          if (request.method !== "GET") return methodNotAllowed(["GET"]);

          const auth = await requireAuthenticatedOwnerDb(request, env);
          if (!auth.ok) return auth.response;

          const query = goalProgressQuerySchema.parse(searchParamsObject(parsedUrl));
          const result = await getGoalProgressRecord(auth.db, auth.userId, goalId, query);
          return jsonResponse(result, 200);
        }
      }

      return null;
    }

    if (resource === "custom-fields") {
      // GET|POST /api/v1/custom-fields
      if (segments.length === 3) {
        if (request.method === "GET") {
          const auth = await requireAuthenticatedOwnerDb(request, env);
          if (!auth.ok) return auth.response;

          const entity = (parsedUrl.searchParams.get("entity") as "lead" | "project") || "lead";
          const fields = await listCustomFieldsRecord(auth.db, auth.userId, entity);
          return jsonResponse({ ok: true, items: fields, total: fields.length }, 200);
        }

        if (request.method === "POST") {
          const csrf = verifyCsrfAndOrigin(request, env, { requireJsonContentType: true });
          if (!csrf.ok) return csrfRejectResponse(csrf.code, csrf.message);

          const auth = await requireAuthenticatedOwnerDb(request, env);
          if (!auth.ok) return auth.response;

          const parsedBody = await parseJsonObject(request);
          if (!parsedBody.ok) return parsedBody.response;

          const input = createCustomFieldBodySchema.parse(parsedBody.data);
          const res = await createCustomFieldRecord(auth.db, auth.userId, input);
          return jsonResponse(
            res.body,
            res.status,
            res.replayed ? { "x-idempotency-replayed": "true" } : undefined,
          );
        }

        return methodNotAllowed(["GET", "POST"]);
      }

      const idSeg = decodeIdSegment(segments[3] ?? "");
      if (!idSeg.ok) return idSeg.response;
      const fieldId = idSeg.value;

      // GET|PATCH|DELETE /api/v1/custom-fields/:id
      if (segments.length === 4) {
        if (request.method === "GET") {
          const auth = await requireAuthenticatedOwnerDb(request, env);
          if (!auth.ok) return auth.response;

          const field = await getCustomFieldRecord(auth.db, auth.userId, fieldId);
          return jsonResponse({ ok: true, field }, 200);
        }

        if (request.method === "PATCH") {
          const csrf = verifyCsrfAndOrigin(request, env, { requireJsonContentType: true });
          if (!csrf.ok) return csrfRejectResponse(csrf.code, csrf.message);

          const auth = await requireAuthenticatedOwnerDb(request, env);
          if (!auth.ok) return auth.response;

          const parsedBody = await parseJsonObject(request);
          if (!parsedBody.ok) return parsedBody.response;

          const input = updateCustomFieldBodySchema.parse(parsedBody.data);
          const res = await updateCustomFieldRecord(auth.db, auth.userId, fieldId, input);
          return jsonResponse(res, 200);
        }

        if (request.method === "DELETE") {
          const hasBody = hasRequestBodyHint(request);
          const csrf = verifyCsrfAndOrigin(request, env, { requireJsonContentType: hasBody });
          if (!csrf.ok) return csrfRejectResponse(csrf.code, csrf.message);

          const auth = await requireAuthenticatedOwnerDb(request, env);
          if (!auth.ok) return auth.response;

          let expectedVersion: number | undefined;
          if (hasBody) {
            const parsedBody = await parseJsonObject(request, { allowEmpty: true });
            if (!parsedBody.ok) return parsedBody.response;
            if (Object.keys(parsedBody.data).length > 0) {
              const parsed = updateCustomFieldBodySchema
                .pick({ expectedVersion: true })
                .parse(parsedBody.data);
              expectedVersion = parsed.expectedVersion;
            }
          }
          const rawVersionParam =
            parsedUrl.searchParams.get("expectedVersion") ?? parsedUrl.searchParams.get("version");
          if (expectedVersion === undefined && rawVersionParam !== null) {
            const vNum = Number(rawVersionParam);
            if (Number.isInteger(vNum) && vNum >= 1) expectedVersion = vNum;
          }

          const res = await archiveCustomFieldRecord(
            auth.db,
            auth.userId,
            fieldId,
            expectedVersion,
          );
          return jsonResponse(res, 200);
        }

        return methodNotAllowed(["GET", "PATCH", "DELETE"]);
      }

      return null;
    }

    if (resource === "tags") {
      // GET|POST /api/v1/tags
      if (segments.length === 3) {
        if (request.method === "GET") {
          const auth = await requireAuthenticatedOwnerDb(request, env);
          if (!auth.ok) return auth.response;

          const scope = parsedUrl.searchParams.get("scope") as "lead" | "project" | "both" | null;
          const tags = await listTagsRecord(auth.db, auth.userId, scope || undefined);
          return jsonResponse({ ok: true, items: tags, total: tags.length }, 200);
        }

        if (request.method === "POST") {
          const csrf = verifyCsrfAndOrigin(request, env, { requireJsonContentType: true });
          if (!csrf.ok) return csrfRejectResponse(csrf.code, csrf.message);

          const auth = await requireAuthenticatedOwnerDb(request, env);
          if (!auth.ok) return auth.response;

          const parsedBody = await parseJsonObject(request);
          if (!parsedBody.ok) return parsedBody.response;

          const input = createTagBodySchema.parse(parsedBody.data);
          const res = await createTagRecord(auth.db, auth.userId, input);
          return jsonResponse(
            res.body,
            res.status,
            res.replayed ? { "x-idempotency-replayed": "true" } : undefined,
          );
        }

        return methodNotAllowed(["GET", "POST"]);
      }

      const idSeg = decodeIdSegment(segments[3] ?? "");
      if (!idSeg.ok) return idSeg.response;
      const tagId = idSeg.value;

      // GET|PATCH|DELETE /api/v1/tags/:id
      if (segments.length === 4) {
        if (request.method === "GET") {
          const auth = await requireAuthenticatedOwnerDb(request, env);
          if (!auth.ok) return auth.response;

          const tag = await getTagRecord(auth.db, auth.userId, tagId);
          return jsonResponse({ ok: true, tag }, 200);
        }

        if (request.method === "PATCH") {
          const csrf = verifyCsrfAndOrigin(request, env, { requireJsonContentType: true });
          if (!csrf.ok) return csrfRejectResponse(csrf.code, csrf.message);

          const auth = await requireAuthenticatedOwnerDb(request, env);
          if (!auth.ok) return auth.response;

          const parsedBody = await parseJsonObject(request);
          if (!parsedBody.ok) return parsedBody.response;

          const input = updateTagBodySchema.parse(parsedBody.data);
          const res = await updateTagRecord(auth.db, auth.userId, tagId, input);
          return jsonResponse(res, 200);
        }

        if (request.method === "DELETE") {
          const hasBody = hasRequestBodyHint(request);
          const csrf = verifyCsrfAndOrigin(request, env, { requireJsonContentType: hasBody });
          if (!csrf.ok) return csrfRejectResponse(csrf.code, csrf.message);

          const auth = await requireAuthenticatedOwnerDb(request, env);
          if (!auth.ok) return auth.response;

          let expectedVersion: number | undefined;
          if (hasBody) {
            const parsedBody = await parseJsonObject(request, { allowEmpty: true });
            if (!parsedBody.ok) return parsedBody.response;
            if (Object.keys(parsedBody.data).length > 0) {
              const parsed = updateTagBodySchema
                .pick({ expectedVersion: true })
                .parse(parsedBody.data);
              expectedVersion = parsed.expectedVersion;
            }
          }
          const rawVersionParam =
            parsedUrl.searchParams.get("expectedVersion") ?? parsedUrl.searchParams.get("version");
          if (expectedVersion === undefined && rawVersionParam !== null) {
            const vNum = Number(rawVersionParam);
            if (Number.isInteger(vNum) && vNum >= 1) expectedVersion = vNum;
          }

          const res = await archiveTagRecord(auth.db, auth.userId, tagId, expectedVersion);
          return jsonResponse(res, 200);
        }

        return methodNotAllowed(["GET", "PATCH", "DELETE"]);
      }

      return null;
    }

    if (resource === "saved-views") {
      // GET|POST /api/v1/saved-views
      if (segments.length === 3) {
        if (request.method === "GET") {
          const auth = await requireAuthenticatedOwnerDb(request, env);
          if (!auth.ok) return auth.response;

          const includeArchived = parsedUrl.searchParams.get("includeArchived") === "true";
          const views = await listSavedViewsRecord(auth.db, auth.userId, includeArchived);
          return jsonResponse({ ok: true, items: views, total: views.length }, 200);
        }

        if (request.method === "POST") {
          const csrf = verifyCsrfAndOrigin(request, env, { requireJsonContentType: true });
          if (!csrf.ok) return csrfRejectResponse(csrf.code, csrf.message);

          const auth = await requireAuthenticatedOwnerDb(request, env);
          if (!auth.ok) return auth.response;

          const parsedBody = await parseJsonObject(request);
          if (!parsedBody.ok) return parsedBody.response;

          const input = createSavedViewBodySchema.parse(parsedBody.data);
          const res = await createSavedViewRecord(auth.db, auth.userId, input);
          return jsonResponse(
            res.body,
            res.status,
            res.replayed ? { "x-idempotency-replayed": "true" } : undefined,
          );
        }

        return methodNotAllowed(["GET", "POST"]);
      }

      const idSeg = decodeIdSegment(segments[3] ?? "");
      if (!idSeg.ok) return idSeg.response;
      const viewId = idSeg.value;

      // GET|PATCH|DELETE /api/v1/saved-views/:id
      if (segments.length === 4) {
        if (request.method === "GET") {
          const auth = await requireAuthenticatedOwnerDb(request, env);
          if (!auth.ok) return auth.response;

          const view = await getSavedViewRecord(auth.db, auth.userId, viewId);
          return jsonResponse({ ok: true, view }, 200);
        }

        if (request.method === "PATCH") {
          const csrf = verifyCsrfAndOrigin(request, env, { requireJsonContentType: true });
          if (!csrf.ok) return csrfRejectResponse(csrf.code, csrf.message);

          const auth = await requireAuthenticatedOwnerDb(request, env);
          if (!auth.ok) return auth.response;

          const parsedBody = await parseJsonObject(request);
          if (!parsedBody.ok) return parsedBody.response;

          const input = updateSavedViewBodySchema.parse(parsedBody.data);
          const res = await updateSavedViewRecord(auth.db, auth.userId, viewId, input);
          return jsonResponse(res, 200);
        }

        if (request.method === "DELETE") {
          const hasBody = hasRequestBodyHint(request);
          const csrf = verifyCsrfAndOrigin(request, env, { requireJsonContentType: hasBody });
          if (!csrf.ok) return csrfRejectResponse(csrf.code, csrf.message);

          const auth = await requireAuthenticatedOwnerDb(request, env);
          if (!auth.ok) return auth.response;

          let expectedVersion: number | undefined;
          if (hasBody) {
            const parsedBody = await parseJsonObject(request, { allowEmpty: true });
            if (!parsedBody.ok) return parsedBody.response;
            if (Object.keys(parsedBody.data).length > 0) {
              const parsed = updateSavedViewBodySchema
                .pick({ expectedVersion: true })
                .parse(parsedBody.data);
              expectedVersion = parsed.expectedVersion;
            }
          }
          const rawVersionParam =
            parsedUrl.searchParams.get("expectedVersion") ?? parsedUrl.searchParams.get("version");
          if (expectedVersion === undefined && rawVersionParam !== null) {
            const vNum = Number(rawVersionParam);
            if (Number.isInteger(vNum) && vNum >= 1) expectedVersion = vNum;
          }

          const res = await archiveSavedViewRecord(auth.db, auth.userId, viewId, expectedVersion);
          return jsonResponse(res, 200);
        }

        return methodNotAllowed(["GET", "PATCH", "DELETE"]);
      }

      // POST /api/v1/saved-views/:id/duplicate
      if (segments.length === 5 && segments[4] === "duplicate") {
        if (request.method !== "POST") return methodNotAllowed(["POST"]);
        const csrf = verifyCsrfAndOrigin(request, env, { requireJsonContentType: false });
        if (!csrf.ok) return csrfRejectResponse(csrf.code, csrf.message);

        const auth = await requireAuthenticatedOwnerDb(request, env);
        if (!auth.ok) return auth.response;

        const res = await duplicateSavedViewRecord(auth.db, auth.userId, viewId);
        return jsonResponse(res, 201);
      }

      return null;
    }

    if (resource === "inbox") {
      // GET /api/v1/inbox
      if (segments.length === 3) {
        if (request.method !== "GET") return methodNotAllowed(["GET"]);

        const auth = await requireAuthenticatedOwnerDb(request, env);
        if (!auth.ok) return auth.response;

        const query = inboxQueueQuerySchema.parse(searchParamsObject(parsedUrl));
        const result = await getInboxQueueRecord(auth.db, auth.userId, query);
        return jsonResponse({ ok: true, ...result }, 200);
      }

      if (segments.length === 4) {
        const sub = segments[3];

        // POST /api/v1/inbox/review
        if (sub === "review") {
          if (request.method !== "POST") return methodNotAllowed(["POST"]);
          const csrf = verifyCsrfAndOrigin(request, env, { requireJsonContentType: true });
          if (!csrf.ok) return csrfRejectResponse(csrf.code, csrf.message);

          const auth = await requireAuthenticatedOwnerDb(request, env);
          if (!auth.ok) return auth.response;

          const parsedBody = await parseJsonObject(request);
          if (!parsedBody.ok) return parsedBody.response;

          const input = inboxReviewBodySchema.parse(parsedBody.data);
          const idemKey = resolveEffectiveIdempotencyKey({
            headerKey: request.headers.get("idempotency-key"),
            bodyKey: input.idempotencyKey,
          });
          const result = await setInboxReviewStatusRecord(
            auth.db,
            auth.userId,
            auth.userId,
            { ...input, idempotencyKey: idemKey ?? undefined },
          );
          return jsonResponse(
            result.body,
            result.status,
            result.replayed ? { "x-idempotency-replayed": "true" } : undefined,
          );
        }

        // POST /api/v1/inbox/flag
        if (sub === "flag") {
          if (request.method !== "POST") return methodNotAllowed(["POST"]);
          const csrf = verifyCsrfAndOrigin(request, env, { requireJsonContentType: true });
          if (!csrf.ok) return csrfRejectResponse(csrf.code, csrf.message);

          const auth = await requireAuthenticatedOwnerDb(request, env);
          if (!auth.ok) return auth.response;

          const parsedBody = await parseJsonObject(request);
          if (!parsedBody.ok) return parsedBody.response;

          const input = inboxFlagBodySchema.parse(parsedBody.data);
          const idemKey = resolveEffectiveIdempotencyKey({
            headerKey: request.headers.get("idempotency-key"),
            bodyKey: input.idempotencyKey,
          });
          const result = await setLeadDuplicateFlagRecord(
            auth.db,
            auth.userId,
            auth.userId,
            { ...input, idempotencyKey: idemKey ?? undefined },
          );
          return jsonResponse(
            result.body,
            result.status,
            result.replayed ? { "x-idempotency-replayed": "true" } : undefined,
          );
        }

        // POST /api/v1/inbox/scan
        if (sub === "scan") {
          if (request.method !== "POST") return methodNotAllowed(["POST"]);
          const csrf = verifyCsrfAndOrigin(request, env, { requireJsonContentType: false });
          if (!csrf.ok) return csrfRejectResponse(csrf.code, csrf.message);

          const auth = await requireAuthenticatedOwnerDb(request, env);
          if (!auth.ok) return auth.response;

          const result = await scanDuplicateCandidatesRecord(auth.db, auth.userId);
          return jsonResponse(result, 200);
        }

        // GET /api/v1/inbox/candidates
        if (sub === "candidates") {
          if (request.method !== "GET") return methodNotAllowed(["GET"]);

          const auth = await requireAuthenticatedOwnerDb(request, env);
          if (!auth.ok) return auth.response;

          const query = dupCandidatesQuerySchema.parse(searchParamsObject(parsedUrl));
          const result = await listDuplicateCandidatesRecord(auth.db, auth.userId, query);
          return jsonResponse({ ok: true, ...result }, 200);
        }

        // GET /api/v1/inbox/review-history
        if (sub === "review-history") {
          if (request.method !== "GET") return methodNotAllowed(["GET"]);

          const auth = await requireAuthenticatedOwnerDb(request, env);
          if (!auth.ok) return auth.response;

          const query = reviewHistoryQuerySchema.parse(searchParamsObject(parsedUrl));
          const result = await getReviewHistoryRecord(auth.db, auth.userId, query);
          return jsonResponse({ ok: true, ...result }, 200);
        }
      }

      if (segments.length === 5 && segments[3] === "candidates") {
        const idSeg = decodeIdSegment(segments[4] ?? "");
        if (!idSeg.ok) return idSeg.response;
        const candidateId = idSeg.value;

        // GET /api/v1/inbox/candidates/:id
        if (request.method === "GET") {
          const auth = await requireAuthenticatedOwnerDb(request, env);
          if (!auth.ok) return auth.response;

          const result = await getDuplicateCandidateRecord(auth.db, auth.userId, candidateId);
          return jsonResponse({ ok: true, ...result }, 200);
        }

        return methodNotAllowed(["GET"]);
      }

      if (segments.length === 6 && segments[3] === "candidates" && segments[5] === "decision") {
        const idSeg = decodeIdSegment(segments[4] ?? "");
        if (!idSeg.ok) return idSeg.response;
        const candidateId = idSeg.value;

        // POST /api/v1/inbox/candidates/:id/decision
        if (request.method === "POST") {
          const csrf = verifyCsrfAndOrigin(request, env, { requireJsonContentType: true });
          if (!csrf.ok) return csrfRejectResponse(csrf.code, csrf.message);

          const auth = await requireAuthenticatedOwnerDb(request, env);
          if (!auth.ok) return auth.response;

          const parsedBody = await parseJsonObject(request);
          if (!parsedBody.ok) return parsedBody.response;

          const input = dupCandidateDecisionBodySchema.parse(parsedBody.data);
          const idemKey = resolveEffectiveIdempotencyKey({
            headerKey: request.headers.get("idempotency-key"),
            bodyKey: input.idempotencyKey,
          });
          const result = await decideDuplicateCandidateRecord(
            auth.db,
            auth.userId,
            auth.userId,
            candidateId,
            { ...input, idempotencyKey: idemKey ?? undefined },
          );
          return jsonResponse(
            result.body,
            result.status,
            result.replayed ? { "x-idempotency-replayed": "true" } : undefined,
          );
        }

        return methodNotAllowed(["POST"]);
      }

      return null;
    }

    if (resource === "vault") {
      if (!isLeadPilotAvailable(env)) {
        return jsonResponse(
          {
            ok: false,
            error: {
              code: "PILOT_DISABLED",
              message: "Development Data Vault Pilot is disabled in production environments.",
            },
          },
          404,
        );
      }
      const sub = segments[3];

      // GET /api/v1/vault/coverage
      if (sub === "coverage") {
        if (request.method !== "GET") return methodNotAllowed(["GET"]);
        const auth = await requireAuthenticatedOwnerDb(request, env);
        if (!auth.ok) return auth.response;

        const coverage = await getVaultCoverage(auth.db, auth.userId);
        return jsonResponse({ ok: true, coverage }, 200);
      }

      // POST /api/v1/vault/synthetic-backup
      if (sub === "synthetic-backup") {
        if (request.method !== "POST") return methodNotAllowed(["POST"]);
        const csrf = verifyCsrfAndOrigin(request, env, { requireJsonContentType: false });
        if (!csrf.ok) return csrfRejectResponse(csrf.code, csrf.message);

        const auth = await requireAuthenticatedOwnerDb(request, env);
        if (!auth.ok) return auth.response;

        let scope: "full" | "sales" | "projects" = "full";
        try {
          const body = (await request.clone().json()) as { scope?: string };
          if (body?.scope === "sales" || body?.scope === "projects" || body?.scope === "full") {
            scope = body.scope;
          }
        } catch {
          const urlScope = parsedUrl.searchParams.get("scope");
          if (urlScope === "sales" || urlScope === "projects" || urlScope === "full") {
            scope = urlScope;
          }
        }

        const { zipBytes, filename, manifest } = generateSyntheticBackupArchive({
          scope,
          ownerUserId: auth.userId,
          ownerEmail: "owner@joinscaleflow.in",
        });

        return new Response(Buffer.from(zipBytes) as unknown as BodyInit, {
          status: 200,
          headers: {
            "Content-Type": "application/zip",
            "Content-Disposition": `attachment; filename="${filename}"`,
            "Content-Length": String(zipBytes.byteLength),
            "x-vault-manifest-sha256": manifest.checksumSha256 ?? "",
            "Cache-Control": "no-store, no-cache, must-revalidate",
          },
        });
      }

      // POST /api/v1/vault/inspect
      if (sub === "inspect") {
        if (request.method !== "POST") return methodNotAllowed(["POST"]);
        const csrf = verifyCsrfAndOrigin(request, env, { requireJsonContentType: false });
        if (!csrf.ok) return csrfRejectResponse(csrf.code, csrf.message);

        const auth = await requireAuthenticatedOwnerDb(request, env);
        if (!auth.ok) return auth.response;

        const parsedUpload = await parseArchiveUpload(request);
        if (!parsedUpload.ok) return parsedUpload.response;

        const validation = await inspectUploadedArchive(parsedUpload.bytes);
        return jsonResponse({ ok: validation.ok, validation }, 200);
      }

      // POST /api/v1/vault/dry-run
      if (sub === "dry-run") {
        if (request.method !== "POST") return methodNotAllowed(["POST"]);
        const csrf = verifyCsrfAndOrigin(request, env, { requireJsonContentType: false });
        if (!csrf.ok) return csrfRejectResponse(csrf.code, csrf.message);

        const auth = await requireAuthenticatedOwnerDb(request, env);
        if (!auth.ok) return auth.response;

        const parsedUpload = await parseArchiveUpload(request);
        if (!parsedUpload.ok) return parsedUpload.response;

        const dryRunReport = await runUploadedArchiveDryRun(
          auth.db,
          auth.userId,
          parsedUpload.bytes,
        );
        return jsonResponse({ ok: dryRunReport.ok, dryRunReport }, 200);
      }

      // POST /api/v1/vault/restore -> Strictly 403 Forbidden
      if (sub === "restore") {
        return jsonResponse(
          {
            ok: false,
            error: {
              code: "RESTORE_EXECUTION_DISABLED",
              message:
                "Direct database restore execution is disabled in the UI. Restore execution is CLI-only with manual safeguards and isolated transaction rollbacks to prevent accidental production data loss.",
            },
          },
          403,
        );
      }

      return null;
    }

    if (resource === "automations") {
      if (!isLeadPilotAvailable(env)) {
        return jsonResponse(
          {
            ok: false,
            error: {
              code: "PILOT_DISABLED",
              message: "Development Automation Rules Pilot is disabled in production environments.",
            },
          },
          404,
        );
      }

      // GET /api/v1/automations/definitions
      if (segments.length === 4 && segments[3] === "definitions") {
        if (request.method !== "GET") return methodNotAllowed(["GET"]);
        const auth = await requireAuthenticatedOwnerDb(request, env);
        if (!auth.ok) return auth.response;

        return jsonResponse({ ok: true, ...getAutomationDefinitions() }, 200);
      }

      // /api/v1/automations (collection routes)
      if (segments.length === 3) {
        // GET /api/v1/automations
        if (request.method === "GET") {
          const auth = await requireAuthenticatedOwnerDb(request, env);
          if (!auth.ok) return auth.response;

          const query = searchParamsObject(parsedUrl);
          const result = await listAutomationRulesRecord(auth.db, auth.userId, {
            status: query["status"] ?? null,
            subject: query["subject"] ?? null,
            triggerType: query["triggerType"] ?? null,
            search: query["search"] ?? null,
            page: query["page"] ? Number(query["page"]) : 1,
            pageSize: query["pageSize"] ? Number(query["pageSize"]) : 20,
          });

          return jsonResponse({ ok: true, ...result }, 200);
        }

        // POST /api/v1/automations
        if (request.method === "POST") {
          const csrf = verifyCsrfAndOrigin(request, env, { requireJsonContentType: true });
          if (!csrf.ok) return csrfRejectResponse(csrf.code, csrf.message);

          const auth = await requireAuthenticatedOwnerDb(request, env);
          if (!auth.ok) return auth.response;

          const parsedBody = await parseJsonObject(request);
          if (!parsedBody.ok) return parsedBody.response;

          const idemKey = resolveEffectiveIdempotencyKey({
            headerKey: request.headers.get("idempotency-key"),
            bodyKey: typeof parsedBody.data["idempotencyKey"] === "string" ? parsedBody.data["idempotencyKey"] : null,
          });

          const result = await createAutomationRuleRecord(
            auth.db,
            auth.userId,
            auth.userId,
            parsedBody.data as any,
            { idempotencyKey: idemKey },
          );

          return jsonResponse(
            result,
            201,
            result.replayed ? { "x-idempotency-replayed": "true" } : undefined,
          );
        }

        return methodNotAllowed(["GET", "POST"]);
      }

      // Sub-resource or member routes
      if (segments.length === 4) {
        const ruleId = segments[3]!;

        // GET /api/v1/automations/:id
        if (request.method === "GET") {
          const auth = await requireAuthenticatedOwnerDb(request, env);
          if (!auth.ok) return auth.response;

          const rule = await getAutomationRuleRecord(auth.db, auth.userId, ruleId);
          return jsonResponse({ ok: true, rule }, 200);
        }

        // PUT /api/v1/automations/:id
        if (request.method === "PUT") {
          const csrf = verifyCsrfAndOrigin(request, env, { requireJsonContentType: true });
          if (!csrf.ok) return csrfRejectResponse(csrf.code, csrf.message);

          const auth = await requireAuthenticatedOwnerDb(request, env);
          if (!auth.ok) return auth.response;

          const parsedBody = await parseJsonObject(request);
          if (!parsedBody.ok) return parsedBody.response;

          const idemKey = resolveEffectiveIdempotencyKey({
            headerKey: request.headers.get("idempotency-key"),
            bodyKey: typeof parsedBody.data["idempotencyKey"] === "string" ? parsedBody.data["idempotencyKey"] : null,
          });

          const result = await updateAutomationRuleRecord(
            auth.db,
            auth.userId,
            auth.userId,
            ruleId,
            parsedBody.data as any,
            { idempotencyKey: idemKey },
          );

          return jsonResponse(
            result,
            200,
            result.replayed ? { "x-idempotency-replayed": "true" } : undefined,
          );
        }

        // DELETE /api/v1/automations/:id
        if (request.method === "DELETE") {
          const csrf = verifyCsrfAndOrigin(request, env, { requireJsonContentType: false });
          if (!csrf.ok) return csrfRejectResponse(csrf.code, csrf.message);

          const auth = await requireAuthenticatedOwnerDb(request, env);
          if (!auth.ok) return auth.response;

          let expectedVersion: number | undefined;
          let bodyIdemKey: string | null = null;
          if (hasRequestBodyHint(request)) {
            const parsedBody = await parseJsonObject(request, { allowEmpty: true });
            if (parsedBody.ok) {
              if (typeof parsedBody.data["expectedVersion"] === "number") {
                expectedVersion = parsedBody.data["expectedVersion"];
              } else if (typeof parsedBody.data["version"] === "number") {
                expectedVersion = parsedBody.data["version"];
              }
              if (typeof parsedBody.data["idempotencyKey"] === "string") {
                bodyIdemKey = parsedBody.data["idempotencyKey"];
              }
            }
          }
          if (expectedVersion === undefined) {
            const urlVer = parsedUrl.searchParams.get("expectedVersion") ?? parsedUrl.searchParams.get("version");
            if (urlVer) expectedVersion = Number(urlVer);
          }

          const idemKey = resolveEffectiveIdempotencyKey({
            headerKey: request.headers.get("idempotency-key"),
            bodyKey: bodyIdemKey,
          });

          const result = await archiveAutomationRuleRecord(
            auth.db,
            auth.userId,
            auth.userId,
            ruleId,
            expectedVersion,
            { idempotencyKey: idemKey },
          );

          return jsonResponse(
            result,
            200,
            result.replayed ? { "x-idempotency-replayed": "true" } : undefined,
          );
        }

        return methodNotAllowed(["GET", "PUT", "DELETE"]);
      }

      if (segments.length === 5) {
        const ruleId = segments[3]!;
        const action = segments[4];

        // POST /api/v1/automations/:id/duplicate
        if (action === "duplicate") {
          if (request.method !== "POST") return methodNotAllowed(["POST"]);
          const csrf = verifyCsrfAndOrigin(request, env, { requireJsonContentType: false });
          if (!csrf.ok) return csrfRejectResponse(csrf.code, csrf.message);

          const auth = await requireAuthenticatedOwnerDb(request, env);
          if (!auth.ok) return auth.response;

          let bodyIdemKey: string | null = null;
          if (hasRequestBodyHint(request)) {
            const parsedBody = await parseJsonObject(request, { allowEmpty: true });
            if (parsedBody.ok && typeof parsedBody.data["idempotencyKey"] === "string") {
              bodyIdemKey = parsedBody.data["idempotencyKey"];
            }
          }

          const idemKey = resolveEffectiveIdempotencyKey({
            headerKey: request.headers.get("idempotency-key"),
            bodyKey: bodyIdemKey,
          });

          const result = await duplicateAutomationRuleRecord(
            auth.db,
            auth.userId,
            auth.userId,
            ruleId,
            { idempotencyKey: idemKey },
          );

          return jsonResponse(
            result,
            201,
            result.replayed ? { "x-idempotency-replayed": "true" } : undefined,
          );
        }

        // GET /api/v1/automations/:id/revisions
        if (action === "revisions") {
          if (request.method !== "GET") return methodNotAllowed(["GET"]);
          const auth = await requireAuthenticatedOwnerDb(request, env);
          if (!auth.ok) return auth.response;

          const revisions = await getAutomationRuleRevisionsRecord(auth.db, auth.userId, ruleId);
          return jsonResponse({ ok: true, revisions }, 200);
        }

        // POST /api/v1/automations/:id/simulate
        if (action === "simulate") {
          if (request.method !== "POST") return methodNotAllowed(["POST"]);
          const csrf = verifyCsrfAndOrigin(request, env, { requireJsonContentType: true });
          if (!csrf.ok) return csrfRejectResponse(csrf.code, csrf.message);

          const auth = await requireAuthenticatedOwnerDb(request, env);
          if (!auth.ok) return auth.response;

          const parsedBody = await parseJsonObject(request);
          if (!parsedBody.ok) return parsedBody.response;

          const result = await simulateAutomationRuleRecord(
            auth.db,
            auth.userId,
            auth.userId,
            ruleId,
            parsedBody.data as any,
          );

          return jsonResponse(result, 200);
        }

        // POST /api/v1/automations/:id/execute-test
        if (action === "execute-test") {
          if (request.method !== "POST") return methodNotAllowed(["POST"]);
          const csrf = verifyCsrfAndOrigin(request, env, { requireJsonContentType: true });
          if (!csrf.ok) return csrfRejectResponse(csrf.code, csrf.message);

          // Pre-check non-production mode and disposable DB config before executing anything
          const preGuard = verifyDisposableAutomationTestDatabaseConfig(env);
          if (!preGuard.ok) {
            return jsonResponse(
              { ok: false, error: { code: preGuard.code, message: preGuard.message } },
              403,
            );
          }

          const auth = await requireAuthenticatedOwnerDb(request, env);
          if (!auth.ok) return auth.response;

          // Verify connected MariaDB database name at runtime against explicit disposable allowlist
          let liveDbName: string | null = null;
          if (typeof (auth.db as { execute?: unknown }).execute === "function") {
            const rawDbRes = await auth.db.execute(sql`SELECT DATABASE() AS dbName`);
            const rowContainer = Array.isArray(rawDbRes) ? rawDbRes[0] : rawDbRes;
            const firstRow = Array.isArray(rowContainer) ? rowContainer[0] : rowContainer;
            if (firstRow && typeof firstRow === "object" && "dbName" in firstRow) {
              const val = (firstRow as { dbName: unknown }).dbName;
              liveDbName = val == null ? null : String(val);
            }
          }
          const runtimeGuard = verifyDisposableAutomationTestDatabaseConfig(env, liveDbName);
          if (!runtimeGuard.ok) {
            return jsonResponse(
              { ok: false, error: { code: runtimeGuard.code, message: runtimeGuard.message } },
              403,
            );
          }

          // Enforce DB-backed rate limit on manual test execution endpoint
          const clientIpPrefix = maskIpPrefix(getClientIp(request, env));
          const rate = await consumeFixedWindowRateLimit(
            auth.db,
            `auto_exec:${auth.userId}:${clientIpPrefix}`,
            getAutomationTestRateLimitPolicy(env),
          );
          if (rate.blocked) {
            return jsonResponse(
              {
                ok: false,
                error: {
                  code: "rate_limited",
                  message:
                    "Too many automation test execution requests. Please retry after cooldown.",
                  retryAfterSeconds: rate.retryAfterSeconds,
                },
              },
              429,
              { "retry-after": String(rate.retryAfterSeconds) },
            );
          }

          const parsedBody = await parseJsonObject(request);
          if (!parsedBody.ok) return parsedBody.response;

          const bodyData = parsedBody.data as Record<string, unknown>;
          const idemHeader = request.headers.get("idempotency-key");
          const inputData = {
            ...bodyData,
            ...(idemHeader && !bodyData["idempotencyKey"] ? { idempotencyKey: idemHeader } : {}),
          } as Parameters<typeof executeAutomationRuleRecord>[4];

          const result = await executeAutomationRuleRecord(
            auth.db,
            auth.userId,
            auth.userId,
            ruleId,
            inputData,
          );

          return jsonResponse(result, 200, { "x-ratelimit-remaining": String(rate.remaining) });
        }

        return null;
      }

      return null;
    }

    return null;
  } catch (error) {
    return crmErrorResponse(error);
  }
}
