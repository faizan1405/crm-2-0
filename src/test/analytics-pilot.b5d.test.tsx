import type * as React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PilotDashboardPage } from "@/components/pilot/PilotDashboardPage";
import { PilotAnalyticsPage } from "@/components/pilot/PilotAnalyticsPage";
import { PilotMyPerformancePage } from "@/components/pilot/PilotMyPerformancePage";
import { AuthSsrProvider, clearClientAuthState, hydrateAuthFromSsr } from "@/lib/auth/authClient";

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    className,
    to,
  }: {
    children: React.ReactNode;
    className?: string;
    to?: string;
  }) => (
    <a href={to ?? "#"} className={className}>
      {children}
    </a>
  ),
  useNavigate: () => vi.fn(),
  useRouterState: ({ select }: { select?: (s: { location: { pathname: string } }) => unknown }) =>
    select ? select({ location: { pathname: "/analytics" } }) : "/analytics",
}));

// Mock Recharts ResponsiveContainer for jsdom environment
vi.mock("recharts", async () => {
  const actual = await vi.importActual<typeof import("recharts")>("recharts");
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
      <div style={{ width: 600, height: 300 }}>{children}</div>
    ),
  };
});

const LOCAL_STORAGE_KEY = "scale-flow-crm-2-demo";
const LOCAL_STORAGE_VALUE = JSON.stringify({
  state: {
    leads: [{ id: "local_lead_99", name: "Browser Local Only Lead", quotedAmount: 999999 }],
    deals: [{ id: "local_deal_99", name: "Browser Local Deal", finalAmount: 888888 }],
    goals: [{ id: "local_goal_1", title: "Local Browser Goal" }],
  },
  version: 0,
});

const SSR_SNAPSHOT = {
  checked: true,
  authenticated: true,
  user: {
    id: "usr_owner",
    name: "Owner Synthetic",
    email: "owner@synthetic.example",
    roleId: "owner" as const,
  },
  idleExpiresAt: null,
  expiresAt: null,
  leadPilotAvailable: true,
};

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return (
    <AuthSsrProvider value={SSR_SNAPSHOT}>
      <QueryClientProvider client={qc}>{ui}</QueryClientProvider>
    </AuthSsrProvider>
  );
}

const jsonRes = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const MOCK_DASHBOARD = {
  ok: true,
  todayIstDate: "2026-11-10",
  kpis: {
    openPipelineValue: 350000,
    openPipelineValueDecimal: "350000.00",
    activeLeadsCount: 8,
    hotLeadsCount: 3,
    followUpsTodayCount: 2,
    followUpsOverdueCount: 1,
    oldestOverdueDueAt: "2026-11-09T10:00:00Z",
    receivedValue: 200000,
    receivedValueDecimal: "200000.00",
    outstandingValue: 120000,
    outstandingValueDecimal: "120000.00",
    overdueDealsValue: 40000,
    overdueDealsValueDecimal: "40000.00",
    dueDealsCount: 2,
    winRate: 0.45,
  },
  bottleneck: {
    stage: "qualified",
    name: "Qualified",
    count: 4,
    value: 200000,
    valueDecimal: "200000.00",
  },
  stages: [
    { stage: "new", name: "New", count: 2, value: 50000, valueDecimal: "50000.00" },
    { stage: "qualified", name: "Qualified", count: 4, value: 200000, valueDecimal: "200000.00" },
  ],
  collectionProgress: {
    received: 200000,
    receivedDecimal: "200000.00",
    outstanding: 120000,
    outstandingDecimal: "120000.00",
    overdue: 40000,
    overdueDecimal: "40000.00",
    collectionRate: 0.625,
  },
  actionCenter: {
    counts: { all: 2, overdue: 1, today: 1, hot: 0, money: 0 },
    items: [
      {
        key: "fu_1",
        kind: "overdue",
        leadId: "lead_srv_1",
        title: "MariaDB Server Prospect",
        detail: "Call · Needs demo",
        when: "Due yesterday",
        followUpId: "fu_1",
        phone: "+91 98765 00001",
      },
      {
        key: "fu_2",
        kind: "today",
        leadId: "lead_srv_2",
        title: "Today FollowUp Client",
        detail: "WhatsApp · Proposal check",
        when: "04:00 PM",
        followUpId: "fu_2",
      },
    ],
  },
  priorityProspects: [
    {
      id: "lead_srv_1",
      name: "MariaDB Server Prospect",
      company: "Server Corp",
      source: "Website",
      status: "qualified",
      priority: "hot",
      quotedAmount: 150000,
      lastContactAt: null,
      nextFollowUpAt: "2026-11-10T10:00:00Z",
      phone: "+91 98765 00001",
    },
  ],
  recentActivities: [
    {
      id: "act_1",
      leadId: "lead_srv_1",
      leadName: "MariaDB Server Prospect",
      type: "call",
      text: "Connected discovery call",
      occurredAt: "2026-11-10T09:00:00Z",
    },
  ],
  next7DaysFollowUps: [{ day: "2026-11-10", count: 2 }],
};

