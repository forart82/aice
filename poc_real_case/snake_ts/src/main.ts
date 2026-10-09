import { WebGLGameRenderer } from './render/WebGLGameRenderer';
import { FxManager } from './render/FxManager';
import { GameEngine } from './sim/GameEngine';
import { InputManager } from './input/InputManager';
import { SoundEngine } from './audio/SoundEngine';
import { unlockAudioContext } from './audio/Synth';
import { MetaProgression } from './data/MetaProgression';
import { Services } from './core/Services';
import { ResponsiveLayout } from './ui/ResponsiveLayout';
import { UiRoot } from './ui/UiRoot';
import { GameRenderer } from './render/GameRenderer';
import { VisualParityHarness } from './render/VisualParityHarness';

// Screens
import { MenuScreen } from './ui/screens/MenuScreen';
import { ClassSelectScreen } from './ui/screens/ClassSelectScreen';
import { DraftScreen } from './ui/screens/DraftScreen';
import { RunSummaryScreen } from './ui/screens/RunSummaryScreen';
import { GameOverScreen } from './ui/screens/GameOverScreen';
import { FloorClearScreen } from './ui/screens/FloorClearScreen';
import { SanctuaryScreen } from './ui/screens/SanctuaryScreen';
import { SettingsScreen } from './ui/screens/SettingsScreen';
import { PauseSettingsScreen } from './ui/screens/PauseSettingsScreen';
import { SnakeLabScreen } from './ui/screens/SnakeLabScreen';
import { MultiScreenModal } from './ui/screens/MultiScreenModal';
import { HelpScreen } from './ui/screens/HelpScreen';
import { DevChecklistScreen } from './ui/screens/DevChecklistScreen';
import { StatsModalScreen } from './ui/screens/StatsModalScreen';
import { OuroborosGalleryScreen } from './ui/screens/OuroborosGalleryScreen';

export class App {
  public canvas: HTMLCanvasElement;
  public webglRenderer: WebGLGameRenderer | null = null;
  public engine: GameEngine;
  public input: InputManager;
  public sound: SoundEngine;
  public fx: FxManager;
  public uiRoot: UiRoot;
  public layout: ResponsiveLayout;

  private _lastTime: number = performance.now();
  private _running: boolean = false;
  private _animFrameId: number | null = null;

