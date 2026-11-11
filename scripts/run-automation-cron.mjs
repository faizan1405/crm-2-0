import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

export const HOSTINGER_CRON_MAX_CMD_LEN = 255;
export const IST_OFFSET_MS = 330 * 60_000;

const SAFE_SHELL_TOKEN_RE = /^[A-Za-z0-9._/-]+$/;
const SAFE_CLI_FLAG_RE = /^--[A-Za-z0-9][A-Za-z0-9=_-]*$/;
const SHELL_OPERATOR_RE = /(?:&&|\|\||[;|&><`$()\n\r])/;
const ENV_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const UNTRUSTED_WEBROOT_ENV_RE = /(?:^|[\\/])(public_html|htdocs|wwwroot)(?:[\\/]|$)/i;
const DIRECT_TMP_ENV_RE = /^\/(?:var\/)?tmp\/[^/]+$/i;

export function toIstPartsJs(date = new Date()) {
  const shifted = new Date(date.getTime() + IST_OFFSET_MS);
  const pad2 = (n) => String(n).padStart(2, "0");
  const y = shifted.getUTCFullYear();
  const mo = pad2(shifted.getUTCMonth() + 1);
  const d = pad2(shifted.getUTCDate());
  const h = pad2(shifted.getUTCHours());
  const mi = pad2(shifted.getUTCMinutes());
  const s = pad2(shifted.getUTCSeconds());
  return {
    istDate: `${y}-${mo}-${d}`,
    istTime: `${h}:${mi}`,
    istDateTime: `${y}-${mo}-${d}T${h}:${mi}:${s}+05:30`,
  };
}

export function computeCronBucketsJs(date = new Date(), bucketMinutes = 15) {
  const safeBucket = Math.max(1, Math.min(1440, Math.floor(bucketMinutes)));
  const bucketMs = safeBucket * 60_000;
  const pad2 = (n) => String(n).padStart(2, "0");

  const utcBucketStart = new Date(Math.floor(date.getTime() / bucketMs) * bucketMs);
  const utcBucketKey =
    `${utcBucketStart.getUTCFullYear()}-${pad2(utcBucketStart.getUTCMonth() + 1)}-${pad2(utcBucketStart.getUTCDate())}` +
    `T${pad2(utcBucketStart.getUTCHours())}:${pad2(utcBucketStart.getUTCMinutes())}Z`;

  const istShiftedMs = date.getTime() + IST_OFFSET_MS;
  const istBucketDate = new Date(Math.floor(istShiftedMs / bucketMs) * bucketMs);
  const istBucketKey =
    `${istBucketDate.getUTCFullYear()}-${pad2(istBucketDate.getUTCMonth() + 1)}-${pad2(istBucketDate.getUTCDate())}` +
    `T${pad2(istBucketDate.getUTCHours())}:${pad2(istBucketDate.getUTCMinutes())}+0530`;

  return { utcBucketKey, istBucketKey, bucketMinutes: safeBucket };
}

export function toMysqlUtcDateTimeJs(date = new Date()) {
  const iso = date.toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 23)}`;
}

/**
 * Builds the direct shell-operator-free Hostinger cron command using the verified
 * `/opt/alt/alt-nodejs<major>/root/usr/bin/node` binary path and automatic relative
 * `../../../config/.env` discovery inside `run-cron.mjs`.
 */
export function buildHostingerCliCommand({
  username,
  domain,
  nodeMajor = "22",
  scriptRelPath = "server/run-cron.mjs",
  args = ["--dry-run"],
}) {
  const cleanUser = String(username ?? "").trim();
  const cleanDomain = String(domain ?? "").trim();
  const cleanRel = String(scriptRelPath ?? "server/run-cron.mjs")
    .trim()
    .replace(/^\/+/, "");
  const cleanArgs = (args ?? ["--dry-run"]).map((a) => String(a).trim()).filter(Boolean);

  if (!SAFE_SHELL_TOKEN_RE.test(cleanUser) || !SAFE_SHELL_TOKEN_RE.test(cleanDomain)) {
    throw new Error("Invalid Hostinger username or domain.");
  }
  if (!SAFE_SHELL_TOKEN_RE.test(cleanRel) || cleanRel.includes("..")) {
    throw new Error("Invalid relative cron script path.");
  }
  for (const arg of cleanArgs) {
    if (!SAFE_CLI_FLAG_RE.test(arg) || SHELL_OPERATOR_RE.test(arg)) {
      throw new Error(`Unsafe cron CLI argument: ${arg}`);
    }
  }

  const hbuildsRoot = `/home/${cleanUser}/domains/${cleanDomain}/hbuilds`;
  const nodeBinary = `/opt/alt/alt-nodejs${nodeMajor}/root/usr/bin/node`;
  const suffix = cleanArgs.length > 0 ? ` ${cleanArgs.join(" ")}` : "";

  const command = `${nodeBinary} ${hbuildsRoot}/current/nodejs/${cleanRel}${suffix}`;
  const naiveAbsoluteCommand = `${nodeBinary} --env-file=${hbuildsRoot}/config/.env ${hbuildsRoot}/current/nodejs/${cleanRel}${suffix}`;

  if (SHELL_OPERATOR_RE.test(command)) {
    throw new Error("Cron command cannot contain shell operators.");
  }

  return {
    command,
    length: command.length,
    headroomChars: HOSTINGER_CRON_MAX_CMD_LEN - command.length,
    nodeBinary,
    usesShellOperators: false,
    autoDiscoversEnv: true,
    compactCommand: command,
    compactLength: command.length,
    fitsHostinger255Limit: command.length <= HOSTINGER_CRON_MAX_CMD_LEN,
    naiveAbsoluteCommand,
    naiveAbsoluteLength: naiveAbsoluteCommand.length,
    naiveFitsHostinger255Limit: naiveAbsoluteCommand.length <= HOSTINGER_CRON_MAX_CMD_LEN,
  };
}

/**
 * Evaluates filesystem permissions and ownership of a cron `.env` file without reading secrets.
 */
export function assessEnvStatSecurity(
  lstat,
  envPath,
  runtime = {
    platform: process.platform,
    currentUid: typeof process.getuid === "function" ? process.getuid() : null,
  },
) {
  const normalized = path.resolve(envPath);
  if (
    UNTRUSTED_WEBROOT_ENV_RE.test(normalized) ||
    DIRECT_TMP_ENV_RE.test(envPath.replace(/\\/g, "/"))
  ) {
    return {
      ok: false,
      code: "env_file_untrusted",
      message: "Refusing cron env file located inside a public webroot or root temp directory.",
    };
  }
  if (typeof lstat.isSymbolicLink === "function" && lstat.isSymbolicLink()) {
    return {
      ok: false,
      code: "env_file_untrusted",
      message: "Refusing symlinked cron env file for security.",
    };
  }
  if (typeof lstat.isFile === "function" && !lstat.isFile()) {
    return {
      ok: false,
      code: "env_file_untrusted",
      message: "Cron env path must point to a regular file.",
    };
  }
  if (runtime.platform !== "win32") {
    if ((lstat.mode & 0o002) !== 0) {
      return {
        ok: false,
        code: "env_file_untrusted",
        message: "Refusing world-writable cron env file (chmod 600 or 640 required).",
      };
    }
    if (
      runtime.currentUid !== null &&
      runtime.currentUid !== undefined &&
      typeof lstat.uid === "number" &&
      lstat.uid !== runtime.currentUid &&
      lstat.uid !== 0
    ) {
      return {
        ok: false,
        code: "env_file_untrusted",
        message: "Refusing cron env file not owned by the current runtime user.",
      };
    }
  }
  return { ok: true };
}

/**
 * Parses `.env` contents strictly without leaking any secret values in error messages.
 */
export function parseDotEnvSafely(content) {
  if (typeof content !== "string" || content.includes("\0")) {
    const err = new Error("Cron env file is malformed or contains binary NUL bytes.");
    err.code = "invalid_env_file";
    throw err;
  }

  const parsed = {};
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith("#")) continue;
    const eqIdx = line.indexOf("=");
    if (eqIdx <= 0) {
      const err = new Error(`Cron env file contains invalid syntax at line ${i + 1}.`);
      err.code = "invalid_env_file";
      throw err;
    }
    const key = line.slice(0, eqIdx).trim();
    if (!ENV_KEY_RE.test(key)) {
      const err = new Error(`Cron env file contains invalid key identifier at line ${i + 1}.`);
      err.code = "invalid_env_file";
      throw err;
    }
    let val = line.slice(eqIdx + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"') && val.length >= 2) ||
      (val.startsWith("'") && val.endsWith("'") && val.length >= 2)
    ) {
      val = val.slice(1, -1);
    }
    parsed[key] = val;
  }

  if (
    parsed["NODE_ENV"] !== undefined &&
    parsed["NODE_ENV"] !== "" &&
    !["development", "test", "production"].includes(parsed["NODE_ENV"])
  ) {
    const err = new Error("Cron env file defines an unsupported NODE_ENV value.");
    err.code = "invalid_env_file";
    throw err;
  }

  return parsed;
}

