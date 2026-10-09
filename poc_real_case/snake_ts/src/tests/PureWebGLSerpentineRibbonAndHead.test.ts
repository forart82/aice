import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GLBatch, GLBlendMode } from '../render/webgl/GLBatch';
import { GLPrimitive } from '../render/webgl/WebGLContext';
import { WebGLGameRenderer } from '../render/webgl/WebGLGameRenderer';
import { GameEngine } from '../sim/GameEngine';
import { SnakePlayer, SnakeSegment } from '../sim/SnakePlayer';
import { FxManager } from '../render/FxManager';

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
    UNSIGNED_SHORT: 5123,
    UNSIGNED_INT: 5125,
    UNSIGNED_BYTE: 5121,
    SRC_ALPHA: 770,
    ONE_MINUS_SRC_ALPHA: 771,
    ONE: 1,
    ZERO: 0,
    BLEND: 3042,
  };
}

describe('Pure WebGL Serpentine Ribbon & Head/Eyes Engine', () => {
  let mockGl: any;
  let batch: GLBatch;
  let engine: GameEngine;
  let fx: FxManager;

  beforeEach(() => {
    mockGl = createMockWebGLContext();
    batch = new GLBatch(mockGl);
    engine = new GameEngine({ headless: true });
    fx = new FxManager();
  });

  describe('1. GLBatch drawRotatedQuad UV Coordinates', () => {
    it('generates [-1.0, 1.0] centered UVs for non-texture primitives (Sphere, Ring, Quad)', () => {
      batch.begin(960, 640);
      batch.drawRotatedQuad(100, 100, 40, 30, 0.5, '#00f0b5', 0, GLPrimitive.Sphere);

      expect(batch.quadCount).toBe(1);
      const f32 = batch.vertexDataF32;

      // Vertex 0: Top-Left [-1, -1]
      expect(f32[2]).toBeCloseTo(-1.0);
      expect(f32[3]).toBeCloseTo(-1.0);

      // Vertex 1: Top-Right [1, -1]
      expect(f32[8]).toBeCloseTo(1.0);
      expect(f32[9]).toBeCloseTo(-1.0);

      // Vertex 2: Bottom-Right [1, 1]
      expect(f32[14]).toBeCloseTo(1.0);
      expect(f32[15]).toBeCloseTo(1.0);

      // Vertex 3: Bottom-Left [-1, 1]
      expect(f32[20]).toBeCloseTo(-1.0);
      expect(f32[21]).toBeCloseTo(1.0);
    });

    it('generates [0.0, 1.0] UVs when primitive is GLPrimitive.Texture', () => {
      batch.begin(960, 640);
      batch.drawRotatedQuad(100, 100, 40, 30, 0.5, '#ffffff', 0, GLPrimitive.Texture);

      expect(batch.quadCount).toBe(1);
      const f32 = batch.vertexDataF32;

      // Vertex 0: Top-Left [0, 0]
      expect(f32[2]).toBeCloseTo(0.0);
      expect(f32[3]).toBeCloseTo(0.0);

      // Vertex 1: Top-Right [1, 0]
      expect(f32[8]).toBeCloseTo(1.0);
      expect(f32[9]).toBeCloseTo(0.0);

      // Vertex 2: Bottom-Right [1, 1]
      expect(f32[14]).toBeCloseTo(1.0);
      expect(f32[15]).toBeCloseTo(1.0);

      // Vertex 3: Bottom-Left [0, 1]
      expect(f32[20]).toBeCloseTo(0.0);
      expect(f32[21]).toBeCloseTo(1.0);
    });
  });

  describe('2. GLBatch drawSerpentineMultiPass Complete Serpentine Ribbon', () => {
    it('executes full multi-pass pipeline including tail taper buckets and damage indicators', () => {
      batch.begin(960, 640);
      let totalQuads = 0;
      const originalFlush = batch.flush.bind(batch);
      vi.spyOn(batch, 'flush').mockImplementation(() => {
        totalQuads += batch.quadCount;
        return originalFlush();
      });

      const segments: any[] = [];
      for (let i = 0; i < 20; i++) {
        segments.push({
          x: 200 - i * 10,
          y: 200 + Math.sin(i * 0.3) * 5,
          r: 12,
          angle: 0.1 * i,
          hp: i === 0 ? 5 : i === 2 ? 15 : 25,
          maxHp: 25,
          hitFlash: i === 1 ? 0.9 : 0,
        });
      }

      batch.drawSerpentineMultiPass(
        {
          x: 200,
          y: 200,
          angle: 0,
          headRadius: 14,
          color: '#00f0b5',
          accent: '#10b981',
          segments,
        },
        1.0
      );

      totalQuads += batch.quadCount;

      // Full 7.5-pass pipeline generates significant batched geometry across all passes
      expect(totalQuads).toBeGreaterThan(100);
      expect(batch.vertexCount).toBeGreaterThan(0);
      const flushed = batch.flush();
      expect(flushed).toBeGreaterThan(0);
      expect(batch.quadCount).toBe(0);
    });
  });

  describe('3. WebGLGameRenderer Player Rendering Engine', () => {
    it('renders player snake skull, brow ridge, jaw shadow, eyes, and mouth opening', () => {
      const player = new SnakePlayer('emerald', 960, 640);
      player.x = 300;
      player.y = 300;
      player.angle = 0.5;
      player.mouthOpen = 0.5;
      player.eyeBlinking = false;
      player.headHp = 40;
      player.headMaxHp = 50;

      for (let i = 0; i < 10; i++) {
        player.segments.push(new SnakeSegment(300 - i * 12, 300, 0, 12, 25));
      }
      engine.player = player;

      expect(() => {
        WebGLGameRenderer.render(mockGl, engine, fx);
      }).not.toThrow();
    });

    it('renders cute blinking eyelid slits when player.eyeBlinking is true', () => {
      const player = new SnakePlayer('emerald', 960, 640);
      player.x = 300;
      player.y = 300;
      player.angle = 0.5;
      player.eyeBlinking = true;
      engine.player = player;

      expect(() => {
        WebGLGameRenderer.render(mockGl, engine, fx);
      }).not.toThrow();
    });

    it('renders procedural geometry for all 6 boss helmet archetypes (Colossus, Frostwyrm, Chrono, Gorgon, Centipede, Leviathan)', () => {
      const helmetTypes = [
        { bossType: 'colossus', name: 'Infernal Greathelm' },
        { bossType: 'frostwyrm', name: 'Glacial Crown of Permafrost' },
        { bossType: 'chronowyrm', name: 'Temporal Clockwork Tiara' },
        { bossType: 'gorgon', name: 'Ophidian Cobra Crest' },
        { bossType: 'centipede', name: 'Chitinous Centipede Crown' },
        { bossType: 'leviathan', name: 'Abyssal Horns of the Deep' },
      ];

      for (const h of helmetTypes) {
        const player = new SnakePlayer('stalker', 960, 640);
        player.x = 250;
        player.y = 250;
        player.angle = 0.2;
        player.equippedHelmet = {
          bossType: h.bossType,
          name: h.name,
          rarity: 'mythic',
        } as any;
        engine.player = player;

        expect(() => {
          WebGLGameRenderer.render(mockGl, engine, fx);
        }).not.toThrow();
      }
    });

    it('renders all 5 class crests (emerald, stalker, hydra, storm, solar)', () => {
      const classes = ['emerald', 'stalker', 'hydra', 'storm', 'solar'];
      for (const cls of classes) {
        const player = new SnakePlayer(cls, 960, 640);
        player.x = 200;
        player.y = 200;
        engine.player = player;

        expect(() => {
          WebGLGameRenderer.render(mockGl, engine, fx);
        }).not.toThrow();
      }
    });
  });
});
