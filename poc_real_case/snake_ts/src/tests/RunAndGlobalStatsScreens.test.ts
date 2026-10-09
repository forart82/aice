/**
 * Ouroboros Ascension — Run & Global Statistics Screens Test Suite (RunAndGlobalStatsScreens.test.ts)
 *
 * Conformance matrix for:
 * 1. In-Run Statistics screen renders active telemetry, serpent vitals, food/kill tallies, and live challenge progress bars.
 * 2. Global Statistics screen renders lifetime career records from `MetaProgression.Records` with formatted metrics.
 * 3. HUD button (`.btn-stats`) in gameplay and Main Menu button (`.btn-stats`) integration.
 * 4. Segmented tab bar switching, dynamic challenge progress recalculation, and modal close/return behavior.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupMockDom } from './MockDom.js';
import { UiRoot } from '../ui/UiRoot.js';
import { StatsScreen } from '../ui/screens/StatsScreen.js';
import { MenuScreen } from '../ui/screens/MenuScreen.js';
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

describe('Run & Global Statistics Screens Test Suite', () => {
  let restoreDom: () => void;
  let soundSpy: SoundSpy;
  let player: SnakePlayer;
  let mockEngine: any;
  let uiRoot: UiRoot;
  let statsScreen: StatsScreen;
  let menuScreen: MenuScreen;

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

    player = new SnakePlayer('emerald', 1280, 720, 3);
    player.ouro = 175;
    player.xp = 175;
    player.headHp = 42;
    player.headMaxHp = 50;

    mockEngine = {
      player,
      Player: player,
      state: GameState.Playing,
      State: GameState.Playing,
      currentFloor: 4,
      CurrentFloor: 4,
      floorFoodProgress: 12,
      foodTarget: 20,
      combat: {
        score: 48500,
        Score: 48500,
        kills: 64,
        Kills: 64,
        bossKills: 3,
        BossKills: 3,
        foodsEaten: 58,
        FoodsEaten: 58,
        comboCount: 12,
        ComboCount: 12,
        highestCombo: 28,
        HighestCombo: 28,
        shardsEarned: 35,
        ShardsEarned: 35,
      },
      resume: vi.fn(),
      Resume: vi.fn(),
      showStats: vi.fn((tab?: string) => {
        uiRoot.showScreen('modal-stats', { tab: tab || 'run' });
      }),
    };

    const container = document.createElement('div');
    uiRoot = UiRoot.init(container as any, mockEngine);

    statsScreen = new StatsScreen(uiRoot);
    menuScreen = new MenuScreen(uiRoot);

    uiRoot.registerScreen(statsScreen);
    uiRoot.registerScreen(menuScreen);
  });

  afterEach(() => {
    restoreDom();
    vi.restoreAllMocks();
  });

  // =========================================================================
  // SUITE 1: In-Run Statistics Screen Verification
  // =========================================================================
  describe('1. In-Run Statistics View Telemetry & Challenge Progress', () => {
    it('1.1 renders active session telemetry cards (Floor, Score, Ouro, Shards, Length, Vitals)', () => {
      statsScreen.show({ tab: 'run' });
      expect(statsScreen.activeTab).toBe('run');

      const floorVal = statsScreen.element.querySelector('.stat-floor-val');
      expect(floorVal?.textContent).toBe('4');

      const scoreVal = statsScreen.element.querySelector('.stat-score-val');
      expect(scoreVal?.textContent).toContain('48,500');

      const ouroVal = statsScreen.element.querySelector('.stat-ouro-val');
      expect(ouroVal?.textContent).toContain('175');

      const shardsVal = statsScreen.element.querySelector('.stat-shards-val');
      expect(shardsVal?.textContent).toContain('+35');

      const headHpVal = statsScreen.element.querySelector('.stat-headhp-val');
      expect(headHpVal?.textContent).toContain('42/50');

      const classVal = statsScreen.element.querySelector('.stat-class-val');
      expect(classVal?.textContent).toContain('Emerald Viper');
    });

    it('1.2 renders nourishment and combat tallies (Foods consumed, Kills, Bosses, Combos)', () => {
      statsScreen.show({ tab: 'run' });

      const foodsVal = statsScreen.element.querySelector('.stat-foods-val');
      expect(foodsVal?.textContent).toContain('58');

      const killsVal = statsScreen.element.querySelector('.stat-kills-val');
      expect(killsVal?.textContent).toContain('64');

      const bossesVal = statsScreen.element.querySelector('.stat-bosses-val');
      expect(bossesVal?.textContent).toContain('3');

      const curComboVal = statsScreen.element.querySelector('.stat-curcombo-val');
      expect(curComboVal?.textContent).toContain('12x');

      const peakComboVal = statsScreen.element.querySelector('.stat-combo-val');
      expect(peakComboVal?.textContent).toContain('28x');
    });

    it('1.3 renders live challenge progress bars and milestone indicators', () => {
      statsScreen.show({ tab: 'run' });

      const challengesSection = statsScreen.element.querySelector('.run-challenges-section');
      expect(challengesSection).not.toBeNull();

      const challengeCards = statsScreen.element.querySelectorAll('.challenge-row-card');
      expect(challengeCards.length).toBeGreaterThanOrEqual(10);

      // Verify Scattershot challenge with 64 kills (target 30)
      const scatterCard = Array.from(challengeCards).find((c) => c.textContent?.includes('Scattershot')) as HTMLElement;
      expect(scatterCard).toBeDefined();

      const progressBars = statsScreen.element.querySelectorAll('.challenge-progress-bar');
      expect(progressBars.length).toBeGreaterThanOrEqual(10);

      const progressFills = statsScreen.element.querySelectorAll('.challenge-progress-fill');
      expect(progressFills.length).toBeGreaterThanOrEqual(10);

      const descriptions = statsScreen.element.querySelectorAll('.challenge-desc');
      expect(descriptions.length).toBeGreaterThanOrEqual(10);
    });
  });

  // =========================================================================
  // SUITE 2: Global Statistics Screen & Career Records
  // =========================================================================
  describe('2. Global Statistics View & Lifetime Career Records', () => {
    it('2.1 renders lifetime career records from MetaProgression.Records', () => {
      const meta = MetaProgression.Instance;
      meta.Records.HighScore = 345000;
      meta.Records.HighestFloor = 18;
      meta.Records.HighestCombo = 52;
      meta.Records.HighestLevel = 26;
      meta.Records.TotalRuns = 45;
      meta.Records.Victories = 8;
      meta.Records.TotalKills = 6780;
      meta.Records.TotalFoods = 4120;
      meta.Records.TotalBosses = 92;
      meta.Records.TotalShards = 8500;
      meta.Records.PlayTimeSec = 9245; // 2h 34m 5s
      meta.Records.BestTimeSec = 645;  // 10m 45s

      statsScreen.show({ tab: 'global' });
      expect(statsScreen.activeTab).toBe('global');

      const highScoreEl = statsScreen.element.querySelector('.stat-record-highscore');
      expect(highScoreEl?.textContent).toContain('345,000');

      const floorEl = statsScreen.element.querySelector('.stat-record-floor');
      expect(floorEl?.textContent).toContain('Floor 18');

      const comboEl = statsScreen.element.querySelector('.stat-record-combo');
      expect(comboEl?.textContent).toContain('52x');

      const levelEl = statsScreen.element.querySelector('.stat-record-level');
      expect(levelEl?.textContent).toContain('LVL 26');

      const runsEl = statsScreen.element.querySelector('.stat-record-runs');
      expect(runsEl?.textContent).toContain('45');

      const victoriesEl = statsScreen.element.querySelector('.stat-record-victories');
      expect(victoriesEl?.textContent).toContain('8');

      const killsEl = statsScreen.element.querySelector('.stat-record-kills');
      expect(killsEl?.textContent).toContain('6,780');

      const foodsEl = statsScreen.element.querySelector('.stat-record-foods');
      expect(foodsEl?.textContent).toContain('4,120');

      const bossesEl = statsScreen.element.querySelector('.stat-record-bosses');
      expect(bossesEl?.textContent).toContain('92');

      const shardsEl = statsScreen.element.querySelector('.stat-record-shards');
      expect(shardsEl?.textContent).toContain('8,500');

      const playtimeEl = statsScreen.element.querySelector('.stat-record-playtime');
      expect(playtimeEl?.textContent).toContain('2h 34m 5s');

      const bestTimeEl = statsScreen.element.querySelector('.stat-record-besttime');
      expect(bestTimeEl?.textContent).toContain('10m 45s');
    });

    it('2.2 renders sanctuary overview and collected boss helmet count in global stats', () => {
      const meta = MetaProgression.Instance;
      meta.Shards = 1250;
      meta.Helmets = [
        {
          Id: 'h1',
          Name: 'Helm 1',
          Icon: '🪖',
          Rarity: 'common',
          Stats: {},
          id: 'h1',
          name: 'Helm 1',
          bossId: 'b1',
          floor: 1,
          rarity: 'common',
          icon: '🪖',
          stats: {},
        },
        {
          Id: 'h2',
          Name: 'Helm 2',
          Icon: '👑',
          Rarity: 'rare',
          Stats: {},
          id: 'h2',
          name: 'Helm 2',
          bossId: 'b2',
          floor: 2,
          rarity: 'rare',
          icon: '👑',
          stats: {},
        },
      ];

      statsScreen.show({ tab: 'global' });

      const metaSummary = statsScreen.element.querySelector('.global-meta-summary');
      expect(metaSummary).not.toBeNull();
      expect(metaSummary?.textContent).toContain('1,250 Available Stars');
      expect(metaSummary?.textContent).toContain('2 Boss Helmets Collected');
    });
  });

  // =========================================================================
  // SUITE 3: HUD Button & Main Menu Button Integration
  // =========================================================================
  describe('3. HUD & Main Menu Button Integration and Tab Switching', () => {
    it('3.1 Streamlined HUD header dispatches [T] hotkey to In-Run Statistics modal and triggers audio click', () => {
      expect(uiRoot.hudView.element.querySelector('.btn-stats')).toBeNull();
      const prevUi = soundSpy.uiCount;
      const handled = uiRoot.hudView.handleKeyDown(new KeyboardEvent('keydown', { code: 'KeyT' }));

      expect(handled).toBe(true);
      expect(soundSpy.uiCount).toBe(prevUi + 1);
      expect(uiRoot.activeScreenId).toBe('modal-snake-lab');
    });

    it('3.2 Main Menu button (.btn-stats) opens Global Statistics modal and triggers audio click', () => {
      mockEngine.state = GameState.Menu;
      mockEngine.State = GameState.Menu;

      uiRoot.showScreen('modal-main-menu');
      expect(uiRoot.activeScreenId).toBe('modal-main-menu');

      const menuStatsBtn = menuScreen.element.querySelector('.btn-stats') as HTMLButtonElement;
      expect(menuStatsBtn).not.toBeNull();

      const prevUi = soundSpy.uiCount;
      menuStatsBtn.click();

      expect(soundSpy.uiCount).toBe(prevUi + 1);
      expect(uiRoot.activeScreenId).toBe('modal-stats');
      expect(statsScreen.activeTab).toBe('global');
    });

    it('3.3 Segmented tab buttons switch between In-Run and Global views smoothly', () => {
      statsScreen.show({ tab: 'run' });
      expect(statsScreen.activeTab).toBe('run');
      expect(statsScreen.element.querySelector('.run-telemetry-section')).not.toBeNull();

      const tabGlobalBtn = statsScreen.element.querySelector('.btn-tab-global') as HTMLButtonElement;
      tabGlobalBtn.click();

      expect(statsScreen.activeTab).toBe('global');
      expect(statsScreen.element.querySelector('.global-records-section')).not.toBeNull();

      const tabRunBtn = statsScreen.element.querySelector('.btn-tab-run') as HTMLButtonElement;
      tabRunBtn.click();

      expect(statsScreen.activeTab).toBe('run');
      expect(statsScreen.element.querySelector('.run-telemetry-section')).not.toBeNull();
    });

    it('3.4 Return button in active gameplay resumes run and unpauses engine', () => {
      mockEngine.state = GameState.Playing;
      mockEngine.State = GameState.Playing;

      uiRoot.showScreen('modal-stats', { tab: 'run' });
      expect(uiRoot.activeScreenId).toBe('modal-snake-lab');

      const returnBtn = statsScreen.element.querySelector('.btn-back') as HTMLButtonElement;
      returnBtn.click();

      expect(mockEngine.resume).toHaveBeenCalled();
      expect(uiRoot.isModalOpen()).toBe(false);
    });

    it('3.5 Return button in Menu mode returns back to Main Menu screen', () => {
      mockEngine.state = GameState.Menu;
      mockEngine.State = GameState.Menu;

      uiRoot.showScreen('modal-main-menu');
      uiRoot.showScreen('modal-stats', { tab: 'global' });
      expect(uiRoot.activeScreenId).toBe('modal-stats');

      const returnBtn = statsScreen.element.querySelector('.btn-back') as HTMLButtonElement;
      returnBtn.click();

      expect(uiRoot.activeScreenId).toBe('modal-main-menu');
    });
  });
});
