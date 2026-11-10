import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useResolvedAuthState } from "@/lib/auth/authClient";
import { apiRequest, createIdempotencyKey } from "./client";
import {
  goalDetailResponseSchema,
  goalMutationResponseSchema,
  goalRevisionsResponseSchema,
  goalSingleProgressResponseSchema,
  goalStatusMutationResponseSchema,
  goalsListResponseSchema,
  goalsProgressListResponseSchema,
  type GoalDetailResponse,
  type GoalMetricKeyApi,
  type GoalMutationResponse,
  type GoalPeriodApi,
  type GoalProgressStatusApi,
  type GoalRevisionsResponse,
  type GoalScopeApi,
  type GoalSingleProgressResponse,
  type GoalStatusApi,
  type GoalStatusMutationResponse,
  type GoalTargetUnitApi,
  type GoalsListResponse,
  type GoalsProgressListResponse,
} from "./schemas";

export { createIdempotencyKey } from "./client";

// ---------------------------------------------------------------------------
// Constants, Exact INR Paise Formatting & Target Validation
// ---------------------------------------------------------------------------

export const COUNT_GOAL_MAX = 1_000_000_000;
export const MAX_DECIMAL_15_2_PAISE = 999_999_999_999_999;
const DECIMAL_STRING_RE = /^(\d{1,13})(?:\.(\d{1,2}))?$/;
const SIGNED_DECIMAL_STRING_RE = /^(-?)(\d+)(?:\.(\d{1,2}))?$/;
const ISO_DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export const GOAL_PERIOD_LABELS: Record<GoalPeriodApi, string> = {
  daily: "Daily",
  weekly: "Weekly (Mon–Sun IST)",
  monthly: "Monthly",
  custom: "Custom range",
};

export const GOAL_SCOPE_LABELS: Record<string, string> = {
  owner: "Owner workspace",
  team: "Organization team",
  employee: "Employee (disabled)",
};

export const GOAL_STATUS_LABELS: Record<GoalStatusApi, string> = {
  active: "Active",
  paused: "Paused",
  archived: "Archived",
};

export const GOAL_PROGRESS_STATUS_LABELS: Record<GoalProgressStatusApi, string> = {
  not_configured: "Target not configured",
  not_measurable: "Not measurable",
  not_started: "Not started",
  outside_range: "Outside range",
  paused: "Paused",
  archived: "Archived",
  no_activity: "No activity",
  in_progress: "In progress",
  met: "Met",
  exceeded: "Exceeded",
};

export function getTodayIstDate(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(now);
}

export function isValidIstCalendarDate(raw: string): boolean {
  if (!ISO_DAY_RE.test(raw)) return false;
  const [yStr, mStr, dStr] = raw.split("-");
  const y = Number(yStr);
  const m = Number(mStr);
  const d = Number(dStr);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() + 1 === m && dt.getUTCDate() === d;
}

export function formatIstDayLabel(day: string | null | undefined): string {
  if (!day || !ISO_DAY_RE.test(day)) return "—";
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(`${day}T12:00:00Z`));
}

/**
 * Formats a canonical INR decimal string (`"20000.30"` or `"4000.00"`) using exact Indian digit
 * grouping and integer paise precision, avoiding IEEE-754 floating-point drift.
 */
export function formatInrFromDecimalString(decimal: string | null | undefined): string {
  if (decimal == null) return "—";
  const match = SIGNED_DECIMAL_STRING_RE.exec(decimal.trim());
  if (!match) return "—";
  const sign = match[1] ?? "";
  const whole = match[2] ?? "0";
  const remStr = (match[3] ?? "").padEnd(2, "0");

  const normalizedWhole = whole.replace(/^0+(?=\d)/, "");
  let grouped: string;
  if (normalizedWhole.length <= 3) {
    grouped = normalizedWhole;
  } else {
    const last3 = normalizedWhole.slice(-3);
    const prefix = normalizedWhole.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",");
    grouped = `${prefix},${last3}`;
  }
  return remStr === "00" ? `${sign}₹${grouped}` : `${sign}₹${grouped}.${remStr}`;
}

