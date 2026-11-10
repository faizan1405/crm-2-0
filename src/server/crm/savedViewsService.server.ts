import "@tanstack/react-start/server-only";
import { and, asc, desc, eq } from "drizzle-orm";
import type { CrmDatabase } from "../db/index.server";
import { crmSavedViews } from "../db/schema.server";
import { toMysqlUtcDateTime } from "../db/utc.server";
import { mysqlUtcToIso } from "./dates.server";
import { generateServerId } from "../auth/security.server";
import { CrmServiceError } from "./errors.server";
import {
  hashIdempotentRequest,
  runWithIdempotency,
  type CrmDbExecutor,
} from "./idempotency.server";
import {
  FILTER_OPS,
  slugify,
  type CreateSavedViewInput,
  type UpdateSavedViewInput,
  type ViewFilter,
  type ViewSort,
  type ViewVisibility,
} from "./customFieldsValidation.server";

export interface SavedViewDto {
  id: string;
  name: string;
  visibility: ViewVisibility;
  filter: ViewFilter;
  sort: ViewSort;
  columns?: string[] | undefined;
  archived: boolean;
  isDefault: boolean;
  isPinned: boolean;
  schemaVersion: number;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export function toSavedViewDto(row: typeof crmSavedViews.$inferSelect): SavedViewDto {
  let filter: ViewFilter = { mode: "and", conditions: [] };
  try {
    filter = JSON.parse(row.filterJson) as ViewFilter;
  } catch {
    filter = { mode: "and", conditions: [] };
  }

  let columns: string[] | undefined = undefined;
  if (row.columnsJson) {
    try {
      columns = JSON.parse(row.columnsJson);
    } catch {
      columns = undefined;
    }
  }

  return {
    id: row.id,
    name: row.name,
    visibility: (row.visibility as ViewVisibility) || "company",
    filter,
    sort: (row.sort as ViewSort) || "recent",
    ...(columns ? { columns } : {}),
    archived: row.archived,
    isDefault: row.isDefault,
    isPinned: row.isPinned,
    schemaVersion: row.schemaVersion,
    createdAt: mysqlUtcToIso(row.createdAt) ?? row.createdAt,
    updatedAt: mysqlUtcToIso(row.updatedAt) ?? row.updatedAt,
    version: row.version,
  };
}

function validateFilterStructure(filter: ViewFilter): void {
  if (filter.mode !== "and" && filter.mode !== "or") {
    throw new CrmServiceError(400, "validation_error", "Filter mode must be 'and' or 'or'.");
  }
  if (!Array.isArray(filter.conditions)) {
    throw new CrmServiceError(400, "validation_error", "Filter conditions must be an array.");
  }
  if (filter.conditions.length > 20) {
    throw new CrmServiceError(400, "validation_error", "Use at most 20 conditions.");
  }
  const allowedOps = new Set(FILTER_OPS);
  for (const c of filter.conditions) {
    if (!c || typeof c !== "object") {
      throw new CrmServiceError(400, "validation_error", "Invalid condition structure.");
    }
    if (!c.id || typeof c.id !== "string") {
      throw new CrmServiceError(400, "validation_error", "Condition must have a string id.");
    }
    if (!c.field || typeof c.field !== "string") {
      throw new CrmServiceError(400, "validation_error", "Condition must have a string field.");
    }
    if (!allowedOps.has(c.op)) {
      throw new CrmServiceError(
        400,
        "validation_error",
        `Unsupported condition operator "${c.op}".`,
      );
    }
  }
}

export async function listSavedViewsRecord(
  db: CrmDbExecutor,
  ownerUserId: string,
  includeArchived = false,
): Promise<SavedViewDto[]> {
  const predicates = [eq(crmSavedViews.ownerUserId, ownerUserId)];
  if (!includeArchived) {
    predicates.push(eq(crmSavedViews.archived, false));
  }

  const rows = await db
    .select()
    .from(crmSavedViews)
    .where(and(...predicates))
    .orderBy(desc(crmSavedViews.isPinned), asc(crmSavedViews.name));

  return rows.map(toSavedViewDto);
}

export async function getSavedViewRecord(
  db: CrmDbExecutor,
  ownerUserId: string,
  viewId: string,
): Promise<SavedViewDto> {
  const rows = await db
    .select()
    .from(crmSavedViews)
    .where(and(eq(crmSavedViews.ownerUserId, ownerUserId), eq(crmSavedViews.id, viewId)))
    .limit(1);

  const row = rows[0];
  if (!row) {
    throw new CrmServiceError(404, "not_found", `Saved view "${viewId}" not found.`);
  }

  return toSavedViewDto(row);
}

export async function createSavedViewRecord(
  db: CrmDatabase,
  ownerUserId: string,
  input: CreateSavedViewInput,
  now: Date = new Date(),
): Promise<{ status: number; replayed: boolean; body: { ok: true; view: SavedViewDto } }> {
  const nameClean = input.name.trim();
  if (!nameClean) {
    throw new CrmServiceError(400, "validation_error", "Name the view.");
  }
  if (nameClean.length > 50) {
    throw new CrmServiceError(400, "validation_error", "Keep the name under 50 characters.");
  }

  validateFilterStructure(input.filter);

  const idemKey = input.idempotencyKey ?? null;
  const requestHash = hashIdempotentRequest(`saved_view:create:${ownerUserId}`, input);

  return runWithIdempotency<{ ok: true; view: SavedViewDto }>(
    db,
    {
      ownerUserId,
      scope: `saved_view:create:${ownerUserId}`,
      idemKey,
      requestHash,
      now,
    },
    async (tx) => {
      const existing = await tx
        .select({
          id: crmSavedViews.id,
          name: crmSavedViews.name,
          archived: crmSavedViews.archived,
        })
        .from(crmSavedViews)
        .where(eq(crmSavedViews.ownerUserId, ownerUserId));

      const dupe = existing.find(
        (v) => !v.archived && v.name.trim().toLowerCase() === nameClean.toLowerCase(),
      );
      if (dupe) {
        throw new CrmServiceError(
          400,
          "validation_error",
          "You already have a view with this name.",
        );
      }

      const viewId = input.id ?? generateServerId("view");

      const nowStr = toMysqlUtcDateTime(now);
      const newRow = {
        id: viewId,
        legacyId: null,
        ownerUserId,
        name: nameClean,
        visibility: input.visibility ?? "company",
        filterJson: JSON.stringify(input.filter),
        sort: input.sort ?? "recent",
        columnsJson: input.columns ? JSON.stringify(input.columns) : null,
        archived: false,
        isDefault: input.isDefault ?? false,
        isPinned: input.isPinned ?? false,
        schemaVersion: 1,
        version: 1,
        createdAt: nowStr,
        updatedAt: nowStr,
      };

      await tx.insert(crmSavedViews).values(newRow);

      return {
        status: 201,
        resourceId: viewId,
        body: {
          ok: true,
          view: toSavedViewDto(newRow),
        },
      };
    },
  );
}

export async function updateSavedViewRecord(
  db: CrmDatabase,
  ownerUserId: string,
  viewId: string,
  input: UpdateSavedViewInput,
  now: Date = new Date(),
): Promise<{ ok: true; view: SavedViewDto }> {
  return db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(crmSavedViews)
      .where(and(eq(crmSavedViews.ownerUserId, ownerUserId), eq(crmSavedViews.id, viewId)))
      .limit(1)
      .for("update");

    const current = rows[0];
    if (!current) {
      throw new CrmServiceError(404, "not_found", `Saved view "${viewId}" not found.`);
    }

    if (input.expectedVersion !== undefined && current.version !== input.expectedVersion) {
      throw new CrmServiceError(
        409,
        "stale_conflict",
        "Saved view was modified by another request; reload and retry.",
        {
          conflict: {
            resource: "saved_view",
            id: current.id,
            expectedVersion: input.expectedVersion,
            currentVersion: current.version,
          },
        },
      );
    }

    const nextName = input.name !== undefined ? input.name.trim() : current.name;
    if (!nextName) {
      throw new CrmServiceError(400, "validation_error", "Name the view.");
    }
    if (nextName.length > 50) {
      throw new CrmServiceError(400, "validation_error", "Keep the name under 50 characters.");
    }

    if (nextName.toLowerCase() !== current.name.toLowerCase()) {
      const existing = await tx
        .select({
          id: crmSavedViews.id,
          name: crmSavedViews.name,
          archived: crmSavedViews.archived,
        })
        .from(crmSavedViews)
        .where(eq(crmSavedViews.ownerUserId, ownerUserId));

      const dupe = existing.find(
        (v) =>
          v.id !== viewId && !v.archived && v.name.trim().toLowerCase() === nextName.toLowerCase(),
      );
      if (dupe) {
        throw new CrmServiceError(
          400,
          "validation_error",
          "You already have a view with this name.",
        );
      }
    }

    if (input.filter !== undefined) {
      validateFilterStructure(input.filter);
    }

    const nextFilterJson =
      input.filter !== undefined ? JSON.stringify(input.filter) : current.filterJson;
    const nextVisibility = input.visibility !== undefined ? input.visibility : current.visibility;
    const nextSort = input.sort !== undefined ? input.sort : current.sort;
    const nextColumnsJson =
      input.columns !== undefined ? JSON.stringify(input.columns) : current.columnsJson;
    const nextDefault = input.isDefault !== undefined ? input.isDefault : current.isDefault;
    const nextPinned = input.isPinned !== undefined ? input.isPinned : current.isPinned;

    const nowStr = toMysqlUtcDateTime(now);
    const nextVersion = current.version + 1;

    await tx
      .update(crmSavedViews)
      .set({
        name: nextName,
        visibility: nextVisibility,
        filterJson: nextFilterJson,
        sort: nextSort,
        columnsJson: nextColumnsJson,
        isDefault: nextDefault,
        isPinned: nextPinned,
        version: nextVersion,
        updatedAt: nowStr,
      })
      .where(
        and(
          eq(crmSavedViews.ownerUserId, ownerUserId),
          eq(crmSavedViews.id, viewId),
          eq(crmSavedViews.version, current.version),
        ),
      );

    const updatedRow = {
      ...current,
      name: nextName,
      visibility: nextVisibility,
      filterJson: nextFilterJson,
      sort: nextSort,
      columnsJson: nextColumnsJson,
      isDefault: nextDefault,
      isPinned: nextPinned,
      version: nextVersion,
      updatedAt: nowStr,
    };

    return {
      ok: true,
      view: toSavedViewDto(updatedRow),
    };
  });
}

