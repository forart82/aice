#!/usr/bin/env node
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * AICE CLI: On-the-Fly AI Context Engine & Multi-File Idiom Tool.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as readline from "node:readline";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import {
  AICE_DISABLED_MESSAGE,
  type AiceProjectConfig,
  findProjectRoot,
  isProjectAiceEnabled,
  isProjectIdiomsEnabled,
  isSameOrDescendant,
  KNOWN_TARGET_EXTENSIONS,
  loadProjectConfig,
  resolvePathTargets,
  resolveTargetOutputPathForConfig,
  scanDirectoryFiles,
  setProjectAiceEnabled,
  setProjectIdiomsEnabled,
} from "../src/config/index.js";
import type { TargetLanguage } from "../src/emitters/index.js";
import type {
  BatchCreateItem,
  BatchSpliceItem,
  ContextOptions,
  DiffOptions,
  FmtOptions,
  OutlineOptions,
  PatchOptions,
  SpliceOptions,
} from "../src/tools/index.js";
import { AICE_VERSION } from "../src/version.js";

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

function resolveCliProjectRoot(targetPath: string): string {
  const cwd = path.resolve(process.cwd());
  const resolvedPath = path.resolve(cwd, targetPath);
  let startDir = resolvedPath;
  if (fs.existsSync(resolvedPath)) {
    try {
      if (!fs.statSync(resolvedPath).isDirectory()) {
        startDir = path.dirname(resolvedPath);
      }
    } catch {
      startDir = path.dirname(resolvedPath);
    }
  } else {
    startDir = path.dirname(resolvedPath);
  }
  const fallback = isSameOrDescendant(cwd, resolvedPath) ? cwd : startDir;
  const rawRoot = findProjectRoot(startDir, fallback);
  return isSameOrDescendant(cwd, resolvedPath) && !isSameOrDescendant(cwd, rawRoot) ? cwd : rawRoot;
}

function resolveExplicitOrPolymorphicTarget(targetPath: string | undefined): {
  resolvedPath: string;
  projectRoot: string;
  config: AiceProjectConfig;
} {
  if (targetPath !== undefined && targetPath.trim().length > 0) {
    const cwd = path.resolve(process.cwd());
    const resolvedPath = path.resolve(cwd, targetPath.trim());
    const projectRoot = resolveCliProjectRoot(resolvedPath);
    const config = loadProjectConfig(projectRoot);
    return { resolvedPath, projectRoot, config };
  }
  const resolved = resolvePathTargets(undefined, { includeTargets: true });
  return {
    resolvedPath: resolved.resolvedPath,
    projectRoot: resolved.projectRoot,
    config: resolved.config,
  };
}

/**
 * Executes polymorphic compilation across single file, directory, or omitted target.
 */
