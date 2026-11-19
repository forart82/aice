/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Import path resolution, sibling outlines, dependency contracts, and symbol selectors.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { extractFastTsImports, isTsLikeFilePath } from "../../compat/typescript.js";
import { type AiceProjectConfig, findProjectRoot, loadProjectConfig } from "../../config/index.js";
import type { Block, Expr, ImportDecl, LayoutNode, Module, ModuleItem } from "../../core/ast.js";
import { parse } from "../../core/parser.js";
import { decompile } from "../../decompiler/index.js";
import { detectTargetFromPath, detectTargetFromPathOrContent } from "../../emitters/index.js";
import { withSuppressedTelemetry } from "../../telemetry/index.js";
import { estimateTokens } from "../../tokenomics/index.js";
import { generateOutline, type OutlineSymbol } from "../outline.js";
import { locateNativeDeclarationSpan } from "../splice.js";

export function isExternalSpecifier(specifier: string): boolean {
  if (specifier.startsWith("node:")) return true;
  if (
    specifier.startsWith("./") ||
    specifier.startsWith("../") ||
    specifier === "." ||
    specifier === ".."
  ) {
    return false;
  }
  return true;
}

export function formatDisplayPath(filePath: string, projectRoot: string): string {
  const rel = path.relative(projectRoot, filePath);
  if (rel === "") {
    return ".";
  }
  if (!rel.startsWith("..") && !path.isAbsolute(rel)) {
    return rel.replace(/\\/g, "/");
  }
  const relCwd = path.relative(process.cwd(), filePath);
  if (relCwd === "") {
    return ".";
  }
  if (!relCwd.startsWith("..") && !path.isAbsolute(relCwd)) {
    return relCwd.replace(/\\/g, "/");
  }
  return filePath.replace(/\\/g, "/");
}

function probeCandidatePath(candidateBase: string, includeAiplMod = false): string | undefined {
  if (fs.existsSync(candidateBase) && fs.statSync(candidateBase).isFile()) {
    return candidateBase;
  }

  const ext = path.extname(candidateBase).toLowerCase();
  const baseWithoutExt = ext ? candidateBase.slice(0, -ext.length) : candidateBase;

  const probeList: string[] = [];

  if (ext) {
    probeList.push(`${baseWithoutExt}.ts`);
    probeList.push(`${baseWithoutExt}.tsx`);
    probeList.push(`${baseWithoutExt}.js`);
    probeList.push(`${baseWithoutExt}.py`);
    probeList.push(`${baseWithoutExt}.cpp`);
    probeList.push(`${baseWithoutExt}.cs`);
    probeList.push(`${baseWithoutExt}.kt`);
    probeList.push(`${baseWithoutExt}.php`);
    probeList.push(`${baseWithoutExt}.aipl`);
    probeList.push(`${baseWithoutExt}.aice`);
  }

  probeList.push(`${candidateBase}.ts`);
  probeList.push(`${candidateBase}.tsx`);
  probeList.push(`${candidateBase}.py`);
  probeList.push(`${candidateBase}.js`);
  probeList.push(`${candidateBase}.rs`);
  probeList.push(`${candidateBase}.go`);
  probeList.push(`${candidateBase}.cpp`);
  probeList.push(`${candidateBase}.cs`);
  probeList.push(`${candidateBase}.kt`);
  probeList.push(`${candidateBase}.php`);
  probeList.push(`${candidateBase}.twig`);
  probeList.push(`${candidateBase}.html`);
  probeList.push(`${candidateBase}.css`);
  probeList.push(`${candidateBase}.json`);
  probeList.push(`${candidateBase}.yaml`);
  probeList.push(`${candidateBase}.yml`);
  probeList.push(`${candidateBase}.aipl`);
  probeList.push(`${candidateBase}.aice`);

  // Directory index / module probes
  probeList.push(path.join(candidateBase, "index.ts"));
  probeList.push(path.join(candidateBase, "index.tsx"));
  probeList.push(path.join(candidateBase, "index.js"));
  probeList.push(path.join(candidateBase, "index.aipl"));
  probeList.push(path.join(candidateBase, "mod.aipl"));
  if (includeAiplMod) {
    probeList.push(path.join(candidateBase, "lib.aipl"));
  }
  probeList.push(path.join(candidateBase, "index.aice"));

  for (const p of probeList) {
    if (fs.existsSync(p) && fs.statSync(p).isFile()) {
      return p;
    }
  }

  return undefined;
}

