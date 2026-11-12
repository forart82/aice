#!/usr/bin/env node
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * AICE Standalone Artifact Builder.
 * Compiles all TypeScript sources and runtime dependencies into a single,
 * self-contained executable bundle at dist/aice.mjs.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const distDir = path.join(rootDir, "dist");
const outFile = path.join(distDir, "aice.mjs");

fs.mkdirSync(distDir, { recursive: true });

const start = Date.now();
console.log("⚡ Building standalone AICE executable bundle (dist/aice.mjs)...");

await esbuild.build({
  entryPoints: [path.join(rootDir, "bin", "aice.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node18",
  outfile: outFile,
  banner: {
    js: `import { createRequire as __createRequire } from "node:module";
import { fileURLToPath as __fileURLToPath } from "node:url";
import { dirname as __pathDirname } from "node:path";
const require = __createRequire(import.meta.url);
const __filename = __fileURLToPath(import.meta.url);
const __dirname = __pathDirname(__filename);`,
  },
  minify: false,
  sourcemap: false,
});

fs.chmodSync(outFile, 0o755);

const stats = fs.statSync(outFile);
const sizeMb = (stats.size / (1024 * 1024)).toFixed(2);
const elapsedMs = Date.now() - start;

console.log(`✔ Standalone bundle ready: ${outFile} (${sizeMb} MB) in ${elapsedMs}ms`);
