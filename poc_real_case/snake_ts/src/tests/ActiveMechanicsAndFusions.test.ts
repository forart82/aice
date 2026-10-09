import { describe, it, expect, beforeEach } from 'vitest';
import { SnakePlayer } from '../sim/SnakePlayer';
import { GameEngine } from '../sim/GameEngine';
import { ScriptedInput, NullFx, NullSound } from '../core/Contracts';
import { Services } from '../core/Services';
import { MetaProgression } from '../data/MetaProgression';
import { Enemy } from '../sim/Enemy';
import { FoodItem } from '../sim/FoodItem';
import { GameData } from '../data/GameData';

describe('Active Combat Mechanics & 28 Alchemical Fusions Test Suite', () => {
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

  /* 1. Tactical Autotomy (Voluntary Tail Jettison) */
  it('1. triggers tactical autotomy, shedding rear segments with ablative shockwave and agility surge', () => {
    const p = new SnakePlayer('emerald', 1280, 720, 6);
    expect(p.segments.length).toBe(6);

    const initialHp = p.hp;
    const severed = p.autotomy();

    expect(severed).toBeGreaterThan(0);
    // Should have jettisoned rear segments: from index 3 to 5 (3 segments retained: 0, 1, 2)
    expect(p.segments.length).toBe(3);
    expect(p.hp).toBeLessThan(initialHp);
    expect(p.invulnerableTimer).toBeGreaterThanOrEqual(1.0);
    expect(p.agilitySurgeTimer).toBeGreaterThan(0);
    expect(p.effectiveTurnSpeed).toBeGreaterThan(p.turnSpeed);
  });

  /* 1b. Tactical Autotomy Shockwave via World context */
  it('1b. executes autotomy shockwave explosion through World context dealing damage to nearby enemies', () => {
    g.selectedClass = 'emerald';
    g.gameMode = 'rogue';
    g.startRun();
    const p = g.player;
    while (p.segments.length < 6) p.addBodySegment();
    const cutIndex = Math.max(1, Math.floor(p.segments.length / 2));
    const cutSeg = p.segments[cutIndex]!;
    const nearbyEnemy = new Enemy(cutSeg.x + 10, cutSeg.y + 10, 'scarab', 1);
    nearbyEnemy.spawnTimer = 0;
    g.enemies.push(nearbyEnemy);
    const prevEnemyHp = nearbyEnemy.hp;

    p.autotomy(g.worldBag());

    expect(nearbyEnemy.hp).toBeLessThan(prevEnemyHp);
  });

  /* 2. Centripetal Tail-Whip Collisions */
  it('2. calculates centripetal tail-whip velocity and applies kinetic blunt damage multiplier', () => {
    const p = new SnakePlayer('emerald', 1280, 720, 8);
    p.turnSpeed = 4.0; // rad/s
    p.angle = Math.PI / 2;

    const tailIndex = 7;
    const whipVel = p.getSegmentTangentialSpeed(tailIndex);
    expect(whipVel).toBeGreaterThan(p.baseSpeed);

    const mult = p.getTailWhipDamageMultiplier(tailIndex);
    expect(mult).toBeGreaterThan(1.0);

    const enemy = new Enemy(p.segments[tailIndex]!.x, p.segments[tailIndex]!.y, 'scarab', 1);
    const initialHp = enemy.hp;

    const damageDealt = p.resolveTailWhipCollision(tailIndex, enemy);
    expect(damageDealt).toBeGreaterThan(0);
    expect(enemy.hp).toBeLessThan(initialHp);
  });

  /* 2b. Centripetal Tail-Whip 180px knockback */
  it('2b. knocks enemy back 180px on centripetal tail-whip collision', () => {
    const p = new SnakePlayer('emerald', 1280, 720, 8);
    p.turnSpeed = 4.0;
    const tailIndex = 7;
    const enemy = new Enemy(p.segments[tailIndex]!.x + 10, p.segments[tailIndex]!.y, 'scarab', 1);
    const startX = enemy.x;
    const startY = enemy.y;
    p.resolveTailWhipCollision(tailIndex, enemy);
    const distKnocked = Math.hypot(enemy.x - startX, enemy.y - startY);
    expect(distKnocked).toBeCloseTo(180, 0);
  });

  /* 3. Closed-Loop Ouroboros Constriction (Point-in-Polygon Topology) */
  it('3. detects closed-loop constriction via point-in-polygon and crushes trapped enemies', () => {
    g.selectedClass = 'emerald';
    g.gameMode = 'rogue';
    g.startRun();

    const p = g.player;
    // Build a 12-segment snake forming a circular loop enclosing (500, 500)
    p.segments = [];
    const center = { x: 500, y: 500 };
    const radius = 80;
    const numPoints = 12;
    for (let i = 0; i < numPoints; i++) {
      const a = (i / numPoints) * Math.PI * 2;
      const x = center.x + Math.cos(a) * radius;
      const y = center.y + Math.sin(a) * radius;
      p.segments.push({
        x, y,
        angle: a + Math.PI / 2,
        r: 10,
        hp: 30, maxHp: 30,
      } as any);
    }
    // Set head close to tail
    p.x = p.segments[p.segments.length - 1]!.x + 10;
    p.y = p.segments[p.segments.length - 1]!.y + 10;

    const enemy = new Enemy(center.x, center.y, 'scarab', 1);
    g.enemies.push(enemy);

    const isEnclosed = g.combat.checkEncirclement(p, enemy.x, enemy.y);
    expect(isEnclosed).toBe(true);

    const initialHp = enemy.hp;
    g.combat.applyConstrictionDamage(p, g.worldBag());
    expect(enemy.hp).toBeLessThan(initialHp);
    expect(enemy.stasisTimer).toBeGreaterThan(0);
  });

  /* 3b. checkConstriction sets stasis on trapped enemies and automatically triggers food fusion */
  it('3b. checkConstriction sets stasis on trapped enemies and automatically triggers food fusion', () => {
    g.selectedClass = 'emerald';
    g.gameMode = 'rogue';
    g.startRun();
    const p = g.player;
    p.segments = [];
    const center = { x: 500, y: 500 };
    const radius = 80;
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      p.segments.push({
        x: center.x + Math.cos(a) * radius,
        y: center.y + Math.sin(a) * radius,
        angle: a,
        r: 10,
        hp: 30,
        maxHp: 30,
      } as any);
    }
    p.x = p.segments[p.segments.length - 1]!.x + 5;
    p.y = p.segments[p.segments.length - 1]!.y + 5;

    const enemy = new Enemy(center.x, center.y, 'scarab', 1);
    enemy.spawnTimer = 0;
    g.enemies.push(enemy);
    g.foodItems.push(new FoodItem(center.x - 10, center.y, 'apple'));
    g.foodItems.push(new FoodItem(center.x + 10, center.y, 'apple'));

    g.combat.checkConstriction(g.worldBag());

    expect(enemy.stasisTimer).toBeGreaterThan(0);
    const prism = g.foodItems.find(f => f.type === 'prism');
    expect(prism).toBeDefined();
  });

  /* 4. Astral Prism Singularity Compression */
  it('4. compresses trapped food into an Astral Prism with high-value XP bonus', () => {
    g.selectedClass = 'emerald';
    g.gameMode = 'rogue';
    g.startRun();

    const p = g.player;
    // Circular loop around (400, 400)
    p.segments = [];
    const center = { x: 400, y: 400 };
    const radius = 70;
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      p.segments.push({
        x: center.x + Math.cos(a) * radius,
        y: center.y + Math.sin(a) * radius,
        angle: a,
        r: 10, hp: 30, maxHp: 30,
      } as any);
    }
    p.x = p.segments[9]!.x + 5;
    p.y = p.segments[9]!.y + 5;

    // Place 3 foods inside
    g.foodItems.push(new FoodItem(center.x - 10, center.y, 'apple'));
    g.foodItems.push(new FoodItem(center.x + 10, center.y, 'apple'));
    g.foodItems.push(new FoodItem(center.x, center.y + 10, 'apple'));

    const initialFoodCount = g.foodItems.length;
    g.combat.fuseEncircledFoodIntoPrism(p, g.worldBag());

    // 3 foods should be fused into 1 Astral Prism
    expect(g.foodItems.length).toBeLessThan(initialFoodCount);
    const prism = g.foodItems.find(f => f.type === 'prism');
    expect(prism).toBeDefined();
    expect(prism!.xpValue).toBe(15);
  });

  /* 4b. Astral Prism grants instant Overdrive frenzy */
  it('4b. ingesting Astral Prism grants instant Overdrive frenzy charge', () => {
    g.selectedClass = 'emerald';
    g.gameMode = 'rogue';
    g.startRun();
    const prism = new FoodItem(g.player.x, g.player.y, 'prism');
    g.foodItems.push(prism);
    g.combat.resolveFood(g.worldBag());
    expect(g.combat.frenzyTimer).toBeGreaterThan(0);
  });

  /* 5. 28 Alchemical Fusions Detection */
  it('5. evaluates active alchemical fusions across installed Head module pairs', () => {
    const p = new SnakePlayer('emerald', 1280, 720, 4);

    // Install Tesla + Cryo -> Superconductor Surge
    p.InstallHeadModule('tesla');
    p.InstallHeadModule('cryo');

    // Install Magma + Spikes -> Obsidian Carapace
    p.InstallHeadModule('magma');
    p.InstallHeadModule('spikes');

    const fusions = p.getActiveAlchemicalFusions();
    expect(fusions).toContain('superconductor');
    expect(fusions).toContain('obsidian');

    expect(GameData.AlchemicalFusions.length).toBe(28);
  });

  /* 6. GameEngine.requestAutotomy */
  it('6. verifies GameEngine.requestAutotomy triggers autotomy and reduces segments', () => {
    g.selectedClass = 'emerald';
    g.gameMode = 'rogue';
    g.startRun();
    while (g.player.segments.length < 6) g.player.addBodySegment();
    const initialCount = g.player.segments.length;
    const severed = (g as any).requestAutotomy();
    expect(severed).toBeGreaterThan(0);
    expect(g.player.segments.length).toBeLessThan(initialCount);
  });
});
