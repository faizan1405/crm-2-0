import "@tanstack/react-start/server-only";
import { and, desc, eq, inArray, like, or, sql } from "drizzle-orm";
import type { CrmDatabase } from "../db/index.server";
import {
  crmClientSupportTickets,
  crmDeals,
  crmLeads,
  crmProjectAuditEvents,
  crmProjectDeliverableRevisions,
  crmProjectDeliverables,
  crmProjectMilestones,
  crmProjects,
  crmProjectTasks,
  crmProjectTemplates,
} from "../db/schema.server";
import { generateServerId } from "../auth/security.server";
import { toMysqlUtcDateTime } from "../db/utc.server";
import { toIstParts } from "./dates.server";
import { CrmServiceError } from "./errors.server";
import {
  hashIdempotentRequest,
  runWithIdempotency,
  type CrmTransaction,
} from "./idempotency.server";
import {
  addMonths,
  applyStatusSideEffects,
  deliveryError,
  deliveryGaps,
  looksLikeSecret,
  milestoneProgress,
  projectAttention,
  projectMetrics,
  projectProgress,
  SECRET_ERROR,
  supportError,
  supportStatus,
  validateProjectFields,
  type CheckItem,
  type DeliverInput,
  type DeliverableRevisionStatus,
  type DeliverableStatus,
  type ProjectDelivery,
  type ProjectDependency,
  type ProjectLink,
  type ProjectPriority,
  type ProjectStage,
  type ProjectStatus,
  type ProjectSupport,
  type RequestStatus,
  type SupportCoverage,
  type SupportKind,
} from "./projectsCalc.server";
import type {
  AddDeliverableRevisionInput,
  CreateDeliverableInput,
  CreateMilestoneInput,
  CreateProjectInput,
  CreateSupportTicketInput,
  CreateTaskInput,
  DeliverProjectInput,
  ListDeliverablesQuery,
  ListProjectsQuery,
  ListSupportTicketsQuery,
  ListTasksQuery,
  MoveProjectStageInput,
  SaveProjectTemplateInput,
  SetProjectStatusInput,
  UndoProjectStageInput,
  UpdateDeliverableInput,
  UpdateMilestoneInput,
  UpdateProjectInput,
  UpdateSupportTicketInput,
  UpdateTaskInput,
} from "./validation.server";

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

export interface ProjectDto {
  id: string;
  ownerUserId: string;
  name: string;
  clientName: string;
  company: string | null;
  phone: string | null;
  email: string | null;
  leadId: string | null;
  dealId: string | null;
  templateId: string | null;
  legacyId: string | null;
  type: string;
  scope: string | null;
  bookingDate: string | null;
  plannedStart: string | null;
  actualStart: string | null;
  targetDelivery: string | null;
  status: ProjectStatus;
  stage: ProjectStage;
  priority: ProjectPriority;
  projectOwnerId: string | null;
  memberIds: string[];
  dependencies: ProjectDependency[];
  requirements: CheckItem[];
  qa: CheckItem[];
  handover: CheckItem[];
  links: ProjectLink[];
  delivery: ProjectDelivery | null;
  support: ProjectSupport;
  carried: Record<string, unknown>;
  notes: string | null;
  reviewFlag: string | null;
  attention: { reason: string; at: string; ruleId?: string } | null;
  archived: boolean;
  archivedAt: string | null;
  version: number;
  progress: { total: number; done: number; pct: number | null; text: string };
  createdAt: string;
  updatedAt: string;
}

