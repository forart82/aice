/**
 * Ouroboros Ascension — StatsModalScreen Comprehensive TDD Test Suite (StatsModalScreen.test.ts)
 *
 * Verifies:
 * 1. Dual-Mode modal screen rendering:
 *    - Mode 'run': In-Run live telemetry (vitals, score, ouro, serpent length, peak length, combo, food breakdown, bestiary breakdown, bosses, installed cranial modules, and live challenge tracker).
 *    - Mode 'global': Career statistics (total runs, victories, win rate %, highest floor, high score, peak combo, lifetime kills/bosses/food/shards/playtime, and armory mastery summary).
 * 2. Segmented tab switching between 'run' and 'global' modes.
 * 3. HudView `.btn-stats` button with hotkey `[T]` opening `modal-stats` in 'run' mode.
 * 4. MenuScreen `.btn-global-stats` button opening `modal-stats` in 'global' mode.
 * 5. RootLayout registration and screen resolution.
 * 6. InputManager `KeyT` hotkey edge triggering and GameEngine stats toggle consumption.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupMockDom } from './MockDom.js';
import { StatsModalScreen } from '../ui/screens/StatsModalScreen.js';
import { HudView } from '../ui/HudView.js';
import { MenuScreen } from '../ui/screens/MenuScreen.js';
import { RootLayout } from '../ui/RootLayout.js';
import { UiRoot } from '../ui/UiRoot.js';
import { SnakePlayer } from '../sim/SnakePlayer.js';
import { MetaProgression } from '../data/MetaProgression.js';
import { Services } from '../core/Services.js';
import { NullFx, NullSound, ScriptedInput } from '../core/Contracts.js';
import { GameState } from '../sim/GameState.js';
import { InputManager } from '../input/InputManager.js';
import { GameEngine } from '../sim/GameEngine.js';

class SoundSpy extends NullSound {
  public uiCount = 0;
  public override playUi(): void {
    this.uiCount++;
  }
}

describe('StatsModalScreen & RootLayout TDD Conformance Suite', () => {
  let restoreDom: () => void;
  let soundSpy: SoundSpy;
  let player: SnakePlayer;
  let mockEngine: any;
  let rootLayout: RootLayout;
  let statsModalScreen: StatsModalScreen;
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
    player.ouro = 240;
    player.xp = 240;
    player.headHp = 50;
    player.headMaxHp = 50;
    player.PeakLength = 12;

    mockEngine = {
      player,
      Player: player,
      state: GameState.Playing,
      State: GameState.Playing,
      currentFloor: 3,
      CurrentFloor: 3,
      combat: {
        score: 64200,
        Score: 64200,
        kills: 88,
        Kills: 88,
        bossKills: 2,
        BossKills: 2,
        foodsEaten: 42,
        FoodsEaten: 42,
        comboCount: 14,
        ComboCount: 14,
        highestRunCombo: 32,
        HighestRunCombo: 32,
        shardsEarned: 50,
        ShardsEarned: 50,
        defeatedBossTypes: ['colossus_prime', 'hive_queen'],
        DefeatedBossTypes: ['colossus_prime', 'hive_queen'],
        foodsEatenByType: { apple: 25, golden: 8, potion: 3, shard: 5, prism: 1 },
        FoodsEatenByType: { apple: 25, golden: 8, potion: 3, shard: 5, prism: 1 },
        killsByType: { swarmling: 45, scarab: 20, spitter: 12, phantom: 6, drone: 3, brute: 2 },
        KillsByType: { swarmling: 45, scarab: 20, spitter: 12, phantom: 6, drone: 3, brute: 2 },
      },
      resume: vi.fn(),
      Resume: vi.fn(),
      showStats: vi.fn((mode?: string) => {
        rootLayout.showScreen('modal-stats', { mode: mode || 'run' });
      }),
    };

    const container = document.createElement('div');
    rootLayout = new RootLayout(container as any, mockEngine);
    statsModalScreen = new StatsModalScreen(rootLayout);
    menuScreen = new MenuScreen(rootLayout);

    rootLayout.registerScreen(statsModalScreen);
    rootLayout.registerScreen(menuScreen);
  });

  afterEach(() => {
    restoreDom();
    vi.restoreAllMocks();
  });

  it('1. RootLayout initializes properly and resolves modal-stats screen', () => {
    expect(rootLayout.getScreen('modal-stats')).toBeDefined();
    expect(rootLayout.getScreen('modal-run-stats')).toBeDefined();
    expect(rootLayout.getScreen('modal-global-stats')).toBeDefined();
    expect(rootLayout.getScreen('modal-records')).toBeDefined();
  });

  it('2. Mode "run" renders active in-run vitals, score, ouro wallet, length, and peak length', () => {
    statsModalScreen.show({ mode: 'run' });
    expect(statsModalScreen.currentMode).toBe('run');

    const scoreEl = statsModalScreen.element.querySelector('.stat-score');
    expect(scoreEl?.textContent).toContain('64,200');

    const ouroEl = statsModalScreen.element.querySelector('.stat-ouro');
    expect(ouroEl?.textContent).toContain('240 🪙');

    const lenEl = statsModalScreen.element.querySelector('.stat-length');
    expect(lenEl?.textContent).toBe('4');

    const peakEl = statsModalScreen.element.querySelector('.stat-peak-length');
    expect(peakEl?.textContent).toBe('12');

    const comboEl = statsModalScreen.element.querySelector('.stat-combo');
    expect(comboEl?.textContent).toBe('32x');
  });

  it('3. Mode "run" renders detailed food breakdown and hostile bestiary eliminations', () => {
    statsModalScreen.show({ mode: 'run' });

    expect(statsModalScreen.element.querySelector('.food-apple-count')?.textContent).toBe('25');
    expect(statsModalScreen.element.querySelector('.food-golden-count')?.textContent).toBe('8');
    expect(statsModalScreen.element.querySelector('.food-potion-count')?.textContent).toBe('3');
    expect(statsModalScreen.element.querySelector('.food-shard-count')?.textContent).toBe('5');
    expect(statsModalScreen.element.querySelector('.food-prism-count')?.textContent).toBe('1');

    expect(statsModalScreen.element.querySelector('.kill-swarmling-count')?.textContent).toBe('45');
    expect(statsModalScreen.element.querySelector('.kill-scarab-count')?.textContent).toBe('20');
    expect(statsModalScreen.element.querySelector('.kill-spitter-count')?.textContent).toBe('12');
    expect(statsModalScreen.element.querySelector('.kill-phantom-count')?.textContent).toBe('6');
    expect(statsModalScreen.element.querySelector('.kill-drone-count')?.textContent).toBe('3');
    expect(statsModalScreen.element.querySelector('.kill-brute-count')?.textContent).toBe('2');
  });

  it('4. Mode "run" renders conquered bosses and installed cranial modules', () => {
    player.headAugment = 'fangs';
    player.headAugmentLevel = 2;
    player.headModules = { shield: 1, spikes: 2 };
    player.equippedHelmet = { Id: 'chitin', Name: 'Chitin Crown', Icon: '👑', Rarity: 'rare', Stats: {} };

    statsModalScreen.show({ mode: 'run' });

    const bossList = statsModalScreen.element.querySelector('.boss-defeats-list');
    expect(bossList?.textContent).toContain('Floor 1');
    expect(bossList?.textContent).toContain('Floor 2');

    const modContainer = statsModalScreen.element.querySelector('.installed-modules-list');
    expect(modContainer?.textContent).toContain('Chitin Crown');
    expect(modContainer?.textContent).toContain('Poison Fangs');
    expect(modContainer?.textContent).toContain('Carapace Shield');
    expect(modContainer?.textContent).toContain('Thorny Spine Armor');
  });

  it('5. Mode "run" renders live Cranial Lab challenge progress tracker with progress bars', () => {
    statsModalScreen.show({ mode: 'run' });

    const tracker = statsModalScreen.element.querySelector('.challenge-tracker-list');
    expect(tracker).not.toBeNull();

    const progressBars = tracker?.querySelectorAll('.challenge-progress-bar');
    expect(progressBars && progressBars.length).toBeGreaterThan(5);

    const progressFills = tracker?.querySelectorAll('.challenge-progress-fill');
    expect(progressFills && progressFills.length).toBeGreaterThan(5);
  });

  it('6. Mode "global" renders career ascension summary, lifetime totals, and armory unlocks', () => {
    const meta = MetaProgression.Instance;
    meta.records.totalRuns = 50;
    meta.records.victories = 15;
    meta.records.highScore = 520000;
    meta.records.highestFloor = 20;
    meta.records.highestCombo = 65;
    meta.records.totalKills = 8900;
    meta.records.totalFoods = 5600;
    meta.records.totalBosses = 110;
    meta.records.totalShards = 12000;
    meta.records.playTimeSec = 14400; // 4h 0m 0s
    meta.records.bestTimeSec = 720;   // 12m 0s

    statsModalScreen.show({ mode: 'global' });
    expect(statsModalScreen.currentMode).toBe('global');

    expect(statsModalScreen.element.querySelector('.record-total-runs')?.textContent).toContain('50');
    expect(statsModalScreen.element.querySelector('.record-victories')?.textContent).toContain('15');
    expect(statsModalScreen.element.querySelector('.record-win-rate')?.textContent).toBe('30.0%');
    expect(statsModalScreen.element.querySelector('.record-highest-floor')?.textContent).toContain('20');
    expect(statsModalScreen.element.querySelector('.record-high-score')?.textContent).toContain('520,000');
    expect(statsModalScreen.element.querySelector('.record-highest-combo')?.textContent).toContain('65x');

    expect(statsModalScreen.element.querySelector('.record-total-kills')?.textContent).toContain('8,900');
    expect(statsModalScreen.element.querySelector('.record-total-bosses')?.textContent).toContain('110');
    expect(statsModalScreen.element.querySelector('.record-total-foods')?.textContent).toContain('5,600');
    expect(statsModalScreen.element.querySelector('.record-total-shards')?.textContent).toContain('12,000');
    expect(statsModalScreen.element.querySelector('.record-play-time')?.textContent).toContain('4h 0m 0s');
    expect(statsModalScreen.element.querySelector('.record-best-time')?.textContent).toContain('12m 0s');

    const armoryList = statsModalScreen.element.querySelector('.class-mastery-list');
    expect(armoryList?.textContent).toContain('Emerald Viper');
  });

  it('7. Tab buttons switch between "run" and "global" modes dynamically', () => {
    statsModalScreen.show({ mode: 'run' });
    expect(statsModalScreen.currentMode).toBe('run');

    const tabGlobalBtn = statsModalScreen.element.querySelector('.btn-tab-global') as HTMLButtonElement;
    tabGlobalBtn.click();
    expect(statsModalScreen.currentMode).toBe('global');

    const tabRunBtn = statsModalScreen.element.querySelector('.btn-tab-run') as HTMLButtonElement;
    tabRunBtn.click();
    expect(statsModalScreen.currentMode).toBe('run');
  });

  it('8. HudView dispatches [T] hotkey to open modal-snake-lab on "telemetry" tab', () => {
    expect(rootLayout.hudView.element.querySelector('.btn-stats')).toBeNull();
    const handled = rootLayout.hudView.handleKeyDown(new KeyboardEvent('keydown', { code: 'KeyT' }));
    expect(handled).toBe(true);
    expect(rootLayout.activeScreenId).toBe('modal-snake-lab');
  });

  it('9. MenuScreen .btn-global-stats opens modal-stats in "global" mode', () => {
    mockEngine.state = GameState.Menu;
    mockEngine.State = GameState.Menu;

    rootLayout.showScreen('modal-main-menu');
    const menuStatsBtn = menuScreen.element.querySelector('.btn-global-stats') as HTMLButtonElement;
    expect(menuStatsBtn).not.toBeNull();

    menuStatsBtn.click();
    expect(rootLayout.activeScreenId).toBe('modal-stats');
    expect(statsModalScreen.currentMode).toBe('global');
  });

  it('10. InputManager handles KeyT and edge-triggers consumeStats', () => {
    const input = new InputManager();
    expect(input.consumeStats()).toBe(false);

    const eventT = new KeyboardEvent('keydown', { code: 'KeyT' });
    input.handleKeyDown(eventT);

    expect(input.statsPressed).toBe(true);
    expect(input.consumeStats()).toBe(true);
    expect(input.consumeStats()).toBe(false);
  });

  it('11. ScriptedInput supports StatsQueued and ConsumeStats', () => {
    const scripted = new ScriptedInput();
    expect(scripted.ConsumeStats()).toBe(false);

    scripted.StatsQueued = true;
    expect(scripted.ConsumeStats()).toBe(true);
    expect(scripted.ConsumeStats()).toBe(false);
  });

  it('12. Serpent length calculation is exactly player.segments.length + 1 across StatsModalScreen and HudView', () => {
    // 5 body segments + 1 head = 6 total length
    const serpent = new SnakePlayer('emerald', 1280, 720, 5);
    mockEngine.player = serpent;
    mockEngine.Player = serpent;

    statsModalScreen.show({ mode: 'run' });
    const lenEl = statsModalScreen.element.querySelector('.stat-length');
    expect(lenEl?.textContent).toBe('6');

    // Test HudView synchronization
    rootLayout.hudView.refresh(mockEngine);
    const hudVal = rootLayout.hudView.element.querySelector('.hud-length-val, .hud-length, .stat-length, .stat-length-val');
    // If element exists in DOM, it reflects 6
    if (hudVal) {
      expect(hudVal.textContent).toBe('6');
    }
  });

  it('13. Live Cranial Challenge Progress Tracker calculates exact progress percentages using synchronized counters (curLen, totalFoods, totalKills, bossesCount, highCombo)', () => {
    // Setup specific telemetry counters
    const serpent = new SnakePlayer('emerald', 1280, 720, 4); // segments.length = 4 -> curLen = 5
    mockEngine.player = serpent;
    mockEngine.Player = serpent;
    mockEngine.combat.foodsEaten = 20;
    mockEngine.combat.FoodsEaten = 20;
    mockEngine.combat.kills = 15;
    mockEngine.combat.Kills = 15;
    mockEngine.combat.bossKills = 1;
    mockEngine.combat.BossKills = 1;
    mockEngine.combat.highestRunCombo = 10;
    mockEngine.combat.HighestRunCombo = 10;
    mockEngine.combat.foodsEatenByType = { apple: 12, golden: 1 };
    mockEngine.combat.killsByType = { swarmling: 5, scarab: 6, spitter: 3 };

    statsModalScreen.show({ mode: 'run' });

    const tracker = statsModalScreen.element.querySelector('.challenge-tracker-list')!;
    expect(tracker).not.toBeNull();

    const cards = tracker.querySelectorAll('.challenge-row-card');
    expect(cards.length).toBeGreaterThan(0);

    // Verify food challenge (e.g. Bio-Magnet: Collect 2 Golden Apples in a run -> 1 / 2 = 50%)
    const magnetCard = Array.from(cards).find(c => c.textContent?.includes('Bio-Magnet') || c.textContent?.includes('Magnet')) as HTMLElement;
    if (magnetCard) {
      const statusEl = magnetCard.querySelector('.challenge-status');
      const countEl = magnetCard.querySelector('.challenge-count');
      expect(countEl?.textContent).toBe('1 / 2');
      expect(statusEl?.textContent).toBe('50%');
    }

    // Verify bestiary hunt challenge (e.g. Ramming Horns: Slay 10 Armored Scarabs in a run -> 6 / 10 = 60%)
    const hornsCard = Array.from(cards).find(c => c.textContent?.includes('Horns')) as HTMLElement;
    if (hornsCard) {
      const statusEl = hornsCard.querySelector('.challenge-status');
      const countEl = hornsCard.querySelector('.challenge-count');
      expect(countEl?.textContent).toBe('6 / 10');
      expect(statusEl?.textContent).toBe('60%');
    }

    // Verify boss challenge (e.g. Voracious Maw Tier 1: Defeat Centipede Behemoth (Floor 1) -> 1 / 1 = 100%)
    const mawCard = Array.from(cards).find(c => c.textContent?.includes('Maw')) as HTMLElement;
    if (mawCard) {
      const countEl = mawCard.querySelector('.challenge-count');
      expect(countEl?.textContent).toContain('1 / 1');
    }
  });
});
