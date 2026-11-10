import "@tanstack/react-start/server-only";
import { decimalStringToPaise, paiseToDecimalString, paiseToRupees } from "../db/money.server";
import { type DateWindow, monthEnd, monthStart, shiftDay, weekStart } from "./analyticsCalc.server";

export const GOAL_PERIODS = ["daily", "weekly", "monthly", "custom"] as const;
export type GoalPeriod = (typeof GOAL_PERIODS)[number];

export const GOAL_SCOPES = ["owner", "team"] as const;
export type GoalScope = (typeof GOAL_SCOPES)[number];

export const GOAL_STATUSES = ["active", "paused", "archived"] as const;
export type GoalStatus = (typeof GOAL_STATUSES)[number];

export const GOAL_TARGET_UNITS = ["count", "inr"] as const;
export type GoalTargetUnit = (typeof GOAL_TARGET_UNITS)[number];

export const GOAL_METRIC_KEYS = [
  "calls_logged",
  "calls_connected",
  "followups_completed",
  "leads_created",
  "leads_contacted",
  "leads_qualified",
  "deals_booked",
  "deals_booked_value",
  "cash_collected",
  "quotations_created",
  "quotations_sent",
  "projects_completed",
] as const;
export type GoalMetricKey = (typeof GOAL_METRIC_KEYS)[number];

export interface GoalMetricDefinition {
  key: GoalMetricKey;
  label: string;
  unit: GoalTargetUnit;
  financial: boolean;
  dataSource: string;
  description: string;
}

export const GOAL_METRIC_DEFINITIONS: readonly GoalMetricDefinition[] = [
  {
    key: "calls_logged",
    label: "Calls logged",
    unit: "count",
    financial: false,
    dataSource: "crm_call_logs",
    description:
      "Explicitly logged call outcomes (all outcomes including Not picked and Busy). Dialer launches never count.",
  },
  {
    key: "calls_connected",
    label: "Connected calls",
    unit: "count",
    financial: false,
    dataSource: "crm_call_logs",
    description:
      "Explicitly logged call outcomes with connected=true (excludes Not picked and Busy). Dialer launches never count.",
  },
  {
    key: "followups_completed",
    label: "Follow-ups completed",
    unit: "count",
    financial: false,
    dataSource: "crm_follow_ups",
    description:
      "Non-cancelled follow-ups completed in the Asia/Kolkata window. Scheduled, pending, or cancelled follow-ups never count.",
  },
  {
    key: "leads_created",
    label: "Leads created",
    unit: "count",
    financial: false,
    dataSource: "crm_leads",
    description: "Active leads created in the Asia/Kolkata window.",
  },
  {
    key: "leads_contacted",
    label: "Leads contacted",
    unit: "count",
    financial: false,
    dataSource: "crm_call_logs + crm_whatsapp_logs",
    description:
      "Distinct active leads with at least one logged call outcome or owner-confirmed sent WhatsApp message in the window. Opening dialer or WhatsApp alone never counts.",
  },
  {
    key: "leads_qualified",
    label: "Leads qualified",
    unit: "count",
    financial: false,
    dataSource: "crm_lead_activities",
    description: "Recorded stage transitions into Qualified within the window.",
  },
  {
    key: "deals_booked",
    label: "Deals booked",
    unit: "count",
    financial: false,
    dataSource: "crm_deals",
    description:
      "Non-cancelled deals with verified won_ist_date in the window. Distinct from cash collected.",
  },
  {
    key: "deals_booked_value",
    label: "Booked deal value",
    unit: "inr",
    financial: true,
    dataSource: "crm_deals",
    description:
      "Exact INR sum of final_amount on non-cancelled deals with won_ist_date in the window. Distinct from cash collected.",
  },
  {
    key: "cash_collected",
    label: "Cash collected",
    unit: "inr",
    financial: true,
    dataSource: "crm_payments + crm_deals",
    description:
      "Exact INR sum of non-voided payments in the window for non-cancelled deals. Booked-but-unpaid deals, voided payments, and cancelled-deal payments never count.",
  },
  {
    key: "quotations_created",
    label: "Quotations created",
    unit: "count",
    financial: false,
    dataSource: "crm_quotations",
    description: "Quotations created (issue_ist_date) within the window.",
  },
  {
    key: "quotations_sent",
    label: "Quotations sent",
    unit: "count",
    financial: false,
    dataSource: "crm_quotations",
    description:
      "Quotations explicitly confirmed sent by the Owner within the window. Opening WhatsApp without send confirmation never counts.",
  },
  {
    key: "projects_completed",
    label: "Projects completed",
    unit: "count",
    financial: false,
    dataSource: "crm_projects + crm_project_audit_events",
    description:
      "Non-archived completed projects whose verified delivery date or completion audit date falls in the window. Payment receipts never count.",
  },
] as const;

