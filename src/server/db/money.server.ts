import "@tanstack/react-start/server-only";

// Matches MySQL DECIMAL(15, 2) max: 13 integer digits + 2 fractional digits -> max 9_999_999_999_999.99 INR.
// This fits comfortably inside Number.MAX_SAFE_INTEGER (9_007_199_254_740_991 paise) when multiplied by 100.
export const MAX_DECIMAL_15_2_PAISE = 90_071_992_547_409_00;
const DECIMAL_STRING_RE = /^(\d{1,13})(?:\.(\d{1,2}))?$/;

/** Validates that a JS rupee value is finite, non-negative, and has at most 2 decimal places. */
export function isValidInrAmount(amount: number): boolean {
  if (!Number.isFinite(amount) || amount < 0) return false;
  const scaled = amount * 100;
  if (scaled > MAX_DECIMAL_15_2_PAISE) return false;
  return Math.abs(scaled - Math.round(scaled)) < 1e-6;
}

/** Converts an INR rupee number (e.g. 1250.5) to exact integer paise (125050). */
export function rupeesToPaise(amount: number): number {
  if (!isValidInrAmount(amount)) {
    throw new RangeError(`Invalid INR monetary amount: ${String(amount)}`);
  }
  return Math.round(amount * 100);
}

/** Formats exact integer paise (125050) to canonical SQL DECIMAL(15, 2) string ("1250.50"). */
export function paiseToDecimalString(paise: number): string {
  if (!Number.isSafeInteger(paise) || paise < 0 || paise > MAX_DECIMAL_15_2_PAISE) {
    throw new RangeError(`Invalid integer paise amount: ${String(paise)}`);
  }
  const rupees = Math.floor(paise / 100);
  const rem = paise % 100;
  return `${rupees}.${String(rem).padStart(2, "0")}`;
}

/** Parses a DECIMAL(15, 2) string returned by mysql2 (`decimalNumbers: false`) into exact integer paise. */
export function decimalStringToPaise(raw: string): number {
  const trimmed = raw.trim();
  const match = DECIMAL_STRING_RE.exec(trimmed);
  if (!match) {
    throw new RangeError(`Invalid DECIMAL(15,2) string: "${raw}"`);
  }
  const whole = match[1] ?? "0";
  const frac = (match[2] ?? "").padEnd(2, "0");
  const paise = Number(whole) * 100 + Number(frac);
  if (!Number.isSafeInteger(paise) || paise > MAX_DECIMAL_15_2_PAISE) {
    throw new RangeError(`DECIMAL(15,2) value exceeds safe integer range: "${raw}"`);
  }
  return paise;
}

/** Converts canonical DECIMAL(15, 2) string back into a finite JS INR amount (at most 2 decimals). */
export function decimalStringToRupees(raw: string): number {
  return decimalStringToPaise(raw) / 100;
}

/** Sums exact integer paise without binary float drift. */
export function sumPaise(values: readonly number[]): number {
  let total = 0;
  for (const value of values) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new RangeError(`Invalid paise element: ${String(value)}`);
    }
    total += value;
    if (total > MAX_DECIMAL_15_2_PAISE) {
      throw new RangeError("Summed paise amount exceeds DECIMAL(15,2) safe bound");
    }
  }
  return total;
}

/** Computes outstanding balance in exact paise, clamped at zero (matching finance.ts semantics). */
export function outstandingPaise(finalAmountPaise: number, collectedPaise: number): number {
  if (!Number.isSafeInteger(finalAmountPaise) || !Number.isSafeInteger(collectedPaise)) {
    throw new RangeError("Paise operands must be safe integers");
  }
  return Math.max(0, finalAmountPaise - collectedPaise);
}
