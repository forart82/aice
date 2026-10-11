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
import type {
  ClassDecl,
  ComponentDecl,
  FunctionDecl,
  MethodDecl,
  Module,
  PropertyDecl,
} from "../core/ast.js";
import { parse } from "../core/parser.js";

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
 * Normalizes a file path and resolves it to its corresponding .ail source file.
 */
export function resolveToAilFile(
  filePath: string,
  projectRoot: string,
): { relAilPath: string; fullAilPath?: string; exists: boolean } {
  let clean = filePath.replace(/:\d+(?::\d+)?$/, "").trim();
  if (clean.startsWith("file://")) {
    clean = clean.slice(7);
  }

  clean = clean.replace(/\\/g, "/");

  let rel = path.isAbsolute(clean)
    ? path.relative(projectRoot, clean)
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
    const full = path.resolve(projectRoot, cand);
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
            };
          }
        }
        for (const prop of item.properties) {
          if (prop.name === memberName) {
            return {
              name: targetSymbol,
              kind: "property",
              line: prop.span.start.line,
            };
          }
        }
        if (memberName === "new" || memberName === "constructor") {
          return {
            name: targetSymbol,
            kind: "class",
            line: item.span.start.line,
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
          };
        }
      }
      for (const prop of item.properties) {
        if (prop.name === memberName) {
          return {
            name: targetSymbol,
            kind: "property",
            line: prop.span.start.line,
          };
        }
      }
      if (item.name === memberName) {
        return {
          name: item.name,
          kind: "class",
          line: item.span.start.line,
        };
      }
    }
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
      const bunHeader = trimmed.match(/\((?:fail|test)\)\s+(?<file>[^\s:]+):?/);
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

  // 2. Explicit Error: or TypeError: line
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

    // Match generic "Error: message"
    const genericErrorMatch = trimmed.match(/^Error(?:\s*\[[^\]]+\])?:\s*(.*)$/);
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
  const bunHeader = block.match(/\((?:fail|test)\)\s+([^\s:]+)/);
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
 */
export function scrubTargetFileReferences(text: string): string {
  let result = text;

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
  result = result.replace(
    /\b([a-zA-Z0-9_\-./]+)\.(?:ts|tsx|js|jsx|mjs|cjs)\b(?!\.ail)/g,
    "$1.ts.ail",
  );

  return result;
}

/**
 * Primary symbol-aware error formatter function (Step 12).
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
): string {
  const cleanText = stripAnsi(rawOutput).trim();
  if (cleanText.length === 0) {
    return "";
  }

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
    const testAil = resolveToAilFile(rawTestFile, projectRoot);
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
      const resolved = resolveToAilFile(frame.filePath, projectRoot);

      if (resolved.exists && resolved.fullAilPath && frame.functionName) {
        try {
          const source = fs.readFileSync(resolved.fullAilPath, "utf-8");
          const mod = parse(source, resolved.relAilPath);
          const match = findSymbolInAst(mod, frame.functionName);
          if (match) {
            scopeSymbol = match.name;
            scopeFile = resolved.relAilPath;
            scopeLine = match.line;
            break;
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
      const resolved = resolveToAilFile(candidateFrames[0].filePath, projectRoot);
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
    formattedReports.push(scrubTargetFileReferences(report));
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
