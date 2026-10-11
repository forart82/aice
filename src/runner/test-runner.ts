/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * AIL 2.0 Test Runner Engine & Orchestrator (Step 11).
 * Executes tests across .ail source files and compiled suites with automatic
 * staleness-detection and side-by-side recompilation via safeWriteTargetFile.
 * Discovers project test harness from package.json (scripts.test), bun:test, vitest,
 * or direct node execution.
 */

import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { parseWithTrivia } from "../core/parser.js";
import {
  detectTargetFromPath,
  emitTarget,
  getTargetOutputPath,
} from "../emitters/index.js";
import { safeWriteTargetFile } from "../shield/index.js";
import { TypeChecker } from "../typechecker/checker.js";
import {
  buildReportFromError,
  formatDiagnosticText,
} from "../typechecker/diagnostics.js";
import { formatSymbolAwareError } from "./symbol-error-formatter.js";

export type HarnessType = "bun" | "vitest" | "node" | "npm" | "auto";

export interface AilTestOptions {
  cwd?: string;
  reporter?: string;
  json?: boolean;
  verbose?: boolean;
  harness?: HarnessType;
  timeoutMs?: number;
  env?: Record<string, string>;
  pureInterfaces?: boolean;
  watermark?: boolean;
}

export interface AilTestSummary {
  total: number;
  passed: number;
  failed: number;
  skipped?: number;
}

export interface AilTestResult {
  success: boolean;
  exitCode: number;
  output: string;
  summary: AilTestSummary;
  compiledFiles?: string[];
  harness?: string;
  command?: string;
  rawStdout?: string;
  rawStderr?: string;
}

export interface DiscoveredHarness {
  type: HarnessType;
  name: string;
  command: string;
  baseArgs: string[];
  buildArgs: (target?: string, options?: AilTestOptions) => string[];
  description: string;
}

/**
 * Strips ANSI escape codes from terminal text.
 */
function stripAnsi(str: string): string {
  return str
    .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "")
    .replace(/\x1b\].*?\x07/g, "");
}

const KNOWN_TARGET_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".py",
  ".html",
  ".css",
  ".rs",
  ".go",
  ".cpp",
  ".hpp",
  ".cc",
  ".cxx",
  ".h",
  ".cs",
]);

/**
 * Derives the compiled target output path from an .ail file.
 * Defaults to .ts extension if none is inferred.
 */
export function resolveTargetFilePath(ailPath: string): string {
  let targetOut = getTargetOutputPath(ailPath);
  const ext = path.extname(targetOut);
  if (!KNOWN_TARGET_EXTENSIONS.has(ext)) {
    const lang = detectTargetFromPath(ailPath);
    switch (lang) {
      case "python":
        targetOut += ".py";
        break;
      case "rust":
        targetOut += ".rs";
        break;
      case "go":
        targetOut += ".go";
        break;
      case "cpp":
        targetOut += ".cpp";
        break;
      case "csharp":
        targetOut += ".cs";
        break;
      case "html":
        targetOut += ".html";
        break;
      case "css":
        targetOut += ".css";
        break;
      case "tsx":
        targetOut += ".tsx";
        break;
      case "typescript":
      default:
        targetOut += ".ts";
        break;
    }
  }
  return targetOut;
}

/**
 * Checks whether an .ail source file requires compilation before running tests.
 * Returns true if target file does not exist or if .ail is strictly newer.
 */
export function isAilCompilationNeeded(
  ailPath: string,
  targetPath?: string,
): boolean {
  const target = targetPath ?? resolveTargetFilePath(ailPath);
  if (!fs.existsSync(target)) {
    return true;
  }
  try {
    const srcStat = fs.statSync(ailPath);
    const tgtStat = fs.statSync(target);
    return srcStat.mtimeMs > tgtStat.mtimeMs;
  } catch {
    return true;
  }
}

/**
 * Compiles a single .ail file into its side-by-side target file using safeWriteTargetFile.
 */
