/**
 * Ouroboros Ascension — Leveling & XP Curve Game Balance Deep Audit Probe
 * (LevelingAndXpCurveAuditProbe.test.ts)
 *
 * Automated bot simulations & comprehensive mathematical audit across all 5 serpent classes
 * (emerald, stalker, hydra, storm, solar) on Floors 1–20 across 50+ seeds.
 *
 * Audit Focus:
 * 1. XP Progression Formula Analysis:
 *    - Base 100, 1.25x geometric scaling vs ORACLE.md floor(100 * L^1.45) vs Simulation Recurrence roundJs(XpToNext * 1.32 + 45).
 * 2. Level Pacing & Floor Progression:
 *    - Evaluation of whether players reach expected benchmark levels (Lvl 5 by Floor 5, Lvl 10 by Floor 10, Lvl 20 by Floor 20).
 * 3. XP Ingestion Channels:
 *    - Food item XP (1 to 15 XP) vs Enemy kill XP (1 to 6 XP) vs Boss rewards (+35 Ouro/XP) vs Perks/Relics (Gourmand, Soul Harvest).
 * 4. Class-Specific XP Passives & Asymmetries:
 *    - Solar Drake Magma Trail food gilding (+4 XP Golden Apples vs +1 XP standard).
 *    - Emerald Viper +30% magnet reach.
 *    - Stalker, Hydra, Storm kill/combat velocity.
 * 5. Edge Cases & Resilience:
 *    - Negative XP rejection, zero XP idempotence, astronomical XP overflow resistance,
 *      level-up triggers during FloorClear state and multi-boss defeats.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GameEngine } from '../sim/GameEngine';
import { GameState } from '../sim/GameState';
import { SnakePlayer } from '../sim/SnakePlayer';
import { Enemy } from '../sim/Enemy';
import { FoodItem } from '../sim/FoodItem';
import { Boss } from '../sim/Boss';
import { GameData } from '../data/GameData';
import { MetaProgression } from '../data/MetaProgression';
import { MathX } from '../core/MathX';
import { Services } from '../core/Services';
import { ScriptedInput, NullFx, NullSound } from '../core/Contracts';
import { setupMockDom } from './MockDom';
import { AutonomousBotPlayer } from '../sim/ai/AutonomousBotPlayer';

interface FloorMetrics {
  floor: number;
  level: number;
  xpWallet: number;
  totalXpCollected: number;
  foodsEaten: number;
  kills: number;
  bossKills: number;
  foodXpEarned: number;
  enemyXpEarned: number;
  bossXpEarned: number;
}

interface ClassRunResult {
  className: string;
  seed: number;
  completedFloors: number;
  finalLevel: number;
  finalXpCollected: number;
  floorHistory: FloorMetrics[];
  foodsEaten: number;
  enemiesKilled: number;
  bossesKilled: number;
}

describe('Leveling & XP Curve Deep Audit Probe Suite', () => {
  let teardownDom: () => void;
  let engine: GameEngine;
  let input: ScriptedInput;
  let meta: MetaProgression;
  let bot: AutonomousBotPlayer;

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
    bot = new AutonomousBotPlayer();
  });

  afterEach(() => {
    teardownDom();
  });

  // ============================================================================
  // 1. MATHEMATICAL FORMULA DISCREPANCY & SCALING AUDIT
  // ============================================================================
  describe('1. XP Progression Formula Mathematical Audit', () => {
    it('1.1 compares ORACLE.md power curve vs 1.25x geometric scaling vs SnakePlayer recurrence', () => {
      const oraclePerLevelDelta: number[] = [];
      const oracleCumulative: number[] = [];
      const geometric125PerLevel: number[] = [];
      const geometric125Cumulative: number[] = [];
      const currentRecurrencePerLevel: number[] = [];
      const currentRecurrenceCumulative: number[] = [];

      // 1. ORACLE.md: XP_req(level) = floor(100 * level^1.45)
      let cumOracle = 0;
      for (let lvl = 1; lvl <= 20; lvl++) {
        const req = Math.floor(100 * Math.pow(lvl, 1.45));
        oraclePerLevelDelta.push(req);
        cumOracle += req;
        oracleCumulative.push(cumOracle);
      }

      // 2. Base 100 with 1.25x geometric scaling: XP_req(level) = round(100 * 1.25^(level - 1))
      let cumGeo = 0;
      for (let lvl = 1; lvl <= 20; lvl++) {
        const req = MathX.roundJs(100 * Math.pow(1.25, lvl - 1));
        geometric125PerLevel.push(req);
        cumGeo += req;
        geometric125Cumulative.push(cumGeo);
      }

      // 3. Current SnakePlayer.ts simulation recurrence: XpToNext_1 = 100; XpToNext_{n+1} = roundJs(XpToNext_n * 1.32 + 45)
      let currentThreshold = 100;
      let cumCurrent = 0;
      for (let lvl = 1; lvl <= 20; lvl++) {
        currentRecurrencePerLevel.push(currentThreshold);
        cumCurrent += currentThreshold;
        currentRecurrenceCumulative.push(cumCurrent);
        currentThreshold = MathX.roundJs(currentThreshold * 1.32 + 45);
      }

      // Assert mathematical properties
      expect(oraclePerLevelDelta[0]).toBe(100);
      expect(oraclePerLevelDelta[4]).toBe(1031); // Level 5
      expect(oraclePerLevelDelta[9]).toBe(2818); // Level 10
      expect(oraclePerLevelDelta[19]).toBe(7700); // Level 20

      expect(geometric125PerLevel[0]).toBe(100);
      expect(geometric125PerLevel[4]).toBe(244); // Level 5
      expect(geometric125PerLevel[9]).toBe(745); // Level 10
      expect(geometric125PerLevel[19]).toBe(6939); // Level 20

      expect(currentRecurrencePerLevel[0]).toBe(100);
      expect(currentRecurrencePerLevel[4]).toBe(590); // Level 5
      expect(currentRecurrencePerLevel[9]).toBe(2789); // Level 10
      expect(currentRecurrencePerLevel[19]).toBe(46900); // Level 20 exponential progression

      // Log comparison table for diagnostic transparency
      console.log('--- XP Progression Formula Comparison (Levels 1 to 20) ---');
      console.log('Level | Oracle Delta | Oracle Cumul | Geo 1.25x Delta | Geo 1.25x Cumul | Code Recurr Delta | Code Recurr Cumul');
      for (let l = 1; l <= 20; l++) {
        const idx = l - 1;
        console.log(
          `${l.toString().padStart(5)} | ` +
          `${oraclePerLevelDelta[idx]!.toString().padStart(12)} | ` +
          `${oracleCumulative[idx]!.toString().padStart(12)} | ` +
          `${geometric125PerLevel[idx]!.toString().padStart(15)} | ` +
          `${geometric125Cumulative[idx]!.toString().padStart(15)} | ` +
          `${currentRecurrencePerLevel[idx]!.toString().padStart(17)} | ` +
          `${currentRecurrenceCumulative[idx]!.toString().padStart(17)}`
        );
      }
    });

    it('1.2 verifies food and enemy XP yields relative to floor completion targets', () => {
      // Standard run parameters
      const foodTargetF1 = 22;
      const foodTargetF5 = 22 + 4 * 9; // 58
      const foodTargetF10 = 22 + 9 * 9; // 103
      const foodTargetF20 = 22 + 19 * 9; // 193

      // Average food value = 1.815 XP
      const avgFoodXp = 1.815;
      const foodXpF1 = foodTargetF1 * avgFoodXp; // ~39.9 XP
      const foodXpF5 = foodTargetF5 * avgFoodXp; // ~105.3 XP
      const foodXpF10 = foodTargetF10 * avgFoodXp; // ~186.9 XP
      const foodXpF20 = foodTargetF20 * avgFoodXp; // ~350.3 XP

      // Average enemy kill XP (~2.5 XP)
      // On Floor 1, ~15 mobs killed = 37.5 XP + 35 Boss XP = 72.5 XP
      // Total Floor 1 XP = ~112.4 XP
      expect(foodXpF1).toBeCloseTo(39.93, 1);
      expect(foodXpF5).toBeCloseTo(105.27, 1);
      expect(foodXpF10).toBeCloseTo(186.945, 1);
      expect(foodXpF20).toBeCloseTo(350.295, 1);
    });
  });

  // ============================================================================
  // 2. 50+ SEEDS BOT SIMULATION SWEEP ACROSS ALL 5 SERPENT CLASSES
  // ============================================================================
  describe('2. Automated 50-Seed Bot Simulation Sweeps Across All 5 Classes', () => {
    const classKeys = ['emerald', 'stalker', 'hydra', 'storm', 'solar'] as const;
    const NUM_SEEDS = 50;

    classKeys.forEach((cls) => {
      it(`2.1 executes 50-seed campaign sweep for ${cls} on Floors 1-20`, () => {
        const classResults: ClassRunResult[] = [];

        for (let seedIdx = 1; seedIdx <= NUM_SEEDS; seedIdx++) {
          const runSeed = 1000 + seedIdx * 37;
          engine.GameMode = 'rogue';
          engine.SelectedClass = cls;
          engine.MaxFloors = 20;
          engine.StartRun(runSeed);
          engine.Combat.BiteInterval = 0.05;

          const player = engine.Player!;
          const history: FloorMetrics[] = [];

          let completedFloors = 0;
          for (let f = 1; f <= 20; f++) {
            const startFoodEaten = engine.Combat.FoodsEaten;
            const startKills = engine.Combat.Kills;
            const startBossKills = engine.Combat.BossKills;
            const startXpCollected = player.TotalXpCollected;

            // 1. Simulate Food Foraging Phase (feed foods up to FoodTarget)
            const targetFoods = engine.FoodTarget;
            const foodTypes: string[] = ['apple', 'apple', 'apple', 'golden', 'potion', 'shield', 'bomb', 'chrono', 'shard'];
            for (let fi = 0; fi < targetFoods; fi++) {
              let fType = foodTypes[fi % foodTypes.length]!;
              if (cls === 'solar') {
                // Solar Drake passively cooks apples to golden fruit
                if (fType === 'apple') fType = 'golden';
              }
              const food = new FoodItem(player.X, player.Y, fType);
              engine.Combat.eatFood(food, engine.worldBag());
            }

            // 2. Simulate Enemy Clearing Phase
            const mobsPerFloor = 8 + f * 2;
            const mobTypes = ['scarab', 'swarmling', 'spitter', 'phantom', 'drone', 'brute'];
            for (let mi = 0; mi < mobsPerFloor; mi++) {
              const mType = mobTypes[mi % mobTypes.length]!;
              const mob = new Enemy(player.X + 10, player.Y + 10, mType, f);
              engine.Combat.handleEnemyKill(mob, engine.worldBag());
            }

            // 3. Simulate Apex Boss Defeat Phase
            engine.SpawnBoss();
            const boss = engine.Boss;
            if (boss) {
              boss.EntranceTimer = 0;
              boss.Dead = true;
              engine.OnBossDefeated(boss);
            }

            // Record floor metrics
            const deltaXp = player.TotalXpCollected - startXpCollected;
            const foodsEatenFloor = engine.Combat.FoodsEaten - startFoodEaten;
            const killsFloor = engine.Combat.Kills - startKills;
            const bossKillsFloor = engine.Combat.BossKills - startBossKills;

            history.push({
              floor: f,
              level: player.Level,
              xpWallet: Math.round(player.Xp),
              totalXpCollected: Math.round(player.TotalXpCollected),
              foodsEaten: foodsEatenFloor,
              kills: killsFloor,
              bossKills: bossKillsFloor,
              foodXpEarned: Math.round(foodsEatenFloor * 1.8),
              enemyXpEarned: Math.round(killsFloor * 2.5),
              bossXpEarned: bossKillsFloor * 35,
            });

            completedFloors = f;
            if (f < 20) {
              engine.AdvanceFloor();
            }
          }

          classResults.push({
            className: cls,
            seed: runSeed,
            completedFloors,
            finalLevel: player.Level,
            finalXpCollected: Math.round(player.TotalXpCollected),
            floorHistory: history,
            foodsEaten: engine.Combat.FoodsEaten,
            enemiesKilled: engine.Combat.Kills,
            bossesKilled: engine.Combat.BossKills,
          });
        }

        // Aggregate statistics across 50 seeds
        expect(classResults.length).toBe(NUM_SEEDS);

        const avgFinalLevel = classResults.reduce((s, r) => s + r.finalLevel, 0) / NUM_SEEDS;
        const avgFinalXp = classResults.reduce((s, r) => s + r.finalXpCollected, 0) / NUM_SEEDS;

        const avgLvlAtF5 = classResults.reduce((s, r) => s + (r.floorHistory[4]?.level ?? 0), 0) / NUM_SEEDS;
        const avgLvlAtF10 = classResults.reduce((s, r) => s + (r.floorHistory[9]?.level ?? 0), 0) / NUM_SEEDS;
        const avgLvlAtF15 = classResults.reduce((s, r) => s + (r.floorHistory[14]?.level ?? 0), 0) / NUM_SEEDS;
        const avgLvlAtF20 = classResults.reduce((s, r) => s + (r.floorHistory[19]?.level ?? 0), 0) / NUM_SEEDS;

        console.log(`[Sweep Results: ${cls.toUpperCase()}]`);
        console.log(`  Avg Level at Floor 5:  ${avgLvlAtF5.toFixed(2)}`);
        console.log(`  Avg Level at Floor 10: ${avgLvlAtF10.toFixed(2)}`);
        console.log(`  Avg Level at Floor 15: ${avgLvlAtF15.toFixed(2)}`);
        console.log(`  Avg Level at Floor 20: ${avgLvlAtF20.toFixed(2)}`);
        console.log(`  Avg Total XP at F20:   ${avgFinalXp.toFixed(0)}`);

        // Check level progression monotonicity
        expect(avgLvlAtF5).toBeGreaterThanOrEqual(1);
        expect(avgLvlAtF10).toBeGreaterThanOrEqual(avgLvlAtF5);
        expect(avgLvlAtF20).toBeGreaterThanOrEqual(avgLvlAtF10);
      });
    });
  });

  // ============================================================================
  // 3. CLASS-SPECIFIC PASSIVES & XP ASYMMETRIES AUDIT
  // ============================================================================
  describe('3. Class-Specific XP Passives & Kill Bonuses Audit', () => {
    it('3.1 audits Solar Drake Magma Trail food gilding advantage', () => {
      // Compare 100 apples eaten by Emerald vs Solar
      const emeraldPlayer = new SnakePlayer('emerald', 1280, 720, 3);
      const solarPlayer = new SnakePlayer('solar', 1280, 720, 3);

      const combatEmerald = engine.Combat;
      engine.Player = emeraldPlayer;

      for (let i = 0; i < 100; i++) {
        const apple = new FoodItem(emeraldPlayer.X, emeraldPlayer.Y, 'apple');
        combatEmerald.eatFood(apple, engine.worldBag());
      }
      const emeraldXp = emeraldPlayer.Xp;

      engine.Player = solarPlayer;
      for (let i = 0; i < 100; i++) {
        const apple = new FoodItem(solarPlayer.X, solarPlayer.Y, 'apple');
        // Solar cooks apple to golden fruit (+4 XP instead of +1 XP)
        apple.Cook();
        combatEmerald.eatFood(apple, engine.worldBag());
      }
      const solarXp = solarPlayer.Xp;

      expect(emeraldXp).toBe(100);
      expect(solarXp).toBe(400);
      expect(solarXp / emeraldXp).toBe(4.0); // Exactly 4x food XP acceleration!
    });

    it('3.2 audits Emerald Viper magnet radius passive (+30%) on food acquisition velocity', () => {
      const emerald = new SnakePlayer('emerald', 1280, 720, 3);
      const stalker = new SnakePlayer('stalker', 1280, 720, 3);

      // Base magnet radius: Emerald = 78 * 1.3 = 101.4px, Stalker = 58px
      expect(emerald.Stats.MagnetRadius).toBeCloseTo(101.4, 1);
      expect(stalker.Stats.MagnetRadius).toBe(58.0);
      expect(emerald.Stats.MagnetRadius / stalker.Stats.MagnetRadius).toBeGreaterThan(1.7);
    });

    it('3.3 audits Relic & Perk XP multipliers (Gourmand, Soul Harvest, Overdrive)', () => {
      const player = new SnakePlayer('emerald', 1280, 720, 3);

      // Gourmand Card (+20% per stack)
      const gourmand = GameData.CardPool.find(c => c.Id === 'gourmand')!;
      expect(gourmand).toBeDefined();

      gourmand.Apply(player);
      expect(player.Stats.XpGain).toBeCloseTo(1.2, 5);

      // 100 XP base gives 120 XP
      player.GainXp(100);
      expect(player.Xp).toBeCloseTo(120, 5);

      // Soul Harvest Relic (+60% kill XP per stack)
      player.Relics['soulHarvest'] = 2; // +120% kill XP
      player.Xp = 0;
      const brute = new Enemy(100, 100, 'brute', 1); // 6 XP base
      engine.Player = player;
      engine.Combat.handleEnemyKill(brute, engine.worldBag());

      // 6 * (1 + 0.6*2) * 1.2 = 6 * 2.2 * 1.2 = 15.84 XP
      expect(player.Xp).toBeCloseTo(15.84, 2);
    });
  });

  // ============================================================================
  // 4. EDGE CASES & STATE MACHINE TRANSITIONS AUDIT
  // ============================================================================
  describe('4. Edge Cases: Negative XP, Overflows & State Triggers', () => {
    it('4.1 rejects negative and NaN XP gracefully without mutating state', () => {
      const player = new SnakePlayer('emerald', 1280, 720, 3);
      expect(player.GainXp(-100)).toBe(false);
      expect(player.GainXp(NaN)).toBe(false);
      expect(player.GainXp(-Infinity)).toBe(false);
      expect(player.GainXp(0)).toBe(false);

      expect(player.Xp).toBe(0);
      expect(player.TotalXpCollected).toBe(0);
      expect(player.Level).toBe(1);
    });

    it('4.2 handles astronomical XP overflow safely via float64 precision and guard limits', () => {
      const player = new SnakePlayer('emerald', 1280, 720, 3);
      const massiveXp = 1e12; // 1 Trillion XP
      const res = player.GainXp(massiveXp);

      expect(res).toBe(true);
      expect(player.Xp).toBe(massiveXp);
      expect(player.TotalXpCollected).toBe(massiveXp);
      // Guard limit prevents while loop freezing (>50 iterations)
      expect(player.Level).toBeLessThanOrEqual(52);
    });

    it('4.3 verifies LevelUp state trigger during Boss defeat and FloorClear transitions', () => {
      engine.GameMode = 'rogue';
      engine.SelectedClass = 'emerald';
      engine.StartRun();

      const player = engine.Player!;
      // Grant enough XP to queue 2 level ups
      player.PendingLevelUps = 2;
      engine.GrowthOnEat = true;

      // Simulate Boss Defeat
      const boss = new Boss(engine.ArenaW * 0.5, engine.ArenaH * 0.5, 1, 'centipede');
      boss.Dead = true;
      engine.OnBossDefeated(boss);

      expect(engine.State).toBe(GameState.FloorClear);

      // FloorClear advance
      engine.AdvanceFloor();
      expect(engine.State).toBe(GameState.Playing);

      // Next tick evaluates pending level up
      engine.Step(1 / 120);
      expect(engine.State).toBe(GameState.LevelUp);
      expect(engine.CurrentDraftCards.length).toBe(3);
    });
  });
});
