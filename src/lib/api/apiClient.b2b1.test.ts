import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { apiRequest, buildApiUrl, createIdempotencyKey } from "./client";
import {
  ApiError,
  extractDuplicateLeadConflict,
  extractFieldValidationErrors,
  extractStaleConflict,
  formatApiErrorMessage,
} from "./errors";
import {
  readLeadPilotSessionOptIn,
  resolveLeadPilotActive,
  setLeadPilotSessionOptIn,
} from "./pilotGate";
import { parsePilotSearch } from "./pilotHook";
import {
  formatIsoToIstInput,
  leadDtoSchema,
  leadsListResponseSchema,
  parseIstDateTimeInput,
} from "./schemas";
import { hydrateAuthFromSsr, useAuthStore } from "@/lib/auth/authClient";
import { parseLeadsSearch } from "@/lib/crm/leadsSearch";

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

describe("B2B1 Typed API Client & Security Discipline", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    hydrateAuthFromSsr({
      checked: true,
      authenticated: true,
      user: { id: "usr_owner", name: "Owner", email: "owner@example.com", roleId: "owner" },
      idleExpiresAt: null,
      expiresAt: null,
      leadPilotAvailable: true,
    });
  });

  it("builds query URLs cleanly omitting empty and nullish values", () => {
    expect(
      buildApiUrl("/api/v1/leads", {
        q: "arjun",
        status: "all",
        tagId: undefined,
        empty: "",
        nothing: null,
        limit: 50,
        pinnedFirst: true,
      }),
    ).toBe("/api/v1/leads?q=arjun&status=all&limit=50&pinnedFirst=true");
  });

  it("validates responses against Zod schemas and rejects malformed DTO shapes", async () => {
    const validLead = {
      id: "lead_1",
      legacyId: null,
      name: "Synthetic Lead",
      phone: "9876543210",
      source: "Meta Ads",
      status: "new",
      priority: "hot",
      pinned: false,
      lifecycleStatus: "active",
      tagIds: [],
      fieldValues: {},
      version: 1,
      createdAt: "2026-11-09T10:00:00.000Z",
      updatedAt: "2026-11-09T10:00:00.000Z",
    };

    const fetchOk = vi.fn<typeof fetch>(async () =>
      jsonResponse({
        ok: true,
        items: [validLead],
        total: 1,
        limit: 50,
        offset: 0,
        stageCounts: { all: 1, new: 1 },
      }),
    );

    const parsed = await apiRequest({
      path: "/api/v1/leads",
      schema: leadsListResponseSchema,
      fetchImpl: fetchOk,
      sleepImpl: async () => {},
    });

    expect(parsed.items).toHaveLength(1);
    expect(parsed.items[0]!.source).toBe("Meta Ads");

    const init = fetchOk.mock.calls[0]![1]!;
    expect(init.credentials).toBe("same-origin");
    expect(init.cache).toBe("no-store");

    const fetchBadSchema = vi.fn<typeof fetch>(async () =>
      jsonResponse({
        ok: true,
        items: [{ ...validLead, source: "UnknownBadSource" }],
        total: 1,
        limit: 50,
        offset: 0,
        stageCounts: { all: 1 },
      }),
    );

    await expect(
      apiRequest({
        path: "/api/v1/leads",
        schema: leadsListResponseSchema,
        fetchImpl: fetchBadSchema,
        sleepImpl: async () => {},
      }),
    ).rejects.toMatchObject({ code: "invalid_response_schema" });
  });

  it("retries transient 503/network errors for GET and keyed mutations, but never for unkeyed mutations", async () => {
    const noSleep = async () => {};

    let getCalls = 0;
    const fetchGet = vi.fn<typeof fetch>(async () => {
      getCalls += 1;
      if (getCalls < 3) {
        return jsonResponse(
          { ok: false, error: { code: "crm_unavailable", message: "db down" } },
          503,
        );
      }
      return jsonResponse({ ok: true, id: "ok" });
    });

    const getRes = await apiRequest({
      path: "/api/v1/leads",
      method: "GET",
      schema: z.object({ ok: z.literal(true), id: z.string() }),
      fetchImpl: fetchGet,
      sleepImpl: noSleep,
    });
    expect(getRes.id).toBe("ok");
    expect(fetchGet).toHaveBeenCalledTimes(3);

    const idemKey = createIdempotencyKey();
    let keyedPostCalls = 0;
    const fetchKeyedPost = vi.fn<typeof fetch>(async () => {
      keyedPostCalls += 1;
      if (keyedPostCalls === 1) {
        throw new TypeError("socket hang up");
      }
      return jsonResponse({ ok: true, id: "created" }, 201);
    });

    const postRes = await apiRequest({
      path: "/api/v1/leads",
      method: "POST",
      body: { name: "Retry Lead" },
      idempotencyKey: idemKey,
      schema: z.object({ ok: z.literal(true), id: z.string() }),
      fetchImpl: fetchKeyedPost,
      sleepImpl: noSleep,
    });
    expect(postRes.id).toBe("created");
    expect(fetchKeyedPost).toHaveBeenCalledTimes(2);
    const reqHeaders = fetchKeyedPost.mock.calls[1]![1]!.headers as Record<string, string>;
    expect(reqHeaders["Idempotency-Key"]).toBe(idemKey);

    const fetchUnkeyedPatch = vi.fn<typeof fetch>(async () =>
      jsonResponse({ ok: false, error: { code: "crm_unavailable", message: "db down" } }, 503),
    );
    await expect(
      apiRequest({
        path: "/api/v1/leads/lead_1",
        method: "PATCH",
        body: { version: 1, name: "New" },
        schema: z.object({ ok: z.literal(true) }),
        fetchImpl: fetchUnkeyedPatch,
        sleepImpl: noSleep,
      }),
    ).rejects.toMatchObject({ status: 503, code: "crm_unavailable" });
    expect(fetchUnkeyedPatch).toHaveBeenCalledTimes(1);
  });

  it("clears client auth state on 401 and invokes unauthorized handler without retrying", async () => {
    const onUnauthorized = vi.fn();
    const fetch401 = vi.fn<typeof fetch>(async () =>
      jsonResponse(
        {
          ok: false,
          authenticated: false,
          error: { code: "unauthenticated", reason: "revoked", message: "Session revoked." },
        },
        401,
      ),
    );

    await expect(
      apiRequest({
        path: "/api/v1/leads",
        schema: leadsListResponseSchema,
        fetchImpl: fetch401,
        sleepImpl: async () => {},
        onUnauthorized,
      }),
    ).rejects.toMatchObject({ status: 401, code: "unauthenticated" });

    expect(fetch401).toHaveBeenCalledTimes(1);
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    expect(useAuthStore.getState().status).toBe("unauthenticated");
    expect(useAuthStore.getState().leadPilotAvailable).toBe(false);
  });

  it("enforces timezone-independent IST parsing and rejects impossible calendar rollover dates", () => {
    const validNaive = parseIstDateTimeInput("2026-11-09T14:30");
    expect(validNaive.ok).toBe(true);
    if (validNaive.ok) {
      expect(validNaive.utcIso).toBe("2026-11-09T09:00:00.000Z");
      expect(validNaive.istInput).toBe("2026-11-09T14:30");
      expect(validNaive.istDate).toBe("2026-11-09");
      expect(formatIsoToIstInput(validNaive.utcIso)).toBe("2026-11-09T14:30");
    }

    expect(parseIstDateTimeInput("2024-02-29T10:00").ok).toBe(true);
    expect(parseIstDateTimeInput("2025-02-29T10:00").ok).toBe(false);
    expect(parseIstDateTimeInput("2026-02-30T10:00").ok).toBe(false);
    expect(parseIstDateTimeInput("2026-04-31T10:00").ok).toBe(false);
    expect(parseIstDateTimeInput("2026-02-30T10:00:00Z").ok).toBe(false);
    expect(parseIstDateTimeInput("").ok).toBe(false);
  });

  it("extracts structured 409 duplicate_lead, stale_conflict, validation details, and user-safe messages", () => {
    const dupErr = new ApiError({
      status: 409,
      code: "duplicate_lead",
      message: "Duplicate lead detected",
      conflict: {
        matchReasons: ["phone"],
        matches: [
          {
            id: "lead_99",
            name: "Existing Synthetic",
            phone: "9876543210",
            status: "new",
            lifecycleStatus: "active",
            matchReasons: ["phone"],
          },
        ],
      },
    });
    expect(extractDuplicateLeadConflict(dupErr)?.matches[0]?.id).toBe("lead_99");
    expect(extractStaleConflict(dupErr)).toBeNull();

    const staleErr = new ApiError({
      status: 409,
      code: "stale_conflict",
      message: "Modified concurrently",
      conflict: {
        resource: "lead",
        id: "lead_1",
        expectedVersion: 1,
        currentVersion: 2,
      },
    });
    expect(extractStaleConflict(staleErr)).toEqual({
      resource: "lead",
      id: "lead_1",
      expectedVersion: 1,
      currentVersion: 2,
    });

    const valErr = new ApiError({
      status: 400,
      code: "validation_error",
      message: "Check fields",
      details: { email: "Invalid email", ignoredNum: 42 },
    });
    expect(extractFieldValidationErrors(valErr)).toEqual({ email: "Invalid email" });

    const unavailableErr = new ApiError({
      status: 503,
      code: "crm_unavailable",
      message: "SQL error details",
    });
    expect(formatApiErrorMessage(unavailableErr)).toContain("CRM database is unavailable");
    expect(leadDtoSchema.safeParse({ id: "bad" }).success).toBe(false);
  });

  it("enforces server-first Pilot gate even if URL search or sessionStorage requests pilot", () => {
    setLeadPilotSessionOptIn(true);
    expect(readLeadPilotSessionOptIn()).toBe(true);

    expect(
      resolveLeadPilotActive({
        leadPilotAvailable: false,
        searchPilot: "1",
        sessionOptIn: true,
      }),
    ).toBe(false);

    expect(
      resolveLeadPilotActive({
        leadPilotAvailable: true,
        searchPilot: "0",
        sessionOptIn: true,
      }),
    ).toBe(false);

    expect(
      resolveLeadPilotActive({
        leadPilotAvailable: true,
        searchPilot: "1",
        sessionOptIn: false,
      }),
    ).toBe(true);

    expect(
      resolveLeadPilotActive({
        leadPilotAvailable: true,
        searchPilot: 1,
        sessionOptIn: false,
      }),
    ).toBe(true);

    expect(
      resolveLeadPilotActive({
        leadPilotAvailable: true,
        sessionOptIn: true,
      }),
    ).toBe(true);

    // TanStack Router parses ?pilot=1 as number 1, and serialized "1" as string "1"
    expect(parsePilotSearch({ pilot: 1 })).toEqual({ pilot: 1 });
    expect(parsePilotSearch({ pilot: "1" })).toEqual({ pilot: 1 });
    expect(parsePilotSearch({ pilot: 0 })).toEqual({ pilot: 0 });
    expect(parsePilotSearch({ pilot: "invalid" })).toEqual({});
    expect(parseLeadsSearch({ pilot: 1 })).toEqual({ pilot: 1 });
    expect(parseLeadsSearch({ pilot: "1" })).toEqual({ pilot: 1 });
  });
});
