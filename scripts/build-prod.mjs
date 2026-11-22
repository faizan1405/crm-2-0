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

function loadRolldown() {
  try {
    return require("rolldown");
  } catch {
    const viteRequire = createRequire(vitePkgPath);
    return viteRequire("rolldown");
  }
}

async function bundleStandaloneCronRunner(cronSrc, cronOut) {
  const { rolldown } = loadRolldown();
  const bundle = await rolldown({
    input: cronSrc,
    platform: "node",
    external: /^node:/,
  });
  try {
    await bundle.write({
      file: cronOut,
      format: "esm",
      codeSplitting: false,
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
    const outServerDir = path.resolve(process.cwd(), ".output/server");
    const standaloneScripts = [
      { src: "scripts/run-automation-cron.mjs", out: "run-cron.mjs" },
      { src: "scripts/bootstrap-owner.mjs", out: "bootstrap-owner.mjs" },
    ];
    if (fs.existsSync(outServerDir)) {
      for (const item of standaloneScripts) {
        const srcPath = path.resolve(process.cwd(), item.src);
        if (fs.existsSync(srcPath)) {
          // Nitro strips mysql2 from .output/server/node_modules, so bundle
          // Hostinger CLI scripts with rolldown to guarantee standalone execution.
          await bundleStandaloneCronRunner(srcPath, path.join(outServerDir, item.out));
        }
      }
    }
  }

  process.exit(result.status ?? 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
