/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * AIL 2.0 High-Speed Incremental Watch Daemon (Step 6).
 * Background daemon that monitors *.ail source files, performs sub-5ms incremental
 * recompilation into side-by-side target files, atomically unlocks & relocks
 * chmod 444 targets, and preserves dev server Hot Module Reloading (HMR).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import {
  type AilProjectConfig,
  findProjectRoot,
  KNOWN_TARGET_EXTENSIONS,
  loadProjectConfig,
  resolveTargetOutputPathForConfig,
} from "../config/index.js";
import { parse } from "../core/parser.js";
import {
  detectTargetFromPath,
  emitTarget,
  getTargetOutputPath,
  type TargetLanguage,
} from "../emitters/index.js";
import { isTargetLocked, lockFile, unlockFile, withUnlockedTarget } from "../shield/fs-lock.js";
import { safeWriteTargetFile } from "../shield/index.js";
import { TypeChecker } from "../typechecker/checker.js";

export interface AilWatchOptions {
  dir: string;
  config?: AilProjectConfig;
  projectRoot?: string;
  debounceMs?: number; // default 50ms
  lockTargets?: boolean; // default true (relock to 0o444)
  recursive?: boolean; // default true
  ignorePatterns?: string[]; // default ["node_modules", ".git", "dist", "build"]
  onCompileStart?: (ailFile: string) => void;
  onCompileSuccess?: (ailFile: string, targetFile: string, durationMs: number) => void;
  onCompileError?: (ailFile: string, error: Error) => void;
  onFileDeleted?: (ailFile: string, targetFile: string) => void;
}

export interface CompileFileResult {
  ailFile: string;
  targetFile: string;
  success: boolean;
  durationMs: number;
  error?: Error;
}

export interface WatcherStats {
  isWatching: boolean;
  totalCompiles: number;
  successfulCompiles: number;
  failedCompiles: number;
  lastCompileDurationMs: number;
  watchedDir: string;
}

