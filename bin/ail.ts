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
import {
  type AilProjectConfig,
  findProjectRoot,
  KNOWN_TARGET_EXTENSIONS,
  loadProjectConfig,
  saveProjectConfig,
  resolvePathTargets,
  resolveTargetOutputPathForConfig,
} from "../src/config/index.js";
import { parse, parseWithTrivia } from "../src/core/parser.js";
import { decompile, executeRoundtrip } from "../src/decompiler/index.js";
import {
  detectTargetFromPath,
  emitTarget,
  getTargetOutputPath,
  type TargetLanguage,
} from "../src/emitters/index.js";
import { AilLspServer } from "../src/lsp/server.js";
import { AilMcpServer } from "../src/mcp/index.js";
import { MultiLineReporter, runAilTests, translateTrace } from "../src/runner/index.js";
import {
  applyAiShield,
  applyCompanionShield,
  checkAiShieldStatus,
  interceptPreToolUse,
  lockProjectTargets,
  removeAiShield,
  safeWriteTargetFile,
  unlockProjectTargets,
} from "../src/shield/index.js";
import {
  applyProjectIdiomsToDirectory,
  expandProjectIdiomsInDirectory,
  expandModuleIdioms,
} from "../src/idioms/index.js";
import {
  runEvolutionLoopSync,
  runSelfHealingCampaignSync,
} from "../src/evolve/index.js";
import {
  auditTokenomics,
  formatProjectsMarkdownTable,
  formatProjectsTerminalTable,
  formatSingleFileSummary,
  formatTokenomicsMarkdownTable,
  formatTokenomicsTerminalTable,
} from "../src/tokenomics/index.js";
import {
  type ContextOptions,
  type DiffOptions,
  diffFiles,
  type FmtOptions,
  type FmtResult,
  formatAilPath,
  formatAilSource,
  formatParitySummaryJson,
  formatParitySummaryTerminal,
  generateContext,
  generateUnifiedDiff,
  type OutlineOptions,
  outlinePath,
  type PatchOptions,
  patchFile,
  runParityGate,
  type SpliceOptions,
  splice,
  type BenchmarkOptions,
  type BenchmarkSuiteReport,
  formatBenchmarkJson,
  formatBenchmarkMarkdown,
  formatBenchmarkTerminal,
  runTokenomicsBenchmark,
  type ComparativeOptions,
  type ComparativeReport,
  formatComparativeJson,
  formatComparativeMarkdown,
  formatComparativeTerminal,
  runComparativeBenchmark,
} from "../src/tools/index.js";
import { ejectProject, ingestProjectSideBySide } from "../src/transpiler/index.js";
import { TypeChecker } from "../src/typechecker/checker.js";
import {
  attemptSelfRepair,
  buildReportFromError,
  formatDiagnosticJson,
  formatDiagnosticText,
} from "../src/typechecker/diagnostics.js";
import { syncProjectFromTargets, watchProject } from "../src/watcher/index.js";

const program = new Command();

program
  .name("ail")
  .description("AIL: Token-Efficient Homoiconic Bidirectional Compiler CLI")
  .version("0.6.0");

/**
 * Executes polymorphic compilation across single file, directory, or omitted target.
 */
