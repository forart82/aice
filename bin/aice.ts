#!/usr/bin/env node
/**
 * AICE CLI: On-the-Fly AI Context Engine & Multi-File Idiom Tool.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as readline from "node:readline";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import {
  formatAgentsStatusTable,
  getAgentsStatus,
  removeAgents,
  setupAgents,
} from "../src/agents/index.js";
import {
  AICE_DISABLED_MESSAGE,
  type AiceProjectConfig,
  findProjectRoot,
  isProjectAiceEnabled,
  isProjectIdiomsEnabled,
  KNOWN_TARGET_EXTENSIONS,
  loadProjectConfig,
  resolvePathTargets,
  resolveTargetOutputPathForConfig,
  setProjectAiceEnabled,
  setProjectIdiomsEnabled,
} from "../src/config/index.js";
import { parse, parseWithTrivia } from "../src/core/parser.js";
import { decompile, executeRoundtrip } from "../src/decompiler/index.js";
import { detectTargetFromPath, emitTarget, type TargetLanguage } from "../src/emitters/index.js";
import {
  applyProjectIdiomsToDirectory,
  expandModuleIdioms,
  expandProjectIdiomsInDirectory,
  readProjectIdiom,
  scanProjectIdioms,
  updateProjectIdiom,
} from "../src/idioms/index.js";
import { AICE_VERSION, AiceMcpServer } from "../src/mcp/index.js";
import {
  analyzeProject,
  buildGainReport,
  formatAnalyzeReport,
  formatGlobalGainDashboard,
  formatProjectGainDetail,
  recordTelemetryError,
  resetTelemetryHistory,
} from "../src/telemetry/index.js";
import {
  auditTokenomics,
  formatProjectsMarkdownTable,
  formatProjectsTerminalTable,
  formatSingleFileSummary,
  formatTokenomicsMarkdownTable,
  formatTokenomicsTerminalTable,
} from "../src/tokenomics/index.js";
import {
  type BatchCreateItem,
  type BatchSpliceItem,
  type ContextOptions,
  createBatch,
  createFile,
  type DiffOptions,
  diffFiles,
  type FmtOptions,
  formatAicePath,
  formatAiceSource,
  formatParitySummaryJson,
  formatParitySummaryTerminal,
  generateContext,
  generateUnifiedDiff,
  type OutlineOptions,
  outlinePath,
  type PatchOptions,
  parseMultiBlockSpliceStream,
  parseMultiFileCreateStream,
  patchFile,
  runParityGate,
  type SpliceOptions,
  splice,
  spliceBatch,
} from "../src/tools/index.js";
import { TypeChecker } from "../src/typechecker/checker.js";
import {
  attemptSelfRepair,
  buildReportFromError,
  formatDiagnosticJson,
  formatDiagnosticText,
} from "../src/typechecker/diagnostics.js";

const program = new Command();

program
  .name("aice")
  .description(
    "AICE: On-the-Fly AI Context Engine & Multi-File Idiom CLI (by @forart82 — https://github.com/forart82/aice)",
  )
  .version(AICE_VERSION);

function writeTargetFile(outPath: string, content: string): void {
  const dir = path.dirname(outPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(outPath, content, "utf-8");
}

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
    idioms?: boolean;
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
      const projectConfig = loadProjectConfig(findProjectRoot(path.dirname(path.resolve(file))));
      if (!isProjectAiceEnabled(projectConfig) || !isProjectAiceEnabled(config)) {
        console.error(`❌ ${AICE_DISABLED_MESSAGE}`);
        process.exit(1);
      }

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
      const idiomsActive = isProjectIdiomsEnabled(projectConfig, options.idioms);
      const effectiveIdioms = idiomsActive ? (projectConfig.idioms ?? config.idioms) : undefined;
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
        const withoutAice = base.endsWith(".aice") ? base.slice(0, -5) : base;
        const innerExt = path.extname(withoutAice).toLowerCase();
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
        const effectiveConfig: AiceProjectConfig = {
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

      writeTargetFile(outPath, emitted);

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
      console.log(`No .aice files found in ${targetArg ?? dirPath}`);
      return;
    }

    const projectRoot = resolved.projectRoot;
    const config = resolved.config;
    if (!isProjectAiceEnabled(config)) {
      console.error(`❌ ${AICE_DISABLED_MESSAGE}`);
      process.exit(1);
    }
    const dirIdiomsActive = isProjectIdiomsEnabled(config, options.idioms);
    const dirEffectiveIdioms = dirIdiomsActive ? config.idioms : undefined;

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
        const expandedMod = dirEffectiveIdioms ? expandModuleIdioms(mod, dirEffectiveIdioms) : mod;
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
          const withoutAice = base.endsWith(".aice") ? base.slice(0, -5) : base;
          const innerExt = path.extname(withoutAice).toLowerCase();
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
          idioms: dirEffectiveIdioms,
        });

        // Output path: CLI flag --out-dir retains highest priority
        let outPath: string;
        if (options.outDir) {
          const effectiveConfig: AiceProjectConfig = {
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

        writeTargetFile(outPath, emitted);
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
  .description("Compile .aice source file(s) or directory to target language")
  .argument("[target]", "Path to .aice source file or directory (omitted for workspace scan)")
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
  .option("--idioms", "Force-enable project idioms")
  .option("--no-idioms", "Temporarily disable project idioms")
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
        idioms?: boolean;
      },
    ) => {
      executeCompile(target, options);
    },
  );

// Command: compile-all [dir] (Deprecated alias to compile [dir])
program
  .command("compile-all")
  .description(
    "Recursively compile all .aice source files in a directory (alias for 'compile [dir]')",
  )
  .argument("[dir]", "Directory to search for .aice files", ".")
  .option("--out-dir <outDir>", "Optional destination directory for emitted files")
  .option("-t, --target <target>", "Target language")
  .option("--check", "Run the static type checker before emitting")
  .option("--fix", "Automatically repair common AI syntax hallucinations")
  .option(
    "--pure-interfaces",
    "Emit pure TypeScript interfaces without artificial factory constructor functions",
  )
  .option("--no-watermark", "Disable generated watermark header in emitted target files")
  .option("--idioms", "Force-enable project idioms")
  .option("--no-idioms", "Temporarily disable project idioms")
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
        idioms?: boolean;
      },
    ) => {
      executeCompile(dir, options);
    },
  );

// Command: verify [target]
program
  .command("verify")
  .aliases(["check"])
  .description(
    "Verify syntactic and type soundness of an .aice file, or run automated multi-file roundtrip parity gate",
  )
  .argument("[target]", "Path to the .aice source file, target file, or directory")
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
      const isDirTarget =
        !target ||
        (fs.existsSync(path.resolve(process.cwd(), target)) &&
          fs.statSync(path.resolve(process.cwd(), target)).isDirectory());
      if (options.parity || isDirTarget) {
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
          `❌ Error: Missing required file argument for verification. Use 'aice verify <file>' or 'aice verify --parity'.`,
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
                      code: "AICE_E0001_FILE_NOT_FOUND",
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
        if (!isProjectAiceEnabled(projectConfig)) {
          console.error(`❌ ${AICE_DISABLED_MESSAGE}`);
          process.exit(1);
        }
        const idiomsActive = isProjectIdiomsEnabled(projectConfig);
        const expandedMod =
          idiomsActive && projectConfig.idioms
            ? expandModuleIdioms(mod, projectConfig.idioms)
            : mod;
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

// Command: fix <file>
program
  .command("fix")
  .description("Autonomously repair syntax, immutability, and type violations in an .aice file")
  .argument("<file>", "Path to the .aice source file to repair")
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
    "Decompile a target language file (.ts, .tsx, .js, .jsx, .py, .rs, .go, .cpp, .cs, .kt, .php, .html, .twig, .css, .json, .yaml, .sh, .ps1, .cmd, .md) into an .aice representation",
  )
  .argument("<file>", "Path to target source file")
  .option("-o, --out <path>", "Output .aice file path")
  .option("--no-idioms", "Temporarily disable project idioms")
  .action((file: string, options: { out?: string; target?: string; idioms?: boolean }) => {
    try {
      const fullPath = path.resolve(process.cwd(), file);
      if (!fs.existsSync(fullPath)) {
        console.error(`❌ Error: Source file not found: ${file}`);
        process.exit(1);
      }

      const projectRoot = findProjectRoot(path.dirname(fullPath));
      const projectConfig = loadProjectConfig(projectRoot);
      if (!isProjectAiceEnabled(projectConfig)) {
        console.error(`❌ ${AICE_DISABLED_MESSAGE}`);
        process.exit(1);
      }

      const source = fs.readFileSync(fullPath, "utf-8");
      const targetLang = (options.target as TargetLanguage) ?? detectTargetFromPath(file);
      const effectiveIdioms = isProjectIdiomsEnabled(projectConfig, options.idioms);
      const result = decompile(source, targetLang, {
        filePath: file,
        idioms: effectiveIdioms,
        projectRoot,
      });

      const outPath = options.out
        ? path.resolve(process.cwd(), options.out)
        : path.resolve(process.cwd(), `${file}.aice`);

      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, result.aice, "utf-8");

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
  .description("Verify Put/Get stability by decompiling to .aice and recompiling to target")
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

      const projectRoot = findProjectRoot(path.dirname(fullPath));
      const projectConfig = loadProjectConfig(projectRoot);
      if (!isProjectAiceEnabled(projectConfig)) {
        console.error(`❌ ${AICE_DISABLED_MESSAGE}`);
        process.exit(1);
      }

      const source = fs.readFileSync(fullPath, "utf-8");
      const targetLang = (options.target as TargetLanguage) ?? detectTargetFromPath(file);
      const res = executeRoundtrip(source, targetLang, file);

      console.log(`\n=== Bidirectional Roundtrip Audit: ${file} ===`);
      console.log(`Target Language:     ${res.target}`);
      console.log(`Trivia Entries:      ${res.triviaEntriesCount}`);
      console.log(`Original Size:       ${res.original.length} chars`);
      console.log(`AICE Representation:  ${res.aice.length} chars`);
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

// Command: mcp
program
  .command("mcp")
  .description("Launch the AICE Model Context Protocol (MCP) server over stdio")
  .action(() => {
    new AiceMcpServer(process.stdin, process.stdout);
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
  .option("--idioms", "Force-enable project idioms")
  .option("--no-idioms", "Temporarily disable project idioms")
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
        idioms?: boolean;
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
            const {
              formatRealWorldBenchmarkJson,
              formatRealWorldBenchmarkMarkdown,
              runRealWorldBenchmarkSuite,
            } = await import("../benchmarks/index.js");
            const report = runRealWorldBenchmarkSuite();
            if (options.json) {
              console.log(formatRealWorldBenchmarkJson(report));
            } else {
              console.log(formatRealWorldBenchmarkMarkdown(report));
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
        const projectRoot = findProjectRoot(isFile ? path.dirname(fullTarget) : fullTarget);
        const projectConfig = loadProjectConfig(projectRoot);
        if (!isProjectAiceEnabled(projectConfig)) {
          console.error(`❌ ${AICE_DISABLED_MESSAGE}`);
          process.exit(1);
        }
        const isTTY = Boolean(process.stdout.isTTY && !process.env.NO_COLOR);
        const terminalWidth = process.stdout.columns || 80;

        const report = auditTokenomics(targetPath, {
          minSavings: options.minSavings,
          checkDrift: options.checkDrift,
          idioms: options.idioms,
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
                `\n=== AICE 2.0 Tokenomics & Zero-Drift Benchmark Audit: ${targetPath} ===\n`,
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

// Command: benchmark
// Aliases: bench
program
  .command("benchmark")
  .aliases(["bench"])
  .description(
    "Run the 10 Real-World AICE 2.0 Benchmarks Suite (evaluating Without AICE vs AICE Without Idioms vs AICE With Idioms)",
  )
  .option("--json", "Output structured JSON report")
  .option("--markdown", "Output formatted GitHub Flavored Markdown report")
  .action(async (options: { json?: boolean; markdown?: boolean }) => {
    try {
      const {
        runRealWorldBenchmarkSuite,
        formatRealWorldBenchmarkJson,
        formatRealWorldBenchmarkMarkdown,
      } = await import("../benchmarks/index.js");
      const report = runRealWorldBenchmarkSuite();
      if (options.json) {
        console.log(formatRealWorldBenchmarkJson(report));
      } else {
        console.log(formatRealWorldBenchmarkMarkdown(report));
      }
    } catch (err: unknown) {
      console.error(`❌ Benchmark error: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

// Command: outline [target]
program
  .command("outline")
  .description(
    "Semantic skeletonization: generate token-dense AST skeleton outline across 32 extensions (85-90% token reduction)",
  )
  .argument(
    "[targets...]",
    "Path(s) to source file(s) or directories (e.g., 'aice outline src tests')",
  )
  .option("-d, --depth <number>", "Maximum symbol nesting depth", (val) => Number.parseInt(val, 10))
  .option("--compact", "Compact token-bounded directory mode (auto-enabled for 60+ files)")
  .option("--no-compact", "Disable compact directory mode even for 60+ files")
  .option("--no-types", "Exclude type annotations")
  .option("--idioms", "Force-enable project idioms")
  .option("--no-idioms", "Temporarily disable project idioms")
  .option("--json", "Output structured JSON symbol hierarchy")
  .option("--stats", "Display token reduction savings metrics")
  .addHelpText(
    "after",
    `
Examples:
  • Multi-directory skeleton map (replaces 'ls src tests'):
      aice outline src tests
  • Compact mode for large repositories (100+ files):
      aice outline src tests --compact
  • Outline test file with named test/describe titles & [Lstart-Lend]:
      aice outline tests/app.test.ts
  • Outline shell/PowerShell/batch script or Markdown headings:
      aice outline install.sh README.md
`,
  )
  .action(
    async (
      targetPaths: string[] | undefined,
      options: {
        depth?: number;
        compact?: boolean;
        types?: boolean;
        idioms?: boolean;
        json?: boolean;
        stats?: boolean;
      },
    ) => {
      const rawTargets = targetPaths && targetPaths.length > 0 ? targetPaths : [undefined];
      try {
        if (rawTargets.length === 1) {
          const targetPath = rawTargets[0];
          const resolved = resolvePathTargets(targetPath, { includeTargets: true });
          const outlineTarget = resolved.resolvedPath;

          if (!fs.existsSync(outlineTarget)) {
            console.error(`❌ Error: Path not found: ${targetPath ?? outlineTarget}`);
            process.exit(1);
          }

          if (!isProjectAiceEnabled(resolved.config)) {
            console.error(`❌ ${AICE_DISABLED_MESSAGE}`);
            process.exit(1);
          }

          const outlineOpts: OutlineOptions = {
            depth: options.depth !== undefined ? Number(options.depth) : undefined,
            compact: options.compact,
            includeTypes: options.types !== false,
            idioms: options.idioms,
            json: !!options.json,
            stats: !!options.stats,
            projectRoot: resolved.projectRoot,
          };

          const result = await outlinePath(outlineTarget, outlineOpts);

          if (result instanceof Map) {
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
                console.log(
                  `  Token savings:   ${savings.toLocaleString()} tokens (${savingsPct}%)`,
                );
              }
            }
          } else {
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
          return;
        }

        // Multiple targets passed: `aice outline f1 f2 f3`
        const allJsonItems: unknown[] = [];
        let totalOrig = 0;
        let totalOutline = 0;
        let totalFilesCount = 0;

        const resolvedTargets: Array<{ raw: string | undefined; abs: string; root: string }> = [];
        for (const targetPath of rawTargets) {
          const resolved = resolvePathTargets(targetPath, { includeTargets: true });
          const outlineTarget = resolved.resolvedPath;
          if (!fs.existsSync(outlineTarget)) {
            console.error(`❌ Error: Path not found: ${targetPath ?? outlineTarget}`);
            process.exit(1);
          }
          if (!isProjectAiceEnabled(resolved.config)) {
            console.error(`❌ ${AICE_DISABLED_MESSAGE}`);
            process.exit(1);
          }
          resolvedTargets.push({
            raw: targetPath,
            abs: outlineTarget,
            root: resolved.projectRoot,
          });
        }

        const hasDirectoryTarget = resolvedTargets.some((t) => fs.statSync(t.abs).isDirectory());

        if (hasDirectoryTarget || options.compact) {
          const outlineOpts: OutlineOptions = {
            depth: options.depth !== undefined ? Number(options.depth) : undefined,
            compact: options.compact,
            includeTypes: options.types !== false,
            idioms: options.idioms,
            json: !!options.json,
            stats: !!options.stats,
            projectRoot: resolvedTargets[0].root,
          };
          const combinedResult = await outlinePath(
            resolvedTargets.map((t) => t.abs),
            outlineOpts,
          );
          if (combinedResult instanceof Map) {
            for (const [relPath, res] of combinedResult.entries()) {
              totalFilesCount++;
              if (res.stats) {
                totalOrig += res.stats.originalTokens;
                totalOutline += res.stats.outlineTokens;
              }
              if (options.json) {
                allJsonItems.push(
                  res.json ?? {
                    file: res.file,
                    symbols: res.symbols,
                    ...(res.stats ? { stats: res.stats } : {}),
                  },
                );
              } else {
                console.log(`\n// === ${relPath} ===\n`);
                console.log(res.text);
              }
            }
          }
        } else {
          for (const item of resolvedTargets) {
            const outlineOpts: OutlineOptions = {
              depth: options.depth !== undefined ? Number(options.depth) : undefined,
              compact: options.compact,
              includeTypes: options.types !== false,
              idioms: options.idioms,
              json: !!options.json,
              stats: !!options.stats,
              projectRoot: item.root,
            };
            const result = await outlinePath(item.abs, outlineOpts);
            if (result instanceof Map) {
              for (const [relPath, res] of result.entries()) {
                totalFilesCount++;
                if (res.stats) {
                  totalOrig += res.stats.originalTokens;
                  totalOutline += res.stats.outlineTokens;
                }
                if (options.json) {
                  allJsonItems.push(
                    res.json ?? {
                      file: res.file,
                      symbols: res.symbols,
                      ...(res.stats ? { stats: res.stats } : {}),
                    },
                  );
                } else {
                  console.log(`\n// === ${relPath} ===\n`);
                  console.log(res.text);
                }
              }
            } else {
              totalFilesCount++;
              if (result.stats) {
                totalOrig += result.stats.originalTokens;
                totalOutline += result.stats.outlineTokens;
              }
              if (options.json) {
                allJsonItems.push(
                  result.json ?? {
                    file: result.file,
                    symbols: result.symbols,
                    ...(result.stats ? { stats: result.stats } : {}),
                  },
                );
              } else {
                console.log(`\n// === ${item.raw ?? result.file} ===\n`);
                console.log(result.text);
              }
            }
          }
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        recordTelemetryError({
          targetPath: rawTargets[0],
          operation: "outline",
          surface: "cli",
          errorMessage: msg,
        });
        console.error(`❌ Error outlining ${rawTargets.join(", ")}: ${msg}`);
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

// Command: splice [path]
program
  .command("splice")
  .description(
    "AST surgical updates: replace, insert, or delete declarations with 90% token reduction",
  )
  .argument("[path]", "Path to source file (optional when --batch or -f is provided)")
  .argument("[symbol]", "Target symbol identifier (optional shorthand for -s/--symbol)")
  .option("-f, --file <path>", "Path to source file")
  .option(
    "-s, --symbol <symbol>",
    "Target selector: Class.method, test title/ID (TC-MENU-001), Markdown Heading, Lstart-Lend, eof, or imports",
  )
  .option("-c, --code <code>", "Replacement AICE or native declaration snippet")
  .option("-t, --template <code>", "Alias for --code")
  .option("-b, --body <code>", "Replacement body snippet (for functions/methods)")
  .option("--from <file>", "Read replacement payload from a file")
  .option("--stdin", "Read replacement AICE, $idiom, or native code from standard input")
  .option("-d, --delete [symbol]", "Delete the symbol (or specify an additional symbol to delete)")
  .option("--insert-after <symbol>", "Insert after specified symbol")
  .option("--insert-before <symbol>", "Insert before specified symbol")
  .option(
    "--edits <jsonOrFile>",
    "Apply multiple symbol edits to a single file in reverse offset order (JSON array or path)",
  )
  .option(
    "--batch <fileOrJson>",
    "Execute atomic multi-file batch splice from JSON file or JSON string",
  )
  .option("--create", "Create target native file from scratch if it does not exist or overwrite")
  .option("--idioms", "Force-enable project idioms")
  .option("--no-idioms", "Temporarily disable project idioms")
  .option("--in-place", "Apply splice mutation directly to the file on disk (default)")
  .option("--dry-run", "Output result without modifying file")
  .option("--diff", "Display unified diff")
  .option("--compile", "Automatically recompile target after splice")
  .addHelpText(
    "after",
    `
Examples:
  • Multi-block heredoc stream across 32 extensions (:Class.method, :testId, :Heading, :Lstart-Lend, :eof, :imports):
      aice splice --stdin << 'EOF'
      === src/app.ts:GameApp.init ===
      public init(): void { this.ready = true; }
      === tests/app.test.ts:TC-MENU-001 ===
      test("TC-MENU-001: GameApp initializes at 60Hz", () => { expect(true).toBe(true); });
      === README.md:Quick Start ===
      ## Quick Start
      Run \`./install.sh -y\`.
      EOF
  • Replace specific line range:
      aice splice src/app.ts -s L10-L12 -c "const total = a + b;"
  • Delete class field/property cleanly:
      aice splice src/app.ts -s InputHandler.isListening --delete
  • Update contiguous imports block:
      aice splice src/app.ts -s imports -c "import * as fs from 'node:fs';"
`,
  )
  .action(
    async (
      rawTargetPath: string | undefined,
      positionalSymbol: string | undefined,
      options: {
        file?: string;
        symbol?: string;
        code?: string;
        template?: string;
        body?: string;
        from?: string;
        stdin?: boolean;
        delete?: boolean | string;
        insertAfter?: string;
        insertBefore?: string;
        edits?: string;
        batch?: string;
        create?: boolean;
        idioms?: boolean;
        dryRun?: boolean;
        diff?: boolean;
        compile?: boolean;
      },
    ) => {
      try {
        if (options.batch) {
          const batchProjectRoot = findProjectRoot(process.cwd());
          const batchProjectConfig = loadProjectConfig(batchProjectRoot);
          if (!isProjectAiceEnabled(batchProjectConfig)) {
            console.error(`❌ ${AICE_DISABLED_MESSAGE}`);
            process.exit(1);
          }
          const batchEffectiveIdioms = isProjectIdiomsEnabled(batchProjectConfig, options.idioms);
          const batchCandidatePath = path.resolve(process.cwd(), options.batch);
          const rawJson =
            fs.existsSync(batchCandidatePath) && fs.statSync(batchCandidatePath).isFile()
              ? fs.readFileSync(batchCandidatePath, "utf-8")
              : options.batch;
          const rawParts = rawJson.split(/['"]?\s*&&\s*aice\s+idioms?\s+update\s+--batch\s*['"]?/);
          const allEntries: Array<Record<string, unknown>> = [];
          for (const part of rawParts) {
            const parsed = JSON.parse(part.trim());
            if (Array.isArray(parsed)) {
              allEntries.push(...parsed);
            }
          }
          const spliceItems = allEntries.filter(
            (e) => typeof e.file === "string" || typeof e.filePath === "string",
          ) as unknown as BatchSpliceItem[];
          const idiomItems = allEntries.filter(
            (e) =>
              !e.file && !e.filePath && (typeof e.name === "string" || typeof e.idiom === "string"),
          );
          if (spliceItems.length > 0) {
            const batchRes = await spliceBatch(spliceItems, {
              dryRun: options.dryRun,
              compile: options.compile,
              idioms: batchEffectiveIdioms,
            });
            const totalSaved = batchRes.results.reduce((acc, r) => acc + (r.tokensSaved ?? 0), 0);
            console.log(
              `✔ Batch spliced ${batchRes.results.length} item(s) across ${batchRes.modifiedFiles.length} file(s) (${totalSaved} tokens saved)`,
            );
          }
          if (idiomItems.length > 0) {
            let totalOcc = 0;
            const modFilesSet = new Set<string>();
            for (const entry of idiomItems) {
              const idName = String(entry.name || entry.idiom || "");
              const idCode = String(
                entry.code ??
                  entry.template ??
                  entry.templateAice ??
                  entry.aice ??
                  entry.body ??
                  entry.content ??
                  entry.replacement ??
                  "",
              );
              const r = await updateProjectIdiom(process.cwd(), idName, idCode, {
                dryRun: Boolean(options.dryRun),
                params: typeof entry.params === "string" ? entry.params : undefined,
              });
              totalOcc += r.updatedOccurrences;
              for (const mf of r.modifiedFiles) modFilesSet.add(mf);
            }
            console.log(
              `✔ Batch updated ${idiomItems.length} idiom(s): ${totalOcc} occurrence(s) across ${modFilesSet.size} file(s)`,
            );
          }
          return;
        }

        let targetPath = rawTargetPath ?? options.file;
        if (positionalSymbol && !options.symbol) {
          if (
            targetPath &&
            !fs.existsSync(path.resolve(process.cwd(), targetPath)) &&
            fs.existsSync(path.resolve(process.cwd(), positionalSymbol))
          ) {
            options.symbol = targetPath;
            targetPath = positionalSymbol;
          } else {
            options.symbol = positionalSymbol;
          }
        }
        if (!targetPath || targetPath === "-") {
          const rawCrossStream =
            options.code ??
            options.template ??
            (options.stdin ? fs.readFileSync(0, "utf-8") : await readStdin());
          if (rawCrossStream && rawCrossStream.trim().length > 0) {
            const batchProjectRoot = findProjectRoot(process.cwd());
            const batchProjectConfig = loadProjectConfig(batchProjectRoot);
            if (!isProjectAiceEnabled(batchProjectConfig)) {
              console.error(`❌ ${AICE_DISABLED_MESSAGE}`);
              process.exit(1);
            }
            const batchEffectiveIdioms = isProjectIdiomsEnabled(batchProjectConfig, options.idioms);
            const parsedStream = parseMultiBlockSpliceStream(rawCrossStream);
            let spliceItems: BatchSpliceItem[] | undefined = parsedStream?.batchItems;
            if (!spliceItems || spliceItems.length === 0) {
              try {
                const parsedJson = JSON.parse(rawCrossStream.trim());
                if (Array.isArray(parsedJson)) {
                  spliceItems = parsedJson as BatchSpliceItem[];
                }
              } catch {
                // ignore
              }
            }
            if (spliceItems && spliceItems.length > 0) {
              const batchRes = await spliceBatch(spliceItems, {
                dryRun: options.dryRun,
                compile: options.compile,
                idioms: batchEffectiveIdioms,
              });
              const totalSaved = batchRes.results.reduce((acc, r) => acc + (r.tokensSaved ?? 0), 0);
              console.log(
                `✔ Batch spliced ${batchRes.results.length} item(s) across ${batchRes.modifiedFiles.length} file(s) (${totalSaved} tokens saved)`,
              );
              return;
            }
          }
          console.error(
            "❌ Error: Must provide <path>, --batch <fileOrJson>, or pipe '=== <filePath>:<symbol> ===' blocks via --stdin.",
          );
          process.exit(1);
        }

        const fullSpliceTarget = path.resolve(process.cwd(), targetPath);
        const spliceProjectRoot = findProjectRoot(
          fs.existsSync(fullSpliceTarget) && fs.statSync(fullSpliceTarget).isDirectory()
            ? fullSpliceTarget
            : path.dirname(fullSpliceTarget),
        );
        const spliceProjectConfig = loadProjectConfig(spliceProjectRoot);
        if (!isProjectAiceEnabled(spliceProjectConfig)) {
          console.error(`❌ ${AICE_DISABLED_MESSAGE}`);
          process.exit(1);
        }
        const effectiveSpliceIdioms = isProjectIdiomsEnabled(spliceProjectConfig, options.idioms);

        let code = options.code ?? options.template;
        let extraDeleteSymbol: string | undefined;
        let isPrimaryDelete = false;

        if (typeof options.delete === "string") {
          if (
            (code !== undefined || options.body !== undefined) &&
            options.symbol &&
            options.symbol !== options.delete
          ) {
            extraDeleteSymbol = options.delete;
            isPrimaryDelete = false;
          } else {
            options.symbol = options.delete;
            isPrimaryDelete = true;
          }
        } else if (options.delete === true) {
          isPrimaryDelete = true;
        }

        if (options.from) {
          const fromPath = path.resolve(process.cwd(), options.from);
          if (!fs.existsSync(fromPath)) {
            console.error(`❌ Error: --from file not found: ${options.from}`);
            process.exit(1);
          }
          code = fs.readFileSync(fromPath, "utf-8");
        }

        let parsedEdits: SpliceOptions["edits"];
        if (
          options.edits === "-" ||
          (options.stdin && !options.symbol && code === undefined && options.body === undefined)
        ) {
          const stdinRaw = fs.readFileSync(0, "utf-8");
          try {
            const parsed = JSON.parse(stdinRaw.trim());
            if (Array.isArray(parsed)) {
              parsedEdits = parsed;
            } else {
              code = stdinRaw;
            }
          } catch {
            code = stdinRaw;
          }
        } else if (options.edits) {
          const editsCandidatePath = path.resolve(process.cwd(), options.edits);
          const rawEditsJson =
            fs.existsSync(editsCandidatePath) && fs.statSync(editsCandidatePath).isFile()
              ? fs.readFileSync(editsCandidatePath, "utf-8")
              : options.edits;
          const parsed = JSON.parse(rawEditsJson.trim());
          if (!Array.isArray(parsed)) {
            console.error("❌ Error: --edits must be a JSON array of symbol edit objects.");
            process.exit(1);
          }
          parsedEdits = parsed;
        }

        if (options.stdin && code === undefined && !parsedEdits) {
          code = fs.readFileSync(0, "utf-8");
        }

        if (
          code === undefined &&
          options.body === undefined &&
          !isPrimaryDelete &&
          (!parsedEdits || parsedEdits.length === 0)
        ) {
          const stdinContent = await readStdin();
          if (stdinContent && stdinContent.trim().length > 0) {
            code = stdinContent;
          } else {
            console.error(
              "❌ Error: Must provide --code, --from, --stdin, --body, --delete, or --edits.",
            );
            process.exit(1);
          }
        }

        if (!options.symbol && (!parsedEdits || parsedEdits.length === 0) && code) {
          const multiStream = parseMultiBlockSpliceStream(code, targetPath);
          if (multiStream?.batchItems && multiStream.batchItems.length > 0) {
            const batchRes = await spliceBatch(multiStream.batchItems, {
              dryRun: options.dryRun,
              compile: options.compile,
              idioms: effectiveSpliceIdioms,
              projectRoot: spliceProjectRoot,
            });
            const totalSaved = batchRes.results.reduce((acc, r) => acc + (r.tokensSaved ?? 0), 0);
            console.log(
              `✔ Batch spliced ${batchRes.results.length} item(s) across ${batchRes.modifiedFiles.length} file(s) (${totalSaved} tokens saved)`,
            );
            return;
          }
          if (multiStream?.singleFileEdits && multiStream.singleFileEdits.length > 0) {
            parsedEdits = multiStream.singleFileEdits;
            code = undefined;
          }
        }

        const spliceOpts: SpliceOptions = {
          symbol: options.symbol,
          code,
          body: options.body,
          delete: isPrimaryDelete,
          insertAfter: options.insertAfter,
          insertBefore: options.insertBefore,
          edits: parsedEdits,
          create: options.create,
          idioms: effectiveSpliceIdioms,
          dryRun: options.dryRun,
          diff: options.diff,
          compile: options.compile,
          projectRoot: spliceProjectRoot,
        };

        const result = await splice(fullSpliceTarget, spliceOpts);
        if (extraDeleteSymbol) {
          await splice(fullSpliceTarget, {
            symbol: extraDeleteSymbol,
            delete: true,
            idioms: effectiveSpliceIdioms,
            dryRun: options.dryRun,
            compile: options.compile,
            projectRoot: spliceProjectRoot,
          });
        }

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
          const actionDesc = isPrimaryDelete
            ? `Deleted symbol '${result.symbol}'`
            : options.insertAfter
              ? `Inserted after '${options.insertAfter}'`
              : options.insertBefore
                ? `Inserted before '${options.insertBefore}'`
                : options.body
                  ? `Spliced body of '${result.symbol}'`
                  : `Spliced symbol '${result.symbol}'${extraDeleteSymbol ? ` and deleted '${extraDeleteSymbol}'` : ""}`;
          console.log(`✔ ${actionDesc} in ${targetPath} (${result.tokensSaved ?? 0} tokens saved)`);
          if (options.compile) {
            console.log(`✔ Recompiled target for ${targetPath}`);
          }
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        const errTarget = rawTargetPath ?? options.file ?? options.batch;
        recordTelemetryError({
          targetPath: errTarget,
          operation: "splice",
          surface: "cli",
          errorMessage: msg,
        });
        console.error(`❌ Error splicing ${errTarget ?? "<stdin>"}: ${msg}`);
        process.exit(1);
      }
    },
  );

// Command: create [filePath]
program
  .command("create [filePath]")
  .alias("new")
  .description(
    "Create greenfield/startup native files from compact AICE syntax, $idiom macros, or hybrid code (40-75% token reduction)",
  )
  .option("-c, --code <codeString>", "Compact AICE, $idiom, or hybrid code string")
  .option("-F, --from <file>", "Read AICE payload from an input file")
  .option("--stdin", "Read AICE payload from standard input")
  .option(
    "--idiom <spec...>",
    "Define one or more inline $idioms (e.g. '$clamp($0,$1,$2)=Math.min(Math.max($0,$1),$2)')",
  )
  .option(
    "--batch [jsonOrFile]",
    "Create multiple native files atomically from JSON array/object or JSON file",
  )
  .option("-f, --force", "Force full-file replacement if target file already exists (>25 lines)")
  .option("--overwrite", "Alias for --force")
  .option("--idioms", "Force-enable project and inline $idioms")
  .option("--no-idioms", "Disable $idiom expansion and persistence")
  .option("--dry-run", "Preview compiled native code without writing to disk")
  .option("--json", "Output structured creation result as JSON")
  .action(
    async (
      filePathArg: string | undefined,
      options: {
        code?: string;
        from?: string;
        stdin?: boolean;
        idiom?: string[];
        batch?: string | boolean;
        overwrite?: boolean;
        force?: boolean;
        idioms?: boolean;
        dryRun?: boolean;
        json?: boolean;
      },
    ) => {
      try {
        const runCreateBatchItems = async (rawItems: BatchCreateItem[]) => {
          const items: BatchCreateItem[] = rawItems.map((it) => {
            const rawFp = it.filePath || it.file || it.path || "";
            return {
              ...it,
              filePath: rawFp ? path.resolve(process.cwd(), rawFp) : rawFp,
              ...(it.from ? { from: path.resolve(process.cwd(), it.from) } : {}),
            };
          });

          const firstFp = items[0]?.filePath;
          const batchProjectRoot = findProjectRoot(
            firstFp ? path.dirname(firstFp) : process.cwd(),
            process.cwd(),
          );
          const batchProjectConfig = loadProjectConfig(batchProjectRoot);
          if (!isProjectAiceEnabled(batchProjectConfig)) {
            console.error(`❌ ${AICE_DISABLED_MESSAGE}`);
            process.exit(1);
          }
          const batchEffectiveIdioms = isProjectIdiomsEnabled(batchProjectConfig, options.idioms);

          const batchRes = await createBatch(items, {
            dryRun: options.dryRun,
            overwrite: Boolean(options.overwrite || options.force),
            idioms: batchEffectiveIdioms,
            inlineIdioms: options.idiom,
            projectRoot: batchProjectRoot,
            surface: "cli",
          });

          if (options.json) {
            console.log(JSON.stringify(batchRes, null, 2));
            return;
          }

          if (options.dryRun) {
            console.log(
              `[Dry Run] Previewed batch creation of ${batchRes.results.length} file(s) (${batchRes.totalAiceTokens} cl100k tokens${batchRes.totalTokensSaved > 0 ? `, saved: +${batchRes.totalTokensSaved}` : ""})`,
            );
            for (const r of batchRes.results) {
              console.log(`\n// === ${r.filePath} ===\n${r.nativeCode}`);
            }
          } else if (batchRes.totalTokensSaved > 0) {
            console.log(
              `✔ Batch created ${batchRes.results.length} file(s) (${batchRes.totalAiceTokens} cl100k tokens, saved: +${batchRes.totalTokensSaved}${batchRes.results.length > 1 ? `, ${batchRes.results.length - 1} turn(s) saved` : ""})`,
            );
          } else if (batchRes.results.length > 1) {
            console.log(
              `✔ Batch created ${batchRes.results.length} file(s) in 1 turn (${batchRes.totalAiceTokens} cl100k tokens, ${batchRes.results.length - 1} turn(s) saved)`,
            );
          } else {
            console.log(
              `✔ Created 1 file: ${batchRes.results[0]?.filePath ?? ""} (${batchRes.totalAiceTokens} cl100k tokens)`,
            );
          }
        };

        const isBatch =
          options.batch !== undefined ||
          filePathArg === "--batch" ||
          filePathArg === "-" ||
          (!filePathArg && !options.from);
        if (isBatch) {
          let rawInput = "";
          const batchArg =
            options.batch !== undefined
              ? options.batch
              : filePathArg === "--batch" || filePathArg === "-"
                ? "-"
                : undefined;
          if (options.code && !batchArg) {
            rawInput = options.code;
          } else if (batchArg === "-" || batchArg === true || options.stdin || !batchArg) {
            rawInput = options.stdin ? fs.readFileSync(0, "utf-8") : await readStdin();
          } else {
            const batchCandidatePath = path.resolve(process.cwd(), String(batchArg));
            rawInput =
              fs.existsSync(batchCandidatePath) && fs.statSync(batchCandidatePath).isFile()
                ? fs.readFileSync(batchCandidatePath, "utf-8")
                : String(batchArg);
          }

          if (!rawInput || !rawInput.trim()) {
            console.error(
              "❌ Error: Must provide <filePath>, --batch <jsonOrFile>, or pipe multi-file '=== <filePath> ===' blocks via stdin.",
            );
            process.exit(1);
          }

          const streamItems = parseMultiFileCreateStream(rawInput);
          let rawItems: BatchCreateItem[];
          if (streamItems && streamItems.length > 0) {
            rawItems = streamItems;
          } else {
            const parsed = JSON.parse(rawInput);
            if (Array.isArray(parsed)) {
              rawItems = parsed as BatchCreateItem[];
            } else if (parsed && typeof parsed === "object" && Array.isArray(parsed.files)) {
              rawItems = parsed.files as BatchCreateItem[];
            } else if (parsed && typeof parsed === "object") {
              rawItems = Object.entries(parsed).map(([fp, codeVal]) =>
                typeof codeVal === "string"
                  ? { filePath: fp, code: codeVal }
                  : { filePath: fp, ...(codeVal as object) },
              );
            } else {
              throw new Error(
                "--batch must be a multi-file '=== <filePath> ===' stream, JSON array of { filePath, code } items, or { [filePath]: code } map",
              );
            }
          }

          await runCreateBatchItems(rawItems);
          return;
        }

        if (!filePathArg) {
          console.error("❌ Error: Must provide <filePath> or --batch <jsonOrFile>.");
          process.exit(1);
        }

        const fullTarget = path.resolve(process.cwd(), filePathArg);
        const createProjectRoot = findProjectRoot(path.dirname(fullTarget), process.cwd());
        const createProjectConfig = loadProjectConfig(createProjectRoot);
        if (!isProjectAiceEnabled(createProjectConfig)) {
          console.error(`❌ ${AICE_DISABLED_MESSAGE}`);
          process.exit(1);
        }
        const effectiveCreateIdioms = isProjectIdiomsEnabled(createProjectConfig, options.idioms);

        let code = options.code;
        if (code === undefined && !options.from) {
          const stdinContent = options.stdin ? fs.readFileSync(0, "utf-8") : await readStdin();
          if (stdinContent && stdinContent.trim().length > 0) {
            code = stdinContent;
          } else {
            console.error("❌ Error: Must provide -c/--code, --from <file>, or input via stdin.");
            process.exit(1);
          }
        }

        if (code) {
          const streamItems = parseMultiFileCreateStream(code);
          if (streamItems && streamItems.length > 1) {
            await runCreateBatchItems(streamItems);
            return;
          }
        }

        const result = await createFile(fullTarget, {
          code,
          from: options.from ? path.resolve(process.cwd(), options.from) : undefined,
          inlineIdioms: options.idiom,
          idioms: effectiveCreateIdioms,
          overwrite: Boolean(options.overwrite || options.force),
          dryRun: options.dryRun,
          projectRoot: createProjectRoot,
          surface: "cli",
        });

        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        if (options.dryRun) {
          console.log(
            `[Dry Run] Previewed ${filePathArg} (${result.aiceTokens} cl100k tokens${result.tokensSaved > 0 ? `, saved: +${result.tokensSaved}` : ""})`,
          );
          console.log(result.nativeCode);
        } else {
          console.log(
            `✔ Created ${filePathArg} (${result.aiceTokens} cl100k tokens${result.tokensSaved > 0 ? `, saved: +${result.tokensSaved}` : ""})`,
          );
          const eligibleTipExts = new Set([
            ".ts",
            ".tsx",
            ".js",
            ".jsx",
            ".py",
            ".rs",
            ".go",
            ".cpp",
            ".cs",
            ".kt",
            ".php",
            ".css",
          ]);
          const targetExt = path.extname(fullTarget).toLowerCase();
          if (
            eligibleTipExts.has(targetExt) &&
            result.nativeTokens >= 120 &&
            result.tokensSaved === 0
          ) {
            console.log(
              "💡 Tip: 0 tokens saved (verbose native input). Use AICE shorthands (pub fn, fn, <-, :#, :$, :?, d:flex;jc:center) or @idiom macros to save 40-65% output tokens.",
            );
          }
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        const errTarget =
          filePathArg ?? (typeof options.batch === "string" ? options.batch : undefined);
        recordTelemetryError({
          targetPath: errTarget,
          operation: "create",
          surface: "cli",
          errorMessage: msg,
        });
        console.error(`❌ Error creating ${errTarget ?? "<file>"}: ${msg}`);
        process.exit(1);
      }
    },
  );

// Command: context [target]
program
  .command("context")
  .description(
    "Dependency contract packager, symbol/test/heading extractor & /pattern/ search in 1 turn across 32 extensions",
  )
  .argument(
    "[targets...]",
    "Path(s) to target source file(s) or directory (omitted for workspace overview context)",
  )
  .option(
    "-d, --depth <number>",
    "Dependency traversal depth (default: 1)",
    (val) => Number.parseInt(val, 10),
    1,
  )
  .option(
    "-s, --symbol <symbol>",
    "Selector: Class.method, test ID (TC-MENU-001), Markdown heading, line range (L180-L240), or regex (/pattern/)",
  )
  .option("--idioms", "Force-enable project idioms")
  .option("--no-idioms", "Temporarily disable project idioms")
  .option("--no-callers", "Skip reverse caller lookup")
  .option("--outline-target", "Outline target instead of full source")
  .option("--max-tokens <number>", "Maximum token limit", (val) => Number.parseInt(val, 10))
  .option("--json", "Output as JSON bundle")
  .option("--stats", "Output token count statistics")
  .addHelpText(
    "after",
    `
Examples:
  • Extract method with downstream caller call-site line numbers ([L14]):
      aice context src/app.ts -s "GameApp.getCoreConstants"
  • Extract test block by test ID or title prefix (replaces grep -n):
      aice context tests/app.test.ts -s "TC-MENU-001"
  • Extract exact line range (replaces sed -n '180,240p'):
      aice context src/app.ts -s "L180-L240"
  • Search file or directory by regex/substring in 1 turn (replaces grep -rn):
      aice context src -s "/OracleIncoherenceAuditor/"
  • Extract Markdown section or shell/PowerShell/batch function:
      aice context README.md -s "Quick Start"
      aice context install.sh -s "install_sys_packages"
`,
  )
  .action(
    async (
      targetPaths: string[] | undefined,
      options: {
        depth?: number;
        symbol?: string;
        idioms?: boolean;
        callers?: boolean;
        outlineTarget?: boolean;
        maxTokens?: number;
        json?: boolean;
        stats?: boolean;
      },
    ) => {
      const rawTargets = targetPaths && targetPaths.length > 0 ? targetPaths : [undefined];
      try {
        const results = [];
        for (const rawTarget of rawTargets) {
          let targetPath = rawTarget;
          let inlineSymbol: string | undefined;
          if (
            typeof rawTarget === "string" &&
            rawTarget.includes(":") &&
            !/^[a-zA-Z]:[\\/]/.test(rawTarget)
          ) {
            const colonIdx = rawTarget.indexOf(":");
            const candidateFile = rawTarget.slice(0, colonIdx);
            const candidateSym = rawTarget.slice(colonIdx + 1).trim();
            if (candidateFile && candidateSym && fs.existsSync(path.resolve(candidateFile))) {
              targetPath = candidateFile;
              inlineSymbol = candidateSym;
            }
          }
          const resolved = resolvePathTargets(targetPath, { includeTargets: true });
          if (!isProjectAiceEnabled(resolved.config)) {
            console.error(`❌ ${AICE_DISABLED_MESSAGE}`);
            process.exit(1);
          }
          const contextOpts: ContextOptions = {
            depth: options.depth !== undefined ? Number(options.depth) : 1,
            symbol: inlineSymbol ?? options.symbol,
            idioms: options.idioms,
            includeCallers: options.callers !== false,
            outlineTarget: !!options.outlineTarget,
            maxTokens: options.maxTokens !== undefined ? Number(options.maxTokens) : undefined,
            json: !!options.json,
            stats: !!options.stats,
            projectRoot: resolved.projectRoot,
          };
          results.push(await generateContext(resolved.resolvedPath, contextOpts));
        }

        if (options.json) {
          console.log(JSON.stringify(results.length === 1 ? results[0] : results, null, 2));
        } else {
          for (const result of results) {
            console.log(result.formattedBundle);
            if (options.stats) {
              console.log("\n📊 Context Pack Token Telemetry:");
              console.log(`  Total pack tokens: ${result.tokenCount?.toLocaleString() ?? 0}`);
              console.log(`  Dependencies:      ${result.dependencies.length}`);
              console.log(`  Downstream callers:${result.callers.length}`);
              console.log(`  Target characters: ${result.targetContent.length.toLocaleString()}`);
            }
          }
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        recordTelemetryError({
          targetPath: rawTargets[0],
          operation: "context",
          surface: "cli",
          errorMessage: msg,
        });
        console.error(`❌ Error packaging context for ${rawTargets.join(", ")}: ${msg}`);
        process.exit(1);
      }
    },
  );

// Command: fmt [target]
program
  .command("fmt")
  .description("Deterministic zero-token canonical formatting pre-pass for AICE source code")
  .argument(
    "[target]",
    "Path to .aice file or directory to format (omitted to format all workspace .aice files)",
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
          const formatted = formatAiceSource(stdinSource, {
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
        if (!isProjectAiceEnabled(resolved.config)) {
          console.error(`❌ ${AICE_DISABLED_MESSAGE}`);
          process.exit(1);
        }
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

        const resultOrResults = await formatAicePath(fmtTarget, fmtOptions);
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
    "Path to target or baseline .aice source file or directory (omitted for workspace diff against git HEAD)",
  )
  .argument(
    "[newPath]",
    "Path to new .aice source file (optional; defaults to git HEAD comparison)",
  )
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
        if (!isProjectAiceEnabled(resolved.config)) {
          console.error(`❌ ${AICE_DISABLED_MESSAGE}`);
          process.exit(1);
        }

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
              console.log(`No .aice files found in ${oldPath ?? resolved.resolvedPath}`);
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
  .argument("<path>", "Path to target .aice source file")
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

// Command: idioms [action] [target] [extra]
program
  .command("idioms [action] [target] [extra]")
  .alias("idiom")
  .description(
    "Mine, apply, expand, list, toggle (on/off), read, or update project-specific token-saving idioms",
  )
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
  .option(
    "-c, --code <template>",
    "New AICE template for `aice idioms update <$name> -c <template>`",
  )
  .option("--batch <fileOrJson>", "Batch update multiple idioms from JSON object or array")
  .option("--params <spec>", "Optional parameter spec with defaults (e.g. '$0,$1,$2=6.283185')")
  .option("--json", "Output results in JSON format")
  .option("--save", "Save discovered idioms to aice.config.json and .aice-cache/idioms.json")
  .option("--dry-run", "Preview idiom synthesis or update without modifying files")
  .action(
    async (
      actionArg: string | undefined,
      targetArg: string | undefined,
      extraArg: string | undefined,
      options: {
        minOccurrences?: number;
        minSavings?: number;
        code?: string;
        batch?: string;
        params?: string;
        json?: boolean;
        save?: boolean;
        dryRun?: boolean;
      },
    ) => {
      try {
        const validActions = new Set([
          "scan",
          "apply",
          "expand",
          "list",
          "on",
          "off",
          "read",
          "update",
        ]);
        let action = "scan";
        let targetDir = process.cwd();
        let idiomNameArg = "";

        if (actionArg && validActions.has(actionArg.toLowerCase())) {
          action = actionArg.toLowerCase();
          if (action === "read" || action === "update") {
            idiomNameArg = targetArg ?? "";
            targetDir = path.resolve(process.cwd(), extraArg ?? ".");
          } else {
            targetDir = path.resolve(process.cwd(), targetArg ?? ".");
          }
        } else if (actionArg) {
          targetDir = path.resolve(process.cwd(), actionArg);
          action = "scan";
        } else {
          targetDir = path.resolve(process.cwd(), targetArg ?? ".");
        }

        const minOccurrences = options.minOccurrences ?? 3;
        const minNetTokenSavings = options.minSavings ?? 10;
        const isJson = Boolean(options.json);
        const dryRun = Boolean(options.dryRun);

        if (action === "on" || action === "off") {
          const enabled = action === "on";
          const updatedCfg = setProjectIdiomsEnabled(targetDir, enabled);
          if (isJson) {
            console.log(JSON.stringify({ idiomsEnabled: updatedCfg.idiomsEnabled }, null, 2));
            return;
          }
          console.log(
            `✔ Project idioms ${enabled ? "ENABLED (ON)" : "DISABLED (OFF)"} in ${path.relative(process.cwd(), targetDir) || "."}`,
          );
          return;
        }

        const idiomsProjectRoot = findProjectRoot(targetDir);
        const idiomsProjectConfig = loadProjectConfig(idiomsProjectRoot);
        if (!isProjectAiceEnabled(idiomsProjectConfig)) {
          console.error(`❌ ${AICE_DISABLED_MESSAGE}`);
          process.exit(1);
        }

        if (action === "read") {
          if (!idiomNameArg) {
            console.error("❌ Error: Must specify idiom name: `aice idioms read <$name> [dir]`");
            process.exit(1);
          }
          const res = readProjectIdiom(targetDir, idiomNameArg);
          if (isJson) {
            console.log(JSON.stringify(res, null, 2));
          } else {
            console.log(res.formattedReport);
          }
          return;
        }

        if (action === "update") {
          if (options.batch) {
            const batchDir =
              idiomNameArg && fs.existsSync(path.resolve(process.cwd(), idiomNameArg))
                ? path.resolve(process.cwd(), idiomNameArg)
                : process.cwd();
            const batchPath = path.resolve(process.cwd(), options.batch);
            const rawJson =
              fs.existsSync(batchPath) && fs.statSync(batchPath).isFile()
                ? fs.readFileSync(batchPath, "utf-8")
                : options.batch;
            const parsedBatch = JSON.parse(rawJson);
            const entries: Array<{
              name?: string;
              idiom?: string;
              code?: string;
              template?: string;
              templateAice?: string;
              aice?: string;
              body?: string;
              content?: string;
              replacement?: string;
              params?: string;
            }> = Array.isArray(parsedBatch)
              ? parsedBatch
              : Object.entries(parsedBatch).map(([k, v]) => ({ name: k, code: String(v) }));
            const batchResults = [];
            let totalOcc = 0;
            const modFilesSet = new Set<string>();
            for (const entry of entries) {
              const idName = entry.name || entry.idiom || "";
              const idCode =
                entry.code ??
                entry.template ??
                entry.templateAice ??
                entry.aice ??
                entry.body ??
                entry.content ??
                entry.replacement ??
                "";
              const r = await updateProjectIdiom(batchDir, idName, idCode, {
                dryRun,
                params: entry.params ?? options.params,
              });
              batchResults.push(r);
              totalOcc += r.updatedOccurrences;
              for (const mf of r.modifiedFiles) modFilesSet.add(mf);
            }
            if (isJson) {
              console.log(JSON.stringify(batchResults, null, 2));
            } else {
              console.log(
                `✔ Batch updated ${entries.length} idiom(s): ${totalOcc} occurrence(s) across ${modFilesSet.size} file(s)`,
              );
            }
            return;
          }

          if (!idiomNameArg) {
            console.error(
              '❌ Error: Must specify idiom name: `aice idioms update <$name> -c "<template>" [dir]`',
            );
            process.exit(1);
          }
          let templateCode = options.code;
          let resolvedTargetDir = targetDir;
          if ((!templateCode || !templateCode.trim()) && extraArg) {
            const candidateDir = path.resolve(process.cwd(), extraArg);
            if (!fs.existsSync(candidateDir) || !fs.statSync(candidateDir).isDirectory()) {
              templateCode = extraArg;
              resolvedTargetDir = process.cwd();
            }
          }
          if (!templateCode || !templateCode.trim()) {
            console.error("❌ Error: Must provide `-c, --code <template>` when updating an idiom.");
            process.exit(1);
          }
          const res = await updateProjectIdiom(resolvedTargetDir, idiomNameArg, templateCode, {
            dryRun,
            params: options.params,
          });
          if (isJson) {
            console.log(JSON.stringify(res, null, 2));
          } else {
            console.log(
              `✔ Updated idiom ${res.idiom.name}${dryRun ? " (Dry Run)" : ""}: ${res.updatedOccurrences} occurrence(s) across ${res.modifiedFiles.length} file(s)`,
            );
          }
          return;
        }

        if (action === "scan") {
          const res = scanProjectIdioms(targetDir, {
            dryRun,
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

          if (options.save) {
            console.log(
              `✔ Saved ${idiomCount} discovered project idiom(s) to aice.config.json (+${tokenSavings} net tokens)`,
            );
            return;
          }

          console.log(
            `\n=== AICE Project Idioms Scan: ${path.relative(process.cwd(), targetDir) || "."} ===`,
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

          if (isJson) {
            console.log(JSON.stringify(res, null, 2));
            return;
          }

          const idiomsMap = res.idioms ?? (res as any).discoveredIdioms ?? {};
          const idiomCount = res.synthesizedIdioms ?? Object.keys(idiomsMap).length;
          const tokenSavings = res.netTokenSavings ?? res.totalNetTokenSavings ?? 0;
          const filesCount = res.modifiedFiles?.length ?? (res as any).filesModified?.length ?? 0;

          console.log(
            `\n=== AICE Project Idioms Apply${dryRun ? " (Dry Run)" : ""}: ${path.relative(process.cwd(), targetDir) || "."} ===`,
          );
          console.log(`Synthesized Idioms:  ${idiomCount}`);
          console.log(`Net Token Savings:   ${tokenSavings} tokens`);
          console.log(`Files Modified:      ${filesCount}`);
          if (!dryRun) {
            console.log(`✔ Updated aice.config.json.`);
          }
        } else if (action === "expand") {
          const res = expandProjectIdiomsInDirectory(targetDir);
          const rootDir = findProjectRoot(targetDir);
          const configPath = path.join(rootDir, "aice.config.json");
          if (fs.existsSync(configPath)) {
            try {
              const raw = JSON.parse(fs.readFileSync(configPath, "utf-8"));
              delete raw.idioms;
              for (const legacyKey of [
                "mode",
                "sourceDir",
                "outDir",
                "targetLanguage",
                "isolated",
                "watermark",
              ]) {
                delete raw[legacyKey];
              }
              fs.writeFileSync(configPath, `${JSON.stringify(raw, null, 2)}\n`, "utf-8");
            } catch {
              // ignore
            }
          }
          const idiomsJsonPath = path.join(rootDir, ".aice-idioms.json");
          if (fs.existsSync(idiomsJsonPath)) {
            try {
              fs.writeFileSync(
                idiomsJsonPath,
                `${JSON.stringify({ idioms: {} }, null, 2)}\n`,
                "utf-8",
              );
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
            `\n=== AICE Project Idioms Expand: ${path.relative(process.cwd(), targetDir) || "."} ===`,
          );
          console.log(`Files Expanded:      ${count}`);
          console.log(
            `✔ All project idioms inlined back into standard code and idioms cleared from config.`,
          );
        } else if (action === "list") {
          const rootDir = findProjectRoot(targetDir);
          const config = loadProjectConfig(rootDir);
          const idioms = config.idioms ?? {};

          if (isJson) {
            console.log(JSON.stringify(idioms, null, 2));
            return;
          }

          console.log(
            `\n=== Active Project Idioms: ${path.relative(process.cwd(), targetDir) || "."} ===`,
          );
          console.log(
            `Idioms Status: ${isProjectIdiomsEnabled(config) ? "ON (enabled)" : "OFF (disabled)"}`,
          );
          const count = Object.keys(idioms).length;
          console.log(`Total Idioms: ${count}`);
          if (count === 0) {
            console.log(
              "No idioms configured. Run `aice idioms scan` or `aice idioms apply` to discover idioms.",
            );
          } else {
            for (const [name, def] of Object.entries(idioms)) {
              console.log(`\n- $${name.replace(/^\$/, "")} (${def.kind}):`);
              if (def.description) {
                console.log(`  Description: ${def.description}`);
              }
              console.log(`  Occurrences: ${def.occurrences}`);
              console.log(`  Net Savings: ${def.netTokenSavings} tokens`);
              console.log(`  Template:    ${def.templateAice.trim()}`);
            }
          }
        } else {
          console.error(
            `❌ Unknown idioms action: '${action}'. Supported actions: scan | apply | expand | list | on | off | read | update`,
          );
          process.exit(1);
        }
      } catch (err: unknown) {
        console.error(
          `❌ Error in aice idioms: ${err instanceof Error ? err.message : String(err)}`,
        );
        process.exit(1);
      }
    },
  );

// Command: enable [dir]
program
  .command("enable [dir]")
  .description('Enable AICE for a project in aice.config.json ("enabled": true)')
  .option("--json", "Output updated project configuration as JSON")
  .action((dirArg: string | undefined, options: { json?: boolean }) => {
    try {
      const targetDir = path.resolve(process.cwd(), dirArg ?? ".");
      const projectRoot = findProjectRoot(targetDir);
      const updated = setProjectAiceEnabled(projectRoot, true);
      if (options.json) {
        console.log(
          JSON.stringify(
            {
              projectRoot,
              enabled: isProjectAiceEnabled(updated),
              idiomsEnabled: isProjectIdiomsEnabled(updated),
              idiomsCount: Object.keys(updated.idioms ?? {}).length,
            },
            null,
            2,
          ),
        );
        return;
      }
      console.log(
        `✔ AICE ENABLED ("enabled": true) in ${path.join(path.relative(process.cwd(), projectRoot) || ".", "aice.config.json")}`,
      );
    } catch (err: unknown) {
      console.error(`❌ Error enabling AICE: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

// Command: disable [dir]
program
  .command("disable [dir]")
  .description('Disable AICE for a project in aice.config.json ("enabled": false)')
  .option("--json", "Output updated project configuration as JSON")
  .action((dirArg: string | undefined, options: { json?: boolean }) => {
    try {
      const targetDir = path.resolve(process.cwd(), dirArg ?? ".");
      const projectRoot = findProjectRoot(targetDir);
      const updated = setProjectAiceEnabled(projectRoot, false);
      if (options.json) {
        console.log(
          JSON.stringify(
            {
              projectRoot,
              enabled: isProjectAiceEnabled(updated),
              idiomsEnabled: isProjectIdiomsEnabled(updated),
              idiomsCount: Object.keys(updated.idioms ?? {}).length,
            },
            null,
            2,
          ),
        );
        return;
      }
      console.log(
        `✔ AICE DISABLED ("enabled": false) in ${path.join(path.relative(process.cwd(), projectRoot) || ".", "aice.config.json")}`,
      );
    } catch (err: unknown) {
      console.error(`❌ Error disabling AICE: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

// Command: config [dir]
program
  .command("config [dir]")
  .description("Inspect or toggle project-level AICE and $idioms configuration in aice.config.json")
  .option("--enable", 'Set "enabled": true in aice.config.json')
  .option("--disable", 'Set "enabled": false in aice.config.json')
  .option("--idioms-on", 'Set "idiomsEnabled": true in aice.config.json')
  .option("--idioms-off", 'Set "idiomsEnabled": false in aice.config.json')
  .option("--json", "Output project configuration status in JSON format")
  .action(
    (
      dirArg: string | undefined,
      options: {
        enable?: boolean;
        disable?: boolean;
        idiomsOn?: boolean;
        idiomsOff?: boolean;
        json?: boolean;
      },
    ) => {
      try {
        const targetDir = path.resolve(process.cwd(), dirArg ?? ".");
        const projectRoot = findProjectRoot(targetDir);
        let config = loadProjectConfig(projectRoot);

        if (options.enable) {
          config = setProjectAiceEnabled(projectRoot, true);
        } else if (options.disable) {
          config = setProjectAiceEnabled(projectRoot, false);
        }

        if (options.idiomsOn) {
          config = setProjectIdiomsEnabled(projectRoot, true);
        } else if (options.idiomsOff) {
          config = setProjectIdiomsEnabled(projectRoot, false);
        }

        const enabled = isProjectAiceEnabled(config);
        const idiomsEnabled = isProjectIdiomsEnabled(config);
        const idiomsCount = Object.keys(config.idioms ?? {}).length;

        if (options.json) {
          console.log(
            JSON.stringify(
              {
                projectRoot,
                enabled,
                idiomsEnabled,
                idiomsCount,
              },
              null,
              2,
            ),
          );
          return;
        }

        console.log(`\n=== AICE Project Config: ${projectRoot} ===`);
        console.log(`  AICE Status:    ${enabled ? "ENABLED" : "DISABLED (opt-out)"}`);
        console.log(`  Idioms Status:  ${idiomsEnabled ? "ENABLED" : "DISABLED"}`);
        console.log(`  Active Idioms:  ${idiomsCount}`);
      } catch (err: unknown) {
        console.error(
          `❌ Error reading project config: ${err instanceof Error ? err.message : String(err)}`,
        );
        process.exit(1);
      }
    },
  );

// Command: agents [action]
program
  .command("agents [action]")
  .description(
    "Auto-integrate or inspect global AICE MCP server & system prompt across Linux CLI coding agents (claude, agy/gemini, codex, opencode, aider, goose, cursor)",
  )
  .option("--all", "Configure all supported CLI agent paths even if binary is not yet installed")
  .option("-a, --agent <name>", "Target a specific CLI agent (e.g. claude, gemini, codex)")
  .option("--json", "Output agent integration status in JSON format")
  .action(
    (actionArg: string | undefined, options: { all?: boolean; agent?: string; json?: boolean }) => {
      try {
        const action = (actionArg ?? "status").toLowerCase();
        if (action === "setup" || action === "install") {
          const statuses = setupAgents({
            all: Boolean(options.all),
            agent: options.agent,
          });
          if (options.json) {
            console.log(JSON.stringify(statuses, null, 2));
            return;
          }
          console.log(formatAgentsStatusTable(statuses));
          const configuredCount = statuses.agents.filter(
            (s) => s.mcpConfigured || s.promptConfigured,
          ).length;
          console.log(
            `\n✔ AICE global CLI agent integration complete (${configuredCount} agent(s) active).`,
          );
          return;
        }

        if (action === "status" || action === "list") {
          const statuses = getAgentsStatus({
            agent: options.agent,
          });
          if (options.json) {
            console.log(JSON.stringify(statuses, null, 2));
            return;
          }
          console.log(formatAgentsStatusTable(statuses));
          return;
        }

        if (action === "remove" || action === "uninstall") {
          const statuses = removeAgents({
            agent: options.agent,
          });
          if (options.json) {
            console.log(JSON.stringify(statuses, null, 2));
            return;
          }
          console.log(formatAgentsStatusTable(statuses));
          console.log(
            "\n✔ Stripped AICE MCP entries and system directive blocks cleanly without losing user settings.",
          );
          return;
        }

        console.error(
          `❌ Unknown agents action: '${action}'. Supported actions: setup | status | remove`,
        );
        process.exit(1);
      } catch (err: unknown) {
        console.error(
          `❌ Error in aice agents: ${err instanceof Error ? err.message : String(err)}`,
        );
        process.exit(1);
      }
    },
  );

async function promptLine(question: string): Promise<string> {
  if (!process.stdin.isTTY) return "";
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

// Command: gain [project]
program
  .command("gain [project]")
  .aliases(["gains", "stats"])
  .description(
    "100% honest BPE token-savings telemetry dashboard (global overview & per-project drill-down)",
  )
  .option("-p, --project <pathOrName>", "Filter or drill down to a specific project")
  .option("--unique", "Deduplicate repeated identical operations by contentHash")
  .option("--all", "Include all cumulative operations (default)")
  .option("-i, --interactive", "Interactively select a project to drill down in TTY")
  .option("--json", "Emit full structured JSON telemetry report")
  .option("--reset", "Clear telemetry history")
  .option("-y, --yes", "Auto-confirm telemetry history reset")
  .action(
    async (
      projectArg: string | undefined,
      options: {
        project?: string;
        unique?: boolean;
        all?: boolean;
        interactive?: boolean;
        json?: boolean;
        reset?: boolean;
        yes?: boolean;
      },
    ) => {
      try {
        if (options.reset) {
          if (!options.yes && process.stdin.isTTY) {
            const ans = await promptLine("Clear all AICE telemetry history? [y/N]: ");
            if (!/^y(es)?$/i.test(ans)) {
              console.log("Aborted telemetry reset.");
              return;
            }
          }
          const cleared = resetTelemetryHistory();
          if (options.json) {
            console.log(
              JSON.stringify(
                {
                  reset: true,
                  path: cleared.telemetryPath,
                  deletedCount: cleared.deletedCount,
                },
                null,
                2,
              ),
            );
          } else {
            console.log(
              `✔ Reset AICE telemetry ledger (${cleared.telemetryPath}, removed ${cleared.deletedCount} record(s))`,
            );
          }
          return;
        }

        const unique = Boolean(options.unique && !options.all);
        const requestedProject = options.project ?? projectArg;
        const isInteractivePick =
          Boolean(options.interactive) ||
          requestedProject === "select" ||
          requestedProject === "pick";

        const effectiveProjectQuery = isInteractivePick ? undefined : requestedProject;

        const report = buildGainReport({
          unique,
          project: effectiveProjectQuery,
        });

        if (options.json) {
          console.log(
            JSON.stringify(
              effectiveProjectQuery && report.projectDetail
                ? {
                    unique: report.unique,
                    telemetryPath: report.telemetryPath,
                    project: report.projectDetail,
                  }
                : report,
              null,
              2,
            ),
          );
          return;
        }

        if (effectiveProjectQuery) {
          if (!report.projectDetail || report.projectDetail.summary.totalCalls === 0) {
            console.log(`No recorded AICE telemetry found for project '${effectiveProjectQuery}'.`);
            return;
          }
          console.log(formatProjectGainDetail(report.projectDetail));
          return;
        }

        console.log(formatGlobalGainDashboard(report));

        if (isInteractivePick && process.stdin.isTTY && report.projects.length > 0) {
          const choice = await promptLine(
            `Select a project [1-${report.projects.length}] to drill down (or press Enter to exit): `,
          );
          if (choice) {
            const idx = Number.parseInt(choice, 10);
            const selected =
              !Number.isNaN(idx) && idx >= 1 && idx <= report.projects.length
                ? report.projects[idx - 1]
                : report.projects.find(
                    (p) =>
                      p.projectName.toLowerCase() === choice.toLowerCase() ||
                      p.projectRoot === choice,
                  );
            if (selected) {
              const detailReport = buildGainReport({
                unique,
                project: selected.projectRoot,
              });
              if (detailReport.projectDetail) {
                console.log(formatProjectGainDetail(detailReport.projectDetail));
              }
            }
          }
        }
      } catch (err: unknown) {
        console.error(`❌ Error in aice gain: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      }
    },
  );

// Command: analyze [project]
program
  .command("analyze [project]")
  .description(
    "Post-session project analyzer (scans AICE telemetry, agent session transcripts, token usage & friction audit)",
  )
  .option("-p, --project <pathOrName>", "Target project directory or name (defaults to cwd)")
  .option("--transcripts-dir <dir>", "Optional custom agent transcripts directory")
  .option("--json", "Emit structured JSON analysis report")
  .action(
    (
      projectArg: string | undefined,
      options: {
        project?: string;
        transcriptsDir?: string;
        json?: boolean;
      },
    ) => {
      try {
        const report = analyzeProject({
          project: options.project ?? projectArg,
          transcriptsDir: options.transcriptsDir,
        });
        if (options.json) {
          console.log(JSON.stringify(report, null, 2));
          return;
        }
        console.log(formatAnalyzeReport(report));
      } catch (err: unknown) {
        console.error(
          `❌ Error in aice analyze: ${err instanceof Error ? err.message : String(err)}`,
        );
        process.exit(1);
      }
    },
  );

program.addHelpText(
  "after",
  `
================================================================================
AICE ON-THE-FLY AI CONTEXT ENGINE & MULTI-FILE IDIOM CLI WORKFLOW
================================================================================

Step 1: On-the-Fly AST Discovery & Context Compression (Zero .aice Files on Disk)
  • Outline AST skeleton (85-90% token reduction for rapid discovery):
      aice outline src/
  • 1-turn bounded context pack (auto-decompiles native files & collapses $idioms):
      aice context src/app.ts -s myFunction
  • Model Context Protocol stdio server & global CLI agent setup:
      aice mcp
      aice agents setup
      aice agents status

Step 2: Greenfield Creation & Surgical In-Place AST Mutation
  • Create greenfield native files from compact AICE + $idioms (40-75% token reduction):
      aice create src/app.ts -c "pub fn add(a: int, b: int) -> int = a + b"
      aice create --batch files.json
  • Forgiving surgical in-place AST mutation (accepts AICE, $idioms, or native syntax):
      aice splice src/app.ts -s oldFunc -c "fn oldFunc() = 42"
      aice splice --batch edits.json
  • Semantic AST diff & unified diff patching:
      aice diff src/old.ts src/new.ts --ast
      aice patch src/app.ts changes.patch

Step 3: Smart Multi-File Idiom Engine ($idiom), Config & Honest Telemetry
  • Mine recurring AST idioms across native files (cached in .aice-cache/idioms.json):
      aice idioms scan src/
  • Toggle AICE or $idioms on/off per project in aice.config.json:
      aice enable / aice disable
      aice idioms on / aice idioms off
  • Multi-file idiom read & smart atomic refactor:
      aice idioms read '$guard'
      aice idioms update '$guard' -c "if not this.canPlay() or this.isMuted: ret"
  • View 100% honest BPE token-savings telemetry, post-session analysis & benchmarks:
      aice gain [project]
      aice analyze [project]
      aice tokens .
      aice benchmark

Author: @forart82 (https://github.com/forart82/aice) | License: Apache-2.0
`,
);

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
    (process.argv[1].endsWith("/bin/aice.ts") ||
      process.argv[1].endsWith("/bin/aice.mjs") ||
      process.argv[1].endsWith("/bin/aice.js") ||
      process.argv[1].endsWith("/bin/aice") ||
      process.argv[1].endsWith("/aice") ||
      process.argv[1] === "aice") &&
      !process.argv[1].includes("test") &&
      !process.argv[1].includes("vitest"),
  );
};

if (isDirectCliRun()) {
  program.parse(process.argv);
}
