// Phase 3G — Custom fields, Lead tags and Saved Views (pure, backend-agnostic).
// Stable ids are the keys everywhere; labels are display text only. Values live in a separate
// map keyed by lead id → field id, so the core Lead schema never changes. Visibility helpers are
// a UI simulation: the future Hostinger backend must enforce field- and record-level access itself.
import type { FollowUp, Lead, LeadActivity } from "./types";
import { LEAD_SOURCES, LEAD_STATUSES, STATUS_LABEL } from "./types";
import { QUICK_LABEL, QUICK_STATUSES } from "./leadtools";
import { contactState, type ContactState } from "./automation";
import type { Assignment } from "./access";
import { dayKey } from "./format";

export const CUSTOMIZE_SCHEMA = 1;

/* ============================== custom fields ============================== */
export type FieldType = "text" | "longtext" | "number" | "currency" | "date" | "checkbox" | "select" | "multiselect" | "url" | "email" | "phone";
export const FIELD_TYPES: { id: FieldType; label: string; hint: string }[] = [
  { id: "text", label: "Short text", hint: "A name, a word or a short line." },
  { id: "longtext", label: "Long text", hint: "A paragraph of notes." },
  { id: "number", label: "Number", hint: "Any number, e.g. pages needed." },
  { id: "currency", label: "Currency", hint: "An amount of money in rupees." },
  { id: "date", label: "Date", hint: "A calendar day (no time)." },
  { id: "checkbox", label: "Yes / No", hint: "A simple tick box." },
  { id: "select", label: "Single choice", hint: "Pick one option from a list." },
  { id: "multiselect", label: "Multiple choice", hint: "Pick several options." },
  { id: "url", label: "Website link", hint: "An http(s) web address." },
  { id: "email", label: "Email", hint: "An email address." },
  { id: "phone", label: "Phone number", hint: "A phone number." },
];
export const FIELD_TYPE_LABEL = Object.fromEntries(FIELD_TYPES.map((t) => [t.id, t.label])) as Record<FieldType, string>;

export interface FieldOption { id: string; label: string; archived?: boolean }
export interface Money { amount: number; currency: string }
export type FieldValue = string | number | boolean | string[] | Money;
export type FieldAccess = "team" | "owner";
export interface FieldHistory { at: string; change: string }
export interface CustomFieldDef {
  id: string; entity: "lead"; label: string; type: FieldType; description?: string | undefined;
  required: boolean; defaultValue?: FieldValue | undefined; options: FieldOption[]; order: number;
  status: "active" | "archived"; highlight: boolean;
  /** Who may see / edit values. "owner" = sensitive, never sent to employees. */
  visibility: FieldAccess; editable: FieldAccess;
  currency?: string | undefined; createdAt: string; updatedAt: string; version: number; history: FieldHistory[];
}
export type FieldValues = Record<string, Record<string, FieldValue>>; // leadId → fieldId → value

/** Built-in lead fields and filter keys can never be used as custom field ids. */
export const RESERVED_IDS = ["id", "name", "phone", "email", "company", "requirement", "source", "status", "stage", "priority", "assignee", "assigned", "created", "createdAt", "updatedAt", "lastContact", "nextFollowUp", "quickStatus", "tags", "notes", "pinned", "budget", "quotedAmount", "search", "inbox", "contact", "followupDue"];

const slug = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);
/** Stable internal id from a label: `cf_<slug>`, never reused. Renaming later never changes it. */
export function fieldIdFor(label: string, taken: string[]): string {
  const base = `cf_${slug(label) || "field"}`; let id = base, n = 2;
  while (taken.includes(id)) id = `${base}_${n++}`;
  return id;
}
export const optionIdFor = (label: string, taken: string[]) => { const base = `opt_${slug(label) || "option"}`; let id = base, n = 2; while (taken.includes(id)) id = `${base}_${n++}`; return id; };

export function emptyField(order: number): CustomFieldDef {
  return { id: "", entity: "lead", label: "", type: "text", required: false, options: [], order, status: "active", highlight: false, visibility: "team", editable: "team", createdAt: "", updatedAt: "", version: 0, history: [] };
}
const isChoice = (t: FieldType) => t === "select" || t === "multiselect";

