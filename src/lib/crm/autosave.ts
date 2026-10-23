// Debounced saver: one pending payload, latest wins, flush() saves now. Reports status only after the save actually ran.
export type SaveStatus = "idle" | "pending" | "saved" | "error";

export function createAutosaver<T>(save: (v: T) => void, onStatus: (s: SaveStatus, err?: unknown) => void, delay = 600) {
  let pending: { v: T } | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const flush = (): boolean => {
    if (timer) { clearTimeout(timer); timer = null; }
    if (!pending) return true;
    const { v } = pending; pending = null;
    try { save(v); onStatus("saved"); return true; }
    catch (e) { pending = pending ?? { v }; onStatus("error", e); return false; }
  };
  return {
    schedule(v: T) { pending = { v }; onStatus("pending"); if (timer) clearTimeout(timer); timer = setTimeout(flush, delay); },
    flush,
    hasPending: () => pending !== null,
    cancel() { if (timer) clearTimeout(timer); timer = null; pending = null; },
  };
}
