import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { Sparkles, AlertTriangle, PenLine } from "lucide-react";
import { useCRM, duplicatePhone } from "@/lib/crm/store";
import { amountFieldError, validEmail, validPhone } from "@/lib/crm/validation";
import { businessDateTime } from "@/lib/crm/dates";
import { structureLead } from "@/lib/crm/parse";
import { LEAD_SOURCES, LEAD_STATUSES, STATUS_LABEL, type LeadPriority, type LeadSource, type LeadStatus, type Lead } from "@/lib/crm/types";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { selectCls } from "./Shell";
import { cn } from "@/lib/utils";
import { FieldForm, TagPicker, toDraft, useViewer, type Draft } from "./Customize";
import { activeFields, fieldEditable, validateLeadValues } from "@/lib/crm/customize";

interface Form {
  name: string; phone: string; email: string; company: string; requirement: string;
  source: LeadSource; status: LeadStatus; priority: LeadPriority; budget: string; quotedAmount: string;
  followUp: string; notes: string;
}
const blank: Form = { name: "", phone: "", email: "", company: "", requirement: "", source: "Website", status: "new", priority: "warm", budget: "", quotedAmount: "", followUp: "", notes: "" };
const SAMPLE = "Rahul Sharma, 9876543210, owns an event company, wants a website, budget 40000, follow up next Monday.";

