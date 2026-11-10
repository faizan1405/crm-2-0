import "@tanstack/react-start/server-only";
import { and, asc, eq, max } from "drizzle-orm";
import type { CrmDatabase } from "../db/index.server";
import { crmCustomFields, crmLeadFieldValues, crmLeads } from "../db/schema.server";
import { toMysqlUtcDateTime } from "../db/utc.server";
import { mysqlUtcToIso } from "./dates.server";
import { CrmServiceError } from "./errors.server";
import {
  hashIdempotentRequest,
  runWithIdempotency,
  type CrmDbExecutor,
  type CrmTransaction,
} from "./idempotency.server";
import {
  convertFieldValue,
  generateFieldId,
  isChoiceType,
  parseCustomFieldValue,
  validateCustomFieldDef,
  type CreateCustomFieldInput,
  type CustomFieldValue,
  type FieldType,
  type StoredOption,
  type UpdateCustomFieldInput,
} from "./customFieldsValidation.server";
import { syncLeadFieldValuesInTx } from "./customFieldsSupport.server";

export interface CustomFieldDto {
  id: string;
  entity: "lead" | "project";
  label: string;
  type: FieldType;
  description?: string | undefined;
  required: boolean;
  defaultValue?: unknown;
  options: StoredOption[];
  order: number;
  status: "active" | "archived";
  highlight: boolean;
  visibility: "team" | "owner";
  editable: "team" | "owner";
  currency?: string | undefined;
  createdAt: string;
  updatedAt: string;
  version: number;
  history: Array<{ at: string; change: string }>;
}

export function toCustomFieldDto(row: typeof crmCustomFields.$inferSelect): CustomFieldDto {
  let options: StoredOption[] = [];
  try {
    options = JSON.parse(row.optionsJson) as StoredOption[];
  } catch {
    options = [];
  }

  let defaultValue: unknown = undefined;
  if (row.defaultValueJson) {
    try {
      defaultValue = JSON.parse(row.defaultValueJson);
    } catch {
      defaultValue = row.defaultValueJson;
    }
  }

  let history: Array<{ at: string; change: string }> = [];
  try {
    history = JSON.parse(row.historyJson) as Array<{ at: string; change: string }>;
  } catch {
    history = [];
  }

  return {
    id: row.id,
    entity: (row.entity as "lead" | "project") || "lead",
    label: row.label,
    type: row.fieldType as FieldType,
    ...(row.description ? { description: row.description } : {}),
    required: row.required,
    ...(defaultValue !== undefined ? { defaultValue } : {}),
    options,
    order: row.sortOrder,
    status: (row.status as "active" | "archived") || "active",
    highlight: row.highlight,
    visibility: (row.visibility as "team" | "owner") || "team",
    editable: (row.editable as "team" | "owner") || "team",
    ...(row.currency ? { currency: row.currency } : {}),
    createdAt: mysqlUtcToIso(row.createdAt) ?? row.createdAt,
    updatedAt: mysqlUtcToIso(row.updatedAt) ?? row.updatedAt,
    version: row.version,
    history,
  };
}

export async function listCustomFieldsRecord(
  db: CrmDbExecutor,
  ownerUserId: string,
  entity: "lead" | "project" = "lead",
): Promise<CustomFieldDto[]> {
  const rows = await db
    .select()
    .from(crmCustomFields)
    .where(and(eq(crmCustomFields.ownerUserId, ownerUserId), eq(crmCustomFields.entity, entity)))
    .orderBy(asc(crmCustomFields.sortOrder), asc(crmCustomFields.createdAt));

  return rows.map(toCustomFieldDto);
}

export async function getCustomFieldRecord(
  db: CrmDbExecutor,
  ownerUserId: string,
  fieldId: string,
): Promise<CustomFieldDto> {
  const rows = await db
    .select()
    .from(crmCustomFields)
    .where(and(eq(crmCustomFields.ownerUserId, ownerUserId), eq(crmCustomFields.id, fieldId)))
    .limit(1);

  const row = rows[0];
  if (!row) {
    throw new CrmServiceError(404, "not_found", `Custom field "${fieldId}" not found.`);
  }

  return toCustomFieldDto(row);
}

