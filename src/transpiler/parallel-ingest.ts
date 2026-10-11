/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * AIL 2.0 Side-by-Side Parallel Ingestion Engine (Step 3).
 * Recursively scans project directories and decompiles supported target files
 * (.ts, .tsx, .css, .html) into bit-identical .ail source files side-by-side,
 * leveraging ConcurrencyPool and MultiLineReporter.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { getEncoding } from "js-tiktoken";
import {
  getExtensionForTarget,
  loadProjectConfig,
  saveProjectConfig,
} from "../config/project-config.js";
import { decompile } from "../decompiler/index.js";
import { detectTargetFromPath, type TargetLanguage } from "../emitters/index.js";
import { ConcurrencyPool, type TaskItem } from "../runner/concurrency-pool.js";
import { MultiLineReporter } from "../runner/multi-line-reporter.js";
import { removeAiShield, unlockProjectTargets } from "../shield/index.js";

const cl100k = getEncoding("cl100k_base");

export interface IngestOptions {
  dir: string;
  concurrency?: number;
  showProgress?: boolean;
  reporter?: MultiLineReporter;
  overwrite?: boolean; // default false
  emitTrivia?: boolean; // default true
  dryRun?: boolean; // default false
  extensions?: string[]; // default [".ts", ".tsx", ".css", ".html", ".cpp", ".hpp", ".cc", ".cxx", ".h", ".cs"]
  ignorePatterns?: string[]; // default ["node_modules", ".git", "dist", "build", ".ail-build"]
  isolate?: boolean;
  outDir?: string;
  sourceDir?: string;
  targetLanguage?: TargetLanguage;
}

export type IngestProjectOptions = IngestOptions;

export interface FileIngestResult {
  sourcePath: string;
  ailPath: string;
  triviaPath?: string;
  targetLang: TargetLanguage;
  success: boolean;
  error?: Error;
  targetChars: number;
  ailChars: number;
  targetTokens: number;
  ailTokens: number;
  cl100kSavingsPct: number;
  durationMs: number;
  relocatedPath?: string;
}

export interface IngestSummary {
  totalDiscovered: number;
  totalIngested: number;
  totalSkipped: number;
  totalFailed: number;
  totalTargetTokens: number;
  totalAilTokens: number;
  cl100kSavingsPct: number;
  durationMs: number;
  results: FileIngestResult[];
}

interface IngestTaskData {
  filePath: string;
  targetLang: TargetLanguage;
  destAilPath: string;
  destTargetPath: string;
  status: "DECOMPILING";
}

export const ISOLATED_MODE_IGNORE_FILES = [
  ".gitignore",
  ".agentignore",
  ".cursorignore",
  ".geminiignore",
] as const;

/**
 * Derives a clean `.ail` relative path from a source target path.
 * When the file has the default extension for its target language (e.g. `.ts` for TypeScript),
 * the target extension is replaced with `.ail` (e.g. `calc.ts` -> `calc.ail`, `calc.test.ts` -> `calc.test.ail`).
 * Otherwise, `.ail` is appended to preserve target metadata (e.g. `Button.tsx` -> `Button.tsx.ail`).
 */
export function deriveCleanAilRelativePath(
  relPath: string,
  targetLang: TargetLanguage,
): string {
  const dir = path.dirname(relPath);
  const base = path.basename(relPath);
  const ext = path.extname(base).toLowerCase();
  const defaultTargetExt = getExtensionForTarget(targetLang);

  let ailBase: string;
  if (ext === defaultTargetExt) {
    ailBase = `${base.slice(0, -ext.length)}.ail`;
  } else {
    ailBase = `${base}.ail`;
  }

  return dir === "." ? ailBase : path.join(dir, ailBase).replace(/\\/g, "/");
}

/**
 * Automatically updates project ignore files (.gitignore, .agentignore, .cursorignore, .geminiignore)
 * to ignore the isolated build directory (e.g. .ail-build/).
 */
