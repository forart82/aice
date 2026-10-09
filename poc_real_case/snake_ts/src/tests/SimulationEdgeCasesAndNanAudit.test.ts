/**
 * Ouroboros Ascension — Simulation Edge Cases, Division-by-Zero, NaN & State Desynchronization Audit
 *
 * Test suite verifying defensive invariants against:
 * 1. Division by zero and NaN propagation in MathX and Vec2.
 * 2. SpatialHashGrid insertion and query edge cases with NaN or extreme out-of-bounds coordinates.
 * 3. SnakePlayer health cascade, segment array NaN index protections, and kinematic recovery.
 * 4. Boss multi-segment health cascade and NaN index protections.
 * 5. State desynchronization during rapid pause/unpause after death and floor clear during dash/autotomy.
 * 6. CombatSystem explosive / beam damage validation against NaN inputs.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { MathX } from '../core/MathX.js';
import { Vec2 } from '../core/Vec2.js';
import { SpatialHashGrid, SpatialLayerMask } from '../sim/SpatialHashGrid.js';
import { SnakePlayer } from '../sim/SnakePlayer.js';
import { Boss } from '../sim/Boss.js';
import { GameEngine } from '../sim/GameEngine.js';
import { GameState } from '../sim/GameState.js';
import { CombatSystem } from '../sim/CombatSystem.js';
import { World } from '../sim/World.js';

describe('Simulation Edge Cases, Division-by-Zero, NaN & State Desynchronization Audit', () => {
  describe('1. MathX and Vec2 Division-by-Zero & NaN Invariants', () => {
    it('1.1 MathX.clamp returns lo when value is NaN or non-finite', () => {
      expect(MathX.clamp(NaN, 0, 10)).toBe(0);
      expect(MathX.clamp(Infinity, 0, 10)).toBe(10);
      expect(MathX.clamp(-Infinity, 0, 10)).toBe(0);
      expect(MathX.clamp01(NaN)).toBe(0);
    });

    it('1.2 MathX.angleDelta and wrapAngle return 0 when angles are NaN or non-finite', () => {
      expect(MathX.angleDelta(NaN, 1.0)).toBe(0);
      expect(MathX.angleDelta(1.0, NaN)).toBe(0);
      expect(MathX.wrapAngle(NaN)).toBe(0);
      expect(MathX.wrapAngle(Infinity)).toBe(0);
    });

    it('1.3 MathX.safeLen handles NaN, Infinity, and zero cleanly', () => {
      expect(MathX.safeLen(0, 0)).toBe(1e-6);
      expect(MathX.safeLen(NaN, 0)).toBe(1e-6);
      expect(MathX.safeLen(Infinity, 0)).toBe(1e-6);
      expect(MathX.safeLen(3, 4)).toBeCloseTo(5, 5);
    });

    it('1.4 MathX.pointToSegmentDist handles degenerate zero-length segment and non-finite inputs', () => {
      // Degenerate segment: x1=10, y1=10, x2=10, y2=10
      expect(MathX.pointToSegmentDist(10, 15, 10, 10, 10, 10)).toBe(5);
      expect(Number.isFinite(MathX.pointToSegmentDist(NaN, 0, 0, 0, 10, 0))).toBe(true);
    });

    it('1.5 Vec2.normalized and withLength handle zero, NaN, and Infinity without NaN vector', () => {
      const zeroVec = new Vec2(0, 0);
      expect(zeroVec.normalized.x).toBe(0);
      expect(zeroVec.normalized.y).toBe(0);

      const nanVec = new Vec2(NaN, 5);
      expect(nanVec.normalized.x).toBe(0);
      expect(nanVec.normalized.y).toBe(0);

      const infVec = new Vec2(Infinity, 0);
      expect(infVec.normalized.x).toBe(0);
      expect(infVec.normalized.y).toBe(0);

      expect(zeroVec.withLength(10).x).toBe(0);
      expect(zeroVec.withLength(10).y).toBe(0);
      expect(new Vec2(3, 4).withLength(NaN).x).toBe(0);
    });

    it('1.6 Vec2.div safely returns (0, 0) for zero or NaN divisor', () => {
      const v = new Vec2(10, 20);
      expect(v.div(0).x).toBe(0);
      expect(v.div(0).y).toBe(0);
      expect(v.div(NaN).x).toBe(0);
    });

    it('1.7 Vec2 methods handle null or non-finite other vectors without exceptions', () => {
      const v = new Vec2(3, 4);
      expect(v.distanceTo(null as any)).toBe(0);
      expect(v.distanceSquaredTo(null as any)).toBe(0);
      expect(v.angleTo(null as any)).toBe(0);
      expect(v.dot(null as any)).toBe(0);
      expect(v.cross(null as any)).toBe(0);
    });
  });

  describe('2. SpatialHashGrid NaN & Boundary Invariants', () => {
    let grid: SpatialHashGrid;

    beforeEach(() => {
      grid = new SpatialHashGrid(48, 960, 640);
    });

    it('2.1 insertSegments with NaN coordinates does not corrupt spatial linked list', () => {
      const corruptSegs = [
        { x: 100, y: 100, radius: 10 },
        { x: NaN, y: NaN, radius: 10 },
        { x: 200, y: 200, radius: 10 },
      ];

      expect(() => grid.insertSegments(corruptSegs)).not.toThrow();
      expect(grid.getItemCount(0)).toBe(3);

      // Verify queries still work normally
      const hit = grid.findFirst(SpatialLayerMask.Segments, 100, 100, 15);
      expect(hit).toBe(0);
    });

    it('2.2 insert and query with extreme out-of-bounds coordinates do not throw or produce invalid indices', () => {
      expect(() => grid.insert(0, -99999, -99999, 0, 10)).not.toThrow();
      expect(() => grid.insert(0, 99999, 99999, 1, 10)).not.toThrow();

      expect(() => grid.queryRadius(-99999, -99999, 50, () => {})).not.toThrow();
      expect(() => grid.queryNearest(SpatialLayerMask.Segments, -99999, -99999, 50)).not.toThrow();
      expect(grid.queryNearest(SpatialLayerMask.Segments, -99999, -99999, 50)).toBeNull();
    });

    it('2.3 queryRay safely handles ray origin far outside arena or zero-length direction', () => {
      expect(grid.queryRay(SpatialLayerMask.Segments, 0, 0, 0, 0, 100, () => {})).toBe(false);
      expect(grid.queryRay(SpatialLayerMask.Segments, -50000, -50000, 1, 0, 100, () => {})).toBe(false);
    });
  });

  describe('3. SnakePlayer Health, Array Index & Kinematics Defenses', () => {
    let player: SnakePlayer;
    let world: World;

    beforeEach(() => {
      player = new SnakePlayer('emerald', 960, 640, 5);
      world = new World();
      world.player = player;
    });

    it('3.1 setting player.Hp = NaN or MaxHp = NaN does not corrupt health into NaN', () => {
      player.Hp = NaN;
      expect(Number.isFinite(player.Hp)).toBe(true);
      expect(player.Hp).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(player.HeadHp)).toBe(true);
      for (const seg of player.Segments) {
        expect(Number.isFinite(seg.Hp)).toBe(true);
      }

      player.MaxHp = NaN;
      expect(Number.isFinite(player.MaxHp)).toBe(true);
      expect(player.MaxHp).toBeGreaterThan(0);
    });

    it('3.2 DamageSegment(NaN) does not throw TypeError on undefined segment', () => {
      expect(() => player.DamageSegment(NaN, 20)).not.toThrow();
      expect(player.DamageSegment(NaN, 20)).toBe(0);
    });

    it('3.3 SeverFrom(NaN) does not sever entire snake', () => {
      const initLen = player.Segments.length;
      expect(() => player.SeverFrom(NaN)).not.toThrow();
      expect(player.Segments.length).toBe(initLen);
    });

    it('3.4 SwapSegments and ReorderSegment reject NaN without inserting undefined', () => {
      const initLen = player.Segments.length;
      player.SwapSegments(NaN, 0);
      player.SwapSegments(0, NaN);
      expect(player.Segments.length).toBe(initLen);
      expect(player.Segments[0]).toBeDefined();

      player.ReorderSegment(NaN, 0);
      expect(player.Segments.length).toBe(initLen);
      expect(player.Segments[0]).toBeDefined();
    });

    it('3.5 GetSegmentTangentialSpeed and ResolveTailWhipCollision handle NaN index gracefully', () => {
      expect(player.GetSegmentTangentialSpeed(NaN)).toBe(player.BaseSpeed);
      expect(player.ResolveTailWhipCollision(NaN, {})).toBe(0);
    });

    it('3.6 Deflect(nx, ny) with (0,0) or NaN does not corrupt heading to NaN', () => {
      const initialAngle = player.Angle;
      player.Deflect(0, 0);
      expect(Number.isFinite(player.Angle)).toBe(true);
      expect(player.Angle).toBe(initialAngle);

      player.Deflect(NaN, NaN);
      expect(Number.isFinite(player.Angle)).toBe(true);
      expect(player.Angle).toBe(initialAngle);
    });

    it('3.7 player.Update recovers safely if Angle, TargetAngle, or X/Y are set to NaN', () => {
      player.Angle = NaN;
      player.TargetAngle = NaN;
      player.X = NaN;
      player.Y = NaN;

      expect(() => player.Update(1 / 120, { Active: false }, 960, 640, world)).not.toThrow();
      expect(Number.isFinite(player.Angle)).toBe(true);
      expect(Number.isFinite(player.X)).toBe(true);
      expect(Number.isFinite(player.Y)).toBe(true);
      for (const seg of player.Segments) {
        expect(Number.isFinite(seg.X)).toBe(true);
        expect(Number.isFinite(seg.Y)).toBe(true);
      }
    });
  });

  describe('4. Boss Health & Segment NaN Invariants', () => {
    let boss: Boss;

    beforeEach(() => {
      boss = new Boss(1, 960, 640, 'centipede');
    });

    it('4.1 setting boss.Hp = NaN does not propagate NaN to HeadHp or segments', () => {
      boss.Hp = NaN;
      expect(Number.isFinite(boss.Hp)).toBe(true);
      expect(Number.isFinite(boss.HeadHp)).toBe(true);
      for (const seg of boss.Segments) {
        expect(Number.isFinite(seg.Hp)).toBe(true);
      }
    });

    it('4.2 boss.DamageSegment(NaN) does not throw TypeError on undefined segment', () => {
      expect(() => boss.DamageSegment(NaN, 25)).not.toThrow();
      expect(boss.DamageSegment(NaN, 25)).toBe(false);
    });

    it('4.3 boss.SeverFrom(NaN) does not sever all boss segments', () => {
      const initLen = boss.Segments.length;
      expect(() => boss.SeverFrom(NaN)).not.toThrow();
      expect(boss.Segments.length).toBe(initLen);
    });

    it('4.4 boss.UpdateSegments recovers safely if boss X/Y are non-finite', () => {
      boss.X = NaN;
      boss.Y = NaN;
      expect(() => boss.UpdateSegments(1 / 120)).not.toThrow();
      for (const seg of boss.Segments) {
        expect(Number.isFinite(seg.X)).toBe(true);
        expect(Number.isFinite(seg.Y)).toBe(true);
      }
    });
  });

  describe('5. State Desynchronization & Rapid Transitions', () => {
    let engine: GameEngine;

    beforeEach(() => {
      engine = new GameEngine({ headless: true });
      (engine as any).StartGame('emerald');
    });

    it('5.1 Resume() and TogglePause() do not revert to Playing when player is dead', () => {
      engine.Player.Alive = false;
      engine.Player.Hp = 0;
      engine.State = GameState.Paused;

      engine.Resume();
      expect(engine.State).not.toBe(GameState.Playing);

      engine.TogglePause();
      expect(engine.State).not.toBe(GameState.Playing);
    });

    it('5.2 CloseSnakeLab() does not revert engine to Playing if player died', () => {
      engine.Player.Alive = false;
      engine.State = GameState.Paused;

      engine.CloseSnakeLab();
      expect(engine.State).not.toBe(GameState.Playing);
    });

    it('5.3 AdvanceFloor() cleanly terminates any in-progress Dash and resets DashHitIds', () => {
      engine.Player.IsDashing = true;
      engine.Player.DashTimer = 0.25;
      engine.Player.DashHitIds.add(42);
      engine.Player.AgilitySurgeTimer = 3.5;

      engine.AdvanceFloor();

      expect(engine.Player.IsDashing).toBe(false);
      expect(engine.Player.DashTimer).toBe(0);
      expect(engine.Player.DashHitIds.size).toBe(0);
      expect(engine.Player.AgilitySurgeTimer).toBe(0);
    });
  });

  describe('6. CombatSystem Defensive Protection', () => {
    let combat: CombatSystem;
    let world: World;
    let player: SnakePlayer;

    beforeEach(() => {
      combat = new CombatSystem();
      world = new World();
      player = new SnakePlayer('emerald', 960, 640);
      world.player = player;
    });

    it('6.1 explodeAt with NaN damage or coordinates exits safely without creating invalid damage', () => {
      expect(() => combat.explodeAt(world, NaN, 100, 50, 100, '#ff0000')).not.toThrow();
      expect(() => combat.explodeAt(world, 100, 100, 50, NaN, '#ff0000')).not.toThrow();
      expect(() => combat.explodeAt(world, 100, 100, -10, 100, '#ff0000')).not.toThrow();
    });

    it('6.2 chainLightning with NaN damage or coordinates exits safely', () => {
      expect(() => combat.chainLightning(world, NaN, 100, 3, 50, 200)).not.toThrow();
      expect(() => combat.chainLightning(world, 100, 100, 3, NaN, 200)).not.toThrow();
    });
  });
});
