import { pilotLinkSearch } from "@/lib/api/pilotHook";
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  GitCompare,
  Info,
  RefreshCw,
  ShieldAlert,
  XCircle,
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
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { formatDate, formatINR } from "@/lib/crm/format";
import { STATUS_LABEL, type LeadStatus } from "@/lib/crm/types";
import {
  useDecideDuplicateCandidateMutation,
  useDuplicateCandidateQuery,
  type DupDecision,
} from "@/lib/api/inboxApi";

interface PilotDuplicateReviewDialogProps {
  candidateId: string | null;
  onClose: () => void;
  onDecisionSaved?: () => void;
}

export function PilotDuplicateReviewDialog({
  candidateId,
  onClose,
  onDecisionSaved,
}: PilotDuplicateReviewDialogProps) {
  const [note, setNote] = useState("");
  const [conflictError, setConflictError] = useState<string | null>(null);

  const {
    data: candidate,
    isLoading,
    error,
    refetch,
  } = useDuplicateCandidateQuery(candidateId);

  const decideMutation = useDecideDuplicateCandidateMutation();

  const handleDecide = async (decision: DupDecision) => {
    if (!candidate) return;
    setConflictError(null);

    try {
      await decideMutation.mutateAsync({
        id: candidate.id,
        input: {
          decision,
          ...(note.trim() ? { note: note.trim() } : {}),
          expectedVersion: candidate.version,
        },
      });

      const label =
        decision === "separate"
          ? "Kept as separate leads — audited record saved"
          : decision === "related"
            ? "Marked as related leads — relationship established"
            : "Duplicate suggestion dismissed";

      toast.success(label);
      onDecisionSaved?.();
      onClose();
    } catch (err: unknown) {
      const errObj = err as { code?: string; message?: string; status?: number };
      if (errObj.code === "stale_conflict" || errObj.status === 409) {
        setConflictError(
          "This candidate was modified by another session. Please reload latest to review current state.",
        );
      } else {
        toast.error(errObj.message || "Failed to save review decision");
      }
    }
  };

  const a = candidate?.leadA;
  const b = candidate?.leadB;

  const isConfirmed = candidate?.strength === "confirmed";
  const reasonsLabel = candidate?.reasons
    .map((r) => {
      if (r === "phone") return "Phone Match";
      if (r === "email") return "Email Match";
      if (r === "name_company" || r === "possible") return "Name + Company Match";
      return r;
    })
    .join(" + ");

  return (
    <Dialog open={Boolean(candidateId)} onOpenChange={(open) => !open && onClose()}>
      {Boolean(candidateId) && (
        <DialogContent className="max-h-[92vh] max-w-4xl overflow-y-auto">
          <DialogHeader>
          <div className="flex flex-wrap items-center gap-2">
            <DialogTitle className="flex items-center gap-2 text-base font-semibold">
              <GitCompare className="size-4 text-primary" />
              Duplicate Review & Comparison
            </DialogTitle>
            {candidate && (
              <>
                <Badge
                  variant="outline"
                  className={
                    isConfirmed
                      ? "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400"
                      : "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-400"
                  }
                >
                  {isConfirmed ? "Strong Match — Phone/Email" : "Possible Match — Name + Company"}
                </Badge>
                {candidate.reopened && (
                  <Badge variant="destructive" className="text-[10px]">
                    Reopened: Contact Details Changed
                  </Badge>
                )}
                <span className="text-xs text-muted-foreground">
                  Candidate ID: <code className="text-[11px]">{candidate.id}</code> (v
                  {candidate.version})
                </span>
              </>
            )}
          </div>
          <DialogDescription className="text-xs">
            {reasonsLabel} —{" "}
            {isConfirmed
              ? "A strong match is not an approved relationship. A shared phone or email does not always mean the same customer."
              : "Name and company similarity detected by algorithm. Requires explicit Owner verification."}
          </DialogDescription>
        </DialogHeader>

        {isLoading && (
          <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
            <RefreshCw className="mr-2 size-4 animate-spin" />
            Loading candidate records from MariaDB...
          </div>
        )}

        {error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
            Failed to load candidate details: {(error as Error).message}
          </div>
        )}

        {conflictError && (
          <div className="flex items-center justify-between rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-300">
            <div className="flex items-center gap-2">
              <AlertTriangle className="size-4 shrink-0 text-amber-600" />
              <span>{conflictError}</span>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setConflictError(null);
                void refetch();
              }}
            >
              <RefreshCw className="mr-1.5 size-3" />
              Reload Latest
            </Button>
          </div>
        )}

        {candidate && a && b && (
          <div className="space-y-4">
            {/* Zero-Merge Guarantee Notice */}
            <div className="flex items-start gap-2 rounded-lg border border-primary/20 bg-primary/5 p-3 text-xs text-muted-foreground">
              <Info className="mt-0.5 size-4 shrink-0 text-primary" />
              <div>
                <span className="font-semibold text-foreground">
                  Zero Data Loss & Identity Preservation:
                </span>{" "}
                Scale Flow Sales OS never automatically merges or deletes lead records. Marking as
                Related establishes an audited relationship link. Keeping Separate permanently
                resolves this candidate without altering independent deals, call logs, or payments.
              </div>
            </div>

            {/* Existing Relationship Indicator */}
            {candidate.existingRelationship && (
              <div className="flex items-center gap-2 rounded-lg border border-success/30 bg-success/10 p-3 text-xs text-success">
                <CheckCircle2 className="size-4 shrink-0" />
                <span>
                  Existing Relationship:{" "}
                  <strong>{candidate.existingRelationship.kind.toUpperCase()}</strong>
                  {candidate.existingRelationship.notes &&
                    ` — “${candidate.existingRelationship.notes}”`}
                  {candidate.existingRelationship.decidedAt &&
                    ` (Decided ${formatDate(candidate.existingRelationship.decidedAt)})`}
                </span>
              </div>
            )}

            {/* Side-by-Side Comparison Table */}
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b bg-muted/50 font-medium text-muted-foreground">
                    <th className="py-2 pl-3 pr-2">Attribute</th>
                    <th className="py-2 px-3">Lead A ({a.id})</th>
                    <th className="py-2 px-3">Lead B ({b.id})</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  <tr className="hover:bg-muted/20">
                    <td className="py-2 pl-3 pr-2 font-medium text-muted-foreground">
                      Client Name
                    </td>
                    <td
                      className={`py-2 px-3 ${a.name.toLowerCase() === b.name.toLowerCase() ? "font-semibold text-foreground" : ""}`}
                    >
                      {a.name}
                    </td>
                    <td
                      className={`py-2 px-3 ${a.name.toLowerCase() === b.name.toLowerCase() ? "font-semibold text-foreground" : ""}`}
                    >
                      {b.name}
                    </td>
                  </tr>
                  <tr className="hover:bg-muted/20">
                    <td className="py-2 pl-3 pr-2 font-medium text-muted-foreground">Company</td>
                    <td className="py-2 px-3">{a.company || "—"}</td>
                    <td className="py-2 px-3">{b.company || "—"}</td>
                  </tr>
                  <tr className="hover:bg-muted/20">
                    <td className="py-2 pl-3 pr-2 font-medium text-muted-foreground">
                      Phone Number
                    </td>
                    <td
                      className={`py-2 px-3 num ${isConfirmed && candidate.reasons.includes("phone") ? "bg-amber-500/10 font-bold text-amber-700 dark:text-amber-400" : ""}`}
                    >
                      {a.phone}
                    </td>
                    <td
                      className={`py-2 px-3 num ${isConfirmed && candidate.reasons.includes("phone") ? "bg-amber-500/10 font-bold text-amber-700 dark:text-amber-400" : ""}`}
                    >
                      {b.phone}
                    </td>
                  </tr>
                  <tr className="hover:bg-muted/20">
                    <td className="py-2 pl-3 pr-2 font-medium text-muted-foreground">
                      Email Address
                    </td>
                    <td
                      className={`py-2 px-3 ${isConfirmed && candidate.reasons.includes("email") ? "bg-amber-500/10 font-bold text-amber-700 dark:text-amber-400" : ""}`}
                    >
                      {a.email || "—"}
                    </td>
                    <td
                      className={`py-2 px-3 ${isConfirmed && candidate.reasons.includes("email") ? "bg-amber-500/10 font-bold text-amber-700 dark:text-amber-400" : ""}`}
                    >
                      {b.email || "—"}
                    </td>
                  </tr>
                  <tr className="hover:bg-muted/20">
                    <td className="py-2 pl-3 pr-2 font-medium text-muted-foreground">
                      Lead Source
                    </td>
                    <td className="py-2 px-3">{a.source || "—"}</td>
                    <td className="py-2 px-3">{b.source || "—"}</td>
                  </tr>
                  <tr className="hover:bg-muted/20">
                    <td className="py-2 pl-3 pr-2 font-medium text-muted-foreground">Lead Stage</td>
                    <td className="py-2 px-3">
                      <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] font-medium">
                        {STATUS_LABEL[a.status as LeadStatus] || a.status}
                      </span>
                    </td>
                    <td className="py-2 px-3">
                      <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] font-medium">
                        {STATUS_LABEL[b.status as LeadStatus] || b.status}
                      </span>
                    </td>
                  </tr>
                  <tr className="hover:bg-muted/20">
                    <td className="py-2 pl-3 pr-2 font-medium text-muted-foreground">Priority</td>
                    <td className="py-2 px-3 capitalize">{a.priority || "warm"}</td>
                    <td className="py-2 px-3 capitalize">{b.priority || "warm"}</td>
                  </tr>
                  <tr className="hover:bg-muted/20">
                    <td className="py-2 pl-3 pr-2 font-medium text-muted-foreground">
                      Contact State
                    </td>
                    <td className="py-2 px-3">
                      <Badge variant="outline" className="text-[10px]">
                        {a.contactStatus?.label || "Not Contacted"}
                      </Badge>
                    </td>
                    <td className="py-2 px-3">
                      <Badge variant="outline" className="text-[10px]">
                        {b.contactStatus?.label || "Not Contacted"}
                      </Badge>
                    </td>
                  </tr>
                  <tr className="hover:bg-muted/20">
                    <td className="py-2 pl-3 pr-2 font-medium text-muted-foreground">Deals & Revenue</td>
                    <td className="py-2 px-3">
                      {a.stats?.dealsCount ?? 0} deal(s) ·{" "}
                      {formatINR((a.stats?.totalDealValuePaise ?? 0) / 100)}
                    </td>
                    <td className="py-2 px-3">
                      {b.stats?.dealsCount ?? 0} deal(s) ·{" "}
                      {formatINR((b.stats?.totalDealValuePaise ?? 0) / 100)}
                    </td>
                  </tr>
                  <tr className="hover:bg-muted/20">
                    <td className="py-2 pl-3 pr-2 font-medium text-muted-foreground">Payments</td>
                    <td className="py-2 px-3">
                      {a.stats?.paymentsCount ?? 0} payment(s) ·{" "}
                      {formatINR((a.stats?.totalPaidPaise ?? 0) / 100)}
                    </td>
                    <td className="py-2 px-3">
                      {b.stats?.paymentsCount ?? 0} payment(s) ·{" "}
                      {formatINR((b.stats?.totalPaidPaise ?? 0) / 100)}
                    </td>
                  </tr>
                  <tr className="hover:bg-muted/20">
                    <td className="py-2 pl-3 pr-2 font-medium text-muted-foreground">Completed Calls</td>
                    <td className="py-2 px-3">{a.stats?.callsCount ?? 0} call(s)</td>
                    <td className="py-2 px-3">{b.stats?.callsCount ?? 0} call(s)</td>
                  </tr>
                  <tr className="hover:bg-muted/20">
                    <td className="py-2 pl-3 pr-2 font-medium text-muted-foreground">Quotations & Projects</td>
                    <td className="py-2 px-3">
                      {a.stats?.quotationsCount ?? 0} quotes · {a.stats?.projectsCount ?? 0} projects
                    </td>
                    <td className="py-2 px-3">
                      {b.stats?.quotationsCount ?? 0} quotes · {b.stats?.projectsCount ?? 0} projects
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Merge Blockers Disclosure */}
            {candidate.mergeBlockers && candidate.mergeBlockers.length > 0 && (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-900 dark:text-amber-200">
                <div className="mb-1 flex items-center gap-1.5 font-semibold">
                  <ShieldAlert className="size-4 text-amber-600" />
                  Merge Blockers Disclosed:
                </div>
                <ul className="list-inside list-disc space-y-0.5 pl-2 text-[11px]">
                  {candidate.mergeBlockers.map((blocker, idx) => (
                    <li key={idx}>{blocker}</li>
                  ))}
                </ul>
                <p className="mt-2 text-[11px] text-muted-foreground">
                  These blockers prevent destructive physical merging. Both lead identities and
                  all financial ledger entries are preserved.
                </p>
              </div>
            )}

            {/* Decision Notes */}
            <div className="space-y-1.5">
              <label htmlFor="dup-decision-note" className="text-xs font-medium">
                Decision Note (Optional):
              </label>
              <Textarea
                id="dup-decision-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Document your reason (e.g., 'Same contact across two separate brands', 'Franchise location')..."
                className="h-16 text-xs"
              />
            </div>
          </div>
        )}

        <DialogFooter className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
          <div className="flex flex-wrap items-center gap-1.5">
            {a && (
              <Button size="sm" variant="ghost" asChild>
                <Link to="/leads/$id" params={{ id: a.id }} search={pilotLinkSearch()}>
                  <ExternalLink className="mr-1 size-3" />
                  Open Lead A
                </Link>
              </Button>
            )}
            {b && (
              <Button size="sm" variant="ghost" asChild>
                <Link to="/leads/$id" params={{ id: b.id }} search={pilotLinkSearch()}>
                  <ExternalLink className="mr-1 size-3" />
                  Open Lead B
                </Link>
              </Button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={decideMutation.isPending}
              onClick={() => handleDecide("dismiss")}
            >
              <XCircle className="mr-1.5 size-3.5 text-muted-foreground" />
              Dismiss Suggestion
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={decideMutation.isPending}
              onClick={() => handleDecide("separate")}
            >
              <ShieldAlert className="mr-1.5 size-3.5 text-amber-600" />
              Keep Separate
            </Button>
            <Button
              size="sm"
              disabled={decideMutation.isPending}
              onClick={() => handleDecide("related")}
            >
              <CheckCircle2 className="mr-1.5 size-3.5" />
              Mark as Related
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
      )}
    </Dialog>
  );
}
