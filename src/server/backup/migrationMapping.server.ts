import "@tanstack/react-start/server-only";
import { toMysqlUtcDateTime } from "../db/utc.server";
import { parseStrictInrInputToPaise } from "../db/money.server";

export class FinancialValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FinancialValidationError";
  }
}

/**
 * Parses a legacy or imported INR monetary amount into exact integer paise.
 * Strictly rejects fractional paise (>2 decimal places, e.g. 1.005), scientific notation,
 * NaN, Infinity, negative values, and overflow beyond DECIMAL(15,2).
 */
export function parseLegacyRupeesToPaise(
  val: unknown,
  options?: { allowZero?: boolean; entityContext?: string },
): { ok: true; paise: number } | { ok: false; error: string } {
  const allowZero = options?.allowZero ?? true;
  if (val === undefined || val === null || val === "") {
    if (allowZero) return { ok: true, paise: 0 };
    return { ok: false, error: "Monetary amount is required." };
  }

  let inputToParse = val;
  if (typeof val === "string") {
    inputToParse = val.replace(/,/g, "").trim();
  }

  const res = parseStrictInrInputToPaise(inputToParse, { allowZero });
  if (!res.ok) {
    return { ok: false, error: res.message };
  }
  return { ok: true, paise: res.paise };
}

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

