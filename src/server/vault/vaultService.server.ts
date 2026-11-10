import "@tanstack/react-start/server-only";
import { eq, sql } from "drizzle-orm";
import type { MySql2Database } from "drizzle-orm/mysql2";
import { strToU8 } from "fflate";
import {
  buildBackupZipArchive,
  buildFinancialSummary,
  buildManifest,
  canonicalJsonStringify,
  computeSha256,
  executeRestoreDryRun,
  validateBackupArchive,
  type BackupManifest,
  type DryRunReport,
  type ValidationReport,
} from "../backup/index.server";
import {
  crmDeals,
  crmLeads,
  crmOwnerSettings,
  crmPaymentProofs,
  crmPayments,
  crmProjectTasks,
  crmProjects,
  crmQuotations,
  crmSalesGoals,
  crmSavedViews,
} from "../db/schema.server";

export interface VaultBlocker {
  id: string;
  severity: "critical" | "warning" | "info";
  title: string;
  description: string;
  status: "unverified" | "not-configured" | "unsupported" | "enforced";
}

export interface VaultInventoryItem {
  number: number;
  name: string;
  tableName: string | null;
  hasSchema: boolean;
  includedInExporter: boolean;
  hasBinaryCoverage: boolean;
  hasRestoreMapping: boolean;
  verifiedByLiveRestore: boolean;
  status: "verified" | "supported" | "unsupported";
  count?: number;
  description: string;
}

export interface VaultLiveDatabaseCounts {
  leads: number;
  deals: number;
  payments: number;
  paymentProofs: number;
  projects: number;
  projectTasks: number;
  quotations: number;
  salesGoals: number;
  ownerSettings: number;
  savedViews?: number;
}

export interface VaultCoverageResult {
  totalEntitiesInventoried: number;
  verifiedEntitiesCount: number;
  supportedEntitiesCount: number;
  unsupportedEntitiesCount: number;
  liveDatabaseCounts: VaultLiveDatabaseCounts;
  blockers: VaultBlocker[];
  inventory: VaultInventoryItem[];
  restoreDisabled: boolean;
}