  constructor() {
    // 1. Get or create DOM elements
    if (typeof document !== 'undefined' && typeof document.getElementById === 'function') {
      this.canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
    } else {
      this.canvas = null as any;
    }

    if (!this.canvas && typeof document !== 'undefined' && typeof document.createElement === 'function') {
      this.canvas = document.createElement('canvas');
      this.canvas.id = 'game-canvas';
      if (document.body && typeof document.body.appendChild === 'function') {
        document.body.appendChild(this.canvas);
      }
    }

    let uiContainer: any = null;
    if (typeof document !== 'undefined' && typeof document.getElementById === 'function') {
      uiContainer = document.getElementById('ui-root');
    }
    if (!uiContainer && typeof document !== 'undefined' && typeof document.createElement === 'function') {
      uiContainer = document.createElement('div');
      uiContainer.id = 'ui-root';
      if (document.body && typeof document.body.appendChild === 'function') {
        document.body.appendChild(uiContainer);
      }
    }

    // 2. Services Initialization
    this.sound = new SoundEngine();
    this.sound.init();
    Services.Sound = this.sound;
    this.hookAudioUnlock();

    this.fx = new FxManager();
    Services.Fx = this.fx;

    Services.registerMetaProvider(() => MetaProgression.instance);

    // 3. Engine & Render pipeline (Hardware-Accelerated Pure WebGL 2.0 Engine - Canvas2D Banished)
    this.webglRenderer = WebGLGameRenderer.create(this.canvas);
    if (this.webglRenderer && this.webglRenderer.isReady()) {
      console.log('🚀 [RENDERER] Active Graphics Pipeline: Pure WebGL 2.0 (Hardware Accelerated)');
    } else {
      console.error('❌ [RENDERER] WebGL 2.0 Context Unavailable: Hardware acceleration or WebGL 2.0 support required.');
      this.renderWebGLErrorModal(uiContainer);
    }

    this.engine = new GameEngine(this.fx);
    this.input = InputManager.instance;
    Services.Input = this.input;

    // 4. Responsive Layout & UI Root
    this.layout = ResponsiveLayout.instance;
    this.uiRoot = UiRoot.init(uiContainer, this.engine);
    this.engine.setUiRoot(this.uiRoot);

    // 5. Register Screens
    this.uiRoot.registerScreen(new MenuScreen(this.uiRoot));
    this.uiRoot.registerScreen(new ClassSelectScreen(this.uiRoot));
    this.uiRoot.registerScreen(new DraftScreen(this.uiRoot));
    this.uiRoot.registerScreen(new RunSummaryScreen(this.uiRoot));
    this.uiRoot.registerScreen(new GameOverScreen(this.uiRoot));
    this.uiRoot.registerScreen(new FloorClearScreen(this.uiRoot));
    this.uiRoot.registerScreen(new SanctuaryScreen(this.uiRoot));
    this.uiRoot.registerScreen(new SettingsScreen(this.uiRoot));
    this.uiRoot.registerScreen(new PauseSettingsScreen(this.uiRoot));
    this.uiRoot.registerScreen(new SnakeLabScreen(this.uiRoot));
    this.uiRoot.registerScreen(new MultiScreenModal(this.uiRoot));
    this.uiRoot.registerScreen(new HelpScreen(this.uiRoot));
    this.uiRoot.registerScreen(new DevChecklistScreen(this.uiRoot));
    this.uiRoot.registerScreen(new StatsModalScreen(this.uiRoot));
    this.uiRoot.registerScreen(new OuroborosGalleryScreen(this.uiRoot));

    // 6. Handle layout resize
    this.layout.subscribe((metrics) => {
      if (this.webglRenderer) {
        this.webglRenderer.resize(metrics.logicalWidth, metrics.logicalHeight);
      }
      this.engine.arenaW = metrics.logicalWidth;
      this.engine.arenaH = metrics.logicalHeight;
      this.engine.backdrop.invalidate();
      GameRenderer.backdrop.invalidate();
    });

    // Initial canvas sizing
    const metrics = this.layout.metrics;
    if (this.webglRenderer) {
      this.webglRenderer.resize(metrics.logicalWidth, metrics.logicalHeight);
    }
    this.engine.arenaW = metrics.logicalWidth;
    this.engine.arenaH = metrics.logicalHeight;

    // 7. Initial Screen routing from URL params
    const search = typeof window !== 'undefined' ? window.location.search : '';
    const params = new URLSearchParams(search);
    const sceneParam = params.get('scene');
    const screenParam = params.get('screen');
    const isBotParam = params.get('bot') === 'true' || params.get('autoplay') === 'true' || params.get('spectate') === 'true';

    if (sceneParam) {
      VisualParityHarness.setupScene(this, sceneParam);
    } else if (isBotParam) {
      if (this.sound) this.sound.init();
      this.engine.chooseMode('rogue');
      this.engine.selectedClass = params.get('class') || 'emerald';
      this.engine.isBotEnabled = true;
      this.engine.startRun();
    } else if (screenParam === 'combat') {
      if (this.sound) this.sound.init();
      this.engine.chooseMode('rogue');
      this.engine.selectedClass = 'emerald';
      this.engine.startRun();
    } else if (screenParam === 'class') {
      this.engine.chooseMode('rogue');
    } else if (screenParam === 'sanctuary') {
      this.engine.showSanctuary();
    } else if (screenParam === 'lab') {
      this.uiRoot.showScreen('modal-snake-lab');
    } else if (screenParam === 'checklist' || screenParam === 'dev-checklist') {
      this.uiRoot.showScreen('modal-dev-checklist');
    } else if (screenParam === 'codex' || screenParam === 'help' || screenParam === 'guide') {
      this.uiRoot.showScreen('modal-help');
    } else if (screenParam === 'stats' || screenParam === 'records') {
      this.uiRoot.showScreen('modal-stats');
    } else if (screenParam === 'pause') {
      this.uiRoot.showScreen('modal-pause');
    } else if (screenParam === 'draft') {
      this.uiRoot.showScreen('modal-draft');
    } else if (screenParam === 'settings') {
      this.uiRoot.showScreen('modal-settings');
    } else if (screenParam === 'multiscreen') {
      this.uiRoot.showScreen('modal-multiscreen');
    } else {
      this.engine.showMenu();
    }
  }

