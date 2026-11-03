// AI-6C Owner Finance AI Assistant — explains numbers computed ONLY by the canonical CRM finance functions
// (finance.ts, analytics.financeKpis/financeBreakdown, projects.projectFinance). Pure: no network, no writes.
// Context excludes phone/email, payment-proof contents, credentials, notes and lead data.
import { dealCollected, dealOutstanding, dealPaymentStatus, financeSummary, isDealOverdue, type PaymentStatus } from "@/lib/crm/finance";
import { analyticsWindow, dealWonAt, financeBreakdown, financeKpis } from "@/lib/crm/analytics";
import { projectFinance, type Project } from "@/lib/crm/projects";
import { dayKey, formatINR, formatPct } from "@/lib/crm/format";
import type { Deal, Payment } from "@/lib/crm/types";
import type { RewriteTone } from "./rewrite";
import { dayLabel } from "./projectAssist";

export const FINANCE_DEMO_LABEL = "Demo Analysis — based on recorded financial data, not a live AI model.";
export const NO_DATE = "Payment date not recorded.";

// ---------- Deal context ----------
export interface DealFinanceContext {
  dealId: string; dealName: string; clientName: string; firstName: string; leadId?: string;
  status: Deal["status"]; paymentStatus: PaymentStatus;
  agreed: number; received: number; outstanding: number;
  validPayments: { amount: number; date: string; method: string; type: string }[];
  voided: { count: number; amount: number };
  lastPaymentDate?: string;
  dueDate?: string; overdue: boolean;
  milestones: { label: string; amount: number; dueDate: string }[];
  nextMilestone?: { label: string; amount: number; dueDate: string };
  wonAt?: string; createdAt: string;
}
export function buildDealContext(d: Deal, payments: Payment[], now = new Date()): DealFinanceContext {
  const mine = payments.filter((p) => p.dealId === d.id);
  const valid = mine.filter((p) => !p.voided).sort((a, b) => a.date.localeCompare(b.date));
  const voided = mine.filter((p) => p.voided);
  const received = dealCollected(d.id, payments);
  const ms = [...d.milestones].filter((m) => m.dueDate).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  let cum = 0; let nextMilestone: DealFinanceContext["nextMilestone"];
  for (const m of ms) { cum += m.amount; if (cum > received) { nextMilestone = { label: m.label, amount: m.amount, dueDate: m.dueDate }; break; } }
  const c: DealFinanceContext = {
    dealId: d.id, dealName: d.name, clientName: d.clientName, firstName: d.clientName.trim().split(/\s+/)[0] || d.clientName,
    status: d.status, paymentStatus: dealPaymentStatus(d, payments, now),
    agreed: d.finalAmount, received, outstanding: dealOutstanding(d, payments),
    validPayments: valid.map((p) => ({ amount: p.amount, date: p.date, method: p.method, type: p.type })),
    voided: { count: voided.length, amount: voided.reduce((s, p) => s + p.amount, 0) },
    overdue: isDealOverdue(d, payments, now), milestones: ms.map((m) => ({ label: m.label, amount: m.amount, dueDate: m.dueDate })),
    createdAt: d.createdAt,
  };
  if (d.leadId) c.leadId = d.leadId;
  if (valid.length) c.lastPaymentDate = valid[valid.length - 1]!.date;
  if (d.dueDate) c.dueDate = d.dueDate;
  if (nextMilestone) c.nextMilestone = nextMilestone;
  const w = dealWonAt(d); if (w) c.wonAt = w;
  return c;
}
export const nextDueText = (c: DealFinanceContext) => c.nextMilestone ? `${c.nextMilestone.label}: ${formatINR(c.nextMilestone.amount)} on ${dayLabel(c.nextMilestone.dueDate)}` : c.dueDate ? dayLabel(c.dueDate) : NO_DATE;
export function dealFacts(c: DealFinanceContext): string[] {
  return [
    `Deal: ${c.dealName} · ${c.clientName}`, `Agreed value: ${formatINR(c.agreed)}`, `Valid payments received: ${formatINR(c.received)} (${c.validPayments.length})`,
    `Outstanding: ${formatINR(c.outstanding)}`, `Voided (excluded): ${c.voided.count ? `${c.voided.count} · ${formatINR(c.voided.amount)}` : "none"}`,
    `Last payment: ${c.lastPaymentDate ? dayLabel(c.lastPaymentDate) : "none recorded"}`, `Next payment due: ${nextDueText(c)}`,
    `Won date: ${c.wonAt ? dayLabel(c.wonAt) : "Not recorded (legacy deal)"}`,
  ];
}

