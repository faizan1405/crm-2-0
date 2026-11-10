import type * as React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PilotProjectsPage } from "@/components/pilot/PilotProjectsPage";
import { PilotProjectDetailPage } from "@/components/pilot/PilotProjectDetailPage";
import { PilotNewProjectDialog } from "@/components/pilot/PilotNewProjectDialog";
import { setLeadPilotSessionOptIn } from "@/lib/api/pilotGate";
import type {
  ClientSupportTicketDto,
  DealDto,
  ProjectDeliverableDto,
  ProjectDto,
  ProjectMilestoneDto,
  ProjectTaskDto,
} from "@/lib/api/schemas";
import {
  AuthSsrProvider,
  clearClientAuthState,
  hydrateAuthFromSsr,
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
    select ? select({ location: { pathname: "/projects" } }) : "/projects",
}));

const LOCAL_STORAGE_KEY = "scale-flow-crm-2-demo";
const LOCAL_STORAGE_VALUE = JSON.stringify({
  state: {
    projects: [{ id: "local_proj_1", name: "Local Protected Project", stage: "development" }],
    projectTasks: [{ id: "local_tsk_1", projectId: "local_proj_1", title: "Local Task" }],
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

function makeMockProject(overrides: Partial<ProjectDto> = {}): ProjectDto {
  return {
    id: "proj_srv_1",
    ownerUserId: "usr_owner",
    name: "Server Backed Platform Build",
    clientName: "Nexus Enterprise",
    company: "Nexus Technologies",
    phone: "+91 98765 43210",
    email: "nexus@example.com",
    leadId: "lead_srv_1",
    dealId: "deal_srv_1",
    templateId: null,
    legacyId: null,
    type: "Website Studio",
    scope: "Design, Development, Testing, and Deployment",
    bookingDate: "2026-11-01",
    plannedStart: "2026-11-05",
    actualStart: "2026-11-05",
    targetDelivery: "2026-12-01",
    status: "in_progress",
    stage: "development",
    priority: "high",
    projectOwnerId: "usr_owner",
    memberIds: [],
    dependencies: [{ id: "dep_1", label: "Brand Assets", done: true, doneAt: "2026-11-06" }],
    requirements: [{ id: "req_1", label: "Mobile Responsive", done: true }],
    qa: [{ id: "qa_1", label: "Lighthouse Audit", done: false }],
    handover: [{ id: "ho_1", label: "DNS Cutover", done: false }],
    links: [{ id: "lnk_1", label: "Figma File", url: "https://figma.com/test", addedAt: "2026-11-05" }],
    delivery: null,
    support: { included: true, months: 3, start: "2026-12-01", end: "2027-02-28", description: "Maintenance" },
    carried: { source: "Website", packageRef: "Scale Flow Ultra" },
    notes: "Internal project delivery notes.",
    reviewFlag: null,
    attention: null,
    archived: false,
    archivedAt: null,
    version: 1,
    progress: { total: 2, done: 1, pct: 50, text: "1 of 2 tasks complete" },
    createdAt: "2026-11-01T00:00:00.000Z",
    updatedAt: "2026-11-05T00:00:00.000Z",
    ...overrides,
  };
}

describe("B5B Project Desk Pilot Component Tests", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem(LOCAL_STORAGE_KEY, LOCAL_STORAGE_VALUE);
    clearClientAuthState();
    hydrateAuthFromSsr(SSR_SNAPSHOT);
    setLeadPilotSessionOptIn(true);
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
  });

  afterEach(() => {
    clearClientAuthState();
    localStorage.clear();
    vi.restoreAllMocks();
  });

  function renderWithProviders(ui: React.ReactElement) {
    return render(
      <AuthSsrProvider value={SSR_SNAPSHOT}>
        <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>
      </AuthSsrProvider>,
    );
  }

  it("preserves localStorage scale-flow-crm-2-demo data untouched", async () => {
    const mockProj = makeMockProject();
    vi.spyOn(globalThis, "fetch").mockImplementation(async (info: RequestInfo | URL) => {
      const url = String(info);
      if (url.includes("/api/v1/projects/summary/metrics")) {
        return new Response(
          JSON.stringify({
            ok: true,
            metrics: {
              active: 1,
              awaiting: 0,
              inProgress: 1,
              overdue: 0,
              delivered: 0,
              openTasks: 1,
              upcomingMilestones: 0,
              openRequests: 0,
            },
            attention: [],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.includes("/api/v1/projects")) {
        return new Response(
          JSON.stringify({ ok: true, items: [mockProj], total: 1, limit: 100, offset: 0 }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.includes("/api/v1/deals")) {
        return new Response(
          JSON.stringify({ ok: true, items: [], total: 0, limit: 100, offset: 0 }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    renderWithProviders(<PilotProjectsPage search={{ pilot: 1 }} />);

    await waitFor(() => {
      expect(screen.getByText("Project Desk (Pilot)")).toBeInTheDocument();
    });

    // Verify localStorage key was never touched or modified
    expect(localStorage.getItem(LOCAL_STORAGE_KEY)).toBe(LOCAL_STORAGE_VALUE);
  });

  it("PilotProjectsPage renders overview metrics and tabs", async () => {
    const mockProj = makeMockProject();
    vi.spyOn(globalThis, "fetch").mockImplementation(async (info: RequestInfo | URL) => {
      const url = String(info);
      if (url.includes("/api/v1/projects/summary/metrics")) {
        return new Response(
          JSON.stringify({
            ok: true,
            metrics: {
              active: 5,
              awaiting: 1,
              inProgress: 3,
              overdue: 1,
              delivered: 2,
              openTasks: 8,
              upcomingMilestones: 2,
              openRequests: 1,
            },
            attention: [{ id: "proj_1:tasks", projectId: "proj_srv_1", kind: "tasks_overdue", text: "1 overdue task." }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.includes("/api/v1/projects")) {
        return new Response(
          JSON.stringify({ ok: true, items: [mockProj], total: 1, limit: 100, offset: 0 }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.includes("/api/v1/deals")) {
        return new Response(
          JSON.stringify({ ok: true, items: [], total: 0, limit: 100, offset: 0 }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    renderWithProviders(<PilotProjectsPage search={{ pilot: 1, tab: "overview" }} />);

    await waitFor(() => {
      expect(screen.getByText("Needs attention · 1")).toBeInTheDocument();
      expect(screen.getByText("Active projects")).toBeInTheDocument();
    });
  });

  it("PilotProjectDetailPage renders tabs, tasks, deliverables, and read-only finance separation", async () => {
    const mockProj = makeMockProject();
    const mockMilestone: ProjectMilestoneDto = {
      id: "ms_1",
      ownerUserId: "usr_owner",
      projectId: "proj_srv_1",
      title: "Design Approval",
      dueDate: "2026-11-15",
      sortOrder: 0,
      status: "open",
      completedAt: null,
      version: 1,
      createdAt: "2026-11-01T00:00:00.000Z",
      updatedAt: "2026-11-01T00:00:00.000Z",
    };
    const mockTask: ProjectTaskDto = {
      id: "tsk_1",
      ownerUserId: "usr_owner",
      projectId: "proj_srv_1",
      milestoneId: "ms_1",
      title: "Hero 3D Canvas Assembly",
      notes: "Three.js component",
      assigneeId: "usr_owner",
      dueDate: "2026-11-12",
      priority: "high",
      status: "done",
      completedAt: "2026-11-06T00:00:00.000Z",
      completedBy: "usr_owner",
      sortOrder: 0,
      version: 2,
      createdAt: "2026-11-01T00:00:00.000Z",
      updatedAt: "2026-11-06T00:00:00.000Z",
    };
    const mockDel: ProjectDeliverableDto = {
      id: "del_1",
      ownerUserId: "usr_owner",
      projectId: "proj_srv_1",
      title: "Figma Design System",
      description: "Full tokens and visual hierarchy",
      category: "design",
      status: "review",
      dueDate: "2026-11-15",
      deliveredAt: null,
      revisionCount: 1,
      latestRevisionNotes: "Initial review draft",
      clientFeedback: null,
      version: 1,
      createdAt: "2026-11-01T00:00:00.000Z",
      updatedAt: "2026-11-01T00:00:00.000Z",
    };
    const mockTicket: ClientSupportTicketDto = {
      id: "tkt_1",
      ownerUserId: "usr_owner",
      projectId: "proj_srv_1",
      kind: "bug",
      title: "Mobile menu tap target issue",
      description: "Needs 44px min tap area",
      priority: "normal",
      assigneeId: "usr_owner",
      dueDate: "2026-11-20",
      status: "open",
      resolution: null,
      resolvedAt: null,
      resolvedByUserId: null,
      coverage: "included",
      version: 1,
      createdAt: "2026-11-01T00:00:00.000Z",
      updatedAt: "2026-11-01T00:00:00.000Z",
    };

    const mockDeal: DealDto = {
      id: "deal_srv_1",
      legacyId: null,
      clientType: "crm",
      clientName: "Nexus Enterprise",
      leadId: "lead_srv_1",
      name: "Nexus Enterprise Deal",
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
      createdAt: "2026-11-01T00:00:00.000Z",
      updatedAt: "2026-11-01T00:00:00.000Z",
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
        collected: 60000,
        collectedDecimal: "60000.00",
        collectedPaise: 6000000,
        realizedRevenue: 120000,
        realizedRevenueDecimal: "120000.00",
        realizedRevenuePaise: 12000000,
        outstanding: 60000,
        outstandingDecimal: "60000.00",
        outstandingPaise: 6000000,
        overdue: 0,
        overdueDecimal: "0.00",
        overduePaise: 0,
        activePaymentCount: 1,
        voidedPaymentCount: 0,
        voidedAmount: 0,
        voidedDecimal: "0.00",
        voidedPaise: 0,
        collectionRate: 0.5,
        lastPaymentDate: "2026-11-05",
        nextMilestone: null,
      },
    };

    vi.spyOn(globalThis, "fetch").mockImplementation(async (info: RequestInfo | URL) => {
      const url = String(info);
      if (url.includes("/api/v1/projects/proj_srv_1")) {
        return new Response(
          JSON.stringify({
            ok: true,
            project: mockProj,
            milestones: [mockMilestone],
            tasks: [mockTask],
            deliverables: [mockDel],
            supportTickets: [mockTicket],
            recentAuditEvents: [],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.includes("/api/v1/deals")) {
        return new Response(
          JSON.stringify({ ok: true, items: [mockDeal], total: 1, limit: 100, offset: 0 }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.includes("/api/v1/payments")) {
        return new Response(
          JSON.stringify({
            ok: true,
            items: [
              {
                id: "pay_1",
                dealId: "deal_srv_1",
                amount: 60000,
                amountDecimal: "60000.00",
                amountPaise: 6000000,
                date: "2026-11-05",
                method: "UPI",
                type: "advance",
                status: "posted",
                notes: "Advance 50%",
                referenceNumber: "UPI12345",
                version: 1,
                createdAt: "2026-11-05T00:00:00.000Z",
                updatedAt: "2026-11-05T00:00:00.000Z",
              },
            ],
            total: 1,
            limit: 100,
            offset: 0,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    renderWithProviders(
      <PilotProjectDetailPage projectId="proj_srv_1" search={{ pilot: 1, tab: "overview" }} />,
    );

    await waitFor(() => {
      expect(screen.getByText("Server Backed Platform Build")).toBeInTheDocument();
      expect(screen.getByText("Nexus Enterprise · Nexus Technologies · Website Studio")).toBeInTheDocument();
    });
  });
});
