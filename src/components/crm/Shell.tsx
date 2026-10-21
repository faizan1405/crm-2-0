import { Link, useRouterState } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import {
  LayoutDashboard, Users, KanbanSquare, CalendarClock, Wallet, StickyNote, Moon, Sun, Workflow,
  BarChart3, Sunrise, Settings, MoreHorizontal, Plus,
} from "lucide-react";
import { useCRM } from "@/lib/crm/store";
import { cn } from "@/lib/utils";
import { initials, displayPrefs } from "@/lib/crm/format";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { AddLeadDialog } from "./AddLeadDialog";

const NAV = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/daily-briefing", label: "Briefing", icon: Sunrise },
  { to: "/leads", label: "Leads", icon: Users },
  { to: "/pipeline", label: "Pipeline", icon: KanbanSquare },
  { to: "/follow-ups", label: "Follow-ups", icon: CalendarClock },
  { to: "/deals", label: "Deals", icon: Wallet },
  { to: "/analytics", label: "Analytics", icon: BarChart3 },
  { to: "/notes", label: "Notes", icon: StickyNote },
  { to: "/settings", label: "Settings", icon: Settings },
] as const;
const MOBILE_MAIN = ["/", "/leads", "/pipeline", "/daily-briefing"];

/** Applies theme / accent / density preferences to <html>. */
function usePreferenceEffects() {
  const { theme, accent, density, timeFormat, dateStyle } = useCRM();
  displayPrefs.hour12 = timeFormat === "12h";
  displayPrefs.longDate = dateStyle === "long";
  useEffect(() => { useCRM.persist.rehydrate(); }, []);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => document.documentElement.classList.toggle("dark", theme === "dark" || (theme === "system" && mq.matches));
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [theme]);
  useEffect(() => {
    document.documentElement.dataset["accent"] = accent;
    document.documentElement.dataset["density"] = density;
  }, [accent, density]);
}

const isActive = (path: string, to: string) => (to === "/" ? path === "/" : path.startsWith(to));

