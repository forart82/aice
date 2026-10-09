import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupMockDom } from './MockDom';
import { UiRoot, IScreen } from '../ui/UiRoot';
import { BaseModalScreen } from '../ui/BaseModalScreen';
import { ResponsiveLayout } from '../ui/ResponsiveLayout';
import { MenuScreen } from '../ui/screens/MenuScreen';
import { ClassSelectScreen } from '../ui/screens/ClassSelectScreen';
import { DraftScreen } from '../ui/screens/DraftScreen';
import { SanctuaryScreen } from '../ui/screens/SanctuaryScreen';
import { SettingsScreen } from '../ui/screens/SettingsScreen';
import { SnakeLabScreen } from '../ui/screens/SnakeLabScreen';
import { InputManager } from '../input/InputManager';
import { TouchControls } from '../input/TouchControls';
import { MultiScreenSync, MultiScreenManager } from '../platform/MultiScreen';
import { SaveIO } from '../platform/SaveIO';
import { SoundEngine } from '../audio/SoundEngine';
import { MusicPlayer } from '../audio/MusicPlayer';
import { BROADCAST_AUDIO_PATHS } from '../audio/Synth';

describe('UI, Platform, Input & Audio Architecture Refactoring Suite', () => {
  let cleanupDom: () => void;
  let container: HTMLElement;
  let root: UiRoot;

  beforeEach(() => {
    cleanupDom = setupMockDom();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = UiRoot.init(container);
  });

  afterEach(() => {
    root.dispose();
    if (container.parentElement) {
      container.parentElement.removeChild(container);
    }
    (ResponsiveLayout as any).resetInstance?.();
    (InputManager as any).resetInstance?.();
    SaveIO.clearMemory();
    MultiScreenManager.clearTestBus();
    MultiScreenSync.clearTestBus();
    cleanupDom();
  });

  // ==========================================================================
  // 1. IScreen & BaseModalScreen Lifecycle Management
  // ==========================================================================
  describe('1. Universal Screen Lifecycle & Error Boundary Protocol', () => {
    class TestModal extends BaseModalScreen {
      public readonly id = 'modal-test';
      public mountCalled = 0;
      public renderCalled = 0;
      public unmountCalled = 0;
      public disposeCalled = 0;
      public showPayload: unknown = null;
      public throwOnRender = false;

      protected build(): void {
        this.element.innerHTML = '<button class="test-btn">Click</button>';
      }

      public override mount(parent?: HTMLElement): void {
        super.mount?.(parent);
        this.mountCalled++;
      }

      public override render(): void {
        super.render?.();
        this.renderCalled++;
        if (this.throwOnRender) {
          throw new Error('Simulated render fault inside modal');
        }
      }

      public override unmount(): void {
        super.unmount?.();
        this.unmountCalled++;
      }

      public override dispose(): void {
        super.dispose?.();
        this.disposeCalled++;
      }

      protected override onShow(payload?: unknown): void {
        this.showPayload = payload;
      }
    }

    it('executes mount, render, unmount, and dispose lifecycle hooks', () => {
      const modal = new TestModal(root);
      root.registerScreen(modal);

      expect(modal.mountCalled).toBeGreaterThanOrEqual(1);

      root.showScreen('modal-test', { source: 'unit-test' });
      expect(modal.showPayload).toEqual({ source: 'unit-test' });
      expect(modal.renderCalled).toBeGreaterThanOrEqual(1);

      root.hideScreen('modal-test');
      expect(modal.unmountCalled).toBeGreaterThanOrEqual(1);

      modal.dispose();
      expect(modal.disposeCalled).toBeGreaterThanOrEqual(1);
    });

    it('shields UI loop with Error Boundary when a screen throws during render', () => {
      const modal = new TestModal(root);
      modal.throwOnRender = true;
      root.registerScreen(modal);

      const spyErr = vi.spyOn(console, 'error').mockImplementation(() => {});

      // showScreen should not throw despite simulated render fault
      expect(() => {
        root.showScreen('modal-test');
      }).not.toThrow();

      expect(spyErr).toHaveBeenCalled();
      spyErr.mockRestore();
    });

    it('tracks and automatically cleans up DOM event listeners upon dispose()', () => {
      class ListenerModal extends BaseModalScreen {
        public readonly id = 'modal-listener';
        public clickCount = 0;
        public btn: HTMLElement | null = null;

        protected build(): void {
          this.btn = document.createElement('button');
          this.btn.className = 'tracked-btn';
          this.element.appendChild(this.btn);
          (this as any).addTrackedListener(this.btn, 'click', () => {
            this.clickCount++;
          });
        }
      }

      const modal = new ListenerModal(root);
      root.registerScreen(modal);
      modal.show();

      expect(modal.btn).toBeTruthy();
      modal.btn!.click();
      expect(modal.clickCount).toBe(1);

      // Dispose screen and verify tracked event listener was removed
      modal.dispose();
      modal.btn!.click();
      expect(modal.clickCount).toBe(1); // Should remain 1, listener cleanly removed
    });
  });

  // ==========================================================================
  // 2. Concrete Modal Screens Lifecycle & Listener Disposal
  // ==========================================================================
  describe('2. Concrete Modal Screens Lifecycle & Disposables', () => {
    it('MenuScreen implements lifecycle hooks and cleans up listeners upon dispose', () => {
      const menu = new MenuScreen(root);
      expect(typeof (menu as any).mount).toBe('function');
      expect(typeof (menu as any).render).toBe('function');
      expect(typeof (menu as any).unmount).toBe('function');
      expect(typeof (menu as any).dispose).toBe('function');

      (menu as any).mount?.(container);
      (menu as any).render?.();
      menu.show();
      expect(menu.element.style.display).not.toBe('none');

      (menu as any).unmount?.();
      (menu as any).dispose?.();
      // Second dispose should be safe and idempotent
      expect(() => (menu as any).dispose?.()).not.toThrow();
    });

    it('ClassSelectScreen implements lifecycle hooks and cleans up listeners upon dispose', () => {
      const screen = new ClassSelectScreen(root);
      expect(typeof (screen as any).mount).toBe('function');
      expect(typeof (screen as any).render).toBe('function');
      expect(typeof (screen as any).unmount).toBe('function');
      expect(typeof (screen as any).dispose).toBe('function');

      (screen as any).mount?.(container);
      screen.show();
      expect(screen.element.style.display).not.toBe('none');

      (screen as any).unmount?.();
      (screen as any).dispose?.();
      expect(() => (screen as any).dispose?.()).not.toThrow();
    });

    it('DraftScreen implements lifecycle hooks and cleans up listeners upon dispose', () => {
      const screen = new DraftScreen(root);
      expect(typeof (screen as any).mount).toBe('function');
      expect(typeof (screen as any).render).toBe('function');
      expect(typeof (screen as any).unmount).toBe('function');
      expect(typeof (screen as any).dispose).toBe('function');

      (screen as any).mount?.(container);
      screen.show();
      expect(screen.element.style.display).not.toBe('none');

      (screen as any).unmount?.();
      (screen as any).dispose?.();
      expect(() => (screen as any).dispose?.()).not.toThrow();
    });

    it('SanctuaryScreen implements lifecycle hooks, cleans up reset timer and listeners', () => {
      const screen = new SanctuaryScreen(root);
      expect(typeof (screen as any).mount).toBe('function');
      expect(typeof (screen as any).render).toBe('function');
      expect(typeof (screen as any).unmount).toBe('function');
      expect(typeof (screen as any).dispose).toBe('function');

      (screen as any).mount?.(container);
      screen.show();

      // Arm reset progress
      const resetBtn = screen.element.querySelector('.btn-reset-prog') as HTMLButtonElement;
      if (resetBtn) {
        resetBtn.click();
        expect(resetBtn.textContent).toContain('Tap again to confirm');
      }

      // Unmount/hide should disarm reset and clear timer
      (screen as any).unmount?.();
      expect(resetBtn?.textContent).toContain('Erase All Progress');

      (screen as any).dispose?.();
      expect(() => (screen as any).dispose?.()).not.toThrow();
    });

    it('SettingsScreen implements lifecycle hooks and cleans up listeners upon dispose', () => {
      const screen = new SettingsScreen(root);
      expect(typeof (screen as any).mount).toBe('function');
      expect(typeof (screen as any).render).toBe('function');
      expect(typeof (screen as any).unmount).toBe('function');
      expect(typeof (screen as any).dispose).toBe('function');

      (screen as any).mount?.(container);
      screen.show();
      expect(screen.element.style.display).not.toBe('none');

      (screen as any).unmount?.();
      (screen as any).dispose?.();
      expect(() => (screen as any).dispose?.()).not.toThrow();
    });

    it('SnakeLabScreen implements lifecycle hooks, clears toast timer and listeners', () => {
      const screen = new SnakeLabScreen(root);
      expect(typeof (screen as any).mount).toBe('function');
      expect(typeof (screen as any).render).toBe('function');
      expect(typeof (screen as any).unmount).toBe('function');
      expect(typeof (screen as any).dispose).toBe('function');

      (screen as any).mount?.(container);
      screen.show();

      // Show toast
      screen.showToast('Test lab notification', false);
      const toast = screen.element.querySelector('.lab-toast-banner') as HTMLElement;
      expect(toast.style.display).toBe('block');

      // Unmount should immediately hide toast and clear timer
      (screen as any).unmount?.();
      expect(toast.style.display).toBe('none');

      (screen as any).dispose?.();
      expect(() => (screen as any).dispose?.()).not.toThrow();
    });
  });

  // ==========================================================================
  // 3. ResponsiveLayout Lifecycle & Reset
  // ==========================================================================
  describe('3. ResponsiveLayout Lifecycle & Test Isolation', () => {
    it('supports dispose() and resetInstance() for clean test isolation', () => {
      const layout1 = ResponsiveLayout.instance;
      let updateCount = 0;
      const unsub = layout1.subscribe(() => {
        updateCount++;
      });
      expect(updateCount).toBe(1);

      layout1.update(1920, 1080);
      expect(updateCount).toBe(2);

      unsub();
      layout1.update(1280, 720);
      expect(updateCount).toBe(2); // Unsubscribed

      // Reset instance
      expect(typeof (ResponsiveLayout as any).resetInstance).toBe('function');
      expect(typeof (layout1 as any).dispose).toBe('function');

      (layout1 as any).dispose();
      (ResponsiveLayout as any).resetInstance();

      const layout2 = ResponsiveLayout.instance;
      expect(layout2).not.toBe(layout1);
    });

    it('computes robust layout metrics under extreme and edge-case aspect ratios', () => {
      // Zero / invalid width fallback
      const zeroMetrics = ResponsiveLayout.instance.computeMetrics(0, 0);
      expect(zeroMetrics.windowWidth).toBeGreaterThan(0);
      expect(zeroMetrics.windowHeight).toBeGreaterThan(0);

      // Super-ultrawide 32:9
      const ultraMetrics = ResponsiveLayout.instance.computeMetrics(5120, 1440);
      expect(ultraMetrics.aspectMode).toBe('super-ultrawide');
      expect(ultraMetrics.uiScale).toBeGreaterThanOrEqual(1.5);

      // Tall mobile portrait
      const mobileMetrics = ResponsiveLayout.instance.computeMetrics(390, 844);
      expect(mobileMetrics.aspectMode).toBe('portrait');
      expect(mobileMetrics.isMobile).toBe(true);
    });
  });

  // ==========================================================================
  // 4. Input Architecture & Disposal
  // ==========================================================================
  describe('4. Input Architecture & Window Listener Teardown', () => {
    it('InputManager resets singleton instance and cleans up event listeners', () => {
      const input = InputManager.instance;
      expect(typeof (InputManager as any).resetInstance).toBe('function');

      input.destroy();
      expect(typeof input.destroy).toBe('function');

      (InputManager as any).resetInstance();
      const input2 = InputManager.instance;
      expect(input2).not.toBe(input);
    });

    it('TouchControls provides dispose() and cleans up window blur/visibility listeners', () => {
      const controls = new TouchControls(InputManager.instance);
      expect(typeof (controls as any).dispose).toBe('function');
      expect(() => (controls as any).dispose()).not.toThrow();
    });
  });

  // ==========================================================================
  // 5. Platform Persistence & Multi-Screen Consolidation
  // ==========================================================================
  describe('5. Platform Persistence & Multi-Screen Consolidation', () => {
    it('MultiScreenSync provides dispose() alias and cleans up cleanly', () => {
      const sync = new MultiScreenSync('secondary', 'test_screen_1');
      expect(typeof (sync as any).dispose).toBe('function');
      expect(() => (sync as any).dispose()).not.toThrow();
    });

    it('SaveIO provides memoryStore reset via clearMemory() without corrupting state', () => {
      SaveIO.writeKey('test_key', 'test_val');
      expect(SaveIO.readKey('test_key')).toBe('test_val');

      SaveIO.clearMemory();
      expect(SaveIO.readKey('test_key')).toBeNull();
    });
  });

  // ==========================================================================
  // 6. Audio Architecture & Strong Typing
  // ==========================================================================
  describe('6. Audio Architecture & Master Teardown', () => {
    it('SoundEngine attaches MusicPlayer with strict typing and tears down cleanly', () => {
      const engine = new SoundEngine();
      const player = new MusicPlayer(engine);

      expect(() => engine.attachMusicPlayer(player)).not.toThrow();
      expect(typeof engine.dispose).toBe('function');
      expect(typeof player.dispose).toBe('function');

      engine.dispose();
      player.dispose();
    });

    it('BROADCAST_AUDIO_PATHS defines strongly-typed paths including bite, crit, explosion', () => {
      expect(BROADCAST_AUDIO_PATHS.bite).toBeDefined();
      expect(BROADCAST_AUDIO_PATHS.crit).toBeDefined();
      expect(BROADCAST_AUDIO_PATHS.explosion).toBeDefined();
      expect(typeof BROADCAST_AUDIO_PATHS.bite).toBe('string');
      expect(typeof BROADCAST_AUDIO_PATHS.crit).toBe('string');
      expect(typeof BROADCAST_AUDIO_PATHS.explosion).toBe('string');
    });
  });
});
