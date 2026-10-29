import { createFileRoute, Link } from "@tanstack/react-router";
import { safeHref } from "@/lib/crm/validation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ArrowDown, ArrowLeft, ArrowUp, Check, ExternalLink, FolderKanban, MessageCircle, Plus, RotateCcw } from "lucide-react";
import { Shell, Empty, selectCls } from "@/components/crm/Shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { openWhatsApp } from "@/components/crm/WhatsAppComposer";
import { useCRM } from "@/lib/crm/store";
import { useSession, allows } from "@/lib/crm/session";
import { dayKey, formatDate, formatDateTime, formatINR } from "@/lib/crm/format";
import {
  addMonths, canCompleteTask, canEditTask, canSeeProject, canSeeProjectFinance, deliveryGaps, milestoneProgress, projectFinance, projectMessage, projectProgress,
  reversalFlag, supportStatus, taskOverdue, MESSAGE_TEXT, PROJECT_STAGES, PROJECT_STATUSES, STAGE_TEXT, STATUS_TEXT, SUPPORT_KIND_TEXT, SUPPORT_TEXT,
  type CheckItem, type Project, type ProjectMessage, type ProjectPriority, type ProjectStage, type ProjectStatus, type ProjectTask, type SupportKind,
} from "@/lib/crm/projects";
import type { CheckList } from "@/lib/crm/projectStore";
import { ProjectAdditionalInfo, ProjectTagPicker } from "@/components/projects/ProjectCustom";
import { ProgressBar, StagePill, StatusPill, useCanProject, usePeople, useProjectViewer } from "@/components/projects/ProjectParts";
import { cn } from "@/lib/utils";
import { runGuarded } from "@/components/crm/conflictFeedback";

type Tab = "overview" | "tasks" | "requirements" | "finance" | "activity" | "delivery";
const TABS: Tab[] = ["overview", "tasks", "requirements", "finance", "activity", "delivery"];
const TAB_TEXT: Record<Tab, string> = { overview: "Overview", tasks: "Tasks & milestones", requirements: "Client requirements", finance: "Finance", activity: "Activity", delivery: "Delivery & support" };

export const Route = createFileRoute("/projects_/$id")({
  validateSearch: (s: Record<string, unknown>): { tab?: Tab } => (TABS.includes(s["tab"] as Tab) ? { tab: s["tab"] as Tab } : {}),
  head: () => ({ meta: [
    { title: "Project details — Scale Flow Sales OS" },
    { name: "description", content: "Project workspace: tasks, client requirements, finance, delivery and support." },
    { property: "og:title", content: "Project details — Scale Flow Sales OS" },
    { property: "og:description", content: "One project's tasks, requirements, payments, delivery and support." },
    { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }, { name: "robots", content: "noindex" },
  ] }),
  component: ProjectPage,
});

function ProjectPage() {
  const { id } = Route.useParams();
  const { tab = "overview" } = Route.useSearch();
  const p = useCRM((s) => s.projects.find((x) => x.id === id));
  const deals = useCRM((s) => s.deals), leads = useCRM((s) => s.leads);
  const v = useProjectViewer();
  if (!p || !canSeeProject(p, v)) return <Shell title="Project"><div className="receipt"><Empty icon={<FolderKanban />} title="Project not available" hint="It doesn't exist or isn't assigned to you." action={<Link to="/projects" className="text-sm underline">Back to Project Desk</Link>} /></div></Shell>;
  const flag = reversalFlag(p, deals, leads);
  const tabs = TABS.filter((t) => t !== "finance" || canSeeProjectFinance(v));
  return (
    <Shell title={p.name} subtitle={`${p.clientName}${p.company ? ` · ${p.company}` : ""} · ${p.type}`}>
      <div className="mb-4 flex flex-wrap items-center gap-2"><Link to="/projects" search={{ tab: "all" }} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" />Project Desk</Link><span className="flex-1" /><StatusPill status={p.status} /><StagePill stage={p.stage} />{p.archived && <span className="pd-pill">Archived</span>}</div>
      {flag && <div className="pd-note mb-4" role="alert">{flag} The project and its history are kept.</div>}
      <nav className="mb-6 max-w-full overflow-x-auto" aria-label="Project sections"><div className="seg w-max">{tabs.map((t) => <Link key={t} to="/projects/$id" params={{ id }} search={{ tab: t }} aria-pressed={tab === t}>{TAB_TEXT[t]}</Link>)}</div></nav>
      {tab === "overview" && <OverviewTab p={p} />}
      {tab === "tasks" && <TasksTab p={p} />}
      {tab === "requirements" && <RequirementsTab p={p} />}
      {tab === "finance" && canSeeProjectFinance(v) && <FinanceTab p={p} />}
      {tab === "activity" && <ActivityTab p={p} />}
      {tab === "delivery" && <DeliveryTab p={p} />}
    </Shell>
  );
}

