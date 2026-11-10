import { useState } from "react";
import { toast } from "sonner";
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
import { Textarea } from "@/components/ui/textarea";
import { selectCls } from "@/components/crm/Shell";
import {
  useAddDeliverableRevisionMutation,
  useCreateDeliverableMutation,
} from "@/lib/api/projectsApi";
import type { DeliverableStatusApi } from "@/lib/api/schemas";

export function PilotNewDeliverableDialog({
  projectId,
  open,
  onOpenChange,
}: {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const createMutation = useCreateDeliverableMutation();
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("design");
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [status, setStatus] = useState<DeliverableStatusApi>("draft");
  const [busy, setBusy] = useState(false);

  const handleSubmit = async () => {
    if (!title.trim()) {
      toast.error("Deliverable title is required.");
      return;
    }

    try {
      setBusy(true);
      await createMutation.mutateAsync({
        projectId,
        payload: {
          title: title.trim(),
          category,
          description: description.trim() || undefined,
          dueDate: dueDate || undefined,
          status,
        },
      });

      toast.success("Deliverable added.");
      onOpenChange(false);
      setTitle("");
      setDescription("");
      setDueDate("");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to create deliverable.";
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add Deliverable</DialogTitle>
        </DialogHeader>

        <div className="grid gap-3 py-2">
          <div className="grid gap-1.5">
            <Label htmlFor="del-title">Title *</Label>
            <Input
              id="del-title"
              placeholder="e.g. Brand Identity Guidelines & SVG Assets"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="del-cat">Category</Label>
              <select
                id="del-cat"
                className={selectCls}
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              >
                <option value="design">Design & Visuals</option>
                <option value="development">Development</option>
                <option value="copy">Content & Copy</option>
                <option value="video">Motion & Video</option>
                <option value="strategy">Strategy</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="del-due">Due Date</Label>
              <Input
                id="del-due"
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="del-desc">Description</Label>
            <Textarea
              id="del-desc"
              rows={2}
              placeholder="Scope and acceptance criteria for this deliverable"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button id="submit-add-deliverable" onClick={handleSubmit} disabled={busy}>
            {busy ? "Saving..." : "Add Deliverable"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function PilotNewRevisionDialog({
  projectId,
  deliverableId,
  deliverableTitle,
  open,
  onOpenChange,
}: {
  projectId: string;
  deliverableId: string;
  deliverableTitle: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const addRevisionMutation = useAddDeliverableRevisionMutation();
  const [summary, setSummary] = useState("");
  const [fileUrl, setFileUrl] = useState("");
  const [notes, setNotes] = useState("");
  const [clientFeedback, setClientFeedback] = useState("");
  const [busy, setBusy] = useState(false);

  const handleSubmit = async () => {
    if (!summary.trim()) {
      toast.error("Summary of changes is required.");
      return;
    }

    try {
      setBusy(true);
      await addRevisionMutation.mutateAsync({
        deliverableId,
        projectId,
        payload: {
          summary: summary.trim(),
          fileUrl: fileUrl.trim() || undefined,
          notes: notes.trim() || undefined,
          clientFeedback: clientFeedback.trim() || undefined,
        },
      });

      toast.success("Revision added.");
      onOpenChange(false);
      setSummary("");
      setFileUrl("");
      setNotes("");
      setClientFeedback("");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to add revision.";
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Submit Revision — {deliverableTitle}</DialogTitle>
        </DialogHeader>

        <div className="grid gap-3 py-2">
          <div className="grid gap-1.5">
            <Label htmlFor="rev-summary">Revision Summary *</Label>
            <Input
              id="rev-summary"
              placeholder="e.g. Iteration based on typography feedback"
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="rev-file">Asset / Delivery Reference URL</Label>
            <Input
              id="rev-file"
              placeholder="https://drive.google.com/... or https://figma.com/..."
              value={fileUrl}
              onChange={(e) => setFileUrl(e.target.value)}
            />
            <span className="text-xs text-muted-foreground">
              Binary uploads deferred to dedicated storage checkpoint; external URLs supported.
            </span>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="rev-notes">Developer / Designer Notes</Label>
            <Textarea
              id="rev-notes"
              rows={2}
              placeholder="Details on what was updated in this revision"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="rev-feedback">Client Feedback (if already received)</Label>
            <Textarea
              id="rev-feedback"
              rows={2}
              placeholder="Direct client review feedback"
              value={clientFeedback}
              onChange={(e) => setClientFeedback(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button id="submit-add-revision" onClick={handleSubmit} disabled={busy}>
            {busy ? "Submitting..." : "Submit Revision"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
