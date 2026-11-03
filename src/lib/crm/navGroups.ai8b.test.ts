import { describe, expect, it } from "vitest";
import { NAV_GROUPS, effectiveOpen, groupForPath, parseOpenGroups, toggleGroup, visibleGroups } from "./navGroups";
import { routeAllowed } from "./session";

describe("AI-8B sidebar groups", () => {
  it("every page appears in exactly one group", () => {
    const all = NAV_GROUPS.flatMap(g => g.items);
    expect(new Set(all).size).toBe(all.length);
    expect(all).toHaveLength(20);
  });
  it("toggles groups independently", () => {
    expect(toggleGroup(["workspace", "business"], "business")).toEqual(["workspace"]);
    expect(toggleGroup(["workspace"], "owner")).toEqual(["workspace", "owner"]);
  });
  it("deep link exposes the containing group", () => {
    expect(groupForPath("/leads/abc")).toBe("workspace");
    expect(effectiveOpen([], "/data-vault")).toEqual(["admin"]);
    expect(effectiveOpen(["admin"], "/data-vault")).toEqual(["admin"]);
  });
  it("invalid stored preferences never break navigation", () => {
    expect(parseOpenGroups("not json")).toHaveLength(NAV_GROUPS.length);
    expect(parseOpenGroups('{"a":1}')).toHaveLength(NAV_GROUPS.length);
    expect(parseOpenGroups('["owner","ghost",3,"owner"]')).toEqual(["owner"]);
    expect(parseOpenGroups("[]")).toEqual([]);
  });
  it("Owner sees admin links; regrouping grants no new access", () => {
    expect(visibleGroups(to => routeAllowed(null, to)).map(g => g.id)).toContain("admin");
    expect(visibleGroups(() => false)).toEqual([]);
  });
});

describe("AI-9A: corrupted open-group preference", () => {
  it("a list containing only unknown or non-text entries recovers to all six groups open", () => {
    expect(parseOpenGroups('["nope",5]')).toHaveLength(6);
  });
  it("an empty list (user closed every group) stays empty", () => {
    expect(parseOpenGroups("[]")).toEqual([]);
  });
});
