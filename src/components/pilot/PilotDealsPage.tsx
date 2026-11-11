import { Link } from "@tanstack/react-router";
import { useState } from "react";
import {
  ArrowDownLeft,
  CalendarCheck,
  CalendarClock,
  Database,
  History,
  Paperclip,
  Plus,
  Search,
  Sparkles,
  Trash2,
  Wallet,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Empty, selectCls } from "@/components/crm/Shell";
import { cn } from "@/lib/utils";
import { formatDate, formatINR, formatINRCompact, formatPct, dayKey } from "@/lib/crm/format";
import { checkProofFile } from "@/lib/crm/attachments";
import { formatApiErrorMessage } from "@/lib/api/errors";
import {
  useDealsQuery,
  useOwnerFinanceSummaryQuery,
  usePaymentsQuery,
  useUploadProofMutation,
  useVerifyDealWonDateMutation,
} from "@/lib/api/financeApi";
import type { DealDto, PaymentDto } from "@/lib/api/schemas";
import { PilotShell } from "./PilotShell";
import { PilotNewDealDialog } from "./PilotNewDealDialog";
import { PilotPaymentDialog } from "./PilotPaymentDialog";
import { PilotVoidPaymentDialog } from "./PilotVoidPaymentDialog";
import { PilotCancelDealDialog } from "./PilotCancelDealDialog";
import { PilotDealAuditDrawer } from "./PilotDealAuditDrawer";
import { PilotProofViewer } from "./PilotProofViewer";

const TONE: Record<string, string> = {
  paid: "bg-success-soft text-success",
  partial: "bg-warning-soft text-warning",
  unpaid: "bg-neutral-soft text-muted-foreground",
  overdue: "bg-destructive-soft text-destructive",
  cancelled: "bg-neutral-soft text-muted-foreground",
};

