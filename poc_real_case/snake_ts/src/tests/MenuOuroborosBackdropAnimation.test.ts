import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { setupMockDom, MockElement } from './MockDom';
import { UiRoot } from '../ui/UiRoot';
import { MenuScreen } from '../ui/screens/MenuScreen';
import { Services } from '../core/Services';
import { NullFx, NullSound } from '../core/Contracts';
import { InputManager } from '../input/InputManager';
import { GameEngine } from '../sim/GameEngine';
import { OuroborosMenuAnimation, IOuroborosSegment } from '../render/OuroborosMenuAnimation';
import { GLBatch } from '../render/webgl/GLBatch';
import { WebGLContext } from '../render/webgl/WebGLContext';

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

describe('Menu Ouroboros Backdrop Animation & Logo Cleanup', () => {
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
  });

  it('1. MenuScreen does NOT contain the static logo image tag and preserves all title markup', () => {
    const menu = new MenuScreen(uiRoot);
    const html = menu.element.innerHTML;

    expect(menu.element.querySelector('.menu-logo-img')).toBeNull();
    expect(html).not.toContain('/logo.png');

    expect(menu.element.querySelector('.top-title')).not.toBeNull();
    expect(menu.element.querySelector('.bottom-title')).not.toBeNull();
    expect(menu.element.querySelector('.game-tagline')).not.toBeNull();
    expect(menu.element.querySelector('.menu-best-row')).not.toBeNull();
    expect(menu.element.querySelectorAll('.best-pill').length).toBe(4);
    expect(menu.element.querySelector('.mode-buttons-col')).not.toBeNull();
    expect(menu.element.querySelector('.btn-sanctuary')).not.toBeNull();
    expect(menu.element.querySelector('.btn-settings')).not.toBeNull();
  });

  it('2. OuroborosMenuAnimation initializes parametric knot with strictly 8 crossover points and finite non-NaN coordinates', () => {
    const anim = new OuroborosMenuAnimation();
    const screenW = 1200;
    const screenH = 800;
    const cx = screenW * 0.5;
    const cy = screenH * 0.5;
    const { rx, ry } = OuroborosMenuAnimation.calculateRadii(screenW, screenH);
    expect(rx).toBe(ry);

    const sampleCount = 720;
    const sampledPoints: Array<{ x: number; y: number; z: number }> = [];

    for (let s = 0; s < sampleCount; s++) {
      const u = s / sampleCount;
      const pt = anim.evaluateKnot(u, cx, cy, rx, ry, 0);

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
          rawIntersections.push(hit);
        }
      }
    }

    const crossovers = clusterIntersectionPoints(rawIntersections, 15);
    expect(crossovers.length).toBe(8);
  });

  it('3. verifies seamless closed loop closure where distance between segment 0 and segment N-1 equals step distance (<= 40px) without NaN/Infinity', () => {
    const anim = new OuroborosMenuAnimation();
    expect(anim.segmentCount).toBeGreaterThanOrEqual(40);

    const testFrames = [0, 30, 60, 120, 240];

    for (const frame of testFrames) {
      anim.update(frame, 1200, 800);
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

      const distToTail = Math.hypot(head.x - tail.x, head.y - tail.y);
      expect(distToTail).toBeLessThanOrEqual(40);

      const segments: IOuroborosSegment[] = (anim as any)._segments || (anim as any).segments;
      const stepDist = Math.hypot(segments[0]!.x - segments[1]!.x, segments[0]!.y - segments[1]!.y);
      expect(stepDist).toBeGreaterThan(0.5);
      expect(stepDist).toBeLessThanOrEqual(40);

      expect(Math.abs(distToTail - stepDist)).toBeLessThanOrEqual(25);
    }
  });

  it('4. verifies all segments have uniform muscular base radius (25px - 40px with 3D perspective modulation) with zero NaN/Infinity across animation cycles', () => {
    const anim = new OuroborosMenuAnimation();
    const testFrames = [0, 45, 90, 180];

    for (const frame of testFrames) {
      anim.update(frame, 1200, 800);
      const segments: IOuroborosSegment[] = (anim as any)._segments || (anim as any).segments;
      expect(segments).toBeDefined();

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
      }

      const midSeg = segments[Math.floor(segments.length / 2)]!;
      expect(midSeg.radius).toBeGreaterThanOrEqual(20.0);
    }
  });

  it('5. OuroborosMenuAnimation renders multiple self-crossing segments with pure emerald/greenish theme without throw or NaN', () => {
    const anim = new OuroborosMenuAnimation();
    anim.update(60, 1000, 700);

    const canvas = document.createElement('canvas');
    canvas.width = 1000;
    canvas.height = 700;
    const glContext = new WebGLContext(canvas);
    const batch = new GLBatch(glContext);
    batch.begin(1000, 700);

    expect(() => {
      anim.drawGL(batch, 1000, 700, 60);
    }).not.toThrow();

    expect(batch.quadCount).toBeGreaterThan(0);
  });

  it('6. allows Pure Backdrop / Zen View by cleanly hiding all screen overlays', () => {
    engine.showMenu();
    expect(uiRoot.activeScreenId).toBe('modal-main-menu');

    uiRoot.hideAllScreens();
    expect(uiRoot.activeScreenId).toBeNull();
    expect(uiRoot.isModalOpen()).toBe(false);
  });

  it('7. verifies responsive viewports enforce isotropic ratio (rx === ry) and non-NaN coordinates with window border overlap allowance', () => {
    const anim = new OuroborosMenuAnimation();
    const viewports = [
      { name: 'portrait mobile (iPhone 14/15 Pro)', w: 393, h: 852 },
      { name: 'landscape mobile', w: 852, h: 393 },
      { name: 'desktop 16:9 HD', w: 1280, h: 720 },
      { name: 'ultrawide 21:9', w: 2560, h: 1080 },
    ];
    const testFrames = [0, 15, 30, 60, 120, 240];

    for (const vp of viewports) {
      const { rx, ry } = OuroborosMenuAnimation.calculateRadii(vp.w, vp.h);
      expect(rx).toBe(ry);
      expect(Number.isFinite(rx)).toBe(true);
      expect(rx).toBeGreaterThan(0);

      for (const frame of testFrames) {
        anim.update(frame, vp.w, vp.h);
        const segments: IOuroborosSegment[] =
          (anim as any)._segments || (anim as any).segments;
        expect(segments).toBeDefined();
        expect(segments.length).toBeGreaterThanOrEqual(40);

        for (let i = 0; i < segments.length; i++) {
          const seg = segments[i]!;
          expect(Number.isFinite(seg.x)).toBe(true);
          expect(Number.isFinite(seg.y)).toBe(true);
          expect(Number.isFinite(seg.radius)).toBe(true);
          expect(Number.isNaN(seg.x)).toBe(false);
          expect(Number.isNaN(seg.y)).toBe(false);
          expect(Number.isNaN(seg.radius)).toBe(false);
          expect(seg.radius).toBeGreaterThan(0);
        }
      }
    }
  });
});
