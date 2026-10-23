import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useRef, useState, useEffect } from "react";
import { toast } from "sonner";
import { Archive, CheckCircle2, AlertTriangle, Loader2, Download, FileSearch, History, UserRound, ListChecks, ShieldCheck, Info, XCircle, Upload } from "lucide-react";
import { Shell, Empty, selectCls } from "@/components/crm/Shell";
import { useCRM } from "@/lib/crm/store";
import { idbProofRepo, friendlyStorageError } from "@/lib/crm/proofRepo";
import type { ProofMeta } from "@/lib/crm/attachments";
import { ALL_CATEGORY_IDS, CATEGORIES, EMPLOYEE_CATEGORY_IDS, buildBackup, estimate, recordCount, validateBackup, type BackupPlan, type CategoryId, type ProofInput, type Snapshot, type ValidationReport } from "@/lib/crm/vault";
import { formatDateTime, uid } from "@/lib/crm/format";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

type Tab = "overview" | "custom" | "employee" | "history" | "restore";
const TABS: { id: Tab; label: string; icon: typeof Archive }[] = [
  { id: "overview", label: "Backup everything", icon: Archive }, { id: "custom", label: "Custom backup", icon: ListChecks },
  { id: "employee", label: "Employee backup", icon: UserRound }, { id: "history", label: "History", icon: History }, { id: "restore", label: "Restore & verify", icon: FileSearch },
];
type Search = { tab?: Tab; employee?: string };
export const Route = createFileRoute("/data-vault")({
  validateSearch: (s: Record<string, unknown>): Search => ({
    ...(TABS.some((t) => t.id === s["tab"]) ? { tab: s["tab"] as Tab } : {}),
    ...(typeof s["employee"] === "string" ? { employee: s["employee"] } : {}),
  }),
  head: () => ({ meta: [
    { title: "Data Vault · Scale Flow Sales OS" },
    { name: "description", content: "Owner-only backups: full, custom and per-employee archives with verification." },
    { property: "og:title", content: "Data Vault · Scale Flow Sales OS" },
    { property: "og:description", content: "Owner-only backups: full, custom and per-employee archives with verification." },
    { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }, { name: "robots", content: "noindex" },
  ] }),
  component: Vault,
});

const kb = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);
function snapshot(): Snapshot { return Object.fromEntries(Object.entries(useCRM.getState()).filter(([, v]) => typeof v !== "function")); }
async function loadProofs(): Promise<ProofInput[]> {
  const metas = await idbProofRepo.list();
  return Promise.all(metas.map(async (meta) => { try { const r = await idbProofRepo.get(meta.paymentId); return { meta, bytes: r ? new Uint8Array(await r.blob.arrayBuffer()) : null }; } catch { return { meta, bytes: null }; } }));
}
function download(name: string, bytes: Uint8Array) {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/zip" }));
  const a = document.createElement("a"); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Generates, self-verifies, downloads and logs. Only reports success after the archive exists and passes validation. */
function useGenerate() {
  const logBackup = useCRM((s) => s.logBackup);
  const [busy, setBusy] = useState<string | null>(null);
  const [last, setLast] = useState<{ ok: boolean; text: string; warnings: string[] } | null>(null);
  const run = async (plan: BackupPlan, employeeName?: string) => {
    setBusy("Reading payment proof files…"); setLast(null);
    try {
      const proofs = plan.categories.includes("proofs") ? await loadProofs() : [];
      setBusy("Building archive…");
      const r = await buildBackup(plan, snapshot(), proofs);
      setBusy("Verifying archive…");
      const v = await validateBackup(r.bytes);
      if (!v.ok) throw new Error(`The generated archive failed verification: ${v.errors[0]}`);
      download(r.name, r.bytes);
      const partial = !r.manifest.complete;
      logBackup({ id: uid("bk"), name: r.name, type: plan.type, createdAt: r.manifest.createdAt, categories: r.manifest.included, records: recordCount(r.manifest), attachments: r.manifest.attachments.included, sizeBytes: r.bytes.byteLength, ...(employeeName ? { employeeName } : {}), status: plan.type === "full" && partial ? "partial" : "downloaded", verified: true });
      const text = plan.type === "full" ? (partial ? "Archive downloaded, but it is NOT complete." : "Complete backup verified and downloaded.") : `${plan.type === "employee" ? "Employee" : "Partial"} backup verified and downloaded.`;
      setLast({ ok: !(plan.type === "full" && partial), text: `${text} ${r.name} · ${kb(r.bytes.byteLength)}`, warnings: r.manifest.warnings });
      (plan.type === "full" && partial ? toast.warning : toast.success)(text);
    } catch (e) {
      const msg = friendlyStorageError(e);
      logBackup({ id: uid("bk"), name: "Backup failed", type: plan.type, createdAt: new Date().toISOString(), categories: plan.categories, records: 0, attachments: 0, sizeBytes: 0, status: "failed", verified: false, error: msg });
      setLast({ ok: false, text: `Backup failed — nothing was downloaded. ${msg}`, warnings: [] }); toast.error("Backup failed");
    } finally { setBusy(null); }
  };
  return { busy, last, run };
}

function useProofMeta() {
  const [m, setM] = useState<ProofMeta[] | null>(null), [err, setErr] = useState<string | null>(null);
  useEffect(() => { idbProofRepo.list().then(setM, (e) => { setErr(friendlyStorageError(e)); setM([]); }); }, []);
  return { proofs: m ?? [], ready: m !== null, err };
}

function Vault() {
  const { tab = "overview", employee } = Route.useSearch();
  const nav = useNavigate({ from: "/data-vault" });
  return (
    <Shell title="Data Vault" subtitle="Owner-only backups of your CRM data and payment proof files.">
      <div className="tm-notice"><ShieldCheck className="size-4 shrink-0" /><span><b>Owner only.</b> Employees never get backup, export or restore access. In this browser demo that rule is shown in the interface only — real protection comes with the secure backend. Archives are built on this device and downloaded to it; nothing is uploaded.</span></div>
      <div className="seg dv-tabs my-4" role="tablist" aria-label="Data Vault sections">
        {TABS.map((t) => <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} aria-pressed={tab === t.id} onClick={() => nav({ search: (s) => ({ ...s, tab: t.id }) })}><t.icon className="size-3.5" />{t.label}</button>)}
      </div>
      {tab === "overview" && <Overview />}
      {tab === "custom" && <Custom />}
      {tab === "employee" && <EmployeeBackup id={employee} onPick={(id) => nav({ search: (s) => ({ ...s, employee: id }) })} />}
      {tab === "history" && <HistoryView />}
      {tab === "restore" && <Restore />}
    </Shell>
  );
}

