import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Upload, FileSpreadsheet, ClipboardPaste, Download, Table2, Check, AlertTriangle, RotateCcw, Loader2, Info } from "lucide-react";
import { useCRM } from "@/lib/crm/store";
import { isPersistError } from "@/lib/crm/persistStatus";
import {
  buildRows, checkRows, estimateBytes, fileProblem, guessMapping, parseDelimited, toNewLead, toTable,
  FIELD_LABEL, IMPORT_FIELDS, MAX_IMPORT_ROWS, SAMPLE_CSV,
  type ImportField, type ParsedTable, type PreviewRow, type RowStatus, type ImportSummary,
} from "@/lib/crm/bulkImport";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { selectCls } from "./Shell";
import { cn } from "@/lib/utils";

const STATUS_LABEL: Record<RowStatus, string> = { ready: "Ready", invalid: "Needs fixing", duplicate_crm: "Already in CRM", duplicate_batch: "Repeated in this file" };
const EDIT: (keyof PreviewRow & ("name" | "phone" | "email" | "company" | "requirement" | "budget"))[] = ["name", "phone", "email", "company", "requirement", "budget"];

type Result = { kind: "done"; summary: ImportSummary } | { kind: "failed"; message: string; attempted: number };

/** Bulk AI Import tab: local parsing only (deterministic, not live AI). Nothing is saved until "Import N leads". */
export function BulkImportPanel({ onDirty, onClose }: { onDirty: (d: boolean) => void; onClose: () => void }) {
  const leads = useCRM((s) => s.leads);
  const importLeads = useCRM((s) => s.importLeads);
  const [paste, setPaste] = useState("");
  const [table, setTable] = useState<ParsedTable | null>(null);
  const [mapping, setMapping] = useState<ImportField[]>([]);
  const [rows, setRows] = useState<PreviewRow[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const lock = useRef(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const markDirty = (d: boolean) => onDirty(d);
  const load = (t: ParsedTable) => {
    if (t.error && !t.rows.length) { setProblem(t.error); return; }
    setProblem(t.error ?? null); setTable(t); setMapping(guessMapping(t.headers)); setRows(null); setResult(null); markDirty(true);
  };
  const fromText = (text: string) => { const r = parseDelimited(text); load(toTable(r.rows, r.error)); };
  const onFile = async (f: File | undefined) => {
    if (!f) return;
    const bad = fileProblem(f.name, f.size);
    if (bad) { setProblem(bad); return; }
    try {
      if (f.name.toLowerCase().endsWith(".xlsx")) {
        const { readSheet } = await import("read-excel-file/browser");
        const data = await readSheet(f);
        load(toTable(data.map((r) => r.map((c) => (c === null || c === undefined ? "" : c instanceof Date ? c.toISOString().slice(0, 10) : String(c))))));
      } else fromText(await f.text());
    } catch { setProblem("This file couldn't be read. Check it's a valid CSV or .xlsx file and try again."); }
    if (fileRef.current) fileRef.current.value = "";
  };
  const downloadSample = () => {
    const url = URL.createObjectURL(new Blob(["\uFEFF" + SAMPLE_CSV], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a"); a.href = url; a.download = "scale-flow-leads-sample.csv"; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const checks = useMemo(() => (rows ? checkRows(rows, leads) : {}), [rows, leads]);
  const ready = rows?.filter((r) => r.selected && checks[r.key]?.status === "ready") ?? [];
  const counts = useMemo(() => {
    const c = { ready: 0, invalid: 0, duplicate_crm: 0, duplicate_batch: 0 } as Record<RowStatus, number>;
    rows?.forEach((r) => { const s = checks[r.key]?.status; if (s) c[s]++; });
    return c;
  }, [rows, checks]);
  const edit = (key: string, patch: Partial<PreviewRow>) => setRows((rs) => rs?.map((r) => (r.key === key ? { ...r, ...patch } : r)) ?? rs);
  const extract = () => {
    if (!table) return;
    if (!mapping.includes("name") || !mapping.includes("phone")) { setProblem("Map one column to Name and one to Phone before previewing."); return; }
    const rs = buildRows(table, mapping);
    const ch = checkRows(rs, leads);
    // Default: only ready rows selected — duplicates and invalid rows start excluded.
    setRows(rs.map((r) => ({ ...r, selected: ch[r.key]?.status === "ready" })));
    setProblem(null);
  };
  const selectValid = () => setRows((rs) => rs?.map((r) => ({ ...r, selected: checks[r.key]?.status === "ready" })) ?? rs);

  const doImport = () => {
    if (lock.current || !rows || !ready.length) return;
    lock.current = true; setBusy(true);
    const payload = ready.map(toNewLead);
    try {
      const r = importLeads(payload);
      const dupSkipped = r.skipped.filter((s) => s.reason === "duplicate").length;
      setResult({ kind: "done", summary: {
        processed: rows.length, created: r.created,
        duplicates: counts.duplicate_crm + counts.duplicate_batch + dupSkipped,
        invalid: counts.invalid, excluded: rows.filter((x) => !x.selected && checks[x.key]?.status === "ready").length,
        failed: r.skipped.filter((s) => s.reason !== "duplicate").length, truncated: table?.truncated ?? 0,
      } });
      markDirty(false);
    } catch (e) {
      setResult({ kind: "failed", attempted: payload.length, message: isPersistError(e) ? e.message : "The import couldn't be saved." });
    } finally { lock.current = false; setBusy(false); }
  };
  const reset = () => { setPaste(""); setTable(null); setRows(null); setResult(null); setProblem(null); markDirty(false); };

  // A double-click on Import must not land its second click on a results button that appeared in the same spot.
  const [armed, setArmed] = useState(false);
  useEffect(() => { if (result?.kind !== "done") { setArmed(false); return; } const t = setTimeout(() => setArmed(true), 700); return () => clearTimeout(t); }, [result]);
  if (result?.kind === "done") {
    const s = result.summary;
    return (
      <section aria-label="Import results" className="grid gap-3 rounded-lg border p-4" data-testid="import-result">
        <div className="flex items-center gap-2 font-semibold"><Check className="size-4 text-success" />Import finished</div>
        <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
          {([["Rows processed", s.processed, "processed"], ["Leads created", s.created.length, "created"], ["Duplicates skipped", s.duplicates, "duplicates"], ["Invalid rows skipped", s.invalid, "invalid"], ["Excluded by you", s.excluded, "excluded"], ["Failed", s.failed, "failed"]] as const).map(([k, v, id]) => (
            <div key={k} className="rounded-lg border px-3 py-2" data-k={id}><dt className="text-[11px] text-muted-foreground">{k}</dt><dd className="num text-lg font-semibold">{v}</dd></div>
          ))}
        </dl>
        {s.truncated > 0 && <p className="text-xs text-warning">{s.truncated} rows beyond the {MAX_IMPORT_ROWS}-row limit were not read. Import them in another batch.</p>}
        {s.created.length > 0 && <details className="text-xs"><summary className="cursor-pointer text-muted-foreground">Created lead IDs ({s.created.length})</summary><ul className="mt-1 grid gap-0.5 font-mono" data-testid="created-ids">{s.created.map((id) => <li key={id}><Link to="/leads/$id" params={{ id }} onClick={onClose} className="hover:underline">{id}</Link></li>)}</ul></details>}
        <p className="text-[11px] text-muted-foreground">No follow-ups, calls, deals or payments were created.</p>
        <div className="flex flex-wrap gap-2"><Button disabled={!armed} onClick={() => { onClose(); void import("@/router").catch(() => undefined); window.history.pushState(null, "", "/leads"); window.dispatchEvent(new PopStateEvent("popstate")); }}>Open Leads</Button><Button variant="outline" disabled={!armed} onClick={reset}>Import another file</Button></div>
      </section>
    );
  }

  return (
    <div className="grid gap-3" data-testid="bulk-import">
      <p className="flex items-start gap-2 rounded-lg border border-primary/20 bg-primary-soft/40 p-3 text-xs"><Info className="mt-0.5 size-3.5 shrink-0" /><span><b>Deterministic file reading — not live AI.</b> Files are read only inside this browser and never uploaded. Up to {MAX_IMPORT_ROWS} leads per import, 1 MB max. Nothing is saved until you click Import.</span></p>
      {!table && (
        <>
          <div className="flex flex-wrap gap-2">
            <input ref={fileRef} type="file" accept=".csv,.tsv,.txt,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="sr-only" aria-label="Choose CSV or Excel file" onChange={(e) => void onFile(e.target.files?.[0])} />
            <Button type="button" variant="outline" onClick={() => fileRef.current?.click()}><Upload className="size-4" />Upload CSV</Button>
            <Button type="button" variant="outline" onClick={() => fileRef.current?.click()}><FileSpreadsheet className="size-4" />Upload XLSX / Excel</Button>
            <Button type="button" variant="ghost" onClick={downloadSample}><Download className="size-4" />Download sample CSV</Button>
          </div>
          <div className="grid gap-1.5"><Label htmlFor="bulk-paste" className="flex items-center gap-1.5"><ClipboardPaste className="size-3.5" />Or paste CSV / a table copied from Excel or Sheets</Label>
            <Textarea id="bulk-paste" rows={6} value={paste} onChange={(e) => { setPaste(e.target.value); markDirty(!!e.target.value.trim()); }} placeholder={"Name,Phone,Company,Requirement\nRavi Kumar,9123456780,Ravi Bakes,Website"} className="font-mono text-xs" />
          </div>
          <Button type="button" className="w-fit" disabled={!paste.trim()} onClick={() => fromText(paste)}><Table2 className="size-4" />Extract & Preview</Button>
        </>
      )}
      {problem && <p role="alert" className="flex items-start gap-2 text-xs text-destructive"><AlertTriangle className="mt-0.5 size-3.5 shrink-0" />{problem}</p>}

      {table && !rows && (
        <section aria-label="Column mapping" className="grid gap-2 rounded-lg border p-3">
          <div className="text-sm font-semibold">Match your columns to lead fields</div>
          <p className="text-[11px] text-muted-foreground">Only exact header names were pre-matched — check each one. Columns set to “Don't import” are shown for review but never saved.{table.truncated > 0 && ` Only the first ${MAX_IMPORT_ROWS} rows were read; ${table.truncated} more were left out.`}</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {table.headers.map((h, i) => (
              <label key={i} className="grid min-w-0 gap-1 text-xs"><span className="truncate font-semibold">{h} <span className="font-normal text-muted-foreground">e.g. {table.rows[0]?.[i] || "—"}</span></span>
                <select aria-label={`Map column ${h}`} className={cn(selectCls, "h-9 text-xs")} value={mapping[i]} onChange={(e) => setMapping((m) => m.map((x, j) => (j === i ? (e.target.value as ImportField) : x === e.target.value && e.target.value !== "ignore" ? "ignore" : x)))}>
                  {IMPORT_FIELDS.map((f) => <option key={f} value={f}>{FIELD_LABEL[f]}</option>)}
                </select>
              </label>
            ))}
          </div>
          <div className="flex flex-wrap gap-2"><Button type="button" onClick={extract}><Table2 className="size-4" />Extract & Preview ({table.rows.length} rows)</Button><Button type="button" variant="ghost" onClick={reset}>Start over</Button></div>
        </section>
      )}

      {rows && (
        <section aria-label="Lead preview" className="grid gap-2">
          <div className="flex flex-wrap items-center gap-2 text-xs" data-testid="import-counts">
            <span className="rounded-full bg-success/15 px-2 py-0.5 font-semibold text-success">Ready to import: <span className="num" data-testid="ready-count">{ready.length}</span></span>
            <span className="rounded-full border px-2 py-0.5">Needs fixing: {counts.invalid}</span>
            <span className="rounded-full border px-2 py-0.5">Duplicates: {counts.duplicate_crm + counts.duplicate_batch}</span>
            <Button type="button" size="sm" variant="ghost" onClick={selectValid}>Select valid rows</Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setRows(null)}>Back to mapping</Button>
          </div>
          <div className="max-h-[50dvh] overflow-auto rounded-lg border">
            <table className="w-full min-w-[860px] text-xs">
              <thead className="sticky top-0 bg-muted text-left"><tr><th className="p-2">Use</th><th className="p-2">Row</th>{EDIT.map((k) => <th key={k} className="p-2">{FIELD_LABEL[k]}</th>)}<th className="p-2">Status</th></tr></thead>
              <tbody>
                {rows.map((r) => {
                  const c = checks[r.key];
                  return (
                    <tr key={r.key} data-row={r.line} data-status={c?.status} className={cn("border-t align-top", !r.selected && "opacity-60")}>
                      <td className="p-2"><input type="checkbox" aria-label={`Include row ${r.line}`} checked={r.selected} disabled={c?.status === "invalid"} onChange={(e) => edit(r.key, { selected: e.target.checked })} /></td>
                      <td className="num p-2 text-muted-foreground">{r.line}</td>
                      {EDIT.map((k) => <td key={k} className="p-1"><input aria-label={`${FIELD_LABEL[k]} row ${r.line}`} value={r[k]} onChange={(e) => edit(r.key, { [k]: e.target.value })} className="h-8 w-full min-w-[90px] rounded-md border bg-card px-2" /></td>)}
                      <td className="min-w-[150px] p-2">
                        <span className={cn("rounded-full px-2 py-0.5 font-semibold", c?.status === "ready" ? "bg-success/15 text-success" : c?.status === "invalid" ? "bg-destructive/10 text-destructive" : "bg-warning/15 text-warning")}>{c ? STATUS_LABEL[c.status] : ""}</span>
                        {c?.problems.map((p) => <div key={p} className="mt-1 text-[11px] text-muted-foreground">{p}</div>)}
                        {c?.existing && <Link to="/leads/$id" params={{ id: c.existing.id }} target="_blank" className="mt-1 block text-[11px] text-primary hover:underline">View existing lead</Link>}
                        {Object.keys(r.extra).length > 0 && <div className="mt-1 text-[11px] text-muted-foreground" title={Object.entries(r.extra).map(([k, v]) => `${k}: ${v}`).join("\n")}>+{Object.keys(r.extra).length} unmapped (not saved)</div>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-muted-foreground">Duplicates are never merged or overwritten and start unticked. Ticking one that's already in the CRM still won't create a second copy. Estimated storage needed: ~{Math.ceil(estimateBytes(ready.map(toNewLead)) / 1024)} KB.</p>
          {result?.kind === "failed" && (
            <div role="alert" className="grid gap-1 rounded-lg border border-destructive/40 bg-destructive-soft/50 p-3 text-xs text-destructive" data-testid="import-failed">
              <b>Nothing was imported.</b><span>{result.message} Created 0 · Failed {result.attempted}. Your existing leads are unchanged and this preview was kept — free some space (e.g. Data Vault backup, then empty Recently Deleted) and try again. Retrying can't create duplicates.</span>
            </div>
          )}
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="ghost" onClick={reset}>Cancel import</Button>
            <Button type="button" disabled={!ready.length || busy} onClick={doImport}>{busy ? <Loader2 className="size-4 animate-spin" /> : result?.kind === "failed" ? <RotateCcw className="size-4" /> : <Check className="size-4" />}{result?.kind === "failed" ? "Retry import" : `Import ${ready.length} lead${ready.length === 1 ? "" : "s"}`}</Button>
          </div>
        </section>
      )}
    </div>
  );
}
