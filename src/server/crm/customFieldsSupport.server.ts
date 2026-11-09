import "@tanstack/react-start/server-only";
import { and, asc, eq, inArray } from "drizzle-orm";
import { crmCustomFields, crmLeadFieldValues, crmLeadTags, crmTagDefs } from "../db/schema.server";
import { toMysqlUtcDateTime } from "../db/utc.server";
import { generateServerId } from "../auth/security.server";
import { CrmServiceError } from "./errors.server";
import type { CrmDbExecutor, CrmTransaction } from "./idempotency.server";
import { isValidCalendarDay } from "./dates.server";

interface StoredFieldOption {
  id: string;
  label: string;
  archived?: boolean;
}

const CUSTOM_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function parseCustomFieldOptions(rawJson: string): StoredFieldOption[] {
  try {
    const parsed = JSON.parse(rawJson);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is StoredFieldOption =>
        Boolean(item) && typeof item === "object" && typeof item.id === "string",
    );
  } catch {
    return [];
  }
}

function isEmptyFieldValue(raw: unknown): boolean {
  return (
    raw === undefined ||
    raw === null ||
    (typeof raw === "string" && raw.trim() === "") ||
    (Array.isArray(raw) && raw.length === 0)
  );
}

/**
 * Type-aware custom field validator matching `src/lib/crm/customize.ts` `parseValue`.
 */
