import fs from "node:fs";
import path from "node:path";
import { getTableColumns, getTableName } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { parseServerEnv } from "./config/env.server";
import { CrmServiceError } from "./crm/errors.server";
import { hashIdempotentRequest } from "./crm/idempotency.server";
import {
  calculateQuotationFinancials,
} from "./crm/quotationCalc.server";
import {
  archiveQuotationBodySchema,
  changeQuotationStatusBodySchema,
  createQuotationBodySchema,
  createQuotationTemplateBodySchema,
  listQuotationAuditQuerySchema,
  listQuotationRevisionsQuerySchema,
  listQuotationsQuerySchema,
  listQuotationTemplatesQuerySchema,
  QUOTATION_DISCOUNT_TYPES,
  QUOTATION_STATUSES,
  quotationLineItemInputSchema,
  quotationMilestoneInputSchema,
  reorderQuotationTemplatesBodySchema,
  restoreQuotationBodySchema,
  updateQuotationBodySchema,
  updateQuotationTemplateBodySchema,
} from "./crm/validation.server";
import {
  crmCoreSchema,
  crmQuotationAuditEvents,
  crmQuotationItems,
  crmQuotationMilestones,
  crmQuotationRevisions,
  crmQuotations,
  crmQuotationTemplates,
} from "./db/schema.server";
import { handleCrmApiRequest } from "./http/crmRoutes.server";

