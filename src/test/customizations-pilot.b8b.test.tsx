import type * as React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PilotCrmConfigPage } from "@/components/pilot/PilotCrmConfigPage";
import { PilotLeadDetailPage } from "@/components/pilot/PilotLeadDetailPage";
import { PilotLeadsPage } from "@/components/pilot/PilotLeadsPage";
import { AuthSsrProvider, clearClientAuthState, hydrateAuthFromSsr } from "@/lib/auth/authClient";
import type {
  CustomFieldDto,
  TagDto,
  SavedViewDto,
  FieldTypeApi,
  TagColorApi,
  TagScopeApi,
} from "@/lib/api/customizationsApi";
import type { LeadDto } from "@/lib/api/schemas";

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
    select ? select({ location: { pathname: "/crm-config" } }) : "/crm-config",
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

const MOCK_FIELDS: CustomFieldDto[] = [
  {
    id: "cf_text_1",
    ownerUserId: "usr_owner_alpha",
    entity: "lead",
    label: "Client Industry",
    type: "text",
    required: false,
    highlight: false,
    visibility: "team",
    description: "Primary business sector of the client",
    currency: null,
    options: [],
    displayOrder: 1,
    status: "active",
    version: 1,
    createdAt: "2026-11-10T10:00:00Z",
    updatedAt: "2026-11-10T10:00:00Z",
  },
  {
    id: "cf_currency_1",
    ownerUserId: "usr_owner_alpha",
    entity: "lead",
    label: "Expected Budget",
    type: "currency",
    required: true,
    highlight: true,
    visibility: "team",
    description: "Client budget in INR",
    currency: "INR",
    options: [],
    displayOrder: 2,
    status: "active",
    version: 2,
    createdAt: "2026-11-10T10:00:00Z",
    updatedAt: "2026-11-10T11:00:00Z",
  },
];

const MOCK_TAGS: TagDto[] = [
  {
    id: "tag_vip_1",
    ownerUserId: "usr_owner_alpha",
    name: "VIP Enterprise",
    color: "violet",
    scope: "both",
    status: "active",
    version: 1,
    createdAt: "2026-11-10T10:00:00Z",
    updatedAt: "2026-11-10T10:00:00Z",
  },
  {
    id: "tag_urg_1",
    ownerUserId: "usr_owner_alpha",
    name: "Urgent Followup",
    color: "amber",
    scope: "lead",
    status: "active",
    version: 1,
    createdAt: "2026-11-10T10:00:00Z",
    updatedAt: "2026-11-10T10:00:00Z",
  },
];

const MOCK_VIEWS: SavedViewDto[] = [
  {
    id: "sv_high_val_1",
    ownerUserId: "usr_owner_alpha",
    name: "High Value Proposals",
    visibility: "company",
    sort: "value",
    filter: {
      mode: "and",
      conditions: [
        { id: "c1", field: "leadStatus", op: "equals", value: "proposal" },
        { id: "c2", field: "dealValueInPaise", op: "greater_than_or_equal", value: 10000000 },
      ],
    },
    archived: false,
    version: 1,
    createdAt: "2026-11-10T10:00:00Z",
    updatedAt: "2026-11-10T10:00:00Z",
  },
];

const MOCK_LEAD: LeadDto = {
  id: "lead_test_101",
  legacyId: null,
  name: "Rajesh Sharma",
  company: "Apex Innovations",
  email: "rajesh@apexinnovations.in",
  phone: "+91 98765 43210",
  requirement: "Enterprise Sales OS",
  source: "Website",
  status: "qualified",
  priority: "hot",
  aiScore: 85,
  quotedAmount: 250000,
  budget: 250000,
  lastContact: "2026-11-10T10:00:00Z",
  nextFollowUp: "2026-11-12T10:00:00Z",
  notes: "Interested in full CRM deployment",
  pinned: false,
  lostReason: undefined,
  lifecycleStatus: "active",
  tagIds: ["tag_vip_1"],
  fieldValues: {
    cf_text_1: "Fintech",
    cf_currency_1: 250000,
  },
  version: 3,
  createdAt: "2026-11-10T10:00:00Z",
  updatedAt: "2026-11-10T12:00:00Z",
};

