/**
 * ============================================================================
 * Hardware-Accelerated WebGL Game Renderer (WebGLGameRenderer.ts)
 * 100% Non-Regression ISO Visual Parity Edition
 * Ouroboros Ascension — Protocol 3.0 Commercial Engine Edition
 * ============================================================================
 *
 * Single Source of Truth (SSOT): ORACLE.md & AGENTS.md (Rule 6, Rule 10, Rule 12)
 * Feature TDD Spec: docs/tdd/architecture_render_refactoring.tdd.md
 *
 * ARCHITECTURAL SUMMARY:
 * ---------------------
 * `WebGLGameRenderer` implements the complete, 100% ISO-visual and ISO-functional
 * hardware-accelerated rendering pipeline matching the visual fidelity and
 * mathematical formulation of Native Canvas2D (`Ctx2D`) across all entities,
 * backdrops, menus, particles, and combat telegraphs.
 *
 * RENDERING & TRANSFORMS (Rule 10):
 * --------------------------------
 * 1. Coordinate Space Hierarchy:
 *    - World Space:    [0, arenaW] x [0, arenaH] where player, enemies, and bosses live.
 *    - Camera Offset:  Injected via fx.offsetX / fx.offsetY to produce high-impact screen shake.
 *    - Screen Space:   [0, logicalW] x [0, logicalH] (e.g. 1200x800 desktop, 360x640 mobile).
 *    - Viewport Space: [0, physicalW] x [0, physicalH] (gl.viewport pixels = logical * DPR).
 *    - Clip / NDC:     [-1, 1] x [-1, 1] (WebGL normalized device coordinate cube).
 *
 * 2. Device Pixel Ratio (DPR) Compensation & Mobile TBDR Optimization:
 *    - Desktop Viewports: DPR is clamped to [1.0, 2.0] for crisp high-DPI retinal presentation.
 *    - Mobile Viewports:  DPR is strictly clamped to 1.0 (isMobile: width <= 768 or touch active).
 *      Modern smartphone OLED displays feature 400+ PPI (e.g. 1080x2400 or 1440x3120). Rendering at
 *      native 2.5x-3.0x DPR saturates the tile memory and fillrate of mobile Tile-Based Deferred
 *      Renderers (Adreno / Mali TBDR GPUs), resulting in 10-25 FPS frame drops. Capping at 1.0 DPR
 *      guarantees a locked, fluid 60 FPS mobile gaming experience.
 *
 * 3. 7.5-Pass Multi-Layer Cybernetic Serpentine Pipeline:
 *    - Pass 1: Outer Bio-Luminescent Aura (dilated width, additive blend mode).
 *    - Pass 2: Underbody Ventral Shadow & Carapace Rim (normal blend, depth anchor).
 *    - Pass 3: Serpentine Muscular Core Mesh Ribbon (mitered quad extrusion, head-to-tail taper).
 *    - Pass 4: Dorsal Scale Plates & Segment Articulation Ticks (directional cross-ribs).
 *    - Pass 5: Spinal Luminescent Laser Conduit (high-intensity white core + neon mantle).
 *    - Pass 6: Cranial Head Anatomy & Sockets (mandibles, jaws, compound eyes, class crests).
 *    - Pass 7: Equipped Boss Helmets (6 archetypes with rotational anchoring).
 *    - Pass 7.5: Hurt Flash & Invulnerability Modulation (stroboscopic alpha flicker).
 *
 * 4. GPU Resource Lifecycle & Resilience:
 *    - Context Loss (`webglcontextlost`): Calls `preventDefault()` to prevent tab termination,
 *      marks renderer not-ready, and flushes GPU texture references.
 *    - Context Restore (`webglcontextrestored`): Automatically recompiles shaders, re-allocates
 *      geometry buffers, and repopulates procedural asset atlases.
 */

import { GLBatch, GLBlendMode } from './GLBatch';
import { WebGLContext, GLPrimitive } from './WebGLContext';
import { GameEngine } from '../../sim/GameEngine';
import { GameState } from '../../sim/GameState';
import { FxManager } from '../FxManager';
import { GameData } from '../../data/GameData';
import { ColorX } from '../ColorX';
import { MathX } from '../../core/MathX';
import { Rng } from '../../core/Rng';
import { HELMET_RARITY_COLORS, HelmetRarity } from '../../data/Helmets';
import { FoodRenderer, IFoodRenderData } from '../FoodRenderer';
import { GameRenderer } from '../GameRenderer';
import { SnakeRenderer, ISnakeRenderData } from '../SnakeRenderer';
import { EnemyRenderer, IEnemyRenderData } from '../EnemyRenderer';
import { BossRenderer, IBossRenderData } from '../BossRenderer';
import { ProjectileRenderer, IProjectileRenderData } from '../ProjectileRenderer';
import { HelmetDrop } from '../../sim/HelmetDrop';
import { OuroborosMenuAnimation } from '../OuroborosMenuAnimation';
import { WebGLAssetAtlas } from './WebGLAssetAtlas';
import { Services } from '../../core/Services';
import { TelegraphRenderer, ITelegraphAttack, IHazardRenderData } from '../TelegraphRenderer';

export interface IWebGLStar {
  x: number;
  y: number;
  size: number;
  depth: number;
  layer: number;
  baseAlpha: number;
  phase: number;
  twinkleSpeed: number;
  colorType: number;
}

export class WebGLGameRenderer {
  public readonly isWebGL: boolean = true;
  public readonly canvas: HTMLCanvasElement | null = null;
  public readonly gl: WebGLRenderingContext | WebGL2RenderingContext | null = null;
  public readonly batch: GLBatch;
  public readonly context: WebGLContext;

  public dpr: number = 1;
  public logicalWidth: number = 1200;
  public logicalHeight: number = 800;

  private _ready: boolean = false;
  private _boundContextLost: ((e: any) => void) | null = null;
  private _boundContextRestored: (() => void) | null = null;
  private static _batchMap: WeakMap<object, GLBatch> = new WeakMap();
  private static _fallbackBatch: GLBatch | null = null;
  private static _stars: IWebGLStar[] | null = null;
  private static _staticMicroStars: Array<{ x: number; y: number; size: number; alpha: number }> | null = null;
  private static _ouroMenu: OuroborosMenuAnimation | null = null;
  private static _foodTextureCache: Map<string, WebGLTexture> = new Map();
  private static _backdropTextureCache: Map<string, WebGLTexture> = new Map();

  private static readonly _FLOOR_HUES: Record<number, { base: string; mid: string; grid: string; accent: string; secondary?: string }> = {
    1: { base: '#030d11', mid: '#059669', grid: '#00f0b5', accent: '#00f0b5', secondary: '#047857' },
    2: { base: '#040a1c', mid: '#1d4ed8', grid: '#38bdf8', accent: '#38bdf8', secondary: '#7c3aed' },
    3: { base: '#100507', mid: '#d97706', grid: '#fbbf24', accent: '#ffb703', secondary: '#dc2626' },
    4: { base: '#031016', mid: '#0891b2', grid: '#22d3ee', accent: '#22d3ee', secondary: '#0d9488' },
    5: { base: '#0c0418', mid: '#9333ea', grid: '#c084fc', accent: '#c084fc', secondary: '#f43f5e' },
  };

  private static readonly _playerSerpentineSpec = {
    x: 0,
    y: 0,
    angle: 0,
    headRadius: 12,
    color: '#00f0b5',
    accent: '#10b981',
    segments: [] as any[],
    invulnerableTimer: 0,
    hurtFlash: 0,
  };

  // Zero-Allocation Static Bestiary Geometries
  private static readonly _NORM_TEARDROP: readonly [number, number][] = [
    [0, -1.15],
    [0.45, -0.7],
    [0.85, -0.05],
    [0.92, 0.45],
    [0.75, 0.85],
    [0, 1.05],
    [-0.75, 0.85],
    [-0.92, 0.45],
    [-0.85, -0.05],
    [-0.45, -0.7],
  ];
  private static readonly _NORM_DRONE: readonly [number, number][] = [
    [1.1, 0],
    [0.2, -0.85],
    [-1.0, -0.55],
    [-1.0, 0.55],
    [0.2, 0.85],
  ];
  private static readonly _NORM_RAM: readonly [number, number][] = [
    [1.2, 0],
    [0, -1.0],
    [-0.9, -0.6],
    [-0.9, 0.6],
    [0, 1.0],
  ];

  private static readonly _scratchTeardropPts: Array<{ x: number; y: number }> = Array.from({ length: 10 }, () => ({ x: 0, y: 0 }));
  private static readonly _scratchDronePts: Array<{ x: number; y: number }> = Array.from({ length: 5 }, () => ({ x: 0, y: 0 }));
  private static readonly _scratchDroneClosedPts: Array<{ x: number; y: number }> = Array.from({ length: 6 }, () => ({ x: 0, y: 0 }));
  private static readonly _scratchCrescentPts: Array<{ x: number; y: number }> = Array.from({ length: 10 }, () => ({ x: 0, y: 0 }));
  private static readonly _scratchRamPts: Array<{ x: number; y: number }> = Array.from({ length: 5 }, () => ({ x: 0, y: 0 }));
  private static readonly _scratchRamClosedPts: Array<{ x: number; y: number }> = Array.from({ length: 6 }, () => ({ x: 0, y: 0 }));
  private static readonly _scratchScarabArcPts: Array<{ x: number; y: number }> = Array.from({ length: 7 }, () => ({ x: 0, y: 0 }));

  // Zero-Allocation Static Boss Geometries
  private static _scratchBossNodes: Array<{ x: number; y: number }> = Array.from({ length: 128 }, () => ({ x: 0, y: 0 }));
  private static readonly _scratchHexPts: Array<{ x: number; y: number }> = Array.from({ length: 6 }, () => ({ x: 0, y: 0 }));
  private static readonly _scratchHexClosedPts: Array<{ x: number; y: number }> = Array.from({ length: 7 }, () => ({ x: 0, y: 0 }));
  private static readonly _scratchGorgonPts: Array<{ x: number; y: number }> = Array.from({ length: 5 }, () => ({ x: 0, y: 0 }));
  private static readonly _scratchGorgonClosedPts: Array<{ x: number; y: number }> = Array.from({ length: 6 }, () => ({ x: 0, y: 0 }));
  private static readonly _scratchStarPts: Array<{ x: number; y: number }> = Array.from({ length: 8 }, () => ({ x: 0, y: 0 }));
  private static readonly _scratchStarClosedPts: Array<{ x: number; y: number }> = Array.from({ length: 9 }, () => ({ x: 0, y: 0 }));
  private static readonly _scratchLeviathanArcPts: Array<{ x: number; y: number }> = Array.from({ length: 7 }, () => ({ x: 0, y: 0 }));
  private static readonly _HORN_SIDES: readonly number[] = [-1, 1];
  private static readonly _bossSerpentineSpec: any = {
    x: 0,
    y: 0,
    angle: 0,
    headRadius: 0,
    color: '',
    accent: '',
    segments: null,
  };

  /**
   * Retrieves or creates a GPU WebGLTexture from a FoodRenderer pre-rendered stamp.
   */
  public static getFoodTexture(glCtx: any, type: string, color: string, glow: boolean = true): WebGLTexture | null {
    if (!glCtx || typeof glCtx.createTexture !== 'function') return null;
    const key = `${type}_${color}_${glow ? '1' : '0'}`;
    const cached = this._foodTextureCache.get(key);
    if (cached) return cached;

    const stamp = FoodRenderer.getStamp(type, color, glow);
    if (!stamp) return null;

    try {
      const tex = glCtx.createTexture();
      if (!tex) return null;
      glCtx.bindTexture(glCtx.TEXTURE_2D || 3553, tex);
      glCtx.texParameteri(glCtx.TEXTURE_2D || 3553, glCtx.TEXTURE_MIN_FILTER || 10241, glCtx.LINEAR || 9729);
      glCtx.texParameteri(glCtx.TEXTURE_2D || 3553, glCtx.TEXTURE_MAG_FILTER || 10240, glCtx.LINEAR || 9729);
      glCtx.texParameteri(glCtx.TEXTURE_2D || 3553, glCtx.TEXTURE_WRAP_S || 10242, glCtx.CLAMP_TO_EDGE || 33071);
      glCtx.texParameteri(glCtx.TEXTURE_2D || 3553, glCtx.TEXTURE_WRAP_T || 10243, glCtx.CLAMP_TO_EDGE || 33071);
      glCtx.texImage2D(
        glCtx.TEXTURE_2D || 3553,
        0,
        glCtx.RGBA || 6408,
        glCtx.RGBA || 6408,
        glCtx.UNSIGNED_BYTE || 5121,
        stamp
      );
      this._foodTextureCache.set(key, tex);
      return tex;
    } catch {
      return null;
    }
  }

  /**
   * Retrieves or creates a GPU WebGLTexture from an ArenaBackdrop baked nebula canvas.
   * Delegates directly to WebGLAssetAtlas for unified caching and zero-per-frame-upload guarantees.
   */
  public static getBackdropTexture(glCtx: any, w: number, h: number, floor: number = 1): WebGLTexture | null {
    if (!glCtx || typeof glCtx.createTexture !== 'function') return null;
    return WebGLAssetAtlas.getBackdropTexture(glCtx, floor, w, h);
  }

  /**
   * Invalidates and flushes cached GPU textures.
   * If a WebGL rendering context is provided, actively invokes `deleteTexture`
   * on all retained texture objects to prevent GPU VRAM leakage (AGENTS.md Rule 10).
   *
   * @param gl Optional WebGLRenderingContext or WebGL2RenderingContext
   */
  public static clearTextureCaches(gl?: any): void {
    if (gl && typeof gl.deleteTexture === 'function') {
      for (const tex of this._foodTextureCache.values()) {
        try {
          gl.deleteTexture(tex);
        } catch {}
      }
      for (const tex of this._backdropTextureCache.values()) {
        try {
          gl.deleteTexture(tex);
        } catch {}
      }
    }
    this._foodTextureCache.clear();
    this._backdropTextureCache.clear();
    WebGLAssetAtlas.clear(gl);
  }

  constructor(canvas?: HTMLCanvasElement | any) {
    this.canvas = canvas || null;
    this.context = new WebGLContext();

    if (canvas && typeof canvas.getContext === 'function') {
      const ok = this.context.init(canvas);
      if (ok) {
        this.gl = this.context.gl;
        this._ready = true;
      }
    } else if (canvas && canvas.drawingBufferWidth !== undefined) {
      // Direct WebGL context passed as constructor argument
      this.gl = canvas;
      this.context.gl = canvas;
      this.context.isSupported = true;
      this._ready = true;
    }

    this.batch = new GLBatch(this.context);
    this.logicalWidth = canvas && canvas.width ? canvas.width : 1200;
    this.logicalHeight = canvas && canvas.height ? canvas.height : 800;

    // Attach WebGL context loss and restoration event listeners (AGENTS.md Rule 10)
    // To prevent browser tab crashes and unhandled GPU driver resets, context loss events
    // must call preventDefault() to allow WebGL restoration when available.
    this._boundContextLost = (e: any) => this.handleContextLost(e);
    this._boundContextRestored = () => this.handleContextRestored();

    if (this.canvas && typeof this.canvas.addEventListener === 'function') {
      this.canvas.addEventListener('webglcontextlost', this._boundContextLost, false);
      this.canvas.addEventListener('webglcontextrestored', this._boundContextRestored, false);
    }

    if (this._ready && this.gl) {
      WebGLAssetAtlas.initFoodAtlas(this.gl);
      WebGLAssetAtlas.prebakeBackdrops(this.gl, this.logicalWidth, this.logicalHeight, [1, 2, 3, 4, 5]);
      if (this.logicalWidth !== 960 || this.logicalHeight !== 640) {
        WebGLAssetAtlas.prebakeBackdrops(this.gl, 960, 640, [1, 2, 3, 4, 5]);
      }
    }
  }