export function compileAilFile(
  ailPath: string,
  options?: { pureInterfaces?: boolean; watermark?: boolean },
): { compiled: boolean; targetPath: string } {
  const targetPath = resolveTargetFilePath(ailPath);
  if (!isAilCompilationNeeded(ailPath, targetPath)) {
    return { compiled: false, targetPath };
  }

  const source = fs.readFileSync(ailPath, "utf-8");
  const { ast: mod, trivia } = parseWithTrivia(source, ailPath);
  const tc = new TypeChecker();
  tc.checkModule(mod);

  const targetLang = detectTargetFromPath(ailPath);
  const emitted = emitTarget(mod, targetLang, {
    trivia,
    pureInterfaces: options?.pureInterfaces,
    watermark: options?.watermark,
  });

  safeWriteTargetFile(targetPath, emitted);
  return { compiled: true, targetPath };
}

/**
 * Recursively locates all .ail files in a target directory or file.
 */
export function findAilFiles(
  rootDir: string,
  ignorePatterns: string[] = ["node_modules", ".git", "dist", "build", ".vitest"],
): string[] {
  if (!fs.existsSync(rootDir)) return [];
  const stat = fs.statSync(rootDir);
  if (!stat.isDirectory()) {
    return rootDir.endsWith(".ail") ? [path.resolve(rootDir)] : [];
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
      const fullPath = path.resolve(dir, entry.name);
      if (entry.isDirectory()) {
        if (!ignorePatterns.includes(entry.name)) {
          walk(fullPath);
        }
      } else if (entry.isFile() && entry.name.endsWith(".ail")) {
        results.push(fullPath);
      }
    }
  }

  walk(rootDir);
  return results;
}

/**
 * Checks and compiles all .ail files relevant to targetPath or project.
 */
export function compileTargetAilIfNeeded(
  targetPath?: string,
  options?: AilTestOptions,
): { compiledFiles: string[]; effectiveTarget?: string } {
  const projectDir = options?.cwd ? path.resolve(options.cwd) : process.cwd();
  const compiledFiles: string[] = [];
  let effectiveTarget = targetPath;

  if (targetPath) {
    const resolved = path.resolve(projectDir, targetPath);
    if (fs.existsSync(resolved)) {
      const stat = fs.statSync(resolved);
      if (stat.isDirectory()) {
        const ailFiles = findAilFiles(resolved);
        for (const f of ailFiles) {
          const res = compileAilFile(f, {
            pureInterfaces: options?.pureInterfaces,
            watermark: options?.watermark,
          });
          if (res.compiled) {
            compiledFiles.push(res.targetPath);
          }
        }
      } else if (resolved.endsWith(".ail")) {
        const res = compileAilFile(resolved, {
          pureInterfaces: options?.pureInterfaces,
          watermark: options?.watermark,
        });
        if (res.compiled) {
          compiledFiles.push(res.targetPath);
        }
        effectiveTarget = path.relative(projectDir, res.targetPath);
      } else {
        // If it's a target file (e.g. foo.test.ts), check if companion .ail exists
        const companionAil = `${resolved}.ail`;
        const altAil = resolved.replace(/\.[a-zA-Z0-9]+$/, ".ail");
        const candidate = fs.existsSync(companionAil)
          ? companionAil
          : fs.existsSync(altAil)
            ? altAil
            : null;
        if (candidate) {
          const res = compileAilFile(candidate, {
            pureInterfaces: options?.pureInterfaces,
            watermark: options?.watermark,
          });
          if (res.compiled) {
            compiledFiles.push(res.targetPath);
          }
        }
      }
    } else if (targetPath.endsWith(".ail")) {
      const targetFile = resolveTargetFilePath(resolved);
      effectiveTarget = path.relative(projectDir, targetFile);
    }
  } else {
    // No target provided: scan project directory for stale .ail files
    const ailFiles = findAilFiles(projectDir);
    for (const f of ailFiles) {
      const res = compileAilFile(f, {
        pureInterfaces: options?.pureInterfaces,
        watermark: options?.watermark,
      });
      if (res.compiled) {
        compiledFiles.push(res.targetPath);
      }
    }
  }

  return { compiledFiles, effectiveTarget };
}

