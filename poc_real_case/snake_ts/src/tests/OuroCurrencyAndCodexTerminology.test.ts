/**
 * Ouroboros Ascension — Ouro Currency & Codex Terminology Test Suite (OuroCurrencyAndCodexTerminology.test.ts)
 *
 * Validates:
 * 1. SnakePlayer camelCase/PascalCase ouro/Ouro getters and setters.
 * 2. SnakePlayer totalOuroCollected/TotalOuroCollected getters and setters.
 * 3. SnakePlayer GainOuro() and gainOuro() currency gain methods.
 * 4. CodexData in-run terminology updates from XP to Ouro across ambient drops,
 *    Cranial Lab upgrades, Frenzy multipliers, and Card Draft descriptions.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { SnakePlayer } from '../sim/SnakePlayer.js';
import { GameData } from '../data/GameData.js';
import { CodexData } from '../data/CodexData.js';
import { Services } from '../core/Services.js';
import { NullFx, NullSound } from '../core/Contracts.js';

describe('Ouro Currency Aliases & Codex Terminology Test Suite', () => {
  beforeEach(() => {
    Services.fx = new NullFx();
    Services.sound = new NullSound();
    Services.headless = true;
  });

  describe('1. SnakePlayer Ouro Getters, Setters & Helper Methods', () => {
    it('provides dual camelCase and PascalCase getters and setters for ouro / Ouro', () => {
      const player = new SnakePlayer('emerald');

      // Initial state
      expect(player.ouro).toBe(0);
      expect(player.Ouro).toBe(0);
      expect(player.Xp).toBe(0);

      // Setter via camelCase
      player.ouro = 150;
      expect(player.ouro).toBe(150);
      expect(player.Ouro).toBe(150);
      expect(player.Xp).toBe(150);

      // Setter via PascalCase
      player.Ouro = 320;
      expect(player.ouro).toBe(320);
      expect(player.Ouro).toBe(320);
      expect(player.Xp).toBe(320);
    });

    it('provides totalOuroCollected / TotalOuroCollected getters and setters', () => {
      const player = new SnakePlayer('emerald');

      expect(player.totalOuroCollected).toBe(0);
      expect(player.TotalOuroCollected).toBe(0);

      player.totalOuroCollected = 750;
      expect(player.TotalXpCollected).toBe(750);
      expect(player.totalOuroCollected).toBe(750);
      expect(player.TotalOuroCollected).toBe(750);

      player.TotalOuroCollected = 1200;
      expect(player.TotalXpCollected).toBe(1200);
      expect(player.totalOuroCollected).toBe(1200);
      expect(player.TotalOuroCollected).toBe(1200);
    });

    it('GainOuro and gainOuro accurately accumulate spendable currency without draining wallet', () => {
      const player = new SnakePlayer('emerald');

      // Gain small Ouro
      player.gainOuro(40);
      expect(player.ouro).toBe(40);
      expect(player.totalOuroCollected).toBe(40);

      // Gain additional Ouro (Total = 110)
      player.GainOuro(70);
      expect(player.ouro).toBe(110);
      expect(player.totalOuroCollected).toBe(110);
    });
  });

  describe('2. CodexData In-Run Terminology Verification', () => {
    it('verifies ambient drops reference Ouro instead of XP in rules_food_economy', () => {
      const entry = CodexData.Entries.find((e) => e.id === 'rules_food_economy');
      expect(entry).toBeDefined();
      if (!entry) return;

      expect(entry.summary).toContain('Ouro');
      expect(entry.summary).not.toContain('XP');

      expect(entry.contentHtml).toContain('gain Ouro');
      expect(entry.contentHtml).toContain('awards Ouro');
      expect(entry.contentHtml).toContain('3x Ouro');
      expect(entry.contentHtml).toContain('+1 Ouro');
      expect(entry.contentHtml).toContain('+4 Ouro');
      expect(entry.contentHtml).toContain('+2 Ouro');
      expect(entry.contentHtml).toContain('+3 Ouro');
      expect(entry.contentHtml).toContain('+4 Ouro');
      expect(entry.contentHtml).toContain('+5 Ouro');
      expect(entry.contentHtml).toContain('+15 Ouro');

      expect(entry.contentHtml).not.toContain('+5 XP');
      expect(entry.contentHtml).not.toContain('+20 XP');
      expect(entry.contentHtml).not.toContain('+6 XP');
    });

    it('verifies Cranial Lab upgrade costs reference Ouro in classes_cranial_lab', () => {
      const entry = CodexData.Entries.find((e) => e.id === 'classes_cranial_lab');
      expect(entry).toBeDefined();
      if (!entry) return;

      expect(entry.contentHtml).toContain('30×lvl + p×15 Ouro');
      expect(entry.contentHtml).toContain('40×lvl + p×20 Ouro');
      expect(entry.contentHtml).toContain('Escalating Ouro Cost');
      expect(entry.contentHtml).toContain('+15 Ouro');
      expect(entry.contentHtml).toContain('+20 Ouro');

      expect(entry.formulaHtml).toContain('15\\text{ Ouro}');
      expect(entry.formulaHtml).toContain('20\\text{ Ouro}');
    });

    it('verifies combo frenzy and card draft descriptions reference Ouro', () => {
      const frenzyEntry = CodexData.Entries.find((e) => e.id === 'rules_combo_overdrive');
      expect(frenzyEntry).toBeDefined();
      if (frenzyEntry) {
        expect(frenzyEntry.contentHtml).toContain('double Ouro');
      }

      const cardEntry = CodexData.Entries.find((e) => e.id === 'combat_card_drafts');
      expect(cardEntry).toBeDefined();
      if (cardEntry) {
        expect(cardEntry.contentHtml).toContain('Gourmand (+20% Ouro)');
        expect(cardEntry.contentHtml).toContain('Soul Harvest (Soul drops, +60% kill Ouro)');
      }

      const constrictionEntry = CodexData.Entries.find((e) => e.id === 'combat_constriction');
      expect(constrictionEntry).toBeDefined();
      if (constrictionEntry) {
        expect(constrictionEntry.contentHtml).toContain('+300% Ouro');
        expect(constrictionEntry.formulaHtml).toContain('+300% Ouro');
      }
    });

    it('verifies master equations formulas and level-up formulas reference Ouro without XP', () => {
      const mathEntry = CodexData.Entries.find((e) => e.id === 'formulas_master_equations');
      expect(mathEntry).toBeDefined();
      if (mathEntry) {
        expect(mathEntry.subtitle).not.toContain('XP');
        expect(mathEntry.subtitle).toContain('Ouro');
        expect(mathEntry.summary).not.toContain('XP');
        expect(mathEntry.summary).toContain('Ouro');
        expect(mathEntry.contentHtml).not.toContain('XP');
        expect(mathEntry.formulaHtml).not.toContain('XP_{req}');
        expect(mathEntry.formulaHtml).toContain('Ouro_{req}');
      }

      const cardEntry = CodexData.Entries.find((e) => e.id === 'combat_card_drafts');
      expect(cardEntry).toBeDefined();
      if (cardEntry) {
        expect(cardEntry.formulaHtml).not.toContain('XP');
        expect(cardEntry.formulaHtml).toContain('Ouro_{req}');
      }
    });
  });

  describe('3. GameData Cards & Relic Descriptions Terminology Verification', () => {
    it('verifies Gourmand, Combo Surge, and Soul Harvest card descriptions reference Ouro', () => {
      const gourmand = GameData.CardPool.find((c) => (c.id || c.Id) === 'gourmand');
      expect(gourmand).toBeDefined();
      expect(gourmand!.stats).toBe('+20% Ouro Gained');
      expect(gourmand!.stats).not.toContain('XP');

      const comboSurge = GameData.CardPool.find((c) => (c.id || c.Id) === 'combo_surge');
      expect(comboSurge).toBeDefined();
      expect(comboSurge!.stats).toContain('Ouro');
      expect(comboSurge!.stats).not.toContain('XP');

      const soulHarvest = GameData.CardPool.find((c) => (c.id || c.Id) === 'soul_harvest');
      expect(soulHarvest).toBeDefined();
      expect(soulHarvest!.stats).toBe('Kills drop soul orbs, +60% kill Ouro');
      expect(soulHarvest!.stats).not.toContain('XP');
    });
  });

  describe('4. Helmets Formatter Terminology Verification', () => {
    it('formats xpMultiplier affix description as Ouro instead of XP', async () => {
      const { formatHelmetStatDescription } = await import('../data/Helmets.js');
      const desc = formatHelmetStatDescription({ xpMultiplier: 0.25, armor: 0.1 });
      expect(desc).toContain('+25% Ouro');
      expect(desc).not.toContain('XP');
    });
  });

  describe('5. DevChecklistData Terminology Verification', () => {
    it('verifies DevChecklistData subtitles, subtasks, and diagnostics reference Ouro instead of XP', async () => {
      const { DevChecklistData } = await import('../data/DevChecklistData.js');
      const cranialItem = DevChecklistData.Items.find((i) => i.id === 'cranial_bio');
      expect(cranialItem).toBeDefined();
      if (cranialItem) {
        expect(cranialItem.subtitle).not.toContain('XP');
        expect(cranialItem.subtitle).toContain('Ouro');
        expect(cranialItem.summary).not.toContain('XP');
        expect(cranialItem.summary).toContain('Ouro');

        for (const sub of cranialItem.subtasks) {
          expect(sub.title).not.toContain('XP');
          expect(sub.description).not.toContain('XP');
        }

        for (const diag of cranialItem.diagnostics) {
          expect(diag.label).not.toContain('XP');
          expect(diag.expectedBehavior).not.toContain('XP');
          expect(diag.failureSignature).not.toContain('XP');
        }
      }

      const labUxItem = DevChecklistData.Items.find((i) => i.id === 'lab_ux');
      expect(labUxItem).toBeDefined();
      if (labUxItem) {
        expect(labUxItem.technicalAnalysis).not.toContain('XP');
        expect(labUxItem.technicalAnalysis).toContain('Ouro');
      }
    });
  });

  describe('6. SnakeLabScreen UI Telemetry & Action Labels Verification', () => {
    it('renders Ouro stat chip and Ouro cost action labels in SnakeLabScreen', async () => {
      const { setupMockDom } = await import('./MockDom.js');
      const restoreDom = setupMockDom();
      try {
        const { SnakeLabScreen } = await import('../ui/screens/SnakeLabScreen.js');
        const { UiRoot } = await import('../ui/UiRoot.js');

        const container = document.createElement('div');
        const mockEngine: any = {
          player: new SnakePlayer('emerald', 1280, 720, 2),
          state: 1,
        };
        mockEngine.player.ouro = 150;
        mockEngine.player.headHp = 50;
        mockEngine.player.headMaxHp = 50;

        const uiRoot = UiRoot.init(container as any, mockEngine);
        const lab = new SnakeLabScreen(uiRoot);
        lab.show();

        const statChips = Array.from(lab.element.querySelectorAll('.lab-stat-chip'));
        const ouroChip = statChips.find((c) => c.textContent?.includes('Ouro'));
        expect(ouroChip).toBeDefined();
        expect(ouroChip?.textContent).toContain('🪙 150 Ouro');
        expect(lab.element.innerHTML).not.toContain('XP</span>');

        // Check head augment and module cost labels in buttons
        const actionBtns = Array.from(lab.element.querySelectorAll('.lab-docked-card-btn'));
        expect(actionBtns.length).toBeGreaterThan(0);
        for (const btn of actionBtns) {
          expect(btn.textContent).not.toContain('XP');
          expect(btn.textContent).not.toContain('⚡)');
        }
      } finally {
        restoreDom();
      }
    });

    it('verifies wallet synchronization: spending in lab updates both lab chip and HUD counter', async () => {
      const { setupMockDom } = await import('./MockDom.js');
      const restoreDom = setupMockDom();
      try {
        const { SnakeLabScreen } = await import('../ui/screens/SnakeLabScreen.js');
        const { UiRoot } = await import('../ui/UiRoot.js');

        const container = document.createElement('div');
        const mockEngine: any = {
          player: new SnakePlayer('emerald', 1280, 720, 2),
          state: 1,
        };
        mockEngine.player.ouro = 100;
        mockEngine.player.headHp = 50;
        mockEngine.player.headMaxHp = 50;

        const uiRoot = UiRoot.init(container as any, mockEngine);
        const lab = new SnakeLabScreen(uiRoot);
        uiRoot.registerScreen(lab);
        lab.show();
        lab.refresh();

        const hud = uiRoot.hudView;
        hud.refresh(mockEngine);

        expect(lab.element.querySelector('.lab-stat-chip-ouro')?.textContent).toContain('🪙 100 Ouro');
        expect(hud.element.querySelector('.hud-ouro-val, .hud-xp-val')?.textContent).toBe('100');

        const buttons = Array.from(lab.element.querySelectorAll('.lab-docked-card-btn')) as HTMLButtonElement[];
        const spitterBtn = buttons.find((b) => b.textContent?.includes('Attack Spitter'))!;
        expect(spitterBtn).toBeDefined();

        spitterBtn.click();

        expect(mockEngine.player.ouro).toBe(70);

        expect(lab.element.querySelector('.lab-stat-chip-ouro')?.textContent).toContain('🪙 70 Ouro');
        expect(hud.element.querySelector('.hud-ouro-val, .hud-xp-val')?.textContent).toBe('70');
      } finally {
        restoreDom();
      }
    });
  });
});
