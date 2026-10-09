/**
 * Ouroboros Ascension — Unified Multi-Platform Input Manager (InputManager.ts)
 *
 * Consolidates Keyboard, Gamepad API (Standard Mapping), Touch Gestures (Virtual Stick,
 * Follow, Swipe), and Mouse controls into normalized steering vectors and edge-triggered action events.
 *
 * Implements timestamp-based source arbitration (most recently active input wins without fighting),
 * radial gamepad deadzone scaling, dual-motor rumble & mobile haptic feedback, and focus-loss clearing.
 *
 * Completely headless-safe.
 */

import type { IInput } from '../core/Contracts.js';

// ============================================================================
// Types and Interfaces
// ============================================================================

export type TouchScheme = 'stick' | 'follow' | 'swipe';

export interface SteeringVector {
  x: number;
  y: number;
  magnitude: number;
  angle: number;
  hasDirection: boolean;
}

export interface IInputManager extends IInput {
  readonly magnitude: number;
  readonly angle: number;

  touchScheme: TouchScheme;
  isLefty: boolean;
  hapticsEnabled: boolean;

  consumeConfirm(): boolean;
  destroy(): void;
}

export const PAD_DEADZONE_DEFAULT = 0.25;
export const DIR_EPSILON = 0.00001;

// ============================================================================
// Source Tracker
// ============================================================================

interface SteerSource {
  x: number;
  y: number;
  active: boolean;
  stamp: number;
}

export class InputManager implements IInputManager {
  private static _instance: InputManager | null = null;

  public static get instance(): InputManager {
    if (!InputManager._instance) {
      InputManager._instance = new InputManager();
    }
    return InputManager._instance;
  }

  public static resetInstance(): void {
    if (InputManager._instance) {
      InputManager._instance.destroy();
      InputManager._instance = null;
    }
  }

  // Steering outputs
  private _dirX = 0.0;
  private _dirY = 0.0;
  private _magnitude = 0.0;
  private _angle = 0.0;
  private _hasDirection = false;

  public get dirX(): number { return this._dirX; }
  public get dirY(): number { return this._dirY; }
  public get DirX(): number { return this._dirX; }
  public get DirY(): number { return this._dirY; }
  public get magnitude(): number { return this._magnitude; }
  public get angle(): number { return this._angle; }
  public get hasDirection(): boolean { return this._hasDirection; }
  public get HasDirection(): boolean { return this._hasDirection; }

  // Action edge triggers
  public dashPressed = false;
  public skillPressed = false;
  public pausePressed = false;
  public confirmPressed = false;
  public labPressed = false;
  public helpPressed = false;
  public statsPressed = false;
  public botTogglePressed = false;
  public justConnected = false;

  // Held state
  public dashHeld = false;
  public skillHeld = false;

  public get DashHeld(): boolean { return this.dashHeld; }
  public set DashHeld(v: boolean) { this.dashHeld = v; }
  public get SkillHeld(): boolean { return this.skillHeld; }
  public set SkillHeld(v: boolean) { this.skillHeld = v; }

  private dashKey = false;
  private dashTouch = false;
  private dashPad = false;
  private skillKey = false;
  private skillTouch = false;
  private skillPad = false;

  // Pointer & Surface
  public pointerActive = false;
  public pointerNormX = 0.5;
  public pointerNormY = 0.5;
  public pointerScreenX = 0;
  public pointerScreenY = 0;

  public get PointerActive(): boolean { return this.pointerActive; }
  public set PointerActive(v: boolean) { this.pointerActive = v; }
  public get PointerNormX(): number { return this.pointerNormX; }
  public set PointerNormX(v: number) { this.pointerNormX = v; }
  public get PointerNormY(): number { return this.pointerNormY; }
  public set PointerNormY(v: number) { this.pointerNormY = v; }

  // Config
  public touchScheme: TouchScheme = 'stick';
  public isLefty = false;
  public hapticsEnabled = true;
  public isTouchDevice = false;
  public forceTouchUi = false;
  public padDeadzone = PAD_DEADZONE_DEFAULT;

  // Gamepad state
  public gamepadConnected = false;
  public gamepadIndex: number | null = null;
  public get GamepadConnected(): boolean { return this.gamepadConnected; }
  private prevPadButtons: Map<number, boolean[]> = new Map();
  private firstPadSample = true;

