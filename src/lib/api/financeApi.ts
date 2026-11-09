import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest, buildApiUrl, createIdempotencyKey } from "./client";

export { createIdempotencyKey } from "./client";
import {
  dealAuditListResponseSchema,
  dealCancelResponseSchema,
  dealCreateResponseSchema,
  dealGetResponseSchema,
  dealsListResponseSchema,
  dealStatusChangeResponseSchema,
  dealSummaryResponseSchema,
  dealUpdateResponseSchema,
  dealVerifyWonResponseSchema,
  ownerFinanceSummaryResponseSchema,
  paymentCreateResponseSchema,
  paymentGetResponseSchema,
  paymentsListResponseSchema,
  paymentVoidResponseSchema,
  proofAttachResponseSchema,
  proofGetResponseSchema,
  proofHistoryResponseSchema,
  proofRemoveResponseSchema,
  proofReplaceResponseSchema,
  type ClientTypeApi,
  type DealAuditListResponse,
  type DealCreateResponse,
  type DealDto,
  type DealFinancialSummaryDto,
  type DealsListResponse,
  type DealStatusApi,
  type FinanceEventDto,
  type OwnerFinanceSummaryDto,
  type PaymentCreateResponse,
  type PaymentDto,
  type PaymentMethodApi,
  type PaymentsListResponse,
  type PaymentStatusApi,
  type PaymentTypeApi,
  type PaymentVoidResponse,
  type ProofAttachResponse,
  type ProofHistoryResponse,
  type ProofRemoveResponse,
  type ProofReplaceResponse,
  type PaymentProofDto,
} from "./schemas";
import { leadKeys } from "./leadsApi";
import { activityKeys } from "./activitiesApi";

export interface DealsListFilters {
  q?: string | undefined;
  status?: DealStatusApi | "all" | undefined;
  leadId?: string | undefined;
  clientType?: ClientTypeApi | "all" | undefined;
  paymentStatus?: PaymentStatusApi | "all" | undefined;
  dueDateFrom?: string | undefined;
  dueDateTo?: string | undefined;
  wonFrom?: string | undefined;
  wonTo?: string | undefined;
  sort?: "recent" | "due" | "amount" | "name" | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
}

export interface CreateDealPayload {
  name: string;
  clientType: ClientTypeApi;
  clientName?: string | undefined;
  leadId?: string | undefined;
  company?: string | undefined;
  phone?: string | undefined;
  quotedAmount?: number | undefined;
  finalAmount: number;
  status?: DealStatusApi | undefined;
  dueDate?: string | undefined;
  notes?: string | undefined;
  milestones?: Array<{
    label: string;
    amount: number;
    dueDate: string;
  }> | undefined;
}

export interface UpdateDealPayload {
  version: number;
  name?: string | undefined;
  clientName?: string | undefined;
  company?: string | null | undefined;
  phone?: string | null | undefined;
  quotedAmount?: number | null | undefined;
  finalAmount?: number | undefined;
  dueDate?: string | null | undefined;
  notes?: string | null | undefined;
  milestones?: Array<{
    id?: string | undefined;
    label: string;
    amount: number;
    dueDate: string;
  }> | undefined;
}

export interface ChangeDealStatusPayload {
  version: number;
  status: "active" | "won" | "lost";
  reason?: string | undefined;
}

export interface CancelDealPayload {
  version: number;
  reason: string;
}

export interface VerifyDealWonDatePayload {
  version: number;
  wonIstDate: string;
}

export interface PaymentsListFilters {
  dealId?: string | undefined;
  status?: "posted" | "voided" | "all" | undefined;
  method?: PaymentMethodApi | "all" | undefined;
  from?: string | undefined;
  to?: string | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
}

export interface CreatePaymentPayload {
  dealId: string;
  amount: number;
  date: string;
  method: PaymentMethodApi;
  type?: PaymentTypeApi | undefined;
  reference?: string | undefined;
  notes?: string | undefined;
  idempotencyKey?: string | undefined;
}

export interface VoidPaymentPayload {
  version?: number | undefined;
  expectedVersion?: number | undefined;
  reason: string;
  idempotencyKey?: string | undefined;
}

export interface OwnerFinanceSummaryQuery {
  period?: "all_time" | "this_month" | "last_month" | "custom" | undefined;
  from?: string | undefined;
  to?: string | undefined;
  includeCancelled?: boolean | undefined;
}

