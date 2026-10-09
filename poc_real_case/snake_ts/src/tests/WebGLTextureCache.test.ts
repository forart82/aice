import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WebGLContext, GLPrimitive } from '../render/webgl/WebGLContext';
import { GLBatch, GLBlendMode } from '../render/webgl/GLBatch';
import { FoodRenderer } from '../render/FoodRenderer';
import { ArenaBackdrop } from '../render/ArenaBackdrop';

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
    // Constants
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

    // Methods
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

describe('WebGL Texture Cache & Offscreen Stamp Uploader Suite', () => {
  describe('1. WebGLContext Texture Creation & Management', () => {
    it('1.1 creates WebGLTexture from Canvas with CLAMP_TO_EDGE and LINEAR parameters', () => {
      const { canvas, gl, calls } = createMockWebGLWithTextures();
      const ctx = new WebGLContext(canvas);

      const fakeCanvas = { width: 64, height: 64 } as any;
      const texture = ctx.createTextureFromCanvas(fakeCanvas);

      expect(texture).toBeDefined();
      expect(gl.createTexture).toHaveBeenCalled();
      expect(gl.bindTexture).toHaveBeenCalledWith(gl.TEXTURE_2D, texture);

      // Verify CLAMP_TO_EDGE and LINEAR setup
      expect(gl.texParameteri).toHaveBeenCalledWith(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      expect(gl.texParameteri).toHaveBeenCalledWith(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      expect(gl.texParameteri).toHaveBeenCalledWith(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      expect(gl.texParameteri).toHaveBeenCalledWith(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

      // Verify texImage2D called with canvas
      expect(calls.texImage2DCalls.length).toBeGreaterThan(0);
      const lastCall = calls.texImage2DCalls[calls.texImage2DCalls.length - 1];
      expect(lastCall[lastCall.length - 1]).toBe(fakeCanvas);
    });

    it('1.2 manages cached textures by key and clears them on demand', () => {
      const { canvas, gl } = createMockWebGLWithTextures();
      const ctx = new WebGLContext(canvas);

      const fakeCanvas1 = { width: 64, height: 64 } as any;
      const tex1 = ctx.getOrCreateTexture('food_apple', fakeCanvas1);
      const tex1Again = ctx.getOrCreateTexture('food_apple', fakeCanvas1);

      expect(tex1).toBe(tex1Again);
      expect(gl.createTexture).toHaveBeenCalledTimes(2); // 1 defaultTexture + 1 food_apple

      ctx.clearTextureCache();
      expect(gl.deleteTexture).toHaveBeenCalledWith(tex1);
    });

    it('1.3 binds texture to active texture unit and updates u_texture uniform', () => {
      const { canvas, gl, calls } = createMockWebGLWithTextures();
      const ctx = new WebGLContext(canvas);

      const fakeCanvas = { width: 64, height: 64 } as any;
      const tex = ctx.createTextureFromCanvas(fakeCanvas);

      ctx.bindTexture(tex, 0);
      expect(gl.activeTexture).toHaveBeenCalledWith(gl.TEXTURE0);
      expect(gl.bindTexture).toHaveBeenCalledWith(gl.TEXTURE_2D, tex);
      expect(calls.uniforms.get('u_texture')).toBe(0);
    });

    it('1.4 includes GLPrimitive.Texture (Type 5) in Fragment Shader with u_texture sampling', () => {
      expect(GLPrimitive.Texture).toBe(5);
      expect(WebGLContext.FRAGMENT_SHADER_SOURCE).toContain('u_texture');
      expect(WebGLContext.FRAGMENT_SHADER_SOURCE).toContain('texture2D');
    });
  });

  describe('2. GLBatch Textured Quad Batching', () => {
    it('2.1 batches a textured quad with accurate [0, 1] UVs and GLPrimitive.Texture parameter', () => {
      const { canvas } = createMockWebGLWithTextures();
      const ctx = new WebGLContext(canvas);
      const batch = new GLBatch(ctx, 16);

      const fakeTex = { id: 99 } as any;
      batch.begin();
      batch.drawTexture(fakeTex, 10, 20, 64, 64, 0.85);

      expect(batch.quadCount).toBe(1);

      const f32 = batch.vertexDataF32;
      const u32 = batch.vertexDataU32;

      // Vertex 0: Top-Left (10, 20) -> UV (0, 0)
      expect(f32[0]).toBe(10);
      expect(f32[1]).toBe(20);
      expect(f32[2]).toBe(0.0); // UV u
      expect(f32[3]).toBe(0.0); // UV v
      expect(u32[4]).toBe(GLBatch.colorToUint32('#ffffff', 0.85));
      const decoded0 = GLBatch.decodeParams(f32[5]);
      expect(decoded0.type).toBe(GLPrimitive.Texture);

      // Vertex 1: Top-Right (74, 20) -> UV (1, 0)
      expect(f32[6]).toBe(74);
      expect(f32[7]).toBe(20);
      expect(f32[8]).toBe(1.0); // UV u
      expect(f32[9]).toBe(0.0); // UV v

      // Vertex 2: Bottom-Right (74, 84) -> UV (1, 1)
      expect(f32[12]).toBe(74);
      expect(f32[13]).toBe(84);
      expect(f32[14]).toBe(1.0); // UV u
      expect(f32[15]).toBe(1.0); // UV v

      // Vertex 3: Bottom-Left (10, 84) -> UV (0, 1)
      expect(f32[18]).toBe(10);
      expect(f32[19]).toBe(84);
      expect(f32[20]).toBe(0.0); // UV u
      expect(f32[21]).toBe(1.0); // UV v
    });

    it('2.2 automatically flushes when switching from Texture A to Texture B', () => {
      const { canvas, calls } = createMockWebGLWithTextures();
      const ctx = new WebGLContext(canvas);
      const batch = new GLBatch(ctx, 32);

      const texA = { id: 101 } as any;
      const texB = { id: 102 } as any;

      batch.begin();
      batch.drawTexture(texA, 0, 0, 32, 32);
      batch.drawTexture(texA, 32, 0, 32, 32);
      expect(batch.quadCount).toBe(2);
      expect(calls.drawElementsCount).toBe(0);

      // Drawing with Texture B forces a flush of Texture A
      batch.drawTexture(texB, 64, 0, 32, 32);
      expect(calls.drawElementsCount).toBe(2 * 6); // 12 indices flushed
      expect(batch.quadCount).toBe(1); // 1 quad in current batch with Tex B

      batch.end();
      expect(calls.drawElementsCount).toBe(3 * 6); // Total 18 indices
    });

    it('2.3 batches rotated textured quads with proper corner transformation', () => {
      const { canvas } = createMockWebGLWithTextures();
      const ctx = new WebGLContext(canvas);
      const batch = new GLBatch(ctx, 16);

      const tex = { id: 103 } as any;
      batch.begin();
      batch.drawRotatedTexture(tex, 100, 100, 40, 40, Math.PI / 4, 1.0);

      expect(batch.quadCount).toBe(1);
      const decoded = GLBatch.decodeParams(batch.vertexDataF32[5]);
      expect(decoded.type).toBe(GLPrimitive.Texture);
    });
  });

  describe('3. FoodRenderer & ArenaBackdrop Stamp Integration', () => {
    it('3.1 provides public FoodRenderer.getStamp returning canvas or null headlessly', () => {
      expect(typeof FoodRenderer.getStamp).toBe('function');
      const stamp = FoodRenderer.getStamp('golden', '#ffb703', true);
      // In headless test env without document.createElement, returns null or mock canvas safely
      expect(stamp === null || typeof stamp === 'object').toBe(true);
    });

    it('3.2 provides ArenaBackdrop.getCanvas returning pre-baked canvas', () => {
      const backdrop = new ArenaBackdrop();
      expect(typeof backdrop.getCanvas).toBe('function');
      const canvas = backdrop.getCanvas(960, 640, 1);
      expect(canvas).toBeDefined();
      expect(canvas.width).toBe(960);
      expect(canvas.height).toBe(640);
    });

    it('3.3 uploads ArenaBackdrop canvas to WebGLTexture seamlessly', () => {
      const { canvas, gl } = createMockWebGLWithTextures();
      const ctx = new WebGLContext(canvas);
      const backdrop = new ArenaBackdrop();

      const bgCanvas = backdrop.getCanvas(800, 600, 2);
      const bgTex = ctx.createTextureFromCanvas(bgCanvas);

      expect(bgTex).toBeDefined();
      expect(gl.createTexture).toHaveBeenCalled();
    });
  });
});
