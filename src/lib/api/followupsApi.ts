import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest, createIdempotencyKey } from "./client";
import {
  followUpCancelResponseSchema,
  followUpCompleteResponseSchema,
  followUpCreateResponseSchema,
  followUpGetResponseSchema,
  followUpsListResponseSchema,
  followUpUpdateResponseSchema,
  leadFollowUpsListResponseSchema,
  parseIstDateTimeInput,
  type FollowUpDto,
  type FollowUpsListResponse,
  type FollowUpTypeApi,
  type LeadLifecycleApi,
} from "./schemas";
import { activityKeys } from "./activitiesApi";
import { leadKeys } from "./leadsApi";
import { ApiError } from "./errors";

export function formatIstTimeLabel(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return "";
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    hour: "numeric",
    minute: "2-digit",
  }).format(parsed);
}

/** Asia/Kolkata has fixed UTC+05:30 (no DST), so +86,400,000ms preserves wall-clock HH:mm IST. */
export function addIstOneDaySameTimeIso(iso: string): string | null {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return null;
  return new Date(parsed.getTime() + 86_400_000).toISOString();
}

export type FollowUpBucketFilter = "all" | "pending" | "overdue" | "today" | "upcoming" | "done";

export interface ListFollowUpsFilters {
  bucket?: FollowUpBucketFilter | undefined;
  leadId?: string | undefined;
  dateIst?: string | undefined;
  type?: FollowUpTypeApi | "all" | undefined;
  leadLifecycle?: LeadLifecycleApi | "all" | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
}

export interface CreateFollowUpPayload {
  leadId: string;
  type: FollowUpTypeApi;
  /** Accepts either UTC/zoned ISO string or IST datetime-local (`YYYY-MM-DDTHH:mm`). */
  dueAt: string;
  note?: string | undefined;
  replaceActiveFollowUpId?: string | undefined;
  opId?: string | undefined;
}

export interface RescheduleFollowUpPayload {
  version: number;
  /** Accepts either UTC/zoned ISO string or IST datetime-local (`YYYY-MM-DDTHH:mm`). */
  dueAt?: string | undefined;
  note?: string | null | undefined;
}

export interface CompleteFollowUpPayload {
  version: number;
}

export interface CancelFollowUpPayload {
  version: number;
  reason?: string | undefined;
}

export const followupKeys = {
  all: ["crm", "followups"] as const,
  lists: () => [...followupKeys.all, "list"] as const,
  list: (filters: ListFollowUpsFilters) => [...followupKeys.lists(), filters] as const,
  byLead: (leadId: string) => [...followupKeys.all, "lead", leadId] as const,
  detail: (id: string) => [...followupKeys.all, "detail", id] as const,
};

function assertValidIstDueAt(rawDueAt: string): string {
  const parsed = parseIstDateTimeInput(rawDueAt);
  if (!parsed.ok) {
    throw new ApiError({
      status: 400,
      code: "validation_error",
      message: parsed.error,
      details: { dueAt: parsed.error },
    });
  }
  return parsed.utcIso;
}

export async function listFollowUps(
  filters: ListFollowUpsFilters = {},
  signal?: AbortSignal,
): Promise<FollowUpsListResponse> {
  return apiRequest({
    path: "/api/v1/follow-ups",
    method: "GET",
    query: {
      bucket: filters.bucket ?? "pending",
      leadId: filters.leadId,
      dateIst: filters.dateIst,
      type: filters.type ?? "all",
      leadLifecycle: filters.leadLifecycle ?? "active",
      limit: filters.limit ?? 50,
      offset: filters.offset ?? 0,
    },
    schema: followUpsListResponseSchema,
    ...(signal ? { signal } : {}),
  });
}

export async function listLeadFollowUps(leadId: string, signal?: AbortSignal) {
  return apiRequest({
    path: `/api/v1/leads/${encodeURIComponent(leadId)}/follow-ups`,
    method: "GET",
    schema: leadFollowUpsListResponseSchema,
    ...(signal ? { signal } : {}),
  });
}

export async function getFollowUp(id: string, signal?: AbortSignal): Promise<FollowUpDto> {
  const res = await apiRequest({
    path: `/api/v1/follow-ups/${encodeURIComponent(id)}`,
    method: "GET",
    schema: followUpGetResponseSchema,
    ...(signal ? { signal } : {}),
  });
  return res.followUp;
}

export async function createFollowUp(
  payload: CreateFollowUpPayload,
  idempotencyKey: string = payload.opId ?? createIdempotencyKey(),
) {
  const dueAtIso = assertValidIstDueAt(payload.dueAt);
  return apiRequest({
    path: "/api/v1/follow-ups",
    method: "POST",
    body: {
      leadId: payload.leadId,
      type: payload.type,
      dueAt: dueAtIso,
      ...(payload.note !== undefined && payload.note.trim() ? { note: payload.note.trim() } : {}),
      ...(payload.replaceActiveFollowUpId
        ? { replaceActiveFollowUpId: payload.replaceActiveFollowUpId }
        : {}),
      ...(payload.opId ? { opId: payload.opId } : {}),
      idempotencyKey,
    },
    idempotencyKey,
    schema: followUpCreateResponseSchema,
  });
}

