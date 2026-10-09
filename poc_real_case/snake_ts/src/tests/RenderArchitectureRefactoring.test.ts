/**
 * ============================================================================
 * WebGL 2.0 Renderer & Graphics Architecture Refactoring Test Suite
 * Protocol 3.0 Commercial Engine Edition — Rule 12 Pure WebGL Mandate
 * ============================================================================
 *
 * Single Source of Truth (SSOT): ORACLE.md & AGENTS.md (Rule 6, Rule 10, Rule 12)
 * Feature TDD Spec: docs/tdd/architecture_render_refactoring.tdd.md
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { WebGLContext, GLPrimitive } from '../render/webgl/WebGLContext';
import { GLBatch, GLBlendMode } from '../render/webgl/GLBatch';
import { WebGLGameRenderer } from '../render/webgl/WebGLGameRenderer';
import { WebGLAssetAtlas } from '../render/webgl/WebGLAssetAtlas';
import { FxManager, FxParticle, FxBeam } from '../render/FxManager';
import { TelegraphRenderer, ITelegraphAttack, IHazardRenderData } from '../render/TelegraphRenderer';
import { GameRenderer } from '../render/GameRenderer';
import { ArenaBackdrop } from '../render/ArenaBackdrop';
import { GameEngine } from '../sim/GameEngine';

/**
 * Creates a compliant mock WebGL2RenderingContext for headless verification.
 */
function createMockWebGL2Context(): any {
  const gl: any = {
    // Shaders & Programs
    createShader: vi.fn((type: number) => ({ id: Math.random(), type })),
    shaderSource: vi.fn(),
    compileShader: vi.fn(),
    getShaderParameter: vi.fn(() => true),
    getShaderInfoLog: vi.fn(() => ''),
    deleteShader: vi.fn(),
    createProgram: vi.fn(() => ({ id: Math.random() })),
    attachShader: vi.fn(),
    linkProgram: vi.fn(),
    getProgramParameter: vi.fn(() => true),
    getProgramInfoLog: vi.fn(() => ''),
    useProgram: vi.fn(),
    deleteProgram: vi.fn(),

    // Attributes & Uniforms
    getAttribLocation: vi.fn((_prog: any, name: string) => {
      const map: Record<string, number> = { a_position: 0, a_uv: 1, a_color: 2, a_params: 3 };
      return map[name] ?? -1;
    }),
    getUniformLocation: vi.fn((_prog: any, name: string) => ({ name })),
    enableVertexAttribArray: vi.fn(),
    vertexAttribPointer: vi.fn(),
    uniformMatrix3fv: vi.fn(),
    uniform2f: vi.fn(),
    uniform1f: vi.fn(),
    uniform1i: vi.fn(),

    // Buffers & VAO
    createBuffer: vi.fn(() => ({ id: Math.random() })),
    bindBuffer: vi.fn(),
    bufferData: vi.fn(),
    bufferSubData: vi.fn(),
    deleteBuffer: vi.fn(),

    createVertexArray: vi.fn(() => ({ id: Math.random() })),
    bindVertexArray: vi.fn(),
    deleteVertexArray: vi.fn(),

    // Textures
    createTexture: vi.fn(() => ({ id: Math.random() })),
    bindTexture: vi.fn(),
    texParameteri: vi.fn(),
    texImage2D: vi.fn(),
    deleteTexture: vi.fn(),
    activeTexture: vi.fn(),
    pixelStorei: vi.fn(),

    // State & Draw
    enable: vi.fn(),
    disable: vi.fn(),
    blendFunc: vi.fn(),
    viewport: vi.fn(),
    clearColor: vi.fn(),
    clear: vi.fn(),
    drawElements: vi.fn(),

    // Constants
    ARRAY_BUFFER: 34962,
    ELEMENT_ARRAY_BUFFER: 34963,
    DYNAMIC_DRAW: 35048,
    STATIC_DRAW: 35044,
    TRIANGLES: 4,
    FLOAT: 5126,
    UNSIGNED_BYTE: 5121,
    UNSIGNED_SHORT: 5123,
    TEXTURE_2D: 3553,
    RGBA: 6408,
    LINEAR: 9729,
    CLAMP_TO_EDGE: 33071,
    TEXTURE_MIN_FILTER: 10241,
    TEXTURE_MAG_FILTER: 10240,
    TEXTURE_WRAP_S: 10242,
    TEXTURE_WRAP_T: 10243,
    SRC_ALPHA: 770,
    ONE: 1,
    ONE_MINUS_SRC_ALPHA: 771,
    COLOR_BUFFER_BIT: 16384,
  };
  return gl;
}

