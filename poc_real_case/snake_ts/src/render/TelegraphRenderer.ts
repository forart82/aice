/**
 * ============================================================================
 * Pure WebGL 2.0 Combat Danger Telegraph Renderer (TelegraphRenderer.ts)
 * Protocol 3.0 Commercial Engine Edition — Rule 12 Pure WebGL Mandate
 * ============================================================================
 *
 * Single Source of Truth (SSOT): ORACLE.md & AGENTS.md (Rule 6, Rule 10, Rule 12)
 * Feature TDD Spec: docs/tdd/architecture_render_refactoring.tdd.md
 *
 * ARCHITECTURAL SUMMARY:
 * ---------------------
 * `TelegraphRenderer` manages hardware-accelerated combat danger telegraphs,
 * hazard pools, and boss warning zones via pure WebGL 2.0 batches (`GLBatch`).
 *
 * GEOMETRIC EXTRUSION & MATHEMATICAL DERIVATIONS (Rule 10):
 * --------------------------------------------------------
 * 1. Directional Linear Corridor Extrusion:
 *    Given start position P_0 = (x, y), length L, angle theta, and progress p in [0, 1]:
 *    - Unit tangent direction: u = (cos theta, sin theta)
 *    - End position: P_1 = P_0 + u * L
 *    - Perpendicular unit normal vector: n = (-sin theta, cos theta)
 *    - Dynamic corridor width: W(p) = max(16, width) * (0.65 + 0.35 * p)
 *    - Half-width offset: hw = W(p) * 0.5
 *    - Extruded Quad Boundary Corners:
 *        ls = P_0 + n * hw   (Left-Start)
 *        rs = P_0 - n * hw   (Right-Start)
 *        le = P_1 + n * hw   (Left-End)
 *        re = P_1 - n * hw   (Right-End)
 *    - Rendered via `drawQuadVertices(ls, le, re, rs)` with guide lasers along (ls -> le) and (rs -> re).
 *
 * 2. Angular Cone Breath Attack Geometry:
 *    Given apex P = (x, y), range R, aim angle theta, and angular spread phi:
 *    - Start ray angle: theta_1 = theta - phi / 2, ray endpoint R_1 = P + R * (cos theta_1, sin theta_1)
 *    - End ray angle:   theta_2 = theta + phi / 2, ray endpoint R_2 = P + R * (cos theta_2, sin theta_2)
 *    - Perimeter boundary arc: 12-segment polyline at radius R for k in [0..12]:
 *        P_k = P + R * (cos(theta_1 + k * phi / 12), sin(theta_1 + k * phi / 12))
 *    - Expanding inner wedge fill: radius r_inner = R * p rendered via `drawSdfWedge`.
 *    - Apex glint: expanding core circle at P with radius 5 + 5 * p.
 *
 * 3. Circular Danger Blast Zone Math:
 *    Given center P = (x, y), outer radius R, and progress p in [0, 1]:
 *    - Outer warning perimeter ring: fixed radius R, thickness 2.5px.
 *    - Expanding blast zone: filled circle of dynamic radius r(t) = R * p.
 *    - Radial countdown tick arc: 32 segments spanning theta in [-pi/2, -pi/2 + 2*pi*p].
 *    - Imminent detonation flashing core: for p > 0.8, white flash with intensity (p - 0.8) * 5.
 */

import { GLBatch, GLBlendMode } from './webgl/GLBatch';
import { ColorX } from './ColorX';
import { MathX } from '../core/MathX';
import { GLPrimitive } from './webgl/WebGLContext';

export interface ITelegraphAttack {
  type: 'circle' | 'cone' | 'line' | 'hazard' | 'ring' | string;
  x?: number;
  y?: number;
  radius?: number;
  length?: number;
  spread?: number;
  angle?: number;
  progress: number;
  color?: string;
  width?: number;
  maxRadius?: number;
  innerRadius?: number;
  x1?: number;
  y1?: number;
  x2?: number;
  y2?: number;
  // Alternative capitalization support
  Type?: string;
  X?: number;
  Y?: number;
  Radius?: number;
  Length?: number;
  Spread?: number;
  Angle?: number;
  Progress?: number;
  Color?: string;
  Width?: number;
}

