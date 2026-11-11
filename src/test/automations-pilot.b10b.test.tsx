import type * as React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PilotAutomationPage } from "@/components/pilot/PilotAutomationPage";
import { PilotRuleBuilderDialog } from "@/components/pilot/PilotRuleBuilderDialog";
import { PilotAutomationSimulationModal } from "@/components/pilot/PilotAutomationSimulationModal";
import { PilotAutomationRevisionsDrawer } from "@/components/pilot/PilotAutomationRevisionsDrawer";
import { AuthSsrProvider, clearClientAuthState, hydrateAuthFromSsr } from "@/lib/auth/authClient";
import type {
  AutomationRuleDto,
  AutomationRuleListResponse,
  AutomationDefinitionsResponse,
  SimulationResultDto,
  AutomationRuleRevisionDto,
} from "@/lib/api/automationsApi";

const mockNavigate = vi.fn();

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    className,
    to,
    onClick,
  }: {
    children: React.ReactNode;
    className?: string;
    to?: string;
    onClick?: () => void;
  }) => (
    <a href={to ?? "#"} className={className} onClick={onClick}>
      {children}
    </a>
  ),
  useNavigate: () => mockNavigate,
  useRouterState: ({ select }: { select?: (s: { location: { pathname: string } }) => unknown }) =>
    select ? select({ location: { pathname: "/automation" } }) : "/automation",
  useBlocker: () => ({ status: "idle", reset: vi.fn(), proceed: vi.fn() }),
}));

const SSR_AUTH = {
  checked: true,
  authenticated: true,
  user: {
    id: "usr_owner_alpha",
    name: "Owner Alpha",
    email: "owner.alpha@joinscaleflow.in",
    roleId: "owner" as const,
  },
  idleExpiresAt: null,
  expiresAt: null,
  leadPilotAvailable: true,
};

const MOCK_RULE: AutomationRuleDto = {
  id: "ar_pilot_01",
  ownerUserId: "usr_owner_alpha",
  name: "Hot lead response reminder",
  description: "Prompt follow-up for newly created hot leads",
  templateId: null,
  subject: "lead",
  triggerType: "lead_created",
  status: "enabled",
  pausedReason: null,
  conditions: {
    priorities: ["hot"],
    firstContactPending: true,
  },
  actions: ["reminder", "notify"],
  settings: {
    cooldownHours: 24,
  },
  version: 1,
  lastTriggeredAt: null,
  lastEvaluatedAt: "2026-11-11T10:00:00.000Z",
  totalTriggerCount: 0,
  totalActionCount: 0,
  createdAt: "2026-11-11T09:00:00.000Z",
  updatedAt: "2026-11-11T09:00:00.000Z",
  createdByUserId: "usr_owner_alpha",
  updatedByUserId: "usr_owner_alpha",
};

const MOCK_LIST_RESPONSE: AutomationRuleListResponse = {
  ok: true,
  rules: [MOCK_RULE],
  items: [MOCK_RULE],
  total: 1,
  page: 1,
  pageSize: 20,
  totalPages: 1,
  stats: {
    total: 1,
    draft: 0,
    enabled: 1,
    paused: 0,
    archived: 0,
  },
};

const MOCK_DEFINITIONS: AutomationDefinitionsResponse = {
  ok: true,
  triggers: [
    { type: "lead_created", label: "Lead created", subject: "lead" },
    { type: "followup_overdue", label: "Follow-up overdue", subject: "lead" },
    { type: "project_due_soon", label: "Project due date approaching", subject: "project" },
  ],
  actions: [
    { type: "reminder", label: "Create internal reminder", subjects: ["lead", "project"] },
    { type: "notify", label: "Generate CRM notification", subjects: ["lead", "project"] },
    { type: "task", label: "Create a project task", subjects: ["project"] },
  ],
  operators: ["is", "is_not", "gt", "between"],
  subjects: ["lead", "project"],
  templates: [
    {
      templateId: "tpl_hot",
      name: "Hot lead response reminder",
      description: "Notify owner on hot lead",
      subject: "lead",
      triggerType: "lead_created",
      conditions: { priorities: ["hot"] },
      actions: ["reminder"],
      settings: { cooldownHours: 24 },
    },
  ],
};

