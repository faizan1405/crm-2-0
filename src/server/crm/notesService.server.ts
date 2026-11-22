import "@tanstack/react-start/server-only";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { generateServerId } from "../auth/security.server";
import type { CrmDatabase } from "../db/index.server";
import { crmLeads, crmPersonalNotes, crmProjects } from "../db/schema.server";
import { parseUtcDateTime, toMysqlUtcDateTime } from "../db/utc.server";
import { CrmServiceError } from "./errors.server";

export const NOTE_COLORS = ["default", "amber", "blue", "green", "rose"] as const;
export type NoteColorApi = (typeof NOTE_COLORS)[number];

export const NOTE_SORTS = ["recent", "created", "title"] as const;
export type NoteSortApi = (typeof NOTE_SORTS)[number];

const ALLOWED_NODE_TYPES = new Set([
  "doc",
  "paragraph",
  "bulletList",
  "orderedList",
  "listItem",
  "taskList",
  "taskItem",
  "text",
  "hardBreak",
]);

const ALLOWED_MARK_TYPES = new Set(["bold", "italic"]);

const MAX_DOC_DEPTH = 16;
const MAX_DOC_NODES = 2000;
const MAX_DOC_JSON_BYTES = 60_000;
const MAX_TITLE_LENGTH = 200;
const MAX_TAGS_PER_NOTE = 12;
const MAX_TAG_LENGTH = 32;

export interface SanitizedNoteDoc {
  type: string;
  attrs?: Record<string, unknown>;
  content?: SanitizedNoteDoc[];
  marks?: Array<{ type: string }>;
  text?: string;
}

export interface PersonalNoteDto {
  id: string;
  title: string;
  body: string;
  doc: SanitizedNoteDoc;
  tags: string[];
  color: NoteColorApi;
  pinned: boolean;
  linkedLeadId: string | null;
  linkedLeadName: string | null;
  linkedProjectId: string | null;
  linkedProjectName: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export const EMPTY_NOTE_DOC: SanitizedNoteDoc = {
  type: "doc",
  content: [{ type: "paragraph" }],
};

/**
 * Strips raw HTML tags / control characters from plain text inputs (title, tags).
 */
function stripUnsafeText(raw: string): string {
  // Remove NUL and non-printable control chars (preserve normal whitespace/newlines)
  // eslint-disable-next-line no-control-regex
  return raw.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
}

/**
 * Converts plain text lines into a valid Tiptap document.
 */
export function plainTextToNoteDoc(body: string): SanitizedNoteDoc {
  const safe = stripUnsafeText(body).replace(/\r\n?/g, "\n");
  const lines = safe.split("\n");
  return {
    type: "doc",
    content: lines.map((line) =>
      line ? { type: "paragraph", content: [{ type: "text", text: line }] } : { type: "paragraph" },
    ),
  };
}

/**
 * Strictly sanitizes an untrusted Tiptap JSON document against XSS / prototype pollution / DoS.
 * - Only allowlisted Tiptap node types and marks (`bold`, `italic`) survive.
 * - Arbitrary attributes (`onclick`, `href`, `style`, `src`, etc.) are completely dropped.
 * - Unknown/dangerous nodes (`script`, `iframe`, `rawHtml`, etc.) are discarded (never rendered as HTML).
 * - Enforces max tree depth (16), max node count (2,000), and max serialized size (60 KB).
 */
export function sanitizeServerNoteDoc(raw: unknown): SanitizedNoteDoc {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return EMPTY_NOTE_DOC;
  }

  let nodeCount = 0;

