// Pure WhatsApp composer rules: number validation, deterministic drafts, link building.
// No external AI and no invented details — drafts only use data present on the lead.
import type { Lead } from "./types";
import { formatINR } from "./format";

export type WaPurpose = "followup" | "quotation" | "samples" | "custom";
export const WA_PURPOSES: WaPurpose[] = ["followup", "quotation", "samples", "custom"];
export const WA_LABEL: Record<WaPurpose, string> = { followup: "Follow-up", quotation: "Quotation", samples: "Samples / Demos", custom: "Custom message" };

/** International WhatsApp number (91XXXXXXXXXX) for an Indian mobile, or null when it can't be trusted. */
export function waNumber(phone: string | undefined): string | null {
  const d = (phone ?? "").replace(/\D/g, "");
  const local = d.length === 10 ? d : d.length === 11 && d.startsWith("0") ? d.slice(1) : d.length === 12 && d.startsWith("91") ? d.slice(2) : null;
  return local && /^[6-9]\d{9}$/.test(local) ? `91${local}` : null;
}

export const waLink = (number: string, text: string) => `https://wa.me/${number}?text=${encodeURIComponent(text)}`;

export interface DraftContext { owner: string; business: string; dealName?: string | undefined; assets?: { label: string; url: string }[] }

/** Deterministic draft. Missing data is left out — never a placeholder, price or promise that isn't recorded. */
export function draftMessage(purpose: WaPurpose, lead: Pick<Lead, "name" | "company" | "requirement" | "quotedAmount">, ctx: DraftContext): string {
  if (purpose === "custom") return "";
  const first = lead.name.trim().split(/\s+/)[0] || lead.name;
  const project = ctx.dealName || lead.requirement?.trim();
  const about = project ? ` about ${project}` : "";
  const forCo = lead.company ? ` for ${lead.company}` : "";
  const hi = `Hi ${first}, this is ${ctx.owner} from ${ctx.business}.`;
  const links = (ctx.assets ?? []).map((a) => `• ${a.label}: ${a.url}`).join("\n");
  if (purpose === "followup") return `${hi} Just following up on our conversation${about}. Would you have a few minutes today or tomorrow to discuss the next steps?`;
  if (purpose === "quotation") {
    const amt = lead.quotedAmount ? ` The quoted amount is ${formatINR(lead.quotedAmount)}.` : "";
    return `${hi} I'm reaching out regarding the quotation${project ? ` for ${project}` : ""}${forCo}.${amt} Happy to walk you through what's included or answer any questions.${links ? `\n\n${links}` : ""}`;
  }
  return `${hi} Sharing some website samples${project ? ` relevant to ${project}` : ""}${forCo}.${links ? `\n\n${links}` : ""}\n\nLet me know which style you like and we can take it from there.`;
}