export function formatCountValue(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-IN").format(value);
}

export function formatGoalMetricValue(params: {
  unit: GoalTargetUnitApi;
  value: number | null;
  decimal?: string | null | undefined;
}): string {
  const { unit, value, decimal } = params;
  if (unit === "count") {
    return formatCountValue(value);
  }
  if (decimal != null) {
    return formatInrFromDecimalString(decimal);
  }
  if (value != null && Number.isFinite(value)) {
    return formatInrFromDecimalString(value.toFixed(2));
  }
  return "—";
}

export function formatGoalProgressPercent(pctPercent: number | null | undefined): string {
  if (pctPercent == null || !Number.isFinite(pctPercent)) return "N/A";
  if (Number.isInteger(pctPercent)) return `${pctPercent}%`;
  const rounded = pctPercent.toFixed(1).replace(/\.0$/, "");
  return `${rounded}%`;
}

export type ParsedClientGoalTarget =
  | {
      ok: true;
      target: number | string | null;
      displayHint: string | null;
    }
  | {
      ok: false;
      error: string;
    };

/**
 * Parses a count or INR target input before sending to B6A:
 * - Unconfigured targets return `null` explicitly (never 0 or ₹1,00,000).
 * - Count targets accept positive whole integers 1..1,000,000,000.
 * - INR targets parse strictly into exact paise and pass canonical string (`"20000.30"`)
 *   to avoid JS floating-point precision loss.
 */
export function parseGoalTargetInput(
  unit: GoalTargetUnitApi,
  raw: string,
  leaveUnset: boolean,
): ParsedClientGoalTarget {
  if (leaveUnset) {
    return { ok: true, target: null, displayHint: null };
  }

  const trimmed = raw.trim();
  if (!trimmed) {
    return {
      ok: false,
      error: "Enter a positive target or choose 'Leave target unset'.",
    };
  }

  if (unit === "count") {
    if (!/^\d{1,10}$/.test(trimmed)) {
      return {
        ok: false,
        error: "Count target must be a positive whole number without decimals or signs.",
      };
    }
    const countNum = Number(trimmed);
    if (!Number.isSafeInteger(countNum) || countNum < 1 || countNum > COUNT_GOAL_MAX) {
      return {
        ok: false,
        error: `Count target must be between 1 and ${COUNT_GOAL_MAX}.`,
      };
    }
    return { ok: true, target: countNum, displayHint: formatCountValue(countNum) };
  }

  if (trimmed.startsWith("-")) {
    return { ok: false, error: "Monetary target cannot be negative." };
  }

  const match = DECIMAL_STRING_RE.exec(trimmed);
  if (!match) {
    return {
      ok: false,
      error: "Enter a valid INR target (digits only, optional up to 2 decimal places, no commas).",
    };
  }
  const whole = match[1] ?? "0";
  const frac = (match[2] ?? "").padEnd(2, "0");
  const paise = Number(whole) * 100 + Number(frac);
  if (!Number.isSafeInteger(paise) || paise <= 0 || paise > MAX_DECIMAL_15_2_PAISE) {
    return {
      ok: false,
      error: "INR target must be greater than ₹0 and within ₹9,99,99,99,99,999.99.",
    };
  }
  const normalizedWhole = String(Math.floor(paise / 100));
  const decimal = `${normalizedWhole}.${String(paise % 100).padStart(2, "0")}`;
  return {
    ok: true,
    target: decimal,
    displayHint: formatInrFromDecimalString(decimal),
  };
}

// ---------------------------------------------------------------------------
// Query Keys & Filters (Owner-Session Isolated)
// ---------------------------------------------------------------------------

export interface GoalsListFilters {
  status?: "all" | GoalStatusApi | undefined;
  metric?: "all" | GoalMetricKeyApi | undefined;
  period?: "all" | GoalPeriodApi | undefined;
  includeArchived?: boolean | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
}

