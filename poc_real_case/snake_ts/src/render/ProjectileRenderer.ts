/**
 * ============================================================================
 * SUPPRESSED LEGACY CANVAS2D RENDERER (Rule 12: Absolute Canvas2D Ban)
 * ============================================================================
 * Canvas 2D rendering is permanently banished from Ouroboros Ascension.
 * All combat projectiles render strictly through pure WebGL 2.0 in
 * WebGLGameRenderer.ts (drawProjectiles) and GLBatch.ts.
 * All Canvas 2D methods in this file are suppressed stubs.
 * ============================================================================
 */

export interface IProjectileRenderData {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  color: string;
  life: number;
  maxLife: number;
  trail?: boolean;
}

export class ProjectileRenderer {
  /**
   * Suppressed legacy Canvas2D draw method.
   * Inert stub adhering to AGENTS.md Rule 12.
   */
  public static draw(_ctx: any, _proj: IProjectileRenderData): void {
    // Suppressed: Rendered exclusively via WebGLGameRenderer
  }
}
