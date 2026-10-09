/**
 * Ouroboros Ascension — 20-Floor Progression & Multi-Boss Escalation Test Suite
 *
 * Strict TDD test suite validating:
 * 1. Default 20-floor progression ceiling (MaxFloors = 20).
 * 2. ActiveBosses collection and backward-compatible Boss getter/setter.
 * 3. Single-boss spawning on Floors 1-20 (GameData.BossForFloor).
 * 4. Multi-boss escalating horde spawning on Floors 21+:
 *    - Floors 21-30: 2 bosses
 *    - Floors 31-40: 3 bosses
 *    - Floors 41-50: 4 bosses
 *    - Floors 51-60: 5 bosses
 *    - Floors 61+: 6 bosses (capped)
 * 5. Perimeter safe coordinate distribution for all spawned bosses.
 * 6. Sequential multi-boss defeat handling, Ouro/loot drops, and floor clear gating.
 * 7. Multi-boss rendering in GameRenderer.
 * 8. Composite multi-boss HUD health bar display in HudView.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GameEngine } from '../sim/GameEngine.js';
import { GameState } from '../sim/GameState.js';
import { Boss } from '../sim/Boss.js';
import { GameData } from '../data/GameData.js';
import { MetaProgression } from '../data/MetaProgression.js';
import { Services } from '../core/Services.js';
import { ScriptedInput, NullFx, NullSound } from '../core/Contracts.js';
import { setupMockDom } from './MockDom.js';
import { GameRenderer } from '../render/GameRenderer.js';
import { WebGLGameRenderer } from '../render/WebGLGameRenderer.js';
import { HudView } from '../ui/HudView.js';

describe('20-Floor Progression & Multi-Boss Escalation Test Suite', () => {
  let g: GameEngine;
  let teardownDom: () => void;

  beforeEach(() => {
    teardownDom = setupMockDom();

    const memStore = new Map<string, string>();
    MetaProgression.ReadBackend = (key) => memStore.get(key) ?? null;
    MetaProgression.WriteBackend = (key, val) => { memStore.set(key, val); };
    MetaProgression.DeleteBackend = (key) => { memStore.delete(key); };
    MetaProgression.Instance = new MetaProgression();

    g = new GameEngine();
    g.SetupCanvas(1280, 720, 1);
    Services.Input = new ScriptedInput();
    Services.Fx = new NullFx();
    Services.Sound = new NullSound();
    Services.Headless = true;
  });

  afterEach(() => {
    teardownDom();
  });

  /* ========================================================================= *
   * 1. DEFAULT MAX FLOORS = 20 & ACTIVE BOSSES STATE ARCHITECTURE
   * ========================================================================= */
  describe('1. Default Max Floors = 20 & ActiveBosses Collection', () => {
    it('1.1 initializes GameEngine with default MaxFloors = 20', () => {
      const freshEngine = new GameEngine();
      expect(freshEngine.MaxFloors).toBe(20);
      expect(freshEngine.maxFloors).toBe(20);
    });

    it('1.2 manages ActiveBosses array with Boss getter/setter backward compatibility', () => {
      expect(Array.isArray(g.ActiveBosses)).toBe(true);
      expect(g.ActiveBosses.length).toBe(0);
      expect(g.Boss).toBeNull();
      expect(g.boss).toBeNull();

      const b1 = new Boss(1, 1280, 720);
      g.ActiveBosses.push(b1);
      expect(g.ActiveBosses.length).toBe(1);
      expect(g.Boss).toBe(b1);
      expect(g.boss).toBe(b1);

      const b2 = new Boss(2, 1280, 720);
      g.ActiveBosses.push(b2);
      expect(g.ActiveBosses.length).toBe(2);
      expect(g.Boss).toBe(b1); // Primary boss is index 0

      // Setting single boss replaces array
      const b3 = new Boss(3, 1280, 720);
      g.Boss = b3;
      expect(g.ActiveBosses.length).toBe(1);
      expect(g.ActiveBosses[0]).toBe(b3);

      // Setting null empties array
      g.Boss = null;
      expect(g.ActiveBosses.length).toBe(0);
      expect(g.Boss).toBeNull();
    });
  });

  /* ========================================================================= *
   * 2. SPAWN BOSS ON FLOORS 1-20 (SINGLE ARCHETYPE FOR FLOOR)
   * ========================================================================= */
  describe('2. Single Boss Spawning for Floors 1 to 20', () => {
    it('2.1 spawns exactly 1 boss for each floor from 1 to 20', () => {
      for (let floor = 1; floor <= 20; floor++) {
        g.CurrentFloor = floor;
        g.ActiveBosses = [];
        g.SpawnBoss();

        expect(g.ActiveBosses.length).toBe(1);
        const active = g.Boss!;
        expect(active).toBeDefined();

        const expectedArch = GameData.BossForFloor(floor);
        expect(active.Type).toBe(expectedArch.Type);
        expect(active.Floor).toBe(floor);
      }
    });
  });

  /* ========================================================================= *
   * 3. MULTI-BOSS ESCALATION ON FLOORS 21+
   * ========================================================================= */
  describe('3. Multi-Boss Escalating Horde Spawning on Floors 21+', () => {
    it('3.1 scales boss count formula on floors 21+', () => {
      // Test sample floors across escalation brackets
      const testCases = [
        { floor: 21, expectedCount: 2 },
        { floor: 25, expectedCount: 2 },
        { floor: 30, expectedCount: 2 },
        { floor: 31, expectedCount: 3 },
        { floor: 35, expectedCount: 3 },
        { floor: 40, expectedCount: 3 },
        { floor: 41, expectedCount: 4 },
        { floor: 50, expectedCount: 4 },
        { floor: 51, expectedCount: 5 },
        { floor: 60, expectedCount: 5 },
        { floor: 61, expectedCount: 6 },
        { floor: 100, expectedCount: 6 },
      ];

      for (const tc of testCases) {
        g.CurrentFloor = tc.floor;
        g.ActiveBosses = [];
        g.SpawnBoss();

        expect(g.ActiveBosses.length).toBe(tc.expectedCount);
        for (const b of g.ActiveBosses) {
          expect(b.Floor).toBe(tc.floor);
          expect(b.Hp).toBe(b.MaxHp);
          expect(b.MultiBossScale).toBe(0.75);
          expect(b.Dead).toBe(false);
        }
      }
    });

    it('3.2 distributes multi-boss spawn positions safely along arena perimeter', () => {
      g.CurrentFloor = 31; // 3 bosses
      g.ActiveBosses = [];
      g.SpawnBoss();

      expect(g.ActiveBosses.length).toBe(3);

      const margin = 50;
      for (let i = 0; i < g.ActiveBosses.length; i++) {
        const b = g.ActiveBosses[i]!;
        expect(b.X).toBeGreaterThanOrEqual(margin);
        expect(b.X).toBeLessThanOrEqual(g.ArenaW - margin);
        expect(b.Y).toBeGreaterThanOrEqual(margin);
        expect(b.Y).toBeLessThanOrEqual(g.ArenaH - margin);

        // Verify bosses are not stacked on top of each other
        for (let j = i + 1; j < g.ActiveBosses.length; j++) {
          const other = g.ActiveBosses[j]!;
          const dist = Math.hypot(b.X - other.X, b.Y - other.Y);
          expect(dist).toBeGreaterThan(100); // At least 100px apart
        }
      }
    });
  });

  /* ========================================================================= *
   * 4. SEQUENTIAL MULTI-BOSS DEFEAT, DROPS, AND FLOOR CLEAR GATING
   * ========================================================================= */
  describe('4. Multi-Boss Defeat Resolution & State Progression', () => {
    it('4.1 defeats individual bosses sequentially, awarding loot and gating FloorClear until all are slain', () => {
      g.CurrentFloor = 21;
      g.MaxFloors = 30;
      g.StartRun();
      g.CurrentFloor = 21;
      g.MaxFloors = 30;
      g.State = GameState.Playing;
      g.ActiveBosses = [];
      g.SpawnBoss();

      expect(g.ActiveBosses.length).toBe(2);
      const b1 = g.ActiveBosses[0]!;
      const b2 = g.ActiveBosses[1]!;
      const b1Type = b1.Type;
      const b2Type = b2.Type;

      const initialKills = g.Combat.BossKills;
      const initialScore = g.Combat.Score;
      const initialHelmets = g.HelmetDrops.length;

      // Slay Boss 1
      b1.Dead = true;
      g.OnBossDefeated(b1);

      expect(g.ActiveBosses.length).toBe(1);
      expect(g.ActiveBosses[0]).toBe(b2);
      expect(g.Boss).toBe(b2);
      expect(g.Combat.BossKills).toBe(initialKills + 1);
      expect(g.Combat.Score).toBeGreaterThan(initialScore);
      expect(g.HelmetDrops.length).toBe(initialHelmets + 1);
      expect(g.HelmetDrops[g.HelmetDrops.length - 1]!.Helmet.BossType).toBe(b1Type);

      // State MUST remain Playing because Boss 2 is still alive!
      expect(g.State).toBe(GameState.Playing);

      // Slay Boss 2
      b2.Dead = true;
      g.OnBossDefeated(b2);

      expect(g.ActiveBosses.length).toBe(0);
      expect(g.Boss).toBeNull();
      expect(g.Combat.BossKills).toBe(initialKills + 2);
      expect(g.HelmetDrops.length).toBe(initialHelmets + 2);
      expect(g.HelmetDrops[g.HelmetDrops.length - 1]!.Helmet.BossType).toBe(b2Type);

      // State must now transition to FloorClear
      expect(g.State).toBe(GameState.FloorClear);
    });

    it('4.2 triggers Victory when final campaign floor (Floor 20) boss is defeated', () => {
      g.CurrentFloor = 20;
      g.MaxFloors = 20;
      g.StartRun();
      g.CurrentFloor = 20;
      g.MaxFloors = 20;
      g.State = GameState.Playing;
      g.ActiveBosses = [];
      g.SpawnBoss();

      expect(g.ActiveBosses.length).toBe(1);
      const finalBoss = g.Boss!;

      finalBoss.Dead = true;
      g.OnBossDefeated(finalBoss);

      expect(g.ActiveBosses.length).toBe(0);
      expect(g.State).toBe(GameState.Victory);
    });
  });

  /* ========================================================================= *
   * 5. BOSS CONSTRUCTOR CUSTOM ARCHETYPE AND COORDINATES SUPPORT
   * ========================================================================= */
  describe('5. Boss Custom Archetype & Spawn Coordinates Support', () => {
    it('5.1 supports explicit archetype and spawn coordinate injection', () => {
      const arch = GameData.Bosses[4]!; // chronowyrm
      const boss = new Boss(25, 1280, 720, arch, 350, 450);

      expect(boss.Type).toBe(arch.Type);
      expect(boss.Title).toBe(arch.Title);
      expect(boss.X).toBe(350);
      expect(boss.Y).toBe(450);
      expect(boss.Segments.length).toBeGreaterThan(0);
      expect(boss.Segments[0]!.X).toBe(350);
    });
  });

  /* ========================================================================= *
   * 6. MULTI-BOSS RENDERING & HUD COMPOSITE HEALTH BAR
   * ========================================================================= */
  describe('6. Multi-Boss Rendering & HUD Composite Health Bar', () => {
    it('6.1 renders all active bosses without throwing errors', () => {
      const canvas = document.createElement('canvas');
      canvas.width = 1280;
      canvas.height = 720;
      const renderer = new WebGLGameRenderer(canvas);

      g.CurrentFloor = 25;
      g.ActiveBosses = [];
      g.SpawnBoss(); // 2 bosses
      expect(g.ActiveBosses.length).toBe(2);

      expect(() => {
        GameRenderer.draw(renderer, g);
      }).not.toThrow();
    });

    it('6.2 updates HUD boss bar for multi-boss horde without errors', () => {
      const hudRoot = {
        hudSet: (_id: string, _v: string, cb?: (v: string) => void) => { if (cb) cb(_v); },
        hudWidth: (_id: string, _w: number, cb?: (w: number) => void) => { if (cb) cb(_w); },
        engine: g,
      };

      const hudView = new HudView(hudRoot as any);
      g.CurrentFloor = 35;
      g.ActiveBosses = [];
      g.SpawnBoss(); // 3 bosses
      expect(g.ActiveBosses.length).toBe(3);

      expect(() => {
        hudView.update();
      }).not.toThrow();
    });
  });
});