export const goalsKeys = {
  root: ["crm", "goals"] as const,
  byOwner: (ownerId: string | null | undefined) =>
    [...goalsKeys.root, ownerId ?? "anonymous"] as const,
  lists: (ownerId: string | null | undefined) => [...goalsKeys.byOwner(ownerId), "list"] as const,
  list: (ownerId: string | null | undefined, filters: GoalsListFilters = {}) =>
    [...goalsKeys.lists(ownerId), filters] as const,
  details: (ownerId: string | null | undefined) =>
    [...goalsKeys.byOwner(ownerId), "detail"] as const,
  detail: (ownerId: string | null | undefined, goalId: string) =>
    [...goalsKeys.details(ownerId), goalId] as const,
  revisionsRoot: (ownerId: string | null | undefined, goalId: string) =>
    [...goalsKeys.byOwner(ownerId), "revisions", goalId] as const,
  revisions: (
    ownerId: string | null | undefined,
    goalId: string,
    query: { limit?: number; offset?: number } = {},
  ) => [...goalsKeys.revisionsRoot(ownerId, goalId), query] as const,
  progressRoot: (ownerId: string | null | undefined) =>
    [...goalsKeys.byOwner(ownerId), "progress"] as const,
  progressAll: (ownerId: string | null | undefined, asOf?: string) =>
    [...goalsKeys.progressRoot(ownerId), "all", asOf ?? "today"] as const,
  progressOne: (ownerId: string | null | undefined, goalId: string, asOf?: string) =>
    [...goalsKeys.progressRoot(ownerId), "one", goalId, asOf ?? "today"] as const,
};

// ---------------------------------------------------------------------------
// Mutation Payloads
// ---------------------------------------------------------------------------

export interface CreateGoalPayload {
  name: string;
  metric: GoalMetricKeyApi;
  scope?: GoalScopeApi | undefined;
  period: GoalPeriodApi;
  target?: number | string | null | undefined;
  customFromIst?: string | null | undefined;
  customToIst?: string | null | undefined;
  effectiveFromIst?: string | undefined;
  idempotencyKey?: string | undefined;
}

export interface UpdateGoalPayload {
  expectedVersion: number;
  name?: string | undefined;
  metric?: GoalMetricKeyApi | undefined;
  scope?: GoalScopeApi | undefined;
  period?: GoalPeriodApi | undefined;
  target?: number | string | null | undefined;
  customFromIst?: string | null | undefined;
  customToIst?: string | null | undefined;
  effectiveFromIst?: string | undefined;
  changeNote?: string | undefined;
  idempotencyKey?: string | undefined;
}

export interface ChangeGoalStatusPayload {
  status: "active" | "paused";
  reason?: string | undefined;
  expectedVersion?: number | undefined;
  idempotencyKey?: string | undefined;
}

export interface ArchiveGoalPayload {
  reason?: string | undefined;
  expectedVersion?: number | undefined;
  idempotencyKey?: string | undefined;
}

// ---------------------------------------------------------------------------
// API Client Functions
// ---------------------------------------------------------------------------

export async function listGoals(
  filters: GoalsListFilters = {},
  options?: { signal?: AbortSignal },
): Promise<GoalsListResponse> {
  return apiRequest({
    path: "/api/v1/goals",
    method: "GET",
    query: {
      status: filters.status ?? "all",
      metric: filters.metric ?? "all",
      period: filters.period ?? "all",
      includeArchived:
        filters.includeArchived !== undefined ? String(filters.includeArchived) : undefined,
      limit: filters.limit,
      offset: filters.offset,
    },
    schema: goalsListResponseSchema,
    ...(options?.signal ? { signal: options.signal } : {}),
  });
}

export async function getGoal(
  goalId: string,
  options?: { signal?: AbortSignal },
): Promise<GoalDetailResponse> {
  return apiRequest({
    path: `/api/v1/goals/${encodeURIComponent(goalId)}`,
    method: "GET",
    schema: goalDetailResponseSchema,
    ...(options?.signal ? { signal: options.signal } : {}),
  });
}