export const VAULT_ENTITIES_INVENTORY: VaultInventoryItem[] = [
  {
    number: 1,
    name: "Leads",
    tableName: "crm_leads",
    hasSchema: true,
    includedInExporter: true,
    hasBinaryCoverage: false,
    hasRestoreMapping: true,
    verifiedByLiveRestore: true,
    status: "verified",
    description: "Customer CRM records, source, contact status, and owner assignment.",
  },
  {
    number: 2,
    name: "Activities",
    tableName: "crm_lead_activities",
    hasSchema: true,
    includedInExporter: true,
    hasBinaryCoverage: false,
    hasRestoreMapping: true,
    verifiedByLiveRestore: false,
    status: "supported",
    description: "Lead timeline interactions, notes, stage transitions, and audit trail.",
  },
  {
    number: 3,
    name: "Follow-ups",
    tableName: "crm_follow_ups",
    hasSchema: true,
    includedInExporter: true,
    hasBinaryCoverage: false,
    hasRestoreMapping: true,
    verifiedByLiveRestore: false,
    status: "supported",
    description: "Scheduled follow-up reminders, scheduled dates, and completion status.",
  },
  {
    number: 4,
    name: "Call Logs",
    tableName: "crm_call_logs",
    hasSchema: true,
    includedInExporter: true,
    hasBinaryCoverage: false,
    hasRestoreMapping: true,
    verifiedByLiveRestore: false,
    status: "supported",
    description: "Telephony communication logs, duration, disposition, and recordings.",
  },
  {
    number: 5,
    name: "WhatsApp Logs",
    tableName: "crm_whats_app_logs",
    hasSchema: true,
    includedInExporter: true,
    hasBinaryCoverage: false,
    hasRestoreMapping: true,
    verifiedByLiveRestore: false,
    status: "supported",
    description: "Inbound and outbound WhatsApp communication logs and delivery states.",
  },
  {
    number: 6,
    name: "Deals",
    tableName: "crm_deals",
    hasSchema: true,
    includedInExporter: true,
    hasBinaryCoverage: false,
    hasRestoreMapping: true,
    verifiedByLiveRestore: true,
    status: "verified",
    description: "Sales opportunities, stages, quoted and won amounts in exact paise.",
  },
  {
    number: 7,
    name: "Deal Milestones",
    tableName: "crm_deal_milestones",
    hasSchema: true,
    includedInExporter: true,
    hasBinaryCoverage: false,
    hasRestoreMapping: true,
    verifiedByLiveRestore: false,
    status: "supported",
    description: "Milestone-based progress billing rules and stages.",
  },
  {
    number: 8,
    name: "Payments",
    tableName: "crm_payments",
    hasSchema: true,
    includedInExporter: true,
    hasBinaryCoverage: false,
    hasRestoreMapping: true,
    verifiedByLiveRestore: true,
    status: "verified",
    description:
      "Immutable cash transaction records, exact paise, payment method, and void status.",
  },
  {
    number: 9,
    name: "Finance Events",
    tableName: "crm_finance_events",
    hasSchema: true,
    includedInExporter: true,
    hasBinaryCoverage: false,
    hasRestoreMapping: true,
    verifiedByLiveRestore: false,
    status: "supported",
    description: "Immutable audit ledger of payments, voids, and financial state transitions.",
  },
  {
    number: 10,
    name: "Payment Proof Meta",
    tableName: "crm_payment_proofs",
    hasSchema: true,
    includedInExporter: true,
    hasBinaryCoverage: false,
    hasRestoreMapping: true,
    verifiedByLiveRestore: true,
    status: "verified",
    description: "Receipt metadata, SHA-256 hashes, mime types, and storage keys.",
  },
  {
    number: 11,
    name: "Payment Proof Binaries",
    tableName: "filesystem/proofs",
    hasSchema: false,
    includedInExporter: true,
    hasBinaryCoverage: true,
    hasRestoreMapping: true,
    verifiedByLiveRestore: true,
    status: "supported",
    description:
      "Actual PNG, JPEG, and PDF proof binary bytes (Hostinger storage durability unverified).",
  },
  {
    number: 12,
    name: "Quotation Templates",
    tableName: "crm_quotation_templates",
    hasSchema: true,
    includedInExporter: true,
    hasBinaryCoverage: false,
    hasRestoreMapping: true,
    verifiedByLiveRestore: false,
    status: "supported",
    description: "Reusable quotation templates, clauses, items, and tax presets.",
  },
  {
    number: 13,
    name: "Quotations & Items",
    tableName: "crm_quotations",
    hasSchema: true,
    includedInExporter: true,
    hasBinaryCoverage: false,
    hasRestoreMapping: true,
    verifiedByLiveRestore: true,
    status: "verified",
    description: "Issued quotations, revision numbers, client details, and line item tables.",
  },
  {
    number: 14,
    name: "Quotation Revisions",
    tableName: "crm_quotation_revisions",
    hasSchema: true,
    includedInExporter: true,
    hasBinaryCoverage: false,
    hasRestoreMapping: true,
    verifiedByLiveRestore: false,
    status: "supported",
    description: "Historical version snapshots and revision audit events.",
  },
  {
    number: 15,
    name: "Projects",
    tableName: "crm_projects",
    hasSchema: true,
    includedInExporter: true,
    hasBinaryCoverage: false,
    hasRestoreMapping: true,
    verifiedByLiveRestore: true,
    status: "verified",
    description: "Client delivery workspaces, project types, delivery stages, and links.",
  },
  {
    number: 16,
    name: "Project Tasks",
    tableName: "crm_project_tasks",
    hasSchema: true,
    includedInExporter: true,
    hasBinaryCoverage: false,
    hasRestoreMapping: true,
    verifiedByLiveRestore: true,
    status: "verified",
    description: "Operational checklist tasks, priorities, assignees, and completion.",
  },
  {
    number: 17,
    name: "Project Milestones",
    tableName: "crm_project_milestones",
    hasSchema: true,
    includedInExporter: true,
    hasBinaryCoverage: false,
    hasRestoreMapping: true,
    verifiedByLiveRestore: false,
    status: "supported",
    description: "Project milestone checkpoints, target dates, and statuses.",
  },
  {
    number: 18,
    name: "Deliverables",
    tableName: "crm_project_deliverables",
    hasSchema: true,
    includedInExporter: true,
    hasBinaryCoverage: false,
    hasRestoreMapping: true,
    verifiedByLiveRestore: false,
    status: "supported",
    description: "Client deliverables, review statuses, and asset links.",
  },
  {
    number: 19,
    name: "Support Tickets",
    tableName: "crm_client_support_tickets",
    hasSchema: true,
    includedInExporter: true,
    hasBinaryCoverage: false,
    hasRestoreMapping: true,
    verifiedByLiveRestore: false,
    status: "supported",
    description: "Client support tickets, priorities, triage notes, and resolution.",
  },
  {
    number: 20,
    name: "Owner Settings",
    tableName: "crm_owner_settings",
    hasSchema: true,
    includedInExporter: true,
    hasBinaryCoverage: false,
    hasRestoreMapping: true,
    verifiedByLiveRestore: true,
    status: "verified",
    description: "Authoritative business name, GSTIN, currency, and invoice presets.",
  },
  {
    number: 21,
    name: "Settings Audit Events",
    tableName: "crm_settings_audit_events",
    hasSchema: true,
    includedInExporter: true,
    hasBinaryCoverage: false,
    hasRestoreMapping: true,
    verifiedByLiveRestore: false,
    status: "supported",
    description: "Immutable audit trail of owner setting mutations and author IPs.",
  },
  {
    number: 22,
    name: "Sales Goals",
    tableName: "crm_sales_goals",
    hasSchema: true,
    includedInExporter: true,
    hasBinaryCoverage: false,
    hasRestoreMapping: true,
    verifiedByLiveRestore: true,
    status: "verified",
    description: "Authoritative revenue targets, cash collection goals, and target metrics.",
  },
  {
    number: 23,
    name: "Sales Goal Revisions",
    tableName: "crm_sales_goal_revisions",
    hasSchema: true,
    includedInExporter: true,
    hasBinaryCoverage: false,
    hasRestoreMapping: true,
    verifiedByLiveRestore: false,
    status: "supported",
    description: "Historical goal quota adjustments, revision reasons, and dates.",
  },
  {
    number: 24,
    name: "Custom Fields & Values",
    tableName: "crm_custom_fields",
    hasSchema: true,
    includedInExporter: true,
    hasBinaryCoverage: false,
    hasRestoreMapping: true,
    verifiedByLiveRestore: false,
    status: "supported",
    description: "Custom attribute schemas and stored field values defined for leads and deals.",
  },
  {
    number: 25,
    name: "Tags & Tag Links",
    tableName: "crm_tag_defs",
    hasSchema: true,
    includedInExporter: true,
    hasBinaryCoverage: false,
    hasRestoreMapping: true,
    verifiedByLiveRestore: false,
    status: "supported",
    description: "Classification tags and many-to-many lead tag relationships.",
  },
  {
    number: 26,
    name: "Saved Views",
    tableName: "crm_saved_views",
    hasSchema: true,
    includedInExporter: false,
    hasBinaryCoverage: false,
    hasRestoreMapping: false,
    verifiedByLiveRestore: false,
    status: "supported",
    description:
      "Saved lead view presets, multi-condition filter JSON, column configurations, and sorting.",
  },
  {
    number: 27,
    name: "Quotation Shares",
    tableName: null,
    hasSchema: false,
    includedInExporter: false,
    hasBinaryCoverage: false,
    hasRestoreMapping: false,
    verifiedByLiveRestore: false,
    status: "unsupported",
    description: "Temporary external quote share tokens (LocalStorage only, no MariaDB table).",
  },
  {
    number: 28,
    name: "Sales Studio Demos",
    tableName: null,
    hasSchema: false,
    includedInExporter: false,
    hasBinaryCoverage: false,
    hasRestoreMapping: false,
    verifiedByLiveRestore: false,
    status: "unsupported",
    description: "Sales collateral interactive demo presets (LocalStorage only, deferred to B8).",
  },
  {
    number: 29,
    name: "WhatsApp Templates",
    tableName: null,
    hasSchema: false,
    includedInExporter: false,
    hasBinaryCoverage: false,
    hasRestoreMapping: false,
    verifiedByLiveRestore: false,
    status: "unsupported",
    description: "Saved WhatsApp message drafts (LocalStorage only, deferred to B8).",
  },
  {
    number: 30,
    name: "Automation Rules",
    tableName: null,
    hasSchema: false,
    includedInExporter: false,
    hasBinaryCoverage: false,
    hasRestoreMapping: false,
    verifiedByLiveRestore: false,
    status: "unsupported",
    description: "Browser-side trigger automation rules (LocalStorage only, deferred to B8).",
  },
  {
    number: 31,
    name: "Smart Inbox & Lead Relations",
    tableName: null,
    hasSchema: false,
    includedInExporter: false,
    hasBinaryCoverage: false,
    hasRestoreMapping: false,
    verifiedByLiveRestore: false,
    status: "unsupported",
    description:
      "Duplicate deduplication pairs and smart inbox metadata (LocalStorage only, deferred to B8).",
  },
];

