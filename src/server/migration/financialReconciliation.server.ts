import "@tanstack/react-start/server-only";
import {
  CRM_PROOF_METADATA_OVERHEAD_BYTES,
  DEFAULT_MARIADB_HARD_STOP_MIB,
  DEFAULT_MARIADB_QUOTA_MIB,
  DEFAULT_MARIADB_SAFETY_MARGIN_MIB,
  DEFAULT_MARIADB_WARNING_MIB,
  MARIADB_BLOB_OVERHEAD_RATIO,
  MARIADB_CHUNK_ROW_OVERHEAD_BYTES,
  MIB_BYTES,
} from "../storage/mariadbCapacity.server";
import {
  HOSTINGER_EXCLUSIVE_STORAGE_DRIVER,
  type DealFinancialReconciliationRow,
  type FinancialReconciliationReport,
  type HostingerCapacityEstimate,
} from "./types.server";

const PROOF_CHUNK_BYTES = 256 * 1024; // 256 KiB per chunk in crm_payment_proof_blobs

/**
 * Formats an exact integer paise amount as a human-readable INR string (e.g., "₹1,23,456.78")
 * without floating-point rounding drift.
 */
export function formatPaiseInr(paise: number): string {
  const negative = paise < 0;
  const abs = Math.abs(Math.trunc(paise));
  const rupees = Math.floor(abs / 100);
  const rem = String(abs % 100).padStart(2, "0");

  // Indian numbering system grouping (last 3 digits, then pairs of 2)
  const str = String(rupees);
  let grouped: string;
  if (str.length <= 3) {
    grouped = str;
  } else {
    const last3 = str.slice(-3);
    const rest = str.slice(0, -3);
    const paired = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",");
    grouped = `${paired},${last3}`;
  }
  return `${negative ? "-" : ""}₹${grouped}.${rem}`;
}

export interface ReconcilableDeal {
  legacyId: string;
  mappedId: string;
  name: string;
  status: string;
  sourcePaise: number;
  mappedPaise: number;
}

export interface ReconcilableMilestone {
  legacyDealId: string;
  amountPaise: number;
}

export interface ReconcilablePayment {
  legacyId: string;
  legacyDealId: string;
  sourcePaise: number;
  mappedPaise: number;
  voided: boolean;
  voidReason: string | null;
}

export interface FinancialReconciliationInput {
  deals: ReconcilableDeal[];
  milestones: ReconcilableMilestone[];
  payments: ReconcilablePayment[];
  quotationsTotalPaise: number;
  monetaryGoalsTotalPaise: number;
  existingErrors?: string[];
  existingWarnings?: string[];
}

/**
 * Performs exact integer-paise financial reconciliation between source legacy records
 * and mapped MariaDB rows. Any non-zero paise delta fails `financialParityPassed`.
 */
