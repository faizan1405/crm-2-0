// Owner-only storage diagnostic. Shows measured sizes (from the stored text) and the browser's own estimate
// when it exposes one. Never shows record contents.
import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { HardDrive, RefreshCw, CheckCircle2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePersistStatus, measureStorage, categorySizes, type KeySize } from "@/lib/crm/persistStatus";
import { formatBytes } from "@/lib/crm/attachments";
import { idbProofRepo } from "@/lib/crm/proofRepo";

const STORE_KEY = "scale-flow-crm-2-demo";

interface Snapshot { total: number; keys: KeySize[]; cats: { name: string; bytes: number }[]; proofs: { count: number; bytes: number } | null; estimate: { usage?: number; quota?: number } | null }

async function take(): Promise<Snapshot> {
  const m = measureStorage(localStorage);
  const cats = categorySizes(localStorage.getItem(STORE_KEY));
  let proofs: Snapshot["proofs"] = null;
  try { const all = await idbProofRepo.list(); proofs = { count: all.length, bytes: all.reduce((n, p) => n + p.fileSize, 0) }; } catch { proofs = null; }
  let estimate: Snapshot["estimate"] = null;
  try { if (navigator.storage?.estimate) { const e = await navigator.storage.estimate(); estimate = { usage: e.usage, quota: e.quota }; } } catch { estimate = null; }
  return { ...m, cats, proofs, estimate };
}

export function StorageDiagnostic() {
  const st = usePersistStatus();
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const refresh = () => { void take().then(setSnap); };
  useEffect(refresh, [st.lastSuccessAt, st.lastFailureAt]);
  const max = Math.max(1, ...(snap?.cats.map((c) => c.bytes) ?? [1]));
  return (
    <div className="border-b py-5" data-testid="storage-diagnostic">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-medium"><HardDrive className="size-4 text-muted-foreground" />Browser storage <span className="text-xs font-normal text-muted-foreground">· Owner only</span></div>
        <Button size="sm" variant="ghost" onClick={refresh}><RefreshCw className="size-3.5" />Measure again</Button>
      </div>
      <div className={st.lastOk === false ? "mt-3 flex items-start gap-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive" : "mt-3 flex items-start gap-2 text-sm text-muted-foreground"} role="status">
        {st.lastOk === false ? <AlertTriangle className="mt-0.5 size-4 shrink-0" /> : <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />}
        <span>{st.lastOk === false
          ? <>Latest save failed{st.lastFailureKind === "quota" ? " because browser storage is full" : ""}. Your latest change was not kept; previously saved data was not deleted. <Link to="/data-vault" className="underline">Open Data Vault</Link> to download a backup of what is saved (it won't include the unsaved change).</>
          : st.lastOk ? "Latest save succeeded." : "No save has been attempted since this page opened."}
          {st.failures > 0 && ` Failed saves this session: ${st.failures}.`}</span>
      </div>
      {snap && <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="space-y-2 text-sm">
          <div className="flex justify-between"><span>CRM records (measured)</span><span className="font-mono">{formatBytes(snap.keys.find((k) => k.key === STORE_KEY)?.bytes ?? 0)}</span></div>
          <div className="flex justify-between"><span>All local storage on this site (measured)</span><span className="font-mono">{formatBytes(snap.total)}</span></div>
          <div className="flex justify-between"><span>Payment proof files</span><span className="font-mono">{snap.proofs ? `${snap.proofs.count} · ${formatBytes(snap.proofs.bytes)}` : "Not measurable"}</span></div>
          <div className="flex justify-between"><span>Browser's estimate (all site storage)</span><span className="font-mono">{snap.estimate?.usage != null ? `${formatBytes(snap.estimate.usage)}${snap.estimate.quota ? ` of ~${formatBytes(snap.estimate.quota)}` : ""}` : "Not reported"}</span></div>
          <p className="text-xs text-muted-foreground">CRM records use the browser's local storage, which is commonly limited to about 5 MB per site, though browsers differ and don't report the exact space left for it. The browser's estimate covers file storage too and is approximate. Nothing is deleted automatically to make room.</p>
        </div>
        <ul className="space-y-1.5 text-xs" aria-label="Approximate size by category">
          {snap.cats.map((c) => <li key={c.name} className="grid grid-cols-[120px_minmax(0,1fr)_64px] items-center gap-2"><span>{c.name}</span><span className="h-1.5 rounded-full bg-muted"><span className="block h-full rounded-full bg-primary" style={{ width: `${Math.max(2, (c.bytes / max) * 100)}%` }} /></span><span className="text-right font-mono text-muted-foreground">{formatBytes(c.bytes)}</span></li>)}
        </ul>
      </div>}
    </div>
  );
}
