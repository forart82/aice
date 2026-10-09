/**
 * Ouroboros Ascension — Galaxy Jump Sacrifice & 8 Unique Helmets Test Suite
 *
 * Strict TDD test suite validating:
 *  1. 8 Unique Helmets data integrity and the 9th Omni-Helmet synthesis factory.
 *  2. Sacrifice value calculation based on helmet count and rarities.
 *  3. Galaxy Jump ritual: standard helmet destruction, probability curve P = 1 - exp(-score / 800).
 *  4. Unowned unique helmet drops without duplicates from the 8-helmet pool.
 *  5. 9th Omni-Helmet ("The Celestial Crown of the Eternal Ouroboros") synthesis and stat summation.
 *  6. Reset on final trial loss (wiping all 8 unique helmets to 0).
 *  7. Serialization, deserialization, and schema migration backward compatibility.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Rng } from '../core/Rng.js';
import { HelmetDef, HelmetRarity, HelmetStats } from '../data/Types.js';
import {
  UNIQUE_HELMETS,
  CELESTIAL_OUROBOROS_HELMET,
  UniqueHelmetDef,
  SACRIFICE_RARITY_VALUES,
  calculateSacrificeScore,
  calculateDetailedSacrificeScore,
  calculatePrestigeMultiplier,
  getUniqueHelmet,
  isUniqueHelmetId,
  getCanonicalHelmetId,
  forgeOmniHelmet,
} from '../data/UniqueHelmetsData.js';
import { MetaProgression } from '../data/MetaProgression.js';

describe('Galaxy Jump Sacrifice & Unique Helmets Engine (TDD)', () => {
  let meta: MetaProgression;

  beforeEach(() => {
    meta = MetaProgression.createIsolated();
  });

  describe('1. 8 Unique Helmets Data & 9th Omni-Helmet Definition', () => {
    it('should define exactly 8 unique helmets with distinct IDs, names, icons, lore, and stats', () => {
      expect(UNIQUE_HELMETS).toBeDefined();
      expect(UNIQUE_HELMETS.length).toBe(8);

      const ids = new Set<string>();
      const names = new Set<string>();

      for (const helm of UNIQUE_HELMETS) {
        expect(helm.Id).toBeTruthy();
        expect(helm.Name).toBeTruthy();
        expect(helm.Icon).toBeTruthy();
        expect(helm.Lore).toBeTruthy();
        expect(helm.SpecialCapacity).toBeTruthy();
        expect(helm.Stats).toBeDefined();
        expect(Object.keys(helm.Stats).length).toBeGreaterThan(0);
        expect(helm.IsUnique).toBe(true);

        // Ensure uniqueness
        expect(ids.has(helm.Id)).toBe(false);
        expect(names.has(helm.Name)).toBe(false);
        ids.add(helm.Id);
        names.add(helm.Name);
      }
    });

    it('should define authoritative image filepaths for all 8 unique helmets and the 9th Omni-Helmet', () => {
      const expectedPaths: Record<string, string> = {
        unique_helm_chrono_singularity: '/assets/helmets/chrono_singularity.jpg',
        unique_helm_adamantine_juggernaut: '/assets/helmets/adamantine_juggernaut.jpg',
        unique_helm_abyssal_leviathan: '/assets/helmets/abyssal_leviathan.jpg',
        unique_helm_solar_archon: '/assets/helmets/solar_archon.jpg',
        unique_helm_nanite_hivequeen: '/assets/helmets/nanite_hivequeen.jpg',
        unique_helm_volcanic_chimera: '/assets/helmets/volcanic_chimera.jpg',
        unique_helm_tempest_siren: '/assets/helmets/tempest_siren.jpg',
        unique_helm_prismatic_monolith: '/assets/helmets/prismatic_monolith.jpg',
      };

      for (const helm of UNIQUE_HELMETS) {
        expect(helm.Image).toBe(expectedPaths[helm.Id]);
        expect(helm.image).toBe(expectedPaths[helm.Id]);
      }

      const omni = CELESTIAL_OUROBOROS_HELMET;
      expect(omni.Image).toBe('/assets/helmets/celestial_ouroboros.jpg');
      expect(omni.image).toBe('/assets/helmets/celestial_ouroboros.jpg');
    });

    it('should define the 9th Omni-Helmet with summed stats across all 8 unique helmets', () => {
      const omni = CELESTIAL_OUROBOROS_HELMET;
      expect(omni).toBeDefined();
      expect(omni.Name).toBe('The Celestial Crown of the Eternal Ouroboros');
      expect(omni.IsUnique).toBe(true);
      expect(omni.IsOmni).toBe(true);
      expect(omni.Rarity).toBe('mythic');
      expect(omni.Lore).toBeTruthy();
      expect(omni.SpecialCapacity).toBeTruthy();

      // Calculate expected stat sums across the 8 unique helmets
      const expectedStats: Record<string, number> = {};
      for (const helm of UNIQUE_HELMETS) {
        for (const [k, v] of Object.entries(helm.Stats)) {
          if (typeof v === 'number') {
            expectedStats[k] = (expectedStats[k] || 0) + v;
          }
        }
      }

      for (const [k, expectedVal] of Object.entries(expectedStats)) {
        const actualVal = (omni.Stats as Record<string, number>)[k];
        expect(actualVal).toBeCloseTo(expectedVal, 2);
      }

      // Test factory function forgeOmniHelmet()
      const forged = forgeOmniHelmet();
      expect(forged.Id).toBe(omni.Id);
      expect(forged.Name).toBe('The Celestial Crown of the Eternal Ouroboros');
      expect(forged.Stats.bitePower).toBe(omni.Stats.bitePower);
    });
  });

  describe('2. Sacrifice Value Calculation', () => {
    it('should compute sacrifice scores scaling by count and rarity', () => {
      expect(calculateSacrificeScore([])).toBe(0);

      const commonHelm: HelmetDef = {
        Id: 'h_common',
        Name: 'Common Helm',
        Icon: '🪖',
        Rarity: 'common',
        Stats: { maxHp: 10 },
      };

      const epicHelm: HelmetDef = {
        Id: 'h_epic',
        Name: 'Epic Helm',
        Icon: '👑',
        Rarity: 'epic',
        Stats: { bitePower: 15 },
      };

      const mythicHelm: HelmetDef = {
        Id: 'h_mythic',
        Name: 'Mythic Helm',
        Icon: '💎',
        Rarity: 'mythic',
        Stats: { speed: 0.2 },
      };

      const scoreCommon = calculateSacrificeScore([commonHelm]);
      const scoreEpic = calculateSacrificeScore([epicHelm]);
      const scoreMythic = calculateSacrificeScore([mythicHelm]);

      expect(scoreCommon).toBe(SACRIFICE_RARITY_VALUES.common);
      expect(scoreEpic).toBe(SACRIFICE_RARITY_VALUES.epic);
      expect(scoreMythic).toBe(SACRIFICE_RARITY_VALUES.mythic);

      expect(scoreMythic).toBeGreaterThan(scoreEpic);
      expect(scoreEpic).toBeGreaterThan(scoreCommon);

      const multiScore = calculateSacrificeScore([commonHelm, epicHelm, mythicHelm]);
      expect(multiScore).toBe(scoreCommon + scoreEpic + scoreMythic);
    });
  });

  describe('3. Galaxy Jump Ritual & Helmet Destruction', () => {
    it('should destroy all sacrificed standard helmets from meta.Helmets', () => {
      const h1: HelmetDef = { Id: 'h1', Name: 'H1', Icon: '1', Rarity: 'common', Stats: {} };
      const h2: HelmetDef = { Id: 'h2', Name: 'H2', Icon: '2', Rarity: 'rare', Stats: {} };
      const h3: HelmetDef = { Id: 'h3', Name: 'H3', Icon: '3', Rarity: 'epic', Stats: {} };

      meta.AddHelmet(h1);
      meta.AddHelmet(h2);
      meta.AddHelmet(h3);
      meta.EquipHelmet('h2');

      expect(meta.Helmets.length).toBe(3);
      expect(meta.EquippedHelmetId).toBe('h2');

      // Sacrifice only a subset: h1 and h2
      meta.galaxyJump([h1, h2]);

      expect(meta.Helmets.length).toBe(1);
      expect(meta.Helmets[0].Id).toBe('h3');
      // Since equipped helmet h2 was sacrificed, it should be unequipped
      expect(meta.EquippedHelmetId).toBeNull();

      // Sacrifice remaining helmets without passing parameter (sacrifices all)
      meta.galaxyJump();
      expect(meta.Helmets.length).toBe(0);
    });

    it('should follow probability curve P = 1 - exp(-score / 800) and award unique helmet', () => {
      const testRng = new Rng(42);
      const mockMeta = MetaProgression.createIsolated({ rng: testRng });

      // Add helmets with high score
      for (let i = 0; i < 10; i++) {
        mockMeta.AddHelmet({
          Id: `h_mythic_${i}`,
          Name: `Mythic Helm ${i}`,
          Icon: '☀️',
          Rarity: 'mythic',
          Stats: {},
        });
      }

      const totalScore = calculateSacrificeScore(mockMeta.Helmets);
      const expectedProb = 1 - Math.exp(-totalScore / 800);
      expect(expectedProb).toBeGreaterThan(0.99); // Near 100% guarantee

      const result = mockMeta.galaxyJump();
      expect(result.sacrificeScore).toBe(totalScore);
      expect(result.success).toBe(true);
      expect(result.awardedHelmet).not.toBeNull();
      expect(mockMeta.UniqueHelmets.length).toBe(1);
      expect(mockMeta.UniqueHelmets).toContain(result.awardedHelmet!.Id);
      expect(mockMeta.Helmets.length).toBe(0);
    });

    it('should fail gracefully when score is 0 with zero helmets sacrificed', () => {
      const result = meta.galaxyJump([]);
      expect(result.success).toBe(false);
      expect(result.awardedHelmet).toBeNull();
      expect(result.sacrificeScore).toBe(0);
      expect(meta.UniqueHelmets.length).toBe(0);
    });
  });

  describe('4. Unique Helmet Pool & No Duplicates', () => {
    it('should never award duplicate unique helmets and exhaust the pool of 8', () => {
      // Deterministic RNG that always rolls 0 (ensuring 100% success)
      const mockRng = {
        rand: () => 0.001,
        range: (min: number, max: number) => min,
        chance: () => true,
        nextInt: () => 0,
        pick: <T>(arr: T[]) => arr[0],
      } as any;

      const fastMeta = MetaProgression.createIsolated({ rng: mockRng });

      for (let step = 1; step <= 8; step++) {
        fastMeta.AddHelmet({
          Id: `sac_${step}`,
          Name: `Sacrifice Helm ${step}`,
          Icon: '👑',
          Rarity: 'legendary',
          Stats: {},
        });

        const res = fastMeta.galaxyJump();
        expect(res.success).toBe(true);
        expect(res.awardedHelmet).not.toBeNull();
        expect(fastMeta.UniqueHelmets.length).toBe(step);

        // Check no duplicate IDs exist
        const set = new Set(fastMeta.UniqueHelmets);
        expect(set.size).toBe(step);
      }

      // Now all 8 are unlocked
      expect(fastMeta.UniqueHelmets.length).toBe(8);

      // Attempting 9th galaxy jump with full pool should not award duplicates
      fastMeta.AddHelmet({
        Id: 'extra_sac',
        Name: 'Extra Sacrifice',
        Icon: '💎',
        Rarity: 'mythic',
        Stats: {},
      });

      const overflowRes = fastMeta.galaxyJump();
      expect(overflowRes.awardedHelmet).toBeNull();
      expect(fastMeta.UniqueHelmets.length).toBe(8);
    });
  });

  describe('5. 9th Omni-Helmet Synthesis & Equipping', () => {
    it('should only allow forging the 9th helmet when all 8 unique helmets are collected', () => {
      expect(meta.canForge9thHelmet()).toBe(false);

      // Unlock 7 helmets
      meta.UniqueHelmets = UNIQUE_HELMETS.slice(0, 7).map(h => h.Id);
      expect(meta.canForge9thHelmet()).toBe(false);

      // Unlock 8th helmet
      meta.UniqueHelmets = UNIQUE_HELMETS.map(h => h.Id);
      expect(meta.canForge9thHelmet()).toBe(true);

      expect(meta.Has9thHelmet).toBe(false);
      const omni = meta.forge9thHelmet();
      expect(meta.Has9thHelmet).toBe(true);
      expect(omni.Name).toBe('The Celestial Crown of the Eternal Ouroboros');
      expect(omni.Id).toBe(CELESTIAL_OUROBOROS_HELMET.Id);

      // Equipping the 9th helmet
      meta.EquipHelmet(omni.Id);
      expect(meta.EquippedHelmetId).toBe(omni.Id);
      const equipped = meta.GetEquippedHelmet();
      expect(equipped).not.toBeNull();
      expect(equipped?.Name).toBe('The Celestial Crown of the Eternal Ouroboros');
    });
  });

  describe('6. Wipe on Final Trial Defeat', () => {
    it('should reset all 8 unique helmets back to 0 on defeat without destroying standard helmets', () => {
      // Setup meta with unique helmets and standard helmets
      meta.UniqueHelmets = UNIQUE_HELMETS.map(h => h.Id);
      meta.forge9thHelmet();
      meta.EquipHelmet(CELESTIAL_OUROBOROS_HELMET.Id);

      const standardHelm: HelmetDef = {
        Id: 'saved_std',
        Name: 'Saved Standard Helm',
        Icon: '🪖',
        Rarity: 'rare',
        Stats: { maxHp: 15 },
      };
      meta.AddHelmet(standardHelm);

      expect(meta.UniqueHelmets.length).toBe(8);
      expect(meta.Has9thHelmet).toBe(true);
      expect(meta.EquippedHelmetId).toBe(CELESTIAL_OUROBOROS_HELMET.Id);
      expect(meta.Helmets.length).toBe(1);

      // Player loses final trial: execute reset
      meta.resetUniqueHelmets();

      expect(meta.UniqueHelmets.length).toBe(0);
      expect(meta.Has9thHelmet).toBe(false);
      // Since equipped helmet was the 9th helmet, it should be cleared
      expect(meta.EquippedHelmetId).toBeNull();
      // Standard helmets remain intact
      expect(meta.Helmets.length).toBe(1);
      expect(meta.Helmets[0].Id).toBe('saved_std');
    });
  });

  describe('7. Serialization, Deserialization & Migration Fallback', () => {
    it('should serialize and deserialize unique helmet progress correctly', () => {
      meta.UniqueHelmets = [UNIQUE_HELMETS[0].Id, UNIQUE_HELMETS[1].Id];
      meta.Has9thHelmet = false;

      const serialized = meta.serialize();
      expect(typeof serialized).toBe('string');
      expect(serialized).toContain(UNIQUE_HELMETS[0].Id);

      const restoredMeta = MetaProgression.createIsolated();
      restoredMeta.deserialize(serialized);

      expect(restoredMeta.UniqueHelmets.length).toBe(2);
      expect(restoredMeta.UniqueHelmets).toContain(UNIQUE_HELMETS[0].Id);
      expect(restoredMeta.UniqueHelmets).toContain(UNIQUE_HELMETS[1].Id);
      expect(restoredMeta.Has9thHelmet).toBe(false);
    });

    it('should handle legacy saves lacking unique helmet fields gracefully', () => {
      const legacySave = JSON.stringify({
        version: 1,
        shards: 150,
        highScore: 5000,
      });

      const freshMeta = MetaProgression.createIsolated();
      freshMeta.deserialize(legacySave);

      expect(freshMeta.UniqueHelmets).toEqual([]);
      expect(freshMeta.Has9thHelmet).toBe(false);
      expect(freshMeta.Shards).toBe(150);
    });

    it('should gracefully handle malformed JSON strings without throwing', () => {
      const badMeta = MetaProgression.createIsolated();
      expect(() => badMeta.deserialize('{ invalid json ]')).not.toThrow();
      expect(badMeta.UniqueHelmets).toEqual([]);
      expect(badMeta.Has9thHelmet).toBe(false);
    });
  });

  describe('8. Canonical IDs, Prestige Calculation & Crucible Escalation (ORACLE.md Alignment)', () => {
    it('8.1 verifies all 8 Unique Helmets and 9th Omni Crown possess canonical IDs and aliases per Table 10.2.2', () => {
      const canonicalMap: Record<string, string> = {
        unique_helm_chrono_singularity: 'unique_chronos_eye',
        unique_helm_adamantine_juggernaut: 'unique_colossus_crown',
        unique_helm_abyssal_leviathan: 'unique_behemoth_maw',
        unique_helm_solar_archon: 'unique_solar_crest',
        unique_helm_nanite_hivequeen: 'unique_nanite_hivequeen',
        unique_helm_volcanic_chimera: 'unique_leviathan_wings',
        unique_helm_tempest_siren: 'unique_gorgon_gaze',
        unique_helm_prismatic_monolith: 'unique_void_horns',
      };

      for (const helm of UNIQUE_HELMETS) {
        expect(helm.CanonicalId).toBe(canonicalMap[helm.Id]);
        expect(helm.canonicalId).toBe(canonicalMap[helm.Id]);
        expect(helm.AliasId).toBe(helm.Id);
        expect(helm.PrimordialAspect).toBeTruthy();

        // Helper lookup verification
        expect(getUniqueHelmet(helm.Id)).toBe(helm);
        expect(getUniqueHelmet(helm.CanonicalId!)).toBe(helm);
        expect(isUniqueHelmetId(helm.Id)).toBe(true);
        expect(isUniqueHelmetId(helm.CanonicalId!)).toBe(true);
        expect(getCanonicalHelmetId(helm.Id)).toBe(helm.CanonicalId);
      }

      // 9th Omni Crown verification
      const omni = CELESTIAL_OUROBOROS_HELMET;
      expect(omni.CanonicalId).toBe('unique_eternal_ouroboros_crown');
      expect(omni.canonicalId).toBe('unique_eternal_ouroboros_crown');
      expect(getUniqueHelmet('unique_eternal_ouroboros_crown')).toBe(omni);
      expect(getUniqueHelmet('helm_ouroboros_ascension_9th')).toBe(omni);
      expect(isUniqueHelmetId('unique_eternal_ouroboros_crown')).toBe(true);
    });

    it('8.2 calculates Galaxy Jump Prestige Multiplier via P_mult = 1 + 0.5 * N_helmets + 0.1 * Floor', () => {
      // 0 helmets on Floor 1: 1 + 0 + 0.1 = 1.1
      expect(calculatePrestigeMultiplier(0, 1)).toBe(1.1);

      // 4 helmets on Floor 10: 1 + 0.5 * 4 + 0.1 * 10 = 1 + 2.0 + 1.0 = 4.0
      expect(calculatePrestigeMultiplier(4, 10)).toBe(4.0);

      // 8 helmets on Floor 20: 1 + 0.5 * 8 + 0.1 * 20 = 1 + 4.0 + 2.0 = 7.0
      expect(calculatePrestigeMultiplier(8, 20)).toBe(7.0);

      // Edge cases: handles 0 or negative values gracefully
      expect(calculatePrestigeMultiplier(0, 0)).toBe(1.1);
    });

    it('8.3 calculates detailed sacrifice scores scaling with affixes, floor, and power per Section 10.4.1', () => {
      const standardHelm: HelmetDef = {
        Id: 'test_helm',
        Name: 'Test Crown',
        Icon: '🪖',
        Rarity: 'rare',
        Floor: 5,
        Stats: {
          maxHp: 20,
          bitePower: 15,
        },
      };

      // affixes = 2 (maxHp, bitePower), floor = 5, power = 20 + 15 = 35
      // itemValue = 50 * 2 + 10 * 5 + 35 = 100 + 50 + 35 = 185
      // rare multiplier = 2.5 => 185 * 2.5 = 462.5 -> 463
      const detailedScore = calculateDetailedSacrificeScore([standardHelm]);
      expect(detailedScore).toBe(463);
    });

    it('8.4 awards Consolation Stardust Bonus on Galaxy Jump roll failure', () => {
      // RNG that always fails roll
      const failRng = {
        rand: () => 0.999,
        range: (min: number, max: number) => max,
        chance: () => false,
        nextInt: () => 1,
        pick: <T>(arr: T[]) => arr[0],
      } as any;

      const testMeta = MetaProgression.createIsolated({ rng: failRng });
      testMeta.Ouro = 100;
      testMeta.Shards = 50;

      testMeta.AddHelmet({
        Id: 'sac_rare',
        Name: 'Sacrifice Rare',
        Icon: '🪖',
        Rarity: 'rare',
        Stats: {},
      });

      const score = calculateSacrificeScore(testMeta.Helmets);
      expect(score).toBe(120);

      const result = testMeta.galaxyJump(undefined, 5);
      expect(result.success).toBe(false);
      expect(result.awardedHelmet).toBeNull();
      expect(result.consolationOuro).toBe(Math.floor(120 * 2.5)); // 300
      expect(result.consolationShards).toBe(Math.floor(120 / 20)); // 6

      // Verifies balances received consolation rewards
      expect(testMeta.Ouro).toBe(100 + 300);
      expect(testMeta.Shards).toBe(50 + 6);
      expect(testMeta.PrestigeMultiplier).toBe(calculatePrestigeMultiplier(0, 5));
    });

    it('8.5 awards Ascendant Crucible Surge (+10,000 Ouro, +500 Shards) when all 8 unique helmets are collected', () => {
      const succeedRng = {
        rand: () => 0.001,
        range: (min: number, max: number) => min,
        chance: () => true,
        nextInt: () => 0,
        pick: <T>(arr: T[]) => arr[0],
      } as any;

      const fullMeta = MetaProgression.createIsolated({ rng: succeedRng });
      fullMeta.UniqueHelmets = UNIQUE_HELMETS.map(h => h.Id);
      fullMeta.Ouro = 500;
      fullMeta.Shards = 200;

      fullMeta.AddHelmet({
        Id: 'extra_sacrifice',
        Name: 'Extra Sacrifice',
        Icon: '👑',
        Rarity: 'mythic',
        Stats: {},
      });

      const res = fullMeta.galaxyJump(undefined, 10);
      expect(res.success).toBe(true);
      expect(res.awardedHelmet).toBeNull();
      expect(res.consolationOuro).toBe(10000);
      expect(res.consolationShards).toBe(500);

      // Verify balances boosted by crucible surge
      expect(fullMeta.Ouro).toBe(500 + 10000);
      expect(fullMeta.Shards).toBe(200 + 500);
      expect(fullMeta.PrestigeMultiplier).toBe(calculatePrestigeMultiplier(8, 10));
    });

    it('8.6 enforces persistent shard and ouro retention across Galaxy Jump and Permaloss Defeat', () => {
      const testMeta = MetaProgression.createIsolated();
      testMeta.Shards = 1250;
      testMeta.Ouro = 4500;
      testMeta.UniqueHelmets = [UNIQUE_HELMETS[0].Id, UNIQUE_HELMETS[1].Id];

      // Add a standard helmet and jump
      testMeta.AddHelmet({
        Id: 'std_helm',
        Name: 'Std Helm',
        Icon: '🪖',
        Rarity: 'common',
        Stats: {},
      });
      testMeta.galaxyJump();

      // Shards & Ouro remain strictly intact
      expect(testMeta.Shards).toBeGreaterThanOrEqual(1250);
      expect(testMeta.Ouro).toBeGreaterThanOrEqual(4500);

      // Permaloss defeat in boss rush wipes unique helmets but preserves shards and ouro
      testMeta.resetUniqueHelmets();
      expect(testMeta.UniqueHelmets).toEqual([]);
      expect(testMeta.Shards).toBeGreaterThanOrEqual(1250);
      expect(testMeta.Ouro).toBeGreaterThanOrEqual(4500);
    });
  });
});
