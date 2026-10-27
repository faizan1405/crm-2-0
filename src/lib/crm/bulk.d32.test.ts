import { describe, expect, it } from "vitest";
import { selectMatching, selectedIds, selectionScopeKey, toggle } from "./bulk";

const f = (o: Record<string, string | undefined>) => selectionScopeKey({ q: "", status: "all", tagF: "all", view: undefined, ...o });
describe("D3.2 Leads selection scope", () => {
  it("changing the tag filter changes the selection scope", () => { expect(f({ tagF: "tagA" })).not.toBe(f({ tagF: "tagB" })); });
  it("clearing the tag filter changes the selection scope", () => { expect(f({ tagF: "tagA" })).not.toBe(f({ tagF: "all" })); });
  it("switching saved views changes the selection scope", () => { expect(f({ view: "v1" })).not.toBe(f({ view: "v2" })); });
  it("matching selection minus an exclusion yields exactly the remaining ids", () => {
    const ids = Array.from({ length: 60 }, (_, i) => `A${i}`);
    const sel = toggle(selectMatching(ids, "tag A"), "A3", false);
    const out = selectedIds(sel);
    expect(out).toHaveLength(59); expect(out).not.toContain("A3"); expect(new Set(out)).toEqual(new Set(ids.filter((x) => x !== "A3")));
  });
});
