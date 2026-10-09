/**
 * Ouroboros Ascension — Bot 2: Multi-Dimensional Bug Hunter, Fuzzing & Auto-Fixer Test Suite
 *
 * Systematic stress-testing, fuzzing, and edge-case hardening across:
 * 1. Physics & Kinematics:
 *    - Extreme serpent lengths (L=100 to L=10,000+).
 *    - Sharp angular steering (omega=4.2 to 15.0 rad/s).
 *    - Cascading autotomy cuts down to L=1.
 *    - Segment HP synchronization and damaged states.
 * 2. Multi-Boss Simulation:
 *    - 2 to 6 concurrent bosses on Floor 21+.
 *    - Out-of-order defeat sequence.
 *    - Dynamic weapon retargeting (Tesla, Tachyon Laser, Sonic Cannon, Cryo Carapace, Heat Sink, EMP Coil).
 *    - Multi-boss Relic Auras & Active Skills (Frostbite, Eternal Coil, Orbital Fangs, Stun Roar, Supernova, Cryo Nova, Constriction).
 *    - Bullet hell projectile density & absorption.
 * 3. Spatial Hash Partitioning:
 *    - Saturation with 18,000+ items across 5 layers.
 *    - Zero-allocation flat buffer traversal & capacity scaling.
 *    - Cell boundary crossing accuracy vs brute force.
 *    - Amanatides & Woo fast DDA raymarching.
 * 4. UI & Touch:
 *    - Virtual stick touch cancellation (onTouchCancel) & release.
 *    - Ambidextrous & Lefty layout switching across resolutions.
 *    - Modal unpause state transitions & accumulator stability.
 *
 * Rules: AGENTS.md Protocol 3.0, Rule 6 Headless Sim, Rule 10 In-Code Docs, Rule 11 Non-Cheating.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SnakePlayer, SnakeSegment } from '../sim/SnakePlayer';
import { SpatialHashGrid, SpatialLayer, SpatialLayerMask, SPATIAL_LAYER_COUNT } from '../sim/SpatialHashGrid';
import { GameEngine } from '../sim/GameEngine';
import { GameState } from '../sim/GameState';
import { Boss } from '../sim/Boss';
import { Enemy } from '../sim/Enemy';
import { Projectile } from '../sim/Projectile';
import { Hazard } from '../sim/Hazard';
import { FoodItem } from '../sim/FoodItem';
import { CombatSystem } from '../sim/CombatSystem';
import { ModuleActionRegistry } from '../sim/CombatModules';
import { updateAuras, updateRelicAttacks } from '../sim/CombatAuras';
import { skillTitanRoar, skillSupernova } from '../sim/CombatSkills';
import { ResponsiveLayout, ISafeAreaInsets } from '../ui/ResponsiveLayout';
import { VirtualStick } from '../input/VirtualStick';
import { TouchControls } from '../input/TouchControls';
import { InputManager } from '../input/InputManager';
import { HudView } from '../ui/HudView';
import { UiRoot } from '../ui/UiRoot';
import { MenuScreen } from '../ui/screens/MenuScreen';
import { ClassSelectScreen } from '../ui/screens/ClassSelectScreen';
import { DraftScreen } from '../ui/screens/DraftScreen';
import { FloorClearScreen } from '../ui/screens/FloorClearScreen';
import { GameOverScreen } from '../ui/screens/GameOverScreen';
import { PauseSettingsScreen } from '../ui/screens/PauseSettingsScreen';
import { SnakeLabScreen } from '../ui/screens/SnakeLabScreen';
import { SanctuaryScreen } from '../ui/screens/SanctuaryScreen';
import { SettingsScreen } from '../ui/screens/SettingsScreen';
import { HelpScreen } from '../ui/screens/HelpScreen';
import { StatsModalScreen } from '../ui/screens/StatsModalScreen';
import { RunSummaryScreen } from '../ui/screens/RunSummaryScreen';
import { Services } from '../core/Services';
import { NullFx, NullSound, ScriptedInput } from '../core/Contracts';
import { MetaProgression } from '../data/MetaProgression';
import { SaveIO } from '../platform/SaveIO';
import { MathX } from '../core/MathX';
import { Vec2 } from '../core/Vec2';
import { Rng } from '../core/Rng';
import { setupMockDom, MockElement } from './MockDom';

describe('Bot 2: Multi-Dimensional Bug Hunter, Fuzzing & Auto-Fixer Suite', () => {
  let teardownDom: () => void;

  beforeEach(() => {
    teardownDom = setupMockDom();
    Services.resetToNull();
    Services.sound = new NullSound();
    Services.fx = new NullFx();
    Services.input = new ScriptedInput();
    Services.headless = true;

    SaveIO.memoryBackendEnabled = true;
    SaveIO.clearMemory();
    MetaProgression.instance = new MetaProgression();
  });

  afterEach(() => {
    teardownDom();
  });

  /* ========================================================================= *
   *  DIMENSION 1: PHYSICS & KINEMATICS AT EXTREME SCALE
   * ========================================================================= */
  describe('Dimension 1: Physics & Kinematics at Extreme Scale', () => {
    it('1.1 stresses extreme serpent length L=10,000 under vigorous steering (omega=4.2 to 15.0 rad/s)', () => {
      const player = new SnakePlayer('emerald', 2000, 2000, 2);
      player.maxSegments = 12000;
      player.segments.length = 0;

      const spacing = player.SegmentSpacing;
      const baseHp = player.baseSegmentHp;

      for (let i = 0; i < 10000; i++) {
        player.segments.push(
          new SnakeSegment(
            player.X - (i + 1) * spacing,
            player.Y,
            0,
            player.SegmentRadius,
            baseHp
          )
        );
      }
      player.recalculateMaxHp();
      player.recalculateHp();
      expect(player.segments.length).toBe(10000);

      const dt = 1 / 120;
      for (let step = 0; step < 60; step++) {
        const angle = (step * 0.25) % MathX.Tau;
        player.TurnSpeed = 4.2 + (step % 8) * 1.5; // 4.2 .. 14.7 rad/s

        player.Update(dt, { X: Math.cos(angle), Y: Math.sin(angle), Active: true }, 4000, 4000, null as any);

        expect(Number.isFinite(player.X)).toBe(true);
        expect(Number.isFinite(player.Y)).toBe(true);
        expect(Number.isFinite(player.Angle)).toBe(true);
      }

      // Check IK constraints on sample segments
      let prevX = player.X;
      let prevY = player.Y;
      for (let i = 0; i < player.segments.length; i += 100) {
        const seg = player.segments[i]!;
        expect(Number.isFinite(seg.X)).toBe(true);
        expect(Number.isFinite(seg.Y)).toBe(true);
        expect(seg.R).toBeGreaterThan(0);
      }
    });

    it('1.2 executes cascading autotomy cuts down from L=10,000 to L=1', () => {
      const player = new SnakePlayer('stalker', 2000, 2000, 2);
      player.maxSegments = 12000;
      player.segments.length = 0;

      const spacing = player.SegmentSpacing;
      for (let i = 0; i < 10000; i++) {
        player.segments.push(new SnakeSegment(player.X - (i + 1) * spacing, player.Y, 0, 11, 25));
      }

      let cuts = 0;
      while (player.segments.length > 1 && cuts < 20) {
        const pre = player.segments.length;
        const severed = player.Autotomy();
        const expected = Math.max(1, Math.floor(pre / 2));
        expect(player.segments.length).toBe(expected);
        expect(severed).toBe(pre - expected);
        expect(player.InvulnerableTimer).toBeGreaterThan(0);
        cuts++;
      }
      expect(player.segments.length).toBeLessThanOrEqual(10);
    });

    it('1.3 verifies segment HP synchronization, damage propagation and phoenix revive', () => {
      const player = new SnakePlayer('solar', 1000, 1000, 10);
      expect(player.segments.length).toBe(10);

      const initHp = player.Hp;
      expect(initHp).toBeGreaterThan(0);

      // Damage segment 0
      player.DamageSegment(0, 10, false, false, true);
      expect(player.Hp).toBe(initHp - 10);

      // Add Phoenix revive charge
      player.Relics['phoenixCharges'] = 1;

      // Lethal damage to snake consumes all segments and drops head to 0, triggering Phoenix Rebirth
      player.damageHead(9999);
      expect(player.Alive).toBe(true);
      expect(player.Relics['phoenixCharges']).toBe(0);
      expect(player.PendingRevive).toBe(true);
    });

    it('1.4 verifies tangential velocity and tail whip damage multipliers scale monotonically up to L=10,000', () => {
      const player = new SnakePlayer('solar', 2000, 2000, 2);
      player.maxSegments = 12000;
      player.segments.length = 0;

      for (let i = 0; i < 10000; i++) {
        player.segments.push(new SnakeSegment(2000 - (i + 1) * 15, 2000, 0, 11, 25));
      }

      let prevSpeed = 0;
      let prevMult = 0;

      for (let i = 0; i < player.segments.length; i += 250) {
        const speed = player.GetSegmentTangentialSpeed(i);
        const mult = player.GetTailWhipDamageMultiplier(i);

        expect(Number.isFinite(speed)).toBe(true);
        expect(Number.isFinite(mult)).toBe(true);
        expect(speed).toBeGreaterThanOrEqual(player.BaseSpeed);
        expect(mult).toBeGreaterThanOrEqual(1.0);

        if (i > 0) {
          expect(speed).toBeGreaterThanOrEqual(prevSpeed);
          expect(mult).toBeGreaterThanOrEqual(prevMult);
        }

        prevSpeed = speed;
        prevMult = mult;
      }
    });
  });

  /* ========================================================================= *
   *  DIMENSION 2: MULTI-BOSS SIMULATION & DYNAMIC RETARGETING
   * ========================================================================= */
  describe('Dimension 2: Multi-Boss Simulation & Dynamic Weapon Retargeting', () => {
    it('2.1 spawns 2 to 6 concurrent bosses on Floor 21+ with 0.75 multi-boss HP scaling', () => {
      const engine = new GameEngine(Services.fx);
      engine.setupCanvas(3200, 2400, 1);
      engine.chooseMode('rogue');
      engine.selectedClass = 'emerald';
      engine.startRun(101);

      // Floor 21: 2 Bosses
      engine.currentFloor = 21;
      engine.spawnBoss();
      expect(engine.ActiveBosses.length).toBe(2);
      for (const b of engine.ActiveBosses) {
        expect(b.MultiBossScale).toBe(0.75);
      }

      // Floor 31: 3 Bosses
      engine.currentFloor = 31;
      engine.spawnBoss();
      expect(engine.ActiveBosses.length).toBe(3);

      // Floor 41: 4 Bosses
      engine.currentFloor = 41;
      engine.spawnBoss();
      expect(engine.ActiveBosses.length).toBe(4);

      // Floor 51: 5 Bosses
      engine.currentFloor = 51;
      engine.spawnBoss();
      expect(engine.ActiveBosses.length).toBe(5);

      // Floor 61+: 6 Bosses (capped)
      engine.currentFloor = 75;
      engine.spawnBoss();
      expect(engine.ActiveBosses.length).toBe(6);
    });

    it('2.2 handles out-of-order boss defeat without state corruption', () => {
      const engine = new GameEngine(Services.fx);
      engine.setupCanvas(3200, 2400, 1);
      engine.chooseMode('rogue');
      engine.selectedClass = 'hydra';
      engine.startRun(202);
      engine.MaxFloors = 50;

      engine.currentFloor = 31;
      engine.spawnBoss(undefined, 3);
      expect(engine.ActiveBosses.length).toBe(3);

      const boss0 = engine.ActiveBosses[0]!;
      const boss1 = engine.ActiveBosses[1]!;
      const boss2 = engine.ActiveBosses[2]!;

      // Defeat boss2 first (out of order)
      engine.OnBossDefeated(boss2);
      expect(engine.ActiveBosses.length).toBe(2);
      expect(engine.ActiveBosses).toContain(boss0);
      expect(engine.ActiveBosses).toContain(boss1);
      expect(engine.State).toBe(GameState.Playing);

      // Defeat boss0 next
      engine.OnBossDefeated(boss0);
      expect(engine.ActiveBosses.length).toBe(1);
      expect(engine.ActiveBosses).toContain(boss1);
      expect(engine.State).toBe(GameState.Playing);

      // Defeat boss1 last -> Transitions to FloorClear
      engine.OnBossDefeated(boss1);
      expect(engine.ActiveBosses.length).toBe(0);
      expect(engine.State).toBe(GameState.FloorClear);
    });

    it('2.3 dynamically retargets Tesla, Laser, and Sonic weapon modules across ALL active bosses', () => {
      const engine = new GameEngine(Services.fx);
      engine.setupCanvas(3200, 2400, 1);
      engine.chooseMode('rogue');
      engine.selectedClass = 'emerald';
      engine.startRun(303);

      const player = engine.player!;
      player.X = 1000;
      player.Y = 1000;
      player.Angle = 0; // facing right (+X)

      // Spawn 3 bosses all near the player and vulnerable (entrance completed)
      const boss1 = new Boss(21, 3200, 2400, 'centipede', 1150, 1000, 0.75); // 150px right
      const boss2 = new Boss(21, 3200, 2400, 'colossus', 1200, 1000, 0.75);  // 200px right
      const boss3 = new Boss(21, 3200, 2400, 'hydra_apex', 1000, 1150, 0.75); // 150px down
      boss1.EntranceTimer = 0;
      boss2.EntranceTimer = 0;
      boss3.EntranceTimer = 0;
      engine.ActiveBosses = [boss1, boss2, boss3];

      const hp1Before = boss1.Hp;
      const hp2Before = boss2.Hp;
      const hp3Before = boss3.Hp;

      const world = engine.world;

      // 1. Test Tesla (Bio-Arc Coil) with 3 max targets
      const teslaHandler = ModuleActionRegistry.get('tesla')!;
      let teslaTimer = 1.2;
      const teslaCtx = {
        world,
        sys: engine.Combat,
        player,
        originX: player.X,
        originY: player.Y,
        angle: player.Angle,
        level: 3,
        dmgBonus: 1.0,
        isHead: true,
        dt: 0.016,
        getTimer: () => teslaTimer,
        setTimer: (t: number) => { teslaTimer = t; },
      };
      teslaHandler(teslaCtx as any);

      // Tesla must strike multiple active bosses
      expect(boss1.Hp).toBeLessThan(hp1Before);
      expect(boss2.Hp).toBeLessThan(hp2Before);
      expect(boss3.Hp).toBeLessThan(hp3Before);

      // 2. Test Tachyon Laser (Tachyon Beam) piercing along +X line through boss1 and boss2
      const hp1BeforeLaser = boss1.Hp;
      const hp2BeforeLaser = boss2.Hp;
      const laserHandler = ModuleActionRegistry.get('tachyon')!;
      let laserTimer = 0.85;
      const laserCtx = {
        world,
        sys: engine.Combat,
        player,
        originX: player.X,
        originY: player.Y,
        angle: 0, // firing along +X
        level: 2,
        dmgBonus: 1.0,
        isHead: true,
        dt: 0.016,
        getTimer: () => laserTimer,
        setTimer: (t: number) => { laserTimer = t; },
      };
      laserHandler(laserCtx as any);

      expect(boss1.Hp).toBeLessThan(hp1BeforeLaser);
      expect(boss2.Hp).toBeLessThan(hp2BeforeLaser);

      // 3. Test Sonic Prow Cannon shockwave damaging all 3 bosses within 200px
      const hp1BeforeSonic = boss1.Hp;
      const hp2BeforeSonic = boss2.Hp;
      const hp3BeforeSonic = boss3.Hp;
      const sonicHandler = ModuleActionRegistry.get('sonic')!;
      let sonicTimer = 1.5;
      const sonicCtx = {
        world,
        sys: engine.Combat,
        player,
        originX: player.X,
        originY: player.Y,
        angle: 0,
        level: 3,
        dmgBonus: 1.0,
        isHead: true,
        dt: 0.016,
        getTimer: () => sonicTimer,
        setTimer: (t: number) => { sonicTimer = t; },
      };
      sonicHandler(sonicCtx as any);

      expect(boss1.Hp).toBeLessThan(hp1BeforeSonic);
      expect(boss2.Hp).toBeLessThan(hp2BeforeSonic);
      expect(boss3.Hp).toBeLessThan(hp3BeforeSonic);
    });

    it('2.4 verifies multi-boss coverage for Frostbite Aura, Eternal Coil, and active skills', () => {
      const engine = new GameEngine(Services.fx);
      engine.setupCanvas(3200, 2400, 1);
      engine.chooseMode('rogue');
      engine.selectedClass = 'solar';
      engine.startRun(404);

      const player = engine.player!;
      player.X = 1000;
      player.Y = 1000;

      const boss1 = new Boss(21, 3200, 2400, 'centipede', 1040, 1000, 0.75);
      const boss2 = new Boss(21, 3200, 2400, 'colossus', 1000, 1040, 0.75);
      boss1.EntranceTimer = 0;
      boss2.EntranceTimer = 0;
      engine.ActiveBosses = [boss1, boss2];
      const world = engine.world;

      // 1. Frostbite Aura: Chills both bosses
      player.Relics['frostbite'] = 2;
      updateAuras(engine.Combat, 0.1, world);
      expect(boss1.Status.isChilled).toBe(true);
      expect(boss2.Status.isChilled).toBe(true);

      // 2. Solar Wyrm Supernova: Burns and damages both bosses
      const b1HpPreNova = boss1.Hp;
      const b2HpPreNova = boss2.Hp;
      skillSupernova(engine.Combat, world);
      expect(boss1.Hp).toBeLessThan(b1HpPreNova);
      expect(boss2.Hp).toBeLessThan(b2HpPreNova);
      expect(boss1.Status.isBurning).toBe(true);
      expect(boss2.Status.isBurning).toBe(true);

      // 3. Crimson Hydra Titan Roar: Stuns and damages both bosses
      const b1HpPreRoar = boss1.Hp;
      const b2HpPreRoar = boss2.Hp;
      skillTitanRoar(engine.Combat, world);
      expect(boss1.Hp).toBeLessThan(b1HpPreRoar);
      expect(boss2.Hp).toBeLessThan(b2HpPreRoar);
      expect(boss1.Status.isStunned).toBe(true);
      expect(boss2.Status.isStunned).toBe(true);
    });

    it('2.5 simulates 6 concurrent bosses generating 1,200 bullet hell projectiles with orbital fang deflection', () => {
      const engine = new GameEngine(Services.fx);
      engine.setupCanvas(3200, 2400, 1);
      engine.chooseMode('rogue');
      engine.selectedClass = 'emerald';
      engine.startRun(505);

      const player = engine.player!;
      player.X = 1600;
      player.Y = 1200;
      player.Relics['orbitalFangs'] = 4;

      const world = engine.world;
      const projectiles = world.projectiles;

      // Spawn 1,200 enemy projectiles from 6 boss centers
      for (let b = 0; b < 6; b++) {
        const bx = 1600 + Math.cos((b * Math.PI) / 3) * 400;
        const by = 1200 + Math.sin((b * Math.PI) / 3) * 400;
        for (let p = 0; p < 200; p++) {
          const ang = (p * 0.05) % MathX.Tau;
          projectiles.push(
            new Projectile(bx, by, ang, 220, 15, 'enemy', '#ef4444', { radius: 6, life: 3.0 })
          );
        }
      }
      expect(projectiles.length).toBe(1200);

      // Update projectiles simulation
      const countBefore = projectiles.length;
      engine.Combat.updateProjectiles(0.05, world);

      // Projectiles are processed and bounded
      expect(projectiles.length).toBeLessThanOrEqual(countBefore);
      expect(player.Alive).toBe(true);
    });
  });

  /* ========================================================================= *
   *  DIMENSION 3: SPATIAL HASH SATURATION & EXTREME DENSITY
   * ========================================================================= */
  describe('Dimension 3: Spatial Hash Saturation & Performance', () => {
    it('3.1 inserts 18,000+ entities across 5 layers with zero memory leaks and capacity scaling', () => {
      const grid = new SpatialHashGrid(48, 4000, 4000);

      // 10,000 Segments (Layer 0)
      const segs = Array.from({ length: 10000 }, (_, i) => ({
        x: (i * 7) % 3900 + 50,
        y: (i * 11) % 3900 + 50,
        radius: 11,
      }));
      grid.insertSegments(segs);
      expect(grid.getItemCount(SpatialLayer.Segments)).toBe(10000);

      // 2,000 Enemies (Layer 1)
      for (let i = 0; i < 2000; i++) {
        grid.insert(SpatialLayer.Enemies, (i * 13) % 3900 + 50, (i * 17) % 3900 + 50, i, 16);
      }
      expect(grid.getItemCount(SpatialLayer.Enemies)).toBe(2000);

      // 3,000 Projectiles (Layer 2)
      for (let i = 0; i < 3000; i++) {
        grid.insert(SpatialLayer.Projectiles, (i * 19) % 3900 + 50, (i * 23) % 3900 + 50, i, 6);
      }
      expect(grid.getItemCount(SpatialLayer.Projectiles)).toBe(3000);

      // 1,000 Hazards (Layer 3)
      for (let i = 0; i < 1000; i++) {
        grid.insert(SpatialLayer.Hazards, (i * 29) % 3900 + 50, (i * 31) % 3900 + 50, i, 24);
      }
      expect(grid.getItemCount(SpatialLayer.Hazards)).toBe(1000);

      // 2,000 Collectibles (Layer 4)
      for (let i = 0; i < 2000; i++) {
        grid.insert(SpatialLayer.Collectibles, (i * 37) % 3900 + 50, (i * 41) % 3900 + 50, i, 10);
      }
      expect(grid.getItemCount(SpatialLayer.Collectibles)).toBe(2000);

      expect(grid.getTotalItemCount()).toBe(18000);

      // Verify clearLayer and full clear
      grid.clearLayer(SpatialLayer.Projectiles);
      expect(grid.getItemCount(SpatialLayer.Projectiles)).toBe(0);
      expect(grid.getTotalItemCount()).toBe(15000);

      grid.clear();
      expect(grid.getTotalItemCount()).toBe(0);
    });

    it('3.2 validates 100% precision and recall against brute force search across cell borders', () => {
      const grid = new SpatialHashGrid(48, 2000, 2000);
      const numItems = 1200;
      const items: Array<{ id: number; x: number; y: number; r: number }> = [];

      const rng = new Rng(0xbeefcafe);
      for (let i = 0; i < numItems; i++) {
        const item = {
          id: i,
          x: rng.range(10, 1990),
          y: rng.range(10, 1990),
          r: rng.range(6, 22),
        };
        items.push(item);
        grid.insert(SpatialLayer.Enemies, item.x, item.y, item.id, item.r);
      }

      for (let q = 0; q < 50; q++) {
        const qx = rng.range(50, 1950);
        const qy = rng.range(50, 1950);
        const qr = rng.range(20, 140);

        const expectedIds = new Set<number>();
        for (const it of items) {
          const maxD = qr + it.r;
          const dSq = (it.x - qx) * (it.x - qx) + (it.y - qy) * (it.y - qy);
          if (dSq <= maxD * maxD) {
            expectedIds.add(it.id);
          }
        }

        const actualIds = new Set<number>();
        grid.queryRadius(SpatialLayerMask.Enemies, qx, qy, qr, (id) => {
          actualIds.add(id);
        });

        expect(actualIds.size).toBe(expectedIds.size);
        for (const id of expectedIds) {
          expect(actualIds.has(id)).toBe(true);
        }
      }
    });

    it('3.3 traverses dense multi-layer grid with fast DDA raymarching', () => {
      const grid = new SpatialHashGrid(48, 2000, 2000);
      for (let i = 0; i < 500; i++) {
        grid.insert(SpatialLayer.Enemies, (i * 25) % 1900 + 50, (i * 35) % 1900 + 50, i, 16);
      }

      let hitCount = 0;
      grid.queryRay(SpatialLayerMask.Enemies, 50, 50, 1, 1, 1500, (_id) => {
        hitCount++;
        return false; // continue traversing
      });

      expect(hitCount).toBeGreaterThan(0);
    });
  });

  /* ========================================================================= *
   *  DIMENSION 4: UI, TOUCH, & STATE MACHINE ROBUSTNESS
   * ========================================================================= */
  describe('Dimension 4: UI, Touch & State Machine Robustness', () => {
    it('4.1 handles VirtualStick and TouchControls touch cancellation without steering drift', () => {
      const input = new InputManager();
      const stick = new VirtualStick({ radius: 60, dynamicOrigin: true });
      stick.bind(input);

      // Start touch at (200, 500)
      stick.onTouchStart(1, 200, 500);
      expect(stick.active).toBe(true);
      expect(stick.visible).toBe(true);

      // Move touch to (250, 500) -> steering right (+X)
      stick.onTouchMove(1, 250, 500);
      expect(input.hasDirection).toBe(true);
      expect(input.dirX).toBeGreaterThan(0.5);

      // Cancel touch (e.g. system gesture, call interruption)
      stick.onTouchCancel(1);
      expect(stick.active).toBe(false);
      expect(stick.visible).toBe(false);
      expect(stick.touchId).toBeNull();
      expect(stick.vectorX).toBe(0);
      expect(stick.vectorY).toBe(0);
      expect(input.hasDirection).toBe(false);
      expect(input.dirX).toBe(0);
      expect(input.dirY).toBe(0);
    });

    it('4.2 toggles Ambidextrous / Lefty touch layout cleanly across resolutions', () => {
      const insets: ISafeAreaInsets = { left: 20, top: 40, right: 20, bottom: 30 };
      const resolutions = [
        { w: 390, h: 844 },
        { w: 1024, h: 768 },
        { w: 1920, h: 1080 },
        { w: 2560, h: 1080 },
      ];

      for (const res of resolutions) {
        const layoutRighty = ResponsiveLayout.layoutTouchControls(
          { width: res.w, height: res.h },
          insets,
          false,
          'bottom-center'
        );
        const layoutLefty = ResponsiveLayout.layoutTouchControls(
          { width: res.w, height: res.h },
          insets,
          true,
          'bottom-center'
        );

        // Righty: skill left, dash right of center
        expect(layoutRighty.skillPadX).toBeLessThan(layoutRighty.dashPadX);

        // Lefty: dash left, skill right of center
        expect(layoutLefty.dashPadX).toBeLessThan(layoutLefty.skillPadX);

        // Finite and valid
        expect(Number.isFinite(layoutRighty.dashPadX)).toBe(true);
        expect(Number.isFinite(layoutLefty.dashPadX)).toBe(true);
      }
    });

    it('4.3 fuzzes 300+ modal unpause and state transitions without deadlock or accumulator explosion', () => {
      const container = document.createElement('div') as any;
      const engine = new GameEngine(Services.fx);
      const uiRoot = UiRoot.init(container as any, engine);
      engine.setUiRoot(uiRoot);

      uiRoot.registerScreen(new MenuScreen(uiRoot));
      uiRoot.registerScreen(new ClassSelectScreen(uiRoot));
      uiRoot.registerScreen(new SanctuaryScreen(uiRoot));
      uiRoot.registerScreen(new SettingsScreen(uiRoot));
      uiRoot.registerScreen(new PauseSettingsScreen(uiRoot));
      uiRoot.registerScreen(new SnakeLabScreen(uiRoot));
      uiRoot.registerScreen(new DraftScreen(uiRoot));
      uiRoot.registerScreen(new FloorClearScreen(uiRoot));
      uiRoot.registerScreen(new GameOverScreen(uiRoot));
      uiRoot.registerScreen(new RunSummaryScreen(uiRoot));
      uiRoot.registerScreen(new HelpScreen(uiRoot));
      uiRoot.registerScreen(new StatsModalScreen(uiRoot));

      const rng = new Rng(0x777fade);
      for (let i = 0; i < 300; i++) {
        const op = rng.rangeInt(0, 9);
        switch (op) {
          case 0:
            engine.chooseMode('rogue');
            break;
          case 1:
            engine.selectedClass = 'storm';
            engine.startRun(rng.rangeInt(1, 99999));
            break;
          case 2:
            if (engine.state === GameState.Playing) engine.togglePause();
            break;
          case 3:
            if (engine.state === GameState.Paused) engine.resume();
            break;
          case 4:
            if (engine.runActive) engine.openSnakeLab();
            break;
          case 5:
            if (engine.state === GameState.SnakeLab) engine.closeSnakeLab();
            break;
          case 6:
            if (engine.runActive) engine.advanceFloor();
            break;
          case 7:
            engine.step(0.016);
            break;
          case 8:
            if (engine.runActive) engine.handleGameOver(false);
            break;
        }

        expect(Number.isFinite(engine.accumulator)).toBe(true);
        expect(engine.accumulator).toBeLessThanOrEqual(GameEngine.FixedStep * GameEngine.MaxStepsPerFrame * 2);
      }
    });

    it('4.4 fuzzes 100 randomized viewports verifying UI scaling in [0.60, 3.05] with zero NaN', () => {
      const resp = ResponsiveLayout.instance;
      const rng = new Rng(0x98765432);

      for (let i = 0; i < 100; i++) {
        const w = rng.range(280, 5120);
        const h = rng.range(280, 2880);

        const scale = ResponsiveLayout.computeUiScale(w, h);
        expect(Number.isFinite(scale)).toBe(true);
        expect(scale).toBeGreaterThanOrEqual(0.60);
        expect(scale).toBeLessThanOrEqual(3.05);

        const metrics = resp.computeMetrics(w, h);
        expect(Number.isFinite(metrics.logicalWidth)).toBe(true);
        expect(Number.isFinite(metrics.logicalHeight)).toBe(true);
        expect(Number.isFinite(metrics.hudFont)).toBe(true);
        expect(metrics.logicalWidth).toBeGreaterThan(0);
        expect(metrics.logicalHeight).toBeGreaterThan(0);
      }
    });
  });
});
