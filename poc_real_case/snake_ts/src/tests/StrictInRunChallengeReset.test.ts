/**
 * Ouroboros Ascension — Strict In-Run Roguelite Reset & Record Fallback Purge Test Suite
 *
 * Validates that all challenge unlock conditions evaluate exclusively against in-run metrics,
 * lifetime records never bypass locked tiers, and ResetRunUnlocks / StartGame / Init / Reset
 * enforce clean starter defaults (turret: 1, shield: 1)
 * with 0 installed head modules/augments and 0 in-run Ouro.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { MetaProgression } from '../data/MetaProgression.js';
import { GameEngine } from '../sim/GameEngine.js';
import { Services } from '../core/Services.js';

describe('Strict In-Run Roguelite Reset & Record Fallback Purge Suite', () => {
  let meta: MetaProgression;

  beforeEach(() => {
    meta = new MetaProgression();
    MetaProgression.Instance = meta;
    Services.registerMetaProvider(() => meta);
  });

  describe('1. Lifetime Record Fallback Purge', () => {
    it('does NOT unlock challenges via lifetime records when evaluated in a fresh run context', () => {
      // Seed lifetime records with maxed statistics
      meta.Records.TotalKills = 9999;
      meta.Records.TotalBosses = 999;
      meta.Records.HighestFloor = 20;
      meta.Records.TotalFoods = 9999;
      meta.Records.HighestCombo = 100;
      meta.Records.Victories = 10;

      meta.ResetRunUnlocks();
      expect(meta.IsTierUnlocked('flak', 1)).toBe(false);
      expect(meta.IsTierUnlocked('scattershot', 1)).toBe(false);
      expect(meta.IsTierUnlocked('needler', 1)).toBe(false);
      expect(meta.IsTierUnlocked('regen', 1)).toBe(false);
      expect(meta.IsTierUnlocked('magnet', 1)).toBe(false);
      expect(meta.IsTierUnlocked('chrono', 1)).toBe(false);
      expect(meta.IsTierUnlocked('maw', 1)).toBe(false);
      expect(meta.IsTierUnlocked('horns', 1)).toBe(false);
      expect(meta.IsTierUnlocked('crown', 1)).toBe(false);

      // Higher tiers must also remain locked despite lifetime records
      expect(meta.IsTierUnlocked('turret', 2)).toBe(false);
      expect(meta.IsTierUnlocked('tesla', 2)).toBe(false);
      expect(meta.IsTierUnlocked('venom', 2)).toBe(false);
      expect(meta.IsTierUnlocked('magma', 2)).toBe(false);
      expect(meta.IsTierUnlocked('cryo', 2)).toBe(false);
      expect(meta.IsTierUnlocked('tachyon', 2)).toBe(false);
      expect(meta.IsTierUnlocked('flak', 2)).toBe(false);
      expect(meta.IsTierUnlocked('needler', 2)).toBe(false);
      expect(meta.IsTierUnlocked('spikes', 2)).toBe(false);
      expect(meta.IsTierUnlocked('regen', 2)).toBe(false);
      expect(meta.IsTierUnlocked('magnet', 2)).toBe(false);
      expect(meta.IsTierUnlocked('chrono', 2)).toBe(false);
      expect(meta.IsTierUnlocked('fangs', 2)).toBe(false);
      expect(meta.IsTierUnlocked('horns', 2)).toBe(false);
      expect(meta.IsTierUnlocked('laser', 2)).toBe(false);
      expect(meta.IsTierUnlocked('crown', 2)).toBe(false);

      // Tier 3 checks
      expect(meta.IsTierUnlocked('turret', 3)).toBe(false);
      expect(meta.IsTierUnlocked('tesla', 3)).toBe(false);
      expect(meta.IsTierUnlocked('venom', 3)).toBe(false);
      expect(meta.IsTierUnlocked('cryo', 3)).toBe(false);
      expect(meta.IsTierUnlocked('flak', 3)).toBe(false);
      expect(meta.IsTierUnlocked('needler', 3)).toBe(false);
      expect(meta.IsTierUnlocked('spikes', 3)).toBe(false);
      expect(meta.IsTierUnlocked('regen', 3)).toBe(false);
      expect(meta.IsTierUnlocked('magnet', 3)).toBe(false);
      expect(meta.IsTierUnlocked('nanite', 3)).toBe(false);
      expect(meta.IsTierUnlocked('fangs', 3)).toBe(false);
      expect(meta.IsTierUnlocked('horns', 3)).toBe(false);
      expect(meta.IsTierUnlocked('crown', 3)).toBe(false);
    });

    it('direct challenge condition execution ignores lifetime records argument completely', () => {
      meta.Records.HighestFloor = 20;
      meta.Records.TotalBosses = 50;
      meta.Records.TotalKills = 1000;
      meta.Records.TotalFoods = 1000;
      meta.Records.HighestCombo = 50;

      const anyMeta = meta as any;
      const flak1 = anyMeta.getChallengeFor('flak', 1);
      expect(flak1).toBeDefined();
      // Calling condition with records passed as 1st argument and empty run summary / context
      expect(flak1.condition(meta.Records, undefined, undefined)).toBe(false);
      expect(flak1.condition(meta.Records, {}, { floor: 1, bosses: 0 })).toBe(false);

      const turret2 = anyMeta.getChallengeFor('turret', 2);
      expect(turret2).toBeDefined();
      expect(turret2.condition(meta.Records, undefined, undefined)).toBe(false);
      expect(turret2.condition(meta.Records, {}, { floor: 1, bosses: 0 })).toBe(false);

      const spikes3 = anyMeta.getChallengeFor('spikes', 3);
      expect(spikes3).toBeDefined();
      expect(spikes3.condition(meta.Records, undefined, undefined)).toBe(false);
      expect(spikes3.condition(meta.Records, {}, { bosses: 0 })).toBe(false);
    });
  });

  describe('2. In-Run Achievement Progression', () => {
    it('unlocks tiers dynamically when in-run context meets the condition', () => {
      meta.ResetRunUnlocks();

      // In-run food unlock
      expect(meta.IsTierUnlocked('regen', 1, { apples: 30 })).toBe(true);

      // In-run boss unlock
      expect(meta.IsTierUnlocked('flak', 1, { floor: 3, bosses: 2 })).toBe(true);

      // In-run combo unlock
      expect(meta.IsTierUnlocked('tesla', 2, { combo: 20 })).toBe(true);

      // In-run bestiary hunt unlock
      expect(meta.IsTierUnlocked('venom', 2, { arc_drones: 15 })).toBe(true);
    });
  });

  describe('3. Strict Starter Defaults in ResetRunUnlocks', () => {
    it('resets UnlockedTiers to starter defaults and clears CompletedChallenges', () => {
      // Simulate mid-run progress
      meta.UnlockedTiers['magma'] = 3;
      meta.UnlockedTiers['cryo'] = 2;
      meta.UnlockedTiers['turret'] = 3;
      meta.CompletedChallenges['ch_magma_1'] = true;
      meta.CompletedChallenges['ch_cryo_1'] = true;

      meta.ResetRunUnlocks();

      expect(meta.UnlockedTiers).toEqual({
        turret: 1,
        shield: 1,
      });
      expect(meta.CompletedChallenges).toEqual({});
    });
  });

  describe('4. GameEngine Run Lifecycle Integration', () => {
    it('resets meta run unlocks and starts player with 0 head modules and 0 ouro on StartGame / StartRun / Reset / Init', () => {
      const engine = new GameEngine();

      // Pre-pollute meta state
      meta.UnlockedTiers['magma'] = 3;
      meta.CompletedChallenges['ch_magma_1'] = true;

      // Test StartRun
      engine.StartRun();
      expect(meta.UnlockedTiers['magma']).toBeUndefined();
      expect(meta.UnlockedTiers['turret']).toBe(1);
      expect(engine.Player).toBeDefined();
      expect(Object.keys(engine.Player.HeadModules).length).toBe(0);
      expect(engine.Player.HeadAugment).toBeNull();
      expect(engine.Player.HeadPurchaseCount).toBe(0);
      expect(engine.Player.Ouro).toBe(0);

      // Install some head modules and add Ouro
      engine.Player.InstallHeadModule('turret');
      engine.Player.InstallHeadAugment('fangs');
      engine.Player.Ouro = 500;
      expect(engine.Player.GetHeadModuleLevel('turret')).toBe(1);
      expect(engine.Player.HeadAugment).toBe('fangs');
      expect(engine.Player.Ouro).toBe(500);

      // Test StartGame / startGame aliases
      expect(typeof (engine as any).StartGame).toBe('function');
      expect(typeof (engine as any).startGame).toBe('function');
      (engine as any).StartGame();
      expect(Object.keys(engine.Player.HeadModules).length).toBe(0);
      expect(engine.Player.HeadAugment).toBeNull();
      expect(engine.Player.HeadPurchaseCount).toBe(0);
      expect(engine.Player.Ouro).toBe(0);

      // Test Reset / reset aliases
      expect(typeof (engine as any).Reset).toBe('function');
      expect(typeof (engine as any).reset).toBe('function');
      engine.Player.InstallHeadModule('shield');
      engine.Player.Ouro = 200;
      (engine as any).Reset();
      expect(Object.keys(engine.Player.HeadModules).length).toBe(0);
      expect(engine.Player.HeadAugment).toBeNull();
      expect(engine.Player.HeadPurchaseCount).toBe(0);
      expect(engine.Player.Ouro).toBe(0);

      // Test Init / init aliases
      expect(typeof (engine as any).Init).toBe('function');
      expect(typeof (engine as any).init).toBe('function');
      engine.Player.InstallHeadModule('spikes');
      engine.Player.Ouro = 300;
      (engine as any).Init();
      expect(Object.keys(engine.Player.HeadModules).length).toBe(0);
      expect(engine.Player.HeadAugment).toBeNull();
      expect(engine.Player.HeadPurchaseCount).toBe(0);
      expect(engine.Player.Ouro).toBe(0);
    });
  });
});
