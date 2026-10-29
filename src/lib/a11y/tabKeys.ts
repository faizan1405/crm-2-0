import type { KeyboardEvent } from "react";

/**
 * Arrow-key navigation for a tablist / radiogroup container.
 * ArrowLeft/Up = previous, ArrowRight/Down = next, Home/End = first/last.
 * Disabled items are skipped. The newly focused item is activated (clicked),
 * matching the "automatic activation" pattern — selection follows focus.
 */
export function nextIndex(count: number, current: number, key: string, enabled: boolean[]): number {
  if (count === 0) return -1;
  const ok = (i: number) => enabled[i] !== false;
  if (key === "Home" || key === "End") {
    const order = key === "Home" ? [...Array(count).keys()] : [...Array(count).keys()].reverse();
    return order.find(ok) ?? current;
  }
  const step = key === "ArrowRight" || key === "ArrowDown" ? 1 : key === "ArrowLeft" || key === "ArrowUp" ? -1 : 0;
  if (!step) return current;
  for (let n = 1; n <= count; n++) {
    const i = (((current + step * n) % count) + count) % count;
    if (ok(i)) return i;
  }
  return current;
}

const KEYS = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"]);

export function onRovingKeyDown(e: KeyboardEvent<HTMLElement>) {
  if (!KEYS.has(e.key)) return;
  const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[role="tab"],[role="radio"]'));
  const current = items.indexOf(document.activeElement as HTMLElement);
  if (current < 0) return;
  const enabled = items.map((el) => !(el as HTMLButtonElement).disabled && el.getAttribute("aria-disabled") !== "true");
  const i = nextIndex(items.length, current, e.key, enabled);
  if (i === current || i < 0) return;
  e.preventDefault();
  items[i].focus();
  items[i].click();
}

/** tabIndex for roving focus: only the selected item sits in the Tab order. */
export const roving = (selected: boolean) => (selected ? 0 : -1);