export async function createCustomFieldRecord(
  db: CrmDatabase,
  ownerUserId: string,
  input: CreateCustomFieldInput,
  now: Date = new Date(),
): Promise<{ status: number; replayed: boolean; body: { ok: true; field: CustomFieldDto } }> {
  const entity = input.entity ?? "lead";
  const idemKey = input.idempotencyKey ?? null;
  const requestHash = hashIdempotentRequest(`custom_field:create:${ownerUserId}`, input);

  return runWithIdempotency<{ ok: true; field: CustomFieldDto }>(
    db,
    {
      ownerUserId,
      scope: `custom_field:create:${ownerUserId}`,
      idemKey,
      requestHash,
      now,
    },
    async (tx) => {
      const existing = await tx
        .select({
          id: crmCustomFields.id,
          label: crmCustomFields.label,
          status: crmCustomFields.status,
          sortOrder: crmCustomFields.sortOrder,
        })
        .from(crmCustomFields)
        .where(
          and(eq(crmCustomFields.ownerUserId, ownerUserId), eq(crmCustomFields.entity, entity)),
        );

      const normalizedOptions = input.options?.map((o) => ({
        id: o.id,
        label: o.label,
        ...(o.archived !== undefined ? { archived: o.archived } : {}),
      }));

      const fieldDefErr = validateCustomFieldDef({
        id: input.id,
        label: input.label,
        type: input.type,
        entity,
        visibility: input.visibility,
        editable: input.editable,
        options: normalizedOptions,
        defaultValue: input.defaultValue,
        currency: input.currency,
        existingFields: existing,
      });
      if (fieldDefErr) {
        throw new CrmServiceError(400, "validation_error", fieldDefErr);
      }

      const existingIds = existing.map((f) => f.id);
      const fieldId = input.id ?? generateFieldId(input.label, existingIds);

      if (existingIds.includes(fieldId)) {
        throw new CrmServiceError(
          400,
          "validation_error",
          `A custom field with id "${fieldId}" already exists.`,
        );
      }

      const maxOrder = existing.length > 0 ? Math.max(...existing.map((f) => f.sortOrder)) : -1;
      const sortOrder = input.order !== undefined && input.order !== 0 ? input.order : maxOrder + 1;

      const nowStr = toMysqlUtcDateTime(now);
      const nowIso = now.toISOString();

      const initialHistory = [{ at: nowIso, change: "Created" }];

      const newRow = {
        id: fieldId,
        legacyId: null,
        ownerUserId,
        entity,
        label: input.label.trim(),
        fieldType: input.type,
        description: input.description?.trim() || null,
        required: input.required ?? false,
        defaultValueJson:
          input.defaultValue !== undefined ? JSON.stringify(input.defaultValue) : null,
        optionsJson: JSON.stringify(input.options ?? []),
        sortOrder,
        status: "active",
        highlight: input.highlight ?? false,
        visibility: input.visibility ?? "team",
        editable: input.editable ?? "team",
        currency: input.currency?.trim() || (input.type === "currency" ? "INR" : null),
        historyJson: JSON.stringify(initialHistory),
        version: 1,
        createdAt: nowStr,
        updatedAt: nowStr,
      };

      await tx.insert(crmCustomFields).values(newRow);

      return {
        status: 201,
        resourceId: fieldId,
        body: {
          ok: true,
          field: toCustomFieldDto(newRow),
        },
      };
    },
  );
}

