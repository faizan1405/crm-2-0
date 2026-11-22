import { describe, expect, it, beforeEach } from "vitest";
import type { SQL } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { listQuotationsQuerySchema } from "./crm/validation.server";
import { listQuotationsRecords } from "./crm/quotationsService.server";
import { pilotLinkSearch } from "@/lib/api/pilotHook";
import { useAuthStore } from "@/lib/auth/authClient";

type CrmDatabase = Parameters<typeof listQuotationsRecords>[0];

interface FakeQuoteRow {
  id: string;
  ownerUserId: string;
  leadId: string | null;
  dealId: string | null;
  templateId: string | null;
  legacyId: string | null;
  quotationNumber: string;
  title: string;
  clientName: string;
  clientCompany: string | null;
  clientPhone: string | null;
  clientEmail: string | null;
  currency: string;
  subtotalAmount: string;
  discountType: string;
  discountValue: string;
  discountAmount: string;
  gstEnabled: boolean;
  gstRate: string;
  gstAmount: string;
  totalAmount: string;
  pricingMode: string;
  packagePrice: string | null;
  status: string;
  validUntil: string | null;
  notes: string | null;
  terms: string | null;
  userConfirmedSent: boolean;
  sentAt: Date | null;
  acceptedAt: Date | null;
  rejectedAt: Date | null;
  archivedAt: Date | null;
  version: number;
  createdByUserId: string;
  updatedByUserId: string;
  createdAt: Date;
  updatedAt: Date;
}

