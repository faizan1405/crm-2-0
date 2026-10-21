import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { Pin, Trash2, Search, StickyNote, Pencil, FileText, Plus } from "lucide-react";
import { Shell, Empty } from "@/components/crm/Shell";
import { useCRM } from "@/lib/crm/store";
import { uid, relative } from "@/lib/crm/format";
import type { Note } from "@/lib/crm/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/notes")({
  head: () => ({
    meta: [
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { title: "Notes · Scale Flow CRM" },
      { name: "description", content: "Personal notes and checklists for your sales work." },
      { property: "og:title", content: "Notes · Scale Flow CRM" },
      { property: "og:description", content: "Personal notes and checklists for your sales work." },
    ],
  }),
  component: Notes,
});

function Notes() {
  const { notes, saveNote, deleteNote } = useCRM();
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<Note | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [tag, setTag] = useState("");
  const sorted = notes.filter((n) => `${n.title} ${n.body} ${n.tag ?? ""}`.toLowerCase().includes(q.toLowerCase())).sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt.localeCompare(a.updatedAt));
  const startEdit = (n: Note) => { setEditing(n); setTitle(n.title); setBody(n.body); setTag(n.tag ?? ""); window.scrollTo({ top: 0, behavior: "smooth" }); };
  const clear = () => { setEditing(null); setTitle(""); setBody(""); setTag(""); };
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) { toast.error("Add a title"); return; }
    const at = new Date().toISOString();
    saveNote({ id: editing?.id ?? uid("note"), title: title.trim(), body, pinned: editing?.pinned ?? false, createdAt: editing?.createdAt ?? at, updatedAt: at, ...(tag ? { tag } : {}) });
    toast.success(editing ? "Note updated" : "Note saved");
    clear();
  };
  return (
    <Shell title="Personal Notes" subtitle={`${notes.length} notes · Your private scratchpad, saved on this device`} actions={<Button variant="outline" onClick={() => { clear(); document.getElementById("note-title")?.focus(); }}><Plus />New note</Button>}>
      <div className="grid gap-5 lg:grid-cols-[310px_minmax(0,1fr)] xl:grid-cols-[340px_minmax(0,1fr)]">
        <form className="note-editor surface grid content-start gap-4 lg:sticky lg:top-24" onSubmit={submit}>
          <div className="mb-1 flex items-center gap-2 text-sm font-bold"><FileText className="size-4 text-teal" />{editing ? "Edit note" : "New note"}</div>
          <Input id="note-title" aria-label="Note title" className="h-12 font-display font-bold" placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
          <Textarea aria-label="Note body" rows={8} placeholder="Write something…" value={body} onChange={(e) => setBody(e.target.value)} />
          <Input aria-label="Note tag" placeholder="Tag (optional)" value={tag} onChange={(e) => setTag(e.target.value)} />
          <div className="flex justify-end gap-2">{editing && <Button type="button" variant="ghost" onClick={clear}>Cancel</Button>}<Button type="submit">{editing ? "Update" : "Save note"}</Button></div>
        </form>
        <div>
          <div className="relative mb-3"><Search className="absolute top-2.5 left-2.5 size-4 text-muted-foreground" /><Input className="pl-8" placeholder="Search notes" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          {sorted.length === 0 && <div className="surface"><Empty icon={<StickyNote />} title={q ? "No notes match" : "No notes yet"} /></div>}
          <div className="grid gap-3 sm:grid-cols-2">
            {sorted.map((n) => (
              <div key={n.id} className={cn("note-card surface surface-hover p-5", n.pinned && "is-pinned", editing?.id === n.id && "ring-2 ring-ring")}>
                <div className="flex items-start justify-between gap-2">
                  <h3 className="min-w-0 break-words font-semibold">{n.title}</h3>
                  <div className="flex shrink-0 gap-0 text-muted-foreground [&_button]:size-7">
                    <Button size="icon" variant="ghost" aria-label={n.pinned ? "Unpin note" : "Pin note"} className={cn("rounded p-1 hover:bg-muted", n.pinned && "text-primary")} onClick={() => saveNote({ ...n, pinned: !n.pinned })}><Pin className="size-4" /></Button>
                    <Button size="icon" variant="ghost" aria-label="Edit note" className="rounded p-1 hover:bg-muted" onClick={() => startEdit(n)}><Pencil className="size-4" /></Button>
                    <Button size="icon" variant="ghost" aria-label="Delete note" className="rounded p-1 hover:bg-muted hover:text-destructive" onClick={() => { if (window.confirm(`Delete ${n.title}?`)) { deleteNote(n.id); if (editing?.id === n.id) clear(); toast.success("Note deleted"); } }}><Trash2 className="size-4" /></Button>
                  </div>
                </div>
                <p className="mt-4 min-h-20 line-clamp-6 text-[13px] leading-relaxed whitespace-pre-line text-muted-foreground">{n.body}</p>
                <div className="mt-5 flex flex-wrap items-center gap-2 border-t pt-3 text-[10px] text-muted-foreground">{n.tag && <span className="rounded-full bg-teal-soft px-2 py-0.5 text-teal">{n.tag}</span>}Updated {relative(n.updatedAt)}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Shell>
  );
}
