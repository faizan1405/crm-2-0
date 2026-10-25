import { describe, it, expect } from "vitest";
import { cardSignals, stageSince } from "./pipeline";
import type { FollowUp, Lead, LeadActivity } from "./types";

// Indexed lookups must give exactly what a full scan gives (D1 large-data optimization).
const now = new Date("2026-10-25T06:00:00Z");
const leads: Lead[] = Array.from({ length: 300 }, (_, i) => ({ id: `l${i}`, name: `L${i}`, phone: "1", source: "Website", status: (["new", "contacted", "proposal"] as const)[i % 3], priority: "warm", createdAt: `2026-10-${String(1 + (i % 20)).padStart(2, "0")}T00:00:00Z`, updatedAt: "2026-10-01T00:00:00Z", quotedAmount: i * 500 }) as Lead);
const acts: LeadActivity[] = leads.flatMap((l, i): LeadActivity[] => (i % 2 ? [{ id: `a${i}`, leadId: l.id, type: "status", text: "", at: `2026-10-${String(5 + (i % 15)).padStart(2, "0")}T00:00:00Z` }, { id: `b${i}`, leadId: l.id, type: "status", text: "", at: "2026-10-02T00:00:00Z" }] : [{ id: `c${i}`, leadId: l.id, type: "call", text: "", at: "2026-10-20T00:00:00Z" }]));
const fus: FollowUp[] = leads.flatMap((l, i): FollowUp[] => [{ id: `f${i}`, leadId: l.id, type: "call", dueAt: `2026-10-${String(10 + (i % 18)).padStart(2, "0")}T00:00:00Z` }, { id: `g${i}`, leadId: l.id, type: "call", dueAt: "2026-10-01T00:00:00Z", ...(i % 3 ? { completedAt: "x" } : {}) }]);
const naiveSince = (l: Lead) => acts.filter((a) => a.leadId === l.id && a.type === "status").reduce<string | null>((m, a) => (!m || a.at > m ? a.at : m), null) ?? (l.status === "new" ? l.createdAt : null);

describe("pipeline signals at scale", () => {
  it("stage entry time matches a full scan for every lead", () => {
    for (const l of leads) expect(stageSince(l, acts)).toBe(naiveSince(l));
  });
  it("next due follow-up skips completed ones and picks the earliest pending", () => {
    expect(cardSignals(leads[1]!, acts, fus, now).nextDue).toBe("2026-10-11T00:00:00Z");
    expect(cardSignals(leads[0]!, acts, fus, now).nextDue).toBe("2026-10-01T00:00:00Z");
  });
  it("a new follow-up list is re-indexed, never served from a stale cache", () => {
    const before = cardSignals(leads[1]!, acts, fus, now).nextDue;
    const next = [...fus, { id: "z", leadId: "l1", type: "call" as const, dueAt: "2026-09-01T00:00:00Z" }];
    expect(cardSignals(leads[1]!, acts, next, now).nextDue).toBe("2026-09-01T00:00:00Z");
    expect(before).toBe("2026-10-11T00:00:00Z");
  });
});
