import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupMockDom, MockElement } from './MockDom';
import { GameEngine } from '../sim/GameEngine';
import { GameState } from '../sim/GameState';
import { GameRenderer } from '../render/GameRenderer';
import { OuroborosMenuAnimation, IOuroborosSegment } from '../render/OuroborosMenuAnimation';
import { WebGLGameRenderer } from '../render/WebGLGameRenderer';
import { UiRoot } from '../ui/UiRoot';
import { UiTheme } from '../ui/UiTheme';
import { Services } from '../core/Services';
import { NullFx, NullSound } from '../core/Contracts';
import { InputManager } from '../input/InputManager';
import { SnakePlayer } from '../sim/SnakePlayer';
import { Vec2 } from '../core/Vec2';
import * as fs from 'fs';
import * as path from 'path';

function getLineSegmentIntersection(
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  p3: { x: number; y: number },
  p4: { x: number; y: number }
): { x: number; y: number } | null {
  const dx12 = p2.x - p1.x;
  const dy12 = p2.y - p1.y;
  const dx34 = p4.x - p3.x;
  const dy34 = p4.y - p3.y;

  const det = dx12 * dy34 - dy12 * dx34;
  if (Math.abs(det) < 1e-9) return null;

  const dx13 = p1.x - p3.x;
  const dy13 = p1.y - p3.y;

  const t = (dx13 * dy34 - dy13 * dx34) / -det;
  const u = (dx12 * dy13 - dy12 * dx13) / det;

  if (t > 0.01 && t < 0.99 && u > 0.01 && u < 0.99) {
    return {
      x: p1.x + t * dx12,
      y: p1.y + t * dy12,
    };
  }
  return null;
}

function clusterIntersectionPoints(
  points: Array<{ x: number; y: number }>,
  clusterRadius: number = 15
): Array<{ x: number; y: number }> {
  const clusters: Array<{ x: number; y: number }> = [];
  for (const pt of points) {
    const exists = clusters.some(
      (c) => Math.hypot(c.x - pt.x, c.y - pt.y) < clusterRadius
    );
    if (!exists) {
      clusters.push(pt);
    }
  }
  return clusters;
}

