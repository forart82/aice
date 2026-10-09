import { describe, it, expect, beforeEach } from 'vitest';
import { MetaProgression } from '../data/MetaProgression';
import { Services } from '../core/Services';
import { NullFx, NullSound } from '../core/Contracts';

describe('Diverse Mixed-Up Single Challenges & 20-Floor Progression Test Suite', () => {
  let meta: MetaProgression;

  beforeEach(() => {
    Services.Sound = new NullSound();
    Services.Fx = new NullFx();
    MetaProgression.ReadBackend = () => null;
    MetaProgression.WriteBackend = () => {};
    MetaProgression.DeleteBackend = () => {};
    MetaProgression.Instance = new MetaProgression();
    meta = MetaProgression.Instance;
  });

  describe('1. Starter Defaults & Tier 1 Early Challenges (Floors 1–5)', () => {
    it('guarantees starter default modules are unlocked at Tier 1 with no challenge condition (turret and shield only)', () => {
      expect(meta.IsTierUnlocked('turret', 1)).toBe(true);
      expect(meta.IsTierUnlocked('shield', 1)).toBe(true);

      // Newly locked items
      expect(meta.IsTierUnlocked('tesla', 1)).toBe(false);
      expect(meta.IsTierUnlocked('venom', 1)).toBe(false);
      expect(meta.IsTierUnlocked('spikes', 1)).toBe(false);
      expect(meta.IsTierUnlocked('fangs', 1)).toBe(false);

      expect(meta.GetUpgradeChallengeDescription('turret', 1)).toBe('Complete Challenges to Unlock');
      expect(meta.GetUpgradeChallengeDescription('shield', 1)).toBe('Complete Challenges to Unlock');
    });

    it('evaluates specific boss defeats for early Tier 1 unlocks (Centipede, Gorgon, Colossus, Chrono Wyrm)', () => {
      // Dragon Maw (maw Tier 1) requires Floor 1 Centipede defeat
      expect(meta.IsTierUnlocked('maw', 1)).toBe(false);
      expect(meta.IsTierUnlocked('maw', 1, { floor: 1, bosses: 0 })).toBe(false);
      expect(meta.IsTierUnlocked('maw', 1, { floor: 2 })).toBe(true);

      meta.ResetRunUnlocks();
      expect(meta.IsTierUnlocked('maw', 1, { bosses: 1 })).toBe(true);

      // Railgun Flak Cannon (flak Tier 1) requires Floor 2 Storm Gorgon defeat
      meta.ResetRunUnlocks();
      expect(meta.IsTierUnlocked('flak', 1)).toBe(false);
      expect(meta.IsTierUnlocked('flak', 1, { floor: 2, bosses: 1 })).toBe(false);
      expect(meta.IsTierUnlocked('flak', 1, { floor: 3 })).toBe(true);

      // Seeker Needler (needler Tier 1) requires Floor 3 Infernal Colossus defeat
      meta.ResetRunUnlocks();
      expect(meta.IsTierUnlocked('needler', 1)).toBe(false);
      expect(meta.IsTierUnlocked('needler', 1, { floor: 3, bosses: 2 })).toBe(false);
      expect(meta.IsTierUnlocked('needler', 1, { floor: 4 })).toBe(true);

      // Chrono Ward (chrono Tier 1) requires Floor 5 Chrono Wyrm defeat
      meta.ResetRunUnlocks();
      expect(meta.IsTierUnlocked('chrono', 1)).toBe(false);
      expect(meta.IsTierUnlocked('chrono', 1, { floor: 5, bosses: 4 })).toBe(false);
      expect(meta.IsTierUnlocked('chrono', 1, { floor: 6 })).toBe(true);
    });

    it('evaluates early food and bestiary hunt challenges for Tier 1', () => {
      // Bio-Magnet (magnet Tier 1) requires 2 Golden Apples
      expect(meta.IsTierUnlocked('magnet', 1, { golden_apples: 1 })).toBe(false);
      expect(meta.IsTierUnlocked('magnet', 1, { golden_apples: 2 })).toBe(true);

      // Regen Gland (regen Tier 1) requires 30 Crimson Apples
      meta.ResetRunUnlocks();
      expect(meta.IsTierUnlocked('regen', 1, { apples: 29 })).toBe(false);
      expect(meta.IsTierUnlocked('regen', 1, { apples: 30 })).toBe(true);

      // Ramming Horns (horns Tier 1) requires 10 Armored Scarabs
      meta.ResetRunUnlocks();
      expect(meta.IsTierUnlocked('horns', 1, { scarabs: 9 })).toBe(false);
      expect(meta.IsTierUnlocked('horns', 1, { scarabs: 10 })).toBe(true);

      // Scattershot (scattershot Tier 1) requires 25 enemy kills
      meta.ResetRunUnlocks();
      expect(meta.IsTierUnlocked('scattershot', 1, { kills: 24 })).toBe(false);
      expect(meta.IsTierUnlocked('scattershot', 1, { kills: 25 })).toBe(true);

      // Magma Vent (magma Tier 1) requires 15 Swarmlings
      meta.ResetRunUnlocks();
      expect(meta.IsTierUnlocked('magma', 1, { swarmlings: 14 })).toBe(false);
      expect(meta.IsTierUnlocked('magma', 1, { swarmlings: 15 })).toBe(true);
    });

    it('evaluates feats and items for Tier 1 (Cryo, Plasma, Tachyon, Nanite, Laser)', () => {
      // Cryo Mortar: 2 Potions
      expect(meta.IsTierUnlocked('cryo', 1, { potions: 1 })).toBe(false);
      expect(meta.IsTierUnlocked('cryo', 1, { potions: 2 })).toBe(true);

      // Plasma Mortar: Length 35 (scaled)
      meta.ResetRunUnlocks();
      const desktopCtx = { arenaW: 1600, arenaH: 960 };
      expect(meta.IsTierUnlocked('plasma', 1, { ...desktopCtx, length: 34 })).toBe(false);
      expect(meta.IsTierUnlocked('plasma', 1, { ...desktopCtx, length: 35 })).toBe(true);

      // Tachyon Laser: 10x Combo
      meta.ResetRunUnlocks();
      expect(meta.IsTierUnlocked('tachyon', 1, { combo: 9 })).toBe(false);
      expect(meta.IsTierUnlocked('tachyon', 1, { combo: 10 })).toBe(true);

      // Nanite Swarm: 5 Shards/Prisms
      meta.ResetRunUnlocks();
      expect(meta.IsTierUnlocked('nanite', 1, { shards: 4 })).toBe(false);
      expect(meta.IsTierUnlocked('nanite', 1, { shards: 5 })).toBe(true);

      // Laser Optics: 8 Spitters
      meta.ResetRunUnlocks();
      expect(meta.IsTierUnlocked('laser', 1, { spitters: 7 })).toBe(false);
      expect(meta.IsTierUnlocked('laser', 1, { spitters: 8 })).toBe(true);
    });
  });

  describe('2. Mid-Game Challenges (Tier 2, Floors 6–12)', () => {
    it('evaluates mid-game specific boss defeats (Superconductor F7, Leviathan F8, Doppelgänger F10, Nanite Titan F17)', () => {
      // Turret Tier 2: Superconductor (Floor 7)
      expect(meta.IsTierUnlocked('turret', 2, { floor: 7, bosses: 6 })).toBe(false);
      expect(meta.IsTierUnlocked('turret', 2, { floor: 8 })).toBe(true);

      // Magma Tier 2: Astral Leviathan (Floor 8)
      meta.ResetRunUnlocks();
      expect(meta.IsTierUnlocked('magma', 2, { floor: 8, bosses: 7 })).toBe(false);
      expect(meta.IsTierUnlocked('magma', 2, { floor: 9 })).toBe(true);

      // Cryo Mortar Tier 2: Shadow Doppelgänger (Floor 10)
      meta.ResetRunUnlocks();
      expect(meta.IsTierUnlocked('cryo', 2, { floor: 10, bosses: 9 })).toBe(false);
      expect(meta.IsTierUnlocked('cryo', 2, { floor: 11 })).toBe(true);

      // Tachyon Laser Tier 2: Nanite Hive Titan (Floor 17)
      meta.ResetRunUnlocks();
      expect(meta.IsTierUnlocked('tachyon', 2, { floor: 17, bosses: 16 })).toBe(false);
      expect(meta.IsTierUnlocked('tachyon', 2, { floor: 18 })).toBe(true);
    });

    it('evaluates mid-game combo streaks, bestiary hunts, and boss milestones for Tier 2', () => {
      // Bio-Arc Coil (tesla Tier 2): Combo 20x
      expect(meta.IsTierUnlocked('tesla', 2, { combo: 19 })).toBe(false);
      expect(meta.IsTierUnlocked('tesla', 2, { combo: 20 })).toBe(true);

      // Venom Fangs (fangs Tier 2): Combo 20x
      meta.ResetRunUnlocks();
      expect(meta.IsTierUnlocked('fangs', 2, { combo: 19 })).toBe(false);
      expect(meta.IsTierUnlocked('fangs', 2, { combo: 20 })).toBe(true);

      // Venom Sprayer (venom Tier 2): 15 Arc Drones
      meta.ResetRunUnlocks();
      expect(meta.IsTierUnlocked('venom', 2, { arc_drones: 14 })).toBe(false);
      expect(meta.IsTierUnlocked('venom', 2, { arc_drones: 15 })).toBe(true);

      // Thorny Spikes (spikes Tier 2): 12 Phase Phantoms
      meta.ResetRunUnlocks();
      expect(meta.IsTierUnlocked('spikes', 2, { phantoms: 11 })).toBe(false);
      expect(meta.IsTierUnlocked('spikes', 2, { phantoms: 12 })).toBe(true);

      // Carapace Shield (shield Tier 2): Length 600
      meta.ResetRunUnlocks();
      expect(meta.IsTierUnlocked('shield', 2, { length: 599 })).toBe(false);
      expect(meta.IsTierUnlocked('shield', 2, { length: 600 })).toBe(true);

      // Ramming Horns (horns Tier 2): 8 Boss Guardians
      meta.ResetRunUnlocks();
      expect(meta.IsTierUnlocked('horns', 2, { bosses: 7 })).toBe(false);
      expect(meta.IsTierUnlocked('horns', 2, { bosses: 8 })).toBe(true);
    });
  });

  describe('3. Endgame Masteries (Tier 3, Floors 13–20+)', () => {
    it('evaluates endgame apex boss defeats (Prismatic Arachnid F15, Eternal Ouroboros F20)', () => {
      // Turret Tier 3: Prismatic Arachnid (Floor 15)
      expect(meta.IsTierUnlocked('turret', 3, { floor: 15, bosses: 14 })).toBe(false);
      expect(meta.IsTierUnlocked('turret', 3, { floor: 16 })).toBe(true);

      // Cryo Mortar Tier 3: The Eternal Ouroboros (Floor 20)
      meta.ResetRunUnlocks();
      expect(meta.IsTierUnlocked('cryo', 3, { floor: 20, bosses: 19 })).toBe(false);
      expect(meta.IsTierUnlocked('cryo', 3, { floor: 21 })).toBe(true);

      meta.ResetRunUnlocks();
      expect(meta.IsTierUnlocked('cryo', 3, { summary: { victory: true } })).toBe(true);

      // Laser Optics Tier 3: Length 1800
      meta.ResetRunUnlocks();
      expect(meta.IsTierUnlocked('laser', 3, { length: 1799 })).toBe(false);
      expect(meta.IsTierUnlocked('laser', 3, { length: 1800 })).toBe(true);
    });

    it('evaluates endgame masteries for combos, kills, boss counts, and lengths', () => {
      // Tesla Coil Tier 3: Combo 40x
      expect(meta.IsTierUnlocked('tesla', 3, { combo: 39 })).toBe(false);
      expect(meta.IsTierUnlocked('tesla', 3, { combo: 40 })).toBe(true);

      // Venom Fangs Tier 3: 10 Magma Brutes
      meta.ResetRunUnlocks();
      expect(meta.IsTierUnlocked('fangs', 3, { magma_brutes: 9 })).toBe(false);
      expect(meta.IsTierUnlocked('fangs', 3, { magma_brutes: 10 })).toBe(true);

      // Nanite Swarm Tier 3: 18 Boss Guardians
      meta.ResetRunUnlocks();
      expect(meta.IsTierUnlocked('nanite', 3, { bosses: 17 })).toBe(false);
      expect(meta.IsTierUnlocked('nanite', 3, { bosses: 18 })).toBe(true);

      // Tachyon Laser Tier 3: Length 1500
      meta.ResetRunUnlocks();
      expect(meta.IsTierUnlocked('tachyon', 3, { length: 1499 })).toBe(false);
      expect(meta.IsTierUnlocked('tachyon', 3, { length: 1500 })).toBe(true);
    });
  });

  describe('4. Single Condition & Post-Run Evaluation Integrity', () => {
    it('verifies that each challenge description represents a single unambiguous requirement', () => {
      const sampleKeys = ['turret', 'tesla', 'venom', 'magma', 'cryo', 'plasma', 'flak', 'scattershot', 'needler', 'shield', 'spikes', 'regen', 'magnet', 'chrono', 'nanite', 'fangs', 'maw', 'horns', 'laser', 'crown'];
      for (const k of sampleKeys) {
        for (let t = 1; t <= 3; t++) {
          const desc = meta.GetUpgradeChallengeDescription(k, t);
          expect(desc).toBeDefined();
          expect(desc).not.toContain(' OR ');
        }
      }
    });

    it('evaluates and persists diverse unlocks through EvaluateChallenges(summary)', () => {
      meta.ResetRunUnlocks();

      meta.EvaluateChallenges({
        Floor: 8,
        Kills: 105,
        Foods: 110,
        Bosses: 7,
        Combo: 25,
        Length: 650,
        Score: 120000,
        TimeSec: 400,
        KillsByType: {
          swarmling: 16,
          drone: 16,
        },
        FoodsByType: {
          apple: 32,
        },
      });

      // Turret T2 (Floor 7 Superconductor)
      expect(meta.IsTierUnlocked('turret', 2)).toBe(true);
      // Venom T2 (15 Arc Drones)
      expect(meta.IsTierUnlocked('venom', 2)).toBe(true);
      // Tesla T2 (Combo 20x)
      expect(meta.IsTierUnlocked('tesla', 2)).toBe(true);
      // Needler T2 (80 Foods)
      expect(meta.IsTierUnlocked('needler', 2)).toBe(true);
      // Shield T2 (Length 600)
      expect(meta.IsTierUnlocked('shield', 2)).toBe(true);
      // Magma T1 (15 Swarmlings)
      expect(meta.IsTierUnlocked('magma', 1)).toBe(true);
    });
  });
});
