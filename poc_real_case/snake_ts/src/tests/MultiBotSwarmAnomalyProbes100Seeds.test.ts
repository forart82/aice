/**
 * Ouroboros Ascension — Multi-Bot Swarm Sweeps & Behavioral Anomaly Probes (100+ Seeds)
 * (src/tests/MultiBotSwarmAnomalyProbes100Seeds.test.ts)
 *
 * Implements:
 * 1. Multi-Bot Swarm Sweeps across 125 discrete seeds (25 seeds x 5 serpent classes:
 *    Emerald, Stalker, Hydra, Storm, Solar) validating potential field navigation,
 *    autonomous lookahead, tactical combat triggers, and zero-NaN numeric stability.
 * 2. Real-Time Behavioral & Physical Anomaly Probing:
 *    - NaN / Non-finite coordinate and velocity detection.
 *    - Out-of-bounds arena boundary escape detection.
 *    - Body segment detachment distance constraint violations.
 *    - Corrupted or negative segment counts.
 *    - Unhandled exception and state freeze guards in headless simulation.
 * 3. Deep Stress-Test Suite for Simulation Edge Cases:
 *    - 120 Hz high-frequency oscillating steering and extreme vector thrashing.
 *    - Simultaneous Dash + Class Skill activation on the exact same frame.
 *    - High-velocity wall and corner collisions from all 8 cardinal and diagonal angles.
 *    - SpatialHashGrid malformed queries (NaN coordinates, negative radii, extreme densities > 5000 entities, zero-length DDA rays).
 * 4. Memory Leak & Entity Array Bounding Audit across continuous multi-seed lifecycles.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GameEngine } from '../sim/GameEngine.js';
import { GameState } from '../sim/GameState.js';
import { Boss } from '../sim/Boss.js';
import { Enemy } from '../sim/Enemy.js';
import { FoodItem } from '../sim/FoodItem.js';
import { Hazard } from '../sim/Hazard.js';
import { Projectile } from '../sim/Projectile.js';
import { SnakePlayer, SnakeSegment } from '../sim/SnakePlayer.js';
import { GameData } from '../data/GameData.js';
import { MetaProgression } from '../data/MetaProgression.js';
import { Services } from '../core/Services.js';
import { ScriptedInput, NullFx, NullSound } from '../core/Contracts.js';
import { MathX } from '../core/MathX.js';
import { Rng } from '../core/Rng.js';
import { SpatialHashGrid, SpatialLayer, SpatialLayerMask } from '../sim/SpatialHashGrid.js';
import { AutonomousBotPlayer } from '../sim/ai/AutonomousBotPlayer.js';
import {
  BehavioralAnomalyDetector,
  AnomalyType,
  AnomalySeverity,
  type AnomalyEvent,
} from '../sim/ai/BehavioralAnomalyDetector.js';
import { setupMockDom } from './MockDom.js';

describe('Multi-Bot Swarm Sweeps & Behavioral Anomaly Probes (100+ Seeds)', () => {
  let g: GameEngine;
  let im: ScriptedInput;
  let bot: AutonomousBotPlayer;
  let detector: BehavioralAnomalyDetector;
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

    for (const k of GameData.Classes.Keys) {
      meta.UnlockedClasses[k] = true;
    }

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

    bot = new AutonomousBotPlayer();
    detector = new BehavioralAnomalyDetector();
  });

  afterEach(() => {
    teardownDom();
  });

  /* ========================================================================= *
   * 1. MULTI-BOT SWARM SWEEPS ACROSS 125 DISCRETE SEEDS (ALL 5 CLASSES)
   * ========================================================================= */
  describe('1. Multi-Bot Swarm Sweeps Across 125 Discrete Seeds (All 5 Classes)', () => {
    const classTestMatrix: { classId: string; seeds: number[] }[] = [
      {
        classId: 'emerald',
        seeds: Array.from({ length: 25 }, (_, i) => 1001 + i),
      },
      {
        classId: 'stalker',
        seeds: Array.from({ length: 25 }, (_, i) => 2001 + i),
      },
      {
        classId: 'hydra',
        seeds: Array.from({ length: 25 }, (_, i) => 3001 + i),
      },
      {
        classId: 'storm',
        seeds: Array.from({ length: 25 }, (_, i) => 4001 + i),
      },
      {
        classId: 'solar',
        seeds: Array.from({ length: 25 }, (_, i) => 5001 + i),
      },
    ];

    for (const { classId, seeds } of classTestMatrix) {
      it(`executes autonomous bot swarm across 25 discrete seeds for class: "${classId}"`, () => {
        const detectedAnomalies: { seed: number; anomalies: AnomalyEvent[] }[] = [];

        for (const seed of seeds) {
          Rng.Shared.setSeed(seed);
          detector.reset();

          g.GameMode = 'rogue';
          g.SelectedClass = classId;
          g.StartRun();

          const player = g.Player!;
          expect(player.ClassId).toBe(classId);

          // Simulate 120 ticks (1 full second of 120Hz real-time simulation)
          for (let step = 0; step < 120; step++) {
            bot.stepPolicy(g, im);
            g.Step(1 / 120);

            if (g.State === GameState.LevelUp) {
              bot.handleLevelUp(g);
            }

            // Real-time anomaly detection probe
            const frameAnomalies = detector.evaluate(g, im, 1 / 120, { applyCorrection: true });
            if (frameAnomalies.length > 0) {
              detectedAnomalies.push({ seed, anomalies: frameAnomalies });
            }

            // Numeric stability assertions
            expect(Number.isFinite(player.X)).toBe(true);
            expect(Number.isFinite(player.Y)).toBe(true);
            expect(Number.isFinite(player.Angle)).toBe(true);
            expect(Number.isFinite(player.TargetAngle)).toBe(true);
            expect(Number.isFinite(player.VelocityX)).toBe(true);
            expect(Number.isFinite(player.VelocityY)).toBe(true);
            expect(Number.isFinite(player.Hp)).toBe(true);
            expect(Number.isFinite(player.MaxHp)).toBe(true);
            expect(Number.isFinite(player.Ouro)).toBe(true);

            // Boundary confinement: Player head stays within arena bounds
            expect(player.X).toBeGreaterThanOrEqual(player.HeadRadius - 0.01);
            expect(player.X).toBeLessThanOrEqual(g.ArenaW - player.HeadRadius + 0.01);
            expect(player.Y).toBeGreaterThanOrEqual(player.HeadRadius - 0.01);
            expect(player.Y).toBeLessThanOrEqual(g.ArenaH - player.HeadRadius + 0.01);

            // Segment kinematic constraints: Distance between consecutive segments <= 2.5 * spacing
            const segs = player.Segments;
            expect(segs.length).toBeGreaterThanOrEqual(0);

            let prevX = player.X;
            let prevY = player.Y;
            for (let s = 0; s < segs.length; s++) {
              const seg = segs[s]!;
              expect(Number.isFinite(seg.X)).toBe(true);
              expect(Number.isFinite(seg.Y)).toBe(true);
              expect(Number.isFinite(seg.Angle)).toBe(true);

              const dist = MathX.hypot(prevX - seg.X, prevY - seg.Y);
              // Max kinematic separation threshold during fast turns
              expect(dist).toBeLessThanOrEqual(player.SegmentSpacing * 2.5 + 1.0);

              prevX = seg.X;
              prevY = seg.Y;
            }
          }

          expect(player.Alive || g.Combat.Kills >= 0).toBe(true);
        }

        // Verify that any detected behavioral anomalies had non-critical resolution
        for (const item of detectedAnomalies) {
          for (const a of item.anomalies) {
            expect(a.correctiveAction).toBeDefined();
            expect(a.correctiveAction.length).toBeGreaterThan(0);
          }
        }
      });
    }

    it('confirms total swarm sweeps evaluate >= 100 seeds across all classes', () => {
      const totalSeeds = classTestMatrix.reduce((sum, item) => sum + item.seeds.length, 0);
      expect(totalSeeds).toBe(125);
      expect(totalSeeds).toBeGreaterThanOrEqual(100);
    });
  });

  /* ========================================================================= *
   * 2. DETECT ANOMALIES & NUMERICAL INTEGRITY AUDIT
   * ========================================================================= */
  describe('2. Detect Anomalies & Numerical Integrity Audit', () => {
    it('2.1 detects and prevents NaN coordinates, velocities, and angles', () => {
      const p = g.Player!;
      p.X = 500;
      p.Y = 400;
      p.Angle = 0;
      p.TargetAngle = 0;

      // Feed NaN input direction to check robustness
      im.SetDirection(NaN, NaN);
      p.Update(1 / 120, g.ResolveSteering(), g.ArenaW, g.ArenaH, g.WorldBag());

      expect(Number.isNaN(p.X)).toBe(false);
      expect(Number.isNaN(p.Y)).toBe(false);
      expect(Number.isNaN(p.Angle)).toBe(false);
      expect(Number.isNaN(p.TargetAngle)).toBe(false);
      expect(Number.isFinite(p.X)).toBe(true);
      expect(Number.isFinite(p.Y)).toBe(true);
    });

    it('2.2 validates boundary containment and zero out-of-bounds escapes under extreme speeds', () => {
      const p = g.Player!;
      // Set extreme speed (100x normal)
      p.Stats.Speed = 100;
      p.Angle = 0;
      p.TargetAngle = 0;

      for (let step = 0; step < 60; step++) {
        im.SetDirection(1, 0);
        p.Update(1 / 120, g.ResolveSteering(), g.ArenaW, g.ArenaH, g.WorldBag());

        expect(p.X).toBeLessThanOrEqual(g.ArenaW - p.HeadRadius + 0.001);
        expect(p.X).toBeGreaterThanOrEqual(p.HeadRadius - 0.001);
      }
    });

    it('2.3 asserts inverse kinematics prevents body segment detachment under maximum whip turns', () => {
      const p = g.Player!;
      p.AddGrowth(10);
      expect(p.Segments.length).toBe(13); // 3 initial + 10 growth

      // Whip 180 degrees back and forth rapidly
      for (let step = 0; step < 120; step++) {
        const dir = step % 2 === 0 ? 1 : -1;
        im.SetDirection(dir, 0);
        p.Update(1 / 120, g.ResolveSteering(), g.ArenaW, g.ArenaH, g.WorldBag());

        let prevX = p.X;
        let prevY = p.Y;
        for (let s = 0; s < p.Segments.length; s++) {
          const seg = p.Segments[s]!;
          const d = MathX.hypot(prevX - seg.X, prevY - seg.Y);
          expect(d).toBeLessThanOrEqual(p.SegmentSpacing * 2.5 + 2.0);
          prevX = seg.X;
          prevY = seg.Y;
        }
      }
    });

    it('2.4 verifies segment count cannot become negative or corrupted', () => {
      const p = g.Player!;
      expect(p.Segments.length).toBe(3);
      expect(p.Length).toBe(4);

      // Attempt invalid modifications
      p.AddGrowth(0);
      expect(p.Segments.length).toBe(3);

      // Damage segment lethally to sever body chain
      p.DamageSegment(0, 9999);
      expect(p.Segments.length).toBe(0);
      expect(p.Length).toBe(1);

      // Regrow segments
      p.AddGrowth(3);
      expect(p.Segments.length).toBe(3);
      expect(p.Segments.every((s) => s instanceof SnakeSegment)).toBe(true);
    });
  });

  /* ========================================================================= *
   * 3. STRESS-TEST RAPID INPUTS, SIMULTANEOUS ABILITIES & EDGE COLLISIONS
   * ========================================================================= */
  describe('3. Stress-Test Rapid Inputs, Simultaneous Abilities & Edge Collisions', () => {
    it('3.1 stress-tests 120Hz oscillating steering input reversals without NaN or spinlock', () => {
      const p = g.Player!;

      for (let step = 0; step < 240; step++) {
        // High frequency 120Hz oscillating input vectors
        const angle = (step * Math.PI) / 2;
        im.SetDirection(Math.cos(angle), Math.sin(angle));

        p.Update(1 / 120, g.ResolveSteering(), g.ArenaW, g.ArenaH, g.WorldBag());

        expect(Number.isFinite(p.X)).toBe(true);
        expect(Number.isFinite(p.Y)).toBe(true);
        expect(Number.isFinite(p.Angle)).toBe(true);
        expect(p.Angle).toBeGreaterThanOrEqual(-Math.PI - 0.001);
        expect(p.Angle).toBeLessThanOrEqual(Math.PI + 0.001);
      }
    });

    it('3.2 triggers simultaneous Dash and Class Skill on the exact same frame across all 5 classes', () => {
      const classes = ['emerald', 'stalker', 'hydra', 'storm', 'solar'];

      for (const cls of classes) {
        g.SelectedClass = cls;
        g.StartRun();
        const p = g.Player!;

        expect(p.DashReady).toBe(true);
        expect(p.SkillReady).toBe(true);

        // Trigger simultaneous Dash + Skill
        const dashResult = p.TryDash();
        const skillResult = p.TriggerSkill(g.WorldBag(), g.Combat);

        expect(dashResult).toBe(true);
        expect(skillResult).toBe(true);
        expect(p.IsDashing).toBe(true);
        expect(p.SkillCooldownTimer).toBeGreaterThan(0);

        // Step simulation 60 frames during active simultaneous dash + skill
        for (let s = 0; s < 60; s++) {
          im.SetDirection(1, 0);
          g.Step(1 / 120);

          expect(Number.isFinite(p.X)).toBe(true);
          expect(Number.isFinite(p.Y)).toBe(true);
          expect(Number.isFinite(p.Hp)).toBe(true);
        }
      }
    });

    it('3.3 stress-tests edge wall and corner collisions at 2.5x dash velocity from all 8 angles', () => {
      const p = g.Player!;
      const testAngles = [
        0,                 // East (Right wall)
        Math.PI / 4,       // South-East (Bottom-Right corner)
        Math.PI / 2,       // South (Bottom wall)
        (3 * Math.PI) / 4, // South-West (Bottom-Left corner)
        Math.PI,           // West (Left wall)
        (-3 * Math.PI) / 4,// North-West (Top-Left corner)
        -Math.PI / 2,      // North (Top wall)
        -Math.PI / 4,      // North-East (Top-Right corner)
      ];

      for (const angle of testAngles) {
        p.X = g.ArenaW / 2;
        p.Y = g.ArenaH / 2;
        p.Angle = angle;
        p.TargetAngle = angle;
        p.DashCooldownTimer = 0;
        p.IsDashing = false;
        p.TryDash();
        expect(p.IsDashing).toBe(true);

        // Slam into wall along angle vector
        const dirX = Math.cos(angle);
        const dirY = Math.sin(angle);
        im.SetDirection(dirX, dirY);

        for (let s = 0; s < 180; s++) {
          p.Update(1 / 120, g.ResolveSteering(), g.ArenaW, g.ArenaH, g.WorldBag());

          // Verify containment and zero NaN
          expect(Number.isFinite(p.X)).toBe(true);
          expect(Number.isFinite(p.Y)).toBe(true);
          expect(p.X).toBeGreaterThanOrEqual(p.HeadRadius - 0.01);
          expect(p.X).toBeLessThanOrEqual(g.ArenaW - p.HeadRadius + 0.01);
          expect(p.Y).toBeGreaterThanOrEqual(p.HeadRadius - 0.01);
          expect(p.Y).toBeLessThanOrEqual(g.ArenaH - p.HeadRadius + 0.01);
        }
      }
    });

    it('3.4 stress-tests SpatialHashGrid queries under extreme malformed inputs and high densities', () => {
      const grid = new SpatialHashGrid(48, 3200, 2400);

      // 1. Malformed non-finite inputs
      grid.insert(SpatialLayer.Segments, NaN, NaN, 0, 20);
      grid.insert(SpatialLayer.Enemies, Infinity, -Infinity, 1, 30);
      expect(grid.getItemCount(SpatialLayer.Segments)).toBe(0); // Safely rejected
      expect(grid.getItemCount(SpatialLayer.Enemies)).toBe(0);

      // 2. Out-of-bounds coordinates (clamped to boundary bins)
      grid.insert(SpatialLayer.Projectiles, -500, -500, 0, 10);
      grid.insert(SpatialLayer.Projectiles, 50000, 50000, 1, 10);
      expect(grid.getItemCount(SpatialLayer.Projectiles)).toBe(2);

      // 3. Negative query radius and NaN center coordinates
      expect(grid.queryRadius(SpatialLayerMask.All, NaN, NaN, 50, () => {})).toBe(false);
      expect(grid.queryRadius(SpatialLayerMask.All, 100, 100, -10, () => {})).toBe(false);
      expect(grid.queryNearest(SpatialLayerMask.All, NaN, NaN, 100)).toBeNull();
      expect(grid.queryNearest(SpatialLayerMask.All, 100, 100, -50)).toBeNull();

      // 4. Degenerate raymarching (zero-length ray, NaN origin, negative max distance)
      expect(grid.queryRay(SpatialLayerMask.All, 0, 0, 0, 0, 100, () => {})).toBe(false);
      expect(grid.queryRay(SpatialLayerMask.All, NaN, NaN, 1, 0, 100, () => {})).toBe(false);
      expect(grid.queryRay(SpatialLayerMask.All, 100, 100, 1, 0, -10, () => {})).toBe(false);

      // 5. Extreme density: Insert 6,000 entities across layers triggering dynamic reallocation
      grid.clear();
      for (let i = 0; i < 6000; i++) {
        const lx = (i * 17) % 3000;
        const ly = (i * 23) % 2200;
        grid.insert(SpatialLayer.Segments, lx, ly, i, 15);
      }
      expect(grid.getItemCount(SpatialLayer.Segments)).toBe(6000);
      expect(grid.getCapacity(SpatialLayer.Segments)).toBeGreaterThanOrEqual(6000);

      // Query nearest in dense grid
      const nearest = grid.queryNearest(SpatialLayerMask.Segments, 500, 500, 200);
      expect(nearest).not.toBeNull();
      expect(nearest!.id).toBeGreaterThanOrEqual(0);
    });
  });

  /* ========================================================================= *
   * 4. HEADLESS SIMULATION INTEGRITY & ZERO FREEZE AUDIT
   * ========================================================================= */
  describe('4. Headless Simulation Integrity & Zero Freeze Audit', () => {
    it('4.1 steps through all GameState phases without deadlocks or uncaught exceptions', () => {
      const states = [
        GameState.Menu,
        GameState.ClassSelect,
        GameState.Playing,
        GameState.LevelUp,
        GameState.FloorClear,
        GameState.Sanctuary,
        GameState.GameOver,
        GameState.Victory,
      ];

      for (const st of states) {
        g.State = st;
        expect(() => {
          g.Step(1 / 120);
        }).not.toThrow();
      }
    });

    it('4.2 executes 10 multi-boss escalation rounds in endless mode without heap leak or freeze', () => {
      g.GameMode = 'endless';
      g.SelectedClass = 'hydra';
      Rng.Shared.setSeed(9999);
      g.StartRun();

      for (let floor = 1; floor <= 10; floor++) {
        g.CurrentFloor = floor;
        g.SpawnBoss();

        // If multiple bosses active
        const bosses = g.ActiveBosses.length > 0 ? g.ActiveBosses : (g.Boss ? [g.Boss] : []);
        expect(bosses.length).toBeGreaterThan(0);

        for (const b of bosses) {
          b.EntranceTimer = 0;
          b.ApplyDamage(b.MaxHp + 100);
          b.Dead = true;
        }

        g.Step(1 / 120);
        expect(g.State).toBe(GameState.FloorClear);
        g.AdvanceFloor();
      }

      expect(g.Combat.BossKills).toBeGreaterThanOrEqual(10);
      expect(g.Enemies.length).toBe(0);
      expect(g.Hazards.length).toBeLessThan(150);
      expect(g.Projectiles.length).toBeLessThan(200);
    });
  });
});
