import { WhatsAppButton } from "@/components/crm/WhatsAppComposer";
import { openCallLog } from "@/components/crm/PostCallDialog";
import { CallButton } from "@/components/crm/CallButton";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, Phone, MessageCircle, Mail, CalendarPlus, Check, Pencil } from "lucide-react";
import { Shell, PriorityBadge, selectCls, Identity } from "@/components/crm/Shell";
import { FollowUpDialog, LostReasonDialog } from "@/components/crm/Dialogs";
import { useCRM } from "@/lib/crm/store";
import { formatINR, formatDateTime, relative, digits } from "@/lib/crm/format";
import { LEAD_SOURCES, LEAD_STATUSES, STATUS_LABEL, FOLLOWUP_LABEL, type Lead, type LeadStatus } from "@/lib/crm/types";
import { QUICK_STATUSES, QUICK_LABEL, staleDays, type QuickStatus } from "@/lib/crm/leadtools";
import { useNavigate } from "@tanstack/react-router";
import { SuggestionList } from "@/components/crm/Suggestions";
import { useAccess, STAGE_DENIED } from "@/lib/crm/session";
import { leadEditError } from "@/lib/crm/validation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { AdditionalInfo, TagPicker } from "@/components/crm/Customize";

export const Route = createFileRoute("/leads_/$id")({
  head: () => ({
    meta: [
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { title: "Lead details · Scale Flow CRM" },
      { name: "description", content: "Lead profile, activity timeline and follow-ups." },
      { property: "og:title", content: "Lead details · Scale Flow CRM" },
      { property: "og:description", content: "Lead profile, activity timeline and follow-ups." },
    ],
  }),
  component: LeadDetail,
});

