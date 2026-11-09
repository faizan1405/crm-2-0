import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";

const args = process.argv.slice(2);
const modeIdx = args.indexOf("--mode");
const isExplicitDevMode =
  args.includes("--mode=development") || (modeIdx !== -1 && args[modeIdx + 1] === "development");

const require = createRequire(import.meta.url);
const vitePkgPath = require.resolve("vite/package.json");
const viteBinPath = path.resolve(path.dirname(vitePkgPath), "bin/vite.js");

const env = { ...process.env };
if (!isExplicitDevMode) {
  // Set before Vite's resolveConfig reads `isNodeEnvSet`, preventing local `.env`
  // `NODE_ENV=development` from switching SSR JSX to `jsxDEV()` against a prod React runtime.
  env["NODE_ENV"] = "production";
}

const result = spawnSync(process.execPath, [viteBinPath, "build", ...args], {
  stdio: "inherit",
  env,
});

if (result.error) {
  throw result.error;
}

process.exit(result.status ?? 1);
