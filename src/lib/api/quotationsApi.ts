import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest, buildApiUrl, createIdempotencyKey } from "./client";
export { createIdempotencyKey } from "./client";
import {
  leadQuotationsListResponseSchema,
  quotationArchiveResponseSchema,
  quotationAuditResponseSchema,
  quotationCreateResponseSchema,
  quotationGetResponseSchema,
  quotationRevisionsResponseSchema,
  quotationsListResponseSchema,
  quotationStatusResponseSchema,
  quotationTemplateCreateResponseSchema,
  quotationTemplateDeleteResponseSchema,
  quotationTemplateDuplicateResponseSchema,
  quotationTemplateGetResponseSchema,
  quotationTemplateReorderResponseSchema,
  quotationTemplatesListResponseSchema,
  quotationTemplateUpdateResponseSchema,
  quotationUpdateResponseSchema,
  type LeadQuotationsListResponse,
  type QuotationArchiveResponse,
  type QuotationAuditEventDto,
  type QuotationAuditResponse,
  type QuotationCreateResponse,
  type QuotationDiscountTypeApi,
  type QuotationDto,
  type QuotationGetResponse,
  type QuotationItemDto,
  type QuotationMilestoneDto,
  type QuotationRevisionDto,
  type QuotationRevisionsResponse,
  type QuotationsListResponse,
  type QuotationStatusApi,
  type QuotationStatusResponse,
  type QuotationTemplateCreateResponse,
  type QuotationTemplateDeleteResponse,
  type QuotationTemplateDto,
  type QuotationTemplateDuplicateResponse,
  type QuotationTemplateGetResponse,
  type QuotationTemplateReorderResponse,
  type QuotationTemplatesListResponse,
  type QuotationTemplateUpdateResponse,
  type QuotationUpdateResponse,
} from "./schemas";
import { leadKeys } from "./leadsApi";

// ---------------------------------------------------------------------------
// Query Keys
// ---------------------------------------------------------------------------

export const quotationKeys = {
  all: ["quotations"] as const,
  lists: () => [...quotationKeys.all, "list"] as const,
  list: (filters: QuotationsListFilters) => [...quotationKeys.lists(), filters] as const,
  details: () => [...quotationKeys.all, "detail"] as const,
  detail: (id: string) => [...quotationKeys.details(), id] as const,
  revisions: (id: string) => [...quotationKeys.detail(id), "revisions"] as const,
  audit: (id: string) => [...quotationKeys.detail(id), "audit"] as const,
  leadQuotations: (leadId: string) => [...quotationKeys.all, "lead", leadId] as const,
  templates: {
    all: ["quotation-templates"] as const,
    lists: () => [...quotationKeys.templates.all, "list"] as const,
    list: (options?: { includeArchived?: boolean }) => [...quotationKeys.templates.lists(), options ?? {}] as const,
    detail: (id: string) => [...quotationKeys.templates.all, "detail", id] as const,
  },
};

// ---------------------------------------------------------------------------
// Payload Types
// ---------------------------------------------------------------------------

export interface QuotationsListFilters {
  q?: string | undefined;
  status?: QuotationStatusApi | "all" | undefined;
  leadId?: string | undefined;
  includeArchived?: boolean | undefined;
  sort?: "recent" | "amount" | "status" | "title" | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
}

export interface CreateQuotationTemplatePayload {
  name: string;
  priceType?: "fixed" | "custom" | undefined;
  priceAmount?: number | string | undefined;
  priceLabel?: string | undefined;
  messageBody: string;
  isActive?: boolean | undefined;
  sortOrder?: number | undefined;
  idempotencyKey?: string | undefined;
}

export interface UpdateQuotationTemplatePayload {
  expectedVersion?: number | undefined;
  name?: string | undefined;
  priceType?: "fixed" | "custom" | undefined;
  priceAmount?: number | string | null | undefined;
  priceLabel?: string | null | undefined;
  messageBody?: string | undefined;
  isActive?: boolean | undefined;
  sortOrder?: number | undefined;
}

export interface CreateQuotationLineItemPayload {
  description: string;
  quantity?: number | string | undefined;
  unitPrice: number | string;
  sortOrder?: number | undefined;
}

export interface CreateQuotationMilestonePayload {
  label: string;
  percentage?: number | string | undefined;
  amount?: number | string | undefined;
  dueDate?: string | null | undefined;
  sortOrder?: number | undefined;
}

