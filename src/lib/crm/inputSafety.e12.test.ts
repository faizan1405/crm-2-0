import { describe, expect, it, beforeEach } from "vitest";
import { leadCreateError, mailtoHref, safeHref, telHref, validEmail } from "./validation";
import { waLink } from "./whatsapp";
import { useCRM } from "./store";

describe("E1.2A input safety", () => {
  it("only http(s) links become link targets", () => {
    expect(safeHref("javascript:alert('test')")).toBeNull();
    expect(safeHref("data:text/html,<script>alert(1)</script>")).toBeNull();
    expect(safeHref(" JaVaScRiPt:alert(1)")).toBeNull();
    expect(safeHref("https://example.com/a?b=1")).toBe("https://example.com/a?b=1");
    expect(safeHref(42)).toBeNull();
  });
  it("emails that could change a mailto link are rejected", () => {
    expect(validEmail("a@b.co?cc=evil@x.com")).toBe(false);
    expect(validEmail("<b>x</b>@a.com")).toBe(false);
    expect(validEmail("a@b.co&body=hi")).toBe(false);
    expect(validEmail("  priya.k+qa@example.co.in ")).toBe(true);
    expect(mailtoHref("a@b.co#x")).toBeNull();
    expect(mailtoHref("x@example.com")).toBe("mailto:x@example.com");
  });
  it("call links contain digits only, or nothing", () => {
    expect(telHref("+91 98765-43210")).toBe("tel:+919876543210");
    expect(telHref("")).toBeNull();
    expect(telHref("abc")).toBeNull();
    expect(telHref("98765;43210<script>")).toBe("tel:9876543210");
  });
  it("WhatsApp text with & ? # and unicode stays inside the text parameter", () => {
    const url = new URL(waLink("919876543210", "Hi & bye? #1 ₹50,000 <b>नमस्ते</b>\nline 2"));
    expect(url.host).toBe("wa.me");
    expect(url.pathname).toBe("/919876543210");
    expect([...url.searchParams.keys()]).toEqual(["text"]);
    expect(url.searchParams.get("text")).toBe("Hi & bye? #1 ₹50,000 <b>नमस्ते</b>\nline 2");
    expect(url.hash).toBe("");
  });
  it("new leads with broken values are refused by the store", () => {
    expect(leadCreateError({ name: " ", phone: "9876543210" })).toBeTruthy();
    expect(leadCreateError({ name: "A", phone: "12" })).toBeTruthy();
    expect(leadCreateError({ name: "A", phone: "9876543210", budget: -5 })).toBeTruthy();
    expect(leadCreateError({ name: "A", phone: "9876543210", email: "bad" })).toBeTruthy();
    expect(leadCreateError({ name: "<b>A</b>", phone: "9876543210" })).toBeUndefined();
  });
});

describe("addLead store guard", () => {
  beforeEach(() => localStorage.clear());
  it("saves nothing for an invalid lead", () => {
    const before = useCRM.getState().leads.length;
    const id = useCRM.getState().addLead({ name: "QA", phone: "123", source: "Other", status: "new", priority: "warm", pinned: false } as never);
    expect(id).toBe("");
    expect(useCRM.getState().leads.length).toBe(before);
  });
});
