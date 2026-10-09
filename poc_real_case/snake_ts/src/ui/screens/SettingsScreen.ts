import { IScreen, UiRoot } from '../UiRoot';
import { Services } from '../../core/Services';
import { ResponsiveLayout } from '../ResponsiveLayout';
import { RenderQuality } from '../../render/RenderQuality';
import { InputManager } from '../../input/InputManager';

export interface ISettingsValues {
  sfx: number;
  music: number;
  mute: boolean;
  shake: number;
  quality: 'high' | 'medium' | 'low';
  crt: boolean;
  showFps: boolean;
  touchScheme: 'stick' | 'follow' | 'swipe';
  lefty: boolean;
  joystickPosition?: 'right' | 'left';
}

/**
 * Ouroboros Ascension — Settings & Configuration Modal (SettingsScreen.ts)
 *
 * Implements comprehensive system audio, graphics, and controls tuning:
 * - Audio: SFX and Music volume sliders directly modulating SoundEngine buses, plus global mute.
 * - Graphics & WebGL: Dynamic resolution quality presets, CRT post-processing shader toggle, and FPS counter.
 * - Controls: Touch steering scheme selection (virtual stick, follow finger, swipe octants) and Lefty mode.
 * - Persistence: Automatically saves and reloads preferences via LocalStorage.
 * - Zero memory leaks: registers tracked listeners in `_disposables` and unbinds them upon `dispose()`.
 */
export class SettingsScreen implements IScreen {
  public readonly id: string = 'modal-settings';
  public readonly element: HTMLElement;
  public readonly root: UiRoot;

  public settings: ISettingsValues = {
    sfx: 0.7,
    music: 0.4,
    mute: false,
    shake: 1.0,
    quality: 'high',
    crt: true,
    showFps: true,
    touchScheme: 'stick',
    lefty: false,
    joystickPosition: 'right',
  };

  private _sfxSlider!: HTMLInputElement;
  private _musSlider!: HTMLInputElement;
  private _shakeSlider!: HTMLInputElement;
  private _muteCheck!: HTMLInputElement;
  private _qualitySelect!: HTMLSelectElement;
  private _crtCheck!: HTMLInputElement;
  private _fpsCheck!: HTMLInputElement;
  private _schemeSelect!: HTMLSelectElement;
  private _joystickPosSelect!: HTMLSelectElement;

  private _sfxValLabel!: HTMLElement;
  private _musValLabel!: HTMLElement;
  private _shakeValLabel!: HTMLElement;

  private _disposables: Array<() => void> = [];

  constructor(root: UiRoot) {
    this.root = root;
    if (typeof document !== 'undefined') {
      this.element = document.createElement('div');
      this.element.className = 'modal-overlay settings-modal';
      this.loadSettings();
      this.build();
    } else {
      this.element = {
        style: {},
        classList: { add: () => {} },
        children: []
      } as unknown as HTMLElement;
      this.loadSettings();
    }
  }

  private addTrackedListener(
    target: EventTarget | null,
    type: string,
    listener: EventListenerOrEventListenerObject
  ): void {
    if (!target || typeof target.addEventListener !== 'function') return;
    target.addEventListener(type, listener);
    this._disposables.push(() => {
      try {
        target.removeEventListener(type, listener);
      } catch {}
    });
  }

