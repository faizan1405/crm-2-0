import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  FileText,
  Calendar,
  CheckCircle2,
  XCircle,
  Share2,
  Printer,
  History,
  AlertTriangle,
  Archive,
  RotateCcw,
  Sparkles,
  Pencil,
  Plus,
  Trash2,
  Building2,
  User,
  ExternalLink,
} from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { selectCls } from "@/components/crm/ShellPrimitives";
import {
  useArchiveQuotationMutation,
  useChangeQuotationStatusMutation,
  useQuotationAuditEventsQuery,
  useQuotationQuery,
  useQuotationRevisionsQuery,
  useRestoreQuotationMutation,
  useUpdateQuotationMutation,
} from "@/lib/api/quotationsApi";
import type { QuotationDto, QuotationDiscountTypeApi } from "@/lib/api/schemas";
import { formatDateTime, formatDate, formatINR } from "@/lib/crm/format";
import { isApiError } from "@/lib/api/errors";

interface PilotQuotationDetailDrawerProps {
  quotationId: string | null;
  onClose: () => void;
}

export function PilotQuotationDetailDrawer({
  quotationId,
  onClose,
}: PilotQuotationDetailDrawerProps) {
  const open = Boolean(quotationId);
  const { data: quoteData, isLoading } = useQuotationQuery(quotationId ?? "");
  const quotation: QuotationDto | undefined = quoteData?.quotation;

  const { data: revData } = useQuotationRevisionsQuery(quotationId ?? "", undefined);
  const revisions = revData?.items ?? [];

  const { data: auditData } = useQuotationAuditEventsQuery(quotationId ?? "", undefined);
  const auditEvents = auditData?.items ?? [];

  const updateMutation = useUpdateQuotationMutation();
  const statusMutation = useChangeQuotationStatusMutation();
  const archiveMutation = useArchiveQuotationMutation();
  const restoreMutation = useRestoreQuotationMutation();

  const [activeTab, setActiveTab] = useState<"overview" | "edit" | "revisions" | "audit">("overview");
  const [busy, setBusy] = useState(false);
  const [staleError, setStaleError] = useState<string | null>(null);

  // Edit form state
  const [editTitle, setEditTitle] = useState("");
  const [editClientName, setEditClientName] = useState("");
  const [editClientCompany, setEditClientCompany] = useState("");
  const [editTerms, setEditTerms] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [editDiscountType, setEditDiscountType] = useState<QuotationDiscountTypeApi>("none");
  const [editDiscountValue, setEditDiscountValue] = useState("");
  const [editGstEnabled, setEditGstEnabled] = useState(false);
  const [editGstRate, setEditGstRate] = useState("18");
  const [editItems, setEditItems] = useState<Array<{ id: string; description: string; quantity: string; unitPrice: string }>>([]);
  const [editMilestones, setEditMilestones] = useState<Array<{ id: string; label: string; percentage: string; dueDate: string }>>([]);

  useEffect(() => {
    if (quotation) {
      setEditTitle(quotation.title);
      setEditClientName(quotation.clientName);
      setEditClientCompany(quotation.clientCompany ?? "");
      setEditTerms(quotation.paymentTerms ?? "");
      setEditNotes(quotation.notes ?? "");
      setEditDiscountType(quotation.discountType);
      setEditDiscountValue(quotation.discountValue > 0 ? String(quotation.discountValue) : "");
      setEditGstEnabled(quotation.gstEnabled);
      setEditGstRate(quotation.gstRate > 0 ? String(quotation.gstRate) : "18");
      setEditItems(
        quotation.items.map((it) => ({
          id: it.id,
          description: it.description,
          quantity: String(it.quantity),
          unitPrice: String(it.unitPrice),
        })),
      );
      setEditMilestones(
        quotation.milestones.map((ms) => ({
          id: ms.id,
          label: ms.label,
          percentage: String(ms.percentage),
          dueDate: ms.dueDate ?? "",
        })),
      );
      setStaleError(null);
    }
  }, [quotation]);

  if (!open) return null;

  const handleStatusChange = async (nextStatus: "sent" | "accepted" | "rejected") => {
    if (!quotation) return;
    setBusy(true);
    try {
      await statusMutation.mutateAsync({
        id: quotation.id,
        payload: {
          status: nextStatus,
          userConfirmedSent: nextStatus === "sent" ? true : undefined,
          expectedVersion: quotation.version,
        },
      });
      toast.success(`Quotation marked as ${nextStatus}`);
    } catch (err: unknown) {
      if (isApiError(err) && err.status === 409) {
        toast.error("Quotation was modified in another session. Please refresh.");
      } else {
        toast.error(err instanceof Error ? err.message : "Failed to change status");
      }
    } finally {
      setBusy(false);
    }
  };

  const handleShareWhatsApp = () => {
    if (!quotation) return;
    const body = `Hi ${quotation.clientName},\n\nHere is our formal quotation for *${quotation.title}*:\n` +
      `Total Investment: *${formatINR(quotation.totalAmount)}*\n` +
      `Terms: ${quotation.paymentTerms || "Standard milestones"}\n\n` +
      `Please let us know if you have any questions!`;
    const encoded = encodeURIComponent(body);
    window.open(`https://wa.me/?text=${encoded}`, "_blank");

    if (quotation.status === "draft") {
      void handleStatusChange("sent");
    }
  };

  const handlePrint = () => {
    window.print();
  };

  const handleSaveEdit = async () => {
    if (!quotation) return;
    if (!editTitle.trim() || !editClientName.trim()) {
      toast.error("Title and Client Name are required");
      return;
    }

    setBusy(true);
    setStaleError(null);
    try {
      await updateMutation.mutateAsync({
        id: quotation.id,
        payload: {
          expectedVersion: quotation.version,
          title: editTitle.trim(),
          clientName: editClientName.trim(),
          clientCompany: editClientCompany.trim() || null,
          paymentTerms: editTerms.trim() || null,
          notes: editNotes.trim() || null,
          discountType: editDiscountType,
          discountValue: editDiscountType !== "none" ? Number(editDiscountValue) || 0 : 0,
          gstEnabled: editGstEnabled,
          gstRate: editGstEnabled ? Number(editGstRate) || 18 : 0,
          items: editItems.map((it, idx) => ({
            description: it.description.trim(),
            quantity: Number(it.quantity) || 1,
            unitPrice: Number(it.unitPrice) || 0,
            sortOrder: idx,
          })),
          milestones: editMilestones.map((ms, idx) => ({
            label: ms.label.trim(),
            percentage: Number(ms.percentage) || 0,
            dueDate: ms.dueDate.trim() || null,
            sortOrder: idx,
          })),
        },
      });
      toast.success("Quotation draft updated in MariaDB");
      setActiveTab("overview");
    } catch (err: unknown) {
      if (isApiError(err) && err.status === 409) {
        setStaleError("Stale version conflict: another tab or user saved changes to this quotation. Reload before applying further updates.");
      } else {
        toast.error(err instanceof Error ? err.message : "Failed to update quotation");
      }
    } finally {
      setBusy(false);
    }
  };

  const handleArchive = async () => {
    if (!quotation) return;
    if (!window.confirm(`Archive quotation ${quotation.quotationNumber}? It can be restored at any time.`)) return;
    setBusy(true);
    try {
      await archiveMutation.mutateAsync({ id: quotation.id, reason: "Archived by Owner" });
      toast.success("Quotation archived");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to archive");
    } finally {
      setBusy(false);
    }
  };

  const handleRestore = async () => {
    if (!quotation) return;
    setBusy(true);
    try {
      await restoreMutation.mutateAsync(quotation.id);
      toast.success("Quotation restored from archive");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to restore");
    } finally {
      setBusy(false);
    }
  };

  const statusTone = {
    draft: "bg-muted text-muted-foreground",
    sent: "bg-primary-soft text-primary",
    accepted: "bg-success-soft text-success",
    rejected: "bg-destructive-soft text-destructive",
  }[quotation?.status ?? "draft"];

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto p-0">
        <div className="p-6">
          <SheetHeader className="pb-4 border-b">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs font-bold text-muted-foreground">
                  {quotation?.quotationNumber ?? "..."}
                </span>
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider ${statusTone}`}>
                  {quotation?.status}
                </span>
                {quotation?.archivedAt && (
                  <span className="rounded bg-destructive/10 px-1.5 py-0.5 text-[10px] font-semibold text-destructive">
                    Archived
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1.5">
                <Button size="icon" variant="ghost" className="size-8" title="Print Proposal" onClick={handlePrint}>
                  <Printer className="size-4" />
                </Button>
                <Button size="icon" variant="ghost" className="size-8 text-primary" title="Share via WhatsApp" onClick={handleShareWhatsApp}>
                  <Share2 className="size-4" />
                </Button>
              </div>
            </div>
            <SheetTitle className="text-xl font-bold truncate mt-1">
              {quotation?.title ?? "Loading Quotation..."}
            </SheetTitle>
            <SheetDescription className="text-xs truncate">
              Client: <strong className="text-foreground">{quotation?.clientName}</strong>
              {quotation?.clientCompany ? ` · ${quotation.clientCompany}` : ""}
              {" · "}v{quotation?.version}
            </SheetDescription>
          </SheetHeader>

          {/* Navigation Tabs */}
          <div className="flex border-b my-4 text-xs font-semibold gap-4">
            <button
              type="button"
              className={`pb-2 border-b-2 ${activeTab === "overview" ? "border-primary text-primary" : "border-transparent text-muted-foreground"}`}
              onClick={() => setActiveTab("overview")}
            >
              Overview
            </button>
            {quotation?.status === "draft" && (
              <button
                type="button"
                className={`pb-2 border-b-2 ${activeTab === "edit" ? "border-primary text-primary" : "border-transparent text-muted-foreground"}`}
                onClick={() => setActiveTab("edit")}
              >
                Edit Draft
              </button>
            )}
            <button
              type="button"
              className={`pb-2 border-b-2 ${activeTab === "revisions" ? "border-primary text-primary" : "border-transparent text-muted-foreground"}`}
              onClick={() => setActiveTab("revisions")}
            >
              Revisions ({revisions.length})
            </button>
            <button
              type="button"
              className={`pb-2 border-b-2 ${activeTab === "audit" ? "border-primary text-primary" : "border-transparent text-muted-foreground"}`}
              onClick={() => setActiveTab("audit")}
            >
              Audit Trail ({auditEvents.length})
            </button>
          </div>

          {staleError && (
            <div role="alert" className="mb-4 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive-soft/50 p-3 text-xs text-destructive">
              <AlertTriangle className="size-4 shrink-0 mt-0.5" />
              <span>{staleError}</span>
            </div>
          )}

          {isLoading || !quotation ? (
            <div className="py-12 text-center text-sm text-muted-foreground">Loading quotation details...</div>
          ) : activeTab === "overview" ? (
            <div className="grid gap-5">
              {/* Total Investment Hero */}
              <div className="rounded-xl border bg-card p-4 shadow-sm flex items-center justify-between">
                <div>
                  <span className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">Total Investment</span>
                  <div className="text-2xl font-bold font-mono text-primary mt-0.5">
                    {formatINR(quotation.totalAmount)}
                  </div>
                </div>
                <div className="text-right text-xs text-muted-foreground">
                  <div>Issued: <strong className="text-foreground">{quotation.issueIstDate}</strong></div>
                  {quotation.validUntilIstDate && (
                    <div>Valid Until: <strong className="text-foreground">{quotation.validUntilIstDate}</strong></div>
                  )}
                </div>
              </div>

              {/* Status Action Buttons */}
              <div className="flex flex-wrap items-center gap-2 rounded-lg bg-muted/40 p-3 border">
                <span className="text-xs font-semibold mr-auto text-muted-foreground">Status Controls:</span>
                {quotation.status === "draft" && (
                  <Button size="sm" onClick={() => handleStatusChange("sent")} disabled={busy}>
                    <Share2 className="size-3.5 mr-1 text-primary" /> Mark as Sent
                  </Button>
                )}
                {quotation.status === "sent" && (
                  <>
                    <Button size="sm" variant="outline" className="text-success border-success/30 hover:bg-success-soft" onClick={() => handleStatusChange("accepted")} disabled={busy}>
                      <CheckCircle2 className="size-3.5 mr-1" /> Client Accepted
                    </Button>
                    <Button size="sm" variant="outline" className="text-destructive border-destructive/30 hover:bg-destructive-soft" onClick={() => handleStatusChange("rejected")} disabled={busy}>
                      <XCircle className="size-3.5 mr-1" /> Client Rejected
                    </Button>
                  </>
                )}
                {quotation.archivedAt ? (
                  <Button size="sm" variant="outline" onClick={handleRestore} disabled={busy}>
                    <RotateCcw className="size-3.5 mr-1" /> Restore
                  </Button>
                ) : (
                  <Button size="sm" variant="ghost" className="text-muted-foreground hover:text-destructive" onClick={handleArchive} disabled={busy}>
                    <Archive className="size-3.5 mr-1" /> Archive
                  </Button>
                )}
              </div>

              {/* Scope & Deliverables */}
              <div className="rounded-lg border bg-card p-4">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Scope of Deliverables</h4>
                <div className="divide-y text-xs">
                  {quotation.items.map((it) => (
                    <div key={it.id} className="py-2.5 flex items-center justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="font-semibold text-foreground">{it.description}</div>
                        <div className="text-muted-foreground mt-0.5">
                          Qty: {it.quantity} × {formatINR(it.unitPrice)}
                        </div>
                      </div>
                      <div className="font-mono font-bold text-foreground">
                        {formatINR(it.totalAmount)}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Subtotals & Taxes */}
                <div className="border-t pt-3 mt-2 grid gap-1.5 text-xs">
                  <div className="flex justify-between text-muted-foreground">
                    <span>Subtotal</span>
                    <span className="font-mono">{formatINR(quotation.subtotal)}</span>
                  </div>
                  {quotation.discountAmount > 0 && (
                    <div className="flex justify-between text-success">
                      <span>Discount ({quotation.discountType})</span>
                      <span className="font-mono">-{formatINR(quotation.discountAmount)}</span>
                    </div>
                  )}
                  {quotation.gstEnabled && (
                    <div className="flex justify-between text-muted-foreground">
                      <span>GST ({quotation.gstRate}%)</span>
                      <span className="font-mono">+{formatINR(quotation.gstAmount)}</span>
                    </div>
                  )}
                  <div className="flex justify-between font-bold text-foreground border-t pt-2 text-sm">
                    <span>Total Quoted</span>
                    <span className="font-mono text-primary">{formatINR(quotation.totalAmount)}</span>
                  </div>
                </div>
              </div>

              {/* Payment Milestones */}
              {quotation.milestones.length > 0 && (
                <div className="rounded-lg border bg-card p-4">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Payment Milestones</h4>
                  <div className="grid gap-2 text-xs">
                    {quotation.milestones.map((ms, idx) => (
                      <div key={ms.id} className="flex items-center justify-between p-2 rounded bg-muted/30 border">
                        <div>
                          <span className="font-semibold">{ms.label}</span>
                          <span className="ml-2 text-muted-foreground">({ms.percentage}%)</span>
                          {ms.dueDate && (
                            <span className="ml-2 text-[11px] text-muted-foreground">Due: {ms.dueDate}</span>
                          )}
                        </div>
                        <div className="font-mono font-bold text-foreground">
                          {formatINR(ms.amount)}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Terms and Notes */}
              {(quotation.paymentTerms || quotation.notes) && (
                <div className="rounded-lg border bg-card p-4 grid gap-3 text-xs">
                  {quotation.paymentTerms && (
                    <div>
                      <h4 className="font-semibold uppercase tracking-wider text-muted-foreground text-[10px] mb-1">Payment Terms</h4>
                      <p className="text-foreground leading-relaxed">{quotation.paymentTerms}</p>
                    </div>
                  )}
                  {quotation.notes && (
                    <div>
                      <h4 className="font-semibold uppercase tracking-wider text-muted-foreground text-[10px] mb-1">Notes</h4>
                      <p className="text-foreground leading-relaxed">{quotation.notes}</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : activeTab === "edit" ? (
            <div className="grid gap-4">
              <div className="grid gap-1.5">
                <label htmlFor="edit-title" className="text-xs font-semibold">Title</label>
                <Input id="edit-title" value={editTitle} onChange={(e) => setEditTitle(e.target.value)} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1.5">
                  <label htmlFor="edit-client-name" className="text-xs font-semibold">Client Name</label>
                  <Input id="edit-client-name" value={editClientName} onChange={(e) => setEditClientName(e.target.value)} />
                </div>
                <div className="grid gap-1.5">
                  <label htmlFor="edit-client-company" className="text-xs font-semibold">Client Company</label>
                  <Input id="edit-client-company" value={editClientCompany} onChange={(e) => setEditClientCompany(e.target.value)} />
                </div>
              </div>

              {/* Line Items Edit */}
              <div className="rounded-lg border p-3">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-xs font-semibold">Deliverables</span>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      setEditItems((prev) => [
                        ...prev,
                        { id: `it_${Date.now()}`, description: "", quantity: "1", unitPrice: "0" },
                      ])
                    }
                  >
                    + Add Item
                  </Button>
                </div>
                <div className="grid gap-2">
                  {editItems.map((it, idx) => (
                    <div key={it.id} className="flex gap-2 items-center">
                      <Input
                        className="flex-1 text-xs"
                        value={it.description}
                        onChange={(e) => {
                          const val = e.target.value;
                          setEditItems((prev) => prev.map((x, i) => (i === idx ? { ...x, description: val } : x)));
                        }}
                      />
                      <Input
                        type="number"
                        className="w-16 text-xs text-right"
                        value={it.quantity}
                        onChange={(e) => {
                          const val = e.target.value;
                          setEditItems((prev) => prev.map((x, i) => (i === idx ? { ...x, quantity: val } : x)));
                        }}
                      />
                      <Input
                        type="number"
                        className="w-24 text-xs text-right font-mono"
                        value={it.unitPrice}
                        onChange={(e) => {
                          const val = e.target.value;
                          setEditItems((prev) => prev.map((x, i) => (i === idx ? { ...x, unitPrice: val } : x)));
                        }}
                      />
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-8"
                        onClick={() => setEditItems((prev) => prev.filter((_, i) => i !== idx))}
                        disabled={editItems.length <= 1}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>

              <div className="grid gap-1.5">
                <label htmlFor="edit-notes" className="text-xs font-semibold">Proposal Notes & Additional Scope</label>
                <Textarea
                  id="edit-notes"
                  rows={3}
                  className="text-xs"
                  placeholder="Terms, caveats, or scope notes"
                  value={editNotes}
                  onChange={(e) => setEditNotes(e.target.value)}
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" onClick={() => setActiveTab("overview")}>Cancel</Button>
                <Button onClick={handleSaveEdit} disabled={busy}>
                  {busy ? "Saving Revision..." : "Save Draft Revision"}
                </Button>
              </div>
            </div>
          ) : activeTab === "revisions" ? (
            <div className="grid gap-3">
              <p className="text-xs text-muted-foreground">
                Every update and status transition creates an immutable historical snapshot.
              </p>
              {revisions.length === 0 ? (
                <div className="text-xs text-muted-foreground py-6 text-center">No revisions recorded.</div>
              ) : (
                <div className="divide-y border rounded-lg">
                  {revisions.map((rev) => (
                    <div key={rev.id} className="p-3 text-xs">
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-bold text-foreground">Revision #{rev.revisionNumber}</span>
                        <span className="text-muted-foreground">{formatDateTime(rev.createdAt)}</span>
                      </div>
                      <div className="text-muted-foreground mb-2">{rev.changeSummary || "Snapshot recorded"}</div>
                      <details className="text-[11px] font-mono bg-muted/40 p-2 rounded">
                        <summary className="cursor-pointer text-primary font-sans font-semibold">View snapshot payload</summary>
                        <pre className="mt-1 overflow-x-auto whitespace-pre-wrap">{JSON.stringify(rev.snapshot, null, 2)}</pre>
                      </details>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="grid gap-3">
              <p className="text-xs text-muted-foreground">Immutable audit event ledger for this quotation.</p>
              {auditEvents.length === 0 ? (
                <div className="text-xs text-muted-foreground py-6 text-center">No audit events recorded.</div>
              ) : (
                <div className="divide-y border rounded-lg text-xs">
                  {auditEvents.map((ev) => (
                    <div key={ev.id} className="p-3 flex items-start justify-between gap-3">
                      <div>
                        <div className="font-semibold text-foreground">{ev.summary}</div>
                        <div className="text-[11px] text-muted-foreground font-mono mt-0.5">{ev.eventType}</div>
                      </div>
                      <div className="text-right text-[11px] text-muted-foreground whitespace-nowrap">
                        {formatDateTime(ev.createdAt)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
