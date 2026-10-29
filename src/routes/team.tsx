import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { Archive, Eye, Workflow, SlidersHorizontal, ArrowUpRight, UserPlus, UserMinus, Repeat } from "lucide-react";
import { RulesPanel } from "@/components/team/RulesPanel";
import { PermissionEditor } from "@/components/team/PermissionEditor";
import { AssignDialog } from "@/components/team/AssignDialog";
import { MODULES, resolve, FINANCE_LABEL, SCOPE_LABEL, assignable } from "@/lib/crm/access";
import { isPending, followUpBucket } from "@/lib/crm/followups";
import { STATUS_LABEL as STAGE_LABEL } from "@/lib/crm/types";
import { PriorityBadge } from "@/components/crm/Shell";
import { formatDateTime } from "@/lib/crm/format";
import { Checkbox } from "@/components/ui/checkbox";
import { Eye as EyeIcon, EyeOff, Plus, Search, ShieldCheck, X, Pencil, Power, KeyRound, Mail, Users, Activity, Lock, Trash2, Crown, Info } from "lucide-react";
import { Shell, Empty, selectCls } from "@/components/crm/Shell";
import { useCRM } from "@/lib/crm/store";
import { formatDate, initials } from "@/lib/crm/format";
import { ROLES, PLANNED_ACCESS, RESOURCE_LABEL, STATUS_LABEL, demoCredentials, passwordError, normalizeEmail, filterEmployees, roleLabel, teamSummary, type Employee, type EmployeeInput, type TeamFilter, type TeamSort } from "@/lib/crm/team";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { onRovingKeyDown, roving } from "@/lib/a11y/tabKeys";