  /**
   * Responds to WebGL Context Loss (`webglcontextlost`) event.
   * Cancels default browser teardown via `e.preventDefault()`, sets ready state to false,
   * and clears texture references so stale GPU pointers are not referenced during lost state.
   */
  public handleContextLost(e?: any): void {
    if (e && typeof e.preventDefault === 'function') {
      e.preventDefault();
    }
    this._ready = false;
    WebGLGameRenderer.clearTextureCaches(this.gl);
  }

  /**
   * Responds to WebGL Context Restored (`webglcontextrestored`) event.
   * Reinitializes shader pipelines, recompiles geometry buffers, and repopulates atlas caches.
   */
  public handleContextRestored(): void {
    if (this.canvas && typeof this.canvas.getContext === 'function') {
      const ok = this.context.init(this.canvas);
      if (ok) {
        (this as any).gl = this.context.gl;
        this._ready = true;
        if (this.gl) {
          WebGLAssetAtlas.initFoodAtlas(this.gl);
          WebGLAssetAtlas.prebakeBackdrops(this.gl, this.logicalWidth, this.logicalHeight, [1, 2, 3, 4, 5]);
        }
      }
    } else {
      this._ready = true;
    }
  }

  /**
   * Disposes the WebGL renderer: unbinds context listeners, releases batch memory buffers,
   * drops GL program and texture references, and marks the renderer as inactive.
   */
  public dispose(): void {
    if (this.canvas && typeof this.canvas.removeEventListener === 'function') {
      if (this._boundContextLost) {
        this.canvas.removeEventListener('webglcontextlost', this._boundContextLost, false);
        this._boundContextLost = null;
      }
      if (this._boundContextRestored) {
        this.canvas.removeEventListener('webglcontextrestored', this._boundContextRestored, false);
        this._boundContextRestored = null;
      }
    }
    WebGLGameRenderer.clearTextureCaches(this.gl);
    if (this.batch && typeof this.batch.dispose === 'function') {
      this.batch.dispose();
    }
    if (this.context && typeof this.context.dispose === 'function') {
      this.context.dispose();
    }
    this._ready = false;
    (this as any).gl = null;
    (this as any).canvas = null;
  }

  /**
   * Safely checks if WebGL context can be created in the current environment.
   */
  public static isSupported(canvas?: HTMLCanvasElement | null): boolean {
    if (typeof window === 'undefined' && typeof document === 'undefined') return false;
    if (!canvas || typeof canvas.getContext !== 'function') return false;
    try {
      const gl = (canvas.getContext('webgl2') ||
        canvas.getContext('webgl') ||
        canvas.getContext('experimental-webgl')) as any;
      return !!gl && typeof gl.createShader === 'function';
    } catch {
      return false;
    }
  }

  /**
   * Factory method to safely create a WebGLGameRenderer instance or return null if unsupported.
   */
  public static create(canvas?: HTMLCanvasElement | null): WebGLGameRenderer | null {
    if (!WebGLGameRenderer.isSupported(canvas)) return null;
    return new WebGLGameRenderer(canvas);
  }

  public isReady(): boolean {
    return this._ready;
  }

  public resize(width: number, height: number): void {
    const rawDpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    const isMobile =
      width <= 768 ||
      Math.min(width, height) <= 500 ||
      (typeof window !== 'undefined' &&
        ('ontouchstart' in window || (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0)));

    // Mobile DPR Calibration (Rule 10): On smartphone/mobile viewports, clamp DPR strictly to 1.0.
    // Modern OLED phone screens have 400+ PPI; running WebGL at 2x-3x DPR exhausts mobile TBDR GPU
    // fillrate and causes 5-15 FPS drops. Running at 1.0 DPR guarantees a fluid 60 FPS experience.
    this.dpr = isMobile ? 1.0 : Math.min(2.0, Math.max(1.0, rawDpr));
    this.logicalWidth = Math.max(1, width);
    this.logicalHeight = Math.max(1, height);

    const physicalW = Math.max(1, Math.round(width * this.dpr));
    const physicalH = Math.max(1, Math.round(height * this.dpr));

    if (this.canvas) {
      if (this.canvas.width !== physicalW || this.canvas.height !== physicalH) {
        this.canvas.width = physicalW;
        this.canvas.height = physicalH;
      }
    }

    if (this.gl && typeof this.gl.viewport === 'function') {
      this.gl.viewport(0, 0, physicalW, physicalH);
    }
    this.batch.width = this.logicalWidth;
    this.batch.height = this.logicalHeight;

    if (this.gl) {
      WebGLAssetAtlas.prebakeBackdrops(this.gl, this.logicalWidth, this.logicalHeight, [1, 2, 3, 4, 5]);
    }
  }

  public beginFrame(): void {
    this.batch.begin(this.logicalWidth, this.logicalHeight);
  }

  public flush(): void {
    this.batch.flush();
  }

  // ---------------------------------------------------------------- Primitive Batching Helpers

  public drawRect(
    x: number,
    y: number,
    w: number,
    h: number,
    r: number = 1,
    g: number = 1,
    b: number = 1,
    a: number = 1
  ): void {
    const col = `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${a})`;
    this.batch.drawQuad(x, y, w, h, col, 0);
  }

  public drawCircle(
    cx: number,
    cy: number,
    radius: number,
    r: number = 1,
    g: number = 1,
    b: number = 1,
    a: number = 1
  ): void {
    const col = `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${a})`;
    this.batch.drawCircle(cx, cy, radius, col, 0);
  }

  public drawLine(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    width: number = 1,
    r: number = 1,
    g: number = 1,
    b: number = 1,
    a: number = 1
  ): void {
    const col = `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${a})`;
    this.batch.drawLine(x1, y1, x2, y2, width, col);
  }

  public drawRing(
    cx: number,
    cy: number,
    innerRadius: number,
    outerRadius: number,
    r: number = 1,
    g: number = 1,
    b: number = 1,
    a: number = 1
  ): void {
    const col = `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${a})`;
    const thick = Math.max(1, outerRadius - innerRadius);
    this.batch.drawRing(cx, cy, (innerRadius + outerRadius) * 0.5, thick, col, 0);
  }

  public drawLaserRibbon(
    points: Array<{ x: number; y: number }>,
    width: number,
    r: number = 1,
    g: number = 1,
    b: number = 1,
    a: number = 1
  ): void {
    const col = `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${a})`;
    this.batch.drawPolyline(points, width, col, 4);
  }

  /**
   * Instance render dispatch.
   */
  public render(engine: GameEngine, fx?: FxManager): void {
    this.draw(engine, fx);
  }

  /**
   * Dedicated renderWorld method for complete scene rendering.
   */
  public renderWorld(engine: GameEngine, fx?: FxManager): void {
    this.render(engine, fx);
  }

  /**
   * Dedicated renderSnake method for rendering serpentine player mesh.
   */
  public renderSnake(player: ISnakeRenderData | any, batch?: GLBatch): void {
    const targetBatch = batch ?? this.batch;
    const wasInBatch = targetBatch.inBatch;
    if (!wasInBatch) {
      targetBatch.begin(this.canvas?.width || 1280, this.canvas?.height || 720);
    }
    WebGLGameRenderer.drawPlayer(targetBatch, player);
    if (!wasInBatch) {
      targetBatch.flush();
    }
  }

  /**
   * Dedicated renderBackdrop method for rendering background, starfield, and arena boundary.
   */
  public renderBackdrop(
    w?: number,
    h?: number,
    frenzyActive?: boolean,
    frameCount?: number,
    floor?: number,
    batch?: GLBatch
  ): void {
    const targetBatch = batch ?? this.batch;
    const arenaW = w ?? this.canvas?.width ?? 1280;
    const arenaH = h ?? this.canvas?.height ?? 720;
    const wasInBatch = targetBatch.inBatch;
    if (!wasInBatch) {
      targetBatch.begin(arenaW, arenaH);
    }
    WebGLGameRenderer.drawBackdrop(
      targetBatch,
      arenaW,
      arenaH,
      frenzyActive ?? false,
      frameCount ?? 0,
      floor ?? 1
    );
    if (!wasInBatch) {
      targetBatch.flush();
    }
  }

  /**
   * Instance draw dispatch.
   * Renders the game scene directly through the pure WebGL batch pipeline.
   * Guarantees zero per-frame canvas allocation and zero full-canvas texture uploads.
   */
  public draw(engine: GameEngine, fx?: FxManager): void {
    WebGLGameRenderer.renderWithBatch(this.batch, engine, fx);
  }

  // ---------------------------------------------------------------- Static Entry Points

  /**
   * Retrieves or creates a GLBatch instance bound to the provided WebGL context.
   */
  public static getBatch(glCtx: any): GLBatch {
    if (!glCtx || typeof glCtx !== 'object') {
      if (!this._fallbackBatch) {
        this._fallbackBatch = new GLBatch(null);
      }
      return this._fallbackBatch;
    }

    let batch = this._batchMap.get(glCtx);
    if (!batch) {
      batch = new GLBatch(glCtx);
      this._batchMap.set(glCtx, batch);
    }
    return batch;
  }

  /**
   * Primary static entry point for rendering the game world via WebGL.
   */
  public static render(glCtx: any, engine: GameEngine, fx?: FxManager): void {
    WebGLGameRenderer.drawStatic(glCtx, engine, fx);
  }

  /**
   * Static renderWorld dispatch.
   */
  public static renderWorld(batch: GLBatch, engine: GameEngine, fx?: FxManager): void {
    WebGLGameRenderer.renderWithBatch(batch, engine, fx);
  }

  /**
   * Static renderSnake dispatch.
   */
  public static renderSnake(batch: GLBatch, player: ISnakeRenderData | any): void {
    WebGLGameRenderer.drawPlayer(batch, player);
  }

  /**
   * Static renderBackdrop dispatch.
   */
  public static renderBackdrop(
    batch: GLBatch,
    w: number,
    h: number,
    frenzyActive: boolean = false,
    frameCount: number = 0,
    floor: number = 1
  ): void {
    WebGLGameRenderer.drawBackdrop(batch, w, h, frenzyActive, frameCount, floor);
  }

  /**
   * Main static rendering routine.
   */
  public static draw(glCtx: any, engine: GameEngine, fx?: FxManager): void {
    WebGLGameRenderer.drawStatic(glCtx, engine, fx);
  }

  private static drawStatic(glCtx: any, engine: GameEngine, fx?: FxManager): void {
    const batch = WebGLGameRenderer.getBatch(glCtx);
    WebGLGameRenderer.renderWithBatch(batch, engine, fx);
  }

  private static renderWithBatch(batch: GLBatch, engine: GameEngine, fx?: FxManager): void {
    const w = engine.arenaW || engine.ArenaW || batch.width || 960;
    const h = engine.arenaH || engine.ArenaH || batch.height || 640;
    const frameCount = engine.frameCount || 0;
    const floor = engine.currentFloor || (engine as any).floor || 1;
    const isPlaying =
      engine.state === GameState.Playing ||
      engine.state === GameState.Paused ||
      engine.state === GameState.LevelUp ||
      engine.state === GameState.FloorClear;
    const frenzyActive = engine.combat ? engine.combat.frenzyActive : false;

    // Apply screen shake camera offsets
    const camX = fx ? (fx.offsetX || 0) : 0;
    const camY = fx ? (fx.offsetY || 0) : 0;

    batch.begin(w, h, -camX, -camY);

    // 1. Render Cosmic Backdrop & Grid
    WebGLGameRenderer.drawBackdrop(batch, w, h, frenzyActive, frameCount, floor);

    const isIdleScreen =
      engine.state === GameState.Title ||
      engine.state === GameState.GameOver;

    if (isIdleScreen && !isPlaying) {
      WebGLGameRenderer.drawIdleBackdrop(batch, w, h, frameCount);
    }

    if (isPlaying) {
      // Viewport culling bounding box with safety margin
      const minX = -60;
      const minY = -60;
      const maxX = w + 60;
      const maxY = h + 60;

      // 2. Render Hazards & Telegraphs
      const hazards = engine.hazards;
      if (hazards && hazards.length > 0) {
        for (let i = 0; i < hazards.length; i++) {
          const hz = hazards[i]!;
          if (hz.x < minX || hz.x > maxX || hz.y < minY || hz.y > maxY) continue;
          WebGLGameRenderer.drawHazard(batch, hz);
        }
      }

      // 3. Render Foods
      const foods = engine.foods;
      if (foods && foods.length > 0) {
        const basePulse = frameCount * 0.08;
        for (let i = 0; i < foods.length; i++) {
          const f = foods[i]!;
          if (f.x < minX || f.x > maxX || f.y < minY || f.y > maxY) continue;
          WebGLGameRenderer.drawFood(batch, f, basePulse + i * 0.5);
        }
      }

      // 3.5 Render In-World Helmet Drops
      const helmetDrops = engine.helmetDrops;
      if (helmetDrops && helmetDrops.length > 0) {
        for (let i = 0; i < helmetDrops.length; i++) {
          const hd = helmetDrops[i]!;
          const hx = hd.X ?? hd.x;
          const hy = hd.Y ?? hd.y;
          if (hx < minX || hx > maxX || hy < minY || hy > maxY) continue;
          WebGLGameRenderer.drawHelmetDrop(batch, hd);
        }
      }

      // 4. Render Projectiles
      const projectiles = engine.projectiles;
      if (projectiles && projectiles.length > 0) {
        for (let i = 0; i < projectiles.length; i++) {
          const p = projectiles[i]!;
          if (p.x < minX || p.x > maxX || p.y < minY || p.y > maxY) continue;
          WebGLGameRenderer.drawProjectile(batch, p);
        }
      }

      // 5. Render Enemies
      const enemies = engine.enemies;
      if (enemies && enemies.length > 0) {
        for (let i = 0; i < enemies.length; i++) {
          const e = enemies[i]!;
          if (e.x < minX || e.x > maxX || e.y < minY || e.y > maxY) continue;
          WebGLGameRenderer.drawEnemy(batch, e);
        }
      }

      // 6. Render Apex Bosses
      const bosses = engine.activeBosses || (engine as any).ActiveBosses || (engine.bosses && engine.bosses.length > 0 ? engine.bosses : (engine.boss ? [engine.boss] : []));
      for (let i = 0; i < bosses.length; i++) {
        WebGLGameRenderer.drawBoss(batch, bosses[i]!);
      }

      // 7. Render Player Snake
      if (engine.player) {
        WebGLGameRenderer.drawPlayer(batch, engine.player);
      }
    }

    // 8. Render Particle FX
    if (fx) {
      WebGLGameRenderer.drawFx(batch, fx, w, h);
    }

    // 9. Post-Pass: Cinematic Ambient Vignette & Dynamic Damage Pulse
    if (isPlaying) {
      const vignetteDmg = MathX.clamp01(engine.vignette || engine.Vignette || 0);
      const vigCol = vignetteDmg > 0.01 ? '#ff0054' : '#02040a';
      const vigAlpha = vignetteDmg > 0.01 ? Math.max(0.22, vignetteDmg * 0.5) : 0.22;
      batch.setBlendMode(vignetteDmg > 0.01 ? GLBlendMode.ADDITIVE : GLBlendMode.NORMAL);
      batch.drawSdfRect(w * 0.5, h * 0.5, w, h, 0, vigCol, vigAlpha);
    }

    batch.flush();
  }

