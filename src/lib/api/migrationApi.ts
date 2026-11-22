import { useQuery } from "@tanstack/react-query";
import { useResolvedAuthState } from "@/lib/auth/authClient";
import type {
  DeferredCollectionReport,
  FinancialReconciliationReport,
  HostingerCapacityEstimate,
  MigrationAnalysisReport,
  MigrationEntityKey,
  MigrationEntitySummary,
  MigrationReadinessResponse,
  ProofMigrationCheck,
  ShadowMigrationTestReport,
  ShadowTestAssertion,
} from "@/server/migration/types.server";

export type {
  DeferredCollectionReport,
  FinancialReconciliationReport,
  HostingerCapacityEstimate,
  MigrationAnalysisReport,
  MigrationEntityKey,
  MigrationEntitySummary,
  MigrationReadinessResponse,
  ProofMigrationCheck,
  ShadowMigrationTestReport,
  ShadowTestAssertion,
};

export interface AnalyzeMigrationResponse {
  ok: boolean;
  analysis: MigrationAnalysisReport;
}

export interface SyntheticShadowTestResponse {
  ok: boolean;
  shadowReport: ShadowMigrationTestReport;
}

export async function fetchMigrationReadiness(): Promise<MigrationReadinessResponse> {
  const res = await fetch("/api/v1/vault/migration/readiness", {
    method: "GET",
    headers: { Accept: "application/json" },
    credentials: "same-origin",
  });
  if (!res.ok) {
    let msg = `Server returned HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { error?: { message?: string } };
      if (body?.error?.message) msg = body.error.message;
    } catch {
      // keep default
    }
    throw new Error(msg);
  }
  return (await res.json()) as MigrationReadinessResponse;
}

export async function analyzeMigrationArchive(
  fileOrBytes: File | Blob | Uint8Array,
  filename = "migration-backup.zip",
): Promise<AnalyzeMigrationResponse> {
  const formData = new FormData();
  const resolvedName = fileOrBytes instanceof File ? fileOrBytes.name : filename;
  if (fileOrBytes instanceof Uint8Array) {
    const blob = new Blob([fileOrBytes as unknown as BlobPart], { type: "application/zip" });
    formData.append("file", blob, resolvedName);
  } else {
    formData.append("file", fileOrBytes, resolvedName);
  }

  const res = await fetch("/api/v1/vault/migration/analyze", {
    method: "POST",
    headers: {
      "x-migration-filename": resolvedName,
    },
    body: formData,
    credentials: "same-origin",
  });

  if (!res.ok) {
    let msg = `Failed to analyze migration source (HTTP ${res.status})`;
    try {
      const body = (await res.json()) as { error?: { message?: string } };
      if (body?.error?.message) msg = body.error.message;
    } catch {
      // keep default
    }
    throw new Error(msg);
  }

  return (await res.json()) as AnalyzeMigrationResponse;
}

export async function runSyntheticShadowTest(): Promise<SyntheticShadowTestResponse> {
  const res = await fetch("/api/v1/vault/migration/synthetic-shadow-test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ syntheticOnly: true }),
    credentials: "same-origin",
  });

  if (!res.ok) {
    let msg = `Synthetic shadow test failed (HTTP ${res.status})`;
    try {
      const body = (await res.json()) as { error?: { message?: string } };
      if (body?.error?.message) msg = body.error.message;
    } catch {
      // keep default
    }
    throw new Error(msg);
  }

  return (await res.json()) as SyntheticShadowTestResponse;
}

export function useMigrationReadinessQuery() {
  const auth = useResolvedAuthState();
  return useQuery({
    queryKey: ["vault", "migration", "readiness"],
    queryFn: fetchMigrationReadiness,
    enabled: auth.status === "authenticated",
    staleTime: 60_000,
    retry: 1,
  });
}
