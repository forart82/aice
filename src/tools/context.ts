/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * AICE 2.0 AI Context Packager Engine (Step 20).
 * Assembles high-density 1-turn context packs containing target source/outline,
 * imported dependency contracts, and downstream callers.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import {
  type AiceProjectConfig,
  findProjectRoot,
  isProjectIdiomsEnabled,
  KNOWN_TARGET_EXTENSIONS,
  loadProjectConfig,
  resolvePathTargets,
  resolveTargetFile,
  type ProjectIdiomDefinition,
} from "../config/index.js";
import type { ClassDecl, Expr, ImportDecl, LayoutNode, Module, ModuleItem } from "../core/ast.js";
import { parse } from "../core/parser.js";
import { AiceGenerator } from "../decompiler/aice-generator.js";
import { decompile } from "../decompiler/index.js";
import { detectTargetFromPath } from "../emitters/index.js";
import {
  collapseAiceSourceIdioms,
  expandAiceSourceIdioms,
  formatIdiomsMarkdownSection,
} from "../idioms/index.js";
import { estimateTokens } from "../tokenomics/index.js";
import { generateOutline, type OutlineSymbol } from "./outline.js";

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

export function resolveImportPath(
  fromFilePath: string,
  specifier: string,
  config: AiceProjectConfig,
  projectRoot: string,
): string | undefined {
  if (isExternalSpecifier(specifier)) {
    return undefined;
  }

  const fromDir = path.dirname(path.resolve(fromFilePath));
  let candidateBase: string;

  if (specifier.startsWith(".")) {
    candidateBase = path.resolve(fromDir, specifier);
  } else if (path.isAbsolute(specifier)) {
    candidateBase = path.resolve(specifier);
  } else {
    // Relative to projectRoot or sourceDir
    const rootCandidate = path.resolve(projectRoot, specifier);
    const srcCandidate = path.resolve(projectRoot, config.sourceDir, specifier);
    if (fs.existsSync(rootCandidate)) {
      candidateBase = rootCandidate;
    } else if (fs.existsSync(srcCandidate)) {
      candidateBase = srcCandidate;
    } else {
      candidateBase = rootCandidate;
    }
  }

  // 1. If candidateBase already exists as a file
  if (fs.existsSync(candidateBase) && fs.statSync(candidateBase).isFile()) {
    if (!candidateBase.endsWith(".aice") && fs.existsSync(`${candidateBase}.aice`)) {
      return `${candidateBase}.aice`;
    }
    return candidateBase;
  }

  // 2. Probes with extensions
  const ext = path.extname(candidateBase).toLowerCase();
  const baseWithoutExt = ext ? candidateBase.slice(0, -ext.length) : candidateBase;

  const probeList: string[] = [];

  if (ext) {
    probeList.push(`${candidateBase}.aice`);
    probeList.push(`${baseWithoutExt}.aice`);
    probeList.push(`${baseWithoutExt}.ts.aice`);
    probeList.push(`${baseWithoutExt}.tsx.aice`);
    probeList.push(`${baseWithoutExt}.ts`);
    probeList.push(`${baseWithoutExt}.tsx`);
    probeList.push(`${baseWithoutExt}.js`);
    probeList.push(`${baseWithoutExt}.py.aice`);
    probeList.push(`${baseWithoutExt}.py`);
    probeList.push(`${baseWithoutExt}.cpp.aice`);
    probeList.push(`${baseWithoutExt}.cpp`);
    probeList.push(`${baseWithoutExt}.cs.aice`);
    probeList.push(`${baseWithoutExt}.cs`);
    probeList.push(`${baseWithoutExt}.kt.aice`);
    probeList.push(`${baseWithoutExt}.kt`);
    probeList.push(`${baseWithoutExt}.php.aice`);
    probeList.push(`${baseWithoutExt}.php`);
  }

  probeList.push(`${candidateBase}.aice`);
  probeList.push(`${candidateBase}.ts.aice`);
  probeList.push(`${candidateBase}.tsx.aice`);
  probeList.push(`${candidateBase}.ts`);
  probeList.push(`${candidateBase}.tsx`);
  probeList.push(`${candidateBase}.py.aice`);
  probeList.push(`${candidateBase}.py`);
  probeList.push(`${candidateBase}.js`);
  probeList.push(`${candidateBase}.rs.aice`);
  probeList.push(`${candidateBase}.rs`);
  probeList.push(`${candidateBase}.go.aice`);
  probeList.push(`${candidateBase}.go`);
  probeList.push(`${candidateBase}.cpp.aice`);
  probeList.push(`${candidateBase}.cpp`);
  probeList.push(`${candidateBase}.cs.aice`);
  probeList.push(`${candidateBase}.cs`);
  probeList.push(`${candidateBase}.kt.aice`);
  probeList.push(`${candidateBase}.kt`);
  probeList.push(`${candidateBase}.php.aice`);
  probeList.push(`${candidateBase}.php`);
  probeList.push(`${candidateBase}.twig`);
  probeList.push(`${candidateBase}.html`);
  probeList.push(`${candidateBase}.css`);
  probeList.push(`${candidateBase}.json`);
  probeList.push(`${candidateBase}.yaml`);
  probeList.push(`${candidateBase}.yml`);

  // Directory index probes
  probeList.push(path.join(candidateBase, "index.aice"));
  probeList.push(path.join(candidateBase, "index.ts.aice"));
  probeList.push(path.join(candidateBase, "index.tsx.aice"));
  probeList.push(path.join(candidateBase, "index.ts"));
  probeList.push(path.join(candidateBase, "index.tsx"));
  probeList.push(path.join(candidateBase, "index.js"));

  // In isolated or companion mode: check mapped sourceDir if candidate is in outDir
  if (config.mode === "isolated" || config.mode === "companion") {
    const absOutDir = path.resolve(projectRoot, config.outDir);
    const absCandidate = path.resolve(candidateBase);
    let relFromOut: string | null = null;
    if (
      absCandidate === absOutDir ||
      absCandidate.startsWith(absOutDir + path.sep) ||
      absCandidate.startsWith(absOutDir + "/")
    ) {
      relFromOut = path.relative(absOutDir, absCandidate);
    } else {
      const relFromRoot = path.relative(projectRoot, candidateBase);
      if (relFromRoot.startsWith(config.outDir)) {
        relFromOut = relFromRoot.slice(config.outDir.length).replace(/^[/\\]/, "");
      }
    }
    if (relFromOut !== null) {
      const remapped = path.resolve(projectRoot, config.sourceDir, relFromOut);
      probeList.push(`${remapped}.aice`);
      probeList.push(`${remapped}.ts.aice`);
      probeList.push(`${remapped}.tsx.aice`);
      probeList.push(`${remapped}.ts`);
      probeList.push(`${remapped}.tsx`);
    }
  }

  for (const p of probeList) {
    if (fs.existsSync(p) && fs.statSync(p).isFile()) {
      return p;
    }
  }

  return undefined;
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
        const header = sym.signature.endsWith(": ...")
          ? sym.signature.slice(0, -4)
          : sym.signature;
        outlineLines.push(header.endsWith(":") ? header : `${header}:`);
        for (const child of sym.children) {
          if (child.docstring) {
            for (const dLine of child.docstring.split("\n")) {
              outlineLines.push(`  ${dLine}`);
            }
          }
          outlineLines.push(`  ${child.signature}`);
        }
      } else {
        outlineLines.push(sym.signature);
      }
    } else if (sym.kind === "enum") {
      if (sym.children && sym.children.length > 0) {
        outlineLines.push(`enum ${sym.name}:`);
        for (const child of sym.children) {
          outlineLines.push(`  ${child.signature}`);
        }
      } else {
        outlineLines.push(sym.signature);
      }
    } else {
      outlineLines.push(sym.signature);
    }
  }
  return outlineLines.join("\n").trim();
}