  // Steering sources: 0 = Key, 1 = Touch, 2 = Pad
  private sources: SteerSource[] = [
    { x: 0, y: 0, active: false, stamp: 0 },
    { x: 0, y: 0, active: false, stamp: 0 },
    { x: 0, y: 0, active: false, stamp: 0 }
  ];
  private stampCounter = 0;
  private heldKeys = new Set<string>();
  private keyVectorLive = false;

  // Touch/Pointer bookkeeping
  private swipeOriginX = 0;
  private swipeOriginY = 0;
  private activeTouchId: number | null = null;

  // Listeners bound
  private boundKeyDown: ((e: KeyboardEvent) => void) | null = null;
  private boundKeyUp: ((e: KeyboardEvent) => void) | null = null;
  private boundBlur: (() => void) | null = null;
  private boundPageHide: (() => void) | null = null;
  private boundVisibilityChange: (() => void) | null = null;
  private boundPadConnect: ((e: GamepadEvent) => void) | null = null;
  private boundPadDisconnect: ((e: GamepadEvent) => void) | null = null;

  constructor() {
    this.detectTouch();
    this.loadPrefs();
    this.attachEventListeners();
  }

  private detectTouch(): void {
    if (typeof window !== 'undefined' && typeof navigator !== 'undefined') {
      this.isTouchDevice =
        'ontouchstart' in window ||
        navigator.maxTouchPoints > 0 ||
        (navigator as unknown as { msMaxTouchPoints?: number }).msMaxTouchPoints! > 0;
    }
  }

  // ==========================================================================
  // Event Listeners Binding
  // ============================================================================

