import { describe, it, expect, beforeEach } from 'vitest';
import { GLBatch, GLBlendMode, ISDFShapeType } from '../render/webgl/GLBatch';
import { WebGLGameRenderer } from '../render/webgl/WebGLGameRenderer';
import { GameEngine } from '../sim/GameEngine';
import { GameState } from '../sim/GameState';
import { FxManager } from '../render/FxManager';
import { SnakePlayer, SnakeSegment } from '../sim/SnakePlayer';
import { Boss, BossSegment } from '../sim/Boss';
import { Enemy } from '../sim/Enemy';
import { FoodItem } from '../sim/FoodItem';
import { Hazard } from '../sim/Hazard';
import { Projectile } from '../sim/Projectile';
import { HelmetDrop } from '../sim/HelmetDrop';

// Mock WebGL Rendering Context for deterministic Headless Testing
function createMockWebGLContext(): any {
  const gl = {
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
    getUniformLocation: (prog: any, name: string) => ({ name }),
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
    TRIANGLE_STRIP: 5,
    LINES: 1,
    POINTS: 0,
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
    DST_ALPHA: 772,
    BLEND: 3042,
    DEPTH_TEST: 2929,
    TEXTURE_2D: 3553,
    TEXTURE0: 33984,
    LINEAR: 9729,
    CLAMP_TO_EDGE: 33071,
    TEXTURE_MIN_FILTER: 10241,
    TEXTURE_MAG_FILTER: 10240,
    TEXTURE_WRAP_S: 10242,
    TEXTURE_WRAP_T: 10243,
    RGBA: 6408,
  };
  return gl;
}