/**
 * Resolves candidate env paths prioritizing `../../../config/.env` relative to the script
 * file (`.../hbuilds/current/nodejs/server/run-cron.mjs` -> `.../hbuilds/config/.env`)
 * before falling back to working-directory configs.
 */
export function resolveCronEnvCandidates({
  scriptFilePath = fileURLToPath(import.meta.url),
  explicitEnvPath = null,
  cwd = process.cwd(),
} = {}) {
  if (explicitEnvPath) {
    return [path.resolve(cwd, explicitEnvPath)];
  }
  const scriptDir = path.dirname(path.resolve(scriptFilePath));
  const candidates = [
    path.resolve(scriptDir, "../../../config/.env"),
    path.resolve(scriptDir, "../../config/.env"),
    path.resolve(cwd, "config/.env"),
    path.resolve(cwd, ".env"),
  ];
  return [...new Set(candidates)];
}

/**
 * Discovers, security-validates, parses, and loads `.env` variables into `targetEnv`
 * without ever exposing loaded secret values. Fails closed if an explicit `--env-file`
 * is missing or if any discovered `.env` file fails trust/permission/syntax checks.
 */
export function resolveAndLoadCronEnv({
  scriptFilePath = fileURLToPath(import.meta.url),
  explicitEnvPath = null,
  cwd = process.cwd(),
  targetEnv = process.env,
  requireEnvFile = false,
} = {}) {
  const candidates = resolveCronEnvCandidates({ scriptFilePath, explicitEnvPath, cwd });

  for (const candidate of candidates) {
    let lstat;
    try {
      lstat = fs.lstatSync(candidate);
    } catch {
      continue;
    }

    const sec = assessEnvStatSecurity(lstat, candidate);
    if (!sec.ok) {
      const err = new Error(sec.message);
      err.code = sec.code;
      throw err;
    }

    const content = fs.readFileSync(candidate, "utf8");
    const parsed = parseDotEnvSafely(content);
    const loadedKeys = [];
    for (const [key, val] of Object.entries(parsed)) {
      if (targetEnv[key] === undefined) {
        targetEnv[key] = val;
        loadedKeys.push(key);
      }
    }

    return {
      loaded: true,
      source: explicitEnvPath ? "explicit_env_file" : "auto_discovered_env_file",
      envPath: candidate,
      keyCount: Object.keys(parsed).length,
      appliedKeyCount: loadedKeys.length,
    };
  }

  if (explicitEnvPath || requireEnvFile) {
    const err = new Error(
      "Required cron env file was not found in config/.env or --env-file location.",
    );
    err.code = "env_file_missing";
    throw err;
  }

  return {
    loaded: false,
    source: "process_env_only",
    envPath: null,
    keyCount: 0,
    appliedKeyCount: 0,
  };
}

