import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, Archive, Copy, FlaskConical, History, Info, Pause, Pencil, Play, Plus, RefreshCw, Search, Workflow } from "lucide-react";
import { Shell, selectCls, Empty } from "@/components/crm/Shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useCRM, automationCtxOf, automationIssues, projectCtxOf, viewCtxOf } from "@/lib/crm/store";
import { ConditionBuilder } from "@/components/crm/Customize";
import { describeCondition, filterFields, type FilterField, type ViewCondition } from "@/lib/crm/customize";
import { projectFilterFields } from "@/lib/crm/projectCustomize";
import { formatDateTime } from "@/lib/crm/format";
import { LEAD_SOURCES, LEAD_STATUSES, STATUS_LABEL, type LeadPriority, type LeadSource, type LeadStatus } from "@/lib/crm/types";
import { ACTIONS_FOR, LEAD_TRIGGERS, PROJECT_RULE_TEMPLATES, PROJECT_TRIGGERS, TRIGGER_KIND, isProjectTrigger, type RuleSubject, ACTION_LABEL, RULE_TEMPLATES, TRIGGER_LABEL, planRule, ruleConflicts, ruleError, type ActionType, type AutomationRule, type RulePlan, type RunOutcome, type TriggerType } from "@/lib/crm/automation";