const LOCAL_STORAGE_KEY = "crm-storage";
const LOCAL_STORAGE_BASELINE = JSON.stringify({ state: { leads: [{ id: "local-leak-lead", name: "Local Fake" }] } });

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity },
      mutations: { retry: false },
    },
  });
  return (
    <AuthSsrProvider value={SSR_AUTH}>
      <QueryClientProvider client={qc}>{ui}</QueryClientProvider>
    </AuthSsrProvider>
  );
}

function jsonRes(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function handleCommonCrmRoutes(url: string) {
  if (url.includes("/api/v1/settings/definitions")) {
    return jsonRes({
      ok: true,
      definitions: {
        invariants: { businessTimezone: "Asia/Kolkata", currencyCode: "INR", readOnly: true },
        leadStatuses: ["new", "contacted", "qualified", "proposal", "won", "lost"],
        leadSources: ["Website", "Referral"],
        defaultLeadSortOptions: ["recent", "score", "value"],
        goalMetrics: [],
        goalPeriods: [],
        goalScopes: [],
        serverBackedFields: [],
        deviceLocalPreferences: [],
        existingTemplateEndpoints: {
          quotationTemplates: "/api/v1/quotation-templates",
          projectTemplates: "/api/v1/project-templates",
        },
        deferredModules: [],
      },
    });
  }
  if (url.includes("/calls")) {
    return jsonRes({
      ok: true,
      leadId: "lead_test_101",
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
      leadId: "lead_test_101",
      items: [],
      total: 0,
      limit: 25,
      offset: 0,
    });
  }
  if (url.includes("/activities")) {
    return jsonRes({
      ok: true,
      leadId: "lead_test_101",
      items: [],
      total: 0,
      limit: 100,
      offset: 0,
    });
  }
  if (url.includes("/follow-ups")) {
    return jsonRes({
      ok: true,
      leadId: "lead_test_101",
      items: [],
      activeFollowUpId: null,
    });
  }
  if (url.includes("/quotations")) {
    return jsonRes({
      ok: true,
      items: [],
      total: 0,
    });
  }
  return null;
}

describe("B8B Server-Backed Custom Fields, Tags & Saved Views UI Pilot", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearClientAuthState();
    hydrateAuthFromSsr(SSR_AUTH);
    window.localStorage.setItem(LOCAL_STORAGE_KEY, LOCAL_STORAGE_BASELINE);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    expect(window.localStorage.getItem(LOCAL_STORAGE_KEY)).toBe(LOCAL_STORAGE_BASELINE);
  });

  it("PilotCrmConfigPage loads custom fields from MariaDB and creates a new field", async () => {
    const postCalls: Array<{ path: string; body: Record<string, unknown> }> = [];

    const fetchMock = vi.fn<typeof fetch>(async (info, init) => {
      const url = String(info);
      const method = (init?.method ?? "GET").toUpperCase();

      const common = handleCommonCrmRoutes(url);
      if (common) return common;

      if (url.includes("/api/v1/custom-fields") && method === "GET") {
        return jsonRes({ ok: true, items: MOCK_FIELDS, total: MOCK_FIELDS.length });
      }
      if (url.includes("/api/v1/tags") && method === "GET") {
        return jsonRes({ ok: true, items: MOCK_TAGS, total: MOCK_TAGS.length });
      }
      if (url.includes("/api/v1/saved-views") && method === "GET") {
        return jsonRes({ ok: true, items: MOCK_VIEWS, total: MOCK_VIEWS.length });
      }
      if (url.includes("/api/v1/custom-fields") && method === "POST") {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        postCalls.push({ path: url, body });
        return jsonRes({
          ok: true,
          field: {
            id: "cf_num_new",
            ownerUserId: "usr_owner_alpha",
            entity: (body["entity"] as "lead" | "project") ?? "lead",
            label: String(body["label"]),
            type: body["type"] as FieldTypeApi,
            required: Boolean(body["required"] ?? false),
            highlight: false,
            visibility: "team",
            description: (body["description"] as string) ?? null,
            currency: null,
            options: [],
            displayOrder: 3,
            status: "active",
            version: 1,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        }, 201);
      }
      return jsonRes({ ok: true });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(wrap(<PilotCrmConfigPage search={{ tab: "fields" }} />));

    await waitFor(() => {
      expect(screen.getByText("Client Industry")).toBeTruthy();
      expect(screen.getByText("Expected Budget")).toBeTruthy();
    });

    // Click "Add Custom Field" button
    const newFieldBtn = screen.getByRole("button", { name: /Add Custom Field/i });
    fireEvent.click(newFieldBtn);

    // Modal opens
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: /Add Custom Field/i })).toBeTruthy();
    });

    const labelInput = screen.getByLabelText(/Field Label/i);
    fireEvent.change(labelInput, { target: { value: "Company Turnover" } });

    const createBtn = screen.getByRole("button", { name: /Create Field/i });
    fireEvent.click(createBtn);

    await waitFor(() => {
      expect(postCalls.length).toBe(1);
    });
    expect(postCalls[0]?.body["label"]).toBe("Company Turnover");
  });

  it("PilotCrmConfigPage displays tags and creates new color-coded tag", async () => {
    const postCalls: Array<{ path: string; body: Record<string, unknown> }> = [];

    const fetchMock = vi.fn<typeof fetch>(async (info, init) => {
      const url = String(info);
      const method = (init?.method ?? "GET").toUpperCase();

      const common = handleCommonCrmRoutes(url);
      if (common) return common;

      if (url.includes("/api/v1/tags") && method === "GET") {
        return jsonRes({ ok: true, items: MOCK_TAGS, total: MOCK_TAGS.length });
      }
      if (url.includes("/api/v1/tags") && method === "POST") {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        postCalls.push({ path: url, body });
        return jsonRes({
          ok: true,
          tag: {
            id: "tag_new_1",
            ownerUserId: "usr_owner_alpha",
            name: String(body["name"]),
            color: body["color"] as TagColorApi,
            scope: (body["scope"] as TagScopeApi) ?? "both",
            status: "active",
            version: 1,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        }, 201);
      }
      return jsonRes({ ok: true, items: [], total: 0 });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(wrap(<PilotCrmConfigPage search={{ tab: "tags" }} />));

    await waitFor(() => {
      expect(screen.getByText("VIP Enterprise")).toBeTruthy();
      expect(screen.getByText("Urgent Followup")).toBeTruthy();
    });

    const newTagBtn = screen.getByRole("button", { name: /Create Tag/i });
    fireEvent.click(newTagBtn);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: /Create Tag/i })).toBeTruthy();
    });

    const nameInput = screen.getByLabelText(/Tag Name/i);
    fireEvent.change(nameInput, { target: { value: "High Intent" } });

    const greenColorBtn = screen.getByRole("button", { name: "Green" });
    fireEvent.click(greenColorBtn);

    const submitBtn = screen.getByRole("button", { name: /^Create Tag$/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(postCalls.length).toBe(1);
    });
    expect(postCalls[0]?.body["name"]).toBe("High Intent");
    expect(postCalls[0]?.body["color"]).toBe("green");
  });

  it("PilotCrmConfigPage lists saved views and supports view duplication", async () => {
    const postCalls: Array<{ path: string }> = [];

    const fetchMock = vi.fn<typeof fetch>(async (info, init) => {
      const url = String(info);
      const method = (init?.method ?? "GET").toUpperCase();

      const common = handleCommonCrmRoutes(url);
      if (common) return common;

      if (url.includes("/api/v1/saved-views") && method === "GET") {
        return jsonRes({ ok: true, items: MOCK_VIEWS, total: MOCK_VIEWS.length });
      }
      if (url.includes("/api/v1/saved-views/sv_high_val_1/duplicate") && method === "POST") {
        postCalls.push({ path: url });
        return jsonRes({
          ok: true,
          view: {
            ...MOCK_VIEWS[0],
            id: "sv_high_val_copy",
            name: "High Value Proposals (Copy)",
            version: 1,
          },
        }, 201);
      }
      return jsonRes({ ok: true, items: [], total: 0 });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(wrap(<PilotCrmConfigPage search={{ tab: "views" }} />));

    await waitFor(() => {
      expect(screen.getByText("High Value Proposals")).toBeTruthy();
    });

    // Duplicate button
    const dupBtn = screen.getByRole("button", { name: /Duplicate/i });
    fireEvent.click(dupBtn);

    await waitFor(() => {
      expect(postCalls.length).toBe(1);
    });
    expect(postCalls[0]?.path).toContain("duplicate");
  });

  it("PilotLeadDetailPage renders server-backed custom values and tags, and updates via MariaDB", async () => {
    let customValuesSaved: Record<string, unknown> | null = null;
    let tagDeleted = false;

    const fetchMock = vi.fn<typeof fetch>(async (info, init) => {
      const url = String(info);
      const method = (init?.method ?? "GET").toUpperCase();

      const common = handleCommonCrmRoutes(url);
      if (common) return common;

      if (url.includes("/api/v1/leads/lead_test_101") && method === "GET" && !url.includes("custom-fields") && !url.includes("tags")) {
        return jsonRes({ ok: true, lead: MOCK_LEAD });
      }
      if (url.includes("/api/v1/custom-fields") && method === "GET") {
        return jsonRes({ ok: true, items: MOCK_FIELDS, total: MOCK_FIELDS.length });
      }
      if (url.includes("/api/v1/tags") && !url.includes("leads") && method === "GET") {
        return jsonRes({ ok: true, items: MOCK_TAGS, total: MOCK_TAGS.length });
      }
      if (url.includes("/api/v1/leads/lead_test_101/custom-fields") && method === "GET") {
        return jsonRes({
          ok: true,
          leadId: "lead_test_101",
          values: {
            cf_text_1: "Fintech",
            cf_currency_1: 250000,
          },
        });
      }
      if (url.includes("/api/v1/leads/lead_test_101/tags") && method === "GET") {
        return jsonRes({
          ok: true,
          leadId: "lead_test_101",
          tags: [{ id: "tag_vip_1", ownerUserId: "usr_owner_alpha", name: "VIP Enterprise", color: "violet", scope: "both", status: "active", version: 1, createdAt: "2026-11-10T10:00:00Z", updatedAt: "2026-11-10T10:00:00Z" }],
        });
      }
      if (url.includes("/api/v1/leads/lead_test_101/custom-fields") && method === "PUT") {
        const body = JSON.parse(String(init?.body)) as { values: Record<string, unknown> };
        customValuesSaved = body.values;
        return jsonRes({ ok: true, leadId: "lead_test_101", values: body.values });
      }
      if (url.includes("/api/v1/leads/lead_test_101/tags/tag_vip_1") && method === "DELETE") {
        tagDeleted = true;
        return jsonRes({ ok: true, leadId: "lead_test_101", removedTagId: "tag_vip_1" });
      }
      return jsonRes({ ok: true });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(wrap(<PilotLeadDetailPage id="lead_test_101" />));

    // Verify custom info and tags are rendered
    await waitFor(() => {
      expect(screen.getByText("VIP Enterprise")).toBeTruthy();
      expect(screen.getByText("Fintech")).toBeTruthy();
      expect(screen.getAllByText("₹2,50,000").length).toBeGreaterThan(0);
    });

    // Enter edit mode for custom values
    const editBtn = screen.getByRole("button", { name: /Edit Fields/i });
    fireEvent.click(editBtn);

    await waitFor(() => {
      expect(screen.getByDisplayValue("Fintech")).toBeTruthy();
    });

    const textInput = screen.getByDisplayValue("Fintech");
    fireEvent.change(textInput, { target: { value: "HealthTech AI" } });

    const saveBtn = screen.getByRole("button", { name: /Save Custom Fields/i });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(customValuesSaved).not.toBeNull();
    });
    expect(customValuesSaved?.["cf_text_1"]).toBe("HealthTech AI");

    // Remove tag
    const removeTagBtn = screen.getByRole("button", { name: "Remove tag VIP Enterprise" });
    fireEvent.click(removeTagBtn);

    await waitFor(() => {
      expect(tagDeleted).toBe(true);
    });
  });

  it("PilotLeadsPage supports multi-lead selection and bulk tagging", async () => {
    const bulkTagSentRef: {
      current: { mode: string; leadIds: string[]; tagId?: string } | null;
    } = { current: null };

    const MOCK_LEAD_LIST: LeadDto[] = [
      MOCK_LEAD,
      {
        ...MOCK_LEAD,
        id: "lead_test_102",
        name: "Pooja Patel",
        company: "Nexus Labs",
        email: "pooja@nexuslabs.in",
        budget: 180000,
        tagIds: [],
      },
    ];

    const fetchMock = vi.fn<typeof fetch>(async (info, init) => {
      const url = String(info);
      const method = (init?.method ?? "GET").toUpperCase();

      const common = handleCommonCrmRoutes(url);
      if (common) return common;

      if (url.includes("/api/v1/leads") && method === "GET" && !url.includes("bulk-tag")) {
        return jsonRes({
          ok: true,
          items: MOCK_LEAD_LIST,
          total: 2,
          limit: 25,
          offset: 0,
          stageCounts: { all: 2, new: 0, qualified: 2 },
        });
      }
      if (url.includes("/api/v1/tags") && method === "GET") {
        return jsonRes({ ok: true, items: MOCK_TAGS, total: MOCK_TAGS.length });
      }
      if (url.includes("/api/v1/saved-views") && method === "GET") {
        return jsonRes({ ok: true, items: MOCK_VIEWS, total: MOCK_VIEWS.length });
      }
      if (url.includes("/api/v1/leads/bulk-tag") || url.includes("/api/v1/leads/bulk-tags")) {
        const body = JSON.parse(String(init?.body)) as {
          tagId?: string;
          mode?: string;
          action?: string;
          leadIds?: string[];
        };
        bulkTagSentRef.current = {
          mode: body.mode ?? body.action ?? "add",
          leadIds: body.leadIds ?? [],
          ...(body.tagId ? { tagId: body.tagId } : {}),
        };
        return jsonRes({
          ok: true,
          tagId: body.tagId ?? "tag_test_1",
          mode: (body.mode ?? body.action ?? "add") as "add" | "remove",
          changedCount: 2,
          affectedLeadIds: ["lead_test_101", "lead_test_102"],
        });
      }
      return jsonRes({ ok: true });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(wrap(<PilotLeadsPage search={{ pilot: 1 }} />));

    await waitFor(() => {
      expect(screen.getAllByText("Rajesh Sharma").length).toBeGreaterThan(0);
      expect(screen.getAllByText("Pooja Patel").length).toBeGreaterThan(0);
    });

    // Select leads via checkboxes
    const check1 = screen.getByRole("checkbox", { name: /Select lead Rajesh Sharma/i });
    const check2 = screen.getByRole("checkbox", { name: /Select lead Pooja Patel/i });
    fireEvent.click(check1);
    fireEvent.click(check2);

    // Sticky bulk actions bar appears
    await waitFor(() => {
      expect(screen.getByTestId("pilot-bulk-actions-bar")).toBeTruthy();
      expect(screen.getByText("leads selected")).toBeTruthy();
    });

    // Click "Add Tag" in bulk bar
    const bulkBar = screen.getByTestId("pilot-bulk-actions-bar");
    const addTagBtn = within(bulkBar).getByRole("button", { name: /Add Tag/i });
    fireEvent.click(addTagBtn);

    // Bulk tag dialog opens
    await waitFor(() => {
      expect(screen.getByText(/Add Tag to Selected Leads/i)).toBeTruthy();
    });

    // Submit bulk tag action
    const confirmBtn = screen.getByRole("button", { name: /Apply Tag/i });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(bulkTagSentRef.current).not.toBeNull();
    });
    expect(bulkTagSentRef.current?.mode).toBe("add");
    expect(Array.isArray(bulkTagSentRef.current?.leadIds)).toBe(true);
    expect(bulkTagSentRef.current?.leadIds.length).toBe(2);
  });
});