export interface CreateQuotationPayload {
  leadId?: string | null | undefined;
  dealId?: string | null | undefined;
  templateId?: string | null | undefined;
  legacyId?: string | null | undefined;
  quotationNumber?: string | undefined;
  title: string;
  clientName: string;
  clientCompany?: string | null | undefined;
  items?: CreateQuotationLineItemPayload[] | undefined;
  packagePrice?: number | string | undefined;
  discountType?: QuotationDiscountTypeApi | undefined;
  discountValue?: number | string | undefined;
  gstEnabled?: boolean | undefined;
  gstRate?: number | string | undefined;
  milestones?: CreateQuotationMilestonePayload[] | undefined;
  status?: QuotationStatusApi | undefined;
  issueIstDate?: string | undefined;
  validUntilIstDate?: string | null | undefined;
  paymentTerms?: string | null | undefined;
  notes?: string | null | undefined;
  messageBody?: string | null | undefined;
  userConfirmedSent?: boolean | undefined;
  idempotencyKey?: string | undefined;
}

export interface UpdateQuotationPayload {
  expectedVersion?: number | undefined;
  title?: string | undefined;
  clientName?: string | undefined;
  clientCompany?: string | null | undefined;
  items?: CreateQuotationLineItemPayload[] | undefined;
  packagePrice?: number | string | undefined;
  discountType?: QuotationDiscountTypeApi | undefined;
  discountValue?: number | string | undefined;
  gstEnabled?: boolean | undefined;
  gstRate?: number | string | undefined;
  milestones?: CreateQuotationMilestonePayload[] | undefined;
  validUntilIstDate?: string | null | undefined;
  paymentTerms?: string | null | undefined;
  notes?: string | null | undefined;
  messageBody?: string | null | undefined;
  changeSummary?: string | undefined;
  idempotencyKey?: string | undefined;
}

export interface ChangeQuotationStatusPayload {
  status: QuotationStatusApi;
  reason?: string | undefined;
  userConfirmedSent?: boolean | undefined;
  expectedVersion?: number | undefined;
  idempotencyKey?: string | undefined;
}

// ---------------------------------------------------------------------------
// Template API Functions
// ---------------------------------------------------------------------------

export async function listQuotationTemplates(options?: { includeArchived?: boolean }): Promise<QuotationTemplatesListResponse> {
  return apiRequest({
    path: "/api/v1/quotation-templates",
    method: "GET",
    query: {
      includeArchived: options?.includeArchived ? "true" : undefined,
    },
    schema: quotationTemplatesListResponseSchema,
  });
}

export async function getQuotationTemplate(id: string): Promise<QuotationTemplateGetResponse> {
  return apiRequest({
    path: `/api/v1/quotation-templates/${encodeURIComponent(id)}`,
    method: "GET",
    schema: quotationTemplateGetResponseSchema,
  });
}

export async function createQuotationTemplate(payload: CreateQuotationTemplatePayload): Promise<QuotationTemplateCreateResponse> {
  return apiRequest({
    path: "/api/v1/quotation-templates",
    method: "POST",
    body: payload,
    ...(payload.idempotencyKey ? { idempotencyKey: payload.idempotencyKey } : {}),
    schema: quotationTemplateCreateResponseSchema,
  });
}

export async function updateQuotationTemplate(
  id: string,
  payload: UpdateQuotationTemplatePayload,
): Promise<QuotationTemplateUpdateResponse> {
  return apiRequest({
    path: `/api/v1/quotation-templates/${encodeURIComponent(id)}`,
    method: "PATCH",
    body: payload,
    schema: quotationTemplateUpdateResponseSchema,
  });
}

export async function deleteQuotationTemplate(id: string): Promise<QuotationTemplateDeleteResponse> {
  return apiRequest({
    path: `/api/v1/quotation-templates/${encodeURIComponent(id)}`,
    method: "DELETE",
    schema: quotationTemplateDeleteResponseSchema,
  });
}

export async function duplicateQuotationTemplate(id: string): Promise<QuotationTemplateDuplicateResponse> {
  return apiRequest({
    path: `/api/v1/quotation-templates/${encodeURIComponent(id)}/duplicate`,
    method: "POST",
    schema: quotationTemplateDuplicateResponseSchema,
  });
}

export async function reorderQuotationTemplates(templateIds: string[]): Promise<QuotationTemplateReorderResponse> {
  return apiRequest({
    path: "/api/v1/quotation-templates/reorder",
    method: "POST",
    body: { templateIds },
    schema: quotationTemplateReorderResponseSchema,
  });
}

// ---------------------------------------------------------------------------
// Quotation API Functions
// ---------------------------------------------------------------------------

