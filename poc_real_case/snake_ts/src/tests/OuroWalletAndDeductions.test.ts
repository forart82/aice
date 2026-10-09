/**
 * Ouroboros Ascension — Ouro Wallet Counting & Deductions Test Suite (OuroWalletAndDeductions.test.ts)
 *
 * Validates:
 * 1. SnakePlayer.GainXp() and GainOuro() strictly accumulate spendable Ouro wallet currency
 *    without running a draining while-loop that consumes Xp.
 * 2. SnakePlayer.SpendOuro() and spendOuro() atomically validate and deduct Ouro.
 * 3. SnakePlayer.Length, length, TotalLength, totalLength return Segments.length + 1.
 * 4. SnakeLabScreen purchase workflows atomically deduct Ouro via SpendOuro.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { SnakePlayer } from '../sim/SnakePlayer.js';
import { Services } from '../core/Services.js';
import { NullFx, NullSound } from '../core/Contracts.js';
import { setupMockDom } from './MockDom.js';
import { UiRoot } from '../ui/UiRoot.js';
import { SnakeLabScreen } from '../ui/screens/SnakeLabScreen.js';
import { MetaProgression } from '../data/MetaProgression.js';

describe('Ouro Wallet Counting & Deductions Test Suite', () => {
  beforeEach(() => {
    Services.Fx = new NullFx();
    Services.Sound = new NullSound();
    Services.Headless = true;
  });

  describe('1. GainXp & GainOuro Wallet Counting (No Draining While-Loop)', () => {
    it('strictly adds earned amount to Xp and TotalXpCollected without draining on level thresholds', () => {
      const player = new SnakePlayer('emerald');
      expect(player.Xp).toBe(0);
      expect(player.Ouro).toBe(0);
      expect(player.ouro).toBe(0);
      expect(player.TotalXpCollected).toBe(0);
      expect(player.TotalOuroCollected).toBe(0);

      // Gain 40 Ouro
      player.GainXp(40);
      expect(player.Xp).toBe(40);
      expect(player.Ouro).toBe(40);
      expect(player.TotalXpCollected).toBe(40);

      // Gain 70 more Ouro (Total = 110, exceeds standard 100 threshold)
      player.GainOuro(70);
      // In the old broken implementation, 100 was subtracted from Xp leaving 10.
      // In the fixed wallet implementation, player retains all 110 spendable Ouro!
      expect(player.Xp).toBe(110);
      expect(player.Ouro).toBe(110);
      expect(player.ouro).toBe(110);
      expect(player.TotalXpCollected).toBe(110);
      expect(player.TotalOuroCollected).toBe(110);

      // Gain massive Ouro (e.g. 5000)
      player.GainOuro(5000);
      expect(player.Xp).toBe(5110);
      expect(player.Ouro).toBe(5110);
      expect(player.TotalXpCollected).toBe(5110);
    });

    it('scales earned Ouro by Stats.XpGain multiplier', () => {
      const player = new SnakePlayer('emerald');
      player.Stats.XpGain = 1.5; // +50% Ouro gain

      player.GainOuro(100);
      expect(player.Xp).toBe(150);
      expect(player.TotalXpCollected).toBe(150);
    });

    it('ignores zero or negative amounts safely', () => {
      const player = new SnakePlayer('emerald');
      player.Xp = 50;
      player.TotalXpCollected = 50;

      expect(player.GainXp(0)).toBe(false);
      expect(player.GainXp(-20)).toBe(false);
      expect(player.GainOuro(0)).toBe(false);
      expect(player.gainOuro(-10)).toBe(false);

      expect(player.Xp).toBe(50);
      expect(player.TotalXpCollected).toBe(50);
    });
  });

  describe('2. SpendOuro & spendOuro Atomic Deductions', () => {
    it('returns true and does not change balance if cost <= 0', () => {
      const player = new SnakePlayer('emerald');
      player.Xp = 100;

      expect(player.SpendOuro(0)).toBe(true);
      expect(player.Xp).toBe(100);

      expect(player.spendOuro(-50)).toBe(true);
      expect(player.Xp).toBe(100);
    });

    it('returns false and preserves balance when cost > Xp balance', () => {
      const player = new SnakePlayer('emerald');
      player.Xp = 50;

      expect(player.SpendOuro(60)).toBe(false);
      expect(player.Xp).toBe(50);

      expect(player.spendOuro(50.01)).toBe(false);
      expect(player.Xp).toBe(50);
    });

    it('deducts cost atomically when cost <= Xp balance and returns true', () => {
      const player = new SnakePlayer('emerald');
      player.Xp = 100;

      expect(player.SpendOuro(30)).toBe(true);
      expect(player.Xp).toBe(70);
      expect(player.Ouro).toBe(70);
      expect(player.ouro).toBe(70);

      expect(player.spendOuro(70)).toBe(true);
      expect(player.Xp).toBe(0);
      expect(player.Ouro).toBe(0);
    });
  });

  describe('3. Length & TotalLength Getters', () => {
    it('returns Segments.length + 1 for Length, length, TotalLength, totalLength', () => {
      const player = new SnakePlayer('emerald', 1280, 720, 2);
      expect(player.Segments.length).toBe(2);
      expect(player.Length).toBe(3);
      expect(player.length).toBe(3);
      expect(player.TotalLength).toBe(3);
      expect(player.totalLength).toBe(3);

      // Add 2 segments
      player.addGrowth(2);
      expect(player.Segments.length).toBe(4);
      expect(player.Length).toBe(5);
      expect(player.length).toBe(5);
      expect(player.TotalLength).toBe(5);
      expect(player.totalLength).toBe(5);

      // Add 5 more segments
      player.addGrowth(5);
      expect(player.Segments.length).toBe(9);
      expect(player.Length).toBe(10);
      expect(player.length).toBe(10);
      expect(player.TotalLength).toBe(10);
      expect(player.totalLength).toBe(10);
    });
  });

  describe('4. SnakeLabScreen Purchases with SpendOuro', () => {
    it('atomically deducts Ouro via SpendOuro on head module purchase', () => {
      const restoreDom = setupMockDom();
      try {
        const container = document.createElement('div');
        const player = new SnakePlayer('emerald', 1280, 720, 2);
        player.Ouro = 100;
        const mockEngine: any = {
          player,
          state: 1,
        };

        const uiRoot = UiRoot.init(container as any, mockEngine);
        const lab = new SnakeLabScreen(uiRoot);
        uiRoot.registerScreen(lab);
        lab.show();
        lab.refresh();

        const buttons = Array.from(lab.element.querySelectorAll('.lab-docked-card-btn')) as HTMLButtonElement[];
        const spitterBtn = buttons.find((b) => b.textContent?.includes('Attack Spitter'))!;
        expect(spitterBtn).toBeDefined();

        // Cost of turret level 1 is 30 Ouro
        spitterBtn.click();

        expect(player.Ouro).toBe(70);
        expect(player.Xp).toBe(70);
        expect(player.GetHeadModuleLevel('turret')).toBe(1);
      } finally {
        restoreDom();
      }
    });

    it('atomically deducts Ouro via SpendOuro on cranial augment purchase', () => {
      const restoreDom = setupMockDom();
      try {
        const container = document.createElement('div');
        const player = new SnakePlayer('emerald', 1280, 720, 2);
        player.Ouro = 100;
        const mockEngine: any = {
          player,
          state: 1,
        };

        const meta = MetaProgression.Instance;
        meta.UnlockTier('fangs', 1);

        const uiRoot = UiRoot.init(container as any, mockEngine);
        const lab = new SnakeLabScreen(uiRoot);
        uiRoot.registerScreen(lab);
        lab.show();
        lab.refresh();

        const buttons = Array.from(lab.element.querySelectorAll('.lab-docked-card-btn')) as HTMLButtonElement[];
        const fangsBtn = buttons.find((b) => b.textContent?.includes('Venom Fangs'))!;
        expect(fangsBtn).toBeDefined();

        // Cost of fangs level 1 is 40 Ouro
        fangsBtn.click();

        expect(player.Ouro).toBe(60);
        expect(player.Xp).toBe(60);
        expect(player.GetHeadAugmentLevel('fangs')).toBe(1);
      } finally {
        restoreDom();
      }
    });
  });
});
