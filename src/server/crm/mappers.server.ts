import "@tanstack/react-start/server-only";
import type { InferSelectModel } from "drizzle-orm";
import type {
  crmCallLogs,
  crmDealMilestones,
  crmDeals,
  crmFinanceEvents,
  crmFollowUps,
  crmLeadActivities,
  crmLeads,
  crmPayments,
  crmWhatsAppLogs,
} from "../db/schema.server";
import { decimalStringToPaise, decimalStringToRupees } from "../db/money.server";
import { parseUtcDateTime } from "../db/utc.server";
import { mysqlUtcToIso, toIstParts } from "./dates.server";
import type { DealFinancialSummaryDto } from "./financeCalc.server";
import type {
  ActivityType,
  CallOutcome,
  ClientType,
  DealStatus,
  FinanceEventType,
  FollowUpType,
  LeadLifecycleStatus,
  LeadPriority,
  LeadSource,
  LeadStatus,
  PaymentMethod,
  PaymentRecordStatus,
  PaymentType,
  QuickStatus,
  WaConfirmationStatus,
  WaPurpose,
} from "./validation.server";

export type LeadRow = InferSelectModel<typeof crmLeads>;
export type LeadActivityRow = InferSelectModel<typeof crmLeadActivities>;
export type FollowUpRow = InferSelectModel<typeof crmFollowUps>;
export type CallLogRow = InferSelectModel<typeof crmCallLogs>;
export type WhatsAppLogRow = InferSelectModel<typeof crmWhatsAppLogs>;

