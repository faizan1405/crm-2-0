import { spawnSync } from "node:child_process";
import fs from "node:fs";
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

async function bundleStandaloneCronRunner(cronSrc, cronOut) {
  const { rolldown } = require("rolldown");
  const bundle = await rolldown({
    input: cronSrc,
    platform: "node",
    external: /^node:/,
  });
  try {
    await bundle.write({
      file: cronOut,
      format: "esm",
    });
  } finally {
    await bundle.close();
  }
}

async function main() {
  const result = spawnSync(process.execPath, [viteBinPath, "build", ...args], {
    stdio: "inherit",
    env,
  });

  if (result.error) {
    throw result.error;
  }

  if ((result.status ?? 1) === 0 && !isExplicitDevMode) {
    const cronSrc = path.resolve(process.cwd(), "scripts/run-automation-cron.mjs");
    const outServerDir = path.resolve(process.cwd(), ".output/server");
    if (fs.existsSync(cronSrc) && fs.existsSync(outServerDir)) {
      // Nitro strips mysql2 from .output/server/node_modules, so bundle the
      // Hostinger cron CLI with rolldown to guarantee standalone execution.
      await bundleStandaloneCronRunner(cronSrc, path.join(outServerDir, "run-cron.mjs"));
    }
  }

  process.exit(result.status ?? 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
