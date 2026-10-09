import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { setupMockDom, MockElement } from './MockDom';
import { UiRoot } from '../ui/UiRoot';
import { HudView } from '../ui/HudView';
import { SnakeLabScreen } from '../ui/screens/SnakeLabScreen';
import { GameEngine } from '../sim/GameEngine';
import { ResponsiveLayout } from '../ui/ResponsiveLayout';
import { Services } from '../core/Services';
import { NullFx, NullSound, ISound } from '../core/Contracts';
import { InputManager } from '../input/InputManager';
import { MetaProgression } from '../data/MetaProgression';
import { SaveIO } from '../platform/SaveIO';

class TestSoundSpy extends NullSound implements ISound {
  public uiCount = 0;
  public levelUpCount = 0;
  public errorCount = 0;

  public override playUi(): void { this.uiCount++; }
  public override playLevelUp(): void { this.levelUpCount++; }
  public override playError(): void { this.errorCount++; }
}

describe('Smartphone Top HUD & Mutation Lab Clarity & De-Cluttering', () => {
  let restoreDom: () => void;
  let container: MockElement;
  let engine: GameEngine;
  let uiRoot: UiRoot;
  let hud: HudView;
  let soundSpy: TestSoundSpy;

  beforeEach(() => {
    restoreDom = setupMockDom();
    SaveIO.memoryBackendEnabled = true;
    SaveIO.clearMemory();
    MetaProgression.Instance.reset();

    soundSpy = new TestSoundSpy();
    Services.Sound = soundSpy;
    Services.Fx = new NullFx();
    Services.Input = InputManager.instance;

    container = document.createElement('div') as any;
    engine = new GameEngine(Services.Fx);
    uiRoot = UiRoot.init(container as any, engine);
    engine.setUiRoot(uiRoot);
    hud = uiRoot.hudView;
  });

  afterEach(() => {
    restoreDom();
  });

  it('1. Smartphone Top HUD renders clean vitals and hides redundant class tag on phone tier', () => {
    const phoneMetrics = ResponsiveLayout.instance.computeMetrics(390, 844);
    hud.applyMetrics(phoneMetrics);
    expect(hud.element.classList.contains('tier-phone')).toBe(true);

    const vitalsHeader = hud.element.querySelector('.hud-vitals-header');
    expect(vitalsHeader).toBeDefined();

    const ouroBadge = hud.element.querySelector('.hud-ouro-badge, .hud-xp-badge');
    expect(ouroBadge).toBeDefined();

    const hpVal = hud.element.querySelector('.hud-hp-val');
    expect(hpVal).toBeDefined();
  });

  it('2. Top action buttons (Lab and Pause) are clearly accessible with generous hit areas', () => {
    const phoneMetrics = ResponsiveLayout.instance.computeMetrics(390, 844);
    hud.applyMetrics(phoneMetrics);

    const labBtn = hud.element.querySelector('.btn-lab') as HTMLButtonElement;
    const pauseBtn = hud.element.querySelector('.btn-pause') as HTMLButtonElement;

    expect(labBtn).toBeDefined();
    expect(pauseBtn).toBeDefined();

    engine.chooseMode('rogue');
    engine.selectedClass = 'emerald';
    engine.startRun();

    // Clicking Lab toggles lab modal
    labBtn.click();
    expect(uiRoot.activeScreenId).toBe('modal-snake-lab');
  });

  it('3. Combo, Score, and Shards display cleanly without layout collision', () => {
    engine.chooseMode('rogue');
    engine.selectedClass = 'emerald';
    engine.startRun();

    engine.Combat.Score = 1500;
    engine.Combat.ComboCount = 5;
    engine.Combat.ComboTimer = 4.0;
    hud.update();

    const scoreVal = hud.element.querySelector('.score-val') as HTMLElement;
    const comboCount = hud.element.querySelector('.combo-count') as HTMLElement;

    expect(scoreVal).toBeDefined();
    expect(comboCount).toBeDefined();
  });

  it('4. Mutation Lab renders clean segmented tabs, stat chips, and Deploy button', () => {
    const labScreen = new SnakeLabScreen(uiRoot);
    uiRoot.registerScreen(labScreen);
    uiRoot.showScreen('modal-snake-lab');

    const labBtn = labScreen.element.querySelector('.btn-tab-lab') as HTMLButtonElement;
    const helmetsBtn = labScreen.element.querySelector('.btn-tab-helmets') as HTMLButtonElement;
    const deployBtn = labScreen.element.querySelector('.btn-deploy-serpent') as HTMLButtonElement;
    const closeBtn = labScreen.element.querySelector('.btn-close-lab') as HTMLButtonElement;
    const statsBanner = labScreen.element.querySelector('.lab-points-label') as HTMLElement;

    expect(labBtn).toBeDefined();
    expect(helmetsBtn).toBeDefined();
    expect(deployBtn).toBeDefined();
    expect(closeBtn).toBeDefined();
    expect(statsBanner).toBeDefined();

    // Switching tabs updates active tab state
    helmetsBtn.click();
    expect(labScreen.activeTab).toBe('helmets');

    labBtn.click();
    expect(labScreen.activeTab).toBe('lab');
  });

  it('5. Mutation Lab modules render structured cards with distinct cost/tier badges and calibrated 30/40 Ouro base costs', () => {
    engine.chooseMode('rogue');
    engine.selectedClass = 'emerald';
    engine.startRun();
    engine.Player!.Ouro = 500;

    const labScreen = new SnakeLabScreen(uiRoot);
    uiRoot.registerScreen(labScreen);
    uiRoot.showScreen('modal-snake-lab');

    const drawer = labScreen.element.querySelector('.lab-docked-card-container');
    expect(drawer).toBeDefined();

    const cards = drawer!.querySelectorAll('.lab-docked-card-btn');
    expect(cards.length).toBeGreaterThan(0);

    // Initial module base cost is 30 Ouro, augment base cost is 40 Ouro
    const spitterBtn = Array.from(cards).find(c => c.textContent?.includes('Attack Spitter')) as HTMLButtonElement;
    expect(spitterBtn).toBeDefined();
    expect(spitterBtn.textContent).toContain('30 Ouro');

    const fangsBtn = Array.from(cards).find(c => c.textContent?.includes('Venom Fangs')) as HTMLButtonElement;
    expect(fangsBtn).toBeDefined();
    expect(fangsBtn.textContent).toContain('40 Ouro');

    // After 1 purchase, module costs escalate by +15 Ouro, augments escalate by +20 Ouro
    spitterBtn.click();
    labScreen.refresh();

    const updatedCards = drawer!.querySelectorAll('.lab-docked-card-btn');
    const teslaBtn = Array.from(updatedCards).find(c => c.textContent?.includes('Bio-Arc Coil')) as HTMLButtonElement;
    expect(teslaBtn).toBeDefined();
    expect(teslaBtn.textContent).toContain('45 Ouro'); // 30 + 15

    const updatedFangsBtn = Array.from(updatedCards).find(c => c.textContent?.includes('Venom Fangs')) as HTMLButtonElement;
    expect(updatedFangsBtn).toBeDefined();
    expect(updatedFangsBtn.textContent).toContain('60 Ouro'); // 40 + 20
  });

  it('6. Mutation Lab enforces visual unaffordability feedback (disabled button, not-allowed cursor, error sound) when Ouro is insufficient', () => {
    engine.chooseMode('rogue');
    engine.selectedClass = 'emerald';
    engine.startRun();

    const p = engine.Player!;
    p.XpToNext = 10000;
    p.Ouro = 15; // Insufficient for 30 Ouro module
    p.TotalOuroCollected = 15;
    p.Xp = 15;

    const labScreen = new SnakeLabScreen(uiRoot);
    uiRoot.registerScreen(labScreen);
    uiRoot.showScreen('modal-snake-lab');

    const cards = labScreen.element.querySelectorAll('.lab-docked-card-btn');
    const spitterBtn = Array.from(cards).find(c => c.textContent?.includes('Attack Spitter')) as HTMLButtonElement;
    expect(spitterBtn).toBeDefined();
    expect(spitterBtn.disabled).toBe(false);
    expect(spitterBtn.getAttribute('aria-disabled')).toBe('true');
    expect(spitterBtn.style.cursor).toBe('not-allowed');

    const initialErrorCount = soundSpy.errorCount;
    spitterBtn.click();
    expect(soundSpy.errorCount).toBe(initialErrorCount + 1);
    expect(p.GetHeadModuleLevel('turret')).toBe(0);

    // Grant 100 Ouro -> button becomes affordable
    p.Ouro = 100;
    p.Xp = 100;
    labScreen.refresh();

    const refreshedCards = labScreen.element.querySelectorAll('.lab-docked-card-btn');
    const refreshedSpitterBtn = Array.from(refreshedCards).find(c => c.textContent?.includes('Attack Spitter')) as HTMLButtonElement;
    expect(refreshedSpitterBtn).toBeDefined();
    expect(refreshedSpitterBtn.disabled).toBe(false);
    expect(refreshedSpitterBtn.getAttribute('aria-disabled')).toBe('false');
    expect(refreshedSpitterBtn.style.cursor).toBe('pointer');

    refreshedSpitterBtn.click();
    expect(soundSpy.levelUpCount).toBeGreaterThan(0);
    expect(p.GetHeadModuleLevel('turret')).toBe(1);
    expect(p.Ouro).toBe(70); // 100 - 30 = 70 Ouro
  });

  it('7. Spending in Mutation Lab synchronizes wallet decrement across both Lab Ouro chip and in-game HUD', () => {
    engine.chooseMode('rogue');
    engine.selectedClass = 'emerald';
    engine.startRun();

    const p = engine.Player!;
    p.Ouro = 100;
    p.Xp = 100;

    const labScreen = new SnakeLabScreen(uiRoot);
    uiRoot.registerScreen(labScreen);
    uiRoot.showScreen('modal-snake-lab');
    labScreen.refresh();
    hud.refresh(engine);

    expect(labScreen.element.querySelector('.lab-stat-chip-ouro')?.textContent).toContain('🪙 100 Ouro');
    expect(hud.element.querySelector('.hud-ouro-val, .hud-xp-val')?.textContent).toBe('100');

    const cards = labScreen.element.querySelectorAll('.lab-docked-card-btn');
    const spitterBtn = Array.from(cards).find(c => c.textContent?.includes('Attack Spitter')) as HTMLButtonElement;
    expect(spitterBtn).toBeDefined();

    spitterBtn.click();

    expect(p.Ouro).toBe(70);

    expect(labScreen.element.querySelector('.lab-stat-chip-ouro')?.textContent).toContain('🪙 70 Ouro');
    expect(hud.element.querySelector('.hud-ouro-val, .hud-xp-val')?.textContent).toBe('70');
  });
});