export async function rescheduleFollowUp(
  id: string,
  payload: RescheduleFollowUpPayload,
  idempotencyKey: string = createIdempotencyKey(),
) {
  const dueAtIso = payload.dueAt !== undefined ? assertValidIstDueAt(payload.dueAt) : undefined;
  return apiRequest({
    path: `/api/v1/follow-ups/${encodeURIComponent(id)}`,
    method: "PATCH",
    body: {
      version: payload.version,
      ...(dueAtIso !== undefined ? { dueAt: dueAtIso } : {}),
      ...(payload.note !== undefined ? { note: payload.note } : {}),
    },
    idempotencyKey,
    schema: followUpUpdateResponseSchema,
  });
}

export async function completeFollowUp(
  id: string,
  payload: CompleteFollowUpPayload,
  idempotencyKey: string = createIdempotencyKey(),
) {
  return apiRequest({
    path: `/api/v1/follow-ups/${encodeURIComponent(id)}/complete`,
    method: "POST",
    body: { version: payload.version, idempotencyKey },
    idempotencyKey,
    schema: followUpCompleteResponseSchema,
  });
}

export async function cancelFollowUp(
  id: string,
  payload: CancelFollowUpPayload,
  idempotencyKey: string = createIdempotencyKey(),
) {
  return apiRequest({
    path: `/api/v1/follow-ups/${encodeURIComponent(id)}/cancel`,
    method: "POST",
    body: {
      version: payload.version,
      ...(payload.reason?.trim() ? { reason: payload.reason.trim() } : {}),
      idempotencyKey,
    },
    idempotencyKey,
    schema: followUpCancelResponseSchema,
  });
}

export function useFollowUpsQuery(filters: ListFollowUpsFilters = {}, enabled = true) {
  return useQuery({
    queryKey: followupKeys.list(filters),
    queryFn: ({ signal }) => listFollowUps(filters, signal),
    enabled,
    staleTime: 10_000,
  });
}

export function useLeadFollowUpsQuery(leadId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: followupKeys.byLead(leadId ?? ""),
    queryFn: ({ signal }) => listLeadFollowUps(leadId!, signal),
    enabled: Boolean(leadId) && enabled,
    staleTime: 10_000,
  });
}

export function useCreateFollowUpMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      payload,
      idempotencyKey,
    }: {
      payload: CreateFollowUpPayload;
      idempotencyKey?: string;
    }) => createFollowUp(payload, idempotencyKey),
    onSuccess: (res) => {
      queryClient.setQueryData(followupKeys.detail(res.followUp.id), res.followUp);
      void queryClient.invalidateQueries({ queryKey: followupKeys.lists() });
      void queryClient.invalidateQueries({ queryKey: followupKeys.byLead(res.followUp.leadId) });
      void queryClient.invalidateQueries({ queryKey: leadKeys.detail(res.followUp.leadId) });
      void queryClient.invalidateQueries({ queryKey: leadKeys.lists() });
      void queryClient.invalidateQueries({ queryKey: activityKeys.byLead(res.followUp.leadId) });
    },
  });
}

export function useRescheduleFollowUpMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      payload,
      idempotencyKey,
    }: {
      id: string;
      payload: RescheduleFollowUpPayload;
      idempotencyKey?: string;
    }) => rescheduleFollowUp(id, payload, idempotencyKey),
    onSuccess: (res) => {
      queryClient.setQueryData(followupKeys.detail(res.followUp.id), res.followUp);
      void queryClient.invalidateQueries({ queryKey: followupKeys.lists() });
      void queryClient.invalidateQueries({ queryKey: followupKeys.byLead(res.followUp.leadId) });
      void queryClient.invalidateQueries({ queryKey: leadKeys.detail(res.followUp.leadId) });
      void queryClient.invalidateQueries({ queryKey: leadKeys.lists() });
      void queryClient.invalidateQueries({ queryKey: activityKeys.byLead(res.followUp.leadId) });
    },
  });
}

export function useCompleteFollowUpMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      payload,
      idempotencyKey,
    }: {
      id: string;
      payload: CompleteFollowUpPayload;
      idempotencyKey?: string;
    }) => completeFollowUp(id, payload, idempotencyKey),
    onSuccess: (res) => {
      queryClient.setQueryData(followupKeys.detail(res.followUp.id), res.followUp);
      void queryClient.invalidateQueries({ queryKey: followupKeys.lists() });
      void queryClient.invalidateQueries({ queryKey: followupKeys.byLead(res.followUp.leadId) });
      void queryClient.invalidateQueries({ queryKey: leadKeys.detail(res.followUp.leadId) });
      void queryClient.invalidateQueries({ queryKey: leadKeys.lists() });
      void queryClient.invalidateQueries({ queryKey: activityKeys.byLead(res.followUp.leadId) });
    },
  });
}

export function useCancelFollowUpMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      payload,
      idempotencyKey,
    }: {
      id: string;
      payload: CancelFollowUpPayload;
      idempotencyKey?: string;
    }) => cancelFollowUp(id, payload, idempotencyKey),
    onSuccess: (res) => {
      queryClient.setQueryData(followupKeys.detail(res.followUp.id), res.followUp);
      void queryClient.invalidateQueries({ queryKey: followupKeys.lists() });
      void queryClient.invalidateQueries({ queryKey: followupKeys.byLead(res.followUp.leadId) });
      void queryClient.invalidateQueries({ queryKey: leadKeys.detail(res.followUp.leadId) });
      void queryClient.invalidateQueries({ queryKey: leadKeys.lists() });
      void queryClient.invalidateQueries({ queryKey: activityKeys.byLead(res.followUp.leadId) });
    },
  });
}
