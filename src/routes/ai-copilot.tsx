import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { Sparkles, Send, Trash2, X, Loader2, AlertCircle, RotateCcw, FlaskConical, ShieldCheck, Lock, UserRound } from "lucide-react";
import { Shell, Empty, selectCls } from "@/components/crm/Shell";
import { useCRM } from "@/lib/crm/store";
import { useAccess, allows } from "@/lib/crm/session";
import { openWhatsApp } from "@/components/crm/WhatsAppComposer";
import { openCallLog } from "@/components/crm/PostCallDialog";
import { FollowUpDialog } from "@/components/crm/Dialogs";
import { SalesCoachPanel } from "@/components/ai/SalesCoachPanel";
import { onRovingKeyDown, roving } from "@/lib/a11y/tabKeys";
import { LeadIntelligencePanel } from "@/components/ai/LeadIntelligencePanel";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { uid } from "@/lib/crm/format";
import { buildLeadContext } from "@/lib/ai/context";
import { getProvider, SUGGESTED_QUESTIONS, AI_MODULES } from "@/lib/ai/demoProvider";
import { useCopilot, selectLead, clearConversation } from "@/lib/ai/copilotStore";
import type { AIError, AIModuleId, SuggestedAction } from "@/lib/ai/types";

type CopilotSearch = { lead?: string; tab?: "coach" };