export interface LegacyProjectTaskRecord {
  id: string;
  projectId: string;
  milestoneId?: string;
  title: string;
  notes?: string;
  assigneeId?: string;
  dueDate?: string;
  priority?: string;
  status?: string;
  sortOrder?: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface LegacyPaymentProofRecord {
  attachmentId: string;
  paymentId: string;
  dealId?: string;
  originalFileName: string;
  fileExtension?: string;
  mimeType?: string;
  fileSize: number;
  sha256?: string;
  path?: string | null;
  uploadedAt?: string;
}

export interface LegacyQuotationRecord {
  id: string;
  number?: string;
  leadId?: string;
  dealId?: string;
  templateId?: string;
  title: string;
  clientName: string;
  clientCompany?: string;
  total?: number | string;
  totalAmountPaise?: number;
  status?: string;
  issueDate?: string;
  validUntil?: string;
  paymentTerms?: string;
  notes?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface LegacyOwnerSettingsRecord {
  id?: string;
  ownerDisplayName?: string;
  businessName?: string;
  profileEmail?: string;
  businessPhone?: string;
  businessWebsite?: string;
  businessAddress?: string;
  gstin?: string;
  paymentInstructions?: string;
  businessTimezone?: string;
  currencyCode?: string;
  defaultLeadSort?: string;
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
   * Converts an INR currency amount into exact integer paise without IEEE-754 float drift.
   * Throws FinancialValidationError if the amount has invalid precision (e.g. 1.005), is negative, or overflows.
   */
  toPaise(val: unknown, options?: { allowZero?: boolean; entityContext?: string }): number {
    const res = parseLegacyRupeesToPaise(val, options);
    if (!res.ok) {
      throw new FinancialValidationError(
        `Invalid monetary amount in ${options?.entityContext ?? "financial record"}: ${res.error}`,
      );
    }
    return res.paise;
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
    const phone = legacy.phone?.trim() || "0000000000";
    const phoneDigits = phone.replace(/\D/g, "");
    const phoneKey =
      phoneDigits.length >= 10 ? phoneDigits.slice(-10) : phoneDigits.padEnd(10, "0");

    return {
      id,
      ownerUserId: this.ownerUserId,
      name: legacy.name.trim(),
      company: legacy.company?.trim() || null,
      phone,
      phoneKey,
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
      createdByUserId: this.ownerUserId,
      updatedByUserId: this.ownerUserId,
      version: 1,
      createdAt: this.toMysqlUtc(legacy.createdAt) || this.toMysqlUtc(new Date().toISOString())!,
      updatedAt: this.toMysqlUtc(legacy.updatedAt || legacy.createdAt)!,
    };
  }

  mapDeal(legacy: LegacyDealRecord) {
    const id = this.mapId(legacy.id, "deal");
    const leadId = this.mapId(legacy.leadId, "lead");
    let paise: number;
    if (
      typeof legacy.valuePaise === "number" &&
      Number.isSafeInteger(legacy.valuePaise) &&
      legacy.valuePaise >= 0
    ) {
      paise = legacy.valuePaise;
    } else {
      paise = this.toPaise(legacy.value, { entityContext: `deal '${legacy.id}'` });
    }
    const validStatuses = ["active", "won", "lost", "cancelled"];
    let status = (legacy.status || "active").toLowerCase();
    if (!validStatuses.includes(status)) status = "active";
    const amountStr = (paise / 100).toFixed(2);

    return {
      id,
      ownerUserId: this.ownerUserId,
      leadId,
      name: legacy.name.trim(),
      clientType: "business",
      clientName: legacy.clientName?.trim() || legacy.name.trim() || "Client",
      company: legacy.company?.trim() || null,
      quotedAmount: amountStr,
      finalAmount: amountStr,
      valuePaise: paise,
      valueDecimal: amountStr,
      status,
      lostReason: status === "lost" ? legacy.lostReason || null : null,
      dueDate: this.toIstDate(legacy.expectedCloseDate),
      wonAt: status === "won" ? this.toMysqlUtc(legacy.wonAt || legacy.createdAt) : null,
      createdByUserId: this.ownerUserId,
      updatedByUserId: this.ownerUserId,
      version: 1,
      createdAt: this.toMysqlUtc(legacy.createdAt) || this.toMysqlUtc(new Date().toISOString())!,
      updatedAt: this.toMysqlUtc(legacy.updatedAt || legacy.createdAt)!,
    };
  }

  mapPayment(legacy: LegacyPaymentRecord) {
    const id = this.mapId(legacy.id, "pay");
    const dealId = this.mapId(legacy.dealId, "deal");
    let paise: number;
    if (
      typeof legacy.amountPaise === "number" &&
      Number.isSafeInteger(legacy.amountPaise) &&
      legacy.amountPaise >= 0
    ) {
      paise = legacy.amountPaise;
    } else {
      paise = this.toPaise(legacy.amount, { entityContext: `payment '${legacy.id}'` });
    }
    const isVoided = Boolean(legacy.voided);
    const paymentIstDate = this.toIstDate(legacy.date || legacy.recordedAt || legacy.createdAt)!;

    return {
      id,
      ownerUserId: this.ownerUserId,
      dealId,
      amount: (paise / 100).toFixed(2),
      amountPaise: paise,
      amountDecimal: (paise / 100).toFixed(2),
      method: legacy.method || "bank_transfer",
      paymentType: "regular",
      reference: legacy.reference || null,
      notes: legacy.notes || null,
      status: isVoided ? "voided" : "posted",
      paymentIstDate,
      receivedIstDate: paymentIstDate,
      voided: isVoided,
      voidReason: isVoided ? legacy.voidReason || "Legacy void" : null,
      voidedAt: isVoided ? this.toMysqlUtc(legacy.voidedAt || legacy.createdAt) : null,
      recordedByUserId: this.ownerUserId,
      updatedByUserId: this.ownerUserId,
      version: 1,
      createdAt:
        this.toMysqlUtc(legacy.createdAt || legacy.recordedAt) ||
        this.toMysqlUtc(new Date().toISOString())!,
      updatedAt:
        this.toMysqlUtc(legacy.createdAt || legacy.recordedAt) ||
        this.toMysqlUtc(new Date().toISOString())!,
    };
  }

  mapProject(legacy: LegacyProjectRecord) {
    const id = this.mapId(legacy.id, "proj");
    const leadId = legacy.leadId ? this.mapId(legacy.leadId, "lead") : null;
    const dealId = legacy.dealId ? this.mapId(legacy.dealId, "deal") : null;
    const validStages = [
      "intake",
      "planning",
      "in_progress",
      "discovery",
      "design",
      "dev",
      "qa",
      "handover",
      "support",
      "review",
      "delivered",
      "blocked",
    ];
    let stage = (legacy.stage || legacy.status || "in_progress").toLowerCase();
    if (!validStages.includes(stage)) stage = "in_progress";

    return {
      id,
      ownerUserId: this.ownerUserId,
      leadId,
      dealId,
      name: legacy.name.trim(),
      clientName: legacy.clientName?.trim() || "Client",
      type: "standard",
      stage,
      status: legacy.status || "in_progress",
      startIstDate: this.toIstDate(legacy.startDate),
      targetIstDate: this.toIstDate(legacy.targetDate || legacy.dueDate),
      version: 1,
      createdAt: this.toMysqlUtc(legacy.createdAt) || this.toMysqlUtc(new Date().toISOString())!,
      updatedAt: this.toMysqlUtc(legacy.updatedAt || legacy.createdAt)!,
    };
  }

  mapProjectTask(legacy: LegacyProjectTaskRecord) {
    const id = this.mapId(legacy.id, "ptask");
    const projectId = this.mapId(legacy.projectId, "proj");
    const milestoneId = legacy.milestoneId ? this.mapId(legacy.milestoneId, "pms") : null;

    return {
      id,
      ownerUserId: this.ownerUserId,
      projectId,
      milestoneId,
      title: legacy.title?.trim() || "Untitled Task",
      notes: legacy.notes || null,
      assigneeId: legacy.assigneeId || null,
      dueDate: this.toIstDate(legacy.dueDate),
      priority: legacy.priority || "normal",
      status: legacy.status || "open",
      sortOrder: legacy.sortOrder ?? 0,
      version: 1,
      createdAt: this.toMysqlUtc(legacy.createdAt) || this.toMysqlUtc(new Date().toISOString())!,
      updatedAt: this.toMysqlUtc(legacy.updatedAt || legacy.createdAt)!,
    };
  }

  mapPaymentProof(legacy: LegacyPaymentProofRecord, dealId: string) {
    const id = this.mapId(legacy.attachmentId, "proof");
    const paymentId = this.mapId(legacy.paymentId, "pay");
    const mappedDealId = this.mapId(dealId, "deal");
    const fileName = legacy.originalFileName || "proof.png";
    const ext = legacy.fileExtension || fileName.split(".").pop() || "png";

    return {
      id,
      ownerUserId: this.ownerUserId,
      paymentId,
      dealId: mappedDealId,
      legacyAttachmentId: legacy.attachmentId,
      originalFileName: fileName,
      fileExtension: ext.toLowerCase(),
      mimeType: legacy.mimeType || "application/octet-stream",
      fileSize: legacy.fileSize,
      sha256Hash: legacy.sha256 || "",
      storageDriver: "local-fs",
      storageKey: legacy.path || `files/payment-proofs/${legacy.attachmentId}__${fileName}`,
      lifecycleStatus: "active",
      uploadedByUserId: this.ownerUserId,
      version: 1,
      uploadedAt: this.toMysqlUtc(legacy.uploadedAt) || this.toMysqlUtc(new Date().toISOString())!,
      createdAt: this.toMysqlUtc(legacy.uploadedAt) || this.toMysqlUtc(new Date().toISOString())!,
      updatedAt: this.toMysqlUtc(legacy.uploadedAt) || this.toMysqlUtc(new Date().toISOString())!,
    };
  }

  mapQuotation(legacy: LegacyQuotationRecord) {
    const id = this.mapId(legacy.id, "quot");
    const leadId = legacy.leadId ? this.mapId(legacy.leadId, "lead") : null;
    const dealId = legacy.dealId ? this.mapId(legacy.dealId, "deal") : null;
    const totalPaise =
      typeof legacy.totalAmountPaise === "number" &&
      Number.isSafeInteger(legacy.totalAmountPaise) &&
      legacy.totalAmountPaise >= 0
        ? legacy.totalAmountPaise
        : this.toPaise(legacy.total, { entityContext: `quotation '${legacy.id}'` });

    return {
      id,
      ownerUserId: this.ownerUserId,
      leadId,
      dealId,
      templateId: legacy.templateId || null,
      legacyId: legacy.id,
      quotationNumber: legacy.number || legacy.id,
      title: legacy.title?.trim() || "Quotation",
      clientName: legacy.clientName?.trim() || "Client",
      clientCompany: legacy.clientCompany || null,
      currency: "INR",
      subtotal: (totalPaise / 100).toFixed(2),
      totalAmount: (totalPaise / 100).toFixed(2),
      status: legacy.status || "draft",
      issueIstDate:
        this.toIstDate(legacy.issueDate) ||
        new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date()),
      validUntilIstDate: this.toIstDate(legacy.validUntil),
      paymentTerms: legacy.paymentTerms || null,
      notes: legacy.notes || null,
      version: 1,
      createdAt: this.toMysqlUtc(legacy.createdAt) || this.toMysqlUtc(new Date().toISOString())!,
      updatedAt: this.toMysqlUtc(legacy.updatedAt || legacy.createdAt)!,
    };
  }