const MOCK_FINANCE = {
  ok: true,
  window: { start: "2026-11-01", end: "2026-11-10" },
  todayIstDate: "2026-11-10",
  kpis: {
    wonDealValue: 120000,
    wonDealValueDecimal: "120000.00",
    wonDealCount: 1,
    receivedCash: 40000,
    receivedCashDecimal: "40000.00",
    paymentCount: 1,
    outstanding: 80000,
    outstandingDecimal: "80000.00",
    overdue: 0,
    overdueDecimal: "0.00",
    collectionRate: 0.3333,
    unknownWonCount: 0,
    unknownWonValue: 0,
    unknownWonValueDecimal: "0.00",
  },
  dealsBreakdown: {
    fullyPaidCount: 0,
    partialCount: 1,
    awaitingCount: 0,
    overdueCount: 0,
    noTermsCount: 0,
  },
  voided: { count: 1, amount: 15000, amountDecimal: "15000.00" },
  cancelledDeals: {
    count: 1,
    historicalCollectedCash: 25000,
    historicalCollectedCashDecimal: "25000.00",
  },
  byMonth: [],
  byPaymentMethod: [],
};

const MOCK_PROJECTS = {
  ok: true,
  window: { start: "2026-11-01", end: "2026-11-10" },
  todayIstDate: "2026-11-10",
  projectCounts: {
    created: 3,
    active: 2,
    inProgress: 2,
    awaitingClient: 1,
    completed: 1,
    delivered: 1,
    overdue: 1,
  },
  byType: [],
  byStage: [],
  tasks: { total: 10, done: 6, completionRate: 0.6, overdue: 2 },
  dependencies: { openClientDependencies: 1, projectsWaitingOnClient: 1 },
  support: {
    openTickets: 3,
    inProgressTickets: 0,
    resolvedTickets: 1,
    closedTickets: 0,
    activeSupportAgreements: 2,
    supportEndingSoon: 0,
  },
  deliveryPerformance: {
    avgDeliveryDays: null,
    deliveryMeasuredCount: 0,
    deliveredUnpaidCount: 0,
  },
};

const MOCK_FUNNEL = {
  ok: true,
  window: { start: "2026-11-01", end: "2026-11-10" },
  currentDistribution: [{ stage: "new", label: "New", count: 0, value: 0, valueDecimal: "0.00" }],
  stageMoves: [],
  totalMovesRecorded: 0,
  cohort: {
    size: 0,
    qualified: 0,
    won: 0,
    lost: 0,
    winRate: null,
    qualRate: null,
    isDeveloping: false,
  },
  closedConversion: { won: 0, lost: 0, winRate: null },
  lostReasons: [],
  sourcePerformance: [],
};

const MOCK_COMMS = {
  ok: true,
  window: { start: "2026-11-01", end: "2026-11-10" },
  calls: {
    attempts: 3,
    connected: 1,
    connectionRate: 0.3333,
    noAnswer: 1,
    busy: 1,
    byOutcome: [{ outcome: "connected", count: 1 }],
    medianFirstAttemptHours: 2.5,
    cohortAttempted: 1,
    cohortSize: 1,
  },
  whatsapp: {
    confirmedSent: 2,
    byTemplate: [],
    byPurpose: [{ purpose: "follow_up", count: 2 }],
  },
  followUps: { scheduled: 4, completed: 2, completionRate: 0.5, overdueNow: 1, cancelled: 0 },
};

const MOCK_QUOTES = {
  ok: true,
  window: { start: "2026-11-01", end: "2026-11-10" },
  counts: { draft: 1, sent: 2, accepted: 1, rejected: 0, expired: 0, total: 4 },
  values: {
    totalQuoted: 200000,
    totalQuotedDecimal: "200000.00",
    sentQuoted: 150000,
    sentQuotedDecimal: "150000.00",
    acceptedQuoted: 50000,
    acceptedQuotedDecimal: "50000.00",
    rejectedQuoted: 0,
    rejectedQuotedDecimal: "0.00",
  },
  conversion: { rateAcceptedOfSent: 0.3333, rateAcceptedOfTotal: 0.25 },
  byMonth: [],
};

const MOCK_PERF = {
  ok: true,
  window: { start: "2026-11-04", end: "2026-11-10" },
  todayIstDate: "2026-11-10",
  ownerSummary: {
    callsAttempted: 12,
    callsConnected: 6,
    connectionRate: 0.5,
    followUpsCompleted: 8,
    followUpsDue: 10,
    followUpRate: 0.8,
    followUpsOverdueNow: 1,
    leadsCreated: 5,
    leadsQualified: 3,
    quotationsConfirmedSent: 2,
    dealsWon: 2,
    wonDealValue: 180000,
    wonDealValueDecimal: "180000.00",
    unknownWonDatesCount: 0,
    cohortSize: 5,
    cohortWon: 2,
    cohortWinRate: 0.4,
    unattributedEventsCount: 0,
  },
  goals: {
    status: "not_configured",
    note: "Goals are deferred until dedicated server-side target schemas are created.",
    items: [],
  },
};

const MOCK_TRENDS = {
  ok: true,
  window: { start: "2026-11-01", end: "2026-11-10" },
  granularity: "day",
  series: [],
};

