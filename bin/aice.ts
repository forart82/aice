#!/usr/bin/env node
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * AICE CLI: On-the-Fly AI Context Engine & Multi-File Idiom Tool.
 */

import * as nodeModule from "node:module";

try {
  (nodeModule as { enableCompileCache?: () => void }).enableCompileCache?.();
} catch {}

import * as fs from "node:fs";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { registerAdminCommands } from "../src/cli/admin-commands.js";
import { executeCompile, registerCompileCommands } from "../src/cli/compile-commands.js";
import { registerMcpAndBenchCommands } from "../src/cli/mcp-and-bench-commands.js";
import { registerReadCommands } from "../src/cli/read-commands.js";
import { registerSpliceCommands } from "../src/cli/splice-commands.js";
import {
  attachSubcommandErrorTelemetry,
  hasRecordedCliFailure,
  installCliProgramHooks,
  normalizeCliContextFlag,
  recordCliFailureTelemetry,
} from "../src/cli/telemetry-and-flags.js";
import { registerUtilityCommands } from "../src/cli/utility-commands.js";
import { AICE_VERSION } from "../src/version.js";

const program = new Command();

program
  .name("aice")
  .description(
    "AICE: On-the-Fly AI Context Engine & Multi-File Idiom CLI (by @forart82 — https://github.com/forart82/aice)",
  )
  .version(AICE_VERSION)
  .option("--no-color", "Disable ANSI terminal colors")
  .option("--color", "Enable ANSI terminal colors")
  .configureOutput({
    outputError: (str, write) => {
      recordCliFailureTelemetry(str);
      write(str);
    },
  });

installCliProgramHooks(program);

registerCompileCommands(program);
registerMcpAndBenchCommands(program);
registerSpliceCommands(program);
registerReadCommands(program);
registerUtilityCommands(program);
registerAdminCommands(program);

program.addHelpText(
  "after",
  `
================================================================================
AICE STRICT 2-TOOL AI ENGINE WORKFLOW (aice read + aice splice)
================================================================================

Pillar 1 — Unified Read (aice read | alias: context, MCP: aice_read)
  • Auto-outline directories & >120-line files (85-90% token reduction):
      aice read src tests
      aice read bin/aice.ts
  • Multi-file AST symbol slicing, line ranges & 4-tier /pattern/ search in 1 turn:
      aice read src/app.ts:GameApp.init src/utils.ts:L20-L60
      aice read src -s "/GameApp/"

Pillar 2 — Unified Write (aice splice | alias: write, MCP: aice_splice)
  • Greenfield file creation, multi-file streams & surgical AST/hunk updates:
      aice splice src/app.ts -c "pub fn add(a: int, b: int) -> int = a + b"
      aice splice src/app.ts -s oldFunc -c "fn oldFunc() = 42"
      aice splice --stdin << 'EOF'

Administration, Agent Integration & Honest BPE Telemetry
  • Global MCP stdio server & CLI coding agent setup:
      aice mcp / aice agents setup / aice agents status
  • Project configuration & token-savings telemetry:
      aice enable / aice disable / aice config
      aice gain [project] / aice analyze [project] / aice benchmark

Author: @forart82 (https://github.com/forart82/aice) | License: Apache-2.0
`,
);

export { executeCompile, normalizeCliContextFlag, program, recordCliFailureTelemetry };

const isDirectCliRun = () => {
  if (!process.argv[1]) return false;
  try {
    const thisFile = fileURLToPath(import.meta.url);
    const invokedFile = fs.realpathSync(process.argv[1]);
    if (thisFile === invokedFile) return true;
  } catch {
    // fallback
  }
  const normalizedArgv1 = process.argv[1].replace(/\\/g, "/");
  return Boolean(
    (normalizedArgv1.endsWith("/bin/aice.ts") ||
      normalizedArgv1.endsWith("/bin/aice.mjs") ||
      normalizedArgv1.endsWith("/bin/aice.js") ||
      normalizedArgv1.endsWith("/bin/aice") ||
      normalizedArgv1.endsWith("/aice") ||
      normalizedArgv1 === "aice") &&
      !normalizedArgv1.includes("test") &&
      !normalizedArgv1.includes("vitest"),
  );
};

attachSubcommandErrorTelemetry(program);

if (isDirectCliRun()) {
  let lastStderrLine = "";
  const origConsoleError = console.error.bind(console);
  console.error = (...errArgs: unknown[]) => {
    const joined = errArgs.map((a) => (typeof a === "string" ? a : String(a))).join(" ");
    if (joined.trim()) {
      lastStderrLine = joined.trim();
    }
    origConsoleError(...errArgs);
  };

  process.on("unhandledRejection", (reason: unknown) => {
    const msg = reason instanceof Error ? reason.stack || reason.message : String(reason);
    recordCliFailureTelemetry(msg);
    origConsoleError(`❌ Unhandled CLI rejection: ${msg}`);
    process.exit(1);
  });

  process.on("uncaughtException", (err: Error) => {
    const msg = err.stack || err.message || String(err);
    recordCliFailureTelemetry(msg);
    origConsoleError(`❌ Uncaught CLI exception: ${msg}`);
    process.exit(1);
  });

  process.on("exit", (code) => {
    if (code !== 0 && !hasRecordedCliFailure()) {
      recordCliFailureTelemetry(lastStderrLine || `CLI exited with code ${code}`);
    }
  });

  program.parseAsync(process.argv).catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    recordCliFailureTelemetry(msg);
    origConsoleError(`❌ CLI error: ${msg}`);
    process.exit(1);
  });
}