export const Route = createFileRoute("/automation")({
  head: () => ({
    meta: [
      { title: "Automation Studio · Scale Flow CRM" },
      { name: "description", content: "Owner-only reminder, escalation and workflow rules with dry runs and execution history." },
      { property: "og:title", content: "Automation Studio · Scale Flow CRM" },
      { property: "og:description", content: "Owner-only reminder, escalation and workflow rules with dry runs and execution history." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AutomationPage,
});

const STATUS_TONE: Record<AutomationRule["status"], string> = { enabled: "bg-success/15 text-success", paused: "bg-warning/15 text-warning", draft: "bg-secondary text-muted-foreground", archived: "bg-secondary text-muted-foreground" };
const STATUS_TEXT: Record<AutomationRule["status"], string> = { enabled: "Enabled", paused: "Paused", draft: "Disabled · draft", archived: "Archived" };
const OUTCOME_TONE: Record<RunOutcome, string> = { triggered: "bg-success/15 text-success", skipped: "bg-secondary text-muted-foreground", evaluated: "bg-secondary text-muted-foreground", failed: "bg-destructive/10 text-destructive", disabled: "bg-warning/15 text-warning" };
const ctxOf = (s: ReturnType<typeof useCRM.getState>) => automationCtxOf(s, new Date());

/** Condition fields for a rule's subject, used to explain conditions in plain language. */
function useRuleFields(): Record<RuleSubject, Map<string, FilterField>> {
  const st = useCRM();
  return { lead: new Map(filterFields(viewCtxOf(st, { owner: true })).map((f) => [f.key, f])), project: new Map(projectFilterFields(projectCtxOf(st)).map((f) => [f.key, f])) };
}
function conditionText(r: AutomationRule, empName: (id: string) => string, fields?: Record<RuleSubject, Map<string, FilterField>>): string[] {
  const c = r.conditions; const out: string[] = [];
  if ((r.subject ?? "lead") === "project") {
    const cs = (c.custom ?? []) as ViewCondition[];
    const parts = fields ? cs.map((x) => describeCondition(x, fields.project)) : [`${cs.length} condition(s)`];
    if (r.trigger === "project_due_soon" || r.trigger === "support_ending") parts.push(`within ${r.settings.withinDays ?? 0} day(s)`);
    return parts.length ? [parts.join(c.customMode === "or" ? " OR " : " AND ")] : ["Every active project"];
  }
  if (c.sources?.length) out.push(`Source: ${c.sources.join(", ")}`);
  if (c.stages?.length) out.push(`Stage: ${c.stages.map((x) => STATUS_LABEL[x]).join(", ")}`);
  if (c.priorities?.length) out.push(`Priority: ${c.priorities.join(", ")}`);
  if (c.employeeId) out.push(`Assigned to ${empName(c.employeeId)}`);
  if (c.assigned && c.assigned !== "any") out.push(c.assigned === "assigned" ? "Assigned" : "Unassigned");
  if (c.inboxStatus && c.inboxStatus !== "any") out.push(c.inboxStatus === "needs_review" ? "Inbox: needs review" : "Inbox: reviewed");
  if (c.firstContactPending) out.push("No contact attempt recorded");
  if (c.custom?.length) out.push(fields ? (c.custom as ViewCondition[]).map((x) => describeCondition(x, fields.lead)).join(c.customMode === "or" ? " OR " : " AND ") : `${c.custom.length} custom field / tag condition${c.custom.length > 1 ? "s" : ""}`);
  if (c.minCreatedMinutes !== undefined) out.push(`Created ≥ ${c.minCreatedMinutes} min ago`);
  if (c.minSinceAttemptMinutes !== undefined) out.push(`Last attempt ≥ ${c.minSinceAttemptMinutes} min ago`);
  if (c.minStageDays !== undefined) out.push(`In stage ≥ ${c.minStageDays} days`);
  if (c.minInactiveHours !== undefined) out.push(`No activity ≥ ${c.minInactiveHours} h`);
  if (r.trigger === "followup_overdue") out.push(`Overdue ≥ ${r.settings.overdueMinutes ?? 0} min`);
  return out.length ? out : ["Every lead"];
}

function AutomationPage() {
  const s = useCRM();
  const [edit, setEdit] = useState<AutomationRule | null>(null);
  const [test, setTest] = useState<AutomationRule | null>(null);
  const [histRule, setHistRule] = useState<string>("all");
  const [showArchived, setShowArchived] = useState(false);
  const empName = (id: string) => s.employees.find((e) => e.id === id)?.name ?? "Employee";
  const rf = useRuleFields();
  const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const runs7 = s.automationRuns.filter((r) => r.at >= weekAgo);
  const rules = s.automationRules.filter((r) => showArchived || r.status !== "archived");
  const lastEval = s.automationRules.map((r) => r.lastEvaluatedAt).filter(Boolean).sort().pop();
  const counts = useMemo(() => { const m = new Map<string, number>(); for (const r of s.reminders) m.set(r.ruleId, (m.get(r.ruleId) ?? 0) + 1); return m; }, [s.reminders]);

  const evaluate = () => { const r = s.runAutomations({ manual: true }); toast.success(`Evaluated — ${r.created} new reminder${r.created === 1 ? "" : "s"}, ${r.resolved} updated`); };
  const useTemplate = (id: string) => { const nid = s.addRuleFromTemplate(id); const r = useCRM.getState().automationRules.find((x) => x.id === nid); if (r) setEdit(r); toast.success("Template added as a disabled draft"); };

  return (
    <Shell title="Automation Studio" subtitle="Owner-only reminders, escalations and workflow rules." actions={<Button onClick={evaluate}><RefreshCw className="size-4" />Evaluate now</Button>}>
      <div role="note" className="mb-5 flex gap-2 rounded-lg border bg-secondary/60 p-3 text-xs text-muted-foreground">
        <Info className="mt-0.5 size-4 shrink-0" />
        <span>Rules run in this browser only while the CRM is open — when it opens, when you return to the tab, after changes, and every 5 minutes. There is no 24/7 scheduler and no alerts on other devices yet. Automations never message customers, delete records or change money.</span>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-5">
        {([["Enabled rules", s.automationRules.filter((r) => r.status === "enabled").length], ["Open reminders", s.reminders.filter((r) => r.status === "open").length], ["Triggered · 7 days", runs7.filter((r) => r.outcome === "triggered").length], ["Failed · 7 days", runs7.filter((r) => r.outcome === "failed").length], ["Last evaluated", lastEval ? formatDateTime(lastEval) : "Never"]] as const).map(([k, v]) => (
          <div key={k} className="kpi" data-tone={k.startsWith("Failed") && Number(v) > 0 ? "alert" : undefined}><span className="kpi-label">{k}</span><span className={`kpi-value num ${typeof v === "string" ? "!text-base" : ""}`}>{v}</span></div>
        ))}
      </div>

      <section className="mb-6">
        <div className="mb-2 flex items-center justify-between"><h2 className="font-semibold">Rules</h2><div className="flex items-center gap-2"><label className="flex items-center gap-1.5 text-xs text-muted-foreground"><input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />Show archived</label><Button size="sm" variant="outline" onClick={() => setEdit(blankRule())}><Plus className="size-3.5" />New rule</Button></div></div>
        {rules.length === 0 ? <div className="surface"><Empty icon={<Workflow />} title="No rules yet" hint="Start from a template below. Templates are added disabled so you can test them first." /></div> : (
          <div className="grid gap-3 lg:grid-cols-2">
            {rules.map((r) => {
              const err = ruleError(r); const conflicts = ruleConflicts(r, s.automationRules);
              const scope = planRule(r, ctxOf(s), s.reminders).matched;
              return (
                <article key={r.id} className="surface p-4" aria-label={r.name}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0"><h3 className="font-semibold">{r.name}</h3><p className="text-xs text-muted-foreground">{r.description}</p></div>
                    <span className="flex shrink-0 gap-1"><span className="rounded-md bg-secondary px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">{(r.subject ?? "lead") === "project" ? "Project" : "Lead"}</span><span className={`rounded-md px-2 py-0.5 text-[10px] font-semibold ${STATUS_TONE[r.status]}`}>{STATUS_TEXT[r.status]}</span></span>
                  </div>
                  <dl className="mt-3 grid gap-1 text-xs">
                    <div><dt className="inline font-semibold">WHEN </dt><dd className="inline">{TRIGGER_LABEL[r.trigger]}{isProjectTrigger(r.trigger) ? ` · ${TRIGGER_KIND[r.trigger] === "event" ? "recorded event" : "checked on every evaluation"}` : ""}</dd></div>
                    <div><dt className="inline font-semibold">IF </dt><dd className="inline">{conditionText(r, empName, rf).join(" · ")}</dd></div>
                    {r.pausedReason && <div className="flex items-center gap-1.5 text-warning"><AlertTriangle className="size-3.5" />{r.pausedReason}</div>}
                    {(() => { const iss = automationIssues(s, r); return iss.length ? <div className="flex items-center gap-1.5 text-warning"><AlertTriangle className="size-3.5" />Won't run: {iss[0]!.text}</div> : null; })()}
                    <div><dt className="inline font-semibold">THEN </dt><dd className="inline">{r.actions.map((a) => ACTION_LABEL[a]).join(" · ")}{r.settings.escalateOwnerAfterMinutes !== undefined ? ` · escalate to Owner after ${r.settings.escalateOwnerAfterMinutes} min` : ""}</dd></div>
                  </dl>
                  <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
                    <span>Matches now: <b className="num text-foreground">{scope}</b></span>
                    <span>Reminders generated: <b className="num text-foreground">{counts.get(r.id) ?? 0}</b></span>
                    <span>Last evaluated: {r.lastEvaluatedAt ? formatDateTime(r.lastEvaluatedAt) : "never"}</span>
                    <span>Last triggered: {r.lastTriggeredAt ? formatDateTime(r.lastTriggeredAt) : "never"}</span>
                    <span>Cooldown {r.settings.cooldownHours} h</span>
                  </div>
                  {(err || conflicts.length > 0) && <ul className="mt-2 grid gap-1 rounded-md bg-warning/10 p-2 text-[11px] text-warning">{[err, ...conflicts].filter(Boolean).map((w) => <li key={w} className="flex gap-1.5"><AlertTriangle className="size-3.5 shrink-0" />{w}</li>)}</ul>}
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    <Button size="sm" variant="outline" onClick={() => setTest(r)}><FlaskConical className="size-3.5" />Test rule</Button>
                    {r.status === "enabled"
                      ? <Button size="sm" variant="outline" onClick={() => { s.setAutomationStatus(r.id, "paused"); toast.success("Rule paused — it won't run until enabled again"); }}><Pause className="size-3.5" />Pause</Button>
                      : r.status !== "archived" && <Button size="sm" onClick={() => setTest(r)}><Play className="size-3.5" />Enable…</Button>}
                    <Button size="sm" variant="ghost" onClick={() => setEdit(r)}><Pencil className="size-3.5" />Edit</Button>
                    <Button size="sm" variant="ghost" onClick={() => { s.duplicateAutomationRule(r.id); toast.success("Duplicated as a disabled draft"); }}><Copy className="size-3.5" />Duplicate</Button>
                    {r.status !== "archived" ? <Button size="sm" variant="ghost" onClick={() => { s.setAutomationStatus(r.id, "archived"); toast.success("Archived — history is kept"); }}><Archive className="size-3.5" />Archive</Button> : <Button size="sm" variant="ghost" onClick={() => s.setAutomationStatus(r.id, "draft")}>Restore</Button>}
                    <Button size="sm" variant="ghost" onClick={() => { setHistRule(r.id); document.getElementById("auto-history")?.scrollIntoView({ behavior: "smooth" }); }}><History className="size-3.5" />History</Button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section className="mb-6">
        <h2 className="mb-2 font-semibold">Rule templates</h2>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {[...RULE_TEMPLATES, ...PROJECT_RULE_TEMPLATES].map((t) => (
            <div key={t.templateId} className="surface flex flex-col p-3">
              <div className="text-sm font-semibold">{t.name}<span className="ml-1.5 rounded-md bg-secondary px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">{t.subject === "project" ? "Project" : "Lead"}</span></div>
              <p className="mt-0.5 flex-1 text-xs text-muted-foreground">{t.description}</p>
              <Button size="sm" variant="outline" className="mt-2 self-start" onClick={() => useTemplate(t.templateId)}><Plus className="size-3.5" />Use template</Button>
            </div>
          ))}
        </div>
      </section>

      <section className="mb-6 grid gap-3 lg:grid-cols-2">
        <div className="surface p-4">
          <h2 className="mb-2 font-semibold">Automation settings</h2>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={s.automationSettings.autoEvaluate} onChange={(e) => s.setAutomationSettings({ autoEvaluate: e.target.checked })} />Evaluate automatically while the CRM is open</label>
          <label className="mt-2 flex items-center gap-2 text-sm"><input type="checkbox" checked={s.automationSettings.notifyOwnerOnEscalation} onChange={(e) => s.setAutomationSettings({ notifyOwnerOnEscalation: e.target.checked })} />Show escalations in my notifications</label>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <div className="grid gap-1"><Label htmlFor="max-run">Max actions per run</Label><Input id="max-run" type="number" min={1} value={s.automationSettings.maxActionsPerRun} onChange={(e) => s.setAutomationSettings({ maxActionsPerRun: Math.max(1, Number(e.target.value) || 1) })} /></div>
            <div className="grid gap-1"><Label htmlFor="confirm-n">Confirm when enabling affects more than</Label><Input id="confirm-n" type="number" min={1} value={s.automationSettings.bulkConfirmThreshold} onChange={(e) => s.setAutomationSettings({ bulkConfirmThreshold: Math.max(1, Number(e.target.value) || 1) })} /></div>
          </div>
        </div>
        <div className="surface p-4">
          <h2 className="mb-1 font-semibold">Lead assignment rules</h2>
          <p className="text-xs text-muted-foreground">Assignment rules stay a separate engine in Team Management and are shown here from the same saved settings — nothing is copied or switched on.</p>
          <p className="mt-2 text-sm"><b className="num">{s.assignmentRules.filter((r) => r.enabled).length}</b> enabled of <b className="num">{s.assignmentRules.length}</b></p>
          <Button size="sm" variant="outline" className="mt-2" asChild><Link to="/team">Open assignment rules</Link></Button>
        </div>
      </section>

      <HistoryTable ruleId={histRule} setRuleId={setHistRule} />

      {edit && <RuleEditor initial={edit} onClose={() => setEdit(null)} />}
      {test && <DryRun rule={test} onClose={() => setTest(null)} />}
    </Shell>
  );
}

function blankRule(): AutomationRule {
  return { id: `auto_${Math.random().toString(36).slice(2, 10)}`, name: "", description: "", status: "draft", trigger: "inactivity", conditions: { minInactiveHours: 24 }, actions: ["reminder"], settings: { cooldownHours: 24 }, createdAt: "", updatedAt: "", version: 0 };
}

function HistoryTable({ ruleId, setRuleId }: { ruleId: string; setRuleId: (v: string) => void }) {
  const { automationRuns, automationRules, leads, projects } = useCRM();
  const [outcome, setOutcome] = useState<"all" | RunOutcome>("all");
  const [q, setQ] = useState(""); const [page, setPage] = useState(0); const PER = 25;
  const name = (id?: string, pid?: string) => (pid ? projects.find((p) => p.id === pid)?.name ?? "Removed project" : id ? leads.find((l) => l.id === id)?.name ?? "Removed lead" : "");
  const list = automationRuns.filter((r) => (ruleId === "all" || r.ruleId === ruleId) && (outcome === "all" || r.outcome === outcome) && (!q.trim() || `${r.ruleName} ${name(r.leadId, r.projectId)} ${r.error ?? ""} ${r.actions.join(" ")}`.toLowerCase().includes(q.trim().toLowerCase())));
  return (
    <section id="auto-history" className="surface p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="mr-auto font-semibold">Automation history</h2>
        <div className="relative"><Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" /><Input aria-label="Search history" className="h-9 w-48 pl-8" value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} placeholder="Search" /></div>
        <select aria-label="Rule" className={selectCls} value={ruleId} onChange={(e) => { setRuleId(e.target.value); setPage(0); }}><option value="all">All rules</option>{automationRules.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select>
        <select aria-label="Outcome" className={selectCls} value={outcome} onChange={(e) => { setOutcome(e.target.value as typeof outcome); setPage(0); }}><option value="all">All outcomes</option>{(["evaluated", "triggered", "skipped", "failed", "disabled"] as const).map((o) => <option key={o} value={o} className="capitalize">{o}</option>)}</select>
      </div>
      {list.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">No runs recorded yet. Automatic checks only log runs that created or failed something; "Evaluate now" logs every rule.</p> : (
        <div className="overflow-x-auto"><table className="w-full text-sm">
          <thead><tr className="text-left text-xs text-muted-foreground"><th className="py-1.5 pr-3 font-medium">When</th><th className="py-1.5 pr-3 font-medium">Rule</th><th className="py-1.5 pr-3 font-medium">Outcome</th><th className="py-1.5 pr-3 font-medium">Matched</th><th className="py-1.5 pr-3 font-medium">Actions</th><th className="py-1.5 font-medium">Skipped dupes</th></tr></thead>
          <tbody>{list.slice(page * PER, page * PER + PER).map((r) => (
            <tr key={r.id} className="border-t align-top">
              <td className="whitespace-nowrap py-1.5 pr-3 text-xs">{formatDateTime(r.at)}{r.manual ? " · manual" : ""}</td>
              <td className="py-1.5 pr-3">{r.ruleName}{(r.leadId || r.projectId) && <div className="text-xs text-muted-foreground">{name(r.leadId, r.projectId)}</div>}</td>
              <td className="py-1.5 pr-3"><span className={`rounded-md px-2 py-0.5 text-[10px] font-semibold capitalize ${OUTCOME_TONE[r.outcome]}`}>{r.outcome}</span></td>
              <td className="num py-1.5 pr-3">{r.matched}</td>
              <td className="py-1.5 pr-3 text-xs">{r.actions.join(", ") || "—"}{r.error && <div className="text-destructive">{r.error}</div>}</td>
              <td className="num py-1.5">{r.skippedDuplicates}</td>
            </tr>))}</tbody>
        </table></div>
      )}
      {list.length > PER && <div className="mt-2 flex justify-end gap-2 text-xs"><Button size="sm" variant="outline" disabled={!page} onClick={() => setPage(page - 1)}>Previous</Button><span className="num self-center">{page + 1}/{Math.ceil(list.length / PER)}</span><Button size="sm" variant="outline" disabled={(page + 1) * PER >= list.length} onClick={() => setPage(page + 1)}>Next</Button></div>}
    </section>
  );
}

const TRIGGERS_FOR: Record<RuleSubject, TriggerType[]> = { lead: LEAD_TRIGGERS, project: PROJECT_TRIGGERS };
function RuleEditor({ initial, onClose }: { initial: AutomationRule; onClose: () => void }) {
  const { saveAutomationRule, employees } = useCRM();
  const [r, setR] = useState<AutomationRule>(initial);
  const c = r.conditions;
  const setC = (p: { [K in keyof AutomationRule["conditions"]]?: AutomationRule["conditions"][K] | undefined }) => setR((x) => ({ ...x, conditions: Object.fromEntries(Object.entries({ ...x.conditions, ...p }).filter(([, v]) => v !== undefined && v !== "" && !(Array.isArray(v) && !v.length))) as AutomationRule["conditions"] }));
  const setS = (p: { [K in keyof AutomationRule["settings"]]?: AutomationRule["settings"][K] | undefined }) => setR((x) => ({ ...x, settings: Object.fromEntries(Object.entries({ ...x.settings, ...p }).filter(([, v]) => v !== undefined)) as unknown as AutomationRule["settings"] }));
  const num = (v: string) => (v === "" ? undefined : Math.max(0, Number(v)));
  const multi = <T extends string>(list: T[] | undefined, v: T, on: boolean) => (on ? [...new Set([...(list ?? []), v])] : (list ?? []).filter((x) => x !== v));
  const subject: RuleSubject = r.subject ?? "lead";
  const ACTIONS = ACTIONS_FOR[subject]; const TRIGGERS = TRIGGERS_FOR[subject];
  const switchSubject = (sub: RuleSubject) => setR((x) => ({ ...x, subject: sub, trigger: TRIGGERS_FOR[sub][0]!, conditions: {}, actions: ["reminder"], settings: { cooldownHours: x.settings.cooldownHours } }));
  const err = ruleError(r);
  const save = () => { const e = saveAutomationRule(r); if (e) { toast.error(e); return; } toast.success(r.status === "enabled" ? "Rule updated" : "Saved — test it, then enable"); onClose(); };
  const chip = (on: boolean) => `rounded-full border px-2.5 py-1 text-xs ${on ? "border-primary bg-primary-soft text-primary" : "text-muted-foreground"}`;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader><DialogTitle>{initial.version ? "Edit rule" : "New rule"}</DialogTitle><DialogDescription>WHEN something happens, IF conditions match, THEN create internal actions. Nothing is sent to clients.</DialogDescription></DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1"><Label htmlFor="r-name">Rule name</Label><Input id="r-name" value={r.name} onChange={(e) => setR({ ...r, name: e.target.value })} /></div>
          <div className="grid gap-1"><Label htmlFor="r-desc">Description</Label><Input id="r-desc" value={r.description} onChange={(e) => setR({ ...r, description: e.target.value })} /></div>
          <div className="grid gap-1"><Label htmlFor="r-subject">Applies to</Label><select id="r-subject" className={selectCls} value={subject} disabled={!!initial.version} onChange={(e) => switchSubject(e.target.value as RuleSubject)}><option value="lead">Leads</option><option value="project">Projects</option></select>{initial.version ? <p className="text-[11px] text-muted-foreground">Fixed once saved — duplicate the rule to change it.</p> : null}</div>
          <div className="grid gap-1"><Label htmlFor="r-when">WHEN</Label><select id="r-when" className={selectCls} value={r.trigger} onChange={(e) => setR({ ...r, trigger: e.target.value as TriggerType })}>{TRIGGERS.map((t) => <option key={t} value={t}>{TRIGGER_LABEL[t]}</option>)}</select>{isProjectTrigger(r.trigger) && <p className="text-[11px] text-muted-foreground">{TRIGGER_KIND[r.trigger] === "event" ? "Reacts to changes recorded after this rule was created." : "Re-checked on every evaluation against today's date."}</p>}</div>
          {subject === "project" ? <fieldset className="grid gap-2 rounded-lg border p-3"><legend className="px-1 text-xs font-semibold">IF</legend>
            <ConditionBuilder entity="project" filter={{ mode: c.customMode ?? "and", conditions: (c.custom ?? []) as ViewCondition[] }} onChange={(f) => setC({ custom: f.conditions.length ? f.conditions : undefined, customMode: f.mode === "or" ? "or" : undefined })} />
            {(r.trigger === "project_due_soon" || r.trigger === "support_ending") && <div className="grid gap-1 sm:max-w-xs"><Label htmlFor="s-within" className="text-xs">{r.trigger === "project_due_soon" ? "Days before target delivery" : "Days before support ends"}</Label><Input id="s-within" type="number" min={0} value={r.settings.withinDays ?? ""} onChange={(e) => setS({ withinDays: num(e.target.value) })} /></div>}
            <p className="text-[11px] text-muted-foreground">Archived and cancelled projects are never matched.</p>
          </fieldset> :
          <fieldset className="grid gap-2 rounded-lg border p-3"><legend className="px-1 text-xs font-semibold">IF</legend>
            <div className="flex flex-wrap gap-1.5" aria-label="Sources">{LEAD_SOURCES.map((x) => <button type="button" key={x} className={chip(!!c.sources?.includes(x))} onClick={() => setC({ sources: multi<LeadSource>(c.sources, x, !c.sources?.includes(x)) })}>{x}</button>)}</div>
            <div className="flex flex-wrap gap-1.5" aria-label="Stages">{LEAD_STATUSES.map((x) => <button type="button" key={x} className={chip(!!c.stages?.includes(x))} onClick={() => setC({ stages: multi<LeadStatus>(c.stages, x, !c.stages?.includes(x)) })}>{STATUS_LABEL[x]}</button>)}</div>
            <div className="flex flex-wrap gap-1.5" aria-label="Priorities">{(["hot", "warm", "cold"] as LeadPriority[]).map((x) => <button type="button" key={x} className={`${chip(!!c.priorities?.includes(x))} capitalize`} onClick={() => setC({ priorities: multi<LeadPriority>(c.priorities, x, !c.priorities?.includes(x)) })}>{x}</button>)}</div>
            <div className="grid gap-2 sm:grid-cols-3">
              <select aria-label="Assigned" className={selectCls} value={c.assigned ?? "any"} onChange={(e) => setC({ assigned: e.target.value === "any" ? undefined : (e.target.value as "assigned") })}><option value="any">Assigned or not</option><option value="assigned">Assigned</option><option value="unassigned">Unassigned</option></select>
              <select aria-label="Employee" className={selectCls} value={c.employeeId ?? ""} onChange={(e) => setC({ employeeId: e.target.value || undefined })}><option value="">Any employee</option>{employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select>
              <select aria-label="Inbox status" className={selectCls} value={c.inboxStatus ?? "any"} onChange={(e) => setC({ inboxStatus: e.target.value === "any" ? undefined : (e.target.value as "reviewed") })}><option value="any">Any inbox status</option><option value="needs_review">Needs review</option><option value="reviewed">Reviewed</option></select>
            </div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!c.firstContactPending} onChange={(e) => setC({ firstContactPending: e.target.checked || undefined })} />No contact attempt recorded yet</label>
            <div className="grid gap-2 sm:grid-cols-2">
              {([["minCreatedMinutes", "Min. minutes since created"], ["minSinceAttemptMinutes", "Min. minutes since last attempt"], ["minStageDays", "Min. days in stage"], ["minInactiveHours", "Min. hours without activity"]] as const).map(([k, label]) => (
                <div key={k} className="grid gap-1"><Label htmlFor={`c-${k}`} className="text-xs">{label}</Label><Input id={`c-${k}`} type="number" min={0} value={c[k] ?? ""} onChange={(e) => setC({ [k]: num(e.target.value) })} /></div>
              ))}
              {r.trigger === "followup_overdue" && <div className="grid gap-1"><Label htmlFor="s-od" className="text-xs">Minutes overdue before acting</Label><Input id="s-od" type="number" min={0} value={r.settings.overdueMinutes ?? ""} onChange={(e) => setS({ overdueMinutes: num(e.target.value) })} /></div>}
            </div>
            <div className="grid gap-1.5 border-t pt-2"><p className="text-xs font-semibold">Custom fields &amp; tags</p>
              <ConditionBuilder only={(f) => f.key.startsWith("cf:") || f.key === "tags"} filter={{ mode: c.customMode ?? "and", conditions: (c.custom ?? []) as ViewCondition[] }} onChange={(f) => setC({ custom: f.conditions.length ? f.conditions : undefined, customMode: f.mode === "or" ? "or" : undefined })} />
            </div>
          </fieldset>}
          <fieldset className="grid gap-2 rounded-lg border p-3"><legend className="px-1 text-xs font-semibold">THEN</legend>
            {subject === "project" && <p className="text-[11px] text-muted-foreground">Project rules never message clients, delete projects, mark payments, change deal amounts or mark delivery.</p>}
            <div className="grid gap-1.5 sm:grid-cols-2">{ACTIONS.map((a) => <label key={a} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={r.actions.includes(a)} onChange={(e) => setR({ ...r, actions: e.target.checked ? [...r.actions, a] : r.actions.filter((x) => x !== a) })} />{ACTION_LABEL[a]}</label>)}</div>
            <div className="grid gap-2 sm:grid-cols-3">
              <div className="grid gap-1"><Label htmlFor="s-cd" className="text-xs">Cooldown (hours)</Label><Input id="s-cd" type="number" min={1} value={r.settings.cooldownHours} onChange={(e) => setS({ cooldownHours: Number(e.target.value) })} /></div>
              <div className="grid gap-1"><Label htmlFor="s-esc" className="text-xs">Escalate to Owner after (min)</Label><Input id="s-esc" type="number" min={0} value={r.settings.escalateOwnerAfterMinutes ?? ""} onChange={(e) => setR((x) => { const { escalateOwnerAfterMinutes: _e, ...rest } = x.settings; const v = num(e.target.value); return { ...x, settings: v === undefined ? rest : { ...rest, escalateOwnerAfterMinutes: v } }; })} /></div>
              {r.actions.includes("task") && <><div className="grid gap-1 sm:col-span-2"><Label htmlFor="s-task" className="text-xs">Task to create</Label><Input id="s-task" value={r.settings.taskTitle ?? ""} onChange={(e) => setS({ taskTitle: e.target.value || undefined })} placeholder="e.g. Chase client for content" /></div><div className="grid gap-1"><Label htmlFor="s-taskdue" className="text-xs">Task due in (days, optional)</Label><Input id="s-taskdue" type="number" min={0} value={r.settings.taskDueInDays ?? ""} onChange={(e) => setS({ taskDueInDays: num(e.target.value) })} /></div></>}
              {r.actions.includes("followup") && <div className="grid gap-1"><Label htmlFor="s-fu" className="text-xs">Follow-up due in (hours)</Label><Input id="s-fu" type="number" min={1} value={r.settings.followupInHours ?? ""} onChange={(e) => setS({ followupInHours: num(e.target.value) })} /></div>}
            </div>
          </fieldset>
          {err && <p role="alert" className="text-xs text-warning">{err}</p>}
        </div>
        <DialogFooter><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={!r.name.trim()}>Save rule</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DryRun({ rule, onClose }: { rule: AutomationRule; onClose: () => void }) {
  const s = useCRM();
  const plan: RulePlan = useMemo(() => planRule(rule, ctxOf(useCRM.getState()), useCRM.getState().reminders), [rule]);
  const err = ruleError(rule); const conflicts = ruleConflicts(rule, s.automationRules);
  const lead = (id: string, pid?: string) => (pid ? s.projects.find((p) => p.id === pid)?.name ?? pid : s.leads.find((l) => l.id === id)?.name ?? id);
  const rf = useRuleFields();
  const project = (rule.subject ?? "lead") === "project";
  const cs = (rule.conditions.custom ?? []) as ViewCondition[];
  const why = cs.map((c) => describeCondition(c, project ? rf.project : rf.lead)).join(rule.conditions.customMode === "or" ? " OR " : " AND ");
  const pool = project ? s.projects.filter((p) => !p.archived && p.status !== "cancelled").length : s.leads.length;
  const matchedIds = new Set(plan.create.map((p) => p.projectId ?? p.leadId));
  const emp = (id: string | null) => (id ? s.employees.find((e) => e.id === id)?.name ?? "Employee" : "Unassigned");
  const enable = () => {
    if (plan.create.length > s.automationSettings.bulkConfirmThreshold && !window.confirm(`Enabling will create ${plan.create.length} reminders right away. Continue?`)) return;
    const e = s.setAutomationStatus(rule.id, "enabled"); if (e) { toast.error(e); return; }
    s.runAutomations({ manual: true }); toast.success("Rule enabled and evaluated"); onClose();
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader><DialogTitle>Test rule · {rule.name}</DialogTitle><DialogDescription>Dry run on your current records. Nothing is saved or changed.</DialogDescription></DialogHeader>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {([["Matching now", plan.matched], ["Would create", plan.create.length], ["Already reminded", plan.skippedDuplicates], ["In cooldown", plan.cooldown]] as const).map(([k, v]) => <div key={k} className="rounded-lg bg-secondary p-2"><div className="text-[11px] text-muted-foreground">{k}</div><div className="num text-lg font-semibold">{v}</div></div>)}
        </div>
        <p className="text-xs text-muted-foreground">Checked {pool} {project ? "active project" : "lead"}{pool === 1 ? "" : "s"} · {pool - matchedIds.size} not matching or already handled{why ? <> · Condition: <b className="text-foreground">{why}</b></> : null}</p>
        <p className="text-xs text-muted-foreground">Employees affected: {plan.affectedEmployees.length ? plan.affectedEmployees.map((e) => emp(e)).join(", ") : "none"} · Escalations to Owner: {plan.escalations.length} · Notifications: {rule.actions.includes("notify") ? (plan.create.length >= 5 ? "1 grouped summary" : `${plan.create.length}`) : "none"}</p>
        {plan.create.length > 0 ? <ul className="max-h-64 divide-y overflow-y-auto rounded-lg border text-sm">{plan.create.slice(0, 50).map((p) => <li key={p.key} className="p-2"><div className="font-medium">{lead(p.leadId, p.projectId)}</div><div className="text-xs text-muted-foreground">{p.reason}{why ? ` · Matched: ${why}` : ""} · {emp(p.employeeId)}{p.escalated ? " · escalate" : ""}{p.followUpDueAt ? " · creates a follow-up" : ""}</div></li>)}</ul> : <p className="rounded-lg border p-3 text-sm text-muted-foreground">No new reminders would be created right now.</p>}
        {(err || conflicts.length > 0) && <ul className="grid gap-1 rounded-md bg-warning/10 p-2 text-xs text-warning">{[err, ...conflicts].filter(Boolean).map((w) => <li key={w}>{w}</li>)}</ul>}
        <DialogFooter><Button variant="ghost" onClick={onClose}>Close</Button>{rule.status !== "enabled" && rule.status !== "archived" && <Button disabled={!!err} onClick={enable}><Play className="size-4" />Enable rule</Button>}</DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
