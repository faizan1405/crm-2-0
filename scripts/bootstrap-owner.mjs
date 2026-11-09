import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import mysql from "mysql2/promise";

const PASSWORD_MIN = 10;
const PASSWORD_MAX = 128;
const SCRYPT_PARAMS = {
  N: 32_768,
  r: 8,
  p: 1,
  keylen: 64,
  maxmem: 64 * 1024 * 1024,
  saltBytes: 16,
};
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function loadOptionalDotEnv() {
  const envPath = path.resolve(process.cwd(), ".env");
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eqIdx = line.indexOf("=");
    if (eqIdx <= 0) continue;
    const key = line.slice(0, eqIdx).trim();
    let val = line.slice(eqIdx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = val;
    }
  }
}

function toMysqlUtcDateTime(date = new Date()) {
  const iso = date.toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 23)}`;
}

function validateEmail(email) {
  const normalized = email.trim().toLowerCase();
  if (!normalized || normalized.length > 160 || !EMAIL_PATTERN.test(normalized)) {
    throw new Error("Invalid Owner email address.");
  }
  return normalized;
}

function validatePassword(password) {
  if (typeof password !== "string" || password.length < PASSWORD_MIN) {
    throw new Error(`Password must be at least ${PASSWORD_MIN} characters.`);
  }
  if (password.length > PASSWORD_MAX) {
    throw new Error(`Password must be at most ${PASSWORD_MAX} characters.`);
  }
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    throw new Error("Password must include at least one letter and one number.");
  }
  if (/^\s|\s$/.test(password)) {
    throw new Error("Password can't start or end with a space.");
  }
}

function hashPassword(password) {
  validatePassword(password);
  const salt = crypto.randomBytes(SCRYPT_PARAMS.saltBytes);
  return new Promise((resolve, reject) => {
    crypto.scrypt(
      password,
      salt,
      SCRYPT_PARAMS.keylen,
      {
        N: SCRYPT_PARAMS.N,
        r: SCRYPT_PARAMS.r,
        p: SCRYPT_PARAMS.p,
        maxmem: SCRYPT_PARAMS.maxmem,
      },
      (err, derived) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(
          `scrypt$N=${SCRYPT_PARAMS.N},r=${SCRYPT_PARAMS.r},p=${SCRYPT_PARAMS.p}$${salt.toString("base64url")}$${derived.toString("base64url")}`,
        );
      },
    );
  });
}

function promptText(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

function promptHidden(question) {
  if (!process.stdin.isTTY) {
    throw new Error("Non-interactive mode requires BOOTSTRAP_OWNER_PASSWORD env variable.");
  }
  return new Promise((resolve) => {
    process.stdout.write(question);
    const stdin = process.stdin;
    const prevRaw = stdin.isRaw;
    stdin.setRawMode(true);
    stdin.resume();
    let value = "";
    const onData = (buf) => {
      const ch = buf.toString("utf8");
      for (const c of ch) {
        if (c === "\r" || c === "\n") {
          stdin.setRawMode(Boolean(prevRaw));
          stdin.pause();
          stdin.removeListener("data", onData);
          process.stdout.write("\n");
          resolve(value);
          return;
        }
        if (c === "\u0003") {
          stdin.setRawMode(Boolean(prevRaw));
          process.stdout.write("\n");
          process.exit(1);
        }
        if (c === "\u007f" || c === "\b") {
          value = value.slice(0, -1);
        } else {
          value += c;
        }
      }
    };
    stdin.on("data", onData);
  });
}

function buildConnectionOptions() {
  const databaseUrl = process.env["DATABASE_URL"]?.trim();
  const sslMode = process.env["DB_SSL_MODE"]?.trim() || "disabled";
  const base = {
    timezone: "Z",
    decimalNumbers: false,
    dateStrings: true,
    multipleStatements: false,
    ...(sslMode === "required" ? { ssl: { rejectUnauthorized: true } } : {}),
  };
  if (databaseUrl) return { ...base, uri: databaseUrl };

  const host = process.env["DB_HOST"]?.trim() || "127.0.0.1";
  const port = Number(process.env["DB_PORT"]?.trim() || "3306");
  const database = process.env["DB_NAME"]?.trim();
  const user = process.env["DB_USER"]?.trim();
  const password = process.env["DB_PASSWORD"];
  if (!database || !user) {
    throw new Error(
      "Database not configured. Provide DATABASE_URL or DB_HOST/DB_PORT/DB_NAME/DB_USER/DB_PASSWORD.",
    );
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

async function main() {
  loadOptionalDotEnv();
  const args = new Set(process.argv.slice(2));
  const resetPassword = args.has("--reset-password");

  let rawEmail = process.env["BOOTSTRAP_OWNER_EMAIL"] ?? "";
  let rawName = process.env["BOOTSTRAP_OWNER_NAME"] ?? "";
  let rawPassword = process.env["BOOTSTRAP_OWNER_PASSWORD"] ?? "";

  if (!rawEmail) {
    if (!process.stdin.isTTY) {
      throw new Error("Provide BOOTSTRAP_OWNER_EMAIL (and BOOTSTRAP_OWNER_PASSWORD) via env.");
    }
    rawEmail = await promptText("Owner email: ");
  }
  const email = validateEmail(rawEmail);

  if (!rawName && process.stdin.isTTY && !process.env["BOOTSTRAP_OWNER_EMAIL"]) {
    rawName = await promptText("Owner display name [Owner]: ");
  }
  const name = rawName.trim() || "Owner";
  if (name.length > 120) {
    throw new Error("Owner display name must be 120 characters or fewer.");
  }

  if (!rawPassword) {
    const p1 = await promptHidden("Owner password (min 10 chars, letter + number): ");
    const p2 = await promptHidden("Confirm Owner password: ");
    if (p1 !== p2) {
      throw new Error("Passwords do not match.");
    }
    rawPassword = p1;
  }

  const passwordHash = await hashPassword(rawPassword);
  rawPassword = "";

  const pool = mysql.createPool({
    ...buildConnectionOptions(),
    waitForConnections: true,
    connectionLimit: 2,
  });

  const conn = await pool.getConnection();
  try {
    const nowStr = toMysqlUtcDateTime(new Date());
    const emailHash = crypto.createHash("sha256").update(email, "utf8").digest("hex");
    await conn.beginTransaction();

    const [owners] = await conn.execute(
      "SELECT id, version FROM crm_users WHERE role_id = 'owner' LIMIT 1",
    );
    const existingOwner = Array.isArray(owners) ? owners[0] : undefined;

    if (!existingOwner) {
      const [dup] = await conn.execute("SELECT id FROM crm_users WHERE email = ? LIMIT 1", [email]);
      if (Array.isArray(dup) && dup.length > 0) {
        throw new Error("That email is already in use by another record.");
      }

      const userId = `usr_owner_${crypto.randomUUID()}`;
      await conn.execute(
        `INSERT INTO crm_users
          (id, email, name, role_id, account_status, password_hash, last_login_at, version, created_at, updated_at)
         VALUES (?, ?, ?, 'owner', 'active', ?, NULL, 1, ?, ?)`,
        [userId, email, name, passwordHash, nowStr, nowStr],
      );
      await conn.execute(
        `INSERT INTO crm_auth_audit
          (id, user_id, event_type, email_hash, session_id, ip_prefix, detail, created_at)
         VALUES (?, ?, 'owner_bootstrapped', ?, NULL, 'cli', 'created', ?)`,
        [`audit_${crypto.randomUUID()}`, userId, emailHash, nowStr],
      );
      await conn.commit();
      console.log(`[auth:bootstrap] Created active Owner account for ${email} (${userId}).`);
      return;
    }

    if (!resetPassword) {
      await conn.rollback();
      throw new Error(
        "Owner account already exists. Re-run with --reset-password to rotate the password and revoke existing sessions.",
      );
    }

    await conn.execute(
      `UPDATE crm_users
         SET email = ?, name = ?, account_status = 'active', password_hash = ?, version = version + 1, updated_at = ?
       WHERE id = ?`,
      [email, name, passwordHash, nowStr, existingOwner.id],
    );
    await conn.execute(
      `UPDATE crm_sessions
          SET revoked_at = ?, revoke_reason = 'password_reset'
        WHERE user_id = ? AND revoked_at IS NULL`,
      [nowStr, existingOwner.id],
    );
    await conn.execute(
      `INSERT INTO crm_auth_audit
        (id, user_id, event_type, email_hash, session_id, ip_prefix, detail, created_at)
       VALUES (?, ?, 'owner_password_reset', ?, NULL, 'cli', 'sessions_revoked', ?)`,
      [`audit_${crypto.randomUUID()}`, existingOwner.id, emailHash, nowStr],
    );

    await conn.commit();
    console.log(
      `[auth:bootstrap] Rotated Owner password for ${email} and revoked active sessions.`,
    );
  } catch (error) {
    await conn.rollback().catch(() => undefined);
    throw error;
  } finally {
    conn.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error("[auth:bootstrap] Failed:", error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
