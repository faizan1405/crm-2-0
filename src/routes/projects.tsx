import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { runGuarded } from "@/components/crm/conflictFeedback";
import { AlertTriangle, Briefcase, FolderKanban, LayoutGrid, ListChecks, Plus, Search, Settings2 } from "lucide-react";
import { Shell, Empty, selectCls } from "@/components/crm/Shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useCRM, projectCtxOf } from "@/lib/crm/store";
import { RemindersPanel } from "@/components/automation/RemindersPanel";
import { TagChips, ConditionBuilder } from "@/components/crm/Customize";
import { useProjectFieldViewer } from "@/components/projects/ProjectCustom";
import { runProjectFilter } from "@/lib/crm/projectCustomize";
import { tagForProjects, type ViewFilter } from "@/lib/crm/customize";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SlidersHorizontal, Tag } from "lucide-react";
import { dayKey, formatDate } from "@/lib/crm/format";
import {
  activeProjectForDeal, canSeeProject, isProjectOverdue, projectAttention, projectMetrics, projectProgress, reversalFlag, supportStatus,
  PROJECT_STAGES, PROJECT_STATUSES, STAGE_TEXT, STATUS_TEXT, SUPPORT_TEXT, type Project, type ProjectStage, type ProjectTemplate,
} from "@/lib/crm/projects";
import { CreateProjectDialog, ProgressBar, StagePill, StatusPill, useCanProject, usePeople, useProjectViewer } from "@/components/projects/ProjectParts";
import type { Deal } from "@/lib/crm/types";
import { cn } from "@/lib/utils";

type Tab = "overview" | "all" | "board" | "templates";
const TABS: Tab[] = ["overview", "all", "board", "templates"];

