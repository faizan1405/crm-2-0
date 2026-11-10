import { describe, expect, it } from "vitest";
import { parseServerEnv } from "./config/env.server";
import { handleCrmApiRequest } from "./http/crmRoutes.server";
import {
  dashboardOverviewResponseSchema,
  funnelAnalyticsResponseSchema,
  communicationsAnalyticsResponseSchema,
  financeAnalyticsResponseSchema,
  quotationsAnalyticsResponseSchema,
  projectsAnalyticsResponseSchema,
  performanceAnalyticsResponseSchema,
  trendsAnalyticsResponseSchema,
} from "../lib/api/schemas";

describe("Checkpoint B5C — Server-Side Analytics & Reporting HTTP Router", () => {
  const dummyEnv = parseServerEnv({
    NODE_ENV: "test",
    APP_ORIGIN: "http://127.0.0.1:3000",
  });

  const configuredEnv = parseServerEnv({
    NODE_ENV: "test",
    APP_ORIGIN: "http://127.0.0.1:3000",
    DATABASE_URL: "mysql://test:test@127.0.0.1:3306/dummy_test_db",
  });

  const ANALYTICS_SUB_PATHS = [
    "dashboard",
    "funnel",
    "communications",
    "finance",
    "quotations",
    "projects",
    "performance",
    "trends",
  ];

  describe("1. HTTP Route Matching & Method Gating", () => {
    it.each(ANALYTICS_SUB_PATHS)(
      "matches /api/v1/analytics/%s and rejects unauthenticated GET with 401 when DB configured",
      async (sub) => {
        const prevDb = process.env["DATABASE_URL"];
        process.env["DATABASE_URL"] = "mysql://test:test@127.0.0.1:3306/dummy_test_db";
        try {
          const req = new Request(`http://127.0.0.1:3000/api/v1/analytics/${sub}`);
          const res = await handleCrmApiRequest(req, `/api/v1/analytics/${sub}`, configuredEnv);

          expect(res).not.toBeNull();
          expect(res!.status).toBe(401);
          expect(res!.headers.get("cache-control")).toBe("no-store");
          expect(res!.headers.get("content-type")).toContain("application/json");

          const data = await res!.json();
          expect(data.ok).toBe(false);
          expect(data.error.code).toBe("unauthenticated");
        } finally {
          if (prevDb === undefined) delete process.env["DATABASE_URL"];
          else process.env["DATABASE_URL"] = prevDb;
        }
      },
    );

    it.each(ANALYTICS_SUB_PATHS)(
      "matches /api/v1/analytics/%s and fails closed with 503 when DB unconfigured",
      async (sub) => {
        const req = new Request(`http://127.0.0.1:3000/api/v1/analytics/${sub}`);
        const res = await handleCrmApiRequest(req, `/api/v1/analytics/${sub}`, dummyEnv);

        expect(res).not.toBeNull();
        expect(res!.status).toBe(503);
        expect(res!.headers.get("cache-control")).toBe("no-store");
      },
    );

    it.each(ANALYTICS_SUB_PATHS)(
      "rejects POST requests to /api/v1/analytics/%s with 405 Method Not Allowed",
      async (sub) => {
        const req = new Request(`http://127.0.0.1:3000/api/v1/analytics/${sub}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({}),
        });
        const res = await handleCrmApiRequest(req, `/api/v1/analytics/${sub}`, dummyEnv);

        expect(res).not.toBeNull();
        expect(res!.status).toBe(405);
        expect(res!.headers.get("allow")).toBe("GET");

        const data = await res!.json();
        expect(data.ok).toBe(false);
        expect(data.error.code).toBe("method_not_allowed");
      },
    );

    it.each(ANALYTICS_SUB_PATHS)(
      "rejects PUT, DELETE, PATCH requests to /api/v1/analytics/%s with 405",
      async (sub) => {
        for (const method of ["PUT", "DELETE", "PATCH"]) {
          const req = new Request(`http://127.0.0.1:3000/api/v1/analytics/${sub}`, {
            method,
          });
          const res = await handleCrmApiRequest(req, `/api/v1/analytics/${sub}`, dummyEnv);

          expect(res).not.toBeNull();
          expect(res!.status).toBe(405);
          expect(res!.headers.get("allow")).toBe("GET");
        }
      },
    );

    it("returns null for unknown analytics sub-resource", async () => {
      const req = new Request("http://127.0.0.1:3000/api/v1/analytics/nonexistent");
      const res = await handleCrmApiRequest(req, "/api/v1/analytics/nonexistent", dummyEnv);
      expect(res).toBeNull();
    });

    it("returns null for nested sub-routes exceeding segment length 4", async () => {
      const req = new Request("http://127.0.0.1:3000/api/v1/analytics/dashboard/extra");
      const res = await handleCrmApiRequest(req, "/api/v1/analytics/dashboard/extra", dummyEnv);
      expect(res).toBeNull();
    });
  });

  describe("2. Analytics DTO Schemas Validation", () => {
    it("validates DashboardOverviewResponse DTO", () => {
      const sample = {
        ok: true,
        todayIstDate: "2026-11-10",
        kpis: {
          openPipelineValue: 500000,
          openPipelineValueDecimal: "500000.00",
          activeLeadsCount: 15,
          hotLeadsCount: 4,
          followUpsTodayCount: 5,
          followUpsOverdueCount: 2,
          oldestOverdueDueAt: "2026-11-09T10:00:00.000Z",
          receivedValue: 120000,
          receivedValueDecimal: "120000.00",
          outstandingValue: 380000,
          outstandingValueDecimal: "380000.00",
          overdueDealsValue: 50000,
          overdueDealsValueDecimal: "50000.00",
          dueDealsCount: 3,
          winRate: 0.3333,
        },
        bottleneck: {
          stage: "qualified",
          name: "Qualified",
          count: 6,
          value: 200000,
          valueDecimal: "200000.00",
        },
        stages: [
          { stage: "new", name: "New", count: 4, value: 100000, valueDecimal: "100000.00" },
          { stage: "qualified", name: "Qualified", count: 6, value: 200000, valueDecimal: "200000.00" },
        ],
        collectionProgress: {
          received: 120000,
          receivedDecimal: "120000.00",
          outstanding: 380000,
          outstandingDecimal: "380000.00",
          overdue: 50000,
          overdueDecimal: "50000.00",
          collectionRate: 0.24,
        },
        actionCenter: {
          counts: { all: 4, overdue: 2, today: 1, hot: 1, money: 0 },
          items: [
            {
              key: "fu-1",
              kind: "overdue",
              leadId: "lead-1",
              title: "Acme Corp",
              detail: "call · Follow up on proposal",
              when: "Due 2026-11-09 10:00",
            },
          ],
        },
        priorityProspects: [
          {
            id: "lead-1",
            name: "Rahul Sharma",
            company: "Acme",
            source: "Website",
            status: "qualified",
            priority: "hot",
            quotedAmount: 150000,
          },
        ],
        recentActivities: [
          {
            id: "act-1",
            leadId: "lead-1",
            leadName: "Rahul Sharma",
            type: "call",
            text: "Discussed deliverables",
            occurredAt: "2026-11-10T09:30:00.000Z",
          },
        ],
        next7DaysFollowUps: [
          { day: "2026-11-10", count: 3 },
          { day: "2026-11-11", count: 2 },
        ],
      };

      const parsed = dashboardOverviewResponseSchema.safeParse(sample);
      expect(parsed.success).toBe(true);
    });

    it("validates FunnelAnalyticsResponse DTO", () => {
      const sample = {
        ok: true,
        window: { start: "2026-11-01", end: "2026-11-10" },
        currentDistribution: [
          { stage: "new", label: "New", count: 5, value: 50000, valueDecimal: "50000.00" },
        ],
        stageMoves: [{ stage: "contacted", label: "Contacted", count: 3 }],
        totalMovesRecorded: 3,
        cohort: {
          size: 10,
          qualified: 4,
          won: 2,
          lost: 1,
          winRate: 0.2,
          qualRate: 0.4,
          isDeveloping: true,
        },
        closedConversion: {
          won: 5,
          lost: 2,
          winRate: 0.7143,
        },
        lostReasons: [
          { reason: "Budget too low", count: 2, value: 100000, valueDecimal: "100000.00" },
        ],
        sourcePerformance: [
          {
            source: "Website",
            leads: 5,
            qualified: 2,
            won: 1,
            winRate: 0.2,
            medianFirstAttemptH: 1.5,
          },
        ],
      };

      const parsed = funnelAnalyticsResponseSchema.safeParse(sample);
      expect(parsed.success).toBe(true);
    });

    it("validates FinanceAnalyticsResponse DTO", () => {
      const sample = {
        ok: true,
        window: { start: "2026-11-01", end: "2026-11-10" },
        todayIstDate: "2026-11-10",
        kpis: {
          wonDealValue: 300000,
          wonDealValueDecimal: "300000.00",
          wonDealCount: 2,
          receivedCash: 150000,
          receivedCashDecimal: "150000.00",
          paymentCount: 3,
          outstanding: 150000,
          outstandingDecimal: "150000.00",
          overdue: 0,
          overdueDecimal: "0.00",
          collectionRate: 0.5,
          unknownWonCount: 0,
          unknownWonValue: 0,
          unknownWonValueDecimal: "0.00",
        },
        dealsBreakdown: {
          fullyPaidCount: 1,
          partialCount: 1,
          awaitingCount: 0,
          overdueCount: 0,
          noTermsCount: 0,
        },
        voided: { count: 1, amount: 25000, amountDecimal: "25000.00" },
        cancelledDeals: { count: 0, historicalCollectedCash: 0, historicalCollectedCashDecimal: "0.00" },
        byMonth: [
          {
            month: "2026-11",
            wonValue: 300000,
            wonValueDecimal: "300000.00",
            receivedCash: 150000,
            receivedCashDecimal: "150000.00",
          },
        ],
        byPaymentMethod: [
          { method: "upi", amount: 100000, amountDecimal: "100000.00", count: 2 },
          { method: "bank_transfer", amount: 50000, amountDecimal: "50000.00", count: 1 },
        ],
      };

      const parsed = financeAnalyticsResponseSchema.safeParse(sample);
      expect(parsed.success).toBe(true);
    });

    it("validates CommunicationsAnalyticsResponse DTO", () => {
      const sample = {
        ok: true,
        window: { start: "2026-11-01", end: "2026-11-10" },
        calls: {
          attempts: 12,
          connected: 8,
          connectionRate: 0.6667,
          noAnswer: 3,
          busy: 1,
          byOutcome: [
            { outcome: "connected", count: 8 },
            { outcome: "not_picked", count: 3 },
            { outcome: "busy", count: 1 },
          ],
          medianFirstAttemptHours: 2.1,
          cohortAttempted: 5,
          cohortSize: 8,
        },
        whatsapp: {
          confirmedSent: 6,
          byTemplate: [{ templateId: "tpl-1", templateName: "Followup 1", count: 4 }],
          byPurpose: [{ purpose: "follow_up", count: 6 }],
        },
        followUps: {
          scheduled: 10,
          completed: 7,
          completionRate: 0.7,
          overdueNow: 2,
          cancelled: 1,
        },
      };

      const parsed = communicationsAnalyticsResponseSchema.safeParse(sample);
      expect(parsed.success).toBe(true);
    });

    it("validates QuotationsAnalyticsResponse DTO", () => {
      const sample = {
        ok: true,
        window: { start: "2026-11-01", end: "2026-11-10" },
        counts: { draft: 2, sent: 3, accepted: 2, rejected: 1, expired: 0, total: 8 },
        values: {
          totalQuoted: 800000,
          totalQuotedDecimal: "800000.00",
          sentQuoted: 300000,
          sentQuotedDecimal: "300000.00",
          acceptedQuoted: 200000,
          acceptedQuotedDecimal: "200000.00",
          rejectedQuoted: 100000,
          rejectedQuotedDecimal: "100000.00",
        },
        conversion: {
          rateAcceptedOfSent: 0.3333,
          rateAcceptedOfTotal: 0.25,
        },
        byMonth: [
          {
            month: "2026-11",
            createdCount: 8,
            sentCount: 3,
            acceptedCount: 2,
            acceptedValue: 200000,
            acceptedValueDecimal: "200000.00",
          },
        ],
      };

      const parsed = quotationsAnalyticsResponseSchema.safeParse(sample);
      expect(parsed.success).toBe(true);
    });

    it("validates ProjectsAnalyticsResponse DTO", () => {
      const sample = {
        ok: true,
        window: { start: "2026-11-01", end: "2026-11-10" },
        todayIstDate: "2026-11-10",
        projectCounts: {
          created: 2,
          active: 3,
          inProgress: 2,
          awaitingClient: 1,
          completed: 1,
          delivered: 1,
          overdue: 0,
        },
        byType: [{ type: "Web Development", count: 3 }],
        byStage: [{ stage: "development", count: 2 }, { stage: "discovery", count: 1 }],
        tasks: { total: 15, done: 10, completionRate: 0.6667, overdue: 1 },
        dependencies: { openClientDependencies: 2, projectsWaitingOnClient: 1 },
        support: {
          openTickets: 1,
          inProgressTickets: 1,
          resolvedTickets: 3,
          closedTickets: 0,
          activeSupportAgreements: 2,
          supportEndingSoon: 0,
        },
        deliveryPerformance: {
          avgDeliveryDays: 24,
          deliveryMeasuredCount: 1,
          deliveredUnpaidCount: 0,
        },
      };

      const parsed = projectsAnalyticsResponseSchema.safeParse(sample);
      expect(parsed.success).toBe(true);
    });

    it("validates PerformanceAnalyticsResponse DTO", () => {
      const sample = {
        ok: true,
        window: { start: "2026-11-09", end: "2026-11-15" },
        todayIstDate: "2026-11-10",
        ownerSummary: {
          callsAttempted: 15,
          callsConnected: 10,
          connectionRate: 0.6667,
          followUpsCompleted: 8,
          followUpsDue: 12,
          followUpRate: 0.6667,
          followUpsOverdueNow: 1,
          leadsCreated: 4,
          leadsQualified: 3,
          quotationsConfirmedSent: 2,
          dealsWon: 2,
          wonDealValue: 250000,
          wonDealValueDecimal: "250000.00",
          unknownWonDatesCount: 0,
          cohortSize: 4,
          cohortWon: 1,
          cohortWinRate: 0.25,
          unattributedEventsCount: 0,
        },
        goals: {
          status: "not_configured" as const,
          note: "Goals are currently stored in browser-local preferences. Server-backed goal persistence will be added in a future checkpoint. Default targets are never fabricated.",
          items: [],
        },
      };

      const parsed = performanceAnalyticsResponseSchema.safeParse(sample);
      expect(parsed.success).toBe(true);
    });

    it("validates TrendsAnalyticsResponse DTO", () => {
      const sample = {
        ok: true,
        window: { start: "2026-11-08", end: "2026-11-10" },
        granularity: "day" as const,
        series: [
          {
            bucket: "2026-11-08",
            leadsReceived: 2,
            leadsQualified: 1,
            leadsWon: 0,
            callsAttempted: 5,
            callsConnected: 3,
            followUpsCompleted: 2,
            paymentsCollected: 50000,
            paymentsCollectedDecimal: "50000.00",
            wonDealValue: 0,
            wonDealValueDecimal: "0.00",
          },
        ],
      };

      const parsed = trendsAnalyticsResponseSchema.safeParse(sample);
      expect(parsed.success).toBe(true);
    });
  });
});
