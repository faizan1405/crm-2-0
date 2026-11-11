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
 * Sniffs the authentic file MIME kind from the header magic bytes of the file.
 * Supports JPG/JPEG, PNG, WebP, and PDF cleanly matching `src/lib/crm/attachments.ts`.
 */
export function sniffProofKind(bytes: Uint8Array): ProofKind | null {
  if (
    bytes.length >= 4 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff &&
    bytes[3]! >= 0xc0 &&
    bytes[3]! < 0xff
  ) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 12 &&
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
    bytes.length >= 16 &&
    String.fromCharCode(bytes[0]!, bytes[1]!, bytes[2]!, bytes[3]!) === "RIFF" &&
    String.fromCharCode(bytes[8]!, bytes[9]!, bytes[10]!, bytes[11]!) === "WEBP"
  ) {
    const vp8Tag = String.fromCharCode(bytes[12]!, bytes[13]!, bytes[14]!, bytes[15]!);
    if (vp8Tag === "VP8 " || vp8Tag === "VP8L" || vp8Tag === "VP8X") {
      return "image/webp";
    }
  }
  if (
    bytes.length >= 8 &&
    /^%PDF-\d\.\d/.test(
      String.fromCharCode(
        bytes[0]!,
        bytes[1]!,
        bytes[2]!,
        bytes[3]!,
        bytes[4]!,
        bytes[5]!,
        bytes[6]!,
        bytes[7]!,
      ),
    )
  ) {
    return "application/pdf";
  }
  return null;
}

export function normalizeDeclaredProofMimeType(raw?: string | null): string | null {
  if (!raw || typeof raw !== "string") return null;
  const base = raw.split(";")[0]?.trim().toLowerCase() ?? "";
  if (!base || base === "application/octet-stream" || base === "binary/octet-stream") {
    return null;
  }
  if (base === "image/jpg") return "image/jpeg";
  return base;
}

/**
 * Validates container-level structure for full uploaded payloads to reject truncated or corrupted files
 * without false-rejecting minimal test signatures that omit full image streams.
 */
export function validateProofContainerStructure(kind: ProofKind, bytes: Uint8Array): void {
  if (kind === "image/jpeg") {
    // Only require trailing EOI (FF D9) if the JPEG payload has compressed scan/frame headers (SOF/SOS)
    let hasFrameOrScan = false;
    for (let i = 2; i < bytes.length - 1; i++) {
      if (bytes[i] === 0xff) {
        const marker = bytes[i + 1]!;
        if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2 || marker === 0xda) {
          hasFrameOrScan = true;
          break;
        }
      }
    }
    if (hasFrameOrScan) {
      let end = bytes.length;
      while (end > 2 && bytes[end - 1] === 0x00 && bytes.length - end < 16) {
        end--;
      }
      if (end < 4 || bytes[end - 2] !== 0xff || bytes[end - 1] !== 0xd9) {
        throw new CrmServiceError(
          400,
          "file_corrupted",
          "JPEG payment proof appears truncated or missing end-of-image marker.",
        );
      }
    }
    return;
  }

  if (kind === "image/png") {
    const tag12 =
      bytes.length >= 16 ? String.fromCharCode(bytes[12]!, bytes[13]!, bytes[14]!, bytes[15]!) : "";
    if (tag12 === "IHDR") {
      if (bytes.length < 33) {
        throw new CrmServiceError(
          400,
          "file_corrupted",
          "PNG payment proof has a truncated IHDR header chunk.",
        );
      }
      const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const width = dv.getUint32(16, false);
      const height = dv.getUint32(20, false);
      if (width === 0 || height === 0) {
        throw new CrmServiceError(
          400,
          "file_corrupted",
          "PNG payment proof has invalid zero image dimensions.",
        );
      }
      const tailText = Buffer.from(bytes.subarray(Math.max(0, bytes.length - 64))).toString(
        "latin1",
      );
      if (!tailText.includes("IEND")) {
        throw new CrmServiceError(
          400,
          "file_corrupted",
          "PNG payment proof appears truncated or missing IEND chunk.",
        );
      }
    }
    return;
  }

  if (kind === "image/webp") {
    if (bytes.length > 16) {
      const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const riffPayloadSize = dv.getUint32(4, true);
      const expectedTotal = riffPayloadSize + 8;
      if (expectedTotal > bytes.length + 1) {
        throw new CrmServiceError(
          400,
          "file_corrupted",
          "WebP payment proof appears truncated compared to its RIFF container length.",
        );
      }
    }
    return;
  }

  if (kind === "application/pdf") {
    const textSample = Buffer.from(bytes).toString("latin1");
    if (/\b\d+\s+\d+\s+obj\b/.test(textSample) || /\btrailer\b|\bxref\b/.test(textSample)) {
      const tailSlice = Buffer.from(bytes.subarray(Math.max(0, bytes.length - 1024))).toString(
        "latin1",
      );
      if (!tailSlice.includes("%%EOF")) {
        throw new CrmServiceError(
          400,
          "file_corrupted",
          "PDF payment proof appears truncated or missing %%EOF trailer.",
        );
      }
    }
  }
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
  declaredMimeType?: string | null | undefined;
  fullBytes?: Uint8Array | undefined;
}): ValidatedProofDescriptor {
  const { originalName, fileSize, headerBytes, declaredMimeType, fullBytes } = params;

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

  const normalizedDeclaredMime = normalizeDeclaredProofMimeType(declaredMimeType);
  if (normalizedDeclaredMime && normalizedDeclaredMime !== sniffedKind) {
    throw new CrmServiceError(
      400,
      "invalid_file_type",
      "Declared MIME Content-Type does not match detected file signature.",
      {
        details: {
          declaredMimeType: normalizedDeclaredMime,
          sniffedKind,
        },
      },
    );
  }

  if (fullBytes) {
    validateProofContainerStructure(sniffedKind, fullBytes);
  } else {
    validateProofContainerStructure(sniffedKind, headerBytes);
  }

  const { sanitized, ext } = sanitizeProofFileName(originalName, "png");

  return {
    originalFileName: sanitized,
    sanitizedFileName: sanitized,
    fileExtension: ext,
    mimeType: sniffedKind,
    fileSize,
  };
}
