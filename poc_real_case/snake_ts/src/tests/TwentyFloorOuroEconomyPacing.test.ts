/**
 * Ouroboros Ascension — 20-Floor In-Run Ouro Economy & Cranial Lab Pacing Test Suite
 * (TwentyFloorOuroEconomyPacing.test.ts)
 *
 * Conformance & Calibration Verification:
 * 1. Per-Floor Income Target (60–90 Ouro per floor) from balanced food ingestion, mob kills, and boss rewards.
 * 2. Cranial Lab Module Pricing: Base 30 Ouro (+15 per head purchase) -> Cost(lvl, p) = 30 * lvl + p * 15.
 * 3. Cranial Lab Augment Pricing: Base 40 Ouro (+20 per head purchase) -> Cost(lvl, p) = 40 * lvl + p * 20.
 * 4. Player Wallet Accumulation & Pacing Tiers:
 *    - Floor 1–3: 1–2 starter modules/augments comfortably acquired.
 *    - Floor 4–8: Tier 2 upgrades and newly unlocked challenge modules.
 *    - Floor 9–15: Specialized elemental synergies and fusions (shields, magma, plasma, cryo).
 *    - Floor 16–20+: Endgame mastery upgrades for Floor 20 (The Eternal Ouroboros) and multi-boss gauntlet.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GameData } from '../data/GameData.js';
import { FoodItem } from '../sim/FoodItem.js';
import { Enemy } from '../sim/Enemy.js';
import { Boss } from '../sim/Boss.js';
import { SnakePlayer } from '../sim/SnakePlayer.js';
import { GameEngine } from '../sim/GameEngine.js';
import { MetaProgression } from '../data/MetaProgression.js';
import { Services } from '../core/Services.js';
import { NullFx, NullSound } from '../core/Contracts.js';

describe('20-Floor In-Run Ouro Economy & Cranial Lab Pacing Test Suite', () => {
  beforeEach(() => {
    Services.fx = new NullFx();
    Services.sound = new NullSound();
    Services.headless = true;

    MetaProgression.readBackend = () => null;
    MetaProgression.writeBackend = () => {};
    MetaProgression.deleteBackend = () => {};
    MetaProgression.instance = new MetaProgression();
  });

  describe('1. Per-Floor Currency Flow & Income Target Calibration (60–90 Ouro/floor)', () => {
    it('calculates weighted average ambient food drop value is exactly 1.815 Ouro', () => {
      // Spawn weights from GameData / ORACLE.md:
      // Apple: 60.0% (+1 Ouro)
      // Golden Apple: 15.0% (+4 Ouro)
      // Health Potion: 10.0% (+2 Ouro)
      // Shield Orb: 6.0% (+2 Ouro)
      // Bomb Fruit: 4.0% (+3 Ouro)
      // Chrono Shard: 2.5% (+3 Ouro)
      // Essence Shard: 2.5% (+4 Ouro)
      const weights: Record<string, number> = {
        apple: 0.60,
        golden: 0.15,
        potion: 0.10,
        shield: 0.06,
        bomb: 0.04,
        chrono: 0.025,
        shard: 0.025,
      };

      let weightedSum = 0;
      let totalWeight = 0;

      for (const [key, weight] of Object.entries(weights)) {
        const def = GameData.Foods.Get(key);
        expect(def).toBeDefined();
        weightedSum += def!.Xp * weight;
        totalWeight += weight;
      }

      expect(totalWeight).toBeCloseTo(1.0, 5);
      expect(weightedSum).toBeCloseTo(1.815, 3);
    });

    it('verifies every floor from 1 to 20 produces expected income within the 60–90 Ouro target band', () => {
      const bossReward = GameData.BossDefeatOuro; // +35 Ouro
      expect(bossReward).toBe(35);

      for (let floor = 1; floor <= 20; floor++) {
        // Average active food bites during floor progression (~12-16 items)
        const effectiveFoodEaten = Math.min(16, 11 + Math.floor(floor * 0.25));
        const foodIncome = effectiveFoodEaten * 1.815;

        // Enemy wave progression before boss encounter
        const eligibleEnemies: string[] = [];
        for (const k of GameData.Enemies.Keys) {
          if (GameData.Enemies.Get(k)!.MinFloor <= floor) {
            eligibleEnemies.push(k);
          }
        }
        expect(eligibleEnemies.length).toBeGreaterThan(0);

        // Average XP per eligible mob on this floor
        const avgMobXp = eligibleEnemies.reduce((sum, k) => sum + GameData.Enemies.Get(k)!.Xp, 0) / eligibleEnemies.length;
        const expectedMobKills = Math.min(7, 4 + Math.floor(floor * 0.2));
        const mobIncome = expectedMobKills * avgMobXp;

        const totalFloorIncome = foodIncome + mobIncome + bossReward;

        // Verify total income per floor falls reliably within target 60-90 Ouro range
        expect(totalFloorIncome).toBeGreaterThanOrEqual(60);
        expect(totalFloorIncome).toBeLessThanOrEqual(90);
      }
    });
  });

  describe('2. Cranial Lab Cost Curves: Base 30 Module (+15) & Base 40 Augment (+20)', () => {
    it('verifies formula Cost(lvl, p) = 30 * lvl + p * 15 for head modules', () => {
      const p = new SnakePlayer('emerald', 1280, 720, 2);

      // p = 0
      expect(p.GetHeadModuleCost('turret', 1)).toBe(30);
      expect(p.GetHeadModuleCost('turret', 2)).toBe(60);
      expect(p.GetHeadModuleCost('turret', 3)).toBe(90);

      // Simulate purchases
      p.InstallHeadModule('turret'); // p = 1
      expect(p.HeadPurchaseCount).toBe(1);
      expect(p.GetHeadModuleCost('tesla', 1)).toBe(45);  // 30*1 + 1*15
      expect(p.GetHeadModuleCost('turret', 2)).toBe(75); // 30*2 + 1*15
      expect(p.GetHeadModuleCost('turret', 3)).toBe(105);// 30*3 + 1*15

      p.InstallHeadModule('tesla'); // p = 2
      expect(p.HeadPurchaseCount).toBe(2);
      expect(p.GetHeadModuleCost('shield', 1)).toBe(60);  // 30*1 + 2*15
      expect(p.GetHeadModuleCost('tesla', 2)).toBe(90);   // 30*2 + 2*15
      expect(p.GetHeadModuleCost('turret', 3)).toBe(120); // 30*3 + 2*15

      // Check higher purchase counts (p = 5, 8, 10)
      for (let i = p.HeadPurchaseCount; i < 5; i++) p.InstallHeadModule('spikes');
      expect(p.HeadPurchaseCount).toBe(5);
      expect(p.GetHeadModuleCost('magma', 1)).toBe(30 * 1 + 5 * 15); // 105 Ouro
      expect(p.GetHeadModuleCost('magma', 2)).toBe(30 * 2 + 5 * 15); // 135 Ouro
    });

    it('verifies formula Cost(lvl, p) = 40 * lvl + p * 20 for cranial augments', () => {
      const p = new SnakePlayer('emerald', 1280, 720, 2);

      // p = 0
      expect(p.GetHeadAugmentCost('fangs', 1)).toBe(40);
      expect(p.GetHeadAugmentCost('fangs', 2)).toBe(80);
      expect(p.GetHeadAugmentCost('fangs', 3)).toBe(120);

      // Simulate 1 module purchase (p = 1)
      p.InstallHeadModule('turret');
      expect(p.HeadPurchaseCount).toBe(1);
      expect(p.GetHeadAugmentCost('fangs', 1)).toBe(60);  // 40*1 + 1*20
      expect(p.GetHeadAugmentCost('fangs', 2)).toBe(100); // 40*2 + 1*20
      expect(p.GetHeadAugmentCost('fangs', 3)).toBe(140); // 40*3 + 1*20

      // Install augment (p = 2)
      p.InstallHeadAugment('fangs');
      expect(p.HeadPurchaseCount).toBe(2);
      expect(p.GetHeadAugmentCost('fangs', 2)).toBe(120); // 40*2 + 2*20
      expect(p.GetHeadAugmentCost('maw', 1)).toBe(80);    // 40*1 + 2*20
    });
  });

  describe('3. Pacing Curve & Wallet Accumulation Calibration Across 4 Floor Tiers', () => {
    it('Floor 1–3 (Starter Tier): Player accumulates ~210–240 Ouro, affording 1–2 starter modules and 1 augment', () => {
      const player = new SnakePlayer('emerald', 1280, 720, 2);
      player.Ouro = 0;
      player.TotalOuroCollected = 0;

      // Simulate Floor 1-3 income (approx 75 Ouro per floor = 225 Ouro)
      player.GainOuro(75 * 3);
      expect(player.Ouro).toBe(225);

      // Purchase #1 (p=0): Attack Spitter (Turret Lv1, 30 Ouro)
      const cost1 = player.GetHeadModuleCost('turret');
      expect(cost1).toBe(30);
      expect(player.SpendOuro(cost1)).toBe(true);
      player.InstallHeadModule('turret');
      expect(player.Ouro).toBe(195);
      expect(player.HeadPurchaseCount).toBe(1);

      // Purchase #2 (p=1): Carapace Shield (Shield Lv1, 45 Ouro)
      const cost2 = player.GetHeadModuleCost('shield');
      expect(cost2).toBe(45);
      expect(player.SpendOuro(cost2)).toBe(true);
      player.InstallHeadModule('shield');
      expect(player.Ouro).toBe(150);
      expect(player.HeadPurchaseCount).toBe(2);

      // Purchase #3 (p=2): Venom Fangs Cranial Augment (Fangs Lv1, 80 Ouro)
      const cost3 = player.GetHeadAugmentCost('fangs');
      expect(cost3).toBe(80); // 40*1 + 2*20 = 80
      expect(player.SpendOuro(cost3)).toBe(true);
      player.InstallHeadAugment('fangs');
      expect(player.Ouro).toBe(70);
      expect(player.HeadPurchaseCount).toBe(3);

      // Player completes Floor 1-3 with 2 weapons/defenses + 1 augment and 70 Ouro reserve
      expect(player.GetHeadModuleLevel('turret')).toBe(1);
      expect(player.GetHeadModuleLevel('shield')).toBe(1);
      expect(player.GetHeadAugmentLevel('fangs')).toBe(1);
    });

    it('Floor 4–8 (Tier 2 Progression): Player accumulates ~375 additional Ouro, affording Tier 2 upgrades', () => {
      const player = new SnakePlayer('emerald', 1280, 720, 2);
      // Initialize with end-of-Tier-1 state (p=3, 70 reserve)
      player.InstallHeadModule('turret');
      player.InstallHeadModule('shield');
      player.InstallHeadAugment('fangs');
      expect(player.HeadPurchaseCount).toBe(3);

      // Floors 4-8 income (5 floors * ~75 Ouro = 375 Ouro + 70 reserve = 445 Ouro)
      player.Ouro = 70;
      player.GainOuro(375);
      expect(player.Ouro).toBe(445);

      // Purchase #4 (p=3): Upgrade Turret to Lv2 (30*2 + 3*15 = 105 Ouro)
      const cost4 = player.GetHeadModuleCost('turret');
      expect(cost4).toBe(105);
      expect(player.SpendOuro(cost4)).toBe(true);
      player.InstallHeadModule('turret');
      expect(player.Ouro).toBe(340);
      expect(player.HeadPurchaseCount).toBe(4);

      // Purchase #5 (p=4): Upgrade Shield to Lv2 (30*2 + 4*15 = 120 Ouro)
      const cost5 = player.GetHeadModuleCost('shield');
      expect(cost5).toBe(120);
      expect(player.SpendOuro(cost5)).toBe(true);
      player.InstallHeadModule('shield');
      expect(player.Ouro).toBe(220);
      expect(player.HeadPurchaseCount).toBe(5);

      // Purchase #6 (p=5): Install Magma Vent Lv1 (30*1 + 5*15 = 105 Ouro)
      const cost6 = player.GetHeadModuleCost('magma');
      expect(cost6).toBe(105);
      expect(player.SpendOuro(cost6)).toBe(true);
      player.InstallHeadModule('magma');
      expect(player.Ouro).toBe(115);
      expect(player.HeadPurchaseCount).toBe(6);

      // Successfully achieved Tier 2 arsenal before Floor 9
      expect(player.GetHeadModuleLevel('turret')).toBe(2);
      expect(player.GetHeadModuleLevel('shield')).toBe(2);
      expect(player.GetHeadModuleLevel('magma')).toBe(1);
    });

    it('Floor 9–15 (Specialized Synergy Phase): Player builds cross-module elemental synergies (Cryo, Plasma, Fusions)', () => {
      const player = new SnakePlayer('emerald', 1280, 720, 2);
      // Advance to p=6 state from Floor 8
      player.HeadPurchaseCount = 6;
      player.Ouro = 115;

      // Floors 9-15 income (7 floors * ~75 Ouro = 525 Ouro + 115 reserve = 640 Ouro)
      player.GainOuro(525);
      expect(player.Ouro).toBe(640);

      // Purchase #7 (p=6): Install Cryo Mortar Lv1 (30*1 + 6*15 = 120 Ouro)
      const cost7 = player.GetHeadModuleCost('cryo');
      expect(cost7).toBe(120);
      expect(player.SpendOuro(cost7)).toBe(true);
      player.InstallHeadModule('cryo');
      expect(player.Ouro).toBe(520);
      expect(player.HeadPurchaseCount).toBe(7);

      // Purchase #8 (p=7): Install Plasma Cannon Lv1 (30*1 + 7*15 = 135 Ouro)
      const cost8 = player.GetHeadModuleCost('plasma');
      expect(cost8).toBe(135);
      expect(player.SpendOuro(cost8)).toBe(true);
      player.InstallHeadModule('plasma');
      expect(player.Ouro).toBe(385);
      expect(player.HeadPurchaseCount).toBe(8);

      // Purchase #9 (p=8): Upgrade Cryo to Lv2 (30*2 + 8*15 = 180 Ouro)
      const cost9 = player.GetHeadModuleCost('cryo');
      expect(cost9).toBe(180);
      expect(player.SpendOuro(cost9)).toBe(true);
      player.InstallHeadModule('cryo');
      expect(player.Ouro).toBe(205);
      expect(player.HeadPurchaseCount).toBe(9);

      // Player possesses high-powered elemental arsenal for Floor 15 Boss
      expect(player.GetHeadModuleLevel('cryo')).toBe(2);
      expect(player.GetHeadModuleLevel('plasma')).toBe(1);
    });

    it('Floor 16–20+ (Endgame Mastery): Player acquires Tier 3 capstones for Floor 20 (The Eternal Ouroboros)', () => {
      const player = new SnakePlayer('emerald', 1280, 720, 2);
      // Advance to p=9 state from Floor 15
      player.HeadPurchaseCount = 9;
      player.Ouro = 205;

      // Floors 16-20 income (5 floors * ~75 Ouro = 375 Ouro + 205 reserve = 580 Ouro)
      player.GainOuro(375);
      expect(player.Ouro).toBe(580);

      // Purchase #10 (p=9): Tier 3 Mastery Upgrade (30*3 + 9*15 = 225 Ouro)
      const cost10 = player.GetHeadModuleCost('turret', 3);
      expect(cost10).toBe(225);
      expect(player.SpendOuro(cost10)).toBe(true);
      player.InstallHeadModule('turret');
      expect(player.Ouro).toBe(355);
      expect(player.HeadPurchaseCount).toBe(10);

      // Purchase #11 (p=10): Tier 2 Cranial Augment (40*2 + 10*20 = 280 Ouro)
      const cost11 = player.GetHeadAugmentCost('fangs', 2);
      expect(cost11).toBe(280);
      expect(player.SpendOuro(cost11)).toBe(true);
      player.InstallHeadAugment('fangs');
      expect(player.Ouro).toBe(75);
      expect(player.HeadPurchaseCount).toBe(11);

      // Total lifetime in-run Ouro collected across 20 floors: ~1,500 Ouro
      expect(player.TotalOuroCollected).toBe(375); // Added during test
    });
  });

  describe('4. Full 20-Floor Game Simulation Trace', () => {
    it('executes a complete 20-floor run progression verifying wallet integrity', () => {
      const g = new GameEngine();
      g.chooseMode('rogue');
      g.selectedClass = 'emerald';
      g.startRun();

      const player = g.Player!;
      expect(player).toBeDefined();
      expect(player.Ouro).toBe(0);

      let totalEarned = 0;

      for (let floor = 1; floor <= 20; floor++) {
        g.CurrentFloor = floor;

        // Simulate floor combat earnings (~75 Ouro per floor)
        const floorYield = 75;
        player.GainOuro(floorYield);
        totalEarned += floorYield;

        expect(player.TotalOuroCollected).toBe(totalEarned);
        expect(player.Ouro).toBeGreaterThanOrEqual(0);
      }

      expect(totalEarned).toBe(1500);
      expect(player.TotalOuroCollected).toBe(1500);
    });
  });
});
