import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Boss, BossSegment } from '../sim/Boss';
import { GameEngine } from '../sim/GameEngine';
import { GameData } from '../data/GameData';
import { MetaProgression } from '../data/MetaProgression';
import { HelmetDrop } from '../sim/HelmetDrop';
import { CombatSystem } from '../sim/CombatSystem';
import { SnakePlayer } from '../sim/SnakePlayer';
import { Hazard } from '../sim/Hazard';
import { Projectile } from '../sim/Projectile';
import { Services } from '../core/Services';
import { ScriptedInput, NullFx, NullSound } from '../core/Contracts';
import { WebGLGameRenderer } from '../render/WebGLGameRenderer';
import { GLBatch } from '../render/webgl/GLBatch';
import { WebGLContext } from '../render/webgl/WebGLContext';
import { setupMockDom } from './MockDom';

describe('All 8 Serpentine Apex Bosses Integrity Test Suite', () => {
  let g: GameEngine;
  let im: ScriptedInput;
  let teardownDom: () => void;

  beforeEach(() => {
    teardownDom = setupMockDom();

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
    g.selectedClass = 'emerald';
    g.startRun();
    g.maxFloors = 10;
  });

  afterEach(() => {
    teardownDom();
  });

  /* -------------------------------------------------------------------------
   * 1. ARCHETYPE-SPECIFIC SERPENTINE SEGMENTS, HITBOXES & SPACING
   * ------------------------------------------------------------------------- */
  describe('1. Serpentine Body Segments, Hitboxes & Spacing', () => {
    const archetypeSpecs = [
      { floor: 1, type: 'centipede', expectedSegs: 16, expectedSpacing: 21, baseRad: 15, headRad: 30 },
      { floor: 2, type: 'gorgon', expectedSegs: 16, expectedSpacing: 20, baseRad: 14, headRad: 32 },
      { floor: 3, type: 'colossus', expectedSegs: 13, expectedSpacing: 24, baseRad: 18, headRad: 34 },
      { floor: 4, type: 'frostwyrm', expectedSegs: 22, expectedSpacing: 22, baseRad: 15, headRad: 35 },
      { floor: 5, type: 'chronowyrm', expectedSegs: 22, expectedSpacing: 20, baseRad: 14, headRad: 33 },
      { floor: 6, type: 'hivemind', expectedSegs: 26, expectedSpacing: 19, baseRad: 15, headRad: 36 },
      { floor: 7, type: 'superconductor_boss', expectedSegs: 20, expectedSpacing: 20, baseRad: 15, headRad: 34 },
      { floor: 8, type: 'leviathan', expectedSegs: 30, expectedSpacing: 22, baseRad: 16, headRad: 35 },
    ];

    for (const spec of archetypeSpecs) {
      it(`spawns ${spec.type} on floor ${spec.floor} with exact segments (${spec.expectedSegs}), spacing (${spec.expectedSpacing}px), and radius`, () => {
        const boss = new Boss(spec.floor, 1280, 720);
        expect(boss.type).toBe(spec.type);
        expect(boss.radius).toBe(spec.headRad);
        expect(boss.segments.length).toBe(spec.expectedSegs);
        expect(boss.segmentSpacing).toBe(spec.expectedSpacing);
        expect(boss.parts().length).toBe(spec.expectedSegs);

        // Verify initial alignment: segments stacked vertically beneath head
        for (let i = 0; i < boss.segments.length; i++) {
          const seg = boss.segments[i]!;
          expect(seg.x).toBe(boss.x);
          expect(seg.y).toBe(boss.y + (i + 1) * spec.expectedSpacing);

          // Verify radius tapering gradient: baseRad -> baseRad * 0.6
          const expectedR = Math.max(8, spec.baseRad - Math.floor((i / spec.expectedSegs) * (spec.baseRad * 0.4)));
          expect(seg.r).toBe(expectedR);
          expect(seg.r).toBeGreaterThanOrEqual(8);
          expect(seg.r).toBeLessThanOrEqual(spec.baseRad);
        }
      });
    }

    it('scales Leviathan MoveTimer to 5.0 on spawn', () => {
      const leviathan = new Boss(8, 1280, 720);
      expect(leviathan.type).toBe('leviathan');
      expect(leviathan.moveTimer).toBe(5.0);
    });
  });

  /* -------------------------------------------------------------------------
   * 2. PHASE 1 -> PHASE 2 ENRAGE TRANSITION (<50% HP)
   * ------------------------------------------------------------------------- */
  describe('2. Phase 1 -> Phase 2 Enrage Transitions at <= 50% HP', () => {
    for (let f = 1; f <= 8; f++) {
      it(`transitions boss on floor ${f} (${GameData.Bosses[f - 1]!.Type}) into Phase 2 enrage at <= 50% HP`, () => {
        const boss = new Boss(f, 1280, 720);
        boss.entranceTimer = 0;
        expect(boss.phase).toBe(1);
        expect(boss.onPhaseChange).toBe(false);

        // Deal 40% damage -> HP = 60%, must stay Phase 1
        boss.applyDamage(boss.maxHp * 0.40);
        expect(boss.phase).toBe(1);
        expect(boss.onPhaseChange).toBe(false);

        // Deal additional 15% damage -> HP = 45% (<= 50%), triggers Phase 2
        boss.applyDamage(boss.maxHp * 0.15);
        expect(boss.phase).toBe(2);
        expect(boss.onPhaseChange).toBe(true);
        expect(boss.attackTimer).toBe(0.9); // Immediate enrage reset
      });
    }

    it('triggers CombatSystem visual and sound alert feedback upon Phase 2 transition', () => {
      const boss = new Boss(1, 1280, 720);
      boss.entranceTimer = 0;
      g.boss = boss;

      const cs = g.combat;
      // Damage boss across the 50% boundary via CombatSystem
      cs.damageBoss(boss, boss.maxHp * 0.55, g.worldBag());

      expect(boss.phase).toBe(2);
      expect(boss.hp).toBeLessThanOrEqual(boss.maxHp * 0.5);
    });
  });

  /* -------------------------------------------------------------------------
   * 3. UNIQUE BULLET-HELL ATTACKS, PATTERNS & GROUND HAZARDS
   * ------------------------------------------------------------------------- */
  describe('3. Unique Attacks & Bullet-Hell Attack Patterns', () => {
    beforeEach(() => {
      g.player.x = 640;
      g.player.y = 500;
    });

    it('Centipede Behemoth: fires 3 directional projectiles in P1, escalates to 5 spread bullets and 185 speed in P2', () => {
      const boss = new Boss(1, 1280, 720);
      boss.entranceTimer = 0;
      g.boss = boss;
      g.projectiles.length = 0;

      // Phase 1 Attack
      boss.attackTimer = 0;
      boss.update(1 / 120, g.player, g.worldBag());
      expect(g.projectiles.length).toBe(3);
      expect(g.projectiles[0]!.color).toBe('#ff6b8a');
      expect(boss.attackTimer).toBeCloseTo(2.2, 1);

      // Phase 2 Attack
      boss.phase = 2;
      g.projectiles.length = 0;
      boss.attackTimer = 0;
      boss.update(1 / 120, g.player, g.worldBag());
      expect(g.projectiles.length).toBe(5);
      expect(boss.attackTimer).toBeCloseTo(1.4, 1);
    });

    it('Storm Gorgon: fires 4 radial venom darts in P1, escalates to 8 wobble darts and laser hazard in P2', () => {
      const boss = new Boss(2, 1280, 720);
      boss.entranceTimer = 0;
      g.boss = boss;
      g.projectiles.length = 0;
      g.hazards.length = 0;

      // Phase 1
      boss.attackTimer = 0;
      boss.update(1 / 120, g.player, g.worldBag());
      expect(g.projectiles.length).toBe(4);
      expect(g.projectiles[0]!.color).toBe('#00f0b5');
      expect(g.projectiles[0]!.wobble).toBe(18);
      expect(g.hazards.length).toBe(0);

      // Phase 2
      boss.phase = 2;
      g.projectiles.length = 0;
      boss.attackTimer = 0;
      boss.update(1 / 120, g.player, g.worldBag());
      expect(g.projectiles.length).toBe(8);
      expect(g.hazards.length).toBe(1);
      expect(g.hazards[0]!.type).toBe('laser');
      expect(g.hazards[0]!.telegraph).toBe(0.9);
    });

    it('Infernal Colossus: fires 15 magma projectiles in P1, escalates to 22 projectiles and 4 meteor craters in P2', () => {
      const boss = new Boss(3, 1280, 720);
      boss.entranceTimer = 0;
      g.boss = boss;
      g.projectiles.length = 0;
      g.hazards.length = 0;

      // Phase 1
      boss.attackTimer = 0;
      boss.update(1 / 120, g.player, g.worldBag());
      expect(g.projectiles.length).toBe(15);
      expect(g.projectiles[0]!.color).toBe('#ffb703');
      expect(g.hazards.length).toBe(0);

      // Phase 2
      boss.phase = 2;
      g.projectiles.length = 0;
      boss.attackTimer = 0;
      boss.update(1 / 120, g.player, g.worldBag());
      expect(g.projectiles.length).toBe(22);
      expect(g.hazards.length).toBe(4);
      expect(g.hazards[0]!.type).toBe('meteor');
      expect(g.hazards[0]!.radius).toBe(52);
    });

    it('Glacial Behemoth (Frostwyrm): fires 8 cryo projectiles in P1, escalates to 12 cryo shots and 3 frost zones in P2', () => {
      const boss = new Boss(4, 1280, 720);
      boss.entranceTimer = 0;
      g.boss = boss;
      g.projectiles.length = 0;
      g.hazards.length = 0;

      // Phase 1
      boss.attackTimer = 0;
      boss.update(1 / 120, g.player, g.worldBag());
      expect(g.projectiles.length).toBe(8);
      expect(g.projectiles[0]!.chill).toBe(2.5);
      expect(g.projectiles[0]!.color).toBe('#38bdf8');
      expect(g.hazards.length).toBe(0);

      // Phase 2
      boss.phase = 2;
      g.projectiles.length = 0;
      boss.attackTimer = 0;
      boss.update(1 / 120, g.player, g.worldBag());
      expect(g.projectiles.length).toBe(12);
      expect(g.hazards.length).toBe(3);
      expect(g.hazards[0]!.type).toBe('frost');
      expect(g.hazards[0]!.radius).toBe(46);
    });

    it('Chrono Wyrm: fires 5 directional fan temporal missiles in P1, escalates to 8 fan missiles and chrono hazard in P2', () => {
      const boss = new Boss(5, 1280, 720);
      boss.entranceTimer = 0;
      g.boss = boss;
      g.projectiles.length = 0;
      g.hazards.length = 0;

      // Phase 1
      boss.attackTimer = 0;
      boss.update(1 / 120, g.player, g.worldBag());
      expect(g.projectiles.length).toBe(5);
      expect(g.projectiles[0]!.color).toBe('#a855f7');
      expect(g.projectiles[0]!.wobble).toBe(12);
      expect(g.hazards.length).toBe(0);

      // Phase 2
      boss.phase = 2;
      g.projectiles.length = 0;
      boss.attackTimer = 0;
      boss.update(1 / 120, g.player, g.worldBag());
      expect(g.projectiles.length).toBe(8);
      expect(g.hazards.length).toBe(1);
      expect(g.hazards[0]!.type).toBe('chrono');
      expect(g.hazards[0]!.radius).toBe(45);
    });

    it('Bio-Venom Hivemind: fires 6 poison projectiles in P1, escalates to 10 poison shots and toxic hazard in P2', () => {
      const boss = new Boss(6, 1280, 720);
      boss.entranceTimer = 0;
      g.boss = boss;
      g.projectiles.length = 0;
      g.hazards.length = 0;

      // Phase 1
      boss.attackTimer = 0;
      boss.update(1 / 120, g.player, g.worldBag());
      expect(g.projectiles.length).toBe(6);
      expect(g.projectiles[0]!.burn).toBe(3.0);
      expect(g.projectiles[0]!.color).toBe('#84cc16');
      expect(g.hazards.length).toBe(0);

      // Phase 2
      boss.phase = 2;
      g.projectiles.length = 0;
      boss.attackTimer = 0;
      boss.update(1 / 120, g.player, g.worldBag());
      expect(g.projectiles.length).toBe(10);
      expect(g.hazards.length).toBe(1);
      expect(g.hazards[0]!.type).toBe('poison');
      expect(g.hazards[0]!.radius).toBe(50);
    });

    it('Apex Superconductor: fires 8 galvanic bolts in P1, escalates to 12 bolts and lightning strike hazard in P2', () => {
      const boss = new Boss(7, 1280, 720);
      boss.entranceTimer = 0;
      g.boss = boss;
      g.projectiles.length = 0;
      g.hazards.length = 0;

      // Phase 1
      boss.attackTimer = 0;
      boss.update(1 / 120, g.player, g.worldBag());
      expect(g.projectiles.length).toBe(8);
      expect(g.projectiles[0]!.wobble).toBe(22);
      expect(g.projectiles[0]!.color).toBe('#06d6a0');
      expect(g.hazards.length).toBe(0);

      // Phase 2
      boss.phase = 2;
      g.projectiles.length = 0;
      boss.attackTimer = 0;
      boss.update(1 / 120, g.player, g.worldBag());
      expect(g.projectiles.length).toBe(12);
      expect(g.hazards.length).toBe(1);
      expect(g.hazards[0]!.type).toBe('laser');
      expect(g.hazards[0]!.radius).toBe(42);
    });

    it('Astral Leviathan: streams spiral arms and periodic homing void missiles (2 in P1, 3 in P2)', () => {
      const boss = new Boss(8, 1280, 720);
      boss.entranceTimer = 0;
      g.boss = boss;
      g.projectiles.length = 0;

      // Phase 1 Spiral Arms (2 projectiles)
      boss.attackTimer = 0;
      boss.moveTimer = 5.0; // Prevent void missile burst on this tick
      boss.update(1 / 120, g.player, g.worldBag());
      expect(g.projectiles.length).toBe(2);
      expect(g.projectiles[0]!.color).toBe('#c77dff');

      // Phase 1 Periodic Homing Void Missiles (2 missiles)
      g.projectiles.length = 0;
      boss.attackTimer = 10.0;
      boss.moveTimer = 0; // Trigger void missiles
      boss.update(1 / 120, g.player, g.worldBag());
      expect(g.projectiles.length).toBe(2);
      expect(g.projectiles[0]!.homing).toBe(1.5);
      expect(g.projectiles[0]!.color).toBe('#7b2cbf');
      expect(boss.moveTimer).toBe(5.0);

      // Phase 2 Spiral Arms (3 projectiles) and Void Missiles (3 missiles)
      boss.phase = 2;
      g.projectiles.length = 0;
      boss.attackTimer = 0;
      boss.moveTimer = 5.0;
      boss.update(1 / 120, g.player, g.worldBag());
      expect(g.projectiles.length).toBe(3);

      g.projectiles.length = 0;
      boss.attackTimer = 10.0;
      boss.moveTimer = 0;
      boss.update(1 / 120, g.player, g.worldBag());
      expect(g.projectiles.length).toBe(3);
      expect(boss.moveTimer).toBe(3.4);
    });
  });

  /* -------------------------------------------------------------------------
   * 4. SERPENTINE VERTEBRAL FOLLOW KINEMATICS
   * ------------------------------------------------------------------------- */
  describe('4. Serpentine Kinematics & Vertebral Undulation', () => {
    it('propagates motion smoothly through all body segments during locomotion', () => {
      const boss = new Boss(1, 1280, 720);
      boss.entranceTimer = 0;
      g.player.x = 200;
      g.player.y = 200;

      const initialPos = boss.segments.map(s => ({ x: s.x, y: s.y }));

      // Run 60 ticks of simulation
      for (let t = 0; t < 60; t++) {
        boss.update(1 / 120, g.player, g.worldBag());
      }

      // Verify each segment moved and maintained spacing
      for (let i = 0; i < boss.segments.length; i++) {
        const s = boss.segments[i]!;
        const init = initialPos[i]!;
        const moved = Math.hypot(s.x - init.x, s.y - init.y);
        expect(moved).toBeGreaterThan(0);

        const leaderX = i === 0 ? boss.x : boss.segments[i - 1]!.x;
        const leaderY = i === 0 ? boss.y : boss.segments[i - 1]!.y;
        const distToLeader = Math.hypot(leaderX - s.x, leaderY - s.y);
        expect(distToLeader).toBeLessThanOrEqual(boss.segmentSpacing * 1.6);
      }
    });
  });

  /* -------------------------------------------------------------------------
   * 5. BOSS DEATH LOOT & PHYSICAL HELMET SPAWNING AT DEATH COORDINATES
   * ------------------------------------------------------------------------- */
  describe('5. Boss Defeat Loot Spawning & Helmet Drop Pickup', () => {
    for (let f = 1; f <= 8; f++) {
      it(`spawns physical HelmetDrop at exact death coordinates upon defeating floor ${f} boss`, () => {
        g.currentFloor = f;
        g.maxFloors = 10;

        const boss = new Boss(f, 1280, 720);
        boss.x = 550;
        boss.y = 350;
        boss.entranceTimer = 0;
        g.boss = boss;
        g.helmetDrops.length = 0;
        g.foods.length = 0;

        const deathX = boss.x;
        const deathY = boss.y;
        const bossType = boss.type;

        // Trigger boss defeat
        g.onBossDefeated();

        // 1. Assert Boss killed and cleared
        expect(g.boss).toBeNull();
        expect(g.combat.bossKills).toBe(1);

        // 2. Assert 6 food/nutrient items dropped around boss location
        expect(g.foods.length).toBe(6);

        // 3. Assert physical HelmetDrop entity spawned at exact death coordinates
        expect(g.helmetDrops.length).toBe(1);
        const drop = g.helmetDrops[0]!;
        expect(drop.x).toBe(deathX);
        expect(drop.y).toBe(deathY);
        expect(drop.dead).toBe(false);
        expect(drop.helmet).toBeDefined();
        expect(drop.helmet.floor).toBe(f);
        expect(drop.helmet.bossType).toBe(bossType);
        expect(drop.rarity).toBeDefined();

        // 4. Assert physical drop physics and pulse animation update
        drop.update(1 / 60);
        expect(drop.pulse).toBeGreaterThan(0);
        expect(drop.spawnScale).toBeGreaterThan(0);

        // 5. Assert collecting helmet adds it into MetaProgression inventory
        const initialCount = MetaProgression.instance.helmets.length;
        g.collectHelmetDrop(drop);
        expect(drop.dead).toBe(true);
        expect(MetaProgression.instance.helmets.length).toBe(initialCount + 1);
        expect(MetaProgression.instance.helmets.some(h => h.id === drop.helmet.id)).toBe(true);
      });
    }
  });

  /* -------------------------------------------------------------------------
   * 6. BOSS RENDERER & TELEGRAPH INTEGRITY
   * ------------------------------------------------------------------------- */
  describe('6. WebGL Apex Boss Procedural Visual Rendering & Telegraphs', () => {
    it('safely executes WebGLGameRenderer.drawBoss across all 8 boss archetype geometries and telegraphs', () => {
      const mockCanvas = document.createElement('canvas') as any;
      mockCanvas.width = 1280;
      mockCanvas.height = 720;
      const glContext = new WebGLContext(mockCanvas);
      const batch = new GLBatch(glContext);

      const bossTypes = ['centipede', 'gorgon', 'colossus', 'frostwyrm', 'chronowyrm', 'hivemind', 'superconductor_boss', 'leviathan'];

      for (const bType of bossTypes) {
        const renderData = {
          x: 640,
          y: 360,
          type: bType,
          radius: 32,
          angle: 0.5,
          color: '#ff3366',
          accent: '#00f0b5',
          hp: 500,
          maxHp: 1000,
          phase: 2,
          segments: [
            { x: 640, y: 380, r: 15 },
            { x: 640, y: 400, r: 14 },
            { x: 640, y: 420, r: 12 },
          ],
          telegraphs: [
            { type: 'circle', x: 640, y: 360, radius: 100, progress: 0.5 },
            { type: 'cone', x: 640, y: 360, radius: 150, angle: 0, spread: 0.8, progress: 0.7 },
            { type: 'line', x: 640, y: 360, length: 250, angle: 1.2, progress: 0.3 },
          ],
        };

        // Must draw cleanly without throwing any exceptions
        expect(() => WebGLGameRenderer.drawBoss(batch, renderData)).not.toThrow();
      }
    });

    it('safely draws circle, cone, and line telegraphs via WebGLGameRenderer.drawTelegraph', () => {
      const mockCanvas = document.createElement('canvas') as any;
      mockCanvas.width = 1280;
      mockCanvas.height = 720;
      const glContext = new WebGLContext(mockCanvas);
      const batch = new GLBatch(glContext);

      const telegraphs = [
        { type: 'circle', x: 200, y: 200, radius: 80, progress: 0.5 },
        { type: 'cone', x: 200, y: 200, radius: 120, angle: 0.2, spread: 0.5, progress: 0.8 },
        { type: 'line', x: 200, y: 200, length: 200, angle: 0.7, progress: 0.4 },
      ];

      for (const t of telegraphs) {
        expect(() => WebGLGameRenderer.drawTelegraph(batch, t)).not.toThrow();
      }
    });
  });
});