export async function updateCustomFieldRecord(
  db: CrmDatabase,
  ownerUserId: string,
  fieldId: string,
  input: UpdateCustomFieldInput,
  now: Date = new Date(),
): Promise<{ ok: true; field: CustomFieldDto }> {
  return db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(crmCustomFields)
      .where(and(eq(crmCustomFields.ownerUserId, ownerUserId), eq(crmCustomFields.id, fieldId)))
      .limit(1)
      .for("update");

    const current = rows[0];
    if (!current) {
      throw new CrmServiceError(404, "not_found", `Custom field "${fieldId}" not found.`);
    }

    if (input.expectedVersion !== undefined && current.version !== input.expectedVersion) {
      throw new CrmServiceError(
        409,
        "stale_conflict",
        "Custom field was modified by another request; reload and retry.",
        {
          conflict: {
            resource: "custom_field",
            id: current.id,
            expectedVersion: input.expectedVersion,
            currentVersion: current.version,
          },
        },
      );
    }

    const nextLabel = input.label !== undefined ? input.label.trim() : current.label;
    const nextType = input.type !== undefined ? input.type : (current.fieldType as FieldType);
    const nextEntity = (current.entity as "lead" | "project") || "lead";
    const nextVisibility =
      input.visibility !== undefined ? input.visibility : (current.visibility as "team" | "owner");
    const nextEditable =
      input.editable !== undefined ? input.editable : (current.editable as "team" | "owner");

    let currentOptions: StoredOption[] = [];
    try {
      currentOptions = JSON.parse(current.optionsJson) as StoredOption[];
    } catch {
      currentOptions = [];
    }
    const nextOptions: StoredOption[] =
      input.options !== undefined
        ? input.options.map((o) => ({
            id: o.id,
            label: o.label,
            ...(o.archived !== undefined ? { archived: o.archived } : {}),
          }))
        : currentOptions;

    // Check duplicate active name among other fields
    const otherFields = await tx
      .select({
        id: crmCustomFields.id,
        label: crmCustomFields.label,
        status: crmCustomFields.status,
      })
      .from(crmCustomFields)
      .where(
        and(eq(crmCustomFields.ownerUserId, ownerUserId), eq(crmCustomFields.entity, nextEntity)),
      );

    const validationErr = validateCustomFieldDef({
      id: fieldId,
      label: nextLabel,
      type: nextType,
      entity: nextEntity,
      visibility: nextVisibility,
      editable: nextEditable,
      options: nextOptions,
      defaultValue: input.defaultValue,
      currency: input.currency ?? current.currency,
      existingFields: otherFields,
    });
    if (validationErr) {
      throw new CrmServiceError(400, "validation_error", validationErr);
    }

    // Check removed options that might be in use
    if (input.options !== undefined && isChoiceType(current.fieldType as FieldType)) {
      const nextOptionIds = new Set(nextOptions.filter((o) => !o.archived).map((o) => o.id));
      const removedActive = currentOptions.filter((o) => !o.archived && !nextOptionIds.has(o.id));

      if (removedActive.length > 0) {
        // Query if any lead values use these removed options
        const valRows = await tx
          .select({ valueJson: crmLeadFieldValues.valueJson })
          .from(crmLeadFieldValues)
          .where(
            and(
              eq(crmLeadFieldValues.ownerUserId, ownerUserId),
              eq(crmLeadFieldValues.fieldId, fieldId),
            ),
          );

        for (const rem of removedActive) {
          let count = 0;
          for (const vr of valRows) {
            try {
              const parsedVal = JSON.parse(vr.valueJson);
              if (
                parsedVal === rem.id ||
                (Array.isArray(parsedVal) && parsedVal.includes(rem.id))
              ) {
                count++;
              }
            } catch {
              if (vr.valueJson === rem.id) count++;
            }
          }
          if (count > 0) {
            throw new CrmServiceError(
              400,
              "validation_error",
              `Option “${rem.label}” (${count} ${count > 1 ? "leads" : "lead"}) is in use — archive it instead of deleting it.`,
            );
          }
        }
      }
    }

    // Check type change impact
    if (input.type !== undefined && input.type !== current.fieldType) {
      const valRows = await tx
        .select({
          id: crmLeadFieldValues.id,
          leadId: crmLeadFieldValues.leadId,
          valueJson: crmLeadFieldValues.valueJson,
        })
        .from(crmLeadFieldValues)
        .where(
          and(
            eq(crmLeadFieldValues.ownerUserId, ownerUserId),
            eq(crmLeadFieldValues.fieldId, fieldId),
          ),
        );

      const fromDef = {
        fieldType: current.fieldType as FieldType,
        options: currentOptions,
        currency: current.currency,
      };
      const toDef = {
        fieldType: nextType,
        options: nextOptions,
        currency: input.currency ?? current.currency ?? "INR",
      };

      const incompatibleLeadIds: string[] = [];
      const conversions: Array<{ id: string; newVal: unknown }> = [];

      for (const row of valRows) {
        let parsed: unknown;
        try {
          parsed = JSON.parse(row.valueJson);
        } catch {
          parsed = row.valueJson;
        }

        const converted = convertFieldValue(parsed, fromDef, toDef);
        if (converted === undefined) {
          incompatibleLeadIds.push(row.leadId);
        } else {
          conversions.push({ id: row.id, newVal: converted });
        }
      }

      if (incompatibleLeadIds.length > 0) {
        throw new CrmServiceError(
          400,
          "validation_error",
          `${incompatibleLeadIds.length} ${incompatibleLeadIds.length > 1 ? "leads have values" : "lead has a value"} that can't become ${nextType}. Nothing was changed.`,
        );
      }

      // Convert all stored values
      const nowStr = toMysqlUtcDateTime(now);
      for (const conv of conversions) {
        await tx
          .update(crmLeadFieldValues)
          .set({
            valueJson: JSON.stringify(conv.newVal),
            updatedAt: nowStr,
          })
          .where(eq(crmLeadFieldValues.id, conv.id));
      }
    }

    // Build change history
    const changes: string[] = [];
    if (nextLabel !== current.label) {
      changes.push(`Renamed from “${current.label}”`);
    }
    if (nextType !== current.fieldType) {
      changes.push(`Type ${current.fieldType} → ${nextType}`);
    }
    if (input.required !== undefined && input.required !== current.required) {
      changes.push(input.required ? "Now required" : "Now optional");
    }
    if (
      (input.visibility !== undefined && input.visibility !== current.visibility) ||
      (input.editable !== undefined && input.editable !== current.editable)
    ) {
      changes.push("Visibility changed");
    }
    if (input.options !== undefined && JSON.stringify(nextOptions) !== current.optionsJson) {
      changes.push("Options changed");
    }

    let history: Array<{ at: string; change: string }> = [];
    try {
      history = JSON.parse(current.historyJson) as Array<{ at: string; change: string }>;
    } catch {
      history = [];
    }
    history.push({
      at: now.toISOString(),
      change: changes.join(" · ") || "Edited",
    });
    if (history.length > 50) {
      history = history.slice(-50);
    }

    const nowStr = toMysqlUtcDateTime(now);
    const nextVersion = current.version + 1;

    const nextRequired = input.required !== undefined ? input.required : current.required;
    const nextDescription =
      input.description !== undefined ? input.description?.trim() || null : current.description;
    const nextOrder = input.order !== undefined ? input.order : current.sortOrder;
    const nextHighlight = input.highlight !== undefined ? input.highlight : current.highlight;
    const nextCurrency =
      input.currency !== undefined ? input.currency?.trim() || null : current.currency;
    const nextDefaultValue =
      input.defaultValue !== undefined
        ? JSON.stringify(input.defaultValue)
        : current.defaultValueJson;

    await tx
      .update(crmCustomFields)
      .set({
        label: nextLabel,
        fieldType: nextType,
        description: nextDescription,
        required: nextRequired,
        defaultValueJson: nextDefaultValue,
        optionsJson: JSON.stringify(nextOptions),
        sortOrder: nextOrder,
        highlight: nextHighlight,
        visibility: nextVisibility,
        editable: nextEditable,
        currency: nextCurrency,
        historyJson: JSON.stringify(history),
        version: nextVersion,
        updatedAt: nowStr,
      })
      .where(
        and(
          eq(crmCustomFields.ownerUserId, ownerUserId),
          eq(crmCustomFields.id, fieldId),
          eq(crmCustomFields.version, current.version),
        ),
      );

    const updatedRow = {
      ...current,
      label: nextLabel,
      fieldType: nextType,
      description: nextDescription,
      required: nextRequired,
      defaultValueJson: nextDefaultValue,
      optionsJson: JSON.stringify(nextOptions),
      sortOrder: nextOrder,
      highlight: nextHighlight,
      visibility: nextVisibility,
      editable: nextEditable,
      currency: nextCurrency,
      historyJson: JSON.stringify(history),
      version: nextVersion,
      updatedAt: nowStr,
    };

    return {
      ok: true,
      field: toCustomFieldDto(updatedRow),
    };
  });
}

