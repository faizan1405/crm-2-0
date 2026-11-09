import { WhatsAppComposer } from "@/components/crm/WhatsAppComposer";
import { isPending } from "@/lib/crm/followups";
import { PostCallDialog, openCallLog } from "@/components/crm/PostCallDialog";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useShallow } from "zustand/react/shallow";
import { startAutomationRunner } from "@/lib/crm/automationRunner";
import { onPersistFailure, isPersistError, usePersistStatus, recoveredFromFailure } from "@/lib/crm/persistStatus";
import { toast } from "sonner";
import {
  LayoutDashboard, Users, KanbanSquare, CalendarClock, Wallet, StickyNote, Moon, Sun,
  BarChart3, Sunrise, Settings, MoreHorizontal, Plus, Search, Bell, ArrowUpRight, PhoneCall, Menu, ChevronRight, PanelLeftClose, PanelLeftOpen, Presentation, ShieldCheck, Activity,
  Archive, Eye, Lock, Inbox, Workflow, Target, Gauge,
  SlidersHorizontal, FolderKanban, Sparkles, LogOut } from "lucide-react";
import { useCRM } from "@/lib/crm/store";
import { useSession, useAccess, routeAllowed, type PreviewSession } from "@/lib/crm/session";
import { logoutOwner, useResolvedAuthState } from "@/lib/auth/authClient";
import { exitPreview } from "@/lib/crm/preview";
import { NotificationCenter } from "./NotificationCenter";
import { cn } from "@/lib/utils";
import { initials, displayPrefs, formatDate, dayKey, formatDateTime } from "@/lib/crm/format";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { AddLeadDialog } from "./AddLeadDialog";
import { FollowUpDialog } from "./Dialogs";
import { NAV_GROUPS, GROUPS_KEY, effectiveOpen, parseOpenGroups, toggleGroup, visibleGroups, type GroupId } from "@/lib/crm/navGroups";
import { AppShellSkeleton, ScaleMark, Identity, Stat, PriorityBadge, Empty, selectCls } from "./ShellPrimitives";

export { ScaleMark, Identity, Stat, PriorityBadge, Empty, selectCls };

const NAV = [
  { to: "/", label: "Dashboard", mobile: "Home", icon: LayoutDashboard, section: "Workspace" },
  { to: "/inbox", label: "Smart Inbox", mobile: "Inbox", icon: Inbox, section: "" },
  { to: "/leads", label: "Leads", mobile: "Leads", icon: Users, section: "" },
  { to: "/pipeline", label: "Pipeline", mobile: "Pipeline", icon: KanbanSquare, section: "" },
  { to: "/follow-ups", label: "Follow-ups", mobile: "Follow-ups", icon: CalendarClock, section: "" },
  { to: "/deals", label: "Deals & Payments", mobile: "Deals", icon: Wallet, section: "" },
  { to: "/projects", label: "Project Desk", mobile: "Projects", icon: FolderKanban, section: "" },
  { to: "/sales-studio", label: "Sales Studio", mobile: "Studio", icon: Presentation, section: "" },
  { to: "/ai-copilot", label: "AI Sales Copilot", mobile: "Copilot", icon: Sparkles, section: "" },
  { to: "/notes", label: "Personal Notes", mobile: "Notes", icon: StickyNote, section: "" },
  { to: "/analytics", label: "Analytics", mobile: "Analytics", icon: BarChart3, section: "Insights" },
  { to: "/daily-briefing", label: "Daily Briefing", mobile: "Briefing", icon: Sunrise, section: "" },
  { to: "/team-activity", label: "Team Activity", mobile: "Activity", icon: Activity, section: "" },
  { to: "/my-performance", label: "My Performance", mobile: "Performance", icon: Target, section: "" },
  { to: "/team-performance", label: "Team Performance", mobile: "Performance", icon: Gauge, section: "" },
  { to: "/team", label: "Team Management", mobile: "Team", icon: ShieldCheck, section: "Admin" },
  { to: "/automation", label: "Automation Studio", mobile: "Automation", icon: Workflow, section: "" },
  { to: "/crm-config", label: "CRM Configuration", mobile: "Config", icon: SlidersHorizontal, section: "" },
  { to: "/data-vault", label: "Data Vault", mobile: "Vault", icon: Archive, section: "" },
  { to: "/settings", label: "Settings", mobile: "Settings", icon: Settings, section: "Manage" },
] as const;
const MOBILE_MAIN = ["/", "/leads", "/pipeline", "/follow-ups"];
function usePreferenceEffects(enabled: boolean) {
  const { theme, accent, density, timeFormat, dateStyle } = useCRM();
  displayPrefs.hour12 = timeFormat === "12h";
  displayPrefs.longDate = dateStyle === "long";
  useEffect(() => {
    if (!enabled) return;
    // During an Employee Preview the working copy lives only in memory — never reload Owner data over it.
    if (!useSession.getState().preview) void useCRM.persist.rehydrate();
    // Multi-tab sync: another tab saved → reload the shared store here (no polling).
    const onStorage = (e: StorageEvent) => { if (e.key === useCRM.persist.getOptions().name && !useSession.getState().preview) void useCRM.persist.rehydrate(); };
    window.addEventListener("storage", onStorage);
    startAutomationRunner();
    return () => window.removeEventListener("storage", onStorage);
  }, [enabled]);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => document.documentElement.classList.toggle("dark", theme === "dark" || (theme === "system" && mq.matches));
    apply(); mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [theme]);
  useEffect(() => { document.documentElement.dataset["accent"] = accent; document.documentElement.dataset["density"] = density; }, [accent, density]);
}
const isActive = (path: string, to: string) => to === "/" ? path === "/" : path === to || path.startsWith(`${to}/`) || (to === "/leads" && path.startsWith("/leads"));

