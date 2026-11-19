/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Public AICE source splicing (spliceSource), file-level splice(), and atomic transactional batch splicing (spliceBatch).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import ts from "../../compat/typescript.js";
import {
  AICE_DISABLED_MESSAGE,
  assertSafeTextWriteTarget,
  isProjectAiceEnabled,
  isProjectIdiomsEnabled,
  KNOWN_TARGET_EXTENSIONS,
  loadProjectConfig,
  type ProjectIdiomDefinition,
} from "../../config/index.js";
import type { FunctionDecl, MethodDecl } from "../../core/ast.js";
import { parseWithTrivia } from "../../core/parser.js";
import { detectTargetFromPath, emitTarget, type TargetLanguage } from "../../emitters/index.js";
import { expandModuleIdioms } from "../../idioms/index.js";
import { recordTelemetryEvent, withSuppressedTelemetry } from "../../telemetry/index.js";
import { estimateTokens } from "../../tokenomics/index.js";
import { TypeChecker } from "../../typechecker/checker.js";
import {
  checkPythonDuplicateParams,
  createFile,
  parseOptionIdioms,
  resolveTargetProjectRoot,
} from "../create.js";
import { maskSourceLexically } from "../preprocessor.js";
import { didYouMeanSymbol } from "../suggest.js";
import { validateNativeSyntax } from "../syntax-validator.js";
import {
  dedentCode,
  findSpliceTargetSymbol,
  generateUnifiedDiff,
  getLineEnd,
  getNodeEndOffset,
  indentCode,
} from "./ast-helpers.js";
import {
  computeOriginalEditLineSpan,
  containsHunkMarkers,
  formatSurroundingNumberedContext,
} from "./hunks.js";
import { spliceNativeSource } from "./native-orchestrator.js";
import {
  isCreateOrOverwriteSymbol,
  isLineRangeEditSelector,
  isSpliceTargetFileCandidate,
  parseMultiBlockSpliceStream,
  resolveEffectiveSpliceTargetLang,
  splitInlineFileSelector,
} from "./stream-parser.js";
import { getCachedTsSourceFile } from "./ts-and-script-spans.js";
import type {
  BatchSpliceItem,
  BatchSpliceOptions,
  BatchSpliceResult,
  SpliceOptions,
  SpliceResult,
} from "./types.js";

/**
 * Pure in-memory AST surgical splice implementation.
 */
