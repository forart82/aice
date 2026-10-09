/**
 * Ouroboros Ascension — BaseModalScreen Architecture (BaseModalScreen.ts)
 *
 * Abstract base class providing a uniform glassmorphic modal lifecycle, DOM encapsulation,
 * error boundary protection, tracked event listener disposal, and responsive shell composition.
 *
 * Lifecycle State Machine & Execution Protocol:
 * ```
 *   [Instantiated]
 *         │
 *         ├─► mount(parent) ──► calls onMount(parent) [DOM attachment]
 *         │
 *         ├─► show(payload) ──► builds DOM if empty, sets display: 'flex',
 *         │         │           calls onShow(payload), refresh(), and render()
 *         │         ▼
 *         ├─► render()      ──► calls onRender() [dynamic visual synchronizer]
 *         │         ▲
 *         │         │ (re-render / telemetry updates)
 *         │         ▼
 *         ├─► refresh()     ──► calls onRefresh() [data model polling]
 *         │
 *         ├─► hide()        ──► sets display: 'none', calls onHide(), unmount()
 *         │
 *         ├─► unmount()     ──► calls onUnmount() [view deactivation]
 *         │
 *         └─► dispose()     ──► pops & flushes all _disposables, calls onDispose(),
 *                               detaches container element from DOM [memory leak prevention]
 * ```
 *
 * Error Boundary Protection Guarantees:
 * Every public lifecycle method (`mount`, `render`, `unmount`, `show`, `hide`, `refresh`, `dispose`, `destroy`)
 * is wrapped in an explicit try/catch boundary. Any runtime faults inside subclass hooks are caught,
 * logged with the modal ID, and strictly isolated so that modal errors can NEVER crash the 120 Hz game loop.
 *
 * Tracked Event Disposables:
 * `addTrackedListener()` records active DOM event listeners and automatically removes them upon `dispose()`.
 */

import { IScreen, UiRoot } from './UiRoot';
import { Widgets } from './Widgets';

export interface IModalShellComponents {
  panel: HTMLElement;
  header: HTMLElement;
  titleEl: HTMLElement;
  subtitleEl?: HTMLElement;
  content: HTMLElement;
  actions: HTMLElement;
}

export abstract class BaseModalScreen implements IScreen {
  public abstract readonly id: string;
  public readonly element: HTMLElement;
  public readonly root: UiRoot;

  protected readonly _disposables: Array<() => void> = [];

  /**
   * Constructs the base modal container with standardized overlay classes and triggers `build()`.
   * @param root The parent UiRoot instance managing modal navigation stacks and HUD visibility.
   * @param customOverlayClass Optional additional CSS class for custom backdrop styling.
   */
  constructor(root: UiRoot, customOverlayClass?: string) {
    this.root = root;
    if (typeof document !== 'undefined') {
      this.element = document.createElement('div');
      this.element.className = customOverlayClass
        ? `modal-overlay ${customOverlayClass}`
        : 'modal-overlay';
    } else {
      this.element = {
        style: {},
        classList: { add: () => {} },
        children: [],
        appendChild: () => {},
        removeChild: () => {}
      } as unknown as HTMLElement;
    }
  }

  /**
   * Abstract UI builder executed to construct the modal's DOM tree.
   */
  protected abstract build(): void;

  /**
   * Registers a DOM event listener that is tracked and automatically removed upon `dispose()`.
   * Prevents dangling event listener memory leaks across screen transitions.
   */
  public addTrackedListener(
    target: EventTarget,
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions
  ): () => void {
    if (!target || typeof target.addEventListener !== 'function') {
      return () => {};
    }
    target.addEventListener(type, listener, options);
    const cleanup = () => {
      try {
        target.removeEventListener(type, listener, options);
      } catch {}
    };
    this._disposables.push(cleanup);
    return cleanup;
  }

  /**
   * Registers an arbitrary teardown or cleanup callback to be executed upon `dispose()`.
   */
  public registerDisposable(cleanup: () => void): () => void {
    this._disposables.push(cleanup);
    return cleanup;
  }