export async function listQuotations(filters: QuotationsListFilters = {}): Promise<QuotationsListResponse> {
  return apiRequest({
    path: "/api/v1/quotations",
    method: "GET",
    query: {
      q: filters.q,
      status: filters.status && filters.status !== "all" ? filters.status : undefined,
      leadId: filters.leadId,
      includeArchived: filters.includeArchived ? "true" : undefined,
      sort: filters.sort,
      limit: filters.limit !== undefined ? filters.limit : undefined,
      offset: filters.offset !== undefined ? filters.offset : undefined,
    },
    schema: quotationsListResponseSchema,
  });
}

export async function getQuotation(id: string): Promise<QuotationGetResponse> {
  return apiRequest({
    path: `/api/v1/quotations/${encodeURIComponent(id)}`,
    method: "GET",
    schema: quotationGetResponseSchema,
  });
}

export async function createQuotation(payload: CreateQuotationPayload): Promise<QuotationCreateResponse> {
  return apiRequest({
    path: "/api/v1/quotations",
    method: "POST",
    body: payload,
    ...(payload.idempotencyKey ? { idempotencyKey: payload.idempotencyKey } : {}),
    schema: quotationCreateResponseSchema,
  });
}

export async function updateQuotation(id: string, payload: UpdateQuotationPayload): Promise<QuotationUpdateResponse> {
  return apiRequest({
    path: `/api/v1/quotations/${encodeURIComponent(id)}`,
    method: "PATCH",
    body: payload,
    ...(payload.idempotencyKey ? { idempotencyKey: payload.idempotencyKey } : {}),
    schema: quotationUpdateResponseSchema,
  });
}

export async function changeQuotationStatus(
  id: string,
  payload: ChangeQuotationStatusPayload,
): Promise<QuotationStatusResponse> {
  return apiRequest({
    path: `/api/v1/quotations/${encodeURIComponent(id)}/status`,
    method: "POST",
    body: payload,
    ...(payload.idempotencyKey ? { idempotencyKey: payload.idempotencyKey } : {}),
    schema: quotationStatusResponseSchema,
  });
}

export async function archiveQuotation(id: string, reason?: string): Promise<QuotationArchiveResponse> {
  return apiRequest({
    path: `/api/v1/quotations/${encodeURIComponent(id)}/archive`,
    method: "POST",
    body: reason ? { reason } : {},
    schema: quotationArchiveResponseSchema,
  });
}

export async function restoreQuotation(id: string): Promise<QuotationArchiveResponse> {
  return apiRequest({
    path: `/api/v1/quotations/${encodeURIComponent(id)}/restore`,
    method: "POST",
    schema: quotationArchiveResponseSchema,
  });
}

export async function listQuotationRevisions(
  id: string,
  query?: { limit?: number; offset?: number },
): Promise<QuotationRevisionsResponse> {
  return apiRequest({
    path: `/api/v1/quotations/${encodeURIComponent(id)}/revisions`,
    method: "GET",
    query: {
      limit: query?.limit,
      offset: query?.offset,
    },
    schema: quotationRevisionsResponseSchema,
  });
}

export async function listQuotationAuditEvents(
  id: string,
  query?: { limit?: number; offset?: number; eventType?: string },
): Promise<QuotationAuditResponse> {
  return apiRequest({
    path: `/api/v1/quotations/${encodeURIComponent(id)}/audit`,
    method: "GET",
    query: {
      limit: query?.limit,
      offset: query?.offset,
      eventType: query?.eventType,
    },
    schema: quotationAuditResponseSchema,
  });
}

export async function listLeadQuotations(
  leadId: string,
  query?: { limit?: number; offset?: number },
): Promise<LeadQuotationsListResponse> {
  return apiRequest({
    path: `/api/v1/leads/${encodeURIComponent(leadId)}/quotations`,
    method: "GET",
    query: {
      limit: query?.limit,
      offset: query?.offset,
    },
    schema: leadQuotationsListResponseSchema,
  });
}

// ---------------------------------------------------------------------------
// React Query Hooks
// ---------------------------------------------------------------------------

export function useQuotationTemplatesQuery(options?: { includeArchived?: boolean }) {
  return useQuery({
    queryKey: quotationKeys.templates.list(options),
    queryFn: () => listQuotationTemplates(options),
  });
}

export function useCreateQuotationTemplateMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateQuotationTemplatePayload) => createQuotationTemplate(payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: quotationKeys.templates.all });
    },
  });
}

export function useUpdateQuotationTemplateMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: UpdateQuotationTemplatePayload }) =>
      updateQuotationTemplate(id, payload),
    onSuccess: (_, vars) => {
      void qc.invalidateQueries({ queryKey: quotationKeys.templates.all });
      void qc.invalidateQueries({ queryKey: quotationKeys.templates.detail(vars.id) });
    },
  });
}

export function useDeleteQuotationTemplateMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteQuotationTemplate(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: quotationKeys.templates.all });
    },
  });
}

export function useDuplicateQuotationTemplateMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => duplicateQuotationTemplate(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: quotationKeys.templates.all });
    },
  });
}

export function useReorderQuotationTemplatesMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (templateIds: string[]) => reorderQuotationTemplates(templateIds),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: quotationKeys.templates.all });
    },
  });
}

export function useQuotationsQuery(filters: QuotationsListFilters = {}) {
  return useQuery({
    queryKey: quotationKeys.list(filters),
    queryFn: () => listQuotations(filters),
  });
}

export function useQuotationQuery(id: string) {
  return useQuery({
    queryKey: quotationKeys.detail(id),
    queryFn: () => getQuotation(id),
    enabled: Boolean(id),
  });
}

export function useCreateQuotationMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateQuotationPayload) => createQuotation(payload),
    onSuccess: (data) => {
      void qc.invalidateQueries({ queryKey: quotationKeys.lists() });
      if (data.quotation.leadId) {
        void qc.invalidateQueries({ queryKey: quotationKeys.leadQuotations(data.quotation.leadId) });
        void qc.invalidateQueries({ queryKey: leadKeys.detail(data.quotation.leadId) });
      }
    },
  });
}

export function useUpdateQuotationMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: UpdateQuotationPayload }) =>
      updateQuotation(id, payload),
    onSuccess: (data, vars) => {
      void qc.invalidateQueries({ queryKey: quotationKeys.detail(vars.id) });
      void qc.invalidateQueries({ queryKey: quotationKeys.revisions(vars.id) });
      void qc.invalidateQueries({ queryKey: quotationKeys.audit(vars.id) });
      void qc.invalidateQueries({ queryKey: quotationKeys.lists() });
      if (data.quotation.leadId) {
        void qc.invalidateQueries({ queryKey: quotationKeys.leadQuotations(data.quotation.leadId) });
      }
    },
  });
}

export function useChangeQuotationStatusMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: ChangeQuotationStatusPayload }) =>
      changeQuotationStatus(id, payload),
    onSuccess: (data, vars) => {
      void qc.invalidateQueries({ queryKey: quotationKeys.detail(vars.id) });
      void qc.invalidateQueries({ queryKey: quotationKeys.revisions(vars.id) });
      void qc.invalidateQueries({ queryKey: quotationKeys.audit(vars.id) });
      void qc.invalidateQueries({ queryKey: quotationKeys.lists() });
      if (data.quotation.leadId) {
        void qc.invalidateQueries({ queryKey: quotationKeys.leadQuotations(data.quotation.leadId) });
      }
    },
  });
}

export function useArchiveQuotationMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string }) => archiveQuotation(id, reason),
    onSuccess: (data, vars) => {
      void qc.invalidateQueries({ queryKey: quotationKeys.detail(vars.id) });
      void qc.invalidateQueries({ queryKey: quotationKeys.lists() });
      if (data.quotation.leadId) {
        void qc.invalidateQueries({ queryKey: quotationKeys.leadQuotations(data.quotation.leadId) });
      }
    },
  });
}

export function useRestoreQuotationMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => restoreQuotation(id),
    onSuccess: (data, id) => {
      void qc.invalidateQueries({ queryKey: quotationKeys.detail(id) });
      void qc.invalidateQueries({ queryKey: quotationKeys.lists() });
      if (data.quotation.leadId) {
        void qc.invalidateQueries({ queryKey: quotationKeys.leadQuotations(data.quotation.leadId) });
      }
    },
  });
}

export function useQuotationRevisionsQuery(id: string, query?: { limit?: number; offset?: number }) {
  return useQuery({
    queryKey: [...quotationKeys.revisions(id), query ?? {}],
    queryFn: () => listQuotationRevisions(id, query),
    enabled: Boolean(id),
  });
}

export function useQuotationAuditEventsQuery(
  id: string,
  query?: { limit?: number; offset?: number; eventType?: string },
) {
  return useQuery({
    queryKey: [...quotationKeys.audit(id), query ?? {}],
    queryFn: () => listQuotationAuditEvents(id, query),
    enabled: Boolean(id),
  });
}

export function useLeadQuotationsQuery(leadId: string, query?: { limit?: number; offset?: number }) {
  return useQuery({
    queryKey: [...quotationKeys.leadQuotations(leadId), query ?? {}],
    queryFn: () => listLeadQuotations(leadId, query),
    enabled: Boolean(leadId),
  });
}