export const financeKeys = {
  all: ["crm", "finance"] as const,
  deals: () => [...financeKeys.all, "deals"] as const,
  dealsList: (filters: DealsListFilters = {}) => [...financeKeys.deals(), "list", filters] as const,
  deal: (id: string) => [...financeKeys.deals(), "detail", id] as const,
  dealSummary: (id: string) => [...financeKeys.deals(), "summary", id] as const,
  dealAudit: (id: string) => [...financeKeys.deals(), "audit", id] as const,
  ownerSummary: (query: OwnerFinanceSummaryQuery = {}) =>
    [...financeKeys.all, "owner-summary", query] as const,
  payments: () => [...financeKeys.all, "payments"] as const,
  paymentsList: (filters: PaymentsListFilters = {}) =>
    [...financeKeys.payments(), "list", filters] as const,
  payment: (id: string) => [...financeKeys.payments(), "detail", id] as const,
  proof: (paymentId: string) => [...financeKeys.payments(), "proof", paymentId] as const,
  proofHistory: (paymentId: string) =>
    [...financeKeys.payments(), "proof-history", paymentId] as const,
};

// ---------------------------------------------------------------------------
// Deal Operations
// ---------------------------------------------------------------------------

export async function listDeals(
  filters: DealsListFilters = {},
  signal?: AbortSignal,
): Promise<DealsListResponse> {
  return apiRequest({
    path: "/api/v1/deals",
    query: {
      q: filters.q,
      status: filters.status,
      leadId: filters.leadId,
      clientType: filters.clientType,
      paymentStatus: filters.paymentStatus,
      dueDateFrom: filters.dueDateFrom,
      dueDateTo: filters.dueDateTo,
      wonFrom: filters.wonFrom,
      wonTo: filters.wonTo,
      sort: filters.sort,
      limit: filters.limit,
      offset: filters.offset,
    },
    schema: dealsListResponseSchema,
    ...(signal ? { signal } : {}),
  });
}

export async function getDeal(id: string, signal?: AbortSignal): Promise<DealDto> {
  const res = await apiRequest({
    path: `/api/v1/deals/${encodeURIComponent(id)}`,
    schema: dealGetResponseSchema,
    ...(signal ? { signal } : {}),
  });
  return res.deal;
}

export async function createDeal(
  payload: CreateDealPayload,
  idempotencyKey?: string,
): Promise<DealCreateResponse> {
  const key = idempotencyKey ?? createIdempotencyKey();
  return apiRequest({
    path: "/api/v1/deals",
    method: "POST",
    body: payload,
    idempotencyKey: key,
    schema: dealCreateResponseSchema,
  });
}

export async function updateDeal(
  id: string,
  payload: UpdateDealPayload,
): Promise<DealDto> {
  const res = await apiRequest({
    path: `/api/v1/deals/${encodeURIComponent(id)}`,
    method: "PATCH",
    body: payload,
    schema: dealUpdateResponseSchema,
  });
  return res.deal;
}

export async function changeDealStatus(
  id: string,
  payload: ChangeDealStatusPayload,
): Promise<DealDto> {
  const res = await apiRequest({
    path: `/api/v1/deals/${encodeURIComponent(id)}/status`,
    method: "POST",
    body: payload,
    schema: dealStatusChangeResponseSchema,
  });
  return res.deal;
}

export async function cancelDeal(
  id: string,
  payload: CancelDealPayload,
): Promise<DealDto> {
  const res = await apiRequest({
    path: `/api/v1/deals/${encodeURIComponent(id)}/cancel`,
    method: "POST",
    body: payload,
    schema: dealCancelResponseSchema,
  });
  return res.deal;
}

export async function verifyDealWonDate(
  id: string,
  payload: VerifyDealWonDatePayload,
): Promise<DealDto> {
  const res = await apiRequest({
    path: `/api/v1/deals/${encodeURIComponent(id)}/verify-won`,
    method: "POST",
    body: payload,
    schema: dealVerifyWonResponseSchema,
  });
  return res.deal;
}

export async function getDealSummary(
  id: string,
  signal?: AbortSignal,
): Promise<DealFinancialSummaryDto> {
  const res = await apiRequest({
    path: `/api/v1/deals/${encodeURIComponent(id)}/summary`,
    schema: dealSummaryResponseSchema,
    ...(signal ? { signal } : {}),
  });
  return res.summary;
}

