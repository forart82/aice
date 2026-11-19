/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Inline target parsing, multi-target splitting, and multi-context result merging.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { isLikelyTextFileShape, type ProjectIdiomDefinition } from "../../config/index.js";
import { formatIdiomsMarkdownSection } from "../../idioms/index.js";
import { estimateTokens } from "../../tokenomics/index.js";
import { generateExternalContract } from "./imports-and-deps.js";
import type { CallerSummary, ContextOptions, ContextResult, DependencyContract } from "./types.js";

export function parseTargetWithInlineSymbol(
  rawTarget: string,
  baseDir = process.cwd(),
): { targetPath: string; inlineSymbol?: string } {
  const trimmed = rawTarget.trim();
  const searchStart = /^[a-zA-Z]:[\\/]/.test(trimmed) ? 2 : 0;
  const colonIdx = trimmed.indexOf(":", searchStart);
  if (colonIdx > 0) {
    const candidateFile = trimmed.slice(0, colonIdx).trim();
    const candidateSym = trimmed.slice(colonIdx + 1).trim();
    if (candidateFile && candidateSym) {
      const absCand = path.isAbsolute(candidateFile)
        ? candidateFile
        : path.resolve(baseDir, candidateFile);
      if (fs.existsSync(absCand) || isLikelyTextFileShape(candidateFile)) {
        return { targetPath: candidateFile, inlineSymbol: candidateSym };
      }
    }
  }
  return { targetPath: trimmed };
}

export function splitContextTargets(rawTargetStr: string, baseDir = process.cwd()): string[] {
  const trimmed = rawTargetStr.trim();
  if (!trimmed || !/\s+/.test(trimmed)) {
    return trimmed ? [trimmed] : [];
  }

  // Tokenize respecting double/single quotes
  const rawTokens: string[] = [];
  let hadQuotes = false;
  let cur = "";
  let quoteChar: string | null = null;
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i]!;
    if (quoteChar) {
      if (ch === "\\" && i + 1 < trimmed.length) {
        cur += trimmed[i + 1]!;
        i++;
        continue;
      }
      if (ch === quoteChar) {
        quoteChar = null;
        continue;
      }
      cur += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quoteChar = ch;
      hadQuotes = true;
      continue;
    }
    if (/\s/.test(ch)) {
      if (cur) {
        rawTokens.push(cur);
        cur = "";
      }
      continue;
    }
    cur += ch;
  }
  if (cur) rawTokens.push(cur);

  if (rawTokens.length <= 1) {
    return rawTokens.length === 1 ? [rawTokens[0]!] : [trimmed];
  }
  if (hadQuotes) {
    return rawTokens;
  }

  const targetExistsOnDisk = (targetCandidate: string): boolean => {
    const abs = path.isAbsolute(targetCandidate)
      ? targetCandidate
      : path.resolve(baseDir, targetCandidate);
    return fs.existsSync(abs) || fs.existsSync(`${abs}.aice`);
  };

  // First check if the entire unquoted string is a single existing target (e.g. path with spaces)
  const wholeCheck = parseTargetWithInlineSymbol(trimmed, baseDir);
  if (targetExistsOnDisk(wholeCheck.targetPath)) {
    if (!wholeCheck.inlineSymbol || !/\s/.test(wholeCheck.inlineSymbol)) {
      return [trimmed];
    }
    // Whole targetPath exists and inlineSymbol contains spaces (e.g. `README.md:Update Makefile` or `src/a.ts:fnA src/b.ts:fnB`)
    const symWords = wholeCheck.inlineSymbol.split(/\s+/).filter(Boolean);
    const tailWords = symWords.slice(1);
    const hasExplicitNextTarget = tailWords.some((w) => {
      const parsedW = parseTargetWithInlineSymbol(w, baseDir);
      if (parsedW.inlineSymbol) return true;
      if (w.includes("/") || w.includes("\\")) return true;
      const firstExt = path.extname(wholeCheck.targetPath).toLowerCase();
      const isDocOrTest =
        firstExt === ".md" ||
        firstExt === ".markdown" ||
        /\.(?:test|spec)\.[a-z0-9]+$/i.test(wholeCheck.targetPath);
      if (!isDocOrTest && isLikelyTextFileShape(parsedW.targetPath)) {
        return true;
      }
      return false;
    });
    if (!hasExplicitNextTarget) {
      return [trimmed];
    }
  }

  // Greedily recombine tokens if a path with spaces exists on disk (e.g. `/tmp/my dir/a.ts:fnA /tmp/my dir/b.ts:fnB`)
  const mergedTokens: string[] = [];
  let idx = 0;
  while (idx < rawTokens.length) {
    const tok = rawTokens[idx]!;
    const tokParsed = parseTargetWithInlineSymbol(tok, baseDir);
    const tokIsFile =
      (targetExistsOnDisk(tokParsed.targetPath) &&
        (() => {
          try {
            const abs = path.isAbsolute(tokParsed.targetPath)
              ? tokParsed.targetPath
              : path.resolve(baseDir, tokParsed.targetPath);
            return fs.existsSync(abs) && fs.statSync(abs).isFile();
          } catch {
            return false;
          }
        })()) ||
      isLikelyTextFileShape(tokParsed.targetPath);
    if (!tokIsFile && idx + 1 < rawTokens.length) {
      let combined = tok;
      let matchedSpan = -1;
      for (let j = idx + 1; j < rawTokens.length; j++) {
        combined += ` ${rawTokens[j]!}`;
        const combParsed = parseTargetWithInlineSymbol(combined, baseDir);
        if (
          targetExistsOnDisk(combParsed.targetPath) &&
          (!combParsed.inlineSymbol || !/\s/.test(combParsed.inlineSymbol))
        ) {
          matchedSpan = j;
          break;
        }
      }
      if (matchedSpan > idx) {
        mergedTokens.push(rawTokens.slice(idx, matchedSpan + 1).join(" "));
        idx = matchedSpan + 1;
        continue;
      }
    }
    mergedTokens.push(tok);
    idx++;
  }

  if (mergedTokens.length > 1) {
    const allLookLikeTargets = mergedTokens.every((tok) => {
      const p = parseTargetWithInlineSymbol(tok, baseDir).targetPath;
      return targetExistsOnDisk(p) || isLikelyTextFileShape(p);
    });
    if (allLookLikeTargets) {
      return mergedTokens;
    }
  }
  return [trimmed];
}

