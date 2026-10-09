import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupMockDom, MockElement } from './MockDom';
import { UiRoot } from '../ui/UiRoot';
import { Widgets } from '../ui/Widgets';
import { BaseModalScreen } from '../ui/BaseModalScreen';
import { RunSummaryScreen, RunSummaryMode } from '../ui/screens/RunSummaryScreen';
import { GameOverScreen } from '../ui/screens/GameOverScreen';
import { FloorClearScreen } from '../ui/screens/FloorClearScreen';
import { SettingsScreen } from '../ui/screens/SettingsScreen';
import { PauseSettingsScreen } from '../ui/screens/PauseSettingsScreen';
import { MenuScreen } from '../ui/screens/MenuScreen';
import { SanctuaryScreen } from '../ui/screens/SanctuaryScreen';
import { HelpScreen } from '../ui/screens/HelpScreen';
import { GameEngine } from '../sim/GameEngine';
import { GameState } from '../sim/GameState';
import { Services } from '../core/Services';
import { NullFx, NullSound } from '../core/Contracts';
import { InputManager } from '../input/InputManager';
import { SaveIO } from '../platform/SaveIO';
import { MetaProgression } from '../data/MetaProgression';
import { ResponsiveLayout } from '../ui/ResponsiveLayout';

class TestConcreteModal extends BaseModalScreen {
  public readonly id: string = 'modal-test-concrete';
  public buildCalled = false;
  public onShowCalled = false;
  public onHideCalled = false;
  public lastPayload: any = null;

  constructor(root: UiRoot) {
    super(root, 'test-modal-overlay');
    this.build();
  }

  protected build(): void {
    this.buildCalled = true;
    const { panel, header, content, actions } = this.createModalShell(
      'TEST TITLE',
      'Test subtitle info'
    );
    const bodyText = document.createElement('p');
    bodyText.className = 'test-body';
    bodyText.textContent = 'Modal Content';
    content.appendChild(bodyText);

    const closeBtn = Widgets.createButton('Close Test', 'primary', () => {
      this.root.hideScreen(this.id);
    });
    actions.appendChild(closeBtn);
    this.element.appendChild(panel);
  }

  protected onShow(payload?: any): void {
    this.onShowCalled = true;
    this.lastPayload = payload;
  }

  protected onHide(): void {
    this.onHideCalled = true;
  }
}

