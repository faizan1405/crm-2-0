import "@tanstack/react-start/server-only";
import {
  MAX_DECIMAL_15_2_PAISE,
  parseStrictInrInputToPaise,
  rupeesToPaise,
  paiseToRupees,
  sumPaise,
} from "../db/money.server";

export type QuotationDiscountType = "none" | "flat" | "percent";
export type QuotationStatus = "draft" | "sent" | "accepted" | "rejected" | "expired" | "archived";

export interface QuotationLineItemInput {
  description: string;
  quantity?: number | string | undefined;
  unitPrice: number | string;
  sortOrder?: number | undefined;
}

export interface CalculatedQuotationItem {
  description: string;
  quantity: number;
  quantityDecimal: string;
  unitPrice: number;
  unitPriceDecimal: string;
  unitPricePaise: number;
  totalAmount: number;
  totalAmountDecimal: string;
  totalAmountPaise: number;
  sortOrder: number;
}

export interface QuotationMilestoneInput {
  label: string;
  percentage?: number | string | undefined;
  amount?: number | string | undefined;
  dueDate?: string | null | undefined;
  sortOrder?: number | undefined;
}

export interface CalculatedQuotationMilestone {
  label: string;
  percentage: number;
  percentageDecimal: string;
  amount: number;
  amountDecimal: string;
  amountPaise: number;
  dueDate: string | null;
  sortOrder: number;
}

export interface QuotationFinancialInput {
  items?: readonly QuotationLineItemInput[] | undefined;
  discountType?: QuotationDiscountType | undefined;
  discountValue?: number | string | undefined;
  gstEnabled?: boolean | undefined;
  gstRate?: number | string | undefined;
  milestones?: readonly QuotationMilestoneInput[] | undefined;
  /** Direct package price override when items are not itemized (e.g. single package offer) */
  packagePrice?: number | string | undefined;
}

export interface CalculatedQuotationFinancials {
  items: CalculatedQuotationItem[];
  subtotal: number;
  subtotalDecimal: string;
  subtotalPaise: number;
  discountType: QuotationDiscountType;
  discountValue: number;
  discountValueDecimal: string;
  discountAmount: number;
  discountAmountDecimal: string;
  discountAmountPaise: number;
  taxableAmount: number;
  taxableAmountDecimal: string;
  taxableAmountPaise: number;
  gstEnabled: boolean;
  gstRate: number;
  gstRateDecimal: string;
  gstAmount: number;
  gstAmountDecimal: string;
  gstAmountPaise: number;
  totalAmount: number;
  totalAmountDecimal: string;
  totalAmountPaise: number;
  milestones: CalculatedQuotationMilestone[];
}

export function paiseToDecimalString(paise: number): string {
  const whole = Math.floor(paise / 100);
  const frac = String(paise % 100).padStart(2, "0");
  return `${whole}.${frac}`;
}

