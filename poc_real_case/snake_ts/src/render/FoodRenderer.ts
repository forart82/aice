/**
 * ============================================================================
 * SUPPRESSED LEGACY CANVAS2D RENDERER (Rule 12: Absolute Canvas2D Ban)
 * ============================================================================
 * Canvas 2D rendering is permanently banished from Ouroboros Ascension.
 * All food pickups render strictly through the GPU texture atlas and SDF shaders
 * in WebGLAssetAtlas.ts and WebGLGameRenderer.ts (drawFood).
 * All Canvas 2D methods in this file are suppressed stubs.
 * ============================================================================
 */

export interface IFoodRenderData {
  x: number;
  y: number;
  type: string;
  radius: number;
  color: string;
  pulse?: number;
  spawnScale?: number;
}

export class FoodRenderer {
  public static readonly _stampCache: Map<string, any> = new Map();

  /**
   * Suppressed legacy Canvas2D food stamp method.
   * Food pickups are pre-baked into the unified GPU texture atlas via WebGLAssetAtlas.
   */
  public static getStamp(_type: string, _color: string = '#10b981', _glow: boolean = true): HTMLCanvasElement | null {
    return null;
  }

  /**
   * Suppressed legacy Canvas2D draw method.
   * Inert stub adhering to AGENTS.md Rule 12.
   */
  public static draw(_ctx: any, _food: IFoodRenderData, _pulse: number = 0): void {
    // Suppressed: Rendered exclusively via WebGLGameRenderer / WebGLAssetAtlas
  }
}
