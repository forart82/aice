/**
 * ============================================================================
 * Hardware-Accelerated Pure WebGL Game Renderer (GameRenderer.ts)
 * Protocol 3.0 Commercial Engine Edition — Canvas2D Permanently Purged (Rule 12)
 * ============================================================================
 *
 * Single Source of Truth (SSOT): ORACLE.md & AGENTS.md (Rule 6, Rule 10, Rule 12)
 * Feature TDD Spec: docs/tdd/architecture_render_refactoring.tdd.md
 *
 * ARCHITECTURAL MANDATE:
 * ---------------------
 * HTML5 Canvas 2D has been completely eradicated from the rendering pipeline.
 * GameRenderer delegates strictly, unconditionally, and exclusively to the
 * high-performance WebGL 2.0 pipeline (WebGLGameRenderer / GLBatch).
 */

import { WebGLGameRenderer } from './WebGLGameRenderer';
import { GameEngine } from '../sim/GameEngine';
import { ArenaBackdrop } from './ArenaBackdrop';
import { FxManager } from './FxManager';

export type IRenderTarget =
  | WebGLGameRenderer
  | { render(engine: GameEngine, fx?: FxManager): void }
  | WebGLRenderingContext
  | WebGL2RenderingContext
  | null;

export class GameRenderer {
  public static backdrop = new ArenaBackdrop();

  /**
   * Primary entry point for rendering the game world.
   * Strictly delegates to the WebGL 2.0 rendering engine.
   */
  public static render(engine: GameEngine, fx?: FxManager): void;
  public static render(target: IRenderTarget, engine: GameEngine, fx?: FxManager): void;
  public static render(
    targetOrEngine: IRenderTarget | GameEngine,
    engineOrFx?: GameEngine | FxManager,
    fx?: FxManager
  ): void {
    GameRenderer.draw(targetOrEngine as any, engineOrFx as any, fx);
  }

  /**
   * Unconditional WebGL 2.0 drawing dispatch.
   * Completely bypasses and purges all legacy Canvas 2D pathways.
   */
  public static draw(engine: GameEngine, fx?: FxManager): void;
  public static draw(target: IRenderTarget, engine: GameEngine, fx?: FxManager): void;
  public static draw(
    targetOrEngine: IRenderTarget | GameEngine,
    engineOrFx?: GameEngine | FxManager,
    fx?: FxManager
  ): void {
    // If called as GameRenderer.draw(webglRenderer, engine, fx)
    if (
      targetOrEngine &&
      typeof (targetOrEngine as any).render === 'function' &&
      (targetOrEngine as unknown) !== WebGLGameRenderer &&
      !(targetOrEngine instanceof GameEngine)
    ) {
      (targetOrEngine as any).render(engineOrFx, fx);
      return;
    }

    // If called as GameRenderer.draw(engine, fx)
    if (targetOrEngine instanceof GameEngine) {
      WebGLGameRenderer.render(null, targetOrEngine, engineOrFx as FxManager | undefined);
      return;
    }

    // Default: delegate directly to WebGLGameRenderer.render(glCtx, engine, fx)
    WebGLGameRenderer.render(targetOrEngine as any, engineOrFx as GameEngine, fx);
  }
}
