import fs from "node:fs";
import path from "node:path";
import { getTableColumns, getTableName } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  dealCollected,
  dealOutstanding,
  dealPaymentStatus,
  financeSummary,
} from "@/lib/crm/finance";
import { DEAL_STATUS_LABEL, type Deal, type Payment } from "@/lib/crm/types";
import { parseServerEnv } from "./config/env.server";
import { verifyDealWonDateRecord } from "./crm/dealsService.server";
import {
  calculateDealFinancialSummary,
  calculateOwnerFinanceSummary,
  isDealOverdueInIst,
} from "./crm/financeCalc.server";
import {
  toDealDto,
  toFinanceEventDto,
  toPaymentDto,
  type DealMilestoneRow,
  type DealRow,
  type FinanceEventRow,
  type PaymentRow,
} from "./crm/mappers.server";
import {
  cancelDealBodySchema,
  createDealBodySchema,
  createPaymentBodySchema,
  createPaymentWithDealBodySchema,
  DEAL_STATUSES,
  financeSummaryQuerySchema,
  listDealAuditQuerySchema,
  listDealsQuerySchema,
  listPaymentsQuerySchema,
  MANUAL_ACTIVITY_TYPES,
  PAYMENT_METHODS,
  PAYMENT_TYPES,
  updateDealBodySchema,
  verifyDealWonDateBodySchema,
  voidPaymentBodySchema,
} from "./crm/validation.server";
import { closeDatabasePool } from "./db/index.server";
import {
  decimalStringToPaise,
  formatInrFromPaise,
  isValidInrAmount,
  MAX_DECIMAL_15_2_PAISE,
  paiseToColumnDecimalString,
  paiseToDecimalString,
  parseStrictInrInputToPaise,
  sumPaise,
} from "./db/money.server";
import {
  crmCoreSchema,
  crmDealMilestones,
  crmDeals,
  crmFinanceEvents,
  crmPayments,
} from "./db/schema.server";
import { handleCrmApiRequest } from "./http/crmRoutes.server";

describe("B3A Schema & Foreign-Key Deletion Safety", () => {
  it("registers crm_deals, crm_deal_milestones, crm_payments, and crm_finance_events in Drizzle schema", () => {
    expect(getTableName(crmDeals)).toBe("crm_deals");
    expect(getTableName(crmDealMilestones)).toBe("crm_deal_milestones");
    expect(getTableName(crmPayments)).toBe("crm_payments");
    expect(getTableName(crmFinanceEvents)).toBe("crm_finance_events");

    expect(crmCoreSchema.crmDeals).toBe(crmDeals);
    expect(crmCoreSchema.crmDealMilestones).toBe(crmDealMilestones);
    expect(crmCoreSchema.crmPayments).toBe(crmPayments);
    expect(crmCoreSchema.crmFinanceEvents).toBe(crmFinanceEvents);

    const dealCols = Object.keys(getTableColumns(crmDeals));
    expect(dealCols).toEqual(
      expect.arrayContaining([
        "id",
        "legacyId",
        "ownerUserId",
        "leadId",
        "clientType",
        "clientName",
        "quotedAmount",
        "finalAmount",
        "status",
        "dueDate",
        "wonAt",
        "wonIstDate",
        "cancelledAt",
        "cancelReason",
        "version",
      ]),
    );

    const payCols = Object.keys(getTableColumns(crmPayments));
    expect(payCols).toEqual(
      expect.arrayContaining([
        "id",
        "legacyId",
        "ownerUserId",
        "dealId",
        "amount",
        "paymentIstDate",
        "method",
        "paymentType",
        "status",
        "voided",
        "voidedAt",
        "voidedByUserId",
        "voidReason",
        "recordedByUserId",
        "version",
      ]),
    );
  });

  it("enforces ON DELETE RESTRICT across B3A financial tables and hardened Lead/Activity/Call/WhatsApp FKs", () => {
    const migrationSql = fs.readFileSync(
      path.resolve(process.cwd(), "src/server/db/migrations/0005_b3a_finance_ledger.sql"),
      "utf8",
    );
    expect(migrationSql).not.toMatch(/ON DELETE cascade/i);
    expect(migrationSql).toContain(
      "FOREIGN KEY (`lead_id`) REFERENCES `crm_leads`(`id`) ON DELETE restrict",
    );
    expect(migrationSql).toContain(
      "FOREIGN KEY (`deal_id`) REFERENCES `crm_deals`(`id`) ON DELETE restrict",
    );
    expect(migrationSql).toContain(
      "FOREIGN KEY (`payment_id`) REFERENCES `crm_payments`(`id`) ON DELETE restrict",
    );
    expect(migrationSql).toContain(
      "ALTER TABLE `crm_lead_activities` ADD CONSTRAINT `crm_lead_activities_lead_id_crm_leads_id_fk` FOREIGN KEY (`lead_id`) REFERENCES `crm_leads`(`id`) ON DELETE restrict",
    );
    expect(migrationSql).toContain(
      "ALTER TABLE `crm_whatsapp_logs` ADD CONSTRAINT `crm_whatsapp_logs_lead_id_crm_leads_id_fk` FOREIGN KEY (`lead_id`) REFERENCES `crm_leads`(`id`) ON DELETE restrict",
    );
  });
});

