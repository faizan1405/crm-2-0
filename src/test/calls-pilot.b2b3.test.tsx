import type * as React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PilotFollowUpsPage } from "@/components/pilot/PilotFollowUpsPage";
import { PilotLeadDetailPage } from "@/components/pilot/PilotLeadDetailPage";
import { PilotLeadsPage } from "@/components/pilot/PilotLeadsPage";
import { PilotShell } from "@/components/pilot/PilotShell";
import type { CallLogDto, FollowUpDto, LeadActivityDto, LeadDto } from "@/lib/api/schemas";
import { hydrateAuthFromSsr } from "@/lib/auth/authClient";

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
    select ? select({ location: { pathname: "/leads/lead_srv_1" } }) : "/leads/lead_srv_1",
  useBlocker: () => ({ status: "idle", reset: vi.fn(), proceed: vi.fn() }),
}));

const LOCAL_CRM_KEY = "scale-flow-crm-2-demo";
const LOCAL_CALL_PENDING_KEY = "scale-flow-call-pending";
const LOCAL_CRM_SENTINEL = JSON.stringify({
  state: {
    leads: [{ id: "local_only", name: "Protected Local Client" }],
    calls: [{ id: "local_call", outcome: "Connected" }],
  },
  version: 0,
});
const LOCAL_PENDING_SENTINEL = JSON.stringify({
  leadId: "local_only",
  source: "Leads",
  at: 1700000000000,
});

function makeLead(overrides: Partial<LeadDto> = {}): LeadDto {
  return {
    id: "lead_srv_1",
    legacyId: null,
    name: "Kiran Synthetic",
    phone: "9820001122",
    email: "kiran@synthetic.example",
    company: "Synthetic Craft",
    requirement: "Brand + Web",
    source: "Website",
    status: "new",
    priority: "hot",
    aiScore: 84,
    quotedAmount: 140000,
    budget: 180000,
    pinned: false,
    lifecycleStatus: "active",
    tagIds: [],
    fieldValues: {},
    version: 1,
    createdAt: "2026-11-09T09:00:00.000Z",
    updatedAt: "2026-11-09T09:00:00.000Z",
    ...overrides,
  };
}

function makeCall(overrides: Partial<CallLogDto> = {}): CallLogDto {
  return {
    id: "call_srv_1",
    legacyId: null,
    leadId: "lead_srv_1",
    actorUserId: "usr_owner",
    outcome: "Not picked",
    connected: false,
    recordingSource: "user_recorded",
    dialSource: "Lead detail",
    stageBefore: "new",
    stageAfter: "new",
    quickStatusAfter: "not_picked",
    leadActivityId: "act_call_1",
    at: "2026-11-10T09:00:00.000Z",
    atIst: "2026-11-10T14:30:00+05:30",
    occurredIstDate: "2026-11-10",
    occurredIstTime: "14:30",
    createdAt: "2026-11-10T09:00:00.000Z",
    updatedAt: "2026-11-10T09:00:00.000Z",
    ...overrides,
  };
}