export function executeCompile(
  targetArg: string | undefined,
  options: {
    out?: string;
    outDir?: string;
    target?: string;
    fix?: boolean;
    pureInterfaces?: boolean;
    watermark?: boolean;
    check?: boolean;
  },
): void {
  try {
    const resolved = resolvePathTargets(targetArg);

    if (resolved.isSingleFile) {
      const file = resolved.resolvedPath;
      if (!fs.existsSync(file)) {
        console.error(`❌ Error: Source file not found: ${targetArg ?? file}`);
        process.exit(1);
      }

      const projectRoot = resolved.projectRoot;
      const config = resolved.config;

      let source = fs.readFileSync(file, "utf-8");

      if (options.fix) {
        const repairRes = attemptSelfRepair(source, file);
        if (repairRes.fixed && repairRes.modified) {
          fs.writeFileSync(file, repairRes.finalSource, "utf-8");
          console.log(`💡 Autonomous self-repair applied (${repairRes.iterations} iteration(s)):`);
          for (const r of repairRes.repairs) {
            console.log(`  - ${r.description}`);
          }
          source = repairRes.finalSource;
        }
      }

      const { ast: mod, trivia } = parseWithTrivia(source, file);
      const projectConfig = loadProjectConfig(findProjectRoot(path.dirname(path.resolve(file))));
      const effectiveIdioms = projectConfig.idioms ?? config.idioms;
      const expandedMod = effectiveIdioms ? expandModuleIdioms(mod, effectiveIdioms) : mod;

      // Sound type check
      try {
        const tc = new TypeChecker();
        tc.checkModule(expandedMod);
      } catch (tcErr) {
        if (options.check) {
          throw tcErr;
        }
      }

      // Target selection
      let targetLang: TargetLanguage;
      if (options.target) {
        targetLang = options.target as TargetLanguage;
      } else {
        const detected = detectTargetFromPath(file);
        const base = path.basename(file);
        const withoutAil = base.endsWith(".ail") ? base.slice(0, -4) : base;
        const innerExt = path.extname(withoutAil).toLowerCase();
        if (innerExt && KNOWN_TARGET_EXTENSIONS.has(innerExt)) {
          targetLang = detected;
        } else {
          targetLang = config.targetLanguage ?? detected;
        }
      }

      const watermark = options.watermark !== false ? config.watermark : false;

      const emitted = emitTarget(expandedMod, targetLang, {
        trivia,
        pureInterfaces: options.pureInterfaces,
        watermark,
        idioms: effectiveIdioms,
      });

      // Output path: CLI flag --out retains highest priority
      let outPath: string;
      if (options.out) {
        outPath = path.resolve(process.cwd(), options.out);
      } else if (options.outDir) {
        const effectiveConfig: AilProjectConfig = {
          ...config,
          outDir: options.outDir,
          mode: "isolated",
          isolated: true,
        };
        const resolvedOut = resolveTargetOutputPathForConfig(file, effectiveConfig, projectRoot);
        outPath = path.isAbsolute(resolvedOut)
          ? resolvedOut
          : path.resolve(projectRoot, resolvedOut);
      } else {
        const resolvedOut = resolveTargetOutputPathForConfig(file, config, projectRoot);
        outPath = path.isAbsolute(resolvedOut)
          ? resolvedOut
          : path.resolve(projectRoot, resolvedOut);
      }

      safeWriteTargetFile(outPath, emitted);

      console.log(
        `✔ Compiled ${targetArg ?? file} -> ${path.relative(process.cwd(), outPath)} [${targetLang}]`,
      );
      return;
    }

    // Directory mode (or omitted target)
    const dirPath = resolved.resolvedPath;
    if (!fs.existsSync(dirPath)) {
      console.error(`❌ Error: Directory not found: ${targetArg ?? dirPath}`);
      process.exit(1);
    }

    const files = resolved.files;
    if (files.length === 0) {
      console.log(`No .ail files found in ${targetArg ?? dirPath}`);
      return;
    }

    const projectRoot = resolved.projectRoot;
    const config = resolved.config;

    let successCount = 0;
    let failCount = 0;

    for (const f of files) {
      const relPath = path.relative(process.cwd(), f);
      try {
        let source = fs.readFileSync(f, "utf-8");

        if (options.fix) {
          const repairRes = attemptSelfRepair(source, f);
          if (repairRes.fixed && repairRes.modified) {
            fs.writeFileSync(f, repairRes.finalSource, "utf-8");
            source = repairRes.finalSource;
          }
        }

        const { ast: mod, trivia } = parseWithTrivia(source, relPath);
        const expandedMod = config.idioms ? expandModuleIdioms(mod, config.idioms) : mod;
        try {
          const tc = new TypeChecker();
          tc.checkModule(expandedMod);
        } catch (tcErr) {
          if (options.check) {
            throw tcErr;
          }
        }

        let targetLang: TargetLanguage;
        if (options.target) {
          targetLang = options.target as TargetLanguage;
        } else {
          const base = path.basename(f);
          const withoutAil = base.endsWith(".ail") ? base.slice(0, -4) : base;
          const innerExt = path.extname(withoutAil).toLowerCase();
          if (innerExt && KNOWN_TARGET_EXTENSIONS.has(innerExt)) {
            targetLang = detectTargetFromPath(relPath);
          } else {
            targetLang = config.targetLanguage ?? detectTargetFromPath(relPath);
          }
        }

        const watermark = options.watermark !== false ? config.watermark : false;

        const emitted = emitTarget(expandedMod, targetLang, {
          trivia,
          pureInterfaces: options.pureInterfaces,
          watermark,
          idioms: config.idioms,
        });

        // Output path: CLI flag --out-dir retains highest priority
        let outPath: string;
        if (options.outDir) {
          const effectiveConfig: AilProjectConfig = {
            ...config,
            outDir: options.outDir,
            mode: "isolated",
            isolated: true,
          };
          const resolvedOut = resolveTargetOutputPathForConfig(f, effectiveConfig, projectRoot);
          outPath = path.isAbsolute(resolvedOut)
            ? resolvedOut
            : path.resolve(projectRoot, resolvedOut);
        } else {
          const resolvedOut = resolveTargetOutputPathForConfig(f, config, projectRoot);
          outPath = path.isAbsolute(resolvedOut)
            ? resolvedOut
            : path.resolve(projectRoot, resolvedOut);
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
    if (targetArg && fs.existsSync(targetArg) && !fs.statSync(targetArg).isDirectory()) {
      const source = fs.readFileSync(targetArg, "utf-8");
      const report = buildReportFromError(err, source, targetArg);
      console.error(formatDiagnosticText(report));
    } else {
      console.error(err);
    }
    process.exit(1);
  }
}

// Command: compile [target]
program
  .command("compile")
  .description("Compile .ail source file(s) or directory to target language")
  .argument("[target]", "Path to .ail source file or directory (omitted for workspace scan)")
  .option("-o, --out <out>", "Output file path (single file mode)")
  .option("--out-dir <outDir>", "Optional destination directory for emitted files")
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
  .option("--check", "Perform strict type checking and abort compilation on type errors")
  .action(
    (
      target: string | undefined,
      options: {
        out?: string;
        outDir?: string;
        target?: string;
        fix?: boolean;
        pureInterfaces?: boolean;
        watermark?: boolean;
        check?: boolean;
      },
    ) => {
      executeCompile(target, options);
    },
  );

// Command: compile-all [dir] (Deprecated alias to compile [dir])
program
  .command("compile-all")
  .description(
    "Recursively compile all .ail source files in a directory (alias for 'compile [dir]')",
  )
  .argument("[dir]", "Directory to search for .ail files", ".")
  .option("--out-dir <outDir>", "Optional destination directory for emitted files")
  .option("-t, --target <target>", "Target language")
  .option("--check", "Run the static type checker before emitting")
  .option("--fix", "Automatically repair common AI syntax hallucinations")
  .option(
    "--pure-interfaces",
    "Emit pure TypeScript interfaces without artificial factory constructor functions",
  )
  .option("--no-watermark", "Disable generated watermark header in emitted target files")
  .action(
    (
      dir: string,
      options: {
        outDir?: string;
        target?: string;
        check?: boolean;
        fix?: boolean;
        pureInterfaces?: boolean;
        watermark?: boolean;
      },
    ) => {
      executeCompile(dir, options);
    },
  );

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

      const projectRoot = findProjectRoot(searchDir, process.cwd());
      const config = loadProjectConfig(projectRoot);

      function findAilFiles(current: string): string[] {
        let results: string[] = [];
        const entries = fs.readdirSync(current, { withFileTypes: true });
        for (const entry of entries) {
          const full = path.join(current, entry.name);
          if (
            entry.isDirectory() &&
            entry.name !== "node_modules" &&
            entry.name !== ".git" &&
            entry.name !== ".ail-build" &&
            entry.name !== config.outDir
          ) {
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
        const pathsToRemove = new Set<string>();

        if (config.mode !== "companion") {
          const resolvedOut = resolveTargetOutputPathForConfig(f, config, projectRoot);
          const outPath = path.isAbsolute(resolvedOut)
            ? resolvedOut
            : path.resolve(projectRoot, resolvedOut);
          pathsToRemove.add(outPath);
        }

        const legacyOut = getTargetOutputPath(f);
        if (KNOWN_TARGET_EXTENSIONS.has(path.extname(legacyOut))) {
          if (
            config.mode !== "companion" ||
            !path.isAbsolute(legacyOut) ||
            legacyOut.startsWith(projectRoot)
          ) {
            pathsToRemove.add(legacyOut);
          }
        }

        for (const p of pathsToRemove) {
          if (fs.existsSync(p)) {
            try {
              if (fs.statSync(p).isFile()) {
                fs.unlinkSync(p);
                console.log(`✔ Removed ${path.relative(process.cwd(), p)}`);
                removedCount++;
              }
            } catch {
              // ignore stat/unlink error
            }
          }
        }
      }

      console.log(`\nFinished: ${removedCount} generated files removed.`);
    } catch (err) {
      console.error(err);
      process.exit(1);
    }
  });

// Command: verify [target]
program
  .command("verify")
  .description(
    "Verify syntactic and type soundness of an .ail file, or run automated multi-file roundtrip parity gate",
  )
  .argument("[target]", "Path to the .ail source file, target file, or directory")
  .option("--json", "Output machine-readable telemetry JSON")
  .option("--fix", "Autonomously repair fixable violations before verification")
  .option(
    "--parity",
    "Run the automated multi-file roundtrip parity gate across the project or target path",
  )
  .option("--strict", "Fail with exit code 1 if any file has roundtrip drift or non-equivalence")
  .action(
    async (
      target: string | undefined,
      options: { json?: boolean; fix?: boolean; parity?: boolean; strict?: boolean },
    ) => {
      if (options.parity) {
        try {
          const summary = await runParityGate(target, {
            strict: options.strict,
            json: options.json,
          });

          if (options.json) {
            console.log(formatParitySummaryJson(summary));
          } else {
            console.log(formatParitySummaryTerminal(summary));
          }

          const isStrictFailure =
            options.strict && (summary.failed > 0 || summary.parityRate < 100);
          const isStandardFailure = summary.failed > 0;

          if (isStrictFailure || isStandardFailure) {
            process.exit(1);
          }
          return;
        } catch (err: unknown) {
          console.error(`❌ Parity gate error:`, err);
          process.exit(1);
        }
      }

      if (!target) {
        console.error(
          `❌ Error: Missing required file argument for verification. Use 'ail verify <file>' or 'ail verify --parity'.`,
        );
        process.exit(1);
      }

      const file = target;
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
        const projectConfig = loadProjectConfig(findProjectRoot(path.dirname(fullPath)));
        const expandedMod = projectConfig.idioms ? expandModuleIdioms(mod, projectConfig.idioms) : mod;
        const tc = new TypeChecker();
        tc.checkModule(expandedMod);

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
    },
  );

// Command: test [target]
program
  .command("test")
  .description("Execute tests across .ail files and test suites with auto-recompilation")
  .argument("[target]", "Optional path to a test file, directory, or omitted to run all tests")
  .option("-r, --reporter <type>", "Test reporter to use (e.g. compact, verbose, dots, json)")
  .option("--json", "Output test results as machine-readable JSON")
  .option("-v, --verbose", "Display verbose test runner output")
  .action(
    async (target?: string, options?: { reporter?: string; json?: boolean; verbose?: boolean }) => {
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

// Command: trace <trace...>
program
  .command("trace")
  .description("Translate runtime stack trace or file:line reference to companion .ail location")
  .argument("<trace...>", "Stack trace string or file:line reference to translate")
  .option("--cwd <dir>", "Project directory context (defaults to current working directory)")
  .action((traceArgs: string[], options?: { cwd?: string }) => {
    try {
      const projectDir = options?.cwd ? path.resolve(options.cwd) : process.cwd();
      const projectRoot = findProjectRoot(projectDir) ?? projectDir;
      const config = loadProjectConfig(projectRoot);

      const translated = translateTrace(traceArgs, projectRoot, config);
      for (const line of translated) {
        console.log(line);
      }
    } catch (err) {
      console.error(`❌ Failed to translate trace:`, err);
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
  .description(
    "Decompile a target language file (.ts, .tsx, .css, .html, .cpp, .cs, .py, .php, .kt, .go, .rs) into an .ail source file",
  )
  .argument("<file>", "Path to the target source file")
  .option("-o, --out <out>", "Output .ail file path")
  .option(
    "-t, --target <target>",
    "Target language (typescript, tsx, css, html, cpp, csharp, python, php, kotlin, go, rust)",
  )
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
  .option(
    "-t, --target <target>",
    "Target language (typescript, tsx, css, html, cpp, csharp, python, php, kotlin, go, rust)",
  )
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

// Command: mcp
program
  .command("mcp")
  .description("Launch the AIL Model Context Protocol (MCP) server over stdio")
  .action(() => {
    new AilMcpServer(process.stdin, process.stdout);
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
  .option("--benchmark", "Run toolchain token reduction empirical benchmark suite")
  .option("--tools <list>", "Filter specific tools to benchmark (e.g. outline,splice,dsl)")
  .action(
    async (
      targetPath: string,
      options: {
        minSavings?: number;
        checkDrift?: boolean;
        projects?: boolean;
        markdown?: boolean;
        json?: boolean;
        benchmark?: boolean;
        tools?: string;
      },
    ) => {
      try {
        const fullTarget = path.resolve(process.cwd(), targetPath);
        if (!fs.existsSync(fullTarget)) {
          console.error(`❌ Error: File or directory not found: ${targetPath}`);
          process.exit(1);
        }

        if (options.benchmark) {
          try {
            const report = await runTokenomicsBenchmark([targetPath], {
              tools: options.tools,
            });
            if (options.json) {
              console.log(formatBenchmarkJson(report));
            } else if (options.markdown || !process.stdout.isTTY) {
              console.log(formatBenchmarkMarkdown(report));
            } else {
              console.log(formatBenchmarkTerminal(report));
            }
            return;
          } catch (benchErr: unknown) {
            console.error(
              `❌ Benchmark error: ${benchErr instanceof Error ? benchErr.message : String(benchErr)}`,
            );
            process.exit(1);
          }
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

// Command: benchmark [target...]
// Aliases: bench
program
  .command("benchmark")
  .aliases(["bench"])
  .description(
    "Run empirical token reduction benchmark suite across AIL 2.0 tools (outline, splice, context, fmt, intermediate_dsl)",
  )
  .argument("[target...]", "Path(s) to files or directories to benchmark", [])
  .option("--json", "Output structured JSON report")
  .option("--markdown", "Output formatted GitHub Flavored Markdown report")
  .option("--tools <list>", "Filter specific tools to benchmark (e.g. outline,splice,dsl)")
  .option(
    "--encoding <enc>",
    "Tiktoken tokenizer encoding: cl100k_base or o200k_base",
    "cl100k_base",
  )
  .option(
    "--compare <dir>",
    "Compare baseline raw codebase directory against AIL workspace directory",
  )
  .action(
    async (
      targetArgs: string[],
      options: {
        json?: boolean;
        markdown?: boolean;
        tools?: string;
        encoding?: "cl100k_base" | "o200k_base";
        compare?: string;
      },
    ) => {
      try {
        if (options.compare) {
          const rawDir = targetArgs[0] ?? process.cwd();
          const ailDir = options.compare;
          const report = await runComparativeBenchmark(rawDir, ailDir, {
            encoding: options.encoding,
          });

          if (options.json) {
            console.log(formatComparativeJson(report));
          } else if (options.markdown || !process.stdout.isTTY) {
            console.log(formatComparativeMarkdown(report));
          } else {
            console.log(formatComparativeTerminal(report));
          }
          return;
        }

        const report = await runTokenomicsBenchmark(
          targetArgs.length > 0 ? targetArgs : undefined,
          {
            tools: options.tools,
            encoding: options.encoding,
          },
        );

        if (options.json) {
          console.log(formatBenchmarkJson(report));
        } else if (options.markdown || !process.stdout.isTTY) {
          console.log(formatBenchmarkMarkdown(report));
        } else {
          console.log(formatBenchmarkTerminal(report));
        }
      } catch (err: unknown) {
        console.error(`❌ Benchmark error: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      }
    },
  );

// Command: compare <rawDir> <ailDir>
program
  .command("compare")
  .description(
    "Run side-by-side comparative benchmark between raw codebase and isolated AIL workspace",
  )
  .argument("<rawDir>", "Path to raw codebase directory (e.g. snake_nonail)")
  .argument("<ailDir>", "Path to AIL workspace directory (e.g. snake_ail)")
  .option("--json", "Output structured JSON report")
  .option("--markdown", "Output formatted GitHub Flavored Markdown report")
  .option(
    "--encoding <enc>",
    "Tiktoken tokenizer encoding: cl100k_base or o200k_base",
    "cl100k_base",
  )
  .action(
    async (
      rawDir: string,
      ailDir: string,
      options: {
        json?: boolean;
        markdown?: boolean;
        encoding?: "cl100k_base" | "o200k_base";
      },
    ) => {
      try {
        const report = await runComparativeBenchmark(rawDir, ailDir, {
          encoding: options.encoding,
        });

        if (options.json) {
          console.log(formatComparativeJson(report));
        } else if (options.markdown || !process.stdout.isTTY) {
          console.log(formatComparativeMarkdown(report));
        } else {
          console.log(formatComparativeTerminal(report));
        }
      } catch (err: unknown) {
        console.error(
          `❌ Comparative benchmark error: ${err instanceof Error ? err.message : String(err)}`,
        );
        process.exit(1);
      }
    },
  );

// Command: adopt [dir]
program
  .command("adopt")
  .description(
    "Adopt an existing codebase into AIL side-by-side architecture or standalone companion workspace",
  )
  .argument("[dir]", "Target codebase directory or destination companion workspace", ".")
  .option("-c, --concurrency <number>", "Worker concurrency for parallel decompilation", (val) =>
    Number.parseInt(val, 10),
  )
  .option("--no-shield", "Skip generating AI shield rules (.vscode, ignores, AGENTS.md)")
  .option("--no-lock", "Skip locking target files as read-only (chmod 444)")
  .option("--overwrite", "Force re-decompilation of existing .ail files")
  .option("--dry-run", "Calculate plan and tokenomics metrics without mutating disk")
  .option(
    "--idioms",
    "Automatically mine and collapse repetitive lines/blocks into token-saving project idioms",
  )
  .option(
    "--isolate",
    "Adopt project into isolated mode (src/ contains only .ail, target files in .ail-build/)",
  )
  .option(
    "--companion <targetDir>",
    "Adopt an external project into a standalone companion AIL workspace",
  )
  .option(
    "--out-dir <dir>",
    "Build artifact directory for isolated mode (default: .ail-build) or target source directory for companion mode",
  )
  .option("--source-dir <dir>", "Source directory containing .ail code (default: src)")
  .action(
    async (
      dir: string,
      options: {
        concurrency?: number;
        shield?: boolean;
        lock?: boolean;
        overwrite?: boolean;
        dryRun?: boolean;
        isolate?: boolean;
        companion?: string;
        outDir?: string;
        sourceDir?: string;
        idioms?: boolean;
      },
    ) => {
      try {
        const isCompanion = Boolean(options.companion);
        const isIsolated = !isCompanion && Boolean(options.isolate);

        let companionDir: string;
        let targetProjectDir: string;

        if (isCompanion) {
          targetProjectDir = path.resolve(process.cwd(), options.companion!);
          if (!fs.existsSync(targetProjectDir)) {
            console.error(`❌ Error: Target project directory not found: ${options.companion}`);
            process.exit(1);
          }
          companionDir = path.resolve(process.cwd(), dir ?? ".");
          if (!options.dryRun && !fs.existsSync(companionDir)) {
            fs.mkdirSync(companionDir, { recursive: true });
          }
        } else {
          companionDir = path.resolve(process.cwd(), dir);
          targetProjectDir = companionDir;
          if (!fs.existsSync(targetProjectDir)) {
            console.error(`❌ Error: Directory not found: ${dir}`);
            process.exit(1);
          }
        }

        const cpus = os.cpus?.().length ? os.cpus().length : 4;
        const concurrency = Math.max(1, Math.floor(options.concurrency ?? cpus));

        const reporter = new MultiLineReporter({ concurrency });

        const summary = await ingestProjectSideBySide({
          dir: companionDir,
          companion: isCompanion,
          targetProjectDir: isCompanion ? targetProjectDir : undefined,
          concurrency,
          reporter,
          overwrite: Boolean(options.overwrite),
          dryRun: Boolean(options.dryRun),
          isolate: isIsolated,
          outDir: options.outDir,
          sourceDir: options.sourceDir,
          shield: options.shield !== false,
          idioms: Boolean(options.idioms),
        });

        let shieldApplied = false;
        let lockSummary = { totalLocked: 0, totalSkipped: 0, totalFailed: 0 };

        if (!options.dryRun) {
          if (isCompanion) {
            shieldApplied = options.shield !== false;
          } else {
            if (options.shield !== false) {
              await applyAiShield(targetProjectDir, { lifecycleHooks: true });
              shieldApplied = true;
            }
            if (options.lock !== false) {
              lockSummary = await lockProjectTargets(targetProjectDir);
            }
          }
        }

        if (isCompanion) {
          console.log(`\n=== AIL Companion Adoption Summary ===`);
          console.log(`Companion Workspace: ${path.relative(process.cwd(), companionDir) || "."}`);
          console.log(
            `Target Project:      ${path.relative(process.cwd(), targetProjectDir) || "."}`,
          );
          console.log(`Mode:                companion`);
          console.log(`Source Dir:          ${options.sourceDir ?? "src"}`);
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
                  : "✔ Active (AGENTS.md, .cursorrules)"
            }`,
          );
          if (summary.idiomsSynthesized) {
            console.log(
              `Project Idioms:      ${summary.idiomsSynthesized} idioms synthesized (+${summary.idiomTokenSavings ?? 0} tokens saved)`,
            );
          }
          console.log(`Target Files:        ✔ Untouched (100% clean, unlocked)`);
        } else {
          console.log(`\n=== AIL ${isIsolated ? "Isolated" : "Side-by-Side"} Adoption Summary ===`);
          console.log(
            `Directory:           ${path.relative(process.cwd(), targetProjectDir) || "."}`,
          );
          if (isIsolated) {
            console.log(`Mode:                isolated`);
            console.log(`Source Dir:          ${options.sourceDir ?? "src"}`);
            console.log(`Build Out Dir:       ${options.outDir ?? ".ail-build"}`);
          }
          console.log(
            `Files:               ${summary.totalIngested} ingested, ${summary.totalSkipped} skipped, ${summary.totalFailed} failed (${summary.totalDiscovered} total)`,
          );
          console.log(
            `Token Savings:       ${summary.cl100kSavingsPct.toFixed(1)}% cl100k (${summary.totalTargetTokens} -> ${summary.totalAilTokens} tokens)`,
          );
          if (summary.idiomsSynthesized) {
            console.log(
              `Project Idioms:      ${summary.idiomsSynthesized} idioms synthesized (+${summary.idiomTokenSavings ?? 0} tokens saved)`,
            );
          }
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
        }

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
  .option("--lock", "Lock compiled target files (chmod 444)")
  .option("--no-lock", "Do not lock compiled target files")
  .option(
    "--debounce <ms>",
    "Debounce time in ms before recompiling",
    (val) => Number.parseInt(val, 10),
    50,
  )
  .option("--bidirectional", "Watch target files and reverse-sync external edits back to .ail")
  .action(
    async (
      dir: string,
      options: {
        lock?: boolean;
        debounce?: number;
        bidirectional?: boolean;
      },
    ) => {
      try {
        const targetDir = path.resolve(process.cwd(), dir);
        if (!fs.existsSync(targetDir)) {
          console.error(`❌ Error: Directory not found: ${dir}`);
          process.exit(1);
        }

        const projectRoot = findProjectRoot(targetDir);
        const config = loadProjectConfig(projectRoot);
        const isCompanion = config.mode === "companion";

        const lockTargets = options.lock !== undefined ? options.lock : isCompanion ? false : true;
        const debounceMs = options.debounce ?? 50;
        const bidirectional = Boolean(options.bidirectional);

        if (isCompanion) {
          const compRel = path.relative(process.cwd(), projectRoot) || ".";
          const targetProjectDirAbs = config.targetProjectDir
            ? path.isAbsolute(config.targetProjectDir)
              ? config.targetProjectDir
              : path.resolve(projectRoot, config.targetProjectDir)
            : config.outDir && path.isAbsolute(config.outDir)
              ? config.outDir
              : path.resolve(projectRoot, config.outDir ?? ".");
          const targetRel =
            path.relative(process.cwd(), targetProjectDirAbs) || targetProjectDirAbs;

          console.log(`[companion] Watching ${compRel} -> Emitting to ${targetRel}`);
          console.log(
            `👀 Watching ${path.relative(process.cwd(), targetDir) || "."} for changes... (Press Ctrl+C to exit)`,
          );
          console.log(
            `   Mode: companion | Debounce: ${debounceMs}ms | Target locking: ${lockTargets ? "enabled (chmod 444)" : "disabled"} | Reverse sync: ${bidirectional ? "enabled" : "disabled"}\n`,
          );
        } else {
          console.log(
            `👀 Watching ${path.relative(process.cwd(), targetDir) || "."} for changes... (Press Ctrl+C to exit)`,
          );
          console.log(
            `   Debounce: ${debounceMs}ms | Target locking: ${lockTargets ? "enabled (chmod 444)" : "disabled"} | Reverse sync: ${bidirectional ? "enabled" : "disabled"}\n`,
          );
        }

        const watcher = await watchProject(targetDir, {
          projectRoot,
          config,
          debounceMs,
          lockTargets,
          bidirectional,
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
          onReverseSyncSuccess: (targetFile, ailFile, durationMs) => {
            const relTarget = path.relative(process.cwd(), targetFile);
            const relAil = path.relative(process.cwd(), ailFile);
            console.log(`✔ [REVERSE-SYNC] ${relTarget} -> ${relAil} (${Math.round(durationMs)}ms)`);
          },
          onReverseSyncError: (targetFile, error) => {
            const relTarget = path.relative(process.cwd(), targetFile);
            console.error(
              `❌ [REVERSE-SYNC ERROR] Failed to reverse-sync ${relTarget}: ${error.message}`,
            );
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

// Command: sync [dir]
program
  .command("sync")
  .description(
    "Synchronize external edits from target files (.ts, .py, .go, .rs, etc.) back into .ail sources",
  )
  .argument("[dir]", "Directory containing project or target files", ".")
  .option("--json", "Output machine-readable JSON telemetry")
  .action(async (dir: string, options: { json?: boolean }) => {
    try {
      const targetDir = path.resolve(process.cwd(), dir || ".");
      if (!fs.existsSync(targetDir)) {
        console.error(`❌ Error: Directory not found: ${dir}`);
        process.exit(1);
      }

      const results = await syncProjectFromTargets(targetDir);

      if (options.json) {
        console.log(JSON.stringify(results, null, 2));
      } else {
        if (results.length === 0) {
          console.log(`ℹ No target files needed synchronization.`);
        } else {
          console.log(`\n=== Bidirectional Companion Sync: ${dir || "."} ===`);
          for (const r of results) {
            const relTarget = path.relative(process.cwd(), r.targetFile);
            const relAil = path.relative(process.cwd(), r.ailFile);
            if (r.success) {
              const idiomText =
                r.collapsedIdioms > 0 ? ` (${r.collapsedIdioms} idioms collapsed)` : "";
              console.log(
                `✔ ${relTarget} -> ${relAil} [${Math.round(r.durationMs)}ms]${idiomText}`,
              );
            } else {
              console.error(`❌ ${relTarget} -> ${relAil}: ${r.error?.message}`);
            }
          }
        }
      }
    } catch (err) {
      console.error(`❌ Sync error:`, err);
      process.exit(1);
    }
  });

// Command: eject [dir]
const ejectCmd = program
  .command("eject")
  .description(
    "Eject AIL side-by-side or isolated mode: restore target files, unlock targets, and revert AI shields",
  )
  .argument("[dir]", "Target project directory", ".")
  .option("--remove-ail", "Delete all .ail source files")
  .option(
    "--from-build",
    "Restore target files from .ail-build back to sourceDir and delete .ail files",
  )
  .option("--keep-ail", "Preserve .ail source files while restoring target files")
  .option("--source-dir <dir>", "Source directory containing .ail code (default: src)")
  .option("--out-dir <dir>", "Build artifact directory for isolated mode (default: .ail-build)")
  .action(
    async (
      dir: string,
      options: {
        removeAil?: boolean;
        fromBuild?: boolean;
        keepAil?: boolean;
        sourceDir?: string;
        outDir?: string;
      },
    ) => {
      try {
        const targetDir = path.resolve(process.cwd(), dir);
        if (!fs.existsSync(targetDir)) {
          console.error(`❌ Error: Directory not found: ${dir}`);
          process.exit(1);
        }

        const ejectResult = await ejectProject({
          dir: targetDir,
          fromBuild: Boolean(options.fromBuild),
          removeAil: options.removeAil,
          keepAil: options.keepAil,
          sourceDir: options.sourceDir,
          outDir: options.outDir,
        });

        // Print confirmation
        console.log(`\n=== AIL Eject Complete ===`);
        console.log(`Directory:           ${path.relative(process.cwd(), targetDir) || "."}`);
        if (ejectResult.mode === "isolated") {
          console.log(`Mode:                isolated (--from-build)`);
          console.log(
            `Restored Targets:    ${ejectResult.restoredFiles.length} file(s) restored to source directory`,
          );
          if (ejectResult.removedBuildDir) {
            console.log(
              `Removed Build Dir:   ${path.relative(process.cwd(), ejectResult.removedBuildDir) || ejectResult.removedBuildDir}`,
            );
          }
        } else {
          console.log(
            `Unlocked Targets:    ${ejectResult.unlockedTargets ?? 0} file(s) restored to chmod 644`,
          );
        }
        console.log(
          `AI Shield:           Reverted (${ejectResult.shieldRemoved?.length ?? 0} removed, ${ejectResult.shieldReverted?.length ?? 0} restored)`,
        );
        console.log(
          `AIL Source Files:    ${
            ejectResult.removedAilFiles.length > 0
              ? `Deleted ${ejectResult.removedAilFiles.length} .ail files`
              : "Preserved on disk"
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

// Command: outline [target]
program
  .command("outline")
  .description(
    "Semantic skeletonization: generate token-dense AST skeleton outline (85-90% token reduction)",
  )
  .argument("[target]", "Path to source file or directory (omitted for workspace sourceDir)")
  .option("-d, --depth <number>", "Maximum symbol nesting depth", (val) => Number.parseInt(val, 10))
  .option("--no-types", "Exclude type annotations")
  .option("--json", "Output structured JSON symbol hierarchy")
  .option("--stats", "Display token reduction savings metrics")
  .action(
    async (
      targetPath: string | undefined,
      options: { depth?: number; types?: boolean; json?: boolean; stats?: boolean },
    ) => {
      try {
        const resolved = resolvePathTargets(targetPath, { includeTargets: true });
        const outlineTarget = resolved.resolvedPath;

        if (!fs.existsSync(outlineTarget)) {
          console.error(`❌ Error: Path not found: ${targetPath ?? outlineTarget}`);
          process.exit(1);
        }

        const outlineOpts: OutlineOptions = {
          depth: options.depth !== undefined ? Number(options.depth) : undefined,
          includeTypes: options.types !== false,
          json: !!options.json,
          stats: !!options.stats,
          projectRoot: resolved.projectRoot,
        };

        const result = await outlinePath(outlineTarget, outlineOpts);

        if (result instanceof Map) {
          // Directory output
          if (options.json) {
            const arr = Array.from(result.values()).map(
              (r) =>
                r.json ?? {
                  file: r.file,
                  symbols: r.symbols,
                  ...(r.stats ? { stats: r.stats } : {}),
                },
            );
            console.log(JSON.stringify(arr, null, 2));
          } else {
            for (const [relPath, res] of result.entries()) {
              console.log(`\n// === ${relPath} ===\n`);
              console.log(res.text);
              if (options.stats && res.stats) {
                console.log(
                  `\n[Tokens: ${res.stats.originalTokens} -> ${res.stats.outlineTokens} (-${res.stats.savingsPct}%)]`,
                );
              }
            }
            if (options.stats) {
              let totalOrig = 0;
              let totalOutline = 0;
              for (const res of result.values()) {
                if (res.stats) {
                  totalOrig += res.stats.originalTokens;
                  totalOutline += res.stats.outlineTokens;
                }
              }
              const savings = Math.max(0, totalOrig - totalOutline);
              const savingsPct = totalOrig > 0 ? ((savings / totalOrig) * 100).toFixed(1) : "0.0";
              console.log(`\n📊 Aggregate Token Reduction Metrics (${result.size} files):`);
              console.log(`  Original tokens: ${totalOrig.toLocaleString()}`);
              console.log(`  Outline tokens:  ${totalOutline.toLocaleString()}`);
              console.log(`  Token savings:   ${savings.toLocaleString()} tokens (${savingsPct}%)`);
            }
          }
        } else {
          // Single file output
          if (options.json) {
            console.log(
              JSON.stringify(
                result.json ?? {
                  file: result.file,
                  symbols: result.symbols,
                  ...(result.stats ? { stats: result.stats } : {}),
                },
                null,
                2,
              ),
            );
          } else {
            console.log(result.text);
            if (options.stats && result.stats) {
              console.log(`\n📊 Token Reduction Metrics for ${result.file}:`);
              console.log(`  Original tokens: ${result.stats.originalTokens.toLocaleString()}`);
              console.log(`  Outline tokens:  ${result.stats.outlineTokens.toLocaleString()}`);
              console.log(
                `  Token savings:   ${result.stats.savingsTokens.toLocaleString()} tokens (${result.stats.savingsPct}%)`,
              );
              console.log(`  Original chars:  ${result.stats.originalChars.toLocaleString()}`);
              console.log(
                `  Outline chars:   ${result.stats.outlineChars.toLocaleString()} (${result.stats.charSavingsPct}%)`,
              );
            }
          }
        }
      } catch (err: unknown) {
        console.error(
          `❌ Error outlining ${targetPath}: ${err instanceof Error ? err.message : String(err)}`,
        );
        process.exit(1);
      }
    },
  );

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return "";
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf-8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => {
      resolve(data);
    });
    process.stdin.on("error", () => {
      resolve("");
    });
  });
}

// Command: splice <path>
program
  .command("splice")
  .description(
    "AST surgical updates: replace, insert, or delete declarations with 90% token reduction",
  )
  .argument("<path>", "Path to source file")
  .option("-s, --symbol <symbol>", "Target symbol identifier")
  .option("-c, --code <code>", "Replacement AIL declaration snippet")
  .option("-b, --body <code>", "Replacement body snippet (for functions/methods)")
  .option("-d, --delete", "Delete the symbol")
  .option("--insert-after <symbol>", "Insert after specified symbol")
  .option("--insert-before <symbol>", "Insert before specified symbol")
  .option("--dry-run", "Output result without modifying file")
  .option("--diff", "Display unified diff")
  .option("--compile", "Automatically recompile target after splice")
  .action(
    async (
      targetPath: string,
      options: {
        symbol?: string;
        code?: string;
        body?: string;
        delete?: boolean;
        insertAfter?: string;
        insertBefore?: string;
        dryRun?: boolean;
        diff?: boolean;
        compile?: boolean;
      },
    ) => {
      try {
        let code = options.code;
        if (code === undefined && options.body === undefined && !options.delete) {
          const stdinContent = await readStdin();
          if (stdinContent && stdinContent.trim().length > 0) {
            code = stdinContent;
          } else {
            console.error("❌ Error: Must provide --code, --body, --delete, or input via stdin.");
            process.exit(1);
          }
        }

        const spliceOpts: SpliceOptions = {
          symbol: options.symbol,
          code,
          body: options.body,
          delete: options.delete,
          insertAfter: options.insertAfter,
          insertBefore: options.insertBefore,
          dryRun: options.dryRun,
          diff: options.diff,
          compile: options.compile,
        };

        const result = await splice(targetPath, spliceOpts);

        if (options.diff) {
          if (result.diff) {
            console.log(result.diff);
          } else {
            console.log("No changes detected.");
          }
        }

        if (options.dryRun) {
          console.log(`[Dry Run] Successfully spliced ${targetPath}`);
          console.log(result.modifiedCode);
        } else {
          const actionDesc = options.delete
            ? `Deleted symbol '${result.symbol}'`
            : options.insertAfter
              ? `Inserted after '${options.insertAfter}'`
              : options.insertBefore
                ? `Inserted before '${options.insertBefore}'`
                : options.body
                  ? `Spliced body of '${result.symbol}'`
                  : `Spliced symbol '${result.symbol}'`;
          console.log(`✔ ${actionDesc} in ${targetPath} (${result.tokensSaved ?? 0} tokens saved)`);
          if (options.compile) {
            console.log(`✔ Recompiled target for ${targetPath}`);
          }
        }
      } catch (err: unknown) {
        console.error(
          `❌ Error splicing ${targetPath}: ${err instanceof Error ? err.message : String(err)}`,
        );
        process.exit(1);
      }
    },
  );

// Command: context [target]
program
  .command("context")
  .description("Dependency contract packager in 1 turn for AI context windows")
  .argument(
    "[target]",
    "Path to target source file or directory (omitted for workspace overview context)",
  )
  .option(
    "-d, --depth <number>",
    "Dependency traversal depth (default: 1)",
    (val) => Number.parseInt(val, 10),
    1,
  )
  .option("--no-callers", "Skip reverse caller lookup")
  .option("--outline-target", "Outline target instead of full source")
  .option("--max-tokens <number>", "Maximum token limit", (val) => Number.parseInt(val, 10))
  .option("--json", "Output as JSON bundle")
  .option("--stats", "Output token count statistics")
  .action(
    async (
      targetPath: string | undefined,
      options: {
        depth?: number;
        callers?: boolean;
        outlineTarget?: boolean;
        maxTokens?: number;
        json?: boolean;
        stats?: boolean;
      },
    ) => {
      try {
        const resolved = resolvePathTargets(targetPath, { includeTargets: true });
        const contextOpts: ContextOptions = {
          depth: options.depth !== undefined ? Number(options.depth) : 1,
          includeCallers: options.callers !== false,
          outlineTarget: !!options.outlineTarget,
          maxTokens: options.maxTokens !== undefined ? Number(options.maxTokens) : undefined,
          json: !!options.json,
          stats: !!options.stats,
          projectRoot: resolved.projectRoot,
        };

        const result = await generateContext(resolved.resolvedPath, contextOpts);

        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          console.log(result.formattedBundle);
          if (options.stats) {
            console.log("\n📊 Context Pack Token Telemetry:");
            console.log(`  Total pack tokens: ${result.tokenCount?.toLocaleString() ?? 0}`);
            console.log(`  Dependencies:      ${result.dependencies.length}`);
            console.log(`  Downstream callers:${result.callers.length}`);
            console.log(`  Target characters: ${result.targetContent.length.toLocaleString()}`);
          }
        }
      } catch (err: unknown) {
        console.error(
          `❌ Error packaging context for ${targetPath}: ${err instanceof Error ? err.message : String(err)}`,
        );
        process.exit(1);
      }
    },
  );

// Command: fmt [target]
program
  .command("fmt")
  .description("Deterministic zero-token canonical formatting pre-pass for AIL source code")
  .argument(
    "[target]",
    "Path to .ail file or directory to format (omitted to format all workspace .ail files)",
  )
  .option(
    "--check",
    "Verify formatting without writing to disk; exit 1 if any unformatted file found",
  )
  .option("--diff", "Print unified diff of formatting changes")
  .option("--write", "Write formatted output to file (default: true)", true)
  .option("--no-write", "Do not write formatted output to file")
  .option("--stdin", "Read code from stdin and write formatted code to stdout")
  .option("--indent <number>", "Indentation space count (default: 2)", (val) =>
    Number.parseInt(val, 10),
  )
  .action(
    async (
      targetPath: string | undefined,
      options: {
        check?: boolean;
        diff?: boolean;
        write?: boolean;
        stdin?: boolean;
        indent?: number;
      },
    ) => {
      try {
        if (options.stdin) {
          const stdinSource = fs.readFileSync(0, "utf-8");
          const formatted = formatAilSource(stdinSource, {
            indent: options.indent,
          });

          if (options.diff) {
            const diff = generateUnifiedDiff("<stdin>", stdinSource, formatted);
            if (diff) {
              process.stdout.write(diff + "\n");
            }
          }

          if (options.check) {
            if (stdinSource !== formatted) {
              process.exit(1);
            }
          } else if (!options.diff) {
            process.stdout.write(formatted);
          }
          return;
        }

        const resolved = resolvePathTargets(targetPath);
        const fmtTarget = resolved.resolvedPath;

        if (!fs.existsSync(fmtTarget)) {
          console.error(`❌ Error: Path not found: ${targetPath ?? fmtTarget}`);
          process.exit(1);
        }

        const fmtOptions: FmtOptions = {
          check: !!options.check,
          diff: !!options.diff,
          write: options.write !== false && !options.check,
          indent: options.indent,
          projectRoot: resolved.projectRoot,
        };

        const resultOrResults = await formatAilPath(fmtTarget, fmtOptions);
        const results = Array.isArray(resultOrResults) ? resultOrResults : [resultOrResults];

        let hasUnformatted = false;

        for (const res of results) {
          if (!res.isFormatted) {
            hasUnformatted = true;
            if (options.diff && res.diff) {
              process.stdout.write(res.diff + "\n");
            }
            if (options.check) {
              console.error(`❌ Needs formatting: ${res.filePath}`);
            } else if (fmtOptions.write) {
              console.log(`Formatted ${res.filePath}`);
            }
          }
        }

        if (options.check && hasUnformatted) {
          process.exit(1);
        }
      } catch (err: unknown) {
        console.error(
          `❌ Error formatting ${targetPath ?? "<stdin>"}: ${err instanceof Error ? err.message : String(err)}`,
        );
        process.exit(1);
      }
    },
  );

// Command: diff [oldPath] [newPath]
program
  .command("diff")
  .description("Semantic AST structural diff and unified diff between files or git HEAD")
  .argument(
    "[oldPath]",
    "Path to target or baseline .ail source file or directory (omitted for workspace diff against git HEAD)",
  )
  .argument("[newPath]", "Path to new .ail source file (optional; defaults to git HEAD comparison)")
  .option("--ast", "Output AST symbol differences only")
  .option("--unified", "Output standard unified diff")
  .option("--json", "Output JSON summary of changes")
  .action(
    async (
      oldPath: string | undefined,
      newPath: string | undefined,
      options: {
        ast?: boolean;
        unified?: boolean;
        json?: boolean;
      },
    ) => {
      try {
        const resolved = resolvePathTargets(oldPath);

        if (resolved.isSingleFile) {
          const fileToDiff = resolved.resolvedPath;
          const diffOpts: DiffOptions = {
            oldPath: fileToDiff,
            newPath,
            ast: options.ast,
            unified: options.unified,
            json: options.json,
            projectRoot: resolved.projectRoot,
          };

          const result = await diffFiles(fileToDiff, newPath, diffOpts);

          if (options.json) {
            console.log(JSON.stringify(result.json ?? result, null, 2));
          } else if (options.ast) {
            if (result.semanticSummary) {
              console.log(result.semanticSummary);
            } else {
              console.log("No semantic symbol changes detected.");
            }
          } else if (options.unified) {
            if (result.unifiedDiff) {
              console.log(result.unifiedDiff);
            } else {
              console.log("No differences detected.");
            }
          } else {
            let hasOutput = false;
            if (result.semanticSummary) {
              console.log(result.semanticSummary);
              hasOutput = true;
            }
            if (result.unifiedDiff) {
              if (hasOutput) console.log("");
              console.log(result.unifiedDiff);
              hasOutput = true;
            }
            if (!hasOutput) {
              console.log("No differences detected.");
            }
          }
        } else {
          // Directory or omitted: diff all files in directory against git HEAD
          const files = resolved.files;
          if (files.length === 0) {
            if (options.json) {
              console.log(JSON.stringify([], null, 2));
            } else {
              console.log(`No .ail files found in ${oldPath ?? resolved.resolvedPath}`);
            }
            return;
          }

          const diffOpts: DiffOptions = {
            ast: options.ast,
            unified: options.unified,
            json: options.json,
            projectRoot: resolved.projectRoot,
          };

          if (options.json) {
            const results = [];
            for (const f of files) {
              const res = await diffFiles(f, undefined, diffOpts);
              results.push({
                file: path.relative(process.cwd(), f),
                ...(res.json ?? res),
              });
            }
            console.log(JSON.stringify(results, null, 2));
          } else {
            let anyDiff = false;
            for (const f of files) {
              const rel = path.relative(process.cwd(), f);
              const res = await diffFiles(f, undefined, diffOpts);
              const hasSemantic = res.changes && res.changes.some((c) => c.change !== "unchanged");
              const hasUnified = Boolean(res.unifiedDiff && res.unifiedDiff.trim().length > 0);

              if (hasSemantic || hasUnified) {
                anyDiff = true;
                console.log(`\n// === ${rel} ===\n`);
                if (options.ast) {
                  if (res.semanticSummary) {
                    console.log(res.semanticSummary);
                  }
                } else if (options.unified) {
                  if (res.unifiedDiff) {
                    console.log(res.unifiedDiff);
                  }
                } else {
                  let hasOutput = false;
                  if (res.semanticSummary) {
                    console.log(res.semanticSummary);
                    hasOutput = true;
                  }
                  if (res.unifiedDiff) {
                    if (hasOutput) console.log("");
                    console.log(res.unifiedDiff);
                    hasOutput = true;
                  }
                }
              }
            }
            if (!anyDiff) {
              console.log("No differences detected.");
            }
          }
        }
      } catch (err: unknown) {
        console.error(
          `❌ Error diffing files: ${err instanceof Error ? err.message : String(err)}`,
        );
        process.exit(1);
      }
    },
  );

// Command: patch <path> [patchFile]
program
  .command("patch")
  .description(
    "Apply standard unified diffs or semantic AST symbol patches with zero corruption guarantee",
  )
  .argument("<path>", "Path to target .ail source file")
  .argument("[patchFile]", "Path to patch file (reads from stdin if '-' or omitted)")
  .option("--dry-run", "Preview patch without writing to disk")
  .option("--reverse", "Reverse the patch (rollback)")
  .option("--compile", "Automatically recompile target after patch")
  .action(
    async (
      targetPath: string,
      patchFileArg: string | undefined,
      options: {
        dryRun?: boolean;
        reverse?: boolean;
        compile?: boolean;
      },
    ) => {
      try {
        let patchText = "";
        if (patchFileArg && patchFileArg !== "-") {
          const resolvedPatchPath = path.resolve(process.cwd(), patchFileArg);
          if (!fs.existsSync(resolvedPatchPath)) {
            console.error(`❌ Error: Patch file not found: ${patchFileArg}`);
            process.exit(1);
          }
          patchText = fs.readFileSync(resolvedPatchPath, "utf-8");
        } else {
          patchText = await readStdin();
          if (!patchText || patchText.trim().length === 0) {
            console.error("❌ Error: Patch file or stdin input required.");
            process.exit(1);
          }
        }

        const patchOpts: PatchOptions = {
          dryRun: options.dryRun,
          reverse: options.reverse,
          compile: options.compile,
        };

        const result = await patchFile(targetPath, patchText, patchOpts);

        if (!result.success) {
          console.error(
            `❌ Error applying patch to ${targetPath}: syntax corrupted or hunks rejected (${result.appliedHunks}/${result.totalHunks} hunks applied)`,
          );
          process.exit(1);
        }

        if (options.dryRun) {
          console.log(
            `[Dry Run] Successfully previewed patch for ${targetPath} (${result.appliedHunks}/${result.totalHunks} hunks applied)`,
          );
          if (result.diff) {
            console.log(result.diff);
          }
        } else {
          const mode = options.reverse ? "rolled back (reversed)" : "applied";
          console.log(
            `✔ Successfully ${mode} patch for ${targetPath} (${result.appliedHunks}/${result.totalHunks} hunks applied)`,
          );
          if (options.compile) {
            console.log(`✔ Recompiled target for ${targetPath}`);
          }
        }
      } catch (err: unknown) {
        console.error(
          `❌ Error patching ${targetPath}: ${err instanceof Error ? err.message : String(err)}`,
        );
        process.exit(1);
      }
    },
  );

// Command: idioms [action] [dir]
program
  .command("idioms [action] [dir]")
  .description("Mine, apply, expand, or list project-specific token-saving idioms")
  .option(
    "--min-occurrences <n>",
    "Minimum occurrences required to synthesize an idiom (default: 3)",
    (val) => Number.parseInt(val, 10),
    3,
  )
  .option(
    "--min-savings <tokens>",
    "Minimum net BPE token savings to synthesize an idiom (default: 10)",
    (val) => Number.parseInt(val, 10),
    10,
  )
  .option("--json", "Output results in JSON format")
  .option("--dry-run", "Preview idiom synthesis without modifying files")
  .action(
    async (
      actionArg: string | undefined,
      dirArg: string | undefined,
      options: {
        minOccurrences?: number;
        minSavings?: number;
        json?: boolean;
        dryRun?: boolean;
      },
    ) => {
      try {
        const validActions = new Set(["scan", "apply", "expand", "list"]);
        let action = "scan";
        let targetDir = process.cwd();

        if (actionArg && validActions.has(actionArg.toLowerCase())) {
          action = actionArg.toLowerCase();
          targetDir = path.resolve(process.cwd(), dirArg ?? ".");
        } else if (actionArg) {
          targetDir = path.resolve(process.cwd(), actionArg);
          action = "scan";
        } else {
          targetDir = path.resolve(process.cwd(), dirArg ?? ".");
        }

        const minOccurrences = options.minOccurrences ?? 3;
        const minNetTokenSavings = options.minSavings ?? 10;
        const isJson = Boolean(options.json);
        const dryRun = Boolean(options.dryRun);

        if (action === "scan") {
          const res = applyProjectIdiomsToDirectory(targetDir, {
            dryRun: true,
            minOccurrences,
            minNetTokenSavings,
          });

          if (isJson) {
            console.log(JSON.stringify(res, null, 2));
            return;
          }

          const idiomsMap = res.idioms ?? (res as any).discoveredIdioms ?? {};
          const idiomCount = res.synthesizedIdioms ?? Object.keys(idiomsMap).length;
          const tokenSavings = res.netTokenSavings ?? res.totalNetTokenSavings ?? 0;
          const filesCount = res.modifiedFiles?.length ?? (res as any).filesModified?.length ?? 0;

          console.log(
            `\n=== AIL Project Idioms Scan: ${path.relative(process.cwd(), targetDir) || "."} ===`,
          );
          console.log(`Discovered Idioms:   ${idiomCount}`);
          console.log(`Net Token Savings:   ${tokenSavings} tokens`);
          console.log(`Files Analyzed:      ${filesCount}`);
          if (Object.keys(idiomsMap).length > 0) {
            console.log("\nDiscovered Idioms:");
            for (const [name, def] of Object.entries(idiomsMap)) {
              console.log(
                `  - $${name.replace(/^\$/, "")} (${def.occurrences} occurrences, +${def.netTokenSavings} tokens)`,
              );
            }
          }
        } else if (action === "apply") {
          const res = applyProjectIdiomsToDirectory(targetDir, {
            dryRun,
            minOccurrences,
            minNetTokenSavings,
          });

          if (!dryRun) {
            const config = loadProjectConfig(targetDir);
            if (config.mode === "companion") {
              applyCompanionShield(targetDir);
            } else {
              await applyAiShield(targetDir);
            }
          }

          if (isJson) {
            console.log(JSON.stringify(res, null, 2));
            return;
          }

          const idiomsMap = res.idioms ?? (res as any).discoveredIdioms ?? {};
          const idiomCount = res.synthesizedIdioms ?? Object.keys(idiomsMap).length;
          const tokenSavings = res.netTokenSavings ?? res.totalNetTokenSavings ?? 0;
          const filesCount = res.modifiedFiles?.length ?? (res as any).filesModified?.length ?? 0;

          console.log(
            `\n=== AIL Project Idioms Apply${dryRun ? " (Dry Run)" : ""}: ${path.relative(process.cwd(), targetDir) || "."} ===`,
          );
          console.log(`Synthesized Idioms:  ${idiomCount}`);
          console.log(`Net Token Savings:   ${tokenSavings} tokens`);
          console.log(`Files Modified:      ${filesCount}`);
          if (!dryRun) {
            console.log(`✔ Updated ail.config.json and refreshed AI shield.`);
          }
        } else if (action === "expand") {
          const res = expandProjectIdiomsInDirectory(targetDir);
          const configPath = path.join(targetDir, "ail.config.json");
          if (fs.existsSync(configPath)) {
            try {
              const raw = JSON.parse(fs.readFileSync(configPath, "utf-8"));
              delete raw.idioms;
              fs.writeFileSync(configPath, `${JSON.stringify(raw, null, 2)}\n`, "utf-8");
            } catch {
              // ignore
            }
          }

          if (isJson) {
            console.log(JSON.stringify(res, null, 2));
            return;
          }

          const count = res.expandedFiles ?? (res as any)?.filesModified?.length ?? 0;
          console.log(
            `\n=== AIL Project Idioms Expand: ${path.relative(process.cwd(), targetDir) || "."} ===`,
          );
          console.log(`Files Expanded:      ${count}`);
          console.log(
            `✔ All project idioms inlined back into standard .ail code and idioms cleared from config.`,
          );
        } else if (action === "list") {
          const config = loadProjectConfig(targetDir);
          const idioms = config.idioms ?? {};

          if (isJson) {
            console.log(JSON.stringify(idioms, null, 2));
            return;
          }

          console.log(
            `\n=== Active Project Idioms: ${path.relative(process.cwd(), targetDir) || "."} ===`,
          );
          const count = Object.keys(idioms).length;
          console.log(`Total Idioms: ${count}`);
          if (count === 0) {
            console.log(
              "No idioms configured. Run `ail idioms scan` or `ail idioms apply` to discover idioms.",
            );
          } else {
            for (const [name, def] of Object.entries(idioms)) {
              console.log(`\n- $${name.replace(/^\$/, "")} (${def.kind}):`);
              if (def.description) {
                console.log(`  Description: ${def.description}`);
              }
              console.log(`  Occurrences: ${def.occurrences}`);
              console.log(`  Net Savings: ${def.netTokenSavings} tokens`);
              console.log(`  Template:    ${def.templateAil.trim()}`);
            }
          }
        } else {
          console.error(
            `❌ Unknown idioms action: '${action}'. Supported actions: scan | apply | expand | list`,
          );
          process.exit(1);
        }
      } catch (err: unknown) {
        console.error(
          `❌ Error in ail idioms: ${err instanceof Error ? err.message : String(err)}`,
        );
        process.exit(1);
      }
    },
  );

program
  .command("evolve")
  .description("Execute autonomous differential fuzzing, self-healing, and idiom evolution loop")
  .option("-r, --restarts <n>", "Number of campaign restarts (default: 1)", "1")
  .option("-c, --cycles <n>", "Number of evolution cycles to execute per restart")
  .option("--seed <n>", "Initial PRNG seed for deterministic fuzzing", "1337")
  .option("--no-corpus", "Disable sampling real-world corpus files during roundtrip verification")
  .option("--json", "Emit structured JSON evolution report")
  .action(async (cmdOptions) => {
    try {
      const parsedRestarts = cmdOptions.restarts !== undefined ? Number.parseInt(cmdOptions.restarts, 10) : NaN;
      const restarts = Number.isNaN(parsedRestarts) ? 1 : parsedRestarts;

      const parsedCycles = cmdOptions.cycles !== undefined ? Number.parseInt(cmdOptions.cycles, 10) : NaN;
      const cycles = Number.isNaN(parsedCycles) ? (restarts > 1 ? 10 : 100) : parsedCycles;

      const parsedSeed = cmdOptions.seed !== undefined ? Number.parseInt(cmdOptions.seed, 10) : NaN;
      const seed = Number.isNaN(parsedSeed) ? 1337 : parsedSeed;
      const includeCorpus = cmdOptions.corpus !== false;
      const isJson = Boolean(cmdOptions.json);

      if (restarts > 1) {
        const campaign = runSelfHealingCampaignSync({
          restarts,
          cyclesPerRestart: cycles,
          baseSeed: seed,
          includeCorpus,
        });

        if (isJson) {
          console.log(JSON.stringify(campaign, null, 2));
          if (campaign.totalFailures > 0) process.exit(1);
          return;
        }

        console.log(`\n=== AIL Autonomous Evolution & Self-Healing Campaign Report ===`);
        console.log(`Restarts:                  ${campaign.completedRestarts} / ${campaign.totalRestarts}`);
        console.log(`Total Cycles Executed:     ${campaign.totalCyclesExecuted}`);
        console.log(`Roundtrip Verifications:   ${campaign.totalRoundtripsVerified}`);
        console.log(`Idiom Transform Identities:${campaign.totalIdiomIdentitiesVerified}`);
        console.log(`Runtime Equivalence:       ${campaign.runtimeEquivalenceVerifications}`);
        console.log(
          `Self-Repair Rate:          ${(
            (campaign.totalSelfRepairsSucceeded / (campaign.totalSelfRepairsAttempted || 1)) *
            100
          ).toFixed(1)}% (${campaign.totalSelfRepairsSucceeded}/${campaign.totalSelfRepairsAttempted})`,
        );
        console.log(`Multi-Iteration Repairs:   ${campaign.multiIterationRepairs}`);
        console.log(`Average Token Savings:     ${campaign.averageTokenSavingsPct.toFixed(2)}%`);
        console.log(`Total Failures:            ${campaign.totalFailures}`);
        console.log(`Duration:                  ${campaign.durationMs}ms`);

        if (campaign.totalFailures > 0) {
          console.log(`\n❌ Campaign finished with ${campaign.totalFailures} failures.`);
          process.exit(1);
        } else {
          console.log(
            `\n✔ All ${campaign.totalRestarts} restarts (${campaign.totalCyclesExecuted} cycles) completed with 0 failures across all differential oracle gates.`,
          );
        }
        return;
      }

      const report = runEvolutionLoopSync({
        cycles,
        seed,
        includeCorpus,
      });

      if (isJson) {
        console.log(JSON.stringify(report, null, 2));
        if (report.failedCycles > 0) process.exit(1);
        return;
      }

      console.log(`\n=== AIL Autonomous Evolution & Self-Healing Report ===`);
      console.log(`Total Cycles:              ${report.totalCycles}`);
      console.log(
        `Passed Cycles:             ${report.passedCycles} (${(
          (report.passedCycles / report.totalCycles) *
          100
        ).toFixed(1)}%)`,
      );
      console.log(`Failed Cycles:             ${report.failedCycles}`);
      console.log(`Roundtrip Verifications:   ${report.roundtripVerifications}`);
      console.log(`Idiom Transform Identities:${report.idiomTransformIdentities}`);
      console.log(`TypeChecker Soundness:     ${report.typecheckerVerifications}`);
      console.log(`Runtime Equivalence:       ${report.runtimeEquivalenceVerifications}`);
      console.log(
        `Self-Repair Rate:          ${report.selfRepairRatePct.toFixed(1)}% (${
          report.selfRepairsSucceeded
        }/${report.selfRepairsAttempted})`,
      );
      console.log(`Multi-Iteration Repairs:   ${report.multiIterationRepairs}`);
      console.log(
        `Average Token Savings:     ${report.averageTokenSavingsPct.toFixed(2)}%`,
      );
      console.log(`Corpus Samples Checked:    ${report.corpusSamplesChecked}`);
      console.log(`Duration:                  ${report.durationMs}ms`);

      console.log(`\nTarget Language Breakdown:`);
      for (const [target, count] of Object.entries(report.targetBreakdown)) {
        if (count > 0) {
          console.log(`  - ${target.padEnd(12)}: ${count}`);
        }
      }

      if (report.failures.length > 0) {
        console.log(`\n❌ Failures Encountered (${report.failures.length}):`);
        for (const f of report.failures) {
          console.log(
            `  - Cycle ${f.cycle} (seed ${f.seed}, gate: ${f.gate}): ${f.message}`,
          );
          if (f.shrunkSource) {
            console.log(
              `    Minimal Shrunk Reproducer:\n${f.shrunkSource
                .split("\n")
                .map((l) => "      " + l)
                .join("\n")}`,
            );
          }
        }
        process.exit(1);
      } else {
        console.log(
          `\n✔ 100% of evolution cycles verified cleanly across all 5 differential oracle gates.`,
        );
      }
    } catch (err: unknown) {
      console.error(
        `❌ Evolution loop failed: ${err instanceof Error ? err.message : String(err)}`,
      );
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