  /**
   * Unlocks Web Audio playback upon the first user interaction gesture (pointerdown or keydown).
   * Complies with modern browser autoplay policies (Rule 10).
   */
  public hookAudioUnlock(): void {
    if (typeof window === 'undefined') return;
    const unlockAudio = () => {
      unlockAudioContext();
      if (this.sound) this.sound.init();
      window.removeEventListener('pointerdown', unlockAudio);
      window.removeEventListener('keydown', unlockAudio);
    };
    window.addEventListener('pointerdown', unlockAudio, { once: true, passive: true });
    window.addEventListener('keydown', unlockAudio, { once: true, passive: true });
  }

  /**
   * Initializes startup audio and sets up user-gesture unlocking.
   */
  public init(): void {
    if (this.sound) {
      this.sound.init();
    }
    this.hookAudioUnlock();
  }

  /**
   * Enters and starts an active game run, ensuring sound engine initialization and active state.
   */
  public startRun(mode: string = 'rogue', classId: string = 'emerald', seed?: number): void {
    if (this.sound) {
      this.sound.init();
    }
    this.engine.chooseMode(mode);
    this.engine.selectedClass = classId;
    this.engine.startRun(seed);
  }

  public start(): void {
    const search = typeof window !== 'undefined' ? window.location.search : '';
    const params = new URLSearchParams(search);
    const sceneParam = params.get('scene');
    if (sceneParam) {
      this._running = false;
      this.renderFrame();
      return;
    }

    this._running = true;
    this._lastTime = performance.now();
    this._animFrameId = requestAnimationFrame(this.loop);
  }

  /**
   * Halts the game animation loop and cancels any pending requestAnimationFrame (AGENTS.md Rule 10).
   */
  public stop(): void {
    this._running = false;
    if (this._animFrameId !== null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(this._animFrameId);
      this._animFrameId = null;
    }
  }

  /**
   * Fully disposes the application: cancels animation frames, tears down WebGL resources,
   * disposes audio engines, releases UI screens, and unhooks input listeners (AGENTS.md Rule 10).
   */
  public destroy(): void {
    this.stop();
    if (this.sound && typeof this.sound.dispose === 'function') {
      this.sound.dispose();
    }
    if (this.webglRenderer && typeof this.webglRenderer.dispose === 'function') {
      this.webglRenderer.dispose();
    }
    if (this.uiRoot && typeof this.uiRoot.dispose === 'function') {
      this.uiRoot.dispose();
    }
    if (this.input && typeof this.input.destroy === 'function') {
      this.input.destroy();
    }
  }

  public renderFrame(): void {
    if (this.webglRenderer && this.webglRenderer.isReady()) {
      GameRenderer.draw(this.webglRenderer, this.engine, this.fx);
    }
  }

  private renderWebGLErrorModal(container: HTMLElement | null): void {
    if (typeof document === 'undefined') return;
    const target = container || document.body;
    if (!target) return;

    const errorDiv = document.createElement('div');
    errorDiv.id = 'webgl-error-modal';
    errorDiv.style.cssText = `
      position: fixed;
      inset: 0;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      background: rgba(2, 6, 23, 0.95);
      color: #f87171;
      font-family: 'Rajdhani', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, monospace;
      z-index: 999999;
      padding: 24px;
      text-align: center;
    `;

    errorDiv.innerHTML = `
      <div style="max-width: 500px; padding: 32px; background: rgba(15, 23, 42, 0.9); border: 2px solid #ef4444; border-radius: 12px; box-shadow: 0 0 30px rgba(239, 68, 68, 0.3);">
        <h1 style="font-size: 28px; margin: 0 0 12px; color: #ef4444; letter-spacing: 2px;">WEBGL 2.0 REQUIRED</h1>
        <p style="font-size: 16px; line-height: 1.5; color: #cbd5e1; margin-bottom: 20px;">
          Ouroboros Ascension requires a modern browser and graphics hardware supporting pure WebGL 2.0.
          Canvas 2D fallback has been permanently retired.
        </p>
        <p style="font-size: 14px; color: #94a3b8; margin: 0;">
          Please ensure hardware acceleration is enabled in your browser settings or update your graphics drivers.
        </p>
      </div>
    `;

    target.appendChild(errorDiv);
  }