const COLLAPSE_KEY = "scale-flow-sidebar-collapsed";

function SideNav({ path, collapsed, badge, onNavigate }: { path: string; collapsed: boolean; badge: number; onNavigate?: () => void }) {
  const preview = useSession((s) => s.preview);
  const [open, setOpen] = useState<GroupId[]>(() => NAV_GROUPS.map(g => g.id));
  useEffect(() => { setOpen(parseOpenGroups(localStorage.getItem(GROUPS_KEY))); }, []);
  const toggle = (id: GroupId) => setOpen(o => { const n = toggleGroup(o, id); try { localStorage.setItem(GROUPS_KEY, JSON.stringify(n)); } catch { /* layout preference only */ } return n; });
  const shown = effectiveOpen(open, path);
  return <nav aria-label="Main navigation" className="sb-nav">
    {visibleGroups(to => routeAllowed(preview, to)).map(g => { const expanded = collapsed || shown.includes(g.id); const listId = `sb-grp-${g.id}${onNavigate ? "-m" : ""}`;
      return <div key={g.id} className="sb-group">
      <button type="button" className="sb-group-label sb-group-btn" aria-expanded={expanded} aria-controls={listId} onClick={() => toggle(g.id)} tabIndex={collapsed ? -1 : 0} aria-hidden={collapsed || undefined}>
        <span>{g.label}</span><ChevronRight className={cn("size-3 transition-transform", expanded && "rotate-90")} aria-hidden />
      </button>
      <div id={listId} hidden={!expanded}>
      {g.items.map(to => { const n = NAV.find(x => x.to === to)!; const active = isActive(path, to);
        return <Link key={to} to={to} onClick={onNavigate} aria-current={active ? "page" : undefined} title={collapsed ? n.label : undefined} aria-label={collapsed ? n.label : undefined} className="sb-link">
          <n.icon className="sb-icon" /><span className="sb-label">{n.label}</span>
          {to === "/follow-ups" && badge > 0 && <span className="sb-badge num">{badge}</span>}
        </Link>; })}
      </div>
    </div>; })}
  </nav>;
}

