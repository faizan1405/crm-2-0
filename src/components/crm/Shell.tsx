import { WhatsAppComposer } from "@/components/crm/WhatsAppComposer";
import { isPending } from "@/lib/crm/followups";
import { PostCallDialog, openCallLog } from "@/components/crm/PostCallDialog";
import { Link, useRouterState } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import {
  LayoutDashboard, Users, KanbanSquare, CalendarClock, Wallet, StickyNote, Moon, Sun,
  BarChart3, Sunrise, Settings, MoreHorizontal, Plus, Search, Bell, ArrowUpRight, PhoneCall, Menu, ChevronRight, PanelLeftClose, PanelLeftOpen, Presentation, ShieldCheck,
  Archive,
} from "lucide-react";
import { useCRM } from "@/lib/crm/store";
import { useSession, useAccess, routeAllowed, type PreviewSession } from "@/lib/crm/session";
import { exitPreview } from "@/lib/crm/preview";
import { useNavigate } from "@tanstack/react-router";
import { Eye, Lock } from "lucide-react";
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
  { to: "/sales-studio", label: "Sales Studio", mobile: "Studio", icon: Presentation, section: "" },
  { to: "/notes", label: "Personal Notes", mobile: "Notes", icon: StickyNote, section: "" },
  { to: "/analytics", label: "Analytics", mobile: "Analytics", icon: BarChart3, section: "Insights" },
  { to: "/daily-briefing", label: "Daily Briefing", mobile: "Briefing", icon: Sunrise, section: "" },
  { to: "/team", label: "Team Management", mobile: "Team", icon: ShieldCheck, section: "Admin" },
  { to: "/data-vault", label: "Data Vault", mobile: "Vault", icon: Archive, section: "" },
  { to: "/settings", label: "Settings", mobile: "Settings", icon: Settings, section: "Manage" },
] as const;
const MOBILE_MAIN = ["/", "/leads", "/pipeline", "/follow-ups"];
function usePreferenceEffects() {
  const { theme, accent, density, timeFormat, dateStyle } = useCRM();
  displayPrefs.hour12 = timeFormat === "12h";
  displayPrefs.longDate = dateStyle === "long";
  useEffect(() => {
    // During an Employee Preview the working copy lives only in memory — never reload Owner data over it.
    if (!useSession.getState().preview) void useCRM.persist.rehydrate();
    // Multi-tab sync: another tab saved → reload the shared store here (no polling).
    const onStorage = (e: StorageEvent) => { if (e.key === useCRM.persist.getOptions().name && !useSession.getState().preview) void useCRM.persist.rehydrate(); };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
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

const GROUPS = [
  { label: "Workspace", items: ["/", "/leads", "/pipeline", "/follow-ups"] },
  { label: "Business", items: ["/deals", "/sales-studio", "/analytics", "/daily-briefing"] },
  { label: "Personal", items: ["/notes"] },
  { label: "Owner admin", items: ["/team", "/data-vault"] },
  { label: "System", items: ["/settings"] },
] as const;
const COLLAPSE_KEY = "scale-flow-sidebar-collapsed";

function SideNav({ path, collapsed, badge, onNavigate }: { path: string; collapsed: boolean; badge: number; onNavigate?: () => void }) {
  const preview = useSession((s) => s.preview);
  return <nav aria-label="Main navigation" className="sb-nav">
    {GROUPS.map(g => ({ ...g, items: g.items.filter(to => routeAllowed(preview, to)) })).filter(g => g.items.length).map(g => <div key={g.label} className="sb-group">
      <div className="sb-group-label" aria-hidden={collapsed}>{g.label}</div>
      {g.items.map(to => { const n = NAV.find(x => x.to === to)!; const active = isActive(path, to);
        return <Link key={to} to={to} onClick={onNavigate} aria-current={active ? "page" : undefined} title={collapsed ? n.label : undefined} aria-label={collapsed ? n.label : undefined} className="sb-link">
          <n.icon className="sb-icon" /><span className="sb-label">{n.label}</span>
          {to === "/follow-ups" && badge > 0 && <span className="sb-badge num">{badge}</span>}
        </Link>; })}
    </div>)}
  </nav>;
}

export function Shell({ title, subtitle, actions, children }: { title: string; subtitle?: string; actions?: ReactNode; children: ReactNode }) {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const { theme, owner, business, preferences, followUps, leads, deals, notes } = useCRM();
  const [more, setMore] = useState(false), [add, setAdd] = useState(false), [schedule, setSchedule] = useState(false);
  const [search, setSearch] = useState(false), [query, setQuery] = useState(""), [alerts, setAlerts] = useState(false);
  const [callPick, setCallPick] = useState(false), [callQ, setCallQ] = useState("");
  const [collapsed, setCollapsed] = useState(false), [drawer, setDrawer] = useState(false);
  usePreferenceEffects();
  const { preview, can } = useAccess();
  const navigate = useNavigate();
  const nav = NAV.filter(n => routeAllowed(preview, n.to));
  const owner_ = preview ? preview.name : owner;
  const leave = () => { const id = preview?.employeeId; exitPreview(); void navigate({ to: "/team", search: id ? { employee: id } : {} }); };
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); setCollapsed(localStorage.getItem(COLLAPSE_KEY) === "1"); }, []);
  const toggleCollapse = () => setCollapsed(c => { localStorage.setItem(COLLAPSE_KEY, c ? "0" : "1"); return !c; });
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setSearch(true); } };
    window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k);
  }, []);
  const dark = theme === "dark";
  const attention = followUps.filter(f => isPending(f) && dayKey(f.dueAt) <= dayKey(new Date())).sort((a,b) => a.dueAt.localeCompare(b.dueAt));
  const matches = (text: string) => text.toLowerCase().includes(query.toLowerCase());
  const current = NAV.find(n => isActive(path, n.to));
  const group = GROUPS.find(g => current && (g.items as readonly string[]).includes(current.to))?.label ?? "Workspace";
  const callable = leads.filter(l => !["won","lost"].includes(l.status) && `${l.name} ${l.company ?? ""} ${l.phone}`.toLowerCase().includes(callQ.toLowerCase()));
  if (!mounted) return <div className="flex min-h-screen bg-background"><div className="hidden w-[248px] shrink-0 bg-sidebar md:block" /><div className="flex-1 p-8"><div className="h-10 w-72 animate-pulse rounded-md bg-muted" /><div className="mt-8 grid gap-4 sm:grid-cols-3">{[0,1,2].map(i => <div key={i} className="h-28 animate-pulse rounded-xl bg-muted" />)}</div><div className="mt-6 h-64 animate-pulse rounded-xl bg-muted" /></div></div>;
  return (
    <div className="crm-workspace flex min-h-screen bg-background" data-collapsed={collapsed ? "true" : "false"}>
      <aside className="sb hidden md:flex" aria-label="Sidebar">
        <div className="sb-brand">
          <Link to="/" className="flex min-w-0 items-center gap-2.5" title={business}><span className="sb-mark"><ScaleMark className="size-[18px]" /></span><span className="sb-label min-w-0 leading-none"><span className="block truncate text-[15px] font-semibold tracking-tight">Scale Flow</span><span className="sb-os mt-1 block">Sales OS</span></span></Link>
        </div>
        <SideNav path={path} collapsed={collapsed} badge={attention.length} />
        <div className="sb-foot">
          {preview ? <button type="button" onClick={leave} className="sb-user" title="Exit preview" aria-label={`${preview.name}, exit preview`}>
            <span className="sb-avatar">{initials(preview.name)}</span>
            <span className="sb-label min-w-0 leading-tight text-left"><span className="block truncate text-[13px] font-medium">{preview.name}</span><span className="block truncate text-[11px] opacity-60">{preview.roleLabel} · preview</span></span>
          </button> : <Link to="/settings" className="sb-user" title={collapsed ? `${owner} · Settings` : undefined} aria-label={collapsed ? `${owner}, open settings` : undefined}>
            <span className="sb-avatar">{initials(owner)}</span>
            <span className="sb-label min-w-0 leading-tight"><span className="block truncate text-[13px] font-medium">{owner}</span><span className="block truncate text-[11px] opacity-60">{business} · local demo</span></span>
            <Settings className="sb-label ml-auto size-4 opacity-60" />
          </Link>}
          <button type="button" onClick={toggleCollapse} className="sb-collapse" aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} aria-expanded={!collapsed} title={collapsed ? "Expand sidebar" : "Collapse sidebar"}>{collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}<span className="sb-label text-xs">Collapse</span></button>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col pb-28 md:pb-0">
        {preview && <PreviewBar p={preview} onExit={leave} />}
        <header className="topbar sticky top-0 z-30 border-b">
          <div className="mx-auto flex h-14 max-w-[1400px] items-center gap-2 px-4 sm:px-6 lg:px-8">
            <button type="button" className="topbar-icon md:!hidden" aria-label="Open navigation" onClick={() => setDrawer(true)}><Menu className="size-5" /></button>
            <Link to="/" className="flex items-center gap-2 md:hidden" aria-label="Dashboard"><span className="sb-mark sb-mark-light"><ScaleMark className="size-4" /></span></Link>
            <div className="crumb hidden min-w-0 items-center gap-1.5 text-[13px] sm:flex"><span className="text-muted-foreground">{group}</span><ChevronRight className="size-3.5 text-muted-foreground" /><span className="truncate font-medium">{current?.label ?? "Lead details"}</span></div>
            <button type="button" onClick={() => setSearch(true)} aria-label="Search workspace" className="os-command ml-auto min-w-0 sm:w-64 lg:w-80"><Search className="size-4 shrink-0" /><span className="hidden flex-1 truncate text-left sm:inline">Search…</span><span className="os-kbd hidden sm:inline">⌘K</span></button>
            {can("clients.calls") && <button type="button" onClick={() => setCallPick(true)} className="os-calllog" aria-label="Instant call log"><PhoneCall className="size-4" /><span className="hidden lg:inline">Call log</span></button>}
            <DropdownMenu><DropdownMenuTrigger asChild><button type="button" aria-label="Quick add" className="topbar-icon"><Plus className="size-[18px]" /></button></DropdownMenuTrigger><DropdownMenuContent align="end">{can("leads.create") && <DropdownMenuItem onSelect={() => setAdd(true)}><Users />Add lead</DropdownMenuItem>}{can("followups.create") && <DropdownMenuItem onSelect={() => setSchedule(true)}><CalendarClock />Schedule follow-up</DropdownMenuItem>}{routeAllowed(preview, "/deals") && <DropdownMenuItem asChild><Link to="/deals"><Wallet />Deals & Payments</Link></DropdownMenuItem>}{routeAllowed(preview, "/notes") && <DropdownMenuItem asChild><Link to="/notes"><StickyNote />New note</Link></DropdownMenuItem>}</DropdownMenuContent></DropdownMenu>
            <button type="button" title="Notifications" aria-label="Notifications" onClick={() => setAlerts(true)} className="topbar-icon relative"><Bell className="size-[18px]" />{attention.length > 0 && <span className="absolute top-2 right-2 size-1.5 rounded-full bg-destructive" />}</button>
            <button type="button" title="Toggle theme" aria-label="Toggle theme" onClick={() => preferences({theme: dark ? "light" : "dark"})} className="topbar-icon !hidden sm:!grid">{dark ? <Sun className="size-[18px]" /> : <Moon className="size-[18px]" />}</button>
          </div>
        </header>
        <div className="os-heading mx-auto flex w-full max-w-[1400px] flex-wrap items-end justify-between gap-4 px-4 pt-6 pb-5 sm:px-6 lg:px-8 lg:pt-8">
          <div className="min-w-0"><h1 className="text-[26px] font-semibold tracking-tight text-foreground sm:text-[30px]">{title}</h1>{subtitle && <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-muted-foreground">{subtitle}</p>}</div>{actions}
        </div>
        <main key={path} data-page={current?.to ?? "detail"} className="page-enter mx-auto w-full max-w-[1400px] flex-1 px-4 pb-12 sm:px-6 lg:px-8">{routeAllowed(preview, path) ? children : <div className="surface"><Empty icon={<Lock />} title="Not in this workspace" hint={`${preview?.name ?? "This employee"} has no access to this page.`} action={<Button asChild><Link to="/">Go to their dashboard</Link></Button>} /></div>}</main>
        <footer className="mx-auto mt-auto flex w-full max-w-[1400px] items-center justify-between gap-2 border-t px-4 py-4 sm:px-6 lg:px-8"><span className="eyebrow">Scale Flow · Sales OS 3.0</span><span className="eyebrow">Local demo · {formatDate(new Date().toISOString(),{day:"numeric",month:"short",year:"numeric"})}</span></footer>
      </div>
      <nav aria-label="Mobile navigation" className="os-mobile-bar fixed inset-x-3 bottom-3 z-40 flex items-center justify-around rounded-[22px] px-1.5 py-1.5 shadow-[var(--shadow-pop)] md:hidden">
        {nav.filter(n => MOBILE_MAIN.includes(n.to)).map(n => <Link key={n.to} to={n.to} aria-current={isActive(path,n.to) ? "page" : undefined} className="flex min-h-12 min-w-14 flex-1 flex-col items-center justify-center gap-0.5 rounded-2xl text-[10px] font-medium transition-colors"><n.icon className="size-5" />{n.mobile}</Link>)}
        <button type="button" aria-label="More" onClick={() => setMore(true)} className="flex min-h-12 min-w-14 flex-1 flex-col items-center justify-center gap-0.5 rounded-2xl text-[10px] font-medium"><MoreHorizontal className="size-5" />More</button>
      </nav>
      <Sheet open={drawer} onOpenChange={setDrawer}><SheetContent side="left" className="sb-drawer w-[280px] border-0 p-0"><SheetHeader className="sr-only"><SheetTitle>Navigation</SheetTitle></SheetHeader><div className="sb flex h-full w-full"><div className="sb-brand"><span className="sb-mark"><ScaleMark className="size-[18px]" /></span><span className="leading-none"><span className="block text-[15px] font-semibold">Scale Flow</span><span className="sb-os mt-1 block">Sales OS</span></span></div><SideNav path={path} collapsed={false} badge={attention.length} onNavigate={() => setDrawer(false)} /><div className="sb-foot">{preview ? <button type="button" onClick={() => { setDrawer(false); leave(); }} className="sb-user"><span className="sb-avatar">{initials(owner_)}</span><span className="min-w-0 leading-tight text-left"><span className="block truncate text-[13px] font-medium">{owner_}</span><span className="block truncate text-[11px] opacity-60">Exit preview</span></span></button> : <Link to="/settings" onClick={() => setDrawer(false)} className="sb-user"><span className="sb-avatar">{initials(owner)}</span><span className="min-w-0 leading-tight"><span className="block truncate text-[13px] font-medium">{owner}</span><span className="block truncate text-[11px] opacity-60">{business} · local demo</span></span></Link>}</div></div></SheetContent></Sheet>
      <Sheet open={more} onOpenChange={setMore}><SheetContent side="bottom" className="max-h-[85dvh] overflow-y-auto rounded-t-3xl"><SheetHeader><SheetTitle className="text-xl font-semibold">Workspace</SheetTitle></SheetHeader><div className="mt-5 grid grid-cols-3 gap-2">{nav.map(n => <Link key={n.to} to={n.to} onClick={() => setMore(false)} className={cn("flex min-h-20 flex-col items-center justify-center gap-2 rounded-2xl border p-2 text-center text-xs",isActive(path,n.to) ? "border-foreground bg-primary text-primary-foreground" : "text-foreground")}><n.icon className="size-5" />{n.label}</Link>)}</div><div className="mt-4 flex gap-2">{can("leads.create") && <Button className="flex-1" onClick={() => {setMore(false);setAdd(true);}}><Plus />Add lead</Button>}{can("clients.calls") && <Button variant="outline" onClick={() => {setMore(false);setCallPick(true);}}><PhoneCall />Call log</Button>}{preview && <Button variant="outline" onClick={() => {setMore(false);leave();}}>Exit preview</Button>}<Button variant="outline" title="Toggle theme" aria-label="Toggle theme" onClick={() => preferences({theme:dark ? "light":"dark"})}>{dark ? <Sun />:<Moon />}</Button></div></SheetContent></Sheet>
      <Dialog open={search} onOpenChange={setSearch}><DialogContent className="sm:max-w-xl"><DialogHeader><DialogTitle>Search workspace</DialogTitle><DialogDescription>Leads, deals and personal notes</DialogDescription></DialogHeader><Input autoFocus aria-label="Global search" placeholder="Search name, company, deal or note…" value={query} onChange={e => setQuery(e.target.value)} /><div className="grid max-h-[55vh] gap-1 overflow-y-auto">
        <div className="search-section">Leads</div>{leads.filter(l => matches(`${l.name} ${l.company ?? ""} ${l.phone}`)).slice(0,6).map(l => <Link key={l.id} to="/leads/$id" params={{id:l.id}} onClick={() => setSearch(false)} className="search-result"><Identity name={l.name} company={l.company} /><ArrowUpRight className="size-4 text-muted-foreground" /></Link>)}
        <div className="search-section">Deals</div>{deals.filter(d => matches(`${d.name} ${d.clientName}`)).slice(0,4).map(d => <Link key={d.id} to="/deals" onClick={() => setSearch(false)} className="search-result"><Wallet className="size-4 text-teal" /><span className="flex-1 text-sm">{d.name}<span className="block text-xs text-muted-foreground">{d.clientName}</span></span><ArrowUpRight className="size-4" /></Link>)}
        <div className="search-section">Personal notes</div>{notes.filter(n => matches(`${n.title} ${n.body}`)).slice(0,4).map(n => <Link key={n.id} to="/notes" onClick={() => setSearch(false)} className="search-result"><StickyNote className="size-4 text-warning" /><span className="flex-1 text-sm">{n.title}</span><ArrowUpRight className="size-4" /></Link>)}
        {query && !leads.some(l => matches(`${l.name} ${l.company ?? ""} ${l.phone}`)) && !deals.some(d => matches(`${d.name} ${d.clientName}`)) && !notes.some(n => matches(`${n.title} ${n.body}`)) && <p className="py-6 text-center text-sm text-muted-foreground">No matching records.</p>}
      </div></DialogContent></Dialog>
      <Dialog open={callPick} onOpenChange={setCallPick}><DialogContent className="sm:max-w-lg"><DialogHeader><DialogTitle>Instant call log</DialogTitle><DialogDescription>Pick who you just spoke with — the log opens without dialling.</DialogDescription></DialogHeader><Input autoFocus aria-label="Find lead to log" placeholder="Name, company or phone…" value={callQ} onChange={e => setCallQ(e.target.value)} /><div className="grid max-h-[50vh] gap-1 overflow-y-auto">{callable.slice(0,8).map(l => <button key={l.id} type="button" className="search-result text-left" onClick={() => { setCallPick(false); setCallQ(""); openCallLog(l.id, "Command bar"); }}><Identity name={l.name} company={l.company} /><span className="num text-xs text-muted-foreground">{l.phone}</span></button>)}{!callable.length && <p className="py-6 text-center text-sm text-muted-foreground">No open leads match.</p>}</div></DialogContent></Dialog>
      <Sheet open={alerts} onOpenChange={setAlerts}><SheetContent className="w-full sm:max-w-md"><SheetHeader><SheetTitle>Notifications</SheetTitle></SheetHeader><p className="mt-2 text-xs text-muted-foreground">From local demo records · no live delivery</p><div className="mt-6 grid gap-3">{attention.map(f => <Link key={f.id} to="/leads/$id" params={{id:f.leadId}} onClick={() => setAlerts(false)} className="rounded-2xl border p-4"><span className="text-sm font-semibold">{leads.find(l => l.id === f.leadId)?.name ?? "Lead"}</span><span className="mt-1 block text-xs text-muted-foreground">{f.note ?? "Follow-up due"} · {formatDateTime(f.dueAt)}</span></Link>)}{!attention.length && <Empty icon={<Bell />} title="All caught up" />}</div></SheetContent></Sheet>
      <AddLeadDialog open={add} onOpenChange={setAdd} /><FollowUpDialog open={schedule} onOpenChange={setSchedule} /><PostCallDialog /><WhatsAppComposer />
    </div>
  );
}
export function Identity({ name, company, className }: { name: string; company?: string | undefined; className?: string }) {
  return <div className={cn("flex min-w-0 items-center gap-3",className)}><div className="identity-avatar grid size-9 shrink-0 place-items-center rounded-full bg-clay-soft text-[11px] font-semibold text-foreground">{initials(name)}</div><div className="min-w-0"><div className="text-sm font-semibold text-foreground">{name}</div>{company && <div className="mt-0.5 text-xs text-muted-foreground">{company}</div>}</div></div>;
}
export function Stat({ label, value, hint, tone="primary", icon }: { label:string; value:string; hint?:string; tone?:"primary"|"success"|"warning"|"destructive"|"teal"; icon?:ReactNode }) {
  const t = {primary:"bg-primary-soft text-primary",success:"bg-success-soft text-success",warning:"bg-warning-soft text-warning",destructive:"bg-destructive-soft text-destructive",teal:"bg-teal-soft text-teal"}[tone];
  return <div className="stat-card surface surface-hover relative p-4 sm:p-5" data-tone={tone}><div className="flex items-center justify-between gap-2"><div className="text-xs font-medium text-muted-foreground">{label}</div>{icon && <div className={cn("grid size-8 shrink-0 place-items-center rounded-lg [&_svg]:size-4",t)}>{icon}</div>}</div><div className="num mt-3 text-[26px] font-medium leading-tight text-foreground">{value}</div>{hint && <div className="mt-2 text-[11px] text-muted-foreground">{hint}</div>}</div>;
}
const PRIORITY:Record<string,string> = {hot:"bg-destructive-soft text-destructive",warm:"bg-clay-soft text-foreground",cold:"bg-neutral-soft text-muted-foreground"};
export function PriorityBadge({p}:{p:string}) {return <span className={cn("inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[10px] font-semibold capitalize",PRIORITY[p])}><span className="size-1 rounded-full bg-current" />{p}</span>;}
export function Empty({icon,title,hint,action}:{icon:ReactNode;title:string;hint?:string;action?:ReactNode}) {return <div className="flex flex-col items-center px-6 py-14 text-center"><div className="grid size-12 place-items-center rounded-lg border bg-muted/50 text-muted-foreground [&_svg]:size-5">{icon}</div><div className="mt-4 editorial text-2xl text-foreground">{title}</div>{hint && <p className="mt-2 max-w-xs text-sm leading-relaxed text-muted-foreground">{hint}</p>}{action && <div className="mt-5">{action}</div>}</div>;}
export const selectCls="h-10 max-w-full rounded-md border border-input bg-card px-3 text-sm text-foreground transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none";

function PreviewBar({ p, onExit }: { p: PreviewSession; onExit: () => void }) {
  const n = useSession((s) => s.events.length);
  return <div className="pv-banner pv-banner-top" role="status"><Eye className="size-4 shrink-0" /><span className="min-w-0"><b>Demo preview — {p.name}&apos;s workspace.</b> <span className="hidden sm:inline">Real CRM actions on a temporary copy of their records{n ? ` · ${n} change${n === 1 ? "" : "s"} so far` : ""}. Nothing is saved; your data comes back unchanged when you exit. Not a login.</span></span><button type="button" onClick={onExit} className="pv-exit">Exit preview</button></div>;
}
