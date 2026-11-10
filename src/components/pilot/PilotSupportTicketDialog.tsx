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
  useCreateSupportTicketMutation,
  useResolveSupportTicketMutation,
} from "@/lib/api/projectsApi";
import type {
  ClientSupportTicketDto,
  ProjectPriorityApi,
  SupportCoverageApi,
  SupportKindApi,
} from "@/lib/api/schemas";

export function PilotNewSupportTicketDialog({
  projectId,
  open,
  onOpenChange,
}: {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const createMutation = useCreateSupportTicketMutation();
  const [kind, setKind] = useState<SupportKindApi>("bug");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<ProjectPriorityApi>("normal");
  const [coverage, setCoverage] = useState<SupportCoverageApi>("included");
  const [dueDate, setDueDate] = useState("");
  const [busy, setBusy] = useState(false);

  const handleSubmit = async () => {
    if (!title.trim()) {
      toast.error("Ticket title is required.");
      return;
    }

    try {
      setBusy(true);
      await createMutation.mutateAsync({
        projectId,
        payload: {
          kind,
          title: title.trim(),
          description: description.trim() || undefined,
          priority,
          coverage,
          dueDate: dueDate || undefined,
        },
      });

      toast.success("Support ticket opened.");
      onOpenChange(false);
      setTitle("");
      setDescription("");
      setDueDate("");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to open support ticket.";
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Open Client Support Request</DialogTitle>
        </DialogHeader>

        <div className="grid gap-3 py-2">
          <div className="grid gap-1.5">
            <Label htmlFor="tkt-title">Issue Summary *</Label>
            <Input
              id="tkt-title"
              placeholder="e.g. Broken checkout form on mobile Safari"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="tkt-kind">Request Type</Label>
              <select
                id="tkt-kind"
                className={selectCls}
                value={kind}
                onChange={(e) => setKind(e.target.value as SupportKindApi)}
              >
                <option value="bug">Bug Fix</option>
                <option value="technical">Technical Maintenance</option>
                <option value="content">Content Update</option>
                <option value="integration">Third-party Integration</option>
                <option value="general">General Support</option>
              </select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="tkt-prio">Priority</Label>
              <select
                id="tkt-prio"
                className={selectCls}
                value={priority}
                onChange={(e) => setPriority(e.target.value as ProjectPriorityApi)}
              >
                <option value="high">High</option>
                <option value="normal">Normal</option>
                <option value="low">Low</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="tkt-cov">Coverage</Label>
              <select
                id="tkt-cov"
                className={selectCls}
                value={coverage}
                onChange={(e) => setCoverage(e.target.value as SupportCoverageApi)}
              >
                <option value="included">Included in Agreement</option>
                <option value="billable">Billable Support</option>
                <option value="undecided">Undecided</option>
              </select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="tkt-due">Target Resolution Date</Label>
              <Input
                id="tkt-due"
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="tkt-desc">Description</Label>
            <Textarea
              id="tkt-desc"
              rows={3}
              placeholder="Steps to reproduce, client notes, or error details"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={busy}>
            {busy ? "Opening..." : "Open Request"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function PilotResolveSupportTicketDialog({
  projectId,
  ticket,
  open,
  onOpenChange,
}: {
  projectId: string;
  ticket: ClientSupportTicketDto | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const resolveMutation = useResolveSupportTicketMutation();
  const [resolution, setResolution] = useState("");
  const [busy, setBusy] = useState(false);

  const handleSubmit = async () => {
    if (!ticket) return;
    if (!resolution.trim()) {
      toast.error("Please explain the resolution before marking this request resolved.");
      return;
    }

    try {
      setBusy(true);
      await resolveMutation.mutateAsync({
        ticketId: ticket.id,
        projectId,
        resolution: resolution.trim(),
        expectedVersion: ticket.version,
      });

      toast.success("Support ticket resolved.");
      onOpenChange(false);
      setResolution("");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to resolve support ticket.";
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open && !!ticket} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Resolve Request — {ticket?.title}</DialogTitle>
        </DialogHeader>

        <div className="grid gap-3 py-2">
          <p className="text-sm text-muted-foreground">
            A clear resolution explanation is recorded in the permanent project audit history.
          </p>

          <div className="grid gap-1.5">
            <Label htmlFor="res-notes">Resolution Explanation *</Label>
            <Textarea
              id="res-notes"
              rows={3}
              placeholder="e.g. Fixed webkit CSS overflow bug and verified on iOS 17 device"
              value={resolution}
              onChange={(e) => setResolution(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={busy}>
            {busy ? "Resolving..." : "Confirm Resolution"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
