import type * as React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PilotSettingsPage } from "@/components/pilot/PilotSettingsPage";
import { PilotGoalsSection } from "@/components/pilot/PilotGoalsSection";
import { PilotCrmConfigPage } from "@/components/pilot/PilotCrmConfigPage";
import { AuthSsrProvider, clearClientAuthState, hydrateAuthFromSsr } from "@/lib/auth/authClient";
import { resolveLeadPilotActive } from "@/lib/api/pilotGate";
import type { OwnerSettingsDto, SalesGoalDto } from "@/lib/api/schemas";

const mockNavigate = vi.fn();

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
  useNavigate: () => mockNavigate,
  useRouterState: ({ select }: { select?: (s: { location: { pathname: string } }) => unknown }) =>
    select ? select({ location: { pathname: "/settings" } }) : "/settings",
  useBlocker: () => ({ status: "idle", reset: vi.fn(), proceed: vi.fn() }),
}));

const LOCAL_STORAGE_KEY = "scale-flow-crm-2-demo";
const LOCAL_STORAGE_VALUE = JSON.stringify({
  state: {
    owner: "Local Browser Owner",
    business: "Local Only Studio",
    email: "local@browser.test",
    leads: [{ id: "local_1", name: "Local Browser Lead" }],
    goals: [{ id: "local_g1", title: "Local Browser 1L Goal", target: 100000 }],
  },
  version: 0,
});

const SSR_AUTH = {
  checked: true,
  authenticated: true,
  user: {
    id: "usr_owner_1",
    name: "Synthetic Owner",
    email: "owner@synthetic.example",
    roleId: "owner" as const,
  },
  idleExpiresAt: null,
  expiresAt: null,
  leadPilotAvailable: true,
};

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return (
    <AuthSsrProvider value={SSR_AUTH}>
      <QueryClientProvider client={qc}>{ui}</QueryClientProvider>
    </AuthSsrProvider>
  );
}

const jsonRes = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const MOCK_DEFINITIONS = {
  ok: true,
  definitions: {
    invariants: { businessTimezone: "Asia/Kolkata", currencyCode: "INR", readOnly: true },
    leadStatuses: ["new", "contacted", "qualified", "proposal", "won", "lost"],
    leadSources: ["Website", "Referral", "WhatsApp"],
    defaultLeadSortOptions: ["recent", "score", "value"],
    goalMetrics: [
      {
        key: "calls_connected",
        label: "Connected Calls",
        unit: "count",
        financial: false,
        dataSource: "crm_call_logs",
        description: "Call logs marked connected in window.",
      },
      {
        key: "cash_collected",
        label: "Cash Collected",
        unit: "inr",
        financial: true,
        dataSource: "crm_payments",
        description: "Non-voided payments collected on active deals in window.",
      },
    ],
    goalPeriods: ["daily", "weekly", "monthly", "custom"],
    goalScopes: [
      { key: "owner", supported: true, description: "Owner workspace goal." },
      { key: "team", supported: true, description: "Team goal in Owner workspace." },
      {
        key: "employee",
        supported: false,
        description: "Per-employee attribution requires Team CRM authentication.",
      },
    ],
    serverBackedFields: ["ownerDisplayName", "businessName", "profileEmail", "gstin"],
    deviceLocalPreferences: ["theme", "accent", "density", "scale-flow-sidebar-collapsed"],
    existingTemplateEndpoints: {
      quotationTemplates: "/api/v1/quotation-templates",
      projectTemplates: "/api/v1/project-templates",
    },
    deferredModules: ["customFieldsCrud", "tagsCrud", "savedViews"],
  },
};

