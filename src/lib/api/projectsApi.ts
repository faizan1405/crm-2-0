import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest, createIdempotencyKey } from "./client";
import { analyticsKeys } from "./analyticsApi";
export { createIdempotencyKey } from "./client";
import {
  clientSupportTicketDtoSchema,
  projectAuditEventDtoSchema,
  projectCreateResponseSchema,
  projectDeliverableCreateResponseSchema,
  projectDeliverableDtoSchema,
  projectDeliverableRevisionCreateResponseSchema,
  projectDeliverableRevisionDtoSchema,
  projectDetailsResponseSchema,
  projectDtoSchema,
  projectMilestoneCreateResponseSchema,
  projectMilestoneDtoSchema,
  projectMilestoneUpdateResponseSchema,
  projectOverviewMetricsResponseSchema,
  projectsListResponseSchema,
  projectSupportTicketCreateResponseSchema,
  projectSupportTicketUpdateResponseSchema,
  projectTaskCreateResponseSchema,
  projectTaskDtoSchema,
  projectTaskUpdateResponseSchema,
  projectTemplateDtoSchema,
  projectTemplateSaveResponseSchema,
  projectTemplatesListResponseSchema,
  projectUpdateResponseSchema,
  type CheckItemDto,
  type ClientSupportTicketDto,
  type DeliverableRevisionStatusApi,
  type DeliverableStatusApi,
  type ProjectAuditEventDto,
  type ProjectCreateResponse,
  type ProjectDeliverableCreateResponse,
  type ProjectDeliverableDto,
  type ProjectDeliverableRevisionCreateResponse,
  type ProjectDeliverableRevisionDto,
  type ProjectDeliveryDto,
  type ProjectDependencyDto,
  type ProjectDetailsResponse,
  type ProjectDto,
  type ProjectLinkDto,
  type ProjectMilestoneCreateResponse,
  type ProjectMilestoneDto,
  type ProjectMilestoneUpdateResponse,
  type ProjectOverviewMetricsResponse,
  type ProjectPriorityApi,
  type ProjectsListResponse,
  type ProjectStageApi,
  type ProjectStatusApi,
  type ProjectSupportDto,
  type ProjectSupportTicketCreateResponse,
  type ProjectSupportTicketUpdateResponse,
  type ProjectTaskCreateResponse,
  type ProjectTaskDto,
  type ProjectTaskUpdateResponse,
  type ProjectTemplateDto,
  type ProjectTemplateSaveResponse,
  type ProjectTemplatesListResponse,
  type ProjectUpdateResponse,
  type RequestStatusApi,
  type SupportCoverageApi,
  type SupportKindApi,
  type SupportStatusApi,
} from "./schemas";

// ---------------------------------------------------------------------------
// Query Keys
// ---------------------------------------------------------------------------

export const projectKeys = {
  all: ["projects"] as const,
  lists: () => [...projectKeys.all, "list"] as const,
  list: (filters: ProjectsListFilters) => [...projectKeys.lists(), filters] as const,
  details: () => [...projectKeys.all, "detail"] as const,
  detail: (id: string) => [...projectKeys.details(), id] as const,
  overview: () => [...projectKeys.all, "overview"] as const,
  templates: {
    all: ["project-templates"] as const,
    lists: () => [...projectKeys.templates.all, "list"] as const,
    list: (options?: { includeArchived?: boolean }) => [...projectKeys.templates.lists(), options ?? {}] as const,
  },
};

// ---------------------------------------------------------------------------
// Payload Types
// ---------------------------------------------------------------------------

export interface ProjectsListFilters {
  q?: string | undefined;
  stage?: ProjectStageApi | "all" | undefined;
  status?: ProjectStatusApi | "all" | undefined;
  priority?: ProjectPriorityApi | "all" | undefined;
  archived?: boolean | undefined;
  dealId?: string | undefined;
  leadId?: string | undefined;
  sort?: "recent" | "due" | "start" | "name" | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
}

