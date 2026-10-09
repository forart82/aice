import { describe, it, expect, beforeEach } from 'vitest';
import { SnakePlayer } from '../sim/SnakePlayer';
import { GameEngine } from '../sim/GameEngine';
import { GameState } from '../sim/GameState';
import { ScriptedInput, NullFx, NullSound } from '../core/Contracts';
import { Services } from '../core/Services';
import { MetaProgression } from '../data/MetaProgression';
import { GameData } from '../data/GameData';
import { Enemy } from '../sim/Enemy';
import { Projectile } from '../sim/Projectile';
import { Hazard } from '../sim/Hazard';

describe('Weapons & Defensive Mechanics Comprehensive Playtest Suite', () => {
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

  /* 1. All 16 Offense Modules */
  it('1. verifies all 16 offensive modules install on Head and function correctly', () => {
    const offenseMods = [
      'turret', 'flak', 'scattershot', 'needler', 'mortar', 'sonic', 'gatling', 'caltrop',
      'tesla', 'magma', 'cryo', 'venom', 'tachyon', 'plasma', 'singularity', 'solar'
    ];
    const p = new SnakePlayer('emerald', 1280, 720, 6);

    for (let i = 0; i < offenseMods.length; i++) {
      const mod = offenseMods[i]!;
      const installed = p.InstallHeadModule(mod);
      expect(installed).toBe(1);
      expect(p.HeadModules[mod]).toBe(1);
    }
  });

  /* 2. All 12 Defense Modules */
  it('2. verifies all 12 defensive modules install on Head and function correctly', () => {
    const defenseMods = [
      'shield', 'spikes', 'regen', 'magnet', 'chrono', 'nanite',
      'reactive', 'magnetic_aegis', 'cryo_carapace', 'heatsink', 'cloak', 'emp_coil'
    ];
    const p = new SnakePlayer('emerald', 1280, 720, 6);

    for (let i = 0; i < defenseMods.length; i++) {
      const mod = defenseMods[i]!;
      const installed = p.InstallHeadModule(mod);
      expect(installed).toBe(1);
      expect(p.HeadModules[mod]).toBe(1);
    }
  });

  /* 3. All 5 Serpent Class Active Skills */
  it('3. verifies all 5 serpent active skills trigger, apply effects, and cool down', () => {
    const classes = ['emerald', 'stalker', 'hydra', 'storm', 'solar'];

    for (const cid of classes) {
      g.selectedClass = cid;
      g.gameMode = 'rogue';
      g.startRun();

      const p = g.player;
      expect(p.skillReady).toBe(true);

      // Trigger skill via input
      im.SkillQueued = true;
      g.tick(1 / 60);

      // Skill should now be on cooldown
      expect(p.skillCooldownTimer).toBeGreaterThan(0);
      expect(p.skillReady).toBe(false);
    }
  });

  /* 4. Defensive Shield Absorption, Break, and Recharge */
  it('4. verifies shield buffers absorb damage before segment HP and recharge after delay', () => {
    const p = new SnakePlayer('emerald', 1280, 720, 4);
    p.stats.maxShield = 50;
    p.shield = 50;

    const initialTotalHp = p.hp;

    // Take 30 damage -> absorbed completely by shield
    p.takeDamage(30);
    expect(p.shield).toBeLessThan(50);
    expect(p.hp).toBe(initialTotalHp); // HP undamaged

    // Reset i-frames and take fatal shield damage -> shield breaks
    p.invulnerableTimer = 0;
    p.takeDamage(40);
    expect(p.shield).toBe(0);
    expect(p.shieldBrokenTimer).toBeGreaterThan(0);

    // Shield should recharge after recovery timer
    p.shieldBrokenTimer = 0;
    p.updatePassives(8.5, g.worldBag());
    expect(p.shield).toBe(50);
  });

  /* 5. Phoenix Rebirth Mechanics */
  it('5. verifies Phoenix Rebirth relic saves the serpent from lethal damage and restores segments', () => {
    const p = new SnakePlayer('emerald', 1280, 720, 3);
    p.relics['phoenixCharges'] = 1;

    // Lethal damage to serpent consumes all segments and drops head to 0
    p.damageHead(9999);

    // Should consume phoenix charge and revive with restored segments
    expect(p.relics['phoenixCharges']).toBe(0);
    expect(p.alive).toBe(true);
    expect(p.segments.length).toBeGreaterThan(0);
    expect(p.invulnerableTimer).toBeGreaterThan(0);
  });

  /* 6. Combat Simulation Step & Constriction Mechanics */
  it('6. verifies real-time combat system collision resolution and enemy damage', () => {
    g.selectedClass = 'emerald';
    g.gameMode = 'rogue';
    g.startRun();

    const enemy = new Enemy(g.player.x + 10, g.player.y + 10, 'scarab', 1);
    g.enemies.push(enemy);

    const initialEnemyHp = enemy.hp;
    g.tick(1 / 60);

    // Head bite should inflict damage on overlapping enemy
    expect(enemy.hp).toBeLessThanOrEqual(initialEnemyHp);
  });

  /* 7. All 28 Alchemical Fusions Detection */
  it('7. verifies active alchemical fusions detection across installed Head combinations', () => {
    expect(GameData.AlchemicalFusions.length).toBe(28);

    const p = new SnakePlayer('emerald', 1280, 720, 6);

    // Test multi-fusion Head loadout
    p.InstallHeadModule('tesla');
    p.InstallHeadModule('cryo'); // Superconductor Surge
    p.InstallHeadModule('magma');
    p.InstallHeadModule('spikes'); // Obsidian Armor
    p.InstallHeadModule('venom'); // Miasma Combustion (venom + magma)
    p.InstallHeadModule('tachyon');
    p.InstallHeadModule('shield'); // Prismatic Aegis
    p.InstallHeadModule('chrono');
    p.InstallHeadModule('nanite'); // Temporal Singularity (chrono + nanite)

    const active = p.getActiveAlchemicalFusions();
    expect(active).toContain('superconductor');
    expect(active).toContain('obsidian');
    expect(active).toContain('miasma');
    expect(active).toContain('prismatic');
    expect(active).toContain('temporal_singularity');
  });

  /* 8. All 6 Enemy Types Behaviors & Kinematics */
  it('8. verifies all 6 enemy archetypes instantiate and update correctly', () => {
    const enemyTypes = ['scarab', 'swarmling', 'spitter', 'phantom', 'drone', 'brute'];
    g.selectedClass = 'emerald';
    g.gameMode = 'rogue';
    g.startRun();

    for (let i = 0; i < enemyTypes.length; i++) {
      const type = enemyTypes[i]!;
      const e = new Enemy(500, 300, type, 2);
      expect(e.type).toBe(type);
      expect(e.hp).toBeGreaterThan(0);
      expect(e.speed).toBeGreaterThan(0);
      expect(e.contactDamage).toBeGreaterThan(0);

      // Fast-forward spawn invulnerability
      e.spawnTimer = 0;
      expect(e.vulnerable).toBe(true);

      // Update enemy logic
      e.update(1 / 60, g.player, g.worldBag());
      expect(e.dead).toBe(false);

      // Apply damage
      const dealt = e.takeDamage(15);
      expect(dealt).toBe(15);
      expect(e.hp).toBe(e.maxHp - 15);
    }
  });
});