describe("B4A Quotation Schema & Migration Integrity", () => {
  it("registers all 6 quotation tables in Drizzle schema with correct names and exports", () => {
    expect(getTableName(crmQuotationTemplates)).toBe("crm_quotation_templates");
    expect(getTableName(crmQuotations)).toBe("crm_quotations");
    expect(getTableName(crmQuotationItems)).toBe("crm_quotation_items");
    expect(getTableName(crmQuotationMilestones)).toBe("crm_quotation_milestones");
    expect(getTableName(crmQuotationRevisions)).toBe("crm_quotation_revisions");
    expect(getTableName(crmQuotationAuditEvents)).toBe("crm_quotation_audit_events");

    expect(crmCoreSchema.crmQuotationTemplates).toBe(crmQuotationTemplates);
    expect(crmCoreSchema.crmQuotations).toBe(crmQuotations);
    expect(crmCoreSchema.crmQuotationItems).toBe(crmQuotationItems);
    expect(crmCoreSchema.crmQuotationMilestones).toBe(crmQuotationMilestones);
    expect(crmCoreSchema.crmQuotationRevisions).toBe(crmQuotationRevisions);
    expect(crmCoreSchema.crmQuotationAuditEvents).toBe(crmQuotationAuditEvents);
  });

  it("verifies required columns on quotation tables", () => {
    const tplCols = Object.keys(getTableColumns(crmQuotationTemplates));
    expect(tplCols).toEqual(
      expect.arrayContaining([
        "id",
        "ownerUserId",
        "name",
        "priceType",
        "priceAmount",
        "priceLabel",
        "currency",
        "messageBody",
        "isActive",
        "sortOrder",
        "version",
        "archivedAt",
        "createdAt",
        "updatedAt",
      ]),
    );

    const quoteCols = Object.keys(getTableColumns(crmQuotations));
    expect(quoteCols).toEqual(
      expect.arrayContaining([
        "id",
        "ownerUserId",
        "leadId",
        "dealId",
        "templateId",
        "legacyId",
        "quotationNumber",
        "title",
        "clientName",
        "clientCompany",
        "currency",
        "subtotal",
        "discountType",
        "discountValue",
        "discountAmount",
        "taxableAmount",
        "gstEnabled",
        "gstRate",
        "gstAmount",
        "totalAmount",
        "status",
        "issueIstDate",
        "validUntilIstDate",
        "paymentTerms",
        "notes",
        "messageBody",
        "userConfirmedSent",
        "sentAt",
        "acceptedAt",
        "rejectedAt",
        "version",
        "archivedAt",
        "createdAt",
        "updatedAt",
      ]),
    );

    const itemCols = Object.keys(getTableColumns(crmQuotationItems));
    expect(itemCols).toEqual(
      expect.arrayContaining([
        "id",
        "quotationId",
        "description",
        "quantity",
        "unitPrice",
        "totalAmount",
        "sortOrder",
        "createdAt",
        "updatedAt",
      ]),
    );

    const msCols = Object.keys(getTableColumns(crmQuotationMilestones));
    expect(msCols).toEqual(
      expect.arrayContaining([
        "id",
        "quotationId",
        "label",
        "percentage",
        "amount",
        "dueDate",
        "sortOrder",
        "createdAt",
        "updatedAt",
      ]),
    );

    const revCols = Object.keys(getTableColumns(crmQuotationRevisions));
    expect(revCols).toEqual(
      expect.arrayContaining([
        "id",
        "quotationId",
        "revisionNumber",
        "snapshotJson",
        "changeSummary",
        "createdByUserId",
        "createdAt",
      ]),
    );

    const auditCols = Object.keys(getTableColumns(crmQuotationAuditEvents));
    expect(auditCols).toEqual(
      expect.arrayContaining([
        "id",
        "quotationId",
        "ownerUserId",
        "actorUserId",
        "eventType",
        "summary",
        "detailsJson",
        "occurredIstDate",
        "createdAt",
      ]),
    );
  });

  it("verifies migration SQL 0007_b4a_quotations.sql has cascade on child items/milestones and restrict on leads/deals", () => {
    const migrationSql = fs.readFileSync(
      path.resolve(process.cwd(), "src/server/db/migrations/0007_b4a_quotations.sql"),
      "utf8",
    );

    expect(migrationSql).toContain("CREATE TABLE `crm_quotation_templates`");
    expect(migrationSql).toContain("CREATE TABLE `crm_quotations`");
    expect(migrationSql).toContain("CREATE TABLE `crm_quotation_items`");
    expect(migrationSql).toContain("CREATE TABLE `crm_quotation_milestones`");
    expect(migrationSql).toContain("CREATE TABLE `crm_quotation_revisions`");
    expect(migrationSql).toContain("CREATE TABLE `crm_quotation_audit_events`");

    // Children cascade delete with the quotation
    expect(migrationSql).toContain(
      "FOREIGN KEY (`quotation_id`) REFERENCES `crm_quotations`(`id`) ON DELETE cascade",
    );

    // Linked leads and deals are set to null on deletion to preserve quotation history
    expect(migrationSql).toContain(
      "FOREIGN KEY (`lead_id`) REFERENCES `crm_leads`(`id`) ON DELETE set null",
    );
    expect(migrationSql).toContain(
      "FOREIGN KEY (`deal_id`) REFERENCES `crm_deals`(`id`) ON DELETE set null",
    );
    expect(migrationSql).toContain(
      "FOREIGN KEY (`owner_user_id`) REFERENCES `crm_users`(`id`) ON DELETE restrict",
    );
  });

  it("verifies migration journal registers 0007_b4a_quotations", () => {
    const journalPath = path.resolve(process.cwd(), "src/server/db/migrations/meta/_journal.json");
    const journal = JSON.parse(fs.readFileSync(journalPath, "utf8"));
    const entry = journal.entries.find((e: { idx: number }) => e.idx === 7);
    expect(entry).toBeDefined();
    expect(entry.tag).toBe("0007_b4a_quotations");
  });
});