export interface CreateProjectPayload {
  name: string;
  clientName: string;
  company?: string | undefined;
  phone?: string | undefined;
  email?: string | undefined;
  leadId?: string | undefined;
  dealId?: string | undefined;
  templateId?: string | undefined;
  legacyId?: string | undefined;
  type?: string | undefined;
  scope?: string | undefined;
  bookingDate?: string | undefined;
  plannedStart?: string | undefined;
  actualStart?: string | undefined;
  targetDelivery?: string | undefined;
  priority?: ProjectPriorityApi | undefined;
  projectOwnerId?: string | undefined;
  memberIds?: string[] | undefined;
  notes?: string | undefined;
  idempotencyKey?: string | undefined;
}

export interface UpdateProjectPayload {
  expectedVersion?: number | undefined;
  name?: string | undefined;
  scope?: string | undefined;
  bookingDate?: string | null | undefined;
  plannedStart?: string | null | undefined;
  actualStart?: string | null | undefined;
  targetDelivery?: string | null | undefined;
  priority?: ProjectPriorityApi | undefined;
  projectOwnerId?: string | null | undefined;
  memberIds?: string[] | undefined;
  notes?: string | null | undefined;
  reviewFlag?: string | null | undefined;
  clearAttention?: boolean | undefined;
}

export interface SetProjectStatusPayload {
  status: ProjectStatusApi;
  expectedVersion?: number | undefined;
  idempotencyKey?: string | undefined;
}

export interface MoveProjectStagePayload {
  stage: ProjectStageApi;
  from?: ProjectStageApi | undefined;
  expectedVersion?: number | undefined;
  idempotencyKey?: string | undefined;
}

export interface UndoProjectStagePayload {
  toStage: ProjectStageApi;
  expectedVersion?: number | undefined;
}

export interface DeliverProjectPayload {
  date: string;
  url?: string | undefined;
  notes?: string | undefined;
  approval: "pending" | "approved" | "not_required";
  override?: string | undefined;
  expectedVersion?: number | undefined;
  idempotencyKey?: string | undefined;
}

export interface ConfigureProjectSupportPayload {
  included: boolean | null;
  months?: number | undefined;
  start?: string | undefined;
  end?: string | undefined;
  description?: string | undefined;
  expectedVersion?: number | undefined;
  idempotencyKey?: string | undefined;
}

export interface ArchiveProjectPayload {
  archived: boolean;
  expectedVersion?: number | undefined;
}

export interface CreateMilestonePayload {
  title: string;
  dueDate?: string | undefined;
  sortOrder?: number | undefined;
  idempotencyKey?: string | undefined;
}

export interface UpdateMilestonePayload {
  expectedVersion?: number | undefined;
  title?: string | undefined;
  dueDate?: string | null | undefined;
  sortOrder?: number | undefined;
  status?: "open" | "completed" | undefined;
  idempotencyKey?: string | undefined;
}

export interface CreateTaskPayload {
  title: string;
  milestoneId?: string | undefined;
  notes?: string | undefined;
  assigneeId?: string | undefined;
  dueDate?: string | undefined;
  priority?: ProjectPriorityApi | undefined;
  sortOrder?: number | undefined;
  idempotencyKey?: string | undefined;
}

export interface UpdateTaskPayload {
  expectedVersion?: number | undefined;
  title?: string | undefined;
  milestoneId?: string | null | undefined;
  notes?: string | null | undefined;
  assigneeId?: string | null | undefined;
  dueDate?: string | null | undefined;
  priority?: ProjectPriorityApi | undefined;
  sortOrder?: number | undefined;
  idempotencyKey?: string | undefined;
}

export interface CreateDeliverablePayload {
  title: string;
  description?: string | undefined;
  category?: string | undefined;
  status?: DeliverableStatusApi | undefined;
  dueDate?: string | undefined;
  idempotencyKey?: string | undefined;
}

export interface AddDeliverableRevisionPayload {
  summary: string;
  title?: string | undefined;
  fileUrl?: string | undefined;
  notes?: string | undefined;
  clientFeedback?: string | undefined;
  status?: DeliverableRevisionStatusApi | undefined;
  expectedVersion?: number | undefined;
  idempotencyKey?: string | undefined;
}

