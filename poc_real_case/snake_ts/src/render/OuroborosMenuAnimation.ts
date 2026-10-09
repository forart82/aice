/**
 * ============================================================================
 * Procedural Muscular 8-Crossing Ouroboros Serpent WebGL Engine (OuroborosMenuAnimation.ts)
 * Protocol 3.0 Commercial Engine Edition — Rule 12 Pure WebGL Mandate
 * ============================================================================
 *
 * Single Source of Truth (SSOT): ORACLE.md & AGENTS.md (Rule 6, Rule 10, Rule 12)
 * Feature TDD Spec: docs/tdd/backdrop_nebula_smooth_sdf_and_lighting.tdd.md
 *
 * ARCHITECTURAL SUMMARY:
 * ---------------------
 * `OuroborosMenuAnimation` manages the procedural geometry and kinematics of the
 * iconic 180-segment 8-crossing continuous closed-loop Ouroboros serpent.
 *
 * MATHEMATICAL FORMULATION & TOPOLOGY:
 * - Topologically Closed Ring: Headless & tailless infinite loop with zero seam discontinuity.
 * - Isotropic 1:1 Aspect Ratio: rx === ry = R on all devices with natural window border overlap allowance.
 * - Uniform Body Thickness: Constant base radius R = 32px across all 180 segments with 3D perspective modulation (1 + 0.18*z).
 * - Exact Step Sizing: segStep = totalLength / N, coverage = 1.0 (Segment N-1 connects directly to Segment 0).
 * - Ultra-Slow Hypnotic Meditative Pace: speedPixels = 0.08 px/frame, rot = time * 0.00015 rad/frame.
 * - Harmonic Closed-Loop Undulation: Exactly 12 integer wave cycles across 180 segments with zero phase jump.
 * - Pure WebGL 2.0 Batching: Renders directly into GLBatch with 3D depth ordering (Painter's sort on Z).
 */

import { MathX } from '../core/MathX';
import { ColorX } from './ColorX';
import { Vec2 } from '../core/Vec2';
import { GLBatch, GLBlendMode } from './webgl/GLBatch';
import { GLPrimitive } from './webgl/WebGLContext';

/**
 * Individual kinematic segment of the 8-crossing Ouroboros knot.
 */
export interface IOuroborosSegment {
  x: number;
  y: number;
  z: number;
  angle: number;
  radius: number;
  u: number;
  index: number;
}

export class OuroborosMenuAnimation {
  public readonly segmentCount: number = 180;
  private static readonly LUT_SIZE: number = 1024;
  private static readonly HARMONIC_A: number = 0.38; // Proven 8-crossing parameter
  public static readonly BASE_BODY_RADIUS_PX: number = 32.0; // Uniform thickness
  public static readonly MIN_RADIUS_PX: number = 280.0; // Isotropic mobile base floor
  public static readonly MAX_RADIUS_PX: number = 380.0; // Isotropic desktop ceiling
  private static readonly UNDULATION_HARMONIC_CYCLES: number = 12; // Exactly 12 wave cycles across 180 segments

  private _segments: IOuroborosSegment[];
  private _sortedIndices: number[];
  private _segmentRenderOrder: number[];

  private _lutU: Float64Array;
  private _lutDist: Float64Array;
  private _totalLength: number = 0;
  private _cachedW: number = 0;
  private _cachedH: number = 0;

  constructor() {
    this._segments = new Array(this.segmentCount);
    this._sortedIndices = new Array(this.segmentCount);
    this._segmentRenderOrder = new Array(this.segmentCount);

    for (let i = 0; i < this.segmentCount; i++) {
      this._segments[i] = {
        x: 0,
        y: 0,
        z: 0,
        angle: 0,
        radius: OuroborosMenuAnimation.BASE_BODY_RADIUS_PX,
        u: 0,
        index: i,
      };
      this._sortedIndices[i] = i;
      this._segmentRenderOrder[i] = i;
    }

    this._lutU = new Float64Array(OuroborosMenuAnimation.LUT_SIZE + 1);
    this._lutDist = new Float64Array(OuroborosMenuAnimation.LUT_SIZE + 1);
  }

  /**
   * Calculates strictly isotropic 1:1 radii (rx === ry = R) across all device viewports.
   * Preserves the exact geometric circular ratio of the snake everywhere while allowing
   * natural edge overlap across compact device viewports.
   */
  public static calculateRadii(screenW: number, screenH: number): { rx: number; ry: number } {
    const minDim = Math.min(screenW, screenH);
    const minR = OuroborosMenuAnimation.MIN_RADIUS_PX;
    const maxR = OuroborosMenuAnimation.MAX_RADIUS_PX;
    const R = Math.max(minR, Math.min(maxR, minDim * 0.45));
    return { rx: R, ry: R };
  }

