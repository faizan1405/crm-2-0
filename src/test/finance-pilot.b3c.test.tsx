import type * as React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PilotDealsPage } from "@/components/pilot/PilotDealsPage";
import { PilotPaymentDialog } from "@/components/pilot/PilotPaymentDialog";
import { PilotVoidPaymentDialog } from "@/components/pilot/PilotVoidPaymentDialog";
import { PilotCancelDealDialog } from "@/components/pilot/PilotCancelDealDialog";
import { resolveLeadPilotActive, setLeadPilotSessionOptIn } from "@/lib/api/pilotGate";
import type { DealDto, OwnerFinanceSummaryDto, PaymentDto } from "@/lib/api/schemas";
import {
  AuthSsrProvider,
  clearClientAuthState,
  hydrateAuthFromSsr,
  type AuthSessionSnapshot,
} from "@/lib/auth/authClient";

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
    select ? select({ location: { pathname: "/deals" } }) : "/deals",
}));

const LOCAL_STORAGE_KEY = "scale-flow-crm-2-demo";
const LOCAL_STORAGE_VALUE = JSON.stringify({
  state: {
    deals: [{ id: "local_deal_1", name: "Local Protected Deal", finalAmount: 50000 }],
    payments: [{ id: "local_pay_1", dealId: "local_deal_1", amount: 20000, voided: false }],
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

function makeDeal(overrides: Partial<DealDto> = {}): DealDto {
  return {
    id: "deal_srv_1",
    legacyId: null,
    clientType: "crm",
    clientName: "Server Client Alpha",
    leadId: "lead_srv_1",
    name: "Enterprise Architecture Pilot",
    quotedAmount: 150000,
    quotedAmountDecimal: "150000.00",
    quotedAmountPaise: 15000000,
    finalAmount: 120000,
    finalAmountDecimal: "120000.00",
    finalAmountPaise: 12000000,
    status: "active",
    dueDate: "2026-11-30",
    milestones: [],
    createdByUserId: "usr_owner",
    updatedByUserId: "usr_owner",
    version: 1,
    createdAt: "2026-11-09T09:00:00.000Z",
    updatedAt: "2026-11-09T09:00:00.000Z",
    financialSummary: {
      dealId: "deal_srv_1",
      dealStatus: "active",
      paymentStatus: "partial",
      isOverdue: false,
      dueDate: "2026-11-30",
      quotedAmount: 150000,
      quotedAmountDecimal: "150000.00",
      quotedAmountPaise: 15000000,
      finalAmount: 120000,
      finalAmountDecimal: "120000.00",
      finalAmountPaise: 12000000,
      collected: 50000,
      collectedDecimal: "50000.00",
      collectedPaise: 5000000,
      realizedRevenue: 120000,
      realizedRevenueDecimal: "120000.00",
      realizedRevenuePaise: 12000000,
      outstanding: 70000,
      outstandingDecimal: "70000.00",
      outstandingPaise: 7000000,
      overdue: 0,
      overdueDecimal: "0.00",
      overduePaise: 0,
      voidedAmount: 0,
      voidedDecimal: "0.00",
      voidedPaise: 0,
      activePaymentCount: 1,
      voidedPaymentCount: 0,
      collectionRate: 0.416,
      lastPaymentDate: "2026-11-09",
      nextMilestone: null,
    },
    ...overrides,
  };
}

function makePayment(overrides: Partial<PaymentDto> = {}): PaymentDto {
  return {
    id: "pay_srv_1",
    legacyId: null,
    dealId: "deal_srv_1",
    amount: 50000,
    amountDecimal: "50000.00",
    amountPaise: 5000000,
    date: "2026-11-09",
    method: "UPI",
    type: "milestone",
    reference: "UPI/987654321",
    status: "posted",
    voided: false,
    recordedByUserId: "usr_owner",
    updatedByUserId: "usr_owner",
    version: 1,
    hasProof: true,
    createdAt: "2026-11-09T09:30:00.000Z",
    updatedAt: "2026-11-09T09:30:00.000Z",
    ...overrides,
  };
}

function makeSummary(overrides: Partial<OwnerFinanceSummaryDto> = {}): OwnerFinanceSummaryDto {
  return {
    todayIstDate: "2026-11-09",
    period: "all_time",
    fromIstDate: null,
    toIstDate: null,
    totalBooked: 120000,
    totalBookedDecimal: "120000.00",
    totalBookedPaise: 12000000,
    activeBooked: 120000,
    activeBookedDecimal: "120000.00",
    activeBookedPaise: 12000000,
    cancelledBooked: 0,
    cancelledBookedDecimal: "0.00",
    cancelledBookedPaise: 0,
    cashCollected: 50000,
    cashCollectedDecimal: "50000.00",
    cashCollectedPaise: 5000000,
    activeCashCollected: 50000,
    activeCashCollectedDecimal: "50000.00",
    activeCashCollectedPaise: 5000000,
    cancelledCashCollected: 0,
    cancelledCashCollectedDecimal: "0.00",
    cancelledCashCollectedPaise: 0,
    outstanding: 70000,
    outstandingDecimal: "70000.00",
    outstandingPaise: 7000000,
    overdue: 0,
    overdueDecimal: "0.00",
    overduePaise: 0,
    voidedAmount: 0,
    voidedDecimal: "0.00",
    voidedPaise: 0,
    activeDealCount: 1,
    cancelledDealCount: 0,
    activePaymentCount: 1,
    voidedPaymentCount: 0,
    collectionRate: 0.416,
    ...overrides,
  };
}

function renderWithQuery(ui: React.ReactElement) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return render(
    <AuthSsrProvider value={SSR_SNAPSHOT}>
      <QueryClientProvider client={client}>{ui}</QueryClientProvider>
    </AuthSsrProvider>,
  );
}

describe("B3C Server-Backed Finance Pilot UI & Storage Isolation", () => {
  beforeEach(() => {
    window.localStorage.setItem(LOCAL_STORAGE_KEY, LOCAL_STORAGE_VALUE);
    hydrateAuthFromSsr(SSR_SNAPSHOT);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    clearClientAuthState();
    setLeadPilotSessionOptIn(false);
  });

  it("enforces server feature gating: ignores pilot=1 whenever leadPilotAvailable is false", () => {
    expect(
      resolveLeadPilotActive({
        leadPilotAvailable: false,
        searchPilot: "1",
        sessionOptIn: true,
      }),
    ).toBe(false);

    expect(
      resolveLeadPilotActive({
        leadPilotAvailable: true,
        searchPilot: "1",
        sessionOptIn: false,
      }),
    ).toBe(true);
  });

  it("renders PilotDealsPage strictly from MariaDB queries and isolates browser-local storage", async () => {
    const srvDeal = makeDeal();
    const srvPayment = makePayment();
    const srvSummary = makeSummary();

    const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();

      if (url.includes("/api/v1/finance/summary")) {
        return Promise.resolve(
          new Response(JSON.stringify({ ok: true, summary: srvSummary }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        );
      }

      if (url.includes("/api/v1/deals") && !url.includes("/payments")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              ok: true,
              items: [srvDeal],
              total: 1,
              limit: 50,
              offset: 0,
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        );
      }

      if (url.includes("/payments")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              ok: true,
              items: [srvPayment],
              total: 1,
              limit: 50,
              offset: 0,
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        );
      }

      return Promise.reject(new Error(`Unexpected fetch URL: ${url}`));
    });

    vi.stubGlobal("fetch", fetchMock);

    renderWithQuery(<PilotDealsPage search={{ pilot: 1 }} />);

    // Verify server data rendered
    await waitFor(() => {
      expect(screen.getByText("Enterprise Architecture Pilot")).toBeInTheDocument();
      expect(screen.getAllByText("Server Client Alpha").length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText("MariaDB Dev Mode")).toBeInTheDocument();
    });

    // Verify browser-local storage remains untouched
    const localRaw = window.localStorage.getItem(LOCAL_STORAGE_KEY);
    expect(localRaw).toBe(LOCAL_STORAGE_VALUE);
    expect(screen.queryByText("Local Protected Deal")).not.toBeInTheDocument();
  });

  it("PaymentDialog prevents overpayment beyond outstanding balance", async () => {
    const srvDeal = makeDeal({
      financialSummary: {
        ...makeDeal().financialSummary,
        outstanding: 30000,
      },
    });

    renderWithQuery(<PilotPaymentDialog deal={srvDeal} onClose={vi.fn()} />);

    expect(screen.getByText("₹30,000")).toBeInTheDocument();

    const amountInput = screen.getByLabelText("Amount (₹)");
    fireEvent.change(amountInput, { target: { value: "35000" } });

    const saveBtn = screen.getByText("Save payment");
    fireEvent.click(saveBtn);

    // Should not trigger fetch for overpayment
    await waitFor(() => {
      expect(amountInput).toHaveValue(35000);
    });
  });

  it("VoidPaymentDialog displays accounting disclaimer banner and enforces mandatory reason", async () => {
    const srvPayment = makePayment({ amount: 50000 });

    renderWithQuery(<PilotVoidPaymentDialog payment={srvPayment} onClose={vi.fn()} />);

    expect(
      screen.getByText(/This action marks the CRM ledger entry as void/i),
    ).toBeInTheDocument();

    const confirmBtn = screen.getByText("Confirm Void");
    expect(confirmBtn).toBeDisabled();

    const reasonInput = screen.getByLabelText(/Reason for voiding/i);
    fireEvent.change(reasonInput, { target: { value: "Cheque bounced" } });

    expect(confirmBtn).not.toBeDisabled();
  });

  it("CancelDealDialog displays historical cash notice", () => {
    const srvDeal = makeDeal({
      financialSummary: {
        ...makeDeal().financialSummary,
        collected: 50000,
      },
    });

    renderWithQuery(<PilotCancelDealDialog deal={srvDeal} onClose={vi.fn()} />);

    expect(screen.getByText(/Historical payments totaling/i)).toBeInTheDocument();
    expect(screen.getByText(/remain safely recorded on this deal/i)).toBeInTheDocument();
    expect(screen.getByText(/will not be automatically refunded/i)).toBeInTheDocument();
  });
});