// ---------- Summary ----------
export interface FinanceExplanation {
  booked: number; collected: number; outstanding: number; overdue: number; rate: number | null; outstandingShare: number | null;
  fullyPaid: string[]; partial: string[]; noPayment: string[]; voidedCount: number; voidedAmount: number;
  thisMonth: { booked: number; collected: number; unknownWon: number; unknownWonValue: number; monthLabel: string };
  largest: { name: string; client: string; outstanding: number }[];
  lines: string[];
}
export function explainFinances(deals: Deal[], payments: Payment[], now = new Date()): FinanceExplanation {
  const all = financeSummary(deals, payments, now);
  const allTime = financeBreakdown(deals, payments, { start: "0000-01-01", end: "9999-12-31" }, now);
  const mw = analyticsWindow("thisMonth", now);
  const m = financeKpis(deals, payments, mw, now);
  const name = (id: string) => deals.find((d) => d.id === id)!.name;
  const eligible = new Set(deals.filter((d) => d.status !== "cancelled").map((d) => d.id));
  const vo = payments.filter((p) => p.voided && eligible.has(p.dealId));
  const largest = deals.filter((d) => d.status !== "cancelled").map((d) => ({ name: d.name, client: d.clientName, outstanding: dealOutstanding(d, payments) })).filter((x) => x.outstanding > 0).sort((a, b) => b.outstanding - a.outstanding).slice(0, 5);
  const share = all.totalValue > 0 ? all.outstanding / all.totalValue : null;
  const monthLabel = new Date(`${mw.start}T06:30:00Z`).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "Asia/Kolkata" });
  const lines = [
    `Booked (won deal value, excluding cancelled): ${formatINR(all.totalValue)}. This is agreed value, not cash received.`,
    `Recorded collections (valid payments only): ${formatINR(all.collected)}. These are CRM records, not bank-verified.`,
    `Outstanding receivables: ${formatINR(all.outstanding)}${share !== null ? ` — ${formatPct(share)} of booked value` : ""}.`,
    all.overdue > 0 ? `Of that, ${formatINR(all.overdue)} is past a recorded due date.` : "No balance is past a recorded due date. Outstanding is not the same as overdue.",
    `${vo.length} voided payment(s) totalling ${formatINR(vo.reduce((s, p) => s + p.amount, 0))} are excluded from every total.`,
    "Profit can't be worked out here — expenses and costs aren't recorded in the CRM.",
  ];
  return {
    booked: all.totalValue, collected: all.collected, outstanding: all.outstanding, overdue: all.overdue, rate: all.collectionRate, outstandingShare: share,
    fullyPaid: allTime.fullyPaid.map(name), partial: allTime.partial.map(name), noPayment: allTime.awaiting.map(name),
    voidedCount: vo.length, voidedAmount: vo.reduce((s, p) => s + p.amount, 0),
    thisMonth: { booked: m.wonValue, collected: m.received, unknownWon: m.unknownWonIds.length, unknownWonValue: m.unknownWonValue, monthLabel },
    largest, lines,
  };
}

