import { useState } from "react";
import { safeHref } from "@/lib/crm/validation";
import { toast } from "sonner";
import { Plus, Globe, Pencil, Trash2, ArrowUp, ArrowDown, ExternalLink } from "lucide-react";
import { useCRM } from "@/lib/crm/store";
import { uid } from "@/lib/crm/format";
import { demoLines, safeUrl, selectedDemos, type Demo } from "@/lib/crm/studio";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Empty, selectCls } from "@/components/crm/Shell";
import { cn } from "@/lib/utils";

export function DemosPanel() {
  const { demos, demoCategories, saveDemo, deleteDemo, moveDemo, addDemoCategory } = useCRM();
  const [cat, setCat] = useState<string>("all");
  const [editing, setEditing] = useState<Demo | null>(null);
  const sorted = [...demos].sort((a, b) => a.order - b.order);
  const shown = sorted.filter((d) => cat === "all" || d.category === cat);
  const defaults = selectedDemos(demos);
  const fresh = (): Demo => ({ id: uid("demo"), title: "", url: "", category: cat !== "all" ? cat : demoCategories[0] ?? "Other", tags: [], active: true, order: demos.length, includeByDefault: true });
  const newCategory = () => { const n = window.prompt("New category name"); if (n?.trim()) { addDemoCategory(n); setCat(n.trim()); } };

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="fu-tabs" role="tablist" aria-label="Demo categories">
          <button type="button" role="tab" aria-selected={cat === "all"} className="fu-tab" onClick={() => setCat("all")}>All<span className="fu-count num">{demos.length}</span></button>
          {demoCategories.map((c) => <button key={c} type="button" role="tab" aria-selected={cat === c} className="fu-tab" onClick={() => setCat(c)}>{c}<span className="fu-count num">{demos.filter((d) => d.category === c).length}</span></button>)}
        </div>
        <Button variant="ghost" size="sm" onClick={newCategory}><Plus />Category</Button>
        <Button className="ml-auto" onClick={() => setEditing(fresh())}><Plus />Add demo</Button>
      </div>
      <div className="studio-split">
        <div className="grid content-start gap-2">
          {demos.length === 0 ? <div className="surface"><Empty icon={<Globe />} title="Add your website demos" hint="Save your real demo links once — they appear in every Samples message across the CRM." action={<Button onClick={() => setEditing(fresh())}><Plus />Add demo</Button>} /></div>
            : shown.length === 0 ? <p className="rounded-2xl border border-dashed p-8 text-center text-sm text-muted-foreground">No demos in {cat}.</p>
            : shown.map((d) => (
              <div key={d.id} className={cn("demo-card", !d.active && "opacity-60")}>
                {d.thumbnail && safeUrl(d.thumbnail) ? <img src={safeUrl(d.thumbnail)!} alt="" loading="lazy" className="demo-thumb" /> : <div className="demo-thumb grid place-items-center"><Globe className="size-5 text-muted-foreground" /></div>}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5"><span className="truncate font-semibold">{d.title}</span><span className="aging">{d.category}</span>{d.tags.map((t) => <span key={t} className="ph-chip">{t}</span>)}</div>
                  <a href={safeHref(d.url) ?? undefined} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 truncate text-xs text-muted-foreground hover:text-foreground"><ExternalLink className="size-3 shrink-0" /><span className="truncate">{d.url}</span></a>
                  {d.description && <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{d.description}</p>}
                  <div className="mt-2 flex flex-wrap items-center gap-4 text-xs">
                    <label className="flex items-center gap-2"><Switch aria-label={`Include ${d.title} in sample messages by default`} checked={d.includeByDefault} onCheckedChange={(v) => saveDemo({ ...d, includeByDefault: v })} />In default samples</label>
                    <label className="flex items-center gap-2"><Switch aria-label={`${d.title} active`} checked={d.active} onCheckedChange={(v) => saveDemo({ ...d, active: v })} />Active</label>
                  </div>
                </div>
                <div className="flex shrink-0 flex-col gap-0.5 [&_button]:size-7">
                  <Button size="icon" variant="ghost" aria-label="Move up" onClick={() => moveDemo(d.id, -1)}><ArrowUp className="size-3.5" /></Button>
                  <Button size="icon" variant="ghost" aria-label="Move down" onClick={() => moveDemo(d.id, 1)}><ArrowDown className="size-3.5" /></Button>
                  <Button size="icon" variant="ghost" aria-label={`Edit ${d.title}`} onClick={() => setEditing(d)}><Pencil className="size-3.5" /></Button>
                  <Button size="icon" variant="ghost" aria-label={`Delete ${d.title}`} className="hover:text-destructive" onClick={() => { if (window.confirm(`Delete ${d.title}?`)) { deleteDemo(d.id); toast.success("Demo deleted"); } }}><Trash2 className="size-3.5" /></Button>
                </div>
              </div>
            ))}
        </div>
        <aside className="wa-preview content-start" aria-label="Default sample links">
          <span className="eyebrow">Default Samples message includes</span>
          <div className="num text-2xl font-semibold">{defaults.length} demo{defaults.length === 1 ? "" : "s"}</div>
          {defaults.length ? <div className="wa-bubble text-xs">{demoLines(defaults)}</div> : <p className="text-xs text-muted-foreground">Turn on “In default samples” for the demos you usually share.</p>}
          <p className="text-[11px] text-muted-foreground">You can still change the selection for a single message inside the WhatsApp composer.</p>
        </aside>
      </div>
      {editing && <DemoDialog demo={editing} categories={demoCategories} isNew={!demos.some((d) => d.id === editing.id)} onClose={() => setEditing(null)} />}
    </div>
  );
}