export function Shell({ title, subtitle, actions, children }: { title: string; subtitle?: string; actions?: ReactNode; children: ReactNode }) {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const { theme, owner, business, preferences } = useCRM();
  const [more, setMore] = useState(false);
  const [add, setAdd] = useState(false);
  usePreferenceEffects();
  const dark = theme === "dark";
  // Demo data lives in this browser, so render pages after mount (avoids server/browser mismatches).
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return <div className="flex min-h-screen bg-background"><aside className="hidden w-60 shrink-0 bg-sidebar md:block" /><div className="flex-1 p-8"><div className="h-7 w-48 animate-pulse rounded-md bg-muted" /><div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">{[0, 1, 2, 3].map((i) => <div key={i} className="h-24 animate-pulse rounded-xl bg-muted" />)}</div></div></div>;

  return (
    <div className="flex min-h-screen bg-background">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col bg-sidebar p-4 text-sidebar-foreground md:flex">
        <div className="mb-6 flex items-center gap-2.5 px-2">
          <div className="grid size-8 place-items-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground"><Workflow className="size-4" /></div>
          <div><div className="font-display text-sm font-bold">{business}</div><div className="text-[11px] text-sidebar-muted">CRM 2.0 · Demo data</div></div>
        </div>
        <button onClick={() => setAdd(true)} className="mb-4 flex items-center justify-center gap-2 rounded-lg bg-sidebar-primary px-3 py-2 text-sm font-medium text-sidebar-primary-foreground transition-opacity hover:opacity-90">
          <Plus className="size-4" />New lead
        </button>
        <nav className="flex flex-1 flex-col gap-0.5">
          {NAV.map((n) => (
            <Link key={n.to} to={n.to} className={cn("flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors", isActive(path, n.to) ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground" : "text-sidebar-muted hover:bg-sidebar-accent/60 hover:text-sidebar-foreground")}>
              <n.icon className="size-4" />{n.label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-2 border-t border-sidebar-border pt-3">
          <div className="grid size-8 place-items-center rounded-full bg-sidebar-accent text-xs font-semibold">{initials(owner)}</div>
          <div className="min-w-0 flex-1 truncate text-sm">{owner}</div>
          <button aria-label="Toggle theme" onClick={() => preferences({ theme: dark ? "light" : "dark" })} className="rounded-md p-1.5 text-sidebar-muted hover:bg-sidebar-accent hover:text-sidebar-foreground">
            {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
          </button>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col pb-20 md:pb-0">
        <header className="flex flex-wrap items-end justify-between gap-3 px-4 pt-6 pb-4 sm:px-6 lg:px-8">
          <div className="min-w-0"><h1 className="text-2xl font-bold text-foreground">{title}</h1>{subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}</div>
          {actions}
        </header>
        <main className="page-enter flex-1 px-4 pb-8 sm:px-6 lg:px-8">{children}</main>
      </div>
      <nav className="fixed inset-x-0 bottom-0 z-40 flex justify-around border-t bg-card/95 py-2 backdrop-blur md:hidden">
        {NAV.filter((n) => MOBILE_MAIN.includes(n.to)).map((n) => (
          <Link key={n.to} to={n.to} className={cn("flex flex-col items-center gap-0.5 px-2 text-[10px]", isActive(path, n.to) ? "text-primary" : "text-muted-foreground")}><n.icon className="size-5" />{n.label}</Link>
        ))}
        <button onClick={() => setMore(true)} className={cn("flex flex-col items-center gap-0.5 px-2 text-[10px]", NAV.some((n) => !MOBILE_MAIN.includes(n.to) && isActive(path, n.to)) ? "text-primary" : "text-muted-foreground")}><MoreHorizontal className="size-5" />More</button>
      </nav>
      <Sheet open={more} onOpenChange={setMore}>
        <SheetContent side="bottom" className="rounded-t-2xl">
          <SheetHeader><SheetTitle>Menu</SheetTitle></SheetHeader>
          <div className="grid grid-cols-3 gap-2 p-4 pt-0">
            {NAV.map((n) => (
              <Link key={n.to} to={n.to} onClick={() => setMore(false)} className={cn("flex flex-col items-center gap-1.5 rounded-xl border p-3 text-xs", isActive(path, n.to) ? "border-primary bg-primary-soft text-primary" : "text-foreground")}><n.icon className="size-5" />{n.label}</Link>
            ))}
          </div>
          <div className="flex gap-2 px-4 pb-4">
            <Button className="flex-1" onClick={() => { setMore(false); setAdd(true); }}><Plus className="size-4" />New lead</Button>
            <Button variant="outline" onClick={() => preferences({ theme: dark ? "light" : "dark" })}>{dark ? <Sun className="size-4" /> : <Moon className="size-4" />}</Button>
          </div>
        </SheetContent>
      </Sheet>
      <AddLeadDialog open={add} onOpenChange={setAdd} />
    </div>
  );
}

export function Stat({ label, value, hint, tone = "primary", icon }: { label: string; value: string; hint?: string; tone?: "primary" | "success" | "warning" | "destructive" | "teal"; icon?: ReactNode }) {
  const t = { primary: "bg-primary-soft text-primary", success: "bg-success-soft text-success", warning: "bg-warning-soft text-warning", destructive: "bg-destructive-soft text-destructive", teal: "bg-teal-soft text-teal" }[tone];
  return (
    <div className="surface surface-hover p-4">
      <div className="flex items-center justify-between">
        <div className="text-xs font-medium text-muted-foreground">{label}</div>
        {icon && <div className={cn("grid size-7 place-items-center rounded-lg [&_svg]:size-3.5", t)}>{icon}</div>}
      </div>
      <div className="num mt-2 font-display text-2xl font-bold text-foreground">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}

const PRIORITY: Record<string, string> = { hot: "bg-destructive-soft text-destructive", warm: "bg-warning-soft text-warning", cold: "bg-info-soft text-primary" };
export function PriorityBadge({ p }: { p: string }) {
  return <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize", PRIORITY[p])}>{p}</span>;
}

export function Empty({ icon, title, hint, action }: { icon: ReactNode; title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center">
      <div className="grid size-11 place-items-center rounded-xl bg-muted text-muted-foreground [&_svg]:size-5">{icon}</div>
      <div className="mt-3 font-medium text-foreground">{title}</div>
      {hint && <p className="mt-1 max-w-xs text-sm text-muted-foreground">{hint}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export const selectCls = "h-9 rounded-md border border-input bg-card px-2.5 text-sm text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none";