export function resolveImportPath(
  fromFilePathOrSpec: string,
  specifierOrFromFile: string,
  configOrProjectRoot?: AiceProjectConfig | string,
  maybeProjectRoot?: string,
): string | undefined {
  let fromFilePath = fromFilePathOrSpec;
  let specifier = specifierOrFromFile;
  if (
    typeof configOrProjectRoot === "string" &&
    maybeProjectRoot === undefined &&
    !fs.existsSync(fromFilePathOrSpec) &&
    (fs.existsSync(specifierOrFromFile) || path.isAbsolute(specifierOrFromFile))
  ) {
    specifier = fromFilePathOrSpec;
    fromFilePath = specifierOrFromFile;
  }
  const projectRoot =
    maybeProjectRoot ??
    (typeof configOrProjectRoot === "string"
      ? configOrProjectRoot
      : findProjectRoot(path.dirname(path.resolve(fromFilePath)), process.cwd()));
  const config: AiceProjectConfig =
    configOrProjectRoot && typeof configOrProjectRoot === "object"
      ? configOrProjectRoot
      : loadProjectConfig(projectRoot);

  const fromDir = path.dirname(path.resolve(fromFilePath));
  const isAiplFrom = fromFilePath.toLowerCase().endsWith(".aipl");
  const normalizedSpec =
    isAiplFrom &&
    !specifier.includes("/") &&
    !specifier.startsWith(".") &&
    specifier.includes(".") &&
    !specifier.toLowerCase().endsWith(".aipl")
      ? specifier.replace(/\./g, "/")
      : specifier;

  if (normalizedSpec.startsWith("std/") || (isAiplFrom && normalizedSpec === "std")) {
    const stdSubpath = normalizedSpec.startsWith("std/") ? normalizedSpec.slice(4) : "";
    const stdCandidates: string[] = [
      path.resolve(projectRoot, normalizedSpec),
      path.resolve(fromDir, normalizedSpec),
      path.resolve(projectRoot, "../aipl", normalizedSpec),
      path.resolve(fromDir, "../aipl", normalizedSpec),
      path.resolve(fromDir, "../../aipl", normalizedSpec),
      path.resolve(fromDir, "../../../aipl", normalizedSpec),
    ];
    if (process.env.AIPL_HOME) {
      stdCandidates.push(path.resolve(process.env.AIPL_HOME, normalizedSpec));
      if (stdSubpath) {
        stdCandidates.push(path.resolve(process.env.AIPL_HOME, "std", stdSubpath));
      }
    }
    for (const cand of stdCandidates) {
      const hit = probeCandidatePath(cand, true);
      if (hit) return hit;
    }
    return undefined;
  }

  if (isExternalSpecifier(normalizedSpec)) {
    if (isAiplFrom && !normalizedSpec.startsWith("node:")) {
      const aiplCandidates = [
        path.resolve(fromDir, normalizedSpec),
        path.resolve(projectRoot, normalizedSpec),
        path.resolve(projectRoot, config.sourceDir || "src", normalizedSpec),
      ];
      for (const cand of aiplCandidates) {
        const hit = probeCandidatePath(cand, true);
        if (hit) return hit;
      }
    }
    return undefined;
  }

  let candidateBase: string;

  if (normalizedSpec.startsWith(".")) {
    candidateBase = path.resolve(fromDir, normalizedSpec);
  } else if (path.isAbsolute(normalizedSpec)) {
    candidateBase = path.resolve(normalizedSpec);
  } else {
    // Relative to projectRoot or sourceDir
    const rootCandidate = path.resolve(projectRoot, normalizedSpec);
    const srcCandidate = path.resolve(projectRoot, config.sourceDir, normalizedSpec);
    if (fs.existsSync(rootCandidate)) {
      candidateBase = rootCandidate;
    } else if (fs.existsSync(srcCandidate)) {
      candidateBase = srcCandidate;
    } else {
      candidateBase = rootCandidate;
    }
  }

  return probeCandidatePath(candidateBase, isAiplFrom);
}

function renderSymbolsOutline(symbols: OutlineSymbol[]): string {
  const outlineLines: string[] = [];
  for (let i = 0; i < symbols.length; i++) {
    const sym = symbols[i];
    if (
      i > 0 &&
      (sym.kind === "class" ||
        sym.kind === "function" ||
        sym.kind === "enum" ||
        sym.kind === "interface" ||
        sym.kind === "record")
    ) {
      outlineLines.push("");
    }
    if (sym.docstring) {
      outlineLines.push(sym.docstring);
    }
    if (sym.kind === "class" || sym.kind === "interface" || sym.kind === "record") {
      if (sym.children && sym.children.length > 0) {
        const header = sym.signature.endsWith(": ...") ? sym.signature.slice(0, -4) : sym.signature;
        outlineLines.push(header);
        for (const child of sym.children) {
          if (child.docstring) {
            outlineLines.push(`  ${child.docstring}`);
          }
          outlineLines.push(`  ${child.signature}`);
        }
      } else {
        outlineLines.push(sym.signature);
      }
    } else if (sym.kind === "enum") {
      if (sym.children && sym.children.length > 0) {
        const header = sym.signature.endsWith(": ...") ? sym.signature.slice(0, -4) : sym.signature;
        outlineLines.push(`${header} ${sym.children.map((c) => c.signature).join(" | ")}`);
      } else {
        outlineLines.push(sym.signature);
      }
    } else {
      outlineLines.push(sym.signature);
    }
  }
  return outlineLines.join("\n").trim();
}

const SIBLING_MAX_SYMBOLS = 20;

const SIBLING_MAX_TOKENS = 150;

const SIBLING_MAX_SIG_CHARS = 120;

function matchesSiblingIdent(symName: string, rawPart: string): boolean {
  const cleanPart = rawPart.replace(/\(.*\)$/, "").trim();
  if (!cleanPart) return false;
  if (symName === cleanPart) return true;
  if (cleanPart.length >= 2) {
    const normSym = symName.toLowerCase().replace(/[^a-z0-9]/g, "");
    const normPart = cleanPart.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (normSym.length > 0 && normSym === normPart) {
      return true;
    }
  }
  return false;
}

function mergeContainerChildren(containers: OutlineSymbol[]): OutlineSymbol[] {
  if (containers.length === 1) {
    return containers[0]!.children ?? [];
  }
  const merged: OutlineSymbol[] = [];
  const seen = new Set<string>();
  for (const c of containers) {
    for (const child of c.children ?? []) {
      const key = `${child.kind}:${child.name}:${child.signature}`;
      if (!seen.has(key)) {
        seen.add(key);
        merged.push(child);
      }
    }
  }
  return merged;
}

