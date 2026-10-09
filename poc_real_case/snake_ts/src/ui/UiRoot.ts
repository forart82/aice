import { ResponsiveLayout, ILayoutMetrics } from './ResponsiveLayout';
import { HudView } from './HudView';
import { InputManager } from '../input/InputManager';

/**
 * ============================================================================
 * OUROBOROS ASCENSION — UI ROOT ORCHESTRATOR & MODAL MANAGER (UiRoot.ts)
 * ============================================================================
 *
 * Central coordinator for the entire DOM UI hierarchy:
 * 1. SCREEN LIFECYCLE & ERROR BOUNDARY ARCHITECTURE:
 *    - Registers and mounts modal screens (`mount()`, `show()`, `render()`, `refresh()`, `hide()`, `unmount()`, `dispose()`).
 *    - All lifecycle calls are wrapped in robust try/catch blocks so modal or rendering
 *      exceptions never propagate into or disrupt the 120Hz game simulation accumulator.
 *
 * 2. NAVIGATION STACK & BACK NAVIGATION:
 *    - Maintains `_navigationStack` for hierarchical screen transitions (e.g. Pause -> Settings -> Help -> return).
 *    - On closing an active screen, automatically pops and reactivates the previous screen.
 *
 * 3. 120Hz CHANGE-CACHING & DOM THRASHING ELIMINATION:
 *    - Fast tick rate updates (HP, Shield, Boss HP, Score, Multiplier) bypass redundant
 *      DOM mutations through string and floating-point quantized caches (`_hudTextCache`, `_hudWidthCache`).
 *    - Sub-pixel float width mutations are rounded to 3 decimal places ($10^{-3}$) before comparison.
 *
 * 4. RESPONSIVE CSS VARIABLES SYNC:
 *    - Dynamically writes safe-area insets (`--safe-left`, `--safe-top`, `--safe-bottom`, `--safe-right`),
 *      HUD typography sizes (`--hud-font`), and scale factors (`--ui-scale`) into `document.documentElement.style`.
 * ============================================================================
 */
export interface IScreen {
  readonly id: string;
  readonly element: HTMLElement;
  show(payload?: unknown): void;
  hide(): void;
  refresh?(): void;
  mount?(container?: HTMLElement): void;
  render?(): void;
  unmount?(): void;
  dispose?(): void;
  destroy?(): void;
}

export class UiRoot {
  private static _instance: UiRoot | null = null;

  public readonly container: HTMLElement;
  public readonly screens: Map<string, IScreen> = new Map();
  public activeScreenId: string | null = null;
  public hudView: HudView;

  // Change-caching to eliminate DOM thrashing
  private _hudTextCache: Map<string, string> = new Map();
  private _hudWidthCache: Map<string, number> = new Map();

  public engine: any = null;
  private _currentMetrics?: ILayoutMetrics;
  private _unsubLayout: (() => void) | null = null;

  public static get instance(): UiRoot {
    if (!UiRoot._instance) {
      throw new Error('UiRoot not initialized. Call UiRoot.init(container) first.');
    }
    return UiRoot._instance;
  }

  public static init(container: HTMLElement, engine?: any): UiRoot {
    UiRoot._instance = new UiRoot(container, engine);
    return UiRoot._instance;
  }

  constructor(container: HTMLElement, engine?: any) {
    this.container = container;
    this.engine = engine;
    if (this.container && this.container.classList && typeof this.container.classList.add === 'function') {
      this.container.classList.add('ui-root-container');
    }

    // Create HUD view
    this.hudView = new HudView(this);
    if (this.container && typeof this.container.appendChild === 'function') {
      this.container.appendChild(this.hudView.element);
    }

    // Subscribe to responsive layout updates
    this._unsubLayout = ResponsiveLayout.instance.subscribe((metrics) => {
      this.applyMetrics(metrics);
    });
  }

  public registerScreen(screen: IScreen): void {
    this.screens.set(screen.id, screen);
    if (screen.element && screen.element.classList && typeof screen.element.classList.add === 'function') {
      screen.element.classList.add('screen-modal');
      screen.element.style.display = 'none';
    }
    if (this.container && typeof this.container.appendChild === 'function' && screen.element) {
      this.container.appendChild(screen.element);
    }
    if (typeof screen.mount === 'function') {
      try {
        screen.mount(this.container);
      } catch (err) {
        console.error(`[UiRoot] Error mounting screen "${screen.id}":`, err);
      }
    }
  }

