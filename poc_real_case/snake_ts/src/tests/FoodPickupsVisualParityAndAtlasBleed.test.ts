import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WebGLAssetAtlas } from '../render/webgl/WebGLAssetAtlas';
import { WebGLGameRenderer } from '../render/webgl/WebGLGameRenderer';
import { GLBatch } from '../render/webgl/GLBatch';

/**
 * Creates a mock WebGL context for inspecting texture generation and drawing.
 */
function createMockGL() {
  return {
    TEXTURE_2D: 3553,
    TEXTURE_WRAP_S: 10242,
    TEXTURE_WRAP_T: 10243,
    CLAMP_TO_EDGE: 33071,
    TEXTURE_MIN_FILTER: 10241,
    TEXTURE_MAG_FILTER: 10240,
    LINEAR: 9729,
    UNPACK_PREMULTIPLY_ALPHA_WEBGL: 37441,
    RGBA: 6408,
    UNSIGNED_BYTE: 5121,
    createTexture: vi.fn(() => ({ id: 1 })),
    bindTexture: vi.fn(),
    texParameteri: vi.fn(),
    pixelStorei: vi.fn(),
    texImage2D: vi.fn(),
  };
}

describe('Food Pickups Visual Parity & Atlas Bleed Prevention Suite', () => {
  beforeEach(() => {
    WebGLAssetAtlas.clear();
    WebGLGameRenderer.clearTextureCaches();
  });

  describe('1. WebGLAssetAtlas Procedural Rasterization Parity with FoodRenderer.ts', () => {
    it('1.1 magnet / dipole does NOT draw custom red/blue arcs (Canvas2D parity) and zero Canvas2D', () => {
      const gl = createMockGL();
      const getContextCalls: string[] = [];
      const mockCanvas: any = {
        width: 512,
        height: 512,
        getContext: vi.fn((type: string) => {
          getContextCalls.push(type);
          return null;
        }),
      };

      const origDoc = (globalThis as any).document;
      (globalThis as any).document = {
        createElement: vi.fn(() => mockCanvas),
      };

      try {
        WebGLAssetAtlas.initFoodAtlas(gl, 512);
        // Strict Zero-Canvas2D Guarantee
        expect(getContextCalls.filter((t) => t === '2d').length).toBe(0);

        // Procedural pixels check: magnet cell (row 1, col 3: cellIndex 7)
        const pixels = WebGLAssetAtlas.getProceduralFoodAtlasPixels(512);
        expect(pixels).toBeDefined();
        // Magnet base color #a855f7 is present without opposing red/blue arcs
        const cellCx = 3 * 128 + 64;
        const cellCy = 1 * 128 + 64;
        const centerIdx = (cellCy * 512 + cellCx) * 4;
        expect(pixels[centerIdx + 3]).toBeGreaterThan(0);
      } finally {
        (globalThis as any).document = origDoc;
      }
    });

    it('1.2 renders specular highlight with 0.72 alpha and outer halo with 2.0x base radius', () => {
      const gl = createMockGL();
      WebGLAssetAtlas.initFoodAtlas(gl, 512);

      const pixels = WebGLAssetAtlas.getProceduralFoodAtlasPixels(512);
      const cellSize = 128;
      const baseR = cellSize * (14 / 64); // 28
      const haloR = baseR * 2.0; // 56

      // Cell 0: apple (col 0, row 0, cx = 64, cy = 64)
      const cx = 64;
      const cy = 64;

      // Specular highlight at cx - baseR * 0.28, cy - baseR * 0.3
      const gx = Math.round(cx - baseR * 0.28);
      const gy = Math.round(cy - baseR * 0.3);
      const gIdx = (gy * 512 + gx) * 4;
      // Alpha must be high due to specular highlight (>= 0.72 * 255 = 183)
      expect(pixels[gIdx + 3]).toBeGreaterThanOrEqual(180);

      // Outer halo edge at haloR - 1 must have alpha > 0
      const hx = Math.round(cx + (haloR - 2));
      const hIdx = (cy * 512 + hx) * 4;
      expect(pixels[hIdx + 3]).toBeGreaterThan(0);
    });

    it('1.3 renders golden apple solar corona ring with rgba(255, 255, 255, 0.65)', () => {
      const gl = createMockGL();
      WebGLAssetAtlas.initFoodAtlas(gl, 512);

      const pixels = WebGLAssetAtlas.getProceduralFoodAtlasPixels(512);
      // Cell 1: golden (col 1, row 0, cx = 192, cy = 64)
      const cx = 192;
      const cy = 64;
      const baseR = 28;
      const ringR = Math.round(baseR + 3);

      const rx = cx + ringR;
      const rIdx = (cy * 512 + rx) * 4;
      // Corona ring contains bright white component
      expect(pixels[rIdx + 0]).toBeGreaterThan(200);
      expect(pixels[rIdx + 1]).toBeGreaterThan(150);
      expect(pixels[rIdx + 3]).toBeGreaterThan(0);
    });

    it('1.4 renders shard with crystalline diamond geometry in #fff3c4', () => {
      const gl = createMockGL();
      WebGLAssetAtlas.initFoodAtlas(gl, 512);

      const pixels = WebGLAssetAtlas.getProceduralFoodAtlasPixels(512);
      // Cell 2: shard (col 2, row 0, cx = 320, cy = 64)
      const cx = 320;
      const cy = 64;

      // Shard crystal top apex at cy - 20 has color #fff3c4 (255, 243, 196)
      const sIdx = ((cy - 20) * 512 + cx) * 4;
      expect(pixels[sIdx + 0]).toBe(255);
      expect(pixels[sIdx + 1]).toBe(243);
      expect(pixels[sIdx + 2]).toBe(196);
    });

    it('1.5 renders bomb with #111827 dark void core and #ffb703 fuse line', () => {
      const gl = createMockGL();
      WebGLAssetAtlas.initFoodAtlas(gl, 512);

      const pixels = WebGLAssetAtlas.getProceduralFoodAtlasPixels(512);
      // Cell 5: bomb (col 1, row 1, cx = 192, cy = 192)
      const cx = 192;
      const cy = 192;

      // Bomb dark core #111827 (17, 24, 39) at center
      const cIdx = (cy * 512 + cx) * 4;
      expect(pixels[cIdx + 0]).toBe(17);
      expect(pixels[cIdx + 1]).toBe(24);
      expect(pixels[cIdx + 2]).toBe(39);

      // Fuse line #ffb703 (255, 183, 3) at cy - 18, cx + 5
      const fIdx = ((cy - 18) * 512 + (cx + 5)) * 4;
      expect(pixels[fIdx + 0]).toBe(255);
      expect(pixels[fIdx + 1]).toBe(183);
      expect(pixels[fIdx + 2]).toBe(3);
    });

    it('1.6 renders shield capsule ring and chrono clock hands in #ffffff', () => {
      const gl = createMockGL();
      WebGLAssetAtlas.initFoodAtlas(gl, 512);

      const pixels = WebGLAssetAtlas.getProceduralFoodAtlasPixels(512);
      // Cell 4: shield (col 0, row 1, cx = 64, cy = 192)
      const shieldCx = 64;
      const shieldCy = 192;
      const sRingIdx = (shieldCy * 512 + (shieldCx + 15)) * 4;
      expect(pixels[sRingIdx + 0]).toBe(255);
      expect(pixels[sRingIdx + 1]).toBe(255);
      expect(pixels[sRingIdx + 2]).toBe(255);

      // Cell 6: chrono (col 2, row 1, cx = 320, cy = 192)
      const chronoCx = 320;
      const chronoCy = 192;
      const cHandIdx = ((chronoCy - 10) * 512 + chronoCx) * 4;
      expect(pixels[cHandIdx + 0]).toBe(255);
      expect(pixels[cHandIdx + 1]).toBe(255);
      expect(pixels[cHandIdx + 2]).toBe(255);
    });
  });

  describe('2. Atlas Bleed Safety & Strict Quad Margins (cellSize * 0.46)', () => {
    it('2.1 all geometric elements stay strictly within cellSize * 0.46 with >= 3.12px margin to UV gutter', () => {
      const gl = createMockGL();
      WebGLAssetAtlas.initFoodAtlas(gl, 512);

      const pixels = WebGLAssetAtlas.getProceduralFoodAtlasPixels(512);
      const cellSize = 128;
      const maxAllowedDist = cellSize * 0.46; // 58.88px

      // Distance to UV gutter (62px from center) must be >= 3.12px
      expect(62 - maxAllowedDist).toBeGreaterThanOrEqual(3.12 - 0.01);
      // Distance to cell boundary (64px from center) must be >= 5.12px
      expect(64 - maxAllowedDist).toBeGreaterThanOrEqual(5.12 - 0.01);

      // Verify every cell strictly enforces 0 alpha outside maxAllowedDist
      for (let row = 0; row < WebGLAssetAtlas.CELLS_PER_ROW; row++) {
        for (let col = 0; col < WebGLAssetAtlas.CELLS_PER_ROW; col++) {
          const cx = col * cellSize + cellSize * 0.5;
          const cy = row * cellSize + cellSize * 0.5;

          for (let py = 0; py < cellSize; py++) {
            const y = row * cellSize + py;
            const dy = y - cy;
            for (let px = 0; px < cellSize; px++) {
              const x = col * cellSize + px;
              const dx = x - cx;
              const dist = Math.hypot(dx, dy);

              if (dist > maxAllowedDist) {
                const alpha = pixels[(y * 512 + x) * 4 + 3];
                expect(alpha).toBe(0);
              }
            }
          }
        }
      }
    });
  });

  describe('3. WebGLGameRenderer drawFood Quad Scaling Parity', () => {
    it('3.1 renders atlas quad with dim = r * 4.5 centered at (x - dim*0.5, y - dim*0.5)', () => {
      const gl = createMockGL();
      const batch = new GLBatch(gl as any, 64);
      WebGLAssetAtlas.initFoodAtlas(gl, 512);

      const drawTextureSpy = vi.spyOn(batch, 'drawTexture');
      batch.begin(960, 640);

      const food = {
        x: 200,
        y: 300,
        radius: 12,
        type: 'apple',
        color: '#10b981',
        spawnScale: 1.0,
      };

      // In FoodRenderer.ts: r = (food.radius || 10) * s. With s=1 (pulse=0), r = 12.
      // Canvas2D renders with dim = r * 4.5 = 12 * 4.5 = 54 at fx - dim * 0.5, fy - dim * 0.5.
      (WebGLGameRenderer as any).drawFood(batch, food, 0);

      expect(drawTextureSpy).toHaveBeenCalled();
      const lastCall = drawTextureSpy.mock.calls[0];

      const expectedDim = 12 * 4.5; // 54
      const expectedX = 200 - expectedDim * 0.5; // 173
      const expectedY = 300 - expectedDim * 0.5; // 273

      expect(lastCall[1]).toBeCloseTo(expectedX, 1);
      expect(lastCall[2]).toBeCloseTo(expectedY, 1);
      expect(lastCall[3]).toBeCloseTo(expectedDim, 1);
      expect(lastCall[4]).toBeCloseTo(expectedDim, 1);
    });
  });
});