export function AddLeadDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { leads, addLead, addFollowUp, customFields, setLeadFieldValues, setLeadTags } = useCRM();
  const viewer = useViewer();
  const cfDefs = activeFields(customFields).filter((d) => fieldEditable(d, viewer));
  const cfInit = () => Object.fromEntries(cfDefs.map((d) => [d.id, toDraft(d, d.defaultValue)])) as Record<string, Draft>;
  const [cf, setCf] = useState<Record<string, Draft>>(cfInit);
  const [cfErr, setCfErr] = useState<Record<string, string>>({});
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [mode, setMode] = useState<"ai" | "manual">("ai");
  const [raw, setRaw] = useState("");
  const [f, setF] = useState<Form>(blank);
  const [structured, setStructured] = useState(false);
  const [hint, setHint] = useState<string | undefined>();
  const [allowDup, setAllowDup] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<keyof Form, string>>>({});
  const dup = duplicatePhone(leads, f.phone);
  const set = (k: keyof Form) => (e: { target: { value: string } }) => setF((p) => ({ ...p, [k]: e.target.value }));

  const close = () => { setCf(cfInit()); setCfErr({}); setTagIds([]); onOpenChange(false); setF(blank); setRaw(""); setStructured(false); setHint(undefined); setAllowDup(false); setErrors({}); };

  const structure = () => {
    if (!raw.trim()) { toast.error("Paste some lead details first"); return; }
    const p = structureLead(raw);
    setF({ ...blank, name: p.name ?? "", phone: p.phone ?? "", email: p.email ?? "", company: p.company ?? "", requirement: p.requirement ?? "", source: p.source ?? "Other", budget: p.budget ? String(p.budget) : "", quotedAmount: p.quotedAmount ? String(p.quotedAmount) : "", notes: p.notes });
    setHint(p.followUpHint);
    setStructured(true);
  };

  const save = () => {
    const e: typeof errors = {};
    if (!f.name.trim()) e.name = "Name is required";
    if (!validPhone(f.phone)) e.phone = "Enter a 10-digit phone number";
    if (f.email.trim() && !validEmail(f.email)) e.email = "Invalid email";
    const be = amountFieldError(f.budget), qe = amountFieldError(f.quotedAmount);
    if (be) e.budget = be;
    if (qe) e.quotedAmount = qe;
    setErrors(e);
    // Keyboard users land on the first field that needs fixing (form order).
    const firstBad = (["name", "phone", "email", "budget", "quotedAmount"] as const).find((k) => e[k]);
    if (firstBad) requestAnimationFrame(() => document.getElementById(`f-${firstBad}`)?.focus());
    const cfr = validateLeadValues(cfDefs, cf, { isNew: true });
    setCfErr(cfr.errors);
    if (Object.keys(e).length || Object.keys(cfr.errors).length) return;
    if (dup && !allowDup) { toast.error("Confirm the duplicate before saving"); return; }
    const num = (s: string) => (Number(s) > 0 ? Number(s) : undefined);
    const budget = num(f.budget), quoted = num(f.quotedAmount);
    const lead: Omit<Lead, "id" | "createdAt" | "updatedAt"> = {
      name: f.name.trim(), phone: f.phone.trim(), source: f.source, status: f.status, priority: f.priority, pinned: false,
      aiScore: f.priority === "hot" ? 82 : f.priority === "warm" ? 66 : 45,
      ...(f.email.trim() ? { email: f.email.trim() } : {}), ...(f.company ? { company: f.company } : {}), ...(f.requirement ? { requirement: f.requirement } : {}),
      ...(budget ? { budget } : {}), ...(quoted ? { quotedAmount: quoted } : {}), ...(f.notes ? { notes: f.notes } : {}),
    };
    const id = addLead(lead);
    if (!id) { toast.error("Not allowed by this employee's permissions"); return; }
    if (cfDefs.length) setLeadFieldValues(id, cf, { isNew: true });
    if (tagIds.length) setLeadTags(id, tagIds);
    if (f.followUp) addFollowUp({ leadId: id, type: "call", dueAt: businessDateTime(f.followUp), note: "First follow-up" });
    toast.success(`${lead.name} added to Leads and Pipeline`);
    close();
  };

  const err = (k: keyof Form) => errors[k] && <p id={`f-${k}-error`} className="text-xs text-destructive">{errors[k]}</p>;
  const field = (k: keyof Form, label: string, props: React.ComponentProps<typeof Input> = {}) => (
    <div className="grid gap-1.5"><Label htmlFor={`f-${k}`}>{label}</Label><Input id={`f-${k}`} value={f[k]} onChange={set(k)} aria-invalid={!!errors[k]} {...(errors[k] ? { "aria-describedby": `f-${k}-error` } : {})} {...props} />{err(k)}</div>
  );
  const showForm = mode === "manual" || structured;

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? onOpenChange(true) : close())}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Add lead</DialogTitle>
          <DialogDescription>A new opportunity starts here.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1" role="tablist">
          {([["ai", "Quick AI Entry", Sparkles], ["manual", "Manual Entry", PenLine]] as const).map(([m, label, Icon]) => (
            <Button variant="ghost" key={m} role="tab" aria-selected={mode === m} onClick={() => setMode(m)} className={cn("flex items-center justify-center gap-2 rounded-md py-1.5 text-sm font-medium transition-colors", mode === m ? "bg-card text-foreground shadow-card" : "text-muted-foreground hover:text-foreground")}>
              <Icon className="size-4" />{label}
            </Button>
          ))}
        </div>

        {mode === "ai" && (
          <div className="grid gap-3 rounded-lg border border-primary/20 bg-primary-soft/40 p-4">
            <div className="flex items-center justify-between">
              <Label htmlFor="raw">Lead details</Label>
              <span className="rounded-full bg-warning-soft px-2 py-0.5 text-[10px] font-semibold text-warning uppercase">Demo parser · not real AI</span>
            </div>
            <Textarea id="raw" rows={5} value={raw} onChange={(e) => setRaw(e.target.value)} placeholder={SAMPLE} />
            <div className="flex flex-wrap justify-between gap-2">
              <Button variant="link" size="sm" onClick={() => setRaw(SAMPLE)}>Use example</Button>
              <Button onClick={structure}><Sparkles className="size-4" />Structure lead</Button>
            </div>
            {structured && <p className="text-xs text-muted-foreground">Review the fields below. Anything not found was left empty — nothing is guessed.</p>}
          </div>
        )}

        {showForm && (
          <div className="grid gap-4 border-t pt-5 sm:grid-cols-2">
            {field("name", "Full name *")}
            {field("phone", "Phone *", { inputMode: "tel" })}
            {dup && (
              <div className="rounded-lg border border-warning/40 bg-warning-soft p-3 text-sm sm:col-span-2">
                <div className="flex items-center gap-2 font-medium text-warning"><AlertTriangle className="size-4" />This phone already belongs to {dup.name}</div>
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  <Link to="/leads/$id" params={{ id: dup.id }} onClick={close} className="text-sm font-medium text-primary hover:underline">View existing lead</Link>
                  <label className="flex items-center gap-2 text-foreground"><input type="checkbox" checked={allowDup} onChange={(e) => setAllowDup(e.target.checked)} />Save as a separate lead anyway</label>
                </div>
              </div>
            )}
            {field("email", "Email", { type: "email" })}
            {field("company", "Company")}
            <div className="sm:col-span-2">{field("requirement", "Requirement")}</div>
            {field("budget", "Budget (₹)", { type: "number", min: 0 })}
            {field("quotedAmount", "Quoted amount (₹)", { type: "number", min: 0 })}
            <div className="grid gap-1.5"><Label>Source</Label><select className={selectCls} value={f.source} onChange={set("source")}>{LEAD_SOURCES.map((s) => <option key={s}>{s}</option>)}</select></div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5"><Label>Priority</Label><select className={selectCls} value={f.priority} onChange={set("priority")}>{["hot", "warm", "cold"].map((s) => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}</select></div>
              <div className="grid gap-1.5"><Label>Stage</Label><select className={selectCls} value={f.status} onChange={set("status")}>{LEAD_STATUSES.filter((s) => s !== "lost").map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}</select></div>
            </div>
            <div className="grid gap-1.5 sm:col-span-2">
              <Label htmlFor="f-fu">Follow-up</Label>
              <Input id="f-fu" type="datetime-local" value={f.followUp} onChange={set("followUp")} />
              {hint && !f.followUp && <p className="text-xs text-warning">Mentioned “{hint}” — please confirm the exact date and time.</p>}
            </div>
            {cfDefs.length > 0 && <div className="grid gap-3 border-t pt-4 sm:col-span-2"><p className="text-sm font-semibold">Additional information</p><FieldForm defs={cfDefs} draft={cf} onChange={(k, v) => setCf((p) => ({ ...p, [k]: v }))} errors={cfErr} /></div>}
            <div className="grid gap-1.5 sm:col-span-2"><Label>Tags</Label><TagPicker value={tagIds} onChange={setTagIds} /></div>
            <div className="grid gap-1.5 sm:col-span-2"><Label>Notes</Label><Textarea rows={2} value={f.notes} onChange={set("notes")} /></div>
            <div className="flex justify-end gap-2 sm:col-span-2">
              <Button variant="ghost" onClick={close}>Cancel</Button>
              <Button onClick={save} disabled={!!dup && !allowDup}>Save lead</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
