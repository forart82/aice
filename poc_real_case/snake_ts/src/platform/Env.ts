/**
 * Hardware safe-area insets in logical CSS pixels.
 */
export interface SafeAreaInsets {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/**
 * Platform Environment & Capability Probe.
 * Safe for execution in browser runtime and headless Node.js/Vitest test runners.
 */
export class Env {
  /** Returns true if the user agent indicates a mobile smartphone or tablet browser. */
  public static isMobile(): boolean {
    if (typeof navigator === 'undefined') return false;
    const ua = navigator.userAgent || '';
    return /Android|iPhone|iPad|iPod|Mobile/i.test(ua);
  }

  /** Returns true if hardware touch points or touch events are supported. */
  public static isTouchDevice(): boolean {
    if (typeof navigator === 'undefined') return false;
    return (navigator.maxTouchPoints || 0) > 0 || ('ontouchstart' in (typeof window !== 'undefined' ? window : {}));
  }

  /**
   * Retrieves default hardware safe-area cutouts (overridden by ResponsiveLayout via CSS env).
   */
  public static getSafeAreaInsets(): SafeAreaInsets {
    return { top: 0, bottom: 0, left: 0, right: 0 };
  }
}

