import { describe, it, expect, beforeEach } from 'vitest';
import { InputManager } from '../input/InputManager';
import { VirtualStick } from '../input/VirtualStick';
import { TouchControls } from '../input/TouchControls';

describe('Touch Cancel & Multi-Touch Release Event Hardening Suite', () => {
  let input: InputManager;
  let stick: VirtualStick;
  let controls: TouchControls;

  beforeEach(() => {
    input = new InputManager();
    input.reset();
    stick = new VirtualStick({ radius: 60, knobRadius: 26, dynamicOrigin: true });
    stick.bind(input);
    controls = new TouchControls(input);
    controls.updateLayout(1280, 720);
  });

  it('1. verifies VirtualStick.onTouchCancel cleanly releases steering without residual vector', () => {
    stick.onTouchStart(1, 200, 200);
    stick.onTouchMove(1, 250, 200); // 50px right deflection
    expect(stick.active).toBe(true);
    expect(input.hasDirection).toBe(true);
    expect(input.dirX).toBeGreaterThan(0.7);

    // OS Gesture or Phone Call Interrupts Touch
    stick.onTouchCancel(1);

    expect(stick.active).toBe(false);
    expect(stick.touchId).toBeNull();
    expect(stick.magnitude).toBe(0);
    expect(input.hasDirection).toBe(false);
    expect(input.dirX).toBe(0);
  });

  it('2. verifies TouchControls.onTouchCancel releases specific button without affecting other active buttons', () => {
    const dashCx = controls.dashRect.x + controls.dashRect.width / 2;
    const dashCy = controls.dashRect.y + controls.dashRect.height / 2;
    const skillCx = controls.skillRect.x + controls.skillRect.width / 2;
    const skillCy = controls.skillRect.y + controls.skillRect.height / 2;

    // Multi-touch: Thumb 1 on Dash (ID 2), Thumb 2 on Skill (ID 3)
    controls.onTouchStart(2, dashCx, dashCy);
    controls.onTouchStart(3, skillCx, skillCy);

    expect(controls.dashActive).toBe(true);
    expect(controls.skillActive).toBe(true);
    expect(input.dashHeld).toBe(true);
    expect(input.skillHeld).toBe(true);

    // TouchCancel on Dash (ID 2)
    controls.onTouchCancel(2);

    expect(controls.dashActive).toBe(false);
    expect(controls.dashTouchId).toBeNull();
    expect(input.dashHeld).toBe(false);

    // Skill must remain active!
    expect(controls.skillActive).toBe(true);
    expect(controls.skillTouchId).toBe(3);
    expect(input.skillHeld).toBe(true);

    // TouchCancel on Skill (ID 3)
    controls.onTouchCancel(3);
    expect(controls.skillActive).toBe(false);
    expect(input.skillHeld).toBe(false);
  });

  it('3. verifies InputManager.onSurfaceTouchCancel resets surface follow/swipe tracking', () => {
    input.setTouchScheme('follow');
    input.onSurfaceTouchStart(5, 400, 300, 0.4, 0.3);
    expect(input.pointerActive).toBe(true);

    input.onSurfaceTouchCancel(5);
    expect(input.pointerActive).toBe(false);
  });

  it('4. handles simultaneous 3-finger touch churn with mixed release and cancel', () => {
    // Finger 1 (ID 10): Stick
    stick.onTouchStart(10, 100, 100);
    stick.onTouchMove(10, 150, 100);

    // Finger 2 (ID 20): Dash
    const dashCx = controls.dashRect.x + controls.dashRect.width / 2;
    const dashCy = controls.dashRect.y + controls.dashRect.height / 2;
    controls.onTouchStart(20, dashCx, dashCy);

    // Finger 3 (ID 30): Skill
    const skillCx = controls.skillRect.x + controls.skillRect.width / 2;
    const skillCy = controls.skillRect.y + controls.skillRect.height / 2;
    controls.onTouchStart(30, skillCx, skillCy);

    expect(input.hasDirection).toBe(true);
    expect(input.dashHeld).toBe(true);
    expect(input.skillHeld).toBe(true);

    // Cancel stick (10), End dash (20), Cancel skill (30)
    stick.onTouchCancel(10);
    controls.onTouchEnd(20);
    controls.onTouchCancel(30);

    expect(input.hasDirection).toBe(false);
    expect(input.dashHeld).toBe(false);
    expect(input.skillHeld).toBe(false);
    expect(stick.active).toBe(false);
    expect(controls.dashActive).toBe(false);
    expect(controls.skillActive).toBe(false);
  });
});
