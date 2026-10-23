// Pure rules for Personal Notes: legacy conversion, safe documents, plain text, search, sort.
import type { Note, NoteDoc } from "./types";

const BLOCKS = new Set(["doc", "paragraph", "bulletList", "orderedList", "listItem", "taskList", "taskItem", "text", "hardBreak"]);
const MARKS = new Set(["bold", "italic"]);

/** Legacy plain-text body → paragraphs (one per line). Lossless: the original text is reproduced by docToText. */
export function legacyToDoc(body: string): NoteDoc {
  const lines = body.replace(/\r\n?/g, "\n").split("\n");
  return { type: "doc", content: lines.map((l) => (l ? { type: "paragraph", content: [{ type: "text", text: l }] } : { type: "paragraph" })) };
}

/** Keep only supported nodes/marks; unknown nodes keep their text as paragraphs so nothing is lost. */
export function sanitizeDoc(n: NoteDoc): NoteDoc {
  if (n.type === "text") {
    const marks = (n.marks ?? []).filter((m) => MARKS.has(m.type)).map((m) => ({ type: m.type }));
    return { type: "text", text: String(n.text ?? ""), ...(marks.length ? { marks } : {}) };
  }
  if (!BLOCKS.has(n.type)) return { type: "paragraph", content: [{ type: "text", text: docToText(n) || " " }] };
  const out: NoteDoc = { type: n.type };
  if (n.type === "taskItem") out.attrs = { checked: n.attrs?.checked === true };
  if (n.type === "orderedList") out.attrs = { start: Number.isInteger(n.attrs?.start) ? (n.attrs!.start as number) : 1 };
  if (n.content) out.content = n.content.filter((c) => !(c.type === "text" && !c.text)).map(sanitizeDoc);
  return out;
}

export function noteDoc(n: Pick<Note, "doc" | "body">): NoteDoc {
  return n.doc ? sanitizeDoc(n.doc) : legacyToDoc(n.body ?? "");
}

/** Plain text: blocks on new lines; checklist items prefixed so previews stay meaningful. */
export function docToText(n: NoteDoc): string {
  if (n.type === "text") return n.text ?? "";
  if (n.type === "hardBreak") return "\n";
  const kids = n.content ?? [];
  if (n.type === "paragraph") return kids.map(docToText).join("");
  if (n.type === "taskItem") return `${n.attrs?.checked ? "☑" : "☐"} ${kids.map(docToText).join("\n")}`;
  if (n.type === "orderedList") return kids.map((k, i) => `${((n.attrs?.start as number) ?? 1) + i}. ${docToText(k)}`).join("\n");
  if (n.type === "bulletList") return kids.map((k) => `• ${docToText(k)}`).join("\n");
  return kids.map(docToText).join("\n");
}

export function checklistProgress(n: NoteDoc): { done: number; total: number } {
  let done = 0, total = 0;
  const walk = (x: NoteDoc) => { if (x.type === "taskItem") { total++; if (x.attrs?.checked) done++; } x.content?.forEach(walk); };
  walk(n);
  return { done, total };
}

export type NoteSort = "recent" | "title" | "created";

export function filterNotes(notes: Note[], q: string, sort: NoteSort = "recent"): Note[] {
  const needle = q.trim().toLowerCase();
  const hit = notes.filter((n) => !needle || `${n.title}\n${n.body}\n${n.tag ?? ""}`.toLowerCase().includes(needle));
  const by = (a: Note, b: Note) => sort === "title" ? a.title.localeCompare(b.title) : sort === "created" ? b.createdAt.localeCompare(a.createdAt) : b.updatedAt.localeCompare(a.updatedAt);
  return [...hit].sort((a, b) => Number(b.pinned) - Number(a.pinned) || by(a, b));
}

/** Build the saved note from editor output; body is always regenerated from the document. */
export function withDoc(n: Note, title: string, doc: NoteDoc, at: string): Note {
  const clean = sanitizeDoc(doc);
  return { ...n, title, doc: clean, body: docToText(clean), updatedAt: at };
}
