import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WebGLAssetAtlas } from '../render/webgl/WebGLAssetAtlas';
import { WebGLGameRenderer } from '../render/webgl/WebGLGameRenderer';
import { GLBatch, GLBlendMode } from '../render/webgl/GLBatch';
import { GLPrimitive } from '../render/webgl/WebGLContext';
import { GameEngine } from '../sim/GameEngine';
import { FoodItem } from '../sim/FoodItem';

/**
 * Creates a mock WebGL context equipped with texture inspection hooks.
 */
function createMockWebGLWithTextures() {
  const calls = {
    texturesCreated: [] as any[],
    texturesBound: [] as any[],
    texParameters: [] as any[],
    texImage2DCalls: [] as any[],
    pixelStoreiCalls: [] as any[],
    activeTextureCalls: [] as number[],
    drawElementsCount: 0,
    uniforms: new Map<string, any>(),
  };

  const gl: any = {
    TEXTURE_2D: 3553,
    TEXTURE0: 33984,
    TEXTURE1: 33985,
    TEXTURE_WRAP_S: 10242,
    TEXTURE_WRAP_T: 10243,
    CLAMP_TO_EDGE: 33071,
    TEXTURE_MIN_FILTER: 10241,
    TEXTURE_MAG_FILTER: 10240,
    LINEAR: 9729,
    NEAREST: 9728,
    UNPACK_PREMULTIPLY_ALPHA_WEBGL: 37441,
    RGBA: 6408,
    UNSIGNED_BYTE: 5121,
    TRIANGLES: 4,
    UNSIGNED_SHORT: 5123,
    ARRAY_BUFFER: 34962,
    ELEMENT_ARRAY_BUFFER: 34963,
    DYNAMIC_DRAW: 35048,
    STATIC_DRAW: 35044,
    FLOAT: 5126,
    BLEND: 3042,
    SRC_ALPHA: 770,
    ONE_MINUS_SRC_ALPHA: 771,
    ONE: 1,
    COLOR_BUFFER_BIT: 16384,

    createTexture: vi.fn(() => {
      const tex = { id: calls.texturesCreated.length + 1 };
      calls.texturesCreated.push(tex);
      return tex;
    }),
    bindTexture: vi.fn((target: number, texture: any) => {
      calls.texturesBound.push({ target, texture });
    }),
    texParameteri: vi.fn((target: number, pname: number, param: number) => {
      calls.texParameters.push({ target, pname, param });
    }),
    pixelStorei: vi.fn((pname: number, param: any) => {
      calls.pixelStoreiCalls.push({ pname, param });
    }),
    texImage2D: vi.fn((...args: any[]) => {
      calls.texImage2DCalls.push(args);
    }),
    texSubImage2D: vi.fn(),
    activeTexture: vi.fn((unit: number) => {
      calls.activeTextureCalls.push(unit);
    }),
    deleteTexture: vi.fn((tex: any) => {
      const idx = calls.texturesCreated.indexOf(tex);
      if (idx !== -1) calls.texturesCreated.splice(idx, 1);
    }),

    createBuffer: vi.fn(() => ({ id: Math.random() })),
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
    uniformMatrix3fv: vi.fn((loc: any, _tr: boolean, val: Float32Array) => {
      if (loc) calls.uniforms.set(loc.name, Array.from(val));
    }),
    uniform2f: vi.fn((loc: any, x: number, y: number) => {
      if (loc) calls.uniforms.set(loc.name, [x, y]);
    }),
    uniform1f: vi.fn((loc: any, x: number) => {
      if (loc) calls.uniforms.set(loc.name, x);
    }),
    uniform1i: vi.fn((loc: any, x: number) => {
      if (loc) calls.uniforms.set(loc.name, x);
    }),
    viewport: vi.fn(),
    clearColor: vi.fn(),
    clear: vi.fn(),
    enable: vi.fn(),
    disable: vi.fn(),
    blendFunc: vi.fn(),
    drawElements: vi.fn((_mode: number, count: number) => {
      calls.drawElementsCount += count;
    }),
    deleteShader: vi.fn(),
    deleteProgram: vi.fn(),
    deleteBuffer: vi.fn(),
  };

  const canvas: any = {
    width: 1200,
    height: 800,
    getContext: vi.fn((type: string) => {
      if (type === 'webgl2' || type === 'webgl') return gl;
      return null;
    }),
  };

  return { canvas, gl, calls };
}