export async function listDealAuditHistory(
  id: string,
  filters: { limit?: number; offset?: number } = {},
  signal?: AbortSignal,
): Promise<DealAuditListResponse> {
  return apiRequest({
    path: `/api/v1/deals/${encodeURIComponent(id)}/audit`,
    query: {
      limit: filters.limit,
      offset: filters.offset,
    },
    schema: dealAuditListResponseSchema,
    ...(signal ? { signal } : {}),
  });
}

export async function getOwnerFinanceSummary(
  query: OwnerFinanceSummaryQuery = {},
  signal?: AbortSignal,
): Promise<OwnerFinanceSummaryDto> {
  const res = await apiRequest({
    path: "/api/v1/finance/summary",
    query: {
      period: query.period,
      from: query.from,
      to: query.to,
      includeCancelled: query.includeCancelled,
    },
    schema: ownerFinanceSummaryResponseSchema,
    ...(signal ? { signal } : {}),
  });
  return res.summary;
}

// ---------------------------------------------------------------------------
// Payment Operations
// ---------------------------------------------------------------------------

export async function listPayments(
  filters: PaymentsListFilters = {},
  signal?: AbortSignal,
): Promise<PaymentsListResponse> {
  const path = filters.dealId
    ? `/api/v1/deals/${encodeURIComponent(filters.dealId)}/payments`
    : "/api/v1/payments";
  return apiRequest({
    path,
    query: {
      status: filters.status,
      method: filters.method,
      from: filters.from,
      to: filters.to,
      limit: filters.limit,
      offset: filters.offset,
    },
    schema: paymentsListResponseSchema,
    ...(signal ? { signal } : {}),
  });
}

export async function getPayment(id: string, signal?: AbortSignal): Promise<PaymentDto> {
  const res = await apiRequest({
    path: `/api/v1/payments/${encodeURIComponent(id)}`,
    schema: paymentGetResponseSchema,
    ...(signal ? { signal } : {}),
  });
  return res.payment;
}

export async function createPayment(
  payload: CreatePaymentPayload,
  idempotencyKey?: string,
): Promise<PaymentCreateResponse> {
  const key = idempotencyKey ?? payload.idempotencyKey ?? createIdempotencyKey();
  return apiRequest({
    path: "/api/v1/payments",
    method: "POST",
    body: payload,
    idempotencyKey: key,
    schema: paymentCreateResponseSchema,
  });
}

export async function voidPayment(
  id: string,
  payload: VoidPaymentPayload,
  idempotencyKey?: string,
): Promise<PaymentVoidResponse> {
  const key = idempotencyKey ?? payload.idempotencyKey ?? createIdempotencyKey();
  const expVer = payload.expectedVersion ?? payload.version;
  const body = {
    reason: payload.reason,
    ...(expVer !== undefined ? { expectedVersion: expVer } : {}),
    ...(payload.idempotencyKey ? { idempotencyKey: payload.idempotencyKey } : {}),
  };
  return apiRequest({
    path: `/api/v1/payments/${encodeURIComponent(id)}/void`,
    method: "POST",
    body,
    idempotencyKey: key,
    schema: paymentVoidResponseSchema,
  });
}

// ---------------------------------------------------------------------------
// Payment Proof Operations
// ---------------------------------------------------------------------------

export function buildProofDownloadUrl(
  paymentId: string,
  options?: { proofId?: string; download?: boolean },
): string {
  const base = `/api/v1/payments/${encodeURIComponent(paymentId)}/proof/download`;
  return buildApiUrl(base, {
    proofId: options?.proofId,
    download: options?.download ? "1" : undefined,
  });
}

export async function getActivePaymentProof(
  paymentId: string,
  signal?: AbortSignal,
): Promise<PaymentProofDto | null> {
  try {
    const res = await apiRequest({
      path: `/api/v1/payments/${encodeURIComponent(paymentId)}/proof`,
      schema: proofGetResponseSchema,
      ...(signal ? { signal } : {}),
    });
    return res.proof;
  } catch (err: unknown) {
    if (
      err &&
      typeof err === "object" &&
      "status" in err &&
      (err as { status: unknown }).status === 404
    ) {
      return null;
    }
    throw err;
  }
}

