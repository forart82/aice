/**
 * ============================================================================
 * Render Quality Settings (RenderQuality.ts)
 * Protocol 3.0 Pure WebGL 2.0 Engine Standard — Canvas2D Permanently Purged
 * ============================================================================
 *
 * Single Source of Truth (SSOT): ORACLE.md & AGENTS.md (Rule 6, Rule 10, Rule 12)
 *
 * ARCHITECTURAL MANDATE:
 * ---------------------
 * Defines graphics quality tiers (high, medium, low) and neon bloom/glow toggles
 * for pure WebGL 2.0 pipelines.
 */

export class RenderQuality {
  /** Enables or disables high-frequency neon bloom and additive glows. */
  public static glow: boolean = true;
  /** Active quality tier influencing particle counts and geometry LOD. */
  public static tier: 'high' | 'medium' | 'low' = 'high';

  /**
   * Sets active rendering quality tier and configures shader glow effects.
   *
   * @param tier Quality tier string ('high' | 'medium' | 'low')
   */
  public static set(tier: 'high' | 'medium' | 'low' | string): void {
    if (tier === 'low') {
      RenderQuality.tier = 'low';
      RenderQuality.glow = false;
    } else if (tier === 'medium') {
      RenderQuality.tier = 'medium';
      RenderQuality.glow = true;
    } else {
      RenderQuality.tier = 'high';
      RenderQuality.glow = true;
    }
  }
}

