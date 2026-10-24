import { beforeEach, describe, expect, it } from "vitest";
import { useCRM } from "./store";
import { editSummary } from "./leadtools";
const s = () => useCRM.getState();
const edits = (id: string) => s().activities.filter((a) => a.leadId === id && a.type === "edit");

describe("contact-detail edit history", () => {
  beforeEach(() => { localStorage.clear(); s().reset(); });
  it("one event per save listing changed fields, without values", () => {
    const l = s().leads[0]!;
    expect(s().updateLead(l.id, { phone: "9123456780", email: "new@x.in", company: "NewCo", source: l.source })).toBe(true);
    const e = edits(l.id);
    expect(e).toHaveLength(1);
    expect(e[0]!.text).toBe("Contact details updated: phone, email, company changed");
    expect(e[0]!.text).not.toContain("9123456780");
  });
  it("no event when values are unchanged", () => {
    const l = s().leads[0]!;
    s().updateLead(l.id, { phone: l.phone, email: l.email, company: l.company });
    expect(edits(l.id)).toHaveLength(0);
  });
  it("source change is recorded", () => expect(editSummary({ source: "Website" }, { source: "Meta Ads" })).toBe("Contact details updated: lead source changed"));
  it("stage-only change does not add an edit event", () => {
    const l = s().leads[0]!;
    s().updateLead(l.id, { status: l.status === "won" ? "lost" : "won", lostReason: "x" });
    expect(edits(l.id)).toHaveLength(0);
  });
});
