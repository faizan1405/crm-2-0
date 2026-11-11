import "@tanstack/react-start/server-only";
import { z } from "zod";
import type { MySql2Database } from "drizzle-orm/mysql2";
import { eq, and } from "drizzle-orm";
import {
  ALL_TRIGGERS,
  ACTION_LABELS,
  type ActionType,
  type ConditionEvaluationResult,
  type LeadEvaluationContext,
  type RuleConditions,
  type RuleSettings,
  type RuleSubject,
  type TriggerType,
  evaluateLeadConditions,
} from "./automationCalc.server";
import {
  crmLeads,
  crmLeadActivities,
  crmFollowUps,
  crmLeadInboxItems,
  crmLeadFieldValues,
  crmLeadTags,
  crmProjects,
  crmProjectTasks,
  crmProjectMilestones,
  crmClientSupportTickets,
} from "../db/schema.server";
import { CrmServiceError } from "./errors.server";

export const syntheticEventSchema = z.object({
  triggerType: z.enum(ALL_TRIGGERS),
  leadId: z.string().max(64).optional(),
  projectId: z.string().max(64).optional(),
  followupId: z.string().max(64).optional(),
  at: z.string().datetime().optional(),
  payload: z.record(z.unknown()).optional(),
});

export type SyntheticEvent = z.infer<typeof syntheticEventSchema>;

export interface PlannedActionItem {
  action: ActionType;
  label: string;
  category: "internal" | "business_state" | "external";
  target: string;
  reason: string;
  dueAt: string;
  details: Record<string, unknown>;
  executableInCurrentCheckpoint: boolean;
  unattendedExecutionAllowed: boolean;
}

export interface SimulationResult {
  ruleId: string;
  ruleName: string;
  subject: RuleSubject;
  triggerType: TriggerType;
  eventTriggerType: TriggerType;
  triggerMatched: boolean;
  matched: boolean;
  conditionResults: ConditionEvaluationResult[];
  plannedActions: PlannedActionItem[];
  skippedReasons: string[];
  safeForExecution: boolean;
  zeroWritesVerified: true;
  evaluatedAt: string;
}

/**
 * Pure Simulation Engine for Automation Rules.
 * Evaluates rules against synthetic events and verified database records.
 * STRICT INVARIANT: ZERO database writes to leads, followups, deals, payments, activities, or external systems.
 */
