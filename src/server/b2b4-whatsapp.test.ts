import { getTableColumns } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { WA_LABEL, WA_PURPOSES as CLIENT_WA_PURPOSES, waNumber } from "@/lib/crm/whatsapp";
import { crmCoreSchema, crmIdempotencyKeys, crmLeads, crmWhatsAppLogs } from "./db/schema.server";
import { buildWhatsAppActivityText, createWhatsAppLogRecord } from "./crm/whatsappService.server";
import { toWhatsAppLogDto, type WhatsAppLogRow } from "./crm/mappers.server";
import {
  createWhatsAppLogBodySchema,
  listLeadWhatsAppQuerySchema,
  listWhatsAppQuerySchema,
  normalizeWhatsAppRecipientPhone,
  WA_CONFIRMATION_STATUSES,
  WA_PURPOSE_LABEL,
  WA_PURPOSES,
  type LeadLifecycleStatus,
  type LeadPriority,
  type LeadSource,
  type LeadStatus,
  type QuickStatus,
} from "./crm/validation.server";

function makeWhatsAppRow(overrides: Partial<WhatsAppLogRow> = {}): WhatsAppLogRow {
  return {
    id: "wa_srv_1",
    legacyId: null,
    ownerUserId: "usr_owner",
    leadId: "lead_1",
    actorUserId: "usr_owner",
    purpose: "followup",
    templateId: "tpl_followup",
    templateName: "Friendly follow-up",
    recipientPhone: "919876543210",
    messageText: "Hi Aarav, this is Owner from Scale Flow. Just following up.",
    confirmationStatus: "owner_confirmed_sent",
    composerSource: "Lead detail",
    leadActivityId: "act_wa_1",
    opId: "op_wa_1",
    idempotencyKey: "idem_wa_1",
    confirmedAt: "2026-11-10 09:00:00.000",
    confirmedIstDate: "2026-11-10",
    confirmedIstTime: "14:30",
    createdAt: "2026-11-10 09:00:00.000",
    updatedAt: "2026-11-10 09:00:00.000",
    ...overrides,
  };
}

