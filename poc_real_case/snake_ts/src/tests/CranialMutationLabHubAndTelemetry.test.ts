/**
 * Ouroboros Ascension — Cranial Mutation Lab Hub & In-Run Expedition Telemetry Test Suite
 * File: src/tests/CranialMutationLabHubAndTelemetry.test.ts
 *
 * Conformance matrix for:
 * 1. Modal initialization & header title with active Floor number.
 * 2. Top Telemetry Section (Quick Stats Chips Bar): Ouro wallet, Floor, Serpent Length (and Segments), Score, Head HP, and Combo.
 * 3. 3 Segmented Tabs Navigation: Mutations, Helmets, and Statistics.
 * 4. 3 Segregated Tab Views:
 *    - Tab 1 (🧬 Mutations): Cranial Mutation & Challenge Cards Grid (Offensive Weapons, Defensive Bio-Organs, Cranial Bio-Augmentations).
 *    - Tab 2 (🪖 Helmets): Dedicated Boss Helmet Vault & active equipped helmet showcase card.
 *    - Tab 3 (📊 Statistics): Dedicated in-run expedition telemetry view (Vitals, Nourishment, Bestiary, Boss Defeats).
 * 5. Live Challenge Progress Tracker: progress bars, percentages, current vs target metrics across Length, Foods, Kills, Bosses, and Combos.
 * 6. Bottom Deploy action button (.btn-deploy-serpent) unpauses and resumes simulation.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupMockDom } from './MockDom.js';
import { UiRoot } from '../ui/UiRoot.js';
import { SnakeLabScreen } from '../ui/screens/SnakeLabScreen.js';
import { SnakePlayer } from '../sim/SnakePlayer.js';
import { MetaProgression } from '../data/MetaProgression.js';
import { Services } from '../core/Services.js';
import { NullFx, NullSound } from '../core/Contracts.js';
import { GameState } from '../sim/GameState.js';

class SoundSpy extends NullSound {
  public uiCount = 0;
  public levelUpCount = 0;
  public errorCount = 0;

  public override playUi(): void {
    this.uiCount++;
  }
  public override playLevelUp(): void {
    this.levelUpCount++;
  }
  public override playError(): void {
    this.errorCount++;
  }
}

describe('Cranial Mutation Lab Hub & In-Run Telemetry Conformance Suite', () => {
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

    player = new SnakePlayer('emerald', 1280, 720, 4); // 4 body segments + 1 head = 5 length
    player.ouro = 350;
    player.xp = 350;
    player.headHp = 45;
    player.headMaxHp = 50;
    player.PeakLength = 8;

    mockEngine = {
      player,
      Player: player,
      state: GameState.Playing,
      State: GameState.Playing,
      currentFloor: 3,
      CurrentFloor: 3,
      combat: {
        score: 32400,
        Score: 32400,
        kills: 48,
        Kills: 48,
        bossKills: 2,
        BossKills: 2,
        foodsEaten: 36,
        FoodsEaten: 36,
        comboCount: 8,
        ComboCount: 8,
        highestRunCombo: 16,
        HighestRunCombo: 16,
        shardsEarned: 25,
        ShardsEarned: 25,
        defeatedBossTypes: ['centipede', 'gorgon'],
        DefeatedBossTypes: ['centipede', 'gorgon'],
        foodsEatenByType: { apple: 20, golden: 8, potion: 4, shard: 3, prism: 1 },
        killsByType: { swarmling: 25, scarab: 12, spitter: 6, phantom: 3, drone: 1, brute: 1 },
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
  // 1. Header & Top Telemetry Section (Quick Stats Chips Bar)
  // =========================================================================
  describe('1. Top Telemetry Section & Header Formatting', () => {
    it('1.1 renders dynamic header title with active Floor number and cybernetic subtitle', () => {
      labScreen.show();
      expect(labScreen.element.querySelector('.cyber-modal-title')?.textContent).toContain('FLOOR 3');
      expect(labScreen.element.querySelector('.cyber-modal-subtitle')?.textContent).toContain('Cranial augmentations');
    });

    it('1.2 renders top telemetry quick stats chips bar with all 6 live metrics', () => {
      labScreen.show();
      const pointsLabel = labScreen.element.querySelector('.lab-points-label')!;
      expect(pointsLabel).not.toBeNull();

      // Verify 6 quick stats chips: Ouro, Floor, Length, Score, HP, Combo
      const chips = pointsLabel.querySelectorAll('.lab-stat-chip');
      expect(chips.length).toBe(6);

      const ouroChip = pointsLabel.querySelector('.lab-stat-chip-ouro');
      expect(ouroChip?.textContent).toContain('350 Ouro');

      const chipTexts = Array.from(chips).map((c) => c.textContent);
      expect(chipTexts.some((t) => t?.includes('Floor 3'))).toBe(true);
      expect(chipTexts.some((t) => t?.includes('Len 5 (📏 5 Segs)'))).toBe(true);
      expect(chipTexts.some((t) => t?.includes('32400'))).toBe(true);
      expect(chipTexts.some((t) => t?.includes('45/50'))).toBe(true);
      expect(chipTexts.some((t) => t?.includes('8x'))).toBe(true);
    });
  });

  // =========================================================================
  // 2. Segmented Tab Navigation & Mode Switching
  // =========================================================================
  describe('2. Segmented Tab Navigation', () => {
    it('2.1 provides 3 interactive tabs (Mutations, Helmets, Statistics)', () => {
      labScreen.show();
      const tabLab = labScreen.element.querySelector('.btn-tab-lab') as HTMLButtonElement;
      const tabHelmets = labScreen.element.querySelector('.btn-tab-helmets') as HTMLButtonElement;
      const tabStats = (labScreen.element.querySelector('.btn-tab-stats') || labScreen.element.querySelector('.btn-tab-telemetry')) as HTMLButtonElement;

      expect(tabLab).not.toBeNull();
      expect(tabHelmets).not.toBeNull();
      expect(tabStats).not.toBeNull();
    });

    it('2.2 switches active tab view and updates button active classes', () => {
      labScreen.show();
      expect(labScreen.activeTab).toBe('lab');

      const tabStats = (labScreen.element.querySelector('.btn-tab-stats') || labScreen.element.querySelector('.btn-tab-telemetry')) as HTMLButtonElement;
      tabStats.click();
      expect(labScreen.activeTab).toBe('telemetry');
      expect(labScreen.element.querySelector('.stats-vitals-grid')).not.toBeNull();

      const tabHelmets = labScreen.element.querySelector('.btn-tab-helmets') as HTMLButtonElement;
      tabHelmets.click();
      expect(labScreen.activeTab).toBe('helmets');
      expect(labScreen.element.querySelector('.equipped-helmet-container')).not.toBeNull();

      const tabLab = labScreen.element.querySelector('.btn-tab-lab') as HTMLButtonElement;
      tabLab.click();
      expect(labScreen.activeTab).toBe('lab');
      expect(labScreen.element.querySelectorAll('.lab-docked-card-btn').length).toBeGreaterThan(15);
    });
  });

  // =========================================================================
  // 3. Single-Page Unified Cards with Integrated Challenge Progress & Actions
  // =========================================================================
  describe('3. Single-Page Unified Module & Augment Cards', () => {
    it('3.1 offensive weapon and defensive organ cards contain integrated level status, cost tag, description, and purchase affordance (ONLY turret & shield unlocked at run start)', () => {
      mockEngine.currentFloor = 1;
      mockEngine.CurrentFloor = 1;
      mockEngine.combat.kills = 0;
      mockEngine.combat.Kills = 0;
      mockEngine.combat.comboCount = 0;
      mockEngine.combat.ComboCount = 0;
      mockEngine.combat.highestRunCombo = 0;
      mockEngine.combat.HighestRunCombo = 0;
      mockEngine.combat.bossKills = 0;
      mockEngine.combat.BossKills = 0;
      mockEngine.combat.foodsEaten = 0;
      mockEngine.combat.FoodsEaten = 0;
      mockEngine.combat.killsByType = {};
      mockEngine.combat.foodsEatenByType = {};
      labScreen.show();
      labScreen.refresh();
      const cardButtons = Array.from(labScreen.element.querySelectorAll('.lab-docked-card-btn')) as HTMLButtonElement[];
      
      // Starter defaults: Attack Spitter (turret) & Carapace Shield (shield) MUST be unlocked
      const spitterBtn = cardButtons.find((b) => b.textContent?.includes('Attack Spitter'))!;
      expect(spitterBtn).toBeDefined();
      expect(spitterBtn.className).toContain('btn-affordable');
      expect(spitterBtn.querySelector('.cost-tag')?.textContent).toContain('30 Ouro');

      const shieldBtn = cardButtons.find((b) => b.textContent?.includes('Carapace Shield'))!;
      expect(shieldBtn).toBeDefined();
      expect(shieldBtn.className).toContain('btn-affordable');

      // Locked offensive/defensive modules at Tier 1
      const teslaBtn = cardButtons.find((b) => b.textContent?.includes('Bio-Arc Coil'))!;
      expect(teslaBtn).toBeDefined();
      expect(teslaBtn.className).toContain('btn-tier-locked');
      expect(teslaBtn.textContent).toContain('8x');

      const venomBtn = cardButtons.find((b) => b.textContent?.includes('Venom Sprayer'))!;
      expect(venomBtn).toBeDefined();
      expect(venomBtn.className).toContain('btn-tier-locked');
      expect(venomBtn.textContent).toContain('20 Enemies');

      const spikesBtn = cardButtons.find((b) => b.textContent?.includes('Thorny Spikes'))!;
      expect(spikesBtn).toBeDefined();
      expect(spikesBtn.className).toContain('btn-tier-locked');
      expect(spikesBtn.textContent).toContain('Scarabs');

      // Check Cryo Mortar (locked at Tier 1 by challenge)
      const cryoBtn = cardButtons.find((b) => b.textContent?.includes('Cryo Mortar'))!;
      expect(cryoBtn).toBeDefined();
      expect(cryoBtn.className).toContain('btn-tier-locked');
      expect(cryoBtn.textContent).toContain('TIER 1 LOCKED');
      expect(cryoBtn.textContent).toContain('UNLOCK:');
    });

    it('3.2 cranial bio-augmentation cards display integrated challenge requirement tags and purchase affordances (fangs locked at run start)', () => {
      mockEngine.currentFloor = 1;
      mockEngine.CurrentFloor = 1;
      mockEngine.combat.comboCount = 0;
      mockEngine.combat.ComboCount = 0;
      mockEngine.combat.highestRunCombo = 0;
      mockEngine.combat.HighestRunCombo = 0;
      mockEngine.combat.kills = 0;
      mockEngine.combat.Kills = 0;
      mockEngine.combat.bossKills = 0;
      mockEngine.combat.BossKills = 0;
      mockEngine.combat.foodsEaten = 0;
      mockEngine.combat.FoodsEaten = 0;
      mockEngine.combat.defeatedBosses = [];
      mockEngine.combat.killsByType = {};
      mockEngine.combat.foodsEatenByType = {};
      labScreen.show();
      labScreen.refresh();
      let cardButtons = Array.from(labScreen.element.querySelectorAll('.lab-docked-card-btn')) as HTMLButtonElement[];

      // Check Venom Fangs (locked at Tier 1 at run start)
      let fangsBtn = cardButtons.find((b) => b.textContent?.includes('Venom Fangs'))!;
      expect(fangsBtn).toBeDefined();
      expect(fangsBtn.className).toContain('btn-tier-locked');
      expect(fangsBtn.textContent).toContain('TIER 1 LOCKED');
      expect(fangsBtn.textContent).toContain('15x');

      // Check Dragon Maw (locked Tier 1 with Boss challenge)
      const mawBtn = cardButtons.find((b) => b.textContent?.includes('Dragon Maw'))!;
      expect(mawBtn).toBeDefined();
      expect(mawBtn.className).toContain('btn-tier-locked');
      expect(mawBtn.textContent).toContain('TIER 1 LOCKED');
      expect(mawBtn.textContent).toContain('Centipede Behemoth');

      // Once unlocked in run, Venom Fangs becomes affordable
      MetaProgression.Instance.UnlockTier('fangs', 1);
      labScreen.refresh();
      cardButtons = Array.from(labScreen.element.querySelectorAll('.lab-docked-card-btn')) as HTMLButtonElement[];
      fangsBtn = cardButtons.find((b) => b.textContent?.includes('Venom Fangs'))!;
      expect(fangsBtn.className).toContain('btn-affordable');
      expect(fangsBtn.textContent).toContain('40 Ouro');
    });

    it('3.3 purchasing a card deducts Ouro atomically, installs module, and updates top telemetry chip in real time', () => {
      labScreen.show();
      const cardButtons = Array.from(labScreen.element.querySelectorAll('.lab-docked-card-btn')) as HTMLButtonElement[];
      const spitterBtn = cardButtons.find((b) => b.textContent?.includes('Attack Spitter'))!;

      spitterBtn.click();

      expect(player.ouro).toBe(320); // 350 - 30
      expect(player.getHeadModuleLevel('turret')).toBe(1);

      const ouroChip = labScreen.element.querySelector('.lab-stat-chip-ouro') as HTMLElement;
      expect(ouroChip.textContent).toContain('320 Ouro');
    });
  });

  // =========================================================================
  // 4. Live Challenges Tracker Integration
  // =========================================================================
  describe('4. Live Challenges Tracker Integration', () => {
    it('4.1 calculates exact live challenge progress percentages, metrics, and progress bars on mutation cards', () => {
      mockEngine.combat.kills = 18;
      labScreen.show();
      expect(labScreen.activeTab).toBe('lab');

      const challengeCards = labScreen.element.querySelectorAll('.challenge-row-card');
      expect(challengeCards.length).toBeGreaterThanOrEqual(15);

      const progressBars = labScreen.element.querySelectorAll('.challenge-progress-bar');
      expect(progressBars.length).toBeGreaterThanOrEqual(10);

      // Verify Kills challenge (Scattershot) with 18 kills (target 25)
      const killCard = Array.from(challengeCards).find((c) => c.textContent?.includes('Scattershot')) as HTMLElement;
      expect(killCard).toBeDefined();
      expect(killCard.textContent).toContain('18');
    });
  });

  // =========================================================================
  // 5. In-Run Expedition Telemetry Tab
  // =========================================================================
  describe('5. In-Run Expedition Telemetry Tab Integration', () => {
    it('5.1 renders complete expedition vitals, nourishment harvest, and hostile bestiary eliminations', () => {
      labScreen.show({ tab: 'telemetry' });
      expect(labScreen.activeTab).toBe('telemetry');

      // 1. Vitals grid
      expect(labScreen.element.querySelector('.stat-score-val')?.textContent).toContain('32,400');
      expect(labScreen.element.querySelector('.stat-ouro-val')?.textContent).toContain('350 🪙');
      expect(labScreen.element.querySelector('.stat-length-val')?.textContent).toBe('5');
      expect(labScreen.element.querySelector('.stat-headhp-val')?.textContent).toContain('45/50');

      // 2. Nourishment breakdown
      expect(labScreen.element.querySelector('.food-apple-count')?.textContent).toBe('20');
      expect(labScreen.element.querySelector('.food-golden-count')?.textContent).toBe('8');
      expect(labScreen.element.querySelector('.food-potion-count')?.textContent).toBe('4');

      // 3. Bestiary eliminations
      expect(labScreen.element.querySelector('.kill-swarmling-count')?.textContent).toBe('25');
      expect(labScreen.element.querySelector('.kill-scarab-count')?.textContent).toBe('12');
      expect(labScreen.element.querySelector('.kill-spitter-count')?.textContent).toBe('6');
    });
  });

  // =========================================================================
  // 6. Helmet Vault Tab & Active Helmet Showcase
  // =========================================================================
  describe('6. Helmet Vault Tab Integration', () => {
    it('6.1 equips boss helmet from vault and updates active helmet display', () => {
      const meta = MetaProgression.Instance;
      meta.Helmets = [
        {
          Id: 'helm_leviathan',
          Name: 'Leviathan Crown',
          Icon: '👑',
          Rarity: 'legendary',
          Stats: { maxHp: 35, HpRegen: 2.0 },
          id: 'helm_leviathan',
          name: 'Leviathan Crown',
          bossType: 'boss_leviathan',
          floor: 3,
          rarity: 'legendary',
          icon: '👑',
          description: 'Crown of the abyssal deep.',
          stats: { maxHp: 35, HpRegen: 2.0 },
        },
      ];

      labScreen.show({ tab: 'helmets' });
      expect(labScreen.activeTab).toBe('helmets');

      const equipBtn = labScreen.element.querySelector('.btn-equip-helmet') as HTMLButtonElement;
      expect(equipBtn).not.toBeNull();
      equipBtn.click();

      expect(meta.EquippedHelmetId).toBe('helm_leviathan');
      expect((player as any).EquippedHelmet?.id).toBe('helm_leviathan');
    });
  });

  // =========================================================================
  // 7. Bottom Deploy Action Button & Resume Lifecycle
  // =========================================================================
  describe('7. Bottom Deploy Action Button & Resume Lifecycle', () => {
    it('7.1 clicking Deploy button resumes playing engine and hides modal', () => {
      labScreen.show();
      const deployBtn = labScreen.element.querySelector('.btn-deploy-serpent') as HTMLButtonElement;
      expect(deployBtn).not.toBeNull();

      deployBtn.click();

      expect(mockEngine.resume).toHaveBeenCalled();
      expect(uiRoot.isModalOpen()).toBe(false);
    });

    it('7.2 clicking Deploy button during LevelUp completes level up', () => {
      mockEngine.state = GameState.LevelUp;
      mockEngine.State = GameState.LevelUp;

      labScreen.show();
      const deployBtn = labScreen.element.querySelector('.btn-deploy-serpent') as HTMLButtonElement;
      deployBtn.click();

      expect(mockEngine.completeLevelUp).toHaveBeenCalled();
    });

    it('7.3 verifies that HUD header contains only btn-lab and btn-pause, while hotkeys [L] and [T] switch between views', () => {
      const hud = uiRoot.hudView;
      const iconButtons = hud.element.querySelectorAll('.hud-top-actions .hud-icon-btn');
      expect(iconButtons.length).toBe(2);

      expect(hud.element.querySelector('.btn-lab')).not.toBeNull();
      expect(hud.element.querySelector('.btn-pause')).not.toBeNull();

      const showSpy = vi.spyOn(uiRoot, 'showScreen');
      hud.handleKeyDown(new KeyboardEvent('keydown', { code: 'KeyL' }));
      expect(showSpy).toHaveBeenCalledWith('modal-snake-lab', { tab: 'lab' });

      hud.handleKeyDown(new KeyboardEvent('keydown', { code: 'KeyT' }));
      expect(showSpy).toHaveBeenCalledWith('modal-snake-lab', { tab: 'telemetry' });
    });

    it('7.4 verifies 3 segregated views (mutations, helmets, stats) in SnakeLabScreen', () => {
      labScreen.show({ tab: 'mutations' });
      expect(labScreen.activeTab).toBe('lab');
      expect(labScreen.element.querySelector('.lab-section-mutations')).not.toBeNull();

      labScreen.show({ tab: 'helmets' });
      expect(labScreen.activeTab).toBe('helmets');
      expect(labScreen.element.querySelector('.lab-section-helmets')).not.toBeNull();

      labScreen.show({ tab: 'stats' });
      expect(labScreen.activeTab).toBe('telemetry');
      expect(labScreen.element.querySelector('.lab-section-stats')).not.toBeNull();
    });
  });
});
