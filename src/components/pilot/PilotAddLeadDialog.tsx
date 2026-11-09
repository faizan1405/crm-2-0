import { useRef, useState, type FormEvent } from "react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { AlertTriangle, Layers, PenLine, Sparkles } from "lucide-react";
import { createIdempotencyKey } from "@/lib/api/client";
import {
  extractDuplicateLeadConflict,
  extractFieldValidationErrors,
  formatApiErrorMessage,
} from "@/lib/api/errors";
import { useCreateLeadMutation } from "@/lib/api/leadsApi";
import type {
  DuplicateLeadConflict,
  LeadPriorityApi,
  LeadSourceApi,
  LeadStatusApi,
} from "@/lib/api/schemas";
import { amountFieldError, validEmail, validPhone } from "@/lib/crm/validation";
import { LEAD_SOURCES, LEAD_STATUSES, STATUS_LABEL } from "@/lib/crm/types";
import { selectCls } from "@/components/crm/ShellPrimitives";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  useDialogRequestClose,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

interface PilotAddForm {
  name: string;
  phone: string;
  email: string;
  company: string;
  requirement: string;
  source: LeadSourceApi;
  status: LeadStatusApi;
  priority: LeadPriorityApi;
  budget: string;
  quotedAmount: string;
  lostReason: string;
  notes: string;
}

const BLANK_FORM: PilotAddForm = {
  name: "",
  phone: "",
  email: "",
  company: "",
  requirement: "",
  source: "Website",
  status: "new",
  priority: "warm",
  budget: "",
  quotedAmount: "",
  lostReason: "",
  notes: "",
};

const PRIORITY_INITIAL_SCORE: Record<LeadPriorityApi, number> = {
  hot: 82,
  warm: 66,
  cold: 45,
};

