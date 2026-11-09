import "@tanstack/react-start/server-only";
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
  archiveLeadBodySchema,
  cancelFollowUpBodySchema,
  completeFollowUpBodySchema,
  createActivityBodySchema,
  createCallLogBodySchema,
  createFollowUpBodySchema,
  createLeadBodySchema,
  listActivitiesQuerySchema,
  listCallsQuerySchema,
  listFollowUpsQuerySchema,
  listLeadCallsQuerySchema,
  listLeadsQuerySchema,
  restoreLeadBodySchema,
  updateFollowUpBodySchema,
  updateLeadBodySchema,
} from "../crm/validation.server";
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
 * Handles all Core CRM `/api/v1/leads*`, `/api/v1/follow-ups*`, and `/api/v1/calls*` endpoints.
 * Returns `null` if the pathname does not match any CRM route.
 */
export async function handleCrmApiRequest(
  request: Request,
  pathname: string,
  env: ServerEnv,
): Promise<Response | null> {
  if (
    !pathname.startsWith("/api/v1/leads") &&
    !pathname.startsWith("/api/v1/follow-ups") &&
    !pathname.startsWith("/api/v1/calls")
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

    return null;
  } catch (error) {
    return crmErrorResponse(error);
  }
}
