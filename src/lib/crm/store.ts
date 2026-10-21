// Single local demo store for Scale Flow CRM 2.0.
// Integration point: replace these actions with API calls in the backend phase.
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { Lead, Deal, Payment, FollowUp, Note, LeadActivity } from "./types";
import { demoLeads, demoDeals, demoPayments, demoFollowUps, demoNotes, demoActivities } from "./demo";
import { uid, digits } from "./format";

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
  /** Briefing checklist item keys marked done today (does not touch lead data). */
  briefingDone: string[];
  addLead: (lead: Omit<Lead, "id" | "createdAt" | "updatedAt">) => string;
  updateLead: (id: string, patch: Partial<Lead>) => void;
  deleteLead: (id: string) => void;
  addActivity: (leadId: string, text: string, type?: LeadActivity["type"]) => void;
  addDeal: (deal: Omit<Deal, "id" | "createdAt">) => void;
  addPayment: (payment: Omit<Payment, "id">) => void;
  voidPayment: (id: string) => void;
  addFollowUp: (followUp: Omit<FollowUp, "id">) => void;
  completeFollowUp: (id: string) => void;
  rescheduleFollowUp: (id: string, date: string) => void;
  saveNote: (note: Note) => void;
  deleteNote: (id: string) => void;
  toggleBriefing: (key: string) => void;
  resetBriefing: () => void;
  preferences: (patch: Partial<Prefs>) => void;
  reset: () => void;
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
  briefingDone: [] as string[],
};

export const useCRM = create<CRMState>()(
  persist(
    (set, get) => ({
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
        const prev = get().leads.find((l) => l.id === id);
        set((s) => ({ leads: s.leads.map((l) => (l.id === id ? { ...l, ...patch, updatedAt: new Date().toISOString() } : l)) }));
        if (patch.status && prev && prev.status !== patch.status) get().addActivity(id, `Status changed to ${patch.status}`, "status");
      },
      deleteLead: (id) =>
        set((s) => ({
          leads: s.leads.filter((l) => l.id !== id),
          followUps: s.followUps.filter((f) => f.leadId !== id),
          activities: s.activities.filter((a) => a.leadId !== id),
        })),
      addActivity: (leadId, text, type = "note") =>
        set((s) => ({ activities: [{ id: uid("activity"), leadId, type, text, at: new Date().toISOString() }, ...s.activities] })),
      addDeal: (deal) => set((s) => ({ deals: [{ ...deal, id: uid("deal"), createdAt: new Date().toISOString() }, ...s.deals] })),
      addPayment: (payment) => {
        set((s) => ({ payments: [{ ...payment, id: uid("payment") }, ...s.payments] }));
        const deal = get().deals.find((d) => d.id === payment.dealId);
        if (deal?.leadId) get().addActivity(deal.leadId, `Payment of ₹${payment.amount.toLocaleString("en-IN")} recorded`, "payment");
      },
      voidPayment: (id) => set((s) => ({ payments: s.payments.map((p) => (p.id === id ? { ...p, voided: true } : p)) })),
      addFollowUp: (f) => {
        set((s) => ({ followUps: [{ ...f, id: uid("followup") }, ...s.followUps] }));
        get().updateLead(f.leadId, { nextFollowUp: f.dueAt });
        get().addActivity(f.leadId, `Follow-up scheduled (${f.type})`, "followup");
      },
      completeFollowUp: (id) => {
        const f = get().followUps.find((x) => x.id === id);
        set((s) => ({ followUps: s.followUps.map((x) => (x.id === id ? { ...x, completedAt: new Date().toISOString() } : x)) }));
        if (f) {
          get().updateLead(f.leadId, { lastContact: new Date().toISOString() });
          get().addActivity(f.leadId, `Follow-up completed (${f.type})`, "followup");
        }
      },
      rescheduleFollowUp: (id, dueAt) => set((s) => ({ followUps: s.followUps.map((f) => (f.id === id ? { ...f, dueAt } : f)) })),
      saveNote: (note) =>
        set((s) => ({ notes: s.notes.some((n) => n.id === note.id) ? s.notes.map((n) => (n.id === note.id ? note : n)) : [note, ...s.notes] })),
      deleteNote: (id) => set((s) => ({ notes: s.notes.filter((n) => n.id !== id) })),
      toggleBriefing: (key) =>
        set((s) => ({ briefingDone: s.briefingDone.includes(key) ? s.briefingDone.filter((k) => k !== key) : [...s.briefingDone, key] })),
      resetBriefing: () => set({ briefingDone: [] }),
      preferences: (patch) => set(patch),
      reset: () => set({ ...initialData }),
    }),
    { name: "scale-flow-crm-2-demo", version: 2, storage: createJSONStorage(() => localStorage), skipHydration: true },
  ),
);
