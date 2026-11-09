import "@tanstack/react-start/server-only";
import fs from "node:fs";
import path from "node:path";

let loaded = false;

/**
 * Loads key-value pairs from local `.env` into `process.env` WITHOUT overwriting any explicitly
 * set process environment variables (so production/CI/Hostinger/test env always wins).
 * Skipped automatically under Vitest / `NODE_ENV=test` so unit tests remain hermetically isolated.
 */
export function loadOptionalLocalDotEnv(): void {
  if (loaded) return;
  loaded = true;

  if (process.env["VITEST"] || process.env["NODE_ENV"] === "test") {
    return;
  }

  const envPath = path.resolve(process.cwd(), ".env");
  if (!fs.existsSync(envPath)) {
    return;
  }

  let content: string;
  try {
    content = fs.readFileSync(envPath, "utf8");
  } catch {
    return;
  }

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const withoutExport = line.startsWith("export ") ? line.slice(7).trim() : line;
    const eqIdx = withoutExport.indexOf("=");
    if (eqIdx <= 0) continue;
    const key = withoutExport.slice(0, eqIdx).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;

    let val = withoutExport.slice(eqIdx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = val;
    }
  }
}
