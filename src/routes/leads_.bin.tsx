import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, RotateCcw, Trash2, Archive } from "lucide-react";
import { Shell, Empty, Identity } from "@/components/crm/Shell";
import { useCRM } from "@/lib/crm/store";
import { relative, formatINR } from "@/lib/crm/format";
import { STATUS_LABEL, type BinEntry } from "@/lib/crm/types";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/leads_/bin")({
  head: () => ({
    meta: [
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { title: "Waste & Recently Deleted · Scale Flow CRM" },
      { name: "description", content: "Review wasted and deleted leads and restore them." },
      { property: "og:title", content: "Waste & Recently Deleted · Scale Flow CRM" },
      { property: "og:description", content: "Review wasted and deleted leads and restore them." },
    ],
  }),
  component: Bin,
});

function Bin() {
  const { bin, restoreLead, purgeBin, emptyBin } = useCRM();
  const [tab, setTab] = useState<BinEntry["kind"]>("waste");
  const rows = bin.filter((b) => b.kind === tab);
  const restore = (b: BinEntry) => { const err = restoreLead(b.id); if (err) toast.error(err); else toast.success(`${b.lead.name} restored`); };
  return (
    <Shell title="Waste & Recently Deleted" subtitle="Leads kept aside — restore any time" actions={rows.length ? <Button variant="outline" onClick={() => { if (window.confirm(`Permanently remove all ${rows.length}?`)) { emptyBin(tab); toast.success("Emptied"); } }}><Trash2 className="size-4" />Empty {tab === "waste" ? "Waste" : "Recently Deleted"}</Button> : undefined}>
      <Link to="/leads" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-primary"><ArrowLeft className="size-4" />Back to leads</Link>
      <div className="mb-5 flex gap-1 border-b pb-3">
        {(["waste", "deleted"] as const).map((k) => <Button key={k} size="sm" variant="ghost" onClick={() => setTab(k)} className={cn(tab === k ? "bg-primary-soft text-primary" : "text-muted-foreground")}>{k === "waste" ? "Waste" : "Recently Deleted"}<span className="ml-1 text-[10px] opacity-70">{bin.filter((b) => b.kind === k).length}</span></Button>)}
      </div>
      {rows.length === 0 ? <div className="surface"><Empty icon={<Archive />} title={tab === "waste" ? "Waste is empty" : "Nothing deleted recently"} hint="Leads you move here can be restored with their follow-ups and history." /></div> : (
        <div className="grid gap-3">
          {rows.map((b) => (
            <div key={b.id} className="surface flex flex-wrap items-center gap-4 p-4">
              <div className="min-w-48 flex-1"><Identity name={b.lead.name} company={b.lead.company} /></div>
              <div className="text-xs text-muted-foreground"><div className="num">{b.lead.phone}</div><div>{STATUS_LABEL[b.lead.status]} · {formatINR(b.lead.quotedAmount ?? b.lead.budget)}</div></div>
              <div className="text-xs text-muted-foreground"><div>{b.kind === "waste" ? "Wasted" : "Deleted"} {relative(b.at)}</div>{b.reason && <div>Reason: {b.reason}</div>}</div>
              <div className="ml-auto flex gap-1">
                <Button size="sm" onClick={() => restore(b)}><RotateCcw className="size-4" />Restore</Button>
                <Button size="sm" variant="ghost" aria-label="Delete permanently" onClick={() => { if (window.confirm(`Permanently remove ${b.lead.name}?`)) { purgeBin(b.id); toast.success("Removed permanently"); } }}><Trash2 className="size-4 text-muted-foreground" /></Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Shell>
  );
}