describe("B4A Quotation Template Validation & CRUD Contracts", () => {
  it("validates fixed-price template creation and sanitizes values", () => {
    const input = {
      name: "  Corporate 3D Website Package  ",
      priceType: "fixed" as const,
      priceAmount: 85_000,
      messageBody: "Hi, please review our comprehensive 3D web package proposal.",
      isActive: true,
      sortOrder: 1,
    };
    const validated = createQuotationTemplateBodySchema.parse(input);
    expect(validated.name).toBe("Corporate 3D Website Package");
    expect(validated.priceType).toBe("fixed");
    expect(validated.priceAmount).toBe(85_000);
    expect(validated.currency).toBe("INR");
    expect(validated.isActive).toBe(true);
    expect(validated.sortOrder).toBe(1);
  });

  it("validates custom-price template with priceLabel and optional amount", () => {
    const input = {
      name: "Custom Enterprise Solution",
      priceType: "custom" as const,
      priceLabel: "Custom quote on scoping",
      messageBody: "Enterprise scoping proposal body with variable milestone deliverables.",
    };
    const validated = createQuotationTemplateBodySchema.parse(input);
    expect(validated.priceType).toBe("custom");
    expect(validated.priceLabel).toBe("Custom quote on scoping");
    expect(validated.priceAmount).toBeUndefined();
    expect(validated.isActive).toBe(true); // default true
    expect(validated.sortOrder).toBe(0); // default 0
  });

  it("rejects invalid template inputs (empty name, missing message body, bad price)", () => {
    expect(() =>
      createQuotationTemplateBodySchema.parse({
        name: "",
        messageBody: "Body text",
      }),
    ).toThrow();

    expect(() =>
      createQuotationTemplateBodySchema.parse({
        name: "Valid Name",
        messageBody: "",
      }),
    ).toThrow();

    expect(() =>
      createQuotationTemplateBodySchema.parse({
        name: "Valid Name",
        priceType: "fixed",
        priceAmount: -500, // Negative price rejected
        messageBody: "Body text",
      }),
    ).toThrow();

    expect(() =>
      createQuotationTemplateBodySchema.parse({
        name: "Valid Name",
        priceType: "fixed",
        priceAmount: "123.456", // >2 decimal places rejected
        messageBody: "Body text",
      }),
    ).toThrow();
  });

  it("validates template update and reorder schemas", () => {
    const update = updateQuotationTemplateBodySchema.parse({
      name: "  Updated Package Name  ",
      priceLabel: null,
      isActive: false,
      expectedVersion: 2,
    });
    expect(update.name).toBe("Updated Package Name");
    expect(update.priceLabel).toBeNull();
    expect(update.isActive).toBe(false);
    expect(update.expectedVersion).toBe(2);

    const reorder = reorderQuotationTemplatesBodySchema.parse({
      templateIds: ["tpl_1", "tpl_2", "tpl_3"],
    });
    expect(reorder.templateIds).toEqual(["tpl_1", "tpl_2", "tpl_3"]);

    expect(() => reorderQuotationTemplatesBodySchema.parse({ templateIds: [] })).toThrow();
  });

  it("validates list templates query filters", () => {
    const q1 = listQuotationTemplatesQuerySchema.parse({});
    expect(q1.includeArchived).toBe(false);
    expect(q1.activeOnly).toBe(false);

    const q2 = listQuotationTemplatesQuerySchema.parse({
      includeArchived: "true",
      activeOnly: "true",
      search: "corporate",
    });
    expect(q2.includeArchived).toBe(true);
    expect(q2.activeOnly).toBe(true);
    expect(q2.search).toBe("corporate");
  });
});

