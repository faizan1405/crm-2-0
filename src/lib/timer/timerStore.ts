// Browser-side holder for the focus timer: one shared state per browser (localStorage),
// synced across tabs, one ticker per tab, one finish alert per session across all tabs.
// Must only be used after mount (Shell renders CRM pages after mount).
import { useSyncExternalStore } from "react";
import * as T from "./focusTimer";

type Listener = () => void;
type FinishListener = (sound: boolean) => void;

let state: T.TimerState | null = null;
const listeners = new Set<Listener>();
const finishListeners = new Set<FinishListener>();
let ticker: { stop: () => void } | null = null;
let storageBound = false;

const now = () => Date.now();

function read(): T.TimerState {
  if (state) return state;
  try { state = T.restore(localStorage.getItem(T.TIMER_KEY)); } catch { state = T.initialTimer(); }
  return state;
}

function write(next: T.TimerState) {
  state = next;
  try { localStorage.setItem(T.TIMER_KEY, JSON.stringify(next)); } catch { /* timer still works for this tab */ }
  listeners.forEach((l) => l());
  syncTicker();
}

function claimed(): string | null { try { return localStorage.getItem(T.CHIME_KEY); } catch { return null; } }
function claim(id: string) { try { localStorage.setItem(T.CHIME_KEY, id); } catch { /* best effort */ } }

/** Moves an expired timer to done and announces it once (across tabs). */
function check() {
  const cur = read();
  const next = T.tick(cur, now());
  if (next !== cur) write(next);
  const notice = T.finishNotice(next, now(), claimed());
  if (notice && next.id) {
    claim(next.id);
    if (notice.sound) playChime();
    if (notice.alert) finishListeners.forEach((l) => l(notice.sound));
  }
}

// --- ticker: a tiny inline worker keeps ticking in background tabs, where page timers are heavily throttled.
function makeTicker(fn: () => void): { stop: () => void } {
  try {
    const src = "let i=setInterval(()=>postMessage(0),500);onmessage=()=>{clearInterval(i);close()}";
    const url = URL.createObjectURL(new Blob([src], { type: "text/javascript" }));
    const w = new Worker(url);
    w.onmessage = fn;
    return { stop: () => { w.postMessage(0); w.terminate(); URL.revokeObjectURL(url); } };
  } catch {
    const i = window.setInterval(fn, 500);
    return { stop: () => window.clearInterval(i) };
  }
}

function syncTicker() {
  const need = listeners.size > 0 && read().status === "running";
  if (need && !ticker) ticker = makeTicker(check);
  if (!need && ticker) { ticker.stop(); ticker = null; }
}

function onStorage(e: StorageEvent) {
  if (e.key !== T.TIMER_KEY) return;
  state = T.restore(e.newValue);
  listeners.forEach((l) => l());
  syncTicker();
}
function onVisible() { if (document.visibilityState === "visible") check(); }

function subscribe(l: Listener) {
  listeners.add(l);
  if (!storageBound) {
    storageBound = true;
    window.addEventListener("storage", onStorage);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pointerdown", gestureUnlock, { capture: true });
    window.addEventListener("keydown", gestureUnlock, { capture: true });
  }
  check();
  syncTicker();
  return () => {
    listeners.delete(l);
    syncTicker();
    if (!listeners.size && storageBound) {
      storageBound = false;
      window.removeEventListener("storage", onStorage);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pointerdown", gestureUnlock, { capture: true });
      window.removeEventListener("keydown", gestureUnlock, { capture: true });
    }
  };
}

export function useFocusTimer(): T.TimerState {
  return useSyncExternalStore(subscribe, read, T.initialTimer);
}

export function onTimerFinish(l: FinishListener) { finishListeners.add(l); return () => { finishListeners.delete(l); }; }

const newId = () => `${now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export const timer = {
  get: read,
  start(durationMs: number) { unlockAudio(); write(T.start(read(), durationMs, now(), newId())); },
  pause() { write(T.pause(read(), now())); check(); },
  resume() { unlockAudio(); write(T.resume(read(), now())); },
  reset() { write(T.reset(read())); },
  stop() { write(T.stop(read())); },
  setMuted(muted: boolean) { if (!muted) unlockAudio(); write({ ...read(), muted }); },
  setView(view: T.TimerView) { write({ ...read(), view }); },
  setPos(pos: T.Position | null) { write({ ...read(), pos }); },
  preview() { unlockAudio(); playChime(); },
};

// --- sound: a short two-note chime synthesised with Web Audio (no files, no network).
let ctx: AudioContext | null = null;
function audio(): AudioContext | null {
  if (ctx) return ctx;
  try {
    const A = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    ctx = A ? new A() : null;
  } catch { ctx = null; }
  return ctx;
}
function unlockAudio() {
  const c = audio();
  if (c && c.state === "suspended") void c.resume().catch(() => {});
}
/** Any click/key while a countdown exists re-enables sound after a refresh (browsers need a gesture). */
function gestureUnlock() { if (ctx || T.isActive(read())) unlockAudio(); }
function playChime() {
  const c = audio();
  if (!c) return;
  const go = () => {
    const t0 = c.currentTime + 0.02;
    const master = c.createGain();
    master.gain.value = 0.18;
    master.connect(c.destination);
    [[659.25, 0], [987.77, 0.18], [1318.5, 0.36]].forEach(([f, dt]) => {
      const o = c.createOscillator(), g = c.createGain();
      o.type = "sine"; o.frequency.value = f!;
      g.gain.setValueAtTime(0.0001, t0 + dt!);
      g.gain.exponentialRampToValueAtTime(1, t0 + dt! + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dt! + 0.9);
      o.connect(g).connect(master);
      o.start(t0 + dt!); o.stop(t0 + dt! + 0.95);
    });
  };
  if (c.state === "suspended") void c.resume().then(go).catch(() => {}); else go();
}
