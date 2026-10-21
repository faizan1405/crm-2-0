import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { ArrowUpRight, Plus, Users, Wallet, Target, CalendarClock, Check, Phone, Sunrise, TrendingUp, CircleDollarSign, Trophy, Activity } from "lucide-react";
import { Shell, Stat, PriorityBadge, Identity, Empty } from "@/components/crm/Shell";
import { AddLeadDialog } from "@/components/crm/AddLeadDialog";
import { Button } from "@/components/ui/button";
import { useCRM } from "@/lib/crm/store";
import { financeSummary } from "@/lib/crm/finance";
import { formatINRCompact, formatPct, formatDateTime, greeting, dayKey, formatDate, relative } from "@/lib/crm/format";
import { FOLLOWUP_LABEL, LEAD_STATUSES, STATUS_LABEL } from "@/lib/crm/types";
import { cn } from "@/lib/utils";
import { BarChart, Bar, ResponsiveContainer, XAxis, Tooltip, Cell, CartesianGrid } from "recharts";
export const Route = createFileRoute("/")({
  head: () => ({ meta: [
    {property:"og:type",content:"website"},{name:"twitter:card",content:"summary_large_image"},
    {title:"Dashboard · Scale Flow CRM"},{name:"description",content:"Your leads, follow-ups and collections at a glance."},
    {property:"og:title",content:"Dashboard · Scale Flow CRM"},{property:"og:description",content:"Your leads, follow-ups and collections at a glance."},
  ] }), component: Dashboard,
});
function Dashboard() {
  const { leads, deals, payments, followUps, owner, activities, completeFollowUp, addActivity } = useCRM();
  const [add,setAdd] = useState(false);
  const fin=financeSummary(deals,payments), today=dayKey(new Date());
  const open=leads.filter(l => !["won","lost"].includes(l.status));
  const pending=followUps.filter(f => !f.completedAt).sort((a,b)=>a.dueAt.localeCompare(b.dueAt));
  const focus=pending.filter(f => dayKey(f.dueAt)<=today);
  const hot=[...open].sort((a,b)=>(b.aiScore??0)-(a.aiScore??0)).slice(0,4);
  const stage=LEAD_STATUSES.map(s=>({name:STATUS_LABEL[s],count:leads.filter(l=>l.status===s).length}));
  const colors=["var(--chart-6)","var(--chart-2)","var(--chart-1)","var(--chart-3)","var(--success)","var(--destructive)"];
  return <Shell title={`${greeting()}, ${owner.split(" ")[0] ?? owner}`} subtitle={formatDate(new Date().toISOString(),{weekday:"long",day:"numeric",month:"long",year:"numeric"})} actions={<div className="flex gap-2"><Button variant="outline" asChild><Link to="/daily-briefing"><Sunrise />Daily briefing</Link></Button><Button onClick={()=>setAdd(true)}><Plus />Add lead</Button></div>}>
    <div className="dashboard-overview mb-6 flex flex-wrap items-center justify-between gap-6 border-y py-6">
      <div className="min-w-0"><div className="mb-2 flex items-center gap-2 text-xs font-semibold text-teal"><TrendingUp className="size-4" />SALES OVERVIEW</div><h2 className="font-display text-xl font-bold">A clear view of your next move.</h2><p className="mt-2 text-xs text-muted-foreground">{open.length} active leads · {focus.length} follow-ups need attention · {leads.filter(l=>l.status==="won").length} won clients</p></div>
      <div className="flex items-center gap-6 border-l pl-6"><div><div className="text-[11px] text-muted-foreground">Open pipeline</div><div className="num mt-1 font-display text-3xl font-extrabold">{formatINRCompact(open.reduce((a,l)=>a+(l.quotedAmount??0),0))}</div></div><Button variant="ghost" size="icon" asChild className="rounded-full border bg-card text-primary"><Link to="/pipeline" title="Open pipeline"><ArrowUpRight /></Link></Button></div>
    </div>
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Stat label="Total leads" value={String(leads.length)} hint={`${open.length} active · ${leads.filter(l=>l.status==="won").length} won`} icon={<Users />} />
      <Stat label="Collected" value={formatINRCompact(fin.collected)} hint={`${formatPct(fin.collectionRate)} of deal value`} tone="success" icon={<Wallet />} />
      <Stat label="Outstanding" value={formatINRCompact(fin.outstanding)} hint={`${formatINRCompact(fin.overdue)} overdue`} tone="warning" icon={<CircleDollarSign />} />
      <Stat label="Follow-ups today" value={String(pending.filter(f=>dayKey(f.dueAt)===today).length)} hint={`${pending.filter(f=>dayKey(f.dueAt)<today).length} overdue`} tone="teal" icon={<CalendarClock />} />
    </div>
    <div className="mt-7 grid gap-8 xl:grid-cols-[1.4fr_1fr]">
      <section className="surface"><div className="mb-5 flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-display text-base font-bold">Pipeline at a glance</h2><p className="mt-1 text-xs text-muted-foreground">Every lead, by current stage</p></div><Button variant="ghost" size="sm" asChild><Link to="/pipeline" className="text-primary">View pipeline<ArrowUpRight /></Link></Button></div>
        <div className="h-52"><ResponsiveContainer width="100%" height="100%"><BarChart data={stage} barSize={32} margin={{left:0,right:0,bottom:0,top:15}}><CartesianGrid vertical={false} stroke="var(--border)" /><XAxis dataKey="name" tick={{fill:"var(--muted-foreground)",fontSize:10}} tickLine={false} axisLine={false} interval={0}/><Tooltip cursor={{fill:"var(--muted)"}} contentStyle={{background:"var(--popover)",color:"var(--popover-foreground)",border:"1px solid var(--border)",borderRadius:8,fontSize:12}} /><Bar dataKey="count" name="Leads" radius={[5,5,0,0]}>{stage.map((s,i)=><Cell key={s.name} fill={colors[i]} />)}</Bar></BarChart></ResponsiveContainer></div>
        <div className="mt-4 grid grid-cols-3 divide-x border-t pt-4 text-center"><div><div className="text-[10px] text-muted-foreground">Total deal value</div><div className="num mt-1 text-sm font-bold">{formatINRCompact(fin.totalValue)}</div></div><div><div className="text-[10px] text-muted-foreground">Won clients</div><div className="num mt-1 text-sm font-bold text-success">{leads.filter(l=>l.status==="won").length}</div></div><div><div className="text-[10px] text-muted-foreground">Collection rate</div><div className="num mt-1 text-sm font-bold text-teal">{formatPct(fin.collectionRate)}</div></div></div>
      </section>
      <section className="surface"><div className="mb-5 flex items-center justify-between"><div><h2 className="text-base font-bold">Today's focus</h2><p className="mt-1 text-xs text-muted-foreground">Overdue first, then today's follow-ups</p></div><span className="rounded-md bg-warning-soft px-2 py-1 text-xs font-semibold text-warning">{focus.length} to do</span></div><ul className="divide-y">{focus.slice(0,4).map(f=>{const l=leads.find(l=>l.id===f.leadId);return <li key={f.id} className="py-4"><div className="flex items-center justify-between gap-2"><Link to="/leads/$id" params={{id:f.leadId}}><Identity name={l?.name??"Lead"} company={l?.company} /></Link><Button variant="outline" size="icon" title="Complete follow-up" aria-label={`Complete ${l?.name ?? "follow-up"}`} onClick={()=>{completeFollowUp(f.id);toast.success("Follow-up completed");}}><Check className="text-success" /></Button></div><div className="mt-2 flex items-center justify-between gap-2 text-[11px]"><span className="text-muted-foreground">{FOLLOWUP_LABEL[f.type]} · {f.note}</span><span className={cn("shrink-0",dayKey(f.dueAt)<today?"text-destructive":"text-primary")}>{dayKey(f.dueAt)<today?"Overdue":formatDateTime(f.dueAt)}</span></div></li>;})}{!focus.length && <Empty icon={<Check />} title="All caught up" />}</ul><Button variant="ghost" size="sm" asChild className="mt-2 w-full text-primary"><Link to="/follow-ups">All follow-ups<ArrowUpRight /></Link></Button></section>
    </div>
    <div className="mt-8 grid gap-8 xl:grid-cols-[1.4fr_1fr]">
      <section className="surface"><div className="mb-4 flex justify-between"><h2 className="flex items-center gap-2 text-base font-bold"><Target className="size-4 text-primary" />High-priority opportunities</h2><Link to="/leads" className="text-xs text-primary">View all</Link></div><div className="divide-y">{hot.map(l=><div key={l.id} className="flex flex-wrap items-center justify-between gap-3 py-4"><Link to="/leads/$id" params={{id:l.id}}><Identity name={l.name} company={l.company} /></Link><div className="flex items-center gap-3"><PriorityBadge p={l.priority} /><span className="num text-sm font-bold">{formatINRCompact(l.quotedAmount??0)}</span><Button variant="ghost" size="icon" asChild><a href={`tel:${l.phone}`} title={`Call ${l.name}`} onClick={()=>addActivity(l.id,"Called from Dashboard","call")}><Phone className="text-muted-foreground" /></a></Button></div></div>)}</div></section>
      <section className="surface"><h2 className="mb-5 flex items-center gap-2 text-base font-bold"><Activity className="size-4 text-teal" />Recent activity</h2><ol className="grid gap-5">{[...activities].sort((a,b)=>b.at.localeCompare(a.at)).slice(0,5).map(a=><li key={a.id} className="flex gap-3"><div className="mt-1 grid size-7 shrink-0 place-items-center rounded-full bg-primary-soft text-primary">{a.type==="payment"?<Wallet className="size-3" />:a.type==="status"?<Trophy className="size-3" />:<Activity className="size-3" />}</div><div className="min-w-0"><Link to="/leads/$id" params={{id:a.leadId}} className="text-xs font-semibold hover:text-primary">{leads.find(l=>l.id===a.leadId)?.name??"Lead"}</Link><p className="mt-0.5 text-xs text-muted-foreground">{a.text}</p><span className="mt-1 block text-[10px] text-muted-foreground">{relative(a.at)}</span></div></li>)}</ol></section>
    </div><AddLeadDialog open={add} onOpenChange={setAdd} />
  </Shell>;
}
