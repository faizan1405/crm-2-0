import { beforeEach, describe, expect, it } from "vitest";
import { useCRM } from "./store";
import { exitPreview } from "./preview";
import { isStaleError } from "./crossTab";
import { emptyQuotationTemplate } from "./studio";

const KEY = "scale-flow-crm-2-demo";
const s = () => useCRM.getState();
const saved = () => JSON.parse(localStorage.getItem(KEY)!);
function otherTab(mut: (st: any) => void) { const b = saved(); mut(b.state); localStorage.setItem(KEY, JSON.stringify(b)); }
const tryRun = (f: () => unknown) => { try { f(); return null; } catch (e) { return e; } };
const add = (name: string, price: number) => s().saveQuotationTemplate({ ...emptyQuotationTemplate(), name, priceType: "fixed", priceAmount: price, messageBody: "Hi {firstName}, {packageName} is {packagePrice}." })!;

beforeEach(() => { exitPreview(); localStorage.clear(); s().reset(); useCRM.setState({ quotationTemplates: [], quotationShares: [], payments: [] }); });

describe("D3.3 quotation package cross-tab safety", () => {
  it("a stale package save is refused and the newer package stays", () => {
    const a = add("Starter", 15000), b = add("Growth", 30000);
    const opened = s().quotationTemplates.find((x) => x.id === a)!;
    otherTab((st) => { const t = st.quotationTemplates.find((x: any) => x.id === a); Object.assign(t, { priceAmount: 18000, updatedAt: "2099-01-01T00:00:00.000Z" }); });
    expect(isStaleError(tryRun(() => s().saveQuotationTemplate({ ...opened, priceAmount: 99000 }, opened.updatedAt)))).toBe(true);
    const rows = saved().state.quotationTemplates;
    expect(rows.find((x: any) => x.id === a).priceAmount).toBe(18000);
    expect(rows.find((x: any) => x.id === b).priceAmount).toBe(30000);
  });
  it("saving on the latest version succeeds and touches only that package", () => {
    const a = add("Starter", 15000), b = add("Growth", 30000);
    const cur = s().quotationTemplates.find((x) => x.id === a)!;
    expect(s().saveQuotationTemplate({ ...cur, priceAmount: 16000 }, cur.updatedAt)).toBe(a);
    expect(s().quotationTemplates.find((x) => x.id === a)!.priceAmount).toBe(16000);
    expect(s().quotationTemplates.find((x) => x.id === b)!.priceAmount).toBe(30000);
    expect(s().payments).toHaveLength(0);
  });
});
