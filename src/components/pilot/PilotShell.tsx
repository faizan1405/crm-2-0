import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  LayoutDashboard,
  Users,
  Wallet,
  FolderKanban,
  Archive,
  Menu,
  ChevronRight,
  PanelLeftClose,
  PanelLeftOpen,
  LogOut,
  Moon,
  Sun,
  Database,
  Trash2,
  CalendarClock,
  FileText,
  BarChart3,
  Target,
  Settings,
  SlidersHorizontal,
  Inbox,
  Workflow,
  StickyNote,
} from "lucide-react";
import { logoutOwner, useResolvedAuthState } from "@/lib/auth/authClient";
import { setLeadPilotSessionOptIn } from "@/lib/api/pilotGate";
import { formatDate, initials } from "@/lib/crm/format";
import { AppShellSkeleton, ScaleMark } from "@/components/crm/ShellPrimitives";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { clearPilotCallPending } from "./pilotCallLauncher";
import { clearPilotWhatsAppPending } from "./pilotWhatsAppLauncher";

const PILOT_LINKS = [
  { to: "/" as const, label: "Dashboard", icon: LayoutDashboard, pilot: true },
  { to: "/daily-briefing" as const, label: "Daily Briefing", icon: Sun, pilot: true },
  { to: "/inbox" as const, label: "Smart Inbox", icon: Inbox, pilot: true },
  { to: "/leads" as const, label: "Leads", icon: Users, pilot: true },
  { to: "/pipeline" as const, label: "Pipeline", icon: FolderKanban, pilot: true },
  { to: "/deals" as const, label: "Finance", icon: Wallet, pilot: true },
  { to: "/sales-studio" as const, label: "Sales Studio", icon: FileText, pilot: true },
  { to: "/follow-ups" as const, label: "Follow-ups", icon: CalendarClock, pilot: true },
  { to: "/projects" as const, label: "Projects", icon: FolderKanban, pilot: true },
  { to: "/notes" as const, label: "Personal Notes", icon: StickyNote, pilot: true },
  { to: "/analytics" as const, label: "Analytics", icon: BarChart3, pilot: true },
  { to: "/my-performance" as const, label: "My Performance", icon: Target, pilot: true },
  { to: "/settings" as const, label: "Settings", icon: Settings, pilot: true },
  { to: "/crm-config" as const, label: "CRM Config", icon: SlidersHorizontal, pilot: true },
  { to: "/automation" as const, label: "Automations", icon: Workflow, pilot: true },
  { to: "/data-vault" as const, label: "Data Vault", icon: Archive, pilot: true },
  { to: "/leads/bin" as const, label: "Waste & deleted", icon: Trash2, pilot: true },
];

const LOCAL_LINKS = [
  { to: "/" as const, label: "Dashboard", icon: LayoutDashboard },
  { to: "/analytics" as const, label: "Analytics", icon: BarChart3 },
  { to: "/my-performance" as const, label: "My Performance", icon: Target },
  { to: "/data-vault" as const, label: "Data Vault", icon: Archive },
];