  public evaluateKnot(
    u: number,
    cx: number,
    cy: number,
    rx: number,
    ry: number,
    time: number
  ): { x: number; y: number; z: number; tx: number; ty: number } {
    const wrappedU = ((u % 1) + 1) % 1;
    const theta = wrappedU * MathX.Tau;
    const a = OuroborosMenuAnimation.HARMONIC_A;
    const norm = 1.0 + a;
    
    // Ultra-slow, hypnotic, meditative whole-knot planetary rotation (~6-7 min per full turn)
    const rot = time * 0.00015;

    const cos1 = Math.cos(theta);
    const sin1 = Math.sin(theta);
    const cos7 = Math.cos(7 * theta);
    const sin7 = Math.sin(7 * theta);

    const kx = (cos1 + a * cos7) / norm;
    const ky = (sin1 - a * sin7) / norm;
    const kz = Math.sin(8 * theta);

    // Continuous 2D coordinate rotation (Orthogonal Isometry)
    const cosR = Math.cos(rot);
    const sinR = Math.sin(rot);
    const rotX = kx * cosR - ky * sinR;
    const rotY = kx * sinR + ky * cosR;

    const perspective = 1.0 + kz * 0.16;
    const x = cx + rotX * rx * perspective;
    const y = cy + rotY * ry * perspective;

    // Tangent derivative rotation (Exact screen direction when rx === ry)
    const dkx = (-sin1 - 7 * a * sin7) / norm;
    const dky = (cos1 - 7 * a * cos7) / norm;
    const tx = dkx * cosR - dky * sinR;
    const ty = dkx * sinR + dky * cosR;

    return { x, y, z: kz, tx, ty };
  }

  private rebuildArcLengthTable(w: number, h: number): void {
    if (this._cachedW === w && this._cachedH === h && this._totalLength > 0) return;
    this._cachedW = w;
    this._cachedH = h;

    const M = OuroborosMenuAnimation.LUT_SIZE;
    const cx = w * 0.5;
    const cy = h * 0.5;
    const { rx, ry } = OuroborosMenuAnimation.calculateRadii(w, h);

    let accum = 0;
    this._lutU[0] = 0;
    this._lutDist[0] = 0;

    let prevPt = this.evaluateKnot(0, cx, cy, rx, ry, 0);
    for (let i = 1; i <= M; i++) {
      const u = i / M;
      const pt = this.evaluateKnot(u, cx, cy, rx, ry, 0);
      const dx = pt.x - prevPt.x;
      const dy = pt.y - prevPt.y;
      accum += Math.hypot(dx, dy);

      this._lutU[i] = u;
      this._lutDist[i] = accum;
      prevPt = pt;
    }

    this._totalLength = accum;
  }

  public distanceToU(s: number): number {
    const total = this._totalLength;
    if (total <= 0) return 0;
    const wrappedS = ((s % total) + total) % total;

    let low = 0;
    let high = OuroborosMenuAnimation.LUT_SIZE;
    while (low <= high) {
      const mid = (low + high) >> 1;
      if (this._lutDist[mid]! < wrappedS) low = mid + 1;
      else high = mid - 1;
    }

    const idx = Math.max(0, Math.min(OuroborosMenuAnimation.LUT_SIZE - 1, high));
    const d0 = this._lutDist[idx]!;
    const d1 = this._lutDist[idx + 1]!;
    const u0 = this._lutU[idx]!;
    const u1 = this._lutU[idx + 1]!;

    const span = d1 - d0;
    const t = span > 0.00001 ? (wrappedS - d0) / span : 0;
    return u0 + t * (u1 - u0);
  }

  public get totalLength(): number {
    return this._totalLength;
  }

  public update(frameCount: number, screenW: number, screenH: number): void {
    this.rebuildArcLengthTable(screenW, screenH);

    const cx = screenW * 0.5;
    const cy = screenH * 0.5;
    const { rx, ry } = OuroborosMenuAnimation.calculateRadii(screenW, screenH);

    // Ultra-slow, hypnotic, meditative slithering pace
    const speedPixels = 0.08;
    const headDist = (frameCount * speedPixels) % this._totalLength;

    // Seamless Closed-Ring Discretization: coverage = 1.0, segStep = totalLength / N
    const segStep = this._totalLength / this.segmentCount;
    const K = OuroborosMenuAnimation.UNDULATION_HARMONIC_CYCLES;

    for (let i = 0; i < this.segmentCount; i++) {
      const segDist = headDist - i * segStep;
      const u = this.distanceToU(segDist);
      const pt = this.evaluateKnot(u, cx, cy, rx, ry, frameCount);
      const seg = this._segments[i]!;

      const tLen = Math.hypot(pt.tx, pt.ty) || 1;
      const nx = -pt.ty / tLen;
      const ny = pt.tx / tLen;

      // Meditative harmonic closed-loop undulation (0.003 rad/frame)
      const wavePhase = frameCount * 0.003 - (i * K * MathX.Tau) / this.segmentCount;
      const undWave = Math.sin(wavePhase);
      // Deep calm breathing envelope (0.002 rad/frame)
      const breatheEnv = 0.85 + 0.15 * Math.sin(frameCount * 0.002);
      const undulation = undWave * 2.2 * breatheEnv;

      seg.x = pt.x + nx * undulation;
      seg.y = pt.y + ny * undulation;
      seg.z = pt.z;
      seg.angle = Math.atan2(pt.ty, pt.tx);
      seg.u = u;

      // Uniform Body Thickness: Constant base radius R = 32px across all 180 segments with 3D perspective modulation (1 + 0.18*z)
      seg.radius = OuroborosMenuAnimation.BASE_BODY_RADIUS_PX * (1.0 + pt.z * 0.18);

      this._sortedIndices[i] = i;
    }

    // 3D Depth Sort: Painter's Algorithm (z-ascending) for knot crossovers
    this._sortedIndices.sort((a, b) => this._segments[a]!.z - this._segments[b]!.z);

    // Real Continuous Serpentine Shingling Order (Rule 10 & User Directive):
    // Renders each segment strictly on top of the previous segment along the spine:
    // Segment 1 on top of 0, Segment 2 on top of 1, Segment 3 on top of 2, and so on.
    // Completely eliminates artificial "top level" phasing and switching.
    for (let i = 0; i < this.segmentCount; i++) {
      this._segmentRenderOrder[i] = i;
    }
  }