export async function createGoal(payload: CreateGoalPayload): Promise<GoalMutationResponse> {
  const idempotencyKey = payload.idempotencyKey ?? createIdempotencyKey();
  return apiRequest({
    path: "/api/v1/goals",
    method: "POST",
    idempotencyKey,
    body: { ...payload, idempotencyKey },
    schema: goalMutationResponseSchema,
  });
}

export async function updateGoal(
  goalId: string,
  payload: UpdateGoalPayload,
): Promise<GoalMutationResponse> {
  const idempotencyKey = payload.idempotencyKey ?? createIdempotencyKey();
  return apiRequest({
    path: `/api/v1/goals/${encodeURIComponent(goalId)}`,
    method: "PATCH",
    idempotencyKey,
    body: { ...payload, idempotencyKey },
    schema: goalMutationResponseSchema,
  });
}

export async function changeGoalStatus(
  goalId: string,
  payload: ChangeGoalStatusPayload,
  options?: { method?: "POST" | "PATCH" },
): Promise<GoalStatusMutationResponse> {
  const idempotencyKey = payload.idempotencyKey ?? createIdempotencyKey();
  return apiRequest({
    path: `/api/v1/goals/${encodeURIComponent(goalId)}/status`,
    method: options?.method ?? "POST",
    idempotencyKey,
    body: { ...payload, idempotencyKey },
    schema: goalStatusMutationResponseSchema,
  });
}

export async function archiveGoal(
  goalId: string,
  payload: ArchiveGoalPayload = {},
): Promise<GoalMutationResponse> {
  const idempotencyKey = payload.idempotencyKey ?? createIdempotencyKey();
  return apiRequest({
    path: `/api/v1/goals/${encodeURIComponent(goalId)}/archive`,
    method: "POST",
    idempotencyKey,
    body: { ...payload, idempotencyKey },
    schema: goalMutationResponseSchema,
  });
}

export async function listGoalRevisions(
  goalId: string,
  query: { limit?: number; offset?: number } = {},
  options?: { signal?: AbortSignal },
): Promise<GoalRevisionsResponse> {
  return apiRequest({
    path: `/api/v1/goals/${encodeURIComponent(goalId)}/revisions`,
    method: "GET",
    query: {
      limit: query.limit,
      offset: query.offset,
    },
    schema: goalRevisionsResponseSchema,
    ...(options?.signal ? { signal: options.signal } : {}),
  });
}

export async function getGoalProgress(
  goalId: string,
  asOf?: string,
  options?: { signal?: AbortSignal },
): Promise<GoalSingleProgressResponse> {
  return apiRequest({
    path: `/api/v1/goals/${encodeURIComponent(goalId)}/progress`,
    method: "GET",
    query: { asOf },
    schema: goalSingleProgressResponseSchema,
    ...(options?.signal ? { signal: options.signal } : {}),
  });
}

export async function listGoalsProgress(
  asOf?: string,
  options?: { signal?: AbortSignal },
): Promise<GoalsProgressListResponse> {
  return apiRequest({
    path: "/api/v1/goals/progress",
    method: "GET",
    query: { asOf },
    schema: goalsProgressListResponseSchema,
    ...(options?.signal ? { signal: options.signal } : {}),
  });
}

// ---------------------------------------------------------------------------
// React Query Hooks
// ---------------------------------------------------------------------------

export function useGoalsListQuery(filters: GoalsListFilters = {}, enabled = true) {
  const { status, user } = useResolvedAuthState();
  const ownerId = user?.id;
  return useQuery({
    queryKey: goalsKeys.list(ownerId, filters),
    queryFn: ({ signal }) => listGoals(filters, { signal }),
    enabled: enabled && status === "authenticated",
    staleTime: 10_000,
    retry: false,
  });
}

export function useGoalDetailQuery(goalId: string | null | undefined, enabled = true) {
  const { status, user } = useResolvedAuthState();
  const ownerId = user?.id;
  return useQuery({
    queryKey: goalId ? goalsKeys.detail(ownerId, goalId) : ["crm", "goals", "detail", "null"],
    queryFn: ({ signal }) => {
      if (!goalId) throw new Error("Goal ID is required.");
      return getGoal(goalId, { signal });
    },
    enabled: enabled && status === "authenticated" && Boolean(goalId),
    staleTime: 5_000,
    retry: false,
  });
}

