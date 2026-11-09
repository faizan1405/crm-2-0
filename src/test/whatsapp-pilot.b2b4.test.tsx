import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { hydrateAuthFromSsr } from "@/lib/auth/authClient";
import type { FollowUpDto, LeadActivityDto, LeadDto, WaMessageDto } from "@/lib/api/schemas";
import { PilotLeadDetailPage } from "@/components/pilot/PilotLeadDetailPage";
import { PilotLeadsPage } from "@/components/pilot/PilotLeadsPage";
import { PilotFollowUpsPage } from "@/components/pilot/PilotFollowUpsPage";
import { PilotShell } from "@/components/pilot/PilotShell";

vi.mock("@tanstack/react-router", async () => {
  const React = await import("react");
  return {
    Link: ({
      children,
      to,
      ...rest
    }: {
      children: React.ReactNode;
      to?: string;
      [k: string]: unknown;
    }) => (
      <a href={typeof to === "string" ? to : "#"} {...rest}>
        {children}
      </a>
    ),
    useNavigate: () => vi.fn(),
    useRouterState: () => "/leads",
    useBlocker: () => ({
      status: "idle" as const,
      proceed: vi.fn(),
      reset: vi.fn(),
    }),
  };
});

const LOCAL_CRM_KEY = "scale-flow-crm-2-demo";
const LOCAL_CRM_SENTINEL = '{"state":{"leads":[{"id":"local_protected","name":"Local Sentinel"}]}}';
const LOCAL_CALL_PENDING_KEY = "scale-flow-call-pending";
const LOCAL_PENDING_SENTINEL = '{"leadId":"local_call_protected"}';

function makeLead(overrides: Partial<LeadDto> = {}): LeadDto {
  return {
    id: "lead_wa_1",
    legacyId: null,
    name: "Diya Synthetic",
    phone: "+91 98200 01122",
    email: "diya@synthetic.example",
    company: "Diya Studio",
    requirement: "3D Product Configurator",
    budget: 240000,
    quotedAmount: 185000,
    source: "Website",
    status: "qualified",
    priority: "hot",
    pinned: false,
    tagIds: [],
    fieldValues: {},
    aiScore: 88,
    lifecycleStatus: "active",
    version: 1,
    createdAt: "2026-11-10T08:00:00.000Z",
    updatedAt: "2026-11-10T08:00:00.000Z",
    ...overrides,
  };
}

function makeWaMessage(overrides: Partial<WaMessageDto> = {}): WaMessageDto {
  return {
    id: "wa_srv_1",
    legacyId: null,
    leadId: "lead_wa_1",
    actorUserId: "usr_owner",
    purpose: "followup",
    templateId: "tpl-fu-1",
    templateName: "Warm check-in",
    recipientPhone: "919820001122",
    messageText: "Hi Diya, checking in on your 3D Product Configurator requirement.",
    composerSource: "Lead detail",
    confirmationStatus: "owner_confirmed_sent",
    leadActivityId: "act_wa_1",
    confirmedAt: "2026-11-10T09:10:00.000Z",
    confirmedAtIst: "2026-11-10T14:40:00+05:30",
    confirmedIstDate: "2026-11-10",
    confirmedIstTime: "14:40",
    createdAt: "2026-11-10T09:10:00.000Z",
    updatedAt: "2026-11-10T09:10:00.000Z",
    ...overrides,
  };
}