// ---------- Collection priorities ----------
export interface CollectionItem { dealId: string; ctx: DealFinanceContext; action: string; reason: string; rank: number }
export function collectionPriorities(deals: Deal[], payments: Payment[], now = new Date()): CollectionItem[] {
  const today = dayKey(now);
  const out: CollectionItem[] = [];
  for (const d of deals) {
    if (d.status === "cancelled" || d.status === "completed" && dealOutstanding(d, payments) === 0) continue;
    const c = buildDealContext(d, payments, now);
    if (c.outstanding <= 0) continue;
    let action: string, reason: string, rank: number;
    if (c.overdue) { action = "Send a polite pending-balance reminder"; reason = `Recorded due date ${dayLabel(c.dueDate!)} has passed with ${formatINR(c.outstanding)} outstanding.`; rank = 0; }
    else if (c.nextMilestone && c.nextMilestone.dueDate <= today) { action = "Request the recorded milestone payment"; reason = `Milestone “${c.nextMilestone.label}” was due ${dayLabel(c.nextMilestone.dueDate)}.`; rank = 1; }
    else if (c.received === 0) { action = "Confirm payment terms with the client"; reason = `No payment recorded yet. ${c.dueDate || c.nextMilestone ? `Next recorded date: ${nextDueText(c)}.` : NO_DATE}`; rank = 2; }
    else if (c.nextMilestone || c.dueDate) { action = "Keep in touch before the recorded date"; reason = `Partially paid. Next recorded date: ${nextDueText(c)}.`; rank = 3; }
    else { action = "Agree a date for the remaining balance"; reason = `Partially paid, ${formatINR(c.outstanding)} outstanding. ${NO_DATE} Not overdue.`; rank = 4; }
    out.push({ dealId: d.id, ctx: c, action, reason, rank });
  }
  return out.sort((a, b) => a.rank - b.rank || b.ctx.outstanding - a.ctx.outstanding);
}

// ---------- Record review ----------
export interface Finding { id: string; severity: "review" | "info"; title: string; detail: string; dealId?: string }
export function reviewRecords(deals: Deal[], payments: Payment[], projects: Pick<Project, "id" | "name" | "dealId">[], now = new Date()): Finding[] {
  const out: Finding[] = [];
  const byId = new Map(deals.map((d) => [d.id, d]));
  for (const d of deals) {
    const got = dealCollected(d.id, payments);
    if (got > d.finalAmount && d.finalAmount >= 0) out.push({ id: `over_${d.id}`, severity: "review", dealId: d.id, title: `Needs review: payments exceed the agreed value — ${d.name}`, detail: `Valid payments ${formatINR(got)} vs agreed ${formatINR(d.finalAmount)}. New payments above the outstanding balance are refused, so this is likely an older record or a changed deal value.` });
    if (d.status !== "cancelled" && !dealWonAt(d)) out.push({ id: `won_${d.id}`, severity: "info", dealId: d.id, title: `Won date not recorded — ${d.name}`, detail: `Counts in all-time totals but in no month. Its creation date (${dayLabel(d.createdAt)}) is not used as a won date. You can record a verified won date on the deal.` });
    if (d.finalAmount <= 0 && d.status !== "cancelled") out.push({ id: `zero_${d.id}`, severity: "review", dealId: d.id, title: `Needs review: deal value is ${formatINR(d.finalAmount)} — ${d.name}`, detail: "A won deal normally has a positive agreed value." });
  }
  const seen = new Map<string, Payment>();
  for (const p of payments) {
    if (p.voided) continue;
    const d = byId.get(p.dealId);
    if (!d) { out.push({ id: `orph_${p.id}`, severity: "review", title: "Needs review: payment linked to a missing deal", detail: `${formatINR(p.amount)} on ${dayLabel(p.date)} isn't linked to any existing deal.` }); continue; }
    const k = `${p.dealId}|${p.amount}|${p.date}|${p.method}`;
    const prev = seen.get(k);
    if (prev) out.push({ id: `dup_${p.id}`, severity: "review", dealId: d.id, title: `Needs review: duplicate-looking payments — ${d.name}`, detail: `Two valid ${p.method} payments of ${formatINR(p.amount)} on ${dayLabel(p.date)}${prev.reference && prev.reference === p.reference ? ` with the same reference` : ""}. Check manually before voiding anything.` });
    else seen.set(k, p);
    if (!Number.isFinite(p.amount) || p.amount <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(p.date)) out.push({ id: `bad_${p.id}`, severity: "review", dealId: d.id, title: `Needs review: unusual payment details — ${d.name}`, detail: `Amount ${String(p.amount)} / date ${p.date || "missing"}.` });
    else if (p.date > dayKey(now)) out.push({ id: `fut_${p.id}`, severity: "review", dealId: d.id, title: `Needs review: payment dated in the future — ${d.name}`, detail: `${formatINR(p.amount)} dated ${dayLabel(p.date)}.` });
    else if (p.method !== "Cash" && !p.reference?.trim()) out.push({ id: `ref_${p.id}`, severity: "info", dealId: d.id, title: `No reference recorded — ${d.name}`, detail: `${p.method} payment of ${formatINR(p.amount)} on ${dayLabel(p.date)} has no transaction reference.` });
  }
  // Voided-exclusion invariant against the canonical summary.
  const sum = financeSummary(deals, payments, now);
  const eligible = new Set(deals.filter((d) => d.status !== "cancelled").map((d) => d.id));
  const manual = payments.filter((p) => !p.voided && eligible.has(p.dealId)).reduce((s, p) => s + p.amount, 0);
  if (manual !== sum.collected) out.push({ id: "void_inv", severity: "review", title: "Needs review: totals don't match the payment list", detail: `Summary ${formatINR(sum.collected)} vs valid payments ${formatINR(manual)}.` });
  for (const p of projects) {
    if (!p.dealId) continue;
    const d = byId.get(p.dealId);
    if (!d) { out.push({ id: `pf_${p.id}`, severity: "review", title: `Needs review: project “${p.name}” is linked to a missing deal`, detail: "Project Finance can't show amounts for it." }); continue; }
    const f = projectFinance(p, deals, payments);
    if (f.received !== dealCollected(d.id, payments) || f.remaining !== dealOutstanding(d, payments) || f.agreed !== d.finalAmount) out.push({ id: `pfm_${p.id}`, severity: "review", dealId: d.id, title: `Needs review: Project Finance differs from the deal — ${p.name}`, detail: `Project: ${formatINR(f.received)} received / ${formatINR(f.remaining)} remaining.` });
  }
  return out.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "review" ? -1 : 1));
}

