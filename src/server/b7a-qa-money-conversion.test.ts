import { describe, expect, it } from "vitest";
import {
  FinancialValidationError,
  MigrationMapper,
  parseLegacyRupeesToPaise,
} from "./backup/migrationMapping.server";

describe("B7A-QA — Strict Decimal-to-Paise Currency Conversion", () => {
  const mapper = new MigrationMapper("usr_qa_owner");

  it("parses valid INR decimal strings and numbers to exact integer paise without float drift", () => {
    // 0.29 INR -> 29 paise (in IEEE 754, 0.29 * 100 = 28.999999999999996)
    const p29 = parseLegacyRupeesToPaise("0.29");
    expect(p29.ok).toBe(true);
    if (p29.ok) expect(p29.paise).toBe(29);

    // 100000.01 INR -> 10000001 paise
    const p100k = parseLegacyRupeesToPaise("100000.01");
    expect(p100k.ok).toBe(true);
    if (p100k.ok) expect(p100k.paise).toBe(10000001);

    // 1250.5 INR -> 125050 paise
    const p1250 = parseLegacyRupeesToPaise("1250.5");
    expect(p1250.ok).toBe(true);
    if (p1250.ok) expect(p1250.paise).toBe(125050);

    // Cleaned comma strings: "1,00,000.50" -> 10000050 paise
    const pComma = parseLegacyRupeesToPaise("1,00,000.50");
    expect(pComma.ok).toBe(true);
    if (pComma.ok) expect(pComma.paise).toBe(10000050);

    // Numeric representation 0.29
    const pNum = parseLegacyRupeesToPaise(0.29);
    expect(pNum.ok).toBe(true);
    if (pNum.ok) expect(pNum.paise).toBe(29);
  });

  it("strictly rejects fractional paise (>2 decimal places) such as 1.005", () => {
    // 1.005 has 3 decimal places -> invalid in INR paise ledger
    const p1005 = parseLegacyRupeesToPaise("1.005");
    expect(p1005.ok).toBe(false);
    if (!p1005.ok) {
      expect(p1005.error).toContain("2 decimal places");
    }

    // Number 1.005
    const pNum1005 = parseLegacyRupeesToPaise(1.005);
    expect(pNum1005.ok).toBe(false);

    // Mapper.toPaise must throw FinancialValidationError
    expect(() => mapper.toPaise("1.005")).toThrow(FinancialValidationError);
  });

  it("strictly rejects negative values, NaN, Infinity and malformed strings", () => {
    expect(parseLegacyRupeesToPaise("-50").ok).toBe(false);
    expect(parseLegacyRupeesToPaise(-50).ok).toBe(false);
    expect(parseLegacyRupeesToPaise(NaN).ok).toBe(false);
    expect(parseLegacyRupeesToPaise(Infinity).ok).toBe(false);
    expect(parseLegacyRupeesToPaise("invalid_amount").ok).toBe(false);
    expect(parseLegacyRupeesToPaise("12.3.4").ok).toBe(false);

    expect(() => mapper.toPaise(-100)).toThrow(FinancialValidationError);
    expect(() => mapper.toPaise("invalid")).toThrow(FinancialValidationError);
  });

  it("handles zero amounts according to entity rules", () => {
    // allowZero = true (default)
    expect(parseLegacyRupeesToPaise("0", { allowZero: true })).toEqual({ ok: true, paise: 0 });
    expect(parseLegacyRupeesToPaise(0, { allowZero: true })).toEqual({ ok: true, paise: 0 });
    expect(parseLegacyRupeesToPaise("", { allowZero: true })).toEqual({ ok: true, paise: 0 });

    // allowZero = false
    expect(parseLegacyRupeesToPaise("0", { allowZero: false }).ok).toBe(false);
  });

  it("maintains zero accumulation drift over 100 payments of ₹0.29", () => {
    // 100 payments of ₹0.29 = exactly 2,900 paise (= ₹29.00)
    let totalPaise = 0;
    for (let i = 0; i < 100; i++) {
      const parsed = parseLegacyRupeesToPaise("0.29");
      expect(parsed.ok).toBe(true);
      if (parsed.ok) totalPaise += parsed.paise;
    }

    expect(totalPaise).toBe(2900);
    // Floating point check: 0.29 * 100 would drift in float math
    expect(0.29 * 100).not.toBe(29); // 28.999999999999996 in IEEE 754
  });

  it("correctly converts deal and payment amounts without rounding legacy records", () => {
    const deal = mapper.mapDeal({
      id: "deal_qa_1",
      leadId: "lead_qa_1",
      name: "High Precision Contract",
      value: "100000.01",
      status: "won",
      createdAt: "2026-11-10T12:00:00Z",
    });

    expect(deal.valuePaise).toBe(10000001);
    expect(deal.valueDecimal).toBe("100000.01");

    const payment = mapper.mapPayment({
      id: "pay_qa_1",
      dealId: "deal_qa_1",
      amount: "0.29",
      date: "2026-11-10",
      createdAt: "2026-11-10T12:00:00Z",
    });

    expect(payment.amountPaise).toBe(29);
    expect(payment.amountDecimal).toBe("0.29");
  });
});
