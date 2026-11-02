/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Content-Addressed In-Memory and Disk AST & Module Cache.
 * Provides SHA-256 content-addressed caching for parsed ASTs and modules,
 * disk persistence (.ail-cache/ast-cache.json), cache invalidation, and telemetry.
 */

import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import type { Module } from "../core/ast.js";
import { parse } from "../core/parser.js";

export interface AstCacheEntry {
  hash: string;
  filePath: string;
  updatedAt: number;
  ast: Module;
}

export interface ParseCachedOptions {
  clone?: boolean; // default true: returns a clone to protect cache from mutations
  bypassCache?: boolean; // default false
}

export interface AstCacheStats {
  size: number;
  entries: number;
  hits: number;
  misses: number;
  hitRate: number;
}

export interface DiskAstCacheFile {
  version: number;
  entries: Record<string, AstCacheEntry>;
}

export function computeSourceHash(source: string): string {
  return createHash("sha256").update(source, "utf-8").digest("hex");
}

function resolveCacheFilePath(projectRootOrFile: string): string {
  const resolved = path.resolve(projectRootOrFile);
  if (resolved.endsWith(".json")) {
    return resolved;
  }
  if (path.basename(resolved) === ".ail-cache") {
    return path.join(resolved, "ast-cache.json");
  }
  return path.join(resolved, ".ail-cache", "ast-cache.json");
}

export class AilAstCache {
  private readonly maxEntries: number;
  private entries = new Map<string, AstCacheEntry>();
  private fileToKeys = new Map<string, Set<string>>();
  private hits = 0;
  private misses = 0;

  constructor(maxEntries = 500) {
    this.maxEntries = maxEntries;
  }

  private makeKey(filePath: string, hash: string): string {
    return `${filePath}::${hash}`;
  }

  private normalizeFilePath(filePath?: string): string {
    if (!filePath || filePath === "<anonymous>") return "<anonymous>";
    return path.resolve(filePath);
  }

  public parseCached(
    source: string,
    filePath?: string,
    options?: ParseCachedOptions,
  ): Module {
    const hash = computeSourceHash(source);
    const normalizedPath = this.normalizeFilePath(filePath);
    const key = this.makeKey(normalizedPath, hash);

    if (!options?.bypassCache && this.entries.has(key)) {
      this.hits++;
      const cached = this.entries.get(key)!;
      return options?.clone === false ? cached.ast : structuredClone(cached.ast);
    }

    this.misses++;
    const ast = parse(source, filePath ?? "<anonymous>");
    const entry: AstCacheEntry = {
      hash,
      filePath: normalizedPath,
      updatedAt: Date.now(),
      ast,
    };

    if (!options?.bypassCache) {
      if (normalizedPath !== "<anonymous>") {
        const existingKeys = this.fileToKeys.get(normalizedPath);
        if (existingKeys) {
          for (const oldKey of existingKeys) {
            this.entries.delete(oldKey);
          }
          existingKeys.clear();
        }
      }

      while (this.entries.size >= this.maxEntries) {
        const oldestKey = this.entries.keys().next().value;
        if (!oldestKey) break;
        const oldEntry = this.entries.get(oldestKey);
        this.entries.delete(oldestKey);
        if (oldEntry) {
          const keys = this.fileToKeys.get(oldEntry.filePath);
          if (keys) {
            keys.delete(oldestKey);
            if (keys.size === 0) {
              this.fileToKeys.delete(oldEntry.filePath);
            }
          }
        }
      }

      this.entries.set(key, entry);
      let keySet = this.fileToKeys.get(normalizedPath);
      if (!keySet) {
        keySet = new Set<string>();
        this.fileToKeys.set(normalizedPath, keySet);
      }
      keySet.add(key);
    }

    return options?.clone === false ? ast : structuredClone(ast);
  }

  public hasCached(source: string, filePath?: string): boolean {
    const hash = computeSourceHash(source);
    const normalizedPath = this.normalizeFilePath(filePath);
    const key = this.makeKey(normalizedPath, hash);
    return this.entries.has(key);
  }

