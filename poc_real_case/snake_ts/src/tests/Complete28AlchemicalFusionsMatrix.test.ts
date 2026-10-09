import { describe, it, expect, beforeEach } from 'vitest';
import { SnakePlayer } from '../sim/SnakePlayer';
import { GameData } from '../data/GameData';
import { MetaProgression } from '../data/MetaProgression';

describe('Complete 28 Alchemical Fusions Trigger Matrix Suite', () => {
  beforeEach(() => {
    MetaProgression.readBackend = () => null;
    MetaProgression.writeBackend = () => {};
    MetaProgression.deleteBackend = () => {};
    MetaProgression.instance = new MetaProgression();
  });

  it('verifies exact count of 28 unique alchemical fusions in GameData', () => {
    expect(GameData.AlchemicalFusions.length).toBe(28);
    const idSet = new Set(GameData.AlchemicalFusions.map(f => f.Id));
    expect(idSet.size).toBe(28);
  });

  for (let i = 0; i < GameData.AlchemicalFusions.length; i++) {
    const fusion = GameData.AlchemicalFusions[i]!;
    it(`evaluates Fusion #${i + 1} [${fusion.Id}]: ${fusion.Name} (${fusion.ModuleA} + ${fusion.ModuleB})`, () => {
      const player = new SnakePlayer('emerald', 800, 600, 4);

      // 1. Inactive with 0 modules
      expect(player.GetActiveAlchemicalFusions()).not.toContain(fusion.Id);

      // 2. Inactive with only Module A
      player.InstallHeadModule(fusion.ModuleA);
      expect(player.GetActiveAlchemicalFusions()).not.toContain(fusion.Id);

      // 3. Active with Module A + Module B
      player.InstallHeadModule(fusion.ModuleB);
      expect(player.GetActiveAlchemicalFusions()).toContain(fusion.Id);

      // 4. Inactive when Module A is removed
      player.UninstallHeadModule(fusion.ModuleA);
      expect(player.GetActiveAlchemicalFusions()).not.toContain(fusion.Id);

      // 5. Active with reversed installation order (Module B then Module A)
      player.InstallHeadModule(fusion.ModuleA);
      expect(player.GetActiveAlchemicalFusions()).toContain(fusion.Id);
    });
  }

  it('synthesizes 12 simultaneous alchemical fusions when 6 modules are equipped', () => {
    const player = new SnakePlayer('emerald', 800, 600, 6);
    player.InstallHeadModule('tesla');
    player.InstallHeadModule('cryo');
    player.InstallHeadModule('magma');
    player.InstallHeadModule('spikes');
    player.InstallHeadModule('tachyon');
    player.InstallHeadModule('shield');

    const active = player.GetActiveAlchemicalFusions();
    expect(active).toContain('superconductor');
    expect(active).toContain('obsidian');
    expect(active).toContain('sublimation_shock');
    expect(active).toContain('prismatic');
    expect(active).toContain('tachyon_overcharge');
    expect(active).toContain('kinetic_bastion');
    expect(active).toContain('cryo_barrier');
    expect(active).toContain('volcanic_bulwark');
    expect(active).toContain('electrified_hull');
    expect(active).toContain('thermal_ray');
    expect(active).toContain('cryo_tachyon');
    expect(active).toContain('photon_mirror');
    expect(active.length).toBe(12);
  });
});
