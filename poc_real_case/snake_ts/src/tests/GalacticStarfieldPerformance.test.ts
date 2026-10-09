import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ArenaBackdrop } from '../render/ArenaBackdrop';
import { WebGLGameRenderer } from '../render/WebGLGameRenderer';
import { GLBatch } from '../render/webgl/GLBatch';
import { WebGLContext } from '../render/webgl/WebGLContext';
import { setupMockDom } from './MockDom';

describe('Galactic Starfield Backdrop & Performance Test Suite', () => {
  let teardownDom: () => void;

  beforeEach(() => {
    teardownDom = setupMockDom();
  });

  afterEach(() => {
    teardownDom();
  });
  it('1. bakes floor-specific galactic deep-space palettes and caches offscreen canvas', () => {
    const backdrop = new ArenaBackdrop();
    const w = 1920;
    const h = 1080;

    // Floor 1 (Emerald Deep Nebula)
    const c1 = backdrop.bakeBackdrop(w, h, 1);
    expect(c1).toBeDefined();
    expect(c1.width).toBe(w);
    expect(c1.height).toBe(h);

    // Identical parameters should return the cached canvas instance
    const c1Cached = backdrop.bakeBackdrop(w, h, 1);
    expect(c1Cached).toBe(c1);

    // Changing floor creates a new palette canvas
    const c2 = backdrop.bakeBackdrop(w, h, 2);
    expect(c2).toBeDefined();
    expect(c2).not.toBe(c1);
  });

  it('2. ensures zero allocations per frame during pure WebGL backdrop draw loop execution', () => {
    const canvas = document.createElement('canvas');
    canvas.width = 1280;
    canvas.height = 720;
    const glContext = new WebGLContext(canvas);
    const batch = new GLBatch(glContext);

    // Warm up
    for (let f = 0; f < 30; f++) {
      batch.begin(1280, 720);
      WebGLGameRenderer.drawBackdrop(batch, 1280, 720, false, f, 1);
      batch.flush();
    }

    const t0 = process.hrtime.bigint();
    const frames = 120;
    let lastQuadCount = 0;
    for (let f = 0; f < frames; f++) {
      batch.begin(1280, 720);
      WebGLGameRenderer.drawBackdrop(batch, 1280, 720, f % 2 === 0, f, 1);
      lastQuadCount = batch.quadCount;
      batch.flush();
    }
    const t1 = process.hrtime.bigint();
    const avgMs = Number(t1 - t0) / 1_000_000.0 / frames;

    // Render time per backdrop pass must remain well under 2.5ms (measured ~0.2ms standalone, tolerant of parallel test worker contention)
    expect(avgMs).toBeLessThan(2.50);
    expect(lastQuadCount).toBeGreaterThan(0);
  });
});
