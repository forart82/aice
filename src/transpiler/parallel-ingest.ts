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
import { decompile } from "../decompiler/index.js";
import { detectTargetFromPath, type TargetLanguage } from "../emitters/index.js";
import { ConcurrencyPool, type TaskItem } from "../runner/concurrency-pool.js";
import { MultiLineReporter } from "../runner/multi-line-reporter.js";

const cl100k = getEncoding("cl100k_base");

export interface IngestOptions {
  dir: string;
  concurrency?: number;
  showProgress?: boolean;
  reporter?: MultiLineReporter;
  overwrite?: boolean; // default false
  emitTrivia?: boolean; // default true
  dryRun?: boolean; // default false
  extensions?: string[]; // default [".ts", ".tsx", ".css", ".html"]
  ignorePatterns?: string[]; // default ["node_modules", ".git", "dist", "build"]
}

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
  status: "DECOMPILING";
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

  const extensions = (options?.extensions ?? [".ts", ".tsx", ".css", ".html"]).map((ext) =>
    ext.startsWith(".") ? ext.toLowerCase() : `.${ext.toLowerCase()}`,
  );
  const ignorePatterns = options?.ignorePatterns ?? ["node_modules", ".git", "dist", "build"];

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
        if (lowerName.endsWith(".ail") || lowerName.endsWith(".trivia.json")) {
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
 * (.ts, .tsx, .css, .html) into .ail files created SIDE-BY-SIDE in the exact
 * same directory, leveraging ConcurrencyPool and MultiLineReporter.
 */
export async function ingestProjectSideBySide(options: IngestOptions): Promise<IngestSummary> {
  const startTime = performance.now();
  const resolvedDir = path.resolve(options.dir);

  const discoveredFiles = findIngestableFiles(resolvedDir, options);
  const totalDiscovered = discoveredFiles.length;

  const overwrite = options.overwrite ?? false;
  const emitTrivia = options.emitTrivia ?? true;
  const dryRun = options.dryRun ?? false;
  const cpus = os.cpus?.().length ? os.cpus().length : 4;
  const concurrency = Math.max(1, Math.floor(options.concurrency ?? cpus));

  // Identify files needing ingestion
  const filesToIngest: string[] = [];
  let totalSkipped = 0;

  for (const filePath of discoveredFiles) {
    const ailPath = `${filePath}.ail`;
    if (!overwrite && fs.existsSync(ailPath)) {
      totalSkipped++;
    } else {
      filesToIngest.push(filePath);
    }
  }

  // Handle empty ingestion set
  if (filesToIngest.length === 0) {
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
    const targetLang = detectTargetFromPath(filePath);
    return {
      id: filePath,
      data: {
        filePath,
        targetLang,
        status: "DECOMPILING",
      },
      run: async (_workerId: number): Promise<FileIngestResult> => {
        const taskStart = performance.now();
        const ailPath = `${filePath}.ail`;
        const triviaPath = `${filePath}.ail.trivia.json`;

        const source = await fs.promises.readFile(filePath, "utf-8");
        const decomp = decompile(source, targetLang, { filePath });

        const targetChars = source.length;
        const ailChars = decomp.ail.length;
        const targetTokens = cl100k.encode(source).length;
        const ailTokens = cl100k.encode(decomp.ail).length;
        const cl100kSavingsPct =
          targetTokens > 0 ? ((targetTokens - ailTokens) / targetTokens) * 100 : 0;

        const hasTrivia = decomp.trivia.size() > 0;
        let emittedTriviaPath: string | undefined;

        if (!dryRun) {
          await fs.promises.writeFile(ailPath, decomp.ail, "utf-8");
          if (emitTrivia && hasTrivia) {
            await fs.promises.writeFile(
              triviaPath,
              `${JSON.stringify(decomp.trivia.toJSON(), null, 2)}\n`,
              "utf-8",
            );
            emittedTriviaPath = triviaPath;
          }
        } else if (emitTrivia && hasTrivia) {
          emittedTriviaPath = triviaPath;
        }

        const durationMs = Math.max(0, performance.now() - taskStart);

        return {
          sourcePath: filePath,
          ailPath,
          triviaPath: emittedTriviaPath,
          targetLang,
          success: true,
          targetChars,
          ailChars,
          targetTokens,
          ailTokens,
          cl100kSavingsPct,
          durationMs,
        };
      },
    };
  });

  const poolResults = await pool.runAll(tasks);

  const results: FileIngestResult[] = poolResults.map((taskRes) => {
    if (taskRes.success && taskRes.result) {
      return taskRes.result;
    }
    return {
      sourcePath: taskRes.task.data.filePath,
      ailPath: `${taskRes.task.data.filePath}.ail`,
      targetLang: taskRes.task.data.targetLang,
      success: false,
      error: taskRes.error ?? new Error("Task execution failed"),
      targetChars: 0,
      ailChars: 0,
      targetTokens: 0,
      ailTokens: 0,
      cl100kSavingsPct: 0,
      durationMs: taskRes.durationMs,
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
