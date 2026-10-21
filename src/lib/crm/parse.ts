// DEMO ONLY parser for Quick AI Entry. Deterministic, rule-based, never invents data.
// Integration point: replace `structureLead` with a call to a real AI service.
import { LEAD_SOURCES, type LeadSource } from "./types";

export interface ParsedLead {
  name?: string;
  phone?: string;
  email?: string;
  company?: string;
  requirement?: string;
  budget?: number;
  quotedAmount?: number;
  source?: LeadSource;
  followUpHint?: string; // raw phrase — always needs manual confirmation
  notes: string;
}

function amount(raw: string): number {
  const m = raw.toLowerCase().replace(/[,₹\s]|rs\.?|inr/g, "");
  const n = parseFloat(m);
  if (/k$/.test(m)) return Math.round(n * 1000);
  if (/(l|lakh|lac)s?$/.test(m)) return Math.round(n * 100000);
  return Math.round(n);
}

const AMT = "((?:rs\\.?|inr|₹)?\\s*[\\d,]+(?:\\.\\d+)?\\s*(?:k|l|lakh|lac)?)";

export function structureLead(text: string): ParsedLead {
  const out: ParsedLead = { notes: text.trim() };
  const phone = text.match(/(?:\+?91[\s-]?)?([6-9]\d{4}[\s-]?\d{5})/);
  if (phone) out.phone = phone[1]!.replace(/\D/g, "");
  const email = text.match(/[\w.+-]+@[\w-]+\.[\w.]+/);
  if (email) out.email = email[0];
  const budget = text.match(new RegExp(`budget(?:\\s+(?:is|of|around|approx))?\\s*[:\\-]?\\s*${AMT}`, "i"));
  if (budget) out.budget = amount(budget[1]!);
  const quoted = text.match(new RegExp(`quot(?:ed|e)(?:\\s+(?:at|of|is))?\\s*[:\\-]?\\s*${AMT}`, "i"));
  if (quoted) out.quotedAmount = amount(quoted[1]!);
  const first = text.split(/[,\n]/)[0]!.trim();
  if (/^[A-Za-z][A-Za-z.' ]{1,40}$/.test(first) && first.split(/\s+/).length <= 4) out.name = first.replace(/\b\w/g, (c) => c.toUpperCase());
  const company = text.match(/(?:from|of|at|company[:\s]+)\s+([A-Z][\w&'.]*(?:\s+[A-Z][\w&'.]*){0,3})/);
  if (company) out.company = company[1]!.trim();
  const req = text.match(/(?:wants|needs|looking for|requires|interested in)\s+(?:a\s+|an\s+)?([^,.\n]+)/i);
  if (req) out.requirement = req[1]!.trim().replace(/^\w/, (c) => c.toUpperCase());
  const src = LEAD_SOURCES.find((s) => s !== "Other" && new RegExp(`\\b${s}\\b`, "i").test(text));
  if (src) out.source = src;
  const fu = text.match(/follow[\s-]?up\s+([^,.\n]+)/i);
  if (fu) out.followUpHint = fu[1]!.trim();
  return out;
}