export async function simulateRuleExecution(
  db: MySql2Database<any>,
  ownerUserId: string,
  rule: {
    id: string;
    name: string;
    subject: RuleSubject;
    triggerType: TriggerType;
    conditions: RuleConditions;
    actions: ActionType[];
    settings: RuleSettings;
  },
  event: SyntheticEvent,
): Promise<SimulationResult> {
  const now = event.at ? new Date(event.at) : new Date();
  const nowIso = now.toISOString();

  // 1. Verify Trigger matching
  const triggerMatched = event.triggerType === rule.triggerType;
  if (!triggerMatched) {
    return {
      ruleId: rule.id,
      ruleName: rule.name,
      subject: rule.subject,
      triggerType: rule.triggerType,
      eventTriggerType: event.triggerType,
      triggerMatched: false,
      matched: false,
      conditionResults: [],
      plannedActions: [],
      skippedReasons: [
        `Event trigger "${event.triggerType}" does not match rule trigger "${rule.triggerType}"`,
      ],
      safeForExecution: false,
      zeroWritesVerified: true,
      evaluatedAt: nowIso,
    };
  }

  // 2. Lead Subject Evaluation
  if (rule.subject === "lead") {
    const leadId = event.leadId;
    if (!leadId) {
      return {
        ruleId: rule.id,
        ruleName: rule.name,
        subject: rule.subject,
        triggerType: rule.triggerType,
        eventTriggerType: event.triggerType,
        triggerMatched: true,
        matched: false,
        conditionResults: [],
        plannedActions: [],
        skippedReasons: ["Event does not provide a leadId for lead rule evaluation"],
        safeForExecution: false,
        zeroWritesVerified: true,
        evaluatedAt: nowIso,
      };
    }

    // Query Lead safely (Owner-scoped)
    const [lead] = await db
      .select()
      .from(crmLeads)
      .where(and(eq(crmLeads.id, leadId), eq(crmLeads.ownerUserId, ownerUserId)))
      .limit(1);

    if (!lead) {
      throw new CrmServiceError(404, "lead_not_found", `Lead with ID "${leadId}" not found for this Owner.`);
    }

    // Query recent activities (Owner-scoped)
    const activities = await db
      .select()
      .from(crmLeadActivities)
      .where(and(eq(crmLeadActivities.leadId, leadId), eq(crmLeadActivities.ownerUserId, ownerUserId)));

    // Query inbox item
    const [inboxItem] = await db
      .select()
      .from(crmLeadInboxItems)
      .where(and(eq(crmLeadInboxItems.leadId, leadId), eq(crmLeadInboxItems.ownerUserId, ownerUserId)))
      .limit(1);

    // Query custom field values
    const fieldValues = await db
      .select()
      .from(crmLeadFieldValues)
      .where(and(eq(crmLeadFieldValues.leadId, leadId), eq(crmLeadFieldValues.ownerUserId, ownerUserId)));

    const customFieldValuesMap: Record<string, unknown> = {};
    for (const fv of fieldValues) {
      try {
        customFieldValuesMap[fv.fieldId] = JSON.parse(fv.valueJson);
      } catch {
        customFieldValuesMap[fv.fieldId] = fv.valueJson;
      }
    }

    // Query lead tags
    const leadTags = await db
      .select()
      .from(crmLeadTags)
      .where(and(eq(crmLeadTags.leadId, leadId), eq(crmLeadTags.ownerUserId, ownerUserId)));

    const tagIds = leadTags.map((lt) => lt.tagId);

    // Build evaluation context
    const ctx: LeadEvaluationContext = {
      lead: {
        id: lead.id,
        name: lead.name,
        phone: lead.phone,
        email: lead.email,
        source: lead.source,
        status: lead.status,
        priority: lead.priority,
        createdAt: lead.createdAt,
        updatedAt: lead.updatedAt,
      },
      assignment: null, // Owner-scoped default
      activities: activities.map((a) => ({
        id: a.id,
        leadId: a.leadId,
        type: a.type,
        outcome: a.outcome,
        text: a.text,
        at: a.createdAt,
        opId: null,
      })),
      inboxItem: inboxItem
        ? {
            status: inboxItem.status,
            reviewedAt: inboxItem.reviewedAt ?? null,
          }
        : null,
      customFieldValues: customFieldValuesMap,
      tagIds,
      now,
    };

    // Evaluate conditions
    const evalResult = evaluateLeadConditions(rule.conditions, ctx);
    if (!evalResult.passed) {
      return {
        ruleId: rule.id,
        ruleName: rule.name,
        subject: rule.subject,
        triggerType: rule.triggerType,
        eventTriggerType: event.triggerType,
        triggerMatched: true,
        matched: false,
        conditionResults: evalResult.results,
        plannedActions: [],
        skippedReasons: ["One or more rule conditions were not met"],
        safeForExecution: false,
        zeroWritesVerified: true,
        evaluatedAt: nowIso,
      };
    }

    // Build Planned Actions
    const plannedActions: PlannedActionItem[] = [];
    const target = `lead:${lead.id}`;
    const reason = `${lead.name} qualified for rule "${rule.name}" via trigger "${rule.triggerType}".`;

    for (const action of rule.actions) {
      switch (action) {
        case "reminder":
          plannedActions.push({
            action: "reminder",
            label: ACTION_LABELS.reminder,
            category: "internal",
            target,
            reason,
            dueAt: nowIso,
            details: {
              leadId: lead.id,
              leadName: lead.name,
              importance: "normal",
              flag: rule.actions.includes("flag"),
              ownerReview: rule.actions.includes("owner_review"),
              resolveWhen: rule.conditions.firstContactPending ? "contact" : "never",
            },
            executableInCurrentCheckpoint: true,
            unattendedExecutionAllowed: false, // B10A rule: preview only, unattended runtime deferred
          });
          break;

        case "notify":
          plannedActions.push({
            action: "notify",
            label: ACTION_LABELS.notify,
            category: "internal",
            target,
            reason,
            dueAt: nowIso,
            details: {
              notificationType: "automation_alert",
              message: `Rule "${rule.name}" triggered for ${lead.name}`,
            },
            executableInCurrentCheckpoint: true,
            unattendedExecutionAllowed: false,
          });
          break;

        case "flag":
          plannedActions.push({
            action: "flag",
            label: ACTION_LABELS.flag,
            category: "internal",
            target,
            reason: `Flagged for attention: ${reason}`,
            dueAt: nowIso,
            details: { leadId: lead.id, flag: true },
            executableInCurrentCheckpoint: true,
            unattendedExecutionAllowed: false,
          });
          break;

        case "owner_review":
          plannedActions.push({
            action: "owner_review",
            label: ACTION_LABELS.owner_review,
            category: "internal",
            target,
            reason: `Owner review requested: ${reason}`,
            dueAt: nowIso,
            details: { leadId: lead.id, ownerReview: true },
            executableInCurrentCheckpoint: true,
            unattendedExecutionAllowed: false,
          });
          break;

        case "followup": {
          const hours = rule.settings.followupInHours ?? 24;
          const dueAt = new Date(now.getTime() + hours * 3600000).toISOString();
          plannedActions.push({
            action: "followup",
            label: ACTION_LABELS.followup,
            category: "business_state",
            target,
            reason: `Automatic follow-up suggested for ${lead.name}`,
            dueAt,
            details: {
              leadId: lead.id,
              type: "call",
              dueAt,
              followupInHours: hours,
            },
            executableInCurrentCheckpoint: false, // Business state change: deferred
            unattendedExecutionAllowed: false,
          });
          break;
        }

        case "activity":
          plannedActions.push({
            action: "activity",
            label: ACTION_LABELS.activity,
            category: "business_state",
            target,
            reason: `Logged activity suggested for ${lead.name}`,
            dueAt: nowIso,
            details: {
              leadId: lead.id,
              text: `Automation rule "${rule.name}" matched`,
            },
            executableInCurrentCheckpoint: false,
            unattendedExecutionAllowed: false,
          });
          break;

        case "task":
          plannedActions.push({
            action: "task",
            label: ACTION_LABELS.task,
            category: "business_state",
            target,
            reason: rule.settings.taskTitle ?? "Project task",
            dueAt: nowIso,
            details: {
              title: rule.settings.taskTitle ?? "Project task",
              dueInDays: rule.settings.taskDueInDays ?? 0,
            },
            executableInCurrentCheckpoint: false,
            unattendedExecutionAllowed: false,
          });
          break;
      }
    }

    return {
      ruleId: rule.id,
      ruleName: rule.name,
      subject: rule.subject,
      triggerType: rule.triggerType,
      eventTriggerType: event.triggerType,
      triggerMatched: true,
      matched: true,
      conditionResults: evalResult.results,
      plannedActions,
      skippedReasons: [],
      safeForExecution: plannedActions.every((a) => a.category === "internal"),
      zeroWritesVerified: true,
      evaluatedAt: nowIso,
    };
  }

  // 3. Project Subject Evaluation
  if (rule.subject === "project") {
    const projectId = event.projectId;
    if (!projectId) {
      return {
        ruleId: rule.id,
        ruleName: rule.name,
        subject: rule.subject,
        triggerType: rule.triggerType,
        eventTriggerType: event.triggerType,
        triggerMatched: true,
        matched: false,
        conditionResults: [],
        plannedActions: [],
        skippedReasons: ["Event does not provide a projectId for project rule evaluation"],
        safeForExecution: false,
        zeroWritesVerified: true,
        evaluatedAt: nowIso,
      };
    }

    const [project] = await db
      .select()
      .from(crmProjects)
      .where(and(eq(crmProjects.id, projectId), eq(crmProjects.ownerUserId, ownerUserId)))
      .limit(1);

    if (!project) {
      throw new CrmServiceError(404, "project_not_found", `Project with ID "${projectId}" not found for this Owner.`);
    }

    const tasks = await db
      .select()
      .from(crmProjectTasks)
      .where(and(eq(crmProjectTasks.projectId, projectId), eq(crmProjectTasks.ownerUserId, ownerUserId)));

    const milestones = await db
      .select()
      .from(crmProjectMilestones)
      .where(and(eq(crmProjectMilestones.projectId, projectId), eq(crmProjectMilestones.ownerUserId, ownerUserId)));

    const supportTickets = await db
      .select()
      .from(crmClientSupportTickets)
      .where(and(eq(crmClientSupportTickets.projectId, projectId), eq(crmClientSupportTickets.ownerUserId, ownerUserId)));

    const target = `prj:${project.id}`;
    const plannedActions: PlannedActionItem[] = [];

    for (const action of rule.actions) {
      plannedActions.push({
        action,
        label: ACTION_LABELS[action] ?? action,
        category: action === "reminder" || action === "notify" || action === "flag" || action === "owner_review" ? "internal" : "business_state",
        target,
        reason: `Project rule "${rule.name}" triggered for project "${project.name}"`,
        dueAt: nowIso,
        details: { projectId: project.id, projectName: project.name },
        executableInCurrentCheckpoint: action === "reminder" || action === "notify" || action === "flag" || action === "owner_review",
        unattendedExecutionAllowed: false,
      });
    }

    return {
      ruleId: rule.id,
      ruleName: rule.name,
      subject: rule.subject,
      triggerType: rule.triggerType,
      eventTriggerType: event.triggerType,
      triggerMatched: true,
      matched: true,
      conditionResults: [
        {
          id: "cond_project_active",
          field: "status",
          expected: "not_cancelled",
          actual: project.status,
          passed: project.status !== "cancelled",
          message: `Project "${project.name}" status is "${project.status}"`,
        },
      ],
      plannedActions,
      skippedReasons: [],
      safeForExecution: plannedActions.every((a) => a.category === "internal"),
      zeroWritesVerified: true,
      evaluatedAt: nowIso,
    };
  }

  throw new CrmServiceError(400, "automation_validation_error", `Unsupported subject: ${rule.subject}`);
}