  private build(): void {
    if (typeof document === 'undefined') return;

    this.element.innerHTML = `
      <div class="modal-panel settings-panel glass-panel" style="max-width: 580px; width: 95vw; max-height: min(92vh, 92dvh); display: flex; flex-direction: column; overflow: hidden;">
        <div class="modal-header" style="flex-shrink: 0;">
          <h2 class="cyber-modal-title">SETTINGS</h2>
          <p class="cyber-modal-subtitle">Audio, visuals, and control options</p>
        </div>

        <div class="settings-form-scroll-container" style="flex: 1 1 auto; min-height: 0; overflow-y: auto; -webkit-overflow-scrolling: touch; padding-bottom: 12px;">
          <div class="settings-form">
            <!-- Audio Group -->
            <div class="settings-group-header">AUDIO</div>

            <div class="setting-row">
              <label class="setting-label">Sound Effects</label>
              <div class="slider-control">
                <input type="range" min="0" max="1" step="0.05" value="${this.settings.sfx}" class="setting-slider sfx-slider">
                <span class="setting-val sfx-val">${Math.round(this.settings.sfx * 100)}%</span>
              </div>
            </div>

            <div class="setting-row">
              <label class="setting-label">Music Volume</label>
              <div class="slider-control">
                <input type="range" min="0" max="1" step="0.05" value="${this.settings.music}" class="setting-slider mus-slider">
                <span class="setting-val mus-val">${Math.round(this.settings.music * 100)}%</span>
              </div>
            </div>

            <div class="setting-row">
              <label class="setting-label">Mute All Audio</label>
              <input type="checkbox" class="setting-checkbox mute-check" ${this.settings.mute ? 'checked' : ''}>
            </div>

            <!-- Video & FX Group -->
            <div class="settings-group-header">GRAPHICS & FX</div>

            <div class="setting-row">
              <label class="setting-label">Screen Shake</label>
              <div class="slider-control">
                <input type="range" min="0" max="1" step="0.1" value="${this.settings.shake}" class="setting-slider shake-slider">
                <span class="setting-val shake-val">${Math.round(this.settings.shake * 100)}%</span>
              </div>
            </div>

            <div class="setting-row">
              <label class="setting-label">Visual Quality</label>
              <select class="setting-select quality-select">
                <option value="high" ${this.settings.quality === 'high' ? 'selected' : ''}>High (Full Neon Glow & Particles)</option>
                <option value="medium" ${this.settings.quality === 'medium' ? 'selected' : ''}>Medium (Balanced Glow)</option>
                <option value="low" ${this.settings.quality === 'low' ? 'selected' : ''}>Low (Battery Saver, No Glow)</option>
              </select>
            </div>

            <div class="setting-row">
              <label class="setting-label">CRT Scanline Filter</label>
              <input type="checkbox" class="setting-checkbox crt-check" ${this.settings.crt ? 'checked' : ''}>
            </div>

            <div class="setting-row">
              <label class="setting-label">Show FPS Counter</label>
              <input type="checkbox" class="setting-checkbox fps-check" ${this.settings.showFps ? 'checked' : ''}>
            </div>

            <!-- Controls Group -->
            <div class="settings-group-header">CONTROLS & MULTI-SCREEN</div>

            <div class="setting-row">
              <label class="setting-label">Touch Scheme</label>
              <select class="setting-select scheme-select">
                <option value="stick" ${this.settings.touchScheme === 'stick' ? 'selected' : ''}>Virtual Joystick</option>
                <option value="follow" ${this.settings.touchScheme === 'follow' ? 'selected' : ''}>Follow Finger</option>
                <option value="swipe" ${this.settings.touchScheme === 'swipe' ? 'selected' : ''}>Swipe Direction</option>
              </select>
            </div>

            <div class="setting-row">
              <label class="setting-label">Joystick Position</label>
              <select class="setting-select joystick-pos-select">
                <option value="right" ${!this.settings.lefty ? 'selected' : ''}>Right Side (Default)</option>
                <option value="left" ${this.settings.lefty ? 'selected' : ''}>Left Side</option>
              </select>
            </div>
          </div>
        </div>

        <div class="modal-actions-row" style="flex-shrink: 0; margin-top: auto; padding-top: 8px; border-top: 1px solid rgba(148, 163, 184, 0.15); display: flex; justify-content: center; gap: 10px; flex-wrap: wrap;">
          <button class="cyber-btn btn-secondary btn-settings-codex" style="flex: 1 1 auto; max-width: 200px; min-width: 140px;">📖 Codex & Guide</button>
          <button class="cyber-btn btn-primary btn-close-settings" style="flex: 1 1 auto; max-width: 200px; min-width: 140px;">Save & Close</button>
        </div>
      </div>
    `;

    this._sfxSlider = this.element.querySelector('.sfx-slider')!;
    this._musSlider = this.element.querySelector('.mus-slider')!;
    this._shakeSlider = this.element.querySelector('.shake-slider')!;
    this._muteCheck = this.element.querySelector('.mute-check')!;
    this._qualitySelect = this.element.querySelector('.quality-select')!;
    this._crtCheck = this.element.querySelector('.crt-check')!;
    this._fpsCheck = this.element.querySelector('.fps-check')!;
    this._schemeSelect = this.element.querySelector('.scheme-select')!;
    this._joystickPosSelect = this.element.querySelector('.joystick-pos-select')!;

    this._sfxValLabel = this.element.querySelector('.sfx-val')!;
    this._musValLabel = this.element.querySelector('.mus-val')!;
    this._shakeValLabel = this.element.querySelector('.shake-val')!;

    // Event listeners tracked
    if (this._sfxSlider) {
      this.addTrackedListener(this._sfxSlider, 'input', () => {
        this.settings.sfx = parseFloat(this._sfxSlider.value);
        if (this._sfxValLabel) this._sfxValLabel.textContent = `${Math.round(this.settings.sfx * 100)}%`;
        if (typeof (Services.Sound as any).setSfxVolume === 'function') {
          (Services.Sound as any).setSfxVolume(this.settings.sfx);
        }
      });
    }

    if (this._musSlider) {
      this.addTrackedListener(this._musSlider, 'input', () => {
        this.settings.music = parseFloat(this._musSlider.value);
        if (this._musValLabel) this._musValLabel.textContent = `${Math.round(this.settings.music * 100)}%`;
        if (typeof (Services.Sound as any).setMusicVolume === 'function') {
          (Services.Sound as any).setMusicVolume(this.settings.music);
        }
      });
    }

    if (this._muteCheck) {
      this.addTrackedListener(this._muteCheck, 'change', () => {
        this.settings.mute = this._muteCheck.checked;
        if (typeof (Services.Sound as any).setMuted === 'function') {
          (Services.Sound as any).setMuted(this.settings.mute);
        }
      });
    }

    if (this._shakeSlider) {
      this.addTrackedListener(this._shakeSlider, 'input', () => {
        this.settings.shake = parseFloat(this._shakeSlider.value);
        if (this._shakeValLabel) this._shakeValLabel.textContent = `${Math.round(this.settings.shake * 100)}%`;
        if (this.root.engine && this.root.engine.fx && typeof this.root.engine.fx.setShakeScale === 'function') {
          this.root.engine.fx.setShakeScale(this.settings.shake);
        }
      });
    }

    if (this._qualitySelect) {
      this.addTrackedListener(this._qualitySelect, 'change', () => {
        this.settings.quality = this._qualitySelect.value as any;
        RenderQuality.set(this.settings.quality);
        if (this.root.engine && this.root.engine.fx && typeof this.root.engine.fx.setQuality === 'function') {
          this.root.engine.fx.setQuality(this.settings.quality);
        }
      });
    }

    if (this._crtCheck) {
      this.addTrackedListener(this._crtCheck, 'change', () => {
        this.settings.crt = this._crtCheck.checked;
        if (typeof document !== 'undefined' && document.body) {
          document.body.classList.toggle('crt-effect', this.settings.crt);
        }
      });
    }

    if (this._fpsCheck) {
      this.addTrackedListener(this._fpsCheck, 'change', () => {
        this.settings.showFps = this._fpsCheck.checked;
        if (this.root.hudView) {
          this.root.hudView.showFps = this.settings.showFps;
        }
      });
    }

    if (this._schemeSelect) {
      this.addTrackedListener(this._schemeSelect, 'change', () => {
        this.settings.touchScheme = this._schemeSelect.value as any;
        InputManager.instance.setTouchScheme(this.settings.touchScheme);
      });
    }

    if (this._joystickPosSelect) {
      this.addTrackedListener(this._joystickPosSelect, 'change', () => {
        const isLefty = this._joystickPosSelect.value === 'left';
        this.settings.lefty = isLefty;
        this.settings.joystickPosition = this._joystickPosSelect.value as 'right' | 'left';
        InputManager.instance.setLefty(this.settings.lefty);
        if (this.root && this.root.hudView) {
          const metrics = ResponsiveLayout.instance.metrics;
          this.root.hudView.applyMetrics(metrics);
        }
        this.saveSettings();
      });
    }

    const codexBtn = this.element.querySelector('.btn-settings-codex') as HTMLButtonElement;
    if (codexBtn) {
      this.addTrackedListener(codexBtn, 'click', () => {
        Services.Sound.playUi();
        this.saveSettings();
        this.root.showScreen('modal-help');
      });
    }

    const closeBtn = this.element.querySelector('.btn-close-settings') as HTMLButtonElement;
    if (closeBtn) {
      this.addTrackedListener(closeBtn, 'click', () => {
        Services.Sound.playUi();
        this.saveSettings();
        const eng = this.root.engine;
        if (
          eng &&
          (eng.state === 'Paused' ||
            eng.State === 'Paused' ||
            eng.state === 2 ||
            eng.State === 2 ||
            (typeof eng.isPaused === 'boolean' && eng.isPaused) ||
            (typeof eng.paused === 'boolean' && eng.paused))
        ) {
          if (typeof eng.Resume === 'function') {
            eng.Resume();
          } else if (typeof eng.resume === 'function') {
            eng.resume();
          }
          this.root.closeAllModals();
        } else {
          this.root.hideScreen('modal-settings');
        }
      });
    }
  }

