import { QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { activityKeys } from "@/lib/api/activitiesApi";
import { callKeys, createCall, getCall, listCalls, listLeadCalls } from "@/lib/api/callsApi";
import { followupKeys } from "@/lib/api/followupsApi";
import { leadKeys } from "@/lib/api/leadsApi";
import { callLogDtoSchema } from "@/lib/api/schemas";

function makeCallDto(overrides: Record<string, unknown> = {}) {
  return {
    id: "call_srv_1",
    legacyId: null,
    leadId: "lead_srv_1",
    actorUserId: "usr_owner",
    outcome: "Interested",
    connected: true,
    recordingSource: "user_recorded",
    notes: "Wants redesign quote",
    dialSource: "Lead detail",
    stageBefore: "new",
    stageAfter: "contacted",
    quickStatusAfter: "interested",
    leadActivityId: "act_call_1",
    opId: "op_call_1",
    at: "2026-11-10T09:00:00.000Z",
    atIst: "2026-11-10T14:30:00+05:30",
    occurredIstDate: "2026-11-10",
    occurredIstTime: "14:30",
    createdAt: "2026-11-10T09:00:00.000Z",
    updatedAt: "2026-11-10T09:00:00.000Z",
    ...overrides,
  };
}

function makeLeadDto(overrides: Record<string, unknown> = {}) {
  return {
    id: "lead_srv_1",
    legacyId: null,
    name: "Aarav Synthetic",
    phone: "9820001122",
    source: "Website",
    status: "contacted",
    priority: "hot",
    quickStatus: "interested",
    pinned: false,
    lifecycleStatus: "active",
    tagIds: [],
    fieldValues: {},
    version: 2,
    lastContact: "2026-11-10T09:00:00.000Z",
    createdAt: "2026-11-09T09:00:00.000Z",
    updatedAt: "2026-11-10T09:00:00.000Z",
    ...overrides,
  };
}

function jsonRes(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("B2B3 Calls Typed API Client & Contract Validation", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("builds stable TanStack query keys isolated per lead and filter", () => {
    expect(callKeys.list({ leadId: "lead_1", connected: "true" })).not.toEqual(
      callKeys.list({ leadId: "lead_1", connected: "false" }),
    );
    expect(callKeys.byLead("lead_1")).not.toEqual(callKeys.byLead("lead_2"));
    expect(callKeys.detail("call_1")).toEqual(["crm", "calls", "detail", "call_1"]);
    expect(activityKeys.byLead("lead_1")[0]).toBe("crm");
    expect(followupKeys.byLead("lead_1")[0]).toBe("crm");
    expect(leadKeys.detail("lead_1")[0]).toBe("crm");
  });

  it("parses user_recorded CallLogDto responses strictly and rejects fabricated recordingSource", () => {
    expect(callLogDtoSchema.safeParse(makeCallDto()).success).toBe(true);
    expect(
      callLogDtoSchema.safeParse(makeCallDto({ recordingSource: "device_audio" })).success,
    ).toBe(false);
  });

  it("queries listCalls, listLeadCalls, getCall, and retries keyed createCall cleanly across transient 503", async () => {
    let postAttempts = 0;
    const seenHeaders: string[] = [];

    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (url.startsWith("/api/v1/calls?") && (!init?.method || init.method === "GET")) {
        return jsonRes({
          ok: true,
          items: [
            {
              ...makeCallDto(),
              lead: {
                id: "lead_srv_1",
                name: "Aarav Synthetic",
                phone: "9820001122",
                status: "contacted",
                priority: "hot",
                lifecycleStatus: "active",
              },
            },
          ],
          total: 1,
          limit: 50,
          offset: 0,
          summary: { total: 1, connected: 1, attempts: 0 },
        });
      }
      if (url.startsWith("/api/v1/leads/lead_srv_1/calls?")) {
        return jsonRes({
          ok: true,
          leadId: "lead_srv_1",
          items: [makeCallDto()],
          total: 1,
          limit: 25,
          offset: 0,
          summary: { total: 1, connected: 1, attempts: 0 },
        });
      }
      if (url === "/api/v1/calls/call_srv_1") {
        return jsonRes({ ok: true, call: makeCallDto() });
      }
      if (url === "/api/v1/calls" && init?.method === "POST") {
        postAttempts += 1;
        const headers = new Headers(init.headers);
        seenHeaders.push(headers.get("idempotency-key") ?? "");
        if (postAttempts === 1) {
          return jsonRes(
            { ok: false, error: { code: "crm_unavailable", message: "DB unavailable" } },
            503,
          );
        }
        return jsonRes(
          {
            ok: true,
            call: makeCallDto(),
            lead: makeLeadDto(),
            activities: [
              {
                id: "act_call_1",
                legacyId: null,
                leadId: "lead_srv_1",
                actorUserId: "usr_owner",
                type: "call",
                text: "Call (Lead detail): Interested — Wants redesign quote",
                outcome: "Interested",
                opId: "op_call_1",
                at: "2026-11-10T09:00:00.000Z",
                createdAt: "2026-11-10T09:00:00.000Z",
              },
            ],
          },
          201,
        );
      }
      return jsonRes({ ok: false, error: { code: "not_found", message: "missing" } }, 404);
    });
    vi.stubGlobal("fetch", fetchMock);

    const listRes = await listCalls({ outcome: "Interested", dateIst: "2026-11-10" });
    expect(listRes.summary).toEqual({ total: 1, connected: 1, attempts: 0 });
    expect(listRes.items[0]!.lead.name).toBe("Aarav Synthetic");

    const byLeadRes = await listLeadCalls("lead_srv_1", { limit: 25 });
    expect(byLeadRes.leadId).toBe("lead_srv_1");
    expect(byLeadRes.items[0]!.recordingSource).toBe("user_recorded");

    const single = await getCall("call_srv_1");
    expect(single.id).toBe("call_srv_1");

    const qc = new QueryClient();
    expect(qc).toBeDefined();

    const created = await createCall(
      {
        leadId: "lead_srv_1",
        outcome: "Interested",
        notes: "  Wants redesign quote  ",
        dialSource: "Lead detail",
        expectedLeadVersion: 1,
        opId: "op_call_1",
      },
      "idem_call_fixed_1",
    );
    expect(postAttempts).toBe(2);
    expect(seenHeaders).toEqual(["idem_call_fixed_1", "idem_call_fixed_1"]);
    expect(created.call.id).toBe("call_srv_1");
    expect(created.lead.version).toBe(2);
  });
});