export function buildFinancialReconciliationReport(
  input: FinancialReconciliationInput,
): FinancialReconciliationReport {
  const errors: string[] = [...(input.existingErrors ?? [])];
  const warnings: string[] = [...(input.existingWarnings ?? [])];

  let sourceDealsTotalPaise = 0;
  let mappedDealsTotalPaise = 0;
  let wonDealsPaise = 0;
  let activeDealsPaise = 0;
  let lostDealsPaise = 0;
  let cancelledDealsPaise = 0;

  for (const deal of input.deals) {
    sourceDealsTotalPaise += deal.sourcePaise;
    mappedDealsTotalPaise += deal.mappedPaise;
    if (deal.status === "won") wonDealsPaise += deal.mappedPaise;
    else if (deal.status === "lost") lostDealsPaise += deal.mappedPaise;
    else if (deal.status === "cancelled") cancelledDealsPaise += deal.mappedPaise;
    else activeDealsPaise += deal.mappedPaise;
  }

  const paymentsByDeal = new Map<string, ReconcilablePayment[]>();
  let sourceActivePaymentsPaise = 0;
  let mappedActivePaymentsPaise = 0;
  let sourceVoidedPaymentsPaise = 0;
  let mappedVoidedPaymentsPaise = 0;

  for (const pay of input.payments) {
    const list = paymentsByDeal.get(pay.legacyDealId) ?? [];
    list.push(pay);
    paymentsByDeal.set(pay.legacyDealId, list);

    if (pay.voided) {
      sourceVoidedPaymentsPaise += pay.sourcePaise;
      mappedVoidedPaymentsPaise += pay.mappedPaise;
      if (!pay.voidReason || !pay.voidReason.trim()) {
        errors.push(`Voided payment '${pay.legacyId}' is missing a mandatory void reason.`);
      }
    } else {
      sourceActivePaymentsPaise += pay.sourcePaise;
      mappedActivePaymentsPaise += pay.mappedPaise;
    }
  }

  const milestonesByDeal = new Map<string, number>();
  for (const ms of input.milestones) {
    milestonesByDeal.set(
      ms.legacyDealId,
      (milestonesByDeal.get(ms.legacyDealId) ?? 0) + ms.amountPaise,
    );
  }

  const dealBreakdown: DealFinancialReconciliationRow[] = [];
  let totalOutstandingPaise = 0;
  let overpaidDealsCount = 0;

  for (const deal of input.deals) {
    const dealPayments = paymentsByDeal.get(deal.legacyId) ?? [];
    let dealActivePaise = 0;
    let dealVoidedPaise = 0;
    let voidedCount = 0;

    for (const p of dealPayments) {
      if (p.voided) {
        dealVoidedPaise += p.mappedPaise;
        voidedCount++;
      } else {
        dealActivePaise += p.mappedPaise;
      }
    }

    const isOpenOrWon = deal.status === "active" || deal.status === "won";
    const rawBalance = deal.mappedPaise - dealActivePaise;
    const outstandingPaise = isOpenOrWon ? Math.max(0, rawBalance) : 0;
    const overpaidPaise = rawBalance < 0 ? Math.abs(rawBalance) : 0;

    if (overpaidPaise > 0) {
      overpaidDealsCount++;
      warnings.push(
        `Deal '${deal.legacyId}' (${deal.name}) has active payments (${formatPaiseInr(dealActivePaise)}) exceeding deal value (${formatPaiseInr(deal.mappedPaise)}) by ${formatPaiseInr(overpaidPaise)}.`,
      );
    }

    totalOutstandingPaise += outstandingPaise;

    const milestoneTotalPaise = milestonesByDeal.get(deal.legacyId) ?? 0;
    const milestoneDeltaPaise =
      milestoneTotalPaise > 0 ? milestoneTotalPaise - deal.mappedPaise : 0;
    if (milestoneTotalPaise > 0 && milestoneDeltaPaise !== 0) {
      warnings.push(
        `Deal '${deal.legacyId}' milestone sum (${formatPaiseInr(milestoneTotalPaise)}) differs from deal value (${formatPaiseInr(deal.mappedPaise)}) by ${formatPaiseInr(milestoneDeltaPaise)}.`,
      );
    }

    dealBreakdown.push({
      dealId: deal.legacyId,
      mappedDealId: deal.mappedId,
      dealName: deal.name,
      status: deal.status,
      finalAmountPaise: deal.mappedPaise,
      activePaymentsPaise: dealActivePaise,
      voidedPaymentsPaise: dealVoidedPaise,
      outstandingPaise,
      overpaidPaise,
      milestoneTotalPaise,
      milestoneDeltaPaise,
      paymentCount: dealPayments.length,
      voidedPaymentCount: voidedCount,
    });
  }

  const dealsDeltaPaise = mappedDealsTotalPaise - sourceDealsTotalPaise;
  const activePaymentsDeltaPaise = mappedActivePaymentsPaise - sourceActivePaymentsPaise;
  const voidedPaymentsDeltaPaise = mappedVoidedPaymentsPaise - sourceVoidedPaymentsPaise;

  if (dealsDeltaPaise !== 0) {
    errors.push(
      `Deals total paise mismatch: source=${sourceDealsTotalPaise}, mapped=${mappedDealsTotalPaise}, delta=${dealsDeltaPaise}.`,
    );
  }
  if (activePaymentsDeltaPaise !== 0) {
    errors.push(
      `Active payments total paise mismatch: source=${sourceActivePaymentsPaise}, mapped=${mappedActivePaymentsPaise}, delta=${activePaymentsDeltaPaise}.`,
    );
  }
  if (voidedPaymentsDeltaPaise !== 0) {
    errors.push(
      `Voided payments total paise mismatch: source=${sourceVoidedPaymentsPaise}, mapped=${mappedVoidedPaymentsPaise}, delta=${voidedPaymentsDeltaPaise}.`,
    );
  }

  const financialParityPassed =
    errors.length === 0 &&
    dealsDeltaPaise === 0 &&
    activePaymentsDeltaPaise === 0 &&
    voidedPaymentsDeltaPaise === 0;

  return {
    financialParityPassed,
    currency: "INR",
    precisionUnit: "integer_paise",
    sourceDealsTotalPaise,
    mappedDealsTotalPaise,
    dealsDeltaPaise,
    wonDealsPaise,
    activeDealsPaise,
    lostDealsPaise,
    cancelledDealsPaise,
    sourceActivePaymentsPaise,
    mappedActivePaymentsPaise,
    activePaymentsDeltaPaise,
    sourceVoidedPaymentsPaise,
    mappedVoidedPaymentsPaise,
    voidedPaymentsDeltaPaise,
    totalOutstandingPaise,
    overpaidDealsCount,
    quotationsTotalPaise: input.quotationsTotalPaise,
    monetaryGoalsTotalPaise: input.monetaryGoalsTotalPaise,
    formattedSummary: {
      dealsBookedInr: formatPaiseInr(wonDealsPaise + activeDealsPaise),
      activePaymentsInr: formatPaiseInr(mappedActivePaymentsPaise),
      voidedPaymentsInr: formatPaiseInr(mappedVoidedPaymentsPaise),
      outstandingInr: formatPaiseInr(totalOutstandingPaise),
      quotationsTotalInr: formatPaiseInr(input.quotationsTotalPaise),
    },
    dealBreakdown,
    errors,
    warnings,
  };
}

