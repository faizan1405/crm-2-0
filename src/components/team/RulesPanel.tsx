import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Plus, ArrowUp, ArrowDown, Trash2, Pencil, FlaskConical, Workflow, AlertTriangle } from "lucide-react";
import { useCRM } from "@/lib/crm/store";
import { assignable, evaluate, type AssignmentRule, type RuleTrigger } from "@/lib/crm/access";
import { LEAD_SOURCES, LEAD_STATUSES, STATUS_LABEL } from "@/lib/crm/types";
import { uid, relative } from "@/lib/crm/format";
import { Empty, selectCls } from "@/components/crm/Shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const TRIGGER: Record<RuleTrigger, string> = { lead_created: "A new lead is created", stage_entered: "A lead enters a stage" };
const describe = (r: AssignmentRule) => [r.conditions.stage && `stage ${STATUS_LABEL[r.conditions.stage]}`, r.conditions.source && `source ${r.conditions.source}`, r.conditions.priority && `${r.conditions.priority} priority`].filter(Boolean).join(" · ") || "any lead";

export function RulesPanel() {
  const { assignmentRules, ruleSettings, setRuleSettings, employees, leads, assignments, deleteRule, moveRule, saveRule, applyRulesToExisting } = useCRM();
  const rules = [...assignmentRules].sort((a, b) => a.priority - b.priority);
  const [edit, setEdit] = useState<AssignmentRule | "new" | null>(null);
  const [preview, setPreview] = useState(false), [bulk, setBulk] = useState(false);
  const name = (id: string) => employees.find((e) => e.id === id)?.name ?? "Removed employee";
  const results = useMemo(() => leads.map((l) => ({ l, o: evaluate(l, "lead_created", assignmentRules, employees, assignments[l.id], ruleSettings) })).filter((x) => x.o.matches.length), [leads, assignmentRules, employees, assignments, ruleSettings]);
  const wouldAssign = results.filter((x) => x.o.winner).length;
  return <div className="grid gap-4">
    <div className="surface ar-settings">
      <div className="ar-set"><div><div className="text-sm font-semibold">Automatic assignment</div><p className="text-xs text-muted-foreground">Off by default. When on, rules run once per lead per event, in this browser only.</p></div><Switch aria-label="Automatic assignment" checked={ruleSettings.autoEnabled} onCheckedChange={(v) => { setRuleSettings({ autoEnabled: v }); toast.success(v ? "Automatic assignment on — applies to new events only" : "Automatic assignment off"); }} /></div>
      <div className="ar-set"><div><div className="text-sm font-semibold">Rules may replace existing assignments</div><p className="text-xs text-muted-foreground">Off: leads that already have an assignee (including ones you picked by hand) are never changed.</p></div><Switch aria-label="Rules may replace existing assignments" checked={ruleSettings.replaceExisting} onCheckedChange={(v) => setRuleSettings({ replaceExisting: v })} /></div>
    </div>
    <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-xs text-muted-foreground">Lowest number wins when several rules match. Editing a rule never redistributes old leads.</p><div className="flex gap-2"><Button variant="outline" onClick={() => setPreview(true)} disabled={!rules.length}><FlaskConical />Test rules</Button><Button onClick={() => setEdit("new")}><Plus />New rule</Button></div></div>
    {rules.length ? <ol className="grid gap-2">{rules.map((r, i) => { const t = employees.find((e) => e.id === r.targetEmployeeId); const bad = !t || !assignable(t);
      return <li key={r.id} className="surface ar-rule" data-enabled={r.enabled}>
        <span className="ar-num num">{r.priority}</span>
        <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2 text-sm font-semibold">{r.name}{bad && <span className="tm-status" data-status="inactive"><AlertTriangle className="size-3" />Target can't receive leads</span>}</div><p className="text-xs text-muted-foreground">{TRIGGER[r.trigger]} · {describe(r)} → <b className="text-foreground">{name(r.targetEmployeeId)}</b> · edited {relative(r.updatedAt)}</p></div>
        <Switch aria-label={`Enable ${r.name}`} checked={r.enabled} onCheckedChange={(v) => saveRule({ ...r, enabled: v })} />
        <div className="flex"><Button size="icon" variant="ghost" aria-label="Move up" disabled={i === 0} onClick={() => moveRule(r.id, -1)}><ArrowUp /></Button><Button size="icon" variant="ghost" aria-label="Move down" disabled={i === rules.length - 1} onClick={() => moveRule(r.id, 1)}><ArrowDown /></Button><Button size="icon" variant="ghost" aria-label="Edit rule" onClick={() => setEdit(r)}><Pencil /></Button><Button size="icon" variant="ghost" aria-label="Delete rule" onClick={() => { deleteRule(r.id); toast.success("Rule deleted"); }}><Trash2 /></Button></div>
      </li>; })}</ol> : <div className="surface"><Empty icon={<Workflow />} title="No assignment rules" hint="Rules can route new leads, or leads reaching a stage, to an employee." action={<Button onClick={() => setEdit("new")}><Plus />New rule</Button>} /></div>}
    {edit && <RuleForm key={edit === "new" ? "new" : edit.id} rule={edit === "new" ? undefined : edit} onClose={() => setEdit(null)} />}
    <Dialog open={preview} onOpenChange={setPreview}><DialogContent className="sm:max-w-xl">
      <DialogHeader><DialogTitle>Test rules against existing leads</DialogTitle><DialogDescription>Preview only — nothing changes. Shows which rule would win for each lead using the "new lead" trigger.</DialogDescription></DialogHeader>
      <div className="grid max-h-[50vh] gap-1 overflow-y-auto">{results.map(({ l, o }) => <div key={l.id} className="ar-test"><span className="min-w-0 flex-1 truncate text-sm font-medium">{l.name}</span><span className="text-xs text-muted-foreground">{o.winner ? <>→ <b className="text-foreground">{name(o.winner.targetEmployeeId)}</b> via “{o.winner.name}”{o.matches.length > 1 ? ` (${o.matches.length} rules matched)` : ""}</> : o.blocked}</span></div>)}{!results.length && <p className="py-6 text-center text-sm text-muted-foreground">No existing lead matches an enabled rule.</p>}</div>
      <DialogFooter><Button variant="outline" onClick={() => setPreview(false)}>Close</Button><Button disabled={!wouldAssign} onClick={() => { setPreview(false); setBulk(true); }}>Apply to {wouldAssign} existing lead{wouldAssign === 1 ? "" : "s"}…</Button></DialogFooter>
    </DialogContent></Dialog>
    <Dialog open={bulk} onOpenChange={setBulk}><DialogContent className="sm:max-w-md"><DialogHeader><DialogTitle>Redistribute {wouldAssign} existing leads?</DialogTitle><DialogDescription>This assigns historical leads using the current rules. You can reassign any lead afterwards. Lead details are not changed.</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" onClick={() => setBulk(false)}>Cancel</Button><Button onClick={() => { const n = applyRulesToExisting(); setBulk(false); toast.success(`${n} lead${n === 1 ? "" : "s"} assigned by rules`); }}>Yes, assign</Button></DialogFooter></DialogContent></Dialog>
  </div>;
}

