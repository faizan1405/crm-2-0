import { formatINR } from "@/lib/crm/format";
import { lineTotal, quoteTotals, type BusinessProfile, type Quotation } from "@/lib/crm/studio";
import { ScaleMark } from "@/components/crm/Shell";

const d = (ymd: string) => new Date(`${ymd}T12:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });

/** On-screen quotation document. Business details appear only when the user has configured them. */
export function QuotationPreview({ q, biz, fallbackName }: { q: Quotation; biz: BusinessProfile; fallbackName: string }) {
  const t = quoteTotals(q);
  const contact = [biz.email, biz.phone, biz.website].filter(Boolean).join(" · ");
  return (
    <article className="quote-doc" aria-label={`Quotation ${q.number}`}>
      <header className="quote-doc-head">
        <div className="min-w-0"><div className="flex items-center gap-2"><ScaleMark className="size-6" /><span className="truncate text-lg font-semibold">{biz.name || fallbackName}</span></div>
          {biz.address && <p className="mt-1 text-[11px] opacity-70">{biz.address}</p>}{contact && <p className="text-[11px] opacity-70">{contact}</p>}{biz.gstin && <p className="text-[11px] opacity-70">GSTIN {biz.gstin}</p>}</div>
        <div className="text-right"><div className="quote-doc-kicker">Quotation</div><div className="num text-xs">{q.number}</div><div className="text-[11px] opacity-70">Issued {d(q.issueDate)}</div><div className="text-[11px] opacity-70">Valid until {d(q.validUntil)}</div></div>
      </header>
      <div className="grid gap-4 p-5 sm:grid-cols-2">
        <div><div className="eyebrow">Prepared for</div><div className="mt-1 font-semibold">{q.clientName}</div><div className="text-xs text-muted-foreground">{[q.company, q.phone, q.email].filter(Boolean).join(" · ")}</div></div>
        <div><div className="eyebrow">Project</div><div className="mt-1 font-semibold">{q.title}</div><div className="text-xs text-muted-foreground">Revision {q.revision}</div></div>
      </div>
      <div className="px-5"><table className="quote-table"><thead><tr><th>Description</th><th>Qty</th><th>Unit</th><th>Amount</th></tr></thead>
        <tbody>{q.items.map((i) => <tr key={i.id}><td>{i.description}</td><td className="num">{i.qty}</td><td className="num">{formatINR(i.unitPrice)}</td><td className="num">{formatINR(lineTotal(i))}</td></tr>)}</tbody></table></div>
      <div className="flex justify-end p-5"><dl className="grid w-full max-w-64 gap-1 text-sm">
        <div className="flex justify-between"><dt className="text-muted-foreground">Subtotal</dt><dd className="num">{formatINR(t.subtotal)}</dd></div>
        {t.discount > 0 && <div className="flex justify-between"><dt className="text-muted-foreground">Discount{q.discountType === "percent" ? ` (${q.discount}%)` : ""}</dt><dd className="num">− {formatINR(t.discount)}</dd></div>}
        {q.gstEnabled && <div className="flex justify-between"><dt className="text-muted-foreground">GST ({t.gstRate}%)</dt><dd className="num">{formatINR(t.gst)}</dd></div>}
        <div className="q-total"><dt>Total</dt><dd className="num">{formatINR(t.total)}</dd></div>
      </dl></div>
      {(q.paymentTerms || biz.paymentInstructions || q.notes) && <div className="grid gap-3 border-t p-5 text-xs">
        {q.paymentTerms && <div><div className="eyebrow">Payment terms</div><p className="mt-1 whitespace-pre-line">{q.paymentTerms}</p></div>}
        {biz.paymentInstructions && <div><div className="eyebrow">Payment instructions</div><p className="mt-1 whitespace-pre-line">{biz.paymentInstructions}</p></div>}
        {q.notes && <div><div className="eyebrow">Notes</div><p className="mt-1 whitespace-pre-line">{q.notes}</p></div>}
      </div>}
    </article>
  );
}
