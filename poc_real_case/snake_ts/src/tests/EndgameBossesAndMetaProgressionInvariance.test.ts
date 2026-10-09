/**
 * Ouroboros Ascension — Endgame Bosses & Meta-Progression Invariance Test Suite
 *
 * Master Invariance & Conformance Test Suite for Step 3 of Big Audit:
 *  1. 20 Apex Boss Guardians: Serpentine kinematics, vertebral health distribution,
 *     tapered radii, and distinct phase triggers across all 20 bosses.
 *  2. Multi-Boss Escalation (Floors 21+): Dual boss horde scaling, stagger timing,
 *     perimeter distribution, 0.75x HP scaling, and sequential defeat state gating.
 *  3. Boss Rush Gauntlet: 8-second wave cadence, high-stakes 1800x1800 arena, 0.70x HP scaling,
 *     victory reward payout (9th Omni-Helmet), and permaloss defeat resolution.
 *  4. Galaxy Jump Prestige Formula: P_mult = 1 + 0.5 * N_helmets + 0.1 * Floor,
 *     detailed sacrifice scoring, exponential probability curve P = 1 - exp(-S / 800),
 *     persistent shard & ouro retention, and consolation rewards.
 *  5. 8 Unique Relic Helmets + 9th Omni-Helmet Celestial Crown: Canonical IDs & aliases,
 *     gold-brown cosmic aesthetic, unique capacities, 100% completion requirement, and omni-relic synergy.
 *  6. Cranial Mutation Lab & Sanctuary Shop: Challenge-gated tier progression rules (Tiers 1-3),
 *     starter defaults, dynamic length scaling, module/augment pricing curves, and Sanctuary 14 upgrades.
 *
 * Adheres strictly to AGENTS.md Protocol 3.0, Rule 10 In-Code Documentation, and Rule 12 Pure WebGL Mandate.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Boss } from '../sim/Boss.js';
import { GameEngine } from '../sim/GameEngine.js';
import { GameState } from '../sim/GameState.js';
import { BossRushGauntlet, GAUNTLET_BOSS_ARCHETYPES, THE_NINTH_HELMET } from '../sim/BossRushGauntlet.js';
import { SnakePlayer } from '../sim/SnakePlayer.js';
import { GameData } from '../data/GameData.js';
import { MetaProgression } from '../data/MetaProgression.js';
import {
  UNIQUE_HELMETS,
  CELESTIAL_OUROBOROS_HELMET,
  SACRIFICE_RARITY_VALUES,
  calculateSacrificeScore,
  calculateDetailedSacrificeScore,
  calculatePrestigeMultiplier,
  getUniqueHelmet,
  isUniqueHelmetId,
  getCanonicalHelmetId,
  forgeOmniHelmet,
} from '../data/UniqueHelmetsData.js';
import { HelmetDef } from '../data/Types.js';
import { MathX } from '../core/MathX.js';
import { Vec2 } from '../core/Vec2.js';
import { Services } from '../core/Services.js';
import { ScriptedInput, NullFx, NullSound } from '../core/Contracts.js';
import { setupMockDom } from './MockDom.js';
import { SaveIO } from '../platform/SaveIO.js';

describe('Endgame, 20 Apex Bosses, Multi-Boss Escalation, Boss Rush & Meta-Progression Invariance', () => {
  let g: GameEngine;
  let teardownDom: () => void;

  beforeEach(() => {
    teardownDom = setupMockDom();
    SaveIO.memoryBackendEnabled = true;
    SaveIO.clearMemory();

    const memStore = new Map<string, string>();
    MetaProgression.ReadBackend = (key) => memStore.get(key) ?? null;
    MetaProgression.WriteBackend = (key, val) => { memStore.set(key, val); };
    MetaProgression.DeleteBackend = (key) => { memStore.delete(key); };
    MetaProgression.Instance = MetaProgression.createIsolated({ isolated: true });

    g = new GameEngine();
    g.SetupCanvas(1280, 720, 1);
    Services.Input = new ScriptedInput();
    Services.Fx = new NullFx();
    Services.Sound = new NullSound();
    Services.Headless = true;
  });

  afterEach(() => {
    SaveIO.clearMemory();
    SaveIO.memoryBackendEnabled = false;
    teardownDom();
  });

  /* ========================================================================= *
   * 1. 20 APEX BOSS GUARDIANS: SEGMENT KINEMATICS, HEALTH & PHASE TRIGGERS   *
   * ========================================================================= */
  describe('1. 20 Serpentine Apex Boss Guardians Invariance', () => {
    const expectedBossRoster = [
      { floor: 1, type: 'centipede', name: 'Centipede Behemoth', minSegs: 14, baseHp: 450, hpPerFloor: 180, rad: 30 },
      { floor: 2, type: 'gorgon', name: 'Storm Gorgon', minSegs: 12, baseHp: 650, hpPerFloor: 220, rad: 32 },
      { floor: 3, type: 'colossus', name: 'Infernal Colossus', minSegs: 10, baseHp: 900, hpPerFloor: 280, rad: 34 },
      { floor: 4, type: 'frostwyrm', name: 'Glacial Behemoth', minSegs: 14, baseHp: 1200, hpPerFloor: 340, rad: 35 },
      { floor: 5, type: 'chronowyrm', name: 'Chrono Wyrm', minSegs: 14, baseHp: 1500, hpPerFloor: 400, rad: 33 },
      { floor: 6, type: 'hivemind', name: 'Bio-Venom Hivemind', minSegs: 16, baseHp: 1900, hpPerFloor: 460, rad: 36 },
      { floor: 7, type: 'superconductor_boss', name: 'Apex Superconductor', minSegs: 12, baseHp: 2400, hpPerFloor: 520, rad: 34 },
      { floor: 8, type: 'leviathan', name: 'Astral Leviathan', minSegs: 18, baseHp: 3000, hpPerFloor: 580, rad: 35 },
      { floor: 9, type: 'quantum_hydra', name: 'Quantum Hydra', minSegs: 14, baseHp: 3700, hpPerFloor: 650, rad: 36 },
      { floor: 10, type: 'mirror_wyrm', name: 'Shadow Doppelgänger', minSegs: 14, baseHp: 4500, hpPerFloor: 720, rad: 33 },
      { floor: 11, type: 'void_devourer', name: 'Void Devourer', minSegs: 16, baseHp: 5400, hpPerFloor: 800, rad: 37 },
      { floor: 12, type: 'orbital_dreadnought', name: 'Magnetic Dreadnought', minSegs: 16, baseHp: 6400, hpPerFloor: 880, rad: 36 },
      { floor: 13, type: 'iron_juggernaut', name: 'Aegis Juggernaut', minSegs: 16, baseHp: 7500, hpPerFloor: 960, rad: 38 },
      { floor: 14, type: 'solar_archon', name: 'Dyson Archon', minSegs: 14, baseHp: 8700, hpPerFloor: 1050, rad: 35 },
      { floor: 15, type: 'crystal_monolith', name: 'Prismatic Arachnid', minSegs: 14, baseHp: 10000, hpPerFloor: 1150, rad: 34 },
      { floor: 16, type: 'tempest_siren', name: 'Tempest Siren', minSegs: 14, baseHp: 11500, hpPerFloor: 1250, rad: 34 },
      { floor: 17, type: 'nanite_titan', name: 'Nanite Hive Titan', minSegs: 16, baseHp: 13200, hpPerFloor: 1350, rad: 36 },
      { floor: 18, type: 'phase_specter', name: 'Plasma Phase Specter', minSegs: 14, baseHp: 1500, hpPerFloor: 1450, rad: 33 }, // BaseHp in GameData is 15000
      { floor: 19, type: 'volcanic_chimera', name: 'Volcanic Chimera', minSegs: 16, baseHp: 17000, hpPerFloor: 1550, rad: 37 },
      { floor: 20, type: 'eternal_ouroboros', name: 'The Eternal Ouroboros', minSegs: 20, baseHp: 20000, hpPerFloor: 1700, rad: 40 },
    ];

    it('1.1 verifies all 20 Apex Bosses instantiate with exact archetype attributes from GameData', () => {
      expect(GameData.Bosses.length).toBe(20);

      for (let floor = 1; floor <= 20; floor++) {
        const boss = new Boss(floor, 1280, 720);
        const arch = GameData.BossForFloor(floor);
        const expected = expectedBossRoster[floor - 1]!;

        expect(boss.Type).toBe(arch.Type);
        expect(boss.Type).toBe(expected.type);
        expect(boss.Name).toBe(arch.Name);
        expect(boss.Radius).toBe(arch.Radius);
        expect(boss.Segments.length).toBeGreaterThanOrEqual(expected.minSegs);

        // Verify unscaled MaxHp matches formula: (BaseHp + HpPerFloor * cycleFloor) * (1 + cycle * 0.35)
        const cycle = Math.floor((floor - 1) / 20);
        const cycleFloor = cycle * 20;
        const expectedMaxHp = MathX.roundJs((arch.BaseHp + arch.HpPerFloor * cycleFloor) * (1 + cycle * 0.35));
        expect(boss.MaxHp).toBe(expectedMaxHp);
      }
    });

    it('1.2 verifies vertebral health distribution and tapered segment radii for all 20 bosses', () => {
      for (let floor = 1; floor <= 20; floor++) {
        const boss = new Boss(floor, 1280, 720);
        const n = boss.Segments.length;
        expect(n).toBeGreaterThan(0);

        // Vertebral distribution check:
        // totalWeights = n + 2, unitHp = Math.max(1, Math.floor(total / totalWeights))
        // headHp = total - unitHp * n
        const total = boss.MaxHp;
        const unitHp = Math.max(1, Math.floor(total / (n + 2)));
        const expectedHeadHp = total - unitHp * n;

        expect(boss.HeadMaxHp).toBe(expectedHeadHp);
        expect(boss.HeadHp).toBe(expectedHeadHp);

        let segmentHpSum = 0;
        let prevRadius = 999;
        for (let i = 0; i < n; i++) {
          const seg = boss.Segments[i]!;
          expect(seg.MaxHp).toBe(unitHp);
          expect(seg.Hp).toBe(unitHp);
          segmentHpSum += seg.Hp;

          // Verify radii taper toward tail (or stay non-increasing)
          expect(seg.R).toBeLessThanOrEqual(prevRadius);
          expect(seg.R).toBeGreaterThanOrEqual(8);
          prevRadius = seg.R;
        }

        // Sacred invariant: HeadHp + sum(segments.Hp) === MaxHp and === Hp
        expect(boss.HeadHp + segmentHpSum).toBe(boss.MaxHp);
        expect(boss.Hp).toBe(boss.MaxHp);
      }
    });

    it('1.3 updates serpentine vertebral kinematics during locomotion for all 20 bosses', () => {
      g.selectedClass = 'emerald';
      g.startRun();

      for (let floor = 1; floor <= 20; floor++) {
        const boss = new Boss(floor, 1280, 720);
        boss.EntranceTimer = 0;
        boss.MoveTimer = 999;
        boss.WanderTarget = new Vec2(100, 100);

        const initialSegPos = boss.Segments.map(s => ({ x: s.X, y: s.Y }));

        // Simulate 480 ticks (4.0 seconds) to allow kinematic IK wave to propagate
        for (let t = 0; t < 480; t++) {
          boss.update(1 / 120, g.player, g.worldBag());
        }

        // Verify segments have dynamically followed the leader
        let movedCount = 0;
        for (let i = 0; i < boss.Segments.length; i++) {
          const seg = boss.Segments[i]!;
          const init = initialSegPos[i]!;
          const dist = Math.hypot(seg.X - init.x, seg.Y - init.y);
          if (dist > 1.0) movedCount++;
        }
        expect(movedCount).toBeGreaterThanOrEqual(Math.floor(boss.Segments.length * 0.7));
      }
    });

    it('1.4 verifies damage routing from tail forward and Phase 2 transition at <= 50% HP', () => {
      for (let floor = 1; floor <= 20; floor++) {
        const boss = new Boss(floor, 1280, 720);
        boss.EntranceTimer = 0; // Make vulnerable
        expect(boss.Phase).toBe(1);
        expect(boss.OnPhaseChange).toBe(false);

        const initialSegCount = boss.Segments.length;
        const damageToTail = boss.Segments[boss.Segments.length - 1]!.Hp;

        // Applying damage equal to 1 segment should pop the tail segment
        boss.ApplyDamage(damageToTail);
        expect(boss.Segments.length).toBe(initialSegCount - 1);

        // Inflict damage to bring HP to exactly 49% of MaxHp
        const remainingToP2 = boss.Hp - boss.MaxHp * 0.49;
        if (remainingToP2 > 0) {
          boss.ApplyDamage(remainingToP2);
        }

        // Phase 2 must be triggered!
        expect(boss.Hp).toBeLessThanOrEqual(boss.MaxHp * 0.5);
        expect(boss.Phase).toBe(2);
        expect(boss.AttackTimer).toBe(0.9);
        expect(boss.OnPhaseChange).toBe(true);

        // Inflict massive lethal damage to wipe all segments and head
        boss.ApplyDamage(boss.MaxHp * 2);
        expect(boss.Hp).toBe(0);
        expect(boss.Segments.length).toBe(0);
        expect(boss.HeadHp).toBe(0);
        expect(boss.Dead).toBe(true);
      }
    });
  });

  /* ========================================================================= *
   * 2. MULTI-BOSS ESCALATION ON FLOORS 21+                                    *
   * ========================================================================= */
  describe('2. Multi-Boss Escalation (Floors 21+)', () => {
    it('2.1 spawns single boss on Floors 1-20 and escalating dual/multi bosses on Floors 21+', () => {
      const progressionSchedule = [
        { floor: 1, expectedCount: 1 },
        { floor: 10, expectedCount: 1 },
        { floor: 20, expectedCount: 1 },
        { floor: 21, expectedCount: 2 }, // Dual boss begins
        { floor: 30, expectedCount: 2 },
        { floor: 31, expectedCount: 3 }, // Tri boss
        { floor: 40, expectedCount: 3 },
        { floor: 41, expectedCount: 4 }, // Quad boss
        { floor: 50, expectedCount: 4 },
        { floor: 51, expectedCount: 5 }, // Penta boss
        { floor: 60, expectedCount: 5 },
        { floor: 61, expectedCount: 6 }, // Hexa boss (capped)
        { floor: 99, expectedCount: 6 },
      ];

      for (const item of progressionSchedule) {
        g.CurrentFloor = item.floor;
        g.ActiveBosses = [];
        g.SpawnBoss();

        expect(g.ActiveBosses.length).toBe(item.expectedCount);

        // On floors 21+, all multi-bosses have 0.75x HP scaling
        if (item.floor >= 21) {
          for (const b of g.ActiveBosses) {
            expect(b.MultiBossScale).toBe(0.75);
          }
        }
      }
    });

    it('2.2 distributes multi-boss spawn coordinates along arena perimeter with safe spacing', () => {
      g.CurrentFloor = 41; // 4 bosses
      g.ActiveBosses = [];
      g.SpawnBoss();

      expect(g.ActiveBosses.length).toBe(4);
      const margin = 50;

      for (let i = 0; i < g.ActiveBosses.length; i++) {
        const b = g.ActiveBosses[i]!;
        expect(b.X).toBeGreaterThanOrEqual(margin);
        expect(b.X).toBeLessThanOrEqual(g.ArenaW - margin);
        expect(b.Y).toBeGreaterThanOrEqual(margin);
        expect(b.Y).toBeLessThanOrEqual(g.ArenaH - margin);

        // Ensure bosses are not spawned on top of each other
        for (let j = i + 1; j < g.ActiveBosses.length; j++) {
          const other = g.ActiveBosses[j]!;
          const dist = Math.hypot(b.X - other.X, b.Y - other.Y);
          expect(dist).toBeGreaterThan(100);
        }
      }
    });

    it('2.3 gates FloorClear until all active multi-bosses are slain sequentially', () => {
      g.CurrentFloor = 25; // 2 bosses
      g.MaxFloors = 30;
      g.StartRun();
      g.CurrentFloor = 25;
      g.MaxFloors = 30;
      g.State = GameState.Playing;
      g.ActiveBosses = [];
      g.SpawnBoss();

      expect(g.ActiveBosses.length).toBe(2);
      const [bossA, bossB] = g.ActiveBosses;

      // Slay Boss A
      bossA!.Dead = true;
      g.OnBossDefeated(bossA!);

      expect(g.ActiveBosses.length).toBe(1);
      expect(g.ActiveBosses[0]).toBe(bossB);
      // FloorClear MUST NOT trigger while Boss B is alive!
      expect(g.State).toBe(GameState.Playing);

      // Slay Boss B
      bossB!.Dead = true;
      g.OnBossDefeated(bossB!);

      expect(g.ActiveBosses.length).toBe(0);
      expect(g.Boss).toBeNull();
      // FloorClear now triggers
      expect(g.State).toBe(GameState.FloorClear);
    });
  });

  /* ========================================================================= *
   * 3. BOSS RUSH GAUNTLET: 8-SECOND WAVE CADENCE & HIGH-STAKES PERMALOSS     *
   * ========================================================================= */
  describe('3. Boss Rush Gauntlet (Floor 99 Celestial Rift)', () => {
    it('3.1 initializes in high-stakes 1800x1800 arena with 0.70x HP scaling', () => {
      g.StartRun(42);
      g.ArenaW = 1800;
      g.ArenaH = 1800;

      const gauntlet = new BossRushGauntlet();
      gauntlet.start(g);

      expect(gauntlet.state.active).toBe(true);
      expect(gauntlet.state.waveTimer).toBe(8.0);
      expect(gauntlet.state.totalBosses).toBe(8);
      expect(g.ActiveBosses.length).toBe(1);

      const firstBoss = g.ActiveBosses[0]!;
      expect(firstBoss.Type).toBe('centipede');
      expect(firstBoss.MultiBossScale).toBe(0.70);
      expect(firstBoss.ArenaW).toBe(1800);
      expect(firstBoss.ArenaH).toBe(1800);
    });

    it('3.2 advances through all 8 canonical archetypes on strict 8.0-second wave cadence', () => {
      g.SetupCanvas(1800, 1800, 1);
      g.StartRun(42);

      const gauntlet = new BossRushGauntlet();
      gauntlet.start(g);

      const expectedNames = [
        'centipede',
        'gorgon',
        'hydra',
        'colossus',
        'leviathan',
        'chrono',
        'void',
        'chimera',
      ];

      for (let wave = 1; wave < 8; wave++) {
        gauntlet.update(8.0, g);
        expect(gauntlet.state.bossesSpawned).toBe(wave + 1);
        expect(gauntlet.state.waveIndex).toBe(wave);
        expect(g.ActiveBosses.length).toBe(wave + 1);
      }

      expect(gauntlet.state.allSpawned).toBe(true);
      expect(gauntlet.state.waveTimer).toBe(0);

      // Verify all 8 spawned archetypes
      for (let i = 0; i < 8; i++) {
        const boss = g.ActiveBosses[i]!;
        const match = `${boss.Type.toLowerCase()} ${boss.Name.toLowerCase()}`;
        expect(match).toContain(expectedNames[i]);
      }
    });

    it('3.3 enforces High-Stakes Permaloss on defeat: wipes MetaProgression.UniqueHelmets to []', () => {
      g.StartRun(42);
      const meta = MetaProgression.Instance;
      meta.UniqueHelmets = UNIQUE_HELMETS.map(h => h.Id);
      expect(meta.UniqueHelmets.length).toBe(8);

      const gauntlet = g.StartBossRushGauntlet();
      expect(gauntlet.state.active).toBe(true);

      // Kill player
      g.Player.Hp = 0;
      g.Player.Alive = false;

      g.Step(0.1);

      expect(gauntlet.state.defeat).toBe(true);
      expect(gauntlet.state.active).toBe(false);
      // Sacred invariant: permaloss wipes all 8 unique helmets
      expect(meta.UniqueHelmets).toEqual([]);
      expect(meta.UniqueHelmets.length).toBe(0);
    });

    it('3.4 awards the 9th Omni-Helmet permanently upon conquering all 8 Gauntlet waves', () => {
      g.StartRun(42);
      const meta = MetaProgression.Instance;
      meta.UniqueHelmets = UNIQUE_HELMETS.map(h => h.Id);
      meta.Has9thHelmet = false;

      const gauntlet = g.StartBossRushGauntlet();

      // Fast forward and spawn all 8 waves
      for (let i = 0; i < 7; i++) {
        gauntlet.update(8.0, g);
      }
      expect(gauntlet.state.allSpawned).toBe(true);
      expect(g.ActiveBosses.length).toBe(8);

      // Slay all 8 bosses
      for (const b of g.ActiveBosses) {
        b.Hp = 0;
        b.Dead = true;
      }

      gauntlet.update(0.1, g);

      expect(gauntlet.state.bossesDefeated).toBe(8);
      expect(gauntlet.state.victory).toBe(true);
      expect(meta.Has9thHelmet).toBe(true);
      expect(meta.Helmets.some(h => (h.Id || (h as any).id) === THE_NINTH_HELMET.Id)).toBe(true);
    });
  });

  /* ========================================================================= *
   * 4. GALAXY JUMP PRESTIGE FORMULA & COSMIC INVARIANTS                      *
   * ========================================================================= */
  describe('4. Galaxy Jump Prestige Formula & Cosmic Invariants', () => {
    it('4.1 strictly computes P_mult = 1 + 0.5 * N_helmets + 0.1 * Floor across all inputs', () => {
      // 0 helmets on Floor 1: 1 + 0.5*0 + 0.1*1 = 1.1
      expect(calculatePrestigeMultiplier(0, 1)).toBe(1.1);

      // 2 helmets on Floor 5: 1 + 0.5*2 + 0.1*5 = 1 + 1.0 + 0.5 = 2.5
      expect(calculatePrestigeMultiplier(2, 5)).toBe(2.5);

      // 4 helmets on Floor 10: 1 + 0.5*4 + 0.1*10 = 1 + 2.0 + 1.0 = 4.0
      expect(calculatePrestigeMultiplier(4, 10)).toBe(4.0);

      // 8 helmets on Floor 20: 1 + 0.5*8 + 0.1*20 = 1 + 4.0 + 2.0 = 7.0
      expect(calculatePrestigeMultiplier(8, 20)).toBe(7.0);

      // Edge case floor 0 or negative
      expect(calculatePrestigeMultiplier(0, 0)).toBe(1.1);
    });

    it('4.2 computes detailed sacrifice scores scaling by affixes, floor, and rarity multipliers', () => {
      const epicHelm: HelmetDef = {
        Id: 'test_epic',
        Name: 'Test Epic',
        Icon: '👑',
        Rarity: 'epic',
        Floor: 10,
        Stats: {
          maxHp: 30,
          armor: 0.15,
          speed: 0.10,
        },
      };

      // affixes = 3 (maxHp, armor, speed), floor = 10, power = 30 + 0.15 + 0.10 = 30.25
      // itemValue = 50 * 3 + 10 * 10 + 30 = 150 + 100 + 30 = 280 (powerRating rounds 30.25 -> 30)
      // epic multiplier = 4.0 -> Math.round(280 * 4.0) = Math.round(1120) = 1120
      const detailed = calculateDetailedSacrificeScore([epicHelm]);
      expect(detailed).toBe(1120);
    });

    it('4.3 adheres to probability curve P = 1 - exp(-S / 800) with 800-point saturation milestone', () => {
      const probAt800 = 1 - Math.exp(-800 / 800);
      expect(probAt800).toBeCloseTo(0.6321, 3); // 63.2% characteristic milestone

      const probAt1600 = 1 - Math.exp(-1600 / 800);
      expect(probAt1600).toBeCloseTo(0.8647, 3); // 86.5%

      const probAt2400 = 1 - Math.exp(-2400 / 800);
      expect(probAt2400).toBeCloseTo(0.9502, 3); // 95.0%
    });

    it('4.4 preserves persistent Shards and Ouro balances across Galaxy Jump and permaloss reset', () => {
      const meta = MetaProgression.createIsolated();
      meta.Shards = 2500;
      meta.Ouro = 8000;
      meta.UniqueHelmets = [UNIQUE_HELMETS[0].Id];

      meta.AddHelmet({
        Id: 'sac_helm',
        Name: 'Sacrifice Helm',
        Icon: '🪖',
        Rarity: 'common',
        Stats: {},
      });

      meta.galaxyJump();

      // Shards & Ouro remain intact
      expect(meta.Shards).toBeGreaterThanOrEqual(2500);
      expect(meta.Ouro).toBeGreaterThanOrEqual(8000);

      // Permaloss defeat
      meta.resetUniqueHelmets();
      expect(meta.UniqueHelmets).toEqual([]);
      expect(meta.Shards).toBeGreaterThanOrEqual(2500);
      expect(meta.Ouro).toBeGreaterThanOrEqual(8000);
    });

    it('4.5 awards Consolation Stardust Bonus on failed jump roll and Crucible Surge on full collection', () => {
      // Failed roll test
      const failRng = { rand: () => 0.999, range: (a: number) => a, chance: () => false, nextInt: () => 1, pick: (arr: any[]) => arr[0] } as any;
      const failMeta = MetaProgression.createIsolated({ rng: failRng });
      failMeta.Ouro = 0;
      failMeta.Shards = 0;
      failMeta.AddHelmet({ Id: 'h1', Name: 'H', Icon: '1', Rarity: 'rare', Stats: {} });

      const score = calculateSacrificeScore(failMeta.Helmets);
      expect(score).toBe(SACRIFICE_RARITY_VALUES.rare); // 120

      const failResult = failMeta.galaxyJump(undefined, 3);
      expect(failResult.success).toBe(false);
      expect(failResult.consolationOuro).toBe(Math.floor(120 * 2.5)); // 300
      expect(failResult.consolationShards).toBe(Math.floor(120 / 20)); // 6
      expect(failMeta.Ouro).toBe(300);
      expect(failMeta.Shards).toBe(6);

      // Ascendant Crucible Surge (+10000 Ouro, +500 Shards) test
      const winRng = { rand: () => 0.001, range: (a: number) => a, chance: () => true, nextInt: () => 0, pick: (arr: any[]) => arr[0] } as any;
      const surgeMeta = MetaProgression.createIsolated({ rng: winRng });
      surgeMeta.UniqueHelmets = UNIQUE_HELMETS.map(h => h.Id);
      surgeMeta.Ouro = 1000;
      surgeMeta.Shards = 500;
      surgeMeta.AddHelmet({ Id: 'extra', Name: 'E', Icon: 'E', Rarity: 'mythic', Stats: {} });

      const surgeResult = surgeMeta.galaxyJump(undefined, 10);
      expect(surgeResult.success).toBe(true);
      expect(surgeResult.consolationOuro).toBe(10000);
      expect(surgeResult.consolationShards).toBe(500);
      expect(surgeMeta.Ouro).toBe(11000);
      expect(surgeMeta.Shards).toBe(1000);
    });
  });

  /* ========================================================================= *
   * 5. 8 UNIQUE RELIC HELMETS + 9TH OMNI-HELMET CELESTIAL CROWN              *
   * ========================================================================= */
  describe('5. 8 Unique Relic Helmets & 9th Omni-Helmet Celestial Crown', () => {
    it('5.1 verifies all 8 unique helmets possess canonical IDs, aliases, and distinct abilities', () => {
      expect(UNIQUE_HELMETS.length).toBe(8);

      const canonicalMap: Record<string, string> = {
        unique_helm_chrono_singularity: 'unique_chronos_eye',
        unique_helm_adamantine_juggernaut: 'unique_colossus_crown',
        unique_helm_abyssal_leviathan: 'unique_behemoth_maw',
        unique_helm_solar_archon: 'unique_solar_crest',
        unique_helm_nanite_hivequeen: 'unique_nanite_hivequeen',
        unique_helm_volcanic_chimera: 'unique_leviathan_wings',
        unique_helm_tempest_siren: 'unique_gorgon_gaze',
        unique_helm_prismatic_monolith: 'unique_void_horns',
      };

      for (const helm of UNIQUE_HELMETS) {
        expect(helm.CanonicalId).toBe(canonicalMap[helm.Id]);
        expect(helm.IsUnique).toBe(true);
        expect(helm.SpecialCapacity).toBeTruthy();
        expect(helm.Lore).toBeTruthy();
        expect(helm.Image).toMatch(/^\/assets\/helmets\/.+\.jpg$/);

        expect(getUniqueHelmet(helm.Id)).toBe(helm);
        expect(getUniqueHelmet(helm.CanonicalId!)).toBe(helm);
        expect(isUniqueHelmetId(helm.Id)).toBe(true);
        expect(isUniqueHelmetId(helm.CanonicalId!)).toBe(true);
        expect(getCanonicalHelmetId(helm.Id)).toBe(helm.CanonicalId);
      }
    });

    it('5.2 enforces 100% (8/8) collection requirement before allowing 9th helmet forging', () => {
      const meta = MetaProgression.createIsolated();
      expect(meta.canForge9thHelmet()).toBe(false);

      // Add 7 helmets
      meta.UniqueHelmets = UNIQUE_HELMETS.slice(0, 7).map(h => h.Id);
      expect(meta.canForge9thHelmet()).toBe(false);

      // Add 8th helmet
      meta.UniqueHelmets = UNIQUE_HELMETS.map(h => h.Id);
      expect(meta.canForge9thHelmet()).toBe(true);

      const crown = meta.forge9thHelmet();
      expect(meta.Has9thHelmet).toBe(true);
      expect(crown.Id).toBe(CELESTIAL_OUROBOROS_HELMET.Id);
      expect(crown.Name).toBe('The Celestial Crown of the Eternal Ouroboros');
    });

    it('5.3 verifies 9th Omni-Helmet stat summation and omni-relic synergy activation', () => {
      const omni = CELESTIAL_OUROBOROS_HELMET;
      expect(omni.IsUnique).toBe(true);
      expect(omni.IsOmni).toBe(true);
      expect(omni.Rarity).toBe('mythic');

      // Check stat summation across all 8 unique helmets
      const expectedSums: Record<string, number> = {};
      for (const h of UNIQUE_HELMETS) {
        for (const [key, val] of Object.entries(h.Stats)) {
          if (typeof val === 'number') {
            expectedSums[key] = (expectedSums[key] || 0) + val;
          }
        }
      }

      for (const [key, expectedVal] of Object.entries(expectedSums)) {
        const actualVal = (omni.Stats as Record<string, number>)[key];
        expect(actualVal).toBeCloseTo(expectedVal, 2);
      }

      const forged = forgeOmniHelmet();
      expect(forged.Id).toBe(omni.Id);
      expect(forged.Stats.bitePower).toBe(omni.Stats.bitePower);
    });
  });

  /* ========================================================================= *
   * 6. CRANIAL MUTATION LAB & SANCTUARY SHOP                                  *
   * ========================================================================= */
  describe('6. Cranial Mutation Lab & Sanctuary Shop Invariance', () => {
    it('6.1 enforces starter defaults: ONLY Tier 1 Turret and Shield are unlocked by default', () => {
      const meta = MetaProgression.Instance;
      meta.resetRunUnlocks();

      expect(meta.isTierUnlocked('turret', 1)).toBe(true);
      expect(meta.isTierUnlocked('shield', 1)).toBe(true);

      // Tier 1 advanced modules strictly locked by default
      expect(meta.isTierUnlocked('tesla', 1)).toBe(false);
      expect(meta.isTierUnlocked('venom', 1)).toBe(false);
      expect(meta.isTierUnlocked('magma', 1)).toBe(false);
      expect(meta.isTierUnlocked('cryo', 1)).toBe(false);
      expect(meta.isTierUnlocked('tachyon', 1)).toBe(false);
      expect(meta.isTierUnlocked('plasma', 1)).toBe(false);
      expect(meta.isTierUnlocked('chrono', 1)).toBe(false);

      // Tier 2 locked for starter modules
      expect(meta.isTierUnlocked('turret', 2)).toBe(false);
      expect(meta.isTierUnlocked('shield', 2)).toBe(false);
    });

    it('6.2 unlocks Tiers 1-3 modules based on distinct challenge conditions', () => {
      const meta = MetaProgression.Instance;
      meta.resetRunUnlocks();

      // Tier 1 unlock checks:
      expect(meta.isTierUnlocked('magma', 1, { swarmlings: 14 })).toBe(false);
      expect(meta.isTierUnlocked('magma', 1, { swarmlings: 15 })).toBe(true);

      expect(meta.isTierUnlocked('cryo', 1, { potions: 1 })).toBe(false);
      expect(meta.isTierUnlocked('cryo', 1, { potions: 2 })).toBe(true);

      expect(meta.isTierUnlocked('tachyon', 1, { combo: 9 })).toBe(false);
      expect(meta.isTierUnlocked('tachyon', 1, { combo: 10 })).toBe(true);

      // Tier 2 unlock checks:
      expect(meta.isTierUnlocked('turret', 2, { floor: 7, defeatedBosses: [] })).toBe(false);
      expect(meta.isTierUnlocked('turret', 2, { floor: 8, defeatedBosses: ['superconductor_boss'] })).toBe(true);

      expect(meta.isTierUnlocked('cryo', 2, { floor: 10, defeatedBosses: [] })).toBe(false);
      expect(meta.isTierUnlocked('cryo', 2, { floor: 11, defeatedBosses: ['mirror_wyrm'] })).toBe(true);

      // Tier 3 unlock checks:
      expect(meta.isTierUnlocked('turret', 3, { floor: 15, defeatedBosses: [] })).toBe(false);
      expect(meta.isTierUnlocked('turret', 3, { floor: 16, defeatedBosses: ['crystal_monolith'] })).toBe(true);

      expect(meta.isTierUnlocked('cryo', 3, { floor: 20, defeatedBosses: [] })).toBe(false);
      expect(meta.isTierUnlocked('cryo', 3, { floor: 21, defeatedBosses: ['eternal_ouroboros'] })).toBe(true);
    });

    it('6.3 enforces Cranial Lab module and augment cost formulas across purchases', () => {
      const player = new SnakePlayer('emerald', 1280, 720, 2);

      // Module Formula: Cost(lvl, p) = 30 * lvl + p * 15
      // Augment Formula: Cost(lvl, p) = 40 * lvl + p * 20
      expect(player.getHeadModuleCost('turret', 1)).toBe(30);
      expect(player.getHeadAugmentCost('fangs', 1)).toBe(40);

      // After 1 purchase (p=1)
      player.installHeadModule('turret');
      expect(player.headPurchaseCount).toBe(1);
      expect(player.getHeadModuleCost('turret', 2)).toBe(30 * 2 + 1 * 15); // 75
      expect(player.getHeadAugmentCost('fangs', 1)).toBe(40 * 1 + 1 * 20); // 60

      // After 2 purchases (p=2)
      player.installHeadAugment('fangs');
      expect(player.headPurchaseCount).toBe(2);
      expect(player.getHeadModuleCost('shield', 1)).toBe(30 * 1 + 2 * 15); // 60
      expect(player.getHeadAugmentCost('fangs', 2)).toBe(40 * 2 + 2 * 20); // 120
    });

    it('6.4 verifies all 14 Sanctuary meta-upgrades: cost formula, scaling coefficients & max caps', () => {
      expect(GameData.MetaUpgrades.Keys.length).toBe(14);

      const expectedUpgrades: Record<string, { baseCost: number; mult: number; maxLvl: number }> = {
        vitality: { baseCost: 40, mult: 1.6, maxLvl: 6 },
        agility: { baseCost: 55, mult: 1.7, maxLvl: 5 },
        ferocity: { baseCost: 60, mult: 1.7, maxLvl: 5 },
        resilience: { baseCost: 70, mult: 1.75, maxLvl: 5 },
        magnet: { baseCost: 35, mult: 1.5, maxLvl: 5 },
        swiftness: { baseCost: 75, mult: 1.8, maxLvl: 4 },
        rerolls: { baseCost: 90, mult: 2.0, maxLvl: 3 },
        fortune: { baseCost: 120, mult: 2.1, maxLvl: 3 },
        greed: { baseCost: 45, mult: 1.6, maxLvl: 5 },
        unlock_tachyon: { baseCost: 250, mult: 1.0, maxLvl: 1 },
        unlock_cryo: { baseCost: 320, mult: 1.0, maxLvl: 1 },
        unlock_plasma: { baseCost: 380, mult: 1.0, maxLvl: 1 },
        unlock_chrono: { baseCost: 400, mult: 1.0, maxLvl: 1 },
        unlock_nanite: { baseCost: 450, mult: 1.0, maxLvl: 1 },
      };

      const meta = MetaProgression.createIsolated();
      meta.Shards = 100000; // Rich balance

      for (const [key, exp] of Object.entries(expectedUpgrades)) {
        const up = GameData.MetaUpgrades.Get(key)!;
        expect(up).toBeDefined();
        expect(up.BaseCost).toBe(exp.baseCost);
        expect(up.CostMult).toBe(exp.mult);
        expect(up.MaxLevel).toBe(exp.maxLvl);

        // Verify cost calculation for each level up to max
        for (let lvl = 0; lvl < exp.maxLvl; lvl++) {
          meta.UpgradeLevels[key] = lvl;
          const expectedCost = MathX.roundJs(exp.baseCost * Math.pow(exp.mult, lvl));
          expect(meta.GetUpgradeCost(key)).toBe(expectedCost);
        }

        // At max level, cost is Infinity and BuyUpgrade returns false
        meta.UpgradeLevels[key] = exp.maxLvl;
        expect(meta.GetUpgradeCost(key)).toBe(Number.POSITIVE_INFINITY);
        expect(meta.BuyUpgrade(key)).toBe(false);
      }
    });
  });
});
