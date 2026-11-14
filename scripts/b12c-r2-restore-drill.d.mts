import type { PromotedBaselineResult } from "./b12c-r2-backup-engine.mjs";
import type { R2Config } from "./b12c-r2-client.mjs";

export interface R2RestoreDrillResult {
  ok: boolean;
  archiveKey: string;
  targetDatabase: string;
  statementCount: number;
  durationMs: number;
  completedAt: string;
  verification?: Record<string, unknown>;
  promotedBaseline?: PromotedBaselineResult | null;
}

export declare function runR2RestoreDrill(params: {
  targetConfig: Record<string, unknown>;
  r2Config?: R2Config;
  secretKey?: string;
  archiveKey?: string | null;
  sourceDbName?: string;
  confirmCleanTarget?: boolean;
  promoteBaseline?: boolean;
  stagingRoot?: string;
  fetchImpl?: typeof fetch;
}): Promise<R2RestoreDrillResult>;