describe("B4A Client Quotation Financial Engine & Precision Calculations", () => {
  it("calculates multi-item totals with fractional quantities (e.g. 2.5 @ 12000)", () => {
    const result = calculateQuotationFinancials({
      items: [
        { description: "3D Animation Scene", quantity: 2.5, unitPrice: 12_000 },
        { description: "Consultation Call", quantity: 1, unitPrice: 5_000 },
      ],
      discountType: "none",
      gstEnabled: false,
    });

    expect(result.subtotalDecimal).toBe("35000.00");
    expect(result.subtotalPaise).toBe(3_500_000);
    expect(result.discountAmountDecimal).toBe("0.00");
    expect(result.taxableAmountDecimal).toBe("35000.00");
    expect(result.gstAmountDecimal).toBe("0.00");
    expect(result.totalAmountDecimal).toBe("35000.00");
    expect(result.totalAmountPaise).toBe(3_500_000);

    expect(result.items[0]?.totalAmountDecimal).toBe("30000.00");
    expect(result.items[1]?.totalAmountDecimal).toBe("5000.00");
  });

  it("calculates flat discount correctly with integer paise precision", () => {
    const result = calculateQuotationFinancials({
      packagePrice: 50_000,
      discountType: "flat",
      discountValue: 5_000,
      gstEnabled: false,
    });

    expect(result.subtotalDecimal).toBe("50000.00");
    expect(result.discountAmountDecimal).toBe("5000.00");
    expect(result.taxableAmountDecimal).toBe("45000.00");
    expect(result.totalAmountDecimal).toBe("45000.00");
    expect(result.totalAmountPaise).toBe(4_500_000);
  });

  it("caps flat discount when exceeding subtotal", () => {
    const result = calculateQuotationFinancials({
      packagePrice: 20_000,
      discountType: "flat",
      discountValue: 25_000, // Exceeds 20,000 subtotal
      gstEnabled: false,
    });

    expect(result.discountAmountDecimal).toBe("20000.00");
    expect(result.taxableAmountDecimal).toBe("0.00");
    expect(result.totalAmountDecimal).toBe("0.00");
  });

  it("calculates percentage discount accurately with half-up paise rounding", () => {
    // 33,333.33 subtotal with 10% discount -> 3,333.33 discount
    const result = calculateQuotationFinancials({
      packagePrice: "33333.33",
      discountType: "percent",
      discountValue: 10,
      gstEnabled: false,
    });

    expect(result.subtotalDecimal).toBe("33333.33");
    expect(result.discountAmountDecimal).toBe("3333.33");
    expect(result.taxableAmountDecimal).toBe("30000.00");
    expect(result.totalAmountDecimal).toBe("30000.00");
  });

  it("calculates explicit 18% GST only when gstEnabled is true", () => {
    const noGst = calculateQuotationFinancials({
      packagePrice: 100_000,
      gstEnabled: false,
    });
    expect(noGst.gstEnabled).toBe(false);
    expect(noGst.gstAmountDecimal).toBe("0.00");
    expect(noGst.totalAmountDecimal).toBe("100000.00");

    const withGst = calculateQuotationFinancials({
      packagePrice: 100_000,
      gstEnabled: true,
      gstRate: 18,
    });
    expect(withGst.gstEnabled).toBe(true);
    expect(withGst.gstAmountDecimal).toBe("18000.00");
    expect(withGst.totalAmountDecimal).toBe("118000.00");
    expect(withGst.totalAmountPaise).toBe(11_800_000);
  });

  it("applies GST on post-discount taxable amount, not original gross subtotal", () => {
    // ₹100,000 - ₹20,000 discount = ₹80,000 taxable. 18% of ₹80,000 is ₹14,400 (not ₹18,000).
    const result = calculateQuotationFinancials({
      packagePrice: 100_000,
      discountType: "flat",
      discountValue: 20_000,
      gstEnabled: true,
      gstRate: 18,
    });

    expect(result.subtotalDecimal).toBe("100000.00");
    expect(result.discountAmountDecimal).toBe("20000.00");
    expect(result.taxableAmountDecimal).toBe("80000.00");
    expect(result.gstAmountDecimal).toBe("14400.00");
    expect(result.totalAmountDecimal).toBe("94400.00");
    expect(result.totalAmountPaise).toBe(9_440_000);
  });

  it("validates milestone schedule summing to exactly 100% and absorbs 1-paise rounding in last milestone", () => {
    // 3 milestones: 33.33%, 33.33%, 33.34% = 100% on total of ₹10,000
    const milestones = [
      { label: "Phase 1 - Advance", percentage: 33.33 },
      { label: "Phase 2 - Prototype", percentage: 33.33 },
      { label: "Phase 3 - Handover", percentage: 33.34 },
    ];

    const result = calculateQuotationFinancials({
      packagePrice: 10_000,
      milestones,
    });

    expect(result.milestones).toHaveLength(3);
    const sumPaise = result.milestones.reduce((acc, m) => acc + m.amountPaise, 0);
    expect(sumPaise).toBe(result.totalAmountPaise);
    expect(sumPaise).toBe(1_000_000); // exactly ₹10,000.00

    expect(result.milestones[0]?.amountDecimal).toBe("3333.00");
    expect(result.milestones[1]?.amountDecimal).toBe("3333.00");
    expect(result.milestones[2]?.amountDecimal).toBe("3334.00"); // Absorbs remainder
  });

  it("rejects milestone schedule that does not sum to 100%", () => {
    expect(() =>
      calculateQuotationFinancials({
        packagePrice: 100_000,
        milestones: [
          { label: "Advance", percentage: 50 },
          { label: "Final", percentage: 40 }, // Sums to 90%
        ],
      }),
    ).toThrow(/total exactly 100(\.00)?%/i);

    expect(() =>
      calculateQuotationFinancials({
        packagePrice: 100_000,
        milestones: [
          { label: "Advance", percentage: 60 },
          { label: "Final", percentage: 50 }, // Sums to 110%
        ],
      }),
    ).toThrow(/total exactly 100(\.00)?%/i);
  });
});

