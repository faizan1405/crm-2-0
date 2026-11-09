import { useEffect, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, FileText, PenLine } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { selectCls } from "@/components/crm/ShellPrimitives";
import {
  useCreateQuotationTemplateMutation,
  useUpdateQuotationTemplateMutation,
} from "@/lib/api/quotationsApi";
import type { QuotationTemplateDto } from "@/lib/api/schemas";
import { isApiError } from "@/lib/api/errors";

const PLACEHOLDERS = [
  "firstName",
  "clientName",
  "companyName",
  "packageName",
  "packagePrice",
  "businessName",
  "ownerName",
];

interface PilotQuotationTemplateModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  template?: QuotationTemplateDto | null | undefined;
}

export function PilotQuotationTemplateModal({
  open,
  onOpenChange,
  template,
}: PilotQuotationTemplateModalProps) {
  const isNew = !template;
  const createMutation = useCreateQuotationTemplateMutation();
  const updateMutation = useUpdateQuotationTemplateMutation();

  const [name, setName] = useState("");
  const [priceType, setPriceType] = useState<"fixed" | "custom">("fixed");
  const [priceAmount, setPriceAmount] = useState<string>("");
  const [priceLabel, setPriceLabel] = useState("");
  const [messageBody, setMessageBody] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [staleError, setStaleError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (template) {
      setName(template.name);
      setPriceType(template.priceType);
      setPriceAmount(template.priceAmount !== null ? String(template.priceAmount) : "");
      setPriceLabel(template.priceLabel ?? "");
      setMessageBody(template.messageBody);
      setIsActive(template.isActive);
      setStaleError(null);
    } else {
      setName("");
      setPriceType("fixed");
      setPriceAmount("45000");
      setPriceLabel("");
      setMessageBody("Hi {firstName},\n\nHere is our proposal for {packageName}: ₹{packagePrice}.\n\nLooking forward to working together!");
      setIsActive(true);
      setStaleError(null);
    }
  }, [template, open]);

  const insertToken = (token: string) => {
    setMessageBody((prev) => `${prev} {${token}}`);
  };

  const handleSave = async () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      toast.error("Package name is required");
      return;
    }

    let parsedAmount: number | undefined;
    if (priceType === "fixed") {
      parsedAmount = Number(priceAmount);
      if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
        toast.error("Enter a valid fixed price amount");
        return;
      }
    }

    if (!messageBody.trim()) {
      toast.error("Quotation message body is required");
      return;
    }

    setBusy(true);
    setStaleError(null);

    try {
      if (isNew) {
        await createMutation.mutateAsync({
          name: trimmedName,
          priceType,
          priceAmount: parsedAmount,
          priceLabel: priceType === "custom" ? priceLabel.trim() || "On request" : undefined,
          messageBody: messageBody.trim(),
          isActive,
        });
        toast.success("Quotation package created in MariaDB");
      } else {
        await updateMutation.mutateAsync({
          id: template.id,
          payload: {
            expectedVersion: template.version,
            name: trimmedName,
            priceType,
            priceAmount: priceType === "fixed" ? parsedAmount : null,
            priceLabel: priceType === "custom" ? priceLabel.trim() || "On request" : null,
            messageBody: messageBody.trim(),
            isActive,
          },
        });
        toast.success("Quotation package updated in MariaDB");
      }
      onOpenChange(false);
    } catch (err: unknown) {
      if (isApiError(err) && err.status === 409) {
        setStaleError("This package was modified in another session. Please reload to see the latest version.");
      } else {
        const msg = err instanceof Error ? err.message : "Failed to save quotation package.";
        toast.error(msg);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[94dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="size-5 text-primary" />
            {isNew ? "Create Quotation Package" : `Edit ${template?.name}`}
          </DialogTitle>
          <DialogDescription>
            Reusable sales package stored in MariaDB. Changing this template never modifies past issued quotations.
          </DialogDescription>
        </DialogHeader>

        {staleError && (
          <div role="alert" className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive-soft/50 p-3 text-xs text-destructive">
            <AlertTriangle className="size-4 shrink-0 mt-0.5" />
            <span>{staleError}</span>
          </div>
        )}

        <div className="grid gap-4 py-2">
          <div className="grid gap-3 sm:grid-cols-[1fr_240px]">
            <div className="grid gap-1.5">
              <label htmlFor="tpl-name" className="text-xs font-semibold">Package Name</label>
              <Input
                id="tpl-name"
                autoFocus
                placeholder="e.g. Full-Stack Web App & 3D Visualizer"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            <div className="grid gap-1.5">
              <label htmlFor="tpl-price-type" className="text-xs font-semibold">Pricing</label>
              <div className="flex gap-2">
                <select
                  id="tpl-price-type"
                  aria-label="Price type"
                  className={selectCls}
                  value={priceType}
                  onChange={(e) => setPriceType(e.target.value as "fixed" | "custom")}
                >
                  <option value="fixed">₹ Fixed</option>
                  <option value="custom">Custom</option>
                </select>
                {priceType === "fixed" ? (
                  <Input
                    aria-label="Fixed price"
                    type="number"
                    min={0}
                    step="any"
                    placeholder="45000"
                    value={priceAmount}
                    onChange={(e) => setPriceAmount(e.target.value)}
                  />
                ) : (
                  <Input
                    aria-label="Price label"
                    placeholder="On request"
                    value={priceLabel}
                    onChange={(e) => setPriceLabel(e.target.value)}
                  />
                )}
              </div>
            </div>
          </div>

          <div className="grid gap-1.5">
            <div className="flex items-center justify-between">
              <label htmlFor="tpl-body" className="text-xs font-semibold">Message Body</label>
              <div className="flex items-center gap-2">
                <label htmlFor="tpl-active" className="text-xs text-muted-foreground">Active in Studio</label>
                <Switch
                  id="tpl-active"
                  aria-label="Active package toggle"
                  checked={isActive}
                  onCheckedChange={setIsActive}
                />
              </div>
            </div>
            <Textarea
              id="tpl-body"
              rows={8}
              className="font-mono text-xs leading-relaxed"
              value={messageBody}
              onChange={(e) => setMessageBody(e.target.value)}
              placeholder="Hi {firstName}, here is our quotation for {packageName}: ₹{packagePrice}..."
            />
            <div className="flex flex-wrap items-center gap-1.5 pt-1">
              <span className="text-[11px] text-muted-foreground">Placeholders:</span>
              {PLACEHOLDERS.map((token) => (
                <button
                  key={token}
                  type="button"
                  className="rounded bg-muted px-1.5 py-0.5 text-[11px] font-mono text-muted-foreground hover:bg-muted/80 hover:text-foreground"
                  onClick={() => insertToken(token)}
                >
                  {`{${token}}`}
                </button>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button type="button" onClick={handleSave} disabled={busy}>
            {busy ? "Saving to MariaDB..." : isNew ? "Create Package" : "Save Changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