export async function listPaymentProofHistory(
  paymentId: string,
  signal?: AbortSignal,
): Promise<ProofHistoryResponse> {
  return apiRequest({
    path: `/api/v1/payments/${encodeURIComponent(paymentId)}/proof/history`,
    schema: proofHistoryResponseSchema,
    ...(signal ? { signal } : {}),
  });
}

export async function uploadPaymentProof(params: {
  paymentId: string;
  file: File | Blob;
  originalFileName?: string | undefined;
  reason?: string | undefined;
  idempotencyKey?: string | undefined;
}): Promise<ProofAttachResponse> {
  const { paymentId, file, originalFileName, reason, idempotencyKey } = params;
  const fileName =
    originalFileName ??
    (file instanceof File ? file.name : "payment-proof");

  const formData = new FormData();
  formData.append("file", file, fileName);
  if (reason) formData.append("reason", reason);

  const key = idempotencyKey ?? createIdempotencyKey();
  const headers: Record<string, string> = {
    accept: "application/json",
    "idempotency-key": key,
  };

  const res = await fetch(`/api/v1/payments/${encodeURIComponent(paymentId)}/proof`, {
    method: "POST",
    credentials: "same-origin",
    headers,
    body: formData,
  });

  const rawJson: unknown = await res.json();
  if (!res.ok) {
    const { ApiError } = await import("./errors");
    const parsedErr = (rawJson as { error?: { code?: string; message?: string } })?.error;
    throw new ApiError({
      message: parsedErr?.message ?? `Upload failed with status ${res.status}`,
      status: res.status,
      code: parsedErr?.code ?? "upload_error",
    });
  }

  return proofAttachResponseSchema.parse(rawJson);
}

export async function replacePaymentProof(params: {
  paymentId: string;
  file: File | Blob;
  originalFileName?: string | undefined;
  reason?: string | undefined;
  idempotencyKey?: string | undefined;
}): Promise<ProofReplaceResponse> {
  const { paymentId, file, originalFileName, reason, idempotencyKey } = params;
  const fileName =
    originalFileName ??
    (file instanceof File ? file.name : "payment-proof");

  const formData = new FormData();
  formData.append("file", file, fileName);
  if (reason) formData.append("reason", reason);

  const key = idempotencyKey ?? createIdempotencyKey();
  const headers: Record<string, string> = {
    accept: "application/json",
    "idempotency-key": key,
  };

  const res = await fetch(`/api/v1/payments/${encodeURIComponent(paymentId)}/proof`, {
    method: "PUT",
    credentials: "same-origin",
    headers,
    body: formData,
  });

  const rawJson: unknown = await res.json();
  if (!res.ok) {
    const { ApiError } = await import("./errors");
    const parsedErr = (rawJson as { error?: { code?: string; message?: string } })?.error;
    throw new ApiError({
      message: parsedErr?.message ?? `Replace failed with status ${res.status}`,
      status: res.status,
      code: parsedErr?.code ?? "replace_error",
    });
  }

  return proofReplaceResponseSchema.parse(rawJson);
}

export async function removePaymentProof(params: {
  paymentId: string;
  reason?: string | undefined;
}): Promise<ProofRemoveResponse> {
  const { paymentId, reason } = params;
  return apiRequest({
    path: `/api/v1/payments/${encodeURIComponent(paymentId)}/proof`,
    method: "DELETE",
    body: reason ? { reason } : undefined,
    schema: proofRemoveResponseSchema,
  });
}

// ---------------------------------------------------------------------------
// React Query Hooks
// ---------------------------------------------------------------------------

export function useDealsQuery(filters: DealsListFilters = {}, enabled = true) {
  return useQuery({
    queryKey: financeKeys.dealsList(filters),
    queryFn: ({ signal }) => listDeals(filters, signal),
    enabled,
    staleTime: 10_000,
  });
}

export function useDealQuery(id: string | null | undefined, enabled = true) {
  return useQuery({
    queryKey: id ? financeKeys.deal(id) : ["crm", "finance", "deal", "empty"],
    queryFn: ({ signal }) => (id ? getDeal(id, signal) : Promise.reject(new Error("No ID"))),
    enabled: Boolean(id) && enabled,
    staleTime: 10_000,
  });
}

