import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  analyticsKeys,
  getCommunicationsAnalytics,
  getDashboardOverview,
  getFinanceAnalytics,
  getFunnelAnalytics,
  getPerformanceAnalytics,
  getProjectsAnalytics,
  getQuotationsAnalytics,
  getTrendsAnalytics,
  invalidateAnalytics,
} from "./analyticsApi";
import type { QueryClient } from "@tanstack/react-query";

vi.mock("./client", () => ({
  apiRequest: vi.fn(),
  buildApiUrl: (base: string, params?: Record<string, unknown>) => {
    if (!params) return base;
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== "") {
        sp.set(k, String(v));
      }
    }
    const qs = sp.toString();
    return qs ? `${base}?${qs}` : base;
  },
}));

import { apiRequest } from "./client";

describe("B5D Typed Analytics API Client", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("verifies analytics query keys generation", () => {
    expect(analyticsKeys.all).toEqual(["crm", "analytics"]);
    expect(analyticsKeys.dashboard()).toEqual(["crm", "analytics", "dashboard"]);
    expect(analyticsKeys.funnel({ period: "30d" })).toEqual([
      "crm",
      "analytics",
      "funnel",
      { period: "30d" },
    ]);
    expect(analyticsKeys.communications({ period: "7d" })).toEqual([
      "crm",
      "analytics",
      "communications",
      { period: "7d" },
    ]);
    expect(analyticsKeys.finance({ period: "thisMonth" })).toEqual([
      "crm",
      "analytics",
      "finance",
      { period: "thisMonth" },
    ]);
    expect(analyticsKeys.quotations({ period: "thisQuarter" })).toEqual([
      "crm",
      "analytics",
      "quotations",
      { period: "thisQuarter" },
    ]);
    expect(analyticsKeys.projects({ period: "thisYear" })).toEqual([
      "crm",
      "analytics",
      "projects",
      { period: "thisYear" },
    ]);
    expect(analyticsKeys.performance({ period: "today" })).toEqual([
      "crm",
      "analytics",
      "performance",
      { period: "today" },
    ]);
    expect(analyticsKeys.trends({ period: "30d", granularity: "day" })).toEqual([
      "crm",
      "analytics",
      "trends",
      { period: "30d", granularity: "day" },
    ]);
  });

  it("calls getDashboardOverview with /api/v1/analytics/dashboard", async () => {
    const mockRes = { ok: true, todayIstDate: "2026-11-10", kpis: {} };
    vi.mocked(apiRequest).mockResolvedValueOnce(mockRes);

    const res = await getDashboardOverview();
    expect(res).toEqual(mockRes);
    expect(apiRequest).toHaveBeenCalledWith({
      path: "/api/v1/analytics/dashboard",
      method: "GET",
      schema: expect.any(Object),
    });
  });

  it("calls getFunnelAnalytics with query parameters", async () => {
    const mockRes = { ok: true, window: { start: "2026-11-01", end: "2026-11-10" } };
    vi.mocked(apiRequest).mockResolvedValueOnce(mockRes);

    const res = await getFunnelAnalytics({ period: "thisMonth" });
    expect(res).toEqual(mockRes);
    expect(apiRequest).toHaveBeenCalledWith({
      path: "/api/v1/analytics/funnel?period=thisMonth",
      method: "GET",
      schema: expect.any(Object),
    });
  });

  it("calls getCommunicationsAnalytics with query parameters", async () => {
    const mockRes = { ok: true, window: { start: "2026-11-01", end: "2026-11-10" } };
    vi.mocked(apiRequest).mockResolvedValueOnce(mockRes);

    const res = await getCommunicationsAnalytics({ period: "7d" });
    expect(res).toEqual(mockRes);
    expect(apiRequest).toHaveBeenCalledWith({
      path: "/api/v1/analytics/communications?period=7d",
      method: "GET",
      schema: expect.any(Object),
    });
  });

  it("calls getFinanceAnalytics with query parameters", async () => {
    const mockRes = { ok: true, window: { start: "2026-11-01", end: "2026-11-10" } };
    vi.mocked(apiRequest).mockResolvedValueOnce(mockRes);

    const res = await getFinanceAnalytics({ period: "thisMonth" });
    expect(res).toEqual(mockRes);
    expect(apiRequest).toHaveBeenCalledWith({
      path: "/api/v1/analytics/finance?period=thisMonth",
      method: "GET",
      schema: expect.any(Object),
    });
  });

  it("calls getQuotationsAnalytics with query parameters", async () => {
    const mockRes = { ok: true, window: { start: "2026-11-01", end: "2026-11-10" } };
    vi.mocked(apiRequest).mockResolvedValueOnce(mockRes);

    const res = await getQuotationsAnalytics({ period: "thisQuarter" });
    expect(res).toEqual(mockRes);
    expect(apiRequest).toHaveBeenCalledWith({
      path: "/api/v1/analytics/quotations?period=thisQuarter",
      method: "GET",
      schema: expect.any(Object),
    });
  });

  it("calls getProjectsAnalytics with query parameters", async () => {
    const mockRes = { ok: true, window: { start: "2026-11-01", end: "2026-11-10" } };
    vi.mocked(apiRequest).mockResolvedValueOnce(mockRes);

    const res = await getProjectsAnalytics({ period: "thisYear" });
    expect(res).toEqual(mockRes);
    expect(apiRequest).toHaveBeenCalledWith({
      path: "/api/v1/analytics/projects?period=thisYear",
      method: "GET",
      schema: expect.any(Object),
    });
  });

  it("calls getPerformanceAnalytics with query parameters", async () => {
    const mockRes = { ok: true, window: { start: "2026-11-10", end: "2026-11-10" } };
    vi.mocked(apiRequest).mockResolvedValueOnce(mockRes);

    const res = await getPerformanceAnalytics({ period: "today" });
    expect(res).toEqual(mockRes);
    expect(apiRequest).toHaveBeenCalledWith({
      path: "/api/v1/analytics/performance?period=today",
      method: "GET",
      schema: expect.any(Object),
    });
  });

  it("calls getTrendsAnalytics with period and granularity parameters", async () => {
    const mockRes = { ok: true, window: { start: "2026-11-01", end: "2026-11-10" } };
    vi.mocked(apiRequest).mockResolvedValueOnce(mockRes);

    const res = await getTrendsAnalytics({
      period: "30d",
      granularity: "week",
      from: "2026-10-10",
      to: "2026-11-10",
    });
    expect(res).toEqual(mockRes);
    expect(apiRequest).toHaveBeenCalledWith({
      path: "/api/v1/analytics/trends?period=30d&granularity=week&from=2026-10-10&to=2026-11-10",
      method: "GET",
      schema: expect.any(Object),
    });
  });

  it("invalidates all analytics queries via invalidateAnalytics", async () => {
    const invalidateQueries = vi.fn().mockResolvedValue(undefined);
    const mockQueryClient = { invalidateQueries } as unknown as QueryClient;

    await invalidateAnalytics(mockQueryClient);
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["crm", "analytics"],
    });
  });
});
