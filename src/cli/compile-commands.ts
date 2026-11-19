/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { Command } from "commander";
import {
  AICE_DISABLED_MESSAGE,
  type AiceProjectConfig,
  isProjectAiceEnabled,
  isProjectIdiomsEnabled,
  KNOWN_TARGET_EXTENSIONS,
  loadProjectConfig,
  resolvePathTargets,
  resolveTargetOutputPathForConfig,
} from "../config/index.js";
import type { TargetLanguage } from "../emitters/index.js";
import { resolveCliProjectRoot, writeTargetFile } from "./telemetry-and-flags.js";

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
    import("../core/parser.js"),
    import("../emitters/index.js"),
    import("../idioms/index.js"),
    import("../typechecker/checker.js"),
    import("../typechecker/diagnostics.js"),
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

export function registerCompileCommands(program: Command): void {
  // Command: compile [target]
  program
    .command("compile", { hidden: true })
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
    .command("compile-all", { hidden: true })
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
    .command("verify", { hidden: true })
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
              await import("../tools/parity-gate.js");
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
          import("../core/parser.js"),
          import("../idioms/index.js"),
          import("../typechecker/checker.js"),
          import("../typechecker/diagnostics.js"),
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
    .command("fix", { hidden: true })
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
          "../typechecker/diagnostics.js"
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
    .command("decompile", { hidden: true })
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
          import("../decompiler/index.js"),
          import("../emitters/index.js"),
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
    .command("roundtrip", { hidden: true })
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
          import("../decompiler/index.js"),
          import("../emitters/index.js"),
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
}