function parseCustomFieldValue(
  def: {
    fieldType: string;
    options: StoredFieldOption[];
    currency: string | null;
  },
  raw: unknown,
): { ok: true; value: unknown } | { ok: false; error: string } {
  if (def.fieldType === "checkbox") {
    if (raw === undefined || raw === null || raw === "") {
      return { ok: true, value: undefined };
    }
    return typeof raw === "boolean"
      ? { ok: true, value: raw }
      : { ok: false, error: "Choose yes or no." };
  }

  if (isEmptyFieldValue(raw)) {
    return { ok: true, value: undefined };
  }

  const str = typeof raw === "string" ? raw.trim() : undefined;
  const liveOptions = new Set(def.options.filter((o) => !o.archived).map((o) => o.id));

  switch (def.fieldType) {
    case "text":
      return str !== undefined
        ? str.length <= 200
          ? { ok: true, value: str }
          : { ok: false, error: "Keep it under 200 characters." }
        : { ok: false, error: "Enter text." };
    case "longtext":
      return str !== undefined
        ? str.length <= 5000
          ? { ok: true, value: str }
          : { ok: false, error: "Keep it under 5,000 characters." }
        : { ok: false, error: "Enter text." };
    case "number": {
      const cleaned = str?.replace(/,/g, "");
      const num =
        typeof raw === "number"
          ? raw
          : cleaned !== undefined && /^-?\d+(?:\.\d+)?$/.test(cleaned)
            ? Number(cleaned)
            : Number.NaN;
      return Number.isFinite(num)
        ? { ok: true, value: num }
        : { ok: false, error: "Enter a number." };
    }
    case "currency": {
      let amount = Number.NaN;
      let currency = def.currency ?? "INR";
      if (typeof raw === "object" && raw !== null && "amount" in raw) {
        const rec = raw as { amount?: unknown; currency?: unknown };
        amount = typeof rec.amount === "number" ? rec.amount : Number.NaN;
        if (typeof rec.currency === "string" && rec.currency.trim()) {
          currency = rec.currency.trim();
        }
      } else if (typeof raw === "number") {
        amount = raw;
      } else if (str !== undefined) {
        const cleaned = str.replace(/[₹,\s]/g, "");
        if (/^\d+(?:\.\d{1,2})?$/.test(cleaned)) {
          amount = Number(cleaned);
        }
      }
      if (!Number.isFinite(amount) || amount < 0) {
        return { ok: false, error: "Enter an amount of zero or more." };
      }
      return {
        ok: true,
        value: { amount: Math.round(amount * 100) / 100, currency },
      };
    }
    case "date":
      return str !== undefined && isValidCalendarDay(str)
        ? { ok: true, value: str }
        : { ok: false, error: "Pick a valid date." };
    case "select":
      return str !== undefined && liveOptions.has(str)
        ? { ok: true, value: str }
        : { ok: false, error: "Pick one of the listed options." };
    case "multiselect": {
      if (!Array.isArray(raw) || raw.some((item) => typeof item !== "string")) {
        return { ok: false, error: "Pick from the listed options." };
      }
      const unique = [...new Set(raw as string[])];
      return unique.every((id) => liveOptions.has(id))
        ? { ok: true, value: unique }
        : { ok: false, error: "One of the chosen options no longer exists." };
    }
    case "url": {
      if (str === undefined || /\s/.test(str)) {
        return { ok: false, error: "Enter a web address." };
      }
      try {
        const u = new URL(/^https?:\/\//i.test(str) ? str : `https://${str}`);
        return (u.protocol === "https:" || u.protocol === "http:") && u.hostname.includes(".")
          ? { ok: true, value: u.toString() }
          : { ok: false, error: "Enter a valid web address." };
      } catch {
        return { ok: false, error: "Enter a valid web address." };
      }
    }
    case "email":
      return str !== undefined && CUSTOM_EMAIL_RE.test(str)
        ? { ok: true, value: str.toLowerCase() }
        : { ok: false, error: "Enter a valid email address." };
    case "phone": {
      const d = (str ?? "").replace(/[\s()-]/g, "");
      return /^\+?\d{7,15}$/.test(d)
        ? { ok: true, value: d }
        : { ok: false, error: "Enter 7–15 digits, optionally starting with +." };
    }
    default:
      return { ok: false, error: "Unsupported custom field type." };
  }
}

export async function syncLeadTagsInTx(
  tx: CrmTransaction,
  params: {
    ownerUserId: string;
    leadId: string;
    tagIds: string[];
    isNew: boolean;
    now: Date;
  },
): Promise<string[]> {
  const uniqueRequested = [...new Set(params.tagIds.map((t) => t.trim()).filter(Boolean))];

  const existingLinks = params.isNew
    ? []
    : await tx
        .select({ tagId: crmLeadTags.tagId })
        .from(crmLeadTags)
        .where(
          and(
            eq(crmLeadTags.ownerUserId, params.ownerUserId),
            eq(crmLeadTags.leadId, params.leadId),
          ),
        );

  const currentTagIds = new Set(existingLinks.map((row) => row.tagId));

  if (uniqueRequested.length > 0) {
    const defs = await tx
      .select({
        id: crmTagDefs.id,
        status: crmTagDefs.status,
        scope: crmTagDefs.scope,
      })
      .from(crmTagDefs)
      .where(
        and(
          eq(crmTagDefs.ownerUserId, params.ownerUserId),
          inArray(crmTagDefs.id, uniqueRequested),
        ),
      );

    const defById = new Map(defs.map((d) => [d.id, d]));

    for (const tagId of uniqueRequested) {
      const def = defById.get(tagId);
      if (!def) {
        throw new CrmServiceError(400, "validation_error", `Unknown tag "${tagId}".`, {
          details: { tagId },
        });
      }
      // Archived tags already attached to the lead may remain, matching customize.ts/store.ts.
      if (!currentTagIds.has(tagId)) {
        if (def.status !== "active" || def.scope === "project") {
          throw new CrmServiceError(
            400,
            "validation_error",
            `Tag "${tagId}" cannot be assigned to leads.`,
            { details: { tagId } },
          );
        }
      }
    }
  }

  if (!params.isNew) {
    await tx
      .delete(crmLeadTags)
      .where(
        and(eq(crmLeadTags.ownerUserId, params.ownerUserId), eq(crmLeadTags.leadId, params.leadId)),
      );
  }

  if (uniqueRequested.length > 0) {
    const nowStr = toMysqlUtcDateTime(params.now);
    await tx.insert(crmLeadTags).values(
      uniqueRequested.map((tagId) => ({
        id: generateServerId("ltag"),
        ownerUserId: params.ownerUserId,
        leadId: params.leadId,
        tagId,
        createdAt: nowStr,
      })),
    );
  }

  return uniqueRequested;
}

export async function syncLeadFieldValuesInTx(
  tx: CrmTransaction,
  params: {
    ownerUserId: string;
    leadId: string;
    input?: Record<string, unknown> | undefined;
    isNew: boolean;
    now: Date;
  },
): Promise<Record<string, unknown>> {
  const activeDefs = await tx
    .select()
    .from(crmCustomFields)
    .where(
      and(
        eq(crmCustomFields.ownerUserId, params.ownerUserId),
        eq(crmCustomFields.entity, "lead"),
        eq(crmCustomFields.status, "active"),
      ),
    )
    .orderBy(asc(crmCustomFields.sortOrder));

  const existingRows = params.isNew
    ? []
    : await tx
        .select()
        .from(crmLeadFieldValues)
        .where(
          and(
            eq(crmLeadFieldValues.ownerUserId, params.ownerUserId),
            eq(crmLeadFieldValues.leadId, params.leadId),
          ),
        );

  const existingByFieldId = new Map(existingRows.map((row) => [row.fieldId, row]));
  const resultMap: Record<string, unknown> = {};
  for (const row of existingRows) {
    try {
      resultMap[row.fieldId] = JSON.parse(row.valueJson) as unknown;
    } catch {
      resultMap[row.fieldId] = row.valueJson;
    }
  }

  const input = params.input ?? {};
  const activeById = new Map(activeDefs.map((d) => [d.id, d]));
  const unknownKeys = Object.keys(input).filter((k) => !activeById.has(k));
  if (unknownKeys.length > 0) {
    throw new CrmServiceError(400, "validation_error", "Unknown or archived custom field.", {
      details: Object.fromEntries(
        unknownKeys.map((k) => [k, "Field does not exist or is archived."]),
      ),
    });
  }

  const fieldErrors: Record<string, string> = {};
  const updates: { fieldId: string; value: unknown | undefined }[] = [];

  for (const def of activeDefs) {
    const options = parseCustomFieldOptions(def.optionsJson);
    const hasInput = def.id in input;
    const hadPrevious = existingByFieldId.has(def.id);

    if (!hasInput) {
      if (def.required && params.isNew) {
        fieldErrors[def.id] = "Required.";
      }
      continue;
    }

    const parsed = parseCustomFieldValue(
      { fieldType: def.fieldType, options, currency: def.currency ?? null },
      input[def.id],
    );
    if (!parsed.ok) {
      fieldErrors[def.id] = parsed.error;
      continue;
    }

    if (def.required && parsed.value === undefined && (params.isNew || hadPrevious)) {
      fieldErrors[def.id] = "Required.";
      continue;
    }

    updates.push({ fieldId: def.id, value: parsed.value });
  }

  if (Object.keys(fieldErrors).length > 0) {
    throw new CrmServiceError(400, "validation_error", "Custom field validation failed.", {
      details: fieldErrors,
    });
  }

  const nowStr = toMysqlUtcDateTime(params.now);
  for (const upd of updates) {
    const prevRow = existingByFieldId.get(upd.fieldId);
    if (upd.value === undefined) {
      if (prevRow) {
        await tx.delete(crmLeadFieldValues).where(eq(crmLeadFieldValues.id, prevRow.id));
        delete resultMap[upd.fieldId];
      }
      continue;
    }

    const encoded = JSON.stringify(upd.value);
    if (prevRow) {
      await tx
        .update(crmLeadFieldValues)
        .set({
          valueJson: encoded,
          version: prevRow.version + 1,
          updatedAt: nowStr,
        })
        .where(eq(crmLeadFieldValues.id, prevRow.id));
    } else {
      await tx.insert(crmLeadFieldValues).values({
        id: generateServerId("lfv"),
        ownerUserId: params.ownerUserId,
        leadId: params.leadId,
        fieldId: upd.fieldId,
        valueJson: encoded,
        version: 1,
        createdAt: nowStr,
        updatedAt: nowStr,
      });
    }
    resultMap[upd.fieldId] = upd.value;
  }

  return resultMap;
}

export async function hydrateLeadRelations(
  db: CrmDbExecutor,
  ownerUserId: string,
  leadIds: readonly string[],
): Promise<Map<string, { tagIds: string[]; fieldValues: Record<string, unknown> }>> {
  const map = new Map<string, { tagIds: string[]; fieldValues: Record<string, unknown> }>();
  if (leadIds.length === 0) return map;

  for (const id of leadIds) {
    map.set(id, { tagIds: [], fieldValues: {} });
  }

  const uniqueIds = [...new Set(leadIds)];
  const [tagRows, valueRows] = await Promise.all([
    db
      .select({ leadId: crmLeadTags.leadId, tagId: crmLeadTags.tagId })
      .from(crmLeadTags)
      .where(and(eq(crmLeadTags.ownerUserId, ownerUserId), inArray(crmLeadTags.leadId, uniqueIds))),
    db
      .select({
        leadId: crmLeadFieldValues.leadId,
        fieldId: crmLeadFieldValues.fieldId,
        valueJson: crmLeadFieldValues.valueJson,
      })
      .from(crmLeadFieldValues)
      .where(
        and(
          eq(crmLeadFieldValues.ownerUserId, ownerUserId),
          inArray(crmLeadFieldValues.leadId, uniqueIds),
        ),
      ),
  ]);

  for (const row of tagRows) {
    const entry = map.get(row.leadId);
    if (entry) {
      entry.tagIds.push(row.tagId);
    }
  }

  for (const row of valueRows) {
    const entry = map.get(row.leadId);
    if (entry) {
      try {
        entry.fieldValues[row.fieldId] = JSON.parse(row.valueJson) as unknown;
      } catch {
        entry.fieldValues[row.fieldId] = row.valueJson;
      }
    }
  }

  return map;
}