function Result({ last }: { last: ReturnType<typeof useGenerate>["last"] }) {
  if (!last) return null;
  return <div role="status" className={cn("dv-result", last.ok ? "is-ok" : "is-warn")}>{last.ok ? <CheckCircle2 className="size-4 shrink-0" /> : <AlertTriangle className="size-4 shrink-0" />}<div><p className="font-medium">{last.text}</p>{last.warnings.map((w) => <p key={w} className="text-xs">{w}</p>)}</div></div>;
}

function Overview() {
  const { proofs, ready, err } = useProofMeta();
  const state = useCRM();
  const est = useMemo(() => estimate(state as unknown as Snapshot, proofs, { type: "full", categories: ALL_CATEGORY_IDS }), [state, proofs]);
  const g = useGenerate();
  return (
    <div className="grid gap-4">
      <section className="dv-hero">
        <div className="min-w-0"><p className="eyebrow">One click</p><h2 className="editorial text-3xl">Backup everything</h2>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">One ZIP with every CRM record, all payment proof files, a manifest with checksums and a readable summary. Never includes passwords or tokens.</p></div>
        <Button size="lg" disabled={!!g.busy || !ready} onClick={() => void g.run({ type: "full", categories: ALL_CATEGORY_IDS })}>{g.busy ? <Loader2 className="animate-spin" /> : <Download />}{g.busy ?? "Backup everything"}</Button>
      </section>
      <Result last={g.last} />
      {err && <p className="text-sm text-destructive">Payment proof storage can't be read: {err}. A full backup would be marked incomplete.</p>}
      <section className="card-surface p-4"><h3 className="eyebrow mb-3">What will be included</h3>
        <ul className="dv-grid">{CATEGORIES.map((c) => <li key={c.id} className="dv-cat"><div className="flex items-baseline justify-between gap-2"><b className="text-sm">{c.label}</b><span className="num text-sm">{c.id === "proofs" ? `${est.counts.proofs} · ${kb(est.proofBytes)}` : c.id === "settings" ? "✓" : est.counts[c.id]}</span></div><p className="text-xs text-muted-foreground">{c.desc}</p></li>)}</ul>
      </section>
    </div>
  );
}

function Picker({ ids, sel, setSel, counts }: { ids: CategoryId[]; sel: CategoryId[]; setSel: (v: CategoryId[]) => void; counts: Partial<Record<CategoryId, number>> }) {
  const groups = [...new Set(CATEGORIES.filter((c) => ids.includes(c.id)).map((c) => c.group))];
  const toggle = (id: CategoryId, on: boolean) => setSel(on ? [...new Set([...sel, id])] : sel.filter((x) => x !== id));
  return <div className="grid gap-3">
    <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => setSel(ids)}>Select all</Button><Button size="sm" variant="ghost" onClick={() => setSel([])}>Deselect all</Button></div>
    {groups.map((gname) => { const gi = CATEGORIES.filter((c) => c.group === gname && ids.includes(c.id)); const all = gi.every((c) => sel.includes(c.id));
      return <fieldset key={gname} className="card-surface p-4"><div className="mb-2 flex items-center justify-between"><legend className="eyebrow">{gname}</legend><button type="button" className="text-xs font-medium underline-offset-2 hover:underline" onClick={() => setSel(all ? sel.filter((x) => !gi.some((c) => c.id === x)) : [...new Set([...sel, ...gi.map((c) => c.id)])])}>{all ? "Clear group" : "Select group"}</button></div>
        <div className="dv-grid">{gi.map((c) => <label key={c.id} className="dv-cat dv-check"><Checkbox checked={sel.includes(c.id)} onCheckedChange={(v) => toggle(c.id, v === true)} aria-label={c.label} /><span className="min-w-0 flex-1"><span className="flex justify-between gap-2"><b className="text-sm">{c.label}{c.isPrivate && <span className="ml-1 text-[10px] font-medium text-muted-foreground">private</span>}</b><span className="num text-xs text-muted-foreground">{c.id === "settings" ? "" : counts[c.id] ?? 0}</span></span><span className="block text-xs text-muted-foreground">{c.desc}</span></span></label>)}</div>
      </fieldset>; })}
  </div>;
}

