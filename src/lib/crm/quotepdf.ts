// Browser-only quotation PDF. jsPDF is loaded on demand so SSR never evaluates it.
import { quoteTotals, lineTotal, QUOTE_STATUS_LABEL, type BusinessProfile, type Quotation } from "./studio";

// jsPDF's built-in fonts lack the ₹ glyph, so PDFs use "Rs." for amounts.
const rs = (n: number) => `Rs. ${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const d = (ymd: string) => new Date(`${ymd}T12:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });

export async function downloadQuotationPdf(q: Quotation, biz: BusinessProfile, fallbackName: string) {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const W = doc.internal.pageSize.getWidth(), M = 48;
  let y = 0;
  // Header band
  doc.setFillColor(24, 24, 27); doc.rect(0, 0, W, 110, "F");
  doc.setTextColor(255, 255, 255); doc.setFont("helvetica", "bold"); doc.setFontSize(20);
  doc.text(biz.name || fallbackName, M, 52);
  doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(200, 200, 205);
  const bizLines = [biz.address, [biz.email, biz.phone].filter(Boolean).join("  ·  "), biz.website, biz.gstin && `GSTIN ${biz.gstin}`].filter(Boolean) as string[];
  bizLines.slice(0, 3).forEach((l, i) => doc.text(l, M, 70 + i * 12));
  doc.setTextColor(190, 242, 100); doc.setFont("helvetica", "bold"); doc.setFontSize(11);
  doc.text("QUOTATION", W - M, 46, { align: "right" });
  doc.setTextColor(255, 255, 255); doc.setFontSize(9); doc.setFont("helvetica", "normal");
  doc.text(q.number, W - M, 62, { align: "right" });
  doc.text(`Issued ${d(q.issueDate)}`, W - M, 75, { align: "right" });
  doc.text(`Valid until ${d(q.validUntil)}`, W - M, 88, { align: "right" });
  y = 145;
  doc.setTextColor(113, 113, 122); doc.setFontSize(8); doc.text("PREPARED FOR", M, y);
  doc.setTextColor(24, 24, 27); doc.setFontSize(12); doc.setFont("helvetica", "bold"); doc.text(q.clientName, M, y + 16);
  doc.setFont("helvetica", "normal"); doc.setFontSize(9);
  [q.company, q.phone, q.email].filter(Boolean).forEach((l, i) => doc.text(l!, M, y + 30 + i * 12));
  doc.setTextColor(113, 113, 122); doc.setFontSize(8); doc.text("PROJECT", W / 2, y);
  doc.setTextColor(24, 24, 27); doc.setFontSize(12); doc.setFont("helvetica", "bold");
  doc.text(doc.splitTextToSize(q.title, W / 2 - M), W / 2, y + 16);
  doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.text(`Revision ${q.revision} · ${QUOTE_STATUS_LABEL[q.status]}`, W / 2, y + 44);
  y += 80;
  // Items table
  const cols = [M, W - M - 210, W - M - 130, W - M];
  doc.setFillColor(244, 244, 245); doc.rect(M, y, W - 2 * M, 22, "F");
  doc.setFontSize(8); doc.setTextColor(82, 82, 91); doc.setFont("helvetica", "bold");
  doc.text("DESCRIPTION", cols[0]! + 8, y + 14); doc.text("QTY", cols[1]!, y + 14, { align: "right" }); doc.text("UNIT PRICE", cols[2]!, y + 14, { align: "right" }); doc.text("AMOUNT", cols[3]! - 8, y + 14, { align: "right" });
  y += 22; doc.setFont("helvetica", "normal"); doc.setFontSize(9.5); doc.setTextColor(24, 24, 27);
  for (const it of q.items) {
    const lines = doc.splitTextToSize(it.description, cols[1]! - cols[0]! - 60) as string[];
    const h = Math.max(24, lines.length * 12 + 12);
    if (y + h > 720) { doc.addPage(); y = M; }
    doc.text(lines, cols[0]! + 8, y + 16); doc.text(String(it.qty), cols[1]!, y + 16, { align: "right" }); doc.text(rs(it.unitPrice), cols[2]!, y + 16, { align: "right" }); doc.text(rs(lineTotal(it)), cols[3]! - 8, y + 16, { align: "right" });
    y += h; doc.setDrawColor(228, 228, 231); doc.line(M, y, W - M, y);
  }
  const t = quoteTotals(q);
  y += 18;
  const row = (label: string, val: string, bold = false) => { doc.setFont("helvetica", bold ? "bold" : "normal"); doc.setFontSize(bold ? 12 : 9.5); doc.text(label, W - M - 200, y); doc.text(val, W - M - 8, y, { align: "right" }); y += bold ? 22 : 16; };
  row("Subtotal", rs(t.subtotal));
  if (t.discount) row(q.discountType === "percent" ? `Discount (${q.discount}%)` : "Discount", `- ${rs(t.discount)}`);
  if (q.gstEnabled) row(`GST (${t.gstRate}%)`, rs(t.gst));
  doc.setDrawColor(24, 24, 27); doc.line(W - M - 200, y - 8, W - M, y - 8); y += 6;
  row("Total", rs(t.total), true);
  y += 10;
  const block = (title: string, body?: string) => {
    if (!body?.trim()) return;
    const lines = doc.splitTextToSize(body, W - 2 * M) as string[];
    if (y + 30 + lines.length * 12 > 790) { doc.addPage(); y = M; }
    doc.setTextColor(113, 113, 122); doc.setFontSize(8); doc.setFont("helvetica", "bold"); doc.text(title.toUpperCase(), M, y);
    doc.setTextColor(24, 24, 27); doc.setFontSize(9.5); doc.setFont("helvetica", "normal"); doc.text(lines, M, y + 14); y += 24 + lines.length * 12;
  };
  block("Payment terms", q.paymentTerms); block("Payment instructions", biz.paymentInstructions); block("Notes", q.notes);
  doc.setFontSize(8); doc.setTextColor(161, 161, 170); doc.text("This quotation is an estimate and not a tax invoice.", M, 815);
  doc.save(`${q.number}.pdf`);
}
