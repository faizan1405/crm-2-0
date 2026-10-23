// Shared Analytics Studio presentation: KPI tiles, definition popovers, chart cards and the drill-down sheet.
// Pure presentation — every value is computed by src/lib/crm/analytics.ts.
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { ArrowDownRight, ArrowUpRight, Info, ExternalLink } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useCRM } from "@/lib/crm/store";
import { formatDate, formatINR } from "@/lib/crm/format";
import { STATUS_LABEL } from "@/lib/crm/types";
import { dealCollected, dealOutstanding } from "@/lib/crm/finance";
import { cn } from "@/lib/utils";

export const CHART = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)", "var(--chart-6)"];
export const tip = { contentStyle: { background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12, color: "var(--popover-foreground)" }, cursor: { fill: "var(--muted)", opacity: 0.4 } };
export const axis = { tick: { fill: "var(--muted-foreground)", fontSize: 11 }, axisLine: false, tickLine: false } as const;

export function Def({ text, label }: { text: string; label: string }) {
  return (
    <Popover>
      <PopoverTrigger aria-label={`How “${label}” is calculated`} className="inline-flex size-5 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground" onClick={(e) => e.stopPropagation()}><Info className="size-3.5" /></PopoverTrigger>
      <PopoverContent className="w-72 text-xs leading-relaxed" onClick={(e) => e.stopPropagation()}><p className="mb-1 font-semibold">{label}</p>{text}</PopoverContent>
    </Popover>
  );
}

export interface Delta { diff: number; pct: number | null }
export function Kpi({ label, value, hint, def, delta, tone = "default", onOpen, primary, deltaMoney }: { label: string; value: string; hint?: string | undefined; def: string; delta?: Delta | null | undefined; tone?: "default" | "success" | "warning" | "destructive"; onOpen?: (() => void) | undefined; primary?: boolean; deltaMoney?: boolean }) {
  const toneCls = { default: "", success: "text-success", warning: "text-warning", destructive: "text-destructive" }[tone];
  return (
    <div className={cn("as-kpi", primary && "as-kpi-primary", onOpen && "is-clickable")} role={onOpen ? "button" : undefined} tabIndex={onOpen ? 0 : undefined} aria-label={onOpen ? `${label}: ${value}. Show records` : undefined}
      onClick={onOpen} onKeyDown={(e) => { if (onOpen && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onOpen(); } }}>
      <div className="flex items-center justify-between gap-1"><span className="text-xs font-medium text-muted-foreground">{label}</span><Def text={def} label={label} /></div>
      <div className={cn("num mt-2 font-display text-2xl font-bold tracking-tight", primary && "text-3xl", toneCls)}>{value}</div>
      <div className="mt-1 flex min-h-4 flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground">
        {delta && <span className={cn("inline-flex items-center gap-0.5 font-medium", delta.diff > 0 ? "text-success" : delta.diff < 0 ? "text-destructive" : "")}>
          {delta.diff > 0 ? <ArrowUpRight className="size-3" /> : delta.diff < 0 ? <ArrowDownRight className="size-3" /> : null}
          {delta.diff === 0 ? "No change" : `${delta.diff > 0 ? "+" : "−"}${deltaMoney ? formatINR(Math.abs(delta.diff)) : Math.abs(delta.diff)}${delta.pct != null ? ` (${Math.round(Math.abs(delta.pct) * 100)}%)` : ""}`}
          <span className="font-normal text-muted-foreground">vs previous</span></span>}
        {hint && <span>{hint}</span>}
      </div>
    </div>
  );
}

export function Panel({ title, sub, def, action, className, children }: { title: string; sub?: string | undefined; def?: string | undefined; action?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <section className={cn("card-surface min-w-0 p-4 sm:p-5", className)} aria-label={title}>
      <header className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0"><h3 className="flex items-center gap-1 text-sm font-semibold">{title}{def && <Def text={def} label={title} />}</h3>{sub && <p className="text-xs text-muted-foreground">{sub}</p>}</div>
        {action}
      </header>
      {children}
    </section>
  );
}

export function Unavailable({ title, reason }: { title: string; reason: string }) {
  return <div className="rounded-lg border border-dashed p-3 text-xs"><p className="font-semibold">{title}: N/A</p><p className="mt-0.5 text-muted-foreground">{reason}</p></div>;
}