export async function archiveCustomFieldRecord(
  db: CrmDatabase,
  ownerUserId: string,
  fieldId: string,
  expectedVersion?: number,
  now: Date = new Date(),
): Promise<{ ok: true; field: CustomFieldDto }> {
  return db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(crmCustomFields)
      .where(and(eq(crmCustomFields.ownerUserId, ownerUserId), eq(crmCustomFields.id, fieldId)))
      .limit(1)
      .for("update");

    const current = rows[0];
    if (!current) {
      throw new CrmServiceError(404, "not_found", `Custom field "${fieldId}" not found.`);
    }

    if (current.status === "archived") {
      return { ok: true, field: toCustomFieldDto(current) };
    }

    if (expectedVersion !== undefined && current.version !== expectedVersion) {
      throw new CrmServiceError(
        409,
        "stale_conflict",
        "Custom field was modified by another request; reload and retry.",
        {
          conflict: {
            resource: "custom_field",
            id: current.id,
            expectedVersion,
            currentVersion: current.version,
          },
        },
      );
    }

    let history: Array<{ at: string; change: string }> = [];
    try {
      history = JSON.parse(current.historyJson) as Array<{ at: string; change: string }>;
    } catch {
      history = [];
    }
    history.push({
      at: now.toISOString(),
      change: "Archived",
    });
    if (history.length > 50) {
      history = history.slice(-50);
    }

    const nowStr = toMysqlUtcDateTime(now);
    const nextVersion = current.version + 1;

    await tx
      .update(crmCustomFields)
      .set({
        status: "archived",
        historyJson: JSON.stringify(history),
        version: nextVersion,
        updatedAt: nowStr,
      })
      .where(
        and(
          eq(crmCustomFields.ownerUserId, ownerUserId),
          eq(crmCustomFields.id, fieldId),
          eq(crmCustomFields.version, current.version),
        ),
      );

    const updatedRow = {
      ...current,
      status: "archived",
      historyJson: JSON.stringify(history),
      version: nextVersion,
      updatedAt: nowStr,
    };

    return {
      ok: true,
      field: toCustomFieldDto(updatedRow),
    };
  });
}

