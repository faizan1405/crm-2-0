import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { Pin, Trash2 } from "lucide-react";
import { Shell } from "@/components/crm/Shell";
import { useCRM } from "@/lib/crm/store";
import { uid, relative } from "@/lib/crm/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export const Route = createFileRoute("/notes")({
  head: () => ({
    meta: [
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
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const sorted = [...notes].sort((a, b) => Number(b.pinned) - Number(a.pinned));
  return (
    <Shell title="Notes" subtitle="Your private scratchpad">
      <form className="surface mb-6 grid gap-2 p-4" onSubmit={(e) => {
        e.preventDefault();
        if (!title.trim()) { toast.error("Add a title"); return; }
        const at = new Date().toISOString();
        saveNote({ id: uid("note"), title: title.trim(), body, pinned: false, createdAt: at, updatedAt: at });
        setTitle(""); setBody(""); toast.success("Note saved");
      }}>
        <Input placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
        <Textarea placeholder="Write something…" value={body} onChange={(e) => setBody(e.target.value)} />
        <Button type="submit" className="justify-self-end">Save note</Button>
      </form>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {sorted.map((n) => (
          <div key={n.id} className="surface p-4">
            <div className="flex items-start justify-between gap-2">
              <h3 className="font-semibold">{n.title}</h3>
              <div className="flex gap-2 text-muted-foreground">
                <button aria-label="Pin note" className={n.pinned ? "text-primary" : ""} onClick={() => saveNote({ ...n, pinned: !n.pinned, updatedAt: new Date().toISOString() })}><Pin className="size-4" /></button>
                <button aria-label="Delete note" className="hover:text-destructive" onClick={() => deleteNote(n.id)}><Trash2 className="size-4" /></button>
              </div>
            </div>
            <p className="mt-2 text-sm whitespace-pre-line text-muted-foreground">{n.body}</p>
            <p className="mt-3 text-xs text-muted-foreground">Updated {relative(n.updatedAt)}</p>
          </div>
        ))}
      </div>
    </Shell>
  );
}
