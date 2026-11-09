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
import { selectCls } from "@/components/crm/Shell";
import { cn } from "@/lib/utils";
import { useLeadsListQuery } from "@/lib/api/leadsApi";
import { useCreateDealMutation } from "@/lib/api/financeApi";
import type { ClientTypeApi, DealStatusApi, LeadDto } from "@/lib/api/schemas";

interface PilotNewDealDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function PilotNewDealDialog({ open, onOpenChange }: PilotNewDealDialogProps) {
  const { data: leadsData } = useLeadsListQuery({ lifecycle: "active", limit: 100 }, open);
  const leads: LeadDto[] = leadsData?.items ?? [];
  const createDealMutation = useCreateDealMutation();

  const [clientType, setClientType] = useState<ClientTypeApi>("crm");
  const [selectedLeadId, setSelectedLeadId] = useState("");
  const [name, setName] = useState("");
  const [clientName, setClientName] = useState("");
  const [company, setCompany] = useState("");
  const [phone, setPhone] = useState("");
  const [quoted, setQuoted] = useState("");
  const [finalAmount, setFinalAmount] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [status, setStatus] = useState<DealStatusApi>("active");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  const resetForm = () => {
    setSelectedLeadId("");
    setName("");
    setClientName("");
    setCompany("");
    setPhone("");
    setQuoted("");
    setFinalAmount("");
    setDueDate("");
    setStatus("active");
    setNotes("");
  };

  const handleSave = async () => {
    const selectedLead = leads.find((l) => l.id === selectedLeadId);
    const resolvedClientName = clientType === "crm" ? selectedLead?.name : clientName.trim();

    if (!resolvedClientName) {
      toast.error(clientType === "crm" ? "Please select a server lead" : "Client name is required");
      return;
    }
    if (!name.trim()) {
      toast.error("Deal name is required");
      return;
    }
    const finalNum = Number(finalAmount);
    if (!Number.isFinite(finalNum) || finalNum <= 0) {
      toast.error("Enter a valid final agreed amount");
      return;
    }
    const quotedNum = quoted.trim() ? Number(quoted) : finalNum;

    setBusy(true);
    try {
      await createDealMutation.mutateAsync({
        name: name.trim(),
        clientType,
        clientName: resolvedClientName,
        leadId: clientType === "crm" && selectedLead ? selectedLead.id : undefined,
        company: clientType === "crm" ? selectedLead?.company : company.trim() || undefined,
        phone: clientType === "crm" ? selectedLead?.phone : phone.trim() || undefined,
        quotedAmount: quotedNum,
        finalAmount: finalNum,
        status,
        dueDate: dueDate.trim() || undefined,
        notes: notes.trim() || undefined,
      });

      toast.success("Deal created successfully in MariaDB");
      resetForm();
      onOpenChange(false);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to create deal";
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>New Deal (Pilot · MariaDB Backed)</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1">
          <Button
            type="button"
            variant="ghost"
            onClick={() => setClientType("crm")}
            className={cn(
              "rounded-md py-1.5 text-sm font-medium",
              clientType === "crm" ? "bg-card shadow-card text-foreground" : "text-muted-foreground",
            )}
          >
            Server Lead
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => setClientType("other")}
            className={cn(
              "rounded-md py-1.5 text-sm font-medium",
              clientType === "other" ? "bg-card shadow-card text-foreground" : "text-muted-foreground",
            )}
          >
            Other Client
          </Button>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {clientType === "crm" ? (
            <div className="grid gap-1.5 sm:col-span-2">
              <Label htmlFor="deal-lead-select">Select Active Server Lead</Label>
              <select
                id="deal-lead-select"
                className={selectCls}
                value={selectedLeadId}
                onChange={(e) => setSelectedLeadId(e.target.value)}
              >
                <option value="">Choose a lead…</option>
                {leads.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                    {l.company ? ` · ${l.company}` : ""}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <>
              <div className="grid gap-1.5">
                <Label htmlFor="deal-client-name">Client Name</Label>
                <Input
                  id="deal-client-name"
                  placeholder="e.g. John Doe"
                  value={clientName}
                  onChange={(e) => setClientName(e.target.value)}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="deal-client-company">Company (optional)</Label>
                <Input
                  id="deal-client-company"
                  placeholder="e.g. Acme Corp"
                  value={company}
                  onChange={(e) => setCompany(e.target.value)}
                />
              </div>
              <div className="grid gap-1.5 sm:col-span-2">
                <Label htmlFor="deal-client-phone">Phone (optional)</Label>
                <Input
                  id="deal-client-phone"
                  placeholder="+91..."
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
              </div>
            </>
          )}

          <div className="grid gap-1.5 sm:col-span-2">
            <Label htmlFor="deal-title-name">Deal Name</Label>
            <Input
              id="deal-title-name"
              placeholder="e.g. Website Redesign & SEO"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="deal-quoted-amt">Quoted Amount (₹)</Label>
            <Input
              id="deal-quoted-amt"
              type="number"
              placeholder="Optional quote baseline"
              value={quoted}
              onChange={(e) => setQuoted(e.target.value)}
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="deal-final-amt">Final Agreed Amount (₹)</Label>
            <Input
              id="deal-final-amt"
              type="number"
              placeholder="Authoritative final value"
              value={finalAmount}
              onChange={(e) => setFinalAmount(e.target.value)}
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="deal-due-date">Due Date</Label>
            <Input
              id="deal-due-date"
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="deal-initial-status">Status</Label>
            <select
              id="deal-initial-status"
              className={selectCls}
              value={status}
              onChange={(e) => setStatus(e.target.value as DealStatusApi)}
            >
              <option value="active">Active</option>
              <option value="won">Won</option>
              <option value="lost">Lost</option>
            </select>
          </div>
        </div>

        <DialogFooter className="mt-4">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={busy}>
            {busy ? "Creating…" : "Create Deal"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