function RuleForm({ rule, onClose }: { rule: AssignmentRule | undefined; onClose: () => void }) {
  const { employees, saveRule } = useCRM();
  const [r, setR] = useState(() => rule ?? { id: uid("rule"), name: "", trigger: "lead_created" as RuleTrigger, conditions: {}, targetEmployeeId: "", enabled: true });
  const [err, setErr] = useState<string | null>(null);
  const targets = employees.filter(assignable);
  const cond = (k: "source" | "priority" | "stage", v: string) => { const c = { ...r.conditions } as Record<string, string>; if (v) c[k] = v; else delete c[k]; setR({ ...r, conditions: c }); setErr(null); };
  return <Dialog open onOpenChange={(o) => !o && onClose()}><DialogContent className="sm:max-w-lg">
    <DialogHeader><DialogTitle>{rule ? "Edit rule" : "New assignment rule"}</DialogTitle><DialogDescription>Rules never assign to inactive employees and never create copies of leads.</DialogDescription></DialogHeader>
    <form className="grid gap-4" noValidate onSubmit={(e) => { e.preventDefault(); const x = saveRule(r); if (x) setErr(x); else { toast.success(rule ? "Rule updated" : "Rule created"); onClose(); } }}>
      <label className="q-field"><span>Rule name</span><Input autoFocus value={r.name} placeholder="Website leads to Rahul" onChange={(e) => { setR({ ...r, name: e.target.value }); setErr(null); }} /></label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="q-field"><span>When</span><select className={selectCls} value={r.trigger} onChange={(e) => setR({ ...r, trigger: e.target.value as RuleTrigger })}>{(Object.keys(TRIGGER) as RuleTrigger[]).map((t) => <option key={t} value={t}>{TRIGGER[t]}</option>)}</select></label>
        <label className="q-field"><span>Assign to</span><select className={selectCls} value={r.targetEmployeeId} onChange={(e) => { setR({ ...r, targetEmployeeId: e.target.value }); setErr(null); }}><option value="">Choose employee…</option>{targets.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select></label>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <label className="q-field"><span>Stage{r.trigger === "stage_entered" ? "" : " (optional)"}</span><select className={selectCls} value={r.conditions.stage ?? ""} onChange={(e) => cond("stage", e.target.value)}><option value="">Any</option>{LEAD_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}</select></label>
        <label className="q-field"><span>Source</span><select className={selectCls} value={r.conditions.source ?? ""} onChange={(e) => cond("source", e.target.value)}><option value="">Any</option>{LEAD_SOURCES.map((s) => <option key={s}>{s}</option>)}</select></label>
        <label className="q-field"><span>Priority</span><select className={selectCls} value={r.conditions.priority ?? ""} onChange={(e) => cond("priority", e.target.value)}><option value="">Any</option><option value="hot">Hot</option><option value="warm">Warm</option><option value="cold">Cold</option></select></label>
      </div>
      {err && <p role="alert" className="text-sm font-medium text-destructive">{err}</p>}
      <DialogFooter><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button type="submit">{rule ? "Save rule" : "Create rule"}</Button></DialogFooter>
    </form>
  </DialogContent></Dialog>;
}