/**
 * Walks up the filesystem hierarchy to locate the nearest package.json.
 */
export function findNearestPackageJson(startDir: string): string | null {
  let cur = path.resolve(startDir);
  while (true) {
    const candidate = path.join(cur, "package.json");
    if (fs.existsSync(candidate)) {
      return candidate;
    }
    const parent = path.dirname(cur);
    if (parent === cur) {
      break;
    }
    cur = parent;
  }
  return null;
}

/**
 * Creates Vitest test harness configuration.
 */
function createVitestHarness(
  projectDir: string,
  localBin: string | null,
  isBun: boolean,
): DiscoveredHarness {
  const hasLocal = localBin && fs.existsSync(localBin);
  const command = hasLocal ? localBin : isBun ? "bunx" : "npx";
  const baseArgs = hasLocal ? ["run"] : ["vitest", "run"];

  return {
    type: "vitest",
    name: "vitest",
    command,
    baseArgs,
    description: "Vitest Test Runner Engine",
    buildArgs: (target?: string, opts?: AilTestOptions) => {
      const args = [...baseArgs];
      if (opts?.reporter) {
        args.push("--reporter", opts.reporter);
      } else if (opts?.verbose) {
        args.push("--reporter=verbose");
      }
      if (target) {
        args.push(target);
      }
      return args;
    },
  };
}

/**
 * Creates Bun test harness configuration.
 */
function createBunHarness(): DiscoveredHarness {
  const command = "bun";
  const baseArgs = ["test"];

  return {
    type: "bun",
    name: "bun:test",
    command,
    baseArgs,
    description: "Bun Native Test Runner (bun:test)",
    buildArgs: (target?: string, opts?: AilTestOptions) => {
      const args = [...baseArgs];
      if (opts?.reporter) {
        args.push(`--reporter=${opts.reporter}`);
      }
      if (target) {
        args.push(target);
      }
      return args;
    },
  };
}

/**
 * Creates Node.js direct test execution configuration.
 */
function createNodeHarness(): DiscoveredHarness {
  const isBun = typeof (process.versions as any)?.bun === "string";
  const command = isBun ? "node" : process.execPath;
  const baseArgs = ["--test"];

  return {
    type: "node",
    name: "node:test",
    command,
    baseArgs,
    description: "Node.js Built-in Test Runner",
    buildArgs: (target?: string, opts?: AilTestOptions) => {
      const args = [...baseArgs];
      if (opts?.reporter) {
        args.push(`--test-reporter=${opts.reporter}`);
      }
      if (target) {
        args.push(target);
      }
      return args;
    },
  };
}

/**
 * Creates npm package.json script test configuration.
 */
function createNpmHarness(isBun: boolean): DiscoveredHarness {
  const command = isBun ? "bun" : "npm";
  const baseArgs = isBun ? ["run", "test"] : ["test"];

  return {
    type: "npm",
    name: "package.json (scripts.test)",
    command,
    baseArgs,
    description: "package.json test script runner",
    buildArgs: (target?: string) => {
      const args = [...baseArgs];
      if (target) {
        args.push("--", target);
      }
      return args;
    },
  };
}

/**
 * Discovers the project test harness from package.json (scripts.test), bun:test, vitest,
 * or direct node execution.
 */
