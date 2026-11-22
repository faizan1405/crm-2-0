import { execFileSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { assertSafeShadowTarget, runSyntheticShadowMigrationTest } from "./migration/index.server";

describe("Checkpoint B13: Synthetic Staging Shadow Testing & Target Guardrails", () => {
  it("passes all 8 synthetic shadow migration assertions (entities, 0-paise parity, idempotency, rollback, Hostinger-only)", () => {
    const result = runSyntheticShadowMigrationTest({ ownerUserId: "usr_owner_b13_shadow" });

    expect(result.ok).toBe(true);
    expect(result.syntheticDataOnly).toBe(true);
    expect(result.realDatabaseTouched).toBe(false);
    expect(result.crmV1Touched).toBe(false);
    expect(result.browserStorageTouched).toBe(false);
    expect(result.hostingPolicy.provider).toBe("hostinger_exclusive");
    expect(result.hostingPolicy.cloudflareR2Required).toBe(false);
    expect(result.hostingPolicy.proofStorageDriver).toBe("mariadb-blob");

    // All 8 assertions pass
    expect(result.assertions).toHaveLength(8);
    for (const assertion of result.assertions) {
      expect(assertion.passed, `${assertion.id}: ${assertion.detail}`).toBe(true);
    }

    // Pass 2 idempotency guarantees 0 duplicate inserts
    expect(result.pass2InsertedTotal).toBe(0);
    // Mid-transaction failure rollback guarantees 0 residual rows
    expect(result.rollbackVerified).toBe(true);
    expect(result.rollbackResidualRows).toBe(0);
    expect(result.errors).toHaveLength(0);
  });

  it("blocks CRM V1, production, and unmarked database targets fail-closed", () => {
    expect(assertSafeShadowTarget({ databaseName: "crm_v1_prod" }).allowed).toBe(false);
    expect(assertSafeShadowTarget({ databaseName: "u256504187_production" }).allowed).toBe(false);
    expect(assertSafeShadowTarget({ databaseName: "u256504187_live_db" }).allowed).toBe(false);
    expect(
      assertSafeShadowTarget({
        databaseName: "u256504187_crm_stg",
        hostName: "crm.joinscaleflow.in",
      }).allowed,
    ).toBe(false);
    expect(assertSafeShadowTarget({ databaseName: "u256504187_crm_main" }).allowed).toBe(false);

    // Safe staging/shadow/disposable target allowed
    expect(
      assertSafeShadowTarget({
        databaseName: "u256504187_crm_b13_shadow",
        hostName: "127.0.0.1",
      }).allowed,
    ).toBe(true);
  });

  it("verifies CLI script exits 0 on synthetic shadow run and blocks --execute-live and CRM V1 targets", () => {
    const scriptPath = path.resolve(process.cwd(), "scripts/b13-shadow-migration-test.mjs");

    // 1. Safe synthetic run
    const out = execFileSync(process.execPath, [scriptPath], { encoding: "utf8" });
    const parsed = JSON.parse(out) as Record<string, unknown>;
    expect(parsed["ok"]).toBe(true);
    expect(parsed["hostingPolicy"]).toBe("hostinger_exclusive");
    expect(parsed["cloudflareR2Required"]).toBe(false);
    expect(parsed["realDatabaseTouched"]).toBe(false);
    expect(parsed["crmV1Touched"]).toBe(false);

    // 2. --execute-live must exit code 2
    let liveExitCode = 0;
    try {
      execFileSync(process.execPath, [scriptPath, "--execute-live"], { stdio: "pipe" });
    } catch (err: unknown) {
      liveExitCode = (err as { status?: number }).status ?? 1;
    }
    expect(liveExitCode).toBe(2);

    // 3. Protected CRM V1 / prod target must exit code 3
    let prodExitCode = 0;
    try {
      execFileSync(process.execPath, [scriptPath, "--target-db", "crm_v1_production"], {
        stdio: "pipe",
      });
    } catch (err: unknown) {
      prodExitCode = (err as { status?: number }).status ?? 1;
    }
    expect(prodExitCode).toBe(3);
  });
});