describe('GPU Texture Atlas & Zero-Per-Frame-Upload Engine Suite', () => {
  beforeEach(() => {
    WebGLAssetAtlas.clear();
    WebGLGameRenderer.clearTextureCaches();
  });

  describe('1. WebGLAssetAtlas Food Texture Atlas Generation', () => {
    it('1.1 pre-renders all 8 Food varieties into a 512x512 unified GPU atlas once', () => {
      const { gl, calls } = createMockWebGLWithTextures();

      const atlasTex = WebGLAssetAtlas.initFoodAtlas(gl, 512);
      expect(atlasTex).toBeDefined();
      expect(gl.createTexture).toHaveBeenCalled();
      expect(calls.texImage2DCalls.length).toBe(1);

      // Subsequent retrieval returns the same GPU texture without uploading again
      const atlasTex2 = WebGLAssetAtlas.getFoodAtlasTexture(gl);
      expect(atlasTex2).toBe(atlasTex);
      expect(calls.texImage2DCalls.length).toBe(1);
    });

    it('1.2 records valid UV coordinates [u0, v0, u1, v1] for all 8 food varieties', () => {
      const { gl } = createMockWebGLWithTextures();
      WebGLAssetAtlas.initFoodAtlas(gl, 512);

      const requiredTypes = [
        'apple',
        'golden',
        'shard',
        'potion',
        'shield',
        'bomb',
        'chrono',
        'magnet',
      ];

      for (const type of requiredTypes) {
        const uv = WebGLAssetAtlas.getFoodUV(type);
        expect(uv).toBeDefined();
        expect(uv.length).toBe(4);
        const [u0, v0, u1, v1] = uv;
        expect(u0).toBeGreaterThanOrEqual(0);
        expect(v0).toBeGreaterThanOrEqual(0);
        expect(u1).toBeLessThanOrEqual(1.0);
        expect(v1).toBeLessThanOrEqual(1.0);
        expect(u1).toBeGreaterThan(u0);
        expect(v1).toBeGreaterThan(v0);

        const region = WebGLAssetAtlas.getFoodRegion(type);
        expect(region.uvMin).toEqual([u0, v0]);
        expect(region.uvMax).toEqual([u1, v1]);
      }
    });

    it('1.3 supports dipole alias for magnet food variety', () => {
      const { gl } = createMockWebGLWithTextures();
      WebGLAssetAtlas.initFoodAtlas(gl, 512);

      const magnetUV = WebGLAssetAtlas.getFoodUV('magnet');
      const dipoleUV = WebGLAssetAtlas.getFoodUV('dipole');
      expect(dipoleUV).toEqual(magnetUV);
    });
  });

  describe('2. Floor Nebula Backdrop Static WebGL Pre-Baking', () => {
    it('2.1 pre-bakes static WebGL textures for floors 1..5', () => {
      const { gl, calls } = createMockWebGLWithTextures();

      WebGLAssetAtlas.prebakeBackdrops(gl, 960, 640, [1, 2, 3, 4, 5]);
      expect(calls.texImage2DCalls.length).toBe(5);

      // Accessing any floor 1..5 retrieves the cached static texture without new texImage2D
      for (let floor = 1; floor <= 5; floor++) {
        const tex = WebGLAssetAtlas.getBackdropTexture(gl, floor, 960, 640);
        expect(tex).toBeDefined();
      }
      expect(calls.texImage2DCalls.length).toBe(5);
    });

    it('2.2 maps floors > 5 cyclically to the 5 pre-baked cosmic themes', () => {
      const { gl } = createMockWebGLWithTextures();
      WebGLAssetAtlas.prebakeBackdrops(gl, 960, 640, [1, 2, 3, 4, 5]);

      const texFloor1 = WebGLAssetAtlas.getBackdropTexture(gl, 1, 960, 640);
      const texFloor6 = WebGLAssetAtlas.getBackdropTexture(gl, 6, 960, 640);
      expect(texFloor6).toBe(texFloor1);
    });
  });

  describe('3. Pure WebGL Rendering Integration in WebGLGameRenderer', () => {
    it('3.1 drawFood uses pre-baked GPU Texture Atlas with drawTexture signature', () => {
      const { gl } = createMockWebGLWithTextures();
      const batch = new GLBatch(gl, 64);
      WebGLAssetAtlas.initFoodAtlas(gl, 512);

      const drawTextureSpy = vi.spyOn(batch, 'drawTexture');

      batch.begin(960, 640);
      const food = {
        x: 150,
        y: 250,
        radius: 10,
        type: 'apple',
        color: '#10b981',
        spawnScale: 1.0,
      };

      (WebGLGameRenderer as any).drawFood(batch, food, 0);

      expect(drawTextureSpy).toHaveBeenCalled();
      const lastCall = drawTextureSpy.mock.calls[0];
      const atlasTex = WebGLAssetAtlas.getFoodAtlasTexture(gl);
      expect(lastCall[0]).toBe(atlasTex);
      // Signature: batch.drawTexture(atlasTexture, x - r, y - r, r * 2, r * 2, alpha, uvMin, uvMax)
      const [u0, v0, u1, v1] = WebGLAssetAtlas.getFoodUV('apple');
      if (Array.isArray(lastCall[6])) {
        expect(lastCall[6]).toEqual([u0, v0]);
        expect(lastCall[7]).toEqual([u1, v1]);
      } else {
        expect(lastCall[6]).toBeUndefined();
        expect(lastCall[7]).toEqual([u0, v0]);
        expect(lastCall[8]).toEqual([u1, v1]);
      }
    });

    it('3.2 drawBackdrop renders pure WebGL procedural nebula without canvas texture blits', () => {
      const { gl } = createMockWebGLWithTextures();
      const batch = new GLBatch(gl, 64);
      WebGLAssetAtlas.prebakeBackdrops(gl, 960, 640, [1]);

      const drawRotatedQuadSpy = vi.spyOn(batch, 'drawRotatedQuad');

      batch.begin(960, 640);
      (WebGLGameRenderer as any).drawBackdrop(batch, 960, 640, false, 0, 1);

      // Verifies pure WebGL 2D SDF continuous nebula is rendered directly
      const nebulaCalls = drawRotatedQuadSpy.mock.calls.filter((c) => c[7] === GLPrimitive.Nebula);
      expect(nebulaCalls.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('4. Zero-Per-Frame-Upload Guarantee (0 MB/s Bus Bandwidth)', () => {
    it('4.1 verifies ZERO texImage2D calls and ZERO canvas allocations occur during the render loop', () => {
      const { canvas, gl, calls } = createMockWebGLWithTextures();
      const renderer = new WebGLGameRenderer(canvas);
      const engine = new GameEngine({ headless: true });

      // Add foods of different varieties
      engine.foods = [
        new FoodItem(100, 100, 'apple'),
        new FoodItem(200, 100, 'golden'),
        new FoodItem(300, 100, 'potion'),
        new FoodItem(400, 100, 'shield'),
        new FoodItem(500, 100, 'bomb'),
        new FoodItem(600, 100, 'chrono'),
        new FoodItem(700, 100, 'shard'),
      ];

      // Pre-warm / startup initialization
      const arenaW = engine.arenaW || 960;
      const arenaH = engine.arenaH || 640;
      WebGLAssetAtlas.initFoodAtlas(gl, 512);
      WebGLAssetAtlas.prebakeBackdrops(gl, arenaW, arenaH, [1, 2, 3, 4, 5]);

      const uploadCountBefore = calls.texImage2DCalls.length;
      expect(uploadCountBefore).toBeGreaterThan(0); // Only startup uploads

      // Mock document.createElement to ensure zero per-frame canvas creation
      const origDoc = (globalThis as any).document;
      const mockCreateElement = vi.fn(() => ({
        width: 1200,
        height: 800,
        getContext: () => null,
      }));
      (globalThis as any).document = { createElement: mockCreateElement };

      // Execute 20 simulated game frames
      for (let frame = 0; frame < 20; frame++) {
        engine.frameCount = frame;
        renderer.draw(engine);
      }

      const uploadCountAfter = calls.texImage2DCalls.length;

      // 0 texImage2D calls during 20 frames = 0 MB/s bus bandwidth!
      expect(uploadCountAfter - uploadCountBefore).toBe(0);

      // 0 document.createElement calls during the render loop!
      expect(mockCreateElement).not.toHaveBeenCalled();

      (globalThis as any).document = origDoc;
    });
  });
});