export const VAULT_BLOCKERS: VaultBlocker[] = [
  {
    id: "blocker-storage-durability",
    severity: "critical",
    title: "Hostinger Private Proof Storage Durability Unverified",
    description:
      "Binary payment proof files written to local disk (.data/private-proofs) are ephemeral across multi-node scaling, container rebuilds, and deployments on Hostinger. An S3/R2-compatible durable object storage driver must be configured before production rollout.",
    status: "unverified",
  },
  {
    id: "blocker-backup-encryption",
    severity: "warning",
    title: "Backup Archive Encryption Not Implemented",
    description:
      "Generated ZIP backup archives are currently unencrypted plaintext packages containing sensitive customer PII and exact financial records. AES-256-GCM authenticated encryption or KMS key integration must be implemented before real backups are downloaded.",
    status: "not-configured",
  },
  {
    id: "blocker-unsupported-entities",
    severity: "warning",
    title: "5 Browser Collections Lack Database Tables",
    description:
      "Quotation Shares, Sales Studio Demos, WhatsApp Templates, Automation Rules, and Smart Inbox / Lead Relations live exclusively in browser storage (localStorage). They will NOT be restored into MariaDB during data migration.",
    status: "unsupported",
  },
  {
    id: "blocker-restore-disabled",
    severity: "info",
    title: "Direct Restore Execution Disabled in UI",
    description:
      "To prevent catastrophic accidental overwrites of live production data, direct database restore execution via the web interface is permanently disabled. Restores must run via isolated CLI processes with pre-flight dry-runs and automated transaction rollbacks.",
    status: "enforced",
  },
];