export async function getLeadCustomFieldValuesRecord(
  db: CrmDbExecutor,
  ownerUserId: string,
  leadId: string,
): Promise<{ leadId: string; values: Record<string, unknown> }> {
  // Check lead exists
  const leadRows = await db
    .select({ id: crmLeads.id })
    .from(crmLeads)
    .where(and(eq(crmLeads.ownerUserId, ownerUserId), eq(crmLeads.id, leadId)))
    .limit(1);

  if (leadRows.length === 0) {
    throw new CrmServiceError(404, "not_found", `Lead "${leadId}" not found.`);
  }

  const valRows = await db
    .select({
      fieldId: crmLeadFieldValues.fieldId,
      valueJson: crmLeadFieldValues.valueJson,
    })
    .from(crmLeadFieldValues)
    .where(
      and(eq(crmLeadFieldValues.ownerUserId, ownerUserId), eq(crmLeadFieldValues.leadId, leadId)),
    );

  const values: Record<string, unknown> = {};
  for (const vr of valRows) {
    try {
      values[vr.fieldId] = JSON.parse(vr.valueJson);
    } catch {
      values[vr.fieldId] = vr.valueJson;
    }
  }

  return { leadId, values };
}

export async function setLeadCustomFieldValuesRecord(
  db: CrmDatabase,
  ownerUserId: string,
  leadId: string,
  valuesInput: Record<string, unknown>,
  now: Date = new Date(),
): Promise<{ ok: true; leadId: string; values: Record<string, unknown> }> {
  return db.transaction(async (tx) => {
    const leadRows = await tx
      .select({ id: crmLeads.id, lifecycleStatus: crmLeads.lifecycleStatus })
      .from(crmLeads)
      .where(and(eq(crmLeads.ownerUserId, ownerUserId), eq(crmLeads.id, leadId)))
      .limit(1)
      .for("update");

    const lead = leadRows[0];
    if (!lead) {
      throw new CrmServiceError(404, "not_found", `Lead "${leadId}" not found.`);
    }

    if (lead.lifecycleStatus !== "active") {
      throw new CrmServiceError(
        400,
        "validation_error",
        "Cannot update custom fields on an archived lead.",
      );
    }

    const updatedMap = await syncLeadFieldValuesInTx(tx, {
      ownerUserId,
      leadId,
      input: valuesInput,
      isNew: false,
      now,
    });

    return {
      ok: true,
      leadId,
      values: updatedMap,
    };
  });
}
