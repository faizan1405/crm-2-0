import { pilotLinkSearch } from "@/lib/api/pilotHook";
import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import {
  AlertTriangle,
  Briefcase,
  Database,
  FolderKanban,
  LayoutGrid,
  ListChecks,
  Plus,
  Search,
  Settings2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Empty, selectCls } from "@/components/crm/Shell";
import { formatDate } from "@/lib/crm/format";
import {
  PROJECT_STAGES,
  PROJECT_STATUSES,
  STAGE_TEXT,
  STATUS_TEXT,
  type ProjectStage,
  type ProjectStatus,
} from "@/lib/crm/projects";
import { ProgressBar, StagePill, StatusPill } from "@/components/projects/ProjectParts";
import { useDealsQuery } from "@/lib/api/financeApi";
import {
  useMoveProjectStageMutation,
  useProjectOverviewQuery,
  useProjectsQuery,
  useProjectTemplatesQuery,
  useSaveProjectTemplateMutation,
  useUndoProjectStageMutation,
} from "@/lib/api/projectsApi";
import type { DealDto, ProjectDto, ProjectPriorityApi, ProjectStageApi, ProjectStatusApi } from "@/lib/api/schemas";
import { cn } from "@/lib/utils";
import { PilotNewProjectDialog } from "./PilotNewProjectDialog";
import { PilotShell } from "./PilotShell";

type Tab = "overview" | "all" | "board" | "templates";
const TABS: Tab[] = ["overview", "all", "board", "templates"];

export function PilotProjectsPage({ search }: { search: Record<string, unknown> }) {
  const tabParam = (search["tab"] as Tab) || "overview";
  const [tab, setTab] = useState<Tab>(TABS.includes(tabParam) ? tabParam : "overview");

  const [showNewProject, setShowNewProject] = useState(false);
  const [handoffDeal, setHandoffDeal] = useState<DealDto | null>(null);

  return (
    <PilotShell
      title="Project Desk (Pilot)"
      subtitle="MariaDB Backed Delivery Management · Connected to Won Deals & Client Ledger"
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5 rounded-full border border-teal/30 bg-teal-soft px-3 py-1 text-xs font-semibold text-teal">
            <Database className="size-3.5" />
            MariaDB Dev Mode
          </div>
          <Button
            type="button"
            onClick={() => {
              setHandoffDeal(null);
              setShowNewProject(true);
            }}
            className="rounded-full gap-1.5"
          >
            <Plus className="size-4" />
            New project
          </Button>
        </div>
      }
    >
      <nav className="mb-6 max-w-full overflow-x-auto" aria-label="Project Desk sections">
        <div className="seg w-max">
          <button
            type="button"
            onClick={() => setTab("overview")}
            aria-current={tab === "overview" ? "page" : undefined}
            className="seg-link"
            data-active={tab === "overview"}
          >
            <LayoutGrid className="size-3.5" />
            Overview
          </button>
          <button
            type="button"
            onClick={() => setTab("all")}
            aria-current={tab === "all" ? "page" : undefined}
            className="seg-link"
            data-active={tab === "all"}
          >
            <ListChecks className="size-3.5" />
            All projects
          </button>
          <button
            type="button"
            onClick={() => setTab("board")}
            aria-current={tab === "board" ? "page" : undefined}
            className="seg-link"
            data-active={tab === "board"}
          >
            <FolderKanban className="size-3.5" />
            Project board
          </button>
          <button
            type="button"
            onClick={() => setTab("templates")}
            aria-current={tab === "templates" ? "page" : undefined}
            className="seg-link"
            data-active={tab === "templates"}
          >
            <Settings2 className="size-3.5" />
            Templates
          </button>
        </div>
      </nav>

      {tab === "overview" && (
        <PilotProjectsOverview
          onHandoff={(d) => {
            setHandoffDeal(d);
            setShowNewProject(true);
          }}
        />
      )}
      {tab === "all" && <PilotProjectsAll />}
      {tab === "board" && <PilotProjectsBoard />}
      {tab === "templates" && <PilotProjectsTemplates />}

      <PilotNewProjectDialog
        open={showNewProject}
        onOpenChange={(o) => {
          setShowNewProject(o);
          if (!o) setHandoffDeal(null);
        }}
        deal={handoffDeal}
      />
    </PilotShell>
  );
}

