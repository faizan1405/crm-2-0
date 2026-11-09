import type * as React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PilotScheduleFollowUpDialog } from "@/components/pilot/PilotFollowUpDialogs";
import { PilotFollowUpsPage } from "@/components/pilot/PilotFollowUpsPage";
import { PilotLeadDetailPage } from "@/components/pilot/PilotLeadDetailPage";
import type { FollowUpDto, FollowUpWithLeadDto, LeadDto } from "@/lib/api/schemas";
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
    select ? select({ location: { pathname: "/follow-ups" } }) : "/follow-ups",
  useBlocker: () => ({ status: "idle", reset: vi.fn(), proceed: vi.fn() }),
}));

const LOCAL_SENTINEL_KEY = "scale-flow-crm-2-demo";
const LOCAL_SENTINEL_VALUE = JSON.stringify({
  state: {
    leads: [{ id: "local_lead_1", name: "Local Owner Protected Client" }],
    followUps: [{ id: "local_fu_1", leadId: "local_lead_1", note: "Local only task" }],
  },
  version: 0,
});

function makeLead(overrides: Partial<LeadDto> = {}): LeadDto {
  return {
    id: "lead_srv_1",
    legacyId: null,
    name: "Aarav Synthetic",
    phone: "9820001122",
    email: "aarav@synthetic.example",
    company: "Syntha Studios",
    requirement: "Interactive Web",
    source: "Website",
    status: "qualified",
    priority: "hot",
    aiScore: 88,
    quotedAmount: 150000,
    budget: 180000,
    notes: "Prefers afternoon IST calls",
    pinned: false,
    lifecycleStatus: "active",
    tagIds: [],
    fieldValues: {},
    version: 1,
    createdAt: "2026-11-08T08:00:00.000Z",
    updatedAt: "2026-11-08T08:00:00.000Z",
    ...overrides,
  };
}

function makeFollowUp(overrides: Partial<FollowUpDto> = {}): FollowUpDto {
  return {
    id: "fu_srv_1",
    legacyId: null,
    leadId: "lead_srv_1",
    type: "call",
    dueAt: "2026-11-10T09:00:00.000Z",
    dueAtIst: "2026-11-10T14:30:00+05:30",
    dueIstDate: "2026-11-10",
    dueIstTime: "14:30",
    note: "Confirm proposal scope",
    status: "pending",
    version: 1,
    createdAt: "2026-11-09T09:00:00.000Z",
    updatedAt: "2026-11-09T09:00:00.000Z",
    ...overrides,
  };
}