  /**
   * Resolves modal screen ID aliases and backwards-compatible synonyms
   * (e.g., 'stats' -> 'modal-stats', 'modal-draft' -> 'modal-level-up' fallback).
   */
  private resolveId(id: string): string {
    if (id === 'modal-draft') return this.screens.has('modal-draft') ? 'modal-draft' : 'modal-level-up';
    if (id === 'modal-summary') return this.screens.has('modal-summary') ? 'modal-summary' : (this.screens.has('modal-game-over') ? 'modal-game-over' : 'modal-summary');
    if (id === 'modal-game-over') return this.screens.has('modal-game-over') ? 'modal-game-over' : (this.screens.has('modal-summary') ? 'modal-summary' : 'modal-game-over');
    if (id === 'modal-floor-clear') return this.screens.has('modal-floor-clear') ? 'modal-floor-clear' : (this.screens.has('modal-summary') ? 'modal-summary' : 'modal-floor-clear');
    if (id === 'modal-codex' || id === 'modal-guide') return 'modal-help';
    if (id === 'modal-checklist' || id === 'checklist' || id === 'dev-checklist') return 'modal-dev-checklist';
    if (id === 'modal-pause') return this.screens.has('modal-pause') ? 'modal-pause' : 'modal-settings';
    if (id === 'modal-stats' || id === 'stats' || id === 'modal-records' || id === 'records' || id === 'modal-run-stats' || id === 'run-stats' || id === 'modal-global-stats' || id === 'global-stats') {
      return this.screens.has('modal-stats') ? 'modal-stats' : (this.screens.has('modal-run-stats') ? 'modal-run-stats' : (this.screens.has('modal-records') ? 'modal-records' : 'modal-stats'));
    }
    return id;
  }

  public getScreen<T extends IScreen>(id: string): T | undefined {
    return this.screens.get(this.resolveId(id)) as T | undefined;
  }

  private _navigationStack: string[] = [];

  public get navigationStack(): readonly string[] {
    return this._navigationStack;
  }

  /**
   * Displays a registered modal screen, executing hide on any active screen,
   * pushing previous screen to history stack, and triggering lifecycle hooks within error boundaries.
   *
   * @param rawId Screen ID or alias
   * @param payload Optional initialization or refresh data payload
   * @param pushHistory Whether to store current screen on navigation stack
   */
  public showScreen(rawId: string, payload?: unknown, pushHistory: boolean = true): void {
    const id = this.resolveId(rawId);
    if (this.activeScreenId === id) {
      const active = this.screens.get(id);
      if (active) {
        try {
          if (payload !== undefined) {
            active.show(payload);
          } else if (active.refresh) {
            active.refresh();
          }
          active.render?.();
        } catch (err) {
          console.error(`[UiRoot] Error refreshing active screen "${id}":`, err);
        }
      }
      return;
    }

    const previous = this.activeScreenId;
    if (previous) {
      if (pushHistory && previous !== id) {
        if (this._navigationStack.length === 0 || this._navigationStack[this._navigationStack.length - 1] !== previous) {
          this._navigationStack.push(previous);
        }
      }
      const prevScreen = this.screens.get(previous);
      if (prevScreen) {
        try {
          prevScreen.hide();
          prevScreen.element.style.display = 'none';
          prevScreen.unmount?.();
        } catch (err) {
          console.error(`[UiRoot] Error hiding previous screen "${previous}":`, err);
        }
      }
    }

    let screen = this.screens.get(id);
    if (!screen) {
      const el = typeof document !== 'undefined' ? document.createElement('div') : ({ style: {}, classList: { add: () => {} } } as any);
      el.id = id;
      screen = {
        id,
        element: el,
        show: () => {},
        hide: () => {}
      };
      this.screens.set(id, screen);
    }

    this.activeScreenId = id;
    screen.element.style.display = 'flex';
    try {
      screen.show(payload);
      screen.render?.();
    } catch (err) {
      console.error(`[UiRoot] Error showing/rendering screen "${id}":`, err);
    }
    this.hudView.setInteractive(!this.isModalOpen());
    this.hudView.setTouchControlsVisible(false);
  }

  public hideScreen(id?: string): void {
    const targetId = id ? this.resolveId(id) : this.activeScreenId;
    if (targetId) {
      const screen = this.screens.get(targetId);
      if (screen) {
        try {
          screen.hide();
          screen.element.style.display = 'none';
          screen.unmount?.();
        } catch (err) {
          console.error(`[UiRoot] Error hiding screen "${targetId}":`, err);
        }
      }
      if (this.activeScreenId === targetId) {
        this.activeScreenId = null;
      }
    }

    // Check if there is a screen in the navigation stack to restore
    if (this._navigationStack.length > 0) {
      const prevId = this._navigationStack.pop()!;
      this.showScreen(prevId, undefined, false);
      return;
    }

    this.hudView.setInteractive(!this.isModalOpen());
    const m = this._currentMetrics || ResponsiveLayout.instance.metrics;
    const isTouchActive = m.isTouch || m.isMobile || m.isPortraitHud || (InputManager.instance && InputManager.instance.forceTouchUi);
    this.hudView.setTouchControlsVisible(isTouchActive && !this.isModalOpen());
  }