export function discoverTestHarness(
  projectDir: string = process.cwd(),
  options?: AilTestOptions,
): DiscoveredHarness {
  const requestedHarness = options?.harness;
  const isBun = typeof process !== "undefined" && Boolean(process.versions?.bun);

  const pkgPath = findNearestPackageJson(projectDir);
  let pkg: Record<string, unknown> | null = null;
  const resolvedPkgDir = pkgPath ? path.dirname(pkgPath) : projectDir;
  const localVitestBin = path.join(
    resolvedPkgDir,
    "node_modules",
    ".bin",
    "vitest",
  );

  if (pkgPath && fs.existsSync(pkgPath)) {
    try {
      pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8")) as Record<string, unknown>;
    } catch {
      pkg = null;
    }
  }

  // 1. Explicit harness requested
  if (requestedHarness && requestedHarness !== "auto") {
    switch (requestedHarness) {
      case "vitest":
        return createVitestHarness(resolvedPkgDir, localVitestBin, isBun);
      case "bun":
        return createBunHarness();
      case "node":
        return createNodeHarness();
      case "npm":
        return createNpmHarness(isBun);
    }
  }

  // 2. Discover from package.json scripts.test
  if (pkg?.scripts && typeof pkg.scripts === "object") {
    const scripts = pkg.scripts as Record<string, string>;
    const testScript = scripts.test ? String(scripts.test).trim() : "";
    if (testScript) {
      if (testScript.includes("vitest")) {
        return createVitestHarness(resolvedPkgDir, localVitestBin, isBun);
      }
      if (testScript.includes("bun test") || testScript.includes("bun:test")) {
        return createBunHarness();
      }
      if (testScript.includes("node --test")) {
        return createNodeHarness();
      }
      if (!testScript.includes("no test specified")) {
        return createNpmHarness(isBun);
      }
    }
  }

  // 3. Discover from dependencies / devDependencies
  if (pkg) {
    const devDeps = (pkg.devDependencies ?? {}) as Record<string, string>;
    const deps = (pkg.dependencies ?? {}) as Record<string, string>;
    if (devDeps.vitest || deps.vitest) {
      return createVitestHarness(resolvedPkgDir, localVitestBin, isBun);
    }
  }

  // 4. Local node_modules/.bin/vitest exists
  if (fs.existsSync(localVitestBin)) {
    return createVitestHarness(resolvedPkgDir, localVitestBin, isBun);
  }

  // 5. Bun runtime fallback
  if (isBun) {
    return createBunHarness();
  }

  // 6. Direct node execution fallback
  return createNodeHarness();
}

/**
 * Parses test execution summary (total, passed, failed) from test runner outputs.
 */