// ---------- Reminder writer ----------
export type ReminderPurpose = "initial" | "followup" | "milestone" | "balance" | "clarify" | "thanks";
export const REMINDER_PURPOSES: ReminderPurpose[] = ["initial", "followup", "milestone", "balance", "clarify", "thanks"];
export const REMINDER_LABEL: Record<ReminderPurpose, string> = { initial: "Polite initial reminder", followup: "Follow-up after a prior reminder", milestone: "Milestone payment request", balance: "Pending balance reminder", clarify: "Payment clarification request", thanks: "Thank-you for a recorded payment" };
export type ReminderLang = "en" | "hi" | "hinglish";
export const REMINDER_LANG_LABEL: Record<ReminderLang, string> = { en: "English", hi: "Hindi", hinglish: "Hinglish" };
export interface ReminderRequest { ctx: DealFinanceContext; purpose: ReminderPurpose; tone: RewriteTone; lang: ReminderLang; variant: number; priorReminder: boolean }
export interface ReminderResult { text: string; blocked: boolean; simulated: true; label: string; contextUsed: string[]; notices: string[] }
export interface FinanceAssistProvider { reminder(req: ReminderRequest): Promise<ReminderResult> }

export function demoReminder({ ctx: c, purpose, tone, lang, variant, priorReminder }: ReminderRequest): ReminderResult {
  const used = dealFacts(c); const notices: string[] = [];
  const blocked = (m: string): ReminderResult => ({ text: "", blocked: true, simulated: true, label: FINANCE_DEMO_LABEL, contextUsed: used, notices: [m] });
  if (c.status === "cancelled") return blocked("This deal is cancelled — no reminder is appropriate.");
  const out = formatINR(c.outstanding), n = c.dealName;
  const due = c.nextMilestone ? dayLabel(c.nextMilestone.dueDate) : c.dueDate ? dayLabel(c.dueDate) : null;
  const body: string[] = [];
  const needBalance = () => (c.outstanding <= 0 ? blocked("This deal is fully paid — no balance reminder should be sent. Try “Thank-you for a recorded payment”.") : null);
  switch (purpose) {
    case "initial": { const b = needBalance(); if (b) return b;
      body.push({ en: `This is a gentle reminder about “${n}”. The pending amount is ${out}${due ? `, due on ${due}` : ""}.`, hi: `“${n}” के लिए एक विनम्र रिमाइंडर। बकाया राशि ${out} है${due ? `, जिसकी तिथि ${due} है` : ""}।`, hinglish: `“${n}” ke liye ek gentle reminder. Pending amount ${out} hai${due ? `, due date ${due}` : ""}.` }[lang]);
      if (!due) notices.push(`${NO_DATE} The draft doesn't mention a date.`); break; }
    case "followup": { const b = needBalance(); if (b) return b;
      if (!priorReminder) notices.push("No earlier payment reminder is recorded in sent WhatsApp history — check before saying “as mentioned earlier”.");
      body.push({ en: `Following up on my earlier message about “${n}”. ${out} is still pending.`, hi: `“${n}” के बारे में मेरे पिछले संदेश के संदर्भ में — ${out} अभी बकाया है।`, hinglish: `“${n}” ke baare mein mere pichhle message ka follow-up — ${out} abhi pending hai.` }[lang]); break; }
    case "milestone": {
      if (!c.nextMilestone) return blocked(c.milestones.length ? "All recorded milestones are covered by payments received." : "No payment milestone is recorded for this deal.");
      const m = c.nextMilestone;
      body.push({ en: `As per the agreed schedule for “${n}”, the “${m.label}” payment of ${formatINR(m.amount)} is due on ${dayLabel(m.dueDate)}.`, hi: `“${n}” की तय योजना के अनुसार “${m.label}” का भुगतान ${formatINR(m.amount)} ${dayLabel(m.dueDate)} को देय है।`, hinglish: `“${n}” ke agreed schedule ke hisaab se “${m.label}” payment ${formatINR(m.amount)} ${dayLabel(m.dueDate)} ko due hai.` }[lang]); break; }
    case "balance": { const b = needBalance(); if (b) return b;
      body.push({ en: `For “${n}”, we have received ${formatINR(c.received)} of ${formatINR(c.agreed)}. The remaining balance is ${out}.`, hi: `“${n}” के लिए ${formatINR(c.agreed)} में से ${formatINR(c.received)} प्राप्त हुए हैं। शेष राशि ${out} है।`, hinglish: `“${n}” ke liye ${formatINR(c.agreed)} mein se ${formatINR(c.received)} receive hue hain. Remaining balance ${out} hai.` }[lang]);
      if (!due) notices.push(`${NO_DATE} This is not described as overdue.`); break; }
    case "clarify":
      body.push({ en: `Could you please help us confirm the payment details for “${n}”? Our records show ${formatINR(c.received)} received so far.`, hi: `कृपया “${n}” के भुगतान विवरण की पुष्टि करने में मदद करें। हमारे रिकॉर्ड में अब तक ${formatINR(c.received)} प्राप्त हैं।`, hinglish: `Please “${n}” ke payment details confirm karne mein help kijiye. Hamare records mein abhi tak ${formatINR(c.received)} received hai.` }[lang]); break;
    case "thanks": {
      const last = c.validPayments[c.validPayments.length - 1];
      if (!last) return blocked("No valid payment is recorded for this deal, so a thank-you would be inaccurate.");
      body.push({ en: `Thank you for your payment of ${formatINR(last.amount)} for “${n}”, recorded on ${dayLabel(last.date)}.`, hi: `“${n}” के लिए ${dayLabel(last.date)} को दर्ज ${formatINR(last.amount)} के भुगतान के लिए धन्यवाद।`, hinglish: `“${n}” ke liye ${dayLabel(last.date)} ko record hue ${formatINR(last.amount)} payment ke liye thank you.` }[lang]);
      body.push(c.outstanding > 0 ? { en: `The remaining balance is ${out}.`, hi: `शेष राशि ${out} है।`, hinglish: `Remaining balance ${out} hai.` }[lang] : { en: "Your payments for this project are complete.", hi: "इस प्रोजेक्ट का भुगतान पूरा हो गया है।", hinglish: "Is project ka payment complete ho gaya hai." }[lang]);
      break; }
  }
  const greet = `${({ en: ["Hi", "Hello"], hi: ["नमस्ते", "नमस्कार"], hinglish: ["Hi", "Namaste"] })[lang][variant % 2]} ${c.firstName}${lang === "hi" ? " जी" : ""},`;
  const end = tone === "friendly" ? ({ en: ["Thanks so much!", "Happy to help with anything!"], hi: ["बहुत धन्यवाद!", "कोई सवाल हो तो बताइए!"], hinglish: ["Thanks a lot!", "Koi bhi sawaal ho toh batayein!"] })[lang][variant % 2]! : ({ en: "Thank you.", hi: "धन्यवाद।", hinglish: "Thank you." })[lang];
  const text = tone === "short" ? `${greet} ${body.join(" ")}` : [greet, body.join(" "), end].join("\n\n");
  return { text, blocked: false, simulated: true, label: FINANCE_DEMO_LABEL, contextUsed: used, notices };
}

