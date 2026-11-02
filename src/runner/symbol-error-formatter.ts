/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * AIL 2.0 Symbol-Aware AST Error Formatter (Step 12).
 * Formats high-density, concise developer and AI test failure diagnostics
 * by mapping runtime stack frames directly to .ail source AST declarations.
 *
 * Enforces zero *.map files on disk and completely scrubs target runtime
 * paths (.ts, .js, dist/, node:internal).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import {
  type AilProjectConfig,
  findProjectRoot,
  loadProjectConfig,
  resolveSourceFile,
  resolveTargetFile,
} from "../config/index.js";
import type {
  ClassDecl,
  ComponentDecl,
  FunctionDecl,
  MethodDecl,
  Module,
  PropertyDecl,
} from "../core/ast.js";
import { parse } from "../core/parser.js";
import { emitTarget } from "../emitters/index.js";

export interface ParsedStackFrame {
  functionName?: string;
  filePath: string;
  line?: number;
  column?: number;
}

export interface AstSymbolMatch {
  name: string;
  kind: "function" | "method" | "component" | "class" | "property";
  line: number;
  column: number;
}

export interface FailureBlockInfo {
  testFile: string;
  testDescription: string;
  errorMessage: string;
  scopeSymbol?: string;
  scopeFile?: string;
  scopeLine?: number;
  diff?: string;
}

/**
 * Strips ANSI terminal escape codes.
 */
export function stripAnsi(text: string): string {
  return text
    .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "")
    .replace(/\x1b\].*?\x07/g, "");
}

/**
 * Scans a directory recursively collecting all .ail files.
 */
function scanAilFiles(rootDir: string): string[] {
  if (!fs.existsSync(rootDir)) return [];
  try {
    const stat = fs.statSync(rootDir);
    if (!stat.isDirectory()) {
      return rootDir.endsWith(".ail") ? [path.resolve(rootDir)] : [];
    }
  } catch {
    return [];
  }

  const results: string[] = [];
  function walk(dir: string) {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (
        entry.name === "node_modules" ||
        entry.name === ".git" ||
        entry.name === "dist" ||
        entry.name === "build" ||
        entry.name === ".ail-build"
      ) {
        continue;
      }
      const fullPath = path.resolve(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile() && entry.name.endsWith(".ail")) {
        results.push(fullPath);
      }
    }
  }
  walk(rootDir);
  return results;
}

/**
 * Normalizes a file path and resolves it to its corresponding .ail source file.
 * In companion mode, resolves external target paths back to companion workspace .ail files.
 */
