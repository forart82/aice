/**
 * Ouroboros Ascension — Virtual Touch Joystick (VirtualStick.ts)
 *
 * High-performance virtual touch joystick supporting:
 *  - Floating / Dynamic Origin (appears directly under the thumb in the touch control zone)
 *  - Fixed Anchor Mode (centered in designated HUD corner)
 *  - Configurable deadzone radius fraction and max movement radius
 *  - Analog magnitude ramping from deadzone edge to full deflection
 *  - Spring return with configurable damping ($1 - e^{-\omega \Delta t}$)
 *  - Pure WebGL & DOM responsive touch integration hooks
 *
 * Headless-safe. Meets AGENTS.md Rule 10 In-Code Documentation & Rule 12 Pure WebGL Standards.
 */

import { InputManager } from './InputManager.js';

export interface VirtualStickOptions {
  /** Outer boundary circle radius in CSS pixels (default: 60px). */
  radius?: number;
  /** Inner thumb knob radius in CSS pixels (default: 26px). */
  knobRadius?: number;
  /** Deadzone fraction of outer radius where steering remains zero (default: 0.18). */
  deadzoneFrac?: number;
  /** Whether the joystick base spawns dynamically at the initial touch coordinate (default: true). */
  dynamicOrigin?: boolean;
  /** Return animation exponential decay rate factor (default: 15.0). */
  springReturnSpeed?: number;
  /** True if left-handed mode is enabled (stick docked on right side). */
  lefty?: boolean;
}

export class VirtualStick {
  public radius = 60.0;
  public knobRadius = 26.0;
  public deadzoneFrac = 0.18;
  public dynamicOrigin = true;
  public springReturnSpeed = 15.0;
  public lefty = false;

  // Position state (screen pixels)
  public baseX = 0.0;
  public baseY = 0.0;
  public knobX = 0.0;
  public knobY = 0.0;

  // Normalized output vector (-1.0 to 1.0)
  public vectorX = 0.0;
  public vectorY = 0.0;
  public magnitude = 0.0;
  public angle = 0.0;

  public active = false;
  public visible = false;
  public touchId: number | null = null;

  private inputManager: InputManager | null = null;
  private boundBlur: (() => void) | null = null;
  private boundVisibilityChange: (() => void) | null = null;

  constructor(options?: VirtualStickOptions) {
    if (options) {
      if (options.radius) this.radius = options.radius;
      if (options.knobRadius) this.knobRadius = options.knobRadius;
      if (options.deadzoneFrac !== undefined) this.deadzoneFrac = options.deadzoneFrac;
      if (options.dynamicOrigin !== undefined) this.dynamicOrigin = options.dynamicOrigin;
      if (options.springReturnSpeed) this.springReturnSpeed = options.springReturnSpeed;
      if (options.lefty !== undefined) this.lefty = options.lefty;
    }
    this.attachWindowListeners();
  }