export interface CreateSupportTicketPayload {
  kind: SupportKindApi;
  title: string;
  description?: string | undefined;
  priority?: ProjectPriorityApi | undefined;
  assigneeId?: string | undefined;
  dueDate?: string | undefined;
  coverage?: SupportCoverageApi | undefined;
  idempotencyKey?: string | undefined;
}

export interface UpdateSupportTicketPayload {
  expectedVersion?: number | undefined;
  kind?: SupportKindApi | undefined;
  title?: string | undefined;
  description?: string | undefined;
  priority?: ProjectPriorityApi | undefined;
  assigneeId?: string | null | undefined;
  dueDate?: string | null | undefined;
  coverage?: SupportCoverageApi | undefined;
  status?: RequestStatusApi | undefined;
  resolution?: string | null | undefined;
  idempotencyKey?: string | undefined;
}

export interface SaveProjectTemplatePayload {
  id?: string | undefined;
  name: string;
  type: string;
  builtIn?: boolean | undefined;
  milestones?: string[] | undefined;
  tasks?: Array<{ title: string; milestone?: string }> | undefined;
  requirements?: string[] | undefined;
  qa?: string[] | undefined;
  handover?: string[] | undefined;
}

// ---------------------------------------------------------------------------
// API Client Functions
// ---------------------------------------------------------------------------

export async function listProjects(
  filters: ProjectsListFilters = {},
  options?: { signal?: AbortSignal },
): Promise<ProjectsListResponse> {
  return apiRequest({
    path: "/api/v1/projects",
    query: {
      q: filters.q,
      stage: filters.stage === "all" ? undefined : filters.stage,
      status: filters.status === "all" ? undefined : filters.status,
      priority: filters.priority === "all" ? undefined : filters.priority,
      archived: filters.archived !== undefined ? String(filters.archived) : undefined,
      dealId: filters.dealId,
      leadId: filters.leadId,
      sort: filters.sort,
      limit: filters.limit !== undefined ? String(filters.limit) : undefined,
      offset: filters.offset !== undefined ? String(filters.offset) : undefined,
    },
    schema: projectsListResponseSchema,
    ...(options?.signal ? { signal: options.signal } : {}),
  });
}

export async function getProjectOverview(
  options?: { signal?: AbortSignal },
): Promise<ProjectOverviewMetricsResponse> {
  return apiRequest({
    path: "/api/v1/projects/summary/metrics",
    schema: projectOverviewMetricsResponseSchema,
    ...(options?.signal ? { signal: options.signal } : {}),
  });
}

export async function getProjectDetails(
  projectId: string,
  options?: { signal?: AbortSignal },
): Promise<ProjectDetailsResponse> {
  return apiRequest({
    path: `/api/v1/projects/${encodeURIComponent(projectId)}`,
    schema: projectDetailsResponseSchema,
    ...(options?.signal ? { signal: options.signal } : {}),
  });
}

export async function createProject(
  payload: CreateProjectPayload,
): Promise<ProjectCreateResponse> {
  const idempotencyKey = payload.idempotencyKey ?? createIdempotencyKey();
  return apiRequest({
    path: "/api/v1/projects",
    method: "POST",
    idempotencyKey,
    body: { ...payload, idempotencyKey },
    schema: projectCreateResponseSchema,
  });
}

export async function updateProject(
  projectId: string,
  payload: UpdateProjectPayload,
): Promise<ProjectUpdateResponse> {
  return apiRequest({
    path: `/api/v1/projects/${encodeURIComponent(projectId)}`,
    method: "PATCH",
    body: payload,
    schema: projectUpdateResponseSchema,
  });
}

export async function setProjectStatus(
  projectId: string,
  payload: SetProjectStatusPayload,
): Promise<ProjectUpdateResponse> {
  const idempotencyKey = payload.idempotencyKey ?? createIdempotencyKey();
  return apiRequest({
    path: `/api/v1/projects/${encodeURIComponent(projectId)}/status`,
    method: "POST",
    idempotencyKey,
    body: { ...payload, idempotencyKey },
    schema: projectUpdateResponseSchema,
  });
}