export function resolveToAilFile(
  filePath: string,
  projectRoot: string = process.cwd(),
  config?: AilProjectConfig,
): { relAilPath: string; fullAilPath?: string; exists: boolean } {
  let clean = filePath.replace(/:\d+(?::\d+)?$/, "").trim();
  if (clean.startsWith("file://")) {
    clean = clean.slice(7);
  }

  clean = clean.replace(/\\/g, "/");

  const root = findProjectRoot(projectRoot) ?? projectRoot;
  const cfg = config ?? loadProjectConfig(root);

  if (cfg.mode === "companion") {
    // 1. If clean is an absolute or relative path that already ends in .ail
    if (clean.endsWith(".ail")) {
      const absCand = path.isAbsolute(clean) ? clean : path.resolve(root, clean);
      if (fs.existsSync(absCand)) {
        return {
          relAilPath: path.relative(root, absCand).replace(/\\/g, "/"),
          fullAilPath: absCand,
          exists: true,
        };
      }
      const srcCand = path.resolve(root, cfg.sourceDir, clean);
      if (fs.existsSync(srcCand)) {
        return {
          relAilPath: path.relative(root, srcCand).replace(/\\/g, "/"),
          fullAilPath: srcCand,
          exists: true,
        };
      }
    }

    // 2. Candidate paths in target project or outDir
    const absOutDir = cfg.outDir
      ? path.isAbsolute(cfg.outDir)
        ? path.resolve(cfg.outDir)
        : path.resolve(root, cfg.outDir)
      : undefined;

    const absTargetProjDir = cfg.targetProjectDir
      ? path.isAbsolute(cfg.targetProjectDir)
        ? path.resolve(cfg.targetProjectDir)
        : path.resolve(root, cfg.targetProjectDir)
      : undefined;

    const absTestCwd = cfg.test?.cwd
      ? path.isAbsolute(cfg.test.cwd)
        ? path.resolve(cfg.test.cwd)
        : path.resolve(root, cfg.test.cwd)
      : undefined;

    const targetCandidates: string[] = [];
    if (path.isAbsolute(clean)) {
      targetCandidates.push(clean);
    } else {
      // Relative from companion projectRoot (e.g. ../MYProject/src/core/engine.ts)
      targetCandidates.push(path.resolve(root, clean));
      // Relative to outDir (e.g. core/engine.ts when outDir is ../MYProject/src)
      if (absOutDir) targetCandidates.push(path.resolve(absOutDir, clean));
      // Relative to targetProjectDir (e.g. src/core/engine.ts)
      if (absTargetProjDir) targetCandidates.push(path.resolve(absTargetProjDir, clean));
      // Relative to test.cwd
      if (absTestCwd) targetCandidates.push(path.resolve(absTestCwd, clean));
    }

    // Check existing candidates via resolveSourceFile
    for (const tgt of targetCandidates) {
      if (fs.existsSync(tgt)) {
        const src = resolveSourceFile(cfg, tgt, root);
        if (fs.existsSync(src)) {
          return {
            relAilPath: path.relative(root, src).replace(/\\/g, "/"),
            fullAilPath: src,
            exists: true,
          };
        }
      }
    }

    // Even if target file does not exist on disk, check if resolveSourceFile locates existing .ail
    for (const tgt of targetCandidates) {
      const src = resolveSourceFile(cfg, tgt, root);
      if (fs.existsSync(src)) {
        return {
          relAilPath: path.relative(root, src).replace(/\\/g, "/"),
          fullAilPath: src,
          exists: true,
        };
      }
    }

    // 3. Basename or subpath lookup in companion sourceDir
    const companionSourceDir = path.resolve(root, cfg.sourceDir);
    const ailFiles = scanAilFiles(companionSourceDir);
    const cleanBase = path.basename(clean);
    const nameWithoutExt = cleanBase.replace(/\.[a-zA-Z0-9]+$/, "");

    // Prefer candidates that match a multi-segment path suffix of clean
    const cleanNormalized = clean.replace(/\.[a-zA-Z0-9]+$/, "");
    const cleanSegments = cleanNormalized.split("/").filter(Boolean);
    if (cleanSegments.length > 1) {
      for (let s = Math.min(cleanSegments.length, 4); s >= 2; s--) {
        const subSuffix = cleanSegments.slice(-s).join("/") + ".ail";
        const matched = ailFiles.find((f) => {
          const normF = f.replace(/\\/g, "/");
          return normF.endsWith("/" + subSuffix) || normF.endsWith(subSuffix);
        });
        if (matched) {
          return {
            relAilPath: path.relative(root, matched).replace(/\\/g, "/"),
            fullAilPath: matched,
            exists: true,
          };
        }
      }
    }

    for (const f of ailFiles) {
      const fBase = path.basename(f);
      if (
        fBase === `${nameWithoutExt}.ail` ||
        fBase === `${nameWithoutExt}.ts.ail` ||
        fBase === cleanBase
      ) {
        return {
          relAilPath: path.relative(root, f).replace(/\\/g, "/"),
          fullAilPath: f,
          exists: true,
        };
      }
    }

    // 4. Normalized relative fallback check
    const normalizedClean = clean.replace(/^(?:dist|build)\//, "");
    const directRel = normalizedClean.replace(/\.[a-zA-Z0-9]+$/, ".ail");
    const fallbackCand = path.resolve(root, directRel);
    if (fs.existsSync(fallbackCand)) {
      return {
        relAilPath: path.relative(root, fallbackCand).replace(/\\/g, "/"),
        fullAilPath: fallbackCand,
        exists: true,
      };
    }
    const fallbackSrcCand = path.resolve(companionSourceDir, path.basename(directRel));
    if (fs.existsSync(fallbackSrcCand)) {
      return {
        relAilPath: path.relative(root, fallbackSrcCand).replace(/\\/g, "/"),
        fullAilPath: fallbackSrcCand,
        exists: true,
      };
    }

    // Fallback when file does not exist on disk
    const derived = resolveSourceFile(cfg, clean, root);
    const relOut = path.isAbsolute(derived) ? path.relative(root, derived) : derived;
    return {
      relAilPath: relOut.replace(/\\/g, "/"),
      exists: false,
    };
  }

  // Side-by-side or isolated mode resolution
  let rel = path.isAbsolute(clean)
    ? path.relative(root, clean)
    : clean;
  rel = rel.replace(/\\/g, "/");

  if (rel.startsWith("./")) {
    rel = rel.slice(2);
  }

  // Strip dist/ or build/ output prefixes
  rel = rel.replace(/^(?:dist|build)\//, "");

  const bases: string[] = [rel];
  if (!rel.startsWith("src/")) {
    bases.push(`src/${rel}`);
  }

  const candidates: string[] = [];

  for (const base of bases) {
    if (base.endsWith(".ail")) {
      candidates.push(base);
    } else {
      // 1. Check side-by-side .ail (e.g. engine.ts -> engine.ts.ail)
      candidates.push(`${base}.ail`);

      // 2. If .js/.mjs, check corresponding .ts.ail
      if (/\.m?js$/.test(base)) {
        candidates.push(base.replace(/\.m?js$/, ".ts.ail"));
        candidates.push(base.replace(/\.m?js$/, ".ail"));
      }

      // 3. Extension replacement (e.g. engine.ts -> engine.ail)
      if (/\.(ts|tsx|jsx|js|mjs|cjs)$/.test(base)) {
        candidates.push(base.replace(/\.(ts|tsx|jsx|js|mjs|cjs)$/, ".ail"));
      }
    }
  }

  for (const cand of candidates) {
    const full = path.resolve(root, cand);
    if (fs.existsSync(full)) {
      return {
        relAilPath: cand,
        fullAilPath: full,
        exists: true,
      };
    }
  }

  // Fallback when file does not exist on disk
  let fallback = candidates[0] || `${rel}.ail`;
  if (!fallback.endsWith(".ail")) {
    fallback = `${fallback}.ail`;
  }

  return {
    relAilPath: fallback,
    exists: false,
  };
}

/**
 * Searches the parsed AST for a matching FunctionDecl, MethodDecl, ComponentDecl, or ClassDecl.
 */
export function findSymbolInAst(
  mod: Module,
  targetSymbol: string,
): AstSymbolMatch | undefined {
  // Normalize prototype accesses: GameEngine.prototype.process -> GameEngine.process
  const normalized = targetSymbol.replace(/\.prototype\./, ".");
  const parts = normalized.split(".");
  const isQualified = parts.length > 1;
  const className = isQualified ? parts[0] : undefined;
  const memberName = isQualified ? parts.slice(1).join(".") : normalized;

  // 1. If qualified (e.g. GameEngine.processFoodConsumption)
  if (isQualified && className) {
    for (const item of mod.items) {
      if (item.kind === "ClassDecl" && item.name === className) {
        for (const method of item.methods) {
          if (method.name === memberName) {
            return {
              name: targetSymbol,
              kind: "method",
              line: method.span.start.line,
              column: method.span.start.column,
            };
          }
        }
        for (const prop of item.properties) {
          if (prop.name === memberName) {
            return {
              name: targetSymbol,
              kind: "property",
              line: prop.span.start.line,
              column: prop.span.start.column,
            };
          }
        }
        if (memberName === "new" || memberName === "constructor") {
          return {
            name: targetSymbol,
            kind: "class",
            line: item.span.start.line,
            column: item.span.start.column,
          };
        }
      }
    }
  }

  // 2. Top-level FunctionDecl
  for (const item of mod.items) {
    if (item.kind === "FunctionDecl" && item.name === memberName) {
      return {
        name: memberName,
        kind: "function",
        line: item.span.start.line,
        column: item.span.start.column,
      };
    }
  }

  // 3. Top-level ComponentDecl
  for (const item of mod.items) {
    if (item.kind === "ComponentDecl" && item.name === memberName) {
      return {
        name: memberName,
        kind: "component",
        line: item.span.start.line,
        column: item.span.start.column,
      };
    }
  }

  // 4. Any ClassDecl method or property matching memberName
  for (const item of mod.items) {
    if (item.kind === "ClassDecl") {
      for (const method of item.methods) {
        if (method.name === memberName) {
          return {
            name: targetSymbol,
            kind: "method",
            line: method.span.start.line,
            column: method.span.start.column,
          };
        }
      }
      for (const prop of item.properties) {
        if (prop.name === memberName) {
          return {
            name: targetSymbol,
            kind: "property",
            line: prop.span.start.line,
            column: prop.span.start.column,
          };
        }
      }
      if (item.name === memberName) {
        return {
          name: item.name,
          kind: "class",
          line: item.span.start.line,
          column: item.span.start.column,
        };
      }
    }
  }

  return undefined;
}

/**
 * Searches the parsed AST for a declaration enclosing or matching an .ail line number.
 */
export function findSymbolAtLineInAst(
  mod: Module,
  line: number,
): AstSymbolMatch | undefined {
  for (const item of mod.items) {
    if (item.span.start.line <= line && line <= item.span.end.line) {
      if (item.kind === "ClassDecl") {
        for (const method of item.methods) {
          if (method.span.start.line <= line && line <= method.span.end.line) {
            return {
              name: `${item.name}.${method.name}`,
              kind: "method",
              line: method.span.start.line,
              column: method.span.start.column,
            };
          }
        }
        for (const prop of item.properties) {
          if (prop.span.start.line <= line && line <= prop.span.end.line) {
            return {
              name: `${item.name}.${prop.name}`,
              kind: "property",
              line: prop.span.start.line,
              column: prop.span.start.column,
            };
          }
        }
        return {
          name: item.name,
          kind: "class",
          line: item.span.start.line,
          column: item.span.start.column,
        };
      }
      if (item.kind === "FunctionDecl") {
        return {
          name: item.name,
          kind: "function",
          line: item.span.start.line,
          column: item.span.start.column,
        };
      }
      if (item.kind === "ComponentDecl") {
        return {
          name: item.name,
          kind: "component",
          line: item.span.start.line,
          column: item.span.start.column,
        };
      }
    }
  }
  return undefined;
}

/**
 * Inspects generated target source code lines to extract the enclosing symbol name
 * at targetLine (functions, methods, classes).
 */
export function extractEnclosingSymbolFromSource(
  targetSource: string,
  targetLine: number,
): string | undefined {
  const lines = targetSource.split("\n");
  const maxLine = Math.min(targetLine, lines.length);

  // Scan backwards from targetLine
  for (let i = maxLine - 1; i >= 0; i--) {
    const l = lines[i];

    // function foo(...) or async function foo(...)
    const fnMatch = l.match(/(?:async\s+)?function\s+([a-zA-Z0-9_$]+)\s*\(/);
    if (fnMatch) return fnMatch[1];

    // const foo = (...) => or let foo = async (...) =>
    const arrowMatch = l.match(/(?:const|let|var)\s+([a-zA-Z0-9_$]+)\s*=\s*(?:async\s*)?\(/);
    if (arrowMatch) return arrowMatch[1];

    // method in class: foo(...) { or async foo(...) {
    const methodMatch = l.match(
      /^\s*(?:(?:public|private|protected|static|readonly|async)\s+)*([a-zA-Z0-9_$]+)\s*\([^)]*\)\s*(?::\s*[^;{]+)?\{/,
    );
    if (methodMatch) {
      const name = methodMatch[1];
      if (
        name !== "if" &&
        name !== "for" &&
        name !== "while" &&
        name !== "switch" &&
        name !== "catch" &&
        name !== "constructor"
      ) {
        return name;
      }
    }

    // Python: def foo(...) or async def foo(...)
    const pyMatch = l.match(/(?:async\s+)?def\s+([a-zA-Z0-9_$]+)\s*\(/);
    if (pyMatch) return pyMatch[1];

    // Rust: fn foo(...) or pub fn foo(...) or async fn foo(...)
    const rustMatch = l.match(/(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+([a-zA-Z0-9_$]+)\s*[<(]/);
    if (rustMatch) return rustMatch[1];

    // Go: func foo(...) or func (r Recv) foo(...)
    const goMatch = l.match(/func\s+(?:\([^)]+\)\s+)?([a-zA-Z0-9_$]+)\s*\(/);
    if (goMatch) return goMatch[1];

    // class Foo {
    const classMatch = l.match(/class\s+([a-zA-Z0-9_$]+)/);
    if (classMatch) return classMatch[1];
  }

  return undefined;
}

/**
 * Cleans function names extracted from stack frames.
 */
function cleanFunctionName(rawFn?: string): string | undefined {
  if (!rawFn) return undefined;
  let fn = rawFn.trim();
  fn = fn.replace(/^(?:async|new)\s+/, "");

  if (
    fn === "<anonymous>" ||
    fn.endsWith(".<anonymous>") ||
    fn === "anonymous" ||
    fn.startsWith("TestContext.")
  ) {
    return undefined;
  }

  if (fn.startsWith("Object.")) {
    fn = fn.slice(7);
  }

  return fn.length > 0 ? fn : undefined;
}

/**
 * Checks whether a frame points to runner internals or runtime noise.
 */
function isInternalRunnerFrame(filePath: string): boolean {
  return (
    filePath.includes("node_modules/") ||
    filePath.startsWith("node:") ||
    filePath.includes("node:") ||
    filePath.includes("internal/modules/") ||
    filePath.includes("tinypool/") ||
    filePath.includes("vitest/dist") ||
    filePath.includes("@vitest/runner") ||
    filePath.includes("bun:test")
  );
}

/**
 * Parses stack frame entries from error text.
 */
export function parseStackFrames(rawText: string): ParsedStackFrame[] {
  const frames: ParsedStackFrame[] = [];
  const lines = rawText.split("\n");

  for (const line of lines) {
    const trimmed = line.trim();

    // V8 / Bun style: "at GameEngine.processFoodConsumption (src/core/engine.ts:42:15)"
    const v8Match = trimmed.match(
      /^at\s+(?:async\s+)?(?:(?<fn>[a-zA-Z0-9_$#.<> \[\]]+?)\s+\((?<file1>[^()]+?):(?<line1>\d+)(?::(?<col1>\d+))?\)|(?<file2>[^()\s]+?):(?<line2>\d+)(?::(?<col2>\d+))?)/,
    );

    if (v8Match && v8Match.groups) {
      const fn = v8Match.groups.fn;
      const file = v8Match.groups.file1 || v8Match.groups.file2;
      const lineStr = v8Match.groups.line1 || v8Match.groups.line2;
      const colStr = v8Match.groups.col1 || v8Match.groups.col2;

      if (file && !isInternalRunnerFrame(file)) {
        frames.push({
          functionName: cleanFunctionName(fn),
          filePath: file.replace(/^file:\/\//, ""),
          line: lineStr ? parseInt(lineStr, 10) : undefined,
          column: colStr ? parseInt(colStr, 10) : undefined,
        });
      }
      continue;
    }

    // Vitest style: "❯ GameEngine.processFoodConsumption src/core/engine.ts:42:15"
    const vitestMatch = trimmed.match(
      /^[❯>]\s+(?:(?<fn>[a-zA-Z0-9_$#.<> \[\]]+?)\s+)?(?<file>[^():\s]+?):(?<line>\d+)(?::(?<col>\d+))?/,
    );

    if (vitestMatch && vitestMatch.groups) {
      const fn = vitestMatch.groups.fn;
      const file = vitestMatch.groups.file;
      const lineStr = vitestMatch.groups.line;
      const colStr = vitestMatch.groups.col;

      if (file && !isInternalRunnerFrame(file)) {
        frames.push({
          functionName: cleanFunctionName(fn),
          filePath: file.replace(/^file:\/\//, ""),
          line: lineStr ? parseInt(lineStr, 10) : undefined,
          column: colStr ? parseInt(colStr, 10) : undefined,
        });
      }
      continue;
    }
  }

  return frames;
}

/**
 * Splits raw runner output into individual test failure blocks.
 */
function splitFailureBlocks(text: string): { defaultTestFile?: string; blocks: string[] } {
  const lines = text.split("\n");
  const blocks: string[] = [];
  let current: string[] = [];
  let defaultTestFile: string | undefined;

  const isStartMarker = (line: string): boolean => {
    const trimmed = line.trim();
    if (/^[✗✖]\s+failing tests:?/i.test(trimmed)) return false;
    return (
      /^FAIL\s+/.test(trimmed) ||
      /^[✗✖]\s+/.test(trimmed) ||
      /^not ok\s+\d+/.test(trimmed) ||
      /^●\s+/.test(trimmed)
    );
  };

  const hasStartMarkers = lines.some(isStartMarker);
  const hasEndMarkers =
    !hasStartMarkers &&
    lines.some((l) => {
      const trimmed = l.trim();
      return /^\(fail\)\s+/.test(trimmed) && !trimmed.endsWith(":");
    });

  if (hasEndMarkers) {
    for (const line of lines) {
      const trimmed = line.trim();
      const fileHeader = trimmed.match(/^([^:\s]+(?:\.test\.|\.spec\.|tests\/)[^:\s]+):?$/);
      if (fileHeader && !defaultTestFile) {
        defaultTestFile = fileHeader[1];
      }
      current.push(line);
      if (/^\(fail\)\s+/.test(trimmed) && !trimmed.endsWith(":")) {
        blocks.push(current.join("\n"));
        current = [];
      }
    }
    if (current.length > 0 && current.some((l) => l.includes("Error"))) {
      blocks.push(current.join("\n"));
    }
  } else {
    let hasStarted = false;
    for (const line of lines) {
      const trimmed = line.trim();
      const bunHeader = trimmed.match(/\((?:fail|test)\)\s+(?<file>[^\s:]+\.[a-zA-Z0-9]+):/);
      if (bunHeader && bunHeader.groups && bunHeader.groups.file) {
        defaultTestFile = bunHeader.groups.file;
      }
      const fileHeader = trimmed.match(/^([^:\s]+(?:\.test\.|\.spec\.|tests\/)[^:\s]+):?$/);
      if (fileHeader && !defaultTestFile) {
        defaultTestFile = fileHeader[1];
      }

      if (isStartMarker(line)) {
        if (current.length > 0 && hasStarted) {
          blocks.push(current.join("\n"));
          current = [];
        }
        hasStarted = true;
      }

      if (hasStarted) {
        current.push(line);
      }
    }
    if (current.length > 0) {
      blocks.push(current.join("\n"));
    }
  }

  return {
    defaultTestFile,
    blocks: blocks.length > 0 ? blocks : [text],
  };
}

/**
 * Checks whether a line should be ignored when looking for the concise error message.
 */
function isIgnoredLine(trimmed: string): boolean {
  return (
    trimmed.length === 0 ||
    trimmed.startsWith("at ") ||
    trimmed.startsWith("❯ ") ||
    trimmed.startsWith("> ") ||
    trimmed.startsWith("FAIL ") ||
    trimmed.startsWith("● ") ||
    trimmed.startsWith("not ok ") ||
    trimmed.startsWith("---") ||
    trimmed.startsWith("...") ||
    trimmed.startsWith("#") ||
    trimmed.startsWith("duration_ms") ||
    trimmed.startsWith("failureType") ||
    trimmed.startsWith("(fail)") ||
    trimmed.startsWith("ℹ ") ||
    trimmed.startsWith("bun test") ||
    trimmed.startsWith("Ran ") ||
    trimmed.startsWith("Bun v") ||
    trimmed.startsWith("Expected:") ||
    trimmed.startsWith("Received:") ||
    trimmed.startsWith("✓ ") ||
    trimmed.startsWith("✔ ") ||
    /^\d+\s*\|\s*/.test(trimmed) ||
    /^\s*\^+\s*$/.test(trimmed) ||
    /^generatedMessage:/.test(trimmed) ||
    /^actual:/.test(trimmed) ||
    /^expected:/.test(trimmed) ||
    /^operator:/.test(trimmed) ||
    /^diff:/.test(trimmed) ||
    /^code:/.test(trimmed) ||
    trimmed === "}" ||
    trimmed === "{"
  );
}

/**
 * Extracts a concise error message from a failure block.
 */
function extractErrorMessage(block: string): string {
  const lines = block.split("\n");

  // 1. Node TAP YAML: error: '...' (with support for escaped quotes)
  const tapErrorMatch = block.match(/error:\s*['"](.*)['"]\s*$/m);
  if (tapErrorMatch && tapErrorMatch[1]) {
    return tapErrorMatch[1].replace(/\\'/g, "'").trim();
  }

  // 2. Explicit Error: or TypeError: line (including lowercase error: from bun)
  for (const line of lines) {
    const trimmed = line.trim();
    if (isIgnoredLine(trimmed)) {
      continue;
    }

    // Match "TypeError: Cannot read..." or "AssertionError: expected..."
    const typedErrorMatch = trimmed.match(
      /^([A-Za-z0-9_$]+Error(?:\s*\[[^\]]+\])?:\s*.*)$/,
    );
    if (typedErrorMatch) {
      return typedErrorMatch[1].trim();
    }

    // Match generic "Error: message" or "error: message"
    const genericErrorMatch = trimmed.match(/^(?:Error|error)(?:\s*\[[^\]]+\])?:\s*(.*)$/);
    if (genericErrorMatch) {
      const msg = genericErrorMatch[1].trim();
      return msg.length > 0 ? msg : "Error";
    }
  }

  // 3. Fallback: first non-stack, non-header, non-codeframe line
  for (const line of lines) {
    const trimmed = line.trim();
    if (!isIgnoredLine(trimmed)) {
      return trimmed;
    }
  }

  return "Test failed";
}

/**
 * Extracts test description from a failure block.
 */
function extractTestDescription(block: string): string {
  const lines = block.split("\n");

  for (const line of lines) {
    const trimmed = line.trim();

    // Vitest: "FAIL path/to/test.ts > description"
    const vitestMatch = trimmed.match(/^FAIL\s+[^\s>]+\s*>\s*(.+)$/);
    if (vitestMatch) {
      return vitestMatch[1].trim();
    }

    // Bun trailing: "(fail) description [1.40ms]"
    const bunFailMatch = trimmed.match(/^\(fail\)\s+(.+?)(?:\s*[\[(][\d.]+m?s[\])])?$/);
    if (bunFailMatch) {
      return bunFailMatch[1].trim();
    }

    // Bun / Node leading: "✗ description [0.50ms]" or "✖ description (0.615ms)"
    const bunMatch = trimmed.match(/^[✗✖]\s*(.+?)(?:\s*[\[(][\d.]+m?s[\])])?$/);
    if (bunMatch) {
      const title = bunMatch[1].trim();
      if (!title.toLowerCase().startsWith("failing tests")) {
        return title;
      }
    }

    // Node TAP: "not ok 1 - description"
    const tapMatch = trimmed.match(/^not ok\s+\d+\s+-\s+(.+)$/);
    if (tapMatch) {
      return tapMatch[1].trim();
    }

    // Jest: "● Suite › description"
    const jestMatch = trimmed.match(/^●\s*(?:.+?\s*›\s*)?(.+)$/);
    if (jestMatch) {
      return jestMatch[1].trim();
    }

    // test("...") or it("...")
    const inlineTestMatch = trimmed.match(/\b(?:test|it)\s*\(\s*["'`(](.+?)["'`)](?:,\s*|\))/);
    if (inlineTestMatch) {
      return inlineTestMatch[1].trim();
    }
  }

  return "test execution";
}

/**
 * Extracts the test file path from a block or stack frames.
 */
function extractTestFile(
  block: string,
  frames: ParsedStackFrame[],
  defaultFile?: string,
): string {
  // 1. FAIL <file> header
  const vitestFail = block.match(/^FAIL\s+([^\s>]+)/m);
  if (vitestFail) {
    return vitestFail[1].trim();
  }

  // 2. Bun (fail) <file>:
  const bunHeader = block.match(/\((?:fail|test)\)\s+([^\s:]+\.[a-zA-Z0-9]+):/);
  if (bunHeader) {
    return bunHeader[1].trim();
  }

  // 3. Search frames for a test file
  for (const frame of frames) {
    if (
      frame.filePath.includes(".test.") ||
      frame.filePath.includes(".spec.") ||
      frame.filePath.startsWith("tests/") ||
      frame.filePath.startsWith("test/")
    ) {
      return frame.filePath;
    }
  }

  if (defaultFile) {
    return defaultFile;
  }

  // 4. Fallback to first frame if available
  if (frames.length > 0) {
    return frames[0].filePath;
  }

  return "test.ail";
}
/**
 * Scrubs out all references to target file paths (.ts, .js, dist/, node:internal, stack frames).
 * When in companion mode, resolves target paths back to companion workspace .ail references.
 */
export function scrubTargetFileReferences(
  text: string,
  projectRoot: string = process.cwd(),
  config?: AilProjectConfig,
): string {
  let result = text;
  const root = findProjectRoot(projectRoot) ?? projectRoot;
  const cfg = config ?? loadProjectConfig(root);

  // 1. Remove node:internal, node_modules, and raw stack trace lines
  result = result
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      if (trimmed.includes("node:internal") || trimmed.includes("node_modules/")) {
        return false;
      }
      if (
        trimmed.startsWith("at ") ||
        trimmed.startsWith("❯ ") ||
        (trimmed.startsWith("> ") && !trimmed.startsWith("> FAIL"))
      ) {
        return false;
      }
      return true;
    })
    .join("\n");

  // 2. Strip dist/ and build/ directory prefixes
  result = result.replace(/\b(?:dist|build)[/\\]/g, "");

  // 3. Ensure any .ts or .js file path is converted to .ail
  if (cfg.mode === "companion") {
    // Strip targetProjectDir and outDir relative path segments if present
    if (cfg.targetProjectDir) {
      const normTarget = cfg.targetProjectDir.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
      result = result.split(normTarget + "/").join("");
    }
    if (cfg.outDir) {
      const normOut = cfg.outDir.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
      result = result.split(normOut + "/").join("");
    }

    result = result.replace(
      /\b([a-zA-Z0-9_\-./]+)\.(?:ts|tsx|js|jsx|mjs|cjs)\b(?!\.ail)/g,
      (match, prefix) => {
        const res = resolveToAilFile(match, root, cfg);
        if (res.exists) {
          return res.relAilPath;
        }
        return `${prefix}.ail`;
      },
    );
  } else {
    result = result.replace(
      /\b([a-zA-Z0-9_\-./]+)\.(?:ts|tsx|js|jsx|mjs|cjs)\b(?!\.ail)/g,
      "$1.ts.ail",
    );
  }

  return result;
}

/**
 * Primary symbol-aware error formatter function (Step 12 & Step 4.2).
 *
 * Scans error text and stack traces, resolves corresponding .ail AST definitions,
 * and formats a concise 3-to-4 line error report:
 *
 * ❌ FAIL: <test-file.ail> [<test description>]
 *    Error: <concise error message>
 *    Scope: fn <functionName> in <source-file.ail>:<line>
 */
export function formatSymbolAwareError(
  rawOutput: string,
  projectRoot: string = process.cwd(),
  config?: AilProjectConfig,
): string {
  const cleanText = stripAnsi(rawOutput).trim();
  if (cleanText.length === 0) {
    return "";
  }

  const root = findProjectRoot(projectRoot) ?? projectRoot;
  const cfg = config ?? loadProjectConfig(root);

  const { defaultTestFile, blocks } = splitFailureBlocks(cleanText);
  const formattedReports: string[] = [];
  const seenTests = new Set<string>();

  // Filter out redundant summary blocks (e.g. Node.js duplicate summary headers)
  const validBlocks = blocks.filter((block) => {
    const trimmed = block.trim();
    if (trimmed.startsWith("ℹ ") || trimmed.startsWith("✖ failing tests")) {
      return false;
    }
    return true;
  });

  for (const block of validBlocks) {
    const frames = parseStackFrames(block);
    const rawTestFile = extractTestFile(block, frames, defaultTestFile);
    const testAil = resolveToAilFile(rawTestFile, root, cfg);
    const testDescription = extractTestDescription(block);
    const errorMessage = extractErrorMessage(block);

    // Skip duplicate summary-only blocks when another block has failure details
    const hasDetails = frames.length > 0 || errorMessage !== "Test failed";
    const testKey = `${testAil.relAilPath}::${testDescription}`;

    if (seenTests.has(testKey) && !hasDetails) {
      continue;
    }

    // Look for target method/function in frames
    let scopeSymbol: string | undefined;
    let scopeFile: string | undefined;
    let scopeLine: number | undefined;

    // Prioritize application frames (frames outside test files or first frame)
    const appFrames = frames.filter(
      (f) =>
        !f.filePath.includes(".test.") &&
        !f.filePath.includes(".spec.") &&
        !f.filePath.startsWith("tests/") &&
        !f.filePath.startsWith("test/"),
    );
    const candidateFrames = appFrames.length > 0 ? appFrames : frames;

    for (const frame of candidateFrames) {
      const resolved = resolveToAilFile(frame.filePath, root, cfg);

      if (resolved.exists && resolved.fullAilPath) {
        try {
          const source = fs.readFileSync(resolved.fullAilPath, "utf-8");
          const mod = parse(source, resolved.relAilPath);

          let targetFn = frame.functionName;
          if (!targetFn && frame.line) {
            const targetFile = resolveTargetFile(cfg, resolved.fullAilPath, root);
            if (fs.existsSync(targetFile)) {
              targetFn = extractEnclosingSymbolFromSource(
                fs.readFileSync(targetFile, "utf-8"),
                frame.line,
              );
            }
          }

          if (targetFn) {
            const match = findSymbolInAst(mod, targetFn);
            if (match) {
              scopeSymbol = match.name;
              scopeFile = resolved.relAilPath;
              scopeLine = match.line;
              break;
            }
          }

          if (frame.line && !scopeSymbol) {
            const astMatch = findSymbolAtLineInAst(mod, frame.line);
            if (astMatch) {
              scopeSymbol = astMatch.name;
              scopeFile = resolved.relAilPath;
              scopeLine = astMatch.line;
              break;
            }
          }
        } catch {
          // If parse fails, continue to next frame
        }
      }

      if (!scopeSymbol && frame.functionName) {
        scopeSymbol = frame.functionName;
        scopeFile = resolved.relAilPath;
        scopeLine = frame.line ?? 1;
        break;
      }
    }

    // If still no scope found, try first available frame file
    if (!scopeFile && candidateFrames.length > 0) {
      const resolved = resolveToAilFile(candidateFrames[0].filePath, root, cfg);
      scopeFile = resolved.relAilPath;
      scopeLine = candidateFrames[0].line ?? 1;
    }

    // Build the concise 3-to-4 line report
    const lines: string[] = [];
    lines.push(`❌ FAIL: ${testAil.relAilPath} [${testDescription}]`);

    // Concise Error line
    let formattedError = errorMessage;
    if (formattedError.startsWith("Error: ")) {
      formattedError = formattedError.slice(7).trim();
    }
    lines.push(`   Error: ${formattedError}`);

    // Scope line
    if (scopeSymbol && scopeFile && scopeLine !== undefined) {
      lines.push(`   Scope: fn ${scopeSymbol} in ${scopeFile}:${scopeLine}`);
    } else if (scopeFile && scopeLine !== undefined) {
      lines.push(`   Scope: in ${scopeFile}:${scopeLine}`);
    }

    const report = lines.join("\n");
    formattedReports.push(scrubTargetFileReferences(report, root, cfg));
    seenTests.add(testKey);
  }

  // Deduplicate reports if an earlier block had no details and a later block had full details
  const finalReports: string[] = [];
  const processedKeys = new Set<string>();

  for (let i = formattedReports.length - 1; i >= 0; i--) {
    const report = formattedReports[i];
    const firstLine = report.split("\n")[0];
    if (!processedKeys.has(firstLine)) {
      finalReports.unshift(report);
      processedKeys.add(firstLine);
    }
  }

  return finalReports.join("\n\n");
}

/**
 * Translates a single stack trace line or file:line reference into companion .ail format.
 * Format: => <symbol> <file.ail>:<line>:<col> or => <file.ail>:<line>:<col>
 */
export function translateTraceLine(
  rawLine: string,
  projectRoot: string = process.cwd(),
  config?: AilProjectConfig,
): string {
  const line = stripAnsi(rawLine).trim();
  if (line.length === 0) return "";

  const root = findProjectRoot(projectRoot) ?? projectRoot;
  const cfg = config ?? loadProjectConfig(root);

  let fn: string | undefined;
  let filePath: string | undefined;
  let lineNum: number | undefined;
  let colNum: number | undefined;

  // 1. V8 / Bun style: at (async) fn (file:line:col) or at file:line:col
  const v8Match = line.match(
    /^at\s+(?:async\s+)?(?:(?<fn>[a-zA-Z0-9_$#.<> \[\]]+?)\s+\((?<file1>[^()]+?):(?<line1>\d+)(?::(?<col1>\d+))?\)|(?<file2>[^()\s]+?):(?<line2>\d+)(?::(?<col2>\d+))?)/,
  );
  if (v8Match && v8Match.groups) {
    fn = cleanFunctionName(v8Match.groups.fn);
    filePath = v8Match.groups.file1 || v8Match.groups.file2;
    const l = v8Match.groups.line1 || v8Match.groups.line2;
    const c = v8Match.groups.col1 || v8Match.groups.col2;
    lineNum = l ? parseInt(l, 10) : undefined;
    colNum = c ? parseInt(c, 10) : undefined;
  }

  // 2. Vitest / Jest: ❯ (fn) file:line:col
  if (!filePath) {
    const vitestMatch = line.match(
      /^[❯>]\s+(?:(?<fn>[a-zA-Z0-9_$#.<> \[\]]+?)\s+)?(?<file>[^():\s]+?):(?<line>\d+)(?::(?<col>\d+))?/,
    );
    if (vitestMatch && vitestMatch.groups) {
      fn = cleanFunctionName(vitestMatch.groups.fn);
      filePath = vitestMatch.groups.file;
      const l = vitestMatch.groups.line;
      const c = vitestMatch.groups.col;
      lineNum = l ? parseInt(l, 10) : undefined;
      colNum = c ? parseInt(c, 10) : undefined;
    }
  }

  // 3. fn (file:line:col)
  if (!filePath) {
    const parenMatch = line.match(
      /^(?<fn>[a-zA-Z0-9_$#.<> \[\]]+?)\s+\((?<file>[^()]+?):(?<line>\d+)(?::(?<col>\d+))?\)/,
    );
    if (parenMatch && parenMatch.groups) {
      fn = cleanFunctionName(parenMatch.groups.fn);
      filePath = parenMatch.groups.file;
      const l = parenMatch.groups.line;
      const c = parenMatch.groups.col;
      lineNum = l ? parseInt(l, 10) : undefined;
      colNum = c ? parseInt(c, 10) : undefined;
    }
  }

  // 4. (fn) file:line:col or file:line
  if (!filePath) {
    const fileLineMatch = line.match(
      /^(?:(?<fn>[a-zA-Z0-9_$#.<> \[\]]+?)\s+)?(?<file>[^():\s]+?):(?<line>\d+)(?::(?<col>\d+))?$/,
    );
    if (fileLineMatch && fileLineMatch.groups) {
      fn = cleanFunctionName(fileLineMatch.groups.fn);
      filePath = fileLineMatch.groups.file;
      const l = fileLineMatch.groups.line;
      const c = fileLineMatch.groups.col;
      lineNum = l ? parseInt(l, 10) : undefined;
      colNum = c ? parseInt(c, 10) : undefined;
    }
  }

  if (!filePath) {
    return "";
  }

  filePath = filePath.replace(/^file:\/\//, "");

  const resolved = resolveToAilFile(filePath, root, cfg);
  let resolvedSymbol: string | undefined = fn;
  let resolvedLine: number | undefined = lineNum;
  let resolvedCol: number | undefined = colNum;

  if (resolved.exists && resolved.fullAilPath) {
    try {
      const source = fs.readFileSync(resolved.fullAilPath, "utf-8");
      const mod = parse(source, resolved.relAilPath);

      // If function name was not in the trace line, but lineNum is present
      if (!resolvedSymbol && lineNum) {
        let targetContent: string | undefined;
        const targetPath = resolveTargetFile(cfg, resolved.fullAilPath, root);
        if (fs.existsSync(targetPath)) {
          targetContent = fs.readFileSync(targetPath, "utf-8");
        } else {
          try {
            targetContent = emitTarget(mod, cfg.targetLanguage, { pureInterfaces: true, watermark: false });
          } catch {
            // ignore emit error
          }
        }
        if (targetContent) {
          const enclosing = extractEnclosingSymbolFromSource(targetContent, lineNum);
          if (enclosing) {
            resolvedSymbol = enclosing;
          }
        }
      }

      if (resolvedSymbol) {
        const match = findSymbolInAst(mod, resolvedSymbol);
        if (match) {
          resolvedSymbol = match.name;
          resolvedLine = match.line;
          resolvedCol = match.column;
        }
      } else if (lineNum) {
        const astMatch = findSymbolAtLineInAst(mod, lineNum);
        if (astMatch) {
          resolvedSymbol = astMatch.name;
          resolvedLine = astMatch.line;
          resolvedCol = astMatch.column;
        } else if (mod.items.length > 0) {
          const fnCandidates = mod.items.filter(
            (i) =>
              i.kind === "FunctionDecl" ||
              i.kind === "ClassDecl" ||
              i.kind === "ComponentDecl",
          ) as Array<any>;
          if (fnCandidates.length > 0) {
            const matchingBeforeLine = fnCandidates.filter(
              (i) => (i.span?.start?.line ?? 0) <= lineNum,
            );
            const totalLines = source.split("\n").length;
            const chosen =
              matchingBeforeLine.length > 0
                ? matchingBeforeLine[matchingBeforeLine.length - 1]
                : lineNum > totalLines
                  ? fnCandidates[fnCandidates.length - 1]
                  : fnCandidates[0];
            if (chosen) {
              resolvedSymbol = chosen.name;
              resolvedLine = chosen.span?.start?.line;
              resolvedCol = chosen.span?.start?.column;
            }
          }
        }
      }
    } catch {
      // AST parse failure fallback
    }
  }

  const filePart = resolved.relAilPath;
  const linePart = resolvedLine !== undefined ? `:${resolvedLine}` : "";
  const colPart = resolvedCol !== undefined ? `:${resolvedCol}` : "";
  const loc = `${filePart}${linePart}${colPart}`;

  if (resolvedSymbol) {
    return `=> ${resolvedSymbol} ${loc}`;
  }
  return `=> ${loc}`;
}

/**
 * Translates multi-line stack trace or argument list to companion .ail format.
 */
export function translateTrace(
  traceInput: string | string[],
  projectRoot: string = process.cwd(),
  config?: AilProjectConfig,
): string[] {
  let lines: string[] = [];

  if (Array.isArray(traceInput)) {
    if (
      traceInput.length > 1 &&
      (traceInput[0] === "at" || traceInput.some((s) => s.startsWith("(")))
    ) {
      lines = [traceInput.join(" ")];
    } else {
      lines = traceInput.flatMap((arg) => arg.split("\n"));
    }
  } else {
    lines = traceInput.split("\n");
  }

  const results: string[] = [];
  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (trimmed.length === 0) continue;
    const translated = translateTraceLine(trimmed, projectRoot, config);
    if (translated.length > 0) {
      results.push(translated);
    }
  }

  return results;
}

