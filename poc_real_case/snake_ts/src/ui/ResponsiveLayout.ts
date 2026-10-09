import { Vec2 } from '../core/Vec2';
import { MathX } from '../core/MathX';

export interface ISafeAreaInsets {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export type AspectMode = 'super-ultrawide' | 'ultrawide' | 'landscape' | 'short-landscape' | 'portrait' | 'square';
export type DeviceTier = 'phone' | 'tablet' | 'desktop';

export interface IRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ITouchControlsLayout {
  area: IRect;
  dashPadX: number;
  dashPadY: number;
  skillPadX: number;
  skillPadY: number;
  pausePadX: number;
  pausePadY: number;
  btnSize: number;
  stickBounds: IRect;
  actionBounds: IRect;
}

export interface ILayoutMetrics {
  windowWidth: number;
  windowHeight: number;
  dpr: number;
  uiScale: number;
  logicalWidth: number;
  logicalHeight: number;
  aspect: number;
  aspectMode: AspectMode;
  deviceTier: DeviceTier;
  isTouch: boolean;
  isMobile: boolean;
  isPortraitHud: boolean;
  safeArea: ISafeAreaInsets;
  hudFont: number;
  hudPad: number;
  modalPadding: number;
  gameViewport: {
    x: number;
    y: number;
    width: number;
    height: number;
    scale: number;
  };
  touchControls: ITouchControlsLayout;
}

export class ResponsiveLayout {
  private static _instance: ResponsiveLayout | null = null;

  public metrics: ILayoutMetrics;
  private _listeners: Array<(metrics: ILayoutMetrics) => void> = [];

  public static get instance(): ResponsiveLayout {
    if (!ResponsiveLayout._instance) {
      ResponsiveLayout._instance = new ResponsiveLayout();
    }
    return ResponsiveLayout._instance;
  }

  public static resetInstance(): void {
    if (ResponsiveLayout._instance) {
      ResponsiveLayout._instance.dispose();
      ResponsiveLayout._instance = null;
    }
  }

  constructor() {
    const initW = typeof window !== 'undefined' && Number.isFinite(window.innerWidth) && window.innerWidth > 0 ? window.innerWidth : 1280;
    const initH = typeof window !== 'undefined' && Number.isFinite(window.innerHeight) && window.innerHeight > 0 ? window.innerHeight : 720;
    this.metrics = this.computeMetrics(initW, initH);

    if (typeof window !== 'undefined') {
      window.addEventListener('resize', this.onResize);
      window.addEventListener('orientationchange', this.onResize);
    }
  }

  public dispose(): void {
    if (typeof window !== 'undefined') {
      window.removeEventListener('resize', this.onResize);
      window.removeEventListener('orientationchange', this.onResize);
    }
    this._listeners = [];
  }

  public subscribe(fn: (metrics: ILayoutMetrics) => void): () => void {
    this._listeners.push(fn);
    fn(this.metrics);
    return () => {
      const idx = this._listeners.indexOf(fn);
      if (idx !== -1) this._listeners.splice(idx, 1);
    };
  }

  private onResize = (): void => {
    if (typeof window === 'undefined') return;
    this.update(window.innerWidth, window.innerHeight);
    if (typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(() => {
        if (typeof window !== 'undefined') {
          this.update(window.innerWidth, window.innerHeight);
        }
      });
    }
  };

  public update(windowWidth: number, windowHeight: number): ILayoutMetrics {
    this.metrics = this.computeMetrics(windowWidth, windowHeight);
    for (let i = 0; i < this._listeners.length; i++) {
      this._listeners[i]!(this.metrics);
    }
    return this.metrics;
  }

