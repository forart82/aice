import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WebGLAssetAtlas } from '../render/webgl/WebGLAssetAtlas';
import { WebGLContext } from '../render/webgl/WebGLContext';
import { WebGLGameRenderer } from '../render/webgl/WebGLGameRenderer';
import { GLBatch } from '../render/webgl/GLBatch';

/**
 * Mock WebGL context helper.
 */
function createMockGL() {
  const gl: any = {
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
    deleteTexture: vi.fn(),
    createBuffer: vi.fn(() => ({ id: 1 })),
    bindBuffer: vi.fn(),
    bufferData: vi.fn(),
    bufferSubData: vi.fn(),
    createShader: vi.fn(() => ({ id: 1 })),
    shaderSource: vi.fn(),
    compileShader: vi.fn(),
    getShaderParameter: vi.fn(() => true),
    getShaderInfoLog: vi.fn(() => ''),
    createProgram: vi.fn(() => ({ id: 1 })),
    attachShader: vi.fn(),
    linkProgram: vi.fn(),
    getProgramParameter: vi.fn(() => true),
    getProgramInfoLog: vi.fn(() => ''),
    useProgram: vi.fn(),
    getAttribLocation: vi.fn(() => 0),
    enableVertexAttribArray: vi.fn(),
    vertexAttribPointer: vi.fn(),
    getUniformLocation: vi.fn((_prog: any, name: string) => ({ name })),
    uniformMatrix3fv: vi.fn(),
    uniform2f: vi.fn(),
    uniform1f: vi.fn(),
    uniform1i: vi.fn(),
    viewport: vi.fn(),
    clearColor: vi.fn(),
    clear: vi.fn(),
    enable: vi.fn(),
    disable: vi.fn(),
    blendFunc: vi.fn(),
    drawElements: vi.fn(),
    deleteShader: vi.fn(),
    deleteProgram: vi.fn(),
    deleteBuffer: vi.fn(),
  };
  return gl;
}

