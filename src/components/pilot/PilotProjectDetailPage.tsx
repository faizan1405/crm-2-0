import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  CheckCircle2,
  Clock,
  ExternalLink,
  FolderKanban,
  History,
  Layers,
  LifeBuoy,
  MessageCircle,
  Plus,
  RotateCcw,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Empty, selectCls } from "@/components/crm/Shell";
import { formatDate, formatDateTime, formatINR } from "@/lib/crm/format";
import { safeHref } from "@/lib/crm/validation";
import {
  addMonths,
  deliveryGaps,
  isProjectOverdue,
  supportStatus,
  PROJECT_STAGES,
  PROJECT_STATUSES,
  STAGE_TEXT,
  STATUS_TEXT,
  SUPPORT_KIND_TEXT,
  SUPPORT_TEXT,
  type ProjectStage,
  type ProjectStatus,
  type SupportKind,
} from "@/lib/crm/projects";
import { ProgressBar, StagePill, StatusPill } from "@/components/projects/ProjectParts";
import { useDealsQuery, usePaymentsQuery } from "@/lib/api/financeApi";
import {
  useAddProjectNoteMutation,
  useArchiveProjectMutation,
  useConfigureProjectSupportMutation,
  useCreateMilestoneMutation,
  useCreateTaskMutation,
  useDeliverProjectMutation,
  useMoveProjectStageMutation,
  useProjectDetailsQuery,
  useReopenSupportTicketMutation,
  useSetProjectStatusMutation,
  useSetTaskDoneMutation,
  useToggleChecklistItemMutation,
  useToggleDependencyItemMutation,
  useUpdateMilestoneMutation,
  useUpdateProjectMutation,
  useUpdateTaskMutation,
} from "@/lib/api/projectsApi";
import type {
  ClientSupportTicketDto,
  DeliverableStatusApi,
  ProjectDeliverableDto,
  ProjectDto,
  ProjectMilestoneDto,
  ProjectPriorityApi,
  ProjectStageApi,
  ProjectStatusApi,
  ProjectTaskDto,
} from "@/lib/api/schemas";
import { cn } from "@/lib/utils";
import {
  PilotNewDeliverableDialog,
  PilotNewRevisionDialog,
} from "./PilotDeliverableDialog";
import {
  PilotNewSupportTicketDialog,
  PilotResolveSupportTicketDialog,
} from "./PilotSupportTicketDialog";
import { PilotShell } from "./PilotShell";

type Tab =
  | "overview"
  | "tasks"
  | "requirements"
  | "deliverables"
  | "delivery"
  | "finance"
  | "activity";

const TABS: Tab[] = [
  "overview",
  "tasks",
  "requirements",
  "deliverables",
  "delivery",
  "finance",
  "activity",
];

const TAB_TEXT: Record<Tab, string> = {
  overview: "Overview",
  tasks: "Tasks & milestones",
  requirements: "Client requirements",
  deliverables: "Deliverables & revisions",
  delivery: "Delivery & support",
  finance: "Finance ledger",
  activity: "Activity log",
};

export function PilotProjectDetailPage({
  projectId,
  search,
}: {
  projectId: string;
  search: Record<string, unknown>;
}) {
  const tabParam = (search["tab"] as Tab) || "overview";
  const [tab, setTab] = useState<Tab>(TABS.includes(tabParam) ? tabParam : "overview");

  const { data, isLoading, isError } = useProjectDetailsQuery(projectId);

  if (isLoading) {
    return (
      <PilotShell title="Project details (Pilot)" subtitle="Loading project data...">
        <div className="py-12 text-center text-sm text-muted-foreground">
          Loading project details from MariaDB...
        </div>
      </PilotShell>
    );
  }

  if (isError || !data?.project) {
    return (
      <PilotShell title="Project details (Pilot)" subtitle="Project not found">
        <div className="receipt">
          <Empty
            icon={<FolderKanban />}
            title="Project not found"
            hint="This project doesn't exist or is not associated with your session."
            action={
              <Link to="/projects" search={{ pilot: 1 }} className="text-sm underline">
                Back to Project Desk
              </Link>
            }
          />
        </div>
      </PilotShell>
    );
  }

  const { project, milestones, tasks, deliverables, supportTickets, recentAuditEvents } = data;

  return (
    <PilotShell
      title={project.name}
      subtitle={`${project.clientName}${project.company ? ` · ${project.company}` : ""} · ${project.type}`}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <Link
            to="/projects"
            search={{ pilot: 1 }}
            className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium hover:bg-accent"
          >
            <ArrowLeft className="size-3.5" />
            Project Desk
          </Link>
          <StatusPill status={project.status as ProjectStatus} />
          <StagePill stage={project.stage as ProjectStage} />
          {project.archived && <span className="pd-pill">Archived</span>}
        </div>
      }
    >
      <nav className="mb-6 max-w-full overflow-x-auto" aria-label="Project sections">
        <div className="seg w-max">
          {TABS.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              aria-current={tab === t ? "page" : undefined}
              className="seg-link"
              data-active={tab === t}
            >
              {TAB_TEXT[t]}
            </button>
          ))}
        </div>
      </nav>

      {tab === "overview" && <OverviewTab project={project} />}
      {tab === "tasks" && (
        <TasksTab project={project} milestones={milestones} tasks={tasks} />
      )}
      {tab === "requirements" && <RequirementsTab project={project} />}
      {tab === "deliverables" && (
        <DeliverablesTab project={project} deliverables={deliverables} />
      )}
      {tab === "delivery" && (
        <DeliveryTab
          project={project}
          supportTickets={supportTickets}
        />
      )}
      {tab === "finance" && <FinanceTab project={project} />}
      {tab === "activity" && (
        <ActivityTab project={project} events={recentAuditEvents} />
      )}
    </PilotShell>
  );
}

// ---------------------------------------------------------------------------
// TAB 1: OVERVIEW
// ---------------------------------------------------------------------------

