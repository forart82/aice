import { describe, it, expect, beforeEach } from 'vitest';
import { InputManager } from '../input/InputManager.js';
import { VirtualStick } from '../input/VirtualStick.js';
import { TouchControls } from '../input/TouchControls.js';

describe('InputManager Multi-Platform Controller', () => {
  let input: InputManager;

  beforeEach(() => {
    input = new InputManager();
    input.reset();
  });

  it('normalizes manual steering direction vectors accurately', () => {
    input.setDirection(1, 0); // East
    expect(input.hasDirection).toBe(true);
    expect(input.dirX).toBeCloseTo(1.0, 5);
    expect(input.dirY).toBeCloseTo(0.0, 5);
    expect(input.magnitude).toBeCloseTo(1.0, 5);

    input.setDirection(1, 1); // South-East Diagonal
    expect(input.hasDirection).toBe(true);
    expect(input.dirX).toBeCloseTo(Math.SQRT1_2, 4);
    expect(input.dirY).toBeCloseTo(Math.SQRT1_2, 4);
    expect(input.magnitude).toBeCloseTo(1.0, 4);

    input.setDirection(0, 0); // Release
    expect(input.hasDirection).toBe(false);
    expect(input.dirX).toBe(0);
    expect(input.dirY).toBe(0);
  });

  it('handles keyboard events and produces steering and action triggers', () => {
    // Press D
    input.handleKeyDown({ code: 'KeyD' } as KeyboardEvent);
    expect(input.hasDirection).toBe(true);
    expect(input.dirX).toBe(1);
    expect(input.dirY).toBe(0);

    // Press S (diagonal Down-Right)
    input.handleKeyDown({ code: 'KeyS' } as KeyboardEvent);
    expect(input.dirX).toBeCloseTo(Math.SQRT1_2, 4);
    expect(input.dirY).toBeCloseTo(Math.SQRT1_2, 4);

    // Press Space (Dash)
    input.handleKeyDown({ code: 'Space' } as KeyboardEvent);
    expect(input.dashHeld).toBe(true);
    expect(input.consumeDash()).toBe(true);
    expect(input.consumeDash()).toBe(false); // consumed

    // Press E (Skill)
    input.handleKeyDown({ code: 'KeyE' } as KeyboardEvent);
    expect(input.skillHeld).toBe(true);
    expect(input.consumeSkill()).toBe(true);
    expect(input.consumeSkill()).toBe(false);

    // Press P (Pause)
    input.handleKeyDown({ code: 'KeyP' } as KeyboardEvent);
    expect(input.consumePause()).toBe(true);

    // Press L (Lab)
    input.handleKeyDown({ code: 'KeyL' } as KeyboardEvent);
    expect(input.consumeLab()).toBe(true);

    // Release D and S
    input.handleKeyUp({ code: 'KeyD' } as KeyboardEvent);
    input.handleKeyUp({ code: 'KeyS' } as KeyboardEvent);
    expect(input.hasDirection).toBe(false);
  });

  it('arbitrates input sources based on activation timestamp', () => {
    // Keyboard starts
    input.handleKeyDown({ code: 'KeyW' } as KeyboardEvent); // Up (0, -1)
    expect(input.dirY).toBe(-1);

    // Virtual Stick moves Right (1, 0)
    input.onStickUpdate(1, 0, true);
    expect(input.dirX).toBe(1);
    expect(input.dirY).toBe(0);

    // Stick releases -> falls back to active Keyboard (KeyW)
    input.onStickUpdate(0, 0, false);
    expect(input.hasDirection).toBe(true);
    expect(input.dirY).toBe(-1);

    // Release KeyW -> now all released
    input.handleKeyUp({ code: 'KeyW' } as KeyboardEvent);
    expect(input.hasDirection).toBe(false);
  });

  it('processes touch surface gestures and swipe detection', () => {
    input.setTouchScheme('swipe');
    // Start swipe at (100, 100)
    input.onSurfaceTouchStart(1, 100, 100, 0.5, 0.5);

    // Move to (160, 100) -> 60px right -> East heading
    input.onSurfaceTouchMove(1, 160, 100, 0.6, 0.5);
    expect(input.hasDirection).toBe(true);
    expect(input.dirX).toBeCloseTo(1.0, 3);
    expect(input.dirY).toBeCloseTo(0.0, 3);

    input.onSurfaceTouchEnd(1, 160, 100);
  });

  it('persists preferences and triggers haptic feedback', () => {
    input.setTouchScheme('follow');
    expect(input.touchScheme).toBe('follow');

    input.setLefty(true);
    expect(input.isLefty).toBe(true);

    input.setHaptics(false);
    expect(input.hapticsEnabled).toBe(false);

    expect(() => input.vibrate(50)).not.toThrow();
  });
});