export interface LeadDto {
  id: string;
  legacyId: string | null;
  name: string;
  phone: string;
  email?: string;
  company?: string;
  requirement?: string;
  source: LeadSource;
  status: LeadStatus;
  priority: LeadPriority;
  aiScore?: number;
  quotedAmount?: number;
  budget?: number;
  lastContact?: string;
  nextFollowUp?: string;
  notes?: string;
  pinned: boolean;
  quickStatus?: QuickStatus;
  lostReason?: string;
  lifecycleStatus: LeadLifecycleStatus;
  archivedAt?: string;
  archiveReason?: string;
  tagIds: string[];
  fieldValues: Record<string, unknown>;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface LeadActivityDto {
  id: string;
  legacyId: string | null;
  leadId: string;
  actorUserId: string;
  type: ActivityType;
  text: string;
  outcome?: string;
  opId?: string;
  at: string;
  createdAt: string;
}

export interface FollowUpDto {
  id: string;
  legacyId: string | null;
  leadId: string;
  type: FollowUpType;
  dueAt: string;
  dueAtIst: string;
  dueIstDate: string;
  dueIstTime: string;
  note?: string;
  completedAt?: string;
  cancelledAt?: string;
  cancelReason?: string;
  replacedBy?: string;
  opId?: string;
  status: "pending" | "completed" | "cancelled";
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface FollowUpWithLeadDto extends FollowUpDto {
  lead: {
    id: string;
    name: string;
    phone: string;
    company?: string;
    status: LeadStatus;
    priority: LeadPriority;
    lifecycleStatus: LeadLifecycleStatus;
  };
}

export interface CallLogDto {
  id: string;
  legacyId: string | null;
  leadId: string;
  actorUserId: string;
  outcome: CallOutcome;
  connected: boolean;
  recordingSource: "user_recorded";
  notes?: string;
  dialSource: string;
  stageBefore: LeadStatus;
  stageAfter: LeadStatus;
  quickStatusBefore?: QuickStatus;
  quickStatusAfter?: QuickStatus;
  leadActivityId: string;
  opId?: string;
  at: string;
  atIst: string;
  occurredIstDate: string;
  occurredIstTime: string;
  createdAt: string;
  updatedAt: string;
}

export interface CallLogWithLeadDto extends CallLogDto {
  lead: {
    id: string;
    name: string;
    phone: string;
    company?: string;
    status: LeadStatus;
    priority: LeadPriority;
    lifecycleStatus: LeadLifecycleStatus;
  };
}

export interface WhatsAppLogDto {
  id: string;
  legacyId: string | null;
  leadId: string;
  actorUserId: string;
  purpose: WaPurpose;
  templateId?: string;
  templateName?: string;
  recipientPhone: string;
  messageText: string;
  confirmationStatus: WaConfirmationStatus;
  composerSource: string;
  leadActivityId: string;
  opId?: string;
  confirmedAt: string;
  confirmedAtIst: string;
  confirmedIstDate: string;
  confirmedIstTime: string;
  createdAt: string;
  updatedAt: string;
}

export interface WhatsAppLogWithLeadDto extends WhatsAppLogDto {
  lead: {
    id: string;
    name: string;
    phone: string;
    company?: string;
    status: LeadStatus;
    priority: LeadPriority;
    lifecycleStatus: LeadLifecycleStatus;
  };
}

export function toLeadDto(
  row: LeadRow,
  relations?: { tagIds?: string[]; fieldValues?: Record<string, unknown> },
): LeadDto {
  const lastContact = mysqlUtcToIso(row.lastContactAt);
  const nextFollowUp = mysqlUtcToIso(row.nextFollowUpAt);
  const archivedAt = mysqlUtcToIso(row.archivedAt);

  return {
    id: row.id,
    legacyId: row.legacyId ?? null,
    name: row.name,
    phone: row.phone,
    ...(row.email ? { email: row.email } : {}),
    ...(row.company ? { company: row.company } : {}),
    ...(row.requirement ? { requirement: row.requirement } : {}),
    source: row.source as LeadSource,
    status: row.status as LeadStatus,
    priority: row.priority as LeadPriority,
    ...(row.aiScore !== null && row.aiScore !== undefined ? { aiScore: row.aiScore } : {}),
    ...(row.quotedAmount !== null && row.quotedAmount !== undefined
      ? { quotedAmount: decimalStringToRupees(row.quotedAmount) }
      : {}),
    ...(row.budget !== null && row.budget !== undefined
      ? { budget: decimalStringToRupees(row.budget) }
      : {}),
    ...(lastContact ? { lastContact } : {}),
    ...(nextFollowUp ? { nextFollowUp } : {}),
    ...(row.notes ? { notes: row.notes } : {}),
    pinned: Boolean(row.pinned),
    ...(row.quickStatus ? { quickStatus: row.quickStatus as QuickStatus } : {}),
    ...(row.lostReason ? { lostReason: row.lostReason } : {}),
    lifecycleStatus: row.lifecycleStatus as LeadLifecycleStatus,
    ...(archivedAt ? { archivedAt } : {}),
    ...(row.archiveReason ? { archiveReason: row.archiveReason } : {}),
    tagIds: relations?.tagIds ?? [],
    fieldValues: relations?.fieldValues ?? {},
    version: row.version,
    createdAt: mysqlUtcToIso(row.createdAt) ?? row.createdAt,
    updatedAt: mysqlUtcToIso(row.updatedAt) ?? row.updatedAt,
  };
}

export function toLeadActivityDto(row: LeadActivityRow): LeadActivityDto {
  const at = mysqlUtcToIso(row.occurredAt) ?? row.occurredAt;
  const createdAt = mysqlUtcToIso(row.createdAt) ?? row.createdAt;
  return {
    id: row.id,
    legacyId: row.legacyId ?? null,
    leadId: row.leadId,
    actorUserId: row.actorUserId,
    type: row.type as ActivityType,
    text: row.text,
    ...(row.outcome ? { outcome: row.outcome } : {}),
    ...(row.opId ? { opId: row.opId } : {}),
    at,
    createdAt,
  };
}

export function toFollowUpDto(row: FollowUpRow): FollowUpDto {
  const dueDate = parseUtcDateTime(row.dueAt);
  const dueIso = Number.isNaN(dueDate.getTime()) ? row.dueAt : dueDate.toISOString();
  const ist = Number.isNaN(dueDate.getTime())
    ? {
        istDate: row.dueIstDate,
        istTime: row.dueIstTime,
        istDateTime: `${row.dueIstDate}T${row.dueIstTime}:00+05:30`,
      }
    : toIstParts(dueDate);
  const completedAt = mysqlUtcToIso(row.completedAt);
  const cancelledAt = mysqlUtcToIso(row.cancelledAt);
  const status: FollowUpDto["status"] = completedAt
    ? "completed"
    : cancelledAt
      ? "cancelled"
      : "pending";

  return {
    id: row.id,
    legacyId: row.legacyId ?? null,
    leadId: row.leadId,
    type: row.type as FollowUpType,
    dueAt: dueIso,
    dueAtIst: ist.istDateTime,
    dueIstDate: row.dueIstDate,
    dueIstTime: row.dueIstTime,
    ...(row.note ? { note: row.note } : {}),
    ...(completedAt ? { completedAt } : {}),
    ...(cancelledAt ? { cancelledAt } : {}),
    ...(row.cancelReason ? { cancelReason: row.cancelReason } : {}),
    ...(row.replacedById ? { replacedBy: row.replacedById } : {}),
    ...(row.opId ? { opId: row.opId } : {}),
    status,
    version: row.version,
    createdAt: mysqlUtcToIso(row.createdAt) ?? row.createdAt,
    updatedAt: mysqlUtcToIso(row.updatedAt) ?? row.updatedAt,
  };
}

export function toCallLogDto(row: CallLogRow): CallLogDto {
  const atDate = parseUtcDateTime(row.occurredAt);
  const at = Number.isNaN(atDate.getTime()) ? row.occurredAt : atDate.toISOString();
  const ist = Number.isNaN(atDate.getTime())
    ? {
        istDate: row.occurredIstDate,
        istTime: row.occurredIstTime,
        istDateTime: `${row.occurredIstDate}T${row.occurredIstTime}:00+05:30`,
      }
    : toIstParts(atDate);

  return {
    id: row.id,
    legacyId: row.legacyId ?? null,
    leadId: row.leadId,
    actorUserId: row.actorUserId,
    outcome: row.outcome as CallOutcome,
    connected: Boolean(row.connected),
    recordingSource: "user_recorded",
    ...(row.notes ? { notes: row.notes } : {}),
    dialSource: row.dialSource,
    stageBefore: row.stageBefore as LeadStatus,
    stageAfter: row.stageAfter as LeadStatus,
    ...(row.quickStatusBefore ? { quickStatusBefore: row.quickStatusBefore as QuickStatus } : {}),
    ...(row.quickStatusAfter ? { quickStatusAfter: row.quickStatusAfter as QuickStatus } : {}),
    leadActivityId: row.leadActivityId,
    ...(row.opId ? { opId: row.opId } : {}),
    at,
    atIst: ist.istDateTime,
    occurredIstDate: row.occurredIstDate,
    occurredIstTime: row.occurredIstTime,
    createdAt: mysqlUtcToIso(row.createdAt) ?? row.createdAt,
    updatedAt: mysqlUtcToIso(row.updatedAt) ?? row.updatedAt,
  };
}

export function toWhatsAppLogDto(row: WhatsAppLogRow): WhatsAppLogDto {
  const atDate = parseUtcDateTime(row.confirmedAt);
  const confirmedAt = Number.isNaN(atDate.getTime()) ? row.confirmedAt : atDate.toISOString();
  const ist = Number.isNaN(atDate.getTime())
    ? {
        istDate: row.confirmedIstDate,
        istTime: row.confirmedIstTime,
        istDateTime: `${row.confirmedIstDate}T${row.confirmedIstTime}:00+05:30`,
      }
    : toIstParts(atDate);

  return {
    id: row.id,
    legacyId: row.legacyId ?? null,
    leadId: row.leadId,
    actorUserId: row.actorUserId,
    purpose: row.purpose as WaPurpose,
    ...(row.templateId ? { templateId: row.templateId } : {}),
    ...(row.templateName ? { templateName: row.templateName } : {}),
    recipientPhone: row.recipientPhone,
    messageText: row.messageText,
    confirmationStatus: "owner_confirmed_sent",
    composerSource: row.composerSource,
    leadActivityId: row.leadActivityId,
    ...(row.opId ? { opId: row.opId } : {}),
    confirmedAt,
    confirmedAtIst: ist.istDateTime,
    confirmedIstDate: row.confirmedIstDate,
    confirmedIstTime: row.confirmedIstTime,
    createdAt: mysqlUtcToIso(row.createdAt) ?? row.createdAt,
    updatedAt: mysqlUtcToIso(row.updatedAt) ?? row.updatedAt,
  };
}

// ---------------------------------------------------------------------------
// Checkpoint B3A — Financial Ledger DTOs & Mappers
// ---------------------------------------------------------------------------

export type DealRow = InferSelectModel<typeof crmDeals>;
export type DealMilestoneRow = InferSelectModel<typeof crmDealMilestones>;
export type PaymentRow = InferSelectModel<typeof crmPayments>;
export type FinanceEventRow = InferSelectModel<typeof crmFinanceEvents>;

export interface DealMilestoneDto {
  id: string;
  legacyId: string | null;
  label: string;
  amount: number;
  amountDecimal: string;
  amountPaise: number;
  dueDate: string;
  sortOrder: number;
}

export interface DealDto {
  id: string;
  legacyId: string | null;
  leadId?: string;
  clientType: ClientType;
  clientName: string;
  company?: string;
  phone?: string;
  name: string;
  quotedAmount: number;
  quotedAmountDecimal: string;
  quotedAmountPaise: number;
  finalAmount: number;
  finalAmountDecimal: string;
  finalAmountPaise: number;
  status: DealStatus;
  dueDate?: string;
  milestones: DealMilestoneDto[];
  notes?: string;
  wonAt?: string;
  wonIstDate?: string;
  wonDateVerifiedAt?: string;
  wonDateVerifiedByUserId?: string;
  cancelledAt?: string;
  cancelledIstDate?: string;
  cancelledByUserId?: string;
  cancelReason?: string;
  opId?: string;
  createdByUserId: string;
  updatedByUserId: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  financialSummary: DealFinancialSummaryDto;
}

export interface PaymentDto {
  id: string;
  legacyId: string | null;
  dealId: string;
  amount: number;
  amountDecimal: string;
  amountPaise: number;
  date: string;
  method: PaymentMethod;
  type: PaymentType;
  reference?: string;
  notes?: string;
  status: PaymentRecordStatus;
  voided: boolean;
  voidedAt?: string;
  voidedIstDate?: string;
  voidedByUserId?: string;
  voidReason?: string;
  opId?: string;
  recordedByUserId: string;
  updatedByUserId: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface FinanceEventDto {
  id: string;
  dealId: string;
  paymentId?: string;
  leadId?: string;
  actorUserId: string;
  eventType: FinanceEventType;
  summary: string;
  reason?: string;
  amount?: number;
  amountDecimal?: string;
  amountPaise?: number;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  leadActivityId?: string;
  opId?: string;
  at: string;
  occurredIstDate: string;
  createdAt: string;
}

export function toDealMilestoneDto(row: DealMilestoneRow): DealMilestoneDto {
  const amountPaise = decimalStringToPaise(row.amount);
  return {
    id: row.id,
    legacyId: row.legacyId ?? null,
    label: row.label,
    amount: decimalStringToRupees(row.amount),
    amountDecimal: row.amount,
    amountPaise,
    dueDate: row.dueDate,
    sortOrder: row.sortOrder,
  };
}

export function toDealDto(
  row: DealRow,
  milestones: readonly DealMilestoneRow[],
  financialSummary: DealFinancialSummaryDto,
): DealDto {
  const wonAt = mysqlUtcToIso(row.wonAt);
  const wonDateVerifiedAt = mysqlUtcToIso(row.wonDateVerifiedAt);
  const cancelledAt = mysqlUtcToIso(row.cancelledAt);
  const sortedMilestones = [...milestones]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map(toDealMilestoneDto);

  return {
    id: row.id,
    legacyId: row.legacyId ?? null,
    ...(row.leadId ? { leadId: row.leadId } : {}),
    clientType: row.clientType as ClientType,
    clientName: row.clientName,
    ...(row.company ? { company: row.company } : {}),
    ...(row.phone ? { phone: row.phone } : {}),
    name: row.name,
    quotedAmount: financialSummary.quotedAmount,
    quotedAmountDecimal: row.quotedAmount,
    quotedAmountPaise: financialSummary.quotedAmountPaise,
    finalAmount: financialSummary.finalAmount,
    finalAmountDecimal: row.finalAmount,
    finalAmountPaise: financialSummary.finalAmountPaise,
    status: row.status as DealStatus,
    ...(row.dueDate ? { dueDate: row.dueDate } : {}),
    milestones: sortedMilestones,
    ...(row.notes ? { notes: row.notes } : {}),
    ...(wonAt ? { wonAt } : {}),
    ...(row.wonIstDate ? { wonIstDate: row.wonIstDate } : {}),
    ...(wonDateVerifiedAt ? { wonDateVerifiedAt } : {}),
    ...(row.wonDateVerifiedByUserId
      ? { wonDateVerifiedByUserId: row.wonDateVerifiedByUserId }
      : {}),
    ...(cancelledAt ? { cancelledAt } : {}),
    ...(row.cancelledIstDate ? { cancelledIstDate: row.cancelledIstDate } : {}),
    ...(row.cancelledByUserId ? { cancelledByUserId: row.cancelledByUserId } : {}),
    ...(row.cancelReason ? { cancelReason: row.cancelReason } : {}),
    ...(row.opId ? { opId: row.opId } : {}),
    createdByUserId: row.createdByUserId,
    updatedByUserId: row.updatedByUserId,
    version: row.version,
    createdAt: mysqlUtcToIso(row.createdAt) ?? row.createdAt,
    updatedAt: mysqlUtcToIso(row.updatedAt) ?? row.updatedAt,
    financialSummary,
  };
}

export function toPaymentDto(row: PaymentRow): PaymentDto {
  const voidedAt = mysqlUtcToIso(row.voidedAt);
  const amountPaise = decimalStringToPaise(row.amount);
  return {
    id: row.id,
    legacyId: row.legacyId ?? null,
    dealId: row.dealId,
    amount: decimalStringToRupees(row.amount),
    amountDecimal: row.amount,
    amountPaise,
    date: row.paymentIstDate,
    method: row.method as PaymentMethod,
    type: row.paymentType as PaymentType,
    ...(row.reference ? { reference: row.reference } : {}),
    ...(row.notes ? { notes: row.notes } : {}),
    status: row.status as PaymentRecordStatus,
    voided: Boolean(row.voided),
    ...(voidedAt ? { voidedAt } : {}),
    ...(row.voidedIstDate ? { voidedIstDate: row.voidedIstDate } : {}),
    ...(row.voidedByUserId ? { voidedByUserId: row.voidedByUserId } : {}),
    ...(row.voidReason ? { voidReason: row.voidReason } : {}),
    ...(row.opId ? { opId: row.opId } : {}),
    recordedByUserId: row.recordedByUserId,
    updatedByUserId: row.updatedByUserId,
    version: row.version,
    createdAt: mysqlUtcToIso(row.createdAt) ?? row.createdAt,
    updatedAt: mysqlUtcToIso(row.updatedAt) ?? row.updatedAt,
  };
}

function safeParseJsonObject(raw: string | null | undefined): Record<string, unknown> | undefined {
  if (!raw) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

export function toFinanceEventDto(row: FinanceEventRow): FinanceEventDto {
  const before = safeParseJsonObject(row.beforeJson);
  const after = safeParseJsonObject(row.afterJson);
  const hasAmount = row.amountSnapshot !== null && row.amountSnapshot !== undefined;
  const amountPaise = hasAmount ? decimalStringToPaise(row.amountSnapshot!) : undefined;

  return {
    id: row.id,
    dealId: row.dealId,
    ...(row.paymentId ? { paymentId: row.paymentId } : {}),
    ...(row.leadId ? { leadId: row.leadId } : {}),
    actorUserId: row.actorUserId,
    eventType: row.eventType as FinanceEventType,
    summary: row.summary,
    ...(row.reason ? { reason: row.reason } : {}),
    ...(hasAmount
      ? {
          amount: decimalStringToRupees(row.amountSnapshot!),
          amountDecimal: row.amountSnapshot!,
          amountPaise: amountPaise!,
        }
      : {}),
    ...(before ? { before } : {}),
    ...(after ? { after } : {}),
    ...(row.leadActivityId ? { leadActivityId: row.leadActivityId } : {}),
    ...(row.opId ? { opId: row.opId } : {}),
    at: mysqlUtcToIso(row.occurredAt) ?? row.occurredAt,
    occurredIstDate: row.occurredIstDate,
    createdAt: mysqlUtcToIso(row.createdAt) ?? row.createdAt,
  };
}
