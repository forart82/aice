/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { Command } from "commander";
import {
  AICE_DISABLED_MESSAGE,
  findProjectRoot,
  isProjectAiceEnabled,
  isProjectIdiomsEnabled,
  loadProjectConfig,
  resolvePathTargets,
  scanDirectoryFiles,
  setProjectIdiomsEnabled,
} from "../config/index.js";
import type { DiffOptions, FmtOptions, PatchOptions } from "../tools/index.js";
import {
  readStdin,
  resolveCliProjectRoot,
  resolveExplicitOrPolymorphicTarget,
} from "./telemetry-and-flags.js";

export function registerUtilityCommands(program: Command): void {
  // Command: fmt [target]
  program
    .command("fmt", { hidden: true })
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
          const { formatAicePath, formatAiceSource } = await import("../tools/fmt.js");
          if (options.stdin) {
            const stdinSource = await readStdin(true);
            const formatted = formatAiceSource(stdinSource, {
              indent: options.indent,
            });

            if (options.diff) {
              const { generateUnifiedDiff } = await import("../tools/fmt.js");
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
    .command("diff", { hidden: true })
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
          const { diffFiles } = await import("../tools/diff-patch.js");
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
                const hasSemantic =
                  res.changes && res.changes.some((c) => c.change !== "unchanged");
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
    .command("patch", { hidden: true })
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

          const { patchFile } = await import("../tools/diff-patch.js");
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
    .command("idioms [action] [target] [extra] [dir]", { hidden: true })
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
          } = await import("../idioms/index.js");

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
              console.error(
                "❌ Error: Must provide `-c, --code <template>` when updating an idiom.",
              );
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
              const raw = JSON.parse(fs.readFileSync(configPath, "utf-8")) as Record<
                string,
                unknown
              >;
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
}
