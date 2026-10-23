import { describe, it, expect, beforeEach } from "vitest";
import { legacyToDoc, docToText, sanitizeDoc, filterNotes, withDoc, noteDoc, checklistProgress } from "./notes";
import type { Note, NoteDoc } from "./types";
import { useCRM } from "./store";

const note = (o: Partial<Note>): Note => ({ id: "n", title: "T", body: "", pinned: false, createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-01T00:00:00Z", ...o });
const p = (t: string): NoteDoc => ({ type: "paragraph", content: [{ type: "text", text: t }] });
const task = (t: string, checked: boolean): NoteDoc => ({ type: "taskItem", attrs: { checked }, content: [p(t)] });

describe("personal notes rules", () => {
  beforeEach(() => useCRM.getState().reset());

  it("legacy notes convert without losing any text, including blank lines", () => {
    const body = "Line one\n\nLine three\n  indented";
    expect(docToText(legacyToDoc(body))).toBe(body);
    expect(noteDoc(note({ body }))).toEqual(legacyToDoc(body));
  });

  it("checklist checked state survives save and reload through the store", () => {
    const doc: NoteDoc = { type: "doc", content: [{ type: "taskList", content: [task("Call client", true), task("Send quotation", false)] }] };
    const saved = withDoc(note({ id: "n1" }), "Today", doc, "2026-10-23T10:00:00Z");
    useCRM.getState().saveNote(saved);
    const back = useCRM.getState().notes.find((n) => n.id === "n1")!;
    expect(checklistProgress(noteDoc(back))).toEqual({ done: 1, total: 2 });
    expect(back.body).toBe("☐ Call client".replace("☐", "☑") + "\n☐ Send quotation");
  });

  it("numbered and bullet lists keep structure and numbering", () => {
    const doc: NoteDoc = { type: "doc", content: [
      { type: "orderedList", attrs: { start: 1 }, content: [{ type: "listItem", content: [p("Call")] }, { type: "listItem", content: [p("Quote")] }] },
      { type: "bulletList", content: [{ type: "listItem", content: [p("Responsive")] }] },
    ] };
    expect(docToText(sanitizeDoc(doc))).toBe("1. Call\n2. Quote\n• Responsive");
  });

  it("keeps only bold and italic marks and drops unsafe nodes but keeps their text", () => {
    const doc: NoteDoc = { type: "doc", content: [
      { type: "paragraph", content: [{ type: "text", text: "hi", marks: [{ type: "bold" }, { type: "link" }, { type: "italic" }] }] },
      { type: "iframe", content: [{ type: "text", text: "kept text" }] },
    ] };
    const s = sanitizeDoc(doc);
    expect(s.content![0]!.content![0]!.marks).toEqual([{ type: "bold" }, { type: "italic" }]);
    expect(s.content![1]).toEqual(p("kept text"));
  });

  it("search matches title and content; pinned notes stay on top", () => {
    const list = [note({ id: "a", title: "Groceries", body: "milk", updatedAt: "2026-10-03" }), note({ id: "b", title: "Ideas", body: "call Vikram", pinned: true, updatedAt: "2026-10-01" }), note({ id: "c", title: "Zeta", body: "", updatedAt: "2026-10-05" })];
    expect(filterNotes(list, "vikram").map((n) => n.id)).toEqual(["b"]);
    expect(filterNotes(list, "grocer").map((n) => n.id)).toEqual(["a"]);
    expect(filterNotes(list, "").map((n) => n.id)).toEqual(["b", "c", "a"]);
    expect(filterNotes(list, "", "title").map((n) => n.id)).toEqual(["b", "a", "c"]);
  });

  it("saving a note preserves created date, pin and tag", () => {
    const n = note({ id: "x", pinned: true, tag: "work", createdAt: "2026-01-01T00:00:00Z" });
    const s = withDoc(n, "New", legacyToDoc("a"), "2026-10-23T00:00:00Z");
    expect(s).toMatchObject({ pinned: true, tag: "work", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-10-23T00:00:00Z", body: "a" });
  });
});
