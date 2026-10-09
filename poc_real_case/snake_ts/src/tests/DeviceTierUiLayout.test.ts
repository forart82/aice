import { describe, it, expect, beforeEach } from 'vitest';
import { ResponsiveLayout, DeviceTier } from '../ui/ResponsiveLayout';
import { UiRoot } from '../ui/UiRoot';
import { HudView } from '../ui/HudView';
import { SnakePlayer } from '../sim/SnakePlayer';
import { Services } from '../core/Services';
import { InputManager } from '../input/InputManager';
import { setupMockDom, MockElement } from './MockDom';

describe('MULTI-TIER RESPONSIVE DEVICE UI (PHONE / TABLET / DESKTOP)', () => {
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

  it('RED 1: ResponsiveLayout computes deviceTier accurately across phone, tablet, and desktop viewports', () => {
    const layout = ResponsiveLayout.instance;

    // Phones
    expect(layout.computeMetrics(390, 844).deviceTier).toBe('phone');
    expect(layout.computeMetrics(844, 390).deviceTier).toBe('phone');
    expect(layout.computeMetrics(320, 480).deviceTier).toBe('phone');
    expect(layout.computeMetrics(412, 915).deviceTier).toBe('phone');

    // Tablets
    expect(layout.computeMetrics(768, 1024).deviceTier).toBe('tablet');
    expect(layout.computeMetrics(1024, 768).deviceTier).toBe('tablet');
    expect(layout.computeMetrics(820, 1180).deviceTier).toBe('tablet');

    // Desktop
    expect(layout.computeMetrics(1920, 1080).deviceTier).toBe('desktop');
    expect(layout.computeMetrics(2560, 1440).deviceTier).toBe('desktop');
    expect(layout.computeMetrics(1440, 900).deviceTier).toBe('desktop');
  });

  it('RED 2: HudView and UiRoot toggle tier-phone, tier-tablet, and tier-desktop classes based on device metrics', () => {
    const root = UiRoot.init(container as any, engine);
    const hud = root.hudView;

    // Apply Smartphone metrics
    const phoneMetrics = ResponsiveLayout.instance.computeMetrics(390, 844);
    root.applyMetrics(phoneMetrics);

    expect(hud.element.classList.contains('tier-phone')).toBe(true);
    expect(hud.element.classList.contains('tier-desktop')).toBe(false);

    // Apply Tablet metrics
    const tabletMetrics = ResponsiveLayout.instance.computeMetrics(768, 1024);
    root.applyMetrics(tabletMetrics);

    expect(hud.element.classList.contains('tier-tablet')).toBe(true);
    expect(hud.element.classList.contains('tier-phone')).toBe(false);

    // Apply Desktop metrics
    const desktopMetrics = ResponsiveLayout.instance.computeMetrics(1920, 1080);
    root.applyMetrics(desktopMetrics);

    expect(hud.element.classList.contains('tier-desktop')).toBe(true);
    expect(hud.element.classList.contains('tier-phone')).toBe(false);
  });

  it('RED 3: Phone tier activates minimalist top status bar and hides desktop hints to maximize arena visibility', () => {
    const root = UiRoot.init(container as any, engine);
    const hud = root.hudView;

    const phoneMetrics = ResponsiveLayout.instance.computeMetrics(390, 844);
    root.applyMetrics(phoneMetrics);

    // Touch layer must be active on phone
    const touchLayer = hud.element.querySelector('.touch-controls-layer') as HTMLElement;
    expect(touchLayer).not.toBeNull();
    expect(touchLayer.style.display).toBe('block');

    // Steer text hint should be hidden on phone to avoid cluttering arena
    const steerHint = hud.element.querySelector('.hud-steer-hint') as HTMLElement;
    const controlsHint = hud.element.querySelector('.hud-controls-hint') as HTMLElement;
    expect(controlsHint.style.display).toBe('none');
  });

  it('RED 4: Desktop tier hides touch gamepad controls completely', () => {
    const root = UiRoot.init(container as any, engine);
    const hud = root.hudView;

    const desktopMetrics = ResponsiveLayout.instance.computeMetrics(1920, 1080);
    root.applyMetrics(desktopMetrics);

    const touchLayer = hud.element.querySelector('.touch-controls-layer') as HTMLElement;
    expect(touchLayer.style.display).toBe('none');

    const controlsHint = hud.element.querySelector('.hud-controls-hint') as HTMLElement;
    expect(controlsHint.style.display).toBe('block');
  });
});
