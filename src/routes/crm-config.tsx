import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Archive, ArrowDown, ArrowUp, Copy, Eye, Lock, Pencil, Pin, Plus, RotateCcw, Settings2, SlidersHorizontal, Star, Tag, Trash2, AlertTriangle } from "lucide-react";
import { Shell, Empty, selectCls } from "@/components/crm/Shell";
import { FieldInput, toDraft, type Draft } from "@/components/crm/Customize";
import { ViewEditor, newView } from "@/components/crm/ViewEditor";
import { useAccess } from "@/lib/crm/session";
import { useCRM, viewCtxOf } from "@/lib/crm/store";
import { OWNER_ACTOR_ID } from "@/lib/crm/activity";
import {
  FIELD_TYPES, FIELD_TYPE_LABEL, TAG_COLORS, VISIBILITY_LABEL, emptyField, fieldCoverage, fieldIdFor, optionIdFor, optionUsage, parseValue, runView, tagIdFor, typeChangeImpact, valueCount, viewIssues, viewsUsingField, viewsUsingTag,
  type CustomFieldDef, type FieldType, type SavedView, type TagColor, type TagDef, type ViewFilter, type ViewSort, type ViewVisibility,
} from "@/lib/crm/customize";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

type TabKey = "fields" | "tags" | "views";
export const Route = createFileRoute("/crm-config")({
  validateSearch: (s: Record<string, unknown>): { tab?: TabKey } => (s["tab"] === "tags" || s["tab"] === "views" || s["tab"] === "fields" ? { tab: s["tab"] } : {}),
  head: () => ({
    meta: [
      { title: "CRM Configuration · Scale Flow Sales OS" },
      { name: "description", content: "Owner-only custom Lead and Project fields, tags and saved views for Scale Flow Sales OS." },
      { property: "og:title", content: "CRM Configuration · Scale Flow Sales OS" },
      { property: "og:description", content: "Owner-only custom Lead and Project fields, tags and saved views for Scale Flow Sales OS." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CrmConfig,
});

function CrmConfig() {
  const { preview } = useAccess();
  const tab = Route.useSearch().tab ?? "fields";
  if (preview) return <Shell title="CRM Configuration"><Empty icon={<Lock />} title="Owner only" hint="Employees can't change custom fields, tags or company views." /></Shell>;
  const tabs: [TabKey, string, typeof Settings2][] = [["fields", "Custom fields", SlidersHorizontal], ["tags", "Lead tags", Tag], ["views", "Saved views", Eye]];
  return <Shell title="CRM Configuration" subtitle="Shape the information you keep on every lead — without touching code.">
    <div className="mb-6 flex gap-4 overflow-x-auto border-t border-foreground pt-4" role="tablist">{tabs.map(([k, l, I]) => <Link key={k} to="/crm-config" search={{ tab: k }} role="tab" aria-selected={tab === k} className={cn("flex shrink-0 items-center gap-1.5 border-b-2 pb-1.5 text-sm", tab === k ? "border-foreground text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}><I className="size-4" />{l}</Link>)}</div>
    {tab === "fields" ? <FieldsTab /> : tab === "tags" ? <TagsTab /> : <ViewsTab />}
  </Shell>;
}

/* ================================ fields ================================ */
const EXAMPLES: { label: string; type: FieldType; options?: string[]; visibility?: "owner"; description?: string }[] = [
  { label: "Service Interested In", type: "select", options: ["Business Website", "E-commerce Website", "3D Website", "CRM / Custom Software", "Other"] },
  { label: "Client Budget", type: "select", options: ["Below ₹20,000", "₹20,000–₹40,000", "₹40,000–₹1,00,000", "Above ₹1,00,000"] },
  { label: "Expected Start Date", type: "date" },
  { label: "Decision Maker", type: "text" },
  { label: "Competitor Quotation", type: "currency" },
  { label: "Website Reference URL", type: "url" },
  { label: "Project Urgency", type: "select", options: ["Low", "Medium", "High", "Immediate"] },
  { label: "Internal Margin", type: "currency", visibility: "owner", description: "Owner only — never shown to employees." },
];

function FieldsTab() {
  const st = useCRM();
  const [edit, setEdit] = useState<CustomFieldDef | null>(null);
  const [archiving, setArchiving] = useState<CustomFieldDef | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const list = [...st.customFields].sort((a, b) => a.order - b.order).filter((f) => showArchived || f.status === "active");
  const cov = useMemo(() => fieldCoverage(st.customFields, st.leads.map((l) => l.id), st.fieldValues), [st.customFields, st.leads, st.fieldValues]);
  const archivedCount = st.customFields.filter((f) => f.status === "archived").length;
  return <div className="grid gap-6">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="max-w-2xl text-sm text-muted-foreground">Fields appear on Add Lead, the lead inspector and the full lead record. Built-in fields (name, phone, source, stage, assignee) are protected and can't be changed here.</p>
      <div className="flex gap-2">{archivedCount > 0 && <Button variant="ghost" size="sm" onClick={() => setShowArchived(!showArchived)}>{showArchived ? "Hide" : "Show"} archived ({archivedCount})</Button>}<Button className="rounded-full" onClick={() => setEdit(emptyField(st.customFields.length))}><Plus className="size-4" />New field</Button></div>
    </div>
    <div className="panel p-2 sm:p-4">
      {!list.length ? <Empty icon={<SlidersHorizontal />} title="No custom fields yet" hint="Create fields like Service Interested In or Client Budget. You can start from an example." action={<Button onClick={() => setEdit(emptyField(0))}><Plus className="size-4" />New field</Button>} /> :
        list.map((f, i) => { const c = cov[f.id]; const views = viewsUsingField(st.savedViews, f.id); return <div key={f.id} className="cfg-row" data-archived={f.status === "archived"}>
          <div className="flex flex-col gap-0.5"><Button size="icon" variant="ghost" className="size-6" aria-label={`Move ${f.label} up`} disabled={i === 0} onClick={() => st.moveCustomField(f.id, -1)}><ArrowUp className="size-3.5" /></Button><Button size="icon" variant="ghost" className="size-6" aria-label={`Move ${f.label} down`} disabled={i === list.length - 1} onClick={() => st.moveCustomField(f.id, 1)}><ArrowDown className="size-3.5" /></Button></div>
          <div className="min-w-48 flex-1">
            <div className="flex flex-wrap items-center gap-2"><span className="font-semibold">{f.label}</span><span className="aging">{FIELD_TYPE_LABEL[f.type]}</span>{f.required && <span className="aging">Required</span>}{f.highlight && <span className="aging"><Star className="mr-0.5 inline size-2.5" />Highlighted</span>}{f.visibility === "owner" && <span className="cf-lock"><Lock className="mr-0.5 inline size-2.5" />Owner only</span>}{f.status === "archived" && <span className="aging is-old">Archived</span>}</div>
            <p className="mt-1 text-xs text-muted-foreground"><span className="num">{f.id}</span> · {c?.filled ?? 0} of {st.leads.length} leads filled{f.required && c?.missing ? ` · ${c.missing} need completion` : ""}{views.length ? ` · used by ${views.length} view${views.length > 1 ? "s" : ""}` : ""}{f.options.length ? ` · ${f.options.filter((o) => !o.archived).length} options` : ""}</p>
          </div>
          <div className="flex gap-1">{f.status === "active" ? <><Button size="sm" variant="ghost" onClick={() => setEdit(structuredClone(f))}><Pencil className="size-3.5" />Edit</Button><Button size="sm" variant="ghost" onClick={() => setArchiving(f)}><Archive className="size-3.5" />Archive</Button></> : <Button size="sm" variant="ghost" onClick={() => { st.setCustomFieldStatus(f.id, "active"); toast.success(`${f.label} restored with all its values`); }}><RotateCcw className="size-3.5" />Restore</Button>}</div>
        </div>; })}
    </div>
    {edit && <FieldEditor initial={edit} onClose={() => setEdit(null)} />}
    <Dialog open={!!archiving} onOpenChange={(o) => !o && setArchiving(null)}>
      <DialogContent>{archiving && (() => { const views = viewsUsingField(st.savedViews, archiving.id); const rules = st.automationRules.filter((r) => r.status !== "archived" && r.conditions.custom?.some((c) => c.field === `cf:${archiving.id}`)); const n = valueCount(archiving.id, st.fieldValues); return <>
        <DialogHeader><DialogTitle>Archive “{archiving.label}”?</DialogTitle><DialogDescription>It disappears from forms and the inspector. {n === 1 ? "The 1 stored value is" : `The ${n} stored values are`} kept and come back if you restore it.</DialogDescription></DialogHeader>
        {(views.length > 0 || rules.length > 0) && <div className="rounded-lg border border-warning/40 bg-warning-soft p-3 text-sm"><p className="flex items-center gap-1.5 font-medium text-warning"><AlertTriangle className="size-4" />This field is in use</p><ul className="mt-1.5 list-disc pl-5 text-xs">{views.map((v) => <li key={v.id}>Saved view “{v.name}” — will show a warning; its saved values still apply.</li>)}{rules.map((r) => <li key={r.id}>Automation “{r.name}” — will stop running until you edit it.</li>)}</ul></div>}
        <DialogFooter><Button variant="ghost" onClick={() => setArchiving(null)}>Cancel</Button><Button onClick={() => { st.setCustomFieldStatus(archiving.id, "archived"); toast.success(`${archiving.label} archived — values kept`); setArchiving(null); }}>Archive field</Button></DialogFooter>
      </>; })()}</DialogContent>
    </Dialog>
  </div>;
}

function FieldEditor({ initial, onClose }: { initial: CustomFieldDef; onClose: () => void }) {
  const st = useCRM();
  const isNew = !initial.id;
  const original = st.customFields.find((f) => f.id === initial.id);
  const [d, setD] = useState<CustomFieldDef>(initial);
  const [err, setErr] = useState<string | null>(null);
  const [def, setDef] = useState<Draft>(toDraft(initial, initial.defaultValue));
  const set = (p: Partial<CustomFieldDef>) => setD((x) => ({ ...x, ...p }));
  const usage = original ? optionUsage(original.id, st.fieldValues) : {};
  const choice = d.type === "select" || d.type === "multiselect";
  const impact = original && original.type !== d.type ? typeChangeImpact(original, d, st.fieldValues) : null;
  const optLabelsChanged = original ? original.options.filter((o) => usage[o.id] && d.options.some((n) => n.id === o.id && n.label !== o.label)) : [];
  const applyExample = (label: string) => { const ex = EXAMPLES.find((e) => e.label === label); if (!ex) return; const ids: string[] = []; set({ label: ex.label, type: ex.type, description: ex.description, visibility: ex.visibility ?? "team", editable: ex.visibility ?? "team", options: (ex.options ?? []).map((l) => { const id = optionIdFor(l, ids); ids.push(id); return { id, label: l }; }) }); };
  const save = () => {
    const id = isNew ? fieldIdFor(d.label, st.customFields.map((f) => f.id)) : d.id;
    let defaultValue: CustomFieldDef["defaultValue"] = undefined;
    if (def !== undefined && def !== "" && !(Array.isArray(def) && !def.length)) { const r = parseValue(d, def); if (!r.ok) { setErr(`Default value: ${r.error}`); return; } defaultValue = r.value; }
    const e = st.saveCustomField({ ...d, id, defaultValue }); if (e) { setErr(e); return; }
    toast.success(isNew ? `Field “${d.label.trim()}” created` : `Field “${d.label.trim()}” saved`); onClose();
  };
  return <Dialog open onOpenChange={(o) => !o && onClose()}>
    <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-xl">
      <DialogHeader><DialogTitle>{isNew ? "New custom field" : `Edit “${original?.label}”`}</DialogTitle><DialogDescription>{isNew ? "Name it the way your team talks about it." : "Renaming never changes stored values — they're linked by an internal id."}</DialogDescription></DialogHeader>
      <div className="grid gap-4">
        {isNew && <div className="grid gap-1.5"><Label htmlFor="cf-ex">Start from an example (optional)</Label><select id="cf-ex" className={selectCls} defaultValue="" onChange={(e) => applyExample(e.target.value)}><option value="">Blank field</option>{EXAMPLES.map((e) => <option key={e.label}>{e.label}</option>)}</select></div>}
        <div className="grid gap-1.5"><Label htmlFor="cf-label">Field name</Label><Input id="cf-label" value={d.label} onChange={(e) => set({ label: e.target.value })} placeholder="e.g. Service Interested In" />{<p className="text-[11px] text-muted-foreground">Internal id: <span className="num">{isNew ? (d.label.trim() ? fieldIdFor(d.label, st.customFields.map((f) => f.id)) : "—") : d.id}</span>{isNew ? " (fixed once created)" : " (fixed)"}</p>}</div>
        <div className="grid gap-1.5"><Label htmlFor="cf-type">Type</Label><select id="cf-type" className={selectCls} value={d.type} onChange={(e) => { set({ type: e.target.value as FieldType }); setDef(undefined); }}>{FIELD_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label} — {t.hint}</option>)}</select>
          {impact && <p className={cn("text-xs", impact.incompatible.length ? "text-destructive" : "text-muted-foreground")}>{impact.incompatible.length ? `${impact.incompatible.length} lead value${impact.incompatible.length > 1 ? "s" : ""} can't become ${FIELD_TYPE_LABEL[d.type]} — saving will be blocked. Nothing is converted silently.` : impact.convertible ? `${impact.convertible} stored value${impact.convertible > 1 ? "s" : ""} will be converted to ${FIELD_TYPE_LABEL[d.type]}.` : "No stored values — safe to change."}</p>}</div>
        <div className="grid gap-1.5"><Label htmlFor="cf-desc">Description (optional)</Label><Textarea id="cf-desc" rows={2} value={d.description ?? ""} onChange={(e) => set({ description: e.target.value })} placeholder="Shown under the field to help your team" /></div>
        {choice && <div className="grid gap-2"><Label>Options</Label>
          {d.options.map((o, i) => <div key={o.id} className="flex items-center gap-2">
            <Input aria-label={`Option ${i + 1}`} value={o.label} disabled={o.archived} onChange={(e) => set({ options: d.options.map((x) => (x.id === o.id ? { ...x, label: e.target.value } : x)) })} />
            {usage[o.id] ? <span className="aging shrink-0">{usage[o.id]} lead{usage[o.id]! > 1 ? "s" : ""}</span> : null}
            {o.archived ? <Button size="sm" variant="ghost" onClick={() => set({ options: d.options.map((x) => (x.id === o.id ? { id: x.id, label: x.label } : x)) })}>Restore</Button>
              : usage[o.id] ? <Button size="sm" variant="ghost" title="In use — archive keeps existing values" onClick={() => set({ options: d.options.map((x) => (x.id === o.id ? { ...x, archived: true } : x)) })}>Archive</Button>
              : <Button size="icon" variant="ghost" aria-label={`Remove option ${o.label}`} onClick={() => set({ options: d.options.filter((x) => x.id !== o.id) })}><Trash2 className="size-4" /></Button>}
          </div>)}
          <div><Button size="sm" variant="outline" className="rounded-full" onClick={() => set({ options: [...d.options, { id: optionIdFor(`option ${d.options.length + 1}`, d.options.map((o) => o.id)), label: "" }] })}><Plus className="size-3.5" />Add option</Button></div>
          {optLabelsChanged.length > 0 && <p className="text-xs text-warning">Renaming {optLabelsChanged.map((o) => `“${o.label}”`).join(", ")} changes how it reads on {optLabelsChanged.reduce((n, o) => n + (usage[o.id] ?? 0), 0)} leads (they stay linked).</p>}
        </div>}
        <div className="grid gap-3 rounded-lg border p-3">
          <label className="flex items-center justify-between gap-3 text-sm">Required for new leads<Switch checked={d.required} onCheckedChange={(v) => set({ required: v })} /></label>
          {d.required && !isNew && <p className="-mt-1 text-[11px] text-muted-foreground">Existing leads without a value stay usable and are flagged “Needs completion”. Nothing is filled in automatically.</p>}
          <label className="flex items-center justify-between gap-3 text-sm">Highlight in the inspector<Switch checked={d.highlight} onCheckedChange={(v) => set({ highlight: v })} /></label>
          <div className="grid gap-1.5 sm:grid-cols-2">
            <label className="grid gap-1 text-sm">Who can see it<select className={selectCls} value={d.visibility} onChange={(e) => set({ visibility: e.target.value as "team", ...(e.target.value === "owner" ? { editable: "owner" as const } : {}) })}><option value="team">Owner and employees</option><option value="owner">Owner only (sensitive)</option></select></label>
            <label className="grid gap-1 text-sm">Who can edit it<select className={selectCls} value={d.editable} disabled={d.visibility === "owner"} onChange={(e) => set({ editable: e.target.value as "team" })}><option value="team">Anyone who can edit the lead</option><option value="owner">Owner only</option></select></label>
          </div>
        </div>
        {d.type !== "longtext" && <div><p className="mb-1.5 text-sm font-medium">Default for new leads (optional)</p><FieldInput def={{ ...d, id: "default", label: "Default value", required: false, visibility: "team", description: "Pre-filled on Add Lead only — never applied to existing leads." }} value={def} onChange={setDef} /></div>}
        {original && original.history.length > 0 && <details className="text-xs text-muted-foreground"><summary className="cursor-pointer">Change history ({original.history.length})</summary><ul className="mt-1.5 grid gap-0.5">{[...original.history].reverse().map((h, i) => <li key={i}><span className="num">{h.at.slice(0, 10)}</span> · {h.change}</li>)}</ul></details>}
        {err && <p role="alert" className="text-sm text-destructive">{err}</p>}
      </div>
      <DialogFooter><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={!!impact?.incompatible.length}>{isNew ? "Create field" : "Save changes"}</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}

/* ================================= tags ================================= */
function TagsTab() {
  const st = useCRM();
  const [edit, setEdit] = useState<(Omit<TagDef, "createdAt" | "updatedAt">) | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const counts = useMemo(() => { const m: Record<string, number> = {}; for (const ids of Object.values(st.leadTags)) for (const id of ids) m[id] = (m[id] ?? 0) + 1; return m; }, [st.leadTags]);
  const save = () => { if (!edit) return; const id = edit.id || tagIdFor(edit.name, st.tagDefs.map((t) => t.id)); const e = st.saveTag({ ...edit, id }); if (e) { setErr(e); return; } toast.success(`Tag “${edit.name.trim()}” saved`); setEdit(null); };
  const sorted = [...st.tagDefs].sort((a, b) => Number(a.status === "archived") - Number(b.status === "archived") || a.name.localeCompare(b.name));
  return <div className="grid gap-6">
    <div className="flex flex-wrap items-center justify-between gap-3"><p className="max-w-2xl text-sm text-muted-foreground">Tags group leads across stages — “Hot Opportunity”, “Needs Demo”, “Referral Client”. A lead can have several. Archived tags stay on the leads that have them but can't be added again.</p><Button className="rounded-full" onClick={() => { setErr(null); setEdit({ id: "", name: "", color: "graphite", status: "active" }); }}><Plus className="size-4" />New tag</Button></div>
    <div className="panel p-2 sm:p-4">{!sorted.length ? <Empty icon={<Tag />} title="No tags yet" hint="Create a few tags, then add them from the lead inspector or in bulk from Leads." /> : sorted.map((t) => { const views = viewsUsingTag(st.savedViews, t.id); return <div key={t.id} className="cfg-row" data-archived={t.status === "archived"}>
      <span className="tag-chip" data-color={t.color}>{t.name}</span>
      <span className="min-w-40 flex-1 text-xs text-muted-foreground">{t.description || "No description"} · <span className="num">{counts[t.id] ?? 0}</span> lead{counts[t.id] === 1 ? "" : "s"}{views.length ? ` · used by ${views.length} view${views.length > 1 ? "s" : ""}` : ""}</span>
      <div className="flex gap-1"><Button size="sm" variant="ghost" onClick={() => { setErr(null); setEdit({ id: t.id, name: t.name, description: t.description, color: t.color, status: t.status }); }}><Pencil className="size-3.5" />Edit</Button>{t.status === "active" ? <Button size="sm" variant="ghost" onClick={() => { st.setTagStatus(t.id, "archived"); toast.success(`${t.name} archived${counts[t.id] ? ` — still shown on ${counts[t.id]} leads` : ""}`); }}><Archive className="size-3.5" />Archive</Button> : <Button size="sm" variant="ghost" onClick={() => st.setTagStatus(t.id, "active")}><RotateCcw className="size-3.5" />Restore</Button>}</div>
    </div>; })}</div>
    <Dialog open={!!edit} onOpenChange={(o) => !o && setEdit(null)}>
      <DialogContent className="sm:max-w-md">{edit && <>
        <DialogHeader><DialogTitle>{edit.id ? "Edit tag" : "New tag"}</DialogTitle><DialogDescription>Renaming updates every lead that has it.</DialogDescription></DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-1.5"><Label htmlFor="tag-name">Name</Label><Input id="tag-name" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} placeholder="e.g. Needs Demo" /></div>
          <div className="grid gap-1.5"><Label htmlFor="tag-desc">Short description (optional)</Label><Input id="tag-desc" value={edit.description ?? ""} onChange={(e) => setEdit({ ...edit, description: e.target.value || undefined })} /></div>
          <div className="grid gap-1.5"><Label>Colour</Label><div className="flex flex-wrap gap-2">{TAG_COLORS.map((c) => <button key={c} type="button" aria-pressed={edit.color === c} aria-label={c} onClick={() => setEdit({ ...edit, color: c as TagColor })} className={cn("tag-chip", edit.color === c && "ring-2 ring-ring")} data-color={c}>{edit.name.trim() || c}</button>)}</div></div>
          {err && <p role="alert" className="text-sm text-destructive">{err}</p>}
        </div>
        <DialogFooter><Button variant="ghost" onClick={() => setEdit(null)}>Cancel</Button><Button onClick={save}>Save tag</Button></DialogFooter>
      </>}</DialogContent>
    </Dialog>
  </div>;
}

/* ================================ views ================================ */
function ViewsTab() {
  const st = useCRM();
  const [edit, setEdit] = useState<SavedView | null>(null);
  const ctx = viewCtxOf(st, { owner: true });
  const prefs = st.viewPrefs[OWNER_ACTOR_ID] ?? { pinned: [] };
  const owner = (id: string) => (id === OWNER_ACTOR_ID ? "You" : st.employees.find((e) => e.id === id)?.name ?? "Former employee");
  const views = [...st.savedViews].sort((a, b) => Number(a.archived) - Number(b.archived) || a.name.localeCompare(b.name));
  return <div className="grid gap-6">
    <div className="flex flex-wrap items-center justify-between gap-3"><p className="max-w-2xl text-sm text-muted-foreground">Views are saved filters over your live leads — never copies. Personal views belong to one person, shared views are offered to the team, company views are your standard set. Sharing a view never shows anyone leads outside their own access.</p><Button className="rounded-full" onClick={() => setEdit(newView())}><Plus className="size-4" />New view</Button></div>
    <div className="panel p-2 sm:p-4">{views.map((v) => { const n = runView(v, st.leads, ctx).length; const iss = viewIssues(v, ctx); return <div key={v.id} className="cfg-row" data-archived={v.archived}>
      <div className="min-w-48 flex-1">
        <div className="flex flex-wrap items-center gap-2"><span className="font-semibold">{v.name}</span><span className="aging">{v.visibility}</span>{prefs.defaultId === v.id && <span className="aging">Default</span>}{prefs.pinned.includes(v.id) && <Pin className="size-3" aria-label="Pinned" />}{v.archived && <span className="aging is-old">Archived</span>}</div>
        <p className="mt-1 text-xs text-muted-foreground">{owner(v.ownerId)} · {v.filter.conditions.length} condition{v.filter.conditions.length === 1 ? "" : "s"} ({v.filter.mode.toUpperCase()}) · <span className="num">{n}</span> matching leads</p>
        {iss.length > 0 && <p className="mt-1 flex items-center gap-1.5 text-xs text-warning"><AlertTriangle className="size-3.5" />{iss[0]!.text}</p>}
      </div>
      <div className="flex flex-wrap gap-1">
        <Button size="sm" variant="ghost" asChild><Link to="/leads" search={{ view: v.id }}>Open</Link></Button>
        <Button size="sm" variant="ghost" onClick={() => setEdit(structuredClone(v))}><Pencil className="size-3.5" />Edit</Button>
        <Button size="sm" variant="ghost" aria-label={`Duplicate ${v.name}`} onClick={() => { const id = st.duplicateView(v.id); if (id) toast.success("Duplicated as a personal view"); }}><Copy className="size-3.5" /></Button>
        <Button size="sm" variant="ghost" aria-label={v.archived ? `Restore ${v.name}` : `Archive ${v.name}`} onClick={() => st.saveView({ ...v, archived: !v.archived })}>{v.archived ? <RotateCcw className="size-3.5" /> : <Archive className="size-3.5" />}</Button>
        <Button size="sm" variant="ghost" aria-label={`Delete ${v.name}`} onClick={() => { st.deleteView(v.id); toast.success(`View “${v.name}” deleted`); }}><Trash2 className="size-3.5" /></Button>
      </div>
    </div>; })}</div>
    {edit && <ViewEditor initial={edit} onClose={() => setEdit(null)} />}
  </div>;
}

