// Saved View editor dialog — shared by Leads and CRM Configuration. Saves only through store.saveView.
import { useState } from "react";
import { toast } from "sonner";
import { ConditionBuilder } from "./Customize";
import { selectCls } from "./Shell";
import { useAccess } from "@/lib/crm/session";
import { useCRM, viewCtxOf } from "@/lib/crm/store";
import { runView, VISIBILITY_LABEL, type SavedView, type ViewFilter, type ViewSort, type ViewVisibility } from "@/lib/crm/customize";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export const newView = (filter: ViewFilter = { mode: "and", conditions: [] }, sort: ViewSort = "recent"): SavedView => ({ id: "", name: "", visibility: "personal", ownerId: "", filter, sort, archived: false, schema: 1, createdAt: "", updatedAt: "", version: 0 });

export function ViewEditor({ initial, onClose, onSaved }: { initial: SavedView; onClose: () => void; onSaved?: (id: string) => void }) {
  const st = useCRM(); const { preview } = useAccess();
  const [v, setV] = useState<SavedView>(initial); const [err, setErr] = useState<string | null>(null);
  const viewer = preview ? { owner: false as const, employeeId: preview.employeeId, canEdit: true } : { owner: true as const };
  const count = runView(v, st.leads, viewCtxOf(st, viewer)).length;
  const save = () => { const r = st.saveView(v); if (!r.ok) { setErr(r.error); return; } toast.success(`View “${v.name.trim()}” saved`); onSaved?.(r.id); onClose(); };
  return <Dialog open onOpenChange={(o) => !o && onClose()}>
    <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
      <DialogHeader><DialogTitle>{initial.id ? `Edit view “${initial.name}”` : "Save a view"}</DialogTitle><DialogDescription>Matches <span className="num font-semibold text-foreground">{count}</span> lead{count === 1 ? "" : "s"} right now{preview ? " you can access" : ""}.</DialogDescription></DialogHeader>
      <div className="grid gap-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="grid gap-1.5 sm:col-span-1"><Label htmlFor="v-name">Name</Label><Input id="v-name" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} placeholder="e.g. My hot leads" /></div>
          <div className="grid gap-1.5"><Label htmlFor="v-vis">Visibility</Label><select id="v-vis" className={selectCls} value={v.visibility} onChange={(e) => setV({ ...v, visibility: e.target.value as ViewVisibility })}>{(Object.keys(VISIBILITY_LABEL) as ViewVisibility[]).filter((k) => !preview || k !== "company").map((k) => <option key={k} value={k}>{VISIBILITY_LABEL[k]}</option>)}</select></div>
          <div className="grid gap-1.5"><Label htmlFor="v-sort">Sort</Label><select id="v-sort" className={selectCls} value={v.sort} onChange={(e) => setV({ ...v, sort: e.target.value as ViewSort })}><option value="recent">Newest</option><option value="updated">Recently updated</option><option value="score">Highest score</option><option value="value">Highest value</option><option value="name">Name A–Z</option></select></div>
        </div>
        <div><p className="mb-2 text-sm font-medium">Conditions</p><ConditionBuilder filter={v.filter} onChange={(filter) => setV({ ...v, filter })} /></div>
        {preview && v.visibility === "shared" && <p className="text-xs text-muted-foreground">Teammates who open a shared view only see leads they already have access to.</p>}
        {err && <p role="alert" className="text-sm text-destructive">{err}</p>}
      </div>
      <DialogFooter><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={save}>Save view</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}
