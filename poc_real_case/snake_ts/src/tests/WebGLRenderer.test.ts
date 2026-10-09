import { describe, it, expect, vi } from 'vitest';
import { WebGLContext, GLPrimitive, ICamera } from '../render/webgl/WebGLContext';
import { GLBatch } from '../render/webgl/GLBatch';

/**
 * Creates a lightweight mock of WebGL2/WebGLRenderingContext to enable
 * headless unit testing of shaders, buffers, uniforms, and draw calls.
 */
function createMockWebGL(): {
  canvas: any;
  gl: any;
  calls: {
    shaders: any[];
    programs: any[];
    uniforms: Map<string, any>;
    drawElementsCount: number;
    bufferDataCalls: any[];
    blendFuncCalls: any[];
  };
} {
  const calls = {
    shaders: [] as any[],
    programs: [] as any[],
    uniforms: new Map<string, any>(),
    drawElementsCount: 0,
    bufferDataCalls: [] as any[],
    blendFuncCalls: [] as any[],
  };

  const gl: any = {
    // GL Constants
    VERTEX_SHADER: 35633,
    FRAGMENT_SHADER: 35632,
    COMPILE_STATUS: 35713,
    LINK_STATUS: 35714,
    ARRAY_BUFFER: 34962,
    ELEMENT_ARRAY_BUFFER: 34963,
    DYNAMIC_DRAW: 35048,
    STATIC_DRAW: 35044,
    TRIANGLES: 4,
    UNSIGNED_SHORT: 5123,
    UNSIGNED_BYTE: 5121,
    FLOAT: 5126,
    BLEND: 3042,
    SRC_ALPHA: 770,
    ONE_MINUS_SRC_ALPHA: 771,
    ONE: 1,
    DST_COLOR: 774,
    COLOR_BUFFER_BIT: 16384,

    // Methods
    createShader: vi.fn((type: number) => {
      const shader = { id: calls.shaders.length + 1, type, source: '' };
      calls.shaders.push(shader);
      return shader;
    }),
    shaderSource: vi.fn((shader: any, source: string) => {
      if (shader) shader.source = source;
    }),
    compileShader: vi.fn(),
    getShaderParameter: vi.fn(() => true),
    getShaderInfoLog: vi.fn(() => ''),

    createProgram: vi.fn(() => {
      const prog = { id: calls.programs.length + 1, attached: [] as any[] };
      calls.programs.push(prog);
      return prog;
    }),
    attachShader: vi.fn((prog: any, shader: any) => {
      if (prog) prog.attached.push(shader);
    }),
    linkProgram: vi.fn(),
    getProgramParameter: vi.fn(() => true),
    getProgramInfoLog: vi.fn(() => ''),
    useProgram: vi.fn(),

    getAttribLocation: vi.fn((_prog: any, name: string) => {
      if (name === 'a_position') return 0;
      if (name === 'a_uv') return 1;
      if (name === 'a_color') return 2;
      if (name === 'a_params') return 3;
      return -1;
    }),
    enableVertexAttribArray: vi.fn(),
    vertexAttribPointer: vi.fn(),

    getUniformLocation: vi.fn((_prog: any, name: string) => ({ name })),
    uniformMatrix3fv: vi.fn((loc: any, _transpose: boolean, val: Float32Array) => {
      if (loc) calls.uniforms.set(loc.name, Array.from(val));
    }),
    uniform2f: vi.fn((loc: any, x: number, y: number) => {
      if (loc) calls.uniforms.set(loc.name, [x, y]);
    }),
    uniform1f: vi.fn((loc: any, x: number) => {
      if (loc) calls.uniforms.set(loc.name, x);
    }),

    createBuffer: vi.fn(() => ({ id: Math.random() })),
    bindBuffer: vi.fn(),
    bufferData: vi.fn((target: number, data: any, usage: number) => {
      calls.bufferDataCalls.push({ target, data, usage });
    }),
    bufferSubData: vi.fn((target: number, offset: number, data: any) => {
      calls.bufferDataCalls.push({ target, offset, data });
    }),

    viewport: vi.fn(),
    clearColor: vi.fn(),
    clear: vi.fn(),
    enable: vi.fn(),
    disable: vi.fn(),
    blendFunc: vi.fn((sfactor: number, dfactor: number) => {
      calls.blendFuncCalls.push({ sfactor, dfactor });
    }),
    drawElements: vi.fn((_mode: number, count: number, _type: number, _offset: number) => {
      calls.drawElementsCount += count;
    }),
    deleteShader: vi.fn(),
    deleteProgram: vi.fn(),
    deleteBuffer: vi.fn(),
  };

  const canvas: any = {
    width: 1200,
    height: 800,
    getContext: vi.fn((type: string, options: any) => {
      if (type === 'webgl2' || type === 'webgl' || type === 'experimental-webgl') {
        canvas._lastOptions = options;
        return gl;
      }
      return null;
    }),
  };

  return { canvas, gl, calls };
}

