import { pilotLinkSearch } from "@/lib/api/pilotHook";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useNavigate } from "@tanstack/react-router";
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
import { Textarea } from "@/components/ui/textarea";
import { selectCls } from "@/components/crm/Shell";
import { useLeadsListQuery } from "@/lib/api/leadsApi";
import { useDealsQuery } from "@/lib/api/financeApi";
import {
  useCreateProjectMutation,
  useProjectTemplatesQuery,
} from "@/lib/api/projectsApi";
import type { DealDto, LeadDto, ProjectPriorityApi } from "@/lib/api/schemas";
import { dayKey } from "@/lib/crm/format";

interface PilotNewProjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  deal?: DealDto | null;
  lead?: LeadDto | null;
}

export function PilotNewProjectDialog({
  open,
  onOpenChange,
  deal,
  lead,
}: PilotNewProjectDialogProps) {
  const navigate = useNavigate();
  const createMutation = useCreateProjectMutation();

  const { data: leadsData } = useLeadsListQuery({ lifecycle: "active", limit: 100 }, open);
  const { data: dealsData } = useDealsQuery({ limit: 100 }, open);
  const { data: templatesData } = useProjectTemplatesQuery({}, open);

  const leads: LeadDto[] = leadsData?.items ?? [];
  const deals: DealDto[] = dealsData?.items ?? [];
  const templates = templatesData?.items ?? [];

  const [mode, setMode] = useState<"deal" | "lead" | "standalone">("deal");
  const [selectedDealId, setSelectedDealId] = useState("");
  const [selectedLeadId, setSelectedLeadId] = useState("");
  const [selectedTemplateId, setSelectedTemplateId] = useState("");

  const [name, setName] = useState("");
  const [clientName, setClientName] = useState("");
  const [company, setCompany] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [type, setType] = useState("Website Studio");
  const [scope, setScope] = useState("");
  const [bookingDate, setBookingDate] = useState(() => dayKey(new Date()));
  const [plannedStart, setPlannedStart] = useState("");
  const [targetDelivery, setTargetDelivery] = useState("");
  const [priority, setPriority] = useState<ProjectPriorityApi>("normal");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (deal) {
      setMode("deal");
      setSelectedDealId(deal.id);
      setName(deal.name);
      setClientName(deal.clientName);
      setCompany(deal.company ?? "");
      setPhone(deal.phone ?? "");
      setSelectedLeadId(deal.leadId ?? "");
      if (deal.leadId) {
        const matchingLead = leads.find((l) => l.id === deal.leadId);
        if (matchingLead?.email) setEmail(matchingLead.email);
      }
    } else if (lead) {
      setMode("lead");
      setSelectedLeadId(lead.id);
      setName(`${lead.name} — Project`);
      setClientName(lead.name);
      setCompany(lead.company ?? "");
      setPhone(lead.phone);
      setEmail(lead.email ?? "");
    }
  }, [open, deal, lead, leads]);

  const handleDealChange = (dealId: string) => {
    setSelectedDealId(dealId);
    if (!dealId) return;
    const d = deals.find((x) => x.id === dealId);
    if (d) {
      setName(d.name);
      setClientName(d.clientName);
      setCompany(d.company ?? "");
      setPhone(d.phone ?? "");
      setSelectedLeadId(d.leadId ?? "");
      if (d.leadId) {
        const l = leads.find((x) => x.id === d.leadId);
        if (l?.email) setEmail(l.email);
      }
    }
  };

  const handleLeadChange = (leadId: string) => {
    setSelectedLeadId(leadId);
    if (!leadId) return;
    const l = leads.find((x) => x.id === leadId);
    if (l) {
      setName(`${l.name} — Project`);
      setClientName(l.name);
      setCompany(l.company ?? "");
      setPhone(l.phone);
      setEmail(l.email ?? "");
    }
  };

  const handleTemplateChange = (templateId: string) => {
    setSelectedTemplateId(templateId);
    if (!templateId) return;
    const t = templates.find((x) => x.id === templateId);
    if (t) {
      if (t.type) setType(t.type);
    }
  };

  const handleSubmit = async () => {
    if (!name.trim()) {
      toast.error("Project name is required.");
      return;
    }
    if (!clientName.trim()) {
      toast.error("Client name is required.");
      return;
    }
    if (plannedStart && targetDelivery && targetDelivery < plannedStart) {
      toast.error("Target delivery date cannot be before planned start.");
      return;
    }

    try {
      setBusy(true);
      const res = await createMutation.mutateAsync({
        name: name.trim(),
        clientName: clientName.trim(),
        company: company.trim() || undefined,
        phone: phone.trim() || undefined,
        email: email.trim() || undefined,
        dealId: mode === "deal" && selectedDealId ? selectedDealId : undefined,
        leadId: (mode === "deal" || mode === "lead") && selectedLeadId ? selectedLeadId : undefined,
        templateId: selectedTemplateId || undefined,
        type: type.trim() || "Website Studio",
        scope: scope.trim() || undefined,
        bookingDate: bookingDate || undefined,
        plannedStart: plannedStart || undefined,
        targetDelivery: targetDelivery || undefined,
        priority,
        notes: notes.trim() || undefined,
      });

      toast.success(`Project created: ${res.project.name}`);
      onOpenChange(false);
      void navigate({
        to: "/projects/$id",
        params: { id: res.project.id },
        search: pilotLinkSearch(),
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to create project.";
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create Project (Pilot)</DialogTitle>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          {/* Source Selector */}
          <div className="grid gap-1.5">
            <Label>Project Source</Label>
            <div className="grid grid-cols-3 gap-2">
              <Button
                type="button"
                size="sm"
                variant={mode === "deal" ? "default" : "outline"}
                onClick={() => setMode("deal")}
              >
                From Won Deal
              </Button>
              <Button
                type="button"
                size="sm"
                variant={mode === "lead" ? "default" : "outline"}
                onClick={() => setMode("lead")}
              >
                From Lead
              </Button>
              <Button
                type="button"
                size="sm"
                variant={mode === "standalone" ? "default" : "outline"}
                onClick={() => {
                  setMode("standalone");
                  setSelectedDealId("");
                  setSelectedLeadId("");
                }}
              >
                Standalone
              </Button>
            </div>
          </div>

          {mode === "deal" && (
            <div className="grid gap-1.5">
              <Label htmlFor="select-deal">Select Server Deal</Label>
              <select
                id="select-deal"
                className={selectCls}
                value={selectedDealId}
                onChange={(e) => handleDealChange(e.target.value)}
              >
                <option value="">Choose a deal...</option>
                {deals.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name} ({d.clientName}) · ₹{d.finalAmount}
                  </option>
                ))}
              </select>
            </div>
          )}

          {mode === "lead" && (
            <div className="grid gap-1.5">
              <Label htmlFor="select-lead">Select Server Lead</Label>
              <select
                id="select-lead"
                className={selectCls}
                value={selectedLeadId}
                onChange={(e) => handleLeadChange(e.target.value)}
              >
                <option value="">Choose a lead...</option>
                {leads.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name} {l.company ? `(${l.company})` : ""} · {l.phone}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Project Details */}
          <div className="grid gap-1.5">
            <Label htmlFor="proj-name">Project Name *</Label>
            <Input
              id="proj-name"
              placeholder="e.g. Acme Website Redesign"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="client-name">Client Name *</Label>
              <Input
                id="client-name"
                value={clientName}
                onChange={(e) => setClientName(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="client-company">Company</Label>
              <Input
                id="client-company"
                value={company}
                onChange={(e) => setCompany(e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="client-phone">Phone</Label>
              <Input
                id="client-phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="client-email">Email</Label>
              <Input
                id="client-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="proj-type">Type</Label>
              <Input
                id="proj-type"
                value={type}
                onChange={(e) => setType(e.target.value)}
                placeholder="Website Studio"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="proj-template">Apply Template (Optional)</Label>
              <select
                id="proj-template"
                className={selectCls}
                value={selectedTemplateId}
                onChange={(e) => handleTemplateChange(e.target.value)}
              >
                <option value="">No template</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({t.tasks.length} tasks)
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="proj-scope">Agreed Scope</Label>
            <Textarea
              id="proj-scope"
              rows={2}
              placeholder="Summary of deliverables and scope agreed upon"
              value={scope}
              onChange={(e) => setScope(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="booking-date">Booking Date</Label>
              <Input
                id="booking-date"
                type="date"
                value={bookingDate}
                onChange={(e) => setBookingDate(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="planned-start">Planned Start</Label>
              <Input
                id="planned-start"
                type="date"
                value={plannedStart}
                onChange={(e) => setPlannedStart(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="target-delivery">Target Delivery</Label>
              <Input
                id="target-delivery"
                type="date"
                value={targetDelivery}
                onChange={(e) => setTargetDelivery(e.target.value)}
              />
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="proj-priority">Priority</Label>
            <select
              id="proj-priority"
              className={selectCls}
              value={priority}
              onChange={(e) => setPriority(e.target.value as ProjectPriorityApi)}
            >
              <option value="high">High</option>
              <option value="normal">Normal</option>
              <option value="low">Low</option>
            </select>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="proj-notes">Internal Notes (Owner only)</Label>
            <Textarea
              id="proj-notes"
              rows={2}
              placeholder="Never store passwords or credentials here"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button id="submit-create-project" onClick={handleSubmit} disabled={busy}>
            {busy ? "Creating..." : "Create Project"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