function toWithLead(
  fu: FollowUpDto,
  lead: LeadDto,
  bucket: "overdue" | "today" | "upcoming" | "done" = "today",
): FollowUpWithLeadDto {
  return {
    ...fu,
    bucket,
    lead: {
      id: lead.id,
      name: lead.name,
      phone: lead.phone,
      company: lead.company ?? undefined,
      status: lead.status,
      priority: lead.priority,
      lifecycleStatus: lead.lifecycleStatus,
    },
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

describe("B2B2 Follow-ups Pilot UI, Conflict Handling & Storage Isolation", () => {
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
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("isolates PilotFollowUpsPage from localStorage, preserves lastContact on Complete, and moves Cancel to History", async () => {
    const leadA = makeLead({ id: "lead_a", name: "Aarav Synthetic" });
    let fuA: FollowUpDto = makeFollowUp({
      id: "fu_a",
      leadId: "lead_a",
      note: "Initial pricing review",
      version: 1,
    });
    let bucketA: "overdue" | "today" | "upcoming" | "done" = "today";

    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (url.startsWith("/api/v1/follow-ups?")) {
        const parsed = new URL(url, "http://localhost");
        const bucket = parsed.searchParams.get("bucket") ?? "pending";
        const type = parsed.searchParams.get("type") ?? "all";
        const allItems = [toWithLead(fuA, leadA, bucketA)];
        const filtered = allItems.filter((item) => {
          if (type !== "all" && item.type !== type) return false;
          if (bucket === "pending") return item.status === "pending";
          if (bucket === "done") return item.status !== "pending";
          return item.status === "pending" && item.bucket === bucket;
        });
        return jsonRes({
          ok: true,
          items: filtered,
          total: filtered.length,
          limit: 50,
          offset: 0,
          summary: {
            overdue: fuA.status === "pending" && bucketA === "overdue" ? 1 : 0,
            today: fuA.status === "pending" && bucketA === "today" ? 1 : 0,
            upcoming: fuA.status === "pending" && bucketA === "upcoming" ? 1 : 0,
            done: fuA.status !== "pending" ? 1 : 0,
            pending: fuA.status === "pending" ? 1 : 0,
          },
        });
      }
      if (url === "/api/v1/follow-ups/fu_a/complete" && init?.method === "POST") {
        expect(leadA.lastContact).toBeUndefined();
        fuA = {
          ...fuA,
          status: "completed",
          version: 2,
          completedAt: "2026-11-10T09:15:00.000Z",
        };
        bucketA = "done";
        return jsonRes({
          ok: true,
          followUp: fuA,
          leadLastContact: null,
          leadNextFollowUp: null,
          activity: {
            id: "act_complete",
            legacyId: null,
            leadId: "lead_a",
            actorUserId: "usr_owner",
            type: "followup",
            text: "Follow-up completed (call)",
            at: "2026-11-10T09:15:00.000Z",
            createdAt: "2026-11-10T09:15:00.000Z",
          },
        });
      }
      if (url === "/api/v1/leads/lead_a") {
        return jsonRes({ ok: true, lead: leadA });
      }
      if (url === "/api/v1/leads/lead_a/follow-ups") {
        return jsonRes({
          ok: true,
          leadId: "lead_a",
          items: [fuA],
          activeFollowUpId: fuA.status === "pending" ? fuA.id : null,
        });
      }
      if (url.startsWith("/api/v1/leads/lead_a/activities")) {
        return jsonRes({
          ok: true,
          leadId: "lead_a",
          items: [],
          total: 0,
          limit: 5,
          offset: 0,
        });
      }
      if (url.startsWith("/api/v1/leads/lead_a/calls")) {
        return jsonRes({
          ok: true,
          leadId: "lead_a",
          items: [],
          total: 0,
          limit: 3,
          offset: 0,
          summary: { total: 0, connected: 0, attempts: 0 },
        });
      }
      if (url.startsWith("/api/v1/leads/lead_a/whatsapp-messages")) {
        return jsonRes({
          ok: true,
          leadId: "lead_a",
          items: [],
          total: 0,
          limit: 3,
          offset: 0,
        });
      }
      return jsonRes({
        ok: true,
        items: [],
        total: 0,
        limit: 200,
        offset: 0,
        stageCounts: { all: 0 },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    renderWithQuery(<PilotFollowUpsPage />);

    expect(await screen.findByText("Aarav Synthetic")).toBeInTheDocument();
    expect(screen.queryByText("Local Owner Protected Client")).toBeNull();
    expect(screen.getByText("Initial pricing review")).toBeInTheDocument();

    // Open lead inspector sheet -> dialer tel: link, Log call, and WhatsApp are enabled, lastContact stays "Never".
    fireEvent.click(screen.getByRole("button", { name: "View" }));
    expect(await screen.findByText("Never")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Call Aarav Synthetic/i })).toHaveAttribute(
      "href",
      "tel:9820001122",
    );
    expect(screen.getByRole("button", { name: "Log call" })).toBeEnabled();
    const inspector = screen.getByRole("dialog");
    expect(
      within(inspector).getByRole("button", { name: /WhatsApp Aarav Synthetic/i }),
    ).toBeEnabled();

    // Complete follow-up from inspector -> preserves lastContact as null ("Never"), moves to History.
    fireEvent.click(screen.getByRole("button", { name: "Complete" }));
    await waitFor(() => expect(fuA.status).toBe("completed"));
    expect(leadA.lastContact).toBeUndefined();

    fireEvent.click(screen.getByRole("tab", { name: /History/i }));
    expect(await screen.findByText("Aarav Synthetic")).toBeInTheDocument();
    expect(screen.getByText("Done")).toBeInTheDocument();

    expect(getItemSpy).not.toHaveBeenCalledWith(LOCAL_SENTINEL_KEY);
    expect(setItemSpy).not.toHaveBeenCalledWith(LOCAL_SENTINEL_KEY, expect.anything());
    expect(removeItemSpy).not.toHaveBeenCalledWith(LOCAL_SENTINEL_KEY);
    expect(window.localStorage.getItem(LOCAL_SENTINEL_KEY)).toBe(LOCAL_SENTINEL_VALUE);
  });

  it("handles two-session 409 stale_conflict in Edit/Reschedule with draft rebase & note clearing, plus Cancel reason", async () => {
    const leadB = makeLead({ id: "lead_b", name: "Meera Synthetic" });
    let fuB: FollowUpDto = makeFollowUp({
      id: "fu_b",
      leadId: "lead_b",
      type: "whatsapp",
      note: "Original agenda",
      version: 1,
    });
    let bucketB: "today" | "done" = "today";
    let patchCalls = 0;

    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (url.startsWith("/api/v1/follow-ups?")) {
        const parsed = new URL(url, "http://localhost");
        const bucket = parsed.searchParams.get("bucket") ?? "pending";
        const allItems = [toWithLead(fuB, leadB, bucketB)];
        const filtered = allItems.filter((item) => {
          if (bucket === "pending") return item.status === "pending";
          if (bucket === "done") return item.status !== "pending";
          return item.status === "pending" && item.bucket === bucket;
        });
        return jsonRes({
          ok: true,
          items: filtered,
          total: filtered.length,
          limit: 50,
          offset: 0,
          summary: {
            overdue: 0,
            today: fuB.status === "pending" ? 1 : 0,
            upcoming: 0,
            done: fuB.status !== "pending" ? 1 : 0,
            pending: fuB.status === "pending" ? 1 : 0,
          },
        });
      }
      if (url === "/api/v1/follow-ups/fu_b" && (!init?.method || init.method === "GET")) {
        return jsonRes({ ok: true, followUp: fuB });
      }
      if (url === "/api/v1/follow-ups/fu_b" && init?.method === "PATCH") {
        patchCalls += 1;
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        if (patchCalls === 1) {
          expect(body["version"]).toBe(1);
          // Concurrent another session bumped v1 -> v2
          fuB = { ...fuB, version: 2, note: "Concurrent tab edit", dueIstTime: "16:00" };
          return jsonRes(
            {
              ok: false,
              error: {
                code: "stale_conflict",
                message: "Stale follow-up version",
                conflict: {
                  resource: "followup",
                  id: "fu_b",
                  expectedVersion: 1,
                  currentVersion: 2,
                },
              },
            },
            409,
          );
        }
        expect(body["version"]).toBe(2);
        expect(body["note"]).toBeNull();
        fuB = { ...fuB, version: 3, note: undefined };
        return jsonRes({
          ok: true,
          followUp: fuB,
          leadNextFollowUp: fuB.dueAt,
          activity: {
            id: "act_patch",
            legacyId: null,
            leadId: "lead_b",
            actorUserId: "usr_owner",
            type: "followup",
            text: "Follow-up note updated",
            at: "2026-11-10T09:20:00.000Z",
            createdAt: "2026-11-10T09:20:00.000Z",
          },
        });
      }
      if (url === "/api/v1/follow-ups/fu_b/cancel" && init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        expect(body["version"]).toBe(3);
        expect(body["reason"]).toBe("Client asked for next quarter");
        fuB = {
          ...fuB,
          status: "cancelled",
          version: 4,
          cancelledAt: "2026-11-10T09:25:00.000Z",
          cancelReason: "Client asked for next quarter",
        };
        bucketB = "done";
        return jsonRes({
          ok: true,
          followUp: fuB,
          leadNextFollowUp: null,
          activity: {
            id: "act_cancel",
            legacyId: null,
            leadId: "lead_b",
            actorUserId: "usr_owner",
            type: "followup",
            text: "Follow-up cancelled: Client asked for next quarter",
            at: "2026-11-10T09:25:00.000Z",
            createdAt: "2026-11-10T09:25:00.000Z",
          },
        });
      }
      return jsonRes({ ok: true, items: [] });
    });
    vi.stubGlobal("fetch", fetchMock);

    renderWithQuery(<PilotFollowUpsPage />);
    expect(await screen.findByText("Meera Synthetic")).toBeInTheDocument();

    // Edit note -> clear it -> encounter 409 stale_conflict -> rebase onto v2 -> save note=null.
    fireEvent.click(screen.getByRole("button", { name: /Edit \/ Reschedule/i }));
    const noteBox = await screen.findByLabelText(/Note \(leave blank to clear\)/i);
    fireEvent.change(noteBox, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    expect(await screen.findByTestId("pilot-fu-stale-conflict")).toBeInTheDocument();
    expect(
      within(screen.getByTestId("pilot-fu-stale-conflict")).getByText(/Concurrent tab edit/),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Keep my draft & rebase onto v2/i }));
    expect(
      (screen.getByLabelText(/Note \(leave blank to clear\)/i) as HTMLTextAreaElement).value,
    ).toBe("");

    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(fuB.version).toBe(3));

    // Cancel with optional reason -> moves to History with Cancelled chip + reason text.
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    const reasonInput = await screen.findByLabelText(/Cancel reason/i);
    fireEvent.change(reasonInput, { target: { value: "Client asked for next quarter" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm cancel" }));

    await waitFor(() => expect(fuB.status).toBe("cancelled"));
    fireEvent.click(screen.getByRole("tab", { name: /History/i }));
    expect(await screen.findByText("Cancelled")).toBeInTheDocument();
    expect(screen.getByText(/Reason: Client asked for next quarter/i)).toBeInTheDocument();
  });

  it("rejects impossible IST rollover dates, preserves drafts on 503, and handles 409 followup_conflict Keep & Replace", async () => {
    const existingFu = makeFollowUp({
      id: "fu_existing",
      leadId: "lead_srv_1",
      type: "call",
      note: "Existing agenda",
    });
    let phase: "unavailable" | "conflict" | "replace" = "unavailable";

    const fetchMock = vi.fn<typeof fetch>(async (_input, init) => {
      if (init?.method !== "POST") {
        return jsonRes({
          ok: true,
          items: [],
          total: 0,
          limit: 200,
          offset: 0,
          stageCounts: { all: 0 },
        });
      }
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      if (phase === "unavailable") {
        return jsonRes(
          { ok: false, error: { code: "crm_unavailable", message: "DB unavailable" } },
          503,
        );
      }
      if (phase === "conflict") {
        expect(body["replaceActiveFollowUpId"]).toBeUndefined();
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
      return jsonRes(
        {
          ok: true,
          followUp: makeFollowUp({
            id: "fu_replaced",
            leadId: "lead_srv_1",
            type: "meeting",
            note: "Executive demo",
          }),
          replacedFollowUpId: "fu_existing",
          leadNextFollowUp: "2026-11-12T10:00:00.000Z",
          activity: {
            id: "act_rep",
            legacyId: null,
            leadId: "lead_srv_1",
            actorUserId: "usr_owner",
            type: "followup",
            text: "Follow-up replaced (meeting)",
            at: "2026-11-10T10:00:00.000Z",
            createdAt: "2026-11-10T10:00:00.000Z",
          },
        },
        201,
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const onCompleted = vi.fn();
    const onOpenChange = vi.fn();
    renderWithQuery(
      <PilotScheduleFollowUpDialog
        open
        onOpenChange={onOpenChange}
        leadId="lead_srv_1"
        leadName="Aarav Synthetic"
        initial={{ dueAtInput: "2026-02-30T10:00", note: "Executive demo" }}
        onCompleted={onCompleted}
      />,
    );

    // 1. Rollover date 2026-02-30T10:00 fails client validation before any POST call.
    fireEvent.click(screen.getByRole("button", { name: "Schedule follow-up" }));
    expect(await screen.findByText(/That calendar date does not exist/i)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();

    // 2. Valid date + 503 preserves draft cleanly.
    fireEvent.change(screen.getByLabelText("When (IST) *"), {
      target: { value: "2026-11-12T15:30" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Schedule follow-up" }));
    expect(await screen.findByTestId("pilot-fu-schedule-error")).toBeInTheDocument();
    expect((screen.getByLabelText("Note (optional)") as HTMLTextAreaElement).value).toBe(
      "Executive demo",
    );

    // 3. 409 followup_conflict shows side-by-side Existing vs New panel -> Keep existing closes cleanly.
    phase = "conflict";
    fireEvent.click(screen.getByRole("button", { name: "Schedule follow-up" }));
    expect(await screen.findByTestId("pilot-fu-conflict")).toBeInTheDocument();
    expect(screen.getByText(/Existing agenda/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Keep existing" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);

    // 4. Re-submit via Replace with new sends replaceActiveFollowUpId.
    phase = "replace";
    fireEvent.click(screen.getByRole("button", { name: "Replace with new" }));
    await waitFor(() =>
      expect(onCompleted).toHaveBeenCalledWith(expect.objectContaining({ id: "fu_replaced" })),
    );
  });

  it("renders per-lead MariaDB follow-ups in PilotLeadDetailPage and disables scheduling for archived leads", async () => {
    const archivedLead = makeLead({
      id: "lead_arch_1",
      name: "Archived Client",
      lifecycleStatus: "waste",
      archiveReason: "Closed budget",
    });

    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url === "/api/v1/leads/lead_arch_1") {
        return jsonRes({ ok: true, lead: archivedLead });
      }
      if (url === "/api/v1/leads/lead_arch_1/follow-ups") {
        return jsonRes({
          ok: true,
          leadId: "lead_arch_1",
          items: [
            makeFollowUp({
              id: "fu_hist_1",
              leadId: "lead_arch_1",
              status: "cancelled",
              cancelReason: "Archived lead",
              note: "Old call",
            }),
          ],
          activeFollowUpId: null,
        });
      }
      if (url.startsWith("/api/v1/leads/lead_arch_1/activities")) {
        return jsonRes({
          ok: true,
          leadId: "lead_arch_1",
          items: [],
          total: 0,
          limit: 100,
          offset: 0,
        });
      }
      if (url.startsWith("/api/v1/leads/lead_arch_1/calls")) {
        return jsonRes({
          ok: true,
          leadId: "lead_arch_1",
          items: [],
          total: 0,
          limit: 25,
          offset: 0,
          summary: { total: 0, connected: 0, attempts: 0 },
        });
      }
      if (url.startsWith("/api/v1/leads/lead_arch_1/whatsapp-messages")) {
        return jsonRes({
          ok: true,
          leadId: "lead_arch_1",
          items: [],
          total: 0,
          limit: 25,
          offset: 0,
        });
      }
      return jsonRes({ ok: false }, 404);
    });
    vi.stubGlobal("fetch", fetchMock);

    renderWithQuery(<PilotLeadDetailPage id="lead_arch_1" />);

    expect(await screen.findAllByText("Archived Client")).not.toHaveLength(0);
    expect(await screen.findByText("Follow-ups (MariaDB)")).toBeInTheDocument();
    expect(screen.getByText(/Reason: Archived lead/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Follow-up" })).toBeDisabled();
  });
});
