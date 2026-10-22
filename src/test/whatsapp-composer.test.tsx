import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WhatsAppComposer, openWhatsApp } from "@/components/crm/WhatsAppComposer";
import { useCRM } from "@/lib/crm/store";
import { builtInTemplates, type Quotation } from "@/lib/crm/studio";

vi.mock("@tanstack/react-router", () => ({ Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a> }));

const quote = (leadId: string, title: string): Quotation => ({ id: `q_${title}`, number: "", leadId, clientName: "C", title, issueDate: "2026-10-01", validUntil: "2099-12-31", items: [{ id: "i", description: title, qty: 1, unitPrice: 15000 }], discountType: "flat", discount: 0, gstEnabled: false, gstRate: 18, status: "ready", revision: 1, history: [], createdAt: "", updatedAt: "" });

beforeEach(() => { localStorage.clear(); useCRM.getState().reset(); useCRM.setState({ quotations: [], waTemplates: builtInTemplates(), demos: [] }); });

describe("WhatsApp composer", () => {
  it("lists only the selected client's quotations and resets on client switch", () => {
    const [a, b] = useCRM.getState().leads;
    useCRM.getState().saveQuotation(quote(a!.id, "Alpha Website"));
    useCRM.getState().saveQuotation(quote(a!.id, "Alpha Shop"));
    render(<WhatsAppComposer />);
    act(() => openWhatsApp(a!.id, "test", { purpose: "quotation" }));
    expect(screen.getByText(`${a!.name} — 2 saved quotations`)).toBeInTheDocument();
    expect(screen.getAllByText("Alpha Website").length).toBeGreaterThan(0);
    act(() => openWhatsApp(b!.id, "test", { purpose: "quotation" }));
    expect(screen.queryByText("Alpha Website")).toBeNull();
    expect(screen.getByText(b!.phone)).toBeInTheDocument();
    expect(screen.queryByText(a!.phone)).toBeNull();
  });
  it("opening WhatsApp does not mark the quotation shared or log a message", () => {
    const lead = useCRM.getState().leads.find((l) => /^[6-9]\d{9}$/.test(l.phone.replace(/\D/g, "").slice(-10)))!;
    const id = useCRM.getState().saveQuotation(quote(lead.id, "Gamma"))!;
    const before = useCRM.getState().activities.length;
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    render(<WhatsAppComposer />);
    act(() => openWhatsApp(lead.id, "test", { purpose: "quotation", quoteId: id }));
    fireEvent.click(screen.getByRole("button", { name: /Open in WhatsApp/ }));
    expect(open).toHaveBeenCalledOnce();
    expect(useCRM.getState().quotations.find((x) => x.id === id)!.status).toBe("ready");
    expect(useCRM.getState().activities.length).toBe(before);
  });
  it("keeps an edited message when the template changes", () => {
    const lead = useCRM.getState().leads[0]!;
    render(<WhatsAppComposer />);
    act(() => openWhatsApp(lead.id, "test"));
    const box = screen.getByLabelText("Message") as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: "My own words" } });
    const t = useCRM.getState().waTemplates.find((x) => x.purpose === "followup")!;
    act(() => useCRM.getState().saveTemplate({ ...t, body: "Brand new {firstName}" }));
    expect((screen.getByLabelText("Message") as HTMLTextAreaElement).value).toBe("My own words");
    expect(screen.getByText(/Your edited message was kept/)).toBeInTheDocument();
  });
});
