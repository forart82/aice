/**
 * ============================================================================
 * Smartphone Views Performance & Fluid WebGL Rendering Test Suite
 * (SmartphoneViewsPerformanceAndFluidRendering.test.ts)
 * Protocol 3.0 Commercial Engine Edition — 100% Non-Regression Parity
 * ============================================================================
 *
 * Single Source of Truth (SSOT): ORACLE.md & AGENTS.md (Rule 1, Rule 6, Rule 10)
 *
 * ARCHITECTURAL REQUIREMENTS:
 * --------------------------
 * 1. Zero Per-Segment Blend Mode Toggling in Ouroboros Knot:
 *    `OuroborosMenuAnimation.drawGL` must keep a unified blend mode across Pass 3
 *    scale plates. Must NOT flush or switch blend mode 360 times per frame.
 *    Total draw calls / batch flushes for the entire 180-segment knot must be <= 4.
 *
 * 2. Mobile DPR Capping:
 *    `WebGLGameRenderer.resize` on mobile viewports (e.g., width <= 768, touch)
 *    must cap `dpr` to 1.0 to eliminate fillrate exhaustion on TBDR mobile GPUs.
 *
 * 3. Modal WebGL Render Throttling:
 *    When a blocking modal screen (modal-snake-lab, modal-sanctuary, modal-help,
 *    modal-stats, modal-dev-checklist, modal-settings, modal-pause) is open,
 *    the app must avoid continuous 60fps WebGL background redraws that starve the UI.
 *
 * 4. Mobile Backdrop-Filter Elimination:
 *    `index.html` must eliminate expensive `backdrop-filter: blur` on cards and
 *    panels on mobile viewports to guarantee 60fps touch scrolling.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setupMockDom } from './MockDom';
import { OuroborosMenuAnimation } from '../render/OuroborosMenuAnimation';
import { WebGLGameRenderer } from '../render/webgl/WebGLGameRenderer';
import { GLBatch, GLBlendMode } from '../render/webgl/GLBatch';
import { App } from '../main';
import fs from 'fs';
import path from 'path';

describe('Smartphone Views Performance & Fluid WebGL Rendering Suite', () => {
  beforeEach(() => {
    setupMockDom();
  });

  describe('1. OuroborosMenuAnimation Pass 3 Batching & Blend Mode Stability', () => {
    it('1.1 calls setBlendMode at most 5 times total during drawGL (never 360+ times per frame)', () => {
      const anim = new OuroborosMenuAnimation();
      anim.update(0, 1280, 720);

      const batch = new GLBatch(null as any);
      let blendModeCallCount = 0;
      const blendModesCalled: any[] = [];

      batch.setBlendMode = vi.fn((mode) => {
        blendModeCallCount++;
        blendModesCalled.push(mode);
      });

      anim.drawGL(batch, 1280, 720, 0);

      // Previously called 365+ times due to toggling between NORMAL and ADDITIVE for each segment.
      // Must be <= 5 total calls across all passes!
      expect(blendModeCallCount).toBeLessThanOrEqual(5);
    });

    it('1.2 executes all 180 knot segments in <= 4 batch flushes / draw calls', () => {
      const anim = new OuroborosMenuAnimation();
      anim.update(0, 1280, 720);

      const batch = new GLBatch(null as any);
      let flushCount = 0;
      batch.flush = vi.fn(() => {
        flushCount++;
        return 0;
      });

      anim.drawGL(batch, 1280, 720, 0);

      // Previously flushed 360+ times. Must be <= 4 flushes total!
      expect(flushCount).toBeLessThanOrEqual(4);
    });
  });

  describe('2. WebGLGameRenderer Mobile DPR Scaling', () => {
    it('2.1 caps dpr to 1.0 on mobile viewports (e.g. width <= 768 or touch devices)', () => {
      const canvas = document.createElement('canvas');
      const renderer = new WebGLGameRenderer(canvas);

      (window as any).devicePixelRatio = 3.0;

      // Mobile portrait resize: 393 x 852
      renderer.resize(393, 852);

      expect(renderer.dpr).toBe(1.0);
      expect(canvas.width).toBe(393);
      expect(canvas.height).toBe(852);
    });

    it('2.2 allows high DPR (up to 2.0) on desktop widescreen viewports', () => {
      const canvas = document.createElement('canvas');
      const renderer = new WebGLGameRenderer(canvas);

      (window as any).devicePixelRatio = 2.0;

      // Desktop resize: 1920 x 1080
      renderer.resize(1920, 1080);

      expect(renderer.dpr).toBe(2.0);
      expect(canvas.width).toBe(3840);
      expect(canvas.height).toBe(2160);
    });
  });

  describe('3. Mobile CSS Backdrop-Filter Optimization', () => {
    it('3.1 index.html contains mobile media query disabling backdrop-filter on cards and panels', () => {
      const htmlPath = path.resolve(__dirname, '../../index.html');
      const html = fs.readFileSync(htmlPath, 'utf-8');

      // Check that mobile overrides exist
      expect(html).toMatch(/@media[^{]*max-width:\s*768px[^{]*\{[\s\S]*?backdrop-filter:\s*none/i);
    });
  });

  describe('4. Modal WebGL Render Throttling', () => {
    it('4.1 throttles background WebGL redraws when modal-snake-lab is open', () => {
      const app = new App();
      app.uiRoot.showScreen('modal-snake-lab');

      let renderCount = 0;
      app.renderFrame = vi.fn(() => {
        renderCount++;
      });

      // Simulate 30 animation frames via loop
      (app as any)._running = true;
      const loop = (app as any).loop;
      for (let i = 0; i < 30; i++) {
        loop(1000 + i * 16.6);
      }

      // Instead of 30 continuous redraws, it should be throttled to <= 5 redraws
      expect(renderCount).toBeLessThanOrEqual(5);
    });

    it('4.2 executes full 60fps redraws when in gameplay or main menu', () => {
      const app = new App();
      app.uiRoot.showScreen('modal-main-menu');

      let renderCount = 0;
      app.renderFrame = vi.fn(() => {
        renderCount++;
      });

      (app as any)._running = true;
      const loop = (app as any).loop;
      for (let i = 0; i < 30; i++) {
        loop(1000 + i * 16.6);
      }

      // In main menu, knot animates smoothly at full rate
      expect(renderCount).toBe(30);
    });
  });
});
