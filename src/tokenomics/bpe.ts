/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Bounded-LRU Exact BPE Token Counter (cl100k_base & o200k_base).
 * Uses precompiled js-tiktoken pre-tokenization patterns + strictly bounded
 * two-generation piece caching + bounded whole-text LRU caching to deliver
 * bit-exact BPE token counts without unbounded memory growth.
 */

import { createHash } from "node:crypto";
import { getEncoding, type Tiktoken } from "js-tiktoken";
import { type BoundedCacheStats, BoundedLruCache, TwoGenBoundedCache } from "../cache/lru.js";

export type BpeEncodingName = "cl100k_base" | "o200k_base";

interface TiktokenInternalShape {
  patStr?: string;
  specialTokens?: Record<string, number>;
  rankMap?: Map<string, number>;
  textEncoder?: InstanceType<typeof TextEncoder>;
}

interface CompiledEncodingState {
  encoder: Tiktoken;
  patRegex?: RegExp;
  specialRegex?: RegExp;
  rankMap?: Map<string, number>;
  textEncoder: InstanceType<typeof TextEncoder>;
  pieceCache: TwoGenBoundedCache<string, number>;
}

export const MAX_WHOLE_TEXT_TOKEN_CACHE_ENTRIES = 1024;
export const MAX_CACHEABLE_TEXT_LENGTH = 500_000;
export const MAX_BPE_PIECE_CACHE_ENTRIES = 32_768;
const MAX_CACHEABLE_PIECE_LENGTH = 64;

const sharedTextEncoder = new TextEncoder();
const encodingStates = new Map<BpeEncodingName, CompiledEncodingState>();
const wholeTextTokenCache = new BoundedLruCache<string, number>(MAX_WHOLE_TEXT_TOKEN_CACHE_ENTRIES);

function escapeRegexLiteral(str: string): string {
  return str.replace(/[\\^$*+?.()|[\]{}]/g, "\\$&");
}

function getCompiledEncodingState(encoding: BpeEncodingName): CompiledEncodingState {
  let state = encodingStates.get(encoding);
  if (state) return state;

  const encoder = getEncoding(encoding);
  const internal = encoder as unknown as TiktokenInternalShape;

  let patRegex: RegExp | undefined;
  let specialRegex: RegExp | undefined;
  let rankMap: Map<string, number> | undefined;

  if (typeof internal.patStr === "string" && internal.rankMap instanceof Map) {
    try {
      patRegex = new RegExp(internal.patStr, "ug");
      rankMap = internal.rankMap;
      const specialKeys =
        internal.specialTokens && typeof internal.specialTokens === "object"
          ? Object.keys(internal.specialTokens)
          : [];
      if (specialKeys.length > 0) {
        specialRegex = new RegExp(specialKeys.map(escapeRegexLiteral).join("|"));
      }
    } catch {
      patRegex = undefined;
      rankMap = undefined;
      specialRegex = undefined;
    }
  }

  state = {
    encoder,
    patRegex,
    specialRegex,
    rankMap,
    textEncoder: internal.textEncoder ?? sharedTextEncoder,
    pieceCache: new TwoGenBoundedCache<string, number>(MAX_BPE_PIECE_CACHE_ENTRIES),
  };
  encodingStates.set(encoding, state);
  return state;
}

export function getTokenizerEncoding(encoding: BpeEncodingName = "cl100k_base"): Tiktoken {
  return getCompiledEncodingState(encoding).encoder;
}

function bytesSliceKey(bytes: Uint8Array, start: number, end: number): string {
  let out = String(bytes[start]);
  for (let i = start + 1; i < end; i++) {
    out += `,${bytes[i]}`;
  }
  return out;
}

/**
 * Exact byte-pair merge count matching js-tiktoken's `bytePairEncode(piece, ranks).length`.
 * Monomorphic over `Uint8Array` with flat `Int32Array` part bounds to avoid V8 deopts/GC.
 */