function shouldIgnore(name: string, relPath: string, ignorePatterns: string[]): boolean {
  const normalizedRel = relPath.replace(/\\/g, "/");
  const segments = normalizedRel.split("/").filter(Boolean);

  for (const pattern of ignorePatterns) {
    const cleanPattern = pattern.replace(/^\/+/, "").replace(/\/+$/, "");

    if (name === pattern || name === cleanPattern) {
      return true;
    }

    if (segments.includes(pattern) || segments.includes(cleanPattern)) {
      return true;
    }

    if (
      normalizedRel === pattern ||
      normalizedRel === cleanPattern ||
      normalizedRel.startsWith(`${cleanPattern}/`) ||
      normalizedRel.endsWith(`/${cleanPattern}`)
    ) {
      return true;
    }

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

export class AilWatcher {
  private readonly options: AilWatchOptions;
  private readonly watchedDir: string;
  public readonly projectRoot: string;
  public readonly config: AilProjectConfig;
  private readonly debounceMs: number;
  private readonly lockTargets: boolean;
  private readonly recursive: boolean;
  private readonly ignorePatterns: string[];

  private _isWatching = false;
  private _totalCompiles = 0;
  private _successfulCompiles = 0;
  private _failedCompiles = 0;
  private _lastCompileDurationMs = 0;

  private debounceTimers = new Map<string, NodeJS.Timeout>();
  private fsWatchers: fs.FSWatcher[] = [];

  constructor(options: AilWatchOptions) {
    this.options = { ...options };
    this.watchedDir = path.resolve(options.dir);
    this.projectRoot = path.resolve(options.projectRoot ?? options.dir);
    this.config = options.config ?? loadProjectConfig(this.projectRoot);
    this.debounceMs = options.debounceMs ?? 50;
    this.lockTargets = options.lockTargets ?? true;
    this.recursive = options.recursive ?? true;

    const baseIgnores = options.ignorePatterns ?? ["node_modules", ".git", "dist", "build"];
    const outDirName = this.config.outDir ? path.basename(this.config.outDir) : ".ail-build";
    const outDirRel = this.config.outDir ?? ".ail-build";
    this.ignorePatterns = Array.from(new Set([...baseIgnores, outDirName, outDirRel]));
  }

  isWatching(): boolean {
    return this._isWatching;
  }

  getStats(): WatcherStats {
    return {
      isWatching: this._isWatching,
      totalCompiles: this._totalCompiles,
      successfulCompiles: this._successfulCompiles,
      failedCompiles: this._failedCompiles,
      lastCompileDurationMs: this._lastCompileDurationMs,
      watchedDir: this.options.dir,
    };
  }

  async start(): Promise<void> {
    if (this._isWatching) {
      return;
    }

    if (!fs.existsSync(this.watchedDir)) {
      throw new Error(`Directory not found: ${this.options.dir}`);
    }

    this._isWatching = true;

    const handleFsEvent = (filename: string | null, baseDir = this.watchedDir) => {
      if (!this._isWatching || !filename) {
        return;
      }

      const fullPath = path.isAbsolute(filename) ? filename : path.resolve(baseDir, filename);

      const relPath = path.relative(this.watchedDir, fullPath);
      const baseName = path.basename(fullPath);

      if (shouldIgnore(baseName, relPath, this.ignorePatterns)) {
        return;
      }

      if (
        baseName.startsWith(".") ||
        baseName.endsWith("~") ||
        baseName.endsWith(".tmp") ||
        !fullPath.endsWith(".ail")
      ) {
        return;
      }

      const existingTimer = this.debounceTimers.get(fullPath);
      if (existingTimer) {
        clearTimeout(existingTimer);
      }

      const timer = setTimeout(async () => {
        this.debounceTimers.delete(fullPath);
        if (!this._isWatching) {
          return;
        }

        if (!fs.existsSync(fullPath)) {
          const targetPath = resolveTargetOutputPathForConfig(
            fullPath,
            this.config,
            this.projectRoot,
          );
          this.options.onFileDeleted?.(fullPath, targetPath);
          return;
        }

        await this.compileFile(fullPath);
      }, this.debounceMs);

      this.debounceTimers.set(fullPath, timer);
    };

    if (this.recursive) {
      try {
        const watcher = fs.watch(this.watchedDir, { recursive: true }, (_eventType, filename) => {
          handleFsEvent(filename);
        });
        watcher.on("error", () => {});
        this.fsWatchers.push(watcher);
      } catch {
        this.watchDirectoryRecursive(this.watchedDir, handleFsEvent);
      }
    } else {
      const watcher = fs.watch(this.watchedDir, { recursive: false }, (_eventType, filename) => {
        handleFsEvent(filename);
      });
      watcher.on("error", () => {});
      this.fsWatchers.push(watcher);
    }
  }

  private watchDirectoryRecursive(
    dir: string,
    handler: (filename: string | null, baseDir?: string) => void,
  ): void {
    try {
      const watcher = fs.watch(dir, { recursive: false }, (_eventType, filename) => {
        if (filename) {
          const full = path.resolve(dir, filename);
          try {
            if (fs.existsSync(full) && fs.statSync(full).isDirectory()) {
              const rel = path.relative(this.watchedDir, full);
              if (!shouldIgnore(path.basename(full), rel, this.ignorePatterns)) {
                this.watchDirectoryRecursive(full, handler);
              }
            }
          } catch {
            // Ignore stat errors
          }
          handler(filename, dir);
        }
      });
      watcher.on("error", () => {});
      this.fsWatchers.push(watcher);

      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const fullPath = path.resolve(dir, entry.name);
          const relPath = path.relative(this.watchedDir, fullPath);
          if (!shouldIgnore(entry.name, relPath, this.ignorePatterns)) {
            this.watchDirectoryRecursive(fullPath, handler);
          }
        }
      }
    } catch {
      // Ignore directory access errors
    }
  }

  async compileFile(ailPath: string): Promise<CompileFileResult> {
    const resolvedAilPath = path.resolve(ailPath);
    const start = performance.now();
    this.options.onCompileStart?.(resolvedAilPath);
    this._totalCompiles++;

    const derivedTargetPath = resolveTargetOutputPathForConfig(
      resolvedAilPath,
      this.config,
      this.projectRoot,
    );

    try {
      const content = await fs.promises.readFile(resolvedAilPath, "utf-8");
      const mod = parse(content, resolvedAilPath);
      const checker = new TypeChecker();
      checker.checkModule(mod);

      let targetLang: TargetLanguage;
      const base = path.basename(resolvedAilPath);
      const withoutAil = base.endsWith(".ail") ? base.slice(0, -4) : base;
      const innerExt = path.extname(withoutAil).toLowerCase();
      if (innerExt && KNOWN_TARGET_EXTENSIONS.has(innerExt)) {
        targetLang = detectTargetFromPath(resolvedAilPath);
      } else {
        targetLang = this.config.targetLanguage ?? detectTargetFromPath(resolvedAilPath);
      }

      const emitted = emitTarget(mod, targetLang, {
        watermark: this.config.watermark,
      });
      const targetPath = derivedTargetPath;

      const targetDir = path.dirname(targetPath);
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }

      if (this.lockTargets) {
        safeWriteTargetFile(targetPath, emitted);
        if (!isTargetLocked(targetPath)) {
          lockFile(targetPath);
        }
      } else {
        if (fs.existsSync(targetPath) && isTargetLocked(targetPath)) {
          unlockFile(targetPath);
        }
        safeWriteTargetFile(targetPath, emitted);
      }

      const durationMs = Math.max(0, performance.now() - start);
      this._successfulCompiles++;
      this._lastCompileDurationMs = durationMs;
      this.options.onCompileSuccess?.(resolvedAilPath, targetPath, durationMs);

      return {
        ailFile: resolvedAilPath,
        targetFile: targetPath,
        success: true,
        durationMs,
      };
    } catch (err: unknown) {
      const durationMs = Math.max(0, performance.now() - start);
      this._failedCompiles++;
      this._lastCompileDurationMs = durationMs;
      const error = err instanceof Error ? err : new Error(String(err));
      this.options.onCompileError?.(resolvedAilPath, error);

      return {
        ailFile: resolvedAilPath,
        targetFile: derivedTargetPath,
        success: false,
        durationMs,
        error,
      };
    }
  }

  async stop(): Promise<void> {
    this._isWatching = false;

    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();

    for (const watcher of this.fsWatchers) {
      try {
        watcher.close();
      } catch {
        // Ignore close errors
      }
    }
    this.fsWatchers = [];
  }
}