  // ---------------------------------------------------------------- Backdrop Rendering

  private static initStarfield(): void {
    const rng = Rng.Cosmetic;
    const stars: IWebGLStar[] = new Array(266);

    for (let i = 0; i < 180; i++) {
      stars[i] = {
        x: rng.rand(),
        y: rng.rand(),
        size: 0.75 + rng.rand() * 0.45,
        depth: 0.15 + rng.rand() * 0.25,
        layer: 0,
        baseAlpha: 0.2 + rng.rand() * 0.4,
        phase: rng.rand() * MathX.Tau,
        twinkleSpeed: 0.03 + rng.rand() * 0.04,
        colorType: rng.rand() > 0.3 ? 0 : 1,
      };
    }
    for (let i = 180; i < 250; i++) {
      stars[i] = {
        x: rng.rand(),
        y: rng.rand(),
        size: 1.50 + rng.rand() * 0.80,
        depth: 0.45 + rng.rand() * 0.35,
        layer: 1,
        baseAlpha: 0.45 + rng.rand() * 0.4,
        phase: rng.rand() * MathX.Tau,
        twinkleSpeed: 0.04 + rng.rand() * 0.05,
        colorType: Math.floor(rng.rand() * 4),
      };
    }
    for (let i = 250; i < 266; i++) {
      stars[i] = {
        x: rng.rand(),
        y: rng.rand(),
        size: 2.65 + rng.rand() * 1.15,
        depth: 0.85 + rng.rand() * 0.15,
        layer: 2,
        baseAlpha: 0.7 + rng.rand() * 0.3,
        phase: rng.rand() * MathX.Tau,
        twinkleSpeed: 0.06 + rng.rand() * 0.06,
        colorType: rng.rand() > 0.5 ? 1 : 2,
      };
    }
    this._stars = stars;

    // 140 Static Sub-Pixel Deep Field Micro-Stars (clustered along the galactic plane)
    const staticStars: Array<{ x: number; y: number; size: number; alpha: number }> = new Array(140);
    for (let i = 0; i < 140; i++) {
      let sx: number, sy: number;
      if (i < 80) {
        // Galactic lane clustering along -32 degree axis
        const tAlong = rng.rand();
        const lateralDist = (rng.rand() + rng.rand() - 1.0) * 0.15;
        sx = (0.5 + (tAlong - 0.5) * 1.3 * 0.848 - lateralDist * 0.530 + 1.0) % 1.0;
        sy = (0.5 + (tAlong - 0.5) * 1.3 * (-0.530) - lateralDist * 0.848 + 1.0) % 1.0;
      } else {
        sx = rng.rand();
        sy = rng.rand();
      }
      staticStars[i] = {
        x: sx,
        y: sy,
        size: 0.5 + rng.rand() * 0.5,
        alpha: 0.25 + rng.rand() * 0.35,
      };
    }
    this._staticMicroStars = staticStars;
  }

  public static drawBackdrop(
    batch: GLBatch,
    w: number,
    h: number,
    frenzyActive: boolean,
    frameCount: number,
    floor: number
  ): void {
    const palette = WebGLGameRenderer._FLOOR_HUES[((floor - 1) % 5) + 1] || WebGLGameRenderer._FLOOR_HUES[1]!;

    if (!this._stars) this.initStarfield();

    // 1. Base Cosmic Void Quad (Base Floor Background)
    batch.setBlendMode(GLBlendMode.NORMAL);
    batch.drawSdfRect(w * 0.5, h * 0.5, w, h, 0, palette.base, 1.0);

    // 2. Continuous 2D SDF Galactic Nebula Spine & Dual-Harmonic Gaussian Falloff
    // Rotated at -32 degrees across diagonal with C-infinity exponential falloff (Canvas2D source-over parity)
    const diag = Math.hypot(w, h) * 1.35;
    const rotGalactic = -32 * (Math.PI / 180);
    batch.setBlendMode(GLBlendMode.NORMAL);

    // Layer 1: Outer diffuse mantle wisp (span h * 0.88, color palette.mid, alpha 0.32)
    batch.drawRotatedQuad(
      w * 0.5,
      h * 0.5,
      diag,
      h * 0.88,
      rotGalactic,
      ColorX.rgba(palette.mid, 0.32),
      0,
      GLPrimitive.Nebula
    );

    // Layer 2: Secondary cross-woven galactic filament (depth and pep)
    batch.drawRotatedQuad(
      w * 0.5,
      h * 0.5,
      diag * 0.85,
      h * 0.45,
      rotGalactic + 0.85,
      ColorX.rgba(palette.secondary || palette.mid, 0.18),
      0,
      GLPrimitive.Nebula
    );

    // Layer 3: Concentrated luminous core stream (span h * 0.46, color palette.accent, alpha 0.42)
    batch.drawRotatedQuad(
      w * 0.5,
      h * 0.5,
      diag * 0.95,
      h * 0.46,
      rotGalactic,
      ColorX.rgba(palette.accent, 0.42),
      0,
      GLPrimitive.Nebula
    );

    // Layer 4: Galactic Core Bulge: Concentric rotated ellipse along galactic angle (peak alpha 0.26)
    const coreMin = Math.min(w, h);
    batch.drawRotatedQuad(
      w * 0.5,
      h * 0.5,
      coreMin * 0.70 * 1.55,
      coreMin * 0.70 * 0.68,
      rotGalactic,
      ColorX.rgba(palette.accent, 0.26),
      0,
      GLPrimitive.Nebula
    );

    // 3. Deep Background Dynamic Multi-Tier Starfield & Micro-Stars (Layer 1)
    // Anchored strictly in the infinite background behind arena floor grid and perimeter walls.
    const pad = 6;
    const innerW = Math.max(1, w - pad * 2);
    const innerH = Math.max(1, h - pad * 2);

    // Static Sub-Pixel Deep Field Micro-Stars (140 Stars)
    batch.setBlendMode(GLBlendMode.NORMAL);
    const staticStars = this._staticMicroStars || [];
    for (let i = 0; i < staticStars.length; i++) {
      const ss = staticStars[i]!;
      const ssx = pad + ss.x * innerW;
      const ssy = pad + ss.y * innerH;
      batch.drawQuad(ssx, ssy, ss.size, ss.size, ColorX.rgba('#ffffff', ss.alpha), 0);
    }

    // Dynamic Multi-Tier Starfield (180 Micro + 70 Mid + 16 Diamond Beacons)
    const stars = this._stars!;
    const t = frameCount;
    const cosmicSpeed = frenzyActive ? 0.08 : 0.025;
    const driftX = t * cosmicSpeed * 0.4;
    const driftY = t * cosmicSpeed;

    batch.setBlendMode(GLBlendMode.ADDITIVE);
    for (let i = 0; i < stars.length; i++) {
      const s = stars[i]!;
      const sx = pad + ((((s.x * innerW + driftX * s.depth) % innerW) + innerW) % innerW);
      const sy = pad + ((((s.y * innerH + driftY * s.depth) % innerH) + innerH) % innerH);

      const starColor =
        s.colorType === 0
          ? '#ffffff'
          : s.colorType === 1
          ? palette.accent
          : s.colorType === 2
          ? '#ffd166'
          : s.colorType === 3
          ? '#f72585'
          : '#38bdf8';

      if (s.layer === 0) {
        // Micro-Stars: Crisp Twinkling Motes
        const alpha = MathX.clamp01(s.baseAlpha * (0.68 + 0.32 * Math.sin(t * s.twinkleSpeed + s.phase)));
        batch.drawQuad(sx - s.size * 0.5, sy - s.size * 0.5, s.size, s.size, ColorX.rgba('#ffffff', alpha), 0);
      } else if (s.layer === 1) {
        // Spectral Mid-Stars: Dual Harmonic Twinkle
        const alpha = MathX.clamp01(
          s.baseAlpha *
            (0.6 +
              0.25 * Math.sin(t * s.twinkleSpeed + s.phase) +
              0.15 * Math.cos(t * (s.twinkleSpeed * 1.6) + s.phase))
        );
        batch.drawSdfCircle(sx, sy, s.size, starColor, alpha, 2);
      } else {
        // Diamond Beacons / Pulsars (250..265): 16 Pulsars with Power-4 Bloom Pulse + 4-Point Soft Diffraction Diamond Flares
        const bloom = 1.0 + 0.45 * Math.pow(Math.max(0, Math.sin(t * s.twinkleSpeed + s.phase)), 4);
        const alpha = MathX.clamp01(s.baseAlpha * (0.75 + 0.25 * Math.sin(t * s.twinkleSpeed * 0.5 + s.phase)));
        const arm = s.size * 3.4 * bloom;
        const core = s.size * bloom;

        // 4-Point Soft Diffraction Diamond Flares
        // Vertical Diamond Flare
        batch.drawQuadVertices(
          sx,
          sy - arm,
          sx + core * 0.35,
          sy,
          sx,
          sy + arm,
          sx - core * 0.35,
          sy,
          ColorX.rgba(starColor, alpha * 0.75),
          4
        );
        // Horizontal Diamond Flare
        batch.drawQuadVertices(
          sx - arm,
          sy,
          sx,
          sy - core * 0.35,
          sx + arm,
          sy,
          sx,
          sy + core * 0.35,
          ColorX.rgba(starColor, alpha * 0.75),
          4
        );

        // Soft Diffraction Laser Crosshairs
        batch.drawLaserLine(sx, sy - arm * 0.8, sx, sy + arm * 0.8, starColor, 1.5, '#ffffff', alpha * 0.8);
        batch.drawLaserLine(sx - arm * 0.8, sy, sx + arm * 0.8, sy, starColor, 1.5, '#ffffff', alpha * 0.8);

        // Luminous Central White Core
        batch.drawSdfCircle(sx, sy, core * 0.65, '#ffffff', alpha, 8, '#ffffff');
      }
    }

    // ----------------------------------------------------------------
    // 4. Checkered Celestial Grid & Coordinate Laser Lines (Layer 2)
    // Rendered ON TOP of deep starfield in GLBlendMode.NORMAL so floor is in foreground.
    // ----------------------------------------------------------------
    batch.setBlendMode(GLBlendMode.NORMAL);

    // Checkered Celestial Grid Luminescence (88x88)
    const tileSize = 88;
    for (let x = 0; x < w; x += tileSize) {
      for (let y = 0; y < h; y += tileSize) {
        if (((x / tileSize + y / tileSize) | 0) % 2 === 0) {
          batch.drawQuad(x, y, tileSize, tileSize, 'rgba(255, 255, 255, 0.018)', 0);
        }
      }
    }

    // Coordinate Grid Lines & Navigation Micro-Crosshairs (alpha 0.09)
    for (let x = tileSize; x < w; x += tileSize) {
      batch.drawLaser(x, 0, x, h, 1.0, ColorX.rgba(palette.grid, 0.09), 0);
    }
    for (let y = tileSize; y < h; y += tileSize) {
      batch.drawLaser(0, y, w, y, 1.0, ColorX.rgba(palette.grid, 0.09), 0);
    }
    // Micro-crosshairs at grid intersections
    for (let x = tileSize; x < w; x += tileSize) {
      for (let y = tileSize; y < h; y += tileSize) {
        batch.drawLaser(x - 3, y, x + 3, y, 1.0, 'rgba(255, 255, 255, 0.16)', 0);
        batch.drawLaser(x, y - 3, x, y + 3, 1.0, 'rgba(255, 255, 255, 0.16)', 0);
      }
    }

    // ----------------------------------------------------------------
    // 5. Multi-Tier Pulsing Perimeter Laser Border Walls (Layer 3)
    // Rendered strictly ON TOP of starfield and floor grid, firmly enclosing the combat arena.
    // ----------------------------------------------------------------
    const pulse = 0.5 + Math.sin(frameCount * 0.02) * 0.5;
    const wallColor = frenzyActive ? '#ff0054' : palette.accent;
    const wallAlpha = frenzyActive ? 0.55 + pulse * 0.3 : 0.26 + pulse * 0.14;

    const x0 = pad;
    const y0 = pad;
    const x1 = w - pad;
    const y1 = h - pad;

    // Pass -1: Solid structural backing pass in NORMAL mode to anchor the boundary and block star bleeding
    batch.setBlendMode(GLBlendMode.NORMAL);
    batch.drawLine(x0, y0, x1, y0, 3.0, '#040711');
    batch.drawLine(x1, y0, x1, y1, 3.0, '#040711');
    batch.drawLine(x1, y1, x0, y1, 3.0, '#040711');
    batch.drawLine(x0, y1, x0, y0, 3.0, '#040711');

    // Switch to ADDITIVE for multi-layer glowing perimeter lasers
    batch.setBlendMode(GLBlendMode.ADDITIVE);

    // Pass 0: Broad Ambient Outer Neon Halo (Inset pad = 6 prevents viewport edge clipping)
    const haloWidth = frenzyActive ? 18.0 : 12.0;
    batch.drawLaser(x0, y0, x1, y0, haloWidth, ColorX.rgba(wallColor, wallAlpha * 0.25), 10);
    batch.drawLaser(x1, y0, x1, y1, haloWidth, ColorX.rgba(wallColor, wallAlpha * 0.25), 10);
    batch.drawLaser(x1, y1, x0, y1, haloWidth, ColorX.rgba(wallColor, wallAlpha * 0.25), 10);
    batch.drawLaser(x0, y1, x0, y0, haloWidth, ColorX.rgba(wallColor, wallAlpha * 0.25), 10);

    // Pass 1: Mid-Tier Laser Glow
    batch.drawLaser(x0, y0, x1, y0, 6.0, ColorX.rgba(wallColor, wallAlpha * 0.55), 8);
    batch.drawLaser(x1, y0, x1, y1, 6.0, ColorX.rgba(wallColor, wallAlpha * 0.55), 8);
    batch.drawLaser(x1, y1, x0, y1, 6.0, ColorX.rgba(wallColor, wallAlpha * 0.55), 8);
    batch.drawLaser(x0, y1, x0, y0, 6.0, ColorX.rgba(wallColor, wallAlpha * 0.55), 8);

    // Pass 2: Razor-Sharp Core Laser Line
    batch.drawLaserLine(x0, y0, x1, y0, wallColor, 2.5, '#ffffff', wallAlpha);
    batch.drawLaserLine(x1, y0, x1, y1, wallColor, 2.5, '#ffffff', wallAlpha);
    batch.drawLaserLine(x1, y1, x0, y1, wallColor, 2.5, '#ffffff', wallAlpha);
    batch.drawLaserLine(x0, y1, x0, y0, wallColor, 2.5, '#ffffff', wallAlpha);

    // Pass 3: Corner Capacitor Beacon Nodes with Pulsating Rings (Unrolled for zero allocation)
    const cornerR = 8.0 + pulse * 3.0;
    batch.drawSdfCircle(x0, y0, 4.0, '#ffffff', wallAlpha, 8, wallColor);
    batch.drawSdfRing(x0, y0, cornerR, 1.8, wallColor, wallAlpha * 0.8, 6, wallColor);

    batch.drawSdfCircle(x1, y0, 4.0, '#ffffff', wallAlpha, 8, wallColor);
    batch.drawSdfRing(x1, y0, cornerR, 1.8, wallColor, wallAlpha * 0.8, 6, wallColor);

    batch.drawSdfCircle(x1, y1, 4.0, '#ffffff', wallAlpha, 8, wallColor);
    batch.drawSdfRing(x1, y1, cornerR, 1.8, wallColor, wallAlpha * 0.8, 6, wallColor);

    batch.drawSdfCircle(x0, y1, 4.0, '#ffffff', wallAlpha, 8, wallColor);
    batch.drawSdfRing(x0, y1, cornerR, 1.8, wallColor, wallAlpha * 0.8, 6, wallColor);
  }

