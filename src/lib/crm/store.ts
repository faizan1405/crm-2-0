// Single local demo store for Scale Flow CRM 2.0.
// Integration point: replace these actions with API calls in the backend phase.
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { Lead, Deal, Payment, FollowUp, Note, LeadActivity, BinEntry } from "./types";
import { mergePatch, QUICK_LABEL, type QuickStatus } from "./leadtools";
import type { ParsedLead } from "./parse";
import { isPending, activeFollowUp } from "./followups";
import { isConnectedOutcome, outcomeQuick, type CallOutcome } from "./calllog";

export type FollowUpResult = { ok: true; id: string } | { ok: false; conflict?: FollowUp; error?: string };
export interface CallLogInput {
  opId: string;
  leadId: string;
  outcome: CallOutcome;
  notes?: string;
  stage: Lead["status"];
  lostReason?: string;
  source: string;
  followUp?: { dueAt: string; type: FollowUp["type"]; note?: string };
  /** Required when the lead already has an active follow-up and followUp is set. */
  onConflict?: "keep" | "replace";
}
type LeadSnap = { status: Lead["status"]; lostReason: string | undefined; lastContact: string | undefined; nextFollowUp: string | undefined; quickStatus: Lead["quickStatus"] };
export interface CallOp {
  id: string;
  leadId: string;
  at: string;
  before: LeadSnap;
  after: LeadSnap;
  activityId: string;
  followUpId?: string;
  followUpDueAt?: string;
  replacedId?: string;
  undone?: boolean;
}
export type CallLogResult = { ok: true; opId: string } | { ok: false; conflict?: FollowUp; error?: string };
import { demoLeads, demoDeals, demoPayments, demoFollowUps, demoNotes, demoActivities } from "./demo";
import { uid, digits, dayKey } from "./format";
import { dealOutstanding } from "./finance";
import { leadEditError } from "./validation";
import { builtInTemplates, DEFAULT_DEMO_CATEGORIES, nextQuoteNumber, quoteError, quoteTotals, safeUrl, type BusinessProfile, type Demo, type Quotation, type QuoteStatus, type WaTemplate } from "./studio";

export type ThemePref = "light" | "dark" | "system";
export interface Prefs {
  owner: string;
  email: string;
  business: string;
  theme: ThemePref;
  accent: "indigo" | "emerald" | "blue";
  density: "comfortable" | "compact";
  timeFormat: "12h" | "24h";
  dateStyle: "short" | "long";
  defaultLeadSort: "recent" | "score" | "value";
  notifyFollowUps: boolean;
  notifyPayments: boolean;
  notifyDigest: boolean;
}

interface CRMState extends Prefs {
  leads: Lead[];
  deals: Deal[];
  payments: Payment[];
  followUps: FollowUp[];
  notes: Note[];
  activities: LeadActivity[];
  /** Waste + Recently Deleted leads, restorable. */
  bin: BinEntry[];
  /** Briefing checklist item keys marked done today (does not touch lead data). */
  briefingDone: string[];
  briefingDate: string;
  addLead: (lead: Omit<Lead, "id" | "createdAt" | "updatedAt">) => string;
  updateLead: (id: string, patch: Partial<Lead>) => boolean;
  /** Soft delete into Recently Deleted. */
  deleteLead: (id: string) => void;
  wasteLead: (id: string, reason?: string) => void;
  /** Returns an error message, or undefined on success. */
  restoreLead: (binId: string) => string | undefined;
  purgeBin: (binId: string) => void;
  emptyBin: (kind: BinEntry["kind"]) => void;
  mergeIntoLead: (id: string, incoming: ParsedLead, mode: "fill" | "overwrite") => boolean;
  setQuickStatus: (id: string, q: QuickStatus | undefined) => void;
  addActivity: (leadId: string, text: string, type?: LeadActivity["type"]) => void;
  addDeal: (deal: Omit<Deal, "id" | "createdAt">) => void;
  addPayment: (payment: Omit<Payment, "id">) => boolean;
  voidPayment: (id: string) => void;
  /** One active follow-up per lead: returns a conflict unless replaceId names the active one. Same opId never saves twice. */
  addFollowUp: (followUp: Omit<FollowUp, "id">, opts?: { replaceId?: string }) => FollowUpResult;
  callOps: CallOp[];
  logCall: (input: CallLogInput) => CallLogResult;
  /** Returns an explanation when undo is not safe, else undefined. */
  undoCall: (opId: string) => string | undefined;
  completeFollowUp: (id: string) => void;
  rescheduleFollowUp: (id: string, date: string) => void;
  saveNote: (note: Note) => void;
  deleteNote: (id: string) => void;
  toggleBriefing: (key: string) => void;
  resetBriefing: () => void;
  preferences: (patch: Partial<Prefs>) => void;
  reset: () => void;
  // Sales Studio — one shared source for quotations, templates and demos (not cleared by reset()).
  quotations: Quotation[];
  waTemplates: WaTemplate[];
  demos: Demo[];
  demoCategories: string[];
  businessProfile: BusinessProfile;
  saveQuotation: (q: Quotation) => string | null;
  duplicateQuotation: (id: string) => string | undefined;
  deleteQuotation: (id: string) => void;
  setQuoteStatus: (id: string, status: QuoteStatus) => void;
  saveTemplate: (t: WaTemplate) => void;
  deleteTemplate: (id: string) => void;
  setDefaultTemplate: (id: string) => void;
  resetTemplates: () => void;
  saveDemo: (d: Demo) => boolean;
  deleteDemo: (id: string) => void;
  moveDemo: (id: string, dir: -1 | 1) => void;
  addDemoCategory: (name: string) => void;
  saveBusinessProfile: (p: BusinessProfile) => void;
}

