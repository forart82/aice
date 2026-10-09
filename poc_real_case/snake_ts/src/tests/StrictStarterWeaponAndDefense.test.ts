/**
 * Ouroboros Ascension — Strict 1-Starter Weapon & 1-Starter Defense Test Suite
 *
 * Enforces the Single Starter Weapon (turret) and Single Starter Defense (shield) rule,
 * and verifies that tesla, venom, spikes, and fangs are strictly locked at run start (Tier 1)
 * with dedicated, engaging in-run challenge unlock conditions.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { MetaProgression } from '../data/MetaProgression.js';
import { SaveIO } from '../platform/SaveIO.js';

describe('Strict 1 Starter Weapon and 1 Starter Defense Rule', () => {
  let meta: MetaProgression;

  beforeEach(() => {
    SaveIO.memoryBackendEnabled = true;
    SaveIO.clearMemory();
    MetaProgression.Instance = new MetaProgression();
    meta = MetaProgression.Instance;
  });

  describe('1. Starter Defaults: Strictly 1 Weapon & 1 Defense', () => {
    it('1.1 unlocks ONLY turret and shield by default at Tier 1 without challenges', () => {
      expect(meta.IsTierUnlocked('turret', 1)).toBe(true);
      expect(meta.IsTierUnlocked('shield', 1)).toBe(true);

      // Verify challenge descriptions for starters indicate no challenge required
      expect(meta.GetUpgradeChallengeDescription('turret', 1)).toBe('Complete Challenges to Unlock');
      expect(meta.GetUpgradeChallengeDescription('shield', 1)).toBe('Complete Challenges to Unlock');
    });

    it('1.2 locks tesla, venom, spikes, and fangs by default at Tier 1 on fresh run start', () => {
      expect(meta.IsTierUnlocked('tesla', 1)).toBe(false);
      expect(meta.IsTierUnlocked('venom', 1)).toBe(false);
      expect(meta.IsTierUnlocked('spikes', 1)).toBe(false);
      expect(meta.IsTierUnlocked('fangs', 1)).toBe(false);
    });

    it('1.3 ResetRunUnlocks() resets UnlockedTiers strictly to turret and shield only', () => {
      // Force unlock all
      meta.UnlockTier('turret', 3);
      meta.UnlockTier('shield', 3);
      meta.UnlockTier('tesla', 2);
      meta.UnlockTier('venom', 2);
      meta.UnlockTier('spikes', 2);
      meta.UnlockTier('fangs', 2);

      meta.ResetRunUnlocks();

      expect(meta.UnlockedTiers).toEqual({
        turret: 1,
        shield: 1,
      });
      expect(meta.IsTierUnlocked('turret', 1)).toBe(true);
      expect(meta.IsTierUnlocked('shield', 1)).toBe(true);
      expect(meta.IsTierUnlocked('tesla', 1)).toBe(false);
      expect(meta.IsTierUnlocked('venom', 1)).toBe(false);
      expect(meta.IsTierUnlocked('spikes', 1)).toBe(false);
      expect(meta.IsTierUnlocked('fangs', 1)).toBe(false);
    });
  });

  describe('2. Dedicated Tier 1 In-Run Challenges for Newly Locked Items', () => {
    it('2.1 Tesla [Tier 1]: Maintain a Combo Streak of 8x (combo >= 8)', () => {
      expect(meta.GetUpgradeChallengeDescription('tesla', 1)).toBe('Maintain a Combo Streak of 8x');
      expect(meta.IsTierUnlocked('tesla', 1, { combo: 7 })).toBe(false);
      expect(meta.IsTierUnlocked('tesla', 1, { combo: 8 })).toBe(true);

      meta.ResetRunUnlocks();
      expect(meta.IsTierUnlocked('tesla', 1, { combo: 10 })).toBe(true);
    });

    it('2.2 Venom [Tier 1]: Slay 20 Enemies in a run (kills >= 20)', () => {
      expect(meta.GetUpgradeChallengeDescription('venom', 1)).toBe('Slay 20 Enemies in a run');
      expect(meta.IsTierUnlocked('venom', 1, { kills: 19 })).toBe(false);
      expect(meta.IsTierUnlocked('venom', 1, { kills: 20 })).toBe(true);

      meta.ResetRunUnlocks();
      expect(meta.IsTierUnlocked('venom', 1, { kills: 25 })).toBe(true);
    });

    it('2.3 Spikes [Tier 1]: Slay 10 Armored Scarabs in a run (killsByType["scarab"] >= 10 or kills >= 10)', () => {
      expect(meta.GetUpgradeChallengeDescription('spikes', 1)).toBe('Slay 10 Armored Scarabs in a run');
      expect(meta.IsTierUnlocked('spikes', 1, { scarabs: 9, kills: 9 })).toBe(false);
      expect(meta.IsTierUnlocked('spikes', 1, { scarabs: 10 })).toBe(true);

      meta.ResetRunUnlocks();
      expect(meta.IsTierUnlocked('spikes', 1, { killsByType: { scarab: 10 } })).toBe(true);

      meta.ResetRunUnlocks();
      expect(meta.IsTierUnlocked('spikes', 1, { kills: 10 })).toBe(true);
    });

    it('2.4 Fangs [Tier 1]: Maintain a Combo Streak of 15x (combo >= 15)', () => {
      expect(meta.GetUpgradeChallengeDescription('fangs', 1)).toBe('Maintain a Combo Streak of 15x');
      expect(meta.IsTierUnlocked('fangs', 1, { combo: 14 })).toBe(false);
      expect(meta.IsTierUnlocked('fangs', 1, { combo: 15 })).toBe(true);

      meta.ResetRunUnlocks();
      expect(meta.IsTierUnlocked('fangs', 1, { combo: 20 })).toBe(true);
    });
  });
});