  /**
   * Standardized helper to create a complete cybernetic glass panel shell with header,
   * content container, and actions row.
   *
   * @param title Main modal header title text (cyber-modal-title).
   * @param subtitle Optional explanatory subtitle text (cyber-modal-subtitle).
   * @param maxWidth Max pixel width of the glass panel (default: 580px).
   * @param extraPanelClass Additional CSS class applied to the panel container.
   */
  protected createModalShell(
    title: string,
    subtitle?: string,
    maxWidth: number = 580,
    extraPanelClass?: string
  ): IModalShellComponents {
    const panel = Widgets.createGlassPanel(maxWidth, extraPanelClass);

    // Header with cybernetic glow typography
    const { container: header, titleEl, subtitleEl } = Widgets.createModalHeader(
      title,
      subtitle
    );
    panel.appendChild(header);

    // Scrollable / flex content container
    const content = document.createElement('div');
    content.className = 'modal-content-area';
    panel.appendChild(content);

    // Actions button row docked to the bottom
    const actions = Widgets.createActionsRow();
    panel.appendChild(actions);

    return { panel, header, titleEl, subtitleEl, content, actions };
  }

  /**
   * Mounts the modal container element into the designated parent container.
   */
  public mount(parent?: HTMLElement): void {
    try {
      if (parent && this.element && !this.element.parentElement && typeof parent.appendChild === 'function') {
        parent.appendChild(this.element);
      }
      this.onMount(parent);
    } catch (err) {
      console.error(`[BaseModalScreen] Error mounting modal "${this.id}":`, err);
    }
  }

  /**
   * Renders or re-renders visual dynamic elements within the modal.
   */
  public render(): void {
    try {
      this.onRender();
    } catch (err) {
      console.error(`[BaseModalScreen] Error rendering modal "${this.id}":`, err);
    }
  }

  /**
   * Unmounts or deactivates the modal view.
   */
  public unmount(): void {
    try {
      this.onUnmount();
    } catch (err) {
      console.error(`[BaseModalScreen] Error unmounting modal "${this.id}":`, err);
    }
  }

  /**
   * Displays the modal overlay, passes invocation payload to `onShow()`, and refreshes content.
   * Shielded by robust error boundary protection.
   */
  public show(payload?: unknown): void {
    try {
      if (this.element && (!this.element.children || this.element.children.length === 0)) {
        this.build();
      }
      if (this.element && this.element.style) {
        this.element.style.display = 'flex';
      }
      this.onShow(payload);
      this.refresh();
      this.render();
    } catch (err) {
      console.error(`[BaseModalScreen] Error showing modal "${this.id}":`, err);
    }
  }

  /**
   * Hides the modal overlay and invokes the `onHide()` cleanup hook.
   */
  public hide(): void {
    try {
      if (this.element && this.element.style) {
        this.element.style.display = 'none';
      }
      this.onHide();
      this.unmount();
    } catch (err) {
      console.error(`[BaseModalScreen] Error hiding modal "${this.id}":`, err);
    }
  }

  /**
   * Refreshes real-time telemetry, progression stats, or interactive inputs.
   */
  public refresh(): void {
    try {
      this.onRefresh();
    } catch (err) {
      console.error(`[BaseModalScreen] Error refreshing modal "${this.id}":`, err);
    }
  }

  /**
   * Cleanly disposes all tracked event listeners, timers, and detached DOM nodes.
   */
  public dispose(): void {
    try {
      while (this._disposables.length > 0) {
        const cleanup = this._disposables.pop()!;
        try {
          cleanup();
        } catch {}
      }
      this.onDispose();
      if (this.element && this.element.parentElement) {
        this.element.parentElement.removeChild(this.element);
      }
    } catch (err) {
      console.error(`[BaseModalScreen] Error disposing modal "${this.id}":`, err);
    }
  }

  public destroy(): void {
    this.dispose();
  }

  // --- Subclass Lifecycle Extension Hooks ---

  protected onMount(parent?: HTMLElement): void {
    // Override in subclass
  }

  protected onRender(): void {
    // Override in subclass
  }

  protected onUnmount(): void {
    // Override in subclass
  }

  protected onDispose(): void {
    // Override in subclass
  }

  protected onShow(payload?: unknown): void {
    // Override in subclass
  }

  protected onHide(): void {
    // Override in subclass
  }

  protected onRefresh(): void {
    // Override in subclass
  }
}