export function duplicatePhone(leads: Lead[], phone: string): Lead | undefined {
  const d = digits(phone);
  if (d.length !== 10) return undefined;
  return leads.find((l) => digits(l.phone) === d);
}

const defaultPrefs: Prefs = {
  owner: "Faizan",
  email: "faizan@joinscaleflow.in",
  business: "Scale Flow",
  theme: "light",
  accent: "indigo",
  density: "comfortable",
  timeFormat: "12h",
  dateStyle: "short",
  defaultLeadSort: "recent",
  notifyFollowUps: true,
  notifyPayments: true,
  notifyDigest: false,
};
const initialData = {
  leads: demoLeads,
  deals: demoDeals,
  payments: demoPayments,
  followUps: demoFollowUps,
  notes: demoNotes,
  activities: demoActivities,
  bin: [] as BinEntry[],
  callOps: [] as CallOp[],
  briefingDone: [] as string[],
  briefingDate: "",
};

export const useCRM = create<CRMState>()(
  persist(
    (set, get) => {
      const syncNext = (leadId: string) => {
        const next = get().followUps.filter((x) => x.leadId === leadId && isPending(x)).map((x) => x.dueAt).sort()[0];
        set((s) => ({ leads: s.leads.map((l) => (l.id === leadId ? { ...l, nextFollowUp: next } : l)) }));
      };
      const moveToBin = (id: string, kind: BinEntry["kind"], reason?: string) => {
        const lead = get().leads.find((l) => l.id === id);
        if (!lead) return;
        const at = new Date().toISOString();
        const acts = [{ id: uid("activity"), leadId: id, type: kind === "waste" ? "waste" : "note", text: kind === "waste" ? `Moved to Waste${reason ? `: ${reason}` : ""}` : "Lead deleted", at } as LeadActivity, ...get().activities.filter((a) => a.leadId === id)];
        set((s) => ({
          bin: [{ id: uid("bin"), kind, at, ...(reason ? { reason } : {}), lead, followUps: s.followUps.filter((f) => f.leadId === id), activities: acts }, ...s.bin],
          leads: s.leads.filter((l) => l.id !== id),
          followUps: s.followUps.filter((f) => f.leadId !== id),
          activities: s.activities.filter((a) => a.leadId !== id),
        }));
      };
      return {
      ...initialData,
      ...defaultPrefs,
      addLead: (lead) => {
        const id = uid("lead");
        const at = new Date().toISOString();
        set((s) => ({
          leads: [{ ...lead, id, createdAt: at, updatedAt: at }, ...s.leads],
          activities: [{ id: uid("activity"), leadId: id, type: "created", text: "Lead added to Scale Flow", at }, ...s.activities],
        }));
        return id;
      },
      updateLead: (id, patch) => {
        if (leadEditError(get().leads, id, patch)) return false;
        const prev = get().leads.find((l) => l.id === id);
        set((s) => ({
          leads: s.leads.map((l) => (l.id === id ? { ...l, ...patch, ...(patch.status && patch.status !== "lost" ? { lostReason: undefined } : {}), updatedAt: new Date().toISOString() } : l)),
          deals: s.deals.map((d) => d.leadId === id ? { ...d, ...(patch.name !== undefined ? { clientName: patch.name } : {}), ...(patch.company !== undefined ? { company: patch.company } : {}) } : d),
        }));
        if (patch.status && prev && prev.status !== patch.status) get().addActivity(id, `Status changed to ${patch.status}`, "status");
        return true;
      },
      deleteLead: (id) => moveToBin(id, "deleted"),
      wasteLead: (id, reason) => moveToBin(id, "waste", reason),
      restoreLead: (binId) => {
        const e = get().bin.find((b) => b.id === binId);
        if (!e) return "Not found";
        if (duplicatePhone(get().leads, e.lead.phone)) return "An active lead already uses this phone — merge or edit it first";
        const at = new Date().toISOString();
        set((s) => ({
          bin: s.bin.filter((b) => b.id !== binId),
          leads: [{ ...e.lead, updatedAt: at }, ...s.leads],
          followUps: [...e.followUps, ...s.followUps],
          activities: [{ id: uid("activity"), leadId: e.lead.id, type: "restored", text: `Restored from ${e.kind === "waste" ? "Waste" : "Recently Deleted"}`, at }, ...e.activities, ...s.activities],
        }));
        return undefined;
      },
      purgeBin: (binId) => set((s) => ({ bin: s.bin.filter((b) => b.id !== binId) })),
      emptyBin: (kind) => set((s) => ({ bin: s.bin.filter((b) => b.kind !== kind) })),
      mergeIntoLead: (id, incoming, mode) => {
        const lead = get().leads.find((l) => l.id === id);
        if (!lead) return false;
        const patch = mergePatch(lead, incoming, mode);
        if (Object.keys(patch).length && !get().updateLead(id, patch)) return false;
        const fields = Object.keys(patch).filter((k) => k !== "notes");
        get().addActivity(id, fields.length || patch.notes ? `Merged new details (${[...fields, ...(patch.notes ? ["notes"] : [])].join(", ")})` : "Duplicate entry checked — nothing new to merge", "merged");
        return true;
      },
      setQuickStatus: (id, q) => {
        const lead = get().leads.find((l) => l.id === id);
        if (!lead || lead.quickStatus === q) return;
        set((s) => ({ leads: s.leads.map((l) => (l.id === id ? { ...l, quickStatus: q, updatedAt: new Date().toISOString() } : l)) }));
        get().addActivity(id, q ? `Quick status: ${QUICK_LABEL[q]}` : "Quick status cleared", "quick");
      },
      addActivity: (leadId, text, type = "note") =>
        set((s) => ({ activities: [{ id: uid("activity"), leadId, type, text, at: new Date().toISOString() }, ...s.activities] })),
      addDeal: (deal) => set((s) => ({ deals: [{ ...deal, id: uid("deal"), createdAt: new Date().toISOString() }, ...s.deals] })),
      addPayment: (payment) => {
        const target = get().deals.find((d) => d.id === payment.dealId);
        if (!target || !Number.isFinite(payment.amount) || payment.amount <= 0 || payment.amount > dealOutstanding(target, get().payments) || !/^\d{4}-\d{2}-\d{2}$/.test(payment.date)) return false;
        set((s) => ({ payments: [{ ...payment, id: uid("payment") }, ...s.payments] }));
        const deal = get().deals.find((d) => d.id === payment.dealId);
        if (deal?.leadId) get().addActivity(deal.leadId, `Payment of ₹${payment.amount.toLocaleString("en-IN")} recorded`, "payment");
        return true;
      },
      voidPayment: (id) => set((s) => ({ payments: s.payments.map((p) => (p.id === id ? { ...p, voided: true } : p)) })),
      addFollowUp: (f, opts) => {
        if (f.opId) { const dup = get().followUps.find((x) => x.opId === f.opId); if (dup) return { ok: true, id: dup.id }; }
        if (!get().leads.some((l) => l.id === f.leadId)) return { ok: false, error: "Lead not found" };
        if (!Number.isFinite(new Date(f.dueAt).getTime())) return { ok: false, error: "Choose a valid date and time" };
        const active = activeFollowUp(get().followUps, f.leadId);
        if (active && opts?.replaceId !== active.id) return { ok: false, conflict: active };
        const id = uid("followup"); const at = new Date().toISOString();
        set((s) => ({ followUps: [{ ...f, id }, ...s.followUps.map((x) => (active && x.id === active.id ? { ...x, cancelledAt: at, replacedBy: id } : x))] }));
        syncNext(f.leadId);
        get().addActivity(f.leadId, active ? `Follow-up replaced (${f.type})` : `Follow-up scheduled (${f.type})`, "followup");
        return { ok: true, id };
      },
      completeFollowUp: (id) => {
        const f = get().followUps.find((x) => x.id === id);
        if (!f || !isPending(f)) return;
        set((s) => ({ followUps: s.followUps.map((x) => (x.id === id ? { ...x, completedAt: new Date().toISOString() } : x)) }));
        get().updateLead(f.leadId, { lastContact: new Date().toISOString() });
        syncNext(f.leadId);
        get().addActivity(f.leadId, `Follow-up completed (${f.type})`, "followup");
      },
      rescheduleFollowUp: (id, dueAt) => {
        const f = get().followUps.find((x) => x.id === id);
        if (!f || !isPending(f) || !Number.isFinite(new Date(dueAt).getTime())) return;
        set((s) => ({ followUps: s.followUps.map((x) => (x.id === id ? { ...x, dueAt } : x)) }));
        syncNext(f.leadId);
        get().addActivity(f.leadId, "Follow-up rescheduled", "followup");
      },
      logCall: (i) => {
        if (get().callOps.some((o) => o.id === i.opId)) return { ok: true, opId: i.opId };
        const lead = get().leads.find((l) => l.id === i.leadId);
        if (!lead) return { ok: false, error: "Lead not found" };
        if (i.stage === "lost" && lead.status !== "lost" && !i.lostReason?.trim()) return { ok: false, error: "Add a lost reason" };
        const active = activeFollowUp(get().followUps, i.leadId);
        if (i.followUp && active && !i.onConflict) return { ok: false, conflict: active };
        if (i.followUp && !Number.isFinite(new Date(i.followUp.dueAt).getTime())) return { ok: false, error: "Choose a valid follow-up time" };
        const at = new Date().toISOString();
        const before: LeadSnap = { status: lead.status, lostReason: lead.lostReason, lastContact: lead.lastContact, nextFollowUp: lead.nextFollowUp, quickStatus: lead.quickStatus };
        const q = outcomeQuick(i.outcome);
        const patch: Partial<Lead> = {
          ...(i.stage !== lead.status ? { status: i.stage, ...(i.stage === "lost" ? { lostReason: i.lostReason!.trim() } : {}) } : {}),
          ...(isConnectedOutcome(i.outcome) ? { lastContact: at } : {}),
          ...(q ? { quickStatus: q } : {}),
        };
        const next = { ...lead, ...patch, ...(patch.status && patch.status !== "lost" ? { lostReason: undefined } : {}) };
        const editErr = leadEditError(get().leads, lead.id, next);
        if (editErr) return { ok: false, error: editErr };
        const activityId = uid("activity");
        const notes = i.notes?.trim();
        const add = i.followUp && !(active && i.onConflict === "keep");
        const followUpId = add ? uid("followup") : undefined;
        const replacedId = add && active ? active.id : undefined;
        set((s) => {
          const fus = s.followUps.map((x) => (x.id === replacedId ? { ...x, cancelledAt: at, replacedBy: followUpId } : x));
          if (followUpId && i.followUp) fus.unshift({ id: followUpId, leadId: lead.id, type: i.followUp.type, dueAt: i.followUp.dueAt, note: i.followUp.note || notes || `After call: ${i.outcome}`, opId: i.opId });
          const nextDue = fus.filter((x) => x.leadId === lead.id && isPending(x)).map((x) => x.dueAt).sort()[0];
          const updated = { ...next, nextFollowUp: nextDue, updatedAt: at };
          const statusAct: LeadActivity[] = patch.status ? [{ id: uid("activity"), leadId: lead.id, type: "status", text: `Status changed to ${patch.status}`, at, opId: i.opId }] : [];
          return {
            followUps: fus,
            leads: s.leads.map((l) => (l.id === lead.id ? updated : l)),
            activities: [{ id: activityId, leadId: lead.id, type: "call", outcome: i.outcome, opId: i.opId, at, text: `${isConnectedOutcome(i.outcome) ? "Call" : "Call attempt"} (${i.source}): ${i.outcome}${notes ? ` — ${notes}` : ""}${followUpId ? replacedId ? " · follow-up replaced" : " · follow-up scheduled" : ""}` }, ...statusAct, ...s.activities],
            callOps: [{ id: i.opId, leadId: lead.id, at, before, after: { status: updated.status, lostReason: updated.lostReason, lastContact: updated.lastContact, nextFollowUp: updated.nextFollowUp, quickStatus: updated.quickStatus }, activityId, ...(followUpId ? { followUpId, followUpDueAt: i.followUp!.dueAt } : {}), ...(replacedId ? { replacedId } : {}) }, ...s.callOps].slice(0, 50),
          };
        });
        return { ok: true, opId: i.opId };
      },
      undoCall: (opId) => {
        const op = get().callOps.find((o) => o.id === opId);
        if (!op) return "This call log can no longer be undone";
        if (op.undone) return undefined;
        const lead = get().leads.find((l) => l.id === op.leadId);
        if (!lead) return "The lead was moved to Waste or deleted after this call — restore it first";
        if (lead.status !== op.after.status || lead.lastContact !== op.after.lastContact || lead.quickStatus !== op.after.quickStatus) return "The lead changed after this call (stage, contact or quick status), so Undo was stopped to protect the newer change";
        const fu = op.followUpId ? get().followUps.find((x) => x.id === op.followUpId) : undefined;
        if (op.followUpId && (!fu || !isPending(fu) || fu.dueAt !== op.followUpDueAt)) return "The follow-up from this call was already completed, moved or replaced — update it directly instead";
        const replaced = op.replacedId ? get().followUps.find((x) => x.id === op.replacedId) : undefined;
        const restoreReplaced = replaced && replaced.cancelledAt && replaced.replacedBy === op.followUpId && !replaced.completedAt;
        set((s) => {
          const fus = s.followUps.filter((x) => x.id !== op.followUpId).map((x) => (restoreReplaced && x.id === op.replacedId ? { ...x, cancelledAt: undefined, replacedBy: undefined } : x));
          const nextDue = fus.filter((x) => x.leadId === op.leadId && isPending(x)).map((x) => x.dueAt).sort()[0];
          return {
            followUps: fus,
            leads: s.leads.map((l) => (l.id === op.leadId ? { ...l, status: op.before.status, lostReason: op.before.lostReason, lastContact: op.before.lastContact, quickStatus: op.before.quickStatus, nextFollowUp: nextDue, updatedAt: new Date().toISOString() } : l)),
            activities: s.activities.filter((a) => a.opId !== opId),
            callOps: s.callOps.map((o) => (o.id === opId ? { ...o, undone: true } : o)),
          };
        });
        return undefined;
      },
      saveNote: (note) =>
        set((s) => ({ notes: s.notes.some((n) => n.id === note.id) ? s.notes.map((n) => (n.id === note.id ? note : n)) : [note, ...s.notes] })),
      deleteNote: (id) => set((s) => ({ notes: s.notes.filter((n) => n.id !== id) })),
      toggleBriefing: (key) =>
        set((s) => {
          const today = dayKey(new Date());
          const done = s.briefingDate === today ? s.briefingDone : [];
          return { briefingDate: today, briefingDone: done.includes(key) ? done.filter((k) => k !== key) : [...done, key] };
        }),
      resetBriefing: () => set({ briefingDone: [], briefingDate: dayKey(new Date()) }),
      preferences: (patch) => set(patch),
      reset: () => set({ ...initialData }),
      quotations: [],
      waTemplates: builtInTemplates(),
      demos: [],
      demoCategories: DEFAULT_DEMO_CATEGORIES,
      businessProfile: { name: "" },
      saveQuotation: (q) => {
        const err = quoteError(q);
        if (err) return null;
        const at = new Date().toISOString();
        const prev = get().quotations.find((x) => x.id === q.id);
        const total = quoteTotals(q).total;
        if (!prev) {
          const number = q.number || nextQuoteNumber(get().quotations, Number(q.issueDate.slice(0, 4)));
          const row: Quotation = { ...q, number, revision: 1, history: [{ revision: 1, at, total, title: q.title }], createdAt: at, updatedAt: at };
          set((s) => ({ quotations: [row, ...s.quotations] }));
          return row.id;
        }
        const changed = quoteTotals(prev).total !== total || prev.title !== q.title || JSON.stringify(prev.items) !== JSON.stringify(q.items);
        const revision = changed ? prev.revision + 1 : prev.revision;
        const row: Quotation = { ...q, createdAt: prev.createdAt, number: prev.number, revision, history: changed ? [...prev.history, { revision, at, total, title: q.title }] : prev.history, updatedAt: at };
        // Deals and payments are deliberately untouched: a quotation is never a confirmed amount.
        set((s) => ({ quotations: s.quotations.map((x) => (x.id === q.id ? row : x)) }));
        return row.id;
      },
      duplicateQuotation: (id) => {
        const src = get().quotations.find((x) => x.id === id);
        if (!src) return undefined;
        const at = new Date().toISOString();
        const copy: Quotation = { ...src, id: uid("quo"), number: nextQuoteNumber(get().quotations, Number(at.slice(0, 4))), title: `${src.title} (copy)`, status: "draft", sharedAt: undefined, items: src.items.map((i) => ({ ...i, id: uid("qi") })), revision: 1, history: [{ revision: 1, at, total: quoteTotals(src).total, title: `${src.title} (copy)` }], createdAt: at, updatedAt: at };
        set((s) => ({ quotations: [copy, ...s.quotations] }));
        return copy.id;
      },
      deleteQuotation: (id) => set((s) => ({ quotations: s.quotations.filter((x) => x.id !== id) })),
      setQuoteStatus: (id, status) => set((s) => ({ quotations: s.quotations.map((x) => (x.id === id ? { ...x, status, updatedAt: new Date().toISOString(), ...(status === "shared" ? { sharedAt: new Date().toISOString() } : {}) } : x)) })),
      saveTemplate: (t) => set((s) => {
        const row = { ...t, updatedAt: new Date().toISOString() };
        const exists = s.waTemplates.some((x) => x.id === t.id);
        let list = exists ? s.waTemplates.map((x) => (x.id === t.id ? row : x)) : [...s.waTemplates, row];
        if (row.isDefault) list = list.map((x) => (x.purpose === row.purpose && x.id !== row.id ? { ...x, isDefault: false } : x));
        return { waTemplates: list };
      }),
      deleteTemplate: (id) => set((s) => ({ waTemplates: s.waTemplates.filter((x) => x.id !== id) })),
      setDefaultTemplate: (id) => set((s) => {
        const t = s.waTemplates.find((x) => x.id === id);
        return t ? { waTemplates: s.waTemplates.map((x) => (x.purpose === t.purpose ? { ...x, isDefault: x.id === id, ...(x.id === id ? { enabled: true } : {}) } : x)) } : {};
      }),
      resetTemplates: () => set((s) => ({ waTemplates: [...builtInTemplates(), ...s.waTemplates.filter((x) => !x.builtIn).map((x) => ({ ...x, isDefault: false }))] })),
      saveDemo: (d) => {
        if (!d.title.trim() || !safeUrl(d.url)) return false;
        const row = { ...d, url: safeUrl(d.url)! };
        set((s) => ({ demos: s.demos.some((x) => x.id === d.id) ? s.demos.map((x) => (x.id === d.id ? row : x)) : [...s.demos, { ...row, order: s.demos.length }] }));
        return true;
      },
      deleteDemo: (id) => set((s) => ({ demos: s.demos.filter((x) => x.id !== id) })),
      moveDemo: (id, dir) => set((s) => {
        const list = [...s.demos].sort((a, b) => a.order - b.order);
        const i = list.findIndex((x) => x.id === id), j = i + dir;
        if (i < 0 || j < 0 || j >= list.length) return {};
        [list[i], list[j]] = [list[j]!, list[i]!];
        return { demos: list.map((x, order) => ({ ...x, order })) };
      }),
      addDemoCategory: (name) => set((s) => (name.trim() && !s.demoCategories.includes(name.trim()) ? { demoCategories: [...s.demoCategories, name.trim()] } : {})),
      saveBusinessProfile: (p) => set({ businessProfile: p }),
    };
    },
    { name: "scale-flow-crm-2-demo", version: 2, storage: createJSONStorage(() => localStorage), skipHydration: true },
  ),
);