export async function getVaultCoverage(
  db: MySql2Database<Record<string, unknown>>,
  ownerUserId: string,
): Promise<VaultCoverageResult> {
  const liveDatabaseCounts: VaultLiveDatabaseCounts = {
    leads: 0,
    deals: 0,
    payments: 0,
    paymentProofs: 0,
    projects: 0,
    projectTasks: 0,
    quotations: 0,
    salesGoals: 0,
    ownerSettings: 0,
  };

  try {
    const [leadsRow] = await db
      .select({ count: sql<number>`count(*)` })
      .from(crmLeads)
      .where(eq(crmLeads.createdByUserId, ownerUserId));
    liveDatabaseCounts.leads = Number(leadsRow?.count ?? 0);
  } catch {
    // Keep 0
  }

  try {
    const [dealsRow] = await db
      .select({ count: sql<number>`count(*)` })
      .from(crmDeals)
      .where(eq(crmDeals.createdByUserId, ownerUserId));
    liveDatabaseCounts.deals = Number(dealsRow?.count ?? 0);
  } catch {
    // Keep 0
  }

  try {
    const [paymentsRow] = await db
      .select({ count: sql<number>`count(*)` })
      .from(crmPayments)
      .where(eq(crmPayments.recordedByUserId, ownerUserId));
    liveDatabaseCounts.payments = Number(paymentsRow?.count ?? 0);
  } catch {
    // Keep 0
  }

  try {
    const [proofsRow] = await db
      .select({ count: sql<number>`count(*)` })
      .from(crmPaymentProofs)
      .where(eq(crmPaymentProofs.uploadedByUserId, ownerUserId));
    liveDatabaseCounts.paymentProofs = Number(proofsRow?.count ?? 0);
  } catch {
    // Keep 0
  }

  try {
    const [projectsRow] = await db
      .select({ count: sql<number>`count(*)` })
      .from(crmProjects)
      .where(eq(crmProjects.ownerUserId, ownerUserId));
    liveDatabaseCounts.projects = Number(projectsRow?.count ?? 0);
  } catch {
    // Keep 0
  }

  try {
    const [tasksRow] = await db
      .select({ count: sql<number>`count(*)` })
      .from(crmProjectTasks)
      .innerJoin(crmProjects, eq(crmProjectTasks.projectId, crmProjects.id))
      .where(eq(crmProjects.ownerUserId, ownerUserId));
    liveDatabaseCounts.projectTasks = Number(tasksRow?.count ?? 0);
  } catch {
    // Keep 0
  }

  try {
    const [quotationsRow] = await db
      .select({ count: sql<number>`count(*)` })
      .from(crmQuotations)
      .where(eq(crmQuotations.ownerUserId, ownerUserId));
    liveDatabaseCounts.quotations = Number(quotationsRow?.count ?? 0);
  } catch {
    // Keep 0
  }

  try {
    const [goalsRow] = await db
      .select({ count: sql<number>`count(*)` })
      .from(crmSalesGoals)
      .where(eq(crmSalesGoals.ownerUserId, ownerUserId));
    liveDatabaseCounts.salesGoals = Number(goalsRow?.count ?? 0);
  } catch {
    // Keep 0
  }

  try {
    const [settingsRow] = await db
      .select({ count: sql<number>`count(*)` })
      .from(crmOwnerSettings)
      .where(eq(crmOwnerSettings.ownerUserId, ownerUserId));
    liveDatabaseCounts.ownerSettings = Number(settingsRow?.count ?? 0);
  } catch {
    // Keep 0
  }

  try {
    const [savedViewsRow] = await db
      .select({ count: sql<number>`count(*)` })
      .from(crmSavedViews)
      .where(eq(crmSavedViews.ownerUserId, ownerUserId));
    liveDatabaseCounts.savedViews = Number(savedViewsRow?.count ?? 0);
  } catch {
    // Keep 0
  }

  const inventoryWithCounts = VAULT_ENTITIES_INVENTORY.map((item) => {
    let count: number | undefined;
    if (item.name === "Leads") count = liveDatabaseCounts.leads;
    else if (item.name === "Deals") count = liveDatabaseCounts.deals;
    else if (item.name === "Payments") count = liveDatabaseCounts.payments;
    else if (item.name === "Payment Proof Meta") count = liveDatabaseCounts.paymentProofs;
    else if (item.name === "Payment Proof Binaries") count = liveDatabaseCounts.paymentProofs;
    else if (item.name === "Projects") count = liveDatabaseCounts.projects;
    else if (item.name === "Project Tasks") count = liveDatabaseCounts.projectTasks;
    else if (item.name === "Quotations & Items") count = liveDatabaseCounts.quotations;
    else if (item.name === "Sales Goals") count = liveDatabaseCounts.salesGoals;
    else if (item.name === "Owner Settings") count = liveDatabaseCounts.ownerSettings;
    else if (item.name === "Saved Views") count = liveDatabaseCounts.savedViews;

    return {
      ...item,
      ...(count !== undefined ? { count } : {}),
    };
  });

  const totalEntitiesInventoried = VAULT_ENTITIES_INVENTORY.length;
  const verifiedEntitiesCount = VAULT_ENTITIES_INVENTORY.filter(
    (i) => i.status === "verified",
  ).length;
  const supportedEntitiesCount = VAULT_ENTITIES_INVENTORY.filter(
    (i) => i.status === "supported",
  ).length;
  const unsupportedEntitiesCount = VAULT_ENTITIES_INVENTORY.filter(
    (i) => i.status === "unsupported",
  ).length;

  return {
    totalEntitiesInventoried,
    verifiedEntitiesCount,
    supportedEntitiesCount,
    unsupportedEntitiesCount,
    liveDatabaseCounts,
    blockers: VAULT_BLOCKERS,
    inventory: inventoryWithCounts,
    restoreDisabled: true,
  };
}