  /**
   * Hardware-Accelerated Pure WebGL 2.0 Idle Menu Backdrop.
   * Renders the complete 180 3D-depth-sorted knot segments from OuroborosMenuAnimation directly
   * through GLBatch into GPU vertex buffers (zero offscreen Canvas2D, zero per-frame texture uploads).
   */
  private static drawIdleBackdrop(batch: GLBatch, w: number, h: number, frameCount: number): void {
    if (!this._ouroMenu) {
      this._ouroMenu = new OuroborosMenuAnimation();
    }
    this._ouroMenu.drawGL(batch, w, h, frameCount);
  }

  // ---------------------------------------------------------------- Universal Attack Telegraphs

  /**
   * Renders universal combat attack telegraphs.
   * Delegates directly to TelegraphRenderer for modularity and maintainability (AGENTS.md Rule 10).
   */
  public static drawTelegraph(batch: GLBatch, t: ITelegraphAttack | any): void {
    TelegraphRenderer.draw(batch, t);
  }

  // ---------------------------------------------------------------- Hazards & Telegraphs

  /**
   * Renders persistent charging or armed hazard pools.
   * Delegates directly to TelegraphRenderer for modularity and maintainability (AGENTS.md Rule 10).
   */
  public static drawHazard(batch: GLBatch, hz: IHazardRenderData | any): void {
    TelegraphRenderer.drawHazard(batch, hz);
  }

  // ---------------------------------------------------------------- Foods

  public static drawFood(batch: GLBatch, food: IFoodRenderData | any, pulse: number): void {
    const spawnScale = food.spawnScale !== undefined ? food.spawnScale : 1;
    const s = (1 + Math.sin(pulse) * 0.12) * spawnScale;
    if (s <= 0.01) return;

    const type = food.type || 'apple';
    const col =
      food.color ||
      (type === 'golden'
        ? '#ffb703'
        : type === 'shard'
        ? '#38bdf8'
        : type === 'shield'
        ? '#3a86ff'
        : type === 'bomb'
        ? '#ef4444'
        : type === 'potion'
        ? '#ff3366'
        : type === 'chrono'
        ? '#00f0b5'
        : '#10b981');
    const r = (food.radius || (food as any).r || 10) * s;
    const fx = food.x;
    const fy = food.y;
    const x = food.x ?? food.X ?? fx;
    const y = food.y ?? food.Y ?? fy;
    const alpha = food.alpha !== undefined ? food.alpha : 1.0;

    // Fast-path 1: Pre-rendered unified GPU Texture Atlas (0 MB/s bus upload, 0 texture switches)
    // 100% Canvas2D radius scaling parity: dim = r * 4.5 maps the cell's baseR (14/64 * cellSize)
    // to exact world core radius r and outer halo radius 2.0 * r, matching FoodRenderer.draw.
    const gl = batch.context.gl || (batch as any).gl;
    const atlasTexture = gl ? WebGLAssetAtlas.getFoodAtlasTexture(gl) : null;
    if (atlasTexture) {
      const reg = WebGLAssetAtlas.getFoodRegion(type);
      batch.setBlendMode(GLBlendMode.NORMAL);
      const dim = r * 4.5;
      batch.drawTexture(atlasTexture, x - dim * 0.5, y - dim * 0.5, dim, dim, alpha, reg.uvMin, reg.uvMax);
      return;
    }

    // Fast-path 2: Individual pre-rendered offscreen sprite stamp texture blit
    const stampTex = WebGLGameRenderer.getFoodTexture(gl, type, col, true);
    if (stampTex) {
      batch.setBlendMode(GLBlendMode.NORMAL);
      const dim = r * 4.5;
      batch.drawTextureQuad(fx - dim * 0.5, fy - dim * 0.5, dim, dim, stampTex, '#ffffff', 1.0);
      return;
    }

    // 1. Main Food Core (3D Specular Shaded Sphere in NORMAL Blend Mode to occlude background stars)
    batch.setBlendMode(GLBlendMode.NORMAL);
    batch.drawSphere(fx, fy, r, col, 6);

    // 2. Inner Bioluminescent Core & Specular Glint (NORMAL Blend Mode)
    batch.drawSdfCircle(fx, fy, r * 0.55, ColorX.shade(col, 0.4), 1.0);
    batch.drawSdfCircle(fx - r * 0.28, fy - r * 0.3, r * 0.22, '#ffffff', 0.85);

    // 3. Spore-Light Outer Halo (Additive)
    batch.setBlendMode(GLBlendMode.ADDITIVE);
    batch.drawSdfCircle(fx, fy, r * 2.0, col, 0.22);

    // 4. Type-Specific Procedural Ornaments
    if (type === 'golden') {
      // Dynamic breathing solar corona ring
      const coronaR = r + 3 + Math.sin(pulse * 1.6) * 1.5;
      batch.drawSdfRing(fx, fy, coronaR, 1.5, 'rgba(255, 255, 255, 0.75)', 1.0, 6, '#ffd166');
    } else if (type === 'shard') {
      batch.drawSdfDiamond(fx, fy, r * 1.1, '#fff3c4', 0.9, 6);
    } else if (type === 'shield') {
      batch.drawSdfRing(fx, fy, r * 0.55, 1.5, '#ffffff', 0.85);
    } else if (type === 'potion') {
      // Medical Cross
      batch.drawSdfRect(fx, fy, 3, 8, 0, '#ffffff', 1.0);
      batch.drawSdfRect(fx, fy, 8, 3, 0, '#ffffff', 1.0);
    } else if (type === 'chrono') {
      // Clock Hands
      batch.drawLaserLine(fx, fy, fx, fy - r * 0.5, '#ffffff', 1.4, '#ffffff', 1.0);
      batch.drawLaserLine(fx, fy, fx + r * 0.4, fy, '#ffffff', 1.4, '#ffffff', 1.0);
    } else if (type === 'bomb') {
      // Switch to NORMAL blend mode so dark core #111827 renders accurately
      batch.setBlendMode(GLBlendMode.NORMAL);
      batch.drawSdfCircle(fx, fy, r * 0.4, '#111827', 1.0);
      batch.setBlendMode(GLBlendMode.ADDITIVE);
      batch.drawLaserLine(fx, fy - r * 0.4, fx + r * 0.3, fy - r * 0.8, '#ffb703', 1.5, '#ffffff', 1.0);
    } else if (type === 'soul') {
      batch.drawSdfRing(fx, fy, r * 1.3, 1.5, '#c77dff', 0.8, 8, '#c77dff');
    } else if (type === 'prism') {
      batch.drawSdfDiamond(fx, fy, r * 0.8, '#ffffff', 1.0, 8);
      batch.drawSdfRing(fx, fy, r * 1.2, 1.5, '#38bdf8', 0.7);
    }

    // Always reset blend mode to NORMAL
    batch.setBlendMode(GLBlendMode.NORMAL);
  }

  // ---------------------------------------------------------------- In-World Helmet Drops

  public static drawHelmetDrop(batch: GLBatch, drop: HelmetDrop | any): void {
    if (drop.Dead || (drop.SpawnScale !== undefined && drop.SpawnScale <= 0.01)) return;
    const x = drop.X ?? drop.x;
    const y = drop.Y ?? drop.y;
    const pulse = drop.Pulse ?? drop.pulse ?? drop.bobTimer ?? 0;
    const bobY = y + Math.sin(pulse * 2.2) * 5.0;
    const col = drop.Color || drop.color || '#ffd166';
    const spawnScale = drop.SpawnScale !== undefined ? drop.SpawnScale : 1;
    const scale = spawnScale * (1.0 + Math.sin(pulse * 3.0) * 0.06);
    const r = (drop.Radius || drop.radius || 22) * scale;
    const badgeW = 60;
    const badgeH = 14;

    // --- NORMAL Blend Mode Foundation Passes ---
    batch.setBlendMode(GLBlendMode.NORMAL);
    // 1. Ground Shadow Ellipse
    batch.drawSdfRect(x, y + (drop.Radius || 22) + 4, r * 1.8, r * 0.7, 0, 'rgba(0, 0, 0, 0.45)', 1.0);
    // 2. Central 5-Point Cybernetic Helmet Plate Silhouette
    batch.drawSdfRect(x, bobY, r * 0.9, r * 0.9, 0, '#0f172a', 1.0);
    // 3. Floating Rarity Tier Tag Badge Box
    batch.drawSdfRect(x, bobY - r - 18 + badgeH / 2, badgeW, badgeH, 0, '#0a0f1d', 1.0);

    // --- ADDITIVE Blend Mode Luminescence Passes (Single Coalesced Batch) ---
    batch.setBlendMode(GLBlendMode.ADDITIVE);
    // 4. Vertical Tapered Rarity Light Pillar
    const beamAlpha = 0.18 + Math.sin(pulse * 2.5) * 0.08;
    batch.drawLaser(x, bobY, x, bobY - 140, r * 1.2, ColorX.rgba(col, beamAlpha), 8);
    // 5. Multi-Layer Glowing Outer Halo & Concentric Rings
    batch.drawSdfCircle(x, bobY, r * 1.15, col, 0.3, 14, col);
    batch.drawSdfRing(x, bobY, r * 1.15, 2.2, col, 1.0, 8, col);
    // 6. Rotating Energy Ring with Orbiting Node Circle
    batch.drawSdfRing(x, bobY, r * 0.85, 1.4, '#ffffff', 0.85);
    const nodeX = x + Math.cos(pulse) * r * 0.85;
    const nodeY = bobY + Math.sin(pulse) * r * 0.85;
    batch.drawSdfCircle(nodeX, nodeY, 2.5, '#ffffff', 1.0, 4);
    // 7. Helmet Plate Glow & Glowing Visor Aperture
    batch.drawSdfRect(x, bobY, r * 0.9, r * 0.9, 0, col, 1.0, 2);
    batch.drawSdfRect(x, bobY + r * 0.05, r * 0.64, r * 0.24, 0, col, 1.0, 4);
    batch.drawSdfCircle(x - r * 0.18, bobY - r * 0.32, r * 0.12, 'rgba(255, 255, 255, 0.85)', 1.0);
    // 8. Floating Rarity Tier Tag Badge Border
    batch.drawSdfRect(x, bobY - r - 18 + badgeH / 2, badgeW, badgeH, 0, col, 0.8, 1);
  }

  // ---------------------------------------------------------------- Projectiles

  public static drawProjectile(batch: GLBatch, proj: IProjectileRenderData | any): void {
    const maxLife = Math.max(0.001, proj.maxLife || proj.MaxLife || 4);
    const life = proj.life !== undefined ? proj.life : (proj.Life !== undefined ? proj.Life : maxLife);
    const a = MathX.clamp01(life / maxLife);
    const col = proj.color || proj.Color || '#38bdf8';
    const r = proj.radius || proj.Radius || 4;
    const globalAlpha = maxLife < 1 ? 0.35 + a * 0.65 : 1.0;

    batch.setBlendMode(GLBlendMode.ADDITIVE);

    if (proj.trail || proj.Trail) {
      const vx = proj.vx || proj.Vx || 0;
      const vy = proj.vy || proj.Vy || 0;
      batch.drawLaserLine(
        proj.x - vx * 0.035,
        proj.y - vy * 0.035,
        proj.x,
        proj.y,
        col,
        r,
        '#ffffff',
        globalAlpha * 0.4
      );
    }

    // Outer plasma glow
    batch.drawSdfCircle(proj.x, proj.y, r * 1.8, col, 0.35 * globalAlpha, 8, col);
    // Solid core
    batch.drawSdfCircle(proj.x, proj.y, r, col, 1.0 * globalAlpha);
    // Specular center
    batch.drawSdfCircle(proj.x - r * 0.22, proj.y - r * 0.24, r * 0.35, '#ffffff', 0.9 * globalAlpha);
  }

  // ---------------------------------------------------------------- Enemies