export const Route = createFileRoute("/ai-copilot")({
  validateSearch: (s: Record<string, unknown>): CopilotSearch => ({ ...(typeof s["lead"] === "string" ? { lead: s["lead"] } : {}), ...(s["tab"] === "coach" ? { tab: "coach" as const } : {}) }),
  head: () => ({
    meta: [
      { title: "AI Sales Copilot · Scale Flow Sales OS" },
      { name: "description", content: "Ask sales questions about a lead using only the CRM details you're allowed to see. Demo Mode, simulated answers." },
      { property: "og:title", content: "AI Sales Copilot · Scale Flow Sales OS" },
      { property: "og:description", content: "Permission-aware sales assistant workspace with clearly labelled simulated answers." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: CopilotPage,
});

function CopilotPage() {
  const { lead: leadParam, tab } = Route.useSearch();
  const coach = tab === "coach";
  const navigate = useNavigate();
  const { preview } = useAccess();
  const src = useCRM(useShallow((s) => ({ leads: s.leads, activities: s.activities, followUps: s.followUps, deals: s.deals, payments: s.payments, assignments: s.assignments })));
  const { leadId, messages, pending, error } = useCopilot();
  const [q, setQ] = useState("");
  const [fuFor, setFuFor] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const provider = getProvider();
  const status = provider.status();

  useEffect(() => { selectLead(leadParam ?? null); }, [leadParam]);
  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [messages.length, pending]);

  const ctx = useMemo(() => (leadId ? buildLeadContext(src, leadId, preview) : null), [src, leadId, preview]);
  const lead = ctx?.ok ? ctx.lead : undefined;
  const setLead = (id: string | null) => void navigate({ to: "/ai-copilot", search: { ...(id ? { lead: id } : {}), ...(coach ? { tab: "coach" as const } : {}) }, replace: true });
  const setTab = (c: boolean) => void navigate({ to: "/ai-copilot", search: { ...(leadId ? { lead: leadId } : {}), ...(c ? { tab: "coach" as const } : {}) }, replace: true });

  const ask = async (question: string, module: AIModuleId | "general" = "general") => {
    const text = question.trim();
    if (!text || pending) return;
    const forLead = lead?.leadId;
    useCopilot.setState((s) => ({ messages: [...s.messages, { id: uid("m"), role: "user", text, ...(forLead ? { leadId: forLead } : {}) }], pending: true, error: null }));
    setQ("");
    try {
      const res = await provider.ask({ id: uid("req"), module, question: text, at: new Date().toISOString(), context: { ...(lead ? { lead } : {}), viewer: { role: preview ? "employee" : "owner", name: preview?.name ?? "Owner" } } });
      if (useCopilot.getState().leadId !== (forLead ?? leadId)) return; // lead switched mid-request: drop stale answer
      useCopilot.setState((s) => ({ messages: [...s.messages, { id: uid("m"), role: "assistant", res, ...(forLead ? { leadId: forLead } : {}) }], pending: false }));
    } catch (e) {
      const err = e as AIError;
      useCopilot.setState({ pending: false, error: { code: err.code ?? "unknown", message: err.message ?? "Something went wrong.", retryable: err.retryable ?? true, question: text } });
    }
  };
  const retry = () => { if (!error) return; const qq = error.question; useCopilot.setState((s) => ({ messages: s.messages.slice(0, -1), error: null })); void ask(qq); };

  const runAction = (a: SuggestedAction) => {
    if (!a.leadId) return;
    if (a.kind === "open_lead") void navigate({ to: "/leads/$id", params: { id: a.leadId } });
    if (a.kind === "draft_whatsapp") openWhatsApp(a.leadId, "AI Copilot");
    if (a.kind === "log_call") openCallLog(a.leadId, "AI Copilot");
    if (a.kind === "schedule_followup") setFuFor(a.leadId);
  };
  const actionAllowed = (a: SuggestedAction) => a.kind === "open_lead" || a.kind === "draft_whatsapp" || (a.kind === "log_call" ? allows(preview, "clients.calls") : allows(preview, "followups.create"));

  return (
    <Shell title="AI Sales Copilot" subtitle="Ask about a lead using only what you're allowed to see">
      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-dashed bg-muted/40 px-3 py-2 text-xs" role="status" data-testid="demo-badge">
        <FlaskConical className="size-4 shrink-0" />
        <span className="font-semibold">{status.state === "demo" ? "Demo Mode" : status.state === "live" ? "Live" : "Unavailable"}</span>
        <span className="text-muted-foreground">Answers are simulated examples from fixed rules — no AI model, no internet, nothing sent or changed.</span>
      </div>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="grid min-w-0 content-start gap-5">
        <div role="tablist" aria-label="Copilot view" className="seg w-fit" onKeyDown={onRovingKeyDown}>
          <button type="button" role="tab" aria-selected={!coach} tabIndex={roving(!coach)} onClick={() => setTab(false)}>Copilot</button>
          <button type="button" role="tab" aria-selected={coach} tabIndex={roving(coach)} onClick={() => setTab(true)}>Sales Coach</button>
        </div>
        {coach ? (lead ? <SalesCoachPanel key={lead.leadId} lead={lead} canNote={allows(preview, "leads.edit")} canFollowUp={allows(preview, "followups.create")} onFollowUp={() => setFuFor(lead.leadId)} />
          : <div className="surface p-4"><Empty icon={<Sparkles />} title="Pick a lead to prepare a call" hint={ctx && !ctx.ok ? (ctx.reason === "not_permitted" ? "You don't have access to that lead." : "That lead wasn't found.") : "Choose a lead in Lead context, or use Prepare Call with AI on a lead."} /></div>) : <>
        {lead && <LeadIntelligencePanel key={lead.leadId} lead={lead} phone={src.leads.find((x) => x.id === lead.leadId)?.phone} canFollowUp={allows(preview, "followups.create")} onFollowUp={() => setFuFor(lead.leadId)} />}
        <section className="surface flex min-h-[60dvh] flex-col p-0" aria-label="Conversation">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
            <div className="flex min-w-0 items-center gap-2 text-sm" data-testid="ctx-indicator">
              <UserRound className="size-4 shrink-0 text-muted-foreground" />
              {lead ? <><span className="text-muted-foreground">Analysing</span><span className="truncate font-semibold">{lead.name}</span><Button size="sm" variant="ghost" className="h-7 px-2" aria-label={`Remove ${lead.name} from context`} onClick={() => setLead(null)}><X className="size-3.5" />Remove</Button></>
                : ctx && !ctx.ok ? <span className="flex items-center gap-1.5 text-destructive"><Lock className="size-3.5" />{ctx.reason === "not_permitted" ? "You don't have access to that lead." : "That lead wasn't found."}</span>
                : <span className="text-muted-foreground">No lead selected — general questions only</span>}
            </div>
            <Button size="sm" variant="outline" onClick={clearConversation} disabled={!messages.length && !error}><Trash2 className="size-3.5" />Clear conversation</Button>
          </div>
          <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4" aria-live="polite">
            {!messages.length && !pending && !error && (
              <Empty icon={<Sparkles />} title="Ask a sales question" hint={lead ? `Try one of these about ${lead.name}.` : "Choose a lead in Lead context, or ask something general."}
                action={<div className="flex flex-wrap justify-center gap-2">{SUGGESTED_QUESTIONS.filter((s) => lead || s.module === "general").map((s) => <Button key={s.text} size="sm" variant="outline" className="rounded-full" onClick={() => void ask(s.text, s.module)}>{s.text}</Button>)}</div>} />
            )}
            {messages.map((m) => m.role === "user"
              ? <div key={m.id} className="ml-auto max-w-[85%] rounded-2xl bg-primary px-4 py-2.5 text-sm text-primary-foreground">{m.text}</div>
              : <div key={m.id} className="max-w-[92%] rounded-2xl border bg-card px-4 py-3" data-testid="ai-answer">
                  <div className="eyebrow mb-1.5 flex items-center gap-1.5"><FlaskConical className="size-3" />{m.res.providerLabel}</div>
                  <p className="text-sm leading-relaxed whitespace-pre-line">{m.res.text}</p>
                  {m.res.suggestions.length > 0 && <div className="mt-3 flex flex-wrap gap-2">{m.res.suggestions.filter(actionAllowed).map((a) => <Button key={a.id} size="sm" variant="outline" className="rounded-full" onClick={() => runAction(a)}>{a.label}</Button>)}</div>}
                </div>)}
            {pending && <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />Preparing a demo answer…</div>}
            {error && <div role="alert" className="flex flex-wrap items-center gap-2 rounded-xl border border-destructive/40 px-3 py-2 text-sm text-destructive"><AlertCircle className="size-4" />{error.message}{error.retryable && <Button size="sm" variant="outline" onClick={retry}><RotateCcw className="size-3.5" />Try again</Button>}</div>}
            <div ref={endRef} />
          </div>
          <form className="border-t p-3" onSubmit={(e) => { e.preventDefault(); void ask(q); }}>
            <div className="flex items-end gap-2">
              <Textarea aria-label="Your question" rows={2} value={q} maxLength={1000} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void ask(q); } }} placeholder={lead ? `Ask about ${lead.name}…` : "Ask a sales question…"} className="min-h-[44px] flex-1 resize-none" />
              <Button type="submit" disabled={!q.trim() || pending} aria-label="Send question" className="h-11"><Send className="size-4" /></Button>
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">AI-generated content can be wrong. Check details before acting — suggestions never change your CRM until you choose to.</p>
          </form>
        </section>
        </>}
        </div>
        <aside className="grid content-start gap-4">
          <div className="surface p-4">
            <label className="eyebrow mb-2 block" htmlFor="ai-lead">Lead context</label>
            <select id="ai-lead" className={cn(selectCls, "w-full")} value={lead?.leadId ?? ""} onChange={(e) => setLead(e.target.value || null)}>
              <option value="">No lead</option>
              {src.leads.slice(0, 500).map((l) => <option key={l.id} value={l.id}>{l.name}{l.company ? ` · ${l.company}` : ""}</option>)}
            </select>
            {lead && <dl className="mt-3 grid gap-1.5 text-xs" data-testid="ctx-fields">
              <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Stage</dt><dd>{lead.stage}</dd></div>
              <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Priority</dt><dd>{lead.priority}</dd></div>
              <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Recent activity</dt><dd>{lead.recentActivity.length} items</dd></div>
              <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Amounts</dt><dd>{lead.money ? "Included" : "Hidden"}</dd></div>
            </dl>}
            {lead && <div className="mt-3 text-[11px] text-muted-foreground"><div className="mb-1 flex items-center gap-1 font-semibold text-foreground"><ShieldCheck className="size-3.5" />Never included</div><ul className="list-disc pl-4" data-testid="ctx-excluded">{lead.excluded.map((x) => <li key={x}>{x}</li>)}</ul></div>}
            {lead && <Button asChild size="sm" variant="ghost" className="mt-2 px-0"><Link to="/leads/$id" params={{ id: lead.leadId }}>Open lead</Link></Button>}
          </div>
          <div className="surface p-4">
            <div className="eyebrow mb-2">Copilot tools</div>
            <ul className="grid gap-1.5 text-sm">{AI_MODULES.map((m) => <li key={m.id} className="flex justify-between gap-2"><span>{m.label}</span><span className="text-xs text-muted-foreground">{m.available ? "Demo" : "Coming later"}</span></li>)}</ul>
          </div>
        </aside>
      </div>
      {fuFor && <FollowUpDialog open onOpenChange={(o) => !o && setFuFor(null)} leadId={fuFor} />}
    </Shell>
  );
}
