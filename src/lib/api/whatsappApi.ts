import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest, createIdempotencyKey } from "./client";
import { activityKeys } from "./activitiesApi";
import { analyticsKeys } from "./analyticsApi";
import { leadKeys } from "./leadsApi";
import {
  leadWaMessagesListResponseSchema,
  waMessageCreateResponseSchema,
  waMessageGetResponseSchema,
  waMessagesListResponseSchema,
  type LeadLifecycleApi,
  type LeadWaMessagesListResponse,
  type WaMessageCreateResponse,
  type WaMessageDto,
  type WaMessagesListResponse,
  type WaPurposeApi,
} from "./schemas";

export interface ListWhatsAppFilters {
  leadId?: string | undefined;
  purpose?: WaPurposeApi | "all" | undefined;
  dateIst?: string | undefined;
  leadLifecycle?: LeadLifecycleApi | "all" | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
}

export interface ListLeadWhatsAppFilters {
  purpose?: WaPurposeApi | "all" | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
}

export interface CreateWhatsAppPayload {
  leadId: string;
  purpose: WaPurposeApi;
  templateId?: string | undefined;
  templateName?: string | undefined;
  recipientPhone?: string | undefined;
  messageText: string;
  confirmedSent: true;
  confirmationStatus?: "owner_confirmed_sent" | undefined;
  composerSource?: string | undefined;
  expectedLeadVersion?: number | undefined;
  opId?: string | undefined;
}

export const waKeys = {
  all: ["crm", "whatsapp"] as const,
  lists: () => [...waKeys.all, "list"] as const,
  list: (filters: ListWhatsAppFilters) => [...waKeys.lists(), filters] as const,
  byLead: (leadId: string, filters?: ListLeadWhatsAppFilters) =>
    [...waKeys.all, "lead", leadId, filters ?? {}] as const,
  detail: (id: string) => [...waKeys.all, "detail", id] as const,
};

export async function listWhatsAppMessages(
  filters: ListWhatsAppFilters = {},
  signal?: AbortSignal,
): Promise<WaMessagesListResponse> {
  return apiRequest({
    path: "/api/v1/whatsapp-messages",
    method: "GET",
    query: {
      leadId: filters.leadId,
      purpose: filters.purpose ?? "all",
      dateIst: filters.dateIst,
      leadLifecycle: filters.leadLifecycle ?? "active",
      limit: filters.limit ?? 50,
      offset: filters.offset ?? 0,
    },
    schema: waMessagesListResponseSchema,
    ...(signal ? { signal } : {}),
  });
}

export async function listLeadWhatsAppMessages(
  leadId: string,
  filters: ListLeadWhatsAppFilters = {},
  signal?: AbortSignal,
): Promise<LeadWaMessagesListResponse> {
  return apiRequest({
    path: `/api/v1/leads/${encodeURIComponent(leadId)}/whatsapp-messages`,
    method: "GET",
    query: {
      purpose: filters.purpose ?? "all",
      limit: filters.limit ?? 50,
      offset: filters.offset ?? 0,
    },
    schema: leadWaMessagesListResponseSchema,
    ...(signal ? { signal } : {}),
  });
}

export async function getWhatsAppMessage(id: string, signal?: AbortSignal): Promise<WaMessageDto> {
  const res = await apiRequest({
    path: `/api/v1/whatsapp-messages/${encodeURIComponent(id)}`,
    method: "GET",
    schema: waMessageGetResponseSchema,
    ...(signal ? { signal } : {}),
  });
  return res.message;
}

export async function createWhatsAppMessage(
  payload: CreateWhatsAppPayload,
  idempotencyKey: string = payload.opId ?? createIdempotencyKey(),
): Promise<WaMessageCreateResponse> {
  const cleanTemplateId = payload.templateId?.trim();
  const cleanTemplateName = payload.templateName?.trim();
  const cleanPhone = payload.recipientPhone?.trim();
  const cleanSource = payload.composerSource?.trim();

  return apiRequest({
    path: "/api/v1/whatsapp-messages",
    method: "POST",
    body: {
      leadId: payload.leadId,
      purpose: payload.purpose,
      ...(cleanTemplateId ? { templateId: cleanTemplateId } : {}),
      ...(cleanTemplateName ? { templateName: cleanTemplateName } : {}),
      ...(cleanPhone ? { recipientPhone: cleanPhone } : {}),
      messageText: payload.messageText,
      confirmedSent: payload.confirmedSent,
      confirmationStatus: payload.confirmationStatus ?? "owner_confirmed_sent",
      ...(cleanSource ? { composerSource: cleanSource } : {}),
      ...(payload.expectedLeadVersion !== undefined
        ? { expectedLeadVersion: payload.expectedLeadVersion }
        : {}),
      ...(payload.opId ? { opId: payload.opId } : {}),
      idempotencyKey,
    },
    idempotencyKey,
    schema: waMessageCreateResponseSchema,
  });
}

export function useWhatsAppMessagesQuery(filters: ListWhatsAppFilters = {}, enabled = true) {
  return useQuery({
    queryKey: waKeys.list(filters),
    queryFn: ({ signal }) => listWhatsAppMessages(filters, signal),
    enabled,
    staleTime: 10_000,
  });
}

export function useLeadWhatsAppMessagesQuery(
  leadId: string | undefined,
  filters: ListLeadWhatsAppFilters = {},
  enabled = true,
) {
  return useQuery({
    queryKey: waKeys.byLead(leadId ?? "", filters),
    queryFn: ({ signal }) => listLeadWhatsAppMessages(leadId!, filters, signal),
    enabled: Boolean(leadId) && enabled,
    staleTime: 10_000,
  });
}

export function useCreateWhatsAppMessageMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      payload,
      idempotencyKey,
    }: {
      payload: CreateWhatsAppPayload;
      idempotencyKey?: string;
    }) => createWhatsAppMessage(payload, idempotencyKey),
    onSuccess: (res) => {
      queryClient.setQueryData(waKeys.detail(res.message.id), res.message);
      queryClient.setQueryData(leadKeys.detail(res.lead.id), res.lead);
      void queryClient.invalidateQueries({ queryKey: waKeys.lists() });
      void queryClient.invalidateQueries({ queryKey: waKeys.byLead(res.lead.id) });
      void queryClient.invalidateQueries({ queryKey: leadKeys.lists() });
      void queryClient.invalidateQueries({ queryKey: activityKeys.byLead(res.lead.id) });
      void queryClient.invalidateQueries({ queryKey: analyticsKeys.all });
    },
  });
}