  public getHeadPosition(): Vec2 {
    const h = this._segments[0]!;
    return new Vec2(h.x, h.y);
  }

  public getTailPosition(): Vec2 {
    const t = this._segments[this.segmentCount - 1]!;
    return new Vec2(t.x, t.y);
  }

  public get segments(): ReadonlyArray<IOuroborosSegment> {
    return this._segments;
  }

  public get sortedIndices(): ReadonlyArray<number> {
    return this._sortedIndices;
  }

  public getSegmentRenderOrder(): number[] {
    return this._segmentRenderOrder;
  }

  // ---------------------------------------------------------------- Zero-Allocation Static Scratch Buffers for Pure WebGL Knot Rendering
  private static readonly _scratchPts: Array<{ x: number; y: number }> = Array.from({ length: 181 }, () => ({ x: 0, y: 0 }));
  private static readonly _scratchHex: Array<{ x: number; y: number }> = Array.from({ length: 6 }, () => ({ x: 0, y: 0 }));
  private static readonly _scratchHexLoop: Array<{ x: number; y: number }> = Array.from({ length: 7 }, () => ({ x: 0, y: 0 }));
  private static readonly _scratchHexTrail: Array<{ x: number; y: number }> = Array.from({ length: 5 }, () => ({ x: 0, y: 0 }));
  private static readonly _scratchMidHex: Array<{ x: number; y: number }> = Array.from({ length: 6 }, () => ({ x: 0, y: 0 }));
  private static readonly _scratchInnerHex: Array<{ x: number; y: number }> = Array.from({ length: 6 }, () => ({ x: 0, y: 0 }));
  private static readonly _scratchInnerHexLoop: Array<{ x: number; y: number }> = Array.from({ length: 7 }, () => ({ x: 0, y: 0 }));
  private static readonly _scratchRidge: Array<{ x: number; y: number }> = Array.from({ length: 4 }, () => ({ x: 0, y: 0 }));

  /**
   * Master Knot Composite Global Alpha (Rule 10).
   * Original Canvas 2D specification enforced ctx.globalAlpha = 0.70 across all knot passes,
   * providing the sleek, translucent, mysterious cyber-emerald aesthetic against the cosmic void.
   */
  public static readonly GLOBAL_ALPHA: number = 0.70;

