// Shared presentation for Team Performance and My Performance. All numbers come from pure performance.ts.
import { useState } from "react";
import { Info } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatINRCompact, formatDate } from "@/lib/crm/format";
import { METRIC, PROGRESS_LABEL, GOAL_PERIOD_LABEL, type MetricKey, type Progress, type GoalDef } from "@/lib/crm/performance";
import type { ActivityEvent } from "@/lib/crm/activity";

export const ATTRIBUTION_NOTE = "Employee activity attribution will be available after secure account integration.";

export function MetricTip({ text }: { text: string }) {
  return <Tooltip><TooltipTrigger asChild><button type="button" className="pf-tip" aria-label={`Definition: ${text}`}><Info className="size-3.5" /></button></TooltipTrigger><TooltipContent className="max-w-xs text-xs leading-relaxed">{text}</TooltipContent></Tooltip>;
}

export const fmtMetric = (m: MetricKey, v: number | null) => (v == null ? "—" : METRIC[m].unit === "inr" ? formatINRCompact(v) : String(v));
export const fmtRate = (r: number | null) => (r == null ? "N/A" : `${Math.round(r * 100)}%`);

export function Stat({ label, value, tip, warn, muted }: { label: string; value: string | number; tip?: string; warn?: boolean; muted?: boolean }) {
  return <div className="pf-stat" data-warn={warn ? "true" : undefined} data-muted={muted ? "true" : undefined}>
    <dt>{label}{tip && <MetricTip text={tip} />}</dt><dd className="num">{value}</dd>
  </div>;
}

export function GoalProgressCard({ goal, progress, who, actions }: { goal: GoalDef; progress: Progress; who?: string; actions?: React.ReactNode }) {
  const m = METRIC[goal.metric];
  const measurable = progress.pct != null;
  const pct = measurable ? Math.min(1, progress.pct!) : 0;
  return <article className="pf-goal" data-status={progress.status}>
    <header className="flex items-start justify-between gap-3">
      <div className="min-w-0"><h4 className="truncate text-sm font-semibold">{goal.name}</h4><p className="text-xs text-muted-foreground">{GOAL_PERIOD_LABEL[goal.period]} · {m.label}{who ? ` · ${who}` : ""}</p></div>
      <span className="pf-badge" data-status={progress.status}>{PROGRESS_LABEL[progress.status]}</span>
    </header>
    <div className="mt-3 flex items-baseline gap-2"><span className="num text-2xl font-semibold">{measurable ? fmtMetric(goal.metric, progress.actual) : "—"}</span><span className="text-sm text-muted-foreground">of {fmtMetric(goal.metric, progress.target)}</span>{measurable && <span className="ml-auto num text-sm font-medium">{Math.round(progress.pct! * 100)}%</span>}</div>
    <div className="pf-bar mt-2" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={measurable ? Math.round(pct * 100) : undefined} aria-label={`${goal.name} progress`} data-empty={!measurable}><span style={{ width: `${pct * 100}%` }} /></div>
    <p className="mt-2 text-xs text-muted-foreground">
      {progress.window ? `${formatDate(progress.window.start)} – ${formatDate(progress.window.end)}` : "No active period"}
      {measurable && progress.remaining! > 0 ? ` · ${fmtMetric(goal.metric, progress.remaining)} to go` : ""}
      {progress.status === "not_measurable" ? ` · ${ATTRIBUTION_NOTE}` : ""}
    </p>
    {actions && <div className="mt-3 flex flex-wrap gap-2">{actions}</div>}
  </article>;
}

/** Simple interactive bar chart: click a bar to inspect the records behind it. */
export function TrendChart({ series, label, onPick, picked }: { series: { day: string; value: number; events: ActivityEvent[] }[]; label: string; onPick: (day: string) => void; picked?: string | undefined }) {
  const [hover, setHover] = useState<string | null>(null);
  const max = Math.max(1, ...series.map((s) => s.value));
  const total = series.reduce((s, x) => s + x.value, 0);
  return <figure className="pf-chart" aria-label={`${label} by day`}>
    <div className="pf-bars" role="list">
      {series.map((s) => <button key={s.day} type="button" role="listitem" className="pf-col" data-picked={picked === s.day} onClick={() => onPick(s.day)} onMouseEnter={() => setHover(s.day)} onMouseLeave={() => setHover(null)} aria-label={`${formatDate(s.day)}: ${s.value}`}>
        <span className="pf-colbar" style={{ height: `${(s.value / max) * 100}%` }} data-zero={s.value === 0} />
      </button>)}
    </div>
    <figcaption className="mt-2 flex justify-between text-[11px] text-muted-foreground"><span>{series[0] ? formatDate(series[0].day) : ""}</span><span>{hover ? `${formatDate(hover)} · ${series.find((x) => x.day === hover)?.value ?? 0}` : `Total ${total}`}</span><span>{series.at(-1) ? formatDate(series.at(-1)!.day) : ""}</span></figcaption>
  </figure>;
}
