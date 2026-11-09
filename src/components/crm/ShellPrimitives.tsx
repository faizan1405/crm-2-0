import type { ReactNode } from "react";
import { initials } from "@/lib/crm/format";
import { cn } from "@/lib/utils";

export function ScaleMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" fill="none" aria-hidden="true" className={cn("size-8", className)}>
      <path d="M5 23V14l7-5v9l-7 5Zm10-5V9l7-5v9l-7 5Zm0 10v-7l12-8v7l-12 8Z" fill="currentColor" />
    </svg>
  );
}

export function Identity({
  name,
  company,
  className,
}: {
  name: string;
  company?: string | undefined;
  className?: string;
}) {
  return (
    <div className={cn("flex min-w-0 items-center gap-3", className)}>
      <div className="identity-avatar grid size-9 shrink-0 place-items-center rounded-full bg-clay-soft text-[11px] font-semibold text-foreground">
        {initials(name)}
      </div>
      <div className="min-w-0">
        <div className="text-sm font-semibold text-foreground">{name}</div>
        {company && <div className="mt-0.5 text-xs text-muted-foreground">{company}</div>}
      </div>
    </div>
  );
}

export function Stat({
  label,
  value,
  hint,
  tone = "primary",
  icon,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "primary" | "success" | "warning" | "destructive" | "teal";
  icon?: ReactNode;
}) {
  const t = {
    primary: "bg-primary-soft text-primary",
    success: "bg-success-soft text-success",
    warning: "bg-warning-soft text-warning",
    destructive: "bg-destructive-soft text-destructive",
    teal: "bg-teal-soft text-teal",
  }[tone];
  return (
    <div className="stat-card surface surface-hover relative p-4 sm:p-5" data-tone={tone}>
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs font-medium text-muted-foreground">{label}</div>
        {icon && (
          <div
            className={cn("grid size-8 shrink-0 place-items-center rounded-lg [&_svg]:size-4", t)}
          >
            {icon}
          </div>
        )}
      </div>
      <div className="num mt-3 text-[26px] font-medium leading-tight text-foreground">{value}</div>
      {hint && <div className="mt-2 text-[11px] text-muted-foreground">{hint}</div>}
    </div>
  );
}

const PRIORITY: Record<string, string> = {
  hot: "bg-destructive-soft text-destructive",
  warm: "bg-clay-soft text-foreground",
  cold: "bg-neutral-soft text-muted-foreground",
};

export function PriorityBadge({ p }: { p: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[10px] font-semibold capitalize",
        PRIORITY[p],
      )}
    >
      <span className="size-1 rounded-full bg-current" />
      {p}
    </span>
  );
}

export function Empty({
  icon,
  title,
  hint,
  action,
}: {
  icon: ReactNode;
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center px-6 py-14 text-center">
      <div className="grid size-12 place-items-center rounded-lg border bg-muted/50 text-muted-foreground [&_svg]:size-5">
        {icon}
      </div>
      <div className="mt-4 editorial text-2xl text-foreground">{title}</div>
      {hint && (
        <p className="mt-2 max-w-xs text-sm leading-relaxed text-muted-foreground">{hint}</p>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export const selectCls =
  "h-10 max-w-full rounded-md border border-input bg-card px-3 text-sm text-foreground transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none";
