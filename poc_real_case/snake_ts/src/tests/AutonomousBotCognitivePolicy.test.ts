/**
 * Ouroboros Ascension — Autonomous Bot Player Cognitive Policy & Lookahead Test Suite
 * (AutonomousBotCognitivePolicy.test.ts)
 *
 * Verifies:
 * 1. Multi-Step Lookahead & Flood-Fill Space Verification:
 *    - Forward raycasting (3-5 steps ahead along candidate trajectories).
 *    - Free maneuvering space estimation (> serpent length) avoiding self-coiling entrapment and corner dead-ends.
 * 2. Human-Like Survival State Machine:
 *    - Emergency Mode (HP < 35%): Evasive kiting and 3x attractive force for health potions and shield orbs.
 *    - Tactical Combat Orbit: Boss orbiting at 150–250px sweet spot with tangential velocity and collision box buffer.
 * 3. Proactive Cranial Lab Shopper:
 *    - In-run proactive purchases when Ouro >= 30 before boss encounters and during play.
 *    - Class-synergistic build selection (defense/sustain for Emerald/Hydra, offense/plasma/lasers for Stalker/Solar/Storm).
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
import { MathX } from '../core/MathX.js';
import { AutonomousBotPlayer } from '../sim/ai/AutonomousBotPlayer.js';
import { BotTelemetryLogger } from '../sim/ai/BotTelemetryLogger.js';

describe('Autonomous Bot Cognitive Policy & Multi-Step Lookahead Test Suite', () => {
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

  /* ========================================================================= *
   * 1. MULTI-STEP LOOKAHEAD & FLOOD-FILL SPACE VERIFICATION
   * ========================================================================= */
  describe('1. Multi-Step Lookahead & Flood-Fill Space Verification', () => {
    it('1.1 performs forward raycasting (3-5 steps) and deflects before reaching arena boundary', () => {
      engine.foods.length = 0;
      const player = engine.player;
      // Position player moving rapidly toward the right wall at x=1220 (boundary margin = 85, wall at 1280)
      player.x = 1210;
      player.y = 400;
      player.angle = 0; // heading east directly into wall

      // Place a high value apple right near the wall at x=1270
      const food = new FoodItem(1270, 400, 'apple');
      engine.foods.push(food);

      bot.stepPolicy(engine, input);

      // Multi-step lookahead must detect the wall 3-5 steps ahead and steer inward (-X) despite food at x=1270
      expect(input.dirX).toBeLessThan(0);
    });

    it('1.2 detects self-coils and verifies maneuvering space exceeds serpent length', () => {
      engine.foods.length = 0;
      const player = engine.player;
      player.x = 500;
      player.y = 400;

      // Create a U-shaped entrapment coil of segments surrounding top, right, and bottom of player head
      // Leaving only left (-X) as the open escape route
      player.addGrowth(20);
      // Top wall of coil: (450..550, 360)
      // Right wall of coil: (550, 360..440)
      // Bottom wall of coil: (450..550, 440)
      let segIdx = 3;
      for (let x = 450; x <= 550 && segIdx < player.segments.length; x += 20) {
        player.segments[segIdx]!.x = x;
        player.segments[segIdx]!.y = 360;
        segIdx++;
      }
      for (let y = 370; y <= 430 && segIdx < player.segments.length; y += 20) {
        player.segments[segIdx]!.x = 550;
        player.segments[segIdx]!.y = y;
        segIdx++;
      }
      for (let x = 550; x >= 450 && segIdx < player.segments.length; x -= 20) {
        player.segments[segIdx]!.x = x;
        player.segments[segIdx]!.y = 440;
        segIdx++;
      }

      // Place high value food inside the dead end at (540, 400)
      const food = new FoodItem(540, 400, 'prism');
      engine.foods.push(food);

      bot.stepPolicy(engine, input);

      // Space verification should detect that heading +X into the coil has insufficient open maneuvering space (< length),
      // and steer away toward the open escape corridor (-X)
      expect(input.dirX).toBeLessThan(0);
    });

    it('1.3 lookahead raycast detects hazard beam intersections 3-5 steps ahead', () => {
      engine.foods.length = 0;
      const player = engine.player;
      player.x = 500;
      player.y = 400;

      // Spawn a hazard 80px directly ahead in +X direction (within 3-5 steps: 3*28px = 84px)
      const hazard = new Hazard(580, 400, 'magma', { Radius: 35, Dps: 20, Life: 5 });
      engine.hazards.push(hazard);

      // Food located beyond the hazard at (650, 400)
      const food = new FoodItem(650, 400, 'apple');
      engine.foods.push(food);

      bot.stepPolicy(engine, input);

      // Raycast lookahead must detect the hazard intercept and deflect Y or steer away from direct +X
      expect(Math.abs(input.dirY)).toBeGreaterThan(0.2);
    });
  });

  /* ========================================================================= *
   * 2. HUMAN-LIKE SURVIVAL STATE MACHINE
   * ========================================================================= */
  describe('2. Human-Like Survival State Machine', () => {
    it('2.1 enters Emergency Mode when HP < 35% and amplifies health potion & shield attraction by 3x', () => {
      engine.foods.length = 0;
      const player = engine.player;
      player.x = 500;
      player.y = 400;
      player.hp = 30; // 30 / 110 = 27.2% (< 35% Emergency Mode)

      // Place a regular apple 50px to the right (+X) and a shield orb 80px to the left (-X)
      const apple = new FoodItem(550, 400, 'apple');
      const shield = new FoodItem(420, 400, 'shield');
      engine.foods.push(apple, shield);

      bot.stepPolicy(engine, input);

      // In emergency mode, shield/potion attraction is tripled, pulling snake toward shield (-X)
      expect(input.dirX).toBeLessThan(0);
    });

    it('2.2 in Emergency Mode, prioritizes evasive kiting and dodging away from enemies over combat', () => {
      engine.foods.length = 0;
      const player = engine.player;
      player.x = 500;
      player.y = 400;
      player.hp = 25; // 22.7% HP (Emergency Mode)

      // Spawn a vulnerable boss 180px to the right (+X)
      const boss = new Boss(1, 1280, 800, 'centipede', 680, 400);
      boss.entranceTimer = 0;
      engine.activeBosses = [boss];

      // Spawn an enemy encroaching from (550, 400)
      const enemy = new Enemy(550, 400, 'scarab', 1);
      engine.enemies.push(enemy);

      bot.stepPolicy(engine, input);

      // Emergency mode must kite away (-X) rather than engaging the boss or enemy head-on
      expect(input.dirX).toBeLessThan(0);
    });

    it('2.3 Tactical Combat Orbit: maintains 150-250px standoff distance and applies tangential orbit vector around boss', () => {
      engine.foods.length = 0;
      const player = engine.player;
      player.x = 500;
      player.y = 400;
      player.hp = 100; // Healthy

      // Boss positioned at (500, 200) -> distance = 200px (directly in 150-250px sweet spot)
      const boss = new Boss(1, 1280, 800, 'centipede', 500, 200);
      boss.entranceTimer = 0;
      engine.activeBosses = [boss];

      bot.stepPolicy(engine, input);

      // At 200px sweet spot, bot applies tangential orbital velocity (perpendicular to radial vector, so non-zero X velocity)
      expect(Math.abs(input.dirX)).toBeGreaterThan(0.3);
    });

    it('2.4 Tactical Combat Orbit: pushes outward when closer than 150px to avoid boss collision hull', () => {
      engine.foods.length = 0;
      const player = engine.player;
      player.x = 500;
      player.y = 400;
      player.hp = 100;

      // Boss positioned too close at (500, 320) -> distance = 80px (< 150px minimum safe orbital radius)
      const boss = new Boss(1, 1280, 800, 'centipede', 500, 320);
      boss.entranceTimer = 0;
      engine.activeBosses = [boss];

      bot.stepPolicy(engine, input);

      // Radial repulsion from boss should push player down (+Y) away from boss at (500, 320)
      expect(input.dirY).toBeGreaterThan(0.3);
    });

    it('2.5 Tactical Combat Orbit: closes distance when further than 250px from boss', () => {
      engine.foods.length = 0;
      const player = engine.player;
      player.x = 500;
      player.y = 550;
      player.hp = 100;

      // Boss positioned at (500, 150) -> distance = 400px (> 250px)
      const boss = new Boss(1, 1280, 800, 'centipede', 500, 150);
      boss.entranceTimer = 0;
      engine.activeBosses = [boss];

      bot.stepPolicy(engine, input);

      // Bot should pull toward boss (-Y direction) to enter 150-250px orbit range
      expect(input.dirY).toBeLessThan(-0.3);
    });
  });

  /* ========================================================================= *
   * 3. PROACTIVE CRANIAL LAB SHOPPER
   * ========================================================================= */
  describe('3. Proactive Cranial Lab Shopper', () => {
    it('3.1 executes proactive purchases in stepPolicy when Ouro >= 30 before boss encounter', () => {
      const meta = MetaProgression.Instance;
      const player = engine.player;
      player.ouro = 65;

      // Boss active in arena
      const boss = new Boss(1, 1280, 800, 'centipede', 500, 200);
      engine.activeBosses = [boss];

      expect(player.headPurchaseCount).toBe(0);

      bot.stepPolicy(engine, input);

      // Should have executed proactive purchase prior to boss engagement
      expect(player.headPurchaseCount).toBeGreaterThan(0);
      expect(player.ouro).toBeLessThan(65);
    });

    it('3.2 selects synergistic defensive modules for Emerald and Hydra classes', () => {
      const meta = MetaProgression.Instance;
      const player = engine.player;
      player.classId = 'emerald';
      player.ouro = 70;

      const evalResult = bot.evaluateLabPurchases(player, meta);

      // Top recommendations for Emerald should be defensive (shield, regen, spikes, nanite, chrono, horns)
      expect(evalResult.affordablePurchases.length).toBeGreaterThan(0);
      const topChoice = evalResult.affordablePurchases[0]!;
      expect(['shield', 'regen', 'spikes', 'nanite', 'chrono', 'horns', 'crest']).toContain(topChoice.id);
    });

    it('3.3 selects synergistic offensive modules (plasma, magma, tachyon, laser) for Stalker and Solar classes', () => {
      const meta = MetaProgression.Instance;
      const player = engine.player;
      player.classId = 'stalker';
      player.ouro = 80;

      // Unlock tier 1 for offensive modules
      meta.UnlockTier('plasma', 1);
      meta.UnlockTier('magma', 1);
      meta.UnlockTier('tachyon', 1);
      meta.UnlockTier('laser', 1);

      const evalResult = bot.evaluateLabPurchases(player, meta);

      // Top recommendations for Stalker should be offensive weapons/augments
      expect(evalResult.affordablePurchases.length).toBeGreaterThan(0);
      const topChoice = evalResult.affordablePurchases[0]!;
      expect(['plasma', 'magma', 'tachyon', 'laser', 'turret', 'tesla', 'flak', 'scattershot', 'needler', 'fangs', 'maw', 'crown']).toContain(topChoice.id);
    });

    it('3.4 exhausts available Ouro on multi-upgrade purchases while respecting atomic balance bounds', () => {
      const meta = MetaProgression.Instance;
      const player = engine.player;
      player.ouro = 150;

      const result = bot.performLabPurchases(player, meta, logger);

      expect(result.purchasedCount).toBeGreaterThanOrEqual(2);
      expect(result.totalSpent).toBeGreaterThanOrEqual(60);
      expect(player.ouro).toBeGreaterThanOrEqual(0);
      expect(player.ouro).toBe(150 - result.totalSpent);
    });
  });
});