  private _lastModalId: string | null = null;
  private _modalThrottleCount: number = 0;

  private loop = (time: number): void => {
    if (!this._running) return;

    const dt = Math.min(0.1, (time - this._lastTime) / 1000);
    this._lastTime = time;

    // Physics step
    this.engine.tick(dt);

    // Hardware-accelerated Pure WebGL 2.0 rendering with Modal Throttling (Rule 10)
    // When a heavy modal screen (lab, codex, sanctuary, stats, checklist, settings, pause) is active,
    // the game simulation is paused or covered. Throttle background WebGL redraws to prevent
    // GPU starvation of the touch scrolling thread on mobile devices.
    const activeModal = this.uiRoot?.activeScreenId;
    const isHeavyModal =
      activeModal &&
      activeModal !== 'modal-main-menu' &&
      activeModal !== 'modal-class-select';

    if (isHeavyModal) {
      const modalChanged = activeModal !== this._lastModalId;
      this._lastModalId = activeModal;
      this._modalThrottleCount++;
      // Render immediately on modal open/switch, then throttle background redraws to ~6 FPS
      if (modalChanged || this._modalThrottleCount % 10 === 0) {
        this.renderFrame();
      }
    } else {
      this._lastModalId = activeModal;
      this._modalThrottleCount = 0;
      this.renderFrame();
    }

    this._animFrameId = requestAnimationFrame(this.loop);
  };
}

// Bootstrap on DOM ready
if (typeof window !== 'undefined' && typeof document !== 'undefined' && typeof document.getElementById === 'function') {
  const boot = () => {
    try {
      // Star Currency & Persistence Initialization (Players start with 0 Stars)
      const meta = MetaProgression.instance;

      (window as any).meta = meta;
      const addStarsFn = (amount: number = 1000) => {
        const added = meta.AddStars(amount);
        meta.Save();
        console.log(`⭐ Granted +${added} Stars! Total balance: ${meta.Stars}`);
        return meta.Stars;
      };
      (window as any).addStars = addStarsFn;
      (window as any).addShards = addStarsFn;

      (window as any).addOuro = (amount: number = 100) => {
        const activeApp = (window as any).ouroborosApp || app;
        const player = activeApp?.engine?.player;
        if (player) {
          if (typeof player.addOuro === 'function') {
            player.addOuro(amount);
          } else if (typeof player.GainOuro === 'function') {
            player.GainOuro(amount);
          } else if (typeof player.GainXp === 'function') {
            player.GainXp(amount);
          } else if (player.ouro !== undefined) {
            player.ouro += amount;
          } else if (player.xp !== undefined) {
            player.xp += amount;
          }
          console.log(`🪙 Granted +${amount} Ouro to active player! Current run balance: ${player.ouro ?? player.Xp ?? 0}`);
          return player.ouro ?? player.Xp ?? 0;
        } else {
          console.warn('⚠️ No active player found in current game engine to grant Ouro.');
          return 0;
        }
      };

      const app = new App();
      app.start();
      (window as any).ouroborosApp = app;
      (window as any).GameRenderer = GameRenderer;
      (window as any).VisualParityHarness = VisualParityHarness;
      (window as any).__setupVisualParityScene = (sceneName: string) => {
        VisualParityHarness.setupScene(app, sceneName);
        app.renderFrame();
      };
    } catch (e) {
      console.error('Failed to boot Ouroboros Galaxy:', e);
    }
  };

  if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
}

export { App as OuroborosApp };
