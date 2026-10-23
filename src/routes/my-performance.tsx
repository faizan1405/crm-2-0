import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { Target, AlertTriangle, Info } from "lucide-react";
import { Shell, Empty } from "@/components/crm/Shell";
import { ATTRIBUTION_NOTE, GoalProgressCard, Stat } from "@/components/crm/Performance";
import { useCRM } from "@/lib/crm/store";
import { useAccess } from "@/lib/crm/session";
import { STATUS_LABEL, LEAD_STATUSES } from "@/lib/crm/types";
import { dayKey } from "@/lib/crm/format";
import { goalProgress, goalsFor, indexEvents, visibleGoal, workloadFor } from "@/lib/crm/performance";
import { Button } from "@/components/ui/button";
import { TooltipProvider } from "@/components/ui/tooltip";

export const Route = createFileRoute("/my-performance")({
  head: () => ({
    meta: [
      { title: "My Performance · Scale Flow Sales OS" },
      { name: "description", content: "Your assigned workload, your sales goals and the work left to reach them." },
      { property: "og:title", content: "My Performance · Scale Flow Sales OS" },
      { property: "og:description", content: "Personal workload, goals and progress for each employee." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: MyPerformance,
});

function MyPerformance() {
  const st = useCRM();
  const { preview } = useAccess();
  const now = useMemo(() => new Date(), []);
  const idx = useMemo(() => indexEvents(st.teamEvents, false), [st.teamEvents]);
  if (!preview) return <Shell title="My Performance"><Empty icon={<Target />} title="Employee view" hint="This page is what each employee sees about their own goals. Open an Employee Preview to see it, or use Team Performance." action={<Button asChild size="sm"><Link to="/team-performance">Open Team Performance</Link></Button>} /></Shell>;

  const id = preview.employeeId;
  const canMoney = (preview.finance === "amounts" || preview.finance === "manage") && preview.allowed.includes("deals.view");
  const w = workloadFor(id, { leads: st.leads, followUps: st.followUps, assignments: st.assignments }, now);
  const goals = goalsFor(st.goals, id).filter((g) => g.status !== "archived" && visibleGoal(g, canMoney));
  const today = dayKey(now);
  const ctx = { employees: st.employees, payments: canMoney ? st.payments : [] };
  const priorities = st.leads.filter((l) => st.assignments[l.id]?.employeeId === id && l.priority === "hot" && l.status !== "won" && l.status !== "lost").slice(0, 6);

  return <TooltipProvider delayDuration={150}><Shell title="My Performance" subtitle={`${preview.name} · your workload and goals`}>
    <div className="ta-note"><Info className="size-4 shrink-0" /><p>You see only your own workload and goals. Goals are set by the Owner. {ATTRIBUTION_NOTE}</p></div>
    <section className="mt-6" aria-label="My workload">
      <h2 className="editorial text-2xl">My workload</h2>
      <dl className="pf-grid mt-3">
        <Stat label="Assigned leads" value={w.assigned} /><Stat label="Hot leads" value={w.hot} /><Stat label="New leads" value={w.fresh} />
        <Stat label="Follow-ups due today" value={w.dueToday} /><Stat label="Open follow-ups" value={w.openFollowUps} /><Stat label="Overdue" value={w.overdue} warn={w.overdue > 0} />
      </dl>
      <div className="pf-stages mt-3">{LEAD_STATUSES.map((s) => <div key={s} className="pf-stage"><span>{STATUS_LABEL[s]}</span><b className="num">{w.byStage[s]}</b></div>)}</div>
      <div className="mt-3 flex flex-wrap gap-2"><Button asChild size="sm" variant="outline"><Link to="/follow-ups">Open my follow-ups</Link></Button><Button asChild size="sm" variant="ghost"><Link to="/leads">Open my leads</Link></Button></div>
    </section>
    <section className="mt-8" aria-label="My goals">
      <h2 className="editorial text-2xl">My goals</h2>
      {goals.length ? <div className="pf-goals mt-3">{goals.map((g) => <GoalProgressCard key={g.id} goal={g} progress={goalProgress(g, st.goalRevisions, id, idx, today, ctx)} />)}</div> : <p className="mt-2 text-sm text-muted-foreground">No goals have been set for you yet.</p>}
    </section>
    <section className="mt-8" aria-label="Open priorities">
      <h2 className="editorial text-2xl">Open priorities</h2>
      {priorities.length ? <ul className="mt-3 divide-y rounded-xl border">{priorities.map((l) => <li key={l.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm"><span className="truncate font-medium">{l.name}</span><span className="text-xs text-muted-foreground">{STATUS_LABEL[l.status]} · Hot</span></li>)}</ul> : <p className="mt-2 text-sm text-muted-foreground">No Hot leads waiting.</p>}
      <div className="pf-unmeasured mt-4"><AlertTriangle className="size-4 shrink-0" /><p>Your personal activity summary (calls, completions, wins) appears once your actions are recorded under your own secure account.</p></div>
    </section>
  </Shell></TooltipProvider>;
}