const Card = ({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) => <section className={cn("receipt p-5 sm:p-6", className)} aria-label={title}><div className="eyebrow mb-4">{title}</div>{children}</section>;

function OverviewTab({ p }: { p: Project }) {
  const { projectTasks, updateProject, setProjectStatus, moveProjectStage, archiveProject, business, owner, leads } = useCRM();
  const people = usePeople();
  const v = useProjectViewer();
  const canEdit = useCanProject("projects.edit"), canStage = useCanProject("projects.stage");
  const canWa = allows(useSession((s) => s.preview), "clients.whatsapp");
  const tasks = projectTasks.filter((t) => t.projectId === p.id);
  const prog = projectProgress(tasks);
  const [f, setF] = useState({ name: p.name, scope: p.scope ?? "", bookingDate: p.bookingDate ?? "", plannedStart: p.plannedStart ?? "", actualStart: p.actualStart ?? "", targetDelivery: p.targetDelivery ?? "", priority: p.priority, ownerId: p.ownerId ?? "", notes: p.notes ?? "" });
  const [members, setMembers] = useState<string[]>(p.memberIds);
  const [msg, setMsg] = useState<ProjectMessage>("kickoff");
  const lead = p.leadId ? leads.find((l) => l.id === p.leadId) : undefined;
  const save = () => { const e = updateProject(p.id, { name: f.name, scope: f.scope || undefined, bookingDate: f.bookingDate || undefined, plannedStart: f.plannedStart || undefined, actualStart: f.actualStart || undefined, targetDelivery: f.targetDelivery || undefined, priority: f.priority, ownerId: f.ownerId || null, memberIds: members, notes: v.owner ? f.notes || undefined : p.notes }); if (e) toast.error(e); else toast.success("Project saved"); };
  const pending = [...p.requirements.filter((r) => !r.done).map((r) => r.label), ...p.dependencies.filter((d) => !d.done).map((d) => d.label)];
  const date = (k: "bookingDate" | "plannedStart" | "actualStart" | "targetDelivery", label: string) => <label className="grid gap-1.5 text-sm"><span className="text-muted-foreground">{label}</span><Input type="date" disabled={!canEdit} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></label>;
  return <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
    <div className="grid content-start gap-6">
    <Card title="Project information">
      <div className="grid gap-4">
        <label className="grid gap-1.5 text-sm"><span className="text-muted-foreground">Project name</span><Input disabled={!canEdit} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
        <label className="grid gap-1.5 text-sm"><span className="text-muted-foreground">Agreed scope</span><Textarea disabled={!canEdit} rows={3} value={f.scope} onChange={(e) => setF({ ...f, scope: e.target.value })} /></label>
        <div className="grid gap-3 sm:grid-cols-2">{date("bookingDate", "Booking date")}{date("plannedStart", "Planned start")}{date("actualStart", "Actual start")}{date("targetDelivery", "Target delivery")}</div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1.5 text-sm"><span className="text-muted-foreground">Project owner</span><select disabled={!canEdit} className={selectCls} value={f.ownerId} onChange={(e) => setF({ ...f, ownerId: e.target.value })}><option value="">Unassigned</option>{people.list.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
          <label className="grid gap-1.5 text-sm"><span className="text-muted-foreground">Priority</span><select disabled={!canEdit} className={selectCls} value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value as ProjectPriority })}><option value="high">High</option><option value="normal">Normal</option><option value="low">Low</option></select></label>
        </div>
        <fieldset className="grid gap-1.5 text-sm"><legend className="mb-1.5 text-muted-foreground">Team members</legend><div className="flex flex-wrap gap-2">{people.list.filter((x) => x.id !== "owner").map((x) => <label key={x.id} className="pd-chip"><input type="checkbox" disabled={!canEdit || !v.owner} checked={members.includes(x.id)} onChange={(e) => setMembers(e.target.checked ? [...members, x.id] : members.filter((m) => m !== x.id))} />{x.name}</label>)}{people.list.length === 1 && <span className="text-xs text-muted-foreground">No employees yet.</span>}</div><span className="text-xs text-muted-foreground">Project access is separate from lead assignment.</span></fieldset>
        {v.owner && <label className="grid gap-1.5 text-sm"><span className="text-muted-foreground">Internal notes (Owner only)</span><Textarea rows={3} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="Never paste passwords here." /></label>}
        {canEdit && <div className="flex justify-end"><Button onClick={save}>Save changes</Button></div>}
      </div>
    </Card>
    <ProjectAdditionalInfo projectId={p.id} />
    </div>
    <div className="grid content-start gap-6">
      {p.attention && <div className="pd-note" role="status"><b>Flagged by automation:</b> {p.attention.reason}{v.owner && <button type="button" className="ml-2 underline" onClick={() => { const e = updateProject(p.id, { attention: undefined }, "Automation flag cleared"); if (e) toast.error(e); }}>Clear</button>}</div>}
      <Card title="Tags"><ProjectTagPicker projectId={p.id} canEdit={canEdit} /></Card>
      <Card title="Status">
        <div className="grid gap-3">
          <label className="grid gap-1.5 text-sm"><span className="text-muted-foreground">Commercial / booking status</span><select aria-label="Project status" disabled={!canStage} className={selectCls} value={p.status} onChange={(e) => setProjectStatus(p.id, e.target.value as ProjectStatus)}>{PROJECT_STATUSES.map((s) => <option key={s} value={s}>{STATUS_TEXT[s]}</option>)}</select></label>
          <label className="grid gap-1.5 text-sm"><span className="text-muted-foreground">Delivery stage</span><select aria-label="Project stage" disabled={!canStage} className={selectCls} value={p.stage} onChange={(e) => { const s = e.target.value as ProjectStage; if (s === "delivered") { toast.error("Record delivery from the Delivery & support tab."); return; } const r = runGuarded(() => moveProjectStage(p.id, s, p.stage)); if (r?.value) toast.success(`Moved to ${STAGE_TEXT[s]}`); }}>{PROJECT_STAGES.map((s) => <option key={s} value={s} disabled={s === "delivered" && !p.delivery}>{STAGE_TEXT[s]}</option>)}</select></label>
          <ProgressBar pct={prog.pct} label={prog.text} />
          <p className="text-xs text-muted-foreground">Progress counts only completed tasks — never the stage.</p>
          {v.owner && <Button variant="ghost" size="sm" className="justify-self-start" onClick={() => { if (p.archived || window.confirm("Archive this project? Its tasks, delivery and payment links are kept.")) { const want = !p.archived; const r = runGuarded(() => archiveProject(p.id, want)); if (r && !r.value) toast.warning(want ? "This project was already archived in another tab — nothing changed." : "This project was already restored in another tab — nothing changed."); } }}>{p.archived ? "Restore project" : "Archive project"}</Button>}
        </div>
      </Card>
      <Card title="Client">
        <dl className="pd-carry">
          <div><dt>Client</dt><dd>{p.leadId ? <Link to="/leads/$id" params={{ id: p.leadId }} className="underline-offset-4 hover:underline">{p.clientName}</Link> : p.clientName}</dd></div>
          <div><dt>Phone</dt><dd>{p.phone ?? "—"}</dd></div><div><dt>Email</dt><dd>{p.email ?? "—"}</dd></div>
          <div><dt>Lead source</dt><dd>{p.carried.source ?? "—"}</dd></div><div><dt>Package</dt><dd>{p.carried.packageRef ?? "—"}</dd></div>
          {p.dealId && <div><dt>Deal</dt><dd><Link to="/deals" className="underline-offset-4 hover:underline">Open in Deals & Payments</Link></dd></div>}
          {(p.carried.fields ?? []).map((x) => <div key={x.label}><dt>{x.label}</dt><dd>{x.value}</dd></div>)}
        </dl>
        <p className="mt-3 text-xs text-muted-foreground">Captured at handoff. The original lead is unchanged.</p>
      </Card>
      {lead && canWa && <Card title="WhatsApp the client">
        <div className="flex flex-wrap gap-2"><select aria-label="Message type" className={selectCls} value={msg} onChange={(e) => setMsg(e.target.value as ProjectMessage)}>{Object.entries(MESSAGE_TEXT).map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select><Button variant="outline" className="rounded-full" onClick={() => openWhatsApp(lead.id, `Project Desk · ${MESSAGE_TEXT[msg]}`, { text: projectMessage(msg, p, { owner, business, pending, progress: prog.text }) })}><MessageCircle className="size-4" />Prepare message</Button></div>
        <p className="mt-2 text-xs text-muted-foreground">Opens the WhatsApp composer with an editable draft. Only messages you confirm as sent are recorded.</p>
      </Card>}
    </div>
  </div>;
}