function OverviewTab({ project }: { project: ProjectDto }) {
  const updateMutation = useUpdateProjectMutation();
  const setStatusMutation = useSetProjectStatusMutation();
  const moveStageMutation = useMoveProjectStageMutation();
  const archiveMutation = useArchiveProjectMutation();

  const [form, setForm] = useState({
    name: project.name,
    scope: project.scope ?? "",
    bookingDate: project.bookingDate ?? "",
    plannedStart: project.plannedStart ?? "",
    actualStart: project.actualStart ?? "",
    targetDelivery: project.targetDelivery ?? "",
    priority: project.priority,
    notes: project.notes ?? "",
  });

  const [savedBaseline, setSavedBaseline] = useState(() => JSON.stringify(form));
  const isDirty = JSON.stringify(form) !== savedBaseline;
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setForm({
      name: project.name,
      scope: project.scope ?? "",
      bookingDate: project.bookingDate ?? "",
      plannedStart: project.plannedStart ?? "",
      actualStart: project.actualStart ?? "",
      targetDelivery: project.targetDelivery ?? "",
      priority: project.priority,
      notes: project.notes ?? "",
    });
    setSavedBaseline(
      JSON.stringify({
        name: project.name,
        scope: project.scope ?? "",
        bookingDate: project.bookingDate ?? "",
        plannedStart: project.plannedStart ?? "",
        actualStart: project.actualStart ?? "",
        targetDelivery: project.targetDelivery ?? "",
        priority: project.priority,
        notes: project.notes ?? "",
      }),
    );
  }, [project]);

  const handleSaveInfo = async () => {
    if (!isDirty) return;
    try {
      setBusy(true);
      await updateMutation.mutateAsync({
        id: project.id,
        payload: {
          expectedVersion: project.version,
          name: form.name.trim(),
          scope: form.scope.trim() || undefined,
          bookingDate: form.bookingDate || null,
          plannedStart: form.plannedStart || null,
          actualStart: form.actualStart || null,
          targetDelivery: form.targetDelivery || null,
          priority: form.priority,
          notes: form.notes.trim() || null,
        },
      });
      setSavedBaseline(JSON.stringify(form));
      toast.success("Project information saved.");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to update project.";
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  const handleStatusChange = async (newStatus: ProjectStatusApi) => {
    try {
      await setStatusMutation.mutateAsync({
        id: project.id,
        payload: { status: newStatus, expectedVersion: project.version },
      });
      toast.success(`Status updated: ${STATUS_TEXT[newStatus]}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to update status.";
      toast.error(msg);
    }
  };

  const handleStageChange = async (newStage: ProjectStageApi) => {
    if (newStage === "delivered") {
      toast.error("Record delivery from the Delivery & support tab — it verifies checklist items first.");
      return;
    }
    try {
      await moveStageMutation.mutateAsync({
        id: project.id,
        payload: { stage: newStage, from: project.stage, expectedVersion: project.version },
      });
      toast.success(`Stage moved to ${STAGE_TEXT[newStage]}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to move stage.";
      toast.error(msg);
    }
  };

  const handleArchiveToggle = async () => {
    const nextArchived = !project.archived;
    if (
      !project.archived &&
      !window.confirm("Archive this project? Its tasks, deliverables and payment links are kept.")
    ) {
      return;
    }
    try {
      await archiveMutation.mutateAsync({
        id: project.id,
        payload: { archived: nextArchived, expectedVersion: project.version },
      });
      toast.success(nextArchived ? "Project archived." : "Project restored.");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to toggle archive status.";
      toast.error(msg);
    }
  };

  return (
    <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
      <div className="grid content-start gap-6">
        <section className="receipt p-5 sm:p-6" aria-label="Project information">
          <div className="eyebrow mb-4">Project information</div>
          <div className="grid gap-4">
            <label className="grid gap-1.5 text-sm">
              <span className="text-muted-foreground">Project name</span>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </label>

            <label className="grid gap-1.5 text-sm">
              <span className="text-muted-foreground">Agreed scope</span>
              <Textarea
                rows={3}
                value={form.scope}
                onChange={(e) => setForm({ ...form, scope: e.target.value })}
              />
            </label>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="grid gap-1.5 text-sm">
                <span className="text-muted-foreground">Booking date</span>
                <Input
                  type="date"
                  value={form.bookingDate}
                  onChange={(e) => setForm({ ...form, bookingDate: e.target.value })}
                />
              </label>
              <label className="grid gap-1.5 text-sm">
                <span className="text-muted-foreground">Planned start</span>
                <Input
                  type="date"
                  value={form.plannedStart}
                  onChange={(e) => setForm({ ...form, plannedStart: e.target.value })}
                />
              </label>
              <label className="grid gap-1.5 text-sm">
                <span className="text-muted-foreground">Actual start</span>
                <Input
                  type="date"
                  value={form.actualStart}
                  onChange={(e) => setForm({ ...form, actualStart: e.target.value })}
                />
              </label>
              <label className="grid gap-1.5 text-sm">
                <span className="text-muted-foreground">Target delivery</span>
                <Input
                  type="date"
                  value={form.targetDelivery}
                  onChange={(e) => setForm({ ...form, targetDelivery: e.target.value })}
                />
              </label>
            </div>

            <div className="grid gap-1.5 text-sm">
              <span className="text-muted-foreground">Priority</span>
              <select
                className={selectCls}
                value={form.priority}
                onChange={(e) =>
                  setForm({ ...form, priority: e.target.value as ProjectPriorityApi })
                }
              >
                <option value="high">High</option>
                <option value="normal">Normal</option>
                <option value="low">Low</option>
              </select>
            </div>

            <label className="grid gap-1.5 text-sm">
              <span className="text-muted-foreground">Internal notes (Owner only)</span>
              <Textarea
                rows={3}
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                placeholder="Never store passwords or keys here"
              />
            </label>

            <div className="flex justify-end">
              <Button disabled={!isDirty || busy} onClick={handleSaveInfo}>
                {busy ? "Saving..." : "Save changes"}
              </Button>
            </div>
          </div>
        </section>

        <section className="receipt p-5 sm:p-6" aria-label="Client details">
          <div className="eyebrow mb-4">Client & Origin</div>
          <dl className="pd-carry">
            <div>
              <dt>Client</dt>
              <dd>
                {project.leadId ? (
                  <Link
                    to="/leads/$id"
                    params={{ id: project.leadId }}
                    search={{ pilot: 1 }}
                    className="underline-offset-4 hover:underline"
                  >
                    {project.clientName}
                  </Link>
                ) : (
                  project.clientName
                )}
              </dd>
            </div>
            <div>
              <dt>Company</dt>
              <dd>{project.company ?? "—"}</dd>
            </div>
            <div>
              <dt>Phone</dt>
              <dd>{project.phone ?? "—"}</dd>
            </div>
            <div>
              <dt>Email</dt>
              <dd>{project.email ?? "—"}</dd>
            </div>
            <div>
              <dt>Lead Source</dt>
              <dd>{(project.carried["source"] as string) ?? "—"}</dd>
            </div>
            <div>
              <dt>Package Ref</dt>
              <dd>{(project.carried["packageRef"] as string) ?? "—"}</dd>
            </div>
            {project.dealId && (
              <div>
                <dt>Linked Deal</dt>
                <dd>
                  <Link to="/deals" search={{ pilot: 1 }} className="underline-offset-4 hover:underline">
                    View in Finance Studio
                  </Link>
                </dd>
              </div>
            )}
          </dl>
        </section>
      </div>

      <div className="grid content-start gap-6">
        {project.attention && (
          <div className="pd-note" role="status">
            <b>Attention:</b> {project.attention.reason}
          </div>
        )}

        <section className="receipt p-5 sm:p-6" aria-label="Status & lifecycle">
          <div className="eyebrow mb-4">Status & Lifecycle</div>
          <div className="grid gap-3">
            <label className="grid gap-1.5 text-sm">
              <span className="text-muted-foreground">Commercial status</span>
              <select
                aria-label="Project status"
                className={selectCls}
                value={project.status}
                onChange={(e) => handleStatusChange(e.target.value as ProjectStatusApi)}
              >
                {PROJECT_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {STATUS_TEXT[s]}
                  </option>
                ))}
              </select>
            </label>

            <label className="grid gap-1.5 text-sm">
              <span className="text-muted-foreground">Delivery stage</span>
              <select
                aria-label="Project stage"
                className={selectCls}
                value={project.stage}
                onChange={(e) => handleStageChange(e.target.value as ProjectStageApi)}
              >
                {PROJECT_STAGES.map((s) => (
                  <option key={s} value={s} disabled={s === "delivered" && !project.delivery}>
                    {STAGE_TEXT[s]}
                  </option>
                ))}
              </select>
            </label>

            <div className="mt-2">
              <ProgressBar pct={project.progress.pct} label={project.progress.text} />
            </div>

            <p className="text-xs text-muted-foreground">
              Progress counts strictly completed tasks — never the delivery stage.
            </p>

            <div className="pt-2">
              <Button variant="ghost" size="sm" onClick={handleArchiveToggle}>
                {project.archived ? "Restore project" : "Archive project"}
              </Button>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// TAB 2: TASKS & MILESTONES
// ---------------------------------------------------------------------------

function TasksTab({
  project,
  milestones,
  tasks,
}: {
  project: ProjectDto;
  milestones: ProjectMilestoneDto[];
  tasks: ProjectTaskDto[];
}) {
  const createTaskMutation = useCreateTaskMutation();
  const createMilestoneMutation = useCreateMilestoneMutation();
  const setTaskDoneMutation = useSetTaskDoneMutation();
  const updateTaskMutation = useUpdateTaskMutation();
  const updateMilestoneMutation = useUpdateMilestoneMutation();

  const [taskTitle, setTaskTitle] = useState("");
  const [taskMilestoneId, setTaskMilestoneId] = useState("");
  const [taskDueDate, setTaskDueDate] = useState("");
  const [taskPriority, setTaskPriority] = useState<ProjectPriorityApi>("normal");

  const [milestoneTitle, setMilestoneTitle] = useState("");
  const [milestoneDueDate, setMilestoneDueDate] = useState("");

  const handleAddTask = async () => {
    if (!taskTitle.trim()) {
      toast.error("Task title is required.");
      return;
    }
    try {
      await createTaskMutation.mutateAsync({
        projectId: project.id,
        payload: {
          title: taskTitle.trim(),
          milestoneId: taskMilestoneId || undefined,
          dueDate: taskDueDate || undefined,
          priority: taskPriority,
        },
      });
      toast.success("Task added.");
      setTaskTitle("");
      setTaskDueDate("");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to add task.";
      toast.error(msg);
    }
  };

  const handleAddMilestone = async () => {
    if (!milestoneTitle.trim()) {
      toast.error("Milestone title is required.");
      return;
    }
    try {
      await createMilestoneMutation.mutateAsync({
        projectId: project.id,
        payload: {
          title: milestoneTitle.trim(),
          dueDate: milestoneDueDate || undefined,
        },
      });
      toast.success("Milestone created.");
      setMilestoneTitle("");
      setMilestoneDueDate("");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to add milestone.";
      toast.error(msg);
    }
  };

  const handleToggleDone = async (task: ProjectTaskDto) => {
    const nextDone = task.status !== "done";
    try {
      await setTaskDoneMutation.mutateAsync({
        taskId: task.id,
        projectId: project.id,
        done: nextDone,
        expectedVersion: task.version,
      });
      toast.success(nextDone ? "Task completed." : "Task reopened.");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to update task status.";
      toast.error(msg);
    }
  };

  const handleToggleMilestone = async (m: ProjectMilestoneDto) => {
    const nextStatus = m.status === "completed" ? "open" : "completed";
    try {
      await updateMilestoneMutation.mutateAsync({
        milestoneId: m.id,
        projectId: project.id,
        payload: { status: nextStatus, expectedVersion: m.version },
      });
      toast.success(`Milestone marked ${nextStatus}.`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to update milestone.";
      toast.error(msg);
    }
  };

  const sortedMilestones = [...milestones].sort((a, b) => a.sortOrder - b.sortOrder);
  const groups = [
    ...sortedMilestones.map((m) => ({ id: m.id, title: m.title, milestone: m })),
    { id: "", title: "Unassigned Tasks", milestone: null },
  ];

  return (
    <div className="grid gap-6">
      <section className="receipt p-5 sm:p-6" aria-label="Progress">
        <div className="eyebrow mb-3">Overall Completion</div>
        <ProgressBar pct={project.progress.pct} label={project.progress.text} />
      </section>

      {/* Task & Milestone Creation */}
      <section className="receipt p-5 sm:p-6" aria-label="Add work">
        <div className="eyebrow mb-3">Add Work</div>
        <div className="pd-filters">
          <Input
            aria-label="Task title"
            placeholder="New task title"
            className="min-w-[200px] flex-1"
            value={taskTitle}
            onChange={(e) => setTaskTitle(e.target.value)}
          />
          <select
            aria-label="Milestone"
            className={selectCls}
            value={taskMilestoneId}
            onChange={(e) => setTaskMilestoneId(e.target.value)}
          >
            <option value="">No milestone</option>
            {milestones.map((m) => (
              <option key={m.id} value={m.id}>
                {m.title}
              </option>
            ))}
          </select>
          <Input
            aria-label="Due date"
            type="date"
            className="w-auto"
            value={taskDueDate}
            onChange={(e) => setTaskDueDate(e.target.value)}
          />
          <select
            aria-label="Priority"
            className={selectCls}
            value={taskPriority}
            onChange={(e) => setTaskPriority(e.target.value as ProjectPriorityApi)}
          >
            <option value="high">High</option>
            <option value="normal">Normal</option>
            <option value="low">Low</option>
          </select>
          <Button onClick={handleAddTask}>
            <Plus className="size-4" />
            Add task
          </Button>
        </div>

        <div className="pd-filters mt-4 border-t pt-3">
          <Input
            aria-label="Milestone name"
            placeholder="New delivery milestone"
            className="min-w-[200px] flex-1"
            value={milestoneTitle}
            onChange={(e) => setMilestoneTitle(e.target.value)}
          />
          <Input
            aria-label="Milestone due"
            type="date"
            className="w-auto"
            value={milestoneDueDate}
            onChange={(e) => setMilestoneDueDate(e.target.value)}
          />
          <Button variant="outline" onClick={handleAddMilestone}>
            <Plus className="size-4" />
            Add milestone
          </Button>
        </div>
      </section>

      {/* Grouped Tasks */}
      {groups.map((g) => {
        const groupTasks = tasks.filter((t) => (t.milestoneId ?? "") === g.id);
        if (!g.id && groupTasks.length === 0) return null;

        return (
          <section key={g.id || "unassigned"} className="receipt p-5 sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-3 mb-3">
              <div className="font-semibold text-sm">
                {g.title}
                {g.milestone?.dueDate && (
                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                    due {formatDate(g.milestone.dueDate)}
                  </span>
                )}
              </div>
              {g.milestone && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs rounded-full"
                  onClick={() => handleToggleMilestone(g.milestone!)}
                >
                  {g.milestone.status === "completed" ? "Reopen Milestone" : "Mark Milestone Complete"}
                </Button>
              )}
            </div>

            {groupTasks.length === 0 ? (
              <p className="text-sm text-muted-foreground py-2">No tasks in this group.</p>
            ) : (
              <ul className="grid gap-2">
                {groupTasks.map((t) => (
                  <TaskRowItem
                    key={t.id}
                    task={t}
                    projectId={project.id}
                    onToggleDone={() => handleToggleDone(t)}
                  />
                ))}
              </ul>
            )}
          </section>
        );
      })}

      {tasks.length === 0 && (
        <div className="receipt">
          <Empty
            icon={<FolderKanban />}
            title="No tasks yet"
            hint="Add the deliverables and tasks for this project to calculate progress."
          />
        </div>
      )}
    </div>
  );
}

function TaskRowItem({
  task,
  projectId,
  onToggleDone,
}: {
  task: ProjectTaskDto;
  projectId: string;
  onToggleDone: () => void;
}) {
  const updateTaskMutation = useUpdateTaskMutation();
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState(task.notes ?? "");
  const [dueDate, setDueDate] = useState(task.dueDate ?? "");
  const [busy, setBusy] = useState(false);

  const isDone = task.status === "done";
  const isOverdue =
    !isDone && task.dueDate && task.dueDate < new Date().toISOString().slice(0, 10);

  const handleSaveNotes = async () => {
    try {
      setBusy(true);
      await updateTaskMutation.mutateAsync({
        taskId: task.id,
        projectId,
        payload: {
          notes: notes.trim() || null,
          dueDate: dueDate || null,
          expectedVersion: task.version,
        },
      });
      toast.success("Task details saved.");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to update task.";
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="pd-task" data-done={isDone || undefined}>
      <div className="flex items-start gap-3">
        <button
          type="button"
          className="pd-check"
          aria-label={isDone ? `Reopen ${task.title}` : `Complete ${task.title}`}
          aria-pressed={isDone}
          onClick={onToggleDone}
        >
          {isDone ? <Check className="size-3.5" /> : null}
        </button>

        <button
          type="button"
          className="min-w-0 flex-1 text-left"
          onClick={() => setOpen(!open)}
        >
          <div className="text-sm font-medium">{task.title}</div>
          <div className="text-xs text-muted-foreground">
            {task.priority}
            {task.dueDate && ` · due ${formatDate(task.dueDate)}`}
            {isOverdue && <b className="ml-1 text-destructive">· Overdue</b>}
            {task.completedAt && ` · completed ${formatDate(task.completedAt)}`}
          </div>
        </button>
      </div>

      {open && (
        <div className="mt-3 grid gap-2 border-t pt-3">
          <div className="grid grid-cols-2 gap-3">
            <label className="grid gap-1.5 text-xs">
              <span className="text-muted-foreground">Due Date</span>
              <Input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </label>
          </div>

          <label className="grid gap-1.5 text-xs">
            <span className="text-muted-foreground">Task Notes</span>
            <Textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Internal execution notes"
            />
          </label>

          <div className="flex justify-end gap-2">
            <Button size="sm" variant="outline" onClick={handleSaveNotes} disabled={busy}>
              {busy ? "Saving..." : "Save details"}
            </Button>
          </div>
        </div>
      )}
    </li>
  );
}

// ---------------------------------------------------------------------------
// TAB 3: REQUIREMENTS & DEPENDENCIES
// ---------------------------------------------------------------------------

function RequirementsTab({ project }: { project: ProjectDto }) {
  const toggleChecklistMutation = useToggleChecklistItemMutation();
  const toggleDependencyMutation = useToggleDependencyItemMutation();

  const handleToggleReq = async (itemId: string) => {
    try {
      await toggleChecklistMutation.mutateAsync({
        projectId: project.id,
        list: "requirements",
        itemId,
        expectedVersion: project.version,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to toggle requirement.";
      toast.error(msg);
    }
  };

  const handleToggleDep = async (depId: string) => {
    try {
      await toggleDependencyMutation.mutateAsync({
        projectId: project.id,
        depId,
        expectedVersion: project.version,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to toggle dependency.";
      toast.error(msg);
    }
  };

  const reqDoneCount = project.requirements.filter((r) => r.done).length;
  const openDepsCount = project.dependencies.filter((d) => !d.done).length;

  return (
    <div className="grid gap-6 xl:grid-cols-2">
      {/* Requirements */}
      <section className="receipt p-5 sm:p-6" aria-label="Requirements checklist">
        <div className="eyebrow mb-2">
          Requirements checklist · {reqDoneCount}/{project.requirements.length}
        </div>
        <p className="mb-3 text-xs text-muted-foreground">
          Track project deliverables and client requirements. Never store passwords or secrets here.
        </p>

        <ul className="grid gap-1.5">
          {project.requirements.map((r) => (
            <li key={r.id}>
              <label className="pd-row cursor-pointer">
                <input
                  type="checkbox"
                  checked={r.done}
                  onChange={() => handleToggleReq(r.id)}
                />
                <span className={cn("flex-1 text-sm", r.done && "text-muted-foreground line-through")}>
                  {r.label}
                </span>
                {r.doneAt && (
                  <span className="text-[11px] text-muted-foreground">{formatDate(r.doneAt)}</span>
                )}
              </label>
            </li>
          ))}
          {project.requirements.length === 0 && (
            <li className="text-sm text-muted-foreground py-2">No requirements defined.</li>
          )}
        </ul>
      </section>

      {/* Client Dependencies & Links */}
      <div className="grid content-start gap-6">
        <section className="receipt p-5 sm:p-6" aria-label="Waiting on client">
          <div className="eyebrow mb-2">
            Waiting on client · {openDepsCount} pending
          </div>
          <ul className="grid gap-1.5">
            {project.dependencies.map((d) => (
              <li key={d.id}>
                <label className="pd-row cursor-pointer">
                  <input
                    type="checkbox"
                    checked={d.done}
                    onChange={() => handleToggleDep(d.id)}
                  />
                  <span className={cn("flex-1 text-sm", d.done && "text-muted-foreground line-through")}>
                    {d.label}
                  </span>
                </label>
              </li>
            ))}
            {project.dependencies.length === 0 && (
              <li className="text-sm text-muted-foreground py-2">No client dependencies recorded.</li>
            )}
          </ul>
        </section>

        <section className="receipt p-5 sm:p-6" aria-label="References & Links">
          <div className="eyebrow mb-2">References & Project Links</div>
          <ul className="grid gap-1.5">
            {project.links.map((l) => (
              <li key={l.id}>
                <a
                  href={safeHref(l.url) ?? undefined}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="pd-row text-sm"
                >
                  <ExternalLink className="size-3.5 shrink-0" />
                  <span className="truncate">{l.label}</span>
                </a>
              </li>
            ))}
            {project.links.length === 0 && (
              <li className="text-sm text-muted-foreground py-2">No reference links recorded.</li>
            )}
          </ul>
        </section>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// TAB 4: DELIVERABLES & REVISIONS
// ---------------------------------------------------------------------------

function DeliverablesTab({
  project,
  deliverables,
}: {
  project: ProjectDto;
  deliverables: ProjectDeliverableDto[];
}) {
  const [showNewDel, setShowNewDel] = useState(false);
  const [activeRevisionDel, setActiveRevisionDel] = useState<ProjectDeliverableDto | null>(null);

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Track deliverables, version milestones, and revision iterations for this project.
        </p>
        <Button className="rounded-full gap-1.5" onClick={() => setShowNewDel(true)}>
          <Plus className="size-4" />
          Add deliverable
        </Button>
      </div>

      {deliverables.length === 0 ? (
        <div className="receipt">
          <Empty
            icon={<Layers />}
            title="No deliverables recorded"
            hint="Add deliverables such as design systems, wireframes, or staging prototypes."
          />
        </div>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2">
          {deliverables.map((del) => (
            <li key={del.id} className="receipt p-5 sm:p-6">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-semibold text-base">{del.title}</div>
                  <div className="text-xs text-muted-foreground capitalize">
                    {del.category} · {del.status} · {del.revisionCount} revision(s)
                  </div>
                </div>
                <span className="pd-pill capitalize">{del.status}</span>
              </div>

              {del.description && (
                <p className="mt-2 text-sm text-muted-foreground">{del.description}</p>
              )}

              {del.latestRevisionNotes && (
                <div className="mt-3 rounded-lg bg-card/60 border p-2 text-xs">
                  <span className="font-medium">Latest revision:</span> {del.latestRevisionNotes}
                </div>
              )}

              <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t pt-3">
                <span className="text-xs text-muted-foreground">
                  {del.dueDate ? `Due ${formatDate(del.dueDate)}` : "No due date"}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  className="rounded-full gap-1"
                  onClick={() => setActiveRevisionDel(del)}
                >
                  <Plus className="size-3" />
                  Submit revision
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <PilotNewDeliverableDialog
        projectId={project.id}
        open={showNewDel}
        onOpenChange={setShowNewDel}
      />

      {activeRevisionDel && (
        <PilotNewRevisionDialog
          projectId={project.id}
          deliverableId={activeRevisionDel.id}
          deliverableTitle={activeRevisionDel.title}
          open={!!activeRevisionDel}
          onOpenChange={(o) => !o && setActiveRevisionDel(null)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// TAB 5: DELIVERY & SUPPORT
// ---------------------------------------------------------------------------

function DeliveryTab({
  project,
  supportTickets,
}: {
  project: ProjectDto;
  supportTickets: ClientSupportTicketDto[];
}) {
  const deliverMutation = useDeliverProjectMutation();
  const configureSupportMutation = useConfigureProjectSupportMutation();
  const toggleChecklistMutation = useToggleChecklistItemMutation();
  const reopenTicketMutation = useReopenSupportTicketMutation();

  const [deliveryDate, setDeliveryDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [deliveryUrl, setDeliveryUrl] = useState("");
  const [deliveryNotes, setDeliveryNotes] = useState("");
  const [approval, setApproval] = useState<"pending" | "approved" | "not_required">("pending");
  const [overrideNotes, setOverrideNotes] = useState("");
  const [deliveringBusy, setDeliveringBusy] = useState(false);

  // Support terms
  const [supportIncluded, setSupportIncluded] = useState<"yes" | "no" | "">(
    project.support.included === true
      ? "yes"
      : project.support.included === false
        ? "no"
        : "",
  );
  const [supportMonths, setSupportMonths] = useState(
    project.support.months ? String(project.support.months) : "3",
  );
  const [supportStart, setSupportStart] = useState(project.support.start ?? "");
  const [supportDesc, setSupportDesc] = useState(project.support.description ?? "");
  const [supportBusy, setSupportBusy] = useState(false);

  // Dialog triggers
  const [showNewTicket, setShowNewTicket] = useState(false);
  const [resolvingTicket, setResolvingTicket] = useState<ClientSupportTicketDto | null>(null);

  const gaps = deliveryGaps(project);

  const handleToggleCheck = async (list: "qa" | "handover", itemId: string) => {
    try {
      await toggleChecklistMutation.mutateAsync({
        projectId: project.id,
        list,
        itemId,
        expectedVersion: project.version,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to toggle checklist.";
      toast.error(msg);
    }
  };

  const handleRecordDelivery = async () => {
    if (gaps.length > 0 && !overrideNotes.trim()) {
      toast.error(
        "There are incomplete checklist items. Please complete them or explain why delivering anyway.",
      );
      return;
    }

    try {
      setDeliveringBusy(true);
      await deliverMutation.mutateAsync({
        id: project.id,
        payload: {
          date: deliveryDate,
          approval,
          url: deliveryUrl.trim() || undefined,
          notes: deliveryNotes.trim() || undefined,
          override: gaps.length > 0 ? overrideNotes.trim() : undefined,
          expectedVersion: project.version,
        },
      });
      toast.success("Delivery recorded successfully.");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to record delivery.";
      toast.error(msg);
    } finally {
      setDeliveringBusy(false);
    }
  };

  const handleSaveSupport = async () => {
    try {
      setSupportBusy(true);
      const isInc = supportIncluded === "yes" ? true : supportIncluded === "no" ? false : null;
      const end =
        isInc && supportStart && supportMonths && Number(supportMonths) > 0
          ? addMonths(supportStart, Number(supportMonths))
          : undefined;

      await configureSupportMutation.mutateAsync({
        id: project.id,
        payload: {
          included: isInc,
          months: isInc && supportMonths ? Number(supportMonths) : undefined,
          start: isInc ? supportStart || undefined : undefined,
          end,
          description: isInc ? supportDesc.trim() || undefined : undefined,
          expectedVersion: project.version,
        },
      });
      toast.success("Support configuration saved.");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to save support settings.";
      toast.error(msg);
    } finally {
      setSupportBusy(false);
    }
  };

  const handleReopenTicket = async (ticket: ClientSupportTicketDto) => {
    try {
      await reopenTicketMutation.mutateAsync({
        ticketId: ticket.id,
        projectId: project.id,
        expectedVersion: ticket.version,
      });
      toast.success("Ticket reopened.");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to reopen ticket.";
      toast.error(msg);
    }
  };

  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <div className="grid content-start gap-6">
        {/* QA Checklist */}
        <section className="receipt p-5 sm:p-6" aria-label="Technical QA">
          <div className="eyebrow mb-2">Technical QA Checklist</div>
          <p className="mb-3 text-xs text-muted-foreground">Tick only what was actually tested.</p>
          <ul className="grid gap-1.5">
            {project.qa.map((q) => (
              <li key={q.id}>
                <label className="pd-row cursor-pointer">
                  <input
                    type="checkbox"
                    checked={q.done}
                    onChange={() => handleToggleCheck("qa", q.id)}
                  />
                  <span className={cn("flex-1 text-sm", q.done && "text-muted-foreground line-through")}>
                    {q.label}
                  </span>
                  {q.doneAt && (
                    <span className="text-[11px] text-muted-foreground">{formatDate(q.doneAt)}</span>
                  )}
                </label>
              </li>
            ))}
          </ul>
        </section>

        {/* Handover Checklist */}
        <section className="receipt p-5 sm:p-6" aria-label="Handover Checklist">
          <div className="eyebrow mb-2">Client Handover Checklist</div>
          <ul className="grid gap-1.5">
            {project.handover.map((h) => (
              <li key={h.id}>
                <label className="pd-row cursor-pointer">
                  <input
                    type="checkbox"
                    checked={h.done}
                    onChange={() => handleToggleCheck("handover", h.id)}
                  />
                  <span className={cn("flex-1 text-sm", h.done && "text-muted-foreground line-through")}>
                    {h.label}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <div className="grid content-start gap-6">
        {/* Delivery Form or Summary */}
        <section className="receipt p-5 sm:p-6" aria-label="Delivery Record">
          <div className="eyebrow mb-3">Delivery Status</div>
          {project.delivery ? (
            <dl className="pd-carry">
              <div>
                <dt>Delivered Date</dt>
                <dd>{formatDate(project.delivery.date)}</dd>
              </div>
              <div>
                <dt>Client Approval</dt>
                <dd className="capitalize">{project.delivery.approval.replace("_", " ")}</dd>
              </div>
              <div>
                <dt>Delivery URL</dt>
                <dd>
                  {project.delivery.url ? (
                    <a
                      href={safeHref(project.delivery.url) ?? undefined}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline"
                    >
                      {project.delivery.url}
                    </a>
                  ) : (
                    "—"
                  )}
                </dd>
              </div>
              {project.delivery.notes && (
                <div>
                  <dt>Handover Notes</dt>
                  <dd>{project.delivery.notes}</dd>
                </div>
              )}
              {project.delivery.override && (
                <div>
                  <dt>Override Reason</dt>
                  <dd className="text-warning">{project.delivery.override}</dd>
                </div>
              )}
            </dl>
          ) : (
            <div className="grid gap-3">
              <p className="text-xs text-muted-foreground">
                Delivered does NOT mean payment received — financial ledger remains separate in Deals & Payments.
              </p>
              <div className="grid grid-cols-2 gap-3">
                <label className="grid gap-1.5 text-sm">
                  <span className="text-muted-foreground">Delivery date</span>
                  <Input
                    type="date"
                    value={deliveryDate}
                    onChange={(e) => setDeliveryDate(e.target.value)}
                  />
                </label>
                <label className="grid gap-1.5 text-sm">
                  <span className="text-muted-foreground">Client approval</span>
                  <select
                    className={selectCls}
                    value={approval}
                    onChange={(e) => setApproval(e.target.value as typeof approval)}
                  >
                    <option value="pending">Pending</option>
                    <option value="approved">Approved</option>
                    <option value="not_required">Not required</option>
                  </select>
                </label>
              </div>

              <label className="grid gap-1.5 text-sm">
                <span className="text-muted-foreground">Live project URL</span>
                <Input
                  placeholder="https://..."
                  value={deliveryUrl}
                  onChange={(e) => setDeliveryUrl(e.target.value)}
                />
              </label>

              <label className="grid gap-1.5 text-sm">
                <span className="text-muted-foreground">Handover notes</span>
                <Textarea
                  rows={2}
                  value={deliveryNotes}
                  onChange={(e) => setDeliveryNotes(e.target.value)}
                />
              </label>

              {gaps.length > 0 && (
                <label className="grid gap-1.5 text-sm">
                  <span className="text-warning font-medium">
                    {gaps.length} checklist item(s) incomplete: {gaps.join(", ")}. Why deliver anyway?
                  </span>
                  <Textarea
                    rows={2}
                    placeholder="Provide justification for delivering with open items"
                    value={overrideNotes}
                    onChange={(e) => setOverrideNotes(e.target.value)}
                  />
                </label>
              )}

              <Button
                onClick={handleRecordDelivery}
                disabled={deliveringBusy}
                className="justify-self-start"
              >
                {deliveringBusy ? "Recording..." : "Mark Delivered"}
              </Button>
            </div>
          )}
        </section>

        {/* Technical Support Terms */}
        <section className="receipt p-5 sm:p-6" aria-label="Technical Support">
          <div className="eyebrow mb-3">
            Technical Support · {SUPPORT_TEXT[supportStatus(project.support, new Date().toISOString().slice(0, 10))]}
          </div>
          <div className="grid gap-3">
            <label className="grid gap-1.5 text-sm">
              <span className="text-muted-foreground">Support Included?</span>
              <select
                className={selectCls}
                value={supportIncluded}
                onChange={(e) => setSupportIncluded(e.target.value as typeof supportIncluded)}
              >
                <option value="">Not decided</option>
                <option value="yes">Yes, included</option>
                <option value="no">No</option>
              </select>
            </label>

            {supportIncluded === "yes" && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <label className="grid gap-1.5 text-sm">
                    <span className="text-muted-foreground">Start date</span>
                    <Input
                      id="support-start"
                      type="date"
                      value={supportStart}
                      onChange={(e) => setSupportStart(e.target.value)}
                    />
                  </label>
                  <label className="grid gap-1.5 text-sm">
                    <span className="text-muted-foreground">Months</span>
                    <Input
                      id="support-months"
                      type="number"
                      min={1}
                      max={120}
                      value={supportMonths}
                      onChange={(e) => setSupportMonths(e.target.value)}
                    />
                  </label>
                </div>

                <label className="grid gap-1.5 text-sm">
                  <span className="text-muted-foreground">Scope of support</span>
                  <Textarea
                    id="support-desc"
                    rows={2}
                    value={supportDesc}
                    onChange={(e) => setSupportDesc(e.target.value)}
                    placeholder="e.g. Bug fixes and minor copy tweaks"
                  />
                </label>
              </>
            )}

            <Button
              id="btn-save-support"
              variant="outline"
              onClick={handleSaveSupport}
              disabled={supportBusy}
              className="justify-self-start"
            >
              {supportBusy ? "Saving..." : "Save Support"}
            </Button>
          </div>
        </section>

        {/* Client Support Tickets */}
        <section className="receipt p-5 sm:p-6" aria-label="Support Tickets">
          <div className="flex items-center justify-between gap-2 border-b pb-3 mb-3">
            <div className="eyebrow">Support Tickets · {supportTickets.length}</div>
            <Button
              size="sm"
              variant="outline"
              className="rounded-full gap-1 h-7 text-xs"
              onClick={() => setShowNewTicket(true)}
            >
              <Plus className="size-3" />
              Open ticket
            </Button>
          </div>

          <ul className="grid gap-2">
            {supportTickets.map((tkt) => (
              <li key={tkt.id} className="pd-task" data-done={tkt.status === "resolved" || undefined}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-sm font-medium">{tkt.title}</div>
                    <div className="text-xs text-muted-foreground">
                      {SUPPORT_KIND_TEXT[tkt.kind as SupportKind]} · {tkt.priority} · {tkt.coverage}
                      {tkt.dueDate && ` · due ${formatDate(tkt.dueDate)}`}
                    </div>
                  </div>
                  <span className="pd-pill capitalize">{tkt.status.replace("_", " ")}</span>
                </div>

                {tkt.description && <p className="mt-2 text-sm">{tkt.description}</p>}

                {tkt.status === "resolved" && tkt.resolution && (
                  <p className="mt-2 text-xs text-muted-foreground border-l-2 pl-2">
                    Resolution: {tkt.resolution}
                  </p>
                )}

                <div className="mt-2 flex flex-wrap gap-2">
                  {tkt.status !== "resolved" && (
                    <Button
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => setResolvingTicket(tkt)}
                    >
                      Resolve
                    </Button>
                  )}
                  {tkt.status === "resolved" && (
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 text-xs underline"
                      onClick={() => handleReopenTicket(tkt)}
                    >
                      <RotateCcw className="size-3" />
                      Reopen
                    </button>
                  )}
                </div>
              </li>
            ))}
            {supportTickets.length === 0 && (
              <li className="text-sm text-muted-foreground py-2">No support tickets recorded.</li>
            )}
          </ul>
        </section>
      </div>

      <PilotNewSupportTicketDialog
        projectId={project.id}
        open={showNewTicket}
        onOpenChange={setShowNewTicket}
      />

      <PilotResolveSupportTicketDialog
        projectId={project.id}
        ticket={resolvingTicket}
        open={!!resolvingTicket}
        onOpenChange={(o) => !o && setResolvingTicket(null)}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// TAB 6: FINANCE (READ-ONLY LEDGER RECONCILIATION)
// ---------------------------------------------------------------------------

function FinanceTab({ project }: { project: ProjectDto }) {
  const { data: dealsData } = useDealsQuery({ limit: 100 });
  const { data: paymentsData } = usePaymentsQuery({
    dealId: project.dealId ?? undefined,
    limit: 100,
  });

  const deals = dealsData?.items ?? [];
  const linkedDeal = deals.find((d) => d.id === project.dealId);
  const payments = paymentsData?.items ?? [];

  if (!project.dealId || !linkedDeal) {
    return (
      <div className="receipt">
        <Empty
          icon={<FolderKanban />}
          title="No linked deal"
          hint="This project is not linked to a Deal in the Financial Ledger. Delivery actions never create payments."
        />
      </div>
    );
  }

  const fin = linkedDeal.financialSummary;

  return (
    <div className="grid gap-6">
      <section className="receipt p-5 sm:p-6" aria-label="Financial Summary">
        <div className="eyebrow mb-4">
          Financial Ledger · Linked Deal: {linkedDeal.name}
        </div>
        <dl className="grid grid-cols-2 gap-5 sm:grid-cols-4">
          <div>
            <dt className="eyebrow">Agreed Amount</dt>
            <dd className="num mt-1 text-lg">{formatINR(fin.finalAmount)}</dd>
          </div>
          <div>
            <dt className="eyebrow">Cash Collected</dt>
            <dd className="num mt-1 text-lg text-success">{formatINR(fin.collected)}</dd>
          </div>
          <div>
            <dt className="eyebrow">Outstanding</dt>
            <dd className="num mt-1 text-lg text-warning">{formatINR(fin.outstanding)}</dd>
          </div>
          <div>
            <dt className="eyebrow">Status</dt>
            <dd className="mt-1 text-sm font-medium capitalize">{fin.paymentStatus}</dd>
          </div>
        </dl>
      </section>

      <section className="receipt p-5 sm:p-6" aria-label="Payments">
        <div className="eyebrow mb-3">Recorded Payment Transactions · {payments.length}</div>
        <ul className="grid gap-2">
          {payments.map((p) => (
            <li
              key={p.id}
              className="pd-row text-sm"
              data-void={p.status === "voided" || undefined}
            >
              <span className="flex-1">
                {formatDate(p.date)} · {p.method} · {p.type}
                {p.status === "voided" && " · VOIDED"}
              </span>
              <span
                className={cn(
                  "num",
                  p.status === "voided" && "line-through text-muted-foreground",
                )}
              >
                {formatINR(p.amount)}
              </span>
            </li>
          ))}
          {payments.length === 0 && (
            <li className="text-sm text-muted-foreground py-2">
              No payments recorded for this deal yet.
            </li>
          )}
        </ul>

        <p className="mt-4 text-xs text-muted-foreground border-t pt-3">
          Payments, voids, and payment-proof attachments are exclusively managed in{" "}
          <Link to="/deals" search={{ pilot: 1 }} className="underline">
            Finance Studio
          </Link>
          . Projects and tasks never mutate the financial ledger.
        </p>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// TAB 7: ACTIVITY LOG
// ---------------------------------------------------------------------------

function ActivityTab({
  project,
  events,
}: {
  project: ProjectDto;
  events: Array<{
    id: string;
    eventType: string;
    summary: string;
    occurredIstDate: string;
    createdAt: string;
  }>;
}) {
  const addNoteMutation = useAddProjectNoteMutation();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const handleAddNote = async () => {
    if (!note.trim()) return;
    try {
      setBusy(true);
      await addNoteMutation.mutateAsync({
        id: project.id,
        text: note.trim(),
      });
      toast.success("Note added to project history.");
      setNote("");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to add note.";
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-6">
      <section className="receipt p-5 sm:p-6" aria-label="Add project note">
        <div className="eyebrow mb-3">Add Decision or Project Note</div>
        <div className="grid gap-2">
          <Textarea
            rows={2}
            placeholder="Record decisions, meeting outcomes, or updates"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <div className="flex justify-end">
            <Button onClick={handleAddNote} disabled={busy || !note.trim()}>
              {busy ? "Saving..." : "Add Note"}
            </Button>
          </div>
        </div>
      </section>

      <section className="receipt p-5 sm:p-6" aria-label="Audit history">
        <div className="eyebrow mb-3">Immutable Audit History · {events.length}</div>
        <ol className="grid gap-2">
          {events.map((e) => (
            <li key={e.id} className="pd-row text-sm">
              <span className="flex-1">{e.summary}</span>
              <span className="shrink-0 text-[11px] text-muted-foreground">
                {formatDateTime(e.createdAt)}
              </span>
            </li>
          ))}
          {events.length === 0 && (
            <li className="text-sm text-muted-foreground py-2">No activity recorded yet.</li>
          )}
        </ol>
      </section>
    </div>
  );
}