  public static drawEnemy(batch: GLBatch, enemy: IEnemyRenderData | any): void {
    const col = enemy.color || enemy.Color || '#ef4444';
    const r = enemy.radius || enemy.Radius || 12;
    const ex = enemy.x ?? enemy.X ?? 0;
    const ey = enemy.y ?? enemy.Y ?? 0;
    const angle = enemy.angle ?? enemy.Angle ?? 0;
    const spawnTimer = enemy.spawnTimer ?? enemy.SpawnTimer ?? 0;

    // 1. Spawning Warp Ring
    if (spawnTimer > 0) {
      batch.setBlendMode(GLBlendMode.ADDITIVE);
      const t = MathX.clamp01(1 - spawnTimer / 0.45);
      batch.drawSdfRing(ex, ey, r * (2.2 - t * 1.2), 2.0, col, 0.25 + t * 0.4, 6, col);
      return;
    }

    const hit = enemy.hitFlash ?? enemy.HitFlash ?? 0;
    const bodyCol = hit > 0.4 ? '#ffffff' : col;
    const cosA = Math.cos(angle);
    const sinA = Math.sin(angle);

    switch (enemy.type || enemy.Type) {
      case 'spitter': {
        // Teardrop bio-pod oriented along angle + PI/2
        const aimA = angle + Math.PI / 2;
        const cosM = Math.cos(aimA);
        const sinM = Math.sin(aimA);

        // Smooth 10-point organic teardrop polygon derived from bezier hull (Zero-Allocation Scratch)
        const norm = WebGLGameRenderer._NORM_TEARDROP;
        const pts = WebGLGameRenderer._scratchTeardropPts;
        for (let i = 0; i < 10; i++) {
          const lx = norm[i]![0] * r;
          const ly = norm[i]![1] * r;
          pts[i]!.x = ex + lx * cosM - ly * sinM;
          pts[i]!.y = ey + lx * sinM + ly * cosM;
        }
        batch.drawPolygon(pts, bodyCol, 7);

        // Smooth base bulb with 3D specular focal sphere
        const baseLx = 0;
        const baseLy = r * 0.35;
        const baseX = ex + baseLx * cosM - baseLy * sinM;
        const baseY = ey + baseLx * sinM + baseLy * cosM;
        batch.drawSphere(baseX, baseY, r * 0.8, bodyCol, 6);

        // Cannon Nozzle Aperture (at tip - tinted body shade)
        const nozLx = 0;
        const nozLy = -r * 0.55;
        const nX = ex + nozLx * cosM - nozLy * sinM;
        const nY = ey + nozLx * sinM + nozLy * cosM;
        batch.drawRotatedQuad(nX, nY, r * 0.52, r * 0.68, aimA, ColorX.rgba(ColorX.shade(col, -0.65), 0.55), 0, GLPrimitive.Circle);

        // Translucent Glowing Acid Sac (in bulb cavity)
        const sacLx = 0;
        const sacLy = r * 0.3;
        const sX = ex + sacLx * cosM - sacLy * sinM;
        const sY = ey + sacLx * sinM + sacLy * cosM;
        batch.drawRotatedQuad(sX, sY, r * 0.9, r * 0.6, aimA, ColorX.rgba(col, 0.65), 6, GLPrimitive.Sphere);
        break;
      }

      case 'drone': {
        // 5-Point triangular cyber-scout fuselage polygon (Zero-Allocation Scratch)
        const normD = WebGLGameRenderer._NORM_DRONE;
        const ptsD = WebGLGameRenderer._scratchDronePts;
        const closedD = WebGLGameRenderer._scratchDroneClosedPts;
        for (let i = 0; i < 5; i++) {
          const lx = normD[i]![0] * r;
          const ly = normD[i]![1] * r;
          const px = ex + lx * cosA - ly * sinA;
          const py = ey + lx * sinA + ly * cosA;
          ptsD[i]!.x = px;
          ptsD[i]!.y = py;
          closedD[i]!.x = px;
          closedD[i]!.y = py;
        }
        closedD[5]!.x = closedD[0]!.x;
        closedD[5]!.y = closedD[0]!.y;
        batch.drawPolygon(ptsD, bodyCol, 7);
        batch.drawPolyline(closedD, 1.5, bodyCol, 4);

        // Sensor Cockpit (tinted body shade)
        const cpX = ex + cosA * (r * 0.35);
        const cpY = ey + sinA * (r * 0.35);
        batch.drawRotatedQuad(cpX, cpY, r * 0.68, r * 0.52, angle, ColorX.rgba(ColorX.shade(col, -0.65), 0.75), 0, GLPrimitive.Circle);

        // Cyan Sensor Eye Glint
        batch.drawRotatedQuad(cpX, cpY, r * 0.36, r * 0.26, angle, ColorX.rgba(col, 0.85), 6, GLPrimitive.Circle);

        // High-Frequency Vibrating Charge Ring
        if (enemy.charging || enemy.Charging) {
          batch.setBlendMode(GLBlendMode.ADDITIVE);
          const shootTimer = enemy.shootTimer ?? enemy.ShootTimer ?? 0;
          const osc = Math.sin(shootTimer * 24) * 3;
          batch.drawSdfRing(ex, ey, r * 1.6 + osc, 2.0, '#ff0054', 0.8, 8, '#ff0054');
        }
        break;
      }

      case 'phantom': {
        // 3 Translucent Ghost Echo Discs Trailing Behind
        for (let k = 1; k <= 3; k++) {
          const echoDist = k * 9;
          const echoAlpha = 0.35 * (1.0 - (k - 1) * 0.25);
          const echoX = ex - cosA * echoDist;
          const echoY = ey - sinA * echoDist;
          const ew = r * 1.8 * (1.0 - k * 0.12);
          const eh = r * 1.2 * (1.0 - k * 0.12);
          batch.drawRotatedQuad(echoX, echoY, ew, eh, angle, ColorX.rgba(bodyCol, echoAlpha), 4, GLPrimitive.Circle);
        }

        // Translucent Wraith Crescent Head (alpha 0.82, Zero-Allocation Scratch)
        const apexX = ex + cosA * (r * 1.3);
        const apexY = ey + sinA * (r * 1.3);
        const ptsP = WebGLGameRenderer._scratchCrescentPts;
        ptsP[0]!.x = apexX;
        ptsP[0]!.y = apexY;
        const arcStart = angle + 0.8;
        const arcSpan = MathX.Tau - 1.6;
        for (let i = 0; i <= 8; i++) {
          const a = arcStart + (arcSpan * i) / 8;
          ptsP[i + 1]!.x = ex + Math.cos(a) * r;
          ptsP[i + 1]!.y = ey + Math.sin(a) * r;
        }
        batch.drawPolygon(ptsP, ColorX.rgba(bodyCol, 0.82), 8);
        batch.drawSphere(ex, ey, r * 0.85, ColorX.rgba(bodyCol, 0.82), 6);

        // Ethereal White Eye Glint
        const eyeX = ex + cosA * (r * 0.35);
        const eyeY = ey + sinA * (r * 0.35);
        batch.drawSdfCircle(eyeX, eyeY, r * 0.17, 'rgba(255, 255, 255, 0.85)', 1.0, 6, '#ffffff');
        break;
      }

      case 'brute':
      case 'bruiser':
      case 'dasher': {
        // Heavy Armored Ram Hull Polygon (Zero-Allocation Scratch)
        const normR = WebGLGameRenderer._NORM_RAM;
        const ptsR = WebGLGameRenderer._scratchRamPts;
        const closedR = WebGLGameRenderer._scratchRamClosedPts;
        for (let i = 0; i < 5; i++) {
          const lx = normR[i]![0] * r;
          const ly = normR[i]![1] * r;
          const px = ex + lx * cosA - ly * sinA;
          const py = ey + lx * sinA + ly * cosA;
          ptsR[i]!.x = px;
          ptsR[i]!.y = py;
          closedR[i]!.x = px;
          closedR[i]!.y = py;
        }
        closedR[5]!.x = closedR[0]!.x;
        closedR[5]!.y = closedR[0]!.y;
        batch.drawPolygon(ptsR, bodyCol, 8);

        // Forward Ram Diamond
        batch.drawSdfDiamond(ex + cosA * (r * 0.6), ey + sinA * (r * 0.6), r * 0.6, bodyCol, 1.0);

        // Three Spine Armor Ridges
        for (let i = 0; i < 3; i++) {
          const off = -r * 0.55 + i * r * 0.5;
          const rx = ex + cosA * off;
          const ry = ey + sinA * off;
          batch.drawRotatedQuad(rx, ry, r * 0.36, r * 1.04, angle, ColorX.rgba(col, 0.4), 0, GLPrimitive.Circle);
        }

        // Hull Vent (tinted body shade)
        const vx = ex + cosA * (-r * 0.2) - sinA * (r * 0.55);
        const vy = ey + sinA * (-r * 0.2) + cosA * (r * 0.55);
        batch.drawRotatedQuad(vx, vy, r * 1.4, r * 0.44, angle, ColorX.rgba(ColorX.shade(col, -0.65), 0.45), 0, GLPrimitive.Circle);

        // White Kinetic Charge Surge Outline
        if (enemy.charging || enemy.Charging) {
          batch.setBlendMode(GLBlendMode.ADDITIVE);
          batch.drawPolyline(closedR, 2.5, '#ffffff', 10);
        }
        break;
      }

      case 'swarmling': {
        // Elliptical Spore Mite Body (3D Specular Focal Sphere)
        batch.drawRotatedQuad(ex, ey, r * 2.3, r * 1.7, angle, bodyCol, 7, GLPrimitive.Sphere);
        // Forward Bioluminescent Pod
        batch.drawSdfCircle(ex + cosA * (r * 0.4), ey + sinA * (r * 0.4), r * 0.36, ColorX.rgba(col, 0.75), 1.0, 6, col);
        break;
      }

      case 'scarab':
      default: {
        // Spherical Armored Carapace with 3D Specular Glint
        batch.drawSphere(ex, ey, r, bodyCol, 8);
        // Dorsal Chitin Seam Split (tinted body shade)
        batch.drawRotatedQuad(ex, ey, r * 0.52, r * 1.7, angle, ColorX.rgba(ColorX.shade(col, -0.65), 0.55), 0, GLPrimitive.Circle);
        // Glowing Chitin Perimeter Arc (Zero-Allocation Scratch)
        const ptsS = WebGLGameRenderer._scratchScarabArcPts;
        for (let k = 0; k <= 6; k++) {
          const a = angle + Math.PI * 1.02 + (Math.PI * 0.70 * k) / 6;
          ptsS[k]!.x = ex + Math.cos(a) * r * 0.82;
          ptsS[k]!.y = ey + Math.sin(a) * r * 0.82;
        }
        batch.drawPolyline(ptsS, Math.max(1, r * 0.16), ColorX.rgba(col, 0.65), 4);
        break;
      }
    }

    // Status Rings (Cryo & Burn)
    const st = enemy.status ?? enemy.Status;
    if (st && ((st.freezeTimer && st.freezeTimer > 0) || (st.slowTimer && st.slowTimer > 0))) {
      batch.setBlendMode(GLBlendMode.ADDITIVE);
      batch.drawSdfRing(ex, ey, r + 4, 2.0, '#7dd3fc', 0.75, 6, '#7dd3fc');
    }
    if (st && st.burnTimer && st.burnTimer > 0) {
      batch.setBlendMode(GLBlendMode.ADDITIVE);
      batch.drawSdfRing(ex, ey, r + 7, 2.0, '#ff5400', 0.6, 6, '#ff5400');
    }

    // Dynamic HP Bar
    const hp = enemy.hp ?? enemy.Hp;
    const maxHp = enemy.maxHp ?? enemy.MaxHp;
    if (hp !== undefined && maxHp !== undefined && hp < maxHp) {
      batch.setBlendMode(GLBlendMode.NORMAL);
      const w = r * 2.2;
      const pct = MathX.clamp01(hp / Math.max(1, maxHp));
      batch.drawSdfRect(ex, ey - r - 9, w, 4, 0, 'rgba(0, 0, 0, 0.65)', 1.0);
      const barCol = pct > 0.5 ? '#10b981' : pct > 0.25 ? '#ffb703' : '#ff3366';
      batch.drawSdfRect(ex - (w * (1 - pct)) * 0.5, ey - r - 9, w * pct, 4, 0, barCol, 1.0);
    }
  }

  // ---------------------------------------------------------------- Bosses