function TasksTab({ p }: { p: Project }) {
  const { projectTasks, projectMilestones, addTask, updateTask, setTaskDone, moveTask, addMilestone } = useCRM();
  const people = usePeople();
  const v = useProjectViewer();
  const canAdd = useCanProject("projects.tasks_add");
  const today = dayKey(new Date());
  const tasks = projectTasks.filter((t) => t.projectId === p.id).sort((a, b) => a.order - b.order);
  const ms = projectMilestones.filter((m) => m.projectId === p.id).sort((a, b) => a.order - b.order);
  const [nt, setNt] = useState({ title: "", milestoneId: "", assigneeId: "", dueDate: "", priority: "normal" as ProjectPriority });
  const [nm, setNm] = useState({ title: "", dueDate: "" });
  const prog = projectProgress(tasks);
  const groups: { id: string; title: string; dueDate?: string | undefined }[] = [...ms, { id: "", title: "Not in a milestone" }];
  return <div className="grid gap-6">
    <Card title="Progress"><ProgressBar pct={prog.pct} label={prog.text} /></Card>
    {canAdd && <Card title="Add task"><div className="pd-filters">
      <Input aria-label="Task title" placeholder="Task title" className="min-w-[200px] flex-1" value={nt.title} onChange={(e) => setNt({ ...nt, title: e.target.value })} />
      <select aria-label="Milestone" className={selectCls} value={nt.milestoneId} onChange={(e) => setNt({ ...nt, milestoneId: e.target.value })}><option value="">No milestone</option>{ms.map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}</select>
      <select aria-label="Assignee" className={selectCls} value={nt.assigneeId} onChange={(e) => setNt({ ...nt, assigneeId: e.target.value })}><option value="">Unassigned</option>{people.list.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
      <Input aria-label="Due date" type="date" className="w-auto" value={nt.dueDate} onChange={(e) => setNt({ ...nt, dueDate: e.target.value })} />
      <select aria-label="Priority" className={selectCls} value={nt.priority} onChange={(e) => setNt({ ...nt, priority: e.target.value as ProjectPriority })}><option value="high">High</option><option value="normal">Normal</option><option value="low">Low</option></select>
      <Button onClick={() => { const r = addTask(p.id, { title: nt.title, milestoneId: nt.milestoneId || undefined, assigneeId: nt.assigneeId || null, dueDate: nt.dueDate || undefined, priority: nt.priority }); if (!r.ok) toast.error(r.error); else { setNt({ ...nt, title: "" }); toast.success("Task added"); } }}><Plus className="size-4" />Add</Button>
    </div>
    <div className="pd-filters mt-3"><Input aria-label="Milestone name" placeholder="New milestone" className="min-w-[200px] flex-1" value={nm.title} onChange={(e) => setNm({ ...nm, title: e.target.value })} /><Input aria-label="Milestone due" type="date" className="w-auto" value={nm.dueDate} onChange={(e) => setNm({ ...nm, dueDate: e.target.value })} /><Button variant="outline" onClick={() => { const e = addMilestone(p.id, nm.title, nm.dueDate || undefined); if (e) toast.error(e); else setNm({ title: "", dueDate: "" }); }}>Add milestone</Button></div></Card>}
    {groups.map((g) => { const list = tasks.filter((t) => (t.milestoneId ?? "") === g.id && (g.id || !ms.some((m) => m.id === t.milestoneId))); if (!g.id && !list.length) return null; const mp = g.id ? milestoneProgress(g as never, tasks) : null;
      return <Card key={g.id || "none"} title={`${g.title}${g.dueDate ? ` · due ${formatDate(g.dueDate)}` : ""}${mp ? ` · ${mp.done}/${mp.total}${mp.complete ? " · complete" : ""}` : ""}`}>
        {list.length === 0 ? <p className="text-sm text-muted-foreground">No tasks in this milestone yet.</p> : <ul className="grid gap-2">{list.map((t) => <TaskRow key={t.id} t={t} p={p} late={taskOverdue(t, today)} assignee={people.name(t.assigneeId)} people={people.list} canEdit={canEditTask(t, p, v)} canDone={canCompleteTask(t, p, v)} onDone={(d) => { const r = runGuarded(() => setTaskDone(t.id, d)); if (r && !r.value) { const cur = useCRM.getState().projectTasks.find((x) => x.id === t.id); if (cur && (cur.status === "done") === d) toast.warning(d ? "This task was already completed in another tab — nothing changed." : "This task was already reopened in another tab — nothing changed."); else toast.error("You can't change this task."); } }} onMove={(d) => moveTask(t.id, d)} onEdit={(patch, base) => { const r = runGuarded(() => updateTask(t.id, patch, base ?? t.version)); if (!r) return false; if (r.value) { toast.error(r.value); return false; } return true; }} />)}</ul>}
      </Card>; })}
    {tasks.length === 0 && <div className="receipt"><Empty icon={<FolderKanban />} title="No tasks yet" hint="Add the real work for this project. Progress is only measured from completed tasks." /></div>}
  </div>;
}

function TaskRow({ t, late, assignee, people, canEdit, canDone, onDone, onMove, onEdit }: { t: ProjectTask; p: Project; late: boolean; assignee: string; people: { id: string; name: string }[]; canEdit: boolean; canDone: boolean; onDone: (d: boolean) => void; onMove: (d: -1 | 1) => void; onEdit: (p: { assigneeId?: string | null; dueDate?: string | undefined; notes?: string | undefined }, baseVersion?: number) => boolean }) {
  const [open, setOpen] = useState(false), [notes, setNotes] = useState(t.notes ?? "");
  // The notes draft remembers the task version it started from, so a save from an outdated tab is refused instead of overwriting newer notes.
  const [base, setBase] = useState({ version: t.version, notes: t.notes ?? "" });
  const changedElsewhere = t.version !== base.version;
  const dirty = notes !== base.notes;
  useEffect(() => { if (changedElsewhere && !dirty) { setNotes(t.notes ?? ""); setBase({ version: t.version, notes: t.notes ?? "" }); } }, [changedElsewhere, dirty, t.version, t.notes]);
  const conflict = changedElsewhere && dirty && (t.notes ?? "") !== base.notes;
  const loadLatest = () => { setNotes(t.notes ?? ""); setBase({ version: t.version, notes: t.notes ?? "" }); };
  // Assignee / due-date edits carry the version this row showed; if another tab saved first, keep the person's choice and ask.
  const [pending, setPending] = useState<{ patch: { assigneeId?: string | null; dueDate?: string | undefined }; label: string } | null>(null);
  const quickEdit = (patch: { assigneeId?: string | null; dueDate?: string | undefined }, label: string) => {
    if (onEdit(patch, t.version)) { setPending(null); return; }
    const cur = useCRM.getState().projectTasks.find((x) => x.id === t.id);
    if (cur && cur.version !== t.version) setPending({ patch, label });
  };
  const saveNotes = () => { if (onEdit({ notes: notes || undefined }, base.version)) { const cur = useCRM.getState().projectTasks.find((x) => x.id === t.id); setBase({ version: cur?.version ?? t.version, notes }); toast.success("Task notes saved"); } };
  return <li className="pd-task" data-done={t.status === "done" || undefined}>
    <div className="flex items-start gap-3">
      <button type="button" className="pd-check" aria-label={t.status === "done" ? `Reopen ${t.title}` : `Complete ${t.title}`} aria-pressed={t.status === "done"} disabled={!canDone} onClick={() => onDone(t.status !== "done")}>{t.status === "done" ? <Check className="size-3.5" /> : null}</button>
      <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setOpen(!open)}><div className="text-sm font-medium">{t.title}</div><div className="text-xs text-muted-foreground">{assignee} · {t.priority}{t.dueDate ? ` · due ${formatDate(t.dueDate)}` : ""}{late && <b className="ml-1 text-destructive">Overdue</b>}{dirty && !open && <b className="ml-1 text-warning">· Unsaved notes</b>}{t.completedAt ? ` · done ${formatDate(t.completedAt)}` : ""}</div></button>
      {canEdit && <div className="flex gap-0.5"><Button size="icon" variant="ghost" className="size-7" aria-label="Move up" onClick={() => onMove(-1)}><ArrowUp className="size-3.5" /></Button><Button size="icon" variant="ghost" className="size-7" aria-label="Move down" onClick={() => onMove(1)}><ArrowDown className="size-3.5" /></Button></div>}
    </div>
    {open && <div className="mt-3 grid gap-2 border-t pt-3">
      {canEdit && <div className="pd-filters"><select aria-label="Reassign" className={selectCls} value={t.assigneeId ?? ""} onChange={(e) => { const v = e.target.value || null; quickEdit({ assigneeId: v }, `assignee “${people.find((x) => x.id === v)?.name ?? "Unassigned"}”`); }}><option value="">Unassigned</option>{people.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select><Input aria-label="Change due date" type="date" className="w-auto" value={t.dueDate ?? ""} onChange={(e) => quickEdit({ dueDate: e.target.value || undefined }, e.target.value ? `due date ${formatDate(e.target.value)}` : "no due date")} /></div>}
      {canEdit && pending && <div className="pd-note" role="alert"><b>This task was updated in another tab.</b> Nothing was saved. Latest: {assignee}{t.dueDate ? ` · due ${formatDate(t.dueDate)}` : " · no due date"}. Your change: {pending.label}.<div className="mt-2 flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => { if (onEdit(pending.patch, t.version)) { setPending(null); toast.success("Your change was saved on top of the latest task"); } }}>Apply my change</Button><Button size="sm" variant="outline" onClick={() => setPending(null)}>Keep latest</Button></div></div>}
      {canEdit ? <>{conflict && <div className="pd-note" role="alert"><b>These task notes were updated in another tab.</b> Your draft is kept. Latest saved notes: “{t.notes || "(empty)"}”<div className="mt-2 flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={loadLatest}>Load latest (discard draft)</Button><Button size="sm" variant="outline" onClick={() => setBase({ version: t.version, notes: t.notes ?? "" })}>Keep my draft</Button></div></div>}<div className="flex gap-2"><Textarea aria-label="Task notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes" /><Button variant="outline" onClick={saveNotes}>Save</Button></div></> : t.notes && <p className="text-sm">{t.notes}</p>}
      <ul className="text-[11px] text-muted-foreground">{t.history.slice(-5).reverse().map((h, i) => <li key={i}>{formatDateTime(h.at)} · {h.change}</li>)}</ul>
    </div>}
  </li>;
}

function Checklist({ p, list, title, hint }: { p: Project; list: CheckList; title: string; hint?: string }) {
  const { toggleCheck, addCheck } = useCRM();
  const canEdit = useCanProject("projects.edit");
  const [n, setN] = useState("");
  const items: CheckItem[] = p[list];
  return <Card title={`${title} · ${items.filter((i) => i.done).length}/${items.length}`}>
    {hint && <p className="mb-3 text-xs text-muted-foreground">{hint}</p>}
    <ul className="grid gap-1.5">{items.map((i) => <li key={i.id}><label className="pd-row cursor-pointer"><input type="checkbox" disabled={!canEdit} checked={i.done} onChange={() => toggleCheck(p.id, list, i.id)} /><span className={cn("flex-1 text-sm", i.done && "text-muted-foreground line-through")}>{i.label}</span>{i.doneAt && <span className="text-[11px] text-muted-foreground">{formatDate(i.doneAt)}</span>}</label></li>)}{items.length === 0 && <li className="text-sm text-muted-foreground">No items yet.</li>}</ul>
    {canEdit && <div className="mt-3 flex gap-2"><Input aria-label={`Add to ${title}`} placeholder="Add item" value={n} onChange={(e) => setN(e.target.value)} /><Button variant="outline" onClick={() => { const e = addCheck(p.id, list, n); if (e) toast.error(e); else setN(""); }}>Add</Button></div>}
  </Card>;
}

function RequirementsTab({ p }: { p: Project }) {
  const { addDependency, toggleDependency, addProjectLink } = useCRM();
  const canEdit = useCanProject("projects.edit");
  const [dep, setDep] = useState(""), [lnk, setLnk] = useState({ label: "", url: "" });
  return <div className="grid gap-6 xl:grid-cols-2">
    <Checklist p={p} list="requirements" title="Requirements checklist" hint="Never store passwords or access keys here — note where they are kept instead." />
    <div className="grid content-start gap-6">
      <Card title={`Waiting on client · ${p.dependencies.filter((d) => !d.done).length} open`}>
        <ul className="grid gap-1.5">{p.dependencies.map((d) => <li key={d.id}><label className="pd-row cursor-pointer"><input type="checkbox" disabled={!canEdit} checked={d.done} onChange={() => toggleDependency(p.id, d.id)} /><span className={cn("flex-1 text-sm", d.done && "text-muted-foreground line-through")}>{d.label}</span></label></li>)}{p.dependencies.length === 0 && <li className="text-sm text-muted-foreground">No client dependencies recorded.</li>}</ul>
        {canEdit && <div className="mt-3 flex gap-2"><Input aria-label="Client dependency" placeholder="e.g. Product photos" value={dep} onChange={(e) => setDep(e.target.value)} /><Button variant="outline" onClick={() => { const e = addDependency(p.id, dep); if (e) toast.error(e); else setDep(""); }}>Add</Button></div>}
      </Card>
      <Card title="References & links">
        <ul className="grid gap-1.5">{p.links.map((l) => <li key={l.id}><a href={safeHref(l.url) ?? undefined} target="_blank" rel="noopener noreferrer" className="pd-row text-sm"><ExternalLink className="size-3.5 shrink-0" /><span className="truncate">{l.label}</span></a></li>)}{p.links.length === 0 && <li className="text-sm text-muted-foreground">No links yet.</li>}</ul>
        {canEdit && <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_1.4fr_auto]"><Input aria-label="Link label" placeholder="Label" value={lnk.label} onChange={(e) => setLnk({ ...lnk, label: e.target.value })} /><Input aria-label="Link URL" placeholder="https://" value={lnk.url} onChange={(e) => setLnk({ ...lnk, url: e.target.value })} /><Button variant="outline" onClick={() => { const e = addProjectLink(p.id, lnk.label, lnk.url); if (e) toast.error(e); else setLnk({ label: "", url: "" }); }}>Add</Button></div>}
        <p className="mt-3 text-xs text-muted-foreground">File uploads for projects aren't available yet — add links to shared folders instead. Payment proofs stay in Deals & Payments.</p>
      </Card>
    </div>
  </div>;
}

function FinanceTab({ p }: { p: Project }) {
  const { deals, payments } = useCRM();
  const f = projectFinance(p, deals, payments);
  if (!f.linked) return <div className="receipt"><Empty icon={<FolderKanban />} title="No linked deal" hint="This project isn't linked to a deal, so there are no amounts to show." /></div>;
  return <Card title={`From Deals & Payments · ${f.dealName}`}>
    <dl className="grid grid-cols-2 gap-5 sm:grid-cols-4">
      <div><dt className="eyebrow">Agreed amount</dt><dd className="num mt-1 text-lg">{formatINR(f.agreed)}</dd></div>
      <div><dt className="eyebrow">Received</dt><dd className="num mt-1 text-lg text-success">{formatINR(f.received)}</dd></div>
      <div><dt className="eyebrow">Remaining</dt><dd className="num mt-1 text-lg text-warning">{formatINR(f.remaining)}</dd></div>
      <div><dt className="eyebrow">Advance</dt><dd className="mt-1 text-sm">{f.advanceReceived ? "Received" : "Not received"}</dd></div>
    </dl>
    {f.cancelled && <p className="mt-3 text-sm text-warning">The deal is cancelled — payment history is kept.</p>}
    <div className="eyebrow mb-2 mt-6">Payment history · {f.payments.length}{f.voided ? ` (${f.voided} voided, not counted)` : ""}</div>
    <ul className="grid gap-1.5">{f.payments.map((x) => <li key={x.id} className="pd-row text-sm" data-void={x.voided || undefined}><span className="flex-1">{formatDate(x.date)} · {x.method} · {x.type}{x.voided && " · voided"}</span><span className={cn("num", x.voided && "line-through text-muted-foreground")}>{formatINR(x.amount)}</span></li>)}{f.payments.length === 0 && <li className="text-sm text-muted-foreground">No payments recorded yet.</li>}</ul>
    <p className="mt-4 text-xs text-muted-foreground">Record payments and view proofs in <Link to="/deals" className="underline">Deals & Payments</Link>. Projects never create their own payments.</p>
  </Card>;
}

function ActivityTab({ p }: { p: Project }) {
  const { addProjectNote } = useCRM();
  const people = usePeople();
  const canNote = useCanProject("projects.notes");
  const [n, setN] = useState("");
  return <Card title="Project history">
    {canNote && <div className="mb-4 flex gap-2"><Textarea aria-label="Project note" rows={2} placeholder="Record a decision or update" value={n} onChange={(e) => setN(e.target.value)} /><Button onClick={() => { const e = addProjectNote(p.id, n); if (e) toast.error(e); else setN(""); }}>Add note</Button></div>}
    <ol className="grid gap-2">{[...p.history].reverse().map((h, i) => <li key={i} className="pd-row text-sm"><span className="flex-1">{h.change}</span><span className="shrink-0 text-[11px] text-muted-foreground">{people.name(h.by)} · {formatDateTime(h.at)}</span></li>)}</ol>
  </Card>;
}

function DeliveryTab({ p }: { p: Project }) {
  const { deliverProject, saveSupport, supportRequests, addSupportRequest, updateSupportRequest } = useCRM();
  const people = usePeople();
  const v = useProjectViewer();
  const canEdit = useCanProject("projects.edit"), canSupport = useCanProject("projects.support");
  const today = dayKey(new Date());
  const gaps = deliveryGaps(p);
  const [d, setD] = useState({ date: today, url: "", notes: "", approval: "pending" as "pending" | "approved" | "not_required", override: "" });
  const [s, setS] = useState({ included: p.support.included == null ? "" : p.support.included ? "yes" : "no", months: p.support.months ? String(p.support.months) : "", start: p.support.start ?? "", end: p.support.end ?? "", description: p.support.description ?? "" });
  const [r, setR] = useState({ title: "", kind: "bug" as SupportKind, priority: "normal" as ProjectPriority, assigneeId: "", dueDate: "", description: "" });
  const reqs = supportRequests.filter((x) => x.projectId === p.id);
  const end = s.start && s.months && Number(s.months) > 0 ? addMonths(s.start, Number(s.months)) : s.end;
  return <div className="grid gap-6 xl:grid-cols-2">
    <div className="grid content-start gap-6">
      <Checklist p={p} list="qa" title="Technical QA" hint="Tick only what was actually tested." />
      <Checklist p={p} list="handover" title="Handover" />
    </div>
    <div className="grid content-start gap-6">
      <Card title="Delivery">
        {p.delivery ? <dl className="pd-carry">
          <div><dt>Delivered</dt><dd>{formatDate(p.delivery.date, { day: "numeric", month: "short", year: "numeric" })}</dd></div>
          <div><dt>By</dt><dd>{people.name(p.delivery.deliveredBy)}</dd></div>
          <div><dt>Client approval</dt><dd className="capitalize">{p.delivery.approval.replace("_", " ")}</dd></div>
          <div><dt>Link</dt><dd>{p.delivery.url ? <a href={safeHref(p.delivery.url) ?? undefined} target="_blank" rel="noopener noreferrer" className="underline">{p.delivery.url}</a> : "—"}</dd></div>
          {p.delivery.notes && <div><dt>Handover notes</dt><dd>{p.delivery.notes}</dd></div>}
          {p.delivery.override && <div><dt>Delivered with open items</dt><dd>{p.delivery.incomplete.join(", ")} — {p.delivery.override}</dd></div>}
        </dl> : !canEdit ? <p className="text-sm text-muted-foreground">Not delivered yet.</p> : <div className="grid gap-3">
          <p className="text-xs text-muted-foreground">Delivered does not mean the balance is paid — payments stay in Deals & Payments.</p>
          <div className="grid gap-3 sm:grid-cols-2"><label className="grid gap-1.5 text-sm"><span className="text-muted-foreground">Actual delivery date</span><Input type="date" value={d.date} onChange={(e) => setD({ ...d, date: e.target.value })} /></label><label className="grid gap-1.5 text-sm"><span className="text-muted-foreground">Client approval</span><select className={selectCls} value={d.approval} onChange={(e) => setD({ ...d, approval: e.target.value as typeof d.approval })}><option value="pending">Pending</option><option value="approved">Approved</option><option value="not_required">Not required</option></select></label></div>
          <label className="grid gap-1.5 text-sm"><span className="text-muted-foreground">Website / project URL (if any)</span><Input placeholder="https://" value={d.url} onChange={(e) => setD({ ...d, url: e.target.value })} /></label>
          <label className="grid gap-1.5 text-sm"><span className="text-muted-foreground">Handover notes</span><Textarea rows={2} value={d.notes} onChange={(e) => setD({ ...d, notes: e.target.value })} /></label>
          {gaps.length > 0 && <label className="grid gap-1.5 text-sm"><span className="text-warning">{gaps.length} checklist item(s) not complete. Why deliver anyway?</span><Textarea rows={2} value={d.override} onChange={(e) => setD({ ...d, override: e.target.value })} /></label>}
          <Button className="justify-self-start" onClick={() => { const e = deliverProject(p.id, d); if (e) toast.error(e); else toast.success("Delivery recorded"); }}>Mark delivered</Button>
        </div>}
      </Card>
      <Card title={`Technical support · ${SUPPORT_TEXT[supportStatus(p.support, today)]}`}>
        {!v.owner ? <p className="text-sm text-muted-foreground">{p.support.included ? `${p.support.start}${p.support.end ? ` → ${p.support.end}` : ""}` : "Support terms are set by the Owner."}</p> : <div className="grid gap-3">
          <label className="grid gap-1.5 text-sm"><span className="text-muted-foreground">Support included</span><select className={selectCls} value={s.included} onChange={(e) => setS({ ...s, included: e.target.value })}><option value="">Not decided</option><option value="yes">Yes</option><option value="no">No</option></select></label>
          {s.included === "yes" && <><div className="grid gap-3 sm:grid-cols-3"><label className="grid gap-1.5 text-sm"><span className="text-muted-foreground">Starts</span><Input type="date" value={s.start} onChange={(e) => setS({ ...s, start: e.target.value })} /></label><label className="grid gap-1.5 text-sm"><span className="text-muted-foreground">Months</span><Input inputMode="numeric" value={s.months} onChange={(e) => setS({ ...s, months: e.target.value })} /></label><label className="grid gap-1.5 text-sm"><span className="text-muted-foreground">Ends</span><Input type="date" value={end} disabled={!!s.months} onChange={(e) => setS({ ...s, end: e.target.value })} /></label></div>
            <label className="grid gap-1.5 text-sm"><span className="text-muted-foreground">What's covered</span><Textarea rows={2} value={s.description} onChange={(e) => setS({ ...s, description: e.target.value })} /></label></>}
          <Button variant="outline" className="justify-self-start" onClick={() => { const e = saveSupport(p.id, { included: s.included === "" ? null : s.included === "yes", ...(s.included === "yes" ? { start: s.start || undefined, end: end || undefined, months: s.months ? Number(s.months) : undefined, description: s.description || undefined } : {}) }); if (e) toast.error(e); else toast.success("Support saved"); }}>Save support</Button>
        </div>}
      </Card>
      <Card title={`Support requests · ${reqs.filter((x) => x.status === "open" || x.status === "in_progress").length} open`}>
        {canSupport && <div className="mb-4 grid gap-2">
          <Input aria-label="Request title" placeholder="What's the issue?" value={r.title} onChange={(e) => setR({ ...r, title: e.target.value })} />
          <div className="pd-filters"><select aria-label="Request type" className={selectCls} value={r.kind} onChange={(e) => setR({ ...r, kind: e.target.value as SupportKind })}>{Object.entries(SUPPORT_KIND_TEXT).map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select><select aria-label="Request priority" className={selectCls} value={r.priority} onChange={(e) => setR({ ...r, priority: e.target.value as ProjectPriority })}><option value="high">High</option><option value="normal">Normal</option><option value="low">Low</option></select><select aria-label="Request assignee" className={selectCls} value={r.assigneeId} onChange={(e) => setR({ ...r, assigneeId: e.target.value })}><option value="">Unassigned</option>{people.list.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select><Input aria-label="Request due" type="date" className="w-auto" value={r.dueDate} onChange={(e) => setR({ ...r, dueDate: e.target.value })} /></div>
          <Textarea aria-label="Request description" rows={2} placeholder="Details" value={r.description} onChange={(e) => setR({ ...r, description: e.target.value })} />
          <Button className="justify-self-start" onClick={() => { const x = addSupportRequest({ projectId: p.id, title: r.title, kind: r.kind, priority: r.priority, assigneeId: r.assigneeId || null, dueDate: r.dueDate || undefined, description: r.description || undefined }); if (!x.ok) toast.error(x.error); else { setR({ ...r, title: "", description: "" }); toast.success("Support request opened"); } }}><Plus className="size-4" />Open request</Button>
        </div>}
        <ul className="grid gap-2">{reqs.map((x) => <SupportRow key={x.id} id={x.id} canEdit={canSupport} owner={v.owner} assignee={people.name(x.assigneeId)} people={people.list} onUpdate={updateSupportRequest} />)}{reqs.length === 0 && <li className="text-sm text-muted-foreground">No support requests.</li>}</ul>
      </Card>
    </div>
  </div>;
}

function SupportRow({ id, canEdit, owner, assignee, people, onUpdate }: { id: string; canEdit: boolean; owner: boolean; assignee: string; people: readonly { id: string; name: string }[]; onUpdate: ReturnType<typeof useCRM.getState>["updateSupportRequest"] }) {
  const x = useCRM((s) => s.supportRequests.find((r) => r.id === id))!;
  const [res, setRes] = useState(x.resolution ?? "");
  const done = x.status === "resolved" || x.status === "closed";
  return <li className="pd-task" data-done={done || undefined}>
    <div className="flex flex-wrap items-start justify-between gap-2"><div className="min-w-0"><div className="text-sm font-medium">{x.title}</div><div className="text-xs text-muted-foreground">{SUPPORT_KIND_TEXT[x.kind]} · {x.priority} · {assignee} · opened {formatDate(x.createdAt)}{x.dueDate ? ` · due ${formatDate(x.dueDate)}` : ""} · coverage {x.coverage}</div></div><span className="pd-pill capitalize">{x.status.replace("_", " ")}</span></div>
    {x.description && <p className="mt-2 text-sm">{x.description}</p>}
    {canEdit && !done && <div className="mt-2 grid gap-2"><Textarea aria-label="Resolution notes" rows={2} placeholder="Resolution notes" value={res} onChange={(e) => setRes(e.target.value)} /><div className="flex flex-wrap gap-2">{x.status === "open" && <Button size="sm" variant="outline" className="touch-hit" onClick={() => { const e = onUpdate(id, { status: "in_progress" }); if (e) toast.error(e); else toast.success("Request started"); }}>Start</Button>}<Button size="sm" className="touch-hit" onClick={() => { const e = onUpdate(id, { status: "resolved", resolution: res }); if (e) toast.error(e); else toast.success("Request resolved"); }}>Resolve</Button>{owner && <select aria-label="Coverage" className={cn(selectCls, "h-8 text-xs")} value={x.coverage} onChange={(e) => onUpdate(id, { coverage: e.target.value as typeof x.coverage })}><option value="undecided">Coverage undecided</option><option value="included">Included in agreement</option><option value="billable">Billable</option></select>}{owner && <select aria-label="Reassign request" className={cn(selectCls, "h-8 text-xs")} value={x.assigneeId ?? ""} onChange={(e) => { const er = onUpdate(id, { assigneeId: e.target.value || null }); if (er) toast.error(er); else toast.success("Request reassigned"); }}><option value="">Unassigned</option>{people.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select>}</div></div>}
    {done && x.resolution && <p className="mt-2 text-xs text-muted-foreground">Resolution: {x.resolution}{canEdit && <button type="button" className="ml-2 inline-flex items-center gap-1 underline" onClick={() => { const e = onUpdate(id, { status: "open" }); if (e) toast.error(e); else toast.success("Request reopened"); }}><RotateCcw className="size-3" />Reopen</button>}</p>}
  </li>;
}
