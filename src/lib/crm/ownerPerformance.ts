// AI-7A — Owner "My Performance" metrics (pure, deterministic, backend-agnostic).
// Every number comes from saved CRM records and verified activity events:
//  • Owner attribution = ActivityEvent.actorUserId === OWNER_ACTOR_ID (demo events never count).
//  • Events by anyone else (employees without verified accounts, automation) are reported
//    separately as "not credited to you" — never silently assumed to be the Owner's work.
//  • Payments carry no verified actor, so money figures are a Company Finance Snapshot,
//    never presented as personally collected by the Owner.
//  • Opening tel:/WhatsApp never counts: only saved call outcomes and confirmed shares do.
import type { Deal, FollowUp, Lead, Payment } from "./types";
import type { ActivityEvent } from "./activity";
import { OWNER_ACTOR_ID } from "./activity";
import type { QuotationShare } from "./studio";
import { financeSummary } from "./finance";
import { dayKey } from "./format";
import { shiftDay } from "./dates";
import { isPending } from "./followups";
import {
  cohortConversion, eventValue, followUpCompletion, inWindow, indexEvents, metricSeries, metricValue, rate,
  type EventIndex, type Window,
} from "./performance";

const OWNER = { kind: "employee" as const, id: OWNER_ACTOR_ID };
/** Genuine Owner events only — demo simulation rows are excluded. */
export const isOwnerEvent = (e: ActivityEvent) => e.actorUserId === OWNER_ACTOR_ID && e.eventSource !== "demo";
/** Events in the window that cannot be credited to the Owner (other actors, automation excluded). */
export const unattributedEvents = (idx: EventIndex, w: Window) =>
  daysEvents(idx, w).filter((e) => e.actorUserId !== OWNER_ACTOR_ID && e.actorUserId !== "automation");

function daysEvents(idx: EventIndex, w: Window): ActivityEvent[] {
  const out: ActivityEvent[] = [];
  for (const [day, evs] of idx.byDay) if (day >= w.start && day <= w.end) out.push(...evs);
  return out;
}

export interface OwnerMetrics {
  calls: number;
  connected: number;
  /** connected / calls, null when no calls logged (never NaN, never a misleading 0%). */
  connectionRate: number | null;
  followUpsCompleted: number;
  /** Non-cancelled follow-ups due in the window (all recorded follow-ups — the Owner's book). */
  followUpsDue: number;
  followUpsDone: number;
  followUpRate: number | null;
  /** Pending follow-ups whose scheduled time has already passed. */
  overdue: number;
  leadsCreated: number;
  qualified: number;
  /** Quotations the Owner explicitly confirmed as shared, in the window. */
  quotationsShared: number;
  dealsWon: number;
  /** Won value of deals with a reliable wonAt in the window; deals without wonAt are excluded. */
  wonValue: number;
  unknownWonDates: number;
  /** Lead-to-Won for the cohort of leads the Owner created in the window. */
  cohort: number;
  cohortWon: number;
  winRate: number | null;
  /** Events in the window by other actors — shown separately, never credited to the Owner. */
  unattributed: number;
}

export function ownerMetrics(
  data: { events: ActivityEvent[]; leads: Lead[]; followUps: FollowUp[]; deals: Deal[]; quotationShares: QuotationShare[] },
  w: Window,
  now: Date,
): OwnerMetrics {
  const idx = indexEvents(data.events, false);
  const calls = metricValue(idx, "calls", OWNER, w) ?? 0;
  const connected = metricValue(idx, "connected", OWNER, w) ?? 0;
  const fu = followUpCompletion(data.followUps, w);
  const nowIso = now.toISOString();
  // Owner-created lead cohort: only leads whose creation event is verified as the Owner's.
  const createdIds = new Set(
    daysEvents(idx, w).filter((e) => isOwnerEvent(e) && e.eventType === "lead.created" && e.relatedLeadId).map((e) => e.relatedLeadId!),
  );
  const coh = cohortConversion(data.leads, w, createdIds);
  // Won value: deals linked to an Owner deal.won event, counted by their verified wonAt.
  const wonLeadIds = new Set(
    daysEvents(idx, w).filter((e) => isOwnerEvent(e) && e.eventType === "deal.won" && e.relatedLeadId).map((e) => e.relatedLeadId!),
  );
  let wonValue = 0, unknownWonDates = 0;
  for (const d of data.deals) {
    if (!d.leadId || !wonLeadIds.has(d.leadId)) continue;
    if (d.wonAt && inWindow(d.wonAt, w)) wonValue += d.finalAmount;
    else if (!d.wonAt) unknownWonDates++;
  }
  return {
    calls, connected, connectionRate: rate(connected, calls),
    followUpsCompleted: metricValue(idx, "followupsCompleted", OWNER, w) ?? 0,
    followUpsDue: fu.due, followUpsDone: fu.done, followUpRate: fu.rate,
    overdue: data.followUps.filter((f) => isPending(f) && f.dueAt < nowIso).length,
    leadsCreated: metricValue(idx, "leadsCreated", OWNER, w) ?? 0,
    qualified: metricValue(idx, "qualified", OWNER, w) ?? 0,
    quotationsShared: data.quotationShares.filter((q) => q.userConfirmedSent && inWindow(q.createdAt, w)).length,
    dealsWon: wonLeadIds.size, wonValue, unknownWonDates,
    cohort: coh.cohort, cohortWon: coh.won, winRate: coh.winRate,
    unattributed: unattributedEvents(idx, w).length,
  };
}

