// Phase 3G.2 — Analytics Studio settings, merged into the single CRM store.
// Only definitions are stored (forecast probabilities with history, expected close dates, saved report
// definitions). Results are always recomputed from current CRM records — nothing derived is persisted.
import { forecastConfigError, reportError, EMPTY_FORECAST, OPEN_STAGES, type ForecastConfig, type ReportDef } from "./analytics";
import type { CustomFieldDef } from "./customize";
import type { Lead } from "./types";
import { uid } from "./format";

export interface AnalyticsSlice {
  forecastConfig: ForecastConfig;
  /** Every earlier configuration, newest first — earlier forecasts stay explainable. */
  forecastHistory: ForecastConfig[];
  /** Owner-entered expected close dates keyed by lead id (never stored on the Lead). */
  expectedClose: Record<string, string>;
  savedReports: ReportDef[];
  saveForecastConfig: (input: Pick<ForecastConfig, "probabilities" | "conservative" | "optimistic" | "note">) => string | null;
  setExpectedClose: (leadId: string, day: string | null) => string | null;
  saveReport: (def: Omit<ReportDef, "id" | "createdAt" | "updatedAt" | "version"> & { id?: string | undefined }) => { ok: true; id: string } | { ok: false; error: string };
  duplicateReport: (id: string) => string | null;
  setReportFlags: (id: string, flags: Partial<Pick<ReportDef, "pinned" | "favorite" | "archived" | "name">>) => void;
}
type S = AnalyticsSlice & { leads: Lead[]; customFields: CustomFieldDef[] };
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export function createAnalyticsSlice(set: (p: Partial<S> | ((s: S) => Partial<S>)) => void, get: () => S): AnalyticsSlice {
  return {
    forecastConfig: EMPTY_FORECAST, forecastHistory: [], expectedClose: {}, savedReports: [],
    saveForecastConfig: (input) => {
      const probabilities = Object.fromEntries(OPEN_STAGES.map((s) => [s, input.probabilities[s]]));
      const next = { probabilities, conservative: input.conservative, optimistic: input.optimistic };
      const err = forecastConfigError(next); if (err) return err;
      const cur = get().forecastConfig;
      set({ forecastConfig: { ...next, version: cur.version + 1, effectiveFrom: new Date().toISOString(), note: input.note?.trim() || undefined }, forecastHistory: cur.version > 0 ? [cur, ...get().forecastHistory].slice(0, 100) : get().forecastHistory });
      return null;
    },
    setExpectedClose: (leadId, day) => {
      if (!get().leads.some((l) => l.id === leadId)) return "That lead no longer exists.";
      if (day && (!DAY.test(day) || Number.isNaN(Date.parse(`${day}T00:00:00Z`)))) return "Enter a valid date.";
      set((s) => { const m = { ...s.expectedClose }; if (day) m[leadId] = day; else delete m[leadId]; return { expectedClose: m }; });
      return null;
    },
    saveReport: (def) => {
      const err = reportError(def, get().customFields); if (err) return { ok: false, error: err };
      const at = new Date().toISOString(); const cur = def.id ? get().savedReports.find((r) => r.id === def.id) : undefined;
      if (cur) { set((s) => ({ savedReports: s.savedReports.map((r) => (r.id === cur.id ? { ...cur, ...def, id: cur.id, name: def.name.trim(), updatedAt: at, version: cur.version + 1 } : r)) })); return { ok: true, id: cur.id }; }
      const id = uid("rpt");
      set((s) => ({ savedReports: [...s.savedReports, { ...def, id, name: def.name.trim(), createdAt: at, updatedAt: at, version: 1 }] }));
      return { ok: true, id };
    },
    duplicateReport: (id) => {
      const r = get().savedReports.find((x) => x.id === id); if (!r) return null;
      const nid = uid("rpt"); const at = new Date().toISOString();
      set((s) => ({ savedReports: [...s.savedReports, { ...r, id: nid, name: `${r.name} (copy)`, pinned: false, favorite: false, archived: false, createdAt: at, updatedAt: at, version: 1 }] }));
      return nid;
    },
    setReportFlags: (id, flags) => set((s) => ({ savedReports: s.savedReports.map((r) => (r.id === id ? { ...r, ...flags, ...(flags.name !== undefined ? { name: flags.name.trim() || r.name } : {}), updatedAt: new Date().toISOString(), version: r.version + 1 } : r)) })),
  };
}

/** v10: Analytics settings start empty — no probabilities are assumed and no report is pre-created. */
export function migrateAnalytics(state: Record<string, unknown>, version: number): Record<string, unknown> {
  if (version >= 10) return state;
  return { forecastConfig: EMPTY_FORECAST, forecastHistory: [], expectedClose: {}, savedReports: [], ...state };
}
