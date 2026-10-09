import { describe, it, expect, beforeEach } from 'vitest';
import { WebGLGameRenderer } from '../render/webgl/WebGLGameRenderer';
import { GLBatch, GLBlendMode } from '../render/webgl/GLBatch';
import { WebGLAssetAtlas } from '../render/webgl/WebGLAssetAtlas';
import { GameEngine } from '../sim/GameEngine';
import { GameState } from '../sim/GameState';
import { FoodItem } from '../sim/FoodItem';
import { ColorX } from '../render/ColorX';

describe('Starfield Background Layering & Depth Order Suite', () => {
  beforeEach(() => {
    WebGLAssetAtlas.clear();
  });

  describe('1. Deep Background Layering Hierarchy in drawBackdrop', () => {
    it('1.1 renders dynamic starfield strictly BEFORE checkered celestial grid and coordinate lines', () => {
      const batch = new GLBatch(null as any);
      const events: string[] = [];

      const origDrawQuad = batch.drawQuad.bind(batch);
      const origDrawLaser = batch.drawLaser.bind(batch);
      const origDrawLaserLine = batch.drawLaserLine.bind(batch);
      const origDrawQuadVertices = batch.drawQuadVertices.bind(batch);

      // Track dynamic starfield drawing
      batch.drawQuadVertices = (...args) => {
        events.push('drawStarDiamond');
        return origDrawQuadVertices(...args);
      };

      // Track checkered grid and coordinate grid lines
      batch.drawLaser = (x1, y1, x2, y2, ...args) => {
        // Coordinate lines are span-length (x1 === x2 or y1 === y2)
        if ((x1 === x2 && (y2 - y1) >= 600) || (y1 === y2 && (x2 - x1) >= 900)) {
          events.push('drawCoordinateGridLine');
        }
        return origDrawLaser(x1, y1, x2, y2, ...args);
      };

      // Track perimeter border walls (full perimeter span >= 500px)
      batch.drawLaserLine = (x1, y1, x2, y2, ...args) => {
        const len = Math.hypot(x2 - x1, y2 - y1);
        if (len >= 500) {
          events.push('drawPerimeterBorder');
        }
        return origDrawLaserLine(x1, y1, x2, y2, ...args);
      };

      (WebGLGameRenderer as any).drawBackdrop(batch, 960, 640, false, 0, 1);

      // Verify that star diamond beacons appear BEFORE coordinate grid lines
      const firstStarIndex = events.indexOf('drawStarDiamond');
      const firstGridLineIndex = events.indexOf('drawCoordinateGridLine');
      const firstBorderIndex = events.indexOf('drawPerimeterBorder');

      expect(firstStarIndex).toBeGreaterThan(-1);
      expect(firstGridLineIndex).toBeGreaterThan(-1);
      expect(firstBorderIndex).toBeGreaterThan(-1);

      // Stars must be drawn BEFORE grid lines (stars in deep background behind floor grid)
      expect(firstStarIndex).toBeLessThan(firstGridLineIndex);
      // Grid lines must be drawn BEFORE perimeter borders
      expect(firstGridLineIndex).toBeLessThan(firstBorderIndex);
      // Stars must be drawn BEFORE perimeter borders (borders enclose starfield)
      expect(firstStarIndex).toBeLessThan(firstBorderIndex);
    });

    it('1.2 ensures drawFood enforces GLBlendMode.NORMAL before drawing food items, preventing backdrop laser bleed', () => {
      const batch = new GLBatch(null as any);
      // Simulate backdrop finishing in ADDITIVE mode
      batch.setBlendMode(GLBlendMode.ADDITIVE);
      expect(batch.currentBlendMode).toBe(GLBlendMode.ADDITIVE);

      const food = new FoodItem(100, 100, 'apple');
      food.spawnScale = 1.0;
      WebGLGameRenderer.drawFood(batch, food, 0);

      // drawFood must enforce NORMAL mode for food core drawing
      expect(batch.currentBlendMode).toBe(GLBlendMode.NORMAL);
    });

    it('1.3 clamps dynamic starfield coordinates within arena boundary preventing stars outside border walls', () => {
      const batch = new GLBatch(null as any);
      const starCoordinates: Array<{ x: number; y: number }> = [];

      // Star quads have size <= 10 (grid quads are 88x88)
      batch.drawQuad = (x, y, w) => {
        if (w <= 10) {
          starCoordinates.push({ x, y });
        }
      };
      batch.drawSdfCircle = (x, y) => {
        starCoordinates.push({ x, y });
      };
      batch.drawQuadVertices = (x0, y0, x1, y1, x2, y2, x3, y3) => {
        const cx = (x0 + x1 + x2 + x3) * 0.25;
        const cy = (y0 + y1 + y2 + y3) * 0.25;
        starCoordinates.push({ x: cx, y: cy });
      };

      // Draw backdrop at 960 x 640
      const w = 960;
      const h = 640;
      const pad = 6;
      (WebGLGameRenderer as any).drawBackdrop(batch, w, h, false, 50, 1);

      // All stars must be bounded inside [pad, w - pad] and [pad, h - pad]
      for (const s of starCoordinates) {
        expect(s.x).toBeGreaterThanOrEqual(pad - 1);
        expect(s.x).toBeLessThanOrEqual(w - pad + 1);
        expect(s.y).toBeGreaterThanOrEqual(pad - 1);
        expect(s.y).toBeLessThanOrEqual(h - pad + 1);
      }
    });
  });

  describe('2. Food Core Opacity & Bioluminescence Parity', () => {
    it('2.1 WebGLAssetAtlas generates bright non-black inner bioluminescent core pixels for food', () => {
      const atlasSize = 512;
      const pixels = WebGLAssetAtlas.getProceduralFoodAtlasPixels(atlasSize);
      expect(pixels).toBeDefined();

      // Food 0 is 'apple' (#10b981). Dynamic cell size based on CELLS_PER_ROW.
      const cellSize = Math.floor(atlasSize / WebGLAssetAtlas.CELLS_PER_ROW);
      const cx = Math.floor(cellSize * 0.5);
      const cy = Math.floor(cellSize * 0.5);
      const centerIdx = (cy * atlasSize + cx) * 4;

      const r = pixels[centerIdx + 0]!;
      const g = pixels[centerIdx + 1]!;
      const b = pixels[centerIdx + 2]!;
      const a = pixels[centerIdx + 3]!;

      // Alpha must be completely opaque (255)
      expect(a).toBe(255);

      // The core must NOT be pitch black [0, 11, 17] caused by hexToRgb parsing rgb(...)
      expect(g).toBeGreaterThan(100);
      expect(r + g + b).toBeGreaterThan(150);
    });

    it('2.2 drawFood fallback draws opaque sphere core in GLBlendMode.NORMAL before outer glow halo', () => {
      const batch = new GLBatch(null as any);
      const sphereCalls: Array<{ x: number; y: number; blendMode: GLBlendMode }> = [];

      batch.drawSphere = (x, y) => {
        sphereCalls.push({ x, y, blendMode: batch.currentBlendMode });
      };

      const food = new FoodItem(300, 200, 'apple');
      food.spawnScale = 1;
      // Force fallback procedural branch by clearing atlas
      WebGLAssetAtlas.clear();
      (WebGLGameRenderer as any).drawFood(batch, food, 0);

      expect(sphereCalls.length).toBeGreaterThan(0);
      // The physical sphere core must be drawn in NORMAL blend mode to occlude background stars
      expect(sphereCalls[0]!.blendMode).toBe(GLBlendMode.NORMAL);
    });
  });

  describe('3. Full Scene Pipeline Depth Order Verification', () => {
    it('3.1 executes full scene pipeline in strict depth order: backdrop (void->stars->grid->border) -> foods -> entities', () => {
      const batch = new GLBatch(null as any);
      const engine = new GameEngine();
      engine.state = GameState.Playing;
      engine.arenaW = 960;
      engine.arenaH = 640;
      const food = new FoodItem(300, 200, 'apple');
      food.spawnScale = 1;
      engine.foods = [food];
      engine.player = { x: 100, y: 100, color: '#00f0b5' } as any;

      const passOrder: string[] = [];

      const origDrawBackdrop = (WebGLGameRenderer as any).drawBackdrop;
      const origDrawFood = (WebGLGameRenderer as any).drawFood;
      const origDrawPlayer = (WebGLGameRenderer as any).drawPlayer;

      (WebGLGameRenderer as any).drawBackdrop = (...args: any[]) => {
        passOrder.push('drawBackdrop');
        return origDrawBackdrop.apply(WebGLGameRenderer, args);
      };
      (WebGLGameRenderer as any).drawFood = (...args: any[]) => {
        passOrder.push('drawFood');
        return origDrawFood.apply(WebGLGameRenderer, args);
      };
      (WebGLGameRenderer as any).drawPlayer = (...args: any[]) => {
        passOrder.push('drawPlayer');
        return origDrawPlayer.apply(WebGLGameRenderer, args);
      };

      try {
        (WebGLGameRenderer as any).renderWithBatch(batch, engine);

        expect(passOrder).toEqual(['drawBackdrop', 'drawFood', 'drawPlayer']);
      } finally {
        (WebGLGameRenderer as any).drawBackdrop = origDrawBackdrop;
        (WebGLGameRenderer as any).drawFood = origDrawFood;
        (WebGLGameRenderer as any).drawPlayer = origDrawPlayer;
      }
    });
  });
});