  public toggleScreen(id: string, payload?: unknown): void {
    if (this.activeScreenId === id) {
      this.hideScreen(id);
    } else {
      this.showScreen(id, payload);
    }
  }

  public closeAllModals(): void {
    this._navigationStack = [];
    for (const [, screen] of this.screens) {
      try {
        screen.hide();
        screen.element.style.display = 'none';
        screen.unmount?.();
      } catch {}
    }
    this.activeScreenId = null;
    this.hudView.setInteractive(!this.isModalOpen());
    const m = this._currentMetrics || ResponsiveLayout.instance.metrics;
    const isTouchActive = m.isTouch || m.isMobile || m.isPortraitHud || (InputManager.instance && InputManager.instance.forceTouchUi);
    this.hudView.setTouchControlsVisible(isTouchActive && !this.isModalOpen());
  }

  public hideModals(): void {
    this.closeAllModals();
  }

  public hideAllScreens(): void {
    this.closeAllModals();
  }

  public isModalOpen(): boolean {
    return this.activeScreenId !== null && this.activeScreenId !== '';
  }

  // ---------------------------------------------------------------- Change Caching

  /**
   * Fast tick rate DOM text update cache.
   * If value matches previous cached string, writes are suppressed entirely,
   * avoiding DOM layout invalidation and style recalcs at 120Hz.
   *
   * @param key Unique HUD element cache identifier
   * @param value String content to display
   * @param writeFn Mutator callback called only on cache miss
   */
  public hudSet(key: string, value: string, writeFn: (v: string) => void): void {
    const prev = this._hudTextCache.get(key);
    if (prev === value) return;
    this._hudTextCache.set(key, value);
    writeFn(value);
  }

  /**
   * Fast tick rate progress bar width update cache with float quantization.
   * Quantizes percentage to 3 decimal places (0.1% resolution) to avoid jittery
   * sub-pixel layout recalculations when width changes by negligible margins.
   *
   * @param key Unique bar cache identifier
   * @param pct Width percentage (0.0 to 100.0)
   * @param writeFn Mutator callback called only on quantized cache miss
   */
  public hudWidth(key: string, pct: number, writeFn: (p: number) => void): void {
    const q = Math.round(pct * 1000) / 1000;
    const prev = this._hudWidthCache.get(key);
    if (prev === q) return;
    this._hudWidthCache.set(key, q);
    writeFn(q);
  }

  /**
   * Invalidate all HUD DOM caches, forcing fresh writes on the next frame.
   */
  public dropHudCache(): void {
    this._hudTextCache.clear();
    this._hudWidthCache.clear();
  }

  // ---------------------------------------------------------------- Layout

  public applyMetrics(metrics: ILayoutMetrics): void {
    this._currentMetrics = metrics;
    if (typeof document !== 'undefined') {
      const root = document.documentElement;
      root.style.setProperty('--ui-scale', `${metrics.uiScale}`);
      root.style.setProperty('--hud-font', `${metrics.hudFont}px`);
      root.style.setProperty('--hud-pad', `${metrics.hudPad}px`);
      root.style.setProperty('--modal-pad', `${metrics.modalPadding}px`);
      root.style.setProperty('--safe-left', `${metrics.safeArea.left}px`);
      root.style.setProperty('--safe-top', `${metrics.safeArea.top}px`);
      root.style.setProperty('--safe-right', `${metrics.safeArea.right}px`);
      root.style.setProperty('--safe-bottom', `${metrics.safeArea.bottom}px`);
    }

    if (this.container && this.container.classList && typeof this.container.classList.toggle === 'function') {
      this.container.classList.toggle('tier-phone', metrics.deviceTier === 'phone');
      this.container.classList.toggle('tier-tablet', metrics.deviceTier === 'tablet');
      this.container.classList.toggle('tier-desktop', metrics.deviceTier === 'desktop');
    }

    this.hudView.applyMetrics(metrics);
  }

  /**
   * Completely disposes layout subscriptions, HUD layer, and all modal screens.
   */
  public dispose(): void {
    if (this._unsubLayout) {
      this._unsubLayout();
      this._unsubLayout = null;
    }
    if (this.hudView) {
      this.hudView.destroy();
    }
    for (const [, screen] of this.screens) {
      if (typeof (screen as any).destroy === 'function') {
        try { (screen as any).destroy(); } catch {}
      } else if (typeof (screen as any).dispose === 'function') {
        try { (screen as any).dispose(); } catch {}
      }
      if (screen.element && screen.element.parentElement) {
        try { screen.element.parentElement.removeChild(screen.element); } catch {}
      }
    }
    this.screens.clear();
    this._navigationStack = [];
    this.dropHudCache();
    if (UiRoot._instance === this) {
      UiRoot._instance = null;
    }
  }

  public destroy(): void {
    this.dispose();
  }
}
