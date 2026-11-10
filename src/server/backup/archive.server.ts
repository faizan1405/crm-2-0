import "@tanstack/react-start/server-only";
import { strToU8, zipSync } from "fflate";
import { canonicalJsonStringify } from "./manifest.server";
import type { BackupManifest } from "./types.server";

export interface CreateArchiveInput {
  manifest: BackupManifest;
  dataFiles: Record<string, unknown>;
  attachments?: Record<string, Uint8Array>;
  summaryHtml?: string;
}

/**
 * Builds a deterministic, valid compressed ZIP archive Uint8Array from manifest, data files, and attachments.
 */
export function buildBackupZipArchive(input: CreateArchiveInput): Uint8Array {
  const files: Record<string, Uint8Array> = {};

  // 1. Data files (canonical JSON)
  for (const [path, data] of Object.entries(input.dataFiles)) {
    files[path] = strToU8(canonicalJsonStringify(data));
  }

  // 2. Binary attachments (raw bytes)
  if (input.attachments) {
    for (const [path, bytes] of Object.entries(input.attachments)) {
      files[path] = bytes;
    }
  }

  // 3. Optional summary HTML
  if (input.summaryHtml) {
    files["backup-summary.html"] = strToU8(input.summaryHtml);
  }

  // 4. Manifest (canonical JSON)
  files["manifest.json"] = strToU8(canonicalJsonStringify(input.manifest));

  // Produce genuine compressed ZIP bytes
  return zipSync(files, { level: 6 });
}