export async function watchProject(
  dir: string,
  options?: Partial<AilWatchOptions>,
): Promise<AilWatcher> {
  const resolvedDir = path.resolve(dir);
  const projectRoot = options?.projectRoot ?? findProjectRoot(resolvedDir);
  const config = options?.config ?? loadProjectConfig(projectRoot);
  const watcher = new AilWatcher({
    ...options,
    dir: resolvedDir,
    projectRoot,
    config,
  });
  await watcher.start();
  return watcher;
}

export interface RecompileSingleFileOptions {
  projectRoot?: string;
  dir?: string;
  config?: AilProjectConfig;
  lockTargets?: boolean;
  onCompileStart?: (ailFile: string) => void;
  onCompileSuccess?: (ailFile: string, targetFile: string, durationMs: number) => void;
  onCompileError?: (ailFile: string, error: Error) => void;
}

export async function recompileSingleFile(
  ailPath: string,
  options?: RecompileSingleFileOptions,
): Promise<CompileFileResult> {
  const resolvedAilPath = path.resolve(ailPath);
  const projectRoot =
    options?.projectRoot ?? options?.dir ?? findProjectRoot(path.dirname(resolvedAilPath));
  const config = options?.config ?? loadProjectConfig(projectRoot);
  const watcher = new AilWatcher({
    dir: projectRoot,
    projectRoot,
    config,
    lockTargets: options?.lockTargets ?? true,
    onCompileStart: options?.onCompileStart,
    onCompileSuccess: options?.onCompileSuccess,
    onCompileError: options?.onCompileError,
  });
  return watcher.compileFile(resolvedAilPath);
}
