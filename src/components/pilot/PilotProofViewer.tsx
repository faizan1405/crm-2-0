import { useState } from "react";
import { toast } from "sonner";
import {
  Download,
  FileText,
  History,
  Paperclip,
  RefreshCw,
  Trash2,
  ZoomIn,
  ZoomOut,
  X,
  ShieldCheck,
} from "lucide-react";
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
import { formatBytes, proofLabel } from "@/lib/crm/attachments";
import { formatDate } from "@/lib/crm/format";
import {
  buildProofDownloadUrl,
  usePaymentProofHistoryQuery,
  usePaymentProofQuery,
  useRemoveProofMutation,
  useReplaceProofMutation,
} from "@/lib/api/financeApi";
import type { PaymentDto, PaymentProofDto } from "@/lib/api/schemas";

interface PilotProofViewerProps {
  payment: PaymentDto;
  onClose: () => void;
}

export function PilotProofViewer({ payment, onClose }: PilotProofViewerProps) {
  const { data: activeProof, isLoading: proofLoading } = usePaymentProofQuery(payment.id);
  const { data: historyData } = usePaymentProofHistoryQuery(payment.id);
  const replaceMutation = useReplaceProofMutation();
  const removeMutation = useRemoveProofMutation();

  const [selectedProofId, setSelectedProofId] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [showReplaceDialog, setShowReplaceDialog] = useState(false);
  const [showRemoveDialog, setShowRemoveDialog] = useState(false);
  const [replaceFile, setReplaceFile] = useState<File | null>(null);
  const [reason, setReason] = useState("");
  const [zoom, setZoom] = useState(1);

  const historyItems = historyData?.items ?? [];
  const currentProof: PaymentProofDto | null = selectedProofId
    ? historyItems.find((p) => p.id === selectedProofId) ?? activeProof ?? null
    : activeProof ?? null;

  const isPdf = currentProof?.mimeType === "application/pdf";
  const isHistorical = Boolean(currentProof && currentProof.id !== activeProof?.id);
  const downloadUrl = currentProof
    ? buildProofDownloadUrl(
        payment.id,
        isHistorical ? { proofId: currentProof.id } : undefined,
      )
    : "";

  const handleDownload = () => {
    if (!currentProof) return;
    const directUrl = buildProofDownloadUrl(payment.id, {
      ...(isHistorical ? { proofId: currentProof.id } : {}),
      download: true,
    });
    const a = document.createElement("a");
    a.href = directUrl;
    a.download = currentProof.originalFileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const handleExecuteReplace = async () => {
    if (!replaceFile) {
      toast.error("Please select a file to replace the current proof.");
      return;
    }
    try {
      await replaceMutation.mutateAsync({
        paymentId: payment.id,
        file: replaceFile,
        originalFileName: replaceFile.name,
        reason: reason.trim() || undefined,
      });
      toast.success("Payment proof replaced successfully");
      setShowReplaceDialog(false);
      setReplaceFile(null);
      setReason("");
      setSelectedProofId(null);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to replace proof";
      toast.error(msg);
    }
  };

  const handleExecuteRemove = async () => {
    try {
      await removeMutation.mutateAsync({
        paymentId: payment.id,
        reason: reason.trim() || undefined,
      });
      toast.success("Payment proof removed (audit record retained)");
      setShowRemoveDialog(false);
      setReason("");
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to remove proof";
      toast.error(msg);
    }
  };

  return (
    <>
      <Dialog open onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <DialogTitle className="flex items-center gap-2 text-xl font-bold">
                  <Paperclip className="size-5 text-teal" />
                  Payment Proof · {payment.method} (₹{payment.amount.toLocaleString("en-IN")})
                </DialogTitle>
                <DialogDescription className="mt-1 text-xs text-muted-foreground">
                  {currentProof ? (
                    <>
                      <span className="font-medium text-foreground">{currentProof.originalFileName}</span> ·{" "}
                      {proofLabel(currentProof.mimeType)} · {formatBytes(currentProof.fileSize)} · Uploaded{" "}
                      {formatDate(currentProof.uploadedAt, {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })}
                      {currentProof.lifecycleStatus !== "active" && (
                        <span className="ml-2 rounded bg-neutral-soft px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                          {currentProof.lifecycleStatus}
                        </span>
                      )}
                    </>
                  ) : proofLoading ? (
                    "Loading proof metadata…"
                  ) : (
                    "No active proof found."
                  )}
                </DialogDescription>
              </div>

              {currentProof && (
                <div className="flex items-center gap-1.5">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-8 gap-1 rounded-full text-xs"
                    onClick={handleDownload}
                  >
                    <Download className="size-3.5" />
                    Download
                  </Button>
                  {!payment.voided && activeProof && (
                    <>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-8 gap-1 rounded-full text-xs"
                        onClick={() => {
                          setReason("");
                          setShowReplaceDialog(true);
                        }}
                      >
                        <RefreshCw className="size-3.5" />
                        Replace
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-8 gap-1 rounded-full text-xs text-destructive hover:bg-destructive-soft hover:text-destructive"
                        onClick={() => {
                          setReason("");
                          setShowRemoveDialog(true);
                        }}
                      >
                        <Trash2 className="size-3.5" />
                        Remove
                      </Button>
                    </>
                  )}
                  {historyItems.length > 1 && (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-8 gap-1 rounded-full text-xs text-muted-foreground"
                      onClick={() => setShowHistory(!showHistory)}
                    >
                      <History className="size-3.5" />
                      {historyItems.length} versions
                    </Button>
                  )}
                </div>
              )}
            </div>
          </DialogHeader>

          {/* Proof Body Display */}
          <div className="relative mt-2 flex min-h-[360px] max-h-[60vh] flex-col items-center justify-center overflow-auto rounded-xl border bg-secondary/60 p-4">
            {proofLoading ? (
              <div className="flex flex-col items-center gap-2 text-sm text-muted-foreground">
                <RefreshCw className="size-5 animate-spin" />
                Loading payment proof…
              </div>
            ) : !currentProof ? (
              <div className="flex flex-col items-center gap-2 text-center text-sm text-muted-foreground">
                <FileText className="size-8 opacity-40" />
                No active proof attached to this payment record.
              </div>
            ) : isPdf ? (
              <div className="flex size-full min-h-[340px] flex-col items-center justify-center gap-3">
                <iframe
                  title="PDF Preview"
                  src={downloadUrl}
                  sandbox="allow-scripts"
                  className="size-full min-h-[340px] rounded-lg border bg-white"
                />
              </div>
            ) : (
              <div className="flex size-full items-center justify-center overflow-auto">
                <img
                  src={downloadUrl}
                  alt={currentProof.originalFileName}
                  style={{ transform: `scale(${zoom})`, transformOrigin: "center" }}
                  className="max-h-[50vh] max-w-full rounded-lg object-contain shadow-sm transition-transform duration-150"
                />
                <div className="absolute right-4 bottom-4 flex items-center gap-1 rounded-lg border bg-card/90 p-1 shadow-sm backdrop-blur">
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="size-7"
                    onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))}
                    title="Zoom out"
                  >
                    <ZoomOut className="size-3.5" />
                  </Button>
                  <span className="px-1 text-[11px] font-mono">{Math.round(zoom * 100)}%</span>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="size-7"
                    onClick={() => setZoom((z) => Math.min(3, z + 0.25))}
                    title="Zoom in"
                  >
                    <ZoomIn className="size-3.5" />
                  </Button>
                </div>
              </div>
            )}
          </div>

          {/* Cryptographic SHA-256 and Storage Verification Badge */}
          {currentProof && (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-card px-3 py-2 text-xs text-muted-foreground">
              <div className="flex items-center gap-1.5 font-mono text-[11px]">
                <ShieldCheck className="size-4 text-success" />
                SHA-256: <span className="truncate max-w-[280px]">{currentProof.sha256}</span>
              </div>
              <div className="text-[11px]">
                Driver: <span className="font-semibold">{currentProof.storageDriver}</span> (Isolated private storage)
              </div>
            </div>
          )}

          {/* Historical Versions Drawer/List */}
          {showHistory && historyItems.length > 0 && (
            <div className="mt-4 rounded-xl border bg-secondary/40 p-4">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Proof Attachment Version History ({historyItems.length})
              </div>
              <div className="grid gap-2">
                {historyItems.map((hist) => {
                  const isCurrent = (currentProof?.id ?? "") === hist.id;
                  return (
                    <div
                      key={hist.id}
                      className="flex items-center justify-between rounded-lg border bg-card px-3 py-2 text-xs"
                    >
                      <div>
                        <div className="font-medium text-foreground">
                          {hist.originalFileName}
                          {hist.lifecycleStatus === "active" ? (
                            <span className="ml-2 rounded bg-success-soft px-1.5 py-0.5 text-[10px] font-bold text-success">
                              Active
                            </span>
                          ) : (
                            <span className="ml-2 rounded bg-neutral-soft px-1.5 py-0.5 text-[10px] text-muted-foreground">
                              {hist.lifecycleStatus}
                            </span>
                          )}
                        </div>
                        <div className="mt-0.5 text-muted-foreground">
                          {proofLabel(hist.mimeType)} · {formatBytes(hist.fileSize)} · {formatDate(hist.uploadedAt)}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {!isCurrent && (
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="h-7 text-xs"
                            onClick={() => setSelectedProofId(hist.id)}
                          >
                            Inspect
                          </Button>
                        )}
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-7 gap-1 text-xs"
                          asChild
                        >
                          <a
                            href={buildProofDownloadUrl(payment.id, { proofId: hist.id, download: true })}
                            download={hist.originalFileName}
                          >
                            <Download className="size-3" />
                            Download
                          </a>
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="ghost" onClick={onClose} className="rounded-full">
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Replace Proof Dialog */}
      {showReplaceDialog && (
        <Dialog open onOpenChange={(o) => !o && setShowReplaceDialog(false)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Replace Payment Proof</DialogTitle>
              <DialogDescription>
                The new file will become the active proof for this payment. The previous file remains
                permanently archived for financial audit integrity.
              </DialogDescription>
            </DialogHeader>

            <div className="grid gap-4 py-2">
              <div className="grid gap-1.5">
                <Label htmlFor="replace-file">Select new attachment</Label>
                <Input
                  id="replace-file"
                  type="file"
                  accept=".jpg,.jpeg,.png,.webp,.pdf,image/jpeg,image/png,image/webp,application/pdf"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) setReplaceFile(f);
                  }}
                />
                <span className="text-[11px] text-muted-foreground">
                  Supported formats: JPG, PNG, WebP, PDF (up to 10 MB).
                </span>
              </div>

              <div className="grid gap-1.5">
                <Label htmlFor="replace-reason">Reason for replacement (optional)</Label>
                <Input
                  id="replace-reason"
                  placeholder="e.g. Updated GST tax invoice with corrected address"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </div>
            </div>

            <DialogFooter>
              <Button
                variant="ghost"
                onClick={() => setShowReplaceDialog(false)}
                disabled={replaceMutation.isPending}
              >
                Cancel
              </Button>
              <Button
                onClick={handleExecuteReplace}
                disabled={!replaceFile || replaceMutation.isPending}
              >
                {replaceMutation.isPending ? "Replacing…" : "Confirm Replacement"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Remove Proof Dialog */}
      {showRemoveDialog && (
        <Dialog open onOpenChange={(o) => !o && setShowRemoveDialog(false)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="text-destructive">Remove Payment Proof</DialogTitle>
              <DialogDescription>
                Deactivates this attachment from active view. The physical evidence and hash remain
                safely preserved in the audit log. The payment record itself will not be changed.
              </DialogDescription>
            </DialogHeader>

            <div className="grid gap-2 py-2">
              <Label htmlFor="remove-reason">Removal reason (required)</Label>
              <Input
                id="remove-reason"
                placeholder="e.g. Attached to incorrect transaction"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </div>

            <DialogFooter>
              <Button
                variant="ghost"
                onClick={() => setShowRemoveDialog(false)}
                disabled={removeMutation.isPending}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={handleExecuteRemove}
                disabled={!reason.trim() || removeMutation.isPending}
              >
                {removeMutation.isPending ? "Removing…" : "Confirm Removal"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
