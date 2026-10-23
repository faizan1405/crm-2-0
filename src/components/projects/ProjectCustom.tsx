// Phase 3G.1.1 — Project custom fields ("Additional information") and Project tags.
// Reuses the Lead field inputs (FieldForm/FieldInput) and tag chips; every write goes through Project store actions.
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { ChevronDown, Lock, Pencil, Tag } from "lucide-react";
import { useCRM } from "@/lib/crm/store";
import { useSession } from "@/lib/crm/session";
import { projectFieldViewer } from "@/lib/crm/projectCustomStore";
import { activeFields, displayValue, fieldEditable, fieldVisible, tagForProjects, type CustomFieldDef } from "@/lib/crm/customize";
import { FieldForm, TagChips, toDraft, type Draft } from "@/components/crm/Customize";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export function useProjectFieldViewer() { useSession((s) => s.preview); return projectFieldViewer(); }

/** Project Overview section. Highlighted fields always show; the rest sit behind "Show more". Existing projects are never back-filled. */
export function ProjectAdditionalInfo({ projectId }: { projectId: string }) {
  const defs = useCRM((s) => s.projectFields); const values = useCRM((s) => s.projectFieldValues[projectId]); const save = useCRM((s) => s.setProjectFieldValues);
  const viewer = useProjectFieldViewer();
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
    const r = save(projectId, changed);
    if (!r.ok) { setErrors(r.errors); if (r.errors["_"]) toast.error(r.errors["_"]); return; }
    setEditing(false); toast.success("Additional information saved");
  };
  const row = (d: CustomFieldDef) => <div key={d.id} className="min-w-0"><dt className="eyebrow flex items-center gap-1.5">{d.label}{d.visibility === "owner" && <Lock className="size-2.5" aria-label="Owner only" />}</dt><dd className={cn("mt-1.5 text-sm break-words", v[d.id] === undefined && "text-muted-foreground")}>{v[d.id] === undefined ? (d.required ? <span className="cf-needs">Needs completion</span> : "—") : d.type === "url" ? <a className="underline" href={String(v[d.id])} target="_blank" rel="noreferrer noopener">{String(v[d.id]).replace(/^https?:\/\//, "")}</a> : displayValue(d, v[d.id])}</dd></div>;
  return <section aria-label="Additional information" className="receipt p-5 sm:p-6">
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" className="eyebrow flex items-center gap-1.5" aria-expanded={open} onClick={() => setOpen(!open)}><ChevronDown className={cn("size-3.5 transition-transform", !open && "-rotate-90")} />Additional information</button>
      {needs.length > 0 && <span className="cf-needs">{needs.length} required missing</span>}
      {editable.length > 0 && !editing && <Button size="sm" variant="ghost" className="ml-auto h-7 rounded-full" onClick={start}><Pencil className="size-3.5" />Edit</Button>}
    </div>
    {editing ? <div className="mt-4 grid gap-4">
      <FieldForm defs={editable} draft={draft} onChange={(id, x) => setDraft((p) => ({ ...p, [id]: x }))} errors={errors} />
      {shown.length > editable.length && <p className="text-xs text-muted-foreground">{shown.length - editable.length} field{shown.length - editable.length > 1 ? "s are" : " is"} read-only for you.</p>}
      <p className="text-[11px] text-muted-foreground">Never store passwords or access keys here.</p>
      <div className="flex justify-end gap-2"><Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button><Button size="sm" onClick={commit}>Save</Button></div>
    </div> : <>
      {hi.length > 0 && <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">{hi.map(row)}</dl>}
      {(open || !hi.length) && rest.length > 0 && <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">{rest.map(row)}</dl>}
      {!open && hi.length > 0 && rest.length > 0 && <button type="button" onClick={() => setOpen(true)} className="mt-2 text-xs text-muted-foreground underline">Show {rest.length} more field{rest.length > 1 ? "s" : ""}</button>}
    </>}
  </section>;
}

/** Project tags bound to one project. Only Project-scoped tags can be added; archived tags already on it stay visible. */
export function ProjectTagPicker({ projectId, canEdit }: { projectId: string; canEdit: boolean }) {
  const tags = useCRM((s) => s.tagDefs); const cur = useCRM((s) => s.projectTags[projectId]) ?? []; const setTags = useCRM((s) => s.setProjectTags);
  const active = tags.filter((t) => t.status === "active" && tagForProjects(t));
  const toggle = (id: string) => { if (!setTags(projectId, cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id])) toast.error("You can't change tags on this project."); };
  return <div className="flex flex-wrap items-center gap-1.5">
    <TagChips ids={cur} />
    {canEdit && active.length > 0 && <Popover>
      <PopoverTrigger asChild><Button size="sm" variant="ghost" className="h-6 rounded-full px-2 text-xs" aria-label="Edit project tags"><Tag className="size-3" />{cur.length ? "Edit" : "Add tag"}</Button></PopoverTrigger>
      <PopoverContent align="start" className="w-60 p-2">
        <p className="eyebrow px-1 pb-1.5">Project tags</p>
        <ul className="grid max-h-64 gap-0.5 overflow-y-auto">{active.map((t) => <li key={t.id}><label className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1.5 text-sm hover:bg-muted"><Checkbox checked={cur.includes(t.id)} onCheckedChange={() => toggle(t.id)} aria-label={t.name} /><span className="tag-chip" data-color={t.color}>{t.name}</span></label></li>)}</ul>
      </PopoverContent>
    </Popover>}
    {!cur.length && (!canEdit || !active.length) && <span className="text-xs text-muted-foreground">{active.length ? "No tags" : "No project tags yet — create them in CRM Configuration."}</span>}
  </div>;
}
