import type * as React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PilotInboxPage } from "@/components/pilot/PilotInboxPage";
import { PilotDuplicateReviewDialog } from "@/components/pilot/PilotDuplicateReviewDialog";
import { PilotLeadRelationshipsCard } from "@/components/pilot/PilotLeadRelationshipsCard";
import { AuthSsrProvider, clearClientAuthState, hydrateAuthFromSsr } from "@/lib/auth/authClient";
import type {
  DupCandidateDetail,
  DupCandidateDto,
  InboxQueueResponse,
  LeadRelationshipItem,
} from "@/lib/api/inboxApi";

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
    select ? select({ location: { pathname: "/inbox" } }) : "/inbox",
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

const MOCK_INBOX_RESPONSE: InboxQueueResponse = {
  ok: true,
  items: [
    {
      lead: {
        id: "lead_01",
        name: "Rajesh Kumar",
        phone: "+91 98765 43210",
        email: "rajesh@acme.in",
        company: "Acme Corp",
        source: "Website",
        status: "new",
        priority: "hot",
        requirement: "ERP system migration",
        createdAt: "2026-11-10T10:00:00.000Z",
      },
      status: "needs_review",
      reviewStatus: "needs_review",
      reviewedAt: null,
      flagged: false,
      flagNote: null,
      duplicate: true,
      dupReasons: ["phone"],
      assignee: null,
      contact: {
        status: "established",
        label: "Contacted (Connected Call)",
      },
      ageDays: 1,
    },
    {
      lead: {
        id: "lead_02",
        name: "R. Kumar",
        phone: "09876543210",
        email: "r.kumar@acme.in",
        company: "Acme",
        source: "Referral",
        status: "contacted",
        priority: "warm",
        requirement: "Cloud upgrade",
        createdAt: "2026-11-10T11:00:00.000Z",
      },
      status: "needs_review",
      reviewStatus: "needs_review",
      reviewedAt: null,
      flagged: false,
      flagNote: null,
      duplicate: true,
      dupReasons: ["phone"],
      assignee: null,
      contact: {
        status: "not_contacted",
        label: "Not Contacted",
      },
      ageDays: 1,
    },
    {
      lead: {
        id: "lead_03",
        name: "Sunil Verma",
        phone: "+91 91234 56789",
        email: "sunil@zenith.in",
        company: "Zenith Retail",
        source: "Google Ads",
        status: "proposal",
        priority: "cold",
        requirement: "POS integration",
        createdAt: "2026-11-09T08:00:00.000Z",
      },
      status: "reviewed",
      reviewStatus: "reviewed",
      reviewedAt: "2026-11-10T12:00:00.000Z",
      flagged: false,
      flagNote: null,
      duplicate: false,
      dupReasons: [],
      assignee: null,
      contact: {
        status: "attempted",
        label: "Attempted Call",
      },
      ageDays: 2,
    },
  ],
  total: 3,
  overview: {
    awaitingReview: 2,
    unassigned: 2,
    duplicates: 2,
    needFirstContact: 1,
    recent: 3,
    needsReviewCount: 2,
    unassignedCount: 2,
    duplicatesCount: 2,
  },
  stats: {
    awaitingReview: 2,
    unassigned: 2,
    duplicates: 2,
    needFirstContact: 1,
    recent: 3,
    needsReviewCount: 2,
    unassignedCount: 2,
    duplicatesCount: 2,
  },
  pagination: {
    page: 1,
    pageSize: 50,
    total: 3,
  },
};

const MOCK_CANDIDATES: DupCandidateDto[] = [
  {
    id: "cand_phone_1",
    pairKey: "lead_01:lead_02",
    leadA: {
      id: "lead_01",
      name: "Rajesh Kumar",
      phone: "+91 98765 43210",
      email: "rajesh@acme.in",
      company: "Acme Corp",
      status: "new",
      priority: "hot",
    },
    leadB: {
      id: "lead_02",
      name: "R. Kumar",
      phone: "09876543210",
      email: "r.kumar@acme.in",
      company: "Acme",
      status: "contacted",
      priority: "warm",
    },
    reasons: ["phone"],
    strength: "confirmed",
    status: "pending",
    reopened: false,
    decisionKind: null,
    decisionNote: null,
    decidedAt: null,
    version: 1,
    createdAt: "2026-11-10T10:00:00.000Z",
    updatedAt: "2026-11-10T10:00:00.000Z",
  },
];