  const walk = (node: unknown, depth: number): SanitizedNoteDoc | null => {
    if (depth > MAX_DOC_DEPTH) {
      throw new CrmServiceError(
        400,
        "validation_error",
        "Note content nesting exceeds the maximum allowed depth.",
      );
    }
    if (!node || typeof node !== "object" || Array.isArray(node)) {
      return null;
    }

    nodeCount += 1;
    if (nodeCount > MAX_DOC_NODES) {
      throw new CrmServiceError(
        400,
        "validation_error",
        "Note content exceeds the maximum allowed block count.",
      );
    }

    const rec = node as Record<string, unknown>;
    const type = typeof rec["type"] === "string" ? rec["type"] : "";

    if (!ALLOWED_NODE_TYPES.has(type)) {
      // Strictly drop dangerous/unknown nodes (e.g. script, iframe, rawHtml, image)
      return null;
    }

    if (type === "text") {
      const text = stripUnsafeText(typeof rec["text"] === "string" ? rec["text"] : "");
      if (!text) return null;
      const rawMarks = Array.isArray(rec["marks"]) ? rec["marks"] : [];
      const seenMarks = new Set<string>();
      const marks: Array<{ type: string }> = [];
      for (const m of rawMarks) {
        if (m && typeof m === "object" && !Array.isArray(m)) {
          const mType = (m as Record<string, unknown>)["type"];
          if (typeof mType === "string" && ALLOWED_MARK_TYPES.has(mType) && !seenMarks.has(mType)) {
            seenMarks.add(mType);
            marks.push({ type: mType });
          }
        }
      }
      return marks.length > 0 ? { type: "text", text, marks } : { type: "text", text };
    }

    const out: SanitizedNoteDoc = { type };

    if (type === "taskItem") {
      const rawAttrs =
        rec["attrs"] && typeof rec["attrs"] === "object" && !Array.isArray(rec["attrs"])
          ? (rec["attrs"] as Record<string, unknown>)
          : {};
      out.attrs = { checked: rawAttrs["checked"] === true };
    } else if (type === "orderedList") {
      const rawAttrs =
        rec["attrs"] && typeof rec["attrs"] === "object" && !Array.isArray(rec["attrs"])
          ? (rec["attrs"] as Record<string, unknown>)
          : {};
      const start = rawAttrs["start"];
      out.attrs = {
        start: typeof start === "number" && Number.isInteger(start) && start >= 1 ? start : 1,
      };
    }

    if (Array.isArray(rec["content"])) {
      const children: SanitizedNoteDoc[] = [];
      for (const child of rec["content"]) {
        const cleanChild = walk(child, depth + 1);
        if (cleanChild) {
          children.push(cleanChild);
        }
      }
      if (children.length > 0) {
        out.content = children;
      }
    }

    return out;
  };

  const root = walk(raw, 0);
  const finalDoc: SanitizedNoteDoc =
    root && root.type === "doc"
      ? root.content && root.content.length > 0
        ? root
        : EMPTY_NOTE_DOC
      : EMPTY_NOTE_DOC;

  const serializedBytes = Buffer.byteLength(JSON.stringify(finalDoc), "utf8");
  if (serializedBytes > MAX_DOC_JSON_BYTES) {
    throw new CrmServiceError(
      400,
      "validation_error",
      "Note content exceeds the 60 KB maximum size limit.",
    );
  }

  return finalDoc;
}

/**
 * Deterministic server-side plain-text extraction from a sanitized Tiptap document.
 */
export function extractPlainTextFromNoteDoc(node: SanitizedNoteDoc): string {
  if (node.type === "text") return node.text ?? "";
  if (node.type === "hardBreak") return "\n";
  const kids = node.content ?? [];
  if (node.type === "paragraph") return kids.map(extractPlainTextFromNoteDoc).join("");
  if (node.type === "taskItem") {
    return `${node.attrs?.["checked"] === true ? "☑" : "☐"} ${kids
      .map(extractPlainTextFromNoteDoc)
      .join("\n")}`;
  }
  if (node.type === "orderedList") {
    const start = typeof node.attrs?.["start"] === "number" ? node.attrs["start"] : 1;
    return kids.map((k, i) => `${start + i}. ${extractPlainTextFromNoteDoc(k)}`).join("\n");
  }
  if (node.type === "bulletList") {
    return kids.map((k) => `• ${extractPlainTextFromNoteDoc(k)}`).join("\n");
  }
  return kids.map(extractPlainTextFromNoteDoc).join("\n");
}

/**
 * Normalizes and sanitizes note tags: trims, removes `<` `>` control chars, deduplicates.
 */
