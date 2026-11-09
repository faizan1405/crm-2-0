import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { Bell, BellOff, Maximize2, Minus, Pause, Play, RotateCcw, Square, Timer, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import { PRESETS, MAX_MINUTES, clampPos, formatMMSS, isActive, parseMinutes, progress, remaining, type Position, type TimerState } from "@/lib/timer/focusTimer";
import { onTimerFinish, timer, useFocusTimer } from "@/lib/timer/timerStore";

/** Re-renders a few times a second while counting; the value shown is always endsAt − now. */
function useNow(running: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
    if (!running) return;
    const i = window.setInterval(() => setNow(Date.now()), 250);
    const vis = () => setNow(Date.now());
    document.addEventListener("visibilitychange", vis);
    return () => { window.clearInterval(i); document.removeEventListener("visibilitychange", vis); };
  }, [running]);
  return now;
}

const STATUS_LABEL: Record<TimerState["status"], string> = { idle: "Choose a duration", ready: "Ready", running: "Running", paused: "Paused", done: "Time's up" };
const minutesLabel = (ms: number) => { const m = ms / 60000; return `${Number.isInteger(m) ? m : m.toFixed(1)}-minute`; };

function Ring({ value, size, stroke, done }: { value: number; size: number; stroke: number; done?: boolean }) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className={cn("ft-ring", done && "is-done")} aria-hidden="true">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} className="ft-ring-track" />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} strokeLinecap="round" className="ft-ring-fill"
        strokeDasharray={c} strokeDashoffset={c * (1 - value)} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
    </svg>
  );
}

/** Top-bar button: opens/closes the timer and always shows the remaining time while a countdown exists. */
export function FocusTimerButton() {
  const s = useFocusTimer();
  const now = useNow(s.status === "running");
  const live = isActive(s) || s.status === "done";
  const open = s.view === "expanded";
  const toggle = () => timer.setView(open ? (live ? "mini" : "hidden") : "expanded");
  const label = live ? `Focus timer, ${STATUS_LABEL[s.status]}, ${formatMMSS(remaining(s, now))} left. ${open ? "Minimise" : "Open"} timer` : `${open ? "Close" : "Open"} focus timer`;
  return (
    <button type="button" onClick={toggle} aria-label={label} aria-expanded={open} title="Focus timer"
      className={cn(live ? "ft-chip" : "topbar-icon", live && s.status === "done" && "is-done", live && s.status === "paused" && "is-paused")}>
      {live ? <><Ring value={progress(s, now)} size={18} stroke={2.5} /><span className="num">{formatMMSS(remaining(s, now))}</span></> : <Timer className="size-[18px]" />}
    </button>
  );
}

