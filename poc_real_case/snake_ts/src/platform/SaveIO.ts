/**
 * Ouroboros Ascension — Robust Platform Persistence Layer (SaveIO.ts)
 *
 * Implements resilient storage utilizing LocalStorage / IndexedDB with an in-memory test fallback.
 * Features:
 *  - Automatic Schema Migration (v1 legacy flat schema -> v2 structured schema)
 *  - CRC32 Checksum integrity verification to prevent corrupt/truncated save crashes
 *  - Safe non-throwing deserialization with sane fallback defaults
 *  - Encoded Export/Import JSON & Base64 save payloads
 *  - Test overrides (readOverride, writeOverride, deleteOverride) for headless tests
 *
 * Headless-safe. Meets AGENTS.md Rule 10 In-Code Documentation Standards.
 */

import type { HelmetDef, DailyCapacityState } from '../data/Types.js';

// ============================================================================
// Types & Schemas
// ============================================================================

export interface SaveRecords {
  highScore: number;
  highestFloor: number;
  highestCombo: number;
  highestLevel: number;
  totalRuns: number;
  victories: number;
  totalKills: number;
  totalFoods: number;
  totalBosses: number;
  totalShards: number;
  playTimeSec: number;
  bestTimeSec: number;
}

export interface MetaSaveV2 {
  version: 2;
  shards: number;
  ouro?: number;
  prestigeMultiplier?: number;
  unlockedClasses: Record<string, boolean>;
  upgrades: Record<string, { level: number }>;
  records: SaveRecords;
  unlockedModules?: Record<string, boolean>;
  unlockedTiers?: Record<string, number>;
  completedChallenges?: Record<string, boolean>;
  helmets?: HelmetDef[];
  equippedHelmetId?: string | null;
  dailyCapacityState?: DailyCapacityState | null;
  uniqueHelmets?: (HelmetDef | string)[];
  has9thHelmet?: boolean;
  checksum?: string;
  savedAt?: string;
}

export interface LegacyMetaSaveV1 {
  version?: 1;
  shards?: number;
  highScore?: number;
  highestFloor?: number;
  highestCombo?: number;
  totalRuns?: number;
  totalKills?: number;
  totalFoods?: number;
  unlockedClasses?: Record<string, boolean> | string[];
  upgrades?: Record<string, number | { level: number }>;
}

export interface SaveExportEnvelope {
  header: 'OUROBOROS_SAVE';
  version: 2;
  timestamp: number;
  checksum: string;
  data: MetaSaveV2;
}

export const STORAGE_KEY_V2 = 'ouroboros_meta_v2';
export const STORAGE_KEY_V1 = 'ouroboros_meta_v1';
export const STORAGE_KEY_BACKUP = 'ouroboros_meta_backup';
export const STORAGE_KEY_SETTINGS = 'ouroboros_settings_v1';

/** Creates default lifetime statistics records with zeroed metrics and floor 1 starter level. */
export function createDefaultRecords(): SaveRecords {
  return {
    highScore: 0,
    highestFloor: 1,
    highestCombo: 0,
    highestLevel: 1,
    totalRuns: 0,
    victories: 0,
    totalKills: 0,
    totalFoods: 0,
    totalBosses: 0,
    totalShards: 0,
    playTimeSec: 0.0,
    bestTimeSec: 0.0
  };
}

/** Creates default initial Schema v2 save state with starter serpent class unlocked. */
export function createDefaultMetaSave(): MetaSaveV2 {
  return {
    version: 2,
    shards: 0,
    ouro: 0,
    prestigeMultiplier: 1.0,
    unlockedClasses: {
      emerald: true
    },
    upgrades: {
      vitality: { level: 0 },
      agility: { level: 0 },
      ferocity: { level: 0 },
      resilience: { level: 0 },
      magnet: { level: 0 },
      swiftness: { level: 0 },
      rerolls: { level: 0 },
      fortune: { level: 0 },
      greed: { level: 0 }
    },
    records: createDefaultRecords(),
    unlockedModules: {
      turret: true,
      shield: true
    },
    unlockedTiers: { turret: 1, shield: 1 },
    completedChallenges: {},
    helmets: [],
    equippedHelmetId: null,
    dailyCapacityState: null,
    uniqueHelmets: [],
    has9thHelmet: false
  };
}

// ============================================================================
// CRC32 Checksum Algorithm (Polynomial 0xEDB88320 - IEEE 802.3)
// ============================================================================