export function updateIgnoreFilesForIsolatedMode(
  projectDir: string,
  outDir: string = ".ail-build",
): string[] {
  const resolvedDir = path.resolve(projectDir);
  const cleanOutDir = outDir.replace(/^\.\/|^\.\\/, "").replace(/[/\\]+$/, "");
  const patternSlash = `${cleanOutDir}/`;
  const patternNoSlash = cleanOutDir;
  const updatedFiles: string[] = [];

  for (const ignoreFile of ISOLATED_MODE_IGNORE_FILES) {
    const filePath = path.join(resolvedDir, ignoreFile);
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, "utf-8");
      const lines = content.split(/\r?\n/).map((l) => l.trim());
      const alreadyIgnored = lines.some(
        (line) =>
          line === patternSlash ||
          line === patternNoSlash ||
          line === `/${patternSlash}` ||
          line === `/${patternNoSlash}` ||
          line === `./${patternSlash}` ||
          line === `./${patternNoSlash}`,
      );

      if (!alreadyIgnored) {
        const prefix = content.length > 0 && !content.endsWith("\n") ? "\n" : "";
        const addition = `${prefix}# AIL isolated build artifact cache\n${patternSlash}\n${patternNoSlash}\n`;
        fs.writeFileSync(filePath, content + addition, "utf-8");
        updatedFiles.push(filePath);
      }
    } else {
      const newContent = `# AIL isolated build artifact cache\n${patternSlash}\n${patternNoSlash}\n`;
      fs.writeFileSync(filePath, newContent, "utf-8");
      updatedFiles.push(filePath);
    }
  }

  return updatedFiles;
}

/**
 * Cleans ignore rules (.gitignore, .agentignore, .cursorignore, .geminiignore)
 * removing .ail-build (or custom outDir) patterns and comments.
 * Deletes the ignore file if it becomes empty.
 */
