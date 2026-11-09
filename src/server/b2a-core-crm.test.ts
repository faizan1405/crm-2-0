import { getTableColumns } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { crmIdempotencyKeys } from "./db/schema.server";
import {
  followUpBucketServer,
  istDayBoundsUtc,
  mysqlUtcToIso,
  parseBusinessDateTimeToUtc,
  toIstParts,
} from "./crm/dates.server";
import { CrmServiceError } from "./crm/errors.server";
import {
  canonicalizeValue,
  hashIdempotentRequest,
  resolveEffectiveIdempotencyKey,
} from "./crm/idempotency.server";
import { createLeadActivity } from "./crm/activitiesService.server";
import {
  ALL_ACTIVITY_TYPES,
  buildLeadEditSummary,
  createFollowUpBodySchema,
  createLeadBodySchema,
  extractLeadPhoneKey,
  isValidLeadPhone,
  MANUAL_ACTIVITY_TYPES,
  normalizeLeadEmail,
  updateFollowUpBodySchema,
  updateLeadBodySchema,
} from "./crm/validation.server";
import { handleApiRequest } from "./http/apiRouter.server";

describe("B2A IST Business Dates & Calendar Validation", () => {
  it("parses naive datetime-local in Asia/Kolkata and zoned ISO strings accurately", () => {
    const naive = parseBusinessDateTimeToUtc("2026-11-10T23:45");
    expect(naive.ok).toBe(true);
    if (naive.ok) {
      expect(naive.value.utcIso).toBe("2026-11-10T18:15:00.000Z");
      expect(naive.value.mysqlUtc).toBe("2026-11-10 18:15:00.000");
      expect(naive.value.istDate).toBe("2026-11-10");
      expect(naive.value.istTime).toBe("23:45");
    }

    const zonedCrossMidnight = parseBusinessDateTimeToUtc("2026-11-10T19:00:00.000Z");
    expect(zonedCrossMidnight.ok).toBe(true);
    if (zonedCrossMidnight.ok) {
      expect(zonedCrossMidnight.value.istDate).toBe("2026-11-11");
      expect(zonedCrossMidnight.value.istTime).toBe("00:30");
    }

    const bounds = istDayBoundsUtc("2026-11-10");
    expect(bounds.startMysqlUtc).toBe("2026-11-09 18:30:00.000");
    expect(bounds.endExclusiveMysqlUtc).toBe("2026-11-10 18:30:00.000");
    expect(mysqlUtcToIso("2026-11-10 18:15:00.000")).toBe("2026-11-10T18:15:00.000Z");
    expect(toIstParts(new Date("2026-11-10T18:29:59.000Z")).istDate).toBe("2026-11-10");
    expect(toIstParts(new Date("2026-11-10T18:30:00.000Z")).istDate).toBe("2026-11-11");
  });

  it("rejects calendar rollovers and invalid time/timezone strings", () => {
    expect(parseBusinessDateTimeToUtc("2026-02-30T10:00").ok).toBe(false);
    expect(parseBusinessDateTimeToUtc("2026-02-29T10:00").ok).toBe(false);
    expect(parseBusinessDateTimeToUtc("2024-02-29T10:00").ok).toBe(true);
    expect(parseBusinessDateTimeToUtc("2026-04-31T10:00").ok).toBe(false);
    expect(parseBusinessDateTimeToUtc("2026-11-10T24:00").ok).toBe(false);
    expect(parseBusinessDateTimeToUtc("2026-11-10T10:60Z").ok).toBe(false);
    expect(parseBusinessDateTimeToUtc("2026-11-10T10:00+25:00").ok).toBe(false);
    expect(parseBusinessDateTimeToUtc("not-a-date").ok).toBe(false);
  });

  it("computes Follow-up buckets across IST midnight consistently", () => {
    const now = new Date("2026-11-10T18:00:00.000Z"); // 23:30 IST on 2026-11-10
    expect(
      followUpBucketServer(
        {
          dueAtMysqlUtc: "2026-11-10 17:00:00.000",
          dueIstDate: "2026-11-10",
          completedAt: null,
          cancelledAt: null,
        },
        now,
      ),
    ).toBe("overdue");

    expect(
      followUpBucketServer(
        {
          dueAtMysqlUtc: "2026-11-10 18:15:00.000", // 23:45 IST on 2026-11-10
          dueIstDate: "2026-11-10",
          completedAt: null,
          cancelledAt: null,
        },
        now,
      ),
    ).toBe("today");

    expect(
      followUpBucketServer(
        {
          dueAtMysqlUtc: "2026-11-10 18:45:00.000", // 00:15 IST on 2026-11-11
          dueIstDate: "2026-11-11",
          completedAt: null,
          cancelledAt: null,
        },
        now,
      ),
    ).toBe("upcoming");

    expect(
      followUpBucketServer(
        {
          dueAtMysqlUtc: "2026-11-10 17:00:00.000",
          dueIstDate: "2026-11-10",
          completedAt: "2026-11-10 17:05:00.000",
          cancelledAt: null,
        },
        now,
      ),
    ).toBe("done");
  });
});

