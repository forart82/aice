/**
 * Ouroboros Ascension — Diverse & Thematic In-Run Challenge Matrix Test Suite
 *
 * Validates the elimination of repetitive 'Grow to 140' challenges and enforces
 * varied, engaging requirements across 4 core thematic pillars:
 * 1. Specific Bestiary Hunts (Swarmlings, Scarabs, Spitters, Scattershot, Phantoms, Arc Drones, Magma Brutes)
 * 2. Specific Food & Item Harvests (Crimson Apples, Golden Apples, Health Potions, Astral Shards/Prisms, Foods)
 * 3. Combat Feats & Combo Streaks (10x, Length 35, 20x, 25x, 18x, 40x)
 * 4. Boss Guardians Defeats (Centipede, Gorgon, Colossus, Chrono Wyrm, Superconductor, Leviathan, Doppelgänger, Titan, Arachnid, Eternal Ouroboros)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { MetaProgression } from '../data/MetaProgression.js';
import { Services } from '../core/Services.js';
import { NullFx, NullSound } from '../core/Contracts.js';
import { GameEngine } from '../sim/GameEngine.js';
import { Enemy } from '../sim/Enemy.js';
import { FoodItem } from '../sim/FoodItem.js';
import { SnakeSegment } from '../sim/SnakePlayer.js';

describe('Diverse In-Run Challenge Matrix Comprehensive Verification', () => {
  let meta: MetaProgression;
  let engine: GameEngine;

  beforeEach(() => {
    Services.resetToNull();
    Services.Sound = new NullSound();
    Services.Fx = new NullFx();
    Services.headless = true;

    MetaProgression.readBackend = () => null;
    MetaProgression.writeBackend = () => {};
    MetaProgression.deleteBackend = () => {};
    MetaProgression.instance = new MetaProgression();
    meta = MetaProgression.Instance;

    engine = new GameEngine(Services.Fx);
    Services.registerEngineProvider(() => engine);
    Services.registerMetaProvider(() => meta);
  });

  describe('1. Starter Defaults Matrix', () => {
    it('grants starter defaults at Tier 1 with zero challenge gating (turret and shield only)', () => {
      const starters = ['turret', 'shield'];
      for (const key of starters) {
        expect(meta.IsTierUnlocked(key, 1)).toBe(true);
        expect(meta.GetUpgradeChallengeDescription(key, 1)).toBe('Complete Challenges to Unlock');
      }

      // Non-starter modules/augments are strictly locked at start
      expect(meta.IsTierUnlocked('tesla', 1)).toBe(false);
      expect(meta.IsTierUnlocked('venom', 1)).toBe(false);
      expect(meta.IsTierUnlocked('spikes', 1)).toBe(false);
      expect(meta.IsTierUnlocked('fangs', 1)).toBe(false);
    });
  });

  describe('2. Pillar 1: Specific Bestiary Hunts', () => {
    it('Magma Vent [Tier 1]: Slay 15 Swarmlings in a run', () => {
      expect(meta.GetUpgradeChallengeDescription('magma', 1)).toBe('Slay 15 Swarmlings in a run');
      expect(meta.IsTierUnlocked('magma', 1, { swarmlings: 14 })).toBe(false);
      expect(meta.IsTierUnlocked('magma', 1, { swarmlings: 15 })).toBe(true);
      expect(meta.IsTierUnlocked('magma', 1, { killsByType: { swarmling: 15 } })).toBe(true);
    });

    it('Ramming Horns [Tier 1]: Slay 10 Armored Scarabs in a run', () => {
      expect(meta.GetUpgradeChallengeDescription('horns', 1)).toBe('Slay 10 Armored Scarabs in a run');
      expect(meta.IsTierUnlocked('horns', 1, { scarabs: 9 })).toBe(false);
      expect(meta.IsTierUnlocked('horns', 1, { scarabs: 10 })).toBe(true);
      expect(meta.IsTierUnlocked('horns', 1, { killsByType: { scarab: 10 } })).toBe(true);
    });

    it('Laser Optics [Tier 1]: Slay 8 Venom Spitters in a run', () => {
      expect(meta.GetUpgradeChallengeDescription('laser', 1)).toBe('Slay 8 Venom Spitters in a run');
      expect(meta.IsTierUnlocked('laser', 1, { spitters: 7 })).toBe(false);
      expect(meta.IsTierUnlocked('laser', 1, { spitters: 8 })).toBe(true);
      expect(meta.IsTierUnlocked('laser', 1, { killsByType: { spitter: 8 } })).toBe(true);
    });

    it('Venom Sprayer [Tier 1]: Slay 20 Enemies in a run', () => {
      expect(meta.GetUpgradeChallengeDescription('venom', 1)).toBe('Slay 20 Enemies in a run');
      expect(meta.IsTierUnlocked('venom', 1, { kills: 19 })).toBe(false);
      expect(meta.IsTierUnlocked('venom', 1, { kills: 20 })).toBe(true);
    });

    it('Scattershot [Tier 1]: Slay 25 Enemies in a run', () => {
      expect(meta.GetUpgradeChallengeDescription('scattershot', 1)).toBe('Slay 25 Enemies in a run');
      expect(meta.IsTierUnlocked('scattershot', 1, { kills: 24 })).toBe(false);
      expect(meta.IsTierUnlocked('scattershot', 1, { kills: 25 })).toBe(true);
    });

    it('Thorny Spikes [Tier 2]: Slay 12 Phase Phantoms in a run', () => {
      expect(meta.GetUpgradeChallengeDescription('spikes', 2)).toBe('Slay 12 Phase Phantoms in a run');
      expect(meta.IsTierUnlocked('spikes', 2, { phantoms: 11 })).toBe(false);
      expect(meta.IsTierUnlocked('spikes', 2, { phantoms: 12 })).toBe(true);
      expect(meta.IsTierUnlocked('spikes', 2, { killsByType: { phantom: 12 } })).toBe(true);
    });

    it('Venom Sprayer [Tier 2]: Slay 15 Arc Drones in a run', () => {
      expect(meta.GetUpgradeChallengeDescription('venom', 2)).toBe('Slay 15 Arc Drones in a run');
      expect(meta.IsTierUnlocked('venom', 2, { arc_drones: 14 })).toBe(false);
      expect(meta.IsTierUnlocked('venom', 2, { arc_drones: 15 })).toBe(true);
      expect(meta.IsTierUnlocked('venom', 2, { killsByType: { drone: 15 } })).toBe(true);
    });

    it('Venom Fangs [Tier 3]: Slay 10 Magma Brutes in a run', () => {
      expect(meta.GetUpgradeChallengeDescription('fangs', 3)).toBe('Slay 10 Magma Brutes in a run');
      expect(meta.IsTierUnlocked('fangs', 3, { magma_brutes: 9 })).toBe(false);
      expect(meta.IsTierUnlocked('fangs', 3, { magma_brutes: 10 })).toBe(true);
      expect(meta.IsTierUnlocked('fangs', 3, { killsByType: { brute: 10 } })).toBe(true);
    });
  });

  describe('3. Pillar 2: Specific Food & Item Harvests', () => {
    it('Regen Gland [Tier 1]: Eat 30 Crimson Apples in a run', () => {
      expect(meta.GetUpgradeChallengeDescription('regen', 1)).toBe('Eat 30 Crimson Apples in a run');
      expect(meta.IsTierUnlocked('regen', 1, { apples: 29 })).toBe(false);
      expect(meta.IsTierUnlocked('regen', 1, { apples: 30 })).toBe(true);
      expect(meta.IsTierUnlocked('regen', 1, { foodsByType: { apple: 30 } })).toBe(true);
    });

    it('Bio-Magnet [Tier 1]: Collect 2 Golden Apples in a run', () => {
      expect(meta.GetUpgradeChallengeDescription('magnet', 1)).toBe('Collect 2 Golden Apples in a run');
      expect(meta.IsTierUnlocked('magnet', 1, { golden_apples: 1 })).toBe(false);
      expect(meta.IsTierUnlocked('magnet', 1, { golden_apples: 2 })).toBe(true);
      expect(meta.IsTierUnlocked('magnet', 1, { foodsByType: { golden: 2 } })).toBe(true);
    });

    it('Cryo Mortar [Tier 1]: Drink 2 Health Potions in a run', () => {
      expect(meta.GetUpgradeChallengeDescription('cryo', 1)).toBe('Drink 2 Health Potions in a run');
      expect(meta.IsTierUnlocked('cryo', 1, { potions: 1 })).toBe(false);
      expect(meta.IsTierUnlocked('cryo', 1, { potions: 2 })).toBe(true);
      expect(meta.IsTierUnlocked('cryo', 1, { foodsByType: { potion: 2 } })).toBe(true);
    });

    it('Nanite Swarm [Tier 1]: Collect 5 Astral Shards / Prisms in a run', () => {
      expect(meta.GetUpgradeChallengeDescription('nanite', 1)).toBe('Collect 5 Astral Shards / Prisms in a run');
      expect(meta.IsTierUnlocked('nanite', 1, { shards: 4, prisms: 0 })).toBe(false);
      expect(meta.IsTierUnlocked('nanite', 1, { shards: 3, prisms: 2 })).toBe(true);
      expect(meta.IsTierUnlocked('nanite', 1, { foodsByType: { shard: 2, prism: 3 } })).toBe(true);
    });

    it('Venom Fangs [Tier 1]: Maintain a Combo Streak of 15x', () => {
      expect(meta.GetUpgradeChallengeDescription('fangs', 1)).toBe('Maintain a Combo Streak of 15x');
      expect(meta.IsTierUnlocked('fangs', 1, { combo: 14 })).toBe(false);
      expect(meta.IsTierUnlocked('fangs', 1, { combo: 15 })).toBe(true);
    });

    it('Solar Crown [Tier 1]: Collect 45 Food items in a run', () => {
      expect(meta.GetUpgradeChallengeDescription('crown', 1)).toBe('Collect 45 Food items in a run');
      expect(meta.IsTierUnlocked('crown', 1, { foods: 44 })).toBe(false);
      expect(meta.IsTierUnlocked('crown', 1, { foods: 45 })).toBe(true);
    });

    it('Seeker Needler [Tier 2]: Collect 80 Food items in a run', () => {
      expect(meta.GetUpgradeChallengeDescription('needler', 2)).toBe('Collect 80 Food items in a run');
      expect(meta.IsTierUnlocked('needler', 2, { foods: 79 })).toBe(false);
      expect(meta.IsTierUnlocked('needler', 2, { foods: 80 })).toBe(true);
    });
  });

  describe('4. Pillar 3: Combat Feats & Combo Streaks', () => {
    it('Bio-Arc Coil [Tier 1]: Maintain a Combo Streak of 8x', () => {
      expect(meta.GetUpgradeChallengeDescription('tesla', 1)).toBe('Maintain a Combo Streak of 8x');
      expect(meta.IsTierUnlocked('tesla', 1, { combo: 7 })).toBe(false);
      expect(meta.IsTierUnlocked('tesla', 1, { combo: 8 })).toBe(true);
    });

    it('Thorny Spikes [Tier 1]: Slay 10 Armored Scarabs in a run', () => {
      const desktopCtx = { arenaW: 1600, arenaH: 960 };
      expect(meta.GetUpgradeChallengeDescription('spikes', 1, desktopCtx)).toBe('Slay 10 Armored Scarabs in a run');
      expect(meta.IsTierUnlocked('spikes', 1, { ...desktopCtx, scarabs: 9, kills: 9 })).toBe(false);
      expect(meta.IsTierUnlocked('spikes', 1, { ...desktopCtx, scarabs: 10 })).toBe(true);
    });

    it('Tachyon Laser [Tier 1]: Maintain a Combo Streak of 10x', () => {
      expect(meta.GetUpgradeChallengeDescription('tachyon', 1)).toBe('Maintain a Combo Streak of 10x');
      expect(meta.IsTierUnlocked('tachyon', 1, { combo: 9 })).toBe(false);
      expect(meta.IsTierUnlocked('tachyon', 1, { combo: 10 })).toBe(true);
    });

    it('Plasma Mortar [Tier 1]: Reach Serpent Length 35 (scaled)', () => {
      const desktopCtx = { arenaW: 1600, arenaH: 960 };
      expect(meta.GetUpgradeChallengeDescription('plasma', 1, desktopCtx)).toBe('Reach Serpent Length 35 (scaled)');
      expect(meta.IsTierUnlocked('plasma', 1, { ...desktopCtx, length: 34 })).toBe(false);
      expect(meta.IsTierUnlocked('plasma', 1, { ...desktopCtx, length: 35 })).toBe(true);
    });

    it('Bio-Arc Coil [Tier 2]: Maintain a Combo Streak of 20x', () => {
      expect(meta.GetUpgradeChallengeDescription('tesla', 2)).toBe('Maintain a Combo Streak of 20x');
      expect(meta.IsTierUnlocked('tesla', 2, { combo: 19 })).toBe(false);
      expect(meta.IsTierUnlocked('tesla', 2, { combo: 20 })).toBe(true);
    });

    it('Railgun Flak Cannon [Tier 2]: Maintain a Combo Streak of 25x', () => {
      expect(meta.GetUpgradeChallengeDescription('flak', 2)).toBe('Maintain a Combo Streak of 25x');
      expect(meta.IsTierUnlocked('flak', 2, { combo: 24 })).toBe(false);
      expect(meta.IsTierUnlocked('flak', 2, { combo: 25 })).toBe(true);
    });

    it('Bio-Magnet [Tier 2]: Maintain a Combo Streak of 18x', () => {
      expect(meta.GetUpgradeChallengeDescription('magnet', 2)).toBe('Maintain a Combo Streak of 18x');
      expect(meta.IsTierUnlocked('magnet', 2, { combo: 17 })).toBe(false);
      expect(meta.IsTierUnlocked('magnet', 2, { combo: 18 })).toBe(true);
    });

    it('Tesla Coil [Tier 3]: Maintain a Combo Streak of 40x', () => {
      expect(meta.GetUpgradeChallengeDescription('tesla', 3)).toBe('Maintain a Combo Streak of 40x');
      expect(meta.IsTierUnlocked('tesla', 3, { combo: 39 })).toBe(false);
      expect(meta.IsTierUnlocked('tesla', 3, { combo: 40 })).toBe(true);
    });
  });

  describe('5. Pillar 4: Boss Guardians Defeats', () => {
    it('Tier 1 Bosses (Centipede, Storm Gorgon, Infernal Colossus, Chrono Wyrm)', () => {
      // Dragon Maw (Maw T1: Floor 1 Centipede)
      expect(meta.GetUpgradeChallengeDescription('maw', 1)).toBe('Defeat Centipede Behemoth (Floor 1)');
      expect(meta.IsTierUnlocked('maw', 1, { floor: 1, bosses: 0 })).toBe(false);
      expect(meta.IsTierUnlocked('maw', 1, { floor: 2 })).toBe(true);
      expect(meta.IsTierUnlocked('maw', 1, { defeatedBosses: ['centipede'] })).toBe(true);

      // Flak Cannon (Flak T1: Floor 2 Storm Gorgon)
      meta.ResetRunUnlocks();
      expect(meta.GetUpgradeChallengeDescription('flak', 1)).toBe('Defeat Storm Gorgon (Floor 2)');
      expect(meta.IsTierUnlocked('flak', 1, { floor: 2, bosses: 1 })).toBe(false);
      expect(meta.IsTierUnlocked('flak', 1, { floor: 3 })).toBe(true);

      // Seeker Needler (Needler T1: Floor 3 Infernal Colossus)
      meta.ResetRunUnlocks();
      expect(meta.GetUpgradeChallengeDescription('needler', 1)).toBe('Defeat Infernal Colossus (Floor 3)');
      expect(meta.IsTierUnlocked('needler', 1, { floor: 3, bosses: 2 })).toBe(false);
      expect(meta.IsTierUnlocked('needler', 1, { floor: 4 })).toBe(true);

      // Chrono Ward (Chrono T1: Floor 5 Chrono Wyrm)
      meta.ResetRunUnlocks();
      expect(meta.GetUpgradeChallengeDescription('chrono', 1)).toBe('Defeat Chrono Wyrm (Floor 5)');
      expect(meta.IsTierUnlocked('chrono', 1, { floor: 5, bosses: 4 })).toBe(false);
      expect(meta.IsTierUnlocked('chrono', 1, { floor: 6 })).toBe(true);
    });

    it('Tier 2 Bosses (Superconductor F7, Leviathan F8, Doppelgänger F10, Nanite Titan F17)', () => {
      // Attack Spitter (Turret T2: Floor 7 Superconductor)
      expect(meta.GetUpgradeChallengeDescription('turret', 2)).toBe('Defeat Apex Superconductor (Floor 7)');
      expect(meta.IsTierUnlocked('turret', 2, { floor: 7, bosses: 6 })).toBe(false);
      expect(meta.IsTierUnlocked('turret', 2, { floor: 8 })).toBe(true);

      // Magma Vent (Magma T2: Floor 8 Astral Leviathan)
      meta.ResetRunUnlocks();
      expect(meta.GetUpgradeChallengeDescription('magma', 2)).toBe('Defeat Astral Leviathan (Floor 8)');
      expect(meta.IsTierUnlocked('magma', 2, { floor: 8, bosses: 7 })).toBe(false);
      expect(meta.IsTierUnlocked('magma', 2, { floor: 9 })).toBe(true);

      // Cryo Mortar (Cryo T2: Floor 10 Shadow Doppelgänger)
      meta.ResetRunUnlocks();
      expect(meta.GetUpgradeChallengeDescription('cryo', 2)).toBe('Defeat Shadow Doppelgänger (Floor 10)');
      expect(meta.IsTierUnlocked('cryo', 2, { floor: 10, bosses: 9 })).toBe(false);
      expect(meta.IsTierUnlocked('cryo', 2, { floor: 11 })).toBe(true);

      // Tachyon Laser (Tachyon T2: Floor 17 Nanite Hive Titan)
      meta.ResetRunUnlocks();
      expect(meta.GetUpgradeChallengeDescription('tachyon', 2)).toBe('Defeat Nanite Hive Titan (Floor 17)');
      expect(meta.IsTierUnlocked('tachyon', 2, { floor: 17, bosses: 16 })).toBe(false);
      expect(meta.IsTierUnlocked('tachyon', 2, { floor: 18 })).toBe(true);
    });

    it('Tier 3 Apex Bosses (Prismatic Arachnid F15, The Eternal Ouroboros F20)', () => {
      // Turret T3: Floor 15 Prismatic Arachnid
      expect(meta.GetUpgradeChallengeDescription('turret', 3)).toBe('Defeat Prismatic Arachnid (Floor 15)');
      expect(meta.IsTierUnlocked('turret', 3, { floor: 15, bosses: 14 })).toBe(false);
      expect(meta.IsTierUnlocked('turret', 3, { floor: 16 })).toBe(true);

      // Cryo Mortar T3: Floor 20 The Eternal Ouroboros
      meta.ResetRunUnlocks();
      expect(meta.GetUpgradeChallengeDescription('cryo', 3)).toBe('Defeat The Eternal Ouroboros (Floor 20)');
      expect(meta.IsTierUnlocked('cryo', 3, { floor: 20, bosses: 19 })).toBe(false);
      expect(meta.IsTierUnlocked('cryo', 3, { floor: 21 })).toBe(true);
      expect(meta.IsTierUnlocked('cryo', 3, { summary: { victory: true } })).toBe(true);
    });
  });

  describe('6. Real-Time Engine & Telemetry Integration', () => {
    it('evaluates real-time enemy kills and food ingestion accurately via GameEngine', () => {
      engine.chooseMode('rogue');
      engine.selectedClass = 'emerald';
      engine.startRun();

      const combat = engine.Combat!;
      const world = engine.worldBag();

      expect(meta.IsTierUnlocked('magma', 1)).toBe(false);
      expect(meta.IsTierUnlocked('regen', 1)).toBe(false);

      // Ingest 30 Crimson Apples
      for (let i = 0; i < 30; i++) {
        combat.eatFood(new FoodItem(100, 100, 'apple'), world);
      }
      expect(meta.IsTierUnlocked('regen', 1)).toBe(true);

      // Slay 15 Swarmlings
      for (let i = 0; i < 15; i++) {
        combat.handleEnemyKill(new Enemy(100, 100, 'swarmling', 1), world);
      }
      expect(meta.IsTierUnlocked('magma', 1)).toBe(true);
    });
  });
});