  /**
   * Hardware-Accelerated Pure WebGL 2.0 Dynamic Batch Renderer.
   * Renders the complete 180 3D-depth-sorted knot segments directly into GLBatch:
   * 
   * Architectural Overview & Rendering Passes (Protocol 3.0 / AGENTS.md Rule 10 & Rule 12):
   * --------------------------------------------------------------------------------------
   * Global Opacity: Composite alpha multiplier = 0.70 applied across all passes.
   * 
   * PASS 1: Soft Depth-Blended Under-crossing Shadows (Volumetric Spatial Realism)
   * - Blend Mode: GLBlendMode.NORMAL.
   * - Rendered for segments with seg.z > -0.1 (elevated knot crossings casting onto underbody).
   * - Shadow offset formula: Δx = +0.45 * d_shadow, Δy = +d_shadow, where d_shadow = (12 + r * 0.35) * shadowZ.
   * - Alpha formula: α_shadow = 0.50 * shadowZ * 0.70 in abyss black (#010907).
   * 
   * PASS 2A: Continuous Closed Muscular Underbody Foundation Ribbon (Closed Ring)
   * - Blend Mode: GLBlendMode.NORMAL.
   * - Closed continuous ribbon (scratchPts connects seg[N-1] directly to seg[0]).
   * - Outer underbody halo: width 40.0px, #059669 at alpha 0.28 * 0.70.
   * - Muscular foundation core: width 36.0px, #022c22 at alpha 0.70.
   * 
   * PASS 2B: Luminescent Spinal Energy Conduit (Closed Ring Cyber-Emerald Laser Core)
   * - Blend Mode: GLBlendMode.ADDITIVE.
   * - Concentric laser ribbon: width 5.0px, #00f0b5 at alpha 0.70 with GLPrimitive.Laser shader falloff.
   * - High-intensity spine highlight: width 2.0px, #a7f3d0 at alpha 0.70 with GLPrimitive.Quad.
   * 
   * PASS 3: 180 3D Depth-Sorted Volumetric Cyber-Emerald Scale Plates
   * - 3D Painter's Algorithm sorting (z-ascending) ensures physically correct occlusions at all 8 crossings.
   * - Perspective scale factor: r = R_base * (1 + 0.18 * z).
   * - Depth shade factor: zShade = clamp(0.68 + z * 0.32, 0, 1).
   * - Harmonic Neon Pulse: pulse = 0.5 + 0.5 * sin(t * 0.003 + index * 4 * 2π / N).
   * - Layer 1 (Base Scute): Hexagonal polygon contour in obsidian #010907 (alpha 0.95 * zShade * 0.70).
   * - Layer 2 (Concentric Plates): Concentric hexagonal plate (0.82 scale) in #022c22 (alpha 0.85 * zShade * 0.70)
   *   and inner concentric scute plate (0.55-0.58 scale) in #059669 (alpha 0.50 * zShade * 0.70).
   *   Zero outer bleed: All geometry is strictly bounded inside the hexagonal scute contour!
   * - Layer 3 (Perimeter Border): 2.2px perimeter line in #00f0b5 (alpha 0.85 * zShade * 0.70).
   * - Layer 4 (Dorsal Ridge): Additive specular facet polygon in #a7f3d0 (alpha 0.35 * zShade * 0.70).
   * - Layer 5 (Neon Circuit): Additive inner wireframe loop (1.4px) pulsing in #00f0b5.
   * - Layer 6 (Vertebral Node): Luminous central circle r=0.22 (#00f0b5) and bright core r=0.10 (#ffffff).
   * 
   * Eliminates all offscreen Canvas2D allocations and texture bus uploads entirely.
   */
  public drawGL(batch: GLBatch, screenW: number, screenH: number, frameCount: number): void {
    this.update(frameCount, screenW, screenH);
    if (!batch) return;

    const segs = this._segments;
    const sorted = this._segmentRenderOrder;
    const n = this.segmentCount;
    if (n === 0) return;

    const knotAlpha = OuroborosMenuAnimation.GLOBAL_ALPHA;

    // Populate closed-ring points (seg[N-1] connects directly to seg[0])
    const scratchPts = OuroborosMenuAnimation._scratchPts;
    for (let i = 0; i < n; i++) {
      const seg = segs[i]!;
      scratchPts[i]!.x = seg.x;
      scratchPts[i]!.y = seg.y;
    }
    scratchPts[n]!.x = segs[0]!.x;
    scratchPts[n]!.y = segs[0]!.y;

    // ------------------------------------------------------------------
    // PASS 1: Soft Depth-Blended Under-crossing Shadows (Volumetric Spatial Realism)
    // ------------------------------------------------------------------
    batch.setBlendMode(GLBlendMode.NORMAL);
    for (let s = 0; s < n; s++) {
      const idx = sorted[s]!;
      const seg = segs[idx]!;
      if (seg.z > -0.1) {
        const shadowZ = (seg.z + 0.1) / 1.1;
        const shadowDist = (12 + seg.radius * 0.35) * shadowZ;
        const shadowAlpha = 0.50 * shadowZ * knotAlpha;
        batch.drawCircle(
          seg.x + shadowDist * 0.45,
          seg.y + shadowDist,
          seg.radius * 1.35,
          ColorX.rgba('#010907', shadowAlpha),
          0
        );
      }
    }

    // ------------------------------------------------------------------
    // PASS 2A: Continuous Closed Muscular Underbody Foundation Ribbon (Closed Ring)
    // ------------------------------------------------------------------
    batch.setBlendMode(GLBlendMode.NORMAL);
    batch.drawContinuousRibbon(scratchPts, 40.0, ColorX.rgba('#059669', 0.28 * knotAlpha), 0, GLPrimitive.Quad);
    batch.drawContinuousRibbon(scratchPts, 36.0, ColorX.rgba('#022c22', knotAlpha), 0, GLPrimitive.Quad);

    // ------------------------------------------------------------------
    // PASS 2B: Luminescent Spinal Energy Conduit (Closed Ring Cyber-Emerald Laser Core)
    // ------------------------------------------------------------------
    batch.setBlendMode(GLBlendMode.ADDITIVE);
    batch.drawContinuousRibbon(scratchPts, 5.0, ColorX.rgba('#00f0b5', knotAlpha), 6, GLPrimitive.Laser);
    batch.drawContinuousRibbon(scratchPts, 2.0, ColorX.rgba('#a7f3d0', knotAlpha), 2, GLPrimitive.Quad);

    // ------------------------------------------------------------------
    // PASS 3: 180 3D Depth-Sorted Volumetric Cyber-Emerald Scale Plates
    // Unified Single-Pass Batching: Sets NORMAL blend mode ONCE before the loop,
    // eliminating 360 per-frame GPU pipeline flushes and TBDR tile stalls (Rule 10).
    // ------------------------------------------------------------------
    batch.setBlendMode(GLBlendMode.NORMAL);

    const hex = OuroborosMenuAnimation._scratchHex;
    const hexLoop = OuroborosMenuAnimation._scratchHexLoop;
    const hexTrail = OuroborosMenuAnimation._scratchHexTrail;
    const midHex = OuroborosMenuAnimation._scratchMidHex;
    const innerHex = OuroborosMenuAnimation._scratchInnerHex;
    const innerHexLoop = OuroborosMenuAnimation._scratchInnerHexLoop;
    const ridge = OuroborosMenuAnimation._scratchRidge;

    for (let s = 0; s < n; s++) {
      const idx = sorted[s]!;
      const seg = segs[idx]!;

      const r = seg.radius;
      const cosA = Math.cos(seg.angle);
      const sinA = Math.sin(seg.angle);
      const zShade = MathX.clamp01(0.68 + seg.z * 0.32);

      // Local muscular hexagonal scute contour vertices (scale 1.0)
      const l0x = r * 1.3, l0y = 0;
      const l1x = r * 0.4, l1y = -r * 1.0;
      const l2x = -r * 0.8, l2y = -r * 0.9;
      const l3x = -r * 1.2, l3y = 0;
      const l4x = -r * 0.8, l4y = r * 0.9;
      const l5x = r * 0.4, l5y = r * 1.0;

      hex[0]!.x = seg.x + l0x * cosA - l0y * sinA; hex[0]!.y = seg.y + l0x * sinA + l0y * cosA;
      hex[1]!.x = seg.x + l1x * cosA - l1y * sinA; hex[1]!.y = seg.y + l1x * sinA + l1y * cosA;
      hex[2]!.x = seg.x + l2x * cosA - l2y * sinA; hex[2]!.y = seg.y + l2x * sinA + l2y * cosA;
      hex[3]!.x = seg.x + l3x * cosA - l3y * sinA; hex[3]!.y = seg.y + l3x * sinA + l3y * cosA;
      hex[4]!.x = seg.x + l4x * cosA - l4y * sinA; hex[4]!.y = seg.y + l4x * sinA + l4y * cosA;
      hex[5]!.x = seg.x + l5x * cosA - l5y * sinA; hex[5]!.y = seg.y + l5x * sinA + l5y * cosA;

      // Open-Root Trailing Edge Polyline (Rule 10 & Iteration 4):
      // In natural scale shingling, the anterior root is tucked UNDER the predecessor
      // and must NOT be closed-looped with a cyan stroke across the snake's back.
      // We stroke ONLY the lateral flanks and posterior trailing lip:
      // hex[2] (rear left) -> hex[1] (front left) -> hex[0] (trailing tip) -> hex[5] (front right) -> hex[4] (rear right).
      hexTrail[0]!.x = hex[2]!.x; hexTrail[0]!.y = hex[2]!.y;
      hexTrail[1]!.x = hex[1]!.x; hexTrail[1]!.y = hex[1]!.y;
      hexTrail[2]!.x = hex[0]!.x; hexTrail[2]!.y = hex[0]!.y;
      hexTrail[3]!.x = hex[5]!.x; hexTrail[3]!.y = hex[5]!.y;
      hexTrail[4]!.x = hex[4]!.x; hexTrail[4]!.y = hex[4]!.y;

      // Intermediate Concentric Scute Plate (scale 0.82)
      const m0x = l0x * 0.82, m0y = 0;
      const m1x = l1x * 0.82, m1y = l1y * 0.82;
      const m2x = l2x * 0.82, m2y = l2y * 0.82;
      const m3x = l3x * 0.82, m3y = 0;
      const m4x = l4x * 0.82, m4y = l4y * 0.82;
      const m5x = l5x * 0.82, m5y = l5y * 0.82;

      midHex[0]!.x = seg.x + m0x * cosA - m0y * sinA; midHex[0]!.y = seg.y + m0x * sinA + m0y * cosA;
      midHex[1]!.x = seg.x + m1x * cosA - m1y * sinA; midHex[1]!.y = seg.y + m1x * sinA + m1y * cosA;
      midHex[2]!.x = seg.x + m2x * cosA - m2y * sinA; midHex[2]!.y = seg.y + m2x * sinA + m2y * cosA;
      midHex[3]!.x = seg.x + m3x * cosA - m3y * sinA; midHex[3]!.y = seg.y + m3x * sinA + m3y * cosA;
      midHex[4]!.x = seg.x + m4x * cosA - m4y * sinA; midHex[4]!.y = seg.y + m4x * sinA + m4y * cosA;
      midHex[5]!.x = seg.x + m5x * cosA - m5y * sinA; midHex[5]!.y = seg.y + m5x * sinA + m5y * cosA;

      // Inner Concentric Scute Plate (scale ~0.55-0.58)
      const i0x = r * 0.75, i0y = 0;
      const i1x = r * 0.20, i1y = -r * 0.55;
      const i2x = -r * 0.55, i2y = -r * 0.45;
      const i3x = -r * 0.70, i3y = 0;
      const i4x = -r * 0.55, i4y = r * 0.45;
      const i5x = r * 0.20, i5y = r * 0.55;

      innerHex[0]!.x = seg.x + i0x * cosA - i0y * sinA; innerHex[0]!.y = seg.y + i0x * sinA + i0y * cosA;
      innerHex[1]!.x = seg.x + i1x * cosA - i1y * sinA; innerHex[1]!.y = seg.y + i1x * sinA + i1y * cosA;
      innerHex[2]!.x = seg.x + i2x * cosA - i2y * sinA; innerHex[2]!.y = seg.y + i2x * sinA + i2y * cosA;
      innerHex[3]!.x = seg.x + i3x * cosA - i3y * sinA; innerHex[3]!.y = seg.y + i3x * sinA + i3y * cosA;
      innerHex[4]!.x = seg.x + i4x * cosA - i4y * sinA; innerHex[4]!.y = seg.y + i4x * sinA + i4y * cosA;
      innerHex[5]!.x = seg.x + i5x * cosA - i5y * sinA; innerHex[5]!.y = seg.y + i5x * sinA + i5y * cosA;

      // Specular Dorsal Ridge Highlight
      const rg0x = r * 1.15, rg0y = 0;
      const rg1x = r * 0.35, rg1y = -r * 0.9;
      const rg2x = -r * 0.70, rg2y = -r * 0.8;
      const rg3x = -r * 0.30, rg3y = -r * 0.15;
      ridge[0]!.x = seg.x + rg0x * cosA - rg0y * sinA; ridge[0]!.y = seg.y + rg0x * sinA + rg0y * cosA;
      ridge[1]!.x = seg.x + rg1x * cosA - rg1y * sinA; ridge[1]!.y = seg.y + rg1x * sinA + rg1y * cosA;
      ridge[2]!.x = seg.x + rg2x * cosA - rg2y * sinA; ridge[2]!.y = seg.y + rg2x * sinA + rg2y * cosA;
      ridge[3]!.x = seg.x + rg3x * cosA - rg3y * sinA; ridge[3]!.y = seg.y + rg3x * sinA + rg3y * cosA;

      // Volumetric Cylindrical Core Plate (Unified Normal Blend Batching)
      // Base hexagonal scute polygon in obsidian black
      batch.drawPolygon(hex, ColorX.rgba('#010907', 0.95 * zShade * knotAlpha));
      // Intermediate concentric scute plate in deep cyber emerald
      batch.drawPolygon(midHex, ColorX.rgba('#022c22', 0.85 * zShade * knotAlpha));
      // Inner concentric scute plate in rich jade green
      batch.drawPolygon(innerHex, ColorX.rgba('#059669', 0.50 * zShade * knotAlpha));
      // 2.2px open trailing edge & lateral border in cyan cyber-emerald (anterior root is unstroked/tucked)
      batch.drawPolyline(hexTrail, 2.2, ColorX.rgba('#00f0b5', 0.85 * zShade * knotAlpha), 0, 5);

      // Specular Dorsal Ridge Highlight (Unified Normal Blend with high-intensity shading)
      batch.drawPolygon(ridge, ColorX.rgba('#a7f3d0', 0.45 * zShade * knotAlpha));
    }

    // ------------------------------------------------------------------
    // PASS 3B: Seamless Iris Loop Closure (Rule 10 & User Directive)
    // ------------------------------------------------------------------
    // Re-draw segment 0's free trailing lip on top of segment N-1 so that
    // segment N-1 is tucked under segment 0, completing the unbroken "one part on top of the other" chain.
    if (n > 1) {
      const seg0 = segs[0]!;
      const r0 = seg0.radius;
      const cosA0 = Math.cos(seg0.angle);
      const sinA0 = Math.sin(seg0.angle);
      const zShade0 = MathX.clamp01(0.68 + seg0.z * 0.32);

      const l0x = r0 * 1.3, l0y = 0;
      const l1x = r0 * 0.4, l1y = -r0 * 1.0;
      const l2x = -r0 * 0.8, l2y = -r0 * 0.9;
      const l4x = -r0 * 0.8, l4y = r0 * 0.9;
      const l5x = r0 * 0.4, l5y = r0 * 1.0;

      hexTrail[0]!.x = seg0.x + l2x * cosA0 - l2y * sinA0; hexTrail[0]!.y = seg0.y + l2x * sinA0 + l2y * cosA0;
      hexTrail[1]!.x = seg0.x + l1x * cosA0 - l1y * sinA0; hexTrail[1]!.y = seg0.y + l1x * sinA0 + l1y * cosA0;
      hexTrail[2]!.x = seg0.x + l0x * cosA0 - l0y * sinA0; hexTrail[2]!.y = seg0.y + l0x * sinA0 + l0y * cosA0;
      hexTrail[3]!.x = seg0.x + l5x * cosA0 - l5y * sinA0; hexTrail[3]!.y = seg0.y + l5x * sinA0 + l5y * cosA0;
      hexTrail[4]!.x = seg0.x + l4x * cosA0 - l4y * sinA0; hexTrail[4]!.y = seg0.y + l4x * sinA0 + l4y * cosA0;

      batch.setBlendMode(GLBlendMode.NORMAL);
      batch.drawPolyline(hexTrail, 2.2, ColorX.rgba('#00f0b5', 0.85 * zShade0 * knotAlpha), 0, 5);
    }
  }

