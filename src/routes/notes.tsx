import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useEditor, EditorContent, useEditorState, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { TaskList, TaskItem } from "@tiptap/extension-list";
import { Pin, Trash2, Search, StickyNote, Plus, Bold, Italic, List, ListOrdered, ListChecks, Pilcrow, Undo2, Redo2, ArrowLeft, Check, Loader2, AlertCircle } from "lucide-react";
import { Shell, Empty, selectCls } from "@/components/crm/Shell";
import { useCRM } from "@/lib/crm/store";
import { uid, relative } from "@/lib/crm/format";
import type { Note, NoteDoc } from "@/lib/crm/types";
import { filterNotes, noteDoc, withDoc, checklistProgress, type NoteSort } from "@/lib/crm/notes";
import { createAutosaver, type SaveStatus } from "@/lib/crm/autosave";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/notes")({
  head: () => ({
    meta: [
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { title: "Personal Notes · Scale Flow Sales OS" },
      { name: "description", content: "Private notes with checklists, numbered and bullet lists, saved automatically." },
      { property: "og:title", content: "Personal Notes · Scale Flow Sales OS" },
      { property: "og:description", content: "Private notes with checklists, numbered and bullet lists, saved automatically." },
    ],
  }),
  component: Notes,
});

type Draft = { id: string; title: string; doc: NoteDoc };

