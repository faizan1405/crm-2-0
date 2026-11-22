import { describe, expect, it } from "vitest";
import { handleApiRequest } from "./http/apiRouter.server";
import {
  createPersonalNote,
  deletePersonalNote,
  extractPlainTextFromNoteDoc,
  getPersonalNoteById,
  listPersonalNotes,
  normalizeNoteTags,
  pinPersonalNote,
  sanitizeServerNoteDoc,
  updatePersonalNote,
} from "./crm/notesService.server";
import { CrmServiceError } from "./crm/errors.server";
import type { CrmDatabase } from "./db/index.server";

interface InMemoryNoteRow {
  id: string;
  ownerUserId: string;
  title: string;
  bodyText: string;
  docJson: string;
  tagsJson: string;
  color: string | null;
  isPinned: boolean;
  linkedLeadId: string | null;
  linkedProjectId: string | null;
  version: number;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Lightweight stateful mock of Drizzle DB operations for `crm_personal_notes`,
 * `crm_leads`, and `crm_projects` so CRUD, concurrency, linking, and Owner
 * isolation are verified deterministically without touching any live database.
 */
function createInMemoryNotesDb(seed?: {
  leads?: Array<{ id: string; ownerUserId: string; name: string }>;
  projects?: Array<{ id: string; ownerUserId: string; name: string }>;
}) {
  const notes = new Map<string, InMemoryNoteRow>();
  const leads = new Map((seed?.leads ?? []).map((l) => [l.id, l]));
  const projects = new Map((seed?.projects ?? []).map((p) => [p.id, p]));

  function extractParams(whereClause: unknown): unknown[] {
    const out: unknown[] = [];
    const visit = (node: unknown) => {
      if (!node) return;
      if (Array.isArray(node)) {
        for (const item of node) visit(item);
        return;
      }
      if (typeof node !== "object") return;
      if ("value" in node && !("queryChunks" in node)) {
        const val = (node as { value: unknown }).value;
        if (Array.isArray(val)) {
          for (const item of val) visit(item);
        } else {
          out.push(val);
        }
        return;
      }
      if (
        "queryChunks" in node &&
        Array.isArray((node as { queryChunks: unknown[] }).queryChunks)
      ) {
        for (const chunk of (node as { queryChunks: unknown[] }).queryChunks) {
          visit(chunk);
        }
      }
    };
    visit(whereClause);
    return out;
  }

  function tableNameOf(table: unknown): string {
    if (!table || typeof table !== "object") return "";
    const syms = Object.getOwnPropertySymbols(table);
    for (const sym of syms) {
      if (String(sym).includes("drizzle:Name")) {
        return String((table as Record<symbol, unknown>)[sym]);
      }
    }
    return "";
  }

  const db = {
    select: () => ({
      from: (table: unknown) => {
        const tName = tableNameOf(table);
        let whereExpr: unknown = null;
        let limitNum = 200;

        const run = async (): Promise<unknown[]> => {
          const vals = extractParams(whereExpr);

          if (tName === "crm_leads") {
            return [...leads.values()].filter((l) => {
              const ownerMatch = vals.includes(l.ownerUserId);
              const idMatch = vals.some(
                (v) => v === l.id || (Array.isArray(v) && v.includes(l.id)),
              );
              return ownerMatch && idMatch;
            });
          }

          if (tName === "crm_projects") {
            return [...projects.values()].filter((p) => {
              const ownerMatch = vals.includes(p.ownerUserId);
              const idMatch = vals.some(
                (v) => v === p.id || (Array.isArray(v) && v.includes(p.id)),
              );
              return ownerMatch && idMatch;
            });
          }

          if (tName === "crm_personal_notes") {
            let rows = [...notes.values()].filter((n) => n.archivedAt === null);
            const ownerVal = vals.find((v) => typeof v === "string" && v.startsWith("usr_"));
            if (ownerVal) rows = rows.filter((n) => n.ownerUserId === ownerVal);
            const idVal = vals.find((v) => typeof v === "string" && v.startsWith("note_"));
            if (idVal) rows = rows.filter((n) => n.id === idVal);
            const leadVal = vals.find((v) => typeof v === "string" && v.startsWith("lead_"));
            if (leadVal) rows = rows.filter((n) => n.linkedLeadId === leadVal);
            const projVal = vals.find((v) => typeof v === "string" && v.startsWith("proj_"));
            if (projVal) rows = rows.filter((n) => n.linkedProjectId === projVal);
            const pinnedVal = vals.find((v) => typeof v === "boolean");
            if (pinnedVal !== undefined) rows = rows.filter((n) => n.isPinned === pinnedVal);
            const likeVal = vals.find(
              (v) => typeof v === "string" && v.startsWith("%") && v.endsWith("%"),
            ) as string | undefined;
            if (likeVal) {
              const needle = likeVal.slice(1, -1).toLowerCase();
              rows = rows.filter((n) =>
                `${n.title}\n${n.bodyText}\n${n.tagsJson}`.toLowerCase().includes(needle),
              );
            }
            rows.sort(
              (a, b) =>
                Number(b.isPinned) - Number(a.isPinned) || b.updatedAt.localeCompare(a.updatedAt),
            );
            return rows.slice(0, limitNum);
          }

          return [];
        };

        const chain = {
          where: (w: unknown) => {
            whereExpr = w;
            return chain;
          },
          orderBy: () => chain,
          limit: (n: number) => {
            limitNum = n;
            return chain;
          },
          then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) =>
            run().then(resolve, reject),
        };
        return chain;
      },
    }),

    insert: () => ({
      values: async (row: InMemoryNoteRow) => {
        notes.set(row.id, { ...row });
        return [{ affectedRows: 1 }];
      },
    }),

    update: () => ({
      set: (patch: Partial<InMemoryNoteRow>) => ({
        where: async (whereExpr: unknown) => {
          const vals = extractParams(whereExpr);
          const idVal = vals.find((v) => typeof v === "string" && v.startsWith("note_")) as
            string | undefined;
          const ownerVal = vals.find((v) => typeof v === "string" && v.startsWith("usr_")) as
            string | undefined;
          const versionVal = vals.find((v) => typeof v === "number") as number | undefined;

          if (!idVal) return [{ affectedRows: 0 }];
          const existing = notes.get(idVal);
          if (!existing || existing.archivedAt !== null) return [{ affectedRows: 0 }];
          if (ownerVal && existing.ownerUserId !== ownerVal) return [{ affectedRows: 0 }];
          if (versionVal !== undefined && existing.version !== versionVal) {
            return [{ affectedRows: 0 }];
          }

          notes.set(idVal, { ...existing, ...patch });
          return [{ affectedRows: 1 }];
        },
      }),
    }),
  };

