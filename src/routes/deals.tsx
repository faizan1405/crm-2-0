import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { Plus, Wallet, ArrowDownLeft } from "lucide-react";
import { Shell, Empty, selectCls } from "@/components/crm/Shell";
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
      { title: "Finance Studio · Scale Flow Sales OS" },
      { name: "description", content: "Track deal value, collections and overdue balances." },
      { property: "og:title", content: "Finance Studio · Scale Flow Sales OS" },
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

  const sel = list.find((d) => d.id === openId) ?? list[0];
  const rate = Math.min((fin.collectionRate ?? 0) * 100, 100);
  return (
    <Shell title="Finance studio" subtitle={`${deals.length} deals across CRM clients and other clients · every figure comes from recorded payments`} actions={<Button onClick={() => setAddDeal(true)} className="rounded-full"><Plus className="size-4" />New deal</Button>}>
      <section className="panel-ink grid gap-8 p-6 sm:p-8 lg:grid-cols-[1.2fr_2fr]">
        <div><div className="eyebrow">Total booked</div><div className="num mt-3 text-[48px] leading-none">{formatINR(fin.totalValue)}</div><div className="mt-2 text-xs opacity-70">Excludes cancelled deals</div></div>
        <div className="grid content-end gap-5">
          <div className="flex h-3 overflow-hidden rounded-full bg-[color-mix(in_oklab,var(--hero-foreground)_14%,transparent)]"><div className="bg-lime" style={{ width: `${rate}%` }} title="Received" /><div className="bg-clay" style={{ width: `${fin.totalValue ? Math.min(fin.overdue / fin.totalValue, 1) * 100 : 0}%` }} title="Overdue" /></div>
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">{([["Received", formatINRCompact(fin.collected), "bg-lime"], ["Outstanding", formatINRCompact(fin.outstanding), "bg-[var(--hero-muted)]"], ["Overdue", formatINRCompact(fin.overdue), "bg-clay"], ["Collection rate", formatPct(fin.collectionRate), ""]] as const).map(([k, v, dot]) => <div key={k}><dt className="eyebrow flex items-center gap-1.5">{dot && <span className={cn("size-2 rounded-full", dot)} />}{k}</dt><dd className="num mt-1 text-2xl">{v}</dd></div>)}</dl>
        </div>
      </section>
      <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(320px,1fr)_1.35fr]">
        <div>
          <div className="mb-3 flex items-center justify-between gap-2"><div className="eyebrow">Ledger</div><div className="seg" role="group" aria-label="Filter deals">{(["all", "due", "overdue", "paid"] as const).map((f) => <button type="button" key={f} aria-pressed={filter === f} onClick={() => setFilter(f)} className="capitalize">{f === "all" ? "All" : f === "due" ? "Due" : f}</button>)}</div></div>
          <div role="listbox" aria-label="Deals" className="border-t border-foreground">
            {list.length === 0 && <Empty icon={<Wallet />} title="No deals here" />}
            {list.map((d) => { const st = dealPaymentStatus(d, payments); const got = dealCollected(d.id, payments); return (
              <div key={d.id} role="option" tabIndex={0} aria-selected={sel?.id === d.id} onClick={() => setOpenId(d.id)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpenId(d.id); } }} className="ledger-row px-3">
                <div className="min-w-0"><div className="truncate text-sm font-semibold">{d.clientName}</div><div className="truncate text-xs text-muted-foreground">{d.name} · {d.clientType === "crm" ? "CRM client" : "Other client"}</div><div className="balance-track mt-2.5 h-1.5"><div style={{ width: `${d.finalAmount ? Math.min(got / d.finalAmount, 1) * 100 : 0}%` }} /></div></div>
                <div className="text-right"><div className="num text-sm">{formatINR(d.finalAmount)}</div><span className={cn("mt-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-medium capitalize", TONE[st])}>{st}</span></div>
              </div>); })}
          </div>
        </div>
        {sel && <DealInspector key={sel.id} deal={sel} onPay={() => setPay(sel)} onPick={setOpenId} />}
      </div>
      <NewDealDialog open={addDeal} onOpenChange={setAddDeal} />
      {pay && <PaymentDialog deal={pay} onClose={() => setPay(null)} />}
    </Shell>
  );
}