export function normalizeNoteTags(rawTags: unknown): string[] {
  if (!Array.isArray(rawTags)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of rawTags) {
    if (typeof item !== "string") continue;
    const clean = stripUnsafeText(item)
      .replace(/[<>]/g, "")
      .trim()
      .replace(/\s+/g, " ")
      .slice(0, MAX_TAG_LENGTH);
    if (!clean) continue;
    const key = clean.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(clean);
    if (result.length >= MAX_TAGS_PER_NOTE) break;
  }
  return result;
}

export const createNoteInputSchema = z
  .object({
    title: z.string().max(MAX_TITLE_LENGTH).optional(),
    body: z.string().max(MAX_DOC_JSON_BYTES).optional(),
    doc: z.record(z.string(), z.unknown()).optional(),
    tags: z.array(z.string().max(MAX_TAG_LENGTH)).max(MAX_TAGS_PER_NOTE).optional(),
    color: z.enum(NOTE_COLORS).nullable().optional(),
    pinned: z.boolean().optional(),
    linkedLeadId: z.string().trim().min(1).max(64).nullable().optional(),
    linkedProjectId: z.string().trim().min(1).max(64).nullable().optional(),
  })
  .strict();

export const updateNoteInputSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    title: z.string().max(MAX_TITLE_LENGTH).optional(),
    body: z.string().max(MAX_DOC_JSON_BYTES).optional(),
    doc: z.record(z.string(), z.unknown()).optional(),
    tags: z.array(z.string().max(MAX_TAG_LENGTH)).max(MAX_TAGS_PER_NOTE).optional(),
    color: z.enum(NOTE_COLORS).nullable().optional(),
    pinned: z.boolean().optional(),
    linkedLeadId: z.string().trim().min(1).max(64).nullable().optional(),
    linkedProjectId: z.string().trim().min(1).max(64).nullable().optional(),
  })
  .strict();

export const pinNoteInputSchema = z
  .object({
    pinned: z.boolean(),
    expectedVersion: z.number().int().positive().optional(),
  })
  .strict();

export interface ListNotesParams {
  q?: string | undefined;
  tag?: string | undefined;
  pinned?: boolean | undefined;
  leadId?: string | undefined;
  projectId?: string | undefined;
  sort?: NoteSortApi | undefined;
  limit?: number | undefined;
}

function parseTagsJson(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return normalizeNoteTags(parsed);
  } catch {
    return [];
  }
}

function parseDocJson(raw: string, fallbackBody: string): SanitizedNoteDoc {
  try {
    const parsed: unknown = JSON.parse(raw);
    return sanitizeServerNoteDoc(parsed);
  } catch {
    return plainTextToNoteDoc(fallbackBody);
  }
}

function normalizeColor(raw: string | null | undefined): NoteColorApi {
  if (raw && (NOTE_COLORS as readonly string[]).includes(raw)) {
    return raw as NoteColorApi;
  }
  return "default";
}

async function resolveLinkedNames(
  db: CrmDatabase,
  ownerUserId: string,
  leadIds: string[],
  projectIds: string[],
): Promise<{ leads: Map<string, string>; projects: Map<string, string> }> {
  const leads = new Map<string, string>();
  const projects = new Map<string, string>();

  const uniqueLeadIds = [...new Set(leadIds.filter(Boolean))];
  if (uniqueLeadIds.length > 0) {
    const rows = await db
      .select({ id: crmLeads.id, name: crmLeads.name })
      .from(crmLeads)
      .where(and(eq(crmLeads.ownerUserId, ownerUserId), inArray(crmLeads.id, uniqueLeadIds)));
    for (const r of rows) {
      leads.set(r.id, r.name);
    }
  }

  const uniqueProjectIds = [...new Set(projectIds.filter(Boolean))];
  if (uniqueProjectIds.length > 0) {
    const rows = await db
      .select({ id: crmProjects.id, name: crmProjects.name })
      .from(crmProjects)
      .where(
        and(eq(crmProjects.ownerUserId, ownerUserId), inArray(crmProjects.id, uniqueProjectIds)),
      );
    for (const r of rows) {
      projects.set(r.id, r.name);
    }
  }

  return { leads, projects };
}