function Custom() {
  const [sel, setSel] = useState<CategoryId[]>([]);
  const { proofs, ready } = useProofMeta();
  const state = useCRM();
  const est = useMemo(() => estimate(state as unknown as Snapshot, proofs, { type: "custom", categories: sel }), [state, proofs, sel]);
  const g = useGenerate();
  const total = sel.filter((c) => c !== "proofs" && c !== "settings").reduce((n, c) => n + (est.counts[c] ?? 0), 0);
  return <div className="grid gap-4">
    <Picker ids={ALL_CATEGORY_IDS} sel={sel} setSel={setSel} counts={est.counts} />
    {sel.includes("payments") && !sel.includes("deals") && <p className="dv-hint"><Info className="size-4 shrink-0" />Minimal deal references (ID, name, client) will be added so payments stay understandable.</p>}
    {sel.includes("followups") && !sel.includes("leads") && <p className="dv-hint"><Info className="size-4 shrink-0" />Follow-ups keep their lead IDs, but lead details won't be included.</p>}
    <div className="dv-bar"><span className="text-sm">{sel.length ? <><b>{sel.length}</b> categories · <b>{total}</b> records{sel.includes("proofs") ? ` · ${est.counts.proofs} files (${kb(est.proofBytes)})` : ""} · <span className="text-muted-foreground">{sel.length === ALL_CATEGORY_IDS.length ? "all categories" : "partial export"}</span></> : <span className="text-muted-foreground">Choose what to include</span>}</span>
      <Button disabled={!sel.length || !!g.busy || !ready} onClick={() => void g.run({ type: sel.length === ALL_CATEGORY_IDS.length ? "full" : "custom", categories: sel })}>{g.busy ? <Loader2 className="animate-spin" /> : <Download />}{g.busy ?? "Generate backup"}</Button></div>
    <Result last={g.last} />
  </div>;
}

function EmployeeBackup({ id, onPick }: { id: string | undefined; onPick: (id: string) => unknown }) {
  const employees = useCRM((s) => s.employees).filter((e) => e.accountStatus !== "archived");
  const emp = employees.find((e) => e.id === id);
  const [sel, setSel] = useState<CategoryId[]>(EMPLOYEE_CATEGORY_IDS.filter((c) => c !== "payments" && c !== "proofs"));
  const { proofs, ready } = useProofMeta();
  const state = useCRM();
  const est = useMemo(() => emp ? estimate(state as unknown as Snapshot, proofs, { type: "employee", categories: sel, employeeId: emp.id }) : null, [state, proofs, sel, emp]);
  const g = useGenerate();
  if (!employees.length) return <Empty icon={<UserRound />} title="No employees yet" hint="Add employees in Team Management first." action={<Button asChild variant="outline"><Link to="/team">Open Team Management</Link></Button>} />;
  return <div className="grid gap-4">
    <label className="q-field max-w-sm"><span>Employee</span><select className={selectCls} value={emp?.id ?? ""} onChange={(e) => onPick(e.target.value)} aria-label="Employee"><option value="" disabled>Choose an employee</option>{employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select></label>
    {emp && est && <>
      <p className="dv-hint"><Info className="size-4 shrink-0" /><span>Includes leads <b>currently assigned</b> to {emp.name} ({est.counts.leads}) and records linked to them. Leads reassigned away appear only in assignment history. Nothing in the CRM is changed or copied.</span></p>
      <Picker ids={EMPLOYEE_CATEGORY_IDS} sel={sel} setSel={setSel} counts={est.counts} />
      <div className="dv-bar"><span className="text-sm">Snapshot for <b>{emp.name}</b> · {sel.length} categories</span>
        <Button disabled={!sel.length || !!g.busy || !ready} onClick={() => void g.run({ type: "employee", categories: sel, employeeId: emp.id }, emp.name)}>{g.busy ? <Loader2 className="animate-spin" /> : <Download />}{g.busy ?? "Generate employee backup"}</Button></div>
    </>}
    <Result last={g.last} />
  </div>;
}

const STATUS: Record<string, string> = { downloaded: "Downloaded to device", partial: "Partial — not complete", failed: "Failed" };
function HistoryView() {
  const hist = useCRM((s) => s.backupHistory);
  if (!hist.length) return <Empty icon={<History />} title="No backups yet" hint="Backups you generate here are listed with their contents and status." />;
  return <div className="card-surface divide-y">{hist.map((h) => <div key={h.id} className="dv-hist">
    <div className="min-w-0"><p className="truncate text-sm font-medium">{h.name}</p><p className="text-xs text-muted-foreground">{formatDateTime(h.createdAt)} · {h.type}{h.employeeName ? ` · ${h.employeeName}` : ""} · {h.categories.length} categories · {h.records} records · {h.attachments} files{h.sizeBytes ? ` · ${kb(h.sizeBytes)}` : ""}</p>{h.error && <p className="text-xs text-destructive">{h.error}</p>}</div>
    <div className="flex flex-wrap gap-1.5"><span className={cn("dv-pill", h.status === "downloaded" ? "is-ok" : h.status === "failed" ? "is-bad" : "is-warn")}>{STATUS[h.status]}</span>{h.verified && <span className="dv-pill is-ok">Verified</span>}</div>
  </div>)}<p className="p-3 text-xs text-muted-foreground">Nothing is stored on a server yet — archives exist only where you saved the download.</p></div>;
}

function Restore() {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false), [rep, setRep] = useState<(ValidationReport & { file: string }) | null>(null);
  const pick = async (f?: File) => {
    if (!f) return; setBusy(true);
    try { setRep({ ...(await validateBackup(new Uint8Array(await f.arrayBuffer()))), file: f.name }); }
    catch { setRep({ ok: false, errors: ["This file couldn't be read."], warnings: [], restoreAvailable: false, file: f.name }); }
    finally { setBusy(false); if (ref.current) ref.current.value = ""; }
  };
  const m = rep?.manifest;
  return <div className="grid gap-4">
    <section className="dv-hero"><div><p className="eyebrow">Read-only inspector</p><h2 className="editorial text-3xl">Verify a backup</h2><p className="mt-1 max-w-xl text-sm text-muted-foreground">Checks the archive, every file checksum and record links. It never changes your CRM data.</p></div>
      <input ref={ref} type="file" accept=".zip,application/zip" className="sr-only" aria-label="Backup ZIP file" onChange={(e) => void pick(e.target.files?.[0])} />
      <Button size="lg" variant="outline" disabled={busy} onClick={() => ref.current?.click()}>{busy ? <Loader2 className="animate-spin" /> : <Upload />}Select backup ZIP</Button></section>
    {rep && <section className="card-surface grid gap-3 p-4" aria-live="polite">
      <div className={cn("dv-result", rep.ok ? "is-ok" : "is-bad")}>{rep.ok ? <CheckCircle2 className="size-4" /> : <XCircle className="size-4" />}<p className="font-medium">{rep.ok ? "Backup validated" : "Backup failed validation"} — {rep.file}</p></div>
      {m && <dl className="tm-dl"><dt>Created</dt><dd>{formatDateTime(m.createdAt)}</dd><dt>Type</dt><dd>{m.type}{m.employee ? ` · ${m.employee.name}` : ""} · {m.complete ? "complete" : "partial"}</dd><dt>Version</dt><dd>format v{m.formatVersion} · schema v{m.schemaVersion}</dd><dt>Files</dt><dd>{m.attachments.included} of {m.attachments.expected} proof files</dd></dl>}
      {m && <ul className="dv-grid">{m.included.map((id) => <li key={id} className="dv-cat flex justify-between text-sm"><span>{CATEGORIES.find((c) => c.id === id)?.label ?? id}</span><span className="num">{m.counts[id] ?? 0}</span></li>)}</ul>}
      {rep.errors.map((e) => <p key={e} className="text-sm text-destructive">{e}</p>)}
      {rep.warnings.map((w) => <p key={w} className="dv-hint"><AlertTriangle className="size-4 shrink-0" />{w}</p>)}
      <p className="dv-hint"><Info className="size-4 shrink-0" /><span><b>Restore not yet available.</b> Restoring safely (pre-restore snapshot, conflict handling, Owner confirmation and rollback) will be built with the secure backend. Your data was not changed.</span></p>
    </section>}
  </div>;
}