/**
 * Precomputes the 256-entry lookup table for standard IEEE 802.3 CRC32 checksum hashing.
 *
 * Mathematical Derivation:
 * Uses the reversed generator polynomial:
 *   $P = \text{0xEDB88320} = x^{32} + x^{26} + x^{23} + x^{22} + x^{16} + x^{12} + x^{11} + x^{10} + x^8 + x^7 + x^5 + x^4 + x^2 + x + 1$
 *
 * For each possible byte value $i \in [0, 255]$:
 * The 8-bit division is precomputed by iterating over each bit $k \in [0, 7]$:
 *   $c_{k+1} = \begin{cases} P \oplus (c_k \gg 1) & \text{if } (c_k \ \& \ 1) = 1 \\ c_k \gg 1 & \text{otherwise} \end{cases}$
 */
const CRC32_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c;
  }
  return table;
})();

/**
 * Computes an 8-character hexadecimal CRC32 checksum of a string using standard IEEE 802.3 polynomial.
 *
 * Algorithm Steps:
 * 1. Initialize register with all 1s: $crc = \text{0xFFFFFFFF}$.
 * 2. For each UTF-16 character code $b_i$:
 *    $index = (crc \oplus b_i) \ \& \ \text{0xFF}$
 *    $crc \leftarrow (crc \gg 8) \oplus \text{CRC32\_TABLE}[index]$
 * 3. Invert register: $crc \leftarrow crc \oplus \text{0xFFFFFFFF}$ and format as zero-padded 8-char hex string.
 *
 * @param str Input string payload to checksum
 * @returns 8-character lowercase hexadecimal hash (e.g. 'cbf43926')
 */
export function computeCrc32(str: string): string {
  let crc = 0xffffffff;
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    crc = (crc >>> 8) ^ (CRC32_TABLE[(crc ^ code) & 0xff] ?? 0);
  }
  return ((crc ^ 0xffffffff) >>> 0).toString(16).padStart(8, '0');
}

/**
 * Canonical payload string generator for comprehensive CRC32 checksum hashing across all schema fields.
 * Includes ouro, prestigeMultiplier, modules, tiers, challenges, and helmets.
 */
export function computeCanonicalChecksumPayload(s: Partial<MetaSaveV2>): string {
  return JSON.stringify({
    version: s.version ?? 2,
    shards: s.shards ?? 0,
    ouro: s.ouro ?? 0,
    prestigeMultiplier: s.prestigeMultiplier ?? 1.0,
    unlockedClasses: s.unlockedClasses ?? { emerald: true },
    upgrades: s.upgrades ?? {},
    records: s.records ?? {},
    unlockedModules: s.unlockedModules ?? {},
    unlockedTiers: s.unlockedTiers ?? {},
    completedChallenges: s.completedChallenges ?? {},
    uniqueHelmets: s.uniqueHelmets ?? [],
    has9thHelmet: s.has9thHelmet ?? false,
    equippedHelmetId: s.equippedHelmetId ?? null
  });
}

/** Legacy payload string generator for backward compatibility with older v2.0 saves. */
export function computeLegacyChecksumPayload(parsed: Partial<MetaSaveV2>): string {
  return JSON.stringify({
    version: parsed.version ?? 2,
    shards: parsed.shards ?? 0,
    unlockedClasses: parsed.unlockedClasses ?? { emerald: true },
    upgrades: parsed.upgrades ?? {},
    records: parsed.records ?? {},
    unlockedTiers: parsed.unlockedTiers ?? {},
    completedChallenges: parsed.completedChallenges ?? {}
  });
}

// Base64 encode/decode without external libraries
function toBase64(str: string): string {
  if (typeof btoa !== 'undefined') {
    return btoa(encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, (_, p1: string) =>
      String.fromCharCode(parseInt(p1, 16))
    ));
  }
  // Fallback implementation
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
  let output = '';
  for (let i = 0; i < str.length; i += 3) {
    const chr1 = str.charCodeAt(i);
    const chr2 = i + 1 < str.length ? str.charCodeAt(i + 1) : NaN;
    const chr3 = i + 2 < str.length ? str.charCodeAt(i + 2) : NaN;

    const enc1 = chr1 >> 2;
    const enc2 = ((chr1 & 3) << 4) | (chr2 >> 4);
    let enc3 = isNaN(chr2) ? 64 : ((chr2 & 15) << 2) | (chr3 >> 6);
    let enc4 = isNaN(chr2) || isNaN(chr3) ? 64 : chr3 & 63;

    output += chars.charAt(enc1) + chars.charAt(enc2) + chars.charAt(enc3) + chars.charAt(enc4);
  }
  return output;
}