type Search = { employee?: string };
export const Route = createFileRoute("/team")({
  validateSearch: (s: Record<string, unknown>): Search => (typeof s["employee"] === "string" ? { employee: s["employee"] } : {}),
  head: () => ({
    meta: [
      { title: "Team Management · Scale Flow Sales OS" },
      { name: "description", content: "Owner workspace to add, edit, activate and deactivate employee profiles." },
      { property: "og:title", content: "Team Management · Scale Flow Sales OS" },
      { property: "og:description", content: "Owner workspace to add, edit, activate and deactivate employee profiles." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Team,
});

const fmt = (iso: string) => formatDate(iso, { day: "numeric", month: "short", year: "numeric" });
function StatusPill({ s }: { s: Employee["accountStatus"] }) { return <span className="tm-status" data-status={s}><span className="tm-dot" />{STATUS_LABEL[s]}</span>; }

function Team() {
  const { employees, owner, email, setEmployeeStatus } = useCRM();
  const { employee: selectedId } = Route.useSearch();
  const navigate = Route.useNavigate();
  const [q, setQ] = useState(""), [status, setStatus] = useState<TeamFilter>("all"), [sort, setSort] = useState<TeamSort>("newest");
  const [form, setForm] = useState<{ open: boolean; edit?: Employee }>({ open: false });
  const [view, setView] = useState<"directory" | "rules">("directory");
  const assignments = useCRM((st) => st.assignments);
  const countFor = (id: string) => Object.values(assignments).filter((a) => a.employeeId === id).length;
  const [confirm, setConfirm] = useState<{ kind: "deactivate" | "remove"; e: Employee } | null>(null);
  const list = useMemo(() => filterEmployees(employees, q, status, sort), [employees, q, status, sort]);
  const sum = teamSummary(employees);
  const selected = employees.find((e) => e.id === selectedId && e.accountStatus !== "archived");
  const select = (id?: string) => void navigate({ search: id ? { employee: id } : {}, replace: true, resetScroll: false });
  useEffect(() => { if (!selected) return; const k = (e: KeyboardEvent) => { if (e.key === "Escape") select(); }; window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); });

  return (
    <Shell title="Team Management" subtitle="Create and manage employee profiles. Sign-in and permissions arrive with the secure backend." actions={<Button onClick={() => setForm({ open: true })}><Plus />Add employee</Button>}>
      <div className="tm-notice"><Info className="size-4 shrink-0" /><span><b>Local demo.</b> Profiles are saved in this browser only. You set each employee's email and password, but logins only work once the secure backend is connected — passwords are never saved in the browser. <Link to="/login" className="font-semibold underline underline-offset-2">Preview the login screen</Link></span></div>
      <div className="tm-summary">
        {([["Total employees", sum.total], ["Active", sum.active], ["Pending setup", sum.pending], ["Inactive", sum.inactive]] as const).map(([l, v]) => <div key={l} className="tm-sum"><span className="eyebrow">{l}</span><span className="num tm-sum-v">{v}</span></div>)}
      </div>
      <div className="seg mb-4" role="tablist" aria-label="Team sections" onKeyDown={onRovingKeyDown}><button type="button" role="tab" aria-selected={view === "directory"} aria-pressed={view === "directory"} tabIndex={roving(view === "directory")} onClick={() => setView("directory")}><Users className="size-3.5" />Directory</button><button type="button" role="tab" aria-selected={view === "rules"} aria-pressed={view === "rules"} tabIndex={roving(view === "rules")} onClick={() => setView("rules")}><Workflow className="size-3.5" />Assignment rules</button></div>
      {view === "rules" ? <RulesPanel /> : <div className={cn("tm-layout", selected && "has-panel")}>
        <section className="surface tm-dir" aria-label="Employee directory">
          <div className="tm-owner"><span className="tm-avatar tm-avatar-owner"><Crown className="size-4" /></span><div className="min-w-0 flex-1"><div className="text-sm font-semibold">{owner}</div><div className="truncate text-xs text-muted-foreground">{email || "Owner email not set"}</div></div><span className="tm-role-owner">Owner · Super admin</span></div>
          <div className="tm-tools">
            <label className="relative min-w-0 flex-1"><Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" /><Input aria-label="Search employees" placeholder="Search name, email or role…" value={q} onChange={(e) => setQ(e.target.value)} className="pl-9" /></label>
            <select aria-label="Filter by status" className={selectCls} value={status} onChange={(e) => setStatus(e.target.value as TeamFilter)}><option value="all">All statuses</option><option value="active">Active</option><option value="pending">Pending setup</option><option value="inactive">Inactive</option></select>
            <select aria-label="Sort employees" className={selectCls} value={sort} onChange={(e) => setSort(e.target.value as TeamSort)}><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="name">Name A–Z</option></select>
          </div>
          {list.length ? <ul className="tm-list" role="list">{list.map((e) => (
            <li key={e.id}><button type="button" className="tm-row" aria-current={e.id === selectedId ? "true" : undefined} onClick={() => select(e.id)}>
              <span className="tm-avatar">{initials(e.name)}</span>
              <span className="min-w-0 flex-1 text-left"><span className="block truncate text-sm font-semibold">{e.name}</span><span className="block truncate text-xs text-muted-foreground">{e.email}</span></span>
              <span className="tm-col hidden text-xs sm:block">{roleLabel(e)}<span className="block text-muted-foreground">{countFor(e.id)} lead{countFor(e.id) === 1 ? "" : "s"}</span></span>
              <span className="tm-col tm-col-extra hidden text-xs text-muted-foreground lg:block">Added {fmt(e.createdAt)}</span>
              <span className="tm-col tm-col-extra hidden text-xs text-muted-foreground xl:block">{e.lastLoginAt ? `Last login ${fmt(e.lastLoginAt)}` : "Login: not yet available"}</span>
              <StatusPill s={e.accountStatus} />
            </button></li>))}</ul>
            : <Empty icon={<Users />} title={employees.some((e) => e.accountStatus !== "archived") ? "No matching employees" : "No employees yet"} hint={employees.length ? "Try another search or status." : "Add your first team member to start building your sales team."} action={!employees.length ? <Button onClick={() => setForm({ open: true })}><Plus />Add employee</Button> : undefined} />}
        </section>
        {selected && <Inspector e={selected} onClose={() => select()} onEdit={() => setForm({ open: true, edit: selected })} onConfirm={(kind) => setConfirm({ kind, e: selected })} onActivate={() => { setEmployeeStatus(selected.id, "active"); toast.success(`${selected.name} marked active in the demo`); }} />}
      </div>}
      <EmployeeForm key={form.edit?.id ?? (form.open ? "new" : "closed")} open={form.open} edit={form.edit} onClose={() => setForm({ open: false })} onCreated={(id) => select(id)} />
      <Dialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}><DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>{confirm?.kind === "remove" ? `Remove ${confirm.e.name}?` : `Deactivate ${confirm?.e.name}?`}</DialogTitle>
          <DialogDescription>{confirm?.kind === "remove" ? "The profile is archived, not erased, so any future history stays linked. It disappears from the directory." : `Only the saved profile status changes — there's no real sign-in yet, so no session is revoked. They stop receiving new leads${confirm && countFor(confirm.e.id) ? `; their ${countFor(confirm.e.id)} current lead(s) stay linked for you to review` : ""}.`}</DialogDescription></DialogHeader>
        <DialogFooter><Button variant="outline" onClick={() => setConfirm(null)}>Cancel</Button><Button variant="destructive" onClick={() => { if (!confirm) return; setEmployeeStatus(confirm.e.id, confirm.kind === "remove" ? "archived" : "inactive"); if (confirm.kind === "remove") select(); const n = countFor(confirm.e.id); toast.success(confirm.kind === "remove" ? `${confirm.e.name} removed` : `${confirm.e.name} deactivated`, n ? { description: `${n} assigned lead${n === 1 ? " stays" : "s stay"} linked. Review them under Assigned leads to reassign.` } : undefined); setConfirm(null); }}>{confirm?.kind === "remove" ? "Remove" : "Deactivate"}</Button></DialogFooter>
      </DialogContent></Dialog>
    </Shell>
  );
}

function Inspector({ e, onClose, onEdit, onConfirm, onActivate }: { e: Employee; onClose: () => void; onEdit: () => void; onConfirm: (k: "deactivate" | "remove") => void; onActivate: () => void }) {
  const [wide, setWide] = useState(true);
  const [cred, setCred] = useState<null | "email" | "password">(null);
  useEffect(() => { const mq = window.matchMedia("(min-width: 1280px)"); const f = () => setWide(mq.matches); f(); mq.addEventListener("change", f); return () => mq.removeEventListener("change", f); }, []);
  const panel = (
    <aside className="tm-inspector" role="dialog" aria-modal={!wide} aria-label={`${e.name} details`} key={e.id}>
      <div className="flex items-start gap-3">
        <span className="tm-avatar tm-avatar-lg">{initials(e.name)}</span>
        <div className="min-w-0 flex-1"><h2 className="truncate text-lg font-semibold">{e.name}</h2><p className="truncate text-xs text-muted-foreground">{e.email}</p><div className="mt-2 flex flex-wrap items-center gap-2"><span className="tm-role">{roleLabel(e)}</span><StatusPill s={e.accountStatus} /></div></div>
        <Button asChild size="sm" variant="outline"><Link to="/team/preview/$id" params={{ id: e.id }}><Eye />Preview</Link></Button>
        <button type="button" className="topbar-icon" aria-label="Close employee details" onClick={onClose}><X className="size-4" /></button>
      </div>
      <section className="tm-sec"><h3 className="eyebrow">Overview</h3><dl className="tm-dl">
        <dt>Created</dt><dd>{fmt(e.createdAt)}</dd><dt>Last updated</dt><dd>{fmt(e.updatedAt)}</dd>
        <dt>Last login</dt><dd>{e.lastLoginAt ? fmt(e.lastLoginAt) : "Not yet available"}</dd>
        <dt>Production login</dt><dd>Not configured yet</dd></dl></section>
      <div className="flex flex-wrap gap-2"><Button asChild size="sm" variant="outline"><Link to="/team/workspace/$id" params={{ id: e.id }}><Users />View Employee Workspace</Link></Button><Button asChild size="sm" variant="ghost"><Link to="/team-activity" search={{ employee: e.id }}><Activity />View Activity</Link></Button></div>
      <AccessSection e={e} />
      <AssignedPanel e={e} />
      <section className="tm-sec"><h3 className="eyebrow">Activity</h3><p className="flex items-center gap-2 text-xs text-muted-foreground"><Activity className="size-3.5" />No trusted activity yet. Records will come from the secure backend.</p></section>
      <section className="tm-sec"><h3 className="eyebrow">Account controls</h3><div className="grid gap-2 sm:grid-cols-2">
        <Button variant="outline" onClick={onEdit}><Pencil />Edit profile</Button>
        {e.accountStatus === "inactive" ? <Button variant="outline" onClick={onActivate}><Power />Activate</Button> : <Button variant="outline" onClick={() => onConfirm("deactivate")}><Power />Deactivate</Button>}
        <Button variant="outline" onClick={() => setCred("email")}><Mail />Change login email</Button>
        <Button variant="outline" onClick={() => setCred("password")}><KeyRound />Reset password</Button>
        <Button asChild variant="outline" className="sm:col-span-2"><Link to="/data-vault" search={{ tab: "employee", employee: e.id }}><Archive />Backup employee data</Link></Button>
        <Button variant="ghost" className="text-destructive sm:col-span-2" onClick={() => onConfirm("remove")}><Trash2 />Remove employee</Button>
      </div></section>
      {cred && <CredentialDialog e={e} kind={cred} onClose={() => setCred(null)} />}
    </aside>
  );
  if (wide) return panel;
  return createPortal(<div className="tm-overlay"><button type="button" aria-label="Close" className="tm-scrim" onClick={onClose} />{panel}</div>, document.body);
}

function EmployeeForm({ open, edit, onClose, onCreated }: { open: boolean; edit: Employee | undefined; onClose: () => void; onCreated: (id: string) => void }) {
  const { addEmployee, updateEmployee } = useCRM();
  const [f, setF] = useState<EmployeeInput>(() => edit ? { name: edit.name, email: edit.email, roleId: edit.roleId, customRoleLabel: edit.customRoleLabel ?? "", accountStatus: edit.accountStatus === "inactive" ? "inactive" : edit.accountStatus === "active" ? "active" : "pending" } : { name: "", email: "", roleId: "salesperson", customRoleLabel: "", accountStatus: "pending" });
  const [err, setErr] = useState<string | null>(null);
  const [pw, setPw] = useState(""), [pw2, setPw2] = useState("");
  const save = async () => {
    try {
      if (edit) { const e = updateEmployee(edit.id, f); if (e) return setErr(e); toast.success("Employee updated"); }
      else {
        const pe = passwordError(pw, pw2); if (pe) return setErr(pe);
        const r = addEmployee(f); if (!r.ok) return setErr(r.error);
        const c = await demoCredentials.createLogin(r.id, normalizeEmail(f.email), pw);
        setPw(""); setPw2("");
        toast.success(`${f.name.trim()} added to your team`, c.ok ? undefined : { description: "Profile saved. The login isn't active yet — " + c.message });
        onCreated(r.id);
      }
      onClose();
    } catch { setErr("Couldn't save in this browser. Check storage space and try again."); }
  };
  return <Dialog open={open} onOpenChange={(o) => !o && onClose()}><DialogContent className="sm:max-w-lg">
    <DialogHeader><DialogTitle>{edit ? "Edit employee" : "Add employee"}</DialogTitle><DialogDescription>{edit ? "Update profile details." : "You choose the login email and password. No invitation is sent."}</DialogDescription></DialogHeader>
    <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); void save(); }} noValidate>
      <label className="q-field"><span>Full name</span><Input autoFocus value={f.name} placeholder="Rahul Sharma" onChange={(e) => { setF({ ...f, name: e.target.value }); setErr(null); }} /></label>
      <label className="q-field"><span>Email address</span><Input type="email" value={f.email} placeholder="rahul@example.com" onChange={(e) => { setF({ ...f, email: e.target.value }); setErr(null); }} /></label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="q-field"><span>Role</span><select className={selectCls} value={f.roleId} onChange={(e) => setF({ ...f, roleId: e.target.value as EmployeeInput["roleId"] })}><option value="salesperson">Salesperson</option><option value="sales_manager">Sales Manager</option><option value="custom">Custom role</option></select></label>
        <label className="q-field"><span>Account status</span><select className={selectCls} value={f.accountStatus} onChange={(e) => setF({ ...f, accountStatus: e.target.value as EmployeeInput["accountStatus"] })}><option value="pending">Pending setup</option>{edit && <option value="active">Active</option>}<option value="inactive">Inactive</option></select></label>
      </div>
      {f.roleId === "custom" && <label className="q-field"><span>Custom role name</span><Input value={f.customRoleLabel ?? ""} placeholder="e.g. Field Executive" onChange={(e) => { setF({ ...f, customRoleLabel: e.target.value }); setErr(null); }} /></label>}
      {!edit && <PasswordPair pw={pw} pw2={pw2} setPw={(v) => { setPw(v); setErr(null); }} setPw2={(v) => { setPw2(v); setErr(null); }} label="Password" />}
      <div className="tm-cred"><ShieldCheck className="size-4 shrink-0" /><span>{edit ? "Login email and password are changed from Account controls in the employee details." : "The employee signs in with this email and password on the same login page as you. The password goes only to the secure backend and is never saved in this browser."}</span></div>
      {err && <p role="alert" className="text-sm font-medium text-destructive">{err}</p>}
      <DialogFooter><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button type="submit">{edit ? "Save changes" : "Add employee"}</Button></DialogFooter>
    </form>
  </DialogContent></Dialog>;
}