function toNoteDto(
  row: typeof crmPersonalNotes.$inferSelect,
  leadNames: Map<string, string>,
  projectNames: Map<string, string>,
): PersonalNoteDto {
  const doc = parseDocJson(row.docJson, row.bodyText);
  return {
    id: row.id,
    title: row.title,
    body: row.bodyText,
    doc,
    tags: parseTagsJson(row.tagsJson),
    color: normalizeColor(row.color),
    pinned: Boolean(row.isPinned),
    linkedLeadId: row.linkedLeadId ?? null,
    linkedLeadName: row.linkedLeadId ? (leadNames.get(row.linkedLeadId) ?? null) : null,
    linkedProjectId: row.linkedProjectId ?? null,
    linkedProjectName: row.linkedProjectId ? (projectNames.get(row.linkedProjectId) ?? null) : null,
    version: row.version,
    createdAt: parseUtcDateTime(row.createdAt).toISOString(),
    updatedAt: parseUtcDateTime(row.updatedAt).toISOString(),
  };
}

async function verifyOwnerLinkedEntities(
  db: CrmDatabase,
  ownerUserId: string,
  linkedLeadId: string | null | undefined,
  linkedProjectId: string | null | undefined,
): Promise<void> {
  if (linkedLeadId) {
    const rows = await db
      .select({ id: crmLeads.id })
      .from(crmLeads)
      .where(and(eq(crmLeads.id, linkedLeadId), eq(crmLeads.ownerUserId, ownerUserId)))
      .limit(1);
    if (rows.length === 0) {
      throw new CrmServiceError(404, "not_found", "Linked lead was not found.");
    }
  }

  if (linkedProjectId) {
    const rows = await db
      .select({ id: crmProjects.id })
      .from(crmProjects)
      .where(and(eq(crmProjects.id, linkedProjectId), eq(crmProjects.ownerUserId, ownerUserId)))
      .limit(1);
    if (rows.length === 0) {
      throw new CrmServiceError(404, "not_found", "Linked project was not found.");
    }
  }
}

export async function listPersonalNotes(
  db: CrmDatabase,
  ownerUserId: string,
  params: ListNotesParams = {},
): Promise<{ items: PersonalNoteDto[]; total: number }> {
  const limit = Math.max(1, Math.min(200, params.limit ?? 100));
  const sort: NoteSortApi = params.sort ?? "recent";

  const conditions = [
    eq(crmPersonalNotes.ownerUserId, ownerUserId),
    isNull(crmPersonalNotes.archivedAt),
  ];

  if (params.pinned !== undefined) {
    conditions.push(eq(crmPersonalNotes.isPinned, params.pinned));
  }
  if (params.leadId) {
    conditions.push(eq(crmPersonalNotes.linkedLeadId, params.leadId));
  }
  if (params.projectId) {
    conditions.push(eq(crmPersonalNotes.linkedProjectId, params.projectId));
  }
  if (params.q && params.q.trim()) {
    const needle = `%${params.q.trim().toLowerCase()}%`;
    conditions.push(
      sql`(LOWER(${crmPersonalNotes.title}) LIKE ${needle} OR LOWER(${crmPersonalNotes.bodyText}) LIKE ${needle} OR LOWER(${crmPersonalNotes.tagsJson}) LIKE ${needle})`,
    );
  }

  const orderBy =
    sort === "title"
      ? [desc(crmPersonalNotes.isPinned), asc(crmPersonalNotes.title)]
      : sort === "created"
        ? [desc(crmPersonalNotes.isPinned), desc(crmPersonalNotes.createdAt)]
        : [desc(crmPersonalNotes.isPinned), desc(crmPersonalNotes.updatedAt)];

  const rows = await db
    .select()
    .from(crmPersonalNotes)
    .where(and(...conditions))
    .orderBy(...orderBy)
    .limit(limit);

  const tagFilter = params.tag?.trim().toLowerCase();
  const filteredRows = tagFilter
    ? rows.filter((r) => parseTagsJson(r.tagsJson).some((t) => t.toLowerCase() === tagFilter))
    : rows;

  const { leads, projects } = await resolveLinkedNames(
    db,
    ownerUserId,
    filteredRows.map((r) => r.linkedLeadId ?? ""),
    filteredRows.map((r) => r.linkedProjectId ?? ""),
  );

  const items = filteredRows.map((r) => toNoteDto(r, leads, projects));
  return { items, total: items.length };
}

