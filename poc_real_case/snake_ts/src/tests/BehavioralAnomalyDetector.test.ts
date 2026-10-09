/**
 * Ouroboros Ascension — Behavioral Anomaly Tracer & Detector Test Suite
 * (src/tests/BehavioralAnomalyDetector.test.ts)
 *
 * Verifies:
 * 1. ANOMALY_SELF_TRAP: Detects bot steering directly into body coils when escape vectors exist.
 * 2. ANOMALY_HAZARD_SUICIDE: Detects bot pathing directly into lethal hazards/lasers and applies repulsion.
 * 3. ANOMALY_HOARDING: Detects holding >= 60 Ouro with unlocked affordable upgrades without purchasing for > 20s.
 * 4. ANOMALY_WASTED_ABILITY: Detects triggering Dash or Skill when 0 threats/targets exist in vicinity.
 * 5. ANOMALY_POTION_NEGLIGENCE: Detects ignoring health potions within 200px while HP < 35%.
 * 6. Telemetry & Summary Logging: Audits anomaly records, severities (LOW, MEDIUM, CRITICAL), and report generation.
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
import {
  BehavioralAnomalyDetector,
  AnomalyType,
  AnomalySeverity,
  type AnomalyEvent,
} from '../sim/ai/BehavioralAnomalyDetector.js';

describe('BehavioralAnomalyDetector & BotTelemetryLogger Anomaly Engine', () => {
  let engine: GameEngine;
  let input: ScriptedInput;
  let bot: AutonomousBotPlayer;
  let logger: BotTelemetryLogger;
  let detector: BehavioralAnomalyDetector;

  beforeEach(() => {
    Services.resetToNull();
    Services.headless = true;
    input = new ScriptedInput();
    Services.input = input;

    const memStore = new Map<string, string>();
    MetaProgression.readBackend = (key) => memStore.get(key) ?? null;
    MetaProgression.writeBackend = (key, val) => { memStore.set(key, val); };
    MetaProgression.deleteBackend = (key) => { memStore.delete(key); };
    MetaProgression.instance = new MetaProgression();

    engine = new GameEngine();
    engine.setupCanvas(1280, 800, 1);
    engine.gameMode = 'rogue';
    engine.selectedClass = 'emerald';
    engine.startRun();

    bot = new AutonomousBotPlayer();
    logger = new BotTelemetryLogger();
    detector = new BehavioralAnomalyDetector({ logger });
  });

  /* ========================================================================= *
   * 1. ANOMALY_SELF_TRAP
   * ========================================================================= */
  describe('1. ANOMALY_SELF_TRAP Detection & Correction', () => {
    it('1.1 flags ANOMALY_SELF_TRAP (CRITICAL) when steering directly into body coils with open exits', () => {
      const p = engine.player;
      p.x = 500;
      p.y = 400;

      // Create a body coil directly to the right (+X)
      p.addGrowth(8);
      for (let i = 3; i < p.segments.length; i++) {
        p.segments[i]!.x = 540 + (i - 3) * 10;
        p.segments[i]!.y = 400;
      }

      // Input steering right directly into the body coil
      input.dirX = 1.0;
      input.dirY = 0.0;

      const anomalies = detector.evaluate(engine, input, 1 / 120);

      const trap = anomalies.find(a => a.type === AnomalyType.ANOMALY_SELF_TRAP || a.type === 'ANOMALY_SELF_TRAP');
      expect(trap).toBeDefined();
      expect(trap!.severity).toBe(AnomalySeverity.CRITICAL);
      expect(trap!.position.x).toBe(500);
      expect(trap!.position.y).toBe(400);
      expect(trap!.correctiveAction).toBeTruthy();
    });

    it('1.2 applies corrective steering away from self-trap when corrective mode is enabled', () => {
      const p = engine.player;
      p.x = 500;
      p.y = 400;

      p.addGrowth(8);
      for (let i = 3; i < p.segments.length; i++) {
        p.segments[i]!.x = 535;
        p.segments[i]!.y = 400;
      }

      input.dirX = 1.0;
      input.dirY = 0.0;

      detector.evaluate(engine, input, 1 / 120, { applyCorrection: true });

      // Steering should have been diverted away from +X
      expect(input.dirX).toBeLessThan(0.8);
      expect(Math.abs(input.dirY)).toBeGreaterThan(0.2);
    });

    it('1.3 does not flag self-trap when steering towards open space', () => {
      const p = engine.player;
      p.x = 500;
      p.y = 400;

      p.addGrowth(8);
      for (let i = 3; i < p.segments.length; i++) {
        p.segments[i]!.x = 540;
        p.segments[i]!.y = 400;
      }

      // Steer left away from segments
      input.dirX = -1.0;
      input.dirY = 0.0;

      const anomalies = detector.evaluate(engine, input, 1 / 120);
      const trap = anomalies.find(a => a.type === AnomalyType.ANOMALY_SELF_TRAP || a.type === 'ANOMALY_SELF_TRAP');
      expect(trap).toBeUndefined();
    });
  });

  /* ========================================================================= *
   * 2. ANOMALY_HAZARD_SUICIDE
   * ========================================================================= */
  describe('2. ANOMALY_HAZARD_SUICIDE Detection & Correction', () => {
    it('2.1 flags ANOMALY_HAZARD_SUICIDE (CRITICAL) when pathing directly into an active hazard', () => {
      const p = engine.player;
      p.x = 500;
      p.y = 400;

      // Active lethal magma hazard 50px directly ahead to the right
      const hazard = new Hazard(550, 400, 'magma', { Radius: 35, Dps: 40, Life: 10 });
      engine.hazards.push(hazard);

      input.dirX = 1.0;
      input.dirY = 0.0;

      const anomalies = detector.evaluate(engine, input, 1 / 120);

      const hazAnomaly = anomalies.find(a => a.type === AnomalyType.ANOMALY_HAZARD_SUICIDE || a.type === 'ANOMALY_HAZARD_SUICIDE');
      expect(hazAnomaly).toBeDefined();
      expect(hazAnomaly!.severity).toBe(AnomalySeverity.CRITICAL);
      expect(hazAnomaly!.correctiveAction).toContain('hazard');
    });

    it('2.2 generates corrective evasive steering vector away from the hazard zone', () => {
      const p = engine.player;
      p.x = 500;
      p.y = 400;

      const hazard = new Hazard(540, 400, 'laser_beam', { Radius: 30, Dps: 50, Life: 5 });
      engine.hazards.push(hazard);

      input.dirX = 1.0;
      input.dirY = 0.0;

      detector.evaluate(engine, input, 1 / 120, { applyCorrection: true });

      // Should steer away from (+1, 0)
      expect(input.dirX).toBeLessThan(0.7);
    });

    it('2.3 does not flag suicide when steering safely away from distant or dead hazards', () => {
      const p = engine.player;
      p.x = 500;
      p.y = 400;

      const hazard = new Hazard(540, 400, 'magma', { Radius: 30, Dps: 20, Life: 5 });
      hazard.Dead = true;
      engine.hazards.push(hazard);

      input.dirX = 1.0;
      input.dirY = 0.0;

      const anomalies = detector.evaluate(engine, input, 1 / 120);
      const hazAnomaly = anomalies.find(a => a.type === AnomalyType.ANOMALY_HAZARD_SUICIDE || a.type === 'ANOMALY_HAZARD_SUICIDE');
      expect(hazAnomaly).toBeUndefined();
    });
  });

  /* ========================================================================= *
   * 3. ANOMALY_HOARDING
   * ========================================================================= */
  describe('3. ANOMALY_HOARDING Detection & Timer Accounting', () => {
    it('3.1 flags ANOMALY_HOARDING (MEDIUM) after holding >= 60 Ouro with affordable unlocked upgrades for > 20s', () => {
      const p = engine.player;
      p.ouro = 80; // >= 60

      // Tier 1 turret is unlocked and costs 30 (affordable)
      const meta = MetaProgression.Instance;
      expect(meta.IsTierUnlocked('turret', 1)).toBe(true);

      // Step 15 seconds: no anomaly yet
      let anomalies = detector.evaluate(engine, input, 15.0);
      let hoarding = anomalies.find(a => a.type === AnomalyType.ANOMALY_HOARDING || a.type === 'ANOMALY_HOARDING');
      expect(hoarding).toBeUndefined();

      // Step another 6 seconds (total 21.0s > 20s threshold)
      anomalies = detector.evaluate(engine, input, 6.0);
      hoarding = anomalies.find(a => a.type === AnomalyType.ANOMALY_HOARDING || a.type === 'ANOMALY_HOARDING');
      expect(hoarding).toBeDefined();
      expect(hoarding!.severity).toBe(AnomalySeverity.MEDIUM);
      expect(hoarding!.details).toContain('80');
    });

    it('3.2 resets hoarding timer when Ouro is spent or drops below 60', () => {
      const p = engine.player;
      p.ouro = 75;

      detector.evaluate(engine, input, 18.0);
      expect(detector.getHoardingTimer()).toBe(18.0);

      // Spend Ouro down to 20
      p.ouro = 20;
      detector.evaluate(engine, input, 5.0);

      expect(detector.getHoardingTimer()).toBe(0);
      const anomalies = detector.evaluate(engine, input, 1.0);
      const hoarding = anomalies.find(a => a.type === AnomalyType.ANOMALY_HOARDING || a.type === 'ANOMALY_HOARDING');
      expect(hoarding).toBeUndefined();
    });

    it('3.3 does not flag hoarding if all affordable upgrades are locked', () => {
      const p = engine.player;
      p.ouro = 75;

      // Mock meta where nothing is unlocked
      const meta = MetaProgression.Instance;
      meta.IsTierUnlocked = () => false;

      const anomalies = detector.evaluate(engine, input, 25.0);
      const hoarding = anomalies.find(a => a.type === AnomalyType.ANOMALY_HOARDING || a.type === 'ANOMALY_HOARDING');
      expect(hoarding).toBeUndefined();
    });
  });

  /* ========================================================================= *
   * 4. ANOMALY_WASTED_ABILITY
   * ========================================================================= */
  describe('4. ANOMALY_WASTED_ABILITY Detection', () => {
    it('4.1 flags ANOMALY_WASTED_ABILITY (LOW) when Dash is triggered with 0 hostiles in vicinity', () => {
      const p = engine.player;
      p.x = 500;
      p.y = 400;

      // Ensure 0 enemies, bosses, hazards, projectiles
      engine.enemies.length = 0;
      engine.activeBosses.length = 0;
      engine.projectiles.length = 0;

      // Bot triggers Dash
      p.isDashing = true;

      const anomalies = detector.evaluate(engine, input, 1 / 120);

      const wasted = anomalies.find(a => a.type === AnomalyType.ANOMALY_WASTED_ABILITY || a.type === 'ANOMALY_WASTED_ABILITY');
      expect(wasted).toBeDefined();
      expect(wasted!.severity).toBe(AnomalySeverity.LOW);
      expect(wasted!.details).toContain('Dash');
    });

    it('4.2 flags ANOMALY_WASTED_ABILITY (LOW) when Class Skill is triggered with 0 hostiles in vicinity', () => {
      const p = engine.player;
      p.x = 500;
      p.y = 400;

      engine.enemies.length = 0;
      engine.activeBosses.length = 0;
      engine.projectiles.length = 0;

      // Bot triggers Skill
      detector.notifyAbilityTriggered('skill', { x: p.x, y: p.y });

      const anomalies = detector.evaluate(engine, input, 1 / 120);

      const wasted = anomalies.find(a => a.type === AnomalyType.ANOMALY_WASTED_ABILITY || a.type === 'ANOMALY_WASTED_ABILITY');
      expect(wasted).toBeDefined();
      expect(wasted!.severity).toBe(AnomalySeverity.LOW);
      expect(wasted!.details).toContain('Skill');
    });

    it('4.3 does not flag wasted ability when threats are present in vicinity', () => {
      const p = engine.player;
      p.x = 500;
      p.y = 400;

      // Spawn an enemy 100px away
      const enemy = new Enemy(560, 420, 'scarab', 1);
      engine.enemies.push(enemy);

      p.isDashing = true;

      const anomalies = detector.evaluate(engine, input, 1 / 120);
      const wasted = anomalies.find(a => a.type === AnomalyType.ANOMALY_WASTED_ABILITY || a.type === 'ANOMALY_WASTED_ABILITY');
      expect(wasted).toBeUndefined();
    });
  });

  /* ========================================================================= *
   * 5. ANOMALY_POTION_NEGLIGENCE
   * ========================================================================= */
  describe('5. ANOMALY_POTION_NEGLIGENCE Detection & Correction', () => {
    it('5.1 flags ANOMALY_POTION_NEGLIGENCE (CRITICAL) when ignoring health potion within 200px while HP < 35%', () => {
      const p = engine.player;
      p.x = 500;
      p.y = 400;
      p.hp = 25; // 25 / 100 = 25% < 35%

      // Potion 90px to the right
      engine.foods.length = 0;
      const potion = new FoodItem(590, 400, 'potion');
      engine.foods.push(potion);

      // Bot steering left away from potion
      input.dirX = -1.0;
      input.dirY = 0.0;

      const anomalies = detector.evaluate(engine, input, 1 / 120);

      const negAnomaly = anomalies.find(a => a.type === AnomalyType.ANOMALY_POTION_NEGLIGENCE || a.type === 'ANOMALY_POTION_NEGLIGENCE');
      expect(negAnomaly).toBeDefined();
      expect(negAnomaly!.severity).toBe(AnomalySeverity.CRITICAL);
      expect(negAnomaly!.details).toContain('potion');
    });

    it('5.2 overrides steering towards the potion when corrective action is applied', () => {
      const p = engine.player;
      p.x = 500;
      p.y = 400;
      p.hp = 20;

      engine.foods.length = 0;
      const potion = new FoodItem(580, 400, 'potion');
      engine.foods.push(potion);

      input.dirX = -1.0;
      input.dirY = 0.0;

      detector.evaluate(engine, input, 1 / 120, { applyCorrection: true });

      // Corrective action should steer towards potion (+X)
      expect(input.dirX).toBeGreaterThan(0.5);
    });

    it('5.3 does not flag potion negligence when HP is healthy (>= 35%) or potion is already targeted', () => {
      const p = engine.player;
      p.x = 500;
      p.y = 400;
      p.hp = 80; // 80%

      engine.foods.length = 0;
      const potion = new FoodItem(580, 400, 'potion');
      engine.foods.push(potion);

      input.dirX = -1.0;
      input.dirY = 0.0;

      const anomalies = detector.evaluate(engine, input, 1 / 120);
      const negAnomaly = anomalies.find(a => a.type === AnomalyType.ANOMALY_POTION_NEGLIGENCE || a.type === 'ANOMALY_POTION_NEGLIGENCE');
      expect(negAnomaly).toBeUndefined();
    });
  });

  /* ========================================================================= *
   * 6. TELEMETRY LOGGING & REPORT GENERATION
   * ========================================================================= */
  describe('6. Telemetry Logging & Summary Report Generation', () => {
    it('6.1 records anomaly events in BotTelemetryLogger with full metadata', () => {
      const event: AnomalyEvent = {
        timestamp: 12.5,
        type: AnomalyType.ANOMALY_SELF_TRAP,
        severity: AnomalySeverity.CRITICAL,
        position: { x: 450, y: 320 },
        details: 'Steering into 5th segment coil',
        correctiveAction: 'Applied orthogonal diversion vector',
      };

      logger.recordAnomaly(event);

      const recorded = logger.getAnomalies();
      expect(recorded.length).toBe(1);
      expect(recorded[0]!.type).toBe(AnomalyType.ANOMALY_SELF_TRAP);
      expect(recorded[0]!.severity).toBe(AnomalySeverity.CRITICAL);
      expect(recorded[0]!.position.x).toBe(450);
      expect(recorded[0]!.correctiveAction).toBe('Applied orthogonal diversion vector');
    });

    it('6.2 computes anomaly summary counts by type and severity', () => {
      logger.recordAnomaly({
        timestamp: 10,
        type: AnomalyType.ANOMALY_SELF_TRAP,
        severity: AnomalySeverity.CRITICAL,
        position: { x: 100, y: 100 },
        correctiveAction: 'Diverted',
      });
      logger.recordAnomaly({
        timestamp: 20,
        type: AnomalyType.ANOMALY_HOARDING,
        severity: AnomalySeverity.MEDIUM,
        position: { x: 200, y: 200 },
        correctiveAction: 'Auto-purchased',
      });
      logger.recordAnomaly({
        timestamp: 30,
        type: AnomalyType.ANOMALY_WASTED_ABILITY,
        severity: AnomalySeverity.LOW,
        position: { x: 300, y: 300 },
        correctiveAction: 'Suppressed',
      });

      const summary = logger.getAnomalySummary();
      expect(summary.totalCount).toBe(3);
      expect(summary.bySeverity[AnomalySeverity.CRITICAL]).toBe(1);
      expect(summary.bySeverity[AnomalySeverity.MEDIUM]).toBe(1);
      expect(summary.bySeverity[AnomalySeverity.LOW]).toBe(1);
      expect(summary.byType[AnomalyType.ANOMALY_SELF_TRAP]).toBe(1);
      expect(summary.byType[AnomalyType.ANOMALY_HOARDING]).toBe(1);
      expect(summary.byType[AnomalyType.ANOMALY_WASTED_ABILITY]).toBe(1);
    });

    it('6.3 includes Anomaly Summary section in generateSummaryReport() and export formats', () => {
      logger.recordAnomaly({
        timestamp: 14.2,
        type: AnomalyType.ANOMALY_HAZARD_SUICIDE,
        severity: AnomalySeverity.CRITICAL,
        position: { x: 520, y: 480 },
        details: 'Pathing into active laser beam',
        correctiveAction: 'Avoidance field applied',
      });

      // 1. generateSummaryReport() default Markdown
      const reportMd = logger.generateSummaryReport('markdown');
      expect(reportMd).toContain('## Behavioral Anomaly Summary');
      expect(reportMd).toContain('ANOMALY_HAZARD_SUICIDE');
      expect(reportMd).toContain('CRITICAL');

      // 2. exportSummaryMarkdown()
      const md = logger.exportSummaryMarkdown();
      expect(md).toContain('## Behavioral Anomaly Summary');

      // 3. exportSummaryText()
      const text = logger.exportSummaryText();
      expect(text).toContain('ANOMALIES:');
      expect(text).toContain('ANOMALY_HAZARD_SUICIDE');

      // 4. exportJson()
      const json = logger.exportJson();
      const parsed = JSON.parse(json);
      expect(parsed.anomalies).toBeDefined();
      expect(parsed.anomalies.length).toBe(1);
      expect(parsed.anomalySummary).toBeDefined();
      expect(parsed.anomalySummary.totalCount).toBe(1);
    });
  });
});
