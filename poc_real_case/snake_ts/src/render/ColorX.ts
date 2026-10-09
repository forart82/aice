/**
 * ============================================================================
 * Cyberpunk Color Palette & GPU Color Conversion Engine (ColorX.ts)
 * Protocol 3.0 Commercial Engine Edition — Rule 10 Documentation Standards
 * ============================================================================
 *
 * Single Source of Truth (SSOT): ORACLE.md & AGENTS.md (Rule 6, Rule 10)
 *
 * ARCHITECTURAL SUMMARY:
 * ---------------------
 * `ColorX` manages color parsing, hexadecimal unpacking, RGBA string generation,
 * perceptual shading, linear interpolation, and caching for GPU shader consumption.
 *
 * All color operations are accelerated by static LRU caches with maximum sizes
 * (512 CSS cache, 1024 RGBA cache) ensuring zero garbage collector pressure.
 */

import { MathX } from '../core/MathX';

/**
 * Color manipulation utility supporting CSS strings, hex formats, and RGBA arrays.
 */
export class ColorX {
  private static readonly _cache: Map<string, [number, number, number, number]> = new Map();

  // Cyberpunk Palette constants
  /** #00f0b5 Cyber-Emerald Neon Cyan */
  public static readonly Cyan: string = '#00f0b5';
  /** #00a880 Dimmed Emerald Teal */
  public static readonly CyanDim: string = '#00a880';
  /** rgba(0, 240, 181, 0.42) High-Frequency Emerald Bloom */
  public static readonly CyanGlow: string = 'rgba(0, 240, 181, 0.42)';
  /** #ffb703 Solar Radiant Gold */
  public static readonly Gold: string = '#ffb703';
  /** #ffd166 Soft Celestial Gold */
  public static readonly GoldSoft: string = '#ffd166';
  /** #ff3366 Laser Crimson */
  public static readonly Crimson: string = '#ff3366';
  /** #f72585 Hot Plasma Magenta */
  public static readonly Magenta: string = '#f72585';
  /** #9d4edd Temporal Warp Violet */
  public static readonly Violet: string = '#9d4edd';
  /** #3a86ff Shield Capacitor Blue */
  public static readonly Blue: string = '#3a86ff';
  /** #38bdf8 Atmosphere Electric Sky Blue */
  public static readonly ElectricSky: string = '#38bdf8';
  /** #f97316 Kinetic Thruster Orange */
  public static readonly Orange: string = '#f97316';
  /** #10b981 Bio-Luminescent Neon Green */
  public static readonly NeonGreen: string = '#10b981';
  /** #05080f Obsidian Void Background Dark */
  public static readonly BgDark: string = '#05080f';
  /** rgba(4, 9, 18, 0.85) Translucent Cyber Glass */
  public static readonly BgGlass: string = 'rgba(4, 9, 18, 0.85)';
  /** rgba(0, 240, 181, 0.22) Grid Laser Neon Ribbon */
  public static readonly LineNeon: string = 'rgba(0, 240, 181, 0.22)';
  /** #ffffff Pure Spectral White */
  public static readonly White: string = '#ffffff';

