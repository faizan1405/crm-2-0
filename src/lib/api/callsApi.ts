import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest, createIdempotencyKey } from "./client";
import { activityKeys } from "./activitiesApi";
import { followupKeys } from "./followupsApi";
import { leadKeys } from "./leadsApi";
import {
  callCreateResponseSchema,
  callGetResponseSchema,
  callsListResponseSchema,
  leadCallsListResponseSchema,
  type CallCreateResponse,
  type CallLogDto,
  type CallOutcomeApi,
  type CallsListResponse,
  type LeadCallsListResponse,
  type LeadLifecycleApi,
  type LeadStatusApi,
} from "./schemas";

export interface ListCallsFilters {
  leadId?: string | undefined;
  outcome?: CallOutcomeApi | "all" | undefined;
  connected?: "all" | "true" | "false" | undefined;
  dateIst?: string | undefined;
  leadLifecycle?: LeadLifecycleApi | "all" | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
}

export interface ListLeadCallsFilters {
  outcome?: CallOutcomeApi | "all" | undefined;
  connected?: "all" | "true" | "false" | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
}

export interface CreateCallPayload {
  leadId: string;
  outcome: CallOutcomeApi;
  notes?: string | undefined;
  stage?: LeadStatusApi | undefined;
  confirmed?: boolean | undefined;
  lostReason?: string | undefined;
  dialSource?: string | undefined;
  expectedLeadVersion?: number | undefined;
  opId?: string | undefined;
}

export const callKeys = {
  all: ["crm", "calls"] as const,
  lists: () => [...callKeys.all, "list"] as const,
  list: (filters: ListCallsFilters) => [...callKeys.lists(), filters] as const,
  byLead: (leadId: string, filters?: ListLeadCallsFilters) =>
    [...callKeys.all, "lead", leadId, filters ?? {}] as const,
  detail: (id: string) => [...callKeys.all, "detail", id] as const,
};

export async function listCalls(
  filters: ListCallsFilters = {},
  signal?: AbortSignal,
): Promise<CallsListResponse> {
  return apiRequest({
    path: "/api/v1/calls",
    method: "GET",
    query: {
      leadId: filters.leadId,
      outcome: filters.outcome ?? "all",
      connected: filters.connected ?? "all",
      dateIst: filters.dateIst,
      leadLifecycle: filters.leadLifecycle ?? "active",
      limit: filters.limit ?? 50,
      offset: filters.offset ?? 0,
    },
    schema: callsListResponseSchema,
    ...(signal ? { signal } : {}),
  });
}

export async function listLeadCalls(
  leadId: string,
  filters: ListLeadCallsFilters = {},
  signal?: AbortSignal,
): Promise<LeadCallsListResponse> {
  return apiRequest({
    path: `/api/v1/leads/${encodeURIComponent(leadId)}/calls`,
    method: "GET",
    query: {
      outcome: filters.outcome ?? "all",
      connected: filters.connected ?? "all",
      limit: filters.limit ?? 50,
      offset: filters.offset ?? 0,
    },
    schema: leadCallsListResponseSchema,
    ...(signal ? { signal } : {}),
  });
}

export async function getCall(id: string, signal?: AbortSignal): Promise<CallLogDto> {
  const res = await apiRequest({
    path: `/api/v1/calls/${encodeURIComponent(id)}`,
    method: "GET",
    schema: callGetResponseSchema,
    ...(signal ? { signal } : {}),
  });
  return res.call;
}

export async function createCall(
  payload: CreateCallPayload,
  idempotencyKey: string = payload.opId ?? createIdempotencyKey(),
): Promise<CallCreateResponse> {
  const cleanNotes = payload.notes?.trim();
  const cleanReason = payload.lostReason?.trim();
  const cleanSource = payload.dialSource?.trim();

  return apiRequest({
    path: "/api/v1/calls",
    method: "POST",
    body: {
      leadId: payload.leadId,
      outcome: payload.outcome,
      ...(cleanNotes ? { notes: cleanNotes } : {}),
      ...(payload.stage ? { stage: payload.stage } : {}),
      ...(payload.confirmed !== undefined ? { confirmed: payload.confirmed } : {}),
      ...(cleanReason ? { lostReason: cleanReason } : {}),
      ...(cleanSource ? { dialSource: cleanSource } : {}),
      ...(payload.expectedLeadVersion !== undefined
        ? { expectedLeadVersion: payload.expectedLeadVersion }
        : {}),
      ...(payload.opId ? { opId: payload.opId } : {}),
      idempotencyKey,
    },
    idempotencyKey,
    schema: callCreateResponseSchema,
  });
}

export function useCallsQuery(filters: ListCallsFilters = {}, enabled = true) {
  return useQuery({
    queryKey: callKeys.list(filters),
    queryFn: ({ signal }) => listCalls(filters, signal),
    enabled,
    staleTime: 10_000,
  });
}

export function useLeadCallsQuery(
  leadId: string | undefined,
  filters: ListLeadCallsFilters = {},
  enabled = true,
) {
  return useQuery({
    queryKey: callKeys.byLead(leadId ?? "", filters),
    queryFn: ({ signal }) => listLeadCalls(leadId!, filters, signal),
    enabled: Boolean(leadId) && enabled,
    staleTime: 10_000,
  });
}

export function useCreateCallMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      payload,
      idempotencyKey,
    }: {
      payload: CreateCallPayload;
      idempotencyKey?: string;
    }) => createCall(payload, idempotencyKey),
    onSuccess: (res) => {
      queryClient.setQueryData(callKeys.detail(res.call.id), res.call);
      queryClient.setQueryData(leadKeys.detail(res.lead.id), res.lead);
      void queryClient.invalidateQueries({ queryKey: callKeys.lists() });
      void queryClient.invalidateQueries({ queryKey: callKeys.byLead(res.lead.id) });
      void queryClient.invalidateQueries({ queryKey: leadKeys.lists() });
      void queryClient.invalidateQueries({ queryKey: activityKeys.byLead(res.lead.id) });
      void queryClient.invalidateQueries({ queryKey: followupKeys.byLead(res.lead.id) });
      void queryClient.invalidateQueries({ queryKey: followupKeys.lists() });
    },
  });
}
