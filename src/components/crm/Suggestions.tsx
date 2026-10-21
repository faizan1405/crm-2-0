import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Sparkles, AlertCircle } from "lucide-react";
import { useCRM } from "@/lib/crm/store";
import { suggestAll, suggestFollowUp, type Suggestion } from "@/lib/crm/followups";
import { FOLLOWUP_LABEL } from "@/lib/crm/types";
import { formatDateTime } from "@/lib/crm/format";
import { toISO } from "@/lib/crm/calllog";
import { FollowUpDialog } from "@/components/crm/Dialogs";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

function Row({ s, name, onReview }: { s: Suggestion; name?: string; onReview: () => void }) {
  return (
    <div className={cn("suggestion-row flex flex-wrap items-center gap-3 rounded-xl border p-3", s.urgent && "border-destructive/30 bg-destructive-soft/40")}>
      <span className={cn("grid size-8 shrink-0 place-items-center rounded-lg", s.urgent ? "bg-destructive-soft text-destructive" : "bg-primary-soft text-primary")}>{s.urgent ? <AlertCircle className="size-4" /> : <Sparkles className="size-4" />}</span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold">{name && <Link to="/leads/$id" params={{ id: s.leadId }} className="hover:text-primary">{name} · </Link>}{s.action}: {FOLLOWUP_LABEL[s.type]} {formatDateTime(toISO(s.at))}</div>
        <div className="text-xs text-muted-foreground">Why: {s.reason}</div>
      </div>
      <Button size="sm" variant={s.urgent ? "default" : "outline"} onClick={onReview}>{s.rescheduleId ? "Review reschedule" : "Review & schedule"}</Button>
    </div>
  );
}

/** Suggestions are computed from current data and only saved after the user approves the time. */
export function SuggestionList({ leadId, limit = 5 }: { leadId?: string; limit?: number }) {
  const { leads, followUps, activities } = useCRM();
  const [pick, setPick] = useState<Suggestion | null>(null);
  const list = useMemo(() => {
    const now = new Date();
    if (leadId) { const l = leads.find((x) => x.id === leadId); const s = l && suggestFollowUp(l, followUps, activities, now); return s ? [s] : []; }
    return suggestAll(leads, followUps, activities, now).slice(0, limit);
  }, [leads, followUps, activities, leadId, limit]);
  if (!list.length) return leadId ? <p className="text-xs text-muted-foreground">No suggestion — a follow-up is already planned or the lead is closed.</p> : null;
  return (
    <div className="grid gap-2">
      {list.map((s) => <Row key={s.leadId} s={s} {...(leadId ? {} : { name: leads.find((l) => l.id === s.leadId)?.name })} onReview={() => setPick(s)} />)}
      {pick && <FollowUpDialog open onOpenChange={(o) => !o && setPick(null)} leadId={pick.leadId} initial={{ at: pick.at, type: pick.type, note: pick.reason }} {...(pick.rescheduleId ? { rescheduleId: pick.rescheduleId } : {})} />}
    </div>
  );
}
