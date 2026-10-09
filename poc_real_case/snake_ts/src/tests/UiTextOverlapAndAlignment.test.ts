import { describe, it, expect, beforeEach } from 'vitest';
import { ResponsiveLayout } from '../ui/ResponsiveLayout';
import { UiRoot } from '../ui/UiRoot';
import { HudView } from '../ui/HudView';
import { SnakePlayer } from '../sim/SnakePlayer';
import { Services } from '../core/Services';
import { InputManager } from '../input/InputManager';
import { setupMockDom, MockElement } from './MockDom';

describe('UI TEXT OVERLAP & ALIGNMENT CONFORMANCE', () => {
  let restoreDom: () => void;
  let container: MockElement;
  let engine: any;

  beforeEach(() => {
    restoreDom = setupMockDom();
    Services.Sound = { playUi: () => {}, play: () => {}, playSfx: () => {} } as any;
    Services.Fx = { spawnParticles: () => {}, emit: () => {} } as any;
    Services.Input = InputManager.instance;
    InputManager.instance.reset();

    container = document.createElement('div') as any;
    container.id = 'ui-root';
    document.body.appendChild(container as any);

    engine = {
      player: new SnakePlayer('emerald', 800, 600, 5),
      combat: {
        score: 1250,
        comboCount: 4,
        comboMultiplier: 2,
        comboTimer: 2.5,
        comboMaxTime: 4.0,
        frenzyActive: false,
        shardsEarned: 10,
      },
      currentFloor: 1,
      floorFoodProgress: 5,
      foodTarget: 15,
      fps: 60,
      state: 1,
      runInProgress: true,
      meta: { shards: 120 },
    };
  });

  it('RED 1: Phone tier formats HP text concisely without Head/Body parenthesized overflow', () => {
    const root = UiRoot.init(container as any, engine);
    const hud = root.hudView;

    // Apply Phone metrics
    const phoneMetrics = ResponsiveLayout.instance.computeMetrics(390, 844);
    root.applyMetrics(phoneMetrics);
    hud.refresh(engine);

    const hpVal = hud.element.querySelector('.hud-hp-val') as HTMLElement;
    expect(hpVal).not.toBeNull();
    // Must NOT contain verbose parenthesized parts breakdown on phone
    expect(hpVal.textContent).not.toContain('Head:');
    expect(hpVal.textContent).not.toContain('Body:');
    expect(hpVal.textContent).toContain('/');
  });

  it('RED 2: Desktop tier retains detailed Head & Body HP breakdown in vitals card', () => {
    const root = UiRoot.init(container as any, engine);
    const hud = root.hudView;

    // Apply Desktop metrics
    const desktopMetrics = ResponsiveLayout.instance.computeMetrics(1920, 1080);
    root.applyMetrics(desktopMetrics);
    hud.refresh(engine);

    const hpVal = hud.element.querySelector('.hud-hp-val') as HTMLElement;
    expect(hpVal).not.toBeNull();
    expect(hpVal.textContent).toContain('Head:');
    expect(hpVal.textContent).toContain('Body:');
  });

  it('RED 3: Touch controls layer is hidden when modal screens are displayed', () => {
    const root = UiRoot.init(container as any, engine);
    const hud = root.hudView;

    const phoneMetrics = ResponsiveLayout.instance.computeMetrics(390, 844);
    root.applyMetrics(phoneMetrics);

    const touchLayer = hud.element.querySelector('.touch-controls-layer') as HTMLElement;
    expect(touchLayer).not.toBeNull();
    expect(touchLayer.style.display).toBe('block');

    // Open Class Select modal
    root.showScreen('modal-class-select');
    expect(touchLayer.style.display).toBe('none');

    // Close modal and resume combat
    root.hideScreen();
    expect(touchLayer.style.display).toBe('block');
  });

  it('RED 4: Touch controls layer is hidden during Sanctuary and Mutation Lab modals', () => {
    const root = UiRoot.init(container as any, engine);
    const hud = root.hudView;

    const phoneMetrics = ResponsiveLayout.instance.computeMetrics(390, 844);
    root.applyMetrics(phoneMetrics);

    const touchLayer = hud.element.querySelector('.touch-controls-layer') as HTMLElement;
    expect(touchLayer.style.display).toBe('block');

    // Open Sanctuary modal
    root.showScreen('modal-sanctuary');
    expect(touchLayer.style.display).toBe('none');

    // Open Mutation Lab modal
    root.showScreen('modal-snake-lab');
    expect(touchLayer.style.display).toBe('none');
  });
});
