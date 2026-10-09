import { MathX } from './MathX.js';

/**
 * Ouroboros Ascension — Deterministic Pseudorandom Number Generator (Rng.ts)
 *
 * Implements a high-quality 32-bit PRNG based on the Mulberry32 algorithm.
 * Guarantees bit-exact determinism across TypeScript, Node.js, and C# simulation harnesses,
 * enabling reproducible gameplay seeds, regression fuzzing, and golden replay traces.
 *
 * Mathematical Foundations:
 * 1. Mulberry32 State Update & Mixing:
 *    Given 32-bit unsigned state $s_n \in [0, 2^{32}-1]$:
 *    $$s_{n+1} = (s_n + \text{0x6D2B79F5}) \pmod{2^{32}}$$
 *    Intermediate Mix 1:
 *    $$t_1 = (s_{n+1} \oplus (s_{n+1} \gg 15)) \cdot (s_{n+1} \mid 1)$$
 *    Intermediate Mix 2:
 *    $$t_2 = t_1 \oplus (t_1 + ((t_1 \oplus (t_1 \gg 7)) \cdot (t_1 \mid 61)))$$
 *    Normalized Output $[0, 1)$:
 *    $$R = \frac{(t_2 \oplus (t_2 \gg 14)) \pmod{2^{32}}}{2^{32}}$$
 *
 * 2. Fowler–Noll–Vo 32-bit Hash (FNV-1a):
 *    Used to derive deterministic integer seeds from strings (e.g. daily challenge date keys):
 *    $$H_0 = 2166136261 \quad (\text{FNV offset basis})$$
 *    $$H_{i+1} = ((H_i \oplus c_i) \cdot 16777619) \pmod{2^{32}} \quad (\text{FNV prime})$$
 */
export class Rng {
  /** Shared global PRNG instance for deterministic simulation components. */
  public static readonly Shared: Rng = new Rng();
  /** Unseeded cosmetic PRNG instance for non-deterministic visual particles and audio jitter. */
  public static readonly Cosmetic: Rng = new Rng(Date.now() >>> 0);

  /** Initial 32-bit unsigned integer seed. */
  public seed = 0;
  /** Current internal 32-bit unsigned state register. */
  public state = 0;
  /** Total number of random draws generated from this instance. */
  public calls = 0;

  /**
   * Initializes a new PRNG instance with an optional 32-bit seed.
   *
   * @param seed Optional seed value (if omitted or null, draws from `Math.random()`).
   */
  constructor(seed?: number | null) {
    this.setSeed(seed);
  }

  /**
   * Resets the PRNG state using the specified seed.
   *
   * @param seed Optional 32-bit unsigned seed.
   * @returns The sanitized 32-bit seed stored in the generator.
   */
  public setSeed(seed?: number | null): number {
    let s: number;
    if (seed != null && Number.isFinite(seed)) {
      s = (seed >>> 0);
    } else {
      s = (Math.random() * 0xffffffff) >>> 0;
    }
    this.seed = s;
    // Golden ratio constant 0x9E3779B9 used if seed is exactly zero to prevent degenerate zero-state lock
    this.state = this.seed !== 0 ? this.seed : 0x9e3779b9;
    this.calls = 0;
    return this.seed;
  }

  /**
   * Generates a pseudorandom float uniformly distributed in the half-open interval $[0, 1)$:
   *
   * Formula:
   *   $$U \sim \operatorname{Uniform}[0, 1)$$
   *
   * @returns Floating-point value in $[0, 1)$.
   */
  public rand(): number {
    this.calls++;
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296.0;
  }

  /**
   * Generates a pseudorandom float uniformly distributed in $[min, max)$:
   *
   * Formula:
   *   $$v = min + U \cdot (max - min)$$
   *
   * @param min Minimum bound (inclusive).
   * @param max Maximum bound (exclusive).
   * @returns Uniform float in $[min, max)$.
   */
  public range(min: number, max: number): number {
    return min + this.rand() * (max - min);
  }

  /**
   * Generates a pseudorandom integer in $[min, max]$ (inclusive on both ends):
   *
   * Formula:
   *   $$k = \lfloor min + U \cdot (max - min + 1) \rfloor$$
   *
   * @param min Minimum integer (inclusive).
   * @param max Maximum integer (inclusive).
   * @returns Discrete integer in $[min, max]$.
   */
  public int(min: number, max: number): number {
    return Math.floor(this.range(min, max + 1));
  }
  public rangeInt(min: number, max: number): number {
    return this.int(min, max);
  }
  public RangeInt(min: number, max: number): number {
    return this.int(min, max);
  }

  /**
   * Bernoulli trial with probability of success $p \in [0, 1]$:
   *
   * Formula:
   *   $$\text{success} \iff U < p$$
   *
   * @param p Probability threshold (e.g. 0.25 for 25% chance).
   * @returns True if the random roll succeeded.
   */
  public chance(p: number): boolean {
    return this.rand() < p;
  }

  /**
   * Uniformly samples a single element from an array.
   *
   * @param list Source array of items.
   * @returns Picked element, or `undefined` if array is empty.
   */
  public pick<T>(list: readonly T[] | T[]): T | undefined {
    return list.length > 0 ? list[Math.floor(this.rand() * list.length)] : undefined;
  }

  /**
   * Randomly returns $+1.0$ or $-1.0$ with equal 50/50 probability.
   *
   * @returns $+1.0$ or $-1.0$.
   */
  public sign(): number {
    return this.rand() < 0.5 ? -1.0 : 1.0;
  }

  /**
   * Generates a random heading angle uniformly distributed in $[0, 2\pi)$ radians:
   *
   * Formula:
   *   $$\theta = U \cdot 2\pi$$
   *
   * @returns Random radian angle in $[0, \tau)$.
   */
  public angle(): number {
    return this.rand() * MathX.Tau;
  }

  /**
   * Computes the 32-bit Fowler–Noll–Vo (FNV-1a) hash of a string.
   * Widely used to derive deterministic run seeds from date strings `YYYY-MM-DD`.
   *
   * @param str Input ASCII/UTF-16 string.
   * @returns 32-bit unsigned integer hash.
   */
  public static hash(str: string): number {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }
}
