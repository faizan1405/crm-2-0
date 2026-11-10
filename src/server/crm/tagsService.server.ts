import "@tanstack/react-start/server-only";
import { and, asc, eq, inArray, or } from "drizzle-orm";
import type { CrmDatabase } from "../db/index.server";
import { crmLeadTags, crmLeads, crmTagDefs } from "../db/schema.server";
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
  generateTagId,
  type BulkTagLeadsInput,
  type CreateTagInput,
  type TagColor,
  type TagScope,
  type UpdateTagInput,
} from "./customFieldsValidation.server";

export interface TagDto {
  id: string;
  name: string;
  description?: string | undefined;
  color: TagColor;
  status: "active" | "archived";
  scope: TagScope;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export function toTagDto(row: typeof crmTagDefs.$inferSelect): TagDto {
  return {
    id: row.id,
    name: row.name,
    ...(row.description ? { description: row.description } : {}),
    color: (row.color as TagColor) || "graphite",
    status: (row.status as "active" | "archived") || "active",
    scope: (row.scope as TagScope) || "lead",
    createdAt: mysqlUtcToIso(row.createdAt) ?? row.createdAt,
    updatedAt: mysqlUtcToIso(row.updatedAt) ?? row.updatedAt,
    version: row.version,
  };
}

export async function listTagsRecord(
  db: CrmDbExecutor,
  ownerUserId: string,
  scope?: TagScope,
): Promise<TagDto[]> {
  const predicates = [eq(crmTagDefs.ownerUserId, ownerUserId)];

  if (scope === "lead") {
    predicates.push(or(eq(crmTagDefs.scope, "lead"), eq(crmTagDefs.scope, "both"))!);
  } else if (scope === "project") {
    predicates.push(or(eq(crmTagDefs.scope, "project"), eq(crmTagDefs.scope, "both"))!);
  } else if (scope === "both") {
    predicates.push(eq(crmTagDefs.scope, "both"));
  }

  const rows = await db
    .select()
    .from(crmTagDefs)
    .where(and(...predicates))
    .orderBy(asc(crmTagDefs.status), asc(crmTagDefs.name));

  return rows.map(toTagDto);
}

export async function getTagRecord(
  db: CrmDbExecutor,
  ownerUserId: string,
  tagId: string,
): Promise<TagDto> {
  const rows = await db
    .select()
    .from(crmTagDefs)
    .where(and(eq(crmTagDefs.ownerUserId, ownerUserId), eq(crmTagDefs.id, tagId)))
    .limit(1);

  const row = rows[0];
  if (!row) {
    throw new CrmServiceError(404, "not_found", `Tag "${tagId}" not found.`);
  }

  return toTagDto(row);
}

export async function createTagRecord(
  db: CrmDatabase,
  ownerUserId: string,
  input: CreateTagInput,
  now: Date = new Date(),
): Promise<{ status: number; replayed: boolean; body: { ok: true; tag: TagDto } }> {
  const nameClean = input.name.trim();
  if (!nameClean) {
    throw new CrmServiceError(400, "validation_error", "Give the tag a name.");
  }
  if (nameClean.length > 32) {
    throw new CrmServiceError(400, "validation_error", "Keep tag names under 32 characters.");
  }

  const idemKey = input.idempotencyKey ?? null;
  const requestHash = hashIdempotentRequest(`tag:create:${ownerUserId}`, input);

  return runWithIdempotency<{ ok: true; tag: TagDto }>(
    db,
    {
      ownerUserId,
      scope: `tag:create:${ownerUserId}`,
      idemKey,
      requestHash,
      now,
    },
    async (tx) => {
      const existing = await tx
        .select({
          id: crmTagDefs.id,
          name: crmTagDefs.name,
          status: crmTagDefs.status,
        })
        .from(crmTagDefs)
        .where(eq(crmTagDefs.ownerUserId, ownerUserId));

      const dupe = existing.find(
        (t) => t.status === "active" && t.name.trim().toLowerCase() === nameClean.toLowerCase(),
      );
      if (dupe) {
        throw new CrmServiceError(400, "validation_error", "A tag with this name already exists.");
      }

      const existingIds = existing.map((t) => t.id);
      const tagId = input.id ?? generateTagId(nameClean, existingIds);

      if (existingIds.includes(tagId)) {
        throw new CrmServiceError(
          400,
          "validation_error",
          `A tag with id "${tagId}" already exists.`,
        );
      }

      const nowStr = toMysqlUtcDateTime(now);
      const newRow = {
        id: tagId,
        legacyId: null,
        ownerUserId,
        name: nameClean,
        description: input.description?.trim() || null,
        color: input.color ?? "graphite",
        status: "active",
        scope: input.scope ?? "lead",
        version: 1,
        createdAt: nowStr,
        updatedAt: nowStr,
      };

      await tx.insert(crmTagDefs).values(newRow);

      return {
        status: 201,
        resourceId: tagId,
        body: {
          ok: true,
          tag: toTagDto(newRow),
        },
      };
    },
  );
}

export async function updateTagRecord(
  db: CrmDatabase,
  ownerUserId: string,
  tagId: string,
  input: UpdateTagInput,
  now: Date = new Date(),
): Promise<{ ok: true; tag: TagDto }> {
  return db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(crmTagDefs)
      .where(and(eq(crmTagDefs.ownerUserId, ownerUserId), eq(crmTagDefs.id, tagId)))
      .limit(1)
      .for("update");

    const current = rows[0];
    if (!current) {
      throw new CrmServiceError(404, "not_found", `Tag "${tagId}" not found.`);
    }

    if (input.expectedVersion !== undefined && current.version !== input.expectedVersion) {
      throw new CrmServiceError(
        409,
        "stale_conflict",
        "Tag was modified by another request; reload and retry.",
        {
          conflict: {
            resource: "tag",
            id: current.id,
            expectedVersion: input.expectedVersion,
            currentVersion: current.version,
          },
        },
      );
    }

    const nextName = input.name !== undefined ? input.name.trim() : current.name;
    if (!nextName) {
      throw new CrmServiceError(400, "validation_error", "Give the tag a name.");
    }
    if (nextName.length > 32) {
      throw new CrmServiceError(400, "validation_error", "Keep tag names under 32 characters.");
    }

    if (nextName.toLowerCase() !== current.name.toLowerCase()) {
      const existing = await tx
        .select({ id: crmTagDefs.id, name: crmTagDefs.name, status: crmTagDefs.status })
        .from(crmTagDefs)
        .where(eq(crmTagDefs.ownerUserId, ownerUserId));

      const dupe = existing.find(
        (t) =>
          t.id !== tagId &&
          t.status === "active" &&
          t.name.trim().toLowerCase() === nextName.toLowerCase(),
      );
      if (dupe) {
        throw new CrmServiceError(400, "validation_error", "A tag with this name already exists.");
      }
    }

    const nextDescription =
      input.description !== undefined ? input.description?.trim() || null : current.description;
    const nextColor = input.color !== undefined ? input.color : (current.color as TagColor);
    const nextScope = input.scope !== undefined ? input.scope : (current.scope as TagScope);

    const nowStr = toMysqlUtcDateTime(now);
    const nextVersion = current.version + 1;

    await tx
      .update(crmTagDefs)
      .set({
        name: nextName,
        description: nextDescription,
        color: nextColor,
        scope: nextScope,
        version: nextVersion,
        updatedAt: nowStr,
      })
      .where(
        and(
          eq(crmTagDefs.ownerUserId, ownerUserId),
          eq(crmTagDefs.id, tagId),
          eq(crmTagDefs.version, current.version),
        ),
      );

    const updatedRow = {
      ...current,
      name: nextName,
      description: nextDescription,
      color: nextColor,
      scope: nextScope,
      version: nextVersion,
      updatedAt: nowStr,
    };

    return {
      ok: true,
      tag: toTagDto(updatedRow),
    };
  });
}