  return { db: db as unknown as CrmDatabase, notes };
}

describe("B16B Personal Notes — Sanitization, XSS Prevention, CRUD, Concurrency & Access Control", () => {
  it("strips dangerous XSS nodes, script tags, javascript links, and untrusted attrs while preserving rich Tiptap formatting", () => {
    const maliciousDoc = {
      type: "doc",
      content: [
        { type: "script", content: [{ type: "text", text: "alert(1)" }] },
        { type: "iframe", attrs: { src: "https://evil.example/x" } },
        {
          type: "paragraph",
          attrs: { onclick: "stealCookies()", style: "color:red" },
          content: [
            {
              type: "text",
              text: "Client call summary",
              marks: [
                { type: "bold" },
                { type: "link", attrs: { href: "javascript:alert(1)" } },
                { type: "italic" },
              ],
            },
          ],
        },
        {
          type: "taskList",
          content: [
            {
              type: "taskItem",
              attrs: { checked: true, onclick: "evil()" },
              content: [{ type: "paragraph", content: [{ type: "text", text: "Send proposal" }] }],
            },
          ],
        },
      ],
    };

    const clean = sanitizeServerNoteDoc(maliciousDoc);
    const serialized = JSON.stringify(clean);

    expect(serialized).not.toContain("script");
    expect(serialized).not.toContain("iframe");
    expect(serialized).not.toContain("onclick");
    expect(serialized).not.toContain("javascript:");
    expect(serialized).not.toContain("stealCookies");
    expect(serialized).toContain("Client call summary");
    expect(serialized).toContain("bold");
    expect(serialized).toContain("italic");
    expect(serialized).toContain("taskList");

    const plain = extractPlainTextFromNoteDoc(clean);
    expect(plain).toContain("Client call summary");
    expect(plain).toContain("☑ Send proposal");
  });

  it("normalizes tags safely, removing HTML brackets, duplicates, and enforcing count/length caps", () => {
    const tags = normalizeNoteTags([
      "  Sales  ",
      "sales",
      "<script>urgent</script>",
      "Follow-Up",
      "",
      "   ",
    ]);
    expect(tags).toEqual(["Sales", "scripturgent/script", "Follow-Up"]);
  });

  it("supports full CRUD, search, tags, pinning, Lead/Project linking, and soft-archive deletion", async () => {
    const { db, notes } = createInMemoryNotesDb({
      leads: [{ id: "lead_owner_a_1", ownerUserId: "usr_owner_a", name: "Acme Corp" }],
      projects: [{ id: "proj_owner_a_1", ownerUserId: "usr_owner_a", name: "Acme Website" }],
    });

    const created = await createPersonalNote(db, "usr_owner_a", {
      title: "Discovery Call Notes",
      doc: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "Budget confirmed at 75k", marks: [{ type: "bold" }] }],
          },
        ],
      },
      tags: ["Discovery", "High-Intent"],
      linkedLeadId: "lead_owner_a_1",
      linkedProjectId: "proj_owner_a_1",
    });

    expect(created.id).toMatch(/^note_/);
    expect(created.version).toBe(1);
    expect(created.linkedLeadName).toBe("Acme Corp");
    expect(created.linkedProjectName).toBe("Acme Website");
    expect(created.tags).toEqual(["Discovery", "High-Intent"]);
    expect(created.body).toBe("Budget confirmed at 75k");

    // Search by body & tag
    const searchRes = await listPersonalNotes(db, "usr_owner_a", { q: "75k", tag: "discovery" });
    expect(searchRes.items).toHaveLength(1);
    expect(searchRes.items[0]?.id).toBe(created.id);

    // Pin toggle increments version
    const pinned = await pinPersonalNote(db, "usr_owner_a", created.id, {
      pinned: true,
      expectedVersion: 1,
    });
    expect(pinned.pinned).toBe(true);
    expect(pinned.version).toBe(2);

    // Update content with valid version
    const updated = await updatePersonalNote(db, "usr_owner_a", created.id, {
      expectedVersion: 2,
      title: "Discovery Call Notes (Final)",
      tags: ["Discovery", "Proposal"],
    });
    expect(updated.version).toBe(3);
    expect(updated.title).toBe("Discovery Call Notes (Final)");

    // Soft-archive delete preserves row in DB but hides from active queries
    const del = await deletePersonalNote(db, "usr_owner_a", created.id);
    expect(del.deleted).toBe(true);
    expect(notes.get(created.id)?.archivedAt).not.toBeNull();
    await expect(getPersonalNoteById(db, "usr_owner_a", created.id)).rejects.toThrow(
      CrmServiceError,
    );
  });

  it("prevents overwriting concurrent edits with 409 stale_conflict and returns latest version", async () => {
    const { db } = createInMemoryNotesDb();
    const created = await createPersonalNote(db, "usr_owner_a", {
      title: "Initial",
      body: "v1 text",
    });

    await updatePersonalNote(db, "usr_owner_a", created.id, {
      expectedVersion: 1,
      title: "Updated in Tab B",
      body: "v2 text",
    });

    await expect(
      updatePersonalNote(db, "usr_owner_a", created.id, {
        expectedVersion: 1, // stale!
        title: "Stale Tab A Edit",
        body: "stale text",
      }),
    ).rejects.toMatchObject({
      status: 409,
      code: "stale_conflict",
    });

    const latest = await getPersonalNoteById(db, "usr_owner_a", created.id);
    expect(latest.title).toBe("Updated in Tab B");
    expect(latest.version).toBe(2);
  });

  it("enforces strict Owner isolation across notes, leads, and projects", async () => {
    const { db } = createInMemoryNotesDb({
      leads: [{ id: "lead_owner_a_1", ownerUserId: "usr_owner_a", name: "Owner A Lead" }],
      projects: [{ id: "proj_owner_a_1", ownerUserId: "usr_owner_a", name: "Owner A Project" }],
    });

    const ownerANote = await createPersonalNote(db, "usr_owner_a", {
      title: "Private Owner A Strategy",
      body: "Confidential",
    });

    // Owner B cannot read, update, pin, or delete Owner A's note
    await expect(getPersonalNoteById(db, "usr_owner_b", ownerANote.id)).rejects.toMatchObject({
      status: 404,
      code: "not_found",
    });
    await expect(
      updatePersonalNote(db, "usr_owner_b", ownerANote.id, { expectedVersion: 1, title: "Hacked" }),
    ).rejects.toMatchObject({ status: 404, code: "not_found" });
    await expect(deletePersonalNote(db, "usr_owner_b", ownerANote.id)).rejects.toMatchObject({
      status: 404,
      code: "not_found",
    });

    // Owner B cannot link Owner A's Lead or Project
    await expect(
      createPersonalNote(db, "usr_owner_b", {
        title: "Cross-tenant link attempt",
        linkedLeadId: "lead_owner_a_1",
      }),
    ).rejects.toMatchObject({ status: 404, code: "not_found" });

    await expect(
      createPersonalNote(db, "usr_owner_b", {
        title: "Cross-tenant project attempt",
        linkedProjectId: "proj_owner_a_1",
      }),
    ).rejects.toMatchObject({ status: 404, code: "not_found" });
  });

  it("enforces fail-closed auth, CSRF origin checks, and method validation on /api/v1/notes HTTP routes", async () => {
    const unauthGet = await handleApiRequest(
      new Request("https://crm2.joinscaleflow.in/api/v1/notes", { method: "GET" }),
    );
    expect([401, 503]).toContain(unauthGet?.status);

    const csrfPost = await handleApiRequest(
      new Request("https://crm2.joinscaleflow.in/api/v1/notes", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://evil.example.invalid",
        },
        body: JSON.stringify({ title: "CSRF Test" }),
      }),
    );
    expect(csrfPost?.status).toBe(403);

    const badMethod = await handleApiRequest(
      new Request("https://crm2.joinscaleflow.in/api/v1/notes", { method: "PUT" }),
    );
    expect(badMethod?.status).toBe(405);
  });
});
