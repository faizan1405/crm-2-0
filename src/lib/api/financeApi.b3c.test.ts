import { describe, expect, it, vi } from "vitest";
import {
  cancelDeal,
  changeDealStatus,
  createDeal,
  createPayment,
  getDeal,
  getDealSummary,
  getOwnerFinanceSummary,
  listDeals,
  listPayments,
  removePaymentProof,
  verifyDealWonDate,
  voidPayment,
} from "./financeApi";
import type { DealDto, OwnerFinanceSummaryDto, PaymentDto } from "./schemas";

describe("B3C Typed Finance API Client", () => {
  it("listDeals sends correct query params and parses typed response", async () => {
    const mockDeal: DealDto = {
      id: "deal_123",
      clientType: "crm",
      clientName: "Alpha Corp",
      leadId: "lead_abc",
      name: "Enterprise SLA",
      quotedAmount: 120000,
      quotedAmountDecimal: "120000.00",
      quotedAmountPaise: 12000000,
      finalAmount: 100000,
      finalAmountDecimal: "100000.00",
      finalAmountPaise: 10000000,
      status: "active",
      milestones: [],
      createdByUserId: "usr_owner",
      updatedByUserId: "usr_owner",
      version: 1,
      createdAt: "2026-11-09T10:00:00.000Z",
      updatedAt: "2026-11-09T10:00:00.000Z",
      financialSummary: {
        dealId: "deal_123",
        dealStatus: "active",
        paymentStatus: "unpaid",
        isOverdue: false,
        dueDate: "2026-11-30",
        quotedAmount: 120000,
        quotedAmountDecimal: "120000.00",
        quotedAmountPaise: 12000000,
        finalAmount: 100000,
        finalAmountDecimal: "100000.00",
        finalAmountPaise: 10000000,
        collected: 0,
        collectedDecimal: "0.00",
        collectedPaise: 0,
        realizedRevenue: 100000,
        realizedRevenueDecimal: "100000.00",
        realizedRevenuePaise: 10000000,
        outstanding: 100000,
        outstandingDecimal: "100000.00",
        outstandingPaise: 10000000,
        overdue: 0,
        overdueDecimal: "0.00",
        overduePaise: 0,
        voidedAmount: 0,
        voidedDecimal: "0.00",
        voidedPaise: 0,
        activePaymentCount: 0,
        voidedPaymentCount: 0,
        collectionRate: 0,
        lastPaymentDate: null,
        nextMilestone: null,
      },
    };

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          items: [mockDeal],
          total: 1,
          limit: 50,
          offset: 0,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    try {
      const res = await listDeals({ status: "active", q: "Enterprise" });
      expect(fetchMock).toHaveBeenCalled();
      const calledUrl = fetchMock.mock.calls[0]![0] as string;
      expect(calledUrl).toContain("/api/v1/deals");
      expect(calledUrl).toContain("status=active");
      expect(calledUrl).toContain("q=Enterprise");
      expect(res.items).toHaveLength(1);
      expect(res.items[0]!.name).toBe("Enterprise SLA");
      expect(res.items[0]!.financialSummary.outstanding).toBe(100000);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("createPayment attaches idempotency key and parses result with updated dealSummary", async () => {
    const mockPayment: PaymentDto = {
      id: "pay_test99",
      dealId: "deal_123",
      amount: 40000,
      amountDecimal: "40000.00",
      amountPaise: 4000000,
      date: "2026-11-09",
      method: "UPI",
      type: "milestone",
      reference: "UPI/12345678",
      status: "posted",
      voided: false,
      recordedByUserId: "usr_owner",
      updatedByUserId: "usr_owner",
      version: 1,
      createdAt: "2026-11-09T10:30:00.000Z",
      updatedAt: "2026-11-09T10:30:00.000Z",
    };

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          payment: mockPayment,
          dealSummary: {
            dealId: "deal_123",
            dealStatus: "active",
            paymentStatus: "partial",
            isOverdue: false,
            dueDate: "2026-11-30",
            quotedAmount: 120000,
            quotedAmountDecimal: "120000.00",
            quotedAmountPaise: 12000000,
            finalAmount: 100000,
            finalAmountDecimal: "100000.00",
            finalAmountPaise: 10000000,
            collected: 40000,
            collectedDecimal: "40000.00",
            collectedPaise: 4000000,
            realizedRevenue: 100000,
            realizedRevenueDecimal: "100000.00",
            realizedRevenuePaise: 10000000,
            outstanding: 60000,
            outstandingDecimal: "60000.00",
            outstandingPaise: 6000000,
            overdue: 0,
            overdueDecimal: "0.00",
            overduePaise: 0,
            voidedAmount: 0,
            voidedDecimal: "0.00",
            voidedPaise: 0,
            activePaymentCount: 1,
            voidedPaymentCount: 0,
            collectionRate: 0.4,
            lastPaymentDate: "2026-11-09",
            nextMilestone: null,
          },
        }),
        { status: 201, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    try {
      const res = await createPayment(
        {
          dealId: "deal_123",
          amount: 40000,
          date: "2026-11-09",
          method: "UPI",
          reference: "UPI/12345678",
        },
        "idem_custom_key_1",
      );

      expect(fetchMock).toHaveBeenCalled();
      const options = fetchMock.mock.calls[0]![1] as RequestInit;
      expect(options.method).toBe("POST");
      const headers = options.headers as Record<string, string>;
      const sentKey = headers["Idempotency-Key"] ?? headers["idempotency-key"];
      expect(sentKey).toBe("idem_custom_key_1");
      expect(res.payment.amount).toBe(40000);
      expect(res.dealSummary.outstanding).toBe(60000);
      expect(res.dealSummary.paymentStatus).toBe("partial");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("voidPayment posts void reason and returns updated balances", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          payment: {
            id: "pay_test99",
            dealId: "deal_123",
            amount: 40000,
            amountDecimal: "40000.00",
            amountPaise: 4000000,
            date: "2026-11-09",
            method: "UPI",
            type: "milestone",
            status: "voided",
            voided: true,
            voidReason: "Client transfer failed",
            recordedByUserId: "usr_owner",
            updatedByUserId: "usr_owner",
            version: 2,
            createdAt: "2026-11-09T10:30:00.000Z",
            updatedAt: "2026-11-09T10:45:00.000Z",
          },
          dealSummary: {
            dealId: "deal_123",
            dealStatus: "active",
            paymentStatus: "unpaid",
            isOverdue: false,
            dueDate: "2026-11-30",
            quotedAmount: 120000,
            quotedAmountDecimal: "120000.00",
            quotedAmountPaise: 12000000,
            finalAmount: 100000,
            finalAmountDecimal: "100000.00",
            finalAmountPaise: 10000000,
            collected: 0,
            collectedDecimal: "0.00",
            collectedPaise: 0,
            realizedRevenue: 100000,
            realizedRevenueDecimal: "100000.00",
            realizedRevenuePaise: 10000000,
            outstanding: 100000,
            outstandingDecimal: "100000.00",
            outstandingPaise: 10000000,
            overdue: 0,
            overdueDecimal: "0.00",
            overduePaise: 0,
            voidedAmount: 40000,
            voidedDecimal: "40000.00",
            voidedPaise: 4000000,
            activePaymentCount: 0,
            voidedPaymentCount: 1,
            collectionRate: 0,
            lastPaymentDate: null,
            nextMilestone: null,
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    try {
      const res = await voidPayment("pay_test99", {
        version: 1,
        reason: "Client transfer failed",
      });

      expect(fetchMock).toHaveBeenCalled();
      const calledUrl = fetchMock.mock.calls[0]![0] as string;
      expect(calledUrl).toBe("/api/v1/payments/pay_test99/void");
      expect(res.payment.voided).toBe(true);
      expect(res.payment.voidReason).toBe("Client transfer failed");
      expect(res.dealSummary.outstanding).toBe(100000);
      expect(res.dealSummary.voidedAmount).toBe(40000);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("cancelDeal cancels deal and updates financial status", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          deal: {
            id: "deal_123",
            clientType: "crm",
            clientName: "Alpha Corp",
            name: "Enterprise SLA",
            quotedAmount: 120000,
            quotedAmountDecimal: "120000.00",
            quotedAmountPaise: 12000000,
            finalAmount: 100000,
            finalAmountDecimal: "100000.00",
            finalAmountPaise: 10000000,
            status: "cancelled",
            cancelReason: "Client postponed",
            milestones: [],
            createdByUserId: "usr_owner",
            updatedByUserId: "usr_owner",
            version: 2,
            createdAt: "2026-11-09T10:00:00.000Z",
            updatedAt: "2026-11-09T11:00:00.000Z",
            financialSummary: {
              dealId: "deal_123",
              dealStatus: "cancelled",
              paymentStatus: "cancelled",
              isOverdue: false,
              dueDate: null,
              quotedAmount: 120000,
              quotedAmountDecimal: "120000.00",
              quotedAmountPaise: 12000000,
              finalAmount: 100000,
              finalAmountDecimal: "100000.00",
              finalAmountPaise: 10000000,
              collected: 0,
              collectedDecimal: "0.00",
              collectedPaise: 0,
              realizedRevenue: 0,
              realizedRevenueDecimal: "0.00",
              realizedRevenuePaise: 0,
              outstanding: 0,
              outstandingDecimal: "0.00",
              outstandingPaise: 0,
              overdue: 0,
              overdueDecimal: "0.00",
              overduePaise: 0,
              voidedAmount: 0,
              voidedDecimal: "0.00",
              voidedPaise: 0,
              activePaymentCount: 0,
              voidedPaymentCount: 0,
              collectionRate: null,
              lastPaymentDate: null,
              nextMilestone: null,
            },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    try {
      const res = await cancelDeal("deal_123", {
        version: 1,
        reason: "Client postponed",
      });

      expect(fetchMock).toHaveBeenCalled();
      const calledUrl = fetchMock.mock.calls[0]![0] as string;
      expect(calledUrl).toBe("/api/v1/deals/deal_123/cancel");
      expect(res.status).toBe("cancelled");
      expect(res.cancelReason).toBe("Client postponed");
      expect(res.financialSummary.outstanding).toBe(0);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("getOwnerFinanceSummary accurately distinguishes booked, collected, and cancelled cash", async () => {
    const mockSummary: OwnerFinanceSummaryDto = {
      todayIstDate: "2026-11-09",
      period: "all_time",
      fromIstDate: null,
      toIstDate: null,
      totalBooked: 250000,
      totalBookedDecimal: "250000.00",
      totalBookedPaise: 25000000,
      activeBooked: 200000,
      activeBookedDecimal: "200000.00",
      activeBookedPaise: 20000000,
      cancelledBooked: 50000,
      cancelledBookedDecimal: "50000.00",
      cancelledBookedPaise: 5000000,
      cashCollected: 120000,
      cashCollectedDecimal: "120000.00",
      cashCollectedPaise: 12000000,
      activeCashCollected: 100000,
      activeCashCollectedDecimal: "100000.00",
      activeCashCollectedPaise: 10000000,
      cancelledCashCollected: 20000,
      cancelledCashCollectedDecimal: "20000.00",
      cancelledCashCollectedPaise: 2000000,
      outstanding: 100000,
      outstandingDecimal: "100000.00",
      outstandingPaise: 10000000,
      overdue: 25000,
      overdueDecimal: "25000.00",
      overduePaise: 2500000,
      voidedAmount: 15000,
      voidedDecimal: "15000.00",
      voidedPaise: 1500000,
      activeDealCount: 2,
      cancelledDealCount: 1,
      activePaymentCount: 3,
      voidedPaymentCount: 1,
      collectionRate: 0.5,
    };

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true, summary: mockSummary }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    try {
      const summary = await getOwnerFinanceSummary();
      expect(summary.activeBooked).toBe(200000);
      expect(summary.cancelledCashCollected).toBe(20000);
      expect(summary.cashCollected).toBe(120000);
      expect(summary.outstanding).toBe(100000);
      expect(summary.activeDealCount).toBe(2);
      expect(summary.cancelledDealCount).toBe(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
