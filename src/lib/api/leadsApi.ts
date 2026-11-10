import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest, createIdempotencyKey } from "./client";
import {
  leadArchiveRestoreResponseSchema,
  leadCreateResponseSchema,
  leadGetResponseSchema,
  leadsListResponseSchema,
  leadUpdateResponseSchema,
  type LeadActivityDto,
  type LeadDto,
  type LeadLifecycleApi,
  type LeadPriorityApi,
  type LeadSourceApi,
  type LeadStatusApi,
  type LeadsListResponse,
  type QuickStatusApi,
} from "./schemas";
import { activityKeys } from "./activitiesApi";
import { analyticsKeys } from "./analyticsApi";

export type LeadSortOption = "recent" | "updated" | "score" | "value" | "name";
export type LeadFollowUpFilter = "all" | "overdue" | "today" | "week" | "none";

export interface LeadsListFilters {
  q?: string | undefined;
  lifecycle?: LeadLifecycleApi | "all" | undefined;
  status?: LeadStatusApi | "all" | undefined;
  source?: LeadSourceApi | "all" | undefined;
  priority?: LeadPriorityApi | "all" | undefined;
  quickStatus?: QuickStatusApi | "all" | "none" | undefined;
  followUp?: LeadFollowUpFilter | undefined;
  createdFrom?: string | undefined;
  createdTo?: string | undefined;
  tagId?: string | undefined;
  viewId?: string | undefined;
  sort?: LeadSortOption | undefined;
  pinnedFirst?: boolean | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
}

export interface CreateLeadPayload {
  name: string;
  phone: string;
  email?: string | undefined;
  company?: string | undefined;
  requirement?: string | undefined;
  source?: LeadSourceApi | undefined;
  status?: LeadStatusApi | undefined;
  priority?: LeadPriorityApi | undefined;
  aiScore?: number | undefined;
  quotedAmount?: number | undefined;
  budget?: number | undefined;
  notes?: string | undefined;
  pinned?: boolean | undefined;
  quickStatus?: QuickStatusApi | undefined;
  lostReason?: string | undefined;
  allowDuplicate?: boolean | undefined;
}

export interface UpdateLeadPayload {
  version: number;
  name?: string | undefined;
  phone?: string | undefined;
  email?: string | null | undefined;
  company?: string | null | undefined;
  requirement?: string | null | undefined;
  source?: LeadSourceApi | undefined;
  status?: LeadStatusApi | undefined;
  priority?: LeadPriorityApi | undefined;
  aiScore?: number | null | undefined;
  quotedAmount?: number | null | undefined;
  budget?: number | null | undefined;
  notes?: string | null | undefined;
  pinned?: boolean | undefined;
  quickStatus?: QuickStatusApi | null | undefined;
  lostReason?: string | null | undefined;
  allowDuplicate?: boolean | undefined;
}

export interface ArchiveLeadPayload {
  kind: "waste" | "deleted";
  version: number;
  reason?: string | undefined;
}

export interface RestoreLeadPayload {
  version?: number | undefined;
}

export const leadKeys = {
  all: ["crm", "leads"] as const,
  lists: () => [...leadKeys.all, "list"] as const,
  list: (filters: LeadsListFilters) => [...leadKeys.lists(), filters] as const,
  details: () => [...leadKeys.all, "detail"] as const,
  detail: (id: string) => [...leadKeys.details(), id] as const,
};

export async function listLeads(
  filters: LeadsListFilters = {},
  signal?: AbortSignal,
): Promise<LeadsListResponse> {
  return apiRequest({
    path: "/api/v1/leads",
    method: "GET",
    query: {
      q: filters.q?.trim() || undefined,
      lifecycle: filters.lifecycle ?? "active",
      status: filters.status ?? "all",
      source: filters.source ?? "all",
      priority: filters.priority ?? "all",
      quickStatus: filters.quickStatus ?? "all",
      followUp: filters.followUp ?? "all",
      createdFrom: filters.createdFrom,
      createdTo: filters.createdTo,
      tagId: filters.tagId,
      viewId: filters.viewId,
      sort: filters.sort ?? "recent",
      pinnedFirst: filters.pinnedFirst ?? true,
      limit: filters.limit ?? 50,
      offset: filters.offset ?? 0,
    },
    schema: leadsListResponseSchema,
    ...(signal ? { signal } : {}),
  });
}

export async function getLead(id: string, signal?: AbortSignal): Promise<LeadDto> {
  const res = await apiRequest({
    path: `/api/v1/leads/${encodeURIComponent(id)}`,
    method: "GET",
    schema: leadGetResponseSchema,
    ...(signal ? { signal } : {}),
  });
  return res.lead;
}

