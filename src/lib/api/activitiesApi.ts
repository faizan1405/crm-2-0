import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest, createIdempotencyKey } from "./client";
import {
  leadActivitiesListResponseSchema,
  leadActivityCreateResponseSchema,
  type ActivityTypeApi,
  type LeadActivityDto,
  type ManualActivityTypeApi,
} from "./schemas";

export interface ListActivitiesFilters {
  type?: ActivityTypeApi | "all" | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
}

export interface CreateActivityPayload {
  type: ManualActivityTypeApi;
  text: string;
  opId?: string | undefined;
}

export const activityKeys = {
  all: ["crm", "activities"] as const,
  byLead: (leadId: string) => [...activityKeys.all, "lead", leadId] as const,
  list: (leadId: string, filters: ListActivitiesFilters) =>
    [...activityKeys.byLead(leadId), filters] as const,
};

export async function listLeadActivities(
  leadId: string,
  filters: ListActivitiesFilters = {},
  signal?: AbortSignal,
) {
  return apiRequest({
    path: `/api/v1/leads/${encodeURIComponent(leadId)}/activities`,
    method: "GET",
    query: {
      type: filters.type ?? "all",
      limit: filters.limit ?? 50,
      offset: filters.offset ?? 0,
    },
    schema: leadActivitiesListResponseSchema,
    ...(signal ? { signal } : {}),
  });
}

export async function createLeadActivity(
  leadId: string,
  payload: CreateActivityPayload,
  idempotencyKey: string = payload.opId ?? createIdempotencyKey(),
): Promise<LeadActivityDto> {
  const res = await apiRequest({
    path: `/api/v1/leads/${encodeURIComponent(leadId)}/activities`,
    method: "POST",
    body: {
      type: payload.type,
      text: payload.text,
      ...(payload.opId ? { opId: payload.opId } : {}),
      idempotencyKey,
    },
    idempotencyKey,
    schema: leadActivityCreateResponseSchema,
  });
  return res.activity;
}

export function useLeadActivitiesQuery(
  leadId: string | undefined,
  filters: ListActivitiesFilters = {},
  enabled = true,
) {
  return useQuery({
    queryKey: activityKeys.list(leadId ?? "", filters),
    queryFn: ({ signal }) => listLeadActivities(leadId!, filters, signal),
    enabled: Boolean(leadId) && enabled,
    staleTime: 10_000,
  });
}

export function useCreateActivityMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      leadId,
      payload,
      idempotencyKey,
    }: {
      leadId: string;
      payload: CreateActivityPayload;
      idempotencyKey?: string;
    }) => createLeadActivity(leadId, payload, idempotencyKey),
    onSuccess: (activity) => {
      void queryClient.invalidateQueries({ queryKey: activityKeys.byLead(activity.leadId) });
    },
  });
}
