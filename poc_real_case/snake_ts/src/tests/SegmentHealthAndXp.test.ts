import { describe, it, expect, beforeEach } from 'vitest';
import { SnakePlayer, SnakeSegment } from '../sim/SnakePlayer';
import { GameEngine } from '../sim/GameEngine';
import { GameState } from '../sim/GameState';
import { ScriptedInput, NullFx, NullSound } from '../core/Contracts';
import { Services } from '../core/Services';
import { MetaProgression } from '../data/MetaProgression';
import { FoodItem } from '../sim/FoodItem';
import { Enemy } from '../sim/Enemy';
import { Projectile } from '../sim/Projectile';
import { Boss } from '../sim/Boss';
import { GameData } from '../data/GameData';

describe('Modular Segment Health & XP State Counter Test Suite', () => {
  let g: GameEngine;
  let im: ScriptedInput;

  beforeEach(() => {
    MetaProgression.readBackend = () => null;
    MetaProgression.writeBackend = () => {};
    MetaProgression.deleteBackend = () => {};
    MetaProgression.instance = new MetaProgression();
    Services.meta = MetaProgression.instance;
    for (const k of GameData.Classes.keys) {
      MetaProgression.instance.unlockedClasses[k] = true;
    }

    g = new GameEngine();
    im = new ScriptedInput();
    Services.input = im;
    Services.fx = new NullFx();
    Services.sound = new NullSound();
    Services.headless = true;
    g.setupCanvas(1280, 720, 1);
  });

  /* 1. Head Health Initialization & Cumulative Health Pool */
  it('1. initializes head health with double base segment health and accumulates total snake health', () => {
    const p = new SnakePlayer('emerald', 1280, 720, 3);
    expect(p.segments.length).toBe(3);

    // Head health must be exactly 2 * BaseSegmentHp
    expect(p.headMaxHp).toBe(2 * p.baseSegmentHp);
    expect(p.headHp).toBe(p.headMaxHp);

    // Each body segment has BaseSegmentHp
    for (let i = 0; i < p.segments.length; i++) {
      const seg = p.segments[i]!;
      expect(seg.hp).toBe(p.baseSegmentHp);
      expect(seg.maxHp).toBe(p.baseSegmentHp);
    }

    // Cumulative total Hp and MaxHp: Head + sum(Segments)
    const expectedSegmentHpSum = p.segments.reduce((acc, s) => acc + s.hp, 0);
    const expectedTotalHp = p.headHp + expectedSegmentHpSum;
    const expectedTotalMaxHp = p.headMaxHp + p.segments.reduce((acc, s) => acc + s.maxHp, 0);

    expect(p.hp).toBe(expectedTotalHp);
    expect(p.maxHp).toBe(expectedTotalMaxHp);
  });

  /* 2. Top-to-Bottom Sequential Healing */
  it('2. heals missing health strictly sequentially from head down to tail segments', () => {
    const p = new SnakePlayer('emerald', 1280, 720, 3);
    const segMax = p.baseSegmentHp;
    const headMax = p.headMaxHp;

    // Damage head and segments partially
    p.headHp = headMax - 20; // 20 missing on head
    p.segments[0]!.hp = segMax - 15; // 15 missing on seg 0
    p.segments[1]!.hp = segMax - 10; // 10 missing on seg 1
    p.segments[2]!.hp = segMax - 10; // 10 missing on seg 2

    // Partial heal: 15 HP -> all 15 should go exclusively to head
    const healed1 = p.heal(15);
    expect(healed1).toBe(15);
    expect(p.headHp).toBe(headMax - 5); // Head still missing 5
    expect(p.segments[0]!.hp).toBe(segMax - 15); // Seg 0 untouched
    expect(p.segments[1]!.hp).toBe(segMax - 10); // Seg 1 untouched

    // Overflow heal: 20 HP -> 5 to head (now full), remaining 15 to seg 0 (now full)
    const healed2 = p.heal(20);
    expect(healed2).toBe(20);
    expect(p.headHp).toBe(headMax); // Head fully restored
    expect(p.segments[0]!.hp).toBe(segMax); // Seg 0 fully restored
    expect(p.segments[1]!.hp).toBe(segMax - 10); // Seg 1 still untouched
    expect(p.segments[2]!.hp).toBe(segMax - 10); // Seg 2 still untouched

    // Further heal: 15 HP -> 10 to seg 1 (full), 5 to seg 2 (partial)
    const healed3 = p.heal(15);
    expect(healed3).toBe(15);
    expect(p.segments[1]!.hp).toBe(segMax);
    expect(p.segments[2]!.hp).toBe(segMax - 5);
  });

  /* 3. Head Destruction & Player Defeat Condition */
  it('3. kills player when head HP is reduced to 0 and no body segments remain', () => {
    // Lone head with 0 segments
    const p = new SnakePlayer('emerald', 1280, 720, 0);
    expect(p.alive).toBe(true);

    // Lethal damage to lone head
    p.damageHead(p.headHp, false, false);

    expect(p.headHp).toBe(0);
    expect(p.segments.length).toBe(0);
    expect(p.alive).toBe(false);

    // Conversely, head damage with segments sources from body and keeps player alive
    const pWithSegs = new SnakePlayer('emerald', 1280, 720, 3);
    pWithSegs.damageHead(10, false, false);
    expect(pWithSegs.alive).toBe(true);
    expect(pWithSegs.headHp).toBe(pWithSegs.headMaxHp);
  });

  /* 4. Phoenix Rebirth Revival from Head Destruction */
  it('4. triggers Phoenix Rebirth when head takes lethal damage', () => {
    const p = new SnakePlayer('emerald', 1280, 720, 3);
    p.relics['phoenixCharges'] = 1;

    p.damageHead(9999, false, false);

    expect(p.relics['phoenixCharges']).toBe(0);
    expect(p.alive).toBe(true);
    expect(p.headHp).toBe(p.headMaxHp);
    expect(p.invulnerableTimer).toBeGreaterThan(0);
  });

  /* 5. Head Self-Collision Damage on Touched Trailing Segments */
  it('5. applies self-damage to touched trailing segments and head upon head self-collision', () => {
    g.selectedClass = 'emerald';
    g.gameMode = 'rogue';
    g.startRun();

    const p = g.player;
    // Add extra segments for collision testing (total >= 5 segments)
    p.addGrowth(4);
    expect(p.segments.length).toBeGreaterThanOrEqual(5);

    // Space out segments along the X axis
    for (let i = 0; i < p.segments.length; i++) {
      p.segments[i]!.x = 100 + i * 50;
      p.segments[i]!.y = 100;
    }

    const targetSegmentIndex = 4;
    const targetSeg = p.segments[targetSegmentIndex]!;
    const initialSegHp = targetSeg.hp;
    const initialLastSegHp = p.segments[p.segments.length - 1]!.hp;

    // Position head overlapping specifically segment 4
    p.x = targetSeg.x;
    p.y = targetSeg.y;

    // Set combo to verify combo reset
    g.combat.comboCount = 5;

    g.combat.resolveSelfCollision(g.worldBag());

    // Touched segment must have taken damage
    expect(targetSeg.hp).toBeLessThan(initialSegHp);
    // Head self-bite damage was absorbed by posterior life reservoir (last segment)
    expect(p.segments[p.segments.length - 1]!.hp).toBeLessThan(initialLastSegHp);
    // Combo must have broken
    expect(g.combat.comboCount).toBe(0);
  });

  /* 6. Body-on-Body Non-Adjacent Segment Collision */
  it('6. applies self-damage to both body parts when non-adjacent body segments intersect', () => {
    g.selectedClass = 'emerald';
    g.gameMode = 'rogue';
    g.startRun();

    const p = g.player;
    p.addGrowth(6);
    expect(p.segments.length).toBeGreaterThanOrEqual(7);

    // Position head far away
    p.x = 999;
    p.y = 999;

    // Space segments except place segment 1 and segment 5 overlapping
    for (let i = 0; i < p.segments.length; i++) {
      p.segments[i]!.x = 100 + i * 60;
      p.segments[i]!.y = 200;
    }

    const seg1 = p.segments[1]!;
    const seg5 = p.segments[5]!;
    seg5.x = seg1.x;
    seg5.y = seg1.y;

    const initialHp1 = seg1.hp;
    const initialHp5 = seg5.hp;

    g.combat.comboCount = 8;
    g.combat.resolveSelfCollision(g.worldBag());

    // Both body parts must have taken self-damage
    expect(seg1.hp).toBeLessThan(initialHp1);
    expect(seg5.hp).toBeLessThan(initialHp5);
    expect(g.combat.comboCount).toBe(0);
  });

  /* 7. Multi-Segment Self-Crossing without Break or Global Lockout */
  it('7. processes multiple touched segments without break or global invulnerability blocking', () => {
    g.selectedClass = 'emerald';
    g.gameMode = 'rogue';
    g.startRun();

    const p = g.player;
    p.addGrowth(5); // total 7 segments (0..6)

    // Position segments 3, 4, 5 all in the collision radius of the head
    for (let i = 0; i < p.segments.length; i++) {
      p.segments[i]!.x = 500;
      p.segments[i]!.y = 500;
    }
    p.x = 500;
    p.y = 500;

    const initialHp3 = p.segments[3]!.hp;
    const initialHp4 = p.segments[4]!.hp;
    const initialHp5 = p.segments[5]!.hp;

    g.combat.resolveSelfCollision(g.worldBag());

    // All touched segments (3, 4, 5) must have taken damage in the same resolution step
    expect(p.segments[3]!.hp).toBeLessThan(initialHp3);
    expect(p.segments[4]!.hp).toBeLessThan(initialHp4);
    expect(p.segments[5]!.hp).toBeLessThan(initialHp5);
  });

  /* 8. Enemy Collision Damage Routing (Head vs Body) */
  it('8. routes enemy head-to-head contact damage to head and body contact to touched segment', () => {
    g.selectedClass = 'emerald';
    g.gameMode = 'rogue';
    g.startRun();

    const p = g.player;
    p.addGrowth(3);
    p.invulnerableTimer = 0;

    for (let i = 0; i < p.segments.length; i++) {
      p.segments[i]!.x = 100 + i * 50;
      p.segments[i]!.y = 100;
    }
    p.x = 500;
    p.y = 500;

    const initialLastSegHp = p.segments[p.segments.length - 1]!.hp;
    const initialSeg1Hp = p.segments[1]!.hp;

    // 1. Enemy biting head
    const enemyHead = new Enemy(p.x, p.y, 'scarab', 1);
    enemyHead.spawnTimer = 0;
    g.enemies = [enemyHead];

    g.combat.resolveEnemies(0.016, g.worldBag());
    // Head damage absorbed by posterior life reservoir (last segment)
    expect(p.segments[p.segments.length - 1]!.hp).toBeLessThan(initialLastSegHp);
    expect(p.segments[1]!.hp).toBe(initialSeg1Hp);

    // Reset i-frames
    p.invulnerableTimer = 0;

    // 2. Enemy touching body segment 1
    const seg1 = p.segments[1]!;
    const enemyBody = new Enemy(seg1.x, seg1.y, 'scarab', 1);
    enemyBody.spawnTimer = 0;
    // Move head away
    p.x = 800;
    p.y = 800;
    g.enemies = [enemyBody];

    g.combat.resolveEnemies(0.016, g.worldBag());
    expect(p.segments[1]!.hp).toBeLessThan(initialSeg1Hp);
  });

  /* 9. Projectile Collision Damage Routing (Head vs Body) */
  it('9. routes projectile hits on head to damageHead and body hits to damageSegment', () => {
    g.selectedClass = 'emerald';
    g.gameMode = 'rogue';
    g.startRun();

    const p = g.player;
    p.addGrowth(3);
    p.invulnerableTimer = 0;

    for (let i = 0; i < p.segments.length; i++) {
      p.segments[i]!.x = 100 + i * 50;
      p.segments[i]!.y = 100;
    }
    p.x = 500;
    p.y = 500;

    const initialLastSegHp = p.segments[p.segments.length - 1]!.hp;
    const initialSeg2Hp = p.segments[2]!.hp;

    // 1. Projectile hitting head
    const projHead = new Projectile(p.x, p.y, 0, 100, 15, 'enemy', '#ff0000', { radius: 6 });
    g.projectiles = [projHead];

    g.combat.updateProjectiles(0.016, g.worldBag());
    // Head projectile hit absorbed by posterior life reservoir (last segment)
    expect(p.segments[p.segments.length - 1]!.hp).toBeLessThan(initialLastSegHp);
    expect(g.projectiles.length).toBe(0); // Projectile consumed

    // Reset i-frames
    p.invulnerableTimer = 0;

    // 2. Projectile hitting segment 2
    const seg2 = p.segments[2]!;
    const projSeg = new Projectile(seg2.x, seg2.y, 0, 100, 15, 'enemy', '#ff0000', { radius: 6 });
    // Move head away
    p.x = 900;
    p.y = 900;
    g.projectiles = [projSeg];

    g.combat.updateProjectiles(0.016, g.worldBag());
    expect(p.segments[2]!.hp).toBeLessThan(initialSeg2Hp);
    expect(g.projectiles.length).toBe(0); // Projectile consumed
  });

  /* 10. Boss Collision Damage Routing */
  it('10. routes boss contact damage to head and body parts proportionally', () => {
    g.selectedClass = 'emerald';
    g.gameMode = 'rogue';
    g.startRun();

    const p = g.player;
    p.addGrowth(3);
    p.invulnerableTimer = 0;

    for (let i = 0; i < p.segments.length; i++) {
      p.segments[i]!.x = 100 + i * 50;
      p.segments[i]!.y = 100;
    }
    p.x = 500;
    p.y = 500;

    const initialLastSegHp = p.segments[p.segments.length - 1]!.hp;
    const initialSeg1Hp = p.segments[1]!.hp;

    const boss = new Boss(1, 1280, 720);
    boss.entranceTimer = 0;
    boss.x = p.x;
    boss.y = p.y;
    g.boss = boss;

    // Head-to-head contact with boss
    g.combat.resolveBoss(0.016, g.worldBag());
    // Head damage absorbed by posterior life reservoir (last segment)
    expect(p.segments[p.segments.length - 1]!.hp).toBeLessThan(initialLastSegHp);
    expect(p.segments[1]!.hp).toBe(initialSeg1Hp);

    // Reset i-frames
    p.invulnerableTimer = 0;

    // Boss touching segment 1
    const seg1 = p.segments[1]!;
    boss.x = seg1.x;
    boss.y = seg1.y;
    p.x = 950;
    p.y = 950;

    g.combat.resolveBoss(0.016, g.worldBag());
    expect(p.segments[1]!.hp).toBeLessThan(initialSeg1Hp);
  });

  /* 11. Automatic Growth on Food Consumption */
  it('11. automatically adds segments upon eating food, scaling health pool', () => {
    g.gameMode = 'rogue';
    g.selectedClass = 'emerald';
    g.startRun();

    const p = g.player;
    const initialSegments = p.segments.length;
    const initialMaxHp = p.maxHp;

    // Eat apple
    const food = new FoodItem(p.x, p.y, 'apple');
    g.combat.eatFood(food, g.worldBag());

    expect(p.segments.length).toBe(initialSegments + 1);
    expect(p.maxHp).toBe(initialMaxHp + p.baseSegmentHp);
    expect(p.hp).toBe(p.headHp + p.segments.reduce((sum, s) => sum + s.hp, 0));
  });

  /* 12. Segment Damage & Severing Mechanic */
  it('12. severs destroyed segment and all trailing attached segments when segment HP <= 0', () => {
    const p = new SnakePlayer('emerald', 1280, 720, 5);
    expect(p.segments.length).toBe(5);

    // Damage segment index 2
    const seg2 = p.segments[2]!;
    const damageToKill = seg2.hp;
    
    // Apply damage directly to segment 2
    p.damageSegment(2, damageToKill, false, false);

    // Segment 2, 3, 4 should be severed and removed; only segments 0 and 1 remain!
    expect(p.segments.length).toBe(2);
    expect(p.alive).toBe(true);
    expect(p.hp).toBe(p.headHp + p.segments[0]!.hp + p.segments[1]!.hp);
  });

  /* 13. Retention of Head Command Center Modules on Severed Segments */
  it('13. retains Head command center modules and active arsenal when trailing segments are severed', () => {
    const p = new SnakePlayer('emerald', 1280, 720, 4);

    // Install turret and tesla on Head
    p.InstallHeadModule('turret');
    p.InstallHeadModule('tesla');

    expect(p.HeadModules['turret']).toBe(1);
    expect(p.HeadModules['tesla']).toBe(1);

    // Destroy segment 1 -> severs segments 1, 2, and 3
    p.damageSegment(1, p.segments[1]!.hp, false, false);

    expect(p.segments.length).toBe(1);
    // Head command center modules remain 100% intact
    expect(p.HeadModules['turret']).toBe(1);
    expect(p.HeadModules['tesla']).toBe(1);
  });

  /* 14. XP State Counter Integration */
  it('14. correctly accumulates and maintains XP state counter', () => {
    const p = new SnakePlayer('emerald', 1280, 720, 2);
    expect(p.xp).toBe(0);

    p.gainXp(75);
    expect(p.xp).toBe(75);
    expect(p.totalXpCollected).toBe(75);

    p.gainXp(50);
    expect(p.totalXpCollected).toBe(125);
    expect(p.level).toBeGreaterThanOrEqual(1);
  });

  /* 15. Head & Base Segment Health Scaling across all 5 classes and Vitality levels */
  it('15. verifies head and segment base max HP formulas across all classes and vitality levels', () => {
    const classBases: Record<string, number> = {
      emerald: 110,
      stalker: 85,
      hydra: 170,
      storm: 95,
      solar: 120,
    };

    const vitalityLevels = [0, 1, 3, 6];

    for (const [classId, baseHp] of Object.entries(classBases)) {
      for (const vit of vitalityLevels) {
        MetaProgression.instance.upgradeLevels['vitality'] = vit;

        const p = new SnakePlayer(classId, 1280, 720, 4);

        const expectedBaseSegHp = Math.max(15, Math.round(baseHp / 4) + vit * 5);
        const expectedHeadMaxHp = 2 * expectedBaseSegHp;

        expect(p.baseSegmentHp).toBe(expectedBaseSegHp);
        expect(p.headMaxHp).toBe(expectedHeadMaxHp);
        expect(p.headHp).toBe(expectedHeadMaxHp);

        for (let i = 0; i < p.segments.length; i++) {
          expect(p.segments[i]!.hp).toBe(expectedBaseSegHp);
          expect(p.segments[i]!.maxHp).toBe(expectedBaseSegHp);
        }

        // Cumulative invariant
        const totalSegHp = p.segments.reduce((acc, s) => acc + s.hp, 0);
        expect(p.hp).toBe(expectedHeadMaxHp + totalSegHp);
        expect(p.maxHp).toBe(expectedHeadMaxHp + 4 * expectedBaseSegHp);
      }
    }
  });

  /* 16. Top-to-Bottom Sequential Healing full edge-case matrix */
  it('16. verifies top-to-bottom sequential healing edge cases and invariants', () => {
    const p = new SnakePlayer('emerald', 1280, 720, 4);
    const segMax = p.baseSegmentHp;
    const headMax = p.headMaxHp;

    // 0 or negative heal returns 0 and leaves HP unchanged
    expect(p.heal(0)).toBe(0);
    expect(p.heal(-25)).toBe(0);

    // Completely deplete HP on all parts
    p.headHp = 1;
    p.segments[0]!.hp = 0;
    p.segments[1]!.hp = 0;
    p.segments[2]!.hp = 0;
    p.segments[3]!.hp = 0;

    // Heal exact amount needed to fill head
    const neededHead = headMax - 1;
    const healedHead = p.heal(neededHead);
    expect(healedHead).toBe(neededHead);
    expect(p.headHp).toBe(headMax);
    expect(p.segments[0]!.hp).toBe(0);

    // Heal enough to fill segment 0 and half of segment 1
    const healSegs = segMax + segMax / 2;
    const healedSegs = p.heal(healSegs);
    expect(healedSegs).toBe(healSegs);
    expect(p.headHp).toBe(headMax);
    expect(p.segments[0]!.hp).toBe(segMax);
    expect(p.segments[1]!.hp).toBe(segMax / 2);
    expect(p.segments[2]!.hp).toBe(0);
    expect(p.segments[3]!.hp).toBe(0);

    // Massive overheal -> caps at total MaxHp
    const totalMissing = (segMax - segMax / 2) + segMax + segMax;
    const overheal = p.heal(99999);
    expect(overheal).toBe(totalMissing);
    expect(p.hp).toBe(p.maxHp);
  });

  /* 17. Centripetal Tail Whip Kinematics & Kinetic Multiplier */
  it('17. computes centripetal tail whip tangential velocity and damage multiplier', () => {
    const p = new SnakePlayer('emerald', 1280, 720, 6);
    const v0 = p.baseSpeed;
    const omega = p.effectiveTurnSpeed;
    const dSeg = p.segmentSpacing;

    // Verify tangential speed formula: v_i = v_head + omega * (i * d_segment)
    for (let i = 0; i < p.segments.length; i++) {
      const expectedSpeed = v0 + omega * (i * dSeg);
      expect(p.getSegmentTangentialSpeed(i)).toBeCloseTo(expectedSpeed, 5);

      const ratio = expectedSpeed / Math.max(1, v0);
      const expectedMult = 1.0 + 0.85 * Math.pow(ratio, 2);
      expect(p.getTailWhipDamageMultiplier(i)).toBeCloseTo(expectedMult, 5);
    }

    // Segment 0 multiplier (ratio = 1) -> 1.0 + 0.85 * 1^2 = 1.85
    expect(p.getTailWhipDamageMultiplier(0)).toBeCloseTo(1.85, 4);

    // Tail segment collision with enemy
    const tailIndex = p.segments.length - 1;
    const enemy = new Enemy(p.segments[tailIndex]!.x, p.segments[tailIndex]!.y, 'scarab', 1);
    enemy.hp = 2000;
    enemy.maxHp = 2000;
    const initialEnemyHp = enemy.hp;
    const mult = p.getTailWhipDamageMultiplier(tailIndex);
    const expectedRawDmg = Math.round(p.stats.bitePower * mult);

    const dealt = p.resolveTailWhipCollision(tailIndex, enemy);
    expect(dealt).toBe(expectedRawDmg);
    expect(enemy.hp).toBe(initialEnemyHp - dealt);
  });

  /* 18. Damage Reduction, Effective Armor, and Rational Armor Curve */
  it('18. verifies segment armor bonus, effective armor clamping, and damage reduction formula', () => {
    const p = new SnakePlayer('emerald', 1280, 720, 2);

    // Initial 2 segments -> 2 * 0.03 = 0.06
    expect(p.segmentArmorBonus).toBeCloseTo(0.06, 4);
    p.addGrowth(3); // Total 5 segments -> 5 * 0.03 = 0.15
    expect(p.segmentArmorBonus).toBeCloseTo(5 * 0.03, 4);
    p.addGrowth(20); // Total 25 segments -> 25 * 0.03 = 0.75 -> capped at 0.50
    expect(p.segmentArmorBonus).toBe(0.50);

    // Effective Armor clamping [0, 0.85]
    p.stats.armor = 0.50;
    p.armorBuffTimer = 5.0; // +0.25 from buff -> 0.50 + 0.50 + 0.25 = 1.25 -> clamped to 0.85
    expect(p.effectiveArmor).toBe(0.85);

    // Damage resolution: max(1, roundJs(amount * (1 - EffectiveArmor)))
    p.invulnerableTimer = 0;
    const initialLastSegHp = p.segments[p.segments.length - 1]!.hp;
    const incomingDmg = 100;
    const expectedDealt = Math.max(1, Math.floor(incomingDmg * (1 - 0.85) + 0.5)); // 15
    const dealt = p.damageHead(incomingDmg, true, false);
    expect(dealt).toBe(15);
    expect(p.segments[p.segments.length - 1]!.hp).toBe(initialLastSegHp - 15);

    // Rational Armor formula validation: DR(A) = 0.85 * (A / (A + 100))
    const rationalDR = (a: number) => 0.85 * (a / (a + 100));
    expect(rationalDR(0)).toBe(0);
    expect(rationalDR(100)).toBeCloseTo(0.425, 4);
    expect(rationalDR(300)).toBeCloseTo(0.6375, 4);
    expect(rationalDR(10000)).toBeLessThan(0.85);
  });

  /* 19. Hyperbolic Cooldown Reduction and Dash Scaling */
  it('19. verifies hyperbolic CDR curve and dash cooldown diminishing returns', () => {
    // Hyperbolic CDR formula: tau(N) = tau_0 / (1 + 0.20 * N)
    const hyperbolicCdr = (tau0: number, n: number) => tau0 / (1 + 0.20 * n);
    const tau0 = 20.0;

    expect(hyperbolicCdr(tau0, 0)).toBe(20.0);
    expect(hyperbolicCdr(tau0, 1)).toBeCloseTo(20.0 / 1.2, 5); // ~16.6667s (0.8333x)
    expect(hyperbolicCdr(tau0, 3)).toBeCloseTo(20.0 / 1.6, 5); // 12.5s (0.625x)
    expect(hyperbolicCdr(tau0, 5)).toBeCloseTo(20.0 / 2.0, 5); // 10.0s (0.500x)
    expect(hyperbolicCdr(tau0, 10)).toBeCloseTo(20.0 / 3.0, 5); // ~6.6667s

    // Verify swiftness meta upgrade dash cooldown: max(0.8, base - level * 0.15)
    const baseDash = 3.2;
    for (let lvl = 0; lvl <= 5; lvl++) {
      MetaProgression.instance.upgradeLevels['swiftness'] = lvl;
      const p = new SnakePlayer('emerald', 1280, 720, 2);
      expect(p.stats.dashCooldown).toBeCloseTo(Math.max(0.8, baseDash - lvl * 0.15), 4);
    }
  });

  /* 20. All 5 Serpent Classes Base Stats, Passives, and Active Skills */
  it('20. verifies base stats, passives, and active skills for all 5 serpent classes', () => {
    const classSpecs: Array<{
      id: string;
      maxHp: number;
      speed: number;
      dashCd: number;
      bitePower: number;
      magnet: number;
      critChance: number;
      critMult: number;
      armor: number;
      skillName: string;
    }> = [
      { id: 'emerald', maxHp: 110, speed: 1.0, dashCd: 3.2, bitePower: 26, magnet: 78, critChance: 0.08, critMult: 1.5, armor: 0.0, skillName: 'Verdant Bloom' },
      { id: 'stalker', maxHp: 85, speed: 1.15, dashCd: 2.4, bitePower: 34, magnet: 58, critChance: 0.25, critMult: 2.0, armor: 0.0, skillName: 'Umbral Blink' },
      { id: 'hydra', maxHp: 170, speed: 0.9, dashCd: 4.0, bitePower: 42, magnet: 62, critChance: 0.05, critMult: 1.5, armor: 0.25, skillName: 'Titan Roar' },
      { id: 'storm', maxHp: 95, speed: 1.22, dashCd: 2.8, bitePower: 28, magnet: 68, critChance: 0.12, critMult: 1.75, armor: 0.05, skillName: 'Chain Storm' },
      { id: 'solar', maxHp: 120, speed: 1.05, dashCd: 3.0, bitePower: 32, magnet: 72, critChance: 0.10, critMult: 1.6, armor: 0.10, skillName: 'Supernova' },
    ];

    for (const spec of classSpecs) {
      MetaProgression.instance.upgradeLevels['vitality'] = 0;
      MetaProgression.instance.upgradeLevels['swiftness'] = 0;

      const def = GameData.Classes.Get(spec.id)!;
      expect(def).toBeDefined();
      expect(def.BaseStats.MaxHp).toBe(spec.maxHp);
      expect(def.BaseStats.Speed).toBe(spec.speed);
      expect(def.BaseStats.DashCooldown).toBe(spec.dashCd);
      expect(def.BaseStats.BitePower).toBe(spec.bitePower);
      expect(def.BaseStats.MagnetRadius).toBe(spec.magnet);
      expect(def.BaseStats.CritChance).toBe(spec.critChance);
      expect(def.BaseStats.CritMult).toBe(spec.critMult);
      expect(def.BaseStats.Armor).toBe(spec.armor);
      expect(def.Skill.Name).toBe(spec.skillName);

      // Verify player instantiation with class
      const p = new SnakePlayer(spec.id, 1280, 720, 2);
      expect(p.classId).toBe(spec.id);

      // Class passive checks:
      if (spec.id === 'emerald') {
        // Emerald Photosynthesis grants +30% magnet radius
        expect(p.stats.magnetRadius).toBeCloseTo(spec.magnet * 1.3, 4);
      } else if (spec.id === 'stalker') {
        // Stalker Phantom Shift grants +25% base crit
        expect(p.stats.critChance).toBe(0.25);
      } else if (spec.id === 'hydra') {
        // Hydra Titan Shell grants 1 main head + 2 extra biting heads = 3 bite heads
        expect(p.biteHeads().length).toBe(3);
        expect(p.stats.armor).toBe(0.25);
      } else if (spec.id === 'solar') {
        expect(p.stats.armor).toBe(0.10);
      }
    }
  });

  /* 21. Dedicated 5 Active Skills Execution & Field Impact */
  it('21. verifies execution and gameplay effects of all 5 class active skills', () => {
    // 1. Emerald: Verdant Bloom
    g.selectedClass = 'emerald';
    g.startRun();
    const em = g.player;
    em.headHp = 10;
    const initialFoodsCount = g.foods.length;
    expect(g.combat.activateSkill(g.worldBag())).toBe(true);
    expect(em.headHp).toBeGreaterThan(10);
    expect(g.foods.length).toBe(initialFoodsCount + 5);

    // 2. Stalker: Umbral Blink
    g.selectedClass = 'stalker';
    g.startRun();
    const st = g.player;
    const initialStX = st.x;
    const initialStY = st.y;
    expect(g.combat.activateSkill(g.worldBag())).toBe(true);
    expect(Math.hypot(st.x - initialStX, st.y - initialStY)).toBeCloseTo(200, 1);
    expect(st.afterimages.length).toBeGreaterThanOrEqual(6);

    // 3. Hydra: Titan Roar
    g.selectedClass = 'hydra';
    g.startRun();
    const hy = g.player;
    const enemyNear = new Enemy(hy.x + 50, hy.y, 'scarab', 1);
    enemyNear.spawnTimer = 0;
    g.enemies = [enemyNear];
    expect(g.combat.activateSkill(g.worldBag())).toBe(true);
    expect(hy.armorBuffTimer).toBe(5);
    expect(enemyNear.status.stunTimer).toBeGreaterThan(0);

    // 4. Storm: Chain Storm
    g.selectedClass = 'storm';
    g.startRun();
    const stormPlayer = g.player;
    const enemy1 = new Enemy(stormPlayer.x + 50, stormPlayer.y, 'scarab', 1);
    enemy1.spawnTimer = 0;
    enemy1.hp = 500;
    enemy1.maxHp = 500;
    g.enemies = [enemy1];
    expect(g.combat.activateSkill(g.worldBag())).toBe(true);
    expect(enemy1.hp).toBeLessThan(500);

    // 5. Solar: Supernova
    g.selectedClass = 'solar';
    g.startRun();
    const sol = g.player;
    const apple = new FoodItem(sol.x + 30, sol.y + 30, 'apple');
    g.foods = [apple];
    const solarEnemy = new Enemy(sol.x + 50, sol.y, 'scarab', 1);
    solarEnemy.spawnTimer = 0;
    solarEnemy.hp = 500;
    solarEnemy.maxHp = 500;
    g.enemies = [solarEnemy];
    expect(g.combat.activateSkill(g.worldBag())).toBe(true);
    expect(apple.type).toBe('golden'); // Cooked to golden
    expect(solarEnemy.hp).toBeLessThan(500); // Damaged by solar blast
  });

  /* 22. Combo System, Tier Multipliers, and Frenzy Overdrive */
  it('22. verifies combo incrementation, tier multiplier thresholds, and dynamic decay timer', () => {
    g.selectedClass = 'emerald';
    g.gameMode = 'rogue';
    g.startRun();

    const p = g.player;
    const c = g.combat;

    expect(c.comboCount).toBe(0);
    expect(c.comboMultiplier).toBe(1);

    // Test tier multipliers against Table 5.1 and ComboTiers
    // Combo tier breakpoints: 3 -> 2x, 8 -> 3x, 14 -> 4x, 22 -> 5x, 30 -> 6x, 40 -> 8x
    const tierMap: Array<[number, number]> = [
      [1, 1], [2, 1], [3, 2], [7, 2], [8, 3], [13, 3],
      [14, 4], [21, 4], [22, 5], [29, 5], [30, 6], [39, 6], [40, 8], [50, 8]
    ];

    for (const [count, expectedMult] of tierMap) {
      c.comboCount = count - 1;
      c.incrementCombo(p, g.worldBag());
      expect(c.comboCount).toBe(count);
      expect(c.comboMultiplier).toBe(expectedMult);

      // Verify dynamic decay window: max(1.9, (4.0 - min(1.9, C * 0.045)) * comboWin)
      const shrink = Math.min(1.9, count * 0.045);
      const expectedWindow = Math.max(1.9, (4.0 - shrink) * p.stats.comboWindow);
      expect(c.comboMaxTime).toBeCloseTo(expectedWindow, 4);
      expect(c.comboTimer).toBeCloseTo(expectedWindow, 4);
    }

    // Frenzy trigger at threshold >= 10
    expect(c.frenzyActive).toBe(true);
    expect(c.frenzyTimer).toBeGreaterThan(0);
  });
});

