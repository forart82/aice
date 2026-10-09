/**
 * Ouroboros Ascension — Autonomous Bot Player & Telemetry Engine Unit & Integration Test Suite
 * (AutonomousBotPlayerAndTelemetry.test.ts)
 *
 * Verifies:
 * 1. Potential Field Vector Navigation & Steering Policy (Food priority, boundary repulsion, self-body avoidance, hazard/projectile evasion).
 * 2. Combat Targeting & Tactical Triggers (Aiming bite/weapon arcs, TriggerDash when cornered/engaging, TriggerSkill when off cooldown).
 * 3. Strategic Cranial Mutation Lab Agent (Meta tier check, cost affordability, module & augment purchasing via SpendOuro and InstallHeadModule/Augment).
 * 4. Structured Telemetry Logging & Milestones (Milestones, damage accounting, boss encounters, upgrade ledger).
 * 5. Summary Balance Metrics (Currency velocity, difficulty progression, survivability index, report generation).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { GameEngine } from '../sim/GameEngine.js';
import { GameState } from '../sim/GameState.js';
import { SnakePlayer } from '../sim/SnakePlayer.js';
import { FoodItem } from '../sim/FoodItem.js';
import { Enemy } from '../sim/Enemy.js';
import { Boss } from '../sim/Boss.js';
import { Hazard } from '../sim/Hazard.js';
import { Projectile } from '../sim/Projectile.js';
import { ScriptedInput, NullSound, NullFx } from '../core/Contracts.js';
import { Services } from '../core/Services.js';
import { MetaProgression } from '../data/MetaProgression.js';
import { GameData } from '../data/GameData.js';
import { MathX } from '../core/MathX.js';
import { AutonomousBotPlayer } from '../sim/ai/AutonomousBotPlayer.js';
import { BotTelemetryLogger } from '../sim/ai/BotTelemetryLogger.js';

describe('AutonomousBotPlayer & BotTelemetryLogger Test Suite', () => {
  let engine: GameEngine;
  let input: ScriptedInput;
  let bot: AutonomousBotPlayer;
  let logger: BotTelemetryLogger;

  beforeEach(() => {
    Services.resetToNull();
    Services.headless = true;
    input = new ScriptedInput();
    Services.input = input;

    MetaProgression.readBackend = () => null;
    MetaProgression.writeBackend = () => {};
    MetaProgression.deleteBackend = () => {};
    MetaProgression.instance = new MetaProgression();

    engine = new GameEngine();
    engine.setupCanvas(1280, 800, 1);
    engine.gameMode = 'rogue';
    engine.selectedClass = 'emerald';
    engine.startRun();

    bot = new AutonomousBotPlayer();
    logger = new BotTelemetryLogger();
  });

  describe('1. Potential Field Vector Navigation', () => {
    it('1.1 prioritizes high-value food: Prisms and Shards over regular Apples', () => {
      engine.foods.length = 0;
      const player = engine.player;
      player.x = 500;
      player.y = 400;

      // Place an Apple 60px to the left, and a Prism 80px to the right
      const apple = new FoodItem(440, 400, 'apple');
      const prism = new FoodItem(580, 400, 'prism');
      engine.foods.push(apple, prism);

      bot.stepPolicy(engine, input);

      // The bot should be attracted towards the Prism (+X direction) despite Apple being slightly closer
      expect(input.dirX).toBeGreaterThan(0.5);
    });

    it('1.2 prioritizes health Potions when player HP is low', () => {
      engine.foods.length = 0;
      const player = engine.player;
      player.x = 500;
      player.y = 400;
      player.hp = 20; // Critical health (< 30% of max HP)

      // Place an Apple to the right, and a Potion to the left
      const apple = new FoodItem(600, 400, 'apple');
      const potion = new FoodItem(400, 400, 'potion');
      engine.foods.push(apple, potion);

      bot.stepPolicy(engine, input);

      // Bot should steer left (-X) towards the life-saving potion
      expect(input.dirX).toBeLessThan(-0.5);
    });

    it('1.3 exerts repulsive forces away from arena boundaries', () => {
      engine.foods.length = 0;
      const player = engine.player;
      // Position player near left boundary (x = 30 in a 1280px wide arena)
      player.x = 30;
      player.y = 400;

      // Place food slightly to the left outside or at border
      const food = new FoodItem(10, 400, 'apple');
      engine.foods.push(food);

      bot.stepPolicy(engine, input);

      // Even with food at x=10, boundary repulsion must push the snake inward (+X direction)
      expect(input.dirX).toBeGreaterThan(0);
    });

    it('1.4 exerts repulsive forces away from trailing body segments to prevent self-collision', () => {
      engine.foods.length = 0;
      const player = engine.player;
      player.x = 500;
      player.y = 400;

      // Add several body segments coiled directly to the right of the head
      player.addGrowth(8);
      for (let i = 3; i < player.segments.length; i++) {
        player.segments[i]!.x = 540 + (i - 3) * 10;
        player.segments[i]!.y = 400;
      }

      bot.stepPolicy(engine, input);

      // The body repulsion field to the right (+X) must push steering away from the body coil (-X)
      expect(input.dirX).toBeLessThan(0);
    });

    it('1.5 repels from active hazards, hazard beams, and enemy projectiles', () => {
      engine.foods.length = 0;
      const player = engine.player;
      player.x = 500;
      player.y = 400;

      // Spawn a magma hazard 50px directly above player
      const hazard = new Hazard(500, 350, 'magma', { Radius: 40, Dps: 20, Life: 5 });
      engine.hazards.push(hazard);

      // Spawn an enemy projectile approaching from the top-right
      const proj = new Projectile({ x: 550, y: 350, vx: -50, vy: 50, damage: 20, source: 'enemy' });
      engine.projectiles.push(proj);

      bot.stepPolicy(engine, input);

      // Repulsion from upper threats must direct the bot downwards (+Y)
      expect(input.dirY).toBeGreaterThan(0.3);
    });
  });

  describe('2. Combat Targeting & Tactical Triggers', () => {
    it('2.1 directs steering vector towards closest vulnerable enemy or boss for bite and weapon arcs', () => {
      engine.foods.length = 0;
      const player = engine.player;
      player.x = 500;
      player.y = 400;

      // Spawn a vulnerable boss 150px to the upper right
      const boss = new Boss(1, 1280, 800, 'centipede', 650, 250);
      boss.entranceTimer = 0;
      engine.activeBosses = [boss];

      bot.stepPolicy(engine, input);

      // Steering should point towards (650, 250) from (500, 400) -> +X, -Y
      expect(input.dirX).toBeGreaterThan(0.3);
      expect(input.dirY).toBeLessThan(-0.3);
    });

    it('2.2 executes player.TriggerDash() when surrounded by multiple threats or closing in on a boss', () => {
      const player = engine.player;
      player.x = 500;
      player.y = 400;
      player.dashCooldownTimer = 0;
      player.isDashing = false;

      // Spawn 3 enemies in close proximity (< 80px)
      const e1 = new Enemy(480, 420, 'swarmling', 1);
      const e2 = new Enemy(520, 380, 'swarmling', 1);
      const e3 = new Enemy(510, 430, 'swarmling', 1);
      engine.enemies.push(e1, e2, e3);

      expect(player.dashReady).toBe(true);

      bot.stepPolicy(engine, input);

      // Dash should have been triggered
      expect(player.isDashing).toBe(true);
      expect(player.dashCooldownTimer).toBeGreaterThan(0);
    });

    it('2.3 executes player.TriggerSkill() when off cooldown during combat encounters', () => {
      const player = engine.player;
      player.x = 500;
      player.y = 400;
      player.skillCooldownTimer = 0;

      // Spawn an enemy in combat range
      const enemy = new Enemy(560, 400, 'scarab', 1);
      engine.enemies.push(enemy);

      expect(player.skillReady).toBe(true);

      bot.stepPolicy(engine, input);

      // Skill should have been activated and put on cooldown
      expect(player.skillCooldownTimer).toBeGreaterThan(0);
    });
  });

  describe('3. Strategic Cranial Mutation Lab Agent', () => {
    it('3.1 identifies tier-unlocked affordable head modules and augments', () => {
      const meta = MetaProgression.Instance;
      const player = engine.player;
      player.ouro = 120;

      // By default tier 1 for turret and shield is unlocked (strictly 1 weapon, 1 defense)
      expect(meta.IsTierUnlocked('turret', 1)).toBe(true);
      expect(meta.IsTierUnlocked('shield', 1)).toBe(true);
      expect(meta.IsTierUnlocked('fangs', 1)).toBe(false);

      const decision = bot.evaluateLabPurchases(player, meta);
      expect(decision.affordablePurchases.length).toBeGreaterThan(0);
      expect(decision.affordablePurchases.some(p => p.id === 'turret' || p.id === 'shield')).toBe(true);
    });

    it('3.2 purchases modules and augments via player.SpendOuro() and player.InstallHeadModule/Augment()', () => {
      const meta = MetaProgression.Instance;
      const player = engine.player;
      player.ouro = 100;
      const initialOuro = player.ouro;

      const results = bot.performLabPurchases(player, meta, logger);

      expect(results.purchasedCount).toBeGreaterThan(0);
      expect(player.ouro).toBeLessThan(initialOuro);
      expect(player.headPurchaseCount).toBeGreaterThan(0);
      expect(results.totalSpent).toBeGreaterThan(0);
    });

    it('3.3 does not purchase locked tiers or upgrades when Ouro is insufficient', () => {
      const meta = MetaProgression.Instance;
      const player = engine.player;
      player.ouro = 5; // Insufficient for any 30+ Ouro module

      const results = bot.performLabPurchases(player, meta, logger);

      expect(results.purchasedCount).toBe(0);
      expect(player.ouro).toBe(5);
      expect(player.headPurchaseCount).toBe(0);
    });
  });

  describe('4. Structured Telemetry Logging & Milestones', () => {
    it('4.1 captures run milestones with clear time, serpent length, damage, and Ouro metrics', () => {
      logger.recordMilestone({
        floor: 1,
        clearTime: 42.5,
        serpentLength: 12,
        peakLength: 15,
        ouroCollected: 85,
        ouroSpentInLab: 60,
        damageDealt: 1250,
        damageTaken: 140,
        bossDefeatDurations: { centipede: 18.2 },
        upgradesUnlocked: ['turret-T1', 'shield-T1'],
        upgradesPurchased: ['turret', 'shield'],
      });

      const milestones = logger.getMilestones();
      expect(milestones.length).toBe(1);
      expect(milestones[0]!.floor).toBe(1);
      expect(milestones[0]!.clearTime).toBe(42.5);
      expect(milestones[0]!.ouroCollected).toBe(85);
      expect(milestones[0]!.ouroSpentInLab).toBe(60);
      expect(milestones[0]!.damageDealt).toBe(1250);
    });

    it('4.2 tracks boss encounters with outcome, duration, and combat statistics', () => {
      logger.recordBossEncounter({
        floor: 1,
        bossId: 'centipede',
        bossName: 'Centipede Behemoth',
        durationSec: 18.2,
        outcome: 'victory',
        damageDealtToBoss: 600,
        damageTakenFromBoss: 50,
      });

      const encounters = logger.getBossEncounters();
      expect(encounters.length).toBe(1);
      expect(encounters[0]!.bossId).toBe('centipede');
      expect(encounters[0]!.outcome).toBe('victory');
      expect(encounters[0]!.durationSec).toBe(18.2);
    });

    it('4.3 records upgrade transactions in an auditable ledger', () => {
      logger.recordUpgrade({
        type: 'module',
        id: 'turret',
        name: 'Attack Spitter',
        level: 1,
        cost: 30,
        floor: 1,
        timestamp: 45.0,
      });

      const ledger = logger.getUpgradeLedger();
      expect(ledger.length).toBe(1);
      expect(ledger[0]!.id).toBe('turret');
      expect(ledger[0]!.cost).toBe(30);
    });
  });

  describe('5. Summary Balance Metrics & Reports', () => {
    beforeEach(() => {
      logger.recordMilestone({
        floor: 1,
        clearTime: 30.0,
        serpentLength: 10,
        peakLength: 12,
        ouroCollected: 100,
        ouroSpentInLab: 60,
        damageDealt: 1000,
        damageTaken: 100,
        bossDefeatDurations: { centipede: 15.0 },
        upgradesUnlocked: ['turret-T1'],
        upgradesPurchased: ['turret'],
      });

      logger.recordMilestone({
        floor: 2,
        clearTime: 65.0,
        serpentLength: 18,
        peakLength: 20,
        ouroCollected: 120,
        ouroSpentInLab: 90,
        damageDealt: 1800,
        damageTaken: 200,
        bossDefeatDurations: { gorgon: 22.0 },
        upgradesUnlocked: ['tesla-T1'],
        upgradesPurchased: ['tesla'],
      });
    });

    it('5.1 computes Currency Velocity, Difficulty Progression, and Survivability Index', () => {
      const metrics = logger.computeBalanceMetrics();

      expect(metrics.totalOuroCollected).toBe(220);
      expect(metrics.totalOuroSpent).toBe(150);
      expect(metrics.currencyVelocity).toBeCloseTo(220 / 65.0, 2);
      expect(metrics.reinvestmentRatio).toBeCloseTo(150 / 220, 2);
      expect(metrics.totalDamageDealt).toBe(2800);
      expect(metrics.totalDamageTaken).toBe(300);
      expect(metrics.survivabilityIndex).toBeCloseTo(2800 / 300, 2);
      expect(metrics.effectiveDps).toBeCloseTo(2800 / 65.0, 2);
    });

    it('5.2 generates valid JSON and formatted markdown summary reports', () => {
      const json = logger.exportJson();
      const parsed = JSON.parse(json);
      expect(parsed.milestones.length).toBe(2);
      expect(parsed.balanceMetrics.totalOuroCollected).toBe(220);

      const markdown = logger.exportSummaryMarkdown();
      expect(markdown).toContain('# Autonomous Bot Telemetry & Balance Report');
      expect(markdown).toContain('Currency Velocity');
      expect(markdown).toContain('Survivability Index');
      expect(markdown).toContain('Centipede Behemoth');
    });
  });
});