  public static drawBoss(batch: GLBatch, boss: IBossRenderData | any): void {
    const col = boss.Color || boss.color || '#ff3366';
    const accent = boss.Accent || boss.accent || '#ff4d6d';
    const r = boss.Radius ?? boss.radius ?? 32;
    const bx = boss.X ?? boss.x;
    const by = boss.Y ?? boss.y;
    const bossAngle = boss.Angle ?? boss.angle ?? 0;
    const spiral = boss.SpiralAngle ?? boss.spiralAngle ?? 0;
    const entranceTimer = boss.EntranceTimer ?? boss.entranceTimer;
    const entering = entranceTimer !== undefined && entranceTimer > 0;
    const entranceAlpha = entering ? MathX.clamp(1 - entranceTimer / 1.4, 0.1, 1.0) : 1.0;
    const segments = boss.Segments || boss.segments;

    // 1. Render Boss Attack Telegraphs (in world space)
    const telegraphs = boss.Telegraphs || boss.telegraphs;
    if (telegraphs && telegraphs.length > 0) {
      for (let i = 0; i < telegraphs.length; i++) {
        WebGLGameRenderer.drawTelegraph(batch, telegraphs[i]!);
      }
    }

    // 2. Wide Ambient Bloom Halo under Boss Head
    batch.setBlendMode(GLBlendMode.ADDITIVE);
    batch.drawSdfCircle(bx, by, r * 3.4, col, 0.38 * entranceAlpha);

    // 3. Unified Serpentine Body Multi-Pass Rendering (One Cohesive Living Mesh for All Snakes)
    if (segments && segments.length > 0) {
      // 3A. Calibrate body ribbon radius to segment dimensions (neck constriction to trunk taper)
      // Eliminates massive 78px rectangular slabs and matches real viper proportions (spade head -> supple neck -> body)
      const firstSeg = segments[0];
      const firstSegR = firstSeg ? (firstSeg.r ?? firstSeg.R ?? r * 0.7) : r * 0.7;
      const bodyRadius = Math.min(r * 0.7, firstSegR * 1.3);

      const bossSpec = WebGLGameRenderer._bossSerpentineSpec;
      bossSpec.x = bx;
      bossSpec.y = by;
      bossSpec.angle = bossAngle;
      bossSpec.headRadius = bodyRadius;
      bossSpec.color = col;
      bossSpec.accent = accent;
      bossSpec.segments = segments as any;
      batch.drawSerpentineMultiPass(bossSpec, entranceAlpha);
    }

    // 4. Custom Boss Head Geometries
    const hit = boss.HitFlash ?? boss.hitFlash ?? 0;
    const headCol = hit > 0.5 ? '#ffffff' : col;

    if (boss.type === 'colossus') {
      // Hexagonal furnace head oscillating with spiral
      const colRot = Math.sin(spiral * 0.4) * 0.12;
      batch.setBlendMode(GLBlendMode.NORMAL);

      // True 6-sided regular hexagon (Zero-Allocation Scratch)
      const hexPts = WebGLGameRenderer._scratchHexPts;
      const closedHex = WebGLGameRenderer._scratchHexClosedPts;
      for (let i = 0; i < 6; i++) {
        const a = colRot - Math.PI / 2 + (MathX.Tau * i) / 6;
        const px = bx + Math.cos(a) * r * 1.2;
        const py = by + Math.sin(a) * r * 1.2;
        hexPts[i]!.x = px;
        hexPts[i]!.y = py;
        closedHex[i]!.x = px;
        closedHex[i]!.y = py;
      }
      closedHex[6]!.x = closedHex[0]!.x;
      closedHex[6]!.y = closedHex[0]!.y;
      batch.drawPolygon(hexPts, headCol, 14);
      batch.drawPolyline(closedHex, 2.0, accent, 8);

      // Inner dark furnace cavity
      batch.drawSdfCircle(bx, by, r * 0.42, '#05080f', entranceAlpha);

      // Pulsating molten furnace heart
      const heartR = r * 0.42 * (0.6 + Math.abs(Math.sin(spiral)) * 0.4);
      batch.drawSdfCircle(bx, by, heartR, accent, entranceAlpha, 14, accent);
    } else if (boss.type === 'gorgon' || boss.type === 'superconductor_boss') {
      // Pentagon star chassis with central volt core & 3 orbiting spark nodes
      batch.setBlendMode(GLBlendMode.NORMAL);

      // True 5-point pentagon chassis with alternating radius (Zero-Allocation Scratch)
      const gorgonPts = WebGLGameRenderer._scratchGorgonPts;
      const closedGorgon = WebGLGameRenderer._scratchGorgonClosedPts;
      for (let i = 0; i < 5; i++) {
        const a = bossAngle - Math.PI / 2 + (MathX.Tau * i) / 5;
        const dist = (i % 2 === 0 ? 1.25 : 0.95) * r;
        const px = bx + Math.cos(a) * dist;
        const py = by + Math.sin(a) * dist;
        gorgonPts[i]!.x = px;
        gorgonPts[i]!.y = py;
        closedGorgon[i]!.x = px;
        closedGorgon[i]!.y = py;
      }
      closedGorgon[5]!.x = closedGorgon[0]!.x;
      closedGorgon[5]!.y = closedGorgon[0]!.y;
      batch.drawPolygon(gorgonPts, headCol, 14);
      batch.drawPolyline(closedGorgon, 2.0, '#00f0b5', 8);

      // Central white volt core
      batch.drawSdfCircle(bx, by, r * 0.35, '#ffffff', entranceAlpha, 14, '#ffffff');

      // 3 Orbiting neon spark nodes
      batch.setBlendMode(GLBlendMode.ADDITIVE);
      for (let i = 0; i < 3; i++) {
        const sa = spiral * 2.5 + (MathX.Tau * i) / 3;
        const sparkX = bx + Math.cos(sa) * r * 1.4;
        const sparkY = by + Math.sin(sa) * r * 1.4;
        batch.drawSdfCircle(sparkX, sparkY, 5.5, '#00f0b5', entranceAlpha, 10, '#ffffff');
      }
    } else if (boss.type === 'frostwyrm') {
      // 8-point crystalline ice star (Zero-Allocation Scratch)
      batch.setBlendMode(GLBlendMode.NORMAL);
      const starPts = WebGLGameRenderer._scratchStarPts;
      const closedStar = WebGLGameRenderer._scratchStarClosedPts;
      for (let i = 0; i < 8; i++) {
        const a = bossAngle + (MathX.Tau * i) / 8;
        const dist = (i % 2 === 0 ? 1.35 : 0.75) * r;
        const px = bx + Math.cos(a) * dist;
        const py = by + Math.sin(a) * dist;
        starPts[i]!.x = px;
        starPts[i]!.y = py;
        closedStar[i]!.x = px;
        closedStar[i]!.y = py;
      }
      closedStar[8]!.x = closedStar[0]!.x;
      closedStar[8]!.y = closedStar[0]!.y;
      batch.drawPolygon(starPts, headCol, 16);
      batch.drawPolyline(closedStar, 2.0, '#e0fbfc', 8);

      // 4 Ice crystal facet lines radiating from center
      batch.setBlendMode(GLBlendMode.ADDITIVE);
      for (let i = 0; i < 4; i++) {
        const a = bossAngle + (MathX.Tau * i) / 4;
        const fx = bx + Math.cos(a) * r * 1.35;
        const fy = by + Math.sin(a) * r * 1.35;
        batch.drawLaserLine(bx, by, fx, fy, '#e0fbfc', 2.0, '#ffffff', entranceAlpha);
      }
    } else if (boss.type === 'chronowyrm') {
      // Concentric time dials + quantum core
      batch.setBlendMode(GLBlendMode.NORMAL);
      batch.drawSphere(bx, by, r * 0.95, headCol, 12);

      batch.setBlendMode(GLBlendMode.ADDITIVE);
      // Outer time dial ring
      batch.drawSdfRing(bx, by, r * 1.3, 2.5, headCol, entranceAlpha, 10, headCol);
      // Mid time dial ring
      batch.drawSdfRing(bx, by, r * 0.85, 2.0, accent, entranceAlpha, 6, accent);

      // Pulsating central quantum core
      const coreR = r * 0.45 * (0.8 + 0.2 * Math.sin(spiral * 3));
      batch.drawSdfCircle(bx, by, coreR, '#e0aaff', entranceAlpha, 16, '#ffffff');

      // 4 Rotating temporal chronoticks
      for (let i = 0; i < 4; i++) {
        const a = spiral * 1.5 + (MathX.Tau * i) / 4;
        const t1x = bx + Math.cos(a) * r * 0.85;
        const t1y = by + Math.sin(a) * r * 0.85;
        const t2x = bx + Math.cos(a) * r * 1.3;
        const t2y = by + Math.sin(a) * r * 1.3;
        batch.drawLaserLine(t1x, t1y, t2x, t2y, '#c084fc', 2.0, '#ffffff', entranceAlpha);
      }
    } else if (boss.type === 'leviathan') {
      // 3 Concentric rotating vortex rings
      batch.setBlendMode(GLBlendMode.NORMAL);
      const rotSpiral = spiral * 0.5;
      for (let ring = 0; ring < 3; ring++) {
        const ringAlpha = entranceAlpha * (0.35 + ring * 0.22);
        batch.drawSdfCircle(bx, by, r * (1.35 - ring * 0.3), headCol, ringAlpha, 8);
      }

      batch.setBlendMode(GLBlendMode.ADDITIVE);
      batch.drawSdfRing(bx, by, r * 1.7, 2.5, accent, entranceAlpha * 0.7, 8, accent);

      // 4 Celestial orbital arcs rotating with spiral (Zero-Allocation Scratch)
      const arcPts = WebGLGameRenderer._scratchLeviathanArcPts;
      for (let i = 0; i < 4; i++) {
        const baseA = rotSpiral + (MathX.Tau * i) / 4;
        for (let k = 0; k <= 6; k++) {
          const a = baseA + (0.9 * k) / 6;
          arcPts[k]!.x = bx + Math.cos(a) * r * 1.7;
          arcPts[k]!.y = by + Math.sin(a) * r * 1.7;
        }
        batch.drawPolyline(arcPts, 2.5, accent, 8);
      }
    } else if (
      boss.type === 'ouroboros' ||
      boss.type === 'eternal_ouroboros' ||
      boss.type === 'ouroboros_prime'
    ) {
      // Ouroboros Prime: Celestial Golden Dragon Skull with Swept-Back Horns & Cosmic Core
      batch.setBlendMode(GLBlendMode.NORMAL);
      const cosA = Math.cos(bossAngle);
      const sinA = Math.sin(bossAngle);

      // 3D Specular Celestial Dragon Skull
      batch.drawRotatedQuad(bx, by, r * 2.6, r * 2.1, bossAngle, headCol, 20, GLPrimitive.Sphere);

      // Symmetrical Swept-Back Celestial Horns / Crests
      const hornSides = WebGLGameRenderer._HORN_SIDES;
      for (let k = 0; k < hornSides.length; k++) {
        const sy = hornSides[k]!;
        const h0x = bx + (-r * 0.4) * cosA - (sy * r * 0.5) * sinA;
        const h0y = by + (-r * 0.4) * sinA + (sy * r * 0.5) * cosA;
        const h1x = bx + (-r * 1.2) * cosA - (sy * r * 0.9) * sinA;
        const h1y = by + (-r * 1.2) * sinA + (sy * r * 0.9) * cosA;
        const h2x = bx + (-r * 1.9) * cosA - (sy * r * 1.4) * sinA;
        const h2y = by + (-r * 1.9) * sinA + (sy * r * 1.4) * cosA;

        batch.drawLaserLine(h0x, h0y, h1x, h1y, accent, r * 0.18, '#ffffff', entranceAlpha);
        batch.drawLaserLine(h1x, h1y, h2x, h2y, accent, r * 0.12, '#ffffff', entranceAlpha);
      }

      // Pulsating Crown Solar Core
      const coreX = bx + cosA * (r * 0.2);
      const coreY = by + sinA * (r * 0.2);
      batch.drawSdfCircle(coreX, coreY, r * 0.48, '#ffd166', entranceAlpha, 16, '#ffffff');

      // Brilliant Twin Celestial Prism Eyes
      batch.setBlendMode(GLBlendMode.ADDITIVE);
      const eye1x = bx + (r * 0.4) * cosA - (-r * 0.45) * sinA;
      const eye1y = by + (r * 0.4) * sinA + (-r * 0.45) * cosA;
      const eye2x = bx + (r * 0.4) * cosA - (r * 0.45) * sinA;
      const eye2y = by + (r * 0.4) * sinA + (r * 0.45) * cosA;
      batch.drawSdfCircle(eye1x, eye1y, 6.0, '#00f0b5', entranceAlpha, 16, '#ffffff');
      batch.drawSdfCircle(eye2x, eye2y, 6.0, '#00f0b5', entranceAlpha, 16, '#ffffff');

      // Intricate Coronal Halo Ring
      batch.drawSdfRing(bx, by, r * 1.85, 3.0, '#ffe49e', entranceAlpha * 0.85, 14, '#ffd166');
    } else if (boss.type === 'void_devourer' || boss.type === 'void') {
      // Abyssal Singularity Maw & Gravitational Distortion Rings
      batch.setBlendMode(GLBlendMode.NORMAL);
      batch.drawSphere(bx, by, r * 1.1, '#05030a', 14);

      batch.setBlendMode(GLBlendMode.ADDITIVE);
      batch.drawSdfCircle(bx, by, r * 1.5, '#7928ca', entranceAlpha * 0.45, 18);
      batch.drawSdfRing(bx, by, r * 1.35, 3.0, '#b5179e', entranceAlpha * 0.8, 12, '#b5179e');
      batch.drawSdfRing(bx, by, r * 0.75, 2.0, '#c77dff', entranceAlpha * 0.9, 8, '#ffffff');
      batch.drawSdfCircle(bx, by, r * 0.4, '#000000', 1.0);
    } else if (boss.type === 'hivemind') {
      // Arachnid Broodmother Cephalothorax with Emerald Cluster Eyes
      batch.setBlendMode(GLBlendMode.NORMAL);
      batch.drawRotatedQuad(bx, by, r * 2.4, r * 1.8, bossAngle, headCol, 14, GLPrimitive.Sphere);

      // Emerald Compound Cluster Eyes
      batch.setBlendMode(GLBlendMode.ADDITIVE);
      const cosA = Math.cos(bossAngle);
      const sinA = Math.sin(bossAngle);
      for (let s = -1; s <= 1; s += 2) {
        for (let e = 0; e < 3; e++) {
          const ex = bx + (r * (0.3 + e * 0.2)) * cosA - (s * r * (0.35 + e * 0.15)) * sinA;
          const ey = by + (r * (0.3 + e * 0.2)) * sinA + (s * r * (0.35 + e * 0.15)) * cosA;
          batch.drawSdfCircle(ex, ey, 4.0, '#a3e635', entranceAlpha, 10, '#ffffff');
        }
      }
    } else {
      // Centipede Head: Elliptical Chitin Skull, Dual Curved Pincers/Mandibles, Golden Eyes
      batch.setBlendMode(GLBlendMode.NORMAL);
      const cosA = Math.cos(bossAngle);
      const sinA = Math.sin(bossAngle);

      // Elliptical chitin skull (3D Specular Focal Sphere)
      batch.drawRotatedQuad(bx, by, r * 2.5, r * 2.0, bossAngle, headCol, 18, GLPrimitive.Sphere);

      // Dual Curved Pincers / Mandibles
      const mandibleCol = ColorX.shade(accent, -0.25);
      const mandibleSides = WebGLGameRenderer._HORN_SIDES;
      for (let k = 0; k < mandibleSides.length; k++) {
        const sy = mandibleSides[k]!;
        const mx1 = bx + (r * 0.9) * cosA - (sy * r * 0.5) * sinA;
        const my1 = by + (r * 0.9) * sinA + (sy * r * 0.5) * cosA;
        const mx2 = bx + (r * 1.7) * cosA - (sy * r * 0.75) * sinA;
        const my2 = by + (r * 1.7) * sinA + (sy * r * 0.75) * cosA;
        const mx3 = bx + (r * 1.95) * cosA - (sy * r * 0.15) * sinA;
        const my3 = by + (r * 1.95) * sinA + (sy * r * 0.15) * cosA;

        batch.drawLaserLine(mx1, my1, mx2, my2, mandibleCol, Math.max(1, r * 0.16), '#ffffff', entranceAlpha);
        batch.drawLaserLine(mx2, my2, mx3, my3, mandibleCol, Math.max(1, r * 0.16), '#ffffff', entranceAlpha);
      }

      // Glowing Chitin Perimeter Arc
      batch.drawSdfRing(bx, by, r * 1.15 * 0.82, Math.max(1, r * 0.16), ColorX.rgba(accent, 0.45), entranceAlpha);

      // Glowing Golden Twin Eyes
      batch.setBlendMode(GLBlendMode.ADDITIVE);
      const e1x = bx + (r * 0.35) * cosA - (-r * 0.42) * sinA;
      const e1y = by + (r * 0.35) * sinA + (-r * 0.42) * cosA;
      const e2x = bx + (r * 0.35) * cosA - (r * 0.42) * sinA;
      const e2y = by + (r * 0.35) * sinA + (r * 0.42) * cosA;
      batch.drawSdfCircle(e1x, e1y, 5.5, '#ffe08a', entranceAlpha, 14, '#ffe08a');
      batch.drawSdfCircle(e2x, e2y, 5.5, '#ffe08a', entranceAlpha, 14, '#ffe08a');
    }

    // 5. Phase 2 Overdrive Aura Ring
    const phase = boss.Phase ?? boss.phase ?? 1;
    if (phase >= 2 && !entering) {
      batch.setBlendMode(GLBlendMode.ADDITIVE);
      const auraAlpha = 0.4 + Math.sin(spiral * 2) * 0.15;
      batch.drawSdfRing(bx, by, r * 1.9, 2.0, '#ff0054', auraAlpha, 10, '#ff0054');
    }
  }

  // ---------------------------------------------------------------- Player Snake

