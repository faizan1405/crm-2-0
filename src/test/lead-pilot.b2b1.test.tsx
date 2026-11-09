import type * as React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PilotAddLeadDialog } from "@/components/pilot/PilotAddLeadDialog";
import { PilotLeadDetailPage } from "@/components/pilot/PilotLeadDetailPage";
import { PilotLeadsBinPage } from "@/components/pilot/PilotLeadsBinPage";
import { PilotLeadsPage } from "@/components/pilot/PilotLeadsPage";
import { setLeadPilotSessionOptIn, type PilotParamValue } from "@/lib/api/pilotGate";
import { useLeadPilotState } from "@/lib/api/pilotHook";
import type { LeadActivityDto, LeadDto } from "@/lib/api/schemas";
import { AuthSsrProvider, hydrateAuthFromSsr, useAuthStore } from "@/lib/auth/authClient";

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
    select ? select({ location: { pathname: "/leads" } }) : "/leads",
  useBlocker: () => ({ status: "idle", reset: vi.fn(), proceed: vi.fn() }),
}));

const LOCAL_SENTINEL_KEY = "scale-flow-crm-2-demo";
const LOCAL_SENTINEL_VALUE = JSON.stringify({
  state: { leads: [{ id: "local_sentinel_1", name: "Local Protected Owner Lead" }] },
  version: 0,
});