const MOCK_CANDIDATE_DETAIL: DupCandidateDetail = {
  ...MOCK_CANDIDATES[0]!,
  leadA: {
    ...MOCK_CANDIDATES[0]!.leadA,
    source: "Website",
    createdAt: "2026-11-10T10:00:00.000Z",
    contactStatus: { status: "established", label: "Contacted (Connected Call)" },
    stats: {
      dealsCount: 1,
      totalDealValuePaise: 5000000,
      paymentsCount: 1,
      totalPaidPaise: 2500000,
      callsCount: 3,
      quotationsCount: 1,
      projectsCount: 0,
    },
  },
  leadB: {
    ...MOCK_CANDIDATES[0]!.leadB,
    source: "Referral",
    createdAt: "2026-11-10T11:00:00.000Z",
    contactStatus: { status: "not_contacted", label: "Not Contacted" },
    stats: {
      dealsCount: 0,
      totalDealValuePaise: 0,
      paymentsCount: 0,
      totalPaidPaise: 0,
      callsCount: 0,
      quotationsCount: 0,
      projectsCount: 0,
    },
  },
  existingRelationship: null,
  mergeBlockers: ["Lead A has 1 active deal — merge would destroy financial integrity"],
};

const MOCK_RELATIONSHIPS: LeadRelationshipItem[] = [
  {
    relationshipId: "rel_01",
    pairKey: "lead_01:lead_02",
    otherLead: {
      id: "lead_02",
      name: "R. Kumar",
      phone: "09876543210",
      email: "r.kumar@acme.in",
      company: "Acme",
      status: "contacted",
    },
    kind: "separate",
    notes: "Different branch office locations",
    createdAt: "2026-11-10T12:00:00.000Z",
  },
];

