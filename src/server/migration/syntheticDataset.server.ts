import "@tanstack/react-start/server-only";
import { strToU8, zipSync } from "fflate";
import { computeSha256 } from "../backup/manifest.server";

/** Valid minimal 1x1 PNG binary (passes magic-byte sniffing). */
export function buildSyntheticPngBytes(): Uint8Array {
  return new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
    0xde, 0x00, 0x00, 0x00, 0x0c, 0x49, 0x44, 0x41, 0x54, 0x08, 0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0x00,
    0x00, 0x03, 0x01, 0x01, 0x00, 0x18, 0xdd, 0x8d, 0xb0, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e,
    0x44, 0xae, 0x42, 0x60, 0x82,
  ]);
}

/** Valid minimal PDF binary (passes magic-byte sniffing). */
export function buildSyntheticPdfBytes(): Uint8Array {
  return strToU8(
    "%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj << /Type /Pages /Kids [] /Count 0 >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n",
  );
}

export interface SyntheticMigrationDatasetOptions {
  injectInvalidPaise?: boolean;
  injectOrphanPayment?: boolean;
  injectTamperedProofHash?: boolean;
  injectCredentialFields?: boolean;
}

/**
 * Generates a rich, 100% synthetic CRM V1 / Data Vault ZIP archive covering all 16+ mapped
 * CRM entities, deferred browser collections, valid payment proof binaries, and exact paise edge cases.
 * NEVER reads real customer data or browser storage.
 */