export async function moveProjectStage(
  projectId: string,
  payload: MoveProjectStagePayload,
): Promise<{ ok: true; project: ProjectDto; previousStage: ProjectStageApi }> {
  const idempotencyKey = payload.idempotencyKey ?? createIdempotencyKey();
  return apiRequest({
    path: `/api/v1/projects/${encodeURIComponent(projectId)}/stage`,
    method: "POST",
    idempotencyKey,
    body: { ...payload, idempotencyKey },
    schema: projectsListResponseSchema.pick({ ok: true }).extend({
      project: projectDtoSchema,
      previousStage: projectDtoSchema.shape.stage,
    }),
  });
}

export async function undoProjectStage(
  projectId: string,
  payload: UndoProjectStagePayload,
): Promise<ProjectUpdateResponse> {
  return apiRequest({
    path: `/api/v1/projects/${encodeURIComponent(projectId)}/stage/undo`,
    method: "POST",
    body: payload,
    schema: projectUpdateResponseSchema,
  });
}

export async function deliverProject(
  projectId: string,
  payload: DeliverProjectPayload,
): Promise<ProjectUpdateResponse> {
  const idempotencyKey = payload.idempotencyKey ?? createIdempotencyKey();
  return apiRequest({
    path: `/api/v1/projects/${encodeURIComponent(projectId)}/delivery`,
    method: "POST",
    idempotencyKey,
    body: { ...payload, idempotencyKey },
    schema: projectUpdateResponseSchema,
  });
}

export async function configureProjectSupport(
  projectId: string,
  payload: ConfigureProjectSupportPayload,
): Promise<ProjectUpdateResponse> {
  const idempotencyKey = payload.idempotencyKey ?? createIdempotencyKey();
  return apiRequest({
    path: `/api/v1/projects/${encodeURIComponent(projectId)}/support`,
    method: "POST",
    idempotencyKey,
    body: { ...payload, idempotencyKey },
    schema: projectUpdateResponseSchema,
  });
}

export async function archiveProject(
  projectId: string,
  payload: ArchiveProjectPayload,
): Promise<{ ok: true; project: ProjectDto; changed: boolean }> {
  return apiRequest({
    path: `/api/v1/projects/${encodeURIComponent(projectId)}/archive`,
    method: "POST",
    body: payload,
    schema: projectsListResponseSchema.pick({ ok: true }).extend({
      project: projectDtoSchema,
      changed: projectDtoSchema.shape.archived,
    }),
  });
}

export async function addProjectNote(
  projectId: string,
  text: string,
): Promise<{ ok: true; event: ProjectAuditEventDto }> {
  return apiRequest({
    path: `/api/v1/projects/${encodeURIComponent(projectId)}/notes`,
    method: "POST",
    body: { text },
    schema: projectsListResponseSchema.pick({ ok: true }).extend({
      event: projectAuditEventDtoSchema,
    }),
  });
}

export async function toggleChecklistItem(
  projectId: string,
  list: "requirements" | "qa" | "handover",
  itemId: string,
  expectedVersion?: number,
): Promise<ProjectUpdateResponse> {
  return apiRequest({
    path: `/api/v1/projects/${encodeURIComponent(projectId)}/checklists/${list}/toggle`,
    method: "POST",
    body: { itemId, expectedVersion },
    schema: projectUpdateResponseSchema,
  });
}

export async function toggleDependencyItem(
  projectId: string,
  depId: string,
  expectedVersion?: number,
): Promise<ProjectUpdateResponse> {
  return apiRequest({
    path: `/api/v1/projects/${encodeURIComponent(projectId)}/dependencies/toggle`,
    method: "POST",
    body: { depId, expectedVersion },
    schema: projectUpdateResponseSchema,
  });
}

export async function createMilestone(
  projectId: string,
  payload: CreateMilestonePayload,
): Promise<ProjectMilestoneCreateResponse> {
  const idempotencyKey = payload.idempotencyKey ?? createIdempotencyKey();
  return apiRequest({
    path: `/api/v1/projects/${encodeURIComponent(projectId)}/milestones`,
    method: "POST",
    idempotencyKey,
    body: { ...payload, idempotencyKey },
    schema: projectMilestoneCreateResponseSchema,
  });
}

