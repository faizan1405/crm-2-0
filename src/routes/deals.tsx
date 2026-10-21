import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { Shell, Stat } from "@/components/crm/Shell";
import { useCRM } from "@/lib/crm/store";
import { financeSummary, dealCollected, dealOutstanding, dealPaymentStatus } from "@/lib/crm/finance";
import { formatINR, formatINRCompact, formatPct, formatDate } from "@/lib/crm/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/deals")({
  head: () => ({
    meta: [
      { title: "Deals & Payments · Scale Flow CRM" },
      { name: "description", content: "Track deal value, collections and overdue balances." },
      { property: "og:title", content: "Deals & Payments · Scale Flow CRM" },
      { property: "og:description", content: "Track deal value, collections and overdue balances." },
    ],
  }),
  component: Deals,
});

const TONE = { paid: "bg-success-soft text-success", partial: "bg-warning-soft text-warning", unpaid: "bg-neutral-soft text-muted-foreground", overdue: "bg-destructive-soft text-destructive", cancelled: "bg-neutral-soft text-muted-foreground" };

function Deals() {
  const { deals, payments, addPayment } = useCRM();
  const fin = financeSummary(deals, payments);
  const [amt, setAmt] = useState<Record<string, string>>({});
  return (
    <Shell title="Deals & Payments" subtitle={`${deals.length} deals`}>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Total value" value={formatINRCompact(fin.totalValue)} />
        <Stat label="Collected" value={formatINRCompact(fin.collected)} hint={formatPct(fin.collectionRate)} tone="success" />
        <Stat label="Outstanding" value={formatINRCompact(fin.outstanding)} tone="warning" />
        <Stat label="Overdue" value={formatINRCompact(fin.overdue)} tone="destructive" />
      </div>
      <div className="mt-6 grid gap-3">
        {deals.map((d) => {
          const st = dealPaymentStatus(d, payments);
          const out = dealOutstanding(d, payments);
          const pct = d.finalAmount ? Math.min(dealCollected(d.id, payments) / d.finalAmount, 1) : 0;
          return (
            <div key={d.id} className="surface p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div><div className="font-semibold">{d.name}</div><div className="text-sm text-muted-foreground">{d.clientName} · {d.company} · due {formatDate(d.dueDate)}</div></div>
                <span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold capitalize", TONE[st])}>{st}</span>
              </div>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted"><div className="h-full bg-success" style={{ width: `${pct * 100}%` }} /></div>
              <div className="num mt-2 flex flex-wrap items-center justify-between gap-2 text-sm">
                <span>{formatINR(dealCollected(d.id, payments))} of {formatINR(d.finalAmount)} · <span className="text-muted-foreground">{formatINR(out)} due</span></span>
                {out > 0 && (
                  <form className="flex gap-2" onSubmit={(e) => {
                    e.preventDefault();
                    const n = Number(amt[d.id]);
                    if (!n || n <= 0) return toast.error("Enter an amount");
                    if (n > out) return toast.error(`Amount exceeds the ${formatINR(out)} due`);
                    addPayment({ dealId: d.id, amount: n, date: new Date().toISOString().slice(0, 10), method: "UPI", type: n === out ? "final" : "milestone" });
                    setAmt({ ...amt, [d.id]: "" });
                    toast.success("Payment recorded");
                  }}>
                    <Input className="h-8 w-32" type="number" placeholder="₹ amount" value={amt[d.id] ?? ""} onChange={(e) => setAmt({ ...amt, [d.id]: e.target.value })} />
                    <Button size="sm" type="submit">Record</Button>
                  </form>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </Shell>
  );
}
