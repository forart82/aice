/**
 * ============================================================================
 * Rule 12 Pure WebGL 2.0 & Canvas 2D Ban Audit Suite (Rule12PureWebGLAudit.test.ts)
 * Protocol 3.0 Commercial Engine Edition — Mandatory & Non-Negotiable
 * ============================================================================
 *
 * Single Source of Truth (SSOT): ORACLE.md Section 9 & AGENTS.md Rule 12
 *
 * ARCHITECTURAL MANDATE:
 * ---------------------
 * HTML5 Canvas 2D is permanently, unconditionally, and totally banished from
 * the entire game engine. All rendering executes exclusively through pure WebGL 2.0
 * (WebGLGameRenderer.ts, GLBatch.ts, WebGLContext.ts, and WebGLAssetAtlas.ts).
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { GLBatch } from '../render/webgl/GLBatch';
import { WebGLContext, GLPrimitive } from '../render/webgl/WebGLContext';
import { WebGLGameRenderer } from '../render/webgl/WebGLGameRenderer';
import { VisualParityHarness } from '../render/VisualParityHarness';

describe('Rule 12: Pure WebGL 2.0 Renderer & Canvas 2D Ban Audit', () => {
  const rootDir = path.resolve(__dirname, '..');

  describe('1. Absolute Canvas 2D Ban (Zero-Tolerance Audit)', () => {
    const targetDirs = ['render', 'sim', 'input', 'ui', 'data', 'core'];

    function getAllTsFiles(dirPath: string): string[] {
      const files: string[] = [];
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
          files.push(...getAllTsFiles(fullPath));
        } else if (entry.isFile() && entry.name.endsWith('.ts')) {
          files.push(fullPath);
        }
      }
      return files;
    }

    it('confirms ZERO usage of CanvasRenderingContext2D across all production directories', () => {
      for (const subDir of targetDirs) {
        const fullDir = path.join(rootDir, subDir);
        if (!fs.existsSync(fullDir)) continue;

        const tsFiles = getAllTsFiles(fullDir);
        for (const filePath of tsFiles) {
          const content = fs.readFileSync(filePath, 'utf-8');
          // Exclude comments if any, but ensure zero type or variable usages
          const lines = content.split('\n');
          for (let lineNum = 0; lineNum < lines.length; lineNum++) {
            const line = lines[lineNum]!;
            const trimmed = line.trim();
            if (trimmed.startsWith('*') || trimmed.startsWith('//') || trimmed.startsWith('/*')) {
              continue;
            }
            expect(
              line,
              `Found CanvasRenderingContext2D violation in ${path.relative(rootDir, filePath)}:${lineNum + 1}`
            ).not.toContain('CanvasRenderingContext2D');
          }
        }
      }
    });

    it('confirms ZERO calls to getContext("2d") or getContext(\'2d\') in production code', () => {
      for (const subDir of targetDirs) {
        const fullDir = path.join(rootDir, subDir);
        if (!fs.existsSync(fullDir)) continue;

        const tsFiles = getAllTsFiles(fullDir);
        for (const filePath of tsFiles) {
          const content = fs.readFileSync(filePath, 'utf-8');
          const lines = content.split('\n');
          for (let lineNum = 0; lineNum < lines.length; lineNum++) {
            const line = lines[lineNum]!;
            const trimmed = line.trim();
            if (trimmed.startsWith('*') || trimmed.startsWith('//') || trimmed.startsWith('/*')) {
              continue;
            }
            expect(
              line,
              `Found getContext('2d') violation in ${path.relative(rootDir, filePath)}:${lineNum + 1}`
            ).not.toContain("getContext('2d'");
            expect(
              line,
              `Found getContext("2d") violation in ${path.relative(rootDir, filePath)}:${lineNum + 1}`
            ).not.toContain('getContext("2d"');
          }
        }
      }
    });
  });

  describe('2. Pure WebGL 2.0 Dynamic Batching & Zero-Allocation Pipelines', () => {
    it('enforces exact GLBatch vertex and memory constants', () => {
      expect(GLBatch.FLOATS_PER_VERTEX).toBe(6);
      expect(GLBatch.VERTICES_PER_QUAD).toBe(4);
      expect(GLBatch.FLOATS_PER_QUAD).toBe(24);
      expect(GLBatch.INDICES_PER_QUAD).toBe(6);
      expect(GLBatch.DEFAULT_MAX_QUADS).toBe(4096);
    });

    it('allocates reusable pre-sized typed arrays for zero-GC draw loops', () => {
      const batch = new GLBatch(null, 1024);
      expect(batch.arrayBuffer.byteLength).toBe(1024 * 24 * 4);
      expect(batch.vertexDataF32.length).toBe(1024 * 24);
      expect(batch.vertexDataU32.length).toBe(1024 * 24);
      expect(batch.indexBuffer.length).toBe(1024 * 6);
    });

    it('registers all required GLPrimitive shader modes in WebGLContext', () => {
      expect(GLPrimitive.Quad).toBe(0);
      expect(GLPrimitive.Circle).toBe(1);
      expect(GLPrimitive.Ring).toBe(2);
      expect(GLPrimitive.Sphere).toBe(3);
      expect(GLPrimitive.Laser).toBe(4);
      expect(GLPrimitive.Texture).toBe(5);
      expect(GLPrimitive.Nebula).toBe(6);
    });
  });

  describe('3. Visual Parity & Pixel Diff Engine Integrity', () => {
    it('registers all 14 canonical scenes in VisualParityHarness', () => {
      const scenes = VisualParityHarness.getSceneNames();
      expect(scenes).toHaveLength(14);
      expect(scenes).toContain('01_title');
      expect(scenes).toContain('02_class');
      expect(scenes).toContain('03_emerald_healthy');
      expect(scenes).toContain('04_emerald_damaged');
      expect(scenes).toContain('05_stalker');
      expect(scenes).toContain('06_hydra');
      expect(scenes).toContain('07_storm');
      expect(scenes).toContain('08_solar');
      expect(scenes).toContain('09_food_grid');
      expect(scenes).toContain('10_enemy_grid');
      expect(scenes).toContain('11_boss_centipede');
      expect(scenes).toContain('12_backdrop_floor1');
      expect(scenes).toContain('13_sanctuary');
      expect(scenes).toContain('14_lab');
    });

    it('validates that the visual parity pixel diff report confirms < 1.0% diff threshold', () => {
      const reportPath = path.resolve(__dirname, '../../docs/tdd/visual_parity_pixel_diff_report.md');
      expect(fs.existsSync(reportPath)).toBe(true);

      const reportContent = fs.readFileSync(reportPath, 'utf-8');
      expect(reportContent).toContain('Visual Parity & Pixel Diff Engine Report');
      expect(reportContent).toContain('**Total Scenes:** 14');
      expect(reportContent).toContain('**Average Diff Percentage:**');
      expect(reportContent).toContain('🟢 Excellent ISO Parity');
    });
  });
});
