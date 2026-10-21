import { createFileRoute, Link } from "@tanstack/react-router";
import { Shell, Stat, PriorityBadge } from "@/components/crm/Shell";
import { useCRM } from "@/lib/crm/store";
import { financeSummary } from "@/lib/crm/finance";
import { formatINRCompact, formatPct, formatDateTime, greeting } from "@/lib/crm/format";
import { FOLLOWUP_LABEL } from "@/lib/crm/types";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Dashboard · Scale Flow CRM" },
      { name: "description", content: "Your leads, follow-ups and collections at a glance." },
      { property: "og:title", content: "Dashboard · Scale Flow CRM" },
      { property: "og:description", content: "Your leads, follow-ups and collections at a glance." },
    ],
  }),
  component: Dashboard,
});

function Dashboard() {
  const { leads, deals, payments, followUps, owner } = useCRM();
  const fin = financeSummary(deals, payments);
  const open = leads.filter((l) => !["won", "lost"].includes(l.status));
  const pending = followUps.filter((f) => !f.completedAt).sort((a, b) => a.dueAt.localeCompare(b.dueAt));
  const hot = [...open].sort((a, b) => (b.aiScore ?? 0) - (a.aiScore ?? 0)).slice(0, 5);
  const leadName = (id: string) => leads.find((l) => l.id === id)?.name ?? "—";

  return (
    <Shell title={`${greeting()}, ${owner}`} subtitle="Here's what needs your attention today." actions={<Link to="/daily-briefing" className="rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90">Open daily briefing</Link>}>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Open leads" value={String(open.length)} hint={`${leads.length} total`} />
        <Stat label="Collected" value={formatINRCompact(fin.collected)} hint={`${formatPct(fin.collectionRate)} of deal value`} tone="success" />
        <Stat label="Outstanding" value={formatINRCompact(fin.outstanding)} tone="warning" />
        <Stat label="Overdue" value={formatINRCompact(fin.overdue)} tone="destructive" />
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <section className="surface p-5">
          <div className="mb-3 flex justify-between"><h2 className="font-semibold">Upcoming follow-ups</h2><Link to="/follow-ups" className="text-sm text-primary">View all</Link></div>
          <ul className="divide-y">
            {pending.slice(0, 5).map((f) => (
              <li key={f.id} className="flex items-center justify-between py-2.5 text-sm">
                <div><Link to="/leads/$id" params={{ id: f.leadId }} className="font-medium hover:text-primary">{leadName(f.leadId)}</Link><div className="text-xs text-muted-foreground">{FOLLOWUP_LABEL[f.type]} · {f.note}</div></div>
                <span className="num text-xs text-muted-foreground">{formatDateTime(f.dueAt)}</span>
              </li>
            ))}
            {pending.length === 0 && <li className="py-4 text-sm text-muted-foreground">All caught up.</li>}
          </ul>
        </section>
        <section className="surface p-5">
          <div className="mb-3 flex justify-between"><h2 className="font-semibold">Top leads</h2><Link to="/leads" className="text-sm text-primary">View all</Link></div>
          <ul className="divide-y">
            {hot.map((l) => (
              <li key={l.id} className="flex items-center justify-between py-2.5 text-sm">
                <div><Link to="/leads/$id" params={{ id: l.id }} className="font-medium hover:text-primary">{l.name}</Link><div className="text-xs text-muted-foreground">{l.company}</div></div>
                <div className="flex items-center gap-2"><PriorityBadge p={l.priority} /><span className="num w-8 text-right font-semibold text-primary">{l.aiScore}</span></div>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </Shell>
  );
}