export async function updateMilestone(
  milestoneId: string,
  payload: UpdateMilestonePayload,
): Promise<ProjectMilestoneUpdateResponse> {
  return apiRequest({
    path: `/api/v1/project-milestones/${encodeURIComponent(milestoneId)}`,
    method: "PATCH",
    body: payload,
    schema: projectMilestoneUpdateResponseSchema,
  });
}

export async function createTask(
  projectId: string,
  payload: CreateTaskPayload,
): Promise<ProjectTaskCreateResponse> {
  const idempotencyKey = payload.idempotencyKey ?? createIdempotencyKey();
  return apiRequest({
    path: `/api/v1/projects/${encodeURIComponent(projectId)}/tasks`,
    method: "POST",
    idempotencyKey,
    body: { ...payload, idempotencyKey },
    schema: projectTaskCreateResponseSchema,
  });
}

export async function updateTask(
  taskId: string,
  payload: UpdateTaskPayload,
): Promise<ProjectTaskUpdateResponse> {
  return apiRequest({
    path: `/api/v1/tasks/${encodeURIComponent(taskId)}`,
    method: "PATCH",
    body: payload,
    schema: projectTaskUpdateResponseSchema,
  });
}

export async function setTaskDone(
  taskId: string,
  done: boolean,
  expectedVersion?: number,
): Promise<ProjectTaskUpdateResponse> {
  return apiRequest({
    path: `/api/v1/tasks/${encodeURIComponent(taskId)}/done`,
    method: "POST",
    body: { done, expectedVersion },
    schema: projectTaskUpdateResponseSchema,
  });
}

export async function createDeliverable(
  projectId: string,
  payload: CreateDeliverablePayload,
): Promise<ProjectDeliverableCreateResponse> {
  const idempotencyKey = payload.idempotencyKey ?? createIdempotencyKey();
  return apiRequest({
    path: `/api/v1/projects/${encodeURIComponent(projectId)}/deliverables`,
    method: "POST",
    idempotencyKey,
    body: { ...payload, idempotencyKey },
    schema: projectDeliverableCreateResponseSchema,
  });
}

export async function addDeliverableRevision(
  deliverableId: string,
  payload: AddDeliverableRevisionPayload,
): Promise<ProjectDeliverableRevisionCreateResponse> {
  const idempotencyKey = payload.idempotencyKey ?? createIdempotencyKey();
  return apiRequest({
    path: `/api/v1/deliverables/${encodeURIComponent(deliverableId)}/revisions`,
    method: "POST",
    idempotencyKey,
    body: { ...payload, idempotencyKey },
    schema: projectDeliverableRevisionCreateResponseSchema,
  });
}

export async function createSupportTicket(
  projectId: string,
  payload: CreateSupportTicketPayload,
): Promise<ProjectSupportTicketCreateResponse> {
  const idempotencyKey = payload.idempotencyKey ?? createIdempotencyKey();
  return apiRequest({
    path: `/api/v1/projects/${encodeURIComponent(projectId)}/support-tickets`,
    method: "POST",
    idempotencyKey,
    body: { ...payload, idempotencyKey },
    schema: projectSupportTicketCreateResponseSchema,
  });
}

export async function updateSupportTicket(
  ticketId: string,
  payload: UpdateSupportTicketPayload,
): Promise<ProjectSupportTicketUpdateResponse> {
  return apiRequest({
    path: `/api/v1/support-tickets/${encodeURIComponent(ticketId)}`,
    method: "PATCH",
    body: payload,
    schema: projectSupportTicketUpdateResponseSchema,
  });
}

export async function resolveSupportTicket(
  ticketId: string,
  resolution: string,
  expectedVersion?: number,
): Promise<ProjectSupportTicketUpdateResponse> {
  return apiRequest({
    path: `/api/v1/support-tickets/${encodeURIComponent(ticketId)}/resolve`,
    method: "POST",
    body: { resolution, expectedVersion },
    schema: projectSupportTicketUpdateResponseSchema,
  });
}