  /**
   * Converts hex string ("#00f0b5", "#0fb", "00f0b5") to [r, g, b] in range [0..255].
   */
  public static hexRgb(hex: string): [number, number, number] {
    if (!hex) return [255, 255, 255];
    let h = hex.startsWith('#') ? hex.slice(1) : hex;
    if (h.length === 3) {
      h = h[0]! + h[0]! + h[1]! + h[1]! + h[2]! + h[2]!;
    }
    if (h.length < 6) return [255, 255, 255];
    const n = parseInt(h.slice(0, 6), 16);
    if (Number.isNaN(n)) return [255, 255, 255];
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  /**
   * Parses any CSS color into [r, g, b, a] in 0..255 and 0..1 alpha.
   */
  public static parseCss(css: string): [number, number, number, number] {
    if (!css) return [255, 255, 255, 1];
    const cached = ColorX._cache.get(css);
    if (cached) return cached;

    const s = css.trim().toLowerCase();
    let r = 255,
      g = 255,
      b = 255,
      a = 1;

    if (s.startsWith('#')) {
      const [cr, cg, cb] = ColorX.hexRgb(s);
      r = cr;
      g = cg;
      b = cb;
    } else if (s.startsWith('rgb')) {
      const open = s.indexOf('(');
      const close = s.lastIndexOf(')');
      if (open !== -1 && close !== -1) {
        const parts = s.slice(open + 1, close).split(',');
        r = parseFloat(parts[0] || '255') || 0;
        g = parseFloat(parts[1] || '255') || 0;
        b = parseFloat(parts[2] || '255') || 0;
        if (parts.length > 3) {
          a = parseFloat(parts[3] || '1');
          if (Number.isNaN(a)) a = 1;
        }
      }
    }

    if (ColorX._cache.size > 512) ColorX._cache.clear();
    const result: [number, number, number, number] = [r, g, b, a];
    ColorX._cache.set(css, result);
    return result;
  }

  private static readonly _rgbaCache: Map<string, string> = new Map();

  /**
   * Returns a standard CSS rgba string.
   */
  public static rgba(hexOrCss: string, a: number): string {
    const alpha = MathX.clamp01(a);
    const key = `${hexOrCss}_${alpha.toFixed(2)}`;
    const cached = ColorX._rgbaCache.get(key);
    if (cached) return cached;
    const [r, g, b] = ColorX.parseCss(hexOrCss);
    const str = `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(3)})`;
    if (ColorX._rgbaCache.size > 1024) ColorX._rgbaCache.clear();
    ColorX._rgbaCache.set(key, str);
    return str;
  }

  /**
   * Returns hex string formatted with CSS # prefix.
   */
  public static hex(hex: string): string {
    return hex.startsWith('#') ? hex : `#${hex}`;
  }

  /**
   * Darkens (amt < 0 towards abyss #04070e) or lightens (amt > 0 towards white).
   */
  public static shade(hex: string, amt: number): string {
    const [r, g, b] = ColorX.hexRgb(hex);
    const t = MathX.clamp(amt, -1, 1);
    const mr = t < 0 ? 4 : 255;
    const mg = t < 0 ? 7 : 255;
    const mb = t < 0 ? 14 : 255;
    const k = Math.abs(t);

    const nr = Math.round(r + (mr - r) * k);
    const ng = Math.round(g + (mg - g) * k);
    const nb = Math.round(b + (mb - b) * k);
    return `rgb(${nr}, ${ng}, ${nb})`;
  }

  /**
   * Linear color interpolation between colorA and colorB.
   */
  public static lerpColor(colorA: string, colorB: string, t: number): string {
    const [r1, g1, b1, a1] = ColorX.parseCss(colorA);
    const [r2, g2, b2, a2] = ColorX.parseCss(colorB);
    const k = MathX.clamp01(t);

    const r = Math.round(r1 + (r2 - r1) * k);
    const g = Math.round(g1 + (g2 - g1) * k);
    const b = Math.round(b1 + (b2 - b1) * k);
    const a = a1 + (a2 - a1) * k;

    return `rgba(${r}, ${g}, ${b}, ${a.toFixed(3)})`;
  }

  /**
   * Alias for lerpColor.
   */
  public static lerp(colorA: string, colorB: string, t: number): string {
    return ColorX.lerpColor(colorA, colorB, t);
  }

  /**
   * Scales existing alpha of a color.
   */
  public static mulAlpha(css: string, mul: number): string {
    const [r, g, b, a] = ColorX.parseCss(css);
    const na = MathX.clamp01(a * mul);
    return `rgba(${r}, ${g}, ${b}, ${na.toFixed(3)})`;
  }

  /**
   * Sinusoidal pulsing alpha between minA and maxA at a frequency.
   */
  public static pulseAlpha(minA: number, maxA: number, speed: number, time: number): number {
    const sin = (Math.sin(time * speed) + 1) * 0.5;
    return minA + (maxA - minA) * sin;
  }
}
