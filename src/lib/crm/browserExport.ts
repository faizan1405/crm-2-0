/**
 * Checkpoint B13B — Owner-Controlled Read-Only Browser Storage Export
 *
 * Reads existing browser-local CRM storage (`scale-flow-crm-2-demo`,
 * `scale-flow-payment-proofs`, `scale-flow-sidebar-groups`,
 * `scale-flow-sidebar-collapsed`) into a complete, SHA-256-verified
 * Data Vault ZIP archive WITHOUT deleting or modifying any browser storage.
 */
import { strToU8, zipSync } from "fflate";
import {
  ALL_CATEGORY_IDS,
  APP_NAME,
  BUSINESS_TZ,
  CATEGORIES,
  FORMAT_VERSION,
  SCHEMA_VERSION,
  scrub,
  sha256,
  type Snapshot,
} from "./vault";
import { idbProofRepo, type ProofRepo } from "./proofRepo";
import { readBytes, type ProofMeta } from "./attachments";

export const BROWSER_CRM_STORAGE_KEY = "scale-flow-crm-2-demo";
export const BROWSER_PROOF_IDB_NAME = "scale-flow-payment-proofs";
export const BROWSER_SIDEBAR_GROUPS_KEY = "scale-flow-sidebar-groups";
export const BROWSER_SIDEBAR_COLLAPSED_KEY = "scale-flow-sidebar-collapsed";

export interface BrowserStorageReader {
  getItem(key: string): string | null;
}

export interface BrowserExportSummary {
  ok: boolean;
  exportedAt: string;
  filename: string;
  zipBytesLength: number;
  browserStorageModified: false;
  storageKeysInspected: string[];
  crmStoreFound: boolean;
  crmStoreVersion: number | null;
  categoryCounts: Record<string, number>;
  proofsExpected: number;
  proofsIncluded: number;
  proofsMissing: string[];
  uiPreferencesIncluded: boolean;
  manifestSha256: string;
}

export interface BrowserExportResult {
  zipBytes: Uint8Array;
  summary: BrowserExportSummary;
}

const safeName = (n: string) => n.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 80) || "file";

function countOf(v: unknown): number {
  return Array.isArray(v)
    ? v.length
    : v && typeof v === "object"
      ? Object.keys(v).length
      : v === undefined || v === null
        ? 0
        : 1;
}

/**
 * Strictly read-only export of browser-local CRM data + IndexedDB payment proofs + UI preferences.
 * Requires explicit `ownerConfirmed: true` so real browser storage is never read implicitly.
 */
