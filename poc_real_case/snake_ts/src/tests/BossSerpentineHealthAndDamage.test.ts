import { describe, it, expect, beforeEach } from 'vitest';
import { Boss } from '../sim/Boss';
import { GameEngine } from '../sim/GameEngine';
import { SnakePlayer } from '../sim/SnakePlayer';
import { Services } from '../core/Services';
import { NullFx, NullSound, ScriptedInput } from '../core/Contracts';
import { MetaProgression } from '../data/MetaProgression';

describe('Boss Serpentine Health & Multi-Segment Contact Damage Test Suite', () => {
  let g: GameEngine;

  beforeEach(() => {
    MetaProgression.readBackend = () => null;
    MetaProgression.writeBackend = () => {};
    MetaProgression.deleteBackend = () => {};
    MetaProgression.instance = new MetaProgression();

    Services.input = new ScriptedInput();
    Services.fx = new NullFx();
    Services.sound = new NullSound();
    Services.headless = true;

    g = new GameEngine();
    g.setupCanvas(1280, 720, 1);
  });

  it('1.1 boss initializes with head health and individual segment health pools whose sum equals boss MaxHp', () => {
    const boss = new Boss(1, 1280, 720); // Centipede boss
    expect(boss.segments.length).toBeGreaterThan(0);
    expect(boss.headMaxHp).toBeGreaterThan(0);
    expect(boss.headHp).toBe(boss.headMaxHp);

    let sumMax = boss.headMaxHp;
    let sumCur = boss.headHp;
    for (const seg of boss.segments) {
      expect(seg.hp).toBeGreaterThan(0);
      expect(seg.maxHp).toBeGreaterThan(0);
      sumMax += seg.maxHp;
      sumCur += seg.hp;
    }

    expect(boss.maxHp).toBe(sumMax);
    expect(boss.hp).toBe(sumCur);
    expect(boss.dead).toBe(false);
  });

  it('1.2 boss head damage sources life from the last body segment forward, consuming segments until depleted', () => {
    const boss = new Boss(1, 1280, 720);
    boss.entranceTimer = 0;
    const initialSegCount = boss.segments.length;
    const initialHeadHp = boss.headHp;
    const lastSeg = boss.segments[initialSegCount - 1]!;
    const lastSegHp = lastSeg.hp;

    // Deal damage less than last segment's HP
    const smallDmg = Math.floor(lastSegHp * 0.5);
    boss.applyDamage(smallDmg);

    // Head HP remains untouched; last segment absorbs damage
    expect(boss.headHp).toBe(initialHeadHp);
    expect(boss.segments.length).toBe(initialSegCount);
    expect(boss.segments[initialSegCount - 1]!.hp).toBe(lastSegHp - smallDmg);
    expect(boss.dead).toBe(false);

    // Deal damage exceeding the remaining HP of the last segment plus part of next
    const seg1Hp = boss.segments[initialSegCount - 2]!.hp;
    boss.applyDamage((lastSegHp - smallDmg) + 5);

    // Last segment consumed/popped, next segment absorbed 5 damage
    expect(boss.segments.length).toBe(initialSegCount - 1);
    expect(boss.segments[boss.segments.length - 1]!.hp).toBe(seg1Hp - 5);
    expect(boss.headHp).toBe(initialHeadHp);
    expect(boss.dead).toBe(false);
  });

  it('1.3 boss survives when all body segments are severed if headHp > 0 and only dies when segments.length === 0 && headHp <= 0', () => {
    const boss = new Boss(1, 1280, 720);
    boss.entranceTimer = 0;
    expect(boss.headHp).toBeGreaterThan(0);

    // Sever all segments
    boss.severFrom(0);

    expect(boss.segments.length).toBe(0);
    expect(boss.headHp).toBeGreaterThan(0);
    // Boss remains alive as lone head
    expect(boss.dead).toBe(false);

    // Deal lethal damage to lone head
    boss.applyDamage(boss.headHp);

    expect(boss.headHp).toBe(0);
    expect(boss.dead).toBe(true);
  });

  it('1.4 direct damage to a boss body segment severs that segment and all trailing segments', () => {
    const boss = new Boss(1, 1280, 720);
    boss.entranceTimer = 0;
    const initialCount = boss.segments.length;
    const targetIdx = 3;
    const targetSeg = boss.segments[targetIdx]!;

    // Damage segment directly with lethal damage
    boss.damageSegment(targetIdx, targetSeg.hp);

    // Segment 3 and all trailing segments severed
    expect(boss.segments.length).toBe(targetIdx);
    expect(boss.dead).toBe(false);
  });

  it('1.5 boss head touching multiple player body parts damages each touched player segment independently', () => {
    g.selectedClass = 'emerald';
    g.gameMode = 'rogue';
    g.startRun();

    const p = g.player;
    // Ensure player has multiple segments
    p.addGrowth(5);
    p.invulnerableTimer = 0;

    // Cluster player segments 1, 2, 3 in close proximity
    p.x = 200; p.y = 200;
    p.segments[0]!.x = 300; p.segments[0]!.y = 300;
    p.segments[1]!.x = 500; p.segments[1]!.y = 500;
    p.segments[2]!.x = 510; p.segments[2]!.y = 500;
    p.segments[3]!.x = 500; p.segments[3]!.y = 510;

    const seg1Hp = p.segments[1]!.hp;
    const seg2Hp = p.segments[2]!.hp;
    const seg3Hp = p.segments[3]!.hp;

    // Create boss with head placed directly in the center of segments 1, 2, 3
    const boss = new Boss(1, 1280, 720);
    boss.entranceTimer = 0;
    boss.x = 505;
    boss.y = 505;
    boss.radius = 30;
    g.boss = boss;

    g.combat.resolveBoss(0.016, g.worldBag());

    // ALL THREE touched player segments must have taken damage!
    expect(p.segments[1]!.hp).toBeLessThan(seg1Hp);
    expect(p.segments[2]!.hp).toBeLessThan(seg2Hp);
    expect(p.segments[3]!.hp).toBeLessThan(seg3Hp);
  });

  it('1.6 boss body parts touching multiple player body parts damages each touched player segment independently', () => {
    g.selectedClass = 'emerald';
    g.gameMode = 'rogue';
    g.startRun();

    const p = g.player;
    p.addGrowth(5);
    p.invulnerableTimer = 0;

    // Position player segments 1 and 2
    p.x = 100; p.y = 100;
    p.segments[0]!.x = 200; p.segments[0]!.y = 200;
    p.segments[1]!.x = 600; p.segments[1]!.y = 600;
    p.segments[2]!.x = 610; p.segments[2]!.y = 600;

    const seg1Hp = p.segments[1]!.hp;
    const seg2Hp = p.segments[2]!.hp;

    // Create boss whose head is far away at (900, 900) but whose segment 2 is right at (605, 600)
    const boss = new Boss(1, 1280, 720);
    boss.entranceTimer = 0;
    boss.x = 900;
    boss.y = 900;
    boss.segments[2]!.x = 605;
    boss.segments[2]!.y = 600;
    boss.segments[2]!.r = 25;
    g.boss = boss;

    g.combat.resolveBoss(0.016, g.worldBag());

    // Both touched player segments must have taken damage from the boss body part!
    expect(p.segments[1]!.hp).toBeLessThan(seg1Hp);
    expect(p.segments[2]!.hp).toBeLessThan(seg2Hp);
  });

  it('1.7 each touched player segment obeys its own independent bossHitCooldown', () => {
    const p = new SnakePlayer('emerald', 1280, 720, 3);
    const seg = p.segments[0]!;
    expect(seg.bossHitCooldown).toBe(0);

    seg.bossHitCooldown = 0.5;
    expect(seg.bossHitCooldown).toBe(0.5);

    p.updateSegments(0.1);
    expect(seg.bossHitCooldown).toBeCloseTo(0.4, 2);
  });
});