function DemoDialog({ demo, categories, isNew, onClose }: { demo: Demo; categories: string[]; isNew: boolean; onClose: () => void }) {
  const save = useCRM((s) => s.saveDemo);
  const [d, setD] = useState(demo);
  const [tags, setTags] = useState(demo.tags.join(", "));
  const urlOk = !!safeUrl(d.url);
  const thumbOk = !d.thumbnail?.trim() || !!safeUrl(d.thumbnail);
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!d.title.trim()) { toast.error("Add a title"); return; }
    if (!urlOk) { toast.error("Enter a valid website link (https://…)"); return; }
    if (!thumbOk) { toast.error("The thumbnail link isn't valid"); return; }
    const row: Demo = { ...d, title: d.title.trim(), description: d.description?.trim() || undefined, thumbnail: d.thumbnail?.trim() ? safeUrl(d.thumbnail)! : undefined, tags: tags.split(",").map((t) => t.trim()).filter(Boolean) };
    if (!save(row)) { toast.error("Couldn't save this demo"); return; }
    toast.success(isNew ? "Demo added" : "Demo updated"); onClose();
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader><DialogTitle>{isNew ? "Add website demo" : "Edit demo"}</DialogTitle><DialogDescription>Use a link you actually want clients to open.</DialogDescription></DialogHeader>
        <form className="grid gap-3" onSubmit={submit}>
          <label className="q-field"><span>Title</span><Input value={d.title} onChange={(e) => setD({ ...d, title: e.target.value })} placeholder="e.g. Fashion store" /></label>
          <label className="q-field"><span>Website link</span><Input value={d.url} onChange={(e) => setD({ ...d, url: e.target.value })} placeholder="https://" inputMode="url" aria-invalid={!!d.url && !urlOk} />{d.url && !urlOk && <small className="text-destructive">Links must be a full web address like https://example.com</small>}</label>
          <label className="q-field"><span>Category</span><select className={selectCls} value={d.category} onChange={(e) => setD({ ...d, category: e.target.value })}>{categories.map((c) => <option key={c}>{c}</option>)}</select></label>
          <label className="q-field"><span>Description (optional)</span><Textarea rows={2} value={d.description ?? ""} onChange={(e) => setD({ ...d, description: e.target.value })} /></label>
          <label className="q-field"><span>Tags (comma separated)</span><Input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="fashion, mobile-first" /></label>
          <label className="q-field"><span>Thumbnail link (optional)</span><Input value={d.thumbnail ?? ""} onChange={(e) => setD({ ...d, thumbnail: e.target.value })} placeholder="https://…/preview.jpg" aria-invalid={!thumbOk} /></label>
          <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit">{isNew ? "Add demo" : "Save"}</Button></div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