export async function reopenSupportTicket(
  ticketId: string,
  reason?: string,
  expectedVersion?: number,
): Promise<ProjectSupportTicketUpdateResponse> {
  return apiRequest({
    path: `/api/v1/support-tickets/${encodeURIComponent(ticketId)}/reopen`,
    method: "POST",
    body: { reason, expectedVersion },
    schema: projectSupportTicketUpdateResponseSchema,
  });
}

export async function listProjectTemplates(
  options?: { includeArchived?: boolean; signal?: AbortSignal },
): Promise<ProjectTemplatesListResponse> {
  return apiRequest({
    path: "/api/v1/project-templates",
    query: {
      includeArchived: options?.includeArchived ? "true" : undefined,
    },
    schema: projectTemplatesListResponseSchema,
    ...(options?.signal ? { signal: options.signal } : {}),
  });
}

export async function saveProjectTemplate(
  payload: SaveProjectTemplatePayload,
): Promise<ProjectTemplateSaveResponse> {
  return apiRequest({
    path: "/api/v1/project-templates",
    method: "POST",
    body: payload,
    schema: projectTemplateSaveResponseSchema,
  });
}

// ---------------------------------------------------------------------------
// React Query Hooks
// ---------------------------------------------------------------------------

export function useProjectsQuery(filters: ProjectsListFilters = {}, enabled = true) {
  return useQuery({
    queryKey: projectKeys.list(filters),
    queryFn: ({ signal }) => listProjects(filters, { signal }),
    enabled,
    staleTime: 10_000,
  });
}

export function useProjectOverviewQuery(enabled = true) {
  return useQuery({
    queryKey: projectKeys.overview(),
    queryFn: ({ signal }) => getProjectOverview({ signal }),
    enabled,
    staleTime: 10_000,
  });
}

export function useProjectDetailsQuery(projectId: string | null | undefined, enabled = true) {
  return useQuery({
    queryKey: projectId ? projectKeys.detail(projectId) : ["projects", "detail", "null"],
    queryFn: ({ signal }) => {
      if (!projectId) throw new Error("No project ID provided.");
      return getProjectDetails(projectId, { signal });
    },
    enabled: enabled && !!projectId,
    staleTime: 5_000,
  });
}

export function useProjectTemplatesQuery(options?: { includeArchived?: boolean }, enabled = true) {
  return useQuery({
    queryKey: projectKeys.templates.list(options),
    queryFn: ({ signal }) => listProjectTemplates({ ...options, signal }),
    enabled,
    staleTime: 30_000,
  });
}

// ---------------------------------------------------------------------------
// Mutation Hooks
// ---------------------------------------------------------------------------

export function useCreateProjectMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateProjectPayload) => createProject(payload),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: projectKeys.lists() });
      queryClient.invalidateQueries({ queryKey: projectKeys.overview() });
      queryClient.invalidateQueries({ queryKey: analyticsKeys.all });
      queryClient.setQueryData(projectKeys.detail(data.project.id), (old: ProjectDetailsResponse | undefined) => {
        if (!old) {
          return {
            ok: true as const,
            project: data.project,
            milestones: [],
            tasks: [],
            deliverables: [],
            supportTickets: [],
            recentAuditEvents: [],
          };
        }
        return { ...old, project: data.project };
      });
    },
  });
}

export function useUpdateProjectMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: UpdateProjectPayload }) =>
      updateProject(id, payload),
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: projectKeys.lists() });
      queryClient.invalidateQueries({ queryKey: projectKeys.overview() });
      queryClient.invalidateQueries({ queryKey: analyticsKeys.all });
      queryClient.setQueryData(projectKeys.detail(variables.id), (old: ProjectDetailsResponse | undefined) => {
        if (!old) return old;
        return { ...old, project: data.project };
      });
    },
  });
}

export function useSetProjectStatusMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: SetProjectStatusPayload }) =>
      setProjectStatus(id, payload),
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: projectKeys.lists() });
      queryClient.invalidateQueries({ queryKey: projectKeys.overview() });
      queryClient.invalidateQueries({ queryKey: analyticsKeys.all });
      queryClient.setQueryData(projectKeys.detail(variables.id), (old: ProjectDetailsResponse | undefined) => {
        if (!old) return old;
        return { ...old, project: data.project };
      });
    },
  });
}

