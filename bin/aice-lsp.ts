#!/usr/bin/env node
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * AICE 2.0 Language Server Protocol (LSP) Daemon Standalone Executable.
 * Communicates via JSON-RPC 2.0 over standard I/O (stdin/stdout).
 */

import { AiceLspServer } from "../src/lsp/server.js";

// Ensure process stays alive and attaches to stdio
process.stdin.resume();

new AiceLspServer(process.stdin, process.stdout);

process.on("SIGINT", () => {
  process.exit(0);
});

process.on("SIGTERM", () => {
  process.exit(0);
});