function makeLead(overrides: Partial<LeadDto> = {}): LeadDto {
  return {
    id: "lead_srv_1",
    legacyId: null,
    name: "Neha Synthetic",
    phone: "9811112233",
    email: "neha@synthetic.example",
    company: "Synthetic Exports",
    requirement: "3D Website",
    source: "Website",
    status: "new",
    priority: "hot",
    aiScore: 82,
    quotedAmount: 75000,
    budget: 90000,
    notes: "Initial discovery note",
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

function makeActivity(overrides: Partial<LeadActivityDto> = {}): LeadActivityDto {
  return {
    id: "act_srv_1",
    legacyId: null,
    leadId: "lead_srv_1",
    actorUserId: "usr_owner",
    type: "created",
    text: "Lead created",
    at: "2026-11-09T09:00:00.000Z",
    createdAt: "2026-11-09T09:00:00.000Z",
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

describe("B2B1 Lead Pilot UI & Storage Isolation", () => {
  let getItemSpy: ReturnType<typeof vi.spyOn>;
  let setItemSpy: ReturnType<typeof vi.spyOn>;
  let removeItemSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    window.localStorage.setItem(LOCAL_SENTINEL_KEY, LOCAL_SENTINEL_VALUE);
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
    useAuthStore.setState({
      status: "unknown",
      user: null,
      idleExpiresAt: null,
      expiresAt: null,
      leadPilotAvailable: false,
      lastCheckedAt: null,
    });
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("ignores ?pilot=1 and sessionStorage whenever server leadPilotAvailable is false", () => {
    setLeadPilotSessionOptIn(true);
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
      leadPilotAvailable: false,
    });

    const { result } = renderHook(() => useLeadPilotState("1"));
    expect(result.current.leadPilotAvailable).toBe(false);
    expect(result.current.pilotActive).toBe(false);
  });

  it("resolves pilot from AuthSsrProvider on SSR & Commit #1 without mounting local CRM", () => {
    function EntryProbe({ searchPilot }: { searchPilot?: PilotParamValue }) {
      const { pilotActive, pilotResolved } = useLeadPilotState(searchPilot);
      if (pilotActive) return <span>PILOT</span>;
      if (!pilotResolved) return <span>SKELETON</span>;
      return <span>LOCAL</span>;
    }

    useAuthStore.setState({
      status: "unknown",
      user: null,
      idleExpiresAt: null,
      expiresAt: null,
      leadPilotAvailable: false,
      lastCheckedAt: null,
    });

    const ssrSnapshot = {
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

    const ssrWithParam = renderToString(
      <AuthSsrProvider value={ssrSnapshot}>
        <EntryProbe searchPilot="1" />
      </AuthSsrProvider>,
    );
    expect(ssrWithParam).toContain("PILOT");
    expect(ssrWithParam).not.toContain("LOCAL");

    const ssrWithoutParam = renderToString(
      <AuthSsrProvider value={ssrSnapshot}>
        <EntryProbe />
      </AuthSsrProvider>,
    );
    expect(ssrWithoutParam).toContain("SKELETON");
    expect(ssrWithoutParam).not.toContain("LOCAL");

    setLeadPilotSessionOptIn(true);
    const seen: string[] = [];
    function TrackingProbe() {
      const { pilotActive, pilotResolved } = useLeadPilotState(undefined);
      const branch = pilotActive ? "PILOT" : !pilotResolved ? "SKELETON" : "LOCAL";
      seen.push(branch);
      return <span>{branch}</span>;
    }
    render(
      <AuthSsrProvider value={ssrSnapshot}>
        <TrackingProbe />
      </AuthSsrProvider>,
    );
    expect(screen.getByText("PILOT")).toBeInTheDocument();
    expect(seen).not.toContain("LOCAL");

    const ssrProd = renderToString(
      <AuthSsrProvider value={{ ...ssrSnapshot, leadPilotAvailable: false }}>
        <EntryProbe searchPilot="1" />
      </AuthSsrProvider>,
    );
    expect(ssrProd).toContain("LOCAL");
    expect(ssrProd).not.toContain("PILOT");
  });

  it("keeps PilotLeadsPage & PilotLeadsBinPage completely isolated from localStorage CRM data", async () => {
    const serverLead = makeLead();
    const wasteLead = makeLead({
      id: "lead_waste_1",
      name: "Waste Lead",
      lifecycleStatus: "waste",
      archiveReason: "Out of budget",
    });

    const fetchMock = vi.fn<typeof fetch>(async (url) => {
      const u = String(url);
      if (u.includes("lifecycle=waste")) {
        return jsonRes({
          ok: true,
          items: [wasteLead],
          total: 1,
          limit: 100,
          offset: 0,
          stageCounts: { all: 1 },
        });
      }
      if (u.includes("lifecycle=deleted")) {
        return jsonRes({
          ok: true,
          items: [],
          total: 0,
          limit: 100,
          offset: 0,
          stageCounts: { all: 0 },
        });
      }
      if (u.includes("/activities")) {
        return jsonRes({
          ok: true,
          leadId: serverLead.id,
          items: [makeActivity()],
          total: 1,
          limit: 7,
          offset: 0,
        });
      }
      if (u.endsWith("/follow-ups")) {
        return jsonRes({
          ok: true,
          leadId: serverLead.id,
          items: [],
          activeFollowUpId: null,
        });
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

    renderWithQuery(<PilotLeadsPage search={{ pilot: 1 }} />);

    expect(await screen.findByTestId("pilot-mode-banner")).toBeInTheDocument();
    expect(await screen.findAllByText("Neha Synthetic")).not.toHaveLength(0);
    expect(screen.queryByText("Local Protected Owner Lead")).toBeNull();
    expect(screen.getByRole("button", { name: /Bulk add/i })).toBeDisabled();

    // Only manual activity types note, meeting, email are allowed in B2B1.
    const typeSelect = screen.getByLabelText("Type") as HTMLSelectElement;
    const optionValues = [...typeSelect.options].map((o) => o.value);
    expect(optionValues).toEqual(["note", "meeting", "email"]);

    renderWithQuery(<PilotLeadsBinPage />);
    expect(await screen.findByText("Waste Lead")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Empty Waste/i })).toBeDisabled();

    // Assert zero localStorage CRM key reads/writes happened across Pilot renders.
    expect(getItemSpy).not.toHaveBeenCalledWith(LOCAL_SENTINEL_KEY);
    expect(setItemSpy).not.toHaveBeenCalledWith(LOCAL_SENTINEL_KEY, expect.anything());
    expect(removeItemSpy).not.toHaveBeenCalledWith(LOCAL_SENTINEL_KEY);
    expect(window.localStorage.getItem(LOCAL_SENTINEL_KEY)).toBe(LOCAL_SENTINEL_VALUE);
  });

  it("preserves draft on 503 failure and handles 409 duplicate_lead with explicit override in PilotAddLeadDialog", async () => {
    let phase: "unavailable" | "duplicate" | "ok" = "unavailable";
    let fetchCount = 0;
    const fetchMock = vi.fn<typeof fetch>(async (_url, init) => {
      fetchCount += 1;
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      if (phase === "unavailable") {
        return jsonRes(
          { ok: false, error: { code: "crm_unavailable", message: "DB unavailable" } },
          503,
        );
      }
      if (phase === "duplicate") {
        expect(body["allowDuplicate"]).toBe(false);
        return jsonRes(
          {
            ok: false,
            error: {
              code: "duplicate_lead",
              message: "Duplicate lead",
              conflict: {
                matchReasons: ["phone"],
                matches: [
                  {
                    id: "lead_existing_1",
                    name: "Existing Duplicate",
                    phone: "9876543210",
                    status: "contacted",
                    lifecycleStatus: "active",
                    matchReasons: ["phone"],
                  },
                ],
              },
            },
          },
          409,
        );
      }
      expect(body["allowDuplicate"]).toBe(true);
      return jsonRes(
        {
          ok: true,
          lead: makeLead({ id: "lead_created_2", name: "Rohan Retry" }),
          activity: makeActivity({ leadId: "lead_created_2" }),
        },
        201,
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const onCreated = vi.fn();
    renderWithQuery(<PilotAddLeadDialog open onOpenChange={vi.fn()} onCreated={onCreated} />);

    expect(screen.getByRole("tab", { name: /Quick AI/i })).toBeDisabled();
    expect(screen.getByRole("tab", { name: /Bulk/i })).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Full name *"), { target: { value: "Rohan Retry" } });
    fireEvent.change(screen.getByLabelText("Phone *"), { target: { value: "9876543210" } });
    fireEvent.click(screen.getByRole("button", { name: "Save lead" }));

    expect(
      await screen.findByText(/CRM database is unavailable/i, {}, { timeout: 3000 }),
    ).toBeInTheDocument();
    // Keyed create retries transient 503 cleanly (1 initial + 2 retries = 3 calls) while preserving draft.
    expect(fetchCount).toBe(3);
    expect((screen.getByLabelText("Full name *") as HTMLInputElement).value).toBe("Rohan Retry");

    phase = "duplicate";
    fireEvent.click(screen.getByRole("button", { name: "Save lead" }));
    expect(await screen.findByTestId("pilot-duplicate-conflict")).toBeInTheDocument();
    expect(screen.getByText("Existing Duplicate")).toBeInTheDocument();

    const saveBtn = screen.getByRole("button", { name: "Save lead" });
    expect(saveBtn).toBeDisabled();

    phase = "ok";
    fireEvent.click(screen.getByRole("checkbox"));
    expect(saveBtn).toBeEnabled();
    fireEvent.click(saveBtn);

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith("lead_created_2"));
  });

  it("handles 409 stale_conflict in PilotLeadDetailPage via Review latest and Keep my draft rebase", async () => {
    const leadV1 = makeLead({
      id: "lead_conf_1",
      version: 1,
      company: "Old Co",
      notes: "Original notes",
      budget: 50000,
    });
    const leadV2 = makeLead({
      id: "lead_conf_1",
      version: 2,
      company: "Old Co",
      notes: "Updated by another tab",
      budget: 120000,
    });
    const leadV3 = makeLead({
      id: "lead_conf_1",
      version: 3,
      company: "My New Co",
      notes: "Updated by another tab",
      budget: 120000,
    });

    let patchCalls = 0;
    let currentLead = leadV1;
    const fetchMock = vi.fn<typeof fetch>(async (url, init) => {
      const u = String(url);
      if (u.endsWith("/activities")) {
        return jsonRes({
          ok: true,
          leadId: "lead_conf_1",
          items: [],
          total: 0,
          limit: 100,
          offset: 0,
        });
      }
      if (u.endsWith("/follow-ups")) {
        return jsonRes({
          ok: true,
          leadId: "lead_conf_1",
          items: [],
          activeFollowUpId: null,
        });
      }
      if (init?.method === "PATCH") {
        patchCalls += 1;
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        if (patchCalls === 1) {
          expect(body["version"]).toBe(1);
          currentLead = leadV2;
          return jsonRes(
            {
              ok: false,
              error: {
                code: "stale_conflict",
                message: "Stale lead version",
                conflict: {
                  resource: "lead",
                  id: "lead_conf_1",
                  expectedVersion: 1,
                  currentVersion: 2,
                },
              },
            },
            409,
          );
        }
        expect(body["version"]).toBe(2);
        expect(body["company"]).toBe("My New Co");
        expect(body["budget"]).toBeUndefined();
        currentLead = leadV3;
        return jsonRes({ ok: true, lead: leadV3, activities: [] }, 200);
      }
      return jsonRes({ ok: true, lead: currentLead }, 200);
    });
    vi.stubGlobal("fetch", fetchMock);

    renderWithQuery(<PilotLeadDetailPage id="lead_conf_1" />);

    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Company"), { target: { value: "My New Co" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    expect(await screen.findByTestId("pilot-stale-conflict")).toBeInTheDocument();
    expect(screen.getByText(/Stale version \(v1 vs server v2\)/i)).toBeInTheDocument();
    expect(screen.getByText(/Updated by another tab/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Keep my draft" }));
    expect((screen.getByLabelText("Company") as HTMLInputElement).value).toBe("My New Co");
    expect((screen.getByLabelText("Budget (₹)") as HTMLInputElement).value).toBe("120000");

    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Save changes" })).toBeNull());
    expect(await screen.findByText("My New Co")).toBeInTheDocument();
  });
});
