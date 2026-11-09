import { useState } from "react";
import { toast } from "sonner";
import { AlertCircle } from "lucide-react";
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
import { useCancelDealMutation } from "@/lib/api/financeApi";
import type { DealDto } from "@/lib/api/schemas";

interface PilotCancelDealDialogProps {
  deal: DealDto;
  onClose: () => void;
}

export function PilotCancelDealDialog({ deal, onClose }: PilotCancelDealDialogProps) {
  const cancelMutation = useCancelDealMutation();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const collected = deal.financialSummary.collected;

  const handleCancel = async () => {
    if (!reason.trim()) {
      toast.error("Please provide a reason for cancelling this deal.");
      return;
    }

    setBusy(true);
    try {
      await cancelMutation.mutateAsync({
        id: deal.id,
        payload: {
          version: deal.version,
          reason: reason.trim(),
        },
      });

      toast.success(`Deal "${deal.name}" cancelled.`);
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to cancel deal";
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
            <AlertCircle className="size-5" />
            Cancel Deal · {deal.name}
          </DialogTitle>
          <DialogDescription>
            Cancelling this deal terminates its active pipeline and sets its outstanding balance to ₹0.
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-xl border border-warning/20 bg-warning-soft p-3.5 text-xs text-warning">
          <p className="font-semibold">Financial Impact Notice:</p>
          <p className="mt-1">
            {collected > 0 ? (
              <>
                Historical payments totaling <b>{formatINR(collected)}</b> remain safely recorded on
                this deal and will be classified under &ldquo;Historical cash kept (cancelled)&rdquo;. They will
                not be automatically refunded or wiped.
              </>
            ) : (
              <>No payments were collected on this deal. Booked value will be removed from active totals.</>
            )}
          </p>
        </div>

        <div className="grid gap-2 py-2">
          <Label htmlFor="cancel-deal-reason">Cancellation reason (required)</Label>
          <Input
            id="cancel-deal-reason"
            placeholder="e.g. Client withdrew budget / project postponed indefinitely"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            disabled={busy}
          />
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Keep deal active
          </Button>
          <Button
            variant="destructive"
            onClick={handleCancel}
            disabled={!reason.trim() || busy}
          >
            {busy ? "Cancelling…" : "Confirm Cancellation"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