export function EmptyChart({ text }: { text: string }) {
  return <div className="flex h-40 items-center justify-center rounded-lg border border-dashed text-xs text-muted-foreground">{text}</div>;
}

// ---------------------------------------------------------------- Drill-down
export type DrillKind = "lead" | "deal" | "project" | "payment";
export interface Drill { title: string; kind: DrillKind; ids: string[]; note?: string | undefined }

export function DrillSheet({ drill, onClose }: { drill: Drill | null; onClose: () => void }) {
  const s = useCRM();
  const list = drill?.ids ?? [];
  return (
    <Dialog open={!!drill} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-xl overflow-y-auto">
        <DialogHeader><DialogTitle>{drill?.title}</DialogTitle><DialogDescription>{list.length} record{list.length === 1 ? "" : "s"} · live from your CRM{drill?.note ? ` · ${drill.note}` : ""}</DialogDescription></DialogHeader>
        {list.length === 0 ? <p className="text-sm text-muted-foreground">No records.</p> : (
          <ul className="divide-y rounded-lg border text-sm">
            {list.slice(0, 200).map((id) => {
              if (drill!.kind === "lead") { const l = s.leads.find((x) => x.id === id); if (!l) return <li key={id} className="p-2 text-muted-foreground">Removed lead</li>;
                return <li key={id} className="flex items-center gap-2 p-2"><div className="min-w-0 flex-1"><div className="truncate font-medium">{l.name}</div><div className="truncate text-xs text-muted-foreground">{l.source} · {STATUS_LABEL[l.status]} · created {formatDate(l.createdAt, { day: "numeric", month: "short", year: "numeric" })}{l.quotedAmount ? ` · quoted ${formatINR(l.quotedAmount)}` : ""}</div></div>
                  <Link to="/pipeline" search={{ lead: l.id }} className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-primary hover:underline" onClick={onClose}>Open<ExternalLink className="size-3" /></Link></li>; }
              if (drill!.kind === "deal") { const d = s.deals.find((x) => x.id === id); if (!d) return <li key={id} className="p-2 text-muted-foreground">Removed deal</li>;
                return <li key={id} className="flex items-center gap-2 p-2"><div className="min-w-0 flex-1"><div className="truncate font-medium">{d.name} · {d.clientName}</div><div className="truncate text-xs text-muted-foreground">Value {formatINR(d.finalAmount)} · received {formatINR(dealCollected(d.id, s.payments))} · outstanding {formatINR(dealOutstanding(d, s.payments))}</div></div>
                  <Link to="/deals" className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-primary hover:underline" onClick={onClose}>Deals<ExternalLink className="size-3" /></Link></li>; }
              if (drill!.kind === "payment") { const p = s.payments.find((x) => x.id === id); const d = p && s.deals.find((x) => x.id === p.dealId); if (!p) return <li key={id} className="p-2 text-muted-foreground">Removed payment</li>;
                return <li key={id} className="flex items-center gap-2 p-2"><div className="min-w-0 flex-1"><div className="truncate font-medium">{formatINR(p.amount)} · {p.method}</div><div className="truncate text-xs text-muted-foreground">{formatDate(p.date, { day: "numeric", month: "short", year: "numeric" })} · {d?.name ?? "Deal removed"}</div></div>
                  <Link to="/deals" className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-primary hover:underline" onClick={onClose}>Deals<ExternalLink className="size-3" /></Link></li>; }
              const p = s.projects.find((x) => x.id === id); if (!p) return <li key={id} className="p-2 text-muted-foreground">Removed project</li>;
              return <li key={id} className="flex items-center gap-2 p-2"><div className="min-w-0 flex-1"><div className="truncate font-medium">{p.name}</div><div className="truncate text-xs text-muted-foreground">{p.clientName} · {p.status.replace(/_/g, " ")}{p.targetDelivery ? ` · target ${formatDate(p.targetDelivery, { day: "numeric", month: "short", year: "numeric" })}` : ""}</div></div>
                <Link to="/projects/$id" params={{ id: p.id }} className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-primary hover:underline" onClick={onClose}>Open<ExternalLink className="size-3" /></Link></li>;
            })}
          </ul>
        )}
        {list.length > 200 && <p className="text-xs text-muted-foreground">Showing the first 200.</p>}
      </DialogContent>
    </Dialog>
  );
}