  public invalidateCachedFile(filePath: string): boolean {
    const normalizedPath = this.normalizeFilePath(filePath);
    let removed = false;

    const keys = this.fileToKeys.get(normalizedPath);
    if (keys) {
      for (const k of keys) {
        if (this.entries.delete(k)) {
          removed = true;
        }
      }
      this.fileToKeys.delete(normalizedPath);
    }

    if (filePath && filePath !== normalizedPath) {
      const rawKeys = this.fileToKeys.get(filePath);
      if (rawKeys) {
        for (const k of rawKeys) {
          if (this.entries.delete(k)) {
            removed = true;
          }
        }
        this.fileToKeys.delete(filePath);
      }
    }

    return removed;
  }

  public clearAstCache(persistDir?: string): void {
    this.entries.clear();
    this.fileToKeys.clear();
    this.hits = 0;
    this.misses = 0;

    if (persistDir) {
      const cachePath = resolveCacheFilePath(persistDir);
      try {
        if (fs.existsSync(cachePath)) {
          fs.unlinkSync(cachePath);
        }
      } catch {
        // ignore disk deletion errors
      }
    }
  }

  public getAstCacheStats(): AstCacheStats {
    const total = this.hits + this.misses;
    return {
      size: this.entries.size,
      entries: this.entries.size,
      hits: this.hits,
      misses: this.misses,
      hitRate: total > 0 ? this.hits / total : 0,
    };
  }

  public saveAstCacheToDisk(projectRoot: string): string {
    const cachePath = resolveCacheFilePath(projectRoot);
    const cacheDir = path.dirname(cachePath);

    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
    }

    const payload: DiskAstCacheFile = {
      version: 1,
      entries: Object.fromEntries(this.entries.entries()),
    };

    const tmpPath = `${cachePath}.tmp.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;
    try {
      fs.writeFileSync(tmpPath, JSON.stringify(payload, null, 2), "utf-8");
      fs.renameSync(tmpPath, cachePath);
    } catch (err) {
      try {
        if (fs.existsSync(tmpPath)) {
          fs.unlinkSync(tmpPath);
        }
      } catch {
        // ignore disk deletion errors
      }
      throw err;
    }

    return cachePath;
  }

  public loadAstCacheFromDisk(projectRoot: string): number {
    const cachePath = resolveCacheFilePath(projectRoot);
    if (!fs.existsSync(cachePath)) {
      return 0;
    }

    try {
      const raw = fs.readFileSync(cachePath, "utf-8");
      const data: DiskAstCacheFile = JSON.parse(raw);
      if (!data || typeof data !== "object" || !data.entries) {
        return 0;
      }

      let count = 0;
      for (const [key, entry] of Object.entries(data.entries)) {
        if (entry && entry.hash && entry.ast) {
          this.entries.set(key, entry);
          const normalizedPath = this.normalizeFilePath(entry.filePath);
          let keySet = this.fileToKeys.get(normalizedPath);
          if (!keySet) {
            keySet = new Set<string>();
            this.fileToKeys.set(normalizedPath, keySet);
          }
          keySet.add(key);
          count++;
        }
      }
      return count;
    } catch {
      return 0;
    }
  }
}

const defaultCache = new AilAstCache();

export function parseCached(
  source: string,
  filePath?: string,
  options?: ParseCachedOptions,
): Module {
  return defaultCache.parseCached(source, filePath, options);
}

export function hasCached(source: string, filePath?: string): boolean {
  return defaultCache.hasCached(source, filePath);
}

export function invalidateCachedFile(filePath: string): boolean {
  return defaultCache.invalidateCachedFile(filePath);
}

export function clearAstCache(persistDir?: string): void {
  defaultCache.clearAstCache(persistDir);
}

export function getAstCacheStats(): AstCacheStats {
  return defaultCache.getAstCacheStats();
}

export function saveAstCacheToDisk(projectRoot: string): string {
  return defaultCache.saveAstCacheToDisk(projectRoot);
}

export function loadAstCacheFromDisk(projectRoot: string): number {
  return defaultCache.loadAstCacheFromDisk(projectRoot);
}

export { defaultCache as globalAstCache };
