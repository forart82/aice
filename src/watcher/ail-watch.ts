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
  resolveSourceFile,
  resolveTargetOutputPathForConfig,
} from "../config/index.js";
import { invalidateCachedFile, parseCached } from "../cache/index.js";
import { parse } from "../core/parser.js";
import { AilGenerator, decompile } from "../decompiler/index.js";
import {
  detectTargetFromPath,
  emitTarget,
  getTargetOutputPath,
  type TargetLanguage,
} from "../emitters/index.js";
import {
  collapseModuleIdioms,
  expandModuleIdioms,
  type ProjectIdiomDefinition,
} from "../idioms/index.js";
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
  bidirectional?: boolean; // Watch target files and sync external changes back to .ail
  onCompileStart?: (ailFile: string) => void;
  onCompileSuccess?: (ailFile: string, targetFile: string, durationMs: number) => void;
  onCompileError?: (ailFile: string, error: Error) => void;
  onFileDeleted?: (ailFile: string, targetFile: string) => void;
  onReverseSyncSuccess?: (targetFile: string, ailFile: string, durationMs: number) => void;
  onReverseSyncError?: (targetFile: string, error: Error) => void;
}

export interface ReverseSyncResult {
  targetFile: string;
  ailFile: string;
  success: boolean;
  collapsedIdioms: number;
  durationMs: number;
  error?: Error;
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
  public config: AilProjectConfig;
  private readonly debounceMs: number;
  public readonly lockTargets: boolean;
  private readonly recursive: boolean;
  private readonly ignorePatterns: string[];
  private lastConfigMtime = 0;

  private _isWatching = false;
  private _totalCompiles = 0;
  private _successfulCompiles = 0;
  private _failedCompiles = 0;
  private _lastCompileDurationMs = 0;

  private debounceTimers = new Map<string, NodeJS.Timeout>();
  private fsWatchers: fs.FSWatcher[] = [];
  private watchedDirs = new Set<string>();
  private recentTargetWrites = new Map<string, number>();
  private recentAilWrites = new Map<string, number>();

  constructor(options: AilWatchOptions) {
    this.options = { ...options };
    this.watchedDir = path.resolve(options.dir);
    this.projectRoot = path.resolve(options.projectRoot ?? options.dir);
    this.config = options.config ?? loadProjectConfig(this.projectRoot);
    try {
      const configPath = path.join(this.projectRoot, "ail.config.json");
      if (fs.existsSync(configPath)) {
        this.lastConfigMtime = fs.statSync(configPath).mtimeMs;
      }
    } catch {
      // Ignore initial config stat errors
    }
    this.debounceMs = options.debounceMs ?? 50;
    const defaultLock = this.config.mode === "companion" ? false : true;
    this.lockTargets = options.lockTargets ?? defaultLock;
    this.recursive = options.recursive ?? true;

    const baseIgnores = options.ignorePatterns ?? ["node_modules", ".git", "dist", "build"];
    const outDirIgnores: string[] = [];
    if (!this.options.bidirectional) {
      if (this.config.mode !== "companion" && this.config.outDir) {
        outDirIgnores.push(path.basename(this.config.outDir), this.config.outDir);
      } else if (!this.config.outDir) {
        outDirIgnores.push(".ail-build");
      }
    }
    this.ignorePatterns = Array.from(new Set([...baseIgnores, ...outDirIgnores]));
  }

  private recordTargetWrite(targetPath: string): void {
    const now = Date.now();
    for (const [p, ts] of this.recentTargetWrites.entries()) {
      if (now - ts > 2000) {
        this.recentTargetWrites.delete(p);
      }
    }
    this.recentTargetWrites.set(path.resolve(targetPath), now);
  }

  private recordAilWrite(ailPath: string): void {
    const now = Date.now();
    for (const [p, ts] of this.recentAilWrites.entries()) {
      if (now - ts > 2000) {
        this.recentAilWrites.delete(p);
      }
    }
    this.recentAilWrites.set(path.resolve(ailPath), now);
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

      if (baseName === "ail.config.json" || fullPath.endsWith("ail.config.json")) {
        try {
          const configPath = path.join(this.projectRoot, "ail.config.json");
          if (fs.existsSync(configPath)) {
            this.lastConfigMtime = fs.statSync(configPath).mtimeMs;
          }
          this.config = loadProjectConfig(this.projectRoot);
        } catch {
          // Ignore config reload errors
        }
        return;
      }

      if (baseName.startsWith(".") || baseName.endsWith("~") || baseName.endsWith(".tmp")) {
        return;
      }

      if (fullPath.endsWith(".ail")) {
        const lastAilWrite = this.recentAilWrites.get(fullPath);
        if (lastAilWrite && Date.now() - lastAilWrite < 750) {
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
            if (this.config.mode === "companion") {
              try {
                if (fs.existsSync(targetPath)) {
                  if (isTargetLocked(targetPath)) {
                    unlockFile(targetPath);
                  }
                  fs.unlinkSync(targetPath);
                }
              } catch {
                // Ignore target deletion errors
              }
            }
            invalidateCachedFile(fullPath);
            this.options.onFileDeleted?.(fullPath, targetPath);
            return;
          }

          await this.compileFile(fullPath);
        }, this.debounceMs);

