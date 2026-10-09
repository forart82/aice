/**
 * Ouroboros Ascension — 3 Segregated Views Cranial Mutation Lab & Expedition Hub Test Suite
 * File: src/tests/SegregatedThreeViewSnakeLab.test.ts
 *
 * Conformance matrix for:
 * 1. Top Header: Title with Floor, 6 Quick Chips Bar, and 3-Button Segmented Tab Bar ([ 🧬 Mutations ] [ 🪖 Helmets (N) ] [ 📊 Statistics ]).
 * 2. Tab 1 (🧬 Mutations / .btn-tab-lab): Cranial Mutation & Challenge Cards Grid (1 starter weapon [turret] and 1 starter defense [shield] unlocked).
 * 3. Tab 2 (🪖 Helmets (N) / .btn-tab-helmets): Dedicated Boss Helmet Vault & active equipped helmet showcase card.
 * 4. Tab 3 (📊 Statistics / .btn-tab-stats / .btn-tab-telemetry): Dedicated in-run expedition telemetry view (Vitals, Nourishment, Bestiary, Boss Defeats).
 * 5. Segregation: Tab switcher toggles cleanly and only displays the active view.
 * 6. Bottom Bar: DEPLOY / RESUME EXPEDITION ⚡ action button.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupMockDom } from './MockDom';
import { UiRoot } from '../ui/UiRoot';
import { SnakeLabScreen } from '../ui/screens/SnakeLabScreen';
import { SnakePlayer } from '../sim/SnakePlayer';
import { MetaProgression } from '../data/MetaProgression';
import { Services } from '../core/Services';
import { NullFx, NullSound } from '../core/Contracts';
import { GameState } from '../sim/GameState';
import { HelmetDef } from '../data/Helmets';

class SoundSpy extends NullSound {
  public uiCount = 0;
  public levelUpCount = 0;
  public errorCount = 0;

  public override playUi(): void { this.uiCount++; }
  public override playLevelUp(): void { this.levelUpCount++; }
  public override playError(): void { this.errorCount++; }
}

describe('3 Segregated Views Cranial Mutation Lab & Expedition Hub', () => {
  let restoreDom: () => void;
  let soundSpy: SoundSpy;
  let player: SnakePlayer;
  let mockEngine: any;
  let uiRoot: UiRoot;
  let labScreen: SnakeLabScreen;

  beforeEach(() => {
    restoreDom = setupMockDom();
    soundSpy = new SoundSpy();
    Services.Sound = soundSpy;
    Services.Fx = new NullFx();

    MetaProgression.readBackend = () => null;
    MetaProgression.writeBackend = () => {};
    MetaProgression.deleteBackend = () => {};
    MetaProgression.instance = new MetaProgression();
    MetaProgression.Instance.reset();

    player = new SnakePlayer('emerald', 1280, 720, 4); // 4 body + 1 head = 5
    player.ouro = 250;
    player.xp = 250;
    player.headHp = 42;
    player.headMaxHp = 50;
    player.PeakLength = 9;

    mockEngine = {
      player,
      Player: player,
      state: GameState.Playing,
      State: GameState.Playing,
      currentFloor: 4,
      CurrentFloor: 4,
      combat: {
        score: 48200,
        Score: 48200,
        kills: 35,
        Kills: 35,
        bossKills: 2,
        BossKills: 2,
        foodsEaten: 42,
        FoodsEaten: 42,
        comboCount: 6,
        ComboCount: 6,
        highestRunCombo: 14,
        HighestRunCombo: 14,
        shardsEarned: 18,
        ShardsEarned: 18,
        defeatedBossTypes: ['centipede', 'gorgon'],
        DefeatedBossTypes: ['centipede', 'gorgon'],
        foodsEatenByType: { apple: 24, golden: 6, potion: 3, shard: 7, prism: 2 },
        killsByType: { swarmling: 18, scarab: 8, spitter: 5, phantom: 2, drone: 1, brute: 1 },
      },
      resume: vi.fn(),
      Resume: vi.fn(),
      completeLevelUp: vi.fn(),
      CompleteLevelUp: vi.fn(),
    };

    const container = document.createElement('div');
    uiRoot = UiRoot.init(container as any, mockEngine);
    labScreen = new SnakeLabScreen(uiRoot);
    uiRoot.registerScreen(labScreen);
  });

  afterEach(() => {
    restoreDom();
    vi.restoreAllMocks();
  });

  // =========================================================================
  // 1. Top Header: Title, 6 Quick Chips, and 3-Button Segmented Tab Bar
  // =========================================================================
  describe('1. Top Header & 3-Button Segmented Tab Bar', () => {
    it('1.1 renders exact title with floor number and 6 quick chips', () => {
      labScreen.show();
      expect(labScreen.element.querySelector('.cyber-modal-title')?.textContent).toBe('🧬 CRANIAL MUTATION LAB & EXPEDITION HUB (FLOOR 4)');

      const chips = labScreen.element.querySelectorAll('.lab-stat-chip');
      expect(chips.length).toBe(6);

      const chipTexts = Array.from(chips).map((c) => c.textContent);
      expect(chipTexts.some((t) => t?.includes('250 Ouro'))).toBe(true);
      expect(chipTexts.some((t) => t?.includes('Floor 4'))).toBe(true);
      expect(chipTexts.some((t) => t?.includes('Len 5 (📏 5 Segs)'))).toBe(true);
      expect(chipTexts.some((t) => t?.includes('48200') || t?.includes('48,200'))).toBe(true);
      expect(chipTexts.some((t) => t?.includes('42/50'))).toBe(true);
      expect(chipTexts.some((t) => t?.includes('6x'))).toBe(true);
    });

    it('1.2 renders 3-button segmented tab bar with Mutations, Helmets, and Statistics', () => {
      labScreen.show();
      const tabLab = labScreen.element.querySelector('.btn-tab-lab') as HTMLButtonElement;
      const tabHelmets = labScreen.element.querySelector('.btn-tab-helmets') as HTMLButtonElement;
      const tabStats = (labScreen.element.querySelector('.btn-tab-stats') || labScreen.element.querySelector('.btn-tab-telemetry')) as HTMLButtonElement;

      expect(tabLab).not.toBeNull();
      expect(tabHelmets).not.toBeNull();
      expect(tabStats).not.toBeNull();

      expect(tabLab.textContent).toContain('Mutations');
      expect(tabHelmets.textContent).toContain('Helmets (0)');
      expect(tabStats.textContent).toContain('Statistics');
    });
  });

  // =========================================================================
  // 2. Tab 1: 🧬 Mutations (Cranial Mutation & Challenge Cards Grid)
  // =========================================================================
  describe('2. Tab 1: 🧬 Mutations View', () => {
    it('2.1 renders Cranial Mutation & Challenge Cards Grid exclusively on Tab 1', () => {
      labScreen.show();
      expect(labScreen.activeTab).toBe('lab');

      // Check sections rendered on Tab 1
      expect(labScreen.element.textContent).toContain('OFFENSIVE WEAPONS');
      expect(labScreen.element.textContent).toContain('DEFENSIVE BIO-ORGANS');
      expect(labScreen.element.textContent).toContain('CRANIAL BIO-AUGMENTATIONS');

      // Ensure Tab 2 and Tab 3 specific contents are NOT rendered in the container
      expect(labScreen.element.querySelector('.stats-vitals-grid')).toBeNull();
      expect(labScreen.element.querySelector('.equipped-helmet-container')).toBeNull();
      expect(labScreen.element.querySelector('.food-breakdown-grid')).toBeNull();
      expect(labScreen.element.querySelector('.bestiary-grid')).toBeNull();
      expect(labScreen.element.querySelector('.boss-defeats-list')).toBeNull();
    });

    it('2.2 strictly unlocks turret & shield at run start; locks all other cards with challenge tracks', () => {
      mockEngine.currentFloor = 1;
      mockEngine.CurrentFloor = 1;
      mockEngine.combat.kills = 0;
      mockEngine.combat.comboCount = 0;
      mockEngine.combat.highestRunCombo = 0;
      mockEngine.combat.bossKills = 0;
      mockEngine.combat.foodsEaten = 0;
      mockEngine.combat.killsByType = {};
      mockEngine.combat.foodsEatenByType = {};

      labScreen.show();
      labScreen.refresh();

      const cardButtons = Array.from(labScreen.element.querySelectorAll('.lab-docked-card-btn')) as HTMLButtonElement[];

      // Unlocked starters: Attack Spitter (turret) and Carapace Shield (shield)
      const spitterBtn = cardButtons.find((b) => b.textContent?.includes('Attack Spitter'))!;
      const shieldBtn = cardButtons.find((b) => b.textContent?.includes('Carapace Shield'))!;
      expect(spitterBtn.className).toContain('btn-affordable');
      expect(shieldBtn.className).toContain('btn-affordable');

      // Locked weapons/defenses/augments
      const teslaBtn = cardButtons.find((b) => b.textContent?.includes('Bio-Arc Coil'))!;
      expect(teslaBtn.className).toContain('btn-tier-locked');

      const fangsBtn = cardButtons.find((b) => b.textContent?.includes('Venom Fangs'))!;
      expect(fangsBtn.className).toContain('btn-tier-locked');
    });
  });

  // =========================================================================
  // 3. Tab 2: 🪖 Helmets (Boss Helmet Vault & Active Showcase)
  // =========================================================================
  describe('3. Tab 2: 🪖 Helmets View', () => {
    it('3.1 renders dedicated Boss Helmet Vault & active equipped showcase exclusively on Tab 2', () => {
      const meta = MetaProgression.Instance;
      const testHelm: HelmetDef = {
        Id: 'helm_behemoth',
        id: 'helm_behemoth',
        Name: 'Behemoth Carapace',
        name: 'Behemoth Carapace',
        Icon: '🪖',
        icon: '🪖',
        Rarity: 'rare',
        rarity: 'rare',
        Stats: { maxHp: 30, armor: 0.15 },
        stats: { maxHp: 30, armor: 0.15 },
        Description: 'Heavy cybernetic plating.',
        description: 'Heavy cybernetic plating.',
        Floor: 1,
        floor: 1,
        BossType: 'centipede',
        bossType: 'centipede',
      };
      meta.addHelmet(testHelm);

      labScreen.show();
      const tabHelmets = labScreen.element.querySelector('.btn-tab-helmets') as HTMLButtonElement;
      tabHelmets.click();

      expect(labScreen.activeTab).toBe('helmets');

      // Helmets view rendered
      expect(labScreen.element.querySelector('.equipped-helmet-container')).not.toBeNull();
      expect(labScreen.element.textContent).toContain('COLLECTED BOSS HELMETS (1)');
      expect(labScreen.element.textContent).toContain('Behemoth Carapace');

      // Mutations grid and Telemetry view NOT in container
      expect(labScreen.element.textContent).not.toContain('OFFENSIVE WEAPONS');
      expect(labScreen.element.querySelector('.stats-vitals-grid')).toBeNull();
      expect(labScreen.element.querySelector('.food-breakdown-grid')).toBeNull();

      // Equip helmet toggle
      const equipBtn = labScreen.element.querySelector('.btn-equip-helmet') as HTMLButtonElement;
      expect(equipBtn).not.toBeNull();
      equipBtn.click();

      expect(meta.EquippedHelmetId).toBe('helm_behemoth');
      expect((player as any).EquippedHelmet?.id).toBe('helm_behemoth');

      // Unequip toggle
      const unequipBtn = labScreen.element.querySelector('.btn-unequip-helmet') as HTMLButtonElement;
      expect(unequipBtn).not.toBeNull();
      unequipBtn.click();

      expect(meta.EquippedHelmetId).toBeNull();
      expect((player as any).EquippedHelmet).toBeNull();
    });
  });

  // =========================================================================
  // 4. Tab 3: 📊 Statistics (Expedition Telemetry, Vitals, Bestiary, Boss History)
  // =========================================================================
  describe('4. Tab 3: 📊 Statistics View', () => {
    it('4.1 renders dedicated in-run expedition telemetry view exclusively on Tab 3', () => {
      labScreen.show();
      const tabStats = (labScreen.element.querySelector('.btn-tab-stats') || labScreen.element.querySelector('.btn-tab-telemetry')) as HTMLButtonElement;
      tabStats.click();

      expect(labScreen.activeTab).toBe('telemetry');

      // Statistics components present
      expect(labScreen.element.querySelector('.stats-vitals-grid')).not.toBeNull();
      expect(labScreen.element.querySelector('.food-breakdown-grid')).not.toBeNull();
      expect(labScreen.element.querySelector('.bestiary-grid')).not.toBeNull();
      expect(labScreen.element.querySelector('.boss-defeats-list')).not.toBeNull();

      // Check Vitals metrics
      expect(labScreen.element.querySelector('.stat-score-val')?.textContent).toContain('48,200');
      expect(labScreen.element.querySelector('.stat-ouro-val')?.textContent).toContain('250 🪙');
      expect(labScreen.element.querySelector('.stat-length-val')?.textContent).toBe('5');
      expect(labScreen.element.querySelector('.stat-headhp-val')?.textContent).toContain('42/50');

      // Check Food breakdown
      expect(labScreen.element.querySelector('.food-apple-count')?.textContent).toBe('24');
      expect(labScreen.element.querySelector('.food-golden-count')?.textContent).toBe('6');
      expect(labScreen.element.querySelector('.food-potion-count')?.textContent).toBe('3');
      expect(labScreen.element.querySelector('.food-shard-count')?.textContent).toBe('7');
      expect(labScreen.element.querySelector('.food-prism-count')?.textContent).toBe('2');

      // Check Bestiary
      expect(labScreen.element.querySelector('.kill-swarmling-count')?.textContent).toBe('18');
      expect(labScreen.element.querySelector('.kill-scarab-count')?.textContent).toBe('8');
      expect(labScreen.element.querySelector('.kill-spitter-count')?.textContent).toBe('5');
      expect(labScreen.element.querySelector('.kill-phantom-count')?.textContent).toBe('2');
      expect(labScreen.element.querySelector('.kill-drone-count')?.textContent).toBe('1');
      expect(labScreen.element.querySelector('.kill-brute-count')?.textContent).toBe('1');

      // Check Conquered Apex Bosses history
      const bossList = labScreen.element.querySelector('.boss-defeats-list')!;
      expect(bossList.textContent).toContain('Floor 1');
      expect(bossList.textContent).toContain('Floor 2');
      expect(bossList.textContent).toContain('CLEARED');

      // Mutations and Helmet vault NOT in container
      expect(labScreen.element.textContent).not.toContain('OFFENSIVE WEAPONS');
      expect(labScreen.element.querySelector('.equipped-helmet-container')).toBeNull();
    });
  });

  // =========================================================================
  // 5. Tab Switcher Clean Viewport Toggling
  // =========================================================================
  describe('5. Clean Tab Viewport Switching', () => {
    it('5.1 switches seamlessly between all 3 views and updates active tab styling', () => {
      labScreen.show();
      const tabLab = labScreen.element.querySelector('.btn-tab-lab') as HTMLButtonElement;
      const tabHelmets = labScreen.element.querySelector('.btn-tab-helmets') as HTMLButtonElement;
      const tabStats = (labScreen.element.querySelector('.btn-tab-stats') || labScreen.element.querySelector('.btn-tab-telemetry')) as HTMLButtonElement;

      // Start on Mutations (lab)
      expect(labScreen.activeTab).toBe('lab');
      expect(tabLab.className).toContain('btn-primary');
      expect(tabHelmets.className).toContain('btn-secondary');
      expect(tabStats.className).toContain('btn-secondary');
      expect(labScreen.element.querySelectorAll('.lab-docked-card-btn').length).toBeGreaterThan(15);

      // Switch to Helmets
      tabHelmets.click();
      expect(labScreen.activeTab).toBe('helmets');
      expect(tabHelmets.className).toContain('btn-primary');
      expect(tabLab.className).toContain('btn-secondary');
      expect(tabStats.className).toContain('btn-secondary');
      expect(labScreen.element.querySelectorAll('.lab-docked-card-btn').length).toBe(0);

      // Switch to Statistics
      tabStats.click();
      expect(labScreen.activeTab).toBe('telemetry');
      expect(tabStats.className).toContain('btn-primary');
      expect(tabLab.className).toContain('btn-secondary');
      expect(tabHelmets.className).toContain('btn-secondary');
      expect(labScreen.element.querySelector('.stats-vitals-grid')).not.toBeNull();

      // Switch back to Mutations
      tabLab.click();
      expect(labScreen.activeTab).toBe('lab');
      expect(tabLab.className).toContain('btn-primary');
      expect(labScreen.element.querySelectorAll('.lab-docked-card-btn').length).toBeGreaterThan(15);
    });
  });

  // =========================================================================
  // 6. Bottom Bar Deploy / Resume Action
  // =========================================================================
  describe('6. Bottom Bar Deploy / Resume Expedition Action', () => {
    it('6.1 clicking Deploy resumes engine and hides modal', () => {
      labScreen.show();
      const deployBtn = labScreen.element.querySelector('.btn-deploy-serpent') as HTMLButtonElement;
      expect(deployBtn).not.toBeNull();
      expect(deployBtn.textContent).toMatch(/deploy/i);

      deployBtn.click();
      expect(mockEngine.resume).toHaveBeenCalled();
      expect(uiRoot.isModalOpen()).toBe(false);
    });
  });
});
