/** URL search for /leads. from/to are India business days (YYYY-MM-DD) from Analytics drill-downs; never persisted into views. */
export interface LeadsSearch { view?: string; from?: string; to?: string; src?: string }
const ymd = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);
export function parseLeadsSearch(s: Record<string, unknown>): LeadsSearch {
  const out: LeadsSearch = {};
  if (typeof s["view"] === "string" && s["view"]) out.view = s["view"];
  const f = ymd(s["from"]), t = ymd(s["to"]); if (f) out.from = f; if (t) out.to = t;
  if (typeof s["src"] === "string" && s["src"]) out.src = s["src"];
  return out;
}
/** Leads created within [from, to] (inclusive India days) and, if given, from that source. */
export function matchesCreatedRange(createdDay: string, source: string, q: LeadsSearch): boolean {
  return (!q.from || createdDay >= q.from) && (!q.to || createdDay <= q.to) && (!q.src || source === q.src);
}
