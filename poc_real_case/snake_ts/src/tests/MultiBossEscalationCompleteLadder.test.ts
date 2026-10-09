import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GameEngine } from '../sim/GameEngine';
import { GameState } from '../sim/GameState';
import { ScriptedInput, NullFx, NullSound } from '../core/Contracts';
import { Services } from '../core/Services';
import { setupMockDom } from './MockDom';
import { SnakePlayer } from '../sim/SnakePlayer';

describe('Multi-Boss Escalation Ladder (Floors 21 to 65+, 2 to 6 Concurrent Bosses)', () => {
  let g: GameEngine;
  let teardownDom: () => void;

  beforeEach(() => {
    teardownDom = setupMockDom();
    g = new GameEngine();
    g.setupCanvas(1920, 1080, 1);
    g.player = new SnakePlayer('emerald', 1920, 1080, 5);
    g.state = GameState.Playing;
    Services.input = new ScriptedInput();
    Services.fx = new NullFx();
    Services.sound = new NullSound();
    Services.headless = true;
  });

  afterEach(() => {
    teardownDom();
  });

  const FLOOR_BOSS_MATRIX = [
    { floor: 25, expectedBosses: 2, label: 'Dual Boss' },
    { floor: 35, expectedBosses: 3, label: 'Tri Boss' },
    { floor: 45, expectedBosses: 4, label: 'Quad Boss' },
    { floor: 55, expectedBosses: 5, label: 'Penta Boss' },
    { floor: 65, expectedBosses: 6, label: 'Hexa Boss (Capped)' },
    { floor: 85, expectedBosses: 6, label: 'Floor 85+ (Capped at 6)' },
  ];

  for (const { floor, expectedBosses, label } of FLOOR_BOSS_MATRIX) {
    it(`spawns exactly ${expectedBosses} concurrent bosses on Floor ${floor} (${label}) with 0.75x HP scaling`, () => {
      g.currentFloor = floor;
      g.activeBosses = [];
      g.spawnBoss();

      expect(g.activeBosses.length).toBe(expectedBosses);
      expect(g.bosses.length).toBe(expectedBosses);
      expect(g.boss).toBe(g.activeBosses[0]);

      // Verify all bosses have distinct X coordinates and 0.75x scaling
      const xSet = new Set(g.activeBosses.map(b => b.x));
      expect(xSet.size).toBe(expectedBosses);
      for (const b of g.activeBosses) {
        expect(b.multiBossScale).toBe(0.75);
        expect(b.alive).toBe(true);
      }
    });
  }

  it('verifies dynamic weapon retargeting and out-of-order defeat sequence across 4 concurrent bosses', () => {
    g.currentFloor = 45;
    g.spawnBoss(['centipede', 'gorgon', 'chimera', 'hydra']);
    expect(g.activeBosses.length).toBe(4);

    const b0 = g.activeBosses[0]!;
    const b1 = g.activeBosses[1]!;
    const b2 = g.activeBosses[2]!;
    const b3 = g.activeBosses[3]!;

    // Eliminate Boss #2 first (out-of-order)
    b2.hp = 0;
    b2.dead = true;
    g.step(0.016);

    expect(g.activeBosses.length).toBe(3);
    expect(g.activeBosses).not.toContain(b2);
    expect(g.state).toBe(GameState.Playing); // Floor remains active!
    expect(g.combat.bossKills).toBe(1);

    // Eliminate remaining bosses in sequence
    b0.hp = 0; b0.dead = true;
    g.step(0.016);
    expect(g.activeBosses.length).toBe(2);
    expect(g.boss).toBe(b1); // Active boss falls back to b1

    b1.hp = 0; b1.dead = true;
    g.step(0.016);
    expect(g.activeBosses.length).toBe(1);
    expect([GameState.Playing, GameState.LevelUp]).toContain(g.state);

    g.maxFloors = 100;
    b3.hp = 0; b3.dead = true;
    g.step(0.016);

    expect(g.activeBosses.length).toBe(0);
    expect([GameState.FloorClear, GameState.Victory]).toContain(g.state);
    expect(g.combat.bossKills).toBe(4);
  });
});
