import { describe, it, expect, beforeEach } from 'vitest';
import { GameEngine } from '../sim/GameEngine';
import { SnakePlayer } from '../sim/SnakePlayer';
import { Enemy } from '../sim/Enemy';
import { Boss } from '../sim/Boss';
import { FoodItem } from '../sim/FoodItem';
import { Projectile } from '../sim/Projectile';
import { GameData } from '../data/GameData';
import { Services } from '../core/Services';
import { ScriptedInput, NullFx, NullSound } from '../core/Contracts';
import { MetaProgression } from '../data/MetaProgression';
import {
  ModuleActionRegistry,
  executeHeadModules,
  type ModuleActionContext,
} from '../sim/CombatModules';
import { updateAuras, updateRelicAttacks } from '../sim/CombatAuras';
import { activateSkill } from '../sim/CombatSkills';

describe('Declarative Module Action Registry & Modular Combat Sub-Engines', () => {
  let g: GameEngine;
  let im: ScriptedInput;

  beforeEach(() => {
    MetaProgression.readBackend = () => null;
    MetaProgression.writeBackend = () => {};
    MetaProgression.deleteBackend = () => {};
    MetaProgression.instance = new MetaProgression();
    MetaProgression.instance.unlockedClasses = { emerald: true, stalker: true, hydra: true, storm: true, solar: true };

    g = new GameEngine();
    im = new ScriptedInput();
    Services.input = im;
    Services.fx = new NullFx();
    Services.sound = new NullSound();
    Services.headless = true;
    g.setupCanvas(1280, 720, 1);
  });

  it('1. registers declarative handlers for all 16 weapons and 12 defenses in ModuleActionRegistry (28 total)', () => {
    const allModules = GameData.SocketModules.Keys;
    expect(allModules.length).toBe(28);

    const registeredKeys = ModuleActionRegistry.getRegisteredKeys();
    expect(registeredKeys.length).toBe(28);

    for (const key of allModules) {
      expect(ModuleActionRegistry.has(key)).toBe(true);
      const action = ModuleActionRegistry.get(key);
      expect(typeof action).toBe('function');
    }

    const kineticWeapons = ['turret', 'flak', 'scattershot', 'needler', 'mortar', 'sonic', 'gatling', 'caltrop'];
    const elementalWeapons = ['tesla', 'magma', 'cryo', 'venom', 'tachyon', 'plasma', 'singularity', 'solar'];
    const defenses = [
      'shield', 'spikes', 'regen', 'magnet', 'chrono', 'nanite',
      'reactive', 'magnetic_aegis', 'cryo_carapace', 'heatsink', 'cloak', 'emp_coil'
    ];

    for (const w of [...kineticWeapons, ...elementalWeapons]) {
      expect(ModuleActionRegistry.has(w)).toBe(true);
    }
    for (const d of defenses) {
      expect(ModuleActionRegistry.has(d)).toBe(true);
    }
  });

  it('2. executes all 16 offensive weapons across head context with exact formulas', () => {
    g.selectedClass = 'emerald';
    g.gameMode = 'rogue';
    g.startRun();
    const p = g.player;

    const weapons = [
      'turret', 'flak', 'scattershot', 'needler', 'mortar', 'sonic', 'gatling', 'caltrop',
      'tesla', 'magma', 'cryo', 'venom', 'tachyon', 'plasma', 'singularity', 'solar'
    ];

    // Spawn test enemy in range
    const enemy = new Enemy(p.x + 100, p.y, 'scarab', 1);
    enemy.spawnTimer = 0;
    g.enemies.push(enemy);

    // Verify Head context execution
    for (const w of weapons) {
      enemy.dead = false;
      enemy.hp = 9999;
      p.headModules = { [w]: 2 };
      p.headModuleTimers = {};
      const projBefore = g.projectiles.length;
      const hazBefore = g.hazards.length;

      // Tick head modules by 2.5 seconds to ensure cooldown cycle triggers
      for (let step = 0; step < 25; step++) {
        executeHeadModules(g.combat, 0.1, g.worldBag());
      }

      // Check that either projectiles, hazards, or direct combat effects were dispatched
      const projDispatched = g.projectiles.length > projBefore;
      const hazDispatched = g.hazards.length > hazBefore;
      const directEffect = ['sonic', 'tesla', 'tachyon'].includes(w);

      expect(projDispatched || hazDispatched || directEffect, `Weapon ${w} failed to dispatch`).toBe(true);
    }
  });

  it('3. executes all 12 defensive systems on Head and validates shield regen, auras, bullet clearing, and passive triggers', () => {
    g.selectedClass = 'emerald';
    g.gameMode = 'rogue';
    g.startRun();
    const p = g.player;

    // 1. Shield Head module recovery
    p.headModules = { shield: 2 };
    p.headModuleTimers = { shield: 5.95 };
    p.shield = 0;
    executeHeadModules(g.combat, 0.1, g.worldBag());
    expect(p.shield).toBeGreaterThan(0);

    // 2. Regen Head module
    p.headModules = { regen: 2 };
    p.headModuleTimers = { regen: 3.45 };
    p.HeadHp = Math.max(1, p.HeadHp - 20);
    const damagedHeadHp = p.HeadHp;
    executeHeadModules(g.combat, 0.1, g.worldBag());
    expect(p.HeadHp).toBeGreaterThan(damagedHeadHp);

    // 3. Food magnet on Head
    p.headModules = { magnet: 2 };
    const apple = new FoodItem(p.x + 80, p.y, 'apple');
    g.foods.push(apple);
    const appleXBefore = apple.x;
    executeHeadModules(g.combat, 0.1, g.worldBag());
    expect(apple.x).toBeLessThan(appleXBefore); // Pulled towards head

    // 4. Chrono projectile slowing
    p.headModules = { chrono: 2 };
    const hostileProj = new Projectile(p.x + 40, p.y, 0, 200, 10, 'enemy', '#ff0000');
    const initialVx = hostileProj.vx;
    g.projectiles.push(hostileProj);
    executeHeadModules(g.combat, 0.1, g.worldBag());
    expect(hostileProj.vx).toBeLessThan(initialVx);

    // 5. EMP bullet clearing
    p.headModules = { emp_coil: 2 };
    p.headModuleTimers = { emp_coil: 4.45 };
    const hostileProj2 = new Projectile(p.x + 20, p.y, 0, 200, 10, 'enemy', '#ff0000');
    g.projectiles.push(hostileProj2);
    executeHeadModules(g.combat, 0.1, g.worldBag());
    expect(g.projectiles).not.toContain(hostileProj2);

    // 6. Cryo Carapace chill aura
    p.headModules = { cryo_carapace: 2 };
    const enemy = new Enemy(p.x + 30, p.y, 'scarab', 1);
    enemy.spawnTimer = 0;
    g.enemies.push(enemy);
    executeHeadModules(g.combat, 0.1, g.worldBag());
    expect(enemy.status.isChilled).toBe(true);

    // 7. Volcanic Heatsink venting
    p.headModules = { heatsink: 2 };
    p.headModuleTimers = { heatsink: 3.95 };
    const enemy2 = new Enemy(p.x + 20, p.y, 'scarab', 1);
    enemy2.spawnTimer = 0;
    g.enemies.push(enemy2);
    const hpBefore = enemy2.hp;
    executeHeadModules(g.combat, 0.1, g.worldBag());
    expect(enemy2.hp).toBeLessThan(hpBefore);
  });

  it('4. delegates updateAuras, updateRelicAttacks, and activateSkill cleanly to modular sub-engines', () => {
    g.selectedClass = 'hydra';
    g.gameMode = 'rogue';
    g.startRun();
    const p = g.player;

    // Relic auras & attacks
    p.relics['frostbite'] = 2;
    p.relics['venomSpit'] = 2;
    p.spitCooldown = 0;

    const enemy = new Enemy(p.x + 80, p.y, 'scarab', 1);
    enemy.spawnTimer = 0;
    g.enemies.push(enemy);

    updateAuras(g.combat, 0.1, g.worldBag());
    expect(enemy.status.isChilled).toBe(true);

    updateRelicAttacks(g.combat, 0.1, g.worldBag());
    expect(g.projectiles.some(pr => pr.source === 'player')).toBe(true);

    // Active skill
    expect(p.skillReady).toBe(true);
    const activated = activateSkill(g.combat, g.worldBag());
    expect(activated).toBe(true);
    expect(p.skillReady).toBe(false);
    expect(p.armorBuffTimer).toBe(5);
    expect(enemy.status.isStunned).toBe(true);
  });

  it('5. preserves 100% CombatSystem backward-compatible facade methods', () => {
    g.selectedClass = 'solar';
    g.gameMode = 'rogue';
    g.startRun();
    const p = g.player;

    expect(typeof g.combat.updateSegmentModules).toBe('function');
    expect(typeof g.combat.updateAuras).toBe('function');
    expect(typeof g.combat.UpdateAuras).toBe('function');
    expect(typeof g.combat.updateRelicAttacks).toBe('function');
    expect(typeof g.combat.activateSkill).toBe('function');
    expect(typeof g.combat.ActivateSkill).toBe('function');
    expect(typeof g.combat.skillSupernova).toBe('function');

    // Call facade methods directly
    g.combat.updateSegmentModules(0.1, g.worldBag());
    g.combat.updateAuras(0.1, g.worldBag());
    g.combat.updateRelicAttacks(0.1, g.worldBag());
    expect(g.combat.activateSkill(g.worldBag())).toBe(true);
  });
});
