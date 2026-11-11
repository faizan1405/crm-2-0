import { History, RefreshCw, UserCheck } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/crm/format";
import { useReviewHistoryQuery } from "@/lib/api/inboxApi";

interface PilotInboxHistoryDrawerProps {
  open: boolean;
  onClose: () => void;
  leadId?: string;
  pairKey?: string;
}

export function PilotInboxHistoryDrawer({
  open,
  onClose,
  leadId,
  pairKey,
}: PilotInboxHistoryDrawerProps) {
  const { data, isLoading, refetch } = useReviewHistoryQuery({
    ...(leadId ? { leadId } : {}),
    ...(pairKey ? { pairKey } : {}),
    limit: 50,
  });

  const getActionBadge = (action: string) => {
    switch (action) {
      case "mark_related":
        return <Badge className="bg-success/20 text-success border-success/30">Marked Related</Badge>;
      case "mark_separate":
        return <Badge className="bg-amber-500/20 text-amber-700 dark:text-amber-400 border-amber-500/30">Marked Separate</Badge>;
      case "dismiss":
        return <Badge variant="outline">Dismissed</Badge>;
      case "unlink":
        return <Badge variant="destructive">Unlinked</Badge>;
      case "mark_reviewed":
        return <Badge className="bg-primary/20 text-primary border-primary/30">Marked Reviewed</Badge>;
      case "unmark_reviewed":
        return <Badge variant="secondary">Moved to Needs Review</Badge>;
      case "flag":
        return <Badge className="bg-destructive/20 text-destructive border-destructive/30">Flagged Duplicate</Badge>;
      case "unflag":
        return <Badge variant="outline">Unflagged Duplicate</Badge>;
      default:
        return <Badge variant="outline">{action}</Badge>;
    }
  };

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <div className="flex items-center justify-between">
            <SheetTitle className="flex items-center gap-2 text-base font-semibold">
              <History className="size-4 text-primary" />
              Smart Inbox Review Audit Trail
            </SheetTitle>
            <Button size="icon" variant="ghost" onClick={() => void refetch()} className="size-8">
              <RefreshCw className="size-3.5" />
            </Button>
          </div>
          <SheetDescription className="text-xs">
            Immutable log of all intake reviews, duplicate decisions, manual flags, and relationship
            unlinks in MariaDB.
          </SheetDescription>
        </SheetHeader>

        <div className="mt-4 space-y-3">
          {isLoading && (
            <div className="flex h-32 items-center justify-center text-xs text-muted-foreground">
              <RefreshCw className="mr-1.5 size-3.5 animate-spin" />
              Loading audit entries...
            </div>
          )}

          {!isLoading && (!data?.items || data.items.length === 0) && (
            <div className="rounded-lg border border-dashed p-6 text-center text-xs text-muted-foreground">
              No audit entries recorded yet. Decisions made in the inbox or duplicate review will appear
              here in chronological order.
            </div>
          )}

          {!isLoading && data?.items && data.items.length > 0 && (
            <div className="relative border-l border-muted-foreground/20 pl-4 space-y-4 text-xs">
              {data.items.map((item) => (
                <div key={item.id} className="relative group">
                  <div className="absolute -left-[21px] top-1 size-2.5 rounded-full bg-primary ring-4 ring-background" />
                  <div className="flex flex-wrap items-center justify-between gap-1">
                    <div className="flex items-center gap-1.5">
                      {getActionBadge(item.action)}
                    </div>
                    <span className="text-[11px] text-muted-foreground num">
                      {formatDateTime(item.createdAt)}
                    </span>
                  </div>

                  {item.pairKey && (
                    <div className="mt-1 text-[11px] text-muted-foreground font-mono">
                      Pair: {item.pairKey}
                    </div>
                  )}

                  {(item.notes || (item as unknown as { note?: string }).note) && (
                    <div className="mt-1 rounded bg-muted/40 p-2 text-[11px] text-foreground">
                      “{item.notes || (item as unknown as { note?: string }).note}”
                    </div>
                  )}

                  <div className="mt-1 flex items-center gap-1 text-[10px] text-muted-foreground">
                    <UserCheck className="size-3" />
                    <span>Actor: {item.actorUserId || "Owner"}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
