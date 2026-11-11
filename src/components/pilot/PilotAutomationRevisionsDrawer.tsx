import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { History, GitCommit, User, Calendar, AlertCircle } from "lucide-react";
import {
  useAutomationRevisionsQuery,
  type AutomationRuleRevisionDto,
  TRIGGER_LABELS,
  ACTION_LABELS,
} from "@/lib/api/automationsApi";
import { formatDateTime } from "@/lib/crm/format";

export function PilotAutomationRevisionsDrawer({
  ruleId,
  ruleName,
  open,
  onClose,
}: {
  ruleId: string | null;
  ruleName: string;
  open: boolean;
  onClose: () => void;
}) {
  const { data: revisions, isLoading, error } = useAutomationRevisionsQuery(ruleId);

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader>
          <div className="flex items-center gap-2">
            <History className="size-5 text-primary" />
            <SheetTitle className="text-lg">Revision History</SheetTitle>
          </div>
          <SheetDescription>
            Immutable audit log of all changes to <b className="text-foreground">{ruleName}</b>.
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-4">
          {isLoading && (
            <p className="text-sm text-muted-foreground py-8 text-center">Loading revision history...</p>
          )}

          {error && (
            <div className="rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-xs text-destructive flex items-center gap-2">
              <AlertCircle className="size-4 shrink-0" />
              <span>Failed to load revisions: {String(error)}</span>
            </div>
          )}

          {!isLoading && !error && (!revisions || revisions.length === 0) && (
            <p className="text-sm text-muted-foreground py-8 text-center">No revision history found.</p>
          )}

          {!isLoading &&
            revisions &&
            revisions.map((rev: AutomationRuleRevisionDto) => (
              <article
                key={rev.id}
                className="rounded-lg border bg-card p-4 space-y-2 text-sm shadow-sm"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="flex items-center gap-1 font-semibold text-xs rounded bg-primary/10 text-primary px-2 py-0.5">
                      <GitCommit className="size-3.5" />
                      v{rev.version}
                    </span>
                    <span className="font-medium text-xs text-muted-foreground">{rev.name}</span>
                  </div>
                  <Badge variant="outline" className="capitalize text-[10px]">
                    {rev.status}
                  </Badge>
                </div>

                {rev.diffSummary && (
                  <p className="text-xs text-foreground bg-secondary/50 p-2 rounded border">
                    {rev.diffSummary}
                  </p>
                )}

                <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground pt-1">
                  <div className="flex items-center gap-1">
                    <Calendar className="size-3.5 shrink-0" />
                    <span>{formatDateTime(rev.createdAt)}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <User className="size-3.5 shrink-0" />
                    <span>Author: {rev.actorUserId || "Owner"}</span>
                  </div>
                </div>

                <div className="border-t pt-2 mt-2 text-xs space-y-1">
                  <div>
                    <span className="font-medium text-muted-foreground">Trigger: </span>
                    <span className="text-foreground">{TRIGGER_LABELS[rev.triggerType] || rev.triggerType}</span>
                  </div>
                  <div>
                    <span className="font-medium text-muted-foreground">Actions: </span>
                    <span className="text-foreground">
                      {rev.actions.map((a) => ACTION_LABELS[a] || a).join(", ")}
                    </span>
                  </div>
                </div>
              </article>
            ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}