export function spliceSource(
  source: string,
  optionsOrSymbol: SpliceOptions | string,
  filePathOrCode: string = "source.aice",
  deleteFlag?: boolean,
  maybeFilePath?: string,
  maybeIdioms?: Record<string, ProjectIdiomDefinition>,
  extraOptions?: Partial<SpliceOptions> & { bodyOnly?: boolean },
): SpliceResult {
  let options: SpliceOptions;
  let filePath: string;
  const idioms: Record<string, ProjectIdiomDefinition> | undefined = maybeIdioms;

  if (typeof optionsOrSymbol === "string") {
    const codeStr = filePathOrCode;
    const isBodyOnly = Boolean(extraOptions?.bodyOnly);
    options = {
      ...extraOptions,
      symbol: optionsOrSymbol || extraOptions?.symbol,
      ...(isBodyOnly ? { body: codeStr } : { code: codeStr }),
      delete: Boolean(deleteFlag ?? extraOptions?.delete),
    };
    filePath = maybeFilePath || "source.aice";
  } else {
    options = optionsOrSymbol;
    filePath = filePathOrCode || "source.aice";
  }

  const ext = path.extname(filePath).toLowerCase();
  if (
    !filePath.endsWith(".aice") &&
    (KNOWN_TARGET_EXTENSIONS.has(ext) || isSpliceTargetFileCandidate(filePath))
  ) {
    return spliceNativeSource(source, options, filePath, idioms);
  }
  if (options.edits && options.edits.length > 0) {
    let currentCode = source;
    const editedSymbols: string[] = [];
    for (const edit of options.edits) {
      const editCode =
        edit.code ?? edit.aice ?? edit.template ?? edit.snippet ?? edit.content ?? edit.replacement;
      const singleRes = spliceSource(
        currentCode,
        {
          ...options,
          edits: undefined,
          symbol: edit.symbol,
          code: editCode,
          body: edit.body,
          delete: edit.delete,
          insertAfter: edit.insertAfter ?? edit.insert_after,
          insertBefore: edit.insertBefore ?? edit.insert_before,
        },
        filePath,
        undefined,
        undefined,
        idioms,
      );
      currentCode = singleRes.modifiedCode;
      editedSymbols.push(edit.symbol);
    }
    const diff = options.diff ? generateUnifiedDiff(filePath, source, currentCode) : undefined;
    return {
      success: true,
      filePath,
      symbol: editedSymbols.join(", "),
      diff,
      modifiedCode: currentCode,
      newAiceSource: currentCode,
      tokensSaved: estimateTokens(currentCode) - estimateTokens(JSON.stringify(options.edits)),
    };
  }

  const { ast } = parseWithTrivia(source, filePath);

  let modifiedCode = source;
  let originalSnippet: string | undefined;
  let newSnippet: string | undefined;
  const targetSymbol = options.symbol;

  // Case 1: Append to module or class
  if (options.append) {
    if (targetSymbol) {
      const symInfo = findSpliceTargetSymbol(ast, targetSymbol);
      if (!symInfo) {
        throw new Error(`Symbol '${targetSymbol}' not found for append target in ${filePath}`);
      }
      if (symInfo.kind !== "class" && symInfo.kind !== "type" && symInfo.kind !== "enum") {
        throw new Error(
          `Cannot append to symbol '${targetSymbol}' of kind '${symInfo.kind}' (expected class, type, or enum)`,
        );
      }
      const rawCode = options.code ?? options.body ?? "";
      const classIndent = "  ";
      const formattedSnippet = indentCode(rawCode, classIndent);
      newSnippet = formattedSnippet;

      // Find the insertion point at the end of class/type body
      const endOffset = getNodeEndOffset(symInfo.node, source);
      const lineEnd = getLineEnd(source, endOffset);

      let insertPos = lineEnd;
      if (source[insertPos] === "\r" && source[insertPos + 1] === "\n") insertPos += 2;
      else if (source[insertPos] === "\n") insertPos += 1;

      modifiedCode = `${source.slice(0, insertPos)}\n${formattedSnippet}\n${source.slice(insertPos)}`;
    } else {
      // Append to end of module
      const rawCode = options.code ?? options.body ?? "";
      const formattedSnippet = dedentCode(rawCode).trim();
      newSnippet = formattedSnippet;
      const trimmedSource = source.trimEnd();
      modifiedCode = `${trimmedSource}\n\n${formattedSnippet}\n`;
    }
  }
  // Case 2: Insert after a symbol
  else if (options.insertAfter) {
    const symInfo = findSpliceTargetSymbol(ast, options.insertAfter);
    if (!symInfo) {
      throw new Error(`Symbol '${options.insertAfter}' not found for insertAfter in ${filePath}`);
    }
    const endOffset = getNodeEndOffset(symInfo.node, source);
    const lineEnd = getLineEnd(source, endOffset);

    // Detect indentation of the target symbol line
    const targetLineStart = source.lastIndexOf("\n", symInfo.node.span.start.offset - 1) + 1;
    const targetIndent = source.slice(targetLineStart).match(/^[ \t]*/)?.[0] || "";

    const rawCode = options.code ?? options.body ?? "";
    const formattedSnippet = indentCode(rawCode, targetIndent);
    newSnippet = formattedSnippet;

    let insertPos = lineEnd;
    if (source[insertPos] === "\r" && source[insertPos + 1] === "\n") insertPos += 2;
    else if (source[insertPos] === "\n") insertPos += 1;

    // Check if there is already an empty line after the symbol
    let hasBlankLine = false;
    if (source.slice(insertPos).startsWith("\r\n")) {
      insertPos += 2;
      hasBlankLine = true;
    } else if (source.slice(insertPos).startsWith("\n")) {
      insertPos += 1;
      hasBlankLine = true;
    }

    const separator = symInfo.kind === "property" || symInfo.kind === "field" ? "\n" : "\n\n";
    if (hasBlankLine) {
      modifiedCode = `${source.slice(0, insertPos)}${formattedSnippet}\n\n${source.slice(insertPos)}`;
    } else {
      modifiedCode = `${source.slice(0, insertPos)}${formattedSnippet}${separator}${source.slice(insertPos)}`;
    }
  }
  // Case 3: Insert before a symbol
  else if (options.insertBefore) {
    const symInfo = findSpliceTargetSymbol(ast, options.insertBefore);
    if (!symInfo) {
      throw new Error(`Symbol '${options.insertBefore}' not found for insertBefore in ${filePath}`);
    }
    // Find lineStart of the symbol
    let lineStart = source.lastIndexOf("\n", symInfo.node.span.start.offset - 1) + 1;

    // Check if docstring immediately precedes
    let checkPos = lineStart - 1;
    while (checkPos > 0) {
      const prevLineStart = source.lastIndexOf("\n", checkPos - 1) + 1;
      const prevLine = source.slice(prevLineStart, checkPos).trim();
      if (prevLine.startsWith("///") || prevLine.startsWith("/*") || prevLine.startsWith("#")) {
        lineStart = prevLineStart;
        checkPos = prevLineStart - 1;
      } else {
        break;
      }
    }

    const targetIndent = source.slice(lineStart).match(/^[ \t]*/)?.[0] || "";
    const rawCode = options.code ?? options.body ?? "";
    const formattedSnippet = indentCode(rawCode, targetIndent);
    newSnippet = formattedSnippet;

    const separator = symInfo.kind === "property" || symInfo.kind === "field" ? "\n" : "\n\n";
    modifiedCode = `${source.slice(0, lineStart)}${formattedSnippet}${separator}${source.slice(lineStart)}`;
  }
  // Case 4: Delete target symbol
  else if (options.delete) {
    if (!targetSymbol) {
      throw new Error("Must specify target symbol with --symbol when deleting");
    }
    const symInfo = findSpliceTargetSymbol(ast, targetSymbol);
    if (!symInfo) {
      throw new Error(
        `Symbol '${targetSymbol}' not found in ${filePath}${didYouMeanSymbol(source, targetSymbol)}`,
      );
    }

    // Determine declaration lineStart
    let lineStart = source.lastIndexOf("\n", symInfo.node.span.start.offset - 1) + 1;

    // Also include directly attached docstring if present
    let checkPos = lineStart - 1;
    while (checkPos > 0) {
      const prevLineStart = source.lastIndexOf("\n", checkPos - 1) + 1;
      const prevLine = source.slice(prevLineStart, checkPos).trim();
      if (prevLine.startsWith("///") || prevLine.startsWith("/*") || prevLine.startsWith("#")) {
        lineStart = prevLineStart;
        checkPos = prevLineStart - 1;
      } else {
        break;
      }
    }

    const endOffset = getNodeEndOffset(symInfo.node, source);
    const lineEnd = getLineEnd(source, endOffset);

    let delEnd = lineEnd;
    if (source[delEnd] === "\r" && source[delEnd + 1] === "\n") {
      delEnd += 2;
    } else if (source[delEnd] === "\n") {
      delEnd += 1;
    }

    // If there's an adjacent empty line, absorb one empty line
    if (source.slice(delEnd).startsWith("\r\n")) {
      delEnd += 2;
    } else if (source.slice(delEnd).startsWith("\n")) {
      delEnd += 1;
    }

    originalSnippet = source.slice(lineStart, lineEnd).trim();
    newSnippet = "";
    modifiedCode = `${source.slice(0, lineStart)}${source.slice(delEnd)}`;
  }
  // Case 5: Replace Body Only
  else if (options.body !== undefined) {
    if (!targetSymbol) {
      throw new Error("Must specify target symbol with --symbol when replacing body");
    }
    const symInfo = findSpliceTargetSymbol(ast, targetSymbol);
    if (!symInfo) {
      throw new Error(
        `Symbol '${targetSymbol}' not found in ${filePath}${didYouMeanSymbol(source, targetSymbol)}`,
      );
    }
    if (symInfo.kind !== "function" && symInfo.kind !== "method") {
      throw new Error(
        `Cannot replace body of symbol '${targetSymbol}' of kind '${symInfo.kind}' (only function and method support --body)`,
      );
    }

    const fnNode = symInfo.node as FunctionDecl | MethodDecl;
    const declLineStart = source.lastIndexOf("\n", fnNode.span.start.offset - 1) + 1;
    const declIndent = source.slice(declLineStart).match(/^[ \t]*/)?.[0] || "";
    const bodyIndent = `${declIndent}  `;

    if (fnNode.isExpressionBodied && fnNode.body) {
      const bStart = fnNode.body.span.start.offset;
      const bEnd = fnNode.body.span.end.offset;
      originalSnippet = source.slice(bStart, bEnd);
      const formattedSnippet = options.body.trim();
      newSnippet = formattedSnippet;
      modifiedCode = `${source.slice(0, bStart)}${formattedSnippet}${source.slice(bEnd)}`;
    } else {
      // Block body: replace all statements while preserving signature line
      const colonOffset = source.indexOf(":", fnNode.span.start.offset);
      const afterColonNewline = source.indexOf("\n", colonOffset) + 1;

      const bodyEndOffset = getNodeEndOffset(fnNode, source);
      const bodyLineEnd = getLineEnd(source, bodyEndOffset);

      originalSnippet = source.slice(afterColonNewline, bodyLineEnd).trim();
      const formattedSnippet = indentCode(options.body, bodyIndent);
      newSnippet = formattedSnippet;

      modifiedCode = `${source.slice(0, afterColonNewline)}${formattedSnippet}${source.slice(bodyLineEnd)}`;
    }
  }
  // Case 6: Replace Entire Declaration with Code
  else if (options.code !== undefined) {
    if (!targetSymbol) {
      throw new Error("Must specify target symbol with --symbol when replacing code");
    }
    const symInfo = findSpliceTargetSymbol(ast, targetSymbol);
    if (!symInfo) {
      throw new Error(
        `Symbol '${targetSymbol}' not found in ${filePath}${didYouMeanSymbol(source, targetSymbol)}`,
      );
    }

    // Determine declaration lineStart
    const lineStart = source.lastIndexOf("\n", symInfo.node.span.start.offset - 1) + 1;
    const declIndent = source.slice(lineStart).match(/^[ \t]*/)?.[0] || "";

    const endOffset = getNodeEndOffset(symInfo.node, source);
    const lineEnd = getLineEnd(source, endOffset);

    originalSnippet = source.slice(lineStart, lineEnd).trim();
    const formattedSnippet = indentCode(options.code, declIndent);
    newSnippet = formattedSnippet;

    modifiedCode = `${source.slice(0, lineStart)}${formattedSnippet}${source.slice(lineEnd)}`;
  } else {
    throw new Error(
      "No valid splice action specified: provide --code, --body, --delete, --insert-after, --insert-before, or --append",
    );
  }

  // Generate unified diff if requested
  let diff: string | undefined;
  if (options.diff) {
    diff = generateUnifiedDiff(filePath, source, modifiedCode);
  }

  // Calculate tokens saved
  const snippetTokens = estimateTokens(newSnippet || options.code || options.body || "");
  const modifiedTokens = estimateTokens(modifiedCode);
  const tokensSaved = modifiedTokens - snippetTokens;

  return {
    success: true,
    filePath,
    symbol: targetSymbol,
    originalSnippet,
    newSnippet,
    diff,
    modifiedCode,
    newAiceSource: modifiedCode,
    tokensSaved,
  };
}

