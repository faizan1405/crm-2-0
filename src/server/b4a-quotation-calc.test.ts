import { describe, expect, it } from "vitest";
import {
  calculateQuotationFinancials,
  paiseToDecimalString,
} from "./crm/quotationCalc.server";

describe("B4A Quotation Financial Calculations (Integer-Paise Precision)", () => {
  it("computes exact subtotal from line items with quantity and unit rates", () => {
    const res = calculateQuotationFinancials({
      items: [
        { description: "Landing Page Design", quantity: 1, unitPrice: 25000 },
        { description: "Interactive 3D Component", quantity: 2, unitPrice: 15000.5 },
      ],
    });

    expect(res.subtotalPaise).toBe(5_500_100); // 25,000.00 + 30,001.00 = 55,001.00
    expect(res.subtotal).toBe(55001);
    expect(res.subtotalDecimal).toBe("55001.00");
    expect(res.totalAmountPaise).toBe(5_500_100);
    expect(res.totalAmount).toBe(55001);
  });

  it("applies flat rupee discount correctly up to subtotal limit", () => {
    const res = calculateQuotationFinancials({
      items: [{ description: "Full Web Suite", quantity: 1, unitPrice: 50000 }],
      discountType: "flat",
      discountValue: 5000,
    });

    expect(res.discountAmountPaise).toBe(500_000);
    expect(res.discountAmount).toBe(5000);
    expect(res.taxableAmountPaise).toBe(4_500_000);
    expect(res.totalAmountPaise).toBe(4_500_000);
  });

  it("caps flat discount at subtotal (never negative taxable amount)", () => {
    const res = calculateQuotationFinancials({
      items: [{ description: "Starter Pack", quantity: 1, unitPrice: 10000 }],
      discountType: "flat",
      discountValue: 15000,
    });

    expect(res.discountAmountPaise).toBe(1_000_000); // capped at 10k
    expect(res.taxableAmountPaise).toBe(0);
    expect(res.totalAmountPaise).toBe(0);
  });

  it("computes percentage discount cleanly with exact integer paise rounding", () => {
    const res = calculateQuotationFinancials({
      items: [{ description: "Consulting", quantity: 1, unitPrice: 33333.33 }],
      discountType: "percent",
      discountValue: 10, // 10%
    });

    // 10% of 33,333.33 = 3,333.333 -> 333,333 paise
    expect(res.discountAmountPaise).toBe(333333);
    expect(res.discountAmountDecimal).toBe("3333.33");
    expect(res.taxableAmountPaise).toBe(3000000); // 3333333 - 333333 = 3000000
    expect(res.totalAmountPaise).toBe(3000000);
  });

  it("calculates 18% GST only when explicitly enabled", () => {
    const noGst = calculateQuotationFinancials({
      packagePrice: 50000,
      gstEnabled: false,
    });
    expect(noGst.gstAmountPaise).toBe(0);
    expect(noGst.totalAmountPaise).toBe(5_000_000);

    const withGst = calculateQuotationFinancials({
      packagePrice: 50000,
      gstEnabled: true,
      gstRate: 18,
    });
    expect(withGst.gstAmountPaise).toBe(900_000); // 18% of 50k = 9k
    expect(withGst.gstAmount).toBe(9000);
    expect(withGst.totalAmountPaise).toBe(5_900_000); // 59,000.00
    expect(withGst.totalAmountDecimal).toBe("59000.00");
  });

  it("validates payment milestones totaling 100% and absorbs rounding in last milestone", () => {
    const res = calculateQuotationFinancials({
      packagePrice: 100000,
      milestones: [
        { label: "Advance", percentage: 33.33 },
        { label: "Design Approval", percentage: 33.33 },
        { label: "Go-Live", percentage: 33.34 },
      ],
    });

    expect(res.milestones).toHaveLength(3);
    const m1 = res.milestones[0]!;
    const m2 = res.milestones[1]!;
    const m3 = res.milestones[2]!;

    expect(m1.amountPaise).toBe(3_333_000);
    expect(m2.amountPaise).toBe(3_333_000);
    expect(m3.amountPaise).toBe(3_334_000);
    expect(m1.amountPaise + m2.amountPaise + m3.amountPaise).toBe(10_000_000);
  });

  it("rejects milestone percentages not totaling 100%", () => {
    expect(() =>
      calculateQuotationFinancials({
        packagePrice: 50000,
        milestones: [
          { label: "M1", percentage: 50 },
          { label: "M2", percentage: 40 }, // total 90%
        ],
      }),
    ).toThrow("Milestone percentages must total exactly 100%");
  });

  it("rejects negative monetary amounts and invalid discounts", () => {
    expect(() =>
      calculateQuotationFinancials({
        items: [{ description: "Bad item", quantity: 1, unitPrice: -500 }],
      }),
    ).toThrow("cannot be negative");

    expect(() =>
      calculateQuotationFinancials({
        packagePrice: 10000,
        discountType: "percent",
        discountValue: 150, // > 100%
      }),
    ).toThrow("must be between 0% and 100%");
  });

  it("correctly converts paise to decimal string", () => {
    expect(paiseToDecimalString(0)).toBe("0.00");
    expect(paiseToDecimalString(5)).toBe("0.05");
    expect(paiseToDecimalString(50)).toBe("0.50");
    expect(paiseToDecimalString(1500000)).toBe("15000.00");
  });
});
