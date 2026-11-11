import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { assessProofStorageEnv, parseServerEnv } from "./config/env.server";
import { assessProofDirectorySafety } from "./storage/proofStorage.server";
import { VAULT_BLOCKERS } from "./vault/vaultService.server";
import {
  assertSafeStagingOrigin,
  CRM_V1_FORBIDDEN_HOST,
  STAGING_DURABILITY_PLAN,
} from "../../scripts/b11c-staging-durability-harness.mjs";

const REPO_ROOT = process.cwd();
const INFRA_DIR = path.join(REPO_ROOT, "infra", "hostinger-vps");
const TEMPLATES_DIR = path.join(INFRA_DIR, "templates");
const SCRIPTS_DIR = path.join(INFRA_DIR, "scripts");

function parseEnvTemplate(raw: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eqIdx = line.indexOf("=");
    if (eqIdx <= 0) continue;
    result[line.slice(0, eqIdx).trim()] = line.slice(eqIdx + 1).trim();
  }
  return result;
}

describe("Checkpoint B11C-PRE Hostinger VPS Deployment Preparation & Safety Gate", () => {
  it("contains all required templates, scripts, README, and B11C-PRE runbook", () => {
    const requiredFiles = [
      path.join(REPO_ROOT, "docs", "crm-b11c-pre-vps-deployment-prep.md"),
      path.join(REPO_ROOT, "scripts", "b11c-staging-durability-harness.mjs"),
      path.join(INFRA_DIR, "README.md"),
      path.join(TEMPLATES_DIR, "crm.env.example"),
      path.join(TEMPLATES_DIR, "nginx-scaleflow-crm.conf.template"),
      path.join(TEMPLATES_DIR, "scaleflow-crm.service.template"),
      path.join(TEMPLATES_DIR, "mariadb-crm.cnf.template"),
      path.join(TEMPLATES_DIR, "logrotate-scaleflow-crm.template"),
      path.join(SCRIPTS_DIR, "lib-common.sh"),
      path.join(SCRIPTS_DIR, "01-bootstrap-vps.sh"),
      path.join(SCRIPTS_DIR, "02-install-node-mariadb.sh"),
      path.join(SCRIPTS_DIR, "03-configure-nginx-tls.sh"),
      path.join(SCRIPTS_DIR, "04-validate-env-and-preflight.sh"),
      path.join(SCRIPTS_DIR, "05-deploy-release.sh"),
      path.join(SCRIPTS_DIR, "06-rollback-release.sh"),
      path.join(SCRIPTS_DIR, "07-backup-encrypted.sh"),
      path.join(SCRIPTS_DIR, "08-restore-verify.sh"),
    ];

    for (const filePath of requiredFiles) {
      expect(fs.existsSync(filePath), `Missing B11C-PRE artifact: ${filePath}`).toBe(true);
    }
  });

  it("keeps crm.env.example secret-free, fail-closed, loopback-bound, and B11A-compatible", () => {
    const raw = fs.readFileSync(path.join(TEMPLATES_DIR, "crm.env.example"), "utf8");
    const templateEnv = parseEnvTemplate(raw);

    expect(templateEnv["NODE_ENV"]).toBe("production");
    expect(templateEnv["HOST"]).toBe("127.0.0.1");
    expect(templateEnv["PORT"]).toBe("3000");
    expect(templateEnv["DB_HOST"]).toBe("127.0.0.1");
    expect(templateEnv["AUTH_TRUST_PROXY"]).toBe("true");
    expect(templateEnv["DEV_LEAD_PILOT"]).toBe("false");
    expect(templateEnv["AUTOMATION_TEST_DB_ALLOWLIST"]).toBeUndefined();
    expect(templateEnv["PROOF_STORAGE_DRIVER"]).toBe("hostinger-private-fs");
    expect(templateEnv["PROOF_STORAGE_DIR"]).toBe("/var/lib/scaleflow-crm/private-proofs");
    expect(templateEnv["PROOF_PRODUCTION_DURABLE_CONFIRMED"]).toBe("false");
    expect(templateEnv["BACKUP_OFF_VPS_STATUS"]).toBe("UNRESOLVED_OWNER_DECISION");
    expect(raw).not.toMatch(/AGE-SECRET-KEY-1[A-Z0-9]{20,}/);
    expect(templateEnv["APP_ORIGIN"]).not.toContain("crm.joinscaleflow.in");
    expect(Object.values(templateEnv).join("\n")).not.toContain("crm.joinscaleflow.in");

    // Verify path isolation using B11A's own safety check (must be outside web/build segments)
    const dirSafety = assessProofDirectorySafety(templateEnv["PROOF_STORAGE_DIR"]!);
    expect(dirSafety.unsafePublicOrBuildPath).toBe(false);

    // Before B11C verification confirms PROOF_PRODUCTION_DURABLE_CONFIRMED=true, env stays fail-closed!
    const parsedBlocked = parseServerEnv({
      ...templateEnv,
      APP_ORIGIN: "https://staging-v2.joinscaleflow.in",
    });
    const blockedAssessment = assessProofStorageEnv(parsedBlocked);
    expect(blockedAssessment.failClosed).toBe(true);
    expect(blockedAssessment.status).toBe("blocked_durability_unverified");

    // Once B11C passes and Owner flips PROOF_PRODUCTION_DURABLE_CONFIRMED=true, assessment succeeds cleanly
    const parsedReady = parseServerEnv({
      ...templateEnv,
      APP_ORIGIN: "https://staging-v2.joinscaleflow.in",
      PROOF_PRODUCTION_DURABLE_CONFIRMED: "true",
    });
    const readyAssessment = assessProofStorageEnv(parsedReady);
    expect(readyAssessment.failClosed).toBe(false);
    expect(readyAssessment.productionReady).toBe(true);
    expect(readyAssessment.status).toBe("production_verified_private_dir");
  });

  it("maintains strict CRM V1 isolation and fails closed in production blocker until B11C passes", () => {
    const blocker = VAULT_BLOCKERS.find((b) => b.id === "blocker-storage-durability");
    expect(blocker?.status).toBe("unverified");

    expect(() => assertSafeStagingOrigin(`https://${CRM_V1_FORBIDDEN_HOST}`)).toThrow(/FORBIDDEN/);
    expect(() => assertSafeStagingOrigin(`http://${CRM_V1_FORBIDDEN_HOST}:3000`)).toThrow(
      /FORBIDDEN/,
    );
    expect(assertSafeStagingOrigin("https://staging-v2.joinscaleflow.in")).toBe(
      "https://staging-v2.joinscaleflow.in",
    );
  });

  it("hardens systemd, Nginx, and MariaDB templates for 4 GB isolation and zero public proof leaks", () => {
    const nginx = fs.readFileSync(
      path.join(TEMPLATES_DIR, "nginx-scaleflow-crm.conf.template"),
      "utf8",
    );
    expect(nginx).toContain("proxy_pass http://127.0.0.1:3000;");
    expect(nginx).toContain("client_max_body_size 12m;");
    expect(nginx).toContain("private-proofs");
    expect(nginx).toContain("Strict-Transport-Security");

    const systemd = fs.readFileSync(
      path.join(TEMPLATES_DIR, "scaleflow-crm.service.template"),
      "utf8",
    );
    expect(systemd).toContain("User=crmapp");
    expect(systemd).toContain("ProtectSystem=strict");
    expect(systemd).toContain("ReadWritePaths=/var/lib/scaleflow-crm /var/log/scaleflow-crm");
    expect(systemd).toContain("EnvironmentFile=/etc/scaleflow-crm/crm.env");
    expect(systemd).toContain("NODE_OPTIONS=--max-old-space-size=1024");

    const mariadb = fs.readFileSync(path.join(TEMPLATES_DIR, "mariadb-crm.cnf.template"), "utf8");
    expect(mariadb).toContain("bind-address = 127.0.0.1");
    expect(mariadb).toContain("default-time-zone = '+00:00'");
    expect(mariadb).toContain("innodb_flush_log_at_trx_commit = 1");
  });

  it("verifies all VPS bash scripts enforce strict safety gates, CRM V1 block, and valid bash syntax", () => {
    const bashCandidates = [
      "C:\\Program Files\\Git\\bin\\bash.exe",
      "C:\\Program Files\\Git\\usr\\bin\\bash.exe",
    ];
    const bashPath = bashCandidates.find((p) => fs.existsSync(p));

    const scripts = fs
      .readdirSync(SCRIPTS_DIR)
      .filter((f) => f.endsWith(".sh"))
      .sort();
    expect(scripts.length).toBe(9);

    for (const file of scripts) {
      const fullPath = path.join(SCRIPTS_DIR, file);
      const content = fs.readFileSync(fullPath, "utf8");

      if (file !== "lib-common.sh") {
        expect(content, `${file} must enable strict bash flags`).toContain("set -Eeuo pipefail");
      }

      // No accidental live Hostinger token or private age identity inside scripts
      expect(content).not.toMatch(/AGE-SECRET-KEY-[A-Z0-9]{10,}/);
      expect(content).not.toContain("hapi_");

      if (bashPath) {
        execFileSync(bashPath, ["-n", fullPath], { stdio: "pipe" });
      }
    }

    const commonSh = fs.readFileSync(path.join(SCRIPTS_DIR, "lib-common.sh"), "utf8");
    expect(commonSh).toContain('SCALEFLOW_CRM_V1_DOMAIN="crm.joinscaleflow.in"');
    expect(commonSh).toContain("ALLOW_REAL_VPS_CHANGES");
    expect(commonSh).toContain("require_confirmation_phrase");

    const restoreSh = fs.readFileSync(path.join(SCRIPTS_DIR, "08-restore-verify.sh"), "utf8");
    expect(restoreSh).toContain("sha256_hash");
    expect(restoreSh).toContain("file_size");
    expect(restoreSh).toContain("RESTORE OVERWRITE LIVE CRM");

    if (bashPath) {
      // Verify scripts fail closed cleanly when executed outside approved Ubuntu VPS
      let failedClosed = false;
      try {
        execFileSync(bashPath, [path.join(SCRIPTS_DIR, "01-bootstrap-vps.sh")], {
          stdio: "pipe",
          env: { ...process.env, ALLOW_REAL_VPS_CHANGES: "false" },
        });
      } catch (err: unknown) {
        const stderr = String((err as { stderr?: Buffer | string }).stderr ?? "");
        expect(stderr).toContain("Refusing to execute");
        failedClosed = true;
      }
      expect(failedClosed).toBe(true);

      // Verify lib-common.sh CRM V1 domain hard block executes cleanly
      let v1Blocked = false;
      try {
        const unixCommonPath = path.join(SCRIPTS_DIR, "lib-common.sh").replace(/\\/g, "/");
        execFileSync(
          bashPath,
          [
            "-c",
            `source "${unixCommonPath}" && assert_not_crm_v1_domain "https://crm.joinscaleflow.in"`,
          ],
          { stdio: "pipe" },
        );
      } catch (err: unknown) {
        const stderr = String((err as { stderr?: Buffer | string }).stderr ?? "");
        expect(stderr).toContain("FORBIDDEN TARGET");
        v1Blocked = true;
      }
      expect(v1Blocked).toBe(true);

      // Verify validate_crm_env_file accepts a populated copy of crm.env.example cleanly despite comment notes
      const tmpEnvDir = fs.mkdtempSync(path.join(os.tmpdir(), "b11c-env-"));
      const tmpEnvPath = path.join(tmpEnvDir, "crm.env");
      try {
        const populatedEnv = fs
          .readFileSync(path.join(TEMPLATES_DIR, "crm.env.example"), "utf8")
          .replace("__PROPOSED_SUBDOMAIN_REPLACE_ME__", "staging-v2.joinscaleflow.in")
          .replace("__REPLACE_DB_NAME_E_G_scaleflow_crm_staging__", "scaleflow_crm_staging")
          .replace("__REPLACE_DB_USER_E_G_crm_app__", "crm_app")
          .replace(
            "__REPLACE_WITH_32_PLUS_CHAR_CSPRNG_PASSWORD__",
            "TestStrongDbPass_2026_Clean_01",
          )
          .replace(
            "__REPLACE_WITH_64_HEX_CHAR_CSPRNG_SECRET__",
            "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
          )
          .replace(
            "__REPLACE_WITH_OWNER_PUBLIC_AGE_KEY_ONLY__",
            "qzv8w9x0testpublickeyexample000000000000000000000000000000",
          );
        fs.writeFileSync(tmpEnvPath, populatedEnv, "utf8");
        const unixCommonPath = path.join(SCRIPTS_DIR, "lib-common.sh").replace(/\\/g, "/");
        const unixTmpEnv = tmpEnvPath.replace(/\\/g, "/");
        execFileSync(
          bashPath,
          ["-c", `source "${unixCommonPath}" && validate_crm_env_file "${unixTmpEnv}" "false"`],
          { stdio: "pipe" },
        );
      } finally {
        fs.rmSync(tmpEnvDir, { recursive: true, force: true });
      }
    }
  });

  it("defines all 20 B11C staging durability tests as NOT YET EXECUTED and blocks unapproved live runs", () => {
    expect(STAGING_DURABILITY_PLAN.length).toBe(20);
    const ids = STAGING_DURABILITY_PLAN.map((t) => t.id);
    expect(ids).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));

    const planOut = execFileSync(
      process.execPath,
      [path.join(REPO_ROOT, "scripts", "b11c-staging-durability-harness.mjs"), "--plan"],
      { encoding: "utf8" },
    );
    const parsedPlan = JSON.parse(planOut) as {
      executionStatus: string;
      testCount: number;
    };
    expect(parsedPlan.executionStatus).toBe("NOT_YET_EXECUTED");
    expect(parsedPlan.testCount).toBe(20);

    // Calling without explicit --confirm-staging + B11C_STAGING_APPROVED=true must fail closed
    let blockedExit = false;
    try {
      execFileSync(
        process.execPath,
        [
          path.join(REPO_ROOT, "scripts", "b11c-staging-durability-harness.mjs"),
          "--phase",
          "api",
          "--base-url",
          "https://staging-v2.joinscaleflow.in",
        ],
        {
          encoding: "utf8",
          stdio: "pipe",
          env: { ...process.env, B11C_STAGING_APPROVED: "false" },
        },
      );
    } catch {
      blockedExit = true;
    }
    expect(blockedExit).toBe(true);
  });
});
