import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { setupMockDom } from './MockDom.js';
import { UiRoot } from '../ui/UiRoot.js';
import { SnakeLabScreen } from '../ui/screens/SnakeLabScreen.js';
import { SnakePlayer } from '../sim/SnakePlayer.js';
import { MetaProgression } from '../data/MetaProgression.js';
import { Services } from '../core/Services.js';
import { NullFx, NullSound } from '../core/Contracts.js';

describe('SnakeLab Mobile Card Vertical Stack Layout Architecture & Zero-Overlap Test Suite', () => {
  let restoreDom: () => void;
  let player: SnakePlayer;
  let mockEngine: any;
  let uiRoot: UiRoot;
  let lab: SnakeLabScreen;

  beforeEach(() => {
    restoreDom = setupMockDom();
    Services.Sound = new NullSound();
    Services.Fx = new NullFx();

    MetaProgression.readBackend = () => null;
    MetaProgression.writeBackend = () => {};
    MetaProgression.deleteBackend = () => {};
    MetaProgression.instance = new MetaProgression();
    MetaProgression.Instance.reset();

    player = new SnakePlayer('emerald', 1280, 720, 3);
    player.ouro = 0;
    player.xp = 0;

    mockEngine = {
      player,
      state: 'Playing',
      currentFloor: 1,
      combat: {
        score: 1250,
        shardsEarned: 5,
        comboCount: 3,
        highestCombo: 8,
        foodsEatenByType: { apple: 10, golden: 2 },
        killsByType: { swarmling: 12, scarab: 3 },
        defeatedBossTypes: ['guardian'],
      },
    };

    const container = document.createElement('div');
    uiRoot = UiRoot.init(container as any, mockEngine);
    lab = new SnakeLabScreen(uiRoot);
    uiRoot.registerScreen(lab);
  });

  afterEach(() => {
    restoreDom();
  });

  describe('1. 4-Row Vertical Stack Architecture for Head Module & Augment Cards', () => {
    it('1.1 Header Row 1: Segregates Icon+Title on left from Clean Level Badge on right with flex-shrink: 0 and 13px/10px typography', () => {
      lab.show({ tab: 'mutations' });
      lab.refresh();

      const cards = Array.from(lab.element.querySelectorAll('.lab-docked-card-btn')) as HTMLButtonElement[];
      expect(cards.length).toBeGreaterThanOrEqual(20);

      for (const card of cards) {
        const headerRow = card.querySelector('.card-header-row') as HTMLElement;
        expect(headerRow).not.toBeNull();
        expect(headerRow.style.display).toBe('flex');
        expect(headerRow.style.justifyContent).toBe('space-between');
        expect(headerRow.style.alignItems).toBe('center');

        const titleEl = headerRow.querySelector('.card-title') as HTMLElement;
        expect(titleEl).not.toBeNull();
        expect(titleEl.style.fontSize).toBe('13px');
        expect(titleEl.style.fontWeight).toBe('700');

        const badgeEl = headerRow.querySelector('.challenge-level-badge') as HTMLElement;
        expect(badgeEl).not.toBeNull();
        expect(badgeEl.style.fontSize).toBe('10px');
        expect(badgeEl.style.fontWeight).toBe('700');
        expect(badgeEl.style.flexShrink).toBe('0');
      }
    });

    it('1.2 Benefit Row 2: Renders single concise benefit description on its own full-width line with 11px font and #94a3b8 color', () => {
      lab.show({ tab: 'mutations' });
      lab.refresh();

      const cards = Array.from(lab.element.querySelectorAll('.lab-docked-card-btn')) as HTMLButtonElement[];
      for (const card of cards) {
        const benefitRow = card.querySelector('.card-benefit-row') as HTMLElement;
        expect(benefitRow).not.toBeNull();
        expect(benefitRow.style.fontSize).toBe('11px');
        expect(benefitRow.textContent).toBeTruthy();
      }
    });

    it('1.3 Challenge Track Row 3 (when locked): Feat label, progress bar, metric count, and ZERO nested buttons', () => {
      lab.show({ tab: 'mutations' });
      lab.refresh();

      const cards = Array.from(lab.element.querySelectorAll('.lab-docked-card-btn.locked')) as HTMLButtonElement[];
      expect(cards.length).toBeGreaterThan(0);

      for (const card of cards) {
        const featRow = card.querySelector('.card-challenge-row') as HTMLElement;
        expect(featRow).not.toBeNull();

        const featLabel = featRow.querySelector('.challenge-feat-label') as HTMLElement;
        expect(featLabel).not.toBeNull();
        expect(featLabel.textContent).toContain('🎯 Feat:');
        expect(featLabel.style.fontSize).toBe('10.5px');

        const progressBar = featRow.querySelector('.challenge-bar-container') as HTMLElement;
        expect(progressBar).not.toBeNull();

        const metricRow = featRow.querySelector('.challenge-metric-row') as HTMLElement;
        expect(metricRow).not.toBeNull();
        expect(metricRow.style.fontSize).toBe('10px');

        // ZERO nested buttons on Row 3
        expect(featRow.querySelectorAll('button').length).toBe(0);
      }
    });

    it('1.4 Purchase Action Row 4 (when unlocked or locked): Action/cost tag is rendered cleanly on bottom row', () => {
      // Unaffordable unlocked card
      player.ouro = 5;
      lab.show({ tab: 'mutations' });
      lab.refresh();

      const cards = Array.from(lab.element.querySelectorAll('.lab-docked-card-btn')) as HTMLButtonElement[];
      const spitter = cards.find(c => c.textContent?.includes('Attack Spitter'))!;
      expect(spitter).toBeDefined();

      const costTag = spitter.querySelector('.cost-tag') as HTMLElement;
      expect(costTag).not.toBeNull();
      expect(costTag.textContent).toContain('30');
      expect(costTag.textContent).toContain('Need 25 more');

      // Max level card
      player.setHeadModuleLevel('turret', 3);
      lab.refresh();

      const maxSpitter = Array.from(lab.element.querySelectorAll('.lab-docked-card-btn')).find(c => c.textContent?.includes('Attack Spitter'))!;
      const maxTag = maxSpitter.querySelector('.cost-tag.max-level') as HTMLElement;
      expect(maxTag).not.toBeNull();
      expect(maxTag.textContent).toContain('[MAX LEVEL]');
    });
  });

  describe('2. Helmet Vault & Telemetry Mobile Layout Zero-Overlap Conformance', () => {
    it('2.1 Helmet Vault cards use clean vertical stack with non-wrapping flex-shrink badge', () => {
      // Give player a boss helmet
      MetaProgression.Instance.AddHelmet({
        Id: 'test_helm',
        Name: 'Obsidian Crown',
        Rarity: 'epic',
        Icon: '👑',
        Stats: { Armor: 10, BitePower: 0.25 },
        Description: 'Forged from deep tectonic obsidian.',
        id: 'test_helm',
        name: 'Obsidian Crown',
        rarity: 'epic',
        icon: '👑',
        stats: { armor: 10, bitePower: 0.25 },
        description: 'Forged from deep tectonic obsidian.',
      });

      lab.show({ tab: 'helmets' });
      lab.refresh();

      const helmetCards = Array.from(lab.element.querySelectorAll('.helmet-card')) as HTMLElement[];
      expect(helmetCards.length).toBe(1);

      const card = helmetCards[0];
      const rarityBadge = card.querySelector('.helmet-rarity-badge') as HTMLElement;
      expect(rarityBadge).not.toBeNull();
      expect(rarityBadge.style.flexShrink).toBe('0');

      const equipBtn = card.querySelector('.btn-equip-helmet') as HTMLButtonElement;
      expect(equipBtn).not.toBeNull();
      expect(equipBtn.style.width).toBe('100%');
    });

    it('2.2 Telemetry Section vitals and bestiary grids use fluid responsive minmax columns', () => {
      lab.show({ tab: 'telemetry' });
      lab.refresh();

      const vitalsGrid = lab.element.querySelector('.stats-vitals-grid') as HTMLElement;
      expect(vitalsGrid).not.toBeNull();
      expect(vitalsGrid.querySelectorAll('.stat-card').length).toBeGreaterThanOrEqual(8);

      const bestiaryGrid = lab.element.querySelector('.bestiary-grid') as HTMLElement;
      expect(bestiaryGrid).not.toBeNull();
      expect(bestiaryGrid.querySelectorAll('.bestiary-pill').length).toBe(6);
    });
  });
});