function LeadDetail() {
  const { id } = Route.useParams();
  const { leads, activities, followUps, deals, updateLead, completeFollowUp, addActivity, setQuickStatus, wasteLead, deleteLead } = useCRM();
  const navigate = useNavigate();
  const { can } = useAccess();
  const lead = leads.find((l) => l.id === id);
  const [edit, setEdit] = useState(false);
  const [fu, setFu] = useState(false);
  const [lost, setLost] = useState(false);
  const [note, setNote] = useState("");
  if (!lead) return <Shell title="Lead not found"><Link to="/leads" className="text-primary">Back to leads</Link></Shell>;
  const acts = activities.filter((a) => a.leadId === id);
  const fus = followUps.filter((f) => f.leadId === id).sort((a, b) => a.dueAt.localeCompare(b.dueAt));
  const leadDeals = deals.filter((d) => d.leadId === id);
  const canStage = can("pipeline.edit") || can("leads.edit");
  const setStatus = (s: LeadStatus) => (!canStage ? void toast.error(STAGE_DENIED) : s === "lost" ? setLost(true) : updateLead(id, { status: s }));

  return (
    <Shell title={lead.name} subtitle={[lead.company, STATUS_LABEL[lead.status]].filter(Boolean).join(" · ")}
      actions={<div className="flex flex-wrap gap-2">
        <CallButton leadId={id} phone={lead.phone} name={lead.name} source="Lead detail" className="h-9 px-4" /><Button variant="outline" onClick={() => openCallLog(id, "Lead detail")}>Log call</Button>
        <WhatsAppButton leadId={id} name={lead.name} source="Lead detail" label className="h-9 px-4" />
        <Button onClick={() => setFu(true)}><CalendarPlus className="size-4" />Follow-up</Button>
      </div>}>
      <Link to="/leads" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" />All leads</Link>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="grid gap-5">
          <div className="mb-2 border-b pb-5"><Identity name={lead.name} company={lead.company} className="[&_.identity-avatar]:size-14 [&_.identity-avatar]:text-lg" /></div>
          <section className="surface p-5">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-semibold">Details</h2>
              {!edit && can("leads.edit") && <Button size="sm" variant="ghost" onClick={() => setEdit(true)}><Pencil className="size-4" />Edit</Button>}
            </div>
            {edit ? <EditLead lead={lead} onDone={() => setEdit(false)} /> : (
              <dl className="grid gap-6 text-sm sm:grid-cols-3">
                {[["Phone", lead.phone], ["Email", lead.email ?? "—"], ["Source", lead.source], ["Budget", formatINR(lead.budget)], ["Quoted", formatINR(lead.quotedAmount)], ["Score", lead.aiScore ?? "—"], ["Last contact", relative(lead.lastContact)], ["Next follow-up", formatDateTime(lead.nextFollowUp)], ["Requirement", lead.requirement ?? "—"]].map(([k, v]) => (
                  <div key={k as string}><dt className="text-xs text-muted-foreground">{k}</dt><dd className="mt-0.5 break-words font-medium">{v}</dd></div>
                ))}
                {lead.lostReason && <div className="sm:col-span-3"><dt className="text-xs text-muted-foreground">Lost reason</dt><dd className="mt-0.5 font-medium text-destructive">{lead.lostReason}</dd></div>}
                {lead.notes && <div className="sm:col-span-3"><dt className="text-xs text-muted-foreground">Notes</dt><dd className="mt-0.5 whitespace-pre-line">{lead.notes}</dd></div>}
              </dl>
            )}
            <div className="mt-5 flex flex-wrap items-center gap-2 border-t pt-4"><span className="text-xs text-muted-foreground">Tags</span><TagPicker leadId={lead.id} /></div>
            <AdditionalInfo leadId={lead.id} compact />
          </section>
          <section className="surface p-5">
            <h2 className="mb-3 font-semibold">Activity</h2>
            <form className="mb-4 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (!note.trim()) return; addActivity(id, note.trim()); setNote(""); }}>
              <Input placeholder="Log a note or call outcome…" value={note} onChange={(e) => setNote(e.target.value)} /><Button type="submit" variant="outline">Log</Button>
            </form>
            <ol className="relative grid gap-4 border-l pl-5">
              {acts.map((a) => (
                <li key={a.id} className="text-sm"><span className="absolute -left-[5px] mt-1.5 size-2.5 rounded-full border-2 border-card bg-primary" /><div>{a.text}</div><div className="text-xs text-muted-foreground">{formatDateTime(a.at)}</div></li>
              ))}
            </ol>
          </section>
        </div>
        <div className="grid content-start gap-5">
          <section className="surface p-5">
            <div className="mb-3 flex items-center justify-between"><h2 className="font-semibold">Stage</h2><PriorityBadge p={lead.priority} /></div>
            <select aria-label="Stage" disabled={!canStage} title={canStage ? undefined : STAGE_DENIED} className={`${selectCls} w-full`} value={lead.status} onChange={(e) => setStatus(e.target.value as LeadStatus)}>{LEAD_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}</select>
            <h3 className="mt-4 mb-2 text-xs font-semibold text-muted-foreground">Quick status <span className="font-normal">(does not change stage)</span></h3>
            <div className="flex flex-wrap gap-1.5">{QUICK_STATUSES.map((q) => <button key={q} type="button" aria-pressed={lead.quickStatus === q} onClick={() => setQuickStatus(id, lead.quickStatus === q ? undefined : (q as QuickStatus))} className={`rounded-full border px-2.5 py-1 text-xs ${lead.quickStatus === q ? "border-primary bg-primary-soft text-primary" : "text-muted-foreground"}`}>{QUICK_LABEL[q]}</button>)}</div>
            {staleDays(lead, new Date()) !== undefined && <p className="mt-3 rounded-lg bg-warning/15 p-2 text-xs text-warning">Stale — no contact for {staleDays(lead, new Date())} days and no upcoming follow-up.</p>}
            {can("leads.delete") && <div className="mt-4 flex gap-2 border-t pt-4">
              <Button size="sm" variant="outline" className="flex-1" onClick={() => { const r = window.prompt("Reason for moving to Waste (optional)") ; if (r === null) return; wasteLead(id, r.trim() || undefined); toast.success("Moved to Waste"); navigate({ to: "/leads" }); }}>Move to Waste</Button>
              <Button size="sm" variant="ghost" className="flex-1 text-destructive" onClick={() => { deleteLead(id); toast.success("Deleted — restore from Recently Deleted"); navigate({ to: "/leads" }); }}>Delete</Button>
            </div>}
          </section>
          <section className="surface p-5">
            <h2 className="mb-3 font-semibold">Follow-ups</h2>
            <div className="mb-3"><SuggestionList leadId={id} /></div>
            {fus.length === 0 && <p className="text-sm text-muted-foreground">None scheduled.</p>}
            <ul className="grid gap-2">
              {fus.map((f) => (
                <li key={f.id} className="flex items-center justify-between gap-2 rounded-lg border p-2.5 text-sm">
                  <div><div className={f.completedAt || f.cancelledAt ? "text-muted-foreground line-through" : "font-medium"}>{FOLLOWUP_LABEL[f.type]} · {formatDateTime(f.dueAt)}{f.cancelledAt ? " · replaced" : f.completedAt ? " · done" : ""}</div>{f.note && <div className="text-xs text-muted-foreground">{f.note}</div>}</div>
                  {!f.completedAt && !f.cancelledAt && <Button size="sm" variant="ghost" aria-label="Complete" onClick={() => { completeFollowUp(f.id); toast.success("Follow-up completed"); }}><Check className="size-4" /></Button>}
                </li>
              ))}
            </ul>
          </section>
          {leadDeals.length > 0 && (
            <section className="surface p-5">
              <h2 className="mb-3 font-semibold">Deals</h2>
              {leadDeals.map((d) => <Link key={d.id} to="/deals" className="block rounded-lg border p-2.5 text-sm hover:border-primary"><div className="font-medium">{d.name}</div><div className="num text-xs text-muted-foreground">{formatINR(d.finalAmount)}</div></Link>)}
            </section>
          )}
          {lead.email && <Button variant="outline" asChild><a href={`mailto:${lead.email}`}><Mail className="size-4" />Email {lead.email}</a></Button>}
        </div>
      </div>
      <FollowUpDialog open={fu} onOpenChange={setFu} leadId={id} />
      <LostReasonDialog open={lost} leadName={lead.name} onCancel={() => setLost(false)} onConfirm={(r) => { updateLead(id, { status: "lost", lostReason: r }); setLost(false); }} />
    </Shell>
  );
}

