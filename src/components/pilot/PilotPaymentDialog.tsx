import { useState } from "react";
import { toast } from "sonner";
import { ArrowDownLeft, Paperclip, X, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { selectCls } from "@/components/crm/Shell";
import { formatINR, dayKey } from "@/lib/crm/format";
import { formatBytes, proofLabel, checkProofFile } from "@/lib/crm/attachments";
import {
  createIdempotencyKey,
  useCreatePaymentMutation,
  useUploadProofMutation,
} from "@/lib/api/financeApi";
import type { DealDto, PaymentMethodApi, PaymentTypeApi } from "@/lib/api/schemas";

const METHODS: PaymentMethodApi[] = ["UPI", "Bank Transfer", "Cash", "Card", "Cheque"];

interface PilotPaymentDialogProps {
  deal: DealDto;
  onClose: () => void;
}

export function PilotPaymentDialog({ deal, onClose }: PilotPaymentDialogProps) {
  const createPaymentMutation = useCreatePaymentMutation();
  const uploadProofMutation = useUploadProofMutation();

  const outstanding = deal.financialSummary.outstanding;
  const [amount, setAmount] = useState(String(outstanding));
  const [method, setMethod] = useState<PaymentMethodApi>("UPI");
  const [type, setType] = useState<PaymentTypeApi>("milestone");
  const [date, setDate] = useState(() => dayKey(new Date()));
  const [reference, setReference] = useState("");
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [savedPaymentId, setSavedPaymentId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    const check = await checkProofFile(file);
    if (!check.ok) {
      toast.error(check.error);
      return;
    }
    setProofFile(file);
  };

  const handleSave = async () => {
    if (busy) return;

    // Retry only proof if payment was already recorded
    if (savedPaymentId) {
      if (!proofFile) {
        onClose();
        return;
      }
      setBusy(true);
      try {
        await uploadProofMutation.mutateAsync({
          paymentId: savedPaymentId,
          file: proofFile,
          originalFileName: proofFile.name,
        });
        toast.success("Payment proof attached successfully");
        onClose();
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Proof upload failed";
        toast.error(`Proof upload failed: ${msg}. You can retry or attach later.`);
      } finally {
        setBusy(false);
      }
      return;
    }

    // Validate inputs
    const num = Number(amount);
    if (!Number.isFinite(num) || num <= 0) {
      toast.error("Enter a valid payment amount");
      return;
    }
    if (num > outstanding) {
      toast.error(`Amount exceeds the ${formatINR(outstanding)} outstanding balance`);
      return;
    }

    setBusy(true);
    const idempotencyKey = createIdempotencyKey();

    try {
      const res = await createPaymentMutation.mutateAsync({
        dealId: deal.id,
        amount: num,
        date,
        method,
        type: num === outstanding ? "final" : type,
        ...(reference.trim() ? { reference: reference.trim() } : {}),
        idempotencyKey,
      });

      toast.success(`${formatINR(num)} recorded for ${deal.clientName}`);

      // If user selected a proof file, attempt upload
      if (proofFile) {
        try {
          await uploadProofMutation.mutateAsync({
            paymentId: res.payment.id,
            file: proofFile,
            originalFileName: proofFile.name,
          });
          toast.success("Proof attached successfully");
          onClose();
        } catch (proofErr: unknown) {
          // Payment is safely committed, only proof failed!
          setSavedPaymentId(res.payment.id);
          const msg = proofErr instanceof Error ? proofErr.message : "Upload error";
          toast.error(
            `Payment recorded, but proof upload failed (${msg}). Tap "Retry proof" or attach later from payment history.`,
            { duration: 8000 },
          );
        }
      } else {
        onClose();
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to record payment";
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Record Payment · {deal.name}</DialogTitle>
        </DialogHeader>

        <div className="rounded-xl border border-teal/20 bg-teal-soft p-4">
          <div className="flex items-center gap-2 text-xs font-semibold text-teal">
            <ArrowDownLeft className="size-4" />
            Payment for {deal.clientName}
          </div>
          <div className="num mt-2 text-2xl font-extrabold text-foreground">
            {formatINR(outstanding)}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">Current outstanding balance</div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="pay-amount">Amount (₹)</Label>
            <Input
              id="pay-amount"
              type="number"
              min={1}
              max={outstanding}
              disabled={Boolean(savedPaymentId) || busy}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="pay-date">Payment Date (IST)</Label>
            <Input
              id="pay-date"
              type="date"
              disabled={Boolean(savedPaymentId) || busy}
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="pay-method">Method</Label>
            <select
              id="pay-method"
              className={selectCls}
              disabled={Boolean(savedPaymentId) || busy}
              value={method}
              onChange={(e) => setMethod(e.target.value as PaymentMethodApi)}
            >
              {METHODS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="pay-type">Type</Label>
            <select
              id="pay-type"
              className={selectCls}
              disabled={Boolean(savedPaymentId) || busy}
              value={type}
              onChange={(e) => setType(e.target.value as PaymentTypeApi)}
            >
              <option value="advance">Advance</option>
              <option value="milestone">Milestone</option>
              <option value="final">Final</option>
              <option value="other">Other</option>
            </select>
          </div>

          <div className="grid gap-1.5 sm:col-span-2">
            <Label htmlFor="pay-ref">Reference (optional)</Label>
            <Input
              id="pay-ref"
              placeholder="UTR / Cheque no. / Invoice ID"
              disabled={Boolean(savedPaymentId) || busy}
              value={reference}
              onChange={(e) => setReference(e.target.value)}
            />
          </div>

          {/* Proof file attachment */}
          <div className="grid gap-1.5 sm:col-span-2">
            <span className="text-sm font-medium">
              Payment proof attachment <span className="font-normal text-muted-foreground">(optional)</span>
            </span>

            {proofFile ? (
              <div className="flex items-center gap-3 rounded-lg border bg-secondary p-2.5">
                <span className="grid size-10 place-items-center rounded-md bg-card">
                  <FileText className="size-5 text-muted-foreground" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{proofFile.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {proofLabel(proofFile.type as import("@/lib/crm/attachments").ProofKind)} · {formatBytes(proofFile.size)}
                  </div>
                </div>
                {!savedPaymentId && (
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="size-7"
                    onClick={() => setProofFile(null)}
                  >
                    <X className="size-4" />
                  </Button>
                )}
              </div>
            ) : (
              <label
                htmlFor="pilot-proof-input"
                className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed bg-card px-3 py-3 text-sm text-muted-foreground transition-colors hover:border-foreground hover:text-foreground"
              >
                <Paperclip className="size-4" />
                Choose screenshot or receipt · JPG, PNG, WebP, PDF · max 10 MB
                <input
                  id="pilot-proof-input"
                  type="file"
                  hidden
                  accept=".jpg,.jpeg,.png,.webp,.pdf,image/jpeg,image/png,image/webp,application/pdf"
                  onChange={handleFileChange}
                />
              </label>
            )}
          </div>
        </div>

        <DialogFooter className="mt-4">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {savedPaymentId ? "Close" : "Cancel"}
          </Button>
          <Button onClick={handleSave} disabled={busy}>
            {busy ? "Saving…" : savedPaymentId ? "Retry proof" : "Save payment"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