  public mount(container?: HTMLElement): void {
    if (container && this.element && !this.element.parentElement && typeof container.appendChild === 'function') {
      container.appendChild(this.element);
    }
  }

  public render(): void {
    this.refresh();
  }

  public unmount(): void {
    this.saveSettings();
  }

  public show(): void {
    if (this.element && this.element.style) {
      this.element.style.display = 'flex';
    }
    this.refresh();
    this.render();
  }

  public hide(): void {
    if (this.element && this.element.style) {
      this.element.style.display = 'none';
    }
    this.unmount();
  }

  public refresh(): void {
    if (this._sfxSlider) this._sfxSlider.value = `${this.settings.sfx}`;
    if (this._sfxValLabel) this._sfxValLabel.textContent = `${Math.round(this.settings.sfx * 100)}%`;
    if (this._musSlider) this._musSlider.value = `${this.settings.music}`;
    if (this._musValLabel) this._musValLabel.textContent = `${Math.round(this.settings.music * 100)}%`;
    if (this._muteCheck) this._muteCheck.checked = this.settings.mute;
    if (this._shakeSlider) this._shakeSlider.value = `${this.settings.shake}`;
    if (this._shakeValLabel) this._shakeValLabel.textContent = `${Math.round(this.settings.shake * 100)}%`;
    if (this._qualitySelect) this._qualitySelect.value = this.settings.quality;
    if (this._crtCheck) this._crtCheck.checked = this.settings.crt;
    if (this._fpsCheck) this._fpsCheck.checked = this.settings.showFps;
    if (this._schemeSelect) this._schemeSelect.value = this.settings.touchScheme;
    if (this._joystickPosSelect) this._joystickPosSelect.value = this.settings.lefty ? 'left' : 'right';
  }

  public saveSettings(): void {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('ouroboros_settings_v2', JSON.stringify(this.settings));
      }
    } catch {}
  }

  public loadSettings(): void {
    try {
      if (typeof localStorage !== 'undefined') {
        const raw = localStorage.getItem('ouroboros_settings_v2');
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed) {
            Object.assign(this.settings, parsed);
            if (parsed.joystickPosition !== undefined) {
              this.settings.lefty = parsed.joystickPosition === 'left';
            } else if (parsed.lefty !== undefined) {
              this.settings.joystickPosition = parsed.lefty ? 'left' : 'right';
            }
          }
        }
      }
    } catch {}
    InputManager.instance.setLefty(this.settings.lefty);
    InputManager.instance.setTouchScheme(this.settings.touchScheme);
  }

  public dispose(): void {
    this.unmount();
    while (this._disposables.length > 0) {
      const cleanup = this._disposables.pop()!;
      try { cleanup(); } catch {}
    }
    if (this.element && this.element.parentElement) {
      try { this.element.parentElement.removeChild(this.element); } catch {}
    }
  }

  public destroy(): void {
    this.dispose();
  }
}
