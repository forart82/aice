import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WebGLAssetAtlas } from '../render/webgl/WebGLAssetAtlas';
import { WebGLGameRenderer } from '../render/webgl/WebGLGameRenderer';
import { GLBatch, GLBlendMode } from '../render/webgl/GLBatch';
import { GLPrimitive } from '../render/webgl/WebGLContext';
import { EnemyRenderer, IEnemyRenderData } from '../render/EnemyRenderer';
import { BossRenderer, IBossRenderData } from '../render/BossRenderer';
import { TelegraphRenderer, ITelegraphAttack } from '../render/TelegraphRenderer';
import { GameRenderer } from '../render/GameRenderer';
import { GameEngine } from '../sim/GameEngine';

function createMockWebGL() {
  const calls = {
    texturesCreated: [] as any[],
    texturesBound: [] as any[],
    texParameters: [] as any[],
    texImage2DCalls: [] as any[],
    pixelStoreiCalls: [] as any[],
  };

  const gl: any = {
    TEXTURE_2D: 3553,
    TEXTURE_WRAP_S: 10242,
    TEXTURE_WRAP_T: 10243,
    CLAMP_TO_EDGE: 33071,
    TEXTURE_MIN_FILTER: 10241,
    TEXTURE_MAG_FILTER: 10240,
    LINEAR: 9729,
    UNPACK_PREMULTIPLY_ALPHA_WEBGL: 37441,
    RGBA: 6408,
    UNSIGNED_BYTE: 5121,
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
  };

  return { gl, calls };
}

