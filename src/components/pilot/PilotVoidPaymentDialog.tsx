import { useState } from "react";
import { toast } from "sonner";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatINR } from "@/lib/crm/format";
import { createIdempotencyKey, useVoidPaymentMutation } from "@/lib/api/financeApi";
import type { PaymentDto } from "@/lib/api/schemas";

interface PilotVoidPaymentDialogProps {
  payment: PaymentDto;
  onClose: () => void;
}

export function PilotVoidPaymentDialog({ payment, onClose }: PilotVoidPaymentDialogProps) {
  const voidMutation = useVoidPaymentMutation();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const handleVoid = async () => {
    if (!reason.trim()) {
      toast.error("Please provide a reason for voiding this payment record.");
      return;
    }

    setBusy(true);
    const idempotencyKey = createIdempotencyKey();

    try {
      await voidMutation.mutateAsync({
        id: payment.id,
        payload: {
          version: payment.version,
          reason: reason.trim(),
          idempotencyKey,
        },
      });

      toast.success(`Payment of ${formatINR(payment.amount)} voided.`);
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to void payment";
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="size-5" />
            Void Payment · {formatINR(payment.amount)}
          </DialogTitle>
          <DialogDescription>
            Voiding retracts this payment from collected totals and recalculates the deal&apos;s
            outstanding balance.
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-xl border border-destructive/20 bg-destructive-soft p-3.5 text-xs text-destructive">
          <p className="font-semibold">Accounting Distinction:</p>
          <p className="mt-1">
            This action marks the CRM ledger entry as void. It does <b>not</b> process a bank refund
            or return real funds to the client. The original payment record and attached proof remain
            archived for audit tracking.
          </p>
        </div>

        <div className="grid gap-2 py-2">
          <Label htmlFor="void-reason">Reason for voiding (required)</Label>
          <Input
            id="void-reason"
            placeholder="e.g. Bounced cheque / payment duplicate / client cancelled transfer"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            disabled={busy}
          />
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleVoid}
            disabled={!reason.trim() || busy}
          >
            {busy ? "Voiding…" : "Confirm Void"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