describe('UI / UX Screen Consolidation & Modal Shell Architecture', () => {
  let restoreDom: () => void;
  let container: MockElement;
  let engine: GameEngine;
  let uiRoot: UiRoot;
  let soundSpy: { uiCount: number; sfxVol: number; musVol: number; muted: boolean };
  let fxSpy: { shakeScale: number };

  beforeEach(() => {
    restoreDom = setupMockDom();
    SaveIO.memoryBackendEnabled = true;
    SaveIO.clearMemory();
    MetaProgression.Instance.reset();

    soundSpy = { uiCount: 0, sfxVol: 0.7, musVol: 0.4, muted: false };
    fxSpy = { shakeScale: 1.0 };

    const mockSound: any = new NullSound();
    mockSound.playUi = () => { soundSpy.uiCount++; };
    mockSound.setSfxVolume = (v: number) => { soundSpy.sfxVol = v; };
    mockSound.setMusicVolume = (v: number) => { soundSpy.musVol = v; };
    mockSound.setMuted = (m: boolean) => { soundSpy.muted = m; };
    Services.Sound = mockSound;

    const mockFx: any = new NullFx();
    mockFx.setShakeScale = (s: number) => { fxSpy.shakeScale = s; };
    Services.Fx = mockFx;
    Services.Input = InputManager.instance;

    container = document.createElement('div') as any;
    engine = new GameEngine(Services.Fx);
    uiRoot = UiRoot.init(container as any, engine);
    engine.setUiRoot(uiRoot);
  });

  afterEach(() => {
    restoreDom();
  });

  // =========================================================================
  // 1. Standardized Widgets & BaseModalScreen Architecture
  // =========================================================================
  describe('1. Standardized Widgets & BaseModalScreen Architecture', () => {
    it('1.1 formats numbers with grouped() and plain()', () => {
      expect(Widgets.grouped(1234567)).toBe('1,234,567');
      expect(Widgets.grouped(0)).toBe('0');
      expect(Widgets.grouped(99.8)).toBe('100');
      expect(Widgets.plain(1234.4)).toBe('1234');
      expect(Widgets.plain(42)).toBe('42');
    });

    it('1.2 creates glass panel with specified max-width and custom classes', () => {
      const panel = Widgets.createGlassPanel(720, 'custom-test-panel');
      expect(panel.classList.contains('modal-panel')).toBe(true);
      expect(panel.classList.contains('glass-panel')).toBe(true);
      expect(panel.classList.contains('custom-test-panel')).toBe(true);
      expect(panel.style.maxWidth).toBe('720px');
    });

    it('1.3 creates modal headers with title, subtitle, and cybernetic styles', () => {
      const { container, titleEl, subtitleEl } = Widgets.createModalHeader(
        'CYBERNETIC MATRIX',
        'Advanced system parameters',
        'custom-title-class'
      );
      expect(container.classList.contains('modal-header')).toBe(true);
      expect(titleEl.textContent).toBe('CYBERNETIC MATRIX');
      expect(titleEl.classList.contains('cyber-modal-title')).toBe(true);
      expect(titleEl.classList.contains('custom-title-class')).toBe(true);
      expect(subtitleEl?.textContent).toBe('Advanced system parameters');
      expect(subtitleEl?.classList.contains('cyber-modal-subtitle')).toBe(true);
    });

    it('1.4 creates stat cards with dynamic setValue() updater and color styling', () => {
      const { card, labelEl, valEl, setValue } = Widgets.createStatCard(
        'TOTAL ESSENCE',
        '+150 💎',
        '#ffd166',
        'custom-stat-val'
      );
      expect(card.classList.contains('stat-card')).toBe(true);
      expect(labelEl.textContent).toBe('TOTAL ESSENCE');
      expect(valEl.textContent).toBe('+150 💎');
      expect(valEl.classList.contains('custom-stat-val')).toBe(true);
      expect(valEl.style.color).toBe('#ffd166');

      setValue('+300 💎');
      expect(valEl.textContent).toBe('+300 💎');
    });

    it('1.5 creates stat grids grouping multiple cards', () => {
      const card1 = Widgets.createStatCard('KILLS', 25).card;
      const card2 = Widgets.createStatCard('COMBO', '12x').card;
      const grid = Widgets.createStatGrid([card1, card2], 'defeat-stats-grid');
      expect(grid.classList.contains('stats-grid')).toBe(true);
      expect(grid.classList.contains('defeat-stats-grid')).toBe(true);
      expect(grid.children.length).toBe(2);
    });

    it('1.6 creates buttons with variants and click event handler', () => {
      let clicked = false;
      const btn = Widgets.createButton('EXECUTE PROTOCOL', 'danger', () => {
        clicked = true;
      }, 'btn-extra-test');
      expect(btn.textContent).toBe('EXECUTE PROTOCOL');
      expect(btn.classList.contains('cyber-btn')).toBe(true);
      expect(btn.classList.contains('btn-danger')).toBe(true);
      expect(btn.classList.contains('btn-extra-test')).toBe(true);

      btn.click();
      expect(clicked).toBe(true);
    });

    it('1.7 creates meters with dynamic setFill() percentage updates', () => {
      const { container, fill, setFill } = Widgets.createMeter(10, '#00f0b5', 0.5);
      expect(container.classList.contains('meter-container')).toBe(true);
      expect(container.style.height).toBe('10px');
      expect(fill.style.width).toBe('50%');

      setFill(0.85);
      expect(fill.style.width).toBe('85%');
      setFill(1.5); // clamps to 100%
      expect(fill.style.width).toBe('100%');
      setFill(-0.2); // clamps to 0%
      expect(fill.style.width).toBe('0%');
    });

    it('1.8 creates interactive form sliders, checkboxes, selects, and action rows', () => {
      let sliderVal = 0;
      const sliderRow = Widgets.createSliderRow('SFX Volume', 0.6, 0, 1, 0.05, (v) => {
        sliderVal = v;
      }, (v) => `${Math.round(v * 100)}%`, 'sfx-slider', 'sfx-val');
      expect(sliderRow.row.classList.contains('setting-row')).toBe(true);
      expect(sliderRow.slider.value).toBe('0.6');
      expect(sliderRow.valLabel.textContent).toBe('60%');

      sliderRow.slider.value = '0.9';
      sliderRow.slider.dispatchEvent(new Event('input'));
      expect(sliderVal).toBe(0.9);
      expect(sliderRow.valLabel.textContent).toBe('90%');

      let checkedVal = false;
      const checkRow = Widgets.createCheckboxRow('Mute All', false, (c) => {
        checkedVal = c;
      }, 'mute-check');
      checkRow.checkbox.checked = true;
      checkRow.checkbox.dispatchEvent(new Event('change'));
      expect(checkedVal).toBe(true);

      let selectVal = 'high';
      const selectRow = Widgets.createSelectRow('Quality', [
        { value: 'high', label: 'High' },
        { value: 'low', label: 'Low' },
      ], 'high', (v) => { selectVal = v; }, 'quality-select');
      selectRow.select.value = 'low';
      selectRow.select.dispatchEvent(new Event('change'));
      expect(selectVal).toBe('low');

      const actionsRow = Widgets.createActionsRow(sliderRow.row, checkRow.row);
      expect(actionsRow.classList.contains('modal-actions-row')).toBe(true);
      expect(actionsRow.children.length).toBe(2);
    });

    it('1.9 BaseModalScreen implements full lifecycle and shell hierarchy', () => {
      const screen = new TestConcreteModal(uiRoot);
      expect(screen.id).toBe('modal-test-concrete');
      expect(screen.buildCalled).toBe(true);
      expect(screen.element.classList.contains('modal-overlay')).toBe(true);
      expect(screen.element.classList.contains('test-modal-overlay')).toBe(true);

      uiRoot.registerScreen(screen);
      uiRoot.showScreen('modal-test-concrete', { foo: 'bar' });

      expect(screen.onShowCalled).toBe(true);
      expect(screen.lastPayload).toEqual({ foo: 'bar' });
      expect(uiRoot.activeScreenId).toBe('modal-test-concrete');

      uiRoot.hideScreen('modal-test-concrete');
      expect(screen.onHideCalled).toBe(true);
      expect(uiRoot.activeScreenId).toBeNull();
    });
  });

  // =========================================================================
  // 2. Polymorphic RunSummaryScreen (Defeat, Floor Clear, Victory)
  // =========================================================================
  describe('2. Polymorphic RunSummaryScreen (Defeat, Floor Clear, Victory)', () => {
    let summaryScreen: RunSummaryScreen;

    beforeEach(() => {
      summaryScreen = new RunSummaryScreen(uiRoot);
      uiRoot.registerScreen(summaryScreen);
    });

    it('2.1 renders defeat mode with full stats telemetry and routes', () => {
      engine.currentFloor = 4;
      engine.combat.score = 8500;
      engine.combat.highestCombo = 15;
      engine.combat.shardsEarned = 72;
      engine.combat.kills = 38;

      uiRoot.showScreen('modal-summary', { mode: 'defeat' });

      expect(uiRoot.activeScreenId).toBe('modal-summary');
      const title = summaryScreen.element.querySelector('.defeat-title, .cyber-modal-title')!;
      expect(title.textContent).toContain('SERPENT DISSOLUTION');

      const floorEl = summaryScreen.element.querySelector('.end-floor-val')!;
      const scoreEl = summaryScreen.element.querySelector('.end-score-val')!;
      const comboEl = summaryScreen.element.querySelector('.end-combo-val')!;
      const shardsEl = summaryScreen.element.querySelector('.end-shards-val')!;
      const killsEl = summaryScreen.element.querySelector('.end-kills-val')!;

      expect(floorEl.textContent).toBe('4');
      expect(scoreEl.textContent).toBe('8,500');
      expect(comboEl.textContent).toBe('15x');
      expect(shardsEl.textContent).toContain('72');
      expect(killsEl.textContent).toBe('38');

      // Buttons
      const retryBtn = summaryScreen.element.querySelector('.btn-retry') as HTMLButtonElement;
      const sanctuaryBtn = summaryScreen.element.querySelector('.btn-sanctuary') as HTMLButtonElement;
      const menuBtn = summaryScreen.element.querySelector('.btn-menu') as HTMLButtonElement;

      expect(retryBtn).toBeDefined();
      expect(sanctuaryBtn).toBeDefined();
      expect(menuBtn).toBeDefined();

      let restartCalled = false;
      engine.restartRun = () => { restartCalled = true; };
      retryBtn.click();
      expect(restartCalled).toBe(true);
      expect(soundSpy.uiCount).toBeGreaterThan(0);

      // Sanctuary button route
      sanctuaryBtn.click();
      expect(uiRoot.activeScreenId).toBe('modal-sanctuary');

      // Main Menu button route
      menuBtn.click();
      expect(uiRoot.activeScreenId).toBe('modal-main-menu');
    });

    it('2.2 renders floor_clear mode with floor telemetry and Next Floor button', () => {
      engine.currentFloor = 7;
      engine.combat.score = 24000;
      engine.combat.floorShardsEarned = 35;
      engine.combat.kills = 64;
      engine.combat.highestCombo = 28;

      uiRoot.showScreen('modal-summary', { mode: 'floor_clear' });

      const title = summaryScreen.element.querySelector('.victory-title, .cyber-modal-title')!;
      expect(title.textContent).toContain('CLEARED');

      const floorNum = summaryScreen.element.querySelector('.victory-floor-num')!;
      expect(floorNum.textContent).toBe('7');

      const shardsEl = summaryScreen.element.querySelector('.shards-earned-val')!;
      const scoreEl = summaryScreen.element.querySelector('.score-earned-val')!;
      const killsEl = summaryScreen.element.querySelector('.kills-val')!;
      const comboEl = summaryScreen.element.querySelector('.combo-peak-val')!;

      expect(shardsEl.textContent).toContain('35');
      expect(scoreEl.textContent).toBe('24,000');
      expect(killsEl.textContent).toBe('64');
      expect(comboEl.textContent).toBe('28x');

      let nextFloorCalled = false;
      (engine as any).nextFloor = () => { nextFloorCalled = true; };
      const nextBtn = summaryScreen.element.querySelector('.btn-next-floor') as HTMLButtonElement;
      expect(nextBtn).toBeDefined();
      nextBtn.click();
      expect(nextFloorCalled).toBe(true);
    });

    it('2.3 renders victory mode for final ascension completion', () => {
      engine.currentFloor = 10;
      engine.combat.score = 150000;
      engine.combat.highestCombo = 45;
      engine.combat.shardsEarned = 500;
      engine.combat.kills = 180;

      uiRoot.showScreen('modal-summary', { mode: 'victory' });

      const title = summaryScreen.element.querySelector('.victory-title, .cyber-modal-title')!;
      expect(title.textContent).toContain('VICTORY');

      const floorEl = summaryScreen.element.querySelector('.end-floor-val')!;
      const scoreEl = summaryScreen.element.querySelector('.end-score-val')!;
      expect(floorEl.textContent).toBe('10');
      expect(scoreEl.textContent).toBe('150,000');

      const retryBtn = summaryScreen.element.querySelector('.btn-retry') as HTMLButtonElement;
      expect(retryBtn).toBeDefined();
      expect(retryBtn.textContent).toContain('Restart');

      let victoryRestartCalled = false;
      engine.restartRun = () => { victoryRestartCalled = true; };
      retryBtn.click();
      expect(victoryRestartCalled).toBe(true);
    });

    it('2.4 dynamically switches mode on subsequent show() invocations', () => {
      uiRoot.showScreen('modal-summary', { mode: 'floor_clear' });
      expect(summaryScreen.currentMode).toBe('floor_clear');
      expect(summaryScreen.element.querySelector('.btn-next-floor')).not.toBeNull();

      uiRoot.showScreen('modal-summary', { mode: 'defeat' });
      expect(summaryScreen.currentMode).toBe('defeat');
      expect(summaryScreen.element.querySelector('.btn-retry')).not.toBeNull();

      uiRoot.showScreen('modal-summary', { mode: 'victory' });
      expect(summaryScreen.currentMode).toBe('victory');
    });

    it('2.5 GameOverScreen and FloorClearScreen legacy wrappers work seamlessly', () => {
      const gameOver = new GameOverScreen(uiRoot);
      const floorClear = new FloorClearScreen(uiRoot);
      uiRoot.registerScreen(gameOver);
      uiRoot.registerScreen(floorClear);

      engine.currentFloor = 3;
      engine.combat.score = 5000;
      engine.combat.shardsEarned = 20;
      engine.combat.kills = 12;
      engine.combat.highestCombo = 8;

      uiRoot.showScreen('modal-game-over');
      expect(uiRoot.activeScreenId).toBe('modal-game-over');
      expect(gameOver.element.querySelector('.end-floor-val')?.textContent).toBe('3');

      uiRoot.showScreen('modal-floor-clear');
      expect(uiRoot.activeScreenId).toBe('modal-floor-clear');
      expect(floorClear.element.querySelector('.victory-floor-num')?.textContent).toBe('3');
    });
  });

  // =========================================================================
  // 3. Dedicated In-Game Pause Overlay (PauseSettingsScreen & SettingsScreen)
  // =========================================================================
  describe('3. Dedicated In-Game Pause Overlay', () => {
    let pauseScreen: PauseSettingsScreen;
    let settingsScreen: SettingsScreen;

    beforeEach(() => {
      pauseScreen = new PauseSettingsScreen(uiRoot);
      settingsScreen = new SettingsScreen(uiRoot);
      uiRoot.registerScreen(pauseScreen);
      uiRoot.registerScreen(settingsScreen);
      uiRoot.registerScreen(new MenuScreen(uiRoot));
      uiRoot.registerScreen(new HelpScreen(uiRoot));
    });

    it('3.1 registers with id "modal-pause" and displays pause banner', () => {
      expect(pauseScreen.id).toBe('modal-pause');
      uiRoot.showScreen('modal-pause');
      expect(uiRoot.activeScreenId).toBe('modal-pause');

      const title = pauseScreen.element.querySelector('.cyber-modal-title')!;
      expect(title.textContent).toContain('PAUSED');
    });

    it('3.2 quick resume button unpauses game engine and closes modal', () => {
      engine.chooseMode('rogue');
      engine.selectedClass = 'emerald';
      engine.startRun();
      expect(engine.State).toBe(GameState.Playing);

      engine.togglePause();
      expect(engine.State).toBe(GameState.Paused);
      expect(uiRoot.activeScreenId).toBe('modal-pause');

      const resumeBtn = pauseScreen.element.querySelector('.btn-resume, .btn-close-settings') as HTMLButtonElement;
      expect(resumeBtn).toBeDefined();
      resumeBtn.click();

      expect(engine.State).toBe(GameState.Playing);
      expect(engine.paused).toBe(false);
      expect(uiRoot.isModalOpen()).toBe(false);
    });

    it('3.3 instant audio, music, and shake controls dispatch to services in real time', () => {
      uiRoot.showScreen('modal-pause');

      const sfxSlider = pauseScreen.element.querySelector('.sfx-slider') as HTMLInputElement;
      sfxSlider.value = '0.25';
      sfxSlider.dispatchEvent(new Event('input'));
      expect(soundSpy.sfxVol).toBe(0.25);

      const musSlider = pauseScreen.element.querySelector('.mus-slider') as HTMLInputElement;
      musSlider.value = '0.85';
      musSlider.dispatchEvent(new Event('input'));
      expect(soundSpy.musVol).toBe(0.85);

      const muteCheck = pauseScreen.element.querySelector('.mute-check') as HTMLInputElement;
      muteCheck.checked = true;
      muteCheck.dispatchEvent(new Event('change'));
      expect(soundSpy.muted).toBe(true);

      const shakeSlider = pauseScreen.element.querySelector('.shake-slider') as HTMLInputElement;
      shakeSlider.value = '0.5';
      shakeSlider.dispatchEvent(new Event('input'));
      expect(fxSpy.shakeScale).toBe(0.5);
    });

    it('3.4 abandon run button triggers dissolution / defeat and clears pause state', () => {
      engine.chooseMode('rogue');
      engine.selectedClass = 'emerald';
      engine.startRun();
      engine.togglePause();
      expect(engine.State).toBe(GameState.Paused);

      let gameOverTriggered = false;
      engine.handleGameOver = (victory: boolean) => {
        gameOverTriggered = true;
        expect(victory).toBe(false);
      };

      const abandonBtn = pauseScreen.element.querySelector('.btn-abandon') as HTMLButtonElement;
      expect(abandonBtn).toBeDefined();
      abandonBtn.click();

      expect(gameOverTriggered).toBe(true);
    });

    it('3.5 jumpers to Codex & Full Settings navigate properly with back-stack support', () => {
      engine.chooseMode('rogue');
      engine.selectedClass = 'emerald';
      engine.startRun();
      engine.togglePause();
      expect(uiRoot.activeScreenId).toBe('modal-pause');

      // Codex button
      const codexBtn = pauseScreen.element.querySelector('.btn-settings-codex') as HTMLButtonElement;
      expect(codexBtn).toBeDefined();
      codexBtn.click();
      expect(uiRoot.activeScreenId).toBe('modal-help');

      // Close help -> returns to pause screen
      const helpCloseBtn = (uiRoot.getScreen<HelpScreen>('modal-help')!.element.querySelector('.btn-close-help') ||
        uiRoot.getScreen<HelpScreen>('modal-help')!.element.querySelector('.btn-close-top') ||
        uiRoot.getScreen<HelpScreen>('modal-help')!.element.querySelector('.btn-back')) as HTMLButtonElement;
      helpCloseBtn.click();
      expect(uiRoot.activeScreenId).toBe('modal-pause');

      // Full Settings button
      const fullSettingsBtn = pauseScreen.element.querySelector('.btn-full-settings') as HTMLButtonElement;
      if (fullSettingsBtn) {
        fullSettingsBtn.click();
        expect(uiRoot.activeScreenId).toBe('modal-settings');
      }
    });
  });

  // =========================================================================
  // 4. Modal Navigation Stack, Alias Resolutions & Non-Regression
  // =========================================================================
  describe('4. Modal Navigation Stack & Alias Resolution Non-Regression', () => {
    it('4.1 resolves bidirectional aliases correctly', () => {
      const summary = new RunSummaryScreen(uiRoot);
      const pause = new PauseSettingsScreen(uiRoot);
      uiRoot.registerScreen(summary);
      uiRoot.registerScreen(pause);

      uiRoot.showScreen('modal-game-over');
      expect(uiRoot.activeScreenId).toBe('modal-summary');

      uiRoot.showScreen('modal-floor-clear');
      expect(uiRoot.activeScreenId).toBe('modal-summary');

      uiRoot.showScreen('modal-pause');
      expect(uiRoot.activeScreenId).toBe('modal-pause');

      uiRoot.showScreen('modal-codex');
      expect(uiRoot.activeScreenId).toBe('modal-help');

      uiRoot.showScreen('modal-guide');
      expect(uiRoot.activeScreenId).toBe('modal-help');

      uiRoot.showScreen('modal-checklist');
      expect(uiRoot.activeScreenId).toBe('modal-dev-checklist');
    });

    it('4.2 preserves touch dock visibility state when modals toggle', () => {
      const phoneMetrics = ResponsiveLayout.instance.update(390, 844);
      uiRoot.applyMetrics(phoneMetrics);

      // No modal -> touch controls active
      uiRoot.hideModals();
      expect(uiRoot.hudView.touchControlsVisible).toBe(true);

      // Open modal -> touch controls hidden
      uiRoot.showScreen('modal-settings');
      expect(uiRoot.isModalOpen()).toBe(true);
      expect(uiRoot.hudView.touchControlsVisible).toBe(false);

      // Close modal -> touch controls restored
      uiRoot.hideScreen('modal-settings');
      expect(uiRoot.isModalOpen()).toBe(false);
      expect(uiRoot.hudView.touchControlsVisible).toBe(true);
    });

    it('4.3 multi-level modal push and pop restores previous screen without orphaned state', () => {
      uiRoot.registerScreen(new MenuScreen(uiRoot));
      uiRoot.registerScreen(new SanctuaryScreen(uiRoot));
      uiRoot.registerScreen(new SettingsScreen(uiRoot));

      engine.showMenu();
      expect(uiRoot.activeScreenId).toBe('modal-main-menu');

      uiRoot.showScreen('modal-sanctuary');
      expect(uiRoot.activeScreenId).toBe('modal-sanctuary');
      expect(uiRoot.navigationStack).toContain('modal-main-menu');

      uiRoot.showScreen('modal-settings');
      expect(uiRoot.activeScreenId).toBe('modal-settings');
      expect(uiRoot.navigationStack).toContain('modal-sanctuary');

      // Pop settings -> Sanctuary
      uiRoot.hideScreen('modal-settings');
      expect(uiRoot.activeScreenId).toBe('modal-sanctuary');

      // Pop Sanctuary -> Main Menu
      uiRoot.hideScreen('modal-sanctuary');
      expect(uiRoot.activeScreenId).toBe('modal-main-menu');
    });
  });
});