/** Floating widget: full card when expanded; on desktop a small draggable pill when minimised (on phones the top-bar chip is the minimised form). */
export function FocusTimerWidget() {
  const s = useFocusTimer();
  const now = useNow(s.status === "running");
  const mobile = useIsMobile();
  const ref = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Position | null>(null);
  const moved = useRef(false);
  const [custom, setCustom] = useState(""), [err, setErr] = useState<string | null>(null);

  // One alert per finished session (the store guarantees once across tabs and remounts).
  useEffect(() => onTimerFinish((sound) => {
    const st = timer.get();
    toast.success("Time's up", { id: `focus-timer-${st.id ?? ""}`, description: `Your ${minutesLabel(st.durationMs)} timer has finished${sound ? "" : " (sound muted)"}.` });
  }), []);

  // Keep the desktop widget on screen when it changes size or the window is resized.
  useLayoutEffect(() => {
    if (mobile || !s.pos) return;
    const fit = () => {
      const el = ref.current; if (!el || !s.pos) return;
      const r = el.getBoundingClientRect();
      const c = clampPos(s.pos, r.width, r.height, window.innerWidth, window.innerHeight);
      if (c.x !== s.pos.x || c.y !== s.pos.y) timer.setPos(c);
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [mobile, s.pos, s.view, s.status]);

  const visible = s.view === "expanded" || (s.view === "mini" && !mobile && (isActive(s) || s.status === "done"));
  if (!visible) return null;

  const onPointerDown = (e: ReactPointerEvent) => {
    if (mobile || e.button !== 0 || e.pointerType === "touch") return;
    if ((e.target as HTMLElement).closest("button:not([data-drag]), input")) return;
    const el = ref.current; if (!el) return;
    const r = el.getBoundingClientRect();
    const ox = e.clientX - r.left, oy = e.clientY - r.top, sx = e.clientX, sy = e.clientY;
    moved.current = false;
    let last: Position | null = null;
    const move = (ev: PointerEvent) => {
      if (!moved.current && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 4) return;
      moved.current = true;
      last = clampPos({ x: ev.clientX - ox, y: ev.clientY - oy }, r.width, r.height, window.innerWidth, window.innerHeight);
      setDrag(last);
    };
    const up = () => {
      window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); window.removeEventListener("pointercancel", up);
      if (last) timer.setPos(last);
      setDrag(null);
    };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up); window.addEventListener("pointercancel", up);
  };

  const pos = drag ?? s.pos;
  const style: CSSProperties | undefined = mobile ? undefined : pos ? { left: pos.x, top: pos.y } : { right: 24, bottom: 24 };
  const left = remaining(s, now), frac = progress(s, now), done = s.status === "done";
  const minimise = () => timer.setView(isActive(s) || done ? "mini" : "hidden");
  const startCustom = () => { const p = parseMinutes(custom); if (!p.ok) { setErr(p.error); return; } setErr(null); setCustom(""); timer.start(p.ms); };
  const mute = <button type="button" className="ft-icon" onClick={() => timer.setMuted(!s.muted)} aria-pressed={s.muted} aria-label={s.muted ? "Unmute finish sound" : "Mute finish sound"} title={s.muted ? "Sound off" : "Sound on"}>{s.muted ? <BellOff className="size-4" /> : <Bell className="size-4" />}</button>;

  if (s.view === "mini") {
    return (
      <div ref={ref} role="region" aria-label="Focus timer (minimised)" style={style} onPointerDown={onPointerDown} className={cn("ft-widget ft-mini", done && "is-done", drag && "is-dragging")}>
        <button type="button" data-drag className="ft-mini-main" onClick={() => { if (moved.current) { moved.current = false; return; } timer.setView("expanded"); }} aria-label={`Expand focus timer, ${formatMMSS(left)} left`} title="Expand · drag to move">
          <Ring value={frac} size={26} stroke={3} done={done} /><span className="num ft-mini-time" role="timer">{formatMMSS(left)}</span>
        </button>
        {s.status === "running" && <button type="button" className="ft-icon" onClick={() => timer.pause()} aria-label="Pause timer"><Pause className="size-4" /></button>}
        {s.status === "paused" && <button type="button" className="ft-icon" onClick={() => timer.resume()} aria-label="Resume timer"><Play className="size-4" /></button>}
        {done && <button type="button" className="ft-icon" onClick={() => timer.stop()} aria-label="Dismiss finished timer"><X className="size-4" /></button>}
        <button type="button" className="ft-icon" onClick={() => timer.setView("expanded")} aria-label="Expand focus timer"><Maximize2 className="size-3.5" /></button>
      </div>
    );
  }

  return (
    <div ref={ref} role="region" aria-label="Focus timer" style={style} className={cn("ft-widget ft-card", done && "is-done", drag && "is-dragging")}>
      <div className="ft-head" onPointerDown={onPointerDown} title={mobile ? undefined : "Drag to move"}>
        <span className="flex items-center gap-1.5 text-[13px] font-medium"><Timer className="size-4 text-muted-foreground" />Focus timer</span>
        <span className="ml-auto flex items-center">
          {mute}
          <button type="button" className="ft-icon" onClick={minimise} aria-label={isActive(s) || done ? "Minimise timer" : "Hide timer"} title="Minimise"><Minus className="size-4" /></button>
          {!isActive(s) && <button type="button" className="ft-icon" onClick={() => { if (done) timer.stop(); timer.setView("hidden"); }} aria-label="Close timer" title="Close"><X className="size-4" /></button>}
        </span>
      </div>

      <div className="ft-dial">
        <Ring value={s.status === "idle" ? 0 : frac} size={148} stroke={5} done={done} />
        <div className="ft-dial-text">
          <span className={cn("num ft-time", s.status === "idle" && "text-muted-foreground")} role="timer" aria-label={`${formatMMSS(left)} remaining`}>{formatMMSS(left)}</span>
          <span className="ft-status" aria-live="polite">{STATUS_LABEL[s.status]}</span>
        </div>
      </div>

      {s.status === "idle" && <div className="ft-body">
        <div className="ft-presets" role="group" aria-label="Quick start">
          {PRESETS.map((m) => <button key={m} type="button" className={cn("ft-preset", (m === 25 || m === 30) && "is-key")} onClick={() => timer.start(m * 60000)} aria-label={`Start ${m}-minute timer`}>{m}<span>m</span></button>)}
        </div>
        <form className="ft-custom" onSubmit={(e) => { e.preventDefault(); startCustom(); }}>
          <label htmlFor="ft-custom" className="sr-only">Custom minutes</label>
          <input id="ft-custom" inputMode="decimal" autoComplete="off" placeholder="Custom minutes" title={`Any length from 1 to ${MAX_MINUTES} minutes`} value={custom} onChange={(e) => { setCustom(e.target.value); if (err) setErr(null); }} aria-invalid={!!err} aria-describedby={err ? "ft-custom-err" : undefined} />
          <button type="submit" className="ft-btn is-primary"><Play className="size-3.5" />Start</button>
        </form>
        {err && <p id="ft-custom-err" role="alert" className="text-xs text-destructive">{err}</p>}
      </div>}

      {s.status !== "idle" && <div className="ft-controls">
        {s.status === "running" && <button type="button" className="ft-btn is-primary" onClick={() => timer.pause()}><Pause className="size-3.5" />Pause</button>}
        {s.status === "paused" && <button type="button" className="ft-btn is-primary" onClick={() => timer.resume()}><Play className="size-3.5" />Resume</button>}
        {s.status === "ready" && <button type="button" className="ft-btn is-primary" onClick={() => timer.start(s.durationMs)}><Play className="size-3.5" />Start</button>}
        {done && <button type="button" className="ft-btn is-primary" onClick={() => timer.start(s.durationMs)}><RotateCcw className="size-3.5" />Again</button>}
        {isActive(s) && <button type="button" className="ft-btn" onClick={() => timer.reset()} aria-label="Reset to full time"><RotateCcw className="size-3.5" />Reset</button>}
        <button type="button" className="ft-btn" onClick={() => timer.stop()} aria-label={done ? "Done, choose a new timer" : "Stop timer"}><Square className="size-3" />{done ? "Done" : "Stop"}</button>
      </div>}
    </div>
  );
}