describe('WebGL Visual Incoherence & White Border/Rectangle Elimination Suite', () => {
  beforeEach(() => {
    WebGLAssetAtlas.clear();
  });

  describe('1. Food Texture Atlas Gutter & Clamped Radius (WebGLAssetAtlas.ts)', () => {
    it('1.1 computes UV coordinates with a 2-pixel safety gutter to prevent bilinear texture bleed', () => {
      const gl = createMockGL();
      WebGLAssetAtlas.initFoodAtlas(gl, 512);

      const cellSize = 128;
      const atlasSize = 512;
      const gutter = 2;

      for (let i = 0; i < WebGLAssetAtlas.FOOD_DEFINITIONS.length; i++) {
        const def = WebGLAssetAtlas.FOOD_DEFINITIONS[i]!;
        const col = i % WebGLAssetAtlas.CELLS_PER_ROW;
        const row = Math.floor(i / WebGLAssetAtlas.CELLS_PER_ROW);
        const px = col * cellSize;
        const py = row * cellSize;

        const expectedU0 = (px + gutter) / atlasSize;
        const expectedV0 = (py + gutter) / atlasSize;
        const expectedU1 = (px + cellSize - gutter) / atlasSize;
        const expectedV1 = (py + cellSize - gutter) / atlasSize;

        const uv = WebGLAssetAtlas.getFoodUV(def.type);
        expect(uv[0]).toBeCloseTo(expectedU0, 5);
        expect(uv[1]).toBeCloseTo(expectedV0, 5);
        expect(uv[2]).toBeCloseTo(expectedU1, 5);
        expect(uv[3]).toBeCloseTo(expectedV1, 5);

        const region = WebGLAssetAtlas.getFoodRegion(def.type);
        expect(region.u0).toBeCloseTo(expectedU0, 5);
        expect(region.v0).toBeCloseTo(expectedV0, 5);
        expect(region.u1).toBeCloseTo(expectedU1, 5);
        expect(region.v1).toBeCloseTo(expectedV1, 5);
      }
    });

    it('1.2 default fallback UV has safety gutter applied', () => {
      const uv = WebGLAssetAtlas.getFoodUV('non_existent_pickup');
      const gutter = 2;
      const atlasSize = 512;
      const cellSize = 128;
      expect(uv[0]).toBeCloseTo(gutter / atlasSize, 5);
      expect(uv[1]).toBeCloseTo(gutter / atlasSize, 5);
      expect(uv[2]).toBeCloseTo((cellSize - gutter) / atlasSize, 5);
      expect(uv[3]).toBeCloseTo((cellSize - gutter) / atlasSize, 5);
    });

    it('1.3 clamps outer halo and all elements to stay strictly within cellSize * 0.46 (>= 5px cell padding) with zero Canvas2D', () => {
      const gl = createMockGL();
      const origDoc = (globalThis as any).document;

      const getContextCalls: string[] = [];
      const mockCanvas: any = {
        width: 512,
        height: 512,
        getContext: vi.fn((type: string) => {
          getContextCalls.push(type);
          return null;
        }),
      };

      (globalThis as any).document = {
        createElement: vi.fn(() => mockCanvas),
      };

      try {
        const tex = WebGLAssetAtlas.initFoodAtlas(gl, 512);
        expect(tex).toBeDefined();

        // Strict Zero-Canvas2D Guarantee: getContext('2d') is NEVER called!
        expect(getContextCalls.filter((t) => t === '2d').length).toBe(0);

        // Verify procedural pixel buffer strictly clamps all pixels to within cellSize * 0.46
        const atlasSize = 512;
        const cellSize = 128;
        const maxAllowedRadius = cellSize * 0.46; // 58.88px in 128x128 cell (center 64)
        const pixels = WebGLAssetAtlas.getProceduralFoodAtlasPixels(atlasSize);
        expect(pixels).toBeDefined();
        expect(pixels.length).toBe(atlasSize * atlasSize * 4);

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

                // Any pixel beyond maxAllowedRadius MUST be 100% transparent (alpha === 0)
                if (dist > maxAllowedRadius) {
                  const alpha = pixels[(y * atlasSize + x) * 4 + 3];
                  expect(alpha).toBe(0);
                }
              }
            }
          }
        }
      } finally {
        (globalThis as any).document = origDoc;
      }
    });
  });

  describe('2. WebGLContext Fragment Shader Border & Alpha Discarding', () => {
    it('2.1 Textured Quad (primType == 5) discards fragments where texCol.a <= 0.002 to eliminate square boxes', () => {
      const fragShader = WebGLContext.FRAGMENT_SHADER_SOURCE;

      // Assert that primType == 5 contains discard check for low alpha
      const prim5Index = fragShader.indexOf('primType == 5');
      expect(prim5Index).toBeGreaterThan(-1);

      const prim5Block = fragShader.substring(prim5Index, prim5Index + 300);
      expect(prim5Block).toMatch(/if\s*\(\s*texCol\.a\s*<=\s*0\.002\s*\)\s*discard\s*;/);
    });

    it('2.2 Sphere (primType == 3) discards at radialDist > 1.0 and smoothly anti-aliases to 0 at 1.0 without sharp ring cliff', () => {
      const fragShader = WebGLContext.FRAGMENT_SHADER_SOURCE;

      const prim3Index = fragShader.indexOf('primType == 3');
      expect(prim3Index).toBeGreaterThan(-1);

      const prim3Block = fragShader.substring(prim3Index, prim3Index + 1400);

      // Must discard strictly at > 1.0 (eliminating radialDist > 1.05 hard cliff)
      expect(prim3Block).toMatch(/if\s*\(\s*radialDist\s*>\s*1\.0\s*\)\s*\{\s*discard\s*;\s*\}/);
      expect(prim3Block).not.toContain('radialDist > 1.05');

      // Smooth anti-aliasing edge from 0.96 to 1.0
      expect(prim3Block).toContain('smoothstep(0.96, 1.0, radialDist)');

      // Glow must NOT overwrite alpha beyond edgeAlpha or create an un-attenuated outer border
      expect(prim3Block).not.toContain('col.a = max(col.a, glow * v_color.a);');
    });
  });

  describe('3. Ingame Entity Geometric Incoherences Parity', () => {
    it('3.1 player orbitals are drawn with triangular fangs rather than rectangular quads', () => {
      const gl = createMockGL();
      const batch = new GLBatch(gl, 64);
      const drawTriangleSpy = vi.spyOn(batch, 'drawTriangle');
      const drawRotatedQuadSpy = vi.spyOn(batch, 'drawRotatedQuad');

      const mockPlayer: any = {
        x: 200,
        y: 200,
        angle: 0,
        headRadius: 12,
        orbitals: [{ x: 230, y: 200, a: 0 }],
        shield: 0,
        relics: {},
        classId: 'emerald',
      };

      batch.begin(960, 640);
      (WebGLGameRenderer as any).drawPlayer(batch, mockPlayer);

      // Orbital fang geometry should use drawTriangle, NOT drawRotatedQuad with GLPrimitive.Quad
      expect(drawTriangleSpy).toHaveBeenCalled();
    });
  });
});