export const GOAL_METRIC_MAP: Record<GoalMetricKey, GoalMetricDefinition> = Object.fromEntries(
  GOAL_METRIC_DEFINITIONS.map((m) => [m.key, m]),
) as Record<GoalMetricKey, GoalMetricDefinition>;

export function isGoalMetricKey(value: string): value is GoalMetricKey {
  return value in GOAL_METRIC_MAP;
}

export interface GoalDefinitionSnapshot {
  name: string;
  metric: GoalMetricKey;
  scope: GoalScope | string;
  targetUnit: GoalTargetUnit;
  targetCount: number | null;
  targetAmount: string | null;
  period: GoalPeriod;
  customFromIst: string | null;
  customToIst: string | null;
  effectiveFromIst: string;
  status: GoalStatus;
  version: number;
}

export interface GoalRevisionSnapshotEntry {
  revisionNumber: number;
  effectiveFromIst: string;
  snapshot: GoalDefinitionSnapshot;
}

/**
 * Resolves the goal definition that applied on `asOfIstDate` (`YYYY-MM-DD` in Asia/Kolkata).
 * If current goal takes effect after `asOfIstDate`, scans immutable historical revisions
 * newest-first so editing this month's target never rewrites historical periods.
 */
export function definitionOn(
  current: GoalDefinitionSnapshot,
  revisions: readonly GoalRevisionSnapshotEntry[],
  asOfIstDate: string,
): GoalDefinitionSnapshot | null {
  if (current.effectiveFromIst <= asOfIstDate) {
    return current;
  }
  const matching = revisions
    .filter((r) => r.effectiveFromIst <= asOfIstDate)
    .sort((a, b) => b.revisionNumber - a.revisionNumber);
  return matching[0]?.snapshot ?? null;
}

export type WindowState = "active" | "future" | "expired" | "not_started";

export interface ResolvedGoalWindow {
  window: DateWindow | null;
  windowState: WindowState;
}

/**
 * Computes the single inclusive [start, end] Asia/Kolkata business window containing `asOfIstDate`.
 * Weekly windows always run Monday..Sunday. Monthly windows handle leap years and month lengths via Date.UTC.
 */
export function resolveGoalWindow(
  def: Pick<GoalDefinitionSnapshot, "period" | "customFromIst" | "customToIst">,
  asOfIstDate: string,
): ResolvedGoalWindow {
  switch (def.period) {
    case "daily":
      return { window: { start: asOfIstDate, end: asOfIstDate }, windowState: "active" };
    case "weekly": {
      const start = weekStart(asOfIstDate);
      return { window: { start, end: shiftDay(start, 6) }, windowState: "active" };
    }
    case "monthly":
      return {
        window: { start: monthStart(asOfIstDate), end: monthEnd(asOfIstDate) },
        windowState: "active",
      };
    case "custom": {
      const from = def.customFromIst;
      const to = def.customToIst;
      if (!from || !to || from > to) {
        return { window: null, windowState: "expired" };
      }
      if (asOfIstDate < from) {
        return { window: null, windowState: "future" };
      }
      if (asOfIstDate > to) {
        return { window: null, windowState: "expired" };
      }
      return { window: { start: from, end: to }, windowState: "active" };
    }
  }
}

export type GoalMeasurement =
  | {
      measurable: true;
      countValue?: number;
      paiseValue?: number;
      excludedUnknownDateCount?: number;
      note?: string | null;
    }
  | {
      measurable: false;
      reason: string;
    };

export type GoalProgressStatus =
  | "not_configured"
  | "not_measurable"
  | "not_started"
  | "outside_range"
  | "paused"
  | "archived"
  | "no_activity"
  | "in_progress"
  | "met"
  | "exceeded";

export interface GoalProgressResult {
  asOfIstDate: string;
  appliedVersion: number | null;
  appliedEffectiveFromIst: string | null;
  window: DateWindow | null;
  windowState: WindowState;
  status: GoalProgressStatus;
  measurable: boolean;
  unavailableReason: string | null;
  unit: GoalTargetUnit;
  target: number | null;
  targetDecimal: string | null;
  actual: number | null;
  actualDecimal: string | null;
  pct: number | null;
  pctPercent: number | null;
  remaining: number | null;
  remainingDecimal: string | null;
  excludedUnknownDateCount: number;
  note: string | null;
}

