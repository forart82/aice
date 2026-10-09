import { describe, it, expect, beforeEach } from 'vitest';
import { Boss } from '../sim/Boss';
import { SnakePlayer } from '../sim/SnakePlayer';
import { GameEngine } from '../sim/GameEngine';
import { ScriptedInput, NullFx, NullSound } from '../core/Contracts';
import { Services } from '../core/Services';
import { MetaProgression } from '../data/MetaProgression';
import { GameData } from '../data/GameData';

describe('8 Apex Boss Guardians Test Suite', () => {
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

  it('1. registers all 8 apex boss guardians in GameData with appropriate stats and titles', () => {
    expect(GameData.Bosses.length).toBe(20);

    const expectedBosses = [
      { type: 'centipede', name: 'Centipede Behemoth' },
      { type: 'gorgon', name: 'Storm Gorgon' },
      { type: 'colossus', name: 'Infernal Colossus' },
      { type: 'frostwyrm', name: 'Glacial Behemoth' },
      { type: 'chronowyrm', name: 'Chrono Wyrm' },
      { type: 'hivemind', name: 'Bio-Venom Hivemind' },
      { type: 'superconductor_boss', name: 'Apex Superconductor' },
      { type: 'leviathan', name: 'Astral Leviathan' },
    ];

    for (let i = 0; i < expectedBosses.length; i++) {
      const b = GameData.Bosses[i]!;
      expect(b.Type).toBe(expectedBosses[i]!.type);
      expect(b.Name).toBe(expectedBosses[i]!.name);
      expect(b.BaseHp).toBeGreaterThanOrEqual(450);
      expect(b.HpPerFloor).toBeGreaterThanOrEqual(180);
      expect(b.Radius).toBeGreaterThanOrEqual(30);
    }
  });

  it('2. instantiates each of the 8 boss archetypes with appropriate health scaling and behaviors', () => {
    for (let f = 1; f <= 8; f++) {
      const boss = new Boss(f, 1280, 720);
      expect(boss.maxHp).toBeGreaterThanOrEqual(450);
      expect(boss.hp).toBe(boss.maxHp);
      expect(boss.phase).toBe(1);
      expect(boss.dead).toBe(false);
      expect(boss.vulnerable).toBe(false); // during entrance
      boss.entranceTimer = 0;
      expect(boss.vulnerable).toBe(true);

      // Floor 1 Centipede has multi-segment body
      if (boss.type === 'centipede') {
        expect(boss.parts().length).toBeGreaterThan(10);
      }
    }
  });

  it('3. transitions all 8 bosses to Phase 2 at 50% HP and triggers attack escalation', () => {
    for (let f = 1; f <= 8; f++) {
      const boss = new Boss(f, 1280, 720);
      boss.entranceTimer = 0;

      expect(boss.phase).toBe(1);
      // Deal 55% damage
      const killed = boss.applyDamage(boss.maxHp * 0.55);
      expect(killed).toBe(false);
      expect(boss.phase).toBe(2);
      expect(boss.onPhaseChange).toBe(true);
      expect(boss.attackTimer).toBeLessThanOrEqual(1.0);
    }
  });

  it('4. executes 120Hz fixed updates for all 8 bosses and generates unique projectiles & hazards', () => {
    g.selectedClass = 'emerald';
    g.gameMode = 'rogue';
    g.startRun();

    for (let f = 1; f <= 8; f++) {
      const boss = new Boss(f, 1280, 720);
      boss.entranceTimer = 0;
      g.boss = boss;
      g.projectiles.length = 0;
      g.hazards.length = 0;

      // Put boss in Phase 2
      boss.applyDamage(boss.maxHp * 0.55);
      boss.attackTimer = 0; // Force immediate attack trigger

      // Simulate 120 ticks (1 second)
      for (let t = 0; t < 120; t++) {
        boss.update(1 / 120, g.player, g.worldBag());
      }

      expect(boss.dead).toBe(false);
      // Boss generated attacks
      expect(g.projectiles.length + g.hazards.length).toBeGreaterThan(0);
    }
  });
});
