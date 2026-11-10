import "@tanstack/react-start/server-only";
import { strFromU8 } from "fflate";
import { validateBackupArchive } from "./validation.server";
import { type BackupManifest, type DryRunActionSummary, type DryRunReport } from "./types.server";

export interface DryRunTargetContext {
  existingLeadIds?: Set<string>;
  existingDealIds?: Set<string>;
  existingPaymentIds?: Set<string>;
  existingProjectIds?: Set<string>;
  existingGoalIds?: Set<string>;
}

/**
 * Executes a completely non-destructive dry-run restore analysis.
 * Performs ZERO database writes and returns a complete preview of what would occur.
 */
export async function executeRestoreDryRun(
  archiveBytesOrFiles: Uint8Array | Record<string, Uint8Array>,
  targetContext: DryRunTargetContext = {},
): Promise<DryRunReport> {
  // 1. Run archive validation first
  const validation = await validateBackupArchive(archiveBytesOrFiles);

  const manifest =
    validation.manifest ??
    ({
      app: "Scale Flow Sales OS",
      formatVersion: 1,
      schemaVersion: 1,
      type: "full",
      createdAt: new Date().toISOString(),
    } as BackupManifest);

  const actions: Record<string, DryRunActionSummary> = {};
  const unresolvedForeignKeys: DryRunReport["unresolvedForeignKeys"] = [];

  let files: Record<string, Uint8Array>;
  if (archiveBytesOrFiles instanceof Uint8Array) {
    // If validation passed or partially decompressed, extract files
    const { unzipSync } = await import("fflate");
    try {
      files = unzipSync(archiveBytesOrFiles);
    } catch {
      files = {};
    }
  } else {
    files = archiveBytesOrFiles;
  }

  const readJson = (path: string): Record<string, unknown> | null => {
    const raw = files[path];
    if (!raw) return null;
    try {
      return JSON.parse(strFromU8(raw)) as Record<string, unknown>;
    } catch {
      return null;
    }
  };

  const leadsData = readJson("data/leads.json");
  const dealsData = readJson("data/deals.json");
  const paymentsData = readJson("data/payments.json");
  const projectsData = readJson("data/projects.json");
  const goalsData = readJson("data/sales-goals.json");
  const attMetaData = readJson("data/attachment-metadata.json");

  const leads = (Array.isArray(leadsData?.["leads"]) ? leadsData!["leads"] : []) as Array<{
    id: string;
    name?: string;
  }>;
  const deals = (Array.isArray(dealsData?.["deals"]) ? dealsData!["deals"] : []) as Array<{
    id: string;
    leadId?: string;
    name?: string;
    valuePaise?: number;
    value?: number;
    status?: string;
  }>;
  const payments = (
    Array.isArray(paymentsData?.["payments"]) ? paymentsData!["payments"] : []
  ) as Array<{
    id: string;
    dealId?: string;
    amountPaise?: number;
    amount?: number;
    voided?: boolean;
    status?: string;
  }>;
  const projects = (
    Array.isArray(projectsData?.["projects"]) ? projectsData!["projects"] : []
  ) as Array<{
    id: string;
    leadId?: string;
    dealId?: string;
    name?: string;
  }>;
  const projectTasks = (
    Array.isArray(projectsData?.["projectTasks"]) ? projectsData!["projectTasks"] : []
  ) as Array<{
    id: string;
    projectId?: string;
    title?: string;
  }>;
  const goals = (Array.isArray(goalsData?.["goals"]) ? goalsData!["goals"] : []) as Array<{
    id: string;
    name?: string;
  }>;

  // Track target sets
  const existingLeadIds = targetContext.existingLeadIds ?? new Set<string>();
  const existingDealIds = targetContext.existingDealIds ?? new Set<string>();
  const existingPaymentIds = targetContext.existingPaymentIds ?? new Set<string>();
  const existingProjectIds = targetContext.existingProjectIds ?? new Set<string>();
  const existingGoalIds = targetContext.existingGoalIds ?? new Set<string>();

  // Check Leads
  const leadAction: DryRunActionSummary = {
    entity: "leads",
    toCreate: 0,
    toUpdate: 0,
    toSkip: 0,
    conflicts: [],
  };
  for (const lead of leads) {
    if (existingLeadIds.has(lead.id)) {
      leadAction.toSkip++;
      leadAction.conflicts.push({
        id: lead.id,
        reason: "Lead ID already exists in target destination.",
        resolution: "skip",
      });
    } else {
      leadAction.toCreate++;
    }
  }
  actions["leads"] = leadAction;

  // Check Deals & FKs
  const archiveLeadIds = new Set(leads.map((l) => l.id));
  const dealAction: DryRunActionSummary = {
    entity: "deals",
    toCreate: 0,
    toUpdate: 0,
    toSkip: 0,
    conflicts: [],
  };
  for (const deal of deals) {
    if (deal.leadId && !archiveLeadIds.has(deal.leadId) && !existingLeadIds.has(deal.leadId)) {
      unresolvedForeignKeys.push({
        entity: "deals",
        recordId: deal.id,
        foreignField: "leadId",
        missingTargetId: deal.leadId,
      });
    }
    if (existingDealIds.has(deal.id)) {
      dealAction.toSkip++;
      dealAction.conflicts.push({
        id: deal.id,
        reason: "Deal ID already exists in target database.",
        resolution: "skip",
      });
    } else {
      dealAction.toCreate++;
    }
  }
  actions["deals"] = dealAction;

  // Check Payments & FKs
  const archiveDealIds = new Set(deals.map((d) => d.id));
  const paymentAction: DryRunActionSummary = {
    entity: "payments",
    toCreate: 0,
    toUpdate: 0,
    toSkip: 0,
    conflicts: [],
  };
  let derivedActivePaise = 0;
  let derivedVoidedPaise = 0;

  for (const pay of payments) {
    const isVoided = Boolean(pay.voided || pay.status === "voided");
    const paise =
      typeof pay.amountPaise === "number"
        ? Math.round(pay.amountPaise)
        : Math.round(Number(pay.amount ?? 0) * 100);

    if (isVoided) derivedVoidedPaise += paise;
    else derivedActivePaise += paise;

    if (!pay.dealId || (!archiveDealIds.has(pay.dealId) && !existingDealIds.has(pay.dealId))) {
      unresolvedForeignKeys.push({
        entity: "payments",
        recordId: pay.id,
        foreignField: "dealId",
        missingTargetId: pay.dealId ?? "(none)",
      });
    }

    if (existingPaymentIds.has(pay.id)) {
      paymentAction.toSkip++;
      paymentAction.conflicts.push({
        id: pay.id,
        reason: "Payment ID already exists in target destination.",
        resolution: "skip",
      });
    } else {
      paymentAction.toCreate++;
    }
  }
  actions["payments"] = paymentAction;

  // Check Projects & Tasks
  const archiveProjectIds = new Set(projects.map((p) => p.id));
  const projectAction: DryRunActionSummary = {
    entity: "projects",
    toCreate: 0,
    toUpdate: 0,
    toSkip: 0,
    conflicts: [],
  };
  for (const proj of projects) {
    if (existingProjectIds.has(proj.id)) {
      projectAction.toSkip++;
      projectAction.conflicts.push({
        id: proj.id,
        reason: "Project ID already exists in target database.",
        resolution: "skip",
      });
    } else {
      projectAction.toCreate++;
    }
  }
  actions["projects"] = projectAction;

  const taskAction: DryRunActionSummary = {
    entity: "projectTasks",
    toCreate: 0,
    toUpdate: 0,
    toSkip: 0,
    conflicts: [],
  };
  for (const task of projectTasks) {
    if (
      !task.projectId ||
      (!archiveProjectIds.has(task.projectId) && !existingProjectIds.has(task.projectId))
    ) {
      unresolvedForeignKeys.push({
        entity: "projectTasks",
        recordId: task.id,
        foreignField: "projectId",
        missingTargetId: task.projectId ?? "(none)",
      });
    }
    taskAction.toCreate++;
  }
  actions["projectTasks"] = taskAction;

  // Check Goals
  const goalAction: DryRunActionSummary = {
    entity: "salesGoals",
    toCreate: 0,
    toUpdate: 0,
    toSkip: 0,
    conflicts: [],
  };
  for (const goal of goals) {
    if (existingGoalIds.has(goal.id)) {
      goalAction.toSkip++;
      goalAction.conflicts.push({
        id: goal.id,
        reason: "Goal ID already exists in target database.",
        resolution: "skip",
      });
    } else {
      goalAction.toCreate++;
    }
  }
  actions["salesGoals"] = goalAction;

  // Attachments verification
  const attachmentsList = (
    Array.isArray(attMetaData?.["attachments"]) ? attMetaData!["attachments"] : []
  ) as Array<{
    attachmentId: string;
    paymentId: string;
    path: string | null;
  }>;
  const missingAttachmentPaths: string[] = [];
  let verifiedAttachments = 0;

  for (const att of attachmentsList) {
    if (!att.path || !files[att.path]) {
      missingAttachmentPaths.push(att.path ?? `attachment:${att.attachmentId}`);
    } else {
      verifiedAttachments++;
    }
  }

  // Financial reconciliation check
  const manifestActivePaise = manifest.financialSummary?.activePaymentsPaise ?? derivedActivePaise;
  const reconciled = manifestActivePaise === derivedActivePaise;
  const financialNotes: string[] = [];
  if (!reconciled) {
    financialNotes.push(
      `Discrepancy: Manifest active paise (${manifestActivePaise}) differs from sum of payments (${derivedActivePaise}).`,
    );
  } else {
    financialNotes.push(
      `Active payments perfectly reconcile to exact paise: ${derivedActivePaise} paise (₹${(derivedActivePaise / 100).toLocaleString("en-IN")}).`,
    );
  }
  if (derivedVoidedPaise > 0) {
    financialNotes.push(
      `Voided payments preserved without contributing to active cash: ${derivedVoidedPaise} paise.`,
    );
  }

  const totalRecordsToCreate = Object.values(actions).reduce((sum, a) => sum + a.toCreate, 0);
  const totalRecordsToUpdate = Object.values(actions).reduce((sum, a) => sum + a.toUpdate, 0);
  const totalRecordsToSkip = Object.values(actions).reduce((sum, a) => sum + a.toSkip, 0);

  const dryRunOk =
    validation.ok &&
    unresolvedForeignKeys.length === 0 &&
    missingAttachmentPaths.length === 0 &&
    reconciled;

  return {
    ok: dryRunOk,
    dryRun: true,
    mutationsPerformed: 0,
    databaseWritten: false,
    timestamp: new Date().toISOString(),
    sourceManifest: {
      formatVersion: manifest.formatVersion,
      schemaVersion: manifest.schemaVersion,
      type: manifest.type,
      createdAt: manifest.createdAt,
    },
    actions,
    totalRecordsToCreate,
    totalRecordsToUpdate,
    totalRecordsToSkip,
    unresolvedForeignKeys,
    financialReconciliation: {
      reconciled,
      sourceTotalPaise: manifestActivePaise,
      derivedTotalPaise: derivedActivePaise,
      sourceVoidedPaise: derivedVoidedPaise,
      notes: financialNotes,
    },
    attachments: {
      expected: attachmentsList.length,
      verified: verifiedAttachments,
      missing: missingAttachmentPaths,
    },
    validationErrors: validation.errors,
    warnings: validation.warnings,
  };
}