function DealInspector({ deal: d, onPay, onPick }: { deal: Deal; onPay: () => void; onPick: (id: string) => void }) {
  const { deals, payments } = useCRM();
  const st = dealPaymentStatus(d, payments), got = dealCollected(d.id, payments), out = dealOutstanding(d, payments);
  const hist = payments.filter((p) => p.dealId === d.id).sort((a, b) => b.date.localeCompare(a.date));
  const others = deals.filter((x) => x.id !== d.id && (d.leadId ? x.leadId === d.leadId : x.clientName === d.clientName));
  const pct = d.finalAmount ? Math.min(got / d.finalAmount, 1) : 0;
  return (
    <aside aria-label={`${d.name} details`} className="receipt inspector self-start overflow-hidden">
      <div className="p-6 sm:p-8">
        <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><div className="eyebrow">{d.clientType === "crm" ? "CRM client" : "Other client"} · {DEAL_STATUS_LABEL[d.status]}</div><h2 className="editorial mt-2 text-[40px]">{d.name}</h2><p className="mt-1 text-sm text-muted-foreground">{d.leadId ? <Link to="/leads/$id" params={{ id: d.leadId }} className="underline-offset-4 hover:underline">{d.clientName}</Link> : d.clientName}{d.company ? ` · ${d.company}` : ""}{d.dueDate ? ` · due ${formatDate(d.dueDate)}` : ""}</p></div><span className={cn("rounded-full px-2.5 py-1 text-xs font-medium capitalize", TONE[st])}>{st}</span></div>
        <dl className="mt-7 grid grid-cols-2 gap-5 border-t border-foreground pt-5 sm:grid-cols-4">
          <div><dt className="eyebrow">Quoted</dt><dd className="num mt-1 text-lg text-muted-foreground">{formatINR(d.quotedAmount)}</dd></div>
          <div><dt className="eyebrow">Final</dt><dd className="num mt-1 text-lg">{formatINR(d.finalAmount)}</dd></div>
          <div><dt className="eyebrow">Received</dt><dd className="num mt-1 text-lg text-success">{formatINR(got)}</dd></div>
          <div><dt className="eyebrow">Outstanding</dt><dd className={cn("num mt-1 text-lg", st === "overdue" ? "text-destructive" : "text-warning")}>{formatINR(out)}</dd></div>
        </dl>
        <div className="balance-track mt-6"><div style={{ width: `${pct * 100}%` }} /></div>
        <div className="num mt-2 flex justify-between text-[11px] text-muted-foreground"><span>{Math.round(pct * 100)}% collected</span>{d.quotedAmount !== d.finalAmount && <span>{d.finalAmount > d.quotedAmount ? "+" : "−"}{formatINR(Math.abs(d.finalAmount - d.quotedAmount))} vs quote</span>}</div>
        {out > 0 && d.status !== "cancelled" && <Button onClick={onPay} className="mt-6 rounded-full"><Plus className="size-4" />Record payment</Button>}
      </div>
      <div className="receipt-edge" aria-hidden />
      <div className="bg-secondary p-6 sm:p-8">
        <div className="eyebrow mb-4">Payment history · {hist.length}</div>
        <ul className="pay-timeline grid gap-4">{hist.length === 0 && <li className="text-sm text-muted-foreground">No payments yet.</li>}{hist.map((p) => <PaymentRow key={p.id} id={p.id} />)}</ul>
        {others.length > 0 && <div className="mt-8 border-t pt-5"><div className="eyebrow mb-3">Other deals for {d.clientName}</div><div className="grid gap-2">{others.map((o) => <button key={o.id} type="button" onClick={() => onPick(o.id)} className="flex items-center justify-between rounded-xl border bg-card px-3 py-2.5 text-left text-sm hover:border-input"><span className="truncate">{o.name}</span><span className="num">{formatINRCompact(o.finalAmount)}</span></button>)}</div></div>}
      </div>
    </aside>
  );
}

function PaymentRow({ id }: { id: string }) {
  const { payments, voidPayment } = useCRM();
  const p = payments.find((x) => x.id === id);
  if (!p) return null;
  return (
    <li className={cn("flex items-start justify-between gap-2 text-sm", p.voided && "is-void text-muted-foreground line-through")}>
      <span><span className="block font-medium">{formatDate(p.date, { day: "numeric", month: "short", year: "numeric" })}</span><span className="text-xs text-muted-foreground">{p.method} · <span className="capitalize">{p.type}</span>{p.reference ? ` · ${p.reference}` : ""}</span></span>
      <span className="flex items-center gap-2"><span className="num">{formatINR(p.amount)}</span>{!p.voided && <Button size="sm" variant="ghost" className="text-xs text-muted-foreground hover:text-destructive" onClick={() => { if (window.confirm("Void this payment?")) { voidPayment(p.id); toast.success("Payment voided"); } }}>Void</Button>}</span>
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
