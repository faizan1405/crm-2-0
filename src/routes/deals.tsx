import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { Plus, Wallet, ChevronDown, IndianRupee, Target, AlertCircle, Percent, ArrowDownLeft } from "lucide-react";
import { Shell, Stat, Empty, selectCls } from "@/components/crm/Shell";
import { useCRM } from "@/lib/crm/store";
import { financeSummary, dealCollected, dealOutstanding, dealPaymentStatus } from "@/lib/crm/finance";
import { formatINR, formatINRCompact, formatPct, formatDate, dayKey } from "@/lib/crm/format";
import { DEAL_STATUS_LABEL, type Deal, type PaymentMethod, type PaymentType, type DealStatus } from "@/lib/crm/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/deals")({
  head: () => ({
    meta: [
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
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
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-5">
        <Stat label="Total deal value" value={formatINRCompact(fin.totalValue)} hint="Excludes cancelled" icon={<IndianRupee />} />
        <Stat label="Money received" value={formatINRCompact(fin.collected)} hint={`${formatPct(fin.collectionRate)} collected`} tone="success" icon={<Wallet />} />
        <Stat label="Outstanding" value={formatINRCompact(fin.outstanding)} tone="warning" icon={<Target />} />
        <Stat label="Overdue" value={formatINRCompact(fin.overdue)} tone="destructive" icon={<AlertCircle />} />
        <Stat label="Collection rate" value={formatPct(fin.collectionRate)} tone="teal" icon={<Percent />} />
      </div>
      <div className="mt-6 mb-3 flex gap-1 rounded-lg bg-muted p-1 sm:inline-flex">
        {(["all", "due", "overdue", "paid"] as const).map((f) => <Button variant="ghost" size="sm" key={f} onClick={() => setFilter(f)} className={cn("rounded-md px-3 py-1.5 text-sm font-medium capitalize", filter === f ? "bg-card shadow-card" : "text-muted-foreground")}>{f === "all" ? "All deals" : f === "due" ? "Payment due" : f}</Button>)}
      </div>
      <div className="grid gap-4">
        {list.length === 0 && <div className="surface"><Empty icon={<Wallet />} title="No deals here" /></div>}
        {list.map((d) => {
          const st = dealPaymentStatus(d, payments);
          const got = dealCollected(d.id, payments);
          const out = dealOutstanding(d, payments);
          const pct = d.finalAmount ? Math.min(got / d.finalAmount, 1) : 0;
          const hist = payments.filter((p) => p.dealId === d.id).sort((a, b) => b.date.localeCompare(a.date));
          return (
            <div key={d.id} className="deal-card surface surface-hover">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="mb-3 flex items-center gap-3"><div className="grid size-10 place-items-center rounded-lg bg-teal-soft text-teal"><Wallet className="size-5" /></div><div><div className="font-display font-bold">{d.name}</div><div className="mt-0.5 text-xs text-muted-foreground">{d.clientName}{d.company ? ` · ${d.company}` : ""}</div></div></div>
                  <div className="text-sm text-muted-foreground">
                    {d.leadId ? <Link to="/leads/$id" params={{ id: d.leadId }} className="hover:text-primary">{d.clientName}</Link> : d.clientName}
                    {d.company ? ` · ${d.company}` : ""} · {d.clientType === "crm" ? "CRM client" : "Other client"} · due {formatDate(d.dueDate)} · {DEAL_STATUS_LABEL[d.status]}
                  </div>
                </div>
                <span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold capitalize", TONE[st])}>{st}</span>
              </div>
              <div className="mt-5 grid grid-cols-3 gap-4 border-t pt-4"><div><span className="text-[10px] uppercase text-muted-foreground">Contract value</span><div className="num mt-1 text-lg font-bold">{formatINR(d.finalAmount)}</div></div><div><span className="text-[10px] uppercase text-muted-foreground">Received</span><div className="num mt-1 text-lg font-bold text-success">{formatINR(got)}</div></div><div><span className="text-[10px] uppercase text-muted-foreground">Outstanding</span><div className="num mt-1 text-lg font-bold text-warning">{formatINR(out)}</div></div></div>
              <div className="deal-progress mt-4 h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-success transition-all" style={{ width: `${pct * 100}%` }} /></div>
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
  const p = payments.find((x) => x.id === id);
  if (!p) return null;
  return (
    <li className={cn("num flex items-center justify-between gap-2 p-3", p.voided && "text-muted-foreground line-through")}>
      <span>{formatDate(p.date, { day: "numeric", month: "short", year: "numeric" })} · {p.method} · <span className="capitalize">{p.type}</span>{p.reference ? ` · ${p.reference}` : ""}</span>
      <span className="flex items-center gap-3"><b>{formatINR(p.amount)}</b>{!p.voided && <Button size="sm" variant="ghost" className="text-xs text-muted-foreground hover:text-destructive" onClick={() => { if (window.confirm("Void this payment?")) { voidPayment(p.id); toast.success("Payment voided"); } }}>Void</Button>}</span>
    </li>
  );
}

function PaymentDialog({ deal, onClose }: { deal: Deal; onClose: () => void }) {
  const { payments, addPayment } = useCRM();
  const out = dealOutstanding(deal, payments);
  const [amount, setAmount] = useState(String(out));
  const [method, setMethod] = useState<PaymentMethod>("UPI");
  const [type, setType] = useState<PaymentType>("milestone");
  const [date, setDate] = useState(dayKey(new Date()));
  const [ref, setRef] = useState("");
  const save = () => {
    const n = Number(amount);
    if (!Number.isFinite(n) || !(n > 0)) { toast.error("Enter a valid amount"); return; }
    if (n > out) { toast.error(`Amount exceeds the ${formatINR(out)} outstanding`); return; }
    const saved = addPayment({ dealId: deal.id, amount: n, date, method, type: n === out ? "final" : type, ...(ref ? { reference: ref } : {}) });
    if (!saved) { toast.error("Payment could not be recorded; check the balance and date"); return; }
    toast.success(`${formatINR(n)} recorded for ${deal.clientName}`);
    onClose();
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Record payment · {deal.name}</DialogTitle></DialogHeader>
        <div className="rounded-lg border border-teal/20 bg-teal-soft p-4"><div className="flex items-center gap-2 text-xs text-teal"><ArrowDownLeft className="size-4" />Payment for {deal.clientName}</div><div className="num mt-2 text-2xl font-extrabold text-foreground">{formatINR(out)}</div><div className="mt-1 text-xs text-muted-foreground">Outstanding balance</div></div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5"><Label htmlFor="pay-amount">Amount (₹)</Label><Input id="pay-amount" type="number" min={1} max={out} value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
          <div className="grid gap-1.5"><Label htmlFor="pay-date">Date</Label><Input id="pay-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
          <div className="grid gap-1.5"><Label htmlFor="pay-method">Method</Label><select id="pay-method" className={selectCls} value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>{METHODS.map((m) => <option key={m}>{m}</option>)}</select></div>
          <div className="grid gap-1.5"><Label htmlFor="pay-type">Type</Label><select id="pay-type" className={selectCls} value={type} onChange={(e) => setType(e.target.value as PaymentType)}>{["advance", "milestone", "final", "other"].map((t) => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}</select></div>
          <div className="grid gap-1.5 sm:col-span-2"><Label htmlFor="pay-ref">Reference</Label><Input id="pay-ref" placeholder="UTR / cheque no. (optional)" value={ref} onChange={(e) => setRef(e.target.value)} /></div>
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
          {(["crm", "other"] as const).map((t) => <Button variant="ghost" key={t} onClick={() => setType(t)} className={cn("rounded-md py-1.5 text-sm font-medium", type === t ? "bg-card shadow-card" : "text-muted-foreground")}>{t === "crm" ? "CRM lead" : "Other client"}</Button>)}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {type === "crm" ? (
            <div className="grid gap-1.5 sm:col-span-2"><Label htmlFor="deal-lead">Lead</Label><select id="deal-lead" className={selectCls} value={leadId} onChange={(e) => setLeadId(e.target.value)}><option value="">Select lead…</option>{leads.map((l) => <option key={l.id} value={l.id}>{l.name}{l.company ? ` · ${l.company}` : ""}</option>)}</select></div>
          ) : (<>
            <div className="grid gap-1.5"><Label htmlFor="deal-client">Client name</Label><Input id="deal-client" value={f.clientName} onChange={set("clientName")} /></div>
            <div className="grid gap-1.5"><Label htmlFor="deal-company">Company</Label><Input id="deal-company" value={f.company} onChange={set("company")} /></div>
            <div className="grid gap-1.5 sm:col-span-2"><Label htmlFor="deal-phone">Phone</Label><Input id="deal-phone" value={f.phone} onChange={set("phone")} /></div>
          </>)}
          <div className="grid gap-1.5 sm:col-span-2"><Label htmlFor="deal-name">Deal name</Label><Input id="deal-name" placeholder="e.g. Website redesign" value={f.name} onChange={set("name")} /></div>
          <div className="grid gap-1.5"><Label htmlFor="deal-quoted">Quoted (₹)</Label><Input id="deal-quoted" type="number" value={f.quoted} onChange={set("quoted")} /></div>
          <div className="grid gap-1.5"><Label htmlFor="deal-final">Final amount (₹)</Label><Input id="deal-final" type="number" value={f.final} onChange={set("final")} /></div>
          <div className="grid gap-1.5"><Label htmlFor="deal-due">Due date</Label><Input id="deal-due" type="date" value={f.due} onChange={set("due")} /></div>
          <div className="grid gap-1.5"><Label htmlFor="deal-status">Status</Label><select id="deal-status" className={selectCls} value={f.status} onChange={set("status")}>{Object.entries(DEAL_STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
        </div>
        <DialogFooter><Button onClick={save}>Create deal</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