function fromBase64(b64: string): string {
  if (typeof atob !== 'undefined') {
    try {
      return decodeURIComponent(Array.prototype.map.call(atob(b64), (c: string) => {
        return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
      }).join(''));
    } catch {
      try { return atob(b64); } catch {}
    }
  }
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
  let output = '';
  const input = b64.replace(/[^A-Za-z0-9+/=]/g, '');
  for (let i = 0; i < input.length; i += 4) {
    const enc1 = chars.indexOf(input.charAt(i));
    const enc2 = chars.indexOf(input.charAt(i + 1));
    const enc3 = chars.indexOf(input.charAt(i + 2));
    const enc4 = chars.indexOf(input.charAt(i + 3));

    const chr1 = (enc1 << 2) | (enc2 >> 4);
    const chr2 = ((enc2 & 15) << 4) | (enc3 >> 2);
    const chr3 = ((enc3 & 3) << 6) | enc4;

    output += String.fromCharCode(chr1);
    if (enc3 !== 64) output += String.fromCharCode(chr2);
    if (enc4 !== 64) output += String.fromCharCode(chr3);
  }
  return output;
}

/**
 * Detects whether a thrown storage exception indicates browser storage quota exhaustion
 * or private browsing security restrictions (QuotaExceededError, NS_ERROR_DOM_QUOTA_REACHED, code 22/1014).
 */
export function isQuotaExceededError(e: unknown): boolean {
  if (!e) return false;
  if (typeof e === 'object') {
    const name = (e as any).name;
    if (name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED') {
      return true;
    }
    const code = (e as any).code;
    if (code === 22 || code === 1014) {
      return true;
    }
  }
  return false;
}

// ============================================================================
// SaveIO Class Implementation
// ============================================================================

export class SaveIO {
  public static readonly STORAGE_KEY_V2 = STORAGE_KEY_V2;
  public static readonly STORAGE_KEY_V1 = STORAGE_KEY_V1;
  public static readonly STORAGE_KEY_BACKUP = STORAGE_KEY_BACKUP;
  public static readonly STORAGE_KEY_SETTINGS = STORAGE_KEY_SETTINGS;

  public static readOverride: ((key: string) => string | null) | null = null;
  public static writeOverride: ((key: string, json: string) => void) | null = null;
  public static deleteOverride: ((key: string) => void) | null = null;

  public static lastError: string | null = null;
  public static memoryBackendEnabled = false;
  private static memoryStore = new Map<string, string>();

  /** Synchronously reads a string key from storage backend (Override -> LocalStorage -> Memory). */
  public static readKey(key: string): string | null {
    if (SaveIO.readOverride) return SaveIO.readOverride(key);
    if (SaveIO.memoryBackendEnabled || SaveIO.memoryStore.has(key)) {
      return SaveIO.memoryStore.get(key) ?? null;
    }

    if (typeof localStorage !== 'undefined') {
      try {
        const val = localStorage.getItem(key);
        if (val !== null) return val;
      } catch (e) {
        SaveIO.lastError = e instanceof Error ? e.message : String(e);
      }
    }
    return SaveIO.memoryStore.get(key) ?? null;
  }