function PasswordPair({ pw, pw2, setPw, setPw2, label }: { pw: string; pw2: string; setPw: (v: string) => void; setPw2: (v: string) => void; label: string }) {
  const [show, setShow] = useState(false);
  const field = (v: string, set: (v: string) => void, l: string, ac: string) => <label className="q-field"><span>{l}</span><span className="relative block"><Input type={show ? "text" : "password"} autoComplete={ac} value={v} onChange={(e) => set(e.target.value)} className="pr-10" /><button type="button" aria-label={show ? "Hide passwords" : "Show passwords"} onClick={() => setShow(!show)} className="absolute top-1/2 right-2 -translate-y-1/2 p-1 text-muted-foreground">{show ? <EyeOff className="size-4" /> : <EyeIcon className="size-4" />}</button></span></label>;
  return <div className="grid gap-4 sm:grid-cols-2">{field(pw, setPw, label, "new-password")}{field(pw2, setPw2, "Confirm password", "new-password")}<p className="-mt-2 text-xs text-muted-foreground sm:col-span-2">At least 10 characters, with a letter and a number.</p></div>;
}

function CredentialDialog({ e, kind, onClose }: { e: Employee; kind: "email" | "password"; onClose: () => void }) {
  const [email, setEmail] = useState(""), [pw, setPw] = useState(""), [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false), [err, setErr] = useState<string | null>(null);
  const submit = async () => {
    setErr(null);
    if (kind === "email") { const ne = normalizeEmail(email); if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(ne)) return setErr("Enter a valid email address."); if (ne === normalizeEmail(e.email)) return setErr("That's already their login email."); }
    else { const pe = passwordError(pw, pw2); if (pe) return setErr(pe); }
    setBusy(true);
    const r = kind === "email" ? await demoCredentials.changeLoginEmail(e.id, normalizeEmail(email)) : await demoCredentials.setPassword(e.id, pw);
    setBusy(false); setPw(""); setPw2("");
    if (!r.ok) return setErr(r.message);
    toast.success(kind === "email" ? "Login email changed" : "Password reset — old password no longer works and sessions were signed out");
    onClose();
  };
  return <Dialog open onOpenChange={(o) => !o && onClose()}><DialogContent className="sm:max-w-md">
    <DialogHeader><DialogTitle>{kind === "email" ? `Change login email for ${e.name}` : `Reset password for ${e.name}`}</DialogTitle>
      <DialogDescription>{kind === "email" ? `Current login: ${e.email}. They'll sign in with the new email from now on.` : "Set a new password. Their old password stops working and they're signed out everywhere. The old password is never shown."}</DialogDescription></DialogHeader>
    <form className="grid gap-4" noValidate onSubmit={(ev) => { ev.preventDefault(); void submit(); }}>
      {kind === "email" ? <label className="q-field"><span>New login email</span><Input type="email" autoFocus value={email} onChange={(ev) => { setEmail(ev.target.value); setErr(null); }} placeholder="name@company.com" /></label>
        : <PasswordPair pw={pw} pw2={pw2} setPw={(v) => { setPw(v); setErr(null); }} setPw2={(v) => { setPw2(v); setErr(null); }} label="New password" />}
      {err && <p role="alert" className="text-sm font-medium text-destructive">{err}</p>}
      <DialogFooter><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" disabled={busy}>{kind === "email" ? "Change email" : "Set new password"}</Button></DialogFooter>
    </form>
  </DialogContent></Dialog>;
}