function extractExportedContract(
  resolvedPath: string,
  importedSymbols: string[],
): string {
  const outlineRes = generateOutline(resolvedPath, { includeTypes: true });
  const nonImports = outlineRes.symbols.filter((s) => s.kind !== "import");

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
        .map(
          (s) =>
            `${s.signature} ${(s.children ?? []).map((c) => c.signature).join(" ")}`,
        )
        .join(" ");
      filtered = nonImports.filter((s) => {
        if (importedSymbols.includes(s.name)) return true;
        if (
          (s.kind === "interface" ||
            s.kind === "record" ||
            s.kind === "type" ||
            s.kind === "enum") &&
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
          s.kind === "enum",
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
        s.kind === "enum"
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

function extractImportsFromFile(filePath: string, preReadContent?: string): ImportDecl[] {
  try {
    const content = preReadContent ?? fs.readFileSync(filePath, "utf-8");
    if (filePath.endsWith(".aice")) {
      const mod = parse(content, filePath);
      return mod.items.filter((item): item is ImportDecl => item.kind === "ImportDecl");
    }

    const companionAice = `${filePath}.aice`;
    if (fs.existsSync(companionAice)) {
      const aiceContent = fs.readFileSync(companionAice, "utf-8");
      const mod = parse(aiceContent, companionAice);
      return mod.items.filter((item): item is ImportDecl => item.kind === "ImportDecl");
    }

    const targetLang = detectTargetFromPath(filePath);
    const decomp = decompile(content, targetLang, { filePath });
    const mod = parse(decomp.aice, filePath);
    return mod.items.filter((item): item is ImportDecl => item.kind === "ImportDecl");
  } catch {
    return [];
  }
}

function scanWorkspaceCallers(
  targetFullPath: string,
  projectRoot: string,
  config: AiceProjectConfig,
): CallerSummary[] {
  const callers: CallerSummary[] = [];
  const aiceFiles: string[] = [];
  const targetCandidates: string[] = [];

  function walk(currentDir: string): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (
        entry.name === "node_modules" ||
        entry.name === ".git" ||
        entry.name === "dist" ||
        entry.name === "build" ||
        entry.name === ".aice-build" ||
        entry.name === ".next" ||
        entry.name === ".turbo" ||
        entry.name === "coverage" ||
        entry.name.startsWith(".")
      ) {
        continue;
      }
      const entryPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        walk(entryPath);
      } else if (entry.isFile()) {
        if (entry.name.endsWith(".aice.trivia.json")) continue;
        if (entry.name.endsWith(".aice")) {
          aiceFiles.push(entryPath);
        } else {
          const ext = path.extname(entry.name).toLowerCase();
          if (KNOWN_TARGET_EXTENSIONS.has(ext)) {
            targetCandidates.push(entryPath);
          }
        }
      }
    }
  }

  walk(projectRoot);

  const filesToScan: string[] = [];
  const processedBases = new Set<string>();

  for (const aiceFile of aiceFiles) {
    const baseTarget = aiceFile.replace(/\.aice$/, "");
    processedBases.add(baseTarget);
    processedBases.add(path.resolve(resolveTargetFile(config, aiceFile, projectRoot)));
    filesToScan.push(aiceFile);
  }

  for (const targetFile of targetCandidates) {
    if (!processedBases.has(targetFile)) {
      filesToScan.push(targetFile);
    }
  }

  const resolvedTarget = path.resolve(targetFullPath);
  const targetBase = resolvedTarget.replace(/\.aice$/, "");
  const targetFileName = path.basename(targetBase);
  const targetExt = path.extname(targetFileName);
  const targetStem = targetExt ? targetFileName.slice(0, -targetExt.length) : targetFileName;

  for (const file of filesToScan) {
    if (path.resolve(file) === resolvedTarget) {
      continue;
    }

    const fileExt = path.extname(file).toLowerCase();
    if (fileExt === ".json" || fileExt === ".yaml" || fileExt === ".yml" || fileExt === ".css") {
      continue;
    }

    let rawContent: string;
    try {
      rawContent = fs.readFileSync(file, "utf-8");
    } catch {
      continue;
    }

    if (targetStem !== "index" && !rawContent.includes(targetStem)) {
      continue;
    }

    const imports = extractImportsFromFile(file, rawContent);
    for (const imp of imports) {
      const resolved = resolveImportPath(file, imp.source, config, projectRoot);
      if (resolved) {
        const resolvedBase = path.resolve(resolved).replace(/\.aice$/, "");
        if (path.resolve(resolved) === resolvedTarget || resolvedBase === targetBase) {
          const symbols = imp.specifiers.map((s) => s.name);
          callers.push({
            filePath: formatDisplayPath(file, projectRoot),
            importedSymbols: symbols,
            line: imp.span?.start?.line ?? 1,
          });
        }
      }
    }
  }

  callers.sort((a, b) => {
    if (a.filePath !== b.filePath) return a.filePath.localeCompare(b.filePath);
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
): string {
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
  lines.push(targetBody);
  lines.push("```");
  lines.push("");

  lines.push(`## Downstream Callers (${callers.length}):`);
  if (callers.length === 0) {
    lines.push("None");
  } else {
    for (const caller of callers) {
      const symStr =
        caller.importedSymbols.length > 0 ? caller.importedSymbols.join(", ") : "*";
      lines.push(`- \`${caller.filePath}\` imports: \`${symStr}\``);
    }
  }

  if (idioms && Object.keys(idioms).length > 0) {
    lines.push("");
    lines.push(formatIdiomsMarkdownSection(idioms));
  }

  return lines.join("\n");
}

function extractFileSymbolList(aiceSource: string, filePath: string): string[] {
  try {
    const mod = parse(aiceSource, filePath);
    const out: string[] = [];
    for (const item of mod.items) {
      if (item.kind === "FunctionDecl" || item.kind === "TypeDecl" || item.kind === "VarDecl" || item.kind === "StyleDecl") {
        out.push(item.name);
      } else if (item.kind === "ClassDecl") {
        if (item.name === "Main" && filePath.endsWith(".cs")) {
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
    return out;
  } catch {
    return [];
  }
}

/**
 * Packages a workspace overview context pack covering project configuration,
 * discovered files, module outlines, and dependencies.
 */
export async function generateWorkspaceContext(
  targetPath?: string,
  options: ContextOptions = {},
): Promise<ContextResult> {
  const resolved = resolvePathTargets(targetPath, {
    includeTargets: true,
    projectRoot: options.projectRoot,
  });

  const projectRoot = resolved.projectRoot;
  const config = resolved.config;
  const displayTargetPath = formatDisplayPath(resolved.resolvedPath, projectRoot);

  const outlines: string[] = [];
  const symbolSlices: string[] = [];
  const dependencies: DependencyContract[] = [];
  const depMap = new Map<string, DependencyContract>();
  const idiomsActive = isProjectIdiomsEnabled(config, options.idioms);
  const activeIdioms = idiomsActive ? config.idioms : undefined;

  const requestedSelectors = options.symbol
    ? options.symbol
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : [];

  for (const f of resolved.files) {
    const relFile = formatDisplayPath(f, projectRoot);
    try {
      const rawFileContent = fs.readFileSync(f, "utf-8");
      let fileAice = rawFileContent;
      if (!f.endsWith(".aice")) {
        const targetLang = detectTargetFromPath(f);
        const decomp = decompile(rawFileContent, targetLang, { filePath: f });
        fileAice = decomp.aice;
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

      const oRes = generateOutline(f, {
        includeTypes: true,
        depth: options.depth,
        idioms: options.idioms,
        projectRoot,
      });
      const outlineBody =
        symHeader && (f.endsWith(".html") || f.endsWith(".twig") || f.endsWith(".json") || f.endsWith(".yaml"))
          ? `${symHeader}\n${oRes.text}`
          : oRes.text;
      outlines.push(`### \`${relFile}\`\n\`\`\`aice\n${outlineBody}\n\`\`\``);

      if (requestedSelectors.length > 0) {
        const fileSlices: string[] = [];
        if (requestedSelectors.includes("*")) {
          if (
            (f.endsWith(".html") || f.endsWith(".json") || f.endsWith(".yaml")) &&
            allSyms.length > 0
          ) {
            for (const sym of allSyms) {
              try {
                let sliced = extractSymbolFromAiceSource(fileAice, sym, f)
                  .replace(/^(?:(?:#|\/\/)[^\n]*|module\s+[^\n]+|\s+)+/g, "")
                  .trim();
                if (f.endsWith(".html")) {
                  const sLines = sliced.split("\n");
                  if (sLines[0]?.trim().startsWith("component ")) {
                    sliced = sLines
                      .slice(1)
                      .map((l) => (l.startsWith("  ") ? l.slice(2) : l))
                      .join("\n")
                      .trim();
                  }
                }
                if (sliced) fileSlices.push(sliced);
              } catch {
                // fallback handled below if needed
              }
            }
          }
          if (fileSlices.length === 0) {
            let cleanedAll = fileAice
              .replace(/^(?:(?:#|\/\/)[^\n]*|module\s+[^\n]+|\s+)+/g, "")
              .trim();
            if (f.endsWith(".html") || f.endsWith(".twig") || f.endsWith(".cs")) {
              const sLines = cleanedAll.split("\n");
              if (
                sLines[0]?.trim().startsWith("component ") ||
                sLines[0]?.trim() === "pub class Main:" ||
                sLines[0]?.trim() === "class Main:"
              ) {
                cleanedAll = sLines
                  .slice(1)
                  .map((l) => (l.startsWith("  ") ? l.slice(2) : l))
                  .join("\n")
                  .replace(/^static\s+fn\b/gm, "fn")
                  .trim();
              }
            }
            fileSlices.push(cleanedAll);
          }
        } else {
          for (const rawSel of requestedSelectors) {
            let symSel = rawSel;
            const colonIdx = rawSel.indexOf(":");
            if (colonIdx > 0 && !rawSel.startsWith("block:") && !rawSel.includes("::")) {
              const fileFilter = rawSel.slice(0, colonIdx).trim();
              symSel = rawSel.slice(colonIdx + 1).trim();
              if (path.basename(f) !== fileFilter && relFile !== fileFilter) {
                continue;
              }
            }
            try {
              let sliced = extractSymbolFromAiceSource(fileAice, symSel, f)
                .replace(/^(?:(?:#|\/\/)[^\n]*|module\s+[^\n]+|\s+)+/g, "")
                .trim();
              if (f.endsWith(".html") || f.endsWith(".twig") || f.endsWith(".cs")) {
                const sLines = sliced.split("\n");
                if (
                  sLines[0]?.trim().startsWith("component ") ||
                  sLines[0]?.trim() === "pub class Main:" ||
                  sLines[0]?.trim() === "class Main:"
                ) {
                  sliced = sLines
                    .slice(1)
                    .map((l) => (l.startsWith("  ") ? l.slice(2) : l))
                    .join("\n")
                    .replace(/^static\s+fn\b/, "fn")
                    .trim();
                }
              }
              fileSlices.push(sliced);
            } catch {
              // symbol lives in another file
            }
          }
        }
        const sliceBody = [symHeader, ...fileSlices].filter(Boolean).join("\n\n");
        if (sliceBody) {
          symbolSlices.push(`### \`${relFile}\`\n\`\`\`aice\n${sliceBody}\n\`\`\``);
        }
      }

      const imports = extractImportsFromFile(f);
      for (const imp of imports) {
        const specifier = imp.source;
        const importedSymbols = imp.specifiers.map((s) => s.name);
        const isExternal = isExternalSpecifier(specifier);
        let resolvedImportPath: string | undefined = undefined;

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
          for (const sym of importedSymbols) {
            if (!existing.importedSymbols.includes(sym)) {
              existing.importedSymbols.push(sym);
            }
          }
        } else {
          let contract: string;
          let displayDepPath: string | undefined = undefined;

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
  } else {
    parts.push(
      `# AICE Workspace Overview Context Pack: ${displayTargetPath}`,
      "",
      "## Project Configuration:",
      `- Mode: ${config.mode}`,
      `- Source Directory: ${config.sourceDir}`,
      `- Output Directory: ${config.outDir}`,
      `- Target Language: ${config.targetLanguage}`,
      `- Files Count: ${resolved.files.length}`,
      "",
      `## Workspace Files (${resolved.files.length}):`,
      ...resolved.files.map((f) => `- \`${formatDisplayPath(f, projectRoot)}\``),
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
    let chars = formattedBundle.length;
    const truncatedFooter = "\n\n// ... [truncated to fit maxTokens]";
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
    }
    tokenCount = estimateTokens(formattedBundle);
  }

  const targetContent = resolved.files.map((f) => formatDisplayPath(f, projectRoot)).join("\n");

  return {
    targetPath: displayTargetPath,
    targetContent,
    targetOutline: outlines.join("\n\n"),
    dependencies,
    callers: [],
    formattedBundle,
    tokenCount,
    idioms: activeIdioms,
  };
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

export function extractSymbolFromAiceSource(
  aiceSource: string,
  symbolSelector: string,
  filePath: string,
  preParsedMod?: Module,
): string {
  const trimmedSel = symbolSelector.trim();
  const mod = preParsedMod ?? parse(aiceSource, filePath);

  // Check StyleDecl first because CSS selectors often start with '.' (e.g. '.btn-primary')
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

  const isLeadingDotOrHash = trimmedSel.startsWith(".") || trimmedSel.startsWith("#");
  const parts = isLeadingDotOrHash ? [trimmedSel] : trimmedSel.split(/\.|::/);
  const className = parts.length >= 2 ? parts[0].trim() : undefined;
  const memberName = parts.length >= 2 ? parts.slice(1).join(".").trim() : trimmedSel;
  const normMember = normalizeIdentForMatch(memberName);

  const matchedItems: ModuleItem[] = [];

  for (const item of mod.items) {
    if (className) {
      if (item.kind === "ClassDecl" && (item.name === className || normalizeIdentForMatch(item.name) === normalizeIdentForMatch(className))) {
        let matchedMethods = item.methods.filter((m) => m.name === memberName);
        if (matchedMethods.length === 0) {
          matchedMethods = item.methods.filter((m) => normalizeIdentForMatch(m.name) === normMember);
        }
        let matchedProps = item.properties.filter((p) => p.name === memberName);
        if (matchedProps.length === 0) {
          matchedProps = item.properties.filter((p) => normalizeIdentForMatch(p.name) === normMember);
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
      } else if (item.kind === "TypeDecl" && (item.name === className || normalizeIdentForMatch(item.name) === normalizeIdentForMatch(className))) {
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
          item.name === className || normalizeIdentForMatch(item.name) === normalizeIdentForMatch(className)
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
          item.name === className || normalizeIdentForMatch(item.name) === normalizeIdentForMatch(className)
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
          matchedMethods = item.methods.filter((m) => normalizeIdentForMatch(m.name) === normMember);
        }
        let matchedProps = item.properties.filter((p) => p.name === memberName);
        if (matchedProps.length === 0) {
          matchedProps = item.properties.filter((p) => normalizeIdentForMatch(p.name) === normMember);
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
    throw new Error(`Symbol '${symbolSelector}' not found in ${filePath}`);
  }

  const scopedMod: Module = {
    kind: "Module",
    path: mod.path,
    items: matchedItems,
    span: mod.span,
  };
  return AiceGenerator.generate(scopedMod);
}

/**
 * Packages dependency contracts, target file content, and downstream callers into a 1-turn context pack.
 * If targetPath is omitted or points to a directory, packages a workspace overview context pack.
 */
export async function generateContext(
  targetPath?: string,
  options: ContextOptions = {},
): Promise<ContextResult> {
  if (!targetPath || targetPath.trim() === "") {
    return generateWorkspaceContext(undefined, options);
  }

  const resolved = resolvePathTargets(targetPath, {
    includeTargets: true,
    projectRoot: options.projectRoot,
  });

  if (resolved.isDirectory || resolved.isOmitted) {
    return generateWorkspaceContext(resolved.resolvedPath, options);
  }

  const fullTargetPath = resolved.resolvedPath;
  if (!fs.existsSync(fullTargetPath)) {
    throw new Error(`Target file not found: ${targetPath}`);
  }

  const projectRoot = resolved.projectRoot;
  const config = resolved.config;
  const idiomsActive = isProjectIdiomsEnabled(config, options.idioms);
  const activeIdioms = idiomsActive ? config.idioms : undefined;

  const displayTargetPath = formatDisplayPath(fullTargetPath, projectRoot);
  const rawFileContent = fs.readFileSync(fullTargetPath, "utf-8");

  let targetContent = rawFileContent;
  if (!fullTargetPath.endsWith(".aice")) {
    try {
      const targetLang = detectTargetFromPath(fullTargetPath);
      const isRawTemplate = targetLang === "twig";
      if (!isRawTemplate || options.symbol || options.idioms) {
        const decomp = decompile(rawFileContent, targetLang, { filePath: fullTargetPath });
        targetContent = decomp.aice;
      }
    } catch {
      targetContent = rawFileContent;
    }
  }

  if (options.symbol && options.symbol.trim() !== "*") {
    const requestedSymbols = options.symbol
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (requestedSymbols.length === 1) {
      targetContent = extractSymbolFromAiceSource(targetContent, requestedSymbols[0], fullTargetPath);
    } else if (requestedSymbols.length > 1) {
      const slicedBlocks: string[] = [];
      for (const sym of requestedSymbols) {
        try {
          slicedBlocks.push(extractSymbolFromAiceSource(targetContent, sym, fullTargetPath));
        } catch {
          // skip symbols not present in this file when multiple symbols are listed
        }
      }
      if (slicedBlocks.length > 0) {
        targetContent = slicedBlocks.join("\n\n");
      }
    }
  }

  if (idiomsActive && activeIdioms && Object.keys(activeIdioms).length > 0) {
    try {
      const collapsed = collapseAiceSourceIdioms(targetContent, activeIdioms, fullTargetPath);
      targetContent = collapsed.aice;
    } catch {
      // ignore collapse failures
    }
  } else if (!idiomsActive && config.idioms && Object.keys(config.idioms).length > 0 && targetContent.includes("$")) {
    try {
      const expanded = expandAiceSourceIdioms(targetContent, config.idioms, fullTargetPath);
      targetContent = expanded.aice;
    } catch {
      // ignore expand failures
    }
  }

  // Generate target outline
  const outlineRes = generateOutline(fullTargetPath, {
    includeTypes: true,
    idioms: options.idioms,
    projectRoot,
  });
  const targetOutline = outlineRes.text;

  // Dependency discovery BFS
  const maxDepth = options.depth !== undefined ? Math.max(1, options.depth) : 1;
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
      if (item.currentDepth === 0 && options.symbol && importedSymbols.length > 0 && !importedSymbols.includes("*")) {
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

      const isExternal = isExternalSpecifier(specifier);
      let resolvedPath: string | undefined = undefined;

      if (!isExternal) {
        resolvedPath = resolveImportPath(item.filePath, specifier, config, projectRoot);
      }

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
        for (const sym of importedSymbols) {
          if (!existing.importedSymbols.includes(sym)) {
            existing.importedSymbols.push(sym);
          }
        }
      } else {
        let contract: string;
        let displayDepPath: string | undefined = undefined;

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

  // Caller lookup
  const callers: CallerSummary[] =
    options.includeCallers !== false
      ? scanWorkspaceCallers(fullTargetPath, projectRoot, config)
      : [];

  // Target body selection
  let targetBody = options.outlineTarget ? targetOutline : targetContent;

  // In symbol-scoped mode, only include idioms referenced in targetBody
  let bundleIdioms = activeIdioms;
  if (options.symbol && activeIdioms && Object.keys(activeIdioms).length > 0) {
    const filteredIdioms: Record<string, ProjectIdiomDefinition> = {};
    for (const [k, def] of Object.entries(activeIdioms)) {
      const normName = (def.name || k).startsWith("$") ? (def.name || k) : `$${def.name || k}`;
      if (targetBody.includes(normName)) {
        filteredIdioms[k] = def;
      }
    }
    bundleIdioms = Object.keys(filteredIdioms).length > 0 ? filteredIdioms : undefined;
  }

  // Build formatted bundle
  let formattedBundle = formatBundle(
    displayTargetPath,
    targetBody,
    dependencies,
    callers,
    bundleIdioms,
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
          activeIdioms,
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
    }
  }

  return {
    targetPath: displayTargetPath,
    targetContent,
    targetOutline,
    dependencies,
    callers,
    formattedBundle,
    tokenCount,
    idioms: activeIdioms,
  };
}

export const packContext = generateContext;
export const packageContext = generateContext;
