import "@tanstack/react-start/server-only";

// Matches MySQL DECIMAL(15, 2) max: 13 integer digits + 2 fractional digits -> max 9_999_999_999_999.99 INR
// (= 999_999_999_999_999 paise), well inside Number.MAX_SAFE_INTEGER (9_007_199_254_740_991 paise).
export const MAX_DECIMAL_15_2_PAISE = 999_999_999_999_999;
export const MAX_SAFE_AGGREGATE_PAISE = 9_007_199_254_740_900;
const DECIMAL_STRING_RE = /^(\d{1,13})(?:\.(\d{1,2}))?$/;

export type StrictInrParseResult =
  | {
      ok: true;
      paise: number;
      decimal: string;
      rupees: number;
    }
  | {
      ok: false;
      message: string;
    };

/**
 * Strictly parses an incoming JSON rupee value (number or canonical string) into exact integer paise
 * without IEEE-754 binary floating-point multiplication.
 *
 * Rejects NaN, Infinity, booleans, objects, scientific notation, negative values, >2 decimal places,
 * values exceeding DECIMAL(15, 2), and (when `allowZero` is false) ₹0.00.
 */
export function parseStrictInrInputToPaise(
  input: unknown,
  options?: { allowZero?: boolean },
): StrictInrParseResult {
  const allowZero = options?.allowZero ?? false;

  let rawStr: string;
  if (typeof input === "number") {
    if (!Number.isFinite(input)) {
      return { ok: false, message: "Monetary amount must be a finite number." };
    }
    if (Object.is(input, -0)) {
      rawStr = "0";
    } else if (input < 0) {
      return { ok: false, message: "Monetary amount cannot be negative." };
    } else {
      rawStr = input.toString();
      if (rawStr.includes("e") || rawStr.includes("E")) {
        return {
          ok: false,
          message: "Monetary amount is out of supported DECIMAL(15,2) range or precision.",
        };
      }
    }
  } else if (typeof input === "string") {
    rawStr = input.trim();
    if (!rawStr) {
      return { ok: false, message: "Monetary amount is required." };
    }
    if (rawStr.startsWith("-")) {
      return { ok: false, message: "Monetary amount cannot be negative." };
    }
  } else {
    return { ok: false, message: "Monetary amount must be a finite number or decimal string." };
  }

  const match = DECIMAL_STRING_RE.exec(rawStr);
  if (!match) {
    return {
      ok: false,
      message:
        "Monetary amount must be a valid INR value up to 13 integer digits and at most 2 decimal places.",
    };
  }

  const whole = match[1] ?? "0";
  const frac = (match[2] ?? "").padEnd(2, "0");
  const paise = Number(whole) * 100 + Number(frac);
  if (!Number.isSafeInteger(paise) || paise < 0 || paise > MAX_DECIMAL_15_2_PAISE) {
    return { ok: false, message: "Monetary amount exceeds supported DECIMAL(15,2) limit." };
  }
  if (!allowZero && paise === 0) {
    return { ok: false, message: "Monetary amount must be greater than ₹0." };
  }

  const normalizedWhole = String(Math.floor(paise / 100));
  const decimal = `${normalizedWhole}.${String(paise % 100).padStart(2, "0")}`;
  return {
    ok: true,
    paise,
    decimal,
    rupees: paise / 100,
  };
}

/** Validates that a JS rupee value is finite, non-negative, and has at most 2 decimal places. */
export function isValidInrAmount(amount: number): boolean {
  return parseStrictInrInputToPaise(amount, { allowZero: true }).ok;
}

/** Converts an INR rupee number (e.g. 1250.5) to exact integer paise (125050). */
export function rupeesToPaise(amount: number): number {
  const parsed = parseStrictInrInputToPaise(amount, { allowZero: true });
  if (!parsed.ok) {
    throw new RangeError(`Invalid INR monetary amount: ${String(amount)}`);
  }
  return parsed.paise;
}

/** Formats exact integer paise (125050) to canonical SQL DECIMAL(15, 2) string ("1250.50"). */
export function paiseToDecimalString(paise: number): string {
  if (!Number.isSafeInteger(paise) || paise < 0 || paise > MAX_SAFE_AGGREGATE_PAISE) {
    throw new RangeError(`Invalid integer paise amount: ${String(paise)}`);
  }
  const rupees = Math.floor(paise / 100);
  const rem = paise % 100;
  return `${rupees}.${String(rem).padStart(2, "0")}`;
}

/** Formats exact integer paise for a single DECIMAL(15, 2) column, enforcing the 13-integer-digit bound. */
export function paiseToColumnDecimalString(paise: number): string {
  if (!Number.isSafeInteger(paise) || paise < 0 || paise > MAX_DECIMAL_15_2_PAISE) {
    throw new RangeError(`Paise amount exceeds DECIMAL(15,2) column bound: ${String(paise)}`);
  }
  return paiseToDecimalString(paise);
}

/** Converts exact integer paise into a finite JS INR number (at most 2 decimals). */
export function paiseToRupees(paise: number): number {
  if (!Number.isSafeInteger(paise) || paise < 0 || paise > MAX_SAFE_AGGREGATE_PAISE) {
    throw new RangeError(`Invalid integer paise amount: ${String(paise)}`);
  }
  return paise / 100;
}

/**
 * Deterministic, locale-independent Indian currency formatter from exact integer paise.
 * Whole rupee amounts omit `.00` (`400000` -> `"₹4,000"`, matching `formatINR(4000)`),
 * while fractional paise are preserved (`400050` -> `"₹4,000.50"`).
 */
export function formatInrFromPaise(paise: number): string {
  if (!Number.isSafeInteger(paise)) {
    throw new RangeError(`Invalid integer paise amount: ${String(paise)}`);
  }
  const sign = paise < 0 ? "-" : "";
  const abs = Math.abs(paise);
  const wholeStr = String(Math.floor(abs / 100));
  const rem = abs % 100;

  let grouped: string;
  if (wholeStr.length <= 3) {
    grouped = wholeStr;
  } else {
    const last3 = wholeStr.slice(-3);
    const prefix = wholeStr.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",");
    grouped = `${prefix},${last3}`;
  }

  return rem === 0 ? `${sign}₹${grouped}` : `${sign}₹${grouped}.${String(rem).padStart(2, "0")}`;
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
    if (total > MAX_SAFE_AGGREGATE_PAISE) {
      throw new RangeError("Summed paise amount exceeds safe integer bound");
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
