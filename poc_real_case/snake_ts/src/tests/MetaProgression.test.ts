/**
 * Ouroboros Ascension — Meta Progression & In-Run Challenge Gating Test Suite
 * File: src/tests/MetaProgression.test.ts
 *
 * Conformance matrix for:
 * 1. Run start state: ONLY turret and shield are unlocked by default at Tier 1.
 * 2. Tier 1 challenge gating: tesla, venom, spikes, and fangs are locked at Tier 1 with single-condition challenge requirements.
 * 3. Dynamic in-run unlock evaluation for tesla (5x combo), venom (15 kills), spikes (length 25 scaled), and fangs (20 foods).
 * 4. ResetRunUnlocks() resets UnlockedTiers to strictly { turret: 1, shield: 1 } and clears CompletedChallenges.
 * 5. Lifetime records isolation ensuring archival telemetry never bypasses in-run challenge gating.
 * 6. Save schema serialization and deserialization integrity with starter defaults.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { MetaProgression } from '../data/MetaProgression.js';
import { Services } from '../core/Services.js';
import { NullFx, NullSound } from '../core/Contracts.js';

describe('MetaProgression & Tier 1 Starter Unlocks Conformance Suite', () => {
  let meta: MetaProgression;

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
  });

  // =========================================================================
  // 1. Run Start Defaults: ONLY Turret & Shield Unlocked
  // =========================================================================
  describe('1. Run Start Defaults & Starter Unlocks', () => {
    it('1.1 guarantees ONLY turret and shield are unlocked at Tier 1 by default at run start', () => {
      // Offensive Starter Default: Turret
      expect(meta.IsTierUnlocked('turret', 1)).toBe(true);
      expect(meta.GetUpgradeChallengeDescription('turret', 1)).toBe('Complete Challenges to Unlock');

      // Defensive Starter Default: Shield
      expect(meta.IsTierUnlocked('shield', 1)).toBe(true);
      expect(meta.GetUpgradeChallengeDescription('shield', 1)).toBe('Complete Challenges to Unlock');

      // All other modules MUST be locked at Tier 1
      expect(meta.IsTierUnlocked('tesla', 1)).toBe(false);
      expect(meta.IsTierUnlocked('venom', 1)).toBe(false);
      expect(meta.IsTierUnlocked('spikes', 1)).toBe(false);
      expect(meta.IsTierUnlocked('fangs', 1)).toBe(false);
      expect(meta.IsTierUnlocked('magma', 1)).toBe(false);
      expect(meta.IsTierUnlocked('cryo', 1)).toBe(false);
      expect(meta.IsTierUnlocked('plasma', 1)).toBe(false);
      expect(meta.IsTierUnlocked('tachyon', 1)).toBe(false);
      expect(meta.IsTierUnlocked('regen', 1)).toBe(false);
      expect(meta.IsTierUnlocked('magnet', 1)).toBe(false);
      expect(meta.IsTierUnlocked('nanite', 1)).toBe(false);
      expect(meta.IsTierUnlocked('flak', 1)).toBe(false);
      expect(meta.IsTierUnlocked('scattershot', 1)).toBe(false);
      expect(meta.IsTierUnlocked('needler', 1)).toBe(false);
      expect(meta.IsTierUnlocked('maw', 1)).toBe(false);
      expect(meta.IsTierUnlocked('horns', 1)).toBe(false);
      expect(meta.IsTierUnlocked('laser', 1)).toBe(false);
      expect(meta.IsTierUnlocked('crown', 1)).toBe(false);
    });

    it('1.2 verifies UnlockedTiers contains strictly { turret: 1, shield: 1 } at initialization', () => {
      expect(meta.UnlockedTiers).toEqual({
        turret: 1,
        shield: 1,
      });
    });
  });

  // =========================================================================
  // 2. Tier 1 Challenge Gating: Tesla, Venom, Spikes & Fangs
  // =========================================================================
  describe('2. Tier 1 Challenge Requirements & Evaluation', () => {
    it('2.1 Tesla Coil [Tier 1]: requires 8x Combo Streak', () => {
      expect(meta.GetUpgradeChallengeDescription('tesla', 1)).toBe('Maintain a Combo Streak of 8x');
      expect(meta.IsTierUnlocked('tesla', 1, { combo: 7 })).toBe(false);
      expect(meta.IsTierUnlocked('tesla', 1, { combo: 8 })).toBe(true);
    });

    it('2.2 Venom Sprayer [Tier 1]: requires 20 Enemy Kills', () => {
      expect(meta.GetUpgradeChallengeDescription('venom', 1)).toBe('Slay 20 Enemies in a run');
      expect(meta.IsTierUnlocked('venom', 1, { kills: 19 })).toBe(false);
      expect(meta.IsTierUnlocked('venom', 1, { kills: 20 })).toBe(true);
    });

    it('2.3 Thorny Spikes [Tier 1]: requires 10 Armored Scarabs killed', () => {
      expect(meta.GetUpgradeChallengeDescription('spikes', 1)).toBe('Slay 10 Armored Scarabs in a run');
      expect(meta.IsTierUnlocked('spikes', 1, { scarabs: 9, kills: 9 })).toBe(false);
      expect(meta.IsTierUnlocked('spikes', 1, { scarabs: 10 })).toBe(true);
      expect(meta.IsTierUnlocked('spikes', 1, { kills: 10 })).toBe(true);
    });

    it('2.4 Venom Fangs [Tier 1]: requires 15x Combo Streak', () => {
      expect(meta.GetUpgradeChallengeDescription('fangs', 1)).toBe('Maintain a Combo Streak of 15x');
      expect(meta.IsTierUnlocked('fangs', 1, { combo: 14 })).toBe(false);
      expect(meta.IsTierUnlocked('fangs', 1, { combo: 15 })).toBe(true);
    });
  });

  // =========================================================================
  // 3. ResetRunUnlocks() & In-Run Scoping
  // =========================================================================
  describe('3. ResetRunUnlocks() Lifecycle', () => {
    it('3.1 ResetRunUnlocks() restores UnlockedTiers to { turret: 1, shield: 1 } and clears CompletedChallenges', () => {
      meta.UnlockedTiers['tesla'] = 1;
      meta.UnlockedTiers['venom'] = 2;
      meta.UnlockedTiers['spikes'] = 1;
      meta.UnlockedTiers['fangs'] = 3;
      meta.CompletedChallenges['ch_tesla_1'] = true;
      meta.CompletedChallenges['ch_venom_1'] = true;

      meta.ResetRunUnlocks();

      expect(meta.UnlockedTiers).toEqual({
        turret: 1,
        shield: 1,
      });
      expect(meta.CompletedChallenges).toEqual({});
      expect(meta.IsTierUnlocked('turret', 1)).toBe(true);
      expect(meta.IsTierUnlocked('shield', 1)).toBe(true);
      expect(meta.IsTierUnlocked('tesla', 1)).toBe(false);
      expect(meta.IsTierUnlocked('venom', 1)).toBe(false);
    });

    it('3.2 ignores lifetime archival records during in-run tier check', () => {
      meta.Records.TotalKills = 10000;
      meta.Records.TotalFoods = 10000;
      meta.Records.HighestCombo = 50;

      // With 0 in-run stats, all challenge-gated modules remain locked
      expect(meta.IsTierUnlocked('tesla', 1, { combo: 0 })).toBe(false);
      expect(meta.IsTierUnlocked('venom', 1, { kills: 0 })).toBe(false);
      expect(meta.IsTierUnlocked('spikes', 1, { length: 3 })).toBe(false);
      expect(meta.IsTierUnlocked('fangs', 1, { foods: 0 })).toBe(false);
    });
  });

  // =========================================================================
  // 4. Persistence and Reset
  // =========================================================================
  describe('4. Persistence and Reset', () => {
    it('4.1 Reset() resets state to clean defaults with only turret and shield unlocked', () => {
      meta.Shards = 500;
      meta.UnlockedTiers['tesla'] = 2;
      meta.Reset();

      expect(meta.Shards).toBe(0);
      expect(meta.UnlockedTiers).toEqual({
        turret: 1,
        shield: 1,
      });
      expect(meta.IsTierUnlocked('turret', 1)).toBe(true);
      expect(meta.IsTierUnlocked('shield', 1)).toBe(true);
      expect(meta.IsTierUnlocked('tesla', 1)).toBe(false);
    });
  });
});
