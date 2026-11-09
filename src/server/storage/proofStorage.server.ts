import "@tanstack/react-start/server-only";
import path from "node:path";

export type ProofStorageDriverKind = "local-fs" | "object-storage";

export interface StoredProofDescriptor {
  storageKey: string;
  byteSize: number;
  sha256: string;
  mimeType: string;
}

/**
 * Private payment-proof storage contract implemented in Checkpoint B3.
 * Never store files in public web directories or expose unsigned direct URLs.
 */
export interface ProofStorageBackend {
  readonly driver: ProofStorageDriverKind;
  healthSummary(): {
    driver: ProofStorageDriverKind;
    configured: boolean;
    persistentWarning: boolean;
  };
}

const SAFE_STORAGE_KEY_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/** Validates a proof storage key so path traversal and OS-specific separators are impossible. */
export function isValidProofStorageKey(key: string): boolean {
  if (!SAFE_STORAGE_KEY_RE.test(key)) return false;
  if (key.includes("..")) return false;
  return true;
}

/**
 * Resolves an attachment storage path inside `baseDir` and refuses any escape outside `baseDir`.
 */
export function resolveSafeProofPath(baseDir: string, storageKey: string): string {
  if (!isValidProofStorageKey(storageKey)) {
    throw new Error("Invalid payment proof storage key");
  }
  const root = path.resolve(baseDir);
  const candidate = path.resolve(root, storageKey);
  if (candidate !== root && !candidate.startsWith(`${root}${path.sep}`)) {
    throw new Error("Refusing payment proof path outside private storage root");
  }
  return candidate;
}

export interface ProofDirectoryAssessment {
  resolvedPath: string;
  unsafePublicOrBuildPath: boolean;
  reasons: string[];
}

const UNSAFE_SEGMENTS = ["public_html", "public", ".output", "dist", "hbuilds"];

/**
 * Flags local filesystem paths that are web-exposed (`public_html`, `public`)
 * or ephemeral across Hostinger redeployments (`hbuilds`, `.output`, `dist`).
 */
export function assessProofDirectorySafety(
  rawDir: string,
  appCwd: string = process.cwd(),
): ProofDirectoryAssessment {
  const resolvedPath = path.isAbsolute(rawDir)
    ? path.resolve(rawDir)
    : path.resolve(appCwd, rawDir);

  const normalized = resolvedPath.replace(/\\/g, "/").toLowerCase();
  const segments = normalized.split("/").filter(Boolean);
  const reasons: string[] = [];

  for (const segment of UNSAFE_SEGMENTS) {
    if (segments.includes(segment)) {
      reasons.push(
        `Path passes through "${segment}", which may be public or replaced on redeploy.`,
      );
    }
  }

  return {
    resolvedPath,
    unsafePublicOrBuildPath: reasons.length > 0,
    reasons,
  };
}
