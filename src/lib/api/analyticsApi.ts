import { useQuery, type QueryClient } from "@tanstack/react-query";
import { apiRequest, buildApiUrl } from "./client";
import {
  dashboardOverviewResponseSchema,
  funnelAnalyticsResponseSchema,
  communicationsAnalyticsResponseSchema,
  financeAnalyticsResponseSchema,
  quotationsAnalyticsResponseSchema,
  projectsAnalyticsResponseSchema,
  performanceAnalyticsResponseSchema,
  trendsAnalyticsResponseSchema,
  type AnalyticsGranularity,
  type AnalyticsPeriod,
  type DashboardOverviewResponse,
  type FunnelAnalyticsResponse,
  type CommunicationsAnalyticsResponse,
  type FinanceAnalyticsResponse,
  type QuotationsAnalyticsResponse,
  type ProjectsAnalyticsResponse,
  type PerformanceAnalyticsResponse,
  type TrendsAnalyticsResponse,
} from "./schemas";

export interface AnalyticsQuery {
  period?: AnalyticsPeriod | undefined;
  from?: string | undefined;
  to?: string | undefined;
}

export interface AnalyticsTrendsQuery extends AnalyticsQuery {
  granularity?: AnalyticsGranularity | undefined;
}

export const analyticsKeys = {
  all: ["crm", "analytics"] as const,
  dashboard: () => [...analyticsKeys.all, "dashboard"] as const,
  funnel: (query: AnalyticsQuery = {}) => [...analyticsKeys.all, "funnel", query] as const,
  communications: (query: AnalyticsQuery = {}) =>
    [...analyticsKeys.all, "communications", query] as const,
  finance: (query: AnalyticsQuery = {}) => [...analyticsKeys.all, "finance", query] as const,
  quotations: (query: AnalyticsQuery = {}) => [...analyticsKeys.all, "quotations", query] as const,
  projects: (query: AnalyticsQuery = {}) => [...analyticsKeys.all, "projects", query] as const,
  performance: (query: AnalyticsQuery = {}) =>
    [...analyticsKeys.all, "performance", query] as const,
  trends: (query: AnalyticsTrendsQuery = {}) => [...analyticsKeys.all, "trends", query] as const,
};

// ---------------------------------------------------------------------------
// Client Fetch Functions
// ---------------------------------------------------------------------------

export async function getDashboardOverview(
  signal?: AbortSignal,
): Promise<DashboardOverviewResponse> {
  return apiRequest({
    path: "/api/v1/analytics/dashboard",
    method: "GET",
    schema: dashboardOverviewResponseSchema,
    ...(signal ? { signal } : {}),
  });
}

export async function getFunnelAnalytics(
  query: AnalyticsQuery = {},
  signal?: AbortSignal,
): Promise<FunnelAnalyticsResponse> {
  const url = buildApiUrl("/api/v1/analytics/funnel", {
    period: query.period,
    from: query.from,
    to: query.to,
  });
  return apiRequest({
    path: url,
    method: "GET",
    schema: funnelAnalyticsResponseSchema,
    ...(signal ? { signal } : {}),
  });
}

export async function getCommunicationsAnalytics(
  query: AnalyticsQuery = {},
  signal?: AbortSignal,
): Promise<CommunicationsAnalyticsResponse> {
  const url = buildApiUrl("/api/v1/analytics/communications", {
    period: query.period,
    from: query.from,
    to: query.to,
  });
  return apiRequest({
    path: url,
    method: "GET",
    schema: communicationsAnalyticsResponseSchema,
    ...(signal ? { signal } : {}),
  });
}

export async function getFinanceAnalytics(
  query: AnalyticsQuery = {},
  signal?: AbortSignal,
): Promise<FinanceAnalyticsResponse> {
  const url = buildApiUrl("/api/v1/analytics/finance", {
    period: query.period,
    from: query.from,
    to: query.to,
  });
  return apiRequest({
    path: url,
    method: "GET",
    schema: financeAnalyticsResponseSchema,
    ...(signal ? { signal } : {}),
  });
}

export async function getQuotationsAnalytics(
  query: AnalyticsQuery = {},
  signal?: AbortSignal,
): Promise<QuotationsAnalyticsResponse> {
  const url = buildApiUrl("/api/v1/analytics/quotations", {
    period: query.period,
    from: query.from,
    to: query.to,
  });
  return apiRequest({
    path: url,
    method: "GET",
    schema: quotationsAnalyticsResponseSchema,
    ...(signal ? { signal } : {}),
  });
}

