import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Layers, AlertTriangle, Check } from "lucide-react";
import { useCRM } from "@/lib/crm/store";
import { reviewBulk, type BulkRow } from "@/lib/crm/leadtools";
import { formatINR } from "@/lib/crm/format";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { selectCls } from "@/components/crm/Shell";
import { cn } from "@/lib/utils";

type Action = "create" | "fill" | "overwrite" | "skip";
const STATE_LABEL: Record<BulkRow["state"], string> = { new: "New", duplicate: "Already in CRM", batch_duplicate: "Repeated in batch", invalid: "Needs fixing" };

export function BulkLeadDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { leads, addLead, mergeIntoLead } = useCRM();
  const [text, setText] = useState("");
  const [rows, setRows] = useState<BulkRow[] | null>(null);
  const [actions, setActions] = useState<Record<string, Action>>({});
  const close = (o: boolean) => { if (!o) { setText(""); setRows(null); setActions({}); } onOpenChange(o); };
  const review = () => {
    const r = reviewBulk(text, leads);
    if (!r.length) { toast.error("Paste at least one lead"); return; }
    setRows(r);
    setActions(Object.fromEntries(r.map((x) => [x.key, x.state === "new" ? "create" : x.state === "duplicate" ? "fill" : "skip"])));
  };
  const counts = useMemo(() => Object.values(actions).reduce((a, v) => ({ ...a, [v]: (a[v] ?? 0) + 1 }), {} as Record<Action, number>), [actions]);
  const save = () => {
    if (!rows) return;
    let created = 0, merged = 0;
    for (const r of rows) {
      const a = actions[r.key];
      if (r.state === "new" && a === "create") {
        const p = r.parsed;
        addLead({ name: p.name!, phone: p.phone!, source: p.source ?? "Other", status: "new", priority: "warm", pinned: false, ...(p.email ? { email: p.email } : {}), ...(p.company ? { company: p.company } : {}), ...(p.requirement ? { requirement: p.requirement } : {}), ...(p.budget ? { budget: p.budget } : {}), ...(p.quotedAmount ? { quotedAmount: p.quotedAmount } : {}), notes: p.notes });
        created++;
      } else if (r.state === "duplicate" && r.existingId && (a === "fill" || a === "overwrite")) {
        if (mergeIntoLead(r.existingId, r.parsed, a)) merged++;
      }
    }
    toast.success(`${created} added · ${merged} merged`);
    close(false);
  };
  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Layers className="size-5 text-primary" />Bulk lead entry</DialogTitle>
          <DialogDescription>One lead per line (or separate blocks with a blank line). Demo rule-based reading — nothing is saved until you review. Real AI extraction comes with the backend.</DialogDescription>
        </DialogHeader>
        {!rows ? (
          <Textarea aria-label="Bulk leads" rows={9} value={text} onChange={(e) => setText(e.target.value)} placeholder={"Ravi Kumar, 9123456780, from Ravi Bakes, wants a website, budget 40k\nMeena Iyer, 9988776655, Instagram, needs a logo"} />
        ) : (
          <div className="grid gap-2">
            {rows.map((r) => {
              const existing = leads.find((l) => l.id === r.existingId);
              return (
                <div key={r.key} className={cn("grid gap-2 rounded-lg border p-3 text-sm sm:grid-cols-[1fr_auto] sm:items-center", r.state === "invalid" && "border-destructive/40")}>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2 font-semibold">{r.parsed.name ?? "—"}<span className="num font-normal text-muted-foreground">{r.parsed.phone ?? "no phone"}</span>
                      <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", r.state === "new" ? "bg-success/15 text-success" : r.state === "duplicate" ? "bg-warning/15 text-warning" : "bg-destructive/10 text-destructive")}>{STATE_LABEL[r.state]}</span></div>
                    <div className="mt-1 truncate text-xs text-muted-foreground">{[r.parsed.company, r.parsed.requirement, r.parsed.source, r.parsed.budget ? `Budget ${formatINR(r.parsed.budget)}` : ""].filter(Boolean).join(" · ") || r.raw}</div>
                    {existing && <div className="mt-1 text-xs text-warning"><AlertTriangle className="mr-1 inline size-3" />Matches {existing.name}{existing.company ? ` (${existing.company})` : ""}</div>}
                    {r.problem && <div className="mt-1 text-xs text-destructive">{r.problem}</div>}
                  </div>
                  <select aria-label={`Action for ${r.parsed.name ?? "row"}`} className={selectCls} value={actions[r.key]} disabled={r.state === "invalid" || r.state === "batch_duplicate"} onChange={(e) => setActions({ ...actions, [r.key]: e.target.value as Action })}>
                    {r.state === "new" && <option value="create">Add as new</option>}
                    {r.state === "duplicate" && <><option value="fill">Merge — fill empty fields</option><option value="overwrite">Update existing</option></>}
                    <option value="skip">Skip</option>
                  </select>
                </div>
              );
            })}
          </div>
        )}
        <DialogFooter className="gap-2">
          {rows ? <><Button variant="ghost" onClick={() => setRows(null)}>Back to edit</Button><Button onClick={save} disabled={!counts.create && !counts.fill && !counts.overwrite}><Check className="size-4" />Save {counts.create ?? 0} new · {(counts.fill ?? 0) + (counts.overwrite ?? 0)} merges</Button></>
            : <Button onClick={review} disabled={!text.trim()}>Review leads</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
