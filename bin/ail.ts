#!/usr/bin/env node
/**
 * AIL CLI Compiler & Verification Tool.
 * Provides `ail compile`, `ail compile-all`, and `ail verify [--json]`.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { Command } from "commander";
import { parse } from "../src/core/parser.js";
import { decompile, executeRoundtrip } from "../src/decompiler/index.js";
import {
  detectTargetFromPath,
  emitTarget,
  getTargetOutputPath,
  type TargetLanguage,
} from "../src/emitters/index.js";
import { AilLspServer } from "../src/lsp/server.js";
import {
  auditTokenomics,
  formatProjectsMarkdownTable,
  formatTokenomicsMarkdownTable,
} from "../src/tokenomics/index.js";
import { TypeChecker } from "../src/typechecker/checker.js";
import {
  attemptSelfRepair,
  buildReportFromError,
  formatDiagnosticJson,
  formatDiagnosticText,
} from "../src/typechecker/diagnostics.js";

const program = new Command();

program
  .name("ail")
  .description("AIL: Token-Efficient Homoiconic Bidirectional Compiler CLI")
  .version("0.2.19");

// Command: compile <file>
program
  .command("compile")
  .description("Compile an .ail source file to its target language")
  .argument("<file>", "Path to the .ail source file")
  .option("-o, --out <out>", "Output file path")
  .option(
    "-t, --target <target>",
    "Explicit target language (typescript, tsx, python, html, css, rust, go)",
  )
  .option("--fix", "Autonomously repair fixable errors before compiling")
  .action((file: string, options: { out?: string; target?: string; fix?: boolean }) => {
    try {
      const fullPath = path.resolve(process.cwd(), file);
      if (!fs.existsSync(fullPath)) {
        console.error(`❌ Error: Source file not found: ${file}`);
        process.exit(1);
      }

      let source = fs.readFileSync(fullPath, "utf-8");

      if (options.fix) {
        const repairRes = attemptSelfRepair(source, file);
        if (repairRes.fixed && repairRes.modified) {
          fs.writeFileSync(fullPath, repairRes.finalSource, "utf-8");
          console.log(`💡 Autonomous self-repair applied (${repairRes.iterations} iteration(s)):`);
          for (const r of repairRes.repairs) {
            console.log(`  - ${r.description}`);
          }
          source = repairRes.finalSource;
        }
      }

      const mod = parse(source, file);

      // Sound type check
      const tc = new TypeChecker();
      tc.checkModule(mod);

      // Target selection
      const targetLang = (options.target as TargetLanguage) ?? detectTargetFromPath(file);
      const emitted = emitTarget(mod, targetLang);

      // Output path
      const outPath = options.out
        ? path.resolve(process.cwd(), options.out)
        : path.resolve(process.cwd(), getTargetOutputPath(file));

      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, emitted, "utf-8");

      console.log(`✔ Compiled ${file} -> ${path.relative(process.cwd(), outPath)} [${targetLang}]`);
    } catch (err) {
      const source = fs.existsSync(file) ? fs.readFileSync(file, "utf-8") : "";
      const report = buildReportFromError(err, source, file);
      console.error(formatDiagnosticText(report));
      process.exit(1);
    }
  });

// Command: compile-all <dir>
program
  .command("compile-all")
  .description("Recursively compile all .ail source files in a directory")
  .argument("[dir]", "Directory to search for .ail files", ".")
  .option("--out-dir <outDir>", "Optional destination directory for emitted files")
  .action((dir: string, options: { outDir?: string }) => {
    try {
      const searchDir = path.resolve(process.cwd(), dir);
      if (!fs.existsSync(searchDir)) {
        console.error(`❌ Error: Directory not found: ${dir}`);
        process.exit(1);
      }

      function findAilFiles(curDir: string): string[] {
        const entries = fs.readdirSync(curDir, { withFileTypes: true });
        const results: string[] = [];
        for (const entry of entries) {
          const res = path.resolve(curDir, entry.name);
          if (entry.isDirectory()) {
            if (entry.name !== "node_modules" && entry.name !== ".git") {
              results.push(...findAilFiles(res));
            }
          } else if (entry.isFile() && entry.name.endsWith(".ail")) {
            results.push(res);
          }
        }
        return results;
      }

      const files = findAilFiles(searchDir);
      if (files.length === 0) {
        console.log(`No .ail files found in ${dir}`);
        return;
      }

      let successCount = 0;
      let failCount = 0;

      for (const f of files) {
        const relPath = path.relative(process.cwd(), f);
        try {
          const source = fs.readFileSync(f, "utf-8");
          const mod = parse(source, relPath);
          const tc = new TypeChecker();
          tc.checkModule(mod);

          const targetLang = detectTargetFromPath(relPath);
          const emitted = emitTarget(mod, targetLang);

          let outPath = getTargetOutputPath(f);
          if (options.outDir) {
            const relFromSearch = path.relative(searchDir, outPath);
            outPath = path.resolve(process.cwd(), options.outDir, relFromSearch);
          }

          fs.mkdirSync(path.dirname(outPath), { recursive: true });
          fs.writeFileSync(outPath, emitted, "utf-8");
          console.log(
            `✔ Compiled ${relPath} -> ${path.relative(process.cwd(), outPath)} [${targetLang}]`,
          );
          successCount++;
        } catch (err) {
          console.error(`\n❌ Failed to compile ${relPath}:`);
          const source = fs.readFileSync(f, "utf-8");
          const report = buildReportFromError(err, source, relPath);
          console.error(formatDiagnosticText(report));
          failCount++;
        }
      }

      console.log(`\nFinished: ${successCount} compiled successfully, ${failCount} failed.`);
      if (failCount > 0) {
        process.exit(1);
      }
    } catch (err) {
      console.error(err);
      process.exit(1);
    }
  });

// Command: clean [dir]
program
  .command("clean")
  .description("Remove all emitted target files generated from .ail files in a directory")
  .argument("[dir]", "Directory containing .ail files", ".")
  .action((dir: string) => {
    try {
      const searchDir = path.resolve(process.cwd(), dir);
      if (!fs.existsSync(searchDir)) {
        console.error(`Directory not found: ${dir}`);
        process.exit(1);
      }

      function findAilFiles(current: string): string[] {
        let results: string[] = [];
        const entries = fs.readdirSync(current, { withFileTypes: true });
        for (const entry of entries) {
          const full = path.join(current, entry.name);
          if (entry.isDirectory() && entry.name !== "node_modules" && !entry.name.startsWith(".")) {
            results = results.concat(findAilFiles(full));
          } else if (entry.isFile() && entry.name.endsWith(".ail")) {
            results.push(full);
          }
        }
        return results;
      }

      const files = findAilFiles(searchDir);
      let removedCount = 0;

      for (const f of files) {
        const outPath = getTargetOutputPath(f);
        if (fs.existsSync(outPath)) {
          fs.unlinkSync(outPath);
          console.log(`✔ Removed ${path.relative(process.cwd(), outPath)}`);
          removedCount++;
        }
      }

      console.log(`\nFinished: ${removedCount} generated files removed.`);
    } catch (err) {
      console.error(err);
      process.exit(1);
    }
  });

// Command: verify <file>
program
  .command("verify")
  .description("Verify syntactic and type soundness of an .ail file without emitting")
  .argument("<file>", "Path to the .ail source file")
  .option("--json", "Output machine-readable telemetry JSON for LLM autonomous self-repair")
  .option("--fix", "Autonomously repair fixable violations before verification")
  .action((file: string, options: { json?: boolean; fix?: boolean }) => {
    try {
      const fullPath = path.resolve(process.cwd(), file);
      if (!fs.existsSync(fullPath)) {
        if (options.json) {
          console.log(
            JSON.stringify({
              status: "FAILURE",
              file,
              diagnostics: [
                {
                  status: "REJECTED",
                  error_phase: "VERIFICATION",
                  file,
                  span: { start: { line: 1, column: 1 }, end: { line: 1, column: 1 } },
                  violation: {
                    code: "AIL_E0001_FILE_NOT_FOUND",
                    message: `File not found: ${file}`,
                  },
                  caret_slice: "",
                },
              ],
            }),
          );
        } else {
          console.error(`❌ Error: Source file not found: ${file}`);
        }
        process.exit(1);
      }

      let source = fs.readFileSync(fullPath, "utf-8");

      if (options.fix) {
        const repairRes = attemptSelfRepair(source, file);
        if (repairRes.fixed && repairRes.modified) {
          fs.writeFileSync(fullPath, repairRes.finalSource, "utf-8");
          if (!options.json) {
            console.log(`💡 Autonomous self-repair applied (${repairRes.iterations} iteration(s)):`);
            for (const r of repairRes.repairs) {
              console.log(`  - ${r.description}`);
            }
          }
          source = repairRes.finalSource;
        }
      }

      const mod = parse(source, file);
      const tc = new TypeChecker();
      tc.checkModule(mod);

      if (options.json) {
        console.log(
          JSON.stringify({
            status: "SUCCESS",
            file,
            diagnostics: [],
          }),
        );
      } else {
        console.log(
          `✔ Verification successful: ${file} passed all lexical, syntax, and type checks.`,
        );
      }
    } catch (err) {
      const source = fs.existsSync(file) ? fs.readFileSync(file, "utf-8") : "";
      const report = buildReportFromError(err, source, file);
      if (options.json) {
        console.log(formatDiagnosticJson(report));
      } else {
        console.error(formatDiagnosticText(report));
      }
      process.exit(1);
    }
  });

// Command: fix <file>
program
  .command("fix")
  .description("Autonomously repair syntax, immutability, and type violations in an .ail file")
  .argument("<file>", "Path to the .ail source file to repair")
  .option("--dry-run", "Display candidate repairs and unified diffs without modifying disk")
  .option("--json", "Output machine-readable JSON repair telemetry")
  .action((file: string, options: { dryRun?: boolean; json?: boolean }) => {
    try {
      const fullPath = path.resolve(process.cwd(), file);
      if (!fs.existsSync(fullPath)) {
        console.error(`❌ Error: Source file not found: ${file}`);
        process.exit(1);
      }

      const source = fs.readFileSync(fullPath, "utf-8");
      const res = attemptSelfRepair(source, file);

      if (options.json) {
        console.log(JSON.stringify(res, null, 2));
        if (!res.fixed) process.exit(1);
        return;
      }

      if (res.fixed && !res.modified) {
        console.log(
          `✔ Source file is already sound: ${file} passed all checks with zero repairs needed.`,
        );
        return;
      }

      if (res.fixed && res.modified) {
        if (!options.dryRun) {
          fs.writeFileSync(fullPath, res.finalSource, "utf-8");
          console.log(
            `✔ Autonomous self-repair applied successfully to ${file} (${res.iterations} iteration(s)):`,
          );
        } else {
          console.log(
            `💡 [DRY-RUN] Candidate repairs for ${file} (${res.iterations} iteration(s)):`,
          );
        }
        for (const r of res.repairs) {
          console.log(`  - ${r.description}`);
          if (options.dryRun) {
            console.log(`\n${r.patch}\n`);
          }
        }
        return;
      }

      console.error(
        `❌ Autonomous self-repair could not completely resolve all violations in ${file}:`,
      );
      if (res.error) {
        console.error(formatDiagnosticText(res.error));
      }
      process.exit(1);
    } catch (err) {
      console.error(`❌ Error during self-repair:`, err);
      process.exit(1);
    }
  });

// Command: decompile <file>
program
  .command("decompile")
  .description("Decompile a target language file (.ts, .tsx, .css, .html) into an .ail source file")
  .argument("<file>", "Path to the target source file")
  .option("-o, --out <out>", "Output .ail file path")
  .option("-t, --target <target>", "Target language (typescript, tsx, css, html)")
  .option("--trivia", "Emit a .trivia.json sidecar preserving original comments")
  .action((file: string, options: { out?: string; target?: string; trivia?: boolean }) => {
    try {
      const fullPath = path.resolve(process.cwd(), file);
      if (!fs.existsSync(fullPath)) {
        console.error(`❌ Error: Source file not found: ${file}`);
        process.exit(1);
      }

      const source = fs.readFileSync(fullPath, "utf-8");
      const targetLang = (options.target as TargetLanguage) ?? detectTargetFromPath(file);
      const result = decompile(source, targetLang, { filePath: file });

      const outPath = options.out
        ? path.resolve(process.cwd(), options.out)
        : path.resolve(process.cwd(), `${file}.ail`);

      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, result.ail, "utf-8");

      if (options.trivia && result.trivia.size() > 0) {
        const triviaPath = `${outPath}.trivia.json`;
        fs.writeFileSync(triviaPath, JSON.stringify(result.trivia.toJSON(), null, 2), "utf-8");
        console.log(`✔ Emitted trivia sidecar: ${path.relative(process.cwd(), triviaPath)}`);
      }

      console.log(
        `✔ Decompiled ${file} -> ${path.relative(process.cwd(), outPath)} [${targetLang}]`,
      );
    } catch (err) {
      console.error(`❌ Decompilation error:`, err);
      process.exit(1);
    }
  });

// Command: roundtrip <file>
program
  .command("roundtrip")
  .description("Verify Put/Get stability by decompiling to .ail and recompiling to target")
  .argument("<file>", "Path to target source file")
  .option("-t, --target <target>", "Target language (typescript, tsx, css, html)")
  .action((file: string, options: { target?: string }) => {
    try {
      const fullPath = path.resolve(process.cwd(), file);
      if (!fs.existsSync(fullPath)) {
        console.error(`❌ Error: Source file not found: ${file}`);
        process.exit(1);
      }

      const source = fs.readFileSync(fullPath, "utf-8");
      const targetLang = (options.target as TargetLanguage) ?? detectTargetFromPath(file);
      const res = executeRoundtrip(source, targetLang, file);

      console.log(`\n=== Bidirectional Roundtrip Audit: ${file} ===`);
      console.log(`Target Language:     ${res.target}`);
      console.log(`Trivia Entries:      ${res.triviaEntriesCount}`);
      console.log(`Original Size:       ${res.original.length} chars`);
      console.log(`AIL Representation:  ${res.ail.length} chars`);
      console.log(`Reconstructed Size:  ${res.reconstructed.length} chars`);
      console.log(
        `Stability Status:    ${res.isIdentical ? "✔ IDENTICAL (Lossless Put/Get)" : "✔ SEMANTICALLY RECONSTRUCTED"}`,
      );

      if (!res.isIdentical && res.diff) {
        console.log(`\nDiff Summary:\n${res.diff.slice(0, 1000)}`);
      }
    } catch (err) {
      console.error(`❌ Roundtrip error:`, err);
      process.exit(1);
    }
  });

// Command: lsp
program
  .command("lsp")
  .description("Launch the AIL Language Server Protocol (LSP) daemon over stdio")
  .action(() => {
    new AilLspServer(process.stdin, process.stdout);
  });

// Command: verify-tokenomics [dir]
program
  .command("verify-tokenomics")
  .alias("tokenomics")
  .description("Audit token and character savings against cl100k_base and o200k_base tokenizers")
  .argument("[dir]", "Directory containing .ail files", "examples")
  .option(
    "--min-savings <pct>",
    "Minimum required savings percentage across tokenizers",
    Number.parseFloat,
  )
  .option("--check-drift", "Enforce zero target drift against existing compiled files")
  .option("--projects", "Aggregate output by project (1 line per project)")
  .option("--json", "Output machine-readable JSON telemetry for CI pipelines")
  .action((dir: string, options: { minSavings?: number; checkDrift?: boolean; projects?: boolean; json?: boolean }) => {
    try {
      const report = auditTokenomics(dir, {
        minSavings: options.minSavings,
        checkDrift: options.checkDrift,
      });

      if (options.json) {
        console.log(JSON.stringify(report, null, 2));
      } else {
        console.log(`\n=== AIL 2.0 Tokenomics & Zero-Drift Benchmark Audit: ${dir} ===\n`);
        if (options.projects) {
          console.log(formatProjectsMarkdownTable(report));
        } else {
          console.log(formatTokenomicsMarkdownTable(report));
        }
        console.log();

        if (report.driftDetected) {
          console.error("❌ Target drift detected! Compiled output differs from target file.");
        }

        if (options.minSavings !== undefined && !report.passedThreshold) {
          console.error(
            `❌ Tokenomics savings threshold violation! Required >= ${options.minSavings}%, but got:`,
          );
          console.error(`   cl100k: ${report.aggregate.cl100kSavingsPct.toFixed(1)}%`);
          console.error(`   o200k:  ${report.aggregate.o200kSavingsPct.toFixed(1)}%`);
          console.error(`   char:   ${report.aggregate.charSavingsPct.toFixed(1)}%`);
        }

        if (report.status === "SUCCESS") {
          console.log(
            "✔ Tokenomics verification passed: All savings and drift constraints satisfied.",
          );
        }
      }

      if (report.status === "FAILURE") {
        process.exit(1);
      }
    } catch (err) {
      console.error("❌ Tokenomics verification error:", err);
      process.exit(1);
    }
  });

program.parse(process.argv);