export interface ProjectMilestoneDto {
  id: string;
  ownerUserId: string;
  projectId: string;
  title: string;
  dueDate: string | null;
  sortOrder: number;
  status: "open" | "completed";
  completedAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectTaskDto {
  id: string;
  ownerUserId: string;
  projectId: string;
  milestoneId: string | null;
  title: string;
  notes: string | null;
  assigneeId: string | null;
  dueDate: string | null;
  priority: ProjectPriority;
  status: "open" | "done";
  completedAt: string | null;
  completedBy: string | null;
  sortOrder: number;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectDeliverableDto {
  id: string;
  ownerUserId: string;
  projectId: string;
  title: string;
  description: string | null;
  category: string;
  status: DeliverableStatus;
  dueDate: string | null;
  deliveredAt: string | null;
  revisionCount: number;
  latestRevisionNotes: string | null;
  clientFeedback: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectDeliverableRevisionDto {
  id: string;
  deliverableId: string;
  revisionNumber: number;
  title: string | null;
  summary: string;
  fileUrl: string | null;
  notes: string | null;
  clientFeedback: string | null;
  status: DeliverableRevisionStatus;
  createdByUserId: string;
  createdAt: string;
}

export interface ClientSupportTicketDto {
  id: string;
  ownerUserId: string;
  projectId: string;
  kind: SupportKind;
  title: string;
  description: string | null;
  priority: ProjectPriority;
  assigneeId: string | null;
  dueDate: string | null;
  status: RequestStatus;
  resolution: string | null;
  resolvedAt: string | null;
  resolvedByUserId: string | null;
  coverage: SupportCoverage;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectTemplateDto {
  id: string;
  ownerUserId: string;
  name: string;
  type: string;
  builtIn: boolean;
  milestones: string[];
  tasks: Array<{ title: string; milestone?: string }>;
  requirements: string[];
  qa: string[];
  handover: string[];
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectAuditEventDto {
  id: string;
  projectId: string;
  ownerUserId: string;
  actorUserId: string;
  eventType: string;
  summary: string;
  details: Record<string, unknown> | null;
  occurredIstDate: string;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Helpers & Safe Parsers
// ---------------------------------------------------------------------------

function parseJsonSafe<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function toProjectDto(
  row: typeof crmProjects.$inferSelect,
  tasks: Array<{ status: string }> = [],
): ProjectDto {
  const memberIds = parseJsonSafe<string[]>(row.memberIdsJson, []);
  const dependencies = parseJsonSafe<ProjectDependency[]>(row.dependenciesJson, []);
  const requirements = parseJsonSafe<CheckItem[]>(row.requirementsJson, []);
  const qa = parseJsonSafe<CheckItem[]>(row.qaJson, []);
  const handover = parseJsonSafe<CheckItem[]>(row.handoverJson, []);
  const links = parseJsonSafe<ProjectLink[]>(row.linksJson, []);
  const delivery = parseJsonSafe<ProjectDelivery | null>(row.deliveryJson, null);
  const support = parseJsonSafe<ProjectSupport>(row.supportJson, { included: null });
  const carried = parseJsonSafe<Record<string, unknown>>(row.carriedJson, {});
  const attention = parseJsonSafe<{ reason: string; at: string; ruleId?: string } | null>(
    row.attentionJson,
    null,
  );

  return {
    id: row.id,
    ownerUserId: row.ownerUserId,
    name: row.name,
    clientName: row.clientName,
    company: row.company,
    phone: row.phone,
    email: row.email,
    leadId: row.leadId,
    dealId: row.dealId,
    templateId: row.templateId,
    legacyId: row.legacyId,
    type: row.type,
    scope: row.scope,
    bookingDate: row.bookingDate,
    plannedStart: row.plannedStart,
    actualStart: row.actualStart,
    targetDelivery: row.targetDelivery,
    status: row.status as ProjectStatus,
    stage: row.stage as ProjectStage,
    priority: row.priority as ProjectPriority,
    projectOwnerId: row.projectOwnerId,
    memberIds,
    dependencies,
    requirements,
    qa,
    handover,
    links,
    delivery,
    support,
    carried,
    notes: row.notes,
    reviewFlag: row.reviewFlag,
    attention,
    archived: Boolean(row.archived),
    archivedAt: row.archivedAt,
    version: row.version,
    progress: projectProgress(tasks),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toMilestoneDto(row: typeof crmProjectMilestones.$inferSelect): ProjectMilestoneDto {
  return {
    id: row.id,
    ownerUserId: row.ownerUserId,
    projectId: row.projectId,
    title: row.title,
    dueDate: row.dueDate,
    sortOrder: row.sortOrder,
    status: row.status as "open" | "completed",
    completedAt: row.completedAt,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toTaskDto(row: typeof crmProjectTasks.$inferSelect): ProjectTaskDto {
  return {
    id: row.id,
    ownerUserId: row.ownerUserId,
    projectId: row.projectId,
    milestoneId: row.milestoneId,
    title: row.title,
    notes: row.notes,
    assigneeId: row.assigneeId,
    dueDate: row.dueDate,
    priority: row.priority as ProjectPriority,
    status: row.status as "open" | "done",
    completedAt: row.completedAt,
    completedBy: row.completedBy,
    sortOrder: row.sortOrder,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toDeliverableDto(row: typeof crmProjectDeliverables.$inferSelect): ProjectDeliverableDto {
  return {
    id: row.id,
    ownerUserId: row.ownerUserId,
    projectId: row.projectId,
    title: row.title,
    description: row.description,
    category: row.category,
    status: row.status as DeliverableStatus,
    dueDate: row.dueDate,
    deliveredAt: row.deliveredAt,
    revisionCount: row.revisionCount,
    latestRevisionNotes: row.latestRevisionNotes,
    clientFeedback: row.clientFeedback,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toRevisionDto(row: typeof crmProjectDeliverableRevisions.$inferSelect): ProjectDeliverableRevisionDto {
  return {
    id: row.id,
    deliverableId: row.deliverableId,
    revisionNumber: row.revisionNumber,
    title: row.title,
    summary: row.summary,
    fileUrl: row.fileUrl,
    notes: row.notes,
    clientFeedback: row.clientFeedback,
    status: row.status as DeliverableRevisionStatus,
    createdByUserId: row.createdByUserId,
    createdAt: row.createdAt,
  };
}

function toSupportTicketDto(row: typeof crmClientSupportTickets.$inferSelect): ClientSupportTicketDto {
  return {
    id: row.id,
    ownerUserId: row.ownerUserId,
    projectId: row.projectId,
    kind: row.kind as SupportKind,
    title: row.title,
    description: row.description,
    priority: row.priority as ProjectPriority,
    assigneeId: row.assigneeId,
    dueDate: row.dueDate,
    status: row.status as RequestStatus,
    resolution: row.resolution,
    resolvedAt: row.resolvedAt,
    resolvedByUserId: row.resolvedByUserId,
    coverage: row.coverage as SupportCoverage,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toTemplateDto(row: typeof crmProjectTemplates.$inferSelect): ProjectTemplateDto {
  return {
    id: row.id,
    ownerUserId: row.ownerUserId,
    name: row.name,
    type: row.type,
    builtIn: Boolean(row.builtIn),
    milestones: parseJsonSafe<string[]>(row.milestonesJson, []),
    tasks: parseJsonSafe<Array<{ title: string; milestone?: string }>>(row.tasksJson, []),
    requirements: parseJsonSafe<string[]>(row.requirementsJson, []),
    qa: parseJsonSafe<string[]>(row.qaJson, []),
    handover: parseJsonSafe<string[]>(row.handoverJson, []),
    archived: Boolean(row.archived),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toAuditEventDto(row: typeof crmProjectAuditEvents.$inferSelect): ProjectAuditEventDto {
  return {
    id: row.id,
    projectId: row.projectId,
    ownerUserId: row.ownerUserId,
    actorUserId: row.actorUserId,
    eventType: row.eventType,
    summary: row.summary,
    details: parseJsonSafe<Record<string, unknown> | null>(row.detailsJson, null),
    occurredIstDate: row.occurredIstDate,
    createdAt: row.createdAt,
  };
}

async function recordAuditEvent(
  tx: CrmTransaction,
  projectId: string,
  ownerUserId: string,
  actorUserId: string,
  eventType: string,
  summary: string,
  details: Record<string, unknown> | null,
  now = new Date(),
) {
  const ist = toIstParts(now);
  const nowUtc = toMysqlUtcDateTime(now);
  await tx.insert(crmProjectAuditEvents).values({
    id: generateServerId("pae"),
    projectId,
    ownerUserId,
    actorUserId,
    eventType,
    summary,
    detailsJson: details ? JSON.stringify(details) : null,
    occurredIstDate: ist.istDate,
    createdAt: nowUtc,
  });
}

// ---------------------------------------------------------------------------
// Project Service Implementations
// ---------------------------------------------------------------------------

export async function createProjectRecord(
  db: CrmDatabase,
  ownerUserId: string,
  actorUserId: string,
  input: CreateProjectInput,
  options?: { now?: Date },
): Promise<{ status: number; body: { ok: true; project: ProjectDto }; replayed: boolean }> {
  const now = options?.now ?? new Date();
  const ist = toIstParts(now);
  const nowUtc = toMysqlUtcDateTime(now);

  if (looksLikeSecret(input.notes) || looksLikeSecret(input.scope)) {
    throw new CrmServiceError(400, "secret_detected", SECRET_ERROR);
  }

  const validationError = validateProjectFields(input);
  if (validationError) {
    throw new CrmServiceError(400, "validation_error", validationError);
  }

  const executeCreate = async (tx: CrmTransaction): Promise<ProjectDto> => {
    // Cross-tenant verification: if dealId provided, ensure it belongs to owner
    if (input.dealId) {
      const [deal] = await tx
        .select()
        .from(crmDeals)
        .where(and(eq(crmDeals.id, input.dealId), eq(crmDeals.ownerUserId, ownerUserId)));
      if (!deal) {
        throw new CrmServiceError(404, "deal_not_found", "Linked deal was not found or belongs to another account.");
      }

      // Check for existing active project for this deal unless allowAnother is explicitly set
      const [existing] = await tx
        .select()
        .from(crmProjects)
        .where(
          and(
            eq(crmProjects.ownerUserId, ownerUserId),
            eq(crmProjects.dealId, input.dealId),
            eq(crmProjects.archived, false),
            sql`${crmProjects.status} != 'cancelled'`,
          ),
        );
      if (existing && !input.plan?.allowAnother) {
        throw new CrmServiceError(
          409,
          "project_already_active",
          `“${existing.name}” is already active for this deal.`,
        );
      }
    }

    // Cross-tenant verification: if leadId provided, ensure it belongs to owner
    if (input.leadId) {
      const [lead] = await tx
        .select()
        .from(crmLeads)
        .where(and(eq(crmLeads.id, input.leadId), eq(crmLeads.ownerUserId, ownerUserId)));
      if (!lead) {
        throw new CrmServiceError(404, "lead_not_found", "Linked lead was not found or belongs to another account.");
      }
    }

    // Cross-tenant verification: if templateId provided, ensure it belongs to owner
    let tpl: typeof crmProjectTemplates.$inferSelect | undefined;
    if (input.templateId) {
      const [found] = await tx
        .select()
        .from(crmProjectTemplates)
        .where(and(eq(crmProjectTemplates.id, input.templateId), eq(crmProjectTemplates.ownerUserId, ownerUserId)));
      if (!found) {
        throw new CrmServiceError(404, "template_not_found", "Project template not found.");
      }
      tpl = found;
    }

    const tplReqStrings = tpl ? parseJsonSafe<string[]>(tpl.requirementsJson, []) : [];
    const tplQaStrings = tpl ? parseJsonSafe<string[]>(tpl.qaJson, []) : [];
    const tplHoStrings = tpl ? parseJsonSafe<string[]>(tpl.handoverJson, []) : [];

    const defaultReqs: CheckItem[] = [
      { id: "rq1", label: "Logo received", done: false },
      { id: "rq2", label: "Brand colours confirmed", done: false },
      { id: "rq3", label: "Website copy received", done: false },
    ];
    const defaultDeps: ProjectDependency[] = [
      { id: "dep1", label: "Client DNS / Domain access delegation", done: false },
    ];
    const defaultQa: CheckItem[] = [
      { id: "qa1", label: "Tested on desktop", done: false },
      { id: "qa2", label: "Mobile responsiveness tested", done: false },
      { id: "qa3", label: "Forms tested", done: false },
    ];
    const defaultHo: CheckItem[] = [
      { id: "ho1", label: "Client approval received", done: false },
      { id: "ho2", label: "Handover completed", done: false },
    ];
    const defaultLinks: ProjectLink[] = [
      { id: "lnk1", label: "Figma File", url: "https://figma.com/file/apexinnovations-3d", addedAt: ist.istDate },
    ];

    const initialReqs = (input.requirements && input.requirements.length > 0)
      ? input.requirements
      : tplReqStrings.length
        ? tplReqStrings.map((l, idx) => ({ id: `rq${idx + 1}`, label: l, done: false }))
        : defaultReqs;

    const initialDeps = (input.dependencies && input.dependencies.length > 0)
      ? input.dependencies
      : defaultDeps;

    const initialQa = (input.qa && input.qa.length > 0)
      ? input.qa
      : tplQaStrings.length
        ? tplQaStrings.map((l, idx) => ({ id: `qa${idx + 1}`, label: l, done: false }))
        : defaultQa;

    const initialHo = (input.handover && input.handover.length > 0)
      ? input.handover
      : tplHoStrings.length
        ? tplHoStrings.map((l, idx) => ({ id: `ho${idx + 1}`, label: l, done: false }))
        : defaultHo;

    const initialLinks = (input.links && input.links.length > 0)
      ? input.links
      : defaultLinks;

    const projectId = generateServerId("prj");
    const sideEffects = applyStatusSideEffects(
      { actualStart: input.actualStart, bookingDate: input.bookingDate },
      input.status,
      ist.istDate,
    );

    const actualStart = sideEffects.actualStart ?? input.actualStart ?? null;
    const bookingDate = sideEffects.bookingDate ?? input.bookingDate ?? null;

    await tx.insert(crmProjects).values({
      id: projectId,
      ownerUserId,
      name: input.name,
      clientName: input.clientName,
      company: input.company ?? null,
      phone: input.phone ?? null,
      email: input.email ?? null,
      leadId: input.leadId ?? null,
      dealId: input.dealId ?? null,
      templateId: input.templateId ?? null,
      legacyId: input.legacyId ?? null,
      type: input.type,
      scope: input.scope ?? null,
      bookingDate,
      plannedStart: input.plannedStart ?? null,
      actualStart,
      targetDelivery: input.targetDelivery ?? null,
      status: input.status,
      stage: input.stage,
      priority: input.priority,
      projectOwnerId: input.projectOwnerId ?? "owner",
      memberIdsJson: JSON.stringify(input.memberIds ?? []),
      dependenciesJson: JSON.stringify(initialDeps),
      requirementsJson: JSON.stringify(initialReqs),
      qaJson: JSON.stringify(initialQa),
      handoverJson: JSON.stringify(initialHo),
      linksJson: JSON.stringify(initialLinks),
      deliveryJson: null,
      supportJson: JSON.stringify(input.support ?? { included: null }),
      carriedJson: JSON.stringify(input.carried ?? {}),
      notes: input.notes ?? null,
      reviewFlag: null,
      attentionJson: null,
      archived: false,
      archivedAt: null,
      idempotencyKey: input.idempotencyKey ?? null,
      version: 1,
      createdAt: nowUtc,
      updatedAt: nowUtc,
    });

    // Create plan milestones if supplied
    const milestoneMap = new Map<string, string>();
    if (input.plan?.milestones?.length) {
      for (let i = 0; i < input.plan.milestones.length; i++) {
        const title = input.plan.milestones[i]!.trim();
        if (!title) continue;
        const msId = generateServerId("ms");
        milestoneMap.set(title, msId);
        await tx.insert(crmProjectMilestones).values({
          id: msId,
          ownerUserId,
          projectId,
          title,
          sortOrder: i,
          status: "open",
          version: 1,
          createdAt: nowUtc,
          updatedAt: nowUtc,
        });
      }
    }

    // Create plan tasks if supplied
    const createdTasks: Array<{ status: string }> = [];
    if (input.plan?.tasks?.length) {
      for (let i = 0; i < input.plan.tasks.length; i++) {
        const t = input.plan.tasks[i]!;
        const title = t.title.trim();
        if (!title) continue;
        const milestoneId = t.milestone ? milestoneMap.get(t.milestone) ?? null : null;
        await tx.insert(crmProjectTasks).values({
          id: generateServerId("task"),
          ownerUserId,
          projectId,
          milestoneId,
          title,
          notes: null,
          assigneeId: null,
          priority: "normal",
          status: "open",
          sortOrder: i,
          version: 1,
          createdAt: nowUtc,
          updatedAt: nowUtc,
        });
        createdTasks.push({ status: "open" });
      }
    }

    await recordAuditEvent(
      tx,
      projectId,
      ownerUserId,
      actorUserId,
      "project.created",
      `Project created${input.dealId ? " from deal" : ""} · Status: ${input.status}`,
      { name: input.name, status: input.status, stage: input.stage },
      now,
    );

    const [created] = await tx.select().from(crmProjects).where(eq(crmProjects.id, projectId));
    return toProjectDto(created!, createdTasks);
  };

  if (input.idempotencyKey) {
    const scope = "project:create";
    const requestHash = hashIdempotentRequest(scope, input);
    return runWithIdempotency<{ ok: true; project: ProjectDto }>(
      db,
      {
        ownerUserId,
        scope,
        idemKey: input.idempotencyKey,
        requestHash,
        now,
      },
      async (tx) => {
        const project = await executeCreate(tx);
        return { status: 201, body: { ok: true, project }, resourceId: project.id };
      },
    );
  }

  const project = await db.transaction(executeCreate);
  return { status: 201, body: { ok: true, project }, replayed: false };
}

export async function listProjectsRecords(
  db: CrmDatabase,
  ownerUserId: string,
  query: ListProjectsQuery,
): Promise<{ items: ProjectDto[]; total: number; limit: number; offset: number }> {
  const limit = Math.min(Math.max(query.limit ?? 50, 1), 200);
  const offset = Math.max(query.offset ?? 0, 0);

  const conditions = [eq(crmProjects.ownerUserId, ownerUserId)];

  if (query.archived !== undefined) {
    conditions.push(eq(crmProjects.archived, query.archived));
  }
  if (query.stage && query.stage !== "all") {
    conditions.push(eq(crmProjects.stage, query.stage));
  }
  if (query.status && query.status !== "all") {
    conditions.push(eq(crmProjects.status, query.status));
  }
  if (query.priority && query.priority !== "all") {
    conditions.push(eq(crmProjects.priority, query.priority));
  }
  if (query.type && query.type !== "all") {
    conditions.push(eq(crmProjects.type, query.type));
  }
  if (query.leadId) {
    conditions.push(eq(crmProjects.leadId, query.leadId));
  }
  if (query.dealId) {
    conditions.push(eq(crmProjects.dealId, query.dealId));
  }
  if (query.q) {
    const searchPattern = `%${query.q.trim()}%`;
    conditions.push(
      or(
        like(crmProjects.name, searchPattern),
        like(crmProjects.clientName, searchPattern),
        like(crmProjects.company, searchPattern),
      )!,
    );
  }

  const whereClause = and(...conditions);

  let orderByClause = desc(crmProjects.createdAt);
  if (query.sort === "due") {
    orderByClause = sql`CASE WHEN ${crmProjects.targetDelivery} IS NULL THEN 1 ELSE 0 END, ${crmProjects.targetDelivery} ASC`;
  } else if (query.sort === "start") {
    orderByClause = sql`CASE WHEN ${crmProjects.plannedStart} IS NULL THEN 1 ELSE 0 END, ${crmProjects.plannedStart} ASC`;
  }

  const [countRes] = await db
    .select({ count: sql<number>`count(*)` })
    .from(crmProjects)
    .where(whereClause);
  const total = Number(countRes?.count ?? 0);

  const rows = await db
    .select()
    .from(crmProjects)
    .where(whereClause)
    .orderBy(orderByClause)
    .limit(limit)
    .offset(offset);

  // Fetch tasks for progress calculation
  const projectIds = rows.map((r) => r.id);
  const tasks = projectIds.length
    ? await db
        .select({ projectId: crmProjectTasks.projectId, status: crmProjectTasks.status })
        .from(crmProjectTasks)
        .where(
          and(
            eq(crmProjectTasks.ownerUserId, ownerUserId),
            inArray(crmProjectTasks.projectId, projectIds),
          ),
        )
    : [];

  const tasksByProjectId = new Map<string, Array<{ status: string }>>();
  for (const t of tasks) {
    const list = tasksByProjectId.get(t.projectId) ?? [];
    list.push(t);
    tasksByProjectId.set(t.projectId, list);
  }

  return {
    items: rows.map((r) => toProjectDto(r, tasksByProjectId.get(r.id) ?? [])),
    total,
    limit,
    offset,
  };
}

export async function getProjectDetailsRecord(
  db: CrmDatabase,
  ownerUserId: string,
  projectId: string,
): Promise<{
  project: ProjectDto;
  milestones: ProjectMilestoneDto[];
  tasks: ProjectTaskDto[];
  deliverables: ProjectDeliverableDto[];
  supportTickets: ClientSupportTicketDto[];
  recentAuditEvents: ProjectAuditEventDto[];
} | null> {
  const [projectRow] = await db
    .select()
    .from(crmProjects)
    .where(and(eq(crmProjects.id, projectId), eq(crmProjects.ownerUserId, ownerUserId)));

  if (!projectRow) return null;

  const milestones = await db
    .select()
    .from(crmProjectMilestones)
    .where(eq(crmProjectMilestones.projectId, projectId))
    .orderBy(crmProjectMilestones.sortOrder);

  const tasks = await db
    .select()
    .from(crmProjectTasks)
    .where(eq(crmProjectTasks.projectId, projectId))
    .orderBy(crmProjectTasks.sortOrder);

  const deliverables = await db
    .select()
    .from(crmProjectDeliverables)
    .where(eq(crmProjectDeliverables.projectId, projectId))
    .orderBy(desc(crmProjectDeliverables.createdAt));

  const supportTickets = await db
    .select()
    .from(crmClientSupportTickets)
    .where(eq(crmClientSupportTickets.projectId, projectId))
    .orderBy(desc(crmClientSupportTickets.createdAt));

  const auditEvents = await db
    .select()
    .from(crmProjectAuditEvents)
    .where(eq(crmProjectAuditEvents.projectId, projectId))
    .orderBy(desc(crmProjectAuditEvents.createdAt))
    .limit(50);

  return {
    project: toProjectDto(projectRow, tasks),
    milestones: milestones.map(toMilestoneDto),
    tasks: tasks.map(toTaskDto),
    deliverables: deliverables.map(toDeliverableDto),
    supportTickets: supportTickets.map(toSupportTicketDto),
    recentAuditEvents: auditEvents.map(toAuditEventDto),
  };
}

export async function updateProjectRecord(
  db: CrmDatabase,
  ownerUserId: string,
  actorUserId: string,
  projectId: string,
  input: UpdateProjectInput,
  options?: { now?: Date },
): Promise<ProjectDto> {
  const now = options?.now ?? new Date();
  const nowUtc = toMysqlUtcDateTime(now);

  return db.transaction(async (tx) => {
    const [project] = await tx
      .select()
      .from(crmProjects)
      .where(and(eq(crmProjects.id, projectId), eq(crmProjects.ownerUserId, ownerUserId)));

    if (!project) {
      throw new CrmServiceError(404, "project_not_found", "Project not found.");
    }

    if (input.expectedVersion !== undefined && project.version !== input.expectedVersion) {
      throw new CrmServiceError(
        409,
        "stale_conflict",
        `Project was updated in another session (current version: ${project.version}, expected: ${input.expectedVersion}).`,
      );
    }

    const nextPlannedStart = input.plannedStart !== undefined ? input.plannedStart : project.plannedStart;
    const nextTargetDelivery = input.targetDelivery !== undefined ? input.targetDelivery : project.targetDelivery;
    const nextScope = input.scope !== undefined ? input.scope : project.scope;
    const nextNotes = input.notes !== undefined ? input.notes : project.notes;

    if (nextPlannedStart && nextTargetDelivery && nextTargetDelivery < nextPlannedStart) {
      throw new CrmServiceError(400, "invalid_dates", "Target delivery can't be before the planned start.");
    }
    if (looksLikeSecret(nextNotes) || looksLikeSecret(nextScope)) {
      throw new CrmServiceError(400, "secret_detected", SECRET_ERROR);
    }

    const updates: Partial<typeof crmProjects.$inferInsert> = {
      version: project.version + 1,
      updatedAt: nowUtc,
    };

    if (input.name !== undefined) updates.name = input.name;
    if (input.scope !== undefined) updates.scope = input.scope;
    if (input.bookingDate !== undefined) updates.bookingDate = input.bookingDate;
    if (input.plannedStart !== undefined) updates.plannedStart = input.plannedStart;
    if (input.actualStart !== undefined) updates.actualStart = input.actualStart;
    if (input.targetDelivery !== undefined) updates.targetDelivery = input.targetDelivery;
    if (input.priority !== undefined) updates.priority = input.priority;
    if (input.projectOwnerId !== undefined) updates.projectOwnerId = input.projectOwnerId;
    if (input.memberIds !== undefined) updates.memberIdsJson = JSON.stringify(input.memberIds);
    if (input.notes !== undefined) updates.notes = input.notes;

    await tx.update(crmProjects).set(updates).where(eq(crmProjects.id, projectId));

    await recordAuditEvent(
      tx,
      projectId,
      ownerUserId,
      actorUserId,
      "project.updated",
      input.changeNote ?? "Project details edited",
      { updates, expectedVersion: input.expectedVersion },
      now,
    );

    const [updated] = await tx.select().from(crmProjects).where(eq(crmProjects.id, projectId));
    return toProjectDto(updated!);
  });
}

export async function setProjectStatusRecord(
  db: CrmDatabase,
  ownerUserId: string,
  actorUserId: string,
  projectId: string,
  input: SetProjectStatusInput,
  options?: { now?: Date },
): Promise<ProjectDto> {
  const now = options?.now ?? new Date();
  const ist = toIstParts(now);
  const nowUtc = toMysqlUtcDateTime(now);

  return db.transaction(async (tx) => {
    const [project] = await tx
      .select()
      .from(crmProjects)
      .where(and(eq(crmProjects.id, projectId), eq(crmProjects.ownerUserId, ownerUserId)));

    if (!project) throw new CrmServiceError(404, "project_not_found", "Project not found.");

    if (input.expectedVersion !== undefined && project.version !== input.expectedVersion) {
      throw new CrmServiceError(
        409,
        "stale_conflict",
        `Project status was updated elsewhere (current version: ${project.version}, expected: ${input.expectedVersion}).`,
      );
    }

    if (project.status === input.status) {
      return toProjectDto(project);
    }

    const sideEffects = applyStatusSideEffects(
      { actualStart: project.actualStart, bookingDate: project.bookingDate },
      input.status,
      ist.istDate,
    );

    const updates: Partial<typeof crmProjects.$inferInsert> = {
      status: input.status,
      version: project.version + 1,
      updatedAt: nowUtc,
      ...(sideEffects.actualStart ? { actualStart: sideEffects.actualStart } : {}),
      ...(sideEffects.bookingDate ? { bookingDate: sideEffects.bookingDate } : {}),
    };

    await tx.update(crmProjects).set(updates).where(eq(crmProjects.id, projectId));

    await recordAuditEvent(
      tx,
      projectId,
      ownerUserId,
      actorUserId,
      "project.status_changed",
      `Status changed: ${project.status} → ${input.status}`,
      { from: project.status, to: input.status },
      now,
    );

    const [updated] = await tx.select().from(crmProjects).where(eq(crmProjects.id, projectId));
    return toProjectDto(updated!);
  });
}

export async function moveProjectStageRecord(
  db: CrmDatabase,
  ownerUserId: string,
  actorUserId: string,
  projectId: string,
  input: MoveProjectStageInput,
  options?: { now?: Date },
): Promise<{ project: ProjectDto; from: ProjectStage }> {
  const now = options?.now ?? new Date();
  const nowUtc = toMysqlUtcDateTime(now);

  return db.transaction(async (tx) => {
    const [project] = await tx
      .select()
      .from(crmProjects)
      .where(and(eq(crmProjects.id, projectId), eq(crmProjects.ownerUserId, ownerUserId)));

    if (!project) throw new CrmServiceError(404, "project_not_found", "Project not found.");

    if (input.expectedVersion !== undefined && project.version !== input.expectedVersion) {
      throw new CrmServiceError(
        409,
        "stale_conflict",
        `Project was moved in another session (current version: ${project.version}, expected: ${input.expectedVersion}).`,
      );
    }

    if (input.from !== undefined && project.stage !== input.from) {
      throw new CrmServiceError(
        409,
        "stale_conflict",
        `Project stage changed in another session (current stage: ${project.stage}, seen: ${input.from}).`,
      );
    }

    if (project.stage === input.stage) {
      return { project: toProjectDto(project), from: project.stage as ProjectStage };
    }

    // Delivery gate: delivery must be recorded via deliverProject, never directly dragged
    if (input.stage === "delivered" && !project.deliveryJson) {
      throw new CrmServiceError(
        400,
        "delivery_unrecorded",
        "Record delivery from the Delivery & support tab before setting stage to delivered.",
      );
    }

    const previousStage = project.stage as ProjectStage;

    await tx
      .update(crmProjects)
      .set({
        stage: input.stage,
        version: project.version + 1,
        updatedAt: nowUtc,
      })
      .where(eq(crmProjects.id, projectId));

    await recordAuditEvent(
      tx,
      projectId,
      ownerUserId,
      actorUserId,
      "project.stage_moved",
      `Stage: ${previousStage} → ${input.stage}`,
      { from: previousStage, to: input.stage },
      now,
    );

    const [updated] = await tx.select().from(crmProjects).where(eq(crmProjects.id, projectId));
    return { project: toProjectDto(updated!), from: previousStage };
  });
}

export async function undoProjectStageRecord(
  db: CrmDatabase,
  ownerUserId: string,
  actorUserId: string,
  projectId: string,
  input: UndoProjectStageInput,
  options?: { now?: Date },
): Promise<ProjectDto> {
  const now = options?.now ?? new Date();
  const nowUtc = toMysqlUtcDateTime(now);

  return db.transaction(async (tx) => {
    const [project] = await tx
      .select()
      .from(crmProjects)
      .where(and(eq(crmProjects.id, projectId), eq(crmProjects.ownerUserId, ownerUserId)));

    if (!project) throw new CrmServiceError(404, "project_not_found", "Project not found.");

    if (project.version !== input.expectedVersion) {
      throw new CrmServiceError(
        409,
        "stale_conflict",
        `Cannot undo: project was modified since (version: ${project.version}, expected: ${input.expectedVersion}).`,
      );
    }

    await tx
      .update(crmProjects)
      .set({
        stage: input.to,
        version: project.version + 1,
        updatedAt: nowUtc,
      })
      .where(eq(crmProjects.id, projectId));

    await recordAuditEvent(
      tx,
      projectId,
      ownerUserId,
      actorUserId,
      "project.stage_undone",
      `Undo: stage back to ${input.to}`,
      { to: input.to, expectedVersion: input.expectedVersion },
      now,
    );

    const [updated] = await tx.select().from(crmProjects).where(eq(crmProjects.id, projectId));
    return toProjectDto(updated!);
  });
}

export async function deliverProjectRecord(
  db: CrmDatabase,
  ownerUserId: string,
  actorUserId: string,
  projectId: string,
  input: DeliverProjectInput,
  options?: { now?: Date },
): Promise<ProjectDto> {
  const now = options?.now ?? new Date();
  const nowUtc = toMysqlUtcDateTime(now);

  return db.transaction(async (tx) => {
    const [project] = await tx
      .select()
      .from(crmProjects)
      .where(and(eq(crmProjects.id, projectId), eq(crmProjects.ownerUserId, ownerUserId)));

    if (!project) throw new CrmServiceError(404, "project_not_found", "Project not found.");

    if (project.deliveryJson) {
      throw new CrmServiceError(400, "already_delivered", "Delivery is already recorded for this project.");
    }

    if (input.expectedVersion !== undefined && project.version !== input.expectedVersion) {
      throw new CrmServiceError(
        409,
        "stale_conflict",
        `Project was updated in another session (current version: ${project.version}, expected: ${input.expectedVersion}).`,
      );
    }

    const qa = parseJsonSafe<CheckItem[]>(project.qaJson, []);
    const handover = parseJsonSafe<CheckItem[]>(project.handoverJson, []);
    const err = deliveryError({ qa, handover, status: project.status }, input);
    if (err) {
      throw new CrmServiceError(400, "delivery_error", err);
    }

    const gaps = deliveryGaps({ qa, handover });
    const deliveryRecord: ProjectDelivery = {
      date: input.date,
      url: input.url ?? undefined,
      notes: input.notes ?? undefined,
      deliveredBy: actorUserId,
      approval: input.approval,
      override: gaps.length ? input.override : undefined,
      incomplete: gaps,
    };

    await tx
      .update(crmProjects)
      .set({
        deliveryJson: JSON.stringify(deliveryRecord),
        stage: "delivered",
        status: "completed",
        version: project.version + 1,
        updatedAt: nowUtc,
      })
      .where(eq(crmProjects.id, projectId));

    const auditSummary = gaps.length
      ? `Delivered with ${gaps.length} incomplete checklist item(s). Reason: ${input.override}`
      : "Delivered — all checklist items complete";

    await recordAuditEvent(
      tx,
      projectId,
      ownerUserId,
      actorUserId,
      "project.delivered",
      auditSummary,
      { delivery: deliveryRecord, gaps },
      now,
    );

    const [updated] = await tx.select().from(crmProjects).where(eq(crmProjects.id, projectId));
    return toProjectDto(updated!);
  });
}

export async function configureProjectSupportRecord(
  db: CrmDatabase,
  ownerUserId: string,
  actorUserId: string,
  projectId: string,
  input: {
    included: boolean | null;
    months?: number | undefined;
    start?: string | undefined;
    end?: string | undefined;
    description?: string | undefined;
    expectedVersion?: number | undefined;
  },
  options?: { now?: Date },
): Promise<ProjectDto> {
  const now = options?.now ?? new Date();
  const nowUtc = toMysqlUtcDateTime(now);

  return db.transaction(async (tx) => {
    const [project] = await tx
      .select()
      .from(crmProjects)
      .where(and(eq(crmProjects.id, projectId), eq(crmProjects.ownerUserId, ownerUserId)));

    if (!project) throw new CrmServiceError(404, "project_not_found", "Project not found.");

    if (input.expectedVersion !== undefined && project.version !== input.expectedVersion) {
      throw new CrmServiceError(
        409,
        "stale_conflict",
        `Project support was updated elsewhere (current version: ${project.version}, expected: ${input.expectedVersion}).`,
      );
    }

    const supportConfig: ProjectSupport = {
      included: input.included,
      months: input.months,
      start: input.start,
      end: input.end,
      description: input.description,
    };

    const err = supportError(supportConfig);
    if (err) throw new CrmServiceError(400, "support_error", err);

    let nextStage = project.stage;
    if (input.included === true && project.deliveryJson) {
      nextStage = "support";
    }

    await tx
      .update(crmProjects)
      .set({
        supportJson: JSON.stringify(supportConfig),
        stage: nextStage,
        version: project.version + 1,
        updatedAt: nowUtc,
      })
      .where(eq(crmProjects.id, projectId));

    const auditSummary =
      input.included === true
        ? `Support configured: ${input.start}${input.end ? ` → ${input.end}` : ""}`
        : input.included === false
          ? "Support marked not included"
          : "Support cleared";

    await recordAuditEvent(
      tx,
      projectId,
      ownerUserId,
      actorUserId,
      "project.support_configured",
      auditSummary,
      { support: supportConfig },
      now,
    );

    const [updated] = await tx.select().from(crmProjects).where(eq(crmProjects.id, projectId));
    return toProjectDto(updated!);
  });
}

export async function archiveProjectRecord(
  db: CrmDatabase,
  ownerUserId: string,
  actorUserId: string,
  projectId: string,
  input: { archived: boolean; expectedVersion?: number | undefined },
  options?: { now?: Date },
): Promise<{ project: ProjectDto; changed: boolean }> {
  const now = options?.now ?? new Date();
  const nowUtc = toMysqlUtcDateTime(now);

  return db.transaction(async (tx) => {
    const [project] = await tx
      .select()
      .from(crmProjects)
      .where(and(eq(crmProjects.id, projectId), eq(crmProjects.ownerUserId, ownerUserId)));

    if (!project) throw new CrmServiceError(404, "project_not_found", "Project not found.");

    if (input.expectedVersion !== undefined && project.version !== input.expectedVersion) {
      throw new CrmServiceError(
        409,
        "stale_conflict",
        `Project archive state was changed elsewhere (version: ${project.version}, expected: ${input.expectedVersion}).`,
      );
    }

    if (Boolean(project.archived) === input.archived) {
      return { project: toProjectDto(project), changed: false };
    }

    await tx
      .update(crmProjects)
      .set({
        archived: input.archived,
        archivedAt: input.archived ? nowUtc : null,
        version: project.version + 1,
        updatedAt: nowUtc,
      })
      .where(eq(crmProjects.id, projectId));

    await recordAuditEvent(
      tx,
      projectId,
      ownerUserId,
      actorUserId,
      input.archived ? "project.archived" : "project.restored",
      input.archived ? "Archived (records kept)" : "Restored from archive",
      { archived: input.archived },
      now,
    );

    const [updated] = await tx.select().from(crmProjects).where(eq(crmProjects.id, projectId));
    return { project: toProjectDto(updated!), changed: true };
  });
}

export async function addProjectNoteRecord(
  db: CrmDatabase,
  ownerUserId: string,
  actorUserId: string,
  projectId: string,
  text: string,
  options?: { now?: Date },
): Promise<ProjectAuditEventDto> {
  const now = options?.now ?? new Date();
  const trimmed = text.trim();
  if (!trimmed) throw new CrmServiceError(400, "empty_note", "Write a note.");
  if (looksLikeSecret(trimmed)) throw new CrmServiceError(400, "secret_detected", SECRET_ERROR);

  return db.transaction(async (tx) => {
    const [project] = await tx
      .select()
      .from(crmProjects)
      .where(and(eq(crmProjects.id, projectId), eq(crmProjects.ownerUserId, ownerUserId)));

    if (!project) throw new CrmServiceError(404, "project_not_found", "Project not found.");

    const eventId = generateServerId("pae");
    const ist = toIstParts(now);
    const nowUtc = toMysqlUtcDateTime(now);

    await tx.insert(crmProjectAuditEvents).values({
      id: eventId,
      projectId,
      ownerUserId,
      actorUserId,
      eventType: "project.note_added",
      summary: `Note: ${trimmed.slice(0, 500)}`,
      detailsJson: JSON.stringify({ note: trimmed }),
      occurredIstDate: ist.istDate,
      createdAt: nowUtc,
    });

    const [created] = await tx.select().from(crmProjectAuditEvents).where(eq(crmProjectAuditEvents.id, eventId));
    return toAuditEventDto(created!);
  });
}

export async function toggleChecklistItemRecord(
  db: CrmDatabase,
  ownerUserId: string,
  actorUserId: string,
  projectId: string,
  list: "requirements" | "qa" | "handover",
  itemId: string,
  expectedVersion?: number,
  options?: { now?: Date },
): Promise<ProjectDto> {
  const now = options?.now ?? new Date();
  const nowUtc = toMysqlUtcDateTime(now);

  return db.transaction(async (tx) => {
    const [project] = await tx
      .select()
      .from(crmProjects)
      .where(and(eq(crmProjects.id, projectId), eq(crmProjects.ownerUserId, ownerUserId)));

    if (!project) throw new CrmServiceError(404, "project_not_found", "Project not found.");

    if (expectedVersion !== undefined && project.version !== expectedVersion) {
      throw new CrmServiceError(
        409,
        "stale_conflict",
        `Project was updated in another session (version: ${project.version}, expected: ${expectedVersion}).`,
      );
    }

    const colName = list === "requirements" ? "requirementsJson" : list === "qa" ? "qaJson" : "handoverJson";
    const items = parseJsonSafe<CheckItem[]>(project[colName], []);
    const item = items.find((i) => i.id === itemId);
    if (!item) throw new CrmServiceError(404, "item_not_found", `Item ${itemId} not found in ${list}.`);

    const nextDone = !item.done;
    const nextItems = items.map((i) =>
      i.id === itemId ? { ...i, done: nextDone, doneAt: nextDone ? nowUtc : undefined } : i,
    );

    await tx
      .update(crmProjects)
      .set({
        [colName]: JSON.stringify(nextItems),
        version: project.version + 1,
        updatedAt: nowUtc,
      })
      .where(eq(crmProjects.id, projectId));

    await recordAuditEvent(
      tx,
      projectId,
      ownerUserId,
      actorUserId,
      "checklist.toggled",
      `${nextDone ? "Checked" : "Unchecked"}: ${item.label}`,
      { list, itemId, done: nextDone },
      now,
    );

    const [updated] = await tx.select().from(crmProjects).where(eq(crmProjects.id, projectId));
    return toProjectDto(updated!);
  });
}

export async function toggleDependencyItemRecord(
  db: CrmDatabase,
  ownerUserId: string,
  actorUserId: string,
  projectId: string,
  depId: string,
  expectedVersion?: number,
  options?: { now?: Date },
): Promise<ProjectDto> {
  const now = options?.now ?? new Date();
  const nowUtc = toMysqlUtcDateTime(now);

  return db.transaction(async (tx) => {
    const [project] = await tx
      .select()
      .from(crmProjects)
      .where(and(eq(crmProjects.id, projectId), eq(crmProjects.ownerUserId, ownerUserId)));

    if (!project) throw new CrmServiceError(404, "project_not_found", "Project not found.");

    if (expectedVersion !== undefined && project.version !== expectedVersion) {
      throw new CrmServiceError(
        409,
        "stale_conflict",
        `Project was updated in another session (version: ${project.version}, expected: ${expectedVersion}).`,
      );
    }

    const items = parseJsonSafe<ProjectDependency[]>(project.dependenciesJson, []);
    const item = items.find((i) => i.id === depId);
    if (!item) throw new CrmServiceError(404, "dependency_not_found", `Dependency ${depId} not found.`);

    const nextDone = !item.done;
    const nextItems = items.map((i) =>
      i.id === depId ? { ...i, done: nextDone, doneAt: nextDone ? nowUtc : undefined } : i,
    );

    await tx
      .update(crmProjects)
      .set({
        dependenciesJson: JSON.stringify(nextItems),
        version: project.version + 1,
        updatedAt: nowUtc,
      })
      .where(eq(crmProjects.id, projectId));

    await recordAuditEvent(
      tx,
      projectId,
      ownerUserId,
      actorUserId,
      "dependency.toggled",
      `${nextDone ? "Received" : "Reopened"}: ${item.label}`,
      { depId, done: nextDone },
      now,
    );

    const [updated] = await tx.select().from(crmProjects).where(eq(crmProjects.id, projectId));
    return toProjectDto(updated!);
  });
}

// ---------------------------------------------------------------------------
// Milestones Service
// ---------------------------------------------------------------------------

export async function createMilestoneRecord(
  db: CrmDatabase,
  ownerUserId: string,
  actorUserId: string,
  projectId: string,
  input: CreateMilestoneInput,
  options?: { now?: Date },
): Promise<ProjectMilestoneDto> {
  const now = options?.now ?? new Date();
  const nowUtc = toMysqlUtcDateTime(now);

  return db.transaction(async (tx) => {
    const [project] = await tx
      .select()
      .from(crmProjects)
      .where(and(eq(crmProjects.id, projectId), eq(crmProjects.ownerUserId, ownerUserId)));

    if (!project) throw new CrmServiceError(404, "project_not_found", "Project not found.");

    const [countRow] = await tx
      .select({ count: sql<number>`count(*)` })
      .from(crmProjectMilestones)
      .where(eq(crmProjectMilestones.projectId, projectId));
    const sortOrder = input.sortOrder ?? Number(countRow?.count ?? 0);

    const milestoneId = generateServerId("ms");
    await tx.insert(crmProjectMilestones).values({
      id: milestoneId,
      ownerUserId,
      projectId,
      title: input.title.trim(),
      dueDate: input.dueDate ?? null,
      sortOrder,
      status: "open",
      version: 1,
      createdAt: nowUtc,
      updatedAt: nowUtc,
    });

    await recordAuditEvent(
      tx,
      projectId,
      ownerUserId,
      actorUserId,
      "milestone.created",
      `Milestone added: “${input.title.trim()}”`,
      { milestoneId, title: input.title.trim(), dueDate: input.dueDate },
      now,
    );

    const [created] = await tx.select().from(crmProjectMilestones).where(eq(crmProjectMilestones.id, milestoneId));
    return toMilestoneDto(created!);
  });
}

export async function updateMilestoneRecord(
  db: CrmDatabase,
  ownerUserId: string,
  actorUserId: string,
  milestoneId: string,
  input: UpdateMilestoneInput,
  options?: { now?: Date },
): Promise<ProjectMilestoneDto> {
  const now = options?.now ?? new Date();
  const nowUtc = toMysqlUtcDateTime(now);

  return db.transaction(async (tx) => {
    const [ms] = await tx
      .select()
      .from(crmProjectMilestones)
      .where(and(eq(crmProjectMilestones.id, milestoneId), eq(crmProjectMilestones.ownerUserId, ownerUserId)));

    if (!ms) throw new CrmServiceError(404, "milestone_not_found", "Milestone not found.");

    if (input.expectedVersion !== undefined && ms.version !== input.expectedVersion) {
      throw new CrmServiceError(
        409,
        "stale_conflict",
        `Milestone was updated elsewhere (version: ${ms.version}, expected: ${input.expectedVersion}).`,
      );
    }

    const updates: Partial<typeof crmProjectMilestones.$inferInsert> = {
      version: ms.version + 1,
      updatedAt: nowUtc,
    };

    if (input.title !== undefined) updates.title = input.title.trim();
    if (input.dueDate !== undefined) updates.dueDate = input.dueDate;
    if (input.sortOrder !== undefined) updates.sortOrder = input.sortOrder;
    if (input.status !== undefined) {
      updates.status = input.status;
      if (input.status === "completed" && ms.status !== "completed") {
        updates.completedAt = nowUtc;
      } else if (input.status === "open") {
        updates.completedAt = null;
      }
    }

    await tx.update(crmProjectMilestones).set(updates).where(eq(crmProjectMilestones.id, milestoneId));

    await recordAuditEvent(
      tx,
      ms.projectId,
      ownerUserId,
      actorUserId,
      "milestone.updated",
      `Milestone updated: “${updates.title ?? ms.title}”`,
      { milestoneId, updates },
      now,
    );

    const [updated] = await tx.select().from(crmProjectMilestones).where(eq(crmProjectMilestones.id, milestoneId));
    return toMilestoneDto(updated!);
  });
}

// ---------------------------------------------------------------------------
// Tasks Service
// ---------------------------------------------------------------------------

export async function createTaskRecord(
  db: CrmDatabase,
  ownerUserId: string,
  actorUserId: string,
  projectId: string,
  input: CreateTaskInput,
  options?: { now?: Date },
): Promise<{ status: number; body: { ok: true; task: ProjectTaskDto }; replayed: boolean }> {
  const now = options?.now ?? new Date();
  const nowUtc = toMysqlUtcDateTime(now);

  if (looksLikeSecret(input.notes)) {
    throw new CrmServiceError(400, "secret_detected", SECRET_ERROR);
  }

  const executeCreate = async (tx: CrmTransaction): Promise<ProjectTaskDto> => {
    const [project] = await tx
      .select()
      .from(crmProjects)
      .where(and(eq(crmProjects.id, projectId), eq(crmProjects.ownerUserId, ownerUserId)));

    if (!project) throw new CrmServiceError(404, "project_not_found", "Project not found.");

    if (input.milestoneId) {
      const [ms] = await tx
        .select()
        .from(crmProjectMilestones)
        .where(
          and(
            eq(crmProjectMilestones.id, input.milestoneId),
            eq(crmProjectMilestones.projectId, projectId),
          ),
        );
      if (!ms) throw new CrmServiceError(404, "milestone_not_found", "Milestone not found in this project.");
    }

    const [countRow] = await tx
      .select({ count: sql<number>`count(*)` })
      .from(crmProjectTasks)
      .where(eq(crmProjectTasks.projectId, projectId));
    const sortOrder = input.sortOrder ?? Number(countRow?.count ?? 0);

    const taskId = generateServerId("task");
    await tx.insert(crmProjectTasks).values({
      id: taskId,
      ownerUserId,
      projectId,
      milestoneId: input.milestoneId ?? null,
      title: input.title.trim(),
      notes: input.notes ?? null,
      assigneeId: input.assigneeId ?? null,
      dueDate: input.dueDate ?? null,
      priority: input.priority ?? "normal",
      status: "open",
      sortOrder,
      idempotencyKey: input.idempotencyKey ?? null,
      version: 1,
      createdAt: nowUtc,
      updatedAt: nowUtc,
    });

    await recordAuditEvent(
      tx,
      projectId,
      ownerUserId,
      actorUserId,
      "task.created",
      `Task added: “${input.title.trim()}”`,
      { taskId, title: input.title.trim(), priority: input.priority, milestoneId: input.milestoneId },
      now,
    );

    const [created] = await tx.select().from(crmProjectTasks).where(eq(crmProjectTasks.id, taskId));
    return toTaskDto(created!);
  };

  if (input.idempotencyKey) {
    const scope = "task:create";
    const requestHash = hashIdempotentRequest(scope, { projectId, ...input });
    return runWithIdempotency<{ ok: true; task: ProjectTaskDto }>(
      db,
      {
        ownerUserId,
        scope,
        idemKey: input.idempotencyKey,
        requestHash,
        now,
      },
      async (tx) => {
        const task = await executeCreate(tx);
        return { status: 201, body: { ok: true, task }, resourceId: task.id };
      },
    );
  }

  const task = await db.transaction(executeCreate);
  return { status: 201, body: { ok: true, task }, replayed: false };
}

export async function updateTaskRecord(
  db: CrmDatabase,
  ownerUserId: string,
  actorUserId: string,
  taskId: string,
  input: UpdateTaskInput,
  options?: { now?: Date },
): Promise<ProjectTaskDto> {
  const now = options?.now ?? new Date();
  const nowUtc = toMysqlUtcDateTime(now);

  if (looksLikeSecret(input.notes)) {
    throw new CrmServiceError(400, "secret_detected", SECRET_ERROR);
  }

  return db.transaction(async (tx) => {
    const [task] = await tx
      .select()
      .from(crmProjectTasks)
      .where(and(eq(crmProjectTasks.id, taskId), eq(crmProjectTasks.ownerUserId, ownerUserId)));

    if (!task) throw new CrmServiceError(404, "task_not_found", "Task not found.");

    if (input.expectedVersion !== undefined && task.version !== input.expectedVersion) {
      throw new CrmServiceError(
        409,
        "stale_conflict",
        `Task was updated in another session (current version: ${task.version}, expected: ${input.expectedVersion}).`,
      );
    }

    if (input.milestoneId !== undefined && input.milestoneId !== null) {
      const [ms] = await tx
        .select()
        .from(crmProjectMilestones)
        .where(
          and(
            eq(crmProjectMilestones.id, input.milestoneId),
            eq(crmProjectMilestones.projectId, task.projectId),
          ),
        );
      if (!ms) throw new CrmServiceError(404, "milestone_not_found", "Milestone not found in this project.");
    }

    const updates: Partial<typeof crmProjectTasks.$inferInsert> = {
      version: task.version + 1,
      updatedAt: nowUtc,
    };

    if (input.title !== undefined) updates.title = input.title.trim();
    if (input.milestoneId !== undefined) updates.milestoneId = input.milestoneId;
    if (input.notes !== undefined) updates.notes = input.notes;
    if (input.assigneeId !== undefined) updates.assigneeId = input.assigneeId;
    if (input.dueDate !== undefined) updates.dueDate = input.dueDate;
    if (input.priority !== undefined) updates.priority = input.priority;
    if (input.sortOrder !== undefined) updates.sortOrder = input.sortOrder;

    await tx.update(crmProjectTasks).set(updates).where(eq(crmProjectTasks.id, taskId));

    await recordAuditEvent(
      tx,
      task.projectId,
      ownerUserId,
      actorUserId,
      "task.updated",
      `Task edited: “${updates.title ?? task.title}”`,
      { taskId, updates },
      now,
    );

    const [updated] = await tx.select().from(crmProjectTasks).where(eq(crmProjectTasks.id, taskId));
    return toTaskDto(updated!);
  });
}

export async function setTaskDoneRecord(
  db: CrmDatabase,
  ownerUserId: string,
  actorUserId: string,
  taskId: string,
  done: boolean,
  expectedVersion?: number,
  options?: { now?: Date },
): Promise<ProjectTaskDto> {
  const now = options?.now ?? new Date();
  const nowUtc = toMysqlUtcDateTime(now);

  return db.transaction(async (tx) => {
    const [task] = await tx
      .select()
      .from(crmProjectTasks)
      .where(and(eq(crmProjectTasks.id, taskId), eq(crmProjectTasks.ownerUserId, ownerUserId)));

    if (!task) throw new CrmServiceError(404, "task_not_found", "Task not found.");

    if (expectedVersion !== undefined && task.version !== expectedVersion) {
      throw new CrmServiceError(
        409,
        "stale_conflict",
        `Task status was changed elsewhere (version: ${task.version}, expected: ${expectedVersion}).`,
      );
    }

    if ((task.status === "done") === done) {
      return toTaskDto(task);
    }

    const status = done ? "done" : "open";
    const completedAt = done ? nowUtc : null;
    const completedBy = done ? actorUserId : null;

    await tx
      .update(crmProjectTasks)
      .set({
        status,
        completedAt,
        completedBy,
        version: task.version + 1,
        updatedAt: nowUtc,
      })
      .where(eq(crmProjectTasks.id, taskId));

    await recordAuditEvent(
      tx,
      task.projectId,
      ownerUserId,
      actorUserId,
      done ? "task.completed" : "task.reopened",
      `Task ${done ? "completed" : "reopened"}: “${task.title}”`,
      { taskId, status },
      now,
    );

    const [updated] = await tx.select().from(crmProjectTasks).where(eq(crmProjectTasks.id, taskId));
    return toTaskDto(updated!);
  });
}

// ---------------------------------------------------------------------------
// Deliverables & Revisions Service
// ---------------------------------------------------------------------------

export async function createDeliverableRecord(
  db: CrmDatabase,
  ownerUserId: string,
  actorUserId: string,
  projectId: string,
  input: CreateDeliverableInput,
  options?: { now?: Date },
): Promise<{ status: number; body: { ok: true; deliverable: ProjectDeliverableDto }; replayed: boolean }> {
  const now = options?.now ?? new Date();
  const nowUtc = toMysqlUtcDateTime(now);

  const executeCreate = async (tx: CrmTransaction): Promise<ProjectDeliverableDto> => {
    const [project] = await tx
      .select()
      .from(crmProjects)
      .where(and(eq(crmProjects.id, projectId), eq(crmProjects.ownerUserId, ownerUserId)));

    if (!project) throw new CrmServiceError(404, "project_not_found", "Project not found.");

    const delId = generateServerId("del");
    await tx.insert(crmProjectDeliverables).values({
      id: delId,
      ownerUserId,
      projectId,
      title: input.title.trim(),
      description: input.description ?? null,
      category: input.category ?? "general",
      status: input.status ?? "draft",
      dueDate: input.dueDate ?? null,
      deliveredAt: null,
      revisionCount: 0,
      latestRevisionNotes: null,
      clientFeedback: null,
      version: 1,
      createdAt: nowUtc,
      updatedAt: nowUtc,
    });

    await recordAuditEvent(
      tx,
      projectId,
      ownerUserId,
      actorUserId,
      "deliverable.created",
      `Deliverable created: “${input.title.trim()}”`,
      { deliverableId: delId, title: input.title.trim() },
      now,
    );

    const [created] = await tx.select().from(crmProjectDeliverables).where(eq(crmProjectDeliverables.id, delId));
    return toDeliverableDto(created!);
  };

  if (input.idempotencyKey) {
    const scope = "deliverable:create";
    const requestHash = hashIdempotentRequest(scope, { projectId, ...input });
    return runWithIdempotency<{ ok: true; deliverable: ProjectDeliverableDto }>(
      db,
      {
        ownerUserId,
        scope,
        idemKey: input.idempotencyKey,
        requestHash,
        now,
      },
      async (tx) => {
        const deliverable = await executeCreate(tx);
        return { status: 201, body: { ok: true, deliverable }, resourceId: deliverable.id };
      },
    );
  }

  const deliverable = await db.transaction(executeCreate);
  return { status: 201, body: { ok: true, deliverable }, replayed: false };
}

export async function updateDeliverableRecord(
  db: CrmDatabase,
  ownerUserId: string,
  actorUserId: string,
  deliverableId: string,
  input: UpdateDeliverableInput,
  options?: { now?: Date },
): Promise<ProjectDeliverableDto> {
  const now = options?.now ?? new Date();
  const nowUtc = toMysqlUtcDateTime(now);

  return db.transaction(async (tx) => {
    const [deliv] = await tx
      .select()
      .from(crmProjectDeliverables)
      .where(and(eq(crmProjectDeliverables.id, deliverableId), eq(crmProjectDeliverables.ownerUserId, ownerUserId)));

    if (!deliv) throw new CrmServiceError(404, "deliverable_not_found", "Deliverable not found.");

    if (input.expectedVersion !== undefined && deliv.version !== input.expectedVersion) {
      throw new CrmServiceError(
        409,
        "stale_conflict",
        `Deliverable was updated elsewhere (version: ${deliv.version}, expected: ${input.expectedVersion}).`,
      );
    }

    const updates: Partial<typeof crmProjectDeliverables.$inferInsert> = {
      version: deliv.version + 1,
      updatedAt: nowUtc,
    };

    if (input.title !== undefined) updates.title = input.title.trim();
    if (input.description !== undefined) updates.description = input.description;
    if (input.category !== undefined) updates.category = input.category;
    if (input.status !== undefined) updates.status = input.status;
    if (input.dueDate !== undefined) updates.dueDate = input.dueDate;
    if (input.clientFeedback !== undefined) updates.clientFeedback = input.clientFeedback;

    await tx.update(crmProjectDeliverables).set(updates).where(eq(crmProjectDeliverables.id, deliverableId));

    await recordAuditEvent(
      tx,
      deliv.projectId,
      ownerUserId,
      actorUserId,
      "deliverable.updated",
      `Deliverable updated: “${updates.title ?? deliv.title}”`,
      { deliverableId, updates },
      now,
    );

    const [updated] = await tx
      .select()
      .from(crmProjectDeliverables)
      .where(eq(crmProjectDeliverables.id, deliverableId));
    return toDeliverableDto(updated!);
  });
}

export async function addDeliverableRevisionRecord(
  db: CrmDatabase,
  ownerUserId: string,
  actorUserId: string,
  deliverableId: string,
  input: AddDeliverableRevisionInput,
  options?: { now?: Date },
): Promise<{ revision: ProjectDeliverableRevisionDto; deliverable: ProjectDeliverableDto }> {
  const now = options?.now ?? new Date();
  const nowUtc = toMysqlUtcDateTime(now);

  return db.transaction(async (tx) => {
    const [deliv] = await tx
      .select()
      .from(crmProjectDeliverables)
      .where(and(eq(crmProjectDeliverables.id, deliverableId), eq(crmProjectDeliverables.ownerUserId, ownerUserId)));

    if (!deliv) throw new CrmServiceError(404, "deliverable_not_found", "Deliverable not found.");

    if (input.expectedVersion !== undefined && deliv.version !== input.expectedVersion) {
      throw new CrmServiceError(
        409,
        "stale_conflict",
        `Deliverable was updated elsewhere (version: ${deliv.version}, expected: ${input.expectedVersion}).`,
      );
    }

    const nextRevisionNumber = deliv.revisionCount + 1;
    const revId = generateServerId("rev");

    await tx.insert(crmProjectDeliverableRevisions).values({
      id: revId,
      deliverableId,
      revisionNumber: nextRevisionNumber,
      title: input.title?.trim() ?? null,
      summary: input.summary.trim(),
      fileUrl: input.fileUrl?.trim() ?? null,
      notes: input.notes?.trim() ?? null,
      clientFeedback: input.clientFeedback?.trim() ?? null,
      status: input.status,
      createdByUserId: actorUserId,
      createdAt: nowUtc,
    });

    await tx
      .update(crmProjectDeliverables)
      .set({
        revisionCount: nextRevisionNumber,
        latestRevisionNotes: input.summary.trim(),
        status: input.status === "approved" ? "approved" : "review",
        version: deliv.version + 1,
        updatedAt: nowUtc,
      })
      .where(eq(crmProjectDeliverables.id, deliverableId));

    await recordAuditEvent(
      tx,
      deliv.projectId,
      ownerUserId,
      actorUserId,
      "deliverable.revision_added",
      `Revision #${nextRevisionNumber} added to “${deliv.title}”: ${input.summary.trim()}`,
      { deliverableId, revisionNumber: nextRevisionNumber, summary: input.summary.trim() },
      now,
    );

    const [updatedDeliv] = await tx
      .select()
      .from(crmProjectDeliverables)
      .where(eq(crmProjectDeliverables.id, deliverableId));
    const [createdRev] = await tx
      .select()
      .from(crmProjectDeliverableRevisions)
      .where(eq(crmProjectDeliverableRevisions.id, revId));

    return {
      revision: toRevisionDto(createdRev!),
      deliverable: toDeliverableDto(updatedDeliv!),
    };
  });
}

// ---------------------------------------------------------------------------
// Support Tickets Service
// ---------------------------------------------------------------------------

export async function createSupportTicketRecord(
  db: CrmDatabase,
  ownerUserId: string,
  actorUserId: string,
  projectId: string,
  input: CreateSupportTicketInput,
  options?: { now?: Date },
): Promise<{ status: number; body: { ok: true; ticket: ClientSupportTicketDto }; replayed: boolean }> {
  const now = options?.now ?? new Date();
  const nowUtc = toMysqlUtcDateTime(now);

  if (looksLikeSecret(input.description)) {
    throw new CrmServiceError(400, "secret_detected", SECRET_ERROR);
  }

  const executeCreate = async (tx: CrmTransaction): Promise<ClientSupportTicketDto> => {
    const [project] = await tx
      .select()
      .from(crmProjects)
      .where(and(eq(crmProjects.id, projectId), eq(crmProjects.ownerUserId, ownerUserId)));

    if (!project) throw new CrmServiceError(404, "project_not_found", "Project not found.");

    const ticketId = generateServerId("sr");
    await tx.insert(crmClientSupportTickets).values({
      id: ticketId,
      ownerUserId,
      projectId,
      kind: input.kind,
      title: input.title.trim(),
      description: input.description ?? null,
      priority: input.priority ?? "normal",
      assigneeId: input.assigneeId ?? null,
      dueDate: input.dueDate ?? null,
      status: "open",
      resolution: null,
      resolvedAt: null,
      resolvedByUserId: null,
      coverage: input.coverage ?? "undecided",
      idempotencyKey: input.idempotencyKey ?? null,
      version: 1,
      createdAt: nowUtc,
      updatedAt: nowUtc,
    });

    await recordAuditEvent(
      tx,
      projectId,
      ownerUserId,
      actorUserId,
      "support_ticket.created",
      `Support request opened: “${input.title.trim()}”`,
      { ticketId, kind: input.kind, priority: input.priority },
      now,
    );

    const [created] = await tx.select().from(crmClientSupportTickets).where(eq(crmClientSupportTickets.id, ticketId));
    return toSupportTicketDto(created!);
  };

  if (input.idempotencyKey) {
    const scope = "support_ticket:create";
    const requestHash = hashIdempotentRequest(scope, { projectId, ...input });
    return runWithIdempotency<{ ok: true; ticket: ClientSupportTicketDto }>(
      db,
      {
        ownerUserId,
        scope,
        idemKey: input.idempotencyKey,
        requestHash,
        now,
      },
      async (tx) => {
        const ticket = await executeCreate(tx);
        return { status: 201, body: { ok: true, ticket }, resourceId: ticket.id };
      },
    );
  }

  const ticket = await db.transaction(executeCreate);
  return { status: 201, body: { ok: true, ticket }, replayed: false };
}

export async function updateSupportTicketRecord(
  db: CrmDatabase,
  ownerUserId: string,
  actorUserId: string,
  ticketId: string,
  input: UpdateSupportTicketInput,
  options?: { now?: Date },
): Promise<ClientSupportTicketDto> {
  const now = options?.now ?? new Date();
  const nowUtc = toMysqlUtcDateTime(now);

  if (looksLikeSecret(input.description) || looksLikeSecret(input.resolution)) {
    throw new CrmServiceError(400, "secret_detected", SECRET_ERROR);
  }

  return db.transaction(async (tx) => {
    const [ticket] = await tx
      .select()
      .from(crmClientSupportTickets)
      .where(and(eq(crmClientSupportTickets.id, ticketId), eq(crmClientSupportTickets.ownerUserId, ownerUserId)));

    if (!ticket) throw new CrmServiceError(404, "ticket_not_found", "Support ticket not found.");

    if (input.expectedVersion !== undefined && ticket.version !== input.expectedVersion) {
      throw new CrmServiceError(
        409,
        "stale_conflict",
        `Support ticket was updated elsewhere (version: ${ticket.version}, expected: ${input.expectedVersion}).`,
      );
    }

    if (input.status === "resolved") {
      const resText = (input.resolution ?? ticket.resolution ?? "").trim();
      if (!resText) {
        throw new CrmServiceError(400, "resolution_required", "Add resolution notes before resolving.");
      }
    }

    const updates: Partial<typeof crmClientSupportTickets.$inferInsert> = {
      version: ticket.version + 1,
      updatedAt: nowUtc,
    };

    if (input.kind !== undefined) updates.kind = input.kind;
    if (input.title !== undefined) updates.title = input.title.trim();
    if (input.description !== undefined) updates.description = input.description;
    if (input.priority !== undefined) updates.priority = input.priority;
    if (input.assigneeId !== undefined) updates.assigneeId = input.assigneeId;
    if (input.dueDate !== undefined) updates.dueDate = input.dueDate;
    if (input.coverage !== undefined) updates.coverage = input.coverage;
    if (input.resolution !== undefined) updates.resolution = input.resolution;

    if (input.status !== undefined) {
      updates.status = input.status;
      if (input.status === "resolved" && ticket.status !== "resolved") {
        updates.resolvedAt = nowUtc;
        updates.resolvedByUserId = actorUserId;
      } else if (input.status === "open" || input.status === "in_progress") {
        updates.resolvedAt = null;
        updates.resolvedByUserId = null;
      }
    }

    await tx.update(crmClientSupportTickets).set(updates).where(eq(crmClientSupportTickets.id, ticketId));

    await recordAuditEvent(
      tx,
      ticket.projectId,
      ownerUserId,
      actorUserId,
      "support_ticket.updated",
      `Support “${updates.title ?? ticket.title}” updated`,
      { ticketId, updates },
      now,
    );

    const [updated] = await tx.select().from(crmClientSupportTickets).where(eq(crmClientSupportTickets.id, ticketId));
    return toSupportTicketDto(updated!);
  });
}

export async function resolveSupportTicketRecord(
  db: CrmDatabase,
  ownerUserId: string,
  actorUserId: string,
  ticketId: string,
  resolution: string,
  expectedVersion?: number,
  options?: { now?: Date },
): Promise<ClientSupportTicketDto> {
  const now = options?.now ?? new Date();
  const nowUtc = toMysqlUtcDateTime(now);
  const trimmed = resolution.trim();
  if (!trimmed) throw new CrmServiceError(400, "resolution_required", "Add resolution notes before resolving.");
  if (looksLikeSecret(trimmed)) throw new CrmServiceError(400, "secret_detected", SECRET_ERROR);

  return db.transaction(async (tx) => {
    const [ticket] = await tx
      .select()
      .from(crmClientSupportTickets)
      .where(and(eq(crmClientSupportTickets.id, ticketId), eq(crmClientSupportTickets.ownerUserId, ownerUserId)));

    if (!ticket) throw new CrmServiceError(404, "ticket_not_found", "Support ticket not found.");

    if (expectedVersion !== undefined && ticket.version !== expectedVersion) {
      throw new CrmServiceError(
        409,
        "stale_conflict",
        `Support ticket was updated elsewhere (version: ${ticket.version}, expected: ${expectedVersion}).`,
      );
    }

    await tx
      .update(crmClientSupportTickets)
      .set({
        status: "resolved",
        resolution: trimmed,
        resolvedAt: nowUtc,
        resolvedByUserId: actorUserId,
        version: ticket.version + 1,
        updatedAt: nowUtc,
      })
      .where(eq(crmClientSupportTickets.id, ticketId));

    await recordAuditEvent(
      tx,
      ticket.projectId,
      ownerUserId,
      actorUserId,
      "support_ticket.resolved",
      `Support “${ticket.title}” resolved: ${trimmed}`,
      { ticketId, resolution: trimmed },
      now,
    );

    const [updated] = await tx.select().from(crmClientSupportTickets).where(eq(crmClientSupportTickets.id, ticketId));
    return toSupportTicketDto(updated!);
  });
}

export async function reopenSupportTicketRecord(
  db: CrmDatabase,
  ownerUserId: string,
  actorUserId: string,
  ticketId: string,
  reason?: string,
  expectedVersion?: number,
  options?: { now?: Date },
): Promise<ClientSupportTicketDto> {
  const now = options?.now ?? new Date();
  const nowUtc = toMysqlUtcDateTime(now);

  return db.transaction(async (tx) => {
    const [ticket] = await tx
      .select()
      .from(crmClientSupportTickets)
      .where(and(eq(crmClientSupportTickets.id, ticketId), eq(crmClientSupportTickets.ownerUserId, ownerUserId)));

    if (!ticket) throw new CrmServiceError(404, "ticket_not_found", "Support ticket not found.");

    if (expectedVersion !== undefined && ticket.version !== expectedVersion) {
      throw new CrmServiceError(
        409,
        "stale_conflict",
        `Support ticket was updated elsewhere (version: ${ticket.version}, expected: ${expectedVersion}).`,
      );
    }

    await tx
      .update(crmClientSupportTickets)
      .set({
        status: "open",
        resolvedAt: null,
        resolvedByUserId: null,
        version: ticket.version + 1,
        updatedAt: nowUtc,
      })
      .where(eq(crmClientSupportTickets.id, ticketId));

    await recordAuditEvent(
      tx,
      ticket.projectId,
      ownerUserId,
      actorUserId,
      "support_ticket.reopened",
      `Support “${ticket.title}” reopened${reason ? `: ${reason}` : ""}`,
      { ticketId, reason },
      now,
    );

    const [updated] = await tx.select().from(crmClientSupportTickets).where(eq(crmClientSupportTickets.id, ticketId));
    return toSupportTicketDto(updated!);
  });
}

// ---------------------------------------------------------------------------
// Project Templates Service
// ---------------------------------------------------------------------------

export async function saveProjectTemplateRecord(
  db: CrmDatabase,
  ownerUserId: string,
  input: SaveProjectTemplateInput,
  options?: { now?: Date },
): Promise<ProjectTemplateDto> {
  const now = options?.now ?? new Date();
  const nowUtc = toMysqlUtcDateTime(now);

  return db.transaction(async (tx) => {
    if (input.id) {
      const [existing] = await tx
        .select()
        .from(crmProjectTemplates)
        .where(and(eq(crmProjectTemplates.id, input.id), eq(crmProjectTemplates.ownerUserId, ownerUserId)));

      if (existing) {
        await tx
          .update(crmProjectTemplates)
          .set({
            name: input.name.trim(),
            type: input.type.trim(),
            builtIn: input.builtIn ?? existing.builtIn,
            milestonesJson: JSON.stringify(input.milestones ?? []),
            tasksJson: JSON.stringify(input.tasks ?? []),
            requirementsJson: JSON.stringify(input.requirements ?? []),
            qaJson: JSON.stringify(input.qa ?? []),
            handoverJson: JSON.stringify(input.handover ?? []),
            archived: input.archived ?? existing.archived,
            updatedAt: nowUtc,
          })
          .where(eq(crmProjectTemplates.id, input.id));

        const [updated] = await tx.select().from(crmProjectTemplates).where(eq(crmProjectTemplates.id, input.id));
        return toTemplateDto(updated!);
      }
    }

    const tplId = input.id || generateServerId("tpl");
    await tx.insert(crmProjectTemplates).values({
      id: tplId,
      ownerUserId,
      name: input.name.trim(),
      type: input.type.trim(),
      builtIn: input.builtIn ?? false,
      milestonesJson: JSON.stringify(input.milestones ?? []),
      tasksJson: JSON.stringify(input.tasks ?? []),
      requirementsJson: JSON.stringify(input.requirements ?? []),
      qaJson: JSON.stringify(input.qa ?? []),
      handoverJson: JSON.stringify(input.handover ?? []),
      archived: input.archived ?? false,
      createdAt: nowUtc,
      updatedAt: nowUtc,
    });

    const [created] = await tx.select().from(crmProjectTemplates).where(eq(crmProjectTemplates.id, tplId));
    return toTemplateDto(created!);
  });
}

export async function listProjectTemplatesRecord(
  db: CrmDatabase,
  ownerUserId: string,
  includeArchived = false,
): Promise<ProjectTemplateDto[]> {
  const conditions = [eq(crmProjectTemplates.ownerUserId, ownerUserId)];
  if (!includeArchived) {
    conditions.push(eq(crmProjectTemplates.archived, false));
  }

  const rows = await db
    .select()
    .from(crmProjectTemplates)
    .where(and(...conditions))
    .orderBy(crmProjectTemplates.createdAt);

  return rows.map(toTemplateDto);
}

export async function seedStarterTemplatesIfEmpty(
  db: CrmDatabase,
  ownerUserId: string,
  options?: { now?: Date },
): Promise<void> {
  const [existing] = await db
    .select({ count: sql<number>`count(*)` })
    .from(crmProjectTemplates)
    .where(eq(crmProjectTemplates.ownerUserId, ownerUserId));

  if (Number(existing?.count ?? 0) > 0) return;

  const now = options?.now ?? new Date();
  const nowUtc = toMysqlUtcDateTime(now);

  const DEFAULT_REQ = [
    "Logo received",
    "Brand colours confirmed",
    "Reference websites received",
    "Website copy received",
    "Images received",
    "Domain responsibility confirmed",
    "Hosting responsibility confirmed",
    "Launch approval received",
  ];
  const DEFAULT_QA = [
    "Tested on desktop",
    "Mobile responsiveness tested",
    "Forms tested",
    "Domain configuration reviewed",
    "Hosting deployment completed",
  ];
  const DEFAULT_HANDOVER = ["Client approval received", "Handover completed", "Documentation provided"];

  const starterList = [
    {
      id: generateServerId("tpl"),
      name: "Business Website",
      type: "Business Website",
      builtIn: true,
      milestonesJson: JSON.stringify(["Content", "Build", "Launch"]),
      tasksJson: JSON.stringify([
        { title: "Collect content and images", milestone: "Content" },
        { title: "Approve design", milestone: "Build" },
        { title: "Build pages", milestone: "Build" },
        { title: "Mobile QA", milestone: "Launch" },
        { title: "Deliver website", milestone: "Launch" },
      ]),
      requirementsJson: JSON.stringify(DEFAULT_REQ),
      qaJson: JSON.stringify(DEFAULT_QA),
      handoverJson: JSON.stringify(DEFAULT_HANDOVER),
      archived: false,
      createdAt: nowUtc,
      updatedAt: nowUtc,
    },
    {
      id: generateServerId("tpl"),
      name: "E-commerce Website",
      type: "E-commerce Website",
      builtIn: true,
      milestonesJson: JSON.stringify(["Content", "Design", "Build", "Launch"]),
      tasksJson: JSON.stringify([
        { title: "Collect product images", milestone: "Content" },
        { title: "Collect product information", milestone: "Content" },
        { title: "Approve UI design", milestone: "Design" },
        { title: "Build product pages", milestone: "Build" },
        { title: "Configure admin panel", milestone: "Build" },
        { title: "Integrate payment flow", milestone: "Build" },
        { title: "Test checkout", milestone: "Launch" },
        { title: "Perform mobile QA", milestone: "Launch" },
        { title: "Obtain launch approval", milestone: "Launch" },
        { title: "Deliver website", milestone: "Launch" },
      ]),
      requirementsJson: JSON.stringify([
        ...DEFAULT_REQ,
        "Product details received",
        "Admin access requirements identified",
        "Integrations clarified",
      ]),
      qaJson: JSON.stringify([
        ...DEFAULT_QA,
        "Checkout tested",
        "Admin panel tested",
        "Payment integration tested",
      ]),
      handoverJson: JSON.stringify(DEFAULT_HANDOVER),
      archived: false,
      createdAt: nowUtc,
      updatedAt: nowUtc,
    },
  ];

  for (const tpl of starterList) {
    await db.insert(crmProjectTemplates).values({
      ...tpl,
      ownerUserId,
    });
  }
}

// ---------------------------------------------------------------------------
// Overview, Metrics & Attention
// ---------------------------------------------------------------------------

export async function getProjectOverviewMetricsRecord(
  db: CrmDatabase,
  ownerUserId: string,
  options?: { now?: Date },
) {
  const now = options?.now ?? new Date();
  const ist = toIstParts(now);

  const projects = await db
    .select()
    .from(crmProjects)
    .where(and(eq(crmProjects.ownerUserId, ownerUserId), eq(crmProjects.archived, false)));

  const projectIds = projects.map((p) => p.id);
  const tasks = projectIds.length
    ? await db
        .select({
          projectId: crmProjectTasks.projectId,
          status: crmProjectTasks.status,
          dueDate: crmProjectTasks.dueDate,
          milestoneId: crmProjectTasks.milestoneId,
        })
        .from(crmProjectTasks)
        .where(
          and(
            eq(crmProjectTasks.ownerUserId, ownerUserId),
            inArray(crmProjectTasks.projectId, projectIds),
          ),
        )
    : [];

  const milestones = projectIds.length
    ? await db
        .select({
          id: crmProjectMilestones.id,
          projectId: crmProjectMilestones.projectId,
          dueDate: crmProjectMilestones.dueDate,
        })
        .from(crmProjectMilestones)
        .where(
          and(
            eq(crmProjectMilestones.ownerUserId, ownerUserId),
            inArray(crmProjectMilestones.projectId, projectIds),
          ),
        )
    : [];

  const requests = projectIds.length
    ? await db
        .select({
          projectId: crmClientSupportTickets.projectId,
          status: crmClientSupportTickets.status,
          priority: crmClientSupportTickets.priority,
        })
        .from(crmClientSupportTickets)
        .where(
          and(
            eq(crmClientSupportTickets.ownerUserId, ownerUserId),
            inArray(crmClientSupportTickets.projectId, projectIds),
          ),
        )
    : [];

  const metrics = projectMetrics(projects, tasks, milestones, requests, ist.istDate);
  const attention = projectAttention(
    projects.map((p) => ({
      ...p,
      support: parseJsonSafe<ProjectSupport>(p.supportJson, { included: null }),
    })),
    tasks,
    requests,
    ist.istDate,
  );

  return { metrics, attention };
}