function Notes() {
  const { notes, saveNote, deleteNote } = useCRM();
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<NoteSort>("recent");
  const list = useMemo(() => filterNotes(notes, q, sort), [notes, q, sort]);
  const [selId, setSelId] = useState<string | null>(() => filterNotes(useCRM.getState().notes, "")[0]?.id ?? null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [status, setStatus] = useState<SaveStatus>("idle");
  const selIdRef = useRef(selId);
  selIdRef.current = selId;

  const saver = useMemo(() => createAutosaver<Draft>((d) => {
    const cur = useCRM.getState().notes.find((n) => n.id === d.id);
    if (!cur) return; // deleted meanwhile — nothing to save
    useCRM.getState().saveNote(withDoc(cur, d.title.trim() || "Untitled note", d.doc, new Date().toISOString()));
  }, (s) => setStatus(s), 600), []);

  const titleRef = useRef(title);
  titleRef.current = title;
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({ heading: false, blockquote: false, codeBlock: false, code: false, strike: false, horizontalRule: false, link: false, underline: false }),
      TaskList, TaskItem.configure({ nested: false }),
    ],
    editorProps: { attributes: { class: "note-prose", "aria-label": "Note content" } },
    onUpdate: ({ editor: e }) => { const id = selIdRef.current; if (id) saver.schedule({ id, title: titleRef.current, doc: e.getJSON() as NoteDoc }); },
  });

  // Load the selected note into the single editor instance (no remount, no autosave echo).
  useEffect(() => {
    const n = useCRM.getState().notes.find((x) => x.id === selId);
    setTitle(n?.title ?? "");
    if (editor && n) editor.commands.setContent(noteDoc(n) as never, { emitUpdate: false });
    setStatus("idle");
  }, [selId, editor]);

  useEffect(() => {
    const out = () => saver.flush();
    window.addEventListener("beforeunload", out);
    return () => { window.removeEventListener("beforeunload", out); saver.flush(); };
  }, [saver]);

  const select = (id: string) => { if (id !== selId) saver.flush(); setSelId(id); setMobileOpen(true); };
  const create = () => {
    saver.flush();
    const at = new Date().toISOString();
    const n: Note = { id: uid("note"), title: "Untitled note", body: "", doc: { type: "doc", content: [{ type: "paragraph" }] }, pinned: false, createdAt: at, updatedAt: at };
    try { saveNote(n); } catch { toast.error("Couldn't create the note — browser storage may be full"); return; }
    setQ(""); setSelId(n.id); setMobileOpen(true);
    requestAnimationFrame(() => { const t = document.getElementById("note-title") as HTMLInputElement | null; t?.focus(); t?.select(); });
  };
  const sel = notes.find((n) => n.id === selId) ?? null;
  const remove = (n: Note) => {
    if (!window.confirm(`Delete "${n.title}" permanently?`)) return;
    if (n.id === selId) saver.cancel();
    deleteNote(n.id); toast.success("Note deleted");
    if (n.id === selId) { setSelId(filterNotes(useCRM.getState().notes, q, sort)[0]?.id ?? null); setMobileOpen(false); }
  };
  const togglePin = (n: Note) => { saver.flush(); const cur = useCRM.getState().notes.find((x) => x.id === n.id); if (cur) saveNote({ ...cur, pinned: !cur.pinned }); };

  return (
    <Shell title="Personal Notes" subtitle={`${notes.length} notes · private to you, saved in this browser`} actions={<Button onClick={create} className="rounded-full"><Plus className="size-4" />New note</Button>}>
      <div className="notes-ws">
        <aside className={cn("notes-lib", mobileOpen && "max-lg:hidden")} aria-label="Notes library">
          <div className="relative"><Search className="absolute top-2.5 left-2.5 size-4 text-muted-foreground" /><Input className="pl-8" placeholder="Search titles and text" aria-label="Search notes" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          <div className="mt-2 flex items-center justify-between gap-2 text-xs text-muted-foreground"><span>{list.length} {list.length === 1 ? "note" : "notes"}</span>
            <select aria-label="Sort notes" className={cn(selectCls, "h-8 text-xs")} value={sort} onChange={(e) => setSort(e.target.value as NoteSort)}><option value="recent">Recently edited</option><option value="created">Newest first</option><option value="title">Title A–Z</option></select></div>
          {list.length === 0 && <Empty icon={<StickyNote />} title={q ? "No notes match" : "No notes yet"} {...(!q ? { action: <Button size="sm" onClick={create}><Plus className="size-4" />New note</Button> } : {})} />}
          <ul className="mt-3 grid gap-1.5">
            {list.map((n) => { const pr = checklistProgress(noteDoc(n)); return (
              <li key={n.id}>
                <button type="button" onClick={() => select(n.id)} aria-current={n.id === selId ? "true" : undefined} className="notes-item">
                  <span className="flex items-center gap-1.5"><span className="truncate text-sm font-semibold">{n.title}</span>{n.pinned && <Pin className="size-3 shrink-0 fill-current text-foreground" aria-label="Pinned" />}</span>
                  <span className="line-clamp-2 text-xs text-muted-foreground">{n.body.trim() || "Empty note"}</span>
                  <span className="flex gap-2 text-[10px] text-muted-foreground"><span>Edited {relative(n.updatedAt)}</span>{pr.total > 0 && <span className="num">☑ {pr.done}/{pr.total}</span>}</span>
                </button>
              </li>); })}
          </ul>
        </aside>

        <section className={cn("notes-pane", !mobileOpen && "max-lg:hidden")} aria-label="Note editor">
          {!sel ? <Empty icon={<StickyNote />} title="Select or create a note" /> : (<>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" className="lg:hidden" onClick={() => { saver.flush(); setMobileOpen(false); }}><ArrowLeft className="size-4" />Notes</Button>
              <SaveBadge status={status} onRetry={() => saver.flush()} />
              <div className="ml-auto flex gap-1">
                <Button size="icon" variant="ghost" aria-label={sel.pinned ? "Unpin note" : "Pin note"} aria-pressed={sel.pinned} onClick={() => togglePin(sel)}><Pin className={cn("size-4", sel.pinned && "fill-current")} /></Button>
                <Button size="icon" variant="ghost" aria-label="Delete note" className="hover:text-destructive" onClick={() => remove(sel)}><Trash2 className="size-4" /></Button>
              </div>
            </div>
            <input id="note-title" aria-label="Note title" className="notes-title" value={title} placeholder="Untitled note"
              onChange={(e) => { setTitle(e.target.value); if (editor) saver.schedule({ id: sel.id, title: e.target.value, doc: editor.getJSON() as NoteDoc }); }}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); editor?.commands.focus("start"); } }} />
            <div className="text-[11px] text-muted-foreground">Created {relative(sel.createdAt)}{sel.tag ? ` · ${sel.tag}` : ""}</div>
            {editor && <Toolbar editor={editor} />}
            <EditorContent editor={editor} className="notes-body" />
          </>)}
        </section>
      </div>
    </Shell>
  );
}