        this.debounceTimers.set(fullPath, timer);
        return;
      }

      // If bidirectional watching is enabled, handle target file changes
      if (this.options.bidirectional) {
        const ext = path.extname(fullPath).toLowerCase();
        if (KNOWN_TARGET_EXTENSIONS.has(ext)) {
          const lastTargetWrite = this.recentTargetWrites.get(fullPath);
          if (lastTargetWrite && Date.now() - lastTargetWrite < 750) {
            return;
          }

          const existingTimer = this.debounceTimers.get(fullPath);
          if (existingTimer) {
            clearTimeout(existingTimer);
          }

          const timer = setTimeout(async () => {
            this.debounceTimers.delete(fullPath);
            if (!this._isWatching || !fs.existsSync(fullPath)) {
              return;
            }

            await this.syncTargetFile(fullPath);
          }, this.debounceMs);

          this.debounceTimers.set(fullPath, timer);
          return;
        }
      }
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

    if (this.options.bidirectional) {
      const targetDirCandidate = this.config.targetProjectDir
        ? path.isAbsolute(this.config.targetProjectDir)
          ? this.config.targetProjectDir
          : path.resolve(this.projectRoot, this.config.targetProjectDir)
        : this.config.outDir
          ? path.isAbsolute(this.config.outDir)
            ? this.config.outDir
            : path.resolve(this.projectRoot, this.config.outDir)
          : undefined;

      if (
        targetDirCandidate &&
        fs.existsSync(targetDirCandidate) &&
        path.resolve(targetDirCandidate) !== this.watchedDir
      ) {
        if (this.recursive) {
          try {
            const watcher = fs.watch(
              targetDirCandidate,
              { recursive: true },
              (_eventType, filename) => {
                handleFsEvent(filename, targetDirCandidate);
              },
            );
            watcher.on("error", () => {});
            this.fsWatchers.push(watcher);
          } catch {
            this.watchDirectoryRecursive(targetDirCandidate, (filename, baseDir) => {
              handleFsEvent(filename, baseDir ?? targetDirCandidate);
            });
          }
        } else {
          const watcher = fs.watch(
            targetDirCandidate,
            { recursive: false },
            (_eventType, filename) => {
              handleFsEvent(filename, targetDirCandidate);
            },
          );
          watcher.on("error", () => {});
          this.fsWatchers.push(watcher);
        }
      }
    }
  }

  private watchDirectoryRecursive(
    dir: string,
    handler: (filename: string | null, baseDir?: string) => void,
  ): void {
    const resolvedDir = path.resolve(dir);
    if (this.watchedDirs.has(resolvedDir)) return;
    this.watchedDirs.add(resolvedDir);

    try {
      const watcher = fs.watch(resolvedDir, { recursive: false }, (_eventType, filename) => {
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
    const configFilePath = path.join(this.projectRoot, "ail.config.json");
    try {
      if (fs.existsSync(configFilePath)) {
        const stat = fs.statSync(configFilePath);
        if (stat.mtimeMs > this.lastConfigMtime) {
          this.lastConfigMtime = stat.mtimeMs;
          this.config = loadProjectConfig(this.projectRoot);
        }
      }
    } catch {
      // Ignore stat errors
    }

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
      const mod = parseCached(content, resolvedAilPath);
      const expandedMod = this.config.idioms ? expandModuleIdioms(mod, this.config.idioms) : mod;
      if (this.config.mode !== "companion") {
        const checker = new TypeChecker();
        checker.checkModule(expandedMod);
      }

      let targetLang: TargetLanguage;
      const base = path.basename(resolvedAilPath);
      const withoutAil = base.endsWith(".ail") ? base.slice(0, -4) : base;
      const innerExt = path.extname(withoutAil).toLowerCase();
      if (innerExt && KNOWN_TARGET_EXTENSIONS.has(innerExt)) {
        targetLang = detectTargetFromPath(resolvedAilPath);
      } else {
        targetLang = this.config.targetLanguage ?? detectTargetFromPath(resolvedAilPath);
      }

      const emitted = emitTarget(expandedMod, targetLang, {
        watermark: this.config.watermark,
        idioms: this.config.idioms,
      });
      const targetPath = derivedTargetPath;

      const targetDir = path.dirname(targetPath);
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }

      if (this.lockTargets) {
        this.recordTargetWrite(targetPath);
        safeWriteTargetFile(targetPath, emitted);
        this.recordTargetWrite(targetPath);
        if (!isTargetLocked(targetPath)) {
          lockFile(targetPath);
        }
      } else {
        if (fs.existsSync(targetPath) && isTargetLocked(targetPath)) {
          unlockFile(targetPath);
        }
        this.recordTargetWrite(targetPath);
        safeWriteTargetFile(targetPath, emitted);
        this.recordTargetWrite(targetPath);
        if (isTargetLocked(targetPath)) {
          unlockFile(targetPath);
        }
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

  async syncTargetFile(
    targetFilePath: string,
    options?: { force?: boolean },
  ): Promise<ReverseSyncResult> {
    const absTarget = path.resolve(targetFilePath);
    const start = performance.now();

    // Reload config if modified
    const configFilePath = path.join(this.projectRoot, "ail.config.json");
    try {
      if (fs.existsSync(configFilePath)) {
        const stat = fs.statSync(configFilePath);
        if (stat.mtimeMs > this.lastConfigMtime) {
          this.lastConfigMtime = stat.mtimeMs;
          this.config = loadProjectConfig(this.projectRoot);
        }
      }
    } catch {
      // Ignore stat errors
    }

    // Determine corresponding .ail source path
    let ailPath = resolveSourceFile(this.config, absTarget, this.projectRoot);
    const dualCandidate = `${absTarget}.ail`;
    const bareCandidate = absTarget.replace(/\.[^.]+$/, ".ail");

    if (fs.existsSync(dualCandidate)) {
      ailPath = dualCandidate;
    } else if (fs.existsSync(bareCandidate)) {
      ailPath = bareCandidate;
    }

    const resolvedAilPath = path.resolve(ailPath);

    const lastTargetWrite = this.recentTargetWrites.get(absTarget);
    if (!options?.force && lastTargetWrite && Date.now() - lastTargetWrite < 750) {
      return {
        targetFile: absTarget,
        ailFile: resolvedAilPath,
        success: true,
        collapsedIdioms: 0,
        durationMs: Math.max(0, performance.now() - start),
      };
    }

    try {
      if (!fs.existsSync(absTarget)) {
        throw new Error(`Target file not found: ${absTarget}`);
      }

      const targetLang = detectTargetFromPath(absTarget);
      const targetSource = await fs.promises.readFile(absTarget, "utf-8");
      const decompiled = decompile(targetSource, targetLang, { filePath: absTarget });

      let ailSource = decompiled.ail;
      let collapsedCount = 0;

      if (this.config.idioms && Object.keys(this.config.idioms).length > 0) {
        const normalizedIdioms: Record<string, ProjectIdiomDefinition> = {};
        for (const [k, v] of Object.entries(this.config.idioms)) {
          const idiomName = v.name.startsWith("$") ? v.name : `$${v.name}`;
          normalizedIdioms[k] = { ...v, name: idiomName };
        }
        const collapsed = collapseModuleIdioms(decompiled.ast, normalizedIdioms);
        collapsedCount = collapsed.collapsedCount;
        if (collapsedCount > 0) {
          ailSource = new AilGenerator({ trivia: decompiled.trivia }).generate(collapsed.ast);
        }
      }

      // Check if existing .ail file already has identical content
      if (fs.existsSync(resolvedAilPath)) {
        const existingAil = await fs.promises.readFile(resolvedAilPath, "utf-8");
        if (existingAil === ailSource) {
          const durationMs = Math.max(0, performance.now() - start);
          return {
            targetFile: absTarget,
            ailFile: resolvedAilPath,
            success: true,
            collapsedIdioms: collapsedCount,
            durationMs,
          };
        }
      }

      this.recordAilWrite(resolvedAilPath);

      const ailDir = path.dirname(resolvedAilPath);
      if (!fs.existsSync(ailDir)) {
        fs.mkdirSync(ailDir, { recursive: true });
      }

      await fs.promises.writeFile(resolvedAilPath, ailSource, "utf-8");
      this.recordAilWrite(resolvedAilPath);
      invalidateCachedFile(resolvedAilPath);

      const durationMs = Math.max(0, performance.now() - start);
      this.options.onReverseSyncSuccess?.(absTarget, resolvedAilPath, durationMs);

      return {
        targetFile: absTarget,
        ailFile: resolvedAilPath,
        success: true,
        collapsedIdioms: collapsedCount,
        durationMs,
      };
    } catch (err: unknown) {
      const durationMs = Math.max(0, performance.now() - start);
      const error = err instanceof Error ? err : new Error(String(err));
      this.options.onReverseSyncError?.(absTarget, error);
      return {
        targetFile: absTarget,
        ailFile: ailPath,
        success: false,
        collapsedIdioms: 0,
        durationMs,
        error,
      };
    }
  }

  async syncAllFromTargets(options?: { force?: boolean }): Promise<ReverseSyncResult[]> {
    const results: ReverseSyncResult[] = [];
    const force = options?.force ?? false;

    const findTargetFiles = (dir: string): string[] => {
      const files: string[] = [];
      if (!fs.existsSync(dir)) return files;
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.resolve(dir, entry.name);
          const relPath = path.relative(this.watchedDir, fullPath);
          if (shouldIgnore(entry.name, relPath, this.ignorePatterns)) continue;
          if (entry.isDirectory()) {
            files.push(...findTargetFiles(fullPath));
          } else if (entry.isFile()) {
            const ext = path.extname(entry.name).toLowerCase();
            if (KNOWN_TARGET_EXTENSIONS.has(ext)) {
              files.push(fullPath);
            }
          }
        }
      } catch {
        // Ignore read errors
      }
      return files;
    };

    const findAilFiles = (dir: string): string[] => {
      const files: string[] = [];
      if (!fs.existsSync(dir)) return files;
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.resolve(dir, entry.name);
          const relPath = path.relative(this.watchedDir, fullPath);
          if (shouldIgnore(entry.name, relPath, this.ignorePatterns)) continue;
          if (entry.isDirectory()) {
            files.push(...findAilFiles(fullPath));
          } else if (entry.isFile() && entry.name.endsWith(".ail")) {
            files.push(fullPath);
          }
        }
      } catch {
        // Ignore read errors
      }
      return files;
    };

    const targetDirs = new Set<string>();
    targetDirs.add(this.watchedDir);
    if (this.config.targetProjectDir) {
      const tDir = path.isAbsolute(this.config.targetProjectDir)
        ? this.config.targetProjectDir
        : path.resolve(this.projectRoot, this.config.targetProjectDir);
      targetDirs.add(tDir);
    }
    if (this.config.outDir) {
      const oDir = path.isAbsolute(this.config.outDir)
        ? this.config.outDir
        : path.resolve(this.projectRoot, this.config.outDir);
      targetDirs.add(oDir);
    }

    const targetFilesToSync = new Set<string>();

    for (const dir of targetDirs) {
      const targets = findTargetFiles(dir);
      for (const t of targets) {
        targetFilesToSync.add(t);
      }
    }

    const ailFiles = findAilFiles(this.watchedDir);
    for (const ailFile of ailFiles) {
      const derivedTarget = resolveTargetOutputPathForConfig(
        ailFile,
        this.config,
        this.projectRoot,
      );
      if (fs.existsSync(derivedTarget)) {
        targetFilesToSync.add(derivedTarget);
      }
    }

    for (const targetFile of targetFilesToSync) {
      let ailFile = resolveSourceFile(this.config, targetFile, this.projectRoot);
      const dualCandidate = `${targetFile}.ail`;
      const bareCandidate = targetFile.replace(/\.[^.]+$/, ".ail");
      if (fs.existsSync(dualCandidate) && !fs.existsSync(ailFile)) {
        ailFile = dualCandidate;
      } else if (fs.existsSync(bareCandidate) && !fs.existsSync(ailFile)) {
        ailFile = bareCandidate;
      }

      let shouldSync = force;
      if (!shouldSync) {
        if (!fs.existsSync(ailFile)) {
          shouldSync = true;
        } else {
          try {
            const targetMtime = fs.statSync(targetFile).mtimeMs;
            const ailMtime = fs.statSync(ailFile).mtimeMs;
            if (targetMtime >= ailMtime) {
              shouldSync = true;
            }
          } catch {
            shouldSync = true;
          }
        }
      }

      if (shouldSync) {
        const res = await this.syncTargetFile(targetFile);
        results.push(res);
      }
    }

    return results;
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
    this.watchedDirs.clear();
    this.recentTargetWrites.clear();
    this.recentAilWrites.clear();
  }
}

export async function syncProjectFromTargets(
  dir: string,
  options?: { collapseIdioms?: boolean },
): Promise<ReverseSyncResult[]> {
  const resolvedDir = path.resolve(dir);
  const projectRoot = findProjectRoot(resolvedDir);
  const config = loadProjectConfig(projectRoot);
  const watcher = new AilWatcher({
    dir: resolvedDir,
    projectRoot,
    config,
    bidirectional: true,
  });
  return watcher.syncAllFromTargets({ force: true });
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
    lockTargets: options?.lockTargets,
    onCompileStart: options?.onCompileStart,
    onCompileSuccess: options?.onCompileSuccess,
    onCompileError: options?.onCompileError,
  });
  return watcher.compileFile(resolvedAilPath);
}
