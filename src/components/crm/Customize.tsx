// Phase 3G shared UI: custom field inputs, the inspector "Additional information" section, tag chips/pickers
// and the condition builder used by Saved Views and Automation Studio. All writes go through store actions.
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { ChevronDown, Lock, Pencil, Plus, Tag, Trash2, AlertTriangle } from "lucide-react";
import { useCRM, viewCtxOf } from "@/lib/crm/store";
import { useAccess } from "@/lib/crm/session";
import { activeFields, displayValue, fieldEditable, fieldVisible, filterFields, OP_LABEL, OPS_FOR, viewIssues, type CustomFieldDef, type FieldValue, type FilterField, type Money, type Op, type ViewCondition, type ViewFilter, type Viewer } from "@/lib/crm/customize";
import { uid } from "@/lib/crm/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { selectCls } from "./Shell";
import { cn } from "@/lib/utils";

export function useViewer(): Viewer {
  const { preview, can } = useAccess();
  return preview ? { owner: false, employeeId: preview.employeeId, canEdit: can("leads.edit") } : { owner: true };
}

/* ---------- field inputs ---------- */
export type Draft = string | boolean | string[] | undefined;
export function toDraft(def: CustomFieldDef, v: FieldValue | undefined): Draft {
  if (v === undefined) return def.type === "multiselect" ? [] : def.type === "checkbox" ? undefined : "";
  if (def.type === "currency") return String((v as Money).amount);
  if (def.type === "number") return String(v);
  return v as Draft;
}
export function FieldInput({ def, value, onChange, error, disabled }: { def: CustomFieldDef; value: Draft; onChange: (v: Draft) => void; error?: string | undefined; disabled?: boolean }) {
  const id = `cf-${def.id}`;
  const live = def.options.filter((o) => !o.archived);
  const common = { id, disabled, "aria-invalid": !!error, "aria-describedby": error ? `${id}-err` : undefined };
  let control: React.ReactNode;
  switch (def.type) {
    case "longtext": control = <Textarea {...common} rows={3} value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} />; break;
    case "checkbox": control = <div className="flex h-10 items-center gap-3 text-sm">{([[true, "Yes"], [false, "No"]] as const).map(([v, l]) => <label key={l} className="flex items-center gap-1.5"><input type="radio" name={id} disabled={disabled} checked={value === v} onChange={() => onChange(v)} />{l}</label>)}{value !== undefined && !disabled && <button type="button" className="text-xs text-muted-foreground underline" onClick={() => onChange(undefined)}>Clear</button>}</div>; break;
    case "select": control = <select {...common} className={cn(selectCls, "w-full")} value={String(value ?? "")} onChange={(e) => onChange(e.target.value)}><option value="">—</option>{def.options.filter((o) => !o.archived || o.id === value).map((o) => <option key={o.id} value={o.id}>{o.label}{o.archived ? " (archived)" : ""}</option>)}</select>; break;
    case "multiselect": { const cur = Array.isArray(value) ? value : []; control = <div id={id} role="group" aria-label={def.label} className="flex flex-wrap gap-1.5">{def.options.filter((o) => !o.archived || cur.includes(o.id)).map((o) => { const on = cur.includes(o.id); return <button type="button" key={o.id} disabled={disabled} aria-pressed={on} onClick={() => onChange(on ? cur.filter((x) => x !== o.id) : [...cur, o.id])} className={cn("rounded-full border px-2.5 py-1 text-xs", on ? "border-primary bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:text-foreground")}>{o.label}</button>; })}{!live.length && <span className="text-xs text-muted-foreground">No options yet.</span>}</div>; break; }
    case "date": control = <Input {...common} type="date" value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} />; break;
    case "number": control = <Input {...common} inputMode="decimal" value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} />; break;
    case "currency": control = <div className="relative"><span className="pointer-events-none absolute top-2.5 left-3 text-sm text-muted-foreground">₹</span><Input {...common} className="pl-7" inputMode="decimal" value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} /></div>; break;
    default: control = <Input {...common} type={def.type === "email" ? "email" : def.type === "url" ? "url" : def.type === "phone" ? "tel" : "text"} value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} />;
  }
  return <div className="grid min-w-0 gap-1.5">
    <label htmlFor={id} className="flex items-center gap-1.5 text-[13px] font-medium">{def.label}{def.required && <span aria-label="required">*</span>}{def.visibility === "owner" && <span className="cf-lock" title="Owner only — never shown to employees"><Lock className="mr-0.5 inline size-2.5" />Owner</span>}</label>
    {control}
    {def.description && !error && <p className="text-[11px] text-muted-foreground">{def.description}</p>}
    {error && <p id={`${id}-err`} className="text-xs text-destructive">{error}</p>}
  </div>;
}