export function PilotAddLeadDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (leadId: string) => void;
}) {
  const createMutation = useCreateLeadMutation();
  const [f, setF] = useState<PilotAddForm>(BLANK_FORM);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [dupConflict, setDupConflict] = useState<DuplicateLeadConflict | null>(null);
  const [allowDup, setAllowDup] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Keeps the same Idempotency-Key across transient retries of an identical draft,
  // and rotates it whenever form fields or duplicate confirmation change.
  const idempotencyKeyRef = useRef<string>(createIdempotencyKey());

  const dirty = (Object.keys(BLANK_FORM) as (keyof PilotAddForm)[]).some(
    (k) => f[k] !== BLANK_FORM[k],
  );

  const rotateKey = () => {
    idempotencyKeyRef.current = createIdempotencyKey();
  };

  const resetAndClose = () => {
    setF(BLANK_FORM);
    setErrors({});
    setDupConflict(null);
    setAllowDup(false);
    setSubmitError(null);
    rotateKey();
    onOpenChange(false);
  };

  const updateField = (k: keyof PilotAddForm) => (e: { target: { value: string } }) => {
    const val = e.target.value;
    setF((prev) => ({
      ...prev,
      [k]: val,
      ...(k === "status" && val !== "lost" ? { lostReason: "" } : {}),
    }));
    if (errors[k]) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next[k];
        return next;
      });
    }
    if (k === "phone" || k === "email") {
      setDupConflict(null);
      setAllowDup(false);
    }
    setSubmitError(null);
    rotateKey();
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (createMutation.isPending) return;

    const nextErr: Record<string, string> = {};
    if (!f.name.trim()) nextErr["name"] = "Full name is required";
    if (!validPhone(f.phone)) nextErr["phone"] = "Enter a valid 10-digit mobile number";
    if (f.email.trim() && !validEmail(f.email.trim())) nextErr["email"] = "Enter a valid email";
    const budgetErr = amountFieldError(f.budget);
    const quotedErr = amountFieldError(f.quotedAmount);
    if (budgetErr) nextErr["budget"] = budgetErr;
    if (quotedErr) nextErr["quotedAmount"] = quotedErr;
    if (f.status === "lost" && !f.lostReason.trim()) {
      nextErr["lostReason"] = "Add a lost reason";
    }

    setErrors(nextErr);
    if (Object.keys(nextErr).length > 0) {
      const firstBad = (
        ["name", "phone", "email", "budget", "quotedAmount", "lostReason"] as const
      ).find((key) => nextErr[key]);
      if (firstBad) {
        requestAnimationFrame(() => document.getElementById(`pilot-add-${firstBad}`)?.focus());
      }
      return;
    }

    setSubmitError(null);
    const parseAmount = (raw: string): number | undefined => {
      const cleaned = raw.trim();
      if (!cleaned) return undefined;
      const num = Number(cleaned);
      return Number.isFinite(num) ? num : undefined;
    };

    const budgetVal = parseAmount(f.budget);
    const quotedVal = parseAmount(f.quotedAmount);

    try {
      const res = await createMutation.mutateAsync({
        payload: {
          name: f.name.trim(),
          phone: f.phone.trim(),
          ...(f.email.trim() ? { email: f.email.trim() } : {}),
          ...(f.company.trim() ? { company: f.company.trim() } : {}),
          ...(f.requirement.trim() ? { requirement: f.requirement.trim() } : {}),
          source: f.source,
          status: f.status,
          priority: f.priority,
          aiScore: PRIORITY_INITIAL_SCORE[f.priority],
          ...(budgetVal !== undefined ? { budget: budgetVal } : {}),
          ...(quotedVal !== undefined ? { quotedAmount: quotedVal } : {}),
          ...(f.status === "lost" && f.lostReason.trim()
            ? { lostReason: f.lostReason.trim() }
            : {}),
          ...(f.notes.trim() ? { notes: f.notes.trim() } : {}),
          allowDuplicate: allowDup,
        },
        idempotencyKey: idempotencyKeyRef.current,
      });
      toast.success(`${res.lead.name} saved to MariaDB (v${res.lead.version})`);
      const newId = res.lead.id;
      resetAndClose();
      onCreated?.(newId);
    } catch (err) {
      const dup = extractDuplicateLeadConflict(err);
      if (dup) {
        setDupConflict(dup);
        setSubmitError("Duplicate phone or email detected on server. Review existing leads below.");
        return;
      }

      const fieldErrs = extractFieldValidationErrors(err);
      if (Object.keys(fieldErrs).length > 0) {
        setErrors(fieldErrs);
        const firstKey = Object.keys(fieldErrs)[0];
        if (firstKey) {
          requestAnimationFrame(() => document.getElementById(`pilot-add-${firstKey}`)?.focus());
        }
      }

      setSubmitError(formatApiErrorMessage(err, "Failed to save lead to server. Draft preserved."));
    }
  };

  const renderInput = (
    key: keyof PilotAddForm,
    label: string,
    props: React.ComponentProps<typeof Input> = {},
  ) => {
    const err = errors[key];
    return (
      <div className="grid gap-1.5">
        <Label htmlFor={`pilot-add-${key}`}>{label}</Label>
        <Input
          id={`pilot-add-${key}`}
          value={f[key]}
          onChange={updateField(key)}
          aria-invalid={err ? true : undefined}
          aria-describedby={err ? `pilot-add-${key}-error` : undefined}
          disabled={createMutation.isPending}
          {...props}
        />
        {err && (
          <p id={`pilot-add-${key}-error`} className="text-xs text-destructive" role="alert">
            {err}
          </p>
        )}
      </div>
    );
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => (nextOpen ? onOpenChange(true) : resetAndClose())}
    >
      <DialogContent dirty={dirty} className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Add lead (Server Pilot)</DialogTitle>
          <DialogDescription>
            Creates a new record directly in MariaDB via `POST /api/v1/leads`.
          </DialogDescription>
        </DialogHeader>

        <div
          className="grid grid-cols-3 gap-1 rounded-lg bg-muted p-1"
          role="tablist"
          aria-label="Entry method (Pilot scope)"
        >
          <Button
            type="button"
            variant="ghost"
            role="tab"
            aria-selected={false}
            disabled
            title="AI lead extraction connects in Checkpoint B5"
            className="flex h-auto min-h-9 items-center justify-center gap-1.5 rounded-md px-1.5 py-1.5 text-xs text-muted-foreground opacity-60 sm:text-sm"
          >
            <Sparkles className="size-4 shrink-0" />
            <span>Quick AI (B5)</span>
          </Button>
          <Button
            type="button"
            variant="ghost"
            role="tab"
            aria-selected
            className="flex h-auto min-h-9 items-center justify-center gap-1.5 rounded-md bg-card px-1.5 py-1.5 text-xs font-medium text-foreground shadow-card sm:text-sm"
          >
            <PenLine className="size-4 shrink-0" />
            <span>Manual Entry</span>
          </Button>
          <Button
            type="button"
            variant="ghost"
            role="tab"
            aria-selected={false}
            disabled
            title="Bulk import is disabled in B2B1 Pilot"
            className="flex h-auto min-h-9 items-center justify-center gap-1.5 rounded-md px-1.5 py-1.5 text-xs text-muted-foreground opacity-60 sm:text-sm"
          >
            <Layers className="size-4 shrink-0" />
            <span>Bulk (Later)</span>
          </Button>
        </div>

        <form
          noValidate
          onSubmit={handleSubmit}
          className="grid gap-4 border-t pt-4 sm:grid-cols-2"
        >
          {renderInput("name", "Full name *", { autoFocus: true })}
          {renderInput("phone", "Phone *", { inputMode: "tel", placeholder: "9876543210" })}

          {dupConflict && (
            <div
              role="alert"
              data-testid="pilot-duplicate-conflict"
              className="grid gap-2 rounded-lg border border-warning/40 bg-warning-soft p-3 text-sm sm:col-span-2"
            >
              <div className="flex items-center gap-2 font-medium text-warning">
                <AlertTriangle className="size-4 shrink-0" />
                <span>Active lead matches this {dupConflict.matchReasons.join(" & ")}</span>
              </div>
              <ul className="grid gap-1 text-xs">
                {dupConflict.matches.map((m) => (
                  <li
                    key={m.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded border bg-card/80 px-2.5 py-1.5"
                  >
                    <span>
                      <b>{m.name}</b> · <span className="num">{m.phone}</span>
                      {m.email ? ` · ${m.email}` : ""} ({m.status})
                    </span>
                    <Link
                      to="/leads/$id"
                      params={{ id: m.id }}
                      search={{ pilot: 1 }}
                      onClick={() => onOpenChange(false)}
                      className="font-medium text-primary hover:underline"
                    >
                      Open existing lead
                    </Link>
                  </li>
                ))}
              </ul>
              <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-foreground">
                <input
                  type="checkbox"
                  checked={allowDup}
                  onChange={(e) => {
                    setAllowDup(e.target.checked);
                    setSubmitError(null);
                    rotateKey();
                  }}
                />
                Save as separate lead anyway (sets allowDuplicate: true)
              </label>
            </div>
          )}

          {renderInput("email", "Email", { type: "email" })}
          {renderInput("company", "Company")}
          <div className="sm:col-span-2">{renderInput("requirement", "Requirement")}</div>
          {renderInput("budget", "Budget (₹)", { type: "number", min: 0, step: "0.01" })}
          {renderInput("quotedAmount", "Quoted amount (₹)", {
            type: "number",
            min: 0,
            step: "0.01",
          })}

          <div className="grid gap-1.5">
            <Label htmlFor="pilot-add-source">Source</Label>
            <select
              id="pilot-add-source"
              className={selectCls}
              value={f.source}
              onChange={updateField("source")}
              disabled={createMutation.isPending}
            >
              {LEAD_SOURCES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="pilot-add-priority">Priority</Label>
              <select
                id="pilot-add-priority"
                className={selectCls}
                value={f.priority}
                onChange={updateField("priority")}
                disabled={createMutation.isPending}
              >
                <option value="hot">Hot</option>
                <option value="warm">Warm</option>
                <option value="cold">Cold</option>
              </select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="pilot-add-status">Stage</Label>
              <select
                id="pilot-add-status"
                className={selectCls}
                value={f.status}
                onChange={updateField("status")}
                disabled={createMutation.isPending}
              >
                {LEAD_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABEL[s]}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {f.status === "lost" && (
            <div className="sm:col-span-2">
              {renderInput("lostReason", "Lost reason *", {
                placeholder: "Required when initial stage is Lost",
              })}
            </div>
          )}

          <div className="grid gap-1.5 sm:col-span-2">
            <Label htmlFor="pilot-add-notes">Notes</Label>
            <Textarea
              id="pilot-add-notes"
              rows={2}
              value={f.notes}
              onChange={updateField("notes")}
              disabled={createMutation.isPending}
            />
          </div>

          <div className="rounded-lg border border-dashed bg-muted/40 px-3 py-2 text-xs text-muted-foreground sm:col-span-2">
            Tags, custom fields, and follow-up scheduling are disabled in B2B1 Pilot and connect in
            later checkpoints.
          </div>

          {submitError && !dupConflict && (
            <div
              role="alert"
              className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive sm:col-span-2"
            >
              {submitError}
            </div>
          )}

          <div className="flex justify-end gap-2 sm:col-span-2">
            <PilotCancelButton disabled={createMutation.isPending} />
            <Button
              type="submit"
              disabled={createMutation.isPending || (Boolean(dupConflict) && !allowDup)}
            >
              {createMutation.isPending ? "Saving to server…" : "Save lead"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function PilotCancelButton({ disabled }: { disabled?: boolean }) {
  const requestClose = useDialogRequestClose();
  return (
    <Button type="button" variant="ghost" onClick={requestClose} disabled={disabled}>
      Cancel
    </Button>
  );
}
