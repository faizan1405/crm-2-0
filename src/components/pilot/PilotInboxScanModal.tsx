import { useState } from "react";
import { toast } from "sonner";
import { AlertCircle, CheckCircle, Info, Play, RefreshCw, Search } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useScanDuplicatesMutation, type DupScanResponse } from "@/lib/api/inboxApi";

interface PilotInboxScanModalProps {
  open: boolean;
  onClose: () => void;
  onScanCompleted?: () => void;
}

export function PilotInboxScanModal({
  open,
  onClose,
  onScanCompleted,
}: PilotInboxScanModalProps) {
  const [result, setResult] = useState<DupScanResponse | null>(null);
  const scanMutation = useScanDuplicatesMutation();

  const handleRunScan = async () => {
    try {
      const res = await scanMutation.mutateAsync();
      setResult(res);
      toast.success(
        `Scan complete: Found ${res.candidatesFound} duplicate candidate pair${res.candidatesFound === 1 ? "" : "s"}.`,
      );
      onScanCompleted?.();
    } catch (err: unknown) {
      const errObj = err as { message?: string };
      toast.error(errObj.message || "Failed to complete duplicate scan");
    }
  };

  const handleClose = () => {
    setResult(null);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base font-semibold">
            <Search className="size-4 text-primary" />
            Duplicate Lead Detection Scan
          </DialogTitle>
          <DialogDescription className="text-xs">
            Scan active MariaDB lead records for matching phone numbers, email addresses, or
            name + company combinations.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2 text-xs">
          <div className="flex items-start gap-2.5 rounded-lg border border-primary/20 bg-primary/5 p-3 text-muted-foreground">
            <Info className="mt-0.5 size-4 shrink-0 text-primary" />
            <div>
              <span className="font-semibold text-foreground">Algorithmic Detection Only:</span>
              <p className="mt-0.5">
                Scanning evaluates evidence and surfaces candidate pairs for your review. It will{" "}
                <strong>never automatically merge, alter, or delete</strong> any leads, deals, or
                call logs.
              </p>
            </div>
          </div>

          {result && (
            <div className="space-y-2 rounded-lg border border-success/30 bg-success/10 p-3 text-xs text-foreground">
              <div className="flex items-center gap-1.5 font-semibold text-success">
                <CheckCircle className="size-4" />
                Scan Completed Successfully
              </div>
              <div className="grid grid-cols-2 gap-2 text-[11px]">
                <div className="rounded bg-background/80 p-2 border">
                  <span className="text-muted-foreground">Leads Evaluated:</span>
                  <div className="text-base font-bold num">{result.leadsEvaluated}</div>
                </div>
                <div className="rounded bg-background/80 p-2 border">
                  <span className="text-muted-foreground">Candidate Pairs Found:</span>
                  <div className="text-base font-bold num">{result.candidatesFound}</div>
                </div>
                <div className="rounded bg-background/80 p-2 border">
                  <span className="text-muted-foreground">New Candidates Added:</span>
                  <div className="text-base font-bold num">{result.createdCount ?? 0}</div>
                </div>
                <div className="rounded bg-background/80 p-2 border">
                  <span className="text-muted-foreground">Reopened Candidates:</span>
                  <div className="text-base font-bold num">{result.reopenedCount ?? 0}</div>
                </div>
              </div>
              {(result.reopenedCount ?? 0) > 0 && (
                <p className="text-[10px] text-amber-700 dark:text-amber-400">
                  Note: {result.reopenedCount} previously decided pair(s) were reopened because
                  their contact details changed.
                </p>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="flex items-center justify-end gap-2 border-t pt-3">
          <Button variant="ghost" size="sm" onClick={handleClose}>
            {result ? "Close" : "Cancel"}
          </Button>
          {!result ? (
            <Button
              size="sm"
              disabled={scanMutation.isPending}
              onClick={handleRunScan}
            >
              {scanMutation.isPending ? (
                <>
                  <RefreshCw className="mr-1.5 size-3.5 animate-spin" />
                  Scanning MariaDB Leads...
                </>
              ) : (
                <>
                  <Play className="mr-1.5 size-3.5" />
                  Start Duplicate Scan
                </>
              )}
            </Button>
          ) : (
            <Button size="sm" onClick={handleClose}>
              Done
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