function AccessSection({ e }: { e: Employee }) {
  const acc = useCRM((st) => st.employeeAccess[e.id]);
  const [open, setOpen] = useState(false);
  const eff = resolve(e.roleId, acc);
  const mods = MODULES.filter((m) => !m.ownerOnly && m.actions.some((x) => eff.can(x.key)));
  const n = acc ? Object.keys(acc.overrides).length : 0;
  return <section className="tm-sec"><div className="flex items-center justify-between gap-2"><h3 className="eyebrow">Permissions</h3><Button size="sm" variant="outline" onClick={() => setOpen(true)}><SlidersHorizontal />Edit permissions</Button></div>
    <p className="text-xs text-muted-foreground">{roleLabel(e)} defaults{n ? ` + ${n} custom change${n === 1 ? "" : "s"}` : ""} · {SCOPE_LABEL[eff.leadScope]} · {FINANCE_LABEL[eff.finance]}. A plan for the secure backend, not enforced in the demo.</p>
    <div className="mt-1 flex flex-wrap gap-1.5">{mods.map((m) => <span key={m.id} className="tm-chip">{m.label}</span>)}<span className="tm-chip tm-chip-lock"><Lock className="size-3" />Team Management · Owner only</span></div>
    {open && <PermissionEditor e={e} open onClose={() => setOpen(false)} />}
  </section>;
}

