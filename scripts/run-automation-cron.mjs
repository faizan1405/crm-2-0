import fs from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";

export const HOSTINGER_CRON_MAX_CMD_LEN = 255;
export const IST_OFFSET_MS = 330 * 60_000;

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

export function toMysqlUtcDateTimeJs(date = new Date()) {
  const iso = date.toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 23)}`;
}

export function buildHostingerCliCommand({
  username,
  domain,
  nodeMajor = "22",
  scriptRelPath = "server/run-cron.mjs",
  args = ["--dry-run"],
}) {
  const hbuildsRoot = `/home/${username}/domains/${domain}/hbuilds`;
  const nodeBin = `/opt/alt/alt-nodejs${nodeMajor}/root/bin/node`;
  const suffix = args.length > 0 ? ` ${args.join(" ")}` : "";
  const compactCommand = `cd ${hbuildsRoot} && ${nodeBin} --env-file=config/.env current/nodejs/${scriptRelPath}${suffix}`;
  const naiveAbsoluteCommand = `${nodeBin} --env-file=${hbuildsRoot}/config/.env ${hbuildsRoot}/current/nodejs/${scriptRelPath}${suffix}`;
  return {
    compactCommand,
    compactLength: compactCommand.length,
    fitsHostinger255Limit: compactCommand.length <= HOSTINGER_CRON_MAX_CMD_LEN,
    naiveAbsoluteCommand,
    naiveAbsoluteLength: naiveAbsoluteCommand.length,
    naiveFitsHostinger255Limit: naiveAbsoluteCommand.length <= HOSTINGER_CRON_MAX_CMD_LEN,
  };
}

function loadOptionalDotEnv() {
  const candidates = [
    path.resolve(process.cwd(), ".env"),
    path.resolve(process.cwd(), "config/.env"),
  ];
  for (const envPath of candidates) {
    if (!fs.existsSync(envPath)) continue;
    const content = fs.readFileSync(envPath, "utf8");
    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const eqIdx = line.indexOf("=");
      if (eqIdx <= 0) continue;
      const key = line.slice(0, eqIdx).trim();
      let val = line.slice(eqIdx + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (process.env[key] === undefined) {
        process.env[key] = val;
      }
    }
    break;
  }
}

function buildDbConfigFromEnv() {
  const databaseUrl = process.env["DATABASE_URL"]?.trim();
  const sslMode = process.env["DB_SSL_MODE"]?.trim() || "disabled";
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

  const host = process.env["DB_HOST"]?.trim() || "127.0.0.1";
  const port = Number(process.env["DB_PORT"]?.trim() || "3306");
  const database = process.env["DB_NAME"]?.trim();
  const user = process.env["DB_USER"]?.trim();
  const password = process.env["DB_PASSWORD"];

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
    dryRun: true,
    executeDisposable: false,
    ownerId: null,
    bucketMinutes: 15,
    maxRuntimeMs: 240_000,
    domain: "khaki-butterfly-345144.hostingersite.com",
    username: "u256504187",
  };

  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") flags.help = true;
    else if (arg === "--print-command") flags.printCommand = true;
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
    }
  }

  return flags;
}

async function runCli() {
  loadOptionalDotEnv();
  const flags = parseCronCliArgs(process.argv.slice(2));

  if (flags.help) {
    console.log(
      JSON.stringify({
        ok: true,
        usage:
          "node [--env-file=config/.env] run-cron.mjs [--dry-run] [--print-command] [--owner=<id>] [--bucket-minutes=15]",
        notes: [
          "Defaults strictly to --dry-run (zero mutations).",
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

  // Fail closed against unattended production OR CLI cron mutations in B11C-BUSINESS
  if (!flags.dryRun) {
    console.error(
      JSON.stringify({
        ok: false,
        code: "automation_cron_mutations_disabled",
        message:
          "Standalone CLI cron mutations remain disabled in B11C-BUSINESS (run --dry-run for scheduled diagnostics or server Vitest harness).",
      }),
    );
    process.exitCode = 2;
    return;
  }

  const dbCfg = buildDbConfigFromEnv();
  if (!dbCfg) {
    console.log(
      JSON.stringify({
        ok: false,
        code: "database_unconfigured",
        mode: flags.dryRun ? "dry_run" : "disposable_execution",
        message: "No database configuration loaded (DATABASE_URL or DB_NAME/DB_USER missing).",
      }),
    );
    process.exitCode = 1;
    return;
  }

  const startedAt = new Date();
  const ist = toIstPartsJs(startedAt);
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
          lockAcquired: false,
          utcNow: startedAt.toISOString(),
          istNow: ist.istDateTime,
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
        lockAcquired: true,
        utcNow: startedAt.toISOString(),
        istNow: ist.istDateTime,
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

const isEntrypoint =
  typeof process !== "undefined" &&
  Array.isArray(process.argv) &&
  process.argv[1] &&
  path.basename(process.argv[1]) === path.basename(new URL(import.meta.url).pathname);

if (isEntrypoint) {
  runCli().catch((err) => {
    console.error(
      JSON.stringify({
        ok: false,
        code: "cron_runtime_error",
        message: err instanceof Error ? err.message : "Unknown cron error",
      }),
    );
    process.exitCode = 1;
  });
}