function makeFollowUp(overrides: Partial<FollowUpDto> = {}): FollowUpDto {
  return {
    id: "fu_wa_1",
    legacyId: null,
    leadId: "lead_wa_1",
    type: "whatsapp",
    dueAt: "2026-11-11T05:30:00.000Z",
    dueAtIst: "2026-11-11T11:00:00+05:30",
    dueIstDate: "2026-11-11",
    dueIstTime: "11:00",
    note: "Check WhatsApp reply",
    status: "pending",
    version: 1,
    createdAt: "2026-11-10T09:10:00.000Z",
    updatedAt: "2026-11-10T09:10:00.000Z",
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

describe("B2B4 Server-Backed WhatsApp Composer & Manual Confirmation Guarantees", () => {
  let getItemSpy: ReturnType<typeof vi.spyOn>;
  let setItemSpy: ReturnType<typeof vi.spyOn>;
  let removeItemSpy: ReturnType<typeof vi.spyOn>;
  let windowOpenSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    window.localStorage.setItem(LOCAL_CRM_KEY, LOCAL_CRM_SENTINEL);
    window.localStorage.setItem(LOCAL_CALL_PENDING_KEY, LOCAL_PENDING_SENTINEL);
    window.sessionStorage.clear();

    getItemSpy = vi.spyOn(Storage.prototype, "getItem");
    setItemSpy = vi.spyOn(Storage.prototype, "setItem");
    removeItemSpy = vi.spyOn(Storage.prototype, "removeItem");
    windowOpenSpy = vi.spyOn(window, "open").mockImplementation(() => null);

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

  it("hydrates built-in templates from server lead + auth owner, opens wa.me without auto-logging, and logs only on explicit Owner confirmation while preserving lastContact", async () => {
    let lead = makeLead();
    const waMessages: WaMessageDto[] = [];
    const activities: LeadActivityDto[] = [];
    let waPostCount = 0;

    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (url === "/api/v1/leads/lead_wa_1") {
        return jsonRes({ ok: true, lead });
      }
      if (url.startsWith("/api/v1/leads/lead_wa_1/calls")) {
        return jsonRes({
          ok: true,
          leadId: "lead_wa_1",
          items: [],
          total: 0,
          limit: 25,
          offset: 0,
          summary: { total: 0, connected: 0, attempts: 0 },
        });
      }
      if (url.startsWith("/api/v1/leads/lead_wa_1/whatsapp-messages")) {
        return jsonRes({
          ok: true,
          leadId: "lead_wa_1",
          items: waMessages,
          total: waMessages.length,
          limit: 25,
          offset: 0,
        });
      }
      if (url.startsWith("/api/v1/leads/lead_wa_1/activities")) {
        return jsonRes({
          ok: true,
          leadId: "lead_wa_1",
          items: activities,
          total: activities.length,
          limit: 100,
          offset: 0,
        });
      }
      if (url === "/api/v1/leads/lead_wa_1/follow-ups") {
        return jsonRes({
          ok: true,
          leadId: "lead_wa_1",
          items: [],
          activeFollowUpId: null,
        });
      }
      if (url === "/api/v1/whatsapp-messages" && init?.method === "POST") {
        waPostCount += 1;
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        expect(body["leadId"]).toBe("lead_wa_1");
        expect(body["purpose"]).toBe("quotation");
        expect(body["recipientPhone"]).toBe("919820001122");
        expect(body["confirmedSent"]).toBe(true);
        expect(body["confirmationStatus"]).toBe("owner_confirmed_sent");
        expect(body["composerSource"]).toBe("Lead detail");
        expect(body["expectedLeadVersion"]).toBe(1);

        const created = makeWaMessage({
          purpose: "quotation",
          templateId: String(body["templateId"] ?? "tpl-q-1"),
          templateName: String(body["templateName"] ?? "Quotation share"),
          messageText: String(body["messageText"]),
        });
        waMessages.unshift(created);
        // Honesty: version increments, but lastContact remains undefined!
        lead = {
          ...lead,
          version: 2,
        };
        const act: LeadActivityDto = {
          id: "act_wa_1",
          legacyId: null,
          leadId: "lead_wa_1",
          actorUserId: "usr_owner",
          type: "whatsapp",
          text: `WhatsApp sent (Quotation · ${created.templateName}): ${created.messageText.slice(0, 80)}`,
          at: created.confirmedAt,
          createdAt: created.confirmedAt,
        };
        activities.unshift(act);
        return jsonRes({ ok: true, message: created, lead, activity: act }, 201);
      }
      return jsonRes({ ok: false }, 404);
    });
    vi.stubGlobal("fetch", fetchMock);

    renderWithQuery(<PilotLeadDetailPage id="lead_wa_1" />);

    const waButtons = await screen.findAllByRole("button", { name: /WhatsApp Diya Synthetic/i });
    fireEvent.click(waButtons[0]!);

    const dialog = await screen.findByTestId("pilot-whatsapp-dialog");

    // 1. Default template hydrates client first name, requirement, and authenticated Owner name.
    const msgBox = within(dialog).getByLabelText("Message") as HTMLTextAreaElement;
    expect(msgBox.value).toContain("Diya");
    expect(msgBox.value).toContain("3D Product Configurator");
    expect(msgBox.value).toContain("Owner Synthetic");

    // 2. Switch to Quotation purpose -> hydrates quotedAmount ₹1,85,000.
    fireEvent.click(within(dialog).getByRole("radio", { name: /Quotation/i }));
    expect(msgBox.value).toContain("₹1,85,000");

    // 3. Clicking Open in WhatsApp opens wa.me URL in new tab and shows confirmation panel, with ZERO DB mutations.
    fireEvent.click(within(dialog).getByRole("button", { name: /Open in WhatsApp/i }));
    expect(windowOpenSpy).toHaveBeenCalledTimes(1);
    expect(String(windowOpenSpy.mock.calls[0]?.[0])).toContain("https://wa.me/919820001122?text=");
    expect(await within(dialog).findByTestId("pilot-wa-confirm-panel")).toBeInTheDocument();
    expect(waPostCount).toBe(0);

    // 4. Clicking "Not sent / Keep editing" returns to draft editing with zero DB calls.
    fireEvent.click(within(dialog).getByRole("button", { name: /Not sent \/ Keep editing/i }));
    expect(within(dialog).queryByTestId("pilot-wa-confirm-panel")).toBeNull();
    expect(waPostCount).toBe(0);

    // 5. Re-open WhatsApp and click "Close without logging" -> closes modal with zero DB calls.
    fireEvent.click(within(dialog).getByRole("button", { name: /Open in WhatsApp/i }));
    expect(await within(dialog).findByTestId("pilot-wa-confirm-panel")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: /Close without logging/i }));
    await waitFor(() => expect(screen.queryByTestId("pilot-whatsapp-dialog")).toBeNull());
    expect(waPostCount).toBe(0);

    // 6. Open again, switch to Quotation, open in WhatsApp, and explicitly confirm "I sent it — Log to MariaDB".
    fireEvent.click(screen.getAllByRole("button", { name: /WhatsApp Diya Synthetic/i })[0]!);
    const dialog2 = await screen.findByTestId("pilot-whatsapp-dialog");
    fireEvent.click(within(dialog2).getByRole("radio", { name: /Quotation/i }));
    fireEvent.click(within(dialog2).getByRole("button", { name: /Open in WhatsApp/i }));
    fireEvent.click(
      await within(dialog2).findByRole("button", { name: /I sent it — Log to MariaDB/i }),
    );

    await waitFor(() => expect(waPostCount).toBe(1));
    await waitFor(() => expect(screen.queryByTestId("pilot-whatsapp-dialog")).toBeNull());

    // 7. Verify WhatsApp (MariaDB) panel shows "Owner-confirmed sent" (never "Delivered"), and Last contact stays "—".
    const waPanel = screen.getByTestId("pilot-lead-whatsapp-panel");
    expect(within(waPanel).getAllByText("Owner-confirmed sent").length).toBeGreaterThanOrEqual(1);
    expect(within(waPanel).getByText("1 confirmed message")).toBeInTheDocument();
    expect(within(waPanel).queryByText(/Delivered/i)).toBeNull();
    expect(screen.getByText("Last contact").parentElement).toHaveTextContent("Last contact—");
    expect(lead.lastContact).toBeUndefined();

    // 8. Verify complete localStorage isolation.
    expect(getItemSpy).not.toHaveBeenCalledWith(LOCAL_CRM_KEY);
    expect(setItemSpy).not.toHaveBeenCalledWith(LOCAL_CRM_KEY, expect.anything());
    expect(removeItemSpy).not.toHaveBeenCalledWith(LOCAL_CRM_KEY);
    expect(getItemSpy).not.toHaveBeenCalledWith(LOCAL_CALL_PENDING_KEY);
    expect(setItemSpy).not.toHaveBeenCalledWith(LOCAL_CALL_PENDING_KEY, expect.anything());
    expect(window.localStorage.getItem(LOCAL_CRM_KEY)).toBe(LOCAL_CRM_SENTINEL);
  });

  it("handles Step 1 409 stale_conflict rebase and recovers Step 2 503 & 409 followup_conflict without duplicating Step 1 WhatsApp log", async () => {
    let lead = makeLead({ version: 1, quotedAmount: 185000 });
    const existingFu = makeFollowUp({ id: "fu_existing", note: "Existing WhatsApp follow-up" });
    let activeFu: FollowUpDto | null = null;
    let waPostCount = 0;
    let fuPostCount = 0;
    let scenario: "stale_then_ok" | "step2_fail_then_conflict_then_replace" = "stale_then_ok";

    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (url === "/api/v1/leads/lead_wa_1") {
        return jsonRes({ ok: true, lead });
      }
      if (url.startsWith("/api/v1/leads/lead_wa_1/calls")) {
        return jsonRes({
          ok: true,
          leadId: "lead_wa_1",
          items: [],
          total: 0,
          limit: 25,
          offset: 0,
          summary: { total: 0, connected: 0, attempts: 0 },
        });
      }
      if (url.startsWith("/api/v1/leads/lead_wa_1/whatsapp-messages")) {
        return jsonRes({
          ok: true,
          leadId: "lead_wa_1",
          items: [],
          total: 0,
          limit: 25,
          offset: 0,
        });
      }
      if (url.startsWith("/api/v1/leads/lead_wa_1/activities")) {
        return jsonRes({
          ok: true,
          leadId: "lead_wa_1",
          items: [],
          total: 0,
          limit: 100,
          offset: 0,
        });
      }
      if (url === "/api/v1/leads/lead_wa_1/follow-ups") {
        return jsonRes({
          ok: true,
          leadId: "lead_wa_1",
          items: activeFu ? [activeFu] : [],
          activeFollowUpId: activeFu?.id ?? null,
        });
      }
      if (url === "/api/v1/whatsapp-messages" && init?.method === "POST") {
        waPostCount += 1;
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        if (waPostCount === 1 && scenario === "stale_then_ok") {
          lead = makeLead({ version: 2, status: "proposal", quotedAmount: 210000 });
          return jsonRes(
            {
              ok: false,
              error: {
                code: "stale_conflict",
                message: "Stale lead version",
                conflict: {
                  resource: "lead",
                  id: "lead_wa_1",
                  expectedVersion: 1,
                  currentVersion: 2,
                },
              },
            },
            409,
          );
        }
        expect(body["expectedLeadVersion"]).toBe(2);
        lead = makeLead({ version: 3, status: "proposal", quotedAmount: 210000 });
        scenario = "step2_fail_then_conflict_then_replace";
        const created = makeWaMessage({
          id: "wa_srv_2",
          messageText: String(body["messageText"]),
        });
        return jsonRes(
          {
            ok: true,
            message: created,
            lead,
            activity: {
              id: "act_wa_2",
              legacyId: null,
              leadId: "lead_wa_1",
              actorUserId: "usr_owner",
              type: "whatsapp",
              text: "WhatsApp sent",
              at: created.confirmedAt,
              createdAt: created.confirmedAt,
            },
          },
          201,
        );
      }
      if (url === "/api/v1/follow-ups" && init?.method === "POST") {
        fuPostCount += 1;
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
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
                message: "Active follow-up exists",
                conflict: { activeFollowUp: existingFu },
              },
            },
            409,
          );
        }
        expect(body["replaceActiveFollowUpId"]).toBe("fu_existing");
        const replaced = makeFollowUp({ id: "fu_replaced", note: "Check quote reaction" });
        activeFu = replaced;
        return jsonRes(
          {
            ok: true,
            followUp: replaced,
            replacedFollowUpId: "fu_existing",
            leadNextFollowUp: replaced.dueAt,
            activity: {
              id: "act_fu_wa_rep",
              legacyId: null,
              leadId: "lead_wa_1",
              actorUserId: "usr_owner",
              type: "followup",
              text: "Follow-up replaced (whatsapp)",
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

    renderWithQuery(<PilotLeadDetailPage id="lead_wa_1" />);
    fireEvent.click(
      (await screen.findAllByRole("button", { name: /WhatsApp Diya Synthetic/i }))[0]!,
    );
    const dialog = await screen.findByTestId("pilot-whatsapp-dialog");

    // 1. Edit message, open in WhatsApp, enable Schedule next follow-up, and confirm send -> hits 409 stale_conflict.
    fireEvent.change(within(dialog).getByLabelText("Message"), {
      target: { value: "Custom edited quote follow-up for Diya" },
    });
    fireEvent.click(within(dialog).getByTestId("pilot-wa-open-external"));
    await within(dialog).findByTestId("pilot-wa-confirm-panel");
    fireEvent.click(within(dialog).getByRole("switch", { name: /Schedule next follow-up/i }));
    fireEvent.change(within(dialog).getByLabelText("Follow-up note"), {
      target: { value: "Check quote reaction" },
    });
    fireEvent.click(
      await within(dialog).findByRole("button", { name: /I sent it — Log to MariaDB/i }),
    );

    expect(await within(dialog).findByTestId("pilot-wa-stale-conflict")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Review latest" }));
    expect(
      within(within(dialog).getByTestId("pilot-wa-stale-conflict")).getByText("Proposal Sent"),
    ).toBeInTheDocument();

    // 2. Rebase preserves edited message & follow-up draft while rebasing onto v2.
    fireEvent.click(
      within(dialog).getByRole("button", { name: /Keep my message & rebase onto v2/i }),
    );
    expect((within(dialog).getByLabelText("Message") as HTMLTextAreaElement).value).toBe(
      "Custom edited quote follow-up for Diya",
    );

    // 3. Re-confirm -> Step 1 succeeds (waPostCount === 2), Step 2 hits 503 after retries.
    fireEvent.click(within(dialog).getByRole("button", { name: /I sent it — Log to MariaDB/i }));
    expect(await within(dialog).findByTestId("pilot-wa-step1-saved")).toBeInTheDocument();
    expect(
      await within(dialog).findByTestId("pilot-wa-step2-error", {}, { timeout: 3000 }),
    ).toBeInTheDocument();
    expect(waPostCount).toBe(2);

    // 4. Retry follow-up only -> triggers 409 followup_conflict WITHOUT duplicating Step 1 WhatsApp log!
    fireEvent.click(within(dialog).getByRole("button", { name: "Retry follow-up only" }));
    expect(await within(dialog).findByTestId("pilot-wa-step2-conflict")).toBeInTheDocument();
    expect(within(dialog).getByText("Existing WhatsApp follow-up")).toBeInTheDocument();
    expect(waPostCount).toBe(2);

    // 5. Replace with new -> completes Step 2 ONLY, still waPostCount === 2!
    fireEvent.click(within(dialog).getByRole("button", { name: "Replace with new" }));
    await waitFor(() => expect(screen.queryByTestId("pilot-whatsapp-dialog")).toBeNull());
    expect(waPostCount).toBe(2);
  });

  it("blocks invalid WhatsApp numbers, disables archived leads, renders across Leads & Follow-ups, and clears session pending key on exit", async () => {
    const activeLead = makeLead({ id: "lead_1", name: "Rohan Pilot", phone: "9811112233" });
    const landlineLead = makeLead({
      id: "lead_landline",
      name: "Landline Co",
      phone: "02226001122",
    });
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
      if (url === "/api/v1/leads/lead_landline") {
        return jsonRes({ ok: true, lead: landlineLead });
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
      if (url.includes("/calls")) {
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
      if (url.includes("/whatsapp-messages")) {
        return jsonRes({
          ok: true,
          leadId: "lead_1",
          items: [],
          total: 0,
          limit: 25,
          offset: 0,
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
                id: activeLead.id,
                name: activeLead.name,
                phone: activeLead.phone,
                status: activeLead.status,
                priority: activeLead.priority,
                lifecycleStatus: activeLead.lifecycleStatus,
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
        items: [activeLead],
        total: 1,
        limit: 50,
        offset: 0,
        stageCounts: { all: 1, new: 0, contacted: 0, qualified: 1, proposal: 0, won: 0, lost: 0 },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    // 1. Archived lead detail disables WhatsApp button
    renderWithQuery(<PilotLeadDetailPage id="lead_arch" />);
    const archWaBtn = await screen.findByRole("button", { name: "WhatsApp Archived Lead" });
    expect(archWaBtn).toBeDisabled();

    // 2. Landline / non-WhatsApp phone shows invalid phone alert and disables Open in WhatsApp + Confirm
    renderWithQuery(<PilotLeadDetailPage id="lead_landline" />);
    const landlineBtns = await screen.findAllByRole("button", { name: "WhatsApp Landline Co" });
    fireEvent.click(landlineBtns[0]!);
    const landlineDialog = await screen.findByTestId("pilot-whatsapp-dialog");
    expect(within(landlineDialog).getByTestId("pilot-wa-invalid-phone")).toBeInTheDocument();
    expect(within(landlineDialog).getByTestId("pilot-wa-open-external")).toBeDisabled();
    expect(
      within(landlineDialog).getByRole("button", {
        name: /Already sent manually\? Confirm & log/i,
      }),
    ).toBeDisabled();
    fireEvent.keyDown(landlineDialog, { key: "Escape" });

    // 3. Leads Workspace & Cards view render enabled WhatsApp buttons
    renderWithQuery(<PilotLeadsPage search={{ pilot: 1 }} />);
    expect(
      (await screen.findAllByRole("button", { name: "WhatsApp Rohan Pilot" }))[0],
    ).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: "cards view" }));
    expect(await screen.findByRole("button", { name: "WhatsApp Rohan Pilot" })).toBeEnabled();

    // 4. Follow-ups card renders enabled WhatsApp button
    renderWithQuery(<PilotFollowUpsPage />);
    expect(
      (await screen.findAllByRole("button", { name: "WhatsApp Rohan Pilot" }))[0],
    ).toBeEnabled();

    // 5. Exit Pilot clears sessionStorage pending WhatsApp composer key
    window.sessionStorage.setItem(
      "sf-b2b4-pilot-wa-pending",
      JSON.stringify({ leadId: "lead_1", composerSource: "Lead detail" }),
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
    expect(window.sessionStorage.getItem("sf-b2b4-pilot-wa-pending")).toBeNull();
  });
});
