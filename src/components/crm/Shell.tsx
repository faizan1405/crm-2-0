import { isPending } from "@/lib/crm/followups";
import { PostCallDialog } from "@/components/crm/PostCallDialog";
import { Link, useRouterState } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import {
  LayoutDashboard, Users, KanbanSquare, CalendarClock, Wallet, StickyNote, Moon, Sun,
  BarChart3, Sunrise, Settings, MoreHorizontal, Plus, Search, Bell, ChevronDown, PanelLeftClose, PanelLeftOpen, ArrowUpRight, ChevronsUpDown,
} from "lucide-react";
import { useCRM } from "@/lib/crm/store";
import { cn } from "@/lib/utils";
import { initials, displayPrefs, formatDate, dayKey, formatDateTime } from "@/lib/crm/format";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { AddLeadDialog } from "./AddLeadDialog";
import { FollowUpDialog } from "./Dialogs";

const NAV = [
  { to: "/", label: "Dashboard", mobile: "Home", icon: LayoutDashboard, section: "Workspace" },
  { to: "/leads", label: "Leads", mobile: "Leads", icon: Users, section: "" },
  { to: "/pipeline", label: "Pipeline", mobile: "Pipeline", icon: KanbanSquare, section: "" },
  { to: "/follow-ups", label: "Follow-ups", mobile: "Follow-ups", icon: CalendarClock, section: "" },
  { to: "/deals", label: "Deals & Payments", mobile: "Deals", icon: Wallet, section: "" },
  { to: "/notes", label: "Personal Notes", mobile: "Notes", icon: StickyNote, section: "" },
  { to: "/analytics", label: "Analytics", mobile: "Analytics", icon: BarChart3, section: "Insights" },
  { to: "/daily-briefing", label: "Daily Briefing", mobile: "Briefing", icon: Sunrise, section: "" },
  { to: "/settings", label: "Settings", mobile: "Settings", icon: Settings, section: "Manage" },
] as const;
const MOBILE_MAIN = ["/", "/leads", "/pipeline", "/follow-ups"];
function usePreferenceEffects() {
  const { theme, accent, density, timeFormat, dateStyle } = useCRM();
  displayPrefs.hour12 = timeFormat === "12h";
  displayPrefs.longDate = dateStyle === "long";
  useEffect(() => { useCRM.persist.rehydrate(); }, []);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => document.documentElement.classList.toggle("dark", theme === "dark" || (theme === "system" && mq.matches));
    apply(); mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [theme]);
  useEffect(() => { document.documentElement.dataset["accent"] = accent; document.documentElement.dataset["density"] = density; }, [accent, density]);
}
const isActive = (path: string, to: string) => to === "/" ? path === "/" : path.startsWith(to);

export function ScaleMark({ className }: { className?: string }) {
  return <svg viewBox="0 0 32 32" fill="none" aria-hidden="true" className={cn("size-8", className)}><path d="M5 23V14l7-5v9l-7 5Zm10-5V9l7-5v9l-7 5Zm0 10v-7l12-8v7l-12 8Z" fill="currentColor" /></svg>;
}

