/**
 * Ouroboros Ascension — Simulation & Kinematics Architecture Refactoring Test Suite
 *
 * Validates structural maintainability, modular decoupling, strict type safety,
 * MathX & Vec2 extensions, World static accessors, and zero regressions.
 */

import { describe, it, expect } from 'vitest';
import { MathX } from '../core/MathX';
import { Vec2 } from '../core/Vec2';
import { World } from '../sim/World';
import { SnakePlayer, type ISteerInput } from '../sim/SnakePlayer';
import { Enemy } from '../sim/Enemy';
import { Boss, type ITelegraphAttack } from '../sim/Boss';
import { FoodItem } from '../sim/FoodItem';
import { CombatSystem, getActiveBosses } from '../sim/CombatSystem';
import { SpatialHashGrid, SpatialLayer, SpatialLayerMask } from '../sim/SpatialHashGrid';
import { GameEngine } from '../sim/GameEngine';

describe('Simulation & Kinematics Architecture Refactoring', () => {
  describe('1. MathX and Vec2 Computational Primitives', () => {
    it('computes squared distance and Euclidean distance accurately and safely', () => {
      expect(MathX.distSq(0, 0, 3, 4)).toBe(25);
      expect(MathX.DistSq(1, 2, 4, 6)).toBe(25);
      expect(MathX.dist(0, 0, 3, 4)).toBe(5);
      expect(MathX.Dist(1, 2, 4, 6)).toBe(5);

      // NaN safety
      expect(MathX.distSq(NaN, 0, 3, 4)).toBe(0);
      expect(MathX.dist(0, NaN, 3, 4)).toBe(0);
    });

    it('determines circle-circle overlap with exact radial boundaries', () => {
      // Overlapping: centers (0,0) and (4,0), radii 3 and 2 (sum 5 >= 4)
      expect(MathX.circleOverlap(0, 0, 3, 4, 0, 2)).toBe(true);
      expect(MathX.CircleOverlap(0, 0, 3, 4, 0, 2)).toBe(true);

      // Touching: centers (0,0) and (5,0), radii 3 and 2 (sum 5 == 5)
      expect(MathX.circleOverlap(0, 0, 3, 5, 0, 2)).toBe(true);

      // Separated: centers (0,0) and (6,0), radii 3 and 2 (sum 5 < 6)
      expect(MathX.circleOverlap(0, 0, 3, 6, 0, 2)).toBe(false);

      // Guarded against NaN or negative radii
      expect(MathX.circleOverlap(NaN, 0, 3, 4, 0, 2)).toBe(false);
      expect(MathX.circleOverlap(0, 0, -1, 0, 0, 2)).toBe(false);
    });

    it('decays timers monotonically to zero without negative drift', () => {
      expect(MathX.decayTimer(1.0, 0.25)).toBeCloseTo(0.75, 5);
      expect(MathX.DecayTimer(0.1, 0.25)).toBe(0);
      expect(MathX.decayTimer(0, 0.05)).toBe(0);
      expect(MathX.decayTimer(-1, 0.05)).toBe(0);
      expect(MathX.decayTimer(NaN, 0.05)).toBe(0);
    });

    it('clamps 2D coordinates within arena bounds and safe margins', () => {
      const pt1 = MathX.clampToBounds(-10, 50, 15, 960, 640);
      expect(pt1.x).toBe(15);
      expect(pt1.y).toBe(50);

      const pt2 = MathX.ClampToBounds(1000, 700, 20, 960, 640);
      expect(pt2.x).toBe(940);
      expect(pt2.y).toBe(620);

      const pt3 = MathX.clampToBounds(NaN, 100, 10, 960, 640);
      expect(pt3.x).toBe(10);
      expect(pt3.y).toBe(100);
    });

    it('Vec2 computes distance directly to coordinates without temporary vector allocation', () => {
      const v = new Vec2(10, 20);
      expect(v.distanceSquaredToCoords(13, 24)).toBe(25);
      expect(v.DistanceSquaredToCoords(13, 24)).toBe(25);
      expect(v.distanceToCoords(13, 24)).toBe(5);
      expect(v.DistanceToCoords(13, 24)).toBe(5);

      // NaN safety
      expect(v.distanceToCoords(NaN, 24)).toBe(0);
    });
  });

  describe('2. World Centralized Static Typed Accessors', () => {
    it('safely accesses entities and handles null / empty states', () => {
      const world = new World();
      const player = new SnakePlayer('emerald', 960, 640);
      world.Player = player;

      expect(World.getPlayer(world)).toBe(player);
      expect(World.getFoods(world)).toEqual([]);
      expect(World.getEnemies(world)).toEqual([]);
      expect(World.getProjectiles(world)).toEqual([]);
      expect(World.getHazards(world)).toEqual([]);
      expect(World.getBosses(world)).toEqual([]);

      const food = new FoodItem(100, 100, 'apple');
      world.Foods.push(food);
      expect(World.getFoods(world).length).toBe(1);
      expect(World.getFoods(world)[0]).toBe(food);

      const enemy = new Enemy(200, 200, 'crawler');
      world.Enemies.push(enemy);
      expect(World.getEnemies(world).length).toBe(1);

      const boss = new Boss(1, 960, 640, 'centipede', 500, 300);
      world.ActiveBosses.push(boss);
      expect(World.getBosses(world).length).toBe(1);
      expect(World.getBosses(world)[0]).toBe(boss);
    });
  });

  describe('3. SnakePlayer Kinematic and Architectural Contracts', () => {
    it('preserves ISteerInput deflection kinetics without type assertions', () => {
      const world = new World();
      const player = new SnakePlayer('emerald', 960, 640);
      world.Player = player;

      // Position player at left boundary to trigger deflection
      player.X = 5;
      player.Y = 320;
      player.Angle = Math.PI; // heading left into the wall

      // Update with ISteerInput
      const steer: ISteerInput = { X: -1, Y: 0, Active: true };
      player.update(0.016, steer, 960, 640, world);

      // Heading should deflect away from the wall
      expect(player.X).toBeGreaterThanOrEqual(14);
      expect(Number.isFinite(player.Angle)).toBe(true);
    });

    it('equips and accesses helmets strictly typed as HelmetDef | null', () => {
      const player = new SnakePlayer('emerald', 960, 640);
      expect(player.EquippedHelmet).toBeNull();
      expect(player.helmet).toBeNull();

      const testHelmet = {
        id: 'test_helmet',
        Id: 'test_helmet',
        name: 'Titan Helm',
        Name: 'Titan Helm',
        bossId: 'centipede',
        tier: 1,
        rarity: 'rare' as const,
        stats: {},
        perks: ['armor'],
        lore: 'A mighty helmet',
        activeCapacity: 'titan_gorging' as const,
      };

      player.helmet = testHelmet;
      expect(player.EquippedHelmet).toBe(testHelmet);
      expect(player.helmet).toBe(testHelmet);

      player.EquipHelmet(null);
      expect(player.helmet).toBeNull();
    });

    it('resolves centripetal tail whip collision with typed IDamageable targets', () => {
      const player = new SnakePlayer('emerald', 960, 640, 4);
      const enemy = new Enemy(player.Segments[2]!.X + 10, player.Segments[2]!.Y + 10, 'crawler');
      const initialHp = enemy.Hp;

      const dealt = player.ResolveTailWhipCollision(2, enemy);
      expect(dealt).toBeGreaterThan(0);
      expect(enemy.Hp).toBeLessThan(initialHp);
    });
  });

  describe('4. Boss and Telegraph Architectural Contracts', () => {
    it('manages typed ITelegraphAttack array on Boss instances', () => {
      const boss = new Boss(1, 960, 640, 'centipede', 500, 300);
      expect(boss.Telegraphs).toBeInstanceOf(Array);
      expect(boss.telegraphs).toBeInstanceOf(Array);

      const circleTelegraph: ITelegraphAttack = {
        type: 'circle',
        x: 500,
        y: 300,
        radius: 60,
        progress: 0.5,
        color: '#ff0055',
      };

      boss.telegraphs.push(circleTelegraph);
      expect(boss.Telegraphs.length).toBe(1);
      expect(boss.Telegraphs[0]!.type).toBe('circle');
    });
  });

  describe('5. SpatialHashGrid Overload Type Safety', () => {
    it('executes both 4-argument legacy and 5-argument multi-layer queryRadius without any casting', () => {
      const grid = new SpatialHashGrid(960, 640, 48);
      grid.insert(SpatialLayer.Segments, 100, 100, 0, 15);
      grid.insert(SpatialLayer.Enemies, 110, 100, 1, 12);

      // Legacy 4-arg signature
      let legacyCount = 0;
      grid.queryRadius(100, 100, 30, (segIdx) => {
        legacyCount++;
        expect(segIdx).toBe(0);
      });
      expect(legacyCount).toBe(1);

      // 5-arg multi-layer signature
      let multiCount = 0;
      grid.queryRadius(SpatialLayerMask.Enemies, 100, 100, 30, (id, layer, distSq) => {
        multiCount++;
        expect(id).toBe(1);
        expect(layer).toBe(SpatialLayer.Enemies);
        expect(distSq).toBeLessThanOrEqual(30 * 30);
      });
      expect(multiCount).toBe(1);
    });
  });

  describe('6. CombatSystem Engine & Modular Decoupling', () => {
    it('strongly types Engine reference to GameEngine and operates getActiveBosses cleanly', () => {
      const engine = new GameEngine(960, 640);
      const combat = engine.Combat;

      expect(combat.Engine).toBe(engine);
      expect(combat.engine).toBe(engine);

      const world = engine.World;
      const bosses = getActiveBosses(world);
      expect(Array.isArray(bosses)).toBe(true);
    });
  });
});