export function fieldDefError(def: CustomFieldDef, all: CustomFieldDef[]): string | null {
  if (!def.label.trim()) return "Give the field a name.";
  if (def.label.trim().length > 60) return "Keep the name under 60 characters.";
  if (!/^cf_[a-z0-9_]+$/.test(def.id) || RESERVED_IDS.includes(def.id)) return "This internal id is reserved or invalid.";
  if (all.some((f) => f.id !== def.id && f.status === "active" && f.label.trim().toLowerCase() === def.label.trim().toLowerCase())) return "Another active field already uses this name.";
  if (RESERVED_IDS.map((x) => x.toLowerCase()).includes(def.label.trim().toLowerCase().replace(/\s+/g, ""))) return "That name belongs to a built-in field.";
  if (isChoice(def.type)) {
    const live = def.options.filter((o) => !o.archived);
    if (!live.length) return "Add at least one option.";
    if (live.some((o) => !o.label.trim())) return "Options can't be blank.";
    const labels = live.map((o) => o.label.trim().toLowerCase());
    if (new Set(labels).size !== labels.length) return "Two options have the same name.";
  }
  if (def.visibility === "owner" && def.editable === "team") return "Employees can't edit a field they can't see.";
  if (def.defaultValue !== undefined) { const r = parseValue(def, def.defaultValue); if (!r.ok) return `Default value: ${r.error}`; }
  return null;
}

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
export function validDate(s: string): boolean {
  const m = DATE.exec(s); if (!m) return false;
  const d = new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!));
  return d.getUTCFullYear() === +m[1]! && d.getUTCMonth() === +m[2]! - 1 && d.getUTCDate() === +m[3]!;
}
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const empty = (raw: unknown) => raw === undefined || raw === null || (typeof raw === "string" && !raw.trim()) || (Array.isArray(raw) && !raw.length);

