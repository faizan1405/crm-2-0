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
/** Stage-tab counts for an already-filtered lead set ("all" = total). Same set the list shows, so counts never disagree with rows. */
export function countByStage(leads: { status: string }[]): Record<string, number> {
  const m: Record<string, number> = { all: leads.length };
  for (const l of leads) m[l.status] = (m[l.status] ?? 0) + 1;
  return m;
}
