/**
 * Ouroboros Ascension — In-Run Challenge Unlock Thresholds Audit & Fine-Tuning Test Suite
 *
 * Validates smooth pacing and exact single-condition requirements across all tiers:
 * 1. Tier 1 (Floors 1–5):
 *    - Specific Bestiary Hunts: Magma (15 Swarmlings), Horns (10 Scarabs), Laser/Visor (8 Spitters), Scattershot (25 Kills).
 *    - Specific Food & Item Harvests: Regen (30 Apples), Magnet (2 Golden Apples), Cryo (2 Potions), Nanite (5 Shards/Prisms), Crown/Crest (45 Foods).
 *    - Combat Feats & Combos: Tachyon (10x Combo), Plasma (Length 35 scaled).
 *    - Bosses: Maw (F1 Centipede), Flak (F2 Gorgon), Needler (F3 Colossus), Chrono (F5 Chrono Wyrm).
 *    - Starter Defaults: Turret, Tesla, Venom, Shield, Spikes, Fangs (unlocked at start).
 * 2. Tier 2 (Floors 6–12):
 *    - Specific Bestiary Hunts: Spikes (12 Phantoms), Venom (15 Arc Drones).
 *    - Combos & Foods: Tesla (20x Combo), Flak (25x Combo), Magnet (18x Combo), Fangs (20x Combo), Needler (80 Foods), Regen (120 Foods), Crown/Crest (150 Foods).
 *    - Length: Shield (600), Maw (600), Scattershot (650), Plasma (800), Nanite (800).
 *    - Bosses: Turret (F7 Superconductor), Magma (F8 Leviathan), Cryo (F10 Doppelgänger), Tachyon (F17 Nanite Titan), Chrono (8 Bosses), Horns (8 Bosses).
 * 3. Tier 3 (Floors 13–20+):
 *    - Specific Bestiary Hunts & Feats: Fangs (10 Magma Brutes), Tesla (40x Combo), Magnet (35x Combo), Venom (200 Kills).
 *    - Length: Magma (1350), Scattershot (1200), Shield (1200), Plasma (1500), Tachyon (1500), Chrono (1500), Maw (1500), Laser/Visor (1800).
 *    - Food: Needler (220), Regen (250), Crown/Crest (300).
 *    - Bosses: Flak (15), Horns (16), Spikes (18), Nanite (18), Turret (F15 Arachnid), Cryo (F20 Eternal Ouroboros).
 * 4. Single-Condition Integrity: Strictly ONE challenge condition per tier without ambiguous duplicates.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { MetaProgression } from '../data/MetaProgression';
import { Services } from '../core/Services';
import { NullFx, NullSound } from '../core/Contracts';

describe('In-Run Challenge Unlock Thresholds Audit Test Suite', () => {
  let meta: MetaProgression;

  beforeEach(() => {
    Services.Sound = new NullSound();
    Services.Fx = new NullFx();
    Services.Headless = true;
    MetaProgression.ReadBackend = () => null;
    MetaProgression.WriteBackend = () => {};
    MetaProgression.DeleteBackend = () => {};
    MetaProgression.Instance = new MetaProgression();
    meta = MetaProgression.Instance;
  });

  describe('1. Starter Defaults & Tier 1 Early Challenges (Floors 1–5)', () => {
    it('1.1 unlocks starter defaults at Tier 1 with no challenge condition (turret and shield only)', () => {
      const starters = ['turret', 'shield'];
      for (const starter of starters) {
        expect(meta.IsTierUnlocked(starter, 1)).toBe(true);
        expect(meta.GetUpgradeChallengeDescription(starter, 1)).toBe('Complete Challenges to Unlock');
      }

      // Non-starter modules/augments are strictly locked at start
      expect(meta.IsTierUnlocked('tesla', 1)).toBe(false);
      expect(meta.IsTierUnlocked('venom', 1)).toBe(false);
      expect(meta.IsTierUnlocked('spikes', 1)).toBe(false);
      expect(meta.IsTierUnlocked('fangs', 1)).toBe(false);
    });

    it('1.2 enforces Tier 1 Bestiary Hunts (Magma: 15 Swarmlings, Horns: 10 Scarabs, Laser/Visor: 8 Spitters, Scattershot: 25 Kills)', () => {
      // Magma: 15 Swarmlings
      expect(meta.GetUpgradeChallengeDescription('magma', 1)).toBe('Slay 15 Swarmlings in a run');
      expect(meta.IsTierUnlocked('magma', 1, { swarmlings: 14 })).toBe(false);
      expect(meta.IsTierUnlocked('magma', 1, { swarmlings: 15 })).toBe(true);

      // Horns: 10 Scarabs
      meta.ResetRunUnlocks();
      expect(meta.GetUpgradeChallengeDescription('horns', 1)).toBe('Slay 10 Armored Scarabs in a run');
      expect(meta.IsTierUnlocked('horns', 1, { scarabs: 9 })).toBe(false);
      expect(meta.IsTierUnlocked('horns', 1, { scarabs: 10 })).toBe(true);

      // Laser / Visor: 8 Spitters
      meta.ResetRunUnlocks();
      expect(meta.GetUpgradeChallengeDescription('laser', 1)).toBe('Slay 8 Venom Spitters in a run');
      expect(meta.IsTierUnlocked('laser', 1, { spitters: 7 })).toBe(false);
      expect(meta.IsTierUnlocked('laser', 1, { spitters: 8 })).toBe(true);

      // Scattershot: 25 Kills
      meta.ResetRunUnlocks();
      expect(meta.GetUpgradeChallengeDescription('scattershot', 1)).toBe('Slay 25 Enemies in a run');
      expect(meta.IsTierUnlocked('scattershot', 1, { kills: 24 })).toBe(false);
      expect(meta.IsTierUnlocked('scattershot', 1, { kills: 25 })).toBe(true);
    });

    it('1.3 enforces Tier 1 food & item thresholds (Regen: 30 Apples, Magnet: 2 Golden, Cryo: 2 Potions, Nanite: 5 Shards, Crown/Crest: 45 Foods)', () => {
      // Regen: 30 Apples
      expect(meta.IsTierUnlocked('regen', 1, { apples: 29 })).toBe(false);
      expect(meta.IsTierUnlocked('regen', 1, { apples: 30 })).toBe(true);
      expect(meta.GetUpgradeChallengeDescription('regen', 1)).toBe('Eat 30 Crimson Apples in a run');

      // Magnet: 2 Golden Apples
      meta.ResetRunUnlocks();
      expect(meta.IsTierUnlocked('magnet', 1, { golden_apples: 1 })).toBe(false);
      expect(meta.IsTierUnlocked('magnet', 1, { golden_apples: 2 })).toBe(true);
      expect(meta.GetUpgradeChallengeDescription('magnet', 1)).toBe('Collect 2 Golden Apples in a run');

      // Cryo: 2 Potions
      meta.ResetRunUnlocks();
      expect(meta.IsTierUnlocked('cryo', 1, { potions: 1 })).toBe(false);
      expect(meta.IsTierUnlocked('cryo', 1, { potions: 2 })).toBe(true);
      expect(meta.GetUpgradeChallengeDescription('cryo', 1)).toBe('Drink 2 Health Potions in a run');

      // Nanite: 5 Shards/Prisms
      meta.ResetRunUnlocks();
      expect(meta.IsTierUnlocked('nanite', 1, { shards: 4 })).toBe(false);
      expect(meta.IsTierUnlocked('nanite', 1, { shards: 5 })).toBe(true);
      expect(meta.GetUpgradeChallengeDescription('nanite', 1)).toBe('Collect 5 Astral Shards / Prisms in a run');

      // Crown / Crest: 45 foods
      meta.ResetRunUnlocks();
      expect(meta.IsTierUnlocked('crown', 1, { foods: 44 })).toBe(false);
      expect(meta.IsTierUnlocked('crown', 1, { foods: 45 })).toBe(true);
      expect(meta.GetUpgradeChallengeDescription('crown', 1)).toBe('Collect 45 Food items in a run');
    });

    it('1.4 enforces Tier 1 Combat Feats (Tachyon: 10x Combo, Plasma: Length 35 scaled)', () => {
      // Tachyon: 10x Combo
      expect(meta.IsTierUnlocked('tachyon', 1, { combo: 9 })).toBe(false);
      expect(meta.IsTierUnlocked('tachyon', 1, { combo: 10 })).toBe(true);
      expect(meta.GetUpgradeChallengeDescription('tachyon', 1)).toBe('Maintain a Combo Streak of 10x');

      // Plasma: Length 35 (scaled)
      meta.ResetRunUnlocks();
      const desktopCtx = { arenaW: 1600, arenaH: 960 };
      expect(meta.IsTierUnlocked('plasma', 1, { ...desktopCtx, length: 34 })).toBe(false);
      expect(meta.IsTierUnlocked('plasma', 1, { ...desktopCtx, length: 35 })).toBe(true);
      expect(meta.GetUpgradeChallengeDescription('plasma', 1, desktopCtx)).toBe('Reach Serpent Length 35 (scaled)');
    });

    it('1.5 enforces Tier 1 specific boss defeats (Maw: F1, Flak: F2, Needler: F3, Chrono: F5)', () => {
      // Maw: Floor 1 Centipede Behemoth
      expect(meta.IsTierUnlocked('maw', 1, { floor: 1, bosses: 0 })).toBe(false);
      expect(meta.IsTierUnlocked('maw', 1, { floor: 2 })).toBe(true);
      expect(meta.GetUpgradeChallengeDescription('maw', 1)).toBe('Defeat Centipede Behemoth (Floor 1)');

      // Flak: Floor 2 Storm Gorgon
      meta.ResetRunUnlocks();
      expect(meta.IsTierUnlocked('flak', 1, { floor: 2, bosses: 1 })).toBe(false);
      expect(meta.IsTierUnlocked('flak', 1, { floor: 3 })).toBe(true);
      expect(meta.GetUpgradeChallengeDescription('flak', 1)).toBe('Defeat Storm Gorgon (Floor 2)');

      // Needler: Floor 3 Infernal Colossus
      meta.ResetRunUnlocks();
      expect(meta.IsTierUnlocked('needler', 1, { floor: 3, bosses: 2 })).toBe(false);
      expect(meta.IsTierUnlocked('needler', 1, { floor: 4 })).toBe(true);
      expect(meta.GetUpgradeChallengeDescription('needler', 1)).toBe('Defeat Infernal Colossus (Floor 3)');

      // Chrono: Floor 5 Chrono Wyrm
      meta.ResetRunUnlocks();
      expect(meta.IsTierUnlocked('chrono', 1, { floor: 5, bosses: 4 })).toBe(false);
      expect(meta.IsTierUnlocked('chrono', 1, { floor: 6 })).toBe(true);
      expect(meta.GetUpgradeChallengeDescription('chrono', 1)).toBe('Defeat Chrono Wyrm (Floor 5)');
    });
  });

  describe('2. Mid-Game Challenges (Tier 2, Floors 6–12)', () => {
    it('2.1 enforces Tier 2 scaled length thresholds (Shield: 600, Maw: 600, Scattershot: 650, Plasma: 800, Nanite: 800)', () => {
      const desktopCtx = { arenaW: 1600, arenaH: 960 };

      // Shield: 600
      expect(meta.IsTierUnlocked('shield', 2, { ...desktopCtx, length: 599 })).toBe(false);
      expect(meta.IsTierUnlocked('shield', 2, { ...desktopCtx, length: 600 })).toBe(true);
      expect(meta.GetUpgradeChallengeDescription('shield', 2, desktopCtx)).toBe('Grow Serpent to Length 600');

      // Maw: 600
      meta.ResetRunUnlocks();
      expect(meta.IsTierUnlocked('maw', 2, { ...desktopCtx, length: 599 })).toBe(false);
      expect(meta.IsTierUnlocked('maw', 2, { ...desktopCtx, length: 600 })).toBe(true);
      expect(meta.GetUpgradeChallengeDescription('maw', 2, desktopCtx)).toBe('Grow Serpent to Length 600');

      // Scattershot: 650
      meta.ResetRunUnlocks();
      expect(meta.IsTierUnlocked('scattershot', 2, { ...desktopCtx, length: 649 })).toBe(false);
      expect(meta.IsTierUnlocked('scattershot', 2, { ...desktopCtx, length: 650 })).toBe(true);
      expect(meta.GetUpgradeChallengeDescription('scattershot', 2, desktopCtx)).toBe('Grow Serpent to Length 650');

      // Plasma: 800
      meta.ResetRunUnlocks();
      expect(meta.IsTierUnlocked('plasma', 2, { ...desktopCtx, length: 799 })).toBe(false);
      expect(meta.IsTierUnlocked('plasma', 2, { ...desktopCtx, length: 800 })).toBe(true);
      expect(meta.GetUpgradeChallengeDescription('plasma', 2, desktopCtx)).toBe('Grow Serpent to Length 800');

      // Nanite: 800
      meta.ResetRunUnlocks();
      expect(meta.IsTierUnlocked('nanite', 2, { ...desktopCtx, length: 799 })).toBe(false);
      expect(meta.IsTierUnlocked('nanite', 2, { ...desktopCtx, length: 800 })).toBe(true);
      expect(meta.GetUpgradeChallengeDescription('nanite', 2, desktopCtx)).toBe('Grow Serpent to Length 800');
    });

    it('2.2 enforces Tier 2 food thresholds (Needler: 80, Regen: 120, Crown/Crest: 150)', () => {
      // Needler: 80
      expect(meta.IsTierUnlocked('needler', 2, { foods: 79 })).toBe(false);
      expect(meta.IsTierUnlocked('needler', 2, { foods: 80 })).toBe(true);
      expect(meta.GetUpgradeChallengeDescription('needler', 2)).toBe('Collect 80 Food items in a run');

      // Regen: 120
      meta.ResetRunUnlocks();
      expect(meta.IsTierUnlocked('regen', 2, { foods: 119 })).toBe(false);
      expect(meta.IsTierUnlocked('regen', 2, { foods: 120 })).toBe(true);
      expect(meta.GetUpgradeChallengeDescription('regen', 2)).toBe('Collect 120 Food items in a run');

      // Crown / Crest: 150
      meta.ResetRunUnlocks();
      expect(meta.IsTierUnlocked('crown', 2, { foods: 149 })).toBe(false);
      expect(meta.IsTierUnlocked('crown', 2, { foods: 150 })).toBe(true);
      expect(meta.GetUpgradeChallengeDescription('crown', 2)).toBe('Collect 150 Food items in a run');
    });

    it('2.3 enforces Tier 2 bestiary hunts (Spikes: 12 Phantoms, Venom: 15 Arc Drones, Laser/Visor: 110 Kills)', () => {
      // Spikes: 12 Phantoms
      expect(meta.IsTierUnlocked('spikes', 2, { phantoms: 11 })).toBe(false);
      expect(meta.IsTierUnlocked('spikes', 2, { phantoms: 12 })).toBe(true);
      expect(meta.GetUpgradeChallengeDescription('spikes', 2)).toBe('Slay 12 Phase Phantoms in a run');

      // Venom: 15 Arc Drones
      meta.ResetRunUnlocks();
      expect(meta.IsTierUnlocked('venom', 2, { arc_drones: 14 })).toBe(false);
      expect(meta.IsTierUnlocked('venom', 2, { arc_drones: 15 })).toBe(true);
      expect(meta.GetUpgradeChallengeDescription('venom', 2)).toBe('Slay 15 Arc Drones in a run');

      // Laser / Visor: 110
      meta.ResetRunUnlocks();
      expect(meta.IsTierUnlocked('laser', 2, { kills: 109 })).toBe(false);
      expect(meta.IsTierUnlocked('laser', 2, { kills: 110 })).toBe(true);
      expect(meta.GetUpgradeChallengeDescription('laser', 2)).toBe('Slay 110 Enemies in a run');
    });

    it('2.4 enforces Tier 2 combo streaks (Magnet: 18x, Fangs: 20x, Tesla: 20x, Flak: 25x)', () => {
      // Magnet: 18x
      expect(meta.IsTierUnlocked('magnet', 2, { combo: 17 })).toBe(false);
      expect(meta.IsTierUnlocked('magnet', 2, { combo: 18 })).toBe(true);
      expect(meta.GetUpgradeChallengeDescription('magnet', 2)).toBe('Maintain a Combo Streak of 18x');

      // Fangs: 20x
      meta.ResetRunUnlocks();
      expect(meta.IsTierUnlocked('fangs', 2, { combo: 19 })).toBe(false);
      expect(meta.IsTierUnlocked('fangs', 2, { combo: 20 })).toBe(true);
      expect(meta.GetUpgradeChallengeDescription('fangs', 2)).toBe('Maintain a Combo Streak of 20x');

      // Tesla: 20x
      meta.ResetRunUnlocks();
      expect(meta.IsTierUnlocked('tesla', 2, { combo: 19 })).toBe(false);
      expect(meta.IsTierUnlocked('tesla', 2, { combo: 20 })).toBe(true);
      expect(meta.GetUpgradeChallengeDescription('tesla', 2)).toBe('Maintain a Combo Streak of 20x');

      // Flak: 25x
      meta.ResetRunUnlocks();
      expect(meta.IsTierUnlocked('flak', 2, { combo: 24 })).toBe(false);
      expect(meta.IsTierUnlocked('flak', 2, { combo: 25 })).toBe(true);
      expect(meta.GetUpgradeChallengeDescription('flak', 2)).toBe('Maintain a Combo Streak of 25x');
    });

    it('2.5 enforces Tier 2 boss defeats & counts (Turret: F7, Magma: F8, Cryo: F10, Chrono: 8, Horns: 8, Tachyon: F17)', () => {
      // Turret: F7 Apex Superconductor
      expect(meta.IsTierUnlocked('turret', 2, { floor: 7, bosses: 6 })).toBe(false);
      expect(meta.IsTierUnlocked('turret', 2, { floor: 8 })).toBe(true);
      expect(meta.GetUpgradeChallengeDescription('turret', 2)).toBe('Defeat Apex Superconductor (Floor 7)');

      // Magma: F8 Astral Leviathan
      meta.ResetRunUnlocks();
      expect(meta.IsTierUnlocked('magma', 2, { floor: 8, bosses: 7 })).toBe(false);
      expect(meta.IsTierUnlocked('magma', 2, { floor: 9 })).toBe(true);
      expect(meta.GetUpgradeChallengeDescription('magma', 2)).toBe('Defeat Astral Leviathan (Floor 8)');

      // Cryo: F10 Shadow Doppelgänger
      meta.ResetRunUnlocks();
      expect(meta.IsTierUnlocked('cryo', 2, { floor: 10, bosses: 9 })).toBe(false);
      expect(meta.IsTierUnlocked('cryo', 2, { floor: 11 })).toBe(true);
      expect(meta.GetUpgradeChallengeDescription('cryo', 2)).toBe('Defeat Shadow Doppelgänger (Floor 10)');

      // Chrono: 8 Boss Guardians
      meta.ResetRunUnlocks();
      expect(meta.IsTierUnlocked('chrono', 2, { bosses: 7 })).toBe(false);
      expect(meta.IsTierUnlocked('chrono', 2, { bosses: 8 })).toBe(true);
      expect(meta.GetUpgradeChallengeDescription('chrono', 2)).toBe('Defeat 8 Boss Guardians');

      // Horns: 8 Boss Guardians
      meta.ResetRunUnlocks();
      expect(meta.IsTierUnlocked('horns', 2, { bosses: 7 })).toBe(false);
      expect(meta.IsTierUnlocked('horns', 2, { bosses: 8 })).toBe(true);
      expect(meta.GetUpgradeChallengeDescription('horns', 2)).toBe('Defeat 8 Boss Guardians');

      // Tachyon: F17 Nanite Hive Titan
      meta.ResetRunUnlocks();
      expect(meta.IsTierUnlocked('tachyon', 2, { floor: 17, bosses: 16 })).toBe(false);
      expect(meta.IsTierUnlocked('tachyon', 2, { floor: 18 })).toBe(true);
      expect(meta.GetUpgradeChallengeDescription('tachyon', 2)).toBe('Defeat Nanite Hive Titan (Floor 17)');
    });
  });

  describe('3. Endgame Masteries (Tier 3, Floors 13–20+)', () => {
    it('3.1 enforces Tier 3 scaled length thresholds (1200–1800)', () => {
      const desktopCtx = { arenaW: 1600, arenaH: 960 };

      // Scattershot & Shield: 1200
      expect(meta.IsTierUnlocked('scattershot', 3, { ...desktopCtx, length: 1199 })).toBe(false);
      expect(meta.IsTierUnlocked('scattershot', 3, { ...desktopCtx, length: 1200 })).toBe(true);
      expect(meta.IsTierUnlocked('shield', 3, { ...desktopCtx, length: 1199 })).toBe(false);
      expect(meta.IsTierUnlocked('shield', 3, { ...desktopCtx, length: 1200 })).toBe(true);

      // Magma: 1350
      meta.ResetRunUnlocks();
      expect(meta.IsTierUnlocked('magma', 3, { ...desktopCtx, length: 1349 })).toBe(false);
      expect(meta.IsTierUnlocked('magma', 3, { ...desktopCtx, length: 1350 })).toBe(true);

      // Plasma, Tachyon, Chrono, Maw: 1500
      meta.ResetRunUnlocks();
      expect(meta.IsTierUnlocked('plasma', 3, { ...desktopCtx, length: 1499 })).toBe(false);
      expect(meta.IsTierUnlocked('plasma', 3, { ...desktopCtx, length: 1500 })).toBe(true);
      expect(meta.IsTierUnlocked('tachyon', 3, { ...desktopCtx, length: 1500 })).toBe(true);
      expect(meta.IsTierUnlocked('chrono', 3, { ...desktopCtx, length: 1500 })).toBe(true);
      expect(meta.IsTierUnlocked('maw', 3, { ...desktopCtx, length: 1500 })).toBe(true);

      // Laser / Visor: 1800
      meta.ResetRunUnlocks();
      expect(meta.IsTierUnlocked('laser', 3, { ...desktopCtx, length: 1799 })).toBe(false);
      expect(meta.IsTierUnlocked('laser', 3, { ...desktopCtx, length: 1800 })).toBe(true);
      expect(meta.IsTierUnlocked('visor', 3, { ...desktopCtx, length: 1800 })).toBe(true);
    });

    it('3.2 enforces Tier 3 food thresholds (Needler: 220, Regen: 250, Crown/Crest: 300)', () => {
      // Needler: 220
      expect(meta.IsTierUnlocked('needler', 3, { foods: 219 })).toBe(false);
      expect(meta.IsTierUnlocked('needler', 3, { foods: 220 })).toBe(true);

      // Regen: 250
      meta.ResetRunUnlocks();
      expect(meta.IsTierUnlocked('regen', 3, { foods: 249 })).toBe(false);
      expect(meta.IsTierUnlocked('regen', 3, { foods: 250 })).toBe(true);

      // Crown / Crest: 300
      meta.ResetRunUnlocks();
      expect(meta.IsTierUnlocked('crown', 3, { foods: 299 })).toBe(false);
      expect(meta.IsTierUnlocked('crown', 3, { foods: 300 })).toBe(true);
      expect(meta.IsTierUnlocked('crest', 3, { foods: 300 })).toBe(true);
    });

    it('3.3 enforces Tier 3 kill & hunt thresholds (Venom: 200, Fangs: 10 Magma Brutes)', () => {
      // Venom: 200
      expect(meta.IsTierUnlocked('venom', 3, { kills: 199 })).toBe(false);
      expect(meta.IsTierUnlocked('venom', 3, { kills: 200 })).toBe(true);

      // Fangs: 10 Magma Brutes
      meta.ResetRunUnlocks();
      expect(meta.IsTierUnlocked('fangs', 3, { magma_brutes: 9 })).toBe(false);
      expect(meta.IsTierUnlocked('fangs', 3, { magma_brutes: 10 })).toBe(true);
    });

    it('3.4 enforces Tier 3 combo streaks (Magnet: 35x, Tesla: 40x)', () => {
      // Magnet: 35x
      expect(meta.IsTierUnlocked('magnet', 3, { combo: 34 })).toBe(false);
      expect(meta.IsTierUnlocked('magnet', 3, { combo: 35 })).toBe(true);

      // Tesla: 40x
      meta.ResetRunUnlocks();
      expect(meta.IsTierUnlocked('tesla', 3, { combo: 39 })).toBe(false);
      expect(meta.IsTierUnlocked('tesla', 3, { combo: 40 })).toBe(true);
    });

    it('3.5 enforces Tier 3 boss milestones & apex defeats (Flak: 15, Horns: 16, Spikes: 18, Nanite: 18, Turret: F15, Cryo: F20)', () => {
      // Flak: 15 bosses
      expect(meta.IsTierUnlocked('flak', 3, { bosses: 14 })).toBe(false);
      expect(meta.IsTierUnlocked('flak', 3, { bosses: 15 })).toBe(true);

      // Horns: 16 bosses
      meta.ResetRunUnlocks();
      expect(meta.IsTierUnlocked('horns', 3, { bosses: 15 })).toBe(false);
      expect(meta.IsTierUnlocked('horns', 3, { bosses: 16 })).toBe(true);

      // Spikes: 18 bosses
      meta.ResetRunUnlocks();
      expect(meta.IsTierUnlocked('spikes', 3, { bosses: 17 })).toBe(false);
      expect(meta.IsTierUnlocked('spikes', 3, { bosses: 18 })).toBe(true);

      // Nanite: 18 bosses
      meta.ResetRunUnlocks();
      expect(meta.IsTierUnlocked('nanite', 3, { bosses: 17 })).toBe(false);
      expect(meta.IsTierUnlocked('nanite', 3, { bosses: 18 })).toBe(true);

      // Turret: Floor 15 Prismatic Arachnid
      meta.ResetRunUnlocks();
      expect(meta.IsTierUnlocked('turret', 3, { floor: 15, bosses: 14 })).toBe(false);
      expect(meta.IsTierUnlocked('turret', 3, { floor: 16 })).toBe(true);

      // Cryo: Floor 20 The Eternal Ouroboros
      meta.ResetRunUnlocks();
      expect(meta.IsTierUnlocked('cryo', 3, { floor: 20, bosses: 19 })).toBe(false);
      expect(meta.IsTierUnlocked('cryo', 3, { floor: 21 })).toBe(true);
      expect(meta.IsTierUnlocked('cryo', 3, { summary: { victory: true } })).toBe(true);
    });
  });

  describe('4. Single-Condition Invariant Across All Tiers', () => {
    it('guarantees that every tier enforces strictly ONE unambiguous requirement without confusing compound clauses', () => {
      const allModules = [
        'turret', 'tesla', 'venom', 'shield', 'spikes', 'fangs',
        'magma', 'cryo', 'plasma', 'tachyon', 'flak', 'scattershot',
        'needler', 'regen', 'magnet', 'chrono', 'nanite', 'maw',
        'horns', 'visor', 'laser', 'crown', 'crest'
      ];

      for (const mod of allModules) {
        for (let t = 1; t <= 3; t++) {
          const desc = meta.GetUpgradeChallengeDescription(mod, t);
          expect(typeof desc).toBe('string');
          expect(desc.length).toBeGreaterThan(0);

          // Must not contain compound logical disjunctions
          expect(desc).not.toContain(' OR ');
          expect(desc).not.toContain(' or ');
        }
      }
    });
  });
});
