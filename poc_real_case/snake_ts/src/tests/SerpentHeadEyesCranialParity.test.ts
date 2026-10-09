import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GLBatch, GLBlendMode } from '../render/webgl/GLBatch';
import { GLPrimitive, WebGLContext } from '../render/webgl/WebGLContext';
import { WebGLGameRenderer } from '../render/webgl/WebGLGameRenderer';
import { GameEngine } from '../sim/GameEngine';
import { SnakePlayer, SnakeSegment } from '../sim/SnakePlayer';
import { FxManager } from '../render/FxManager';
import { SnakeRenderer } from '../render/SnakeRenderer';

function createMockWebGLContext(): any {
  return {
    canvas: { width: 960, height: 640 },
    drawingBufferWidth: 960,
    drawingBufferHeight: 640,
    viewport: () => {},
    clearColor: () => {},
    clear: () => {},
    enable: () => {},
    disable: () => {},
    blendFunc: () => {},
    blendFuncSeparate: () => {},
    blendEquation: () => {},
    createBuffer: () => ({ id: 1 }),
    bindBuffer: () => {},
    bufferData: () => {},
    bufferSubData: () => {},
    createShader: () => ({ id: 2 }),
    shaderSource: () => {},
    compileShader: () => {},
    getShaderParameter: () => true,
    getShaderInfoLog: () => '',
    createProgram: () => ({ id: 3 }),
    attachShader: () => {},
    linkProgram: () => {},
    getProgramParameter: () => true,
    getProgramInfoLog: () => '',
    useProgram: () => {},
    getAttribLocation: () => 0,
    getUniformLocation: (_prog: any, name: string) => ({ name }),
    enableVertexAttribArray: () => {},
    vertexAttribPointer: () => {},
    uniform1f: () => {},
    uniform2f: () => {},
    uniform3f: () => {},
    uniform4f: () => {},
    uniform1i: () => {},
    uniformMatrix3fv: () => {},
    uniformMatrix4fv: () => {},
    createTexture: () => ({ id: 4 }),
    bindTexture: () => {},
    texParameteri: () => {},
    texImage2D: () => {},
    activeTexture: () => {},
    drawArrays: () => {},
    drawElements: () => {},
    TRIANGLES: 4,
    ARRAY_BUFFER: 34962,
    ELEMENT_ARRAY_BUFFER: 34963,
    STATIC_DRAW: 35044,
    DYNAMIC_DRAW: 35048,
    FLOAT: 5126,
    UNSIGNED_BYTE: 5121,
    UNSIGNED_SHORT: 5123,
    COLOR_BUFFER_BIT: 16384,
    DEPTH_BUFFER_BIT: 256,
    BLEND: 3042,
    SRC_ALPHA: 770,
    ONE_MINUS_SRC_ALPHA: 771,
    ONE: 1,
    ZERO: 0,
    DST_COLOR: 774,
  };
}

