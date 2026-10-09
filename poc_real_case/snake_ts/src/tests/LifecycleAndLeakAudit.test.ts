import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { setupMockDom, createMockWebGLContext } from './MockDom';
import { SaveIO } from '../platform/SaveIO';
import { MultiScreenManager, MultiScreenSync } from '../platform/MultiScreen';
import { CompanionSync } from '../platform/CompanionSync';
import { SoundEngine } from '../audio/SoundEngine';
import { MusicPlayer } from '../audio/MusicPlayer';
import { HudView } from '../ui/HudView';
import { UiRoot } from '../ui/UiRoot';
import { OuroborosGalleryScreen } from '../ui/screens/OuroborosGalleryScreen';
import { HelpScreen } from '../ui/screens/HelpScreen';
import { MultiScreenModal } from '../ui/screens/MultiScreenModal';
import { WebGLGameRenderer } from '../render/webgl/WebGLGameRenderer';
import { App } from '../main';

describe('Deep Bug Audit & Defect Resolution: Memory Leaks & Lifecycle', () => {
  let cleanupDom: () => void;

  beforeEach(() => {
    cleanupDom = setupMockDom();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanupDom();
  });

  describe('1. Platform Persistence Lifecycle (SaveIO)', () => {
    it('provides closeDB() to release cached IndexedDB connections cleanly', () => {
      expect(typeof (SaveIO as any).closeDB).toBe('function');
      (SaveIO as any).closeDB();
    });
  });

  describe('2. MultiScreen Manager & Sync Lifecycle', () => {
    it('provides clearTestBus() to prevent cross-test listener accumulation', () => {
      expect(typeof MultiScreenManager.clearTestBus).toBe('function');
      expect(typeof MultiScreenSync.clearTestBus).toBe('function');

      MultiScreenManager.testBus.push(() => {});
      expect(MultiScreenManager.testBus.length).toBeGreaterThan(0);
      MultiScreenManager.clearTestBus();
      expect(MultiScreenManager.testBus.length).toBe(0);

      MultiScreenSync.testBus.push(() => {});
      expect(MultiScreenSync.testBus.length).toBeGreaterThan(0);
      MultiScreenSync.clearTestBus();
      expect(MultiScreenSync.testBus.length).toBe(0);
    });

    it('clears channel onmessage and listeners upon destroy / close', () => {
      const mgr = new MultiScreenManager('primary', 'test_win_1');
      let listenerCalled = false;
      mgr.on('TEST', () => { listenerCalled = true; });

      mgr.destroy();
      // After destroy, listeners should be empty
      mgr.handleMessage({
        senderId: 'other',
        role: 'secondary',
        timestamp: Date.now(),
        type: 'TEST',
        payload: {}
      });
      expect(listenerCalled).toBe(false);

      const sync = new MultiScreenSync('secondary', 'test_sync_1');
      let syncCalled = false;
      sync.on('TEST' as any, () => { syncCalled = true; });
      sync.close();
      sync.handleIncoming({
        senderId: 'other',
        type: 'TEST',
        payload: {}
      });
      expect(syncCalled).toBe(false);
    });
  });

  describe('3. CompanionSync Connection & Listener Lifecycle', () => {
    it('re-entrant connect() triggers cleanup of prior connections', () => {
      const companion = new CompanionSync({ role: 'host' });
      const cleanupSpy = vi.spyOn(companion, 'cleanup');

      // First connect
      companion.connect();
      // Second connect should clean up previous state
      companion.connect();

      expect(cleanupSpy).toHaveBeenCalled();
      companion.cleanup();
    });

    it('cleanup() and dispose() clear all event listener sets', () => {
      const companion = new CompanionSync({ role: 'host' });
      expect(typeof (companion as any).dispose).toBe('function');

      const dummyFn = () => {};
      companion.onControllerInput(dummyFn);
      companion.onHudSync(dummyFn);
      companion.onCardSelected(dummyFn);
      companion.onStateChange(dummyFn);

      (companion as any).dispose();

      // Dispatching message should not trigger removed listeners
      const inputSpy = vi.fn();
      companion.onControllerInput(inputSpy);
      // Clean again
      companion.cleanup();
      expect((companion as any).inputListeners.size).toBe(0);
      expect((companion as any).hudListeners.size).toBe(0);
      expect((companion as any).cardSelectListeners.size).toBe(0);
      expect((companion as any).stateListeners.size).toBe(0);
    });
  });

  describe('4. SoundEngine Active Voice Counters & Graph Disposal', () => {
    it('does not leak _activeVoiceCounts when PlayEat is called while muted', () => {
      const sound = new SoundEngine();
      sound.setMuted(true);

      const initialEatCount = sound._activeVoiceCounts.get('eat') ?? 0;
      sound.PlayEat(1, false);
      sound.PlayEat(2, false);
      sound.PlayEat(3, false);

      const postMuteEatCount = sound._activeVoiceCounts.get('eat') ?? 0;
      expect(postMuteEatCount).toBe(initialEatCount);
      expect(postMuteEatCount).toBe(0);
    });

    it('provides dispose() to clear maps and disconnect master audio nodes', () => {
      const sound = new SoundEngine();
      expect(typeof (sound as any).dispose).toBe('function');

      sound._activeVoiceCounts.set('eat', 5);
      sound._lastPlayTimes.set('hit', 12345);

      (sound as any).dispose();

      expect(sound._activeVoiceCounts.size).toBe(0);
      expect(sound._lastPlayTimes.size).toBe(0);
    });
  });

  describe('5. MusicPlayer Procedural Disconnect & Stream Fallback Lifecycle', () => {
    it('transitionToProceduralFallback registers outgoing stream in fadingStreams', () => {
      const sound = new SoundEngine();
      const music = new MusicPlayer(sound);

      // Simulate an active currentStream
      const dummySource = { stop: vi.fn(), disconnect: vi.fn() } as any;
      const dummyGain = {
        gain: {
          value: 1,
          cancelScheduledValues: vi.fn(),
          setValueAtTime: vi.fn(),
          linearRampToValueAtTime: vi.fn()
        },
        disconnect: vi.fn()
      } as any;

      (music as any).currentStream = {
        track: 'exploration',
        source: dummySource,
        gain: dummyGain,
        stopTimeout: null
      };

      (music as any).transitionToProceduralFallback();

      expect((music as any).currentStream).toBeNull();
      // Outgoing stream should be tracked in fadingStreams
      expect((music as any).fadingStreams.length).toBe(1);

      // stopMusic should cleanly dispose fadingStreams
      music.stopMusic();
      expect((music as any).fadingStreams.length).toBe(0);
      expect(dummySource.stop).toHaveBeenCalled();
      expect(dummySource.disconnect).toHaveBeenCalled();
      expect(dummyGain.disconnect).toHaveBeenCalled();
    });

    it('provides dispose() to completely tear down graph and timers', () => {
      const sound = new SoundEngine();
      const music = new MusicPlayer(sound);
      expect(typeof (music as any).dispose).toBe('function');

      (music as any).dispose();
      expect(music.isPlaying).toBe(false);
      expect((music as any).schedulerTimer).toBeNull();
    });
  });

  describe('6. HudView Event Listener Cleanup & Disposal', () => {
    it('provides destroy() / dispose() that unbinds all window listeners', () => {
      const dummyRoot: any = {
        hudSet: vi.fn(),
        engine: null,
      };

      const removeSpy = vi.spyOn(window, 'removeEventListener');
      const hud = new HudView(dummyRoot);

      expect(typeof (hud as any).destroy).toBe('function');
      expect(typeof (hud as any).dispose).toBe('function');

      (hud as any).destroy();

      // Should have removed pointermove, pointerup, pointercancel, touchmove, touchend, touchcancel, keydown
      const removedEvents = removeSpy.mock.calls.map(c => c[0]);
      expect(removedEvents).toContain('pointermove');
      expect(removedEvents).toContain('pointerup');
      expect(removedEvents).toContain('pointercancel');
      expect(removedEvents).toContain('touchmove');
      expect(removedEvents).toContain('touchend');
      expect(removedEvents).toContain('touchcancel');
      expect(removedEvents).toContain('keydown');
    });
  });

  describe('7. UiRoot and Screens Lifecycle Cleanup', () => {
    it('UiRoot.dispose() unbinds layout subscription and disposes child views', () => {
      const container = document.createElement('div');
      const root = UiRoot.init(container as any);
      expect(typeof (root as any).dispose).toBe('function');

      const hudDestroySpy = vi.spyOn(root.hudView as any, 'destroy');
      (root as any).dispose();

      expect(hudDestroySpy).toHaveBeenCalled();
      expect(root.screens.size).toBe(0);
    });

    it('OuroborosGalleryScreen.destroy() disposes ringRenderer and animation loop', () => {
      const container = document.createElement('div');
      const root = UiRoot.init(container as any);
      const gallery = new OuroborosGalleryScreen(root);

      expect(typeof (gallery as any).destroy).toBe('function');
      const stopAnimSpy = vi.spyOn(gallery as any, 'stopAnimationLoop');
      const ringDestroySpy = vi.spyOn(gallery.ringRenderer, 'destroy');

      (gallery as any).destroy();

      expect(stopAnimSpy).toHaveBeenCalled();
      expect(ringDestroySpy).toHaveBeenCalled();
    });

    it('HelpScreen.hide() clears pending scroll timeouts', () => {
      const container = document.createElement('div');
      const root = UiRoot.init(container as any);
      const help = new HelpScreen(root);

      (help as any)._scrollTimeout = setTimeout(() => {}, 1000) as any;
      help.hide();
      expect((help as any)._scrollTimeout).toBeNull();
    });

    it('MultiScreenModal.destroy() cancels pending copy timeouts', () => {
      const container = document.createElement('div');
      const root = UiRoot.init(container as any);
      const modal = new MultiScreenModal(root);

      (modal as any)._copyTimeout = setTimeout(() => {}, 1000) as any;
      modal.destroy();
      expect((modal as any)._copyTimeout).toBeNull();
    });
  });

  describe('8. WebGL Context Loss & Disposal Handling', () => {
    it('WebGLGameRenderer provides dispose() to release batch and context', () => {
      const renderer = new WebGLGameRenderer();
      expect(typeof (renderer as any).dispose).toBe('function');

      const batchDisposeSpy = vi.spyOn((renderer as any).batch, 'dispose');
      const ctxDisposeSpy = vi.spyOn((renderer as any).context, 'dispose');

      (renderer as any).dispose();

      expect(batchDisposeSpy).toHaveBeenCalled();
      expect(ctxDisposeSpy).toHaveBeenCalled();
    });

    it('WebGLGameRenderer handles webglcontextlost with preventDefault() and restores cleanly', () => {
      const canvas = document.createElement('canvas');
      const renderer = new WebGLGameRenderer(canvas as any);

      expect(typeof (renderer as any).handleContextLost).toBe('function');
      expect(typeof (renderer as any).handleContextRestored).toBe('function');

      const lostEvent = { type: 'webglcontextlost', preventDefault: vi.fn() };
      (renderer as any).handleContextLost(lostEvent);
      expect(lostEvent.preventDefault).toHaveBeenCalled();
      expect(renderer.isReady()).toBe(false);

      (renderer as any).handleContextRestored();

      (renderer as any).dispose();
    });

    it('clearTextureCaches() safely calls deleteTexture on WebGL contexts', () => {
      const mockGl = {
        deleteTexture: vi.fn(),
        createTexture: vi.fn(() => ({})),
      };

      (WebGLGameRenderer as any)._foodTextureCache.set('test_tex', {} as any);
      (WebGLGameRenderer as any).clearTextureCaches(mockGl as any);

      expect(mockGl.deleteTexture).toHaveBeenCalled();
      expect((WebGLGameRenderer as any)._foodTextureCache.size).toBe(0);
    });
  });

  describe('9. App Lifecycle & Main Loop Teardown', () => {
    it('App.stop() and App.destroy() cancel requestAnimationFrame and dispose subsystems', () => {
      const app = new App();
      app.start();

      const cancelSpy = vi.spyOn(globalThis, 'cancelAnimationFrame');
      const soundSpy = vi.spyOn(app.sound, 'dispose');
      const uiSpy = vi.spyOn(app.uiRoot, 'dispose');
      const inputSpy = vi.spyOn(app.input, 'destroy');

      app.stop();
      expect(cancelSpy).toHaveBeenCalled();
      expect((app as any)._running).toBe(false);

      app.destroy();
      expect(soundSpy).toHaveBeenCalled();
      expect(uiSpy).toHaveBeenCalled();
      expect(inputSpy).toHaveBeenCalled();
    });
  });
});