export async function executeCompile(
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
): Promise<void> {
  const [
    { parseWithTrivia },
    { detectTargetFromPath, emitTarget },
    { expandModuleIdioms },
    { TypeChecker },
    { attemptSelfRepair, buildReportFromError, formatDiagnosticText },
  ] = await Promise.all([
    import("../src/core/parser.js"),
    import("../src/emitters/index.js"),
    import("../src/idioms/index.js"),
    import("../src/typechecker/checker.js"),
    import("../src/typechecker/diagnostics.js"),
  ]);
  try {
    const resolved = resolvePathTargets(targetArg);

    if (resolved.isSingleFile) {
      const file = resolved.resolvedPath;
      if (!fs.existsSync(file)) {
        console.error(`❌ Error: Source file not found: ${targetArg ?? file}`);
        process.exit(1);
      }

      const projectRoot = resolveCliProjectRoot(file);
      const config = loadProjectConfig(projectRoot);
      const projectConfig = config;
      if (!isProjectAiceEnabled(projectConfig)) {
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
    async (
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
      await executeCompile(target, options);
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
    async (
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
      await executeCompile(dir, options);
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
          const { formatParitySummaryJson, formatParitySummaryTerminal, runParityGate } =
            await import("../src/tools/parity-gate.js");
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
      const [
        { parse },
        { expandModuleIdioms },
        { TypeChecker },
        { attemptSelfRepair, buildReportFromError, formatDiagnosticJson, formatDiagnosticText },
      ] = await Promise.all([
        import("../src/core/parser.js"),
        import("../src/idioms/index.js"),
        import("../src/typechecker/checker.js"),
        import("../src/typechecker/diagnostics.js"),
      ]);
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
        const projectConfig = loadProjectConfig(resolveCliProjectRoot(fullPath));
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
  .action(async (file: string, options: { dryRun?: boolean; json?: boolean }) => {
    try {
      const fullPath = path.resolve(process.cwd(), file);
      if (!fs.existsSync(fullPath)) {
        console.error(`❌ Error: Source file not found: ${file}`);
        process.exit(1);
      }

      const { attemptSelfRepair, formatDiagnosticText } = await import(
        "../src/typechecker/diagnostics.js"
      );
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
    "Decompile a target language file across 33 supported extensions into an .aice representation",
  )
  .argument("<file>", "Path to target source file")
  .option("-o, --out <path>", "Output .aice file path")
  .option("--no-idioms", "Temporarily disable project idioms")
  .action(async (file: string, options: { out?: string; target?: string; idioms?: boolean }) => {
    try {
      const fullPath = path.resolve(process.cwd(), file);
      if (!fs.existsSync(fullPath)) {
        console.error(`❌ Error: Source file not found: ${file}`);
        process.exit(1);
      }

      const projectRoot = resolveCliProjectRoot(fullPath);
      const projectConfig = loadProjectConfig(projectRoot);
      if (!isProjectAiceEnabled(projectConfig)) {
        console.error(`❌ ${AICE_DISABLED_MESSAGE}`);
        process.exit(1);
      }

      const [{ decompile }, { detectTargetFromPath }] = await Promise.all([
        import("../src/decompiler/index.js"),
        import("../src/emitters/index.js"),
      ]);
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
  .action(async (file: string, options: { target?: string }) => {
    try {
      const fullPath = path.resolve(process.cwd(), file);
      if (!fs.existsSync(fullPath)) {
        console.error(`❌ Error: Source file not found: ${file}`);
        process.exit(1);
      }

      const projectRoot = resolveCliProjectRoot(fullPath);
      const projectConfig = loadProjectConfig(projectRoot);
      if (!isProjectAiceEnabled(projectConfig)) {
        console.error(`❌ ${AICE_DISABLED_MESSAGE}`);
        process.exit(1);
      }

      const [{ executeRoundtrip }, { detectTargetFromPath }] = await Promise.all([
        import("../src/decompiler/index.js"),
        import("../src/emitters/index.js"),
      ]);
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
  .option("--generate-schemas [dir]", "Generate Antigravity MCP tool JSON schema files")
  .action(async (options: { generateSchemas?: string | boolean }) => {
    if (options.generateSchemas) {
      const { AICE_MCP_TOOLS, AICE_WRITE_TOOL, AICE_VERSION } = await import(
        "../src/mcp/server.js"
      );
      const os = await import("node:os");
      const homeDir = process.env.AICE_AGENT_HOME
        ? path.resolve(process.env.AICE_AGENT_HOME)
        : os.homedir();
      const targetDir =
        typeof options.generateSchemas === "string"
          ? path.resolve(options.generateSchemas)
          : path.join(homeDir, ".gemini", "antigravity-cli", "mcp", "aice");
      fs.mkdirSync(targetDir, { recursive: true });
      for (const tool of AICE_MCP_TOOLS) {
        fs.writeFileSync(
          path.join(targetDir, `${tool.name}.json`),
          JSON.stringify({ ...tool, version: AICE_VERSION }, null, 2) + "\n",
          "utf-8",
        );
      }
      if (AICE_WRITE_TOOL) {
        fs.writeFileSync(
          path.join(targetDir, `${AICE_WRITE_TOOL.name}.json`),
          JSON.stringify({ ...AICE_WRITE_TOOL, version: AICE_VERSION }, null, 2) + "\n",
          "utf-8",
        );
      }
      fs.writeFileSync(
        path.join(targetDir, "tools.json"),
        JSON.stringify({ server: "aice", version: AICE_VERSION, tools: AICE_MCP_TOOLS }, null, 2) +
          "\n",
        "utf-8",
      );
      console.log(`✔ Generated ${AICE_MCP_TOOLS.length} MCP tool schema files in ${targetDir}`);
      return;
    }
    const { AiceMcpServer } = await import("../src/mcp/server.js");
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
        const projectRoot = resolveCliProjectRoot(fullTarget);
        const projectConfig = loadProjectConfig(projectRoot);
        if (!isProjectAiceEnabled(projectConfig)) {
          console.error(`❌ ${AICE_DISABLED_MESSAGE}`);
          process.exit(1);
        }
        const isTTY = Boolean(process.stdout.isTTY && !process.env.NO_COLOR);
        const terminalWidth = process.stdout.columns || 80;

        const {
          auditTokenomics,
          formatProjectsMarkdownTable,
          formatProjectsTerminalTable,
          formatSingleFileSummary,
          formatTokenomicsMarkdownTable,
          formatTokenomicsTerminalTable,
        } = await import("../src/tokenomics/index.js");

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
    "Semantic skeletonization: generate token-dense AST skeleton outline across 33 extensions (85-90% token reduction)",
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
        const { outlinePath } = await import("../src/tools/outline.js");
        if (rawTargets.length === 1) {
          const targetPath = rawTargets[0];
          const resolved = resolveExplicitOrPolymorphicTarget(targetPath);
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
        const missingOutlineTargets: string[] = [];
        for (const targetPath of rawTargets) {
          const resolved = resolveExplicitOrPolymorphicTarget(targetPath);
          const outlineTarget = resolved.resolvedPath;
          if (!fs.existsSync(outlineTarget)) {
            missingOutlineTargets.push(targetPath ?? outlineTarget);
            continue;
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
        if (resolvedTargets.length === 0) {
          console.error(`❌ Error: Path not found: ${missingOutlineTargets.join(", ")}`);
          process.exit(1);
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
                if (options.stats && res.stats) {
                  console.log(
                    `\n[Tokens: ${res.stats.originalTokens} -> ${res.stats.outlineTokens} (-${res.stats.savingsPct}%)]`,
                  );
                }
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
                  if (options.stats && res.stats) {
                    console.log(
                      `\n[Tokens: ${res.stats.originalTokens} -> ${res.stats.outlineTokens} (-${res.stats.savingsPct}%)]`,
                    );
                  }
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
                if (options.stats && result.stats) {
                  console.log(
                    `\n[Tokens: ${result.stats.originalTokens} -> ${result.stats.outlineTokens} (-${result.stats.savingsPct}%)]`,
                  );
                }
              }
            }
          }
        }

        if (missingOutlineTargets.length > 0) {
          for (const missingPath of missingOutlineTargets) {
            if (options.json) {
              allJsonItems.push({ file: missingPath, error: "not found", symbols: [] });
            } else {
              console.log(`\n// not found: ${missingPath}`);
            }
          }
        }

        if (options.json) {
          console.log(JSON.stringify(allJsonItems, null, 2));
        } else if (options.stats) {
          const savings = Math.max(0, totalOrig - totalOutline);
          const savingsPct = totalOrig > 0 ? ((savings / totalOrig) * 100).toFixed(1) : "0.0";
          console.log(`\n📊 Aggregate Token Reduction Metrics (${totalFilesCount} files):`);
          console.log(`  Original tokens: ${totalOrig.toLocaleString()}`);
          console.log(`  Outline tokens:  ${totalOutline.toLocaleString()}`);
          console.log(`  Token savings:   ${savings.toLocaleString()} tokens (${savingsPct}%)`);
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        const { recordTelemetryError } = await import("../src/telemetry/index.js");
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

async function readStdin(explicit = false): Promise<string> {
  if (process.stdin.isTTY) return "";
  try {
    const stat = fs.fstatSync(0);
    if (stat.isFile()) {
      return fs.readFileSync(0, "utf-8");
    }
    if (!explicit && !stat.isFIFO() && !stat.isSocket()) {
      return "";
    }
  } catch {
    if (!explicit) return "";
  }
  return new Promise((resolve) => {
    let data = "";
    let settled = false;
    let idleTimer: ReturnType<typeof setTimeout> | undefined;

    const finish = (result: string) => {
      if (settled) return;
      settled = true;
      if (idleTimer !== undefined) {
        clearTimeout(idleTimer);
      }
      process.stdin.removeListener("data", onData);
      process.stdin.removeListener("end", onEnd);
      process.stdin.removeListener("error", onError);
      process.stdin.pause();
      resolve(result);
    };

    const onData = (chunk: string | Buffer) => {
      if (idleTimer !== undefined) {
        clearTimeout(idleTimer);
        idleTimer = undefined;
      }
      data += typeof chunk === "string" ? chunk : chunk.toString("utf-8");
    };
    const onEnd = () => finish(data);
    const onError = () => finish("");

    if (!explicit) {
      idleTimer = setTimeout(() => finish(data), 50);
      idleTimer.unref?.();
    }

    process.stdin.setEncoding("utf-8");
    process.stdin.on("data", onData);
    process.stdin.on("end", onEnd);
    process.stdin.on("error", onError);
    process.stdin.resume();
  });
}
// Command: splice [path] (alias: write)
program
  .command("splice")
  .alias("write")
  .description(
    "Unified write, auto-create, full-overwrite, and AST surgical updates with 90% token reduction",
  )
  .argument(
    "[path]",
    "Path to target file or inline file:selector (optional when --batch, --stdin stream, or -f is provided)",
  )
  .argument(
    "[symbol]",
    "Target symbol selector (optional shorthand for -s/--symbol; omit to create or overwrite file)",
  )
  .option("-f, --file <path>", "Path to source file")
  .option(
    "-s, --symbol <symbol>",
    "Target selector: Class.method, test title/ID (TC-MENU-001), Markdown Heading, Lstart-Lend, eof, imports, or :overwrite",
  )
  .option("-c, --code <code>", "Replacement or full-file AICE/native payload")
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
  .option("--overwrite", "Allow full-file replacement (including empty truncation)")
  .option("--force", "Force write/splice even when overwriting existing files")
  .option(
    "--idiom <spec>",
    "Define an inline idiom (e.g. '$clamp($0,$1,$2)=Math.min(Math.max($0,$1),$2)'), repeatable",
    (val: string, prev: string[]) => [...prev, val],
    [] as string[],
  )
  .option("--idioms", "Force-enable project idioms")
  .option("--no-idioms", "Temporarily disable project idioms")
  .option("--in-place", "Apply splice mutation directly to the file on disk (default)")
  .option("--dry-run", "Output result without modifying file")
  .option("--diff", "Display unified diff")
  .option("--json", "Output machine-readable JSON result")
  .option("--compile", "Automatically recompile target after splice")
  .option(
    "--no-preserve-docs",
    "Do not preserve leading JSDoc/docstrings when omitted in replacement",
  )
  .addHelpText(
    "after",
    `
Examples:
  • Multi-block heredoc stream across 33 extensions (auto-creates new files + surgical splices in 1 call):
      aice splice --stdin << 'EOF'
      === src/new_helper.ts ===
      export const BONUS_MULTIPLIER = 2;
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
        overwrite?: boolean;
        force?: boolean;
        idiom?: string[];
        idioms?: boolean;
        dryRun?: boolean;
        diff?: boolean;
        json?: boolean;
        compile?: boolean;
        preserveDocs?: boolean;
      },
    ) => {
      try {
        const { parseMultiBlockSpliceStream, splice, spliceBatch, splitInlineFileSelector } =
          await import("../src/tools/splice.js");

        const inlineIdiomList =
          options.idiom && options.idiom.length > 0 ? options.idiom : undefined;

        const executeBatchSpliceAndIdioms = async (
          spliceItems: BatchSpliceItem[],
          idiomItems: Array<Record<string, unknown>> = [],
        ): Promise<void> => {
          const firstRawFp =
            spliceItems[0]?.filePath || spliceItems[0]?.file || spliceItems[0]?.path || "";
          const firstCleanFp = firstRawFp
            ? splitInlineFileSelector(firstRawFp, process.cwd()).filePath
            : "";
          const batchProjectRoot = firstCleanFp
            ? resolveCliProjectRoot(firstCleanFp)
            : findProjectRoot(process.cwd());
          const batchProjectConfig = loadProjectConfig(batchProjectRoot);
          if (!isProjectAiceEnabled(batchProjectConfig)) {
            console.error(`❌ ${AICE_DISABLED_MESSAGE}`);
            process.exit(1);
          }
          const batchEffectiveIdioms = isProjectIdiomsEnabled(batchProjectConfig, options.idioms);

          const combinedInlineIdioms = [...(inlineIdiomList ?? [])];
          let idiomSummary:
            | { updatedIdioms: number; totalOcc: number; modifiedFiles: number }
            | undefined;
          if (idiomItems.length > 0) {
            const { updateProjectIdiom } = await import("../src/idioms/index.js");
            let totalOcc = 0;
            const modFilesSet = new Set<string>();
            for (const entry of idiomItems) {
              const rawIdName = String(entry.name || entry.idiom || "").trim();
              const idCode = String(
                entry.code ??
                  entry.newTemplate ??
                  entry.newTemplateAice ??
                  entry.template ??
                  entry.templateAice ??
                  entry.aice ??
                  entry.body ??
                  entry.content ??
                  entry.replacement ??
                  "",
              );
              const paramsStr = Array.isArray(entry.params)
                ? entry.params
                    .map((p) =>
                      typeof p === "string"
                        ? p.trim()
                        : String((p as Record<string, unknown>)?.name ?? "").trim(),
                    )
                    .filter(Boolean)
                    .join(",")
                : typeof entry.params === "string"
                  ? entry.params.trim()
                  : undefined;

              if (rawIdName && idCode) {
                const inlineSpec = rawIdName.includes("(")
                  ? `${rawIdName}=${idCode}`
                  : paramsStr
                    ? `${rawIdName}(${paramsStr})=${idCode}`
                    : `${rawIdName}=${idCode}`;
                combinedInlineIdioms.push(inlineSpec);

                const cleanBaseName = rawIdName.replace(/\([^)]*\)$/, "").trim();
                const normName = cleanBaseName.startsWith("$")
                  ? cleanBaseName
                  : `$${cleanBaseName}`;
                const bareName = normName.slice(1);
                const existsInProject =
                  Boolean(batchProjectConfig.idioms) &&
                  (Object.hasOwn(batchProjectConfig.idioms!, normName) ||
                    Object.hasOwn(batchProjectConfig.idioms!, bareName));

                if (existsInProject) {
                  const r = await updateProjectIdiom(batchProjectRoot, normName, idCode, {
                    dryRun: Boolean(options.dryRun),
                    params: paramsStr,
                  });
                  totalOcc += r.updatedOccurrences;
                  for (const mf of r.modifiedFiles) modFilesSet.add(mf);
                }
              }
            }
            idiomSummary = {
              updatedIdioms: idiomItems.length,
              totalOcc,
              modifiedFiles: modFilesSet.size,
            };
          }

          let batchRes: Awaited<ReturnType<typeof spliceBatch>> | undefined;
          if (spliceItems.length > 0) {
            batchRes = await spliceBatch(spliceItems, {
              dryRun: options.dryRun,
              compile: options.compile,
              idioms: batchEffectiveIdioms,
              inlineIdioms: combinedInlineIdioms.length > 0 ? combinedInlineIdioms : undefined,
              overwrite: Boolean(options.overwrite || options.force),
              force: options.force,
              preserveDocs: options.preserveDocs,
            });
          }

          if (options.json) {
            console.log(
              JSON.stringify(
                idiomSummary
                  ? { ...(batchRes ?? { success: true }), idioms: idiomSummary }
                  : batchRes,
                null,
                2,
              ),
            );
            return;
          }

          if (batchRes) {
            const totalSaved = batchRes.results.reduce((acc, r) => acc + (r.tokensSaved ?? 0), 0);
            const prefix = options.dryRun ? "[Dry Run] ✔" : "✔";
            const itemLabels = batchRes.results
              .slice(0, 6)
              .map((r) => `${path.basename(r.filePath)}${r.symbol ? `:${r.symbol}` : ""}`)
              .join(", ");
            const suffix =
              batchRes.results.length > 6
                ? ` [${itemLabels}, +${batchRes.results.length - 6} more]`
                : itemLabels
                  ? ` [${itemLabels}]`
                  : "";
            console.log(
              `${prefix} Batch spliced ${batchRes.results.length} item(s) across ${batchRes.modifiedFiles.length} file(s) (${totalSaved} tokens saved)${suffix}`,
            );
            if (options.dryRun) {
              for (const r of batchRes.results) {
                console.log(`\n// === ${r.filePath} ===\n${r.modifiedCode}`);
              }
            }
          }
          if (idiomSummary) {
            console.log(
              `✔ Batch updated ${idiomSummary.updatedIdioms} idiom(s): ${idiomSummary.totalOcc} occurrence(s) across ${idiomSummary.modifiedFiles} file(s)`,
            );
          }
        };

        const sanitizeHeredocJson = (src: string): string => {
          let out = "";
          let inStr = false;
          let esc = false;
          for (let i = 0; i < src.length; i++) {
            const ch = src[i];
            if (inStr) {
              if (esc) {
                out += ch;
                esc = false;
              } else if (ch === "\\") {
                out += ch;
                esc = true;
              } else if (ch === '"') {
                out += ch;
                inStr = false;
              } else if (ch === "\n") {
                out += "\\n";
              } else if (ch === "\r") {
                if (src[i + 1] !== "\n") out += "\\r";
              } else if (ch === "\t") {
                out += "\\t";
              } else {
                out += ch;
              }
            } else {
              if (ch === '"') {
                inStr = true;
              }
              out += ch;
            }
          }
          return out.replace(/,(\s*[}\]])/g, "$1");
        };

        const parseJsonBatchEntries = (rawJson: string): Array<Record<string, unknown>> => {
          const rawParts = rawJson.split(/['"]?\s*&&\s*aice\s+idioms?\s+update\s+--batch\s*['"]?/);
          const allEntries: Array<Record<string, unknown>> = [];
          for (const part of rawParts) {
            const trimmedPart = part.trim();
            if (!trimmedPart) continue;
            let parsed: unknown;
            try {
              parsed = JSON.parse(trimmedPart);
            } catch (firstErr) {
              try {
                parsed = JSON.parse(sanitizeHeredocJson(trimmedPart));
              } catch {
                throw firstErr;
              }
            }
            if (Array.isArray(parsed)) {
              allEntries.push(...(parsed as Array<Record<string, unknown>>));
            }
          }
          return allEntries;
        };

        const partitionBatchEntries = (
          allEntries: Array<Record<string, unknown>>,
        ): {
          spliceItems: BatchSpliceItem[];
          idiomItems: Array<Record<string, unknown>>;
        } => {
          const spliceItems = allEntries.filter(
            (e) =>
              typeof e.file === "string" ||
              typeof e.filePath === "string" ||
              typeof e.path === "string",
          ) as unknown as BatchSpliceItem[];
          const idiomItems = allEntries.filter(
            (e) =>
              !e.file &&
              !e.filePath &&
              !e.path &&
              (typeof e.name === "string" || typeof e.idiom === "string"),
          );
          return { spliceItems, idiomItems };
        };

        // Recover when a JSON batch array is passed positionally without `--batch`
        // (e.g. `aice splice --idioms --json '[{"file":"a.ts",...}]'` or `aice splice '[...]'`):
        if (!options.batch && rawTargetPath && rawTargetPath.trimStart().startsWith("[")) {
          options.batch = rawTargetPath;
          rawTargetPath = undefined;
        }

        if (options.batch) {
          let rawJson: string;
          if (options.batch.trim() === "-") {
            rawJson = await readStdin(true);
          } else {
            const batchCandidatePath = path.resolve(process.cwd(), options.batch);
            rawJson =
              fs.existsSync(batchCandidatePath) && fs.statSync(batchCandidatePath).isFile()
                ? fs.readFileSync(batchCandidatePath, "utf-8")
                : options.batch;
          }
          const allEntries = parseJsonBatchEntries(rawJson);
          const { spliceItems, idiomItems } = partitionBatchEntries(allEntries);
          await executeBatchSpliceAndIdioms(spliceItems, idiomItems);
          return;
        }

        // Recover when `-d/--delete` (optional arg) swallowed `<file>` or `<file>:<symbol>`:
        // e.g. `aice splice -s sym --delete file.ts` or `aice splice --delete file.ts:sym` or `aice splice --delete file.ts sym`
        if (typeof options.delete === "string") {
          const delSplit = splitInlineFileSelector(options.delete, process.cwd());
          const delCandFull = path.resolve(process.cwd(), delSplit.filePath);
          if (
            !rawTargetPath &&
            !options.file &&
            (fs.existsSync(delCandFull) || Boolean(delSplit.inlineSelector))
          ) {
            rawTargetPath = delSplit.filePath;
            if (delSplit.inlineSelector && !options.symbol) {
              options.symbol = delSplit.inlineSelector;
            }
            options.delete = true;
          } else if (
            rawTargetPath &&
            !options.file &&
            !fs.existsSync(
              path.resolve(
                process.cwd(),
                splitInlineFileSelector(rawTargetPath, process.cwd()).filePath,
              ),
            ) &&
            fs.existsSync(delCandFull)
          ) {
            if (!options.symbol) {
              options.symbol = rawTargetPath;
            }
            rawTargetPath = delSplit.filePath;
            if (delSplit.inlineSelector && !options.symbol) {
              options.symbol = delSplit.inlineSelector;
            }
            options.delete = true;
          }
        }

        let targetPath = rawTargetPath ?? options.file;
        if (targetPath && targetPath !== "-") {
          const trimmedTarget = targetPath.trim();
          if (!options.symbol && /:+$/.test(trimmedTarget)) {
            console.error(
              `❌ Error: Malformed target '${trimmedTarget}': missing <symbol>, L<start>-L<end>, :overwrite, or :eof after ':'.`,
            );
            process.exit(1);
          }
          const splitTarget = splitInlineFileSelector(targetPath, process.cwd());
          targetPath = splitTarget.filePath;
          if (splitTarget.inlineSelector && !options.symbol) {
            options.symbol = splitTarget.inlineSelector;
          }
        }

        let symbolCameFromPositional = false;
        if (positionalSymbol) {
          if (
            options.symbol &&
            options.code === undefined &&
            options.template === undefined &&
            options.body === undefined &&
            !options.from &&
            !options.stdin &&
            !options.delete &&
            !options.edits
          ) {
            options.code = positionalSymbol;
          } else if (!options.symbol) {
            if (
              targetPath &&
              !fs.existsSync(path.resolve(process.cwd(), targetPath)) &&
              fs.existsSync(path.resolve(process.cwd(), positionalSymbol))
            ) {
              options.symbol = targetPath;
              targetPath = positionalSymbol;
            } else {
              options.symbol = positionalSymbol;
              symbolCameFromPositional = true;
            }
          }
        }

        if (!targetPath || targetPath === "-") {
          const rawCrossStream =
            options.code ??
            options.template ??
            (await readStdin(Boolean(options.stdin || targetPath === "-")));
          if (rawCrossStream && rawCrossStream.trim().length > 0) {
            if (rawCrossStream.trimStart().startsWith("[")) {
              const allEntries = parseJsonBatchEntries(rawCrossStream);
              const { spliceItems, idiomItems } = partitionBatchEntries(allEntries);
              if (spliceItems.length > 0 || idiomItems.length > 0) {
                await executeBatchSpliceAndIdioms(spliceItems, idiomItems);
                return;
              }
            }
            const parsedStream = parseMultiBlockSpliceStream(rawCrossStream);
            if (parsedStream?.batchItems && parsedStream.batchItems.length > 0) {
              await executeBatchSpliceAndIdioms(parsedStream.batchItems);
              return;
            }
          }
          const badHeader = rawCrossStream?.match(/^\s*={3,}\s*([^=\r\n]*?)\s*={3,}/m)?.[1]?.trim();
          const headerDiag = badHeader
            ? ` Malformed or incomplete header '=== ${badHeader} ==='.`
            : "";
          console.error(
            `❌ Error: Must provide <path>, --batch <fileOrJson>, or pipe valid '=== <filePath> ===' / '=== <filePath>:<symbol> ===' blocks via --stdin.${headerDiag}\n` +
              "Valid --stdin heredoc block examples:\n" +
              "  1. Full-file creation / overwrite:\n" +
              "     === src/new_file.ts ===\n" +
              "     export const READY = true;\n" +
              "  2. Symbol replacement:\n" +
              "     === src/file.ts:ClassName.method ===\n" +
              "     public method(): void { ... }\n" +
              "  3. Line-range or AST-scoped hunk splice:\n" +
              "     === src/file.ts:ClassName.method ===\n" +
              "     <<<\n" +
              "     const oldVal = 1;\n" +
              "     ===\n" +
              "     const newVal = 2;\n" +
              "     >>>",
          );
          process.exit(1);
        }

        const fullSpliceTarget = path.resolve(process.cwd(), targetPath);
        const spliceProjectRoot = resolveCliProjectRoot(fullSpliceTarget);
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
          const stdinRaw = await readStdin(true);
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
          code = await readStdin(true);
        }

        if (
          code === undefined &&
          options.body === undefined &&
          !isPrimaryDelete &&
          (!parsedEdits || parsedEdits.length === 0)
        ) {
          const stdinContent = await readStdin(false);
          if (stdinContent && stdinContent.trim().length > 0) {
            code = stdinContent;
          } else if (symbolCameFromPositional && options.symbol) {
            const trimmedPos = options.symbol.trim();
            const withoutClone = trimmedPos.replace(/@clone\s*\([^)]*\)/gi, "");
            const isPositionalCodePayload =
              trimmedPos.includes("\n") ||
              /[;{}]/.test(withoutClone) ||
              /^={3,}\s*[^=]+={3,}/.test(trimmedPos) ||
              /^(?:export\s+|import\s+|from\s+\S+\s+import\s+|pub\s+|fn\s+|async\s+|function\s+|def\s+|class\s+|struct\s+|interface\s+|enum\s+|const\s+|let\s+|var\s+|val\s+|mut\s+|package\s+|using\s+|namespace\s+|#include\b|#pragma\b|<!DOCTYPE\b|<html\b|<div\b|@idiom\b|@fn\b|\^fn\b|@cls\b|\^class\b)/.test(
                trimmedPos,
              );
            if (isPositionalCodePayload) {
              code = options.symbol;
              options.symbol = undefined;
            }
          }
          if (
            code === undefined &&
            options.body === undefined &&
            !isPrimaryDelete &&
            (!parsedEdits || parsedEdits.length === 0) &&
            !(options.symbol && /@clone\b|\(clone\b/i.test(options.symbol))
          ) {
            const symHint = options.symbol ? `:${options.symbol}` : ":<symbol>";
            console.error(
              `❌ Error: Empty or missing splice body for '=== ${targetPath}${symHint} ==='. Must provide --code, --from, --stdin, --body, --delete, or --edits.\n` +
                `Valid heredoc syntax:\n` +
                `  • Full file: aice write ${targetPath} --stdin << 'EOF'\n` +
                `  • Symbol: === ${targetPath}:ClassName.method ===\n` +
                `  • Line range: === ${targetPath}:L10-L12 ===\n` +
                `  • Hunk: === ${targetPath}${symHint} === followed by <<< / === / >>>`,
            );
            process.exit(1);
          }
        }

        if (!options.symbol && (!parsedEdits || parsedEdits.length === 0) && code) {
          const multiStream = parseMultiBlockSpliceStream(code, targetPath);
          if (multiStream?.batchItems && multiStream.batchItems.length > 0) {
            await executeBatchSpliceAndIdioms(multiStream.batchItems);
            return;
          }
          if (multiStream?.singleFileEdits && multiStream.singleFileEdits.length > 0) {
            parsedEdits = multiStream.singleFileEdits;
            code = undefined;
          }
        }

        const primarySymForMsg = options.symbol;
        if (extraDeleteSymbol) {
          if (parsedEdits && parsedEdits.length > 0) {
            parsedEdits = [...parsedEdits, { symbol: extraDeleteSymbol, delete: true }];
          } else {
            parsedEdits = [
              ...(options.symbol
                ? [
                    {
                      symbol: options.symbol,
                      code,
                      body: options.body,
                      insertAfter: options.insertAfter,
                      insertBefore: options.insertBefore,
                    },
                  ]
                : []),
              {
                symbol: extraDeleteSymbol,
                delete: true,
              },
            ];
            options.symbol = undefined;
            code = undefined;
            options.body = undefined;
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
          overwrite: Boolean(options.overwrite || options.force),
          force: options.force,
          inlineIdioms: inlineIdiomList,
          idioms: effectiveSpliceIdioms,
          dryRun: options.dryRun,
          diff: options.diff,
          compile: options.compile,
          preserveDocs: options.preserveDocs,
          projectRoot: spliceProjectRoot,
        };

        const result = await splice(fullSpliceTarget, spliceOpts);

        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
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
          const displaySymbol = extraDeleteSymbol
            ? (primarySymForMsg ?? result.symbol)
            : result.symbol;
          const actionDesc = isPrimaryDelete
            ? `Deleted symbol '${displaySymbol}'`
            : options.insertAfter && !extraDeleteSymbol
              ? `Inserted after '${options.insertAfter}'`
              : options.insertBefore && !extraDeleteSymbol
                ? `Inserted before '${options.insertBefore}'`
                : options.body && !extraDeleteSymbol
                  ? `Spliced body of '${displaySymbol}'`
                  : `Spliced symbol '${displaySymbol}'${extraDeleteSymbol ? ` and deleted '${extraDeleteSymbol}'` : ""}`;
          console.log(`✔ ${actionDesc} in ${targetPath} (${result.tokensSaved ?? 0} tokens saved)`);
          if (options.compile) {
            console.log(`✔ Recompiled target for ${targetPath}`);
          }
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        const errTarget = rawTargetPath ?? options.file ?? options.batch;
        const { recordTelemetryError } = await import("../src/telemetry/index.js");
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
        const { createBatch, createFile, parseMultiFileCreateStream } = await import(
          "../src/tools/create.js"
        );
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
          const batchProjectRoot = firstFp
            ? resolveCliProjectRoot(firstFp)
            : findProjectRoot(process.cwd());
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
            rawInput = await readStdin(
              Boolean(options.stdin || batchArg === "-" || batchArg === true),
            );
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
            const { parseMultiBlockSpliceStream, spliceBatch } = await import(
              "../src/tools/splice.js"
            );
            const spliceStream = parseMultiBlockSpliceStream(rawInput);
            if (spliceStream?.batchItems && spliceStream.batchItems.length > 0) {
              const firstFp = spliceStream.batchItems[0]?.filePath;
              const batchProjectRoot = firstFp
                ? resolveCliProjectRoot(firstFp)
                : findProjectRoot(process.cwd());
              const batchProjectConfig = loadProjectConfig(batchProjectRoot);
              if (!isProjectAiceEnabled(batchProjectConfig)) {
                console.error(`❌ ${AICE_DISABLED_MESSAGE}`);
                process.exit(1);
              }
              const batchEffectiveIdioms = isProjectIdiomsEnabled(
                batchProjectConfig,
                options.idioms,
              );
              const batchRes = await spliceBatch(spliceStream.batchItems, {
                dryRun: options.dryRun,
                idioms: batchEffectiveIdioms,
                inlineIdioms: options.idiom,
                overwrite: Boolean(options.overwrite || options.force),
              });
              if (options.json) {
                console.log(JSON.stringify(batchRes, null, 2));
                return;
              }
              const totalSaved = batchRes.results.reduce((acc, r) => acc + (r.tokensSaved ?? 0), 0);
              console.log(
                `✔ Batch spliced ${batchRes.results.length} item(s) across ${batchRes.modifiedFiles.length} file(s) (${totalSaved} tokens saved)`,
              );
              return;
            }
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
        const createProjectRoot = resolveCliProjectRoot(fullTarget);
        const createProjectConfig = loadProjectConfig(createProjectRoot);
        if (!isProjectAiceEnabled(createProjectConfig)) {
          console.error(`❌ ${AICE_DISABLED_MESSAGE}`);
          process.exit(1);
        }
        const effectiveCreateIdioms = isProjectIdiomsEnabled(createProjectConfig, options.idioms);

        let code = options.code;
        if (code === undefined && !options.from) {
          const stdinContent = await readStdin(Boolean(options.stdin));
          if (stdinContent && stdinContent.trim().length > 0) {
            code = stdinContent;
          } else {
            console.error("❌ Error: Must provide -c/--code, --from <file>, or input via stdin.");
            process.exit(1);
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
        const { recordTelemetryError } = await import("../src/telemetry/index.js");
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
    "Dependency contract packager, symbol/test/heading extractor & /pattern/ search in 1 turn across 33 extensions",
  )
  .argument(
    "[targets...]",
    "Path(s) to target source file(s) or directory (omitted for workspace overview context)",
  )
  .option(
    "-d, --depth <number>",
    "Dependency traversal depth (default: 1, or 0 for line-range/regex fast path)",
    (val) => Number.parseInt(val, 10),
  )
  .option(
    "-s, --symbol <symbol>",
    "Selector: Class.method, test ID (TC-MENU-001), Markdown heading, line range (L180-L240), or regex (/pattern/)",
  )
  .option("--idioms", "Force-enable project idioms")
  .option("--no-idioms", "Temporarily disable project idioms")
  .option("--callers", "Force reverse caller lookup")
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
      const {
        generateContext,
        mergeMultiContextResults,
        parseTargetWithInlineSymbol,
        splitContextTargets,
      } = await import("../src/tools/context.js");
      const expandedTargets: Array<string | undefined> = [];
      if (targetPaths && targetPaths.length > 0) {
        for (const rawT of targetPaths) {
          if (typeof rawT === "string" && /\s+/.test(rawT.trim())) {
            const splitTokens = splitContextTargets(rawT, process.cwd());
            if (splitTokens.length > 1) {
              expandedTargets.push(...splitTokens);
              continue;
            }
          }
          expandedTargets.push(rawT);
        }
      } else {
        expandedTargets.push(undefined);
      }
      const rawTargets = expandedTargets;
      try {
        const results = [];
        const missingContextTargets: string[] = [];
        const multiTargetErrors: unknown[] = [];
        const isMultiTarget = rawTargets.length > 1;
        for (const rawTarget of rawTargets) {
          let targetPath = rawTarget;
          let inlineSymbol: string | undefined;
          if (typeof rawTarget === "string") {
            const parsed = parseTargetWithInlineSymbol(rawTarget, process.cwd());
            targetPath = parsed.targetPath;
            inlineSymbol = parsed.inlineSymbol;
          }
          const resolved = resolveExplicitOrPolymorphicTarget(targetPath);
          if (!isProjectAiceEnabled(resolved.config)) {
            console.error(`❌ ${AICE_DISABLED_MESSAGE}`);
            process.exit(1);
          }
          if (isMultiTarget && !fs.existsSync(resolved.resolvedPath)) {
            missingContextTargets.push(String(targetPath ?? resolved.resolvedPath));
            continue;
          }
          const explicitCallers = process.argv.includes("--callers")
            ? true
            : process.argv.includes("--no-callers") || options.callers === false
              ? false
              : undefined;
          const effectiveSelector = inlineSymbol ?? options.symbol;
          const contextOpts: ContextOptions = {
            depth: options.depth !== undefined ? Number(options.depth) : undefined,
            symbol: effectiveSelector,
            idioms: options.idioms,
            includeCallers: explicitCallers,
            outlineTarget: !!options.outlineTarget,
            maxTokens: options.maxTokens !== undefined ? Number(options.maxTokens) : undefined,
            json: !!options.json,
            stats: !!options.stats,
            projectRoot: resolved.projectRoot,
          };
          try {
            results.push(await generateContext(resolved.resolvedPath, contextOpts));
          } catch (targetErr) {
            if (!isMultiTarget) {
              throw targetErr;
            }
            // When multiple files share `-s "SymA,SymB"`, try matching individual selectors present in this target
            const commaSelectors =
              !inlineSymbol && options.symbol && options.symbol.includes(",")
                ? options.symbol
                    .split(",")
                    .map((s) => s.trim())
                    .filter(Boolean)
                : [];
            let matchedSubset = false;
            if (commaSelectors.length > 1) {
              const subsetResults = [];
              for (const subSel of commaSelectors) {
                try {
                  subsetResults.push(
                    await generateContext(resolved.resolvedPath, {
                      ...contextOpts,
                      symbol: subSel,
                    }),
                  );
                } catch {
                  // selector lives in another target file
                }
              }
              if (subsetResults.length > 0) {
                results.push(
                  subsetResults.length === 1
                    ? subsetResults[0]!
                    : mergeMultiContextResults(subsetResults, {
                        outlineTarget: !!options.outlineTarget,
                      }),
                );
                matchedSubset = true;
              }
            }
            if (!matchedSubset) {
              multiTargetErrors.push(targetErr);
            }
          }
        }

        if (results.length === 0) {
          if (multiTargetErrors.length > 0) {
            throw multiTargetErrors[0];
          }
          if (missingContextTargets.length > 0) {
            throw new Error(`Path not found: ${missingContextTargets.join(", ")}`);
          }
        }

        if (options.json) {
          console.log(JSON.stringify(results.length === 1 ? results[0] : results, null, 2));
        } else if (results.length > 1) {
          const merged = mergeMultiContextResults(results, {
            outlineTarget: !!options.outlineTarget,
          });
          console.log(merged.formattedBundle);
          for (const mp of missingContextTargets) {
            console.log(`// not found: ${mp}`);
          }
          if (options.stats) {
            console.log("\n📊 Context Pack Token Telemetry:");
            console.log(`  Total pack tokens: ${merged.tokenCount?.toLocaleString() ?? 0}`);
            console.log(`  Dependencies:      ${merged.dependencies.length}`);
            console.log(`  Downstream callers:${merged.callers.length}`);
            console.log(`  Target characters: ${merged.targetContent.length.toLocaleString()}`);
          }
        } else {
          for (const result of results) {
            console.log(result.formattedBundle);
            for (const mp of missingContextTargets) {
              console.log(`// not found: ${mp}`);
            }
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
        const { recordTelemetryError } = await import("../src/telemetry/index.js");
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
        const { formatAicePath, formatAiceSource } = await import("../src/tools/fmt.js");
        if (options.stdin) {
          const stdinSource = await readStdin(true);
          const formatted = formatAiceSource(stdinSource, {
            indent: options.indent,
          });

          if (options.diff) {
            const { generateUnifiedDiff } = await import("../src/tools/fmt.js");
            const diff = generateUnifiedDiff("<stdin>", stdinSource, formatted);
            if (diff) {
              process.stdout.write(`${diff}\n`);
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
        const fmtCheckConfig = targetPath
          ? resolveExplicitOrPolymorphicTarget(targetPath).config
          : resolved.config;
        if (!isProjectAiceEnabled(fmtCheckConfig)) {
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
        const { diffFiles } = await import("../src/tools/diff-patch.js");
        const resolved = resolvePathTargets(oldPath);
        const diffTargetInfo = oldPath ? resolveExplicitOrPolymorphicTarget(oldPath) : undefined;
        if (!isProjectAiceEnabled(diffTargetInfo ? diffTargetInfo.config : resolved.config)) {
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
          patchText = await readStdin(patchFileArg === "-");
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

        const { patchFile } = await import("../src/tools/diff-patch.js");
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

// Command: idioms [action] [target] [extra] [dir]
program
  .command("idioms [action] [target] [extra] [dir]")
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
  .option("--dry-run", "Preview idiom synthesis, expansion, or update without modifying files")
  .action(
    async (
      actionArg: string | undefined,
      targetArg: string | undefined,
      extraArg: string | undefined,
      dirArg: string | undefined,
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
            targetDir = path.resolve(process.cwd(), dirArg ?? extraArg ?? ".");
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

        const idiomsProjectRoot = resolveCliProjectRoot(targetDir);
        const idiomsProjectConfig = loadProjectConfig(idiomsProjectRoot);
        if (!isProjectAiceEnabled(idiomsProjectConfig)) {
          console.error(`❌ ${AICE_DISABLED_MESSAGE}`);
          process.exit(1);
        }

        if (action === "list") {
          const idioms = idiomsProjectConfig.idioms ?? {};

          if (isJson) {
            console.log(JSON.stringify(idioms, null, 2));
            return;
          }

          console.log(
            `\n=== Active Project Idioms: ${path.relative(process.cwd(), targetDir) || "."} ===`,
          );
          console.log(
            `Idioms Status: ${isProjectIdiomsEnabled(idiomsProjectConfig) ? "ON (enabled)" : "OFF (disabled)"}`,
          );
          const count = Object.keys(idioms).length;
          console.log(`Total Idioms: ${count}`);
          if (count === 0) {
            console.log(
              "No idioms configured. Run `aice idioms scan --save` or `aice idioms apply` to discover idioms.",
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
          return;
        }

        const {
          applyProjectIdiomsToDirectory,
          expandAiceSourceIdioms,
          expandProjectIdiomsInDirectory,
          readProjectIdiom,
          scanProjectIdioms,
          updateProjectIdiom,
        } = await import("../src/idioms/index.js");

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
          if (!options.batch && idiomNameArg && idiomNameArg.trimStart().startsWith("[")) {
            options.batch = idiomNameArg;
          }

          if (options.batch) {
            const candidateBatchDir =
              dirArg ??
              extraArg ??
              (idiomNameArg && !idiomNameArg.trimStart().startsWith("[")
                ? idiomNameArg
                : undefined);
            const batchDir =
              candidateBatchDir && fs.existsSync(path.resolve(process.cwd(), candidateBatchDir))
                ? path.resolve(process.cwd(), candidateBatchDir)
                : process.cwd();
            let rawJson: string;
            if (options.batch.trim() === "-") {
              rawJson = await readStdin(true);
            } else {
              const batchPath = path.resolve(process.cwd(), options.batch);
              rawJson =
                fs.existsSync(batchPath) && fs.statSync(batchPath).isFile()
                  ? fs.readFileSync(batchPath, "utf-8")
                  : options.batch;
            }
            const parsedBatch = JSON.parse(rawJson);
            const entries: Array<{
              name?: string;
              idiom?: string;
              code?: string;
              newTemplate?: string;
              newTemplateAice?: string;
              template?: string;
              templateAice?: string;
              aice?: string;
              body?: string;
              content?: string;
              replacement?: string;
              params?: string;
            }> = Array.isArray(parsedBatch)
              ? parsedBatch
              : Object.entries(parsedBatch).map(([k, v]) =>
                  typeof v === "object" && v !== null
                    ? { name: k, ...(v as Record<string, unknown>) }
                    : { name: k, code: String(v) },
                );
            const batchResults = [];
            let totalOcc = 0;
            const modFilesSet = new Set<string>();
            for (const entry of entries) {
              const idName = entry.name || entry.idiom || "";
              const idCode =
                entry.code ??
                entry.newTemplate ??
                entry.newTemplateAice ??
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
          if (dirArg !== undefined) {
            resolvedTargetDir = path.resolve(process.cwd(), dirArg);
            if ((!templateCode || !templateCode.trim()) && extraArg) {
              templateCode = extraArg;
            }
          } else if ((!templateCode || !templateCode.trim()) && extraArg) {
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
          const shouldPersist = Boolean(options.save) && !dryRun;
          const res = scanProjectIdioms(targetDir, {
            dryRun: !shouldPersist,
            minOccurrences,
            minNetTokenSavings,
          });

          if (isJson) {
            console.log(JSON.stringify(res, null, 2));
            return;
          }

          const idiomsMap =
            res.idioms ?? (res as unknown as Record<string, unknown>).discoveredIdioms ?? {};
          const idiomCount =
            res.synthesizedIdioms ?? Object.keys(idiomsMap as Record<string, unknown>).length;
          const tokenSavings = res.netTokenSavings ?? res.totalNetTokenSavings ?? 0;
          const filesCount = res.modifiedFiles?.length ?? 0;

          if (idiomCount === 0) {
            console.log(
              "[AICE Idioms] 0 beneficial idioms discovered. FAST-PATH: Bypassing idiom layer. Use canonical AICE syntax (do not invent $idiom macros).",
            );
          }

          if (shouldPersist) {
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
          if (Object.keys(idiomsMap as Record<string, unknown>).length > 0) {
            console.log("\nDiscovered Idioms:");
            for (const [name, def] of Object.entries(
              idiomsMap as Record<string, { occurrences: number; netTokenSavings: number }>,
            )) {
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

          const idiomsMap = res.idioms ?? {};
          const idiomCount = res.synthesizedIdioms ?? Object.keys(idiomsMap).length;
          const tokenSavings = res.netTokenSavings ?? res.totalNetTokenSavings ?? 0;
          const filesCount = res.modifiedFiles?.length ?? 0;

          console.log(
            `\n=== AICE Project Idioms Apply${dryRun ? " (Dry Run)" : ""}: ${path.relative(process.cwd(), targetDir) || "."} ===`,
          );
          console.log(`Synthesized Idioms:  ${idiomCount}`);
          console.log(`Net Token Savings:   ${tokenSavings} tokens`);
          console.log(`Files Modified:      ${filesCount}`);
          if (!dryRun) {
            console.log("✔ Updated aice.config.json.");
          }
        } else if (action === "expand") {
          const rootDir = findProjectRoot(targetDir);
          if (dryRun) {
            const activeIdioms = idiomsProjectConfig.idioms ?? {};
            let expandedFiles = 0;
            let expandedCalls = 0;
            if (Object.keys(activeIdioms).length > 0 && fs.existsSync(targetDir)) {
              const aiceFiles = fs.statSync(targetDir).isDirectory()
                ? scanDirectoryFiles(
                    targetDir,
                    { extensions: [".aice"] },
                    idiomsProjectConfig,
                    rootDir,
                  )
                : targetDir.endsWith(".aice")
                  ? [targetDir]
                  : [];
              for (const fp of aiceFiles) {
                try {
                  const src = fs.readFileSync(fp, "utf-8");
                  const preview = expandAiceSourceIdioms(src, activeIdioms, fp);
                  if (preview.expandedCount > 0) {
                    expandedFiles++;
                    expandedCalls += preview.expandedCount;
                  }
                } catch {
                  // ignore individual preview read error
                }
              }
            }
            const previewRes = { expandedFiles, expandedCalls, dryRun: true };
            if (isJson) {
              console.log(JSON.stringify(previewRes, null, 2));
              return;
            }
            console.log(
              `\n=== AICE Project Idioms Expand (Dry Run): ${path.relative(process.cwd(), targetDir) || "."} ===`,
            );
            console.log(`Files Expanded:      ${expandedFiles}`);
            console.log("✔ [Dry Run] No files or configuration modified.");
            return;
          }

          const res = expandProjectIdiomsInDirectory(targetDir);
          const configPath = path.join(rootDir, "aice.config.json");
          if (fs.existsSync(configPath)) {
            const raw = JSON.parse(fs.readFileSync(configPath, "utf-8")) as Record<string, unknown>;
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
            const tmpCfgPath = `${configPath}.tmp.${process.pid}.${Date.now()}`;
            fs.writeFileSync(tmpCfgPath, `${JSON.stringify(raw, null, 2)}\n`, "utf-8");
            fs.renameSync(tmpCfgPath, configPath);
          }
          const idiomsJsonPath = path.join(rootDir, ".aice-idioms.json");
          if (fs.existsSync(idiomsJsonPath)) {
            const tmpIdiomsPath = `${idiomsJsonPath}.tmp.${process.pid}.${Date.now()}`;
            fs.writeFileSync(
              tmpIdiomsPath,
              `${JSON.stringify({ idioms: {} }, null, 2)}\n`,
              "utf-8",
            );
            fs.renameSync(tmpIdiomsPath, idiomsJsonPath);
          }
          const cacheIdiomsPath = path.join(rootDir, ".aice-cache", "idioms.json");
          if (fs.existsSync(cacheIdiomsPath)) {
            try {
              fs.unlinkSync(cacheIdiomsPath);
            } catch {
              // ignore cache cleanup error
            }
          }

          if (isJson) {
            console.log(JSON.stringify(res, null, 2));
            return;
          }

          const count = res.expandedFiles ?? 0;
          console.log(
            `\n=== AICE Project Idioms Expand: ${path.relative(process.cwd(), targetDir) || "."} ===`,
          );
          console.log(`Files Expanded:      ${count}`);
          console.log(
            "✔ All project idioms inlined back into standard code and idioms cleared from config.",
          );
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
  .option(
    "--global-rules",
    "Also inject global system prompt rules into ~/.gemini, ~/.claude, etc. (default: false, rules are scoped to projects with aice.config.json)",
  )
  .option("--json", "Output agent integration status in JSON format")
  .action(
    async (
      actionArg: string | undefined,
      options: { all?: boolean; agent?: string; json?: boolean; globalRules?: boolean },
    ) => {
      try {
        const { formatAgentsStatusTable, getAgentsStatus, removeAgents, setupAgents } =
          await import("../src/agents/index.js");
        const action = (actionArg ?? "status").toLowerCase();
        if (action === "setup" || action === "install") {
          const statuses = setupAgents({
            all: Boolean(options.all),
            agent: options.agent,
            globalRules: Boolean(options.globalRules),
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
        const {
          buildGainReport,
          formatGlobalGainDashboard,
          formatProjectGainDetail,
          resetTelemetryHistory,
        } = await import("../src/telemetry/index.js");
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
    async (
      projectArg: string | undefined,
      options: {
        project?: string;
        transcriptsDir?: string;
        json?: boolean;
      },
    ) => {
      try {
        const { analyzeProject, formatAnalyzeReport } = await import("../src/telemetry/index.js");
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

if (isDirectCliRun()) {
  void program.parseAsync(process.argv);
}
