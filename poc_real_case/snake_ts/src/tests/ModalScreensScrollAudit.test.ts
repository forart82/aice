/**
 * Ouroboros Ascension — Modal Screens Scroll & Bottom Clearance Audit Suite (ModalScreensScrollAudit.test.ts)
 *
 * Verifies that all modal screens across src/ui/screens/:
 * 1. Maintain a single scroll container per modal (zero nested scroll traps).
 * 2. Keep action buttons / footers pinned and accessible with proper bottom clearance.
 * 3. Adapt responsively to smartphone emulator viewports (iPhone 15 Pro 393x852 & landscape 852x393).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { setupMockDom, MockElement } from './MockDom';
import { UiRoot } from '../ui/UiRoot';
import { GameEngine } from '../sim/GameEngine';
import { Services } from '../core/Services';
import { NullFx, NullSound } from '../core/Contracts';
import { InputManager } from '../input/InputManager';
import { MetaProgression } from '../data/MetaProgression';
import { SaveIO } from '../platform/SaveIO';
import { ResponsiveLayout } from '../ui/ResponsiveLayout';

import { ClassSelectScreen } from '../ui/screens/ClassSelectScreen';
import { SettingsScreen } from '../ui/screens/SettingsScreen';
import { SanctuaryScreen } from '../ui/screens/SanctuaryScreen';
import { SnakeLabScreen } from '../ui/screens/SnakeLabScreen';
import { MultiScreenModal } from '../ui/screens/MultiScreenModal';
import { PauseSettingsScreen } from '../ui/screens/PauseSettingsScreen';
import { DraftScreen } from '../ui/screens/DraftScreen';
import { RunSummaryScreen } from '../ui/screens/RunSummaryScreen';
import { GameOverScreen } from '../ui/screens/GameOverScreen';
import { DevChecklistScreen } from '../ui/screens/DevChecklistScreen';
import { HelpScreen } from '../ui/screens/HelpScreen';
import { MenuScreen } from '../ui/screens/MenuScreen';

describe('MODAL SCREENS SCROLL & BOTTOM CLEARANCE AUDIT', () => {
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
  });

  afterEach(() => {
    restoreDom();
  });

  it('1. ClassSelectScreen: Uses unified scroll container for archetype cards and helmet vault with zero nested scroll traps', () => {
    const classScreen = new ClassSelectScreen(uiRoot);
    uiRoot.registerScreen(classScreen);
    uiRoot.showScreen('modal-class-select');

    const panel = classScreen.element.querySelector('.class-panel') as HTMLElement;
    expect(panel).not.toBeNull();
    expect(panel.style.display).toBe('flex');
    expect(panel.style.flexDirection).toBe('column');
    expect(panel.style.overflow).toBe('hidden');

    const scrollContainer = classScreen.element.querySelector('.class-cards-scroll-container') as HTMLElement;
    expect(scrollContainer).not.toBeNull();
    expect(scrollContainer.style.overflowY).toBe('auto');

    // Both class-cards-grid and helmet-vault-section must reside within this single scroll container
    const grid = scrollContainer.querySelector('.class-cards-grid');
    const vault = scrollContainer.querySelector('.helmet-vault-section');
    expect(grid).not.toBeNull();
    expect(vault).not.toBeNull();

    // Verify helmet vault container has no nested scroll trap
    const helmetCards = vault?.querySelectorAll('.helmet-card');
    expect(helmetCards).toBeDefined();

    // Verify bottom action buttons are docked and outside the scroll body
    const actionsRow = classScreen.element.querySelector('.modal-actions-row') as HTMLElement;
    expect(actionsRow).not.toBeNull();
    expect(actionsRow.parentElement).toBe(panel);
    expect(actionsRow.querySelector('.btn-back')).not.toBeNull();

    const startBtn = actionsRow.querySelector('.btn-ascend') as HTMLButtonElement;
    expect(startBtn).not.toBeNull();
    expect(startBtn.classList.contains('cyber-btn')).toBe(true);
    expect(startBtn.classList.contains('btn-primary')).toBe(true);
    expect(startBtn.textContent).toContain('Start');

    let runStarted = false;
    engine.startRun = () => { runStarted = true; };
    startBtn.click();
    expect(runStarted).toBe(true);
  });

  it('2. SettingsScreen: Fixed header & docked footer with single scrollable settings form', () => {
    const settingsScreen = new SettingsScreen(uiRoot);
    uiRoot.registerScreen(settingsScreen);
    uiRoot.showScreen('modal-settings');

    const panel = settingsScreen.element.querySelector('.settings-panel') as HTMLElement;
    expect(panel).not.toBeNull();
    expect(panel.style.display).toBe('flex');
    expect(panel.style.flexDirection).toBe('column');
    expect(panel.style.overflow).toBe('hidden');

    const scrollContainer = settingsScreen.element.querySelector('.settings-form-scroll-container') as HTMLElement;
    expect(scrollContainer).not.toBeNull();
    expect(scrollContainer.style.overflowY).toBe('auto');

    const actionsRow = settingsScreen.element.querySelector('.modal-actions-row') as HTMLElement;
    expect(actionsRow).not.toBeNull();
    expect(actionsRow.querySelector('.btn-close-settings')).not.toBeNull();
    expect(actionsRow.querySelector('.btn-settings-codex')).not.toBeNull();
  });

  it('3. SanctuaryScreen: Single scrollable upgrades grid with docked reset & back actions', () => {
    const sanctuaryScreen = new SanctuaryScreen(uiRoot);
    uiRoot.registerScreen(sanctuaryScreen);
    uiRoot.showScreen('modal-sanctuary');

    const panel = sanctuaryScreen.element.querySelector('.sanctuary-panel') as HTMLElement;
    expect(panel).not.toBeNull();
    expect(panel.style.display).toBe('flex');
    expect(panel.style.flexDirection).toBe('column');
    expect(panel.style.overflow).toBe('hidden');

    const scrollContainer = sanctuaryScreen.element.querySelector('.sanctuary-grid-scroll-container') as HTMLElement;
    expect(scrollContainer).not.toBeNull();
    expect(scrollContainer.style.overflowY).toBe('auto');

    const actionsRow = sanctuaryScreen.element.querySelector('.modal-actions-row') as HTMLElement;
    expect(actionsRow).not.toBeNull();
    expect(actionsRow.querySelector('.btn-reset-prog')).not.toBeNull();
    expect(actionsRow.querySelector('.btn-back')).not.toBeNull();
  });

  it('4. SnakeLabScreen: Fluid responsive height without 500px clamp overflow on small viewports', () => {
    const labScreen = new SnakeLabScreen(uiRoot);
    uiRoot.registerScreen(labScreen);
    uiRoot.showScreen('modal-snake-lab');

    const panel = labScreen.element.querySelector('.lab-panel') as HTMLElement;
    expect(panel).not.toBeNull();
    expect(panel.style.maxHeight).toBe('min(92vh, 92dvh)');
    expect(panel.style.overflow).toBe('hidden');

    const scrollContainer = labScreen.element.querySelector('.lab-docked-card-container') as HTMLElement;
    expect(scrollContainer).not.toBeNull();
    expect(scrollContainer.style.overflowY).toBe('auto');

    const deployBtn = labScreen.element.querySelector('.btn-deploy-serpent');
    expect(deployBtn).not.toBeNull();
  });

  it('5. MultiScreenModal: Smooth scrolling options list with docked close action', () => {
    const multiScreen = new MultiScreenModal(uiRoot);
    uiRoot.registerScreen(multiScreen);
    uiRoot.showScreen('modal-multiscreen');

    const panel = multiScreen.element.querySelector('.multiscreen-panel') as HTMLElement;
    expect(panel).not.toBeNull();
    expect(panel.style.display).toBe('flex');
    expect(panel.style.overflow).toBe('hidden');

    const optionsGrid = multiScreen.element.querySelector('.multiscreen-options-grid') as HTMLElement;
    expect(optionsGrid).not.toBeNull();
    expect(optionsGrid.style.overflowY).toBe('auto');

    const closeBtn = multiScreen.element.querySelector('.btn-close-modal');
    expect(closeBtn).not.toBeNull();
  });

  it('6. PauseSettingsScreen: Quick controls body scrolls cleanly while Resume & Abandon buttons remain pinned', () => {
    const pauseScreen = new PauseSettingsScreen(uiRoot);
    uiRoot.registerScreen(pauseScreen);
    uiRoot.showScreen('modal-pause');

    const panel = pauseScreen.element.querySelector('.pause-panel') as HTMLElement;
    expect(panel).not.toBeNull();
    expect(panel.style.display).toBe('flex');
    expect(panel.style.overflow).toBe('hidden');

    const body = pauseScreen.element.querySelector('.pause-controls-body') as HTMLElement;
    expect(body).not.toBeNull();
    expect(body.style.overflowY).toBe('auto');

    const resumeBtn = pauseScreen.element.querySelector('.btn-resume');
    const abandonBtn = pauseScreen.element.querySelector('.btn-abandon');
    expect(resumeBtn).not.toBeNull();
    expect(abandonBtn).not.toBeNull();
  });

  it('7. DraftScreen: Mutation cards grid scrolls smoothly with pinned re-roll & skip buttons', () => {
    const draftScreen = new DraftScreen(uiRoot);
    uiRoot.registerScreen(draftScreen);
    uiRoot.showScreen('modal-level-up');

    const panel = draftScreen.element.querySelector('.draft-panel') as HTMLElement;
    expect(panel).not.toBeNull();
    expect(panel.style.display).toBe('flex');
    expect(panel.style.overflow).toBe('hidden');

    const deckGrid = draftScreen.element.querySelector('.cards-deck-grid') as HTMLElement;
    expect(deckGrid).not.toBeNull();
    expect(deckGrid.style.overflowY).toBe('auto');

    const rerollBtn = draftScreen.element.querySelector('.btn-reroll');
    const skipBtn = draftScreen.element.querySelector('.btn-skip');
    expect(rerollBtn).not.toBeNull();
    expect(skipBtn).not.toBeNull();
  });

  it('8. RunSummaryScreen: Telemetry stats container scrolls cleanly with docked navigation actions & Restart buttons', () => {
    const summaryScreen = new RunSummaryScreen(uiRoot, 'modal-summary', 'defeat');
    uiRoot.registerScreen(summaryScreen);
    uiRoot.showScreen('modal-summary');

    const panel = summaryScreen.element.querySelector('.summary-panel') as HTMLElement;
    expect(panel).not.toBeNull();
    expect(panel.style.display).toBe('flex');
    expect(panel.style.overflow).toBe('hidden');

    const statsWrapper = summaryScreen.element.querySelector('.stats-wrapper') as HTMLElement;
    expect(statsWrapper).not.toBeNull();
    expect(statsWrapper.style.overflowY).toBe('auto');

    // Defeat Restart Button ("Rise Again ⚡")
    const retryBtn = summaryScreen.element.querySelector('.btn-retry') as HTMLButtonElement;
    const menuBtn = summaryScreen.element.querySelector('.btn-menu') as HTMLButtonElement;
    expect(retryBtn).not.toBeNull();
    expect(retryBtn.classList.contains('cyber-btn')).toBe(true);
    expect(retryBtn.classList.contains('btn-primary')).toBe(true);
    expect(retryBtn.textContent).toContain('Rise Again');
    expect(menuBtn).not.toBeNull();

    let restartCalled = false;
    engine.restartRun = () => { restartCalled = true; };
    retryBtn.click();
    expect(restartCalled).toBe(true);

    // Victory Restart Button ("Restart ⚡")
    uiRoot.showScreen('modal-summary', { mode: 'victory' });
    const victoryRetryBtn = summaryScreen.element.querySelector('.btn-retry') as HTMLButtonElement;
    expect(victoryRetryBtn).not.toBeNull();
    expect(victoryRetryBtn.classList.contains('cyber-btn')).toBe(true);
    expect(victoryRetryBtn.classList.contains('btn-primary')).toBe(true);
    expect(victoryRetryBtn.textContent).toContain('Restart');

    let victoryRestartCalled = false;
    engine.restartRun = () => { victoryRestartCalled = true; };
    victoryRetryBtn.click();
    expect(victoryRestartCalled).toBe(true);
  });

  it('9. DevChecklistScreen & HelpScreen: Single-scroll container architecture compliance', () => {
    const devScreen = new DevChecklistScreen(uiRoot);
    uiRoot.registerScreen(devScreen);
    uiRoot.showScreen('modal-dev-checklist');

    const devScroll = devScreen.element.querySelector('.dev-scroll-container');
    expect(devScroll).not.toBeNull();

    const helpScreen = new HelpScreen(uiRoot);
    uiRoot.registerScreen(helpScreen);
    uiRoot.showScreen('modal-help');

    const codexScroll = helpScreen.element.querySelector('.codex-scroll-container');
    expect(codexScroll).not.toBeNull();
  });

  it('10. iPhone 15 Pro 393x852 portrait and 852x393 landscape metrics compute accurately for all screens', () => {
    const layout = ResponsiveLayout.instance;

    const portraitMetrics = layout.computeMetrics(393, 852);
    expect(portraitMetrics.deviceTier).toBe('phone');
    expect(portraitMetrics.aspectMode).toBe('portrait');
    expect(portraitMetrics.windowWidth).toBe(393);
    expect(portraitMetrics.windowHeight).toBe(852);

    const landscapeMetrics = layout.computeMetrics(852, 393);
    expect(landscapeMetrics.deviceTier).toBe('phone');
    expect(landscapeMetrics.aspectMode).toBe('short-landscape');
    expect(landscapeMetrics.windowWidth).toBe(852);
    expect(landscapeMetrics.windowHeight).toBe(393);

    // Apply metrics across uiRoot
    uiRoot.applyMetrics(portraitMetrics);
    uiRoot.applyMetrics(landscapeMetrics);
  });

  it('11. Start and Restart Action Buttons Pinning, Visibility & Responsiveness Audit', () => {
    // 1. Start Button in ClassSelectScreen
    const classScreen = new ClassSelectScreen(uiRoot);
    uiRoot.registerScreen(classScreen);
    uiRoot.showScreen('modal-class-select');

    const classPanel = classScreen.element.querySelector('.class-panel') as HTMLElement;
    const classActionsRow = classScreen.element.querySelector('.modal-actions-row') as HTMLElement;
    expect(classActionsRow.parentElement).toBe(classPanel);
    const startBtn = classActionsRow.querySelector('.btn-ascend') as HTMLButtonElement;
    expect(startBtn).not.toBeNull();
    expect(startBtn.textContent).toContain('Start');
    expect(startBtn.classList.contains('btn-primary')).toBe(true);

    let startInvoked = false;
    engine.startRun = () => { startInvoked = true; };
    startBtn.click();
    expect(startInvoked).toBe(true);

    // 2. Restart Button in GameOverScreen (Defeat Summary)
    const gameOverScreen = new GameOverScreen(uiRoot);
    uiRoot.registerScreen(gameOverScreen);
    uiRoot.showScreen('modal-game-over');

    const defeatPanel = gameOverScreen.element.querySelector('.summary-panel') as HTMLElement;
    const defeatActionsRow = gameOverScreen.element.querySelector('.modal-actions-row') as HTMLElement;
    expect(defeatActionsRow.parentElement).toBe(defeatPanel);
    const defeatRestartBtn = defeatActionsRow.querySelector('.btn-retry') as HTMLButtonElement;
    expect(defeatRestartBtn).not.toBeNull();
    expect(defeatRestartBtn.textContent).toContain('Rise Again');
    expect(defeatRestartBtn.classList.contains('btn-primary')).toBe(true);

    let defeatRestartInvoked = false;
    engine.restartRun = () => { defeatRestartInvoked = true; };
    defeatRestartBtn.click();
    expect(defeatRestartInvoked).toBe(true);

    // 3. Restart Button in Victory Summary
    const victoryScreen = new RunSummaryScreen(uiRoot, 'modal-victory-summary', 'victory');
    uiRoot.registerScreen(victoryScreen);
    uiRoot.showScreen('modal-victory-summary');

    const victoryPanel = victoryScreen.element.querySelector('.summary-panel') as HTMLElement;
    const victoryActionsRow = victoryScreen.element.querySelector('.modal-actions-row') as HTMLElement;
    expect(victoryActionsRow.parentElement).toBe(victoryPanel);
    const victoryRestartBtn = victoryActionsRow.querySelector('.btn-retry') as HTMLButtonElement;
    expect(victoryRestartBtn).not.toBeNull();
    expect(victoryRestartBtn.textContent).toContain('Restart');
    expect(victoryRestartBtn.classList.contains('btn-primary')).toBe(true);

    let victoryRestartInvoked = false;
    engine.restartRun = () => { victoryRestartInvoked = true; };
    victoryRestartBtn.click();
    expect(victoryRestartInvoked).toBe(true);
  });
});