export function useMoveProjectStageMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: MoveProjectStagePayload }) =>
      moveProjectStage(id, payload),
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: projectKeys.lists() });
      queryClient.invalidateQueries({ queryKey: projectKeys.overview() });
      queryClient.invalidateQueries({ queryKey: analyticsKeys.all });
      queryClient.setQueryData(projectKeys.detail(variables.id), (old: ProjectDetailsResponse | undefined) => {
        if (!old) return old;
        return { ...old, project: data.project };
      });
    },
  });
}

export function useUndoProjectStageMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: UndoProjectStagePayload }) =>
      undoProjectStage(id, payload),
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: projectKeys.lists() });
      queryClient.invalidateQueries({ queryKey: projectKeys.overview() });
      queryClient.invalidateQueries({ queryKey: analyticsKeys.all });
      queryClient.setQueryData(projectKeys.detail(variables.id), (old: ProjectDetailsResponse | undefined) => {
        if (!old) return old;
        return { ...old, project: data.project };
      });
    },
  });
}

export function useDeliverProjectMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: DeliverProjectPayload }) =>
      deliverProject(id, payload),
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: projectKeys.lists() });
      queryClient.invalidateQueries({ queryKey: projectKeys.overview() });
      queryClient.invalidateQueries({ queryKey: analyticsKeys.all });
      queryClient.setQueryData(projectKeys.detail(variables.id), (old: ProjectDetailsResponse | undefined) => {
        if (!old) return old;
        return { ...old, project: data.project };
      });
    },
  });
}

export function useConfigureProjectSupportMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: ConfigureProjectSupportPayload }) =>
      configureProjectSupport(id, payload),
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: projectKeys.lists() });
      queryClient.invalidateQueries({ queryKey: projectKeys.overview() });
      queryClient.invalidateQueries({ queryKey: analyticsKeys.all });
      queryClient.setQueryData(projectKeys.detail(variables.id), (old: ProjectDetailsResponse | undefined) => {
        if (!old) return old;
        return { ...old, project: data.project };
      });
    },
  });
}

export function useArchiveProjectMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: ArchiveProjectPayload }) =>
      archiveProject(id, payload),
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: projectKeys.lists() });
      queryClient.invalidateQueries({ queryKey: projectKeys.overview() });
      queryClient.invalidateQueries({ queryKey: analyticsKeys.all });
      queryClient.setQueryData(projectKeys.detail(variables.id), (old: ProjectDetailsResponse | undefined) => {
        if (!old) return old;
        return { ...old, project: data.project };
      });
    },
  });
}

export function useAddProjectNoteMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, text }: { id: string; text: string }) => addProjectNote(id, text),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: projectKeys.detail(variables.id) });
    },
  });
}

export function useToggleChecklistItemMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      projectId,
      list,
      itemId,
      expectedVersion,
    }: {
      projectId: string;
      list: "requirements" | "qa" | "handover";
      itemId: string;
      expectedVersion?: number;
    }) => toggleChecklistItem(projectId, list, itemId, expectedVersion),
    onSuccess: (data, variables) => {
      queryClient.setQueryData(projectKeys.detail(variables.projectId), (old: ProjectDetailsResponse | undefined) => {
        if (!old) return old;
        return { ...old, project: data.project };
      });
    },
  });
}

export function useToggleDependencyItemMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      projectId,
      depId,
      expectedVersion,
    }: {
      projectId: string;
      depId: string;
      expectedVersion?: number;
    }) => toggleDependencyItem(projectId, depId, expectedVersion),
    onSuccess: (data, variables) => {
      queryClient.setQueryData(projectKeys.detail(variables.projectId), (old: ProjectDetailsResponse | undefined) => {
        if (!old) return old;
        return { ...old, project: data.project };
      });
    },
  });
}

export function useCreateMilestoneMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ projectId, payload }: { projectId: string; payload: CreateMilestonePayload }) =>
      createMilestone(projectId, payload),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: projectKeys.detail(variables.projectId) });
    },
  });
}

