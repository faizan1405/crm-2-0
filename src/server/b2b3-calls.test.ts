import { getTableColumns } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  CALL_OUTCOMES as CLIENT_CALL_OUTCOMES,
  isConnectedOutcome,
  needsStageConfirm,
  outcomeStage,
  quickAfterCall,
} from "@/lib/crm/calllog";
import type { QuickStatus } from "@/lib/crm/leadtools";
import type { LeadStatus } from "@/lib/crm/types";
import { crmCallLogs, crmCoreSchema, crmIdempotencyKeys, crmLeads } from "./db/schema.server";
import { createCallLogRecord } from "./crm/callsService.server";
import { toCallLogDto, type CallLogRow } from "./crm/mappers.server";
import {
  CALL_OUTCOMES,
  createCallLogBodySchema,
  isConnectedCallOutcome,
  LEAD_STATUSES,
  listCallsQuerySchema,
  listLeadCallsQuerySchema,
  needsCallStageConfirmation,
  QUICK_STATUSES,
  resolveOutcomeStage,
  resolveQuickStatusAfterCall,
} from "./crm/validation.server";

function makeCallRow(overrides: Partial<CallLogRow> = {}): CallLogRow {
  return {
    id: "call_1",
    legacyId: null,
    ownerUserId: "usr_owner",
    leadId: "lead_1",
    actorUserId: "usr_owner",
    outcome: "Connected",
    connected: true,
    recordingSource: "user_recorded",
    notes: "Discussed scope",
    dialSource: "Lead detail",
    stageBefore: "new",
    stageAfter: "contacted",
    quickStatusBefore: "not_picked",
    quickStatusAfter: null,
    leadActivityId: "act_1",
    opId: "op_1",
    idempotencyKey: "idem_1",
    occurredAt: "2026-11-10 09:00:00.000",
    occurredIstDate: "2026-11-10",
    occurredIstTime: "14:30",
    createdAt: "2026-11-10 09:00:00.000",
    updatedAt: "2026-11-10 09:00:00.000",
    ...overrides,
  };
}