describe("B2A Validation, Normalization & Activity Safeguards", () => {
  it("normalizes Indian mobile numbers and email addresses identically to frontend", () => {
    expect(isValidLeadPhone("+91 98765 43210")).toBe(true);
    expect(isValidLeadPhone("9876543210")).toBe(true);
    expect(isValidLeadPhone("5876543210")).toBe(false);
    expect(isValidLeadPhone("12345")).toBe(false);
    expect(extractLeadPhoneKey("+91 98765 43210")).toBe("9876543210");
    expect(normalizeLeadEmail("  Owner@Example.COM ")).toBe("owner@example.com");
  });

  it("enforces Lead & Follow-up schemas matching CRM business rules", () => {
    expect(
      createLeadBodySchema.safeParse({
        name: "Aarav Sharma",
        phone: "+91 98765 43210",
        status: "lost",
      }).success,
    ).toBe(false);

    expect(
      createLeadBodySchema.safeParse({
        name: "Aarav Sharma",
        phone: "+91 98765 43210",
        status: "lost",
        lostReason: "Budget mismatch",
        quotedAmount: 125000.5,
        budget: 150000,
      }).success,
    ).toBe(true);

    expect(
      createLeadBodySchema.safeParse({
        name: "Aarav",
        phone: "9876543210",
        quotedAmount: -10,
      }).success,
    ).toBe(false);

    expect(
      createLeadBodySchema.safeParse({
        name: "Aarav",
        phone: "9876543210",
        quotedAmount: 100.123,
      }).success,
    ).toBe(false);

    expect(updateLeadBodySchema.safeParse({ version: 1 }).success).toBe(false);
    expect(updateLeadBodySchema.safeParse({ version: 0, name: "X" }).success).toBe(false);
    expect(updateLeadBodySchema.safeParse({ version: 1, name: "X" }).success).toBe(true);

    expect(
      createFollowUpBodySchema.safeParse({
        leadId: "lead_1",
        type: "call",
        dueAt: "2026-02-30T10:00",
      }).success,
    ).toBe(false);

    expect(
      updateFollowUpBodySchema.safeParse({
        version: 1,
      }).success,
    ).toBe(false);
  });

  it("builds privacy-safe contact edit summaries without logging raw PII values", () => {
    const msg = buildLeadEditSummary(
      { phone: "9876543210", email: "old@example.com", company: "Acme" },
      { phone: "9123456780", email: "old@example.com", company: "Beta" },
    );
    expect(msg).toBe("Contact details updated: phone, company changed");
    expect(msg).not.toContain("9876543210");
    expect(msg).not.toContain("9123456780");
  });

  it("rejects fabricated call, whatsapp, payment, and system activity types on direct creation", async () => {
    expect(MANUAL_ACTIVITY_TYPES).toEqual(["note", "meeting", "email"]);

    const forbidden = ALL_ACTIVITY_TYPES.filter(
      (t) => !(MANUAL_ACTIVITY_TYPES as readonly string[]).includes(t),
    );
    expect(forbidden).toContain("call");
    expect(forbidden).toContain("whatsapp");
    expect(forbidden).toContain("payment");
    expect(forbidden).toContain("created");

    for (const type of forbidden) {
      await expect(
        createLeadActivity({} as never, "usr_owner", "usr_owner", "lead_1", {
          type,
          text: "Attempted spoof",
        }),
      ).rejects.toMatchObject({
        status: 400,
        code: "activity_type_not_permitted",
      });
    }
  });
});