export function PilotDealsPage({ search: _search }: { search: Record<string, unknown> }) {
  const [filter, setFilter] = useState<"all" | "due" | "overdue" | "paid" | "cancelled">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedDealId, setSelectedDealId] = useState<string | null>(null);

  // Dialog triggers
  const [showNewDeal, setShowNewDeal] = useState(false);
  const [payingDeal, setPayingDeal] = useState<DealDto | null>(null);
  const [cancellingDeal, setCancellingDeal] = useState<DealDto | null>(null);
  const [auditingDeal, setAuditingDeal] = useState<DealDto | null>(null);

  // Queries
  const { data: summaryData, isLoading: summaryLoading } = useOwnerFinanceSummaryQuery();
  const { data: dealsData, isLoading: dealsLoading } = useDealsQuery({ limit: 100 });

  const deals = dealsData?.items ?? [];
  const fin = summaryData ?? {
    totalBooked: 0,
    activeBooked: 0,
    cancelledBooked: 0,
    cashCollected: 0,
    activeCashCollected: 0,
    cancelledCashCollected: 0,
    outstanding: 0,
    overdue: 0,
    collectionRate: null,
    activeDealCount: 0,
    cancelledDealCount: 0,
    activePaymentCount: 0,
    voidedPaymentCount: 0,
  };

  // Filter deals
  const filteredDeals = deals.filter((d) => {
    const pStatus = d.financialSummary.paymentStatus;
    const matchesFilter =
      filter === "all" ||
      (filter === "due"
        ? pStatus === "partial" || pStatus === "unpaid" || pStatus === "overdue"
        : pStatus === filter);

    if (!matchesFilter) return false;

    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      d.name.toLowerCase().includes(q) ||
      d.clientName.toLowerCase().includes(q) ||
      (d.company && d.company.toLowerCase().includes(q)) ||
      (d.phone && d.phone.toLowerCase().includes(q))
    );
  });

  const selectedDeal = filteredDeals.find((d) => d.id === selectedDealId) ?? filteredDeals[0];
  const rate = Math.min((fin.collectionRate ?? 0) * 100, 100);

  return (
    <PilotShell
      title="Finance Studio (Pilot)"
      subtitle="MariaDB Backed Financial Ledger · Zero Browser-Local Data Contamination"
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5 rounded-full border border-teal/30 bg-teal-soft px-3 py-1 text-xs font-semibold text-teal">
            <Database className="size-3.5" />
            MariaDB Dev Mode
          </div>
          <Button
            type="button"
            onClick={() => setShowNewDeal(true)}
            className="rounded-full gap-1.5"
          >
            <Plus className="size-4" />
            New Deal
          </Button>
        </div>
      }
    >
      {/* Top Financial Summary Section */}
      <section className="panel-ink grid gap-8 p-6 sm:p-8 lg:grid-cols-[1.2fr_2fr]">
        <div>
          <div className="eyebrow">Total Booked (Active Deals)</div>
          <div className="num mt-3 text-[48px] leading-none">
            {summaryLoading ? "…" : formatINR(fin.activeBooked)}
          </div>
          <div className="mt-2 text-xs opacity-70">
            Excludes cancelled deals · Authoritative integer-paise math
          </div>
        </div>

        <div className="grid content-end gap-5">
          <div className="flex h-3 overflow-hidden rounded-full bg-[color-mix(in_oklab,var(--hero-foreground)_14%,transparent)]">
            <div
              className="bg-lime transition-all duration-300"
              style={{ width: `${rate}%` }}
              title={`Received: ${Math.round(rate)}%`}
            />
            <div
              className="bg-clay transition-all duration-300"
              style={{
                width: `${fin.activeBooked ? Math.min(fin.overdue / fin.activeBooked, 1) * 100 : 0}%`,
              }}
              title="Overdue"
            />
          </div>

          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div>
              <dt className="eyebrow flex items-center gap-1.5">
                <span className="size-2 rounded-full bg-lime" />
                Received
              </dt>
              <dd className="num mt-1 text-2xl">
                {summaryLoading ? "…" : formatINRCompact(fin.activeCashCollected)}
              </dd>
            </div>
            <div>
              <dt className="eyebrow flex items-center gap-1.5">
                <span className="size-2 rounded-full bg-[var(--hero-muted)]" />
                Outstanding
              </dt>
              <dd className="num mt-1 text-2xl">
                {summaryLoading ? "…" : formatINRCompact(fin.outstanding)}
              </dd>
            </div>
            <div>
              <dt className="eyebrow flex items-center gap-1.5">
                <span className="size-2 rounded-full bg-clay" />
                Overdue
              </dt>
              <dd className="num mt-1 text-2xl">
                {summaryLoading ? "…" : formatINRCompact(fin.overdue)}
              </dd>
            </div>
            <div>
              <dt className="eyebrow">Collection rate</dt>
              <dd className="num mt-1 text-2xl">
                {summaryLoading ? "…" : formatPct(fin.collectionRate)}
              </dd>
            </div>
          </dl>
        </div>
      </section>

      {/* Cancelled Deals Historical Accounting Callout */}
      {fin.cancelledCashCollected > 0 && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-4 text-xs">
          <div>
            <span className="font-semibold text-foreground">
              Historical Collections on Cancelled Deals:
            </span>{" "}
            <span className="font-mono font-bold text-teal">
              {formatINR(fin.cancelledCashCollected)}
            </span>{" "}
            across {fin.cancelledDealCount} cancelled deal(s).
            <p className="mt-0.5 text-muted-foreground">
              These funds were legitimately collected and remain in historical cash totals. They are
              not counted as active deal revenue and are not automatically refunded.
            </p>
          </div>
          <div className="font-mono text-[11px] text-muted-foreground">
            Booked ≠ Collected ≠ Outstanding ≠ Refunds
          </div>
        </div>
      )}

      {/* Main Ledger & Inspector Split View */}
      <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(320px,1fr)_1.35fr]">
        {/* Left Column: Search & Deals Ledger */}
        <div>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="eyebrow">Server Ledger ({filteredDeals.length})</div>
            <div className="seg" role="group" aria-label="Filter deals">
              {(["all", "due", "overdue", "paid", "cancelled"] as const).map((f) => (
                <button
                  type="button"
                  key={f}
                  aria-pressed={filter === f}
                  onClick={() => setFilter(f)}
                  className="capitalize"
                >
                  {f === "all" ? "All" : f === "due" ? "Due" : f}
                </button>
              ))}
            </div>
          </div>

          <div className="relative mb-3">
            <Search className="absolute top-2.5 left-3 size-4 text-muted-foreground" />
            <Input
              className="rounded-full pl-9 text-xs"
              placeholder="Search server deals by name, client, phone…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          <div role="listbox" aria-label="Deals" className="border-t border-foreground">
            {dealsLoading ? (
              <div className="py-12 text-center text-sm text-muted-foreground">
                Loading server deals from MariaDB…
              </div>
            ) : filteredDeals.length === 0 ? (
              <Empty
                icon={<Wallet className="size-8" />}
                title="No server deals match"
                hint={
                  searchQuery
                    ? "Try clearing your search query."
                    : "Create a deal to test server payments and private proof storage."
                }
                action={
                  <Button variant="outline" onClick={() => setShowNewDeal(true)}>
                    Create First Deal
                  </Button>
                }
              />
            ) : (
              filteredDeals.map((d) => {
                const st = d.financialSummary.paymentStatus;
                const got = d.financialSummary.collected;
                const pct = d.finalAmount ? Math.min(got / d.finalAmount, 1) * 100 : 0;

                return (
                  <div
                    key={d.id}
                    role="option"
                    tabIndex={0}
                    aria-selected={selectedDeal?.id === d.id}
                    onClick={() => setSelectedDealId(d.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setSelectedDealId(d.id);
                      }
                    }}
                    className={cn(
                      "ledger-row px-3 cursor-pointer transition-colors",
                      selectedDeal?.id === d.id && "bg-secondary",
                    )}
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold">{d.clientName}</div>
                      <div className="truncate text-xs text-muted-foreground">
                        {d.name} · {d.clientType === "crm" ? "Server Lead" : "Other Client"}
                      </div>
                      <div className="balance-track mt-2.5 h-1.5">
                        <div style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="num text-sm">{formatINR(d.finalAmount)}</div>
                      <span
                        className={cn(
                          "mt-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-medium capitalize",
                          TONE[st],
                        )}
                      >
                        {st}
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Right Column: Deal Inspector */}
        {selectedDeal ? (
          <PilotDealInspector
            deal={selectedDeal}
            onPay={() => setPayingDeal(selectedDeal)}
            onCancel={() => setCancellingDeal(selectedDeal)}
            onAudit={() => setAuditingDeal(selectedDeal)}
          />
        ) : (
          <div className="hidden lg:grid place-items-center rounded-2xl border border-dashed p-12 text-center text-sm text-muted-foreground">
            Select a deal to inspect its financial balance and payment history.
          </div>
        )}
      </div>

      {/* Dialog Modals */}
      <PilotNewDealDialog open={showNewDeal} onOpenChange={setShowNewDeal} />

      {payingDeal && (
        <PilotPaymentDialog deal={payingDeal} onClose={() => setPayingDeal(null)} />
      )}

      {cancellingDeal && (
        <PilotCancelDealDialog
          deal={cancellingDeal}
          onClose={() => setCancellingDeal(null)}
        />
      )}

      {auditingDeal && (
        <PilotDealAuditDrawer
          deal={auditingDeal}
          onClose={() => setAuditingDeal(null)}
        />
      )}
    </PilotShell>
  );
}

// ---------------------------------------------------------------------------
// Deal Inspector Component
// ---------------------------------------------------------------------------

function PilotDealInspector({
  deal: d,
  onPay,
  onCancel,
  onAudit,
}: {
  deal: DealDto;
  onPay: () => void;
  onCancel: () => void;
  onAudit: () => void;
}) {
  const sum = d.financialSummary;
  const st = sum.paymentStatus;
  const got = sum.collected;
  const out = sum.outstanding;
  const pct = d.finalAmount ? Math.min(got / d.finalAmount, 1) : 0;

  const { data: paymentsData, isLoading: paymentsLoading } = usePaymentsQuery({
    dealId: d.id,
  });
  const payments = paymentsData?.items ?? [];

  return (
    <aside aria-label={`${d.name} details`} className="receipt inspector self-start overflow-hidden">
      <div className="p-6 sm:p-8">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="eyebrow">
              {d.clientType === "crm" ? "Server Lead" : "Other Client"} · Status: {d.status}
            </div>
            <h2 className="editorial mt-2 text-[36px] font-bold leading-tight">{d.name}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {d.leadId ? (
                <Link
                  to="/leads"
                  search={{ pilot: 1 }}
                  className="underline-offset-4 hover:underline text-teal font-medium"
                >
                  {d.clientName}
                </Link>
              ) : (
                d.clientName
              )}
              {d.company ? ` · ${d.company}` : ""}
              {d.dueDate ? ` · Due ${formatDate(d.dueDate)}` : ""}
            </p>
          </div>
          <span className={cn("rounded-full px-2.5 py-1 text-xs font-medium capitalize", TONE[st])}>
            {st}
          </span>
        </div>

        {/* 4-Stat Grid */}
        <dl className="mt-7 grid grid-cols-2 gap-5 border-t border-foreground pt-5 sm:grid-cols-4">
          <div>
            <dt className="eyebrow">Quoted</dt>
            <dd className="num mt-1 text-lg text-muted-foreground">{formatINR(d.quotedAmount)}</dd>
          </div>
          <div>
            <dt className="eyebrow">Final</dt>
            <dd className="num mt-1 text-lg">{formatINR(d.finalAmount)}</dd>
          </div>
          <div>
            <dt className="eyebrow">Received</dt>
            <dd className="num mt-1 text-lg text-success">{formatINR(got)}</dd>
          </div>
          <div>
            <dt className="eyebrow">Outstanding</dt>
            <dd
              className={cn(
                "num mt-1 text-lg",
                st === "overdue" ? "text-destructive" : "text-warning",
              )}
            >
              {formatINR(out)}
            </dd>
          </div>
        </dl>

        {/* Progress Track */}
        <div className="balance-track mt-6">
          <div style={{ width: `${pct * 100}%` }} />
        </div>
        <div className="num mt-2 flex justify-between text-[11px] text-muted-foreground">
          <span>{Math.round(pct * 100)}% collected</span>
          {d.quotedAmount !== d.finalAmount && (
            <span>
              {d.finalAmount > d.quotedAmount ? "+" : "−"}
              {formatINR(Math.abs(d.finalAmount - d.quotedAmount))} vs quote
            </span>
          )}
        </div>

        {/* Action Controls */}
        <div className="mt-6 flex flex-wrap gap-2">
          {out > 0 && d.status !== "cancelled" && (
            <Button onClick={onPay} className="rounded-full gap-1.5">
              <Plus className="size-4" />
              Record Payment
            </Button>
          )}

          <Button variant="outline" onClick={onAudit} className="rounded-full gap-1.5 text-xs">
            <History className="size-3.5" />
            Audit Ledger
          </Button>

          {d.status !== "cancelled" && (
            <Button
              variant="ghost"
              onClick={onCancel}
              className="rounded-full gap-1 text-xs text-muted-foreground hover:text-destructive"
            >
              <XCircle className="size-3.5" />
              Cancel Deal
            </Button>
          )}

          <PilotVerifyWonDate deal={d} />
        </div>
      </div>

      <div className="receipt-edge" aria-hidden />

      {/* Payment History Section */}
      <div className="bg-secondary p-6 sm:p-8">
        <div className="eyebrow mb-4">Payment History · {payments.length}</div>
        {paymentsLoading ? (
          <div className="py-4 text-xs text-muted-foreground">Loading payments…</div>
        ) : payments.length === 0 ? (
          <div className="text-sm text-muted-foreground">No payments recorded for this deal yet.</div>
        ) : (
          <ul className="pay-timeline grid gap-3">
            {payments.map((p) => (
              <PilotPaymentRow key={p.id} payment={p} />
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}

// ---------------------------------------------------------------------------
// Payment Row Item
// ---------------------------------------------------------------------------

function PilotPaymentRow({ payment: p }: { payment: PaymentDto }) {
  const [viewProof, setViewProof] = useState(false);
  const [voidDialogOpen, setVoidDialogOpen] = useState(false);
  const uploadProofMutation = useUploadProofMutation();

  const handleUploadProof = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    const check = await checkProofFile(file);
    if (!check.ok) {
      toast.error(check.error);
      return;
    }

    try {
      await uploadProofMutation.mutateAsync({
        paymentId: p.id,
        file,
        originalFileName: file.name,
      });
      toast.success("Payment proof attached successfully");
    } catch (err: unknown) {
      toast.error(formatApiErrorMessage(err, "Failed to upload proof"), { duration: 8000 });
    }
  };

  return (
    <li
      className={cn(
        "flex flex-wrap items-start justify-between gap-2 rounded-xl border bg-card p-3 text-sm",
        p.voided && "is-void text-muted-foreground line-through opacity-70",
      )}
    >
      <div className="min-w-0">
        <div className="font-semibold text-foreground">
          {formatDate(p.date, { day: "numeric", month: "short", year: "numeric" })}
          <span className="ml-2 font-mono text-xs font-normal text-muted-foreground">
            {p.method} · <span className="capitalize">{p.type}</span>
            {p.reference ? ` · Ref: ${p.reference}` : ""}
          </span>
        </div>

        {/* Proof Action Pill */}
        <div className="mt-1.5 flex items-center gap-2 no-underline" style={{ textDecoration: "none" }}>
          {p.hasProof ? (
            <button
              type="button"
              onClick={() => setViewProof(true)}
              className="inline-flex items-center gap-1 rounded-full bg-success-soft px-2.5 py-0.5 text-[11px] font-medium text-success hover:underline"
            >
              <Paperclip className="size-3" />
              View proof
            </button>
          ) : !p.voided ? (
            <label
              htmlFor={`upload-proof-${p.id}`}
              className="inline-flex cursor-pointer items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
            >
              <Paperclip className="size-3" />
              {uploadProofMutation.isPending ? "Uploading…" : "Add proof"}
              <input
                id={`upload-proof-${p.id}`}
                type="file"
                hidden
                accept=".jpg,.jpeg,.png,.webp,.pdf,image/jpeg,image/png,image/webp,application/pdf"
                onChange={handleUploadProof}
              />
            </label>
          ) : null}

          {p.voided && p.voidReason && (
            <span className="rounded bg-destructive-soft px-1.5 py-0.5 text-[10px] text-destructive">
              Voided: {p.voidReason}
            </span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 no-underline" style={{ textDecoration: "none" }}>
        <span className="num font-bold text-foreground">{formatINR(p.amount)}</span>
        {!p.voided && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setVoidDialogOpen(true)}
            className="h-7 text-xs text-muted-foreground hover:text-destructive"
          >
            Void
          </Button>
        )}
      </div>

      {viewProof && (
        <PilotProofViewer payment={p} onClose={() => setViewProof(false)} />
      )}

      {voidDialogOpen && (
        <PilotVoidPaymentDialog
          payment={p}
          onClose={() => setVoidDialogOpen(false)}
        />
      )}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Verify Won Date Component
// ---------------------------------------------------------------------------

function PilotVerifyWonDate({ deal }: { deal: DealDto }) {
  const verifyMutation = useVerifyDealWonDateMutation();
  const [open, setOpen] = useState(false);
  const [day, setDay] = useState("");
  const [confirm, setConfirm] = useState(false);

  if (deal.wonAt || deal.status === "cancelled") return null;

  const today = dayKey(new Date());

  const handleSave = async () => {
    if (!day || !confirm) return;
    try {
      await verifyMutation.mutateAsync({
        id: deal.id,
        payload: {
          version: deal.version,
          wonIstDate: day,
        },
      });
      toast.success("Verified won date recorded in MariaDB");
      setOpen(false);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to record won date";
      toast.error(msg);
    }
  };

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="rounded-full gap-1 text-xs"
        onClick={() => setOpen(true)}
      >
        <CalendarCheck className="size-3.5" />
        Record Won Date
      </Button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
        >
          <div className="w-full max-w-md rounded-2xl border bg-card p-6 shadow-xl space-y-4">
            <h3 className="text-lg font-bold">Record Verified Won Date</h3>
            <p className="text-xs text-muted-foreground">
              Enter the date this deal was officially won in India Standard Time. Once saved to
              MariaDB, it is permanent and cannot be modified.
            </p>

            <div className="grid gap-1.5">
              <Label htmlFor="won-date-picker">Won Date (IST)</Label>
              <Input
                id="won-date-picker"
                type="date"
                max={today}
                value={day}
                onChange={(e) => setDay(e.target.value)}
              />
            </div>

            <label className="flex items-start gap-2 text-xs text-muted-foreground cursor-pointer">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={confirm}
                onChange={(e) => setConfirm(e.target.checked)}
              />
              <span>I confirm this won date has been verified and agree it cannot be altered.</span>
            </label>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button
                disabled={!day || !confirm || verifyMutation.isPending}
                onClick={handleSave}
              >
                {verifyMutation.isPending ? "Saving…" : "Record Won Date"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
