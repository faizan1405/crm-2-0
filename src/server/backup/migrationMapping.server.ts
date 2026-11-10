import "@tanstack/react-start/server-only";
import { toMysqlUtcDateTime } from "../db/utc.server";

export interface LegacyLeadRecord {
  id: string;
  name: string;
  company?: string;
  phone?: string;
  email?: string;
  status: string;
  source?: string;
  priority?: "low" | "med" | "high";
  notes?: string;
  lostReason?: string;
  pinned?: boolean;
  score?: number;
  tags?: string[];
  lastContact?: string;
  nextFollowUp?: string;
  createdAt: string;
  updatedAt?: string;
}

export interface LegacyDealRecord {
  id: string;
  leadId: string;
  name: string;
  clientName?: string;
  company?: string;
  value?: number | string;
  valuePaise?: number;
  stage?: string;
  status: string;
  lostReason?: string;
  expectedCloseDate?: string;
  wonAt?: string;
  createdAt: string;
  updatedAt?: string;
}

export interface LegacyPaymentRecord {
  id: string;
  dealId: string;
  amount: number | string;
  amountPaise?: number;
  method?: string;
  reference?: string;
  notes?: string;
  recordedAt?: string;
  date?: string;
  voided?: boolean;
  voidReason?: string;
  voidedAt?: string;
  createdAt?: string;
}

export interface LegacyProjectRecord {
  id: string;
  name: string;
  leadId?: string;
  dealId?: string;
  clientName?: string;
  status: string;
  stage?: string;
  startDate?: string;
  dueDate?: string;
  targetDate?: string;
  createdAt: string;
  updatedAt?: string;
}

export interface LegacySalesGoalRecord {
  id: string;
  name: string;
  metric: string;
  period: string;
  target?: number | string;
  targetPaise?: number;
  startDate?: string;
  endDate?: string;
  effectiveFrom?: string;
  status?: string;
  version?: number;
  createdAt?: string;
  updatedAt?: string;
}

/**
 * Maps legacy browser-local entity records to canonical MariaDB row payloads.
 */
export class MigrationMapper {
  private readonly ownerUserId: string;
  private readonly idMap = new Map<string, string>();

  constructor(ownerUserId: string) {
    this.ownerUserId = ownerUserId;
  }