interface MockLeadState {
  id: string;
  legacyId: string | null;
  ownerUserId: string;
  name: string;
  phone: string;
  phoneKey: string;
  email: string | null;
  emailNormalized: string | null;
  company: string | null;
  requirement: string | null;
  source: LeadSource;
  status: LeadStatus;
  priority: LeadPriority;
  aiScore: number | null;
  quotedAmount: string | null;
  budget: string | null;
  lastContactAt: string | null;
  nextFollowUpAt: string | null;
  notes: string | null;
  pinned: boolean;
  quickStatus: QuickStatus | null;
  lostReason: string | null;
  lifecycleStatus: LeadLifecycleStatus;
  archivedAt: string | null;
  archiveReason: string | null;
  createdByUserId: string;
  updatedByUserId: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

function makeMockLeadState(overrides: Partial<MockLeadState> = {}): MockLeadState {
  return {
    id: "lead_1",
    legacyId: null,
    ownerUserId: "usr_owner",
    name: "Aarav Synthetic",
    phone: "+91 98765 43210",
    phoneKey: "9876543210",
    email: "aarav@synthetic.example",
    emailNormalized: "aarav@synthetic.example",
    company: "Synthetic Exports",
    requirement: "3D Website",
    source: "Website",
    status: "new",
    priority: "hot",
    aiScore: 84,
    quotedAmount: "95000.00",
    budget: "120000.00",
    lastContactAt: null,
    nextFollowUpAt: null,
    notes: "Initial discovery note",
    pinned: false,
    quickStatus: "not_picked",
    lostReason: null,
    lifecycleStatus: "active",
    archivedAt: null,
    archiveReason: null,
    createdByUserId: "usr_owner",
    updatedByUserId: "usr_owner",
    version: 1,
    createdAt: "2026-11-09 09:00:00.000",
    updatedAt: "2026-11-09 09:00:00.000",
    ...overrides,
  };
}

function createMockWhatsAppDb(options: { lead?: MockLeadState; duplicateOpId?: boolean }) {
  let currentLead = options.lead ? { ...options.lead } : undefined;
  const insertedMessages: Record<string, unknown>[] = [];
  const insertedActivities: Record<string, unknown>[] = [];

  const fullTx = {
    select: (fields?: unknown) => ({
      from: (table: unknown) => ({
        where: () => {
          if (fields) {
            return Promise.resolve([]);
          }
          return {
            limit: () => {
              const exec = async () => {
                if (table === crmIdempotencyKeys) {
                  return [];
                }
                if (table === crmWhatsAppLogs) {
                  return options.duplicateOpId ? [makeWhatsAppRow()] : [];
                }
                if (table === crmLeads) {
                  return currentLead ? [currentLead] : [];
                }
                return [];
              };
              const base = exec();
              return Object.assign(base, { for: exec });
            },
          };
        },
      }),
    }),
    update: () => ({
      set: (patch: Record<string, unknown>) => ({
        where: async () => {
          if (!currentLead) return [{ affectedRows: 0 }, undefined];
          currentLead = { ...currentLead, ...(patch as Partial<MockLeadState>) };
          return [{ affectedRows: 1 }, undefined];
        },
      }),
    }),
    insert: (table: unknown) => ({
      values: async (vals: unknown) => {
        if (table === crmWhatsAppLogs) {
          insertedMessages.push(vals as Record<string, unknown>);
        } else {
          insertedActivities.push(vals as Record<string, unknown>);
        }
      },
    }),
  };

  const db = {
    transaction: async <T>(fn: (tx: typeof fullTx) => Promise<T>): Promise<T> => fn(fullTx),
  };

  return {
    db: db as never,
    getLeadState: () => currentLead,
    insertedMessages,
    insertedActivities,
  };
}

describe("B2B4 WhatsApp Logging Domain Parity, Schemas & Mapper", () => {
  it("keeps server WhatsApp schema and core registry cleanly registered", () => {
    expect(crmCoreSchema.crmWhatsAppLogs).toBe(crmWhatsAppLogs);
    const cols = getTableColumns(crmWhatsAppLogs);
    expect(Object.keys(cols)).toEqual(
      expect.arrayContaining([
        "id",
        "ownerUserId",
        "leadId",
        "actorUserId",
        "purpose",
        "templateId",
        "templateName",
        "recipientPhone",
        "messageText",
        "confirmationStatus",
        "composerSource",
        "leadActivityId",
        "opId",
        "idempotencyKey",
        "confirmedAt",
        "confirmedIstDate",
        "confirmedIstTime",
      ]),
    );
    expect(cols.confirmationStatus.default).toBe("owner_confirmed_sent");
    expect(WA_CONFIRMATION_STATUSES).toEqual(["owner_confirmed_sent"]);
  });

  it("matches frontend src/lib/crm/whatsapp.ts purposes, labels, and phone normalization", () => {
    expect(WA_PURPOSES).toEqual(CLIENT_WA_PURPOSES);
    for (const p of WA_PURPOSES) {
      expect(WA_PURPOSE_LABEL[p]).toBe(WA_LABEL[p]);
    }

    const samples = [
      "98765 43210",
      "+91 98765-43210",
      "098765 43210",
      "919876543210",
      "6123456789",
      "12345",
      "1234567890",
      "5876543210",
      "",
    ];
    for (const raw of samples) {
      expect(normalizeWhatsAppRecipientPhone(raw)).toBe(waNumber(raw));
    }
  });

  it("validates create and list WhatsApp schemas strictly and rejects unconfirmed or delivery-claiming statuses", () => {
    const valid = createWhatsAppLogBodySchema.safeParse({
      leadId: "lead_1",
      purpose: "followup",
      templateId: "tpl_followup",
      templateName: "  Friendly follow-up  ",
      recipientPhone: "+91 98765 43210",
      messageText: "  Hi Aarav,\r\nFollowing up on the proposal.  ",
      confirmedSent: true,
      composerSource: "  ",
    });
    expect(valid.success).toBe(true);
    if (valid.success) {
      expect(valid.data.composerSource).toBe("CRM");
      expect(valid.data.templateName).toBe("Friendly follow-up");
      expect(valid.data.messageText).toBe("Hi Aarav,\nFollowing up on the proposal.");
      expect(valid.data.confirmationStatus).toBe("owner_confirmed_sent");
    }

    // Rejects unconfirmed sends
    expect(
      createWhatsAppLogBodySchema.safeParse({
        leadId: "lead_1",
        purpose: "followup",
        messageText: "Hi",
        confirmedSent: false,
      }).success,
    ).toBe(false);

    // Rejects fabricated delivery / verification claims
    for (const fakeStatus of ["delivered", "verified_sent", "read", "auto_sent"]) {
      expect(
        createWhatsAppLogBodySchema.safeParse({
          leadId: "lead_1",
          purpose: "followup",
          messageText: "Hi",
          confirmedSent: true,
          confirmationStatus: fakeStatus,
        }).success,
      ).toBe(false);
    }

    // Rejects blank or oversized messageText
    expect(
      createWhatsAppLogBodySchema.safeParse({
        leadId: "lead_1",
        purpose: "custom",
        messageText: "   ",
        confirmedSent: true,
      }).success,
    ).toBe(false);

    expect(
      createWhatsAppLogBodySchema.safeParse({
        leadId: "lead_1",
        purpose: "custom",
        messageText: "x".repeat(4097),
        confirmedSent: true,
      }).success,
    ).toBe(false);

    // Rejects invalid recipientPhone
    expect(
      createWhatsAppLogBodySchema.safeParse({
        leadId: "lead_1",
        purpose: "custom",
        recipientPhone: "12345",
        messageText: "Hi",
        confirmedSent: true,
      }).success,
    ).toBe(false);

    expect(listWhatsAppQuerySchema.safeParse({ dateIst: "2026-02-30" }).success).toBe(false);
    expect(
      listWhatsAppQuerySchema.safeParse({
        dateIst: "2026-11-10",
        purpose: "quotation",
        limit: "25",
      }).success,
    ).toBe(true);
    expect(listLeadWhatsAppQuerySchema.safeParse({ purpose: "invalid" }).success).toBe(false);
  });

  it("maps WhatsAppLogRow to WhatsAppLogDto with owner_confirmed_sent provenance and IST fields", () => {
    const dto = toWhatsAppLogDto(makeWhatsAppRow());
    expect(dto.confirmationStatus).toBe("owner_confirmed_sent");
    expect(dto.purpose).toBe("followup");
    expect(dto.recipientPhone).toBe("919876543210");
    expect(dto.confirmedAt).toBe("2026-11-10T09:00:00.000Z");
    expect(dto.confirmedAtIst).toBe("2026-11-10T14:30:00+05:30");
    expect(dto.confirmedIstDate).toBe("2026-11-10");
    expect(dto.confirmedIstTime).toBe("14:30");
  });
});

describe("B2B4 WhatsApp Service Honesty, Conflict & Atomic Write Rules", () => {
  it("persists owner_confirmed_sent log + paired whatsapp activity while preserving lastContactAt, stage, and quickStatus", async () => {
    const h = createMockWhatsAppDb({
      lead: makeMockLeadState({
        status: "new",
        quickStatus: "not_picked",
        lastContactAt: null,
      }),
    });

    const longBody =
      `Hi Aarav, sharing the full proposal details for Synthetic Exports. ${"Please review the milestone breakdown. ".repeat(5)}`.trim();

    const res = await createWhatsAppLogRecord(
      h.db,
      "usr_owner",
      "usr_owner",
      {
        leadId: "lead_1",
        purpose: "quotation",
        templateId: "tpl_quotation",
        templateName: "Quotation intro",
        messageText: longBody,
        confirmedSent: true,
        confirmationStatus: "owner_confirmed_sent",
        composerSource: "Lead detail",
        expectedLeadVersion: 1,
      },
      { now: new Date("2026-11-10T09:30:00.000Z") },
    );

    expect(res.status).toBe(201);
    expect(res.body.message.confirmationStatus).toBe("owner_confirmed_sent");
    expect(res.body.message.recipientPhone).toBe("919876543210");
    expect(res.body.message.messageText).toBe(longBody);
    expect(res.body.message.templateId).toBe("tpl_quotation");
    expect(res.body.message.templateName).toBe("Quotation intro");
    // Honesty: outbound WhatsApp send does NOT fabricate two-way contact or advance stage/quickStatus!
    expect(res.body.lead.lastContact).toBeUndefined();
    expect(res.body.lead.status).toBe("new");
    expect(res.body.lead.quickStatus).toBe("not_picked");
    expect(res.body.lead.version).toBe(2);
    expect(h.getLeadState()?.lastContactAt).toBeNull();

    expect(res.body.activity.type).toBe("whatsapp");
    expect(res.body.activity.text).toBe(
      buildWhatsAppActivityText({
        purpose: "quotation",
        composerSource: "Lead detail",
        templateName: "Quotation intro",
        messageText: longBody,
      }),
    );
    expect(res.body.activity.text).toContain(
      "WhatsApp quotation message (from Lead detail) — Quotation intro:",
    );
    expect(res.body.activity.text.endsWith("…")).toBe(true);
  });

  it("rejects mismatched recipient phone, invalid lead WhatsApp phone, stale version, archived lead, and opId collision", async () => {
    const hMismatch = createMockWhatsAppDb({ lead: makeMockLeadState({ phone: "9876543210" }) });
    await expect(
      createWhatsAppLogRecord(hMismatch.db, "usr_owner", "usr_owner", {
        leadId: "lead_1",
        purpose: "followup",
        recipientPhone: "9811112233",
        messageText: "Hi",
        confirmedSent: true,
        confirmationStatus: "owner_confirmed_sent",
        composerSource: "CRM",
      }),
    ).rejects.toMatchObject({ status: 400, code: "validation_error" });

    const hBadPhone = createMockWhatsAppDb({ lead: makeMockLeadState({ phone: "12345" }) });
    await expect(
      createWhatsAppLogRecord(hBadPhone.db, "usr_owner", "usr_owner", {
        leadId: "lead_1",
        purpose: "followup",
        messageText: "Hi",
        confirmedSent: true,
        confirmationStatus: "owner_confirmed_sent",
        composerSource: "CRM",
      }),
    ).rejects.toMatchObject({ status: 400, code: "validation_error" });

    const hStale = createMockWhatsAppDb({ lead: makeMockLeadState({ version: 4 }) });
    await expect(
      createWhatsAppLogRecord(hStale.db, "usr_owner", "usr_owner", {
        leadId: "lead_1",
        purpose: "followup",
        messageText: "Hi",
        confirmedSent: true,
        confirmationStatus: "owner_confirmed_sent",
        composerSource: "CRM",
        expectedLeadVersion: 2,
      }),
    ).rejects.toMatchObject({
      status: 409,
      code: "stale_conflict",
      conflict: { expectedVersion: 2, currentVersion: 4 },
    });

    const hArchived = createMockWhatsAppDb({
      lead: makeMockLeadState({ lifecycleStatus: "waste" }),
    });
    await expect(
      createWhatsAppLogRecord(hArchived.db, "usr_owner", "usr_owner", {
        leadId: "lead_1",
        purpose: "followup",
        messageText: "Hi",
        confirmedSent: true,
        confirmationStatus: "owner_confirmed_sent",
        composerSource: "CRM",
      }),
    ).rejects.toMatchObject({ status: 409, code: "lead_archived" });

    const hDupOp = createMockWhatsAppDb({ lead: makeMockLeadState(), duplicateOpId: true });
    await expect(
      createWhatsAppLogRecord(hDupOp.db, "usr_owner", "usr_owner", {
        leadId: "lead_1",
        purpose: "followup",
        messageText: "Hi",
        confirmedSent: true,
        confirmationStatus: "owner_confirmed_sent",
        composerSource: "CRM",
        opId: "op_wa_1",
      }),
    ).rejects.toMatchObject({ status: 409, code: "whatsapp_op_conflict" });
  });
});