export function parseTestSummary(
  rawOutput: string,
  exitCode: number,
): AilTestSummary {
  const clean = stripAnsi(rawOutput);
  let total = 0;
  let passed = 0;
  let failed = 0;
  let found = false;

  // 1. Vitest pattern:
  // e.g. "Tests  14 passed (14)" or "Tests  2 failed | 12 passed (14)"
  const vitestMatch = clean.match(
    /Tests\s+(?:(\d+)\s+failed)?(?:\s*\|\s*)?(?:(\d+)\s+passed)?(?:\s*\|\s*)?(?:(\d+)\s+skipped)?\s*\((\d+)\)/,
  );
  if (vitestMatch) {
    failed = vitestMatch[1] ? parseInt(vitestMatch[1], 10) : 0;
    passed = vitestMatch[2] ? parseInt(vitestMatch[2], 10) : 0;
    total = vitestMatch[4] ? parseInt(vitestMatch[4], 10) : passed + failed;
    found = true;
  }

  // 2. Bun test pattern:
  // e.g. " 14 pass\n 0 fail\nRan 14 tests across 1 file."
  if (!found) {
    const bunPass = clean.match(/(\d+)\s+pass/);
    const bunFail = clean.match(/(\d+)\s+fail/);
    if (bunPass || bunFail) {
      passed = bunPass ? parseInt(bunPass[1], 10) : 0;
      failed = bunFail ? parseInt(bunFail[1], 10) : 0;
      const ranMatch = clean.match(/Ran\s+(\d+)\s+tests/);
      total = ranMatch ? parseInt(ranMatch[1], 10) : passed + failed;
      found = true;
    }
  }

  // 3. Node.js --test / TAP pattern:
  // e.g. "# pass 14\n# fail 0\n# tests 14" or "ℹ pass 14"
  if (!found) {
    const nodePass = clean.match(/[#ℹ]\s*pass\s+(\d+)/i);
    const nodeFail = clean.match(/[#ℹ]\s*fail\s+(\d+)/i);
    const nodeTests = clean.match(/[#ℹ]\s*tests\s+(\d+)/i);
    if (nodePass || nodeFail || nodeTests) {
      passed = nodePass ? parseInt(nodePass[1], 10) : 0;
      failed = nodeFail ? parseInt(nodeFail[1], 10) : 0;
      total = nodeTests ? parseInt(nodeTests[1], 10) : passed + failed;
      found = true;
    }
  }

  // 4. Jest / Mocha pattern:
  // "Tests: 1 failed, 14 passed, 15 total" or "14 passing\n1 failing"
  if (!found) {
    const jestMatch = clean.match(
      /Tests:\s+(?:(\d+)\s+failed,\s*)?(?:(\d+)\s+passed,\s*)?(\d+)\s+total/i,
    );
    if (jestMatch) {
      failed = jestMatch[1] ? parseInt(jestMatch[1], 10) : 0;
      passed = jestMatch[2] ? parseInt(jestMatch[2], 10) : 0;
      total = parseInt(jestMatch[3], 10);
      found = true;
    } else {
      const mochaPass = clean.match(/(\d+)\s+passing/i);
      const mochaFail = clean.match(/(\d+)\s+failing/i);
      if (mochaPass || mochaFail) {
        passed = mochaPass ? parseInt(mochaPass[1], 10) : 0;
        failed = mochaFail ? parseInt(mochaFail[1], 10) : 0;
        total = passed + failed;
        found = true;
      }
    }
  }

  // 5. Line-by-line checkmarks fallback:
  if (!found) {
    const passMarks = (clean.match(/^[ \t]*[✓✔][ \t]+.+/gm) || []).length;
    const failMarks = (clean.match(/^[ \t]*[✗✖][ \t]+.+/gm) || []).length;
    if (passMarks > 0 || failMarks > 0) {
      passed = passMarks;
      failed = failMarks;
      total = passMarks + failMarks;
      found = true;
    }
  }

  // 6. Exit code fallback:
  if (!found || total === 0) {
    if (exitCode === 0) {
      total = Math.max(1, passed);
      passed = total;
      failed = 0;
    } else {
      failed = Math.max(1, failed);
      total = Math.max(1, passed + failed);
    }
  }

  return { total, passed, failed };
}

/**
 * Filters out internal runner noise (node_modules internals, vitest/node engine scaffolding)
 * from test failure outputs to produce clean, actionable developer diagnostics.
 */
export function filterTestErrorOutput(output: string): string {
  const lines = output.split("\n");
  const filtered: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (
      trimmed.includes("node_modules/vitest/") ||
      trimmed.includes("node_modules/@vitest/") ||
      trimmed.includes("node_modules/tinypool/") ||
      trimmed.includes("node:internal/") ||
      trimmed.includes("node_modules/vite/") ||
      trimmed.includes("internal/modules/cjs/") ||
      trimmed.includes("internal/modules/esm/") ||
      trimmed.startsWith("Serialized Error:")
    ) {
      continue;
    }
    filtered.push(line);
  }

  while (filtered.length > 0 && filtered[filtered.length - 1].trim() === "") {
    filtered.pop();
  }

  return filtered.join("\n");
}

/**
 * Formats clean output for display depending on whether tests passed or failed.
 */
export function formatCleanTestOutput(
  rawStdout: string,
  rawStderr: string,
  exitCode: number,
  summary: AilTestSummary,
  projectRoot: string = process.cwd(),
): string {
  const combined = `${rawStdout}\n${rawStderr}`.trim();
  if (exitCode === 0 && summary.failed === 0) {
    return rawStdout.trim() || combined;
  }
  const formatted = formatSymbolAwareError(combined, projectRoot);
  if (formatted.trim().length > 0) {
    return formatted;
  }
  return filterTestErrorOutput(combined);
}

/**
 * Primary entry point: Runs tests across .ail files and test suites.
 *
 * 1. Checks if target .ail files need compilation before running tests; compiles them via safeWriteTargetFile.
 * 2. Discovers project test harness from package.json (scripts.test), bun:test, vitest, or direct node execution.
 * 3. Spawns process, captures stdout and stderr.
 * 4. Formats clean output and returns { success, exitCode, output, summary: { total, passed, failed } }.
 */
export async function runAilTests(
  targetPath?: string,
  options?: AilTestOptions,
): Promise<AilTestResult> {
  const projectDir = options?.cwd ? path.resolve(options.cwd) : process.cwd();

  // Step 1: Pre-compilation of .ail files
  let compiledFiles: string[] = [];
  let effectiveTarget = targetPath;

  try {
    const compResult = compileTargetAilIfNeeded(targetPath, options);
    compiledFiles = compResult.compiledFiles;
    effectiveTarget = compResult.effectiveTarget;
  } catch (compileErr) {
    const source =
      targetPath && fs.existsSync(targetPath)
        ? fs.readFileSync(targetPath, "utf-8")
        : "";
    const report = buildReportFromError(
      compileErr,
      source,
      targetPath ?? "unknown.ail",
    );
    const formattedDiag = formatDiagnosticText(report);
    return {
      success: false,
      exitCode: 1,
      output: `❌ AIL Compilation Error prior to test execution:\n${formattedDiag}`,
      summary: { total: 1, passed: 0, failed: 1 },
      compiledFiles,
      harness: "ail-compiler",
    };
  }

  // Step 2: Discover project test harness
  const harness = discoverTestHarness(projectDir, options);
  const fullArgs = harness.buildArgs(effectiveTarget, options);

  // Step 3: Spawn test runner process and capture output
  return new Promise<AilTestResult>((resolve) => {
    let timer: NodeJS.Timeout | undefined;

    const child = spawn(harness.command, fullArgs, {
      cwd: projectDir,
      env: {
        ...process.env,
        ...options?.env,
        FORCE_COLOR: "0",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutChunks.push(chunk);
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderrChunks.push(chunk);
    });

    if (options?.timeoutMs && options.timeoutMs > 0) {
      timer = setTimeout(() => {
        child.kill("SIGTERM");
      }, options.timeoutMs);
    }

    child.on("error", (err: Error) => {
      if (timer) clearTimeout(timer);
      resolve({
        success: false,
        exitCode: 127,
        output: `❌ Failed to execute test harness '${harness.command}': ${err.message}`,
        summary: { total: 0, passed: 0, failed: 1 },
        compiledFiles,
        harness: harness.name,
        command: harness.command,
      });
    });

    child.on("close", (code: number | null) => {
      if (timer) clearTimeout(timer);

      const exitCode = code ?? 0;
      const rawStdout = Buffer.concat(stdoutChunks).toString("utf-8");
      const rawStderr = Buffer.concat(stderrChunks).toString("utf-8");

      const summary = parseTestSummary(`${rawStdout}\n${rawStderr}`, exitCode);
      const output = formatCleanTestOutput(
        rawStdout,
        rawStderr,
        exitCode,
        summary,
        projectDir,
      );

      const success = exitCode === 0 && summary.failed === 0;

      resolve({
        success,
        exitCode,
        output,
        summary,
        compiledFiles,
        harness: harness.name,
        command: `${harness.command} ${fullArgs.join(" ")}`,
        rawStdout,
        rawStderr,
      });
    });
  });
}
