import { useMutation, useQuery } from "@tanstack/react-query";
import { useResolvedAuthState } from "@/lib/auth/authClient";
import type {
  BackupClassification,
  BackupFinancialSummary,
  BackupManifest,
  DryRunActionSummary,
  DryRunReport,
  ValidationReport,
} from "@/server/backup/types.server";
import { type VaultBlocker, type VaultInventoryItem } from "@/server/vault/vaultService.server";

export type {
  BackupClassification,
  BackupFinancialSummary,
  BackupManifest,
  DryRunActionSummary,
  DryRunReport,
  ValidationReport,
  VaultBlocker,
  VaultInventoryItem,
};

export interface VaultLiveDatabaseCounts {
  leads: number;
  deals: number;
  payments: number;
  paymentProofs: number;
  projects: number;
  projectTasks: number;
  quotations: number;
  salesGoals: number;
  ownerSettings: number;
}

export interface VaultCoverageResponse {
  ok: boolean;
  coverage: {
    totalEntitiesInventoried: number;
    verifiedEntitiesCount: number;
    supportedEntitiesCount: number;
    unsupportedEntitiesCount: number;
    liveDatabaseCounts: VaultLiveDatabaseCounts;
    blockers: VaultBlocker[];
    inventory: VaultInventoryItem[];
    restoreDisabled: boolean;
  };
}

export interface InspectArchiveResponse {
  ok: boolean;
  validation: ValidationReport;
}

export interface DryRunResponse {
  ok: boolean;
  dryRunReport: DryRunReport;
}

export interface VaultRestoreForbiddenResponse {
  ok: false;
  error: {
    code: "RESTORE_EXECUTION_DISABLED";
    message: string;
  };
}

/**
 * Fetches backup coverage, inventory status, and blocker warnings from the server.
 */
export async function fetchVaultCoverage(): Promise<VaultCoverageResponse> {
  const res = await fetch("/api/v1/vault/coverage", {
    method: "GET",
    headers: {
      Accept: "application/json",
    },
    credentials: "same-origin",
  });

  if (!res.ok) {
    let errorMsg = `Server returned HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { error?: { message?: string } };
      if (body?.error?.message) errorMsg = body.error.message;
    } catch {
      // Keep default
    }
    throw new Error(errorMsg);
  }

  return (await res.json()) as VaultCoverageResponse;
}

/**
 * Requests and initiates browser download of a genuine synthetic ZIP backup archive.
 */
export async function downloadSyntheticBackup(
  scope: "full" | "sales" | "projects" = "full",
): Promise<{ filename: string; bytes: number }> {
  const res = await fetch(`/api/v1/vault/synthetic-backup?scope=${scope}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ scope }),
    credentials: "same-origin",
  });

  if (!res.ok) {
    let errorMsg = `Failed to generate synthetic backup: HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { error?: { message?: string } };
      if (body?.error?.message) errorMsg = body.error.message;
    } catch {
      // Keep default
    }
    throw new Error(errorMsg);
  }

  const disposition = res.headers.get("content-disposition") ?? "";
  let filename = `ScaleFlow_Synthetic_Test_Backup_${scope}.zip`;
  const match = /filename=["']?([^"';]+)["']?/.exec(disposition);
  if (match && match[1]) {
    filename = match[1];
  }

  const blob = await res.blob();
  const bytes = blob.size;

  if (typeof window !== "undefined") {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  return { filename, bytes };
}

/**
 * Uploads a ZIP archive to /api/v1/vault/inspect for cryptographic and structural verification.
 */
export async function inspectBackupArchive(
  fileOrBytes: File | Blob | Uint8Array,
  filename = "backup.zip",
): Promise<InspectArchiveResponse> {
  const formData = new FormData();
  if (fileOrBytes instanceof Uint8Array) {
    const blob = new Blob([fileOrBytes as unknown as BlobPart], { type: "application/zip" });
    formData.append("file", blob, filename);
  } else {
    formData.append("file", fileOrBytes, fileOrBytes instanceof File ? fileOrBytes.name : filename);
  }

  const res = await fetch("/api/v1/vault/inspect", {
    method: "POST",
    body: formData,
    credentials: "same-origin",
  });

  const data = (await res.json()) as InspectArchiveResponse;
  return data;
}

/**
 * Uploads a ZIP archive to /api/v1/vault/dry-run for completely non-destructive restore simulation.
 */
export async function runRestoreDryRun(
  fileOrBytes: File | Blob | Uint8Array,
  filename = "backup.zip",
): Promise<DryRunResponse> {
  const formData = new FormData();
  if (fileOrBytes instanceof Uint8Array) {
    const blob = new Blob([fileOrBytes as unknown as BlobPart], { type: "application/zip" });
    formData.append("file", blob, filename);
  } else {
    formData.append("file", fileOrBytes, fileOrBytes instanceof File ? fileOrBytes.name : filename);
  }

  const res = await fetch("/api/v1/vault/dry-run", {
    method: "POST",
    body: formData,
    credentials: "same-origin",
  });

  const data = (await res.json()) as DryRunResponse;
  return data;
}

/**
 * Confirms that calling the restore endpoint is strictly forbidden and returns 403.
 */
export async function verifyRestoreExecutionDisabled(): Promise<VaultRestoreForbiddenResponse> {
  const res = await fetch("/api/v1/vault/restore", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ confirm: true }),
    credentials: "same-origin",
  });

  if (res.status !== 403) {
    throw new Error(`Expected HTTP 403 Forbidden for restore endpoint, but received ${res.status}`);
  }

  const data = (await res.json()) as VaultRestoreForbiddenResponse;
  return data;
}

// ---------------------------------------------------------------------------
// React Query Hooks
// ---------------------------------------------------------------------------

export const VAULT_QUERY_KEY = ["vault", "coverage"] as const;

export function useVaultCoverageQuery() {
  const auth = useResolvedAuthState();
  const enabled = auth.status === "authenticated";

  return useQuery({
    queryKey: VAULT_QUERY_KEY,
    queryFn: fetchVaultCoverage,
    enabled,
    staleTime: 15_000,
  });
}

export function useInspectArchiveMutation() {
  return useMutation({
    mutationFn: (file: File | Blob | Uint8Array) => inspectBackupArchive(file),
  });
}

export function useDryRunMutation() {
  return useMutation({
    mutationFn: (file: File | Blob | Uint8Array) => runRestoreDryRun(file),
  });
}
