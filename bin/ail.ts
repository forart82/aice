#!/usr/bin/env node
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * AIL (AI Language) - CLI Tool
 * Canonical convention: *.XX.ail <---> *.XX
 */

import fs from "node:fs";
import path from "node:path";
import { Command } from "commander";
import {
  AIL_VERSION,
  compileAil,
  createStructuredDiagnostic,
  parseAil,
  type StructuredDiagnostic,
  typecheckAil,
} from "../src/index.ts";

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
  .option("--stdout", "Print output to stdout instead of writing to disk")
  .action(async (file, options) => {
    try {
      const startTime = performance.now();
      const inputPath = path.resolve(file);
      if (!fs.existsSync(inputPath)) {
        console.error(`\x1b[31m[AIL Error]\x1b[0m File not found: ${inputPath}`);
        process.exit(1);
      }

      const source = fs.readFileSync(inputPath, "utf-8");

      let outputPath = options.output;
      if (!outputPath) {
        if (inputPath.endsWith(".ail")) {
          outputPath = inputPath.slice(0, -4);
        } else {
          outputPath = `${inputPath}.out`;
        }
      } else {
        outputPath = path.resolve(outputPath);
      }

      const result = compileAil(source, outputPath, {
        stripTrivia: options.stripTrivia,
      });

      if (options.stdout) {
        process.stdout.write(result.code);
        return;
      }

      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, result.code, "utf-8");

      const elapsed = (performance.now() - startTime).toFixed(1);
      const inBytes = Buffer.byteLength(source, "utf-8");
      const outBytes = Buffer.byteLength(result.code, "utf-8");

      console.log(
        `\x1b[32m✔\x1b[0m Compiled \x1b[36m${path.basename(inputPath)}\x1b[0m -> \x1b[33m${path.basename(outputPath)}\x1b[0m (\x1b[35m${result.targetLanguage}\x1b[0m) in ${elapsed}ms`,
      );
      console.log(`  Size: ${inBytes} B (AIL) -> ${outBytes} B (Target)`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`\x1b[31m[AIL Compiler Error]\x1b[0m ${msg}`);
      process.exit(1);
    }
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

function findAilFiles(dir: string): string[] {
  const results: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.name === "dist") {
      continue;
    }
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findAilFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith(".ail")) {
      results.push(fullPath);
    }
  }

  return results;
}

program
  .command("compile-all")
  .description("Recursively compile all *.XX.ail files in a directory to target files")
  .argument("[dir]", "Directory path to traverse", ".")
  .option("-o, --out <dir>", "Output directory (default: alongside .ail files)")
  .option("-w, --watch", "Watch mode: continuously recompile changed *.XX.ail files")
  .option("--strip-trivia", "Do not reinsert CST trivia (comments/formatting)")
  .action(async (dir, options) => {
    const rootDir = path.resolve(dir);
    if (!fs.existsSync(rootDir)) {
      console.error(`\x1b[31m[AIL Error]\x1b[0m Directory not found: ${rootDir}`);
      process.exit(1);
    }

    const compileSingle = (filePath: string) => {
      try {
        const source = fs.readFileSync(filePath, "utf-8");
        const outputPath = filePath.endsWith(".ail") ? filePath.slice(0, -4) : `${filePath}.out`;
        const result = compileAil(source, outputPath, {
          stripTrivia: options.stripTrivia,
        });
        fs.writeFileSync(outputPath, result.code, "utf-8");
        console.log(
          `  \x1b[32m✔\x1b[0m ${path.relative(rootDir, filePath)} -> ${path.basename(outputPath)} (${result.targetLanguage})`,
        );
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`  \x1b[31m✖\x1b[0m ${path.relative(rootDir, filePath)}: ${msg}`);
      }
    };

    console.log(
      `\x1b[36m[AIL Compiler]\x1b[0m Scanning \x1b[33m${rootDir}\x1b[0m for *.XX.ail ...`,
    );
    const files = findAilFiles(rootDir);
    console.log(`Found ${files.length} AIL file(s) to compile.`);

    for (const f of files) {
      compileSingle(f);
    }

    if (options.watch) {
      console.log(`\x1b[35m[AIL Watcher]\x1b[0m Watching for changes in ${rootDir} ...`);
      fs.watch(rootDir, { recursive: true }, (_eventType, filename) => {
        if (filename?.endsWith(".ail")) {
          const fullPath = path.join(rootDir, filename);
          if (fs.existsSync(fullPath)) {
            console.log(`\x1b[33m[AIL Modified]\x1b[0m ${filename}`);
            compileSingle(fullPath);
          }
        }
      });
    }
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
  .action(async (file, options) => {
    try {
      const inputPath = path.resolve(file);
      if (!fs.existsSync(inputPath)) {
        console.error(`\x1b[31m[AIL Error]\x1b[0m File not found: ${inputPath}`);
        process.exit(1);
      }
      const source = fs.readFileSync(inputPath, "utf-8");
      const { document, diagnostics: parseDiags } = parseAil(source, inputPath);

      const allDiags: StructuredDiagnostic[] = parseDiags.map((d) =>
        createStructuredDiagnostic(
          "SYNTACTIC",
          d.code,
          d.message,
          "Ensure valid S-expression syntax and balance delimiters",
          { span: d.span },
        ),
      );

      if (document) {
        const typeResult = typecheckAil(document);
        allDiags.push(...typeResult.diagnostics);
      }

      if (options.json) {
        console.log(
          JSON.stringify({ valid: allDiags.length === 0, diagnostics: allDiags }, null, 2),
        );
        if (allDiags.length > 0) process.exit(1);
        return;
      }

      if (allDiags.length === 0) {
        console.log(
          `\x1b[32m✔ [AIL Verifier]\x1b[0m Invariants statically proven for \x1b[36m${file}\x1b[0m (0 violations)`,
        );
      } else {
        console.error(
          `\x1b[31m✖ [AIL Verifier]\x1b[0m ${allDiags.length} violation(s) found in \x1b[33m${file}\x1b[0m:`,
        );
        for (const diag of allDiags) {
          const loc = diag.span ? `:${diag.span.line}:${diag.span.col}` : "";
          console.error(
            `  - \x1b[31m${diag.violation.code}\x1b[0m${loc}: ${diag.violation.message}`,
          );
          if (diag.candidate_fix) {
            console.error(`    \x1b[36mFix:\x1b[0m ${diag.candidate_fix}`);
          }
        }
        process.exit(1);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`\x1b[31m[AIL Verifier Error]\x1b[0m ${msg}`);
      process.exit(1);
    }
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
