import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupMockDom, MockElement } from './MockDom';
import { UiRoot } from '../ui/UiRoot';
import { PauseSettingsScreen } from '../ui/screens/PauseSettingsScreen';
import { MenuScreen } from '../ui/screens/MenuScreen';
import { GameOverScreen } from '../ui/screens/GameOverScreen';
import { GameEngine } from '../sim/GameEngine';
import { GameState } from '../sim/GameState';
import { Services } from '../core/Services';
import { NullFx, NullSound } from '../core/Contracts';
import { InputManager } from '../input/InputManager';
import { SaveIO } from '../platform/SaveIO';
import { MetaProgression } from '../data/MetaProgression';
import { ResponsiveLayout } from '../ui/ResponsiveLayout';

describe('Pause Screen Main Menu Navigation (TDD Protocol)', () => {
  let restoreDom: () => void;
  let container: MockElement;
  let engine: GameEngine;
  let uiRoot: UiRoot;
  let pauseScreen: PauseSettingsScreen;
  let menuScreen: MenuScreen;
  let soundSpy: { uiCount: number };

  beforeEach(() => {
    restoreDom = setupMockDom();
    SaveIO.memoryBackendEnabled = true;
    SaveIO.clearMemory();
    MetaProgression.Instance.reset();

    soundSpy = { uiCount: 0 };
    const mockSound: any = new NullSound();
    mockSound.playUi = () => { soundSpy.uiCount++; };
    mockSound.setSfxVolume = vi.fn();
    mockSound.setMusicVolume = vi.fn();
    mockSound.setMuted = vi.fn();
    Services.Sound = mockSound;

    const mockFx: any = new NullFx();
    mockFx.setShakeScale = vi.fn();
    Services.Fx = mockFx;
    Services.Input = InputManager.instance;

    container = document.createElement('div') as any;
    engine = new GameEngine(Services.Fx);
    uiRoot = UiRoot.init(container as any, engine);
    engine.setUiRoot(uiRoot);

    pauseScreen = new PauseSettingsScreen(uiRoot);
    menuScreen = new MenuScreen(uiRoot);
    uiRoot.registerScreen(pauseScreen);
    uiRoot.registerScreen(menuScreen);
    uiRoot.registerScreen(new GameOverScreen(uiRoot));
  });

  afterEach(() => {
    restoreDom();
  });

  it('1. PauseSettingsScreen contains a dedicated Main Menu button (.btn-main-menu) in actions row', () => {
    const actionsRow = pauseScreen.element.querySelector('.modal-actions-row');
    expect(actionsRow).not.toBeNull();

    const mainMenuBtn = pauseScreen.element.querySelector('.btn-main-menu') as HTMLButtonElement;
    expect(mainMenuBtn).not.toBeNull();
    expect(mainMenuBtn.classList.contains('cyber-btn')).toBe(true);
    expect(mainMenuBtn.classList.contains('btn-danger')).toBe(true);
    expect(mainMenuBtn.textContent).toContain('Main Menu');
  });

  it('2. Clicking .btn-main-menu calls engine.showMenu() / ShowMenu()', () => {
    engine.chooseMode('rogue');
    engine.selectedClass = 'emerald';
    engine.startRun();
    engine.togglePause();
    expect(engine.State).toBe(GameState.Paused);

    const showMenuSpy = vi.spyOn(engine, 'showMenu');
    const mainMenuBtn = pauseScreen.element.querySelector('.btn-main-menu') as HTMLButtonElement;
    expect(mainMenuBtn).not.toBeNull();
    mainMenuBtn.click();

    expect(showMenuSpy).toHaveBeenCalledTimes(1);
  });

  it('3. Clicking .btn-main-menu transitions engine.State to GameState.Menu', () => {
    engine.chooseMode('rogue');
    engine.selectedClass = 'emerald';
    engine.startRun();
    engine.togglePause();
    expect(engine.State).toBe(GameState.Paused);

    const mainMenuBtn = pauseScreen.element.querySelector('.btn-main-menu') as HTMLButtonElement;
    expect(mainMenuBtn).not.toBeNull();
    mainMenuBtn.click();

    expect(engine.State).toBe(GameState.Menu);
  });

  it('4. Clicking .btn-main-menu dismisses modal-pause and displays modal-main-menu', () => {
    engine.chooseMode('rogue');
    engine.selectedClass = 'emerald';
    engine.startRun();
    engine.togglePause();
    expect(uiRoot.activeScreenId).toBe('modal-pause');
    expect(pauseScreen.element.style.display).toBe('flex');

    const mainMenuBtn = pauseScreen.element.querySelector('.btn-main-menu') as HTMLButtonElement;
    expect(mainMenuBtn).not.toBeNull();
    mainMenuBtn.click();

    // modal-pause must be dismissed/hidden
    expect(pauseScreen.element.style.display).toBe('none');
    // modal-main-menu must be active and displayed
    expect(uiRoot.activeScreenId).toBe('modal-main-menu');
    expect(menuScreen.element.style.display).toBe('flex');
  });

  it('5. Clicking .btn-main-menu plays UI sound, persists settings, and abandons run', () => {
    engine.chooseMode('rogue');
    engine.selectedClass = 'emerald';
    engine.startRun();
    engine.togglePause();

    const saveSettingsSpy = vi.spyOn(pauseScreen, 'saveSettings');
    const abandonRunSpy = vi.spyOn(engine, 'AbandonRun');

    const initialSoundCount = soundSpy.uiCount;
    const mainMenuBtn = pauseScreen.element.querySelector('.btn-main-menu') as HTMLButtonElement;
    expect(mainMenuBtn).not.toBeNull();
    mainMenuBtn.click();

    expect(soundSpy.uiCount).toBeGreaterThan(initialSoundCount);
    expect(saveSettingsSpy).toHaveBeenCalled();
    expect(abandonRunSpy).toHaveBeenCalled();
    expect(engine.RunActive).toBe(false);
  });

  it('6. Supports responsive viewports across mobile and desktop without layout breakdown', () => {
    const viewports = [
      { name: 'iPhone SE', w: 375, h: 667 },
      { name: 'FHD Desktop', w: 1920, h: 1080 }
    ];

    for (const vp of viewports) {
      const metrics = ResponsiveLayout.instance.computeMetrics(vp.w, vp.h);
      uiRoot.applyMetrics(metrics);

      pauseScreen.show();
      const actionsRow = pauseScreen.element.querySelector('.modal-actions-row') as HTMLElement;
      expect(actionsRow).not.toBeNull();
      const mainMenuBtn = pauseScreen.element.querySelector('.btn-main-menu') as HTMLElement;
      expect(mainMenuBtn).not.toBeNull();
      expect(mainMenuBtn.parentElement).toBe(actionsRow);
    }
  });
});
