import "@tanstack/react-start/server-only";
import type { InferSelectModel } from "drizzle-orm";
import type { crmFollowUps, crmLeadActivities, crmLeads } from "../db/schema.server";
import { decimalStringToRupees } from "../db/money.server";
import { parseUtcDateTime } from "../db/utc.server";
import { mysqlUtcToIso, toIstParts } from "./dates.server";
import type {
  ActivityType,
  FollowUpType,
  LeadLifecycleStatus,
  LeadPriority,
  LeadSource,
  LeadStatus,
  QuickStatus,
} from "./validation.server";

export type LeadRow = InferSelectModel<typeof crmLeads>;
export type LeadActivityRow = InferSelectModel<typeof crmLeadActivities>;
export type FollowUpRow = InferSelectModel<typeof crmFollowUps>;

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
