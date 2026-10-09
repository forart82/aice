/**
 * ============================================================================
 * Serpentine Body, Tail Taper & Damage Overlay Parity Test Suite
 * Canvas2D (SnakeRenderer.ts) vs WebGL (GLBatch.ts) Visual Parity
 * ============================================================================
 *
 * Single Source of Truth: ORACLE.md & AGENTS.md (Rule 1, Rule 6, Rule 10)
 * Feature TDD Spec: docs/tdd/serpentine_body_tail_and_damage_overlay_parity.tdd.md
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GLBatch, GLBlendMode } from '../render/webgl/GLBatch';
import { WebGLContext, GLPrimitive } from '../render/webgl/WebGLContext';
import { ColorX } from '../render/ColorX';

function createMockWebGL(): {
  canvas: any;
  gl: any;
  calls: {
    drawElementsCount: number;
    bufferDataCalls: any[];
    blendFuncCalls: any[];
  };
} {
  const calls = {
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

    createShader: vi.fn((type: number) => ({ id: Math.random(), type })),
    shaderSource: vi.fn(),
    compileShader: vi.fn(),
    getShaderParameter: vi.fn(() => true),
    getShaderInfoLog: vi.fn(() => ''),

    createProgram: vi.fn(() => ({ id: Math.random() })),
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

describe('Serpentine Body, Tail Taper & Damage Overlay Parity Suite', () => {
  let mock: ReturnType<typeof createMockWebGL>;
  let glCtx: WebGLContext;
  let batch: GLBatch;

  beforeEach(() => {
    mock = createMockWebGL();
    glCtx = new WebGLContext(mock.canvas);
    batch = new GLBatch(glCtx, 512);
  });

  describe('1. Pass 7.5 Damage Warning Rings Parity', () => {
    it('strokes damaged segment rings in NORMAL blend mode with glow = 0 and exact 1.8px line width', () => {
      batch.begin(960, 640);

      const blendModesWhenRingDrawn: GLBlendMode[] = [];
      const ringCalls: Array<{
        cx: number;
        cy: number;
        radius: number;
        thickness: number;
        color: any;
        glow: number;
      }> = [];

      const originalDrawSdfRing = batch.drawSdfRing.bind(batch);
      vi.spyOn(batch, 'drawSdfRing').mockImplementation((cx, cy, radius, thickness, color, alpha = 1.0, glowRadius = 0) => {
        blendModesWhenRingDrawn.push(batch.currentBlendMode);
        ringCalls.push({ cx, cy, radius, thickness, color, glow: glowRadius });
        return originalDrawSdfRing(cx, cy, radius, thickness, color, alpha, glowRadius);
      });

      const snake = {
        x: 300,
        y: 200,
        angle: 0,
        headRadius: 14,
        color: '#00f0b5',
        accent: '#10b981',
        segments: [
          // Segment 0: 5/25 HP (20% HP -> Critical damage, should be #ef4444)
          { x: 280, y: 200, r: 12, angle: 0, hp: 5, maxHp: 25 },
          // Segment 1: 15/25 HP (60% HP -> Moderate damage, should be #f59e0b)
          { x: 260, y: 200, r: 12, angle: 0, hp: 15, maxHp: 25 },
          // Segment 2: 25/25 HP (100% HP -> Healthy, no warning ring)
          { x: 240, y: 200, r: 12, angle: 0, hp: 25, maxHp: 25 },
        ],
      };

      batch.drawSerpentineMultiPass(snake, 1.0);

      // Verify rings were drawn for damaged segments
      expect(ringCalls.length).toBe(2);

      // All damage warning rings MUST be in NORMAL blend mode (no blinding additive halos)
      for (const mode of blendModesWhenRingDrawn) {
        expect(mode).toBe(GLBlendMode.NORMAL);
      }

      // Ring 0: Critical damage (< 35% HP)
      const critRing = ringCalls.find(r => r.cx === 280)!;
      expect(critRing).toBeDefined();
      expect(critRing.thickness).toBe(1.8);
      expect(critRing.glow).toBe(0); // glow must be 0, not 6
      // Color must be #ef4444 (packed uint32 or hex)
      const expectedCritCol = GLBatch.colorToUint32('#ef4444', 1.0);
      expect(critRing.color).toBe(expectedCritCol);

      // Ring 1: Moderate damage (35% - 99% HP)
      const modRing = ringCalls.find(r => r.cx === 260)!;
      expect(modRing).toBeDefined();
      expect(modRing.thickness).toBe(1.8);
      expect(modRing.glow).toBe(0); // glow must be 0, not 4
      const expectedModCol = GLBatch.colorToUint32('#f59e0b', 1.0);
      expect(modRing.color).toBe(expectedModCol);
    });
  });

  describe('2. Tail Tip Ball Elimination & Sleek Taper Parity', () => {
    it('eliminates massive glowing cyan sphere at tail tip in Pass 2 and keeps tail sleekly tapered', () => {
      batch.begin(960, 640);

      const circleCalls: Array<{
        cx: number;
        cy: number;
        radius: number;
        color: any;
        glow: number;
      }> = [];

      const originalDrawCircle = batch.drawCircle.bind(batch);
      vi.spyOn(batch, 'drawCircle').mockImplementation((cx, cy, radius, color, glow = 0) => {
        circleCalls.push({ cx, cy, radius, color, glow });
        return originalDrawCircle(cx, cy, radius, color, glow);
      });

      const headRadius = 14;
      const snake = {
        x: 300,
        y: 200,
        angle: 0,
        headRadius,
        color: '#00f0b5',
        accent: '#10b981',
        segments: [
          { x: 280, y: 200, r: 12, angle: 0, hp: 25, maxHp: 25 },
          { x: 260, y: 200, r: 12, angle: 0, hp: 25, maxHp: 25 },
          { x: 240, y: 200, r: 11, angle: 0, hp: 25, maxHp: 25 },
          { x: 220, y: 200, r: 10, angle: 0, hp: 25, maxHp: 25 },
          { x: 200, y: 200, r: 9, angle: 0, hp: 25, maxHp: 25 },
          // Tail tip segment at (180, 200)
          { x: 180, y: 200, r: 8, angle: 0, hp: 25, maxHp: 25 },
        ],
      };

      batch.drawSerpentineMultiPass(snake, 1.0);

      // Tail tip coordinate is (180, 200)
      const tailTipCircles = circleCalls.filter(c => Math.abs(c.cx - 180) < 0.1 && Math.abs(c.cy - 200) < 0.1);

      // Pass 2 previously drew a circle at tail tip with radius wTail * 0.5 = 14 * 1.85 * 0.5 = 12.95 and glow = 10!
      // Verify NO giant glowing cyan sphere (radius > 5 or glow >= 10) exists at the tail tip from Pass 2
      const giantTailSpheres = tailTipCircles.filter(c => c.radius > 5 || c.glow >= 10);
      expect(giantTailSpheres.length).toBe(0);

      // Verify the sleek tapered tail tip end cap from Pass 3 terminates at <= 1.5px - 2px with glow = 0
      const pass3TaperCaps = tailTipCircles.filter(c => c.glow === 0);
      expect(pass3TaperCaps.length).toBeGreaterThan(0);
      for (const c of pass3TaperCaps) {
        expect(c.radius).toBeLessThanOrEqual(Math.max(1.5, headRadius * 2 * (1 - 0.9)) * 0.5 + 0.5);
      }
    });

    it('tapers joint discs dynamically and smoothly from t = 0.3 to t = 1.0 along the spine', () => {
      batch.begin(960, 640);

      const circleCalls: Array<{
        cx: number;
        cy: number;
        radius: number;
        color: any;
        glow: number;
      }> = [];

      vi.spyOn(batch, 'drawCircle').mockImplementation((cx, cy, radius, color, glow = 0) => {
        circleCalls.push({ cx, cy, radius, color, glow });
      });

      const headRadius = 14;
      // Create a 10-segment snake: totalPoints = 11 (index 0 to 10)
      const segments: any[] = [];
      for (let i = 0; i < 10; i++) {
        segments.push({
          x: 280 - i * 20,
          y: 200,
          r: 12,
          angle: 0,
          hp: 25,
          maxHp: 25,
        });
      }

      const snake = {
        x: 300,
        y: 200,
        angle: 0,
        headRadius,
        color: '#00f0b5',
        accent: '#10b981',
        segments,
      };

      batch.drawSerpentineMultiPass(snake, 1.0);

      const litCoreCol = GLBatch.colorToUint32('#00f0b5', 1.0);
      const litCoreCircles = circleCalls.filter(c => c.color === litCoreCol);

      // We have circles at joints.
      // Notice: ptX has coordinates 300, 280, 260, 240, 220, 200, 180, 160, 140, 120, 100
      // Check each joint disc radius:
      const jointCircles = [
        litCoreCircles.find(c => c.cx === 300)!, // Joint 0 (head, t=0)
        litCoreCircles.find(c => c.cx === 280)!, // Joint 1 (t=0.1)
        litCoreCircles.find(c => c.cx === 260)!, // Joint 2 (t=0.2)
        litCoreCircles.find(c => c.cx === 240)!, // Joint 3 (t=0.3)
        litCoreCircles.find(c => c.cx === 220)!, // Joint 4 (t=0.4)
        litCoreCircles.find(c => c.cx === 200)!, // Joint 5 (t=0.5)
        litCoreCircles.find(c => c.cx === 180)!, // Joint 6 (t=0.6)
        litCoreCircles.find(c => c.cx === 160)!, // Joint 7 (t=0.7)
        litCoreCircles.find(c => c.cx === 140)!, // Joint 8 (t=0.8)
        litCoreCircles.find(c => c.cx === 120)!, // Joint 9 (t=0.9)
      ];

      const baseLitR = (headRadius * 1.85) * 0.5; // 12.95

      // Joint 0 (t = 0): full body width
      expect(jointCircles[0]!.radius).toBeCloseTo(baseLitR, 2);

      // Joint 3 (t = 3/10 = 0.3): full body width
      expect(jointCircles[3]!.radius).toBeCloseTo(baseLitR, 2);

      // Joint 6 (t = 6/10 = 0.6): progress = 0.3/0.7, taper = 1 - (0.3/0.7)^2 * 0.90 ≈ 0.8347
      const t6 = 0.6;
      const progress6 = (t6 - 0.3) / 0.7;
      const taper6 = 1.0 - progress6 * progress6 * 0.90;
      expect(jointCircles[6]!.radius).toBeCloseTo(baseLitR * taper6, 2);
      expect(jointCircles[6]!.radius).toBeLessThan(baseLitR);

      // Joint 9 (t = 9/10 = 0.9): progress = 0.6/0.7, taper = 1 - (0.6/0.7)^2 * 0.90 ≈ 0.3388
      const t9 = 0.9;
      const progress9 = (t9 - 0.3) / 0.7;
      const taper9 = 1.0 - progress9 * progress9 * 0.90;
      expect(jointCircles[9]!.radius).toBeCloseTo(baseLitR * taper9, 2);
      expect(jointCircles[9]!.radius).toBeLessThan(jointCircles[6]!.radius);

      // Monotonic decay from t = 0.3 to tail
      for (let i = 3; i < 9; i++) {
        expect(jointCircles[i + 1]!.radius).toBeLessThan(jointCircles[i]!.radius);
      }

      // Pass 1 Shell outline joint discs parity (Softened cosmic penumbra)
      const shellCol = GLBatch.colorToUint32(ColorX.rgba(ColorX.shade(snake.color, -0.4), 0.45), 1.0);
      const shellCircles = circleCalls.filter(c => c.color === shellCol);
      const jointShellCircles = [
        shellCircles.find(c => c.cx === 300)!,
        shellCircles.find(c => c.cx === 280)!,
        shellCircles.find(c => c.cx === 260)!,
        shellCircles.find(c => c.cx === 240)!,
        shellCircles.find(c => c.cx === 220)!,
        shellCircles.find(c => c.cx === 200)!,
        shellCircles.find(c => c.cx === 180)!,
        shellCircles.find(c => c.cx === 160)!,
        shellCircles.find(c => c.cx === 140)!,
        shellCircles.find(c => c.cx === 120)!,
      ];
      const baseShellR = (headRadius * 2 + 4) * 0.5; // 16
      expect(jointShellCircles[0]!.radius).toBeCloseTo(baseShellR, 2);
      expect(jointShellCircles[3]!.radius).toBeCloseTo(baseShellR, 2);
      expect(jointShellCircles[6]!.radius).toBeCloseTo(baseShellR * taper6, 2);
      expect(jointShellCircles[9]!.radius).toBeCloseTo(baseShellR * taper9, 2);
    });

    it('preserves standalone round caps on drawContinuousRibbon when roundCaps = true', () => {
      batch.begin(960, 640);
      const points = [
        { x: 100, y: 100 },
        { x: 200, y: 100 },
        { x: 300, y: 100 },
      ];

      batch.drawContinuousRibbon(points, 30, '#ffd166', 0, GLPrimitive.Quad, true);

      // 2 ribbon quads + 2 end caps = 4 quads total
      expect(batch.quadCount).toBe(4);
    });
  });

  describe('3. Pass 2B Vertebrae Carapaces Smoothing Parity', () => {
    it('uses flat GLPrimitive.Circle discs and accent borders instead of 3D shaded spheres for seamless blending', () => {
      batch.begin(960, 640);

      const rotatedQuadCalls: Array<{
        cx: number;
        cy: number;
        w: number;
        h: number;
        angle: number;
        color: any;
        glow: number;
        type: GLPrimitive;
      }> = [];

      const originalDrawRotatedQuad = batch.drawRotatedQuad.bind(batch);
      vi.spyOn(batch, 'drawRotatedQuad').mockImplementation((cx, cy, w, h, angle, color, glow = 0, type = GLPrimitive.Quad) => {
        rotatedQuadCalls.push({ cx, cy, w, h, angle, color, glow, type });
        return originalDrawRotatedQuad(cx, cy, w, h, angle, color, glow, type);
      });

      const headRadius = 14;
      const snake = {
        x: 300,
        y: 200,
        angle: 0,
        headRadius,
        color: '#00f0b5',
        accent: '#10b981',
        segments: [
          { x: 280, y: 200, r: 12, angle: 0, hp: 25, maxHp: 25 },
          { x: 260, y: 200, r: 12, angle: 0, hp: 25, maxHp: 25 },
        ],
      };

      batch.drawSerpentineMultiPass(snake, 1.0);

      // Vertebrae carapaces have dimensions ~ segR * 2.3 x segR * 2.0
      // For segR = 12 * 0.85 = 10.2: w ~ 23.46, h ~ 20.4
      const vertebraeCalls = rotatedQuadCalls.filter(q => q.w > 15 && q.h > 15 && (q.type === GLPrimitive.Sphere || q.type === GLPrimitive.Circle || q.type === GLPrimitive.Ring));

      // Must NOT contain any GLPrimitive.Sphere (which caused 3D shadow lumps and blocky stepping)
      const sphereCarapaces = vertebraeCalls.filter(q => q.type === GLPrimitive.Sphere);
      expect(sphereCarapaces.length).toBe(0);

      // Must contain GLPrimitive.Circle (smooth flat fill in colPacked)
      const circleCarapaces = vertebraeCalls.filter(q => q.type === GLPrimitive.Circle);
      expect(circleCarapaces.length).toBeGreaterThan(0);

      // Must contain GLPrimitive.Ring (accent border in accentPacked)
      const ringBorders = vertebraeCalls.filter(q => q.type === GLPrimitive.Ring);
      expect(ringBorders.length).toBeGreaterThan(0);

      const expectedAccentCol = GLBatch.colorToUint32('#10b981', 0.7);
      expect(ringBorders[0]!.color).toBe(expectedAccentCol);
    });
  });
});