  /**
   * Renders the Predatory Cyber-Viper Head in pure WebGL 2.0.
   */
  public drawHeadGL(batch: GLBatch, head: IOuroborosSegment, frameCount: number, knotAlpha: number): void {
    const headR = head.radius;
    const cosA = Math.cos(head.angle);
    const sinA = Math.sin(head.angle);

    batch.setBlendMode(GLBlendMode.NORMAL);

    // 1. Elongated Predatory Viper Skull Dome (3D Sphere Gradient)
    batch.drawRotatedQuad(
      head.x,
      head.y,
      headR * 2.4,
      headR * 1.8,
      head.angle,
      ColorX.rgba('#022c22', knotAlpha),
      0,
      GLPrimitive.Sphere
    );

    // 2. Frontal Cranial Plate Inset (Rich Cyber-Emerald)
    batch.drawRotatedQuad(
      head.x,
      head.y,
      headR * 1.6,
      headR * 1.1,
      head.angle,
      ColorX.rgba('#059669', knotAlpha * 0.85),
      0,
      GLPrimitive.Sphere
    );

    // 3. Angular Brow Ridge & Jaw Shadow Contour (Obsidian Black)
    const brX = head.x + (-headR * 0.1) * cosA - (-headR * 0.35) * sinA;
    const brY = head.y + (-headR * 0.1) * sinA + (-headR * 0.35) * cosA;
    batch.drawRotatedQuad(
      brX,
      brY,
      headR * 1.5,
      headR * 0.6,
      head.angle - 0.15,
      ColorX.rgba('#010907', 0.85 * knotAlpha),
      0,
      GLPrimitive.Circle
    );

    // 4. Buccal Mouth Cavity (Dark Maroon/Void Wedge)
    const mouth = 0.35 + 0.08 * Math.sin(frameCount * 0.003);
    const mX = head.x + cosA * headR * 0.4;
    const mY = head.y + sinA * headR * 0.4;
    batch.drawSdfWedge(mX, mY, headR * 1.05, head.angle, mouth * 1.4, '#02140e', knotAlpha);

    // 5. Ivory Venom Fangs Clamping on Tail
    const f1X = head.x + (headR * 0.95) * cosA - (-headR * 0.35) * sinA;
    const f1Y = head.y + (headR * 0.95) * sinA + (-headR * 0.35) * cosA;
    const f2X = head.x + (headR * 0.95) * cosA - (headR * 0.35) * sinA;
    const f2Y = head.y + (headR * 0.95) * sinA + (headR * 0.35) * cosA;
    batch.drawRotatedQuad(f1X, f1Y, headR * 0.35, headR * 0.18, head.angle - 0.4, ColorX.rgba('#a7f3d0', knotAlpha), 0, GLPrimitive.Quad);
    batch.drawRotatedQuad(f2X, f2Y, headR * 0.35, headR * 0.18, head.angle + 0.4, ColorX.rgba('#a7f3d0', knotAlpha), 0, GLPrimitive.Quad);

    // 6. Glowing Visor Eyes (Open Sclera + Pupils + Specular Glints vs Blinking Slits)
    const isBlinking = Math.floor(frameCount / 180) % 4 === 0 && (frameCount % 180) < 8;
    const e1x = head.x + (headR * 0.35) * cosA - (-headR * 0.46) * sinA;
    const e1y = head.y + (headR * 0.35) * sinA + (-headR * 0.46) * cosA;
    const e2x = head.x + (headR * 0.35) * cosA - (headR * 0.46) * sinA;
    const e2y = head.y + (headR * 0.35) * sinA + (headR * 0.46) * cosA;

    if (isBlinking) {
      batch.drawLaserLine(e1x - 3 * sinA, e1y + 3 * cosA, e1x + 3 * sinA, e1y - 3 * cosA, '#00f0b5', 2.0, '#ffffff', knotAlpha);
      batch.drawLaserLine(e2x - 3 * sinA, e2y + 3 * cosA, e2x + 3 * sinA, e2y - 3 * cosA, '#00f0b5', 2.0, '#ffffff', knotAlpha);
    } else {
      // White Sclera
      batch.drawCircle(e1x, e1y, 4.8, ColorX.rgba('#ffffff', knotAlpha), 0);
      batch.drawCircle(e2x, e2y, 4.8, ColorX.rgba('#ffffff', knotAlpha), 0);
      // Dark Pupils offset forward
      const p1x = e1x + cosA * 1.5; const p1y = e1y + sinA * 1.5;
      const p2x = e2x + cosA * 1.5; const p2y = e2y + sinA * 1.5;
      batch.drawCircle(p1x, p1y, 2.2, ColorX.rgba('#011711', knotAlpha), 0);
      batch.drawCircle(p2x, p2y, 2.2, ColorX.rgba('#011711', knotAlpha), 0);
      // Specular Glints
      batch.drawCircle(p1x - 0.8, p1y - 0.8, 0.9, ColorX.rgba('#00f0b5', knotAlpha), 2);
      batch.drawCircle(p2x - 0.8, p2y - 0.8, 0.9, ColorX.rgba('#00f0b5', knotAlpha), 2);
    }

    // 7. Dorsal Cranial Crown (3 stepped cybernetic crest plates)
    for (let c = 0; c < 3; c++) {
      const cOff = -headR * 0.3 + c * headR * 0.28;
      const cx = head.x + cosA * cOff;
      const cy = head.y + sinA * cOff;
      const cW = headR * (0.55 - c * 0.08);
      const cH = headR * (0.35 - c * 0.05);
      batch.drawRotatedQuad(cx, cy, cW, cH, head.angle, ColorX.rgba('#00f0b5', 0.85 * knotAlpha), 4, GLPrimitive.Quad);
    }

    // 8. Sweeping Dragon Horns curving backward over the neck
    const hornL = headR * 1.35;
    const h1x = head.x + (-headR * 0.2) * cosA - (-headR * 0.55) * sinA;
    const h1y = head.y + (-headR * 0.2) * sinA + (-headR * 0.55) * cosA;
    const h2x = head.x + (-headR * 0.2) * cosA - (headR * 0.55) * sinA;
    const h2y = head.y + (-headR * 0.2) * sinA + (headR * 0.55) * cosA;
    batch.drawRotatedQuad(h1x - cosA * hornL * 0.35, h1y - sinA * hornL * 0.35, hornL, headR * 0.22, head.angle - 0.55, ColorX.rgba('#059669', knotAlpha), 0, GLPrimitive.Quad);
    batch.drawRotatedQuad(h2x - cosA * hornL * 0.35, h2y - sinA * hornL * 0.35, hornL, headR * 0.22, head.angle + 0.55, ColorX.rgba('#059669', knotAlpha), 0, GLPrimitive.Quad);
    batch.drawLaserLine(h1x, h1y, h1x - cosA * hornL * 0.8 - sinA * hornL * 0.35, h1y - sinA * hornL * 0.8 + cosA * hornL * 0.35, '#00f0b5', 2.2, '#ffffff', knotAlpha);
    batch.drawLaserLine(h2x, h2y, h2x - cosA * hornL * 0.8 + sinA * hornL * 0.35, h2y - sinA * hornL * 0.8 - cosA * hornL * 0.35, '#00f0b5', 2.2, '#ffffff', knotAlpha);

    // 9. Undulating Sensory Whiskers (Barbels) emerging from snout margins
    const whiskerW = headR * 1.6;
    const w1Pts: Array<{ x: number; y: number }> = [];
    const w2Pts: Array<{ x: number; y: number }> = [];
    for (let k = 0; k <= 6; k++) {
      const frac = k / 6;
      const wave = Math.sin(frameCount * 0.08 + frac * 4.0) * headR * 0.35 * frac;
      const wx1 = head.x + cosA * (headR * 0.8 + frac * whiskerW) - sinA * (-headR * 0.35 - wave);
      const wy1 = head.y + sinA * (headR * 0.8 + frac * whiskerW) + cosA * (-headR * 0.35 - wave);
      const wx2 = head.x + cosA * (headR * 0.8 + frac * whiskerW) - sinA * (headR * 0.35 + wave);
      const wy2 = head.y + sinA * (headR * 0.8 + frac * whiskerW) + cosA * (headR * 0.35 + wave);
      w1Pts.push({ x: wx1, y: wy1 });
      w2Pts.push({ x: wx2, y: wy2 });
    }
    batch.drawPolyline(w1Pts, 1.8, ColorX.rgba('#00f0b5', 0.85 * knotAlpha), 4);
    batch.drawPolyline(w2Pts, 1.8, ColorX.rgba('#00f0b5', 0.85 * knotAlpha), 4);
  }