export interface IHazardRenderData {
  x: number;
  y: number;
  type?: string;
  radius?: number;
  telegraph?: number;
  telegraphMax?: number;
  pulse?: number;
  life?: number;
  maxLife?: number;
  color?: string;
}

export class TelegraphRenderer {
  // Pre-allocated scratch buffer for cone arc points (zero runtime allocations)
  private static readonly _scratchConeArcPts: Array<{ x: number; y: number }> = Array.from(
    { length: 13 },
    () => ({ x: 0, y: 0 })
  );

  /**
   * Primary entry point for rendering an attack telegraph via WebGL.
   */
  public static draw(batchOrCtx: GLBatch | any, t: ITelegraphAttack): void {
    if (!batchOrCtx || !(batchOrCtx instanceof GLBatch)) return;
    const batch = batchOrCtx;

    const p = MathX.clamp01(t.progress !== undefined ? t.progress : (t.Progress ?? 0));
    const col = t.color || t.Color || '#ff0054';
    const tx = t.x ?? t.X ?? 0;
    const ty = t.y ?? t.Y ?? 0;
    const type = (t.type || t.Type || 'circle').toLowerCase();

    batch.setBlendMode(GLBlendMode.ADDITIVE);

    switch (type) {
      case 'circle': {
        const r = Math.max(1, t.radius || t.Radius || 100);
        TelegraphRenderer.drawCircleTelegraph(batch, tx, ty, r, p, col);
        break;
      }

      case 'cone': {
        const r = Math.max(1, t.radius || t.Radius || 200);
        const a = t.angle || t.Angle || 0;
        const sp = t.spread || t.Spread || 0.6;
        TelegraphRenderer.drawConeTelegraph(batch, tx, ty, r, a, sp, p, col);
        break;
      }

      case 'line':
      case 'laser':
      case 'corridor': {
        let startX = tx;
        let startY = ty;
        let endX = tx;
        let endY = ty;
        let a = t.angle || t.Angle || 0;
        let len = Math.max(1, t.length || t.Length || 300);

        if (t.x1 !== undefined && t.x2 !== undefined && t.y1 !== undefined && t.y2 !== undefined) {
          startX = t.x1;
          startY = t.y1;
          endX = t.x2;
          endY = t.y2;
          const dx = endX - startX;
          const dy = endY - startY;
          len = Math.hypot(dx, dy);
          a = Math.atan2(dy, dx);
        } else {
          endX = tx + Math.cos(a) * len;
          endY = ty + Math.sin(a) * len;
        }

        const width = Math.max(16, t.width || t.Width || 32);
        TelegraphRenderer.drawLineTelegraph(batch, startX, startY, len, a, p, col, width, endX, endY);
        break;
      }

      case 'ring': {
        const r = Math.max(1, t.radius || t.Radius || 30);
        TelegraphRenderer.drawWarpRing(batch, tx, ty, r, p, col);
        break;
      }

      default: {
        const r = Math.max(1, t.radius || t.Radius || 100);
        batch.drawSdfRing(tx, ty, r, 2.0, col, 0.6, 8, col);
        batch.drawSdfCircle(tx, ty, r * p, col, 0.25);
        break;
      }
    }
  }

  /**
   * Alias for TelegraphRenderer.draw.
   */
  public static drawTelegraph(batchOrCtx: GLBatch | any, t: ITelegraphAttack): void {
    TelegraphRenderer.draw(batchOrCtx, t);
  }

