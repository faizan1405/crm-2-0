import "@tanstack/react-start/server-only";
import { Readable } from "node:stream";
import { ZodError } from "zod";
import { resolveAuthenticatedSession } from "../auth/authService.server";
import {
  buildClearSessionCookie,
  getClientIp,
  maskIpPrefix,
  readSessionCookie,
  shouldUseSecureCookie,
  verifyCsrfAndOrigin,
} from "../auth/security.server";
import type { ServerEnv } from "../config/env.server";
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
  archiveLeadBodySchema,
  archiveQuotationBodySchema,
  cancelDealBodySchema,
  cancelFollowUpBodySchema,
  changeDealStatusBodySchema,
  changeQuotationStatusBodySchema,
  completeFollowUpBodySchema,
  createActivityBodySchema,
  createCallLogBodySchema,
  createDealBodySchema,
  createFollowUpBodySchema,
  createLeadBodySchema,
  createPaymentBodySchema,
  createPaymentWithDealBodySchema,
  createQuotationBodySchema,
  createQuotationTemplateBodySchema,
  createWhatsAppLogBodySchema,
  financeSummaryQuerySchema,
  listActivitiesQuerySchema,
  listCallsQuerySchema,
  listDealAuditQuerySchema,
  listDealPaymentsQuerySchema,
  listDealsQuerySchema,
  listFollowUpsQuerySchema,
  listLeadCallsQuerySchema,
  listLeadWhatsAppQuerySchema,
  listLeadsQuerySchema,
  listPaymentsQuerySchema,
  listProofHistoryQuerySchema,
  listQuotationAuditQuerySchema,
  listQuotationRevisionsQuerySchema,
  listQuotationsQuerySchema,
  listQuotationTemplatesQuerySchema,
  listWhatsAppQuerySchema,
  removeProofBodySchema,
  reorderQuotationTemplatesBodySchema,
  replaceProofBodySchema,
  restoreLeadBodySchema,
  restoreQuotationBodySchema,
  updateDealBodySchema,
  updateFollowUpBodySchema,
  updateLeadBodySchema,
  updateQuotationBodySchema,
  updateQuotationTemplateBodySchema,
  verifyDealWonDateBodySchema,
  voidPaymentBodySchema,
} from "../crm/validation.server";
import {
  createWhatsAppLogRecord,
  getWhatsAppLogRecord,
  listWhatsAppLogs,
  listWhatsAppLogsForLead,
} from "../crm/whatsappService.server";
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

/**
 * Handles all Core CRM `/api/v1/leads*`, `/api/v1/follow-ups*`, `/api/v1/calls*`,
 * `/api/v1/whatsapp-messages*`, `/api/v1/deals*`, `/api/v1/payments*`, `/api/v1/finance*`,
 * `/api/v1/quotation-templates*`, and `/api/v1/quotations*`
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
    !pathname.startsWith("/api/v1/quotations")
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
          return jsonResponse({
            ok: true,
            dealId,
            events: result.items,
            items: result.items,
            total: result.total,
            limit: result.limit,
            offset: result.offset,
          }, 200);
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

        const totalBookedPaise = summary.totals.totalValuePaise + summary.exclusions.cancelledBookedValuePaise;
        const cashCollectedPaise = summary.totals.collectedPaise + summary.exclusions.cancelledDealPaymentsExcludedPaise;

        const payload = {
          ...summary,
          todayIstDate: summary.todayIstDate,
          period: (query as Record<string, unknown>)["period"] as string ?? "all_time",
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
          activeDealCount: (summary.counts.byDealStatus.active ?? 0) + (summary.counts.byDealStatus.completed ?? 0) + (summary.counts.byDealStatus.on_hold ?? 0),
          cancelledDealCount: summary.exclusions.cancelledDealCount,
          activePaymentCount: (summary.counts.byPaymentStatus.paid ?? 0) + (summary.counts.byPaymentStatus.partial ?? 0),
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
          const result = await reorderQuotationTemplatesRecord(auth.db, auth.userId, input.templateIds);
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
          const template = await updateQuotationTemplateRecord(auth.db, auth.userId, templateId, input);
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

          const res = await updateQuotationRecord(auth.db, auth.userId, auth.userId, quotationId, input, {
            idempotencyKey: idemKey,
          });
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

          const res = await archiveQuotationRecord(auth.db, auth.userId, auth.userId, quotationId, reason, {
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

          const res = await restoreQuotationRecord(
            auth.db,
            auth.userId,
            auth.userId,
            quotationId,
            { idempotencyKey: idemKey },
          );
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
          const result = await listQuotationRevisionsRecord(auth.db, auth.userId, quotationId, query);
          return jsonResponse({ ok: true, quotationId, ...result }, 200);
        }

        // GET /api/v1/quotations/:id/audit
        if (sub === "audit") {
          if (request.method !== "GET") return methodNotAllowed(["GET"]);

          const auth = await requireAuthenticatedOwnerDb(request, env);
          if (!auth.ok) return auth.response;

          const query = listQuotationAuditQuerySchema.parse(searchParamsObject(parsedUrl));
          const result = await listQuotationAuditEventsRecord(auth.db, auth.userId, quotationId, query);
          return jsonResponse({ ok: true, quotationId, ...result }, 200);
        }
      }

      return null;
    }

    return null;
  } catch (error) {
    return crmErrorResponse(error);
  }
}