function findEnclosingContainerForBareMember(
  symbols: OutlineSymbol[],
  targetName: string,
  prefix: string[] = [],
): { parentKey: string; parentLabel: string; children: OutlineSymbol[] } | undefined {
  const byName = new Map<string, OutlineSymbol[]>();
  for (const sym of symbols) {
    if (sym.kind === "import") continue;
    const list = byName.get(sym.name);
    if (list) list.push(sym);
    else byName.set(sym.name, [sym]);
  }
  for (const [containerName, group] of byName) {
    const children = mergeContainerChildren(group);
    if (children.length === 0) continue;
    const pathParts = [...prefix, containerName];
    if (children.some((c) => matchesSiblingIdent(c.name, targetName))) {
      return {
        parentKey: pathParts.join("."),
        parentLabel: pathParts.join("."),
        children,
      };
    }
    const nested = findEnclosingContainerForBareMember(children, targetName, pathParts);
    if (nested) return nested;
  }
  return undefined;
}

/**
 * Adaptive Sibling Outlining: for `Parent.member` (or bare member / multi-selector)
 * queries, render a deduplicated, token-bounded outline of sibling members per parent,
 * strictly capped at <= 20 symbols and <= 150 tokens total.
 */
export function buildSiblingOutline(symbols: OutlineSymbol[], selector: string | string[]): string {
  if (!symbols || symbols.length === 0) return "";
  const rawSelectors = Array.isArray(selector) ? selector : splitSymbolSelectors(selector);
  if (rawSelectors.length === 0) return "";

  const parentGroups = new Map<
    string,
    { parentLabel: string; children: OutlineSymbol[]; excludedTargets: string[] }
  >();

  for (const rawSel of rawSelectors) {
    const trimmed = rawSel.trim();
    if (
      !trimmed ||
      trimmed === "*" ||
      trimmed.toLowerCase() === "imports" ||
      trimmed === "@first" ||
      trimmed === "@1" ||
      trimmed.startsWith(".") ||
      trimmed.startsWith("#") ||
      /^\[?L\d+(?:-L?\d+)?\]?$/i.test(trimmed) ||
      /^\/.+\/[gimsuy]*$/.test(trimmed)
    ) {
      continue;
    }

    const withoutFilePrefix =
      trimmed.includes(":") && !trimmed.includes("::")
        ? trimmed.slice(trimmed.indexOf(":") + 1).trim()
        : trimmed;

    const parts = withoutFilePrefix
      .split(/\.|::/)
      .map((p) => p.trim())
      .filter(Boolean);
    if (parts.length === 0) continue;

    if (parts.length === 1) {
      const bare = parts[0]!;
      const isTopLevel = symbols.some(
        (s) => s.kind !== "import" && matchesSiblingIdent(s.name, bare),
      );
      if (isTopLevel) {
        continue;
      }
      const enclosing = findEnclosingContainerForBareMember(symbols, bare);
      if (!enclosing) continue;
      const existing = parentGroups.get(enclosing.parentKey);
      if (existing) {
        existing.excludedTargets.push(bare);
      } else {
        parentGroups.set(enclosing.parentKey, {
          parentLabel: enclosing.parentLabel,
          children: enclosing.children,
          excludedTargets: [bare],
        });
      }
      continue;
    }

    let level = symbols;
    const resolvedPath: string[] = [];
    let matchedContainers: OutlineSymbol[] = [];
    let validPath = true;
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i]!;
      const matches = level.filter((s) => matchesSiblingIdent(s.name, part));
      if (matches.length === 0) {
        validPath = false;
        break;
      }
      resolvedPath.push(matches[0]!.name);
      if (i === parts.length - 2) {
        matchedContainers = matches;
      } else {
        level = mergeContainerChildren(matches);
        if (level.length === 0) {
          validPath = false;
          break;
        }
      }
    }
    if (!validPath || matchedContainers.length === 0) continue;
    const mergedChildren = mergeContainerChildren(matchedContainers);
    if (mergedChildren.length === 0) continue;

    const parentKey = resolvedPath.join(".");
    const parentLabel = resolvedPath.length === 1 ? resolvedPath[0]! : resolvedPath.join(".");
    const target = parts[parts.length - 1]!;
    const existing = parentGroups.get(parentKey);
    if (existing) {
      existing.excludedTargets.push(target);
    } else {
      parentGroups.set(parentKey, {
        parentLabel,
        children: mergedChildren,
        excludedTargets: [target],
      });
    }
  }

  if (parentGroups.size === 0) return "";

  const blocks: string[] = [];
  let totalTokensUsed = 0;
  let totalSymbolsShown = 0;

  for (const group of parentGroups.values()) {
    const siblings = group.children.filter(
      (s) => !group.excludedTargets.some((t) => matchesSiblingIdent(s.name, t)),
    );
    if (siblings.length === 0) continue;

    const hasMethods = siblings.some((s) => s.kind === "method" || s.kind === "function");
    const allVariants = !hasMethods && siblings.every((s) => s.kind === "variant");
    const allFields =
      !hasMethods && siblings.every((s) => s.kind === "field" || s.kind === "property");
    const unitLabel = hasMethods
      ? "methods"
      : allVariants
        ? "variants"
        : allFields
          ? "fields"
          : "members";

    const header = `// siblings in ${group.parentLabel}:`;
    const headerCost = estimateTokens(header);
    if (totalTokensUsed + headerCost + 6 > SIBLING_MAX_TOKENS) {
      break;
    }

    const groupLines: string[] = [];
    let groupShown = 0;
    let runningTokens = totalTokensUsed + headerCost;

    for (let idx = 0; idx < siblings.length; idx++) {
      if (totalSymbolsShown >= SIBLING_MAX_SYMBOLS) break;
      const s = siblings[idx]!;
      let sig = s.signature.split(/\r?\n/)[0]!.trim();
      if (sig.length > SIBLING_MAX_SIG_CHARS) {
        sig = `${sig.slice(0, SIBLING_MAX_SIG_CHARS - 3).trimEnd()}...`;
      }
      const line = `//   ${sig}`;
      const cost = estimateTokens(line);
      const hasRemainingAfter = idx < siblings.length - 1;
      const footerReserve = hasRemainingAfter ? 9 : 0;
      if (runningTokens + cost + footerReserve > SIBLING_MAX_TOKENS) {
        break;
      }
      groupLines.push(line);
      runningTokens += cost;
      groupShown++;
      totalSymbolsShown++;
    }

    const rest = siblings.length - groupShown;
    if (groupShown === 0 && rest > 0) {
      const summaryOnly = `${header}\n//   (+ ${rest} other ${unitLabel})`;
      if (totalTokensUsed + estimateTokens(summaryOnly) <= SIBLING_MAX_TOKENS) {
        blocks.push(summaryOnly);
        totalTokensUsed += estimateTokens(summaryOnly);
      }
      break;
    }

    while (groupLines.length > 0) {
      const currentRest = siblings.length - groupLines.length;
      const footerLine = currentRest > 0 ? [`//   (+ ${currentRest} other ${unitLabel})`] : [];
      const candidateBlock = [header, ...groupLines, ...footerLine].join("\n");
      const candidateAll = [...blocks, candidateBlock].join("\n\n");
      if (estimateTokens(candidateAll) <= SIBLING_MAX_TOKENS) {
        blocks.push(candidateBlock);
        totalTokensUsed = estimateTokens(candidateAll);
        break;
      }
      groupLines.pop();
    }
  }

  return blocks.join("\n\n");
}

