import "@tanstack/react-start/server-only";

const FORBIDDEN_CREDENTIAL_KEY_RE =
  /pass(word)?|hash|token|secret|session|cookie|api[_-]?key|private[_-]?key|auth[_-]?header/i;

const PROTECTED_TARGET_PATTERNS = [
  /crm\.joinscaleflow\.in/i,
  /^prod(_|-|$)/i,
  /(_|-)prod(_|-|$)/i,
  /production/i,
  /crm[_-]?v1/i,
  /(_|-)live(_|-|$)/i,
  /^live(_|-|$)/i,
];

export interface TargetSafetyCheckResult {
  allowed: boolean;
  reason?: string;
}

/**
 * Fail-closed guard that refuses CRM V1, production, or live database/host targets
 * during B13 staging shadow testing.
 */
export function assertSafeShadowTarget(target: {
  databaseName?: string | null;
  hostName?: string | null;
  explicitlyApprovedStaging?: boolean;
}): TargetSafetyCheckResult {
  const dbName = (target.databaseName ?? "").trim();
  const hostName = (target.hostName ?? "").trim();

  if (!dbName) {
    return { allowed: false, reason: "Target database name is required for shadow target validation." };
  }

  for (const pattern of PROTECTED_TARGET_PATTERNS) {
    if (pattern.test(dbName)) {
      return {
        allowed: false,
        reason: `Target database '${dbName}' matches a protected production/CRM-V1 pattern and is blocked.`,
      };
    }
    if (hostName && pattern.test(hostName)) {
      return {
        allowed: false,
        reason: `Target host '${hostName}' matches a protected production/CRM-V1 pattern and is blocked.`,
      };
    }
  }

  if (
    !target.explicitlyApprovedStaging &&
    !/shadow|staging|stg|disposable|test|sandbox|tmp/i.test(dbName)
  ) {
    return {
      allowed: false,
      reason: `Target database '${dbName}' is not clearly marked as a staging/shadow/disposable target.`,
    };
  }

  return { allowed: true };
}

/**
 * Recursively scrubs any credential-like keys from imported legacy records,
 * returning both the scrubbed clone and the exact number of removed fields.
 * Preserves custom field value maps (`fieldValues`, `projectFieldValues`) which are keyed by user-chosen IDs.
 */
export function scrubLegacyCredentials<T>(
  value: T,
  exemptParentKeys: ReadonlySet<string> = new Set(["fieldValues", "projectFieldValues"]),
): { cleaned: T; scrubbedCount: number } {
  let scrubbedCount = 0;

  function walk(node: unknown, bypassKeyCheck = false): unknown {
    if (Array.isArray(node)) {
      return node.map((item) => walk(item, false));
    }
    if (node && typeof node === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        if (!bypassKeyCheck && FORBIDDEN_CREDENTIAL_KEY_RE.test(k)) {
          scrubbedCount++;
          continue;
        }
        out[k] = walk(v, bypassKeyCheck || exemptParentKeys.has(k));
      }
      return out;
    }
    return node;
  }

  return { cleaned: walk(value) as T, scrubbedCount };
}

/**
 * Verifies magic bytes for supported payment proof formats (JPEG, PNG, WebP, PDF).
 */
export function sniffProofMagicBytes(bytes: Uint8Array): {
  valid: boolean;
  detectedMime: string | null;
} {
  if (bytes.byteLength < 12) {
    return { valid: false, detectedMime: null };
  }
  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { valid: true, detectedMime: "image/jpeg" };
  }
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return { valid: true, detectedMime: "image/png" };
  }
  // WebP: RIFF....WEBP
  if (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return { valid: true, detectedMime: "image/webp" };
  }
  // PDF: %PDF-
  if (
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46 &&
    bytes[4] === 0x2d
  ) {
    return { valid: true, detectedMime: "application/pdf" };
  }
  return { valid: false, detectedMime: null };
}
