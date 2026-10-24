import { useMemo, useState } from "react";
import { toast } from "sonner";
import { ChevronDown, Lock, RotateCcw, ShieldAlert } from "lucide-react";
import { useCRM } from "@/lib/crm/store";
import { MODULES, ROLE_PRESETS, FINANCE_LABEL, SCOPE_LABEL, REASON_LABEL, consequence, resolve, setOverride, type ActionKey, type FinanceLevel, type LeadScope } from "@/lib/crm/access";
import { roleLabel, type Employee } from "@/lib/crm/team";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { selectCls } from "@/components/crm/Shell";
import { cn } from "@/lib/utils";

export function PermissionEditor({ e, open, onClose }: { e: Employee; open: boolean; onClose: () => void }) {
  const saved = useCRM((s) => s.employeeAccess[e.id]);
  const saveEmployeeAccess = useCRM((s) => s.saveEmployeeAccess);
  const preset = ROLE_PRESETS[e.roleId];
  const [ov, setOv] = useState<Record<ActionKey, boolean>>(saved?.overrides ?? {});
  const [scope, setScope] = useState<LeadScope>(saved?.leadScope ?? preset.leadScope);
  const [fin, setFin] = useState<FinanceLevel>(saved?.finance ?? preset.finance);
  const [openMod, setOpenMod] = useState<string | null>("leads");
  const eff = useMemo(() => resolve(e.roleId, { overrides: ov, leadScope: scope, finance: fin, updatedAt: "" }), [e.roleId, ov, scope, fin]);
  const dirty = JSON.stringify([saved?.overrides ?? {}, saved?.leadScope ?? preset.leadScope, saved?.finance ?? preset.finance]) !== JSON.stringify([ov, scope, fin]);
  const setMod = (keys: ActionKey[], v: boolean) => setOv((o) => keys.reduce((acc, k) => setOverride(e.roleId, acc, k, v), o));
  const close = () => { if (dirty && !window.confirm("Discard unsaved permission changes?")) return; onClose(); };
  return <Dialog open={open} onOpenChange={(o) => !o && close()}><DialogContent className="pm-dialog sm:max-w-2xl">
    <DialogHeader><DialogTitle className="break-words">Permissions · {e.name}</DialogTitle><DialogDescription>Starts from the {roleLabel(e)} defaults. Changes here apply to {e.name} only. This is a plan for the secure backend — the demo doesn't protect data.</DialogDescription></DialogHeader>
    <div className="pm-scopes">
      <label className="q-field"><span>Lead scope</span><select className={selectCls} value={scope} onChange={(x) => setScope(x.target.value as LeadScope)}>{(["assigned", "all"] as const).map((s) => <option key={s} value={s}>{SCOPE_LABEL[s]}</option>)}</select><small className="text-xs text-muted-foreground">{scope === "assigned" ? "Only leads you assign to them." : "Every lead in the company — grant deliberately."}</small></label>
      <label className="q-field"><span>Finance level</span><select className={selectCls} value={fin} disabled={!eff.can("deals.view")} onChange={(x) => setFin(x.target.value as FinanceLevel)}>{(["none", "status", "amounts", "manage"] as const).map((s) => <option key={s} value={s}>{FINANCE_LABEL[s]}</option>)}</select><small className="text-xs text-muted-foreground">{eff.can("deals.view") ? "Payment screenshots still need their own permission." : "Turn on “View deals” to choose a level."}</small></label>
    </div>
    <div className="pm-list">{MODULES.map((m) => {
      const keys = m.actions.map((x) => x.key); const on = keys.filter((k) => eff.can(k)).length; const isOpen = openMod === m.id;
      return <section key={m.id} className="pm-mod" data-open={isOpen}>
        <button type="button" className="pm-head" aria-expanded={isOpen} onClick={() => setOpenMod(isOpen ? null : m.id)}>
          <span className="min-w-0 flex-1 text-left"><span className="block text-sm font-semibold">{m.label}{m.ownerOnly && <Lock className="ml-1.5 inline size-3" />}</span><span className="block truncate text-xs text-muted-foreground">{m.desc}</span></span>
          <span className={cn("pm-count num", on && "is-on")}>{on}/{keys.length}</span><ChevronDown className="size-4 transition-transform" />
        </button>
        {isOpen && <div className="pm-body">
          {!m.ownerOnly && <div className="flex gap-2 pb-2"><Button size="sm" variant="outline" onClick={() => setMod(keys, true)}>Enable all</Button><Button size="sm" variant="ghost" onClick={() => setMod(keys, false)}>Disable all</Button></div>}
          {m.actions.map((x) => { const r = eff.reason(x.key); const c = consequence(x.key); return <div key={x.key} className="pm-row">
            <div className="min-w-0 flex-1"><label htmlFor={`pm-${x.key}`} className="text-sm font-medium">{x.label}{x.sensitive && <ShieldAlert className="ml-1 inline size-3.5 text-warning" aria-label="Sensitive" />}</label><p className="text-xs text-muted-foreground">{x.desc}</p>{c && eff.can(x.key) && <p className="mt-1 text-xs text-warning">{c}</p>}<span className="pm-reason" data-reason={r}>{REASON_LABEL[r]}</span></div>
            <Switch id={`pm-${x.key}`} checked={eff.can(x.key)} disabled={r === "owner-only"} onCheckedChange={(v) => setOv((o) => setOverride(e.roleId, o, x.key, v))} />
          </div>; })}
        </div>}
      </section>; })}</div>
    <DialogFooter className="items-center gap-2 sm:justify-between">
      <Button variant="ghost" onClick={() => { setOv({}); setScope(preset.leadScope); setFin(preset.finance); }}><RotateCcw />Reset to role defaults</Button>
      <div className="flex items-center gap-2">{dirty && <span className="pm-dirty">Unsaved changes</span>}<Button variant="outline" onClick={close}>Cancel</Button><Button disabled={!dirty} onClick={() => { saveEmployeeAccess(e.id, { overrides: ov, leadScope: scope, finance: fin }); toast.success(`Permissions saved for ${e.name}`); onClose(); }}>Save</Button></div>
    </DialogFooter>
  </DialogContent></Dialog>;
}
