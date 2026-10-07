#!/usr/bin/env node
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * AIL: Executable wrapper
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const tsPath = join(__dirname, "ail.ts");
const tsxBin = join(__dirname, "../node_modules/.bin/tsx");

if (fs.existsSync(tsxBin)) {
  const proc = spawn(process.execPath, [tsxBin, tsPath, ...process.argv.slice(2)], {
    stdio: "inherit",
    env: process.env,
  });

  proc.on("exit", (code) => {
    process.exit(code ?? 0);
  });
} else {
  const proc = spawn("bun", ["run", tsPath, ...process.argv.slice(2)], {
    stdio: "inherit",
    env: process.env,
  });

  proc.on("exit", (code) => {
    process.exit(code ?? 0);
  });
}
