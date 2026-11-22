import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAuthStore } from "@/lib/auth/authClient";
import { PilotShell } from "@/components/pilot/PilotShell";

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    to,
    search,
    ...rest
  }: {
    children: React.ReactNode;
    to: string;
    search?: Record<string, unknown>;
  }) => {
    const qs =
      search && Object.keys(search).length > 0
        ? "?" +
          Object.entries(search)
            .map(([k, v]) => `${k}=${String(v)}`)
            .join("&")
        : "";
    return (
      <a href={`${to}${qs}`} {...rest}>
        {children}
      </a>
    );
  },
  useNavigate: () => vi.fn(),
  useRouterState: () => "/pipeline",
}));

describe("Checkpoint B14C: PilotShell removes ?pilot=1 links when CRM_V2_DEFAULT_BACKEND=true", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("omits ?pilot=1 from all nav links and hides dev pilot chrome when crmV2DefaultBackend is true", () => {
    useAuthStore.setState({
      status: "authenticated",
      user: { id: "usr_owner", email: "owner@example.test", name: "Owner", roleId: "owner" },
      idleExpiresAt: "2026-12-01T00:00:00.000Z",
      expiresAt: "2026-12-01T00:00:00.000Z",
      leadPilotAvailable: true,
      crmV2DefaultBackend: true,
      lastCheckedAt: Date.now(),
    });

    const qc = new QueryClient();
    const { container } = render(
      <QueryClientProvider client={qc}>
        <PilotShell title="Pipeline">
          <div>Content</div>
        </PilotShell>
      </QueryClientProvider>,
    );

    const links = Array.from(container.querySelectorAll("a"));
    expect(links.length).toBeGreaterThan(10);
    for (const a of links) {
      expect(a.getAttribute("href")).not.toContain("pilot=1");
    }
    expect(screen.queryByTestId("pilot-mode-banner")).not.toBeInTheDocument();
    expect(screen.queryByText("Exit Pilot Mode")).not.toBeInTheDocument();
    expect(screen.queryByText("Local Browser Modules")).not.toBeInTheDocument();
  });

  it("preserves ?pilot=1 links and dev pilot banner when crmV2DefaultBackend is false", () => {
    useAuthStore.setState({
      status: "authenticated",
      user: { id: "usr_owner", email: "owner@example.test", name: "Owner", roleId: "owner" },
      idleExpiresAt: "2026-12-01T00:00:00.000Z",
      expiresAt: "2026-12-01T00:00:00.000Z",
      leadPilotAvailable: true,
      crmV2DefaultBackend: false,
      lastCheckedAt: Date.now(),
    });

    const qc = new QueryClient();
    const { container } = render(
      <QueryClientProvider client={qc}>
        <PilotShell title="Pipeline">
          <div>Content</div>
        </PilotShell>
      </QueryClientProvider>,
    );

    const links = Array.from(container.querySelectorAll("a"));
    expect(links.some((a) => (a.getAttribute("href") ?? "").includes("pilot=1"))).toBe(true);
    expect(screen.getByTestId("pilot-mode-banner")).toBeInTheDocument();
    expect(screen.getByText("Exit Pilot Mode")).toBeInTheDocument();
  });
});
