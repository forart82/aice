/**
 * ============================================================================
 * Visual Parity & Pixel Diff Engine Test Suite (VisualParityPixelDiff.test.ts)
 * Protocol 3.0 Commercial Engine Edition — 100% Non-Regression Parity
 * ============================================================================
 *
 * Single Source of Truth (SSOT): ORACLE.md & AGENTS.md (Rule 1, Rule 6, Rule 10)
 *
 * ARCHITECTURAL SUMMARY:
 * ---------------------
 * Validates the deterministic visual regression and pixel-diff testing engine
 * comparing Native Canvas2D (?canvas2d=true) against WebGL (?gl=true) across
 * all 14 reference scenes.
 *
 * Covers:
 * 1. VisualParityHarness scene registry containing all 14 mandatory scenes.
 * 2. Deterministic scene configuration (classes, damage, food, bestiary, boss, backdrop).
 * 3. High-contrast pixel diff engine algorithm (magenta #ff00ff mismatch highlighting).
 * 4. End-to-end Playwright visual comparison capturing canvas2d vs webgl frames.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { VisualParityHarness } from '../render/VisualParityHarness';
// @ts-ignore
import { runVisualParityDiff, ALL_SCENES, computePixelDiff } from '../../scratch/visual_parity_diff.js';

describe('Visual Parity & Pixel Diff Engine', () => {
  const EXPECTED_SCENES = [
    '01_title',
    '02_class',
    '03_emerald_healthy',
    '04_emerald_damaged',
    '05_stalker',
    '06_hydra',
    '07_storm',
    '08_solar',
    '09_food_grid',
    '10_enemy_grid',
    '11_boss_centipede',
    '12_backdrop_floor1',
    '13_sanctuary',
    '14_lab'
  ];

  describe('1. Scene Registry & Specification Integrity', () => {
    it('registers exactly 14 mandatory deterministic visual parity scenes', () => {
      const scenes = VisualParityHarness.getSceneNames();
      expect(scenes).toHaveLength(14);
      for (const expected of EXPECTED_SCENES) {
        expect(scenes).toContain(expected);
      }
    });

    it('provides valid descriptor metadata for each registered scene', () => {
      for (const name of EXPECTED_SCENES) {
        const scene = VisualParityHarness.getScene(name);
        expect(scene).toBeDefined();
        expect(scene!.name).toBe(name);
        expect(typeof scene!.description).toBe('string');
        expect(typeof scene!.setup).toBe('function');
      }
    });
  });

  describe('2. Pixel Diff Algorithm & High-Contrast Highlighting', () => {
    it('detects identical image buffers with 0 diff count and 0% diff', () => {
      const w = 10;
      const h = 10;
      const bufA = Buffer.alloc(w * h * 4, 128);
      const bufB = Buffer.alloc(w * h * 4, 128);

      const result = VisualParityHarness.comparePixelBuffers(bufA, bufB, w, h);
      expect(result.totalPixels).toBe(100);
      expect(result.diffCount).toBe(0);
      expect(result.diffPercentage).toBe(0);
      expect(result.diffBuffer).toBeDefined();
    });

    it('detects mismatched pixels and highlights them in bright magenta (#ff00ff)', () => {
      const w = 2;
      const h = 2;
      // 4 pixels: Pixel 0 identical, Pixel 1 different in R, Pixel 2 different in G, Pixel 3 different in B
      const bufA = Buffer.from([
        100, 100, 100, 255,   100, 100, 100, 255,
        100, 100, 100, 255,   100, 100, 100, 255
      ]);
      const bufB = Buffer.from([
        100, 100, 100, 255,   200, 100, 100, 255, // diff
        100, 200, 100, 255,   100, 100, 200, 255  // diff, diff
      ]);

      const result = VisualParityHarness.comparePixelBuffers(bufA, bufB, w, h, 5);
      expect(result.totalPixels).toBe(4);
      expect(result.diffCount).toBe(3);
      expect(result.diffPercentage).toBe(75);

      // Verify Pixel 1 in diffBuffer is bright magenta (#ff00ff, rgba 255, 0, 255, 255)
      const p1Offset = 4;
      expect(result.diffBuffer[p1Offset]).toBe(255);     // R
      expect(result.diffBuffer[p1Offset + 1]).toBe(0);   // G
      expect(result.diffBuffer[p1Offset + 2]).toBe(255); // B
      expect(result.diffBuffer[p1Offset + 3]).toBe(255); // A
    });
  });

  describe('3. End-to-End Playwright Visual Parity Suite (14 Scenes)', () => {
    let devServer: any = null;
    let targetUrl = '';

    beforeAll(async () => {
      const { createServer } = await import('vite');
      devServer = await createServer({
        server: { port: 0 }
      });
      await devServer.listen();
      const port = (devServer.httpServer?.address() as any)?.port;
      targetUrl = `http://localhost:${port}`;
    });

    afterAll(async () => {
      if (devServer) {
        await devServer.close();
      }
    });

    it('executes visual parity comparisons and generates diff screenshots and markdown report', async () => {
      // Execute the visual parity runner across all 14 canonical scenes
      const results = await runVisualParityDiff(ALL_SCENES, targetUrl);

      expect(results).toHaveLength(14);

      for (const res of results) {
        // Assert image files exist on disk
        expect(fs.existsSync(res.c2dPath)).toBe(true);
        expect(fs.existsSync(res.glPath)).toBe(true);
        expect(fs.existsSync(res.diffPath)).toBe(true);

        // Assert valid diff percentages
        expect(res.totalPixels).toBe(1280 * 720);
        expect(typeof res.diffPercentage).toBe('number');
        expect(res.diffPercentage).toBeGreaterThanOrEqual(0);
        // Visual parity check: ensure high fidelity (< 15% diff across all scenes)
        expect(res.diffPercentage).toBeLessThan(15);
      }

      // Assert markdown summary report was created and contains all 14 scenes
      const reportPath = path.resolve(__dirname, '../../docs/tdd/visual_parity_pixel_diff_report.md');
      expect(fs.existsSync(reportPath)).toBe(true);
      const reportContent = fs.readFileSync(reportPath, 'utf-8');

      for (const sceneName of EXPECTED_SCENES) {
        expect(reportContent).toContain(`\`${sceneName}\``);
      }
    }, 180000);
  });
});