export function calculateQuotationFinancials(
  input: QuotationFinancialInput,
): CalculatedQuotationFinancials {
  const rawItems = input.items ?? [];
  const items: CalculatedQuotationItem[] = [];

  let subtotalPaise = 0;

  if (rawItems.length > 0) {
    for (let i = 0; i < rawItems.length; i++) {
      const it = rawItems[i]!;
      const desc = it.description.trim();
      if (!desc) {
        throw new Error(`Line item ${i + 1} must have a description.`);
      }

      const rawQty = it.quantity !== undefined ? Number(it.quantity) : 1;
      if (!Number.isFinite(rawQty) || rawQty <= 0) {
        throw new Error(`Line item ${i + 1} quantity must be a positive number.`);
      }
      const qtyRounded = Math.round(rawQty * 100) / 100;

      const unitParse = parseStrictInrInputToPaise(it.unitPrice, { allowZero: true });
      if (!unitParse.ok) {
        throw new Error(`Line item ${i + 1} unit price: ${unitParse.message}`);
      }

      const itemTotalPaise = Math.round(qtyRounded * unitParse.paise);
      if (itemTotalPaise > MAX_DECIMAL_15_2_PAISE) {
        throw new Error(`Line item ${i + 1} total exceeds supported monetary limits.`);
      }

      items.push({
        description: desc,
        quantity: qtyRounded,
        quantityDecimal: qtyRounded.toFixed(2),
        unitPrice: unitParse.rupees,
        unitPriceDecimal: unitParse.decimal,
        unitPricePaise: unitParse.paise,
        totalAmount: itemTotalPaise / 100,
        totalAmountDecimal: paiseToDecimalString(itemTotalPaise),
        totalAmountPaise: itemTotalPaise,
        sortOrder: it.sortOrder ?? i,
      });
    }
    subtotalPaise = sumPaise(items.map((it) => it.totalAmountPaise));
  } else if (input.packagePrice !== undefined) {
    const pkgParse = parseStrictInrInputToPaise(input.packagePrice, { allowZero: true });
    if (!pkgParse.ok) {
      throw new Error(`Quotation package price: ${pkgParse.message}`);
    }
    subtotalPaise = pkgParse.paise;
  }

  // Discount calculation
  const discountType: QuotationDiscountType = input.discountType ?? "none";
  let discountValueNum = 0;
  let discountAmountPaise = 0;

  if (discountType === "flat") {
    const dParse = parseStrictInrInputToPaise(input.discountValue ?? 0, { allowZero: true });
    if (!dParse.ok) {
      throw new Error(`Flat discount: ${dParse.message}`);
    }
    discountValueNum = dParse.rupees;
    discountAmountPaise = Math.min(subtotalPaise, dParse.paise);
  } else if (discountType === "percent") {
    const rawPct = Number(input.discountValue ?? 0);
    if (!Number.isFinite(rawPct) || rawPct < 0 || rawPct > 100) {
      throw new Error("Percentage discount must be between 0% and 100%.");
    }
    discountValueNum = Math.round(rawPct * 100) / 100;
    discountAmountPaise = Math.min(
      subtotalPaise,
      Math.round((subtotalPaise * discountValueNum) / 100),
    );
  }

  const taxableAmountPaise = Math.max(0, subtotalPaise - discountAmountPaise);

  // GST / Tax calculation
  const gstEnabled = Boolean(input.gstEnabled);
  let gstRateNum = 0;
  let gstAmountPaise = 0;

  if (gstEnabled) {
    const rawRate = Number(input.gstRate ?? 18);
    if (!Number.isFinite(rawRate) || rawRate < 0 || rawRate > 100) {
      throw new Error("GST rate must be between 0% and 100%.");
    }
    gstRateNum = Math.round(rawRate * 100) / 100;
    gstAmountPaise = Math.round((taxableAmountPaise * gstRateNum) / 100);
  }

  const totalAmountPaise = sumPaise([taxableAmountPaise, gstAmountPaise]);

  // Payment Milestones calculation
  const rawMilestones = input.milestones ?? [];
  const milestones: CalculatedQuotationMilestone[] = [];

  if (rawMilestones.length > 0) {
    let totalBasisPoints = 0;
    for (const ms of rawMilestones) {
      if (ms.percentage !== undefined) {
        const pct = Number(ms.percentage);
        if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
          throw new Error("Milestone percentage must be between 0% and 100%.");
        }
        totalBasisPoints += Math.round(pct * 100);
      }
    }

    if (totalBasisPoints > 0 && totalBasisPoints !== 10000) {
      const currentPct = (totalBasisPoints / 100).toFixed(2);
      throw new Error(
        `Milestone percentages must total exactly 100.00% (currently ${currentPct}%).`,
      );
    }

    let allocatedPaise = 0;
    for (let i = 0; i < rawMilestones.length; i++) {
      const ms = rawMilestones[i]!;
      const label = ms.label.trim();
      if (!label) {
        throw new Error(`Milestone ${i + 1} must have a label.`);
      }

      let msPaise = 0;
      let msPct = 0;

      if (ms.percentage !== undefined) {
        msPct = Number(ms.percentage);
        if (i === rawMilestones.length - 1 && totalAmountPaise > 0) {
          // Last milestone absorbs any rounding variance
          msPaise = Math.max(0, totalAmountPaise - allocatedPaise);
        } else {
          msPaise = Math.round((totalAmountPaise * msPct) / 100);
        }
      } else if (ms.amount !== undefined) {
        const amtParse = parseStrictInrInputToPaise(ms.amount, { allowZero: true });
        if (!amtParse.ok) {
          throw new Error(`Milestone ${i + 1} amount: ${amtParse.message}`);
        }
        msPaise = amtParse.paise;
        msPct = totalAmountPaise > 0 ? (msPaise / totalAmountPaise) * 100 : 0;
      }

      allocatedPaise += msPaise;
      milestones.push({
        label,
        percentage: Math.round(msPct * 100) / 100,
        percentageDecimal: (Math.round(msPct * 100) / 100).toFixed(2),
        amount: msPaise / 100,
        amountDecimal: paiseToDecimalString(msPaise),
        amountPaise: msPaise,
        dueDate: ms.dueDate ?? null,
        sortOrder: ms.sortOrder ?? i,
      });
    }

    // If explicit amounts were specified, verify total matches quotation total
    if (totalBasisPoints === 0 && allocatedPaise !== totalAmountPaise && totalAmountPaise > 0) {
      throw new Error(
        `Milestone amounts sum (₹${(allocatedPaise / 100).toFixed(2)}) must equal quotation total (₹${(totalAmountPaise / 100).toFixed(2)}).`,
      );
    }
  }

  return {
    items,
    subtotal: subtotalPaise / 100,
    subtotalDecimal: paiseToDecimalString(subtotalPaise),
    subtotalPaise,
    discountType,
    discountValue: discountValueNum,
    discountValueDecimal: discountValueNum.toFixed(2),
    discountAmount: discountAmountPaise / 100,
    discountAmountDecimal: paiseToDecimalString(discountAmountPaise),
    discountAmountPaise,
    taxableAmount: taxableAmountPaise / 100,
    taxableAmountDecimal: paiseToDecimalString(taxableAmountPaise),
    taxableAmountPaise,
    gstEnabled,
    gstRate: gstRateNum,
    gstRateDecimal: gstRateNum.toFixed(2),
    gstAmount: gstAmountPaise / 100,
    gstAmountDecimal: paiseToDecimalString(gstAmountPaise),
    gstAmountPaise,
    totalAmount: totalAmountPaise / 100,
    totalAmountDecimal: paiseToDecimalString(totalAmountPaise),
    totalAmountPaise,
    milestones,
  };
}