interface MockLeadState {
  id: string;
  legacyId: null;
  ownerUserId: string;
  createdByUserId: string;
  updatedByUserId: string;
  name: string;
  phoneRaw: string;
  phoneKey: string;
  emailRaw: string | null;
  emailNorm: string | null;
  company: string | null;
  requirement: string | null;
  source: string;
  status: LeadStatus;
  priority: "hot" | "warm" | "cold";
  aiScore: number | null;
  quotedAmountPaise: number | null;
  budgetPaise: number | null;
  notes: string | null;
  pinned: boolean;
  quickStatus: QuickStatus | null;
  lostReason: string | null;
  lifecycleStatus: "active" | "waste" | "deleted";
  archiveReason: string | null;
  archivedAt: string | null;
  lastContactAt: string | null;
  nextFollowUpAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

function makeMockLeadState(overrides: Partial<MockLeadState> = {}): MockLeadState {
  return {
    id: "lead_1",
    legacyId: null,
    ownerUserId: "usr_owner",
    createdByUserId: "usr_owner",
    updatedByUserId: "usr_owner",
    name: "Aarav Synthetic",
    phoneRaw: "9820001122",
    phoneKey: "9820001122",
    emailRaw: "aarav@synthetic.example",
    emailNorm: "aarav@synthetic.example",
    company: "Syntha",
    requirement: null,
    source: "Website",
    status: "new",
    priority: "hot",
    aiScore: null,
    quotedAmountPaise: null,
    budgetPaise: null,
    notes: null,
    pinned: false,
    quickStatus: null,
    lostReason: null,
    lifecycleStatus: "active",
    archiveReason: null,
    archivedAt: null,
    lastContactAt: null,
    nextFollowUpAt: null,
    version: 1,
    createdAt: "2026-11-09 09:00:00.000",
    updatedAt: "2026-11-09 09:00:00.000",
    ...overrides,
  };
}

function createMockCallDb(options: { lead?: MockLeadState; duplicateOpId?: boolean }) {
  let currentLead = options.lead ? { ...options.lead } : undefined;
  const insertedCalls: Record<string, unknown>[] = [];
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
                if (table === crmCallLogs) {
                  return options.duplicateOpId ? [makeCallRow()] : [];
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
    insert: () => ({
      values: async (vals: unknown) => {
        if (Array.isArray(vals)) {
          insertedActivities.push(...(vals as Record<string, unknown>[]));
        } else {
          insertedCalls.push(vals as Record<string, unknown>);
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
    insertedCalls,
    insertedActivities,
  };
}

describe("B2B3 Call Logging Domain Parity, Schemas & Mapper", () => {
  it("keeps server call schema and core registry cleanly registered", () => {
    expect(crmCoreSchema.crmCallLogs).toBe(crmCallLogs);
    const cols = getTableColumns(crmCallLogs);
    expect(Object.keys(cols)).toEqual(
      expect.arrayContaining([
        "id",
        "ownerUserId",
        "leadId",
        "actorUserId",
        "outcome",
        "connected",
        "recordingSource",
        "notes",
        "dialSource",
        "stageBefore",
        "stageAfter",
        "quickStatusBefore",
        "quickStatusAfter",
        "leadActivityId",
        "opId",
        "idempotencyKey",
        "occurredAt",
        "occurredIstDate",
        "occurredIstTime",
      ]),
    );
    expect(cols.recordingSource.default).toBe("user_recorded");
  });

  it("matches frontend src/lib/crm/calllog.ts pure rules across every outcome, stage, and quickStatus", () => {
    expect(CALL_OUTCOMES).toEqual(CLIENT_CALL_OUTCOMES);

    for (const outcome of CALL_OUTCOMES) {
      expect(isConnectedCallOutcome(outcome)).toBe(isConnectedOutcome(outcome));
      if (outcome === "Not picked" || outcome === "Busy") {
        expect(isConnectedCallOutcome(outcome)).toBe(false);
      } else {
        expect(isConnectedCallOutcome(outcome)).toBe(true);
      }

      for (const stage of LEAD_STATUSES) {
        expect(resolveOutcomeStage(outcome, stage)).toBe(outcomeStage(outcome, stage));
      }

      for (const qs of [null, ...QUICK_STATUSES] as const) {
        const srv = resolveQuickStatusAfterCall(outcome, qs);
        const cli = quickAfterCall(outcome, qs ?? undefined);
        expect(srv.set).toBe(cli.set);
        expect(srv.value).toBe(cli.value ?? null);
      }
    }

    for (const target of LEAD_STATUSES) {
      for (const current of LEAD_STATUSES) {
        expect(needsCallStageConfirmation(target, current)).toBe(
          needsStageConfirm(target, current),
        );
      }
    }
  });

  it("validates create and list call query schemas strictly", () => {
    const valid = createCallLogBodySchema.safeParse({
      leadId: "lead_1",
      outcome: "Connected",
      notes: "  Asked for proposal  ",
      dialSource: "  ",
    });
    expect(valid.success).toBe(true);
    if (valid.success) {
      expect(valid.data.dialSource).toBe("CRM");
      expect(valid.data.notes).toBe("Asked for proposal");
      expect(valid.data.confirmed).toBe(false);
    }

    expect(
      createCallLogBodySchema.safeParse({
        leadId: "lead_1",
        outcome: "Spoke magically",
      }).success,
    ).toBe(false);

    expect(
      createCallLogBodySchema.safeParse({
        leadId: "lead_1",
        outcome: "Connected",
        expectedLeadVersion: 0,
      }).success,
    ).toBe(false);

    expect(listCallsQuerySchema.safeParse({ dateIst: "2026-02-30" }).success).toBe(false);
    expect(
      listCallsQuerySchema.safeParse({
        dateIst: "2026-11-10",
        outcome: "Not picked",
        connected: "false",
        limit: "25",
      }).success,
    ).toBe(true);

    expect(listLeadCallsQuerySchema.safeParse({ connected: "all", limit: 201 }).success).toBe(
      false,
    );
  });

  it("maps CallLogRow to CallLogDto with user_recorded provenance and IST fields", () => {
    const dto = toCallLogDto(makeCallRow());
    expect(dto.recordingSource).toBe("user_recorded");
    expect(dto.connected).toBe(true);
    expect(dto.at).toBe("2026-11-10T09:00:00.000Z");
    expect(dto.atIst).toBe("2026-11-10T14:30:00+05:30");
    expect(dto.occurredIstDate).toBe("2026-11-10");
    expect(dto.occurredIstTime).toBe("14:30");
    expect(dto.quickStatusBefore).toBe("not_picked");
    expect(dto.quickStatusAfter).toBeUndefined();
  });
});

describe("B2B3 Calls Service Honesty, Conflict & Atomic Write Rules", () => {
  it("leaves lastContactAt unchanged for Not picked and Busy attempts and sets attempt activity text", async () => {
    const h = createMockCallDb({
      lead: makeMockLeadState({ status: "new", lastContactAt: null }),
    });

    const res = await createCallLogRecord(
      h.db,
      "usr_owner",
      "usr_owner",
      {
        leadId: "lead_1",
        outcome: "Not picked",
        notes: "Rang 4 times",
        confirmed: false,
        dialSource: "Lead detail",
        expectedLeadVersion: 1,
      },
      { now: new Date("2026-11-10T09:00:00.000Z") },
    );

    expect(res.status).toBe(201);
    expect(res.body.call.connected).toBe(false);
    expect(res.body.call.recordingSource).toBe("user_recorded");
    expect(res.body.call.stageBefore).toBe("new");
    expect(res.body.call.stageAfter).toBe("new");
    expect(res.body.call.quickStatusAfter).toBe("not_picked");
    expect(res.body.lead.lastContact).toBeUndefined();
    expect(res.body.lead.version).toBe(2);
    expect(res.body.activities).toHaveLength(1);
    expect(res.body.activities[0]!.type).toBe("call");
    expect(res.body.activities[0]!.text).toContain("Call attempt (Lead detail): Not picked");
    expect(h.getLeadState()?.lastContactAt).toBeNull();
  });

  it("updates lastContactAt, clears stale not_picked, advances new -> contacted, and writes call + status activities", async () => {
    const h = createMockCallDb({
      lead: makeMockLeadState({
        status: "new",
        quickStatus: "not_picked",
        lastContactAt: null,
      }),
    });

    const res = await createCallLogRecord(
      h.db,
      "usr_owner",
      "usr_owner",
      {
        leadId: "lead_1",
        outcome: "Connected",
        confirmed: false,
        dialSource: "Follow-ups",
        expectedLeadVersion: 1,
      },
      { now: new Date("2026-11-10T09:15:00.000Z") },
    );

    expect(res.body.call.connected).toBe(true);
    expect(res.body.call.stageBefore).toBe("new");
    expect(res.body.call.stageAfter).toBe("contacted");
    expect(res.body.call.quickStatusBefore).toBe("not_picked");
    expect(res.body.call.quickStatusAfter).toBeUndefined();
    expect(res.body.lead.status).toBe("contacted");
    expect(res.body.lead.quickStatus).toBeUndefined();
    expect(res.body.lead.lastContact).toBe("2026-11-10T09:15:00.000Z");
    expect(res.body.activities.map((a) => a.type)).toEqual(["call", "status"]);
  });

  it("rejects unconfirmed Won/Lost transitions, missing lostReason, stale version, archived lead, and opId collision", async () => {
    const h1 = createMockCallDb({ lead: makeMockLeadState({ status: "proposal" }) });
    await expect(
      createCallLogRecord(h1.db, "usr_owner", "usr_owner", {
        leadId: "lead_1",
        outcome: "Won",
        confirmed: false,
        dialSource: "CRM",
      }),
    ).rejects.toMatchObject({ status: 400, code: "validation_error" });

    const h2 = createMockCallDb({ lead: makeMockLeadState({ status: "proposal" }) });
    await expect(
      createCallLogRecord(h2.db, "usr_owner", "usr_owner", {
        leadId: "lead_1",
        outcome: "Lost",
        confirmed: true,
        dialSource: "CRM",
      }),
    ).rejects.toMatchObject({ status: 400, code: "validation_error" });

    const h3 = createMockCallDb({ lead: makeMockLeadState({ version: 3 }) });
    await expect(
      createCallLogRecord(h3.db, "usr_owner", "usr_owner", {
        leadId: "lead_1",
        outcome: "Interested",
        confirmed: false,
        dialSource: "CRM",
        expectedLeadVersion: 2,
      }),
    ).rejects.toMatchObject({
      status: 409,
      code: "stale_conflict",
      conflict: { expectedVersion: 2, currentVersion: 3 },
    });

    const h4 = createMockCallDb({ lead: makeMockLeadState({ lifecycleStatus: "waste" }) });
    await expect(
      createCallLogRecord(h4.db, "usr_owner", "usr_owner", {
        leadId: "lead_1",
        outcome: "Connected",
        confirmed: false,
        dialSource: "CRM",
      }),
    ).rejects.toMatchObject({ status: 409, code: "lead_archived" });

    const h5 = createMockCallDb({ lead: makeMockLeadState(), duplicateOpId: true });
    await expect(
      createCallLogRecord(h5.db, "usr_owner", "usr_owner", {
        leadId: "lead_1",
        outcome: "Connected",
        confirmed: false,
        dialSource: "CRM",
        opId: "op_1",
      }),
    ).rejects.toMatchObject({ status: 409, code: "call_op_conflict" });
  });
});
