import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis, Legend } from "recharts";
import { IndianRupee, Wallet, AlertCircle, Percent, Target } from "lucide-react";
import { Shell, Stat } from "@/components/crm/Shell";
import { useCRM } from "@/lib/crm/store";
import { financeSummary } from "@/lib/crm/finance";
import { dayKey, formatINR, formatINRCompact, formatPct, formatDate } from "@/lib/crm/format";
import { LEAD_STATUSES, STATUS_LABEL } from "@/lib/crm/types";
import { rangeBounds, shiftDay, inDateRange, type AnalyticsRange } from "@/lib/crm/dates";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/analytics")({
  head: () => ({
    meta: [
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { title: "Analytics · Scale Flow CRM" },
      { name: "description", content: "Revenue, pipeline, lead and follow-up analytics." },
      { property: "og:title", content: "Analytics · Scale Flow CRM" },
      { property: "og:description", content: "Revenue, pipeline, lead and follow-up analytics." },
    ],
  }),
  component: Analytics,
});

type Range = AnalyticsRange;
const COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)", "var(--chart-6)"];
const tip = { contentStyle: { background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12, color: "var(--popover-foreground)" } };

function Analytics() {
  const { leads, deals, payments, followUps } = useCRM();
  const [range, setRange] = useState<Range>("30d");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [start, end] = rangeBounds(range, from, to);
  const inRange = (d: string) => inDateRange(d, start, end);

  const data = useMemo(() => {
    const rLeads = leads.filter((l) => inRange(l.createdAt));
    const eligibleIds = new Set(deals.filter((d) => d.status !== "cancelled").map((d) => d.id));
    const rPayments = payments.filter((p) => !p.voided && eligibleIds.has(p.dealId) && inRange(p.date));
    const fin = financeSummary(deals, payments);
    const won = rLeads.filter((l) => l.status === "won").length;
    const lost = rLeads.filter((l) => l.status === "lost").length;
    const open = leads.filter((l) => l.status !== "won" && l.status !== "lost");
    const byStage = LEAD_STATUSES.map((s) => ({ stage: STATUS_LABEL[s], count: rLeads.filter((l) => l.status === s).length, value: rLeads.filter((l) => l.status === s).reduce((a, l) => a + (l.quotedAmount ?? 0), 0) }));
    // Funnel: a lead in a later stage has passed earlier ones (lost excluded).
    const order = ["new", "contacted", "qualified", "proposal", "won"] as const;
    const funnel = order.map((s, i) => ({ stage: STATUS_LABEL[s], count: rLeads.filter((l) => l.status !== "lost" && order.indexOf(l.status as (typeof order)[number]) >= i).length }));
    const sources = Object.entries(rLeads.reduce<Record<string, number>>((a, l) => ((a[l.source] = (a[l.source] ?? 0) + 1), a), {})).map(([name, value]) => ({ name, value }));
    // Revenue trend from real payments, daily for ≤ 62 days, else monthly.
    const days = Math.round((new Date(end).getTime() - new Date(start === "0000-01-01" ? (payments.map((p) => p.date).sort()[0] ?? end) : start).getTime()) / 86_400_000) + 1;
    const monthly = days > 62;
    const buckets = new Map<string, number>();
    if (!monthly) for (let i = days - 1; i >= 0; i--) buckets.set(shiftDay(end, -i), 0);
    rPayments.forEach((p) => { const k = monthly ? p.date.slice(0, 7) : dayKey(p.date); buckets.set(k, (buckets.get(k) ?? 0) + p.amount); });
    const trend = [...buckets.entries()].sort().map(([k, v]) => ({ label: monthly ? formatDate(k + "-01", { month: "short", year: "2-digit" }) : formatDate(k), revenue: v }));
    const today = dayKey(new Date());
    const fu = {
      dueToday: followUps.filter((f) => !f.completedAt && dayKey(f.dueAt) === today).length,
      overdue: followUps.filter((f) => !f.completedAt && dayKey(f.dueAt) < today).length,
      completed: followUps.filter((f) => f.completedAt && inRange(f.completedAt)).length,
    };
    const fuTrend = ["call", "whatsapp", "meeting", "email"].map((t) => ({ type: t === "whatsapp" ? "WhatsApp" : t.charAt(0).toUpperCase() + t.slice(1), scheduled: followUps.filter((f) => f.type === t && inRange(f.dueAt)).length, done: followUps.filter((f) => f.type === t && f.completedAt && inRange(f.completedAt)).length }));
    return { rLeads, rPayments, fin, won, lost, open, byStage, funnel, sources, trend, fu, fuTrend, received: rPayments.reduce((a, p) => a + p.amount, 0) };
  }, [leads, deals, payments, followUps, start, end]);

  const conv = data.won + data.lost > 0 ? data.won / (data.won + data.lost) : null;
  const openValue = data.open.reduce((a, l) => a + (l.quotedAmount ?? 0), 0);
  const maxFunnel = Math.max(1, data.funnel[0]?.count ?? 1);

  return (
    <Shell title="Analytics" subtitle={`${formatDate(start === "0000-01-01" ? undefined : start, { day: "numeric", month: "short", year: "numeric" })} – ${formatDate(end, { day: "numeric", month: "short", year: "numeric" })}`}
      actions={<div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1 rounded-lg bg-muted p-1">
          {([["today", "Today"], ["7d", "7 days"], ["30d", "30 days"], ["month", "This month"], ["custom", "Custom"]] as const).map(([k, l]) => (
            <Button size="sm" variant="ghost" key={k} onClick={() => setRange(k)} className={cn("rounded-md px-2.5 py-1 text-xs font-medium", range === k ? "bg-card text-foreground shadow-card" : "text-muted-foreground hover:text-foreground")}>{l}</Button>
          ))}
        </div>
        {range === "custom" && <div className="flex gap-1"><Input aria-label="From" type="date" className="h-8 w-36" value={from} onChange={(e) => setFrom(e.target.value)} /><Input aria-label="To" type="date" className="h-8 w-36" value={to} onChange={(e) => setTo(e.target.value)} /></div>}
      </div>}>
      {start > end && <p role="alert" className="mb-4 text-sm text-destructive">Start date must be on or before end date.</p>}
      <section className="analytics-revenue border-y py-6 text-foreground">
        <div className="flex items-center gap-2 text-xs font-semibold text-teal"><Wallet className="size-4" />MONEY RECEIVED IN RANGE</div>
        <div className="num mt-3 font-display text-4xl font-extrabold">{formatINR(data.received)}</div>
        <div className="mt-1 text-sm text-muted-foreground">{data.rPayments.length} payments · deal value is tracked separately below</div>
        <div className="mt-4 h-48">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data.trend} margin={{ left: 0, right: 0, top: 5, bottom: 0 }}>
              <defs><linearGradient id="rev" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--chart-2)" stopOpacity={0.6} /><stop offset="100%" stopColor="var(--chart-2)" stopOpacity={0} /></linearGradient></defs>
              <XAxis dataKey="label" tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} axisLine={false} tickLine={false} minTickGap={24} />
              <Tooltip {...tip} formatter={(v: number) => [formatINR(v), "Received"]} />
              <Area type="monotone" dataKey="revenue" stroke="var(--chart-2)" strokeWidth={3} fill="url(#rev)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
        {data.received === 0 && <p className="text-xs text-muted-foreground">No payments recorded in this range.</p>}
      </section>

      <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Total deal value" value={formatINRCompact(data.fin.totalValue)} hint="Excludes cancelled" icon={<IndianRupee />} />
        <Stat label="Total received" value={formatINRCompact(data.fin.collected)} hint="All time" tone="success" icon={<Wallet />} />
        <Stat label="Outstanding" value={formatINRCompact(data.fin.outstanding)} tone="warning" icon={<Target />} />
        <Stat label="Collection rate" value={formatPct(data.fin.collectionRate)} tone="teal" icon={<Percent />} />
        <Stat label="Overdue" value={formatINRCompact(data.fin.overdue)} tone="destructive" icon={<AlertCircle />} />
      </div>

      <div className="mt-7 grid gap-8 lg:grid-cols-3">
        <Card title="Sales funnel" sub={`${data.rLeads.length} leads created in range`}>
          <div className="grid gap-2">
            {data.funnel.map((f, i) => (
              <div key={f.stage} className="text-sm">
                <div className="mb-1 flex justify-between"><span>{f.stage}</span><span className="num font-semibold">{f.count}</span></div>
                <div className="h-2 rounded-full bg-muted"><div className="h-full rounded-full" style={{ width: `${(f.count / maxFunnel) * 100}%`, background: COLORS[i] }} /></div>
              </div>
            ))}
          </div>
          <div className="mt-4 grid grid-cols-3 gap-2 border-t pt-3 text-center text-sm">
            <div><div className="num font-display text-lg font-bold text-success">{data.won}</div><div className="text-xs text-muted-foreground">Won</div></div>
            <div><div className="num font-display text-lg font-bold text-destructive">{data.lost}</div><div className="text-xs text-muted-foreground">Lost</div></div>
            <div><div className="num font-display text-lg font-bold">{formatPct(conv)}</div><div className="text-xs text-muted-foreground">Win rate</div></div>
          </div>
        </Card>
        <Card title="Pipeline by stage" sub={`Open pipeline value ${formatINRCompact(openValue)}`} className="lg:col-span-2">
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.byStage}>
                <CartesianGrid vertical={false} stroke="var(--border)" />
                <XAxis dataKey="stage" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} />
                <YAxis yAxisId="v" tickFormatter={(v) => formatINRCompact(v)} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} width={60} />
                <YAxis yAxisId="c" orientation="right" allowDecimals={false} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} width={24} />
                <Tooltip {...tip} cursor={{ fill: "var(--muted)" }} formatter={(v: number, n: string) => (n === "Value" ? formatINR(v) : v)} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar yAxisId="v" dataKey="value" name="Value" fill="var(--chart-1)" radius={[6, 6, 0, 0]} />
                <Bar yAxisId="c" dataKey="count" name="Leads" fill="var(--chart-2)" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card title="Lead sources">
          {data.sources.length === 0 ? <p className="py-10 text-center text-sm text-muted-foreground">No leads in this range.</p> : (
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={data.sources} dataKey="value" nameKey="name" innerRadius={50} outerRadius={80} paddingAngle={2}>{data.sources.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}</Pie>
                  <Tooltip {...tip} /><Legend wrapperStyle={{ fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>
        <Card title="Follow-up performance" className="lg:col-span-2">
          <div className="mb-3 grid grid-cols-3 gap-2 text-center">
            {[["Due today", data.fu.dueToday, "text-primary"], ["Overdue", data.fu.overdue, "text-destructive"], ["Completed in range", data.fu.completed, "text-success"]].map(([l, v, c]) => (
              <div key={l as string} className="rounded-lg bg-muted/60 p-2"><div className={cn("num font-display text-xl font-bold", c as string)}>{v}</div><div className="text-xs text-muted-foreground">{l}</div></div>
            ))}
          </div>
          <div className="h-44">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.fuTrend}>
                <XAxis dataKey="type" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} width={24} />
                <Tooltip {...tip} cursor={{ fill: "var(--muted)" }} /><Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="scheduled" name="Scheduled" fill="var(--chart-6)" radius={[4, 4, 0, 0]} />
                <Bar dataKey="done" name="Completed" fill="var(--chart-4)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>
    </Shell>
  );
}

function Card({ title, sub, className, children }: { title: string; sub?: string; className?: string; children: React.ReactNode }) {
  return <section className={cn("surface p-5", className)}><h2 className="text-base font-bold">{title}</h2>{sub && <p className="mb-3 text-xs text-muted-foreground">{sub}</p>}{!sub && <div className="mb-3" />}{children}</section>;
}
