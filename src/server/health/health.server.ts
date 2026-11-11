import "@tanstack/react-start/server-only";
import {
  assessProofStorageEnv,
  loadServerEnv,
  summarizeSafeRuntimeEnv,
  type ProofStorageEnvAssessment,
  type ServerEnv,
} from "../config/env.server";
import { getDatabaseStatus } from "../db/index.server";
import { assessProofDirectorySafety } from "../storage/proofStorage.server";

export interface HealthResponseBody {
  ok: true;
  status: "ok";
  service: "scale-flow-crm-v2";
  checkpoint: "b1a";
  runtime: {
    node: string;
    nitroPreset: "node-server";
    env: "development" | "test" | "production";
    timezone: string;
  };
  subsystems: {
    database: {
      configured: boolean;
      driver: "mysql2";
      status: "configured" | "not_configured";
    };
    storage: {
      driver: ServerEnv["PROOF_STORAGE_DRIVER"];
      isolationSafe: boolean;
      productionReady: boolean;
      failClosed: boolean;
      durabilityStatus: ProofStorageEnvAssessment["status"];
    };
    ai: {
      mode: "demo";
    };
  };
  timestamp: string;
}

/**
 * Produces a strictly secret-free health payload for `/api/v1/health`.
 * Does not expose DSNs, passwords, filesystem paths, tokens, or request headers.
 */
export async function getHealthStatus(now: Date = new Date()): Promise<HealthResponseBody> {
  const env = loadServerEnv();
  const safe = summarizeSafeRuntimeEnv(env);
  const dbStatus = await getDatabaseStatus(false);
  const storageCheck = assessProofDirectorySafety(env.PROOF_STORAGE_DIR);
  const storageEnv = assessProofStorageEnv(env);

  return {
    ok: true,
    status: "ok",
    service: "scale-flow-crm-v2",
    checkpoint: "b1a",
    runtime: {
      node: process.version,
      nitroPreset: "node-server",
      env: safe.nodeEnv,
      timezone: safe.businessTimezone,
    },
    subsystems: {
      database: {
        configured: dbStatus.configured,
        driver: dbStatus.driver,
        status: dbStatus.configured ? "configured" : "not_configured",
      },
      storage: {
        driver: safe.proofStorageDriver,
        isolationSafe: !storageCheck.unsafePublicOrBuildPath,
        productionReady: storageEnv.productionReady,
        failClosed: storageEnv.failClosed,
        durabilityStatus: storageEnv.status,
      },
      ai: {
        mode: safe.aiProvider,
      },
    },
    timestamp: now.toISOString(),
  };
}