export function mergeMultiContextResults(
  results: ContextResult[],
  options: ContextOptions = {},
): ContextResult & { results: ContextResult[] } {
  if (results.length === 0) {
    return {
      targetPath: "",
      targetContent: "",
      dependencies: [],
      callers: [],
      formattedBundle: "# AICE Multi-File Context Stream (0 targets)\n",
      tokenCount: 0,
      results: [],
    };
  }
  if (results.length === 1) {
    return { ...results[0]!, results };
  }

  // 1. Merge & deduplicate Imported Dependency Contracts across all targets
  const mergedDeps: DependencyContract[] = [];
  const depByKey = new Map<string, DependencyContract>();

  for (const res of results) {
    for (const dep of res.dependencies) {
      const key = dep.isExternal
        ? `ext:${dep.specifier}`
        : dep.resolvedPath
          ? `res:${dep.resolvedPath}`
          : `spec:${dep.specifier}`;
      const existing = depByKey.get(key);
      if (!existing) {
        const cloned: DependencyContract = {
          ...dep,
          importedSymbols: [...dep.importedSymbols],
        };
        depByKey.set(key, cloned);
        mergedDeps.push(cloned);
      } else {
        let addedNewSym = false;
        for (const sym of dep.importedSymbols) {
          if (!existing.importedSymbols.includes(sym)) {
            existing.importedSymbols.push(sym);
            addedNewSym = true;
          }
        }
        if (dep.contract && dep.contract !== existing.contract) {
          if (existing.isExternal) {
            existing.contract = generateExternalContract(
              existing.specifier,
              existing.importedSymbols,
            );
          } else if (addedNewSym && existing.resolvedPath) {
            const existingLines = new Set(existing.contract.split("\n").map((l) => l.trim()));
            const extraLines = dep.contract
              .split("\n")
              .filter((l) => l.trim().length > 0 && !existingLines.has(l.trim()));
            if (extraLines.length > 0) {
              existing.contract = `${existing.contract}\n${extraLines.join("\n")}`;
            }
          }
        }
      }
    }
  }

  // 2. Merge & deduplicate Downstream Callers across all targets
  const mergedCallers: CallerSummary[] = [];
  const callerByKey = new Map<string, CallerSummary>();

  for (const res of results) {
    for (const caller of res.callers) {
      const key = `${caller.filePath}::${caller.usedSymbol ?? ""}`;
      const existing = callerByKey.get(key);
      if (!existing) {
        const cloned: CallerSummary = {
          ...caller,
          importedSymbols: [...caller.importedSymbols],
          ...(caller.callSiteLines ? { callSiteLines: [...caller.callSiteLines] } : {}),
        };
        callerByKey.set(key, cloned);
        mergedCallers.push(cloned);
      } else {
        for (const sym of caller.importedSymbols) {
          if (!existing.importedSymbols.includes(sym)) {
            existing.importedSymbols.push(sym);
          }
        }
        if (caller.callSiteLines && caller.callSiteLines.length > 0) {
          const lineSet = new Set<number>(existing.callSiteLines ?? []);
          for (const l of caller.callSiteLines) lineSet.add(l);
          existing.callSiteLines = Array.from(lineSet).sort((a, b) => a - b);
        }
        if (caller.line < existing.line) {
          existing.line = caller.line;
        }
      }
    }
  }

  // 3. Merge idioms & diagnostics
  const mergedIdioms: Record<string, ProjectIdiomDefinition> = {};
  const diagParts: string[] = [];
  for (const res of results) {
    if (res.idioms) {
      Object.assign(mergedIdioms, res.idioms);
    }
    if (res.nativeDiagnostics) {
      diagParts.push(res.nativeDiagnostics);
    }
  }

  const targetPathsList = results.map((r) => r.targetPath);
  const lines: string[] = [];
  lines.push(
    `# AICE Multi-File Context Stream (${results.length} targets: ${targetPathsList.join(", ")})`,
  );
  lines.push("");
  const isZeroMatchRegexResult = (r: ContextResult): boolean => {
    const t = r.targetContent.trim();
    return t.startsWith("// Pattern '") || t.startsWith("// Patterns '");
  };
  const hasPositiveRegexMatch =
    results.length > 1 &&
    results.some((r) => !isZeroMatchRegexResult(r)) &&
    results.some((r) => isZeroMatchRegexResult(r));
  const zeroMatchPaths = hasPositiveRegexMatch
    ? results.filter((r) => isZeroMatchRegexResult(r)).map((r) => r.targetPath)
    : [];
  const activeResults = hasPositiveRegexMatch
    ? results.filter((r) => !isZeroMatchRegexResult(r))
    : results;

  const hasExplicitMultiOptIn =
    options.includeDeps === true ||
    options.includeCallers === true ||
    (options.depth !== undefined && options.depth > 0);
  const isMinimalFormattedResult = (fb: string): boolean =>
    fb.startsWith("// ") || (!fb.startsWith("# AICE ") && !fb.includes("\n## Imported Dependency"));
  const allMinimalTargets =
    !hasExplicitMultiOptIn &&
    mergedDeps.length === 0 &&
    mergedCallers.length === 0 &&
    activeResults.every((r) => isMinimalFormattedResult(r.formattedBundle));

  if (allMinimalTargets) {
    const useCompactMulti = Boolean(
      options.rawNative || options.surface === "cli" || options.surface === "mcp",
    );
    const minimalCombinedTargetContents: string[] = [];
    const minimalBlocks: string[] = [];
    for (const r of activeResults) {
      if (!options.outlineTarget && useCompactMulti) {
        const fb = r.formattedBundle;
        const blockText = fb.startsWith("// ") ? fb : `// ${r.targetPath}\n${fb}`;
        minimalCombinedTargetContents.push(blockText);
        minimalBlocks.push(blockText);
      } else {
        const body = options.outlineTarget && r.targetOutline ? r.targetOutline : r.targetContent;
        const firstHeaderLine =
          !options.outlineTarget && r.formattedBundle.startsWith("// ")
            ? (r.formattedBundle.split("\n")[0] ??
              (useCompactMulti ? `// ${r.targetPath}` : `// === ${r.targetPath} ===`))
            : useCompactMulti
              ? `// ${r.targetPath}`
              : `// === ${r.targetPath} ===`;
        const blockText = `${firstHeaderLine}\n${body}`;
        minimalCombinedTargetContents.push(blockText);
        minimalBlocks.push(blockText);
      }
    }
    if (zeroMatchPaths.length > 0) {
      const zeroSummary = `// 0 matches in: ${zeroMatchPaths.join(", ")}`;
      minimalCombinedTargetContents.push(zeroSummary);
      minimalBlocks.push(zeroSummary);
    }
    const mergedIdiomEntries = Object.entries(mergedIdioms);
    const anyTargetUsesMergedIdioms =
      mergedIdiomEntries.length > 0 &&
      minimalBlocks.some((blk) =>
        mergedIdiomEntries.some(([k]) => blk.includes(k.startsWith("$") ? k : `$${k}`)),
      );
    if (anyTargetUsesMergedIdioms) {
      minimalBlocks.push(formatIdiomsMarkdownSection(mergedIdioms));
    }
    if (diagParts.length > 0) {
      minimalBlocks.push(diagParts.join("\n\n"));
    }
    let minFormattedBundle = minimalBlocks.join("\n\n");
    let minTokenCount = estimateTokens(minFormattedBundle);
    if (options.maxTokens !== undefined && minTokenCount > options.maxTokens) {
      const truncatedFooter = "\n\n// ... [truncated to fit maxTokens]";
      let chars = minFormattedBundle.length;
      while (
        chars > 0 &&
        estimateTokens(minFormattedBundle.slice(0, chars) + truncatedFooter) > options.maxTokens
      ) {
        chars = Math.floor(chars * 0.7);
      }
      if (
        estimateTokens(minFormattedBundle.slice(0, chars) + truncatedFooter) <= options.maxTokens
      ) {
        minFormattedBundle =
          (chars > 0 ? minFormattedBundle.slice(0, chars) : "") + truncatedFooter;
      } else {
        minFormattedBundle = truncatedFooter;
        while (
          minFormattedBundle.length > 0 &&
          estimateTokens(minFormattedBundle) > options.maxTokens
        ) {
          minFormattedBundle = minFormattedBundle.slice(0, -1);
        }
      }
      minTokenCount = estimateTokens(minFormattedBundle);
    }
    return {
      targetPath: targetPathsList.join(", "),
      targetContent: minimalCombinedTargetContents.join("\n\n"),
      dependencies: [],
      callers: [],
      formattedBundle: minFormattedBundle,
      tokenCount: minTokenCount,
      nativeDiagnostics: diagParts.length > 0 ? diagParts.join("\n\n") : undefined,
      results,
    };
  }

  lines.push(`## Target File Content (${activeResults.length} files):`);
  const combinedTargetContents: string[] = [];
  for (let i = 0; i < activeResults.length; i++) {
    const r = activeResults[i]!;
    const body = options.outlineTarget && r.targetOutline ? r.targetOutline : r.targetContent;
    combinedTargetContents.push(`// === ${r.targetPath} ===\n${body}`);
    lines.push(`### Target: \`${r.targetPath}\``);
    lines.push("```aice");
    const isTargetNonAst = /\.(?:ya?ml|cff|jsonc?|md|markdown|sh|bash|zsh|ps1|cmd|bat)$/i.test(
      r.targetPath,
    );
    const targetIdioms = r.idioms ?? mergedIdioms;
    const targetUsesIdioms =
      targetIdioms &&
      Object.keys(targetIdioms).some((k) => {
        const norm = k.startsWith("$") ? k : `$${k}`;
        return body.includes(norm);
      });
    const shouldEmitTargetIdioms = Boolean(
      targetIdioms &&
        Object.keys(targetIdioms).length > 0 &&
        (!isTargetNonAst || targetUsesIdioms) &&
        !body.includes("# @idioms available:"),
    );
    if (shouldEmitTargetIdioms && targetIdioms) {
      const idiomNames = Object.entries(targetIdioms)
        .map(([name, def]) => {
          const normName = name.startsWith("$") ? name : `$${name}`;
          const params = (def.params ?? []).map((p) => p.name).join(", ");
          return `${normName}(${params})`;
        })
        .join(", ");
      if (idiomNames) {
        lines.push(`# @idioms available: ${idiomNames}`);
      }
    }
    lines.push(body);
    lines.push("```");
    if (i < activeResults.length - 1) {
      lines.push("");
    }
  }
  if (zeroMatchPaths.length > 0) {
    const zeroSummary = `// 0 matches in: ${zeroMatchPaths.join(", ")}`;
    combinedTargetContents.push(zeroSummary);
    lines.push("");
    lines.push(zeroSummary);
  }
  lines.push("");
  lines.push(`## Imported Dependency Contracts (${mergedDeps.length}):`);
  if (mergedDeps.length === 0) {
    lines.push("None");
  } else {
    for (let i = 0; i < mergedDeps.length; i++) {
      const dep = mergedDeps[i]!;
      const resPath = dep.resolvedPath ? `\`${dep.resolvedPath}\`` : "external";
      lines.push(`### Dependency: \`${dep.specifier}\` (${resPath})`);
      lines.push("```aice");
      lines.push(dep.contract);
      lines.push("```");
      if (i < mergedDeps.length - 1) {
        lines.push("");
      }
    }
  }
  lines.push("");
  lines.push(`## Downstream Callers (${mergedCallers.length}):`);
  if (mergedCallers.length === 0) {
    lines.push("None");
  } else {
    for (const caller of mergedCallers) {
      const symStr = caller.importedSymbols.length > 0 ? caller.importedSymbols.join(", ") : "*";
      if (caller.usedSymbol && caller.callSiteLines && caller.callSiteLines.length > 0) {
        const lineTags = caller.callSiteLines.map((l) => `L${l}`).join(", ");
        lines.push(
          `- ${caller.filePath} imports: ${symStr} (uses ${caller.usedSymbol} at [${lineTags}])`,
        );
      } else {
        lines.push(`- \`${caller.filePath}\` imports: \`${symStr}\``);
      }
    }
  }

  if (Object.keys(mergedIdioms).length > 0) {
    lines.push("");
    lines.push(formatIdiomsMarkdownSection(mergedIdioms));
  }
  if (diagParts.length > 0) {
    lines.push("");
    lines.push(diagParts.join("\n\n"));
  }

  let formattedBundle = lines.join("\n");
  let tokenCount = estimateTokens(formattedBundle);

  if (options.maxTokens !== undefined && tokenCount > options.maxTokens) {
    const truncatedFooter = "\n\n// ... [truncated to fit maxTokens]";
    let chars = formattedBundle.length;
    while (
      chars > 0 &&
      estimateTokens(formattedBundle.slice(0, chars) + truncatedFooter) > options.maxTokens
    ) {
      chars = Math.floor(chars * 0.7);
    }
    if (estimateTokens(formattedBundle.slice(0, chars) + truncatedFooter) <= options.maxTokens) {
      formattedBundle = (chars > 0 ? formattedBundle.slice(0, chars) : "") + truncatedFooter;
    } else {
      formattedBundle = truncatedFooter;
      while (formattedBundle.length > 0 && estimateTokens(formattedBundle) > options.maxTokens) {
        formattedBundle = formattedBundle.slice(0, -1);
      }
    }
    tokenCount = estimateTokens(formattedBundle);
  }

  return {
    targetPath: targetPathsList.join(", "),
    targetContent: combinedTargetContents.join("\n\n"),
    dependencies: mergedDeps,
    callers: mergedCallers,
    formattedBundle,
    tokenCount,
    idioms: Object.keys(mergedIdioms).length > 0 ? mergedIdioms : undefined,
    nativeDiagnostics: diagParts.length > 0 ? diagParts.join("\n\n") : undefined,
    results,
  };
}
