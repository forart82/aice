/**
 * ============================================================================
 * Hardware-Accelerated Cosmic Arena Backdrop Specification (ArenaBackdrop.ts)
 * Protocol 3.0 Commercial Engine Edition — Rule 12 Pure WebGL Mandate
 * ============================================================================
 *
 * Single Source of Truth (SSOT): ORACLE.md & AGENTS.md (Rule 6, Rule 10, Rule 12)
 * Feature TDD Spec: docs/tdd/backdrop_nebula_smooth_sdf_and_lighting.tdd.md
 *
 * ARCHITECTURAL SUMMARY:
 * ---------------------
 * `ArenaBackdrop` defines the mathematical starfield distributions, celestial
 * grid geometries, and procedural nebula backdrop passes for each floor theme.
 *
 * BACKDROP SHADER PASSES & MULTI-TIER STARFIELD (Rule 10):
 * --------------------------------------------------------
 * 1. 3-Tier Parallax Dynamic Starfield (Total: 266 stars):
 *    - Layer 0 (Micro-Stars, Count: 180):
 *      Size: [0.75, 1.20]px, Parallax Depth: [0.15, 0.40], Alpha: [0.20, 0.60].
 *      Provides infinite cosmic depth with subtle low-frequency twinkling.
 *    - Layer 1 (Spectral Mid Stars, Count: 70):
 *      Size: [1.45, 2.30]px, Parallax Depth: [0.45, 0.80], Alpha: [0.45, 0.85].
 *      Tinted by floor-specific chromatic hues (White, Emerald, Gold, Lavender).
 *    - Layer 2 (Diamond Beacons & Pulsars, Count: 16):
 *      Size: [2.65, 3.80]px, Parallax Depth: [0.85, 1.00], Alpha: [0.70, 1.00].
 *      Rendered with cross diffraction flares and high-frequency harmonic pulsation.
 *
 * 2. WebGL Backdrop Shader Passes:
 *    - Pass 1: Deep cosmic void background fill (#020306 base).
 *    - Pass 2: Volumetric nebula dust plane (dual-harmonic Gaussian falloff).
 *    - Pass 3: The Neon Rounded Square Grid of Ouroboros Ascension (constant-texel light pools).
 *    - Pass 4: Arena laser perimeter boundary and corner warning beacons.
 *    - Pass 5: Dynamic multi-layer parallax starfield with camera offset tracking.
 *
 * 3. Pure WebGL Mandate (Rule 12):
 *    Legacy HTML5 Canvas 2D draw routines are permanently suppressed.
 *    All runtime drawing executes strictly via WebGLGameRenderer.drawBackdrop and GLBatch.
 */

import { RenderQuality } from './RenderQuality';
import { ColorX } from './ColorX';
import { MathX } from '../core/MathX';
import { Rng } from '../core/Rng';
import { OuroborosMenuAnimation } from './OuroborosMenuAnimation';

/**
 * Procedural star definition for the 3-tier cosmic parallax starfield.
 */
export interface IStarDef {
  x: number;
  y: number;
  size: number;
  depth: number;
  layer: number;       // 0: Micro, 1: Mid, 2: Beacon
  baseAlpha: number;
  phase: number;
  twinkleSpeed: number;
  colorType: number;   // 0: White, 1: Floor Tint, 2: Gold, 3: Lavender
}

/**
 * Atmospheric celestial drift mote.
 */
export interface DriftMote {
  x: number;
  y: number;
  r: number;
  depth: number;
  phase: number;
  drift: number;
}

export class ArenaBackdrop {
  private static readonly GridSize = 88;
  private static readonly TotalStars = 266; // 180 Micro + 70 Mid + 16 Beacons

  private _cachedCanvases: Map<string, HTMLCanvasElement> = new Map();
  private _stars: IStarDef[] | null = null;

  public invalidate(): void {
    this._cachedCanvases.clear();
  }

  public initDriftField(): void {
    this.initStarfield();
  }

