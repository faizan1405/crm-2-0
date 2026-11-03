import { describe, expect, it } from "vitest";
import { assemblePdfText, clearReview, extractLeadsFromText, pdfFileProblem, MAX_PDF_BYTES } from "./docExtract";
import { checkRows, toNewLead } from "./bulkImport";

const BRIEF = `Rahul Sharma
9876543210
Needs an e-commerce website
Budget discussed: ₹40,000

Amit Verma - 9812345678
Wants a business website
Call next Friday

Priya Mehta
9898765432
Interior design portfolio website`;

describe("AI-5B unstructured extraction", () => {
  it("splits the brief example into 3 leads with explicit fields only", () => {
    const { rows } = extractLeadsFromText(BRIEF);
    expect(rows.map((r) => [r.name, r.phone])).toEqual([["Rahul Sharma", "9876543210"], ["Amit Verma", "9812345678"], ["Priya Mehta", "9898765432"]]);
    expect(rows[0]!.budget).toBe("₹40,000");
    expect(rows[0]!.requirement).toBe("Needs an e-commerce website");
    expect(rows[1]!.notes).toBe("Call next Friday");
    expect(rows[1]!.budget).toBe("");
    expect(rows[2]!.budget).toBe("");
    expect(rows.every((r) => r.review.length === 0)).toBe(true);
  });
  it("never treats an unlabelled number as budget", () => {
    const [r] = extractLeadsFromText("Neha Rao 9123456780 wants 3 pages and 40000 visitors").rows;
    expect(r!.budget).toBe("");
  });
  it("splits leads with no blank lines when a name line is followed by a phone line", () => {
    const { rows } = extractLeadsFromText("Rahul Sharma\n9876543210\nWebsite\nPriya Mehta\n9898765432\nPortfolio");
    expect(rows.map((r) => r.name)).toEqual(["Rahul Sharma", "Priya Mehta"]);
  });
  it("one lead with two phones → first kept, second shown, Needs Review blocks import", () => {
    const { rows } = extractLeadsFromText("Karan Shah\n9876500001\nAlt 9876500002\nApp development");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.phone).toBe("9876500001");
    expect(rows[0]!.review).toContain("phone");
    expect(Object.values(rows[0]!.extra)).toContain("9876500002");
    expect(checkRows(rows, [])[rows[0]!.key]!.status).toBe("invalid");
    const fixed = clearReview({ ...rows[0]!, phone: "9876500002" }, "phone");
    expect(checkRows([fixed], [])[fixed.key]!.status).toBe("ready");
  });
  it("two phones on one line (multi-column) flags name and phone", () => {
    const [r] = extractLeadsFromText("Rahul 9876543210   Priya 9898765432").rows;
    expect(r!.review).toEqual(expect.arrayContaining(["phone", "name"]));
  });
  it("block with no phone is kept for manual correction, not dropped or merged", () => {
    const { rows } = extractLeadsFromText("Sunita Gupta\nwants a logo\n\nMohan Lal 9811122233");
    expect(rows).toHaveLength(2);
    expect(rows[0]!.phone).toBe("");
    expect(rows[0]!.sourceText).toContain("Sunita Gupta");
    expect(checkRows(rows, [])[rows[0]!.key]!.status).toBe("invalid");
  });
  it("table-style lines become one lead each; header line skipped", () => {
    const { rows } = extractLeadsFromText("Name Phone Requirement\nRavi Kumar 9123456780 Website\nमीना अय्यर +91 99887 76655 लोगो डिज़ाइन");
    expect(rows.map((r) => [r.name, r.phone, r.requirement])).toEqual([["Ravi Kumar", "9123456780", "Website"], ["मीना अय्यर", "9988776655", "लोगो डिज़ाइन"]]);
  });
  it("duplicates: in batch and in CRM", () => {
    const { rows } = extractLeadsFromText("A One 9876543210\n\nB Two 09876543210\n\nC Three 9000000001");
    const ch = checkRows(rows, [{ id: "L1", name: "Old", phone: "+91 90000 00001" }]);
    expect(rows.map((r) => ch[r.key]!.status)).toEqual(["ready", "duplicate_batch", "duplicate_crm"]);
  });
  it("labelled priority/email/company/source extracted; HTML kept as text with warning", () => {
    const res = extractLeadsFromText("Name: Zoya Khan\nPhone: 9876512345\nEmail: zoya@example.com\nCompany: Zoya Studio\nSource: Instagram\nPriority: Hot\n<script>alert(1)</script>");
    const r = res.rows[0]!;
    expect([r.name, r.email, r.company, r.source, r.priority]).toEqual(["Zoya Khan", "zoya@example.com", "Zoya Studio", "Instagram", "Hot"]);
    expect(r.requirement).toContain("<script>");
    expect(res.warnings.some((w) => w.includes("HTML"))).toBe(true);
    expect(toNewLead(r).priority).toBe("hot");
  });
  it("caps at 50 leads", () => {
    const text = Array.from({ length: 55 }, (_, i) => `Lead Person ${String.fromCharCode(65 + (i % 26))}\n9${String(800000000 + i)}`).join("\n\n");
    const res = extractLeadsFromText(text);
    expect(res.rows).toHaveLength(50);
    expect(res.truncated).toBe(5);
  });
  it("gibberish is not claimed as understood", () => {
    const res = extractLeadsFromText("lorem ipsum 12345");
    expect(res.understood).toBe(false);
  });
});

describe("AI-5B PDF helpers", () => {
  it("assembles lines in reading order with blank lines at gaps and counts chars", () => {
    const it = (str: string, x: number, y: number) => ({ str, x, y, w: str.length * 5, h: 10 });
    const a = assemblePdfText([{ width: 600, items: [it("9876543210", 50, 685), it("Rahul", 50, 700), it("Sharma", 85, 700), it("Priya", 50, 640), it("9898765432", 50, 625)] }]);
    expect(a.text).toBe("Rahul Sharma\n9876543210\n\nPriya\n9898765432");
    expect(a.chars).toBeGreaterThan(20);
    expect(a.multiColumnPages).toEqual([]);
  });
  it("flags wide gutters as multi-column", () => {
    const it = (str: string, x: number, y: number) => ({ str, x, y, w: 40, h: 10 });
    const a = assemblePdfText([{ width: 600, items: [it("Rahul", 40, 700), it("Priya", 340, 700), it("98765", 40, 685), it("98987", 340, 685)] }]);
    expect(a.multiColumnPages).toEqual([1]);
  });
  it("rejects non-PDF, empty, oversized and bad-header files", () => {
    expect(pdfFileProblem("a.docx", 10)).toBeTruthy();
    expect(pdfFileProblem("a.pdf", 0)).toBeTruthy();
    expect(pdfFileProblem("a.pdf", MAX_PDF_BYTES + 1)).toBeTruthy();
    expect(pdfFileProblem("a.pdf", 10, new TextEncoder().encode("hello"))).toBeTruthy();
    expect(pdfFileProblem("a.pdf", 10, new TextEncoder().encode("%PDF-"))).toBeUndefined();
  });
});
