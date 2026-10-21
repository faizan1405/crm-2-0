import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { Plus, Wallet, ChevronDown } from "lucide-react";
import { Shell, Stat, Empty, selectCls } from "@/components/crm/Shell";
import { useCRM } from "@/lib/crm/store";
import { financeSummary, dealCollected, dealOutstanding, dealPaymentStatus } from "@/lib/crm/finance";
import { formatINR, formatINRCompact, formatPct, formatDate } from "@/lib/crm/format";
import { DEAL_STATUS_LABEL, type Deal, type PaymentMethod, type PaymentType, type DealStatus } from "@/lib/crm/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
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
const METHODS: PaymentMethod[] = ["UPI", "Bank Transfer", "Cash", "Card", "Cheque"];

function Deals() {
  const { deals, payments } = useCRM();
  const fin = financeSummary(deals, payments);
  const [addDeal, setAddDeal] = useState(false);
  const [pay, setPay] = useState<Deal | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "due" | "overdue" | "paid">("all");
  const list = deals.filter((d) => { const s = dealPaymentStatus(d, payments); return filter === "all" || (filter === "due" ? s === "partial" || s === "unpaid" || s === "overdue" : s === filter); });

  return (
    <Shell title="Deals & Payments" subtitle={`${deals.length} deals · CRM clients and other clients`} actions={<Button onClick={() => setAddDeal(true)}><Plus className="size-4" />New deal</Button>}>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Total deal value" value={formatINRCompact(fin.totalValue)} hint="Excludes cancelled" />
        <Stat label="Money received" value={formatINRCompact(fin.collected)} hint={`${formatPct(fin.collectionRate)} collected`} tone="success" />
        <Stat label="Outstanding" value={formatINRCompact(fin.outstanding)} tone="warning" />
        <Stat label="Overdue" value={formatINRCompact(fin.overdue)} tone="destructive" />
      </div>
      <div className="mt-6 mb-3 flex gap-1 rounded-lg bg-muted p-1 sm:inline-flex">
        {(["all", "due", "overdue", "paid"] as const).map((f) => <button key={f} onClick={() => setFilter(f)} className={cn("rounded-md px-3 py-1.5 text-sm font-medium capitalize", filter === f ? "bg-card shadow-card" : "text-muted-foreground")}>{f}</button>)}
      </div>
      <div className="grid gap-3">
        {list.length === 0 && <div className="surface"><Empty icon={<Wallet />} title="No deals here" /></div>}
        {list.map((d) => {
          const st = dealPaymentStatus(d, payments);
          const got = dealCollected(d.id, payments);
          const out = dealOutstanding(d, payments);
          const pct = d.finalAmount ? Math.min(got / d.finalAmount, 1) : 0;
          const hist = payments.filter((p) => p.dealId === d.id).sort((a, b) => b.date.localeCompare(a.date));
          return (
            <div key={d.id} className="surface p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="font-semibold">{d.name}</div>
                  <div className="text-sm text-muted-foreground">
                    {d.leadId ? <Link to="/leads/$id" params={{ id: d.leadId }} className="hover:text-primary">{d.clientName}</Link> : d.clientName}
                    {d.company ? ` · ${d.company}` : ""} · {d.clientType === "crm" ? "CRM client" : "Other client"} · due {formatDate(d.dueDate)} · {DEAL_STATUS_LABEL[d.status]}
                  </div>
                </div>
                <span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold capitalize", TONE[st])}>{st}</span>
              </div>
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-success transition-all" style={{ width: `${pct * 100}%` }} /></div>
              <div className="num mt-2 flex flex-wrap items-center justify-between gap-2 text-sm">
                <span><b>{formatINR(got)}</b> of {formatINR(d.finalAmount)} <span className="text-muted-foreground">· quoted {formatINR(d.quotedAmount)} · {formatINR(out)} due</span></span>
                <div className="flex gap-2">
                  <Button size="sm" variant="ghost" onClick={() => setOpenId(openId === d.id ? null : d.id)}>History ({hist.length})<ChevronDown className={cn("size-4 transition-transform", openId === d.id && "rotate-180")} /></Button>
                  {out > 0 && d.status !== "cancelled" && <Button size="sm" onClick={() => setPay(d)}>Record payment</Button>}
                </div>
              </div>
              {openId === d.id && (
                <ul className="mt-3 divide-y rounded-lg border text-sm">
                  {hist.length === 0 && <li className="p-3 text-muted-foreground">No payments yet.</li>}
                  {hist.map((p) => <PaymentRow key={p.id} id={p.id} />)}
                </ul>
              )}
            </div>
          );
        })}
      </div>
      <NewDealDialog open={addDeal} onOpenChange={setAddDeal} />
      {pay && <PaymentDialog deal={pay} onClose={() => setPay(null)} />}
    </Shell>
  );
}

function PaymentRow({ id }: { id: string }) {
  const { payments, voidPayment } = useCRM();
  const p = payments.find((x) => x.id === id)!;
  return (
    <li className={cn("num flex items-center justify-between gap-2 p-3", p.voided && "text-muted-foreground line-through")}>
      <span>{formatDate(p.date, { day: "numeric", month: "short", year: "numeric" })} · {p.method} · <span className="capitalize">{p.type}</span>{p.reference ? ` · ${p.reference}` : ""}</span>
      <span className="flex items-center gap-3"><b>{formatINR(p.amount)}</b>{!p.voided && <button className="text-xs text-muted-foreground hover:text-destructive" onClick={() => { if (window.confirm("Void this payment?")) { voidPayment(p.id); toast.success("Payment voided"); } }}>Void</button>}</span>
    </li>
  );
}