export async function splice(
  rawFilePath: string,
  rawOptions: SpliceOptions = {},
): Promise<SpliceResult> {
  let options: SpliceOptions = { ...(rawOptions ?? {}) };
  const safeRawFilePath = typeof rawFilePath === "string" ? rawFilePath : String(rawFilePath ?? "");
  const aliasCode =
    options.code ??
    options.aice ??
    options.template ??
    options.snippet ??
    options.content ??
    options.replacement;
  if (options.code === undefined && aliasCode !== undefined) {
    options.code = aliasCode;
  }

  const baseDir = options.projectRoot ? path.resolve(options.projectRoot) : process.cwd();
  const trimmedRawPath = safeRawFilePath.trim();
  if (!options.symbol && /:+$/.test(trimmedRawPath)) {
    throw new Error(
      `Malformed target '${trimmedRawPath}': missing <symbol>, L<start>-L<end>, :overwrite, or :eof after ':'`,
    );
  }
  const splitTarget = splitInlineFileSelector(safeRawFilePath, baseDir);
  let filePath = splitTarget.filePath;
  if (splitTarget.inlineSelector && !options.symbol) {
    options = { ...options, symbol: splitTarget.inlineSelector };
  }

  if ((options.code === undefined || options.code === "") && options.from) {
    const fromPath = path.isAbsolute(options.from)
      ? options.from
      : path.resolve(baseDir, options.from);
    if (!fs.existsSync(fromPath)) {
      throw new Error(`Input file --from not found: ${options.from}`);
    }
    options = { ...options, code: fs.readFileSync(fromPath, "utf-8") };
  }

  const rawEnvelopeInput = typeof options.code === "string" ? options.code : undefined;
  if (
    !options.symbol &&
    (!options.edits || options.edits.length === 0) &&
    typeof options.code === "string" &&
    options.code
  ) {
    const parsedMulti = parseMultiBlockSpliceStream(options.code, filePath);
    if (parsedMulti?.singleFileEdits && parsedMulti.singleFileEdits.length > 0) {
      options = {
        ...options,
        edits: parsedMulti.singleFileEdits,
        code: undefined,
      };
    } else if (parsedMulti?.batchItems && parsedMulti.batchItems.length > 0) {
      if (parsedMulti.batchItems.length === 1) {
        const b0 = parsedMulti.batchItems[0]!;
        const candFp = b0.filePath || filePath;
        const resolvedCand = candFp
          ? path.isAbsolute(candFp)
            ? candFp
            : path.resolve(baseDir, candFp)
          : "";
        const resolvedCur = filePath.trim()
          ? path.isAbsolute(filePath)
            ? filePath
            : path.resolve(baseDir, filePath)
          : "";
        if (!resolvedCur || resolvedCand === resolvedCur) {
          filePath = candFp;
          options = {
            ...options,
            symbol: b0.symbol,
            code: b0.code,
            edits: b0.edits,
            create: b0.create ?? options.create,
            overwrite: b0.overwrite ?? options.overwrite,
            delete: b0.delete ?? options.delete,
            insertAfter: b0.insertAfter ?? options.insertAfter,
            insertBefore: b0.insertBefore ?? options.insertBefore,
            cloneFrom: b0.cloneFrom ?? options.cloneFrom,
            preserveDocs: b0.preserveDocs ?? options.preserveDocs,
          };
        } else {
          const delegated = await spliceBatch(parsedMulti.batchItems, {
            projectRoot: options.projectRoot,
            dryRun: options.dryRun,
            compile: options.compile,
            idioms: options.idioms,
            inlineIdioms: options.inlineIdioms,
            idiom: options.idiom,
            overwrite: options.overwrite,
            force: options.force,
            preserveDocs: options.preserveDocs,
            surface: options.surface,
            targetLanguage: options.targetLanguage,
          });
          return delegated.results[delegated.results.length - 1]!;
        }
      } else {
        const delegated = await spliceBatch(parsedMulti.batchItems, {
          projectRoot: options.projectRoot,
          dryRun: options.dryRun,
          compile: options.compile,
          idioms: options.idioms,
          inlineIdioms: options.inlineIdioms,
          idiom: options.idiom,
          overwrite: options.overwrite,
          force: options.force,
          preserveDocs: options.preserveDocs,
          surface: options.surface,
          targetLanguage: options.targetLanguage,
        });
        return delegated.results[delegated.results.length - 1]!;
      }
    }
  }

  if (!filePath?.trim()) {
    throw new Error(
      "Must provide target filePath (or multi-file '=== <filePath> ===' stream) for aice splice",
    );
  }

  const fullPath = path.isAbsolute(filePath) ? filePath : path.resolve(baseDir, filePath);

  const root = resolveTargetProjectRoot(fullPath, options.projectRoot);
  const config = loadProjectConfig(root);
  if (!isProjectAiceEnabled(config)) {
    throw new Error(AICE_DISABLED_MESSAGE);
  }

  const diskFileExists = fs.existsSync(fullPath);
  const fileExists = options.sourceOverride !== undefined || diskFileExists;
  const hasBatchEdits = Boolean(options.edits && options.edits.length > 0);
  const hasExplicitPayload =
    options.code !== undefined || options.body !== undefined || hasBatchEdits;

  const incomingPayloadForGuard = [
    options.code,
    options.body,
    ...(options.edits ?? []).map((e) => e?.code ?? e?.body ?? ""),
  ]
    .filter((s): s is string => typeof s === "string")
    .join("\n");
  assertSafeTextWriteTarget(fullPath, incomingPayloadForGuard, {
    checkExistingDiskFile: options.sourceOverride === undefined,
  });

  if (!options.delete && !options.cloneFrom && !hasExplicitPayload) {
    throw new Error(
      "Must provide replacement code (--code, --body, --from, or --stdin), --edits, or --delete.",
    );
  }

  const hasHunkInPayload =
    containsHunkMarkers(options.code ?? options.body ?? "") ||
    Boolean(
      hasBatchEdits &&
        (options.edits ?? []).some((e) => containsHunkMarkers(e.code ?? e.body ?? "")),
    );

  if (!fileExists && hasHunkInPayload) {
    throw new Error(
      `Source file not found: ${filePath} (cannot apply <<< === >>> hunk to a non-existent file)`,
    );
  }

  const hasLineRangeInPayload =
    isLineRangeEditSelector(options.symbol) ||
    Boolean(hasBatchEdits && (options.edits ?? []).some((e) => isLineRangeEditSelector(e.symbol)));

  if (!fileExists && hasLineRangeInPayload && !options.create && !options.overwrite) {
    throw new Error(
      `Source file not found: ${filePath} (cannot splice line range on a non-existent file)`,
    );
  }

  const isExplicitCreateSelector = Boolean(
    options.create || (options.symbol && /^:?create$/i.test(options.symbol.trim())),
  );
  const isExplicitOverwriteSelector = Boolean(
    options.symbol && /^:?(?:overwrite|\*)$/i.test(options.symbol.trim()),
  );

  const isFullOverwrite =
    fileExists &&
    !hasBatchEdits &&
    !hasHunkInPayload &&
    !options.append &&
    !options.insertAfter &&
    !options.insertBefore &&
    !options.delete &&
    !options.cloneFrom &&
    (!options.symbol || isCreateOrOverwriteSymbol(options.symbol));

  const isCreateRoute =
    !options.delete &&
    !options.cloneFrom &&
    !hasHunkInPayload &&
    (!fileExists ||
      isFullOverwrite ||
      (isExplicitCreateSelector &&
        !hasBatchEdits &&
        !options.append &&
        !options.insertAfter &&
        !options.insertBefore &&
        (!options.symbol || isCreateOrOverwriteSymbol(options.symbol))));

  if (isCreateRoute) {
    const prevSource =
      options.sourceOverride ?? (diskFileExists ? fs.readFileSync(fullPath, "utf-8") : "");
    const codePayload =
      options.code ??
      options.body ??
      (hasBatchEdits
        ? options
            .edits!.filter((e) => !e.delete)
            .map((e) => e.code ?? e.body ?? "")
            .filter(Boolean)
            .join("\n\n")
        : "");
    const explicitOverwriteOrCreateSym = Boolean(
      options.symbol && /^:?(?:overwrite|create|\*)$/i.test(options.symbol.trim()),
    );
    if (
      fileExists &&
      codePayload === "" &&
      !options.overwrite &&
      !options.force &&
      !options.create &&
      !explicitOverwriteOrCreateSym
    ) {
      throw new Error(
        `Refusing to overwrite existing file '${filePath}' with empty content without --overwrite or ':overwrite'.`,
      );
    }
    const effectiveOverwrite =
      options.overwrite === false && !options.force && !isExplicitOverwriteSelector
        ? false
        : Boolean(fileExists || options.overwrite || options.force || explicitOverwriteOrCreateSym);

    const hasInlineCreateIdiomDecl = /^\s*@idiom\s+\$[A-Za-z_]/m.test(codePayload);
    const effectiveCreateIdiomsOpt =
      options.idioms !== undefined
        ? options.idioms
        : options.inlineIdioms !== undefined ||
            options.idiom !== undefined ||
            hasInlineCreateIdiomDecl
          ? true
          : config.idiomsEnabled === true && isProjectIdiomsEnabled(config);
    let created: Awaited<ReturnType<typeof createFile>>;
    try {
      created = await createFile(fullPath, {
        code: codePayload,
        from: options.from,
        overwrite: effectiveOverwrite,
        force: options.force,
        idioms: effectiveCreateIdiomsOpt,
        inlineIdioms: options.inlineIdioms,
        idiom: options.idiom,
        dryRun: options.dryRun,
        projectRoot: root,
        surface: options.surface,
        targetLanguage: options.targetLanguage,
        suppressTelemetry: true,
      });
    } catch (err) {
      if (err instanceof Error && /pre-write syntax validation/i.test(err.message)) {
        const tip = fileExists
          ? `\nTip: Fix the syntax error on the reported line before retrying, or splice surgically via === ${filePath}:<symbol> === or === ${filePath}:L<start>-L<end> === on existing files.`
          : "\nTip: Fix the syntax error on the reported line before retrying (or use :sym / :Lstart-Lend when editing existing files).";
        if (!err.message.includes("Tip:")) {
          throw new Error(`${err.message}${tip}`);
        }
      }
      throw err;
    }
    const aiceTelemetryInput = rawEnvelopeInput ?? codePayload;
    const realisticCreatePayload = JSON.stringify({ path: fullPath, content: created.nativeCode });
    const honestNativeTokens = estimateTokens(created.nativeCode, "cl100k_base");
    const honestAiceTokens = estimateTokens(aiceTelemetryInput, "cl100k_base");
    const honestTokensSaved = honestNativeTokens - honestAiceTokens;
    const honestRealisticTokensSaved =
      estimateTokens(realisticCreatePayload, "cl100k_base") - honestAiceTokens;
    if (!options.suppressTelemetry && !options.dryRun) {
      recordTelemetryEvent({
        targetPath: fullPath,
        projectRoot: root,
        operation: "create",
        surface: options.surface ?? "cli",
        idiomsUsed: created.idiomsUsed,
        nativeText: created.nativeCode,
        realisticNativeText: realisticCreatePayload,
        aiceText: aiceTelemetryInput,
      });
    }
    return {
      success: true,
      filePath: created.filePath,
      symbol: options.symbol ?? "*",
      startLine: 1,
      endLine: created.nativeCode ? created.nativeCode.split(/\r?\n/).length : 0,
      originalSnippet: fileExists ? prevSource : undefined,
      newSnippet: created.nativeCode,
      diff: options.diff
        ? generateUnifiedDiff(filePath, prevSource, created.nativeCode)
        : undefined,
      modifiedCode: created.nativeCode,
      newFileContent: created.nativeCode,
      newAiceSource: created.nativeCode,
      content: created.nativeCode,
      nativeCode: created.nativeCode,
      aiceInput: created.aiceInput,
      language: created.language,
      targetLanguage: created.targetLanguage,
      declaredIdioms: created.declaredIdioms,
      persistedIdioms: created.persistedIdioms,
      idiomsUsed: created.idiomsUsed,
      nativeTokens: honestNativeTokens,
      aiceTokens: honestAiceTokens,
      tokensSaved: honestTokensSaved,
      realisticTokensSaved: honestRealisticTokensSaved,
      dryRun: created.dryRun,
    };
  }

  if (!fileExists) {
    throw new Error(`Source file not found: ${filePath}`);
  }

  const cliOptionIdioms = {
    ...parseOptionIdioms(options.inlineIdioms),
    ...parseOptionIdioms(options.idiom),
    ...(typeof options.idioms !== "boolean" ? parseOptionIdioms(options.idioms) : {}),
  };
  const hasExplicitIdiomOption =
    options.inlineIdioms !== undefined ||
    options.idiom !== undefined ||
    (options.idioms !== undefined && typeof options.idioms !== "boolean");
  const idiomsToggleOverride =
    typeof options.idioms === "boolean"
      ? options.idioms
      : hasExplicitIdiomOption
        ? true
        : undefined;
  const idiomsEnabled =
    idiomsToggleOverride !== undefined
      ? idiomsToggleOverride
      : config.idiomsEnabled === true && isProjectIdiomsEnabled(config, idiomsToggleOverride);
  const activeIdioms = !idiomsEnabled ? {} : { ...(config.idioms ?? {}), ...cliOptionIdioms };
  const rawSnippetVal =
    options.code ??
    options.body ??
    (hasBatchEdits ? options.edits!.map((e) => e?.code ?? e?.body ?? "").join("\n") : "");
  const snippetInput =
    typeof rawSnippetVal === "string" ? rawSnippetVal : String(rawSnippetVal ?? "");
  const idiomsUsedInSnippet = Boolean(
    idiomsEnabled &&
      activeIdioms &&
      Object.keys(activeIdioms).some((k) => {
        const norm = k.startsWith("$") ? k : `$${k}`;
        return snippetInput.includes(norm);
      }),
  );

  if (!fullPath.endsWith(".aice")) {
    const originalNative =
      options.sourceOverride ?? (await fs.promises.readFile(fullPath, "utf-8"));
    const targetLang = resolveEffectiveSpliceTargetLang(
      fullPath,
      originalNative,
      options.targetLanguage,
    );

    const result = withSuppressedTelemetry(() =>
      spliceNativeSource(
        originalNative,
        options.projectRoot ? options : { ...options, projectRoot: root },
        fullPath,
        activeIdioms,
      ),
    );
    const isLineRangeOrHunkSplice =
      containsHunkMarkers(snippetInput) ||
      Boolean(
        options.symbol &&
          /^(?::?L?\d+\s*(?:-|\.\.|:)\s*L?\d+|:?hunk)$/i.test(options.symbol.trim()),
      ) ||
      Boolean(
        hasBatchEdits &&
          (options.edits ?? []).every(
            (e) =>
              containsHunkMarkers(e.code ?? e.body ?? "") ||
              /^(?::?L?\d+\s*(?:-|\.\.|:)\s*L?\d+|:?hunk)$/i.test((e.symbol ?? "").trim()),
          ),
      );

    if (targetLang === "typescript" || targetLang === "tsx" || targetLang === "javascript") {
      const maskedSnippet = maskSourceLexically(
        result.newSnippet ?? snippetInput,
        targetLang,
      ).maskedCode;
      const snippetIdents = new Set(
        maskedSnippet.match(/(?<![A-Za-z0-9_$])[A-Za-z_$][A-Za-z0-9_$]*(?![A-Za-z0-9_$])/g) ?? [],
      );
      const candidateIdents = Array.from(snippetIdents).filter((id) =>
        isLineRangeOrHunkSplice
          ? /^[A-Z][A-Za-z0-9]*$/.test(id)
          : /^[A-Z$]/.test(id) || id.includes("_"),
      );
      if (candidateIdents.length > 0) {
        const maskedOriginal = maskSourceLexically(originalNative, targetLang).maskedCode;
        const modSf = getCachedTsSourceFile(result.modifiedCode);
        const existingLocalOrImported = new Set<string>();
        const recordBindingNames = (nameNode: ts.BindingName): void => {
          if (ts.isIdentifier(nameNode)) {
            existingLocalOrImported.add(nameNode.text);
          } else {
            for (const elem of nameNode.elements) {
              if (ts.isBindingElement(elem)) {
                recordBindingNames(elem.name);
              }
            }
          }
        };
        for (const st of modSf.statements) {
          if (ts.isImportDeclaration(st) && st.importClause) {
            if (st.importClause.name) {
              existingLocalOrImported.add(st.importClause.name.text);
            }
            const nb = st.importClause.namedBindings;
            if (nb) {
              if (ts.isNamespaceImport(nb)) {
                existingLocalOrImported.add(nb.name.text);
              } else if (ts.isNamedImports(nb)) {
                for (const el of nb.elements) {
                  existingLocalOrImported.add(el.name.text);
                }
              }
            }
          } else if (
            (ts.isFunctionDeclaration(st) ||
              ts.isClassDeclaration(st) ||
              ts.isInterfaceDeclaration(st) ||
              ts.isTypeAliasDeclaration(st) ||
              ts.isEnumDeclaration(st)) &&
            st.name
          ) {
            existingLocalOrImported.add(st.name.text);
          } else if (ts.isVariableStatement(st)) {
            for (const decl of st.declarationList.declarations) {
              recordBindingNames(decl.name);
            }
          }
        }

        const missingIdents = candidateIdents.filter(
          (id) =>
            !existingLocalOrImported.has(id) &&
            !new RegExp(
              `(?<![A-Za-z0-9_$])${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![A-Za-z0-9_$])`,
            ).test(maskedOriginal),
        );
        if (missingIdents.length > 0) {
          const importRe = /^(import\s*\{([^}]+)\}\s*from\s*['"](\.[^'"]+)['"]\s*;?)/gm;
          const siblingImports: Array<{
            fullImp: string;
            specList: string[];
            maskedSibContent: string;
          }> = [];
          let match: RegExpExecArray | null = importRe.exec(result.modifiedCode);
          while (match !== null) {
            const fullImp = match[1];
            const specList = match[2]
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean);
            const relMod = match[3];
            const baseModPath = path.resolve(path.dirname(fullPath), relMod);
            const candidates = [
              baseModPath,
              `${baseModPath}.ts`,
              `${baseModPath}.tsx`,
              `${baseModPath}.js`,
              `${baseModPath.replace(/\.[cm]?js$/, "")}.ts`,
              `${baseModPath.replace(/\.[cm]?js$/, "")}.tsx`,
            ];
            const resolvedSibling = candidates.find(
              (c) => fs.existsSync(c) && fs.statSync(c).isFile(),
            );
            if (resolvedSibling) {
              try {
                const sibContent = fs.readFileSync(resolvedSibling, "utf-8");
                const maskedSibContent = maskSourceLexically(sibContent, targetLang).maskedCode;
                siblingImports.push({ fullImp, specList, maskedSibContent });
              } catch {
                // ignore unreadable sibling
              }
            }
            match = importRe.exec(result.modifiedCode);
          }

          if (siblingImports.length > 0) {
            const exportOwners = new Map<string, number[]>();
            for (const id of missingIdents) {
              const escId = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
              const exportRe = new RegExp(
                `\\bexport\\s+(?:type|interface|const|let|var|class|enum|function)\\s+${escId}(?![A-Za-z0-9_$])`,
              );
              const owners: number[] = [];
              for (let sIdx = 0; sIdx < siblingImports.length; sIdx++) {
                if (exportRe.test(siblingImports[sIdx].maskedSibContent)) {
                  owners.push(sIdx);
                }
              }
              exportOwners.set(id, owners);
            }

            let updatedCode = result.modifiedCode;
            for (let sIdx = 0; sIdx < siblingImports.length; sIdx++) {
              const { fullImp, specList } = siblingImports[sIdx];
              const addedSpecs: string[] = [];
              for (const id of missingIdents) {
                if (specList.some((s) => s.replace(/^type\s+/, "").trim() === id)) continue;
                const owners = exportOwners.get(id) ?? [];
                if (owners.length === 1 && owners[0] === sIdx) {
                  addedSpecs.push(id);
                }
              }
              if (addedSpecs.length > 0) {
                const mergedSpecText = `{ ${[...specList, ...addedSpecs].join(", ")} }`;
                const newImp = fullImp.replace(/\{[^}]+\}/, () => mergedSpecText);
                updatedCode = updatedCode.replace(fullImp, () => newImp);
              }
            }
            result.modifiedCode = updatedCode;
            result.newAiceSource = updatedCode;
          }
        }
      }
    }

    const postValidation = validateNativeSyntax(
      result.modifiedCode,
      targetLang,
      fullPath,
      activeIdioms,
    );
    const pyDupDiag =
      targetLang === "python" ? checkPythonDuplicateParams(result.modifiedCode) : null;
    if (!postValidation.valid || pyDupDiag) {
      const origValidation = validateNativeSyntax(originalNative, targetLang, fullPath);
      const origPyDup = targetLang === "python" ? checkPythonDuplicateParams(originalNative) : null;
      if (origValidation.valid && !origPyDup && !options.force) {
        const diagSummary = [...postValidation.diagnostics, ...(pyDupDiag ? [pyDupDiag] : [])].join(
          "; ",
        );
        const span = computeOriginalEditLineSpan(
          originalNative,
          result.modifiedCode,
          result.symbol ?? options.symbol,
        );
        const numberedCtx = formatSurroundingNumberedContext(
          originalNative,
          span.startLine,
          span.endLine,
          5,
        );
        const ctxSuffix = numberedCtx
          ? `\nContext around L${span.startLine}-L${span.endLine} (±5 lines):\n${numberedCtx}`
          : "";
        throw new Error(
          `Pre-write syntax validation failed for ${filePath} (${targetLang}): ${diagSummary}${ctxSuffix}`,
        );
      }
    }

    if (!options.dryRun) {
      const dir = path.dirname(fullPath);
      await fs.promises.mkdir(dir, { recursive: true });
      const origMode = fs.existsSync(fullPath)
        ? (await fs.promises.stat(fullPath)).mode
        : undefined;
      const tmpFile = path.join(
        dir,
        `.${path.basename(fullPath)}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`,
      );
      try {
        await fs.promises.writeFile(
          tmpFile,
          result.modifiedCode,
          origMode !== undefined ? { encoding: "utf-8", mode: origMode } : "utf-8",
        );
        await fs.promises.rename(tmpFile, fullPath);
      } catch (err) {
        try {
          if (fs.existsSync(tmpFile)) {
            fs.unlinkSync(tmpFile);
          }
        } catch {
          // ignore cleanup error
        }
        throw err;
      }
    }

    result.idiomsUsed = idiomsUsedInSnippet;
    result.dryRun = Boolean(options.dryRun);

    const realisticNativePayload = options.delete
      ? JSON.stringify({
          path: fullPath,
          old_string: result.originalSnippet ?? "",
          new_string: "",
        })
      : result.originalSnippet
        ? JSON.stringify({
            path: fullPath,
            old_string: result.originalSnippet,
            new_string: result.newSnippet ?? snippetInput,
          })
        : JSON.stringify({ path: fullPath, old_string: "", new_string: snippetInput });
    const effectiveAiceInput = rawEnvelopeInput ?? snippetInput;
    if (rawEnvelopeInput !== undefined && rawEnvelopeInput !== snippetInput) {
      const envTokens = estimateTokens(rawEnvelopeInput, "cl100k_base");
      const modTokens = estimateTokens(result.modifiedCode, "cl100k_base");
      result.aiceTokens = envTokens;
      result.tokensSaved = modTokens - envTokens;
      result.realisticTokensSaved =
        estimateTokens(realisticNativePayload, "cl100k_base") - envTokens;
    }

    if (!options.suppressTelemetry && !options.dryRun) {
      const responseMsg = `✔ Spliced symbol '${result.symbol ?? options.symbol ?? ""}' in ${filePath} (${result.tokensSaved ?? 0} tokens saved)`;
      recordTelemetryEvent({
        targetPath: fullPath,
        projectRoot: root,
        operation: "splice",
        surface: options.surface ?? "cli",
        idiomsUsed: idiomsUsedInSnippet,
        nativeText: result.modifiedCode,
        realisticNativeText: realisticNativePayload,
        preservedTriviaTokens: result.preservedTriviaTokens ?? 0,
        aiceText: effectiveAiceInput ? `${effectiveAiceInput}\n${responseMsg}` : responseMsg,
      });
    }
    return result;
  }

  const originalSource = options.sourceOverride ?? (await fs.promises.readFile(fullPath, "utf-8"));
  const result = withSuppressedTelemetry(() => spliceSource(originalSource, options, fullPath));

  // Write atomically to disk unless dryRun
  if (!options.dryRun) {
    const dir = path.dirname(fullPath);
    await fs.promises.mkdir(dir, { recursive: true });
    const origMode = fs.existsSync(fullPath) ? (await fs.promises.stat(fullPath)).mode : undefined;
    const tmpFile = path.join(
      dir,
      `.${path.basename(fullPath)}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`,
    );
    try {
      await fs.promises.writeFile(
        tmpFile,
        result.modifiedCode,
        origMode !== undefined ? { encoding: "utf-8", mode: origMode } : "utf-8",
      );
      await fs.promises.rename(tmpFile, fullPath);
    } catch (err) {
      try {
        if (fs.existsSync(tmpFile)) {
          fs.unlinkSync(tmpFile);
        }
      } catch {
        // ignore cleanup error
      }
      throw err;
    }
  }

  if (options.compile) {
    const { ast: mod, trivia } = parseWithTrivia(result.modifiedCode, fullPath);
    const shouldExpand = isProjectIdiomsEnabled(config, idiomsToggleOverride);
    const expandedMod =
      shouldExpand && config?.idioms ? expandModuleIdioms(mod, config.idioms) : mod;
    const checker = new TypeChecker();
    checker.checkModule(expandedMod);

    let targetLang: TargetLanguage;
    const base = path.basename(fullPath);
    const withoutAice = base.endsWith(".aice") ? base.slice(0, -5) : base;
    const innerExt = path.extname(withoutAice).toLowerCase();
    if (innerExt && KNOWN_TARGET_EXTENSIONS.has(innerExt)) {
      targetLang = detectTargetFromPath(fullPath);
    } else {
      targetLang =
        options.targetLanguage ?? config.targetLanguage ?? detectTargetFromPath(fullPath);
    }

    const emitted = emitTarget(expandedMod, targetLang, {
      trivia,
      watermark: config.watermark,
      idioms: shouldExpand ? config.idioms : undefined,
    });

    if (!options.dryRun) {
      const outPath = fullPath.replace(/\.aice$/, innerExt ? "" : ".ts");
      const outDir = path.dirname(outPath);
      await fs.promises.mkdir(outDir, { recursive: true });
      const outMode = fs.existsSync(outPath) ? (await fs.promises.stat(outPath)).mode : undefined;
      const outTmp = path.join(
        outDir,
        `.${path.basename(outPath)}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`,
      );
      try {
        await fs.promises.writeFile(outTmp, emitted, {
          encoding: "utf-8",
          ...(outMode !== undefined ? { mode: outMode } : {}),
        });
        await fs.promises.rename(outTmp, outPath);
      } catch (err) {
        try {
          if (fs.existsSync(outTmp)) {
            fs.unlinkSync(outTmp);
          }
        } catch {
          // ignore cleanup error
        }
        throw err;
      }
    }
  }

  result.idiomsUsed = idiomsUsedInSnippet;
  result.dryRun = Boolean(options.dryRun);

  if (!options.suppressTelemetry && !options.dryRun) {
    const responseMsg = `✔ Spliced symbol '${result.symbol ?? options.symbol ?? ""}' in ${filePath} (${result.tokensSaved ?? 0} tokens saved)`;
    const realisticNativePayload = options.delete
      ? JSON.stringify({
          path: fullPath,
          old_string: result.originalSnippet ?? "",
          new_string: "",
        })
      : result.originalSnippet
        ? JSON.stringify({
            path: fullPath,
            old_string: result.originalSnippet,
            new_string: result.newSnippet ?? snippetInput,
          })
        : JSON.stringify({ path: fullPath, old_string: "", new_string: snippetInput });
    const effectiveAiceInput = rawEnvelopeInput ?? snippetInput;
    recordTelemetryEvent({
      targetPath: fullPath,
      projectRoot: root,
      operation: "splice",
      surface: options.surface ?? "cli",
      idiomsUsed: idiomsUsedInSnippet,
      nativeText: result.modifiedCode,
      realisticNativeText: realisticNativePayload,
      preservedTriviaTokens: result.preservedTriviaTokens ?? 0,
      aiceText: effectiveAiceInput ? `${effectiveAiceInput}\n${responseMsg}` : responseMsg,
    });
  }

  return result;
}

