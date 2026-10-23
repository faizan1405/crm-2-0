// Browser-local automation runner. No background scheduler exists: rules evaluate only while the app is open —
// shortly after it opens, when the tab becomes visible again, after relevant CRM data changes (debounced), and
// every 5 minutes while visible. Never runs during an Employee Preview. Everything it does is idempotent.
import { useCRM } from "./store";
import { activePreview } from "./session";

let started = false;
let timer: ReturnType<typeof setTimeout> | undefined;
const INTERVAL = 5 * 60_000;

function runSoon(delay = 1500) {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    const s = useCRM.getState();
    if (activePreview() || !s.automationSettings.autoEvaluate || !s.automationRules.some((r) => r.status === "enabled")) return;
    s.runAutomations();
  }, delay);
}

export function startAutomationRunner() {
  if (started || typeof window === "undefined") return;
  started = true;
  runSoon(2500);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") runSoon(); });
  setInterval(() => { if (document.visibilityState === "visible") runSoon(0); }, INTERVAL);
  useCRM.subscribe((s, p) => {
    if (s.leads !== p.leads || s.followUps !== p.followUps || s.activities !== p.activities || s.assignments !== p.assignments || s.automationRules.some((r, i) => r.status !== p.automationRules[i]?.status)) runSoon();
  });
}