/** Daily series for the charts — real recorded days only, zero-filled inside the window, never fabricated beyond it. */
export function ownerSeries(events: ActivityEvent[], w: Window) {
  const idx = indexEvents(events, false);
  return {
    calls: metricSeries(idx, "calls", OWNER, w),
    followUps: metricSeries(idx, "followupsCompleted", OWNER, w),
    leads: metricSeries(idx, "leadsCreated", OWNER, w),
  };
}

export interface WonMonth { month: string; count: number; value: number }
/** Monthly Won trend across all reliable history (deals with a verified wonAt, linked to an Owner deal.won event). */
export function wonTrend(events: ActivityEvent[], deals: Deal[], months = 6, now: Date = new Date()): WonMonth[] {
  const idx = indexEvents(events, false);
  const wonLeadIds = new Set<string>();
  for (const evs of idx.byDay.values()) for (const e of evs) if (isOwnerEvent(e) && e.eventType === "deal.won" && e.relatedLeadId) wonLeadIds.add(e.relatedLeadId);
  const out: WonMonth[] = [];
  // Walk backwards from this month, first of each month.
  let d = dayKey(now).slice(0, 8) + "01";
  const keys: string[] = [];
  for (let i = 0; i < months; i++) { keys.unshift(d.slice(0, 7)); d = shiftDay(d, -1).slice(0, 8) + "01"; }
  for (const k of keys) out.push({ month: k, count: 0, value: 0 });
  for (const deal of deals) {
    if (!deal.leadId || !wonLeadIds.has(deal.leadId) || !deal.wonAt) continue;
    const k = dayKey(deal.wonAt).slice(0, 7);
    const row = out.find((r) => r.month === k);
    if (row) { row.count++; row.value += deal.finalAmount; }
  }
  return out;
}

export interface TimelineRow { id: string; at: string; label: string; leadId?: string | undefined }
/** Owner activity timeline for the window — one row per saved action, newest first, deduped by eventId. */
export function ownerTimeline(events: ActivityEvent[], w: Window, labelOf: (e: ActivityEvent) => string, cap = 40): TimelineRow[] {
  const idx = indexEvents(events, false);
  const seen = new Set<string>();
  return daysEvents(idx, w)
    .filter((e) => isOwnerEvent(e) && ["call.logged", "followup.completed", "lead.created", "pipeline.stage_changed", "deal.won"].includes(e.eventType))
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
    .filter((e) => (seen.has(e.eventId) ? false : (seen.add(e.eventId), true)))
    .slice(0, cap)
    .map((e) => ({ id: e.eventId, at: e.occurredAt, label: labelOf(e), leadId: e.relatedLeadId }));
}

/** Company-wide money overview — payments have no verified actor, so this is never "my collections". */
export function companyFinanceSnapshot(deals: Deal[], payments: Payment[], now: Date) {
  return financeSummary(deals, payments, now);
}

/** Structured, permission-safe summary for the future AI Performance Coach (AI-7B). Read-only; no conclusions. */
export function performanceSummary(m: OwnerMetrics, w: Window) {
  return {
    window: { start: w.start, end: w.end, timezone: "Asia/Kolkata" },
    activity: { calls: m.calls, connected: m.connected, connectionRate: m.connectionRate, followUpsCompleted: m.followUpsCompleted, followUpsDue: m.followUpsDue, overdue: m.overdue },
    pipeline: { leadsCreated: m.leadsCreated, qualified: m.qualified, quotationsShared: m.quotationsShared, dealsWon: m.dealsWon, wonValue: m.wonValue, unknownWonDates: m.unknownWonDates },
    conversion: { cohort: m.cohort, won: m.cohortWon, winRate: m.winRate },
    dataQuality: { unattributedEvents: m.unattributed },
  };
}
