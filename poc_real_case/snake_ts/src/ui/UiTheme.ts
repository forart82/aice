import { MathX } from '../core/MathX';

/**
 * ============================================================================
 * OUROBOROS ASCENSION — UI DESIGN SYSTEM & RESPONSIVE THEME (UiTheme.ts)
 * ============================================================================
 *
 * Central design token repository, typography scale, palette definitions, and
 * fluid mathematical helpers for the WebGL game HUD and DOM glassmorphic UI.
 *
 * 1. DESIGN TOKEN ARCHITECTURE:
 *    - Cyberpunk High-Contrast Palette: Neon cyan (#00f0b5), solar gold (#ffb703),
 *      crimson danger (#ff3366), and hyper magenta/violet (#f72585, #9d4edd).
 *    - Glassmorphism & Translucency: Multi-tier alpha backdrops (`BgGlass`,
 *      `BgGlassCard`, `BgGlassSoft`) paired with glowing edge borders (`LineGlow`).
 *    - Archetype Chromatic Identity: Color, accent, glow, and icon tokens mapping
 *      to serpent classes (Emerald Viper, Shadow Stalker, Hydra Behemoth, Storm Wyrm, Solar Drake).
 *    - Rarity Tiers: Standardized badge labels, borders, and glows (Common -> Legendary).
 *
 * 2. FLUID TYPOGRAPHY & SPATIAL SCALING MATHEMATICS:
 *    - Instead of rigid media query steps, UI elements calculate scale dynamically
 *      via viewport-width ratio clamping:
 *      $$S(w) = \text{round}\left(\max\left(S_{\min}, \min\left(S_{\max}, w \times R_{\text{vw}}\right)\right)\right)$$
 *    - Ensures pixel-perfect readability across 320px mobile displays up to 4K / ultrawide monitors.
 *
 * 3. COMBO TIER MULTIPLIERS & CHROMATIC SHIFTS:
 *    - Level 0 (<5): Combo Flow (Cyan, 1x)
 *    - Level 1 (5-14): Combo Blaze (Gold, 2x)
 *    - Level 2 (15-24): Mega Streak (Violet, 3x)
 *    - Level 3 (25-39): Hyper Godlike (Neon Pink, 5x)
 *    - Level 4 (40+): Ouroboros Overdrive (Supercharged Gold, 8x)
 * ============================================================================
 */
export class UiTheme {
  // Cyberpunk Palette
  public static readonly Cyan: string = '#00f0b5';
  public static readonly CyanDim: string = '#00a880';
  public static readonly CyanGlow: string = 'rgba(0, 240, 181, 0.42)';

  public static readonly Gold: string = '#ffb703';
  public static readonly GoldSoft: string = '#ffd166';
  public static readonly GoldGlow: string = 'rgba(255, 183, 3, 0.45)';

  public static readonly Crimson: string = '#ff3366';
  public static readonly CrimsonGlow: string = 'rgba(255, 51, 102, 0.45)';
  public static readonly Magenta: string = '#f72585';
  public static readonly Violet: string = '#9d4edd';
  public static readonly VioletGlow: string = 'rgba(157, 78, 221, 0.45)';
  public static readonly Blue: string = '#3a86ff';
  public static readonly BlueGlow: string = 'rgba(58, 134, 255, 0.45)';

  public static readonly ShieldLow: string = '#2563eb';
  public static readonly ShieldHigh: string = '#60a5fa';
  public static readonly ShieldGlow: string = 'rgba(96, 165, 250, 0.55)';
  public static readonly HpLow: string = '#ef4444';
  public static readonly HpFull: string = '#00f0b5';
  public static readonly BossLow: string = '#991b1b';
  public static readonly BossName: string = '#ff4d6d';
  public static readonly ShardText: string = '#ffd166';

  public static readonly Text: string = '#f8fafc';
  public static readonly TextSoft: string = '#cbd5e1';
  public static readonly TextMute: string = '#94a3b8';
  public static readonly TextDim: string = '#64748b';

  public static readonly Line: string = 'rgba(148, 163, 184, 0.18)';
  public static readonly LineStrong: string = 'rgba(0, 240, 181, 0.45)';
  public static readonly LineGlow: string = 'rgba(0, 240, 181, 0.35)';

  public static readonly BgDark: string = '#05080f';
  public static readonly BgGlass: string = 'rgba(4, 9, 18, 0.72)';
  public static readonly BgGlassCard: string = 'rgba(10, 20, 36, 0.65)';
  public static readonly BgGlassSoft: string = 'rgba(8, 16, 30, 0.55)';

  // Archetype Theme Definitions
  public static readonly ClassThemes: Record<string, { name: string; color: string; accent: string; glow: string; icon: string }> = {
    emerald: { name: 'Emerald Viper', color: '#00f0b5', accent: '#10b981', glow: 'rgba(0, 240, 181, 0.45)', icon: '🐍' },
    stalker: { name: 'Shadow Stalker', color: '#a855f7', accent: '#c77dff', glow: 'rgba(168, 85, 247, 0.45)', icon: '🥷' },
    hydra: { name: 'Hydra Behemoth', color: '#ef4444', accent: '#ff4d6d', glow: 'rgba(239, 68, 68, 0.45)', icon: '🐲' },
    storm: { name: 'Storm Wyrm', color: '#38bdf8', accent: '#7dd3fc', glow: 'rgba(56, 189, 248, 0.45)', icon: '⚡' },
    solar: { name: 'Solar Drake', color: '#f59e0b', accent: '#ffb703', glow: 'rgba(245, 158, 11, 0.45)', icon: '🔥' }
  };