  mapOwnerSettings(legacy: LegacyOwnerSettingsRecord) {
    const id = this.mapId(legacy.id || "settings_primary", "set");

    return {
      id,
      ownerUserId: this.ownerUserId,
      ownerDisplayName: legacy.ownerDisplayName || null,
      businessName: legacy.businessName || null,
      profileEmail: legacy.profileEmail?.toLowerCase() || null,
      businessPhone: legacy.businessPhone || null,
      businessWebsite: legacy.businessWebsite || null,
      businessAddress: legacy.businessAddress || null,
      gstin: legacy.gstin || null,
      paymentInstructions: legacy.paymentInstructions || null,
      businessTimezone: legacy.businessTimezone || "Asia/Kolkata",
      currencyCode: legacy.currencyCode || "INR",
      defaultLeadSort: legacy.defaultLeadSort || "recent",
      updatedByUserId: this.ownerUserId,
      version: 1,
      createdAt: this.toMysqlUtc(new Date().toISOString())!,
      updatedAt: this.toMysqlUtc(new Date().toISOString())!,
    };
  }

  mapSalesGoal(legacy: LegacySalesGoalRecord) {
    const id = this.mapId(legacy.id, "goal");
    const isMonetary =
      legacy.metric.includes("revenue") ||
      legacy.metric.includes("deal_value") ||
      legacy.metric === "cash_collected" ||
      legacy.metric === "revenue";
    const targetUnit = isMonetary ? "currency" : "count";
    let targetCount: number | null = null;
    let targetAmount: string | null = null;
    let targetPaise: number | null = null;

    if (
      (legacy.target !== undefined && legacy.target !== null && legacy.target !== "") ||
      (legacy.targetPaise !== undefined && legacy.targetPaise !== null)
    ) {
      if (isMonetary) {
        if (
          typeof legacy.targetPaise === "number" &&
          Number.isSafeInteger(legacy.targetPaise) &&
          legacy.targetPaise >= 0
        ) {
          targetPaise = legacy.targetPaise;
        } else if (typeof legacy.target === "number" && Number.isInteger(legacy.target)) {
          // In legacy fixtures, numeric target for monetary goals is already stored in paise
          targetPaise = legacy.target;
        } else {
          targetPaise = this.toPaise(legacy.target, { entityContext: `goal '${legacy.id}'` });
        }
        targetAmount = (targetPaise / 100).toFixed(2);
      } else {
        const num =
          typeof legacy.target === "number" ? legacy.target : parseInt(String(legacy.target), 10);
        if (Number.isSafeInteger(num) && num >= 0) {
          targetCount = num;
          targetPaise = num;
        } else {
          throw new FinancialValidationError(
            `Invalid target count in goal '${legacy.id}': ${legacy.target}`,
          );
        }
      }
    }

    const todayIst = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(
      new Date(),
    );

    return {
      id,
      ownerUserId: this.ownerUserId,
      name: legacy.name?.trim() || "Sales Goal",
      metric: legacy.metric,
      scope: "owner",
      targetUnit,
      targetCount,
      targetAmount,
      targetAmountDecimal: targetAmount,
      targetPaise,
      period: legacy.period,
      customFromIst: this.toIstDate(legacy.startDate),
      customToIst: this.toIstDate(legacy.endDate),
      effectiveFromIst: this.toIstDate(legacy.effectiveFrom) || todayIst,
      status: legacy.status || "active",
      createdByUserId: this.ownerUserId,
      updatedByUserId: this.ownerUserId,
      version: legacy.version ?? 1,
      createdAt: this.toMysqlUtc(legacy.createdAt) || this.toMysqlUtc(new Date().toISOString())!,
      updatedAt: this.toMysqlUtc(legacy.updatedAt || legacy.createdAt)!,
    };
  }
}