const MOCK_SIMULATION: SimulationResultDto = {
  ruleId: "ar_pilot_01",
  ruleName: "Hot lead response reminder",
  subject: "lead",
  triggerType: "lead_created",
  eventTriggerType: "lead_created",
  triggerMatched: true,
  matched: true,
  conditionResults: [
    {
      id: "cond_01",
      conditionId: "cond_01",
      field: "l.priority",
      operator: "is",
      expectedValue: "hot",
      actualValue: "hot",
      passed: true,
      message: 'Lead priority "hot" matches expected "hot"',
      reason: 'Lead priority "hot" matches expected "hot"',
    },
  ],
  plannedActions: [
    {
      action: "reminder",
      label: "Create internal reminder",
      category: "internal",
      target: "lead_01",
      reason: "Matched hot priority condition",
      dueAt: "2026-11-11T12:00:00.000Z",
      details: {},
      executableInCurrentCheckpoint: false,
      unattendedExecutionAllowed: false,
    },
  ],
  skippedReasons: [],
  safeForExecution: true,
  zeroWritesVerified: true,
  evaluatedAt: "2026-11-11T10:00:00.000Z",
};

const MOCK_REVISIONS: AutomationRuleRevisionDto[] = [
  {
    id: "arr_01",
    ownerUserId: "usr_owner_alpha",
    ruleId: "ar_pilot_01",
    version: 1,
    name: "Hot lead response reminder",
    description: "Initial description",
    subject: "lead",
    triggerType: "lead_created",
    status: "draft",
    conditions: { priorities: ["hot"] },
    actions: ["reminder"],
    settings: { cooldownHours: 24 },
    diffSummary: "Initial rule creation",
    actorUserId: "usr_owner_alpha",
    createdAt: "2026-11-11T09:00:00.000Z",
  },
];