describe("B2A Request Idempotency Helpers", () => {
  it("hashes equivalent objects identically and detects key header/body conflicts", () => {
    expect(canonicalizeValue({ b: 2, a: { y: 1, x: 0 } })).toEqual({
      a: { x: 0, y: 1 },
      b: 2,
    });
    const h1 = hashIdempotentRequest("lead:create", {
      name: "A",
      meta: { b: 2, a: 1 },
    });
    const h2 = hashIdempotentRequest("lead:create", {
      meta: { a: 1, b: 2 },
      name: "A",
    });
    expect(h1).toBe(h2);

    expect(() =>
      resolveEffectiveIdempotencyKey({ headerKey: "key-1", bodyKey: "key-2" }),
    ).toThrowError(CrmServiceError);
    expect(() => resolveEffectiveIdempotencyKey({ headerKey: "bad\nkey" })).toThrowError(
      CrmServiceError,
    );
    expect(resolveEffectiveIdempotencyKey({ headerKey: "same-key", bodyKey: "same-key" })).toBe(
      "same-key",
    );

    const sampleLeadId = "lead_00000000-0000-4000-8000-000000000001";
    const sampleFuId = "fu_00000000-0000-4000-8000-000000000001";
    const maxScopeLen =
      (getTableColumns(crmIdempotencyKeys).scope as { length?: number }).length ?? 0;
    expect(maxScopeLen).toBeGreaterThanOrEqual(128);
    for (const s of [
      `lead:update:${sampleLeadId}`,
      `lead:archive:${sampleLeadId}`,
      `lead:restore:${sampleLeadId}`,
      `activity:create:${sampleLeadId}`,
      `followup:update:${sampleFuId}`,
      `followup:complete:${sampleFuId}`,
      `followup:cancel:${sampleFuId}`,
    ]) {
      expect(s.length).toBeLessThanOrEqual(maxScopeLen);
    }
  });
});

describe("B2A API Fail-Closed Auth, CSRF & Method Discipline", () => {
  const endpoints: { method: string; path: string; body?: Record<string, unknown> }[] = [
    { method: "GET", path: "/api/v1/leads" },
    { method: "POST", path: "/api/v1/leads", body: { name: "Test", phone: "9876543210" } },
    { method: "GET", path: "/api/v1/leads/lead_1" },
    { method: "PATCH", path: "/api/v1/leads/lead_1", body: { version: 1, name: "New" } },
    { method: "DELETE", path: "/api/v1/leads/lead_1" },
    { method: "POST", path: "/api/v1/leads/lead_1/archive", body: { version: 1, kind: "waste" } },
    { method: "POST", path: "/api/v1/leads/lead_1/restore", body: {} },
    { method: "GET", path: "/api/v1/leads/lead_1/activities" },
    {
      method: "POST",
      path: "/api/v1/leads/lead_1/activities",
      body: { type: "note", text: "Spoke" },
    },
    { method: "GET", path: "/api/v1/leads/lead_1/follow-ups" },
    { method: "GET", path: "/api/v1/follow-ups" },
    {
      method: "POST",
      path: "/api/v1/follow-ups",
      body: { leadId: "lead_1", type: "call", dueAt: "2026-11-12T10:30" },
    },
    { method: "GET", path: "/api/v1/follow-ups/fu_1" },
    { method: "PATCH", path: "/api/v1/follow-ups/fu_1", body: { version: 1, note: "Moved" } },
    { method: "POST", path: "/api/v1/follow-ups/fu_1/complete", body: { version: 1 } },
    { method: "POST", path: "/api/v1/follow-ups/fu_1/cancel", body: { version: 1 } },
  ];

  it("fails closed (503/401) on every B2A endpoint without an active DB/session", async () => {
    for (const ep of endpoints) {
      const req = new Request(`http://127.0.0.1:4173${ep.path}`, {
        method: ep.method,
        ...(ep.body
          ? {
              headers: { "content-type": "application/json" },
              body: JSON.stringify(ep.body),
            }
          : {}),
      });
      const res = await handleApiRequest(req);
      expect(res).not.toBeNull();
      expect([401, 503]).toContain(res!.status);
      expect(res!.headers.get("cache-control")).toContain("no-store");
    }
  });

  it("enforces same-origin CSRF, JSON content-type, and 405 Method Not Allowed", async () => {
    const crossOriginPost = await handleApiRequest(
      new Request("http://127.0.0.1:4173/api/v1/leads", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://evil.example",
          "sec-fetch-site": "cross-site",
        },
        body: JSON.stringify({ name: "X", phone: "9876543210" }),
      }),
    );
    expect(crossOriginPost!.status).toBe(403);

    const crossOriginDelete = await handleApiRequest(
      new Request("http://127.0.0.1:4173/api/v1/leads/lead_1", {
        method: "DELETE",
        headers: {
          origin: "https://evil.example",
        },
      }),
    );
    expect(crossOriginDelete!.status).toBe(403);

    const badContentType = await handleApiRequest(
      new Request("http://127.0.0.1:4173/api/v1/follow-ups", {
        method: "POST",
        headers: {
          "content-type": "text/plain",
          origin: "http://127.0.0.1:4173",
        },
        body: "{}",
      }),
    );
    expect(badContentType!.status).toBe(403);

    const badMethod = await handleApiRequest(
      new Request("http://127.0.0.1:4173/api/v1/leads/lead_1/archive", {
        method: "GET",
      }),
    );
    expect(badMethod!.status).toBe(405);
    expect(badMethod!.headers.get("allow")).toBe("POST");
  });
});
