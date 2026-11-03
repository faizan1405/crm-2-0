import { describe, it, expect, beforeEach } from "vitest";
import { buildRows, checkRows, fileProblem, guessMapping, parseBudget, parseDelimited, toNewLead, toTable, MAX_IMPORT_ROWS } from "./bulkImport";
import { useCRM } from "./store";

const T = (s: string) => { const r = parseDelimited(s); return toTable(r.rows, r.error); };

describe("AI-5A parsing", () => {
  it("handles quotes, commas and escaped quotes inside fields, Hindi and ₹", () => {
    const t = T('Name,Phone,Requirement\n"Ravi, Jr",9123456780,"Logo ""starter"" kit"\nमीना,+91 99887 76655,₹ website');
    expect(t.rows[0]).toEqual(["Ravi, Jr", "9123456780", 'Logo "starter" kit']);
    expect(t.rows[1]).toEqual(["मीना", "+91 99887 76655", "₹ website"]);
  });
  it("reads tab-separated pasted tables and newlines inside quotes", () => {
    expect(T("Name\tPhone\nA\t9123456780").rows[0]).toEqual(["A", "9123456780"]);
    expect(T('Name,Notes\nA,"line1\nline2"').rows[0]).toEqual(["A", "line1\nline2"]);
  });
  it("reports an unclosed quote instead of crashing", () => {
    expect(parseDelimited('Name\n"oops').error).toMatch(/never closed/);
  });
  it(`caps a batch at ${MAX_IMPORT_ROWS} rows and counts the rest`, () => {
    const t = T("Name,Phone\n" + Array.from({ length: 60 }, (_, i) => `L${i},9${String(100000000 + i)}`).join("\n"));
    expect(t.rows.length).toBe(50);
    expect(t.truncated).toBe(10);
  });
  it("rejects unsupported or oversized files", () => {
    expect(fileProblem("leads.pdf", 10)).toMatch(/isn't supported/);
    expect(fileProblem("leads.xls", 10)).toMatch(/isn't supported/);
    expect(fileProblem("a.csv", 2_000_000)).toMatch(/limit is 1 MB/);
    expect(fileProblem("a.xlsx", 100)).toBeUndefined();
  });
});

describe("AI-5A mapping", () => {
  it("maps only exact header aliases; unknown columns are not imported", () => {
    expect(guessMapping(["Full Name", "Mobile", "City", "Amount", "Budget"])).toEqual(["name", "phone", "ignore", "ignore", "budget"]);
  });
  it("keeps unmapped columns for review only", () => {
    const t = T("Name,Phone,City\nA,9123456780,Pune");
    const [r] = buildRows(t, ["name", "phone", "ignore"]);
    expect(r!.extra).toEqual({ City: "Pune" });
    expect(toNewLead(r!)).not.toHaveProperty("City");
  });
  it("parses budget formats and never invents one", () => {
    expect(parseBudget("₹40,000")).toBe(40000);
    expect(parseBudget("1.5L")).toBe(150000);
    expect(parseBudget("")).toBeUndefined();
    expect(parseBudget("-500")).toBe(-500);
    expect(Number.isNaN(parseBudget("abc")!)).toBe(true);
  });
});

describe("AI-5A validation and duplicates", () => {
  const t = T("Name,Phone,Budget\nA,9123456780,\nB,+91 91234 56780,\n,9000000001,\nD,12345,\nE,9000000002,-5\nF,9876500000,");
  const rows = buildRows(t, ["name", "phone", "budget"]);
  const c = checkRows(rows, [{ id: "lead_x", name: "Existing", phone: "098765 00000" }]);
  it("flags in-batch duplicate with and without +91", () => { expect(c["r2"]!.status).toBe("ready"); expect(c["r3"]!.status).toBe("duplicate_batch"); });
  it("flags missing name, invalid phone and negative budget", () => {
    expect(c["r4"]!.problems).toContain("Name is missing");
    expect(c["r5"]!.problems).toContain("Phone isn't a valid 10-digit Indian mobile");
    expect(c["r6"]!.problems).toContain("Budget can't be negative");
  });
  it("flags an existing CRM lead by normalized phone", () => { expect(c["r7"]!.status).toBe("duplicate_crm"); expect(c["r7"]!.existing!.id).toBe("lead_x"); });
});

describe("AI-5A store import", () => {
  beforeEach(() => { localStorage.clear(); useCRM.setState({ leads: [], activities: [], followUps: [], deals: [], payments: [] }); });
  it("creates leads, skips existing phones on retry, and creates no follow-ups/deals/payments", () => {
    const L = (name: string, phone: string) => ({ name, phone, source: "Other" as const, status: "new" as const, priority: "warm" as const, pinned: false });
    const a = useCRM.getState().importLeads([L("A", "9123456780"), L("B", "9123456781"), L("B2", "+91 9123456781")]);
    expect(a.created.length).toBe(2);
    expect(a.skipped).toEqual([{ index: 2, reason: "duplicate" }]);
    const again = useCRM.getState().importLeads([L("A", "9123456780")]);
    expect(again.created).toEqual([]);
    const s = useCRM.getState();
    expect(s.leads.length).toBe(2);
    expect(s.followUps.length + s.deals.length + s.payments.length).toBe(0);
  });
  it("rolls the whole batch back and throws when storage fails", () => {
    useCRM.getState().importLeads([{ name: "Keep", phone: "9123456789", source: "Other", status: "new", priority: "warm", pinned: false }]);
    const orig = Storage.prototype.setItem;
    Storage.prototype.setItem = function () { throw Object.assign(new Error("full"), { name: "QuotaExceededError" }); };
    try {
      expect(() => useCRM.getState().importLeads([{ name: "New", phone: "9123456700", source: "Other", status: "new", priority: "warm", pinned: false }])).toThrow();
    } finally { Storage.prototype.setItem = orig; }
    expect(useCRM.getState().leads.map((l) => l.name)).toEqual(["Keep"]);
  });
});