export function Shell({ title, subtitle, actions, children }: { title: string; subtitle?: string; actions?: ReactNode; children: ReactNode }) {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const { theme, owner, business, preferences, followUps, leads, deals, notes } = useCRM();
  const [more, setMore] = useState(false), [add, setAdd] = useState(false), [schedule, setSchedule] = useState(false);
  const [collapsed, setCollapsed] = useState(false), [search, setSearch] = useState(false), [query, setQuery] = useState(""), [alerts, setAlerts] = useState(false);
  usePreferenceEffects();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const dark = theme === "dark";
  const today = dayKey(new Date());
  const attention = followUps.filter(f => isPending(f) && dayKey(f.dueAt) <= today).sort((a,b) => a.dueAt.localeCompare(b.dueAt));
  const matches = (text: string) => text.toLowerCase().includes(query.toLowerCase());
  const current = NAV.find(n => isActive(path, n.to));
  if (!mounted) return <div className="flex min-h-screen bg-background"><aside className="hidden w-60 shrink-0 bg-sidebar md:block" /><div className="flex-1 p-8"><div className="h-7 w-48 animate-pulse rounded-md bg-muted" /><div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">{[0,1,2,3].map(i => <div key={i} className="h-28 animate-pulse rounded-lg bg-muted" />)}</div></div></div>;
  return (
    <div className="crm-workspace flex min-h-screen bg-background">
      <aside className={cn("workspace-sidebar sticky top-0 hidden h-screen shrink-0 flex-col bg-sidebar text-sidebar-foreground md:flex", collapsed && "is-collapsed")}>
        <Link to="/" className="sidebar-brand flex h-24 items-center gap-3 px-6" title={business}>
          <ScaleMark className="size-9 shrink-0 text-sidebar-primary" /><div className="sidebar-label min-w-0"><div className="truncate font-display text-lg font-extrabold">{business}</div><div className="mt-0.5 text-[10px] font-medium text-sidebar-muted">SALES WORKSPACE</div></div>
        </Link>
        <div className="px-4"><Button onClick={() => setAdd(true)} title="Add lead" className="sidebar-create h-10 w-full bg-sidebar-primary text-sidebar-primary-foreground hover:bg-sidebar-primary/90"><Plus className="size-4 shrink-0" /><span className="sidebar-label">Add lead</span></Button></div>
        <nav className="mt-5 flex-1 space-y-1 overflow-y-auto px-3 pb-4 scrollbar-thin" aria-label="Main navigation">
          {NAV.map(n => <div key={n.to}>
            {n.section && <div className="sidebar-section sidebar-label px-3 pt-5 pb-2 text-[10px] font-semibold uppercase text-sidebar-muted">{n.section}</div>}
            <Link to={n.to} title={n.label} aria-current={isActive(path,n.to) ? "page" : undefined} className={cn("sidebar-link relative flex min-h-11 items-center gap-3 rounded-md px-3 text-[13px] font-medium transition-all", isActive(path,n.to) ? "is-active bg-sidebar-accent text-sidebar-accent-foreground" : "text-sidebar-muted hover:bg-sidebar-accent/50 hover:text-sidebar-foreground")}><n.icon className="size-[18px] shrink-0" /><span className="sidebar-label whitespace-nowrap">{n.label}</span>{n.to === "/follow-ups" && attention.length > 0 && <span className="sidebar-label ml-auto rounded bg-sidebar-primary/20 px-1.5 py-0.5 text-[10px] text-sidebar-primary-foreground">{attention.length}</span>}</Link>
          </div>)}
        </nav>
        <div className="mx-4 border-t border-sidebar-border py-3"><Button variant="ghost" title={collapsed ? "Expand sidebar" : "Collapse sidebar"} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} onClick={() => setCollapsed(!collapsed)} className="hidden w-full justify-start px-2 text-sidebar-muted hover:bg-sidebar-accent hover:text-sidebar-foreground lg:flex">{collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}<span className="sidebar-label text-xs">Collapse sidebar</span></Button></div>
        <Link to="/settings" className="flex items-center gap-3 border-t border-sidebar-border bg-sidebar-accent/30 px-5 py-5" title="Profile settings"><div className="grid size-9 shrink-0 place-items-center rounded-lg bg-sidebar-primary/20 text-xs font-bold text-sidebar-primary-foreground">{initials(owner)}</div><div className="sidebar-label min-w-0 flex-1"><div className="truncate text-xs font-semibold">{owner}</div><div className="mt-0.5 text-[10px] text-sidebar-muted">Owner · Local demo</div></div><ChevronsUpDown className="sidebar-label size-4 text-sidebar-muted" /></Link>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col pb-24 md:pb-0">
        <div className="workspace-topbar sticky top-0 z-30 flex h-[68px] shrink-0 items-center justify-between gap-3 border-b bg-card/95 px-4 sm:px-7 lg:px-9">
          <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground"><ScaleMark className="size-6 text-primary md:hidden" /><span className="hidden lg:inline">Workspace</span><span className="hidden lg:inline">/</span><span className="truncate font-semibold text-foreground">{current?.label ?? "Lead details"}</span></div>
          <div className="flex shrink-0 items-center gap-1.5 sm:gap-3">
            <Button variant="ghost" aria-label="Search workspace" onClick={() => setSearch(true)} className="workspace-search h-9 gap-2 border border-border bg-background px-2.5 text-muted-foreground sm:w-52 sm:justify-start"><Search className="size-4" /><span className="hidden text-xs sm:inline">Search workspace…</span></Button>
            <DropdownMenu><DropdownMenuTrigger asChild><Button variant="outline" aria-label="Quick create" className="h-9 gap-1.5 px-2.5"><Plus className="size-4" /><span className="hidden text-xs lg:inline">Create</span><ChevronDown className="hidden size-3 lg:block" /></Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem onSelect={() => setAdd(true)}><Users />Add lead</DropdownMenuItem><DropdownMenuItem onSelect={() => setSchedule(true)}><CalendarClock />Schedule follow-up</DropdownMenuItem><DropdownMenuItem asChild><Link to="/deals"><Wallet />Deals & Payments</Link></DropdownMenuItem><DropdownMenuItem asChild><Link to="/notes"><StickyNote />New note</Link></DropdownMenuItem></DropdownMenuContent></DropdownMenu>
            <Button variant="ghost" size="icon" title="Toggle theme" aria-label="Toggle theme" onClick={() => preferences({theme: dark ? "light" : "dark"})} className="hidden text-muted-foreground sm:inline-flex">{dark ? <Sun /> : <Moon />}</Button>
            <Button variant="ghost" size="icon" title="Notifications" aria-label="Notifications" onClick={() => setAlerts(true)} className="relative text-muted-foreground"><Bell />{attention.length > 0 && <span className="absolute top-1.5 right-2 size-1.5 rounded-full bg-destructive" />}</Button>
            <Button variant="ghost" size="icon" asChild className="hidden rounded-full bg-primary-soft text-xs font-bold text-primary sm:inline-flex"><Link to="/settings" title="Profile settings">{initials(owner)}</Link></Button>
          </div>
        </div>
        <header className="workspace-heading mx-auto flex w-full max-w-[1640px] flex-wrap items-center justify-between gap-4 px-4 pt-7 pb-6 sm:px-7 lg:px-9 lg:pt-9"><div className="min-w-0"><h1 className="font-display text-2xl font-extrabold text-foreground sm:text-[28px]">{title}</h1>{subtitle && <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">{subtitle}</p>}</div>{actions}</header>
        <main key={path} data-page={current?.to ?? "detail"} className="page-enter mx-auto w-full max-w-[1640px] flex-1 px-4 pb-10 sm:px-7 lg:px-9">{children}</main>
        <footer className="mx-4 mt-auto flex items-center justify-between gap-2 border-t py-4 text-[10px] text-muted-foreground sm:mx-7 lg:mx-9"><span>Scale Flow · CRM 2.0</span><span>Local demo <span className="mx-1">·</span>{formatDate(new Date().toISOString(), {day:"numeric",month:"short",year:"numeric"})}</span></footer>
      </div>
      <nav aria-label="Mobile navigation" className="mobile-navigation fixed inset-x-0 bottom-0 z-40 flex items-center justify-around border-t bg-card px-1 pt-2 pb-3 md:hidden">
        {NAV.filter(n => MOBILE_MAIN.includes(n.to)).map(n => <Link key={n.to} to={n.to} aria-current={isActive(path,n.to) ? "page" : undefined} className={cn("flex min-h-12 min-w-14 flex-col items-center justify-center gap-1 rounded-lg text-[10px] font-medium",isActive(path,n.to) ? "bg-primary-soft text-primary" : "text-muted-foreground")}><n.icon className="size-5" />{n.mobile}</Link>)}
        <Button variant="ghost" aria-label="More" onClick={() => setMore(true)} className="h-12 min-w-14 flex-col gap-1 px-2 text-[10px] text-muted-foreground"><MoreHorizontal className="size-5" />More</Button>
      </nav>
      <Sheet open={more} onOpenChange={setMore}><SheetContent side="bottom" className="max-h-[85dvh] overflow-y-auto rounded-t-lg"><SheetHeader><SheetTitle>Workspace</SheetTitle></SheetHeader><div className="mt-5 grid grid-cols-3 gap-2">{NAV.map(n => <Link key={n.to} to={n.to} onClick={() => setMore(false)} className={cn("flex min-h-20 flex-col items-center justify-center gap-2 rounded-lg border p-2 text-center text-xs",isActive(path,n.to) ? "border-primary bg-primary-soft text-primary" : "text-foreground")}><n.icon className="size-5" />{n.label}</Link>)}</div><div className="mt-4 flex gap-2"><Button className="flex-1" onClick={() => {setMore(false);setAdd(true);}}><Plus />Add lead</Button><Button variant="outline" title="Toggle theme" aria-label="Toggle theme" onClick={() => preferences({theme:dark ? "light":"dark"})}>{dark ? <Sun />:<Moon />}</Button></div></SheetContent></Sheet>
      <Dialog open={search} onOpenChange={setSearch}><DialogContent className="sm:max-w-xl"><DialogHeader><DialogTitle>Search workspace</DialogTitle><DialogDescription>Leads, deals and personal notes</DialogDescription></DialogHeader><Input autoFocus aria-label="Global search" placeholder="Search name, company, deal or note…" value={query} onChange={e => setQuery(e.target.value)} /><div className="grid max-h-[55vh] gap-1 overflow-y-auto">
        <div className="search-section">Leads</div>{leads.filter(l => matches(`${l.name} ${l.company ?? ""} ${l.phone}`)).slice(0,6).map(l => <Link key={l.id} to="/leads/$id" params={{id:l.id}} onClick={() => setSearch(false)} className="search-result"><Identity name={l.name} company={l.company} /><ArrowUpRight className="size-4 text-muted-foreground" /></Link>)}
        <div className="search-section">Deals</div>{deals.filter(d => matches(`${d.name} ${d.clientName}`)).slice(0,4).map(d => <Link key={d.id} to="/deals" onClick={() => setSearch(false)} className="search-result"><Wallet className="size-4 text-teal" /><span className="flex-1 text-sm">{d.name}<span className="block text-xs text-muted-foreground">{d.clientName}</span></span><ArrowUpRight className="size-4" /></Link>)}
        <div className="search-section">Personal notes</div>{notes.filter(n => matches(`${n.title} ${n.body}`)).slice(0,4).map(n => <Link key={n.id} to="/notes" onClick={() => setSearch(false)} className="search-result"><StickyNote className="size-4 text-warning" /><span className="flex-1 text-sm">{n.title}</span><ArrowUpRight className="size-4" /></Link>)}
        {query && !leads.some(l => matches(`${l.name} ${l.company ?? ""} ${l.phone}`)) && !deals.some(d => matches(`${d.name} ${d.clientName}`)) && !notes.some(n => matches(`${n.title} ${n.body}`)) && <p className="py-6 text-center text-sm text-muted-foreground">No matching records.</p>}
      </div></DialogContent></Dialog>
      <Sheet open={alerts} onOpenChange={setAlerts}><SheetContent className="w-full sm:max-w-md"><SheetHeader><SheetTitle>Notifications</SheetTitle></SheetHeader><p className="mt-2 text-xs text-muted-foreground">From local demo records · no live delivery</p><div className="mt-6 grid gap-3">{attention.map(f => <Link key={f.id} to="/leads/$id" params={{id:f.leadId}} onClick={() => setAlerts(false)} className="rounded-lg border p-4"><span className="text-sm font-semibold">{leads.find(l => l.id === f.leadId)?.name ?? "Lead"}</span><span className="mt-1 block text-xs text-muted-foreground">{f.note ?? "Follow-up due"} · {formatDateTime(f.dueAt)}</span></Link>)}{!attention.length && <Empty icon={<Bell />} title="All caught up" />}</div></SheetContent></Sheet>
      <AddLeadDialog open={add} onOpenChange={setAdd} /><FollowUpDialog open={schedule} onOpenChange={setSchedule} /><PostCallDialog />
    </div>
  );
}
export function Identity({ name, company, className }: { name: string; company?: string | undefined; className?: string }) {
  return <div className={cn("flex min-w-0 items-center gap-3",className)}><div className="identity-avatar grid size-9 shrink-0 place-items-center rounded-lg bg-primary-soft text-[11px] font-bold text-primary">{initials(name)}</div><div className="min-w-0"><div className="text-sm font-semibold text-foreground">{name}</div>{company && <div className="mt-0.5 text-xs text-muted-foreground">{company}</div>}</div></div>;
}
export function Stat({ label, value, hint, tone="primary", icon }: { label:string; value:string; hint?:string; tone?:"primary"|"success"|"warning"|"destructive"|"teal"; icon?:ReactNode }) {
  const t = {primary:"bg-primary-soft text-primary",success:"bg-success-soft text-success",warning:"bg-warning-soft text-warning",destructive:"bg-destructive-soft text-destructive",teal:"bg-teal-soft text-teal"}[tone];
  return <div className="stat-card surface surface-hover relative p-4 sm:p-5" data-tone={tone}><div className="flex items-center justify-between gap-2"><div className="text-xs font-medium text-muted-foreground">{label}</div>{icon && <div className={cn("grid size-8 shrink-0 place-items-center rounded-lg [&_svg]:size-4",t)}>{icon}</div>}</div><div className="num mt-3 font-display text-[27px] font-extrabold leading-tight text-foreground">{value}</div>{hint && <div className="mt-2 text-[11px] text-muted-foreground">{hint}</div>}</div>;
}
const PRIORITY:Record<string,string> = {hot:"bg-destructive-soft text-destructive",warm:"bg-warning-soft text-warning",cold:"bg-info-soft text-primary"};
export function PriorityBadge({p}:{p:string}) {return <span className={cn("inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[10px] font-semibold capitalize",PRIORITY[p])}><span className="size-1 rounded-full bg-current" />{p}</span>;}
export function Empty({icon,title,hint,action}:{icon:ReactNode;title:string;hint?:string;action?:ReactNode}) {return <div className="flex flex-col items-center px-6 py-14 text-center"><div className="grid size-12 place-items-center rounded-lg border bg-muted/50 text-muted-foreground [&_svg]:size-5">{icon}</div><div className="mt-4 font-display font-bold text-foreground">{title}</div>{hint && <p className="mt-2 max-w-xs text-sm leading-relaxed text-muted-foreground">{hint}</p>}{action && <div className="mt-5">{action}</div>}</div>;}
export const selectCls="h-10 max-w-full rounded-md border border-input bg-card px-3 text-sm text-foreground transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none";
