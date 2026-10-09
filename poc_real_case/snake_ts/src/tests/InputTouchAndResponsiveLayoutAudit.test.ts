/**
 * Ouroboros Ascension — Input, Touch, Responsive Layout & Virtual Stick Audit Suite
 * (InputTouchAndResponsiveLayoutAudit.test.ts)
 *
 * Strict TDD test suite validating resolution of all deep defects:
 * 1. Window blur and document visibility state synchronization (clearing all input sources & buttons).
 * 2. Multi-touch race conditions, collision disambiguation, and touchId lock prevention.
 * 3. Safe-area insets, NaN protection, zero-dimension fallbacks, and orientation reflow stability.
 * 4. Pointer capture leaks, lostpointercapture handling, and dual pointerdown/touchstart deduplication.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupMockDom, MockElement } from './MockDom.js';
import { InputManager } from '../input/InputManager.js';
import { VirtualStick } from '../input/VirtualStick.js';
import { TouchControls } from '../input/TouchControls.js';
import { ResponsiveLayout } from '../ui/ResponsiveLayout.js';
import { UiRoot } from '../ui/UiRoot.js';
import { Services } from '../core/Services.js';
import { NullSound, NullFx } from '../core/Contracts.js';
import { SnakePlayer } from '../sim/SnakePlayer.js';

describe('Input, Touch, Responsive Layout & Virtual Stick Deep Audit', () => {
  let restoreDom: () => void;
  let input: InputManager;

  beforeEach(() => {
    restoreDom = setupMockDom();
    input = new InputManager();
    input.reset();
  });

  afterEach(() => {
    input.destroy();
    restoreDom();
  });

  // ==========================================================================
  // 1. Window Blur & Document Visibility State Synchronization
  // ==========================================================================
  describe('1. Window Blur & Tab Visibility State Synchronization', () => {
    it('1.1 InputManager clears all input sources (keys, touch, gamepad) and held actions on window blur', () => {
      // 1. Activate keyboard
      input.handleKeyDown({ code: 'KeyW' } as KeyboardEvent);
      // 2. Activate touch steering
      input.setSource(1, 0.8, -0.6, true);
      // 3. Activate touch actions
      input.onPadTouchAction('dash', true);
      input.onPadTouchAction('skill', true);
      // 4. Activate surface follow pointer
      input.setTouchScheme('follow');
      input.onSurfaceTouchStart(1, 400, 300, 0.4, 0.3);

      expect(input.hasDirection).toBe(true);
      expect(input.dashHeld).toBe(true);
      expect(input.skillHeld).toBe(true);
      expect(input.pointerActive).toBe(true);

      // Trigger window blur event
      window.dispatchEvent(new Event('blur'));

      // ALL inputs across all sources must be cleanly released!
      expect(input.hasDirection).toBe(false);
      expect(input.dirX).toBe(0);
      expect(input.dirY).toBe(0);
      expect(input.dashHeld).toBe(false);
      expect(input.skillHeld).toBe(false);
      expect(input.pointerActive).toBe(false);
    });

    it('1.2 InputManager clears all input sources when document visibility changes to hidden', () => {
      input.handleKeyDown({ code: 'KeyD' } as KeyboardEvent);
      input.setSource(1, 1.0, 0.0, true);
      input.onPadTouchAction('dash', true);

      expect(input.hasDirection).toBe(true);
      expect(input.dashHeld).toBe(true);

      // Simulate tab switch: document.visibilityState = 'hidden'
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));

      expect(input.hasDirection).toBe(false);
      expect(input.dirX).toBe(0);
      expect(input.dirY).toBe(0);
      expect(input.dashHeld).toBe(false);
    });

    it('1.3 VirtualStick auto-releases on window blur and visibilitychange without stuck vector', () => {
      const stick = new VirtualStick({ radius: 60, dynamicOrigin: true });
      stick.bind(input);

      stick.onTouchStart(5, 200, 200);
      stick.onTouchMove(5, 260, 200); // 60px right deflection

      expect(stick.active).toBe(true);
      expect(stick.touchId).toBe(5);
      expect(stick.magnitude).toBeGreaterThan(0.9);
      expect(input.hasDirection).toBe(true);

      // Window blurs
      window.dispatchEvent(new Event('blur'));

      expect(stick.active).toBe(false);
      expect(stick.touchId).toBeNull();
      expect(stick.magnitude).toBe(0);
      expect(stick.vectorX).toBe(0);
      expect(stick.vectorY).toBe(0);
      expect(input.hasDirection).toBe(false);

      stick.destroy();
    });

    it('1.4 VirtualStick accepts new touch immediately after window blur without touchId lock', () => {
      const stick = new VirtualStick({ radius: 60, dynamicOrigin: true });
      stick.bind(input);

      stick.onTouchStart(1, 150, 150);
      stick.onTouchMove(1, 180, 150);
      expect(stick.active).toBe(true);

      // Window blurs
      window.dispatchEvent(new Event('blur'));
      expect(stick.active).toBe(false);

      // Fresh touch with NEW touchId (e.g. 2) must be accepted!
      stick.onTouchStart(2, 300, 300);
      expect(stick.active).toBe(true);
      expect(stick.touchId).toBe(2);
      expect(stick.baseX).toBe(300);
      expect(stick.baseY).toBe(300);

      stick.destroy();
    });

    it('1.5 TouchControls auto-resets buttons on window blur and visibilitychange', () => {
      const controls = new TouchControls(input);
      controls.updateLayout(1280, 720);

      const dashCx = controls.dashRect.x + controls.dashRect.width / 2;
      const dashCy = controls.dashRect.y + controls.dashRect.height / 2;
      controls.onTouchStart(1, dashCx, dashCy);

      expect(controls.dashActive).toBe(true);
      expect(controls.dashTouchId).toBe(1);
      expect(input.dashHeld).toBe(true);

      // Window blurs
      window.dispatchEvent(new Event('blur'));

      expect(controls.dashActive).toBe(false);
      expect(controls.dashTouchId).toBeNull();
      expect(input.dashHeld).toBe(false);

      controls.destroy();
    });

    it('1.6 TouchControls immediately accepts fresh touch after blur without button lock', () => {
      const controls = new TouchControls(input);
      controls.updateLayout(1280, 720);

      const skillCx = controls.skillRect.x + controls.skillRect.width / 2;
      const skillCy = controls.skillRect.y + controls.skillRect.height / 2;
      controls.onTouchStart(10, skillCx, skillCy);
      expect(controls.skillActive).toBe(true);

      // Visibilitychange: hidden
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));

      expect(controls.skillActive).toBe(false);
      expect(controls.skillTouchId).toBeNull();

      // Return to tab: document.visibilityState = 'visible'
      Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });

      // Fresh touch with NEW touchId (11) must be accepted
      const reHandled = controls.onTouchStart(11, skillCx, skillCy);
      expect(reHandled).toBe(true);
      expect(controls.skillActive).toBe(true);
      expect(controls.skillTouchId).toBe(11);

      controls.destroy();
    });
  });

  // ==========================================================================
  // 2. Multi-Touch Race Conditions & Collision Hardening
  // ==========================================================================
  describe('2. Multi-Touch Race Conditions & Collision Hardening', () => {
    it('2.1 single touch point cannot claim multiple buttons even in overlapping hit regions', () => {
      const controls = new TouchControls(input);
      controls.updateLayout(1280, 720);

      // Position touch between Dash and Skill buttons
      const dashCx = controls.dashRect.x + controls.dashRect.width / 2;
      const dashCy = controls.dashRect.y + controls.dashRect.height / 2;
      const skillCx = controls.skillRect.x + controls.skillRect.width / 2;
      const skillCy = controls.skillRect.y + controls.skillRect.height / 2;
      const midX = (dashCx + skillCx) / 2;
      const midY = (dashCy + skillCy) / 2;

      // Touch with ID 1
      const handled = controls.onTouchStart(1, midX, midY);
      expect(handled).toBe(true);

      // Exactly ONE button must be active, not both!
      const dashOn = controls.dashActive;
      const skillOn = controls.skillActive;
      expect(Number(dashOn) + Number(skillOn)).toBe(1);

      // Attempting to call onTouchStart with the SAME touchId (1) must be rejected
      const secondHandled = controls.onTouchStart(1, skillCx, skillCy);
      expect(secondHandled).toBe(false);

      controls.destroy();
    });

    it('2.2 rejects same touchId claiming a second button while already holding one', () => {
      const controls = new TouchControls(input);
      controls.updateLayout(1280, 720);

      const dashCx = controls.dashRect.x + controls.dashRect.width / 2;
      const dashCy = controls.dashRect.y + controls.dashRect.height / 2;
      const skillCx = controls.skillRect.x + controls.skillRect.width / 2;
      const skillCy = controls.skillRect.y + controls.skillRect.height / 2;

      // Touch ID 7 claims Dash
      expect(controls.onTouchStart(7, dashCx, dashCy)).toBe(true);
      expect(controls.dashActive).toBe(true);
      expect(controls.dashTouchId).toBe(7);

      // Touch ID 7 tries to also claim Skill
      expect(controls.onTouchStart(7, skillCx, skillCy)).toBe(false);
      expect(controls.skillActive).toBe(false);
      expect(controls.skillTouchId).toBeNull();

      controls.destroy();
    });

    it('2.3 VirtualStick ignores secondary touches while primary touch is active', () => {
      const stick = new VirtualStick({ radius: 60, dynamicOrigin: true });
      stick.bind(input);

      stick.onTouchStart(1, 100, 100);
      expect(stick.active).toBe(true);
      expect(stick.touchId).toBe(1);

      // Finger 2 touches virtual stick area
      stick.onTouchStart(2, 200, 200);
      expect(stick.touchId).toBe(1); // Still finger 1!
      expect(stick.baseX).toBe(100);  // Unchanged origin!

      // Finger 2 moves
      stick.onTouchMove(2, 300, 300);
      expect(stick.knobX).toBe(100);  // Unchanged knob!

      // Finger 2 releases -> must NOT cancel Finger 1!
      stick.onTouchEnd(2);
      expect(stick.active).toBe(true);
      expect(stick.touchId).toBe(1);

      // Finger 1 releases -> now cleanly releases
      stick.onTouchEnd(1);
      expect(stick.active).toBe(false);
      expect(stick.touchId).toBeNull();

      stick.destroy();
    });

    it('2.4 TouchControls onTouchMove releases button when finger slides out of button area', () => {
      const controls = new TouchControls(input);
      controls.updateLayout(1280, 720);

      const dashCx = controls.dashRect.x + controls.dashRect.width / 2;
      const dashCy = controls.dashRect.y + controls.dashRect.height / 2;

      controls.onTouchStart(1, dashCx, dashCy);
      expect(controls.dashActive).toBe(true);

      // Finger slides 200px away from Dash
      controls.onTouchMove(1, dashCx + 200, dashCy);
      expect(controls.dashActive).toBe(false);
      expect(controls.dashTouchId).toBeNull();
      expect(input.dashHeld).toBe(false);

      controls.destroy();
    });
  });

  // ==========================================================================
  // 3. Safe-Area Inset, NaN & Zero Viewport Resilience
  // ==========================================================================
  describe('3. Safe-Area Inset, NaN & Zero Viewport Resilience', () => {
    it('3.1 TouchControls.updateLayout with NaN or 0 dimensions preserves valid layout rects', () => {
      const controls = new TouchControls(input);
      controls.updateLayout(1280, 720);

      const prevDash = { ...controls.dashRect };
      expect(prevDash.width).toBeGreaterThan(0);

      // Call with NaN
      controls.updateLayout(NaN, NaN);
      expect(Number.isFinite(controls.dashRect.x)).toBe(true);
      expect(Number.isFinite(controls.dashRect.y)).toBe(true);
      expect(Number.isFinite(controls.dashRect.width)).toBe(true);

      // Call with 0
      controls.updateLayout(0, 0);
      expect(Number.isFinite(controls.dashRect.x)).toBe(true);
      expect(Number.isFinite(controls.dashRect.width)).toBe(true);

      // Call with negative
      controls.updateLayout(-100, -100);
      expect(Number.isFinite(controls.dashRect.x)).toBe(true);

      controls.destroy();
    });

    it('3.2 TouchControls.updateLayout rejects NaN and negative insets', () => {
      const controls = new TouchControls(input);
      controls.updateLayout(1280, 720, { left: NaN, right: -20, top: NaN, bottom: 25 });

      expect(Number.isFinite(controls.safeArea.left)).toBe(true);
      expect(controls.safeArea.left).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(controls.safeArea.top)).toBe(true);
      expect(controls.safeArea.top).toBeGreaterThanOrEqual(0);
      expect(controls.safeArea.bottom).toBe(25);

      controls.destroy();
    });

    it('3.3 ResponsiveLayout.computeMetrics with NaN, 0, or negative dimensions returns finite metrics', () => {
      const layout = ResponsiveLayout.instance;

      const mNaN = layout.computeMetrics(NaN, NaN);
      expect(Number.isFinite(mNaN.windowWidth)).toBe(true);
      expect(Number.isFinite(mNaN.windowHeight)).toBe(true);
      expect(Number.isFinite(mNaN.logicalWidth)).toBe(true);
      expect(Number.isFinite(mNaN.logicalHeight)).toBe(true);
      expect(Number.isFinite(mNaN.uiScale)).toBe(true);
      expect(mNaN.logicalWidth).toBeGreaterThan(0);
      expect(mNaN.logicalHeight).toBeGreaterThan(0);

      const mZero = layout.computeMetrics(0, 0);
      expect(Number.isFinite(mZero.logicalWidth)).toBe(true);
      expect(mZero.logicalWidth).toBeGreaterThan(0);
    });

    it('3.4 ResponsiveLayout.layoutTouchControls with non-finite space produces finite layout', () => {
      const badSpace = { width: NaN, height: NaN };
      const badInsets = { left: NaN, top: NaN, right: NaN, bottom: NaN };

      const layout = ResponsiveLayout.layoutTouchControls(badSpace as any, badInsets as any);
      expect(Number.isFinite(layout.area.width)).toBe(true);
      expect(Number.isFinite(layout.area.height)).toBe(true);
      expect(Number.isFinite(layout.dashPadX)).toBe(true);
      expect(Number.isFinite(layout.dashPadY)).toBe(true);
      expect(Number.isFinite(layout.skillPadX)).toBe(true);
      expect(Number.isFinite(layout.skillPadY)).toBe(true);
      expect(Number.isFinite(layout.pausePadX)).toBe(true);
      expect(Number.isFinite(layout.pausePadY)).toBe(true);
      expect(Number.isFinite(layout.btnSize)).toBe(true);
      expect(layout.btnSize).toBeGreaterThan(0);
    });

    it('3.5 VirtualStick sanitizes NaN touch coordinates without numerical contamination', () => {
      const stick = new VirtualStick({ radius: 60, dynamicOrigin: true });
      stick.bind(input);

      stick.onTouchStart(1, NaN, NaN);
      expect(Number.isFinite(stick.baseX)).toBe(true);
      expect(Number.isFinite(stick.baseY)).toBe(true);
      expect(Number.isFinite(stick.knobX)).toBe(true);
      expect(Number.isFinite(stick.knobY)).toBe(true);

      stick.onTouchMove(1, NaN, NaN);
      expect(Number.isFinite(stick.vectorX)).toBe(true);
      expect(Number.isFinite(stick.vectorY)).toBe(true);
      expect(Number.isFinite(stick.magnitude)).toBe(true);
      expect(Number.isFinite(input.dirX)).toBe(true);
      expect(Number.isFinite(input.dirY)).toBe(true);

      stick.destroy();
    });

    it('3.6 VirtualStick.update(NaN) does not corrupt knob position', () => {
      const stick = new VirtualStick({ radius: 60, dynamicOrigin: false });
      stick.baseX = 100;
      stick.baseY = 100;
      stick.knobX = 150;
      stick.knobY = 100;

      stick.update(NaN);
      expect(Number.isFinite(stick.knobX)).toBe(true);
      expect(Number.isFinite(stick.knobY)).toBe(true);

      stick.destroy();
    });

    it('3.7 InputManager.setSource and onStickUpdate sanitize NaN and Infinity', () => {
      input.setSource(1, NaN, Infinity, true);
      expect(Number.isFinite(input.dirX)).toBe(true);
      expect(Number.isFinite(input.dirY)).toBe(true);
      expect(Number.isFinite(input.magnitude)).toBe(true);

      input.onStickUpdate(NaN, -Infinity, true);
      expect(Number.isFinite(input.dirX)).toBe(true);
      expect(Number.isFinite(input.dirY)).toBe(true);
      expect(Number.isFinite(input.magnitude)).toBe(true);
    });
  });

  // ==========================================================================
  // 4. Pointer Event Hardening & HUD Integration
  // ==========================================================================
  describe('4. Pointer Event Hardening & HUD Integration', () => {
    let container: MockElement;
    let engine: any;

    beforeEach(() => {
      Services.Sound = new NullSound();
      Services.Fx = new NullFx();
      Services.Input = input;

      container = document.createElement('div') as any;
      container.id = 'ui-root';
      document.body.appendChild(container as any);

      const player = new SnakePlayer('emerald', 800, 600, 4);
      engine = {
        player,
        combat: { score: 100, comboCount: 1, comboMultiplier: 1, frenzyActive: false },
        currentFloor: 1,
        floorFoodProgress: 0,
        foodTarget: 10,
        fps: 60,
        state: 1,
        runInProgress: true,
        meta: { shards: 50 },
      };
    });

    it('4.1 HudView releases virtual stick on lostpointercapture without stuck dragging state', () => {
      const root = UiRoot.init(container as any, engine);
      const hud = root.hudView;
      root.applyMetrics(ResponsiveLayout.instance.computeMetrics(390, 844));

      const touchLayer = (hud as any)._touchLayer as HTMLElement;
      expect(touchLayer).toBeDefined();

      // Initiate drag via pointerdown
      const downEvent = new Event('pointerdown') as any;
      downEvent.pointerId = 42;
      downEvent.clientX = 150;
      downEvent.clientY = 500;
      touchLayer.dispatchEvent(downEvent);

      expect(input.hasDirection).toBe(false); // inside deadzone on start

      // Move outside deadzone
      const moveEvent = new Event('pointermove') as any;
      moveEvent.pointerId = 42;
      moveEvent.clientX = 220; // 70px right
      moveEvent.clientY = 500;
      window.dispatchEvent(moveEvent);

      expect(input.hasDirection).toBe(true);
      expect(input.dirX).toBeGreaterThan(0.5);

      // Lost pointer capture event occurs (e.g. system notification or popup)
      const lostEvent = new Event('lostpointercapture') as any;
      lostEvent.pointerId = 42;
      touchLayer.dispatchEvent(lostEvent);

      // Joystick must release cleanly!
      expect(input.hasDirection).toBe(false);
      expect(input.dirX).toBe(0);
    });

    it('4.2 HudView deduplicates pointerdown followed immediately by touchstart', () => {
      const root = UiRoot.init(container as any, engine);
      const hud = root.hudView;
      root.applyMetrics(ResponsiveLayout.instance.computeMetrics(390, 844));

      const touchLayer = (hud as any)._touchLayer as HTMLElement;

      // First: pointerdown
      const pDown = new Event('pointerdown') as any;
      pDown.pointerId = 100;
      pDown.clientX = 200;
      pDown.clientY = 400;
      touchLayer.dispatchEvent(pDown);

      // Move 50px right
      const pMove = new Event('pointermove') as any;
      pMove.pointerId = 100;
      pMove.clientX = 250;
      pMove.clientY = 400;
      window.dispatchEvent(pMove);

      expect(input.hasDirection).toBe(true);
      const dirX1 = input.dirX;
      expect(dirX1).toBeGreaterThan(0.5);

      // TouchEvent fires immediately afterwards for the same touch
      const tStart = new Event('touchstart') as any;
      tStart.touches = [{ identifier: 100, clientX: 200, clientY: 400 }];
      touchLayer.dispatchEvent(tStart);

      // Must not reset or clobber the active dragging state
      expect(input.hasDirection).toBe(true);
      expect(input.dirX).toBeCloseTo(dirX1, 3);
    });

    it('4.3 Secondary pointer touches do not clobber primary joystick drag in HudView', () => {
      const root = UiRoot.init(container as any, engine);
      const hud = root.hudView;
      root.applyMetrics(ResponsiveLayout.instance.computeMetrics(390, 844));

      const touchLayer = (hud as any)._touchLayer as HTMLElement;

      // Pointer 1 starts at (200, 400)
      const p1Down = new Event('pointerdown') as any;
      p1Down.pointerId = 1;
      p1Down.clientX = 200;
      p1Down.clientY = 400;
      touchLayer.dispatchEvent(p1Down);

      // Pointer 1 drags to (260, 400)
      const p1Move = new Event('pointermove') as any;
      p1Move.pointerId = 1;
      p1Move.clientX = 260;
      p1Move.clientY = 400;
      window.dispatchEvent(p1Move);
      expect(input.hasDirection).toBe(true);
      expect(input.dirX).toBeGreaterThan(0.8);

      // Pointer 2 touches screen at (100, 100)
      const p2Down = new Event('pointerdown') as any;
      p2Down.pointerId = 2;
      p2Down.clientX = 100;
      p2Down.clientY = 100;
      touchLayer.dispatchEvent(p2Down);

      // Pointer 2 moves - must NOT affect joystick
      const p2Move = new Event('pointermove') as any;
      p2Move.pointerId = 2;
      p2Move.clientX = 50,
      p2Move.clientY = 50;
      window.dispatchEvent(p2Move);
      expect(input.dirX).toBeGreaterThan(0.8);

      // Pointer 2 releases - must NOT release joystick
      const p2Up = new Event('pointerup') as any;
      p2Up.pointerId = 2;
      window.dispatchEvent(p2Up);
      expect(input.hasDirection).toBe(true);

      // Pointer 1 releases - NOW joystick releases
      const p1Up = new Event('pointerup') as any;
      p1Up.pointerId = 1;
      window.dispatchEvent(p1Up);
      expect(input.hasDirection).toBe(false);
      expect(input.dirX).toBe(0);
    });

    it('4.4 Window blur during active HudView dragging cleanly resets joystick and releases steering', () => {
      const root = UiRoot.init(container as any, engine);
      const hud = root.hudView;
      root.applyMetrics(ResponsiveLayout.instance.computeMetrics(390, 844));

      const touchLayer = (hud as any)._touchLayer as HTMLElement;
      const stickPad = (hud as any)._stickPad as HTMLElement;

      const pDown = new Event('pointerdown') as any;
      pDown.pointerId = 9;
      pDown.clientX = 200;
      pDown.clientY = 400;
      touchLayer.dispatchEvent(pDown);

      const pMove = new Event('pointermove') as any;
      pMove.pointerId = 9;
      pMove.clientX = 260;
      pMove.clientY = 400;
      window.dispatchEvent(pMove);

      expect(input.hasDirection).toBe(true);
      expect(stickPad.classList.contains('stick-active')).toBe(true);

      // Window blurs
      window.dispatchEvent(new Event('blur'));

      expect(input.hasDirection).toBe(false);
      expect(input.dirX).toBe(0);
      expect(stickPad.classList.contains('stick-active')).toBe(false);
    });
  });
});