export async function archiveTagRecord(
  db: CrmDatabase,
  ownerUserId: string,
  tagId: string,
  expectedVersion?: number,
  now: Date = new Date(),
): Promise<{ ok: true; tag: TagDto }> {
  return db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(crmTagDefs)
      .where(and(eq(crmTagDefs.ownerUserId, ownerUserId), eq(crmTagDefs.id, tagId)))
      .limit(1)
      .for("update");

    const current = rows[0];
    if (!current) {
      throw new CrmServiceError(404, "not_found", `Tag "${tagId}" not found.`);
    }

    if (current.status === "archived") {
      return { ok: true, tag: toTagDto(current) };
    }

    if (expectedVersion !== undefined && current.version !== expectedVersion) {
      throw new CrmServiceError(
        409,
        "stale_conflict",
        "Tag was modified by another request; reload and retry.",
        {
          conflict: {
            resource: "tag",
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
      .update(crmTagDefs)
      .set({
        status: "archived",
        version: nextVersion,
        updatedAt: nowStr,
      })
      .where(
        and(
          eq(crmTagDefs.ownerUserId, ownerUserId),
          eq(crmTagDefs.id, tagId),
          eq(crmTagDefs.version, current.version),
        ),
      );

    const updatedRow = {
      ...current,
      status: "archived",
      version: nextVersion,
      updatedAt: nowStr,
    };

    return {
      ok: true,
      tag: toTagDto(updatedRow),
    };
  });
}

export async function getLeadTagsRecord(
  db: CrmDbExecutor,
  ownerUserId: string,
  leadId: string,
): Promise<{ leadId: string; tags: TagDto[] }> {
  const leadRows = await db
    .select({ id: crmLeads.id })
    .from(crmLeads)
    .where(and(eq(crmLeads.ownerUserId, ownerUserId), eq(crmLeads.id, leadId)))
    .limit(1);

  if (leadRows.length === 0) {
    throw new CrmServiceError(404, "not_found", `Lead "${leadId}" not found.`);
  }

  const tagRows = await db
    .select({
      tagDef: crmTagDefs,
    })
    .from(crmLeadTags)
    .innerJoin(crmTagDefs, eq(crmLeadTags.tagId, crmTagDefs.id))
    .where(and(eq(crmLeadTags.ownerUserId, ownerUserId), eq(crmLeadTags.leadId, leadId)))
    .orderBy(asc(crmTagDefs.name));

  return {
    leadId,
    tags: tagRows.map((r) => toTagDto(r.tagDef)),
  };
}

export async function addTagToLeadRecord(
  db: CrmDatabase,
  ownerUserId: string,
  leadId: string,
  tagId: string,
  now: Date = new Date(),
): Promise<{ ok: true; leadId: string; tagId: string; added: boolean }> {
  return db.transaction(async (tx) => {
    const leadRows = await tx
      .select({ id: crmLeads.id, lifecycleStatus: crmLeads.lifecycleStatus })
      .from(crmLeads)
      .where(and(eq(crmLeads.ownerUserId, ownerUserId), eq(crmLeads.id, leadId)))
      .limit(1);

    const lead = leadRows[0];
    if (!lead) {
      throw new CrmServiceError(404, "not_found", `Lead "${leadId}" not found.`);
    }
    if (lead.lifecycleStatus !== "active") {
      throw new CrmServiceError(400, "validation_error", "Cannot add tags to an archived lead.");
    }

    const tagRows = await tx
      .select()
      .from(crmTagDefs)
      .where(and(eq(crmTagDefs.ownerUserId, ownerUserId), eq(crmTagDefs.id, tagId)))
      .limit(1);

    const tag = tagRows[0];
    if (!tag) {
      throw new CrmServiceError(404, "not_found", `Tag "${tagId}" not found.`);
    }
    if (tag.status !== "active") {
      throw new CrmServiceError(
        400,
        "validation_error",
        `Tag "${tag.name}" is archived and cannot be added.`,
      );
    }
    if (tag.scope === "project") {
      throw new CrmServiceError(
        400,
        "validation_error",
        `Tag "${tag.name}" is configured for Projects only.`,
      );
    }

    // Check if link already exists (idempotency)
    const existingLink = await tx
      .select({ id: crmLeadTags.id })
      .from(crmLeadTags)
      .where(
        and(
          eq(crmLeadTags.ownerUserId, ownerUserId),
          eq(crmLeadTags.leadId, leadId),
          eq(crmLeadTags.tagId, tagId),
        ),
      )
      .limit(1);

    if (existingLink.length > 0) {
      return { ok: true, leadId, tagId, added: false };
    }

    const nowStr = toMysqlUtcDateTime(now);
    await tx.insert(crmLeadTags).values({
      id: generateServerId("ltag"),
      ownerUserId,
      leadId,
      tagId,
      createdAt: nowStr,
    });

    return { ok: true, leadId, tagId, added: true };
  });
}

export async function removeTagFromLeadRecord(
  db: CrmDatabase,
  ownerUserId: string,
  leadId: string,
  tagId: string,
): Promise<{ ok: true; leadId: string; tagId: string; removed: boolean }> {
  return db.transaction(async (tx) => {
    const leadRows = await tx
      .select({ id: crmLeads.id })
      .from(crmLeads)
      .where(and(eq(crmLeads.ownerUserId, ownerUserId), eq(crmLeads.id, leadId)))
      .limit(1);

    if (leadRows.length === 0) {
      throw new CrmServiceError(404, "not_found", `Lead "${leadId}" not found.`);
    }

    const res = await tx
      .delete(crmLeadTags)
      .where(
        and(
          eq(crmLeadTags.ownerUserId, ownerUserId),
          eq(crmLeadTags.leadId, leadId),
          eq(crmLeadTags.tagId, tagId),
        ),
      );

    const affected = Number(res[0]?.affectedRows ?? 0);
    return { ok: true, leadId, tagId, removed: affected > 0 };
  });
}

export async function bulkTagLeadsRecord(
  db: CrmDatabase,
  ownerUserId: string,
  input: BulkTagLeadsInput,
  now: Date = new Date(),
): Promise<{
  ok: true;
  tagId: string;
  mode: "add" | "remove";
  changedCount: number;
  affectedLeadIds: string[];
}> {
  return db.transaction(async (tx) => {
    const tagRows = await tx
      .select()
      .from(crmTagDefs)
      .where(and(eq(crmTagDefs.ownerUserId, ownerUserId), eq(crmTagDefs.id, input.tagId)))
      .limit(1);

    const tag = tagRows[0];
    if (!tag) {
      throw new CrmServiceError(404, "not_found", `Tag "${input.tagId}" not found.`);
    }

    if (input.mode === "add") {
      if (tag.status !== "active") {
        throw new CrmServiceError(
          400,
          "validation_error",
          `Tag "${tag.name}" is archived and cannot be assigned.`,
        );
      }
      if (tag.scope === "project") {
        throw new CrmServiceError(
          400,
          "validation_error",
          `Tag "${tag.name}" is configured for Projects only.`,
        );
      }
    }

    const uniqueLeadIds = [...new Set(input.leadIds)];

    // Check valid active leads belonging to owner
    const validLeads = await tx
      .select({ id: crmLeads.id })
      .from(crmLeads)
      .where(
        and(
          eq(crmLeads.ownerUserId, ownerUserId),
          eq(crmLeads.lifecycleStatus, "active"),
          inArray(crmLeads.id, uniqueLeadIds),
        ),
      );

    const validLeadIds = new Set(validLeads.map((l) => l.id));
    if (validLeadIds.size === 0) {
      return {
        ok: true,
        tagId: input.tagId,
        mode: input.mode,
        changedCount: 0,
        affectedLeadIds: [],
      };
    }

    // Existing links among these leads
    const existingLinks = await tx
      .select({ leadId: crmLeadTags.leadId })
      .from(crmLeadTags)
      .where(
        and(
          eq(crmLeadTags.ownerUserId, ownerUserId),
          eq(crmLeadTags.tagId, input.tagId),
          inArray(crmLeadTags.leadId, [...validLeadIds]),
        ),
      );

    const alreadyTaggedLeadIds = new Set(existingLinks.map((l) => l.leadId));

    if (input.mode === "add") {
      const toAdd = [...validLeadIds].filter((id) => !alreadyTaggedLeadIds.has(id));
      if (toAdd.length === 0) {
        return { ok: true, tagId: input.tagId, mode: "add", changedCount: 0, affectedLeadIds: [] };
      }

      const nowStr = toMysqlUtcDateTime(now);
      await tx.insert(crmLeadTags).values(
        toAdd.map((leadId) => ({
          id: generateServerId("ltag"),
          ownerUserId,
          leadId,
          tagId: input.tagId,
          createdAt: nowStr,
        })),
      );

      return {
        ok: true,
        tagId: input.tagId,
        mode: "add",
        changedCount: toAdd.length,
        affectedLeadIds: toAdd,
      };
    } else {
      const toRemove = [...validLeadIds].filter((id) => alreadyTaggedLeadIds.has(id));
      if (toRemove.length === 0) {
        return {
          ok: true,
          tagId: input.tagId,
          mode: "remove",
          changedCount: 0,
          affectedLeadIds: [],
        };
      }

      await tx
        .delete(crmLeadTags)
        .where(
          and(
            eq(crmLeadTags.ownerUserId, ownerUserId),
            eq(crmLeadTags.tagId, input.tagId),
            inArray(crmLeadTags.leadId, toRemove),
          ),
        );

      return {
        ok: true,
        tagId: input.tagId,
        mode: "remove",
        changedCount: toRemove.length,
        affectedLeadIds: toRemove,
      };
    }
  });
}
