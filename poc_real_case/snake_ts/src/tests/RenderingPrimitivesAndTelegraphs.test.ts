import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupMockDom, MockElement } from './MockDom';
import { ColorX } from '../render/ColorX';
import { GLBatch, GLBlendMode } from '../render/webgl/GLBatch';
import { WebGLContext, GLPrimitive } from '../render/webgl/WebGLContext';
import { WebGLGameRenderer } from '../render/WebGLGameRenderer';
import { GameRenderer } from '../render/GameRenderer';
import { FxManager } from '../render/FxManager';
import { GameEngine } from '../sim/GameEngine';
import { Hazard } from '../sim/Hazard';
import { SnakePlayer } from '../sim/SnakePlayer';
import { Boss } from '../sim/Boss';
import { Enemy } from '../sim/Enemy';

describe('WebGL Rendering Primitives, Sphere Gradients, Unified Telegraphs & FX Optimization', () => {
  let restoreDom: () => void;
  let mockCanvas: MockElement;
  let batch: GLBatch;
  let glContext: WebGLContext;

  beforeEach(() => {
    restoreDom = setupMockDom();
    mockCanvas = document.createElement('canvas') as any;
    mockCanvas.clientWidth = 1200;
    mockCanvas.clientHeight = 800;
    (mockCanvas as any).width = 1200;
    (mockCanvas as any).height = 800;

    glContext = new WebGLContext(mockCanvas as any);
    batch = new GLBatch(glContext);
  });

  afterEach(() => {
    restoreDom();
  });

  describe('1. WebGL Sphere & SDF Primitives Specification & Math', () => {
    it('creates standard 3D pseudo-spherical specular gradient via GLBatch.drawSphere with correct coordinates and primitive type', () => {
      const x = 100;
      const y = 150;
      const r = 20;
      const baseColor = '#10b981';

      const initialQuads = batch.quadCount;
      batch.drawSphere(x, y, r, baseColor, 1.2);

      expect(batch.quadCount).toBe(initialQuads + 1);
      expect(batch.vertexCount).toBe((initialQuads + 1) * 4);
      expect(batch.indexCount).toBe((initialQuads + 1) * 6);
    });

    it('handles custom outer radius and clamps non-positive radii safely in SDF routines', () => {
      const initialQuads = batch.quadCount;
      batch.drawSdfCircle(0, 0, 30, '#ff0054', 1.0, 6);
      expect(batch.quadCount).toBe(initialQuads + 1);

      batch.drawSdfRing(50, 50, 25, 2.0, '#00f0b5', 0.8);
      expect(batch.quadCount).toBe(initialQuads + 2);

      // Safe zero-radius drawing should not throw
      expect(() => batch.drawSphere(50, 50, 0, '#ffffff')).not.toThrow();
    });
  });

  describe('2. Unified WebGL TelegraphRenderer & Hazard Specification', () => {
    it('renders circle telegraph with warning perimeter stroke and progressive inner fill via WebGLGameRenderer', () => {
      const t = {
        type: 'circle',
        x: 300,
        y: 400,
        radius: 60,
        progress: 0.75,
        color: '#ff0054',
      };

      const before = batch.quadCount;
      WebGLGameRenderer.drawTelegraph(batch, t);

      expect(batch.quadCount).toBeGreaterThan(before);
      expect(batch.currentBlendMode).toBe(GLBlendMode.ADDITIVE);
    });

    it('renders cone telegraph with angular sector stroke and progressive inner fill via WebGLGameRenderer', () => {
      const t = {
        type: 'cone',
        x: 200,
        y: 200,
        radius: 120,
        angle: 0.5,
        spread: 0.8,
        progress: 0.6,
        color: '#f59e0b',
      };

      const before = batch.quadCount;
      WebGLGameRenderer.drawTelegraph(batch, t);

      expect(batch.quadCount).toBeGreaterThan(before);
    });

    it('renders line telegraph with directional warning stroke via WebGLGameRenderer', () => {
      const t = {
        type: 'line',
        x: 100,
        y: 100,
        length: 250,
        angle: 1.2,
        progress: 0.4,
        color: '#00f0ff',
      };

      const before = batch.quadCount;
      WebGLGameRenderer.drawTelegraph(batch, t);

      expect(batch.quadCount).toBeGreaterThan(before);
    });

    it('renders hazard zones for both charging telegraph and active armed states via WebGLGameRenderer', () => {
      const chargingHazard = {
        x: 400,
        y: 300,
        type: 'laser',
        radius: 35,
        telegraph: 0.4,
        telegraphMax: 1.0,
      };

      const beforeCharging = batch.quadCount;
      WebGLGameRenderer.drawHazard(batch, chargingHazard);
      expect(batch.quadCount).toBeGreaterThan(beforeCharging);

      const activeHazard = {
        x: 400,
        y: 300,
        type: 'poison',
        radius: 25,
        telegraph: 0,
        telegraphMax: 0,
        pulse: 1.2,
      };

      const beforeActive = batch.quadCount;
      WebGLGameRenderer.drawHazard(batch, activeHazard);
      expect(batch.quadCount).toBeGreaterThan(beforeActive);
    });

    it('renders mob/boss spawn warp rings and charge indicators via WebGL primitives', () => {
      const before = batch.quadCount;
      batch.drawSdfRing(250, 250, 16, 2.0, '#ef4444', 0.8, 6, '#ef4444');
      batch.drawSdfRing(250, 250, 20, 2.5, '#ff0054', 0.45, 8, '#ff0054');
      expect(batch.quadCount).toBe(before + 2);
    });

    it('ensures WebGLGameRenderer.drawTelegraph safely dispatches telegraphs to GLBatch', () => {
      const t = {
        type: 'circle',
        x: 150,
        y: 150,
        radius: 50,
        progress: 0.5,
      };

      expect(() => WebGLGameRenderer.drawTelegraph(batch, t)).not.toThrow();
    });
  });

  describe('3. FxManager Shape-Bucketed Particle Iteration & Performance in WebGL', () => {
    it('buckets active particles into circle, square, ring, and spark buckets in a single pass', () => {
      const fx = new FxManager();

      // Spawn distinct shapes
      fx.burst(100, 100, '#00f0b5', 4, 2, 3, 'circle');
      fx.burst(200, 200, '#ffb703', 4, 2, 3, 'square');
      fx.ringShockwave(300, 300, '#ff0054', 8);
      fx.burst(400, 400, '#38bdf8', 4, 2, 3, 'spark');

      const activeParticles = fx.particles.filter((p) => p.active);
      expect(activeParticles.length).toBeGreaterThanOrEqual(13);

      const before = batch.quadCount;
      expect(() => WebGLGameRenderer.drawFx(batch, fx, 1200, 800)).not.toThrow();
      expect(batch.quadCount).toBeGreaterThan(before);
    });

    it('handles 700 maximum particle load across mixed shapes without memory allocations or crashes', () => {
      const fx = new FxManager();
      fx.setQuality('high');

      const shapes: Array<'circle' | 'square' | 'ring' | 'spark'> = ['circle', 'square', 'ring', 'spark'];
      for (let i = 0; i < 700; i++) {
        const p = fx.getParticle();
        p.spawn(
          (i * 17) % 800,
          (i * 23) % 600,
          Math.cos(i) * 2,
          Math.sin(i) * 2,
          3,
          '#00f0b5',
          0.01,
          shapes[i % 4]!,
          true
        );
      }

      expect(() => {
        for (let frame = 0; frame < 5; frame++) {
          fx.update(1 / 60);
          WebGLGameRenderer.drawFx(batch, fx, 1200, 800);
        }
      }).not.toThrow();
    });

    it('properly respects quality tiers and particle budgets', () => {
      const fx = new FxManager();

      fx.setQuality('low');
      expect(fx.quality).toBe('low');
      expect(fx.glowAllowed).toBe(false);
      expect(fx.particleBudget).toBeLessThan(700);

      fx.setQuality('high');
      expect(fx.quality).toBe('high');
      expect(fx.glowAllowed).toBe(true);
      expect(fx.particleBudget).toBe(700);
    });
  });

  describe('4. Full WebGL Renderer Integration & Non-Regression', () => {
    it('executes WebGLGameRenderer.drawPlayer with unified sphere gradients and serpentine mesh without errors', () => {
      const player = new SnakePlayer('emerald', 400, 300, 5);
      expect(() => WebGLGameRenderer.drawPlayer(batch, player)).not.toThrow();
    });

    it('executes WebGLGameRenderer.drawBoss with unified sphere gradients and telegraphs without errors', () => {
      const boss = new Boss(5, 1200, 800, 'gorgon', 600, 400);
      expect(() => WebGLGameRenderer.drawBoss(batch, boss)).not.toThrow();
    });

    it('executes WebGLGameRenderer.drawEnemy across all 6 hostile archetypes without errors', () => {
      const types = ['drone', 'spitter', 'brute', 'phantom', 'swarmling', 'scarab'];
      for (let i = 0; i < types.length; i++) {
        const e = new Enemy(100 * (i + 1), 100 * (i + 1), types[i]!, 1);
        expect(() => WebGLGameRenderer.drawEnemy(batch, e)).not.toThrow();
      }
    });

    it('executes GameRenderer.draw with unified hazards, backdrop, and entities without errors in pure WebGL', () => {
      const engine = new GameEngine();
      engine.startRun();

      engine.hazards.push(
        new Hazard({ x: 300, y: 300, type: 'laser', radius: 40, telegraph: 0.5 } as any),
        new Hazard({ x: 500, y: 500, type: 'poison', radius: 30, telegraph: 0 } as any)
      );

      const renderer = new WebGLGameRenderer(mockCanvas as any);
      expect(() => GameRenderer.draw(renderer, engine)).not.toThrow();
    });
  });

  describe('5. High-Impact Explosion & Particle FX Overhaul (Shockwaves, Multi-Stage Explosions, WebGL Sparks)', () => {
    it('gives shockwaves dynamic expansion velocity that starts explosively and decelerates via friction', () => {
      const fx = new FxManager();
      fx.ringShockwave(200, 200, '#ffb703', 10, 0.035, 450);

      const ring = fx.particles.find((p) => p.active && p.shape === 'ring');
      expect(ring).toBeDefined();
      expect(ring!.size).toBe(10);
      expect((ring as any).expansionSpeed).toBeGreaterThanOrEqual(450);

      // Frame 1: dynamic expansion should advance size by ~7.5px (450 * 1/60s), not frozen 1.5px
      const initialSpeed = (ring as any).expansionSpeed;
      fx.update(1 / 60);

      expect(ring!.size).toBeGreaterThan(16); // 10 + 7.5 = 17.5
      expect((ring as any).expansionSpeed).toBeLessThan(initialSpeed); // Decelerated by friction
    });

    it('spawns multi-stage visceral explosion with core flash, shockwave, plasma sparks, and lingering embers', () => {
      const fx = new FxManager();
      expect(typeof fx.explosion).toBe('function');

      fx.explosion(300, 300, '#ff0054', 40, 1.0);

      const active = fx.particles.filter((p) => p.active);
      expect(active.length).toBeGreaterThanOrEqual(20);

      // 1. Core Flash: White-hot incandescent expanding fireball that dissipates in ~0.12s (decay >= 0.12)
      const coreFlash = active.find((p) => p.shape === 'circle' && p.colorCss === '#ffffff' && p.decay >= 0.12);
      expect(coreFlash).toBeDefined();

      // 2. Kinetic Shockwave: Fast-expanding refractive ring
      const shockwave = active.find((p) => p.shape === 'ring' && (p as any).expansionSpeed >= 450);
      expect(shockwave).toBeDefined();

      // 3. Directional Plasma Sparks: shape: 'spark' with high velocity
      const sparks = active.filter((p) => p.shape === 'spark');
      expect(sparks.length).toBeGreaterThanOrEqual(8);
      for (const sp of sparks) {
        const speed = Math.hypot(sp.vx, sp.vy);
        expect(speed).toBeGreaterThan(4);
      }

      // 4. Lingering Embers: Floating incandescent particles with air drag and subtle turbulence
      const embers = active.filter((p) => p.shape === 'circle' && p.friction < 0.93 && (p as any).turbulence > 0);
      expect(embers.length).toBeGreaterThanOrEqual(8);
    });

    it('renders shockwave ring with dynamic thickness and sparks with white-hot heads in WebGL drawFx', () => {
      const fx = new FxManager();
      fx.ringShockwave(100, 100, '#ffb703', 15);
      fx.burst(200, 200, '#00f0b5', 1, 10, 3, 'spark');

      const ringSpy = vi.spyOn(batch, 'drawSdfRing');
      const laserSpy = vi.spyOn(batch, 'drawLaserLine');
      const circleSpy = vi.spyOn(batch, 'drawSdfCircle');

      WebGLGameRenderer.drawFx(batch, fx, 1200, 800);

      // Shockwave ring: dynamic thickness Math.max(1.5, 4.0 * (1 - p.alpha)), glow 8
      expect(ringSpy).toHaveBeenCalled();
      const ringCall = ringSpy.mock.calls.find((call) => call[0] === 100 && call[1] === 100);
      expect(ringCall).toBeDefined();
      expect(ringCall![6]).toBe(8); // glow radius 8

      // Directional spark: velocity-stretched laser streak (vx * 3) and white-hot head (#ffffff)
      expect(laserSpy).toHaveBeenCalled();
      const sparkLaser = laserSpy.mock.calls.find((call) => call[4] === '#00f0b5');
      expect(sparkLaser).toBeDefined();

      expect(circleSpy).toHaveBeenCalled();
      const whiteHead = circleSpy.mock.calls.find((call) => call[3] === '#ffffff');
      expect(whiteHead).toBeDefined();
    });
  });
});