  /**
   * Computes dynamic UI scale factor $s \in [0.60, 3.05]$ based on window dimensions or Vec2.
   *
   * Mathematical Scaling Curves & Piecewise Formulations:
   *
   * 1. Mobile Portrait Orientation ($H > W$):
   *    - Compact screen ($W \le 340\text{px}$, e.g. 320x480): $s = 0.80$
   *    - Tall mobile ($W \le 370\text{px}$, e.g. 360x780):   $s = 0.95$
   *    - Standard flagship ($W \le 430\text{px}$, iPhone):  $s = 1.00$
   *    - Tablet portrait ($W > 768\text{px}$):              $s = \min\left(1.40, \frac{W}{768}\right)$
   *
   * 2. Desktop & Landscape Orientations ($W \ge H$):
   *    - Short landscape ($H \le 400\text{px}$, mobile landscape): $s = 0.65$
   *    - Compact landscape ($H \le 480\text{px}$):                 $s = 0.75$
   *    - 4:3 Aspect iPad / CRT ($1024 \times 768$):               $s = 1.00$
   *    - 16:9 720p HD Reference ($1280 \times 720$):              $s = 1.00$ (Unit baseline)
   *    - 1080p FHD ($W \ge 1920\text{px}$):                       $s = 1.50$
   *    - 1440p QHD ($W \ge 2560\text{px}$):                       $s = 1.85$
   *    - 21:9 Ultrawide ($2560 \times 1080$):                     $s = 1.50$
   *    - 32:9 Super-Ultrawide ($5120 \times 1440$):               $s = 2.00$
   *    - 4K Ultra HD ($W \ge 3840\text{px}$ or $H \ge 2160\text{px}$): $s = 3.00$
   *
   * Final bounding clamp: $s = \text{clamp}(s, 0.60, 3.05)$
   *
   * @param sizeOrWidth Window width or Vec2 dimension vector
   * @param height Optional window height in pixels
   * @returns Clamped scalar UI scale multiplier
   */
  public static computeUiScale(sizeOrWidth: { x: number; y: number } | Vec2 | number, height?: number): number {
    let w: number;
    let h: number;
    if (typeof sizeOrWidth === 'object' && sizeOrWidth !== null) {
      w = sizeOrWidth.x;
      h = sizeOrWidth.y;
    } else {
      w = sizeOrWidth;
      h = height ?? 720;
    }

    w = Number.isFinite(w) && w > 0 ? w : 1280;
    h = Number.isFinite(h) && h > 0 ? h : 720;

    const isPortrait = h > w;

    let scale = 1.0;

    if (isPortrait) {
      // Mobile portrait mode
      if (w <= 340) scale = 0.80;       // 320x480 compact mobile
      else if (w <= 370) scale = 0.95;  // 360x780 tall mobile
      else if (w <= 430) scale = 1.00;  // 390x844 iPhone 12/13/14
      else if (w <= 600) scale = 1.00;
      else if (w <= 768) scale = 1.05;
      else scale = Math.min(1.4, w / 768);
    } else {
      // Landscape mode
      if (h <= 400) scale = 0.65;       // 844x390 short mobile landscape
      else if (h <= 480) scale = 0.75;  // compact landscape
      else if (w === 1024 && h === 768) scale = 1.00; // 4:3 iPad / CRT
      else if (w === 1280 && h === 720) scale = 1.00; // 16:9 720p HD Reference
      else if (w >= 3840 || h >= 2160) scale = 3.00;  // 4K Ultra HD
      else if (w >= 5120 && h === 1440) scale = 2.00; // 32:9 Super-Ultrawide
      else if (w >= 2560 && h === 1080) scale = 1.50; // 21:9 1080p Ultrawide
      else if (w >= 2560 || h >= 1440) scale = 1.85;  // 1440p
      else if (w >= 1920) scale = 1.50;               // 1080p FHD
      else if (w <= 1024) scale = 0.90;
      else scale = 1.0;
    }

    return MathX.clamp(scale, 0.60, 3.05);
  }

  /**
   * Identifies if a given resolution requires a stacked / portrait HUD configuration.
   */
  public static isPortraitHud(vw: number, vh: number): boolean {
    if (!Number.isFinite(vw) || !Number.isFinite(vh) || vh <= 0) return false;
    return vw <= 740 || (vw / vh < 1.25) || (vh <= 440);
  }

