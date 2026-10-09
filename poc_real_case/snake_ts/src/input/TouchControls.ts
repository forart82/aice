/**
 * Ouroboros Ascension — On-Screen Touch Action Controls (TouchControls.ts)
 *
 * Implements interactive touch action buttons (Dash, Skill, Pause) with:
 *  - Responsive grid placement and Safe-Area notch/margin offsets
 *  - High-visibility vector glyph drawing (Lightning Bolt, 4-Point Star, Pause Bars)
 *  - Press/Release active visual state animations and touch feedback
 *  - Lefty mode support (swaps stick and button side)
 *  - Headless-safe.
 */

import { InputManager } from './InputManager.js';

export interface TouchButtonRect {
  x: number;
  y: number;
  width: number;
  height: number;
  radius: number;
}

import type { SafeAreaInsets } from '../platform/Env.js';

export class TouchControls {
  public dashRect: TouchButtonRect = { x: 0, y: 0, width: 76, height: 76, radius: 38 };
  public skillRect: TouchButtonRect = { x: 0, y: 0, width: 76, height: 76, radius: 38 };
  public pauseRect: TouchButtonRect = { x: 0, y: 0, width: 52, height: 52, radius: 26 };

  public dashActive = false;
  public skillActive = false;
  public pauseActive = false;

  public dashTouchId: number | null = null;
  public skillTouchId: number | null = null;
  public pauseTouchId: number | null = null;

  public visible = true;
  public isLefty = false;
  public safeArea: SafeAreaInsets = { left: 0, top: 0, right: 0, bottom: 0 };

  private inputManager: InputManager | null = null;
  private boundBlur: (() => void) | null = null;
  private boundVisibilityChange: (() => void) | null = null;

  constructor(inputManager?: InputManager) {
    if (inputManager) this.bind(inputManager);
    this.attachWindowListeners();
  }

