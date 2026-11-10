import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  crmProjectTemplates,
  crmProjects,
  crmProjectMilestones,
  crmProjectTasks,
  crmProjectDeliverables,
  crmProjectDeliverableRevisions,
  crmClientSupportTickets,
  crmProjectAuditEvents,
} from "./db/schema.server";
import {
  createProjectBodySchema,
  updateProjectBodySchema,
  setProjectStatusBodySchema,
  moveProjectStageBodySchema,
  undoProjectStageBodySchema,
  deliverProjectBodySchema,
  configureProjectSupportBodySchema,
  archiveProjectBodySchema,
  addProjectNoteBodySchema,
  toggleChecklistItemBodySchema,
  toggleDependencyItemBodySchema,
  createMilestoneBodySchema,
  updateMilestoneBodySchema,
  createTaskBodySchema,
  updateTaskBodySchema,
  completeTaskBodySchema,
  createDeliverableBodySchema,
  addDeliverableRevisionBodySchema,
  createSupportTicketBodySchema,
  updateSupportTicketBodySchema,
  resolveSupportTicketBodySchema,
  reopenSupportTicketBodySchema,
  saveProjectTemplateBodySchema,
} from "./crm/validation.server";
import {
  projectProgress,
  milestoneProgress,
  deliveryGaps,
  deliveryError,
  supportStatus,
  addMonths,
  supportError,
  applyStatusSideEffects,
  looksLikeSecret,
  validateProjectFields,
  projectAttention,
  projectMetrics,
} from "./crm/projectsCalc.server";

