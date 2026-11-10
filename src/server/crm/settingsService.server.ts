import "@tanstack/react-start/server-only";
import { and, desc, eq, sql, type SQL } from "drizzle-orm";
import type { CrmDatabase } from "../db/index.server";
import { crmOwnerSettings, crmSettingsAuditEvents } from "../db/schema.server";
import { parseUtcDateTime, toMysqlUtcDateTime } from "../db/utc.server";
import { generateServerId } from "../auth/security.server";
import { toIstParts } from "./dates.server";
import { CrmServiceError, isMysqlDuplicateKeyError } from "./errors.server";
import { GOAL_METRIC_DEFINITIONS, GOAL_PERIODS } from "./goalsCalc.server";
import { hashIdempotentRequest, runWithIdempotency } from "./idempotency.server";
import {
  BUSINESS_TIMEZONE_FIXED,
  CURRENCY_CODE_FIXED,
  DEFAULT_LEAD_SORTS,
  type DefaultLeadSort,
  type ListSettingsAuditQuery,
  type UpdateSettingsInput,
  UPDATABLE_SETTINGS_FIELDS,
} from "./settingsGoalsValidation.server";
import { LEAD_SOURCES, LEAD_STATUSES } from "./validation.server";

export type OwnerSettingsRow = typeof crmOwnerSettings.$inferSelect;
export type SettingsAuditEventRow = typeof crmSettingsAuditEvents.$inferSelect;

