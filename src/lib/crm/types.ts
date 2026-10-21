// Entity types for Scale Flow CRM 2.0.
// These mirror the shapes the real backend will provide (integration point for the next phase).

export type LeadStatus = "new" | "contacted" | "qualified" | "proposal" | "won" | "lost";
export type LeadPriority = "hot" | "warm" | "cold";
export type LeadSource =
  | "Website"
  | "Referral"
  | "Instagram"
  | "Google Ads"
  | "LinkedIn"
  | "Walk-in"
  | "WhatsApp"
  | "Other";

export interface Lead {
  id: string;
  name: string;
  phone: string;
  email?: string;
  company?: string;
  requirement?: string;
  source: LeadSource;
  status: LeadStatus;
  priority: LeadPriority;
  aiScore?: number; // 0-100, simulated in demo
  quotedAmount?: number;
  budget?: number;
  lastContact?: string; // ISO
  nextFollowUp?: string | undefined; // ISO; cleared when no follow-ups remain
  notes?: string;
  pinned: boolean;
  lostReason?: string | undefined;
  createdAt: string;
  updatedAt: string;
}

export type ActivityType = "created" | "call" | "whatsapp" | "email" | "meeting" | "note" | "status" | "payment" | "followup";

export interface LeadActivity {
  id: string;
  leadId: string;
  type: ActivityType;
  text: string;
  at: string;
}

export type FollowUpType = "call" | "whatsapp" | "meeting" | "email";

export interface FollowUp {
  id: string;
  leadId: string;
  type: FollowUpType;
  dueAt: string;
  note?: string;
  completedAt?: string;
}

export type DealStatus = "active" | "completed" | "on_hold" | "cancelled";
export type ClientType = "crm" | "other";

export interface Milestone {
  id: string;
  label: string;
  amount: number;
  dueDate: string;
}

export interface Deal {
  id: string;
  leadId?: string; // only for CRM clients
  clientType: ClientType;
  clientName: string;
  company?: string;
  phone?: string;
  name: string;
  quotedAmount: number;
  finalAmount: number;
  status: DealStatus;
  dueDate?: string;
  milestones: Milestone[];
  notes?: string;
  createdAt: string;
}

export type PaymentMethod = "UPI" | "Bank Transfer" | "Cash" | "Card" | "Cheque";
export type PaymentType = "advance" | "milestone" | "final" | "other";

export interface Payment {
  id: string;
  dealId: string;
  amount: number;
  date: string;
  method: PaymentMethod;
  type: PaymentType;
  reference?: string;
  notes?: string;
  voided?: boolean;
}

export interface Note {
  id: string;
  title: string;
  body: string;
  pinned: boolean;
  tag?: string;
  createdAt: string;
  updatedAt: string;
}

export const LEAD_STATUSES: LeadStatus[] = ["new", "contacted", "qualified", "proposal", "won", "lost"];

export const STATUS_LABEL: Record<LeadStatus, string> = {
  new: "New",
  contacted: "Contacted",
  qualified: "Qualified",
  proposal: "Proposal Sent",
  won: "Won",
  lost: "Lost",
};

export const LEAD_SOURCES: LeadSource[] = [
  "Website",
  "Referral",
  "Instagram",
  "Google Ads",
  "LinkedIn",
  "Walk-in",
  "WhatsApp",
  "Other",
];

export const FOLLOWUP_LABEL: Record<FollowUpType, string> = {
  call: "Call",
  whatsapp: "WhatsApp",
  meeting: "Meeting",
  email: "Email",
};

export const DEAL_STATUS_LABEL: Record<DealStatus, string> = {
  active: "Active",
  completed: "Completed",
  on_hold: "On hold",
  cancelled: "Cancelled",
};
