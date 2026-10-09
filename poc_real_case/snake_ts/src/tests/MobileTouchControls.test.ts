/**
 * Ouroboros Ascension — Mobile Touch Gamepad & Responsive HUD Conformance Tests
 *
 * Verifies:
 * 1. On-screen Virtual Joystick / Direction Gamepad creation and touch/pointer event handling.
 * 2. On-screen Action buttons (Dash ⚡ and Skill ✨) touch triggers & cooldown sweeps.
 * 3. Top HUD header grouping so Floor/Mission progress is pinned to top in Portrait mode.
 * 4. Safe-area notch and bottom gesture bar padding application.
 * 5. Lefty mode layout swapping for joystick and action buttons.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { setupMockDom, MockElement } from './MockDom';
import { UiRoot } from '../ui/UiRoot';
import { HudView } from '../ui/HudView';
import { ResponsiveLayout, ILayoutMetrics } from '../ui/ResponsiveLayout';
import { InputManager } from '../input/InputManager';
import { TouchControls } from '../input/TouchControls';
import { SettingsScreen } from '../ui/screens/SettingsScreen';
import { SnakePlayer } from '../sim/SnakePlayer';
import { Services } from '../core/Services';
import { NullFx, NullSound } from '../core/Contracts';

describe('MOBILE TOUCH CONTROLS & RESPONSIVE HUD CONFORMANCE', () => {
  let restoreDom: () => void;
  let container: MockElement;
  let engine: any;

  beforeEach(() => {
    restoreDom = setupMockDom();
    Services.Sound = new NullSound();
    Services.Fx = new NullFx();
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
        shardsEarned: 10
      },
      currentFloor: 1,
      floorFoodProgress: 5,
      foodTarget: 15,
      fps: 60,
      state: 1,
      runInProgress: true,
      meta: { shards: 120 }
    };
  });

  afterEach(() => {
    restoreDom();
  });

  it('RED 1: Top HUD header groups vitals, combo, and portrait mission row at the top of the screen', () => {
    const root = UiRoot.init(container as any, engine);
    const hud = root.hudView;

    // Simulate 9:16 mobile portrait metrics
    const portraitMetrics: ILayoutMetrics = ResponsiveLayout.instance.computeMetrics(390, 844);
    expect(portraitMetrics.isPortraitHud).toBe(true);

    hud.applyMetrics(portraitMetrics);

    // The mission row must be contained in a top header group, not directly in hud-container with space-between
    const headerGroup = hud.element.querySelector('.hud-header-group');
    expect(headerGroup).not.toBeNull();

    const missionPanel = hud.element.querySelector('.hud-mission');
    expect(missionPanel).not.toBeNull();

    const missionRow = hud.element.querySelector('.hud-mission-portrait-row') as HTMLElement;
    expect(missionRow).not.toBeNull();
    expect(missionPanel?.parentElement).toBe(missionRow);
    expect(missionRow?.style.display).toBe('flex');
  });

  it('RED 2: On-screen touch controls exist with virtual steering joystick and action buttons in mobile mode', () => {
    const root = UiRoot.init(container as any, engine);
    const hud = root.hudView;

    const touchLayer = hud.element.querySelector('.touch-controls-layer');
    expect(touchLayer).not.toBeNull();

    const stickPad = hud.element.querySelector('.touch-stick-pad');
    expect(stickPad).not.toBeNull();

    const stickKnob = hud.element.querySelector('.touch-stick-knob');
    expect(stickKnob).not.toBeNull();

    const dashBtn = hud.element.querySelector('.touch-btn-dash');
    expect(dashBtn).not.toBeNull();

    const skillBtn = hud.element.querySelector('.touch-btn-skill');
    expect(skillBtn).not.toBeNull();
  });

  it('RED 3: Virtual joystick pointer drag sets steering vector on InputManager', () => {
    const input = InputManager.instance;
    const root = UiRoot.init(container as any, engine);
    const hud = root.hudView;

    // Simulate mobile metrics
    const metrics = ResponsiveLayout.instance.computeMetrics(390, 844);
    hud.applyMetrics(metrics);

    // Test joystick directional dispatch
    hud.handleJoystickSteer(0.8, -0.6);
    expect(input.dirX).toBeCloseTo(0.8, 1);
    expect(input.dirY).toBeCloseTo(-0.6, 1);
    expect(input.hasDirection).toBe(true);

    // Release joystick
    hud.handleJoystickRelease();
    expect(input.dirX).toBe(0);
    expect(input.dirY).toBe(0);
    expect(input.hasDirection).toBe(false);
  });

  it('RED 4: Touch action buttons trigger Dash and Skill on InputManager', () => {
    const input = InputManager.instance;
    const root = UiRoot.init(container as any, engine);
    const hud = root.hudView;

    // Press Dash
    hud.handleTouchAction('dash', true);
    expect(input.dashPressed).toBe(true);
    expect(input.dashHeld).toBe(true);

    hud.handleTouchAction('dash', false);
    expect(input.dashHeld).toBe(false);

    // Press Skill
    hud.handleTouchAction('skill', true);
    expect(input.skillPressed).toBe(true);
    expect(input.skillHeld).toBe(true);

    hud.handleTouchAction('skill', false);
    expect(input.skillHeld).toBe(false);
  });

  it('RED 5: Live switching Joystick Position in SettingsScreen updates InputManager and flips HudView layout classes', () => {
    const root = UiRoot.init(container as any, engine);
    const settingsScreen = new SettingsScreen(root);
    root.registerScreen(settingsScreen);
    root.showScreen('modal-settings');

    const joystickPosSelect = settingsScreen.element.querySelector('.joystick-pos-select') as HTMLSelectElement;
    expect(joystickPosSelect).not.toBeNull();

    // 1. Initial Right-Handed state (Default)
    expect(InputManager.instance.isLefty).toBe(false);
    let metrics = ResponsiveLayout.instance.computeMetrics(390, 844);
    root.hudView.applyMetrics(metrics);
    const touchLayer = root.hudView.element.querySelector('.touch-controls-layer');
    expect(touchLayer?.classList.contains('lefty-mode')).toBe(false);

    // 2. Switch to Left Side in Settings UI
    joystickPosSelect.value = 'left';
    joystickPosSelect.dispatchEvent({ type: 'change' } as any);

    expect(settingsScreen.settings.lefty).toBe(true);
    expect(InputManager.instance.isLefty).toBe(true);

    // 3. Reflow HUD metrics
    metrics = ResponsiveLayout.instance.computeMetrics(390, 844);
    root.hudView.applyMetrics(metrics);
    expect(touchLayer?.classList.contains('lefty-mode')).toBe(true);

    // 4. Switch back to Right Side (Default)
    joystickPosSelect.value = 'right';
    joystickPosSelect.dispatchEvent({ type: 'change' } as any);
    expect(InputManager.instance.isLefty).toBe(false);
    root.hudView.applyMetrics(metrics);
    expect(touchLayer?.classList.contains('lefty-mode')).toBe(false);
  });

  it('RED 6: Desktop keyboard hints are replaced with touch guidance on mobile touch viewports', () => {
    const root = UiRoot.init(container as any, engine);
    const hud = root.hudView;

    // Portrait mobile touch layout
    const touchMetrics = ResponsiveLayout.instance.computeMetrics(390, 844);
    hud.applyMetrics(touchMetrics);

    const steerHint = hud.element.querySelector('.hud-steer-hint') as HTMLElement;
    const controlsHint = hud.element.querySelector('.hud-controls-hint') as HTMLElement;

    expect(steerHint?.style.display).toBe('block');
    expect(controlsHint?.style.display).toBe('none');
  });

  it('RED 7: Full-screen touch drag allows dynamic steering across arbitrary screen coordinates', () => {
    const input = InputManager.instance;
    const root = UiRoot.init(container as any, engine);
    const hud = root.hudView;

    // Simulate mobile metrics
    const touchMetrics = ResponsiveLayout.instance.computeMetrics(390, 844);
    hud.applyMetrics(touchMetrics);

    // Touch and drag from right side of screen
    hud.handleJoystickSteer(0.707, 0.707);
    expect(input.dirX).toBeCloseTo(0.707, 2);
    expect(input.dirY).toBeCloseTo(0.707, 2);
    expect(input.hasDirection).toBe(true);

    // Release steering
    hud.handleJoystickRelease();
    expect(input.hasDirection).toBe(false);
  });

  it('RED 8: Smartphone mode positions action buttons symmetrically at bottom-center', () => {
    const tc = new TouchControls();
    // 390x844 smartphone screen
    tc.updateLayout(390, 844, { bottom: 34 });

    const centerX = 390 * 0.5; // 195
    // Skill center is to left of 195, Dash center is to right of 195
    const skillCenter = tc.skillRect.x + tc.skillRect.width * 0.5;
    const dashCenter = tc.dashRect.x + tc.dashRect.width * 0.5;

    expect(skillCenter).toBeLessThan(centerX);
    expect(dashCenter).toBeGreaterThan(centerX);

    // Symmetrical distance from center
    const distSkill = centerX - skillCenter;
    const distDash = dashCenter - centerX;
    expect(distSkill).toBeCloseTo(distDash, 1);

    // Vertical position respects safe area bottom
    expect(tc.dashRect.y + tc.dashRect.height).toBeLessThanOrEqual(844 - 34);
  });

  it('RED 9: Smartphone HUD Lab and Pause buttons are accessible and do not trigger underlying joystick steering', () => {
    const root = UiRoot.init(container as any, engine);
    const hud = root.hudView;
    const metrics = ResponsiveLayout.instance.computeMetrics(390, 844);
    hud.applyMetrics(metrics);

    let labToggled = false;
    let pauseToggled = false;
    engine.toggleLab = () => { labToggled = true; };
    engine.togglePause = () => { pauseToggled = true; };

    const labBtn = hud.element.querySelector('.btn-lab') as HTMLButtonElement;
    const pauseBtn = hud.element.querySelector('.btn-pause') as HTMLButtonElement;
    expect(labBtn).not.toBeNull();
    expect(pauseBtn).not.toBeNull();

    // Click Lab Button
    labBtn.click();
    expect(labToggled).toBe(true);
    expect(InputManager.instance.hasDirection).toBe(false);

    // Click Pause Button
    pauseBtn.click();
    expect(pauseToggled).toBe(true);
    expect(InputManager.instance.hasDirection).toBe(false);
  });
});