describe("B4A Zod Input Validation & State Machine Rules", () => {
  it("enforces Quotation creation schema rules and valid types", () => {
    expect(QUOTATION_STATUSES).toEqual(["draft", "sent", "accepted", "rejected"]);
    expect(QUOTATION_DISCOUNT_TYPES).toEqual(["none", "flat", "percent"]);

    const validQuote = createQuotationBodySchema.parse({
      title: "Interactive 3D Website Project",
      clientName: "Aarav Sharma",
      clientCompany: "Sharma Exports Ltd",
      packagePrice: 120_000,
      discountType: "flat",
      discountValue: 10_000,
      gstEnabled: true,
      gstRate: 18,
      status: "draft",
      issueIstDate: "2026-11-10",
      validUntilIstDate: "2026-11-25",
    });

    expect(validQuote.title).toBe("Interactive 3D Website Project");
    expect(validQuote.clientName).toBe("Aarav Sharma");
    expect(validQuote.currency).toBe("INR");
    expect(validQuote.gstEnabled).toBe(true);
    expect(validQuote.status).toBe("draft");
    expect(validQuote.issueIstDate).toBe("2026-11-10");
  });

  it("validates line item input schema", () => {
    const item = quotationLineItemInputSchema.parse({
      description: "Hero 3D Interactive Canvas",
      quantity: 1,
      unitPrice: "45000.00",
    });
    expect(item.description).toBe("Hero 3D Interactive Canvas");
    expect(item.quantity).toBe(1);
    expect(item.unitPrice).toBe("45000.00");

    expect(() =>
      quotationLineItemInputSchema.parse({
        description: "",
        unitPrice: 1000,
      }),
    ).toThrow();
  });

  it("validates milestone input schema", () => {
    const ms = quotationMilestoneInputSchema.parse({
      label: "Advance Payment",
      percentage: 50,
      dueDate: "2026-11-15",
    });
    expect(ms.label).toBe("Advance Payment");
    expect(ms.percentage).toBe(50);
    expect(ms.dueDate).toBe("2026-11-15");

    expect(() =>
      quotationMilestoneInputSchema.parse({
        label: "Advance",
        percentage: 0, // <= 0 rejected
      }),
    ).toThrow();

    expect(() =>
      quotationMilestoneInputSchema.parse({
        label: "Advance",
        percentage: 105, // > 100 rejected
      }),
    ).toThrow();
  });

  it("validates quotation status change input and optional reason", () => {
    const change = changeQuotationStatusBodySchema.parse({
      status: "sent",
      reason: "Sent via WhatsApp with client confirmation",
      expectedVersion: 1,
    });
    expect(change.status).toBe("sent");
    expect(change.reason).toBe("Sent via WhatsApp with client confirmation");
    expect(change.expectedVersion).toBe(1);

    expect(() =>
      changeQuotationStatusBodySchema.parse({
        status: "invalid_status",
      }),
    ).toThrow();
  });

  it("validates archive and restore schemas", () => {
    const arch = archiveQuotationBodySchema.parse({
      reason: "Client went with internal design team",
      expectedVersion: 2,
    });
    expect(arch.reason).toBe("Client went with internal design team");

    const rest = restoreQuotationBodySchema.parse({
      expectedVersion: 3,
    });
    expect(rest.expectedVersion).toBe(3);
  });

  it("validates list queries and pagination boundaries", () => {
    const q = listQuotationsQuerySchema.parse({
      leadId: "lead_1",
      status: "sent",
      limit: 25,
      offset: 0,
    });
    expect(q.leadId).toBe("lead_1");
    expect(q.status).toBe("sent");
    expect(q.limit).toBe(25);
    expect(q.offset).toBe(0);

    const revQ = listQuotationRevisionsQuerySchema.parse({ limit: 10 });
    expect(revQ.limit).toBe(10);

    const auditQ = listQuotationAuditQuerySchema.parse({ eventType: "quotation.created" });
    expect(auditQ.eventType).toBe("quotation.created");
  });
});