function buildDbConfigFromEnv(env = process.env) {
  const databaseUrl = env["DATABASE_URL"]?.trim();
  const sslMode = env["DB_SSL_MODE"]?.trim() || "disabled";
  const base = {
    timezone: "Z",
    decimalNumbers: false,
    dateStrings: true,
    multipleStatements: false,
    connectTimeout: 5000,
    ...(sslMode === "required" ? { ssl: { rejectUnauthorized: true } } : {}),
  };

  if (databaseUrl) {
    return { ...base, uri: databaseUrl };
  }

  const host = env["DB_HOST"]?.trim() || "127.0.0.1";
  const port = Number(env["DB_PORT"]?.trim() || "3306");
  const database = env["DB_NAME"]?.trim();
  const user = env["DB_USER"]?.trim();
  const password = env["DB_PASSWORD"];

  if (!database || !user) {
    return null;
  }

  return {
    ...base,
    host,
    port,
    database,
    user,
    ...(password !== undefined ? { password } : {}),
  };
}

export function parseCronCliArgs(argv) {
  const flags = {
    help: false,
    printCommand: false,
    verifyConfig: false,
    dryRun: true,
    executeDisposable: false,
    ownerId: null,
    bucketMinutes: 15,
    maxRuntimeMs: 240_000,
    domain: "khaki-butterfly-345144.hostingersite.com",
    username: "u256504187",
    envFile: null,
  };

  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") flags.help = true;
    else if (arg === "--print-command") flags.printCommand = true;
    else if (arg === "--verify-config") flags.verifyConfig = true;
    else if (arg === "--dry-run") {
      flags.dryRun = true;
      flags.executeDisposable = false;
    } else if (arg === "--execute-disposable") {
      flags.executeDisposable = true;
      flags.dryRun = false;
    } else if (arg.startsWith("--owner=")) {
      flags.ownerId = arg.slice("--owner=".length).trim() || null;
    } else if (arg.startsWith("--bucket-minutes=")) {
      const val = Number(arg.slice("--bucket-minutes=".length));
      if (Number.isFinite(val) && val >= 1 && val <= 1440) flags.bucketMinutes = Math.floor(val);
    } else if (arg.startsWith("--max-runtime-ms=")) {
      const val = Number(arg.slice("--max-runtime-ms=".length));
      if (Number.isFinite(val) && val >= 50) flags.maxRuntimeMs = Math.floor(val);
    } else if (arg.startsWith("--domain=")) {
      flags.domain = arg.slice("--domain=".length).trim() || flags.domain;
    } else if (arg.startsWith("--username=")) {
      flags.username = arg.slice("--username=".length).trim() || flags.username;
    } else if (arg.startsWith("--env-file=")) {
      flags.envFile = arg.slice("--env-file=".length).trim() || null;
    }
  }

  return flags;
}