/**
 * Executes a batch of splices and/or file creations across one or more files atomically.
 * If any item in the batch fails, all created and modified files are rolled back to their exact original state.
 */
export async function spliceBatch(
  itemsOrStream: BatchSpliceItem[] | string,
  optionsOrProjectRoot: BatchSpliceOptions | string = {},
): Promise<BatchSpliceResult> {
  const options: BatchSpliceOptions =
    typeof optionsOrProjectRoot === "string"
      ? { projectRoot: optionsOrProjectRoot }
      : (optionsOrProjectRoot ?? {});
  const items: BatchSpliceItem[] =
    typeof itemsOrStream === "string"
      ? (parseMultiBlockSpliceStream(itemsOrStream)?.batchItems ?? [])
      : itemsOrStream;
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error(
      typeof itemsOrStream === "string"
        ? `spliceBatch failed to parse any valid '=== <filePath> ===' or '=== <filePath>:<symbol> ===' blocks from stream${!itemsOrStream.trim() ? " (empty input stream)" : ""}`
        : "spliceBatch requires a non-empty array of file creation or splice items",
    );
  }

  const baseDir = options.projectRoot ? path.resolve(options.projectRoot) : process.cwd();
  const backups = new Map<string, Buffer>();
  const virtualFs = new Map<string, string>();
  const configSnapshots = new Map<string, string | null>();
  const newlyCreatedFiles: string[] = [];
  const newlyCreatedDirs: string[] = [];
  const sessionDeclaredIdioms: Record<string, ProjectIdiomDefinition> = {};

  const recordMissingParentDirs = (targetFp: string): void => {
    const pending: string[] = [];
    let cur = path.dirname(targetFp);
    const parsedRoot = path.parse(cur).root;
    while (cur && cur !== parsedRoot && !fs.existsSync(cur)) {
      pending.push(cur);
      const next = path.dirname(cur);
      if (next === cur) break;
      cur = next;
    }
    for (const dir of pending) {
      if (!newlyCreatedDirs.includes(dir)) {
        newlyCreatedDirs.push(dir);
      }
    }
  };

  if (options.projectRoot) {
    const explicitRoot = path.resolve(options.projectRoot);
    for (const cfgFile of [
      path.join(explicitRoot, "aice.config.json"),
      path.join(explicitRoot, ".aice-idioms.json"),
      path.join(explicitRoot, ".aice-cache", "idioms.json"),
    ]) {
      configSnapshots.set(
        cfgFile,
        fs.existsSync(cfgFile) ? fs.readFileSync(cfgFile, "utf-8") : null,
      );
    }
  }

  for (const item of items) {
    if (!item || typeof item !== "object") {
      throw new Error(
        "Invalid batch item: expected an object with 'filePath' and replacement payload",
      );
    }
    const rawFp =
      typeof (item.filePath || item.file || item.path) === "string"
        ? item.filePath || item.file || item.path || ""
        : "";
    if (!rawFp) continue;
    const splitFp = splitInlineFileSelector(rawFp, baseDir).filePath;
    const fullPath = path.isAbsolute(splitFp) ? splitFp : path.resolve(baseDir, splitFp);
    if (fs.existsSync(fullPath) && !backups.has(fullPath)) {
      backups.set(fullPath, fs.readFileSync(fullPath));
    }
  }

  const results: SpliceResult[] = [];
  const modifiedSet = new Set<string>();
  const pendingTelemetry: Array<Parameters<typeof recordTelemetryEvent>[0]> = [];
  let totalNativeTokens = 0;
  let totalAiceTokens = 0;
  let totalTokensSaved = 0;

  try {
    for (const item of items) {
      if (!item || typeof item !== "object") {
        throw new Error(
          "Invalid batch item: expected an object with 'filePath' and replacement payload",
        );
      }
      const rawFpVal = item.filePath || item.file || item.path || "";
      const rawFp = typeof rawFpVal === "string" ? rawFpVal : String(rawFpVal ?? "");
      if (!rawFp.trim()) {
        throw new Error("Each batch item must include a 'filePath' (or 'file' / 'path') property");
      }
      const splitTarget = splitInlineFileSelector(rawFp, baseDir);
      const effectiveSymbol = item.symbol ?? splitTarget.inlineSelector;
      const fullPath = path.isAbsolute(splitTarget.filePath)
        ? splitTarget.filePath
        : path.resolve(baseDir, splitTarget.filePath);
      const itemDryRun = Boolean(item.dryRun ?? options.dryRun);
      const itemProjectRoot = item.projectRoot ?? options.projectRoot;
      const rootForItem = resolveTargetProjectRoot(fullPath, itemProjectRoot);
      const effectiveSurface = item.surface ?? options.surface ?? "cli";

      for (const cfgFile of [
        path.join(rootForItem, "aice.config.json"),
        path.join(rootForItem, ".aice-idioms.json"),
        path.join(rootForItem, ".aice-cache", "idioms.json"),
      ]) {
        if (!configSnapshots.has(cfgFile)) {
          configSnapshots.set(
            cfgFile,
            fs.existsSync(cfgFile) ? fs.readFileSync(cfgFile, "utf-8") : null,
          );
        }
      }

      const existedBeforeBatch = backups.has(fullPath);
      const fileExistsNow = virtualFs.has(fullPath) || fs.existsSync(fullPath);
      let resolvedCode =
        item.code ??
        item.aice ??
        item.template ??
        item.snippet ??
        item.content ??
        item.replacement ??
        options.code;
      const itemFrom = item.from ?? options.from;
      if ((resolvedCode === undefined || resolvedCode === "") && itemFrom) {
        const fromPath = path.isAbsolute(itemFrom) ? itemFrom : path.resolve(baseDir, itemFrom);
        if (!fs.existsSync(fromPath)) {
          throw new Error(`Input file --from not found: ${itemFrom}`);
        }
        resolvedCode = fs.readFileSync(fromPath, "utf-8");
      }

      const hasItemPayload =
        resolvedCode !== undefined ||
        item.body !== undefined ||
        Boolean(item.edits && item.edits.length > 0);

      const batchItemPayloadForGuard = [
        resolvedCode,
        item.body,
        ...(item.edits ?? []).map((e) => e?.code ?? e?.body ?? ""),
      ]
        .filter((s): s is string => typeof s === "string")
        .join("\n");
      assertSafeTextWriteTarget(fullPath, batchItemPayloadForGuard, {
        checkExistingDiskFile: !virtualFs.has(fullPath),
      });

      if (!item.delete && !item.cloneFrom && !hasItemPayload) {
        throw new Error(
          `Must provide replacement code, edits, or delete for batch target '${rawFp}'.`,
        );
      }

      const hasHunkInItem =
        containsHunkMarkers(resolvedCode ?? item.body ?? "") ||
        Boolean(item.edits && item.edits.some((e) => containsHunkMarkers(e.code ?? e.body ?? "")));

      if (!fileExistsNow && hasHunkInItem) {
        throw new Error(
          `Source file not found: ${splitTarget.filePath} (cannot apply <<< === >>> hunk to a non-existent file)`,
        );
      }

      const hasLineRangeInBatchItem =
        isLineRangeEditSelector(effectiveSymbol) ||
        Boolean(item.edits && item.edits.some((e) => isLineRangeEditSelector(e.symbol)));

      if (
        !fileExistsNow &&
        hasLineRangeInBatchItem &&
        !item.create &&
        !(item.overwrite ?? options.overwrite)
      ) {
        throw new Error(
          `Source file not found: ${splitTarget.filePath} (cannot splice line range on a non-existent file)`,
        );
      }

      const mergedInlineIdioms:
        | string
        | string[]
        | Record<string, string | ProjectIdiomDefinition>
        | undefined =
        Object.keys(sessionDeclaredIdioms).length > 0
          ? {
              ...sessionDeclaredIdioms,
              ...parseOptionIdioms(options.inlineIdioms),
              ...parseOptionIdioms(options.idiom),
              ...parseOptionIdioms(item.inlineIdioms),
              ...parseOptionIdioms(item.idiom),
            }
          : (item.inlineIdioms ?? options.inlineIdioms);

      const isExplicitCreateSym = Boolean(
        item.create || (effectiveSymbol && /^:?create$/i.test(effectiveSymbol.trim())),
      );
      const isExplicitOverwriteSym = Boolean(
        effectiveSymbol && /^:?(?:overwrite|\*)$/i.test(effectiveSymbol.trim()),
      );

      const isCreateRoute =
        !item.delete &&
        !item.cloneFrom &&
        !hasHunkInItem &&
        (!fileExistsNow ||
          (!item.append &&
            !item.insertAfter &&
            !item.insert_after &&
            !item.insertBefore &&
            !item.insert_before &&
            (!item.edits || item.edits.length === 0) &&
            (isCreateOrOverwriteSymbol(effectiveSymbol) || isExplicitCreateSym)));

      if (isCreateRoute) {
        const createPayload =
          resolvedCode ??
          item.body ??
          (item.edits
            ? item.edits
                .filter((e) => !e.delete)
                .map((e) => e.code ?? e.body ?? "")
                .filter(Boolean)
                .join("\n\n")
            : "");
        const explicitOverwriteOrCreateSym = Boolean(
          effectiveSymbol && /^:?(?:overwrite|create|\*)$/i.test(effectiveSymbol.trim()),
        );
        const itemOverwriteOpt = item.overwrite ?? options.overwrite;
        const itemForceOpt = item.force ?? options.force;

        if (
          fileExistsNow &&
          createPayload === "" &&
          !itemOverwriteOpt &&
          !itemForceOpt &&
          !item.create &&
          !explicitOverwriteOrCreateSym
        ) {
          throw new Error(
            `Refusing to overwrite existing file '${splitTarget.filePath}' with empty content without --overwrite or ':overwrite'.`,
          );
        }

        const effectiveItemOverwrite =
          itemOverwriteOpt === false && !itemForceOpt && !isExplicitOverwriteSym
            ? false
            : Boolean(
                fileExistsNow || itemOverwriteOpt || itemForceOpt || explicitOverwriteOrCreateSym,
              );

        if (!itemDryRun && !existedBeforeBatch) {
          recordMissingParentDirs(fullPath);
        }

        const itemCfg = loadProjectConfig(rootForItem);
        const rawItemIdioms = item.idioms ?? options.idioms;
        const hasInlineBatchIdiomDecl = /^\s*@idiom\s+\$[A-Za-z_]/m.test(createPayload);
        const effectiveBatchCreateIdioms =
          rawItemIdioms !== undefined
            ? rawItemIdioms
            : mergedInlineIdioms !== undefined ||
                item.idiom !== undefined ||
                options.idiom !== undefined ||
                hasInlineBatchIdiomDecl
              ? true
              : itemCfg.idiomsEnabled === true && isProjectIdiomsEnabled(itemCfg);
        let createRes: Awaited<ReturnType<typeof createFile>>;
        try {
          createRes = await createFile(fullPath, {
            code: createPayload,
            from: itemFrom,
            overwrite: effectiveItemOverwrite,
            force: itemForceOpt,
            dryRun: itemDryRun,
            idioms: effectiveBatchCreateIdioms,
            inlineIdioms: mergedInlineIdioms,
            idiom:
              Object.keys(sessionDeclaredIdioms).length > 0
                ? undefined
                : (item.idiom ?? options.idiom),
            projectRoot: rootForItem,
            surface: effectiveSurface,
            targetLanguage: item.targetLanguage ?? options.targetLanguage,
            suppressTelemetry: true,
          });
        } catch (err) {
          if (err instanceof Error && /pre-write syntax validation/i.test(err.message)) {
            const tip = fileExistsNow
              ? `\nTip: Fix the syntax error on the reported line before retrying, or splice surgically via === ${splitTarget.filePath}:<symbol> === or === ${splitTarget.filePath}:L<start>-L<end> === on existing files.`
              : "\nTip: Fix the syntax error on the reported line before retrying (or use :sym / :Lstart-Lend when editing existing files).";
            if (!err.message.includes("Tip:")) {
              throw new Error(`${err.message}${tip}`);
            }
          }
          throw err;
        }

        if (Object.keys(createRes.declaredIdioms).length > 0) {
          Object.assign(sessionDeclaredIdioms, createRes.declaredIdioms);
        }

        const honestCreateNativeTok = estimateTokens(createRes.nativeCode, "cl100k_base");
        const honestCreateAiceTok = estimateTokens(createPayload, "cl100k_base");
        const honestCreateSavedTok = honestCreateNativeTok - honestCreateAiceTok;

        if (itemDryRun) {
          virtualFs.set(fullPath, createRes.nativeCode);
        } else {
          if (!existedBeforeBatch && !newlyCreatedFiles.includes(fullPath)) {
            newlyCreatedFiles.push(fullPath);
          }
          pendingTelemetry.push({
            targetPath: fullPath,
            projectRoot: rootForItem,
            operation: "create",
            surface: effectiveSurface,
            idiomsUsed: createRes.idiomsUsed,
            nativeText: createRes.nativeCode,
            realisticNativeText: JSON.stringify({
              path: fullPath,
              content: createRes.nativeCode,
            }),
            aiceText: createPayload,
          });
        }
        totalNativeTokens += honestCreateNativeTok;
        totalAiceTokens += honestCreateAiceTok;
        totalTokensSaved += honestCreateSavedTok;

        results.push({
          success: true,
          filePath: createRes.filePath,
          symbol: effectiveSymbol || ":create",
          startLine: 1,
          endLine: createRes.nativeCode ? createRes.nativeCode.split(/\r?\n/).length : 0,
          modifiedCode: createRes.nativeCode,
          newFileContent: createRes.nativeCode,
          newAiceSource: createRes.nativeCode,
          content: createRes.nativeCode,
          nativeCode: createRes.nativeCode,
          aiceInput: createRes.aiceInput,
          language: createRes.language,
          targetLanguage: createRes.targetLanguage,
          declaredIdioms: createRes.declaredIdioms,
          persistedIdioms: createRes.persistedIdioms,
          idiomsUsed: createRes.idiomsUsed,
          nativeTokens: honestCreateNativeTok,
          aiceTokens: honestCreateAiceTok,
          tokensSaved: honestCreateSavedTok,
          dryRun: itemDryRun,
        });
        modifiedSet.add(createRes.filePath);
        continue;
      }

      if (!itemDryRun && !existedBeforeBatch) {
        recordMissingParentDirs(fullPath);
      }

      const res = await splice(fullPath, {
        ...item,
        symbol: effectiveSymbol,
        code: resolvedCode,
        from: itemFrom,
        insertAfter: item.insertAfter ?? item.insert_after,
        insertBefore: item.insertBefore ?? item.insert_before,
        projectRoot: rootForItem,
        dryRun: itemDryRun,
        compile: item.compile ?? options.compile,
        idioms: item.idioms ?? options.idioms,
        inlineIdioms: mergedInlineIdioms,
        idiom:
          Object.keys(sessionDeclaredIdioms).length > 0 ? undefined : (item.idiom ?? options.idiom),
        overwrite: item.overwrite ?? options.overwrite,
        force: item.force ?? options.force,
        preserveDocs: item.preserveDocs ?? options.preserveDocs,
        surface: effectiveSurface,
        targetLanguage: item.targetLanguage ?? options.targetLanguage,
        sourceOverride: itemDryRun ? virtualFs.get(fullPath) : undefined,
        suppressTelemetry: true,
      });
      if (itemDryRun) {
        virtualFs.set(fullPath, res.modifiedCode);
      } else {
        if (!existedBeforeBatch && !newlyCreatedFiles.includes(fullPath)) {
          newlyCreatedFiles.push(fullPath);
        }
        const snippetInput =
          resolvedCode ??
          item.body ??
          (item.edits ? item.edits.map((e) => e.code ?? e.body ?? "").join("\n") : "");
        const realisticNativePayload = item.delete
          ? JSON.stringify({
              path: fullPath,
              old_string: res.originalSnippet ?? "",
              new_string: "",
            })
          : res.originalSnippet
            ? JSON.stringify({
                path: fullPath,
                old_string: res.originalSnippet,
                new_string: res.newSnippet ?? snippetInput,
              })
            : JSON.stringify({
                path: fullPath,
                content: res.modifiedCode || snippetInput,
              });
        pendingTelemetry.push({
          targetPath: fullPath,
          projectRoot: rootForItem,
          operation: "splice",
          surface: effectiveSurface,
          idiomsUsed: Boolean(res.idiomsUsed),
          nativeText: res.modifiedCode,
          realisticNativeText: realisticNativePayload,
          preservedTriviaTokens: res.preservedTriviaTokens ?? 0,
          aiceText: snippetInput,
        });
      }
      const itemSaved = res.tokensSaved ?? 0;
      const itemNativeTok = res.nativeTokens ?? estimateTokens(res.modifiedCode, "cl100k_base");
      const itemAiceTok = res.aiceTokens ?? Math.max(0, itemNativeTok - itemSaved);
      totalNativeTokens += itemNativeTok;
      totalAiceTokens += itemAiceTok;
      totalTokensSaved += itemSaved;

      results.push(res);
      modifiedSet.add(res.filePath);
    }
  } catch (err) {
    for (const createdFp of newlyCreatedFiles) {
      try {
        if (fs.existsSync(createdFp)) {
          fs.unlinkSync(createdFp);
        }
      } catch {
        // ignore
      }
    }
    const dirsLeafFirst = [...newlyCreatedDirs].sort((a, b) => b.length - a.length);
    for (const createdDir of dirsLeafFirst) {
      try {
        if (fs.existsSync(createdDir) && fs.readdirSync(createdDir).length === 0) {
          fs.rmdirSync(createdDir);
        }
      } catch {
        // ignore
      }
    }
    for (const [fp, origContent] of backups.entries()) {
      if (!modifiedSet.has(fp)) continue;
      try {
        fs.mkdirSync(path.dirname(fp), { recursive: true });
        fs.writeFileSync(fp, origContent);
      } catch {
        // ignore
      }
    }
    for (const [cfgFp, prevContent] of configSnapshots.entries()) {
      try {
        if (prevContent === null) {
          if (fs.existsSync(cfgFp)) {
            fs.unlinkSync(cfgFp);
            const parentDir = path.dirname(cfgFp);
            if (
              path.basename(parentDir) === ".aice-cache" &&
              fs.existsSync(parentDir) &&
              fs.readdirSync(parentDir).length === 0
            ) {
              fs.rmdirSync(parentDir);
            }
          }
        } else {
          fs.mkdirSync(path.dirname(cfgFp), { recursive: true });
          fs.writeFileSync(cfgFp, prevContent, "utf-8");
        }
      } catch {
        // ignore
      }
    }
    throw err;
  }

  const modifiedFiles = Array.from(modifiedSet);
  if (!options.dryRun && pendingTelemetry.length > 0) {
    const batchTs = new Date().toISOString();
    const batchSummaryLine = `✔ Batch spliced ${results.length} item(s) across ${modifiedFiles.length} file(s) (${totalTokensSaved} tokens saved)`;
    for (let idx = 0; idx < pendingTelemetry.length; idx++) {
      const ev = pendingTelemetry[idx]!;
      recordTelemetryEvent({
        ...ev,
        timestamp: batchTs,
        aiceText:
          idx === 0
            ? ev.aiceText
              ? `${ev.aiceText}\n${batchSummaryLine}`
              : batchSummaryLine
            : ev.aiceText,
      });
    }
  }
  return {
    success: true,
    results,
    modifiedFiles,
    createdFiles: newlyCreatedFiles,
    totalFiles: modifiedFiles.length,
    totalEdits: results.length,
    totalNativeTokens,
    totalAiceTokens,
    totalTokensSaved,
  };
}