export async function getPersonalNoteById(
  db: CrmDatabase,
  ownerUserId: string,
  noteId: string,
): Promise<PersonalNoteDto> {
  const rows = await db
    .select()
    .from(crmPersonalNotes)
    .where(
      and(
        eq(crmPersonalNotes.id, noteId),
        eq(crmPersonalNotes.ownerUserId, ownerUserId),
        isNull(crmPersonalNotes.archivedAt),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (!row) {
    throw new CrmServiceError(404, "not_found", "Note not found.");
  }

  const { leads, projects } = await resolveLinkedNames(
    db,
    ownerUserId,
    row.linkedLeadId ? [row.linkedLeadId] : [],
    row.linkedProjectId ? [row.linkedProjectId] : [],
  );

  return toNoteDto(row, leads, projects);
}

export async function createPersonalNote(
  db: CrmDatabase,
  ownerUserId: string,
  rawInput: unknown,
  now: Date = new Date(),
): Promise<PersonalNoteDto> {
  const input = createNoteInputSchema.parse(rawInput);

  await verifyOwnerLinkedEntities(db, ownerUserId, input.linkedLeadId, input.linkedProjectId);

  const title = stripUnsafeText(input.title ?? "")
    .trim()
    .slice(0, MAX_TITLE_LENGTH);
  const cleanDoc = input.doc
    ? sanitizeServerNoteDoc(input.doc)
    : input.body !== undefined
      ? plainTextToNoteDoc(input.body)
      : EMPTY_NOTE_DOC;
  const bodyText = extractPlainTextFromNoteDoc(cleanDoc);
  const tags = normalizeNoteTags(input.tags ?? []);
  const color = normalizeColor(input.color);
  const nowMysql = toMysqlUtcDateTime(now);
  const id = generateServerId("note");

  await db.insert(crmPersonalNotes).values({
    id,
    ownerUserId,
    title,
    bodyText,
    docJson: JSON.stringify(cleanDoc),
    tagsJson: JSON.stringify(tags),
    color,
    isPinned: Boolean(input.pinned),
    linkedLeadId: input.linkedLeadId ?? null,
    linkedProjectId: input.linkedProjectId ?? null,
    version: 1,
    archivedAt: null,
    createdAt: nowMysql,
    updatedAt: nowMysql,
  });

  return getPersonalNoteById(db, ownerUserId, id);
}

export async function updatePersonalNote(
  db: CrmDatabase,
  ownerUserId: string,
  noteId: string,
  rawInput: unknown,
  now: Date = new Date(),
): Promise<PersonalNoteDto> {
  const input = updateNoteInputSchema.parse(rawInput);

  const existingRows = await db
    .select()
    .from(crmPersonalNotes)
    .where(
      and(
        eq(crmPersonalNotes.id, noteId),
        eq(crmPersonalNotes.ownerUserId, ownerUserId),
        isNull(crmPersonalNotes.archivedAt),
      ),
    )
    .limit(1);

  const existing = existingRows[0];
  if (!existing) {
    throw new CrmServiceError(404, "not_found", "Note not found.");
  }

  if (existing.version !== input.expectedVersion) {
    const latest = await getPersonalNoteById(db, ownerUserId, noteId);
    throw new CrmServiceError(
      409,
      "stale_conflict",
      "This note was updated elsewhere. Review the latest version before saving.",
      {
        details: {
          expectedVersion: input.expectedVersion,
          currentVersion: existing.version,
          latest,
        },
      },
    );
  }

  const nextLeadId = input.linkedLeadId !== undefined ? input.linkedLeadId : existing.linkedLeadId;
  const nextProjectId =
    input.linkedProjectId !== undefined ? input.linkedProjectId : existing.linkedProjectId;

  await verifyOwnerLinkedEntities(
    db,
    ownerUserId,
    input.linkedLeadId !== undefined ? input.linkedLeadId : null,
    input.linkedProjectId !== undefined ? input.linkedProjectId : null,
  );

  const nextTitle =
    input.title !== undefined
      ? stripUnsafeText(input.title).trim().slice(0, MAX_TITLE_LENGTH)
      : existing.title;

  let nextDocJson = existing.docJson;
  let nextBodyText = existing.bodyText;
  if (input.doc !== undefined) {
    const cleanDoc = sanitizeServerNoteDoc(input.doc);
    nextDocJson = JSON.stringify(cleanDoc);
    nextBodyText = extractPlainTextFromNoteDoc(cleanDoc);
  } else if (input.body !== undefined) {
    const cleanDoc = plainTextToNoteDoc(input.body);
    nextDocJson = JSON.stringify(cleanDoc);
    nextBodyText = extractPlainTextFromNoteDoc(cleanDoc);
  }

  const nextTagsJson =
    input.tags !== undefined ? JSON.stringify(normalizeNoteTags(input.tags)) : existing.tagsJson;
  const nextColor =
    input.color !== undefined ? normalizeColor(input.color) : normalizeColor(existing.color);
  const nextPinned = input.pinned !== undefined ? input.pinned : existing.isPinned;
  const nowMysql = toMysqlUtcDateTime(now);

  const updateRes = await db
    .update(crmPersonalNotes)
    .set({
      title: nextTitle,
      bodyText: nextBodyText,
      docJson: nextDocJson,
      tagsJson: nextTagsJson,
      color: nextColor,
      isPinned: nextPinned,
      linkedLeadId: nextLeadId ?? null,
      linkedProjectId: nextProjectId ?? null,
      version: existing.version + 1,
      updatedAt: nowMysql,
    })
    .where(
      and(
        eq(crmPersonalNotes.id, noteId),
        eq(crmPersonalNotes.ownerUserId, ownerUserId),
        isNull(crmPersonalNotes.archivedAt),
        eq(crmPersonalNotes.version, input.expectedVersion),
      ),
    );

  const affected =
    Array.isArray(updateRes) &&
    updateRes[0] &&
    typeof updateRes[0] === "object" &&
    "affectedRows" in updateRes[0]
      ? Number((updateRes[0] as { affectedRows?: number }).affectedRows ?? 0)
      : 1;

  if (affected === 0) {
    const latest = await getPersonalNoteById(db, ownerUserId, noteId);
    throw new CrmServiceError(
      409,
      "stale_conflict",
      "This note was updated concurrently. Review the latest version before saving.",
      {
        details: { expectedVersion: input.expectedVersion, currentVersion: latest.version, latest },
      },
    );
  }

  return getPersonalNoteById(db, ownerUserId, noteId);
}

export async function pinPersonalNote(
  db: CrmDatabase,
  ownerUserId: string,
  noteId: string,
  rawInput: unknown,
  now: Date = new Date(),
): Promise<PersonalNoteDto> {
  const input = pinNoteInputSchema.parse(rawInput);

  const existing = await getPersonalNoteById(db, ownerUserId, noteId);
  const expectedVersion = input.expectedVersion ?? existing.version;

  return updatePersonalNote(
    db,
    ownerUserId,
    noteId,
    { expectedVersion, pinned: input.pinned },
    now,
  );
}

/**
 * Soft-archives a note (`archived_at = NOW()`) so accidental deletes never destroy data irreversibly.
 */
export async function deletePersonalNote(
  db: CrmDatabase,
  ownerUserId: string,
  noteId: string,
  now: Date = new Date(),
): Promise<{ id: string; deleted: true; archivedAt: string }> {
  const existing = await getPersonalNoteById(db, ownerUserId, noteId);
  const nowMysql = toMysqlUtcDateTime(now);

  await db
    .update(crmPersonalNotes)
    .set({
      archivedAt: nowMysql,
      version: existing.version + 1,
      updatedAt: nowMysql,
    })
    .where(
      and(
        eq(crmPersonalNotes.id, noteId),
        eq(crmPersonalNotes.ownerUserId, ownerUserId),
        isNull(crmPersonalNotes.archivedAt),
      ),
    );

  return {
    id: noteId,
    deleted: true,
    archivedAt: parseUtcDateTime(nowMysql).toISOString(),
  };
}
