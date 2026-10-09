import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { setupMockDom, MockElement } from './MockDom';
import { UiRoot } from '../ui/UiRoot';
import { GameEngine } from '../sim/GameEngine';
import { GameState } from '../sim/GameState';
import { MenuScreen } from '../ui/screens/MenuScreen';
import { ClassSelectScreen } from '../ui/screens/ClassSelectScreen';
import { SanctuaryScreen } from '../ui/screens/SanctuaryScreen';
import { SettingsScreen } from '../ui/screens/SettingsScreen';
import { SnakeLabScreen } from '../ui/screens/SnakeLabScreen';
import { MultiScreenModal } from '../ui/screens/MultiScreenModal';
import { DraftScreen } from '../ui/screens/DraftScreen';
import { FloorClearScreen } from '../ui/screens/FloorClearScreen';
import { GameOverScreen } from '../ui/screens/GameOverScreen';
import { SaveIO } from '../platform/SaveIO';
import { MetaProgression } from '../data/MetaProgression';
import { Services } from '../core/Services';
import { NullFx, NullSound } from '../core/Contracts';
import { InputManager } from '../input/InputManager';

describe('Modal Navigation Stack & In-Game Pause/Resume Integrity', () => {
  let restoreDom: () => void;
  let container: MockElement;
  let engine: GameEngine;
  let uiRoot: UiRoot;

  beforeEach(() => {
    restoreDom = setupMockDom();
    SaveIO.memoryBackendEnabled = true;
    SaveIO.clearMemory();
    MetaProgression.Instance.reset();

    Services.Sound = new NullSound();
    Services.Fx = new NullFx();
    Services.Input = InputManager.instance;

    container = document.createElement('div') as any;
    engine = new GameEngine(Services.Fx);
    uiRoot = UiRoot.init(container as any, engine);
    engine.setUiRoot(uiRoot);

    // Register all screens
    uiRoot.registerScreen(new MenuScreen(uiRoot));
    uiRoot.registerScreen(new ClassSelectScreen(uiRoot));
    uiRoot.registerScreen(new SanctuaryScreen(uiRoot));
    uiRoot.registerScreen(new SettingsScreen(uiRoot));
    uiRoot.registerScreen(new SnakeLabScreen(uiRoot));
    uiRoot.registerScreen(new MultiScreenModal(uiRoot));
    uiRoot.registerScreen(new DraftScreen(uiRoot));
    uiRoot.registerScreen(new FloorClearScreen(uiRoot));
    uiRoot.registerScreen(new GameOverScreen(uiRoot));
  });

  afterEach(() => {
    restoreDom();
  });

  it('1. Main Menu -> Settings -> Save & Close returns directly to Main Menu', () => {
    engine.showMenu();
    expect(uiRoot.activeScreenId).toBe('modal-main-menu');

    // User clicks Settings on Main Menu
    const menuScreen = uiRoot.getScreen<MenuScreen>('modal-main-menu')!;
    const settingsBtn = menuScreen.element.querySelector('.btn-settings') as HTMLButtonElement;
    expect(settingsBtn).toBeDefined();
    settingsBtn.click();

    expect(uiRoot.activeScreenId).toBe('modal-settings');

    // User modifies settings and clicks Save & Close
    const settingsScreen = uiRoot.getScreen<SettingsScreen>('modal-settings')!;
    const closeBtn = settingsScreen.element.querySelector('.btn-close-settings') as HTMLButtonElement;
    expect(closeBtn).toBeDefined();
    closeBtn.click();

    // Must return to Main Menu, NOT leave a blank screen
    expect(uiRoot.activeScreenId).toBe('modal-main-menu');
    expect(menuScreen.element.style.display).not.toBe('none');
  });

  it('2. In-Game -> Pause [P] -> Click Save & Close unpauses engine and resumes gameplay', () => {
    engine.chooseMode('rogue');
    engine.selectedClass = 'emerald';
    engine.startRun();

    expect(engine.State).toBe(GameState.Playing);
    expect(engine.paused).toBe(false);
    expect(uiRoot.isModalOpen()).toBe(false);

    // Player presses 'P' or clicks pause button in HUD
    engine.togglePause();

    expect(engine.State).toBe(GameState.Paused);
    expect(engine.paused).toBe(true);
    expect(uiRoot.activeScreenId).toBe('modal-settings');

    // Player clicks Save & Close on the settings/pause modal
    const settingsScreen = uiRoot.getScreen<SettingsScreen>('modal-settings')!;
    const closeBtn = settingsScreen.element.querySelector('.btn-close-settings') as HTMLButtonElement;
    closeBtn.click();

    // MUST resume game automatically - player should NOT be stuck in pause mode!
    expect(engine.State).toBe(GameState.Playing);
    expect(engine.paused).toBe(false);
    expect(uiRoot.isModalOpen()).toBe(false);
    expect(uiRoot.activeScreenId).toBeNull();
  });

  it('3. In-Game -> Pause [P] -> Press P again unpauses and resumes gameplay', () => {
    engine.chooseMode('rogue');
    engine.selectedClass = 'emerald';
    engine.startRun();

    engine.togglePause();
    expect(engine.State).toBe(GameState.Paused);
    expect(uiRoot.activeScreenId).toBe('modal-settings');

    engine.togglePause();
    expect(engine.State).toBe(GameState.Playing);
    expect(engine.paused).toBe(false);
    expect(uiRoot.isModalOpen()).toBe(false);
  });

  it('4. Main Menu -> Sanctuary -> Settings -> Save & Close returns to Sanctuary, then Return to Menu returns to Main Menu', () => {
    engine.showMenu();
    expect(uiRoot.activeScreenId).toBe('modal-main-menu');

    // Open Sanctuary
    const menuScreen = uiRoot.getScreen<MenuScreen>('modal-main-menu')!;
    const sanctuaryBtn = menuScreen.element.querySelector('.btn-sanctuary') as HTMLButtonElement;
    sanctuaryBtn.click();
    expect(uiRoot.activeScreenId).toBe('modal-sanctuary');

    // Open Settings from Sanctuary
    uiRoot.showScreen('modal-settings');
    expect(uiRoot.activeScreenId).toBe('modal-settings');

    // Close Settings -> should go back to Sanctuary
    const settingsScreen = uiRoot.getScreen<SettingsScreen>('modal-settings')!;
    const closeSettingsBtn = settingsScreen.element.querySelector('.btn-close-settings') as HTMLButtonElement;
    closeSettingsBtn.click();
    expect(uiRoot.activeScreenId).toBe('modal-sanctuary');

    // In Sanctuary, click "Return to Menu" -> should return to Main Menu
    const sanctuaryScreen = uiRoot.getScreen<SanctuaryScreen>('modal-sanctuary')!;
    const backBtn = sanctuaryScreen.element.querySelector('.btn-back') as HTMLButtonElement;
    backBtn.click();
    expect(uiRoot.activeScreenId).toBe('modal-main-menu');
  });

  it('5. Main Menu -> Class Select -> Back returns to Main Menu', () => {
    engine.showMenu();
    expect(uiRoot.activeScreenId).toBe('modal-main-menu');

    // Choose mode opens Class Select
    engine.chooseMode('rogue');
    expect(uiRoot.activeScreenId).toBe('modal-class-select');

    // Click Back
    const classSelectScreen = uiRoot.getScreen<ClassSelectScreen>('modal-class-select')!;
    const backBtn = classSelectScreen.element.querySelector('.btn-back') as HTMLButtonElement;
    backBtn.click();
    expect(uiRoot.activeScreenId).toBe('modal-main-menu');
  });

  it('6. Main Menu -> MultiScreen -> Close returns to Main Menu', () => {
    engine.showMenu();
    expect(uiRoot.activeScreenId).toBe('modal-main-menu');

    uiRoot.showScreen('modal-multiscreen');
    expect(uiRoot.activeScreenId).toBe('modal-multiscreen');

    const multiScreen = uiRoot.getScreen<MultiScreenModal>('modal-multiscreen')!;
    const closeBtn = multiScreen.element.querySelector('.btn-close-modal') as HTMLButtonElement;
    closeBtn.click();
    expect(uiRoot.activeScreenId).toBe('modal-main-menu');
  });

  it('7. In-Game -> Snake Lab -> Deploy unpauses and returns to playing state', () => {
    engine.chooseMode('rogue');
    engine.selectedClass = 'emerald';
    engine.startRun();

    // Open Lab in-game
    engine.toggleLab();
    expect(engine.State === GameState.LevelUp || engine.State === GameState.Paused).toBe(true);
    expect(uiRoot.activeScreenId).toBe('modal-snake-lab');

    // Click Deploy
    const labScreen = uiRoot.getScreen<SnakeLabScreen>('modal-snake-lab')!;
    const deployBtn = labScreen.element.querySelector('.btn-deploy-serpent') as HTMLButtonElement;
    deployBtn.click();

    expect(engine.State).toBe(GameState.Playing);
    expect(engine.paused).toBe(false);
    expect(uiRoot.isModalOpen()).toBe(false);
  });

  it('8. In-Game -> Snake Lab -> Close unpauses and returns to playing state', () => {
    engine.chooseMode('rogue');
    engine.selectedClass = 'emerald';
    engine.startRun();

    // Open Lab in-game
    engine.toggleLab();
    expect(engine.State === GameState.LevelUp || engine.State === GameState.Paused).toBe(true);
    expect(uiRoot.activeScreenId).toBe('modal-snake-lab');

    // Click Close
    const labScreen = uiRoot.getScreen<SnakeLabScreen>('modal-snake-lab')!;
    const closeBtn = labScreen.element.querySelector('.btn-close-lab') as HTMLButtonElement;
    closeBtn.click();

    expect(engine.State).toBe(GameState.Playing);
    expect(engine.paused).toBe(false);
    expect(uiRoot.isModalOpen()).toBe(false);
  });

  it('9. Main Menu -> Snake Lab -> Close returns to Main Menu', () => {
    engine.showMenu();
    expect(uiRoot.activeScreenId).toBe('modal-main-menu');

    uiRoot.showScreen('modal-snake-lab');
    expect(uiRoot.activeScreenId).toBe('modal-snake-lab');

    const labScreen = uiRoot.getScreen<SnakeLabScreen>('modal-snake-lab')!;
    const closeBtn = labScreen.element.querySelector('.btn-close-lab') as HTMLButtonElement;
    closeBtn.click();

    expect(uiRoot.activeScreenId).toBe('modal-main-menu');
  });

  it('10. Multi-level deep modal stack correctly handles chained returns without orphan state', () => {
    engine.showMenu();
    expect(uiRoot.activeScreenId).toBe('modal-main-menu');

    uiRoot.showScreen('modal-sanctuary');
    expect(uiRoot.activeScreenId).toBe('modal-sanctuary');

    uiRoot.showScreen('modal-multiscreen');
    expect(uiRoot.activeScreenId).toBe('modal-multiscreen');

    uiRoot.showScreen('modal-settings');
    expect(uiRoot.activeScreenId).toBe('modal-settings');

    // Pop 1: Settings -> MultiScreen
    const settingsScreen = uiRoot.getScreen<SettingsScreen>('modal-settings')!;
    const closeSettings = settingsScreen.element.querySelector('.btn-close-settings') as HTMLButtonElement;
    closeSettings.click();
    expect(uiRoot.activeScreenId).toBe('modal-multiscreen');

    // Pop 2: MultiScreen -> Sanctuary
    const multiScreen = uiRoot.getScreen<MultiScreenModal>('modal-multiscreen')!;
    const closeMulti = multiScreen.element.querySelector('.btn-close-modal') as HTMLButtonElement;
    closeMulti.click();
    expect(uiRoot.activeScreenId).toBe('modal-sanctuary');

    // Pop 3: Sanctuary -> Main Menu
    const sanctuaryScreen = uiRoot.getScreen<SanctuaryScreen>('modal-sanctuary')!;
    const backSanctuary = sanctuaryScreen.element.querySelector('.btn-back') as HTMLButtonElement;
    backSanctuary.click();
    expect(uiRoot.activeScreenId).toBe('modal-main-menu');
  });
});
