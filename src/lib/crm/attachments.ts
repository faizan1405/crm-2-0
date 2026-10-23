// Pure rules for payment-proof files. No storage here — see proofRepo.ts.

export const MAX_PROOF_BYTES = 10 * 1024 * 1024;
export type ProofKind = "image/jpeg" | "image/png" | "image/webp" | "application/pdf";

export interface ProofMeta {
  attachmentId: string;
  paymentId: string;
  originalFileName: string;
  mimeType: ProofKind;
  fileSize: number;
  createdAt: string;
  updatedAt: string;
}

const EXT: Record<string, ProofKind> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", pdf: "application/pdf" };

/** Detect the real type from the first bytes of the file. */
export function sniffType(b: Uint8Array): ProofKind | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((v, i) => b[i] === v)) return "image/png";
  if (b.length >= 12 && String.fromCharCode(...b.slice(0, 4)) === "RIFF" && String.fromCharCode(...b.slice(8, 12)) === "WEBP") return "image/webp";
  if (b.length >= 5 && String.fromCharCode(...b.slice(0, 5)) === "%PDF-") return "application/pdf";
  return null;
}

export function extType(name: string): ProofKind | null {
  const m = /\.([a-z0-9]+)$/i.exec(name.trim());
  return m ? EXT[(m[1] ?? "").toLowerCase()] ?? null : null;
}

export type ProofCheck = { ok: true; type: ProofKind } | { ok: false; error: string };

/** Validate name, size and signature. Extension and content must agree (jpg/jpeg count as one). */
export function checkProof(name: string, size: number, head: Uint8Array): ProofCheck {
  const byExt = extType(name);
  if (!byExt) return { ok: false, error: "Only JPG, PNG, WebP or PDF files can be attached" };
  if (size <= 0) return { ok: false, error: "This file is empty" };
  if (size > MAX_PROOF_BYTES) return { ok: false, error: "File is larger than 10 MB" };
  const real = sniffType(head);
  if (!real || real !== byExt) return { ok: false, error: "This file's contents don't match its type" };
  return { ok: true, type: real };
}

/** Read a Blob's bytes (FileReader fallback for older engines). */
export function readBytes(b: Blob): Promise<ArrayBuffer> {
  if (typeof b.arrayBuffer === "function") return b.arrayBuffer();
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result as ArrayBuffer); r.onerror = () => rej(r.error); r.readAsArrayBuffer(b); });
}

export async function checkProofFile(file: Blob & { name: string }): Promise<ProofCheck> {
  const head = new Uint8Array(await readBytes(file.slice(0, 16)));
  return checkProof(file.name, file.size, head);
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export const proofLabel = (t: ProofKind) => (t === "application/pdf" ? "PDF" : (t.split("/")[1] ?? "").toUpperCase().replace("JPEG", "JPG"));