  /**
   * Computes non-overlapping touch controls docking and thumb bounding regions.
   */
  public static layoutTouchControls(
    space: Vec2 | { x: number; y: number } | { width: number; height: number },
    insets?: ISafeAreaInsets,
    isLefty = false,
    placement: 'bottom-center' | 'corner' = 'corner'
  ): ITouchControlsLayout {
    let rawW = 'width' in space ? space.width : 'x' in space ? space.x : 1280;
    let rawH = 'height' in space ? space.height : 'y' in space ? space.y : 720;
    const w = Number.isFinite(rawW) && rawW > 0 ? rawW : 1280;
    const h = Number.isFinite(rawH) && rawH > 0 ? rawH : 720;

    const safe: ISafeAreaInsets = {
      left: Number.isFinite(insets?.left) && (insets!.left >= 0) ? insets!.left : 0,
      top: Number.isFinite(insets?.top) && (insets!.top >= 0) ? insets!.top : 0,
      right: Number.isFinite(insets?.right) && (insets!.right >= 0) ? insets!.right : 0,
      bottom: Number.isFinite(insets?.bottom) && (insets!.bottom >= 0) ? insets!.bottom : 0,
    };

    const btnSize = Math.max(64, Math.min(84, Math.floor(h * 0.12)));
    const btnGap = 16;
    const margin = 20;

    // Action button positions
    let dashPadX: number;
    let skillPadX: number;
    let pausePadX: number;

    const baseY = h - margin - safe.bottom - btnSize * 0.5;
    const pauseSize = 52;
    const pauseY = margin + safe.top + pauseSize * 0.5;

    pausePadX = isLefty ? margin + safe.left + pauseSize * 0.5 : w - margin - safe.right - pauseSize * 0.5;

    if (placement === 'bottom-center') {
      const centerX = w * 0.5;
      const halfGap = btnGap * 0.5;
      const halfBtn = btnSize * 0.5;
      if (isLefty) {
        dashPadX = centerX - halfGap - halfBtn;
        skillPadX = centerX + halfGap + halfBtn;
      } else {
        skillPadX = centerX - halfGap - halfBtn;
        dashPadX = centerX + halfGap + halfBtn;
      }

      const stickBounds: IRect = { x: 0, y: 0, width: w, height: h };
      const actionBounds: IRect = {
        x: centerX - btnSize - btnGap,
        y: baseY - btnSize * 0.5,
        width: btnSize * 2 + btnGap * 2,
        height: btnSize + margin + safe.bottom,
      };

      return {
        area: { x: 0, y: 0, width: w, height: h },
        dashPadX,
        dashPadY: baseY,
        skillPadX,
        skillPadY: baseY,
        pausePadX,
        pausePadY: pauseY,
        btnSize,
        stickBounds,
        actionBounds,
      };
    } else {
      if (isLefty) {
        dashPadX = w - margin - safe.right - btnSize * 0.5;
        skillPadX = dashPadX - btnSize - btnGap;
      } else {
        skillPadX = margin + safe.left + btnSize * 0.5;
        dashPadX = skillPadX + btnSize + btnGap;
      }

      const stickBounds: IRect = isLefty
        ? { x: safe.left, y: h * 0.35, width: w * 0.45, height: h * 0.65 }
        : { x: w * 0.55, y: h * 0.35, width: w * 0.45, height: h * 0.65 };

      const actionBounds: IRect = isLefty
        ? { x: w * 0.55, y: h * 0.35, width: w * 0.45, height: h * 0.65 }
        : { x: safe.left, y: h * 0.35, width: w * 0.45, height: h * 0.65 };

      return {
        area: { x: 0, y: 0, width: w, height: h },
        dashPadX,
        dashPadY: baseY,
        skillPadX,
        skillPadY: baseY,
        pausePadX,
        pausePadY: pauseY,
        btnSize,
        stickBounds,
        actionBounds,
      };
    }
  }

  public static getRawSafeArea(): ISafeAreaInsets {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      return { left: 0, top: 0, right: 0, bottom: 0 };
    }
    const root = document.documentElement;
    const computed = window.getComputedStyle(root);
    const parseEnv = (name: string) => {
      const v = computed.getPropertyValue(name).trim();
      return parseFloat(v) || 0;
    };

    return {
      top: parseEnv('--sat') || parseEnv('safe-area-inset-top') || 0,
      bottom: parseEnv('--sab') || parseEnv('safe-area-inset-bottom') || 0,
      left: parseEnv('--sal') || parseEnv('safe-area-inset-left') || 0,
      right: parseEnv('--sar') || parseEnv('safe-area-inset-right') || 0,
    };
  }