  private attachEventListeners(): void {
    if (typeof window === 'undefined') return;

    this.boundKeyDown = (e: KeyboardEvent) => this.handleKeyDown(e);
    this.boundKeyUp = (e: KeyboardEvent) => this.handleKeyUp(e);
    this.boundBlur = () => this.clearAllInputs();
    this.boundPageHide = () => this.clearAllInputs();
    this.boundVisibilityChange = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        this.clearAllInputs();
      }
    };
    this.boundPadConnect = (e: GamepadEvent) => this.onGamepadConnected(e);
    this.boundPadDisconnect = (e: GamepadEvent) => this.onGamepadDisconnected(e);

    window.addEventListener('keydown', this.boundKeyDown, { passive: false });
    window.addEventListener('keyup', this.boundKeyUp, { passive: false });
    window.addEventListener('blur', this.boundBlur);
    window.addEventListener('pagehide', this.boundPageHide);
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.boundVisibilityChange);
    }
    window.addEventListener('gamepadconnected', this.boundPadConnect);
    window.addEventListener('gamepaddisconnected', this.boundPadDisconnect);
  }

  public destroy(): void {
    if (typeof window === 'undefined') return;
    if (this.boundKeyDown) window.removeEventListener('keydown', this.boundKeyDown);
    if (this.boundKeyUp) window.removeEventListener('keyup', this.boundKeyUp);
    if (this.boundBlur) window.removeEventListener('blur', this.boundBlur);
    if (this.boundPageHide) window.removeEventListener('pagehide', this.boundPageHide);
    if (this.boundVisibilityChange && typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.boundVisibilityChange);
    }
    if (this.boundPadConnect) window.removeEventListener('gamepadconnected', this.boundPadConnect);
    if (this.boundPadDisconnect) window.removeEventListener('gamepaddisconnected', this.boundPadDisconnect);
    if (InputManager._instance === this) {
      InputManager._instance = null;
    }
  }

  // ==========================================================================
  // Preferences
  // ============================================================================

  private loadPrefs(): void {
    if (typeof localStorage === 'undefined') return;
    try {
      const scheme = localStorage.getItem('ouro_input_scheme');
      if (scheme === 'stick' || scheme === 'follow' || scheme === 'swipe') {
        this.touchScheme = scheme;
      }
      const lefty = localStorage.getItem('ouro_input_lefty');
      if (lefty !== null) this.isLefty = lefty === 'true' || lefty === '1';
      const hap = localStorage.getItem('ouro_input_haptics');
      if (hap !== null) this.hapticsEnabled = !(hap === 'false' || hap === '0');
    } catch {
      // ignore
    }
  }

  public setTouchScheme(scheme: TouchScheme): void {
    this.touchScheme = scheme;
    if (typeof localStorage !== 'undefined') {
      try { localStorage.setItem('ouro_input_scheme', scheme); } catch {}
    }
    this.setSource(1, 0, 0, false);
    this.pointerActive = false;
  }

  public setLefty(lefty: boolean): void {
    this.isLefty = lefty;
    if (typeof localStorage !== 'undefined') {
      try { localStorage.setItem('ouro_input_lefty', lefty ? 'true' : 'false'); } catch {}
    }
  }

  public setHaptics(enabled: boolean): void {
    this.hapticsEnabled = enabled;
    if (typeof localStorage !== 'undefined') {
      try { localStorage.setItem('ouro_input_haptics', enabled ? 'true' : 'false'); } catch {}
    }
  }

  // ==========================================================================
  // Steering Vector Resolution & Source Arbitration
  // ============================================================================

  /**
   * Updates an individual steering source with timestamp-based arbitration.
   *
   * Source Arbitration Algorithm:
   * Each source (0: Keyboard, 1: Touch/VirtualStick, 2: Gamepad) updates its state
   * and increments `stampCounter` upon activation. `resolveSteering()` selects the active
   * source with the highest timestamp ($\arg\max_{s.\text{active}} s.\text{stamp}$).
   * This guarantees seamless transitions between keyboard, touch, and controller without
   * input fighting or axis jitter.
   *
   * @param sourceIndex 0 = Keyboard, 1 = Touch/Stick, 2 = Gamepad
   * @param x Horizontal vector component $\in [-1, 1]$
   * @param y Vertical vector component $\in [-1, 1]$
   * @param active True if source currently has positive user engagement
   */
  public setSource(sourceIndex: number, x: number, y: number, active: boolean): void {
    const src = this.sources[sourceIndex];
    if (!src) return;

    const safeX = Number.isFinite(x) ? x : 0.0;
    const safeY = Number.isFinite(y) ? y : 0.0;

    if (active && !src.active) {
      src.stamp = ++this.stampCounter;
    }
    src.x = active ? safeX : 0.0;
    src.y = active ? safeY : 0.0;
    src.active = active;
    this.resolveSteering();
  }

  /**
   * Evaluates active steering sources, computes normalized angle and magnitude,
   * and updates public steering properties.
   *
   * Mathematical Formulas:
   * Magnitude: $m = \sqrt{x^2 + y^2}$
   * Angle: $\theta = \text{atan2}(y, x) \in (-\pi, \pi]$
   * Heading threshold: $m > \epsilon = 10^{-5}$
   */
  private resolveSteering(): void {
    let best: SteerSource | null = null;
    for (const s of this.sources) {
      if (s.active && (!best || s.stamp > best.stamp)) {
        best = s;
      }
    }

    const mag = best ? Math.sqrt(best.x * best.x + best.y * best.y) : 0.0;
    if (best && mag > DIR_EPSILON) {
      this._dirX = best.x;
      this._dirY = best.y;
      this._magnitude = mag;
      this._angle = Math.atan2(best.y, best.x);
      this._hasDirection = true;
    } else {
      this._dirX = 0.0;
      this._dirY = 0.0;
      this._magnitude = 0.0;
      this._angle = 0.0;
      this._hasDirection = false;
    }
  }

  /** Manual steering entry point (used for scripted tests / replay harness). */
  public setDirection(dx: number, dy: number): void {
    const x = Number.isFinite(dx) ? dx : 0;
    const y = Number.isFinite(dy) ? dy : 0;
    const m = Math.sqrt(x * x + y * y);
    if (m <= DIR_EPSILON) {
      this.setSource(0, 0, 0, false);
      return;
    }
    this.setSource(0, x / m, y / m, true);
  }
  public SetDirection(dx: number, dy: number): void { this.setDirection(dx, dy); }

  // ==========================================================================
  // Keyboard Event Handlers
  // ============================================================================

  private isFormTarget(target: EventTarget | null): boolean {
    if (!target || typeof HTMLElement === 'undefined' || !(target instanceof HTMLElement)) {
      return false;
    }
    const tag = target.tagName.toLowerCase();
    return tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable;
  }

  public handleKeyDown(e: KeyboardEvent): void {
    if (this.isFormTarget(e.target)) return;

    const code = e.code;
    const isHandled =
      code === 'KeyW' || code === 'KeyA' || code === 'KeyS' || code === 'KeyD' ||
      code === 'ArrowUp' || code === 'ArrowLeft' || code === 'ArrowDown' || code === 'ArrowRight' ||
      code === 'Space' || code === 'KeyE' || code === 'ShiftLeft' || code === 'ShiftRight' ||
      code === 'KeyP' || code === 'Escape' || code === 'KeyL' || code === 'KeyH' || code === 'KeyT' || code === 'KeyB' || code === 'F1' ||
      code === 'Enter' || code === 'NumpadEnter';

    if (isHandled && typeof e.preventDefault === 'function') {
      e.preventDefault();
    }

    if (e.repeat && (code === 'Space' || code === 'KeyE' || code === 'KeyP' || code === 'Escape' || code === 'KeyL' || code === 'KeyH' || code === 'KeyT' || code === 'KeyB' || code === 'F1')) {
      return;
    }

    this.heldKeys.add(code);

    if (code === 'Space') {
      if (!this.dashKey) this.dashPressed = true;
      this.dashKey = true;
      this.syncHeld();
    } else if (code === 'KeyE' || code === 'ShiftLeft' || code === 'ShiftRight') {
      if (!this.skillKey) this.skillPressed = true;
      this.skillKey = true;
      this.syncHeld();
    } else if (code === 'KeyP' || code === 'Escape') {
      this.pausePressed = true;
    } else if (code === 'KeyL') {
      this.labPressed = true;
    } else if (code === 'KeyH' || code === 'F1') {
      this.helpPressed = true;
    } else if (code === 'KeyT') {
      this.statsPressed = true;
    } else if (code === 'KeyB') {
      this.botTogglePressed = true;
    } else if (code === 'Enter' || code === 'NumpadEnter') {
      this.confirmPressed = true;
    }

    this.updateKeyVector();
  }

  public handleKeyUp(e: KeyboardEvent): void {
    const code = e.code;
    this.heldKeys.delete(code);

    if (code === 'Space') {
      this.dashKey = false;
      this.syncHeld();
    } else if (code === 'KeyE' || code === 'ShiftLeft' || code === 'ShiftRight') {
      this.skillKey = false;
      this.syncHeld();
    }

    this.updateKeyVector();
  }

  private updateKeyVector(): void {
    let x = 0;
    let y = 0;

    if (this.heldKeys.has('KeyW') || this.heldKeys.has('ArrowUp')) y -= 1;
    if (this.heldKeys.has('KeyS') || this.heldKeys.has('ArrowDown')) y += 1;
    if (this.heldKeys.has('KeyA') || this.heldKeys.has('ArrowLeft')) x -= 1;
    if (this.heldKeys.has('KeyD') || this.heldKeys.has('ArrowRight')) x += 1;

    if (x === 0 && y === 0) {
      if (this.keyVectorLive) {
        this.keyVectorLive = false;
        this.setSource(0, 0, 0, false);
      }
      return;
    }

    const m = Math.sqrt(x * x + y * y);
    this.keyVectorLive = true;
    this.setSource(0, x / m, y / m, true);
  }

  public clearKeys(): void {
    this.heldKeys.clear();
    this.keyVectorLive = false;
    this.dashKey = false;
    this.skillKey = false;
    this.syncHeld();
    this.setSource(0, 0, 0, false);
  }

  /**
   * Cleanses all active inputs across Keyboard, Touch, Virtual Stick, and Gamepad sources.
   * Invoked upon window blur, pagehide, or document visibility hidden state to prevent
   * stuck steering vectors or phantom held buttons when switching tabs or backgrounding the app.
   */
  public clearAllInputs(): void {
    this.clearKeys();
    this.setSource(1, 0, 0, false);
    this.setSource(2, 0, 0, false);
    this.dashTouch = false;
    this.skillTouch = false;
    this.dashPad = false;
    this.skillPad = false;
    this.pointerActive = false;
    this.activeTouchId = null;
    this.syncHeld();
  }

  // ==========================================================================
  // Gamepad Polling & Edge Processing
  // ============================================================================

  private onGamepadConnected(e: GamepadEvent): void {
    this.gamepadConnected = true;
    this.gamepadIndex = e.gamepad.index;
    if (!this.firstPadSample) {
      this.justConnected = true;
    }
  }

  private onGamepadDisconnected(e: GamepadEvent): void {
    if (this.gamepadIndex === e.gamepad.index) {
      this.gamepadConnected = false;
      this.gamepadIndex = null;
      this.setSource(2, 0, 0, false);
      this.dashPad = false;
      this.skillPad = false;
      this.syncHeld();
    }
  }

  public pollGamepad(): void {
    if (typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') {
      return;
    }

    const pads = navigator.getGamepads();
    let connected = false;
    let steerX = 0;
    let steerY = 0;
    let steering = false;
    let dashHeld = false;
    let skillHeld = false;

    for (let i = 0; i < pads.length; i++) {
      const pad = pads[i];
      if (!pad || !pad.connected) continue;

      connected = true;
      const dev = pad.index;
      const buttons = pad.buttons;
      const prev = this.prevPadButtons.get(dev);
      const isFirst = !prev;

      // Analog Left Stick: Radial Deadzone & Scaled Magnitude
      // Formula:
      // Raw magnitude: $m = \sqrt{a_x^2 + a_y^2}$
      // Rescaled magnitude: $m' = \min\left(1.0, \frac{m - d_0}{1.0 - d_0}\right)$ for $m > d_0$
      // Output vector: $(\text{steerX}, \text{steerY}) = \left(\frac{a_x}{m} m', \frac{a_y}{m} m'\right)$
      // This eliminates central stick drift while guaranteeing smooth analog response from zero deflection.
      const ax = pad.axes[0] ?? 0;
      const ay = pad.axes[1] ?? 0;
      const mag = Math.sqrt(ax * ax + ay * ay);

      if (mag > this.padDeadzone) {
        const scaled = Math.min(1.0, (mag - this.padDeadzone) / (1.0 - this.padDeadzone));
        steerX = (ax / mag) * scaled;
        steerY = (ay / mag) * scaled;
        steering = true;
        this.gamepadIndex = dev;
      } else {
        // D-Pad 8-way Fallback (Buttons 12: Up, 13: Down, 14: Left, 15: Right)
        const dUp = buttons[12]?.pressed ?? false;
        const dDown = buttons[13]?.pressed ?? false;
        const dLeft = buttons[14]?.pressed ?? false;
        const dRight = buttons[15]?.pressed ?? false;

        let dx = (dRight ? 1 : 0) - (dLeft ? 1 : 0);
        let dy = (dDown ? 1 : 0) - (dUp ? 1 : 0);

        if (dx !== 0 || dy !== 0) {
          const dm = Math.sqrt(dx * dx + dy * dy);
          steerX = dx / dm;
          steerY = dy / dm;
          steering = true;
          this.gamepadIndex = dev;
        }
      }

      // Action Buttons (Standard Mapping):
      // 0 = A/Cross (Dash), 1 = B/Circle (Skill Alt), 2 = X/Square (Skill), 3 = Y/Triangle (Confirm)
      // 8 = Back/Select, 9 = Start/Options (Pause)
      const bDash = buttons[0]?.pressed ?? false;
      const bSkillAlt = buttons[1]?.pressed ?? false;
      const bSkill = buttons[2]?.pressed ?? false;
      const bConfirm = buttons[3]?.pressed ?? false;
      const bPauseAlt = buttons[8]?.pressed ?? false;
      const bPause = buttons[9]?.pressed ?? false;

      const edge = (now: boolean, btnIndex: number) => !isFirst && prev && now && !prev[btnIndex];

      if (edge(bDash, 0)) this.dashPressed = true;
      if (edge(bSkill, 2) || edge(bSkillAlt, 1)) this.skillPressed = true;
      if (edge(bPause, 9) || edge(bPauseAlt, 8)) this.pausePressed = true;
      if (edge(bConfirm, 3)) this.confirmPressed = true;

      if (bDash) dashHeld = true;
      if (bSkill || bSkillAlt) skillHeld = true;

      // Save previous state snapshot
      const currentStates: boolean[] = [];
      for (let b = 0; b < buttons.length; b++) {
        currentStates[b] = buttons[b]?.pressed ?? false;
      }
      this.prevPadButtons.set(dev, currentStates);
    }

    if (connected !== this.gamepadConnected) {
      this.gamepadConnected = connected;
      if (connected && !this.firstPadSample) {
        this.justConnected = true;
      }
    }
    this.firstPadSample = false;

    this.setSource(2, steerX, steerY, steering);
    this.dashPad = dashHeld;
    this.skillPad = skillHeld;
    this.syncHeld();
  }
  public PollGamepad(): void { this.pollGamepad(); }

  // ==========================================================================
  // Touch Surface & Gesture Processing
  // ============================================================================

  public onSurfaceTouchStart(touchId: number, screenX: number, screenY: number, normX: number, normY: number): void {
    if (this.activeTouchId !== null) return;
    const sx = Number.isFinite(screenX) ? screenX : 0;
    const sy = Number.isFinite(screenY) ? screenY : 0;
    const nx = Number.isFinite(normX) ? normX : 0.5;
    const ny = Number.isFinite(normY) ? normY : 0.5;

    this.activeTouchId = touchId;
    this.swipeOriginX = sx;
    this.swipeOriginY = sy;
    this.pointerScreenX = sx;
    this.pointerScreenY = sy;
    this.pointerNormX = nx;
    this.pointerNormY = ny;

    if (this.touchScheme === 'follow') {
      this.pointerActive = true;
    }
  }

  public onSurfaceTouchMove(touchId: number, screenX: number, screenY: number, normX: number, normY: number): void {
    if (this.activeTouchId !== touchId) return;
    const sx = Number.isFinite(screenX) ? screenX : this.pointerScreenX;
    const sy = Number.isFinite(screenY) ? screenY : this.pointerScreenY;
    const nx = Number.isFinite(normX) ? normX : this.pointerNormX;
    const ny = Number.isFinite(normY) ? normY : this.pointerNormY;

    this.pointerScreenX = sx;
    this.pointerScreenY = sy;
    this.pointerNormX = nx;
    this.pointerNormY = ny;

    if (this.touchScheme === 'follow') {
      this.pointerActive = true;
    } else if (this.touchScheme === 'swipe') {
      this.trySwipe(sx, sy);
    }
  }

  public onSurfaceTouchEnd(touchId: number, screenX: number, screenY: number): void {
    if (this.activeTouchId !== touchId) return;
    const sx = Number.isFinite(screenX) ? screenX : this.pointerScreenX;
    const sy = Number.isFinite(screenY) ? screenY : this.pointerScreenY;
    if (this.touchScheme === 'swipe') {
      this.trySwipe(sx, sy);
    }
    this.activeTouchId = null;
    this.pointerActive = false;
  }

  public onSurfaceTouchCancel(touchId: number): void {
    if (this.activeTouchId !== touchId) return;
    this.activeTouchId = null;
    this.pointerActive = false;
  }

  private trySwipe(cx: number, cy: number): void {
    const dx = cx - this.swipeOriginX;
    const dy = cy - this.swipeOriginY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 28.0) return;

    const step = Math.PI / 4.0; // 8 directions (45 degrees each)
    const angle = Math.round(Math.atan2(dy, dx) / step) * step;
    this.setSource(1, Math.cos(angle), Math.sin(angle), true);

    this.swipeOriginX = cx;
    this.swipeOriginY = cy;
    this.vibrate(12);
  }

  // ==========================================================================
  // Virtual Stick Feeders
  // ============================================================================

  public onStickUpdate(vectorX: number, vectorY: number, active: boolean): void {
    const safeX = Number.isFinite(vectorX) ? vectorX : 0.0;
    const safeY = Number.isFinite(vectorY) ? vectorY : 0.0;
    this.setSource(1, safeX, safeY, active);
  }

  public onPadTouchAction(kind: 'dash' | 'skill', active: boolean): void {
    if (kind === 'dash') {
      if (active && !this.dashTouch) {
        this.dashPressed = true;
        this.vibrate(18);
      }
      this.dashTouch = active;
    } else {
      if (active && !this.skillTouch) {
        this.skillPressed = true;
        this.vibrate(28);
      }
      this.skillTouch = active;
    }
    this.syncHeld();
  }

  // ==========================================================================
  // Action Consumers & Haptics
  // ============================================================================

  private syncHeld(): void {
    this.dashHeld = this.dashKey || this.dashTouch || this.dashPad;
    this.skillHeld = this.skillKey || this.skillTouch || this.skillPad;
  }

  public consumeDash(): boolean {
    const v = this.dashPressed;
    this.dashPressed = false;
    return v;
  }
  public ConsumeDash(): boolean { return this.consumeDash(); }

  public consumeSkill(): boolean {
    const v = this.skillPressed;
    this.skillPressed = false;
    return v;
  }
  public ConsumeSkill(): boolean { return this.consumeSkill(); }

  public consumePause(): boolean {
    const v = this.pausePressed;
    this.pausePressed = false;
    return v;
  }
  public ConsumePause(): boolean { return this.consumePause(); }

  public consumeConfirm(): boolean {
    const v = this.confirmPressed;
    this.confirmPressed = false;
    return v;
  }
  public ConsumeConfirm(): boolean { return this.consumeConfirm(); }

  public consumeLab(): boolean {
    const v = this.labPressed;
    this.labPressed = false;
    return v;
  }
  public ConsumeLab(): boolean { return this.consumeLab(); }

  public consumeHelp(): boolean {
    const v = this.helpPressed;
    this.helpPressed = false;
    return v;
  }
  public ConsumeHelp(): boolean { return this.consumeHelp(); }

  public consumeStats(): boolean {
    const v = this.statsPressed;
    this.statsPressed = false;
    return v;
  }
  public ConsumeStats(): boolean { return this.consumeStats(); }

  public consumeBotToggle(): boolean {
    const v = this.botTogglePressed;
    this.botTogglePressed = false;
    return v;
  }
  public ConsumeBotToggle(): boolean { return this.consumeBotToggle(); }

  public RequestDash(): void { this.dashPressed = true; }
  public requestDash(): void { this.RequestDash(); }
  public RequestSkill(): void { this.skillPressed = true; }
  public requestSkill(): void { this.RequestSkill(); }
  public RequestPause(): void { this.pausePressed = true; }
  public requestPause(): void { this.RequestPause(); }
  public RequestLab(): void { this.labPressed = true; }
  public requestLab(): void { this.RequestLab(); }
  public RequestHelp(): void { this.helpPressed = true; }
  public RequestStats(): void { this.statsPressed = true; }

  public consumeJustConnected(): boolean {
    const v = this.justConnected;
    this.justConnected = false;
    return v;
  }
  public ConsumeJustConnected(): boolean { return this.consumeJustConnected(); }

  public vibrate(msOrPattern: number | number[] | readonly number[]): void {
    if (!this.hapticsEnabled) return;

    let durationMs = 20;
    if (Array.isArray(msOrPattern)) {
      durationMs = 0;
      for (let i = 0; i < msOrPattern.length; i += 2) {
        durationMs += msOrPattern[i] ?? 0;
      }
    } else if (typeof msOrPattern === 'number') {
      durationMs = msOrPattern;
    }
    durationMs = Math.max(10, Math.min(1000, durationMs));

    // Mobile Phone Haptic
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      try {
        navigator.vibrate(durationMs);
      } catch {}
    }

    // Gamepad Dual-Motor Rumble
    if (this.gamepadConnected && typeof navigator !== 'undefined' && typeof navigator.getGamepads === 'function') {
      try {
        const pads = navigator.getGamepads();
        const pad = this.gamepadIndex !== null ? pads[this.gamepadIndex] : pads[0];
        const actuator = pad?.vibrationActuator as unknown as {
          playEffect: (type: string, options: { startDelay?: number; duration: number; weakMagnitude: number; strongMagnitude: number }) => Promise<void>;
        };
        if (actuator && typeof actuator.playEffect === 'function') {
          actuator.playEffect('dual-rumble', {
            startDelay: 0,
            duration: durationMs,
            weakMagnitude: 0.45,
            strongMagnitude: 0.75
          }).catch(() => {});
        }
      } catch {}
    }
  }
  public Vibrate(msOrPattern: number | readonly number[]): void { this.vibrate(msOrPattern); }

  public reset(): void {
    this.heldKeys.clear();
    this.keyVectorLive = false;
    for (const s of this.sources) {
      s.x = 0;
      s.y = 0;
      s.active = false;
    }
    this._dirX = 0;
    this._dirY = 0;
    this._magnitude = 0;
    this._hasDirection = false;

    this.dashPressed = false;
    this.skillPressed = false;
    this.pausePressed = false;
    this.confirmPressed = false;
    this.labPressed = false;
    this.dashKey = this.dashTouch = this.dashPad = false;
    this.skillKey = this.skillTouch = this.skillPad = false;
    this.syncHeld();

    this.pointerActive = false;
    this.activeTouchId = null;
    this.justConnected = false;
  }
  public Reset(): void { this.reset(); }
}
