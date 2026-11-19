/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Bounded LRU & file-stat-keyed caching primitives for long-running CLI & MCP sessions.
 * All caches enforce strict entry ceilings so resident memory stays bounded.
 */

import type * as fs from "node:fs";

export interface BoundedCacheStats {
  size: number;
  maxEntries: number;
  hits: number;
  misses: number;
  evictions: number;
}

/**
 * O(1) bounded LRU cache backed by JS Map insertion order.
 */
export class BoundedLruCache<K, V> {
  readonly maxEntries: number;
  private readonly map = new Map<K, V>();
  private hits = 0;
  private misses = 0;
  private evictions = 0;

  constructor(maxEntries: number) {
    this.maxEntries = Math.max(1, Math.floor(maxEntries));
  }

  get size(): number {
    return this.map.size;
  }

  has(key: K): boolean {
    return this.map.has(key);
  }

  peek(key: K): V | undefined {
    return this.map.get(key);
  }

  get(key: K): V | undefined {
    const val = this.map.get(key);
    if (val === undefined && !this.map.has(key)) {
      this.misses++;
      return undefined;
    }
    this.hits++;
    this.map.delete(key);
    this.map.set(key, val as V);
    return val;
  }

  set(key: K, value: V): void {
    if (this.map.has(key)) {
      this.map.delete(key);
    } else if (this.map.size >= this.maxEntries) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) {
        this.map.delete(oldest);
        this.evictions++;
      }
    }
    this.map.set(key, value);
  }

  delete(key: K): boolean {
    return this.map.delete(key);
  }

  clear(): void {
    this.map.clear();
  }

  getStats(): BoundedCacheStats {
    return {
      size: this.map.size,
      maxEntries: this.maxEntries,
      hits: this.hits,
      misses: this.misses,
      evictions: this.evictions,
    };
  }
}

/**
 * Two-generation bounded cache for ultra-hot read-heavy workloads (e.g., BPE piece counts).
 * Hot-tier hits perform zero Map mutations while strictly capping total resident entries at
 * `<= 2 * maxGenEntries`.
 */
export class TwoGenBoundedCache<K, V> {
  readonly maxGenEntries: number;
  private current = new Map<K, V>();
  private previous = new Map<K, V>();
  private hits = 0;
  private misses = 0;
  private rotations = 0;

  constructor(maxTotalEntries: number) {
    this.maxGenEntries = Math.max(1, Math.floor(maxTotalEntries / 2));
  }

  get maxEntries(): number {
    return this.maxGenEntries * 2;
  }

  get size(): number {
    return this.current.size + this.previous.size;
  }

  get(key: K): V | undefined {
    const cur = this.current.get(key);
    if (cur !== undefined) {
      this.hits++;
      return cur;
    }
    const prev = this.previous.get(key);
    if (prev !== undefined) {
      this.hits++;
      this.set(key, prev);
      return prev;
    }
    this.misses++;
    return undefined;
  }

  set(key: K, value: V): void {
    if (this.current.size >= this.maxGenEntries && !this.current.has(key)) {
      this.previous = this.current;
      this.current = new Map<K, V>();
      this.rotations++;
    }
    this.current.set(key, value);
  }

  clear(): void {
    this.current.clear();
    this.previous.clear();
  }

  getStats(): BoundedCacheStats {
    return {
      size: this.size,
      maxEntries: this.maxEntries,
      hits: this.hits,
      misses: this.misses,
      evictions: this.rotations,
    };
  }
}

export interface FileStatStamp {
  mtimeMs: number;
  ctimeMs: number;
  size: number;
  ino: number;
}

export function extractFileStatStamp(stat: fs.Stats): FileStatStamp {
  return {
    mtimeMs: stat.mtimeMs,
    ctimeMs: stat.ctimeMs,
    size: stat.size,
    ino: stat.ino,
  };
}

export function fileStatStampsEqual(a: FileStatStamp, b: FileStatStamp): boolean {
  return a.mtimeMs === b.mtimeMs && a.size === b.size && a.ctimeMs === b.ctimeMs && a.ino === b.ino;
}

interface StampedEntry<V> {
  stamp: FileStatStamp;
  value: V;
}

/**
 * Bounded LRU cache whose entries are automatically invalidated whenever the underlying
 * disk file's `mtimeMs`, `ctimeMs`, `size`, or `ino` changes.
 */
export class FileStatLruCache<V> {
  private readonly lru: BoundedLruCache<string, StampedEntry<V>>;

  constructor(maxEntries: number) {
    this.lru = new BoundedLruCache<string, StampedEntry<V>>(maxEntries);
  }

  get size(): number {
    return this.lru.size;
  }

  get maxEntries(): number {
    return this.lru.maxEntries;
  }

  getIfFresh(cacheKey: string, stat: fs.Stats): V | undefined {
    const entry = this.lru.get(cacheKey);
    if (!entry) return undefined;
    const stamp = extractFileStatStamp(stat);
    if (!fileStatStampsEqual(entry.stamp, stamp)) {
      this.lru.delete(cacheKey);
      return undefined;
    }
    return entry.value;
  }

  setWithStat(cacheKey: string, stat: fs.Stats, value: V): void {
    this.lru.set(cacheKey, {
      stamp: extractFileStatStamp(stat),
      value,
    });
  }

  delete(cacheKey: string): boolean {
    return this.lru.delete(cacheKey);
  }

  clear(): void {
    this.lru.clear();
  }

  getStats(): BoundedCacheStats {
    return this.lru.getStats();
  }
}

/**
 * Fast plain-JS deep clone for AST / JSON-like plain objects and arrays.
 * Avoids Node's heavyweight V8 structuredClone serialization overhead on hot AST transforms.
 */
export function fastCloneAst<T>(value: T): T {
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    const len = value.length;
    const out = new Array(len);
    for (let i = 0; i < len; i++) {
      out[i] = fastCloneAst(value[i]);
    }
    return out as unknown as T;
  }
  const src = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key in src) {
    if (Object.hasOwn(src, key)) {
      out[key] = fastCloneAst(src[key]);
    }
  }
  return out as T;
}