describe('WebGLContext & GLBatch Architecture Suite', () => {
  describe('1. WebGLContext Headless Resilience & Initialization', () => {
    it('1.1 instantiates safely in headless environment without DOM or Canvas', () => {
      const ctx = new WebGLContext(undefined as any);
      expect(ctx.isSupported).toBe(false);
      expect(ctx.gl).toBeNull();
      expect(ctx.program).toBeNull();

      // Ensure no crash on calling methods headlessly
      expect(() => ctx.clear(0, 0, 0, 1)).not.toThrow();
      expect(() => ctx.resize(800, 600)).not.toThrow();
      expect(() => ctx.setBlendMode('normal')).not.toThrow();
      expect(() => ctx.dispose()).not.toThrow();
    });

    it('1.2 initializes WebGL context with high-performance parameters and compiles shaders', () => {
      const { canvas, gl, calls } = createMockWebGL();
      const ctx = new WebGLContext(canvas);

      expect(ctx.isSupported).toBe(true);
      expect(ctx.gl).toBe(gl);
      expect(canvas.getContext).toHaveBeenCalledWith('webgl2', {
        alpha: false,
        antialias: false,
        powerPreference: 'high-performance',
      });

      // Assert shaders were compiled & program linked
      expect(calls.shaders.length).toBe(2);
      expect(calls.programs.length).toBe(1);

      // Verify Vertex Shader contents
      const vs = calls.shaders.find((s) => s.type === gl.VERTEX_SHADER);
      expect(vs).toBeDefined();
      expect(vs.source).toContain('u_matrix');
      expect(vs.source).toContain('a_position');
      expect(vs.source).toContain('a_uv');
      expect(vs.source).toContain('a_color');
      expect(vs.source).toContain('a_params');

      // Verify Fragment Shader SDF contents
      const fs = calls.shaders.find((s) => s.type === gl.FRAGMENT_SHADER);
      expect(fs).toBeDefined();
      expect(fs.source).toContain('smoothstep');
      expect(fs.source).toContain('length(v_uv)'); // Circle / Ring / Sphere distance
      expect(fs.source).toContain('v_type');
      expect(fs.source).toContain('v_glow');
    });

    it('1.3 sets blend modes correctly on WebGL context', () => {
      const { canvas, gl, calls } = createMockWebGL();
      const ctx = new WebGLContext(canvas);

      ctx.setBlendMode('normal');
      expect(calls.blendFuncCalls[calls.blendFuncCalls.length - 1]).toEqual({
        sfactor: gl.SRC_ALPHA,
        dfactor: gl.ONE_MINUS_SRC_ALPHA,
      });

      ctx.setBlendMode('additive');
      expect(calls.blendFuncCalls[calls.blendFuncCalls.length - 1]).toEqual({
        sfactor: gl.SRC_ALPHA,
        dfactor: gl.ONE,
      });
    });

    it('1.4 computes 2D Camera Projection Matrix with pan, zoom, rotation, and screen shake', () => {
      const mock = createMockWebGL();
      const ctx = new WebGLContext(mock.canvas);

      const camera: ICamera = {
        x: 100,
        y: 200,
        zoom: 2.0,
        rotation: 0.5,
        shakeX: 5,
        shakeY: -3,
      };

      const mat = ctx.computeCameraMatrix(camera, 1200, 800);
      expect(mat).toBeInstanceOf(Float32Array);
      expect(mat.length).toBe(9); // 3x3 matrix

      // Camera center mapped to screen center plus shake
      ctx.setCamera(camera, 1200, 800);
      expect(ctx.currentMatrix).toBeDefined();
    });
  });

  describe('2. GLBatch Dynamic Buffer Layout & Memory Management', () => {
    it('2.1 defines exact float and index layouts per quad (24 floats, 6 indices)', () => {
      expect(GLBatch.FLOATS_PER_VERTEX).toBe(6);
      expect(GLBatch.VERTICES_PER_QUAD).toBe(4);
      expect(GLBatch.FLOATS_PER_QUAD).toBe(24);
      expect(GLBatch.INDICES_PER_QUAD).toBe(6);
    });

    it('2.2 packs colors into 32-bit uint32 integers with little-endian ABGR/RGBA compatibility', () => {
      // Hex: #ff0000 (Red=255, Green=0, Blue=0, Alpha=255)
      const redPacked = GLBatch.colorToUint32('#ff0000');
      // Little-endian packed: byte 0 = R, byte 1 = G, byte 2 = B, byte 3 = A
      expect(redPacked & 0xff).toBe(255); // R
      expect((redPacked >>> 8) & 0xff).toBe(0); // G
      expect((redPacked >>> 16) & 0xff).toBe(0); // B
      expect((redPacked >>> 24) & 0xff).toBe(255); // A

      // RGBA string
      const cyanPacked = GLBatch.colorToUint32('rgba(0, 240, 181, 0.5)');
      expect(cyanPacked & 0xff).toBe(0); // R
      expect((cyanPacked >>> 8) & 0xff).toBe(240); // G
      expect((cyanPacked >>> 16) & 0xff).toBe(181); // B
      expect((cyanPacked >>> 24) & 0xff).toBe(128); // A (0.5 * 255 rounded)
    });

    it('2.3 batches a Quad and populates 24 float32 words accurately', () => {
      const { canvas } = createMockWebGL();
      const glCtx = new WebGLContext(canvas);
      const batch = new GLBatch(glCtx, 16);

      batch.begin();
      batch.drawQuad(10, 20, 100, 50, '#00f0b5', 1.5);

      expect(batch.quadCount).toBe(1);

      // Verify float view buffer contents for 4 vertices
      const f32 = batch.vertexDataF32;
      const u32 = batch.vertexDataU32;

      // Vertex 0: Top-Left (10, 20)
      expect(f32[0]).toBe(10);
      expect(f32[1]).toBe(20);
      expect(f32[2]).toBe(-1.0); // UV u
      expect(f32[3]).toBe(-1.0); // UV v
      expect(u32[4]).toBe(GLBatch.colorToUint32('#00f0b5'));
      const decoded0 = GLBatch.decodeParams(f32[5]);
      expect(decoded0.type).toBe(GLPrimitive.Quad);
      expect(decoded0.glow).toBe(1.5);

      // Vertex 1: Top-Right (110, 20)
      expect(f32[6]).toBe(110);
      expect(f32[7]).toBe(20);
      expect(f32[8]).toBe(1.0); // UV u
      expect(f32[9]).toBe(-1.0); // UV v

      // Vertex 2: Bottom-Right (110, 70)
      expect(f32[12]).toBe(110);
      expect(f32[13]).toBe(70);
      expect(f32[14]).toBe(1.0); // UV u
      expect(f32[15]).toBe(1.0); // UV v

      // Vertex 3: Bottom-Left (10, 70)
      expect(f32[18]).toBe(10);
      expect(f32[19]).toBe(70);
      expect(f32[20]).toBe(-1.0); // UV u
      expect(f32[21]).toBe(1.0); // UV v
    });

    it('2.4 batches Circles, Rings, Spheres, and Lasers with correct primitive IDs', () => {
      const { canvas } = createMockWebGL();
      const glCtx = new WebGLContext(canvas);
      const batch = new GLBatch(glCtx, 64);

      batch.begin();
      // 1. Circle
      batch.drawCircle(100, 100, 25, '#ff3366', 0.5);
      expect(batch.quadCount).toBe(1);
      expect(GLBatch.decodeParams(batch.vertexDataF32[5]).type).toBe(GLPrimitive.Circle);
      expect(GLBatch.decodeParams(batch.vertexDataF32[5]).glow).toBe(0.5);

      // 2. Ring
      batch.drawRing(200, 200, 30, 4, '#ffb703', 1.0);
      expect(batch.quadCount).toBe(2);
      expect(GLBatch.decodeParams(batch.vertexDataF32[24 + 5]).type).toBe(GLPrimitive.Ring);
      expect(GLBatch.decodeParams(batch.vertexDataF32[24 + 5]).glow).toBe(1.0);

      // 3. 3D Specular Sphere
      batch.drawSphere(300, 300, 40, '#00f0b5', 2.0);
      expect(batch.quadCount).toBe(3);
      expect(GLBatch.decodeParams(batch.vertexDataF32[48 + 5]).type).toBe(GLPrimitive.Sphere);
      expect(GLBatch.decodeParams(batch.vertexDataF32[48 + 5]).glow).toBe(2.0);

      // 4. Laser Beam
      batch.drawLaser(0, 0, 100, 100, 12, '#38bdf8', 3.0);
      expect(batch.quadCount).toBe(4);
      expect(GLBatch.decodeParams(batch.vertexDataF32[72 + 5]).type).toBe(GLPrimitive.Laser);
      expect(GLBatch.decodeParams(batch.vertexDataF32[72 + 5]).glow).toBe(3.0);
    });

    it('2.5 draws Rotated Quads with accurate trigonometric vertex placement', () => {
      const { canvas } = createMockWebGL();
      const glCtx = new WebGLContext(canvas);
      const batch = new GLBatch(glCtx, 16);

      batch.begin();
      // Rotated 90 degrees (Math.PI / 2)
      batch.drawRotatedQuad(100, 100, 40, 20, Math.PI / 2, '#ffffff');

      expect(batch.quadCount).toBe(1);
      const f32 = batch.vertexDataF32;
      // Center (100, 100), half-extents w=20, h=10. Rotated by 90deg, local (hx, hy) becomes (-hy, hx)
      expect(Math.round(f32[0])).toBe(110);
      expect(Math.round(f32[1])).toBe(80);
    });

    it('2.6 draws Lines and Polylines seamlessly', () => {
      const { canvas } = createMockWebGL();
      const glCtx = new WebGLContext(canvas);
      const batch = new GLBatch(glCtx, 32);

      batch.begin();
      batch.drawLine(0, 0, 100, 0, 4, '#ff0000');
      expect(batch.quadCount).toBe(1);

      batch.drawPolyline(
        [
          { x: 0, y: 0 },
          { x: 50, y: 50 },
          { x: 100, y: 0 },
        ],
        6,
        '#00ff00'
      );
      // Polyline with 3 points generates 2 line segments = 2 quads
      expect(batch.quadCount).toBe(3);
    });

    it('2.7 automatically flushes when buffer reaches saturation capacity', () => {
      const { canvas, calls } = createMockWebGL();
      const glCtx = new WebGLContext(canvas);
      const maxQuads = 4;
      const batch = new GLBatch(glCtx, maxQuads);

      batch.begin();
      // Add 4 quads (full capacity)
      for (let i = 0; i < 4; i++) {
        batch.drawQuad(i * 10, 0, 10, 10, '#ffffff');
      }
      expect(batch.quadCount).toBe(4);
      expect(calls.drawElementsCount).toBe(0);

      // Adding the 5th quad triggers an automatic flush of the first 4
      batch.drawQuad(50, 0, 10, 10, '#ffffff');
      expect(calls.drawElementsCount).toBe(4 * 6); // 24 indices rendered
      expect(batch.quadCount).toBe(1); // 5th quad in new batch

      batch.end();
      expect(calls.drawElementsCount).toBe(5 * 6); // Total 30 indices rendered
      expect(batch.quadCount).toBe(0);
    });

    it('2.8 flushes automatically upon blend mode change', () => {
      const { canvas, calls } = createMockWebGL();
      const glCtx = new WebGLContext(canvas);
      const batch = new GLBatch(glCtx, 64);

      batch.begin('normal');
      batch.drawQuad(0, 0, 10, 10, '#ffffff');
      batch.drawQuad(10, 0, 10, 10, '#ffffff');
      expect(batch.quadCount).toBe(2);
      expect(calls.drawElementsCount).toBe(0);

      // Switch to additive -> triggers flush of normal quads
      batch.setBlendMode('additive');
      expect(calls.drawElementsCount).toBe(2 * 6);
      expect(batch.quadCount).toBe(0);
      expect(batch.currentBlendMode).toBe('additive');

      batch.drawQuad(20, 0, 10, 10, '#ffffff');
      batch.end();
      expect(calls.drawElementsCount).toBe(3 * 6);
    });

    it('2.9 batches Textured Quads with GLPrimitive.Texture = 5', () => {
      const { canvas } = createMockWebGL();
      const glCtx = new WebGLContext(canvas);
      const batch = new GLBatch(glCtx, 16);

      batch.begin();
      expect(GLPrimitive.Texture).toBe(5);

      batch.drawTexture(10, 20, 100, 100, '#ffffff', 0, [0.0, 0.0], [1.0, 1.0]);
      expect(batch.quadCount).toBe(1);

      const decoded = GLBatch.decodeParams(batch.vertexDataF32[5]);
      expect(decoded.type).toBe(GLPrimitive.Texture);
      expect(decoded.glow).toBe(0);

      const f32 = batch.vertexDataF32;
      // UVs are normalized [0, 1]
      expect(f32[2]).toBe(0.0);
      expect(f32[3]).toBe(0.0);
      expect(f32[8]).toBe(1.0);
      expect(f32[9]).toBe(0.0);
    });

    it('2.10 supports uniform color overrides and texture binding helpers', () => {
      const { canvas, gl, calls } = createMockWebGL();
      const ctx = new WebGLContext(canvas);

      expect(ctx.uniforms.u_texture).toBeDefined();
      expect(ctx.uniforms.u_highlightColor).toBeDefined();
      expect(ctx.uniforms.u_baseColor).toBeDefined();
      expect(ctx.uniforms.u_shadowColor).toBeDefined();

      const mockTexture = { id: 99 };
      gl.activeTexture = vi.fn();
      gl.bindTexture = vi.fn();
      gl.uniform1i = vi.fn();
      gl.uniform3f = vi.fn((loc: any, x: number, y: number, z: number) => {
        if (loc) calls.uniforms.set(loc.name, [x, y, z]);
      });

      ctx.setTexture(mockTexture as any, 0);
      expect(gl.activeTexture).toHaveBeenCalled();
      expect(gl.bindTexture).toHaveBeenCalled();

      ctx.setSphereColors('#ffffff', '#00f0b5', '#04070e');
      expect(gl.uniform3f).toHaveBeenCalledTimes(3);
    });
  });

  describe('3. Upgraded GLSL Shader Mathematics Conformance', () => {
    it('3.1 verifies True Gaussian glow curve and 2D focal radial gradient in fragment shader', () => {
      const { canvas, gl, calls } = createMockWebGL();
      new WebGLContext(canvas);

      const fs = calls.shaders.find((s) => s.type === gl.FRAGMENT_SHADER);
      expect(fs).toBeDefined();

      // 1. True Gaussian glow equation: exp(-(d * d) / (2.0 * sigma * sigma))
      expect(fs.source).toContain('exp(-(d * d) / (2.0 * sigma * sigma))');

      // 2. Exact 2D Focal-Point Radial Gradient matching createSphereGradient
      expect(fs.source).toContain('vec2 focal = vec2(-0.34, -0.38);');
      expect(fs.source).toContain('float dist = length(v_uv - focal);');
      expect(fs.source).toContain('u_highlightColor');
      expect(fs.source).toContain('u_baseColor');
      expect(fs.source).toContain('u_shadowColor');

      // 3. Texture Sampling for GLPrimitive.Texture (5.0)
      expect(fs.source).toContain('u_texture');
      expect(fs.source).toContain('texture2D(u_texture, v_uv) * v_color');

      // Vertex shader delivers v_primitive / v_type
      const vs = calls.shaders.find((s) => s.type === gl.VERTEX_SHADER);
      expect(vs).toBeDefined();
      expect(vs.source).toContain('v_primitive');
    });
  });
});
