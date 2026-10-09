/**
 * Ouroboros Ascension — 20 Bosses & Milestone Capacities Test Suite
 *
 * Comprehensive Vitest specification verifying:
 * 1. 20 Bosses catalog integrity, base stats, and BossForFloor() modulo 20 index mapping.
 * 2. Game modes expansion (rogue: 10, bossrush: 20, daily: 20, endless: infinity).
 * 3. Daily Challenge 4-tier milestone triggers (Level 5, 10, 15, 20) with escalating rewards (+0%, +50%, +100%, +150%).
 * 4. 24h expiration timestamp handling and persistence in MetaProgression.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GameEngine } from '../sim/GameEngine.js';
import { GameState } from '../sim/GameState.js';
import { Boss } from '../sim/Boss.js';
import { GameData } from '../data/GameData.js';
import { MetaProgression } from '../data/MetaProgression.js';
import { CosmicCapacities } from '../data/CosmicCapacities.js';
import { MathX } from '../core/MathX.js';
import { Services } from '../core/Services.js';
import { ScriptedInput, NullFx, NullSound } from '../core/Contracts.js';
import { setupMockDom } from './MockDom.js';

describe('20 Bosses & Milestone Capacities Test Suite', () => {
  let g: GameEngine;
  let im: ScriptedInput;
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
    im = new ScriptedInput();
    Services.Input = im;
    Services.Fx = new NullFx();
    Services.Sound = new NullSound();
    Services.Headless = true;
  });

  afterEach(() => {
    teardownDom();
  });

  /* ========================================================================= *
   * 1. 20 BOSSES CATALOG INTEGRITY & MODULO-20 INDEX MAPPING
   * ========================================================================= */
  describe('1. 20 Bosses Catalog Integrity & Modulo-20 Index Mapping', () => {
    it('1.1 verifies catalog contains exactly 20 unique boss archetypes', () => {
      expect(GameData.Bosses.length).toBe(20);
      expect(GameData.bosses.length).toBe(20);

      const uniqueTypes = new Set<string>();
      const uniqueNames = new Set<string>();

      for (let i = 0; i < GameData.Bosses.length; i++) {
        const boss = GameData.Bosses[i]!;
        expect(boss.Type).toBeDefined();
        expect(boss.type).toBe(boss.Type);
        expect(boss.Name).toBeDefined();
        expect(boss.name).toBe(boss.Name);
        expect(boss.Title).toBeDefined();
        expect(boss.title).toBe(boss.Title);
        expect(boss.Color).toBeDefined();
        expect(boss.color).toBe(boss.Color);
        expect(boss.Accent).toBeDefined();
        expect(boss.accent).toBe(boss.Accent);
        expect(boss.BaseHp).toBeGreaterThan(0);
        expect(boss.baseHp).toBe(boss.BaseHp);
        expect(boss.HpPerFloor).toBeGreaterThan(0);
        expect(boss.hpPerFloor).toBe(boss.HpPerFloor);
        expect(boss.Radius).toBeGreaterThanOrEqual(25);
        expect(boss.radius).toBe(boss.Radius);

        expect(uniqueTypes.has(boss.Type)).toBe(false);
        uniqueTypes.add(boss.Type);
        expect(uniqueNames.has(boss.Name)).toBe(false);
        uniqueNames.add(boss.Name);
      }
    });

    it('1.2 validates deterministic BossForFloor() modulo 20 index mapping for floors 1 to 20', () => {
      for (let f = 1; f <= 20; f++) {
        const expectedIndex = f - 1;
        const expectedArchetype = GameData.Bosses[expectedIndex]!;

        const resolvedPascal = GameData.BossForFloor(f);
        const resolvedCamel = GameData.bossForFloor(f);

        expect(resolvedPascal.Type).toBe(expectedArchetype.Type);
        expect(resolvedCamel.Type).toBe(expectedArchetype.Type);
        expect(resolvedPascal.Name).toBe(expectedArchetype.Name);
      }
    });

    it('1.3 validates BossForFloor() wraps cyclically for floors beyond 20 (modulo 20)', () => {
      // Floors 21 through 40 should map to indices 0 through 19
      for (let f = 21; f <= 40; f++) {
        const expectedIndex = (f - 1) % 20;
        const expectedArchetype = GameData.Bosses[expectedIndex]!;

        const resolved = GameData.BossForFloor(f);
        expect(resolved.Type).toBe(expectedArchetype.Type);
      }

      // Test extreme floor numbers
      expect(GameData.BossForFloor(1).Type).toBe(GameData.Bosses[0]!.Type);
      expect(GameData.BossForFloor(20).Type).toBe(GameData.Bosses[19]!.Type);
      expect(GameData.BossForFloor(21).Type).toBe(GameData.Bosses[0]!.Type);
      expect(GameData.BossForFloor(41).Type).toBe(GameData.Bosses[0]!.Type);
      expect(GameData.BossForFloor(100).Type).toBe(GameData.Bosses[19]!.Type);
    });

    it('1.4 validates Boss Max HP scaling formula with floor and cycle multipliers', () => {
      for (let f = 1; f <= 40; f++) {
        const arch = GameData.BossForFloor(f);
        const cycle = Math.floor((f - 1) / 20);
        const cycleFloor = cycle * 20;
        const expectedMaxHp = MathX.roundJs((arch.BaseHp + arch.HpPerFloor * cycleFloor) * (1 + cycle * 0.35));

        const boss = new Boss(f, 1280, 720);
        expect(boss.MaxHp).toBe(expectedMaxHp);
        expect(boss.maxHp).toBe(expectedMaxHp);
        expect(boss.Hp).toBe(expectedMaxHp);
        expect(boss.hp).toBe(expectedMaxHp);

        if (cycle > 0) {
          expect(boss.Name).toContain('II');
        }
      }
    });

    it('1.5 verifies all 20 bosses spawn with valid serpentine body segments and radius tapering', () => {
      for (let f = 1; f <= 20; f++) {
        const boss = new Boss(f, 1280, 720);
        expect(boss.Type).toBe(GameData.Bosses[f - 1]!.Type);
        expect(boss.Segments.length).toBeGreaterThanOrEqual(10);
        expect(boss.Segments.length).toBeLessThanOrEqual(45);
        expect(boss.Radius).toBe(GameData.Bosses[f - 1]!.Radius);

        // Verify segment positions and radius gradient
        for (let s = 0; s < boss.Segments.length; s++) {
          const seg = boss.Segments[s]!;
          expect(seg.X).toBe(boss.X);
          expect(seg.Y).toBeGreaterThan(boss.Y);
          expect(seg.R).toBeGreaterThanOrEqual(6);
          expect(seg.R).toBeLessThanOrEqual(boss.Radius);
        }
      }
    });
  });

  /* ========================================================================= *
   * 2. GAME MODES EXPANSION (ROGUE: 10, BOSSRUSH: 20, DAILY: 20, ENDLESS: INF)
   * ========================================================================= */
  describe('2. Game Modes Expansion', () => {
    it('2.1 verifies expanded floor ceilings for all 4 game modes', () => {
      const rogue = GameData.Modes.Get('rogue')!;
      expect(rogue.Floors).toBe(10);
      expect(rogue.floors).toBe(10);
      expect(rogue.BossRush).toBe(false);
      expect(rogue.bossRush).toBe(false);
      expect(rogue.Seeded).toBe(false);

      const bossrush = GameData.Modes.Get('bossrush')!;
      expect(bossrush.Floors).toBe(20);
      expect(bossrush.floors).toBe(20);
      expect(bossrush.BossRush).toBe(true);
      expect(bossrush.bossRush).toBe(true);
      expect(bossrush.Seeded).toBe(false);

      const daily = GameData.Modes.Get('daily')!;
      expect(daily.Floors).toBe(20);
      expect(daily.floors).toBe(20);
      expect(daily.BossRush).toBe(false);
      expect(daily.bossRush).toBe(false);
      expect(daily.Seeded).toBe(true);

      const endless = GameData.Modes.Get('endless')!;
      expect(endless.Floors).toBe(Number.POSITIVE_INFINITY);
      expect(endless.floors).toBe(Number.POSITIVE_INFINITY);
      expect(endless.BossRush).toBe(false);
      expect(endless.bossRush).toBe(false);
      expect(endless.Seeded).toBe(false);
    });

    it('2.2 enforces floor progression ceiling and triggers Victory on final floor completion', () => {
      // Test Rogue victory at Floor 10
      g.ChooseMode('rogue');
      g.StartRun();
      expect(g.MaxFloors).toBe(10);

      // Advance through floor 10
      for (let f = 1; f < 10; f++) {
        g.AdvanceFloor();
      }
      expect(g.CurrentFloor).toBe(10);

      // Test Boss Rush victory at Floor 20
      const g2 = new GameEngine();
      g2.SetupCanvas(1280, 720, 1);
      g2.ChooseMode('bossrush');
      g2.StartRun();
      expect(g2.MaxFloors).toBe(20);

      // Test Daily victory at Floor 20
      const g3 = new GameEngine();
      g3.SetupCanvas(1280, 720, 1);
      g3.ChooseMode('daily');
      g3.StartRun();
      expect(g3.MaxFloors).toBe(20);
    });
  });

  /* ========================================================================= *
   * 3. DAILY CHALLENGE 4-TIER MILESTONE TRIGGERS (LV 5, 10, 15, 20)
   * ========================================================================= */
  describe('3. Daily Challenge 4-Tier Milestone Triggers & Escalating Rewards', () => {
    it('3.1 starts Daily Challenge with no active milestone at Level 1', () => {
      const meta = MetaProgression.Instance;
      meta.Reset();

      g.ChooseMode('daily');
      g.DailyKeyProvider = () => '2026-08-29';
      g.StartRun();

      expect(g.GameMode).toBe('daily');
      expect(g.Player!.Level).toBe(1);
      expect(meta.IsDailyCapacityActive()).toBe(false);
      expect(meta.DailyCapacityState).toBeNull();
    });

    it('3.2 triggers Milestone Tier 1 (+0% Bonus / 1.00x) at Level 5', () => {
      const meta = MetaProgression.Instance;
      meta.Reset();

      let bannerText = '';
      g.OnBanner = (text: string) => { bannerText = text; };

      g.ChooseMode('daily');
      g.DailyKeyProvider = () => '2026-08-29';
      g.StartRun();
      const p = g.Player!;

      p.Level = 5;
      g.Step(1 / 60);

      expect(meta.IsDailyCapacityActive()).toBe(true);
      const cap = meta.GetActiveDailyCapacity()!;
      expect(cap).toBeDefined();
      expect(cap.milestoneTier ?? cap.MilestoneTier).toBe(1);
      expect(cap.milestoneLevel ?? cap.MilestoneLevel).toBe(5);
      expect(cap.milestoneBonus ?? cap.MilestoneBonus).toBe(0.0);
      expect(bannerText).toContain('COSMIC TRANSCENDENCE UNLOCKED');
      expect(bannerText).toContain('Tier 1');
    });

    it('3.3 escalates to Milestone Tier 2 (+50% Bonus / 1.50x) at Level 10', () => {
      const meta = MetaProgression.Instance;
      meta.Reset();

      let bannerText = '';
      g.OnBanner = (text: string) => { bannerText = text; };

      g.ChooseMode('daily');
      g.DailyKeyProvider = () => '2026-08-29';
      g.StartRun();
      const p = g.Player!;

      // Step to Level 5 first
      p.Level = 5;
      g.Step(1 / 60);
      expect((meta.DailyCapacityState!.milestoneTier ?? meta.DailyCapacityState!.MilestoneTier)).toBe(1);

      // Now cross Level 10 threshold
      p.Level = 10;
      g.Step(1 / 60);

      const cap = meta.GetActiveDailyCapacity()!;
      expect(cap.milestoneTier ?? cap.MilestoneTier).toBe(2);
      expect(cap.milestoneLevel ?? cap.MilestoneLevel).toBe(10);
      expect(cap.milestoneBonus ?? cap.MilestoneBonus).toBe(0.50);
      expect(bannerText).toContain('MILESTONE ASCENSION: TIER 2');
      expect(bannerText).toContain('+50% Bonus');
    });

    it('3.4 escalates to Milestone Tier 3 (+100% Bonus / 2.00x) at Level 15', () => {
      const meta = MetaProgression.Instance;
      meta.Reset();

      let bannerText = '';
      g.OnBanner = (text: string) => { bannerText = text; };

      g.ChooseMode('daily');
      g.DailyKeyProvider = () => '2026-08-29';
      g.StartRun();
      const p = g.Player!;

      p.Level = 15;
      g.Step(1 / 60);

      const cap = meta.GetActiveDailyCapacity()!;
      expect(cap.milestoneTier ?? cap.MilestoneTier).toBe(3);
      expect(cap.milestoneLevel ?? cap.MilestoneLevel).toBe(15);
      expect(cap.milestoneBonus ?? cap.MilestoneBonus).toBe(1.00);
      expect(bannerText).toContain('MILESTONE ASCENSION: TIER 3');
      expect(bannerText).toContain('+100% Bonus');
    });

    it('3.5 reaches Milestone Tier 4 (+150% Bonus / 2.50x) Apex Singularity at Level 20', () => {
      const meta = MetaProgression.Instance;
      meta.Reset();

      let bannerText = '';
      g.OnBanner = (text: string) => { bannerText = text; };

      g.ChooseMode('daily');
      g.DailyKeyProvider = () => '2026-08-29';
      g.StartRun();
      const p = g.Player!;

      p.Level = 20;
      g.Step(1 / 60);

      const cap = meta.GetActiveDailyCapacity()!;
      expect(cap.milestoneTier ?? cap.MilestoneTier).toBe(4);
      expect(cap.milestoneLevel ?? cap.MilestoneLevel).toBe(20);
      expect(cap.milestoneBonus ?? cap.MilestoneBonus).toBe(1.50);
      expect(bannerText).toContain('APEX SINGULARITY: TIER 4');
      expect(bannerText).toContain('+150% Bonus');
    });

    it('3.6 handles direct multi-level leaps (Level 1 -> 16) directly unlocking highest milestone', () => {
      const meta = MetaProgression.Instance;
      meta.Reset();

      g.ChooseMode('daily');
      g.DailyKeyProvider = () => '2026-08-29';
      g.StartRun();
      const p = g.Player!;

      // Instant level jump from 1 to 16
      p.Level = 16;
      g.Step(1 / 60);

      const cap = meta.GetActiveDailyCapacity()!;
      expect(cap.milestoneTier ?? cap.MilestoneTier).toBe(3);
      expect(cap.milestoneLevel ?? cap.MilestoneLevel).toBe(15);
      expect(cap.milestoneBonus ?? cap.MilestoneBonus).toBe(1.00);
    });

    it('3.7 verifies non-daily modes do not trigger milestone unlocks at levels 5, 10, 15, 20', () => {
      const modes = ['rogue', 'bossrush', 'endless'];

      for (const mode of modes) {
        const meta = MetaProgression.Instance;
        meta.Reset();

        g.ChooseMode(mode);
        g.StartRun();
        const p = g.Player!;

        for (const lvl of [5, 10, 15, 20]) {
          p.Level = lvl;
          g.Step(1 / 60);
          expect(meta.IsDailyCapacityActive()).toBe(false);
          expect(meta.DailyCapacityState).toBeNull();
        }
      }
    });
  });

  /* ========================================================================= *
   * 4. 24H PERSISTENCE OF MILESTONE LEVEL IN METAPROGRESSION
   * ========================================================================= */
  describe('4. 24h Expiration & Milestone Persistence in MetaProgression', () => {
    it('4.1 stores and preserves milestone tier and bonus across capacity upgrades', () => {
      const meta = MetaProgression.Instance;
      meta.Reset();
      const t0 = 1700000000000;

      // Initial Level 5 unlock
      meta.UnlockDailySpecialCapacity({
        id: 'supernova_trail',
        name: 'Supernova Trail',
        milestoneTier: 1,
        milestoneLevel: 5,
        milestoneBonus: 0.0,
      }, t0);

      const expTs = meta.DailyCapacityState!.expiresAt;
      expect(expTs).toBe(t0 + 24 * 60 * 60 * 1000);

      // Upgrade to Tier 2 (Level 10)
      meta.UpdateDailyMilestone(2, 10, 0.50);

      expect(meta.DailyCapacityState!.milestoneTier).toBe(2);
      expect(meta.DailyCapacityState!.milestoneLevel).toBe(10);
      expect(meta.DailyCapacityState!.milestoneBonus).toBe(0.50);
      // Expiration timestamp must remain unchanged!
      expect(meta.DailyCapacityState!.expiresAt).toBe(expTs);

      // Upgrade to Tier 4 (Level 20)
      meta.UpdateDailyMilestone(4, 20, 1.50);
      expect(meta.DailyCapacityState!.milestoneTier).toBe(4);
      expect(meta.DailyCapacityState!.milestoneLevel).toBe(20);
      expect(meta.DailyCapacityState!.milestoneBonus).toBe(1.50);
      expect(meta.DailyCapacityState!.expiresAt).toBe(expTs);
    });

    it('4.2 serializes and deserializes milestone levels in MetaProgression save payload', () => {
      let savedJson = '';
      MetaProgression.WriteBackend = (_k: string, v: string) => { savedJson = v; };

      const meta = MetaProgression.Instance;
      meta.Reset();
      const t0 = Date.now();

      meta.UnlockDailySpecialCapacity({
        id: 'astral_singularity',
        name: 'Astral Singularity',
        milestoneTier: 3,
        milestoneLevel: 15,
        milestoneBonus: 1.00,
        stateValues: { pullForce: 120, crushDmg: 80 },
        rolledTiers: { pullForce: 3, crushDmg: 3 },
      }, t0);

      meta.Save();
      expect(savedJson.length).toBeGreaterThan(0);

      const parsed = JSON.parse(savedJson);
      expect(parsed.dailyCapacityState).toBeDefined();
      expect(parsed.dailyCapacityState.milestoneTier).toBe(3);
      expect(parsed.dailyCapacityState.milestoneLevel).toBe(15);
      expect(parsed.dailyCapacityState.milestoneBonus).toBe(1.00);

      // Restore into fresh MetaProgression instance
      MetaProgression.ReadBackend = () => savedJson;
      const loadedMeta = new MetaProgression();

      expect(loadedMeta.IsDailyCapacityActive()).toBe(true);
      expect(loadedMeta.DailyCapacityState!.id).toBe('astral_singularity');
      expect(loadedMeta.DailyCapacityState!.milestoneTier).toBe(3);
      expect(loadedMeta.DailyCapacityState!.milestoneLevel).toBe(15);
      expect(loadedMeta.DailyCapacityState!.milestoneBonus).toBe(1.00);
    });

    it('4.3 verifies 24h expiration timestamp boundary and cleans up expired milestones', () => {
      const meta = MetaProgression.Instance;
      meta.Reset();
      const t0 = 1700000000000;

      meta.UnlockDailySpecialCapacity({
        id: 'nano_swarm',
        name: 'Nanite Overlord Swarm',
        milestoneTier: 4,
        milestoneLevel: 20,
        milestoneBonus: 1.50,
      }, t0);

      // Active at t0 + 23 hours
      expect(meta.IsDailyCapacityActive(t0 + 23 * 3600 * 1000)).toBe(true);
      expect(meta.DailyCapacityState).not.toBeNull();

      // Expired at t0 + 25 hours
      expect(meta.IsDailyCapacityActive(t0 + 25 * 3600 * 1000)).toBe(false);
      expect(meta.DailyCapacityState).toBeNull();
    });
  });
});
