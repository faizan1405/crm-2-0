import { Phone } from "lucide-react";
import { startCall } from "@/components/crm/PostCallDialog";
import { cn } from "@/lib/utils";
import { useAccess } from "@/lib/crm/session";

/** One Call action for every surface: opens the device dialer and the shared call log. */
export function CallButton({ leadId, phone, name, source, compact, className }: { leadId: string; phone: string; name: string; source: string; compact?: boolean; className?: string }) {
  const canLog = useAccess().can("clients.calls");
  return (
    <a href={`tel:${phone.replace(/[^\d+]/g, "")}`} draggable={false} aria-label={`Call ${name}`} title={`Call ${name}`} onClick={(e) => { e.stopPropagation(); if (canLog) startCall(leadId, source); }}
      className={cn("call-btn", compact && "is-compact", className)}>
      <Phone className="size-3.5" />{!compact && <span>Call</span>}
    </a>
  );
}