  /**
   * Renders persistent charging or armed hazard pools.
   */
  public static drawHazard(batchOrCtx: GLBatch | any, hz: IHazardRenderData): void {
    if (!batchOrCtx || !(batchOrCtx instanceof GLBatch)) return;
    const batch = batchOrCtx;

    const hzColor = hz.color || (hz.type === 'laser' ? '#ff3366' : hz.type === 'poison' ? '#10b981' : '#f59e0b');
    const r = hz.radius || 24;

    batch.setBlendMode(GLBlendMode.ADDITIVE);

    if (hz.telegraph && hz.telegraph > 0) {
      const maxT = hz.telegraphMax && hz.telegraphMax > 0 ? hz.telegraphMax : hz.telegraph;
      const p = MathX.clamp01(1 - hz.telegraph / maxT);
      batch.drawSdfRing(hz.x, hz.y, r, 2.0, hzColor, 0.6, 8, hzColor);
      batch.drawSdfCircle(hz.x, hz.y, r * p, hzColor, 0.25);
    } else {
      // Active armed hazard pool
      batch.drawSdfCircle(hz.x, hz.y, r, hzColor, 0.35, 12, hzColor);
      batch.drawSdfRing(hz.x, hz.y, r, 2.0, hzColor, 0.85, 6, hzColor);
    }
  }

  /**
   * Renders a circular danger telegraph zone.
   */
  public static drawCircleTelegraph(
    batchOrCtx: GLBatch | any,
    x: number,
    y: number,
    radius: number,
    progress: number,
    color: string
  ): void {
    if (!batchOrCtx || !(batchOrCtx instanceof GLBatch)) return;
    const batch = batchOrCtx;
    const r = Math.max(1, radius);
    const p = MathX.clamp01(progress);

    // 1. Outer warning perimeter ring
    batch.drawSdfRing(x, y, r, 2.5, color, 0.7, 8, color);

    // 2. Expanding inner danger blast zone (area scales, intensity rises with progress)
    batch.drawSdfCircle(x, y, r * p, color, 0.2 + 0.18 * p, 6, color);

    // 3. Radial countdown progress ring arc
    const segCount = 32;
    const activeSegs = Math.floor(segCount * p);
    for (let i = 0; i < activeSegs; i++) {
      const a1 = -Math.PI / 2 + (MathX.Tau * i) / segCount;
      const a2 = -Math.PI / 2 + (MathX.Tau * (i + 1)) / segCount;
      const x1 = x + Math.cos(a1) * (r - 2);
      const y1 = y + Math.sin(a1) * (r - 2);
      const x2 = x + Math.cos(a2) * (r - 2);
      const y2 = y + Math.sin(a2) * (r - 2);
      batch.drawLaserLine(x1, y1, x2, y2, color, 3.0, '#ffffff', 0.85);
    }

    // 4. Imminent detonation flashing core
    if (p > 0.8) {
      const flash = (p - 0.8) * 5;
      batch.drawSdfCircle(x, y, r * 0.25, '#ffffff', flash * 0.85, 12, '#ffffff');
    }
  }

  /**
   * Renders an angular cone breath telegraph.
   */
  public static drawConeTelegraph(
    batchOrCtx: GLBatch | any,
    x: number,
    y: number,
    radius: number,
    angle: number,
    spread: number,
    progress: number,
    color: string
  ): void {
    if (!batchOrCtx || !(batchOrCtx instanceof GLBatch)) return;
    const batch = batchOrCtx;
    const r = Math.max(1, radius);
    const p = MathX.clamp01(progress);
    const startA = angle - spread * 0.5;
    const endA = angle + spread * 0.5;

    // 1. Boundary laser rays from apex
    const r1x = x + Math.cos(startA) * r;
    const r1y = y + Math.sin(startA) * r;
    const r2x = x + Math.cos(endA) * r;
    const r2y = y + Math.sin(endA) * r;
    batch.drawLaserLine(x, y, r1x, r1y, color, 2.5, '#ffffff', 0.65);
    batch.drawLaserLine(x, y, r2x, r2y, color, 2.5, '#ffffff', 0.65);

    // 2. Outer curved perimeter boundary arc (Zero-Allocation Scratch)
    const arcPts = TelegraphRenderer._scratchConeArcPts;
    for (let k = 0; k <= 12; k++) {
      const curA = startA + (spread * k) / 12;
      arcPts[k]!.x = x + Math.cos(curA) * r;
      arcPts[k]!.y = y + Math.sin(curA) * r;
    }
    batch.drawPolyline(arcPts, 2.0, color, 6);

    // 3. Progressive expanding inner cone fill (smooth triangle fan wedge)
    batch.drawSdfWedge(x, y, r * p, angle, spread, color, 0.22 * p, 12);

    // 4. Apex high-energy charging glint
    batch.drawSdfCircle(x, y, 5 + p * 5, '#ffffff', 0.85, 8, color);
  }