  /** Synchronously writes a string key into storage backend with quota eviction & in-memory fallback. */
  public static writeKey(key: string, value: string): boolean {
    if (SaveIO.writeOverride) {
      SaveIO.writeOverride(key, value);
      return true;
    }
    if (SaveIO.memoryBackendEnabled) {
      SaveIO.memoryStore.set(key, value);
      return true;
    }

    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem(key, value);
        SaveIO.memoryStore.set(key, value);
        return true;
      } catch (e) {
        // Handle DOMException QuotaExceededError on mobile / private browsing
        if (isQuotaExceededError(e)) {
          try {
            // Emergency eviction: prune obsolete legacy schema v1 save to free up quota
            localStorage.removeItem(STORAGE_KEY_V1);
            localStorage.setItem(key, value);
            SaveIO.memoryStore.set(key, value);
            return true;
          } catch {
            // Persistent quota exhaustion: safely continue in in-memory store
          }
        }
        SaveIO.lastError = e instanceof Error ? e.message : String(e);
        SaveIO.memoryStore.set(key, value);
        // Fallback to in-memory store preserves in-flight gameplay state without throwing fatal errors
        return true;
      }
    }
    SaveIO.memoryStore.set(key, value);
    return true;
  }

  /** Synchronously removes a key from storage backend. */
  public static deleteKey(key: string): void {
    if (SaveIO.deleteOverride) {
      SaveIO.deleteOverride(key);
      return;
    }
    SaveIO.memoryStore.delete(key);
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.removeItem(key);
      } catch (e) {
        SaveIO.lastError = e instanceof Error ? e.message : String(e);
      }
    }
  }

  /**
   * Resets the in-memory key-value cache, clears active error states, closes IndexedDB,
   * and purges localStorage entries if available to ensure total test isolation.
   */
  public static clearMemory(): void {
    SaveIO.memoryStore.clear();
    SaveIO.lastError = null;
    SaveIO.closeDB();
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.clear();
      } catch {
        // ignore restricted storage
      }
    }
  }

  /** Binds SaveIO to storage and triggers a clean load. */
  public static install(): void {
    SaveIO.loadMeta();
  }

  // ==========================================================================
  // IndexedDB Asynchronous Storage Wrapper
  // ============================================================================

  private static dbInstance: IDBDatabase | null = null;
  private static dbPromise: Promise<IDBDatabase | null> | null = null;

  /** Releases cached IndexedDB connection and resets in-flight connection promise. */
  public static closeDB(): void {
    if (SaveIO.dbInstance) {
      try {
        SaveIO.dbInstance.close();
      } catch {}
      SaveIO.dbInstance = null;
    }
    SaveIO.dbPromise = null;
  }

  private static getIDB(): Promise<IDBDatabase | null> {
    if (typeof indexedDB === 'undefined') return Promise.resolve(null);
    if (SaveIO.dbInstance) return Promise.resolve(SaveIO.dbInstance);
    if (SaveIO.dbPromise) return SaveIO.dbPromise;

    SaveIO.dbPromise = new Promise((resolve) => {
      try {
        const req = indexedDB.open('ouroboros_db', 1);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains('saves')) {
            db.createObjectStore('saves');
          }
        };
        req.onsuccess = () => {
          SaveIO.dbInstance = req.result;
          SaveIO.dbInstance.onversionchange = () => {
            SaveIO.closeDB();
          };
          resolve(SaveIO.dbInstance);
        };
        req.onerror = () => {
          SaveIO.dbPromise = null;
          resolve(null);
        };
      } catch {
        SaveIO.dbPromise = null;
        resolve(null);
      }
    });

    return SaveIO.dbPromise;
  }

  public static async getAsync(key: string): Promise<string | null> {
    const db = await SaveIO.getIDB();
    if (!db) return SaveIO.readKey(key);

    return new Promise((resolve) => {
      try {
        const tx = db.transaction('saves', 'readonly');
        const store = tx.objectStore('saves');
        const req = store.get(key);
        req.onsuccess = () => resolve(typeof req.result === 'string' ? req.result : SaveIO.readKey(key));
        req.onerror = () => resolve(SaveIO.readKey(key));
      } catch {
        resolve(SaveIO.readKey(key));
      }
    });
  }

  public static async setAsync(key: string, value: string): Promise<boolean> {
    SaveIO.writeKey(key, value);
    const db = await SaveIO.getIDB();
    if (!db) return true;

    return new Promise((resolve) => {
      try {
        const tx = db.transaction('saves', 'readwrite');
        const store = tx.objectStore('saves');
        const req = store.put(value, key);
        req.onsuccess = () => resolve(true);
        req.onerror = () => resolve(false);
      } catch {
        resolve(false);
      }
    });
  }

  // ==========================================================================
  // Schema Migration (v1 -> v2)
  // ============================================================================

  /**
   * Translates legacy flat Schema v1 structure into structured Schema v2 model.
   *
   * Step-by-Step Migration Protocol:
   * - Step 1: Initialize clean default Schema v2 model with baseline unlocks and zeroed records.
   * - Step 2: Currency preservation:
   *   - `shards`: Clamped to non-negative integer $\ge 0$.
   *   - `ouro`: Preserved if finite, else initialized to 0.
   *   - `prestigeMultiplier`: Preserved if finite, clamped $\ge 1.0$.
   * - Step 3: Serpent Archetype Unlocks:
   *   - Converts legacy string array (`['emerald', 'hydra']`) or boolean map (`{ emerald: true, hydra: true }`)
   *     into normalized `Record<string, boolean>`. Always enforces `'emerald': true` as starter class.
   * - Step 4: Sanctuary Upgrades:
   *   - Converts legacy flat numbers (`{ vitality: 3 }`) or structured objects (`{ vitality: { level: 3 } }`)
   *     into uniform `{ [key]: { level: number } }` format with finite clamping.
   * - Step 5: Lifetime Statistics & High-Score Records:
   *   - Migrates `highScore`, `highestFloor`, `highestCombo`, `totalRuns`, `victories`, `totalKills`,
   *     `totalFoods`, `totalBosses`, `totalShards`, `playTimeSec`, and `bestTimeSec` with NaN sanitization.
   *
   * @param v1 Legacy Schema v1 save object
   * @returns Fully normalized, type-safe Schema v2 meta-progression state
   */
  public static migrateV1toV2(v1: LegacyMetaSaveV1): MetaSaveV2 {
    const v2 = createDefaultMetaSave();

    if (typeof v1.shards === 'number' && Number.isFinite(v1.shards)) {
      v2.shards = Math.max(0, Math.floor(v1.shards));
    }

    if (typeof (v1 as any).ouro === 'number' && Number.isFinite((v1 as any).ouro)) {
      v2.ouro = Math.max(0, Math.floor((v1 as any).ouro));
    } else {
      v2.ouro = 0;
    }

    if (typeof (v1 as any).prestigeMultiplier === 'number' && Number.isFinite((v1 as any).prestigeMultiplier)) {
      v2.prestigeMultiplier = Math.max(1.0, (v1 as any).prestigeMultiplier);
    } else {
      v2.prestigeMultiplier = 1.0;
    }

    // Unlocked Classes: sanitize empty/whitespace entries
    if (v1.unlockedClasses) {
      if (Array.isArray(v1.unlockedClasses)) {
        for (const cls of v1.unlockedClasses) {
          if (typeof cls === 'string' && cls.trim().length > 0) {
            v2.unlockedClasses[cls.trim()] = true;
          }
        }
      } else if (typeof v1.unlockedClasses === 'object') {
        for (const [k, v] of Object.entries(v1.unlockedClasses)) {
          if (v && typeof k === 'string' && k.trim().length > 0) {
            v2.unlockedClasses[k.trim()] = true;
          }
        }
      }
    }
    v2.unlockedClasses.emerald = true;

    // Upgrades: sanitize non-finite numbers (NaN, Infinity)
    if (v1.upgrades && typeof v1.upgrades === 'object') {
      for (const [k, val] of Object.entries(v1.upgrades)) {
        if (typeof val === 'number' && Number.isFinite(val)) {
          v2.upgrades[k] = { level: Math.max(0, Math.floor(val)) };
        } else if (val && typeof val === 'object' && typeof (val as any).level === 'number' && Number.isFinite((val as any).level)) {
          v2.upgrades[k] = { level: Math.max(0, Math.floor((val as any).level)) };
        }
      }
    }

    // Records: guarantee finite clamped numbers
    const sanitizeNum = (n: any, def: number, min = 0): number =>
      typeof n === 'number' && Number.isFinite(n) ? Math.max(min, Math.floor(n)) : def;

    v2.records.highScore = sanitizeNum(v1.highScore, 0);
    v2.records.highestFloor = sanitizeNum(v1.highestFloor, 1, 1);
    v2.records.highestCombo = sanitizeNum(v1.highestCombo, 0);
    v2.records.highestLevel = sanitizeNum((v1 as any).highestLevel, 1, 1);
    v2.records.totalRuns = sanitizeNum(v1.totalRuns, 0);
    v2.records.victories = sanitizeNum((v1 as any).victories, 0);
    v2.records.totalKills = sanitizeNum(v1.totalKills, 0);
    v2.records.totalFoods = sanitizeNum(v1.totalFoods, 0);
    v2.records.totalBosses = sanitizeNum((v1 as any).totalBosses, 0);
    v2.records.totalShards = sanitizeNum((v1 as any).totalShards, 0);
    v2.records.playTimeSec = typeof (v1 as any).playTimeSec === 'number' && Number.isFinite((v1 as any).playTimeSec)
      ? Math.max(0, (v1 as any).playTimeSec)
      : 0;
    v2.records.bestTimeSec = typeof (v1 as any).bestTimeSec === 'number' && Number.isFinite((v1 as any).bestTimeSec)
      ? Math.max(0, (v1 as any).bestTimeSec)
      : 0;

    return v2;
  }

  // ==========================================================================
  // Meta Progression Load / Save with Integrity Validation
  // ============================================================================

  /**
   * Resiliently loads meta-progression state from storage with fallback hierarchy:
   * 1. Schema v2 store (validated & normalized)
   * 2. Schema v2 backup store (automatic recovery on corruption)
   * 3. Schema v1 legacy store (migrated & saved to v2)
   * 4. Sane default starter state
   */
  public static loadMeta(): MetaSaveV2 {
    SaveIO.lastError = null;
    try {
      let parsedV2: Partial<MetaSaveV2> | null = null;
      let checksumFailed = false;
      const rawV2 = SaveIO.readKey(STORAGE_KEY_V2);
      if (rawV2) {
        try {
          const parsed = JSON.parse(rawV2) as Partial<MetaSaveV2>;
          if (parsed && typeof parsed === 'object' && (parsed.version === 2 || parsed.upgrades || parsed.records || parsed.shards !== undefined)) {
            if (parsed.checksum) {
              const computedCanonical = computeCrc32(computeCanonicalChecksumPayload(parsed));
              const computedLegacy = computeCrc32(computeLegacyChecksumPayload(parsed));
              if (parsed.checksum !== computedCanonical && parsed.checksum !== computedLegacy) {
                SaveIO.lastError = 'Save integrity checksum mismatch (corrupted save file).';
                checksumFailed = true;
                parsedV2 = null;
              } else {
                parsedV2 = parsed;
              }
            } else {
              parsedV2 = parsed;
            }
          }
        } catch (e) {
          SaveIO.lastError = e instanceof Error ? e.message : String(e);
          parsedV2 = null;
        }
      }

      // Automatic recovery: If primary v2 store suffered truncation/JSON corruption (not deliberate checksum tamper), recover from backup
      if (!parsedV2 && !checksumFailed) {
        const rawBackup = SaveIO.readKey(STORAGE_KEY_BACKUP);
        if (rawBackup && rawBackup !== rawV2) {
          try {
            const parsedBackup = JSON.parse(rawBackup) as Partial<MetaSaveV2>;
            if (parsedBackup && typeof parsedBackup === 'object' && parsedBackup.version === 2) {
              if (parsedBackup.checksum) {
                const bCanon = computeCrc32(computeCanonicalChecksumPayload(parsedBackup));
                const bLeg = computeCrc32(computeLegacyChecksumPayload(parsedBackup));
                if (parsedBackup.checksum === bCanon || parsedBackup.checksum === bLeg) {
                  parsedV2 = parsedBackup;
                  SaveIO.lastError = null;
                }
              } else {
                parsedV2 = parsedBackup;
                SaveIO.lastError = null;
              }
            }
          } catch {
            // Ignore backup parse error
          }
        }
      }

      const hasUpgrades = parsedV2?.upgrades && Object.values(parsedV2.upgrades).some(u => (u?.level ?? 0) > 0);
      const hasExtraClasses = parsedV2?.unlockedClasses && Object.keys(parsedV2.unlockedClasses).length > 1;

      const hasV2Data = parsedV2 && (
        (parsedV2.shards ?? 0) > 0 ||
        (parsedV2.ouro ?? 0) > 0 ||
        hasUpgrades ||
        hasExtraClasses ||
        (parsedV2.helmets && parsedV2.helmets.length > 0) ||
        (!!parsedV2.equippedHelmetId) ||
        (!!parsedV2.dailyCapacityState) ||
        (parsedV2.records && ((parsedV2.records.totalRuns ?? 0) > 0 || (parsedV2.records.highScore ?? 0) > 0 || (parsedV2.records.totalKills ?? 0) > 0))
      );

      // Check for legacy V1 save only if no distinct V2 data exists
      if (!hasV2Data) {
        const rawV1 = SaveIO.readKey(STORAGE_KEY_V1);
        if (rawV1 && rawV1 !== rawV2) {
          try {
            const parsedV1 = JSON.parse(rawV1) as any;
            if (parsedV1 && typeof parsedV1 === 'object' && parsedV1.version !== 2 && !parsedV1.helmets) {
              const migrated = SaveIO.migrateV1toV2(parsedV1);
              SaveIO.saveMeta(migrated);
              return migrated;
            }
          } catch (e) {
            SaveIO.lastError = e instanceof Error ? e.message : String(e);
          }
        }
      }

      if (parsedV2) {
        return SaveIO.validateAndNormalizeV2(parsedV2);
      }
    } catch (e) {
      SaveIO.lastError = e instanceof Error ? e.message : String(e);
    }

    // Fallback to clean state
    const defaultSave = createDefaultMetaSave();
    return defaultSave;
  }

  /**
   * Persists meta-progression state to storage backend with computed CRC32 checksum
   * and automatic rolling backup synchronization.
   */
  public static saveMeta(save: MetaSaveV2): boolean {
    try {
      const normalized = SaveIO.validateAndNormalizeV2(save);
      normalized.savedAt = new Date().toISOString();

      // Compute integrity checksum over canonical comprehensive payload
      normalized.checksum = computeCrc32(computeCanonicalChecksumPayload(normalized));

      const json = JSON.stringify(normalized);
      const ok = SaveIO.writeKey(STORAGE_KEY_V2, json);
      if (ok) {
        // Sync rolling backup for corruption recovery
        SaveIO.writeKey(STORAGE_KEY_BACKUP, json);
      }
      return ok;
    } catch (e) {
      SaveIO.lastError = e instanceof Error ? e.message : String(e);
      return false;
    }
  }

  /**
   * Deletes existing saves and resets persistence to pristine factory defaults.
   */
  public static resetMeta(): MetaSaveV2 {
    SaveIO.deleteKey(STORAGE_KEY_V2);
    SaveIO.deleteKey(STORAGE_KEY_V1);
    SaveIO.deleteKey(STORAGE_KEY_BACKUP);
    const clean = createDefaultMetaSave();
    SaveIO.saveMeta(clean);
    return clean;
  }

  /**
   * Validates, clamps, and normalizes a partially populated or untrusted Schema v2 object.
   * Fully preserves ouro, prestigeMultiplier, and unique helmets.
   */
  public static validateAndNormalizeV2(parsed: any): MetaSaveV2 {
    const v2 = createDefaultMetaSave();

    if (typeof parsed.shards === 'number' && Number.isFinite(parsed.shards)) {
      v2.shards = Math.max(0, Math.floor(parsed.shards));
    }

    if (typeof parsed.ouro === 'number' && Number.isFinite(parsed.ouro)) {
      v2.ouro = Math.max(0, Math.floor(parsed.ouro));
    } else {
      v2.ouro = 0;
    }

    if (typeof parsed.prestigeMultiplier === 'number' && Number.isFinite(parsed.prestigeMultiplier)) {
      v2.prestigeMultiplier = Math.max(1.0, parsed.prestigeMultiplier);
    } else {
      v2.prestigeMultiplier = 1.0;
    }

    if (parsed.unlockedClasses) {
      if (Array.isArray(parsed.unlockedClasses)) {
        for (const cls of parsed.unlockedClasses) {
          if (typeof cls === 'string' && cls.trim().length > 0) {
            v2.unlockedClasses[cls.trim()] = true;
          }
        }
      } else if (typeof parsed.unlockedClasses === 'object') {
        for (const [k, v] of Object.entries(parsed.unlockedClasses)) {
          if (v && typeof k === 'string' && k.trim().length > 0) {
            v2.unlockedClasses[k.trim()] = true;
          }
        }
      }
    }
    v2.unlockedClasses.emerald = true;

    if (parsed.upgrades && typeof parsed.upgrades === 'object') {
      for (const [k, v] of Object.entries(parsed.upgrades as Record<string, any>)) {
        if (v && typeof v.level === 'number' && Number.isFinite(v.level)) {
          v2.upgrades[k] = { level: Math.max(0, Math.floor(v.level)) };
        } else if (typeof v === 'number' && Number.isFinite(v)) {
          v2.upgrades[k] = { level: Math.max(0, Math.floor(v)) };
        }
      }
    }

    if (parsed.unlockedModules && typeof parsed.unlockedModules === 'object') {
      v2.unlockedModules = { ...v2.unlockedModules, ...parsed.unlockedModules };
    }

    if (parsed.unlockedTiers && typeof parsed.unlockedTiers === 'object') {
      for (const [k, v] of Object.entries(parsed.unlockedTiers as Record<string, any>)) {
        if (typeof v === 'number' && Number.isFinite(v) && v >= 1) {
          if (!v2.unlockedTiers) v2.unlockedTiers = {};
          v2.unlockedTiers[k] = Math.floor(v);
        }
      }
    }

    if (parsed.completedChallenges && typeof parsed.completedChallenges === 'object') {
      v2.completedChallenges = { ...v2.completedChallenges, ...parsed.completedChallenges };
    }

    if (parsed.records && typeof parsed.records === 'object') {
      const rec = parsed.records;
      const def = v2.records;
      def.highScore = Math.max(0, Math.floor(Number.isFinite(rec.highScore) ? rec.highScore : 0));
      def.highestFloor = Math.max(1, Math.floor(Number.isFinite(rec.highestFloor) ? rec.highestFloor : 1));
      def.highestCombo = Math.max(0, Math.floor(Number.isFinite(rec.highestCombo) ? rec.highestCombo : 0));
      def.highestLevel = Math.max(1, Math.floor(Number.isFinite(rec.highestLevel) ? rec.highestLevel : 1));
      def.totalRuns = Math.max(0, Math.floor(Number.isFinite(rec.totalRuns) ? rec.totalRuns : 0));
      def.victories = Math.max(0, Math.floor(Number.isFinite(rec.victories) ? rec.victories : 0));
      def.totalKills = Math.max(0, Math.floor(Number.isFinite(rec.totalKills) ? rec.totalKills : 0));
      def.totalFoods = Math.max(0, Math.floor(Number.isFinite(rec.totalFoods) ? rec.totalFoods : 0));
      def.totalBosses = Math.max(0, Math.floor(Number.isFinite(rec.totalBosses) ? rec.totalBosses : 0));
      def.totalShards = Math.max(0, Math.floor(Number.isFinite(rec.totalShards) ? rec.totalShards : 0));
      def.playTimeSec = Math.max(0, Number.isFinite(rec.playTimeSec) ? Number(rec.playTimeSec) : 0);
      def.bestTimeSec = Math.max(0, Number.isFinite(rec.bestTimeSec) ? Number(rec.bestTimeSec) : 0);
    }

    if (parsed.checksum) {
      v2.checksum = parsed.checksum;
    }
    if (parsed.savedAt) {
      v2.savedAt = parsed.savedAt;
    }

    if (Array.isArray(parsed.helmets)) {
      v2.helmets = (parsed.helmets as any[]).filter(h => h && typeof h === 'object' && (h.id || h.Id));
    }
    if (parsed.equippedHelmetId !== undefined) {
      v2.equippedHelmetId = parsed.equippedHelmetId;
      if (v2.equippedHelmetId && Array.isArray(v2.helmets)) {
        const exists = v2.helmets.some(h => (h.id || (h as any).Id) === v2.equippedHelmetId);
        if (!exists) v2.equippedHelmetId = null;
      }
    }

    if (parsed.dailyCapacityState && typeof parsed.dailyCapacityState === 'object') {
      v2.dailyCapacityState = parsed.dailyCapacityState;
    } else {
      v2.dailyCapacityState = null;
    }

    if (Array.isArray(parsed.uniqueHelmets)) {
      v2.uniqueHelmets = parsed.uniqueHelmets
        .map((h: any) => (typeof h === 'string' ? h.trim() : (h?.id || h?.Id)))
        .filter((id: any) => typeof id === 'string' && id.length > 0);
    } else {
      v2.uniqueHelmets = [];
    }
    v2.has9thHelmet = Boolean(parsed.has9thHelmet);

    return v2;
  }

  // ==========================================================================
  // Export & Import Capabilities (JSON & Base64)
  // ============================================================================

  /** Exports the current game state as a signed and verifiable JSON export string. */
  public static exportSaveJson(): string {
    const meta = SaveIO.loadMeta();
    const dataString = JSON.stringify(meta);
    const checksum = computeCrc32(dataString);

    const envelope: SaveExportEnvelope = {
      header: 'OUROBOROS_SAVE',
      version: 2,
      timestamp: Date.now(),
      checksum,
      data: meta
    };

    return JSON.stringify(envelope, null, 2);
  }

  /** Exports the current game state as a Base64-encoded string for easy clipboard copying. */
  public static exportSaveBase64(): string {
    const json = SaveIO.exportSaveJson();
    return toBase64(json);
  }

  /** Imports and verifies a save JSON envelope or raw save JSON string. */
  public static importSaveJson(jsonString: string): { success: boolean; error?: string; data?: MetaSaveV2 } {
    try {
      const parsed = JSON.parse(jsonString);

      // Check if it is an export envelope
      if (parsed && typeof parsed === 'object' && parsed.header === 'OUROBOROS_SAVE' && parsed.data) {
        const envelope = parsed as SaveExportEnvelope;
        const computed = computeCrc32(JSON.stringify(envelope.data));
        if (envelope.checksum && envelope.checksum !== computed) {
          return { success: false, error: 'Checksum mismatch: save data is corrupted or modified.' };
        }
        const validated = SaveIO.validateAndNormalizeV2(envelope.data);
        SaveIO.saveMeta(validated);
        return { success: true, data: validated };
      }

      // Check if it is direct V2 save JSON
      if (parsed && typeof parsed === 'object' && (parsed.version === 2 || parsed.shards !== undefined)) {
        const validated = SaveIO.validateAndNormalizeV2(parsed);
        SaveIO.saveMeta(validated);
        return { success: true, data: validated };
      }

      // Check if it is legacy V1 save JSON
      if (parsed && typeof parsed === 'object') {
        const migrated = SaveIO.migrateV1toV2(parsed);
        SaveIO.saveMeta(migrated);
        return { success: true, data: migrated };
      }

      return { success: false, error: 'Unrecognized save format.' };
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : 'Invalid JSON' };
    }
  }

  /** Imports a Base64-encoded save string. */
  public static importSaveBase64(base64String: string): { success: boolean; error?: string; data?: MetaSaveV2 } {
    try {
      const decodedJson = fromBase64(base64String.trim());
      return SaveIO.importSaveJson(decodedJson);
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : 'Invalid Base64 payload' };
    }
  }
}