export function buildSyntheticMigrationZip(options: SyntheticMigrationDatasetOptions = {}): {
  zipBytes: Uint8Array;
  filename: string;
} {
  const pngBytes = buildSyntheticPngBytes();
  const pdfBytes = buildSyntheticPdfBytes();
  const pngSha = computeSha256(pngBytes);
  const pdfSha = computeSha256(pdfBytes);

  const leads = [
    {
      id: "syn_lead_01",
      name: "Synthetic Studio Alpha",
      company: "Alpha Retail Pvt Ltd",
      phone: "+91 98201 11101",
      email: "alpha@example.test",
      status: "won",
      source: "website",
      priority: "high",
      notes: "Synthetic high-value client for B13 shadow test.",
      pinned: true,
      score: 92,
      createdAt: "2026-08-10T06:30:00.000Z",
      updatedAt: "2026-09-12T10:15:00.000Z",
      ...(options.injectCredentialFields ? { apiKey: "sk_synthetic_should_be_scrubbed" } : {}),
    },
    {
      id: "syn_lead_02",
      name: "Synthetic Commerce Beta",
      company: "Beta Foods India",
      phone: "+91 98201 22202",
      email: "beta@example.test",
      status: "proposal",
      source: "whatsapp",
      priority: "med",
      notes: "Synthetic proposal stage lead.",
      score: 74,
      createdAt: "2026-09-01T08:00:00.000Z",
      updatedAt: "2026-09-15T11:30:00.000Z",
    },
    {
      id: "syn_lead_03",
      name: "Synthetic Agency Gamma",
      company: "Gamma Digital",
      phone: "+91 98201 33303",
      email: "gamma@example.test",
      status: "lost",
      source: "referral",
      priority: "low",
      lostReason: "Budget deferred to next quarter",
      score: 40,
      createdAt: "2026-07-20T05:00:00.000Z",
      updatedAt: "2026-08-05T09:00:00.000Z",
    },
  ];

  const bin = [
    {
      id: "syn_lead_bin_01",
      deletedAt: "2026-09-10T12:00:00.000Z",
      reason: "Duplicate test entry",
      lead: {
        id: "syn_lead_bin_01",
        name: "Synthetic Archived Lead",
        phone: "+91 98201 99999",
        status: "new",
        source: "other",
        createdAt: "2026-09-05T10:00:00.000Z",
      },
    },
  ];

  const activities = [
    {
      id: "syn_act_01",
      leadId: "syn_lead_01",
      type: "call",
      text: "Discovery call completed — scoped website + CRM.",
      outcome: "connected",
      at: "2026-08-11T09:30:00.000Z",
    },
    {
      id: "syn_act_02",
      leadId: "syn_lead_02",
      type: "whatsapp",
      text: "Shared quotation package PDF via WhatsApp.",
      at: "2026-09-04T14:00:00.000Z",
    },
  ];

  // Intentionally include TWO pending follow-ups for syn_lead_02 to test deterministic activeLeadLock resolution
  const followUps = [
    {
      id: "syn_fu_01",
      leadId: "syn_lead_01",
      type: "call",
      dueAt: "2026-08-15T06:00:00.000Z",
      done: true,
      completedAt: "2026-08-15T06:10:00.000Z",
      note: "Contract signed.",
    },
    {
      id: "syn_fu_02",
      leadId: "syn_lead_02",
      type: "whatsapp",
      dueAt: "2026-10-01T06:30:00.000Z",
      note: "Primary pending follow-up (earliest due).",
    },
    {
      id: "syn_fu_03",
      leadId: "syn_lead_02",
      type: "call",
      dueAt: "2026-10-05T06:30:00.000Z",
      note: "Secondary duplicate pending follow-up (normalized by B13).",
    },
  ];

  const callLogs = [
    {
      id: "syn_call_01",
      leadId: "syn_lead_01",
      outcome: "connected",
      notes: "Confirmed launch timeline.",
      at: "2026-08-11T09:30:00.000Z",
    },
  ];

  const whatsAppLogs = [
    {
      id: "syn_wa_01",
      leadId: "syn_lead_02",
      messageBody: "Hi Beta team, sharing the revised proposal.",
      sentAt: "2026-09-04T14:00:00.000Z",
    },
  ];

  const deals = [
    {
      id: "syn_deal_01",
      leadId: "syn_lead_01",
      name: "Alpha E-Commerce Revamp",
      clientName: "Synthetic Studio Alpha",
      company: "Alpha Retail Pvt Ltd",
      value: "123456.78", // 12,345,678 paise (tricky decimal!)
      status: "won",
      wonAt: "2026-08-20T10:00:00.000Z",
      createdAt: "2026-08-12T07:00:00.000Z",
      milestones: [
        { id: "syn_dms_01", title: "Advance 50%", amount: "61728.39", dueDate: "2026-08-21" },
        { id: "syn_dms_02", title: "Go-Live 50%", amount: "61728.39", dueDate: "2026-09-30" },
      ],
    },
    {
      id: "syn_deal_02",
      leadId: "syn_lead_02",
      name: "Beta D2C Landing Page",
      clientName: "Synthetic Commerce Beta",
      company: "Beta Foods India",
      value: "19999.99", // 1,999,999 paise
      status: "active",
      expectedCloseDate: "2026-10-15",
      createdAt: "2026-09-03T08:00:00.000Z",
    },
    {
      id: "syn_deal_03",
      leadId: "syn_lead_03",
      name: "Gamma Retainer",
      clientName: "Synthetic Agency Gamma",
      value: "45000.00",
      status: "lost",
      lostReason: "Budget deferred",
      createdAt: "2026-07-22T08:00:00.000Z",
    },
  ];

  const payments: Array<Record<string, unknown>> = [
    {
      id: "syn_pay_01",
      dealId: "syn_deal_01",
      amount: options.injectInvalidPaise ? "61728.395" : "61728.39",
      method: "upi",
      reference: "UTR-SYN-0001",
      date: "2026-08-21",
      createdAt: "2026-08-21T08:00:00.000Z",
    },
    {
      id: "syn_pay_02",
      dealId: "syn_deal_01",
      amount: "10000.00",
      method: "bank_transfer",
      reference: "UTR-SYN-0002-VOID",
      date: "2026-08-22",
      voided: true,
      voidReason: "Duplicate entry reversed by owner",
      voidedAt: "2026-08-22T12:00:00.000Z",
      createdAt: "2026-08-22T11:00:00.000Z",
    },
    {
      id: "syn_pay_03",
      dealId: "syn_deal_02",
      amount: "0.01", // 1 paise edge case!
      method: "upi",
      reference: "UTR-SYN-0003-PENNY",
      date: "2026-09-05",
      createdAt: "2026-09-05T09:00:00.000Z",
    },
  ];

  if (options.injectOrphanPayment) {
    payments.push({
      id: "syn_pay_orphan",
      dealId: "nonexistent_deal_999",
      amount: "5000.00",
      method: "upi",
      date: "2026-09-06",
      createdAt: "2026-09-06T09:00:00.000Z",
    });
  }

  const attachments = [
    {
      attachmentId: "syn_att_01",
      paymentId: "syn_pay_01",
      dealId: "syn_deal_01",
      originalFileName: "receipt-alpha.png",
      fileExtension: "png",
      mimeType: "image/png",
      fileSize: pngBytes.byteLength,
      sha256: options.injectTamperedProofHash ? "0".repeat(64) : pngSha,
      path: "files/payment-proofs/syn_att_01__receipt-alpha.png",
      uploadedAt: "2026-08-21T08:05:00.000Z",
    },
    {
      attachmentId: "syn_att_02",
      paymentId: "syn_pay_03",
      dealId: "syn_deal_02",
      originalFileName: "penny-test-receipt.pdf",
      fileExtension: "pdf",
      mimeType: "application/pdf",
      fileSize: pdfBytes.byteLength,
      sha256: pdfSha,
      path: "files/payment-proofs/syn_att_02__penny-test-receipt.pdf",
      uploadedAt: "2026-09-05T09:05:00.000Z",
    },
  ];

  const quotationTemplates = [
    { id: "syn_qtpl_01", name: "Standard Website Package", active: true },
  ];

  const quotations = [
    {
      id: "syn_quot_01",
      number: "SF-2026-001",
      leadId: "syn_lead_01",
      dealId: "syn_deal_01",
      title: "Alpha E-Commerce Revamp Quote",
      clientName: "Synthetic Studio Alpha",
      total: "123456.78",
      status: "accepted",
      issueDate: "2026-08-14",
      createdAt: "2026-08-14T08:00:00.000Z",
    },
  ];

  const projects = [
    {
      id: "syn_proj_01",
      leadId: "syn_lead_01",
      dealId: "syn_deal_01",
      name: "Alpha E-Commerce Build",
      clientName: "Synthetic Studio Alpha",
      status: "in_progress",
      stage: "dev",
      startDate: "2026-08-22",
      targetDate: "2026-09-30",
      createdAt: "2026-08-22T06:00:00.000Z",
    },
  ];

  const projectMilestones = [
    {
      id: "syn_pms_01",
      projectId: "syn_proj_01",
      title: "UI Prototype Approval",
      status: "completed",
    },
  ];

  const projectTasks = [
    {
      id: "syn_ptask_01",
      projectId: "syn_proj_01",
      milestoneId: "syn_pms_01",
      title: "Implement Checkout Flow",
      priority: "high",
      status: "open",
      dueDate: "2026-09-25",
      createdAt: "2026-08-25T08:00:00.000Z",
    },
  ];

  const supportRequests = [
    {
      id: "syn_sup_01",
      projectId: "syn_proj_01",
      title: "DNS SSL Verification Check",
      status: "open",
    },
  ];

  const customFields = [{ id: "cf_industry", name: "Industry", type: "text" }];

  const fieldValues = {
    syn_lead_01: { cf_industry: "Retail D2C" },
  };

  const tagDefs = [{ id: "tag_vip", name: "VIP", color: "amber" }];

  const leadTags = {
    syn_lead_01: ["tag_vip"],
  };

  const savedViews = [{ id: "view_hot", name: "Hot Leads", visibility: "owner" }];

  const inboxMeta = {
    syn_lead_02: { reviewed: false, duplicate: false },
  };

  const leadRelations = [
    { id: "rel_01", leadAId: "syn_lead_01", leadBId: "syn_lead_02", kind: "related" },
  ];

  // Intentionally set status: "active" to verify B13 forces it to "paused"
  const automationRules = [
    {
      id: "auto_01",
      name: "Follow-up Reminder Rule",
      trigger: "followup_overdue",
      status: "active",
    },
  ];

  const settings = {
    ownerDisplayName: "Synthetic Owner",
    businessName: "Scale Flow Studio (Synthetic)",
    profileEmail: "owner@example.test",
    businessTimezone: "Asia/Kolkata",
    currencyCode: "INR",
    defaultLeadSort: "recent",
    ...(options.injectCredentialFields
      ? { passwordHash: "$argon2id$synthetic_secret", sessionToken: "tok_synthetic_123" }
      : {}),
  };

  const goals = [
    {
      id: "syn_goal_01",
      name: "Q3 Cash Collected",
      metric: "cash_collected",
      period: "quarterly",
      targetPaise: 50000000, // ₹5,00,000.00
      status: "active",
      createdAt: "2026-07-01T00:00:00.000Z",
    },
    {
      id: "syn_goal_02",
      name: "Monthly Won Deals",
      metric: "deals_won",
      period: "monthly",
      target: 10,
      status: "active",
      createdAt: "2026-09-01T00:00:00.000Z",
    },
  ];

  // Deferred browser-local collections to confirm non-silent reporting
  const notes = [{ id: "syn_note_01", title: "Owner scratchpad note" }];
  const demos = [{ id: "syn_demo_01", title: "Retail Demo Link" }];

  const files: Record<string, Uint8Array> = {
    "data/leads.json": strToU8(JSON.stringify({ leads, bin }, null, 2)),
    "data/lead-activities.json": strToU8(
      JSON.stringify({ activities, callLogs, whatsAppLogs }, null, 2),
    ),
    "data/followups.json": strToU8(JSON.stringify({ followUps }, null, 2)),
    "data/deals.json": strToU8(JSON.stringify({ deals }, null, 2)),
    "data/payments.json": strToU8(JSON.stringify({ payments }, null, 2)),
    "data/attachment-metadata.json": strToU8(JSON.stringify({ attachments }, null, 2)),
    "data/quotation-templates.json": strToU8(
      JSON.stringify({ quotationTemplates, quotations }, null, 2),
    ),
    "data/projects.json": strToU8(
      JSON.stringify({ projects, projectMilestones, projectTasks, supportRequests }, null, 2),
    ),
    "data/crm-customization.json": strToU8(
      JSON.stringify({ customFields, fieldValues, tagDefs, leadTags, savedViews }, null, 2),
    ),
    "data/lead-inbox.json": strToU8(JSON.stringify({ inboxMeta, leadRelations }, null, 2)),
    "data/automation.json": strToU8(JSON.stringify({ automationRules }, null, 2)),
    "data/settings.json": strToU8(JSON.stringify(settings, null, 2)),
    "data/sales-goals.json": strToU8(JSON.stringify({ goals }, null, 2)),
    "data/personal-notes.json": strToU8(JSON.stringify({ notes }, null, 2)),
    "data/demo-library.json": strToU8(JSON.stringify({ demos }, null, 2)),
    "files/payment-proofs/syn_att_01__receipt-alpha.png": pngBytes,
    "files/payment-proofs/syn_att_02__penny-test-receipt.pdf": pdfBytes,
  };

  const zipBytes = zipSync(files, { level: 6 });
  return {
    zipBytes,
    filename: "ScaleFlow_B13_Synthetic_Shadow_Dataset.zip",
  };
}