function AssignedPanel({ e }: { e: Employee }) {
  const { leads, assignments, followUps, assignmentEvents, assignLeads, restoreAssignments } = useCRM();
  const [sel, setSel] = useState<string[]>([]), [reassign, setReassign] = useState(false), [more, setMore] = useState(false);
  const mine = leads.filter((l) => assignments[l.id]?.employeeId === e.id);
  const now = new Date();
  const pend = followUps.filter((f) => isPending(f) && mine.some((l) => l.id === f.leadId));
  const stats: [string, number][] = [["Total", mine.length], ["New", mine.filter((l) => l.status === "new").length], ["Contacted", mine.filter((l) => l.status === "contacted").length], ["Qualified", mine.filter((l) => l.status === "qualified").length], ["Follow-ups", new Set(pend.map((f) => f.leadId)).size], ["Overdue", pend.filter((f) => followUpBucket(f, now) === "overdue").length]];
  const recent = assignmentEvents.filter((x) => x.newAssigneeId === e.id || x.previousAssigneeId === e.id).slice(0, 4);
  const unassign = () => { const snap = Object.fromEntries(sel.map((id) => [id, assignments[id]])); const r = assignLeads(sel, null, "Team Management"); if (r.ok) toast.success(`${r.changed} lead${r.changed === 1 ? "" : "s"} returned to Owner`, { action: { label: "Undo", onClick: () => { const u = restoreAssignments(snap, Object.fromEntries(sel.map((id) => [id, null]))); if (u.kept) toast.info(`Undo restored ${u.restored}; ${u.kept} kept because they changed again since.`); } } }); setSel([]); };
  return <section className="tm-sec"><div className="flex items-center justify-between gap-2"><h3 className="eyebrow">Assigned leads</h3>{assignable(e) && <Button size="sm" variant="outline" onClick={() => setMore(true)}><UserPlus />Assign more</Button>}</div>
    <div className="as-stats">{stats.map(([l, v]) => <div key={l}><span className="num text-base font-medium">{v}</span><span className="eyebrow">{l}</span></div>)}</div>
    {!assignable(e) && mine.length > 0 && <p className="text-xs text-warning">Inactive — review and reassign these leads.</p>}
    {mine.length ? <ul className="grid gap-1">{mine.map((l) => { const fu = followUps.filter((f) => f.leadId === l.id && isPending(f)).sort((a, b) => a.dueAt.localeCompare(b.dueAt))[0]; return <li key={l.id} className="as-lead">
      <Checkbox aria-label={`Select ${l.name}`} checked={sel.includes(l.id)} onCheckedChange={(v) => setSel((x) => (v ? [...x, l.id] : x.filter((y) => y !== l.id)))} />
      <span className="min-w-0 flex-1"><span className="flex items-center gap-1.5 truncate text-sm font-medium">{l.name}<PriorityBadge p={l.priority} /></span><span className="block truncate text-[11px] text-muted-foreground">{l.company ?? "Independent"} · {STAGE_LABEL[l.status]} · {fu ? `next ${formatDateTime(fu.dueAt)}` : "no follow-up"} · since {fmt(assignments[l.id]!.assignedAt)}</span></span>
      <Link to="/leads/$id" params={{ id: l.id }} aria-label={`Open ${l.name}`} className="topbar-icon"><ArrowUpRight className="size-4" /></Link>
    </li>; })}</ul> : <p className="text-xs text-muted-foreground">No leads assigned yet.</p>}
    {sel.length > 0 && <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => setReassign(true)}><Repeat />Reassign {sel.length}</Button><Button size="sm" variant="ghost" onClick={unassign}><UserMinus />Remove assignment</Button></div>}
    {recent.length > 0 && <div className="mt-1"><div className="eyebrow mb-1">Recent assignments · local demo log</div><ul className="grid gap-0.5">{recent.map((x) => <li key={x.id} className="text-[11px] text-muted-foreground">{leads.find((l) => l.id === x.leadId)?.name ?? "Lead"} — {x.newAssigneeId === e.id ? "assigned" : "moved away"} · {x.source} · {fmt(x.at)}</li>)}</ul></div>}
    <AssignDialog open={reassign} leadIds={sel} source="Team Management" onClose={() => setReassign(false)} onDone={() => setSel([])} />
    {more && <PickLeads e={e} onClose={() => setMore(false)} />}
  </section>;
}

