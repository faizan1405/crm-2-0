import "@tanstack/react-start/server-only";
import { and, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import type { CrmDatabase } from "../db/index.server";
import {
  decimalStringToPaise,
  paiseToDecimalString,
  paiseToRupees,
  sumPaise,
} from "../db/money.server";
import {
  crmCallLogs,
  crmClientSupportTickets,
  crmDeals,
  crmFollowUps,
  crmLeadActivities,
  crmLeads,
  crmPayments,
  crmProjects,
  crmProjectTasks,
  crmQuotations,
  crmWhatsAppLogs,
} from "../db/schema.server";
import { parseUtcDateTime, toMysqlUtcDateTime } from "../db/utc.server";
import {
  type AnalyticsPeriod,
  type Granularity,
  bucketOf,
  buckets,
  defaultGranularity,
  getIstDay,
  getIstUtcRange,
  isBusyCallOutcome,
  isCountedWonDealStatus,
  isDayInWindow,
  isNoAnswerCallOutcome,
  median,
  rate,
  resolveAnalyticsWindow,
  shiftDay,
} from "./analyticsCalc.server";
import {
  calculateDealFinancialSummary,
} from "./financeCalc.server";
import {
  type CheckItem,
  type ProjectDelivery,
  type ProjectSupport,
  isActiveProject,
  isProjectOverdue,
  supportStatus,
  taskOverdue,
} from "./projectsCalc.server";

// ----------------------------------------------------------------------------
// 1. DASHBOARD OVERVIEW
// ----------------------------------------------------------------------------

export async function getDashboardOverview(
  db: CrmDatabase,
  ownerUserId: string,
  now: Date = new Date(),
) {
  const todayIstDate = getIstDay(now);
  const nowMs = now.getTime();

  // A. Leads & Pipeline
  const activeLeads = await db
    .select({
      id: crmLeads.id,
      name: crmLeads.name,
      company: crmLeads.company,
      phone: crmLeads.phone,
      source: crmLeads.source,
      status: crmLeads.status,
      priority: crmLeads.priority,
      aiScore: crmLeads.aiScore,
      quotedAmount: crmLeads.quotedAmount,
      lastContactAt: crmLeads.lastContactAt,
      nextFollowUpAt: crmLeads.nextFollowUpAt,
      createdAt: crmLeads.createdAt,
    })
    .from(crmLeads)
    .where(
      and(
        eq(crmLeads.ownerUserId, ownerUserId),
        eq(crmLeads.lifecycleStatus, "active"),
      ),
    );

  const openLeads = activeLeads.filter(
    (l) => !["won", "lost"].includes(l.status),
  );
  const openPipelinePaise = sumPaise(
    openLeads.map((l) => decimalStringToPaise(l.quotedAmount ?? "0.00")),
  );
  const hotLeads = openLeads.filter((l) => l.priority === "hot");

  const STAGES = [
    "new",
    "contacted",
    "qualified",
    "proposal",
    "won",
    "lost",
  ] as const;
  const STAGE_LABELS: Record<string, string> = {
    new: "New",
    contacted: "Contacted",
    qualified: "Qualified",
    proposal: "Proposal Sent",
    won: "Won",
    lost: "Lost",
  };

  const stages = STAGES.map((s) => {
    const list = activeLeads.filter((l) => l.status === s);
    const totalPaise = sumPaise(
      list.map((l) => decimalStringToPaise(l.quotedAmount ?? "0.00")),
    );
    return {
      stage: s,
      name: STAGE_LABELS[s] ?? s,
      count: list.length,
      value: paiseToRupees(totalPaise),
      valueDecimal: paiseToDecimalString(totalPaise),
    };
  });

  const openStages = stages.filter((s) => !["won", "lost"].includes(s.stage));
  const bottleneck = openStages.reduce(
    (max, cur) => (cur.count > max.count ? cur : max),
    openStages[0] ?? {
      stage: "new",
      name: "New",
      count: 0,
      value: 0,
      valueDecimal: "0.00",
    },
  );

  const wonCount = stages.find((s) => s.stage === "won")?.count ?? 0;
  const lostCount = stages.find((s) => s.stage === "lost")?.count ?? 0;
  const closedCount = wonCount + lostCount;
  const winRate = rate(wonCount, closedCount);

  // B. Follow-ups
  const allFollowUps = await db
    .select({
      id: crmFollowUps.id,
      leadId: crmFollowUps.leadId,
      type: crmFollowUps.type,
      dueAt: crmFollowUps.dueAt,
      dueIstDate: crmFollowUps.dueIstDate,
      dueIstTime: crmFollowUps.dueIstTime,
      note: crmFollowUps.note,
      completedAt: crmFollowUps.completedAt,
      cancelledAt: crmFollowUps.cancelledAt,
    })
    .from(crmFollowUps)
    .where(
      and(
        eq(crmFollowUps.ownerUserId, ownerUserId),
        isNull(crmFollowUps.cancelledAt),
      ),
    );

  const pendingFollowUps = allFollowUps
    .filter((f) => !f.completedAt)
    .sort((a, b) => parseUtcDateTime(a.dueAt).getTime() - parseUtcDateTime(b.dueAt).getTime());

  const overdueFollowUps = pendingFollowUps.filter(
    (f) => parseUtcDateTime(f.dueAt).getTime() < nowMs,
  );
  const dueTodayFollowUps = pendingFollowUps.filter(
    (f) =>
      f.dueIstDate === todayIstDate &&
      parseUtcDateTime(f.dueAt).getTime() >= nowMs,
  );

  const oldestOverdue = overdueFollowUps[0]
    ? parseUtcDateTime(overdueFollowUps[0].dueAt).toISOString()
    : null;

  // Next 7 days pending follow-ups counts
  const next7DaysFollowUps = Array.from({ length: 7 }, (_, i) => {
    const day = shiftDay(todayIstDate, i);
    const count = pendingFollowUps.filter((f) => f.dueIstDate === day).length;
    return { day, count };
  });

  // C. Deals & Payments
  const deals = await db
    .select({
      id: crmDeals.id,
      leadId: crmDeals.leadId,
      name: crmDeals.name,
      clientName: crmDeals.clientName,
      status: crmDeals.status,
      quotedAmount: crmDeals.quotedAmount,
      finalAmount: crmDeals.finalAmount,
      dueDate: crmDeals.dueDate,
      wonIstDate: crmDeals.wonIstDate,
    })
    .from(crmDeals)
    .where(eq(crmDeals.ownerUserId, ownerUserId));

  const payments = await db
    .select({
      id: crmPayments.id,
      dealId: crmPayments.dealId,
      amount: crmPayments.amount,
      paymentIstDate: crmPayments.paymentIstDate,
      voided: crmPayments.voided,
    })
    .from(crmPayments)
    .where(eq(crmPayments.ownerUserId, ownerUserId));

  const nonCancelledDeals = deals.filter((d) => d.status !== "cancelled");
  const dealSummaries = nonCancelledDeals.map((d) => {
    const dPayments = payments.filter((p) => p.dealId === d.id);
    return calculateDealFinancialSummary(
      {
        id: d.id,
        quotedAmount: d.quotedAmount,
        finalAmount: d.finalAmount,
        status: d.status as any,
        dueDate: d.dueDate,
        wonIstDate: d.wonIstDate,
      },
      dPayments.map((p) => ({
        id: p.id,
        dealId: p.dealId,
        amount: p.amount,
        paymentIstDate: p.paymentIstDate,
        voided: p.voided,
      })),
      [],
      todayIstDate,
    );
  });

  const totalCollectedPaise = sumPaise(
    dealSummaries.map((s) => s.collectedPaise),
  );
  const totalOutstandingPaise = sumPaise(
    dealSummaries.map((s) => s.outstandingPaise),
  );
  const totalOverduePaise = sumPaise(dealSummaries.map((s) => s.overduePaise));
  const totalBookedPaise = sumPaise(
    dealSummaries.map((s) => s.finalAmountPaise),
  );

  const collectionRate = rate(totalCollectedPaise, totalBookedPaise);
  const dueDeals = dealSummaries.filter((s) =>
    ["overdue", "partial", "unpaid"].includes(s.paymentStatus),
  );

  // D. Action Center Tasks
  const leadMap = new Map(activeLeads.map((l) => [l.id, l]));

  const actionItems: {
    key: string;
    kind: "overdue" | "today" | "hot" | "money";
    leadId?: string;
    dealId?: string;
    title: string;
    detail: string;
    when: string;
    followUpId?: string;
    phone?: string;
    amount?: number;
  }[] = [];

  for (const f of overdueFollowUps.slice(0, 4)) {
    const l = leadMap.get(f.leadId);
    actionItems.push({
      key: `fu-${f.id}`,
      kind: "overdue",
      leadId: f.leadId,
      followUpId: f.id,
      title: l?.name ?? "Lead",
      detail: `${f.type}${f.note ? ` · ${f.note}` : ""}`,
      when: `Due ${f.dueIstDate} ${f.dueIstTime}`,
      ...(l?.phone ? { phone: l.phone } : {}),
    });
  }

  for (const f of dueTodayFollowUps.slice(0, 4)) {
    const l = leadMap.get(f.leadId);
    actionItems.push({
      key: `fu-${f.id}`,
      kind: "today",
      leadId: f.leadId,
      followUpId: f.id,
      title: l?.name ?? "Lead",
      detail: `${f.type}${f.note ? ` · ${f.note}` : ""}`,
      when: f.dueIstTime,
      ...(l?.phone ? { phone: l.phone } : {}),
    });
  }

  const hotWithoutTodayFollowUp = hotLeads.filter(
    (l) =>
      !pendingFollowUps.some(
        (f) => f.leadId === l.id && f.dueIstDate <= todayIstDate,
      ),
  );
  for (const l of hotWithoutTodayFollowUp.slice(0, 4)) {
    actionItems.push({
      key: `hot-${l.id}`,
      kind: "hot",
      leadId: l.id,
      title: l.name,
      detail: `${l.status} · ${l.company ?? l.source}`,
      when: l.lastContactAt ? "Contacted" : "Not contacted yet",
      ...(l.phone ? { phone: l.phone } : {}),
    });
  }

  for (const d of dueDeals.slice(0, 4)) {
    const rawDeal = deals.find((x) => x.id === d.dealId);
    actionItems.push({
      key: `deal-${d.dealId}`,
      kind: "money",
      dealId: d.dealId,
      title: rawDeal?.clientName ?? rawDeal?.name ?? "Client",
      detail: `${rawDeal?.name} · ${d.paymentStatus}`,
      when: `₹${d.outstanding.toLocaleString("en-IN")}`,
      amount: d.outstanding,
    });
  }

  // E. Priority Prospects (top 5 hot & high score)
  const priorityProspects = [...openLeads]
    .sort((a, b) => {
      const hotA = a.priority === "hot" ? 1 : 0;
      const hotB = b.priority === "hot" ? 1 : 0;
      if (hotB !== hotA) return hotB - hotA;
      return (b.aiScore ?? 0) - (a.aiScore ?? 0);
    })
    .slice(0, 5)
    .map((l) => ({
      id: l.id,
      name: l.name,
      company: l.company,
      source: l.source,
      status: l.status,
      priority: l.priority,
      quotedAmount: l.quotedAmount ? Number(l.quotedAmount) : null,
      lastContactAt: l.lastContactAt
        ? parseUtcDateTime(l.lastContactAt).toISOString()
        : null,
      nextFollowUpAt: l.nextFollowUpAt
        ? parseUtcDateTime(l.nextFollowUpAt).toISOString()
        : null,
      phone: l.phone,
    }));

  // F. Recent Activities (top 6)
  const recentActs = await db
    .select({
      id: crmLeadActivities.id,
      leadId: crmLeadActivities.leadId,
      type: crmLeadActivities.type,
      text: crmLeadActivities.text,
      occurredAt: crmLeadActivities.occurredAt,
      leadName: crmLeads.name,
    })
    .from(crmLeadActivities)
    .innerJoin(crmLeads, eq(crmLeadActivities.leadId, crmLeads.id))
    .where(eq(crmLeadActivities.ownerUserId, ownerUserId))
    .orderBy(sql`${crmLeadActivities.occurredAt} DESC`)
    .limit(6);

  return {
    ok: true as const,
    todayIstDate,
    kpis: {
      openPipelineValue: paiseToRupees(openPipelinePaise),
      openPipelineValueDecimal: paiseToDecimalString(openPipelinePaise),
      activeLeadsCount: openLeads.length,
      hotLeadsCount: hotLeads.length,
      followUpsTodayCount:
        dueTodayFollowUps.length +
        overdueFollowUps.filter((f) => f.dueIstDate === todayIstDate).length,
      followUpsOverdueCount: overdueFollowUps.length,
      oldestOverdueDueAt: oldestOverdue,
      receivedValue: paiseToRupees(totalCollectedPaise),
      receivedValueDecimal: paiseToDecimalString(totalCollectedPaise),
      outstandingValue: paiseToRupees(totalOutstandingPaise),
      outstandingValueDecimal: paiseToDecimalString(totalOutstandingPaise),
      overdueDealsValue: paiseToRupees(totalOverduePaise),
      overdueDealsValueDecimal: paiseToDecimalString(totalOverduePaise),
      dueDealsCount: dueDeals.length,
      winRate,
    },
    bottleneck,
    stages,
    collectionProgress: {
      received: paiseToRupees(totalCollectedPaise),
      receivedDecimal: paiseToDecimalString(totalCollectedPaise),
      outstanding: paiseToRupees(totalOutstandingPaise),
      outstandingDecimal: paiseToDecimalString(totalOutstandingPaise),
      overdue: paiseToRupees(totalOverduePaise),
      overdueDecimal: paiseToDecimalString(totalOverduePaise),
      collectionRate,
    },
    actionCenter: {
      counts: {
        all: actionItems.length,
        overdue: overdueFollowUps.length,
        today: dueTodayFollowUps.length,
        hot: hotWithoutTodayFollowUp.length,
        money: dueDeals.length,
      },
      items: actionItems.slice(0, 8),
    },
    priorityProspects,
    recentActivities: recentActs.map((a) => ({
      id: a.id,
      leadId: a.leadId,
      leadName: a.leadName,
      type: a.type,
      text: a.text,
      occurredAt: parseUtcDateTime(a.occurredAt).toISOString(),
    })),
    next7DaysFollowUps,
  };
}

// ----------------------------------------------------------------------------
// 2. FUNNEL ANALYTICS
// ----------------------------------------------------------------------------

export async function getFunnelAnalytics(
  db: CrmDatabase,
  ownerUserId: string,
  period: AnalyticsPeriod = "thisMonth",
  customFrom?: string | null,
  customTo?: string | null,
  now: Date = new Date(),
) {
  const window = resolveAnalyticsWindow(period, now, customFrom, customTo);
  const { startUtc, endUtc } = getIstUtcRange(window);
  const startUtcSql = toMysqlUtcDateTime(startUtc);
  const endUtcSql = toMysqlUtcDateTime(endUtc);

  // A. Current Distribution (all active leads)
  const allActiveLeads = await db
    .select({
      id: crmLeads.id,
      status: crmLeads.status,
      quotedAmount: crmLeads.quotedAmount,
      source: crmLeads.source,
      createdAt: crmLeads.createdAt,
      lostReason: crmLeads.lostReason,
    })
    .from(crmLeads)
    .where(
      and(
        eq(crmLeads.ownerUserId, ownerUserId),
        eq(crmLeads.lifecycleStatus, "active"),
      ),
    );

  const STAGES = [
    "new",
    "contacted",
    "qualified",
    "proposal",
    "won",
    "lost",
  ] as const;
  const STAGE_LABELS: Record<string, string> = {
    new: "New",
    contacted: "Contacted",
    qualified: "Qualified",
    proposal: "Proposal Sent",
    won: "Won",
    lost: "Lost",
  };

  const currentDistribution = STAGES.map((s) => {
    const list = allActiveLeads.filter((l) => l.status === s);
    const sumP = sumPaise(
      list.map((l) => decimalStringToPaise(l.quotedAmount ?? "0.00")),
    );
    return {
      stage: s,
      label: STAGE_LABELS[s] ?? s,
      count: list.length,
      value: paiseToRupees(sumP),
      valueDecimal: paiseToDecimalString(sumP),
    };
  });

  // B. Stage Moves in Window
  const stageActivities = await db
    .select({
      id: crmLeadActivities.id,
      text: crmLeadActivities.text,
      occurredAt: crmLeadActivities.occurredAt,
    })
    .from(crmLeadActivities)
    .where(
      and(
        eq(crmLeadActivities.ownerUserId, ownerUserId),
        eq(crmLeadActivities.type, "status"),
        gte(crmLeadActivities.occurredAt, startUtcSql),
        lte(crmLeadActivities.occurredAt, endUtcSql),
      ),
    );

  const STATUS_RE = /^Status changed to (\w+)/;
  const moveCounts: Record<string, number> = {};
  for (const a of stageActivities) {
    const m = STATUS_RE.exec(a.text);
    const to = m?.[1];
    if (to && (STAGES as readonly string[]).includes(to)) {
      moveCounts[to] = (moveCounts[to] ?? 0) + 1;
    }
  }

  const stageMoves = STAGES.filter((s) => s !== "new").map((s) => ({
    stage: s,
    label: STAGE_LABELS[s] ?? s,
    count: moveCounts[s] ?? 0,
  }));

  // C. Cohort Conversion (leads created in the window)
  const cohortLeads = allActiveLeads.filter((l) => {
    const dt = parseUtcDateTime(l.createdAt);
    return dt >= startUtc && dt <= endUtc;
  });
  const cohortWon = cohortLeads.filter((l) => l.status === "won").length;
  const cohortQualified = cohortLeads.filter((l) =>
    ["qualified", "proposal", "won"].includes(l.status),
  ).length;
  const cohortLost = cohortLeads.filter((l) => l.status === "lost").length;

  const isDeveloping = window.end >= shiftDay(getIstDay(now), -30);

  // Closed Conversion (won vs lost snapshot)
  const allWon = allActiveLeads.filter((l) => l.status === "won").length;
  const allLost = allActiveLeads.filter((l) => l.status === "lost").length;

  // D. Lost Reasons
  const lostLeads = allActiveLeads.filter((l) => l.status === "lost");
  const reasonMap = new Map<string, { count: number; totalPaise: number }>();
  for (const l of lostLeads) {
    const key = l.lostReason?.trim() || "Not recorded";
    const cur = reasonMap.get(key) ?? { count: 0, totalPaise: 0 };
    cur.count++;
    cur.totalPaise = sumPaise([
      cur.totalPaise,
      decimalStringToPaise(l.quotedAmount ?? "0.00"),
    ]);
    reasonMap.set(key, cur);
  }

  const lostReasons = [...reasonMap.entries()]
    .map(([reason, v]) => ({
      reason,
      count: v.count,
      value: paiseToRupees(v.totalPaise),
      valueDecimal: paiseToDecimalString(v.totalPaise),
    }))
    .sort((a, b) => b.count - a.count);

  // E. Source Performance for Cohort
  const cohortLeadIds = cohortLeads.map((l) => l.id);
  const callLogs = cohortLeadIds.length
    ? await db
        .select({
          leadId: crmCallLogs.leadId,
          occurredAt: crmCallLogs.occurredAt,
        })
        .from(crmCallLogs)
        .where(
          and(
            eq(crmCallLogs.ownerUserId, ownerUserId),
            inArray(crmCallLogs.leadId, cohortLeadIds),
          ),
        )
    : [];

  const firstCallMap = new Map<string, Date>();
  for (const c of callLogs) {
    const dt = parseUtcDateTime(c.occurredAt);
    const prev = firstCallMap.get(c.leadId);
    if (!prev || dt < prev) {
      firstCallMap.set(c.leadId, dt);
    }
  }

  const sourceMap = new Map<string, typeof cohortLeads>();
  for (const l of cohortLeads) {
    const arr = sourceMap.get(l.source) ?? [];
    arr.push(l);
    sourceMap.set(l.source, arr);
  }

  const sourcePerformance = [...sourceMap.entries()]
    .map(([source, leadsList]) => {
      const sWon = leadsList.filter((l) => l.status === "won").length;
      const sQual = leadsList.filter((l) =>
        ["qualified", "proposal", "won"].includes(l.status),
      ).length;

      const hoursList = leadsList.flatMap((l) => {
        const fc = firstCallMap.get(l.id);
        if (!fc) return [];
        const diffH =
          (fc.getTime() - parseUtcDateTime(l.createdAt).getTime()) / 3_600_000;
        return [Math.max(0, Math.round(diffH * 10) / 10)];
      });

      return {
        source,
        leads: leadsList.length,
        qualified: sQual,
        won: sWon,
        winRate: rate(sWon, leadsList.length),
        medianFirstAttemptH: median(hoursList),
      };
    })
    .sort((a, b) => b.leads - a.leads || a.source.localeCompare(b.source));

  return {
    ok: true as const,
    window,
    currentDistribution,
    stageMoves,
    totalMovesRecorded: stageActivities.length,
    cohort: {
      size: cohortLeads.length,
      qualified: cohortQualified,
      won: cohortWon,
      lost: cohortLost,
      winRate: rate(cohortWon, cohortLeads.length),
      qualRate: rate(cohortQualified, cohortLeads.length),
      isDeveloping,
    },
    closedConversion: {
      won: allWon,
      lost: allLost,
      winRate: rate(allWon, allWon + allLost),
    },
    lostReasons,
    sourcePerformance,
  };
}

// ----------------------------------------------------------------------------
// 3. COMMUNICATIONS ANALYTICS (Calls, WhatsApp & Follow-ups)
// ----------------------------------------------------------------------------

export async function getCommunicationsAnalytics(
  db: CrmDatabase,
  ownerUserId: string,
  period: AnalyticsPeriod = "thisMonth",
  customFrom?: string | null,
  customTo?: string | null,
  now: Date = new Date(),
) {
  const window = resolveAnalyticsWindow(period, now, customFrom, customTo);
  const { startUtc, endUtc } = getIstUtcRange(window);
  const startUtcSql = toMysqlUtcDateTime(startUtc);
  const endUtcSql = toMysqlUtcDateTime(endUtc);

  // Calls in window
  const calls = await db
    .select({
      id: crmCallLogs.id,
      leadId: crmCallLogs.leadId,
      outcome: crmCallLogs.outcome,
      connected: crmCallLogs.connected,
      occurredAt: crmCallLogs.occurredAt,
    })
    .from(crmCallLogs)
    .where(
      and(
        eq(crmCallLogs.ownerUserId, ownerUserId),
        gte(crmCallLogs.occurredAt, startUtcSql),
        lte(crmCallLogs.occurredAt, endUtcSql),
      ),
    );

  const connectedCount = calls.filter((c) => c.connected).length;
  const noAnswerCount = calls.filter((c) => isNoAnswerCallOutcome(c.outcome)).length;
  const busyCount = calls.filter((c) => isBusyCallOutcome(c.outcome)).length;

  const outcomeCounts = new Map<string, number>();
  for (const c of calls) {
    outcomeCounts.set(c.outcome, (outcomeCounts.get(c.outcome) ?? 0) + 1);
  }
  const byOutcome = [...outcomeCounts.entries()]
    .map(([outcome, count]) => ({ outcome, count }))
    .sort((a, b) => b.count - a.count);

  // Median first attempt hours for cohort of leads created in window
  const cohortLeads = await db
    .select({
      id: crmLeads.id,
      createdAt: crmLeads.createdAt,
    })
    .from(crmLeads)
    .where(
      and(
        eq(crmLeads.ownerUserId, ownerUserId),
        eq(crmLeads.lifecycleStatus, "active"),
        gte(crmLeads.createdAt, startUtcSql),
        lte(crmLeads.createdAt, endUtcSql),
      ),
    );

  const cohortLeadIds = cohortLeads.map((l) => l.id);
  const allCohortCalls = cohortLeadIds.length
    ? await db
        .select({
          leadId: crmCallLogs.leadId,
          occurredAt: crmCallLogs.occurredAt,
        })
        .from(crmCallLogs)
        .where(
          and(
            eq(crmCallLogs.ownerUserId, ownerUserId),
            inArray(crmCallLogs.leadId, cohortLeadIds),
          ),
        )
    : [];

  const firstCallMap = new Map<string, Date>();
  for (const c of allCohortCalls) {
    const dt = parseUtcDateTime(c.occurredAt);
    const prev = firstCallMap.get(c.leadId);
    if (!prev || dt < prev) {
      firstCallMap.set(c.leadId, dt);
    }
  }

  const hoursList = cohortLeads.flatMap((l) => {
    const fc = firstCallMap.get(l.id);
    if (!fc) return [];
    const diffH =
      (fc.getTime() - parseUtcDateTime(l.createdAt).getTime()) / 3_600_000;
    return [Math.max(0, Math.round(diffH * 10) / 10)];
  });

  // WhatsApp in window (only owner_confirmed_sent count)
  const waLogs = await db
    .select({
      id: crmWhatsAppLogs.id,
      templateId: crmWhatsAppLogs.templateId,
      templateName: crmWhatsAppLogs.templateName,
      purpose: crmWhatsAppLogs.purpose,
      confirmationStatus: crmWhatsAppLogs.confirmationStatus,
    })
    .from(crmWhatsAppLogs)
    .where(
      and(
        eq(crmWhatsAppLogs.ownerUserId, ownerUserId),
        eq(crmWhatsAppLogs.confirmationStatus, "owner_confirmed_sent"),
        gte(crmWhatsAppLogs.confirmedAt, startUtcSql),
        lte(crmWhatsAppLogs.confirmedAt, endUtcSql),
      ),
    );

  const templateMap = new Map<
    string,
    { id: string | null; name: string | null; count: number }
  >();
  const purposeMap = new Map<string, number>();

  for (const w of waLogs) {
    const key = w.templateId ?? "direct";
    const curT = templateMap.get(key) ?? {
      id: w.templateId,
      name: w.templateName ?? "Direct Message",
      count: 0,
    };
    curT.count++;
    templateMap.set(key, curT);

    purposeMap.set(w.purpose, (purposeMap.get(w.purpose) ?? 0) + 1);
  }

  // Follow-ups
  const dueFollowUps = await db
    .select({
      id: crmFollowUps.id,
      completedAt: crmFollowUps.completedAt,
    })
    .from(crmFollowUps)
    .where(
      and(
        eq(crmFollowUps.ownerUserId, ownerUserId),
        isNull(crmFollowUps.cancelledAt),
        gte(crmFollowUps.dueIstDate, window.start),
        lte(crmFollowUps.dueIstDate, window.end),
      ),
    );

  const completedOfDue = dueFollowUps.filter((f) => f.completedAt).length;

  const completedInWindow = await db
    .select({ id: crmFollowUps.id })
    .from(crmFollowUps)
    .where(
      and(
        eq(crmFollowUps.ownerUserId, ownerUserId),
        gte(crmFollowUps.completedAt, startUtcSql),
        lte(crmFollowUps.completedAt, endUtcSql),
      ),
    );

  const overdueNow = await db
    .select({ id: crmFollowUps.id })
    .from(crmFollowUps)
    .where(
      and(
        eq(crmFollowUps.ownerUserId, ownerUserId),
        isNull(crmFollowUps.cancelledAt),
        isNull(crmFollowUps.completedAt),
        sql`${crmFollowUps.dueAt} < ${toMysqlUtcDateTime(now)}`,
      ),
    );

  const cancelledInWindow = await db
    .select({ id: crmFollowUps.id })
    .from(crmFollowUps)
    .where(
      and(
        eq(crmFollowUps.ownerUserId, ownerUserId),
        gte(crmFollowUps.cancelledAt, startUtcSql),
        lte(crmFollowUps.cancelledAt, endUtcSql),
      ),
    );

  return {
    ok: true as const,
    window,
    calls: {
      attempts: calls.length,
      connected: connectedCount,
      connectionRate: rate(connectedCount, calls.length),
      noAnswer: noAnswerCount,
      busy: busyCount,
      byOutcome,
      medianFirstAttemptHours: median(hoursList),
      cohortAttempted: hoursList.length,
      cohortSize: cohortLeads.length,
    },
    whatsapp: {
      confirmedSent: waLogs.length,
      byTemplate: [...templateMap.values()].map((t) => ({
        templateId: t.id,
        templateName: t.name,
        count: t.count,
      })),
      byPurpose: [...purposeMap.entries()].map(([purpose, count]) => ({
        purpose,
        count,
      })),
    },
    followUps: {
      scheduled: dueFollowUps.length,
      completed: completedInWindow.length,
      completionRate: rate(completedOfDue, dueFollowUps.length),
      overdueNow: overdueNow.length,
      cancelled: cancelledInWindow.length,
    },
  };
}

// ----------------------------------------------------------------------------
// 4. FINANCIAL ANALYTICS
// ----------------------------------------------------------------------------

export async function getFinanceAnalytics(
  db: CrmDatabase,
  ownerUserId: string,
  period: AnalyticsPeriod = "thisMonth",
  customFrom?: string | null,
  customTo?: string | null,
  now: Date = new Date(),
) {
  const window = resolveAnalyticsWindow(period, now, customFrom, customTo);
  const todayIstDate = getIstDay(now);

  const allDeals = await db
    .select({
      id: crmDeals.id,
      name: crmDeals.name,
      quotedAmount: crmDeals.quotedAmount,
      finalAmount: crmDeals.finalAmount,
      status: crmDeals.status,
      dueDate: crmDeals.dueDate,
      wonIstDate: crmDeals.wonIstDate,
    })
    .from(crmDeals)
    .where(eq(crmDeals.ownerUserId, ownerUserId));

  const allPayments = await db
    .select({
      id: crmPayments.id,
      dealId: crmPayments.dealId,
      amount: crmPayments.amount,
      method: crmPayments.method,
      paymentIstDate: crmPayments.paymentIstDate,
      voided: crmPayments.voided,
    })
    .from(crmPayments)
    .where(eq(crmPayments.ownerUserId, ownerUserId));

  const nonCancelledDeals = allDeals.filter((d) => d.status !== "cancelled");
  const cancelledDeals = allDeals.filter((d) => d.status === "cancelled");
  const cancelledDealIds = new Set(cancelledDeals.map((d) => d.id));

  // Won deals in window
  const wonInWindow = nonCancelledDeals.filter((d) =>
    isDayInWindow(d.wonIstDate, window),
  );
  const wonDealValuePaise = sumPaise(
    wonInWindow.map((d) => decimalStringToPaise(d.finalAmount)),
  );

  // Unknown won dates
  const unknownWonDeals = nonCancelledDeals.filter((d) => !d.wonIstDate);
  const unknownWonValuePaise = sumPaise(
    unknownWonDeals.map((d) => decimalStringToPaise(d.finalAmount)),
  );

  // Valid payments in window on non-cancelled deals
  const validPaymentsInWindow = allPayments.filter(
    (p) =>
      !p.voided &&
      !cancelledDealIds.has(p.dealId) &&
      isDayInWindow(p.paymentIstDate, window),
  );
  const receivedCashPaise = sumPaise(
    validPaymentsInWindow.map((p) => decimalStringToPaise(p.amount)),
  );

  // Balance snapshot as of today across all non-cancelled deals
  const dealSummaries = nonCancelledDeals.map((d) => {
    const dPayments = allPayments.filter((p) => p.dealId === d.id);
    return calculateDealFinancialSummary(
      {
        id: d.id,
        quotedAmount: d.quotedAmount,
        finalAmount: d.finalAmount,
        status: d.status as any,
        dueDate: d.dueDate,
        wonIstDate: d.wonIstDate,
      },
      dPayments.map((p) => ({
        id: p.id,
        dealId: p.dealId,
        amount: p.amount,
        paymentIstDate: p.paymentIstDate,
        voided: p.voided,
      })),
      [],
      todayIstDate,
    );
  });

  const totalOutstandingPaise = sumPaise(
    dealSummaries.map((s) => s.outstandingPaise),
  );
  const totalOverduePaise = sumPaise(dealSummaries.map((s) => s.overduePaise));
  const totalBookedPaise = sumPaise(
    dealSummaries.map((s) => s.finalAmountPaise),
  );
  const totalCollectedAllTimePaise = sumPaise(
    dealSummaries.map((s) => s.collectedPaise),
  );

  const collectionRate = rate(totalCollectedAllTimePaise, totalBookedPaise);

  let fullyPaidCount = 0;
  let partialCount = 0;
  let awaitingCount = 0;
  let overdueCount = 0;
  let noTermsCount = 0;

  for (const s of dealSummaries) {
    if (s.finalAmountPaise > 0 && s.collectedPaise >= s.finalAmountPaise) {
      fullyPaidCount++;
    } else if (s.collectedPaise > 0) {
      partialCount++;
    } else {
      awaitingCount++;
    }

    if (s.isOverdue) overdueCount++;
    if (s.outstandingPaise > 0 && !s.dueDate) noTermsCount++;
  }

  // Voided payments
  const voidedPayments = allPayments.filter((p) => p.voided);
  const voidedPaise = sumPaise(
    voidedPayments.map((p) => decimalStringToPaise(p.amount)),
  );

  // Cancelled deals historical collections
  const cancelledPayments = allPayments.filter(
    (p) => !p.voided && cancelledDealIds.has(p.dealId),
  );
  const cancelledHistoricalCashPaise = sumPaise(
    cancelledPayments.map((p) => decimalStringToPaise(p.amount)),
  );

  // Monthly breakdown for window
  const monthBuckets = buckets(window, "month");
  const byMonthMap = new Map(
    monthBuckets.map((m) => [m, { wonPaise: 0, receivedPaise: 0 }]),
  );

  for (const d of nonCancelledDeals) {
    if (d.wonIstDate && isDayInWindow(d.wonIstDate, window)) {
      const m = d.wonIstDate.slice(0, 7);
      const cur = byMonthMap.get(m);
      if (cur) {
        cur.wonPaise = sumPaise([
          cur.wonPaise,
          decimalStringToPaise(d.finalAmount),
        ]);
      }
    }
  }

  for (const p of validPaymentsInWindow) {
    const m = p.paymentIstDate.slice(0, 7);
    const cur = byMonthMap.get(m);
    if (cur) {
      cur.receivedPaise = sumPaise([
        cur.receivedPaise,
        decimalStringToPaise(p.amount),
      ]);
    }
  }

  const byMonth = [...byMonthMap.entries()].map(([month, val]) => ({
    month,
    wonValue: paiseToRupees(val.wonPaise),
    wonValueDecimal: paiseToDecimalString(val.wonPaise),
    receivedCash: paiseToRupees(val.receivedPaise),
    receivedCashDecimal: paiseToDecimalString(val.receivedPaise),
  }));

  // By Payment Method
  const methodMap = new Map<string, { paise: number; count: number }>();
  for (const p of validPaymentsInWindow) {
    const cur = methodMap.get(p.method) ?? { paise: 0, count: 0 };
    cur.paise = sumPaise([cur.paise, decimalStringToPaise(p.amount)]);
    cur.count++;
    methodMap.set(p.method, cur);
  }

  const byPaymentMethod = [...methodMap.entries()]
    .map(([method, v]) => ({
      method,
      amount: paiseToRupees(v.paise),
      amountDecimal: paiseToDecimalString(v.paise),
      count: v.count,
    }))
    .sort((a, b) => b.amount - a.amount);

  return {
    ok: true as const,
    window,
    todayIstDate,
    kpis: {
      wonDealValue: paiseToRupees(wonDealValuePaise),
      wonDealValueDecimal: paiseToDecimalString(wonDealValuePaise),
      wonDealCount: wonInWindow.length,
      receivedCash: paiseToRupees(receivedCashPaise),
      receivedCashDecimal: paiseToDecimalString(receivedCashPaise),
      paymentCount: validPaymentsInWindow.length,
      outstanding: paiseToRupees(totalOutstandingPaise),
      outstandingDecimal: paiseToDecimalString(totalOutstandingPaise),
      overdue: paiseToRupees(totalOverduePaise),
      overdueDecimal: paiseToDecimalString(totalOverduePaise),
      collectionRate,
      unknownWonCount: unknownWonDeals.length,
      unknownWonValue: paiseToRupees(unknownWonValuePaise),
      unknownWonValueDecimal: paiseToDecimalString(unknownWonValuePaise),
    },
    dealsBreakdown: {
      fullyPaidCount,
      partialCount,
      awaitingCount,
      overdueCount,
      noTermsCount,
    },
    voided: {
      count: voidedPayments.length,
      amount: paiseToRupees(voidedPaise),
      amountDecimal: paiseToDecimalString(voidedPaise),
    },
    cancelledDeals: {
      count: cancelledDeals.length,
      historicalCollectedCash: paiseToRupees(cancelledHistoricalCashPaise),
      historicalCollectedCashDecimal: paiseToDecimalString(
        cancelledHistoricalCashPaise,
      ),
    },
    byMonth,
    byPaymentMethod,
  };
}

// ----------------------------------------------------------------------------
// 5. QUOTATIONS ANALYTICS
// ----------------------------------------------------------------------------

export async function getQuotationsAnalytics(
  db: CrmDatabase,
  ownerUserId: string,
  period: AnalyticsPeriod = "thisMonth",
  customFrom?: string | null,
  customTo?: string | null,
  now: Date = new Date(),
) {
  const window = resolveAnalyticsWindow(period, now, customFrom, customTo);

  const quotes = await db
    .select({
      id: crmQuotations.id,
      status: crmQuotations.status,
      totalAmount: crmQuotations.totalAmount,
      issueIstDate: crmQuotations.issueIstDate,
      sentAt: crmQuotations.sentAt,
      acceptedAt: crmQuotations.acceptedAt,
      rejectedAt: crmQuotations.rejectedAt,
    })
    .from(crmQuotations)
    .where(
      and(
        eq(crmQuotations.ownerUserId, ownerUserId),
        gte(crmQuotations.issueIstDate, window.start),
        lte(crmQuotations.issueIstDate, window.end),
      ),
    );

  let draft = 0;
  let sent = 0;
  let accepted = 0;
  let rejected = 0;
  let expired = 0;

  let totalPaise = 0;
  let sentPaise = 0;
  let acceptedPaise = 0;
  let rejectedPaise = 0;

  const monthMap = new Map<
    string,
    { created: number; sent: number; accepted: number; acceptedPaise: number }
  >();

  for (const q of quotes) {
    const p = decimalStringToPaise(q.totalAmount);
    totalPaise = sumPaise([totalPaise, p]);

    const m = q.issueIstDate.slice(0, 7);
    const curM = monthMap.get(m) ?? {
      created: 0,
      sent: 0,
      accepted: 0,
      acceptedPaise: 0,
    };
    curM.created++;

    if (q.status === "draft") {
      draft++;
    } else if (q.status === "sent") {
      sent++;
      sentPaise = sumPaise([sentPaise, p]);
      curM.sent++;
    } else if (q.status === "accepted") {
      accepted++;
      acceptedPaise = sumPaise([acceptedPaise, p]);
      curM.accepted++;
      curM.acceptedPaise = sumPaise([curM.acceptedPaise, p]);
    } else if (q.status === "rejected") {
      rejected++;
      rejectedPaise = sumPaise([rejectedPaise, p]);
    } else if (q.status === "expired") {
      expired++;
    }
    monthMap.set(m, curM);
  }

  const byMonth = [...monthMap.entries()].map(([month, val]) => ({
    month,
    createdCount: val.created,
    sentCount: val.sent,
    acceptedCount: val.accepted,
    acceptedValue: paiseToRupees(val.acceptedPaise),
    acceptedValueDecimal: paiseToDecimalString(val.acceptedPaise),
  }));

  const totalSentOrClosed = sent + accepted + rejected;

  return {
    ok: true as const,
    window,
    counts: {
      draft,
      sent,
      accepted,
      rejected,
      expired,
      total: quotes.length,
    },
    values: {
      totalQuoted: paiseToRupees(totalPaise),
      totalQuotedDecimal: paiseToDecimalString(totalPaise),
      sentQuoted: paiseToRupees(sentPaise),
      sentQuotedDecimal: paiseToDecimalString(sentPaise),
      acceptedQuoted: paiseToRupees(acceptedPaise),
      acceptedQuotedDecimal: paiseToDecimalString(acceptedPaise),
      rejectedQuoted: paiseToRupees(rejectedPaise),
      rejectedQuotedDecimal: paiseToDecimalString(rejectedPaise),
    },
    conversion: {
      rateAcceptedOfSent: rate(accepted, totalSentOrClosed),
      rateAcceptedOfTotal: rate(accepted, quotes.length),
    },
    byMonth,
  };
}

// ----------------------------------------------------------------------------
// 6. PROJECTS ANALYTICS
// ----------------------------------------------------------------------------

export async function getProjectsAnalytics(
  db: CrmDatabase,
  ownerUserId: string,
  period: AnalyticsPeriod = "thisMonth",
  customFrom?: string | null,
  customTo?: string | null,
  now: Date = new Date(),
) {
  const window = resolveAnalyticsWindow(period, now, customFrom, customTo);
  const { startUtc, endUtc } = getIstUtcRange(window);
  const todayIstDate = getIstDay(now);

  const projects = await db
    .select({
      id: crmProjects.id,
      name: crmProjects.name,
      dealId: crmProjects.dealId,
      type: crmProjects.type,
      status: crmProjects.status,
      stage: crmProjects.stage,
      actualStart: crmProjects.actualStart,
      targetDelivery: crmProjects.targetDelivery,
      deliveryJson: crmProjects.deliveryJson,
      supportJson: crmProjects.supportJson,
      dependenciesJson: crmProjects.dependenciesJson,
      archived: crmProjects.archived,
      createdAt: crmProjects.createdAt,
    })
    .from(crmProjects)
    .where(eq(crmProjects.ownerUserId, ownerUserId));

  const nonArchived = projects.filter((p) => !p.archived);
  const createdInWindow = nonArchived.filter((p) => {
    const dt = parseUtcDateTime(p.createdAt);
    return dt >= startUtc && dt <= endUtc;
  });

  const active = nonArchived.filter((p) =>
    isActiveProject({ archived: p.archived, status: p.status, stage: p.stage }),
  );
  const inProgress = nonArchived.filter((p) => p.status === "in_progress");
  const awaitingClient = nonArchived.filter(
    (p) => p.status === "awaiting_client" || p.stage === "awaiting_content",
  );
  const completed = nonArchived.filter((p) => p.status === "completed");
  const delivered = nonArchived.filter(
    (p) => p.stage === "delivered" || Boolean(p.deliveryJson),
  );
  const overdue = nonArchived.filter((p) =>
    isProjectOverdue(
      {
        archived: p.archived,
        status: p.status,
        stage: p.stage,
        targetDelivery: p.targetDelivery,
      },
      todayIstDate,
    ),
  );

  const typeMap = new Map<string, number>();
  const stageMap = new Map<string, number>();
  for (const p of nonArchived) {
    const t = p.type || "Unspecified";
    typeMap.set(t, (typeMap.get(t) ?? 0) + 1);
    stageMap.set(p.stage, (stageMap.get(p.stage) ?? 0) + 1);
  }

  const nonArchivedIds = nonArchived.map((p) => p.id);
  const tasks = nonArchivedIds.length
    ? await db
        .select({
          id: crmProjectTasks.id,
          status: crmProjectTasks.status,
          dueDate: crmProjectTasks.dueDate,
        })
        .from(crmProjectTasks)
        .where(
          and(
            eq(crmProjectTasks.ownerUserId, ownerUserId),
            inArray(crmProjectTasks.projectId, nonArchivedIds),
          ),
        )
    : [];

  const tasksDone = tasks.filter((t) => t.status === "done").length;
  const tasksOverdue = tasks.filter((t) =>
    taskOverdue({ status: t.status, dueDate: t.dueDate }, todayIstDate),
  ).length;

  let openClientDependencies = 0;
  let projectsWaitingOnClient = 0;
  for (const p of active) {
    try {
      const deps: CheckItem[] = p.dependenciesJson
        ? JSON.parse(p.dependenciesJson)
        : [];
      const openDeps = deps.filter((d) => !d.done);
      if (openDeps.length > 0) {
        openClientDependencies += openDeps.length;
        projectsWaitingOnClient++;
      }
    } catch {
      // ignore parse err
    }
  }

  const supportTickets = nonArchivedIds.length
    ? await db
        .select({
          id: crmClientSupportTickets.id,
          status: crmClientSupportTickets.status,
        })
        .from(crmClientSupportTickets)
        .where(
          and(
            eq(crmClientSupportTickets.ownerUserId, ownerUserId),
            inArray(crmClientSupportTickets.projectId, nonArchivedIds),
          ),
        )
    : [];

  const openTickets = supportTickets.filter((t) => t.status === "open").length;
  const inProgressTickets = supportTickets.filter(
    (t) => t.status === "in_progress",
  ).length;
  const resolvedTickets = supportTickets.filter(
    (t) => t.status === "resolved",
  ).length;
  const closedTickets = supportTickets.filter(
    (t) => t.status === "closed",
  ).length;

  const soonIst = shiftDay(todayIstDate, 30);
  let activeSupportAgreements = 0;
  let supportEndingSoon = 0;

  for (const p of nonArchived) {
    try {
      const supp: ProjectSupport | null = p.supportJson
        ? JSON.parse(p.supportJson)
        : null;
      const status = supportStatus(supp, todayIstDate);
      if (status === "active") {
        activeSupportAgreements++;
        if (supp?.end && supp.end <= soonIst) {
          supportEndingSoon++;
        }
      }
    } catch {
      // ignore
    }
  }

  const deliveryDurations: number[] = [];
  for (const p of nonArchived) {
    if (!p.actualStart || !p.deliveryJson) continue;
    try {
      const del: ProjectDelivery = JSON.parse(p.deliveryJson);
      if (del.date) {
        const startMs = Date.parse(`${p.actualStart}T00:00:00Z`);
        const delMs = Date.parse(`${del.date}T00:00:00Z`);
        const days = Math.round((delMs - startMs) / 86_400_000);
        deliveryDurations.push(Math.max(0, days));
      }
    } catch {
      // ignore
    }
  }

  const avgDeliveryDays = deliveryDurations.length
    ? Math.round(
        deliveryDurations.reduce((a, b) => a + b, 0) / deliveryDurations.length,
      )
    : null;

  const deliveredWithDeals = nonArchived.filter(
    (p) => p.dealId && Boolean(p.deliveryJson),
  );
  let deliveredUnpaidCount = 0;

  if (deliveredWithDeals.length > 0) {
    const dealIds = deliveredWithDeals.map((p) => p.dealId!);
    const dRows = await db
      .select({
        id: crmDeals.id,
        finalAmount: crmDeals.finalAmount,
      })
      .from(crmDeals)
      .where(
        and(eq(crmDeals.ownerUserId, ownerUserId), inArray(crmDeals.id, dealIds)),
      );

    const pRows = await db
      .select({
        dealId: crmPayments.dealId,
        amount: crmPayments.amount,
        voided: crmPayments.voided,
      })
      .from(crmPayments)
      .where(
        and(
          eq(crmPayments.ownerUserId, ownerUserId),
          inArray(crmPayments.dealId, dealIds),
        ),
      );

    for (const p of deliveredWithDeals) {
      const deal = dRows.find((d) => d.id === p.dealId);
      if (!deal) continue;
      const finalP = decimalStringToPaise(deal.finalAmount);
      const paidP = sumPaise(
        pRows
          .filter((x) => x.dealId === deal.id && !x.voided)
          .map((x) => decimalStringToPaise(x.amount)),
      );
      if (finalP > paidP) {
        deliveredUnpaidCount++;
      }
    }
  }

  return {
    ok: true as const,
    window,
    todayIstDate,
    projectCounts: {
      created: createdInWindow.length,
      active: active.length,
      inProgress: inProgress.length,
      awaitingClient: awaitingClient.length,
      completed: completed.length,
      delivered: delivered.length,
      overdue: overdue.length,
    },
    byType: [...typeMap.entries()].map(([type, count]) => ({ type, count })),
    byStage: [...stageMap.entries()].map(([stage, count]) => ({
      stage,
      count,
    })),
    tasks: {
      total: tasks.length,
      done: tasksDone,
      completionRate: rate(tasksDone, tasks.length),
      overdue: tasksOverdue,
    },
    dependencies: {
      openClientDependencies,
      projectsWaitingOnClient,
    },
    support: {
      openTickets,
      inProgressTickets,
      resolvedTickets,
      closedTickets,
      activeSupportAgreements,
      supportEndingSoon,
    },
    deliveryPerformance: {
      avgDeliveryDays,
      deliveryMeasuredCount: deliveryDurations.length,
      deliveredUnpaidCount,
    },
  };
}

// ----------------------------------------------------------------------------
// 7. OWNER PERFORMANCE & ATTRIBUTION
// ----------------------------------------------------------------------------

export async function getPerformanceAnalytics(
  db: CrmDatabase,
  ownerUserId: string,
  period: AnalyticsPeriod = "thisWeek",
  customFrom?: string | null,
  customTo?: string | null,
  now: Date = new Date(),
) {
  const window = resolveAnalyticsWindow(period, now, customFrom, customTo);
  const { startUtc, endUtc } = getIstUtcRange(window);
  const startUtcSql = toMysqlUtcDateTime(startUtc);
  const endUtcSql = toMysqlUtcDateTime(endUtc);
  const todayIstDate = getIstDay(now);

  // Calls by owner in window
  const calls = await db
    .select({
      id: crmCallLogs.id,
      connected: crmCallLogs.connected,
      actorUserId: crmCallLogs.actorUserId,
    })
    .from(crmCallLogs)
    .where(
      and(
        eq(crmCallLogs.ownerUserId, ownerUserId),
        eq(crmCallLogs.actorUserId, ownerUserId),
        gte(crmCallLogs.occurredAt, startUtcSql),
        lte(crmCallLogs.occurredAt, endUtcSql),
      ),
    );

  const callsAttempted = calls.length;
  const callsConnected = calls.filter((c) => c.connected).length;
  const connectionRate = rate(callsConnected, callsAttempted);

  // Follow-ups completed by owner in window
  const completedFollowUps = await db
    .select({ id: crmFollowUps.id })
    .from(crmFollowUps)
    .where(
      and(
        eq(crmFollowUps.ownerUserId, ownerUserId),
        eq(crmFollowUps.updatedByUserId, ownerUserId),
        gte(crmFollowUps.completedAt, startUtcSql),
        lte(crmFollowUps.completedAt, endUtcSql),
      ),
    );

  // Follow-ups due in window
  const dueFollowUps = await db
    .select({
      id: crmFollowUps.id,
      completedAt: crmFollowUps.completedAt,
    })
    .from(crmFollowUps)
    .where(
      and(
        eq(crmFollowUps.ownerUserId, ownerUserId),
        isNull(crmFollowUps.cancelledAt),
        gte(crmFollowUps.dueIstDate, window.start),
        lte(crmFollowUps.dueIstDate, window.end),
      ),
    );

  const followUpsDue = dueFollowUps.length;
  const followUpsDone = dueFollowUps.filter((f) => f.completedAt).length;
  const followUpRate = rate(followUpsDone, followUpsDue);

  // Follow-ups overdue now
  const overdueNow = await db
    .select({ id: crmFollowUps.id })
    .from(crmFollowUps)
    .where(
      and(
        eq(crmFollowUps.ownerUserId, ownerUserId),
        isNull(crmFollowUps.cancelledAt),
        isNull(crmFollowUps.completedAt),
        sql`${crmFollowUps.dueAt} < ${toMysqlUtcDateTime(now)}`,
      ),
    );

  // Leads created by owner in window
  const createdLeads = await db
    .select({
      id: crmLeads.id,
      status: crmLeads.status,
    })
    .from(crmLeads)
    .where(
      and(
        eq(crmLeads.ownerUserId, ownerUserId),
        eq(crmLeads.createdByUserId, ownerUserId),
        eq(crmLeads.lifecycleStatus, "active"),
        gte(crmLeads.createdAt, startUtcSql),
        lte(crmLeads.createdAt, endUtcSql),
      ),
    );

  const leadsCreated = createdLeads.length;
  const cohortWon = createdLeads.filter((l) => l.status === "won").length;
  const cohortWinRate = rate(cohortWon, leadsCreated);

  // Leads qualified in window by owner
  const qualifiedActivities = await db
    .select({ id: crmLeadActivities.id })
    .from(crmLeadActivities)
    .where(
      and(
        eq(crmLeadActivities.ownerUserId, ownerUserId),
        eq(crmLeadActivities.actorUserId, ownerUserId),
        eq(crmLeadActivities.type, "status"),
        sql`${crmLeadActivities.text} LIKE 'Status changed to qualified%'`,
        gte(crmLeadActivities.occurredAt, startUtcSql),
        lte(crmLeadActivities.occurredAt, endUtcSql),
      ),
    );

  // Quotations confirmed sent by owner in window
  const sentQuotes = await db
    .select({ id: crmQuotations.id })
    .from(crmQuotations)
    .where(
      and(
        eq(crmQuotations.ownerUserId, ownerUserId),
        eq(crmQuotations.userConfirmedSent, true),
        gte(crmQuotations.sentAt, startUtcSql),
        lte(crmQuotations.sentAt, endUtcSql),
      ),
    );

  // Deals won in window (exclude cancelled deals consistently with Finance & Trends analytics)
  const wonDealsRaw = await db
    .select({
      id: crmDeals.id,
      status: crmDeals.status,
      finalAmount: crmDeals.finalAmount,
      wonIstDate: crmDeals.wonIstDate,
    })
    .from(crmDeals)
    .where(
      and(
        eq(crmDeals.ownerUserId, ownerUserId),
        sql`${crmDeals.status} != 'cancelled'`,
        gte(crmDeals.wonIstDate, window.start),
        lte(crmDeals.wonIstDate, window.end),
      ),
    );
  const wonDeals = wonDealsRaw.filter((d) => isCountedWonDealStatus(d.status));

  const wonDealValuePaise = sumPaise(
    wonDeals.map((d) => decimalStringToPaise(d.finalAmount)),
  );

  // Unknown won dates count
  const unknownWonDeals = (
    await db
      .select({ id: crmDeals.id, status: crmDeals.status })
      .from(crmDeals)
      .where(
        and(
          eq(crmDeals.ownerUserId, ownerUserId),
          sql`${crmDeals.status} != 'cancelled'`,
          isNull(crmDeals.wonIstDate),
        ),
      )
  ).filter((d) => isCountedWonDealStatus(d.status));

  // Unattributed events in window (events performed by someone else or automation)
  const otherActivities = await db
    .select({ id: crmLeadActivities.id })
    .from(crmLeadActivities)
    .where(
      and(
        eq(crmLeadActivities.ownerUserId, ownerUserId),
        sql`${crmLeadActivities.actorUserId} != ${ownerUserId}`,
        gte(crmLeadActivities.occurredAt, startUtcSql),
        lte(crmLeadActivities.occurredAt, endUtcSql),
      ),
    );

  return {
    ok: true as const,
    window,
    todayIstDate,
    ownerSummary: {
      callsAttempted,
      callsConnected,
      connectionRate,
      followUpsCompleted: completedFollowUps.length,
      followUpsDue,
      followUpRate,
      followUpsOverdueNow: overdueNow.length,
      leadsCreated,
      leadsQualified: qualifiedActivities.length,
      quotationsConfirmedSent: sentQuotes.length,
      dealsWon: wonDeals.length,
      wonDealValue: paiseToRupees(wonDealValuePaise),
      wonDealValueDecimal: paiseToDecimalString(wonDealValuePaise),
      unknownWonDatesCount: unknownWonDeals.length,
      cohortSize: leadsCreated,
      cohortWon,
      cohortWinRate,
      unattributedEventsCount: otherActivities.length,
    },
    goals: {
      status: "not_configured" as const,
      note: "Goals are currently stored in browser-local preferences. Server-backed goal persistence will be added in a future checkpoint. Default targets are never fabricated.",
      items: [],
    },
  };
}

// ----------------------------------------------------------------------------
// 8. TRENDS ANALYTICS (Time-series)
// ----------------------------------------------------------------------------

export async function getTrendsAnalytics(
  db: CrmDatabase,
  ownerUserId: string,
  period: AnalyticsPeriod = "30d",
  granularity?: Granularity | null,
  customFrom?: string | null,
  customTo?: string | null,
  now: Date = new Date(),
) {
  const window = resolveAnalyticsWindow(period, now, customFrom, customTo);
  const { startUtc, endUtc } = getIstUtcRange(window);
  const startUtcSql = toMysqlUtcDateTime(startUtc);
  const endUtcSql = toMysqlUtcDateTime(endUtc);
  const gran = granularity ?? defaultGranularity(window);
  const bucketList = buckets(window, gran);

  interface BucketData {
    bucket: string;
    leadsReceived: number;
    leadsQualified: number;
    leadsWon: number;
    callsAttempted: number;
    callsConnected: number;
    followUpsCompleted: number;
    paymentsCollectedPaise: number;
    wonDealValuePaise: number;
  }

  const map = new Map<string, BucketData>(
    bucketList.map((b) => [
      b,
      {
        bucket: b,
        leadsReceived: 0,
        leadsQualified: 0,
        leadsWon: 0,
        callsAttempted: 0,
        callsConnected: 0,
        followUpsCompleted: 0,
        paymentsCollectedPaise: 0,
        wonDealValuePaise: 0,
      },
    ]),
  );

  // A. Leads received
  const leads = await db
    .select({
      id: crmLeads.id,
      createdAt: crmLeads.createdAt,
    })
    .from(crmLeads)
    .where(
      and(
        eq(crmLeads.ownerUserId, ownerUserId),
        eq(crmLeads.lifecycleStatus, "active"),
        gte(crmLeads.createdAt, startUtcSql),
        lte(crmLeads.createdAt, endUtcSql),
      ),
    );

  for (const l of leads) {
    const day = getIstDay(parseUtcDateTime(l.createdAt));
    const b = bucketOf(day, gran);
    const item = map.get(b);
    if (item) item.leadsReceived++;
  }

  // B. Stage changes to qualified or won
  const moves = await db
    .select({
      text: crmLeadActivities.text,
      occurredAt: crmLeadActivities.occurredAt,
    })
    .from(crmLeadActivities)
    .where(
      and(
        eq(crmLeadActivities.ownerUserId, ownerUserId),
        eq(crmLeadActivities.type, "status"),
        gte(crmLeadActivities.occurredAt, startUtcSql),
        lte(crmLeadActivities.occurredAt, endUtcSql),
      ),
    );

  const STATUS_RE = /^Status changed to (\w+)/;
  for (const m of moves) {
    const match = STATUS_RE.exec(m.text);
    const to = match?.[1];
    if (to === "qualified" || to === "won") {
      const day = getIstDay(parseUtcDateTime(m.occurredAt));
      const b = bucketOf(day, gran);
      const item = map.get(b);
      if (item) {
        if (to === "qualified") item.leadsQualified++;
        if (to === "won") item.leadsWon++;
      }
    }
  }

  // C. Calls
  const calls = await db
    .select({
      connected: crmCallLogs.connected,
      occurredAt: crmCallLogs.occurredAt,
    })
    .from(crmCallLogs)
    .where(
      and(
        eq(crmCallLogs.ownerUserId, ownerUserId),
        gte(crmCallLogs.occurredAt, startUtcSql),
        lte(crmCallLogs.occurredAt, endUtcSql),
      ),
    );

  for (const c of calls) {
    const day = getIstDay(parseUtcDateTime(c.occurredAt));
    const b = bucketOf(day, gran);
    const item = map.get(b);
    if (item) {
      item.callsAttempted++;
      if (c.connected) item.callsConnected++;
    }
  }

  // D. Follow-ups completed
  const fus = await db
    .select({
      completedAt: crmFollowUps.completedAt,
    })
    .from(crmFollowUps)
    .where(
      and(
        eq(crmFollowUps.ownerUserId, ownerUserId),
        gte(crmFollowUps.completedAt, startUtcSql),
        lte(crmFollowUps.completedAt, endUtcSql),
      ),
    );

  for (const f of fus) {
    if (f.completedAt) {
      const day = getIstDay(parseUtcDateTime(f.completedAt));
      const b = bucketOf(day, gran);
      const item = map.get(b);
      if (item) item.followUpsCompleted++;
    }
  }

  // E. Payments collected (non-voided, non-cancelled)
  const pays = await db
    .select({
      amount: crmPayments.amount,
      paymentIstDate: crmPayments.paymentIstDate,
      dealId: crmPayments.dealId,
    })
    .from(crmPayments)
    .innerJoin(crmDeals, eq(crmPayments.dealId, crmDeals.id))
    .where(
      and(
        eq(crmPayments.ownerUserId, ownerUserId),
        eq(crmPayments.voided, false),
        sql`${crmDeals.status} != 'cancelled'`,
        gte(crmPayments.paymentIstDate, window.start),
        lte(crmPayments.paymentIstDate, window.end),
      ),
    );

  for (const p of pays) {
    const b = bucketOf(p.paymentIstDate, gran);
    const item = map.get(b);
    if (item) {
      item.paymentsCollectedPaise = sumPaise([
        item.paymentsCollectedPaise,
        decimalStringToPaise(p.amount),
      ]);
    }
  }

  // F. Won deals
  const deals = await db
    .select({
      finalAmount: crmDeals.finalAmount,
      wonIstDate: crmDeals.wonIstDate,
    })
    .from(crmDeals)
    .where(
      and(
        eq(crmDeals.ownerUserId, ownerUserId),
        sql`${crmDeals.status} != 'cancelled'`,
        gte(crmDeals.wonIstDate, window.start),
        lte(crmDeals.wonIstDate, window.end),
      ),
    );

  for (const d of deals) {
    if (d.wonIstDate) {
      const b = bucketOf(d.wonIstDate, gran);
      const item = map.get(b);
      if (item) {
        item.wonDealValuePaise = sumPaise([
          item.wonDealValuePaise,
          decimalStringToPaise(d.finalAmount),
        ]);
      }
    }
  }

  const series = [...map.values()].map((item) => ({
    bucket: item.bucket,
    leadsReceived: item.leadsReceived,
    leadsQualified: item.leadsQualified,
    leadsWon: item.leadsWon,
    callsAttempted: item.callsAttempted,
    callsConnected: item.callsConnected,
    followUpsCompleted: item.followUpsCompleted,
    paymentsCollected: paiseToRupees(item.paymentsCollectedPaise),
    paymentsCollectedDecimal: paiseToDecimalString(item.paymentsCollectedPaise),
    wonDealValue: paiseToRupees(item.wonDealValuePaise),
    wonDealValueDecimal: paiseToDecimalString(item.wonDealValuePaise),
  }));

  return {
    ok: true as const,
    window,
    granularity: gran,
    series,
  };
}