  /**
   * Renders a directional laser corridor danger telegraph.
   */
  public static drawLineTelegraph(
    batchOrCtx: GLBatch | any,
    x: number,
    y: number,
    length: number,
    angle: number,
    progress: number,
    color: string,
    width: number = 24,
    targetEndX?: number,
    targetEndY?: number
  ): void {
    if (!batchOrCtx || !(batchOrCtx instanceof GLBatch)) return;
    const batch = batchOrCtx;
    const p = MathX.clamp01(progress);

    const endX = targetEndX !== undefined ? targetEndX : x + Math.cos(angle) * length;
    const endY = targetEndY !== undefined ? targetEndY : y + Math.sin(angle) * length;

    const corridorW = Math.max(16, width) * (0.65 + 0.35 * p);
    const hw = corridorW * 0.5;
    const normX = -Math.sin(angle);
    const normY = Math.cos(angle);

    const lsX = x + normX * hw;
    const lsY = y + normY * hw;
    const rsX = x - normX * hw;
    const rsY = y - normY * hw;
    const leX = endX + normX * hw;
    const leY = endY + normY * hw;
    const reX = endX - normX * hw;
    const reY = endY - normY * hw;

    // 1. Semi-transparent expanding corridor fill
    batch.drawQuadVertices(lsX, lsY, leX, leY, reX, reY, rsX, rsY, ColorX.rgba(color, 0.12 + 0.22 * p), 0);

    // 2. Left & Right guide laser lines
    batch.drawLaserLine(lsX, lsY, leX, leY, color, 2.0, '#ffffff', 0.5 + 0.35 * p);
    batch.drawLaserLine(rsX, rsY, reX, reY, color, 2.0, '#ffffff', 0.5 + 0.35 * p);

    // 3. Central charging high-energy rail beam
    batch.drawLaserLine(x, y, endX, endY, color, 3.0 + p * 4.0, '#ffffff', 0.4 + 0.6 * p);
  }

  /**
   * Renders an expanding warp ring.
   */
  public static drawWarpRing(
    batchOrCtx: GLBatch | any,
    x: number,
    y: number,
    radius: number,
    progress: number,
    color: string = '#c084fc'
  ): void {
    if (!batchOrCtx || !(batchOrCtx instanceof GLBatch)) return;
    const batch = batchOrCtx;
    const p = MathX.clamp01(progress);
    const r = Math.max(1, radius);
    batch.drawSdfRing(x, y, r * (2.2 - p * 1.2), 2.5, color, 0.25 + p * 0.5, 8, color);
  }

  /**
   * Renders a high-frequency charging ring.
   */
  public static drawChargeRing(
    batchOrCtx: GLBatch | any,
    x: number,
    y: number,
    radius: number,
    shootTimer: number,
    color: string = '#ff0054'
  ): void {
    if (!batchOrCtx || !(batchOrCtx instanceof GLBatch)) return;
    const batch = batchOrCtx;
    const r = Math.max(1, radius);
    const pulse = 1.0 + Math.sin(shootTimer * 15) * 0.15;
    batch.drawSdfRing(x, y, r * pulse, 2.0, color, 0.7, 6, color);
  }
}