const nums = (s: string) => [...s.replace(/(\d),(?=\d)/g, "$1").matchAll(/\d+/g)].map((m) => m[0]);
/** Content protection for the Owner's final reminder text. Non-empty = Use Suggestion is blocked. */
export function reminderViolations(c: DealFinanceContext, original: string, text: string): string[] {
  const out: string[] = [];
  const fresh = (rx: RegExp) => rx.test(text) && !rx.test(original);
  const allowed = new Set([...nums([dealFacts(c).join(" "), ...c.milestones.map((m) => `${m.amount} ${dayLabel(m.dueDate)}`), ...c.validPayments.map((p) => `${formatINR(p.amount)} ${dayLabel(p.date)}`), c.dealName, original].join(" "))]);
  const extra = nums(text).filter((x) => !allowed.has(x));
  if (extra.length) out.push(`Changes or adds amounts/dates not in the records: ${[...new Set(extra)].slice(0, 5).join(", ")}.`);
  if (fresh(/\bdiscount|\boff\b.*%|\bwaive|छूट|\bconcession/i)) out.push("Offers a discount or waiver — not recorded.");
  if (fresh(/\b(late fee|penalt|interest|legal action|lawyer|court|consequences)|जुर्माना|कानूनी/i)) out.push("Mentions late fees, penalties or legal action — reminders must stay polite.");
  if (fresh(/\brefund|money back|रिफंड/i)) out.push("Promises a refund — not authorised in the records.");
  if (fresh(/\b(immediately|right now|final warning|last chance|or else)\b/i)) out.push("Sounds threatening or pressuring.");
  if (fresh(/\b(tomorrow|today|tonight|next week|this week|end of (the )?(day|week|month))\b|\b(kal|aaj)\b|(^|\s)(कल|आज)(\s|$)/i)) out.push("Adds a deadline that isn't a recorded date.");
  if (c.outstanding > 0 && /\b(fully paid|paid in full|payment (is )?complete|no (balance|dues?) (is )?(pending|remaining)|nothing (is )?(pending|due))\b|भुगतान पूरा|payment complete/i.test(text)) out.push(`Says the deal is fully paid — ${formatINR(c.outstanding)} is still outstanding.`);
  if (c.received === 0 && /\b(received|thank you for (your )?payment)\b|प्राप्त|धन्यवाद.*भुगतान/i.test(text) && !/\breceived\b/i.test(original)) out.push("Says a payment was received — none is recorded.");
  if (c.outstanding <= 0 && /\b(pending|outstanding|due|remaining balance)\b|बकाया|शेष/i.test(text)) out.push("Asks for a balance on a fully paid deal.");
  if (!c.overdue && fresh(/\boverdue\b|\blate\b|\bdelayed payment\b/i)) out.push("Calls the payment overdue — no recorded due date has passed.");
  if (!text.toLowerCase().includes(c.firstName.toLowerCase())) out.push(`Drops the client's name (${c.firstName}).`);
  return out;
}

export const demoFinanceAssistProvider: FinanceAssistProvider = { reminder: async (r) => { await new Promise((x) => setTimeout(x, 120)); return demoReminder(r); } };
/** Swap point for the future secure server endpoint (server must authorise, minimise data and compute figures deterministically). */
export const getFinanceAssistProvider = (): FinanceAssistProvider => demoFinanceAssistProvider;
