import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  FileText,
  Plus,
  Trash2,
  Percent,
  Sparkles,
  Calculator,
  Calendar,
  AlertCircle,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { selectCls } from "@/components/crm/ShellPrimitives";
import { useLeadsListQuery } from "@/lib/api/leadsApi";
import {
  useCreateQuotationMutation,
  useQuotationTemplatesQuery,
} from "@/lib/api/quotationsApi";
import type { LeadDto, QuotationDiscountTypeApi } from "@/lib/api/schemas";
import { formatINR } from "@/lib/crm/format";

interface LineItemDraft {
  id: string;
  description: string;
  quantity: string;
  unitPrice: string;
}

interface MilestoneDraft {
  id: string;
  label: string;
  percentage: string;
  dueDate: string;
}

interface PilotNewQuotationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  preselectedLeadId?: string | undefined;
  onCreated?: (quotationId: string) => void;
}

export function PilotNewQuotationDialog({
  open,
  onOpenChange,
  preselectedLeadId,
  onCreated,
}: PilotNewQuotationDialogProps) {
  const { data: leadsData } = useLeadsListQuery({ lifecycle: "active", limit: 100 }, open);
  const leads: LeadDto[] = leadsData?.items ?? [];
  const { data: templatesData } = useQuotationTemplatesQuery();
  const templates = templatesData?.items ?? [];

  const createMutation = useCreateQuotationMutation();

  const [leadId, setLeadId] = useState(preselectedLeadId ?? "");
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [title, setTitle] = useState("");
  const [clientName, setClientName] = useState("");
  const [clientCompany, setClientCompany] = useState("");
  const [validUntilIstDate, setValidUntilIstDate] = useState("");
  const [paymentTerms, setPaymentTerms] = useState("50% advance upon kickoff, 50% upon QA sign-off and deployment.");
  const [notes, setNotes] = useState("");

  // Financial inputs
  const [items, setItems] = useState<LineItemDraft[]>([
    { id: "1", description: "Design & High-Fidelity UI/UX Architecture", quantity: "1", unitPrice: "35000" },
    { id: "2", description: "Interactive 3D Visualizer & React Web App", quantity: "1", unitPrice: "45000" },
  ]);

  const [discountType, setDiscountType] = useState<QuotationDiscountTypeApi>("none");
  const [discountValue, setDiscountValue] = useState("");
  const [gstEnabled, setGstEnabled] = useState(false);
  const [gstRate, setGstRate] = useState("18");

  const [milestones, setMilestones] = useState<MilestoneDraft[]>([
    { id: "m1", label: "Kickoff Advance (50%)", percentage: "50", dueDate: "" },
    { id: "m2", label: "Final QA Handover (50%)", percentage: "50", dueDate: "" },
  ]);

  const [busy, setBusy] = useState(false);

  // Sync client details when lead selection changes
  useEffect(() => {
    if (preselectedLeadId) {
      setLeadId(preselectedLeadId);
    }
  }, [preselectedLeadId, open]);

  useEffect(() => {
    if (leadId) {
      const match = leads.find((l) => l.id === leadId);
      if (match) {
        setClientName(match.name);
        setClientCompany(match.company ?? "");
        if (!title) {
          setTitle(`${match.name} · Digital Project Proposal`);
        }
      }
    }
  }, [leadId, leads]);

  // Apply template defaults when template is selected
  const applyTemplate = (tplId: string) => {
    setSelectedTemplateId(tplId);
    if (!tplId) return;
    const tpl = templates.find((t) => t.id === tplId);
    if (!tpl) return;

    if (!title || title.endsWith("Digital Project Proposal")) {
      setTitle(tpl.name);
    }

    if (tpl.priceType === "fixed" && tpl.priceAmount) {
      setItems([
        {
          id: `item_${Date.now()}`,
          description: tpl.name,
          quantity: "1",
          unitPrice: String(tpl.priceAmount),
        },
      ]);
    }
  };

  // Milestone presets
  const applyMilestonePreset = (preset: "50-50" | "30-70" | "10-40-50" | "100") => {
    if (preset === "50-50") {
      setMilestones([
        { id: "m1", label: "Advance Deposit (50%)", percentage: "50", dueDate: "" },
        { id: "m2", label: "Final Handover (50%)", percentage: "50", dueDate: "" },
      ]);
    } else if (preset === "30-70") {
      setMilestones([
        { id: "m1", label: "Project Kickoff (30%)", percentage: "30", dueDate: "" },
        { id: "m2", label: "Go-Live Delivery (70%)", percentage: "70", dueDate: "" },
      ]);
    } else if (preset === "10-40-50") {
      setMilestones([
        { id: "m1", label: "Token Deposit (10%)", percentage: "10", dueDate: "" },
        { id: "m2", label: "Design Approval (40%)", percentage: "40", dueDate: "" },
        { id: "m3", label: "Production Release (50%)", percentage: "50", dueDate: "" },
      ]);
    } else if (preset === "100") {
      setMilestones([
        { id: "m1", label: "Full Payment (100%)", percentage: "100", dueDate: "" },
      ]);
    }
  };

  // Pure integer-paise calculations
  const calc = useMemo(() => {
    let subtotalPaise = 0;
    for (const it of items) {
      const q = Number(it.quantity) || 0;
      const u = Number(it.unitPrice) || 0;
      const itemPaise = Math.round(Math.round(q * 100) * Math.round(u * 100) / 100);
      subtotalPaise += itemPaise;
    }

    let discountPaise = 0;
    if (discountType === "flat") {
      const dNum = Number(discountValue) || 0;
      discountPaise = Math.min(subtotalPaise, Math.round(dNum * 100));
    } else if (discountType === "percent") {
      const pct = Number(discountValue) || 0;
      if (pct > 0 && pct <= 100) {
        discountPaise = Math.round((subtotalPaise * Math.round(pct * 100)) / 10000);
      }
    }

    const taxablePaise = Math.max(0, subtotalPaise - discountPaise);

    let gstPaise = 0;
    if (gstEnabled) {
      const rate = Number(gstRate) || 0;
      if (rate > 0 && rate <= 100) {
        gstPaise = Math.round((taxablePaise * Math.round(rate * 100)) / 10000);
      }
    }

    const totalPaise = taxablePaise + gstPaise;

    // Check milestone basis points sum
    let totalBasisPoints = 0;
    for (const ms of milestones) {
      const p = Number(ms.percentage) || 0;
      totalBasisPoints += Math.round(p * 100);
    }
    const isMilestonesExact100 = totalBasisPoints === 10000;

    return {
      subtotal: subtotalPaise / 100,
      discount: discountPaise / 100,
      taxable: taxablePaise / 100,
      gst: gstPaise / 100,
      total: totalPaise / 100,
      totalPaise,
      milestoneTotalPct: (totalBasisPoints / 100).toFixed(2),
      isMilestonesExact100,
    };
  }, [items, discountType, discountValue, gstEnabled, gstRate, milestones]);

  const handleAddItem = () => {
    setItems((prev) => [
      ...prev,
      { id: `item_${Date.now()}`, description: "", quantity: "1", unitPrice: "0" },
    ]);
  };

  const handleRemoveItem = (idx: number) => {
    setItems((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleAddMilestone = () => {
    setMilestones((prev) => [
      ...prev,
      { id: `m_${Date.now()}`, label: `Milestone ${prev.length + 1}`, percentage: "0", dueDate: "" },
    ]);
  };

  const handleRemoveMilestone = (idx: number) => {
    setMilestones((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleSave = async () => {
    if (!title.trim()) {
      toast.error("Quotation title is required");
      return;
    }
    if (!clientName.trim()) {
      toast.error("Client name is required");
      return;
    }
    if (items.length === 0) {
      toast.error("Add at least one line item");
      return;
    }
    for (let i = 0; i < items.length; i++) {
      if (!items[i]!.description.trim()) {
        toast.error(`Item ${i + 1} requires a description`);
        return;
      }
      const unitNum = Number(items[i]!.unitPrice);
      if (!Number.isFinite(unitNum) || unitNum < 0) {
        toast.error(`Item ${i + 1} unit price must be zero or greater`);
        return;
      }
    }

    if (milestones.length > 0 && !calc.isMilestonesExact100) {
      toast.error(`Milestone schedule must sum to exactly 100.00% (currently ${calc.milestoneTotalPct}%)`);
      return;
    }

    setBusy(true);
    try {
      const res = await createMutation.mutateAsync({
        leadId: leadId ? leadId : undefined,
        templateId: selectedTemplateId ? selectedTemplateId : undefined,
        title: title.trim(),
        clientName: clientName.trim(),
        clientCompany: clientCompany.trim() || undefined,
        validUntilIstDate: validUntilIstDate.trim() || undefined,
        paymentTerms: paymentTerms.trim() || undefined,
        notes: notes.trim() || undefined,
        items: items.map((it, idx) => ({
          description: it.description.trim(),
          quantity: Number(it.quantity) || 1,
          unitPrice: Number(it.unitPrice) || 0,
          sortOrder: idx,
        })),
        discountType,
        discountValue: discountType !== "none" ? Number(discountValue) || 0 : 0,
        gstEnabled,
        gstRate: gstEnabled ? Number(gstRate) || 18 : 0,
        milestones: milestones.map((ms, idx) => ({
          label: ms.label.trim(),
          percentage: Number(ms.percentage) || 0,
          dueDate: ms.dueDate.trim() || undefined,
          sortOrder: idx,
        })),
      });

      toast.success(`Quotation ${res.quotation.quotationNumber} saved to MariaDB!`);
      onOpenChange(false);
      onCreated?.(res.quotation.id);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to create quotation.";
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[94dvh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="size-5 text-primary" />
            Create Client Quotation
          </DialogTitle>
          <DialogDescription>
            Construct an exact-money client proposal stored in MariaDB. Revisions and milestones are tracked atomically.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-5 py-2">
          {/* Header & Client Association */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <label htmlFor="quote-lead" className="text-xs font-semibold">Associated Lead (Optional)</label>
              <select
                id="quote-lead"
                className={selectCls}
                value={leadId}
                onChange={(e) => setLeadId(e.target.value)}
              >
                <option value="">-- No Lead Link (Direct Client) --</option>
                {leads.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name} {l.company ? `· ${l.company}` : ""}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid gap-1.5">
              <label htmlFor="quote-template" className="text-xs font-semibold">Load Package Template (Optional)</label>
              <select
                id="quote-template"
                className={selectCls}
                value={selectedTemplateId}
                onChange={(e) => applyTemplate(e.target.value)}
              >
                <option value="">-- Custom Proposal (No Template) --</option>
                {templates.filter((t) => t.isActive).map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} {t.priceAmount ? `(₹${t.priceAmount.toLocaleString("en-IN")})` : ""}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="grid gap-1.5 sm:col-span-1">
              <label htmlFor="quote-title" className="text-xs font-semibold">Proposal Title</label>
              <Input
                id="quote-title"
                placeholder="e.g. Next.js Commerce Redesign"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>

            <div className="grid gap-1.5">
              <label htmlFor="quote-client" className="text-xs font-semibold">Client Name</label>
              <Input
                id="quote-client"
                placeholder="e.g. Rajesh Sharma"
                value={clientName}
                onChange={(e) => setClientName(e.target.value)}
              />
            </div>

            <div className="grid gap-1.5">
              <label htmlFor="quote-company" className="text-xs font-semibold">Client Company</label>
              <Input
                id="quote-company"
                placeholder="e.g. Nexus Retail"
                value={clientCompany}
                onChange={(e) => setClientCompany(e.target.value)}
              />
            </div>
          </div>

          {/* Line Items Table */}
          <div className="rounded-lg border bg-card p-3.5">
            <div className="flex items-center justify-between pb-2">
              <div className="flex items-center gap-1.5">
                <Calculator className="size-4 text-primary" />
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Scope & Deliverables</h4>
              </div>
              <Button type="button" size="sm" variant="outline" onClick={handleAddItem}>
                <Plus className="size-3.5 mr-1" /> Add Deliverable
              </Button>
            </div>

            <div className="grid gap-2">
              {items.map((it, idx) => (
                <div key={it.id} className="flex items-center gap-2">
                  <Input
                    className="flex-1 text-xs"
                    placeholder={`Deliverable ${idx + 1} description`}
                    value={it.description}
                    onChange={(e) => {
                      const val = e.target.value;
                      setItems((prev) => prev.map((x, i) => (i === idx ? { ...x, description: val } : x)));
                    }}
                  />
                  <div className="w-20">
                    <Input
                      type="number"
                      min={0.1}
                      step="any"
                      className="text-xs text-right"
                      placeholder="Qty"
                      value={it.quantity}
                      onChange={(e) => {
                        const val = e.target.value;
                        setItems((prev) => prev.map((x, i) => (i === idx ? { ...x, quantity: val } : x)));
                      }}
                    />
                  </div>
                  <div className="w-28">
                    <Input
                      type="number"
                      min={0}
                      step="any"
                      className="text-xs text-right font-mono"
                      placeholder="Rate ₹"
                      value={it.unitPrice}
                      onChange={(e) => {
                        const val = e.target.value;
                        setItems((prev) => prev.map((x, i) => (i === idx ? { ...x, unitPrice: val } : x)));
                      }}
                    />
                  </div>
                  <div className="w-24 text-right font-mono text-xs font-semibold text-foreground">
                    {formatINR(((Number(it.quantity) || 0) * (Number(it.unitPrice) || 0)))}
                  </div>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="size-8 text-muted-foreground hover:text-destructive"
                    onClick={() => handleRemoveItem(idx)}
                    disabled={items.length <= 1}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          </div>

          {/* Discounts & GST Controls */}
          <div className="grid gap-4 rounded-lg border bg-card p-3.5 sm:grid-cols-2">
            <div className="grid gap-2">
              <label className="text-xs font-semibold">Commercial Discount</label>
              <div className="flex gap-2">
                <select
                  aria-label="Discount Type"
                  className={selectCls + " w-32"}
                  value={discountType}
                  onChange={(e) => setDiscountType(e.target.value as QuotationDiscountTypeApi)}
                >
                  <option value="none">None</option>
                  <option value="flat">₹ Flat Off</option>
                  <option value="percent">% Percent</option>
                </select>
                {discountType !== "none" && (
                  <Input
                    type="number"
                    min={0}
                    step="any"
                    placeholder={discountType === "percent" ? "10%" : "5000"}
                    value={discountValue}
                    onChange={(e) => setDiscountValue(e.target.value)}
                    className="flex-1 font-mono text-xs"
                  />
                )}
              </div>
            </div>

            <div className="grid gap-2">
              <div className="flex items-center justify-between">
                <label htmlFor="quote-gst-toggle" className="text-xs font-semibold">Include GST (18%)</label>
                <Switch
                  id="quote-gst-toggle"
                  aria-label="Toggle GST"
                  checked={gstEnabled}
                  onCheckedChange={setGstEnabled}
                />
              </div>
              {gstEnabled && (
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    value={gstRate}
                    onChange={(e) => setGstRate(e.target.value)}
                    className="w-24 text-xs font-mono"
                  />
                  <span className="text-xs text-muted-foreground">% GST Rate applied on taxable amount</span>
                </div>
              )}
            </div>
          </div>

          {/* Payment Milestones Schedule */}
          <div className="rounded-lg border bg-card p-3.5">
            <div className="flex flex-wrap items-center justify-between gap-2 pb-2">
              <div className="flex items-center gap-1.5">
                <Calendar className="size-4 text-primary" />
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Milestone Schedule</h4>
                {!calc.isMilestonesExact100 && (
                  <span className="flex items-center gap-1 rounded bg-destructive-soft px-1.5 py-0.5 text-[10px] font-semibold text-destructive">
                    <AlertCircle className="size-3" /> Sum: {calc.milestoneTotalPct}% (Must equal 100%)
                  </span>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-1">
                <span className="text-[11px] text-muted-foreground mr-1">Presets:</span>
                <Button type="button" size="sm" variant="secondary" className="h-6 px-2 text-[10px]" onClick={() => applyMilestonePreset("50-50")}>50 / 50</Button>
                <Button type="button" size="sm" variant="secondary" className="h-6 px-2 text-[10px]" onClick={() => applyMilestonePreset("30-70")}>30 / 70</Button>
                <Button type="button" size="sm" variant="secondary" className="h-6 px-2 text-[10px]" onClick={() => applyMilestonePreset("10-40-50")}>10 / 40 / 50</Button>
                <Button type="button" size="sm" variant="outline" className="h-6 px-2 text-[10px]" onClick={handleAddMilestone}>+ Add</Button>
              </div>
            </div>

            <div className="grid gap-2">
              {milestones.map((ms, idx) => {
                const pct = Number(ms.percentage) || 0;
                const estAmount = (calc.total * pct) / 100;
                return (
                  <div key={ms.id} className="flex items-center gap-2">
                    <Input
                      className="flex-1 text-xs"
                      placeholder={`Milestone ${idx + 1} label`}
                      value={ms.label}
                      onChange={(e) => {
                        const val = e.target.value;
                        setMilestones((prev) => prev.map((x, i) => (i === idx ? { ...x, label: val } : x)));
                      }}
                    />
                    <div className="flex items-center gap-1 w-24">
                      <Input
                        type="number"
                        min={0}
                        max={100}
                        step="any"
                        className="text-xs text-right font-mono"
                        placeholder="%"
                        value={ms.percentage}
                        onChange={(e) => {
                          const val = e.target.value;
                          setMilestones((prev) => prev.map((x, i) => (i === idx ? { ...x, percentage: val } : x)));
                        }}
                      />
                      <span className="text-xs text-muted-foreground">%</span>
                    </div>
                    <div className="w-28 text-right font-mono text-xs font-semibold text-foreground">
                      {formatINR(estAmount)}
                    </div>
                    <Input
                      type="date"
                      className="w-32 text-xs"
                      value={ms.dueDate}
                      onChange={(e) => {
                        const val = e.target.value;
                        setMilestones((prev) => prev.map((x, i) => (i === idx ? { ...x, dueDate: val } : x)));
                      }}
                    />
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="size-8 text-muted-foreground hover:text-destructive"
                      onClick={() => handleRemoveMilestone(idx)}
                      disabled={milestones.length <= 1}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Terms & Notes */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <label htmlFor="quote-terms" className="text-xs font-semibold">Payment Terms</label>
              <Textarea
                id="quote-terms"
                rows={2}
                className="text-xs"
                value={paymentTerms}
                onChange={(e) => setPaymentTerms(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <label htmlFor="quote-notes" className="text-xs font-semibold">Internal Notes / Scope Caveats</label>
              <Textarea
                id="quote-notes"
                rows={2}
                className="text-xs"
                placeholder="Optional delivery notes or client requirements..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
          </div>

          {/* Real-time Financial Summary Box */}
          <div className="rounded-lg border border-primary/20 bg-primary-soft/30 p-4">
            <div className="flex flex-wrap items-center justify-between gap-4 text-xs">
              <div>
                <span className="text-muted-foreground">Subtotal: </span>
                <span className="font-mono font-semibold">{formatINR(calc.subtotal)}</span>
              </div>
              {calc.discount > 0 && (
                <div>
                  <span className="text-muted-foreground">Discount: </span>
                  <span className="font-mono font-semibold text-success">-{formatINR(calc.discount)}</span>
                </div>
              )}
              {calc.gst > 0 && (
                <div>
                  <span className="text-muted-foreground">GST ({gstRate}%): </span>
                  <span className="font-mono font-semibold">+{formatINR(calc.gst)}</span>
                </div>
              )}
              <div className="ml-auto text-sm">
                <span className="text-muted-foreground">Total Investment: </span>
                <span className="font-mono text-base font-bold text-primary">{formatINR(calc.total)}</span>
              </div>
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleSave}
            disabled={busy || !calc.isMilestonesExact100}
          >
            {busy ? "Saving to MariaDB..." : "Create Quotation Draft"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
