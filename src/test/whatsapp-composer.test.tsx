import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WhatsAppComposer, openWhatsApp } from "@/components/crm/WhatsAppComposer";
import { useCRM } from "@/lib/crm/store";
import { builtInTemplates, emptyQuotationTemplate } from "@/lib/crm/studio";

vi.mock("@tanstack/react-router", () => ({ Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a> }));

const s = () => useCRM.getState();
const addPkg = (name: string, price: number) => s().saveQuotationTemplate({ ...emptyQuotationTemplate(), name, priceType: "fixed", priceAmount: price, messageBody: "Hi {clientName}, {packageName} costs {packagePrice}." })!;
const box = () => (screen.getByLabelText("Message") as HTMLTextAreaElement);
const validLeads = () => s().leads.filter((l) => /^[6-9]\d{9}$/.test(l.phone.replace(/\D/g, "").slice(-10)));

beforeEach(() => { localStorage.clear(); s().reset(); useCRM.setState({ quotationTemplates: [], quotationShares: [], waTemplates: builtInTemplates(), demos: [] }); });

describe("WhatsApp composer — quotation packages", () => {
  it("shows the same global packages for every client, personalised per client", () => {
    const [a, b] = s().leads;
    addPkg("Starter Website", 15000); addPkg("Premium 3D Website", 45000);
    render(<WhatsAppComposer />);
    act(() => openWhatsApp(a!.id, "test", { purpose: "quotation" }));
    expect(screen.getAllByRole("radio", { name: /Website/ })).toHaveLength(2);
    expect(box().value).toBe(`Hi ${a!.name}, Starter Website costs ₹15,000.`);
    act(() => openWhatsApp(b!.id, "test", { purpose: "quotation" }));
    fireEvent.click(screen.getByRole("radio", { name: /Premium 3D Website/ }));
    expect(box().value).toBe(`Hi ${b!.name}, Premium 3D Website costs ₹45,000.`);
    expect(screen.queryByText(a!.phone)).toBeNull();
  });
  it("reflects an updated package price without reopening", () => {
    const lead = s().leads[0]!;
    const id = addPkg("Premium", 45000);
    render(<WhatsAppComposer />);
    act(() => openWhatsApp(lead.id, "test", { purpose: "quotation" }));
    act(() => { s().saveQuotationTemplate({ ...s().quotationTemplates.find((x) => x.id === id)!, priceAmount: 50000 }); });
    expect(box().value).toContain("₹50,000");
  });
  it("keeps an edited message when the package changes and never edits the saved package", () => {
    const lead = s().leads[0]!;
    const id = addPkg("Premium", 45000);
    render(<WhatsAppComposer />);
    act(() => openWhatsApp(lead.id, "test", { purpose: "quotation" }));
    fireEvent.change(box(), { target: { value: "Special offer just for you" } });
    act(() => { s().saveQuotationTemplate({ ...s().quotationTemplates.find((x) => x.id === id)!, priceAmount: 50000 }); });
    expect(box().value).toBe("Special offer just for you");
    expect(screen.getByText(/Your edited message was kept/)).toBeInTheDocument();
    expect(s().quotationTemplates[0]!.messageBody).not.toContain("Special offer");
  });
  it("opens WhatsApp with the client's number and changes nothing until logged", () => {
    const lead = validLeads()[0]!;
    addPkg("Business", 30000);
    const before = JSON.stringify([s().deals, s().payments, s().followUps, s().activities]);
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    render(<WhatsAppComposer />);
    act(() => openWhatsApp(lead.id, "test", { purpose: "quotation" }));
    fireEvent.click(screen.getByRole("button", { name: /Open in WhatsApp/ }));
    const url = String(open.mock.calls[0]![0]);
    expect(url).toContain(`91${lead.phone.replace(/\D/g, "").slice(-10)}`);
    expect(decodeURIComponent(url)).toContain("₹30,000");
    expect(JSON.stringify([s().deals, s().payments, s().followUps, s().activities])).toBe(before);
    expect(s().quotationShares).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: /log to history/i }));
    expect(s().quotationShares[0]!).toMatchObject({ leadId: lead.id, packageNameSnapshot: "Business", priceSnapshot: "₹30,000", userConfirmedSent: true });
    open.mockRestore();
  });
  it("hides inactive packages", () => {
    const id = addPkg("Hidden", 1000); addPkg("Shown", 2000);
    s().setQuotationTemplateActive(id, false);
    render(<WhatsAppComposer />);
    act(() => openWhatsApp(s().leads[0]!.id, "test", { purpose: "quotation" }));
    expect(screen.queryByRole("radio", { name: /Hidden/ })).toBeNull();
    expect(screen.getByRole("radio", { name: /Shown/ })).toBeInTheDocument();
  });
  it("still keeps an edited follow-up message when its WhatsApp template changes", () => {
    const lead = s().leads[0]!;
    render(<WhatsAppComposer />);
    act(() => openWhatsApp(lead.id, "test"));
    fireEvent.change(box(), { target: { value: "My own words" } });
    const t = s().waTemplates.find((x) => x.purpose === "followup")!;
    act(() => s().saveTemplate({ ...t, body: "Brand new {firstName}" }));
    expect(box().value).toBe("My own words");
  });
});
