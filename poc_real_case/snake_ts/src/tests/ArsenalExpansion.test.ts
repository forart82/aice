import { describe, it, expect, beforeEach } from 'vitest';
import { SnakePlayer } from '../sim/SnakePlayer';
import { GameEngine } from '../sim/GameEngine';
import { ScriptedInput, NullFx, NullSound } from '../core/Contracts';
import { Services } from '../core/Services';
import { MetaProgression } from '../data/MetaProgression';
import { GameData } from '../data/GameData';
import { Enemy } from '../sim/Enemy';
import { Projectile } from '../sim/Projectile';
import { FoodItem } from '../sim/FoodItem';

describe('Arsenal Expansion (16 Weapons & 12 Defenses) Test Suite', () => {
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

  it('1. registers all 16 modular weapons and 12 defensive systems in GameData (28 total modules)', () => {
    const modules = GameData.SocketModules;
    expect(modules.Count).toBe(28);

    const offenses = modules.Values.filter(m => m.Category === 'offense');
    const defenses = modules.Values.filter(m => m.Category === 'defense');

    expect(offenses.length).toBe(16);
    expect(defenses.length).toBe(12);

    // All 16 modular weapons
    const expectedWeapons = [
      'turret', 'flak', 'scattershot', 'needler', 'mortar', 'sonic', 'gatling', 'caltrop',
      'tesla', 'magma', 'cryo', 'venom', 'tachyon', 'plasma', 'singularity', 'solar'
    ];
    for (const w of expectedWeapons) {
      expect(modules.Has(w)).toBe(true);
      expect(SnakePlayer.isOffenseModule(w)).toBe(true);
      expect(SnakePlayer.isDefenseModule(w)).toBe(false);
    }

    // All 12 defensive systems
    const expectedDefenses = [
      'shield', 'spikes', 'regen', 'magnet', 'chrono', 'nanite',
      'reactive', 'magnetic_aegis', 'cryo_carapace', 'heatsink', 'cloak', 'emp_coil'
    ];
    for (const d of expectedDefenses) {
      expect(modules.Has(d)).toBe(true);
      expect(SnakePlayer.isDefenseModule(d)).toBe(true);
      expect(SnakePlayer.isOffenseModule(d)).toBe(false);
    }
  });

  it('2. allows installing kinetic and elemental weapons on the Serpent Head command center', () => {
    const p = new SnakePlayer('emerald', 1280, 720, 6);

    const weapons = [
      'turret', 'flak', 'scattershot', 'needler', 'mortar', 'sonic', 'gatling', 'caltrop',
      'tesla', 'magma', 'cryo', 'venom', 'tachyon', 'plasma', 'singularity', 'solar'
    ];

    for (const w of weapons) {
      expect(p.InstallHeadModule(w)).toBe(1);
      expect(p.HeadModules[w]).toBe(1);
    }
    expect(p.HeadPurchaseCount).toBe(16);
  });

  it('3. allows installing all 12 defensive systems on the Serpent Head and validates shield/plating triggers', () => {
    const p = new SnakePlayer('emerald', 1280, 720, 6);

    const defenses = [
      'shield', 'spikes', 'regen', 'magnet', 'chrono', 'nanite',
      'reactive', 'magnetic_aegis', 'cryo_carapace', 'heatsink', 'cloak', 'emp_coil'
    ];

    for (const d of defenses) {
      expect(p.InstallHeadModule(d)).toBe(1);
      expect(p.HeadModules[d]).toBe(1);
    }

    // Spikes adds armor bonus on Head
    expect(p.effectiveArmor).toBeGreaterThan(p.stats.armor);
    // Shield increases shield capacity
    expect(p.Stats.MaxShield).toBeGreaterThan(0);
  });

  it('4. executes weapons firing and defensive triggers in real-time 120Hz simulation from Head arsenal', () => {
    g.selectedClass = 'emerald';
    g.gameMode = 'rogue';
    g.startRun();

    const p = g.player;
    p.addGrowth(8);

    // Install diverse kinetic & elemental weapons on Head
    p.InstallHeadModule('flak');
    p.InstallHeadModule('scattershot');
    p.InstallHeadModule('needler');
    p.InstallHeadModule('mortar');
    p.InstallHeadModule('gatling');
    p.InstallHeadModule('sonic');
    p.InstallHeadModule('caltrop');
    p.InstallHeadModule('singularity');
    p.InstallHeadModule('solar');
    p.InstallHeadModule('tachyon');

    // Install defense modules on Head
    p.InstallHeadModule('shield');
    p.InstallHeadModule('magnet');
    p.InstallHeadModule('heatsink');
    p.InstallHeadModule('emp_coil');

    // Spawn enemies around snake
    const enemy1 = new Enemy(p.x + 80, p.y + 20, 'scarab', 1);
    const enemy2 = new Enemy(p.x - 80, p.y + 40, 'swarmling', 1);
    g.enemies.push(enemy1, enemy2);

    // Spawn enemy projectile to test emp_coil
    g.projectiles.push(new Projectile(p.x + 30, p.y + 30, 0, 100, 10, 'enemy', '#ff0000'));

    // Spawn apple near head to test solar cooking
    const apple = new FoodItem(p.x + 10, p.y + 10, 'apple');
    g.foods.push(apple);

    // Tick for 2.5 seconds (300 frames)
    for (let i = 0; i < 300; i++) {
      g.tick(1 / 120);
    }

    expect(p.alive).toBe(true);
    // Projectiles or hazards were generated
    expect(g.projectiles.length + g.hazards.length).toBeGreaterThan(0);
  });
});