function PickLeads({ e, onClose }: { e: Employee; onClose: () => void }) {
  const { leads, assignments, employees, assignLeads, restoreAssignments } = useCRM();
  const [q, setQ] = useState(""), [sel, setSel] = useState<string[]>([]);
  const rows = leads.filter((l) => assignments[l.id]?.employeeId !== e.id && `${l.name} ${l.company ?? ""}`.toLowerCase().includes(q.toLowerCase()));
  return <Dialog open onOpenChange={(o) => !o && onClose()}><DialogContent className="sm:max-w-lg">
    <DialogHeader><DialogTitle>Assign leads to {e.name}</DialogTitle><DialogDescription>Pick leads. Ones already with someone else will be reassigned.</DialogDescription></DialogHeader>
    <Input autoFocus aria-label="Find leads" placeholder="Search leads…" value={q} onChange={(x) => setQ(x.target.value)} />
    <ul className="grid max-h-[45vh] gap-1 overflow-y-auto">{rows.map((l) => { const cur = employees.find((x) => x.id === assignments[l.id]?.employeeId); return <li key={l.id}><label className="as-lead cursor-pointer"><Checkbox checked={sel.includes(l.id)} onCheckedChange={(v) => setSel((x) => (v ? [...x, l.id] : x.filter((y) => y !== l.id)))} /><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{l.name}</span><span className="block truncate text-[11px] text-muted-foreground">{l.company ?? "Independent"} · {STAGE_LABEL[l.status]} · {cur ? `with ${cur.name}` : "Owner"}</span></span></label></li>; })}</ul>
    <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={!sel.length} onClick={() => { const snap = Object.fromEntries(sel.map((id) => [id, assignments[id]])); const r = assignLeads(sel, e.id, "Team Management"); if (!r.ok) { toast.error(r.error); return; } toast.success(`${r.changed} lead${r.changed === 1 ? "" : "s"} assigned to ${e.name}`, { action: { label: "Undo", onClick: () => { const u = restoreAssignments(snap, Object.fromEntries(sel.map((id) => [id, e.id]))); if (u.kept) toast.info(`Undo restored ${u.restored}; ${u.kept} kept because they changed again since.`); } } }); onClose(); }}>Assign {sel.length || ""}</Button></DialogFooter>
  </DialogContent></Dialog>;
}
