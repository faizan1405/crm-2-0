import fs from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";
import { drizzle } from "drizzle-orm/mysql2";
import { migrate } from "drizzle-orm/mysql2/migrator";

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

  if (databaseUrl) {
    return { ...base, uri: databaseUrl };
  }

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
  const migrationsFolder = path.resolve(process.cwd(), "src/server/db/migrations");
  if (!fs.existsSync(migrationsFolder)) {
    throw new Error(`Migrations folder not found: ${migrationsFolder}`);
  }

  const pool = mysql.createPool({
    ...buildConnectionOptions(),
    waitForConnections: true,
    connectionLimit: 2,
  });

  try {
    const db = drizzle(pool);
    await migrate(db, { migrationsFolder });
    console.log("[db:migrate] Drizzle MySQL migrations applied cleanly.");
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error("[db:migrate] Failed:", error instanceof Error ? error.message : String(error));
  if (error && typeof error === "object" && "cause" in error) {
    console.error("[db:migrate] Cause:", error.cause);
  }
  process.exitCode = 1;
});
