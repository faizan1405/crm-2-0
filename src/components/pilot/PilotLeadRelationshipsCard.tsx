import { pilotLinkSearch } from "@/lib/api/pilotHook";
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  AlertTriangle,
  ExternalLink,
  Link2,
  RefreshCw,
  Trash2,
  Unlink,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatDate } from "@/lib/crm/format";
import {
  useLeadRelationshipsQuery,
  useUnlinkLeadRelationshipMutation,
  type LeadRelationshipItem,
} from "@/lib/api/inboxApi";

interface PilotLeadRelationshipsCardProps {
  leadId: string;
}

export function PilotLeadRelationshipsCard({ leadId }: PilotLeadRelationshipsCardProps) {
  const [unlinkingItem, setUnlinkingItem] = useState<LeadRelationshipItem | null>(null);

  const { data: relationships = [], isLoading, refetch } = useLeadRelationshipsQuery(leadId);
  const unlinkMutation = useUnlinkLeadRelationshipMutation();

  const handleConfirmUnlink = async () => {
    if (!unlinkingItem) return;

    try {
      await unlinkMutation.mutateAsync(unlinkingItem.pairKey);
      toast.success("Relationship unlinked successfully — audit event logged");
      setUnlinkingItem(null);
      void refetch();
    } catch (err: unknown) {
      const errObj = err as { message?: string };
      toast.error(errObj.message || "Failed to unlink relationship");
    }
  };

  if (isLoading) {
    return (
      <div className="flex h-16 items-center justify-center text-xs text-muted-foreground">
        <RefreshCw className="mr-1.5 size-3.5 animate-spin" />
        Loading relationships...
      </div>
    );
  }

  if (relationships.length === 0) {
    return null; // Don't render card if lead has no active relationships
  }

  return (
    <div className="rounded-lg border bg-card p-3 shadow-xs">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs font-semibold">
          <Link2 className="size-3.5 text-primary" />
          Active Lead Relationships ({relationships.length})
        </div>
      </div>

      <div className="space-y-2">
        {relationships.map((rel) => {
          const isRelated = rel.kind === "related";
          return (
            <div
              key={rel.id ?? rel.relationshipId ?? rel.pairKey}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2.5 text-xs bg-muted/20"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-medium text-foreground">{rel.otherLead.name}</span>
                  {rel.otherLead.company && (
                    <span className="text-muted-foreground">({rel.otherLead.company})</span>
                  )}
                  <Badge
                    variant="outline"
                    className={
                      isRelated
                        ? "border-success/30 bg-success/10 text-success text-[10px]"
                        : "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400 text-[10px]"
                    }
                  >
                    {isRelated ? "Related Lead" : "Kept Separate"}
                  </Badge>
                </div>
                <div className="mt-0.5 flex flex-wrap gap-x-2 text-[11px] text-muted-foreground">
                  <span className="num">{rel.otherLead.phone}</span>
                  {rel.otherLead.email && <span>{rel.otherLead.email}</span>}
                  <span>Linked {formatDate(rel.createdAt)}</span>
                  {(rel.note || rel.notes) && <span className="italic">“{rel.note || rel.notes}”</span>}
                </div>
              </div>

              <div className="flex items-center gap-1">
                <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" asChild>
                  <Link
                    to="/leads/$id"
                    params={{ id: rel.otherLead.id }}
                    search={pilotLinkSearch()}
                  >
                    <ExternalLink className="mr-1 size-3" />
                    Open
                  </Link>
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 text-xs text-destructive hover:bg-destructive/10"
                  onClick={() => setUnlinkingItem(rel)}
                >
                  <Unlink className="mr-1 size-3" />
                  Unlink
                </Button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Unlink Confirmation Dialog */}
      <Dialog open={Boolean(unlinkingItem)} onOpenChange={(o) => !o && setUnlinkingItem(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base font-semibold text-destructive">
              <AlertTriangle className="size-4" />
              Unlink Lead Relationship?
            </DialogTitle>
            <DialogDescription className="text-xs">
              Are you sure you want to remove the{" "}
              <strong>{unlinkingItem?.kind}</strong> relationship between this lead and{" "}
              <strong>{unlinkingItem?.otherLead.name}</strong>?
            </DialogDescription>
          </DialogHeader>

          <p className="text-xs text-muted-foreground">
            This action will disconnect the relationship link in MariaDB and record an{" "}
            <code>unlink</code> event in the audit history. Neither lead record will be deleted.
          </p>

          <DialogFooter className="gap-2 border-t pt-3">
            <Button size="sm" variant="ghost" onClick={() => setUnlinkingItem(null)}>
              Cancel
            </Button>
            <Button
              size="sm"
              variant="destructive"
              disabled={unlinkMutation.isPending}
              onClick={handleConfirmUnlink}
            >
              <Trash2 className="mr-1.5 size-3.5" />
              Confirm Unlink
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
