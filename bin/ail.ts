#!/usr/bin/env node
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * AIL (AI Language) - CLI Tool
 * Canonical convention: *.XX.ail <---> *.XX
 */

import { Command } from "commander";
import { AIL_VERSION } from "../src/index.ts";

const program = new Command();

program
  .name("ail")
  .description(
    "AIL: Token-Efficient Homoiconic Bidirectional Programming Language & Compiler Engine",
  )
  .version(AIL_VERSION);

program
  .command("compile")
  .description("Compile a single AIL file (*.XX.ail) into its target file (*.XX)")
  .argument("<file>", "Path to source AIL file (e.g. index.ts.ail, index.html.ail)")
  .option("-o, --output <path>", "Custom output file path")
  .option("--strip-trivia", "Do not reinsert CST trivia (comments/formatting)")
  .action(async (file, _options) => {
    console.log(`\x1b[36m[AIL Compiler]\x1b[0m Compiling \x1b[33m${file}\x1b[0m ...`);
  });

program
  .command("decompile")
  .description("Decompile a target language or markup file (*.XX) into AIL (*.XX.ail)")
  .argument("<file>", "Path to target file (e.g. index.ts, index.html, styles.css)")
  .option("-o, --output <path>", "Custom output file path")
  .action(async (file, _options) => {
    console.log(
      `\x1b[36m[AIL Decompiler]\x1b[0m Decompiling \x1b[33m${file}\x1b[0m to AIL (*.XX.ail) ...`,
    );
  });

program
  .command("compile-all")
  .description("Recursively compile all *.XX.ail files in a directory to target files")
  .argument("[dir]", "Directory path to traverse", ".")
  .option("-o, --out <dir>", "Output directory (default: alongside .ail files)")
  .option("-w, --watch", "Watch mode: continuously recompile changed *.XX.ail files")
  .action(async (dir, _options) => {
    console.log(
      `\x1b[36m[AIL Compiler]\x1b[0m Recursively compiling all *.XX.ail in \x1b[33m${dir}\x1b[0m ...`,
    );
  });

program
  .command("decompile-all")
  .description("Recursively decompile all supported project files into *.XX.ail files")
  .argument("[dir]", "Directory path to traverse", ".")
  .option("-o, --out <dir>", "Output directory (default: alongside target files)")
  .option(
    "--ext <extensions>",
    "Comma-separated list of extensions to decompile (e.g. ts,tsx,html,css,py)",
  )
  .action(async (dir, _options) => {
    console.log(
      `\x1b[36m[AIL Decompiler]\x1b[0m Recursively decompiling target files in \x1b[33m${dir}\x1b[0m to *.XX.ail ...`,
    );
  });

program
  .command("verify")
  .description("Statically verify an AIL file for type, typestate, and refinement invariants")
  .argument("<file>", "Path to AIL file (*.XX.ail)")
  .option("--json", "Output diagnostics in structured JSON schema format")
  .action(async (file, _options) => {
    console.log(
      `\x1b[36m[AIL Verifier]\x1b[0m Verifying static invariants in \x1b[33m${file}\x1b[0m ...`,
    );
  });

program
  .command("roundtrip-test")
  .description("Verify bidirectional lens identity: Put(Get(c), c) == c and Get(Put(a)) == a")
  .argument("<target>", "File or directory to execute roundtrip test on")
  .action(async (target) => {
    console.log(
      `\x1b[36m[AIL Lens Verifier]\x1b[0m Testing bidirectional roundtrip for \x1b[33m${target}\x1b[0m ...`,
    );
  });

program
  .command("benchmark")
  .description("Measure BPE / SentencePiece token savings of AIL (*.XX.ail) vs target (*.XX)")
  .argument("<file>", "Path to file to benchmark")
  .action(async (file) => {
    console.log(
      `\x1b[36m[AIL Tokenomics]\x1b[0m Running tokenomics analysis on \x1b[33m${file}\x1b[0m ...`,
    );
  });

program.parse(process.argv);