  public initStarfield(): void {
    const rng = Rng.Cosmetic;
    const stars: IStarDef[] = new Array(ArenaBackdrop.TotalStars);

    // 1. Micro-Stars (0..179)
    for (let i = 0; i < 180; i++) {
      stars[i] = {
        x: rng.rand(),
        y: rng.rand(),
        size: 0.75 + rng.rand() * 0.45,
        depth: 0.15 + rng.rand() * 0.25,
        layer: 0,
        baseAlpha: 0.20 + rng.rand() * 0.40,
        phase: rng.rand() * MathX.Tau,
        twinkleSpeed: 0.03 + rng.rand() * 0.04,
        colorType: rng.rand() > 0.3 ? 0 : 1,
      };
    }

    // 2. Spectral Mid Stars (180..249)
    for (let i = 180; i < 250; i++) {
      stars[i] = {
        x: rng.rand(),
        y: rng.rand(),
        size: 1.45 + rng.rand() * 0.85,
        depth: 0.45 + rng.rand() * 0.35,
        layer: 1,
        baseAlpha: 0.45 + rng.rand() * 0.40,
        phase: rng.rand() * MathX.Tau,
        twinkleSpeed: 0.04 + rng.rand() * 0.05,
        colorType: Math.floor(rng.rand() * 4),
      };
    }

    // 3. Diamond Beacons & Pulsars (250..265)
    for (let i = 250; i < ArenaBackdrop.TotalStars; i++) {
      stars[i] = {
        x: rng.rand(),
        y: rng.rand(),
        size: 2.65 + rng.rand() * 1.15,
        depth: 0.85 + rng.rand() * 0.15,
        layer: 2,
        baseAlpha: 0.70 + rng.rand() * 0.30,
        phase: rng.rand() * MathX.Tau,
        twinkleSpeed: 0.06 + rng.rand() * 0.06,
        colorType: rng.rand() > 0.5 ? 1 : 2,
      };
    }

    this._stars = stars;
  }

  public getCanvas(w: number, h: number, floor: number = 1): HTMLCanvasElement {
    return this.bakeBackdrop(w, h, floor);
  }

  public getTexture(context: any, w: number, h: number, floor: number = 1): any {
    if (!context || !context.getOrCreateTexture) return null;
    const canvas = this.getCanvas(w, h, floor);
    if (!canvas) return null;
    const key = `backdrop_${Math.round(w)}_${Math.round(h)}_${floor}`;
    return context.getOrCreateTexture(key, canvas);
  }

  public bakeBackdrop(w: number, h: number, floor: number = 1): HTMLCanvasElement {
    const targetW = Math.max(1, Math.round(w));
    const targetH = Math.max(1, Math.round(h));
    const key = `${targetW}_${targetH}_${floor}`;

    const existing = this._cachedCanvases.get(key);
    if (existing) {
      return existing;
    }

    if (typeof document === 'undefined') {
      const mockCanvas = { width: targetW, height: targetH, getContext: () => null } as any;
      this._cachedCanvases.set(key, mockCanvas);
      return mockCanvas;
    }

    const canvas = document.createElement('canvas');
    canvas.width = targetW;
    canvas.height = targetH;
    this._cachedCanvases.set(key, canvas);
    return canvas;
  }



  /**
   * Suppressed legacy Canvas2D draw method.
   * Inert stub adhering to AGENTS.md Rule 12 & ORACLE.md Section 9.
   * All cosmic backdrop visuals render strictly through WebGLGameRenderer.drawBackdrop and GLBatch.
   */
  public draw(_ctx?: any, _w: number = 1280, _h: number = 720, _frenzyActive: boolean = false, _frameCount: number = 0, _floor: number = 1): void {
    // Suppressed: Rendered exclusively via WebGLGameRenderer.drawBackdrop
  }

  /**
   * Bakes smooth nebula dust gradient for texture caching or offline inspection.
   */
  public bakeNebulaDust(ctx: any, w: number, h: number, _floor: number = 1, palette?: { accent?: string }): void {
    if (!ctx || !ctx.createLinearGradient) return;
    const grad = ctx.createLinearGradient(0, 0, w, h);
    grad.addColorStop(0.0, 'rgba(0, 0, 0, 0)');
    grad.addColorStop(0.50, 'rgba(245, 158, 11, 0.35)');
    grad.addColorStop(1.0, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = grad;
    if (ctx.fillRect) ctx.fillRect(0, 0, w, h);
  }

  private _ouroborosAnim: OuroborosMenuAnimation = new OuroborosMenuAnimation();

  /**
   * Inert stub adhering to AGENTS.md Rule 12.
   * Rendered exclusively via WebGLGameRenderer.drawIdleBackdrop.
   */
  public drawIdleBackdrop(_ctx?: any, w: number = 1280, h: number = 720, frameCount: number = 0): void {
    this._ouroborosAnim.update(frameCount, w, h);
  }
}