export async function archiveSavedViewRecord(
  db: CrmDatabase,
  ownerUserId: string,
  viewId: string,
  expectedVersion?: number,
  now: Date = new Date(),
): Promise<{ ok: true; view: SavedViewDto }> {
  return db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(crmSavedViews)
      .where(and(eq(crmSavedViews.ownerUserId, ownerUserId), eq(crmSavedViews.id, viewId)))
      .limit(1)
      .for("update");

    const current = rows[0];
    if (!current) {
      throw new CrmServiceError(404, "not_found", `Saved view "${viewId}" not found.`);
    }

    if (current.archived) {
      return { ok: true, view: toSavedViewDto(current) };
    }

    if (expectedVersion !== undefined && current.version !== expectedVersion) {
      throw new CrmServiceError(
        409,
        "stale_conflict",
        "Saved view was modified by another request; reload and retry.",
        {
          conflict: {
            resource: "saved_view",
            id: current.id,
            expectedVersion,
            currentVersion: current.version,
          },
        },
      );
    }

    const nowStr = toMysqlUtcDateTime(now);
    const nextVersion = current.version + 1;

    await tx
      .update(crmSavedViews)
      .set({
        archived: true,
        version: nextVersion,
        updatedAt: nowStr,
      })
      .where(
        and(
          eq(crmSavedViews.ownerUserId, ownerUserId),
          eq(crmSavedViews.id, viewId),
          eq(crmSavedViews.version, current.version),
        ),
      );

    const updatedRow = {
      ...current,
      archived: true,
      version: nextVersion,
      updatedAt: nowStr,
    };

    return {
      ok: true,
      view: toSavedViewDto(updatedRow),
    };
  });
}

