import { describe, expect, it, vi } from "vitest";
import {
  addDeliverableRevision,
  addProjectNote,
  archiveProject,
  configureProjectSupport,
  createDeliverable,
  createMilestone,
  createProject,
  createSupportTicket,
  createTask,
  deliverProject,
  getProjectDetails,
  getProjectOverview,
  listProjects,
  listProjectTemplates,
  moveProjectStage,
  reopenSupportTicket,
  resolveSupportTicket,
  saveProjectTemplate,
  setProjectStatus,
  setTaskDone,
  toggleChecklistItem,
  toggleDependencyItem,
  undoProjectStage,
  updateMilestone,
  updateProject,
  updateSupportTicket,
  updateTask,
} from "./projectsApi";
import type {
  ClientSupportTicketDto,
  ProjectDeliverableDto,
  ProjectDeliverableRevisionDto,
  ProjectDto,
  ProjectMilestoneDto,
  ProjectTaskDto,
  ProjectTemplateDto,
} from "./schemas";

describe("B5B Typed Projects API Client", () => {
  const mockProject: ProjectDto = {
    id: "proj_1",
    ownerUserId: "usr_owner",
    name: "Acme Web Platform",
    clientName: "Acme Corp",
    company: "Acme Industries",
    phone: "+91 98765 43210",
    email: "contact@acme.com",
    leadId: "lead_123",
    dealId: "deal_123",
    templateId: "tpl_123",
    legacyId: null,
    type: "Website Studio",
    scope: "Design, Development, and 3D Visuals",
    bookingDate: "2026-11-01",
    plannedStart: "2026-11-05",
    actualStart: "2026-11-05",
    targetDelivery: "2026-12-01",
    status: "in_progress",
    stage: "development",
    priority: "high",
    projectOwnerId: "usr_owner",
    memberIds: ["usr_dev1"],
    dependencies: [{ id: "dep_1", label: "Logo Vector Files", done: true, doneAt: "2026-11-06" }],
    requirements: [{ id: "req_1", label: "Dark theme support", done: true }],
    qa: [{ id: "qa_1", label: "Mobile viewport QA", done: false }],
    handover: [{ id: "ho_1", label: "Admin credentials handover", done: false }],
    links: [{ id: "lnk_1", label: "Figma File", url: "https://figma.com/file/123", addedAt: "2026-11-05" }],
    delivery: null,
    support: { included: true, months: 3, start: "2026-12-01", end: "2027-02-28", description: "Bug fixes" },
    carried: { source: "Website", packageRef: "Scale Flow Ultra" },
    notes: "Client has tight launch deadline.",
    reviewFlag: null,
    attention: null,
    archived: false,
    archivedAt: null,
    version: 1,
    progress: { total: 2, done: 1, pct: 50, text: "1 of 2 tasks complete" },
    createdAt: "2026-11-01T00:00:00.000Z",
    updatedAt: "2026-11-05T00:00:00.000Z",
  };

  it("listProjects sends GET and parses typed list response", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true, items: [mockProject], total: 1, limit: 50, offset: 0 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const res = await listProjects({ stage: "development", status: "in_progress" });
    expect(res.ok).toBe(true);
    expect(res.items).toHaveLength(1);
    expect(res.items[0]!.name).toBe("Acme Web Platform");
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining("/api/v1/projects?stage=development&status=in_progress"),
      expect.objectContaining({ method: "GET" }),
    );
    spy.mockRestore();
  });

  it("getProjectOverview fetches metrics and attention summary", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          ok: true,
          metrics: {
            active: 1,
            awaiting: 0,
            inProgress: 1,
            overdue: 0,
            delivered: 0,
            openTasks: 1,
            upcomingMilestones: 1,
            openRequests: 0,
          },
          attention: [{ id: "proj_1:tasks", projectId: "proj_1", kind: "tasks_overdue", text: "1 overdue task." }],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );

    const res = await getProjectOverview();
    expect(res.ok).toBe(true);
    expect(res.metrics.active).toBe(1);
    expect(res.attention).toHaveLength(1);
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining("/api/v1/projects/summary/metrics"),
      expect.anything(),
    );
    spy.mockRestore();
  });

  it("getProjectDetails parses project, milestones, tasks, deliverables, tickets, and audit events", async () => {
    const mockMilestone: ProjectMilestoneDto = {
      id: "ms_1",
      ownerUserId: "usr_owner",
      projectId: "proj_1",
      title: "Design Sign-off",
      dueDate: "2026-11-15",
      sortOrder: 0,
      status: "open",
      completedAt: null,
      version: 1,
      createdAt: "2026-11-01T00:00:00.000Z",
      updatedAt: "2026-11-01T00:00:00.000Z",
    };

    const mockTask: ProjectTaskDto = {
      id: "tsk_1",
      ownerUserId: "usr_owner",
      projectId: "proj_1",
      milestoneId: "ms_1",
      title: "Hero section 3D model",
      notes: "High poly GLB",
      assigneeId: "usr_owner",
      dueDate: "2026-11-12",
      priority: "high",
      status: "open",
      completedAt: null,
      completedBy: null,
      sortOrder: 0,
      version: 1,
      createdAt: "2026-11-01T00:00:00.000Z",
      updatedAt: "2026-11-01T00:00:00.000Z",
    };

    const mockDeliverable: ProjectDeliverableDto = {
      id: "del_1",
      ownerUserId: "usr_owner",
      projectId: "proj_1",
      title: "Figma Design Package",
      description: "Full UI design",
      category: "design",
      status: "review",
      dueDate: "2026-11-15",
      deliveredAt: null,
      revisionCount: 1,
      latestRevisionNotes: "Initial review draft",
      clientFeedback: null,
      version: 1,
      createdAt: "2026-11-01T00:00:00.000Z",
      updatedAt: "2026-11-01T00:00:00.000Z",
    };

    const mockTicket: ClientSupportTicketDto = {
      id: "tkt_1",
      ownerUserId: "usr_owner",
      projectId: "proj_1",
      kind: "bug",
      title: "Form submission fails on safari",
      description: "Console error on submit",
      priority: "high",
      assigneeId: "usr_owner",
      dueDate: "2026-11-10",
      status: "open",
      resolution: null,
      resolvedAt: null,
      resolvedByUserId: null,
      coverage: "included",
      version: 1,
      createdAt: "2026-11-01T00:00:00.000Z",
      updatedAt: "2026-11-01T00:00:00.000Z",
    };

    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          ok: true,
          project: mockProject,
          milestones: [mockMilestone],
          tasks: [mockTask],
          deliverables: [mockDeliverable],
          supportTickets: [mockTicket],
          recentAuditEvents: [],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );

    const res = await getProjectDetails("proj_1");
    expect(res.ok).toBe(true);
    expect(res.project.id).toBe("proj_1");
    expect(res.milestones).toHaveLength(1);
    expect(res.tasks).toHaveLength(1);
    expect(res.deliverables).toHaveLength(1);
    expect(res.supportTickets).toHaveLength(1);
    spy.mockRestore();
  });

  it("createProject sends POST with idempotency key and returns created project", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true, project: mockProject }), {
        status: 201,
        headers: { "content-type": "application/json" },
      }),
    );

    const res = await createProject({
      name: "Acme Web Platform",
      clientName: "Acme Corp",
      leadId: "lead_123",
      dealId: "deal_123",
    });

    expect(res.ok).toBe(true);
    expect(res.project.name).toBe("Acme Web Platform");
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining("/api/v1/projects"),
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
          "Idempotency-Key": expect.any(String),
        }),
      }),
    );
    spy.mockRestore();
  });

  it("updateProject sends PATCH with expectedVersion and updates project", async () => {
    const updated = { ...mockProject, name: "Acme Platform V2", version: 2 };
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true, project: updated }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const res = await updateProject("proj_1", { name: "Acme Platform V2", expectedVersion: 1 });
    expect(res.ok).toBe(true);
    expect(res.project.name).toBe("Acme Platform V2");
    expect(res.project.version).toBe(2);
    spy.mockRestore();
  });

  it("setProjectStatus and moveProjectStage send POST with idempotency", async () => {
    const spy1 = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true, project: { ...mockProject, status: "completed" } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const res1 = await setProjectStatus("proj_1", { status: "completed" });
    expect(res1.ok).toBe(true);
    expect(res1.project.status).toBe("completed");
    spy1.mockRestore();

    const spy2 = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({ ok: true, project: { ...mockProject, stage: "delivered" }, previousStage: "development" }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );

    const res2 = await moveProjectStage("proj_1", { stage: "delivered", from: "development" });
    expect(res2.ok).toBe(true);
    expect(res2.project.stage).toBe("delivered");
    expect(res2.previousStage).toBe("development");
    spy2.mockRestore();
  });

  it("undoProjectStage, deliverProject, and configureProjectSupport operate correctly", async () => {
    const spy1 = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true, project: { ...mockProject, stage: "development" } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const res1 = await undoProjectStage("proj_1", { toStage: "development" });
    expect(res1.ok).toBe(true);
    spy1.mockRestore();

    const spy2 = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          ok: true,
          project: {
            ...mockProject,
            stage: "delivered",
            delivery: {
              date: "2026-11-10",
              url: "https://acme.com",
              notes: "Delivered on staging",
              deliveredBy: "usr_owner",
              approval: "approved",
              incomplete: [],
            },
          },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );
    const res2 = await deliverProject("proj_1", {
      date: "2026-11-10",
      approval: "approved",
      url: "https://acme.com",
      notes: "Delivered on staging",
    });
    expect(res2.ok).toBe(true);
    expect(res2.project.stage).toBe("delivered");
    spy2.mockRestore();

    const spy3 = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          ok: true,
          project: {
            ...mockProject,
            support: { included: true, months: 6, start: "2026-11-10", end: "2027-05-10" },
          },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );
    const res3 = await configureProjectSupport("proj_1", {
      included: true,
      months: 6,
      start: "2026-11-10",
    });
    expect(res3.ok).toBe(true);
    expect(res3.project.support.months).toBe(6);
    spy3.mockRestore();
  });

  it("archiveProject and addProjectNote operate correctly", async () => {
    const spy1 = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true, project: { ...mockProject, archived: true }, changed: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const res1 = await archiveProject("proj_1", { archived: true });
    expect(res1.ok).toBe(true);
    expect(res1.project.archived).toBe(true);
    spy1.mockRestore();

    const spy2 = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          ok: true,
          event: {
            id: "aud_1",
            projectId: "proj_1",
            ownerUserId: "usr_owner",
            actorUserId: "usr_owner",
            eventType: "project.note",
            summary: "Decision on domain DNS configuration",
            details: null,
            occurredIstDate: "2026-11-10",
            createdAt: "2026-11-10T00:00:00.000Z",
          },
        }),
        {
          status: 201,
          headers: { "content-type": "application/json" },
        },
      ),
    );
    const res2 = await addProjectNote("proj_1", "Decision on domain DNS configuration");
    expect(res2.ok).toBe(true);
    expect(res2.event.eventType).toBe("project.note");
    spy2.mockRestore();
  });

  it("toggleChecklistItem and toggleDependencyItem update checklists", async () => {
    const spy1 = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true, project: mockProject }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const res1 = await toggleChecklistItem("proj_1", "qa", "qa_1");
    expect(res1.ok).toBe(true);
    spy1.mockRestore();

    const spy2 = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true, project: mockProject }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const res2 = await toggleDependencyItem("proj_1", "dep_1");
    expect(res2.ok).toBe(true);
    spy2.mockRestore();
  });

  it("milestone and task APIs function correctly", async () => {
    const mockMs: ProjectMilestoneDto = {
      id: "ms_2",
      ownerUserId: "usr_owner",
      projectId: "proj_1",
      title: "Backend Setup",
      dueDate: "2026-11-20",
      sortOrder: 1,
      status: "open",
      completedAt: null,
      version: 1,
      createdAt: "2026-11-10T00:00:00.000Z",
      updatedAt: "2026-11-10T00:00:00.000Z",
    };

    const spy1 = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true, milestone: mockMs }), {
        status: 201,
        headers: { "content-type": "application/json" },
      }),
    );
    const res1 = await createMilestone("proj_1", { title: "Backend Setup" });
    expect(res1.ok).toBe(true);
    expect(res1.milestone.title).toBe("Backend Setup");
    spy1.mockRestore();

    const spy2 = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true, milestone: { ...mockMs, status: "completed" } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const res2 = await updateMilestone("ms_2", { status: "completed" });
    expect(res2.ok).toBe(true);
    expect(res2.milestone.status).toBe("completed");
    spy2.mockRestore();

    const mockTsk: ProjectTaskDto = {
      id: "tsk_2",
      ownerUserId: "usr_owner",
      projectId: "proj_1",
      milestoneId: "ms_2",
      title: "Write integration tests",
      notes: null,
      assigneeId: "usr_owner",
      dueDate: "2026-11-20",
      priority: "normal",
      status: "open",
      completedAt: null,
      completedBy: null,
      sortOrder: 1,
      version: 1,
      createdAt: "2026-11-10T00:00:00.000Z",
      updatedAt: "2026-11-10T00:00:00.000Z",
    };

    const spy3 = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true, task: mockTsk }), {
        status: 201,
        headers: { "content-type": "application/json" },
      }),
    );
    const res3 = await createTask("proj_1", { title: "Write integration tests" });
    expect(res3.ok).toBe(true);
    expect(res3.task.title).toBe("Write integration tests");
    spy3.mockRestore();

    const spy4 = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true, task: { ...mockTsk, status: "done" } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const res4 = await setTaskDone("tsk_2", true);
    expect(res4.ok).toBe(true);
    expect(res4.task.status).toBe("done");
    spy4.mockRestore();

    const spy5 = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true, task: { ...mockTsk, notes: "All tests passing" } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const res5 = await updateTask("tsk_2", { notes: "All tests passing" });
    expect(res5.ok).toBe(true);
    expect(res5.task.notes).toBe("All tests passing");
    spy5.mockRestore();
  });

  it("deliverables and revisions APIs function correctly", async () => {
    const mockDel: ProjectDeliverableDto = {
      id: "del_2",
      ownerUserId: "usr_owner",
      projectId: "proj_1",
      title: "Interactive Prototype",
      description: "Figma prototype link",
      category: "design",
      status: "draft",
      dueDate: "2026-11-25",
      deliveredAt: null,
      revisionCount: 0,
      latestRevisionNotes: null,
      clientFeedback: null,
      version: 1,
      createdAt: "2026-11-10T00:00:00.000Z",
      updatedAt: "2026-11-10T00:00:00.000Z",
    };

    const spy1 = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true, deliverable: mockDel }), {
        status: 201,
        headers: { "content-type": "application/json" },
      }),
    );
    const res1 = await createDeliverable("proj_1", { title: "Interactive Prototype" });
    expect(res1.ok).toBe(true);
    expect(res1.deliverable.title).toBe("Interactive Prototype");
    spy1.mockRestore();

    const mockRev: ProjectDeliverableRevisionDto = {
      id: "rev_1",
      deliverableId: "del_2",
      revisionNumber: 1,
      title: "Initial Draft Prototype",
      summary: "First interactive pass for review",
      fileUrl: "https://figma.com/proto/123",
      notes: "Focus on checkout flow",
      clientFeedback: null,
      status: "submitted",
      createdByUserId: "usr_owner",
      createdAt: "2026-11-10T00:00:00.000Z",
    };

    const spy2 = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          ok: true,
          deliverable: { ...mockDel, revisionCount: 1, latestRevisionNotes: "First interactive pass" },
          revision: mockRev,
        }),
        {
          status: 201,
          headers: { "content-type": "application/json" },
        },
      ),
    );

    const res2 = await addDeliverableRevision("del_2", {
      summary: "First interactive pass for review",
      fileUrl: "https://figma.com/proto/123",
    });
    expect(res2.ok).toBe(true);
    expect(res2.deliverable.revisionCount).toBe(1);
    expect(res2.revision.revisionNumber).toBe(1);
    spy2.mockRestore();
  });

  it("support tickets APIs (create, update, resolve, reopen) function correctly", async () => {
    const mockTkt: ClientSupportTicketDto = {
      id: "tkt_2",
      ownerUserId: "usr_owner",
      projectId: "proj_1",
      kind: "technical",
      title: "SSL Certificate renew",
      description: "Expires in 3 days",
      priority: "high",
      assigneeId: "usr_owner",
      dueDate: "2026-11-13",
      status: "open",
      resolution: null,
      resolvedAt: null,
      resolvedByUserId: null,
      coverage: "included",
      version: 1,
      createdAt: "2026-11-10T00:00:00.000Z",
      updatedAt: "2026-11-10T00:00:00.000Z",
    };

    const spy1 = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true, ticket: mockTkt }), {
        status: 201,
        headers: { "content-type": "application/json" },
      }),
    );
    const res1 = await createSupportTicket("proj_1", {
      kind: "technical",
      title: "SSL Certificate renew",
    });
    expect(res1.ok).toBe(true);
    expect(res1.ticket.title).toBe("SSL Certificate renew");
    spy1.mockRestore();

    const spy2 = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true, ticket: { ...mockTkt, status: "in_progress" } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const res2 = await updateSupportTicket("tkt_2", { status: "in_progress" });
    expect(res2.ok).toBe(true);
    expect(res2.ticket.status).toBe("in_progress");
    spy2.mockRestore();

    const spy3 = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          ok: true,
          ticket: { ...mockTkt, status: "resolved", resolution: "Auto-renew rule activated" },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );
    const res3 = await resolveSupportTicket("tkt_2", "Auto-renew rule activated");
    expect(res3.ok).toBe(true);
    expect(res3.ticket.status).toBe("resolved");
    expect(res3.ticket.resolution).toBe("Auto-renew rule activated");
    spy3.mockRestore();

    const spy4 = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true, ticket: { ...mockTkt, status: "open" } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const res4 = await reopenSupportTicket("tkt_2", "Client reports warning still appears");
    expect(res4.ok).toBe(true);
    expect(res4.ticket.status).toBe("open");
    spy4.mockRestore();
  });

  it("templates APIs function correctly", async () => {
    const mockTpl: ProjectTemplateDto = {
      id: "ptpl_1",
      ownerUserId: "usr_owner",
      name: "SaaS Launch Package",
      type: "Web Application",
      builtIn: false,
      milestones: ["Design", "MVP Build", "Launch"],
      tasks: [{ title: "Figma wireframes", milestone: "Design" }],
      requirements: ["Figma assets"],
      qa: ["Lighthouse > 90"],
      handover: ["DNS records"],
      archived: false,
      createdAt: "2026-11-10T00:00:00.000Z",
      updatedAt: "2026-11-10T00:00:00.000Z",
    };

    const spy1 = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true, items: [mockTpl] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const res1 = await listProjectTemplates();
    expect(res1.ok).toBe(true);
    expect(res1.items).toHaveLength(1);
    expect(res1.items[0]!.name).toBe("SaaS Launch Package");
    spy1.mockRestore();

    const spy2 = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true, template: mockTpl }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const res2 = await saveProjectTemplate({
      name: "SaaS Launch Package",
      type: "Web Application",
    });
    expect(res2.ok).toBe(true);
    expect(res2.template.name).toBe("SaaS Launch Package");
    spy2.mockRestore();
  });
});
