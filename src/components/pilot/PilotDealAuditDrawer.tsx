import { History, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { formatDate, formatINR } from "@/lib/crm/format";
import { useDealAuditQuery } from "@/lib/api/financeApi";
import type { DealDto, FinanceEventDto } from "@/lib/api/schemas";

interface PilotDealAuditDrawerProps {
  deal: DealDto;
  onClose: () => void;
}

export function PilotDealAuditDrawer({ deal, onClose }: PilotDealAuditDrawerProps) {
  const { data: auditData, isLoading } = useDealAuditQuery(deal.id);
  const events: FinanceEventDto[] = auditData?.events ?? [];

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="size-5 text-teal" />
            Financial Audit History · {deal.name}
          </DialogTitle>
          <DialogDescription>
            Immutable, server-verified event timeline tracking deal creation, edits, payments, voids,
            and proof changes.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[60vh] overflow-y-auto py-2">
          {isLoading ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              Loading financial audit history…
            </div>
          ) : events.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              No financial audit events recorded yet.
            </div>
          ) : (
            <ol className="relative ml-2 border-l border-border pl-4 space-y-4">
              {events.map((evt) => (
                <li key={evt.id} className="text-xs">
                  <div className="absolute -left-1.5 mt-1.5 size-3 rounded-full border border-card bg-teal" />
                  <div className="flex flex-wrap items-center justify-between gap-1 text-[11px] text-muted-foreground">
                    <span>
                      {formatDate(evt.at, {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })}
                      {` at `}
                      {new Date(evt.at).toLocaleTimeString("en-IN", {
                        hour: "2-digit",
                        minute: "2-digit",
                        timeZone: "Asia/Kolkata",
                      })}
                    </span>
                    <span className="rounded bg-secondary px-1.5 py-0.5 font-mono text-[10px]">
                      {evt.eventType}
                    </span>
                  </div>

                  <p className="mt-1 font-semibold text-foreground">{evt.summary}</p>
                  {evt.reason && (
                    <p className="mt-0.5 text-muted-foreground italic">&ldquo;{evt.reason}&rdquo;</p>
                  )}
                  {evt.amount !== undefined && (
                    <p className="mt-0.5 font-mono text-teal">
                      Amount: {formatINR(evt.amount)}
                    </p>
                  )}
                </li>
              ))}
            </ol>
          )}
        </div>

        <DialogFooter className="flex items-center justify-between sm:justify-between">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <ShieldCheck className="size-4 text-success" />
            Tamper-evident MariaDB ledger
          </div>
          <Button variant="ghost" onClick={onClose} className="rounded-full">
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