function SaveBadge({ status, onRetry }: { status: SaveStatus; onRetry: () => void }) {
  if (status === "pending") return <span className="notes-save" role="status"><Loader2 className="size-3 animate-spin" />Saving…</span>;
  if (status === "saved") return <span className="notes-save" role="status"><Check className="size-3 text-success" />Saved in this browser</span>;
  if (status === "error") return <span className="notes-save text-destructive" role="alert"><AlertCircle className="size-3" />Not saved — storage error <button type="button" className="underline" onClick={onRetry}>Retry</button></span>;
  return <span className="notes-save" role="status">Changes save automatically</span>;
}

function Toolbar({ editor }: { editor: Editor }) {
  const s = useEditorState({ editor, selector: ({ editor: e }) => ({
    bold: e.isActive("bold"), italic: e.isActive("italic"), bullet: e.isActive("bulletList"), ordered: e.isActive("orderedList"), task: e.isActive("taskList"),
    undo: e.can().undo(), redo: e.can().redo(),
  }) });
  const items: { label: string; keys: string; icon: React.ReactNode; on?: boolean; disabled?: boolean; run: () => void }[] = [
    { label: "Normal text", keys: "", icon: <Pilcrow />, on: !s.bullet && !s.ordered && !s.task, run: () => editor.chain().focus().clearNodes().run() },
    { label: "Bold", keys: "Ctrl+B", icon: <Bold />, on: s.bold, run: () => editor.chain().focus().toggleBold().run() },
    { label: "Italic", keys: "Ctrl+I", icon: <Italic />, on: s.italic, run: () => editor.chain().focus().toggleItalic().run() },
    { label: "Bullet list", keys: "Ctrl+Shift+8", icon: <List />, on: s.bullet, run: () => editor.chain().focus().toggleBulletList().run() },
    { label: "Numbered list", keys: "Ctrl+Shift+7", icon: <ListOrdered />, on: s.ordered, run: () => editor.chain().focus().toggleOrderedList().run() },
    { label: "Checklist", keys: "Ctrl+Shift+9", icon: <ListChecks />, on: s.task, run: () => editor.chain().focus().toggleTaskList().run() },
    { label: "Undo", keys: "Ctrl+Z", icon: <Undo2 />, disabled: !s.undo, run: () => editor.chain().focus().undo().run() },
    { label: "Redo", keys: "Ctrl+Shift+Z", icon: <Redo2 />, disabled: !s.redo, run: () => editor.chain().focus().redo().run() },
  ];
  return (
    <TooltipProvider delayDuration={300}>
      <div className="notes-toolbar" role="toolbar" aria-label="Formatting">
        {items.map((it, i) => (
          <Tooltip key={it.label}>
            <TooltipTrigger asChild>
              <button type="button" aria-label={it.label} aria-pressed={it.on ?? undefined} disabled={it.disabled}
                onMouseDown={(e) => e.preventDefault() /* keep selection */} onClick={it.run} className={cn(i === 6 && "ml-auto")}>{it.icon}</button>
            </TooltipTrigger>
            <TooltipContent>{it.label}{it.keys && <span className="ml-2 opacity-60">{it.keys}</span>}</TooltipContent>
          </Tooltip>
        ))}
      </div>
    </TooltipProvider>
  );
}
