import { describe, it, expect, beforeEach } from 'vitest';
import { SnakePlayer } from '../sim/SnakePlayer';
import { Services } from '../core/Services';
import { NullFx, NullSound, ScriptedInput } from '../core/Contracts';
import { MetaProgression } from '../data/MetaProgression';

describe('Body Life Sourcing & Serpentine Defeat Suite', () => {
  beforeEach(() => {
    MetaProgression.readBackend = () => null;
    MetaProgression.writeBackend = () => {};
    MetaProgression.deleteBackend = () => {};
    MetaProgression.instance = new MetaProgression();

    Services.input = new ScriptedInput();
    Services.fx = new NullFx();
    Services.sound = new NullSound();
    Services.headless = true;
  });

  it('1.1 head damage sources life from the last body segment when segments exist', () => {
    const p = new SnakePlayer('emerald', 1280, 720, 3);
    const initialHeadHp = p.headHp;
    const initialSegCount = p.segments.length; // 3
    const lastSegInitialHp = p.segments[initialSegCount - 1]!.Hp; // e.g. 15

    // Damage head by 10 (less than last segment HP)
    p.damageHead(10, false, false);

    // Head HP must remain completely intact as body is the active source of life
    expect(p.headHp).toBe(initialHeadHp);
    // All 3 segments still exist
    expect(p.segments.length).toBe(3);
    // The last segment (posterior tail) absorbed the 10 damage
    expect(p.segments[2]!.Hp).toBe(lastSegInitialHp - 10);
    // Snake must be alive
    expect(p.alive).toBe(true);
  });

  it('1.2 cascading damage consumes multiple posterior segments from tail forward', () => {
    const p = new SnakePlayer('emerald', 1280, 720, 3);
    const initialHeadHp = p.headHp;
    const segHp = p.segments[0]!.Hp; // 15

    // Damage head by 25: exhausts segment 2 (15 HP) and deals 10 HP to segment 1
    p.damageHead(segHp + 10, false, false);

    // Head HP intact
    expect(p.headHp).toBe(initialHeadHp);
    // Segment 2 consumed, 2 segments remaining
    expect(p.segments.length).toBe(2);
    // Segment 1 absorbed remaining 10 damage
    expect(p.segments[1]!.Hp).toBe(segHp - 10);
    // Segment 0 untouched
    expect(p.segments[0]!.Hp).toBe(segHp);
    expect(p.alive).toBe(true);
  });

  it('1.3 snake remains alive when all body parts are severed if headHp > 0', () => {
    const p = new SnakePlayer('emerald', 1280, 720, 3);
    expect(p.headHp).toBeGreaterThan(0);

    // Sever all segments from index 0
    p.severFrom(0);

    // 0 segments remaining
    expect(p.segments.length).toBe(0);
    // Head HP still > 0
    expect(p.headHp).toBeGreaterThan(0);
    // The snake must NOT die because the head still has health!
    expect(p.alive).toBe(true);
  });

  it('1.4 damage applies to headHp only when no body segments remain', () => {
    const p = new SnakePlayer('emerald', 1280, 720, 0); // 0 segments
    expect(p.segments.length).toBe(0);
    const initialHeadHp = p.headHp;

    // Damage head by 20
    p.damageHead(20, false, false);

    expect(p.headHp).toBe(initialHeadHp - 20);
    expect(p.alive).toBe(true);
  });

  it('1.5 snake dies strictly when segments === 0 and headHp <= 0', () => {
    const p = new SnakePlayer('emerald', 1280, 720, 0); // 0 segments
    expect(p.segments.length).toBe(0);

    // Deal lethal damage to the lone head
    p.damageHead(p.headHp, false, false);

    expect(p.headHp).toBe(0);
    expect(p.segments.length).toBe(0);
    expect(p.alive).toBe(false);
  });

  it('1.6 TakeDamage also sources life from the last body segment', () => {
    const p = new SnakePlayer('emerald', 1280, 720, 3);
    const initialHeadHp = p.headHp;
    const segHp = p.segments[0]!.Hp;

    // TakeDamage deals 10 damage (subject to EffectiveArmor)
    const dealt = p.takeDamage(10);

    expect(p.headHp).toBe(initialHeadHp);
    expect(p.segments.length).toBe(3);
    expect(p.segments[2]!.Hp).toBe(segHp - dealt);
    expect(p.alive).toBe(true);
  });
});
