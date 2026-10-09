/**
 * WebGL Visual Polish & Serpentine Restoration Test Suite
 *
 * Feature TDD Spec: docs/tdd/webgl_visual_polish_and_restoration.tdd.md
 * Rule Reference: AGENTS.md Rule 1, 2, 3, 6, 10, 12
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OuroborosMenuAnimation } from '../render/OuroborosMenuAnimation';
import { WebGLContext, GLPrimitive } from '../render/webgl/WebGLContext';
import { GLBatch, GLBlendMode } from '../render/webgl/GLBatch';
import { FxManager } from '../render/FxManager';
import { CombatSystem } from '../sim/CombatSystem';
import { Enemy } from '../sim/Enemy';
import { SnakePlayer } from '../sim/SnakePlayer';
import { GameEngine } from '../sim/GameEngine';
import { GameData } from '../data/GameData';
import { Services } from '../core/Services.js';
import { WebGLGameRenderer } from '../render/webgl/WebGLGameRenderer';
import { GameState } from '../sim/GameState';
import { FoodItem } from '../sim/FoodItem';
import { HelmetDrop } from '../sim/HelmetDrop';
import { Projectile } from '../sim/Projectile';
import { Boss } from '../sim/Boss';
import { Hazard } from '../sim/Hazard';
import { MathX } from '../core/MathX';
import { WebGLAssetAtlas } from '../render/webgl/WebGLAssetAtlas';
import { HudView } from '../ui/HudView';
import { setupMockDom } from './MockDom';

// Mock WebGL Rendering Context for deterministic Headless Testing
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
  };
}

describe('WebGL Visual Polish & Serpentine Restoration Suite', () => {

  describe('1. Main Menu Ouroboros Restoration & Head/Tail Architecture', () => {
    it('1.1 computes uniform continuous segment radii across all 180 segments with 3D perspective', () => {
      const anim = new OuroborosMenuAnimation();
      anim.update(100, 1280, 720);

      const head = anim.getHeadPosition();
      const tail = anim.getTailPosition();
      const segs = anim.segments;

      expect(segs.length).toBe(180);

      // In Iteration 3 (Headless & Tailless continuous loop), all segments have uniform base radius 32px * (1 + 0.18*z)
      for (let i = 0; i < segs.length; i++) {
        const seg = segs[i]!;
        const expectedR = 32.0 * (1.0 + seg.z * 0.18);
        expect(seg.radius).toBeCloseTo(expectedR, 1);
        expect(seg.radius).toBeGreaterThan(20);
        expect(seg.radius).toBeLessThan(40);
      }

      // Continuous loop closure: head (seg 0) and tail (seg 179) meet within 30px
      const dist = Math.hypot(head.x - tail.x, head.y - tail.y);
      expect(dist).toBeLessThanOrEqual(30);
    });

    it('1.2 renders uniform volumetric scute loop in drawGL without head overlays', () => {
      const anim = new OuroborosMenuAnimation();
      const batch = new GLBatch(null as any);

      const polygonCalls: any[] = [];
      const polylineCalls: any[] = [];

      batch.drawPolygon = (pts, col) => {
        polygonCalls.push({ pts, col });
      };
      batch.drawPolyline = (pts, w, col) => {
        polylineCalls.push({ pts, w, col });
      };
      batch.drawContinuousRibbon = () => {};

      anim.drawGL(batch, 1280, 720, 120);

      // 180 scutes * (baseHex + midHex + innerHex + ridge) polygons
      expect(polygonCalls.length).toBeGreaterThanOrEqual(180 * 3);
      // 180 scute perimeter polylines
      expect(polylineCalls.length).toBeGreaterThanOrEqual(180);
    });
  });

  describe('2. Sleek Serpentine Tail Taper & Joint Continuity', () => {
    it('2.1 applies monotonic quadratic taper to joint circles and eliminates penultimate ball', () => {
      const batch = new GLBatch(null as any);
      const circleCalls: Array<{ cx: number; cy: number; radius: number; glow: number }> = [];

      batch.drawCircle = (cx, cy, radius, _color, glow) => {
        circleCalls.push({ cx, cy, radius, glow: glow || 0 });
      };
      batch.drawLaserLine = () => {};
      batch.drawPolygon = () => {};
      batch.drawPolyline = () => {};

      // Build 10-segment test snake
      const headR = 14;
      const baseLitR = headR * 1.85 * 0.5; // 12.95
      const segments: Array<{ x: number; y: number; angle: number; r: number }> = [];
      for (let i = 0; i < 10; i++) {
        segments.push({
          x: 100 + i * 10,
          y: 200,
          angle: 0,
          r: 11 * (1 - (i / 10) * 0.4)
        });
      }

      batch.drawSerpentineMultiPass({
        x: 100,
        y: 200,
        angle: 0,
        headRadius: headR,
        color: '#00f0b5',
        accent: '#10b981',
        segments
      }, 1.0);

      // Verify joint discs taper monotonically from segment 3 (t = 0.30) to segment 8 (penultimate)
      const litCoreDiscs = circleCalls.filter(c => c.radius <= baseLitR * 1.05 && c.radius >= 2.0);
      expect(litCoreDiscs.length).toBeGreaterThanOrEqual(8);

      // Segments past t=0.3 must be strictly smaller than baseLitR
      const penultimateDisc = litCoreDiscs[litCoreDiscs.length - 1]!;
      expect(penultimateDisc.radius).toBeLessThan(baseLitR * 0.6); // Must be under 60% of base radius

      // Terminal end-cap must be sleek (<= 2.0px)
      const smallCaps = circleCalls.filter(c => c.radius <= 2.5);
      expect(smallCaps.length).toBeGreaterThan(0);
    });

    it('2.2 adds an additive glowing cybernetic stinger micro-node at the tail tip', () => {
      const batch = new GLBatch(null as any);
      const blendModes: GLBlendMode[] = [];
      const circles: Array<{ cx: number; cy: number; radius: number; glow: number }> = [];

      batch.setBlendMode = (mode) => {
        blendModes.push(mode);
      };
      batch.drawCircle = (cx, cy, radius, _color, glow) => {
        circles.push({ cx, cy, radius, glow: glow || 0 });
      };
      batch.drawLaserLine = () => {};
      batch.drawPolygon = () => {};
      batch.drawPolyline = () => {};

      const segments = [
        { x: 100, y: 100, angle: 0, r: 10 },
        { x: 120, y: 100, angle: 0, r: 9 },
        { x: 140, y: 100, angle: 0, r: 8 },
        { x: 160, y: 100, angle: 0, r: 7 }
      ];

      batch.drawSerpentineMultiPass({
        x: 100,
        y: 100,
        angle: 0,
        headRadius: 12,
        color: '#00f0b5',
        accent: '#10b981',
        segments
      }, 1.0);

      // Tail tip micro-node rendered with glow
      const tailTipNode = circles.find(c => c.cx === 160 && c.radius <= 3.5 && c.glow > 0);
      expect(tailTipNode).toBeDefined();
    });
  });

  describe('3. Fragment Shader Alpha Blending & Silhouette/Halo Elimination', () => {
    it('3.1 eliminates double-alpha multiplication in fragment shader source', () => {
      const fsSource = WebGLContext.FRAGMENT_SHADER_SOURCE;

      // In primitive 1 (Circle), color should NOT be multiplied by alpha before assignment:
      // Must NOT be: vec4 col = v_color * alpha; gl_FragColor = col;
      // Must be unmultiplied: vec4 col = vec4(v_color.rgb, v_color.a * alpha);
      expect(fsSource).toContain('vec4 col = vec4(v_color.rgb, v_color.a * alpha);');

      // In primitive 6 (Nebula), output must not multiply RGB by totalAlpha twice
      expect(fsSource).toContain('gl_FragColor = vec4(nebulaColor, totalAlpha);');
    });

    it('3.2 recalibrates Sphere shadow stop to prevent pitch-black 62% crescent', () => {
      const fsSource = WebGLContext.FRAGMENT_SHADER_SOURCE;

      // Must NOT have mix(v_color.rgb, vec3(4.0 / 255.0, 7.0 / 255.0, 14.0 / 255.0), 0.62)
      expect(fsSource).not.toContain('0.62);');
      // Must have softer ambient occlusion stop (e.g. 0.28)
      expect(fsSource).toContain('0.28);');
    });
  });

  describe('4. High-Impact Cosmic Explosions & Particle Orchestration', () => {
    it('4.1 FxManager.explosion spawns multi-stage components: core flash, shockwave ring, sparks, and smoke', () => {
      const fx = new FxManager();
      fx.explosion(200, 200, '#ff0054', 30, 1.2);

      const active = fx.particles.filter(p => p.active);
      expect(active.length).toBeGreaterThanOrEqual(15);

      // Check for ring shockwave
      const rings = active.filter(p => p.shape === 'ring');
      expect(rings.length).toBeGreaterThanOrEqual(1);

      // Check for sparks
      const sparks = active.filter(p => p.shape === 'spark');
      expect(sparks.length).toBeGreaterThanOrEqual(4);

      // Check for smoke / plasma with growth
      const smoke = active.filter(p => (p as any).growthRate !== undefined && (p as any).growthRate > 0);
      expect(smoke.length).toBeGreaterThanOrEqual(2);
    });

    it('4.2 CombatSystem invokes Services.fx.explosion on enemy kill', () => {
      let explosionCalled = false;
      let explosionX = 0;
      let explosionY = 0;

      const mockFx: any = {
        shake: () => {},
        flash: () => {},
        explosion: (x: number, y: number) => {
          explosionCalled = true;
          explosionX = x;
          explosionY = y;
        },
        burst: () => {},
        ringShockwave: () => {}
      };
      Services.fx = mockFx;

      const enemy = new Enemy(350, 450, 'spitter', 1);
      enemy.hp = 0;

      const player = new SnakePlayer('emerald');
      const mockWorld: any = { player, foods: [] };
      const combat = new CombatSystem();

      // Trigger enemy kill resolution
      combat.handleEnemyKill(enemy, mockWorld);

      expect(explosionCalled).toBe(true);
      expect(explosionX).toBe(350);
      expect(explosionY).toBe(450);
    });
  });

  describe('5. Render Pass Sequence & Full Gameplay Pipeline (Backdrop -> Foods -> Helmets -> Projectiles -> Enemies -> Bosses -> Player -> FX -> HUD)', () => {
    let mockGl: any;
    let engine: GameEngine;
    let fx: FxManager;

    beforeEach(() => {
      mockGl = createMockWebGLContext();
      fx = new FxManager();
      engine = new GameEngine(fx);
    });

    it('5.1 executes the strict render pass sequence: Backdrop -> Hazards -> Foods -> Helmets -> Projectiles -> Enemies -> Bosses -> Player -> FX', () => {
      engine.state = GameState.Playing;
      engine.currentFloor = 1;
      engine.frameCount = 60;

      // Populate world with entities of each type
      engine.hazards = [new Hazard(100, 100, 'spike', { radius: 30 })];
      engine.foods = [new FoodItem(150, 150, 'apple')];
      engine.helmetDrops = [new HelmetDrop(200, 200, { Id: 'gorgon', Name: 'Gorgon Helm', Rarity: 'rare' } as any)];
      engine.projectiles = [new Projectile(250, 250, 0, 100, 10, 'player')];
      engine.enemies = [new Enemy(300, 300, 'spitter', 1)];
      engine.boss = new Boss(1, 960, 640, 'colossus', 500, 500);
      engine.player = new SnakePlayer('emerald');
      engine.player.x = 400;
      engine.player.y = 400;

      const callOrder: string[] = [];

      const origDrawBackdrop = (WebGLGameRenderer as any).drawBackdrop;
      const origDrawHazard = (WebGLGameRenderer as any).drawHazard;
      const origDrawFood = (WebGLGameRenderer as any).drawFood;
      const origDrawHelmetDrop = (WebGLGameRenderer as any).drawHelmetDrop;
      const origDrawProjectile = (WebGLGameRenderer as any).drawProjectile;
      const origDrawEnemy = (WebGLGameRenderer as any).drawEnemy;
      const origDrawBoss = (WebGLGameRenderer as any).drawBoss;
      const origDrawPlayer = (WebGLGameRenderer as any).drawPlayer;
      const origDrawFx = (WebGLGameRenderer as any).drawFx;

      (WebGLGameRenderer as any).drawBackdrop = (...args: any[]) => {
        callOrder.push('drawBackdrop');
        return origDrawBackdrop.apply(WebGLGameRenderer, args);
      };
      (WebGLGameRenderer as any).drawHazard = (...args: any[]) => {
        callOrder.push('drawHazard');
        return origDrawHazard.apply(WebGLGameRenderer, args);
      };
      (WebGLGameRenderer as any).drawFood = (...args: any[]) => {
        callOrder.push('drawFood');
        return origDrawFood.apply(WebGLGameRenderer, args);
      };
      (WebGLGameRenderer as any).drawHelmetDrop = (...args: any[]) => {
        callOrder.push('drawHelmetDrop');
        return origDrawHelmetDrop.apply(WebGLGameRenderer, args);
      };
      (WebGLGameRenderer as any).drawProjectile = (...args: any[]) => {
        callOrder.push('drawProjectile');
        return origDrawProjectile.apply(WebGLGameRenderer, args);
      };
      (WebGLGameRenderer as any).drawEnemy = (...args: any[]) => {
        callOrder.push('drawEnemy');
        return origDrawEnemy.apply(WebGLGameRenderer, args);
      };
      (WebGLGameRenderer as any).drawBoss = (...args: any[]) => {
        callOrder.push('drawBoss');
        return origDrawBoss.apply(WebGLGameRenderer, args);
      };
      (WebGLGameRenderer as any).drawPlayer = (...args: any[]) => {
        callOrder.push('drawPlayer');
        return origDrawPlayer.apply(WebGLGameRenderer, args);
      };
      (WebGLGameRenderer as any).drawFx = (...args: any[]) => {
        callOrder.push('drawFx');
        return origDrawFx.apply(WebGLGameRenderer, args);
      };

      try {
        WebGLGameRenderer.render(mockGl, engine, fx);

        expect(callOrder).toEqual([
          'drawBackdrop',
          'drawHazard',
          'drawFood',
          'drawHelmetDrop',
          'drawProjectile',
          'drawEnemy',
          'drawBoss',
          'drawPlayer',
          'drawFx',
        ]);
      } finally {
        (WebGLGameRenderer as any).drawBackdrop = origDrawBackdrop;
        (WebGLGameRenderer as any).drawHazard = origDrawHazard;
        (WebGLGameRenderer as any).drawFood = origDrawFood;
        (WebGLGameRenderer as any).drawHelmetDrop = origDrawHelmetDrop;
        (WebGLGameRenderer as any).drawProjectile = origDrawProjectile;
        (WebGLGameRenderer as any).drawEnemy = origDrawEnemy;
        (WebGLGameRenderer as any).drawBoss = origDrawBoss;
        (WebGLGameRenderer as any).drawPlayer = origDrawPlayer;
        (WebGLGameRenderer as any).drawFx = origDrawFx;
      }
    });

    it('5.2 validates that Idle / Title screens route exclusively through OuroborosMenuAnimation.drawGL', () => {
      engine.state = GameState.Title;
      engine.foods = [new FoodItem(150, 150, 'apple')];
      engine.enemies = [new Enemy(300, 300, 'spitter', 1)];

      let drawGLCalled = false;
      let drawFoodCalled = false;
      let drawEnemyCalled = false;

      const origDrawGL = OuroborosMenuAnimation.prototype.drawGL;
      const origDrawFood = (WebGLGameRenderer as any).drawFood;
      const origDrawEnemy = (WebGLGameRenderer as any).drawEnemy;

      OuroborosMenuAnimation.prototype.drawGL = function (...args: any[]) {
        drawGLCalled = true;
        return (origDrawGL as any).apply(this, args);
      };
      (WebGLGameRenderer as any).drawFood = (...args: any[]) => {
        drawFoodCalled = true;
        return origDrawFood.apply(WebGLGameRenderer, args);
      };
      (WebGLGameRenderer as any).drawEnemy = (...args: any[]) => {
        drawEnemyCalled = true;
        return origDrawEnemy.apply(WebGLGameRenderer, args);
      };

      try {
        WebGLGameRenderer.render(mockGl, engine, fx);

        expect(drawGLCalled).toBe(true);
        expect(drawFoodCalled).toBe(false);
        expect(drawEnemyCalled).toBe(false);
      } finally {
        OuroborosMenuAnimation.prototype.drawGL = origDrawGL;
        (WebGLGameRenderer as any).drawFood = origDrawFood;
        (WebGLGameRenderer as any).drawEnemy = origDrawEnemy;
      }
    });

    it('5.3 enforces viewport culling bounds ([-60, w + 60], [-60, h + 60]) for gameplay entities', () => {
      engine.state = GameState.Playing;
      // In-bounds entity at (100, 100), out-of-bounds at (2000, 2000) and (-200, -200)
      engine.foods = [
        new FoodItem(100, 100, 'apple'),
        new FoodItem(2000, 2000, 'apple'),
        new FoodItem(-200, -200, 'golden'),
      ];

      const culledFoods: FoodItem[] = [];
      const origDrawFood = (WebGLGameRenderer as any).drawFood;
      (WebGLGameRenderer as any).drawFood = (_batch: any, f: FoodItem, _pulse: number) => {
        culledFoods.push(f);
        return origDrawFood.apply(WebGLGameRenderer, [_batch, f, _pulse]);
      };

      try {
        WebGLGameRenderer.render(mockGl, engine, fx);
        expect(culledFoods.length).toBe(1);
        expect(culledFoods[0]!.x).toBe(100);
      } finally {
        (WebGLGameRenderer as any).drawFood = origDrawFood;
      }
    });

    it('5.4 verifies ambient neon under-glow halo rendering for enemies and bosses', () => {
      const batch = new GLBatch(null as any);
      const circleCalls: Array<{ cx: number; cy: number; radius: number; glow: number }> = [];
      const blendModes: GLBlendMode[] = [];

      batch.setBlendMode = (mode: GLBlendMode) => {
        blendModes.push(mode);
      };
      batch.drawCircle = (cx: number, cy: number, radius: number, _color: string, glow: number = 0) => {
        circleCalls.push({ cx, cy, radius, glow });
      };
      batch.drawSdfCircle = (cx: number, cy: number, radius: number, _color: string, _alpha?: number, glow: number = 0) => {
        circleCalls.push({ cx, cy, radius, glow });
      };
      batch.drawPolygon = () => {};
      batch.drawPolyline = () => {};
      batch.drawSphere = () => {};
      batch.drawRotatedQuad = () => {};

      const enemy = new Enemy(200, 300, 'spitter', 1);
      enemy.spawnTimer = 0;
      const enemyR = enemy.radius || 16;
      (WebGLGameRenderer as any).drawEnemy(batch, enemy);

      // Verify no crude saucer disk at r * 1.35
      const enemySaucer = circleCalls.find(c => c.cx === 200 && c.cy === 300 && Math.abs(c.radius - enemyR * 1.35) < 0.1);
      expect(enemySaucer).toBeUndefined();

      // Boss ambient halo at r * 3.4
      const boss = new Boss(1, 960, 640, 'colossus', 500, 400);
      const bossR = boss.Radius || boss.radius || 32;
      (WebGLGameRenderer as any).drawBoss(batch, boss);

      const bossHalo = circleCalls.find(c => c.cx === 500 && c.cy === 400 && Math.abs(c.radius - bossR * 3.4) < 0.1);
      expect(bossHalo).toBeDefined();
    });

    it('5.5 verifies cosmic backdrop starfield clustering along the -32° galactic axis and multi-tier stars', () => {
      const batch = new GLBatch(null as any);
      batch.drawSdfRect = () => {};
      batch.drawRotatedQuad = () => {};
      batch.drawQuad = () => {};
      batch.drawLaser = () => {};
      batch.drawLaserLine = () => {};
      batch.drawSdfRing = () => {};
      batch.drawSdfCircle = () => {};
      batch.drawQuadVertices = () => {};

      // Draw backdrop
      (WebGLGameRenderer as any).drawBackdrop(batch, 960, 640, false, 0, 1);

      const stars = (WebGLGameRenderer as any)._stars;
      const staticStars = (WebGLGameRenderer as any)._staticMicroStars;

      expect(stars).toBeDefined();
      expect(stars.length).toBe(266);

      // Verify star layers: layer 0 (micro), layer 1 (mid), layer 2 (diamond beacons)
      const layer0 = stars.filter((s: any) => s.layer === 0);
      const layer1 = stars.filter((s: any) => s.layer === 1);
      const layer2 = stars.filter((s: any) => s.layer === 2);

      expect(layer0.length).toBe(180);
      expect(layer1.length).toBe(70);
      expect(layer2.length).toBe(16);

      // Verify 140 static micro stars
      expect(staticStars).toBeDefined();
      expect(staticStars.length).toBe(140);
    });
  });

  describe('6. Center Reticle Elimination & Milky Way Subtlety (Iteration 2)', () => {
    it('6.1 eliminates the static center reticle and crosshairs at arena center', () => {
      const batch = new GLBatch(null as any);
      const ringCalls: Array<{ cx: number; cy: number; radius: number }> = [];
      const laserCalls: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];

      batch.drawSdfRect = () => {};
      batch.drawRotatedQuad = () => {};
      batch.drawQuad = () => {};
      batch.drawLaser = (x1, y1, x2, y2) => {
        laserCalls.push({ x1, y1, x2, y2 });
      };
      batch.drawLaserLine = () => {};
      batch.drawSdfRing = (cx, cy, radius) => {
        ringCalls.push({ cx, cy, radius });
      };
      batch.drawSdfCircle = () => {};
      batch.drawQuadVertices = () => {};

      (WebGLGameRenderer as any).drawBackdrop(batch, 1000, 800, false, 0, 3);

      // Dead center (500, 400) must NOT have reticle rings (radius 24 or 12)
      const centerRings = ringCalls.filter(r => r.cx === 500 && r.cy === 400);
      expect(centerRings.length).toBe(0);

      // Dead center must NOT have small 72px crosshair lasers (x1=464 to x2=536)
      const centerLasers = laserCalls.filter(l => 
        (l.y1 === 400 && l.y2 === 400 && Math.abs(l.x2 - l.x1) <= 75) ||
        (l.x1 === 500 && l.x2 === 500 && Math.abs(l.y2 - l.y1) <= 75)
      );
      expect(centerLasers.length).toBe(0);
    });

    it('6.2 draws Milky Way in GLBlendMode.NORMAL to prevent nuclear blowout', () => {
      const batch = new GLBatch(null as any);
      const blendModesUsed: GLBlendMode[] = [];

      batch.setBlendMode = (mode) => {
        blendModesUsed.push(mode);
      };
      batch.drawSdfRect = () => {};
      batch.drawRotatedQuad = () => {};
      batch.drawQuad = () => {};
      batch.drawLaser = () => {};
      batch.drawLaserLine = () => {};
      batch.drawSdfRing = () => {};
      batch.drawSdfCircle = () => {};
      batch.drawQuadVertices = () => {};

      (WebGLGameRenderer as any).drawBackdrop(batch, 1000, 800, false, 0, 1);

      // The nebula passes must be drawn in NORMAL blend mode (like Canvas2D source-over)
      // and NOT in ADDITIVE mode
      expect(blendModesUsed[1]).toBe(GLBlendMode.NORMAL);
    });
  });

  describe('7. Subtractive Food Atlas Halo & Enemy Shading Elimination (Iteration 2)', () => {
    it('7.1 WebGLAssetAtlas enforces zero alpha in the cell border gutter outside max allowed radius', () => {
      const atlasSize = 512;
      const pixels = WebGLAssetAtlas.getProceduralFoodAtlasPixels(atlasSize);
      expect(pixels).toBeDefined();

      // Corner gutter of cell 0 (x=2, y=2) is outside max allowed radius (dist ~87px > maxR ~59px), alpha must be 0
      const idx = (2 * atlasSize + 2) * 4;
      const alphaAtEdge = pixels[idx + 3]!;
      expect(alphaAtEdge).toBe(0);
    });

    it('7.2 drawEnemy eliminates the flat circular saucer disk and uses tinted internal hulls', () => {
      const batch = new GLBatch(null as any);
      const quadCalls: Array<{ w: number; h: number; color: string; prim: GLPrimitive }> = [];
      const circleCalls: Array<{ radius: number; color: string }> = [];

      batch.drawRotatedQuad = (_x, _y, w, h, _a, color, _g, prim) => {
        quadCalls.push({ w, h, color: color as string, prim: prim || GLPrimitive.Quad });
      };
      batch.drawCircle = (_cx, _cy, radius, color) => {
        circleCalls.push({ radius, color: color as string });
      };
      batch.drawPolygon = () => {};
      batch.drawPolyline = () => {};
      batch.drawSphere = () => {};
      batch.drawSdfDiamond = () => {};
      batch.drawSdfRing = () => {};
      batch.drawSdfCircle = () => {};
      batch.drawSdfRect = () => {};

      const enemy = {
        type: 'spitter',
        x: 200,
        y: 200,
        radius: 16,
        angle: 0,
        color: '#c084fc',
        hp: 50,
        maxHp: 50
      };

      (WebGLGameRenderer as any).drawEnemy(batch, enemy);

      // Must NOT draw the crude 1.35 * r circular saucer disk in drawEnemy
      const saucer = circleCalls.find(c => Math.abs(c.radius - 16 * 1.35) < 0.2);
      expect(saucer).toBeUndefined();

      // Internal aperture quads must NOT be pitch-black 'rgba(3, 7, 14, ...)'
      const pitchBlackQuads = quadCalls.filter(q => q.color.includes('3, 7, 14'));
      expect(pitchBlackQuads.length).toBe(0);
    });
  });

  describe('8. High-Octane AAA Arcade Explosions (Iteration 2)', () => {
    it('8.1 explosion spawns tumbling shards and expanding plasma clouds with motion-stretched sparks', () => {
      const fx = new FxManager();
      fx.explosion(400, 300, '#ff0054', 40, 1.5);

      const active = (fx as any).particles.filter((p: any) => p.active);

      // Must spawn tumbling geometric debris shards ('shard') with angular velocity
      const shards = active.filter((p: any) => p.shape === 'shard');
      expect(shards.length).toBeGreaterThanOrEqual(6);
      expect(shards[0]!.vRot).toBeDefined();

      // Must spawn high-velocity sparks with dynamic motion stretch multiplier
      const sparks = active.filter((p: any) => p.shape === 'spark');
      expect(sparks.length).toBeGreaterThanOrEqual(16);
      expect(sparks[0]!.streakMult).toBeGreaterThanOrEqual(6);

      // Must spawn billowing soft plasma clouds ('plasma')
      const plasma = active.filter((p: any) => p.shape === 'plasma');
      expect(plasma.length).toBeGreaterThanOrEqual(6);
      expect(plasma[0]!.growthRate).toBeGreaterThan(0.5);
    });
  });

  describe('9. Main Menu Ouroboros Head Removal & Seamless Loop (Iteration 3 Update)', () => {
    it('9.1 drawGL renders continuous unbroken scutes without separate head overlay', () => {
      const anim = new OuroborosMenuAnimation();
      anim.update(120, 1280, 720);

      const batch = new GLBatch(null as any);
      const callLog: string[] = [];
      const origTail = anim.drawTailGL.bind(anim);
      const origHead = anim.drawHeadGL.bind(anim);

      anim.drawTailGL = (b, t, f, a) => {
        callLog.push('tail');
        origTail(b, t, f, a);
      };
      anim.drawHeadGL = (b, h, f, a) => {
        callLog.push('head');
        origHead(b, h, f, a);
      };

      anim.drawGL(batch, 1280, 720, 120);

      // In Iteration 3, head and tail overlays are removed in favor of uniform continuous ring
      expect(callLog).not.toContain('head');
      expect(callLog).not.toContain('tail');
    });

    it('9.2 drawHeadGL standalone method remains functional for modular invocation', () => {
      const anim = new OuroborosMenuAnimation();
      anim.update(50, 1280, 720);

      const batch = new GLBatch(null as any);
      const polylineCalls: any[] = [];

      batch.drawRotatedQuad = () => {};
      batch.drawCircle = () => {};
      batch.drawLaserLine = () => {};
      batch.drawSdfWedge = () => {};
      batch.drawPolyline = () => { polylineCalls.push({}); };
      batch.drawPolygon = () => {};

      anim.drawHeadGL(batch, anim.segments[0]!, 50, 1.0);

      // Check for undulating whiskers (polyline or laser lines)
      expect(polylineCalls.length).toBeGreaterThan(0);
    });
  });

  describe('10. Clean Ouroboros Loop, Serpentine Turning Geometry & Cosmic Pep (Iteration 3)', () => {
    it('10.1 OuroborosMenuAnimation renders an unbroken, headless, tailless uniform scute loop (R=32px)', () => {
      const anim = new OuroborosMenuAnimation();
      anim.update(100, 1280, 720);

      const segs = anim.segments;
      // Head segment 0 must NOT have enlarged cranial dome (was 44px) - must have uniform base radius 32px * (1 + 0.18*z)
      const expectedR0 = 32.0 * (1.0 + segs[0]!.z * 0.18);
      expect(segs[0]!.radius).toBeCloseTo(expectedR0, 1);

      // Tail segment 179 must NOT be tapered down to 13px - must have uniform base radius 32px * (1 + 0.18*z)
      const expectedR179 = 32.0 * (1.0 + segs[179]!.z * 0.18);
      expect(segs[179]!.radius).toBeCloseTo(expectedR179, 1);
    });

    it('10.2 OuroborosMenuAnimation eliminates the bright point vertebral node shape from scutes', () => {
      const anim = new OuroborosMenuAnimation();
      anim.update(50, 1280, 720);

      const batch = new GLBatch(null as any);
      const circleColors: string[] = [];

      batch.drawCircle = (_x, _y, _r, color) => {
        circleColors.push(String(color));
      };
      batch.drawPolygon = () => {};
      batch.drawPolyline = () => {};
      batch.drawContinuousRibbon = () => {};

      anim.drawGL(batch, 1280, 720, 50);

      // In the clean scute, there should be ZERO bright white point circles (was '#ffffff' at r*0.10)
      const whitePoints = circleColors.filter(c => c.includes('#ffffff') || c.includes('255, 255, 255'));
      expect(whitePoints.length).toBe(0);
    });

    it('10.3 GLBatch._drawRibbonCoordsInternal enforces strict miter spike clamping on sharp turns', () => {
      const batch = new GLBatch(null as any);
      batch.begin(960, 640);

      // 90-degree right angle turn with segment spacing = 20px, width = 40px (half-width = 20px)
      const points = [
        { x: 0, y: 0 },
        { x: 20, y: 0 },
        { x: 20, y: 20 },
      ];

      batch.drawContinuousRibbon(points, 40, '#ff0054', 0, GLPrimitive.Quad, false);

      // Check corner vertices in vertexDataF32
      const f32 = batch.vertexDataF32;
      const corner1X = f32[6]!; // Corner 1 (Left End of Quad 0 = Joint 1)
      const corner1Y = f32[7]!;
      // Extrusion distance from joint (20, 0)
      const extDist = Math.hypot(corner1X - 20, corner1Y - 0);
      // Miter clamping must ensure extrusion distance does not exceed 1.25 * halfWidth (25px)
      expect(extDist).toBeLessThanOrEqual(25.0);
    });

    it('10.4 WebGLGameRenderer.drawBoss draws sleek spinal core ribbon for segmented bosses', () => {
      const batch = new GLBatch(null as any);
      let ribbonMaxWidth = 0;

      batch.drawContinuousRibbon = (_pts, width) => {
        const w = typeof width === 'function' ? width(0, 0) : (Array.isArray(width) ? (width[0] ?? 0) : width);
        ribbonMaxWidth = Math.max(ribbonMaxWidth, w);
      };
      batch.drawSdfCircle = () => {};
      batch.drawSphere = () => {};
      batch.drawRotatedQuad = () => {};

      const centipedeBoss = {
        type: 'centipede',
        x: 200,
        y: 200,
        radius: 32,
        color: '#ff3366',
        accent: '#ff4d6d',
        segments: Array.from({ length: 8 }, (_, i) => ({ x: 200, y: 200 + (i + 1) * 20, r: 24, angle: 0 })),
      };

      WebGLGameRenderer.drawBoss(batch, centipedeBoss);

      // Ribbon width must be a sleek spinal line (<= 24px, r * 0.75), NOT the old 58px (r * 1.8) block
      expect(ribbonMaxWidth).toBeLessThanOrEqual(25.0);
    });

    it('10.5 WebGLGameRenderer.drawBackdrop activates dynamic micro-star twinkling with alpha', () => {
      const batch = new GLBatch(null as any);
      const quadColors: string[] = [];

      batch.drawQuad = (_x, _y, _w, _h, color) => {
        quadColors.push(String(color));
      };
      batch.drawSdfRect = () => {};
      batch.drawRotatedQuad = () => {};
      batch.drawLaserLine = () => {};
      batch.drawSdfCircle = () => {};

      WebGLGameRenderer.drawBackdrop(batch, 1280, 720, false, 60, 1);

      // Micro-stars must have dynamic alpha in their color string (not static '#ffffff')
      const rgbaStars = quadColors.filter(c => c.startsWith('rgba('));
      expect(rgbaStars.length).toBeGreaterThan(50);
    });
  });

  describe('11. Scale Shingling & Natural Serpentine Imbrication (Iteration 4)', () => {
    it('11.1 OuroborosMenuAnimation.drawGL strokes open-root trailing-edge scute polylines (never closed loop over anterior root)', () => {
      const anim = new OuroborosMenuAnimation();
      anim.update(0, 1280, 720);

      const batch = new GLBatch(null as any);
      let closedLoopCount = 0;
      let openTrailingEdgeCount = 0;

      batch.drawPolyline = (pts, _width, _color, _glow, count) => {
        const n = count ?? pts.length;
        if (n >= 4) {
          const first = pts[0]!;
          const last = pts[n - 1]!;
          const isClosed = Math.hypot(first.x - last.x, first.y - last.y) < 1e-4;
          if (isClosed) {
            closedLoopCount++;
          } else {
            openTrailingEdgeCount++;
          }
        }
      };
      batch.drawPolygon = () => {};
      batch.drawContinuousRibbon = () => {};
      batch.drawSdfCircle = () => {};

      anim.drawGL(batch, 1280, 720, 0);

      // In natural scale shingling, the anterior root is tucked UNDER the predecessor
      // and must NOT be closed-looped with a cyan stroke across the snake's back.
      // Zero scutes should stroke a closed loop; all scutes should stroke open trailing edges.
      expect(closedLoopCount).toBe(0);
      expect(openTrailingEdgeCount).toBeGreaterThanOrEqual(180);
    });

    it('11.2 OuroborosMenuAnimation.drawGL preserves sequential shingling along apex bends (no segment drawn after both neighbors)', () => {
      const anim = new OuroborosMenuAnimation();
      anim.update(0, 1280, 720);

      const batch = new GLBatch(null as any);
      const drawnSegmentIndices: number[] = [];

      batch.drawPolygon = (_pts, _color, _glow, _count) => {
        // Track the order in which segments are drawn
      };
      batch.drawPolyline = () => {};
      batch.drawContinuousRibbon = () => {};
      batch.drawSdfCircle = () => {};

      // Spy on segment drawing order by intercepting drawGL segment processing
      const renderOrder: number[] = [];
      const origDrawPoly = batch.drawPolygon;
      batch.drawPolygon = (pts, col, glow, cnt) => {
        origDrawPoly.call(batch, pts, col, glow, cnt);
      };

      // Let's record the drawn sequence in anim.drawGL
      anim.drawGL(batch, 1280, 720, 0);

      // Find the segments near an apex bend (local maximum of z, e.g. z > 0.95)
      const segs = anim.segments;
      for (let i = 0; i < segs.length; i++) {
        const s = segs[i]!;
        const prev = segs[(i - 1 + segs.length) % segs.length]!;
        const next = segs[(i + 1) % segs.length]!;

        // If s is at a local peak of z along the curve:
        if (s.z > 0.90 && s.z > prev.z && s.z > next.z) {
          // Verify that the drawing order does NOT place s after both prev and next
          // In the old code, sortedIndices sorted purely by z, so s was drawn AFTER both prev and next!
          const order = anim.getSegmentRenderOrder ? anim.getSegmentRenderOrder() : (anim as any)._sortedIndices;
          const posS = order.indexOf(i);
          const posPrev = order.indexOf((i - 1 + segs.length) % segs.length);
          const posNext = order.indexOf((i + 1) % segs.length);

          const drawnAfterBoth = posS > posPrev && posS > posNext;
          expect(drawnAfterBoth).toBe(false);
        }
      }
    });
  });

  describe('12. Universal Serpentine Body Unification & Fluid Boss Kinematics (Iteration 5)', () => {
    it('12.1 Boss archetypes enforce smooth turn rate limiting without instantaneous 180° angle snapping', () => {
      const types = ['gorgon', 'frostwyrm', 'chronowyrm', 'superconductor_boss', 'centipede'];
      for (const t of types) {
        const boss = new Boss(1, 1000, 1000, t, 500, 500);
        boss.EntranceTimer = 0;
        boss.Angle = 0; // facing right (+X)
        const target = { x: 400, y: 500, X: 400, Y: 500 } as any; // target is directly behind (-X, 180° turn)
        const world = { ArenaW: 1000, ArenaH: 1000, Projectiles: [], Hazards: [] } as any;

        // 1 tick of dt = 1/60s
        boss.update(1 / 60, target, world);

        // Turn rate limit check: in 1/60s, angle change must be smooth (<= 0.20 rad), NEVER instantaneous PI (3.14 rad)
        const angleChange = Math.abs(MathX.angleDelta(0, boss.Angle));
        expect(angleChange).toBeLessThanOrEqual(0.20);
      }
    });

    it('12.2 Boss.UpdateSegments enforces smooth distance-constrained follow kinematics without lateral jitter wave offsets', () => {
      const boss = new Boss(1, 1000, 1000, 'centipede', 500, 500);
      for (let i = 0; i < boss.Segments.length; i++) {
        boss.Segments[i]!.X = 500 - (i + 1) * boss.SegmentSpacing;
        boss.Segments[i]!.Y = 500;
      }

      // Move boss forward in a straight line for 30 ticks
      for (let i = 0; i < 30; i++) {
        boss.X += 5;
        boss.UpdateSegments(1 / 60);
      }

      // Segments along a straight line must stay collinear without artificial perpendicular wave offsets
      for (let i = 0; i < boss.Segments.length; i++) {
        const seg = boss.Segments[i]!;
        expect(Math.abs(seg.Y - 500)).toBeLessThan(1.0);
      }
    });

    it('12.3 WebGLGameRenderer.drawBoss renders segmented bosses via drawSerpentineMultiPass for a unified living body', () => {
      const batch = new GLBatch(null as any);
      let serpentineMultiPassCalled = false;
      batch.drawSerpentineMultiPass = () => {
        serpentineMultiPassCalled = true;
      };
      batch.drawSdfCircle = () => {};
      batch.drawSphere = () => {};
      batch.drawContinuousRibbon = () => {};
      batch.drawRotatedQuad = () => {};
      batch.drawSdfRect = () => {};

      const boss = new Boss(1, 1000, 1000, 'centipede', 400, 400);
      WebGLGameRenderer.drawBoss(batch, boss);

      expect(serpentineMultiPassCalled).toBe(true);
    });

    it('12.4 GLBatch._drawRibbonCoordsInternal renders hairpin-safe bevels and round joins on 180° turns without inverted bowties', () => {
      const batch = new GLBatch(null as any);
      let circleDrawnAtHairpin = false;
      batch.drawCircle = (x, y, _r) => {
        // Hairpin joint is at (100, 100)
        if (Math.hypot(x - 100, y - 100) < 1.0) {
          circleDrawnAtHairpin = true;
        }
      };

      // 3 points forming a sharp 180° hairpin reversal: (0, 100) -> (100, 100) -> (0, 100)
      const hairpinPts = [
        { x: 0, y: 100 },
        { x: 100, y: 100 },
        { x: 0, y: 100 }
      ];

      batch.drawContinuousRibbon(hairpinPts, 20, '#00f0b5', 0, GLPrimitive.Quad, true);

      // Verify that the sharp hairpin angle triggered the round join cap and clean bevel
      expect(circleDrawnAtHairpin).toBe(true);
    });
  });

  describe('13. Top-Docked Boss Health Bar & AAA Visual Polish Up (Iteration 6)', () => {
    it('13.1 Boss health bar (.hud-boss-box) is contained within .hud-header-group and never directly in hud-container with space-between', () => {
      setupMockDom();
      const hud = new HudView({} as any);
      const bossBoxInHeader = hud.element.querySelector('.hud-header-group .hud-boss-box');
      const bossBox = hud.element.querySelector('.hud-boss-box') as any;

      expect(bossBoxInHeader).not.toBeNull();
      expect(bossBox).not.toBeNull();
      expect(bossBox.parentElement?.classList?.contains('hud-header-group')).toBe(true);
      expect(bossBox.parentElement?.classList?.contains('hud-container')).toBe(false);
    });

    it('13.2 WebGLGameRenderer renders cinematic vignette post-pass with dynamic damage scaling', () => {
      const batch = new GLBatch(null as any);
      let vignetteDrawn = false;
      let drawnColor = '';

      batch.drawSdfRect = (_x, _y, _w, _h, _rot, color, _alpha) => {
        if (typeof color === 'string' && (color.includes('#02040a') || color.includes('#ff0054') || color.includes('#ef4444') || color.includes('rgba(2, 4, 10'))) {
          vignetteDrawn = true;
          drawnColor = color;
        }
      };

      const engine = new GameEngine();
      engine.state = GameState.Playing;
      engine.arenaW = 960;
      engine.arenaH = 640;
      engine.vignette = 0.8;

      (WebGLGameRenderer as any).renderWithBatch(batch, engine);
      expect(vignetteDrawn).toBe(true);
    });

    it('13.3 Perimeter wall rendering insets boundary lasers with pad >= 4 to prevent viewport edge clipping', () => {
      const batch = new GLBatch(null as any);
      const laserCoords: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];
      batch.drawLaserLine = (x1, y1, x2, y2) => {
        laserCoords.push({ x1, y1, x2, y2 });
      };

      WebGLGameRenderer.drawBackdrop(batch, 960, 640, false, 100, 1);

      // Find top wall laser: should have y >= 4, not y = 0 (which clips off the screen)
      const topWall = laserCoords.find(l => l.y1 === l.y2 && l.y1 >= 4 && l.y1 <= 10);
      expect(topWall).toBeDefined();
    });

    it('13.4 drawPlayer emits supersonic dash shockwaves and speed streaks when player.isDashing is true', () => {
      const batch = new GLBatch(null as any);
      let dashEffectEmitted = false;

      batch.drawSdfWedge = () => {
        dashEffectEmitted = true;
      };
      batch.drawLaserLine = () => {
        dashEffectEmitted = true;
      };

      const player = new SnakePlayer('emerald', 960, 640);
      player.x = 200;
      player.y = 200;
      player.isDashing = true;

      WebGLGameRenderer.drawPlayer(batch, player);
      expect(dashEffectEmitted).toBe(true);
    });

    it('13.5 drawFood renders celestial food crystals without rectangular boxes', () => {
      const batch = new GLBatch(null as any);
      let rectDrawn = false;

      batch.drawSdfRect = () => {
        rectDrawn = true;
      };

      const food = new FoodItem(100, 100, 'apple');
      food.spawnScale = 1;
      WebGLGameRenderer.drawFood(batch, food, 0.5);

      expect(rectDrawn).toBe(false);
    });
  });

  describe('14. Biological Viper Body Geometry & Rectangular Segment Elimination (Iteration 7)', () => {
    it('14.1 drawSerpentineMultiPass eliminates flat rectangular GLPrimitive.Quad cross-tick slats', () => {
      const batch = new GLBatch(null as any);
      let rectangularSlatDrawn = false;

      batch.drawRotatedQuad = (_x, _y, _w, h, _angle, _color, _glow, prim) => {
        // Pass 6 was drawing h = 2.0 with GLPrimitive.Quad (0)
        if (h <= 2.5 && prim === GLPrimitive.Quad) {
          rectangularSlatDrawn = true;
        }
      };

      const spec = {
        x: 100,
        y: 100,
        angle: 0,
        headRadius: 14,
        color: '#00f0b5',
        accent: '#10b981',
        segments: [
          { x: 80, y: 100, r: 12, angle: 0 },
          { x: 60, y: 100, r: 11, angle: 0 },
          { x: 40, y: 100, r: 10, angle: 0 }
        ]
      };

      batch.drawSerpentineMultiPass(spec, 1.0);
      expect(rectangularSlatDrawn).toBe(false);
    });

    it('14.2 drawBoss does not stamp discrete drawSdfDiamond or per-segment standalone drawSphere overlays over the continuous body ribbon', () => {
      const batch = new GLBatch(null as any);
      let discreteDiamondDrawn = false;
      let standaloneSegmentSphereCount = 0;

      batch.drawSdfDiamond = (_x, _y, _r, color) => {
        if (typeof color === 'string' && color.includes('#e0f2fe')) {
          discreteDiamondDrawn = true;
        }
      };
      batch.drawSphere = () => {
        standaloneSegmentSphereCount++;
      };

      const boss = new Boss(4, 960, 640, 'frostwyrm'); // Frostwyrm previously stamped drawSdfDiamond on every segment
      boss.segments = [
        { x: 100, y: 100, r: 14 } as any,
        { x: 80, y: 100, r: 13 } as any,
        { x: 60, y: 100, r: 12 } as any
      ];

      WebGLGameRenderer.drawBoss(batch, boss);

      // Frostwyrm must never stamp discrete square diamond plates on segments
      expect(discreteDiamondDrawn).toBe(false);
      // Secondary per-segment discrete sphere stacking must be eliminated
      expect(standaloneSegmentSphereCount).toBe(0);
    });

    it('14.3 drawBoss calibrates body ribbon width proportionally to segment radius rather than raw cranium radius', () => {
      const batch = new GLBatch(null as any);
      let passedHeadRadius = 0;

      batch.drawSerpentineMultiPass = (spec: any) => {
        passedHeadRadius = spec.headRadius;
      };

      const boss = new Boss(3, 960, 640, 'colossus');
      boss.Radius = 34; // massive cranium
      boss.segments = [
        { x: 100, y: 100, r: 16 } as any,
        { x: 80, y: 100, r: 15 } as any
      ];

      WebGLGameRenderer.drawBoss(batch, boss);

      // Body ribbon width must calibrate to segment dimensions (e.g. <= 24), not the giant 34px cranium
      expect(passedHeadRadius).toBeLessThanOrEqual(24);
    });

    it('14.4 drawSerpentineMultiPass performs render-side spline smoothing for supple organic continuous curves', () => {
      const batch = new GLBatch(null as any);
      let totalRibbonPoints = 0;

      (batch as any)._drawRibbonCoordsInternal = (
        _ptX: Float32Array,
        _ptY: Float32Array,
        count: number
      ) => {
        if (count > totalRibbonPoints) {
          totalRibbonPoints = count;
        }
      };

      // Input has 4 control joints (head + 3 segments)
      const spec = {
        x: 100,
        y: 100,
        angle: 0,
        headRadius: 14,
        color: '#00f0b5',
        accent: '#10b981',
        segments: [
          { x: 80, y: 100, r: 12, angle: 0 },
          { x: 60, y: 100, r: 11, angle: 0 },
          { x: 40, y: 100, r: 10, angle: 0 }
        ]
      };

      batch.drawSerpentineMultiPass(spec, 1.0);

      // Render-side spline interpolation must expand sparse control joints into a denser smooth spline (count > 4)
      expect(totalRibbonPoints).toBeGreaterThan(4);
    });
  });

  describe('15. Tail Origin Coordinate Leak & Food Rectangle Elimination (Iteration 8)', () => {
    it('15.1 drawSerpentineMultiPass never leaks tail ribbon to origin (0, 0)', () => {
      const batch = new GLBatch(null as any);
      let leakedToOrigin = false;

      (batch as any)._drawRibbonCoordsInternal = (
        ptX: Float32Array,
        ptY: Float32Array,
        count: number
      ) => {
        for (let i = 0; i < count; i++) {
          if (ptX[i] === 0 && ptY[i] === 0) {
            leakedToOrigin = true;
          }
        }
      };

      const spec = {
        x: 500,
        y: 500,
        angle: 0,
        headRadius: 14,
        color: '#00f0b5',
        accent: '#10b981',
        segments: Array.from({ length: 15 }, (_, i) => ({
          x: 480 - i * 16,
          y: 500,
          r: 12,
          angle: 0
        }))
      };

      batch.drawSerpentineMultiPass(spec, 1.0);
      expect(leakedToOrigin).toBe(false);
    });

    it('15.2 drawFood eliminates unnatural rectangular boxes and pedestals underneath food pickups', () => {
      const batch = new GLBatch(null as any);
      let rectDrawnUnderFood = false;

      batch.drawSdfRect = () => {
        rectDrawnUnderFood = true;
      };

      const food = new FoodItem(300, 300, 'apple');
      food.spawnScale = 1;
      WebGLGameRenderer.drawFood(batch, food, 0.5);

      expect(rectDrawnUnderFood).toBe(false);
    });
  });
});