describe("B3A Exact-Money Arithmetic & Input Precision", () => {
  it("parses rupees and paise deterministically without binary floating-point multiplication", () => {
    expect(MAX_DECIMAL_15_2_PAISE).toBe(999_999_999_999_999);

    const a = parseStrictInrInputToPaise(10_000.1);
    const b = parseStrictInrInputToPaise("20000.20");
    expect(a).toEqual({ ok: true, paise: 1_000_010, decimal: "10000.10", rupees: 10_000.1 });
    expect(b).toEqual({ ok: true, paise: 2_000_020, decimal: "20000.20", rupees: 20_000.2 });

    if (!a.ok || !b.ok) throw new Error("Expected valid money parses");
    const combined = sumPaise([a.paise, b.paise]);
    expect(combined).toBe(3_000_030);
    expect(paiseToDecimalString(combined)).toBe("30000.30");

    // 0.1 + 0.2 in JS produces 0.30000000000000004 -> rejected if passed unrounded from buggy client math
    const driftedFloat = 0.1 + 0.2;
    expect(parseStrictInrInputToPaise(driftedFloat).ok).toBe(false);

    // Max 13-integer-digit DECIMAL(15, 2) value works; 14 integer digits rejected
    const maxCol = parseStrictInrInputToPaise("9999999999999.99");
    expect(maxCol).toEqual({
      ok: true,
      paise: 999_999_999_999_999,
      decimal: "9999999999999.99",
      rupees: 9_999_999_999_999.99,
    });
    expect(paiseToColumnDecimalString(999_999_999_999_999)).toBe("9999999999999.99");
    expect(parseStrictInrInputToPaise("10000000000000.00").ok).toBe(false);
    expect(isValidInrAmount(50_000_000_000_000)).toBe(false);
  });

  it("rejects zero (when disallowed), negative, >2 decimals, scientific notation, and non-numeric values", () => {
    expect(parseStrictInrInputToPaise(0, { allowZero: false }).ok).toBe(false);
    expect(parseStrictInrInputToPaise(0, { allowZero: true })).toEqual({
      ok: true,
      paise: 0,
      decimal: "0.00",
      rupees: 0,
    });
    expect(parseStrictInrInputToPaise(-0.01, { allowZero: true }).ok).toBe(false);
    expect(parseStrictInrInputToPaise("-100.00", { allowZero: true }).ok).toBe(false);
    expect(parseStrictInrInputToPaise(10.999).ok).toBe(false);
    expect(parseStrictInrInputToPaise("10.999").ok).toBe(false);
    expect(parseStrictInrInputToPaise("1e5").ok).toBe(false);
    expect(parseStrictInrInputToPaise(Number.NaN).ok).toBe(false);
    expect(parseStrictInrInputToPaise(Number.POSITIVE_INFINITY).ok).toBe(false);
    expect(parseStrictInrInputToPaise("").ok).toBe(false);
    expect(parseStrictInrInputToPaise(null).ok).toBe(false);
    expect(parseStrictInrInputToPaise(true).ok).toBe(false);
  });

  it("formats Indian currency from integer paise locale-independently", () => {
    expect(formatInrFromPaise(0)).toBe("₹0");
    expect(formatInrFromPaise(400_000)).toBe("₹4,000");
    expect(formatInrFromPaise(12_500_000)).toBe("₹1,25,000");
    expect(formatInrFromPaise(1_000_000_000)).toBe("₹1,00,00,000");
    expect(formatInrFromPaise(400_050)).toBe("₹4,000.50");
    expect(formatInrFromPaise(99)).toBe("₹0.99");
  });
});