describe("B5D Server-Backed Dashboard, Analytics & My Performance Pilot UI", () => {
  beforeEach(() => {
    window.localStorage.setItem(LOCAL_STORAGE_KEY, LOCAL_STORAGE_VALUE);
    hydrateAuthFromSsr(SSR_SNAPSHOT);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    clearClientAuthState();
    window.localStorage.clear();
  });

  it("PilotDashboardPage renders live MariaDB metrics and preserves browser-local storage", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (info) => {
      const url = String(info);
      if (url.includes("/api/v1/analytics/dashboard")) return jsonRes(MOCK_DASHBOARD);
      if (url.includes("/api/v1/analytics/finance")) return jsonRes(MOCK_FINANCE);
      if (url.includes("/api/v1/analytics/projects")) return jsonRes(MOCK_PROJECTS);
      return jsonRes({ ok: false }, 404);
    });

    render(wrap(<PilotDashboardPage search={{ pilot: 1 }} />));

    await waitFor(() => {
      expect(screen.getAllByText(/MariaDB Server Prospect/i).length).toBeGreaterThan(0);
    });

    // Ensure localStorage lead is NEVER shown in Server Pilot Dashboard
    expect(screen.queryByText(/Browser Local Only Lead/i)).toBeNull();
    // Ensure cancelled deal historical cash is rendered distinctly
    expect(screen.getByText(/Historical cash on 1 cancelled deal/i)).toBeTruthy();
    // Ensure operations snapshot metrics appear
    expect(screen.getByText(/Delivery & Operations Snapshot/i)).toBeTruthy();

    // Test Action Center tab filter
    fireEvent.click(screen.getByRole("button", { name: /Today/i }));
    expect(screen.getByText(/Today FollowUp Client/i)).toBeTruthy();

    // Ensure browser localStorage remains completely untouched
    expect(window.localStorage.getItem(LOCAL_STORAGE_KEY)).toBe(LOCAL_STORAGE_VALUE);
  });

  it("PilotDashboardPage displays explicit error banner instead of fabricated zeroes on API failure", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      jsonRes({ ok: false, error: { code: "internal_error", message: "Database offline" } }, 503),
    );

    render(wrap(<PilotDashboardPage search={{ pilot: 1 }} />));

    await waitFor(() => {
      expect(
        screen.getByText(/Failed to load server dashboard metrics: Database offline/i),
      ).toBeTruthy();
    });
    expect(screen.queryByText(/Open pipeline value/i)).toBeNull();
  });

  it("PilotAnalyticsPage supports period filtering, unavailable metrics disclosure, and zero NaN", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (info) => {
      const url = String(info);
      if (url.includes("/api/v1/analytics/funnel")) return jsonRes(MOCK_FUNNEL);
      if (url.includes("/api/v1/analytics/communications")) return jsonRes(MOCK_COMMS);
      if (url.includes("/api/v1/analytics/finance")) return jsonRes(MOCK_FINANCE);
      if (url.includes("/api/v1/analytics/quotations")) return jsonRes(MOCK_QUOTES);
      if (url.includes("/api/v1/analytics/projects")) return jsonRes(MOCK_PROJECTS);
      if (url.includes("/api/v1/analytics/trends")) return jsonRes(MOCK_TRENDS);
      return jsonRes({ ok: false }, 404);
    });

    render(wrap(<PilotAnalyticsPage search={{ pilot: 1 }} />));

    await waitFor(() => {
      expect(screen.getByText(/Marketing Spend & CAC: N\/A/i)).toBeTruthy();
    });

    // Zero denominator rate renders N/A safely, never NaN%
    expect(screen.queryByText(/\bNaN/)).toBeNull();
    expect(screen.getAllByText(/N\/A/i).length).toBeGreaterThan(0);

    // Switch period to Last month and confirm new API call triggers
    fireEvent.click(screen.getByRole("button", { name: "Last month" }));
    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining("/api/v1/analytics/funnel?period=lastMonth"),
        expect.anything(),
      );
    });

    // Switch to Finance & cash tab and inspect voided & cancelled figures
    fireEvent.click(screen.getByRole("button", { name: "Finance & cash" }));
    await waitFor(() => {
      expect(screen.getByText(/Cancelled Deal Historical Collections/i)).toBeTruthy();
    });
  });

  it("PilotMyPerformancePage separates server goals from browser-local state", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (info) => {
      const url = String(info);
      if (url.includes("/api/v1/analytics/performance")) return jsonRes(MOCK_PERF);
      if (url.includes("/api/v1/analytics/trends")) return jsonRes(MOCK_TRENDS);
      return jsonRes({ ok: false }, 404);
    });

    render(wrap(<PilotMyPerformancePage search={{ pilot: 1 }} />));

    await waitFor(() => {
      expect(screen.getByText(/Goals & Target Tracking/i)).toBeTruthy();
    });

    expect(screen.getByText(/Deferred \/ Server Schema Pending/i)).toBeTruthy();
    // Ensure Local Browser Goal is NOT leaked into Pilot My Performance
    expect(screen.queryByText(/Local Browser Goal/i)).toBeNull();
  });
});
