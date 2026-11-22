import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAuthStore } from "@/lib/auth/authClient";
import { useLeadPilotState } from "@/lib/api/pilotHook";
import { PilotPipelinePage } from "@/components/pilot/PilotPipelinePage";
import { PilotDailyBriefingPage } from "@/components/pilot/PilotDailyBriefingPage";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
  useNavigate: () => vi.fn(),
  useRouterState: () => "/pipeline",
}));

const mockUpdateMutateAsync = vi.fn();
let mockLeadsData: { items: Array<Record<string, unknown>> } = { items: [] };
let mockDealsData: { items: Array<Record<string, unknown>> } = { items: [] };
let mockOverdueData: { items: Array<Record<string, unknown>> } = { items: [] };
let mockTodayData: { items: Array<Record<string, unknown>> } = { items: [] };
let mockProjectsData: { items: Array<Record<string, unknown>> } = { items: [] };

vi.mock("@/lib/api/leadsApi", () => ({
  useLeadsListQuery: () => ({
    data: mockLeadsData,
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
  useUpdateLeadMutation: () => ({
    mutateAsync: mockUpdateMutateAsync,
  }),
}));

vi.mock("@/lib/api/financeApi", () => ({
  useDealsQuery: () => ({
    data: mockDealsData,
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

vi.mock("@/lib/api/followupsApi", () => ({
  useFollowUpsQuery: ({ bucket }: { bucket?: string }) => ({
    data: bucket === "overdue" ? mockOverdueData : mockTodayData,
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

vi.mock("@/lib/api/projectsApi", () => ({
  useProjectsQuery: () => ({
    data: mockProjectsData,
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

function DefaultRoutingProbe() {
  const state = useLeadPilotState(undefined);
  return (
    <div>
      <span data-testid="pilot-active">{String(state.pilotActive)}</span>
      <span data-testid="default-active">{String(state.defaultBackendActive)}</span>
    </div>
  );
}

describe("Checkpoint B14A: Default MariaDB Routing, Pipeline Rollback & Daily Briefing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLeadsData = { items: [] };
    mockDealsData = { items: [] };
    mockOverdueData = { items: [] };
    mockTodayData = { items: [] };
    mockProjectsData = { items: [] };
    useAuthStore.setState({
      status: "authenticated",
      user: { id: "usr_owner_b14a", email: "owner@example.test", name: "Owner", roleId: "owner" },
      idleExpiresAt: "2026-12-01T00:00:00.000Z",
      expiresAt: "2026-12-01T00:00:00.000Z",
      leadPilotAvailable: false,
      crmV2DefaultBackend: true,
      lastCheckedAt: Date.now(),
    });
  });

  it("activates MariaDB by default without ?pilot=1 when crmV2DefaultBackend is true", () => {
    render(<DefaultRoutingProbe />);
    expect(screen.getByTestId("pilot-active").textContent).toBe("true");
    expect(screen.getByTestId("default-active").textContent).toBe("true");
  });

  it("renders genuine empty state in PilotPipelinePage when MariaDB has 0 leads (no demo fallback)", () => {
    const qc = new QueryClient();
    render(
      <QueryClientProvider client={qc}>
        <PilotPipelinePage />
      </QueryClientProvider>,
    );
    expect(screen.getByTestId("pipeline-empty-state")).toBeInTheDocument();
  });

  it("persists stage transitions and visually rolls back on API failure in PilotPipelinePage", async () => {
    mockLeadsData = {
      items: [
        {
          id: "lead_1",
          name: "MariaDB Pipeline Client",
          company: "Apex Corp",
          phone: "+91 98201 11111",
          source: "Website",
          status: "new",
          priority: "hot",
          version: 1,
        },
      ],
    };
    mockDealsData = {
      items: [
        {
          id: "deal_1",
          leadId: "lead_1",
          name: "Apex Website",
          clientName: "MariaDB Pipeline Client",
          status: "active",
          finalAmount: 50000,
          financialSummary: { outstandingPaise: 2500000 },
        },
      ],
    };

    mockUpdateMutateAsync.mockRejectedValueOnce(new Error("Simulated 503 DB timeout"));

    const qc = new QueryClient();
    render(
      <QueryClientProvider client={qc}>
        <PilotPipelinePage />
      </QueryClientProvider>,
    );

    expect(screen.getByTestId("pipeline-count-new").textContent).toBe("1");
    expect(screen.getByTestId("pipeline-count-qualified").textContent).toBe("0");

    // Attempt stage move -> API rejects -> must visually roll back to "new" and show alert
    const select = screen.getByLabelText("Stage for MariaDB Pipeline Client") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "qualified" } });

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/Failed to move/i);
    });
    expect(screen.getByTestId("pipeline-count-new").textContent).toBe("1");
    expect(screen.getByTestId("pipeline-count-qualified").textContent).toBe("0");
  });

  it("renders accurate Asia/Kolkata Daily Briefing counts from MariaDB without fabricating data", () => {
    mockOverdueData = {
      items: [
        {
          id: "fu_ov_1",
          leadId: "lead_1",
          type: "call",
          status: "pending",
          dueIstDate: "2026-11-21",
          dueIstTime: "10:00",
          note: "Overdue discovery call",
          lead: { id: "lead_1", name: "Overdue Lead" },
        },
      ],
    };
    mockTodayData = {
      items: [
        {
          id: "fu_td_1",
          leadId: "lead_2",
          type: "whatsapp",
          status: "pending",
          dueIstDate: "2026-11-22",
          dueIstTime: "15:00",
          note: "Send revised quote",
          lead: { id: "lead_2", name: "Today Lead" },
        },
      ],
    };
    mockLeadsData = {
      items: [
        {
          id: "lead_hot_1",
          name: "Unscheduled Hot Lead",
          phone: "9820100000",
          status: "proposal",
          priority: "hot",
          nextFollowUp: null,
        },
      ],
    };
    mockDealsData = {
      items: [
        {
          id: "deal_due_1",
          name: "Pending Balance Deal",
          clientName: "Today Lead",
          status: "active",
          finalAmount: 40000,
          financialSummary: { outstandingPaise: 2000000 },
        },
      ],
    };

    const qc = new QueryClient();
    render(
      <QueryClientProvider client={qc}>
        <PilotDailyBriefingPage />
      </QueryClientProvider>,
    );

    expect(screen.getByTestId("briefing-overdue-count").textContent).toBe("1");
    expect(screen.getByTestId("briefing-today-count").textContent).toBe("1");
    expect(screen.getByTestId("briefing-calls-count").textContent).toBe("1");
    expect(screen.getByTestId("briefing-attention-count").textContent).toBe("1");
    expect(screen.getByTestId("briefing-payments-count").textContent).toBe("1");
    expect(screen.getByText("Overdue Lead")).toBeInTheDocument();
    expect(screen.getByText("Pending Balance Deal")).toBeInTheDocument();
  });
});