describe("B3A Zod Contracts & Server-Authority Balance Protection", () => {
  it("aligns Deal statuses, payment methods, and payment types with frontend contracts", () => {
    expect([...DEAL_STATUSES].sort()).toEqual(Object.keys(DEAL_STATUS_LABEL).sort());
    expect(PAYMENT_METHODS).toEqual(["UPI", "Bank Transfer", "Cash", "Card", "Cheque"]);
    expect(PAYMENT_TYPES).toEqual(["advance", "milestone", "final", "other"]);
    // Manual Lead activity endpoint still blocks forged 'payment' entries
    expect(MANUAL_ACTIVITY_TYPES).not.toContain("payment");
  });

  it("validates Deal creation and strictly rejects client-supplied calculated balances or actor IDs", () => {
    const validCrm = createDealBodySchema.parse({
      clientType: "crm",
      leadId: "lead_123",
      name: "3D Product Website",
      quotedAmount: 150_000,
      finalAmount: 125_000.5,
      dueDate: "2026-11-30",
      milestones: [
        { label: "Advance", amount: 50_000, dueDate: "2026-11-10" },
        { label: "Launch", amount: "75000.50", dueDate: "2026-11-30" },
      ],
    });
    expect(validCrm.quotedAmount).toBe("150000.00");
    expect(validCrm.finalAmount).toBe("125000.50");
    expect(validCrm.milestones).toHaveLength(2);

    // Reject clientType='crm' without leadId & clientType='other' with leadId
    expect(
      createDealBodySchema.safeParse({
        clientType: "crm",
        name: "Site",
        finalAmount: 10_000,
      }).success,
    ).toBe(false);
    expect(
      createDealBodySchema.safeParse({
        clientType: "other",
        leadId: "lead_1",
        clientName: "Direct Co",
        name: "Site",
        finalAmount: 10_000,
      }).success,
    ).toBe(false);

    // Reject milestones exceeding finalAmount
    expect(
      createDealBodySchema.safeParse({
        clientType: "other",
        clientName: "Direct Co",
        name: "Site",
        finalAmount: 40_000,
        milestones: [
          { label: "M1", amount: 25_000, dueDate: "2026-11-10" },
          { label: "M2", amount: 20_000, dueDate: "2026-11-20" },
        ],
      }).success,
    ).toBe(false);

    // Reject client attempting to supply authoritative balances or actorUserId
    for (const injected of [
      { collected: 40_000 },
      { outstanding: 0 },
      { paymentStatus: "paid" },
      { actorUserId: "usr_spoofed" },
      { ownerUserId: "usr_spoofed" },
    ]) {
      expect(
        createDealBodySchema.safeParse({
          clientType: "other",
          clientName: "Direct Co",
          name: "Tampered Deal",
          finalAmount: 40_000,
          ...injected,
        }).success,
      ).toBe(false);
    }

    // Reject creating a brand-new deal directly as cancelled or with finalAmount <= 0
    expect(
      createDealBodySchema.safeParse({
        clientType: "other",
        clientName: "Direct Co",
        name: "Zero Deal",
        finalAmount: 0,
      }).success,
    ).toBe(false);
    expect(
      createDealBodySchema.safeParse({
        clientType: "other",
        clientName: "Direct Co",
        name: "Cancelled Deal",
        finalAmount: 10_000,
        status: "cancelled",
      }).success,
    ).toBe(false);
  });

  it("enforces mandatory explicit void reason and strict payment schemas", () => {
    expect(voidPaymentBodySchema.safeParse({}).success).toBe(false);
    expect(voidPaymentBodySchema.safeParse({ reason: "   " }).success).toBe(false);
    expect(voidPaymentBodySchema.parse({ reason: "  Duplicate UTR entry  " }).reason).toBe(
      "Duplicate UTR entry",
    );

    expect(
      createPaymentBodySchema.safeParse({
        amount: 0,
        method: "UPI",
      }).success,
    ).toBe(false);
    expect(
      createPaymentBodySchema.safeParse({
        amount: -500,
        method: "UPI",
      }).success,
    ).toBe(false);
    expect(
      createPaymentBodySchema.safeParse({
        amount: 5000,
        method: "UPI",
        voided: true,
      }).success,
    ).toBe(false);

    const validWithDeal = createPaymentWithDealBodySchema.parse({
      dealId: "deal_1",
      amount: "14999.99",
      date: "2026-11-09",
      method: "Bank Transfer",
      type: "advance",
      reference: "UTR998877",
    });
    expect(validWithDeal.amount).toBe("14999.99");

    expect(updateDealBodySchema.safeParse({ version: 1 }).success).toBe(false);
    expect(cancelDealBodySchema.parse({ version: 2, reason: "Scope dropped" }).version).toBe(2);
    expect(
      verifyDealWonDateBodySchema.safeParse({ version: 1, wonDate: "1999-12-31" }).success,
    ).toBe(false);
    expect(
      financeSummaryQuerySchema.safeParse({ from: "2026-11-20", to: "2026-11-01" }).success,
    ).toBe(false);
  });
});