function PilotProjectsOverview({ onHandoff }: { onHandoff: (d: DealDto) => void }) {
  const { data: overviewData, isLoading: overviewLoading } = useProjectOverviewQuery();
  const { data: projectsData } = useProjectsQuery({ limit: 100 });
  const { data: dealsData } = useDealsQuery({ limit: 100 });

  const metrics = overviewData?.metrics ?? {
    active: 0,
    awaiting: 0,
    inProgress: 0,
    overdue: 0,
    delivered: 0,
    openTasks: 0,
    upcomingMilestones: 0,
    openRequests: 0,
  };
  const attention = overviewData?.attention ?? [];
  const projects = projectsData?.items ?? [];
  const deals = dealsData?.items ?? [];

  // Active project deals set
  const activeDealIds = new Set(
    projects.filter((p) => !p.archived && p.dealId).map((p) => p.dealId),
  );
  // Deals ready for handoff: won deals without active project
  const handoffDeals = deals.filter(
    (d) => d.status !== "cancelled" && !activeDealIds.has(d.id),
  );

  const kpis: [string, number, string?][] = [
    ["Active projects", metrics.active],
    ["Awaiting client", metrics.awaiting, "Accepted, booked or waiting to start"],
    ["In progress", metrics.inProgress],
    ["Overdue", metrics.overdue, "Past target delivery"],
    ["Delivered", metrics.delivered],
    ["Open tasks", metrics.openTasks],
    ["Milestones in 14 days", metrics.upcomingMilestones],
    ["Open support requests", metrics.openRequests],
  ];

  const projectName = (id: string) => projects.find((p) => p.id === id)?.name ?? "Project";

  return (
    <div className="grid gap-6">
      <section className="pd-kpis" aria-label="Project metrics">
        {kpis.map(([k, n, h]) => (
          <div key={k} className="pipe-kpi" data-tone={k === "Overdue" && n ? "warn" : undefined}>
            <span className="eyebrow">{k}</span>
            <span className="num pipe-kpi-v">{overviewLoading ? "..." : n}</span>
            {h && <span className="pipe-kpi-h">{h}</span>}
          </div>
        ))}
      </section>

      <div className="grid gap-6 xl:grid-cols-2">
        <section className="receipt p-5 sm:p-6" aria-label="Needs attention">
          <div className="eyebrow mb-3">Needs attention · {attention.length}</div>
          {attention.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing needs attention right now.</p>
          ) : (
            <ul className="grid gap-2">
              {attention.map((a) => (
                <li key={a.id}>
                  <Link
                    to="/projects/$id"
                    params={{ id: a.projectId }}
                    search={pilotLinkSearch()}
                    className="pd-row"
                  >
                    <AlertTriangle
                      className={cn(
                        "size-4 shrink-0",
                        a.kind === "ready" ? "text-success" : "text-warning",
                      )}
                    />
                    <span className="min-w-0 flex-1">
                      <b className="block truncate text-sm font-medium">
                        {projectName(a.projectId)}
                      </b>
                      <span className="text-xs text-muted-foreground">{a.text}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="receipt p-5 sm:p-6" aria-label="Deals ready for handoff">
          <div className="eyebrow mb-1">Won deals without a project · {handoffDeals.length}</div>
          <p className="mb-3 text-xs text-muted-foreground">
            Projects are only created when you confirm the handoff.
          </p>
          {handoffDeals.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Every won deal already has a project.
            </p>
          ) : (
            <ul className="grid gap-2">
              {handoffDeals.slice(0, 8).map((d) => (
                <li key={d.id} className="pd-row">
                  <Briefcase className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    <b className="block truncate text-sm font-medium">{d.name}</b>
                    <span className="text-xs text-muted-foreground">{d.clientName} · ₹{d.finalAmount}</span>
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    className="rounded-full"
                    onClick={() => onHandoff(d)}
                  >
                    <Plus className="size-3.5" />
                    Create project
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function PilotProjectsAll() {
  const [q, setQ] = useState("");
  const [stage, setStage] = useState<string>("");
  const [status, setStatus] = useState<string>("");
  const [priority, setPriority] = useState<string>("");
  const [archived, setArchived] = useState(false);
  const [sort, setSort] = useState<"due" | "start" | "recent" | "name">("due");

  const { data: projectsData, isLoading } = useProjectsQuery({
    q: q.trim() || undefined,
    stage: stage && stage !== "all" ? (stage as ProjectStageApi) : undefined,
    status: status && status !== "all" ? (status as ProjectStatusApi) : undefined,
    priority: priority && priority !== "all" ? (priority as ProjectPriorityApi) : undefined,
    archived,
    sort,
    limit: 100,
  });

  const projects = projectsData?.items ?? [];

  return (
    <div className="grid gap-4">
      <div className="pd-filters">
        <label className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label="Search projects"
            placeholder="Search project or client"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="pl-9"
          />
        </label>
        <select
          aria-label="Stage"
          className={selectCls}
          value={stage}
          onChange={(e) => setStage(e.target.value)}
        >
          <option value="">All stages</option>
          {PROJECT_STAGES.map((s) => (
            <option key={s} value={s}>
              {STAGE_TEXT[s]}
            </option>
          ))}
        </select>
        <select
          aria-label="Status"
          className={selectCls}
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="">All statuses</option>
          {PROJECT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_TEXT[s]}
            </option>
          ))}
        </select>
        <select
          aria-label="Priority"
          className={selectCls}
          value={priority}
          onChange={(e) => setPriority(e.target.value)}
        >
          <option value="">Any priority</option>
          <option value="high">High</option>
          <option value="normal">Normal</option>
          <option value="low">Low</option>
        </select>
        <select
          aria-label="Sort"
          className={selectCls}
          value={sort}
          onChange={(e) => setSort(e.target.value as typeof sort)}
        >
          <option value="due">Due date</option>
          <option value="start">Start date</option>
          <option value="recent">Newest</option>
          <option value="name">Name</option>
        </select>
        <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
          <input
            type="checkbox"
            checked={archived}
            onChange={(e) => setArchived(e.target.checked)}
          />
          Archived
        </label>
      </div>

      {isLoading ? (
        <div className="py-8 text-center text-sm text-muted-foreground">Loading projects...</div>
      ) : projects.length === 0 ? (
        <div className="receipt">
          <Empty
            icon={<FolderKanban />}
            title="No projects found"
            hint="Create a project from a won deal or create one standalone."
          />
        </div>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
          {projects.map((p) => (
            <li key={p.id}>
              <PilotProjectCard p={p} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function PilotProjectCard({ p }: { p: ProjectDto }) {
  const isOverdue =
    !p.archived &&
    p.status !== "completed" &&
    p.status !== "cancelled" &&
    p.stage !== "delivered" &&
    p.stage !== "support" &&
    p.targetDelivery &&
    p.targetDelivery < new Date().toISOString().slice(0, 10);

  return (
    <Link
      to="/projects/$id"
      params={{ id: p.id }}
      search={pilotLinkSearch()}
      className="pd-card block hover:no-underline"
      data-overdue={isOverdue || undefined}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate font-medium">{p.name}</div>
          <div className="truncate text-xs text-muted-foreground">
            {p.clientName}
            {p.company ? ` (${p.company})` : ""} · {p.type}
          </div>
        </div>
        <span className="pd-prio" data-p={p.priority}>
          {p.priority}
        </span>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        <StatusPill status={p.status as ProjectStatus} />
        <StagePill stage={p.stage as ProjectStage} />
      </div>

      <div className="mt-3">
        <ProgressBar pct={p.progress.pct} label={p.progress.text} />
      </div>

      <div className="mt-3 flex items-center justify-between text-[11px] text-muted-foreground">
        <span className="truncate">{p.company ?? p.clientName}</span>
        <span className={cn(isOverdue && "font-medium text-destructive")}>
          {p.targetDelivery
            ? `${isOverdue ? "Overdue · " : "Due "}${formatDate(p.targetDelivery)}`
            : "No target date"}
        </span>
      </div>

      {p.reviewFlag && (
        <div className="mt-2 text-[11px] font-medium text-warning">{p.reviewFlag}</div>
      )}
    </Link>
  );
}

function PilotProjectsBoard() {
  const [q, setQ] = useState("");
  const { data: projectsData, isLoading } = useProjectsQuery({ archived: false, limit: 100 });
  const moveStageMutation = useMoveProjectStageMutation();
  const undoStageMutation = useUndoProjectStageMutation();

  const allProjects = projectsData?.items ?? [];
  const projects = allProjects.filter(
    (p) =>
      !q.trim() ||
      p.name.toLowerCase().includes(q.toLowerCase()) ||
      p.clientName.toLowerCase().includes(q.toLowerCase()),
  );

  const handleStageChange = async (projectId: string, newStage: ProjectStageApi, currentStage: ProjectStageApi, version: number) => {
    if (newStage === "delivered") {
      toast.error(
        "Record delivery from the project's Delivery tab — it verifies the technical QA and handover checklist first.",
      );
      return;
    }

    try {
      const res = await moveStageMutation.mutateAsync({
        id: projectId,
        payload: { stage: newStage, from: currentStage, expectedVersion: version },
      });

      toast.success(`Moved to ${STAGE_TEXT[newStage]}`, {
        action: {
          label: "Undo",
          onClick: async () => {
            try {
              await undoStageMutation.mutateAsync({
                id: projectId,
                payload: { toStage: res.previousStage, expectedVersion: res.project.version },
              });
              toast.success(`Restored to ${STAGE_TEXT[res.previousStage]}`);
            } catch (err: unknown) {
              const msg = err instanceof Error ? err.message : "Failed to undo stage change.";
              toast.error(msg);
            }
          },
        },
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to change stage.";
      toast.error(msg);
    }
  };

  return (
    <div className="grid gap-3">
      <div className="pd-filters">
        <label className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label="Search board"
            placeholder="Search board"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="pl-9"
          />
        </label>
      </div>

      {isLoading ? (
        <div className="py-8 text-center text-sm text-muted-foreground">Loading board...</div>
      ) : (
        <div className="pd-board scrollbar-thin" role="list" aria-label="Project board">
          {PROJECT_STAGES.map((s) => {
            const col = projects.filter((p) => p.stage === s);
            return (
              <section
                key={s}
                role="listitem"
                aria-label={`${STAGE_TEXT[s]}: ${col.length}`}
                className="pd-col"
              >
                <header className="pd-col-head">
                  <span>{STAGE_TEXT[s]}</span>
                  <b className="num">{col.length}</b>
                </header>
                <div className="grid gap-2">
                  {col.map((p) => (
                    <div key={p.id} className="grid gap-1">
                      <PilotProjectCard p={p} />
                      <select
                        aria-label={`Stage for ${p.name}`}
                        className={cn(selectCls, "h-8 w-full text-xs")}
                        value={p.stage}
                        onChange={(e) =>
                          handleStageChange(p.id, e.target.value as ProjectStageApi, p.stage, p.version)
                        }
                      >
                        {PROJECT_STAGES.map((x) => (
                          <option key={x} value={x} disabled={x === "delivered" && !p.delivery}>
                            {STAGE_TEXT[x]}
                          </option>
                        ))}
                      </select>
                    </div>
                  ))}
                  {col.length === 0 && (
                    <p className="px-1 py-4 text-center text-xs text-muted-foreground">Empty</p>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

function PilotProjectsTemplates() {
  const { data: templatesData, isLoading } = useProjectTemplatesQuery({ includeArchived: true });
  const saveMutation = useSaveProjectTemplateMutation();
  const [editingTemplate, setEditingTemplate] = useState<{
    id?: string;
    name: string;
    type: string;
    milestones: string;
    tasks: string;
    requirements: string;
    qa: string;
    handover: string;
  } | null>(null);

  const templates = templatesData?.items ?? [];

  const handleOpenNew = () => {
    setEditingTemplate({
      name: "",
      type: "Website Studio",
      milestones: "Discovery & Planning\nDesign Approval\nDevelopment Build\nLaunch",
      tasks: "Discovery & Planning: Client kickoff call\nDesign Approval: Wireframe sign-off\nDevelopment Build: Frontend assembly\nLaunch: Production deployment",
      requirements: "Domain and DNS access\nBrand asset files (SVG/AI)",
      qa: "Mobile responsive testing\nSSL verified\nLighthouse score > 85",
      handover: "Admin credentials handover\nClient training call",
    });
  };

  const handleSave = async () => {
    if (!editingTemplate || !editingTemplate.name.trim()) {
      toast.error("Template name is required.");
      return;
    }

    const split = (s: string) =>
      s
        .split("\n")
        .map((x) => x.trim())
        .filter(Boolean);

    const ms = split(editingTemplate.milestones);
    const parsedTasks = split(editingTemplate.tasks).map((x) => {
      const i = x.indexOf(": ");
      const m = i > 0 ? x.slice(0, i) : "";
      return m && ms.includes(m) ? { title: x.slice(i + 2), milestone: m } : { title: x };
    });

    try {
      await saveMutation.mutateAsync({
        id: editingTemplate.id,
        name: editingTemplate.name.trim(),
        type: editingTemplate.type.trim() || "Website Studio",
        milestones: ms,
        tasks: parsedTasks,
        requirements: split(editingTemplate.requirements),
        qa: split(editingTemplate.qa),
        handover: split(editingTemplate.handover),
      });

      toast.success("Project template saved.");
      setEditingTemplate(null);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to save template.";
      toast.error(msg);
    }
  };

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Templates provide consistent starter milestones, tasks, and QA checklists for new projects.
        </p>
        <Button className="rounded-full gap-1.5" onClick={handleOpenNew}>
          <Plus className="size-4" />
          New template
        </Button>
      </div>

      {editingTemplate && (
        <section className="receipt grid gap-4 p-5 sm:p-6" aria-label="Template editor">
          <div className="eyebrow">
            {editingTemplate.id ? "Edit template" : "Create new template"}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="grid gap-1.5 text-sm">
              <span className="font-medium">Template Name *</span>
              <Input
                value={editingTemplate.name}
                onChange={(e) =>
                  setEditingTemplate({ ...editingTemplate, name: e.target.value })
                }
                placeholder="e.g. Standard Website Package"
              />
            </label>
            <label className="grid gap-1.5 text-sm">
              <span className="font-medium">Type</span>
              <Input
                value={editingTemplate.type}
                onChange={(e) =>
                  setEditingTemplate({ ...editingTemplate, type: e.target.value })
                }
              />
            </label>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="grid gap-1.5 text-sm">
              <span className="font-medium">Milestones (One per line)</span>
              <Textarea
                rows={3}
                value={editingTemplate.milestones}
                onChange={(e) =>
                  setEditingTemplate({ ...editingTemplate, milestones: e.target.value })
                }
              />
            </label>
            <label className="grid gap-1.5 text-sm">
              <span className="font-medium">Tasks (Prefix with "Milestone: " to group)</span>
              <Textarea
                rows={3}
                value={editingTemplate.tasks}
                onChange={(e) =>
                  setEditingTemplate({ ...editingTemplate, tasks: e.target.value })
                }
              />
            </label>
            <label className="grid gap-1.5 text-sm">
              <span className="font-medium">Client Requirements Checklist</span>
              <Textarea
                rows={3}
                value={editingTemplate.requirements}
                onChange={(e) =>
                  setEditingTemplate({ ...editingTemplate, requirements: e.target.value })
                }
              />
            </label>
            <label className="grid gap-1.5 text-sm">
              <span className="font-medium">Technical QA Checklist</span>
              <Textarea
                rows={3}
                value={editingTemplate.qa}
                onChange={(e) =>
                  setEditingTemplate({ ...editingTemplate, qa: e.target.value })
                }
              />
            </label>
          </div>

          <label className="grid gap-1.5 text-sm">
            <span className="font-medium">Handover Checklist</span>
            <Textarea
              rows={2}
              value={editingTemplate.handover}
              onChange={(e) =>
                setEditingTemplate({ ...editingTemplate, handover: e.target.value })
              }
            />
          </label>

          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setEditingTemplate(null)}>
              Cancel
            </Button>
            <Button onClick={handleSave}>Save template</Button>
          </div>
        </section>
      )}

      {isLoading ? (
        <div className="py-8 text-center text-sm text-muted-foreground">Loading templates...</div>
      ) : templates.length === 0 ? (
        <div className="receipt">
          <Empty
            icon={<Settings2 />}
            title="No templates found"
            hint="Click 'New template' above to create reusable milestone and QA configurations."
          />
        </div>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {templates.map((t) => (
            <li key={t.id} className="receipt p-5" data-archived={t.archived || undefined}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-medium">
                    {t.name}
                    {t.archived && (
                      <span className="ml-2 text-xs text-muted-foreground">(archived)</span>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {t.type} · {t.milestones.length} milestones · {t.tasks.length} tasks ·{" "}
                    {t.requirements.length} requirements · {t.qa.length + t.handover.length} delivery
                    checks
                  </div>
                </div>
                <div className="flex gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      setEditingTemplate({
                        id: t.id,
                        name: t.name,
                        type: t.type,
                        milestones: t.milestones.join("\n"),
                        tasks: t.tasks
                          .map((x) => (x.milestone ? `${x.milestone}: ${x.title}` : x.title))
                          .join("\n"),
                        requirements: t.requirements.join("\n"),
                        qa: t.qa.join("\n"),
                        handover: t.handover.join("\n"),
                      })
                    }
                  >
                    Edit
                  </Button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