export function useDealSummaryQuery(id: string | null | undefined, enabled = true) {
  return useQuery({
    queryKey: id ? financeKeys.dealSummary(id) : ["crm", "finance", "dealSummary", "empty"],
    queryFn: ({ signal }) => (id ? getDealSummary(id, signal) : Promise.reject(new Error("No ID"))),
    enabled: Boolean(id) && enabled,
    staleTime: 10_000,
  });
}

export function useDealAuditQuery(id: string | null | undefined, enabled = true) {
  return useQuery({
    queryKey: id ? financeKeys.dealAudit(id) : ["crm", "finance", "dealAudit", "empty"],
    queryFn: ({ signal }) => (id ? listDealAuditHistory(id, {}, signal) : Promise.reject(new Error("No ID"))),
    enabled: Boolean(id) && enabled,
    staleTime: 10_000,
  });
}

export function useOwnerFinanceSummaryQuery(query: OwnerFinanceSummaryQuery = {}, enabled = true) {
  return useQuery({
    queryKey: financeKeys.ownerSummary(query),
    queryFn: ({ signal }) => getOwnerFinanceSummary(query, signal),
    enabled,
    staleTime: 10_000,
  });
}

export function usePaymentsQuery(filters: PaymentsListFilters = {}, enabled = true) {
  return useQuery({
    queryKey: financeKeys.paymentsList(filters),
    queryFn: ({ signal }) => listPayments(filters, signal),
    enabled,
    staleTime: 10_000,
  });
}

export function usePaymentProofQuery(paymentId: string | null | undefined, enabled = true) {
  return useQuery({
    queryKey: paymentId ? financeKeys.proof(paymentId) : ["crm", "finance", "proof", "empty"],
    queryFn: ({ signal }) =>
      paymentId ? getActivePaymentProof(paymentId, signal) : Promise.resolve(null),
    enabled: Boolean(paymentId) && enabled,
    staleTime: 10_000,
  });
}

export function usePaymentProofHistoryQuery(paymentId: string | null | undefined, enabled = true) {
  return useQuery({
    queryKey: paymentId ? financeKeys.proofHistory(paymentId) : ["crm", "finance", "proofHistory", "empty"],
    queryFn: ({ signal }) =>
      paymentId
        ? listPaymentProofHistory(paymentId, signal)
        : Promise.resolve({ ok: true as const, paymentId: "", items: [], total: 0, limit: 50, offset: 0 }),
    enabled: Boolean(paymentId) && enabled,
    staleTime: 10_000,
  });
}

export function useCreateDealMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateDealPayload) => createDeal(payload),
    onSuccess: (res) => {
      void queryClient.invalidateQueries({ queryKey: financeKeys.deals() });
      void queryClient.invalidateQueries({ queryKey: financeKeys.ownerSummary() });
      if (res.deal.leadId) {
        void queryClient.invalidateQueries({ queryKey: leadKeys.detail(res.deal.leadId) });
        void queryClient.invalidateQueries({ queryKey: activityKeys.byLead(res.deal.leadId) });
      }
    },
  });
}

export function useUpdateDealMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: UpdateDealPayload }) =>
      updateDeal(id, payload),
    onSuccess: (deal) => {
      void queryClient.invalidateQueries({ queryKey: financeKeys.deals() });
      void queryClient.invalidateQueries({ queryKey: financeKeys.deal(deal.id) });
      void queryClient.invalidateQueries({ queryKey: financeKeys.dealSummary(deal.id) });
      void queryClient.invalidateQueries({ queryKey: financeKeys.ownerSummary() });
    },
  });
}

export function useChangeDealStatusMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: ChangeDealStatusPayload }) =>
      changeDealStatus(id, payload),
    onSuccess: (deal) => {
      void queryClient.invalidateQueries({ queryKey: financeKeys.deals() });
      void queryClient.invalidateQueries({ queryKey: financeKeys.deal(deal.id) });
      void queryClient.invalidateQueries({ queryKey: financeKeys.dealSummary(deal.id) });
      void queryClient.invalidateQueries({ queryKey: financeKeys.ownerSummary() });
    },
  });
}

