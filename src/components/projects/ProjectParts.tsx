import { useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { selectCls } from "@/components/crm/Shell";
import { useCRM } from "@/lib/crm/store";
import { useSession, allows } from "@/lib/crm/session";
import { projectViewer } from "@/lib/crm/projectStore";
import { activeProjectForDeal, draftFromDeal, PROJECT_STATUSES, STATUS_TEXT, STAGE_TEXT, type Project, type ProjectStage, type ProjectStatus, type ProjectViewer } from "@/lib/crm/projects";
import { displayValue, fieldVisible } from "@/lib/crm/customize";
import { cn } from "@/lib/utils";
import type { Deal } from "@/lib/crm/types";

/** Re-renders when the preview session changes. */
export function useProjectViewer(): ProjectViewer {
  useSession((s) => s.preview);
  return projectViewer();
}
export function useCanProject(perm: string) { const pv = useSession((s) => s.preview); return allows(pv, perm); }

export function StatusPill({ status }: { status: ProjectStatus }) { return <span className="pd-pill" data-status={status}>{STATUS_TEXT[status]}</span>; }
export function StagePill({ stage }: { stage: ProjectStage }) { return <span className="pd-pill" data-stage={stage}>{STAGE_TEXT[stage]}</span>; }

/** Name for "owner" or an employee id. */
export function usePeople() {
  const owner = useCRM((s) => s.owner), employees = useCRM((s) => s.employees);
  return useMemo(() => {
    const list = [{ id: "owner", name: `${owner || "Owner"} (Owner)` }, ...employees.filter((e) => e.accountStatus !== "archived").map((e) => ({ id: e.id, name: e.name }))];
    const name = (id: string | null | undefined) => (!id ? "Unassigned" : list.find((p) => p.id === id)?.name ?? "Former member");
    return { list, name };
  }, [owner, employees]);
}

/** Owner-confirmed Deal → Project handoff. Prefills from the Deal/Lead; nothing is paid, booked or started automatically. */
export function CreateProjectDialog({ deal, open, onOpenChange }: { deal: Deal | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  return <Dialog open={open && !!deal} onOpenChange={onOpenChange}><DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-2xl">{deal && <CreateBody key={deal.id} deal={deal} close={() => onOpenChange(false)} />}</DialogContent></Dialog>;
}

function CreateBody({ deal, close }: { deal: Deal; close: () => void }) {
  const nav = useNavigate();
  const { leads, projects, projectTemplates, customFields, fieldValues, quotationShares, quotationTemplates, createProject } = useCRM();
  const lead = deal.leadId ? leads.find((l) => l.id === deal.leadId) : undefined;
  const existing = activeProjectForDeal(projects, deal.id);
  const [allowAnother, setAllowAnother] = useState(false);
  const templates = projectTemplates.filter((t) => !t.archived);
  const [tplId, setTplId] = useState(templates[0]?.id ?? "");
  const tpl = templates.find((t) => t.id === tplId);
  const share = lead ? quotationShares.filter((s) => s.leadId === lead.id).sort((a, b) => b.at.localeCompare(a.at))[0] : undefined;
  const packageRef = share ? quotationTemplates.find((q) => q.id === share.templateId)?.name ?? share.templateName : undefined;
  // Only team-visible custom values are carried; the Lead record and its schema are never changed.
  const fields = lead ? customFields.filter((f) => f.status === "active" && fieldVisible(f, { owner: false, employeeId: "", canEdit: false }) && fieldValues[lead.id]?.[f.id] != null).map((f) => ({ label: f.label, value: displayValue(f, fieldValues[lead.id]![f.id]) })).filter((x) => x.value) : [];
  const service = fields.find((f) => /service/i.test(f.label))?.value;
  const [f, setF] = useState({ name: deal.name, plannedStart: "", targetDelivery: "", status: "accepted" as ProjectStatus, scope: lead?.requirement ?? "" });
  const [tasks, setTasks] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const planTasks = tpl ? tpl.tasks : [];
  const save = () => {
    if (busy) return; setBusy(true); // repeated clicks never create copies
    const draft = { ...draftFromDeal({ deal, lead, template: tpl, fields, packageRef, service }), name: f.name, status: f.status, scope: f.scope || undefined, plannedStart: f.plannedStart || undefined, targetDelivery: f.targetDelivery || undefined };
    const extra = tasks.split("\n").map((t) => t.trim()).filter(Boolean).map((title) => ({ title }));
    const r = createProject(draft, { milestones: tpl?.milestones ?? [], tasks: [...planTasks, ...extra], allowAnother });
    if (!r.ok) { setBusy(false); toast.error(r.error); return; }
    toast.success("Project created", { description: "Payments stay in Deals & Payments — nothing was marked paid." });
    close(); void nav({ to: "/projects/$id", params: { id: r.id } });
  };
  return <>
    <DialogHeader><DialogTitle>Create project from deal</DialogTitle><DialogDescription>Hands “{deal.name}” over to delivery. The lead and deal stay as they are; money is read from Finance Studio.</DialogDescription></DialogHeader>
    {existing && !allowAnother ? <div className="pd-note" role="alert">
      <p className="text-sm"><b>“{existing.name}”</b> is already active for this deal ({STATUS_TEXT[existing.status]}).</p>
      <div className="mt-3 flex flex-wrap gap-2"><Button size="sm" onClick={() => { close(); void nav({ to: "/projects/$id", params: { id: existing.id } }); }}>Open existing project</Button><Button size="sm" variant="outline" onClick={() => setAllowAnother(true)}>Create a separate project anyway</Button></div>
    </div> : <div className="grid gap-4">
      <dl className="pd-carry">
        <div><dt>Client</dt><dd>{deal.clientName}{deal.company ? ` · ${deal.company}` : ""}</dd></div>
        <div><dt>Phone</dt><dd>{deal.phone ?? lead?.phone ?? "—"}</dd></div>
        <div><dt>Email</dt><dd>{lead?.email ?? "—"}</dd></div>
        <div><dt>Lead source</dt><dd>{lead?.source ?? "—"}</dd></div>
        <div><dt>Deal value</dt><dd className="num">₹{deal.finalAmount.toLocaleString("en-IN")}</dd></div>
        <div><dt>Accepted package</dt><dd>{packageRef ?? "—"}</dd></div>
        {fields.map((x) => <div key={x.label}><dt>{x.label}</dt><dd>{x.value}</dd></div>)}
      </dl>
      <div className="grid gap-1.5"><Label htmlFor="pj-name">Project name</Label><Input id="pj-name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-1.5"><Label htmlFor="pj-tpl">Project type / template</Label><select id="pj-tpl" className={selectCls} value={tplId} onChange={(e) => setTplId(e.target.value)}>{templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></div>
        <div className="grid gap-1.5"><Label htmlFor="pj-status">Current status</Label><select id="pj-status" className={selectCls} value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as ProjectStatus })}>{PROJECT_STATUSES.filter((s) => s !== "completed" && s !== "cancelled").map((s) => <option key={s} value={s}>{STATUS_TEXT[s]}</option>)}</select></div>
        <div className="grid gap-1.5"><Label htmlFor="pj-start">Planned start (optional)</Label><Input id="pj-start" type="date" value={f.plannedStart} onChange={(e) => setF({ ...f, plannedStart: e.target.value })} /></div>
        <div className="grid gap-1.5"><Label htmlFor="pj-due">Target delivery (optional)</Label><Input id="pj-due" type="date" value={f.targetDelivery} onChange={(e) => setF({ ...f, targetDelivery: e.target.value })} /></div>
      </div>
      <div className="grid gap-1.5"><Label htmlFor="pj-scope">Agreed scope</Label><Textarea id="pj-scope" rows={2} value={f.scope} onChange={(e) => setF({ ...f, scope: e.target.value })} /></div>
      {tpl && <div className="text-xs text-muted-foreground">Template adds {tpl.milestones.length} milestone(s), {tpl.tasks.length} task(s), {tpl.requirements.length} requirement(s) and {tpl.qa.length + tpl.handover.length} delivery checks. You can edit or add to all of them afterwards.</div>}
      <div className="grid gap-1.5"><Label htmlFor="pj-extra">Extra tasks for this project (one per line, optional)</Label><Textarea id="pj-extra" rows={2} value={tasks} onChange={(e) => setTasks(e.target.value)} /></div>
    </div>}
    <DialogFooter><Button variant="ghost" onClick={close}>Cancel</Button>{(!existing || allowAnother) && <Button disabled={busy} onClick={save}>{busy ? "Creating…" : "Create project"}</Button>}</DialogFooter>
  </>;
}

export function ProgressBar({ pct, label }: { pct: number | null; label: string }) {
  return <div><div className="balance-track"><div style={{ width: `${pct ?? 0}%` }} /></div><div className={cn("mt-1.5 text-[11px] text-muted-foreground")}>{label}</div></div>;
}

export type { Project };