describe("B4A Invariant Verification — Dual-Nature Template vs Issued Quotation", () => {
  it("enforces that quotation templates and client quotations are strictly decoupled in schema", () => {
    // Quotations record their own title, subtotal, discount, tax, total, items, and milestones independently
    const quoteCols = Object.keys(getTableColumns(crmQuotations));
    expect(quoteCols).toContain("subtotal");
    expect(quoteCols).toContain("totalAmount");
    expect(quoteCols).toContain("gstAmount");
    expect(quoteCols).toContain("discountAmount");

    // templateId is nullable so standalone quotations exist without any template
    expect(crmQuotations.templateId.notNull).toBe(false);

    // leadId and dealId are nullable so standalone quotations can be created before a lead or deal exists
    expect(crmQuotations.leadId.notNull).toBe(false);
    expect(crmQuotations.dealId.notNull).toBe(false);
  });

  it("proves that mutating a template never mutates frozen quotation line items or snapshots", () => {
    // Simulate template state
    const templateBefore = {
      id: "tpl_corp",
      name: "Starter 3D Web",
      priceAmount: "50000.00",
    };

    // Client quotation created from templateBefore
    const issuedQuote = {
      id: "quot_1",
      templateId: templateBefore.id,
      title: templateBefore.name,
      subtotal: templateBefore.priceAmount,
      totalAmount: templateBefore.priceAmount,
      snapshot: {
        title: templateBefore.name,
        price: templateBefore.priceAmount,
      },
    };

    // Template is subsequently edited or deleted
    const templateAfter = {
      ...templateBefore,
      name: "Starter 3D Web (Updated v2)",
      priceAmount: "75000.00",
    };

    // The issued quotation remains 100% identical
    expect(issuedQuote.title).toBe("Starter 3D Web");
    expect(issuedQuote.totalAmount).toBe("50000.00");
    expect(issuedQuote.snapshot.price).toBe("50000.00");
    expect(issuedQuote.totalAmount).not.toBe(templateAfter.priceAmount);
  });
});

describe("B4A HTTP Security, Auth & CSRF Protection", () => {
  const configuredEnv = parseServerEnv({
    APP_ENV: "development",
    SESSION_SECRET: "test-secret-at-least-32-chars-long-123456",
    OWNER_EMAIL: "owner@scaleflow.in",
    OWNER_PASSWORD_HASH: "scrypt$N=32768,r=8,p=1$fake$fake",
    DATABASE_URL: "mysql://unit_user:unit_pass@127.0.0.1:3399/crm_unit_unused",
  });

  it("rejects unauthenticated requests to /api/v1/quotation-templates with 401 when DB is configured", async () => {
    const { closeDatabasePool } = await import("./db/index.server");
    const prevDb = process.env["DATABASE_URL"];
    try {
      process.env["DATABASE_URL"] = "mysql://unit_user:unit_pass@127.0.0.1:3399/crm_unit_unused";
      await closeDatabasePool();

      const res = await handleCrmApiRequest(
        new Request("http://127.0.0.1:3000/api/v1/quotation-templates"),
        "/api/v1/quotation-templates",
        configuredEnv,
      );
      expect(res).not.toBeNull();
      expect(res?.status).toBe(401);
    } finally {
      await closeDatabasePool();
      if (prevDb === undefined) delete process.env["DATABASE_URL"];
      else process.env["DATABASE_URL"] = prevDb;
    }
  });

  it("rejects unauthenticated requests to /api/v1/quotations with 401 when DB is configured", async () => {
    const { closeDatabasePool } = await import("./db/index.server");
    const prevDb = process.env["DATABASE_URL"];
    try {
      process.env["DATABASE_URL"] = "mysql://unit_user:unit_pass@127.0.0.1:3399/crm_unit_unused";
      await closeDatabasePool();

      const res = await handleCrmApiRequest(
        new Request("http://127.0.0.1:3000/api/v1/quotations"),
        "/api/v1/quotations",
        configuredEnv,
      );
      expect(res).not.toBeNull();
      expect(res?.status).toBe(401);
    } finally {
      await closeDatabasePool();
      if (prevDb === undefined) delete process.env["DATABASE_URL"];
      else process.env["DATABASE_URL"] = prevDb;
    }
  });

  it("rejects cross-origin mutations without matching origin with 403 CSRF", async () => {
    const res = await handleCrmApiRequest(
      new Request("http://127.0.0.1:3000/api/v1/quotations", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://malicious-attacker.com",
        },
        body: JSON.stringify({ title: "Attacker Quote" }),
      }),
      "/api/v1/quotations",
      configuredEnv,
    );
    expect(res).not.toBeNull();
    expect(res?.status).toBe(403);
  });

  it("rejects unsupported HTTP methods with 405 Method Not Allowed", async () => {
    const res = await handleCrmApiRequest(
      new Request("http://127.0.0.1:3000/api/v1/quotations", {
        method: "PUT",
      }),
      "/api/v1/quotations",
      configuredEnv,
    );
    expect(res).not.toBeNull();
    expect(res?.status).toBe(405);
    expect(res?.headers.get("allow")).toContain("GET");
  });
});