  public static drawPlayer(batch: GLBatch, player: ISnakeRenderData | any): void {
    const classDef = GameData.Classes.get(player.classId);
    const color = classDef ? classDef.color : '#00f0b5';
    const accent = classDef ? classDef.accent : '#10b981';
    const headR = player.headRadius || 12;

    // 14 Hz Invulnerability Strobe Calculation
    const invul = player.invulnerableTimer || 0;
    const isFlashing = invul > 0 && Math.floor(invul * 14) % 2 === 0;
    const playerAlpha = isFlashing ? 0.55 : 1.0;

    // 1. Afterimages (Shadow Stalker)
    if (player.afterimages && player.afterimages.length > 0) {
      batch.setBlendMode(GLBlendMode.ADDITIVE);
      for (let i = 0; i < player.afterimages.length; i++) {
        const a = player.afterimages[i]!;
        const t0 = a.max > 0 ? a.life / a.max : 0;
        batch.drawRotatedQuad(a.x, a.y, headR * 2.3, headR * 1.8, a.angle, ColorX.rgba(color, t0 * 0.35), 4, GLPrimitive.Circle);
      }
    }

    // 1B. Supersonic Mach-Cone Shockwave & Kinetic Wake during Dash
    if (player.isDashing || player.IsDashing) {
      batch.setBlendMode(GLBlendMode.ADDITIVE);
      const dCosA = Math.cos(player.angle);
      const dSinA = Math.sin(player.angle);
      // Supersonic shockwave wedge cone behind head
      batch.drawSdfWedge(
        player.x - dCosA * headR * 0.4,
        player.y - dSinA * headR * 0.4,
        headR * 3.4,
        player.angle + Math.PI,
        1.3,
        ColorX.rgba(color, 0.4),
        playerAlpha
      );

      // Speed streak lasers flanking serpent head
      const flX1 = player.x + (-dSinA * headR * 1.1);
      const flY1 = player.y + (dCosA * headR * 1.1);
      const flX2 = player.x + (dSinA * headR * 1.1);
      const flY2 = player.y + (-dCosA * headR * 1.1);
      batch.drawLaserLine(flX1, flY1, flX1 - dCosA * headR * 3.5, flY1 - dSinA * headR * 3.5, color, 2.5, '#ffffff', 0.85 * playerAlpha);
      batch.drawLaserLine(flX2, flY2, flX2 - dCosA * headR * 3.5, flY2 - dSinA * headR * 3.5, color, 2.5, '#ffffff', 0.85 * playerAlpha);
    }

    // 2. Complete 7.5-Pass Multi-Layer Cybernetic Serpentine Body Ribbon
    const segs = player.segments || player.Segments || [];
    if (segs.length > 0) {
      const spec = WebGLGameRenderer._playerSerpentineSpec;
      spec.x = player.x;
      spec.y = player.y;
      spec.angle = player.angle;
      spec.headRadius = headR;
      spec.color = color;
      spec.accent = accent;
      spec.segments = segs;
      spec.invulnerableTimer = player.invulnerableTimer;
      spec.hurtFlash = player.hurtFlash;
      batch.drawSerpentineMultiPass(spec, playerAlpha);
    }

    // 3. Serpent Head Skull & Shading
    const cosA = Math.cos(player.angle);
    const sinA = Math.sin(player.angle);
    const hurt = player.hurtFlash || 0;
    const skullCol = hurt > 0.4 ? '#ffffff' : color;


    // Hydra Secondary Heads (Drawn under main skull, exact Canvas2D parity: arc(-6, -15, 9) and arc(-6, 15, 9) without pupils)
    if (player.classId === 'hydra') {
      const h1x = player.x + (-6 * cosA - (-15) * sinA);
      const h1y = player.y + (-6 * sinA + (-15) * cosA);
      const h2x = player.x + (-6 * cosA - 15 * sinA);
      const h2y = player.y + (-6 * sinA + 15 * cosA);
      batch.drawSphere(h1x, h1y, 9, accent, 0);
      batch.drawSphere(h2x, h2y, 9, accent, 0);
    }


    // Soft additive ambient head halo (smooth cybernetic illumination)
    batch.setBlendMode(GLBlendMode.ADDITIVE);
    batch.drawCircle(player.x, player.y, headR * 1.8, ColorX.rgba(color, 0.25 * playerAlpha), 10);
    batch.setBlendMode(GLBlendMode.NORMAL);

    // Elongated Rotated 2D Sphere Gradient Skull (pure smooth 2D radial gradient matching Ctx2D.createSphereGradient)
    batch.drawRotatedQuad(player.x, player.y, headR * 2.5, headR * 2.0, player.angle, skullCol, 0, GLPrimitive.Sphere);

    // Brow Ridge and Jaw Shadow Layering (Layered on skull when not flashing)
    if (hurt <= 0.4) {
      // Accent Brow Ridge
      const brX = player.x + (-headR * 0.1) * cosA - (-headR * 0.34) * sinA;
      const brY = player.y + (-headR * 0.1) * sinA + (-headR * 0.34) * cosA;
      batch.drawRotatedQuad(brX, brY, headR * 1.6, headR * 0.68, player.angle - 0.16, ColorX.rgba(accent, 0.3 * playerAlpha), 0, GLPrimitive.Circle);

      // Jaw Shadow
      const jsX = player.x + (headR * 0.1) * cosA - (headR * 0.5) * sinA;
      const jsY = player.y + (headR * 0.1) * sinA + (headR * 0.5) * cosA;
      batch.drawRotatedQuad(jsX, jsY, headR * 1.7, headR * 0.6, player.angle + 0.12, `rgba(3, 7, 14, ${0.34 * playerAlpha})`, 0, GLPrimitive.Circle);
    }

    // Cranial Damage Visual Feedback (Exact match with Canvas2D SnakeRenderer.ts lines 381-390: partial arc in NORMAL mode with 2.5px width and zero glow)
    const headHp = player.headHp !== undefined ? player.headHp : 50;
    const headMaxHp = player.headMaxHp !== undefined ? player.headMaxHp : 50;
    if (headHp < headMaxHp || hurt > 0) {
      batch.setBlendMode(GLBlendMode.NORMAL);
      const headHpPct = MathX.clamp01(headHp / Math.max(1, headMaxHp));
      const headWarnCol = headHpPct < 0.3 ? '#ef4444' : (headHpPct < 0.6 ? '#f59e0b' : '#ffd166');
      const startAngle = player.angle - Math.PI / 2;
      const endAngle = startAngle + headHpPct * MathX.Tau;
      batch.drawSdfArc(
        player.x,
        player.y,
        headR * 1.55,
        startAngle,
        endAngle,
        2.5,
        headWarnCol,
        playerAlpha,
        0
      );
    }

    // 4. Mouth Cavity Opening Animation (Exact Canvas2D parity: dark red cavity wedge and pink tongue, zero synthetic fangs)
    const mouth = player.mouthOpen || 0;
    if (mouth > 0.02) {
      batch.setBlendMode(GLBlendMode.NORMAL);
      // Dark red mouth cavity wedge
      const mX = player.x + cosA * headR * 0.35;
      const mY = player.y + sinA * headR * 0.35;
      batch.drawSdfWedge(mX, mY, headR * 0.95, player.angle, mouth * 1.5, '#4a0d1a', playerAlpha);

      // Pink tongue
      const tX = player.x + cosA * headR * 0.55;
      const tY = player.y + sinA * headR * 0.55;
      batch.drawSdfCircle(tX, tY, headR * 0.34 * mouth, '#ff3366', playerAlpha);
    }

    // 5. Cute Visor Eyes (Open with Sclera + Pupils + Glints vs Blinking Closed Line Slits)
    if (!player.eyeBlinking) {
      batch.setBlendMode(GLBlendMode.NORMAL);
      const e1x = player.x + (4 * cosA - (-6) * sinA);
      const e1y = player.y + (4 * sinA + (-6) * cosA);
      const e2x = player.x + (4 * cosA - 6 * sinA);
      const e2y = player.y + (4 * sinA + 6 * cosA);

      // Two White Sclera Circles (r = 3.6)
      batch.drawSdfCircle(e1x, e1y, 3.6, '#ffffff', playerAlpha);
      batch.drawSdfCircle(e2x, e2y, 3.6, '#ffffff', playerAlpha);

      // Two Dark Pupil Circles (r = 1.9) offset forward along snake angle
      const p1x = player.x + (5.2 * cosA - (-6) * sinA);
      const p1y = player.y + (5.2 * sinA + (-6) * cosA);
      const p2x = player.x + (5.2 * cosA - 6 * sinA);
      const p2y = player.y + (5.2 * sinA + 6 * cosA);
      batch.drawSdfCircle(p1x, p1y, 1.9, '#05080f', playerAlpha);
      batch.drawSdfCircle(p2x, p2y, 1.9, '#05080f', playerAlpha);

      // Cute eye specular glints (r = 0.65)
      batch.drawSdfCircle(p1x + cosA * 0.6, p1y + sinA * 0.6, 0.65, '#ffffff', playerAlpha);
      batch.drawSdfCircle(p2x + cosA * 0.6, p2y + sinA * 0.6, 0.65, '#ffffff', playerAlpha);
    } else {
      // Closed Eyelid Line Slits (thickness 1.6)
      batch.setBlendMode(GLBlendMode.NORMAL);
      const l1sX = player.x + (1 * cosA - (-6) * sinA);
      const l1sY = player.y + (1 * sinA + (-6) * cosA);
      const l1eX = player.x + (7.5 * cosA - (-6) * sinA);
      const l1eY = player.y + (7.5 * sinA + (-6) * cosA);

      const l2sX = player.x + (1 * cosA - 6 * sinA);
      const l2sY = player.y + (1 * sinA + 6 * cosA);
      const l2eX = player.x + (7.5 * cosA - 6 * sinA);
      const l2eY = player.y + (7.5 * sinA + 6 * cosA);

      batch.drawLaser(l1sX, l1sY, l1eX, l1eY, 1.6, ColorX.rgba('#05080f', playerAlpha), 0);
      batch.drawLaser(l2sX, l2sY, l2eX, l2eY, 1.6, ColorX.rgba('#05080f', playerAlpha), 0);
    }

    // 7. Relic Orbitals (3-Point Oriented Fangs)
    if (player.orbitals && player.orbitals.length > 0) {
      batch.setBlendMode(GLBlendMode.ADDITIVE);
      for (let i = 0; i < player.orbitals.length; i++) {
        const o = player.orbitals[i]!;
        const cosO = Math.cos((o.a || 0) + Math.PI / 2);
        const sinO = Math.sin((o.a || 0) + Math.PI / 2);

        const p1x = o.x - sinO * -11;
        const p1y = o.y + cosO * -11;
        const p2x = o.x + cosO * 6.5 - sinO * 6;
        const p2y = o.y + sinO * 6.5 + cosO * 6;
        const p3x = o.x - cosO * 6.5 - sinO * 6;
        const p3y = o.y - sinO * 6.5 + cosO * 6;

        batch.drawTriangle(p1x, p1y, p2x, p2y, p3x, p3y, '#c77dff', 10);
        batch.drawSdfCircle(o.x, o.y, 4, '#ffffff', playerAlpha, 4);
      }
    }

    // 8. Shield Bubble with Dynamic Opacity & Hex Pulse
    const shield = player.shield || 0;
    if (shield > 0) {
      batch.setBlendMode(GLBlendMode.ADDITIVE);
      const maxShield = player.stats ? player.stats.maxShield : 50;
      const sPct = MathX.clamp01(shield / Math.max(1, maxShield));
      const sAlpha = (0.35 + 0.45 * sPct) * playerAlpha;
      batch.drawSdfRing(player.x, player.y, headR + 9, 2.5, '#3a86ff', sAlpha, 14, '#3a86ff');
      batch.drawSdfCircle(player.x, player.y, headR + 8, '#3a86ff', sAlpha * 0.2);
    }

    // 8.5 Frostbite Relic Aura Ring
    const relics = player.relics || {};
    const frostbite = relics.frostbite || 0;
    if (frostbite > 0) {
      batch.setBlendMode(GLBlendMode.ADDITIVE);
      batch.drawSdfRing(player.x, player.y, 100 + frostbite * 20, 2.0, 'rgba(125, 211, 252, 0.18)', playerAlpha, 6, '#7dd3fc');
    }

    // 9. All 6 Boss Helmet Archetypes (Centipede, Colossus, Frostwyrm, Leviathan, Chrono, Gorgon, Void)
    const helm = player.equippedHelmet || (player as any).EquippedHelmet;
    if (helm) {
      const rawType = ((helm.archetype || helm.bossType || (helm as any).BossType) || '').toLowerCase();
      const rawName = ((helm.name || (helm as any).Name) || '').toLowerCase();
      const rarityKey = ((helm.rarity || helm.Rarity) || 'common').toLowerCase() as HelmetRarity;
      const helmCol = HELMET_RARITY_COLORS[rarityKey] || '#94a3b8';

      let archetype: 'colossus' | 'frostwyrm' | 'chrono' | 'gorgon' | 'centipede' | 'leviathan' | 'void';
      if (rawType.includes('frostwyrm') || /frostwyrm|glacial|permafrost|rime|blizzard|cryo/i.test(rawName)) {
        archetype = 'frostwyrm';
      } else if (rawType.includes('colossus') || /colossus|infernal|magmatic|titan|obsidian|furnace|smoldering|bulwark|greathelm|iron|steel/i.test(rawName)) {
        archetype = 'colossus';
      } else if (rawType.includes('chrono') || /chrono|temporal|time|dilation|tiara|clockwork|paradox|tachyon|diadem/i.test(rawName)) {
        archetype = 'chrono';
      } else if (rawType.includes('gorgon') || /gorgon|ophidian|cobra|fang|jade|serpent|venom|volt/i.test(rawName)) {
        archetype = 'gorgon';
      } else if (rawType.includes('centipede') || /centipede|chitin|myriapod|swarmling|carapace|hive/i.test(rawName)) {
        archetype = 'centipede';
      } else if (rawType.includes('leviathan') || /leviathan|abyssal|ocean|deep|tide|azure/i.test(rawName)) {
        archetype = 'leviathan';
      } else if (rawType.includes('void') || /void|singularity|cowl|cosmic|astral|shadow|dark|eclipse|abyss/i.test(rawName)) {
        archetype = 'void';
      } else {
        const resolved = SnakeRenderer.resolveHelmetArchetype(helm);
        archetype = resolved as any;
      }

      if (archetype === 'centipede') {
        batch.setBlendMode(GLBlendMode.NORMAL);
        const mandibleCol = ColorX.shade(helmCol, -0.4);
        for (let s = 0; s < 2; s++) {
          const sy = s === 0 ? -1 : 1;
          const m1x = player.x + (headR * 0.2) * cosA - (sy * headR * 0.7) * sinA;
          const m1y = player.y + (headR * 0.2) * sinA + (sy * headR * 0.7) * cosA;
          const m2x = player.x + (headR * 0.85) * cosA - (sy * headR * 1.05) * sinA;
          const m2y = player.y + (headR * 0.85) * sinA + (sy * headR * 1.05) * cosA;
          const m3x = player.x + (headR * 1.5) * cosA - (sy * headR * 0.45) * sinA;
          const m3y = player.y + (headR * 1.5) * sinA + (sy * headR * 0.45) * cosA;
          const m4x = player.x + (headR * 1.35) * cosA - (sy * headR * 0.08) * sinA;
          const m4y = player.y + (headR * 1.35) * sinA + (sy * headR * 0.08) * cosA;

          batch.drawLaser(m1x, m1y, m2x, m2y, 2.5, helmCol, 6);
          batch.drawLaser(m2x, m2y, m3x, m3y, 2.5, helmCol, 6);
          batch.drawLaser(m3x, m3y, m4x, m4y, 2.0, mandibleCol, 4);

          // Mandible ribs
          const r1x = player.x + (headR * 0.65) * cosA - (sy * headR * 0.75) * sinA;
          const r1y = player.y + (headR * 0.65) * sinA + (sy * headR * 0.75) * cosA;
          const r2x = player.x + (headR * 0.55) * cosA - (sy * headR * 0.45) * sinA;
          const r2y = player.y + (headR * 0.55) * sinA + (sy * headR * 0.45) * cosA;
          batch.drawLaser(r1x, r1y, r2x, r2y, 1.5, helmCol, 0);

          // Sweeping antennae
          const a1x = player.x + (headR * 0.35) * cosA - (sy * headR * 0.35) * sinA;
          const a1y = player.y + (headR * 0.35) * sinA + (sy * headR * 0.35) * cosA;
          const a2x = player.x + (headR * 0.75) * cosA - (sy * headR * 1.1) * sinA;
          const a2y = player.y + (headR * 0.75) * sinA + (sy * headR * 1.1) * cosA;
          const a3x = player.x + (-headR * 0.1) * cosA - (sy * headR * 1.35) * sinA;
          const a3y = player.y + (-headR * 0.1) * sinA + (sy * headR * 1.35) * cosA;
          const a4x = player.x + (-headR * 0.85) * cosA - (sy * headR * 1.15) * sinA;
          const a4y = player.y + (-headR * 0.85) * sinA + (sy * headR * 1.15) * cosA;

          batch.drawLaser(a1x, a1y, a2x, a2y, 1.8, '#ffd166', 4);
          batch.drawLaser(a2x, a2y, a3x, a3y, 1.8, '#ffd166', 4);
          batch.drawLaser(a3x, a3y, a4x, a4y, 1.8, '#ffd166', 4);

          // Bioluminescent tip bulb
          batch.setBlendMode(GLBlendMode.ADDITIVE);
          batch.drawSdfCircle(a4x, a4y, headR * 0.16, '#ffffff', playerAlpha, 6);
          batch.drawSdfCircle(a4x, a4y, headR * 0.24, '#ffd166', playerAlpha * 0.5, 4);
          batch.setBlendMode(GLBlendMode.NORMAL);
        }

        // Brow plate and golden gem
        const vX = player.x + cosA * headR * 0.1;
        const vY = player.y + sinA * headR * 0.1;
        batch.drawRotatedQuad(vX, vY, headR * 0.7, headR * 1.3, player.angle, ColorX.rgba(helmCol, 0.45 * playerAlpha), 4, GLPrimitive.Sphere);
        batch.setBlendMode(GLBlendMode.ADDITIVE);
        const gX = player.x + cosA * headR * 0.25;
        const gY = player.y + sinA * headR * 0.25;
        batch.drawSdfCircle(gX, gY, headR * 0.18, '#ffd166', playerAlpha, 6);
      } else if (archetype === 'colossus') {
        batch.setBlendMode(GLBlendMode.NORMAL);
        // Steel Greathelm Base Shell
        batch.drawRotatedQuad(player.x - cosA * headR * 0.1, player.y - sinA * headR * 0.1, headR * 2.0, headR * 1.6, player.angle, '#0f172a', 0, GLPrimitive.Sphere);
        batch.drawRotatedQuad(player.x - cosA * headR * 0.1, player.y - sinA * headR * 0.1, headR * 2.0, headR * 1.6, player.angle, helmCol, 6, GLPrimitive.Ring);

        // Louver ear plates and ventilation slits
        for (let s = 0; s < 2; s++) {
          const sy = s === 0 ? -1 : 1;
          const e1x = player.x + (-headR * 0.35) * cosA - (sy * headR * 0.85) * sinA;
          const e1y = player.y + (-headR * 0.35) * sinA + (sy * headR * 0.85) * cosA;
          const e2x = player.x + (headR * 0.2) * cosA - (sy * headR * 0.85) * sinA;
          const e2y = player.y + (headR * 0.2) * sinA + (sy * headR * 0.85) * cosA;
          const e3x = player.x + (headR * 0.1) * cosA - (sy * headR * 1.22) * sinA;
          const e3y = player.y + (headR * 0.1) * sinA + (sy * headR * 1.22) * cosA;
          const e4x = player.x + (-headR * 0.4) * cosA - (sy * headR * 1.15) * sinA;
          const e4y = player.y + (-headR * 0.4) * sinA + (sy * headR * 1.15) * cosA;

          batch.drawLaser(e1x, e1y, e2x, e2y, 1.8, helmCol, 0);
          batch.drawLaser(e2x, e2y, e3x, e3y, 1.8, helmCol, 0);
          batch.drawLaser(e3x, e3y, e4x, e4y, 1.8, helmCol, 0);
          batch.drawLaser(e4x, e4y, e1x, e1y, 1.8, helmCol, 0);

          // Louver slits
          const s1x = player.x + (-headR * 0.2) * cosA - (sy * headR * 0.95) * sinA;
          const s1y = player.y + (-headR * 0.2) * sinA + (sy * headR * 0.95) * cosA;
          const s2x = player.x + (0) * cosA - (sy * headR * 0.95) * sinA;
          const s2y = player.y + (0) * sinA + (sy * headR * 0.95) * cosA;
          batch.drawLaser(s1x, s1y, s2x, s2y, 1.4, helmCol, 0);
        }

        // Energy Visor Slit & White Chevron
        batch.setBlendMode(GLBlendMode.ADDITIVE);
        const vX = player.x + cosA * headR * 0.25;
        const vY = player.y + sinA * headR * 0.25;
        batch.drawRotatedQuad(vX, vY, headR * 0.8, headR * 1.3, player.angle, ColorX.rgba(helmCol, 0.45 * playerAlpha), 8, GLPrimitive.Sphere);

        const ch1x = player.x + (headR * 0.1) * cosA - (-headR * 0.45) * sinA;
        const ch1y = player.y + (headR * 0.1) * sinA + (-headR * 0.45) * cosA;
        const ch2x = player.x + (headR * 0.62) * cosA;
        const ch2y = player.y + (headR * 0.62) * sinA;
        const ch3x = player.x + (headR * 0.1) * cosA - (headR * 0.45) * sinA;
        const ch3y = player.y + (headR * 0.1) * sinA + (headR * 0.45) * cosA;

        batch.drawLaser(ch1x, ch1y, ch2x, ch2y, 2.0, '#ffffff', 6);
        batch.drawLaser(ch2x, ch2y, ch3x, ch3y, 2.0, '#ffffff', 6);
        batch.drawSdfDiamond(ch2x, ch2y, headR * 0.35, '#ffffff', playerAlpha, 6);
      } else if (archetype === 'frostwyrm') {
        batch.setBlendMode(GLBlendMode.NORMAL);
        const azure = '#38bdf8';
        const paleIce = '#e0f2fe';

        // Permafrost Rime Carapace Fin
        batch.drawRotatedQuad(player.x - cosA * headR * 0.15, player.y - sinA * headR * 0.15, headR * 1.5, headR * 0.8, player.angle, ColorX.rgba(azure, 0.4 * playerAlpha), 6, GLPrimitive.Sphere);

        // Crystalline Pale-Blue Ice Horns
        batch.setBlendMode(GLBlendMode.ADDITIVE);
        for (let s = 0; s < 2; s++) {
          const sy = s === 0 ? -1 : 1;
          const h1x = player.x + (0) * cosA - (sy * headR * 0.5) * sinA;
          const h1y = player.y + (0) * sinA + (sy * headR * 0.5) * cosA;
          const h2x = player.x + (-headR * 0.7) * cosA - (sy * headR * 1.35) * sinA;
          const h2y = player.y + (-headR * 0.7) * sinA + (sy * headR * 1.35) * cosA;
          const h3x = player.x + (-headR * 1.6) * cosA - (sy * headR * 1.05) * sinA;
          const h3y = player.y + (-headR * 1.6) * sinA + (sy * headR * 1.05) * cosA;
          const h4x = player.x + (-headR * 2.1) * cosA - (sy * headR * 0.45) * sinA;
          const h4y = player.y + (-headR * 2.1) * sinA + (sy * headR * 0.45) * cosA;

          batch.drawLaser(h1x, h1y, h2x, h2y, 2.6, azure, 8);
          batch.drawLaser(h2x, h2y, h3x, h3y, 2.6, azure, 8);
          batch.drawLaser(h3x, h3y, h4x, h4y, 2.2, paleIce, 10);

          // Secondary crystalline spires
          const s1x = player.x + (-headR * 0.35) * cosA - (sy * headR * 0.85) * sinA;
          const s1y = player.y + (-headR * 0.35) * sinA + (sy * headR * 0.85) * cosA;
          const s2x = player.x + (-headR * 1.1) * cosA - (sy * headR * 1.5) * sinA;
          const s2y = player.y + (-headR * 1.1) * sinA + (sy * headR * 1.5) * cosA;
          batch.drawLaser(s1x, s1y, s2x, s2y, 2.0, paleIce, 8);
          batch.drawSdfDiamond(s2x, s2y, headR * 0.22, '#ffffff', playerAlpha, 6);
        }

        // Glacial Diamond Core & Frost Ring
        const coreX = player.x + cosA * headR * 0.3;
        const coreY = player.y + sinA * headR * 0.3;
        batch.drawSdfRing(coreX, coreY, headR * 0.55, 1.8, azure, playerAlpha, 8, azure);
        batch.drawSdfDiamond(coreX, coreY, headR * 0.45, paleIce, playerAlpha, 10);
        batch.drawSdfCircle(coreX, coreY, headR * 0.16, '#ffffff', playerAlpha, 6);
      } else if (archetype === 'leviathan') {
        batch.setBlendMode(GLBlendMode.NORMAL);
        const azure = '#38bdf8';

        // Abyssal Dorsal Fin Crest
        batch.drawRotatedQuad(player.x - cosA * headR * 0.25, player.y - sinA * headR * 0.25, headR * 1.6, headR * 0.85, player.angle, '#0f172a', 0, GLPrimitive.Sphere);
        batch.drawRotatedQuad(player.x - cosA * headR * 0.25, player.y - sinA * headR * 0.25, headR * 1.6, headR * 0.85, player.angle, azure, 6, GLPrimitive.Ring);

        // Sweeping Abyssal Horns
        batch.setBlendMode(GLBlendMode.ADDITIVE);
        for (let s = 0; s < 2; s++) {
          const sy = s === 0 ? -1 : 1;
          const h1x = player.x + (-headR * 0.1) * cosA - (sy * headR * 0.45) * sinA;
          const h1y = player.y + (-headR * 0.1) * sinA + (sy * headR * 0.45) * cosA;
          const h2x = player.x + (-headR * 0.65) * cosA - (sy * headR * 1.35) * sinA;
          const h2y = player.y + (-headR * 0.65) * sinA + (sy * headR * 1.35) * cosA;
          const h3x = player.x + (-headR * 1.45) * cosA - (sy * headR * 1.15) * sinA;
          const h3y = player.y + (-headR * 1.45) * sinA + (sy * headR * 1.15) * cosA;
          const h4x = player.x + (-headR * 1.95) * cosA - (sy * headR * 0.6) * sinA;
          const h4y = player.y + (-headR * 1.95) * sinA + (sy * headR * 0.6) * cosA;

          batch.drawLaser(h1x, h1y, h2x, h2y, 2.8, helmCol, 8);
          batch.drawLaser(h2x, h2y, h3x, h3y, 2.8, helmCol, 8);
          batch.drawLaser(h3x, h3y, h4x, h4y, 2.4, azure, 10);

          // Azure ridges
          const r1x = player.x + (-headR * 0.6) * cosA - (sy * headR * 0.95) * sinA;
          const r1y = player.y + (-headR * 0.6) * sinA + (sy * headR * 0.95) * cosA;
          const r2x = player.x + (-headR * 0.45) * cosA - (sy * headR * 0.65) * sinA;
          const r2y = player.y + (-headR * 0.45) * sinA + (sy * headR * 0.65) * cosA;
          batch.drawLaser(r1x, r1y, r2x, r2y, 1.5, azure, 4);
        }

        // Azure Visor Plate
        const vX = player.x + cosA * headR * 0.1;
        const vY = player.y + sinA * headR * 0.1;
        batch.drawRotatedQuad(vX, vY, headR * 0.7, headR * 1.2, player.angle, ColorX.rgba(azure, 0.45 * playerAlpha), 6, GLPrimitive.Sphere);
      } else if (archetype === 'chrono') {
        batch.setBlendMode(GLBlendMode.ADDITIVE);
        // Concentric Clockwork Tiara Dial Arc
        batch.drawSdfRing(player.x, player.y, headR * 1.25, 2.2, helmCol, playerAlpha, 8, helmCol);

        // Clockwork Ticks
        for (let k = -2; k <= 2; k++) {
          const ta = player.angle + (k * Math.PI) / 6;
          const t1x = player.x + Math.cos(ta) * headR * 1.15;
          const t1y = player.y + Math.sin(ta) * headR * 1.15;
          const t2x = player.x + Math.cos(ta) * headR * 1.35;
          const t2y = player.y + Math.sin(ta) * headR * 1.35;
          batch.drawLaser(t1x, t1y, t2x, t2y, 1.8, helmCol, 4);
        }

        // Chevron Tiara Band
        const ch1x = player.x + (-headR * 0.5) * cosA - (-headR * 0.75) * sinA;
        const ch1y = player.y + (-headR * 0.5) * sinA + (-headR * 0.75) * cosA;
        const ch2x = player.x + (0) * cosA - (-headR * 0.95) * sinA;
        const ch2y = player.y + (0) * sinA + (-headR * 0.95) * cosA;
        const ch3x = player.x + (headR * 0.5) * cosA - (-headR * 0.75) * sinA;
        const ch3y = player.y + (headR * 0.5) * sinA + (-headR * 0.75) * cosA;
        batch.drawLaser(ch1x, ch1y, ch2x, ch2y, 2.0, helmCol, 4);
        batch.drawLaser(ch2x, ch2y, ch3x, ch3y, 2.0, helmCol, 4);

        // Brow Plate & Tachyon Gem
        const vX = player.x + cosA * headR * 0.1;
        const vY = player.y + sinA * headR * 0.1;
        batch.drawRotatedQuad(vX, vY, headR * 0.7, headR * 1.4, player.angle, ColorX.rgba(helmCol, 0.4 * playerAlpha), 4, GLPrimitive.Sphere);

        const gemX = player.x + cosA * headR * 0.35;
        const gemY = player.y + sinA * headR * 0.35;
        batch.drawSdfDiamond(gemX, gemY, headR * 0.55, '#c084fc', playerAlpha, 10);
        batch.drawSdfCircle(gemX, gemY, headR * 0.16, '#ffffff', playerAlpha, 6);
      } else if (archetype === 'gorgon') {
        batch.setBlendMode(GLBlendMode.NORMAL);
        const emerald = '#10b981';
        const venomLime = '#84cc16';

        // Flared Cobra Hood Carapace
        batch.drawRotatedQuad(player.x - cosA * headR * 0.2, player.y - sinA * headR * 0.2, headR * 1.6, headR * 3.2, player.angle, ColorX.shade(emerald, -0.65), 0, GLPrimitive.Sphere);
        batch.drawRotatedQuad(player.x - cosA * headR * 0.2, player.y - sinA * headR * 0.2, headR * 1.6, headR * 3.2, player.angle, helmCol, 6, GLPrimitive.Ring);

        // Dual Forward Venom Fangs
        batch.setBlendMode(GLBlendMode.ADDITIVE);
        for (let s = 0; s < 2; s++) {
          const sy = s === 0 ? -1 : 1;
          const vf1x = player.x + (headR * 0.75) * cosA - (sy * headR * 0.38) * sinA;
          const vf1y = player.y + (headR * 0.75) * sinA + (sy * headR * 0.38) * cosA;
          const vf2x = player.x + (headR * 1.45) * cosA - (sy * headR * 0.18) * sinA;
          const vf2y = player.y + (headR * 1.45) * sinA + (sy * headR * 0.18) * cosA;
          batch.drawLaser(vf1x, vf1y, vf2x, vf2y, 2.4, venomLime, 8);
          batch.drawSdfCircle(vf2x, vf2y, 2.2, '#ffffff', playerAlpha, 4);

          // Hood lateral ribs
          const h1x = player.x + (0) * cosA - (sy * headR * 1.65) * sinA;
          const h1y = player.y + (0) * sinA + (sy * headR * 1.65) * cosA;
          const h2x = player.x + (-headR * 0.95) * cosA - (sy * headR * 1.35) * sinA;
          const h2y = player.y + (-headR * 0.95) * sinA + (sy * headR * 1.35) * cosA;
          batch.drawLaser(h1x, h1y, h2x, h2y, 1.8, emerald, 4);
        }

        // Brow Plate
        const vX = player.x + cosA * headR * 0.15;
        const vY = player.y + sinA * headR * 0.15;
        batch.drawRotatedQuad(vX, vY, headR * 0.75, headR * 1.3, player.angle, ColorX.rgba(emerald, 0.45 * playerAlpha), 4, GLPrimitive.Sphere);
      } else {
        // Void Singularity Cowl & Event Horizon
        batch.setBlendMode(GLBlendMode.NORMAL);
        // Hexagonal cowl plate
        batch.drawRotatedQuad(player.x - cosA * headR * 0.15, player.y - sinA * headR * 0.15, headR * 1.8, headR * 1.6, player.angle, '#030712', 0, GLPrimitive.Sphere);
        batch.drawRotatedQuad(player.x - cosA * headR * 0.15, player.y - sinA * headR * 0.15, headR * 1.8, headR * 1.6, player.angle, helmCol, 6, GLPrimitive.Ring);

        batch.setBlendMode(GLBlendMode.ADDITIVE);
        // Sweeping Astral Horn Blades
        for (let s = 0; s < 2; s++) {
          const sy = s === 0 ? -1 : 1;
          const v1x = player.x + (-headR * 0.35) * cosA - (sy * headR * 0.65) * sinA;
          const v1y = player.y + (-headR * 0.35) * sinA + (sy * headR * 0.65) * cosA;
          const v2x = player.x + (-headR * 1.8) * cosA - (sy * headR * 1.15) * sinA;
          const v2y = player.y + (-headR * 1.8) * sinA + (sy * headR * 1.15) * cosA;
          const v3x = player.x + (-headR * 0.85) * cosA - (sy * headR * 0.55) * sinA;
          const v3y = player.y + (-headR * 0.85) * sinA + (sy * headR * 0.55) * cosA;

          batch.drawLaser(v1x, v1y, v2x, v2y, 3.0, helmCol, 10);
          batch.drawLaser(v2x, v2y, v3x, v3y, 2.0, '#ffffff', 8);
        }

        // Black Hole Singularity Core & Event Horizon
        const coreX = player.x - cosA * headR * 0.2;
        const coreY = player.y - sinA * headR * 0.2;
        batch.drawSdfCircle(coreX, coreY, headR * 0.35, '#030712', playerAlpha);
        batch.drawSdfRing(coreX, coreY, headR * 0.45, 1.8, '#f72585', playerAlpha, 10, '#ffffff');
        batch.drawSdfCircle(coreX, coreY, headR * 0.12, '#ffffff', playerAlpha, 8);
      }
    }
  }

  // ---------------------------------------------------------------- Particle FX

  public static drawFx(batch: GLBatch, fx: FxManager, w: number, h: number): void {
    fx.render(batch, w, h);
  }
}
