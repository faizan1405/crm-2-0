import { describe, expect, it } from "vitest";
import { groupByStage, PIPE_BATCH, visibleCards } from "./pipeline";
import { LEAD_STATUSES, type Lead } from "./types";

const mk = (n: number, status: Lead["status"] = "new") => Array.from({ length: n }, (_, i) => ({ id: `L${i}`, status, quotedAmount: n - i } as Lead));

describe("pipeline progressive rendering", () => {
  it("mounts only 40 cards initially but counts all", () => {
    const col = mk(700); const v = visibleCards(col, PIPE_BATCH);
    expect(PIPE_BATCH).toBe(40); expect(v.shown).toHaveLength(40); expect(v.hidden).toBe(660); expect(col).toHaveLength(700);
  });
  it("show more reveals the next batch without duplicates", () => {
    const v = visibleCards(mk(700), PIPE_BATCH * 2);
    expect(v.shown).toHaveLength(80); expect(new Set(v.shown.map((c) => c.id)).size).toBe(80);
    expect(v.shown[40]!.id).toBe("L40");
  });
  it("keeps a dragged or selected card beyond the batch mounted, once", () => {
    const v = visibleCards(mk(700), 40, ["L699", "L699", "L3", null]);
    expect(v.shown).toHaveLength(41); expect(v.shown.at(-1)!.id).toBe("L699"); expect(v.hidden).toBe(659);
  });
  it("groups every lead into exactly its stage", () => {
    const leads = [...mk(5, "new"), ...mk(3, "won").map((l) => ({ ...l, id: `W${l.id}` }))];
    const g = groupByStage(leads, LEAD_STATUSES);
    expect(g.get("new")).toHaveLength(5); expect(g.get("won")).toHaveLength(3);
    expect([...g.values()].reduce((a, c) => a + c.length, 0)).toBe(8);
    expect(g.get("new")![0]!.quotedAmount).toBe(5);
  });
});