export function cleanIgnoreFilesForIsolatedMode(
  projectDir: string,
  outDir: string = ".ail-build",
): string[] {
  const resolvedDir = path.resolve(projectDir);
  const cleanOutDir = outDir.replace(/^\.\/|^\.\\/, "").replace(/[/\\]+$/, "");
  const patternSlash = `${cleanOutDir}/`;
  const patternNoSlash = cleanOutDir;
  const defaultSlash = ".ail-build/";
  const defaultNoSlash = ".ail-build";

  const isIsolatedIgnoreLine = (line: string): boolean => {
    const trimmed = line.trim();
    if (
      trimmed === "# AIL isolated build artifact cache" ||
      trimmed === "# AIL isolated build cache"
    ) {
      return true;
    }
    const candidates = [
      patternSlash,
      patternNoSlash,
      `/${patternSlash}`,
      `/${patternNoSlash}`,
      `./${patternSlash}`,
      `./${patternNoSlash}`,
      defaultSlash,
      defaultNoSlash,
      `/${defaultSlash}`,
      `/${defaultNoSlash}`,
      `./${defaultSlash}`,
      `./${defaultNoSlash}`,
    ];
    return candidates.includes(trimmed);
  };

  const cleanedFiles: string[] = [];

  for (const ignoreFile of ISOLATED_MODE_IGNORE_FILES) {
    const filePath = path.join(resolvedDir, ignoreFile);
    if (!fs.existsSync(filePath)) continue;

    const content = fs.readFileSync(filePath, "utf-8");
    const lines = content.split(/\r?\n/);
    const remainingLines: string[] = [];
    let fileModified = false;

    for (const line of lines) {
      if (isIsolatedIgnoreLine(line)) {
        fileModified = true;
      } else {
        remainingLines.push(line);
      }
    }

    if (fileModified) {
      const remainingText = remainingLines
        .join("\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();

      if (!remainingText) {
        try {
          fs.unlinkSync(filePath);
        } catch {
          // ignore unlink error
        }
      } else {
        fs.writeFileSync(filePath, `${remainingText}\n`, "utf-8");
      }
      cleanedFiles.push(filePath);
    }
  }

  return cleanedFiles;
}

function cleanEmptyDirs(dir: string, stopAt: string): void {
  let curr = path.resolve(dir);
  const stop = path.resolve(stopAt);
  while (curr !== stop && curr.startsWith(stop) && curr.length > stop.length) {
    try {
      const entries = fs.readdirSync(curr);
      if (entries.length === 0) {
        fs.rmdirSync(curr);
        curr = path.dirname(curr);
      } else {
        break;
      }
    } catch {
      break;
    }
  }
}

function shouldIgnore(name: string, relPath: string, ignorePatterns: string[]): boolean {
  const normalizedRel = relPath.replace(/\\/g, "/");
  const segments = normalizedRel.split("/").filter(Boolean);

  for (const pattern of ignorePatterns) {
    const cleanPattern = pattern.replace(/^\/+/, "").replace(/\/+$/, "");

    // Exact directory or file name match (e.g. "node_modules", ".git")
    if (name === pattern || name === cleanPattern) {
      return true;
    }

    // Path segment match (e.g. "dist" in "src/dist/file.ts")
    if (segments.includes(pattern) || segments.includes(cleanPattern)) {
      return true;
    }

    // Relative path match or prefix match
    if (
      normalizedRel === pattern ||
      normalizedRel === cleanPattern ||
      normalizedRel.startsWith(`${cleanPattern}/`) ||
      normalizedRel.endsWith(`/${cleanPattern}`)
    ) {
      return true;
    }

    // Wildcard matching (e.g. "*.log", "*.test.ts")
    if (pattern.includes("*")) {
      const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
      const regex = new RegExp(`^${escaped}$`);
      if (regex.test(name) || regex.test(normalizedRel)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Recursively scans a directory for files matching supported extensions,
 * skipping ignored folders and patterns.
 */
export function findIngestableFiles(dir: string, options?: Partial<IngestOptions>): string[] {
  const resolvedDir = path.resolve(dir);
  if (!fs.existsSync(resolvedDir)) {
    throw new Error(`Directory not found: ${dir}`);
  }

  const stat = fs.statSync(resolvedDir);
  if (stat.isFile()) {
    return [resolvedDir];
  }

  const extensions = (
    options?.extensions ?? [
      ".ts",
      ".tsx",
      ".js",
      ".mjs",
      ".css",
      ".html",
      ".py",
      ".cpp",
      ".hpp",
      ".cc",
      ".cxx",
      ".h",
      ".cs",
      ".php",
      ".kt",
      ".kts",
    ]
  ).map((ext) => (ext.startsWith(".") ? ext.toLowerCase() : `.${ext.toLowerCase()}`));
  const defaultIgnores = ["node_modules", ".git", "dist", "build", ".ail-build", ".agents"];
  if (options?.outDir) {
    const cleanOut = options.outDir.replace(/^\.\/|^\.\\/, "").replace(/[/\\]+$/, "");
    if (!defaultIgnores.includes(cleanOut)) {
      defaultIgnores.push(cleanOut);
    }
  }
  const ignorePatterns = options?.ignorePatterns ?? defaultIgnores;

  const results: string[] = [];

  function scanDir(currentDir: string): void {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.resolve(currentDir, entry.name);
      const relPath = path.relative(resolvedDir, fullPath);

      if (shouldIgnore(entry.name, relPath, ignorePatterns)) {
        continue;
      }

      if (entry.isDirectory()) {
        scanDir(fullPath);
      } else if (entry.isFile()) {
        const lowerName = entry.name.toLowerCase();
        if (
          lowerName.endsWith(".ail") ||
          lowerName.endsWith(".trivia.json") ||
          lowerName.endsWith(".uid")
        ) {
          continue;
        }
        if (extensions.some((ext) => lowerName.endsWith(ext))) {
          results.push(fullPath);
        }
      }
    }
  }

  scanDir(resolvedDir);
  results.sort();
  return results;
}

/**
 * Scans an existing project and decompiles all supported target files
 * into .ail files (side-by-side or isolated mode), leveraging ConcurrencyPool
 * and MultiLineReporter.
 */
export async function ingestProjectSideBySide(options: IngestOptions): Promise<IngestSummary> {
  const startTime = performance.now();
  const resolvedDir = path.resolve(options.dir);

  const isIsolated = Boolean(options.isolate);
  const sourceDir = (options.sourceDir ?? "src").replace(/^\.\/|^\.\\/, "").replace(/[/\\]+$/, "");
  const outDir = (options.outDir ?? ".ail-build").replace(/^\.\/|^\.\\/, "").replace(/[/\\]+$/, "");
  const absSourceDir = path.resolve(resolvedDir, sourceDir);
  const absOutDir = path.resolve(resolvedDir, outDir);

  const discoveredFiles = findIngestableFiles(resolvedDir, {
    ...options,
    outDir,
  });
  const totalDiscovered = discoveredFiles.length;

  const overwrite = options.overwrite ?? false;
  const emitTrivia = options.emitTrivia ?? true;
  const dryRun = options.dryRun ?? false;
  const cpus = os.cpus?.().length ? os.cpus().length : 4;
  const concurrency = Math.max(1, Math.floor(options.concurrency ?? cpus));

  function computeFilePaths(filePath: string): {
    targetLang: TargetLanguage;
    destAilPath: string;
    destTargetPath: string;
  } {
    const targetLang = detectTargetFromPath(filePath);
    if (!isIsolated) {
      return {
        targetLang,
        destAilPath: `${filePath}.ail`,
        destTargetPath: filePath,
      };
    }

    const relFromProject = path.relative(resolvedDir, filePath).replace(/\\/g, "/");
    let relWithinSource: string;
    if (sourceDir && sourceDir !== "." && relFromProject.startsWith(`${sourceDir}/`)) {
      relWithinSource = relFromProject.slice(sourceDir.length + 1);
    } else {
      relWithinSource = relFromProject;
    }

    const cleanAilRel = deriveCleanAilRelativePath(relWithinSource, targetLang);
    const destAilPath = path.resolve(absSourceDir, cleanAilRel);
    const destTargetPath = path.resolve(absOutDir, relWithinSource);

    return {
      targetLang,
      destAilPath,
      destTargetPath,
    };
  }

  // Identify files needing ingestion
  const filesToIngest: string[] = [];
  let totalSkipped = 0;

  for (const filePath of discoveredFiles) {
    const { destAilPath } = computeFilePaths(filePath);
    if (!overwrite && fs.existsSync(destAilPath)) {
      totalSkipped++;
    } else {
      filesToIngest.push(filePath);
    }
  }

  // Handle empty ingestion set
  if (filesToIngest.length === 0) {
    if (isIsolated && !dryRun) {
      saveProjectConfig(resolvedDir, {
        mode: "isolated",
        sourceDir,
        outDir,
        isolated: true,
        ...(options.targetLanguage ? { targetLanguage: options.targetLanguage } : {}),
      });
      updateIgnoreFilesForIsolatedMode(resolvedDir, outDir);
    }

    if (options.reporter) {
      if (!options.reporter.isStarted) {
        options.reporter.start("AIL 2.0 Parallel Ingestion Engine", 0);
      }
      options.reporter.finish("No files needed ingestion.");
    } else if (options.showProgress) {
      const reporter = new MultiLineReporter({ concurrency });
      reporter.start("AIL 2.0 Parallel Ingestion Engine", 0);
      reporter.finish("No files needed ingestion.");
    }

    return {
      totalDiscovered,
      totalIngested: 0,
      totalSkipped,
      totalFailed: 0,
      totalTargetTokens: 0,
      totalAilTokens: 0,
      cl100kSavingsPct: 0,
      durationMs: Math.max(0, performance.now() - startTime),
      results: [],
    };
  }

  // Setup reporter
  let reporter = options.reporter;
  if (!reporter && options.showProgress) {
    reporter = new MultiLineReporter({ concurrency });
  }

  if (reporter && !reporter.isStarted) {
    reporter.start("AIL 2.0 Parallel Ingestion Engine", filesToIngest.length);
  }

  const pool = new ConcurrencyPool<IngestTaskData, FileIngestResult>({
    concurrency,
  });

  if (reporter) {
    pool.attachReporter(reporter, {
      getFile: (task) => task.data.filePath,
      getStatus: () => "DECOMPILING",
      getMetrics: (res) =>
        res ? { targetTokens: res.targetTokens, ailTokens: res.ailTokens } : undefined,
    });
  }

  // Build task items
  const tasks: TaskItem<IngestTaskData, FileIngestResult>[] = filesToIngest.map((filePath) => {
    const { targetLang, destAilPath, destTargetPath } = computeFilePaths(filePath);
    return {
      id: filePath,
      data: {
        filePath,
        targetLang,
        destAilPath,
        destTargetPath,
        status: "DECOMPILING",
      },
      run: async (_workerId: number): Promise<FileIngestResult> => {
        const taskStart = performance.now();

        const source = await fs.promises.readFile(filePath, "utf-8");
        const decomp = decompile(source, targetLang, { filePath });

        const targetChars = source.length;
        const ailChars = decomp.ail.length;
        const targetTokens = cl100k.encode(source).length;
        const ailTokens = cl100k.encode(decomp.ail).length;
        const cl100kSavingsPct =
          targetTokens > 0 ? ((targetTokens - ailTokens) / targetTokens) * 100 : 0;

        if (!dryRun) {
          await fs.promises.mkdir(path.dirname(destAilPath), { recursive: true });
          await fs.promises.writeFile(destAilPath, decomp.ail, "utf-8");

          if (isIsolated && filePath !== destTargetPath) {
            await fs.promises.mkdir(path.dirname(destTargetPath), { recursive: true });
            try {
              await fs.promises.rename(filePath, destTargetPath);
            } catch (err: unknown) {
              const code = (err as { code?: string })?.code;
              if (code === "EXDEV") {
                await fs.promises.copyFile(filePath, destTargetPath);
                await fs.promises.unlink(filePath);
              } else {
                throw err;
              }
            }

            const fileDir = path.dirname(filePath);
            if (path.resolve(fileDir) !== absSourceDir && !path.resolve(fileDir).startsWith(absSourceDir)) {
              cleanEmptyDirs(fileDir, resolvedDir);
            }
          }
        }

        const durationMs = Math.max(0, performance.now() - taskStart);

        return {
          sourcePath: filePath,
          ailPath: destAilPath,
          targetLang,
          success: true,
          targetChars,
          ailChars,
          targetTokens,
          ailTokens,
          cl100kSavingsPct,
          durationMs,
          relocatedPath: isIsolated ? destTargetPath : undefined,
        };
      },
    };
  });

  const poolResults = await pool.runAll(tasks);

  if (isIsolated && !dryRun) {
    saveProjectConfig(resolvedDir, {
      mode: "isolated",
      sourceDir,
      outDir,
      isolated: true,
      ...(options.targetLanguage ? { targetLanguage: options.targetLanguage } : {}),
    });
    updateIgnoreFilesForIsolatedMode(resolvedDir, outDir);
  }

  const results: FileIngestResult[] = poolResults.map((taskRes) => {
    if (taskRes.success && taskRes.result) {
      return taskRes.result;
    }
    return {
      sourcePath: taskRes.task.data.filePath,
      ailPath: taskRes.task.data.destAilPath,
      targetLang: taskRes.task.data.targetLang,
      success: false,
      error: taskRes.error ?? new Error("Task execution failed"),
      targetChars: 0,
      ailChars: 0,
      targetTokens: 0,
      ailTokens: 0,
      cl100kSavingsPct: 0,
      durationMs: taskRes.durationMs,
      relocatedPath: isIsolated ? taskRes.task.data.destTargetPath : undefined,
    };
  });

  const successfulResults = results.filter((r) => r.success);
  const totalIngested = successfulResults.length;
  const totalFailed = results.length - totalIngested;

  const totalTargetTokens = successfulResults.reduce((acc, r) => acc + r.targetTokens, 0);
  const totalAilTokens = successfulResults.reduce((acc, r) => acc + r.ailTokens, 0);
  const aggregateSavingsPct =
    totalTargetTokens > 0 ? ((totalTargetTokens - totalAilTokens) / totalTargetTokens) * 100 : 0;

  if (reporter) {
    reporter.finish(
      `Ingested ${totalIngested}/${filesToIngest.length} files (${aggregateSavingsPct.toFixed(1)}% cl100k savings)`,
    );
  }

  return {
    totalDiscovered,
    totalIngested,
    totalSkipped,
    totalFailed,
    totalTargetTokens,
    totalAilTokens,
    cl100kSavingsPct: aggregateSavingsPct,
    durationMs: Math.max(0, performance.now() - startTime),
    results,
  };
}

export const ingestProject = ingestProjectSideBySide;

/**
 * Recursively removes all .ail, .trivia.json, and .uid files from a directory,
 * skipping node_modules, .git, and build directories.
 * Returns array of removed file paths.
 */
export function removeAilAndTriviaFiles(curDir: string): string[] {
  const removed: string[] = [];
  if (!fs.existsSync(curDir)) return removed;

  const entries = fs.readdirSync(curDir, { withFileTypes: true });
  for (const entry of entries) {
    if (
      entry.name === "node_modules" ||
      entry.name === ".git" ||
      entry.name === ".ail-build"
    ) {
      continue;
    }
    const fullPath = path.join(curDir, entry.name);
    if (entry.isDirectory()) {
      removed.push(...removeAilAndTriviaFiles(fullPath));
    } else if (entry.isFile()) {
      const lower = entry.name.toLowerCase();
      if (
        lower.endsWith(".ail") ||
        lower.endsWith(".trivia.json") ||
        lower.endsWith(".uid")
      ) {
        try {
          fs.unlinkSync(fullPath);
          removed.push(fullPath);
        } catch {
          try {
            fs.chmodSync(fullPath, 0o644);
            fs.unlinkSync(fullPath);
            removed.push(fullPath);
          } catch {
            // ignore unlink errors
          }
        }
      }
    }
  }
  return removed;
}

export interface EjectProjectOptions {
  dir: string;
  fromBuild?: boolean;
  removeAil?: boolean;
  keepAil?: boolean;
  sourceDir?: string;
  outDir?: string;
}

export interface EjectProjectResult {
  mode: "isolated" | "side-by-side";
  restoredFiles: string[];
  removedAilFiles: string[];
  removedBuildDir?: string;
  unlockedTargets?: number;
  shieldRemoved?: string[];
  shieldReverted?: string[];
}

/**
 * Ejects AIL from a project.
 * Supports both:
 * 1. Isolated mode (or when `fromBuild` is true):
 *    - Identifies sourceDir (e.g. src) and outDir (e.g. .ail-build)
 *    - Copies/moves all target files from outDir back into sourceDir, restoring original file tree
 *    - Removes .ail files unless keepAil is true (default for isolated eject is to delete .ail files)
 *    - Removes outDir (.ail-build/)
 *    - Removes ail.config.json and .ailrc
 *    - Cleans ignore rules (.gitignore, .agentignore, .cursorignore, .geminiignore) removing .ail-build rules
 *    - Removes AI shields and unlocks target files
 *    - Returns { restoredFiles, removedAilFiles, removedBuildDir, ... }
 * 2. Side-by-side mode:
 *    - Unlocks target files
 *    - Removes AI shields
 *    - Removes .ail files if removeAil is true and not keepAil
 *    - Returns { restoredFiles: [], removedAilFiles, ... }
 */
export async function ejectProject(options: EjectProjectOptions): Promise<EjectProjectResult> {
  const resolvedDir = path.resolve(options.dir);
  if (!fs.existsSync(resolvedDir)) {
    throw new Error(`Directory not found: ${options.dir}`);
  }

  const config = loadProjectConfig(resolvedDir);
  const detectedOutDir = (options.outDir ?? config.outDir ?? ".ail-build")
    .replace(/^\.\/|^\.\\/, "")
    .replace(/[/\\]+$/, "");
  const absDetectedOutDir = path.resolve(resolvedDir, detectedOutDir);

  const isIsolated = Boolean(
    options.fromBuild ||
      config.mode === "isolated" ||
      config.isolated ||
      fs.existsSync(absDetectedOutDir),
  );

  const restoredFiles: string[] = [];
  const removedAilFiles: string[] = [];
  let removedBuildDir: string | undefined;
  let unlockedTargets = 0;

  if (isIsolated) {
    const sourceDir = (options.sourceDir ?? config.sourceDir ?? "src")
      .replace(/^\.\/|^\.\\/, "")
      .replace(/[/\\]+$/, "");
    const outDir = detectedOutDir;
    const absSourceDir = path.resolve(resolvedDir, sourceDir);
    const absOutDir = absDetectedOutDir;

    // 1. Identify and restore target files from outDir back into sourceDir
    if (fs.existsSync(absOutDir)) {
      function scanTargetFiles(cur: string): string[] {
        const found: string[] = [];
        if (!fs.existsSync(cur)) return found;
        const entries = fs.readdirSync(cur, { withFileTypes: true });
        for (const entry of entries) {
          const full = path.join(cur, entry.name);
          if (entry.isDirectory()) {
            found.push(...scanTargetFiles(full));
          } else if (entry.isFile()) {
            found.push(full);
          }
        }
        return found;
      }

      const filesToRestore = scanTargetFiles(absOutDir);
      for (const srcFile of filesToRestore) {
        const rel = path.relative(absOutDir, srcFile);
        const destFile = path.resolve(absSourceDir, rel);
        fs.mkdirSync(path.dirname(destFile), { recursive: true });

        // Ensure source file is readable if locked
        try {
          fs.chmodSync(srcFile, 0o644);
        } catch {
          // ignore
        }

        fs.copyFileSync(srcFile, destFile);

        // Ensure restored target file is unlocked and writable
        try {
          fs.chmodSync(destFile, 0o644);
        } catch {
          // ignore
        }

        restoredFiles.push(destFile);
      }

      // 2. Remove outDir (.ail-build/)
      try {
        fs.rmSync(absOutDir, { recursive: true, force: true });
        removedBuildDir = absOutDir;
      } catch {
        // Unlock files inside outDir and retry if needed
        try {
          for (const f of filesToRestore) {
            try {
              fs.chmodSync(f, 0o644);
            } catch {
              // ignore
            }
          }
          fs.rmSync(absOutDir, { recursive: true, force: true });
          removedBuildDir = absOutDir;
        } catch {
          // ignore
        }
      }
    }

    // 3. Removes .ail files if --remove-ail is true (or default for isolated eject, unless keepAil)
    let shouldRemoveAil = true;
    if (options.keepAil) {
      shouldRemoveAil = false;
    } else if (options.removeAil !== undefined) {
      shouldRemoveAil = options.removeAil;
    }

    if (shouldRemoveAil) {
      const removed = removeAilAndTriviaFiles(resolvedDir);
      const ailOnly = removed.filter((f) => f.endsWith(".ail"));
      removedAilFiles.push(...ailOnly);
    }

    // 4. Remove ail.config.json and .ailrc
    for (const cfgName of ["ail.config.json", ".ailrc"]) {
      const cfgPath = path.join(resolvedDir, cfgName);
      if (fs.existsSync(cfgPath)) {
        try {
          fs.unlinkSync(cfgPath);
        } catch {
          // ignore
        }
      }
    }

    // 5. Remove AI shields
    const shieldRes = await removeAiShield(resolvedDir);

    // 6. Clean ignore rules (.gitignore, .agentignore, .cursorignore, .geminiignore)
    cleanIgnoreFilesForIsolatedMode(resolvedDir, outDir);

    // 7. Ensure restored files are unlocked
    const lockRes = await unlockProjectTargets(resolvedDir);
    unlockedTargets = lockRes.totalUnlocked;

    restoredFiles.sort();
    removedAilFiles.sort();

    return {
      mode: "isolated",
      restoredFiles,
      removedAilFiles,
      removedBuildDir,
      unlockedTargets,
      shieldRemoved: shieldRes.removedFiles,
      shieldReverted: shieldRes.revertedFiles,
    };
  } else {
    // Side-by-side mode eject
    const lockRes = await unlockProjectTargets(resolvedDir);
    unlockedTargets = lockRes.totalUnlocked;

    const shieldRes = await removeAiShield(resolvedDir);

    if (options.removeAil && !options.keepAil) {
      const removed = removeAilAndTriviaFiles(resolvedDir);
      const ailOnly = removed.filter((f) => f.endsWith(".ail"));
      removedAilFiles.push(...ailOnly);
    }

    removedAilFiles.sort();

    return {
      mode: "side-by-side",
      restoredFiles: [],
      removedAilFiles,
      unlockedTargets,
      shieldRemoved: shieldRes.removedFiles,
      shieldReverted: shieldRes.revertedFiles,
    };
  }
}

export const eject = ejectProject;