  private attachWindowListeners(): void {
    if (typeof window === 'undefined') return;

    this.boundBlur = () => this.reset();
    this.boundVisibilityChange = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        this.reset();
      }
    };

    window.addEventListener('blur', this.boundBlur);
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.boundVisibilityChange);
    }
  }

  /**
   * Resets active touch states, removes window/document event listeners,
   * and unlinks the host InputManager reference.
   */
  public destroy(): void {
    this.reset();
    this.inputManager = null;
    if (typeof window === 'undefined') return;
    if (this.boundBlur) window.removeEventListener('blur', this.boundBlur);
    if (this.boundVisibilityChange && typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.boundVisibilityChange);
    }
  }

  /**
   * Universal disposable alias conforming to platform lifecycle standard.
   */
  public dispose(): void {
    this.destroy();
  }

  public bind(manager: InputManager): void {
    this.inputManager = manager;
    this.isLefty = manager.isLefty;
  }

  // ==========================================================================
  // Layout and Responsive Resizing Math
  // ============================================================================

  public placement: 'auto' | 'bottom-center' | 'corner' = 'auto';

  /**
   * Recomputes touch button bounding boxes and safe-area margin offsets.
   *
   * Geometric Derivation & Layout Modes:
   *
   * 1. Safe Area Inset Compensation:
   *    Hardware camera cutouts, notches, and rounded home-indicator bars are offset by adding
   *    `insets.left`, `insets.right`, `insets.top`, `insets.bottom` to standard screen padding ($margin = 20\text{px}$).
   *
   * 2. Ambidextrous Bottom-Center Symmetrical Layout (Smartphones: $W \le 768\text{px}$ or $\frac{W}{H} < 1.05$):
   *    Positions action buttons along the bottom screen spine:
   *    - Center line: $X_{\text{center}} = \frac{W}{2}$
   *    - Vertical anchor: $Y_{\text{base}} = H - margin - \text{safeArea.bottom} - \text{btnSize}$
   *    - Button size: $\text{btnSize} = \text{clamp}(64, 0.12 \cdot H, 84)$
   *    - Left slot: $X = X_{\text{center}} - \frac{btnGap}{2} - \text{btnSize}$
   *    - Right slot: $X = X_{\text{center}} + \frac{btnGap}{2}$
   *    - Normal mode: Skill on left slot, Dash on right slot.
   *    - Lefty mode: Dash on left slot, Skill on right slot.
   *
   * 3. Corner Docking Mode (Wide Desktop / Tablet Viewports):
   *    Positions action cluster in the lower corner opposite the steering stick:
   *    - Normal: Lower left corner
   *    - Lefty: Lower right corner
   *
   * @param viewportWidth Screen logical width in CSS pixels
   * @param viewportHeight Screen logical height in CSS pixels
   * @param insets Optional safe-area cutouts ({ left, top, right, bottom })
   */
  public updateLayout(viewportWidth: number, viewportHeight: number, insets?: Partial<SafeAreaInsets>): void {
    if (!Number.isFinite(viewportWidth) || !Number.isFinite(viewportHeight) || viewportWidth <= 0 || viewportHeight <= 0) {
      return;
    }

    if (insets) {
      this.safeArea = {
        left: Number.isFinite(insets.left) && (insets.left as number) >= 0 ? (insets.left as number) : this.safeArea.left,
        top: Number.isFinite(insets.top) && (insets.top as number) >= 0 ? (insets.top as number) : this.safeArea.top,
        right: Number.isFinite(insets.right) && (insets.right as number) >= 0 ? (insets.right as number) : this.safeArea.right,
        bottom: Number.isFinite(insets.bottom) && (insets.bottom as number) >= 0 ? (insets.bottom as number) : this.safeArea.bottom
      };
    }

    const btnSize = Math.max(64, Math.min(84, Math.floor(viewportHeight * 0.12)));
    const btnGap = 16;
    const margin = 20;

    // Pause Button: Top right (or top left in Lefty mode)
    const pauseSize = 52;
    const pauseX = this.isLefty
      ? margin + this.safeArea.left
      : viewportWidth - margin - this.safeArea.right - pauseSize;
    const pauseY = margin + this.safeArea.top;

    this.pauseRect = {
      x: pauseX,
      y: pauseY,
      width: pauseSize,
      height: pauseSize,
      radius: pauseSize / 2
    };

    const isBottomCenter = this.placement === 'bottom-center' || (this.placement === 'auto' && (viewportWidth <= 768 || (viewportWidth / viewportHeight < 1.05)));
    const baseY = viewportHeight - margin - this.safeArea.bottom - btnSize;

    if (isBottomCenter) {
      // Bottom-Center Symmetrical Layout (Ambidextrous Mobile Design for Smartphones)
      const centerX = viewportWidth * 0.5;
      const halfGap = btnGap * 0.5;

      if (this.isLefty) {
        this.dashRect = {
          x: centerX - halfGap - btnSize,
          y: baseY,
          width: btnSize,
          height: btnSize,
          radius: btnSize / 2
        };
        this.skillRect = {
          x: centerX + halfGap,
          y: baseY,
          width: btnSize,
          height: btnSize,
          radius: btnSize / 2
        };
      } else {
        this.skillRect = {
          x: centerX - halfGap - btnSize,
          y: baseY,
          width: btnSize,
          height: btnSize,
          radius: btnSize / 2
        };
        this.dashRect = {
          x: centerX + halfGap,
          y: baseY,
          width: btnSize,
          height: btnSize,
          radius: btnSize / 2
        };
      }
    } else {
      // Corner Docking for Wide Desktop/Tablet Screens
      const actionZoneWidth = btnSize * 2 + btnGap;
      const baseX = this.isLefty
        ? viewportWidth - margin - this.safeArea.right - actionZoneWidth
        : margin + this.safeArea.left;

      this.skillRect = {
        x: baseX,
        y: baseY,
        width: btnSize,
        height: btnSize,
        radius: btnSize / 2
      };

      this.dashRect = {
        x: baseX + btnSize + btnGap,
        y: baseY,
        width: btnSize,
        height: btnSize,
        radius: btnSize / 2
      };
    }
  }

  // ==========================================================================
  // Touch Hit Testing & Event Dispatch
  // ============================================================================

  private getDistSq(x: number, y: number, btn: TouchButtonRect): number {
    const cx = btn.x + btn.width / 2;
    const cy = btn.y + btn.height / 2;
    const dx = x - cx;
    const dy = y - cy;
    return dx * dx + dy * dy;
  }

  private hitTest(x: number, y: number, btn: TouchButtonRect): boolean {
    const distSq = this.getDistSq(x, y, btn);
    const slop = btn.radius + 10;
    return distSq <= slop * slop;
  }

  public onTouchStart(touchId: number, screenX: number, screenY: number): boolean {
    if (!this.visible) return false;
    if (!Number.isFinite(screenX) || !Number.isFinite(screenY)) return false;

    // Reject if this touchId is already holding any button
    if (touchId === this.dashTouchId || touchId === this.skillTouchId || touchId === this.pauseTouchId) {
      return false;
    }

    // Check hit candidates with distance-to-center disambiguation
    const candidates: Array<{ kind: 'dash' | 'skill' | 'pause'; distSq: number }> = [];

    if (this.dashTouchId === null && this.hitTest(screenX, screenY, this.dashRect)) {
      candidates.push({ kind: 'dash', distSq: this.getDistSq(screenX, screenY, this.dashRect) });
    }
    if (this.skillTouchId === null && this.hitTest(screenX, screenY, this.skillRect)) {
      candidates.push({ kind: 'skill', distSq: this.getDistSq(screenX, screenY, this.skillRect) });
    }
    if (this.pauseTouchId === null && this.hitTest(screenX, screenY, this.pauseRect)) {
      candidates.push({ kind: 'pause', distSq: this.getDistSq(screenX, screenY, this.pauseRect) });
    }

    if (candidates.length === 0) return false;

    // Pick closest button center to eliminate boundary overlap ambiguity
    candidates.sort((a, b) => a.distSq - b.distSq);
    const chosen = candidates[0]!.kind;

    if (chosen === 'dash') {
      this.dashTouchId = touchId;
      this.dashActive = true;
      this.inputManager?.onPadTouchAction('dash', true);
      return true;
    } else if (chosen === 'skill') {
      this.skillTouchId = touchId;
      this.skillActive = true;
      this.inputManager?.onPadTouchAction('skill', true);
      return true;
    } else if (chosen === 'pause') {
      this.pauseTouchId = touchId;
      this.pauseActive = true;
      if (this.inputManager) {
        this.inputManager.pausePressed = true;
        this.inputManager.vibrate(20);
      }
      return true;
    }

    return false;
  }

  public onTouchMove(touchId: number, screenX: number, screenY: number): void {
    if (!Number.isFinite(screenX) || !Number.isFinite(screenY)) return;

    if (this.dashTouchId === touchId && !this.hitTest(screenX, screenY, this.dashRect)) {
      this.dashTouchId = null;
      this.dashActive = false;
      this.inputManager?.onPadTouchAction('dash', false);
    }
    if (this.skillTouchId === touchId && !this.hitTest(screenX, screenY, this.skillRect)) {
      this.skillTouchId = null;
      this.skillActive = false;
      this.inputManager?.onPadTouchAction('skill', false);
    }
    if (this.pauseTouchId === touchId && !this.hitTest(screenX, screenY, this.pauseRect)) {
      this.pauseTouchId = null;
      this.pauseActive = false;
    }
  }

  public onTouchEnd(touchId: number): void {
    if (this.dashTouchId === touchId) {
      this.dashTouchId = null;
      this.dashActive = false;
      this.inputManager?.onPadTouchAction('dash', false);
    }
    if (this.skillTouchId === touchId) {
      this.skillTouchId = null;
      this.skillActive = false;
      this.inputManager?.onPadTouchAction('skill', false);
    }
    if (this.pauseTouchId === touchId) {
      this.pauseTouchId = null;
      this.pauseActive = false;
    }
  }

  public onTouchCancel(touchId: number): void {
    this.onTouchEnd(touchId);
  }

  public reset(): void {
    if (this.dashActive || this.dashTouchId !== null) {
      this.dashTouchId = null;
      this.dashActive = false;
      this.inputManager?.onPadTouchAction('dash', false);
    }
    if (this.skillActive || this.skillTouchId !== null) {
      this.skillTouchId = null;
      this.skillActive = false;
      this.inputManager?.onPadTouchAction('skill', false);
    }
    if (this.pauseActive || this.pauseTouchId !== null) {
      this.pauseTouchId = null;
      this.pauseActive = false;
    }
  }
}

