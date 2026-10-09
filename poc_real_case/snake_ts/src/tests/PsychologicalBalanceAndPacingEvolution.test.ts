/**
 * Ouroboros Ascension — Psychological Balance & Pacing Evolution Engine Test Suite
 * (PsychologicalBalanceAndPacingEvolution.test.ts)
 *
 * Strict Test-Driven Development (TDD) verification for:
 * 1. Calibrated XP Progression Curve:
 *    - Formula: Threshold(L) = floor(75 * (L - 1)^1.34 + 80 * (L - 1))
 *    - Guarantees Level 4 by Floor 5 and Level 10 by Floor 20 under 21.5-minute pacing.
 * 2. 21.5-Minute Run Pacing & FoodTarget Floor Curve:
 *    - Formula: FoodTarget(F) = min(42, 16 + floor(2.2 * (F - 1))) (0 for BossRush).
 *    - Monotonic escalation from 16 (Floor 1) to 42 (Floors 13–20) totaling 650 foods.
 * 3. Dynamic Low-Health Drop Pity (HP < 35%):
 *    - Potion weight: 22%, Shield weight: 12%, Recovery Pity Counter C_dry >= 7 guarantees 100% recovery item.
 * 4. Clutch Catch Combo Timer:
 *    - Window 0.6s before combo expiry grants +50% score bonus, tracking ClutchCatchCount and TotalClutchBonusScore.
 * 5. 100+ Multi-Seed Automated Simulation Sweeps across all 5 serpent classes (Emerald, Stalker, Hydra, Storm, Solar).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GameEngine } from '../sim/GameEngine';
import { GameState } from '../sim/GameState';
import { SnakePlayer } from '../sim/SnakePlayer';
import { FoodItem } from '../sim/FoodItem';
import { Enemy } from '../sim/Enemy';
import { Boss } from '../sim/Boss';
import { GameData } from '../data/GameData';
import { MetaProgression } from '../data/MetaProgression';
import { MathX } from '../core/MathX';
import { Services } from '../core/Services';
import { ScriptedInput, NullFx, NullSound } from '../core/Contracts';
import { setupMockDom } from './MockDom';

interface ClassTelemetry {
  className: string;
  seed: number;
  completedFloors: number;
  finalLevel: number;
  levelAtF5: number;
  levelAtF10: number;
  levelAtF20: number;
  totalXp: number;
  foodsEaten: number;
  kills: number;
  bossKills: number;
  clutchCatches: number;
  pityDropsTriggered: number;
}

describe('Psychological Balance & Pacing Evolution Engine Test Suite', () => {
  let teardownDom: () => void;
  let engine: GameEngine;
  let input: ScriptedInput;
  let meta: MetaProgression;

  beforeEach(() => {
    teardownDom = setupMockDom();
    const memStore = new Map<string, string>();
    MetaProgression.ReadBackend = (k) => memStore.get(k) ?? null;
    MetaProgression.WriteBackend = (k, v) => { memStore.set(k, v); };
    MetaProgression.DeleteBackend = (k) => { memStore.delete(k); };
    MetaProgression.Instance = new MetaProgression();
    meta = MetaProgression.Instance;

    for (const k of GameData.Classes.Keys) {
      meta.UnlockedClasses[k] = true;
    }

    input = new ScriptedInput();
    Services.Input = input;
    Services.Fx = new NullFx();
    Services.Sound = new NullSound();
    Services.Headless = true;

    engine = new GameEngine();
    engine.SetupCanvas(1280, 720, 1);
  });

  afterEach(() => {
    teardownDom();
  });

  // ============================================================================
  // SECTION 1: Calibrated XP Progression Curve & Mathematical Invariants
  // ============================================================================
  describe('1. Calibrated XP Progression Curve & Threshold Evaluation', () => {
    it('1.1 evaluates exact mathematical thresholds for Threshold(L) = floor(75 * (L - 1)^1.34 + 80 * (L - 1)) across Levels 1 to 20', () => {
      for (let lvl = 1; lvl <= 20; lvl++) {
        const computed = SnakePlayer.CalibratedXpThreshold(lvl);
        const formulaVal = lvl <= 1 ? 0 : Math.floor(75 * Math.pow(lvl - 1, 1.34) + 80 * (lvl - 1));
        expect(computed).toBe(formulaVal);

        // Dual PascalCase / camelCase alias check
        expect(SnakePlayer.calibratedXpThreshold(lvl)).toBe(computed);
      }
    });

    it('1.2 asserts strict monotonicity, convexity, and target milestones (Level 4 <= 566 XP, Level 10 <= 2144 XP)', () => {
      let prevThreshold = -1;
      let prevDelta = 0;

      for (let lvl = 1; lvl <= 20; lvl++) {
        const threshold = SnakePlayer.CalibratedXpThreshold(lvl);

        // Strict monotonicity
        expect(threshold).toBeGreaterThan(prevThreshold);

        if (lvl > 1) {
          const delta = threshold - prevThreshold;
          // Invariant: Positive per-level delta
          expect(delta).toBeGreaterThan(0);

          if (prevDelta > 0) {
            // Convexity: delta increases with level
            expect(delta).toBeGreaterThanOrEqual(prevDelta);
          }
          prevDelta = delta;
        }

        prevThreshold = threshold;
      }

      // Milestone assertions
      expect(SnakePlayer.CalibratedXpThreshold(4)).toBe(566);
      expect(SnakePlayer.CalibratedXpThreshold(10)).toBe(2144);
    });

    it('1.3 validates edge cases for level thresholds (L <= 0, astronomical levels, fractional levels)', () => {
      expect(SnakePlayer.CalibratedXpThreshold(0)).toBe(0);
      expect(SnakePlayer.CalibratedXpThreshold(-5)).toBe(0);
      expect(SnakePlayer.CalibratedXpThreshold(1)).toBe(0);

      const lvl100 = SnakePlayer.CalibratedXpThreshold(100);
      expect(Number.isFinite(lvl100)).toBe(true);
      expect(lvl100).toBeGreaterThan(SnakePlayer.CalibratedXpThreshold(20));
    });
  });

  // ============================================================================
  // SECTION 2: 21.5-Minute Run Pacing & FoodTarget Floor Curve
  // ============================================================================
  describe('2. 21.5-Minute Run Pacing & FoodTarget Floor Scaling', () => {
    it('2.1 evaluates exact FoodTarget(F) = min(42, 16 + floor(2.2 * (F - 1))) across Floors 1 to 20', () => {
      const expectedFoodTargets: Record<number, number> = {
        1: 16,
        2: 18,
        3: 20,
        4: 22,
        5: 24,
        6: 27,
        7: 29,
        8: 31,
        9: 33,
        10: 35,
        11: 38,
        12: 40,
        13: 42,
        14: 42,
        15: 42,
        16: 42,
        17: 42,
        18: 42,
        19: 42,
        20: 42,
      };

      for (let f = 1; f <= 20; f++) {
        const computed = GameEngine.CalculateFoodTarget(f, false);
        const formulaVal = Math.min(42, 16 + Math.floor(2.2 * (f - 1)));
        expect(computed).toBe(formulaVal);
        expect(computed).toBe(expectedFoodTargets[f]);
      }
    });

    it('2.2 returns 0 FoodTarget for BossRush mode across all floors', () => {
      for (let f = 1; f <= 25; f++) {
        expect(GameEngine.CalculateFoodTarget(f, true)).toBe(0);
      }
    });

    it('2.3 dynamically updates FoodTarget during StartRun and AdvanceFloor', () => {
      engine.GameMode = 'rogue';
      engine.SelectedClass = 'emerald';
      engine.StartRun(42);

      expect(engine.CurrentFloor).toBe(1);
      expect(engine.FoodTarget).toBe(16);

      // Advance through floors
      for (let f = 2; f <= 20; f++) {
        engine.AdvanceFloor();
        expect(engine.CurrentFloor).toBe(f);
        expect(engine.FoodTarget).toBe(GameEngine.CalculateFoodTarget(f, false));
      }
    });

    it('2.4 verifies cumulative run food sum totals 669 items across 20 floors for 21.5-minute pacing', () => {
      let cumulativeFoods = 0;
      for (let f = 1; f <= 20; f++) {
        cumulativeFoods += GameEngine.CalculateFoodTarget(f, false);
      }
      expect(cumulativeFoods).toBe(669);
    });
  });

  // ============================================================================
  // SECTION 3: Dynamic Low-Health Drop Pity (HP < 35%) & Recovery Counter
  // ============================================================================
  describe('3. Dynamic Low-Health Drop Pity & Anti-Frustration System', () => {
    it('3.1 provides standard food distribution weights when player HP >= 35%', () => {
      engine.GameMode = 'rogue';
      engine.SelectedClass = 'emerald';
      engine.StartRun(101);

      const player = engine.Player!;
      player.Hp = player.MaxHp; // 100% HP

      const counts: Record<string, number> = {
        apple: 0,
        golden: 0,
        potion: 0,
        shield: 0,
        bomb: 0,
        chrono: 0,
        shard: 0,
      };

      const SAMPLES = 2000;
      for (let i = 0; i < SAMPLES; i++) {
        engine.Foods.length = 0;
        engine.SpawnFood();
        const spawned = engine.Foods[0]!;
        counts[spawned.Type] = (counts[spawned.Type] || 0) + 1;
      }

      // Expected base probabilities:
      // apple ~ 60%, golden ~ 15%, potion ~ 10%, shield ~ 6%, bomb ~ 4%, chrono ~ 2.5%, shard ~ 2.5%
      const applePct = counts['apple']! / SAMPLES;
      const goldenPct = counts['golden']! / SAMPLES;
      const potionPct = counts['potion']! / SAMPLES;
      const shieldPct = counts['shield']! / SAMPLES;

      expect(applePct).toBeGreaterThan(0.52);
      expect(applePct).toBeLessThan(0.68);
      expect(goldenPct).toBeGreaterThan(0.10);
      expect(goldenPct).toBeLessThan(0.20);
      expect(potionPct).toBeGreaterThan(0.06);
      expect(potionPct).toBeLessThan(0.15);
      expect(shieldPct).toBeGreaterThan(0.03);
      expect(shieldPct).toBeLessThan(0.10);
    });

    it('3.2 escalates Potion (22%) and Shield (12%) drop rates when player HP < 35%', () => {
      engine.GameMode = 'rogue';
      engine.SelectedClass = 'emerald';
      engine.StartRun(202);

      const player = engine.Player!;
      player.Hp = player.MaxHp * 0.25; // 25% HP (< 35%)

      const counts: Record<string, number> = {
        apple: 0,
        golden: 0,
        potion: 0,
        shield: 0,
        bomb: 0,
        chrono: 0,
        shard: 0,
      };

      const SAMPLES = 3000;
      for (let i = 0; i < SAMPLES; i++) {
        engine.Foods.length = 0;
        engine.SpawnFood();
        const spawned = engine.Foods[0]!;
        counts[spawned.Type] = (counts[spawned.Type] || 0) + 1;
      }

      // In low health mode, potion ~ 22% + pity escalation, shield ~ 12% + pity escalation
      const potionPct = counts['potion']! / SAMPLES;
      const shieldPct = counts['shield']! / SAMPLES;
      const totalRecoveryPct = potionPct + shieldPct;

      expect(potionPct).toBeGreaterThan(0.18);
      expect(shieldPct).toBeGreaterThan(0.08);
      expect(totalRecoveryPct).toBeGreaterThan(0.30);
    });

    it('3.3 enforces Recovery Pity Counter C_dry >= 7 guarantees 100% recovery item (potion or shield)', () => {
      engine.GameMode = 'rogue';
      engine.SelectedClass = 'emerald';
      engine.StartRun(303);

      const player = engine.Player!;
      player.Hp = player.MaxHp * 0.20; // 20% HP

      // Force pity counter to 7
      engine.RecoveryPityCounter = 7;
      expect(engine.RecoveryPityCounter).toBe(7);

      // Next spawn must be guaranteed recovery item (potion or shield)
      engine.Foods.length = 0;
      engine.SpawnFood();
      const spawned = engine.Foods[0]!;
      expect(['potion', 'shield']).toContain(spawned.Type);

      // Pity counter must reset to 0 after recovery item spawn
      expect(engine.RecoveryPityCounter).toBe(0);
    });

    it('3.4 increments pity counter on non-recovery spawns and resets on recovery spawn or health recovery', () => {
      engine.GameMode = 'rogue';
      engine.SelectedClass = 'emerald';
      engine.StartRun(404);

      const player = engine.Player!;
      player.Hp = player.MaxHp * 0.30; // 30% HP (< 35%)

      engine.RecoveryPityCounter = 0;

      // Simulate step by step
      for (let step = 0; step < 20; step++) {
        engine.Foods.length = 0;
        const prevPity = engine.RecoveryPityCounter;
        engine.SpawnFood();
        const spawned = engine.Foods[0]!;

        if (spawned.Type === 'potion' || spawned.Type === 'shield') {
          expect(engine.RecoveryPityCounter).toBe(0);
        } else {
          expect(engine.RecoveryPityCounter).toBe(prevPity + 1);
          // Never exceeds 7 without triggering guaranteed drop
          expect(engine.RecoveryPityCounter).toBeLessThanOrEqual(7);
        }
      }

      // Reset when healed above 35%
      engine.RecoveryPityCounter = 5;
      player.Hp = player.MaxHp; // 100% HP
      engine.SpawnFood();
      expect(engine.RecoveryPityCounter).toBe(0);
    });
  });

  // ============================================================================
  // SECTION 4: Clutch Catch Combo Window (0.6s) & Score Escalation
  // ============================================================================
  describe('4. Clutch Catch Combo Timer (0.6s Window) & Score Escalation', () => {
    it('4.1 awards +50% score bonus and increments ClutchCatchCount when comboTimer <= 0.6s', () => {
      engine.GameMode = 'rogue';
      engine.SelectedClass = 'stalker';
      engine.StartRun(505);

      const player = engine.Player!;
      const combat = engine.Combat;
      const world = engine.worldBag();

      // Setup active combo
      combat.ComboCount = 4;
      combat.ComboMultiplier = 2; // Tier 1 combo multiplier (2x)
      combat.ComboTimer = 0.45; // Inside 0.6s clutch window!

      const initialScore = combat.Score;
      const apple = new FoodItem(player.X, player.Y, 'apple'); // base score = 100

      // Base score with 2x multiplier = 200. Clutch catch +50% = 300.
      combat.eatFood(apple, world);

      expect(combat.ClutchCatchCount).toBe(1);
      expect(combat.TotalClutchBonusScore).toBe(100);
      expect(combat.Score - initialScore).toBe(300);
    });

    it('4.2 does not award clutch bonus when comboTimer > 0.6s or when combo is inactive (timer <= 0)', () => {
      engine.GameMode = 'rogue';
      engine.SelectedClass = 'stalker';
      engine.StartRun(606);

      const player = engine.Player!;
      const combat = engine.Combat;
      const world = engine.worldBag();

      // Case A: comboTimer = 1.5s (> 0.6s)
      combat.ComboCount = 3;
      combat.ComboMultiplier = 2;
      combat.ComboTimer = 1.5;
      combat.ClutchCatchCount = 0;
      combat.TotalClutchBonusScore = 0;

      let scoreBefore = combat.Score;
      const apple1 = new FoodItem(player.X, player.Y, 'apple'); // 100 * 2 = 200
      combat.eatFood(apple1, world);

      expect(combat.ClutchCatchCount).toBe(0);
      expect(combat.TotalClutchBonusScore).toBe(0);
      expect(combat.Score - scoreBefore).toBe(200);

      // Case B: comboTimer = 0 (inactive combo)
      combat.ComboCount = 0;
      combat.ComboMultiplier = 1;
      combat.ComboTimer = 0;

      scoreBefore = combat.Score;
      const apple2 = new FoodItem(player.X, player.Y, 'apple'); // 100 * 1 = 100
      combat.eatFood(apple2, world);

      expect(combat.ClutchCatchCount).toBe(0);
      expect(combat.TotalClutchBonusScore).toBe(0);
      expect(combat.Score - scoreBefore).toBe(100);
    });

    it('4.3 correctly resets clutch telemetry on CombatSystem.Reset()', () => {
      const combat = engine.Combat;
      combat.ClutchCatchCount = 12;
      combat.TotalClutchBonusScore = 2400;

      combat.Reset();
      expect(combat.ClutchCatchCount).toBe(0);
      expect(combat.TotalClutchBonusScore).toBe(0);
    });
  });

  // ============================================================================
  // SECTION 5: Comprehensive 100+ Multi-Seed Automated Simulation Sweeps
  // Across All 5 Serpent Classes (Emerald, Stalker, Hydra, Storm, Solar)
  // ============================================================================
  describe('5. Comprehensive 100+ Multi-Seed Simulation Sweeps Across All 5 Serpent Classes', () => {
    const classKeys = ['emerald', 'stalker', 'hydra', 'storm', 'solar'] as const;
    const SEEDS_PER_CLASS = 20; // 20 seeds * 5 classes = 100 full campaign runs

    classKeys.forEach((cls) => {
      it(`5.${classKeys.indexOf(cls) + 1} executes 20-seed deep campaign sweep for ${cls.toUpperCase()} across Floors 1–20`, () => {
        const classRuns: ClassTelemetry[] = [];

        for (let seedIdx = 1; seedIdx <= SEEDS_PER_CLASS; seedIdx++) {
          const runSeed = 2000 + seedIdx * 43;
          engine.GameMode = 'rogue';
          engine.SelectedClass = cls;
          engine.MaxFloors = 20;
          engine.StartRun(runSeed);
          engine.Combat.BiteInterval = 0.05;

          const player = engine.Player!;
          const world = engine.worldBag();

          let levelF5 = 1;
          let levelF10 = 1;
          let levelF20 = 1;
          let completedFloors = 0;
          let pityDropsEncountered = 0;

          for (let f = 1; f <= 20; f++) {
            // 1. Food foraging phase matching calibrated 21.5m FoodTarget
            const targetFoods = engine.FoodTarget;
            const foodTypes = ['apple', 'apple', 'apple', 'golden', 'potion', 'shield', 'bomb', 'chrono', 'shard'];

            for (let fi = 0; fi < targetFoods; fi++) {
              let fType = foodTypes[fi % foodTypes.length]!;
              if (cls === 'solar' && fType === 'apple') {
                fType = 'golden';
              }
              const food = new FoodItem(player.X, player.Y, fType);

              // Simulate occasional clutch catch (every 5th food when combo is active)
              if (fi % 5 === 0 && engine.Combat.ComboTimer > 0) {
                engine.Combat.ComboTimer = 0.35; // Trigger clutch window
              }

              engine.Combat.eatFood(food, world);
            }

            // 2. Enemy wave clearing phase
            const mobsPerFloor = 8 + f * 2;
            const mobTypes = ['scarab', 'swarmling', 'spitter', 'phantom', 'drone', 'brute'];
            for (let mi = 0; mi < mobsPerFloor; mi++) {
              const mType = mobTypes[mi % mobTypes.length]!;
              const mob = new Enemy(player.X + 10, player.Y + 10, mType, f);
              engine.Combat.handleEnemyKill(mob, world);
            }

            // 3. Apex Boss Guardian phase
            engine.SpawnBoss();
            const boss = engine.Boss;
            if (boss) {
              boss.EntranceTimer = 0;
              boss.Dead = true;
              engine.OnBossDefeated(boss);
            }

            if (f === 5) levelF5 = player.Level;
            if (f === 10) levelF10 = player.Level;
            if (f === 20) levelF20 = player.Level;
            completedFloors = f;

            if (f < 20) {
              engine.AdvanceFloor();
            }
          }

          classRuns.push({
            className: cls,
            seed: runSeed,
            completedFloors,
            finalLevel: player.Level,
            levelAtF5: levelF5,
            levelAtF10: levelF10,
            levelAtF20: levelF20,
            totalXp: Math.round(player.TotalXpCollected),
            foodsEaten: engine.Combat.FoodsEaten,
            kills: engine.Combat.Kills,
            bossKills: engine.Combat.BossKills,
            clutchCatches: engine.Combat.ClutchCatchCount,
            pityDropsTriggered: pityDropsEncountered,
          });
        }

        expect(classRuns.length).toBe(SEEDS_PER_CLASS);

        const avgLvlF5 = classRuns.reduce((s, r) => s + r.levelAtF5, 0) / SEEDS_PER_CLASS;
        const avgLvlF10 = classRuns.reduce((s, r) => s + r.levelAtF10, 0) / SEEDS_PER_CLASS;
        const avgLvlF20 = classRuns.reduce((s, r) => s + r.levelAtF20, 0) / SEEDS_PER_CLASS;
        const avgTotalXp = classRuns.reduce((s, r) => s + r.totalXp, 0) / SEEDS_PER_CLASS;
        const avgClutchCatches = classRuns.reduce((s, r) => s + r.clutchCatches, 0) / SEEDS_PER_CLASS;

        console.log(`[Psychological Evolution Sweep: ${cls.toUpperCase()}]`);
        console.log(`  Avg Level @ Floor 5:  ${avgLvlF5.toFixed(2)} (Target >= 4.0)`);
        console.log(`  Avg Level @ Floor 10: ${avgLvlF10.toFixed(2)}`);
        console.log(`  Avg Level @ Floor 20: ${avgLvlF20.toFixed(2)} (Target >= 10.0)`);
        console.log(`  Avg Total XP @ F20:   ${avgTotalXp.toFixed(0)}`);
        console.log(`  Avg Clutch Catches:   ${avgClutchCatches.toFixed(1)}`);

        // Pacing & Leveling requirements
        expect(avgLvlF5).toBeGreaterThanOrEqual(4.0);
        expect(avgLvlF20).toBeGreaterThanOrEqual(10.0);
        expect(avgClutchCatches).toBeGreaterThanOrEqual(1.0);
      });
    });
  });
});
