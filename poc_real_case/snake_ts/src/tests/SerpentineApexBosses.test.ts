import { describe, it, expect, beforeEach } from 'vitest';
import { Boss } from '../sim/Boss';
import { GameEngine } from '../sim/GameEngine';
import { ScriptedInput, NullFx, NullSound } from '../core/Contracts';
import { Services } from '../core/Services';
import { MetaProgression } from '../data/MetaProgression';
import { Vec2 } from '../core/Vec2';

describe('All 8 Serpentine Apex Boss Guardians Test Suite', () => {
  let g: GameEngine;
  let im: ScriptedInput;

  beforeEach(() => {
    MetaProgression.readBackend = () => null;
    MetaProgression.writeBackend = () => {};
    MetaProgression.deleteBackend = () => {};
    MetaProgression.instance = new MetaProgression();

    g = new GameEngine();
    im = new ScriptedInput();
    Services.input = im;
    Services.fx = new NullFx();
    Services.sound = new NullSound();
    Services.headless = true;
    g.setupCanvas(1280, 720, 1);
  });

  it('1. verifies all 8 bosses instantiate with serpentine body segments and non-empty parts()', () => {
    const expectedBosses = [
      { type: 'centipede', minSegments: 12 },
      { type: 'gorgon', minSegments: 10 },
      { type: 'colossus', minSegments: 8 },
      { type: 'frostwyrm', minSegments: 12 },
      { type: 'chronowyrm', minSegments: 12 },
      { type: 'hivemind', minSegments: 14 },
      { type: 'superconductor_boss', minSegments: 10 },
      { type: 'leviathan', minSegments: 16 },
    ];

    for (let f = 1; f <= 8; f++) {
      const boss = new Boss(f, 1280, 720);
      const exp = expectedBosses[f - 1]!;
      expect(boss.type).toBe(exp.type);
      expect(boss.segments.length).toBeGreaterThanOrEqual(exp.minSegments);
      expect(boss.parts().length).toBe(boss.segments.length);

      // Verify each segment has valid initial position, angle, and radius
      for (const seg of boss.segments) {
        expect(Number.isFinite(seg.x ?? (seg as any).X)).toBe(true);
        expect(Number.isFinite(seg.y ?? (seg as any).Y)).toBe(true);
        expect((seg.r ?? (seg as any).R)).toBeGreaterThan(5);
      }
    }
  });

  it('2. updates serpentine vertebral kinematics for all 8 bosses during movement', () => {
    g.selectedClass = 'emerald';
    g.startRun();

    for (let f = 1; f <= 8; f++) {
      const boss = new Boss(f, 1280, 720);
      boss.entranceTimer = 0;
      boss.moveTimer = 0;
      g.boss = boss;

      const initialSegPos = boss.segments.map(s => ({ x: s.x ?? (s as any).X, y: s.y ?? (s as any).Y }));

      // Move player away to force boss locomotion
      g.player.x = 100;
      g.player.y = 100;
      boss.wanderTarget = new Vec2(100, 100);
      (boss as any).WanderTarget = new Vec2(100, 100);
      boss.moveTimer = 999;

      // Update 960 ticks (8.0s simulation to propagate serpentine follow wave through full spine even for slow colossal bosses)
      for (let t = 0; t < 960; t++) {
        boss.update(1 / 120, g.player, g.worldBag());
      }

      // Verify segments have dynamically followed the head trajectory
      let movedSegments = 0;
      for (let i = 0; i < boss.segments.length; i++) {
        const seg = boss.segments[i]!;
        const init = initialSegPos[i]!;
        const curX = seg.x ?? (seg as any).X;
        const curY = seg.y ?? (seg as any).Y;
        const distMoved = Math.hypot(curX - init.x, curY - init.y);
        if (distMoved > 0.5) movedSegments++;
      }
      expect(movedSegments).toBeGreaterThanOrEqual(Math.floor(boss.segments.length * 0.7));
    }
  });

  it('3. triggers enhanced combat attack mechanics, volleys, and telegraphs in Phase 1 & 2', () => {
    g.selectedClass = 'emerald';
    g.startRun();

    for (let f = 1; f <= 8; f++) {
      const boss = new Boss(f, 1280, 720);
      boss.entranceTimer = 0;
      g.boss = boss;
      g.projectiles.length = 0;
      g.hazards.length = 0;

      // Phase 2 escalation
      boss.applyDamage(boss.maxHp * 0.55);
      expect(boss.phase).toBe(2);
      boss.attackTimer = 0;

      // Simulate 120 ticks
      for (let t = 0; t < 120; t++) {
        boss.update(1 / 120, g.player, g.worldBag());
      }

      // Verify attacks were generated
      const totalAttacks = g.projectiles.length + g.hazards.length;
      expect(totalAttacks).toBeGreaterThan(0);
    }
  });
});