export function useCancelDealMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: CancelDealPayload }) =>
      cancelDeal(id, payload),
    onSuccess: (deal) => {
      void queryClient.invalidateQueries({ queryKey: financeKeys.deals() });
      void queryClient.invalidateQueries({ queryKey: financeKeys.deal(deal.id) });
      void queryClient.invalidateQueries({ queryKey: financeKeys.dealSummary(deal.id) });
      void queryClient.invalidateQueries({ queryKey: financeKeys.ownerSummary() });
    },
  });
}

export function useVerifyDealWonDateMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: VerifyDealWonDatePayload }) =>
      verifyDealWonDate(id, payload),
    onSuccess: (deal) => {
      void queryClient.invalidateQueries({ queryKey: financeKeys.deals() });
      void queryClient.invalidateQueries({ queryKey: financeKeys.deal(deal.id) });
      void queryClient.invalidateQueries({ queryKey: financeKeys.dealSummary(deal.id) });
      void queryClient.invalidateQueries({ queryKey: financeKeys.ownerSummary() });
    },
  });
}

export function useCreatePaymentMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreatePaymentPayload) => createPayment(payload),
    onSuccess: (res) => {
      void queryClient.invalidateQueries({ queryKey: financeKeys.payments() });
      void queryClient.invalidateQueries({ queryKey: financeKeys.deals() });
      void queryClient.invalidateQueries({ queryKey: financeKeys.deal(res.payment.dealId) });
      void queryClient.invalidateQueries({ queryKey: financeKeys.dealSummary(res.payment.dealId) });
      void queryClient.invalidateQueries({ queryKey: financeKeys.ownerSummary() });
      void queryClient.invalidateQueries({ queryKey: financeKeys.dealAudit(res.payment.dealId) });
    },
  });
}

export function useVoidPaymentMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: VoidPaymentPayload }) =>
      voidPayment(id, payload),
    onSuccess: (res) => {
      void queryClient.invalidateQueries({ queryKey: financeKeys.payments() });
      void queryClient.invalidateQueries({ queryKey: financeKeys.payment(res.payment.id) });
      void queryClient.invalidateQueries({ queryKey: financeKeys.deals() });
      void queryClient.invalidateQueries({ queryKey: financeKeys.deal(res.payment.dealId) });
      void queryClient.invalidateQueries({ queryKey: financeKeys.dealSummary(res.payment.dealId) });
      void queryClient.invalidateQueries({ queryKey: financeKeys.ownerSummary() });
      void queryClient.invalidateQueries({ queryKey: financeKeys.dealAudit(res.payment.dealId) });
    },
  });
}

export function useUploadProofMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: {
      paymentId: string;
      file: File | Blob;
      originalFileName?: string | undefined;
      reason?: string | undefined;
    }) => uploadPaymentProof(params),
    onSuccess: (res) => {
      void queryClient.invalidateQueries({ queryKey: financeKeys.proof(res.proof.paymentId) });
      void queryClient.invalidateQueries({
        queryKey: financeKeys.proofHistory(res.proof.paymentId),
      });
      void queryClient.invalidateQueries({ queryKey: financeKeys.payments() });
      void queryClient.invalidateQueries({ queryKey: financeKeys.dealAudit(res.proof.dealId) });
    },
  });
}

export function useReplaceProofMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: {
      paymentId: string;
      file: File | Blob;
      originalFileName?: string | undefined;
      reason?: string | undefined;
    }) => replacePaymentProof(params),
    onSuccess: (res) => {
      void queryClient.invalidateQueries({ queryKey: financeKeys.proof(res.proof.paymentId) });
      void queryClient.invalidateQueries({
        queryKey: financeKeys.proofHistory(res.proof.paymentId),
      });
      void queryClient.invalidateQueries({ queryKey: financeKeys.payments() });
      void queryClient.invalidateQueries({ queryKey: financeKeys.dealAudit(res.proof.dealId) });
    },
  });
}

export function useRemoveProofMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: { paymentId: string; reason?: string | undefined }) =>
      removePaymentProof(params),
    onSuccess: (res) => {
      const p = res.removedProof ?? res.proof;
      if (p) {
        void queryClient.invalidateQueries({
          queryKey: financeKeys.proof(p.paymentId),
        });
        void queryClient.invalidateQueries({
          queryKey: financeKeys.proofHistory(p.paymentId),
        });
        void queryClient.invalidateQueries({ queryKey: financeKeys.dealAudit(p.dealId) });
      }
      void queryClient.invalidateQueries({ queryKey: financeKeys.payments() });
    },
  });
}
