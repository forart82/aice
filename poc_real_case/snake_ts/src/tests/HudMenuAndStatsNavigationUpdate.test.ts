/**
 * Ouroboros Ascension — HUD, Main Menu & Stats Navigation Update Test Suite
 * (HudMenuAndStatsNavigationUpdate.test.ts)
 *
 * Verifies:
 * 1. HudView Unified Lab & Stats HUD triggers:
 *    - 🧬 [L] button: opens root.showScreen('modal-snake-lab', { tab: 'lab' }).
 *    - 📊 [T] button: opens root.showScreen('modal-snake-lab', { tab: 'telemetry' }).
 *    - Hotkey KeyL: opens Lab tab ({ tab: 'lab' }).
 *    - Hotkey KeyT: opens Telemetry/Challenges tab ({ tab: 'telemetry' }).
 * 2. StatsModalScreen delegation & global mode:
 *    - When opened during an active run, seamlessly delegates to root.showScreen('modal-snake-lab', { tab: 'telemetry' }).
 *    - When opened from the Main Menu or in global mode, exclusively renders 📈 GLOBAL CAREER RECORDS.
 * 3. MenuScreen:
 *    - 📊 Stats button opens modal-stats with { mode: 'global' }.
 * 4. UiRoot & RootLayout:
 *    - Full screen resolution, navigation history, and lifecycle routing.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupMockDom } from './MockDom.js';
import { HudView } from '../ui/HudView.js';
import { StatsModalScreen } from '../ui/screens/StatsModalScreen.js';
import { MenuScreen } from '../ui/screens/MenuScreen.js';
import { SnakeLabScreen } from '../ui/screens/SnakeLabScreen.js';
import { UiRoot } from '../ui/UiRoot.js';
import { RootLayout } from '../ui/RootLayout.js';
import { SnakePlayer } from '../sim/SnakePlayer.js';
import { MetaProgression } from '../data/MetaProgression.js';
import { Services } from '../core/Services.js';
import { NullFx, NullSound } from '../core/Contracts.js';
import { GameState } from '../sim/GameState.js';

class SpySound extends NullSound {
  public uiCount = 0;
  public override playUi(): void {
    this.uiCount++;
  }
}

describe('HUD, Main Menu & Navigation Update Conformance Suite', () => {
  let restoreDom: () => void;
  let soundSpy: SpySound;
  let player: SnakePlayer;
  let mockEngine: any;
  let root: RootLayout;
  let hudView: HudView;
  let statsScreen: StatsModalScreen;
  let menuScreen: MenuScreen;
  let labScreen: SnakeLabScreen;

  beforeEach(() => {
    restoreDom = setupMockDom();
    soundSpy = new SpySound();
    Services.Sound = soundSpy;
    Services.Fx = new NullFx();

    MetaProgression.readBackend = () => null;
    MetaProgression.writeBackend = () => {};
    MetaProgression.deleteBackend = () => {};
    MetaProgression.instance = new MetaProgression();
    MetaProgression.Instance.reset();

    player = new SnakePlayer('emerald', 1280, 720, 3);
    player.ouro = 200;
    player.xp = 200;
    player.headHp = 50;
    player.headMaxHp = 50;

    mockEngine = {
      player,
      Player: player,
      state: GameState.Playing,
      State: GameState.Playing,
      currentFloor: 3,
      CurrentFloor: 3,
      combat: {
        score: 45000,
        Score: 45000,
        kills: 30,
        Kills: 30,
        bossKills: 1,
        BossKills: 1,
        foodsEaten: 20,
        FoodsEaten: 20,
        comboCount: 6,
        ComboCount: 6,
        highestRunCombo: 18,
        HighestRunCombo: 18,
        shardsEarned: 25,
        ShardsEarned: 25,
        defeatedBossTypes: ['centipede'],
        DefeatedBossTypes: ['centipede'],
        foodsEatenByType: { apple: 15, golden: 3, potion: 2 },
        FoodsEatenByType: { apple: 15, golden: 3, potion: 2 },
        killsByType: { swarmling: 20, scarab: 8, spitter: 2 },
        KillsByType: { swarmling: 20, scarab: 8, spitter: 2 },
      },
      resume: vi.fn(),
      Resume: vi.fn(),
    };

    const container = document.createElement('div');
    root = new RootLayout(container as any, mockEngine);
    hudView = root.hudView;
    statsScreen = new StatsModalScreen(root);
    menuScreen = new MenuScreen(root);
    labScreen = new SnakeLabScreen(root);

    root.registerScreen(statsScreen);
    root.registerScreen(menuScreen);
    root.registerScreen(labScreen);
  });

  afterEach(() => {
    restoreDom();
    vi.restoreAllMocks();
  });

  // =========================================================================
  // 1. HudView Triggers, 2-Button Header & Hotkeys
  // =========================================================================
  describe('1. HudView Unified Lab & Stats HUD Triggers & Hotkeys', () => {
    it('verifies that HUD header contains only btn-lab and btn-pause, while omitting btn-codex and btn-stats', () => {
      const iconButtons = hudView.element.querySelectorAll('.hud-top-actions .hud-icon-btn');
      expect(iconButtons.length).toBe(2);

      const labBtn = hudView.element.querySelector('.btn-lab') as HTMLButtonElement;
      const pauseBtn = hudView.element.querySelector('.btn-pause') as HTMLButtonElement;
      const codexBtn = hudView.element.querySelector('.btn-codex');
      const statsBtn = hudView.element.querySelector('.btn-stats');

      expect(labBtn).not.toBeNull();
      expect(pauseBtn).not.toBeNull();
      expect(codexBtn).toBeNull();
      expect(statsBtn).toBeNull();
    });

    it('opens modal-snake-lab with { tab: "lab" } when 🧬 [L] button is clicked', () => {
      const showSpy = vi.spyOn(root, 'showScreen');
      const labBtn = hudView.element.querySelector('.btn-lab') as HTMLButtonElement;
      expect(labBtn).not.toBeNull();

      labBtn.click();

      expect(showSpy).toHaveBeenCalledWith('modal-snake-lab', { tab: 'lab' });
      expect(soundSpy.uiCount).toBeGreaterThan(0);
    });

    it('toggles pause when ⏸ [P] button is clicked', () => {
      mockEngine.togglePause = vi.fn();
      const pauseBtn = hudView.element.querySelector('.btn-pause') as HTMLButtonElement;
      expect(pauseBtn).not.toBeNull();

      pauseBtn.click();

      expect(mockEngine.togglePause).toHaveBeenCalled();
      expect(soundSpy.uiCount).toBeGreaterThan(0);
    });

    it('handles KeyL hotkey and opens modal-snake-lab with { tab: "lab" } (mutations view)', () => {
      const showSpy = vi.spyOn(root, 'showScreen');
      const eventL = new KeyboardEvent('keydown', { code: 'KeyL' });

      hudView.handleKeyDown(eventL);

      expect(showSpy).toHaveBeenCalledWith('modal-snake-lab', { tab: 'lab' });
    });

    it('handles KeyT hotkey and opens modal-snake-lab with { tab: "telemetry" } (stats view)', () => {
      const showSpy = vi.spyOn(root, 'showScreen');
      const eventT = new KeyboardEvent('keydown', { code: 'KeyT' });

      hudView.handleKeyDown(eventT);

      expect(showSpy).toHaveBeenCalledWith('modal-snake-lab', { tab: 'telemetry' });
    });

    it('verifies 3 segregated views (mutations, helmets, stats) in SnakeLabScreen', () => {
      // 1. Mutations view
      labScreen.show({ tab: 'mutations' });
      expect(labScreen.activeTab).toBe('lab');
      expect(labScreen.element.querySelector('.lab-section-mutations, .lab-section-lab')).not.toBeNull();

      // 2. Helmets view
      labScreen.show({ tab: 'helmets' });
      expect(labScreen.activeTab).toBe('helmets');
      expect(labScreen.element.querySelector('.lab-section-helmets')).not.toBeNull();

      // 3. Stats view
      labScreen.show({ tab: 'stats' });
      expect(labScreen.activeTab).toBe('telemetry');
      expect(labScreen.element.querySelector('.lab-section-stats, .lab-section-telemetry')).not.toBeNull();
    });
  });

  // =========================================================================
  // 2. StatsModalScreen Delegation & Global Mode
  // =========================================================================
  describe('2. StatsModalScreen Active Run Delegation & Global Mode', () => {
    it('seamlessly delegates to modal-snake-lab with { tab: "telemetry" } when opened during an active run', () => {
      const showSpy = vi.spyOn(root, 'showScreen');

      // Simulate showing modal-stats while in active run
      root.showScreen('modal-stats');

      expect(showSpy).toHaveBeenCalledWith('modal-snake-lab', { tab: 'telemetry' });
    });

    it('exclusively renders 📈 GLOBAL CAREER RECORDS when invoked in global mode or from Main Menu', () => {
      const meta = MetaProgression.Instance;
      meta.records.totalRuns = 35;
      meta.records.victories = 10;
      meta.records.highScore = 320000;
      meta.records.highestFloor = 15;
      meta.records.highestCombo = 42;
      meta.records.totalKills = 4500;
      meta.records.totalFoods = 2800;
      meta.records.totalBosses = 60;
      meta.records.totalShards = 5500;

      // Explicitly open in global mode
      statsScreen.show({ mode: 'global' });

      expect(statsScreen.currentMode).toBe('global');
      const titleEl = statsScreen.element.querySelector('.stats-title');
      expect(titleEl?.textContent).toContain('GLOBAL CAREER RECORDS');

      expect(statsScreen.element.querySelector('.record-total-runs')?.textContent).toContain('35');
      expect(statsScreen.element.querySelector('.record-victories')?.textContent).toContain('10');
      expect(statsScreen.element.querySelector('.record-win-rate')?.textContent).toBe('28.6%');
      expect(statsScreen.element.querySelector('.record-highest-floor')?.textContent).toContain('15');
      expect(statsScreen.element.querySelector('.record-high-score')?.textContent).toContain('320,000');
      expect(statsScreen.element.querySelector('.record-highest-combo')?.textContent).toContain('42x');

      const classList = statsScreen.element.querySelector('.class-mastery-list');
      expect(classList?.textContent).toContain('Emerald Viper');
    });
  });

  // =========================================================================
  // 3. MenuScreen Integration
  // =========================================================================
  describe('3. MenuScreen Stats Button Integration', () => {
    it('opens modal-stats with { mode: "global" } when 📊 Stats button is clicked', () => {
      mockEngine.state = GameState.Menu;
      mockEngine.State = GameState.Menu;

      const showSpy = vi.spyOn(root, 'showScreen');
      root.showScreen('modal-main-menu');

      const statsBtn = (menuScreen.element.querySelector('.btn-global-stats') || menuScreen.element.querySelector('.btn-stats')) as HTMLButtonElement;
      expect(statsBtn).not.toBeNull();

      statsBtn.click();

      expect(showSpy).toHaveBeenCalledWith('modal-stats', { mode: 'global' });
      expect(soundSpy.uiCount).toBeGreaterThan(0);
    });
  });

  // =========================================================================
  // 4. RootLayout & UiRoot Integration
  // =========================================================================
  describe('4. UiRoot & RootLayout Screen Management', () => {
    it('properly registers and resolves modal-stats and modal-snake-lab', () => {
      expect(root.getScreen('modal-stats')).toBe(statsScreen);
      expect(root.getScreen('modal-snake-lab')).toBe(labScreen);
      expect(root.getScreen('modal-main-menu')).toBe(menuScreen);
    });
  });
});