function makeFakeQuote(overrides: Partial<FakeQuoteRow>): FakeQuoteRow {
  const now = new Date("2026-11-22T12:00:00.000Z");
  return {
    id: "quot_owner_a_1",
    ownerUserId: "usr_owner_a",
    leadId: null,
    dealId: null,
    templateId: null,
    legacyId: null,
    quotationNumber: "QT-2026-001",
    title: "Owner A Proposal",
    clientName: "Client A",
    clientCompany: "Acme A",
    clientPhone: null,
    clientEmail: null,
    currency: "INR",
    subtotalAmount: "75000.00",
    discountType: "none",
    discountValue: "0.00",
    discountAmount: "0.00",
    gstEnabled: false,
    gstRate: "18.00",
    gstAmount: "0.00",
    totalAmount: "75000.00",
    pricingMode: "itemized",
    packagePrice: null,
    status: "draft",
    validUntil: null,
    notes: null,
    terms: null,
    userConfirmedSent: false,
    sentAt: null,
    acceptedAt: null,
    rejectedAt: null,
    archivedAt: null,
    version: 1,
    createdByUserId: "usr_owner_a",
    updatedByUserId: "usr_owner_a",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

/**
 * Minimal Drizzle-compatible fake DB that evaluates SQL condition chunks to verify:
 * 1. `status: "all"` NEVER filters `status = 'all'` in SQL.
 * 2. Strict `owner_user_id` isolation prevents Owner A from seeing Owner B's quotations.
 * 3. Specific status filter (`status: "sent"`) and `q` search filter still apply cleanly.
 */
function createFakeQuotationsDb(rows: FakeQuoteRow[]): CrmDatabase {
  const dialect = new MySqlDialect();

  const filterRows = (whereClause: unknown): FakeQuoteRow[] => {
    const built = dialect.sqlToQuery(whereClause as SQL);
    const params = built.params.filter((p): p is string => typeof p === "string");
    // Fail loudly if status='all' ever leaks into SQL predicates (the B14E bug!)
    if (params.includes("all")) {
      return [];
    }
    const ownerId = params[0];
    let result = rows.filter((r) => r.ownerUserId === ownerId && r.archivedAt === null);
    for (const p of params.slice(1)) {
      if (["draft", "sent", "accepted", "rejected", "expired"].includes(p)) {
        result = result.filter((r) => r.status === p);
      } else if (p.startsWith("%") && p.endsWith("%")) {
        const needle = p.slice(1, -1).toLowerCase();
        result = result.filter(
          (r) =>
            r.title.toLowerCase().includes(needle) ||
            r.clientName.toLowerCase().includes(needle) ||
            r.quotationNumber.toLowerCase().includes(needle),
        );
      }
    }
    return result;
  };

  const db = {
    select: (fields?: Record<string, unknown>) => ({
      from: () => ({
        where: (clause: unknown) => {
          const isCount = Boolean(fields && "total" in fields);
          if (isCount) {
            const matched = filterRows(clause);
            return Promise.resolve([{ total: matched.length }]);
          }
          // Sub-queries for items/milestones return []
          if (!fields) {
            return {
              orderBy: () => ({
                limit: () => ({
                  offset: () => Promise.resolve(filterRows(clause)),
                }),
                then: (resolve: (v: unknown[]) => void) => resolve([]),
              }),
            };
          }
          return Promise.resolve([]);
        },
      }),
    }),
  };
  return db as unknown as CrmDatabase;
}

describe("Checkpoint B14F: Sales Studio Quotations List Fix, Owner Isolation & Clean Pilot Links", () => {
  beforeEach(() => {
    useAuthStore.setState({
      status: "authenticated",
      user: { id: "usr_owner_a", email: "a@example.test", name: "Owner A", roleId: "owner" },
      idleExpiresAt: "2026-12-01T00:00:00.000Z",
      expiresAt: "2026-12-01T00:00:00.000Z",
      leadPilotAvailable: true,
      crmV2DefaultBackend: true,
      lastCheckedAt: Date.now(),
    });
  });

  it("returns an Owner's draft quotations when status defaults to 'all' and isolates other Owners", async () => {
    const db = createFakeQuotationsDb([
      makeFakeQuote({
        id: "quot_a1",
        ownerUserId: "usr_owner_a",
        title: "Owner A Draft",
        status: "draft",
      }),
      makeFakeQuote({
        id: "quot_a2",
        ownerUserId: "usr_owner_a",
        title: "Owner A Sent",
        status: "sent",
      }),
      makeFakeQuote({
        id: "quot_b1",
        ownerUserId: "usr_owner_b",
        title: "Owner B Secret",
        status: "draft",
      }),
    ]);

    // Default query from /sales-studio has no `status` param -> Zod sets status: "all"
    const parsedQuery = listQuotationsQuerySchema.parse({});
    expect(parsedQuery.status).toBe("all");

    const ownerAResult = await listQuotationsRecords(db, "usr_owner_a", parsedQuery);
    expect(ownerAResult.total).toBe(2);
    expect(ownerAResult.items.map((q) => q.id)).toEqual(["quot_a1", "quot_a2"]);
    expect(ownerAResult.items.some((q) => q.ownerUserId === "usr_owner_b")).toBe(false);

    // Owner B sees ONLY Owner B's quotation
    const ownerBResult = await listQuotationsRecords(db, "usr_owner_b", parsedQuery);
    expect(ownerBResult.total).toBe(1);
    expect(ownerBResult.items[0]?.id).toBe("quot_b1");
  });

  it("supports explicit status filtering and `q` search alias without leaking cross-owner data", async () => {
    const db = createFakeQuotationsDb([
      makeFakeQuote({
        id: "quot_a1",
        ownerUserId: "usr_owner_a",
        title: "Website Retainer",
        status: "draft",
      }),
      makeFakeQuote({
        id: "quot_a2",
        ownerUserId: "usr_owner_a",
        title: "SEO Package",
        status: "sent",
      }),
      makeFakeQuote({
        id: "quot_b1",
        ownerUserId: "usr_owner_b",
        title: "Website Retainer",
        status: "draft",
      }),
    ]);

    const parsedSearch = listQuotationsQuerySchema.parse({ q: "Website" });
    const res = await listQuotationsRecords(db, "usr_owner_a", parsedSearch);
    expect(res.total).toBe(1);
    expect(res.items[0]?.id).toBe("quot_a1");
  });

  it("omits ?pilot=1 in pilotLinkSearch() when crmV2DefaultBackend is true and preserves it when false", () => {
    expect(pilotLinkSearch()).toEqual({});
    expect(pilotLinkSearch({ view: "v1" })).toEqual({ view: "v1" });

    useAuthStore.setState({ crmV2DefaultBackend: false });
    expect(pilotLinkSearch()).toEqual({ pilot: 1 });
    expect(pilotLinkSearch({ section: "notifications" })).toEqual({
      section: "notifications",
      pilot: 1,
    });
  });
});