  // Rarity Color Tokens
  public static readonly RarityColors: Record<string, { text: string; border: string; glow: string; badge: string }> = {
    common: { text: '#00f0b5', border: 'rgba(0, 240, 181, 0.5)', glow: 'rgba(0, 240, 181, 0.25)', badge: '★ COMMON' },
    rare: { text: '#3a86ff', border: 'rgba(58, 134, 255, 0.65)', glow: 'rgba(58, 134, 255, 0.35)', badge: '★★ RARE' },
    epic: { text: '#9d4edd', border: 'rgba(157, 78, 221, 0.75)', glow: 'rgba(157, 78, 221, 0.45)', badge: '★★★ EPIC' },
    legendary: { text: '#ffb703', border: 'rgba(255, 183, 3, 0.9)', glow: 'rgba(255, 183, 3, 0.55)', badge: '★★★★ LEGENDARY' }
  };

  /**
   * Evaluates current combo count to determine visual tier styling and score multiplier.
   * @param combo Continuous consecutive food/kill chain count
   */
  public static getComboColor(combo: number): { color: string; label: string; glow: string; mult: number } {
    if (combo >= 40) return { color: '#ffd166', label: '🐍 OUROBOROS OVERDRIVE', glow: 'rgba(255, 209, 102, 0.75)', mult: 8 };
    if (combo >= 25) return { color: '#ff0054', label: '⚡ HYPER GODLIKE', glow: 'rgba(255, 0, 84, 0.65)', mult: 5 };
    if (combo >= 15) return { color: '#9d4edd', label: '🔮 MEGA STREAK', glow: 'rgba(157, 78, 221, 0.55)', mult: 3 };
    if (combo >= 5) return { color: '#ffb703', label: '🔥 COMBO BLAZE', glow: 'rgba(255, 183, 3, 0.45)', mult: 2 };
    return { color: '#00f0b5', label: 'COMBO FLOW', glow: 'rgba(0, 240, 181, 0.35)', mult: 1 };
  }

  // Radii
  public static readonly RPill: number = 9999;
  public static readonly RLg: number = 16;
  public static readonly RMd: number = 10;
  public static readonly RSm: number = 6;

  /**
   * Fluid dimension calculator: computes viewport-proportional sizing constrained by bounds.
   *
   * Mathematical Formula:
   * $$S = \text{round}\left(\text{clamp}\left(w \cdot r_{\text{vw}}, S_{\min}, S_{\max}\right)\right)$$
   *
   * @param min Minimum permissible pixel size
   * @param vwRatio Viewport-width scaling fraction (e.g. 0.05 for 5% of vw)
   * @param max Maximum permissible pixel size
   * @param viewportWidth Current viewport width in CSS pixels
   */
  public static fluid(min: number, vwRatio: number, max: number, viewportWidth: number): number {
    const val = viewportWidth * vwRatio;
    return Math.round(MathX.clamp(val, min, max));
  }

  public static gameTitleSize(vw: number): number {
    return UiTheme.fluid(26, 0.052, 48, vw);
  }

  public static draftTitleSize(vw: number): number {
    return UiTheme.fluid(16, 0.032, 28, vw);
  }

  public static subtitleSize(vw: number): number {
    return UiTheme.fluid(11, 0.018, 14, vw);
  }

  public static modalPadding(vw: number): number {
    return UiTheme.fluid(12, 0.024, 28, vw);
  }

  public static hudFont(vw: number, vh: number): number {
    if (UiTheme.isShortLandscape(vw, vh)) return 10.5;
    return UiTheme.fluid(10, 0.014, 14, vw);
  }

  /**
   * Derives outer padding margin for HUD top vitals row based on viewport aspect ratio.
   * Compresses to 10px on short landscape displays to maximize arena visibility.
   */
  public static hudPad(vw: number, vh: number): number {
    if (UiTheme.isShortLandscape(vw, vh)) return 10;
    return UiTheme.fluid(10, 0.018, 24, vw);
  }

  /**
   * Determines whether the layout engine should reflow the HUD into compact portrait mode.
   * Rationale: Viewport width <= 740px, aspect ratio < 1.4, or height <= 440px lacks
   * horizontal margin for dual-column vitals and mission panels.
   */
  public static isPortraitHud(vw: number, vh: number): boolean {
    return vw <= 740 || (vh > 0 && vw / vh < 1.4) || (vh <= 440);
  }

  /**
   * Detects ultra-compact landscape mobile devices (e.g. iPhone horizontal orientation)
   * where vertical pixel real estate is constrained ($vh \le 440\text{px}$).
   */
  public static isShortLandscape(vw: number, vh: number): boolean {
    return vh <= 440 && vw > vh;
  }
}