export async function exportBrowserCrmSnapshot(options: {
  ownerConfirmed: boolean;
  storage?: BrowserStorageReader;
  proofRepo?: Pick<ProofRepo, "list" | "get">;
  now?: Date;
}): Promise<BrowserExportResult> {
  if (!options.ownerConfirmed) {
    throw new Error(
      "Explicit Owner confirmation is required before reading or exporting browser-local CRM storage.",
    );
  }

  const storage: BrowserStorageReader =
    options.storage ??
    (typeof window !== "undefined" && window.localStorage
      ? window.localStorage
      : { getItem: () => null });
  const proofRepo = options.proofRepo ?? idbProofRepo;
  const now = options.now ?? new Date();

  const storageKeysInspected = [
    BROWSER_CRM_STORAGE_KEY,
    BROWSER_PROOF_IDB_NAME,
    BROWSER_SIDEBAR_GROUPS_KEY,
    BROWSER_SIDEBAR_COLLAPSED_KEY,
  ];

  // 1. Read localStorage CRM state (READ-ONLY)
  const rawCrm = storage.getItem(BROWSER_CRM_STORAGE_KEY);
  let crmStoreFound = false;
  let crmStoreVersion: number | null = null;
  let rawState: Snapshot = {};

  if (rawCrm) {
    const parsed = JSON.parse(rawCrm) as { state?: Snapshot; version?: number };
    crmStoreFound = true;
    crmStoreVersion = typeof parsed.version === "number" ? parsed.version : null;
    rawState =
      parsed.state && typeof parsed.state === "object" ? parsed.state : (parsed as Snapshot);
  }

  // Scrub credentials while preserving custom field value maps
  const cleanState: Snapshot = {
    ...scrub(rawState),
    ...(rawState["fieldValues"] !== undefined ? { fieldValues: rawState["fieldValues"] } : {}),
    ...(rawState["projectFieldValues"] !== undefined
      ? { projectFieldValues: rawState["projectFieldValues"] }
      : {}),
  };

  // 2. Read sidebar UI preferences (READ-ONLY)
  const rawSidebarGroups = storage.getItem(BROWSER_SIDEBAR_GROUPS_KEY);
  const rawSidebarCollapsed = storage.getItem(BROWSER_SIDEBAR_COLLAPSED_KEY);
  let sidebarGroups: unknown = null;
  if (rawSidebarGroups) {
    try {
      sidebarGroups = JSON.parse(rawSidebarGroups);
    } catch {
      sidebarGroups = rawSidebarGroups;
    }
  }
  const uiPreferencesIncluded = rawSidebarGroups !== null || rawSidebarCollapsed !== null;

  // 3. Build category JSON files (preserving all 21 categories including deferred collections)
  const files: Record<string, Uint8Array> = {};
  const categoryCounts: Record<string, number> = {};

  for (const cat of CATEGORIES) {
    if (cat.id === "proofs") continue;
    const data = Object.fromEntries(cat.keys.map((k) => [k, cleanState[k] ?? null]));
    files[cat.file] = strToU8(JSON.stringify(data, null, 2));
    categoryCounts[cat.id] =
      cat.id === "settings" ? (crmStoreFound ? 1 : 0) : countOf(cleanState[cat.keys[0]!]);
  }

  files["data/ui-preferences.json"] = strToU8(
    JSON.stringify(
      {
        storageKeys: {
          [BROWSER_SIDEBAR_GROUPS_KEY]: sidebarGroups,
          [BROWSER_SIDEBAR_COLLAPSED_KEY]: rawSidebarCollapsed,
        },
      },
      null,
      2,
    ),
  );

  // 4. Read IndexedDB payment proofs (READ-ONLY) preserving binary receipts & payment links
  let metas: ProofMeta[] = [];
  try {
    metas = await proofRepo.list();
  } catch {
    metas = [];
  }

  const proofsMissing: string[] = [];
  let proofsIncluded = 0;
  const attachmentEntries: Array<ProofMeta & { path: string | null; sha256: string | null }> = [];

  for (const meta of metas) {
    try {
      const rec = await proofRepo.get(meta.paymentId);
      if (!rec || !rec.blob) {
        proofsMissing.push(meta.paymentId);
        attachmentEntries.push({ ...meta, path: null, sha256: null });
        continue;
      }
      const bytes = new Uint8Array(await readBytes(rec.blob));
      if (bytes.byteLength === 0) {
        proofsMissing.push(meta.paymentId);
        attachmentEntries.push({ ...meta, path: null, sha256: null });
        continue;
      }
      const path = `files/payment-proofs/${safeName(meta.attachmentId)}__${safeName(meta.originalFileName)}`;
      const digest = await sha256(bytes);
      files[path] = bytes;
      proofsIncluded++;
      attachmentEntries.push({
        ...meta,
        fileSize: bytes.byteLength,
        path,
        sha256: digest,
      });
    } catch {
      proofsMissing.push(meta.paymentId);
      attachmentEntries.push({ ...meta, path: null, sha256: null });
    }
  }

  files["data/attachment-metadata.json"] = strToU8(
    JSON.stringify({ attachments: attachmentEntries }, null, 2),
  );
  categoryCounts["proofs"] = proofsIncluded;

  // 5. Build SHA-256 verified manifest.json
  const manifestFiles: Array<{ path: string; sha256: string; bytes: number }> = [];
  for (const [path, bytes] of Object.entries(files).sort(([a], [b]) => a.localeCompare(b))) {
    manifestFiles.push({
      path,
      sha256: await sha256(bytes),
      bytes: bytes.byteLength,
    });
  }

  const manifest = {
    app: APP_NAME,
    formatVersion: FORMAT_VERSION,
    schemaVersion: SCHEMA_VERSION,
    createdAt: now.toISOString(),
    timezone: BUSINESS_TZ,
    type: "full",
    complete: crmStoreFound && proofsMissing.length === 0,
    included: ALL_CATEGORY_IDS,
    omitted: [],
    counts: categoryCounts,
    attachments: {
      expected: metas.length,
      included: proofsIncluded,
      missing: proofsMissing,
    },
    storageKeysInspected,
    browserStorageModified: false,
    files: manifestFiles,
  };

  const manifestBytes = strToU8(JSON.stringify(manifest, null, 2));
  files["manifest.json"] = manifestBytes;
  const manifestSha256 = await sha256(manifestBytes);

  const zipBytes = zipSync(files, { level: 6 });
  const stamp = now.toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const filename = `ScaleFlow_Browser_Export_${stamp}.zip`;

  return {
    zipBytes,
    summary: {
      ok: true,
      exportedAt: now.toISOString(),
      filename,
      zipBytesLength: zipBytes.byteLength,
      browserStorageModified: false,
      storageKeysInspected,
      crmStoreFound,
      crmStoreVersion,
      categoryCounts,
      proofsExpected: metas.length,
      proofsIncluded,
      proofsMissing,
      uiPreferencesIncluded,
      manifestSha256,
    },
  };
}