/** Type-aware validation. Empty input → `value: undefined` (required-ness is checked separately). Never coerces silently. */
export function parseValue(def: Pick<CustomFieldDef, "type" | "options" | "currency" | "label">, raw: unknown): { ok: true; value: FieldValue | undefined } | { ok: false; error: string } {
  if (def.type === "checkbox") { if (raw === undefined || raw === null || raw === "") return { ok: true, value: undefined }; return typeof raw === "boolean" ? { ok: true, value: raw } : { ok: false, error: "Choose yes or no." }; }
  if (empty(raw)) return { ok: true, value: undefined };
  const str = typeof raw === "string" ? raw.trim() : undefined;
  const live = new Set(def.options.filter((o) => !o.archived).map((o) => o.id));
  switch (def.type) {
    case "text": return str !== undefined ? (str.length <= 200 ? { ok: true, value: str } : { ok: false, error: "Keep it under 200 characters." }) : { ok: false, error: "Enter text." };
    case "longtext": return str !== undefined ? (str.length <= 5000 ? { ok: true, value: str } : { ok: false, error: "Keep it under 5,000 characters." }) : { ok: false, error: "Enter text." };
    case "number": { const n = typeof raw === "number" ? raw : str !== undefined && /^-?\d+(\.\d+)?$/.test(str.replace(/,/g, "")) ? Number(str.replace(/,/g, "")) : NaN; return Number.isFinite(n) ? { ok: true, value: n } : { ok: false, error: "Enter a number." }; }
    case "currency": {
      const amt = typeof raw === "object" && raw && "amount" in raw ? (raw as Money).amount : typeof raw === "number" ? raw : str !== undefined && /^\d+(\.\d{1,2})?$/.test(str.replace(/[₹,\s]/g, "")) ? Number(str.replace(/[₹,\s]/g, "")) : NaN;
      if (!Number.isFinite(amt) || amt < 0) return { ok: false, error: "Enter an amount of zero or more." };
      return { ok: true, value: { amount: Math.round(amt * 100) / 100, currency: (typeof raw === "object" && raw && "currency" in raw ? (raw as Money).currency : def.currency) || "INR" } };
    }
    case "date": return str !== undefined && validDate(str) ? { ok: true, value: str } : { ok: false, error: "Pick a valid date." };
    case "select": return str !== undefined && live.has(str) ? { ok: true, value: str } : { ok: false, error: "Pick one of the listed options." };
    case "multiselect": {
      if (!Array.isArray(raw) || raw.some((x) => typeof x !== "string")) return { ok: false, error: "Pick from the listed options." };
      const ids = [...new Set(raw as string[])];
      return ids.every((x) => live.has(x)) ? { ok: true, value: ids } : { ok: false, error: "One of the chosen options no longer exists." };
    }
    case "url": { if (str === undefined || /\s/.test(str)) return { ok: false, error: "Enter a web address." }; try { const u = new URL(/^https?:\/\//i.test(str) ? str : `https://${str}`); return (u.protocol === "https:" || u.protocol === "http:") && u.hostname.includes(".") ? { ok: true, value: u.toString() } : { ok: false, error: "Enter a valid web address." }; } catch { return { ok: false, error: "Enter a valid web address." }; } }
    case "email": return str !== undefined && EMAIL.test(str) ? { ok: true, value: str.toLowerCase() } : { ok: false, error: "Enter a valid email address." };
    case "phone": { const d = (str ?? "").replace(/[\s()-]/g, ""); return /^\+?\d{7,15}$/.test(d) ? { ok: true, value: d } : { ok: false, error: "Enter 7–15 digits, optionally starting with +." }; }
  }
}

export function displayValue(def: CustomFieldDef, v: FieldValue | undefined): string {
  if (v === undefined) return "—";
  const opt = (id: string) => def.options.find((o) => o.id === id)?.label ?? "Removed option";
  switch (def.type) {
    case "checkbox": return v ? "Yes" : "No";
    case "select": return opt(String(v));
    case "multiselect": return (v as string[]).map(opt).join(", ") || "—";
    case "currency": { const m = v as Money; return m.currency === "INR" ? `₹${m.amount.toLocaleString("en-IN")}` : `${m.currency} ${m.amount}`; }
    case "date": { const s = String(v); const [y, mo, d] = s.split("-"); return validDate(s) ? `${d} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][+mo! - 1]} ${y}` : s; }
    default: return String(v);
  }
}

export const activeFields = (defs: CustomFieldDef[]) => defs.filter((f) => f.status === "active").sort((a, b) => a.order - b.order);

/**
 * Validate a lead's values. New leads must satisfy every required field. When editing an existing lead,
 * a missing required value only blocks if it was the field being cleared; otherwise it is returned as
 * `needs` so the lead stays usable and the gap is flagged (no fake defaults are ever written).
 */
export function validateLeadValues(defs: CustomFieldDef[], input: Record<string, unknown>, opts: { isNew: boolean; previous?: Record<string, FieldValue> | undefined }) {
  const errors: Record<string, string> = {}; const values: Record<string, FieldValue | undefined> = {}; const needs: string[] = [];
  for (const def of activeFields(defs)) {
    if (!(def.id in input)) { if (def.required && opts.previous?.[def.id] === undefined) (opts.isNew ? (errors[def.id] = "Required.") : needs.push(def.id)); continue; }
    const r = parseValue(def, input[def.id]);
    if (!r.ok) { errors[def.id] = r.error; continue; }
    if (def.required && r.value === undefined) { if (opts.isNew || opts.previous?.[def.id] !== undefined) errors[def.id] = "Required."; else needs.push(def.id); continue; }
    values[def.id] = r.value;
  }
  return { errors, values, needs };
}

/** How many leads have a value for each field — the Owner's completion review. */
export function fieldCoverage(defs: CustomFieldDef[], leadIds: string[], values: FieldValues) {
  return Object.fromEntries(defs.map((d) => { const filled = leadIds.filter((id) => values[id]?.[d.id] !== undefined).length; return [d.id, { filled, missing: leadIds.length - filled }]; })) as Record<string, { filled: number; missing: number }>;
}
export const optionUsage = (fieldId: string, values: FieldValues) => {
  const out: Record<string, number> = {};
  for (const v of Object.values(values)) { const x = v[fieldId]; for (const id of Array.isArray(x) ? x : typeof x === "string" ? [x] : []) out[id] = (out[id] ?? 0) + 1; }
  return out;
};
export const valueCount = (fieldId: string, values: FieldValues) => Object.values(values).filter((v) => v[fieldId] !== undefined).length;

/** Convert a stored value to another type, or `undefined` when it can't be converted without guessing. */
export function convertValue(v: FieldValue, from: CustomFieldDef, to: CustomFieldDef): FieldValue | undefined {
  if (from.type === to.type) return v;
  const text = from.type === "currency" ? String((v as Money).amount) : from.type === "select" ? from.options.find((o) => o.id === v)?.label : typeof v === "string" || typeof v === "number" ? String(v) : undefined;
  if (to.type === "multiselect" && from.type === "select") return to.options.some((o) => o.id === v && !o.archived) ? [v as string] : undefined;
  if (to.type === "select") { const m = to.options.find((o) => !o.archived && (o.id === v || o.label.toLowerCase() === text?.toLowerCase())); return m?.id; }
  if (to.type === "checkbox" || from.type === "checkbox" || from.type === "multiselect" || text === undefined) return undefined;
  const r = parseValue(to, to.type === "currency" ? Number(text) : to.type === "number" && from.type === "currency" ? (v as Money).amount : text);
  return r.ok ? r.value : undefined;
}
/** Impact preview before changing a field's type: nothing is converted unless every value converts cleanly. */
export function typeChangeImpact(from: CustomFieldDef, to: CustomFieldDef, values: FieldValues) {
  let convertible = 0; const incompatible: string[] = [];
  for (const [leadId, v] of Object.entries(values)) { const x = v[from.id]; if (x === undefined) continue; if (convertValue(x, from, to) === undefined) incompatible.push(leadId); else convertible++; }
  return { convertible, incompatible };
}

/** Options that were removed in an edit but are still stored on leads — must be archived, not deleted. */
export function removedUsedOptions(prev: CustomFieldDef, next: CustomFieldDef, values: FieldValues) {
  const used = optionUsage(prev.id, values);
  return prev.options.filter((o) => !o.archived && used[o.id] && !next.options.some((n) => n.id === o.id && !n.archived)).map((o) => ({ ...o, count: used[o.id]! }));
}

/* ================================ viewers ================================ */
export type Viewer = { owner: true } | { owner: false; employeeId: string; canEdit: boolean };
export const OWNER_VIEWER: Viewer = { owner: true };
export const fieldVisible = (def: CustomFieldDef, v: Viewer) => v.owner || def.visibility === "team";
export const fieldEditable = (def: CustomFieldDef, v: Viewer) => v.owner || (def.visibility === "team" && def.editable === "team" && v.canEdit);
/** Remove sensitive definitions and their values — what an employee working copy (or backend response) may contain. */
export function scopeCustomization(defs: CustomFieldDef[], values: FieldValues, leadIds: Set<string>, v: Viewer) {
  const seen = defs.filter((d) => fieldVisible(d, v)); const ok = new Set(seen.map((d) => d.id));
  const vals: FieldValues = {};
  for (const [id, row] of Object.entries(values)) if (leadIds.has(id)) vals[id] = Object.fromEntries(Object.entries(row).filter(([k]) => ok.has(k)));
  return { customFields: seen, fieldValues: vals };
}

/* ================================== tags ================================== */
export const TAG_COLORS = ["graphite", "green", "amber", "rose", "sky", "violet"] as const;
export type TagColor = (typeof TAG_COLORS)[number];
export interface TagDef { id: string; name: string; description?: string | undefined; color: TagColor; status: "active" | "archived"; createdAt: string; updatedAt: string }
export type LeadTags = Record<string, string[]>; // leadId → tag ids
export function tagError(t: Pick<TagDef, "id" | "name">, all: TagDef[]): string | null {
  if (!t.name.trim()) return "Give the tag a name.";
  if (t.name.trim().length > 32) return "Keep tag names under 32 characters.";
  if (all.some((x) => x.id !== t.id && x.status === "active" && x.name.trim().toLowerCase() === t.name.trim().toLowerCase())) return "A tag with this name already exists.";
  return null;
}
export const tagIdFor = (name: string, taken: string[]) => { const base = `tag_${slug(name) || "tag"}`; let id = base, n = 2; while (taken.includes(id)) id = `${base}_${n++}`; return id; };
export const sameTags = (a: string[] | undefined, b: string[] | undefined) => { const x = [...(a ?? [])].sort(), y = [...(b ?? [])].sort(); return x.length === y.length && x.every((v, i) => v === y[i]); };

/** Bulk add/remove one tag. Other tags are never touched. Returns the before-snapshot and applied values for a safe Undo. */
export function bulkTag(current: LeadTags, ids: string[], tagId: string, mode: "add" | "remove") {
  const next = { ...current }; const before: Record<string, string[] | undefined> = {}; const applied: Record<string, string[]> = {};
  for (const id of new Set(ids)) {
    const cur = current[id] ?? []; const has = cur.includes(tagId);
    if ((mode === "add" && has) || (mode === "remove" && !has)) continue;
    const val = mode === "add" ? [...cur, tagId] : cur.filter((t) => t !== tagId);
    before[id] = current[id]; applied[id] = val; next[id] = val;
  }
  return { next, before, applied, changed: Object.keys(applied).length };
}
/** Undo only where the lead still has exactly what the bulk action set — newer changes win. */
export function undoTags(current: LeadTags, before: Record<string, string[] | undefined>, applied: Record<string, string[]>) {
  const next = { ...current }; let restored = 0, kept = 0;
  for (const id of Object.keys(applied)) {
    if (!sameTags(current[id], applied[id])) { kept++; continue; }
    const b = before[id]; if (b === undefined) delete next[id]; else next[id] = b; restored++;
  }
  return { next, restored, kept };
}

/* =============================== saved views =============================== */
export type ViewVisibility = "personal" | "shared" | "company";
export const VISIBILITY_LABEL: Record<ViewVisibility, string> = { personal: "Personal — only me", shared: "Shared — team members", company: "Company — Owner standard" };
export type Op = "is" | "is_not" | "any_of" | "contains" | "equals" | "gt" | "lt" | "between" | "before" | "after" | "on" | "within_days" | "today" | "overdue" | "yes" | "no" | "contains_any" | "contains_all" | "empty" | "not_empty";
export const OP_LABEL: Record<Op, string> = { is: "is", is_not: "is not", any_of: "is any of", contains: "contains", equals: "equals", gt: "greater than", lt: "less than", between: "between", before: "before", after: "after", on: "on", within_days: "in the last … days", today: "is today", overdue: "is overdue", yes: "is yes", no: "is no", contains_any: "contains any of", contains_all: "contains all of", empty: "is empty", not_empty: "is not empty" };
export interface ViewCondition { id: string; field: string; op: Op; value?: unknown }
export interface ViewFilter { mode: "and" | "or"; conditions: ViewCondition[] }
export type ViewSort = "recent" | "score" | "value" | "name" | "updated";
export interface SavedView {
  id: string; name: string; visibility: ViewVisibility; ownerId: string; filter: ViewFilter; sort: ViewSort; columns?: string[] | undefined;
  archived: boolean; schema: number; createdAt: string; updatedAt: string; version: number;
}
/** Per-user view preferences (pin / default) so shared views can be pinned without editing them. */
export type ViewPrefs = Record<string, { defaultId?: string | undefined; pinned: string[] }>;

export type FieldKind = "select" | "multi" | "date" | "text" | "number" | "bool";
export interface FilterField { key: string; label: string; kind: FieldKind; options?: { id: string; label: string }[]; archived?: boolean; ownerOnly?: boolean }
export const OPS_FOR: Record<FieldKind, Op[]> = {
  select: ["is", "is_not", "any_of", "empty", "not_empty"], multi: ["contains_any", "contains_all", "empty", "not_empty"],
  date: ["before", "after", "between", "on", "within_days", "empty", "not_empty"], text: ["contains", "equals", "empty", "not_empty"],
  number: ["gt", "lt", "between", "equals", "empty", "not_empty"], bool: ["yes", "no"],
};
const CONTACT_LABEL: Record<ContactState, string> = { none: "No attempt yet", outbound: "Message sent", attempted: "Called, not reached", established: "Contact established" };

export interface ViewCtx {
  assignments: Record<string, Assignment>; followUps: FollowUp[]; activities: LeadActivity[]; inboxMeta: Record<string, { reviewedAt?: string }>;
  fieldValues: FieldValues; leadTags: LeadTags; customFields: CustomFieldDef[]; tags: TagDef[]; employees: { id: string; name: string }[]; now: Date; viewer: Viewer;
}
/** Every field a view may filter on, for this viewer. Sensitive custom fields are absent for employees. */
export function filterFields(ctx: Pick<ViewCtx, "customFields" | "tags" | "employees" | "viewer">): FilterField[] {
  const sys: FilterField[] = [
    { key: "search", label: "Search text", kind: "text" },
    { key: "stage", label: "Pipeline stage", kind: "select", options: LEAD_STATUSES.map((s) => ({ id: s, label: STATUS_LABEL[s] })) },
    { key: "quick", label: "Quick status", kind: "select", options: QUICK_STATUSES.map((q) => ({ id: q, label: QUICK_LABEL[q] })) },
    { key: "priority", label: "Priority", kind: "select", options: [{ id: "hot", label: "Hot" }, { id: "warm", label: "Warm" }, { id: "cold", label: "Cold" }] },
    { key: "source", label: "Lead source", kind: "select", options: LEAD_SOURCES.map((s) => ({ id: s, label: s })) },
    { key: "assignee", label: "Assigned employee", kind: "select", options: [{ id: "__none", label: "Unassigned" }, ...ctx.employees.map((e) => ({ id: e.id, label: e.name }))] },
    { key: "created", label: "Created date", kind: "date" },
    { key: "lastContact", label: "Last contacted", kind: "date" },
    { key: "followupDue", label: "Follow-up due", kind: "date" },
    { key: "inbox", label: "Inbox review status", kind: "select", options: [{ id: "needs_review", label: "Needs review" }, { id: "reviewed", label: "Reviewed" }] },
    { key: "contact", label: "Contact attempt status", kind: "select", options: (Object.keys(CONTACT_LABEL) as ContactState[]).map((k) => ({ id: k, label: CONTACT_LABEL[k] })) },
    { key: "tags", label: "Tags", kind: "multi", options: ctx.tags.map((t) => ({ id: t.id, label: t.status === "archived" ? `${t.name} (archived)` : t.name })) },
  ];
  const kindOf = (t: FieldType): FieldKind => (t === "select" ? "select" : t === "multiselect" ? "multi" : t === "date" ? "date" : t === "number" || t === "currency" ? "number" : t === "checkbox" ? "bool" : "text");
  const cf = ctx.customFields.filter((d) => fieldVisible(d, ctx.viewer)).sort((a, b) => a.order - b.order).map((d): FilterField => ({ key: `cf:${d.id}`, label: d.label, kind: kindOf(d.type), ...(isChoice(d.type) ? { options: d.options.map((o) => ({ id: o.id, label: o.archived ? `${o.label} (archived)` : o.label })) } : {}), ...(d.status === "archived" ? { archived: true } : {}), ...(d.visibility === "owner" ? { ownerOnly: true } : {}) }));
  return [...sys, ...cf];
}

/** Problems that change a view's meaning. Invalid conditions match nothing (never silently broaden a view). */
export function viewIssues(view: Pick<SavedView, "filter">, ctx: Pick<ViewCtx, "customFields" | "tags" | "employees" | "viewer">): { conditionId: string; text: string }[] {
  const fields = new Map(filterFields(ctx).map((f) => [f.key, f]));
  const out: { conditionId: string; text: string }[] = [];
  for (const c of view.filter.conditions) {
    const f = fields.get(c.field);
    if (!f) { out.push({ conditionId: c.id, text: c.field.startsWith("cf:") ? "Uses a field that doesn't exist or isn't visible to you — this condition matches no leads." : "Uses an unknown filter." }); continue; }
    if (f.archived) out.push({ conditionId: c.id, text: `“${f.label}” is archived — the condition still uses its saved values.` });
    if (!OPS_FOR[f.kind].includes(c.op)) out.push({ conditionId: c.id, text: `“${f.label}” can't use “${OP_LABEL[c.op]}” any more — it matches no leads until edited.` });
    if (f.options && Array.isArray(c.value)) for (const v of c.value as string[]) { const o = f.options.find((x) => x.id === v); if (!o) out.push({ conditionId: c.id, text: `“${f.label}” refers to a removed option.` }); else if (o.label.endsWith("(archived)")) out.push({ conditionId: c.id, text: `“${f.label}” uses an archived option (${o.label.replace(" (archived)", "")}).` }); }
    else if (f.options && typeof c.value === "string" && !f.options.some((x) => x.id === c.value)) out.push({ conditionId: c.id, text: `“${f.label}” refers to a removed option.` });
  }
  return out;
}

const arr = (v: unknown) => (Array.isArray(v) ? (v as string[]) : typeof v === "string" && v ? [v] : []);
const num = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN);
function cmpDate(day: string | undefined, c: ViewCondition, now: Date): boolean {
  if (c.op === "empty") return !day; if (c.op === "not_empty") return !!day; if (!day) return false;
  const [a, b] = Array.isArray(c.value) ? (c.value as string[]) : [String(c.value ?? ""), ""];
  if (c.op === "before") return !!a && day < a; if (c.op === "after") return !!a && day > a; if (c.op === "on") return day === a;
  if (c.op === "between") return !!a && !!b && day >= a && day <= b;
  if (c.op === "within_days") { const n = num(c.value); if (!(n >= 0)) return false; return day >= dayKey(new Date(now.getTime() - n * 864e5)) && day <= dayKey(now); }
  if (c.op === "today") return day === dayKey(now);
  return false;
}
function cmpScalar(v: unknown, c: ViewCondition, kind: FieldKind): boolean {
  const has = !(v === undefined || v === "" || (Array.isArray(v) && !v.length));
  if (c.op === "empty") return !has; if (c.op === "not_empty") return has;
  if (kind === "bool") return c.op === "yes" ? v === true : c.op === "no" ? v !== true : false;
  if (!has) return c.op === "is_not";
  if (kind === "select") { const want = arr(c.value); return c.op === "is" ? want.length === 1 && v === want[0] : c.op === "is_not" ? !want.includes(String(v)) : c.op === "any_of" ? want.includes(String(v)) : false; }
  if (kind === "multi") { const want = arr(c.value), got = arr(v); return c.op === "contains_any" ? want.some((x) => got.includes(x)) : c.op === "contains_all" ? want.length > 0 && want.every((x) => got.includes(x)) : false; }
  if (kind === "number") {
    const n = typeof v === "object" && v && "amount" in v ? (v as Money).amount : Number(v); const [a, b] = Array.isArray(c.value) ? (c.value as unknown[]).map(num) : [num(c.value), NaN];
    return c.op === "gt" ? n > a! : c.op === "lt" ? n < a! : c.op === "equals" ? n === a : c.op === "between" ? n >= a! && n <= b! : false;
  }
  const s = String(v).toLowerCase(), q = String(c.value ?? "").trim().toLowerCase();
  return c.op === "contains" ? !!q && s.includes(q) : c.op === "equals" ? s === q : false;
}

/** Whether one lead satisfies one condition. Unknown/hidden fields or invalid operators → false. */
export function matchCondition(l: Lead, c: ViewCondition, ctx: ViewCtx, fields: Map<string, FilterField>): boolean {
  const f = fields.get(c.field); if (!f || !OPS_FOR[f.kind].includes(c.op)) return false;
  switch (c.field) {
    case "search": { const q = String(c.value ?? "").trim().toLowerCase(); if (c.op === "empty") return !q; if (!q) return false; const hay = `${l.name} ${l.company ?? ""} ${l.phone} ${l.email ?? ""}`.toLowerCase(); return c.op === "equals" ? l.name.toLowerCase() === q : hay.includes(q); }
    case "stage": return cmpScalar(l.status, c, "select");
    case "quick": return cmpScalar(l.quickStatus, c, "select");
    case "priority": return cmpScalar(l.priority, c, "select");
    case "source": return cmpScalar(l.source, c, "select");
    case "assignee": return cmpScalar(ctx.assignments[l.id]?.employeeId ?? "__none", c, "select");
    case "inbox": return cmpScalar(ctx.inboxMeta[l.id]?.reviewedAt ? "reviewed" : "needs_review", c, "select");
    case "contact": return cmpScalar(contactState(l.id, ctx.activities), c, "select");
    case "tags": return cmpScalar(ctx.leadTags[l.id] ?? [], c, "multi");
    case "created": return cmpDate(dayKey(l.createdAt), c, ctx.now);
    case "lastContact": return cmpDate(l.lastContact ? dayKey(l.lastContact) : undefined, c, ctx.now);
    case "followupDue": {
      const pend = ctx.followUps.filter((x) => x.leadId === l.id && !x.completedAt && !x.cancelledAt);
      if (c.op === "empty") return !pend.length; if (c.op === "not_empty") return pend.length > 0;
      if (c.op === "overdue") return pend.some((x) => new Date(x.dueAt).getTime() < ctx.now.getTime());
      return pend.some((x) => cmpDate(dayKey(x.dueAt), c, ctx.now));
    }
  }
  if (c.field.startsWith("cf:")) {
    const v = ctx.fieldValues[l.id]?.[c.field.slice(3)];
    return f.kind === "date" ? cmpDate(typeof v === "string" ? v : undefined, c, ctx.now) : cmpScalar(v, c, f.kind);
  }
  return false;
}
/** Run a view over leads already inside the viewer's record scope. Views never widen what a viewer can see. */
export function runView(view: Pick<SavedView, "filter" | "sort">, leads: Lead[], ctx: ViewCtx): Lead[] {
  const fields = new Map(filterFields(ctx).map((f) => [f.key, f]));
  const cs = view.filter.conditions;
  const out = cs.length ? leads.filter((l) => (view.filter.mode === "or" ? cs.some((c) => matchCondition(l, c, ctx, fields)) : cs.every((c) => matchCondition(l, c, ctx, fields)))) : [...leads];
  const cmp: Record<ViewSort, (a: Lead, b: Lead) => number> = { recent: (a, b) => b.createdAt.localeCompare(a.createdAt), updated: (a, b) => b.updatedAt.localeCompare(a.updatedAt), score: (a, b) => (b.aiScore ?? 0) - (a.aiScore ?? 0), value: (a, b) => (b.quotedAmount ?? 0) - (a.quotedAmount ?? 0), name: (a, b) => a.name.localeCompare(b.name) };
  return out.sort((a, b) => Number(b.pinned) - Number(a.pinned) || cmp[view.sort](a, b));
}

/** Which saved views a viewer may open. Sharing a view never grants its records — runView only sees in-scope leads. */
export const viewAllowed = (v: SavedView, viewer: Viewer) => viewer.owner || v.ownerId === viewer.employeeId || v.visibility !== "personal";
export const viewEditable = (v: SavedView, viewer: Viewer) => viewer.owner || (v.ownerId === viewer.employeeId && v.visibility !== "company");
export function viewError(v: Pick<SavedView, "name" | "visibility" | "ownerId" | "filter">, viewer: Viewer, all: Pick<SavedView, "id" | "name" | "ownerId" | "archived">[], id?: string): string | null {
  if (!v.name.trim()) return "Name the view.";
  if (v.name.trim().length > 50) return "Keep the name under 50 characters.";
  if (!viewer.owner && v.visibility === "company") return "Only the Owner can create company views.";
  if (all.some((x) => x.id !== id && !x.archived && x.ownerId === v.ownerId && x.name.trim().toLowerCase() === v.name.trim().toLowerCase())) return "You already have a view with this name.";
  if (v.filter.conditions.length > 20) return "Use at most 20 conditions.";
  return null;
}
/** Versioned, portable form for backups / a future API. */
export const serializeView = (v: SavedView) => JSON.stringify({ ...v, schema: CUSTOMIZE_SCHEMA });
export function parseView(raw: string): SavedView | null {
  try {
    const v = JSON.parse(raw) as SavedView;
    if (!v || typeof v.id !== "string" || typeof v.name !== "string" || !v.filter || !Array.isArray(v.filter.conditions) || (v.filter.mode !== "and" && v.filter.mode !== "or")) return null;
    return { ...v, schema: v.schema ?? 1, archived: !!v.archived };
  } catch { return null; }
}

/** Ready-made views offered on first use (company views — real filters over real data). */
export function starterViews(ownerId: string, at: string): SavedView[] {
  const v = (id: string, name: string, conditions: Omit<ViewCondition, "id">[], sort: ViewSort = "recent"): SavedView => ({ id, name, visibility: "company", ownerId, filter: { mode: "and", conditions: conditions.map((c, i) => ({ ...c, id: `${id}_c${i}` })) }, sort, archived: false, schema: CUSTOMIZE_SCHEMA, createdAt: at, updatedAt: at, version: 1 });
  return [
    v("view_unassigned", "All unassigned leads", [{ field: "assignee", op: "is", value: ["__none"] }]),
    v("view_meta_new", "Meta Ads — not contacted", [{ field: "source", op: "is", value: ["Meta Ads"] }, { field: "contact", op: "is", value: ["none"] }]),
    v("view_due_today", "Follow-ups due today", [{ field: "followupDue", op: "today" }]),
    v("view_new_week", "New leads this week", [{ field: "created", op: "within_days", value: 7 }]),
  ];
}

/** Lead ids whose stored values reference the field — so archiving never loses data. */
export const viewsUsingField = (views: SavedView[], fieldId: string) => views.filter((v) => !v.archived && v.filter.conditions.some((c) => c.field === `cf:${fieldId}`));
export const viewsUsingTag = (views: SavedView[], tagId: string) => views.filter((v) => !v.archived && v.filter.conditions.some((c) => c.field === "tags" && arr(c.value).includes(tagId)));