export const Route = createFileRoute("/projects")({
  validateSearch: (s: Record<string, unknown>): { tab?: Tab; tag?: string } => ({ ...(TABS.includes(s["tab"] as Tab) ? { tab: s["tab"] as Tab } : {}), ...(typeof s["tag"] === "string" && s["tag"] ? { tag: s["tag"] } : {}) }),
  head: () => ({ meta: [
    { title: "Project Desk — Scale Flow Sales OS" },
    { name: "description", content: "Track won deals through booking, tasks, delivery, payment collection and technical support." },
    { property: "og:title", content: "Project Desk — Scale Flow Sales OS" },
    { property: "og:description", content: "From won deal to delivered project and support, in one connected workspace." },
    { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" },
  ] }),
  component: ProjectDesk,
});

function useVisibleProjects() {
  const projects = useCRM((s) => s.projects), deals = useCRM((s) => s.deals), leads = useCRM((s) => s.leads);
  const v = useProjectViewer();
  return useMemo(() => projects.filter((p) => canSeeProject(p, v)).map((p) => ({ ...p, reviewFlag: reversalFlag(p, deals, leads) })), [projects, deals, leads, v]);
}

/** Tag + advanced (custom field) filter shared by the list and the board. Runs only on projects already in the viewer's scope. */
function useProjectFilter(rows: Project[]) {
  const st = useCRM(); const viewer = useProjectFieldViewer();
  const { tag = "" } = Route.useSearch();
  const [adv, setAdv] = useState<ViewFilter>({ mode: "and", conditions: [] });
  const tags = st.tagDefs.filter(tagForProjects);
  const ctx = projectCtxOf(st, viewer);
  const byTag = tag ? rows.filter((p) => (st.projectTags[p.id] ?? []).includes(tag)) : rows;
  const out = adv.conditions.length ? runProjectFilter(adv, byTag, ctx) : byTag;
  return { out, tag, tags, adv, setAdv };
}
function TagFilter({ tag, tags, tab }: { tag: string; tags: { id: string; name: string; status: string }[]; tab: Tab }) {
  const nav = Route.useNavigate();
  if (!tags.length) return null;
  return <select aria-label="Tag" className={selectCls} value={tag} onChange={(e) => void nav({ search: { tab, ...(e.target.value ? { tag: e.target.value } : {}) } })}><option value="">Any tag</option>{tags.map((t) => <option key={t.id} value={t.id}>{t.name}{t.status === "archived" ? " (archived)" : ""}</option>)}</select>;
}
function MoreFilters({ adv, setAdv }: { adv: ViewFilter; setAdv: (f: ViewFilter) => void }) {
  const [open, setOpen] = useState(false);
  return <>
    <Button variant="outline" size="sm" className="h-10 rounded-full" onClick={() => setOpen(!open)} aria-expanded={open}><SlidersHorizontal className="size-4" />More filters{adv.conditions.length ? ` · ${adv.conditions.length}` : ""}</Button>
    {open && <div className="w-full rounded-xl border bg-card p-3"><ConditionBuilder entity="project" filter={adv} onChange={setAdv} />{adv.conditions.length > 0 && <Button size="sm" variant="ghost" className="mt-2" onClick={() => setAdv({ mode: "and", conditions: [] })}>Clear filters</Button>}</div>}
  </>;
}

function ProjectDesk() {
  const { tab = "overview" } = Route.useSearch();
  const v = useProjectViewer();
  const [deal, setDeal] = useState<Deal | null>(null);
  const label: Record<Tab, string> = { overview: "Overview", all: v.owner ? "All projects" : "My projects", board: "Project board", templates: "Templates" };
  const icon: Record<Tab, typeof LayoutGrid> = { overview: LayoutGrid, all: ListChecks, board: FolderKanban, templates: Settings2 };
  return (
    <Shell title="Project Desk" subtitle="Won deal → booking → delivery → support. Money always comes from Deals & Payments.">
      <nav className="mb-6 max-w-full overflow-x-auto" aria-label="Project Desk sections"><div className="seg w-max">{TABS.filter((t) => t !== "templates" || v.owner).map((t) => { const I = icon[t]; return <Link key={t} to="/projects" search={{ tab: t }} role="tab" aria-pressed={tab === t} className="seg-link" data-active={tab === t}><I className="size-3.5" />{label[t]}</Link>; })}</div></nav>
      {tab === "overview" && <Overview onCreate={setDeal} />}
      {tab === "all" && <AllProjects />}
      {tab === "board" && <Board />}
      {tab === "templates" && v.owner && <Templates />}
      <CreateProjectDialog deal={deal} open={!!deal} onOpenChange={(o) => !o && setDeal(null)} />
    </Shell>
  );
}

function Overview({ onCreate }: { onCreate: (d: Deal) => void }) {
  const projects = useVisibleProjects();
  const { projectTasks, projectMilestones, supportRequests, deals, leads } = useCRM();
  const canCreate = useCanProject("projects.create");
  const today = dayKey(new Date());
  const m = projectMetrics(projects, projectTasks, projectMilestones, supportRequests, today);
  const attention = projectAttention(projects, projectTasks, supportRequests, today);
  const handoff = deals.filter((d) => d.status !== "cancelled" && !activeProjectForDeal(projects, d.id) && (!d.leadId || leads.find((l) => l.id === d.leadId)?.status === "won"));
  const kpis: [string, number, string?][] = [["Active projects", m.active], ["Awaiting client", m.awaiting, "Accepted, booked or waiting to start"], ["In progress", m.inProgress], ["Overdue", m.overdue, "Past target delivery"], ["Delivered", m.delivered], ["Open tasks", m.openTasks], ["Milestones in 14 days", m.upcomingMilestones], ["Open support requests", m.openRequests]];
  const name = (id: string) => projects.find((p) => p.id === id)?.name ?? "Project";
  return <div className="grid gap-6">
    <RemindersPanel only="project" />
    <section className="pd-kpis" aria-label="Project metrics">{kpis.map(([k, n, h]) => <div key={k} className="pipe-kpi" data-tone={k === "Overdue" && n ? "warn" : undefined}><span className="eyebrow">{k}</span><span className="num pipe-kpi-v">{n}</span>{h && <span className="pipe-kpi-h">{h}</span>}</div>)}</section>
    <div className="grid gap-6 xl:grid-cols-2">
      <section className="receipt p-5 sm:p-6" aria-label="Needs attention">
        <div className="eyebrow mb-3">Needs attention · {attention.length}</div>
        {attention.length === 0 ? <p className="text-sm text-muted-foreground">Nothing needs attention right now.</p> : <ul className="grid gap-2">{attention.map((a) => <li key={a.id}><Link to="/projects/$id" params={{ id: a.projectId }} className="pd-row"><AlertTriangle className={cn("size-4 shrink-0", a.kind === "ready" ? "text-success" : "text-warning")} /><span className="min-w-0 flex-1"><b className="block truncate text-sm font-medium">{name(a.projectId)}</b><span className="text-xs text-muted-foreground">{a.text}</span></span></Link></li>)}</ul>}
      </section>
      {canCreate && <section className="receipt p-5 sm:p-6" aria-label="Deals ready for handoff">
        <div className="eyebrow mb-1">Won deals without a project · {handoff.length}</div>
        <p className="mb-3 text-xs text-muted-foreground">Projects are only created when you confirm the handoff.</p>
        {handoff.length === 0 ? <p className="text-sm text-muted-foreground">Every won deal already has a project.</p> : <ul className="grid gap-2">{handoff.slice(0, 8).map((d) => <li key={d.id} className="pd-row"><Briefcase className="size-4 shrink-0 text-muted-foreground" /><span className="min-w-0 flex-1"><b className="block truncate text-sm font-medium">{d.name}</b><span className="text-xs text-muted-foreground">{d.clientName}</span></span><Button size="sm" variant="outline" className="rounded-full" onClick={() => onCreate(d)}><Plus className="size-3.5" />Create project</Button></li>)}</ul>}
      </section>}
    </div>
  </div>;
}

function AllProjects() {
  const projects = useVisibleProjects();
  const { projectTasks, projectTemplates } = useCRM();
  const people = usePeople();
  const today = dayKey(new Date());
  const [q, setQ] = useState(""), [stage, setStage] = useState(""), [status, setStatus] = useState(""), [who, setWho] = useState(""), [prio, setPrio] = useState(""), [type, setType] = useState(""), [sup, setSup] = useState(""), [arch, setArch] = useState(false), [sort, setSort] = useState("due");
  const types = [...new Set([...projectTemplates.map((t) => t.type), ...projects.map((p) => p.type)])];
  const f = useProjectFilter(projects);
  const crm = useCRM(); const vw = useProjectViewer();
  const [picked, setPicked] = useState<string[]>([]); const [tagOp, setTagOp] = useState<{ tagId: string; mode: "add" | "remove" } | null>(null);
  const rows = f.out.filter((p) => (arch ? p.archived : !p.archived) && (!q || `${p.name} ${p.clientName} ${p.company ?? ""}`.toLowerCase().includes(q.toLowerCase())) && (!stage || p.stage === stage) && (!status || p.status === status) && (!who || p.ownerId === who || p.memberIds.includes(who)) && (!prio || p.priority === prio) && (!type || p.type === type) && (!sup || supportStatus(p.support, today) === sup))
    .sort((a, b) => sort === "created" ? b.createdAt.localeCompare(a.createdAt) : sort === "start" ? (a.plannedStart ?? "9").localeCompare(b.plannedStart ?? "9") : (a.targetDelivery ?? "9").localeCompare(b.targetDelivery ?? "9"));
  return <div className="grid gap-4">
    <div className="pd-filters">
      <label className="relative min-w-[200px] flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input aria-label="Search projects" placeholder="Search project or client" value={q} onChange={(e) => setQ(e.target.value)} className="pl-9" /></label>
      <select aria-label="Stage" className={selectCls} value={stage} onChange={(e) => setStage(e.target.value)}><option value="">All stages</option>{PROJECT_STAGES.map((s) => <option key={s} value={s}>{STAGE_TEXT[s]}</option>)}</select>
      <select aria-label="Status" className={selectCls} value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All statuses</option>{PROJECT_STATUSES.map((s) => <option key={s} value={s}>{STATUS_TEXT[s]}</option>)}</select>
      <select aria-label="Type" className={selectCls} value={type} onChange={(e) => setType(e.target.value)}><option value="">All types</option>{types.map((t) => <option key={t}>{t}</option>)}</select>
      <select aria-label="Assigned" className={selectCls} value={who} onChange={(e) => setWho(e.target.value)}><option value="">Anyone</option>{people.list.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
      <select aria-label="Priority" className={selectCls} value={prio} onChange={(e) => setPrio(e.target.value)}><option value="">Any priority</option><option value="high">High</option><option value="normal">Normal</option><option value="low">Low</option></select>
      <select aria-label="Support" className={selectCls} value={sup} onChange={(e) => setSup(e.target.value)}><option value="">Any support</option>{Object.entries(SUPPORT_TEXT).map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select>
      <select aria-label="Sort" className={selectCls} value={sort} onChange={(e) => setSort(e.target.value)}><option value="due">Due date</option><option value="start">Start date</option><option value="created">Newest</option></select>
      <TagFilter tag={f.tag} tags={f.tags} tab="all" />
      <label className="flex items-center gap-2 text-sm text-muted-foreground"><input type="checkbox" checked={arch} onChange={(e) => setArch(e.target.checked)} />Archived</label>
      <MoreFilters adv={f.adv} setAdv={f.setAdv} />
    </div>
    {vw.owner && rows.length > 0 && <div className="flex flex-wrap items-center gap-2 text-sm">
      <label className="flex items-center gap-2"><Checkbox aria-label="Select all shown projects" checked={rows.every((p) => picked.includes(p.id))} onCheckedChange={(v) => setPicked(v ? rows.map((p) => p.id) : [])} />{picked.length ? `${picked.length} selected` : "Select"}</label>
      {picked.length > 0 && f.tags.some((t) => t.status === "active") && <select aria-label="Bulk add project tag" className={cn(selectCls, "h-8 text-xs")} value="" onChange={(e) => e.target.value && setTagOp({ tagId: e.target.value, mode: "add" })}><option value="">Add tag…</option>{f.tags.filter((t) => t.status === "active").map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>}
      {picked.length > 0 && f.tags.length > 0 && <select aria-label="Bulk remove project tag" className={cn(selectCls, "h-8 text-xs")} value="" onChange={(e) => e.target.value && setTagOp({ tagId: e.target.value, mode: "remove" })}><option value="">Remove tag…</option>{f.tags.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>}
    </div>}
    <Dialog open={!!tagOp} onOpenChange={(o) => !o && setTagOp(null)}><DialogContent className="sm:max-w-md">{tagOp && (() => { const t = crm.tagDefs.find((x) => x.id === tagOp.tagId); const has = picked.filter((id) => (crm.projectTags[id] ?? []).includes(tagOp.tagId)).length; const affected = tagOp.mode === "add" ? picked.length - has : has; return <>
      <DialogHeader><DialogTitle><Tag className="mr-1.5 inline size-4" />{tagOp.mode === "add" ? "Add" : "Remove"} “{t?.name}”</DialogTitle><DialogDescription>{picked.length} project(s) selected. Leads and other tags are untouched.</DialogDescription></DialogHeader>
      <p className="text-sm"><b className="num">{affected}</b> project(s) will change.</p>
      <DialogFooter><Button variant="ghost" onClick={() => setTagOp(null)}>Cancel</Button><Button disabled={!affected} onClick={() => { const r = crm.bulkTagProjects(picked, tagOp.tagId, tagOp.mode); setTagOp(null); if (!r.changed) return; toast.success(`${tagOp.mode === "add" ? "Added" : "Removed"} “${t?.name}” · ${r.changed} project(s)`, { action: { label: "Undo", onClick: () => { const u = useCRM.getState().undoBulkProjectTags(r.before, r.applied); toast(u.kept ? `Undone on ${u.restored} · ${u.kept} kept (changed since)` : `Undone on ${u.restored} project(s)`); } } }); }}>{tagOp.mode === "add" ? "Add tag" : "Remove tag"} to {affected}</Button></DialogFooter>
    </>; })()}</DialogContent></Dialog>
    {rows.length === 0 ? <div className="receipt"><Empty icon={<FolderKanban />} title={projects.length ? "No projects match" : "No projects yet"} hint={projects.length ? "Try clearing a filter." : "Create a project from a won deal on the Overview or in Deals & Payments."} /></div> :
      <ul className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">{rows.map((p) => <li key={p.id} className="relative">{vw.owner && <span className="absolute top-3 right-3 z-10"><Checkbox aria-label={`Select ${p.name}`} checked={picked.includes(p.id)} onCheckedChange={(v) => setPicked(v ? [...picked, p.id] : picked.filter((x) => x !== p.id))} /></span>}<ProjectCard p={p} tasks={projectTasks.filter((t) => t.projectId === p.id)} owner={people.name(p.ownerId)} today={today} /></li>)}</ul>}
  </div>;
}

function ProjectCard({ p, tasks, owner, today, draggable, onDragStart }: { p: Project; tasks: { status: string }[]; owner: string; today: string; draggable?: boolean; onDragStart?: (e: React.DragEvent) => void }) {
  const prog = projectProgress(tasks as never);
  const late = isProjectOverdue(p, today);
  return <Link to="/projects/$id" params={{ id: p.id }} className="pd-card" draggable={draggable} onDragStart={onDragStart} data-overdue={late || undefined}>
    <div className="flex items-start justify-between gap-2"><div className="min-w-0"><div className="truncate font-medium">{p.name}</div><div className="truncate text-xs text-muted-foreground">{p.clientName} · {p.type}</div></div><span className="pd-prio mr-6" data-p={p.priority}>{p.priority}</span></div>
    <div className="mt-3 flex flex-wrap gap-1.5"><StatusPill status={p.status} /><StagePill stage={p.stage} /></div>
    <CardTags id={p.id} />
    <div className="mt-3"><ProgressBar pct={prog.pct} label={prog.text} /></div>
    <div className="mt-3 flex items-center justify-between text-[11px] text-muted-foreground"><span className="truncate">{owner}</span><span className={cn(late && "font-medium text-destructive")}>{p.targetDelivery ? `${late ? "Overdue · " : "Due "}${formatDate(p.targetDelivery)}` : "No target date"}</span></div>
    {p.reviewFlag && <div className="mt-2 text-[11px] font-medium text-warning">{p.reviewFlag}</div>}
  </Link>;
}

function CardTags({ id }: { id: string }) { const ids = useCRM((s) => s.projectTags[id]); return ids?.length ? <div className="mt-2"><TagChips ids={ids} max={3} /></div> : null; }

function Board() {
  const projects = useVisibleProjects().filter((p) => !p.archived);
  const { projectTasks, moveProjectStage, undoProjectStage } = useCRM();
  const people = usePeople();
  const canMove = useCanProject("projects.stage");
  const today = dayKey(new Date());
  const [q, setQ] = useState(""), [who, setWho] = useState(""), [over, setOver] = useState<string | null>(null);
  const f = useProjectFilter(projects);
  const rows = f.out.filter((p) => (!q || `${p.name} ${p.clientName}`.toLowerCase().includes(q.toLowerCase())) && (!who || p.ownerId === who || p.memberIds.includes(who)));
  const move = (id: string, stage: ProjectStage, from?: ProjectStage) => {
    if (stage === "delivered") { toast.error("Record delivery from the project's Delivery tab — it checks the delivery checklist first."); return; }
    const g = runGuarded(() => moveProjectStage(id, stage, from));
    const r = g?.value; if (!r) return;
    toast.success(`Moved to ${STAGE_TEXT[stage]}`, { action: { label: "Undo", onClick: () => { if (!undoProjectStage(id, r.from, r.version)) toast.error("Not undone — the project changed since."); } } });
  };
  return <div className="grid gap-3">
    <div className="pd-filters"><label className="relative min-w-[200px] flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input aria-label="Search board" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} className="pl-9" /></label><select aria-label="Assigned" className={selectCls} value={who} onChange={(e) => setWho(e.target.value)}><option value="">Anyone</option>{people.list.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select><TagFilter tag={f.tag} tags={f.tags} tab="board" /><MoreFilters adv={f.adv} setAdv={f.setAdv} /></div>
    <div className="pd-board scrollbar-thin" role="list" aria-label="Project board">
      {PROJECT_STAGES.map((s) => { const col = rows.filter((p) => p.stage === s); return <section key={s} role="listitem" aria-label={`${STAGE_TEXT[s]}: ${col.length}`} className="pd-col" data-over={over === s || undefined}
        onDragOver={(e) => { if (canMove) { e.preventDefault(); setOver(s); } }} onDragLeave={() => setOver(null)} onDrop={(e) => { e.preventDefault(); setOver(null); const id = e.dataTransfer.getData("text/project"); const from = (e.dataTransfer.getData("text/project-stage") || undefined) as ProjectStage | undefined; if (id) move(id, s, from); }}>
        <header className="pd-col-head"><span>{STAGE_TEXT[s]}</span><b className="num">{col.length}</b></header>
        <div className="grid gap-2">{col.map((p) => <div key={p.id}>
          <ProjectCard p={p} tasks={projectTasks.filter((t) => t.projectId === p.id)} owner={people.name(p.ownerId)} today={today} draggable={canMove} onDragStart={(e) => { e.dataTransfer.setData("text/project", p.id); e.dataTransfer.setData("text/project-stage", p.stage); }} />
          {canMove && <select aria-label={`Stage for ${p.name}`} className={cn(selectCls, "mt-1 h-8 w-full text-xs")} value={p.stage} onChange={(e) => move(p.id, e.target.value as ProjectStage, p.stage)}>{PROJECT_STAGES.map((x) => <option key={x} value={x} disabled={x === "delivered" && !p.delivery}>{STAGE_TEXT[x]}</option>)}</select>}
        </div>)}{col.length === 0 && <p className="px-1 py-4 text-center text-xs text-muted-foreground">Empty</p>}</div>
      </section>; })}
    </div>
  </div>;
}

function Templates() {
  const { projectTemplates, saveProjectTemplate } = useCRM();
  const [edit, setEdit] = useState<ProjectTemplate | null>(null);
  const lines = (a: string[]) => a.join("\n"), split = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);
  const blank: ProjectTemplate = { id: "", name: "", type: "", milestones: [], tasks: [], requirements: [], qa: [], handover: [], archived: false, updatedAt: "" };
  return <div className="grid gap-4">
    <div className="flex justify-between gap-3"><p className="text-sm text-muted-foreground">Templates only suggest a starting point. No prices, timelines, hosting or support periods are set by a template.</p><Button className="rounded-full" onClick={() => setEdit(blank)}><Plus className="size-4" />New template</Button></div>
    {edit && <TemplateEditor t={edit} onCancel={() => setEdit(null)} onSave={(t) => { const e = saveProjectTemplate(t); if (e) toast.error(e); else { toast.success("Template saved"); setEdit(null); } }} lines={lines} split={split} />}
    <ul className="grid gap-3 md:grid-cols-2">{projectTemplates.map((t) => <li key={t.id} className="receipt p-5" data-archived={t.archived || undefined}>
      <div className="flex items-start justify-between gap-2"><div><div className="font-medium">{t.name}{t.archived && <span className="ml-2 text-xs text-muted-foreground">(archived)</span>}</div><div className="text-xs text-muted-foreground">{t.milestones.length} milestones · {t.tasks.length} tasks · {t.requirements.length} requirements · {t.qa.length + t.handover.length} delivery checks</div></div>
      <div className="flex gap-1"><Button size="sm" variant="ghost" onClick={() => setEdit(t)}>Edit</Button><Button size="sm" variant="ghost" onClick={() => saveProjectTemplate({ ...t, archived: !t.archived })}>{t.archived ? "Restore" : "Archive"}</Button></div></div>
    </li>)}</ul>
  </div>;
}

function TemplateEditor({ t, onCancel, onSave, lines, split }: { t: ProjectTemplate; onCancel: () => void; onSave: (t: ProjectTemplate) => void; lines: (a: string[]) => string; split: (s: string) => string[] }) {
  const [f, setF] = useState({ name: t.name, milestones: lines(t.milestones), tasks: t.tasks.map((x) => (x.milestone ? `${x.milestone}: ${x.title}` : x.title)).join("\n"), requirements: lines(t.requirements), qa: lines(t.qa), handover: lines(t.handover) });
  const field = (k: keyof typeof f, label: string, hint?: string) => <label className="grid gap-1.5 text-sm"><span className="font-medium">{label}</span>{hint && <span className="text-xs text-muted-foreground">{hint}</span>}<Textarea rows={4} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></label>;
  return <section className="receipt grid gap-4 p-5 sm:p-6" aria-label="Edit template">
    <label className="grid gap-1.5 text-sm"><span className="font-medium">Template name</span><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
    <div className="grid gap-4 md:grid-cols-2">{field("milestones", "Milestones", "One per line")}{field("tasks", "Tasks", "One per line. Prefix with “Milestone: ” to group.")}{field("requirements", "Client requirements")}{field("qa", "Technical QA checklist")}{field("handover", "Handover checklist")}</div>
    <div className="flex justify-end gap-2"><Button variant="ghost" onClick={onCancel}>Cancel</Button><Button onClick={() => { const ms = split(f.milestones); onSave({ ...t, name: f.name, type: t.type || f.name, milestones: ms, tasks: split(f.tasks).map((x) => { const i = x.indexOf(": "); const m = i > 0 ? x.slice(0, i) : ""; return m && ms.includes(m) ? { title: x.slice(i + 2), milestone: m } : { title: x }; }), requirements: split(f.requirements), qa: split(f.qa), handover: split(f.handover) }); }}>Save template</Button></div>
  </section>;
}

