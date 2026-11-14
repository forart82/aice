/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * AICE 2.0 AI Context Packager Engine (Step 20).
 * Assembles high-density 1-turn context packs containing target source/outline,
 * imported dependency contracts, and downstream callers.
 */

import { didYouMeanFile, didYouMeanSymbol } from "./suggest.js";
import * as fs from "node:fs";
import * as path from "node:path";
import { extractFastTsImports, isTsLikeFilePath } from "../compat/typescript.js";
import {
  AICE_DISABLED_MESSAGE,
  type AiceProjectConfig,
  findProjectRoot,
  isProjectAiceEnabled,
  isProjectIdiomsEnabled,
  KNOWN_TARGET_EXTENSIONS,
  loadProjectConfig,
  type ProjectIdiomDefinition,
  resolvePathTargets,
} from "../config/index.js";
import type {
  Block,
  ClassDecl,
  Expr,
  ImportDecl,
  LayoutNode,
  Module,
  ModuleItem,
} from "../core/ast.js";
import { parse } from "../core/parser.js";
import { AiceGenerator } from "../decompiler/aice-generator.js";
import { decompile } from "../decompiler/index.js";
import { detectTargetFromPath } from "../emitters/index.js";
import {
  collapseAiceSourceIdioms,
  expandAiceSourceIdioms,
  formatIdiomsMarkdownSection,
  scanProjectIdioms,
} from "../idioms/index.js";
import {
  recordTelemetryEvent,
  withSuppressedTelemetry,
  withSuppressedTelemetryAsync,
} from "../telemetry/index.js";
import { estimateTokens } from "../tokenomics/index.js";
import {
  collectNativeSyntaxDiagnostics,
  generateOutline,
  type OutlineSymbol,
  OutlineResult,
} from "./outline.js";
import { locateNativeDeclarationSpan } from "./splice.js";

export interface WorkspaceCallerScanCache {
  filesByRoot: Map<string, string[]>;
  fileContentByPath: Map<string, string>;
  importsByPath: Map<string, ImportDecl[]>;
  idiomScanByRoot?: Map<
    string,
    { idioms: Record<string, ProjectIdiomDefinition>; zeroIdiomsReason?: string }
  >;
}

export interface ContextOptions {
  /**
   * Dependency traversal depth (default: 1).
   */
  depth?: number;

  /**
   * Scan workspace for downstream importers/callers (default: true).
   */
  includeCallers?: boolean;

  /**
   * If true, emit target outline instead of full source (default: false).
   */
  outlineTarget?: boolean;

  /**
   * Maximum token budget; truncates or bounds context pack if exceeded.
   */
  maxTokens?: number;

  /**
   * Output structured JSON bundle (default: false).
   */
  json?: boolean;

  /**
   * Include token telemetry (default: false).
   */
  stats?: boolean;

  /**
   * Root directory of the project (auto-discovered if omitted).
   */
  projectRoot?: string;

  /**
   * Optional symbol selector (e.g., "fnName" or "ClassName.methodName") for symbol-scoped context.
   */
  symbol?: string;

  /**
   * Optional override for enabling/disabling project idioms (--idioms / --no-idioms).
   */
  idioms?: boolean;

  /**
   * Optional shared workspace scan cache for multi-file context calls.
   */
  workspaceScanCache?: WorkspaceCallerScanCache;
}

export interface DependencyContract {
  specifier: string;
  resolvedPath?: string;
  importedSymbols: string[];
  isExternal: boolean;
  contract: string;
}

export interface CallerSummary {
  filePath: string;
  importedSymbols: string[];
  line: number;
  usedSymbol?: string;
  callSiteLines?: number[];
}

export interface ContextResult {
  targetPath: string;
  targetContent: string;
  targetOutline?: string;
  dependencies: DependencyContract[];
  callers: CallerSummary[];
  formattedBundle: string;
  tokenCount?: number;
  idioms?: Record<string, ProjectIdiomDefinition>;
  nativeDiagnostics?: string;
  zeroIdiomsReason?: "insufficient_repetition" | string;
}

function isExternalSpecifier(specifier: string): boolean {
  if (specifier.startsWith("node:")) return true;
  if (
    specifier.startsWith("./") ||
    specifier.startsWith("../") ||
    specifier === "." ||
    specifier === ".."
  ) {
    return false;
  }
  if (path.isAbsolute(specifier)) {
    return false;
  }
  return true;
}