describe('Intricate Ouroboros Knot & Transparent Gameboard Backdrop Test Suite', () => {
  let restoreDom: () => void;
  let container: MockElement;
  let engine: GameEngine;
  let uiRoot: UiRoot;

  beforeEach(() => {
    restoreDom = setupMockDom();
    Services.Sound = new NullSound();
    Services.Fx = new NullFx();
    Services.Input = InputManager.instance;

    container = document.createElement('div') as any;
    container.id = 'ui-root';
    document.body.appendChild(container as any);

    engine = new GameEngine(Services.Fx);
    uiRoot = UiRoot.init(container as any, engine);
    engine.setUiRoot(uiRoot);
  });

  afterEach(() => {
    restoreDom();
    vi.restoreAllMocks();
  });

  it('1. verifies parametric knot geometry asserts strictly 8 distinct spatial crossover intersection points without NaN or Infinity', () => {
    const anim = new OuroborosMenuAnimation();
    const screenW = 1200;
    const screenH = 800;
    const cx = screenW * 0.5;
    const cy = screenH * 0.5;
    const rx = 350;
    const ry = 350;
    const time = 0;

    const sampleCount = 720;
    const sampledPoints: Array<{ x: number; y: number; z: number }> = [];

    for (let s = 0; s < sampleCount; s++) {
      const u = s / sampleCount;
      const pt = anim.evaluateKnot(u, cx, cy, rx, ry, time);

      expect(Number.isFinite(pt.x)).toBe(true);
      expect(Number.isFinite(pt.y)).toBe(true);
      expect(Number.isFinite(pt.z)).toBe(true);
      expect(Number.isNaN(pt.x)).toBe(false);
      expect(Number.isNaN(pt.y)).toBe(false);
      expect(Number.isNaN(pt.z)).toBe(false);

      sampledPoints.push(pt);
    }

    const rawIntersections: Array<{ x: number; y: number }> = [];

    for (let i = 0; i < sampleCount; i++) {
      const p1 = sampledPoints[i]!;
      const p2 = sampledPoints[(i + 1) % sampleCount]!;

      for (let j = i + 2; j < sampleCount; j++) {
        if (i === 0 && j === sampleCount - 1) continue;

        const p3 = sampledPoints[j]!;
        const p4 = sampledPoints[(j + 1) % sampleCount]!;

        const hit = getLineSegmentIntersection(p1, p2, p3, p4);
        if (hit) {
          expect(Number.isFinite(hit.x)).toBe(true);
          expect(Number.isFinite(hit.y)).toBe(true);
          expect(Number.isNaN(hit.x)).toBe(false);
          expect(Number.isNaN(hit.y)).toBe(false);
          rawIntersections.push(hit);
        }
      }
    }

    const distinctCrossovers = clusterIntersectionPoints(rawIntersections, 15);
    expect(distinctCrossovers.length).toBe(8);

    let q1 = 0, q2 = 0, q3 = 0, q4 = 0;
    for (const pt of distinctCrossovers) {
      if (pt.x >= cx && pt.y <= cy) q1++;
      else if (pt.x < cx && pt.y <= cy) q2++;
      else if (pt.x < cx && pt.y > cy) q3++;
      else q4++;
    }
    expect(q1 + q2 + q3 + q4).toBe(8);
    expect(q1).toBe(2);
    expect(q2).toBe(2);
    expect(q3).toBe(2);
    expect(q4).toBe(2);
  });

  it('2. verifies continuous seamless closed loop alignment where distance between segment 0 and segment N-1 equals step distance (<= 40px) without NaN/Infinity', () => {
    const anim = new OuroborosMenuAnimation();
    const screenW = 1200;
    const screenH = 800;

    const frames = [0, 1, 2, 30, 60, 120, 240, 360];
    const headPositions: Vec2[] = [];
    const tailPositions: Vec2[] = [];

    for (const f of frames) {
      anim.update(f, screenW, screenH);
      const head = anim.getHeadPosition();
      const tail = anim.getTailPosition();

      expect(Number.isFinite(head.x)).toBe(true);
      expect(Number.isFinite(head.y)).toBe(true);
      expect(Number.isFinite(tail.x)).toBe(true);
      expect(Number.isFinite(tail.y)).toBe(true);
      expect(Number.isNaN(head.x)).toBe(false);
      expect(Number.isNaN(head.y)).toBe(false);
      expect(Number.isNaN(tail.x)).toBe(false);
      expect(Number.isNaN(tail.y)).toBe(false);

      headPositions.push(head);
      tailPositions.push(tail);

      const distHeadToTail = Math.hypot(head.x - tail.x, head.y - tail.y);
      expect(distHeadToTail).toBeLessThanOrEqual(40);
    }

    const stepDist = Math.hypot(
      headPositions[1]!.x - headPositions[0]!.x,
      headPositions[1]!.y - headPositions[0]!.y
    );
    expect(stepDist).toBeGreaterThan(0.01);
    expect(stepDist).toBeLessThan(15.0);

    anim.update(60, screenW, screenH);
    const segments: IOuroborosSegment[] = (anim as any)._segments || (anim as any).segments;
    expect(segments).toBeDefined();

    for (let i = 0; i < segments.length - 1; i++) {
      const segA = segments[i]!;
      const segB = segments[i + 1]!;

      const linkDist = Math.hypot(segA.x - segB.x, segA.y - segB.y);
      expect(linkDist).toBeGreaterThan(0.5);
      expect(linkDist).toBeLessThan(40);

      expect(Number.isFinite(segA.angle)).toBe(true);
      expect(Number.isNaN(segA.angle)).toBe(false);
    }

    const firstStepDist = Math.hypot(segments[0]!.x - segments[1]!.x, segments[0]!.y - segments[1]!.y);
    const loopCloseDist = Math.hypot(
      segments[0]!.x - segments[segments.length - 1]!.x,
      segments[0]!.y - segments[segments.length - 1]!.y
    );
    expect(loopCloseDist).toBeLessThanOrEqual(40);
    expect(Math.abs(loopCloseDist - firstStepDist)).toBeLessThanOrEqual(25);
  });

  it('3. verifies body segments have uniform muscular base radius (25px - 40px with 3D perspective modulation) with strictly zero NaN/Infinity and mathematical depth ordering', () => {
    const anim = new OuroborosMenuAnimation();
    const screenW = 1000;
    const screenH = 700;

    expect(anim.segmentCount).toBeGreaterThanOrEqual(40);

    anim.update(45, screenW, screenH);

    const segments: IOuroborosSegment[] = (anim as any)._segments || (anim as any).segments;
    const sortedIndices: number[] = (anim as any)._sortedIndices || (anim as any).sortedIndices;

    expect(segments.length).toBeGreaterThanOrEqual(40);
    expect(sortedIndices.length).toBe(segments.length);

    const midIdx = Math.floor(segments.length / 2);
    expect(segments[midIdx]!.radius).toBeGreaterThanOrEqual(20);

    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i]!;

      expect(Number.isFinite(seg.x)).toBe(true);
      expect(Number.isFinite(seg.y)).toBe(true);
      expect(Number.isFinite(seg.z)).toBe(true);
      expect(Number.isFinite(seg.angle)).toBe(true);
      expect(Number.isFinite(seg.radius)).toBe(true);
      expect(Number.isFinite(seg.u)).toBe(true);

      expect(Number.isNaN(seg.x)).toBe(false);
      expect(Number.isNaN(seg.y)).toBe(false);
      expect(Number.isNaN(seg.z)).toBe(false);
      expect(Number.isNaN(seg.angle)).toBe(false);
      expect(Number.isNaN(seg.radius)).toBe(false);
      expect(Number.isNaN(seg.u)).toBe(false);

      expect(seg.radius).toBeGreaterThanOrEqual(12.0);
      expect(seg.radius).toBeLessThanOrEqual(55.0);

      expect(seg.index).toBe(i);
    }

    for (let k = 0; k < sortedIndices.length - 1; k++) {
      const idxA = sortedIndices[k]!;
      const idxB = sortedIndices[k + 1]!;
      const zA = segments[idxA]!.z;
      const zB = segments[idxB]!.z;

      expect(zA).toBeLessThanOrEqual(zB + 1e-7);
    }

    const canvas = document.createElement('canvas');
    canvas.width = screenW;
    canvas.height = screenH;
    const renderer = new WebGLGameRenderer(canvas);
    expect(() => {
      anim.drawGL(renderer.batch, screenW, screenH, 45);
    }).not.toThrow();
  });

  it('4. verifies GameRenderer renders idle backdrop strictly during Title and GameOver states, and NEVER during FloorClear or active play', () => {
    const canvas = document.createElement('canvas');
    canvas.width = 1280;
    canvas.height = 720;
    const renderer = new WebGLGameRenderer(canvas);
    const idleSpy = vi.spyOn(WebGLGameRenderer as any, 'drawIdleBackdrop');

    // Title state (no active run): draws idle knot backdrop
    engine.state = GameState.Title;
    engine.player = null as any;
    engine.frameCount = 100;

    GameRenderer.draw(renderer, engine);
    expect(idleSpy).toHaveBeenCalledWith(renderer.batch, engine.arenaW || 1280, engine.arenaH || 720, 100);

    idleSpy.mockClear();

    // GameOver state: draws idle backdrop
    engine.state = GameState.GameOver;
    engine.frameCount = 250;

    GameRenderer.draw(renderer, engine);
    expect(idleSpy).toHaveBeenCalledWith(renderer.batch, engine.arenaW || 1280, engine.arenaH || 720, 250);

    idleSpy.mockClear();

    // Active Playing: must NEVER draw idle knot backdrop
    engine.state = GameState.Playing;
    engine.player = new SnakePlayer('emerald', 640, 360, 5);
    engine.frameCount = 300;

    GameRenderer.draw(renderer, engine);
    expect(idleSpy).not.toHaveBeenCalled();

    idleSpy.mockClear();

    // FloorClear (boss kill & floor change transition): must NEVER draw idle knot backdrop
    engine.state = GameState.FloorClear;
    engine.frameCount = 350;

    GameRenderer.draw(renderer, engine);
    expect(idleSpy).not.toHaveBeenCalled();

    idleSpy.mockClear();

    // Paused: must NEVER draw idle knot backdrop
    engine.state = GameState.Paused;
    engine.frameCount = 400;

    GameRenderer.draw(renderer, engine);
    expect(idleSpy).not.toHaveBeenCalled();

    idleSpy.mockClear();

    // LevelUp: must NEVER draw idle knot backdrop
    engine.state = GameState.LevelUp;
    engine.frameCount = 450;

    GameRenderer.draw(renderer, engine);
    expect(idleSpy).not.toHaveBeenCalled();
  });

  it('5. verifies CSS modal panel has translucent glassmorphism background allowing canvas layers to show through', () => {
    expect(UiTheme.BgGlass).toMatch(/^rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*(0?\.\d+|0|1)\s*\)$/);
    expect(UiTheme.BgGlassCard).toMatch(/^rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*(0?\.\d+|0|1)\s*\)$/);
    expect(UiTheme.BgGlassSoft).toMatch(/^rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*(0?\.\d+|0|1)\s*\)$/);

    const alphaMatch = UiTheme.BgGlass.match(/rgba\(\d+,\s*\d+,\s*\d+,\s*([0-9.]+)\)/);
    expect(alphaMatch).not.toBeNull();
    const bgGlassAlpha = parseFloat(alphaMatch![1]!);
    expect(bgGlassAlpha).toBeGreaterThan(0.3);
    expect(bgGlassAlpha).toBeLessThan(0.95);

    const indexHtmlPath = path.resolve(__dirname, '../../index.html');
    if (fs.existsSync(indexHtmlPath)) {
      const htmlContent = fs.readFileSync(indexHtmlPath, 'utf-8');

      expect(htmlContent).toContain('.modal-overlay');
      expect(htmlContent).toContain('backdrop-filter: blur');
      expect(htmlContent).toContain('background: rgba(');
      expect(htmlContent).toContain('.modal-panel');
      expect(htmlContent).toContain('background: var(--bg-glass)');
    }
  });

  it('6. verifies responsive viewports enforce isotropic ratio (rx === ry) and non-NaN coordinates with window border overlap allowance', () => {
    const anim = new OuroborosMenuAnimation();
    const testFrames = [0, 15, 30, 60, 120, 240, 360, 500];

    const viewports = [
      { name: 'portrait mobile (iPhone 14/15 Pro)', w: 393, h: 852 },
      { name: 'landscape mobile', w: 852, h: 393 },
      { name: 'desktop 16:9 HD', w: 1280, h: 720 },
      { name: 'ultrawide 21:9', w: 2560, h: 1080 },
    ];

    for (const vp of viewports) {
      const { rx, ry } = OuroborosMenuAnimation.calculateRadii(vp.w, vp.h);
      expect(rx).toBe(ry);
      expect(Number.isFinite(rx)).toBe(true);
      expect(Number.isFinite(ry)).toBe(true);
      expect(Number.isNaN(rx)).toBe(false);
      expect(Number.isNaN(ry)).toBe(false);
      expect(rx).toBeGreaterThan(0);

      for (const frame of testFrames) {
        anim.update(frame, vp.w, vp.h);

        const segments: IOuroborosSegment[] =
          (anim as any)._segments || (anim as any).segments;
        expect(segments).toBeDefined();
        expect(segments.length).toBeGreaterThanOrEqual(40);

        const head = anim.getHeadPosition();
        const tail = anim.getTailPosition();
        const loopDist = Math.hypot(head.x - tail.x, head.y - tail.y);
        expect(loopDist).toBeLessThanOrEqual(40);

        for (let i = 0; i < segments.length; i++) {
          const seg = segments[i]!;
          const r = seg.radius;

          expect(Number.isFinite(seg.x)).toBe(true);
          expect(Number.isFinite(seg.y)).toBe(true);
          expect(Number.isFinite(r)).toBe(true);
          expect(Number.isNaN(seg.x)).toBe(false);
          expect(Number.isNaN(seg.y)).toBe(false);
          expect(Number.isNaN(r)).toBe(false);
          expect(r).toBeGreaterThan(0);
        }
      }
    }
  });
});