export async function duplicateSavedViewRecord(
  db: CrmDatabase,
  ownerUserId: string,
  viewId: string,
  now: Date = new Date(),
): Promise<{ ok: true; view: SavedViewDto }> {
  return db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(crmSavedViews)
      .where(and(eq(crmSavedViews.ownerUserId, ownerUserId), eq(crmSavedViews.id, viewId)))
      .limit(1);

    const source = rows[0];
    if (!source) {
      throw new CrmServiceError(404, "not_found", `Saved view "${viewId}" not found.`);
    }

    const existing = await tx
      .select({ name: crmSavedViews.name })
      .from(crmSavedViews)
      .where(and(eq(crmSavedViews.ownerUserId, ownerUserId), eq(crmSavedViews.archived, false)));

    const takenNames = new Set(existing.map((e) => e.name.toLowerCase()));

    let candidateName = `${source.name} (Copy)`;
    let counter = 2;
    while (takenNames.has(candidateName.toLowerCase())) {
      candidateName = `${source.name} (Copy ${counter++})`;
    }
    if (candidateName.length > 50) {
      candidateName = candidateName.slice(0, 50).trim();
    }

    const newId = generateServerId("view");
    const nowStr = toMysqlUtcDateTime(now);

    const newRow = {
      id: newId,
      legacyId: null,
      ownerUserId,
      name: candidateName,
      visibility: source.visibility,
      filterJson: source.filterJson,
      sort: source.sort,
      columnsJson: source.columnsJson,
      archived: false,
      isDefault: false,
      isPinned: false,
      schemaVersion: source.schemaVersion,
      version: 1,
      createdAt: nowStr,
      updatedAt: nowStr,
    };

    await tx.insert(crmSavedViews).values(newRow);

    return {
      ok: true,
      view: toSavedViewDto(newRow),
    };
  });
}