/** Inputs for every active field the viewer may edit — used by Add Lead and the inspector editor. */
export function FieldForm({ defs, draft, onChange, errors }: { defs: CustomFieldDef[]; draft: Record<string, Draft>; onChange: (id: string, v: Draft) => void; errors: Record<string, string> }) {
  if (!defs.length) return null;
  return <div className="cf-grid">{defs.map((d) => <div key={d.id} className={d.type === "longtext" || d.type === "multiselect" ? "col-span-full" : ""}><FieldInput def={d} value={draft[d.id]} onChange={(v) => onChange(d.id, v)} error={errors[d.id]} /></div>)}</div>;
}

/** Inspector section. Highlighted fields always show; the rest sit in a collapsible "Additional information". */
export function AdditionalInfo({ leadId, compact }: { leadId: string; compact?: boolean }) {
  const defs = useCRM((s) => s.customFields); const values = useCRM((s) => s.fieldValues[leadId]); const save = useCRM((s) => s.setLeadFieldValues);
  const viewer = useViewer();
  const shown = useMemo(() => activeFields(defs).filter((d) => fieldVisible(d, viewer)), [defs, viewer.owner]); // eslint-disable-line react-hooks/exhaustive-deps
  const editable = shown.filter((d) => fieldEditable(d, viewer));
  const [open, setOpen] = useState(false); const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, Draft>>({}); const [errors, setErrors] = useState<Record<string, string>>({});
  if (!shown.length) return null;
  const v = values ?? {};
  const needs = shown.filter((d) => d.required && v[d.id] === undefined);
  const hi = shown.filter((d) => d.highlight), rest = shown.filter((d) => !d.highlight);
  const start = () => { setDraft(Object.fromEntries(editable.map((d) => [d.id, toDraft(d, v[d.id])]))); setErrors({}); setEditing(true); setOpen(true); };
  const commit = () => {
    const changed = Object.fromEntries(editable.filter((d) => JSON.stringify(draft[d.id]) !== JSON.stringify(toDraft(d, v[d.id]))).map((d) => [d.id, draft[d.id]]));
    if (!Object.keys(changed).length) { setEditing(false); return; }
    const r = save(leadId, changed);
    if (!r.ok) { setErrors(r.errors); if (r.errors["_"]) toast.error(r.errors["_"]); return; }
    setEditing(false); toast.success("Additional information saved");
  };
  const row = (d: CustomFieldDef) => <div key={d.id} className="min-w-0"><dt className="eyebrow flex items-center gap-1.5">{d.label}{d.visibility === "owner" && <Lock className="size-2.5" aria-label="Owner only" />}</dt><dd className={cn("mt-1.5 text-sm break-words", v[d.id] === undefined && "text-muted-foreground")}>{v[d.id] === undefined ? (d.required ? <span className="cf-needs">Needs completion</span> : "—") : d.type === "url" ? <a className="underline" href={String(v[d.id])} target="_blank" rel="noreferrer noopener">{String(v[d.id]).replace(/^https?:\/\//, "")}</a> : displayValue(d, v[d.id])}</dd></div>;
  return <section aria-label="Additional information" className={cn("border-t pt-5", compact ? "mt-5" : "mt-7")}>
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" className="flex items-center gap-1.5 text-sm font-semibold" aria-expanded={open} onClick={() => setOpen(!open)}><ChevronDown className={cn("size-4 transition-transform", !open && "-rotate-90")} />Additional information</button>
      {needs.length > 0 && <span className="cf-needs">{needs.length} required missing</span>}
      {editable.length > 0 && !editing && <Button size="sm" variant="ghost" className="ml-auto h-7 rounded-full" onClick={start}><Pencil className="size-3.5" />Edit</Button>}
    </div>
    {editing ? <div className="mt-4 grid gap-4">
      <FieldForm defs={editable} draft={draft} onChange={(id, x) => setDraft((p) => ({ ...p, [id]: x }))} errors={errors} />
      {shown.length > editable.length && <p className="text-xs text-muted-foreground">{shown.length - editable.length} field{shown.length - editable.length > 1 ? "s are" : " is"} read-only for you.</p>}
      <div className="flex justify-end gap-2"><Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button><Button size="sm" onClick={commit}>Save</Button></div>
    </div> : <>
      {hi.length > 0 && <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">{hi.map(row)}</dl>}
      {open && rest.length > 0 && <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">{rest.map(row)}</dl>}
      {!open && rest.length > 0 && <button type="button" onClick={() => setOpen(true)} className="mt-2 text-xs text-muted-foreground underline">Show {rest.length} more field{rest.length > 1 ? "s" : ""}</button>}
    </>}
  </section>;
}

/* ---------- tags ---------- */
export function TagChips({ ids, max }: { ids: string[] | undefined; max?: number }) {
  const tags = useCRM((s) => s.tagDefs);
  const list = (ids ?? []).map((id) => tags.find((t) => t.id === id)).filter(Boolean) as typeof tags;
  if (!list.length) return null;
  const shown = max ? list.slice(0, max) : list;
  return <span className="inline-flex flex-wrap gap-1">{shown.map((t) => <span key={t.id} className="tag-chip" data-color={t.color} data-archived={t.status === "archived"} title={t.description ?? t.name}>{t.name}</span>)}{list.length > shown.length && <span className="tag-chip">+{list.length - shown.length}</span>}</span>;
}
/** Controlled tag chooser (Add Lead) — or bound to a lead when `leadId` is given. */
export function TagPicker({ leadId, value, onChange, label = "Tags" }: { leadId?: string; value?: string[]; onChange?: (ids: string[]) => void; label?: string }) {
  const tags = useCRM((s) => s.tagDefs); const bound = useCRM((s) => (leadId ? s.leadTags[leadId] : undefined)); const setLeadTags = useCRM((s) => s.setLeadTags);
  const { can } = useAccess();
  const cur = leadId ? bound ?? [] : value ?? [];
  const active = tags.filter((t) => t.status === "active");
  const toggle = (id: string) => { const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]; if (leadId) { if (!setLeadTags(leadId, next)) toast.error("Not allowed by this employee's permissions"); } else onChange?.(next); };
  const editable = !leadId || can("leads.edit");
  return <div className="flex flex-wrap items-center gap-1.5">
    <TagChips ids={cur} />
    {editable && active.length > 0 && <Popover>
      <PopoverTrigger asChild><Button size="sm" variant="ghost" className="h-6 rounded-full px-2 text-xs" aria-label={`Edit ${label.toLowerCase()}`}><Tag className="size-3" />{cur.length ? "Edit" : "Add tag"}</Button></PopoverTrigger>
      <PopoverContent align="start" className="w-60 p-2">
        <p className="eyebrow px-1 pb-1.5">{label}</p>
        <ul className="grid max-h-64 gap-0.5 overflow-y-auto">{active.map((t) => <li key={t.id}><label className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1.5 text-sm hover:bg-muted"><Checkbox checked={cur.includes(t.id)} onCheckedChange={() => toggle(t.id)} aria-label={t.name} /><span className="tag-chip" data-color={t.color}>{t.name}</span></label></li>)}</ul>
      </PopoverContent>
    </Popover>}
    {editable && !active.length && !cur.length && <span className="text-xs text-muted-foreground">No tags yet</span>}
  </div>;
}

/* ---------- condition builder ---------- */
const defaultOp = (f: FilterField): Op => OPS_FOR[f.kind][0]!;
const needsValue = (op: Op) => !["empty", "not_empty", "today", "overdue", "yes", "no"].includes(op);
export function ConditionValue({ f, c, onChange }: { f: FilterField; c: ViewCondition; onChange: (v: unknown) => void }) {
  if (!needsValue(c.op)) return <span className="h-10" />;
  if (f.options) {
    const cur = Array.isArray(c.value) ? (c.value as string[]) : typeof c.value === "string" ? [c.value] : [];
    if (c.op === "is") return <select aria-label={`${f.label} value`} className={cn(selectCls, "w-full")} value={cur[0] ?? ""} onChange={(e) => onChange(e.target.value ? [e.target.value] : [])}><option value="">Choose…</option>{f.options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</select>;
    return <Popover><PopoverTrigger asChild><Button variant="outline" className="h-10 w-full justify-between font-normal" aria-label={`${f.label} values`}><span className="truncate">{cur.length ? cur.map((id) => f.options!.find((o) => o.id === id)?.label ?? "Removed").join(", ") : "Choose…"}</span><ChevronDown className="size-4" /></Button></PopoverTrigger>
      <PopoverContent className="w-60 p-2"><ul className="grid max-h-64 gap-0.5 overflow-y-auto">{f.options.map((o) => <li key={o.id}><label className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1.5 text-sm hover:bg-muted"><Checkbox checked={cur.includes(o.id)} onCheckedChange={(v) => onChange(v ? [...cur, o.id] : cur.filter((x) => x !== o.id))} />{o.label}</label></li>)}{!f.options.length && <li className="p-2 text-xs text-muted-foreground">No options yet.</li>}</ul></PopoverContent></Popover>;
  }
  if (c.op === "between") { const [a, b] = Array.isArray(c.value) ? (c.value as string[]) : ["", ""]; const t = f.kind === "date" ? "date" : "number"; return <div className="grid grid-cols-2 gap-1.5"><Input aria-label="From" type={t} value={a ?? ""} onChange={(e) => onChange([e.target.value, b ?? ""])} /><Input aria-label="To" type={t} value={b ?? ""} onChange={(e) => onChange([a ?? "", e.target.value])} /></div>; }
  if (c.op === "within_days") return <Input aria-label="Days" type="number" min={0} value={String(c.value ?? "")} onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))} />;
  return <Input aria-label={`${f.label} value`} type={f.kind === "date" ? "date" : f.kind === "number" ? "number" : "text"} value={String(c.value ?? "")} onChange={(e) => onChange(f.kind === "number" && e.target.value !== "" ? Number(e.target.value) : e.target.value)} />;
}
export function ConditionBuilder({ filter, onChange, only, allowMode = true }: { filter: ViewFilter; onChange: (f: ViewFilter) => void; only?: (f: FilterField) => boolean; allowMode?: boolean }) {
  const st = useCRM(); const viewer = useViewer();
  const ctx = viewCtxOf(st, viewer);
  const all = filterFields(ctx).filter((f) => !f.archived || filter.conditions.some((c) => c.field === f.key));
  const fields = only ? all.filter(only) : all;
  const byKey = new Map(all.map((f) => [f.key, f]));
  const issues = viewIssues(filter.conditions.length ? { filter } : { filter: { mode: "and", conditions: [] } }, ctx);
  const upd = (id: string, p: Partial<ViewCondition>) => onChange({ ...filter, conditions: filter.conditions.map((c) => (c.id === id ? { ...c, ...p } : c)) });
  const add = () => { const f = fields[0]; if (!f) return; onChange({ ...filter, conditions: [...filter.conditions, { id: uid("cond"), field: f.key, op: defaultOp(f) }] }); };
  return <div className="grid gap-3">
    {allowMode && filter.conditions.length > 1 && <div className="flex items-center gap-2 text-sm">Match<select aria-label="Match mode" className={cn(selectCls, "h-8")} value={filter.mode} onChange={(e) => onChange({ ...filter, mode: e.target.value as "and" | "or" })}><option value="and">all conditions (AND)</option><option value="or">any condition (OR)</option></select></div>}
    {filter.conditions.map((c) => { const f = byKey.get(c.field); const iss = issues.filter((i) => i.conditionId === c.id);
      return <div key={c.id} className="grid gap-1">
        <div className="sv-cond">
          <select aria-label="Filter field" className={cn(selectCls, "w-full")} value={f ? c.field : ""} onChange={(e) => { const nf = byKey.get(e.target.value)!; upd(c.id, { field: nf.key, op: defaultOp(nf), value: undefined }); }}>{!f && <option value="">Unavailable field</option>}{fields.map((x) => <option key={x.key} value={x.key}>{x.label}{x.archived ? " (archived)" : ""}</option>)}</select>
          <select aria-label="Operator" className={cn(selectCls, "w-full")} value={c.op} disabled={!f} onChange={(e) => upd(c.id, { op: e.target.value as Op, value: undefined })}>{(f ? OPS_FOR[f.kind] : [c.op]).filter((o) => (o === "today" || o === "overdue" ? c.field === "followupDue" : true)).map((o) => <option key={o} value={o}>{OP_LABEL[o]}</option>)}</select>
          {f ? <ConditionValue f={f} c={c} onChange={(v) => upd(c.id, { value: v })} /> : <span />}
          <Button size="icon" variant="ghost" aria-label="Remove condition" onClick={() => onChange({ ...filter, conditions: filter.conditions.filter((x) => x.id !== c.id) })}><Trash2 className="size-4" /></Button>
        </div>
        {iss.map((i, k) => <p key={k} className="flex items-center gap-1.5 text-xs text-warning"><AlertTriangle className="size-3.5" />{i.text}</p>)}
      </div>; })}
    <div><Button size="sm" variant="outline" className="rounded-full" onClick={add} disabled={!fields.length}><Plus className="size-3.5" />Add condition</Button></div>
  </div>;
}
