// Sidebar group organisation and expand/collapse preferences (UI only — never CRM data).
export const NAV_GROUPS = [
  { id: "workspace", label: "Workspace", items: ["/", "/inbox", "/leads", "/pipeline", "/follow-ups", "/ai-copilot"] },
  { id: "business", label: "Business", items: ["/deals", "/projects", "/sales-studio"] },
  { id: "personal", label: "Personal", items: ["/notes", "/my-performance"] },
  { id: "owner", label: "Owner", items: ["/analytics", "/daily-briefing", "/team-performance", "/team-activity"] },
  { id: "admin", label: "Owner admin", items: ["/team", "/automation", "/crm-config", "/data-vault"] },
  { id: "system", label: "System", items: ["/settings"] },
] as const;
export type GroupId = (typeof NAV_GROUPS)[number]["id"];
export const GROUPS_KEY = "scale-flow-sidebar-groups";
const IDS = NAV_GROUPS.map(g => g.id) as readonly string[];

export const navMatches = (path: string, to: string) => to === "/" ? path === "/" : path === to || path.startsWith(`${to}/`) || (to === "/leads" && path.startsWith("/leads"));

/** Group containing the current page (deep links). */
export const groupForPath = (path: string): GroupId | null => NAV_GROUPS.find(g => g.items.some(to => navMatches(path, to)))?.id ?? null;

/** Parse stored preference; anything invalid falls back to all groups open. */
export function parseOpenGroups(raw: string | null): GroupId[] {
  if (!raw) return [...IDS] as GroupId[];
  try {
    const v: unknown = JSON.parse(raw);
    if (!Array.isArray(v)) return [...IDS] as GroupId[];
    return [...new Set(v.filter((x): x is GroupId => typeof x === "string" && IDS.includes(x)))];
  } catch { return [...IDS] as GroupId[]; }
}

/** Open groups, always exposing the active page's group. */
export const effectiveOpen = (open: readonly GroupId[], path: string): GroupId[] => {
  const g = groupForPath(path);
  return g && !open.includes(g) ? [...open, g] : [...open];
};

export const toggleGroup = (open: readonly GroupId[], id: GroupId): GroupId[] => open.includes(id) ? open.filter(x => x !== id) : [...open, id];

/** Permission filter applied before rendering; groups with no allowed items disappear. */
export function visibleGroups(allowed: (to: string) => boolean) {
  return NAV_GROUPS.map(g => ({ ...g, items: g.items.filter(allowed) })).filter(g => g.items.length > 0);
}