describe("Checkpoint B5A — Project Delivery Backend Foundation", () => {
  describe("1. Database Schema and Migration Artifacts", () => {
    it("exports all 8 B5A database table schemas with required fields", () => {
      expect(crmProjectTemplates).toBeDefined();
      expect(crmProjects).toBeDefined();
      expect(crmProjectMilestones).toBeDefined();
      expect(crmProjectTasks).toBeDefined();
      expect(crmProjectDeliverables).toBeDefined();
      expect(crmProjectDeliverableRevisions).toBeDefined();
      expect(crmClientSupportTickets).toBeDefined();
      expect(crmProjectAuditEvents).toBeDefined();

      // Check key columns on crmProjects
      expect(crmProjects.id).toBeDefined();
      expect(crmProjects.ownerUserId).toBeDefined();
      expect(crmProjects.leadId).toBeDefined();
      expect(crmProjects.dealId).toBeDefined();
      expect(crmProjects.name).toBeDefined();
      expect(crmProjects.status).toBeDefined();
      expect(crmProjects.stage).toBeDefined();
      expect(crmProjects.version).toBeDefined();

      // Check key columns on crmProjectTasks
      expect(crmProjectTasks.id).toBeDefined();
      expect(crmProjectTasks.projectId).toBeDefined();
      expect(crmProjectTasks.title).toBeDefined();
      expect(crmProjectTasks.status).toBeDefined();
      expect(crmProjectTasks.priority).toBeDefined();

      // Check key columns on crmProjectDeliverables
      expect(crmProjectDeliverables.id).toBeDefined();
      expect(crmProjectDeliverables.projectId).toBeDefined();
      expect(crmProjectDeliverables.revisionCount).toBeDefined();

      // Check key columns on crmClientSupportTickets
      expect(crmClientSupportTickets.id).toBeDefined();
      expect(crmClientSupportTickets.projectId).toBeDefined();
      expect(crmClientSupportTickets.status).toBeDefined();
      expect(crmClientSupportTickets.resolution).toBeDefined();
    });

    it("has migration 0008_b5a_projects.sql containing CREATE TABLE for all 8 tables", () => {
      const migrationPath = path.join(process.cwd(), "src", "server", "db", "migrations", "0008_b5a_projects.sql");
      expect(fs.existsSync(migrationPath)).toBe(true);

      const sqlContent = fs.readFileSync(migrationPath, "utf-8");
      expect(sqlContent).toContain("crm_project_templates");
      expect(sqlContent).toContain("crm_projects");
      expect(sqlContent).toContain("crm_project_milestones");
      expect(sqlContent).toContain("crm_project_tasks");
      expect(sqlContent).toContain("crm_project_deliverables");
      expect(sqlContent).toContain("crm_project_deliverable_revisions");
      expect(sqlContent).toContain("crm_client_support_tickets");
      expect(sqlContent).toContain("crm_project_audit_events");
    });
  });

  describe("2. Validation Schemas & Data Constraints", () => {
    it("validates valid project creation payload and rejects invalid fields", () => {
      const valid = createProjectBodySchema.safeParse({
        name: "Website Redesign & Sales OS",
        clientName: "Acme Corp",
        type: "Website Redesign",
        bookingDate: "2026-03-01",
        plannedStart: "2026-03-05",
        targetDelivery: "2026-04-15",
        leadId: "lead_123",
        dealId: "deal_456",
      });
      expect(valid.success).toBe(true);

      // Rejects empty clientName
      const invalidClient = createProjectBodySchema.safeParse({
        name: "Project Without Client",
        clientName: "   ",
      });
      expect(invalidClient.success).toBe(false);

      // Rejects invalid date format
      const invalidDate = createProjectBodySchema.safeParse({
        name: "Acme Redesign",
        clientName: "Acme Corp",
        bookingDate: "invalid-date",
      });
      expect(invalidDate.success).toBe(false);

      // Rejects empty name
      const emptyName = createProjectBodySchema.safeParse({
        name: "   ",
        clientName: "Acme",
      });
      expect(emptyName.success).toBe(false);
    });

    it("validates milestone payload constraints", () => {
      const valid = createMilestoneBodySchema.safeParse({
        title: "Architecture & Wireframes",
        dueDate: "2026-03-15",
        sortOrder: 1,
      });
      expect(valid.success).toBe(true);

      const invalidTitle = createMilestoneBodySchema.safeParse({
        title: "  ",
        sortOrder: 1,
      });
      expect(invalidTitle.success).toBe(false);
    });

    it("validates task payload constraints and priority levels", () => {
      const valid = createTaskBodySchema.safeParse({
        title: "Set up staging database",
        priority: "high",
        dueDate: "2026-03-10",
      });
      expect(valid.success).toBe(true);

      const invalidPriority = createTaskBodySchema.safeParse({
        title: "Task",
        priority: "p5_optional",
      });
      expect(invalidPriority.success).toBe(false);
    });

    it("validates support ticket payloads and resolution notes requirement", () => {
      const validCreation = createSupportTicketBodySchema.safeParse({
        kind: "bug",
        title: "Login button unresponsive on Safari",
        priority: "high",
        description: "User reported issue on iOS Safari 17.",
      });
      expect(validCreation.success).toBe(true);

      const validResolution = resolveSupportTicketBodySchema.safeParse({
        resolution: "Fixed CSS tap event listener bug.",
        expectedVersion: 1,
      });
      expect(validResolution.success).toBe(true);

      const invalidResolution = resolveSupportTicketBodySchema.safeParse({
        resolution: "  ",
        expectedVersion: 1,
      });
      expect(invalidResolution.success).toBe(false);
    });
  });

  describe("3. Business Rules and Calculations", () => {
    it("detects secrets and credentials in text fields", () => {
      expect(looksLikeSecret("Standard delivery notes.")).toBe(false);
      expect(looksLikeSecret("Database password: supersecretpassword123")).toBe(true);
      expect(looksLikeSecret("token: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9")).toBe(true);
      expect(looksLikeSecret("api_key: sk_live_1234567890abcdef")).toBe(true);
    });

    it("computes milestone progress and project delivery gaps", () => {
      const tasks = [
        { id: "t1", milestoneId: "m1", status: "done" },
        { id: "t2", milestoneId: "m1", status: "open" },
        { id: "t3", milestoneId: "m2", status: "done" },
      ];

      const m1Progress = milestoneProgress("m1", tasks);
      expect(m1Progress.total).toBe(2);
      expect(m1Progress.done).toBe(1);
      expect(m1Progress.complete).toBe(false);

      const prog = projectProgress(tasks);
      expect(prog.total).toBe(3);
      expect(prog.done).toBe(2);
      expect(prog.pct).toBe(67);

      const projectWithChecklists = {
        qa: [
          { id: "q1", label: "Browser compatibility check", done: true },
          { id: "q2", label: "SSL certification active", done: false },
        ],
        handover: [
          { id: "h1", label: "Domain DNS point to server", done: false },
        ],
      };

      const gaps = deliveryGaps(projectWithChecklists);
      expect(gaps.length).toBe(2);
      expect(gaps).toContain("SSL certification active");
      expect(gaps).toContain("Domain DNS point to server");
    });

    it("verifies support status and dates correctly", () => {
      const end = addMonths("2026-01-15", 3);
      expect(end).toBe("2026-04-14");

      const supportConfig = {
        included: true,
        start: "2026-01-01",
        end: "2026-04-01",
        months: 3,
      };

      const status = supportStatus(supportConfig, "2026-02-01");
      expect(status).toBe("active");

      const endedStatus = supportStatus(supportConfig, "2026-05-01");
      expect(endedStatus).toBe("ended");
    });
  });

  describe("4. Strict Separation of Delivery from Finance", () => {
    it("ensures project creation and updates never touch deal financials or payments", () => {
      // In the CRM architecture:
      // A project can reference a dealId and leadId for operational tracking,
      // but its schema has NO fields for deal amount, payment received, balance, or invoice numbers.
      const projectCols = Object.keys(crmProjects);
      expect(projectCols).not.toContain("amount");
      expect(projectCols).not.toContain("dealValue");
      expect(projectCols).not.toContain("paidAmount");
      expect(projectCols).not.toContain("balance");
      expect(projectCols).not.toContain("invoiceNumber");
      expect(projectCols).not.toContain("paymentStatus");

      // Similarly for milestones:
      // Milestones in B5A are delivery stages, NOT financial billing milestones
      const milestoneCols = Object.keys(crmProjectMilestones);
      expect(milestoneCols).not.toContain("amount");
      expect(milestoneCols).not.toContain("isBilled");
      expect(milestoneCols).not.toContain("paymentRecordId");
    });
  });
});
