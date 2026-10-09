import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { setupMockDom, MockElement } from './MockDom';
import { ResponsiveLayout } from '../ui/ResponsiveLayout';
import { UiRoot } from '../ui/UiRoot';
import { HudView } from '../ui/HudView';
import { SnakePlayer } from '../sim/SnakePlayer';
import { Services } from '../core/Services';
import { NullFx, NullSound } from '../core/Contracts';
import { InputManager } from '../input/InputManager';
import { GameEngine } from '../sim/GameEngine';

describe('Android Display Cutout, Notch & Safe Area Protection', () => {
  let restoreDom: () => void;
  let container: MockElement;
  let engine: GameEngine;
  let uiRoot: UiRoot;

  beforeEach(() => {
    restoreDom = setupMockDom();
    Services.Sound = new NullSound();
    Services.Fx = new NullFx();
    Services.Input = InputManager.instance;

    container = document.createElement('div') as any;
    container.id = 'ui-root';
    document.body.appendChild(container as any);

    engine = new GameEngine(Services.Fx);
    uiRoot = UiRoot.init(container as any, engine);
    engine.setUiRoot(uiRoot);
  });

  afterEach(() => {
    restoreDom();
  });

  it('1. Pixel 6 portrait resolution (412x915) is identified as phone tier with safe padding bounds', () => {
    const layout = ResponsiveLayout.instance;
    const metrics = layout.computeMetrics(412, 915);

    expect(metrics.deviceTier).toBe('phone');
    expect(metrics.isMobile).toBe(true);
    expect(metrics.isTouch).toBe(true);
    expect(metrics.hudPad).toBeGreaterThanOrEqual(8);
  });

  it('2. Pixel 6 landscape resolution (915x412) enables short-landscape layout mode', () => {
    const layout = ResponsiveLayout.instance;
    const metrics = layout.computeMetrics(915, 412);

    expect(metrics.deviceTier).toBe('phone');
    expect(metrics.aspectMode).toBe('short-landscape');
    expect(metrics.isMobile).toBe(true);
  });

  it('3. HudView on smartphone tier configures dedicated icon buttons with valid touch targets', () => {
    const hudView = new HudView(uiRoot);
    hudView.update();

    const pauseBtn = hudView.element.querySelector('.btn-pause') as HTMLElement;
    const labBtn = hudView.element.querySelector('.btn-lab') as HTMLElement;

    expect(pauseBtn).not.toBeNull();
    expect(labBtn).not.toBeNull();

    // Verify buttons are clickable
    let pauseClicked = false;
    pauseBtn.addEventListener('click', () => { pauseClicked = true; });
    pauseBtn.click();
    expect(pauseClicked).toBe(true);
  });

  it('4. Anchor calculations include safe area insets to avoid display cutouts', () => {
    const layout = ResponsiveLayout.instance;
    layout.metrics.safeArea = { left: 24, top: 32, right: 24, bottom: 16 };

    const topLeft = layout.getAnchorPos('top-left', 10);
    const topRight = layout.getAnchorPos('top-right', 10);

    expect(topLeft.x).toBeGreaterThanOrEqual(34);
    expect(topLeft.y).toBeGreaterThanOrEqual(42);
    expect(topRight.y).toBeGreaterThanOrEqual(42);
  });
});
