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
} from "../config/index.js";
import type { BatchCreateItem, BatchSpliceItem, SpliceOptions } from "../tools/index.js";
import {
  readStdin,
  recordCliFailureTelemetry,
  resolveCliProjectRoot,
} from "./telemetry-and-flags.js";

export function registerSpliceCommands(program: Command): void {
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
    .option(
      "-d, --delete [symbol]",
      "Delete the symbol (or specify an additional symbol to delete)",
    )
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
        let capturedWastedPayload: string | undefined =
          options.code ?? options.template ?? options.body;
        const normalizeTrailingStreamDelete = (streamText: string): string =>
          streamText.replace(
            /^([ \t]*={3,}[ \t]*[^=\r\n]+?)[ \t]*={3,}[ \t]+(--delete|-d)[ \t]*$/gm,
            "$1 $2 ===",
          );
        try {
          const { parseMultiBlockSpliceStream, splice, spliceBatch, splitInlineFileSelector } =
            await import("../tools/splice.js");

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
              const wastedBatch =
                capturedWastedPayload ??
                spliceItems
                  .map((it) => it.code ?? it.body ?? "")
                  .filter(Boolean)
                  .join("\n");
              recordCliFailureTelemetry(
                AICE_DISABLED_MESSAGE,
                "splice",
                firstCleanFp || undefined,
                wastedBatch,
              );
              console.error(`❌ ${AICE_DISABLED_MESSAGE}`);
              process.exit(1);
            }
            const batchEffectiveIdioms = isProjectIdiomsEnabled(batchProjectConfig, options.idioms);
            const combinedInlineIdioms = [...(inlineIdiomList ?? [])];
            let idiomSummary:
              | { updatedIdioms: number; totalOcc: number; modifiedFiles: number }
              | undefined;
            if (idiomItems.length > 0) {
              const { updateProjectIdiom } = await import("../idioms/index.js");
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
                ...(options.overwrite !== undefined
                  ? { overwrite: options.overwrite }
                  : options.force
                    ? { overwrite: true }
                    : {}),
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
            const rawParts = rawJson.split(
              /['"]?\s*&&\s*aice\s+idioms?\s+update\s+--batch\s*['"]?/,
            );
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
            capturedWastedPayload = rawJson;
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
              const malMsg = `Error: Malformed target '${trimmedTarget}': missing <symbol>, L<start>-L<end>, :overwrite, or :eof after ':'.`;
              recordCliFailureTelemetry(
                malMsg,
                "splice",
                trimmedTarget.replace(/:+$/, ""),
                capturedWastedPayload,
              );
              console.error(`❌ ${malMsg}`);
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
              capturedWastedPayload = rawCrossStream;
              if (rawCrossStream.trimStart().startsWith("[")) {
                const allEntries = parseJsonBatchEntries(rawCrossStream);
                const { spliceItems, idiomItems } = partitionBatchEntries(allEntries);
                if (spliceItems.length > 0 || idiomItems.length > 0) {
                  await executeBatchSpliceAndIdioms(spliceItems, idiomItems);
                  return;
                }
              }
              const normalizedStream = normalizeTrailingStreamDelete(rawCrossStream);
              const parsedStream = parseMultiBlockSpliceStream(normalizedStream);
              if (parsedStream?.batchItems && parsedStream.batchItems.length > 0) {
                await executeBatchSpliceAndIdioms(parsedStream.batchItems);
                return;
              }
            }
            const badHeader = rawCrossStream
              ?.match(/^\s*={3,}\s*([^=\r\n]*?)\s*={3,}/m)?.[1]
              ?.trim();
            const headerDiag = badHeader
              ? ` Malformed or incomplete header '=== ${badHeader} ==='.`
              : "";
            const streamErrMsg = `Error: Must provide <path>, --batch <fileOrJson>, or pipe valid '=== <filePath> ===' / '=== <filePath>:<symbol> ===' blocks via --stdin.${headerDiag}`;
            recordCliFailureTelemetry(streamErrMsg, "splice", undefined, rawCrossStream);
            console.error(
              `❌ ${streamErrMsg}\n` +
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
            const disabledWasted =
              capturedWastedPayload ?? (options.stdin ? await readStdin(false) : undefined);
            recordCliFailureTelemetry(AICE_DISABLED_MESSAGE, "splice", targetPath, disabledWasted);
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
              const fromErrMsg = `Error: --from file not found: ${options.from}`;
              recordCliFailureTelemetry(fromErrMsg, "splice", targetPath, code);
              console.error(`❌ ${fromErrMsg}`);
              process.exit(1);
            }
            code = fs.readFileSync(fromPath, "utf-8");
            capturedWastedPayload = code;
          }

          let parsedEdits: SpliceOptions["edits"];
          if (
            options.edits === "-" ||
            (options.stdin && !options.symbol && code === undefined && options.body === undefined)
          ) {
            const stdinRaw = await readStdin(true);
            capturedWastedPayload = stdinRaw;
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
            capturedWastedPayload = rawEditsJson;
            const parsed = JSON.parse(rawEditsJson.trim());
            if (!Array.isArray(parsed)) {
              const editsErrMsg = "Error: --edits must be a JSON array of symbol edit objects.";
              recordCliFailureTelemetry(editsErrMsg, "splice", targetPath, rawEditsJson);
              console.error(`❌ ${editsErrMsg}`);
              process.exit(1);
            }
            parsedEdits = parsed;
          }

          if (options.stdin && code === undefined && !parsedEdits) {
            code = await readStdin(true);
            capturedWastedPayload = code;
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
              capturedWastedPayload = code;
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
                capturedWastedPayload = code;
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
              const emptyErrMsg = `Error: Empty or missing splice body for '=== ${targetPath}${symHint} ==='. Must provide --code, --from, --stdin, --body, --delete, or --edits.`;
              recordCliFailureTelemetry(emptyErrMsg, "splice", targetPath, capturedWastedPayload);
              console.error(
                `❌ ${emptyErrMsg}\n` +
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
            const multiStream = parseMultiBlockSpliceStream(
              normalizeTrailingStreamDelete(code),
              targetPath,
            );
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
            ...(options.overwrite !== undefined
              ? { overwrite: options.overwrite }
              : options.force
                ? { overwrite: true }
                : {}),
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
            console.log(
              `✔ ${actionDesc} in ${targetPath} (${result.tokensSaved ?? 0} tokens saved)`,
            );
            if (options.compile) {
              console.log(`✔ Recompiled target for ${targetPath}`);
            }
          }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          const errTarget = rawTargetPath ?? options.file ?? options.batch;
          recordCliFailureTelemetry(
            msg,
            "splice",
            typeof errTarget === "string" ? errTarget : undefined,
            capturedWastedPayload,
          );
          console.error(`❌ Error splicing ${errTarget ?? "<stdin>"}: ${msg}`);
          process.exit(1);
        }
      },
    );

  // Command: create [filePath]
  program
    .command("create [filePath]", { hidden: true })
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
            "../tools/create.js"
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
                "../tools/splice.js"
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
                const totalSaved = batchRes.results.reduce(
                  (acc, r) => acc + (r.tokensSaved ?? 0),
                  0,
                );
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
          recordCliFailureTelemetry(msg, "create", errTarget);
          console.error(`❌ Error creating ${errTarget ?? "<file>"}: ${msg}`);
          process.exit(1);
        }
      },
    );
}
