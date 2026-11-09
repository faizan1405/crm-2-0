import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cancelFollowUp,
  completeFollowUp,
  createFollowUp,
  getFollowUp,
  listFollowUps,
  listLeadFollowUps,
  rescheduleFollowUp,
} from "./followupsApi";
import { ApiError, extractFollowUpConflict } from "./errors";

const SAMPLE_FOLLOWUP = {
  id: "fu_1",
  legacyId: null,
  leadId: "lead_1",
  type: "call" as const,
  dueAt: "2026-11-10T09:00:00.000Z",
  dueAtIst: "2026-11-10T14:30:00+05:30",
  dueIstDate: "2026-11-10",
  dueIstTime: "14:30",
  note: "Send brochure",
  status: "pending" as const,
  version: 1,
  createdAt: "2026-11-09T10:00:00.000Z",
  updatedAt: "2026-11-09T10:00:00.000Z",
};

const SAMPLE_ACTIVITY = {
  id: "act_1",
  legacyId: null,
  leadId: "lead_1",
  actorUserId: "usr_owner",
  type: "followup" as const,
  text: "Follow-up scheduled (call)",
  at: "2026-11-09T10:00:00.000Z",
  createdAt: "2026-11-09T10:00:00.000Z",
};

describe("B2B1 Follow-ups API Client Contract (Prepared for B2B2)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("serializes filters and parses GET /api/v1/follow-ups & per-lead follow-ups", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.startsWith("/api/v1/follow-ups?")) {
        return new Response(
          JSON.stringify({
            ok: true,
            items: [
              {
                ...SAMPLE_FOLLOWUP,
                bucket: "today",
                lead: {
                  id: "lead_1",
                  name: "Priya Demo",
                  phone: "9876543210",
                  company: "Acme Co",
                  status: "qualified",
                  priority: "hot",
                  lifecycleStatus: "active",
                },
              },
            ],
            total: 1,
            limit: 25,
            offset: 0,
            summary: { overdue: 0, today: 1, upcoming: 0, done: 0, pending: 1 },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url === "/api/v1/leads/lead_1/follow-ups") {
        return new Response(
          JSON.stringify({
            ok: true,
            leadId: "lead_1",
            items: [SAMPLE_FOLLOWUP],
            activeFollowUpId: "fu_1",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response(JSON.stringify({ ok: true, followUp: SAMPLE_FOLLOWUP }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    vi.stubGlobal("fetch", fetchMock);

    const listed = await listFollowUps({
      bucket: "today",
      dateIst: "2026-11-10",
      type: "call",
      limit: 25,
    });
    expect(listed.summary.today).toBe(1);
    expect(listed.items[0]!.lead.company).toBe("Acme Co");
    expect(fetchMock.mock.calls[0]![0]).toBe(
      "/api/v1/follow-ups?bucket=today&dateIst=2026-11-10&type=call&leadLifecycle=active&limit=25&offset=0",
    );

    const byLead = await listLeadFollowUps("lead_1");
    expect(byLead.activeFollowUpId).toBe("fu_1");

    const single = await getFollowUp("fu_1");
    expect(single.version).toBe(1);
  });

  it("rejects impossible IST calendar rollover dates locally before POST and normalizes valid dates to UTC ISO", async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify({
            ok: true,
            followUp: SAMPLE_FOLLOWUP,
            replacedFollowUpId: "fu_prev",
            leadNextFollowUp: "2026-11-10T09:00:00.000Z",
            activity: SAMPLE_ACTIVITY,
          }),
          { status: 201, headers: { "content-type": "application/json" } },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      createFollowUp({
        leadId: "lead_1",
        type: "call",
        dueAt: "2026-02-30T10:00",
      }),
    ).rejects.toMatchObject({ status: 400, code: "validation_error" });
    expect(fetchMock).not.toHaveBeenCalled();

    const created = await createFollowUp(
      {
        leadId: "lead_1",
        type: "call",
        dueAt: "2026-11-10T14:30",
        note: "  Send brochure  ",
        replaceActiveFollowUpId: "fu_prev",
        opId: "op_abc",
      },
      "idem_fu_create",
    );
    expect(created.replacedFollowUpId).toBe("fu_prev");
    const sentBody = JSON.parse(String(fetchMock.mock.calls[0]![1]!.body)) as Record<
      string,
      unknown
    >;
    expect(sentBody["dueAt"]).toBe("2026-11-10T09:00:00.000Z");
    expect(sentBody["replaceActiveFollowUpId"]).toBe("fu_prev");
    expect(sentBody["note"]).toBe("Send brochure");
    expect(sentBody["idempotencyKey"]).toBe("idem_fu_create");
  });

  it("extracts 409 followup_conflict and handles reschedule, complete, and cancel contracts", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (url, init) => {
      if (String(url).endsWith("/api/v1/follow-ups") && init?.method === "POST") {
        return new Response(
          JSON.stringify({
            ok: false,
            error: {
              code: "followup_conflict",
              message: "An active follow-up already exists for this lead.",
              conflict: { activeFollowUp: SAMPLE_FOLLOWUP },
            },
          }),
          { status: 409, headers: { "content-type": "application/json" } },
        );
      }
      if (String(url).endsWith("/complete")) {
        return new Response(
          JSON.stringify({
            ok: true,
            followUp: {
              ...SAMPLE_FOLLOWUP,
              status: "completed",
              version: 2,
              completedAt: "2026-11-10T09:05:00.000Z",
            },
            leadLastContact: "2026-11-10T09:05:00.000Z",
            leadNextFollowUp: null,
            activity: SAMPLE_ACTIVITY,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (String(url).endsWith("/cancel")) {
        return new Response(
          JSON.stringify({
            ok: true,
            followUp: {
              ...SAMPLE_FOLLOWUP,
              status: "cancelled",
              version: 3,
              cancelledAt: "2026-11-10T09:06:00.000Z",
              cancelReason: "Client postponed",
            },
            leadNextFollowUp: null,
            activity: SAMPLE_ACTIVITY,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response(
        JSON.stringify({
          ok: true,
          followUp: { ...SAMPLE_FOLLOWUP, version: 2, dueAt: "2026-11-11T09:00:00.000Z" },
          leadNextFollowUp: "2026-11-11T09:00:00.000Z",
          activity: SAMPLE_ACTIVITY,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    try {
      await createFollowUp({
        leadId: "lead_1",
        type: "call",
        dueAt: "2026-11-10T14:30",
      });
      expect.unreachable("Expected 409 conflict");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      const conflict = extractFollowUpConflict(err);
      expect(conflict?.activeFollowUp?.id).toBe("fu_1");
    }

    const rescheduled = await rescheduleFollowUp("fu_1", {
      version: 1,
      dueAt: "2026-11-11T14:30",
    });
    expect(rescheduled.followUp.version).toBe(2);

    const completed = await completeFollowUp("fu_1", { version: 2 }, "idem_complete");
    expect(completed.followUp.status).toBe("completed");
    expect(completed.leadNextFollowUp).toBeNull();

    const cancelled = await cancelFollowUp("fu_1", { version: 2, reason: "Client postponed" });
    expect(cancelled.followUp.status).toBe("cancelled");
    expect(cancelled.followUp.cancelReason).toBe("Client postponed");
  });
});