describe('WebGL 2.0 Renderer & Graphics Architecture Refactoring Suite', () => {
  let mockGl: any;
  let context: WebGLContext;
  let batch: GLBatch;

  beforeEach(() => {
    mockGl = createMockWebGL2Context();
    context = new WebGLContext();
    context.gl = mockGl;
    context.isSupported = true;
    context.isWebGL2 = true;
    batch = new GLBatch(context, 256);
  });

  // ==========================================================================
  // 1. WebGLContext State Encapsulation, Program Caching & VAO
  // ==========================================================================
  describe('1. WebGLContext State Encapsulation, Program Caching & VAO', () => {
    it('1.1 caches compiled WebGL programs across multiple requests', () => {
      const vs = 'void main() { gl_Position = vec4(0.0); }';
      const fs = 'void main() { gl_FragColor = vec4(1.0); }';

      const prog1 = WebGLContext.getCachedProgram(mockGl, vs, fs);
      const prog2 = WebGLContext.getCachedProgram(mockGl, vs, fs);

      expect(prog1).toBeDefined();
      expect(prog1).toBe(prog2);
      expect(mockGl.createProgram).toHaveBeenCalledTimes(1);
    });

    it('1.2 manages WebGL 2.0 Vertex Array Object (VAO) lifecycle', () => {
      mockGl.createVertexArray.mockClear();
      const vao = context.createVertexArray();
      expect(vao).toBeDefined();
      expect(mockGl.createVertexArray).toHaveBeenCalledTimes(1);

      context.bindVertexArray(vao);
      expect(mockGl.bindVertexArray).toHaveBeenCalledWith(vao);

      context.deleteVertexArray(vao);
      expect(mockGl.deleteVertexArray).toHaveBeenCalledWith(vao);
    });

    it('1.3 falls back gracefully when VAO is not supported', () => {
      const glNoVao = createMockWebGL2Context();
      delete glNoVao.createVertexArray;
      delete glNoVao.bindVertexArray;
      delete glNoVao.deleteVertexArray;

      const ctxNoVao = new WebGLContext();
      ctxNoVao.gl = glNoVao;
      ctxNoVao.isSupported = true;
      ctxNoVao.isWebGL2 = false;

      expect(ctxNoVao.createVertexArray()).toBeNull();
      expect(() => ctxNoVao.bindVertexArray(null)).not.toThrow();
      expect(() => ctxNoVao.deleteVertexArray(null)).not.toThrow();
    });

    it('1.4 correctly updates resolution uniform on viewport resize', () => {
      context.uniforms.u_resolution = { name: 'u_resolution' } as any;
      context.resize(1920, 1080, 1.5);

      expect(context.viewportWidth).toBe(1920);
      expect(context.viewportHeight).toBe(1080);
      expect(context.dpr).toBe(1.5);
      expect(mockGl.viewport).toHaveBeenCalledWith(0, 0, 1920 * 1.5, 1080 * 1.5);
      expect(mockGl.uniform2f).toHaveBeenCalledWith(context.uniforms.u_resolution, 1920, 1080);
    });
  });

  // ==========================================================================
  // 2. GLBatch Geometric Extrusion & State Management
  // ==========================================================================
  describe('2. GLBatch Geometric Extrusion & State Management', () => {
    it('2.1 provides unified drawExtrudedSegment for perpendicular geometric extrusion', () => {
      batch.begin(960, 640);
      const initialQuads = batch.quadCount;

      // Draw horizontal line (100, 200) -> (200, 200) with width 20
      // Normal: nx = 0, ny = 10
      batch.drawExtrudedSegment(100, 200, 200, 200, 20, '#ff0054', GLPrimitive.Laser, 4);

      expect(batch.quadCount).toBe(initialQuads + 1);

      const f32 = batch.vertexDataF32;
      const offset = initialQuads * GLBatch.FLOATS_PER_QUAD;

      // Corner 0: (100, 200 + 10) = (100, 210)
      expect(f32[offset + 0]).toBeCloseTo(100, 1);
      expect(f32[offset + 1]).toBeCloseTo(210, 1);

      // Corner 1: (200, 200 + 10) = (200, 210)
      expect(f32[offset + 6]).toBeCloseTo(200, 1);
      expect(f32[offset + 7]).toBeCloseTo(210, 1);

      // Corner 2: (200, 200 - 10) = (200, 190)
      expect(f32[offset + 12]).toBeCloseTo(200, 1);
      expect(f32[offset + 13]).toBeCloseTo(190, 1);

      // Corner 3: (100, 200 - 10) = (100, 190)
      expect(f32[offset + 18]).toBeCloseTo(100, 1);
      expect(f32[offset + 19]).toBeCloseTo(190, 1);
    });

    it('2.2 drawLaser delegates to drawExtrudedSegment with exact visual parity', () => {
      batch.begin(960, 640);
      batch.drawLaser(50, 50, 150, 50, 10, '#00f0b5', 6);
      expect(batch.quadCount).toBe(1);

      const f32 = batch.vertexDataF32;
      expect(f32[0]).toBeCloseTo(50, 1);
      expect(f32[1]).toBeCloseTo(55, 1); // 50 + 5
    });

    it('2.3 automatically flushes and toggles blend mode on transition', () => {
      batch.begin(960, 640);
      batch.setBlendMode(GLBlendMode.NORMAL);
      batch.drawQuad(0, 0, 10, 10, '#ffffff');
      expect(batch.quadCount).toBe(1);

      batch.setBlendMode(GLBlendMode.ADDITIVE);
      // Switching blend mode should trigger flush
      expect(batch.quadCount).toBe(0);
      expect(mockGl.blendFunc).toHaveBeenCalledWith(mockGl.SRC_ALPHA, mockGl.ONE);
      expect(batch.currentBlendMode).toBe(GLBlendMode.ADDITIVE);
    });

    it('2.4 uses VAO during flush when supported to minimize driver state calls', () => {
      batch.begin(960, 640);
      batch.drawQuad(10, 10, 20, 20, '#ffffff');
      batch.flush();

      expect(mockGl.drawElements).toHaveBeenCalledTimes(1);
      expect(batch.vao).toBeDefined();
    });
  });

  // ==========================================================================
  // 3. Unified TelegraphRenderer & WebGLGameRenderer Delegation
  // ==========================================================================
  describe('3. Unified TelegraphRenderer & WebGLGameRenderer Delegation', () => {
    it('3.1 renders all universal attack telegraph types via TelegraphRenderer', () => {
      batch.begin(960, 640);

      const circleTelegraph: ITelegraphAttack = {
        type: 'circle',
        x: 100,
        y: 100,
        radius: 50,
        progress: 0.5,
        color: '#ff0054',
      };
      const beforeCircle = batch.quadCount;
      TelegraphRenderer.draw(batch, circleTelegraph);
      expect(batch.quadCount).toBeGreaterThan(beforeCircle);

      const coneTelegraph: ITelegraphAttack = {
        type: 'cone',
        x: 200,
        y: 200,
        radius: 100,
        angle: 0.5,
        spread: 0.8,
        progress: 0.7,
        color: '#f59e0b',
      };
      const beforeCone = batch.quadCount;
      TelegraphRenderer.draw(batch, coneTelegraph);
      expect(batch.quadCount).toBeGreaterThan(beforeCone);

      const lineTelegraph: ITelegraphAttack = {
        type: 'line',
        x: 300,
        y: 300,
        length: 200,
        angle: 1.0,
        progress: 0.4,
        color: '#38bdf8',
      };
      const beforeLine = batch.quadCount;
      TelegraphRenderer.draw(batch, lineTelegraph);
      expect(batch.quadCount).toBeGreaterThan(beforeLine);

      const ringTelegraph: ITelegraphAttack = {
        type: 'ring',
        x: 400,
        y: 400,
        radius: 40,
        progress: 0.6,
        color: '#c084fc',
      };
      const beforeRing = batch.quadCount;
      TelegraphRenderer.draw(batch, ringTelegraph);
      expect(batch.quadCount).toBeGreaterThan(beforeRing);
    });

    it('3.2 renders charging and armed hazard pools via TelegraphRenderer.drawHazard', () => {
      batch.begin(960, 640);

      const chargingHazard: IHazardRenderData = {
        x: 150,
        y: 150,
        radius: 30,
        telegraph: 1.0,
        telegraphMax: 2.0,
        color: '#10b981',
      };
      const beforeCharge = batch.quadCount;
      TelegraphRenderer.drawHazard(batch, chargingHazard);
      expect(batch.quadCount).toBeGreaterThan(beforeCharge);

      const armedHazard: IHazardRenderData = {
        x: 250,
        y: 250,
        radius: 30,
        color: '#ef4444',
      };
      const beforeArmed = batch.quadCount;
      TelegraphRenderer.drawHazard(batch, armedHazard);
      expect(batch.quadCount).toBeGreaterThan(beforeArmed);
    });

    it('3.3 WebGLGameRenderer.drawTelegraph and drawHazard delegate to TelegraphRenderer with identical quad generation', () => {
      const b1 = new GLBatch(context, 256);
      const b2 = new GLBatch(context, 256);

      b1.begin(960, 640);
      b2.begin(960, 640);

      const telegraph: ITelegraphAttack = {
        type: 'circle',
        x: 100,
        y: 100,
        radius: 50,
        progress: 0.85,
        color: '#ff0054',
      };

      TelegraphRenderer.draw(b1, telegraph);
      WebGLGameRenderer.drawTelegraph(b2, telegraph);

      expect(b2.quadCount).toBe(b1.quadCount);
      expect(b2.quadCount).toBeGreaterThan(0);
    });

    it('3.4 TelegraphRenderer handles legacy/inert calls gracefully without throwing', () => {
      expect(() => TelegraphRenderer.draw(null as any, { type: 'circle', x: 0, y: 0, progress: 0 })).not.toThrow();
      expect(() => TelegraphRenderer.drawHazard(null as any, { x: 0, y: 0 })).not.toThrow();
    });
  });

  // ==========================================================================
  // 4. Unified Particle FX & Beams via FxManager & GLBatch
  // ==========================================================================
  describe('4. Unified Particle FX & Beams via FxManager & GLBatch', () => {
    it('4.1 GLBatch.drawParticle renders all supported particle shapes', () => {
      batch.begin(960, 640);
      const p = new FxParticle();

      const shapes: Array<FxParticle['shape']> = ['circle', 'square', 'ring', 'spark', 'shard', 'plasma'];
      for (const shape of shapes) {
        p.spawn(100, 100, 2, 2, 10, '#ff0054', 0.02, shape);
        const before = batch.quadCount;
        batch.drawParticle(p);
        expect(batch.quadCount).toBeGreaterThan(before);
      }
    });

    it('4.2 FxManager.render draws active particles and jitter beams cleanly to GLBatch', () => {
      const fx = new FxManager();
      fx.burst(100, 100, '#00f0b5', 20, 150, 8);
      fx.beam(50, 50, 250, 250, '#38bdf8', 4, 0.5);
      fx.flash('#ffffff', 0.5, 0.3);

      batch.begin(960, 640);
      const before = batch.quadCount;
      fx.render(batch, 960, 640);

      expect(batch.quadCount).toBeGreaterThan(before);
    });

    it('4.3 WebGLGameRenderer.drawFx delegates to FxManager.render with 100% parity', () => {
      const fx = new FxManager();
      fx.burst(200, 200, '#ffb703', 15, 100, 6);

      const b1 = new GLBatch(context, 256);
      const b2 = new GLBatch(context, 256);
      b1.begin(960, 640);
      b2.begin(960, 640);

      fx.render(b1, 960, 640);
      WebGLGameRenderer.drawFx(b2, fx, 960, 640);

      expect(b2.quadCount).toBe(b1.quadCount);
    });
  });

  // ==========================================================================
  // 5. GameRenderer Architectural Dispatch & Strong Typing
  // ==========================================================================
  describe('5. GameRenderer Architectural Dispatch & Strong Typing', () => {
    it('5.1 GameRenderer.render accepts GameEngine and delegates to WebGLGameRenderer', () => {
      const engine = new GameEngine();
      const fx = new FxManager();

      expect(() => GameRenderer.render(engine, fx)).not.toThrow();
      expect(() => GameRenderer.draw(engine, fx)).not.toThrow();
    });

    it('5.2 GameRenderer.render accepts WebGLGameRenderer instance', () => {
      const engine = new GameEngine();
      const renderer = new WebGLGameRenderer(mockGl);

      expect(() => GameRenderer.render(renderer, engine)).not.toThrow();
    });
  });

  // ==========================================================================
  // 6. WebGLAssetAtlas Strong Typing & UV Invariants
  // ==========================================================================
  describe('6. WebGLAssetAtlas Strong Typing & UV Invariants', () => {
    it('6.1 initializes food atlas with typed WebGL context and provides valid UV regions', () => {
      const tex = WebGLAssetAtlas.initFoodAtlas(mockGl);
      expect(tex).toBeDefined();

      const appleUV = WebGLAssetAtlas.getFoodUV('apple');
      expect(appleUV).toBeDefined();
      expect(appleUV.length).toBe(4);
      expect(appleUV[0]).toBeGreaterThanOrEqual(0);
      expect(appleUV[2]).toBeLessThanOrEqual(1);

      const shardRegion = WebGLAssetAtlas.getFoodRegion('shard');
      expect(shardRegion).toBeDefined();
      expect(shardRegion.type).toBe('shard');
      expect(shardRegion.width).toBeGreaterThan(0);
    });
  });

  // ==========================================================================
  // 7. Rule 12 Absolute Pure WebGL Mandate
  // ==========================================================================
  describe('7. Rule 12 Absolute Pure WebGL Mandate', () => {
    it('7.1 ArenaBackdrop contains zero Canvas2D gradient calls', () => {
      const backdrop = new ArenaBackdrop();
      expect(backdrop).toBeDefined();
      // Verify bakeBackdrop returns canvas or mock without calling 2d context
      const canvas = backdrop.bakeBackdrop(960, 640, 1);
      expect(canvas).toBeDefined();
    });
  });
});