export interface GenerateSyntheticBackupOptions {
  scope?: "full" | "sales" | "projects";
  ownerUserId?: string;
  ownerEmail?: string;
}

export function generateSyntheticBackupArchive(options: GenerateSyntheticBackupOptions = {}): {
  zipBytes: Uint8Array;
  manifest: BackupManifest;
  filename: string;
} {
  const scope = options.scope ?? "full";
  const ownerUserId = options.ownerUserId ?? "usr_synth_owner_1";
  const ownerEmail = options.ownerEmail ?? "owner@joinscaleflow.in";
  const now = new Date();
  const timestampStr = now.toISOString().replace(/[:.]/g, "-");

  // Realistic synthetic records
  const syntheticLeads = [
    {
      id: "lead_synth_1",
      name: "Aarav Sharma",
      organization: "Sharma Solar Power Ltd",
      phone: "+91 98765 43210",
      email: "aarav@sharmasolar.in",
      city: "Ahmedabad",
      state: "Gujarat",
      status: "won",
      source: "referral",
      createdAt: new Date(now.getTime() - 86400000 * 15).toISOString(),
    },
    {
      id: "lead_synth_2",
      name: "Priya Patel",
      organization: "Gujarat Industrial Renewables",
      phone: "+91 98220 11223",
      email: "priya@gir-energy.com",
      city: "Surat",
      state: "Gujarat",
      status: "negotiation",
      source: "website",
      createdAt: new Date(now.getTime() - 86400000 * 8).toISOString(),
    },
    {
      id: "lead_synth_3",
      name: "Vikram Malhotra",
      organization: "Malhotra Cold Storage",
      phone: "+91 99112 33445",
      email: "vikram@malhotracold.com",
      city: "Vadodara",
      state: "Gujarat",
      status: "contacted",
      source: "inbound",
      createdAt: new Date(now.getTime() - 86400000 * 2).toISOString(),
    },
  ];

  const syntheticDeals = [
    {
      id: "deal_synth_1",
      leadId: "lead_synth_1",
      name: "50kW Commercial Rooftop Solar Setup",
      clientType: "b2b",
      clientName: "Sharma Solar Power Ltd",
      value: 1500000,
      valuePaise: 150000000,
      quotedAmount: 1600000,
      quotedAmountPaise: 160000000,
      finalAmount: 1500000,
      finalAmountPaise: 150000000,
      status: "won",
      dealWonDate: new Date(now.getTime() - 86400000 * 7).toISOString(),
      createdAt: new Date(now.getTime() - 86400000 * 14).toISOString(),
    },
    {
      id: "deal_synth_2",
      leadId: "lead_synth_2",
      name: "25kW Factory Solar Array",
      clientType: "b2b",
      clientName: "Gujarat Industrial Renewables",
      value: 850000,
      valuePaise: 85000000,
      quotedAmount: 850000,
      quotedAmountPaise: 85000000,
      finalAmount: 850000,
      finalAmountPaise: 85000000,
      status: "negotiation",
      createdAt: new Date(now.getTime() - 86400000 * 5).toISOString(),
    },
  ];

  const syntheticPayments = [
    {
      id: "pay_synth_1",
      dealId: "deal_synth_1",
      amount: 500000,
      amountPaise: 50000000,
      method: "neft",
      reference: "HDFC-NEFT-9918231",
      date: new Date(now.getTime() - 86400000 * 6).toISOString(),
      status: "cleared",
      voided: false,
    },
    {
      id: "pay_synth_2",
      dealId: "deal_synth_1",
      amount: 500000,
      amountPaise: 50000000,
      method: "rtgs",
      reference: "ICICI-RTGS-8837192",
      date: new Date(now.getTime() - 86400000 * 2).toISOString(),
      status: "cleared",
      voided: false,
    },
  ];

  const syntheticProjects = [
    {
      id: "proj_synth_1",
      leadId: "lead_synth_1",
      dealId: "deal_synth_1",
      name: "Sharma Solar 50kW EPC",
      clientName: "Sharma Solar Power Ltd",
      type: "solar_epc",
      stage: "procurement",
      status: "active",
      createdAt: new Date(now.getTime() - 86400000 * 5).toISOString(),
    },
  ];

  const syntheticTasks = [
    {
      id: "ptsk_synth_1",
      projectId: "proj_synth_1",
      title: "Structure Fabrication & Dispatch",
      priority: "high",
      status: "in_progress",
      dueDate: new Date(now.getTime() + 86400000 * 3).toISOString().slice(0, 10),
    },
    {
      id: "ptsk_synth_2",
      projectId: "proj_synth_1",
      title: "Net Metering Application Submission",
      priority: "urgent",
      status: "completed",
      completedAt: new Date(now.getTime() - 86400000 * 1).toISOString(),
    },
  ];

  const syntheticQuotations = [
    {
      id: "quot_synth_1",
      dealId: "deal_synth_1",
      leadId: "lead_synth_1",
      quotationNumber: "QUOT-2026-001",
      title: "50kW Solar EPC Proposal",
      clientName: "Sharma Solar Power Ltd",
      currency: "INR",
      subtotal: 1500000,
      totalAmount: 1770000,
      status: "accepted",
      issueIstDate: new Date(now.getTime() - 86400000 * 12).toISOString().slice(0, 10),
      items: [
        {
          id: "qitem_1",
          description: "Mono PERC 550W Tier 1 Solar Panels",
          quantity: 92,
          unitPrice: 12000,
          totalAmount: 1104000,
        },
        {
          id: "qitem_2",
          description: "50kW Grid-Tied Inverter with Online Monitoring",
          quantity: 1,
          unitPrice: 250000,
          totalAmount: 250000,
        },
      ],
    },
  ];

  const syntheticGoals = [
    {
      id: "goal_synth_1",
      name: "Q4 Cash Collection Milestone",
      metric: "cash_collected",
      targetUnit: "inr_paise",
      targetAmount: 500000000, // ₹50,00,000.00
      period: "monthly",
      effectiveFromIst: "2026-11-01",
      status: "active",
      createdAt: new Date(now.getTime() - 86400000 * 10).toISOString(),
    },
  ];

  const syntheticSettings = {
    id: "set_synth_1",
    businessName: "Scale Flow Solar Solutions",
    businessTimezone: "Asia/Kolkata",
    currencyCode: "INR",
    defaultLeadSort: "recent",
    updatedAt: now.toISOString(),
  };

  // Synthetic binary attachments
  const pdfBytes = strToU8(
    "%PDF-1.4\n1 0 obj\n<< /Title (Synthetic Payment Receipt #1) >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF",
  );
  const pngBytes = new Uint8Array([
    137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0,
    0, 0, 31, 21, 196, 137, 0, 0, 0, 10, 73, 68, 65, 84, 120, 156, 99, 0, 1, 0, 0, 5, 0, 1, 13, 10,
    45, 180, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130,
  ]);

  const pdfPath = "files/payment-proofs/pay_synth_1__neft_receipt.pdf";
  const pngPath = "files/payment-proofs/pay_synth_2__rtgs_advice.png";

  const attachmentsMeta = [
    {
      attachmentId: "prf_synth_1",
      paymentId: "pay_synth_1",
      originalFileName: "neft_receipt.pdf",
      mimeType: "application/pdf",
      fileSize: pdfBytes.byteLength,
      sha256: computeSha256(pdfBytes),
      path: pdfPath,
      uploadedAt: new Date(now.getTime() - 86400000 * 6).toISOString(),
      status: "verified" as const,
    },
    {
      attachmentId: "prf_synth_2",
      paymentId: "pay_synth_2",
      originalFileName: "rtgs_advice.png",
      mimeType: "image/png",
      fileSize: pngBytes.byteLength,
      sha256: computeSha256(pngBytes),
      path: pngPath,
      uploadedAt: new Date(now.getTime() - 86400000 * 2).toISOString(),
      status: "verified" as const,
    },
  ];

  // Assemble data files based on scope
  const dataFiles: Record<string, unknown> = {};
  const attachmentBytesMap: Record<string, Uint8Array> = {};
  const includedEntities: string[] = [];
  const counts: Record<string, number> = {};

  if (scope === "full" || scope === "sales") {
    dataFiles["data/leads.json"] = { leads: syntheticLeads };
    dataFiles["data/deals.json"] = { deals: syntheticDeals };
    dataFiles["data/payments.json"] = { payments: syntheticPayments };
    dataFiles["data/attachment-metadata.json"] = { attachments: attachmentsMeta };
    attachmentBytesMap[pdfPath] = pdfBytes;
    attachmentBytesMap[pngPath] = pngBytes;

    includedEntities.push("leads", "deals", "payments", "proofs");
    counts["leads"] = syntheticLeads.length;
    counts["deals"] = syntheticDeals.length;
    counts["payments"] = syntheticPayments.length;
    counts["proofs"] = attachmentsMeta.length;
  }

  if (scope === "full" || scope === "projects") {
    dataFiles["data/projects.json"] = {
      projects: syntheticProjects,
      projectTasks: syntheticTasks,
    };
    dataFiles["data/quotations.json"] = { quotations: syntheticQuotations };

    includedEntities.push("projects", "projectTasks", "quotations");
    counts["projects"] = syntheticProjects.length;
    counts["projectTasks"] = syntheticTasks.length;
    counts["quotations"] = syntheticQuotations.length;
  }

  if (scope === "full") {
    dataFiles["data/sales-goals.json"] = { salesGoals: syntheticGoals };
    dataFiles["data/settings.json"] = { settings: syntheticSettings };

    includedEntities.push("salesGoals", "settings");
    counts["salesGoals"] = syntheticGoals.length;
    counts["settings"] = 1;
  }

  const manifestFiles = [
    ...Object.entries(dataFiles).map(([p, data]) => {
      const b = strToU8(canonicalJsonStringify(data));
      return { path: p, sha256: computeSha256(b), bytes: b.byteLength };
    }),
    ...Object.entries(attachmentBytesMap).map(([p, b]) => ({
      path: p,
      sha256: computeSha256(b),
      bytes: b.byteLength,
    })),
  ];

  const financialSummary = buildFinancialSummary({
    deals: scope === "full" || scope === "sales" ? syntheticDeals : [],
    payments: scope === "full" || scope === "sales" ? syntheticPayments : [],
  });

  const allInventoriedNames = VAULT_ENTITIES_INVENTORY.map((i) => i.name);
  const omittedEntities = allInventoriedNames.filter(
    (name) =>
      !includedEntities.some(
        (inc) =>
          inc.toLowerCase() === name.toLowerCase() ||
          name.toLowerCase().includes(inc.toLowerCase()),
      ),
  );

  const manifest = buildManifest({
    type: scope === "full" ? "full" : "custom",
    synthetic: true,
    ownerUserId,
    ownerEmail,
    includedEntities,
    omittedEntities,
    counts,
    financialSummary,
    attachmentsMeta: scope === "full" || scope === "sales" ? attachmentsMeta : [],
    files: manifestFiles,
    warnings: [
      "SYNTHETIC TEST BACKUP: Generated for isolated development and QA verification.",
      "CONTAINS REALISTIC SYNTHETIC TEST RECORDS ONLY: Not an authoritative production snapshot.",
      "PARTIAL CRM RECOVERY COVERAGE: Only verified MariaDB fixture records are included; 21 entity collections omitted.",
    ],
  });

  const summaryHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Scale Flow Sales OS — Synthetic Test Backup</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; padding: 2rem; color: #1e293b; }
    h1 { color: #0f172a; border-bottom: 2px solid #e2e8f0; padding-bottom: 0.5rem; }
    .badge { display: inline-block; padding: 0.25rem 0.5rem; border-radius: 4px; font-size: 0.75rem; font-weight: 600; background: #e0f2fe; color: #0369a1; }
    table { width: 100%; border-collapse: collapse; margin-top: 1rem; }
    th, td { text-align: left; padding: 0.5rem; border-bottom: 1px solid #e2e8f0; }
  </style>
</head>
<body>
  <h1>Scale Flow Sales OS — Synthetic Test Archive</h1>
  <p><span class="badge">DEVELOPMENT PILOT ONLY</span> Created: ${now.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} (IST)</p>
  <p>Manifest SHA-256: <code>${manifest.checksumSha256 ?? "calculated"}</code></p>
  <table>
    <tr><th>Entity</th><th>Records</th></tr>
    ${Object.entries(counts)
      .map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`)
      .join("")}
  </table>
</body>
</html>`;

  const zipBytes = buildBackupZipArchive({
    manifest,
    dataFiles,
    attachments: attachmentBytesMap,
    summaryHtml,
  });

  const filename = `ScaleFlow_Synthetic_Test_Backup_${scope}_${timestampStr}.zip`;

  return {
    zipBytes,
    manifest,
    filename,
  };
}

export async function inspectUploadedArchive(archiveBytes: Uint8Array): Promise<ValidationReport> {
  return validateBackupArchive(archiveBytes);
}

export async function runUploadedArchiveDryRun(
  db: MySql2Database<Record<string, unknown>>,
  ownerUserId: string,
  archiveBytes: Uint8Array,
): Promise<DryRunReport> {
  const [leads, deals, payments, projects, goals] = await Promise.all([
    db
      .select({ id: crmLeads.id })
      .from(crmLeads)
      .where(eq(crmLeads.createdByUserId, ownerUserId))
      .catch(() => []),
    db
      .select({ id: crmDeals.id })
      .from(crmDeals)
      .where(eq(crmDeals.createdByUserId, ownerUserId))
      .catch(() => []),
    db
      .select({ id: crmPayments.id })
      .from(crmPayments)
      .where(eq(crmPayments.recordedByUserId, ownerUserId))
      .catch(() => []),
    db
      .select({ id: crmProjects.id })
      .from(crmProjects)
      .where(eq(crmProjects.ownerUserId, ownerUserId))
      .catch(() => []),
    db
      .select({ id: crmSalesGoals.id })
      .from(crmSalesGoals)
      .where(eq(crmSalesGoals.ownerUserId, ownerUserId))
      .catch(() => []),
  ]);

  const targetContext = {
    existingLeadIds: new Set(leads.map((r) => r.id)),
    existingDealIds: new Set(deals.map((r) => r.id)),
    existingPaymentIds: new Set(payments.map((r) => r.id)),
    existingProjectIds: new Set(projects.map((r) => r.id)),
    existingGoalIds: new Set(goals.map((r) => r.id)),
  };

  return executeRestoreDryRun(archiveBytes, targetContext);
}

export async function parseArchiveUpload(
  request: Request,
): Promise<{ ok: true; bytes: Uint8Array } | { ok: false; response: Response }> {
  const contentType = (request.headers.get("content-type") ?? "").toLowerCase();

  // 1. Multipart Form Data
  if (contentType.startsWith("multipart/form-data")) {
    try {
      const formData = await request.formData();
      const fileEntry = formData.get("file") ?? formData.get("archive");
      if (!fileEntry || typeof fileEntry === "string") {
        return {
          ok: false,
          response: new Response(
            JSON.stringify({
              ok: false,
              error: {
                code: "validation_error",
                message: "A ZIP archive file must be uploaded under field 'file' or 'archive'.",
              },
            }),
            { status: 400, headers: { "Content-Type": "application/json" } },
          ),
        };
      }

      const file = fileEntry as unknown as {
        arrayBuffer: () => Promise<ArrayBuffer>;
      };
      const arrayBuffer = await file.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
      if (bytes.byteLength === 0) {
        return {
          ok: false,
          response: new Response(
            JSON.stringify({
              ok: false,
              error: { code: "empty_file", message: "Uploaded archive is 0 bytes." },
            }),
            { status: 400, headers: { "Content-Type": "application/json" } },
          ),
        };
      }
      return { ok: true, bytes };
    } catch (err) {
      return {
        ok: false,
        response: new Response(
          JSON.stringify({
            ok: false,
            error: {
              code: "multipart_error",
              message: `Failed to parse multipart form data: ${String(err)}`,
            },
          }),
          { status: 400, headers: { "Content-Type": "application/json" } },
        ),
      };
    }
  }

  // 2. JSON with base64
  if (contentType.startsWith("application/json")) {
    try {
      const body = (await request.json()) as { fileBase64?: string; archiveBase64?: string };
      const b64 = body?.fileBase64 || body?.archiveBase64;
      if (!b64 || typeof b64 !== "string") {
        return {
          ok: false,
          response: new Response(
            JSON.stringify({
              ok: false,
              error: {
                code: "validation_error",
                message: "Missing 'fileBase64' or 'archiveBase64' field in JSON request.",
              },
            }),
            { status: 400, headers: { "Content-Type": "application/json" } },
          ),
        };
      }
      const buffer = Buffer.from(b64, "base64");
      return { ok: true, bytes: new Uint8Array(buffer) };
    } catch (err) {
      return {
        ok: false,
        response: new Response(
          JSON.stringify({
            ok: false,
            error: { code: "json_parse_error", message: `Invalid JSON payload: ${String(err)}` },
          }),
          { status: 400, headers: { "Content-Type": "application/json" } },
        ),
      };
    }
  }

  // 3. Raw Binary Bytes (application/zip, application/octet-stream, etc.)
  try {
    const arrayBuffer = await request.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    if (bytes.byteLength === 0) {
      return {
        ok: false,
        response: new Response(
          JSON.stringify({
            ok: false,
            error: { code: "empty_file", message: "Uploaded archive is 0 bytes." },
          }),
          { status: 400, headers: { "Content-Type": "application/json" } },
        ),
      };
    }
    return { ok: true, bytes };
  } catch (err) {
    return {
      ok: false,
      response: new Response(
        JSON.stringify({
          ok: false,
          error: { code: "read_error", message: `Failed to read request body: ${String(err)}` },
        }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      ),
    };
  }
}