  private attachWindowListeners(): void {
    if (typeof window === 'undefined') return;

    this.boundBlur = () => this.release();
    this.boundVisibilityChange = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        this.release();
      }
    };

    window.addEventListener('blur', this.boundBlur);
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.boundVisibilityChange);
    }
  }

  public destroy(): void {
    if (typeof window === 'undefined') return;
    if (this.boundBlur) window.removeEventListener('blur', this.boundBlur);
    if (this.boundVisibilityChange && typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.boundVisibilityChange);
    }
  }

  public bind(manager: InputManager): void {
    this.inputManager = manager;
  }

  // ==========================================================================
  // Touch Event Handling
  // ============================================================================

  public onTouchStart(touchId: number, screenX: number, screenY: number): void {
    if (this.active && this.touchId !== null) return;

    const sx = Number.isFinite(screenX) ? screenX : 0.0;
    const sy = Number.isFinite(screenY) ? screenY : 0.0;

    this.active = true;
    this.touchId = touchId;

    if (this.dynamicOrigin) {
      this.baseX = sx;
      this.baseY = sy;
      this.visible = true;
    }

    this.knobX = this.baseX;
    this.knobY = this.baseY;
    this.vectorX = 0.0;
    this.vectorY = 0.0;
    this.magnitude = 0.0;

    this.inputManager?.onStickUpdate(0, 0, false);
  }

  public onTouchMove(touchId: number, screenX: number, screenY: number): void {
    if (!this.active || this.touchId !== touchId) return;

    const sx = Number.isFinite(screenX) ? screenX : this.baseX;
    const sy = Number.isFinite(screenY) ? screenY : this.baseY;

    const dx = sx - this.baseX;
    const dy = sy - this.baseY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const deadzone = this.radius * this.deadzoneFrac;

    if (!Number.isFinite(dist) || dist <= deadzone || dist < 0.0001) {
      this.knobX = this.baseX;
      this.knobY = this.baseY;
      this.vectorX = 0.0;
      this.vectorY = 0.0;
      this.magnitude = 0.0;
      this.inputManager?.onStickUpdate(0, 0, false);
      return;
    }

    // Mathematical Deflection Clamping & Analog Deadzone Rescaling:
    // 1. Vector: $\vec{d} = (s_x - b_x, s_y - b_y)$, distance $D = \|\vec{d}\|$
    // 2. Deadzone boundary: $r_{\text{dead}} = r_{\text{radius}} \cdot f_{\text{dead}}$
    // 3. Clamped knob offset: $D_{\text{clamped}} = \min(D, r_{\text{radius}})$
    // 4. Knob coordinates: $(k_x, k_y) = (b_x + \hat{d}_x D_{\text{clamped}}, b_y + \hat{d}_y D_{\text{clamped}})$
    // 5. Analog magnitude: $M = \min\left(1.0, \frac{D_{\text{clamped}} - r_{\text{dead}}}{r_{\text{radius}} - r_{\text{dead}}}\right)$
    // 6. Output vector: $\vec{V} = \hat{d} \cdot M$
    const clampedDist = Math.min(dist, this.radius);
    const nx = dx / dist;
    const ny = dy / dist;

    this.knobX = this.baseX + nx * clampedDist;
    this.knobY = this.baseY + ny * clampedDist;

    // Analog magnitude ramp from deadzone threshold to 1.0
    const mag = Math.min(1.0, (clampedDist - deadzone) / Math.max(1.0, this.radius - deadzone));
    this.magnitude = Math.max(0.05, mag);
    this.vectorX = nx * this.magnitude;
    this.vectorY = ny * this.magnitude;
    this.angle = Math.atan2(ny, nx);

    this.inputManager?.onStickUpdate(this.vectorX, this.vectorY, true);
  }

  public onTouchEnd(touchId: number): void {
    if (!this.active || this.touchId !== touchId) return;
    this.release();
  }

  public onTouchCancel(touchId: number): void {
    this.onTouchEnd(touchId);
  }

  public release(): void {
    this.active = false;
    this.touchId = null;
    this.vectorX = 0.0;
    this.vectorY = 0.0;
    this.magnitude = 0.0;
    this.angle = 0.0;

    if (this.dynamicOrigin) {
      this.visible = false;
      this.knobX = this.baseX;
      this.knobY = this.baseY;
    }

    // Snake coasts on last heading when stick is released
    this.inputManager?.onStickUpdate(0, 0, false);
  }

  public reset(): void {
    this.release();
  }

  // ==========================================================================
  // Spring Return Animation Step
  // ============================================================================

  public update(dt: number): void {
    const safeDt = Number.isFinite(dt) ? Math.max(0.001, dt) : 0.016;
    if (!this.active && (this.knobX !== this.baseX || this.knobY !== this.baseY)) {
      const k = 1.0 - Math.exp(-this.springReturnSpeed * safeDt);
      this.knobX += (this.baseX - this.knobX) * k;
      this.knobY += (this.baseY - this.knobY) * k;
    }
  }
}