export interface OwnerSettingsDto {
  configured: boolean;
  id: string | null;
  ownerUserId: string;
  ownerDisplayName: string | null;
  businessName: string | null;
  profileEmail: string | null;
  businessPhone: string | null;
  businessWebsite: string | null;
  businessAddress: string | null;
  gstin: string | null;
  paymentInstructions: string | null;
  businessTimezone: typeof BUSINESS_TIMEZONE_FIXED;
  currencyCode: typeof CURRENCY_CODE_FIXED;
  defaultLeadSort: DefaultLeadSort;
  notifyFollowUps: boolean;
  notifyPayments: boolean;
  notifyDigest: boolean;
  notifyGoalAchieved: boolean;
  notifyTeamGoal: boolean;
  notifyMilestone: boolean;
  notifyOverdue: boolean;
  overdueThreshold: number;
  updatedByUserId: string | null;
  version: number;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface SettingsAuditEventDto {
  id: string;
  settingsId: string;
  ownerUserId: string;
  actorUserId: string;
  section: string;
  eventType: string;
  summary: string;
  changedFields: string[];
  before: Record<string, unknown> | null;
  after: Record<string, unknown>;
  versionBefore: number;
  versionAfter: number;
  occurredIstDate: string;
  createdAt: string;
}

type SettingsSnapshotFields = {
  ownerDisplayName: string | null;
  businessName: string | null;
  profileEmail: string | null;
  businessPhone: string | null;
  businessWebsite: string | null;
  businessAddress: string | null;
  gstin: string | null;
  paymentInstructions: string | null;
  businessTimezone: typeof BUSINESS_TIMEZONE_FIXED;
  currencyCode: typeof CURRENCY_CODE_FIXED;
  defaultLeadSort: DefaultLeadSort;
  notifyFollowUps: boolean;
  notifyPayments: boolean;
  notifyDigest: boolean;
  notifyGoalAchieved: boolean;
  notifyTeamGoal: boolean;
  notifyMilestone: boolean;
  notifyOverdue: boolean;
  overdueThreshold: number;
};

const DEFAULT_UNSET_FIELDS: SettingsSnapshotFields = {
  ownerDisplayName: null,
  businessName: null,
  profileEmail: null,
  businessPhone: null,
  businessWebsite: null,
  businessAddress: null,
  gstin: null,
  paymentInstructions: null,
  businessTimezone: BUSINESS_TIMEZONE_FIXED,
  currencyCode: CURRENCY_CODE_FIXED,
  defaultLeadSort: "recent",
  notifyFollowUps: true,
  notifyPayments: true,
  notifyDigest: false,
  notifyGoalAchieved: true,
  notifyTeamGoal: true,
  notifyMilestone: false,
  notifyOverdue: true,
  overdueThreshold: 10,
};

const PROFILE_FIELDS = new Set<string>([
  "ownerDisplayName",
  "businessName",
  "profileEmail",
  "businessPhone",
  "businessWebsite",
  "businessAddress",
  "gstin",
  "paymentInstructions",
]);

const CRM_FIELDS = new Set<string>(["businessTimezone", "currencyCode", "defaultLeadSort"]);

const NOTIFICATION_FIELDS = new Set<string>([
  "notifyFollowUps",
  "notifyPayments",
  "notifyDigest",
  "notifyGoalAchieved",
  "notifyTeamGoal",
  "notifyMilestone",
  "notifyOverdue",
  "overdueThreshold",
]);

function rowToSnapshot(row: OwnerSettingsRow): SettingsSnapshotFields {
  return {
    ownerDisplayName: row.ownerDisplayName ?? null,
    businessName: row.businessName ?? null,
    profileEmail: row.profileEmail ?? null,
    businessPhone: row.businessPhone ?? null,
    businessWebsite: row.businessWebsite ?? null,
    businessAddress: row.businessAddress ?? null,
    gstin: row.gstin ?? null,
    paymentInstructions: row.paymentInstructions ?? null,
    businessTimezone: BUSINESS_TIMEZONE_FIXED,
    currencyCode: CURRENCY_CODE_FIXED,
    defaultLeadSort: (row.defaultLeadSort as DefaultLeadSort) || "recent",
    notifyFollowUps: Boolean(row.notifyFollowUps),
    notifyPayments: Boolean(row.notifyPayments),
    notifyDigest: Boolean(row.notifyDigest),
    notifyGoalAchieved: Boolean(row.notifyGoalAchieved),
    notifyTeamGoal: Boolean(row.notifyTeamGoal),
    notifyMilestone: Boolean(row.notifyMilestone),
    notifyOverdue: Boolean(row.notifyOverdue),
    overdueThreshold: Number(row.overdueThreshold ?? 10),
  };
}

function toOwnerSettingsDto(
  ownerUserId: string,
  row: OwnerSettingsRow | undefined,
): OwnerSettingsDto {
  if (!row) {
    return {
      configured: false,
      id: null,
      ownerUserId,
      ...DEFAULT_UNSET_FIELDS,
      updatedByUserId: null,
      version: 0,
      createdAt: null,
      updatedAt: null,
    };
  }
  const snap = rowToSnapshot(row);
  return {
    configured: true,
    id: row.id,
    ownerUserId: row.ownerUserId,
    ...snap,
    updatedByUserId: row.updatedByUserId,
    version: row.version,
    createdAt: parseUtcDateTime(row.createdAt).toISOString(),
    updatedAt: parseUtcDateTime(row.updatedAt).toISOString(),
  };
}

function parseJsonObjectSafe(raw: string | null | undefined): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function parseJsonArraySafe(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function toSettingsAuditEventDto(row: SettingsAuditEventRow): SettingsAuditEventDto {
  return {
    id: row.id,
    settingsId: row.settingsId,
    ownerUserId: row.ownerUserId,
    actorUserId: row.actorUserId,
    section: row.section,
    eventType: row.eventType,
    summary: row.summary,
    changedFields: parseJsonArraySafe(row.changedFieldsJson),
    before: parseJsonObjectSafe(row.beforeJson),
    after: parseJsonObjectSafe(row.afterJson) ?? {},
    versionBefore: row.versionBefore,
    versionAfter: row.versionAfter,
    occurredIstDate: row.occurredIstDate,
    createdAt: parseUtcDateTime(row.createdAt).toISOString(),
  };
}

function classifyChangedSection(
  changedFields: readonly string[],
): "profile" | "crm" | "notifications" | "mixed" {
  let hasProfile = false;
  let hasCrm = false;
  let hasNotify = false;
  for (const field of changedFields) {
    if (PROFILE_FIELDS.has(field)) hasProfile = true;
    else if (CRM_FIELDS.has(field)) hasCrm = true;
    else if (NOTIFICATION_FIELDS.has(field)) hasNotify = true;
  }
  const activeCount = Number(hasProfile) + Number(hasCrm) + Number(hasNotify);
  if (activeCount !== 1) return "mixed";
  if (hasProfile) return "profile";
  if (hasCrm) return "crm";
  return "notifications";
}

async function assertSettingsAffectedRow(
  resultPromise: Promise<unknown>,
  settingsId: string,
): Promise<void> {
  const res = (await resultPromise) as
    [{ affectedRows?: number }, unknown] | { affectedRows?: number };
  const affectedRows = Array.isArray(res) ? res[0]?.affectedRows : res?.affectedRows;
  if (affectedRows !== 1) {
    throw new CrmServiceError(
      409,
      "stale_conflict",
      "Settings were modified concurrently; reload and retry.",
      { conflict: { resource: "settings", id: settingsId } },
    );
  }
}

export async function getOwnerSettingsRecord(
  db: CrmDatabase,
  ownerUserId: string,
): Promise<OwnerSettingsDto> {
  const rows = await db
    .select()
    .from(crmOwnerSettings)
    .where(eq(crmOwnerSettings.ownerUserId, ownerUserId))
    .limit(1);

  return toOwnerSettingsDto(ownerUserId, rows[0]);
}

export async function updateOwnerSettingsRecord(
  db: CrmDatabase,
  ownerUserId: string,
  actorUserId: string,
  input: UpdateSettingsInput,
  options?: {
    idempotencyKey?: string | null | undefined;
    now?: Date | undefined;
    hooks?: { afterPrimaryWrite?: () => void } | undefined;
  },
): Promise<{
  status: number;
  replayed: boolean;
  body: {
    ok: true;
    settings: OwnerSettingsDto;
    auditEvent: SettingsAuditEventDto | null;
    changed: boolean;
  };
}> {
  const now = options?.now ?? new Date();
  const idemKey = options?.idempotencyKey ?? input.idempotencyKey ?? null;
  const scope = "settings:update";
  const requestHash = hashIdempotentRequest(scope, {
    ownerDisplayName: input.ownerDisplayName,
    businessName: input.businessName,
    profileEmail: input.profileEmail,
    businessPhone: input.businessPhone,
    businessWebsite: input.businessWebsite,
    businessAddress: input.businessAddress,
    gstin: input.gstin,
    paymentInstructions: input.paymentInstructions,
    businessTimezone: input.businessTimezone,
    currencyCode: input.currencyCode,
    defaultLeadSort: input.defaultLeadSort,
    notifyFollowUps: input.notifyFollowUps,
    notifyPayments: input.notifyPayments,
    notifyDigest: input.notifyDigest,
    notifyGoalAchieved: input.notifyGoalAchieved,
    notifyTeamGoal: input.notifyTeamGoal,
    notifyMilestone: input.notifyMilestone,
    notifyOverdue: input.notifyOverdue,
    overdueThreshold: input.overdueThreshold,
    expectedVersion: input.expectedVersion ?? null,
  });

  try {
    return await runWithIdempotency<{
      ok: true;
      settings: OwnerSettingsDto;
      auditEvent: SettingsAuditEventDto | null;
      changed: boolean;
    }>(db, { ownerUserId, scope, idemKey, requestHash, now }, async (tx) => {
      const existingRows = await tx
        .select()
        .from(crmOwnerSettings)
        .where(eq(crmOwnerSettings.ownerUserId, ownerUserId))
        .limit(1)
        .for("update");

      const current = existingRows[0];
      const nowStr = toMysqlUtcDateTime(now);
      const ist = toIstParts(now);

      if (!current) {
        if (input.expectedVersion !== undefined && input.expectedVersion !== 0) {
          throw new CrmServiceError(
            409,
            "stale_conflict",
            "Settings were not initialized at the expected version; reload and retry.",
            {
              conflict: {
                resource: "settings",
                expectedVersion: input.expectedVersion,
                currentVersion: 0,
              },
            },
          );
        }

        const nextSnap: SettingsSnapshotFields = {
          ownerDisplayName: input.ownerDisplayName !== undefined ? input.ownerDisplayName : null,
          businessName: input.businessName !== undefined ? input.businessName : null,
          profileEmail: input.profileEmail !== undefined ? input.profileEmail : null,
          businessPhone: input.businessPhone !== undefined ? input.businessPhone : null,
          businessWebsite: input.businessWebsite !== undefined ? input.businessWebsite : null,
          businessAddress: input.businessAddress !== undefined ? input.businessAddress : null,
          gstin: input.gstin !== undefined ? input.gstin : null,
          paymentInstructions:
            input.paymentInstructions !== undefined ? input.paymentInstructions : null,
          businessTimezone: BUSINESS_TIMEZONE_FIXED,
          currencyCode: CURRENCY_CODE_FIXED,
          defaultLeadSort: input.defaultLeadSort ?? "recent",
          notifyFollowUps: input.notifyFollowUps ?? true,
          notifyPayments: input.notifyPayments ?? true,
          notifyDigest: input.notifyDigest ?? false,
          notifyGoalAchieved: input.notifyGoalAchieved ?? true,
          notifyTeamGoal: input.notifyTeamGoal ?? true,
          notifyMilestone: input.notifyMilestone ?? false,
          notifyOverdue: input.notifyOverdue ?? true,
          overdueThreshold: input.overdueThreshold ?? 10,
        };

        const createdFields = UPDATABLE_SETTINGS_FIELDS.filter((f) => input[f] !== undefined);
        const settingsId = generateServerId("set");
        const createdRow: OwnerSettingsRow = {
          id: settingsId,
          ownerUserId,
          ...nextSnap,
          updatedByUserId: actorUserId,
          version: 1,
          createdAt: nowStr,
          updatedAt: nowStr,
        };

        await tx.insert(crmOwnerSettings).values(createdRow);

        // Internal test hook strictly for verifying atomic transaction rollback.
        options?.hooks?.afterPrimaryWrite?.();

        const section = classifyChangedSection(createdFields);
        const auditRow: SettingsAuditEventRow = {
          id: generateServerId("sae"),
          settingsId,
          ownerUserId,
          actorUserId,
          section,
          eventType: "settings.created",
          summary: `Business settings initialized (${createdFields.join(", ")})`,
          changedFieldsJson: JSON.stringify(createdFields),
          beforeJson: null,
          afterJson: JSON.stringify(nextSnap),
          versionBefore: 0,
          versionAfter: 1,
          occurredIstDate: ist.istDate,
          createdAt: nowStr,
        };
        await tx.insert(crmSettingsAuditEvents).values(auditRow);

        return {
          status: 201,
          resourceId: settingsId,
          body: {
            ok: true as const,
            settings: toOwnerSettingsDto(ownerUserId, createdRow),
            auditEvent: toSettingsAuditEventDto(auditRow),
            changed: true,
          },
        };
      }

      if (input.expectedVersion !== undefined && current.version !== input.expectedVersion) {
        throw new CrmServiceError(
          409,
          "stale_conflict",
          "Settings were modified concurrently; reload and retry.",
          {
            conflict: {
              resource: "settings",
              id: current.id,
              expectedVersion: input.expectedVersion,
              currentVersion: current.version,
            },
          },
        );
      }

      const beforeSnap = rowToSnapshot(current);
      const afterSnap: SettingsSnapshotFields = {
        ownerDisplayName:
          input.ownerDisplayName !== undefined
            ? input.ownerDisplayName
            : beforeSnap.ownerDisplayName,
        businessName:
          input.businessName !== undefined ? input.businessName : beforeSnap.businessName,
        profileEmail:
          input.profileEmail !== undefined ? input.profileEmail : beforeSnap.profileEmail,
        businessPhone:
          input.businessPhone !== undefined ? input.businessPhone : beforeSnap.businessPhone,
        businessWebsite:
          input.businessWebsite !== undefined ? input.businessWebsite : beforeSnap.businessWebsite,
        businessAddress:
          input.businessAddress !== undefined ? input.businessAddress : beforeSnap.businessAddress,
        gstin: input.gstin !== undefined ? input.gstin : beforeSnap.gstin,
        paymentInstructions:
          input.paymentInstructions !== undefined
            ? input.paymentInstructions
            : beforeSnap.paymentInstructions,
        businessTimezone: BUSINESS_TIMEZONE_FIXED,
        currencyCode: CURRENCY_CODE_FIXED,
        defaultLeadSort: input.defaultLeadSort ?? beforeSnap.defaultLeadSort,
        notifyFollowUps: input.notifyFollowUps ?? beforeSnap.notifyFollowUps,
        notifyPayments: input.notifyPayments ?? beforeSnap.notifyPayments,
        notifyDigest: input.notifyDigest ?? beforeSnap.notifyDigest,
        notifyGoalAchieved: input.notifyGoalAchieved ?? beforeSnap.notifyGoalAchieved,
        notifyTeamGoal: input.notifyTeamGoal ?? beforeSnap.notifyTeamGoal,
        notifyMilestone: input.notifyMilestone ?? beforeSnap.notifyMilestone,
        notifyOverdue: input.notifyOverdue ?? beforeSnap.notifyOverdue,
        overdueThreshold: input.overdueThreshold ?? beforeSnap.overdueThreshold,
      };

      const changedFields = UPDATABLE_SETTINGS_FIELDS.filter((f) => beforeSnap[f] !== afterSnap[f]);

      if (changedFields.length === 0) {
        options?.hooks?.afterPrimaryWrite?.();
        return {
          status: 200,
          resourceId: current.id,
          body: {
            ok: true as const,
            settings: toOwnerSettingsDto(ownerUserId, current),
            auditEvent: null,
            changed: false,
          },
        };
      }

      const nextVersion = current.version + 1;
      const updRes = await tx
        .update(crmOwnerSettings)
        .set({
          ...afterSnap,
          updatedByUserId: actorUserId,
          version: nextVersion,
          updatedAt: nowStr,
        })
        .where(
          and(
            eq(crmOwnerSettings.id, current.id),
            eq(crmOwnerSettings.ownerUserId, ownerUserId),
            eq(crmOwnerSettings.version, current.version),
          ),
        );
      await assertSettingsAffectedRow(Promise.resolve(updRes), current.id);

      options?.hooks?.afterPrimaryWrite?.();

      const section = classifyChangedSection(changedFields);
      const auditRow: SettingsAuditEventRow = {
        id: generateServerId("sae"),
        settingsId: current.id,
        ownerUserId,
        actorUserId,
        section,
        eventType: "settings.updated",
        summary: `Business settings updated (${changedFields.join(", ")})`,
        changedFieldsJson: JSON.stringify(changedFields),
        beforeJson: JSON.stringify(beforeSnap),
        afterJson: JSON.stringify(afterSnap),
        versionBefore: current.version,
        versionAfter: nextVersion,
        occurredIstDate: ist.istDate,
        createdAt: nowStr,
      };
      await tx.insert(crmSettingsAuditEvents).values(auditRow);

      const updatedRow: OwnerSettingsRow = {
        ...current,
        ...afterSnap,
        updatedByUserId: actorUserId,
        version: nextVersion,
        updatedAt: nowStr,
      };

      return {
        status: 200,
        resourceId: current.id,
        body: {
          ok: true as const,
          settings: toOwnerSettingsDto(ownerUserId, updatedRow),
          auditEvent: toSettingsAuditEventDto(auditRow),
          changed: true,
        },
      };
    });
  } catch (error) {
    if (error instanceof CrmServiceError) throw error;
    if (isMysqlDuplicateKeyError(error)) {
      throw new CrmServiceError(
        409,
        "stale_conflict",
        "Settings were initialized concurrently; reload and retry.",
        { conflict: { resource: "settings" } },
      );
    }
    throw error;
  }
}

export async function listSettingsAuditEventsRecord(
  db: CrmDatabase,
  ownerUserId: string,
  query: ListSettingsAuditQuery,
): Promise<{
  items: SettingsAuditEventDto[];
  total: number;
  limit: number;
  offset: number;
}> {
  const predicates: SQL[] = [eq(crmSettingsAuditEvents.ownerUserId, ownerUserId)];
  if (query.section !== "all") {
    predicates.push(eq(crmSettingsAuditEvents.section, query.section));
  }
  const whereClause = and(...predicates);

  const [countRes] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(crmSettingsAuditEvents)
    .where(whereClause);
  const total = Number(countRes?.count ?? 0);

  const rows =
    total === 0
      ? []
      : await db
          .select()
          .from(crmSettingsAuditEvents)
          .where(whereClause)
          .orderBy(desc(crmSettingsAuditEvents.createdAt), desc(crmSettingsAuditEvents.id))
          .limit(query.limit)
          .offset(query.offset);

  return {
    items: rows.map(toSettingsAuditEventDto),
    total,
    limit: query.limit,
    offset: query.offset,
  };
}

export function getSettingsDefinitionsRecord() {
  return {
    ok: true as const,
    definitions: {
      invariants: {
        businessTimezone: BUSINESS_TIMEZONE_FIXED,
        currencyCode: CURRENCY_CODE_FIXED,
        readOnly: true,
      },
      leadStatuses: [...LEAD_STATUSES],
      leadSources: [...LEAD_SOURCES],
      defaultLeadSortOptions: [...DEFAULT_LEAD_SORTS],
      goalMetrics: GOAL_METRIC_DEFINITIONS.map((m) => ({ ...m })),
      goalPeriods: [...GOAL_PERIODS],
      goalScopes: [
        {
          key: "owner",
          supported: true,
          description: "Owner workspace activity & revenue goals.",
        },
        {
          key: "team",
          supported: true,
          description: "Organization-wide goal evaluated across the Owner's workspace records.",
        },
        {
          key: "employee",
          supported: false,
          description:
            "Per-employee attribution requires Team CRM authentication (not yet enabled).",
        },
      ],
      serverBackedFields: [...UPDATABLE_SETTINGS_FIELDS],
      deviceLocalPreferences: [
        "theme",
        "accent",
        "density",
        "timeFormat",
        "dateStyle",
        "scale-flow-sidebar-collapsed",
        "scale-flow-sidebar-groups",
        "briefingDone",
        "briefingDate",
        "viewPrefs",
      ],
      existingTemplateEndpoints: {
        quotationTemplates: "/api/v1/quotation-templates",
        projectTemplates: "/api/v1/project-templates",
      },
      deferredModules: [
        "customFieldsCrud",
        "tagsCrud",
        "savedViews",
        "whatsappTemplatesLibrary",
        "demoLinksLibrary",
        "analyticsForecastConfig",
        "teamUsersAndRbac",
        "automationRules",
      ],
    },
  };
}
