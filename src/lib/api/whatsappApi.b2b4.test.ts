import { QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { activityKeys } from "@/lib/api/activitiesApi";
import { leadKeys } from "@/lib/api/leadsApi";
import { waMessageDtoSchema } from "@/lib/api/schemas";
import {
  createWhatsAppMessage,
  getWhatsAppMessage,
  listLeadWhatsAppMessages,
  listWhatsAppMessages,
  waKeys,
} from "@/lib/api/whatsappApi";

function makeWaMessageDto(overrides: Record<string, unknown> = {}) {
  return {
    id: "wa_srv_1",
    legacyId: null,
    leadId: "lead_srv_1",
    actorUserId: "usr_owner",
    purpose: "followup",
    templateId: "tpl_followup",
    templateName: "Friendly follow-up",
    recipientPhone: "919820001122",
    messageText: "Hi Aarav, this is Owner from Scale Flow. Just following up.",
    confirmationStatus: "owner_confirmed_sent",
    composerSource: "Lead detail",
    leadActivityId: "act_wa_1",
    opId: "op_wa_1",
    confirmedAt: "2026-11-10T09:00:00.000Z",
    confirmedAtIst: "2026-11-10T14:30:00+05:30",
    confirmedIstDate: "2026-11-10",
    confirmedIstTime: "14:30",
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
    status: "new",
    priority: "hot",
    pinned: false,
    lifecycleStatus: "active",
    tagIds: [],
    fieldValues: {},
    version: 2,
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

describe("B2B4 WhatsApp Typed API Client & Contract Validation", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("builds stable TanStack query keys isolated per lead and filter", () => {
    expect(waKeys.list({ leadId: "lead_1", purpose: "followup" })).not.toEqual(
      waKeys.list({ leadId: "lead_1", purpose: "quotation" }),
    );
    expect(waKeys.byLead("lead_1")).not.toEqual(waKeys.byLead("lead_2"));
    expect(waKeys.detail("wa_1")).toEqual(["crm", "whatsapp", "detail", "wa_1"]);
    expect(activityKeys.byLead("lead_1")[0]).toBe("crm");
    expect(leadKeys.detail("lead_1")[0]).toBe("crm");
  });

  it("parses owner_confirmed_sent WaMessageDto responses strictly and rejects fabricated confirmationStatus", () => {
    expect(waMessageDtoSchema.safeParse(makeWaMessageDto()).success).toBe(true);
    for (const fake of ["delivered", "verified_sent", "read"]) {
      expect(
        waMessageDtoSchema.safeParse(makeWaMessageDto({ confirmationStatus: fake })).success,
      ).toBe(false);
    }
  });

  it("queries listWhatsAppMessages, listLeadWhatsAppMessages, getWhatsAppMessage, and retries keyed createWhatsAppMessage cleanly across transient 503", async () => {
    let postAttempts = 0;
    const seenHeaders: string[] = [];

    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (
        url.startsWith("/api/v1/whatsapp-messages?") &&
        (!init?.method || init.method === "GET")
      ) {
        return jsonRes({
          ok: true,
          items: [
            {
              ...makeWaMessageDto(),
              lead: {
                id: "lead_srv_1",
                name: "Aarav Synthetic",
                phone: "9820001122",
                status: "new",
                priority: "hot",
                lifecycleStatus: "active",
              },
            },
          ],
          total: 1,
          limit: 50,
          offset: 0,
        });
      }
      if (url.startsWith("/api/v1/leads/lead_srv_1/whatsapp-messages?")) {
        return jsonRes({
          ok: true,
          leadId: "lead_srv_1",
          items: [makeWaMessageDto()],
          total: 1,
          limit: 25,
          offset: 0,
        });
      }
      if (url === "/api/v1/whatsapp-messages/wa_srv_1") {
        return jsonRes({ ok: true, message: makeWaMessageDto() });
      }
      if (url === "/api/v1/whatsapp-messages" && init?.method === "POST") {
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
            message: makeWaMessageDto(),
            lead: makeLeadDto(),
            activity: {
              id: "act_wa_1",
              legacyId: null,
              leadId: "lead_srv_1",
              actorUserId: "usr_owner",
              type: "whatsapp",
              text: "WhatsApp follow-up message (from Lead detail) — Friendly follow-up: Hi Aarav, this is Owner from Scale Flow. Just following up.",
              opId: "op_wa_1",
              at: "2026-11-10T09:00:00.000Z",
              createdAt: "2026-11-10T09:00:00.000Z",
            },
          },
          201,
        );
      }
      return jsonRes({ ok: false, error: { code: "not_found", message: "missing" } }, 404);
    });
    vi.stubGlobal("fetch", fetchMock);

    const listRes = await listWhatsAppMessages({ purpose: "followup", dateIst: "2026-11-10" });
    expect(listRes.total).toBe(1);
    expect(listRes.items[0]!.lead.name).toBe("Aarav Synthetic");

    const byLeadRes = await listLeadWhatsAppMessages("lead_srv_1", { limit: 25 });
    expect(byLeadRes.leadId).toBe("lead_srv_1");
    expect(byLeadRes.items[0]!.confirmationStatus).toBe("owner_confirmed_sent");

    const single = await getWhatsAppMessage("wa_srv_1");
    expect(single.id).toBe("wa_srv_1");

    const qc = new QueryClient();
    expect(qc).toBeDefined();

    const created = await createWhatsAppMessage(
      {
        leadId: "lead_srv_1",
        purpose: "followup",
        templateId: "tpl_followup",
        templateName: "  Friendly follow-up  ",
        messageText: "Hi Aarav, this is Owner from Scale Flow. Just following up.",
        confirmedSent: true,
        composerSource: "Lead detail",
        expectedLeadVersion: 1,
        opId: "op_wa_1",
      },
      "idem_wa_fixed_1",
    );
    expect(postAttempts).toBe(2);
    expect(seenHeaders).toEqual(["idem_wa_fixed_1", "idem_wa_fixed_1"]);
    expect(created.message.id).toBe("wa_srv_1");
    expect(created.lead.version).toBe(2);
  });
});