function EditLead({ lead, onDone }: { lead: Lead; onDone: () => void }) {
  const { updateLead, leads } = useCRM();
  const [f, setF] = useState({ name: lead.name, phone: lead.phone, email: lead.email ?? "", company: lead.company ?? "", requirement: lead.requirement ?? "", source: lead.source, priority: lead.priority, budget: String(lead.budget ?? ""), quotedAmount: String(lead.quotedAmount ?? ""), notes: lead.notes ?? "" });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const save = () => {
    const error = leadEditError(leads, lead.id, { ...f, budget: Number(f.budget), quotedAmount: Number(f.quotedAmount) });
    if (error) { toast.error(error); return; }
    updateLead(lead.id, { name: f.name, phone: f.phone, email: f.email, company: f.company, requirement: f.requirement, source: f.source, priority: f.priority, budget: Number(f.budget) || 0, quotedAmount: Number(f.quotedAmount) || 0, notes: f.notes });
    toast.success("Lead updated"); onDone();
  };
  const inp = (k: keyof typeof f, label: string, type = "text") => <div className="grid gap-1.5"><Label htmlFor={`edit-${k}`}>{label}</Label><Input id={`edit-${k}`} type={type} value={f[k]} onChange={set(k)} /></div>;
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {inp("name", "Name")}{inp("phone", "Phone")}{inp("email", "Email", "email")}{inp("company", "Company")}
      <div className="sm:col-span-2">{inp("requirement", "Requirement")}</div>
      {inp("budget", "Budget (₹)", "number")}{inp("quotedAmount", "Quoted (₹)", "number")}
      <div className="grid gap-1.5"><Label>Source</Label><select className={selectCls} value={f.source} onChange={set("source")}>{LEAD_SOURCES.map((s) => <option key={s}>{s}</option>)}</select></div>
      <div className="grid gap-1.5"><Label>Priority</Label><select className={selectCls} value={f.priority} onChange={set("priority")}><option value="hot">Hot</option><option value="warm">Warm</option><option value="cold">Cold</option></select></div>
      <div className="grid gap-1.5 sm:col-span-2"><Label>Notes</Label><Textarea value={f.notes} onChange={set("notes")} /></div>
      <div className="flex justify-end gap-2 sm:col-span-2"><Button variant="ghost" onClick={onDone}>Cancel</Button><Button onClick={save}>Save changes</Button></div>
    </div>
  );
}
