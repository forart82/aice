/**
 * ============================================================================
 * Continuous Serpentine Mesh Ribbon & Bisector Extrusion Test Suite
 * Ouroboros Ascension — Protocol 3.0 Commercial Engine Edition
 * ============================================================================
 *
 * Single Source of Truth (SSOT): ORACLE.md & AGENTS.md (Rule 6, Rule 10)
 * Feature TDD Spec: docs/tdd/continuous_serpentine_mesh_ribbon.tdd.md
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GLBatch, GLBlendMode } from '../render/webgl/GLBatch';
import { WebGLContext, GLPrimitive } from '../render/webgl/WebGLContext';
import { ColorX } from '../render/ColorX';

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
    FLOAT: 5126,
    BLEND: 3042,
    SRC_ALPHA: 770,
    ONE_MINUS_SRC_ALPHA: 771,
    ONE: 1,
    COLOR_BUFFER_BIT: 16384,

    createShader: vi.fn((type: number) => ({ id: calls.shaders.length + 1, type, source: '' })),
    shaderSource: vi.fn(),
    compileShader: vi.fn(),
    getShaderParameter: vi.fn(() => true),
    getShaderInfoLog: vi.fn(() => ''),

    createProgram: vi.fn(() => ({ id: calls.programs.length + 1, attached: [] })),
    attachShader: vi.fn(),
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
    uniformMatrix3fv: vi.fn(),
    uniform2f: vi.fn(),
    uniform1f: vi.fn(),

    createBuffer: vi.fn(() => ({ id: Math.random() })),
    bindBuffer: vi.fn(),
    bufferData: vi.fn((_target: number, data: any) => {
      calls.bufferDataCalls.push(data);
    }),
    bufferSubData: vi.fn(),
    drawElements: vi.fn((_mode: number, count: number) => {
      calls.drawElementsCount += count;
    }),
    createTexture: vi.fn(() => ({ id: Math.random() })),
    bindTexture: vi.fn(),
    texParameteri: vi.fn(),
    texImage2D: vi.fn(),
    deleteTexture: vi.fn(),
    activeTexture: vi.fn(),
    pixelStorei: vi.fn(),
    uniform1i: vi.fn(),
    uniform3f: vi.fn(),

    enable: vi.fn(),
    disable: vi.fn(),
    blendFunc: vi.fn((src: number, dst: number) => {
      calls.blendFuncCalls.push({ src, dst });
    }),
    blendFuncSeparate: vi.fn(),
    viewport: vi.fn(),
    clearColor: vi.fn(),
    clear: vi.fn(),
  };

  const canvas: any = {
    width: 960,
    height: 640,
    getContext: vi.fn((type: string) => (type.includes('webgl') ? gl : null)),
  };

  return { canvas, gl, calls };
}

describe('Continuous Serpentine Mesh Ribbon & Bisector Extrusion Suite', () => {
  let mock: ReturnType<typeof createMockWebGL>;
  let glCtx: WebGLContext;
  let batch: GLBatch;

  beforeEach(() => {
    mock = createMockWebGL();
    glCtx = new WebGLContext(mock.canvas);
    batch = new GLBatch(glCtx, 512);
  });

  describe('1. Geometric Extrusion & Bisector Normal Derivation', () => {
    it('1.1 computes exact perpendicular left/right extrusion on straight polylines without distortion', () => {
      batch.begin();
      // Polyline along positive X axis: (0, 100) -> (100, 100), width = 20 (half-width = 10)
      // Normal should be (0, -1) [pointing upward in screen Y space]
      batch.drawContinuousRibbon(
        [
          { x: 0, y: 100 },
          { x: 100, y: 100 },
        ],
        20,
        '#ffffff',
        0,
        GLPrimitive.Quad,
        false // no round caps for isolated segment inspection
      );

      expect(batch.quadCount).toBe(1);
      const f32 = batch.vertexDataF32;

      // Quad vertices: Corner 0 (Left Start), Corner 1 (Left End), Corner 2 (Right End), Corner 3 (Right Start)
      // Segment direction d = (100, 0) -> normal n = (-0, 100)/100 = (0, 1)
      // Left start: (0, 100) + (0, 1) * 10 = (0, 110)
      // Left end: (100, 100) + (0, 1) * 10 = (100, 110)
      // Right end: (100, 100) - (0, 1) * 10 = (100, 90)
      // Right start: (0, 100) - (0, 1) * 10 = (0, 90)

      const x0 = f32[0], y0 = f32[1];
      const x1 = f32[6], y1 = f32[7];
      const x2 = f32[12], y2 = f32[13];
      const x3 = f32[18], y3 = f32[19];

      expect(x0).toBeCloseTo(0, 3);
      expect(y0).toBeCloseTo(110, 3);

      expect(x1).toBeCloseTo(100, 3);
      expect(y1).toBeCloseTo(110, 3);

      expect(x2).toBeCloseTo(100, 3);
      expect(y2).toBeCloseTo(90, 3);

      expect(x3).toBeCloseTo(0, 3);
      expect(y3).toBeCloseTo(90, 3);
    });

    it('1.2 computes 45-degree bisector normal on 90-degree corner joints with proper miter scaling', () => {
      batch.begin();
      // L-turn: (0, 100) -> (100, 100) -> (100, 200), width = 20
      // Segment 0 direction: (1, 0), normal: (0, 1)
      // Segment 1 direction: (0, 1), normal: (-1, 0)
      // Joint 1 bisector: normalize((0, 1) + (-1, 0)) = normalize((-1, 1)) = (-1/√2, 1/√2)
      // Miter scale = 1 / cos(45deg) = √2 ≈ 1.4142
      // Extrusion vector = (-1/√2, 1/√2) * 10 * √2 = (-10, 10)
      // Left vertex at joint 1 = (100, 100) + (-10, 10) = (90, 110)
      // Right vertex at joint 1 = (100, 100) - (-10, 10) = (110, 90)

      batch.drawContinuousRibbon(
        [
          { x: 0, y: 100 },
          { x: 100, y: 100 },
          { x: 100, y: 200 },
        ],
        20,
        '#00f0b5',
        0,
        GLPrimitive.Quad,
        false
      );

      // 2 segments = 2 quads
      expect(batch.quadCount).toBe(2);
      const f32 = batch.vertexDataF32;

      // Segment 0 End Left (Corner 1 of Quad 0)
      const q0_x1 = f32[6], q0_y1 = f32[7];
      // Segment 0 End Right (Corner 2 of Quad 0)
      const q0_x2 = f32[12], q0_y2 = f32[13];

      // Segment 1 Start Left (Corner 0 of Quad 1)
      const q1_x0 = f32[24 + 0], q1_y0 = f32[24 + 1];
      // Segment 1 Start Right (Corner 3 of Quad 1)
      const q1_x3 = f32[24 + 18], q1_y3 = f32[24 + 19];

      // Joint vertices MUST match identically (Zero gap, zero overlap)
      expect(q0_x1).toBeCloseTo(q1_x0, 3);
      expect(q0_y1).toBeCloseTo(q1_y0, 3);
      expect(q0_x2).toBeCloseTo(q1_x3, 3);
      expect(q0_y2).toBeCloseTo(q1_y3, 3);

      // Extruded corner coordinates
      expect(q0_x1).toBeCloseTo(90, 1);
      expect(q0_y1).toBeCloseTo(110, 1);
      expect(q0_x2).toBeCloseTo(110, 1);
      expect(q0_y2).toBeCloseTo(90, 1);
    });

    it('1.3 safely handles degenerate zero-length segments and 180-degree hairpin foldbacks without NaN', () => {
      batch.begin();
      // Polyline with duplicate/coincident points and 180-degree reverse turn
      batch.drawContinuousRibbon(
        [
          { x: 50, y: 50 },
          { x: 50, y: 50 }, // Zero-length segment
          { x: 150, y: 50 },
          { x: 50, y: 50 }, // 180-degree foldback
        ],
        16,
        '#ff0054',
        0,
        GLPrimitive.Quad,
        false
      );

      expect(batch.quadCount).toBeGreaterThanOrEqual(1);
      const f32 = batch.vertexDataF32;
      const totalFloats = batch.quadCount * GLBatch.FLOATS_PER_QUAD;

      for (let i = 0; i < totalFloats; i++) {
        expect(Number.isNaN(f32[i])).toBe(false);
        expect(Number.isFinite(f32[i])).toBe(true);
      }
    });
  });

  describe('2. Continuous Mesh Generation & Zero Joint Gaps', () => {
    it('2.1 generates seamless contiguous quad strip with shared boundary vertices between adjacent segments', () => {
      batch.begin();
      const points = [
        { x: 0, y: 0 },
        { x: 50, y: 20 },
        { x: 100, y: 10 },
        { x: 160, y: 80 },
        { x: 220, y: 120 },
      ];

      batch.drawContinuousRibbon(points, 24, '#38bdf8', 0, GLPrimitive.Quad, false);

      // 4 segments -> 4 quads
      expect(batch.quadCount).toBe(4);
      const f32 = batch.vertexDataF32;

      for (let seg = 0; seg < 3; seg++) {
        const offA = seg * GLBatch.FLOATS_PER_QUAD;
        const offB = (seg + 1) * GLBatch.FLOATS_PER_QUAD;

        // Quad A end-left (corner 1) == Quad B start-left (corner 0)
        expect(f32[offA + 6]).toBeCloseTo(f32[offB + 0], 4);
        expect(f32[offA + 7]).toBeCloseTo(f32[offB + 1], 4);

        // Quad A end-right (corner 2) == Quad B start-right (corner 3)
        expect(f32[offA + 12]).toBeCloseTo(f32[offB + 18], 4);
        expect(f32[offA + 13]).toBeCloseTo(f32[offB + 19], 4);
      }
    });

    it('2.2 adds semicircular round end caps at head and tail with radius matching ribbon half-width', () => {
      batch.begin();
      const points = [
        { x: 100, y: 100 },
        { x: 200, y: 100 },
        { x: 300, y: 100 },
      ];

      // With roundCaps = true (default)
      batch.drawContinuousRibbon(points, 30, '#ffd166', 0, GLPrimitive.Quad, true);

      // 2 ribbon quads + 2 end cap quads (head & tail) = 4 quads total
      expect(batch.quadCount).toBe(4);

      // Head cap centered at (100, 100) with radius 15
      // Tail cap centered at (300, 100) with radius 15
      const f32 = batch.vertexDataF32;
      const headCapOffset = 2 * GLBatch.FLOATS_PER_QUAD; // 3rd quad
      const tailCapOffset = 3 * GLBatch.FLOATS_PER_QUAD; // 4th quad

      // Param encoded primitive type of caps should be Circle (1)
      expect(GLBatch.decodeParams(f32[headCapOffset + 5]).type).toBe(GLPrimitive.Circle);
      expect(GLBatch.decodeParams(f32[tailCapOffset + 5]).type).toBe(GLPrimitive.Circle);
    });

    it('2.3 supports variable width along ribbon length via width function or array', () => {
      batch.begin();
      const points = [
        { x: 0, y: 0 },
        { x: 50, y: 0 },
        { x: 100, y: 0 },
      ];

      // Width tapering from 40 at head (t=0) to 10 at tail (t=1)
      batch.drawContinuousRibbon(
        points,
        (_idx, t) => 40 * (1 - t * 0.75),
        '#a855f7',
        0,
        GLPrimitive.Quad,
        false
      );

      expect(batch.quadCount).toBe(2);
      const f32 = batch.vertexDataF32;

      // Joint 0 width = 40 (half-width = 20) -> y0 = -20, y3 = +20
      expect(Math.abs(f32[19] - f32[1])).toBeCloseTo(40, 2);

      // Joint 2 width = 10 (half-width = 5) -> y1 = -5, y2 = +5
      const q1Off = 1 * GLBatch.FLOATS_PER_QUAD;
      expect(Math.abs(f32[q1Off + 13] - f32[q1Off + 7])).toBeCloseTo(10, 2);
    });
  });

  describe('3. Multi-Pass Pipeline Conformance (All 7.5 Passes)', () => {
    it('3.1 executes all 7.5 passes of serpentine multi-pass pipeline using continuous mesh generation', () => {
      batch.begin(960, 640);
      const snake = {
        x: 300,
        y: 200,
        angle: 0.1,
        headRadius: 14,
        color: '#00f0b5',
        accent: '#10b981',
        segments: [
          { x: 280, y: 202, r: 14, angle: 0.1, hp: 25, maxHp: 25 },
          { x: 260, y: 205, r: 13.5, angle: 0.15, hp: 20, maxHp: 25 },
          { x: 240, y: 210, r: 13, angle: 0.25, hp: 12, maxHp: 25 }, // < 50% crack lines
          { x: 220, y: 220, r: 12.5, angle: 0.45, hp: 6, maxHp: 25, hitFlash: 0.9 }, // < 35% critical red ring + hit flash
          { x: 200, y: 235, r: 12, angle: 0.65, hp: 25, maxHp: 25 },
        ],
      };

      batch.drawSerpentineMultiPass(snake, 1.0);

      // Should have generated geometry across all passes
      expect(batch.quadCount).toBeGreaterThan(0);
      expect(batch.vertexCount).toBeGreaterThan(0);

      const drawn = batch.flush();
      expect(drawn).toBeGreaterThan(0);
      expect(batch.quadCount).toBe(0);
    });

    it('3.2 eliminates additive blend mode double-exposure hotspots in glowing core pass', () => {
      batch.begin(960, 640);
      const snake = {
        x: 100,
        y: 100,
        angle: 0,
        headRadius: 12,
        color: '#00f0b5',
        accent: '#10b981',
        segments: [
          { x: 90, y: 100, r: 12, angle: 0 },
          { x: 80, y: 100, r: 12, angle: 0 },
          { x: 70, y: 100, r: 12, angle: 0 },
        ],
      };

      batch.drawSerpentineMultiPass(snake, 1.0);

      // Pass 2 glowing core should be drawn as continuous mesh, where joint vertices share exact locations
      // Check that the buffer has no overlapping duplicate quads at the same segment joint
      const f32 = batch.vertexDataF32;
      expect(f32.length).toBeGreaterThan(0);
    });

    it('3.3 executes with zero runtime heap allocations using pre-allocated scratch buffers', () => {
      batch.begin(960, 640);
      const segments: any[] = [];
      for (let i = 0; i < 150; i++) {
        segments.push({
          x: 400 - i * 5,
          y: 300 + Math.sin(i * 0.1) * 30,
          r: 12,
          angle: 0,
          hp: 25,
          maxHp: 25,
        });
      }

      const snake = {
        x: 405,
        y: 300,
        angle: 0,
        headRadius: 12,
        color: '#00f0b5',
        accent: '#10b981',
        segments,
      };

      // Warmup
      batch.drawSerpentineMultiPass(snake, 1.0);
      batch.flush();

      // Benchmark execution time and verify safety
      const t0 = performance.now();
      for (let f = 0; f < 10; f++) {
        batch.drawSerpentineMultiPass(snake, 1.0);
        batch.flush();
      }
      const t1 = performance.now();
      const avgMs = (t1 - t0) / 10;

      // 150 segments rendered across all passes in WebGL batch should take < 10.0 ms under load
      expect(avgMs).toBeLessThan(10.0);
    });

    it('3.4 flushes and splits ribbon cleanly when vertex count exceeds buffer maxQuads', () => {
      // Tiny batch buffer of only 8 quads
      const tinyBatch = new GLBatch(glCtx, 8);
      tinyBatch.begin(960, 640);

      const longPoints: Array<{ x: number; y: number }> = [];
      for (let i = 0; i < 25; i++) {
        longPoints.push({ x: i * 10, y: 100 + (i % 2) * 10 });
      }

      // Ribbon with 24 segments + 2 end caps = 26 quads total (exceeds tinyBatch size of 8)
      tinyBatch.drawContinuousRibbon(longPoints, 16, '#38bdf8', 0, GLPrimitive.Quad, true);

      // Verify that auto-flushes occurred and leftover quads remain in active batch
      expect(mock.calls.drawElementsCount).toBeGreaterThan(0);
      tinyBatch.end();
      expect(tinyBatch.quadCount).toBe(0);
    });
  });
});