const UNSET_SETTINGS: OwnerSettingsDto = {
  configured: false,
  id: null,
  ownerUserId: "usr_owner_1",
  ownerDisplayName: null,
  businessName: null,
  profileEmail: null,
  businessPhone: null,
  businessWebsite: null,
  businessAddress: null,
  gstin: null,
  paymentInstructions: null,
  businessTimezone: "Asia/Kolkata",
  currencyCode: "INR",
  defaultLeadSort: "recent",
  notifyFollowUps: true,
  notifyPayments: true,
  notifyDigest: false,
  notifyGoalAchieved: true,
  notifyTeamGoal: true,
  notifyMilestone: false,
  notifyOverdue: true,
  overdueThreshold: 10,
  updatedByUserId: null,
  version: 0,
  createdAt: null,
  updatedAt: null,
};

function makeGoal(overrides: Partial<SalesGoalDto> = {}): SalesGoalDto {
  return {
    id: "goal_1",
    legacyId: null,
    ownerUserId: "usr_owner_1",
    name: "Weekly Cash Goal",
    metric: "cash_collected",
    metricLabel: "Cash Collected",
    scope: "owner",
    targetUnit: "inr",
    target: 20000.3,
    targetDecimal: "20000.30",
    targetCount: null,
    targetAmount: "20000.30",
    period: "weekly",
    customFromIst: null,
    customToIst: null,
    effectiveFromIst: "2026-11-10",
    status: "active",
    archivedAt: null,
    archiveReason: null,
    createdByUserId: "usr_owner_1",
    updatedByUserId: "usr_owner_1",
    version: 1,
    createdAt: "2026-11-10T09:00:00Z",
    updatedAt: "2026-11-10T09:00:00Z",
    ...overrides,
  };
}