export function PilotShell({
  title,
  subtitle,
  actions,
  children,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const { status: authStatus, user: authUser, crmV2DefaultBackend } = useResolvedAuthState();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const linkSearch: { pilot?: 0 | 1 } = crmV2DefaultBackend ? {} : { pilot: 1 };

  const [mounted, setMounted] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [dark, setDark] = useState(false);

  useEffect(() => {
    setMounted(true);
    setDark(document.documentElement.classList.contains("dark"));
  }, []);

  const toggleDark = () => {
    setDark((prev) => {
      const next = !prev;
      document.documentElement.classList.toggle("dark", next);
      return next;
    });
  };

  const exitPilot = () => {
    clearPilotCallPending();
    clearPilotWhatsAppPending();
    setLeadPilotSessionOptIn(false);
    queryClient.clear();
    void navigate({ to: "/leads", search: {} });
  };

  const handleSignOut = () => {
    if (signingOut) return;
    setSigningOut(true);
    clearPilotCallPending();
    clearPilotWhatsAppPending();
    queryClient.clear();
    void logoutOwner({ allSessions: false });
  };

  if (!mounted || authStatus !== "authenticated") {
    return <AppShellSkeleton />;
  }

  const ownerName = authUser?.name ?? "Owner";
  const ownerEmail = authUser?.email ?? "Owner session";

  const renderNav = (onNav?: () => void) => (
    <nav
      aria-label={crmV2DefaultBackend ? "CRM navigation" : "Lead Pilot navigation"}
      className="sb-nav"
    >
      <div className="sb-group">
        <div className="sb-group-label">
          <span>{crmV2DefaultBackend ? "Sales OS Workspace" : "Sales OS Server Pilot"}</span>
        </div>
        <div>
          {PILOT_LINKS.map((item) => {
            const active =
              item.to === "/"
                ? path === "/"
                : item.to === "/daily-briefing"
                  ? path === "/daily-briefing" || path.startsWith("/daily-briefing/")
                  : item.to === "/inbox"
                    ? path === "/inbox" || path.startsWith("/inbox/")
                    : item.to === "/pipeline"
                      ? path === "/pipeline" || path.startsWith("/pipeline/")
                      : item.to === "/automation"
                        ? path === "/automation" || path.startsWith("/automation/")
                        : item.to === "/data-vault"
                          ? path === "/data-vault" || path.startsWith("/data-vault/")
                          : item.to === "/analytics"
                            ? path === "/analytics" || path.startsWith("/analytics/")
                            : item.to === "/my-performance"
                              ? path === "/my-performance" || path.startsWith("/my-performance/")
                              : item.to === "/settings"
                                ? path === "/settings" || path.startsWith("/settings/")
                                : item.to === "/crm-config"
                                  ? path === "/crm-config" || path.startsWith("/crm-config/")
                                  : item.to === "/leads/bin"
                                    ? path.startsWith("/leads/bin")
                                    : item.to === "/follow-ups"
                                      ? path === "/follow-ups" || path.startsWith("/follow-ups/")
                                      : item.to === "/deals"
                                        ? path === "/deals" || path.startsWith("/deals/")
                                        : item.to === "/sales-studio"
                                          ? path === "/sales-studio" ||
                                            path.startsWith("/sales-studio/")
                                          : item.to === "/projects"
                                            ? path === "/projects" || path.startsWith("/projects/")
                                            : item.to === "/leads" &&
                                              (path === "/leads" ||
                                                (path.startsWith("/leads/") &&
                                                  !path.startsWith("/leads/bin")));
            return (
              <Link
                key={item.to}
                to={item.to}
                search={linkSearch}
                onClick={onNav}
                aria-current={active ? "page" : undefined}
                title={collapsed ? item.label : undefined}
                className="sb-link"
              >
                <item.icon className="sb-icon" />
                <span className="sb-label min-w-0 flex-1 truncate">{item.label}</span>
              </Link>
            );
          })}
        </div>
      </div>
      {!crmV2DefaultBackend && (
        <div className="sb-group">
          <div className="sb-group-label">
            <span>Local Browser Modules</span>
          </div>
          <div>
            {LOCAL_LINKS.map((item) => (
              <button
                key={item.to}
                type="button"
                onClick={() => {
                  onNav?.();
                  setLeadPilotSessionOptIn(false);
                  queryClient.clear();
                  void navigate({ to: item.to, search: {} });
                }}
                title={collapsed ? `${item.label} (Local browser store)` : undefined}
                className="sb-link w-full text-left"
              >
                <item.icon className="sb-icon" />
                <span className="sb-label min-w-0 flex-1 truncate">{item.label}</span>
                {!collapsed && <span className="sb-badge shrink-0 text-[10px]">Local</span>}
              </button>
            ))}
          </div>
        </div>
      )}
    </nav>
  );

  return (
    <div
      className="crm-workspace flex min-h-screen bg-background"
      data-collapsed={collapsed ? "true" : "false"}
      data-pilot-mode="true"
    >
      <aside className="sb hidden md:flex" aria-label="Sidebar">
        <div className="sb-brand">
          <Link to="/" search={linkSearch} className="flex min-w-0 items-center gap-2.5">
            <span className="sb-mark">
              <ScaleMark className="size-[18px]" />
            </span>
            <span className="sb-label min-w-0 leading-none">
              <span className="block truncate text-[15px] font-semibold tracking-tight">
                Scale Flow
              </span>
              <span className="sb-os mt-1 block">
                {crmV2DefaultBackend ? "Sales OS · CRM V2" : "Sales OS · Pilot"}
              </span>
            </span>
          </Link>
        </div>
        {renderNav()}
        <div className="sb-foot">
          <div className="sb-user">
            <span className="sb-avatar">{initials(ownerName)}</span>
            <span className="sb-label min-w-0 leading-tight">
              <span className="block truncate text-[13px] font-medium">{ownerName}</span>
              <span className="block truncate text-[11px] opacity-60">{ownerEmail}</span>
            </span>
          </div>
          <button
            type="button"
            onClick={handleSignOut}
            disabled={signingOut}
            className="sb-collapse"
            aria-label="Sign out"
            title="Sign out"
          >
            <LogOut className="size-4" />
            <span className="sb-label text-xs">{signingOut ? "Signing out…" : "Sign out"}</span>
          </button>
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            className="sb-collapse"
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-expanded={!collapsed}
          >
            {collapsed ? (
              <PanelLeftOpen className="size-4" />
            ) : (
              <PanelLeftClose className="size-4" />
            )}
            <span className="sb-label text-xs">Collapse</span>
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col pb-24 md:pb-0">
        {!crmV2DefaultBackend && (
          <div
            role="status"
            data-testid="pilot-mode-banner"
            className="flex flex-wrap items-center justify-between gap-2 border-b border-primary/25 bg-primary-soft px-4 py-2 text-xs text-foreground sm:px-6 lg:px-8"
          >
            <span className="flex min-w-0 items-center gap-2">
              <Database className="size-4 shrink-0 text-primary" aria-hidden />
              <span className="min-w-0">
                <b>Dev CRM Pilot (Synthetic MariaDB)</b> — Server-backed Leads, Calls, WhatsApp,
                Follow-ups, Finance, Projects, Analytics, Settings & Goals only.{" "}
                <span className="hidden sm:inline">
                  Browser-local CRM records and IndexedDB proofs remain untouched.
                </span>
              </span>
            </span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 rounded-full"
              onClick={exitPilot}
            >
              Exit Pilot Mode
            </Button>
          </div>
        )}

        <header className="topbar sticky top-0 z-30 border-b">
          <div className="mx-auto flex h-14 max-w-[1400px] items-center gap-2 px-4 sm:px-6 lg:px-8">
            <button
              type="button"
              className="topbar-icon md:!hidden"
              aria-label="Open navigation"
              onClick={() => setDrawer(true)}
            >
              <Menu className="size-5" />
            </button>
            <Link
              to="/"
              search={linkSearch}
              className="flex items-center gap-2 md:hidden"
              aria-label="Scale Flow Home"
            >
              <span className="sb-mark sb-mark-light">
                <ScaleMark className="size-4" />
              </span>
            </Link>
            <div className="crumb hidden min-w-0 items-center gap-1.5 text-[13px] sm:flex">
              <span className="text-muted-foreground">
                {crmV2DefaultBackend ? "Scale Flow CRM" : "Sales OS Pilot"}
              </span>
              <ChevronRight className="size-3.5 text-muted-foreground" />
              <span className="truncate font-medium">
                {path === "/"
                  ? "Dashboard"
                  : path.startsWith("/daily-briefing")
                    ? "Daily Briefing"
                    : path.startsWith("/inbox")
                      ? "Smart Inbox"
                      : path.startsWith("/pipeline")
                        ? "Pipeline"
                        : path.startsWith("/automation")
                          ? "Automations"
                          : path.startsWith("/data-vault")
                            ? "Data Vault"
                            : path.startsWith("/analytics")
                              ? "Analytics"
                              : path.startsWith("/my-performance")
                                ? "My Performance"
                                : path.startsWith("/settings")
                                  ? "Settings"
                                  : path.startsWith("/crm-config")
                                    ? "CRM Configuration"
                                    : path.startsWith("/deals")
                                      ? "Finance"
                                      : path.startsWith("/sales-studio")
                                        ? "Sales Studio"
                                        : path.startsWith("/projects")
                                          ? "Projects"
                                          : path.startsWith("/follow-ups")
                                            ? "Follow-ups"
                                            : path.startsWith("/leads/bin")
                                              ? "Waste & Recently Deleted"
                                              : "Leads"}
              </span>
            </div>
            <button
              type="button"
              title="Toggle theme"
              aria-label="Toggle theme"
              onClick={toggleDark}
              className="topbar-icon ml-auto"
            >
              {dark ? <Sun className="size-[18px]" /> : <Moon className="size-[18px]" />}
            </button>
          </div>
        </header>

        <div className="os-heading mx-auto flex w-full max-w-[1400px] flex-wrap items-end justify-between gap-4 px-4 pt-6 pb-5 sm:px-6 lg:px-8 lg:pt-8">
          <div className="min-w-0">
            <h1 className="text-[26px] font-semibold tracking-tight text-foreground sm:text-[30px]">
              {title}
            </h1>
            {subtitle && (
              <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-muted-foreground">
                {subtitle}
              </p>
            )}
          </div>
          {actions}
        </div>

        <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 pb-12 sm:px-6 lg:px-8">
          {children}
        </main>

        <footer className="mx-auto mt-auto flex w-full max-w-[1400px] items-center justify-between gap-2 border-t px-4 py-4 sm:px-6 lg:px-8">
          <span className="eyebrow">
            {crmV2DefaultBackend
              ? "Scale Flow · Sales OS · CRM V2"
              : "Scale Flow · Sales OS 3.0 · Dev Lead Pilot"}
          </span>
          <span className="eyebrow">
            MariaDB API ·{" "}
            {formatDate(new Date().toISOString(), {
              day: "numeric",
              month: "short",
              year: "numeric",
            })}
          </span>
        </footer>
      </div>

      <nav
        aria-label={crmV2DefaultBackend ? "Mobile CRM navigation" : "Mobile Pilot navigation"}
        className="os-mobile-bar fixed inset-x-3 bottom-3 z-40 flex items-center justify-around rounded-[22px] px-1.5 py-1.5 shadow-[var(--shadow-pop)] md:hidden"
      >
        <Link
          to="/"
          search={linkSearch}
          aria-current={path === "/" ? "page" : undefined}
          className="flex min-h-12 min-w-14 flex-1 flex-col items-center justify-center gap-0.5 rounded-2xl text-[10px] font-medium"
        >
          <LayoutDashboard className="size-5" />
          Home
        </Link>
        <Link
          to="/leads"
          search={linkSearch}
          aria-current={
            path.startsWith("/leads") && !path.startsWith("/leads/bin") ? "page" : undefined
          }
          className="flex min-h-12 min-w-14 flex-1 flex-col items-center justify-center gap-0.5 rounded-2xl text-[10px] font-medium"
        >
          <Users className="size-5" />
          Leads
        </Link>
        <Link
          to="/deals"
          search={linkSearch}
          aria-current={path.startsWith("/deals") ? "page" : undefined}
          className="flex min-h-12 min-w-14 flex-1 flex-col items-center justify-center gap-0.5 rounded-2xl text-[10px] font-medium"
        >
          <Wallet className="size-5" />
          Finance
        </Link>
        <Link
          to="/analytics"
          search={linkSearch}
          aria-current={path.startsWith("/analytics") ? "page" : undefined}
          className="flex min-h-12 min-w-14 flex-1 flex-col items-center justify-center gap-0.5 rounded-2xl text-[10px] font-medium"
        >
          <BarChart3 className="size-5" />
          Analytics
        </Link>
        <button
          type="button"
          onClick={() => setDrawer(true)}
          className="flex min-h-12 min-w-14 flex-1 flex-col items-center justify-center gap-0.5 rounded-2xl text-[10px] font-medium"
        >
          <Menu className="size-5" />
          More
        </button>
      </nav>

      <Sheet open={drawer} onOpenChange={setDrawer}>
        <SheetContent side="left" className="sb-drawer w-[280px] border-0 p-0">
          <SheetHeader className="sr-only">
            <SheetTitle>CRM navigation</SheetTitle>
          </SheetHeader>
          <div className="sb flex h-full w-full">
            <div className="sb-brand">
              <span className="sb-mark">
                <ScaleMark className="size-[18px]" />
              </span>
              <span className="leading-none">
                <span className="block text-[15px] font-semibold">Scale Flow</span>
                <span className="sb-os mt-1 block">
                  {crmV2DefaultBackend ? "Sales OS · CRM V2" : "Sales OS · Pilot"}
                </span>
              </span>
            </div>
            {renderNav(() => setDrawer(false))}
            <div className="sb-foot">
              {!crmV2DefaultBackend && (
                <button
                  type="button"
                  onClick={() => {
                    setDrawer(false);
                    exitPilot();
                  }}
                  className="sb-collapse"
                >
                  <Archive className="size-4" />
                  <span className="text-xs">Exit Pilot Mode</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  setDrawer(false);
                  handleSignOut();
                }}
                disabled={signingOut}
                className="sb-collapse"
              >
                <LogOut className="size-4" />
                <span className="text-xs">{signingOut ? "Signing out…" : "Sign out"}</span>
              </button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
