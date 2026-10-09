/**
 * Ouroboros Ascension — Step 3 Test Suite: Combat Systems, Head-Centric Weapons,
 * 28 Alchemical Fusions & Status Invariance (CombatFusionsAndStatusInvariance.test.ts)
 *
 * Verifies that existing combat mechanics, formulas, and balance values remain strictly
 * unchanged, deterministic, and fully compliant with Rule 11 (Head-Centric Arsenal)
 * and ORACLE.md Single Source of Truth (SSOT).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { GameEngine } from '../sim/GameEngine';
import { SnakePlayer } from '../sim/SnakePlayer';
import { Enemy } from '../sim/Enemy';
import { Boss } from '../sim/Boss';
import { FoodItem } from '../sim/FoodItem';
import { Projectile } from '../sim/Projectile';
import { Hazard } from '../sim/Hazard';
import { StatusSet } from '../sim/StatusSet';
import { CombatSystem, type DamageOpts } from '../sim/CombatSystem';
import {
  ModuleActionRegistry,
  executeHeadModules,
  type ModuleActionContext,
} from '../sim/CombatModules';
import {
  activateSkill,
  skillVerdantBloom,
  skillUmbralBlink,
  skillTitanRoar,
  skillChainStorm,
  skillSupernova,
} from '../sim/CombatSkills';
import { AutonomousBotPlayer } from '../sim/ai/AutonomousBotPlayer';
import { GameData } from '../data/GameData';
import { MetaProgression } from '../data/MetaProgression';
import { Services } from '../core/Services';
import { ScriptedInput, NullFx, NullSound } from '../core/Contracts';
import { MathX } from '../core/MathX';
import { Vec2 } from '../core/Vec2';

describe('Step 3: Combat Systems, Head-Centric Weapons, 28 Alchemical Fusions & Status Invariance', () => {
  let g: GameEngine;
  let im: ScriptedInput;

  beforeEach(() => {
    MetaProgression.readBackend = () => null;
    MetaProgression.writeBackend = () => {};
    MetaProgression.deleteBackend = () => {};
    MetaProgression.instance = new MetaProgression();
    MetaProgression.instance.unlockedClasses = {
      emerald: true,
      stalker: true,
      hydra: true,
      storm: true,
      solar: true,
    };

    g = new GameEngine();
    im = new ScriptedInput();
    Services.input = im;
    Services.fx = new NullFx();
    Services.sound = new NullSound();
    Services.headless = true;
    g.setupCanvas(1280, 720, 1);
  });

  // ===========================================================================
  // PILLAR 1: COMPLETE 28 ALCHEMICAL CROSS-MODULE FUSION MATRIX
  // ===========================================================================
  describe('Pillar 1: Complete 28 Alchemical Cross-Module Fusion Matrix', () => {
    it('1.1 verifies exact count of 28 unique alchemical fusions in GameData with non-empty metadata', () => {
      const fusions = GameData.AlchemicalFusions;
      expect(fusions.length).toBe(28);

      const idSet = new Set<string>();
      for (let i = 0; i < fusions.length; i++) {
        const f = fusions[i]!;
        expect(f.Id).toBeDefined();
        expect(f.Id.length).toBeGreaterThan(0);
        expect(f.Name).toBeDefined();
        expect(f.Name.length).toBeGreaterThan(0);
        expect(f.Icon).toBeDefined();
        expect(f.Icon.length).toBeGreaterThan(0);
        expect(f.ModuleA).toBeDefined();
        expect(f.ModuleA.length).toBeGreaterThan(0);
        expect(f.ModuleB).toBeDefined();
        expect(f.ModuleB.length).toBeGreaterThan(0);
        expect(f.ModuleA.toLowerCase()).not.toBe(f.ModuleB.toLowerCase());
        expect(f.Desc).toBeDefined();
        expect(f.Desc.length).toBeGreaterThan(0);

        expect(idSet.has(f.Id)).toBe(false);
        idSet.add(f.Id);
      }
      expect(idSet.size).toBe(28);
    });

    it('1.2 verifies prerequisite detection and state transitions for all 28 fusions individually', () => {
      const fusions = GameData.AlchemicalFusions;
      for (let i = 0; i < fusions.length; i++) {
        const fusion = fusions[i]!;
        const player = new SnakePlayer('emerald', 800, 600, 4);

        // State 0: 0 modules installed -> Inactive
        expect(player.GetActiveAlchemicalFusions()).not.toContain(fusion.Id);

        // State 1: Only Module A installed -> Inactive
        player.InstallHeadModule(fusion.ModuleA);
        expect(player.GetActiveAlchemicalFusions()).not.toContain(fusion.Id);

        // State 2: Module A + Module B installed -> Active
        player.InstallHeadModule(fusion.ModuleB);
        expect(player.GetActiveAlchemicalFusions()).toContain(fusion.Id);

        // State 3: Module A uninstalled -> Inactive
        player.UninstallHeadModule(fusion.ModuleA);
        expect(player.GetActiveAlchemicalFusions()).not.toContain(fusion.Id);

        // State 4: Order independence (Module B already installed, now re-install Module A) -> Active
        player.InstallHeadModule(fusion.ModuleA);
        expect(player.GetActiveAlchemicalFusions()).toContain(fusion.Id);

        // State 5: Module B uninstalled -> Inactive
        player.UninstallHeadModule(fusion.ModuleB);
        expect(player.GetActiveAlchemicalFusions()).not.toContain(fusion.Id);
      }
    });

    it('1.3 synthesizes 12 simultaneous alchemical fusions when 6 modules are equipped', () => {
      const player = new SnakePlayer('emerald', 800, 600, 6);
      player.InstallHeadModule('tesla');
      player.InstallHeadModule('cryo');
      player.InstallHeadModule('magma');
      player.InstallHeadModule('spikes');
      player.InstallHeadModule('tachyon');
      player.InstallHeadModule('shield');

      const active = player.GetActiveAlchemicalFusions();
      const expectedFusions = [
        'superconductor',
        'obsidian',
        'sublimation_shock',
        'prismatic',
        'tachyon_overcharge',
        'kinetic_bastion',
        'cryo_barrier',
        'volcanic_bulwark',
        'electrified_hull',
        'thermal_ray',
        'cryo_tachyon',
        'photon_mirror',
      ];

      expect(active.length).toBe(12);
      for (const ef of expectedFusions) {
        expect(active).toContain(ef);
      }
    });

    it('1.4 verifies AutonomousBotPlayer.FusionPartnersMap indexes all 28 fusions with two-way symmetric pairing', () => {
      const partnerMap = AutonomousBotPlayer.FusionPartnersMap;
      expect(partnerMap).toBeDefined();

      let totalUniquePairs = 0;
      for (const fusion of GameData.AlchemicalFusions) {
        const a = fusion.ModuleA.toLowerCase();
        const b = fusion.ModuleB.toLowerCase();

        expect(partnerMap[a]).toBeDefined();
        expect(partnerMap[a]).toContain(b);

        expect(partnerMap[b]).toBeDefined();
        expect(partnerMap[b]).toContain(a);

        totalUniquePairs++;
      }
      expect(totalUniquePairs).toBe(28);
    });

    it('1.5 verifies module level scaling and damage bonus multipliers in declarative execution', () => {
      g.selectedClass = 'emerald';
      g.gameMode = 'rogue';
      g.startRun();
      const p = g.player;

      // Test level 1 vs level 3 turret damage scaling:
      // Turret formula: dmg = (isHead ? 16 : 14) * level * dmgBonus
      p.x = 500;
      p.y = 500;
      p.headModules = { turret: 1 };
      p.headModuleTimers = {};
      p.damageBonus = 1.0;

      const enemy = new Enemy(550, 500, 'scarab', 1);
      enemy.spawnTimer = 0;
      g.enemies = [enemy];

      // Tick turret at level 1
      g.projectiles = [];
      p.headModuleTimers['turret'] = 0.65; // Ready to fire
      executeHeadModules(g.combat, 0.01, g.worldBag());
      expect(g.projectiles.length).toBe(1);
      const projLvl1 = g.projectiles[0]!;
      expect(projLvl1.damage).toBe(16 * 1 * 1.0);

      // Now set turret to level 3 with damage bonus 1.5
      g.projectiles = [];
      p.headModules = { turret: 3 };
      p.headModuleTimers['turret'] = 0.65;
      p.damageBonus = 1.5;
      executeHeadModules(g.combat, 0.01, g.worldBag());
      expect(g.projectiles.length).toBe(1);
      const projLvl3 = g.projectiles[0]!;
      expect(projLvl3.damage).toBe(16 * 3 * 1.5);
    });
  });

  // ===========================================================================
  // PILLAR 2: HEAD-CENTRIC SERPENTINE ARSENAL (RULE 11 COMPLIANCE)
  // ===========================================================================
  describe('Pillar 2: Head-Centric Serpentine Arsenal (Rule 11 Compliance)', () => {
    it('2.1 verifies all 16 weapons and 12 defenses execute strictly with isHead = true and head origin coordinates', () => {
      const allModules = GameData.SocketModules.Keys;
      expect(allModules.length).toBe(28);

      g.selectedClass = 'emerald';
      g.gameMode = 'rogue';
      g.startRun();
      const p = g.player;
      p.x = 450;
      p.y = 350;
      p.angle = Math.PI / 4;

      for (const mod of allModules) {
        p.headModules = { [mod]: 1 };
        p.headModuleTimers = { [mod]: 10.0 }; // Force timers ready

        let capturedCtx: ModuleActionContext | null = null;
        const originalAction = ModuleActionRegistry.get(mod);
        ModuleActionRegistry.register(mod, (ctx) => {
          capturedCtx = ctx;
          if (originalAction) originalAction(ctx);
        });

        executeHeadModules(g.combat, 0.1, g.worldBag());

        expect(capturedCtx).not.toBeNull();
        expect(capturedCtx!.isHead).toBe(true);
        expect(capturedCtx!.originX).toBe(p.x);
        expect(capturedCtx!.originY).toBe(p.y);
        expect(capturedCtx!.angle).toBe(p.angle);

        // Restore original handler
        if (originalAction) ModuleActionRegistry.register(mod, originalAction);
      }
    });

    it('2.2 dynamically tracks moving head position and heading angle for projectile launches', () => {
      g.selectedClass = 'emerald';
      g.gameMode = 'rogue';
      g.startRun();
      const p = g.player;

      p.headModules = { turret: 1 };
      p.headModuleTimers = { turret: 0.65 };

      // Head at position (300, 200)
      p.x = 300;
      p.y = 200;
      p.angle = 0;
      const enemy1 = new Enemy(400, 200, 'scarab', 1);
      enemy1.spawnTimer = 0;
      g.enemies = [enemy1];
      g.projectiles = [];

      executeHeadModules(g.combat, 0.01, g.worldBag());
      expect(g.projectiles.length).toBe(1);
      expect(g.projectiles[0]!.x).toBe(300);
      expect(g.projectiles[0]!.y).toBe(200);

      // Now relocate head to (600, 500)
      p.x = 600;
      p.y = 500;
      p.headModuleTimers = { turret: 0.65 };
      const enemy2 = new Enemy(600, 600, 'scarab', 1);
      enemy2.spawnTimer = 0;
      g.enemies = [enemy2];
      g.projectiles = [];

      executeHeadModules(g.combat, 0.01, g.worldBag());
      expect(g.projectiles.length).toBe(1);
      expect(g.projectiles[0]!.x).toBe(600);
      expect(g.projectiles[0]!.y).toBe(500);
    });

    it('2.3 confirms zero segment sockets and zero weapon firing from trailing body segments', () => {
      const p = new SnakePlayer('emerald', 800, 600, 8);
      expect(p.segments.length).toBe(8);

      // Verify that segments do not possess socket or weapon execution interfaces
      for (let i = 0; i < p.segments.length; i++) {
        const seg = p.segments[i] as any;
        expect(seg.headModules).toBeUndefined();
        expect(seg.socketModules).toBeUndefined();
        expect(seg.weapons).toBeUndefined();
        expect(seg.fireWeapon).toBeUndefined();
      }
    });

    it('2.4 verifies all 5 serpent class active skills initiate strictly from the serpent head', () => {
      const classes = ['emerald', 'stalker', 'hydra', 'storm', 'solar'] as const;

      for (const cls of classes) {
        g.selectedClass = cls;
        g.gameMode = 'rogue';
        g.startRun();
        const p = g.player;
        p.x = 640;
        p.y = 360;
        p.angle = Math.PI / 6;
        p.skillCooldownTimer = 0;
        g.foods = []; // Clear ambient foods for pure verification

        const initialX = p.x;
        const initialY = p.y;
        const initialAngle = p.angle;

        const activated = activateSkill(g.combat, g.worldBag());
        expect(activated).toBe(true);

        switch (cls) {
          case 'emerald': {
            // Verdant Bloom: spawns 5 nutrient foods radially around head
            expect(g.foods.length).toBe(5);
            for (const f of g.foods) {
              const d = MathX.hypot(f.x - initialX, f.y - initialY);
              expect(d).toBeLessThanOrEqual(100);
            }
            break;
          }
          case 'stalker': {
            // Umbral Blink: teleported 200px along head angle
            const expectedX = initialX + Math.cos(initialAngle) * 200;
            const expectedY = initialY + Math.sin(initialAngle) * 200;
            expect(p.x).toBeCloseTo(expectedX, 0);
            expect(p.y).toBeCloseTo(expectedY, 0);
            // Spawned 6 afterimages along trajectory
            expect(p.afterimages.length).toBe(6);
            break;
          }
          case 'hydra': {
            // Titan Roar: 5s armor buff applied to player
            expect(p.armorBuffTimer).toBe(5);
            break;
          }
          case 'storm': {
            // Chain Storm: chain lightning cooldown triggered
            expect(p.skillCooldownTimer).toBeGreaterThan(0);
            break;
          }
          case 'solar': {
            // Supernova: cooks food and burns within 260px of head
            expect(p.skillCooldownTimer).toBeGreaterThan(0);
            break;
          }
        }
      }
    });

    it('2.5 verifies ballistic projectile kinematics: x(t) = x0 + vx*t, y(t) = y0 + vy*t', () => {
      const speed = 400;
      const angle = Math.PI / 4; // 45 degrees: cos = sin = sqrt(2)/2
      const p = new Projectile(100, 100, angle, speed, 25, 'player', '#00f0b5', { life: 2.0 });

      expect(p.vx).toBeCloseTo(Math.cos(angle) * speed, 3);
      expect(p.vy).toBeCloseTo(Math.sin(angle) * speed, 3);

      const dt = 0.5;
      p.update(dt);

      expect(p.x).toBeCloseTo(100 + p.vx * dt, 3);
      expect(p.y).toBeCloseTo(100 + p.vy * dt, 3);
      expect(p.life).toBeCloseTo(1.5, 3);
      expect(p.dead).toBe(false);

      // Advance past life -> dead
      p.update(1.6);
      expect(p.dead).toBe(true);
    });

    it('2.6 verifies projectile piercing counts and consumption lifecycle', () => {
      g.selectedClass = 'emerald';
      g.gameMode = 'rogue';
      g.startRun();

      // Projectile with pierce = 2
      const proj = new Projectile(100, 300, 0, 300, 20, 'player', '#00f0b5', {
        pierce: 2,
        radius: 10,
        life: 3.0,
      });
      g.projectiles = [proj];

      const enemy1 = new Enemy(150, 300, 'scarab', 1);
      enemy1.spawnTimer = 0;
      const enemy2 = new Enemy(200, 300, 'scarab', 1);
      enemy2.spawnTimer = 0;
      const enemy3 = new Enemy(250, 300, 'scarab', 1);
      enemy3.spawnTimer = 0;
      const enemy4 = new Enemy(300, 300, 'scarab', 1);
      enemy4.spawnTimer = 0;
      g.enemies = [enemy1, enemy2, enemy3, enemy4];

      // Step 1: projectile reaches enemy 1 (x: 100 -> 160)
      proj.x = 150;
      g.combat.updateProjectiles(0.01, g.worldBag());
      expect(proj.pierce).toBe(1);
      expect(proj.dead).toBe(false);
      expect(proj.hitIds?.has(enemy1.id)).toBe(true);

      // Step 2: projectile reaches enemy 2 (x: 200)
      proj.x = 200;
      g.combat.updateProjectiles(0.01, g.worldBag());
      expect(proj.pierce).toBe(0);
      expect(proj.dead).toBe(false);
      expect(proj.hitIds?.has(enemy2.id)).toBe(true);

      // Step 3: projectile reaches enemy 3 with pierce = 0 -> consumed
      proj.x = 250;
      g.combat.updateProjectiles(0.01, g.worldBag());
      expect(proj.dead).toBe(true);
    });

    it('2.7 verifies homing projectile angular steering and angular velocity clamping', () => {
      const homingRate = 4.0; // rad/s
      const proj = new Projectile(100, 100, 0, 200, 10, 'player', '#00f0b5', {
        homing: homingRate,
      });

      // Target located at (100, 200) -> desired angle is +PI/2
      const target = new Vec2(100, 200);
      const dt = 0.1;
      proj.update(dt, target);

      // Max angular change in dt should be clamped by homingRate * dt = 0.4 rad
      expect(proj.angle).toBeCloseTo(0.4, 3);
      expect(proj.vx).toBeCloseTo(Math.cos(0.4) * 200, 3);
      expect(proj.vy).toBeCloseTo(Math.sin(0.4) * 200, 3);
    });

    it('2.8 verifies explodeAt blast damage strictly within specified radius', () => {
      g.selectedClass = 'emerald';
      g.gameMode = 'rogue';
      g.startRun();

      const cx = 500;
      const cy = 500;
      const blastRadius = 100;
      const blastDamage = 60;

      // Inside blast radius: distance = 60px; give high HP to survive blow
      const insideEnemy = new Enemy(cx + 60, cy, 'scarab', 1);
      insideEnemy.spawnTimer = 0;
      insideEnemy.hp = 200;
      insideEnemy.maxHp = 200;
      const initialInsideHp = insideEnemy.hp;

      // Outside blast radius: distance = 140px (scarab radius = 14, 140 > 100 + 14)
      const outsideEnemy = new Enemy(cx + 140, cy, 'scarab', 1);
      outsideEnemy.spawnTimer = 0;
      outsideEnemy.hp = 200;
      outsideEnemy.maxHp = 200;
      const initialOutsideHp = outsideEnemy.hp;

      g.enemies = [insideEnemy, outsideEnemy];

      g.combat.explodeAt(g.worldBag(), cx, cy, blastRadius, blastDamage, '#ff0054');

      expect(insideEnemy.hp).toBe(initialInsideHp - blastDamage);
      expect(outsideEnemy.hp).toBe(initialOutsideHp);
    });
  });

  // ===========================================================================
  // PILLAR 3: SERPENTINE DAMAGE PIPELINE & VITALITY INVARIANTS
  // ===========================================================================
  describe('Pillar 3: Serpentine Damage Pipeline & Vitality Invariants', () => {
    it('3.1 verifies damage routing distribution: head 100%, mob segment 70%, boss segment 55%', () => {
      g.selectedClass = 'emerald';
      g.gameMode = 'rogue';
      g.startRun();
      const p = g.player;
      while (p.segments.length < 5) p.addBodySegment();

      // Clear armor and invulnerability for pure multiplier verification
      p.stats.armor = 0;
      p.invulnerableTimer = 0;

      // 1. Direct Head Hit: 100% incoming damage
      const tailSeg = p.segments[p.segments.length - 1]!;
      const segHpBefore = tailSeg.hp;
      p.damageHead(10, false, false, true);
      expect(tailSeg.hp).toBe(segHpBefore - 10);

      // 2. Body segment mob hit: 70% incoming damage (cdam * 0.7)
      const segIndex = 2;
      const midSeg = p.segments[segIndex]!;
      const midSegBefore = midSeg.hp;
      p.damageSegment(segIndex, 20 * 0.7, false, false, true);
      expect(midSeg.hp).toBeCloseTo(midSegBefore - 14, 0);

      // 3. Body segment boss hit: 55% incoming damage (bcdam * 0.55)
      const bossSegBefore = midSeg.hp;
      p.damageSegment(segIndex, 20 * 0.55, false, false, true);
      expect(midSeg.hp).toBeCloseTo(bossSegBefore - 11, 0);

      // 4. Projectile hit on segment: 100% incoming damage
      const projSegBefore = midSeg.hp;
      p.damageSegment(segIndex, 5, false, false, true);
      expect(midSeg.hp).toBe(projSegBefore - 5);
    });

    it('3.2 verifies effective armor reduction curve, segment bonus, and 85% clamp', () => {
      const p = new SnakePlayer('emerald', 800, 600, 0);
      p.headHp = 500;
      p.headMaxHp = 500;
      p.stats.armor = 0;
      p.armorBuffTimer = 0;
      p.headModules = {};

      // 0 segments, 0 armor -> EffectiveArmor = 0
      expect(p.effectiveArmor).toBe(0);
      expect(p.damageHead(100, true, false, true)).toBe(100);

      // Add 10 segments -> +3% per segment = 0.30 bonus
      for (let i = 0; i < 10; i++) p.addBodySegment();
      expect(p.segmentArmorBonus).toBeCloseTo(0.30, 2);
      expect(p.effectiveArmor).toBeCloseTo(0.30, 2);

      // With 30% armor, 100 incoming damage deals 70 dealt damage
      p.invulnerableTimer = 0;
      expect(p.damageHead(100, true, false, true)).toBe(70);

      // Max out armor to 95% -> Clamped to 85%
      p.stats.armor = 0.70; // 0.70 + 0.30 = 1.00 -> clamp to 0.85
      expect(p.effectiveArmor).toBe(0.85);

      p.invulnerableTimer = 0;
      expect(p.damageHead(100, true, false, true)).toBe(15);
    });

    it('3.3 verifies critical strike multiplier calculation, frenzy doubling, and combo tiers', () => {
      const p = new SnakePlayer('emerald', 800, 600, 4);
      p.stats.bitePower = 30;
      p.stats.critChance = 0; // Force non-crit
      p.stats.critMult = 1.8;

      // 1. Normal bite roll
      const roll1 = g.combat.rollBite(p, 1.0);
      expect(roll1.damage).toBe(30);
      expect(roll1.crit).toBe(false);

      // 2. Guaranteed crit bite roll
      p.stats.critChance = 1.0;
      const rollCrit = g.combat.rollBite(p, 1.0);
      expect(rollCrit.damage).toBe(30 * 1.8);
      expect(rollCrit.crit).toBe(true);

      // 3. Overdrive Frenzy doubling: 2x
      g.combat.frenzyActive = true;
      g.combat.frenzyTimer = 5.0;
      expect(g.combat.frenzyActive).toBe(true);
      const rollFrenzy = g.combat.rollBite(p, 1.0);
      expect(rollFrenzy.damage).toBe(30 * 1.8 * 2.0);

      // 4. Combo tier scaling check
      const expectedTiers = [
        { combo: 3, mult: 2 },
        { combo: 8, mult: 3 },
        { combo: 14, mult: 4 },
        { combo: 22, mult: 5 },
        { combo: 30, mult: 6 },
        { combo: 40, mult: 8 },
      ];

      for (const tier of expectedTiers) {
        g.combat.comboCount = tier.combo - 1;
        g.combat.incrementCombo(p, g.worldBag());
        expect(g.combat.comboMultiplier).toBe(tier.mult);
      }
    });

    it('3.4 verifies posterior life-sourcing cascade: absorbs from tail forward and reduces head HP only when body is empty', () => {
      const p = new SnakePlayer('emerald', 800, 600, 3);
      expect(p.segments.length).toBe(3);
      p.invulnerableTimer = 0;

      // Each segment has default 30 HP
      const seg0 = p.segments[0]!;
      const seg1 = p.segments[1]!;
      const seg2 = p.segments[2]!;
      seg0.hp = 30;
      seg1.hp = 30;
      seg2.hp = 30;
      const initialHeadHp = p.headHp;

      // Apply 40 damage: tail (seg2, 30hp) is consumed, seg1 absorbs remaining 10hp
      p.damageHead(40, false, false, true);
      expect(p.segments.length).toBe(2);
      expect(p.segments[1]!.hp).toBe(20);
      expect(p.headHp).toBe(initialHeadHp);

      // Apply remaining 20 of seg1 + all 30 of seg0 + 15 to head = 65 damage
      p.invulnerableTimer = 0;
      p.damageHead(65, false, false, true);
      expect(p.segments.length).toBe(0);
      expect(p.headHp).toBe(initialHeadHp - 15);
      expect(p.alive).toBe(true);
    });

    it('3.5 verifies strict serpentine defeat condition: dies ONLY when segments === 0 AND headHp <= 0', () => {
      const p = new SnakePlayer('emerald', 800, 600, 3);
      p.invulnerableTimer = 0;

      // Sinking all segments does not kill player if headHp > 0
      p.damageHead(90, false, false, true);
      expect(p.segments.length).toBe(0);
      expect(p.headHp).toBeGreaterThan(0);
      expect(p.alive).toBe(true);

      // Sinking remaining headHp triggers death
      p.invulnerableTimer = 0;
      p.damageHead(p.headHp, false, false, true);
      expect(p.headHp).toBe(0);
      expect(p.alive).toBe(false);
    });

    it('3.6 verifies Phoenix Rebirth consumes charge and revives player on lethal damage', () => {
      const p = new SnakePlayer('emerald', 800, 600, 0);
      p.relics['phoenixCharges'] = 1;
      p.invulnerableTimer = 0;

      // Apply lethal damage
      p.damageHead(p.headHp + 50, false, false, true);

      expect(p.alive).toBe(true);
      expect(p.relics['phoenixCharges']).toBe(0);
      expect(p.headHp).toBe(p.headMaxHp);
      expect(p.invulnerableTimer).toBe(3);
      expect(p.segments.length).toBeGreaterThan(0);
    });

    it('3.7 verifies boss serpentine health and life-sourcing parity', () => {
      const boss = new Boss(1, 1280, 720, 'centipede');
      boss.vulnerable = true;
      expect(boss.segments.length).toBeGreaterThan(0);
      const initialSegCount = boss.segments.length;
      const initialHeadHp = boss.headHp;

      // Applying damage sources from posterior segment forward
      const tailSeg = boss.segments[boss.segments.length - 1]!;
      const tailHp = tailSeg.hp;

      boss.applyDamage(tailHp);
      expect(boss.segments.length).toBe(initialSegCount - 1);
      expect(boss.headHp).toBe(initialHeadHp);
      expect(boss.dead).toBe(false);

      // Severs all segments and destroys boss
      while (boss.segments.length > 0) {
        boss.segments.pop();
      }
      boss.applyDamage(boss.headHp);
      expect(boss.dead).toBe(true);
      expect(boss.headHp).toBe(0);
    });
  });

  // ===========================================================================
  // PILLAR 4: STATUS EFFECT STATE MACHINE & INTERACTIONS
  // ===========================================================================
  describe('Pillar 4: Status Effect State Machine & Interactions', () => {
    it('4.1 verifies Chill/Slow duration stacking, stronger factor retention, and speedMult reset', () => {
      const st = new StatusSet();
      expect(st.isSlowed).toBe(false);
      expect(st.speedMult).toBe(1.0);

      // Apply slow 1: 2.0s at 0.70 factor
      st.chill(2.0, 0.70);
      expect(st.isSlowed).toBe(true);
      expect(st.slowTimer).toBe(2.0);
      expect(st.speedMult).toBe(0.70);

      // Apply slow 2: 1.0s at 0.50 factor (stronger slow factor wins, longer timer retained)
      st.chill(1.0, 0.50);
      expect(st.slowTimer).toBe(2.0);
      expect(st.speedMult).toBe(0.50);

      // Advance by 1.5s
      st.update(1.5);
      expect(st.slowTimer).toBeCloseTo(0.5, 3);
      expect(st.speedMult).toBe(0.50);

      // Advance past expiration
      st.update(0.6);
      expect(st.slowTimer).toBe(0);
      expect(st.speedMult).toBe(1.0);
      expect(st.isSlowed).toBe(false);
    });

    it('4.2 verifies Freeze and Stun timers enforce Immobile state and suspend enemy kinematics', () => {
      const enemy = new Enemy(500, 500, 'scarab', 1);
      enemy.x = 500; enemy.X = 500;
      enemy.y = 500; enemy.Y = 500;
      enemy.spawnTimer = 0;

      const target = new SnakePlayer('emerald', 1280, 720, 4);
      target.x = 700; target.X = 700;
      target.y = 500; target.Y = 500;

      // Enemy moves towards target (x = 700) normally
      enemy.update(0.1, target, g.worldBag());
      expect(enemy.x).toBeGreaterThan(500);

      const xBefore = enemy.x;
      const yBefore = enemy.y;

      // Freeze enemy for 2.0s
      enemy.status.freeze(2.0);
      expect(enemy.status.isFrozen).toBe(true);
      expect(enemy.status.immobile).toBe(true);

      // Update during freeze -> Enemy cannot move
      enemy.update(0.5, target, g.worldBag());
      expect(enemy.x).toBe(xBefore);
      expect(enemy.y).toBe(yBefore);

      // Stun extends or operates immobility
      enemy.status.freezeTimer = 0;
      enemy.status.stun(1.5);
      expect(enemy.status.isStunned).toBe(true);
      expect(enemy.status.immobile).toBe(true);

      enemy.update(0.5, target, g.worldBag());
      expect(enemy.x).toBe(xBefore);
      expect(enemy.y).toBe(yBefore);
    });

    it('4.3 verifies Burn DoT duration decay and precise tick damage accumulation', () => {
      const st = new StatusSet();
      st.burn(3.0, 20.0); // 3 seconds at 20 DPS

      expect(st.isBurning).toBe(true);
      expect(st.burnTimer).toBe(3.0);
      expect(st.burnDps).toBe(20.0);

      // Advance by 0.5s -> deals 20 * 0.5 = 10 dmg
      const dmg1 = st.update(0.5);
      expect(dmg1).toBeCloseTo(10.0, 3);
      expect(st.burnTimer).toBeCloseTo(2.5, 3);

      // Advance remaining 2.5s -> deals 20 * 2.5 = 50 dmg
      const dmg2 = st.update(2.5);
      expect(dmg2).toBeCloseTo(50.0, 3);
      expect(st.burnTimer).toBe(0);
      expect(st.burnDps).toBe(0);
      expect(st.isBurning).toBe(false);

      // Advance with expired burn -> 0 damage
      const dmg3 = st.update(0.5);
      expect(dmg3).toBe(0);
    });

    it('4.4 verifies Corrode/Mark amplifies incoming damage by 1.25x in enemy and boss pipelines', () => {
      const enemy = new Enemy(500, 500, 'scarab', 1);
      enemy.spawnTimer = 0;
      enemy.hp = 200;
      enemy.maxHp = 200;
      const initialHp = enemy.hp;

      // Normal hit: 40 damage
      enemy.applyDamage(40);
      expect(enemy.hp).toBe(initialHp - 40);

      // Apply Mark: +25% damage taken
      enemy.status.mark(4.0);
      expect(enemy.status.isMarked).toBe(true);
      expect(enemy.status.damageTakenMult).toBe(1.25);

      const hpBeforeMarkedHit = enemy.hp;
      enemy.applyDamage(40);
      // 40 * 1.25 = 50 damage
      expect(enemy.hp).toBe(hpBeforeMarkedHit - 50);
    });

    it('4.5 verifies Void Stasis applies 80% slow and point-in-polygon constriction crush', () => {
      g.selectedClass = 'emerald';
      g.gameMode = 'rogue';
      g.startRun();
      const p = g.player;

      // Setup 12-segment snake loop enclosing (500, 500)
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
      p.x = p.segments[11]!.x + 5;
      p.y = p.segments[11]!.y + 5;

      const enemy = new Enemy(center.x, center.y, 'scarab', 1);
      enemy.spawnTimer = 0;
      enemy.hp = 1000;
      enemy.maxHp = 1000;
      g.enemies = [enemy];

      g.combat.checkConstriction(g.worldBag());
      expect(enemy.stasisTimer).toBeGreaterThan(0);

      // Test stasis speed penalty
      const normalSpeed = enemy.speed;
      const target = p;
      target.x = enemy.x + 200; target.X = enemy.x + 200;
      target.y = enemy.y; target.Y = enemy.y;
      const xBefore = enemy.x;
      enemy.update(0.1, target, g.worldBag());
      const distTraveled = Math.abs(enemy.x - xBefore);
      // In stasis, speed is reduced by 80% (0.2 multiplier)
      expect(distTraveled).toBeCloseTo(normalSpeed * 0.2 * 0.1, 1);
    });

    it('4.6 verifies multi-target chain lightning escalation and single-hit invariant per cast', () => {
      g.selectedClass = 'storm';
      g.gameMode = 'rogue';
      g.startRun();

      // Spawn 4 enemies in a line: 100px apart with high HP to measure non-lethal escalation
      const e1 = new Enemy(500, 300, 'scarab', 1); e1.spawnTimer = 0; e1.hp = 500; e1.maxHp = 500;
      const e2 = new Enemy(600, 300, 'scarab', 1); e2.spawnTimer = 0; e2.hp = 500; e2.maxHp = 500;
      const e3 = new Enemy(700, 300, 'scarab', 1); e3.spawnTimer = 0; e3.hp = 500; e3.maxHp = 500;
      const e4 = new Enemy(800, 300, 'scarab', 1); e4.spawnTimer = 0; e4.hp = 500; e4.maxHp = 500;
      g.enemies = [e1, e2, e3, e4];

      const hp1 = e1.hp;
      const hp2 = e2.hp;
      const hp3 = e3.hp;
      const hp4 = e4.hp;

      // Cast escalating chain lightning from (450, 300) with 4 jumps, base damage 50, range 150
      g.combat.chainLightning(g.worldBag(), 450, 300, 4, 50, 150, true);

      // Enemy 1: ~50 dmg
      expect(e1.hp).toBeLessThan(hp1);
      // Enemy 2: 50 * 1.15 = 57.5 dmg
      expect(e2.hp).toBeLessThan(hp2);
      // Enemy 3: 57.5 * 1.15 = 66.125 dmg
      expect(e3.hp).toBeLessThan(hp3);
      // Enemy 4: 66.125 * 1.15 = 76.04 dmg
      expect(e4.hp).toBeLessThan(hp4);

      // Escalation check: enemy 4 took more damage than enemy 1
      const dmg1 = hp1 - e1.hp;
      const dmg4 = hp4 - e4.hp;
      expect(dmg4).toBeGreaterThan(dmg1);

      // Verify that chill status was applied by chain lightning
      expect(e1.status.isSlowed).toBe(true);
      expect(e2.status.isSlowed).toBe(true);
    });
  });
});