function makeFollowUp(overrides: Partial<FollowUpDto> = {}): FollowUpDto {
  return {
    id: "fu_srv_1",
    legacyId: null,
    leadId: "lead_srv_1",
    type: "call",
    dueAt: "2026-11-11T05:30:00.000Z",
    dueAtIst: "2026-11-11T11:00:00+05:30",
    dueIstDate: "2026-11-11",
    dueIstTime: "11:00",
    note: "Review revised scope",
    status: "pending",
    version: 1,
    createdAt: "2026-11-10T09:00:00.000Z",
    updatedAt: "2026-11-10T09:00:00.000Z",
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
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

function jsonRes(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("B2B3 Server-Backed Call Logging Pilot UI & Honesty Guarantees", () => {
  let getItemSpy: ReturnType<typeof vi.spyOn>;
  let setItemSpy: ReturnType<typeof vi.spyOn>;
  let removeItemSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    window.localStorage.setItem(LOCAL_CRM_KEY, LOCAL_CRM_SENTINEL);
    window.localStorage.setItem(LOCAL_CALL_PENDING_KEY, LOCAL_PENDING_SENTINEL);
    window.sessionStorage.clear();

    getItemSpy = vi.spyOn(Storage.prototype, "getItem");
    setItemSpy = vi.spyOn(Storage.prototype, "setItem");
    removeItemSpy = vi.spyOn(Storage.prototype, "removeItem");

    hydrateAuthFromSsr({
      checked: true,
      authenticated: true,
      user: {
        id: "usr_owner",
        name: "Owner Synthetic",
        email: "owner@synthetic.example",
        roleId: "owner",
      },
      idleExpiresAt: null,
      expiresAt: null,
      leadPilotAvailable: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("opens Call dialog via tel: launcher without auto-saving, logs Not picked while preserving lastContact=Never, and isolates localStorage", async () => {
    let lead = makeLead();
    const calls: CallLogDto[] = [];
    const activities: LeadActivityDto[] = [];
    let callPostCount = 0;

    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (url === "/api/v1/leads/lead_srv_1") {
        return jsonRes({ ok: true, lead });
      }
      if (url.startsWith("/api/v1/leads/lead_srv_1/calls")) {
        const connected = calls.filter((c) => c.connected).length;
        return jsonRes({
          ok: true,
          leadId: "lead_srv_1",
          items: calls,
          total: calls.length,
          limit: 25,
          offset: 0,
          summary: {
            total: calls.length,
            connected,
            attempts: calls.length - connected,
          },
        });
      }
      if (url.startsWith("/api/v1/leads/lead_srv_1/activities")) {
        return jsonRes({
          ok: true,
          leadId: "lead_srv_1",
          items: activities,
          total: activities.length,
          limit: 100,
          offset: 0,
        });
      }
      if (url === "/api/v1/leads/lead_srv_1/follow-ups") {
        return jsonRes({
          ok: true,
          leadId: "lead_srv_1",
          items: [],
          activeFollowUpId: null,
        });
      }
      if (url === "/api/v1/calls" && init?.method === "POST") {
        callPostCount += 1;
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        expect(body["leadId"]).toBe("lead_srv_1");
        expect(body["outcome"]).toBe("Not picked");
        expect(body["dialSource"]).toBe("Lead detail");
        expect(body["expectedLeadVersion"]).toBe(1);

        const created = makeCall({
          outcome: "Not picked",
          connected: false,
          notes: "Rang 5 times",
        });
        calls.unshift(created);
        lead = {
          ...lead,
          quickStatus: "not_picked",
          version: 2,
          // Honesty: Not picked leaves lastContact empty!
        };
        const act: LeadActivityDto = {
          id: "act_call_1",
          legacyId: null,
          leadId: "lead_srv_1",
          actorUserId: "usr_owner",
          type: "call",
          text: "Call attempt (Lead detail): Not picked — Rang 5 times",
          outcome: "Not picked",
          at: created.at,
          createdAt: created.at,
        };
        activities.unshift(act);
        return jsonRes({ ok: true, call: created, lead, activities: [act] }, 201);
      }
      return jsonRes({ ok: false }, 404);
    });
    vi.stubGlobal("fetch", fetchMock);

    renderWithQuery(<PilotLeadDetailPage id="lead_srv_1" />);

    const callLink = await screen.findByRole("link", { name: /Call Kiran Synthetic/i });
    expect(callLink).toHaveAttribute("href", "tel:9820001122");

    // 1. Clicking Call arms tab-scoped recovery in sessionStorage only and never writes localStorage or calls POST /api/v1/calls.
    fireEvent.click(callLink);
    expect(await screen.findByTestId("pilot-call-dialog")).toBeInTheDocument();
    expect(callPostCount).toBe(0);

    // 2. Skip for now closes cleanly with zero API mutations.
    fireEvent.click(screen.getByRole("button", { name: "Skip for now" }));
    await waitFor(() => expect(screen.queryByTestId("pilot-call-dialog")).toBeNull());
    expect(callPostCount).toBe(0);

    // 3. Re-open via Log call, test Won confirmation guard, then pick "Not picked" and save.
    fireEvent.click(screen.getAllByRole("button", { name: "Log call" })[0]!);
    const dialog = await screen.findByTestId("pilot-call-dialog");

    fireEvent.click(within(dialog).getByRole("button", { name: "Won" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Save & close" }));
    expect(await within(dialog).findByText("Confirm the stage change")).toBeInTheDocument();
    expect(callPostCount).toBe(0);

    fireEvent.click(within(dialog).getByRole("button", { name: "Not picked" }));
    fireEvent.change(within(dialog).getByLabelText("Call notes"), {
      target: { value: "Rang 5 times" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save & close" }));

    await waitFor(() => expect(callPostCount).toBe(1));
    await waitFor(() => expect(screen.queryByTestId("pilot-call-dialog")).toBeNull());

    const callsPanel = screen.getByTestId("pilot-lead-calls-panel");
    expect(await within(callsPanel).findByText("User-recorded")).toBeInTheDocument();
    expect(within(callsPanel).getByText("Attempt")).toBeInTheDocument();
    expect(within(callsPanel).getByText(/Rang 5 times/)).toBeInTheDocument();
    expect(screen.getByText("Last contact").parentElement).toHaveTextContent("Last contact—");
    expect(lead.lastContact).toBeUndefined();

    // Assert zero localStorage CRM key or legacy call-pending reads/writes.
    expect(getItemSpy).not.toHaveBeenCalledWith(LOCAL_CRM_KEY);
    expect(setItemSpy).not.toHaveBeenCalledWith(LOCAL_CRM_KEY, expect.anything());
    expect(removeItemSpy).not.toHaveBeenCalledWith(LOCAL_CRM_KEY);
    expect(getItemSpy).not.toHaveBeenCalledWith(LOCAL_CALL_PENDING_KEY);
    expect(setItemSpy).not.toHaveBeenCalledWith(LOCAL_CALL_PENDING_KEY, expect.anything());
    expect(window.localStorage.getItem(LOCAL_CRM_KEY)).toBe(LOCAL_CRM_SENTINEL);
    expect(window.localStorage.getItem(LOCAL_CALL_PENDING_KEY)).toBe(LOCAL_PENDING_SENTINEL);
  });

  it("enforces Won/Lost lostReason, handles Step 1 stale_conflict rebase, and recovers Step 2 503 & 409 followup_conflict without duplicate calls", async () => {
    let lead = makeLead({ version: 1, status: "new" });
    const existingFu = makeFollowUp({ id: "fu_existing", note: "Pre-existing call back" });
    let activeFu: FollowUpDto | null = null;
    let callPostCount = 0;
    let fuPostCount = 0;
    let scenario: "stale_then_ok" | "step2_fail_then_conflict_then_replace" = "stale_then_ok";

    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (url === "/api/v1/leads/lead_srv_1") {
        return jsonRes({ ok: true, lead });
      }
      if (url.startsWith("/api/v1/leads/lead_srv_1/calls")) {
        return jsonRes({
          ok: true,
          leadId: "lead_srv_1",
          items: [],
          total: 0,
          limit: 25,
          offset: 0,
          summary: { total: 0, connected: 0, attempts: 0 },
        });
      }
      if (url.startsWith("/api/v1/leads/lead_srv_1/activities")) {
        return jsonRes({
          ok: true,
          leadId: "lead_srv_1",
          items: [],
          total: 0,
          limit: 100,
          offset: 0,
        });
      }
      if (url === "/api/v1/leads/lead_srv_1/follow-ups") {
        return jsonRes({
          ok: true,
          leadId: "lead_srv_1",
          items: activeFu ? [activeFu] : [],
          activeFollowUpId: activeFu?.id ?? null,
        });
      }
      if (url === "/api/v1/calls" && init?.method === "POST") {
        callPostCount += 1;
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        if (callPostCount === 1 && scenario === "stale_then_ok") {
          lead = makeLead({
            version: 2,
            status: "qualified",
            lastContact: "2026-11-10T08:45:00.000Z",
          });
          return jsonRes(
            {
              ok: false,
              error: {
                code: "stale_conflict",
                message: "Stale lead version",
                conflict: {
                  resource: "lead",
                  id: "lead_srv_1",
                  expectedVersion: 1,
                  currentVersion: 2,
                },
              },
            },
            409,
          );
        }
        expect(body["expectedLeadVersion"]).toBe(2);
        lead = makeLead({
          version: 3,
          status: "proposal",
          quickStatus: "interested",
          lastContact: "2026-11-10T09:15:00.000Z",
        });
        scenario = "step2_fail_then_conflict_then_replace";
        return jsonRes(
          {
            ok: true,
            call: makeCall({
              id: "call_srv_2",
              outcome: "Proposal Sent",
              connected: true,
              stageBefore: "qualified",
              stageAfter: "proposal",
              notes: "Sent deck via email",
            }),
            lead,
            activities: [],
          },
          201,
        );
      }
      if (url === "/api/v1/follow-ups" && init?.method === "POST") {
        fuPostCount += 1;
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        // Note: apiRequest automatically retries transient 503 up to 2 times (attempts 1..3), then surfaces 503.
        if (fuPostCount <= 3) {
          return jsonRes(
            { ok: false, error: { code: "crm_unavailable", message: "DB unavailable" } },
            503,
          );
        }
        if (fuPostCount === 4) {
          activeFu = existingFu;
          return jsonRes(
            {
              ok: false,
              error: {
                code: "followup_conflict",
                message: "Active follow-up already exists",
                conflict: { activeFollowUp: existingFu },
              },
            },
            409,
          );
        }
        expect(body["replaceActiveFollowUpId"]).toBe("fu_existing");
        const replaced = makeFollowUp({ id: "fu_replaced", note: "Follow up on proposal" });
        activeFu = replaced;
        return jsonRes(
          {
            ok: true,
            followUp: replaced,
            replacedFollowUpId: "fu_existing",
            leadNextFollowUp: replaced.dueAt,
            activity: {
              id: "act_fu_rep",
              legacyId: null,
              leadId: "lead_srv_1",
              actorUserId: "usr_owner",
              type: "followup",
              text: "Follow-up replaced (call)",
              at: "2026-11-10T09:16:00.000Z",
              createdAt: "2026-11-10T09:16:00.000Z",
            },
          },
          201,
        );
      }
      return jsonRes({ ok: false }, 404);
    });
    vi.stubGlobal("fetch", fetchMock);

    renderWithQuery(<PilotLeadDetailPage id="lead_srv_1" />);
    fireEvent.click((await screen.findAllByRole("button", { name: "Log call" }))[0]!);
    const dialog = await screen.findByTestId("pilot-call-dialog");

    // 1. Verify Lost requires reason even after confirmation checked.
    fireEvent.click(within(dialog).getByRole("button", { name: "Lost" }));
    fireEvent.click(within(dialog).getByLabelText("Confirm stage change"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Save & close" }));
    expect(await within(dialog).findByText("Add a lost reason")).toBeInTheDocument();

    // 2. Switch to "Proposal Sent" + notes + Schedule follow-up ON -> trigger 409 stale_conflict.
    fireEvent.click(within(dialog).getByRole("button", { name: "Proposal Sent" }));
    fireEvent.change(within(dialog).getByLabelText("Call notes"), {
      target: { value: "Sent deck via email" },
    });
    fireEvent.click(within(dialog).getByRole("switch", { name: /Schedule next follow-up/i }));
    fireEvent.change(within(dialog).getByLabelText("Follow-up note"), {
      target: { value: "Follow up on proposal" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save & close" }));

    expect(await within(dialog).findByTestId("pilot-call-stale-conflict")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Review latest" }));
    expect(
      within(within(dialog).getByTestId("pilot-call-stale-conflict")).getByText("Qualified"),
    ).toBeInTheDocument();

    // Rebase preserves notes & follow-up draft, updates expectedLeadVersion to v2.
    fireEvent.click(
      within(dialog).getByRole("button", { name: /Keep my call log & rebase onto v2/i }),
    );
    expect((within(dialog).getByLabelText("Call notes") as HTMLTextAreaElement).value).toBe(
      "Sent deck via email",
    );

    // 3. Re-submit -> Step 1 succeeds (201, callPostCount === 2), Step 2 hits 503 after retries.
    fireEvent.click(within(dialog).getByRole("button", { name: "Save & close" }));
    expect(await within(dialog).findByTestId("pilot-call-step1-saved")).toBeInTheDocument();
    expect(
      await within(dialog).findByTestId("pilot-call-step2-error", {}, { timeout: 3000 }),
    ).toBeInTheDocument();
    expect(callPostCount).toBe(2);

    // 4. Click Retry follow-up only -> triggers 409 followup_conflict WITHOUT duplicating Step 1!
    fireEvent.click(within(dialog).getByRole("button", { name: "Retry follow-up only" }));
    expect(await within(dialog).findByTestId("pilot-call-step2-conflict")).toBeInTheDocument();
    expect(within(dialog).getByText("Pre-existing call back")).toBeInTheDocument();
    expect(callPostCount).toBe(2);

    // 5. Click Replace with new -> completes Step 2 ONLY, still callPostCount === 2!
    fireEvent.click(within(dialog).getByRole("button", { name: "Replace with new" }));
    await waitFor(() => expect(screen.queryByTestId("pilot-call-dialog")).toBeNull());
    expect(callPostCount).toBe(2);
  });

  it("renders active tel: dialer + Log call across Leads Workspace, Cards, Ledger, Follow-ups & clears session pending key on exit", async () => {
    const serverLead = makeLead({ id: "lead_1", name: "Rohan Pilot", phone: "9811112233" });
    const archivedLead = makeLead({
      id: "lead_arch",
      name: "Archived Lead",
      lifecycleStatus: "waste",
    });

    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url === "/api/v1/leads/lead_arch") {
        return jsonRes({ ok: true, lead: archivedLead });
      }
      if (url.includes("lifecycle=waste") || url.includes("lifecycle=deleted")) {
        return jsonRes({
          ok: true,
          items: [],
          total: 0,
          limit: 1,
          offset: 0,
          stageCounts: { all: 0 },
        });
      }
      if (
        url.startsWith("/api/v1/leads/lead_1/calls") ||
        url.startsWith("/api/v1/leads/lead_arch/calls")
      ) {
        return jsonRes({
          ok: true,
          leadId: "lead_1",
          items: [],
          total: 0,
          limit: 25,
          offset: 0,
          summary: { total: 0, connected: 0, attempts: 0 },
        });
      }
      if (url.includes("/activities")) {
        return jsonRes({ ok: true, leadId: "lead_1", items: [], total: 0, limit: 7, offset: 0 });
      }
      if (url.includes("/follow-ups?")) {
        return jsonRes({
          ok: true,
          items: [
            {
              ...makeFollowUp({ id: "fu_1", leadId: "lead_1" }),
              bucket: "today",
              lead: {
                id: serverLead.id,
                name: serverLead.name,
                phone: serverLead.phone,
                status: serverLead.status,
                priority: serverLead.priority,
                lifecycleStatus: serverLead.lifecycleStatus,
              },
            },
          ],
          total: 1,
          limit: 50,
          offset: 0,
          summary: { overdue: 0, today: 1, upcoming: 0, done: 0, pending: 1 },
        });
      }
      if (url.endsWith("/follow-ups")) {
        return jsonRes({ ok: true, leadId: "lead_1", items: [], activeFollowUpId: null });
      }
      return jsonRes({
        ok: true,
        items: [serverLead],
        total: 1,
        limit: 50,
        offset: 0,
        stageCounts: { all: 1, new: 1, contacted: 0, qualified: 0, proposal: 0, won: 0, lost: 0 },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    // Archived lead detail disables both tel: dialer and Log call
    renderWithQuery(<PilotLeadDetailPage id="lead_arch" />);
    const archCallLink = await screen.findByLabelText("Call Archived Lead");
    expect(archCallLink).not.toHaveAttribute("href");
    expect(archCallLink).toHaveAttribute("aria-disabled", "true");
    expect(screen.getAllByRole("button", { name: "Log call" })[0]).toBeDisabled();

    // Active Leads Workspace, Cards & Ledger
    renderWithQuery(<PilotLeadsPage search={{ pilot: 1 }} />);
    expect(await screen.findByLabelText("Call Rohan Pilot")).toHaveAttribute(
      "href",
      "tel:9811112233",
    );

    fireEvent.click(screen.getByRole("button", { name: "cards view" }));
    expect(await screen.findByRole("button", { name: "Log call for Rohan Pilot" })).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: "table view" }));
    const ledgerPhoneLink = await screen.findByRole("link", { name: "9811112233" });
    expect(ledgerPhoneLink).toHaveAttribute("href", "tel:9811112233");

    // Follow-ups card actions
    renderWithQuery(<PilotFollowUpsPage />);
    expect(
      await screen.findByText(/only connected call logs update Last contact/i),
    ).toBeInTheDocument();

    // Exit Pilot clears sessionStorage pending dialer state
    window.sessionStorage.setItem(
      "sf-b2b3-pilot-call-pending",
      JSON.stringify({ leadId: "lead_1" }),
    );
    const { container } = renderWithQuery(
      <PilotShell title="Exit Check">
        <div>ok</div>
      </PilotShell>,
    );
    await waitFor(() =>
      expect(
        within(container).getAllByRole("button", { name: "Exit Pilot Mode" }),
      ).not.toHaveLength(0),
    );
    fireEvent.click(within(container).getAllByRole("button", { name: "Exit Pilot Mode" })[0]!);
    expect(window.sessionStorage.getItem("sf-b2b3-pilot-call-pending")).toBeNull();
  });
});