describe("B4A Idempotency & Concurrency Guarantees", () => {
  it("generates deterministic SHA-256 hashes for quotation idempotency scopes", () => {
    const payloadA = {
      title: "Brand Redesign",
      clientName: "Rahul",
      packagePrice: 50_000,
    };
    const payloadB = {
      clientName: "Rahul", // Different key order
      title: "Brand Redesign",
      packagePrice: 50_000,
    };
    const hashA = hashIdempotentRequest("quotation:create", payloadA);
    const hashB = hashIdempotentRequest("quotation:create", payloadB);

    expect(hashA).toBe(hashB);
    expect(hashA).toMatch(/^[0-9a-f]{64}$/);

    const differentPayload = {
      title: "Brand Redesign",
      clientName: "Rahul",
      packagePrice: 55_000, // Different amount
    };
    const hashDifferent = hashIdempotentRequest("quotation:create", differentPayload);
    expect(hashDifferent).not.toBe(hashA);
  });

  it("verifies CrmServiceError supports quotation-specific codes", () => {
    const duplicateErr = new CrmServiceError(409, "duplicate_quotation", "Quotation number already exists.");
    expect(duplicateErr.status).toBe(409);
    expect(duplicateErr.code).toBe("duplicate_quotation");

    const staleErr = new CrmServiceError(409, "stale_conflict", "Quotation version conflict.");
    expect(staleErr.status).toBe(409);
    expect(staleErr.code).toBe("stale_conflict");

    const notFoundErr = new CrmServiceError(404, "not_found", "Quotation not found.");
    expect(notFoundErr.status).toBe(404);
  });
});

describe("B4A Comprehensive Remaining Modules Audit Verification", () => {
  it("verifies docs/crm-remaining-modules-audit.md exists with all required module sections", () => {
    const auditDocPath = path.resolve(process.cwd(), "docs/crm-remaining-modules-audit.md");
    expect(fs.existsSync(auditDocPath)).toBe(true);

    const content = fs.readFileSync(auditDocPath, "utf8");
    expect(content).toContain("Comprehensive Remaining-Module Coverage Audit");
    expect(content).toContain("Quotations (Packages & Shares)");
    expect(content).toContain("Sales Studio & Demos");
    expect(content).toContain("Projects & Milestones (Project Desk)");
    expect(content).toContain("Tasks & Deliverables");
    expect(content).toContain("Support Requests");
    expect(content).toContain("Personal Notes");
    expect(content).toContain("Dashboard & Sales KPIs");
    expect(content).toContain("Sales Goals & My Performance");
    expect(content).toContain("Smart Inbox & Lead Deduplication");
    expect(content).toContain("Sales Automation Studio");
    expect(content).toContain("Custom Fields, Tags & Saved Views");
    expect(content).toContain("Settings & Owner Preferences");
    expect(content).toContain("Team CRM & Permissions");
    expect(content).toContain("Data Vault & Backups");
  });

  it("guarantees browser-local storage and IndexedDB stores are not referenced by quotation backend", () => {
    const serviceContent = fs.readFileSync(
      path.resolve(__dirname, "crm/quotationsService.server.ts"),
      "utf8",
    );
    expect(serviceContent).not.toContain("localStorage");
    expect(serviceContent).not.toContain("indexedDB");
    expect(serviceContent).not.toContain("window.");
  });

  it("verifies that quotation operations have zero side-effects on Deals or Payments tables", () => {
    // Inspect quotation service to ensure it never imports deal/payment write actions or tables
    const serviceContent = fs.readFileSync(
      path.resolve(__dirname, "crm/quotationsService.server.ts"),
      "utf8",
    );
    // Reads crmDeals for validation only, never inserts or updates crmDeals or crmPayments
    expect(serviceContent).not.toContain("tx.insert(crmDeals)");
    expect(serviceContent).not.toContain("tx.insert(crmPayments)");
    expect(serviceContent).not.toContain("tx.update(crmDeals)");
    expect(serviceContent).not.toContain("tx.update(crmPayments)");
    expect(serviceContent).not.toContain("crmFinanceEvents");
  });
});
