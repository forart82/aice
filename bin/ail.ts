#!/usr/bin/env node
/**
 * AIL CLI Compiler & Verification Tool.
 * Provides `ail compile`, `ail compile-all`, and `ail verify [--json]`.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { parse, parseWithTrivia } from "../src/core/parser.js";
import { decompile, executeRoundtrip } from "../src/decompiler/index.js";
import {
  detectTargetFromPath,
  emitTarget,
  getTargetOutputPath,
  type TargetLanguage,
} from "../src/emitters/index.js";
import { AilLspServer } from "../src/lsp/server.js";
import { MultiLineReporter, runAilTests } from "../src/runner/index.js";
import {
  applyAiShield,
  checkAiShieldStatus,
  interceptPreToolUse,
  lockProjectTargets,
  removeAiShield,
  safeWriteTargetFile,
  unlockProjectTargets,
} from "../src/shield/index.js";
import {
  auditTokenomics,
  formatProjectsMarkdownTable,
  formatProjectsTerminalTable,
  formatSingleFileSummary,
  formatTokenomicsMarkdownTable,
  formatTokenomicsTerminalTable,
} from "../src/tokenomics/index.js";
import { ingestProjectSideBySide } from "../src/transpiler/index.js";
import { TypeChecker } from "../src/typechecker/checker.js";
import {
  attemptSelfRepair,
  buildReportFromError,
  formatDiagnosticJson,
  formatDiagnosticText,
} from "../src/typechecker/diagnostics.js";
import { watchProject } from "../src/watcher/index.js";

const program = new Command();

program
  .name("ail")
  .description("AIL: Token-Efficient Homoiconic Bidirectional Compiler CLI")
  .version("0.4.9");

// Command: compile <file>
program
  .command("compile")
  .description("Compile an .ail source file to its target language")
  .argument("<file>", "Path to the .ail source file")
  .option("-o, --out <out>", "Output file path")
  .option(
    "-t, --target <target>",
    "Explicit target language (typescript, tsx, python, html, css, rust, go, cpp, csharp)",
  )
  .option("--fix", "Autonomously repair fixable errors before compiling")
  .option(
    "--pure-interfaces",
    "Emit pure TypeScript interfaces without artificial factory constructor functions",
  )
  .option("--no-watermark", "Disable generated watermark header in emitted target files")
  .action(
    (
      file: string,
      options: {
        out?: string;
        target?: string;
        fix?: boolean;
        pureInterfaces?: boolean;
        watermark?: boolean;
      },
    ) => {
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
            console.log(
              `💡 Autonomous self-repair applied (${repairRes.iterations} iteration(s)):`,
            );
            for (const r of repairRes.repairs) {
              console.log(`  - ${r.description}`);
            }
            source = repairRes.finalSource;
          }
        }

        const { ast: mod, trivia } = parseWithTrivia(source, file);

        // Sound type check
        const tc = new TypeChecker();
        tc.checkModule(mod);

        // Target selection
        const targetLang = (options.target as TargetLanguage) ?? detectTargetFromPath(file);
        const emitted = emitTarget(mod, targetLang, {
          trivia,
          pureInterfaces: options.pureInterfaces,
          watermark: options.watermark,
        });

        // Output path
        const outPath = options.out
          ? path.resolve(process.cwd(), options.out)
          : path.resolve(process.cwd(), getTargetOutputPath(file));

        safeWriteTargetFile(outPath, emitted);

        console.log(
          `✔ Compiled ${file} -> ${path.relative(process.cwd(), outPath)} [${targetLang}]`,
        );
      } catch (err) {
        const source = fs.existsSync(file) ? fs.readFileSync(file, "utf-8") : "";
        const report = buildReportFromError(err, source, file);
        console.error(formatDiagnosticText(report));
        process.exit(1);
      }
    },
  );

// Command: compile-all <dir>
program
  .command("compile-all")
  .description("Recursively compile all .ail source files in a directory")
  .argument("[dir]", "Directory to search for .ail files", ".")
  .option("--out-dir <outDir>", "Optional destination directory for emitted files")
  .option(
    "--pure-interfaces",
    "Emit pure TypeScript interfaces without artificial factory constructor functions",
  )
  .option("--no-watermark", "Disable generated watermark header in emitted target files")
  .action(
    (dir: string, options: { outDir?: string; pureInterfaces?: boolean; watermark?: boolean }) => {
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
            const { ast: mod, trivia } = parseWithTrivia(source, relPath);
            const tc = new TypeChecker();
            tc.checkModule(mod);

            const targetLang = detectTargetFromPath(relPath);
            const emitted = emitTarget(mod, targetLang, {
              trivia,
              pureInterfaces: options.pureInterfaces,
              watermark: options.watermark,
            });

          let outPath = getTargetOutputPath(f);
          if (options.outDir) {
            const relFromSearch = path.relative(searchDir, outPath);
            outPath = path.resolve(process.cwd(), options.outDir, relFromSearch);
          }

          safeWriteTargetFile(outPath, emitted);
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
            console.log(
              `💡 Autonomous self-repair applied (${repairRes.iterations} iteration(s)):`,
            );
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

// Command: test [target]
program
  .command("test")
  .description("Execute tests across .ail files and test suites with auto-recompilation")
  .argument("[target]", "Optional path to a test file, directory, or omitted to run all tests")
  .option("-r, --reporter <type>", "Test reporter to use (e.g. compact, verbose, dots, json)")
  .option("--json", "Output test results as machine-readable JSON")
  .option("-v, --verbose", "Display verbose test runner output")
  .action(
    async (
      target?: string,
      options?: { reporter?: string; json?: boolean; verbose?: boolean },
    ) => {
      try {
        const result = await runAilTests(target, {
          reporter: options?.reporter,
          json: options?.json,
          verbose: options?.verbose,
          cwd: process.cwd(),
        });

        if (options?.json) {
          console.log(JSON.stringify(result, null, 2));
          process.exit(result.success ? 0 : 1);
        }

        if (result.success) {
          if (options?.verbose && result.output) {
            console.log(result.output);
          }
          console.log(
            `✔ Tests succeeded: ${result.summary.passed}/${result.summary.total} passed (${result.summary.failed} failed).`,
          );
          if (result.compiledFiles && result.compiledFiles.length > 0) {
            console.log(
              `  (Recompiled ${result.compiledFiles.length} .ail target(s) before test execution)`,
            );
          }
          process.exit(0);
        } else {
          if (result.output) {
            console.error(result.output);
          }
          console.error(
            `❌ Tests failed: ${result.summary.failed}/${result.summary.total} failed (${result.summary.passed} passed).`,
          );
          process.exit(1);
        }
      } catch (err) {
        console.error(`❌ Failed to execute tests:`, err);
        process.exit(1);
      }
    },
  );

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
  .description(
    "Decompile a target language file (.ts, .tsx, .css, .html, .cpp, .cs) into an .ail source file",
  )
  .argument("<file>", "Path to the target source file")
  .option("-o, --out <out>", "Output .ail file path")
  .option("-t, --target <target>", "Target language (typescript, tsx, css, html, cpp, csharp)")
  .action((file: string, options: { out?: string; target?: string }) => {
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
  .option("-t, --target <target>", "Target language (typescript, tsx, css, html, cpp, csharp)")
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

// Command: tokens [path]
// Aliases: tokenomics, efficiency, verify-tokenomics
program
  .command("tokens")
  .aliases(["tokenomics", "efficiency", "verify-tokenomics"])
  .description("Audit token and character savings for a specific file or folder (with subfolders)")
  .argument("[path]", "Path to file or directory to audit", ".")
  .option(
    "--min-savings <pct>",
    "Minimum required savings percentage across tokenizers",
    Number.parseFloat,
  )
  .option("--check-drift", "Enforce zero target drift against existing compiled files")
  .option("--projects", "Aggregate output by project (1 line per project)")
  .option("--markdown", "Force standard markdown table output even in interactive terminal")
  .option("--json", "Output machine-readable JSON telemetry for CI pipelines")
  .action(
    (
      targetPath: string,
      options: {
        minSavings?: number;
        checkDrift?: boolean;
        projects?: boolean;
        markdown?: boolean;
        json?: boolean;
      },
    ) => {
      try {
        const fullTarget = path.resolve(process.cwd(), targetPath);
        if (!fs.existsSync(fullTarget)) {
          console.error(`❌ Error: File or directory not found: ${targetPath}`);
          process.exit(1);
        }
        const isFile = fs.statSync(fullTarget).isFile();
        const isTTY = Boolean(process.stdout.isTTY && !process.env.NO_COLOR);
        const terminalWidth = process.stdout.columns || 80;

        const report = auditTokenomics(targetPath, {
          minSavings: options.minSavings,
          checkDrift: options.checkDrift,
        });

        if (options.json) {
          console.log(JSON.stringify(report, null, 2));
        } else {
          if (isFile && report.files.length === 1 && !options.projects) {
            console.log(
              "\n" +
                formatSingleFileSummary(report.files[0], {
                  width: terminalWidth,
                  useColor: isTTY,
                }) +
                "\n",
            );
          } else {
            if (options.markdown || !process.stdout.isTTY) {
              console.log(
                `\n=== AIL 2.0 Tokenomics & Zero-Drift Benchmark Audit: ${targetPath} ===\n`,
              );
              if (options.projects) {
                console.log(formatProjectsMarkdownTable(report));
              } else {
                console.log(formatTokenomicsMarkdownTable(report));
              }
              console.log();
            } else {
              console.log();
              if (options.projects) {
                console.log(
                  formatProjectsTerminalTable(report, {
                    width: terminalWidth,
                    useColor: isTTY,
                    title: targetPath,
                  }),
                );
              } else {
                console.log(
                  formatTokenomicsTerminalTable(report, {
                    width: terminalWidth,
                    useColor: isTTY,
                    title: targetPath,
                  }),
                );
              }
              console.log();
            }
          }

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
    },
  );

// Helper to recursively delete .ail and .trivia.json files
function removeAilAndTriviaFiles(curDir: string): number {
  let count = 0;
  if (!fs.existsSync(curDir)) return 0;
  const entries = fs.readdirSync(curDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === ".git") continue;
    const fullPath = path.join(curDir, entry.name);
    if (entry.isDirectory()) {
      count += removeAilAndTriviaFiles(fullPath);
    } else if (entry.isFile()) {
      const lower = entry.name.toLowerCase();
      if (lower.endsWith(".ail") || lower.endsWith(".trivia.json")) {
        try {
          fs.unlinkSync(fullPath);
          count++;
        } catch {
          try {
            fs.chmodSync(fullPath, 0o644);
            fs.unlinkSync(fullPath);
            count++;
          } catch {
            // ignore unlink errors
          }
        }
      }
    }
  }
  return count;
}

// Command: adopt [dir]
program
  .command("adopt")
  .description("Adopt an existing codebase into AIL side-by-side architecture")
  .argument("[dir]", "Target codebase directory", ".")
  .option("-c, --concurrency <number>", "Worker concurrency for parallel decompilation", (val) =>
    Number.parseInt(val, 10),
  )
  .option("--no-shield", "Skip generating AI shield rules (.vscode, ignores, AGENTS.md)")
  .option("--no-lock", "Skip locking target files as read-only (chmod 444)")
  .option("--overwrite", "Force re-decompilation of existing .ail files")
  .option("--dry-run", "Calculate plan and tokenomics metrics without mutating disk")
  .action(
    async (
      dir: string,
      options: {
        concurrency?: number;
        shield?: boolean;
        lock?: boolean;
        overwrite?: boolean;
        dryRun?: boolean;
      },
    ) => {
      try {
        const targetDir = path.resolve(process.cwd(), dir);
        if (!fs.existsSync(targetDir)) {
          console.error(`❌ Error: Directory not found: ${dir}`);
          process.exit(1);
        }

        const cpus = os.cpus?.().length ? os.cpus().length : 4;
        const concurrency = Math.max(1, Math.floor(options.concurrency ?? cpus));

        const reporter = new MultiLineReporter({ concurrency });

        const summary = await ingestProjectSideBySide({
          dir: targetDir,
          concurrency,
          reporter,
          overwrite: Boolean(options.overwrite),
          dryRun: Boolean(options.dryRun),
        });

        let shieldApplied = false;
        let lockSummary = { totalLocked: 0, totalSkipped: 0, totalFailed: 0 };

        if (!options.dryRun) {
          if (options.shield !== false) {
            await applyAiShield(targetDir, { lifecycleHooks: true });
            shieldApplied = true;
          }
          if (options.lock !== false) {
            lockSummary = await lockProjectTargets(targetDir);
          }
        }

        console.log(`\n=== AIL Side-by-Side Adoption Summary ===`);
        console.log(`Directory:           ${path.relative(process.cwd(), targetDir) || "."}`);
        console.log(
          `Files:               ${summary.totalIngested} ingested, ${summary.totalSkipped} skipped, ${summary.totalFailed} failed (${summary.totalDiscovered} total)`,
        );
        console.log(
          `Token Savings:       ${summary.cl100kSavingsPct.toFixed(1)}% cl100k (${summary.totalTargetTokens} -> ${summary.totalAilTokens} tokens)`,
        );
        console.log(
          `AI Shield:           ${
            options.dryRun
              ? "💡 Simulated (--dry-run)"
              : options.shield === false
                ? "⊘ Skipped (--no-shield)"
                : shieldApplied
                  ? "✔ Active (.vscode/settings.json, agent ignores, AGENTS.md, GEMINI.md, .agents/hooks.json)"
                  : "✖ Inactive"
          }`,
        );
        console.log(
          `Permission Locks:    ${
            options.dryRun
              ? "💡 Simulated (--dry-run)"
              : options.lock === false
                ? "⊘ Skipped (--no-lock)"
                : `✔ ${lockSummary.totalLocked} target file(s) locked (chmod 444)`
          }`,
        );

        if (options.dryRun) {
          console.log(`\n💡 [DRY-RUN] No changes were written to disk.`);
        }

        if (summary.totalFailed > 0) {
          console.error(`\n❌ Failed to decompile ${summary.totalFailed} file(s).`);
          process.exit(1);
        }
      } catch (err) {
        console.error(`❌ Adoption error:`, err);
        process.exit(1);
      }
    },
  );

// Command: watch [dir] (alias: dev)
program
  .command("watch")
  .alias("dev")
  .description("Watch .ail files and incrementally recompile side-by-side on change")
  .argument("[dir]", "Directory to watch for .ail files", ".")
  .option("--no-lock", "Do not lock compiled target files")
  .option(
    "--debounce <ms>",
    "Debounce time in ms before recompiling",
    (val) => Number.parseInt(val, 10),
    50,
  )
  .action(
    async (
      dir: string,
      options: {
        lock?: boolean;
        debounce?: number;
      },
    ) => {
      try {
        const targetDir = path.resolve(process.cwd(), dir);
        if (!fs.existsSync(targetDir)) {
          console.error(`❌ Error: Directory not found: ${dir}`);
          process.exit(1);
        }

        const lockTargets = options.lock !== false;
        const debounceMs = options.debounce ?? 50;

        console.log(
          `👀 Watching ${path.relative(process.cwd(), targetDir) || "."} for changes... (Press Ctrl+C to exit)`,
        );
        console.log(
          `   Debounce: ${debounceMs}ms | Target locking: ${lockTargets ? "enabled (chmod 444)" : "disabled"}\n`,
        );

        const watcher = await watchProject(targetDir, {
          debounceMs,
          lockTargets,
          onCompileSuccess: (ailFile, targetFile, durationMs) => {
            const relAil = path.relative(process.cwd(), ailFile);
            const relTarget = path.relative(process.cwd(), targetFile);
            console.log(`✔ [COMPILE] ${relAil} -> ${relTarget} (${Math.round(durationMs)}ms)`);
          },
          onCompileError: (ailFile, error) => {
            const relAil = path.relative(process.cwd(), ailFile);
            console.error(`❌ [ERROR] Failed to compile ${relAil}: ${error.message}`);
          },
          onFileDeleted: (ailFile, targetFile) => {
            const relAil = path.relative(process.cwd(), ailFile);
            const relTarget = path.relative(process.cwd(), targetFile);
            console.log(`ℹ [DELETE] Removed ${relAil} (target: ${relTarget})`);
          },
        });

        const cleanup = async () => {
          process.stdout.write("\x1B[?25h\n");
          console.log("Stopping AIL watch daemon...");
          await watcher.stop();
          process.exit(0);
        };

        process.on("SIGINT", cleanup);
        process.on("SIGTERM", cleanup);
      } catch (err) {
        process.stdout.write("\x1B[?25h\n");
        console.error(`❌ Watcher error:`, err);
        process.exit(1);
      }
    },
  );

// Command: eject [dir]
program
  .command("eject")
  .description("Eject AIL side-by-side mode: unlock target files and revert AI shields")
  .argument("[dir]", "Target project directory", ".")
  .option("--remove-ail", "Delete all .ail source files")
  .action(
    async (
      dir: string,
      options: {
        removeAil?: boolean;
      },
    ) => {
      try {
        const targetDir = path.resolve(process.cwd(), dir);
        if (!fs.existsSync(targetDir)) {
          console.error(`❌ Error: Directory not found: ${dir}`);
          process.exit(1);
        }

        // 1. Unlock targets
        const lockRes = await unlockProjectTargets(targetDir);

        // 2. Remove AI shields
        const shieldRes = await removeAiShield(targetDir);

        // 3. Optionally remove .ail files
        let removedAilCount = 0;
        if (options.removeAil) {
          removedAilCount = removeAilAndTriviaFiles(targetDir);
        }

        // 4. Print confirmation
        console.log(`\n=== AIL Eject Complete ===`);
        console.log(`Directory:           ${path.relative(process.cwd(), targetDir) || "."}`);
        console.log(`Unlocked Targets:    ${lockRes.totalUnlocked} file(s) restored to chmod 644`);
        console.log(
          `AI Shield:           Reverted (${shieldRes.removedFiles.length} removed, ${shieldRes.revertedFiles.length} restored)`,
        );
        console.log(
          `AIL Source Files:    ${
            options.removeAil ? `Deleted ${removedAilCount} .ail files` : "Preserved on disk"
          }`,
        );
        console.log(`Project successfully restored to standard toolchain state.`);
      } catch (err) {
        console.error(`❌ Eject error:`, err);
        process.exit(1);
      }
    },
  );

// Helper to read stdin synchronously in CLI hooks without blocking interactive TTY
function readStdinSync(): string {
  try {
    if (process.stdin.isTTY) {
      return "";
    }
    return fs.readFileSync(0, "utf-8");
  } catch {
    return "";
  }
}

// Command: shield
const shieldCmd = program
  .command("shield")
  .description("Manage AI exclusion rules, cognitive shields, and filesystem locks");

shieldCmd
  .command("intercept")
  .description("Intercept PreToolUse lifecycle hooks for AI agents")
  .argument("[dir]", "Target project directory", ".")
  .action((dir: string) => {
    try {
      const rawInput = readStdinSync();
      const targetDir = path.resolve(process.cwd(), dir || ".");
      const result = interceptPreToolUse(rawInput, targetDir);
      console.log(JSON.stringify(result));
    } catch {
      console.log(JSON.stringify({ decision: "allow" }));
    }
  });

shieldCmd
  .argument("<action>", "Action to perform: apply | remove | status | lock | unlock | intercept")
  .argument("[dir]", "Target project directory", ".")
  .action(async (action: string, dir: string) => {
    try {
      const targetDir = path.resolve(process.cwd(), dir);
      if (!fs.existsSync(targetDir)) {
        console.error(`❌ Error: Directory not found: ${dir}`);
        process.exit(1);
      }

      switch (action.toLowerCase()) {
        case "intercept": {
          const rawInput = readStdinSync();
          const result = interceptPreToolUse(rawInput, targetDir);
          console.log(JSON.stringify(result));
          break;
        }
        case "apply": {
          const res = await applyAiShield(targetDir, { lifecycleHooks: true });
          console.log(`✔ AI Shield applied to ${path.relative(process.cwd(), targetDir) || "."}:`);
          console.log(`  - Created files:  ${res.createdFiles.length}`);
          for (const f of res.createdFiles) {
            console.log(`    + ${path.relative(process.cwd(), f)}`);
          }
          console.log(`  - Modified files: ${res.modifiedFiles.length}`);
          for (const f of res.modifiedFiles) {
            console.log(`    ~ ${path.relative(process.cwd(), f)}`);
          }
          console.log(`  - Active shields: ${res.activeShields.join(", ") || "none"}`);
          break;
        }
        case "remove": {
          const res = await removeAiShield(targetDir);
          console.log(
            `✔ AI Shield removed from ${path.relative(process.cwd(), targetDir) || "."}:`,
          );
          console.log(`  - Removed files:  ${res.removedFiles.length}`);
          for (const f of res.removedFiles) {
            console.log(`    - ${path.relative(process.cwd(), f)}`);
          }
          console.log(`  - Reverted files: ${res.revertedFiles.length}`);
          for (const f of res.revertedFiles) {
            console.log(`    ~ ${path.relative(process.cwd(), f)}`);
          }
          break;
        }
        case "status": {
          const status = await checkAiShieldStatus(targetDir);
          console.log(
            `=== AI Shield Status: ${path.relative(process.cwd(), targetDir) || "."} ===`,
          );
          console.log(`Active:            ${status.isActive ? "✔ YES" : "✖ NO"}`);
          console.log(
            `IDE Settings:      ${status.ideSettingsConfigured ? "✔ Configured (.vscode/settings.json)" : "✖ Not configured"}`,
          );
          console.log(
            `Agent Ignores:     ${status.agentIgnoresConfigured ? "✔ Configured (.cursorignore, etc.)" : "✖ Not configured"}`,
          );
          console.log(
            `Cognitive Rules:   ${status.cognitiveRulesConfigured ? "✔ Configured (AGENTS.md, .cursorrules)" : "✖ Not configured"}`,
          );
          for (const [file, active] of Object.entries(status.details)) {
            if (typeof active === "boolean") {
              console.log(`  - ${file}: ${active ? "✔ active" : "✖ inactive"}`);
            }
          }
          break;
        }
        case "lock": {
          const res = await lockProjectTargets(targetDir);
          console.log(
            `✔ Locked ${res.totalLocked} target file(s) in ${path.relative(process.cwd(), targetDir) || "."} (chmod 444).`,
          );
          if (res.totalSkipped > 0) {
            console.log(`  (${res.totalSkipped} file(s) were already locked)`);
          }
          if (res.totalFailed > 0) {
            console.error(`❌ Failed to lock ${res.totalFailed} file(s).`);
            process.exit(1);
          }
          break;
        }
        case "unlock": {
          const res = await unlockProjectTargets(targetDir);
          console.log(
            `✔ Unlocked ${res.totalUnlocked} target file(s) in ${path.relative(process.cwd(), targetDir) || "."} (chmod 644).`,
          );
          if (res.totalSkipped > 0) {
            console.log(`  (${res.totalSkipped} file(s) were already writable)`);
          }
          if (res.totalFailed > 0) {
            console.error(`❌ Failed to unlock ${res.totalFailed} file(s).`);
            process.exit(1);
          }
          break;
        }
        default: {
          console.error(
            `❌ Unknown shield action: '${action}'. Valid actions: apply, remove, status, lock, unlock, intercept`,
          );
          process.exit(1);
        }
      }
    } catch (err) {
      console.error(`❌ Shield error:`, err);
      process.exit(1);
    }
  });

export { program };

const isDirectCliRun = () => {
  if (!process.argv[1]) return false;
  try {
    const thisFile = fileURLToPath(import.meta.url);
    const invokedFile = fs.realpathSync(process.argv[1]);
    if (thisFile === invokedFile) return true;
  } catch {
    // fallback
  }
  return Boolean(
    (process.argv[1].endsWith("/bin/ail.ts") ||
      process.argv[1].endsWith("/bin/ail.mjs") ||
      process.argv[1].endsWith("/bin/ail.js") ||
      process.argv[1].endsWith("/bin/ail") ||
      process.argv[1].endsWith("/ail") ||
      process.argv[1] === "ail") &&
      !process.argv[1].includes("test") &&
      !process.argv[1].includes("vitest"),
  );
};

if (isDirectCliRun()) {
  program.parse(process.argv);
}
