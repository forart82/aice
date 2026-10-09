/**
 * ============================================================================
 * KINEMATICS, MOVEMENT, SERPENTINE PHYSICS, CONSTRICTION & COLLISION INVARIANCE
 * ============================================================================
 *
 * Dedicated Vitest test suite establishing non-negotiable physical and kinematic
 * invariance guarantees for Ouroboros Ascension (ORACLE.md §3.7-3.9, §3.18).
 *
 * Mathematical Pillars Covered:
 * 1. Angular Velocity Limits & Heading Kinematics (omega_turn clamping, agility surge, dash penalty).
 * 2. Serpentine Vertebral Distance Constraints (Gauss-Seidel Inverse Kinematics, radius tapering).
 * 3. Closed-Loop Ouroboros Constriction Topology (Ray-casting PIP, -80% stasis, crushing DPS, food fusion).
 * 4. Tactical Autotomy Tail Jettison (k = max(1, floor(N/2)), 1.2s i-frames, 4.0s agility surge, 140px shockwave).
 * 5. Centripetal Tail-Whip Collisions (v_i = v_head + omega * r, 180px knockback, light projectile deflection).
 * 6. Boundary Collisions, Damping & Escapability (sliding tangent projection, corner unpinning, inward steering).
 *
 * Conforms to:
 * - AGENTS.md Rule 1: Zero-code without tests
 * - AGENTS.md Rule 5: Deterministic & isolated test execution
 * - AGENTS.md Rule 8: The Oracle SSOT
 * - AGENTS.md Rule 10: Comprehensive in-code docstrings & mathematical commentary
 * - AGENTS.md Rule 11: Strict human-equivalent input compliance
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { SnakePlayer, SnakeSegment } from '../sim/SnakePlayer';
import { GameEngine } from '../sim/GameEngine';
import { World } from '../sim/World';
import { Enemy } from '../sim/Enemy';
import { Boss } from '../sim/Boss';
import { Projectile } from '../sim/Projectile';
import { FoodItem } from '../sim/FoodItem';
import { ScriptedInput, NullFx, NullSound } from '../core/Contracts';
import { Services } from '../core/Services';
import { MetaProgression } from '../data/MetaProgression';
import { MathX } from '../core/MathX';

describe('Kinematics, Movement, Serpentine Physics & Collision Invariance Test Suite', () => {
  let g: GameEngine;
  let im: ScriptedInput;
  const DT = 1 / 120; // Nominal 120 Hz simulation timestep (approx 0.008333s)
  const ARENA_W = 1280;
  const ARENA_H = 720;

  beforeEach(() => {
    // Reset MetaProgression singleton to pristine decoupled state
    MetaProgression.readBackend = () => null;
    MetaProgression.writeBackend = () => {};
    MetaProgression.deleteBackend = () => {};
    MetaProgression.instance = new MetaProgression();

    // Reset external platform services to deterministic headless null stubs
    im = new ScriptedInput();
    Services.input = im;
    Services.fx = new NullFx();
    Services.sound = new NullSound();
    Services.headless = true;

    // Initialize GameEngine harness
    g = new GameEngine();
    g.setupCanvas(ARENA_W, ARENA_H, 1);
  });

  // ==========================================================================
  // PILLAR 1: ANGULAR VELOCITY LIMITS & HEADING KINEMATICS
  // ==========================================================================
  describe('Pillar 1: Angular Velocity Limits & Steering Kinematics', () => {
    /**
     * Kinematic Heading Formulation:
     *   diff = angleDelta(Angle, TargetAngle) in (-pi, pi]
     *   step = clamp(turnSpeed * dt, 0, 1)
     *   Angle += diff * step
     *
     * Invariance: The heading change per tick |Delta theta| must never exceed
     *   |diff| * turnSpeed * dt <= turnSpeed * dt.
     */
    it('1.1 clamps heading angular rate strictly within omega_turn limits across acute, right, and reverse angles', () => {
      const player = new SnakePlayer('emerald', ARENA_W, ARENA_H, 4);
      player.X = 500;
      player.Y = 500;
      player.Angle = 0; // Pointing along positive X axis (+0 rad)
      const baseTurn = player.TurnSpeed; // 9.5 rad/s
      const maxAngleChangePerTick = baseTurn * DT; // 9.5 / 120 ≈ 0.079167 rad

      const testAngles = [
        { name: 'acute 45 deg', target: Math.PI / 4 },
        { name: 'right 90 deg', target: Math.PI / 2 },
        { name: 'obtuse 135 deg', target: (3 * Math.PI) / 4 },
        { name: 'complete 180 deg reversal', target: Math.PI },
        { name: 'negative 90 deg', target: -Math.PI / 2 },
      ];

      for (const t of testAngles) {
        player.Angle = 0;
        player.TargetAngle = 0;
        const steerX = Math.cos(t.target);
        const steerY = Math.sin(t.target);

        // Execute single simulation tick
        player.Update(DT, { Active: true, X: steerX, Y: steerY }, ARENA_W, ARENA_H, g.worldBag());

        const deltaAngle = Math.abs(MathX.angleDelta(0, player.Angle));
        // Verify rotation step matches authoritative diff * clamp(turn * dt, 0, 1) formula
        const expectedStep = Math.abs(t.target) * MathX.clamp(baseTurn * DT, 0, 1);
        expect(deltaAngle).toBeCloseTo(expectedStep, 5);
        expect(deltaAngle).toBeLessThanOrEqual(Math.PI * baseTurn * DT + 1e-6);
        // Verify serpent is turning in the direction of the target
        const expectedSign = Math.sign(t.target);
        if (expectedSign !== 0 && t.target !== Math.PI) {
          expect(Math.sign(player.Angle)).toBe(expectedSign);
        }
      }
    });

    it('1.2 scales angular turn rate by 0.65x dash damping factor during active dash', () => {
      const player = new SnakePlayer('emerald', ARENA_W, ARENA_H, 4);
      player.X = 500;
      player.Y = 500;
      player.Angle = 0;

      // Activate dash: DashSpeedMultiplier = 2.5, dash turn speed multiplier = 0.65
      player.TryDash();
      expect(player.IsDashing).toBe(true);

      const nominalTurn = player.EffectiveTurnSpeed; // 9.5 rad/s
      const dashTurnSpeed = nominalTurn * 0.65; // 6.175 rad/s
      const expectedMaxStep = dashTurnSpeed * DT;

      player.Update(DT, { Active: true, X: 0, Y: 1 }, ARENA_W, ARENA_H, g.worldBag());

      const deltaAngle = Math.abs(player.Angle);
      expect(deltaAngle).toBeCloseTo(expectedMaxStep * (Math.PI / 2), 5);
      expect(deltaAngle).toBeLessThanOrEqual(expectedMaxStep * (Math.PI / 2) + 1e-5);
    });

    it('1.3 scales angular turn rate by 1.45x agility surge factor after autotomy', () => {
      const player = new SnakePlayer('emerald', ARENA_W, ARENA_H, 6);
      player.X = 500;
      player.Y = 500;
      player.Angle = 0;

      // Trigger autotomy: activates AgilitySurgeTimer = 4.0s
      player.Autotomy();
      expect(player.AgilitySurgeTimer).toBe(4.0);
      expect(player.EffectiveTurnSpeed).toBeCloseTo(player.TurnSpeed * 1.45, 5);

      const surgeTurn = player.EffectiveTurnSpeed; // 9.5 * 1.45 = 13.775 rad/s
      const expectedStep = surgeTurn * DT;

      player.Update(DT, { Active: true, X: 0, Y: 1 }, ARENA_W, ARENA_H, g.worldBag());

      const deltaAngle = Math.abs(player.Angle);
      expect(deltaAngle).toBeCloseTo(expectedStep * (Math.PI / 2), 5);
    });

    it('1.4 correctly combines dash turn damping (0.65x) with agility surge (1.45x)', () => {
      const player = new SnakePlayer('emerald', ARENA_W, ARENA_H, 6);
      player.X = 500;
      player.Y = 500;
      player.Angle = 0;

      // Trigger autotomy (surge = 1.45x) and dash (damping = 0.65x)
      player.Autotomy();
      player.TryDash();
      expect(player.AgilitySurgeTimer).toBeGreaterThan(0);
      expect(player.IsDashing).toBe(true);

      // Combined turn rate: 9.5 * 1.45 * 0.65 = 8.95375 rad/s
      const combinedTurnRate = player.TurnSpeed * 1.45 * 0.65;
      const expectedStep = combinedTurnRate * DT;

      player.Update(DT, { Active: true, X: 0, Y: 1 }, ARENA_W, ARENA_H, g.worldBag());

      const deltaAngle = Math.abs(player.Angle);
      expect(deltaAngle).toBeCloseTo(expectedStep * (Math.PI / 2), 5);
    });

    it('1.5 selects the shortest angular path across the branch cut (+pi / -pi boundary)', () => {
      const player = new SnakePlayer('emerald', ARENA_W, ARENA_H, 4);
      player.X = 500;
      player.Y = 500;
      // Start near +pi (e.g. +3.0 rad) and steer to -3.0 rad
      player.Angle = 3.0;
      player.TargetAngle = 3.0;

      // Shortest difference between 3.0 and -3.0 is counter-clockwise through pi:
      // delta = (-3.0) - 3.0 = -6.0 -> normalized delta = -6.0 + 2*pi ≈ +0.283185 rad (positive)
      const targetSteer = { Active: true, X: Math.cos(-3.0), Y: Math.sin(-3.0) };
      player.Update(DT, targetSteer, ARENA_W, ARENA_H, g.worldBag());

      // Heading should increase positively toward +pi
      expect(player.Angle).toBeGreaterThan(3.0);
    });

    it('1.6 guarantees Angle remains normalized within [-pi, pi] across 720 continuous rotations', () => {
      const player = new SnakePlayer('emerald', ARENA_W, ARENA_H, 4);
      player.X = 500;
      player.Y = 500;

      // Simulate a continuous spinning circle for 6 seconds (720 ticks)
      for (let tick = 0; tick < 720; tick++) {
        const steerAngle = (tick / 60) * Math.PI;
        player.Update(DT, { Active: true, X: Math.cos(steerAngle), Y: Math.sin(steerAngle) }, ARENA_W, ARENA_H, g.worldBag());
        expect(player.Angle).toBeGreaterThanOrEqual(-Math.PI);
        expect(player.Angle).toBeLessThanOrEqual(Math.PI);
        expect(Number.isFinite(player.Angle)).toBe(true);
      }
    });

    it('1.7 preserves TargetAngle when steering input is inactive or within deadband (<= 0.001)', () => {
      const player = new SnakePlayer('emerald', ARENA_W, ARENA_H, 4);
      player.TargetAngle = 1.25;

      // Case A: steer.Active is false
      player.Update(DT, { Active: false, X: 1, Y: 0 }, ARENA_W, ARENA_H, g.worldBag());
      expect(player.TargetAngle).toBe(1.25);

      // Case B: steer vector magnitude is below deadband threshold (0.0005 < 0.001)
      player.Update(DT, { Active: true, X: 0.0004, Y: 0.0003 }, ARENA_W, ARENA_H, g.worldBag());
      expect(player.TargetAngle).toBe(1.25);
    });
  });

  // ==========================================================================
  // PILLAR 2: SERPENTINE VERTEBRAL DISTANCE CONSTRAINTS (GAUSS-SEIDEL IK)
  // ==========================================================================
  describe('Pillar 2: Serpentine Vertebral Distance Constraints (Gauss-Seidel IK)', () => {
    /**
     * Serpentine Distance Constraint Formula:
     *   For each segment i:
     *     dx = P_{i-1}.X - P_i.X
     *     dy = P_{i-1}.Y - P_i.Y
     *     distSq = dx^2 + dy^2
     *     if distSq > spacingSq:
     *       f = (dist - spacing) / dist
     *       P_i.X += dx * f
     *       P_i.Y += dy * f
     *   Guarantees: ||P_{i-1} - P_i|| <= SegmentSpacing (15px)
     */
    it('2.1 preserves exact 15px segment spacing across 240 simulation ticks at cruise speed', () => {
      const player = new SnakePlayer('emerald', ARENA_W, ARENA_H, 20);
      player.X = 500;
      player.Y = 500;
      player.Angle = 0;

      // Cruise forward for 2 seconds (240 ticks) with serpentine undulation
      for (let tick = 0; tick < 240; tick++) {
        const steerAngle = Math.sin(tick * 0.1) * 0.5;
        player.Update(DT, { Active: true, X: Math.cos(steerAngle), Y: Math.sin(steerAngle) }, ARENA_W, ARENA_H, g.worldBag());

        // Check inter-segment distances
        let prevX = player.X;
        let prevY = player.Y;
        for (let i = 0; i < player.Segments.length; i++) {
          const seg = player.Segments[i]!;
          const dist = Math.hypot(prevX - seg.X, prevY - seg.Y);
          // Distance must never exceed SegmentSpacing + numerical epsilon (15.001px)
          expect(dist).toBeLessThanOrEqual(player.SegmentSpacing + 0.001);
          // Distance must remain positive (no segment overlap collapse)
          expect(dist).toBeGreaterThan(0.1);
          prevX = seg.X;
          prevY = seg.Y;
        }
      }
    });

    it('2.2 preserves segment distance constraint under maximum dash velocity (487.5 px/s)', () => {
      const player = new SnakePlayer('emerald', ARENA_W, ARENA_H, 25);
      player.X = 600;
      player.Y = 360;
      player.Angle = 0;

      // Trigger dash: speed = 195 * 2.5 = 487.5 px/s
      player.TryDash();
      expect(player.IsDashing).toBe(true);

      for (let tick = 0; tick < 38; tick++) { // Full dash duration (0.32s ≈ 38 ticks)
        player.Update(DT, { Active: true, X: 1, Y: 0 }, ARENA_W, ARENA_H, g.worldBag());

        let prevX = player.X;
        let prevY = player.Y;
        for (let i = 0; i < player.Segments.length; i++) {
          const seg = player.Segments[i]!;
          const dist = Math.hypot(prevX - seg.X, prevY - seg.Y);
          expect(dist).toBeLessThanOrEqual(player.SegmentSpacing + 0.001);
          prevX = seg.X;
          prevY = seg.Y;
        }
      }
    });

    it('2.3 maintains vertebral stability and prevents collapse during violent 180 deg heading reversal', () => {
      const player = new SnakePlayer('emerald', ARENA_W, ARENA_H, 15);
      player.X = 600;
      player.Y = 360;
      player.Angle = 0;

      // Cruise right for 60 ticks
      for (let i = 0; i < 60; i++) {
        player.Update(DT, { Active: true, X: 1, Y: 0 }, ARENA_W, ARENA_H, g.worldBag());
      }

      // Instant 180° snap reversal to left (-1, 0)
      player.Angle = Math.PI;
      player.TargetAngle = Math.PI;

      // Simulate heading back left for 120 ticks
      for (let tick = 0; tick < 120; tick++) {
        player.Update(DT, { Active: true, X: -1, Y: 0 }, ARENA_W, ARENA_H, g.worldBag());

        let prevX = player.X;
        let prevY = player.Y;
        for (let i = 0; i < player.Segments.length; i++) {
          const seg = player.Segments[i]!;
          const dist = Math.hypot(prevX - seg.X, prevY - seg.Y);
          expect(dist).toBeLessThanOrEqual(player.SegmentSpacing + 0.001);
          expect(Number.isFinite(seg.X)).toBe(true);
          expect(Number.isFinite(seg.Y)).toBe(true);
          expect(Number.isFinite(seg.Angle)).toBe(true);
          prevX = seg.X;
          prevY = seg.Y;
        }
      }
    });

    it('2.4 validates gradual vertebral diameter tapering formula down the spine: R_i = R_0 * (1 - 0.4 * i / N)', () => {
      const N = 20;
      const player = new SnakePlayer('emerald', ARENA_W, ARENA_H, N);
      player.UpdateSegments(DT);

      const baseR = player.SegmentRadius; // 11px
      for (let i = 0; i < N; i++) {
        const seg = player.Segments[i]!;
        const expectedR = baseR * (1 - (i * 0.4) / N);
        expect(seg.R).toBeCloseTo(expectedR, 5);
      }
      // Tail segment (i = N - 1) radius is approximately 62% of base segment radius
      const tailSeg = player.Segments[N - 1]!;
      expect(tailSeg.R).toBeCloseTo(baseR * (1 - 0.4 * 19 / 20), 4);
    });

    it('2.5 recovers seamlessly from displaced or corrupted segment coordinates without throwing', () => {
      const player = new SnakePlayer('emerald', ARENA_W, ARENA_H, 10);
      player.X = 500;
      player.Y = 500;

      // Artificially teleport segments far away
      for (let i = 0; i < player.Segments.length; i++) {
        player.Segments[i]!.X = 9999;
        player.Segments[i]!.Y = 9999;
      }

      // UpdateSegments must pull segments back toward the head along the chain
      player.UpdateSegments(DT);

      let prevX = player.X;
      let prevY = player.Y;
      for (let i = 0; i < player.Segments.length; i++) {
        const seg = player.Segments[i]!;
        const dist = Math.hypot(prevX - seg.X, prevY - seg.Y);
        expect(dist).toBeLessThanOrEqual(player.SegmentSpacing + 0.001);
        prevX = seg.X;
        prevY = seg.Y;
      }
    });
  });

  // ==========================================================================
  // PILLAR 3: CLOSED-LOOP OUROBOROS CONSTRICTION TOPOLOGY
  // ==========================================================================
  describe('Pillar 3: Closed-Loop Ouroboros Constriction Topology', () => {
    /**
     * Closed-Loop Ouroboros Constriction Formula (ORACLE.md §3.9):
     *   Loop forms when Head approaches within R_snap = 41px of trailing segment k >= 3.
     *   Point-in-polygon ray-casting detects enclosed enemies.
     *   Enclosed enemies receive:
     *     stasisTimer = 2.0s -> stasisMult = 0.2 (-80% move speed)
     *     crushing damage = (120 + 15 * N) * DamageBonus
     *     Food items compressed into Astral Prism (+15 Ouro, instant Overdrive)
     */
    it('3.1 correctly detects circular loop encirclement and distinguishes interior vs exterior points', () => {
      g.selectedClass = 'emerald';
      g.gameMode = 'rogue';
      g.startRun();

      const player = g.player;
      const center = { x: 600, y: 360 };
      const radius = 90;
      const numSegments = 16;

      player.Segments = [];
      for (let i = 0; i < numSegments; i++) {
        const a = (i / numSegments) * Math.PI * 2;
        player.Segments.push({
          X: center.x + Math.cos(a) * radius,
          Y: center.y + Math.sin(a) * radius,
          Angle: a + Math.PI / 2,
          R: 11,
          Hp: 30,
          MaxHp: 30,
          HitFlash: 0,
          SelfHitCooldown: 0,
          BossHitCooldown: 0,
        } as any);
      }
      // Head connects to tail to form closed loop
      const last = player.Segments[numSegments - 1]!;
      player.X = last.X + 5;
      player.Y = last.Y + 5;

      // Points strictly inside the loop
      expect(g.combat.checkEncirclement(player, center.x, center.y)).toBe(true);
      expect(g.combat.checkEncirclement(player, center.x + 30, center.y - 20)).toBe(true);
      expect(g.combat.checkEncirclement(player, center.x - 40, center.y + 40)).toBe(true);

      // Points strictly outside the loop
      expect(g.combat.checkEncirclement(player, center.x + 150, center.y)).toBe(false);
      expect(g.combat.checkEncirclement(player, center.x - 200, center.y - 200)).toBe(false);
      expect(g.combat.checkEncirclement(player, 100, 100)).toBe(false);
    });

    it('3.2 verifies point-in-polygon ray-casting on non-convex / oblong serpentine coils', () => {
      g.selectedClass = 'emerald';
      g.gameMode = 'rogue';
      g.startRun();

      const player = g.player;
      player.Segments = [];

      // Construct an L-shaped non-convex loop:
      // (100, 100) -> (300, 100) -> (300, 200) -> (200, 200) -> (200, 300) -> (100, 300) -> close
      const polygonCoords = [
        { x: 100, y: 100 },
        { x: 200, y: 100 },
        { x: 300, y: 100 },
        { x: 300, y: 200 },
        { x: 200, y: 200 },
        { x: 200, y: 300 },
        { x: 100, y: 300 },
        { x: 100, y: 200 },
      ];

      for (const pt of polygonCoords) {
        player.Segments.push({
          X: pt.x,
          Y: pt.y,
          Angle: 0,
          R: 11,
          Hp: 30,
          MaxHp: 30,
          HitFlash: 0,
          SelfHitCooldown: 0,
          BossHitCooldown: 0,
        } as any);
      }
      player.X = 100;
      player.Y = 105;

      // Inside the top arm: (150, 150)
      expect(g.combat.checkEncirclement(player, 150, 150)).toBe(true);
      // Inside the bottom-left arm: (150, 250)
      expect(g.combat.checkEncirclement(player, 150, 250)).toBe(true);
      // In the cut-out corner of the L (exterior of loop): (250, 250)
      expect(g.combat.checkEncirclement(player, 250, 250)).toBe(false);
      // Far exterior: (500, 500)
      expect(g.combat.checkEncirclement(player, 500, 500)).toBe(false);
    });

    it('3.3 inflicts temporal stasis (-80% enemy speed) on trapped hostiles', () => {
      g.selectedClass = 'emerald';
      g.gameMode = 'rogue';
      g.startRun();

      const enemy = new Enemy(600, 360, 'swarmling', 1);
      enemy.SpawnTimer = 0;
      enemy.MaxHp = 1000;
      enemy.Hp = 1000;
      g.enemies.push(enemy);

      const player = g.player;
      player.X = 600;
      player.Y = 460;
      player.Segments = [];
      const numPts = 12;
      for (let i = 0; i < numPts; i++) {
        const a = (i / numPts) * Math.PI * 2;
        player.Segments.push({
          X: 600 + Math.cos(a) * 80,
          Y: 360 + Math.sin(a) * 80,
          Angle: a,
          R: 11,
          Hp: 30,
          MaxHp: 30,
          HitFlash: 0,
          SelfHitCooldown: 0,
          BossHitCooldown: 0,
        } as any);
      }
      // Snap head near segment 11
      const tail = player.Segments[11]!;
      player.X = tail.X + 2;
      player.Y = tail.Y + 2;

      // Trigger constriction check
      g.combat.checkConstriction(g.worldBag());

      // Verify stasis timer was applied
      expect(enemy.StasisTimer).toBe(2.0);

      // Verify stasis reduces enemy movement speed by exactly 80% (stasisMult = 0.2)
      const nominalSpeed = enemy.Speed;
      const initialX = enemy.X;
      const initialY = enemy.Y;
      enemy.Update(DT, player, g.worldBag());
      const distTraveled = Math.hypot(enemy.X - initialX, enemy.Y - initialY);

      // Expected displacement with stasis: Speed * 0.2 * DT
      const expectedDist = nominalSpeed * 0.2 * DT;
      expect(distTraveled).toBeCloseTo(expectedDist, 3);
    });

    it('3.4 calculates crushing damage using authoritative formula: (120 + 15 * N) * DamageBonus', () => {
      g.selectedClass = 'emerald';
      g.gameMode = 'rogue';
      g.startRun();

      const enemy = new Enemy(500, 500, 'scarab', 1);
      enemy.SpawnTimer = 0;
      enemy.Hp = 1000;
      enemy.MaxHp = 1000;
      g.enemies.push(enemy);

      const player = g.player;
      player.Segments = [];
      const N = 10;
      for (let i = 0; i < N; i++) {
        const a = (i / N) * Math.PI * 2;
        player.Segments.push({
          X: 500 + Math.cos(a) * 70,
          Y: 500 + Math.sin(a) * 70,
          Angle: a,
          R: 11,
          Hp: 30,
          MaxHp: 30,
          HitFlash: 0,
          SelfHitCooldown: 0,
          BossHitCooldown: 0,
        } as any);
      }
      player.X = player.Segments[N - 1]!.X + 4;
      player.Y = player.Segments[N - 1]!.Y + 4;
      player.DamageBonus = 1.25;

      const expectedCrushDmg = (120 + N * 15) * 1.25; // (120 + 150) * 1.25 = 337.5

      const initialHp = enemy.Hp;
      g.combat.checkConstriction(g.worldBag());

      const damageDealt = initialHp - enemy.Hp;
      expect(damageDealt).toBeCloseTo(expectedCrushDmg, 1);
    });

    it('3.5 applies stasis and crushing damage to serpentine boss guardians inside closed loop', () => {
      g.selectedClass = 'emerald';
      g.gameMode = 'rogue';
      g.startRun();

      const boss = new Boss(1, ARENA_W, ARENA_H, 'centipede', 500, 500);
      boss.EntranceTimer = 0;
      boss.Vulnerable = true;
      const initialHp = boss.Hp;
      g.bosses = [boss];

      const player = g.player;
      player.Segments = [];
      const N = 12;
      for (let i = 0; i < N; i++) {
        const a = (i / N) * Math.PI * 2;
        player.Segments.push({
          X: 500 + Math.cos(a) * 100,
          Y: 500 + Math.sin(a) * 100,
          Angle: a,
          R: 11,
          Hp: 30,
          MaxHp: 30,
          HitFlash: 0,
          SelfHitCooldown: 0,
          BossHitCooldown: 0,
        } as any);
      }
      player.X = player.Segments[N - 1]!.X + 4;
      player.Y = player.Segments[N - 1]!.Y + 4;

      g.combat.checkConstriction(g.worldBag());

      expect(boss.StasisTimer).toBe(1.0);
      expect(boss.Hp).toBeLessThan(initialHp);
    });

    it('3.6 fuses multiple trapped food items into an Astral Prism (singularity compression)', () => {
      g.selectedClass = 'emerald';
      g.gameMode = 'rogue';
      g.startRun();

      const player = g.player;
      player.Segments = [];
      const center = { x: 400, y: 400 };
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        player.Segments.push({
          X: center.x + Math.cos(a) * 75,
          Y: center.y + Math.sin(a) * 75,
          Angle: a,
          R: 11,
          Hp: 30,
          MaxHp: 30,
          HitFlash: 0,
          SelfHitCooldown: 0,
          BossHitCooldown: 0,
        } as any);
      }
      player.X = player.Segments[11]!.X + 3;
      player.Y = player.Segments[11]!.Y + 3;

      // Clear run-start food items and add test items
      g.foodItems.length = 0;
      g.foodItems.push(new FoodItem(center.x - 20, center.y, 'apple'));
      g.foodItems.push(new FoodItem(center.x + 20, center.y, 'apple'));
      g.foodItems.push(new FoodItem(center.x, center.y + 20, 'apple'));
      g.foodItems.push(new FoodItem(center.x + 200, center.y, 'apple')); // Outside

      expect(g.foodItems.length).toBe(4);

      g.combat.checkConstriction(g.worldBag());

      // Trapped food items compressed into 1 Astral Prism + 1 outside apple remaining = 2 total items
      expect(g.foodItems.length).toBe(2);
      const prism = g.foodItems.find((f) => f.Type === 'prism' || f.type === 'prism');
      expect(prism).toBeDefined();
    });
  });

  // ==========================================================================
  // PILLAR 4: TACTICAL AUTOTOMY TAIL JETTISON & AGILITY SURGE
  // ==========================================================================
  describe('Pillar 4: Tactical Autotomy Tail Jettison & Agility Surge', () => {
    /**
     * Autotomy Formulation (ORACLE.md §3.7):
     *   cutIndex = max(1, floor(N / 2))
     *   severedCount = N - cutIndex
     *   Retains cutIndex segments.
     *   Grants:
     *     InvulnerableTimer = 1.2s
     *     AgilitySurgeTimer = 4.0s (+45% turn speed)
     *     Ablative Shockwave: 140px AoE, 80 * DamageBonus damage
     */
    it('4.1 severs trailing segments according to k = max(1, floor(N/2)) across odd and even lengths', () => {
      const testCases = [
        { initial: 2, expectedCut: 1, expectedSevered: 1, expectedRetained: 1 },
        { initial: 3, expectedCut: 1, expectedSevered: 2, expectedRetained: 1 },
        { initial: 4, expectedCut: 2, expectedSevered: 2, expectedRetained: 2 },
        { initial: 7, expectedCut: 3, expectedSevered: 4, expectedRetained: 3 },
        { initial: 10, expectedCut: 5, expectedSevered: 5, expectedRetained: 5 },
        { initial: 15, expectedCut: 7, expectedSevered: 8, expectedRetained: 7 },
        { initial: 20, expectedCut: 10, expectedSevered: 10, expectedRetained: 10 },
      ];

      for (const tc of testCases) {
        const player = new SnakePlayer('emerald', ARENA_W, ARENA_H, tc.initial);
        expect(player.Segments.length).toBe(tc.initial);

        const severed = player.Autotomy();
        expect(severed).toBe(tc.expectedSevered);
        expect(player.Segments.length).toBe(tc.expectedRetained);
      }
    });

    it('4.2 boundary check: returns 0 and does not sever when serpent length is 1 or 0 segments', () => {
      const player1 = new SnakePlayer('emerald', ARENA_W, ARENA_H, 1);
      expect(player1.Autotomy()).toBe(0);
      expect(player1.Segments.length).toBe(1);

      const player0 = new SnakePlayer('emerald', ARENA_W, ARENA_H, 0);
      expect(player0.Autotomy()).toBe(0);
      expect(player0.Segments.length).toBe(0);
    });

    it('4.3 grants 1.2s emergency invulnerability frames (i-frames)', () => {
      const player = new SnakePlayer('emerald', ARENA_W, ARENA_H, 6);
      player.InvulnerableTimer = 0;

      player.Autotomy();
      expect(player.InvulnerableTimer).toBe(1.2);
    });

    it('4.4 activates 4.0s turning agility surge (+45% omega_turn)', () => {
      const player = new SnakePlayer('emerald', ARENA_W, ARENA_H, 8);
      expect(player.AgilitySurgeTimer).toBe(0);
      expect(player.EffectiveTurnSpeed).toBe(player.TurnSpeed);

      player.Autotomy();
      expect(player.AgilitySurgeTimer).toBe(4.0);
      expect(player.EffectiveTurnSpeed).toBeCloseTo(player.TurnSpeed * 1.45, 5);

      // Decrement timer across 1 second
      player.Update(1.0, { Active: false }, ARENA_W, ARENA_H, g.worldBag());
      expect(player.AgilitySurgeTimer).toBeCloseTo(3.0, 4);
    });

    it('4.5 detonates ablative shockwave (140px radius, 80 base damage) against nearby hostiles', () => {
      g.selectedClass = 'emerald';
      g.gameMode = 'rogue';
      g.startRun();

      const player = g.player;
      // Setup 6 segments positioned along X axis at intervals of 15px
      player.X = 500;
      player.Y = 500;
      player.Segments = [];
      for (let i = 0; i < 6; i++) {
        player.Segments.push({
          X: 500 - (i + 1) * 15,
          Y: 500,
          Angle: 0,
          R: 11,
          Hp: 30,
          MaxHp: 30,
          HitFlash: 0,
          SelfHitCooldown: 0,
          BossHitCooldown: 0,
        } as any);
      }
      player.RecalculateHp();
      player.RecalculateMaxHp();

      // cutIndex = floor(6/2) = 3 -> Cut happens at Segments[3] (X = 500 - 4 * 15 = 440, Y = 500)
      const cutX = 440;
      const cutY = 500;

      // Place an enemy within 140px radius (e.g. 50px away from cut point)
      const enemyNear = new Enemy(cutX + 50, cutY, 'swarmling', 1);
      enemyNear.SpawnTimer = 0;
      enemyNear.MaxHp = 200;
      enemyNear.Hp = 200;
      const initialHp = enemyNear.Hp;
      g.enemies.push(enemyNear);

      // Place an enemy far outside 140px radius (e.g. 300px away)
      const enemyFar = new Enemy(cutX + 300, cutY, 'swarmling', 1);
      enemyFar.SpawnTimer = 0;
      enemyFar.MaxHp = 200;
      enemyFar.Hp = 200;
      const initialFarHp = enemyFar.Hp;
      g.enemies.push(enemyFar);

      // Trigger autotomy through GameEngine/WorldBag
      g.requestAutotomy();

      // Near enemy must take 80 damage from shockwave
      expect(enemyNear.Hp).toBe(initialHp - 80);
      // Far enemy must take zero damage
      expect(enemyFar.Hp).toBe(initialFarHp);
    });

    it('4.6 synchronizes cumulative health and max health atomically after tail sacrifice', () => {
      const player = new SnakePlayer('emerald', ARENA_W, ARENA_H, 8);
      const initialMaxHp = player.MaxHp;

      player.Autotomy();

      // Remaining segments = 4. Expected MaxHp = HeadMaxHp (2 * 25 = 50) + 4 * 25 = 150
      expect(player.Segments.length).toBe(4);
      expect(player.MaxHp).toBe(player.HeadMaxHp + player.Segments.reduce((acc, s) => acc + s.MaxHp, 0));
      expect(player.Hp).toBe(player.HeadHp + player.Segments.reduce((acc, s) => acc + s.Hp, 0));
      expect(player.MaxHp).toBeLessThan(initialMaxHp);
    });
  });

  // ==========================================================================
  // PILLAR 5: CENTRIPETAL TAIL-WHIP COLLISIONS & PROJECTILE DEFLECTION
  // ==========================================================================
  describe('Pillar 5: Centripetal Tail-Whip Collisions & Projectile Deflection', () => {
    /**
     * Centripetal Tail-Whip Formulation (ORACLE.md §3.8):
     *   Tangential velocity: v_i = v_head + omega * (i * d_segment)
     *   Blunt multiplier: Damage_whip = BitePower * (1.0 + 0.85 * (v_i / v_head)^2)
     *   Knocks enemies back by 180px away from the segment.
     *   Light projectiles (< 45 damage, non-boss) deflected by trailing segments (i >= 2) during surge.
     */
    it('5.1 computes centripetal tangential speed: v_i = v_head + omega * (i * d_segment)', () => {
      const player = new SnakePlayer('emerald', ARENA_W, ARENA_H, 10);
      const v0 = player.BaseSpeed; // 195 px/s
      const omega = player.EffectiveTurnSpeed; // 9.5 rad/s
      const spacing = player.SegmentSpacing; // 15 px

      for (let i = 0; i < 10; i++) {
        const expectedV = v0 + omega * (i * spacing);
        expect(player.GetSegmentTangentialSpeed(i)).toBeCloseTo(expectedV, 5);
      }
    });

    it('5.2 evaluates quadratic kinetic damage multiplier: 1.0 + 0.85 * (v_i / v_head)^2', () => {
      const player = new SnakePlayer('emerald', ARENA_W, ARENA_H, 10);
      const v0 = player.BaseSpeed;

      for (let i = 0; i < 10; i++) {
        const vi = player.GetSegmentTangentialSpeed(i);
        const ratio = vi / v0;
        const expectedMult = 1.0 + 0.85 * (ratio * ratio);
        expect(player.GetTailWhipDamageMultiplier(i)).toBeCloseTo(expectedMult, 5);
      }
    });

    it('5.3 deals scaled kinetic damage and knocks enemies back by exactly 180px along radial vector', () => {
      const player = new SnakePlayer('emerald', ARENA_W, ARENA_H, 6);
      const segIndex = 4;
      const seg = player.Segments[segIndex]!;
      seg.X = 400;
      seg.Y = 400;

      // Enemy positioned at (430, 440) -> dx = 30, dy = 40, dist = 50px
      const enemy = new Enemy(430, 440, 'scarab', 1);
      const initialHp = enemy.Hp;
      const dealt = player.ResolveTailWhipCollision(segIndex, enemy);

      expect(dealt).toBeGreaterThan(0);
      expect(enemy.Hp).toBe(initialHp - dealt);

      // Radial unit vector: (30/50, 40/50) = (0.6, 0.8)
      // Knockback distance = 180px
      // New X = 430 + 0.6 * 180 = 430 + 108 = 538
      // New Y = 440 + 0.8 * 180 = 440 + 144 = 584
      expect(enemy.X).toBeCloseTo(538, 2);
      expect(enemy.Y).toBeCloseTo(584, 2);
    });

    it('5.4 deflects incoming light projectiles (< 45 damage) on trailing segments (s >= 2) during agility surge', () => {
      g.selectedClass = 'emerald';
      g.gameMode = 'rogue';
      g.startRun();

      const player = g.player;
      player.X = 500;
      player.Y = 500;
      // Setup 5 segments
      player.Segments = [];
      for (let i = 0; i < 5; i++) {
        player.Segments.push({
          X: 500 - (i + 1) * 15,
          Y: 500,
          Angle: 0,
          R: 11,
          Hp: 30,
          MaxHp: 30,
          HitFlash: 0,
          SelfHitCooldown: 0,
          BossHitCooldown: 0,
        } as any);
      }

      // Activate agility surge
      player.AgilitySurgeTimer = 3.0;

      // Populate spatial grid with player segments so collision query detects segment 3
      (g.combat as any)._segmentGrid.clear();
      for (let i = 0; i < player.Segments.length; i++) {
        const s = player.Segments[i]!;
        (g.combat as any)._segmentGrid.insert(0x02, i, s.X, s.Y, s.R);
      }

      // Spawn light projectile (damage = 20) right on segment 3 (X = 500 - 4*15 = 440, Y = 500)
      const targetSeg = player.Segments[3]!;
      const proj = new Projectile(targetSeg.X, targetSeg.Y, 0, 0, 20, 'enemy', '#ff0055', { Radius: 8 });
      g.projectiles.push(proj);

      const initialSegHp = targetSeg.Hp;

      // Update projectiles through CombatSystem
      g.combat.updateProjectiles(DT, g.worldBag());

      // Light projectile must be neutralized (dead = true)
      expect(proj.dead).toBe(true);
      // Trailing segment takes ZERO damage (deflected)
      expect(targetSeg.Hp).toBe(initialSegHp);
    });

    it('5.5 penetrates tail segments without deflection when projectile is heavy (damage >= 45) or from a boss', () => {
      g.selectedClass = 'emerald';
      g.gameMode = 'rogue';
      g.startRun();

      const player = g.player;
      player.X = 500;
      player.Y = 500;
      player.InvulnerableTimer = 0;
      player.Shield = 0;
      player.Segments = [];
      for (let i = 0; i < 6; i++) {
        player.Segments.push(new SnakeSegment(500 - (i + 1) * 35, 500, 0, 11, 50));
      }
      player.RecalculateHp();
      player.RecalculateMaxHp();
      player.AgilitySurgeTimer = 3.0;

      const targetSeg = player.Segments[3]!;
      // Heavy boss projectile (damage = 60, source = 'boss')
      const heavyProj = new Projectile({
        x: targetSeg.X,
        y: targetSeg.Y,
        damage: 60,
        source: 'boss',
        radius: 12,
        color: '#ff00ff',
      });
      g.projectiles.push(heavyProj);

      const initialSegHp = targetSeg.Hp;
      g.combat.updateProjectiles(DT, g.worldBag());

      // Heavy boss projectile must NOT be deflected; it inflicts damage
      expect(heavyProj.dead).toBe(true);
      expect(targetSeg.Hp).toBeLessThan(initialSegHp);
    });
  });

  // ==========================================================================
  // PILLAR 6: BOUNDARY COLLISIONS, DAMPING & ESCAPABILITY
  // ==========================================================================
  describe('Pillar 6: Boundary Collisions, Damping & Escapability', () => {
    /**
     * Boundary Collision Formulation:
     *   m = HeadRadius (14px)
     *   Clamping: X in [m, ARENA_W - m], Y in [m, ARENA_H - m]
     *   Sliding Tangent Projection: T = V - (V · N)N
     *   Head-On Orthogonal Tangent: T = (-ny, nx)
     *   Corner Nudge: X = m + 1.0, Y = m + 1.0; Deflect(nx * sqrt(0.5), ny * sqrt(0.5))
     *   Inward Steering Invariant: TargetAngle preserved when steering away from wall
     */
    it('6.1 clamps head position strictly within [m, ARENA_W - m] x [m, ARENA_H - m]', () => {
      const player = new SnakePlayer('emerald', ARENA_W, ARENA_H, 4);
      const m = player.HeadRadius; // 14px

      // Test Left boundary clamping
      player.X = -50;
      player.Y = 300;
      player.Angle = Math.PI; // Heading left
      player.Update(DT, { Active: false }, ARENA_W, ARENA_H, g.worldBag());
      expect(player.X).toBe(m);

      // Test Right boundary clamping
      player.X = ARENA_W + 100;
      player.Y = 300;
      player.Angle = 0; // Heading right
      player.Update(DT, { Active: false }, ARENA_W, ARENA_H, g.worldBag());
      expect(player.X).toBe(ARENA_W - m);

      // Test Top boundary clamping
      player.X = 400;
      player.Y = -30;
      player.Angle = -Math.PI / 2; // Heading up
      player.Update(DT, { Active: false }, ARENA_W, ARENA_H, g.worldBag());
      expect(player.Y).toBe(m);

      // Test Bottom boundary clamping
      player.X = 400;
      player.Y = ARENA_H + 50;
      player.Angle = Math.PI / 2; // Heading down
      player.Update(DT, { Active: false }, ARENA_W, ARENA_H, g.worldBag());
      expect(player.Y).toBe(ARENA_H - m);
    });

    it('6.2 projects sliding tangent heading on oblique wall impacts without oscillation', () => {
      const player = new SnakePlayer('emerald', ARENA_W, ARENA_H, 4);
      const m = player.HeadRadius;

      // Approach right wall obliquely: Angle = -pi/6 (-30 deg)
      // Wall normal pointing inward: N = (-1, 0)
      player.X = ARENA_W - m + 2;
      player.Y = 300;
      player.Angle = -Math.PI / 6;

      player.Deflect(-1, 0);

      // Tangent projection along right wall directs heading purely along Y axis: Angle = -pi/2 (-90 deg)
      expect(player.Angle).toBeCloseTo(-Math.PI / 2, 4);
    });

    it('6.3 executes perpendicular head-on deflection to orthogonal tangent avoiding deadlocks', () => {
      const player = new SnakePlayer('emerald', ARENA_W, ARENA_H, 4);
      const m = player.HeadRadius;

      // Approach top wall head-on: Angle = -pi/2 (-90 deg, pointing directly up)
      // Inward normal: N = (0, 1)
      player.X = 400;
      player.Y = m - 2;
      player.Angle = -Math.PI / 2;

      // Head-on impact: dot = (0)*0 + (-1)*1 = -1
      // Tangent vector = (-ny, nx) = (-1, 0) -> atan2(0, -1) = pi
      player.Deflect(0, 1);

      expect(Math.abs(player.Angle)).toBeCloseTo(Math.PI, 4);
      expect(Number.isFinite(player.Angle)).toBe(true);
    });

    it('6.4 applies separation nudging and composite diagonal deflection on simultaneous corner collisions', () => {
      const player = new SnakePlayer('emerald', ARENA_W, ARENA_H, 4);
      const m = player.HeadRadius;

      // Crash simultaneously into top-left corner: X < m, Y < m
      player.X = m - 5;
      player.Y = m - 5;
      player.Angle = - (3 * Math.PI) / 4; // Heading up-left

      player.Update(DT, { Active: false }, ARENA_W, ARENA_H, g.worldBag());

      // Inward separation nudging pushes head offset 1.0px inside boundary margin
      expect(player.X).toBe(m + 1.0);
      expect(player.Y).toBe(m + 1.0);

      // Deflected heading is orthogonal to inward diagonal normal (sliding tangentially along surface, avoiding deadlock)
      expect(Math.abs(Math.cos(player.Angle) * Math.SQRT1_2 + Math.sin(player.Angle) * Math.SQRT1_2)).toBeCloseTo(0, 4);
      expect(Math.abs(Math.sin(player.Angle))).toBeCloseTo(Math.SQRT1_2, 4);
    });

    it('6.5 strictly preserves inward TargetAngle when player steers away from boundary wall', () => {
      const player = new SnakePlayer('emerald', ARENA_W, ARENA_H, 4);
      const m = player.HeadRadius;

      // Player is against the left wall: inward normal N = (1, 0)
      player.X = m - 1;
      player.Y = 300;
      player.Angle = Math.PI; // Currently pointing at the wall

      // Player's steering is actively directing the serpent inward (TargetAngle = 0 rad, pointing right)
      player.TargetAngle = 0;

      // Inward steering dot: cos(0)*1 + sin(0)*0 = 1 >= 0
      player.Deflect(1, 0);

      // TargetAngle must be strictly preserved so the player can effortlessly turn away
      expect(player.TargetAngle).toBe(0);
    });
  });
});