  public computeMetrics(windowWidth: number, windowHeight: number): ILayoutMetrics {
    const rawW = Number.isFinite(windowWidth) && windowWidth > 0 ? windowWidth : 1280;
    const rawH = Number.isFinite(windowHeight) && windowHeight > 0 ? windowHeight : 720;
    const w = Math.max(1, rawW);
    const h = Math.max(1, rawH);
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    const isTouch = (typeof window !== 'undefined' ? ('ontouchstart' in window || (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0)) : false) || (w <= 768 || (w / h < 1.05));
    const aspect = w / h;

    let deviceTier: DeviceTier = 'desktop';
    const minDim = Math.min(w, h);
    const maxDim = Math.max(w, h);
    if (minDim <= 500 || (w <= 600 && aspect < 1.0) || (h <= 500 && w <= 960)) {
      deviceTier = 'phone';
    } else if (minDim <= 1024 && maxDim <= 1366 && (isTouch || w <= 1180)) {
      deviceTier = 'tablet';
    } else {
      deviceTier = 'desktop';
    }

    const isMobile = w <= 768 || (isTouch && h <= 500) || deviceTier === 'phone';

    const uiScale = ResponsiveLayout.computeUiScale(w, h);
    const logicalWidth = w / uiScale;
    const logicalHeight = h / uiScale;

    let aspectMode: AspectMode = 'landscape';
    if (aspect < 1.0) aspectMode = 'portrait';
    else if (h <= 440) aspectMode = 'short-landscape';
    else if (aspect >= 3.0) aspectMode = 'super-ultrawide';
    else if (aspect >= 2.0) aspectMode = 'ultrawide';
    else if (Math.abs(aspect - 1.0) < 0.15) aspectMode = 'square';

    const rawSafe = ResponsiveLayout.getRawSafeArea();
    const safeArea: ISafeAreaInsets = {
      left: rawSafe.left / uiScale,
      top: rawSafe.top / uiScale,
      right: rawSafe.right / uiScale,
      bottom: rawSafe.bottom / uiScale,
    };

    const isPortraitHud = ResponsiveLayout.isPortraitHud(w, h);

    // HUD Fluid typography and paddings
    const hudFont = MathX.clamp(
      aspectMode === 'short-landscape' ? 10.5 : isMobile ? 11 : Math.round(12 + (logicalWidth - 960) * 0.003),
      10,
      16
    );

    const hudPad = MathX.clamp(
      isMobile ? 10 : aspectMode === 'super-ultrawide' ? 32 : aspectMode === 'ultrawide' ? 24 : 16,
      8,
      36
    );

    const modalPadding = MathX.clamp(
      isMobile ? 12 : 24,
      10,
      36
    );

    // Calculate game arena viewport fitting (default arena target is 1200x800)
    const arenaBaseW = 1200;
    const arenaBaseH = 800;
    const scaleX = logicalWidth / arenaBaseW;
    const scaleY = logicalHeight / arenaBaseH;
    const gameScale = Math.min(scaleX, scaleY);

    const gameVpWidth = arenaBaseW * gameScale;
    const gameVpHeight = arenaBaseH * gameScale;
    const gameVpX = (logicalWidth - gameVpWidth) * 0.5;
    const gameVpY = (logicalHeight - gameVpHeight) * 0.5;

    const touchControls = ResponsiveLayout.layoutTouchControls(
      new Vec2(logicalWidth, logicalHeight),
      safeArea
    );

    return {
      windowWidth: w,
      windowHeight: h,
      dpr,
      uiScale,
      logicalWidth,
      logicalHeight,
      aspect,
      aspectMode,
      deviceTier,
      isTouch,
      isMobile,
      isPortraitHud,
      safeArea,
      hudFont,
      hudPad,
      modalPadding,
      gameViewport: {
        x: gameVpX,
        y: gameVpY,
        width: gameVpWidth,
        height: gameVpHeight,
        scale: gameScale,
      },
      touchControls,
    };
  }

  /**
   * Helper to dock UI elements to anchor points with safe area compensation.
   */
  public getAnchorPos(
    anchor: 'top-left' | 'top-center' | 'top-right' | 'bottom-left' | 'bottom-center' | 'bottom-right' | 'center',
    margin: number = 0
  ): Vec2 {
    const m = this.metrics;
    const pad = m.hudPad + margin;

    switch (anchor) {
      case 'top-left':
        return new Vec2(m.safeArea.left + pad, m.safeArea.top + pad);
      case 'top-center':
        return new Vec2(m.logicalWidth * 0.5, m.safeArea.top + pad);
      case 'top-right':
        return new Vec2(m.logicalWidth - m.safeArea.right - pad, m.safeArea.top + pad);
      case 'bottom-left':
        return new Vec2(m.safeArea.left + pad, m.logicalHeight - m.safeArea.bottom - pad);
      case 'bottom-center':
        return new Vec2(m.logicalWidth * 0.5, m.logicalHeight - m.safeArea.bottom - pad);
      case 'bottom-right':
        return new Vec2(m.logicalWidth - m.safeArea.right - pad, m.logicalHeight - m.safeArea.bottom - pad);
      case 'center':
        return new Vec2(m.logicalWidth * 0.5, m.logicalHeight * 0.5);
      default:
        return new Vec2(m.logicalWidth * 0.5, m.logicalHeight * 0.5);
    }
  }

  /**
   * Helper to set override metrics for unit and integration testing.
   */
  public setMetricsForTesting(metrics: Partial<ILayoutMetrics>): void {
    this.metrics = { ...this.metrics, ...metrics } as ILayoutMetrics;
    for (const listener of this._listeners) {
      listener(this.metrics);
    }
  }
}