function countBytePairTokens(piece: Uint8Array, rankMap: Map<string, number>): number {
  const len = piece.length;
  if (len === 0) return 0;
  if (len === 1) {
    return rankMap.has(String(piece[0])) ? 1 : 0;
  }

  const wholeKey = bytesSliceKey(piece, 0, len);
  if (rankMap.has(wholeKey)) {
    return 1;
  }

  const starts = new Int32Array(len);
  const ends = new Int32Array(len);
  for (let i = 0; i < len; i++) {
    starts[i] = i;
    ends[i] = i + 1;
  }

  let partCount = len;
  while (partCount > 1) {
    let minRank = Number.POSITIVE_INFINITY;
    let minIdx = -1;
    const limit = partCount - 1;
    for (let i = 0; i < limit; i++) {
      const rank = rankMap.get(bytesSliceKey(piece, starts[i] ?? 0, ends[i + 1] ?? 0));
      if (rank !== undefined && rank < minRank) {
        minRank = rank;
        minIdx = i;
      }
    }
    if (minIdx !== -1) {
      ends[minIdx] = ends[minIdx + 1] ?? 0;
      for (let i = minIdx + 1; i < limit; i++) {
        starts[i] = starts[i + 1] ?? 0;
        ends[i] = ends[i + 1] ?? 0;
      }
      partCount--;
    } else {
      break;
    }
  }

  let count = 0;
  for (let i = 0; i < partCount; i++) {
    if (rankMap.has(bytesSliceKey(piece, starts[i] ?? 0, ends[i] ?? 0))) {
      count++;
    }
  }
  return count;
}

function countTokensUncached(text: string, state: CompiledEncodingState): number {
  const { patRegex, specialRegex, rankMap, textEncoder, pieceCache, encoder } = state;
  if (!patRegex || !rankMap) {
    return encoder.encode(text).length;
  }
  if (specialRegex?.test(text)) {
    // Delegate exact special-token handling / disallowedSpecial errors directly to js-tiktoken
    return encoder.encode(text).length;
  }

  const pieces = text.match(patRegex);
  if (!pieces) return 0;

  let total = 0;
  for (const pieceStr of pieces) {
    if (pieceStr.length <= MAX_CACHEABLE_PIECE_LENGTH) {
      const cached = pieceCache.get(pieceStr);
      if (cached !== undefined) {
        total += cached;
        continue;
      }
      const pieceBytes = textEncoder.encode(pieceStr);
      const count = countBytePairTokens(pieceBytes, rankMap);
      pieceCache.set(pieceStr, count);
      total += count;
    } else {
      const pieceBytes = textEncoder.encode(pieceStr);
      total += countBytePairTokens(pieceBytes, rankMap);
    }
  }
  return total;
}

export function estimateTokens(text: string, encoding: BpeEncodingName = "cl100k_base"): number {
  if (!text) return 0;
  if (text.length <= MAX_CACHEABLE_TEXT_LENGTH) {
    const cacheKey =
      text.length <= 128
        ? `${encoding}:s:${text}`
        : `${encoding}:h:${text.length}:${createHash("sha256").update(text, "utf-8").digest("hex").slice(0, 32)}`;
    const cached = wholeTextTokenCache.get(cacheKey);
    if (cached !== undefined) {
      return cached;
    }
    const count = countTokensUncached(text, getCompiledEncodingState(encoding));
    wholeTextTokenCache.set(cacheKey, count);
    return count;
  }
  return countTokensUncached(text, getCompiledEncodingState(encoding));
}

export class TiktokenTokenizer {
  public static count(text: string, encoding: BpeEncodingName = "cl100k_base"): number {
    return estimateTokens(text, encoding);
  }

  public count(text: string, encoding: BpeEncodingName = "cl100k_base"): number {
    return estimateTokens(text, encoding);
  }

  public encode(text: string, encoding: BpeEncodingName = "cl100k_base"): number[] {
    return Array.from(getTokenizerEncoding(encoding).encode(text));
  }
}

export function clearBpeTokenCaches(): void {
  wholeTextTokenCache.clear();
  for (const state of encodingStates.values()) {
    state.pieceCache.clear();
  }
}

export function getBpeTokenCacheStats(): {
  wholeText: BoundedCacheStats;
  pieces: Partial<Record<BpeEncodingName, BoundedCacheStats>>;
} {
  const pieces: Partial<Record<BpeEncodingName, BoundedCacheStats>> = {};
  for (const [name, state] of encodingStates.entries()) {
    pieces[name] = state.pieceCache.getStats();
  }
  return {
    wholeText: wholeTextTokenCache.getStats(),
    pieces,
  };
}