describe("B3A Pure Financial Ledger Calculations & Parity with finance.ts", () => {
  it("matches frontend dealCollected, dealOutstanding, dealPaymentStatus, and financeSummary while handling voided & cancelled exclusions", () => {
    const clientDeals: Deal[] = [
      {
        id: "d_partial_overdue",
        clientType: "crm",
        leadId: "l_1",
        clientName: "Asha",
        name: "Site A",
        quotedAmount: 50_000,
        finalAmount: 40_000,
        status: "active",
        dueDate: "2026-11-01",
        milestones: [],
        createdAt: "2026-10-10T06:00:00Z",
        wonAt: "2026-10-10T06:00:00Z",
      },
      {
        id: "d_paid",
        clientType: "other",
        clientName: "Rohan",
        name: "Site B",
        quotedAmount: 30_000,
        finalAmount: 30_000,
        status: "completed",
        dueDate: "2026-11-05",
        milestones: [],
        createdAt: "2026-11-01T06:00:00Z",
        wonAt: "2026-11-01T06:00:00Z",
      },
      {
        id: "d_unpaid_nodue",
        clientType: "other",
        clientName: "Legacy Co",
        name: "Site C",
        quotedAmount: 25_000,
        finalAmount: 25_000,
        status: "active",
        milestones: [],
        createdAt: "2026-09-01T06:00:00Z",
      },
      {
        id: "d_cancelled",
        clientType: "crm",
        leadId: "l_2",
        clientName: "Dropped Client",
        name: "Site D",
        quotedAmount: 60_000,
        finalAmount: 60_000,
        status: "cancelled",
        dueDate: "2026-10-15",
        milestones: [],
        createdAt: "2026-10-01T06:00:00Z",
        wonAt: "2026-10-01T06:00:00Z",
      },
    ];

    const clientPayments: Payment[] = [
      {
        id: "p1",
        dealId: "d_partial_overdue",
        amount: 4_000,
        date: "2026-11-02",
        method: "UPI",
        type: "advance",
      },
      {
        id: "p2",
        dealId: "d_partial_overdue",
        amount: 16_000,
        date: "2026-11-03",
        method: "Bank Transfer",
        type: "milestone",
      },
      {
        id: "p3_void",
        dealId: "d_partial_overdue",
        amount: 5_000,
        date: "2026-11-04",
        method: "UPI",
        type: "milestone",
        voided: true,
      },
      {
        id: "p4",
        dealId: "d_paid",
        amount: 30_000,
        date: "2026-11-05",
        method: "Card",
        type: "final",
      },
      {
        id: "p5_on_cancelled",
        dealId: "d_cancelled",
        amount: 10_000,
        date: "2026-10-02",
        method: "UPI",
        type: "advance",
      },
    ];

    const now = new Date("2026-11-09T12:00:00Z");
    const todayIst = "2026-11-09";
    const expectedSummary = financeSummary(clientDeals, clientPayments, now);

    const serverDeals = clientDeals.map((d) => ({
      id: d.id,
      quotedAmount: `${d.quotedAmount}.00`,
      finalAmount: `${d.finalAmount}.00`,
      status: d.status,
      dueDate: d.dueDate ?? null,
      wonIstDate: d.wonAt ? d.wonAt.slice(0, 10) : null,
    }));
    const serverPayments = clientPayments.map((p) => ({
      id: p.id,
      dealId: p.dealId,
      amount: `${p.amount}.00`,
      paymentIstDate: p.date,
      voided: Boolean(p.voided),
    }));

    for (const d of clientDeals) {
      const srvDeal = serverDeals.find((sd) => sd.id === d.id)!;
      const srvPays = serverPayments.filter((sp) => sp.dealId === d.id);
      const srv = calculateDealFinancialSummary(srvDeal, srvPays, [], todayIst);

      expect(srv.collected).toBe(dealCollected(d.id, clientPayments));
      expect(srv.outstanding).toBe(dealOutstanding(d, clientPayments));
      expect(srv.paymentStatus).toBe(dealPaymentStatus(d, clientPayments, now));
    }

    const ownerSummary = calculateOwnerFinanceSummary({
      deals: serverDeals,
      payments: serverPayments,
      todayIstDate: todayIst,
      periodFrom: "2026-11-01",
      periodTo: "2026-11-30",
    });

    expect(ownerSummary.totals.totalValue).toBe(expectedSummary.totalValue); // 40k + 30k + 25k = 95k
    expect(ownerSummary.totals.collected).toBe(expectedSummary.collected); // 20k + 30k = 50k (excludes voided 5k & cancelled 10k)
    expect(ownerSummary.totals.outstanding).toBe(expectedSummary.outstanding); // 20k + 0 + 25k = 45k
    expect(ownerSummary.totals.overdue).toBe(expectedSummary.overdue); // 20k (Site C has no dueDate -> never overdue)
    expect(ownerSummary.exclusions.voidedAmount).toBe(5_000);
    expect(ownerSummary.exclusions.cancelledDealCount).toBe(1);
    expect(ownerSummary.exclusions.cancelledDealPaymentsExcluded).toBe(10_000);

    // Period November KPIs: only d_paid was won in Nov (30k); d_unpaid_nodue has unknown wonIstDate (25k, NOT placed in Nov)
    expect(ownerSummary.period.wonValue).toBe(30_000);
    expect(ownerSummary.period.received).toBe(50_000);
    expect(ownerSummary.period.unknownWonCount).toBe(1);
    expect(ownerSummary.period.unknownWonValue).toBe(25_000);
  });

  it("enforces exact Asia/Kolkata IST day boundaries for overdue detection and nextMilestone progression", () => {
    // Due on 2026-11-09: NOT overdue anywhere on 2026-11-09 IST (even at 23:59 IST)
    expect(
      isDealOverdueInIst({
        status: "active",
        dueDate: "2026-11-09",
        outstandingAmountPaise: 100_000,
        todayIstDate: "2026-11-09",
      }),
    ).toBe(false);

    // At 2026-11-10 IST (00:00+05:30): becomes overdue
    expect(
      isDealOverdueInIst({
        status: "active",
        dueDate: "2026-11-09",
        outstandingAmountPaise: 100_000,
        todayIstDate: "2026-11-10",
      }),
    ).toBe(true);

    // Missing dueDate or paid-in-full or cancelled: NEVER overdue
    expect(
      isDealOverdueInIst({
        status: "active",
        dueDate: null,
        outstandingAmountPaise: 100_000,
        todayIstDate: "2029-01-01",
      }),
    ).toBe(false);
    expect(
      isDealOverdueInIst({
        status: "active",
        dueDate: "2020-01-01",
        outstandingAmountPaise: 0,
        todayIstDate: "2026-11-09",
      }),
    ).toBe(false);

    const summaryWithMs = calculateDealFinancialSummary(
      {
        id: "d_ms",
        quotedAmount: "1000.00",
        finalAmount: "1000.00",
        status: "active",
        dueDate: "2026-12-01",
        wonIstDate: "2026-11-09",
      },
      [
        {
          id: "p_adv",
          dealId: "d_ms",
          amount: "400.00",
          paymentIstDate: "2026-11-09",
          voided: false,
        },
      ],
      [
        { id: "m1", label: "Advance", amount: "400.00", dueDate: "2026-11-09", sortOrder: 0 },
        {
          id: "m2",
          label: "Design sign-off",
          amount: "350.00",
          dueDate: "2026-11-20",
          sortOrder: 1,
        },
        { id: "m3", label: "Launch", amount: "250.00", dueDate: "2026-12-01", sortOrder: 2 },
      ],
      "2026-11-09",
    );
    expect(summaryWithMs.nextMilestone?.id).toBe("m2");
    expect(summaryWithMs.nextMilestone?.amountDecimal).toBe("350.00");
  });

  it("maps Deal, Payment, and FinanceEvent rows cleanly to DTOs", () => {
    const dealRow: DealRow = {
      id: "deal_1",
      legacyId: "deal_legacy_1",
      ownerUserId: "usr_owner",
      leadId: "lead_1",
      clientType: "crm",
      clientName: "Asha",
      company: "Mehta Interiors",
      phone: "9876543210",
      name: "Website",
      quotedAmount: "45000.00",
      finalAmount: "40000.00",
      status: "active",
      dueDate: "2026-11-30",
      wonAt: "2026-11-09 06:30:00.000",
      wonIstDate: "2026-11-09",
      wonDateVerifiedAt: null,
      wonDateVerifiedByUserId: null,
      cancelledAt: null,
      cancelledIstDate: null,
      cancelledByUserId: null,
      cancelReason: null,
      notes: "Priority launch",
      opId: "op_1",
      idempotencyKey: "idem_1",
      createdByUserId: "usr_owner",
      updatedByUserId: "usr_owner",
      version: 2,
      createdAt: "2026-11-09 06:30:00.000",
      updatedAt: "2026-11-09 07:00:00.000",
    };
    const msRow: DealMilestoneRow = {
      id: "ms_1",
      legacyId: null,
      ownerUserId: "usr_owner",
      dealId: "deal_1",
      label: "Advance",
      amount: "20000.00",
      dueDate: "2026-11-10",
      sortOrder: 0,
      createdAt: "2026-11-09 06:30:00.000",
      updatedAt: "2026-11-09 06:30:00.000",
    };
    const payRow: PaymentRow = {
      id: "pay_1",
      legacyId: null,
      ownerUserId: "usr_owner",
      dealId: "deal_1",
      amount: "15000.25",
      paymentIstDate: "2026-11-09",
      method: "UPI",
      paymentType: "advance",
      reference: "UTR123",
      notes: null,
      status: "posted",
      voided: false,
      voidedAt: null,
      voidedIstDate: null,
      voidedByUserId: null,
      voidReason: null,
      opId: null,
      idempotencyKey: null,
      recordedByUserId: "usr_owner",
      updatedByUserId: "usr_owner",
      version: 1,
      createdAt: "2026-11-09 07:00:00.000",
      updatedAt: "2026-11-09 07:00:00.000",
    };

    const summary = calculateDealFinancialSummary(
      {
        id: dealRow.id,
        quotedAmount: dealRow.quotedAmount,
        finalAmount: dealRow.finalAmount,
        status: "active",
        dueDate: dealRow.dueDate,
        wonIstDate: dealRow.wonIstDate,
      },
      [payRow],
      [msRow],
      "2026-11-09",
    );
    const dealDto = toDealDto(dealRow, [msRow], summary);
    expect(dealDto.quotedAmountPaise).toBe(4_500_000);
    expect(dealDto.finalAmountPaise).toBe(4_000_000);
    expect(dealDto.financialSummary.collectedDecimal).toBe("15000.25");
    expect(dealDto.financialSummary.outstandingDecimal).toBe("24999.75");

    const payDto = toPaymentDto(payRow);
    expect(payDto.amountPaise).toBe(decimalStringToPaise("15000.25"));
    expect(payDto.voided).toBe(false);

    const evRow: FinanceEventRow = {
      id: "fin_1",
      ownerUserId: "usr_owner",
      dealId: "deal_1",
      paymentId: "pay_1",
      leadId: "lead_1",
      actorUserId: "usr_owner",
      eventType: "payment.recorded",
      summary: "Payment of ₹15,000.25 recorded",
      reason: null,
      amountSnapshot: "15000.25",
      beforeJson: JSON.stringify({ collected: "0.00" }),
      afterJson: JSON.stringify({ collected: "15000.25" }),
      leadActivityId: "act_1",
      opId: null,
      occurredAt: "2026-11-09 07:00:00.000",
      occurredIstDate: "2026-11-09",
      createdAt: "2026-11-09 07:00:00.000",
    };
    const evDto = toFinanceEventDto(evRow);
    expect(evDto.amountDecimal).toBe("15000.25");
    expect(evDto.after).toEqual({ collected: "15000.25" });
  });
});