async function runCli() {
  const flags = parseCronCliArgs(process.argv.slice(2));

  if (flags.help) {
    console.log(
      JSON.stringify({
        ok: true,
        usage:
          "node run-cron.mjs [--dry-run] [--verify-config] [--print-command] [--owner=<id>] [--bucket-minutes=15] [--env-file=<path>]",
        notes: [
          "Defaults strictly to --dry-run (zero mutations).",
          "Auto-discovers ../../../config/.env relative to script path with strict permission & trust validation.",
          "External WhatsApp/email/SMS/call actions are strictly disabled.",
        ],
      }),
    );
    return;
  }

  if (flags.printCommand) {
    const cmdSpec = buildHostingerCronCommandSpecSafe(flags);
    console.log(JSON.stringify({ ok: true, ...cmdSpec }, null, 2));
    return;
  }

  let envReport;
  try {
    envReport = resolveAndLoadCronEnv({
      explicitEnvPath: flags.envFile,
      requireEnvFile: flags.verifyConfig,
    });
  } catch (envErr) {
    console.error(
      JSON.stringify({
        ok: false,
        code: typeof envErr?.code === "string" ? envErr.code : "env_file_error",
        message:
          envErr instanceof Error ? envErr.message : "Failed to load cron env configuration.",
      }),
    );
    process.exitCode = 1;
    return;
  }

  // Fail closed against unattended production OR CLI cron mutations
  if (!flags.dryRun) {
    console.error(
      JSON.stringify({
        ok: false,
        code: "automation_cron_mutations_disabled",
        message:
          "Standalone CLI cron mutations remain disabled (run --dry-run for scheduled diagnostics or server Vitest harness).",
      }),
    );
    process.exitCode = 2;
    return;
  }

  const dbCfg = buildDbConfigFromEnv();
  if (!dbCfg) {
    console.error(
      JSON.stringify({
        ok: false,
        code: envReport.loaded ? "database_unconfigured" : "env_file_missing",
        mode: flags.verifyConfig ? "verify_config" : "dry_run",
        envSource: envReport.source,
        message: "No database configuration loaded (DATABASE_URL or DB_NAME/DB_USER missing).",
      }),
    );
    process.exitCode = 1;
    return;
  }

  if (flags.verifyConfig) {
    const startedAt = new Date();
    const ist = toIstPartsJs(startedAt);
    const buckets = computeCronBucketsJs(startedAt, flags.bucketMinutes);
    console.log(
      JSON.stringify({
        ok: true,
        mode: "verify_config",
        envSource: envReport.source,
        envKeyCount: envReport.keyCount,
        databaseConfigured: true,
        utcNow: startedAt.toISOString(),
        istNow: ist.istDateTime,
        utcBucketKey: buckets.utcBucketKey,
        istBucketKey: buckets.istBucketKey,
        outboundDeliveryGuaranteedDisabled: true,
      }),
    );
    return;
  }

  const startedAt = new Date();
  const ist = toIstPartsJs(startedAt);
  const buckets = computeCronBucketsJs(startedAt, flags.bucketMinutes);
  const { default: mysql } = await import("mysql2/promise");
  const pool = mysql.createPool({ ...dbCfg, waitForConnections: true, connectionLimit: 2 });
  const lockName = `sf_crm_cron_${flags.ownerId ?? "all"}`;
  let lockAcquired = false;

  try {
    const [[lockRow]] = await pool.query("SELECT GET_LOCK(?, 0) AS acquired", [lockName]);
    lockAcquired = Number(lockRow?.acquired) === 1;
    if (!lockAcquired) {
      console.log(
        JSON.stringify({
          ok: true,
          mode: "dry_run",
          envSource: envReport.source,
          lockAcquired: false,
          utcNow: startedAt.toISOString(),
          istNow: ist.istDateTime,
          utcBucketKey: buckets.utcBucketKey,
          istBucketKey: buckets.istBucketKey,
          message: "Skipped cron tick: advisory lock already held.",
        }),
      );
      return;
    }

    const nowUtcMysql = toMysqlUtcDateTimeJs(startedAt);
    const ownerFilter = flags.ownerId ? "AND owner_user_id = ?" : "";
    const ownerParams = flags.ownerId ? [flags.ownerId] : [];

    const [overdueFollowUps] = await pool.query(
      `SELECT id, owner_user_id, lead_id, due_at, due_ist_date, due_ist_time
       FROM crm_follow_ups
       WHERE completed_at IS NULL AND cancelled_at IS NULL AND due_at <= ? ${ownerFilter}
       ORDER BY due_at ASC
       LIMIT 200`,
      [nowUtcMysql, ...ownerParams],
    );

    const [enabledRules] = await pool.query(
      `SELECT id, owner_user_id, name, trigger_type, actions_json
       FROM crm_automation_rules
       WHERE status = 'enabled' AND trigger_type IN ('followup_overdue', 'inactivity') ${ownerFilter}
       LIMIT 50`,
      ownerParams,
    );

    const finishAt = new Date();
    console.log(
      JSON.stringify({
        ok: true,
        mode: "dry_run",
        envSource: envReport.source,
        lockAcquired: true,
        utcNow: startedAt.toISOString(),
        istNow: ist.istDateTime,
        utcBucketKey: buckets.utcBucketKey,
        istBucketKey: buckets.istBucketKey,
        durationMs: finishAt.getTime() - startedAt.getTime(),
        overdueFollowUpsFound: Array.isArray(overdueFollowUps) ? overdueFollowUps.length : 0,
        enabledCronRulesFound: Array.isArray(enabledRules) ? enabledRules.length : 0,
        outboundDeliveryGuaranteedDisabled: true,
      }),
    );
  } finally {
    if (lockAcquired) {
      await pool.query("SELECT RELEASE_LOCK(?)", [lockName]).catch(() => undefined);
    }
    await pool.end().catch(() => undefined);
  }
}

function buildHostingerCronCommandSpecSafe(flags) {
  return buildHostingerCliCommand({
    username: flags.username,
    domain: flags.domain,
    nodeMajor: "22",
    scriptRelPath: "server/run-cron.mjs",
    args: flags.ownerId ? ["--dry-run", `--owner=${flags.ownerId}`] : ["--dry-run"],
  });
}

const isEntrypoint = (() => {
  if (typeof process === "undefined" || !Array.isArray(process.argv) || !process.argv[1]) {
    return false;
  }
  try {
    return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return path.basename(process.argv[1]) === path.basename(fileURLToPath(import.meta.url));
  }
})();

if (isEntrypoint) {
  runCli().catch((err) => {
    console.error(
      JSON.stringify({
        ok: false,
        code: typeof err?.code === "string" ? err.code : "cron_runtime_error",
        message: err instanceof Error ? err.message : "Unknown cron error",
      }),
    );
    process.exitCode = 1;
  });
}
