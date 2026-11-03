import { describe, expect, it } from "vitest";
import { buildSupportContext, classifyIssue, demoSupportReply, nextSupportAction, replyViolations, requestHistory, summarizeRequest, troubleshoot } from "./supportAssist";
import type { Project, SupportRequest } from "@/lib/crm/projects";

const proj = (history: { at: string; by: string; change: string }[] = []) => ({ id: "p1", name: "Sharma Website", clientName: "Rahul Sharma", support: { included: true, start: "2026-01-01", end: "2026-12-31" }, history } as unknown as Project);
const req = (o: Partial<SupportRequest> = {}): SupportRequest => ({ id: "sr1", projectId: "p1", kind: "bug", title: "Contact form not working", description: "The contact form on the home page shows an error when submitting.", priority: "normal", assigneeId: null, createdAt: "2026-11-01T10:00:00Z", status: "open", coverage: "undecided", updatedAt: "2026-11-01T10:00:00Z", version: 1, ...o });
const ctx = (o: Partial<SupportRequest> = {}, h: { at: string; by: string; change: string }[] = []) => buildSupportContext(req(o), proj(h), o.assigneeId ? "Asha" : undefined, "2026-11-03");
const reply = (c: ReturnType<typeof ctx>, purpose: Parameters<typeof demoSupportReply>[0]["purpose"]) => demoSupportReply({ ctx: c, purpose, tone: "professional", lang: "en", variant: 0 });

describe("AI-6B support assistant", () => {
  it("open or in-progress requests never get a resolved reply", () => {
    for (const status of ["open", "in_progress"] as const) {
      expect(reply(ctx({ status }), "resolution").blocked).toBe(true);
      expect(reply(ctx({ status }), "post_resolution").blocked).toBe(true);
      expect(replyViolations(ctx({ status }), "", "Hi Rahul, the issue has been fixed.")).toEqual(expect.arrayContaining([expect.stringMatching(/fixed or resolved/)]));
    }
  });
  it("resolved request without notes cannot claim a fix; with notes it can", () => {
    expect(reply(ctx({ status: "resolved" }), "resolution").blocked).toBe(true);
    const r = reply(ctx({ status: "resolved", resolution: "Updated the form recipient email." }), "resolution");
    expect(r.blocked).toBe(false);
    expect(r.text).toContain("Updated the form recipient email.");
    expect(replyViolations(ctx({ status: "resolved", resolution: "Updated the form recipient email." }), "", r.text)).toEqual([]);
  });
  it("history only includes this request's events", () => {
    const h = [{ at: "2026-11-01", by: "owner", change: "Support request opened: “Contact form not working”" }, { at: "2026-11-02", by: "owner", change: "Support “Other issue” resolved" }, { at: "2026-11-02", by: "owner", change: "Payment received ₹5000" }];
    expect(requestHistory(proj(h), req())).toHaveLength(1);
  });
  it("reopened requests are detected and not called resolved", () => {
    const c = ctx({ status: "open", resolution: "old" }, [{ at: "2026-11-02", by: "owner", change: "Support “Contact form not working” reopened" }]);
    expect(c.reopened).toBe(true);
    expect(summarizeRequest(c).status).toMatch(/Not resolved/);
  });
  it("next action follows recorded status", () => {
    expect(nextSupportAction(ctx({ description: undefined })).kind).toBe("ask_details");
    expect(nextSupportAction(ctx()).kind).toBe("start");
    expect(nextSupportAction(ctx({ status: "in_progress" })).kind).toBe("investigate");
    expect(nextSupportAction(ctx({ status: "resolved" })).kind).toBe("add_resolution");
    expect(nextSupportAction(ctx({ status: "resolved", resolution: "Done" })).kind).toBe("none");
  });
  it("troubleshooting recognises examples and admits unknown issues", () => {
    expect(classifyIssue("Website page not loading, shows 500 error")).toBe("page_not_loading");
    expect(classifyIssue("Razorpay checkout failing")).toBe("payment_gateway");
    expect(classifyIssue("Can't login to admin")).toBe("login");
    const u = troubleshoot(ctx({ title: "Kubernetes pod memory leak", description: "Ingress sidecar latency spikes randomly" }));
    expect(u.kind).toBe("unknown");
    expect(u.steps).toEqual([]);
    expect(u.notices.join(" ")).toMatch(/does not understand/);
  });
  it("blocks invented refunds, coverage, diagnoses, credentials and dates", () => {
    const c = ctx();
    const v = replyViolations(c, "", "Hi Rahul, this was caused by a plugin. It's free of cost, refund coming tomorrow. Please send your password.");
    expect(v.join(" ")).toMatch(/refund/); expect(v.join(" ")).toMatch(/free or covered/); expect(v.join(" ")).toMatch(/technical cause/); expect(v.join(" ")).toMatch(/password/); expect(v.join(" ")).toMatch(/timeframe/);
  });
  it("progress update requires In Progress", () => {
    expect(reply(ctx(), "progress").blocked).toBe(true);
    expect(reply(ctx({ status: "in_progress" }), "progress").text).toMatch(/not resolved yet/);
  });
});