describe("B9B: Smart Inbox, Duplicate Review & Lead Relationships UI Pilot", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: 0 },
        mutations: { retry: false },
      },
    });

    clearClientAuthState();
    hydrateAuthFromSsr(SSR_AUTH);

    // Mock global fetch to handle inbox endpoints
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : "";
      const method = init?.method ?? "GET";

      if (url.includes("/api/v1/inbox/candidates/cand_phone_1/decision")) {
        return new Response(
          JSON.stringify({
            ok: true,
            candidateId: "cand_phone_1",
            pairKey: "lead_01:lead_02",
            decision: "separate",
            relationship: {
              id: "rel_new",
              kind: "separate",
              notes: "Verified separate",
              createdAt: "2026-11-11T12:00:00.000Z",
            },
            candidate: {
              id: "cand_phone_1",
              status: "reviewed",
              decisionKind: "separate",
              decisionNote: "Verified separate",
              version: 2,
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }

      if (url.includes("/api/v1/inbox/candidates/cand_phone_1")) {
        return new Response(
          JSON.stringify({
            ok: true,
            candidate: {
              id: MOCK_CANDIDATE_DETAIL.id,
              pairKey: MOCK_CANDIDATE_DETAIL.pairKey,
              reasons: MOCK_CANDIDATE_DETAIL.reasons,
              strength: MOCK_CANDIDATE_DETAIL.strength,
              status: MOCK_CANDIDATE_DETAIL.status,
              reopened: MOCK_CANDIDATE_DETAIL.reopened,
              decisionKind: MOCK_CANDIDATE_DETAIL.decisionKind,
              decisionNote: MOCK_CANDIDATE_DETAIL.decisionNote,
              decidedAt: MOCK_CANDIDATE_DETAIL.decidedAt,
              version: MOCK_CANDIDATE_DETAIL.version,
              createdAt: MOCK_CANDIDATE_DETAIL.createdAt,
              updatedAt: MOCK_CANDIDATE_DETAIL.updatedAt,
            },
            leadA: MOCK_CANDIDATE_DETAIL.leadA,
            leadB: MOCK_CANDIDATE_DETAIL.leadB,
            mergeBlockers: MOCK_CANDIDATE_DETAIL.mergeBlockers,
            existingRelationship: MOCK_CANDIDATE_DETAIL.existingRelationship,
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        );
      }

      if (url.includes("/api/v1/inbox/candidates")) {
        return new Response(
          JSON.stringify({ ok: true, items: MOCK_CANDIDATES, total: MOCK_CANDIDATES.length }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }

      if (url.includes("/api/v1/inbox/scan")) {
        return new Response(
          JSON.stringify({
            ok: true,
            leadsEvaluated: 10,
            candidatesFound: 2,
            createdCount: 1,
            updatedCount: 0,
            reopenedCount: 0,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }

      if (url.includes("/api/v1/inbox/review")) {
        return new Response(
          JSON.stringify({ ok: true, affectedCount: 2, updatedCount: 2, action: "mark_reviewed" }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }

      if (url.includes("/api/v1/inbox/flag")) {
        return new Response(
          JSON.stringify({ ok: true, leadId: "lead_01", flagged: true, flagNote: "Branch lead" }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }

      if (url.includes("/api/v1/inbox/review-history")) {
        return new Response(
          JSON.stringify({
            ok: true,
            items: [
              {
                id: "irae_01",
                pairKey: "lead_01:lead_02",
                action: "mark_separate",
                notes: "Verified separate entities",
                actorUserId: "usr_owner_alpha",
                createdAt: "2026-11-10T12:00:00.000Z",
              },
            ],
            total: 1,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }

      if (url.includes("/api/v1/leads/lead_01/relationships")) {
        return new Response(JSON.stringify({ ok: true, items: MOCK_RELATIONSHIPS }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      if (url.includes("/api/v1/leads/relationships/lead_01%3Alead_02") && method === "DELETE") {
        return new Response(
          JSON.stringify({ ok: true, unlinked: true, pairKey: "lead_01:lead_02" }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }

      if (url.includes("/api/v1/inbox")) {
        return new Response(JSON.stringify(MOCK_INBOX_RESPONSE), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function renderWithProviders(ui: React.ReactElement) {
    return render(
      <AuthSsrProvider value={SSR_AUTH}>
        <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>
      </AuthSsrProvider>,
    );
  }

  it("renders PilotSmartInbox overview metrics and lead queue from MariaDB", async () => {
    renderWithProviders(<PilotInboxPage search={{ pilot: 1 }} />);

    // Check title and metrics cards
    expect(await screen.findByText(/Smart Lead Inbox \(Pilot\)/i)).toBeInTheDocument();
    expect(screen.getByText("Awaiting review")).toBeInTheDocument();
    expect(screen.getByText("Duplicate candidates")).toBeInTheDocument();
    expect(screen.getByText("Need first contact")).toBeInTheDocument();

    // Check lead items
    expect(await screen.findByText("Rajesh Kumar")).toBeInTheDocument();
    expect(screen.getByText("R. Kumar")).toBeInTheDocument();
    expect(screen.getByText("Sunil Verma")).toBeInTheDocument();

    // Verify contact status badges
    expect(screen.getByText("Contacted (Connected Call)")).toBeInTheDocument();
    expect(screen.getByText("Not Contacted")).toBeInTheDocument();
  });

  it("distinguishes match strength as Strong Match — Phone rather than Owner Confirmed", async () => {
    renderWithProviders(<PilotInboxPage search={{ pilot: 1 }} />);

    // The candidate button should show "Strong Match — phone", NOT "Owner Confirmed"
    const matchBadge = await screen.findAllByText(/Strong Match/i);
    expect(matchBadge.length).toBeGreaterThan(0);
    expect(screen.queryByText(/Owner Confirmed Duplicate/i)).toBeNull();
  });

  it("opens PilotDuplicateReviewDialog, displays comparison, merge blockers, and keeps leads separate", async () => {
    const handleClose = vi.fn();
    const handleSaved = vi.fn();

    renderWithProviders(
      <PilotDuplicateReviewDialog
        candidateId="cand_phone_1"
        onClose={handleClose}
        onDecisionSaved={handleSaved}
      />,
    );

    // Dialog title and strength disclosure
    expect(await screen.findByText(/Duplicate Review & Comparison/i)).toBeInTheDocument();
    expect(await screen.findByText(/Strong Match — Phone\/Email/i)).toBeInTheDocument();

    // Zero-merge guarantee notice
    expect(screen.getByText(/Zero Data Loss & Identity Preservation/i)).toBeInTheDocument();

    // Side-by-side attributes
    expect(screen.getByText("Acme Corp")).toBeInTheDocument();
    expect(screen.getByText("+91 98765 43210")).toBeInTheDocument();
    expect(screen.getByText("09876543210")).toBeInTheDocument();

    // Merge blockers disclosure
    expect(screen.getByText(/Merge Blockers Disclosed/i)).toBeInTheDocument();
    expect(
      screen.getByText(/Lead A has 1 active deal — merge would destroy financial integrity/i),
    ).toBeInTheDocument();

    // Click "Keep Separate"
    const separateBtn = screen.getByRole("button", { name: /Keep Separate/i });
    fireEvent.click(separateBtn);

    await waitFor(() => {
      expect(handleSaved).toHaveBeenCalled();
      expect(handleClose).toHaveBeenCalled();
    });
  });

  it("renders PilotLeadRelationshipsCard and supports safe unlinking", async () => {
    renderWithProviders(<PilotLeadRelationshipsCard leadId="lead_01" />);

    expect(await screen.findByText(/Active Lead Relationships/i)).toBeInTheDocument();
    expect(screen.getByText("Kept Separate")).toBeInTheDocument();
    expect(screen.getByText(/Different branch office locations/i)).toBeInTheDocument();

    // Open unlink dialog
    const unlinkBtn = screen.getByRole("button", { name: /Unlink/i });
    fireEvent.click(unlinkBtn);

    expect(await screen.findByText(/Unlink Lead Relationship\?/i)).toBeInTheDocument();
    const confirmBtn = screen.getByRole("button", { name: /Confirm Unlink/i });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(screen.queryByText(/Unlink Lead Relationship\?/i)).toBeNull();
    });
  });
});
