/**
 * ============================================================================
 * SUPPRESSED LEGACY CANVAS2D RENDERER (Rule 12: Absolute Canvas2D Ban)
 * ============================================================================
 * Canvas 2D rendering is permanently banished from Ouroboros Ascension.
 * All boss archetypes, serpentine segmented bodies, and apex danger telegraphs
 * render strictly through pure WebGL 2.0 in WebGLGameRenderer.ts (drawBosses)
 * and GLBatch.ts.
 * All Canvas 2D methods in this file are suppressed stubs.
 * ============================================================================
 */

import { ITelegraphAttack } from './TelegraphRenderer';

export type { ITelegraphAttack };

export interface IBossSegment {
  x: number;
  y: number;
  r: number;
}

export interface IBossRenderData {
  x: number;
  y: number;
  type: string;
  radius: number;
  angle: number;
  color: string;
  accent: string;
  hp: number;
  maxHp: number;
  phase: number;
  hitFlash?: number;
  entranceTimer?: number;
  spiralAngle?: number;
  segments?: IBossSegment[];
  telegraphs?: ITelegraphAttack[];
}

export class BossRenderer {
  /**
   * Suppressed legacy Canvas2D draw method.
   * Inert stub adhering to AGENTS.md Rule 12.
   */
  public static draw(_ctx: any, _boss: IBossRenderData): void {
    // Suppressed: Rendered exclusively via WebGLGameRenderer
  }

  /**
   * Suppressed legacy Canvas2D telegraph draw method.
   * Inert stub adhering to AGENTS.md Rule 12.
   */
  public static drawTelegraph(_ctx: any, _t: ITelegraphAttack): void {
    // Suppressed: Rendered exclusively via WebGLGameRenderer
  }
}