describe("Checkpoint B10B: Server-Backed Automation Studio UI & Safe Simulation", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: 0 },
        mutations: { retry: false },
      },
    });
    hydrateAuthFromSsr(SSR_AUTH);
    localStorage.clear();
    localStorage.setItem("scale-flow-crm-2-demo", JSON.stringify({ version: "2.0-demo", leads: [] }));

    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (url.includes("/api/v1/automations/definitions")) {
          return Promise.resolve({
            ok: true,
            status: 200,
            headers: new Headers({ "content-type": "application/json" }),
            json: async () => MOCK_DEFINITIONS,
          });
        }
        if (url.includes("/api/v1/automations/ar_pilot_01/revisions")) {
          return Promise.resolve({
            ok: true,
            status: 200,
            headers: new Headers({ "content-type": "application/json" }),
            json: async () => ({ ok: true, revisions: MOCK_REVISIONS }),
          });
        }
        if (url.includes("/api/v1/automations/ar_pilot_01/simulate")) {
          return Promise.resolve({
            ok: true,
            status: 200,
            headers: new Headers({ "content-type": "application/json" }),
            json: async () => ({ ok: true, simulation: MOCK_SIMULATION }),
          });
        }
        if (url.includes("/api/v1/automations")) {
          return Promise.resolve({
            ok: true,
            status: 200,
            headers: new Headers({ "content-type": "application/json" }),
            json: async () => MOCK_LIST_RESPONSE,
          });
        }
        if (url.includes("/api/v1/leads")) {
          return Promise.resolve({
            ok: true,
            status: 200,
            headers: new Headers({ "content-type": "application/json" }),
            json: async () => ({
              ok: true,
              items: [
                {
                  id: "lead_01",
                  legacyId: null,
                  name: "Pooja Sharma",
                  phone: "+91 98765 43210",
                  email: "pooja@apex.in",
                  company: "Apex Tech",
                  source: "Website",
                  status: "new",
                  priority: "hot",
                  pinned: false,
                  lifecycleStatus: "active",
                  tagIds: [],
                  fieldValues: {},
                  version: 1,
                  createdAt: "2026-11-10T10:00:00.000Z",
                  updatedAt: "2026-11-10T10:00:00.000Z",
                },
              ],
              total: 1,
              limit: 50,
              offset: 0,
              stageCounts: { new: 1 },
            }),
          });
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ "content-type": "application/json" }),
          json: async () => ({ ok: true }),
        });
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    clearClientAuthState();
  });

  it("renders PilotAutomationPage with real counts and operational readiness warnings", async () => {
    render(
      <AuthSsrProvider value={SSR_AUTH}>
        <QueryClientProvider client={queryClient}>
          <PilotAutomationPage />
        </QueryClientProvider>
      </AuthSsrProvider>,
    );

    expect(screen.getByText("Automation Studio (Pilot)")).toBeInTheDocument();

    // Verify explanatory banner
    expect(
      screen.getByText(/Automatic execution and scheduled delivery are not yet enabled/),
    ).toBeInTheDocument();

    // Verify status labeling (never "Active Automations Running")
    await waitFor(() => {
      expect(screen.getByText("Enabled Configuration")).toBeInTheDocument();
      expect(screen.getByText("Automatic Execution Not Activated")).toBeInTheDocument();
      expect(screen.getByRole("heading", { name: "Hot lead response reminder" })).toBeInTheDocument();
      expect(
        screen.getByText("Enabled (Config only — no automatic runner)"),
      ).toBeInTheDocument();
    });
  });

  it("preserves browser-local storage untouched", async () => {
    const rawLocalBefore = localStorage.getItem("scale-flow-crm-2-demo");

    render(
      <AuthSsrProvider value={SSR_AUTH}>
        <QueryClientProvider client={queryClient}>
          <PilotAutomationPage />
        </QueryClientProvider>
      </AuthSsrProvider>,
    );

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Hot lead response reminder" })).toBeInTheDocument();
    });

    const rawLocalAfter = localStorage.getItem("scale-flow-crm-2-demo");
    expect(rawLocalAfter).toBe(rawLocalBefore);
  });

  it("opens PilotRuleBuilderDialog and displays rule configuration fields", async () => {
    render(
      <AuthSsrProvider value={SSR_AUTH}>
        <QueryClientProvider client={queryClient}>
          <PilotRuleBuilderDialog
            initialRule={null}
            open={true}
            onClose={vi.fn()}
          />
        </QueryClientProvider>
      </AuthSsrProvider>,
    );

    expect(screen.getByText("New Automation Rule")).toBeInTheDocument();
    expect(screen.getByLabelText(/Rule Name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Subject Entity/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Trigger/i)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /2\. IF Conditions Match/i })).toBeInTheDocument();
  });

  it("opens PilotAutomationSimulationModal and displays safe simulation results", async () => {
    render(
      <AuthSsrProvider value={SSR_AUTH}>
        <QueryClientProvider client={queryClient}>
          <PilotAutomationSimulationModal
            rule={MOCK_RULE}
            open={true}
            onClose={vi.fn()}
          />
        </QueryClientProvider>
      </AuthSsrProvider>,
    );

    expect(screen.getByText(/Safe Simulation · Hot lead response reminder/i)).toBeInTheDocument();
    expect(
      screen.getByText(/Business-data-safe simulation with recorded audit history/i),
    ).toBeInTheDocument();

    const runBtn = screen.getByRole("button", { name: /Run Safe Simulation/i });
    await waitFor(() => {
      expect(runBtn).not.toBeDisabled();
    });
    fireEvent.click(runBtn);

    await waitFor(() => {
      expect(
        screen.getByText("Simulation Matched — Proposed Actions Planned"),
      ).toBeInTheDocument();
      expect(
        screen.getByText(/Simulation Passed — Follow-up Was NOT Created/i),
      ).toBeInTheDocument();
      expect(
        screen.getByText(/Verified Zero Business Mutations:/i),
      ).toBeInTheDocument();
    });
  });

  it("opens PilotAutomationRevisionsDrawer and displays immutable version history", async () => {
    render(
      <AuthSsrProvider value={SSR_AUTH}>
        <QueryClientProvider client={queryClient}>
          <PilotAutomationRevisionsDrawer
            ruleId={MOCK_RULE.id}
            ruleName={MOCK_RULE.name}
            open={true}
            onClose={vi.fn()}
          />
        </QueryClientProvider>
      </AuthSsrProvider>,
    );

    expect(screen.getByText("Revision History")).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText("v1")).toBeInTheDocument();
      expect(screen.getByText("Initial rule creation")).toBeInTheDocument();
    });
  });
});