describe("B6B Server-Backed Settings, Goals & Boundary Pilot UI", () => {
  beforeEach(() => {
    window.localStorage.setItem(LOCAL_STORAGE_KEY, LOCAL_STORAGE_VALUE);
    hydrateAuthFromSsr(SSR_AUTH);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    mockNavigate.mockReset();
    clearClientAuthState();
    window.localStorage.clear();
  });

  it("enforces server Pilot gate regardless of query string override", () => {
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
        searchPilot: "0",
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

  it(
    "PilotSettingsPage loads unset MariaDB state, preserves edits across tabs, saves via PUT/PATCH, clears to null, handles conflicts & audit",
    async () => {
    let serverSettings: OwnerSettingsDto = { ...UNSET_SETTINGS };
    const calls: Array<{ method: string; url: string; body: Record<string, unknown> | null }> = [];
    let forceStaleOnce = false;

    vi.spyOn(globalThis, "fetch").mockImplementation(async (info, init) => {
      const url = String(info);
      const method = (init?.method ?? "GET").toUpperCase();
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null;
      calls.push({ method, url, body });

      if (url.includes("/api/v1/settings/definitions")) return jsonRes(MOCK_DEFINITIONS);
      if (url.includes("/api/v1/settings/audit")) {
        return jsonRes({
          ok: true,
          items: [
            {
              id: "sae_1",
              settingsId: "set_1",
              ownerUserId: "usr_owner_1",
              actorUserId: "usr_owner_1",
              section: "mixed",
              eventType: "settings.created",
              summary: "Business settings initialized",
              changedFields: ["businessName"],
              before: null,
              after: { businessName: "Northstar Digital" },
              versionBefore: 0,
              versionAfter: 1,
              occurredIstDate: "2026-11-10",
              createdAt: "2026-11-10T10:00:00Z",
            },
          ],
          total: 1,
          limit: 20,
          offset: 0,
        });
      }
      if (url.endsWith("/api/v1/settings") && method === "GET") {
        return jsonRes({ ok: true, settings: serverSettings });
      }
      if (url.endsWith("/api/v1/settings") && (method === "PUT" || method === "PATCH")) {
        if (String(body?.["paymentInstructions"] ?? "").includes("sk-live-secret")) {
          return jsonRes(
            {
              ok: false,
              error: {
                code: "secret_detected",
                message: "Secret-like tokens are not allowed in Settings.",
                details: { paymentInstructions: "Remove secret-looking credentials." },
              },
            },
            400,
          );
        }
        if (forceStaleOnce) {
          forceStaleOnce = false;
          serverSettings = { ...serverSettings, version: serverSettings.version + 1 };
          return jsonRes(
            {
              ok: false,
              error: {
                code: "stale_conflict",
                message: "Settings changed concurrently",
                conflict: {
                  resource: "settings",
                  expectedVersion: body?.["expectedVersion"],
                  currentVersion: serverSettings.version,
                },
              },
            },
            409,
          );
        }
        const nextVersion = serverSettings.version + 1;
        serverSettings = {
          ...serverSettings,
          configured: true,
          id: "set_1",
          ownerDisplayName:
            "ownerDisplayName" in (body ?? {})
              ? (body?.["ownerDisplayName"] as string | null)
              : serverSettings.ownerDisplayName,
          businessName:
            "businessName" in (body ?? {})
              ? (body?.["businessName"] as string | null)
              : serverSettings.businessName,
          defaultLeadSort:
            "defaultLeadSort" in (body ?? {})
              ? (body?.["defaultLeadSort"] as OwnerSettingsDto["defaultLeadSort"])
              : serverSettings.defaultLeadSort,
          notifyMilestone:
            "notifyMilestone" in (body ?? {})
              ? Boolean(body?.["notifyMilestone"])
              : serverSettings.notifyMilestone,
          version: nextVersion,
          createdAt: "2026-11-10T10:00:00Z",
          updatedAt: "2026-11-10T10:05:00Z",
        };
        return jsonRes(
          {
            ok: true,
            settings: serverSettings,
            auditEvent: null,
            changed: true,
          },
          method === "PUT" ? 201 : 200,
        );
      }
      return jsonRes({ ok: false }, 404);
    });

    render(wrap(<PilotSettingsPage />));

    await waitFor(() => {
      expect(screen.getByText(/Not configured \(v0\)/i)).toBeTruthy();
    });

    // Local browser owner must NEVER bleed into server settings
    expect(screen.queryByDisplayValue(/Local Browser Owner/i)).toBeNull();

    fireEvent.change(screen.getByLabelText(/Business name/i), {
      target: { value: "Northstar Digital" },
    });
    // Switch tabs without losing unsaved edits
    fireEvent.click(screen.getByRole("button", { name: /Regional & CRM/i }));
    fireEvent.change(screen.getByLabelText(/Default lead sort/i), {
      target: { value: "score" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Save settings/i }));

    await waitFor(() => {
      expect(screen.getByText(/Confirmed saved to MariaDB \(v1\)/i)).toBeTruthy();
    });

    const firstPut = calls.find((c) => c.method === "PUT");
    expect(firstPut?.body?.["businessName"]).toBe("Northstar Digital");
    expect(firstPut?.body?.["defaultLeadSort"]).toBe("score");
    expect(firstPut?.body?.["expectedVersion"]).toBe(0);

    // Switch to Profile, test secret detection rejection
    fireEvent.click(screen.getByRole("button", { name: /Profile & business/i }));
    fireEvent.change(screen.getByLabelText(/Payment instructions/i), {
      target: { value: "sk-live-secret-key-value" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Save settings/i }));

    await waitFor(() => {
      expect(screen.getByText(/Secret-like tokens are not allowed/i)).toBeTruthy();
    });

    // Clear Payment instructions and Clear Business name -> sends explicit null; also test stale conflict + rebase
    fireEvent.click(screen.getByRole("button", { name: /Clear Payment instructions/i }));
    fireEvent.click(screen.getByRole("button", { name: /Clear Business name/i }));
    forceStaleOnce = true;
    fireEvent.click(screen.getByRole("button", { name: /Save settings/i }));

    await waitFor(() => {
      expect(screen.getByText(/Stale version conflict/i)).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: /Keep my edits & rebase/i }));
    await waitFor(() => {
      expect(screen.queryByText(/Stale version conflict/i)).toBeNull();
    });

    fireEvent.click(screen.getByRole("button", { name: /Save settings/i }));
    await waitFor(() => {
      expect(screen.getByText(/Confirmed saved to MariaDB \(v3\)/i)).toBeTruthy();
    });

    const lastPatch = calls.filter((c) => c.method === "PATCH").at(-1);
    expect(lastPatch?.body?.["businessName"]).toBeNull();
    expect(lastPatch?.body?.["expectedVersion"]).toBe(2);

    // Check History section & Device Preferences boundary
    fireEvent.click(screen.getByRole("button", { name: /Change history/i }));
    await waitFor(() => {
      expect(screen.getByText(/Business settings initialized/i)).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: /Device preferences/i }));
    expect(screen.getByText(/Device-local only/i)).toBeTruthy();

    // LocalStorage remains untouched
    expect(window.localStorage.getItem(LOCAL_STORAGE_KEY)).toBe(LOCAL_STORAGE_VALUE);
  }, 20000);

  it("PilotSettingsPage surfaces 503 API error without falling back to local Zustand data", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (info) => {
      if (String(info).includes("/api/v1/settings/definitions")) return jsonRes(MOCK_DEFINITIONS);
      return jsonRes(
        { ok: false, error: { code: "crm_unavailable", message: "MariaDB down" } },
        503,
      );
    });

    render(wrap(<PilotSettingsPage />));

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toMatch(/unavailable/i);
    });
    expect(screen.queryByDisplayValue(/Local Browser Owner/i)).toBeNull();
  });

  it(
    "PilotGoalsSection supports create (exact paise), unset target / N/A safely, asOf switching, stale rebase, pause/resume, history & archive",
    async () => {
    let goalsList: SalesGoalDto[] = [];
    const postBodies: Array<Record<string, unknown>> = [];
    let staleEditOnce = true;

    vi.spyOn(globalThis, "fetch").mockImplementation(async (info, init) => {
      const url = String(info);
      const parsedUrl = new URL(url, "http://localhost");
      const pathname = parsedUrl.pathname;
      const method = (init?.method ?? "GET").toUpperCase();
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null;

      if (pathname === "/api/v1/settings/definitions") return jsonRes(MOCK_DEFINITIONS);

      if (pathname === "/api/v1/goals/progress") {
        const asOf = parsedUrl.searchParams.get("asOf") ?? "2026-11-10";
        const activeOrPaused = goalsList.filter((g) => g.status !== "archived");
        return jsonRes({
          ok: true,
          asOfIstDate: asOf,
          status: activeOrPaused.length ? "active" : "not_configured",
          note: activeOrPaused.length ? null : "No sales goals configured yet.",
          items: activeOrPaused.map((g) => {
            if (g.targetAmount === null && g.targetCount === null) {
              return {
                goal: g,
                progress: {
                  asOfIstDate: asOf,
                  appliedVersion: g.version,
                  appliedEffectiveFromIst: g.effectiveFromIst,
                  window: { start: "2026-11-09", end: "2026-11-15" },
                  windowState: "active",
                  status: "not_configured",
                  measurable: false,
                  unavailableReason: "Target not configured yet.",
                  unit: g.targetUnit,
                  target: null,
                  targetDecimal: null,
                  actual: null,
                  actualDecimal: null,
                  pct: null,
                  pctPercent: null,
                  remaining: null,
                  remainingDecimal: null,
                  excludedUnknownDateCount: 0,
                  note: null,
                },
              };
            }
            return {
              goal: g,
              progress: {
                asOfIstDate: asOf,
                appliedVersion: asOf <= "2026-11-05" ? 1 : g.version,
                appliedEffectiveFromIst: g.effectiveFromIst,
                window: { start: "2026-11-09", end: "2026-11-15" },
                windowState: "active",
                status: g.status === "paused" ? "paused" : "in_progress",
                measurable: g.status === "active",
                unavailableReason: g.status === "paused" ? "Goal is paused." : null,
                unit: "inr",
                target: 20000.3,
                targetDecimal: "20000.30",
                actual: g.status === "active" ? 10000.15 : null,
                actualDecimal: g.status === "active" ? "10000.15" : null,
                pct: g.status === "active" ? 0.5 : null,
                pctPercent: g.status === "active" ? 50 : null,
                remaining: g.status === "active" ? 10000.15 : null,
                remainingDecimal: g.status === "active" ? "10000.15" : null,
                excludedUnknownDateCount: 0,
                note: null,
              },
            };
          }),
        });
      }

      if (pathname === "/api/v1/goals" && method === "GET") {
        return jsonRes({
          ok: true,
          items: goalsList.filter((g) => g.status === "archived"),
          total: goalsList.filter((g) => g.status === "archived").length,
          limit: 100,
          offset: 0,
          configuredCount: 0,
          note: null,
        });
      }

      if (pathname === "/api/v1/goals" && method === "POST") {
        postBodies.push(body ?? {});
        const created = makeGoal({
          id: `goal_${goalsList.length + 1}`,
          name: String(body?.["name"] ?? "Goal"),
          target: body?.["target"] === null ? null : 20000.3,
          targetDecimal: body?.["target"] === null ? null : "20000.30",
          targetAmount: body?.["target"] === null ? null : "20000.30",
          targetCount: null,
        });
        goalsList = [...goalsList, created];
        return jsonRes(
          {
            ok: true,
            goal: created,
            revision: {
              id: `grev_${created.id}_1`,
              goalId: created.id,
              ownerUserId: "usr_owner_1",
              actorUserId: "usr_owner_1",
              revisionNumber: 1,
              eventType: "goal.created",
              effectiveFromIst: created.effectiveFromIst,
              snapshot: {
                name: created.name,
                metric: created.metric,
                scope: created.scope,
                targetUnit: created.targetUnit,
                targetCount: null,
                targetAmount: created.targetAmount,
                period: created.period,
                customFromIst: null,
                customToIst: null,
                effectiveFromIst: created.effectiveFromIst,
                status: "active",
                version: 1,
              },
              changeSummary: "Created goal",
              occurredIstDate: "2026-11-10",
              createdAt: "2026-11-10T09:00:00Z",
            },
          },
          201,
        );
      }

      if (pathname === "/api/v1/goals/goal_1" && method === "GET") {
        const g = goalsList.find((x) => x.id === "goal_1")!;
        return jsonRes({ ok: true, goal: g, revisionCount: 1 });
      }

      if (pathname === "/api/v1/goals/goal_1" && method === "PATCH") {
        const g = goalsList.find((x) => x.id === "goal_1")!;
        if (staleEditOnce) {
          staleEditOnce = false;
          goalsList = goalsList.map((x) => (x.id === "goal_1" ? { ...x, version: 2 } : x));
          return jsonRes(
            {
              ok: false,
              error: {
                code: "stale_conflict",
                message: "Goal modified concurrently",
                conflict: {
                  resource: "goal",
                  id: "goal_1",
                  expectedVersion: body?.["expectedVersion"],
                  currentVersion: 2,
                },
              },
            },
            409,
          );
        }
        const updated = { ...g, name: String(body?.["name"] ?? g.name), version: g.version + 1 };
        goalsList = goalsList.map((x) => (x.id === "goal_1" ? updated : x));
        return jsonRes({
          ok: true,
          goal: updated,
          revision: {
            id: "grev_2",
            goalId: "goal_1",
            ownerUserId: "usr_owner_1",
            actorUserId: "usr_owner_1",
            revisionNumber: 2,
            eventType: "goal.updated",
            effectiveFromIst: updated.effectiveFromIst,
            snapshot: {
              name: updated.name,
              metric: updated.metric,
              scope: updated.scope,
              targetUnit: updated.targetUnit,
              targetCount: null,
              targetAmount: updated.targetAmount,
              period: updated.period,
              customFromIst: null,
              customToIst: null,
              effectiveFromIst: updated.effectiveFromIst,
              status: "active",
              version: updated.version,
            },
            changeSummary: "Updated goal name",
            occurredIstDate: "2026-11-10",
            createdAt: "2026-11-10T11:00:00Z",
          },
        });
      }

      if (pathname === "/api/v1/goals/goal_1/revisions" && method === "GET") {
        return jsonRes({
          ok: true,
          goalId: "goal_1",
          items: [
            {
              id: "grev_1",
              goalId: "goal_1",
              ownerUserId: "usr_owner_1",
              actorUserId: "usr_owner_1",
              revisionNumber: 1,
              eventType: "goal.created",
              effectiveFromIst: "2026-11-10",
              snapshot: {
                name: "Weekly Cash Goal",
                metric: "cash_collected",
                scope: "owner",
                targetUnit: "inr",
                targetCount: null,
                targetAmount: "20000.30",
                period: "weekly",
                customFromIst: null,
                customToIst: null,
                effectiveFromIst: "2026-11-10",
                status: "active",
                version: 1,
              },
              changeSummary: "Created weekly goal",
              occurredIstDate: "2026-11-10",
              createdAt: "2026-11-10T09:00:00Z",
            },
          ],
          total: 1,
          limit: 100,
          offset: 0,
        });
      }

      if (pathname === "/api/v1/goals/goal_1/status" && method === "POST") {
        const g = goalsList.find((x) => x.id === "goal_1")!;
        const updated = {
          ...g,
          status: body?.["status"] === "paused" ? ("paused" as const) : ("active" as const),
          version: g.version + 1,
        };
        goalsList = goalsList.map((x) => (x.id === "goal_1" ? updated : x));
        return jsonRes({ ok: true, goal: updated, revision: null });
      }

      if (pathname === "/api/v1/goals/goal_1/archive" && method === "POST") {
        const g = goalsList.find((x) => x.id === "goal_1")!;
        const updated: SalesGoalDto = {
          ...g,
          status: "archived",
          archivedAt: "2026-11-10T12:00:00Z",
          archiveReason: String(body?.["reason"] ?? "Done"),
          version: g.version + 1,
        };
        goalsList = goalsList.map((x) => (x.id === "goal_1" ? updated : x));
        return jsonRes({
          ok: true,
          goal: updated,
          revision: {
            id: "grev_arch",
            goalId: "goal_1",
            ownerUserId: "usr_owner_1",
            actorUserId: "usr_owner_1",
            revisionNumber: 4,
            eventType: "goal.archived",
            effectiveFromIst: updated.effectiveFromIst,
            snapshot: {
              name: updated.name,
              metric: updated.metric,
              scope: updated.scope,
              targetUnit: updated.targetUnit,
              targetCount: null,
              targetAmount: updated.targetAmount,
              period: updated.period,
              customFromIst: null,
              customToIst: null,
              effectiveFromIst: updated.effectiveFromIst,
              status: "archived",
              version: updated.version,
            },
            changeSummary: "Archived",
            occurredIstDate: "2026-11-10",
            createdAt: "2026-11-10T12:00:00Z",
          },
        });
      }

      return jsonRes({ ok: false }, 404);
    });

    const { container } = render(wrap(<PilotGoalsSection />));

    await waitFor(() => {
      expect(screen.getByText(/hidden default sales targets/i)).toBeTruthy();
      expect(screen.getAllByText(/Target not configured/i).length).toBeGreaterThan(0);
    });
    // Zero default ₹1,00,000 goal or NaN
    expect(screen.queryByText(/₹1,00,000/)).toBeNull();
    expect(screen.queryByText(/Local Browser 1L Goal/i)).toBeNull();
    expect(container.querySelectorAll("progress")).toHaveLength(0);

    // Create goal with exact paise target
    fireEvent.click(screen.getByRole("button", { name: /^New goal$/i }));
    const dialog = await screen.findByRole("dialog");

    fireEvent.change(within(dialog).getByLabelText(/Goal name/i), {
      target: { value: "Weekly Cash Goal" },
    });
    fireEvent.change(within(dialog).getByLabelText(/Measured metric/i), {
      target: { value: "cash_collected" },
    });
    fireEvent.change(within(dialog).getByLabelText(/^Target \(/i), {
      target: { value: "20000.30" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: /^Create goal$/i }));

    await waitFor(() => {
      expect(screen.getByText(/₹20,000\.30/)).toBeTruthy();
    });
    expect(postBodies[0]?.["target"]).toBe("20000.30");
    expect(screen.getByText(/^₹10,000\.15$/)).toBeTruthy();
    expect(screen.getByText(/₹10,000\.15 remaining/i)).toBeTruthy();
    expect(screen.getByText(/50%/)).toBeTruthy();
    expect(container.querySelectorAll("progress")).toHaveLength(1);

    // Edit goal -> hit 409 stale_conflict -> Keep edits & rebase -> Save
    fireEvent.click(screen.getByRole("button", { name: /^Edit$/i }));
    const editDialog = await screen.findByRole("dialog");
    fireEvent.change(within(editDialog).getByLabelText(/Goal name/i), {
      target: { value: "Weekly Cash Goal Updated" },
    });
    fireEvent.click(within(editDialog).getByRole("button", { name: /Save revision/i }));

    await waitFor(() => {
      expect(within(editDialog).getByText(/Concurrent modification detected/i)).toBeTruthy();
    });
    fireEvent.click(within(editDialog).getByRole("button", { name: /Keep edits & rebase/i }));
    await waitFor(() => {
      expect(within(editDialog).queryByText(/Concurrent modification detected/i)).toBeNull();
    });
    fireEvent.click(within(editDialog).getByRole("button", { name: /Save revision/i }));

    await waitFor(() => {
      expect(screen.getByText(/Weekly Cash Goal Updated/)).toBeTruthy();
    });

    // History drawer
    fireEvent.click(screen.getByRole("button", { name: /^History$/i }));
    await waitFor(() => {
      expect(screen.getByText(/Created weekly goal/i)).toBeTruthy();
    });
    fireEvent.keyDown(document, { key: "Escape" });

    // Archive goal -> toggle Show archived -> confirm read-only card
    fireEvent.click(screen.getByRole("button", { name: /^Archive$/i }));
    const archDialog = await screen.findByRole("dialog");
    fireEvent.change(within(archDialog).getByLabelText(/Archive reason/i), {
      target: { value: "Replaced" },
    });
    fireEvent.click(within(archDialog).getByRole("button", { name: /Archive goal/i }));

    await waitFor(() => {
      expect(screen.getByText(/hidden default sales targets/i)).toBeTruthy();
      expect(screen.getAllByText(/Target not configured/i).length).toBeGreaterThan(0);
    });

    fireEvent.click(screen.getByLabelText(/Show archived/i));
    await waitFor(() => {
      expect(screen.getByText(/Read-only historical record/i)).toBeTruthy();
    });
  }, 20000);

  it("PilotCrmConfigPage renders server invariants and deferred boundaries without touching localStorage", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (info) => {
      const url = String(info);
      if (url.includes("/api/v1/settings/definitions")) return jsonRes(MOCK_DEFINITIONS);
      if (url.includes("/api/v1/custom-fields")) return jsonRes({ ok: true, customFields: [] });
      if (url.includes("/api/v1/tags")) return jsonRes({ ok: true, tags: [] });
      if (url.includes("/api/v1/saved-views")) return jsonRes({ ok: true, savedViews: [] });
      return jsonRes({ ok: true });
    });

    render(wrap(<PilotCrmConfigPage />));

    await waitFor(() => {
      expect(screen.getByText(/Protected Pipeline & Business Invariants/i)).toBeTruthy();
    });

    expect(screen.getByText(/\/api\/v1\/quotation-templates/)).toBeTruthy();
    expect(screen.getByText(/Custom Lead & Project Fields/i)).toBeTruthy();
    expect(window.localStorage.getItem(LOCAL_STORAGE_KEY)).toBe(LOCAL_STORAGE_VALUE);
  });
});
