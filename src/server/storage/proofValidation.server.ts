import "@tanstack/react-start/server-only";
import { CrmServiceError } from "../crm/errors.server";

export const MAX_PROOF_BYTES = 10 * 1024 * 1024; // 10 MiB (10,485,760 bytes)

export type ProofKind = "image/jpeg" | "image/png" | "image/webp" | "application/pdf";

export const ALLOWED_PROOF_KINDS: readonly ProofKind[] = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
] as const;

const EXT_TO_MIME: Record<string, ProofKind> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  pdf: "application/pdf",
};

/**
 * Sniffs the authentic file MIME kind from the first 16 bytes of the file.
 * Exactly matches client-side sniffing in `src/lib/crm/attachments.ts`.
 */
export function sniffProofKind(bytes: Uint8Array): ProofKind | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  if (
    bytes.length >= 12 &&
    String.fromCharCode(bytes[0]!, bytes[1]!, bytes[2]!, bytes[3]!) === "RIFF" &&
    String.fromCharCode(bytes[8]!, bytes[9]!, bytes[10]!, bytes[11]!) === "WEBP"
  ) {
    return "image/webp";
  }
  if (
    bytes.length >= 5 &&
    String.fromCharCode(bytes[0]!, bytes[1]!, bytes[2]!, bytes[3]!, bytes[4]!) === "%PDF-"
  ) {
    return "application/pdf";
  }
  return null;
}

export function extensionToProofKind(rawNameOrExt: string): ProofKind | null {
  const trimmed = rawNameOrExt.trim();
  const match = /\.([a-zA-Z0-9]+)$/.exec(trimmed);
  const ext = (match && match[1] ? match[1] : trimmed).toLowerCase();
  return EXT_TO_MIME[ext] ?? null;
}

/**
 * Sanitizes an untrusted user-supplied filename:
 * - Strips directory traversal characters (`/`, `\`, `..`).
 * - Strips ASCII control characters.
 * - Removes shell/path injection characters.
 * - Binds display filename length to max 128 characters while preserving extension.
 */
export function sanitizeProofFileName(
  rawName: string,
  fallbackExt: string = "png",
): { sanitized: string; ext: string } {
  const baseName = rawName.replace(/^.*[\\/]/, "").trim();

  const cleaned = baseName
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, "") // control chars
    .replace(/[<>:"/\\|?*#%&=+$`~!^{}()[\],;]/g, "_") // dangerous punctuation
    .replace(/\.{2,}/g, ".") // prevent ..
    .replace(/\s+/g, " ")
    .trim();

  const match = /\.([a-zA-Z0-9]+)$/.exec(cleaned);
  let ext = (match ? match[1]! : fallbackExt).toLowerCase();
  if (ext === "jpeg") ext = "jpg";

  let stem = match ? cleaned.slice(0, match.index) : cleaned;
  stem = stem.replace(/^[._-]+|[._-]+$/g, "").trim();
  if (!stem) {
    stem = "payment-proof";
  }

  // Bound stem length to 100 characters so total name <= 128
  if (stem.length > 100) {
    stem = stem.slice(0, 100).trim();
  }

  const sanitized = `${stem}.${ext}`;
  return { sanitized, ext };
}

export interface ValidatedProofDescriptor {
  originalFileName: string;
  sanitizedFileName: string;
  fileExtension: string;
  mimeType: ProofKind;
  fileSize: number;
}

/**
 * Performs server-side validation of a payment-proof file candidate:
 * 1. Checks bounds: 1 byte .. 10 MiB.
 * 2. Checks filename extension against allowed whitelist (jpg, jpeg, png, webp, pdf).
 * 3. Inspects header magic bytes and strictly requires extension to match sniffed signature.
 * 4. Sanitizes display filename against traversal and injection attacks.
 */
export function validateProofHeaderAndMetadata(params: {
  originalName: string;
  fileSize: number;
  headerBytes: Uint8Array;
}): ValidatedProofDescriptor {
  const { originalName, fileSize, headerBytes } = params;

  if (fileSize <= 0) {
    throw new CrmServiceError(400, "empty_file", "Payment proof file is empty (0 bytes).");
  }

  if (fileSize > MAX_PROOF_BYTES) {
    throw new CrmServiceError(
      400,
      "file_too_large",
      "Payment proof file exceeds the 10 MB limit.",
      {
        details: { maxBytes: MAX_PROOF_BYTES, actualBytes: fileSize },
      },
    );
  }

  const expectedKindByExt = extensionToProofKind(originalName);
  if (!expectedKindByExt) {
    throw new CrmServiceError(
      400,
      "invalid_file_type",
      "Only JPG, PNG, WebP or PDF files can be attached as payment proof.",
      {
        details: { allowedExtensions: ["jpg", "jpeg", "png", "webp", "pdf"] },
      },
    );
  }

  const sniffedKind = sniffProofKind(headerBytes);
  if (!sniffedKind) {
    throw new CrmServiceError(
      400,
      "invalid_file_type",
      "File contents do not match any recognized image or PDF signature.",
    );
  }

  if (sniffedKind !== expectedKindByExt) {
    throw new CrmServiceError(
      400,
      "invalid_file_type",
      "File content signature does not match its file extension.",
      {
        details: {
          declaredExtensionKind: expectedKindByExt,
          sniffedKind,
        },
      },
    );
  }

  const { sanitized, ext } = sanitizeProofFileName(originalName, "png");

  return {
    originalFileName: originalName.trim().slice(0, 255),
    sanitizedFileName: sanitized,
    fileExtension: ext,
    mimeType: sniffedKind,
    fileSize,
  };
}