describe('Serpent Head, Eyes & Cranial Damage Visual Parity (Canvas2D vs WebGL)', () => {
  let mockGl: any;
  let batch: GLBatch;
  let engine: GameEngine;
  let fx: FxManager;

  beforeEach(() => {
    mockGl = createMockWebGLContext();
    batch = new GLBatch(mockGl, 2048);
    engine = new GameEngine();
    (engine as any).isPlaying = true;
    fx = new FxManager();
  });

  describe('1. WebGLContext Sphere Shader Parity', () => {
    it('removes inner rim multiplier formula col.rgb += v_color.rgb * (glow * edgeAlpha) from primType == 3', () => {
      const fragShader = WebGLContext.FRAGMENT_SHADER_SOURCE;
      expect(fragShader).toBeDefined();
      // Must not contain the artificial inner rim blowout formula
      expect(fragShader).not.toContain('glow * edgeAlpha');
      expect(fragShader).not.toContain('col.rgb += v_color.rgb * (glow * edgeAlpha)');
    });
  });

  describe('2. GLBatch.drawSdfArc Capability', () => {
    it('provides drawSdfArc method to stroke smooth partial circular arcs', () => {
      expect(typeof (batch as any).drawSdfArc).toBe('function');
      expect(() => {
        (batch as any).drawSdfArc(150, 150, 30, -Math.PI / 2, Math.PI / 2, 2.5, '#ef4444', 1.0, 0);
      }).not.toThrow();
      expect(batch.vertexCount).toBeGreaterThan(0);
    });
  });

  describe('3. WebGLGameRenderer drawPlayer Parity with Canvas2D', () => {
    it('does NOT render synthetic forehead diamond on Emerald', () => {
      const player = new SnakePlayer('emerald', 960, 640);
      player.x = 200;
      player.y = 200;

      const diamondSpy = vi.spyOn(batch, 'drawSdfDiamond');
      (WebGLGameRenderer as any).drawPlayer(batch, player, fx);
      expect(diamondSpy).not.toHaveBeenCalled();
      diamondSpy.mockRestore();
    });

    it('does NOT render synthetic head crests on Stalker, Storm, or Solar', () => {
      const classes = ['stalker', 'storm', 'solar'];
      for (const cls of classes) {
        const player = new SnakePlayer(cls as any, 960, 640);
        player.x = 200;
        player.y = 200;
        player.angle = 0;
        player.mouthOpen = 0;
        player.segments = [];

        const laserSpy = vi.spyOn(batch, 'drawLaser');
        (WebGLGameRenderer as any).drawPlayer(batch, player, fx);
        // None of these classes should call drawLaser for crests
        expect(laserSpy).not.toHaveBeenCalled();
        laserSpy.mockRestore();
      }
    });

    it('renders Hydra secondary heads matching Canvas2D without dark pupils', () => {
      const player = new SnakePlayer('hydra', 960, 640);
      player.x = 200;
      player.y = 200;
      player.angle = 0;

      const circleSpy = vi.spyOn(batch, 'drawSdfCircle');
      const sphereSpy = vi.spyOn(batch, 'drawSphere');
      (WebGLGameRenderer as any).drawPlayer(batch, player, fx);
      
      // Hydra should draw 2 extra spheres of radius 9
      const hydraCalls = sphereSpy.mock.calls.filter(c => c[2] === 9);
      expect(hydraCalls.length).toBe(2);

      // Hydra secondary heads should NOT have dark pupils (r=2.2)
      const hydraPupils = circleSpy.mock.calls.filter(c => Math.abs(c[2] - 2.2) < 0.01);
      expect(hydraPupils.length).toBe(0);

      sphereSpy.mockRestore();
      circleSpy.mockRestore();
    });

    it('renders cranial damage feedback as a partial arc in NORMAL blend mode without glow', () => {
      const player = new SnakePlayer('emerald', 960, 640);
      player.x = 300;
      player.y = 250;
      player.angle = 1.0;
      player.headHp = 25;
      player.headMaxHp = 50; // 50% HP -> sweep is Tau * 0.5 = PI

      const ringSpy = vi.spyOn(batch, 'drawSdfRing');
      const arcSpy = vi.spyOn(batch as any, 'drawSdfArc');

      (WebGLGameRenderer as any).drawPlayer(batch, player, fx);

      // Should NOT use closed drawSdfRing for cranial damage
      const cranialRingCalls = ringSpy.mock.calls.filter(c => Math.abs(c[2] - player.headRadius * 1.55) < 0.1);
      expect(cranialRingCalls.length).toBe(0);

      // SHOULD call drawSdfArc with exact parameters
      expect(arcSpy).toHaveBeenCalled();
      const arcCall = arcSpy.mock.calls.find((c: any[]) => Math.abs(c[2] - player.headRadius * 1.55) < 0.1);
      expect(arcCall).toBeDefined();
      if (arcCall) {
        expect(arcCall[0]).toBeCloseTo(player.x);
        expect(arcCall[1]).toBeCloseTo(player.y);
        // Start angle: player.angle - Math.PI / 2
        expect(arcCall[3]).toBeCloseTo(player.angle - Math.PI / 2);
        // End angle: startAngle + 0.5 * Tau
        expect(arcCall[4]).toBeCloseTo(player.angle - Math.PI / 2 + 0.5 * Math.PI * 2);
        // Line width: 2.5
        expect(arcCall[5]).toBe(2.5);
        // Glow: 0
        expect(arcCall[8]).toBe(0);
      }

      ringSpy.mockRestore();
      arcSpy.mockRestore();
    });

    it('renders mouth opening with cavity wedge and tongue but without synthetic fangs', () => {
      const player = new SnakePlayer('emerald', 960, 640);
      player.x = 200;
      player.y = 200;
      player.angle = 0;
      player.mouthOpen = 0.5; // > 0.08, which previously triggered fangs
      player.segments = [];

      const laserSpy = vi.spyOn(batch, 'drawLaser');
      const wedgeSpy = vi.spyOn(batch, 'drawSdfWedge');

      (WebGLGameRenderer as any).drawPlayer(batch, player, fx);

      expect(wedgeSpy).toHaveBeenCalled();
      // No fangs should be drawn via drawLaser
      expect(laserSpy).not.toHaveBeenCalled();

      laserSpy.mockRestore();
      wedgeSpy.mockRestore();
    });

    it('renders eyes with sclera r=3.6, pupil r=1.9, and glint r=0.65 in WebGL and Canvas2D', () => {
      const player = new SnakePlayer('emerald', 960, 640);
      player.x = 200;
      player.y = 200;
      player.angle = 0;
      player.eyeBlinking = false;

      const circleSpy = vi.spyOn(batch, 'drawSdfCircle');
      (WebGLGameRenderer as any).drawPlayer(batch, player, fx);

      // Verify WebGL has sclera (r=3.6), pupil (r=1.9), and glint (r=0.65)
      const scleras = circleSpy.mock.calls.filter(c => Math.abs(c[2] - 3.6) < 0.01);
      const pupils = circleSpy.mock.calls.filter(c => Math.abs(c[2] - 1.9) < 0.01);
      const glints = circleSpy.mock.calls.filter(c => Math.abs(c[2] - 0.65) < 0.01);

      expect(scleras.length).toBe(2);
      expect(pupils.length).toBe(2);
      expect(glints.length).toBe(2);

      circleSpy.mockRestore();

      // Rule 12: SnakeRenderer.draw is a suppressed inert stub
      expect(() => SnakeRenderer.draw({} as any, player as any)).not.toThrow();
    });
  });
});
