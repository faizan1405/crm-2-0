import { describe, expect, it } from "vitest";
import {
  MigrationMapper,
  type LegacyDealRecord,
  type LegacyLeadRecord,
  type LegacyPaymentRecord,
  type LegacyProjectRecord,
  type LegacySalesGoalRecord,
} from "./backup/migrationMapping.server";

describe("B7A — Legacy Browser-to-MariaDB Migration Mapping", () => {
  const mapper = new MigrationMapper("usr_owner_target");

  it("maps legacy lead records cleanly with deterministic IDs and stage normalization", () => {
    const legacyLead: LegacyLeadRecord = {
      id: "lead_test_101",
      name: " Acme Corporation ",
      company: "Acme Holdings",
      phone: "+91 9876543210",
      email: "contact@acme.corp",
      status: "qualified",
      source: "google_ads",
      priority: "high",
      score: 85,
      createdAt: "2026-11-10T08:30:00Z",
    };

    const row = mapper.mapLead(legacyLead);

    expect(row.id).toBe("lead_test_101");
    expect(row.ownerUserId).toBe("usr_owner_target");
    expect(row.name).toBe("Acme Corporation");
    expect(row.company).toBe("Acme Holdings");
    expect(row.phone).toBe("+91 9876543210");
    expect(row.email).toBe("contact@acme.corp");
    expect(row.status).toBe("qualified");
    expect(row.source).toBe("google_ads");
    expect(row.priority).toBe("high");
    expect(row.score).toBe(85);
    expect(row.createdAt).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/);
  });

  it("maps legacy deal with exact integer paise conversion and wonAt UTC", () => {
    const legacyDeal: LegacyDealRecord = {
      id: "deal_202",
      leadId: "lead_test_101",
      name: "Enterprise ERP",
      value: "1,50,000.50", // ₹1,50,000.50 -> 15,000,050 paise
      status: "won",
      wonAt: "2026-11-10T12:00:00Z",
      createdAt: "2026-11-10T09:00:00Z",
    };

    const row = mapper.mapDeal(legacyDeal);

    expect(row.id).toBe("deal_202");
    expect(row.leadId).toBe("lead_test_101");
    expect(row.valuePaise).toBe(15000050);
    expect(row.valueDecimal).toBe("150000.50");
    expect(row.status).toBe("won");
    expect(row.wonAt).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/);
  });

  it("maps legacy payment preserving voided status, voidReason, and IST date", () => {
    const legacyPayment: LegacyPaymentRecord = {
      id: "pay_303",
      dealId: "deal_202",
      amount: "50,000.25", // ₹50,000.25 -> 5,000,025 paise
      method: "upi",
      reference: "UPI/1234567890",
      voided: true,
      voidReason: "Client check bounced",
      voidedAt: "2026-11-10T14:00:00Z",
      date: "2026-11-10",
      createdAt: "2026-11-10T10:00:00Z",
    };

    const row = mapper.mapPayment(legacyPayment);

    expect(row.id).toBe("pay_303");
    expect(row.dealId).toBe("deal_202");
    expect(row.amountPaise).toBe(5000025);
    expect(row.amountDecimal).toBe("50000.25");
    expect(row.method).toBe("upi");
    expect(row.status).toBe("voided");
    expect(row.voidReason).toBe("Client check bounced");
    expect(row.voidedAt).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/);
    expect(row.receivedIstDate).toBe("2026-11-10");
  });

  it("maps legacy projects and tasks with stage normalization", () => {
    const legacyProject: LegacyProjectRecord = {
      id: "proj_404",
      name: "Mobile App Development",
      leadId: "lead_test_101",
      dealId: "deal_202",
      stage: "in_progress",
      status: "in_progress",
      targetDate: "2026-12-31",
      createdAt: "2026-11-10T11:00:00Z",
    };

    const row = mapper.mapProject(legacyProject);

    expect(row.id).toBe("proj_404");
    expect(row.leadId).toBe("lead_test_101");
    expect(row.dealId).toBe("deal_202");
    expect(row.stage).toBe("in_progress");
    expect(row.status).toBe("in_progress");
    expect(row.targetIstDate).toBe("2026-12-31");
  });

  it("maps sales goals with exact paise or integer counts and IST calendar boundaries", () => {
    const moneyGoal: LegacySalesGoalRecord = {
      id: "goal_505",
      name: "Monthly Collections",
      metric: "cash_collected",
      period: "monthly",
      target: 2000000, // 20,000.00 -> 2,000,000 paise
      effectiveFrom: "2026-11-01",
      createdAt: "2026-11-01T00:00:00Z",
    };

    const row = mapper.mapSalesGoal(moneyGoal);

    expect(row.id).toBe("goal_505");
    expect(row.metric).toBe("cash_collected");
    expect(row.period).toBe("monthly");
    expect(row.targetAmountDecimal).toBe("20000.00");
    expect(row.targetCount).toBeNull();
    expect(row.effectiveFromIst).toBe("2026-11-01");

    const countGoal: LegacySalesGoalRecord = {
      id: "goal_506",
      name: "Weekly Connected Calls",
      metric: "calls_connected_count",
      period: "weekly",
      target: 50,
      effectiveFrom: "2026-11-03",
      createdAt: "2026-11-03T00:00:00Z",
    };

    const rowCount = mapper.mapSalesGoal(countGoal);
    expect(rowCount.id).toBe("goal_506");
    expect(rowCount.targetCount).toBe(50);
    expect(rowCount.targetAmountDecimal).toBeNull();
    expect(rowCount.effectiveFromIst).toBe("2026-11-03");
  });

  it("idempotently maps the same legacy ID to the same mapped ID repeatedly", () => {
    const idA1 = mapper.mapId("lead_legacy_abc");
    const idA2 = mapper.mapId("lead_legacy_abc");

    expect(idA1).toBe(idA2);
  });
});