export function useUpdateMilestoneMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ milestoneId, payload }: { milestoneId: string; projectId: string; payload: UpdateMilestonePayload }) =>
      updateMilestone(milestoneId, payload),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: projectKeys.detail(variables.projectId) });
    },
  });
}

export function useCreateTaskMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ projectId, payload }: { projectId: string; payload: CreateTaskPayload }) =>
      createTask(projectId, payload),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: projectKeys.lists() });
      queryClient.invalidateQueries({ queryKey: projectKeys.overview() });
      queryClient.invalidateQueries({ queryKey: analyticsKeys.all });
      queryClient.invalidateQueries({ queryKey: projectKeys.detail(variables.projectId) });
    },
  });
}

export function useUpdateTaskMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ taskId, payload }: { taskId: string; projectId: string; payload: UpdateTaskPayload }) =>
      updateTask(taskId, payload),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: projectKeys.detail(variables.projectId) });
    },
  });
}

export function useSetTaskDoneMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      taskId,
      done,
      expectedVersion,
    }: {
      taskId: string;
      projectId: string;
      done: boolean;
      expectedVersion?: number;
    }) => setTaskDone(taskId, done, expectedVersion),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: projectKeys.lists() });
      queryClient.invalidateQueries({ queryKey: projectKeys.overview() });
      queryClient.invalidateQueries({ queryKey: analyticsKeys.all });
      queryClient.invalidateQueries({ queryKey: projectKeys.detail(variables.projectId) });
    },
  });
}

export function useCreateDeliverableMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ projectId, payload }: { projectId: string; payload: CreateDeliverablePayload }) =>
      createDeliverable(projectId, payload),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: projectKeys.detail(variables.projectId) });
    },
  });
}

export function useAddDeliverableRevisionMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      deliverableId,
      payload,
    }: {
      deliverableId: string;
      projectId: string;
      payload: AddDeliverableRevisionPayload;
    }) => addDeliverableRevision(deliverableId, payload),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: projectKeys.detail(variables.projectId) });
    },
  });
}

export function useCreateSupportTicketMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ projectId, payload }: { projectId: string; payload: CreateSupportTicketPayload }) =>
      createSupportTicket(projectId, payload),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: projectKeys.overview() });
      queryClient.invalidateQueries({ queryKey: analyticsKeys.all });
      queryClient.invalidateQueries({ queryKey: projectKeys.detail(variables.projectId) });
    },
  });
}

export function useUpdateSupportTicketMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      ticketId,
      payload,
    }: {
      ticketId: string;
      projectId: string;
      payload: UpdateSupportTicketPayload;
    }) => updateSupportTicket(ticketId, payload),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: projectKeys.overview() });
      queryClient.invalidateQueries({ queryKey: analyticsKeys.all });
      queryClient.invalidateQueries({ queryKey: projectKeys.detail(variables.projectId) });
    },
  });
}

export function useResolveSupportTicketMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      ticketId,
      resolution,
      expectedVersion,
    }: {
      ticketId: string;
      projectId: string;
      resolution: string;
      expectedVersion?: number;
    }) => resolveSupportTicket(ticketId, resolution, expectedVersion),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: projectKeys.overview() });
      queryClient.invalidateQueries({ queryKey: analyticsKeys.all });
      queryClient.invalidateQueries({ queryKey: projectKeys.detail(variables.projectId) });
    },
  });
}

export function useReopenSupportTicketMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      ticketId,
      reason,
      expectedVersion,
    }: {
      ticketId: string;
      projectId: string;
      reason?: string;
      expectedVersion?: number;
    }) => reopenSupportTicket(ticketId, reason, expectedVersion),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: projectKeys.overview() });
      queryClient.invalidateQueries({ queryKey: analyticsKeys.all });
      queryClient.invalidateQueries({ queryKey: projectKeys.detail(variables.projectId) });
    },
  });
}

export function useSaveProjectTemplateMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: SaveProjectTemplatePayload) => saveProjectTemplate(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: projectKeys.templates.lists() });
    },
  });
}