describe('VirtualStick Touch Joystick', () => {
  let stick: VirtualStick;
  let input: InputManager;

  beforeEach(() => {
    input = new InputManager();
    stick = new VirtualStick({ radius: 60, knobRadius: 25, deadzoneFrac: 0.2, dynamicOrigin: true });
    stick.bind(input);
  });

  it('spawns dynamic origin on touch start', () => {
    stick.onTouchStart(1, 200, 300);
    expect(stick.active).toBe(true);
    expect(stick.visible).toBe(true);
    expect(stick.baseX).toBe(200);
    expect(stick.baseY).toBe(300);
    expect(stick.knobX).toBe(200);
    expect(stick.knobY).toBe(300);
  });

  it('ignores movements inside deadzone and scales analog magnitude outside', () => {
    stick.onTouchStart(1, 100, 100);

    // Move 5px right (deadzone is 60 * 0.2 = 12px)
    stick.onTouchMove(1, 105, 100);
    expect(stick.magnitude).toBe(0);
    expect(input.hasDirection).toBe(false);

    // Move 36px right (between 12px and 60px)
    stick.onTouchMove(1, 136, 100);
    expect(stick.magnitude).toBeGreaterThan(0.4);
    expect(input.hasDirection).toBe(true);
    expect(input.dirX).toBeCloseTo(stick.magnitude, 2);

    // Move 100px right (exceeds max radius 60px) -> clamped
    stick.onTouchMove(1, 200, 100);
    expect(stick.knobX).toBe(160); // 100 + 60
    expect(stick.magnitude).toBe(1.0);

    stick.onTouchEnd(1);
    expect(stick.active).toBe(false);
  });

  it('isolates multi-touch events to active touchId', () => {
    stick.onTouchStart(10, 150, 150);

    // Extraneous touch ID 11 should be ignored
    stick.onTouchMove(11, 500, 500);
    expect(stick.knobX).toBe(150);

    stick.onTouchEnd(11);
    expect(stick.active).toBe(true);

    stick.onTouchEnd(10);
    expect(stick.active).toBe(false);
  });
});

describe('TouchControls Action Pads', () => {
  let controls: TouchControls;
  let input: InputManager;

  beforeEach(() => {
    input = new InputManager();
    controls = new TouchControls(input);
    controls.updateLayout(1280, 720);
  });

  it('lays out buttons and supports safe area insets', () => {
    expect(controls.dashRect.x).toBeGreaterThan(controls.skillRect.x);
    expect(controls.skillRect.x).toBeLessThan(300);
    expect(controls.pauseRect.y).toBeLessThan(100);

    // Test Lefty Mode (buttons move to right side)
    controls.isLefty = true;
    controls.updateLayout(1280, 720);
    expect(controls.dashRect.x).toBeGreaterThan(800);
  });

  it('hit tests and triggers Dash and Skill actions', () => {
    const dashCx = controls.dashRect.x + controls.dashRect.width / 2;
    const dashCy = controls.dashRect.y + controls.dashRect.height / 2;

    const handled = controls.onTouchStart(1, dashCx, dashCy);
    expect(handled).toBe(true);
    expect(controls.dashActive).toBe(true);
    expect(input.dashHeld).toBe(true);
    expect(input.consumeDash()).toBe(true);

    controls.onTouchEnd(1);
    expect(controls.dashActive).toBe(false);
    expect(input.dashHeld).toBe(false);
  });
});