  /**
   * Generates or retrieves a deterministic mapped ID for a legacy ID.
   */
  mapId(legacyId: string, prefix = "crm"): string {
    if (!this.idMap.has(legacyId)) {
      // If legacy ID already conforms to pattern, preserve it; otherwise sanitize
      const sanitized = legacyId.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 32);
      const mapped = sanitized.startsWith(`${prefix}_`) ? sanitized : `${prefix}_${sanitized}`;
      this.idMap.set(legacyId, mapped);
    }
    return this.idMap.get(legacyId)!;
  }

  /**
   * Converts a numeric/string INR currency amount into exact integer paise.
   */
  toPaise(val: number | string | undefined | null): number {
    if (val === undefined || val === null || val === "") return 0;
    const num = typeof val === "number" ? val : parseFloat(String(val).replace(/,/g, ""));
    if (Number.isNaN(num)) return 0;
    return Math.round(num * 100);
  }

  /**
   * Formats an ISO datetime string into MySQL UTC datetime or null.
   */
  toMysqlUtc(isoDateStr?: string | null): string | null {
    if (!isoDateStr) return null;
    try {
      const dt = new Date(isoDateStr);
      if (Number.isNaN(dt.getTime())) return null;
      return toMysqlUtcDateTime(dt);
    } catch {
      return null;
    }
  }

  /**
   * Extracts IST Date (YYYY-MM-DD) from ISO datetime or date string.
   */
  toIstDate(dateStr?: string | null): string | null {
    if (!dateStr) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;
    try {
      const dt = new Date(dateStr);
      if (Number.isNaN(dt.getTime())) return null;
      return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(dt);
    } catch {
      return null;
    }
  }

  mapLead(legacy: LegacyLeadRecord) {
    const id = this.mapId(legacy.id, "lead");
    const validStages = ["new", "contacted", "qualified", "proposal", "won", "lost"];
    const status = validStages.includes(legacy.status) ? legacy.status : "new";

    return {
      id,
      ownerUserId: this.ownerUserId,
      name: legacy.name.trim(),
      company: legacy.company?.trim() || null,
      phone: legacy.phone?.trim() || null,
      email: legacy.email?.trim() || null,
      status,
      source: legacy.source?.trim() || "other",
      priority: legacy.priority ?? "med",
      notes: legacy.notes || null,
      lostReason: status === "lost" ? legacy.lostReason || null : null,
      pinned: Boolean(legacy.pinned),
      score: legacy.score ?? 50,
      lastContactAt: this.toMysqlUtc(legacy.lastContact),
      nextFollowUpAt: this.toMysqlUtc(legacy.nextFollowUp),
      version: 1,
      createdAt: this.toMysqlUtc(legacy.createdAt) || this.toMysqlUtc(new Date().toISOString())!,
      updatedAt: this.toMysqlUtc(legacy.updatedAt || legacy.createdAt)!,
    };
  }

  mapDeal(legacy: LegacyDealRecord) {
    const id = this.mapId(legacy.id, "deal");
    const leadId = this.mapId(legacy.leadId, "lead");
    const paise = legacy.valuePaise ?? this.toPaise(legacy.value);
    const validStatuses = ["active", "won", "lost", "cancelled"];
    let status = (legacy.status || "active").toLowerCase();
    if (!validStatuses.includes(status)) status = "active";

    return {
      id,
      ownerUserId: this.ownerUserId,
      leadId,
      name: legacy.name.trim(),
      clientName: legacy.clientName?.trim() || null,
      company: legacy.company?.trim() || null,
      valuePaise: paise,
      valueDecimal: (paise / 100).toFixed(2),
      status,
      lostReason: status === "lost" ? legacy.lostReason || null : null,
      expectedCloseIstDate: this.toIstDate(legacy.expectedCloseDate),
      wonAt: status === "won" ? this.toMysqlUtc(legacy.wonAt || legacy.createdAt) : null,
      version: 1,
      createdAt: this.toMysqlUtc(legacy.createdAt) || this.toMysqlUtc(new Date().toISOString())!,
      updatedAt: this.toMysqlUtc(legacy.updatedAt || legacy.createdAt)!,
    };
  }

  mapPayment(legacy: LegacyPaymentRecord) {
    const id = this.mapId(legacy.id, "pay");
    const dealId = this.mapId(legacy.dealId, "deal");
    const paise = legacy.amountPaise ?? this.toPaise(legacy.amount);
    const validMethods = ["upi", "bank_transfer", "cash", "card", "other"];
    const method = validMethods.includes(legacy.method ?? "") ? legacy.method! : "other";
    const isVoided = Boolean(legacy.voided);
    const dateStr = this.toIstDate(legacy.date || legacy.recordedAt || legacy.createdAt)!;

    return {
      id,
      ownerUserId: this.ownerUserId,
      dealId,
      amount: (paise / 100).toFixed(2),
      amountPaise: paise,
      amountDecimal: (paise / 100).toFixed(2),
      paymentIstDate: dateStr,
      paymentType: "milestone",
      method,
      reference: legacy.reference?.trim() || null,
      notes: legacy.notes?.trim() || null,
      status: isVoided ? "voided" : "completed",
      voidReason: isVoided ? legacy.voidReason || "Legacy void" : null,
      voidedAt: isVoided ? this.toMysqlUtc(legacy.voidedAt || new Date().toISOString()) : null,
      receivedIstDate: dateStr,
      recordedByUserId: this.ownerUserId,
      updatedByUserId: this.ownerUserId,
      version: 1,
      createdAt: this.toMysqlUtc(legacy.createdAt || legacy.recordedAt)!,
      updatedAt: this.toMysqlUtc(legacy.createdAt || legacy.recordedAt)!,
    };
  }

  mapProject(legacy: LegacyProjectRecord) {
    const id = this.mapId(legacy.id, "proj");
    const leadId = legacy.leadId ? this.mapId(legacy.leadId, "lead") : null;
    const dealId = legacy.dealId ? this.mapId(legacy.dealId, "deal") : null;
    const validStages = ["intake", "planning", "in_progress", "review", "delivered", "blocked"];
    let stage = (legacy.stage || legacy.status || "planning").toLowerCase();
    if (!validStages.includes(stage)) stage = "planning";

    return {
      id,
      ownerUserId: this.ownerUserId,
      leadId,
      dealId,
      name: legacy.name.trim(),
      clientName: legacy.clientName?.trim() || legacy.name.trim(),
      type: "client",
      stage,
      status: stage === "delivered" ? "completed" : "in_progress",
      targetIstDate: this.toIstDate(legacy.targetDate || legacy.dueDate),
      version: 1,
      createdAt: this.toMysqlUtc(legacy.createdAt)!,
      updatedAt: this.toMysqlUtc(legacy.updatedAt || legacy.createdAt)!,
    };
  }

  mapSalesGoal(legacy: LegacySalesGoalRecord) {
    const id = this.mapId(legacy.id, "goal");
    const target = legacy.targetPaise ?? (legacy.target ? Number(legacy.target) : null);
    const validPeriods = ["daily", "weekly", "monthly", "custom"];
    const period = validPeriods.includes(legacy.period) ? legacy.period : "monthly";
    const isMoney = legacy.metric.includes("value") || legacy.metric.includes("collected");
    const targetAmount = isMoney ? (Number(target ?? 0) / 100).toFixed(2) : null;

    return {
      id,
      ownerUserId: this.ownerUserId,
      name: legacy.name.trim(),
      metric: legacy.metric,
      period,
      scope: "owner",
      targetUnit: isMoney ? "amount" : "count",
      targetCount: isMoney ? null : target,
      targetAmount,
      targetAmountDecimal: targetAmount,
      status: legacy.status === "paused" ? "paused" : "active",
      effectiveFromIst: this.toIstDate(legacy.effectiveFrom || legacy.startDate)!,
      customFromIst: period === "custom" ? this.toIstDate(legacy.startDate) : null,
      customToIst: period === "custom" ? this.toIstDate(legacy.endDate) : null,
      createdByUserId: this.ownerUserId,
      updatedByUserId: this.ownerUserId,
      version: legacy.version ?? 1,
      createdAt: this.toMysqlUtc(legacy.createdAt)!,
      updatedAt: this.toMysqlUtc(legacy.updatedAt || legacy.createdAt)!,
    };
  }
}