export async function getProjectsAnalytics(
  query: AnalyticsQuery = {},
  signal?: AbortSignal,
): Promise<ProjectsAnalyticsResponse> {
  const url = buildApiUrl("/api/v1/analytics/projects", {
    period: query.period,
    from: query.from,
    to: query.to,
  });
  return apiRequest({
    path: url,
    method: "GET",
    schema: projectsAnalyticsResponseSchema,
    ...(signal ? { signal } : {}),
  });
}

export async function getPerformanceAnalytics(
  query: AnalyticsQuery = {},
  signal?: AbortSignal,
): Promise<PerformanceAnalyticsResponse> {
  const url = buildApiUrl("/api/v1/analytics/performance", {
    period: query.period,
    from: query.from,
    to: query.to,
  });
  return apiRequest({
    path: url,
    method: "GET",
    schema: performanceAnalyticsResponseSchema,
    ...(signal ? { signal } : {}),
  });
}

export async function getTrendsAnalytics(
  query: AnalyticsTrendsQuery = {},
  signal?: AbortSignal,
): Promise<TrendsAnalyticsResponse> {
  const url = buildApiUrl("/api/v1/analytics/trends", {
    period: query.period,
    granularity: query.granularity,
    from: query.from,
    to: query.to,
  });
  return apiRequest({
    path: url,
    method: "GET",
    schema: trendsAnalyticsResponseSchema,
    ...(signal ? { signal } : {}),
  });
}

// ---------------------------------------------------------------------------
// React Query Hooks
// ---------------------------------------------------------------------------

export function useDashboardOverviewQuery(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: analyticsKeys.dashboard(),
    queryFn: ({ signal }) => getDashboardOverview(signal),
    enabled: options?.enabled ?? true,
    staleTime: 10_000,
    retry: false,
  });
}

export function useFunnelAnalyticsQuery(
  query: AnalyticsQuery = {},
  options?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: analyticsKeys.funnel(query),
    queryFn: ({ signal }) => getFunnelAnalytics(query, signal),
    enabled: options?.enabled ?? true,
    staleTime: 10_000,
    retry: false,
  });
}

export function useCommunicationsAnalyticsQuery(
  query: AnalyticsQuery = {},
  options?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: analyticsKeys.communications(query),
    queryFn: ({ signal }) => getCommunicationsAnalytics(query, signal),
    enabled: options?.enabled ?? true,
    staleTime: 10_000,
    retry: false,
  });
}

export function useFinanceAnalyticsQuery(
  query: AnalyticsQuery = {},
  options?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: analyticsKeys.finance(query),
    queryFn: ({ signal }) => getFinanceAnalytics(query, signal),
    enabled: options?.enabled ?? true,
    staleTime: 10_000,
    retry: false,
  });
}

export function useQuotationsAnalyticsQuery(
  query: AnalyticsQuery = {},
  options?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: analyticsKeys.quotations(query),
    queryFn: ({ signal }) => getQuotationsAnalytics(query, signal),
    enabled: options?.enabled ?? true,
    staleTime: 10_000,
    retry: false,
  });
}

export function useProjectsAnalyticsQuery(
  query: AnalyticsQuery = {},
  options?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: analyticsKeys.projects(query),
    queryFn: ({ signal }) => getProjectsAnalytics(query, signal),
    enabled: options?.enabled ?? true,
    staleTime: 10_000,
    retry: false,
  });
}

export function usePerformanceAnalyticsQuery(
  query: AnalyticsQuery = {},
  options?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: analyticsKeys.performance(query),
    queryFn: ({ signal }) => getPerformanceAnalytics(query, signal),
    enabled: options?.enabled ?? true,
    staleTime: 10_000,
    retry: false,
  });
}

export function useTrendsAnalyticsQuery(
  query: AnalyticsTrendsQuery = {},
  options?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: analyticsKeys.trends(query),
    queryFn: ({ signal }) => getTrendsAnalytics(query, signal),
    enabled: options?.enabled ?? true,
    staleTime: 10_000,
    retry: false,
  });
}

/**
 * Invalidate all server analytics query caches across the application.
 */
export async function invalidateAnalytics(queryClient: QueryClient): Promise<void> {
  await queryClient.invalidateQueries({ queryKey: analyticsKeys.all });
}