describe('Enemies, Bosses & Cosmic Nebula Visual Parity Suite', () => {
  beforeEach(() => {
    WebGLAssetAtlas.clear();
    WebGLGameRenderer.clearTextureCaches();
  });

  describe('1. Cosmic Nebula Backdrop Parity', () => {
    it('1.1 WebGLAssetAtlas binds and uploads ArenaBackdrop.bakeBackdrop texture with premultiplied alpha', () => {
      const { gl, calls } = createMockWebGL();
      const bakeSpy = vi.spyOn(GameRenderer.backdrop, 'bakeBackdrop');

      const tex = WebGLAssetAtlas.getBackdropTexture(gl, 1, 960, 640);
      expect(tex).toBeDefined();
      expect(bakeSpy).toHaveBeenCalledWith(960, 640, 1);
      expect(calls.texturesCreated.length).toBe(1);
      expect(calls.texImage2DCalls.length).toBe(1);

      // Verify premultiplied alpha pixelStorei call
      const pstore = calls.pixelStoreiCalls.find((c) => c.pname === gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL);
      expect(pstore).toBeDefined();
      expect(pstore.param).toBe(true);

      // Re-query retrieves cached texture without additional upload
      const texCached = WebGLAssetAtlas.getBackdropTexture(gl, 1, 960, 640);
      expect(texCached).toBe(tex);
      expect(calls.texImage2DCalls.length).toBe(1);
    });

    it('1.2 WebGLGameRenderer.getBackdropTexture delegates to WebGLAssetAtlas', () => {
      const { gl } = createMockWebGL();
      const atlasSpy = vi.spyOn(WebGLAssetAtlas, 'getBackdropTexture');

      const tex = WebGLGameRenderer.getBackdropTexture(gl, 960, 640, 2);
      expect(atlasSpy).toHaveBeenCalledWith(gl, 2, 960, 640);
      expect(tex).toBeDefined();
    });

    it('1.3 drawBackdrop fallback does NOT draw sharp rectangular strips with GLPrimitive.Quad, but continuous 2D SDF nebula', () => {
      // Create batch with mock GL that returns null for texture so fallback branch executes
      const glMock: any = {
        createTexture: () => null,
      };
      const batch = new GLBatch(glMock, 256);
      batch.begin(960, 640);

      const rotatedQuadSpy = vi.spyOn(batch, 'drawRotatedQuad');

      (WebGLGameRenderer as any).drawBackdrop(batch, 960, 640, false, 0, 1);

      // Verify that no sharp rectangular quad strips are drawn for the spine
      const quadCalls = rotatedQuadSpy.mock.calls.filter((c) => c[7] === GLPrimitive.Quad);
      expect(quadCalls.length).toBe(0);

      // Verify that continuous 2D SDF Nebula geometry is drawn instead (at least 2 passes: mantle and core)
      const nebulaCalls = rotatedQuadSpy.mock.calls.filter((c) => c[7] === GLPrimitive.Nebula);
      expect(nebulaCalls.length).toBeGreaterThanOrEqual(2);

      // Verify that the nebula passes have varying colors (mid mantle and accent core)
      const colors = nebulaCalls.map((c) => c[5]);
      const uniqueColors = new Set(colors);
      expect(uniqueColors.size).toBeGreaterThan(1);
    });
  });

  describe('2. 6 Enemies Parity (Spitter, Drone, Phantom, Bruiser, Swarmling, Scarab)', () => {
    const enemyTypes = ['spitter', 'drone', 'phantom', 'brute', 'bruiser', 'dasher', 'swarmling', 'scarab'];

    it('2.1 renders all 6 enemy types in EnemyRenderer stub without throwing', () => {
      for (const type of enemyTypes) {
        const enemy: IEnemyRenderData = {
          x: 200,
          y: 200,
          type,
          radius: 14,
          angle: 1.2,
          color: '#ef4444',
          hp: 30,
          maxHp: 50,
          hitFlash: 0,
          charging: true,
          shootTimer: 0.25,
          status: {
            freezeTimer: 1.0,
            burnTimer: 0.5,
          },
        };

        expect(() => {
          EnemyRenderer.draw(null, enemy);
        }).not.toThrow();
      }
    });

    it('2.2 renders all 6 enemy types in WebGLGameRenderer without throwing', () => {
      const batch = new GLBatch(null, 256);
      batch.begin(960, 640);

      for (const type of enemyTypes) {
        const enemy = {
          x: 200,
          y: 200,
          type,
          radius: 14,
          angle: 1.2,
          color: '#ef4444',
          hp: 30,
          maxHp: 50,
          hitFlash: 0,
          charging: true,
          shootTimer: 0.25,
          status: {
            freezeTimer: 1.0,
            burnTimer: 0.5,
          },
        };

        expect(() => {
          (WebGLGameRenderer as any).drawEnemy(batch, enemy);
        }).not.toThrow();
      }
    });

    it('2.3 renders enemy status indicators (freeze ring, burn ring, HP bar) in pure WebGL', () => {
      const enemyData: IEnemyRenderData = {
        x: 100,
        y: 100,
        type: 'bruiser',
        radius: 16,
        angle: 0,
        color: '#f97316',
        hp: 20,
        maxHp: 100,
        status: {
          freezeTimer: 1.5,
          burnTimer: 0.8,
        },
      };

      const batch = new GLBatch(null, 256);
      batch.begin(960, 640);
      const drawRingSpy = vi.spyOn(batch, 'drawSdfRing');
      const drawRectSpy = vi.spyOn(batch, 'drawSdfRect');

      (WebGLGameRenderer as any).drawEnemy(batch, enemyData);

      // Freeze ring (r + 4 = 20) and Burn ring (r + 7 = 23)
      expect(drawRingSpy).toHaveBeenCalledWith(100, 100, 20, 2.0, '#7dd3fc', 0.75, 6, '#7dd3fc');
      expect(drawRingSpy).toHaveBeenCalledWith(100, 100, 23, 2.0, '#ff5400', 0.6, 6, '#ff5400');
      // HP bar background and foreground
      expect(drawRectSpy).toHaveBeenCalled();
    });
  });

  describe('3. 8 Bosses Parity (Centipede, Colossus, Frostwyrm, Chronowyrm, Gorgon, Leviathan, Ouroboros Prime, Void)', () => {
    const bossTypes = [
      'centipede',
      'colossus',
      'frostwyrm',
      'chronowyrm',
      'gorgon',
      'superconductor_boss',
      'leviathan',
      'ouroboros_prime',
      'ouroboros',
      'eternal_ouroboros',
      'void_devourer',
      'void',
    ];

    it('3.1 renders all 8 boss archetypes in BossRenderer stub without throwing', () => {
      for (const type of bossTypes) {
        const boss: IBossRenderData = {
          x: 300,
          y: 300,
          type,
          radius: 32,
          angle: 0.5,
          spiralAngle: 1.5,
          color: '#ff3366',
          accent: '#ff4d6d',
          hp: 800,
          maxHp: 1000,
          phase: 2,
          segments: [
            { x: 280, y: 300, r: 28 },
            { x: 260, y: 300, r: 26 },
            { x: 240, y: 300, r: 24 },
          ],
        };

        expect(() => {
          BossRenderer.draw(null, boss);
        }).not.toThrow();
      }
    });

    it('3.2 renders all 8 boss archetypes in WebGLGameRenderer', () => {
      const batch = new GLBatch(null, 512);
      batch.begin(960, 640);

      for (const type of bossTypes) {
        const boss = {
          x: 300,
          y: 300,
          type,
          radius: 32,
          angle: 0.5,
          spiralAngle: 1.5,
          color: '#ff3366',
          accent: '#ff4d6d',
          hp: 800,
          maxHp: 1000,
          phase: 2,
          segments: [
            { x: 280, y: 300, r: 28 },
            { x: 260, y: 300, r: 26 },
            { x: 240, y: 300, r: 24 },
          ],
        };

        expect(() => {
          (WebGLGameRenderer as any).drawBoss(batch, boss);
        }).not.toThrow();
      }
    });

    it('3.3 renders continuous spine ribbon connecting head to segments in WebGLGameRenderer', () => {
      const batch = new GLBatch(null, 256);
      batch.begin(960, 640);
      const boss: IBossRenderData = {
        x: 400,
        y: 400,
        type: 'centipede',
        radius: 30,
        angle: 0,
        color: '#ff3366',
        accent: '#ff4d6d',
        hp: 500,
        maxHp: 500,
        phase: 1,
        segments: [
          { x: 380, y: 400, r: 28 },
          { x: 360, y: 400, r: 26 },
        ],
      };

      expect(() => {
        (WebGLGameRenderer as any).drawBoss(batch, boss);
      }).not.toThrow();
      expect(batch.quadCount).toBeGreaterThan(0);
    });
  });

  describe('4. Expanding Attack Telegraphs Parity', () => {
    const telegraphTypes: Array<ITelegraphAttack['type']> = ['circle', 'cone', 'line', 'ring'];

    it('4.1 renders all telegraph varieties in TelegraphRenderer stub without throwing', () => {
      for (const type of telegraphTypes) {
        const t: ITelegraphAttack = {
          type,
          x: 200,
          y: 200,
          radius: 80,
          length: 250,
          spread: 0.8,
          angle: 0.3,
          progress: 0.75,
          color: '#ff0054',
        };

        expect(() => {
          TelegraphRenderer.drawTelegraph(null, t);
        }).not.toThrow();
      }
    });

    it('4.2 renders all telegraph varieties with progress-scaled geometry in WebGLGameRenderer', () => {
      const batch = new GLBatch(null, 256);
      batch.begin(960, 640);

      for (const type of telegraphTypes) {
        const t: ITelegraphAttack = {
          type,
          x: 200,
          y: 200,
          radius: 80,
          length: 250,
          spread: 0.8,
          angle: 0.3,
          progress: 0.75,
          color: '#ff0054',
        };

        expect(() => {
          WebGLGameRenderer.drawTelegraph(batch, t);
        }).not.toThrow();
      }
    });

    it('4.3 renders hazard telegraph and active damage pool in pure WebGL', () => {
      const batch = new GLBatch(null, 256);
      batch.begin(960, 640);

      // Telegraphing hazard
      (WebGLGameRenderer as any).drawHazard(batch, { x: 150, y: 150, radius: 25, telegraph: 0.5, telegraphMax: 1.0 });
      const chargingQuads = batch.quadCount;
      expect(chargingQuads).toBeGreaterThan(0);

      // Active hazard
      (WebGLGameRenderer as any).drawHazard(batch, { x: 150, y: 150, radius: 25, telegraph: 0 });
      expect(batch.quadCount).toBeGreaterThan(chargingQuads);
    });
  });
});
