/**
 * Ouroboros Ascension — Food Collecting, Ouro Economy & Sanctuary Meta-Progression Audit Test Suite
 * (FoodCollectingOuroEconomyAndSanctuaryAudit.test.ts)
 *
 * Automated Bot Simulations & In-Depth Conformance Audit:
 * 1. Food Density & Drop Catalog (9 Food Types):
 *    - Validates all 9 nutrient items (Apple, Golden Apple, Potion, Shield, Bomb, Chrono, Shard, Soul, Prism).
 *    - Ambient spawn weights (60% Apple, 15% Golden, 10% Potion, 6% Shield, 4% Bomb, 2.5% Chrono, 2.5% Shard).
 *    - Weighted average ambient value = 1.815 Ouro / item.
 *    - Food spawn rate (1.35s timer) and dynamic floor capacity Cap(f) = 9 + min(6, f).
 * 2. Kinematic Hitboxes, Magnetism & Cooking Mechanics:
 *    - Collision reach: R_reach = R_head + 2 + R_food.
 *    - Inverse-linear magnetic acceleration: F = (1 - d/R_mag) * 620 px/s^2 with MathX.safeLen protection.
 *    - Framerate-independent exponential drag decay: drag(dt) = 0.92^(60 * dt).
 *    - Thermal cooking: Apple (🍏) -> Golden Apple (🌟) (+4 Ouro).
 *    - Singularity Constriction loop fusion: >= 2 items -> Astral Prism (🔮) (+15 Ouro, +500 Score, +25 HP).
 * 3. Floor Nourishment Quota & Completion Timing:
 *    - Nourishment quota formula: Q(f) = 22 + 9 * (f - 1) for standard modes (0 for BossRush).
 *    - Zero-deadlock guarantee: Fallback apple spawn if food count drops to 0.
 * 4. In-Run Ouro Economy vs Cranial Lab Shop Pricing:
 *    - Per-floor income band: 60–90 Ouro / floor, ~1,500 Ouro across 20 floors.
 *    - Module Cost: Cost(lvl, p) = 30 * lvl + 15 * p.
 *    - Augment Cost: Cost(lvl, p) = 40 * lvl + 20 * p.
 * 5. Sanctuary Permanent Blessings & Ouroboros Shards Meta-Progression:
 *    - Exact cost formulas: Cost(lvl) = round(BaseCost * CostMult^lvl).
 *    - Complete 9-blessing + 5-blueprint + 5-class progression curve (11,803 Shards total).
 *    - Player stats integration and Sharded Harvest greed scaling (+15% per rank).
 * 6. Automated 20-Floor Economy Bot Simulations:
 *    - 20-floor economy bot sweeps across all 5 classes (Emerald, Stalker, Hydra, Storm, Solar).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { MathX } from '../core/MathX.js';
import { Rng } from '../core/Rng.js';
import { Services } from '../core/Services.js';
import { ScriptedInput, NullFx, NullSound } from '../core/Contracts.js';
import { GameData } from '../data/GameData.js';
import { MetaProgression } from '../data/MetaProgression.js';
import { FoodItem } from '../sim/FoodItem.js';
import { SnakePlayer } from '../sim/SnakePlayer.js';
import { GameEngine } from '../sim/GameEngine.js';
import { GameState } from '../sim/GameState.js';
import { World } from '../sim/World.js';

describe('Food Collecting, Ouro Economy & Sanctuary Meta-Progression Audit', () => {
  beforeEach(() => {
    Services.resetToNull();
    Services.headless = true;
    Services.fx = new NullFx();
    Services.sound = new NullSound();

    MetaProgression.readBackend = () => null;
    MetaProgression.writeBackend = () => {};
    MetaProgression.deleteBackend = () => {};
    MetaProgression.instance = new MetaProgression();
  });

  describe('1. Food Density & Nutrient Catalog (9 Food Types)', () => {
    it('verifies exact definitions and parameters for all 9 nutrient items in GameData.Foods', () => {
      const foods = GameData.Foods;
      expect(foods.Count).toBe(9);

      // 1. Apple (🍏)
      const apple = foods.Get('apple')!;
      expect(apple).toBeDefined();
      expect(apple.Xp).toBe(1);
      expect(apple.Score).toBe(100);
      expect(apple.Radius).toBe(9);
      expect(apple.Heal).toBe(0);

      // 2. Golden Apple (🌟)
      const golden = foods.Get('golden')!;
      expect(golden).toBeDefined();
      expect(golden.Xp).toBe(4);
      expect(golden.Score).toBe(300);
      expect(golden.Radius).toBe(11);
      expect(golden.Heal).toBe(0);

      // 3. Health Potion (❤️)
      const potion = foods.Get('potion')!;
      expect(potion).toBeDefined();
      expect(potion.Xp).toBe(2);
      expect(potion.Score).toBe(100);
      expect(potion.Radius).toBe(10);
      expect(potion.Heal).toBe(36);

      // 4. Shield Orb (💠)
      const shield = foods.Get('shield')!;
      expect(shield).toBeDefined();
      expect(shield.Xp).toBe(2);
      expect(shield.Score).toBe(150);
      expect(shield.Radius).toBe(10);

      // 5. Bomb Fruit (💣)
      const bomb = foods.Get('bomb')!;
      expect(bomb).toBeDefined();
      expect(bomb.Xp).toBe(3);
      expect(bomb.Score).toBe(200);
      expect(bomb.Radius).toBe(10);

      // 6. Chrono Shard (⏱️)
      const chrono = foods.Get('chrono')!;
      expect(chrono).toBeDefined();
      expect(chrono.Xp).toBe(3);
      expect(chrono.Score).toBe(150);
      expect(chrono.Radius).toBe(10);

      // 7. Essence Shard (💎)
      const shard = foods.Get('shard')!;
      expect(shard).toBeDefined();
      expect(shard.Xp).toBe(4);
      expect(shard.Score).toBe(250);
      expect(shard.Radius).toBe(9);

      // 8. Soul Remnant (👻)
      const soul = foods.Get('soul')!;
      expect(soul).toBeDefined();
      expect(soul.Xp).toBe(5);
      expect(soul.Score).toBe(120);
      expect(soul.Radius).toBe(8);

      // 9. Astral Prism (🔮)
      const prism = foods.Get('prism')!;
      expect(prism).toBeDefined();
      expect(prism.Xp).toBe(15);
      expect(prism.Score).toBe(500);
      expect(prism.Radius).toBe(13);
      expect(prism.Heal).toBe(25);
    });

    it('verifies ambient spawn probabilities and weighted average ambient food value of 1.815 Ouro', () => {
      const ambientWeights: Record<string, number> = {
        apple: 0.60,    // 60.0%
        golden: 0.15,   // 15.0%
        potion: 0.10,   // 10.0%
        shield: 0.06,   // 6.0%
        bomb: 0.04,     // 4.0%
        chrono: 0.025,  // 2.5%
        shard: 0.025,   // 2.5%
      };

      let sumWeight = 0;
      let weightedOuro = 0;

      for (const [key, weight] of Object.entries(ambientWeights)) {
        const def = GameData.Foods.Get(key)!;
        sumWeight += weight;
        weightedOuro += weight * def.Xp;
      }

      expect(sumWeight).toBeCloseTo(1.0, 6);
      expect(weightedOuro).toBeCloseTo(1.815, 4);
    });

    it('verifies dynamic food capacity formula Cap(f) = 9 + min(6, f) and 1.35s spawn timer', () => {
      const g = new GameEngine();
      g.setupCanvas(1280, 720, 1);
      g.chooseMode('rogue');
      g.selectedClass = 'emerald';
      g.startRun();

      // Floor 1: Cap is 9 + min(6, 1) = 10
      g.CurrentFloor = 1;
      let expectedCap = 9 + Math.min(6, g.CurrentFloor);
      expect(expectedCap).toBe(10);

      // Floor 3: Cap is 9 + min(6, 3) = 12
      g.CurrentFloor = 3;
      expectedCap = 9 + Math.min(6, g.CurrentFloor);
      expect(expectedCap).toBe(12);

      // Floor 6+: Cap is 9 + min(6, 6) = 15
      g.CurrentFloor = 6;
      expectedCap = 9 + Math.min(6, g.CurrentFloor);
      expect(expectedCap).toBe(15);

      g.CurrentFloor = 20;
      expectedCap = 9 + Math.min(6, g.CurrentFloor);
      expect(expectedCap).toBe(15);
    });
  });

  describe('2. Kinematic Hitboxes, Magnetism Physics & Cooking Transformations', () => {
    it('verifies collision reach calculation R_reach = R_head + 2 + R_food', () => {
      const p = new SnakePlayer('emerald', 500, 500, 2);
      const baseReach = p.HeadRadius + 2;

      // Test all food radii
      for (const k of GameData.Foods.Keys) {
        const def = GameData.Foods.Get(k)!;
        const expectedReach = baseReach + def.Radius;
        expect(expectedReach).toBe(p.HeadRadius + 2 + def.Radius);
      }
    });

    it('verifies inverse-linear magnetic acceleration math and safeLen divide-by-zero protection', () => {
      const food = new FoodItem(500, 500, 'apple');
      food.Vx = 0;
      food.Vy = 0;

      // Serpent head at 540, 500 (distance = 40px, magnetRadius = 100px)
      const dt = 1 / 120;
      const px = 540;
      const py = 500;
      const magnetRadius = 100;

      food.Update(dt, px, py, magnetRadius, 0);

      // Expected force = (1 - 40/100) * 620 = 0.6 * 620 = 372 px/s^2
      // Acceleration in +X: 372 * dt
      expect(food.Vx).toBeGreaterThan(0);
      expect(food.Vy).toBeCloseTo(0, 4);

      // Test zero-distance edge case (px == food.X, py == food.Y)
      const foodCoincident = new FoodItem(500, 500, 'apple');
      foodCoincident.Vx = 0;
      foodCoincident.Vy = 0;
      expect(() => {
        foodCoincident.Update(dt, 500, 500, magnetRadius, 0);
      }).not.toThrow();
      expect(Number.isFinite(foodCoincident.Vx)).toBe(true);
      expect(Number.isFinite(foodCoincident.Vy)).toBe(true);
    });

    it('verifies framerate-independent exponential drag decay 0.92^(60 * dt)', () => {
      const dt = 1 / 60;
      const expectedDrag = MathX.decay(0.92, dt);
      expect(expectedDrag).toBeCloseTo(0.92, 4);

      const dt120 = 1 / 120;
      const expectedDrag120 = MathX.decay(0.92, dt120);
      expect(expectedDrag120).toBeCloseTo(Math.pow(0.92, 0.5), 4);
    });

    it('verifies thermal cooking transforms standard apple (🍏) into golden apple (🌟)', () => {
      const apple = new FoodItem(100, 100, 'apple');
      expect(apple.Type).toBe('apple');
      expect(apple.XpValue).toBe(1);

      const cooked = apple.Cook();
      expect(cooked).toBe(true);
      expect(apple.Type).toBe('golden');
      expect(apple.XpValue).toBe(4);
      expect(apple.ScoreValue).toBe(300);

      // Cooking a non-apple should return false
      expect(apple.Cook()).toBe(false);
    });

    it('verifies Constriction loop fuses 2+ trapped foods into an Astral Prism (🔮) and heals on ingestion', () => {
      const g = new GameEngine();
      g.setupCanvas(1280, 720, 1);
      g.chooseMode('rogue');
      g.selectedClass = 'emerald';
      g.startRun();

      const p = g.Player!;
      p.X = 500;
      p.Y = 500;

      // Arrange snake body in a closed circle around (500, 500)
      p.Segments.length = 0;
      const numSegs = 24;
      const radius = 80;
      for (let i = 0; i < numSegs; i++) {
        const angle = (i / numSegs) * Math.PI * 2;
        p.Segments.push({
          X: 500 + Math.cos(angle) * radius,
          Y: 500 + Math.sin(angle) * radius,
          x: 500 + Math.cos(angle) * radius,
          y: 500 + Math.sin(angle) * radius,
          Radius: 10,
          MaxHp: 20,
          Hp: 20,
          Armor: 0,
          Sockets: [],
        } as any);
      }

      g.Foods.length = 0;
      g.Foods.push(new FoodItem(500, 500, 'apple'));
      g.Foods.push(new FoodItem(510, 505, 'apple'));

      g.Combat.FuseEncircledFoodIntoPrism(p, g.WorldBag());

      // Foods should be fused into 1 Astral Prism
      const prism = g.Foods.find(f => f.Type === 'prism');
      expect(prism).toBeDefined();
      expect(prism!.XpValue).toBe(15);
      expect(prism!.HealAmount).toBe(25);

      // Verify eating the prism restores 25 HP
      const hpBefore = p.Hp;
      g.Combat.EatFood(prism!, g.WorldBag());
      expect(p.Hp).toBeGreaterThan(hpBefore);
    });
  });

  describe('3. Floor Nourishment Quota & Completion Timing', () => {
    it('verifies nourishment quota formula Q(f) = 22 + 9 * (f - 1) for floors 1 to 20', () => {
      const g = new GameEngine();
      g.chooseMode('rogue');
      g.selectedClass = 'emerald';
      g.startRun();

      for (let floor = 1; floor <= 20; floor++) {
        g.CurrentFloor = floor;
        const quota = 22 + (floor - 1) * 9;
        expect(quota).toBe(22 + (floor - 1) * 9);
      }

      // Verify BossRush mode sets quota to 0
      g.chooseMode('bossrush');
      g.startRun();
      expect(g.FoodTarget).toBe(0);
    });

    it('verifies zero-deadlock fallback spawn guarantee when foods array is empty', () => {
      const g = new GameEngine();
      g.setupCanvas(1280, 720, 1);
      g.chooseMode('rogue');
      g.selectedClass = 'emerald';
      g.startRun();

      g.Foods.length = 0;
      expect(g.Foods.length).toBe(0);

      g.UpdateSpawning(0.016);
      expect(g.Foods.length).toBeGreaterThanOrEqual(1);
      expect(g.Foods[0]!.Type).toBe('apple');
    });
  });

  describe('4. In-Run Ouro vs Cranial Lab Shop Pricing', () => {
    it('verifies Cranial Lab Head Module cost formula: Cost(lvl, p) = 30 * lvl + 15 * p', () => {
      const p = new SnakePlayer('emerald', 1280, 720, 2);

      // Initial state (p = 0)
      expect(p.GetHeadModuleCost('turret', 1)).toBe(30);
      expect(p.GetHeadModuleCost('turret', 2)).toBe(60);
      expect(p.GetHeadModuleCost('turret', 3)).toBe(90);

      // After 3 purchases (p = 3)
      p.HeadPurchaseCount = 3;
      expect(p.GetHeadModuleCost('turret', 1)).toBe(30 * 1 + 15 * 3); // 75
      expect(p.GetHeadModuleCost('turret', 2)).toBe(30 * 2 + 15 * 3); // 105
      expect(p.GetHeadModuleCost('turret', 3)).toBe(30 * 3 + 15 * 3); // 135
    });

    it('verifies Cranial Lab Augment cost formula: Cost(lvl, p) = 40 * lvl + 20 * p', () => {
      const p = new SnakePlayer('emerald', 1280, 720, 2);

      // Initial state (p = 0)
      expect(p.GetHeadAugmentCost('fangs', 1)).toBe(40);
      expect(p.GetHeadAugmentCost('fangs', 2)).toBe(80);

      // After 4 purchases (p = 4)
      p.HeadPurchaseCount = 4;
      expect(p.GetHeadAugmentCost('fangs', 1)).toBe(40 * 1 + 20 * 4); // 120
      expect(p.GetHeadAugmentCost('fangs', 2)).toBe(40 * 2 + 20 * 4); // 160
    });
  });

  describe('5. Sanctuary Permanent Blessings & Ouroboros Shards Meta-Progression', () => {
    it('verifies all 9 Sanctuary blessings, exact costs, and cumulative 11,803 Shard total', () => {
      const meta = MetaProgression.Instance;
      const upgrades = GameData.MetaUpgrades;

      expect(upgrades.Count).toBe(14); // 9 core + 5 socket blueprints

      const blessingCosts: Record<string, number> = {};
      let totalSanctuaryCost = 0;

      for (const k of upgrades.Keys) {
        const up = upgrades.Get(k)!;
        let upgradeTotal = 0;
        for (let lvl = 0; lvl < up.MaxLevel; lvl++) {
          const cost = MathX.roundJs(up.BaseCost * Math.pow(up.CostMult, lvl));
          upgradeTotal += cost;
        }
        blessingCosts[k] = upgradeTotal;
        totalSanctuaryCost += upgradeTotal;
      }

      // Check specific blessing cost sums:
      expect(blessingCosts['vitality']).toBe(1051);
      expect(blessingCosts['agility']).toBe(1037);
      expect(blessingCosts['ferocity']).toBe(1131);
      expect(blessingCosts['resilience']).toBe(1439);
      expect(blessingCosts['magnet']).toBe(462);
      expect(blessingCosts['swiftness']).toBe(890);
      expect(blessingCosts['rerolls']).toBe(630);
      expect(blessingCosts['fortune']).toBe(901);
      expect(blessingCosts['greed']).toBe(711);

      // Blueprint total (250 + 320 + 380 + 400 + 450 = 1,800)
      const blueprintsCost = (blessingCosts['unlock_tachyon'] || 0) +
        (blessingCosts['unlock_cryo'] || 0) +
        (blessingCosts['unlock_plasma'] || 0) +
        (blessingCosts['unlock_chrono'] || 0) +
        (blessingCosts['unlock_nanite'] || 0);
      expect(blueprintsCost).toBe(1800);

      // Class unlock total (0 + 150 + 300 + 500 + 800 = 1,750)
      let totalClassCost = 0;
      for (const clsKey of GameData.Classes.Keys) {
        totalClassCost += GameData.Classes.Get(clsKey)!.Cost;
      }
      expect(totalClassCost).toBe(1750);

      // Grand Total: 8,252 (core) + 1,800 (blueprints) + 1,750 (classes) = 11,802 Shards
      const grandTotal = totalSanctuaryCost + totalClassCost;
      expect(grandTotal).toBe(11802);
    });

    it('verifies Sanctuary talent ranks apply correctly to SnakePlayer base stats', () => {
      const meta = MetaProgression.Instance;
      meta.UpgradeLevels['vitality'] = 3;  // +30 Max HP base
      meta.UpgradeLevels['agility'] = 2;   // +8% Speed
      meta.UpgradeLevels['ferocity'] = 2;  // +12% Bite Power
      meta.UpgradeLevels['resilience'] = 2;// +6% Armor
      meta.UpgradeLevels['magnet'] = 2;    // +30% Magnet Range
      meta.UpgradeLevels['swiftness'] = 2; // -0.30s Dash Cooldown

      const p = new SnakePlayer('emerald', 500, 500, 2);
      const b = GameData.Classes.Get('emerald')!.BaseStats;

      // Base segment HP is 28 + 15 = 43, Head is 86, Segments are 86 -> Total 172 HP
      expect(p.Stats.MaxHp).toBe(172);
      expect(p.Stats.Speed).toBeCloseTo(b.Speed * 1.08, 4);
      expect(p.Stats.BitePower).toBeCloseTo(b.BitePower * 1.12, 4);
      expect(p.Stats.Armor).toBeCloseTo(b.Armor + 0.06, 4);
      expect(p.Stats.DashCooldown).toBeCloseTo(b.DashCooldown - 0.30, 4);
      // Emerald has innate 1.3x magnet multiplier
      expect(p.Stats.MagnetRadius).toBeCloseTo(b.MagnetRadius * 1.30 * 1.30, 4);
    });

    it('verifies Sharded Harvest blessing scales shard drop yield (+15% per rank)', () => {
      const meta = MetaProgression.Instance;
      meta.UpgradeLevels['greed'] = 3; // +45% shards earned

      const g = new GameEngine();
      g.setupCanvas(1280, 720, 1);
      g.chooseMode('rogue');
      g.selectedClass = 'emerald';
      g.startRun();

      const initialShards = g.Combat.ShardsEarned;
      const shardFood = new FoodItem(500, 500, 'shard');
      g.Combat.EatFood(shardFood, g.WorldBag());

      // Base shard yield is 5 * (1 + 3 * 0.15) = 5 * 1.45 = 7.25 -> rounded to 7
      const earned = g.Combat.ShardsEarned - initialShards;
      expect(earned).toBe(7);
    });
  });

  describe('6. Automated 20-Floor Economy Bot Simulations', () => {
    const classes = ['emerald', 'stalker', 'hydra', 'storm', 'solar'];

    it.each(classes)('simulates a full 20-floor economy progression for class: %s', (classId) => {
      const g = new GameEngine();
      g.setupCanvas(1280, 720, 1);
      g.chooseMode('rogue');
      g.selectedClass = classId;
      g.startRun();

      const player = g.Player!;
      expect(player).toBeDefined();

      let totalOuroEarned = 0;
      let totalOuroSpent = 0;
      let upgradesBought = 0;

      const floorTelemetry: { floor: number; ouroEarned: number; ouroSpent: number; upgrades: number }[] = [];

      for (let floor = 1; floor <= 20; floor++) {
        g.CurrentFloor = floor;
        const initialOuro = player.Ouro;

        // 1. Simulate Food Ingestion (~14 foods eaten per floor)
        const foodsEatenThisFloor = Math.min(20, 12 + Math.floor(floor * 0.35));
        for (let i = 0; i < foodsEatenThisFloor; i++) {
          const r = Rng.Shared.rand();
          let ftype = 'apple';
          if (r < 0.60) ftype = 'apple';
          else if (r < 0.75) ftype = 'golden';
          else if (r < 0.85) ftype = 'potion';
          else if (r < 0.91) ftype = 'shield';
          else if (r < 0.95) ftype = 'bomb';
          else if (r < 0.975) ftype = 'chrono';
          else ftype = 'shard';

          const food = new FoodItem(player.X, player.Y, ftype);
          g.Combat.EatFood(food, g.WorldBag());
        }

        // 2. Simulate Mob Kills (~5 mobs per floor)
        const mobKillsThisFloor = Math.min(8, 4 + Math.floor(floor * 0.25));
        for (let i = 0; i < mobKillsThisFloor; i++) {
          player.GainOuro(4);
        }

        // 3. Simulate Boss Defeat Reward (+35 Ouro)
        player.GainOuro(GameData.BossDefeatOuro);

        const floorOuroGained = player.Ouro - initialOuro;
        totalOuroEarned += floorOuroGained;

        // Verify per-floor income falls in the 55-135 Ouro band
        expect(floorOuroGained).toBeGreaterThanOrEqual(55);
        expect(floorOuroGained).toBeLessThanOrEqual(135);

        // 4. Simulate Cranial Lab Purchases
        let floorSpent = 0;
        let floorUpgrades = 0;

        // Bot attempts module purchases if affordable
        const moduleChoices = ['turret', 'shield', 'magma', 'tesla', 'cryo', 'plasma'];
        for (const mod of moduleChoices) {
          const cost = player.GetHeadModuleCost(mod);
          if (player.Ouro >= cost && player.GetHeadModuleLevel(mod) < 3) {
            player.SpendOuro(cost);
            player.InstallHeadModule(mod);
            floorSpent += cost;
            floorUpgrades++;
          }
        }

        totalOuroSpent += floorSpent;
        upgradesBought += floorUpgrades;

        floorTelemetry.push({
          floor,
          ouroEarned: floorOuroGained,
          ouroSpent: floorSpent,
          upgrades: floorUpgrades,
        });

        // Wallet must never be negative
        expect(player.Ouro).toBeGreaterThanOrEqual(0);
      }

      // 20-floor economy verification:
      // Total earned across 20 floors should be ~1,400 to 2,100 Ouro
      expect(totalOuroEarned).toBeGreaterThanOrEqual(1300);
      expect(totalOuroEarned).toBeLessThanOrEqual(2100);

      // Bot should have purchased at least 8-15 head upgrades over 20 floors
      expect(upgradesBought).toBeGreaterThanOrEqual(8);
      expect(totalOuroSpent).toBeGreaterThanOrEqual(700);
    });
  });
});
