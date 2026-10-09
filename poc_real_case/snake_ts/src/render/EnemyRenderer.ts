/**
 * ============================================================================
 * SUPPRESSED LEGACY CANVAS2D RENDERER (Rule 12: Absolute Canvas2D Ban)
 * ============================================================================
 * Canvas 2D rendering is permanently banished from Ouroboros Ascension.
 * All enemies and mob archetypes render strictly through pure WebGL 2.0
 * in WebGLGameRenderer.ts (drawEnemies) and GLBatch.ts.
 * All Canvas 2D methods in this file are suppressed stubs.
 * ============================================================================
 */

export interface IEnemyRenderData {
  x: number;
  y: number;
  type: string;
  radius: number;
  angle: number;
  color: string;
  hp: number;
  maxHp: number;
  hitFlash?: number;
  spawnTimer?: number;
  charging?: boolean;
  shootTimer?: number;
  status?: {
    freezeTimer?: number;
    slowTimer?: number;
    burnTimer?: number;
  };
}

export class EnemyRenderer {
  /**
   * Suppressed legacy Canvas2D draw method.
   * Inert stub adhering to AGENTS.md Rule 12.
   */
  public static draw(_ctx: any, _enemy: IEnemyRenderData): void {
    // Suppressed: Rendered exclusively via WebGLGameRenderer
  }
}