export function Shell({ title, subtitle, actions, children }: { title: string; subtitle?: string; actions?: ReactNode; children: ReactNode }) {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const { theme, owner, business, preferences, followUps, leads, deals, notes } = useCRM(useShallow((s) => ({ theme: s.theme, owner: s.owner, business: s.business, preferences: s.preferences, followUps: s.followUps, leads: s.leads, deals: s.deals, notes: s.notes })));
  const [more, setMore] = useState(false), [add, setAdd] = useState(false), [schedule, setSchedule] = useState(false);
  const [search, setSearch] = useState(false), [query, setQuery] = useState(""), [alerts, setAlerts] = useState(false);
  const [callPick, setCallPick] = useState(false), [callQ, setCallQ] = useState("");
  const [collapsed, setCollapsed] = useState(false), [drawer, setDrawer] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const { status: authStatus, user: authUser } = useResolvedAuthState();
  usePreferenceEffects(authStatus === "authenticated");
  const { preview, can } = useAccess();
  const navigate = useNavigate();
  const nav = NAV.filter(n => routeAllowed(preview, n.to));
  const owner_ = preview ? preview.name : owner;
  const leave = () => { const id = preview?.employeeId; exitPreview(); void navigate({ to: "/team", search: id ? { employee: id } : {} }); };
  const handleSignOut = () => { if (signingOut) return; setSigningOut(true); void logoutOwner({ allSessions: false }); };
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); setCollapsed(localStorage.getItem(COLLAPSE_KEY) === "1"); }, []);
  const toggleCollapse = () => setCollapsed(c => { try { localStorage.setItem(COLLAPSE_KEY, c ? "0" : "1"); } catch { /* layout preference only */ } return !c; });
  // Once a retry saves, the earlier "not saved" notice is outdated — clear it so it can't sit beside the success message.
  const saveOk = usePersistStatus().lastOk; const prevSaveOk = useRef(saveOk);
  useEffect(() => { if (recoveredFromFailure(prevSaveOk.current, saveOk)) toast.dismiss("persist-failure"); prevSaveOk.current = saveOk; }, [saveOk]);
  // Failed saves: one clear message; the action was rolled back, so forms stay open with their content for a retry.
  useEffect(() => {
    const off = onPersistFailure((e) => toast.error(e.quota ? "Browser storage is full" : "Changes not saved", {
      id: "persist-failure", duration: 12000,
      description: `${e.message} Nothing was recorded — your entry is still on screen, so you can try saving again.`,
      ...(preview ? {} : { action: { label: "Storage info", onClick: () => void navigate({ to: "/settings", search: { section: "data" } }) } }),
    }));
    const swallow = (ev: ErrorEvent | PromiseRejectionEvent) => { if (isPersistError("reason" in ev ? ev.reason : ev.error)) ev.preventDefault(); };
    window.addEventListener("error", swallow); window.addEventListener("unhandledrejection", swallow);
    return () => { off(); window.removeEventListener("error", swallow); window.removeEventListener("unhandledrejection", swallow); };
  }, [preview, navigate]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setSearch(true); } };
    window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k);
  }, []);
  const dark = theme === "dark";
  const attention = useMemo(() => { const today = dayKey(new Date()); return followUps.filter(f => isPending(f) && dayKey(f.dueAt) <= today).sort((a,b) => a.dueAt.localeCompare(b.dueAt)); }, [followUps]);
  // Name lookup and list rows are only built while the sheet is open (large datasets made every render slow).
  const leadName = useMemo(() => (alerts ? new Map(leads.map(l => [l.id, l.name])) : null), [alerts, leads]);
  const matches = (text: string) => text.toLowerCase().includes(query.toLowerCase());
  const current = NAV.find(n => isActive(path, n.to));
  const group = NAV_GROUPS.find(g => current && (g.items as readonly string[]).includes(current.to))?.label ?? "Workspace";
  const callable = !callPick ? [] : leads.filter(l => !["won","lost"].includes(l.status) && `${l.name} ${l.company ?? ""} ${l.phone}`.toLowerCase().includes(callQ.toLowerCase()));
  if (!mounted || authStatus !== "authenticated") return <AppShellSkeleton />;
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
            <span className="sb-label min-w-0 leading-tight"><span className="block truncate text-[13px] font-medium">{owner}</span><span className="block truncate text-[11px] opacity-60">{authUser?.email ?? business}</span></span>
            <Settings className="sb-label ml-auto size-4 opacity-60" />
          </Link>}
          <button type="button" onClick={handleSignOut} disabled={signingOut} className="sb-collapse" aria-label="Sign out" title="Sign out"><LogOut className="size-4" /><span className="sb-label text-xs">{signingOut ? "Signing out…" : "Sign out"}</span></button>
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
            {preview ? <button type="button" title="Notifications" aria-label="Notifications" onClick={() => setAlerts(true)} className="topbar-icon relative"><Bell className="size-[18px]" />{attention.length > 0 && <span className="absolute top-2 right-2 size-1.5 rounded-full bg-destructive" />}</button> : <NotificationCenter />}
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
      <Sheet open={drawer} onOpenChange={setDrawer}><SheetContent side="left" className="sb-drawer w-[280px] border-0 p-0"><SheetHeader className="sr-only"><SheetTitle>Navigation</SheetTitle></SheetHeader><div className="sb flex h-full w-full"><div className="sb-brand"><span className="sb-mark"><ScaleMark className="size-[18px]" /></span><span className="leading-none"><span className="block text-[15px] font-semibold">Scale Flow</span><span className="sb-os mt-1 block">Sales OS</span></span></div><SideNav path={path} collapsed={false} badge={attention.length} onNavigate={() => setDrawer(false)} /><div className="sb-foot">{preview ? <button type="button" onClick={() => { setDrawer(false); leave(); }} className="sb-user"><span className="sb-avatar">{initials(owner_)}</span><span className="min-w-0 leading-tight text-left"><span className="block truncate text-[13px] font-medium">{owner_}</span><span className="block truncate text-[11px] opacity-60">Exit preview</span></span></button> : <Link to="/settings" onClick={() => setDrawer(false)} className="sb-user"><span className="sb-avatar">{initials(owner)}</span><span className="min-w-0 leading-tight"><span className="block truncate text-[13px] font-medium">{owner}</span><span className="block truncate text-[11px] opacity-60">{authUser?.email ?? business}</span></span></Link>}<button type="button" onClick={() => { setDrawer(false); handleSignOut(); }} disabled={signingOut} className="sb-collapse" aria-label="Sign out"><LogOut className="size-4" /><span className="text-xs">{signingOut ? "Signing out…" : "Sign out"}</span></button></div></div></SheetContent></Sheet>
      <Sheet open={more} onOpenChange={setMore}><SheetContent side="bottom" className="max-h-[85dvh] overflow-y-auto rounded-t-3xl"><SheetHeader><SheetTitle className="text-xl font-semibold">Workspace</SheetTitle></SheetHeader><div className="mt-5 grid grid-cols-3 gap-2">{nav.map(n => <Link key={n.to} to={n.to} onClick={() => setMore(false)} className={cn("flex min-h-20 flex-col items-center justify-center gap-2 rounded-2xl border p-2 text-center text-xs",isActive(path,n.to) ? "border-foreground bg-primary text-primary-foreground" : "text-foreground")}><n.icon className="size-5" />{n.label}</Link>)}</div><div className="mt-4 flex flex-wrap gap-2">{can("leads.create") && <Button className="flex-1" onClick={() => {setMore(false);setAdd(true);}}><Plus />Add lead</Button>}{can("clients.calls") && <Button variant="outline" onClick={() => {setMore(false);setCallPick(true);}}><PhoneCall />Call log</Button>}{preview && <Button variant="outline" onClick={() => {setMore(false);leave();}}>Exit preview</Button>}<Button variant="outline" onClick={() => {setMore(false);handleSignOut();}} disabled={signingOut}><LogOut className="size-4" />Sign out</Button><Button variant="outline" title="Toggle theme" aria-label="Toggle theme" onClick={() => preferences({theme:dark ? "light":"dark"})}>{dark ? <Sun />:<Moon />}</Button></div></SheetContent></Sheet>
      <Dialog open={search} onOpenChange={setSearch}><DialogContent className="sm:max-w-xl"><DialogHeader><DialogTitle>Search workspace</DialogTitle><DialogDescription>Leads, deals and personal notes</DialogDescription></DialogHeader><Input autoFocus aria-label="Global search" placeholder="Search name, company, deal or note…" value={query} onChange={e => setQuery(e.target.value)} /><div className="grid max-h-[55vh] gap-1 overflow-y-auto">
        <div className="search-section">Leads</div>{search && leads.filter(l => matches(`${l.name} ${l.company ?? ""} ${l.phone}`)).slice(0,6).map(l => <Link key={l.id} to="/leads/$id" params={{id:l.id}} onClick={() => setSearch(false)} className="search-result"><Identity name={l.name} company={l.company} /><ArrowUpRight className="size-4 text-muted-foreground" /></Link>)}
        <div className="search-section">Deals</div>{deals.filter(d => matches(`${d.name} ${d.clientName}`)).slice(0,4).map(d => <Link key={d.id} to="/deals" onClick={() => setSearch(false)} className="search-result"><Wallet className="size-4 text-teal" /><span className="flex-1 text-sm">{d.name}<span className="block text-xs text-muted-foreground">{d.clientName}</span></span><ArrowUpRight className="size-4" /></Link>)}
        <div className="search-section">Personal notes</div>{notes.filter(n => matches(`${n.title} ${n.body}`)).slice(0,4).map(n => <Link key={n.id} to="/notes" onClick={() => setSearch(false)} className="search-result"><StickyNote className="size-4 text-warning" /><span className="flex-1 text-sm">{n.title}</span><ArrowUpRight className="size-4" /></Link>)}
        {search && query && !leads.some(l => matches(`${l.name} ${l.company ?? ""} ${l.phone}`)) && !deals.some(d => matches(`${d.name} ${d.clientName}`)) && !notes.some(n => matches(`${n.title} ${n.body}`)) && <p className="py-6 text-center text-sm text-muted-foreground">No matching records.</p>}
      </div></DialogContent></Dialog>
      <Dialog open={callPick} onOpenChange={setCallPick}><DialogContent className="sm:max-w-lg"><DialogHeader><DialogTitle>Instant call log</DialogTitle><DialogDescription>Pick who you just spoke with — the log opens without dialling.</DialogDescription></DialogHeader><Input autoFocus aria-label="Find lead to log" placeholder="Name, company or phone…" value={callQ} onChange={e => setCallQ(e.target.value)} /><div className="grid max-h-[50vh] gap-1 overflow-y-auto">{callable.slice(0,8).map(l => <button key={l.id} type="button" className="search-result text-left" onClick={() => { setCallPick(false); setCallQ(""); openCallLog(l.id, "Command bar"); }}><Identity name={l.name} company={l.company} /><span className="num text-xs text-muted-foreground">{l.phone}</span></button>)}{!callable.length && <p className="py-6 text-center text-sm text-muted-foreground">No open leads match.</p>}</div></DialogContent></Dialog>
      <Sheet open={alerts} onOpenChange={setAlerts}><SheetContent className="w-full sm:max-w-md"><SheetHeader><SheetTitle>Notifications</SheetTitle></SheetHeader><p className="mt-2 text-xs text-muted-foreground">From local demo records · no live delivery</p><div className="mt-6 grid gap-3">{alerts && attention.map(f => <Link key={f.id} to="/leads/$id" params={{id:f.leadId}} onClick={() => setAlerts(false)} className="rounded-2xl border p-4"><span className="text-sm font-semibold">{leadName?.get(f.leadId) ?? "Lead"}</span><span className="mt-1 block text-xs text-muted-foreground">{f.note ?? "Follow-up due"} · {formatDateTime(f.dueAt)}</span></Link>)}{!attention.length && <Empty icon={<Bell />} title="All caught up" />}</div></SheetContent></Sheet>
      <AddLeadDialog open={add} onOpenChange={setAdd} /><FollowUpDialog open={schedule} onOpenChange={setSchedule} /><PostCallDialog /><WhatsAppComposer />
    </div>
  );
}
function PreviewBar({ p, onExit }: { p: PreviewSession; onExit: () => void }) {
  const n = useSession((s) => s.events.length);
  return <div className="pv-banner pv-banner-top" role="status"><Eye className="size-4 shrink-0" /><span className="min-w-0"><b>Employee Workspace Preview — {p.name}. Demo changes are not saved to the shared CRM.</b> <span className="hidden sm:inline">Real CRM actions on a temporary copy of their records{n ? ` · ${n} change${n === 1 ? "" : "s"} so far` : ""}. Nothing is saved; your data comes back unchanged when you exit. Not a login.</span></span><button type="button" onClick={onExit} className="pv-exit">Exit preview</button></div>;
}
