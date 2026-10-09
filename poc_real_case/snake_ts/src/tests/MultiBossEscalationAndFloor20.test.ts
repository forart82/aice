/**
 * Ouroboros Ascension — Multi-Boss Escalation & 20-Floor Sequence Test Suite
 *
 * Comprehensive Vitest specification verifying:
 * 1. 20-floor single boss sequence (Floors 1 to 20 spawning 1 boss per floor).
 * 2. Floors 21-30 spawning 2 random bosses simultaneously.
 * 3. Floors 31-40 spawning 3 random bosses simultaneously.
 * 4. All active bosses must be defeated to clear the floor.
 * 5. Diverse mixed challenges across Tiers 1, 2, and 3 (food, kills, bosses, specific boss defeats, combos, length).
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
import { SnakePlayer, SnakeSegment } from '../sim/SnakePlayer.js';

describe('Multi-Boss Escalation & Floor 20 Test Suite', () => {
  let g: GameEngine;
  let im: ScriptedInput;
  let teardownDom: () => void;
  let meta: MetaProgression;

  beforeEach(() => {
    teardownDom = setupMockDom();

    const memStore = new Map<string, string>();
    MetaProgression.ReadBackend = (key) => memStore.get(key) ?? null;
    MetaProgression.WriteBackend = (key, val) => { memStore.set(key, val); };
    MetaProgression.DeleteBackend = (key) => { memStore.delete(key); };
    MetaProgression.Instance = new MetaProgression();
    meta = MetaProgression.Instance;

    g = new GameEngine();
    g.SetupCanvas(1280, 720, 1);
    g.Player = new SnakePlayer('emerald', 1280, 720, 3);
    g.Player.Hp = 100;
    g.State = GameState.Playing;
    g.LabIntroSeen = true;
    im = new ScriptedInput();
    Services.Input = im;
    Services.Fx = new NullFx();
    Services.Sound = new NullSound();
    Services.Headless = true;
    Services.registerEngineProvider(() => g);
    Services.registerMetaProvider(() => meta);
  });

  afterEach(() => {
    teardownDom();
  });

  /* ========================================================================= *
   * 1. 20-FLOOR SINGLE BOSS SEQUENCE (FLOORS 1 TO 20)
   * ========================================================================= */
  describe('1. 20-Floor Single Boss Sequence (Floors 1 to 20)', () => {
    it('1.1 verifies floors 1 to 20 spawn exactly 1 boss matching GameData.BossForFloor(floor)', () => {
      for (let floor = 1; floor <= 20; floor++) {
        g.CurrentFloor = floor;
        g.Bosses = [];
        g.SpawnBoss();

        expect(g.Bosses.length).toBe(1);
        expect(g.Boss).not.toBeNull();
        expect(g.Boss).toBe(g.Bosses[0]);

        const expectedArch = GameData.BossForFloor(floor);
        expect(g.Boss!.Type).toBe(expectedArch.Type);
        expect(g.Boss!.Name).toBe(expectedArch.Name);
        expect(g.Boss!.MaxHp).toBeGreaterThan(0);
        expect(g.Boss!.Hp).toBe(g.Boss!.MaxHp);
      }
    });

    it('1.2 verifies defeating the single boss on floors 1-20 clears the floor', () => {
      g.CurrentFloor = 5;
      g.MaxFloors = 20;
      g.State = GameState.Playing;
      g.SpawnBoss();

      expect(g.Bosses.length).toBe(1);
      const boss = g.Bosses[0]!;
      boss.Hp = 0;
      boss.Dead = true;

      g.Step(0.016);

      expect(g.Bosses.length).toBe(0);
      expect(g.Boss).toBeNull();
      expect(g.State).toBe(GameState.FloorClear);
      expect(g.Combat.BossKills).toBe(1);
    });
  });

  /* ========================================================================= *
   * 2. FLOORS 21-30 DUAL BOSS ESCALATION (2 RANDOM BOSSES SIMULTANEOUSLY)
   * ========================================================================= */
  describe('2. Floors 21-30 Dual Boss Escalation', () => {
    it('2.1 spawns exactly 2 random bosses simultaneously on floors 21-30', () => {
      for (let floor = 21; floor <= 30; floor++) {
        g.CurrentFloor = floor;
        g.Bosses = [];
        g.SpawnBoss();

        expect(g.Bosses.length).toBe(2);
        expect(g.Boss).not.toBeNull();
        expect(g.Boss).toBe(g.Bosses[0]);

        const b1 = g.Bosses[0]!;
        const b2 = g.Bosses[1]!;

        expect(b1.Hp).toBeGreaterThan(0);
        expect(b2.Hp).toBeGreaterThan(0);
        expect(b1.Dead).toBe(false);
        expect(b2.Dead).toBe(false);
        expect(b1.Floor).toBe(floor);
        expect(b2.Floor).toBe(floor);

        // Verify spatial separation between the 2 bosses
        expect(b1.X).not.toBe(b2.X);
      }
    });

    it('2.2 executes updates for both bosses simultaneously in GameEngine.Step', () => {
      g.CurrentFloor = 25;
      g.State = GameState.Playing;
      g.SpawnBoss();

      expect(g.Bosses.length).toBe(2);
      const b1 = g.Bosses[0]!;
      const b2 = g.Bosses[1]!;

      const initialEntrance1 = b1.EntranceTimer;
      const initialEntrance2 = b2.EntranceTimer;

      g.Step(0.1);

      expect(b1.EntranceTimer).toBeLessThan(initialEntrance1);
      expect(b2.EntranceTimer).toBeLessThan(initialEntrance2);
    });
  });

  /* ========================================================================= *
   * 3. FLOORS 31-40 TRI BOSS ESCALATION (3 RANDOM BOSSES SIMULTANEOUSLY)
   * ========================================================================= */
  describe('3. Floors 31-40 Tri Boss Escalation', () => {
    it('3.1 spawns exactly 3 random bosses simultaneously on floors 31-40', () => {
      for (let floor = 31; floor <= 40; floor += 3) {
        g.CurrentFloor = floor;
        g.Bosses = [];
        g.SpawnBoss();

        expect(g.Bosses.length).toBe(3);
        const b1 = g.Bosses[0]!;
        const b2 = g.Bosses[1]!;
        const b3 = g.Bosses[2]!;

        expect(b1.Hp).toBeGreaterThan(0);
        expect(b2.Hp).toBeGreaterThan(0);
        expect(b3.Hp).toBeGreaterThan(0);
        expect(b1.Floor).toBe(floor);
        expect(b2.Floor).toBe(floor);
        expect(b3.Floor).toBe(floor);

        // Verify all 3 bosses have distinct X coordinates
        const xCoords = new Set([b1.X, b2.X, b3.X]);
        expect(xCoords.size).toBe(3);
      }
    });

    it('3.2 steps all 3 bosses concurrently and updates multi-phase combat', () => {
      g.CurrentFloor = 35;
      g.State = GameState.Playing;
      g.SpawnBoss();

      expect(g.Bosses.length).toBe(3);
      const b1 = g.Bosses[0]!;
      const b2 = g.Bosses[1]!;
      const b3 = g.Bosses[2]!;

      g.Step(0.05);

      expect(b1.EntranceTimer).toBeLessThan(1.4);
      expect(b2.EntranceTimer).toBeLessThan(1.4);
      expect(b3.EntranceTimer).toBeLessThan(1.4);
    });
  });

  /* ========================================================================= *
   * 4. MULTI-BOSS DEFEAT GATE (ALL ACTIVE BOSSES MUST BE DEFEATED TO CLEAR)
   * ========================================================================= */
  describe('4. Multi-Boss Defeat Gate (All Active Bosses Must Be Defeated)', () => {
    it('4.1 defeating 1 of 2 bosses on Floor 25 keeps floor active and retains remaining boss', () => {
      g.CurrentFloor = 25;
      g.MaxFloors = 50;
      g.State = GameState.Playing;
      g.SpawnBoss();

      expect(g.Bosses.length).toBe(2);
      const b1 = g.Bosses[0]!;
      const b2 = g.Bosses[1]!;

      // Defeat boss 1 only
      b1.Hp = 0;
      b1.Dead = true;
      g.Step(0.016);

      // Verify game state is STILL Playing (floor not cleared yet!)
      expect(g.State).toBe(GameState.Playing);
      expect(g.Bosses.length).toBe(1);
      expect(g.Bosses[0]).toBe(b2);
      expect(g.Combat.BossKills).toBe(1);
      expect(g.HelmetDrops.length).toBe(1);

      // Now defeat boss 2
      b2.Hp = 0;
      b2.Dead = true;
      g.Step(0.016);

      // Now floor transitions to FloorClear!
      expect(g.Bosses.length).toBe(0);
      expect(g.State).toBe(GameState.FloorClear);
      expect(g.Combat.BossKills).toBe(2);
      expect(g.HelmetDrops.length).toBe(2);
    });

    it('4.2 defeating 3 bosses in sequence on Floor 35 clears floor only after 3rd boss falls', () => {
      g.CurrentFloor = 35;
      g.MaxFloors = 50;
      g.State = GameState.Playing;
      g.SpawnBoss();

      expect(g.Bosses.length).toBe(3);
      const b1 = g.Bosses[0]!;
      const b2 = g.Bosses[1]!;
      const b3 = g.Bosses[2]!;

      // Defeat boss 1
      b1.Hp = 0;
      b1.Dead = true;
      g.Step(0.016);
      expect(g.State).toBe(GameState.Playing);
      expect(g.Bosses.length).toBe(2);
      expect(g.Combat.BossKills).toBe(1);

      // Defeat boss 2
      b2.Hp = 0;
      b2.Dead = true;
      g.Step(0.016);
      expect(g.State).toBe(GameState.Playing);
      expect(g.Bosses.length).toBe(1);
      expect(g.Combat.BossKills).toBe(2);

      // Defeat boss 3
      b3.Hp = 0;
      b3.Dead = true;
      g.Step(0.016);
      expect(g.State).toBe(GameState.FloorClear);
      expect(g.Bosses.length).toBe(0);
      expect(g.Combat.BossKills).toBe(3);
      expect(g.HelmetDrops.length).toBe(3);
    });
  });

  /* ========================================================================= *
   * 5. DIVERSE MIXED CHALLENGES ACROSS TIERS 1, 2, AND 3
   * ========================================================================= */
  describe('5. Diverse Mixed Challenges Across Tiers 1, 2, and 3', () => {
    beforeEach(() => {
      meta.ResetRunUnlocks();
    });

    it('5.1 verifies Food Collection challenges (T1: 45, T2: 150, T3: 300 foods)', () => {
      // Crown / Crest require food collection
      expect(meta.IsTierUnlocked('crown', 1, { foods: 44 })).toBe(false);
      expect(meta.IsTierUnlocked('crown', 1, { foods: 45 })).toBe(true);

      expect(meta.IsTierUnlocked('crown', 2, { foods: 149 })).toBe(false);
      expect(meta.IsTierUnlocked('crown', 2, { foods: 150 })).toBe(true);

      expect(meta.IsTierUnlocked('crown', 3, { foods: 299 })).toBe(false);
      expect(meta.IsTierUnlocked('crown', 3, { foods: 300 })).toBe(true);

      // Test post-run evaluation via RunSummary
      meta.ResetRunUnlocks();
      meta.EvaluateChallenges({ foods: 160 });
      expect(meta.IsTierUnlocked('crown', 1)).toBe(true);
      expect(meta.IsTierUnlocked('crown', 2)).toBe(true);
      expect(meta.IsTierUnlocked('crown', 3)).toBe(false);
    });

    it('5.2 verifies Enemy Kill & Bestiary challenges (T1: 10 scarabs horns, 25 scattershot, T2: 15 drones venom, 12 phantoms spikes)', () => {
      expect(meta.IsTierUnlocked('horns', 1, { scarabs: 9 })).toBe(false);
      expect(meta.IsTierUnlocked('horns', 1, { scarabs: 10 })).toBe(true);

      expect(meta.IsTierUnlocked('scattershot', 1, { kills: 24 })).toBe(false);
      expect(meta.IsTierUnlocked('scattershot', 1, { kills: 25 })).toBe(true);

      expect(meta.IsTierUnlocked('venom', 2, { arc_drones: 14 })).toBe(false);
      expect(meta.IsTierUnlocked('venom', 2, { arc_drones: 15 })).toBe(true);

      expect(meta.IsTierUnlocked('spikes', 2, { phantoms: 11 })).toBe(false);
      expect(meta.IsTierUnlocked('spikes', 2, { phantoms: 12 })).toBe(true);
    });

    it('5.3 verifies Boss Kill Count challenges (T2: 8 horns, T3: 15 flak, 18 spikes, 18 nanite)', () => {
      expect(meta.IsTierUnlocked('horns', 2, { bosses: 7 })).toBe(false);
      expect(meta.IsTierUnlocked('horns', 2, { bosses: 8 })).toBe(true);

      expect(meta.IsTierUnlocked('flak', 3, { bosses: 14 })).toBe(false);
      expect(meta.IsTierUnlocked('flak', 3, { bosses: 15 })).toBe(true);

      expect(meta.IsTierUnlocked('spikes', 3, { bosses: 17 })).toBe(false);
      expect(meta.IsTierUnlocked('spikes', 3, { bosses: 18 })).toBe(true);

      expect(meta.IsTierUnlocked('nanite', 3, { bosses: 17 })).toBe(false);
      expect(meta.IsTierUnlocked('nanite', 3, { bosses: 18 })).toBe(true);
    });

    it('5.4 verifies Specific Boss Archetype Defeat challenges', () => {
      // Maw T1: Centipede (Floor 1)
      expect(meta.IsTierUnlocked('maw', 1, { floor: 1, bosses: 0 })).toBe(false);
      expect(meta.IsTierUnlocked('maw', 1, { floor: 2 })).toBe(true);

      // Flak T1: Storm Gorgon (Floor 2)
      expect(meta.IsTierUnlocked('flak', 1, { floor: 2, bosses: 1 })).toBe(false);
      expect(meta.IsTierUnlocked('flak', 1, { floor: 3 })).toBe(true);

      // Needler T1: Infernal Colossus (Floor 3)
      expect(meta.IsTierUnlocked('needler', 1, { floor: 3, bosses: 2 })).toBe(false);
      expect(meta.IsTierUnlocked('needler', 1, { floor: 4 })).toBe(true);

      // Chrono T1: Chrono Wyrm (Floor 5)
      expect(meta.IsTierUnlocked('chrono', 1, { floor: 5, bosses: 4 })).toBe(false);
      expect(meta.IsTierUnlocked('chrono', 1, { floor: 6 })).toBe(true);

      // Turret T2: Superconductor (Floor 7)
      expect(meta.IsTierUnlocked('turret', 2, { floor: 7, bosses: 6 })).toBe(false);
      expect(meta.IsTierUnlocked('turret', 2, { floor: 8 })).toBe(true);

      // Cryo T3: The Eternal Ouroboros (Floor 20)
      expect(meta.IsTierUnlocked('cryo', 3, { floor: 20, bosses: 19 })).toBe(false);
      expect(meta.IsTierUnlocked('cryo', 3, { floor: 21 })).toBe(true);
    });

    it('5.5 verifies Combo Streak challenges (T2: 20x tesla, 20x fangs, 25x flak, T3: 40x tesla)', () => {
      expect(meta.IsTierUnlocked('tesla', 2, { combo: 19 })).toBe(false);
      expect(meta.IsTierUnlocked('tesla', 2, { combo: 20 })).toBe(true);

      expect(meta.IsTierUnlocked('fangs', 2, { combo: 19 })).toBe(false);
      expect(meta.IsTierUnlocked('fangs', 2, { combo: 20 })).toBe(true);

      expect(meta.IsTierUnlocked('flak', 2, { combo: 24 })).toBe(false);
      expect(meta.IsTierUnlocked('flak', 2, { combo: 25 })).toBe(true);

      expect(meta.IsTierUnlocked('tesla', 3, { combo: 39 })).toBe(false);
      expect(meta.IsTierUnlocked('tesla', 3, { combo: 40 })).toBe(true);
    });

    it('5.6 verifies Serpent Length Milestone challenges (35, 600, 1200, 1500)', () => {
      const desktopCtx = { arenaW: 1600, arenaH: 960 };

      // Plasma T1 (35)
      expect(meta.IsTierUnlocked('plasma', 1, { ...desktopCtx, length: 34 })).toBe(false);
      expect(meta.IsTierUnlocked('plasma', 1, { ...desktopCtx, length: 35 })).toBe(true);

      // Shield T2 (600)
      meta.ResetRunUnlocks();
      expect(meta.IsTierUnlocked('shield', 2, { ...desktopCtx, length: 599 })).toBe(false);
      expect(meta.IsTierUnlocked('shield', 2, { ...desktopCtx, length: 600 })).toBe(true);

      // Scattershot T3 (1200)
      meta.ResetRunUnlocks();
      expect(meta.IsTierUnlocked('scattershot', 3, { ...desktopCtx, length: 1199 })).toBe(false);
      expect(meta.IsTierUnlocked('scattershot', 3, { ...desktopCtx, length: 1200 })).toBe(true);

      // Plasma T3 (1500)
      meta.ResetRunUnlocks();
      expect(meta.IsTierUnlocked('plasma', 3, { ...desktopCtx, length: 1499 })).toBe(false);
      expect(meta.IsTierUnlocked('plasma', 3, { ...desktopCtx, length: 1500 })).toBe(true);

      // Tachyon T3 (1500)
      meta.ResetRunUnlocks();
      expect(meta.IsTierUnlocked('tachyon', 3, { ...desktopCtx, length: 1499 })).toBe(false);
      expect(meta.IsTierUnlocked('tachyon', 3, { ...desktopCtx, length: 1500 })).toBe(true);
    });
  });
});