function PaymentDialog({ deal, onClose }: { deal: Deal; onClose: () => void }) {
  const { payments, addPayment } = useCRM();
  const out = dealOutstanding(deal, payments);
  const [amount, setAmount] = useState(String(out));
  const [method, setMethod] = useState<PaymentMethod>("UPI");
  const [type, setType] = useState<PaymentType>("milestone");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [ref, setRef] = useState("");
  const save = () => {
    const n = Number(amount);
    if (!(n > 0)) { toast.error("Enter a valid amount"); return; }
    if (n > out) { toast.error(`Amount exceeds the ${formatINR(out)} outstanding`); return; }
    addPayment({ dealId: deal.id, amount: n, date, method, type: n === out ? "final" : type, ...(ref ? { reference: ref } : {}) });
    toast.success(`${formatINR(n)} recorded for ${deal.clientName}`);
    onClose();
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Record payment · {deal.name}</DialogTitle></DialogHeader>
        <p className="num text-sm text-muted-foreground">Outstanding: <b className="text-foreground">{formatINR(out)}</b></p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5"><Label>Amount (₹)</Label><Input type="number" min={1} max={out} value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
          <div className="grid gap-1.5"><Label>Date</Label><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
          <div className="grid gap-1.5"><Label>Method</Label><select className={selectCls} value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>{METHODS.map((m) => <option key={m}>{m}</option>)}</select></div>
          <div className="grid gap-1.5"><Label>Type</Label><select className={selectCls} value={type} onChange={(e) => setType(e.target.value as PaymentType)}>{["advance", "milestone", "final", "other"].map((t) => <option key={t} value={t}>{t[0]!.toUpperCase() + t.slice(1)}</option>)}</select></div>
          <div className="grid gap-1.5 sm:col-span-2"><Label>Reference</Label><Input placeholder="UTR / cheque no. (optional)" value={ref} onChange={(e) => setRef(e.target.value)} /></div>
        </div>
        <DialogFooter><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={save}>Save payment</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function NewDealDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { leads, addDeal } = useCRM();
  const [type, setType] = useState<"crm" | "other">("crm");
  const [leadId, setLeadId] = useState("");
  const [f, setF] = useState({ clientName: "", company: "", phone: "", name: "", quoted: "", final: "", due: "", status: "active" as DealStatus });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const save = () => {
    const lead = leads.find((l) => l.id === leadId);
    const clientName = type === "crm" ? lead?.name : f.clientName.trim();
    if (!clientName || !f.name.trim() || !(Number(f.final) > 0)) { toast.error("Client, deal name and final amount are required"); return; }
    const company = type === "crm" ? lead?.company : f.company;
    addDeal({ clientType: type, clientName, name: f.name.trim(), quotedAmount: Number(f.quoted) || Number(f.final), finalAmount: Number(f.final), status: f.status, milestones: [],
      ...(type === "crm" && lead ? { leadId: lead.id } : {}), ...(company ? { company } : {}), ...(f.phone && type === "other" ? { phone: f.phone } : {}), ...(f.due ? { dueDate: f.due } : {}) });
    toast.success("Deal created"); onOpenChange(false);
    setF({ clientName: "", company: "", phone: "", name: "", quoted: "", final: "", due: "", status: "active" }); setLeadId("");
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader><DialogTitle>New deal</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1">
          {(["crm", "other"] as const).map((t) => <button key={t} onClick={() => setType(t)} className={cn("rounded-md py-1.5 text-sm font-medium", type === t ? "bg-card shadow-card" : "text-muted-foreground")}>{t === "crm" ? "CRM lead" : "Other client"}</button>)}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {type === "crm" ? (
            <div className="grid gap-1.5 sm:col-span-2"><Label>Lead</Label><select className={selectCls} value={leadId} onChange={(e) => setLeadId(e.target.value)}><option value="">Select lead…</option>{leads.map((l) => <option key={l.id} value={l.id}>{l.name}{l.company ? ` · ${l.company}` : ""}</option>)}</select></div>
          ) : (<>
            <div className="grid gap-1.5"><Label>Client name</Label><Input value={f.clientName} onChange={set("clientName")} /></div>
            <div className="grid gap-1.5"><Label>Company</Label><Input value={f.company} onChange={set("company")} /></div>
            <div className="grid gap-1.5 sm:col-span-2"><Label>Phone</Label><Input value={f.phone} onChange={set("phone")} /></div>
          </>)}
          <div className="grid gap-1.5 sm:col-span-2"><Label>Deal name</Label><Input placeholder="e.g. Website redesign" value={f.name} onChange={set("name")} /></div>
          <div className="grid gap-1.5"><Label>Quoted (₹)</Label><Input type="number" value={f.quoted} onChange={set("quoted")} /></div>
          <div className="grid gap-1.5"><Label>Final amount (₹)</Label><Input type="number" value={f.final} onChange={set("final")} /></div>
          <div className="grid gap-1.5"><Label>Due date</Label><Input type="date" value={f.due} onChange={set("due")} /></div>
          <div className="grid gap-1.5"><Label>Status</Label><select className={selectCls} value={f.status} onChange={set("status")}>{Object.entries(DEAL_STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
        </div>
        <DialogFooter><Button onClick={save}>Create deal</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