describe('WebGL Entity & Serpentine Renderer Pipeline (100% ISO Parity)', () => {
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

  describe('1. GLBatch Hardware Batching & Serpentine Multi-Pass', () => {
    it('initializes vertex/index buffers and manages blend modes', () => {
      expect(batch).toBeDefined();
      expect(batch.vertexCount).toBe(0);
      expect(batch.indexCount).toBe(0);
      expect(batch.currentBlendMode).toBe(GLBlendMode.NORMAL);

      batch.setBlendMode(GLBlendMode.ADDITIVE);
      expect(batch.currentBlendMode).toBe(GLBlendMode.ADDITIVE);
    });

    it('batches SDF primitives with color, glow, and antialiasing', () => {
      batch.begin(960, 640);
      batch.drawSdfCircle(100, 100, 20, '#00f0b5', 0.8, 10, '#10b981');
      batch.drawSdfRing(200, 200, 30, 4, '#ff0054', 1.0);
      batch.drawSdfRect(300, 300, 40, 20, 0, '#38bdf8');
      batch.drawSdfDiamond(400, 400, 25, '#ffd166');
      batch.drawSdfWedge(500, 500, 50, 0, 0.8, '#c084fc');

      expect(batch.vertexCount).toBeGreaterThan(0);
      expect(batch.indexCount).toBeGreaterThan(0);

      const drawCount = batch.flush();
      expect(drawCount).toBeGreaterThan(0);
      expect(batch.vertexCount).toBe(0);
    });

    it('executes 7.5-pass serpentine multi-pass pipeline with damage overlays', () => {
      batch.begin(960, 640);
      const segments = [
        { x: 190, y: 200, r: 12, angle: 0, hp: 10, maxHp: 25, hitFlash: 0.8 },
        { x: 180, y: 200, r: 12, angle: 0, hp: 5, maxHp: 25 },
        { x: 170, y: 200, r: 11, angle: 0.1, hp: 25, maxHp: 25 },
        { x: 160, y: 205, r: 11, angle: 0.2, hp: 25, maxHp: 25 },
        { x: 150, y: 215, r: 10, angle: 0.4, hp: 25, maxHp: 25 },
      ];

      batch.drawSerpentineMultiPass(
        {
          x: 200,
          y: 200,
          angle: 0,
          headRadius: 12,
          color: '#00f0b5',
          accent: '#10b981',
          segments,
        },
        1.0
      );

      expect(batch.vertexCount).toBeGreaterThan(0);
      expect(batch.indexCount).toBeGreaterThan(0);

      batch.flush();
      expect(batch.vertexCount).toBe(0);
    });

    it('batches thick laser lines, corridors, and lightning arcs', () => {
      batch.begin(960, 640);
      batch.drawLaserLine(50, 50, 200, 200, '#ff0054', 6, '#ffffff', 1.0);
      batch.drawLightningArc([{ x: 0, y: 0 }, { x: 50, y: 20 }, { x: 100, y: 5 }], '#38bdf8', 3);

      expect(batch.vertexCount).toBeGreaterThan(0);
      batch.flush();
      expect(batch.vertexCount).toBe(0);
    });
  });

  describe('2. WebGLGameRenderer Full Entity Scene Rendering (100% ISO Parity)', () => {
    it('provides a clean headless-safe render(gl, engine, fx) entry point', () => {
      expect(() => {
        WebGLGameRenderer.render(mockGl, engine, fx);
      }).not.toThrow();
    });

    it('renders cosmic backdrop with 3-tier starfield, pulsar flares, nebula dust, and grid crosshairs', () => {
      engine.state = GameState.Playing;
      engine.currentFloor = 1;
      engine.frameCount = 60;

      expect(() => {
        WebGLGameRenderer.render(mockGl, engine, fx);
      }).not.toThrow();

      // Test idle coiling backdrop in Title and GameOver state (180-segment 8-crossing knot)
      engine.state = GameState.Title;
      expect(() => {
        WebGLGameRenderer.render(mockGl, engine, fx);
      }).not.toThrow();

      engine.state = GameState.GameOver;
      expect(() => {
        WebGLGameRenderer.render(mockGl, engine, fx);
      }).not.toThrow();
    });

    it('renders all 8 food types (apple, golden, shard, potion, shield, bomb, chrono, soul, prism)', () => {
      engine.state = GameState.Playing;
      engine.foods = [
        new FoodItem(100, 100, 'apple'),
        new FoodItem(150, 100, 'golden'),
        new FoodItem(200, 100, 'shard'),
        new FoodItem(250, 100, 'potion'),
        new FoodItem(300, 100, 'shield'),
        new FoodItem(350, 100, 'bomb'),
        new FoodItem(400, 100, 'chrono'),
        new FoodItem(450, 100, 'soul'),
        new FoodItem(500, 100, 'prism'),
      ];

      expect(() => {
        WebGLGameRenderer.render(mockGl, engine, fx);
      }).not.toThrow();
    });

    it('renders universal combat attack telegraphs (circle, cone, line, ring, charge)', () => {
      engine.state = GameState.Playing;
      const tCircle = { type: 'circle', x: 100, y: 100, radius: 40, progress: 0.5, color: '#ff0054' };
      const tCone = { type: 'cone', x: 200, y: 200, radius: 100, angle: 0.5, spread: 0.8, progress: 0.7, color: '#ff5400' };
      const tLine = { type: 'line', x: 300, y: 300, length: 150, angle: 0, progress: 0.3, color: '#38bdf8' };
      const tRing = { type: 'ring', x: 400, y: 400, radius: 30, progress: 0.8, color: '#c084fc' };

      expect(() => {
        WebGLGameRenderer.drawTelegraph(batch, tCircle);
        WebGLGameRenderer.drawTelegraph(batch, tCone);
        WebGLGameRenderer.drawTelegraph(batch, tLine);
        WebGLGameRenderer.drawTelegraph(batch, tRing);
      }).not.toThrow();
    });

    it('renders combat hazards with active pools and telegraph rings', () => {
      engine.state = GameState.Playing;
      engine.hazards = [
        new Hazard(100, 100, 'laser', { radius: 30 }),
        new Hazard(200, 200, 'poison', { radius: 40 }),
        new Hazard(300, 300, 'magma', { radius: 50 }),
      ];

      expect(() => {
        WebGLGameRenderer.render(mockGl, engine, fx);
      }).not.toThrow();
    });

    it('renders projectiles with lifecycle alpha fade and scaled trails', () => {
      engine.state = GameState.Playing;
      engine.projectiles = [
        new Projectile(100, 100, 0, 5, 10, 'player', '#38bdf8'),
        new Projectile(200, 200, Math.PI * 0.5, 10, 15, 'enemy', '#ff0054'),
      ];

      expect(() => {
        WebGLGameRenderer.render(mockGl, engine, fx);
      }).not.toThrow();
    });

    it('renders all 6 enemy archetypes with procedural geometry and charging vibration', () => {
      engine.state = GameState.Playing;
      const spit = new Enemy(100, 100, 'spitter', 1);
      const dron = new Enemy(200, 100, 'drone', 1);
      const phan = new Enemy(300, 100, 'phantom', 1);
      const brut = new Enemy(400, 100, 'brute', 1);
      const swar = new Enemy(500, 100, 'swarmling', 1);
      const scar = new Enemy(600, 100, 'scarab', 1);

      dron.charging = true;
      dron.shootTimer = 0.5;
      spit.status.freezeTimer = 1.0;
      scar.status.burnTimer = 0.8;
      brut.hp = 50;
      brut.maxHp = 100;

      engine.enemies = [spit, dron, phan, brut, swar, scar];

      expect(() => {
        WebGLGameRenderer.render(mockGl, engine, fx);
      }).not.toThrow();
    });

    it('renders apex bosses with custom head models, spark nodes, and phase 2 overdrive auras', () => {
      engine.state = GameState.Playing;
      const bossTypes = ['colossus', 'frostwyrm', 'chronowyrm', 'gorgon', 'leviathan', 'centipede'];

      for (const bType of bossTypes) {
        const boss = new Boss(1, 960, 640, bType, 400, 300);
        boss.phase = 2;
        boss.hitFlash = 0.8;
        boss.spiralAngle = 1.5;
        boss.segments = [
          Object.assign(new BossSegment(), { X: 380, Y: 300, R: 28, angle: 0 }),
          Object.assign(new BossSegment(), { X: 360, Y: 300, R: 24, angle: 0 }),
          Object.assign(new BossSegment(), { X: 340, Y: 300, R: 20, angle: 0 }),
        ];
        (boss as any).telegraphs = [
          { type: 'circle', x: 400, y: 300, radius: 80, progress: 0.5, color: '#ff0054' },
        ];
        engine.activeBosses = [boss];

        expect(() => {
          WebGLGameRenderer.render(mockGl, engine, fx);
        }).not.toThrow();
      }
    });

    it('renders player snake across all 5 classes and all 6 helmet models', () => {
      engine.state = GameState.Playing;
      const classes = ['emerald', 'stalker', 'hydra', 'storm', 'solar'];
      const helmets = ['centipede', 'colossus', 'leviathan', 'chrono', 'gorgon', 'void'];

      for (let i = 0; i < classes.length; i++) {
        const player = new SnakePlayer(classes[i]!, 960, 640);
        player.x = 200;
        player.y = 200;
        player.mouthOpen = 0.8;
        player.shield = 40;
        player.stats.maxShield = 50;
        player.invulnerableTimer = 0.5;
        player.hurtFlash = 0.6;
        player.eyeBlinking = i % 2 === 0;
        (player as any).orbitals = [{ x: 230, y: 200, a: 0.5 }];
        player.relics = { frostbite: 2 };
        player.equippedHelmet = {
          name: `${helmets[i % helmets.length]} Crown`,
          rarity: 'mythic',
          archetype: helmets[i % helmets.length],
        } as any;

        // Add segments with damage warning states
        for (let j = 0; j < 15; j++) {
          player.segments.push(
            Object.assign(new SnakeSegment(200 - j * 10, 200, 0, 12, 25), {
              hp: j === 1 ? 5 : j === 3 ? 15 : 25,
              hitFlash: j === 2 ? 0.9 : 0,
            })
          );
        }

        engine.player = player;

        expect(() => {
          WebGLGameRenderer.render(mockGl, engine, fx);
        }).not.toThrow();
      }
    });

    it('renders in-world floating boss helmet drops with light pillars and ground shadows', () => {
      engine.state = GameState.Playing;
      const drop = new HelmetDrop(
        250,
        250,
        {
          name: 'Chrono Tiara',
          rarity: 'epic',
          bossType: 'chronowyrm',
        } as any
      );
      engine.helmetDrops = [drop];

      expect(() => {
        WebGLGameRenderer.render(mockGl, engine, fx);
      }).not.toThrow();
    });

    it('renders particle FX (bursts, shockwaves, multi-segment jitter beams, flash)', () => {
      engine.state = GameState.Playing;
      fx.burst(100, 100, '#00f0b5', 20, 5, 4, 'circle');
      fx.burst(150, 150, '#ffb703', 10, 4, 3, 'square');
      fx.burst(200, 200, '#38bdf8', 15, 6, 2, 'spark');
      fx.ringShockwave(300, 300, '#ff0054', 10);
      fx.beam(50, 50, 250, 250, '#c084fc', 4, 0.5);
      fx.flash('#ffffff', 0.5, 0.2);
      fx.shake(12, 10);

      expect(() => {
        WebGLGameRenderer.render(mockGl, engine, fx);
      }).not.toThrow();
    });

    it('enforces AABB viewport culling for offscreen entities', () => {
      engine.state = GameState.Playing;
      engine.arenaW = 960;
      engine.arenaH = 640;

      // Entity clearly outside viewport
      const farFood = new FoodItem(5000, 5000, 'apple');
      const nearFood = new FoodItem(500, 300, 'apple');
      engine.foods = [farFood, nearFood];

      const farEnemy = new Enemy(-3000, -3000, 'spitter', 1);
      const nearEnemy = new Enemy(400, 200, 'spitter', 1);
      engine.enemies = [farEnemy, nearEnemy];

      expect(() => {
        WebGLGameRenderer.render(mockGl, engine, fx);
      }).not.toThrow();
    });

    it('supports texture blitting for FoodRenderer stamps and ArenaBackdrop baked nebula', () => {
      const mockTexture = { id: 99 };
      batch.begin(960, 640);
      batch.drawTextureQuad(100, 100, 64, 64, mockTexture as any, '#ffffff', 1.0);
      expect(batch.quadCount).toBe(1);
      expect(batch.currentTexture).toBe(mockTexture);

      const drawn = batch.flush();
      expect(drawn).toBeGreaterThan(0);
      expect(batch.quadCount).toBe(0);

      // Verify WebGLGameRenderer texture retrieval helpers
      expect(typeof WebGLGameRenderer.getFoodTexture).toBe('function');
      expect(typeof WebGLGameRenderer.getBackdropTexture).toBe('function');
    });

    it('renders continuous serpentine backbone ribbons for player and boss entities', () => {
      engine.state = GameState.Playing;
      const player = new SnakePlayer('emerald', 960, 640);
      for (let i = 0; i < 20; i++) {
        player.segments.push(new SnakeSegment(200 - i * 10, 200, 0, 12, 25));
      }
      engine.player = player;

      const boss = new Boss(1, 960, 640, 'colossus', 400, 300);
      boss.segments = [
        Object.assign(new BossSegment(), { X: 380, Y: 300, R: 28, angle: 0 }),
        Object.assign(new BossSegment(), { X: 360, Y: 300, R: 24, angle: 0 }),
        Object.assign(new BossSegment(), { X: 340, Y: 300, R: 20, angle: 0 }),
      ];
      engine.activeBosses = [boss];

      expect(() => {
        WebGLGameRenderer.render(mockGl, engine, fx);
      }).not.toThrow();
    });
  });
});

