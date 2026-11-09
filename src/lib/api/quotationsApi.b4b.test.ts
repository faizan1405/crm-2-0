import { describe, expect, it, vi } from "vitest";
import {
  archiveQuotation,
  changeQuotationStatus,
  createQuotation,
  createQuotationTemplate,
  deleteQuotationTemplate,
  duplicateQuotationTemplate,
  getQuotation,
  getQuotationTemplate,
  listLeadQuotations,
  listQuotationAuditEvents,
  listQuotationRevisions,
  listQuotations,
  listQuotationTemplates,
  reorderQuotationTemplates,
  restoreQuotation,
  updateQuotation,
  updateQuotationTemplate,
} from "./quotationsApi";
import type { QuotationDto, QuotationTemplateDto } from "./schemas";

describe("B4B Typed Quotations API Client", () => {
  it("listQuotationTemplates sends GET and parses typed list response", async () => {
    const mockTpl: QuotationTemplateDto = {
      id: "qtpl_1",
      ownerUserId: "usr_owner",
      name: "3D Visualizer Package",
      priceType: "fixed",
      priceAmount: 50000,
      priceAmountDecimal: "50000.00",
      priceAmountPaise: 5000000,
      priceLabel: null,
      currency: "INR",
      messageBody: "Hi {firstName}, here is your quote: ₹{packagePrice}.",
      isActive: true,
      sortOrder: 0,
      version: 1,
      archivedAt: null,
      createdAt: "2026-11-10T00:00:00.000Z",
      updatedAt: "2026-11-10T00:00:00.000Z",
    };

    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true, items: [mockTpl], total: 1 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const res = await listQuotationTemplates();
    expect(res.ok).toBe(true);
    expect(res.items).toHaveLength(1);
    expect(res.items[0]!.name).toBe("3D Visualizer Package");
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining("/api/v1/quotation-templates"),
      expect.objectContaining({ method: "GET" }),
    );
    spy.mockRestore();
  });

  it("createQuotation sends POST with idempotency key header and parses response", async () => {
    const mockQuote: QuotationDto = {
      id: "quot_1",
      ownerUserId: "usr_owner",
      leadId: "lead_1",
      dealId: null,
      templateId: "qtpl_1",
      legacyId: null,
      quotationNumber: "QT-2026-0001",
      title: "Interactive E-Commerce Platform",
      clientName: "Nexus Retail",
      clientCompany: "Nexus Ltd",
      currency: "INR",
      subtotal: 75000,
      subtotalDecimal: "75000.00",
      discountType: "none",
      discountValue: 0,
      discountValueDecimal: "0.00",
      discountAmount: 0,
      discountAmountDecimal: "0.00",
      taxableAmount: 75000,
      taxableAmountDecimal: "75000.00",
      gstEnabled: false,
      gstRate: 0,
      gstRateDecimal: "0.00",
      gstAmount: 0,
      gstAmountDecimal: "0.00",
      totalAmount: 75000,
      totalAmountDecimal: "75000.00",
      status: "draft",
      issueIstDate: "2026-11-10",
      validUntilIstDate: "2026-12-10",
      paymentTerms: "50% upfront, 50% delivery",
      notes: null,
      messageBody: null,
      userConfirmedSent: false,
      sentAt: null,
      acceptedAt: null,
      rejectedAt: null,
      version: 1,
      archivedAt: null,
      createdAt: "2026-11-10T00:00:00.000Z",
      updatedAt: "2026-11-10T00:00:00.000Z",
      items: [
        {
          id: "qitem_1",
          quotationId: "quot_1",
          description: "Headless Storefront",
          quantity: 1,
          quantityDecimal: "1.00",
          unitPrice: 75000,
          unitPriceDecimal: "75000.00",
          totalAmount: 75000,
          totalAmountDecimal: "75000.00",
          sortOrder: 0,
          createdAt: "2026-11-10T00:00:00.000Z",
          updatedAt: "2026-11-10T00:00:00.000Z",
        },
      ],
      milestones: [
        {
          id: "qms_1",
          quotationId: "quot_1",
          label: "Advance Deposit",
          percentage: 50,
          percentageDecimal: "50.00",
          amount: 37500,
          amountDecimal: "37500.00",
          dueDate: "2026-11-20",
          sortOrder: 0,
          createdAt: "2026-11-10T00:00:00.000Z",
        },
        {
          id: "qms_2",
          quotationId: "quot_1",
          label: "Final Delivery",
          percentage: 50,
          percentageDecimal: "50.00",
          amount: 37500,
          amountDecimal: "37500.00",
          dueDate: "2026-12-10",
          sortOrder: 1,
          createdAt: "2026-11-10T00:00:00.000Z",
        },
      ],
    };

    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true, quotation: mockQuote }), {
        status: 201,
        headers: { "content-type": "application/json" },
      }),
    );

    const res = await createQuotation({
      title: "Interactive E-Commerce Platform",
      clientName: "Nexus Retail",
      leadId: "lead_1",
      idempotencyKey: "test_idem_123",
      items: [{ description: "Headless Storefront", unitPrice: 75000 }],
      milestones: [
        { label: "Advance Deposit", percentage: 50 },
        { label: "Final Delivery", percentage: 50 },
      ],
    });

    expect(res.ok).toBe(true);
    expect(res.quotation.totalAmount).toBe(75000);
    expect(res.quotation.items).toHaveLength(1);
    expect(res.quotation.milestones).toHaveLength(2);
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining("/api/v1/quotations"),
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Idempotency-Key": "test_idem_123",
        }),
      }),
    );
    spy.mockRestore();
  });

  it("changeQuotationStatus sends status transition with reason", async () => {
    const mockQuote: QuotationDto = {
      id: "quot_1",
      ownerUserId: "usr_owner",
      leadId: null,
      dealId: null,
      templateId: null,
      legacyId: null,
      quotationNumber: "QT-2026-0001",
      title: "Design System",
      clientName: "Beta Corp",
      clientCompany: null,
      currency: "INR",
      subtotal: 30000,
      subtotalDecimal: "30000.00",
      discountType: "none",
      discountValue: 0,
      discountValueDecimal: "0.00",
      discountAmount: 0,
      discountAmountDecimal: "0.00",
      taxableAmount: 30000,
      taxableAmountDecimal: "30000.00",
      gstEnabled: false,
      gstRate: 0,
      gstRateDecimal: "0.00",
      gstAmount: 0,
      gstAmountDecimal: "0.00",
      totalAmount: 30000,
      totalAmountDecimal: "30000.00",
      status: "sent",
      issueIstDate: "2026-11-10",
      validUntilIstDate: null,
      paymentTerms: null,
      notes: null,
      messageBody: null,
      userConfirmedSent: true,
      sentAt: "2026-11-10T01:00:00.000Z",
      acceptedAt: null,
      rejectedAt: null,
      version: 2,
      archivedAt: null,
      createdAt: "2026-11-10T00:00:00.000Z",
      updatedAt: "2026-11-10T01:00:00.000Z",
      items: [],
      milestones: [],
    };

    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true, quotation: mockQuote }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const res = await changeQuotationStatus("quot_1", {
      status: "sent",
      reason: "Shared via WhatsApp with Owner confirmation",
      expectedVersion: 1,
    });

    expect(res.ok).toBe(true);
    expect(res.quotation.status).toBe("sent");
    expect(res.quotation.userConfirmedSent).toBe(true);
    spy.mockRestore();
  });

  it("listQuotationRevisions and listQuotationAuditEvents parse paginated responses", async () => {
    const mockRevision = {
      id: "qrev_1",
      quotationId: "quot_1",
      revisionNumber: 1,
      snapshot: { title: "Draft 1", total: "50000.00" },
      changeSummary: "Initial version",
      createdByUserId: "usr_owner",
      createdAt: "2026-11-10T00:00:00.000Z",
    };

    const spyRev = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({ ok: true, quotationId: "quot_1", items: [mockRevision], total: 1, limit: 50, offset: 0 }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const revRes = await listQuotationRevisions("quot_1");
    expect(revRes.ok).toBe(true);
    expect(revRes.items).toHaveLength(1);
    expect(revRes.items[0]!.revisionNumber).toBe(1);
    spyRev.mockRestore();

    const mockAudit = {
      id: "qev_1",
      quotationId: "quot_1",
      ownerUserId: "usr_owner",
      actorUserId: "usr_owner",
      eventType: "quotation.created",
      summary: "Created quotation",
      details: null,
      occurredIstDate: "2026-11-10",
      createdAt: "2026-11-10T00:00:00.000Z",
    };

    const spyAudit = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({ ok: true, quotationId: "quot_1", items: [mockAudit], total: 1, limit: 50, offset: 0 }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const auditRes = await listQuotationAuditEvents("quot_1");
    expect(auditRes.ok).toBe(true);
    expect(auditRes.items).toHaveLength(1);
    expect(auditRes.items[0]!.eventType).toBe("quotation.created");
    spyAudit.mockRestore();
  });
});
