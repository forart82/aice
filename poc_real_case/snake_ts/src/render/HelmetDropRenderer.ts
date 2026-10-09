/**
 * ============================================================================
 * SUPPRESSED LEGACY CANVAS2D RENDERER (Rule 12: Absolute Canvas2D Ban)
 * ============================================================================
 * Canvas 2D rendering is permanently banished from Ouroboros Ascension.
 * All in-world helmet drops render strictly through pure WebGL 2.0
 * in WebGLGameRenderer.ts (drawHelmetDrops) and GLBatch.ts.
 * All Canvas 2D methods in this file are suppressed stubs.
 * ============================================================================
 */

import { HelmetDrop } from '../sim/HelmetDrop';

export class HelmetDropRenderer {
  /**
   * Suppressed legacy Canvas2D draw method.
   * Inert stub adhering to AGENTS.md Rule 12.
   */
  public static draw(_ctx: any, _drop: HelmetDrop): void {
    // Suppressed: Rendered exclusively via WebGLGameRenderer
  }
}