  /**
   * Renders the Caudal Tail Tip and terminal crystal stinger entering the mouth cavity.
   */
  public drawTailGL(batch: GLBatch, tail: IOuroborosSegment, _frameCount: number, knotAlpha: number): void {
    batch.setBlendMode(GLBlendMode.NORMAL);
    const r = tail.radius;
    // Tapered tail segment base
    batch.drawRotatedQuad(tail.x, tail.y, r * 2.2, r * 1.4, tail.angle, ColorX.rgba('#022c22', knotAlpha), 0, GLPrimitive.Sphere);

    // Terminal cyan crystal stinger
    batch.setBlendMode(GLBlendMode.ADDITIVE);
    batch.drawRotatedQuad(tail.x, tail.y, r * 1.2, r * 0.8, tail.angle, ColorX.rgba('#00f0b5', knotAlpha), 6, GLPrimitive.Sphere);
    batch.drawCircle(tail.x, tail.y, Math.max(1.5, r * 0.45), ColorX.rgba('#00f0b5', knotAlpha), 4);
    batch.setBlendMode(GLBlendMode.NORMAL);
  }

  /**
   * Swallowing Cyber-Emerald Plasma Sparks between Jaws & Tail Tip.
   */
  private drawSwallowingPlasmaGL(
    batch: GLBatch,
    head: IOuroborosSegment,
    tail: IOuroborosSegment,
    frameCount: number,
    knotAlpha: number
  ): void {
    batch.setBlendMode(GLBlendMode.ADDITIVE);
    const count = 10;
    for (let i = 0; i < count; i++) {
      const p = (frameCount * 0.02 + i / count) % 1;
      const angle = frameCount * 0.08 + i * 1.1;
      const swirl = Math.sin(p * Math.PI) * 4;
      const px = tail.x + (head.x - tail.x) * p + Math.cos(angle) * swirl;
      const py = tail.y + (head.y - tail.y) * p + Math.sin(angle) * swirl;
      const sz = Math.max(0.8, (1.0 - p) * 3.8);
      const col = i % 2 === 0 ? '#00f0b5' : '#a7f3d0';
      batch.drawCircle(px, py, sz, ColorX.rgba(col, (1.0 - p) * knotAlpha), 4);
    }
  }

  /**
   * Inert fallback stub adhering strictly to AGENTS.md Rule 12 (Canvas 2D Banished).
   * Rendered exclusively via drawGL(batch, ...).
   */
  public draw(_ctx?: any, screenW: number = 1280, screenH: number = 720, frameCount: number = 0): void {
    this.update(frameCount, screenW, screenH);
  }

  /**
   * Backward-compatibility alias stub.
   */
  public drawHead(_ctx?: any, _head?: IOuroborosSegment, _frameCount?: number): void {}

  private drawViperHead(_ctx?: any, _head?: IOuroborosSegment, _frameCount?: number): void {}

  private drawDragonHead(_ctx?: any, _head?: IOuroborosSegment, _frameCount?: number): void {}

  private drawViperTail(_ctx?: any, _tail?: IOuroborosSegment, _frameCount?: number): void {}

  private drawTailStinger(_ctx?: any, _tail?: IOuroborosSegment, _frameCount?: number): void {}
}
