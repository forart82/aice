#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { constants as osConstants } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(realpathSync(fileURLToPath(import.meta.url)));
const entry = resolve(__dirname, "aice.ts");
const args = process.argv.slice(2);
const tsxCliMjs = resolve(__dirname, "../node_modules/tsx/dist/cli.mjs");

let result;
if (existsSync(tsxCliMjs)) {
  result = spawnSync(process.execPath, [tsxCliMjs, entry, ...args], {
    stdio: "inherit",
    env: process.env,
  });
} else if (process.platform === "win32") {
  const winBin = resolve(__dirname, "../node_modules/.bin/tsx.cmd");
  result = spawnSync(existsSync(winBin) ? winBin : "tsx.cmd", [entry, ...args], {
    stdio: "inherit",
    env: process.env,
    shell: true,
  });
} else {
  const posixBin = resolve(__dirname, "../node_modules/.bin/tsx");
  result = spawnSync(existsSync(posixBin) ? posixBin : "tsx", [entry, ...args], {
    stdio: "inherit",
    env: process.env,
  });
}

if (result.error) {
  process.stderr.write(`Failed to launch AICE CLI: ${result.error.message}\n`);
  process.exit(1);
}
if (result.signal) {
  const sigNum = osConstants.signals[result.signal] ?? 1;
  process.exit(128 + sigNum);
}
process.exit(result.status ?? 1);
