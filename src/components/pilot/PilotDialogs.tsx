import { useEffect, useState, type FormEvent } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

const LOST_PRESETS = ["Budget too low", "Went with competitor", "No response", "Timing not right"];

export function PilotLostReasonDialog({
  open,
  leadName,
  pending,
  errorMessage,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  leadName?: string;
  pending?: boolean;
  errorMessage?: string | null;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setReason("");
      setFieldError(null);
    }
  }, [open]);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = reason.trim();
    if (!trimmed) {
      setFieldError("Add a lost reason before saving.");
      return;
    }
    if (trimmed.length > 500) {
      setFieldError("Lost reason must be 500 characters or fewer.");
      return;
    }
    setFieldError(null);
    onConfirm(trimmed);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !pending && onCancel()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Mark {leadName ?? "lead"} as lost</DialogTitle>
          <DialogDescription>
            Server validation requires a reason before transitioning a lead to Lost.
          </DialogDescription>
        </DialogHeader>
        <form noValidate onSubmit={handleSubmit} className="grid gap-3">
          <div className="flex flex-wrap gap-2">
            {LOST_PRESETS.map((preset) => (
              <Button
                type="button"
                variant="outline"
                size="sm"
                key={preset}
                onClick={() => {
                  setReason(preset);
                  setFieldError(null);
                }}
                className="rounded-full border px-3 py-1 text-xs"
              >
                {preset}
              </Button>
            ))}
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="pilot-lost-reason">Lost reason *</Label>
            <Textarea
              id="pilot-lost-reason"
              rows={3}
              placeholder="Why was this lead lost?"
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
                if (fieldError) setFieldError(null);
              }}
              aria-invalid={fieldError ? true : undefined}
              aria-describedby={fieldError ? "pilot-lost-reason-error" : undefined}
              disabled={pending}
            />
            {fieldError && (
              <p id="pilot-lost-reason-error" className="text-xs text-destructive" role="alert">
                {fieldError}
              </p>
            )}
          </div>
          {errorMessage && (
            <p
              className="rounded-md border border-destructive/40 bg-destructive/10 p-2.5 text-xs text-destructive"
              role="alert"
            >
              {errorMessage}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onCancel} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" variant="destructive" disabled={pending}>
              {pending ? "Saving…" : "Mark as lost"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function PilotArchiveDialog({
  open,
  kind,
  leadName,
  pending,
  errorMessage,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  kind: "waste" | "deleted";
  leadName: string;
  pending?: boolean;
  errorMessage?: string | null;
  onCancel: () => void;
  onConfirm: (reason?: string) => void;
}) {
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (!open) {
      setReason("");
    }
  }, [open]);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const cleaned = reason.trim();
    onConfirm(cleaned || undefined);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !pending && onCancel()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {kind === "waste" ? `Move ${leadName} to Waste?` : `Delete ${leadName}?`}
          </DialogTitle>
          <DialogDescription>
            {kind === "waste"
              ? "Moves this lead out of active directories while preserving history on the server. Restorable anytime."
              : "Soft-archives this lead to Recently Deleted on the server. Restorable from Waste & Recently Deleted."}
          </DialogDescription>
        </DialogHeader>
        <form noValidate onSubmit={handleSubmit} className="grid gap-3">
          {kind === "waste" && (
            <div className="grid gap-1.5">
              <Label htmlFor="pilot-archive-reason">Reason (optional)</Label>
              <Textarea
                id="pilot-archive-reason"
                rows={2}
                placeholder="e.g., Junk enquiry, unreachable number, wrong territory…"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                disabled={pending}
              />
            </div>
          )}
          {errorMessage && (
            <p
              className="rounded-md border border-destructive/40 bg-destructive/10 p-2.5 text-xs text-destructive"
              role="alert"
            >
              {errorMessage}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onCancel} disabled={pending}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant={kind === "deleted" ? "destructive" : "default"}
              disabled={pending}
            >
              {pending ? "Archiving…" : kind === "waste" ? "Move to Waste" : "Delete lead"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