export function useGoalRevisionsQuery(
  goalId: string | null | undefined,
  query: { limit?: number; offset?: number } = {},
  enabled = true,
) {
  const { status, user } = useResolvedAuthState();
  const ownerId = user?.id;
  return useQuery({
    queryKey: goalId
      ? goalsKeys.revisions(ownerId, goalId, query)
      : ["crm", "goals", "revisions", "null"],
    queryFn: ({ signal }) => {
      if (!goalId) throw new Error("Goal ID is required.");
      return listGoalRevisions(goalId, query, { signal });
    },
    enabled: enabled && status === "authenticated" && Boolean(goalId),
    staleTime: 5_000,
    retry: false,
  });
}

export function useGoalsProgressQuery(asOf?: string, enabled = true) {
  const { status, user } = useResolvedAuthState();
  const ownerId = user?.id;
  return useQuery({
    queryKey: goalsKeys.progressAll(ownerId, asOf),
    queryFn: ({ signal }) => listGoalsProgress(asOf, { signal }),
    enabled: enabled && status === "authenticated",
    staleTime: 10_000,
    retry: false,
  });
}

export function useGoalProgressQuery(
  goalId: string | null | undefined,
  asOf?: string,
  enabled = true,
) {
  const { status, user } = useResolvedAuthState();
  const ownerId = user?.id;
  return useQuery({
    queryKey: goalId
      ? goalsKeys.progressOne(ownerId, goalId, asOf)
      : ["crm", "goals", "progress", "one", "null"],
    queryFn: ({ signal }) => {
      if (!goalId) throw new Error("Goal ID is required.");
      return getGoalProgress(goalId, asOf, { signal });
    },
    enabled: enabled && status === "authenticated" && Boolean(goalId),
    staleTime: 10_000,
    retry: false,
  });
}

function invalidateAffectedGoalCaches(
  queryClient: ReturnType<typeof useQueryClient>,
  ownerId: string | undefined,
  goalId: string,
) {
  void queryClient.invalidateQueries({ queryKey: goalsKeys.lists(ownerId) });
  void queryClient.invalidateQueries({ queryKey: goalsKeys.progressRoot(ownerId) });
  void queryClient.invalidateQueries({ queryKey: goalsKeys.detail(ownerId, goalId) });
  void queryClient.invalidateQueries({ queryKey: goalsKeys.revisionsRoot(ownerId, goalId) });
}

export function useCreateGoalMutation() {
  const queryClient = useQueryClient();
  const { user } = useResolvedAuthState();
  const ownerId = user?.id;
  return useMutation({
    mutationFn: (payload: CreateGoalPayload) => createGoal(payload),
    onSuccess: (data) => {
      invalidateAffectedGoalCaches(queryClient, ownerId, data.goal.id);
    },
  });
}

export function useUpdateGoalMutation() {
  const queryClient = useQueryClient();
  const { user } = useResolvedAuthState();
  const ownerId = user?.id;
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: UpdateGoalPayload }) =>
      updateGoal(id, payload),
    onSuccess: (data) => {
      invalidateAffectedGoalCaches(queryClient, ownerId, data.goal.id);
    },
  });
}

export function useChangeGoalStatusMutation() {
  const queryClient = useQueryClient();
  const { user } = useResolvedAuthState();
  const ownerId = user?.id;
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: ChangeGoalStatusPayload }) =>
      changeGoalStatus(id, payload),
    onSuccess: (data) => {
      invalidateAffectedGoalCaches(queryClient, ownerId, data.goal.id);
    },
  });
}

export function useArchiveGoalMutation() {
  const queryClient = useQueryClient();
  const { user } = useResolvedAuthState();
  const ownerId = user?.id;
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload?: ArchiveGoalPayload }) =>
      archiveGoal(id, payload ?? {}),
    onSuccess: (data) => {
      invalidateAffectedGoalCaches(queryClient, ownerId, data.goal.id);
    },
  });
}