export function extractExportedContract(resolvedPath: string, importedSymbols: string[]): string {
  if (
    importedSymbols.length > 0 &&
    !importedSymbols.includes("*") &&
    !resolvedPath.endsWith(".aice")
  ) {
    try {
      const stat = fs.statSync(resolvedPath);
      if (stat.size > 50_000) {
        const rawDep = fs.readFileSync(resolvedPath, "utf-8");
        const depLang = detectTargetFromPath(resolvedPath);
        const snippets: string[] = [];
        for (const sym of importedSymbols) {
          const span = locateNativeDeclarationSpan(rawDep, sym, depLang);
          if (span) {
            snippets.push(rawDep.slice(span.fullDeclStart ?? span.declStart, span.declEnd));
          }
        }
        if (snippets.length > 0) {
          const miniSource = snippets.join("\n\n");
          const decomp = withSuppressedTelemetry(() =>
            decompile(miniSource, depLang, { filePath: resolvedPath }),
          );
          const miniOutline = withSuppressedTelemetry(() =>
            generateOutline(decomp.ast, { includeTypes: true }),
          );
          const miniSyms = miniOutline.symbols.filter(
            (s) => s.kind !== "import" && s.kind !== "module",
          );
          const renderedMini = renderSymbolsOutline(miniSyms);
          if (renderedMini) return renderedMini;
        }
      }
    } catch {
      // fall through to full outline
    }
  }

  const outlineRes = withSuppressedTelemetry(() =>
    generateOutline(resolvedPath, { includeTypes: true }),
  );
  const nonImports = outlineRes.symbols.filter((s) => s.kind !== "import" && s.kind !== "module");

  const hasExplicitExports = nonImports.some(
    (s) => s.signature.startsWith("pub ") || s.signature.startsWith("export "),
  );

  let filtered: OutlineSymbol[];
  if (importedSymbols.includes("*")) {
    filtered = nonImports;
  } else if (importedSymbols.length > 0) {
    const explicitMatches = nonImports.filter((s) => importedSymbols.includes(s.name));
    if (explicitMatches.length > 0) {
      const matchedSigs = explicitMatches
        .map((s) => `${s.signature} ${(s.children ?? []).map((c) => c.signature).join(" ")}`)
        .join(" ");
      filtered = nonImports.filter((s) => {
        if (importedSymbols.includes(s.name)) return true;
        if (
          (s.kind === "interface" ||
            s.kind === "record" ||
            s.kind === "type" ||
            s.kind === "enum" ||
            s.signature.startsWith("struct ")) &&
          new RegExp(`\\b${s.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(matchedSigs)
        ) {
          return true;
        }
        return false;
      });
    } else if (hasExplicitExports) {
      filtered = nonImports.filter(
        (s) =>
          s.signature.startsWith("pub ") ||
          s.signature.startsWith("export ") ||
          s.kind === "interface" ||
          s.kind === "record" ||
          s.kind === "type" ||
          s.kind === "enum" ||
          s.signature.startsWith("struct "),
      );
    } else {
      filtered = nonImports;
    }
  } else if (hasExplicitExports) {
    filtered = nonImports.filter((s) => {
      if (s.signature.startsWith("pub ") || s.signature.startsWith("export ")) {
        return true;
      }
      if (
        s.kind === "interface" ||
        s.kind === "record" ||
        s.kind === "type" ||
        s.kind === "enum" ||
        s.signature.startsWith("struct ")
      ) {
        return true;
      }
      return false;
    });
  } else {
    filtered = nonImports;
  }

  const rendered = renderSymbolsOutline(filtered);
  if (!rendered) {
    return outlineRes.text ? outlineRes.text.trim() : "// No exported symbols";
  }
  return rendered;
}

export function generateExternalContract(specifier: string, importedSymbols: string[]): string {
  if (importedSymbols.length === 0) {
    return `// external: ${specifier}\nimport "${specifier}"`;
  }
  return `// external: ${specifier}\nfrom "${specifier}" import { ${importedSymbols.join(", ")} }`;
}

function extractAiplImports(content: string): ImportDecl[] {
  const stripBlockCommentsPreserveLines = (src: string): string => {
    let out = "";
    let inQuote: string | null = null;
    let inLineComment = false;
    let inBlockComment = false;
    for (let k = 0; k < src.length; k++) {
      const ch = src[k]!;
      const next = src[k + 1];
      if (inLineComment) {
        out += ch;
        if (ch === "\n") inLineComment = false;
        continue;
      }
      if (inBlockComment) {
        if (ch === "*" && next === "/") {
          inBlockComment = false;
          out += "  ";
          k++;
          continue;
        }
        out += ch === "\n" ? "\n" : " ";
        continue;
      }
      if (inQuote) {
        out += ch;
        if (ch === "\\" && k + 1 < src.length) {
          out += src[k + 1]!;
          k++;
          continue;
        }
        if (ch === inQuote) inQuote = null;
        continue;
      }
      if (ch === '"' || ch === "'") {
        inQuote = ch;
        out += ch;
        continue;
      }
      if ((ch === "/" && next === "/") || ch === "#") {
        inLineComment = true;
        out += ch;
        continue;
      }
      if (ch === "/" && next === "*") {
        inBlockComment = true;
        out += "  ";
        k++;
        continue;
      }
      out += ch;
    }
    return out;
  };

  const lines = stripBlockCommentsPreserveLines(content).split(/\r?\n/);
  const imports: ImportDecl[] = [];

  const stripLineComment = (raw: string): string => {
    let inQuote: string | null = null;
    for (let k = 0; k < raw.length; k++) {
      const ch = raw[k]!;
      if (inQuote) {
        if (ch === "\\" && k + 1 < raw.length) {
          k++;
          continue;
        }
        if (ch === inQuote) inQuote = null;
        continue;
      }
      if (ch === '"' || ch === "'") {
        inQuote = ch;
        continue;
      }
      if ((ch === "/" && raw[k + 1] === "/") || ch === "#") {
        return raw.slice(0, k);
      }
    }
    return raw;
  };

  const makeSpan = (startLine: number, endLine: number) => ({
    file: "<aipl>",
    start: { line: startLine, column: 1, offset: 0 },
    end: { line: endLine, column: 1, offset: 0 },
  });

  const parseSpecifiers = (rawSpecs: string, span: ReturnType<typeof makeSpan>) => {
    return rawSpecs
      .replace(/;+\s*$/, "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((piece) => {
        const asMatch = piece.match(
          /^([A-Za-z_][A-Za-z0-9_]*|\*)\s+as\s+([A-Za-z_][A-Za-z0-9_]*)$/,
        );
        if (asMatch) {
          return {
            name: asMatch[1]!,
            alias: asMatch[2]!,
            isWildcard: asMatch[1] === "*",
            span,
          };
        }
        return {
          name: piece,
          isWildcard: piece === "*",
          span,
        };
      });
  };

  let i = 0;
  while (i < lines.length) {
    const clean = stripLineComment(lines[i] ?? "").trim();
    if (!clean) {
      i++;
      continue;
    }

    // 1. Single-line or multi-line `import { sym1, sym2 } from "specifier"`
    if (/^(?:pub\s+)?import\s*\{/.test(clean)) {
      const startLine = i + 1;
      let endLine = startLine;
      const chunks: string[] = [];
      let j = i;
      let matched = false;
      while (j < lines.length) {
        chunks.push(stripLineComment(lines[j] ?? "").trim());
        const joined = chunks.join(" ");
        const m = joined.match(
          /^(?:pub\s+)?import\s*\{([\s\S]*?)\}\s*from\s*(?:["']([^"']+)["']|([A-Za-z0-9_./-]+))\s*;?\s*$/,
        );
        if (m) {
          endLine = j + 1;
          const span = makeSpan(startLine, endLine);
          const source = (m[2] ?? m[3] ?? "").trim();
          const specifiers = parseSpecifiers(m[1] ?? "", span);
          if (source) {
            imports.push({
              kind: "ImportDecl",
              source,
              specifiers,
              isExported: clean.startsWith("pub "),
              span,
            });
          }
          i = j + 1;
          matched = true;
          break;
        }
        j++;
      }
      if (matched) continue;
    }

    // 2. Single-line or multi-line `from "specifier" import { sym1, sym2 }` or `from mod import a, b`
    if (/^(?:pub\s+)?from\s+(?:["'][^"']+["']|[A-Za-z0-9_./-]+)\s+import\b/.test(clean)) {
      const startLine = i + 1;
      let endLine = startLine;
      const chunks: string[] = [clean];
      let j = i;
      while (
        chunks.join(" ").includes("{") &&
        !chunks.join(" ").includes("}") &&
        j + 1 < lines.length
      ) {
        j++;
        chunks.push(stripLineComment(lines[j] ?? "").trim());
      }
      endLine = j + 1;
      const joined = chunks.join(" ").replace(/;+\s*$/, "");
      const m = joined.match(
        /^(?:pub\s+)?from\s+(?:["']([^"']+)["']|([A-Za-z0-9_./-]+))\s+import\s+(?:\{([\s\S]*?)\}|(.+))$/,
      );
      if (m) {
        const span = makeSpan(startLine, endLine);
        const source = (m[1] ?? m[2] ?? "").trim();
        const specifiers = parseSpecifiers(m[3] ?? m[4] ?? "", span);
        if (source) {
          imports.push({
            kind: "ImportDecl",
            source,
            specifiers,
            isExported: clean.startsWith("pub "),
            span,
          });
        }
        i = j + 1;
        continue;
      }
    }

    // 3. `import * as ns from "specifier"`, `import defaultSym from "specifier"`, or `import "specifier"`
    const stringImpMatch = clean.match(
      /^(?:pub\s+)?import\s+(?:\*\s+as\s+([A-Za-z_][A-Za-z0-9_]*)\s+from\s+|([A-Za-z_][A-Za-z0-9_]*)\s+from\s+)?["']([^"']+)["']\s*;?\s*$/,
    );
    if (stringImpMatch) {
      const span = makeSpan(i + 1, i + 1);
      const nsAlias = stringImpMatch[1];
      const defIdent = stringImpMatch[2];
      const source = stringImpMatch[3]!.trim();
      const specifiers = nsAlias
        ? [{ name: "*", alias: nsAlias, isWildcard: true, span }]
        : defIdent
          ? [{ name: defIdent, isDefault: true, span }]
          : [{ name: "*", isWildcard: true, span }];
      imports.push({
        kind: "ImportDecl",
        source,
        specifiers,
        isExported: clean.startsWith("pub "),
        span,
      });
      i++;
      continue;
    }

    // 4. `import mod.path` or `import mod.path as alias`
    const modImpMatch = clean.match(
      /^(?:pub\s+)?import\s+([A-Za-z_][A-Za-z0-9_./]*)(?:\s+as\s+([A-Za-z_][A-Za-z0-9_]*))?\s*;?\s*$/,
    );
    if (modImpMatch) {
      const span = makeSpan(i + 1, i + 1);
      const source = modImpMatch[1]!.trim();
      const alias = modImpMatch[2]?.trim();
      imports.push({
        kind: "ImportDecl",
        source,
        specifiers: [{ name: "*", ...(alias ? { alias } : {}), isWildcard: true, span }],
        isExported: clean.startsWith("pub "),
        span,
      });
      i++;
      continue;
    }

    i++;
  }

  return imports;
}

export const NON_IMPORTING_EXTENSIONS = new Set([
  ".json",
  ".yaml",
  ".yml",
  ".md",
  ".markdown",
  ".css",
  ".html",
  ".twig",
  ".sh",
  ".bash",
  ".zsh",
  ".ps1",
  ".cmd",
  ".bat",
  ".toml",
  ".txt",
  ".cff",
]);

export function extractImportsFromFile(filePath: string, preReadContent?: string): ImportDecl[] {
  try {
    if (!filePath.endsWith(".aice")) {
      const ext = path.extname(filePath).toLowerCase();
      if (NON_IMPORTING_EXTENSIONS.has(ext)) {
        return [];
      }
      if (isTsLikeFilePath(filePath)) {
        const content = preReadContent ?? fs.readFileSync(filePath, "utf-8");
        if (!/\b(?:import|export|require)\b/.test(content)) {
          return [];
        }
        return extractFastTsImports(content, filePath);
      }
    }
    const content = preReadContent ?? fs.readFileSync(filePath, "utf-8");
    if (filePath.toLowerCase().endsWith(".aipl")) {
      return extractAiplImports(content);
    }
    const detected = detectTargetFromPathOrContent(filePath, content);
    if (
      detected === "passthrough" ||
      detected === "xml" ||
      detected === "java" ||
      detected === "text"
    ) {
      return [];
    }
    if (filePath.endsWith(".aice")) {
      const mod = parse(content, filePath);
      return mod.items.filter((item): item is ImportDecl => item.kind === "ImportDecl");
    }
    const targetLang = detected;
    if (targetLang === "aipl") {
      return extractAiplImports(content);
    }
    let sourceToDecompile = content;
    if (content.length > 6_000) {
      if (!/\b(?:import|from|require|use|include|using)\b/.test(content)) {
        return [];
      }
      const lines = content.split(/\r?\n/);
      let lastImportLine = -1;
      for (let i = 0; i < lines.length; i++) {
        const trimmed = lines[i]!.trim();
        if (
          /^(?:import\b|export\s+(?:\*|type\b|\{)[^;]*\bfrom\b|from\s+\S+\s+import\b|(?:pub\s+)?use\s+|#include\b|using\s+|(?:const|let|var)\s+[^=]+=\s*require\s*\()/.test(
            trimmed,
          )
        ) {
          lastImportLine = i;
        }
      }
      if (lastImportLine < 0) {
        return [];
      }
      sourceToDecompile = lines.slice(0, Math.min(lines.length, lastImportLine + 35)).join("\n");
    }
    const decomp = withSuppressedTelemetry(() =>
      decompile(sourceToDecompile, targetLang, { filePath }),
    );
    return decomp.ast.items.filter((item): item is ImportDecl => item.kind === "ImportDecl");
  } catch {
    return [];
  }
}

export function splitSymbolSelectors(rawSymbol: string): string[] {
  const trimmed = rawSymbol.trim();
  if (!trimmed) return [];
  if (/^\/[^/\\\n]+\/[gimsuy]*$/.test(trimmed)) {
    return [trimmed];
  }
  const out: string[] = [];
  let current = "";
  let inRegex = false;
  let inCharClass = false;
  let inQuote: string | null = null;
  let escaped = false;
  let curlyDepth = 0;
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i]!;
    if (escaped) {
      current += ch;
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      current += ch;
      continue;
    }
    if (inQuote) {
      current += ch;
      if (ch === inQuote) {
        inQuote = null;
      }
      continue;
    }
    if (inRegex) {
      current += ch;
      if (ch === "[") {
        inCharClass = true;
      } else if (ch === "]" && inCharClass) {
        inCharClass = false;
      } else if (ch === "/" && !inCharClass) {
        inRegex = false;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      inQuote = ch;
      current += ch;
      continue;
    }
    if (ch === "/" && current.trim() === "") {
      inRegex = true;
      inCharClass = false;
      current += ch;
      continue;
    }
    if (ch === "[" && !inCharClass && trimmed.indexOf("]", i + 1) !== -1) {
      inCharClass = true;
      current += ch;
      continue;
    }
    if (ch === "]" && inCharClass) {
      inCharClass = false;
      current += ch;
      continue;
    }
    if (!inCharClass) {
      if (ch === "{" && trimmed.indexOf("}", i + 1) !== -1) {
        curlyDepth++;
      } else if (ch === "}" && curlyDepth > 0) {
        curlyDepth--;
      }
    }
    if (ch === "," && curlyDepth === 0 && !inCharClass) {
      const piece = current.trim();
      if (piece) out.push(piece);
      current = "";
      continue;
    }
    current += ch;
  }
  const last = current.trim();
  if (last) out.push(last);
  return out;
}

function isEmptyOrAbstractBody(body: Block | Expr): boolean {
  if (body.kind === "Block") {
    if (body.statements.length === 0) return true;
    if (body.statements.length === 1 && body.statements[0].kind === "ExprStmt") {
      const e = body.statements[0].expr;
      if (
        e.kind === "LiteralExpr" &&
        (e.literalKind === "nil" || e.value === null || e.value === "...")
      ) {
        return true;
      }
      if (e.kind === "IdentifierExpr" && (e.name === "nil" || e.name === "pass")) {
        return true;
      }
    }
    return false;
  }
  if (
    body.kind === "LiteralExpr" &&
    (body.literalKind === "nil" || body.value === null || body.value === "...")
  ) {
    return true;
  }
  if (body.kind === "IdentifierExpr" && (body.name === "nil" || body.name === "pass")) {
    return true;
  }
  return false;
}

function isNonActionableModuleItem(it: ModuleItem): boolean {
  if (it.kind === "TypeDecl") return true;
  if (it.kind === "FunctionDecl") return isEmptyOrAbstractBody(it.body);
  if (it.kind === "ClassDecl") {
    if (it.methods.length === 0) return true;
    if (
      it.methods.every(
        (m) => m.name === "constructor" || m.name === "__init__" || isEmptyOrAbstractBody(m.body),
      )
    ) {
      return true;
    }
    if (
      it.methods.some(
        (m) => m.name !== "constructor" && m.name !== "__init__" && isEmptyOrAbstractBody(m.body),
      )
    ) {
      return true;
    }
  }
  return false;
}

export function resolveFirstActionableSymbol(
  aiceSource: string,
  filePath: string,
  preParsedMod?: Module,
): string | undefined {
  const syms = extractFileSymbolList(aiceSource, filePath);
  if (syms.length === 0) return undefined;
  let firstSym = syms.find((s) => s !== ":root") ?? syms[0];
  try {
    const mod = preParsedMod ?? parse(aiceSource, filePath);
    const nonActionableNames = new Set(
      mod.items
        .filter(
          (it): it is Extract<ModuleItem, { name: string }> =>
            "name" in it && isNonActionableModuleItem(it),
        )
        .map((it) => it.name),
    );
    firstSym = syms.find((s) => s !== ":root" && !nonActionableNames.has(s)) ?? firstSym;
  } catch {
    // fallback to syms
  }
  return firstSym;
}

export function extractFileSymbolList(aiceSource: string, filePath: string): string[] {
  try {
    const mod = parse(aiceSource, filePath);
    const out: string[] = [];
    for (const item of mod.items) {
      if (
        item.kind === "FunctionDecl" ||
        item.kind === "TypeDecl" ||
        item.kind === "VarDecl" ||
        item.kind === "StyleDecl"
      ) {
        out.push(item.name);
      } else if (item.kind === "ClassDecl") {
        const isCsStaticContainer =
          filePath.endsWith(".cs") &&
          (item.name === "Main" ||
            (item.properties.length === 0 &&
              item.methods.length > 0 &&
              item.methods.every((m) => m.isStatic && !isEmptyOrAbstractBody(m.body))));
        if (isCsStaticContainer) {
          for (const m of item.methods) {
            out.push(m.name);
          }
        } else {
          out.push(item.name);
        }
      } else if (item.kind === "ConstDecl") {
        if (item.value.kind === "RecordLiteralExpr") {
          for (const p of item.value.properties) {
            if (p.key) out.push(`${item.name}.${p.key}`);
          }
        } else {
          out.push(item.name);
        }
      } else if (item.kind === "ComponentDecl") {
        const getAttrStr = (node: LayoutNode, attrName: string): string | undefined => {
          const attr = node.attributes.find((a) => a.name === attrName);
          if (!attr) return undefined;
          if (attr.value.kind === "LiteralExpr") return String(attr.value.value);
          if (attr.value.kind === "IdentifierExpr") return attr.value.name;
          return undefined;
        };
        if (filePath.endsWith(".html")) {
          const visitHtml = (nodes: LayoutNode[]) => {
            for (const n of nodes) {
              const idVal = getAttrStr(n, "id");
              if (idVal && n.tag !== "main") {
                out.push(`#${idVal}`);
              }
              if (n.children && n.children.length > 0) {
                visitHtml(n.children);
              }
            }
          };
          visitHtml(item.layout);
        } else if (filePath.endsWith(".twig")) {
          const visitTwig = (nodes: LayoutNode[]) => {
            for (const n of nodes) {
              const blkVal =
                getAttrStr(n, "twig_block") ??
                getAttrStr(n, "block") ??
                (n.tag === "block" ? getAttrStr(n, "name") : undefined);
              if (blkVal) {
                out.push(blkVal);
              }
              if (n.children && n.children.length > 0) {
                visitTwig(n.children);
              }
            }
          };
          visitTwig(item.layout);
        } else {
          out.push(item.name);
        }
      }
    }
    if (out.length === 0 && filePath.endsWith(".aipl")) {
      const syms = withSuppressedTelemetry(() => generateOutline(aiceSource, filePath)).symbols;
      const nonMod = syms.filter((s) => s.kind !== "module").map((s) => s.name);
      return nonMod.length > 0 ? nonMod : syms.map((s) => s.name);
    }
    return out;
  } catch {
    if (filePath.endsWith(".aipl")) {
      try {
        const syms = withSuppressedTelemetry(() => generateOutline(aiceSource, filePath)).symbols;
        const nonMod = syms.filter((s) => s.kind !== "module").map((s) => s.name);
        return nonMod.length > 0 ? nonMod : syms.map((s) => s.name);
      } catch {
        return [];
      }
    }
    return [];
  }
}

export function unwrapSyntheticContainer(src: string, filePath: string): string {
  if (!filePath.endsWith(".html") && !filePath.endsWith(".twig") && !filePath.endsWith(".cs")) {
    return src;
  }
  const sLines = src.split("\n");
  const wrapIdx = sLines.findIndex((l) => {
    const t = l.trim();
    return (
      t.startsWith("component ") ||
      t === "pub class Main:" ||
      t === "class Main:" ||
      (filePath.endsWith(".cs") && /^(?:pub\s+)?class\s+[A-Za-z0-9_]+:$/.test(t))
    );
  });
  if (wrapIdx < 0) return src;
  return sLines
    .slice(wrapIdx + 1)
    .map((l) => (l.startsWith("  ") ? l.slice(2) : l))
    .join("\n")
    .replace(/^static\s+fn\b/gm, "fn")
    .trim();
}

export function compactPureAiceSlice(src: string): string {
  let out = src.replace(/^([ \t]*)if ([^\n:]+):\n\1 {2}([^\n]+)$/gm, "$1if $2: $3");
  out = out.replace(
    /^([ \t]*)if (\w+) < ([^\n:]+): \2 = \3\n\1if \2 > ([^\n:]+): \2 = \4\n\1(\2 = \2 \+ [^\n]+)$/gm,
    "$1if $2 < $3: $2 = $3; if $2 > $4: $2 = $4; $5",
  );
  out = out.replace(
    /^([ \t]*)([a-z]+\([^\n)]*\)):\n\1 {2}([a-z]+\([^\n)]*\):\s*"[^"]*")\n\1 {2}([a-z]+\([^\n)]*\):\s*"[^"]*")$/gm,
    "$1$2 { $3; $4 }",
  );
  return out;
}

export function resolveEffectiveTargetAndRoot(
  rawTargetPath?: string,
  explicitProjectRoot?: string,
): { targetPath?: string; projectRoot?: string } {
  if (explicitProjectRoot) {
    const root = path.resolve(explicitProjectRoot);
    if (rawTargetPath && !path.isAbsolute(rawTargetPath)) {
      const candidate = path.resolve(root, rawTargetPath);
      if (fs.existsSync(candidate)) {
        return { targetPath: candidate, projectRoot: root };
      }
    }
    return { targetPath: rawTargetPath, projectRoot: root };
  }
  if (rawTargetPath && rawTargetPath.trim() !== "") {
    const absCandidate = path.resolve(process.cwd(), rawTargetPath.trim());
    if (fs.existsSync(absCandidate)) {
      const st = fs.statSync(absCandidate);
      const targetDir = st.isDirectory() ? absCandidate : path.dirname(absCandidate);
      const cwdResolved = path.resolve(process.cwd());
      if (targetDir !== cwdResolved && !targetDir.startsWith(`${cwdResolved}${path.sep}`)) {
        const root = findProjectRoot(targetDir, targetDir);
        return { targetPath: absCandidate, projectRoot: root };
      }
    }
  }
  return { targetPath: rawTargetPath, projectRoot: undefined };
}