/**
 * Estimates Hostinger MariaDB capacity impact for the migration payload using
 * the B11C 3,072 MiB quota policy (50% warning = 1,536 MiB, 70% hard stop = 2,150 MiB).
 * Cloudflare R2 is explicitly not required.
 */
export function estimateHostingerMigrationCapacity(params: {
  totalSqlRecords: number;
  proofSizesBytes: number[];
  baselineUsedMiB?: number;
  quotaMiB?: number;
  warningThresholdMiB?: number;
  hardStopThresholdMiB?: number;
}): HostingerCapacityEstimate {
  const quotaMiB = params.quotaMiB ?? DEFAULT_MARIADB_QUOTA_MIB;
  const warningThresholdMiB = params.warningThresholdMiB ?? DEFAULT_MARIADB_WARNING_MIB;
  const hardStopThresholdMiB = params.hardStopThresholdMiB ?? DEFAULT_MARIADB_HARD_STOP_MIB;
  const baselineUsedMiB = params.baselineUsedMiB ?? DEFAULT_MARIADB_SAFETY_MARGIN_MIB;

  // Conservative ~2 KiB per SQL record including InnoDB secondary indexes
  const estimatedSqlBytes = Math.max(0, params.totalSqlRecords) * 2048;

  let estimatedProofRawBytes = 0;
  let estimatedProofBlobBytes = 0;
  for (const size of params.proofSizesBytes) {
    const safeSize = Math.max(0, size);
    estimatedProofRawBytes += safeSize;
    const chunks = Math.max(1, Math.ceil(safeSize / PROOF_CHUNK_BYTES));
    estimatedProofBlobBytes +=
      Math.ceil(safeSize * MARIADB_BLOB_OVERHEAD_RATIO) +
      chunks * MARIADB_CHUNK_ROW_OVERHEAD_BYTES +
      CRM_PROOF_METADATA_OVERHEAD_BYTES;
  }

  const estimatedTotalMigrationBytes = estimatedSqlBytes + estimatedProofBlobBytes;
  const estimatedTotalMigrationMiB = Number((estimatedTotalMigrationBytes / MIB_BYTES).toFixed(3));
  const projectedUsedMiB = Number((baselineUsedMiB + estimatedTotalMigrationMiB).toFixed(2));
  const projectedPercentOfQuota = Number(((projectedUsedMiB / quotaMiB) * 100).toFixed(2));

  let status: HostingerCapacityEstimate["status"] = "safe";
  if (projectedUsedMiB > hardStopThresholdMiB) {
    status = "hard_stop_exceeded";
  } else if (projectedUsedMiB >= warningThresholdMiB) {
    status = "warning";
  }

  return {
    hostingProvider: "hostinger_exclusive",
    cloudflareR2Required: false,
    proofStorageDriver: HOSTINGER_EXCLUSIVE_STORAGE_DRIVER,
    quotaMiB,
    warningThresholdMiB,
    hardStopThresholdMiB,
    estimatedSqlBytes,
    estimatedProofRawBytes,
    estimatedProofBlobBytes,
    estimatedTotalMigrationBytes,
    estimatedTotalMigrationMiB,
    baselineUsedMiB,
    projectedUsedMiB,
    projectedPercentOfQuota,
    status,
    fitsWithinHostingerBudget: status !== "hard_stop_exceeded",
  };
}
