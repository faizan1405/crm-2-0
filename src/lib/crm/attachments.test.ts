import { describe, it, expect } from "vitest";
import { checkProof, MAX_PROOF_BYTES } from "./attachments";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
const PDF = new TextEncoder().encode("%PDF-1.7");
const WEBP = new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8 ");

describe("payment proof validation", () => {
  it("accepts JPG, JPEG, PNG, WebP and PDF with matching content", () => {
    expect(checkProof("a.jpg", 10, JPG)).toEqual({ ok: true, type: "image/jpeg" });
    expect(checkProof("a.JPEG", 10, JPG)).toEqual({ ok: true, type: "image/jpeg" });
    expect(checkProof("a.png", 10, PNG)).toEqual({ ok: true, type: "image/png" });
    expect(checkProof("a.webp", 10, WEBP)).toEqual({ ok: true, type: "image/webp" });
    expect(checkProof("a.pdf", 10, PDF)).toEqual({ ok: true, type: "application/pdf" });
  });
  it("rejects files over 10 MB", () => {
    expect(checkProof("a.png", MAX_PROOF_BYTES + 1, PNG).ok).toBe(false);
    expect(checkProof("a.png", MAX_PROOF_BYTES, PNG).ok).toBe(true);
  });
  it("rejects SVG and executables", () => {
    expect(checkProof("a.svg", 10, new TextEncoder().encode("<svg")).ok).toBe(false);
    expect(checkProof("a.exe", 10, new Uint8Array([0x4d, 0x5a])).ok).toBe(false);
  });
  it("rejects spoofed files whose content doesn't match the extension", () => {
    expect(checkProof("proof.png", 10, new Uint8Array([0x4d, 0x5a, 0, 0])).ok).toBe(false);
    expect(checkProof("proof.png", 10, PDF).ok).toBe(false);
  });
});
