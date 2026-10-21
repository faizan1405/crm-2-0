import { Link, useRouterState } from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";
import { LayoutDashboard, Users, KanbanSquare, CalendarClock, Wallet, StickyNote, Moon, Sun, Workflow } from "lucide-react";
import { useCRM } from "@/lib/crm/store";
import { cn } from "@/lib/utils";

const NAV = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/leads", label: "Leads", icon: Users },
  { to: "/pipeline", label: "Pipeline", icon: KanbanSquare },
  { to: "/follow-ups", label: "Follow-ups", icon: CalendarClock },
  { to: "/deals", label: "Deals", icon: Wallet },
  { to: "/notes", label: "Notes", icon: StickyNote },
] as const;

export function Shell({ title, subtitle, actions, children }: { title: string; subtitle?: string; actions?: ReactNode; children: ReactNode }) {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const dark = useCRM((s) => s.dark);
  const preferences = useCRM((s) => s.preferences);
  useEffect(() => { useCRM.persist.rehydrate(); }, []);
  useEffect(() => { document.documentElement.classList.toggle("dark", dark); }, [dark]);

  return (
    <div className="flex min-h-screen bg-background">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col bg-sidebar p-4 text-sidebar-foreground md:flex">
        <div className="mb-8 flex items-center gap-2 px-2">
          <div className="grid size-8 place-items-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground"><Workflow className="size-4" /></div>
          <div><div className="font-display text-sm font-bold">Scale Flow</div><div className="text-[11px] text-sidebar-muted">CRM 2.0 · Demo</div></div>
        </div>
        <nav className="flex flex-1 flex-col gap-1">
          {NAV.map((n) => {
            const active = n.to === "/" ? path === "/" : path.startsWith(n.to);
            return (
              <Link key={n.to} to={n.to} className={cn("flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors", active ? "bg-sidebar-accent text-sidebar-accent-foreground" : "text-sidebar-muted hover:bg-sidebar-accent/60 hover:text-sidebar-foreground")}>
                <n.icon className="size-4" />{n.label}
              </Link>
            );
          })}
        </nav>
        <button onClick={() => preferences({ dark: !dark })} className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-sidebar-muted hover:bg-sidebar-accent/60">
          {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}{dark ? "Light mode" : "Dark mode"}
        </button>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col pb-20 md:pb-0">
        <header className="flex flex-wrap items-end justify-between gap-3 px-5 pt-6 pb-4 md:px-8">
          <div><h1 className="text-2xl font-bold text-foreground">{title}</h1>{subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}</div>
          {actions}
        </header>
        <main className="page-enter flex-1 px-5 pb-8 md:px-8">{children}</main>
      </div>
      <nav className="fixed inset-x-0 bottom-0 z-40 flex justify-around border-t bg-card py-2 md:hidden">
        {NAV.map((n) => {
          const active = n.to === "/" ? path === "/" : path.startsWith(n.to);
          return <Link key={n.to} to={n.to} className={cn("flex flex-col items-center gap-0.5 px-2 text-[10px]", active ? "text-primary" : "text-muted-foreground")}><n.icon className="size-5" />{n.label}</Link>;
        })}
      </nav>
    </div>
  );
}

export function Stat({ label, value, hint, tone = "primary" }: { label: string; value: string; hint?: string; tone?: "primary" | "success" | "warning" | "destructive" }) {
  const bar = { primary: "bg-primary", success: "bg-success", warning: "bg-warning", destructive: "bg-destructive" }[tone];
  return (
    <div className="surface relative overflow-hidden p-4">
      <div className={cn("absolute inset-y-0 left-0 w-1", bar)} />
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="num mt-1 font-display text-2xl font-bold text-foreground">{value}</div>
      {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}

const PRIORITY: Record<string, string> = { hot: "bg-destructive-soft text-destructive", warm: "bg-warning-soft text-warning", cold: "bg-info-soft text-primary" };
export function PriorityBadge({ p }: { p: string }) {
  return <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize", PRIORITY[p])}>{p}</span>;
}