export async function createLead(
  payload: CreateLeadPayload,
  idempotencyKey: string = createIdempotencyKey(),
): Promise<{ lead: LeadDto; activity: LeadActivityDto }> {
  const res = await apiRequest({
    path: "/api/v1/leads",
    method: "POST",
    body: { ...payload, idempotencyKey },
    idempotencyKey,
    schema: leadCreateResponseSchema,
  });
  return { lead: res.lead, activity: res.activity };
}

export async function updateLead(
  id: string,
  payload: UpdateLeadPayload,
  idempotencyKey?: string,
): Promise<{ lead: LeadDto; activities: LeadActivityDto[] }> {
  const res = await apiRequest({
    path: `/api/v1/leads/${encodeURIComponent(id)}`,
    method: "PATCH",
    body: payload,
    ...(idempotencyKey ? { idempotencyKey } : {}),
    schema: leadUpdateResponseSchema,
  });
  return { lead: res.lead, activities: res.activities };
}

export async function archiveLead(
  id: string,
  payload: ArchiveLeadPayload,
  idempotencyKey: string = createIdempotencyKey(),
): Promise<{ lead: LeadDto; activity: LeadActivityDto }> {
  const res = await apiRequest({
    path: `/api/v1/leads/${encodeURIComponent(id)}/archive`,
    method: "POST",
    body: { ...payload, idempotencyKey },
    idempotencyKey,
    schema: leadArchiveRestoreResponseSchema,
  });
  return { lead: res.lead, activity: res.activity };
}

export async function restoreLead(
  id: string,
  payload: RestoreLeadPayload = {},
  idempotencyKey: string = createIdempotencyKey(),
): Promise<{ lead: LeadDto; activity: LeadActivityDto }> {
  const res = await apiRequest({
    path: `/api/v1/leads/${encodeURIComponent(id)}/restore`,
    method: "POST",
    body: { ...payload, idempotencyKey },
    idempotencyKey,
    schema: leadArchiveRestoreResponseSchema,
  });
  return { lead: res.lead, activity: res.activity };
}

export function useLeadsListQuery(filters: LeadsListFilters, enabled = true) {
  return useQuery({
    queryKey: leadKeys.list(filters),
    queryFn: ({ signal }) => listLeads(filters, signal),
    enabled,
    staleTime: 10_000,
  });
}

export function useLeadQuery(id: string | undefined, enabled = true) {
  return useQuery({
    queryKey: leadKeys.detail(id ?? ""),
    queryFn: ({ signal }) => getLead(id!, signal),
    enabled: Boolean(id) && enabled,
    staleTime: 10_000,
  });
}

export function useCreateLeadMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      payload,
      idempotencyKey,
    }: {
      payload: CreateLeadPayload;
      idempotencyKey?: string;
    }) => createLead(payload, idempotencyKey),
    onSuccess: (res) => {
      queryClient.setQueryData(leadKeys.detail(res.lead.id), res.lead);
      void queryClient.invalidateQueries({ queryKey: leadKeys.lists() });
      void queryClient.invalidateQueries({ queryKey: activityKeys.byLead(res.lead.id) });
      void queryClient.invalidateQueries({ queryKey: analyticsKeys.all });
    },
  });
}

export function useUpdateLeadMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      payload,
      idempotencyKey,
    }: {
      id: string;
      payload: UpdateLeadPayload;
      idempotencyKey?: string;
    }) => updateLead(id, payload, idempotencyKey),
    onSuccess: (res) => {
      queryClient.setQueryData(leadKeys.detail(res.lead.id), res.lead);
      void queryClient.invalidateQueries({ queryKey: leadKeys.lists() });
      void queryClient.invalidateQueries({ queryKey: activityKeys.byLead(res.lead.id) });
      void queryClient.invalidateQueries({ queryKey: analyticsKeys.all });
    },
  });
}

export function useArchiveLeadMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      payload,
      idempotencyKey,
    }: {
      id: string;
      payload: ArchiveLeadPayload;
      idempotencyKey?: string;
    }) => archiveLead(id, payload, idempotencyKey),
    onSuccess: (res) => {
      queryClient.setQueryData(leadKeys.detail(res.lead.id), res.lead);
      void queryClient.invalidateQueries({ queryKey: leadKeys.lists() });
      void queryClient.invalidateQueries({ queryKey: activityKeys.byLead(res.lead.id) });
      void queryClient.invalidateQueries({ queryKey: analyticsKeys.all });
    },
  });
}

export function useRestoreLeadMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      payload,
      idempotencyKey,
    }: {
      id: string;
      payload?: RestoreLeadPayload;
      idempotencyKey?: string;
    }) => restoreLead(id, payload, idempotencyKey),
    onSuccess: (res) => {
      queryClient.setQueryData(leadKeys.detail(res.lead.id), res.lead);
      void queryClient.invalidateQueries({ queryKey: leadKeys.lists() });
      void queryClient.invalidateQueries({ queryKey: activityKeys.byLead(res.lead.id) });
      void queryClient.invalidateQueries({ queryKey: analyticsKeys.all });
    },
  });
}