describe("B3A HTTP Route Security Gates (CSRF, Method Allow, Unauthenticated)", () => {
  const configuredEnv = parseServerEnv({
    NODE_ENV: "test",
    AUTH_SECRET: "synthetic-b3a-unit-secret-at-least-32-chars",
    DB_HOST: "127.0.0.1",
    DB_PORT: "3306",
    DB_NAME: "crm_unit_unused",
    DB_USER: "crm_unit_user",
    DB_PASSWORD: "crm_unit_password",
  });

  it("enforces 405 Allow headers and Cache-Control: no-store on Deal, Payment, and Finance endpoints", async () => {
    const badDealMethod = await handleCrmApiRequest(
      new Request("http://127.0.0.1:3000/api/v1/deals", { method: "DELETE" }),
      "/api/v1/deals",
      configuredEnv,
    );
    expect(badDealMethod?.status).toBe(405);
    expect(badDealMethod?.headers.get("allow")).toBe("GET, POST");
    expect(badDealMethod?.headers.get("cache-control")).toBe("no-store");

    const badPayIdMethod = await handleCrmApiRequest(
      new Request("http://127.0.0.1:3000/api/v1/payments/pay_1", { method: "DELETE" }),
      "/api/v1/payments/pay_1",
      configuredEnv,
    );
    expect(badPayIdMethod?.status).toBe(405);
    expect(badPayIdMethod?.headers.get("allow")).toBe("GET");

    const badVoidMethod = await handleCrmApiRequest(
      new Request("http://127.0.0.1:3000/api/v1/payments/pay_1/void", { method: "GET" }),
      "/api/v1/payments/pay_1/void",
      configuredEnv,
    );
    expect(badVoidMethod?.status).toBe(405);
    expect(badVoidMethod?.headers.get("allow")).toBe("POST");

    const badSummaryMethod = await handleCrmApiRequest(
      new Request("http://127.0.0.1:3000/api/v1/finance/summary", { method: "POST" }),
      "/api/v1/finance/summary",
      configuredEnv,
    );
    expect(badSummaryMethod?.status).toBe(405);
    expect(badSummaryMethod?.headers.get("allow")).toBe("GET");
  });

  it("rejects cross-origin POST/PATCH mutations with 403 before touching the database", async () => {
    for (const [method, pathname] of [
      ["POST", "/api/v1/deals"],
      ["PATCH", "/api/v1/deals/deal_1"],
      ["POST", "/api/v1/deals/deal_1/cancel"],
      ["POST", "/api/v1/deals/deal_1/payments"],
      ["POST", "/api/v1/payments"],
      ["POST", "/api/v1/payments/pay_1/void"],
    ] as const) {
      const res = await handleCrmApiRequest(
        new Request(`http://127.0.0.1:3000${pathname}`, {
          method,
          headers: {
            "content-type": "application/json",
            origin: "https://evil-attacker.example",
          },
          body: JSON.stringify({}),
        }),
        pathname,
        configuredEnv,
      );
      expect(res?.status).toBe(403);
    }
  });

  it("fails closed with 503 when DB is unconfigured and rejects unauthenticated requests with 401 when DB is configured", async () => {
    const prevDbUrl = process.env["DATABASE_URL"];
    const prevDbHost = process.env["DB_HOST"];
    const prevDbName = process.env["DB_NAME"];
    const prevDbUser = process.env["DB_USER"];
    const prevDbPass = process.env["DB_PASSWORD"];

    try {
      delete process.env["DATABASE_URL"];
      delete process.env["DB_HOST"];
      delete process.env["DB_NAME"];
      delete process.env["DB_USER"];
      delete process.env["DB_PASSWORD"];
      await closeDatabasePool();

      const unconfiguredRes = await handleCrmApiRequest(
        new Request("http://127.0.0.1:3000/api/v1/deals"),
        "/api/v1/deals",
        configuredEnv,
      );
      expect(unconfiguredRes?.status).toBe(503);

      process.env["DATABASE_URL"] = "mysql://unit_user:unit_pass@127.0.0.1:3399/crm_unit_unused";
      await closeDatabasePool();

      const getDeals = await handleCrmApiRequest(
        new Request("http://127.0.0.1:3000/api/v1/deals"),
        "/api/v1/deals",
        configuredEnv,
      );
      expect(getDeals?.status).toBe(401);

      const getSummary = await handleCrmApiRequest(
        new Request("http://127.0.0.1:3000/api/v1/finance/summary"),
        "/api/v1/finance/summary",
        configuredEnv,
      );
      expect(getSummary?.status).toBe(401);

      const postPayment = await handleCrmApiRequest(
        new Request("http://127.0.0.1:3000/api/v1/deals/deal_1/payments", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: "http://127.0.0.1:3000",
          },
          body: JSON.stringify({ amount: 1000, method: "UPI" }),
        }),
        "/api/v1/deals/deal_1/payments",
        configuredEnv,
      );
      expect(postPayment?.status).toBe(401);
    } finally {
      await closeDatabasePool();
      if (prevDbUrl === undefined) delete process.env["DATABASE_URL"];
      else process.env["DATABASE_URL"] = prevDbUrl;
      if (prevDbHost === undefined) delete process.env["DB_HOST"];
      else process.env["DB_HOST"] = prevDbHost;
      if (prevDbName === undefined) delete process.env["DB_NAME"];
      else process.env["DB_NAME"] = prevDbName;
      if (prevDbUser === undefined) delete process.env["DB_USER"];
      else process.env["DB_USER"] = prevDbUser;
      if (prevDbPass === undefined) delete process.env["DB_PASSWORD"];
      else process.env["DB_PASSWORD"] = prevDbPass;
    }
  });

  it("handles fractional paise across multi-payment summaries without IEEE-754 float drift", () => {
    const summary = calculateOwnerFinanceSummary({
      deals: [
        {
          id: "d_paise",
          quotedAmount: "30001.00",
          finalAmount: "30001.00",
          status: "active",
          dueDate: "2026-11-20",
          wonIstDate: "2026-11-09",
        },
      ],
      payments: [
        {
          id: "p_1",
          dealId: "d_paise",
          amount: "10000.10",
          paymentIstDate: "2026-11-09",
          voided: false,
        },
        {
          id: "p_2",
          dealId: "d_paise",
          amount: "20000.20",
          paymentIstDate: "2026-11-09",
          voided: false,
        },
      ],
      todayIstDate: "2026-11-09",
    });

    expect(summary.totals.collectedDecimal).toBe("30000.30");
    expect(summary.totals.collectedPaise).toBe(3_000_030);
    expect(summary.totals.outstandingDecimal).toBe("0.70");
    expect(summary.totals.outstandingPaise).toBe(70);
  });

  it("validates list query schemas and rejects future verified wonDate before touching DB", async () => {
    const dealQuery = listDealsQuerySchema.parse({});
    expect(dealQuery).toMatchObject({
      status: "all",
      paymentStatus: "all",
      clientType: "all",
      sort: "recent",
      limit: 50,
      offset: 0,
    });
    expect(listDealsQuerySchema.safeParse({ limit: "999" }).success).toBe(false);

    const payQuery = listPaymentsQuerySchema.parse({ includeVoided: "false" });
    expect(payQuery.includeVoided).toBe(false);

    const auditQuery = listDealAuditQuerySchema.parse({ eventType: "payment.voided" });
    expect(auditQuery.eventType).toBe("payment.voided");

    await expect(
      verifyDealWonDateRecord(
        {} as never,
        "usr_owner",
        "usr_owner",
        "deal_1",
        { version: 1, wonDate: "2026-11-15" },
        { now: new Date("2026-11-09T10:00:00Z") },
      ),
    ).rejects.toMatchObject({
      status: 400,
      code: "validation_error",
    });
  });
});