function configuredTargetPair(def: GoalDefinitionSnapshot): {
  target: number | null;
  targetDecimal: string | null;
  targetInt: number | null;
} {
  if (def.targetUnit === "count") {
    if (def.targetCount === null || !Number.isInteger(def.targetCount) || def.targetCount <= 0) {
      return { target: null, targetDecimal: null, targetInt: null };
    }
    return { target: def.targetCount, targetDecimal: null, targetInt: def.targetCount };
  }
  if (!def.targetAmount) {
    return { target: null, targetDecimal: null, targetInt: null };
  }
  const paise = decimalStringToPaise(def.targetAmount);
  if (paise <= 0) {
    return { target: null, targetDecimal: null, targetInt: null };
  }
  return {
    target: paiseToRupees(paise),
    targetDecimal: paiseToDecimalString(paise),
    targetInt: paise,
  };
}

/**
 * Authoritative zero-fabrication goal evaluation.
 * - Unset targets return `not_configured` with `target: null`, `pct: null`.
 * - Unavailable/unattributable scopes or metrics return `not_measurable` with `actual: null`, `pct: null`.
 * - Zero denominators never produce NaN/Infinity; `pct` stays `null`.
 */
export function calculateGoalProgress(params: {
  def: GoalDefinitionSnapshot | null;
  goalStatus: GoalStatus;
  asOfIstDate: string;
  measurement: GoalMeasurement;
  fallbackUnit: GoalTargetUnit;
}): GoalProgressResult {
  const { def, goalStatus, asOfIstDate, measurement, fallbackUnit } = params;

  if (!def) {
    return {
      asOfIstDate,
      appliedVersion: null,
      appliedEffectiveFromIst: null,
      window: null,
      windowState: "not_started",
      status: "not_started",
      measurable: false,
      unavailableReason: "Goal is not yet in effect on this date.",
      unit: fallbackUnit,
      target: null,
      targetDecimal: null,
      actual: null,
      actualDecimal: null,
      pct: null,
      pctPercent: null,
      remaining: null,
      remainingDecimal: null,
      excludedUnknownDateCount: 0,
      note: null,
    };
  }

  const { window, windowState } = resolveGoalWindow(def, asOfIstDate);
  const tgt = configuredTargetPair(def);

  if (goalStatus === "archived") {
    return {
      asOfIstDate,
      appliedVersion: def.version,
      appliedEffectiveFromIst: def.effectiveFromIst,
      window,
      windowState,
      status: "archived",
      measurable: false,
      unavailableReason: "Goal is archived.",
      unit: def.targetUnit,
      target: tgt.target,
      targetDecimal: tgt.targetDecimal,
      actual: null,
      actualDecimal: null,
      pct: null,
      pctPercent: null,
      remaining: null,
      remainingDecimal: null,
      excludedUnknownDateCount: 0,
      note: null,
    };
  }

  if (goalStatus === "paused") {
    return {
      asOfIstDate,
      appliedVersion: def.version,
      appliedEffectiveFromIst: def.effectiveFromIst,
      window,
      windowState,
      status: "paused",
      measurable: false,
      unavailableReason: "Goal is paused.",
      unit: def.targetUnit,
      target: tgt.target,
      targetDecimal: tgt.targetDecimal,
      actual: null,
      actualDecimal: null,
      pct: null,
      pctPercent: null,
      remaining: null,
      remainingDecimal: null,
      excludedUnknownDateCount: 0,
      note: null,
    };
  }

  if (!window) {
    return {
      asOfIstDate,
      appliedVersion: def.version,
      appliedEffectiveFromIst: def.effectiveFromIst,
      window: null,
      windowState,
      status: "outside_range",
      measurable: false,
      unavailableReason:
        windowState === "future"
          ? "Custom goal period starts in the future."
          : "Custom goal period has already ended.",
      unit: def.targetUnit,
      target: tgt.target,
      targetDecimal: tgt.targetDecimal,
      actual: null,
      actualDecimal: null,
      pct: null,
      pctPercent: null,
      remaining: null,
      remainingDecimal: null,
      excludedUnknownDateCount: 0,
      note: null,
    };
  }

  if (!measurement.measurable) {
    return {
      asOfIstDate,
      appliedVersion: def.version,
      appliedEffectiveFromIst: def.effectiveFromIst,
      window,
      windowState,
      status: "not_measurable",
      measurable: false,
      unavailableReason: measurement.reason,
      unit: def.targetUnit,
      target: tgt.target,
      targetDecimal: tgt.targetDecimal,
      actual: null,
      actualDecimal: null,
      pct: null,
      pctPercent: null,
      remaining: null,
      remainingDecimal: null,
      excludedUnknownDateCount: 0,
      note: null,
    };
  }

  const excludedUnknownDateCount = measurement.excludedUnknownDateCount ?? 0;

  if (def.targetUnit === "count") {
    const actualInt = Math.max(0, Math.trunc(measurement.countValue ?? 0));
    if (tgt.targetInt === null || tgt.targetInt <= 0) {
      return {
        asOfIstDate,
        appliedVersion: def.version,
        appliedEffectiveFromIst: def.effectiveFromIst,
        window,
        windowState,
        status: "not_configured",
        measurable: true,
        unavailableReason: null,
        unit: "count",
        target: null,
        targetDecimal: null,
        actual: actualInt,
        actualDecimal: null,
        pct: null,
        pctPercent: null,
        remaining: null,
        remainingDecimal: null,
        excludedUnknownDateCount,
        note:
          measurement.note ??
          "Target is explicitly unset; progress percentage cannot be calculated.",
      };
    }

    const ratio = actualInt / tgt.targetInt;
    const pct = Math.round(ratio * 10000) / 10000;
    const pctPercent = Math.round(ratio * 10000) / 100;
    const remaining = Math.max(0, tgt.targetInt - actualInt);
    const status: GoalProgressStatus =
      actualInt === 0
        ? "no_activity"
        : actualInt > tgt.targetInt
          ? "exceeded"
          : actualInt === tgt.targetInt
            ? "met"
            : "in_progress";

    return {
      asOfIstDate,
      appliedVersion: def.version,
      appliedEffectiveFromIst: def.effectiveFromIst,
      window,
      windowState,
      status,
      measurable: true,
      unavailableReason: null,
      unit: "count",
      target: tgt.targetInt,
      targetDecimal: null,
      actual: actualInt,
      actualDecimal: null,
      pct,
      pctPercent,
      remaining,
      remainingDecimal: null,
      excludedUnknownDateCount,
      note: measurement.note ?? null,
    };
  }

  // INR monetary metric (exact integer paise)
  const actualPaise = Math.max(0, Math.trunc(measurement.paiseValue ?? 0));
  const actual = paiseToRupees(actualPaise);
  const actualDecimal = paiseToDecimalString(actualPaise);

  if (tgt.targetInt === null || tgt.targetInt <= 0) {
    return {
      asOfIstDate,
      appliedVersion: def.version,
      appliedEffectiveFromIst: def.effectiveFromIst,
      window,
      windowState,
      status: "not_configured",
      measurable: true,
      unavailableReason: null,
      unit: "inr",
      target: null,
      targetDecimal: null,
      actual,
      actualDecimal,
      pct: null,
      pctPercent: null,
      remaining: null,
      remainingDecimal: null,
      excludedUnknownDateCount,
      note:
        measurement.note ??
        "Monetary target is explicitly unset; progress percentage cannot be calculated.",
    };
  }

  const ratio = actualPaise / tgt.targetInt;
  const pct = Math.round(ratio * 10000) / 10000;
  const pctPercent = Math.round(ratio * 10000) / 100;
  const remainingPaise = Math.max(0, tgt.targetInt - actualPaise);
  const status: GoalProgressStatus =
    actualPaise === 0
      ? "no_activity"
      : actualPaise > tgt.targetInt
        ? "exceeded"
        : actualPaise === tgt.targetInt
          ? "met"
          : "in_progress";

  return {
    asOfIstDate,
    appliedVersion: def.version,
    appliedEffectiveFromIst: def.effectiveFromIst,
    window,
    windowState,
    status,
    measurable: true,
    unavailableReason: null,
    unit: "inr",
    target: tgt.target,
    targetDecimal: tgt.targetDecimal,
    actual,
    actualDecimal,
    pct,
    pctPercent,
    remaining: paiseToRupees(remainingPaise),
    remainingDecimal: paiseToDecimalString(remainingPaise),
    excludedUnknownDateCount,
    note: measurement.note ?? null,
  };
}