function formatDisplayPath(filePath: string, projectRoot: string): string {
  const rel = path.relative(projectRoot, filePath);
  if (!rel.startsWith("..") && !path.isAbsolute(rel)) {
    return rel;
  }
  const relCwd = path.relative(process.cwd(), filePath);
  if (!relCwd.startsWith("..") && !path.isAbsolute(relCwd)) {
    return relCwd;
  }
  return filePath;
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
export function buildSiblingOutline(
  symbols: OutlineSymbol[],
  selector: string | string[],
): string {
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
    const parentLabel =
      resolvedPath.length === 1 ? resolvedPath[0]! : resolvedPath.join(".");
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

function extractExportedContract(resolvedPath: string, importedSymbols: string[]): string {
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

function generateExternalContract(specifier: string, importedSymbols: string[]): string {
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

const NON_IMPORTING_EXTENSIONS = new Set([
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
    if (filePath.endsWith(".aice")) {
      const mod = parse(content, filePath);
      return mod.items.filter((item): item is ImportDecl => item.kind === "ImportDecl");
    }
    const targetLang = detectTargetFromPath(filePath);
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
function splitSymbolSelectors(rawSymbol: string): string[] {
  const trimmed = rawSymbol.trim();
  if (!trimmed) return [];
  if (/^\/[^/\\\n]+\/[gimsuy]*$/.test(trimmed)) {
    return [trimmed];
  }
  const out: string[] = [];
  let current = "";
  let inRegex = false;
  let regexCharClass = false;
  let inQuote: string | null = null;
  let escaped = false;
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i]!;
    if (escaped) {
      current += ch;
      escaped = false;
      continue;
    }
    if (inQuote) {
      current += ch;
      if (ch === "\\") {
        escaped = true;
      } else if (ch === inQuote) {
        inQuote = null;
      }
      continue;
    }
    if (inRegex) {
      current += ch;
      if (ch === "\\") {
        escaped = true;
      } else if (ch === "[") {
        regexCharClass = true;
      } else if (ch === "]" && regexCharClass) {
        regexCharClass = false;
      } else if (ch === "/" && !regexCharClass) {
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
      regexCharClass = false;
      current += ch;
      continue;
    }
    if (ch === ",") {
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

function collectImportLineSet(fileLines: string[], imports: ImportDecl[]): Set<number> {
  const importLines = new Set<number>();
  for (const imp of imports) {
    const sLine = imp.span?.start?.line;
    const eLine = imp.span?.end?.line ?? sLine;
    if (sLine && eLine) {
      for (let l = sLine; l <= eLine; l++) {
        importLines.add(l);
      }
    }
  }
  let inMultilineImport = false;
  for (let idx = 0; idx < fileLines.length; idx++) {
    const ln = fileLines[idx]!;
    if (inMultilineImport) {
      importLines.add(idx + 1);
      if (/\bfrom\s+['"]/.test(ln) || ln.includes(";")) {
        inMultilineImport = false;
      }
      continue;
    }
    if (/^\s*(?:import\b|export\s+\{|from\b)/.test(ln)) {
      importLines.add(idx + 1);
      if (
        ln.includes("{") &&
        !ln.includes("}") &&
        !/\bfrom\s+['"]/.test(ln) &&
        !ln.trimEnd().endsWith(";")
      ) {
        inMultilineImport = true;
      }
    }
  }
  return importLines;
}

const CALLER_IGNORED_DIRS = new Set([
  "node_modules",
  "dist",
  "build",
  "coverage",
  "target",
  "vendor",
  "benchmarks",
  "out",
  "__pycache__",
]);

function scanWorkspaceCallers(
  targetFullPath: string,
  projectRoot: string,
  config: AiceProjectConfig,
  queriedSymbol?: string,
  scanCache?: WorkspaceCallerScanCache,
): CallerSummary[] {
  const callers: CallerSummary[] = [];
  const resolvedRoot = path.resolve(projectRoot);
  let filesToScan = scanCache?.filesByRoot.get(resolvedRoot);

  if (!filesToScan) {
    filesToScan = [];
    const visitedDirs = new Set<string>();

    const walk = (dir: string) => {
      let realDir: string;
      try {
        realDir = fs.realpathSync(dir);
      } catch {
        return;
      }
      if (visitedDirs.has(realDir)) return;
      visitedDirs.add(realDir);

      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of entries) {
        if (entry.isSymbolicLink()) continue;
        if (entry.name.startsWith(".") || CALLER_IGNORED_DIRS.has(entry.name)) continue;
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(fullPath);
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          if (
            entry.name.endsWith(".aice") ||
            (KNOWN_TARGET_EXTENSIONS.has(ext) && !NON_IMPORTING_EXTENSIONS.has(ext))
          ) {
            filesToScan!.push(fullPath);
          }
        }
      }
    };

    walk(resolvedRoot);
    scanCache?.filesByRoot.set(resolvedRoot, filesToScan);
  }

  let queriedLeaf: string | undefined;
  if (queriedSymbol) {
    const firstSym = splitSymbolSelectors(queriedSymbol)[0]?.trim() ?? "";
    if (
      firstSym &&
      firstSym !== "*" &&
      firstSym !== "@first" &&
      firstSym !== "@1" &&
      firstSym.toLowerCase() !== "imports" &&
      !/^\[?L\d+/i.test(firstSym) &&
      !firstSym.startsWith("/")
    ) {
      const withoutFile =
        firstSym.includes(":") && !firstSym.includes("::")
          ? firstSym.slice(firstSym.indexOf(":") + 1).trim()
          : firstSym;
      const parts = withoutFile
        .split(/\.|::/)
        .map((p) => p.trim())
        .filter(Boolean);
      const leaf = parts[parts.length - 1];
      if (leaf && /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(leaf)) {
        queriedLeaf = leaf;
      }
    }
  }

  const resolvedTarget = path.resolve(targetFullPath);
  const targetBase = resolvedTarget.replace(/\.aice$/, "");
  const targetFileName = path.basename(targetBase);
  const targetExt = path.extname(targetFileName);
  const targetStem = targetExt ? targetFileName.slice(0, -targetExt.length) : targetFileName;
  const isIndexStem = targetStem === "index" || targetStem === "mod" || targetStem === "lib";
  const escapedStem = targetStem.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const importHintRegex = !isIndexStem
    ? new RegExp(`(?:from|import|require|use|#include)[^\\n;]*\\b${escapedStem}\\b`)
    : undefined;

  for (const file of filesToScan) {
    const resolvedCandidate = path.resolve(file);
    if (resolvedCandidate === resolvedTarget) continue;
    const fileExt = path.extname(file).toLowerCase();
    if (!file.endsWith(".aice") && NON_IMPORTING_EXTENSIONS.has(fileExt)) {
      continue;
    }

    let rawContent = scanCache?.fileContentByPath.get(resolvedCandidate);
    if (rawContent === undefined) {
      try {
        rawContent = fs.readFileSync(file, "utf-8");
        scanCache?.fileContentByPath.set(resolvedCandidate, rawContent);
      } catch {
        continue;
      }
    }

    if (!isIndexStem && !rawContent.includes(targetStem)) {
      continue;
    }
    if (importHintRegex && !importHintRegex.test(rawContent)) {
      continue;
    }

    let imports = scanCache?.importsByPath.get(resolvedCandidate);
    if (!imports) {
      imports = extractImportsFromFile(file, rawContent);
      scanCache?.importsByPath.set(resolvedCandidate, imports);
    }

    for (const imp of imports) {
      const resolved = resolveImportPath(file, imp.source, config, projectRoot);
      if (resolved) {
        const resolvedBase = path.resolve(resolved).replace(/\.aice$/, "");
        if (path.resolve(resolved) === resolvedTarget || resolvedBase === targetBase) {
          const symbols = imp.specifiers.map((s) => s.name);
          let callSiteLines: number[] | undefined;
          if (queriedLeaf) {
            const escLeaf = queriedLeaf.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            const leafRe = new RegExp(`\\b${escLeaf}\\b`);
            const fileLines = rawContent.split(/\r?\n/);
            const importLineSet = collectImportLineSet(fileLines, imports);
            const nonImportHits: number[] = [];
            for (let idx = 0; idx < fileLines.length; idx++) {
              const ln = fileLines[idx]!;
              if (leafRe.test(ln) && !importLineSet.has(idx + 1)) {
                nonImportHits.push(idx + 1);
              }
            }
            if (nonImportHits.length > 0) {
              callSiteLines = nonImportHits;
            }
          }
          callers.push({
            filePath: formatDisplayPath(file, projectRoot),
            importedSymbols: symbols,
            line: imp.span?.start?.line ?? 1,
            ...(queriedLeaf && callSiteLines && callSiteLines.length > 0
              ? { usedSymbol: queriedLeaf, callSiteLines }
              : {}),
          });
        }
      }
    }
  }

  callers.sort((a, b) => {
    if (a.filePath !== b.filePath) {
      return a.filePath.localeCompare(b.filePath);
    }
    return a.line - b.line;
  });

  return callers;
}

function formatBundle(
  displayTargetPath: string,
  targetBody: string,
  dependencies: DependencyContract[],
  callers: CallerSummary[],
  idioms?: Record<string, ProjectIdiomDefinition>,
  nativeDiagnostics?: string,
  options?: { minimalEnvelope?: boolean; symbolSelector?: string },
): string {
  if (options?.minimalEnvelope && dependencies.length === 0 && callers.length === 0) {
    const headerLabel = options.symbolSelector
      ? `${displayTargetPath}:${options.symbolSelector}`
      : displayTargetPath;
    const minLines: string[] = [`// === ${headerLabel} ===`];
    if (idioms && Object.keys(idioms).length > 0 && !targetBody.includes("# @idioms available:")) {
      const idiomNames = Object.entries(idioms)
        .map(([name, def]) => {
          const normName = name.startsWith("$") ? name : `$${name}`;
          const params = (def.params ?? []).map((p) => p.name).join(", ");
          return `${normName}(${params})`;
        })
        .join(", ");
      if (idiomNames) {
        minLines.push(`# @idioms available: ${idiomNames}`);
      }
    }
    minLines.push(targetBody);
    if (idioms && Object.keys(idioms).length > 0) {
      minLines.push("");
      minLines.push(formatIdiomsMarkdownSection(idioms));
    }
    if (nativeDiagnostics) {
      minLines.push("");
      minLines.push(nativeDiagnostics);
    }
    return minLines.join("\n");
  }

  const lines: string[] = [];

  lines.push(`# AICE Context Pack: ${displayTargetPath}`);
  lines.push("");

  lines.push(`## Imported Dependency Contracts (${dependencies.length}):`);
  if (dependencies.length === 0) {
    lines.push("None");
  } else {
    for (let i = 0; i < dependencies.length; i++) {
      const dep = dependencies[i];
      const resPath = dep.resolvedPath ? `\`${dep.resolvedPath}\`` : "external";
      lines.push(`### Dependency: \`${dep.specifier}\` (${resPath})`);
      lines.push("```aice");
      lines.push(dep.contract);
      lines.push("```");
      if (i < dependencies.length - 1) {
        lines.push("");
      }
    }
  }
  lines.push("");

  lines.push("## Target File Content:");
  lines.push("```aice");
  if (idioms && Object.keys(idioms).length > 0 && !targetBody.includes("# @idioms available:")) {
    const idiomNames = Object.entries(idioms)
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
  lines.push(targetBody);
  lines.push("```");
  lines.push("");

  lines.push(`## Downstream Callers (${callers.length}):`);
  if (callers.length === 0) {
    lines.push("None");
  } else {
    for (const caller of callers) {
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

  if (idioms && Object.keys(idioms).length > 0) {
    lines.push("");
    lines.push(formatIdiomsMarkdownSection(idioms));
  }

  if (nativeDiagnostics) {
    lines.push("");
    lines.push(nativeDiagnostics);
  }

  return lines.join("\n");
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

function extractFileSymbolList(aiceSource: string, filePath: string): string[] {
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

function unwrapSyntheticContainer(src: string, filePath: string): string {
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

function compactPureAiceSlice(src: string): string {
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

/**
 * Recursively traverses `dir` up to `maxDepth` (default: 5) and returns all discovered
 * target files matching the 33 extensions in `KNOWN_TARGET_EXTENSIONS` (or `.aice`).
 */
export function scanDirectoryForTargets(dir: string, maxDepth = 5): string[] {
  const discovered: string[] = [];
  const absRoot = path.resolve(dir);
  const visitedDirs = new Set<string>();
  const ignoredDirs = new Set([
    "node_modules",
    ".git",
    "dist",
    "build",
    ".aice-build",
    ".agents",
    ".next",
    ".turbo",
    "coverage",
    "target",
    "vendor",
  ]);
  const ignoredFiles = new Set([
    "aice.config.json",
    "package.json",
    "tsconfig.json",
    "jsconfig.json",
    "biome.json",
    "rome.json",
    "AGENTS.md",
    "CLAUDE.md",
    "GEMINI.md",
    ".GEMINI.md",
  ]);
  const allTargetExts = Array.from(KNOWN_TARGET_EXTENSIONS);

  const walk = (currentDir: string, depth: number): void => {
    if (depth > maxDepth) return;
    let realCurrentDir = currentDir;
    try {
      realCurrentDir = fs.realpathSync(currentDir);
    } catch {
      // fallback to path
    }
    if (visitedDirs.has(realCurrentDir)) return;
    visitedDirs.add(realCurrentDir);

    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.name.startsWith(".") && entry.name !== "." && entry.name !== "..") {
        continue;
      }
      const fullPath = path.join(currentDir, entry.name);
      let isDir = entry.isDirectory();
      let isFile = entry.isFile();
      if (!isDir && !isFile) {
        try {
          const st = fs.statSync(fullPath);
          isDir = st.isDirectory();
          isFile = st.isFile();
        } catch {
          continue;
        }
      }
      if (isDir) {
        if (ignoredDirs.has(entry.name)) continue;
        walk(fullPath, depth + 1);
      } else if (isFile) {
        if (entry.name.endsWith(".trivia.json") || ignoredFiles.has(entry.name)) {
          continue;
        }
        const lowerName = entry.name.toLowerCase();
        const ext = path.extname(lowerName);
        if (
          lowerName.endsWith(".aice") ||
          (ext && KNOWN_TARGET_EXTENSIONS.has(ext)) ||
          allTargetExts.some((knownExt) => lowerName.endsWith(knownExt))
        ) {
          discovered.push(fullPath);
        }
      }
    }
  };

  if (fs.existsSync(absRoot)) {
    walk(absRoot, 0);
  }
  return discovered.sort();
}

function resolveEffectiveTargetAndRoot(
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

/**
 * Packages a workspace overview context pack covering project configuration,
 * discovered files, module outlines, and dependencies.
 */
export async function generateWorkspaceContext(
  targetPath?: string,
  options: ContextOptions = {},
): Promise<ContextResult> {
  const preResolved = resolveEffectiveTargetAndRoot(targetPath, options.projectRoot);
  const resolved = resolvePathTargets(preResolved.targetPath, {
    includeTargets: true,
    projectRoot: preResolved.projectRoot,
  });

  const projectRoot = resolved.projectRoot;
  const config = resolved.config;
  if (!isProjectAiceEnabled(config)) {
    throw new Error(AICE_DISABLED_MESSAGE);
  }
  const displayTargetPath = formatDisplayPath(resolved.resolvedPath, projectRoot);

  const outlines: string[] = [];
  const symbolSlices: string[] = [];
  const dependencies: DependencyContract[] = [];
  const depMap = new Map<string, DependencyContract>();
  const rawWorkspaceTexts: string[] = [];
  const requestedSelectors = options.symbol ? splitSymbolSelectors(options.symbol) : [];
  const isBareLineRangeOnly =
    resolved.isDirectory &&
    requestedSelectors.length > 0 &&
    requestedSelectors.every((s) => /^\[?L?\d+\s*[-–]\s*L?\d+\]?$/i.test(s.trim()));
  if (isBareLineRangeOnly) {
    const hintMsg = `// Bare line-range selector '${options.symbol}' requires a file target (e.g. 'aice context <file> -s "${options.symbol}"' or 'aice context <file>:${options.symbol}')`;
    return {
      targetPath: displayTargetPath,
      targetContent: hintMsg,
      dependencies: [],
      callers: [],
      formattedBundle: hintMsg,
    };
  }
  const isPureRegexSearch =
    requestedSelectors.length > 0 &&
    requestedSelectors.every((s) => /^\/.+\/[gimsuy]*$/.test(s.trim()));
  const regexMentionsIdiom =
    isPureRegexSearch && requestedSelectors.some((s) => /\$[A-Za-z_]/.test(s));

  const idiomsActive = isProjectIdiomsEnabled(config, options.idioms);
  let activeIdioms =
    idiomsActive && config.idioms && Object.keys(config.idioms).length > 0
      ? config.idioms
      : undefined;
  let zeroIdiomsReason: string | undefined;
  if (
    options.idioms === true &&
    (!activeIdioms || Object.keys(activeIdioms).length === 0) &&
    (!isPureRegexSearch || regexMentionsIdiom)
  ) {
    const cachedScan = options.workspaceScanCache?.idiomScanByRoot?.get(projectRoot);
    if (cachedScan) {
      if (Object.keys(cachedScan.idioms).length > 0) {
        activeIdioms = cachedScan.idioms;
        config.idioms = cachedScan.idioms;
      } else {
        zeroIdiomsReason = cachedScan.zeroIdiomsReason;
        activeIdioms = undefined;
      }
    } else {
      try {
        const scanRes = withSuppressedTelemetry(() => scanProjectIdioms(projectRoot));
        if (Object.keys(scanRes.idioms).length > 0) {
          activeIdioms = scanRes.idioms;
          config.idioms = scanRes.idioms;
          options.workspaceScanCache?.idiomScanByRoot?.set(projectRoot, {
            idioms: scanRes.idioms,
          });
        } else {
          zeroIdiomsReason = scanRes.zeroIdiomsReason ?? "insufficient_repetition";
          activeIdioms = undefined;
          options.workspaceScanCache?.idiomScanByRoot?.set(projectRoot, {
            idioms: {},
            zeroIdiomsReason,
          });
          console.error(
            "[AICE Idioms] 0 beneficial idioms discovered. FAST-PATH: Bypassing idiom layer. Use canonical AICE syntax (do not invent $idiom macros).",
          );
        }
      } catch {
        // ignore scan errors
      }
    }
  }

  const isPureAiceDirectory =
    resolved.files.length > 0 && resolved.files.every((f) => f.endsWith(".aice"));
  const workspaceFiles = isPureAiceDirectory
    ? resolved.files
    : Array.from(
        new Set([
          ...resolved.files,
          ...(resolved.isDirectory && fs.existsSync(resolved.resolvedPath)
            ? scanDirectoryForTargets(resolved.resolvedPath, 5)
            : []),
        ]),
      ).sort();

  const workspaceRootForRank = resolved.isDirectory ? resolved.resolvedPath : projectRoot;
  const relSearchDir = path.relative(projectRoot, resolved.resolvedPath).replace(/\\/g, "/");
  const baseSearchName = path.basename(resolved.resolvedPath);
  const isExplicitTestSearch =
    Boolean(resolved.resolvedPath) &&
    ((Boolean(relSearchDir) &&
      !relSearchDir.startsWith("..") &&
      /(?:^|\/)(?:tests?|__tests__|mocks?|__mocks__|fixtures?|benchmarks?|specs?)(?:\/|$)/i.test(
        relSearchDir,
      )) ||
      /^(?:tests?|__tests__|mocks?|__mocks__|fixtures?|specs?)$/i.test(baseSearchName));

  const scoredFileSlices: Array<{
    relFile: string;
    headerTag: string;
    sliceBody: string;
    score: number;
  }> = [];

  const useCompactWildcardOverview =
    requestedSelectors.includes("*") &&
    requestedSelectors.length === 1 &&
    workspaceFiles.length >= 8 &&
    options.maxTokens === undefined;

  for (const f of workspaceFiles) {
    const relFile = formatDisplayPath(f, projectRoot);
    try {
      const rawFileContent = fs.readFileSync(f, "utf-8");
      rawWorkspaceTexts.push(rawFileContent);

      if (isPureRegexSearch && !regexMentionsIdiom) {
        const matchedSlices: string[] = [];
        const isMockOrTest = !isExplicitTestSearch && isTestOrMockPath(f, workspaceRootForRank);
        let fileMaxScore = 0;
        const queryKw = extractPrimaryQueryKeyword(requestedSelectors[0] ?? "");
        const fileNameMatches = doesFileStemMatchQuery(f, queryKw);

        for (const rawSel of requestedSelectors) {
          const detailed = extractPatternMatchesDetailed(rawFileContent, rawSel.trim(), 2, {
            filePath: f,
            projectRoot: workspaceRootForRank,
            isExplicitTestSearch,
          });
          if (detailed) {
            matchedSlices.push(detailed.formattedText.trim());
            if (detailed.maxScore > fileMaxScore) {
              fileMaxScore = detailed.maxScore;
            }
          }
        }
        if (matchedSlices.length === 0) {
          if (fileNameMatches) {
            const rawLines = rawFileContent.split(/\r?\n/);
            const previewLines = rawLines
              .slice(0, 5)
              .map((l, idx) => `L${idx + 1}: ${l}`)
              .join("\n");
            matchedSlices.push(
              `// file name match: ${path.basename(f)} # [L1-L${Math.min(5, rawLines.length)}]\n${previewLines}`,
            );
            fileMaxScore = isMockOrTest ? 25 : 1000;
          } else {
            continue;
          }
        }
        const hitTags = Array.from(
          new Set(
            matchedSlices
              .flatMap((sl) => Array.from(sl.matchAll(/^\/\/ match at \[([^\]]+)\]/gm)))
              .flatMap((m) => m[1]!.split(",").map((s) => s.trim()))
              .filter(Boolean),
          ),
        );
        const annotatedSlices = matchedSlices.map((sl) =>
          sl.replace(/^\/\/ match at \[([^\]]+)\]/gm, (_full, bracketBody: string) => {
            const firstHit = bracketBody
              .split(",")[0]
              ?.trim()
              .replace(/^L/i, "");
            return firstHit
              ? `// match at [${bracketBody}] (${relFile}:${firstHit})`
              : `// match at [${bracketBody}]`;
          }),
        );
        const sliceBody = annotatedSlices.filter(Boolean).join("\n\n");
        const headerTag = hitTags.length > 0 ? ` [${hitTags.join(", ")}]` : "";

        scoredFileSlices.push({
          relFile,
          headerTag,
          sliceBody,
          score: fileMaxScore,
        });
        continue;
      }

      if (!isPureAiceDirectory && requestedSelectors.length === 0) {
        const oRes = withSuppressedTelemetry(() =>
          generateOutline(f, {
            includeTypes: false,
            compact: true,
            depth: options.depth ?? 1,
            idioms: options.idioms,
            projectRoot,
            preReadSource: rawFileContent,
          }),
        );
        const fileDiags = collectNativeSyntaxDiagnostics(f, rawFileContent);
        const outlineBody = (fileDiags ? `${oRes.text}\n${fileDiags}` : oRes.text).trim();
        outlines.push(`// === ${relFile} ===\n${outlineBody || "// (empty)"}`);
        continue;
      }

      if (useCompactWildcardOverview) {
        const oRes = withSuppressedTelemetry(() =>
          generateOutline(f, {
            includeTypes: true,
            compact: true,
            depth: options.depth ?? 2,
            idioms: options.idioms,
            projectRoot,
            preReadSource: rawFileContent,
          }),
        );
        const compactBody = oRes.text.trim() || "// (empty)";
        symbolSlices.push(`// === ${relFile} ===\n${compactBody}`);
        continue;
      }

      let fileAice = rawFileContent;
      if (!f.endsWith(".aice")) {
        try {
          const targetLang = detectTargetFromPath(f);
          const decomp = withSuppressedTelemetry(() =>
            decompile(rawFileContent, targetLang, { filePath: f, projectRoot }),
          );
          fileAice = decomp.aice;
        } catch {
          fileAice = rawFileContent;
        }
      }
      if (idiomsActive && activeIdioms && Object.keys(activeIdioms).length > 0) {
        try {
          fileAice = collapseAiceSourceIdioms(fileAice, activeIdioms, f).aice;
        } catch {
          // ignore
        }
      }
      const allSyms = extractFileSymbolList(fileAice, f);
      const symHeader = allSyms.length > 0 ? `// symbols: ${allSyms.join(", ")}` : "";

      if (requestedSelectors.length === 0) {
        const oRes = withSuppressedTelemetry(() =>
          generateOutline(f, {
            includeTypes: true,
            depth: options.depth,
            idioms: options.idioms,
            projectRoot,
            preReadSource: rawFileContent,
          }),
        );
        const fileDiags = collectNativeSyntaxDiagnostics(f, rawFileContent);
        const baseOutlineBody =
          symHeader &&
          (f.endsWith(".html") || f.endsWith(".twig") || f.endsWith(".json") || f.endsWith(".yaml"))
            ? `${symHeader}\n${oRes.text}`
            : oRes.text;
        const outlineBody = fileDiags ? `${baseOutlineBody}\n\n${fileDiags}` : baseOutlineBody;
        outlines.push(`### \`${relFile}\`\n\`\`\`aice\n${outlineBody}\n\`\`\``);
      }

      if (requestedSelectors.length > 0) {
        const fileSlices: string[] = [];
        if (requestedSelectors.includes("*")) {
          if (
            (f.endsWith(".html") || f.endsWith(".json") || f.endsWith(".yaml")) &&
            allSyms.length > 0
          ) {
            for (const sym of allSyms) {
              try {
                let sliced = unwrapSyntheticContainer(
                  extractSymbolFromAiceSource(fileAice, sym, f)
                    .replace(/^(?:(?:#|\/\/)[^\n]*|module\s+[^\n]+|\s+)+/g, "")
                    .trim(),
                  f,
                );
                sliced = compactPureAiceSlice(sliced);
                if (sliced) fileSlices.push(sliced);
              } catch {
                // fallback handled below if needed
              }
            }
          }
          if (fileSlices.length === 0) {
            let cleanedAll = unwrapSyntheticContainer(
              fileAice.replace(/^(?:(?:#|\/\/)[^\n]*|module\s+[^\n]+|\s+)+/g, "").trim(),
              f,
            );
            cleanedAll = compactPureAiceSlice(cleanedAll);
            fileSlices.push(cleanedAll);
          }
        } else {
          for (const rawSel of requestedSelectors) {
            let symSel = rawSel;
            const colonIdx = rawSel.indexOf(":");
            if (
              colonIdx > 0 &&
              !rawSel.startsWith("block:") &&
              !rawSel.startsWith("/") &&
              !rawSel.startsWith("#") &&
              !rawSel.includes("::")
            ) {
              const candidateFilter = rawSel.slice(0, colonIdx).trim();
              const matchesKnownFile = workspaceFiles.some(
                (cand) =>
                  path.basename(cand) === candidateFilter ||
                  formatDisplayPath(cand, projectRoot) === candidateFilter,
              );
              if (matchesKnownFile) {
                symSel = rawSel.slice(colonIdx + 1).trim();
                if (path.basename(f) !== candidateFilter && relFile !== candidateFilter) {
                  continue;
                }
              }
            }
            if (symSel === "@first" || symSel === "@1") {
              const firstSym = resolveFirstActionableSymbol(fileAice, f);
              if (!firstSym) continue;
              symSel = firstSym;
            }
            try {
              const rawExtracted = extractSymbolFromAiceSource(fileAice, symSel, f, undefined, {
                numberLines: true,
                clampOutOfBounds: true,
              });
              const isRawOrMatch =
                rawExtracted.startsWith("// match at [") ||
                f.endsWith(".md") ||
                f.endsWith(".markdown") ||
                f.endsWith(".sh") ||
                f.endsWith(".bash") ||
                f.endsWith(".zsh") ||
                f.endsWith(".ps1") ||
                f.endsWith(".cmd") ||
                f.endsWith(".bat") ||
                f.endsWith(".aipl");
              let sliced = isRawOrMatch
                ? rawExtracted.trim()
                : unwrapSyntheticContainer(
                    rawExtracted.replace(/^(?:(?:#|\/\/)[^\n]*|module\s+[^\n]+|\s+)+/g, "").trim(),
                    f,
                  );
              if (!isRawOrMatch) {
                sliced = compactPureAiceSlice(sliced);
              }
              fileSlices.push(sliced);
            } catch {
              // symbol lives in another file
            }
          }
        }
        if (fileSlices.length > 0) {
          const hitTags = Array.from(
            new Set(
              fileSlices
                .flatMap((sl) => Array.from(sl.matchAll(/^\/\/ match at \[([^\]]+)\]/gm)))
                .flatMap((m) => m[1].split(",").map((s) => s.trim()))
                .filter(Boolean),
            ),
          );
          const alreadyHasSymHeader = fileSlices.some((sl) => sl.startsWith("// symbols:"));
          const sliceBody = [alreadyHasSymHeader ? "" : symHeader, ...fileSlices]
            .filter(Boolean)
            .join("\n\n");
          if (sliceBody) {
            if (hitTags.length > 0) {
              symbolSlices.push(
                `### ${relFile} [${hitTags.join(", ")}]\n\`\`\`aice\n${sliceBody}\n\`\`\``,
              );
            } else {
              symbolSlices.push(`### \`${relFile}\`\n\`\`\`aice\n${sliceBody}\n\`\`\``);
            }
          }
        }
        continue;
      }

      if (!isPureAiceDirectory) {
        continue;
      }

      const imports = extractImportsFromFile(f);
      for (const imp of imports) {
        const specifier = imp.source;
        const importedSymbols = imp.specifiers.map((s) => s.name);
        const isExternal = isExternalSpecifier(specifier);
        let resolvedImportPath: string | undefined;

        if (!isExternal) {
          resolvedImportPath = resolveImportPath(f, specifier, config, projectRoot);
        }

        const key = isExternal
          ? `ext:${specifier}`
          : resolvedImportPath
            ? `res:${path.resolve(resolvedImportPath)}`
            : `unres:${specifier}`;

        if (depMap.has(key)) {
          const existing = depMap.get(key)!;
          let added = false;
          for (const sym of importedSymbols) {
            if (!existing.importedSymbols.includes(sym)) {
              existing.importedSymbols.push(sym);
              added = true;
            }
          }
          if (added) {
            if (isExternal) {
              existing.contract = generateExternalContract(specifier, existing.importedSymbols);
            } else if (resolvedImportPath) {
              existing.contract = extractExportedContract(
                resolvedImportPath,
                existing.importedSymbols,
              );
            }
          }
        } else {
          let contract: string;
          let displayDepPath: string | undefined;

          if (isExternal) {
            contract = generateExternalContract(specifier, importedSymbols);
          } else if (resolvedImportPath) {
            displayDepPath = formatDisplayPath(resolvedImportPath, projectRoot);
            contract = extractExportedContract(resolvedImportPath, importedSymbols);
          } else {
            contract = `// unresolved: ${specifier}`;
          }

          const depContract: DependencyContract = {
            specifier,
            resolvedPath: displayDepPath,
            importedSymbols,
            isExternal,
            contract,
          };

          dependencies.push(depContract);
          depMap.set(key, depContract);
        }
      }
    } catch {
      // ignore outline errors for individual files in overview
    }
  }

  if (isPureRegexSearch && scoredFileSlices.length > 0) {
    scoredFileSlices.sort((a, b) => b.score - a.score || a.relFile.localeCompare(b.relFile));
    for (const item of scoredFileSlices) {
      symbolSlices.push(`### ${item.relFile}${item.headerTag}\n\`\`\`aice\n${item.sliceBody}\n\`\`\``);
    }
  }

  if (requestedSelectors.length > 0 && symbolSlices.length === 0 && !isPureRegexSearch) {
    for (const f of workspaceFiles) {
      const relFile = formatDisplayPath(f, projectRoot);
      try {
        const oRes = withSuppressedTelemetry(() =>
          generateOutline(f, {
            includeTypes: false,
            compact: true,
            depth: options.depth ?? 1,
            idioms: options.idioms,
            projectRoot,
          }),
        );
        outlines.push(`// === ${relFile} ===\n${oRes.text.trim() || "// (empty)"}`);
      } catch {
        // ignore
      }
    }
  }

  // Format bundle
  const parts: string[] = [];
  if (requestedSelectors.length > 0) {
    if (symbolSlices.length > 0) {
      parts.push("## Target Symbol Slices:", ...symbolSlices, "");
    } else if (outlines.length > 0) {
      parts.push("## Outlines:", ...outlines, "");
    }
    if (activeIdioms && Object.keys(activeIdioms).length > 0) {
      const bundlePreview = [...outlines, ...symbolSlices].join("\n");
      const usedIdioms: Record<string, ProjectIdiomDefinition> = {};
      for (const [k, def] of Object.entries(activeIdioms)) {
        const norm = k.startsWith("$") ? k : `$${k}`;
        if (bundlePreview.includes(norm)) {
          usedIdioms[norm] = def;
        }
      }
      if (Object.keys(usedIdioms).length > 0) {
        parts.push(formatIdiomsMarkdownSection(usedIdioms), "");
      }
    }
  } else if (!isPureAiceDirectory) {
    parts.push(
      `# AICE Directory Outline: ${displayTargetPath} (${workspaceFiles.length} files)`,
      ...outlines,
    );
    if (activeIdioms && Object.keys(activeIdioms).length > 0) {
      parts.push("", formatIdiomsMarkdownSection(activeIdioms));
    }
  } else {
    parts.push(
      `# AICE Workspace Overview Context Pack: ${displayTargetPath}`,
      "",
      "## Project Configuration:",
      `- Mode: ${config.mode}`,
      `- Source Directory: ${config.sourceDir}`,
      `- Output Directory: ${config.outDir}`,
      `- Target Language: ${config.targetLanguage}`,
      `- Files Count: ${workspaceFiles.length}`,
      "",
      `## Workspace Files (${workspaceFiles.length}):`,
      ...workspaceFiles.map((f) => `- \`${formatDisplayPath(f, projectRoot)}\``),
      "",
    );

    if (outlines.length > 0) {
      parts.push("## Module Outlines:", ...outlines, "");
    }

    if (dependencies.length > 0) {
      parts.push(`## Workspace Dependencies (${dependencies.length}):`);
      for (const dep of dependencies) {
        parts.push(
          `### Dependency: \`${dep.specifier}\`${dep.resolvedPath ? ` (\`${dep.resolvedPath}\`)` : ""}`,
        );
        parts.push("```aice");
        parts.push(dep.contract);
        parts.push("```");
        parts.push("");
      }
    }

    if (activeIdioms && Object.keys(activeIdioms).length > 0) {
      parts.push(formatIdiomsMarkdownSection(activeIdioms), "");
    }
  }

  let formattedBundle = parts.join("\n");
  let tokenCount = estimateTokens(formattedBundle);

  // Apply maxTokens bounding if requested
  if (options.maxTokens !== undefined && tokenCount > options.maxTokens) {
    if (requestedSelectors.length > 0 && symbolSlices.length > 1) {
      const keptSlices = [...symbolSlices];
      let droppedCount = 0;
      while (keptSlices.length > 1) {
        keptSlices.pop();
        droppedCount++;
        const omitNote = `// ... (+${droppedCount} lower-ranked file matches omitted to fit maxTokens)`;
        const candidate = ["## Target Symbol Slices:", ...keptSlices, omitNote].join("\n");
        if (estimateTokens(candidate) <= options.maxTokens) {
          formattedBundle = candidate;
          tokenCount = estimateTokens(formattedBundle);
          break;
        }
      }
      if (tokenCount > options.maxTokens && keptSlices.length === 1) {
        const omitNote = `// ... (+${droppedCount} lower-ranked file matches omitted to fit maxTokens)`;
        formattedBundle = ["## Target Symbol Slices:", keptSlices[0]!, omitNote].join("\n");
        tokenCount = estimateTokens(formattedBundle);
      }
    }

    if (tokenCount > options.maxTokens) {
      const truncatedFooter = "\n// ... [truncated to fit maxTokens]";
      const bundleLines = formattedBundle.split("\n");
      while (bundleLines.length > 1) {
        bundleLines.pop();
        const openFenceCount = bundleLines.filter((l) => l.startsWith("```")).length;
        const closeFence = openFenceCount % 2 === 1 ? "\n```" : "";
        const candidate = `${bundleLines.join("\n")}${closeFence}${truncatedFooter}`;
        if (estimateTokens(candidate) <= options.maxTokens) {
          formattedBundle = candidate;
          tokenCount = estimateTokens(formattedBundle);
          break;
        }
      }
      if (tokenCount > options.maxTokens) {
        let chars = formattedBundle.length;
        while (
          chars > 0 &&
          estimateTokens(formattedBundle.slice(0, chars) + truncatedFooter) > options.maxTokens
        ) {
          chars = Math.floor(chars * 0.7);
        }
        formattedBundle =
          estimateTokens(formattedBundle.slice(0, chars) + truncatedFooter) <= options.maxTokens
            ? (chars > 0 ? formattedBundle.slice(0, chars) : "") + truncatedFooter
            : truncatedFooter.slice(0, Math.max(0, options.maxTokens * 3));
        tokenCount = estimateTokens(formattedBundle);
      }
    }
  }

  const targetContent =
    requestedSelectors.length > 0
      ? symbolSlices.length > 0
        ? symbolSlices.join("\n\n")
        : outlines.join("\n\n")
      : !isPureAiceDirectory
        ? outlines.join("\n\n")
        : workspaceFiles.map((f) => formatDisplayPath(f, projectRoot)).join("\n");

  const resObj: ContextResult = {
    targetPath: displayTargetPath,
    targetContent,
    targetOutline: outlines.join("\n\n"),
    dependencies,
    callers: [],
    formattedBundle,
    tokenCount,
    idioms: activeIdioms,
    ...(zeroIdiomsReason ? { zeroIdiomsReason } : {}),
  };

  if (rawWorkspaceTexts.length > 0) {
    const joinedNative = rawWorkspaceTexts.join("\n\n");
    recordTelemetryEvent({
      targetPath: resolved.resolvedPath,
      projectRoot,
      operation: "context",
      surface: "cli",
      idiomsUsed: Boolean(activeIdioms && Object.keys(activeIdioms).length > 0),
      nativeText: joinedNative.length >= formattedBundle.length ? joinedNative : formattedBundle,
      realisticNativeText:
        joinedNative.length >= formattedBundle.length ? joinedNative : formattedBundle,
      aiceText: options.json ? JSON.stringify(resObj, null, 2) : formattedBundle,
    });
  }

  return resObj;
}

function normalizeIdentForMatch(s: string): string {
  return s.replace(/[_-]/g, "").toLowerCase();
}

function matchLayoutNodes(nodes: LayoutNode[], rawSelector: string): LayoutNode[] {
  const sel = rawSelector.trim();
  const isId = sel.startsWith("#");
  const isClass = sel.startsWith(".");
  const isBlock = sel.startsWith("block:");
  const cleanSel = sel.replace(/^(?:#|\.|block:)/, "");
  const normClean = normalizeIdentForMatch(cleanSel);
  const matched: LayoutNode[] = [];

  const getAttrStr = (node: LayoutNode, attrName: string): string | undefined => {
    const attr = node.attributes.find((a) => a.name === attrName);
    if (!attr) return undefined;
    if (attr.value.kind === "LiteralExpr") return String(attr.value.value);
    if (attr.value.kind === "IdentifierExpr") return attr.value.name;
    return undefined;
  };

  const visit = (list: LayoutNode[]) => {
    for (const n of list) {
      let isMatch = false;
      if (isId) {
        const idVal = getAttrStr(n, "id");
        if (idVal && (idVal === cleanSel || normalizeIdentForMatch(idVal) === normClean)) {
          isMatch = true;
        }
      } else if (isClass) {
        const clsVal = getAttrStr(n, "class") ?? getAttrStr(n, "className") ?? "";
        const tokens = clsVal.split(/\s+/).filter(Boolean);
        if (
          tokens.includes(cleanSel) ||
          tokens.some((t) => normalizeIdentForMatch(t) === normClean)
        ) {
          isMatch = true;
        }
      } else if (isBlock) {
        const blkVal =
          getAttrStr(n, "twig_block") ??
          getAttrStr(n, "block") ??
          (n.tag === "block" ? getAttrStr(n, "name") : undefined);
        if (blkVal && (blkVal === cleanSel || normalizeIdentForMatch(blkVal) === normClean)) {
          isMatch = true;
        }
      } else {
        const idVal = getAttrStr(n, "id");
        const blkVal =
          getAttrStr(n, "twig_block") ??
          getAttrStr(n, "block") ??
          (n.tag === "block" ? getAttrStr(n, "name") : undefined);
        const clsVal = getAttrStr(n, "class") ?? getAttrStr(n, "className") ?? "";
        const tokens = clsVal.split(/\s+/).filter(Boolean);
        if (
          n.tag === cleanSel ||
          normalizeIdentForMatch(n.tag) === normClean ||
          (idVal && (idVal === cleanSel || normalizeIdentForMatch(idVal) === normClean)) ||
          (blkVal && (blkVal === cleanSel || normalizeIdentForMatch(blkVal) === normClean)) ||
          tokens.includes(cleanSel)
        ) {
          isMatch = true;
        }
      }

      if (isMatch) {
        matched.push(n);
      } else if (n.children && n.children.length > 0) {
        visit(n.children);
      }
    }
  };

  visit(nodes);
  return matched;
}

function sliceRecordLiteralByPath(
  expr: Expr,
  keyParts: string[],
): { leafName: string; value: Expr } | undefined {
  let cur: Expr = expr;
  let lastKey = keyParts[keyParts.length - 1] ?? "config";
  for (const part of keyParts) {
    if (cur.kind !== "RecordLiteralExpr") return undefined;
    const normPart = normalizeIdentForMatch(part);
    const prop =
      cur.properties.find((p) => p.key === part) ??
      cur.properties.find((p) => p.key && normalizeIdentForMatch(p.key) === normPart);
    if (!prop) return undefined;
    lastKey = prop.key ?? part;
    cur = prop.value;
  }
  return { leafName: lastKey, value: cur };
}

function hasCatastrophicNestedQuantifiers(pattern: string): boolean {
  if (pattern.length > 512) return true;
  if (/(\.\*){4,}/.test(pattern)) return true;
  return /\([^()]*[+*][^()]*\)\s*[+*?{]/.test(pattern);
}

export interface PatternMatchRankingOptions {
  filePath?: string;
  projectRoot?: string;
  isExplicitTestSearch?: boolean;
}

const QUERY_KEYWORD_STOPWORDS = new Set([
  "const",
  "let",
  "var",
  "val",
  "mut",
  "function",
  "fn",
  "def",
  "fun",
  "func",
  "class",
  "struct",
  "enum",
  "interface",
  "type",
  "trait",
  "impl",
  "pub",
  "public",
  "private",
  "protected",
  "export",
  "import",
  "from",
  "async",
  "await",
  "return",
  "static",
  "readonly",
]);

export function extractPrimaryQueryKeyword(rawQuery: string): string | undefined {
  const trimmed = rawQuery.trim();
  if (!trimmed) return undefined;
  const regexMatch = trimmed.match(/^\/(.+)\/([gimsuy]*)$/);
  let body = regexMatch ? regexMatch[1]! : trimmed;
  if (regexMatch) {
    body = body
      .replace(/\\\$/g, "$")
      .replace(/\[(?:\\.|[^\]\\])*\]/g, " ")
      .replace(
        /\\(?:x[0-9a-fA-F]{2}|u\{[0-9a-fA-F]+\}|u[0-9a-fA-F]{4}|c[A-Za-z]|[pP]\{[^}]*\}|[bBwdDsSnrtfv0]|[1-9]\d*|[^A-Za-z0-9_$])/g,
        " ",
      );
  }
  const tokens = body
    .split(/[^A-Za-z0-9_$-]+/)
    .map((t) => t.replace(/^-+|-+$/g, "").trim())
    .filter((t) => t.length >= 2 && !/^\d+$/.test(t));
  if (tokens.length === 0) return undefined;
  const nonStop = tokens.filter((t) => !QUERY_KEYWORD_STOPWORDS.has(t.toLowerCase()));
  return nonStop[0] ?? tokens[0];
}

export function doesFileStemMatchQuery(filePath: string, queryKeyword?: string): boolean {
  if (!filePath || !queryKeyword) return false;
  const kw = queryKeyword.replace(/^\$/, "").toLowerCase();
  if (kw.length < 2) return false;
  const base = path.basename(filePath);
  const ext = path.extname(base);
  const rawStem = ext ? base.slice(0, -ext.length) : base;
  const stem = rawStem
    .replace(/\.(?:d|test|spec|mock)s?$/i, "")
    .replace(/[_-](?:test|spec|mock)s?$/i, "")
    .toLowerCase();
  if (!stem) return false;
  if (kw.length <= 2) {
    return stem === kw || stem.split(/[^a-z0-9]+/).includes(kw);
  }
  if (stem.includes(kw)) return true;
  if (kw.length >= 4) {
    const normStem = stem.replace(/[^a-z0-9]/g, "");
    const normKw = kw.replace(/[^a-z0-9]/g, "");
    if (normKw.length >= 4 && normStem.includes(normKw)) {
      return true;
    }
  }
  return false;
}

export function isTestOrMockPath(filePath: string, projectRoot?: string): boolean {
  let target = filePath;
  if (projectRoot) {
    const rel = path.relative(projectRoot, filePath);
    if (rel && !rel.startsWith("..") && !path.isAbsolute(rel)) {
      target = rel;
    }
  }
  const norm = target.replace(/\\/g, "/").toLowerCase();
  return (
    /(?:^|\/)(?:tests?|__tests__|mocks?|__mocks__|fixtures?|benchmarks?|specs?)(?:\/|$)/.test(norm) ||
    /\.(?:test|spec|mock)s?\.[a-z0-9]+$/i.test(norm) ||
    /(?:^|\/)(?:test|spec|mock)[_-][^/]+\.[a-z0-9]+$/i.test(norm) ||
    /[_-](?:test|spec|mock)s?\.[a-z0-9]+$/i.test(norm)
  );
}

export function isCommentLine(line: string, filePath?: string): boolean {
  const t = line.trim();
  if (!t) return false;
  if (t.startsWith("//") || t.startsWith("/*") || t.startsWith("<!--")) {
    return true;
  }
  if (t === "*" || t.startsWith("* ") || t.startsWith("*\t") || t.startsWith("*/")) {
    return true;
  }
  const ext = filePath ? path.extname(filePath).toLowerCase() : "";
  if (t.startsWith("#")) {
    if (ext === ".md" || ext === ".markdown" || ext === ".css" || ext === ".html" || ext === ".cs") {
      return false;
    }
    if (t.startsWith("#[") || t.startsWith("#![")) {
      return false;
    }
    if (/^#\s*(?:include|define|ifdef|ifndef|endif|pragma|if|elif|else|undef|error)\b/.test(t)) {
      return false;
    }
    return true;
  }
  if (t.startsWith('"""') || t.startsWith("'''")) {
    return ext === ".py" || ext === ".pyi" || ext === "";
  }
  if (t.startsWith("--")) {
    return ext === ".sql" || ext === ".lua" || ext === ".hs" || ext === ".ada";
  }
  return false;
}

export function isDeclarationLine(line: string): boolean {
  return /\b(function|class|interface|type|enum|struct|fn|def|fun|func|pub|export|const|let|var|val|sub|record|impl|trait)\b/.test(
    line,
  );
}

function scorePatternWindow(
  lines: string[],
  w: { start: number; end: number; hits: number[] },
  filePath?: string,
  queryKeyword?: string,
  isExplicitTestSearch = false,
  projectRoot?: string,
): number {
  const isMockOrTest =
    Boolean(filePath) && !isExplicitTestSearch && isTestOrMockPath(filePath!, projectRoot);

  let fileNameBonus = 0;
  if (filePath && doesFileStemMatchQuery(filePath, queryKeyword)) {
    fileNameBonus = isMockOrTest ? 20 : 1000;
  }

  let hasDeclaration = false;
  let hasCode = false;
  let allComments = true;

  for (const h of w.hits) {
    const lineText = lines[h - 1] ?? "";
    if (isCommentLine(lineText, filePath)) {
      // comment hit
    } else {
      allComments = false;
      hasCode = true;
      if (isDeclarationLine(lineText)) {
        hasDeclaration = true;
      }
    }
  }

  let lineScore = 0;
  if (!isMockOrTest) {
    if (hasDeclaration) lineScore = 500;
    else if (hasCode) lineScore = 300;
    else if (allComments) lineScore = 100;
  } else {
    if (hasDeclaration) lineScore = 50;
    else if (hasCode) lineScore = 30;
    else if (allComments) lineScore = 10;
  }

  const lineTieBreaker = Math.max(0, 10 - w.start / 100);
  return fileNameBonus + lineScore + lineTieBreaker;
}

export interface PatternMatchResult {
  formattedText: string;
  maxScore: number;
}

export function extractPatternMatchesDetailed(
  rawSource: string,
  rawQuery: string,
  contextRadius = 2,
  rankingOpts?: PatternMatchRankingOptions,
): PatternMatchResult | undefined {
  const trimmed = rawQuery.trim();
  if (!trimmed) return undefined;
  const regexMatch = trimmed.match(/^\/(.+)\/([gimsuy]*)$/);
  let matcher: (line: string) => boolean;
  let queryKeyword: string | undefined;

  if (regexMatch) {
    const rawBody = regexMatch[1]!;
    if (hasCatastrophicNestedQuantifiers(rawBody)) {
      throw new Error(`Unsafe or overly complex regex selector '${trimmed}'`);
    }
    const safeFlags = regexMatch[2]!.replace(/[^imsu]/g, "");
    let re: RegExp;
    try {
      re = new RegExp(rawBody, safeFlags);
    } catch {
      const escapedLiteral = rawBody.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      re = new RegExp(escapedLiteral, safeFlags || "i");
    }
    matcher = (line: string) => re.test(line);
    queryKeyword = extractPrimaryQueryKeyword(trimmed);
  } else if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(trimmed)) {
    queryKeyword = trimmed;
    const esc = trimmed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const identRe = new RegExp(`\\b${esc}\\b`);
    matcher = (line: string) => {
      if (isCommentLine(line, rankingOpts?.filePath)) return false;
      return identRe.test(line);
    };
  } else {
    const lower = trimmed.toLowerCase();
    matcher = (line: string) => line.includes(trimmed) || line.toLowerCase().includes(lower);
    queryKeyword = extractPrimaryQueryKeyword(trimmed);
  }

  const lines = rawSource.split(/\r?\n/);
  const hitLines: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (matcher(lines[i]!)) {
      hitLines.push(i + 1);
    }
  }
  if (hitLines.length === 0) return undefined;

  const windows: Array<{ start: number; end: number; hits: number[] }> = [];
  for (const lineNum of hitLines) {
    const s = Math.max(1, lineNum - contextRadius);
    const e = Math.min(lines.length, lineNum + contextRadius);
    const last = windows[windows.length - 1];
    if (last && s <= last.end + 1) {
      last.end = Math.max(last.end, e);
      last.hits.push(lineNum);
    } else {
      windows.push({ start: s, end: e, hits: [lineNum] });
    }
  }

  const scoredWindows = windows.map((w) => ({
    ...w,
    score: scorePatternWindow(
      lines,
      w,
      rankingOpts?.filePath,
      queryKeyword,
      rankingOpts?.isExplicitTestSearch ?? false,
      rankingOpts?.projectRoot,
    ),
  }));

  const maxScore = scoredWindows.reduce((max, w) => Math.max(max, w.score), 0);

  const topWindows = scoredWindows
    .sort((a, b) => b.score - a.score || a.start - b.start)
    .slice(0, 25)
    .sort((a, b) => a.start - b.start);

  const formattedText = topWindows
    .map((w) => {
      const hitDesc = w.hits.map((h) => `L${h}`).join(", ");
      const body = lines
        .slice(w.start - 1, w.end)
        .map((text, idx) => `L${w.start + idx}: ${text}`)
        .join("\n");
      return `// match at [${hitDesc}] # [L${w.start}-L${w.end}]\n${body}`;
    })
    .join("\n\n");

  return { formattedText, maxScore };
}

function extractPatternMatchesFromSource(
  rawSource: string,
  rawQuery: string,
  contextRadius = 2,
  rankingOpts?: PatternMatchRankingOptions,
): string | undefined {
  return extractPatternMatchesDetailed(rawSource, rawQuery, contextRadius, rankingOpts)?.formattedText;
}

function formatWithLineNumbers(text: string, startLine = 1): string {
  const lines = text.split("\n");
  return lines
    .map((line, idx) => {
      if (
        /^\s*\d+│\s/.test(line) ||
        /^L\d+:\s/.test(line) ||
        /^\/\/ match at \[/.test(line) ||
        /^\[Clamped /.test(line)
      ) {
        return line;
      }
      return `${startLine + idx}│ ${line}`;
    })
    .join("\n");
}

function resolveParentMemberFallback(
  rawFileSource: string,
  _aiceSource: string,
  className: string,
  memberName: string,
  filePath: string,
  mod?: Module,
): { text: string; startLine: number } | undefined {
  const normClass = normalizeIdentForMatch(className);
  const normMember = normalizeIdentForMatch(memberName);

  if (!filePath.endsWith(".aice")) {
    const targetLang = detectTargetFromPath(filePath);
    const directSpan = locateNativeDeclarationSpan(
      rawFileSource,
      `${className}.${memberName}`,
      targetLang,
      className,
    );
    if (directSpan) {
      const startOff = directSpan.fullDeclStart ?? directSpan.declStart;
      const startLine =
        directSpan.startLine ?? rawFileSource.slice(0, startOff).split(/\r?\n/).length;
      return {
        text: rawFileSource.slice(startOff, directSpan.declEnd),
        startLine,
      };
    }

    const parentSpan = locateNativeDeclarationSpan(rawFileSource, className, targetLang);
    if (parentSpan) {
      const parentStartOff = parentSpan.fullDeclStart ?? parentSpan.declStart;
      const parentStartLine =
        parentSpan.startLine ?? rawFileSource.slice(0, parentStartOff).split(/\r?\n/).length;
      const parentSlice = rawFileSource.slice(parentStartOff, parentSpan.declEnd);
      const parentLines = parentSlice.split(/\r?\n/);

      if (parentLines.length <= 35) {
        return { text: parentSlice, startLine: parentStartLine };
      }

      const escMember = memberName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const memberWordRe = new RegExp(`\\b${escMember}\\b`, "i");
      const hitIndices: number[] = [];
      for (let i = 0; i < parentLines.length; i++) {
        const ln = parentLines[i]!;
        if (memberWordRe.test(ln) || normalizeIdentForMatch(ln).includes(normMember)) {
          hitIndices.push(i);
        }
      }

      if (hitIndices.length > 0) {
        const firstIdx = hitIndices[0]!;
        let endIdx = firstIdx;
        let braceDepth = 0;
        let parenDepth = 0;
        let sawOpen = false;
        for (let k = firstIdx; k < parentLines.length; k++) {
          const ln = parentLines[k]!;
          for (let c = 0; c < ln.length; c++) {
            const ch = ln[c];
            if (ch === "{") {
              braceDepth++;
              sawOpen = true;
            } else if (ch === "}") {
              braceDepth = Math.max(0, braceDepth - 1);
            } else if (ch === "(") {
              parenDepth++;
              sawOpen = true;
            } else if (ch === ")") {
              parenDepth = Math.max(0, parenDepth - 1);
            }
          }
          endIdx = k;
          if (sawOpen && braceDepth === 0 && parenDepth === 0) {
            break;
          }
          if (!sawOpen && k >= firstIdx + 6) {
            break;
          }
        }
        const sliceStartIdx = sawOpen ? firstIdx : Math.max(0, firstIdx - 2);
        const sliceEndIdx = sawOpen
          ? Math.min(parentLines.length - 1, endIdx)
          : Math.min(parentLines.length - 1, firstIdx + 6);
        return {
          text: parentLines.slice(sliceStartIdx, sliceEndIdx + 1).join("\n"),
          startLine: parentStartLine + sliceStartIdx,
        };
      }

      return { text: parentSlice, startLine: parentStartLine };
    }
  }

  if (mod) {
    const parentItem = mod.items.find(
      (it) =>
        "name" in it &&
        typeof it.name === "string" &&
        (it.name === className || normalizeIdentForMatch(it.name) === normClass),
    );
    if (parentItem) {
      const startLine = parentItem.span?.start?.line ?? 1;
      return {
        text: AiceGenerator.generate({
          kind: "Module",
          path: mod.path,
          items: [parentItem],
          span: mod.span,
        }),
        startLine,
      };
    }
  }

  return undefined;
}

export function extractSymbolFromAiceSource(
  aiceSource: string,
  symbolSelector: string,
  filePath: string,
  preParsedMod?: Module,
  options?: { numberLines?: boolean; clampOutOfBounds?: boolean },
): string {
  let trimmedSel = symbolSelector.trim();
  const rawFileSource =
    !filePath.endsWith(".aice") && fs.existsSync(filePath)
      ? fs.readFileSync(filePath, "utf-8")
      : aiceSource;

  const finalizeExtracted = (text: string, startLine = 1): string => {
    const lineCount = text.split("\n").length;
    if (lineCount > 25) {
      return formatWithLineNumbers(text, startLine);
    }
    return text;
  };

  const lineRangeMatch = trimmedSel.match(/^\[?L(\d+)(?:-L?(\d+))?\]?$/i);
  if (lineRangeMatch) {
    const startLine = Number.parseInt(lineRangeMatch[1], 10);
    const endLine = lineRangeMatch[2] ? Number.parseInt(lineRangeMatch[2], 10) : startLine;
    const rawLines = rawFileSource.split(/\r?\n/);
    const totalLines = rawLines.length;
    if (startLine < 1) {
      throw new Error(`Invalid line range L${startLine}-L${endLine}: start line must be >= 1`);
    }
    if (startLine > totalLines) {
      if (options?.clampOutOfBounds || totalLines > 10) {
        const clampedStart = Math.max(1, totalLines - 29);
        const clampedEnd = totalLines;
        const clampedLines = rawLines
          .slice(clampedStart - 1, clampedEnd)
          .map((ln, idx) => `${clampedStart + idx}│ ${ln}`)
          .join("\n");
        return `[Clamped L${startLine}-L${endLine} -> L${clampedStart}-L${clampedEnd} (EOF)]\n${clampedLines}`;
      }
      throw new Error(
        `Invalid line range L${startLine}-L${endLine}: file has ${totalLines} line(s) (1-based inclusive). Start line ${startLine} exceeds file length. Use ':eof' or ':append' to add content at end of file.`,
      );
    }
    if (startLine > endLine) {
      throw new Error(
        `Invalid line range L${startLine}-L${endLine}: start line (${startLine}) cannot be greater than end line (${endLine})`,
      );
    }
    const clampedEnd = Math.min(endLine, totalLines);
    const sliceLines = rawLines.slice(startLine - 1, clampedEnd);
    if (options?.numberLines || sliceLines.length > 25) {
      return sliceLines.map((ln, idx) => `${startLine + idx}│ ${ln}`).join("\n");
    }
    return sliceLines.join("\n");
  }

  if (/^\/.+\/[gimsuy]*(?:\s*,\s*\/[^\n]+\/[gimsuy]*)*$/.test(trimmedSel)) {
    const pieces = splitSymbolSelectors(trimmedSel);
    const rankOpts: PatternMatchRankingOptions = {
      filePath,
      isExplicitTestSearch: true,
    };
    const matchOneRegex = (piece: string): string | undefined => {
      const nativeHit = extractPatternMatchesFromSource(rawFileSource, piece, 2, rankOpts);
      const aiceHit =
        aiceSource !== rawFileSource && /\$[A-Za-z_]/.test(piece)
          ? extractPatternMatchesFromSource(aiceSource, piece, 2, rankOpts)
          : undefined;
      if (nativeHit && aiceHit) {
        return `${nativeHit.trim()}\n\n${aiceHit.trim()}`;
      }
      return nativeHit ?? aiceHit;
    };
    if (pieces.length > 1) {
      const results: string[] = [];
      for (const piece of pieces) {
        const m = matchOneRegex(piece);
        if (m) results.push(m.trim());
      }
      if (results.length > 0) return results.join("\n\n");
      return `// Patterns '${symbolSelector}' had 0 matches in ${filePath}${didYouMeanSymbol(rawFileSource, symbolSelector)}\n`;
    }
    const matched = matchOneRegex(trimmedSel);
    if (matched) return matched;
    return `// Pattern '${symbolSelector}' had 0 matches in ${filePath}${didYouMeanSymbol(rawFileSource, symbolSelector)}\n`;
  }
  if (trimmedSel === "@first" || trimmedSel === "@1") {
    const first =
      resolveFirstActionableSymbol(aiceSource, filePath, preParsedMod) ??
      resolveFirstActionableSymbol(rawFileSource, filePath, preParsedMod);
    if (first) trimmedSel = first;
  }

  const isLeadingDotOrHash = trimmedSel.startsWith(".") || trimmedSel.startsWith("#");
  const parts = isLeadingDotOrHash ? [trimmedSel] : trimmedSel.split(/\.|::/);
  const className = parts.length >= 2 ? parts[0].trim() : undefined;
  const memberName = parts.length >= 2 ? parts.slice(1).join(".").trim() : trimmedSel;
  const normMember = normalizeIdentForMatch(memberName);

  if (!filePath.endsWith(".aice")) {
    const targetLang = detectTargetFromPath(filePath);
    if (
      targetLang === "markdown" ||
      targetLang === "shell" ||
      targetLang === "powershell" ||
      targetLang === "batch" ||
      targetLang === "aipl"
    ) {
      const spanInfo = locateNativeDeclarationSpan(rawFileSource, trimmedSel, targetLang);
      if (spanInfo) {
        const startOff = spanInfo.fullDeclStart ?? spanInfo.declStart;
        const sLine = spanInfo.startLine ?? rawFileSource.slice(0, startOff).split(/\r?\n/).length;
        return finalizeExtracted(rawFileSource.slice(startOff, spanInfo.declEnd), sLine);
      }
      if (className) {
        const parentFallback = resolveParentMemberFallback(
          rawFileSource,
          aiceSource,
          className,
          memberName,
          filePath,
          preParsedMod,
        );
        if (parentFallback) {
          return finalizeExtracted(parentFallback.text, parentFallback.startLine);
        }
      }
      const patternFallback = extractPatternMatchesFromSource(rawFileSource, trimmedSel);
      if (patternFallback) return patternFallback;
      throw new Error(
        `Symbol '${symbolSelector}' not found in ${filePath}${didYouMeanSymbol(rawFileSource, symbolSelector)}`,
      );
    }
  }

  if (!filePath.endsWith(".aice") && rawFileSource.length > 50_000 && !preParsedMod) {
    const targetLang = detectTargetFromPath(filePath);
    const spanInfo = locateNativeDeclarationSpan(rawFileSource, trimmedSel, targetLang);
    if (spanInfo) {
      const startOff = spanInfo.fullDeclStart ?? spanInfo.declStart;
      const rawSlice = rawFileSource.slice(startOff, spanInfo.declEnd);
      const sLine = spanInfo.startLine ?? rawFileSource.slice(0, startOff).split(/\r?\n/).length;
      if (rawSlice.split(/\r?\n/).length > 25) {
        return finalizeExtracted(rawSlice, sLine);
      }
      try {
        const snippetToDecompile =
          spanInfo.className &&
          !/^(?:export\s+|function\s+|class\s+|const\s+|let\s+|var\s+|interface\s+|type\s+)/.test(
            rawSlice.trim(),
          )
            ? `class ${spanInfo.className} {\n${rawSlice}\n}`
            : rawSlice;
        const miniDecomp = withSuppressedTelemetry(() =>
          decompile(snippetToDecompile, targetLang, { filePath }),
        );
        if (miniDecomp.ast.items.length > 0) {
          return finalizeExtracted(AiceGenerator.generate(miniDecomp.ast), sLine);
        }
      } catch {
        // fall back to rawSlice
      }
      return finalizeExtracted(rawSlice, sLine);
    }
  }

  let mod: Module | undefined = preParsedMod;
  if (!mod) {
    try {
      mod = parse(aiceSource, filePath);
    } catch {
      mod = undefined;
    }
  }
  if (!mod) {
    if (!filePath.endsWith(".aice")) {
      const spanInfo = locateNativeDeclarationSpan(
        rawFileSource,
        trimmedSel,
        detectTargetFromPath(filePath),
      );
      if (spanInfo) {
        const startOff = spanInfo.fullDeclStart ?? spanInfo.declStart;
        const sLine = spanInfo.startLine ?? rawFileSource.slice(0, startOff).split(/\r?\n/).length;
        return finalizeExtracted(rawFileSource.slice(startOff, spanInfo.declEnd), sLine);
      }
      if (className) {
        const parentFallback = resolveParentMemberFallback(
          rawFileSource,
          aiceSource,
          className,
          memberName,
          filePath,
          undefined,
        );
        if (parentFallback) {
          return finalizeExtracted(parentFallback.text, parentFallback.startLine);
        }
      }
    }
    const patternFallback = extractPatternMatchesFromSource(rawFileSource, trimmedSel);
    if (patternFallback) return patternFallback;
    throw new Error(
      `Symbol '${symbolSelector}' not found in ${filePath}${didYouMeanSymbol(rawFileSource, symbolSelector)}`,
    );
  }
  if (trimmedSel === "@first" || trimmedSel === "@1") {
    const first = resolveFirstActionableSymbol(aiceSource, filePath, mod);
    if (first) trimmedSel = first;
  }
  if (trimmedSel.toLowerCase() === "imports" || trimmedSel.toLowerCase() === "import") {
    const impItems = mod.items.filter((it) => it.kind === "ImportDecl");
    if (impItems.length > 0) {
      return AiceGenerator.generate({
        kind: "Module",
        path: mod.path,
        items: impItems,
        span: mod.span,
      });
    }
  }
  for (const item of mod.items) {
    if (item.kind === "StyleDecl") {
      const bareItem = item.name.replace(/^[.#]/, "");
      const bareSel = trimmedSel.replace(/^[.#]/, "");
      if (
        item.name === trimmedSel ||
        bareItem === bareSel ||
        normalizeIdentForMatch(bareItem) === normalizeIdentForMatch(bareSel)
      ) {
        const scopedMod: Module = {
          kind: "Module",
          path: mod.path,
          items: [item],
          span: mod.span,
        };
        return AiceGenerator.generate(scopedMod);
      }
    }
  }

  const matchedItems: ModuleItem[] = [];

  for (const item of mod.items) {
    if (className) {
      if (
        item.kind === "ClassDecl" &&
        (item.name === className ||
          normalizeIdentForMatch(item.name) === normalizeIdentForMatch(className))
      ) {
        let matchedMethods = item.methods.filter((m) => m.name === memberName);
        if (matchedMethods.length === 0) {
          matchedMethods = item.methods.filter(
            (m) => normalizeIdentForMatch(m.name) === normMember,
          );
        }
        let matchedProps = item.properties.filter((p) => p.name === memberName);
        if (matchedProps.length === 0) {
          matchedProps = item.properties.filter(
            (p) => normalizeIdentForMatch(p.name) === normMember,
          );
        }
        if (matchedMethods.length === 0 && matchedProps.length > 0 && !filePath.endsWith(".aice")) {
          const nativePropSpan = locateNativeDeclarationSpan(
            rawFileSource,
            trimmedSel,
            detectTargetFromPath(filePath),
            className,
          );
          if (nativePropSpan) {
            const startOff = nativePropSpan.fullDeclStart ?? nativePropSpan.declStart;
            const propSlice = rawFileSource.slice(startOff, nativePropSpan.declEnd);
            if (propSlice.includes("=>") || propSlice.split(/\r?\n/).length > 1) {
              const sLine =
                nativePropSpan.startLine ?? rawFileSource.slice(0, startOff).split(/\r?\n/).length;
              return finalizeExtracted(propSlice, sLine);
            }
          }
        }
        if (matchedMethods.length > 0 || matchedProps.length > 0) {
          const scopedClass: ClassDecl = {
            ...item,
            properties: matchedProps,
            methods: matchedMethods,
            staticBlocks: [],
          };
          matchedItems.push(scopedClass);
        }
      } else if (
        item.kind === "TypeDecl" &&
        (item.name === className ||
          normalizeIdentForMatch(item.name) === normalizeIdentForMatch(className))
      ) {
        const matchedFields = (item.fields ?? []).filter(
          (f) => f.name === memberName || normalizeIdentForMatch(f.name) === normMember,
        );
        const matchedVariants = (item.variants ?? []).filter(
          (v) => v.name === memberName || normalizeIdentForMatch(v.name) === normMember,
        );
        if (matchedFields.length > 0 || matchedVariants.length > 0) {
          matchedItems.push({
            ...item,
            fields: matchedFields.length > 0 ? matchedFields : item.fields,
            variants: matchedVariants.length > 0 ? matchedVariants : item.variants,
          });
        }
      } else if (item.kind === "ConstDecl" && item.value.kind === "RecordLiteralExpr") {
        const keyParts =
          item.name === className ||
          normalizeIdentForMatch(item.name) === normalizeIdentForMatch(className)
            ? parts.slice(1)
            : parts;
        const sliced = sliceRecordLiteralByPath(item.value, keyParts);
        if (sliced) {
          matchedItems.push({
            ...item,
            name: sliced.leafName,
            value: sliced.value,
          });
        }
      } else if (item.kind === "ComponentDecl") {
        const layoutSel =
          item.name === className ||
          normalizeIdentForMatch(item.name) === normalizeIdentForMatch(className)
            ? memberName
            : trimmedSel;
        const matchedLayout = matchLayoutNodes(item.layout, layoutSel);
        if (matchedLayout.length > 0) {
          matchedItems.push({
            ...item,
            layout: matchedLayout,
          });
        }
      }
    } else {
      if (
        (item.kind === "FunctionDecl" ||
          item.kind === "ClassDecl" ||
          item.kind === "TypeDecl" ||
          item.kind === "ConstDecl" ||
          item.kind === "VarDecl" ||
          item.kind === "ComponentDecl") &&
        (item.name === memberName || normalizeIdentForMatch(item.name) === normMember)
      ) {
        matchedItems.push(item);
      } else if (item.kind === "ClassDecl") {
        let matchedMethods = item.methods.filter((m) => m.name === memberName);
        if (matchedMethods.length === 0) {
          matchedMethods = item.methods.filter(
            (m) => normalizeIdentForMatch(m.name) === normMember,
          );
        }
        let matchedProps = item.properties.filter((p) => p.name === memberName);
        if (matchedProps.length === 0) {
          matchedProps = item.properties.filter(
            (p) => normalizeIdentForMatch(p.name) === normMember,
          );
        }
        if (matchedMethods.length > 0 || matchedProps.length > 0) {
          const scopedClass: ClassDecl = {
            ...item,
            properties: matchedProps,
            methods: matchedMethods,
            staticBlocks: [],
          };
          matchedItems.push(scopedClass);
        }
      } else if (item.kind === "ConstDecl" && item.value.kind === "RecordLiteralExpr") {
        const sliced = sliceRecordLiteralByPath(item.value, [memberName]);
        if (sliced) {
          matchedItems.push({
            ...item,
            name: sliced.leafName,
            value: sliced.value,
          });
        }
      } else if (item.kind === "ComponentDecl") {
        const matchedLayout = matchLayoutNodes(item.layout, memberName);
        if (matchedLayout.length > 0) {
          matchedItems.push({
            ...item,
            layout: matchedLayout,
          });
        }
      }
    }
  }
  if (matchedItems.length === 0) {
    if (!filePath.endsWith(".aice")) {
      const spanInfo = locateNativeDeclarationSpan(
        rawFileSource,
        trimmedSel,
        detectTargetFromPath(filePath),
      );
      if (spanInfo) {
        const startOff = spanInfo.fullDeclStart ?? spanInfo.declStart;
        const sLine = spanInfo.startLine ?? rawFileSource.slice(0, startOff).split(/\r?\n/).length;
        return finalizeExtracted(rawFileSource.slice(startOff, spanInfo.declEnd), sLine);
      }
    }
    if (className) {
      const parentFallback = resolveParentMemberFallback(
        rawFileSource,
        aiceSource,
        className,
        memberName,
        filePath,
        mod,
      );
      if (parentFallback) {
        return finalizeExtracted(parentFallback.text, parentFallback.startLine);
      }
    }
    const patternFallback = extractPatternMatchesFromSource(rawFileSource, trimmedSel);
    if (patternFallback) return patternFallback;
    throw new Error(
      `Symbol '${symbolSelector}' not found in ${filePath}${didYouMeanSymbol(rawFileSource, symbolSelector)}`,
    );
  }
  const scopedMod: Module = {
    kind: "Module",
    path: mod.path,
    items: matchedItems,
    span: mod.span,
  };
  let startLineForSym = matchedItems[0]?.span?.start?.line ?? 1;
  if (!filePath.endsWith(".aice")) {
    const natSpan = locateNativeDeclarationSpan(
      rawFileSource,
      trimmedSel,
      detectTargetFromPath(filePath),
    );
    if (natSpan?.startLine) {
      startLineForSym = natSpan.startLine;
    }
    if (options?.numberLines && natSpan) {
      const startOff = natSpan.fullDeclStart ?? natSpan.declStart;
      const rawSlice = rawFileSource.slice(startOff, natSpan.declEnd);
      if (rawSlice.split(/\r?\n/).length > 25) {
        const sLine = natSpan.startLine ?? rawFileSource.slice(0, startOff).split(/\r?\n/).length;
        return finalizeExtracted(rawSlice, sLine);
      }
    }
  }
  return finalizeExtracted(AiceGenerator.generate(scopedMod), startLineForSym);
}

/**
 * Packages dependency contracts, target file content, and downstream callers into a 1-turn context pack.
 * If targetPath is omitted or points to a directory, packages a workspace overview context pack.
 */
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
      const ext = path.extname(candidateFile).toLowerCase();
      if (fs.existsSync(absCand) || KNOWN_TARGET_EXTENSIONS.has(ext) || ext === ".aice") {
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
      const extW = path.extname(parsedW.targetPath).toLowerCase();
      const firstExt = path.extname(wholeCheck.targetPath).toLowerCase();
      const isDocOrTest =
        firstExt === ".md" ||
        firstExt === ".markdown" ||
        /\.(?:test|spec)\.[a-z0-9]+$/i.test(wholeCheck.targetPath);
      if (!isDocOrTest && (KNOWN_TARGET_EXTENSIONS.has(extW) || extW === ".aice")) {
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
    const tokExt = path.extname(tokParsed.targetPath).toLowerCase();
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
      KNOWN_TARGET_EXTENSIONS.has(tokExt) ||
      tokExt === ".aice";
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
      const ext = path.extname(p).toLowerCase();
      return targetExistsOnDisk(p) || KNOWN_TARGET_EXTENSIONS.has(ext) || ext === ".aice";
    });
    if (allLookLikeTargets) {
      return mergedTokens;
    }
  }
  return [trimmed];
}

export async function generateContext(
  rawTargetPath?: string | string[],
  rawOptions: ContextOptions = {},
): Promise<ContextResult> {
  if (Array.isArray(rawTargetPath)) {
    const filtered = rawTargetPath.map((t) => String(t).trim()).filter(Boolean);
    if (filtered.length === 0) {
      return generateWorkspaceContext(undefined, rawOptions);
    }
    if (filtered.length === 1) {
      return generateContext(filtered[0], rawOptions);
    }
    return generateMultiContext(filtered, rawOptions);
  }

  if (!rawTargetPath || rawTargetPath.trim() === "") {
    return generateWorkspaceContext(undefined, rawOptions);
  }

  const baseDir = rawOptions.projectRoot ? path.resolve(rawOptions.projectRoot) : process.cwd();
  if (/\s+/.test(rawTargetPath.trim())) {
    const tokens = splitContextTargets(rawTargetPath, baseDir);
    if (tokens.length > 1) {
      return generateMultiContext(tokens, rawOptions);
    }
  }

  const parsedTarget = parseTargetWithInlineSymbol(rawTargetPath, baseDir);
  const targetPath = parsedTarget.targetPath;
  const options: ContextOptions = parsedTarget.inlineSymbol
    ? { ...rawOptions, symbol: parsedTarget.inlineSymbol }
    : rawOptions;

  const preResolved = resolveEffectiveTargetAndRoot(targetPath, options.projectRoot);
  const resolved = resolvePathTargets(preResolved.targetPath, {
    includeTargets: true,
    projectRoot: preResolved.projectRoot,
  });

  if (resolved.isDirectory || resolved.isOmitted) {
    return generateWorkspaceContext(resolved.resolvedPath, options);
  }

  const fullTargetPath = resolved.resolvedPath;
  if (!fs.existsSync(fullTargetPath)) {
    throw new Error(`Target file not found: ${targetPath}${didYouMeanFile(fullTargetPath)}`);
  }

  const projectRoot = resolved.projectRoot;
  const config = resolved.config;
  if (!isProjectAiceEnabled(config)) {
    throw new Error(AICE_DISABLED_MESSAGE);
  }

  const isPureLineRangeSymbol =
    Boolean(options.symbol) && /^(?:\[?L\d+(?:-L?\d+)?\]?\s*,?\s*)+$/i.test(options.symbol!.trim());
  const isPureRegexSymbol =
    Boolean(options.symbol) &&
    splitSymbolSelectors(options.symbol!).length > 0 &&
    splitSymbolSelectors(options.symbol!).every((s) => /^\/.+\/[gimsuy]*$/.test(s.trim()));

  const idiomsActive = isProjectIdiomsEnabled(config, options.idioms);
  const regexMentionsIdiom = isPureRegexSymbol && /\$[A-Za-z_]/.test(options.symbol!);
  const isFastPathSelector =
    isPureLineRangeSymbol || (isPureRegexSymbol && !(idiomsActive && regexMentionsIdiom));

  let activeIdioms =
    idiomsActive && config.idioms && Object.keys(config.idioms).length > 0
      ? config.idioms
      : undefined;
  let zeroIdiomsReason: string | undefined;
  if (
    options.idioms === true &&
    (!activeIdioms || Object.keys(activeIdioms).length === 0) &&
    !isFastPathSelector
  ) {
    const cachedScan = options.workspaceScanCache?.idiomScanByRoot?.get(projectRoot);
    if (cachedScan) {
      if (Object.keys(cachedScan.idioms).length > 0) {
        activeIdioms = cachedScan.idioms;
        config.idioms = cachedScan.idioms;
      } else {
        zeroIdiomsReason = cachedScan.zeroIdiomsReason;
        activeIdioms = undefined;
      }
    } else {
      try {
        const scanRes = withSuppressedTelemetry(() => scanProjectIdioms(projectRoot));
        if (Object.keys(scanRes.idioms).length > 0) {
          activeIdioms = scanRes.idioms;
          config.idioms = scanRes.idioms;
          options.workspaceScanCache?.idiomScanByRoot?.set(projectRoot, {
            idioms: scanRes.idioms,
          });
        } else {
          zeroIdiomsReason = scanRes.zeroIdiomsReason ?? "insufficient_repetition";
          activeIdioms = undefined;
          options.workspaceScanCache?.idiomScanByRoot?.set(projectRoot, {
            idioms: {},
            zeroIdiomsReason,
          });
          console.error(
            "[AICE Idioms] 0 beneficial idioms discovered. FAST-PATH: Bypassing idiom layer. Use canonical AICE syntax (do not invent $idiom macros).",
          );
        }
      } catch {
        // ignore scan errors
      }
    }
  }

  const displayTargetPath = formatDisplayPath(fullTargetPath, projectRoot);
  const rawFileContent = fs.readFileSync(fullTargetPath, "utf-8");

  const isLargeFileSymbolQuery =
    Boolean(options.symbol) && options.symbol!.trim() !== "*" && rawFileContent.length > 50_000;
  const nativeDiagnostics =
    isFastPathSelector || isLargeFileSymbolQuery
      ? undefined
      : collectNativeSyntaxDiagnostics(fullTargetPath, rawFileContent);

  const buildFallbackNativeSlice = (symSelector?: string): string => {
    const rawLines = rawFileContent.split(/\r?\n/);
    const totalLines = rawLines.length;
    if (!symSelector || symSelector.trim() === "" || symSelector.trim() === "*") {
      return formatWithLineNumbers(rawFileContent, 1);
    }
    const sel = symSelector.trim();
    const rangeMatch = sel.match(/^\[?L(\d+)(?:-L?(\d+))?\]?$/i);
    if (rangeMatch) {
      const sLine = Math.max(1, Math.min(totalLines, Number.parseInt(rangeMatch[1], 10)));
      const eLine = Math.max(
        sLine,
        Math.min(totalLines, rangeMatch[2] ? Number.parseInt(rangeMatch[2], 10) : sLine),
      );
      return rawLines
        .slice(sLine - 1, eLine)
        .map((ln, idx) => `${sLine + idx}│ ${ln}`)
        .join("\n");
    }
    try {
      const targetLang = detectTargetFromPath(fullTargetPath);
      const spanInfo = locateNativeDeclarationSpan(rawFileContent, sel, targetLang);
      if (spanInfo) {
        const startOff = spanInfo.fullDeclStart ?? spanInfo.declStart;
        const sLine = spanInfo.startLine ?? rawFileContent.slice(0, startOff).split(/\r?\n/).length;
        const snippet = rawFileContent.slice(startOff, spanInfo.declEnd);
        return formatWithLineNumbers(snippet, sLine);
      }
    } catch {
      // fall through to line search
    }
    const shortName = sel.split(/\.|::/).pop()?.trim() || sel;
    const hitIdx = rawLines.findIndex((l) => l.includes(shortName));
    if (hitIdx >= 0) {
      const sLine = Math.max(1, hitIdx);
      const eLine = Math.min(totalLines, hitIdx + 25);
      return rawLines
        .slice(sLine - 1, eLine)
        .map((ln, idx) => `${sLine + idx}│ ${ln}`)
        .join("\n");
    }
    const cap = Math.min(totalLines, 50);
    return rawLines
      .slice(0, cap)
      .map((ln, idx) => `${1 + idx}│ ${ln}`)
      .join("\n");
  };

  let targetContent = rawFileContent;
  let preParsedMod: Module | undefined;
  let decompileFailed = false;
  if (!fullTargetPath.endsWith(".aice") && !isFastPathSelector && !isLargeFileSymbolQuery) {
    try {
      const targetLang = detectTargetFromPath(fullTargetPath);
      const isRawTemplate = targetLang === "twig";
      if (!isRawTemplate || options.symbol || options.idioms) {
        const decomp = withSuppressedTelemetry(() =>
          decompile(rawFileContent, targetLang, { filePath: fullTargetPath, projectRoot }),
        );
        targetContent = decomp.aice;
        preParsedMod = decomp.ast;
      }
    } catch (err) {
      decompileFailed = true;
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(
        `[AICE AST Fallback] Decompiler failed for ${displayTargetPath}: ${errMsg}. Falling back to line-numbered native slice.`,
      );
      targetContent = buildFallbackNativeSlice(options.symbol);
    }
  }

  if (
    !decompileFailed &&
    regexMentionsIdiom &&
    idiomsActive &&
    activeIdioms &&
    Object.keys(activeIdioms).length > 0
  ) {
    try {
      targetContent = collapseAiceSourceIdioms(targetContent, activeIdioms, fullTargetPath).aice;
    } catch {
      // ignore pre-regex collapse errors
    }
  }

  if (options.symbol && !decompileFailed) {
    if (options.symbol.trim() === "*") {
      const allSyms = extractFileSymbolList(targetContent, fullTargetPath);
      if (
        (fullTargetPath.endsWith(".html") ||
          fullTargetPath.endsWith(".json") ||
          fullTargetPath.endsWith(".yaml")) &&
        allSyms.length > 0
      ) {
        const slicedAll: string[] = [];
        for (const sym of allSyms) {
          try {
            const s = unwrapSyntheticContainer(
              extractSymbolFromAiceSource(targetContent, sym, fullTargetPath, preParsedMod)
                .replace(/^(?:(?:#|\/\/)[^\n]*|module\s+[^\n]+|\s+)+/g, "")
                .trim(),
              fullTargetPath,
            );
            if (s) slicedAll.push(s);
          } catch {
            // ignore
          }
        }
        if (slicedAll.length > 0) {
          targetContent = [`// symbols: ${allSyms.join(", ")}`, ...slicedAll].join("\n\n");
        }
      } else {
        const unwrapped = unwrapSyntheticContainer(
          targetContent.replace(/^(?:(?:#|\/\/)[^\n]*|module\s+[^\n]+|\s+)+/g, "").trim(),
          fullTargetPath,
        );
        targetContent =
          allSyms.length > 0 ? `// symbols: ${allSyms.join(", ")}\n\n${unwrapped}` : unwrapped;
      }
    } else {
      const requestedSymbols = splitSymbolSelectors(options.symbol);
      const extractOpts = { numberLines: true, clampOutOfBounds: true };
      if (requestedSymbols.length === 0) {
        if (!nativeDiagnostics) {
          throw new Error(`Symbol '${options.symbol}' not found in ${fullTargetPath}`);
        }
      } else if (requestedSymbols.length === 1) {
        try {
          targetContent = extractSymbolFromAiceSource(
            targetContent,
            requestedSymbols[0],
            fullTargetPath,
            preParsedMod,
            extractOpts,
          );
        } catch (err) {
          const sym0 = requestedSymbols[0].trim();
          const shortSym0 = sym0.split(/\.|::/).pop()?.trim() || sym0;
          const isForeignLang = ["go", "rust", "cpp", "twig"].includes(
            detectTargetFromPath(fullTargetPath),
          );
          if (isForeignLang && rawFileContent.includes(shortSym0)) {
            const errMsg = err instanceof Error ? err.message : String(err);
            console.error(
              `[AICE AST Fallback] Symbol slice fallback for ${displayTargetPath} (${sym0}): ${errMsg}. Falling back to line-numbered native slice.`,
            );
            targetContent = buildFallbackNativeSlice(sym0);
            decompileFailed = true;
          } else if (!nativeDiagnostics) {
            throw err;
          }
        }
      } else {
        const slicedBlocks: string[] = [];
        const missingSymbols: string[] = [];
        let firstMissingErr: unknown;
        for (const sym of requestedSymbols) {
          try {
            const rawBlock = extractSymbolFromAiceSource(
              targetContent,
              sym,
              fullTargetPath,
              preParsedMod,
              extractOpts,
            );
            slicedBlocks.push(rawBlock);
          } catch (err) {
            missingSymbols.push(sym.trim());
            if (firstMissingErr === undefined) {
              firstMissingErr = err;
            }
          }
        }
        const joinDeduplicatedBlocks = (blocks: string[]): string => {
          if (blocks.length <= 1) return blocks[0] ?? "";
          const firstHasModule = /^(?:[ \t]*#[^\n]*\n)*[ \t]*module\s+[^\n]+/m.test(blocks[0]!);
          return blocks
            .map((blk, idx) => {
              if (idx === 0 || !firstHasModule) return blk;
              return blk.replace(/^(?:[ \t]*#[^\n]*\n)*[ \t]*module\s+[^\n]+\n+/, "");
            })
            .join("\n\n");
        };
        if (firstMissingErr !== undefined) {
          if (slicedBlocks.length === 0 && requestedSymbols.some((s) => /\s/.test(s))) {
            try {
              targetContent = extractSymbolFromAiceSource(
                targetContent,
                options.symbol.trim(),
                fullTargetPath,
                preParsedMod,
                extractOpts,
              );
              firstMissingErr = undefined;
              missingSymbols.length = 0;
            } catch {
              // keep firstMissingErr
            }
          }
          if (slicedBlocks.length > 0) {
            const joined = joinDeduplicatedBlocks(slicedBlocks);
            targetContent =
              missingSymbols.length > 0
                ? `${joined}\n\n// missing: ${missingSymbols.join(", ")}`
                : joined;
          } else if (firstMissingErr !== undefined && !nativeDiagnostics) {
            throw firstMissingErr;
          }
        } else if (slicedBlocks.length > 0) {
          targetContent = joinDeduplicatedBlocks(slicedBlocks);
        }
      }
    }
  }

  if (
    idiomsActive &&
    activeIdioms &&
    Object.keys(activeIdioms).length > 0 &&
    !regexMentionsIdiom
  ) {
    try {
      const collapsed = collapseAiceSourceIdioms(targetContent, activeIdioms, fullTargetPath);
      targetContent = collapsed.aice;
    } catch {
      // ignore collapse failures
    }
  } else if (
    !idiomsActive &&
    config.idioms &&
    Object.keys(config.idioms).length > 0 &&
    targetContent.includes("$")
  ) {
    try {
      const expanded = expandAiceSourceIdioms(targetContent, config.idioms, fullTargetPath);
      targetContent = expanded.aice;
    } catch {
      // ignore expand failures
    }
  }
  const detectedLangForSlice = !fullTargetPath.endsWith(".aice")
    ? detectTargetFromPath(fullTargetPath)
    : undefined;
  if (
    options.symbol &&
    !idiomsActive &&
    !isFastPathSelector &&
    detectedLangForSlice !== "markdown" &&
    detectedLangForSlice !== "shell" &&
    detectedLangForSlice !== "powershell" &&
    detectedLangForSlice !== "batch" &&
    !targetContent.startsWith("// match at [")
  ) {
    targetContent = compactPureAiceSlice(targetContent);
  }

  if (
    options.symbol &&
    !decompileFailed &&
    !isFastPathSelector &&
    !targetContent.startsWith("// match at [") &&
    !targetContent.startsWith("[Clamped ")
  ) {
    const sel = splitSymbolSelectors(options.symbol).filter((s) => {
      const t = s.trim();
      return (
        Boolean(t) &&
        t !== "*" &&
        t.toLowerCase() !== "imports" &&
        t !== "@first" &&
        t !== "@1" &&
        !/^\[?L\d+(?:-L?\d+)?\]?$/i.test(t) &&
        !/^\/.+\/[gimsuy]*$/.test(t)
      );
    });
    if (sel.length > 0) {
      try {
        const sibRes = withSuppressedTelemetry(() =>
          preParsedMod
            ? generateOutline(preParsedMod, fullTargetPath, {
                includeTypes: true,
                idioms: options.idioms,
                projectRoot,
                preReadSource: rawFileContent,
                skipTokenStats: true,
                lineRanges: false,
              })
            : generateOutline(fullTargetPath, {
                includeTypes: true,
                idioms: options.idioms,
                projectRoot,
                preReadSource: rawFileContent,
                skipTokenStats: true,
                lineRanges: false,
              }),
        );
        const sib = buildSiblingOutline(sibRes.symbols, sel);
        if (sib) targetContent = `${targetContent}\n\n${sib}`;
      } catch {
        // sibling outline is best-effort
      }
    }
  }

  const targetExtLower = path.extname(fullTargetPath).toLowerCase();
  const isDataOrDocExt =
    targetExtLower === ".json" ||
    targetExtLower === ".yaml" ||
    targetExtLower === ".yml" ||
    targetExtLower === ".md" ||
    targetExtLower === ".markdown";
  const shouldSkipFullOutline =
    (isFastPathSelector ||
      Boolean(options.symbol) ||
      isDataOrDocExt ||
      rawFileContent.length > 50_000) &&
    !options.outlineTarget &&
    options.maxTokens === undefined;
  let outlineRes: OutlineResult;
  if (shouldSkipFullOutline || decompileFailed) {
    outlineRes = {
      file: fullTargetPath,
      text: "",
      symbols: [] as OutlineSymbol[],
      referencedIdioms: [] as string[],
      json: { file: fullTargetPath, symbols: [] as OutlineSymbol[] },
      stats: {
        originalTokens: 0,
        outlineTokens: 0,
        savingsTokens: 0,
        savingsPct: 0,
        originalChars: 0,
        outlineChars: 0,
        charSavingsPct: 0,
      },
    };
  } else {
    try {
      outlineRes = withSuppressedTelemetry(() =>
        generateOutline(fullTargetPath, {
          includeTypes: true,
          idioms: options.idioms,
          projectRoot,
          preReadSource: rawFileContent,
          lineRanges: options.maxTokens === undefined,
        }),
      );
    } catch {
      outlineRes = {
        file: fullTargetPath,
        text: "",
        symbols: [] as OutlineSymbol[],
        referencedIdioms: [] as string[],
        json: { file: fullTargetPath, symbols: [] as OutlineSymbol[] },
        stats: {
          originalTokens: 0,
          outlineTokens: 0,
          savingsTokens: 0,
          savingsPct: 0,
          originalChars: 0,
          outlineChars: 0,
          charSavingsPct: 0,
        },
      };
    }
  }
  const targetOutline = outlineRes.text;

  // Dependency discovery BFS (default depth = 0 on line-range/regex fast-path)
  const effectiveDepth = options.depth !== undefined ? options.depth : isFastPathSelector ? 0 : 1;
  const maxDepth = Math.max(0, effectiveDepth);
  const dependencies: DependencyContract[] = [];
  const depMap = new Map<string, DependencyContract>();
  const visitedFiles = new Set<string>([fullTargetPath]);

  interface QueueItem {
    filePath: string;
    currentDepth: number;
  }

  const queue: QueueItem[] = [{ filePath: fullTargetPath, currentDepth: 0 }];

  while (queue.length > 0) {
    const item = queue.shift()!;
    if (item.currentDepth >= maxDepth) {
      continue;
    }

    const imports = extractImportsFromFile(item.filePath);
    for (const imp of imports) {
      const specifier = imp.source;
      let importedSymbols = imp.specifiers.map((s) => s.name);

      // When symbol-scoped at depth 0, prune imported symbols/dependencies not referenced by the sliced symbol
      if (
        item.currentDepth === 0 &&
        options.symbol &&
        importedSymbols.length > 0 &&
        !importedSymbols.includes("*")
      ) {
        const usedSpecs = imp.specifiers.filter((s) => {
          const localIdent = s.alias ?? s.name;
          const esc = localIdent.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          return new RegExp(`\\b${esc}\\b`).test(targetContent);
        });
        if (usedSpecs.length === 0) {
          continue;
        }
        importedSymbols = usedSpecs.map((s) => s.name);
      }

      const resolvedPath = resolveImportPath(item.filePath, specifier, config, projectRoot);
      const isExternal = !resolvedPath && isExternalSpecifier(specifier);

      // Skip circular back-reference to the target file itself
      if (resolvedPath) {
        const canonicalResolved = path.resolve(resolvedPath);
        const canonicalTarget = path.resolve(fullTargetPath);
        if (
          canonicalResolved === canonicalTarget ||
          canonicalResolved.replace(/\.aice$/, "") === canonicalTarget.replace(/\.aice$/, "")
        ) {
          continue;
        }
      }

      const key = isExternal
        ? `ext:${specifier}`
        : resolvedPath
          ? `res:${path.resolve(resolvedPath)}`
          : `unres:${specifier}`;

      if (depMap.has(key)) {
        const existing = depMap.get(key)!;
        let added = false;
        for (const sym of importedSymbols) {
          if (!existing.importedSymbols.includes(sym)) {
            existing.importedSymbols.push(sym);
            added = true;
          }
        }
        if (added) {
          if (isExternal) {
            existing.contract = generateExternalContract(specifier, existing.importedSymbols);
          } else if (resolvedPath) {
            existing.contract = extractExportedContract(resolvedPath, existing.importedSymbols);
          }
        }
      } else {
        let contract: string;
        let displayDepPath: string | undefined;

        if (isExternal) {
          contract = generateExternalContract(specifier, importedSymbols);
        } else if (resolvedPath) {
          displayDepPath = formatDisplayPath(resolvedPath, projectRoot);
          contract = extractExportedContract(resolvedPath, importedSymbols);
        } else {
          contract = `// unresolved: ${specifier}`;
        }

        const depContract: DependencyContract = {
          specifier,
          resolvedPath: displayDepPath,
          importedSymbols,
          isExternal,
          contract,
        };

        dependencies.push(depContract);
        depMap.set(key, depContract);

        if (resolvedPath && !visitedFiles.has(resolvedPath)) {
          visitedFiles.add(resolvedPath);
          if (item.currentDepth + 1 < maxDepth) {
            queue.push({
              filePath: resolvedPath,
              currentDepth: item.currentDepth + 1,
            });
          }
        }
      }
    }
  }

  // Caller lookup (skip by default on line-range/regex fast-path or non-imported data/doc files)
  const effectiveIncludeCallers =
    options.includeCallers !== undefined
      ? options.includeCallers
      : !isFastPathSelector && !isDataOrDocExt;
  const callers: CallerSummary[] = effectiveIncludeCallers
    ? scanWorkspaceCallers(
        fullTargetPath,
        projectRoot,
        config,
        options.symbol,
        options.workspaceScanCache,
      )
    : [];

  const isSmallFile =
    !displayTargetPath.endsWith(".aice") &&
    rawFileContent.length < 600 &&
    estimateTokens(rawFileContent) < 120;

  // Target body selection
  let targetBody = options.outlineTarget ? targetOutline : targetContent;
  if (!options.outlineTarget && !options.symbol && options.maxTokens === undefined) {
    const actionableSyms = outlineRes.symbols.filter((s) => s.kind !== "import" && s.lineRange);
    if (actionableSyms.length > 0 && !/\[L\d+-L\d+\]/.test(targetBody)) {
      const rangeSummary = actionableSyms
        .slice(0, 12)
        .map((s) => `${s.name} ${s.lineRange}`)
        .join(", ");
      const moreSuffix =
        actionableSyms.length > 12 ? `, (+${actionableSyms.length - 12} more)` : "";
      targetBody = `// line-ranges: ${rangeSummary}${moreSuffix}\n${targetBody}`;
    }
  }

  // In symbol-scoped mode, only include idioms referenced in targetBody
  let bundleIdioms = activeIdioms;
  if (options.symbol && activeIdioms && Object.keys(activeIdioms).length > 0) {
    const filteredIdioms: Record<string, ProjectIdiomDefinition> = {};
    for (const [k, def] of Object.entries(activeIdioms)) {
      const normName = (def.name || k).startsWith("$") ? def.name || k : `$${def.name || k}`;
      if (targetBody.includes(normName)) {
        filteredIdioms[k] = def;
      }
    }
    bundleIdioms = Object.keys(filteredIdioms).length > 0 ? filteredIdioms : undefined;
  }

  const isMinimalSmallTarget =
    isSmallFile &&
    (/\.(?:sh|bash|zsh|ps1|cmd|bat|aipl|md|markdown)$/i.test(displayTargetPath) ||
      path.basename(displayTargetPath) === "aice.config.json");
  const useMinimalEnvelope =
    dependencies.length === 0 &&
    callers.length === 0 &&
    (!bundleIdioms || Object.keys(bundleIdioms).length === 0) &&
    (isMinimalSmallTarget || Boolean(options.symbol));
  const bundleFormatOpts = {
    minimalEnvelope: useMinimalEnvelope,
    symbolSelector: options.symbol,
  };

  // Build formatted bundle
  let formattedBundle = formatBundle(
    displayTargetPath,
    targetBody,
    dependencies,
    callers,
    bundleIdioms,
    nativeDiagnostics,
    bundleFormatOpts,
  );
  let tokenCount = estimateTokens(formattedBundle);

  // Bounding / Truncation with maxTokens
  if (options.maxTokens !== undefined && tokenCount > options.maxTokens) {
    if (!options.outlineTarget && targetOutline) {
      targetBody = targetOutline;
      formattedBundle = formatBundle(
        displayTargetPath,
        targetBody,
        dependencies,
        callers,
        bundleIdioms,
        nativeDiagnostics,
        bundleFormatOpts,
      );
      tokenCount = estimateTokens(formattedBundle);
    }

    if (tokenCount > options.maxTokens) {
      const bodyLines = targetBody.split("\n");
      while (bodyLines.length > 1 && tokenCount > options.maxTokens) {
        const cutCount = Math.max(1, Math.floor(bodyLines.length * 0.2));
        bodyLines.splice(bodyLines.length - cutCount, cutCount);
        const truncatedNotice = `// ... [truncated: exceeded maxTokens limit of ${options.maxTokens}]`;
        targetBody = [...bodyLines, truncatedNotice].join("\n");
        formattedBundle = formatBundle(
          displayTargetPath,
          targetBody,
          dependencies,
          callers,
          bundleIdioms,
          nativeDiagnostics,
          bundleFormatOpts,
        );
        tokenCount = estimateTokens(formattedBundle);
      }

      if (tokenCount > options.maxTokens) {
        let chars = formattedBundle.length;
        const truncatedFooter = "\n\n// ... [truncated to fit maxTokens]";
        while (
          chars > 0 &&
          estimateTokens(formattedBundle.slice(0, chars) + truncatedFooter) > options.maxTokens
        ) {
          chars = Math.floor(chars * 0.7);
        }
        if (
          estimateTokens(formattedBundle.slice(0, chars) + truncatedFooter) <= options.maxTokens
        ) {
          formattedBundle = (chars > 0 ? formattedBundle.slice(0, chars) : "") + truncatedFooter;
        } else {
          formattedBundle = truncatedFooter;
          while (
            formattedBundle.length > 0 &&
            estimateTokens(formattedBundle) > options.maxTokens
          ) {
            formattedBundle = formattedBundle.slice(0, -1);
          }
        }
        tokenCount = estimateTokens(formattedBundle);
      }
    }
  }

  const resObj: ContextResult = {
    targetPath: displayTargetPath,
    targetContent,
    targetOutline,
    dependencies,
    callers,
    formattedBundle,
    tokenCount,
    idioms: bundleIdioms,
    nativeDiagnostics,
    ...(zeroIdiomsReason ? { zeroIdiomsReason } : {}),
  };

  recordTelemetryEvent({
    targetPath: fullTargetPath,
    projectRoot,
    operation: "context",
    surface: "cli",
    idiomsUsed: Boolean(bundleIdioms && Object.keys(bundleIdioms).length > 0),
    nativeText: rawFileContent,
    realisticNativeText: rawFileContent,
    aiceText: options.json ? JSON.stringify(resObj, null, 2) : formattedBundle,
  });

  return resObj;
}

export const packContext = generateContext;
export const packageContext = generateContext;
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

  lines.push(`## Target File Content (${activeResults.length} files):`);
  const combinedTargetContents: string[] = [];
  for (let i = 0; i < activeResults.length; i++) {
    const r = activeResults[i]!;
    const body = options.outlineTarget && r.targetOutline ? r.targetOutline : r.targetContent;
    combinedTargetContents.push(`// === ${r.targetPath} ===\n${body}`);
    lines.push(`### Target: \`${r.targetPath}\``);
    lines.push("```aice");
    if (
      mergedIdioms &&
      Object.keys(mergedIdioms).length > 0 &&
      !body.includes("# @idioms available:")
    ) {
      const idiomNames = Object.entries(mergedIdioms)
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

export async function generateMultiContext(
  targets: Array<string | { path: string; symbol?: string }>,
  options: ContextOptions = {},
): Promise<ContextResult & { results: ContextResult[] }> {
  const baseDir = options.projectRoot ? path.resolve(options.projectRoot) : process.cwd();
  const individualResults: ContextResult[] = [];
  const sharedScanCache: WorkspaceCallerScanCache = options.workspaceScanCache ?? {
    filesByRoot: new Map(),
    fileContentByPath: new Map(),
    importsByPath: new Map(),
    idiomScanByRoot: new Map(),
  };
  if (!sharedScanCache.idiomScanByRoot) {
    sharedScanCache.idiomScanByRoot = new Map();
  }

  let firstResolvedPath = "";
  let firstProjectRoot = baseDir;
  let totalNativeChars = 0;
  let totalNativeCl100k = 0;
  let totalNativeO200k = 0;
  const suppressIndividualTelemetry = targets.length > 1;
  const skippedSymbolErrors: unknown[] = [];

  for (let idx = 0; idx < targets.length; idx++) {
    const item = targets[idx]!;
    const rawStr = typeof item === "string" ? item : item.path;
    const explicitSym = typeof item === "string" ? undefined : item.symbol;
    const parsed = parseTargetWithInlineSymbol(rawStr, baseDir);
    const preResolved = resolveEffectiveTargetAndRoot(parsed.targetPath, options.projectRoot);
    const resolved = resolvePathTargets(preResolved.targetPath, {
      includeTargets: true,
      projectRoot: preResolved.projectRoot,
    });
    if (!isProjectAiceEnabled(resolved.config)) {
      throw new Error(AICE_DISABLED_MESSAGE);
    }
    if (!firstResolvedPath) {
      firstResolvedPath = resolved.resolvedPath;
      firstProjectRoot = resolved.projectRoot;
    }
    const usesSharedSymbol = !explicitSym && !parsed.inlineSymbol && Boolean(options.symbol);
    const itemOpts: ContextOptions = {
      ...options,
      symbol: explicitSym ?? parsed.inlineSymbol ?? options.symbol,
      projectRoot: resolved.projectRoot,
      workspaceScanCache: sharedScanCache,
    };
    try {
      const res = suppressIndividualTelemetry
        ? await withSuppressedTelemetryAsync(() => generateContext(resolved.resolvedPath, itemOpts))
        : await generateContext(resolved.resolvedPath, itemOpts);
      individualResults.push(res);
    } catch (err) {
      if (
        targets.length > 1 &&
        usesSharedSymbol &&
        err instanceof Error &&
        /Symbol .+ not found in /i.test(err.message)
      ) {
        skippedSymbolErrors.push(err);
        continue;
      }
      throw err;
    }

    if (suppressIndividualTelemetry) {
      try {
        if (fs.existsSync(resolved.resolvedPath) && fs.statSync(resolved.resolvedPath).isFile()) {
          const rawText = fs.readFileSync(resolved.resolvedPath, "utf-8");
          totalNativeChars += rawText.length + (idx > 0 ? 2 : 0);
          totalNativeCl100k += estimateTokens(rawText, "cl100k_base");
          totalNativeO200k += estimateTokens(rawText, "o200k_base");
        }
      } catch {
        // ignore unreadable target
      }
    }
  }

  if (individualResults.length === 0 && skippedSymbolErrors.length > 0) {
    throw skippedSymbolErrors[0];
  }

  // Reconcile shared multi-symbol `-s "symA,symB"` across multiple files:
  // strip per-file `// missing: X` for any X that was resolved in another target in the batch.
  if (options.symbol && individualResults.length > 0 && targets.length > 1) {
    const sharedRequested = splitSymbolSelectors(options.symbol)
      .map((s) => s.trim())
      .filter(Boolean);
    if (sharedRequested.length > 1) {
      const missingCountBySym = new Map<string, number>();
      for (const res of individualResults) {
        const m = res.targetContent.match(/^\/\/ missing:\s*(.+)$/m);
        if (m?.[1]) {
          for (const part of m[1].split(",").map((s) => s.trim())) {
            if (part) {
              missingCountBySym.set(part, (missingCountBySym.get(part) ?? 0) + 1);
            }
          }
        }
      }
      const globallyMissing = new Set<string>();
      for (const [sym, count] of missingCountBySym) {
        if (count >= individualResults.length) {
          globallyMissing.add(sym);
        }
      }
      let emittedGlobalMissing = false;
      for (let i = 0; i < individualResults.length; i++) {
        const res = individualResults[i]!;
        if (!/^\/\/ missing:\s*(.+)$/m.test(res.targetContent)) continue;
        const updateMissingLine = (text: string, isLastResult: boolean): string =>
          text.replace(/\n*\/\/ missing:\s*(.+)$/m, (_full, rawList: string) => {
            if (!isLastResult || emittedGlobalMissing) return "";
            const kept = rawList
              .split(",")
              .map((s) => s.trim())
              .filter((s) => globallyMissing.has(s));
            if (kept.length === 0) return "";
            emittedGlobalMissing = true;
            return `\n\n// missing: ${kept.join(", ")}`;
          });
        const isLast = i === individualResults.length - 1;
        res.targetContent = updateMissingLine(res.targetContent, isLast);
        res.formattedBundle = updateMissingLine(res.formattedBundle, isLast);
      }
    }
  }

  const merged = mergeMultiContextResults(individualResults, options);
  if (suppressIndividualTelemetry && individualResults.length > 1 && firstResolvedPath) {
    const aicePayload = options.json ? JSON.stringify(merged, null, 2) : merged.formattedBundle;
    recordTelemetryEvent({
      targetPath: firstResolvedPath,
      projectRoot: firstProjectRoot,
      filePath: "<multi-context>",
      operation: "context",
      surface: "cli",
      idiomsUsed: Boolean(merged.idioms && Object.keys(merged.idioms).length > 0),
      nativeText: "",
      nativeChars: totalNativeChars,
      nativeCl100k: totalNativeCl100k,
      nativeO200k: totalNativeO200k,
      realisticNativeCl100k: totalNativeCl100k,
      aiceText: aicePayload,
      aiceCl100k: merged.tokenCount,
    });
  }
  return merged;
}
