/**
 * Ouroboros Ascension — Dedicated In-Game Pause Screen (PauseSettingsScreen.ts)
 *
 * Provides a specialized, high-urgency in-game pause overlay designed for rapid resumption,
 * quick audio/shake tuning, instant codex lookups, and clean expedition abandonment.
 *
 * Core Features:
 * - Instant Resume: Prominent 'Resume Run [P]' button matching hotkey [P] / Escape.
 * - Live Audio & Screen Shake Tuning: Sliders bind directly to Services.Sound and Services.Fx.
 * - Abandon Expedition: Direct route to serpent dissolution without force quitting.
 * - Seamless Back-Stack Navigation: Deep link to Codex / Help Screen or Full Settings with return history.
 */

import { BaseModalScreen } from '../BaseModalScreen';
import { UiRoot } from '../UiRoot';
import { Widgets } from '../Widgets';
import { Services } from '../../core/Services';
import { ISettingsValues } from './SettingsScreen';

export class PauseSettingsScreen extends BaseModalScreen {
  public readonly id: string = 'modal-pause';

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
  private _sfxValLabel!: HTMLElement;
  private _musValLabel!: HTMLElement;
  private _shakeValLabel!: HTMLElement;

  constructor(root: UiRoot) {
    super(root, 'pause-modal');
    this.loadSettings();
    this.build();
  }

  protected build(): void {
    this.element.innerHTML = `
      <div class="modal-panel pause-panel glass-panel" style="max-width: 520px; width: 95vw; max-height: min(94vh, 94dvh); display: flex; flex-direction: column; overflow: hidden;">
        <div class="modal-header" style="flex-shrink: 0;">
          <h2 class="cyber-modal-title">SYSTEM PAUSED</h2>
          <p class="cyber-modal-subtitle">Expedition suspended — Quick Controls & Diagnostics</p>
        </div>

        <div class="pause-controls-body" style="display: flex; flex-direction: column; gap: 10px; margin: 8px 0; flex: 1 1 auto; min-height: 0; overflow-y: auto; -webkit-overflow-scrolling: touch; padding: 4px; padding-bottom: 8px;">
          <!-- SFX Slider -->
          <div class="setting-row">
            <label class="setting-label">Sound Effects</label>
            <div class="slider-control">
              <input type="range" min="0" max="1" step="0.05" value="${this.settings.sfx}" class="setting-slider sfx-slider">
              <span class="setting-val sfx-val">${Math.round(this.settings.sfx * 100)}%</span>
            </div>
          </div>

          <!-- Music Slider -->
          <div class="setting-row">
            <label class="setting-label">Music Volume</label>
            <div class="slider-control">
              <input type="range" min="0" max="1" step="0.05" value="${this.settings.music}" class="setting-slider mus-slider">
              <span class="setting-val mus-val">${Math.round(this.settings.music * 100)}%</span>
            </div>
          </div>

          <!-- Mute Checkbox -->
          <div class="setting-row">
            <label class="setting-label">Mute All Audio</label>
            <input type="checkbox" class="setting-checkbox mute-check" ${this.settings.mute ? 'checked' : ''}>
          </div>

          <!-- Screen Shake Slider -->
          <div class="setting-row">
            <label class="setting-label">Screen Shake</label>
            <div class="slider-control">
              <input type="range" min="0" max="1" step="0.1" value="${this.settings.shake}" class="setting-slider shake-slider">
              <span class="setting-val shake-val">${Math.round(this.settings.shake * 100)}%</span>
            </div>
          </div>
        </div>

        <!-- Action Rows -->
        <div class="modal-actions-row" style="flex-shrink: 0; margin-top: auto; padding-top: 6px; border-top: 1px solid rgba(148, 163, 184, 0.15); display: flex; flex-wrap: wrap; gap: 8px; justify-content: center;">
          <button class="cyber-btn btn-secondary btn-settings-codex">📖 Codex</button>
          <button class="cyber-btn btn-ghost btn-full-settings">⚙️ Settings</button>
          <button class="cyber-btn btn-danger btn-abandon">Abandon Run ⚠️</button>
          <button class="cyber-btn btn-danger btn-main-menu">🏠 Main Menu</button>
          <button class="cyber-btn btn-primary btn-resume btn-close-settings" style="width: 100%; margin-top: 4px;">Resume Run [P] ⚡</button>
        </div>
      </div>
    `;

    this._sfxSlider = this.element.querySelector('.sfx-slider')!;
    this._musSlider = this.element.querySelector('.mus-slider')!;
    this._shakeSlider = this.element.querySelector('.shake-slider')!;
    this._muteCheck = this.element.querySelector('.mute-check')!;

    this._sfxValLabel = this.element.querySelector('.sfx-val')!;
    this._musValLabel = this.element.querySelector('.mus-val')!;
    this._shakeValLabel = this.element.querySelector('.shake-val')!;

    // Reactive input listeners
    this._sfxSlider.addEventListener('input', () => {
      this.settings.sfx = parseFloat(this._sfxSlider.value);
      this._sfxValLabel.textContent = `${Math.round(this.settings.sfx * 100)}%`;
      if (typeof (Services.Sound as any).setSfxVolume === 'function') {
        (Services.Sound as any).setSfxVolume(this.settings.sfx);
      }
    });

    this._musSlider.addEventListener('input', () => {
      this.settings.music = parseFloat(this._musSlider.value);
      this._musValLabel.textContent = `${Math.round(this.settings.music * 100)}%`;
      if (typeof (Services.Sound as any).setMusicVolume === 'function') {
        (Services.Sound as any).setMusicVolume(this.settings.music);
      }
    });

    this._muteCheck.addEventListener('change', () => {
      this.settings.mute = this._muteCheck.checked;
      if (typeof (Services.Sound as any).setMuted === 'function') {
        (Services.Sound as any).setMuted(this.settings.mute);
      }
    });

    this._shakeSlider.addEventListener('input', () => {
      this.settings.shake = parseFloat(this._shakeSlider.value);
      this._shakeValLabel.textContent = `${Math.round(this.settings.shake * 100)}%`;
      if (Services.Fx && typeof (Services.Fx as any).setShakeScale === 'function') {
        (Services.Fx as any).setShakeScale(this.settings.shake);
      } else if (this.root.engine && this.root.engine.fx && typeof this.root.engine.fx.setShakeScale === 'function') {
        this.root.engine.fx.setShakeScale(this.settings.shake);
      }
    });

    // Resume button
    const resumeBtn = this.element.querySelector('.btn-resume') as HTMLButtonElement;
    if (resumeBtn) {
      resumeBtn.addEventListener('click', () => {
        this.resumeGame();
      });
    }

    // Codex button
    const codexBtn = this.element.querySelector('.btn-settings-codex') as HTMLButtonElement;
    if (codexBtn) {
      codexBtn.addEventListener('click', () => {
        Services.Sound.playUi();
        this.saveSettings();
        this.root.showScreen('modal-help');
      });
    }

    // Full settings button
    const fullSettingsBtn = this.element.querySelector('.btn-full-settings') as HTMLButtonElement;
    if (fullSettingsBtn) {
      fullSettingsBtn.addEventListener('click', () => {
        Services.Sound.playUi();
        this.saveSettings();
        this.root.showScreen('modal-settings');
      });
    }

    // Abandon Run button
    const abandonBtn = this.element.querySelector('.btn-abandon') as HTMLButtonElement;
    if (abandonBtn) {
      abandonBtn.addEventListener('click', () => {
        Services.Sound.playUi();
        this.saveSettings();
        const eng = this.root.engine;
        if (eng) {
          if (typeof eng.handleGameOver === 'function') {
            eng.handleGameOver(false);
          } else if (typeof eng.HandleGameOver === 'function') {
            eng.HandleGameOver(false);
          } else if (typeof eng.showMenu === 'function') {
            eng.showMenu();
          }
        }
      });
    }

    // Main Menu button: cleanly abandons active expedition, resets state to Menu, and presents modal-main-menu
    const mainMenuBtn = this.element.querySelector('.btn-main-menu') as HTMLButtonElement;
    if (mainMenuBtn) {
      mainMenuBtn.addEventListener('click', () => {
        Services.Sound.playUi();
        this.saveSettings();
        const eng = this.root.engine;
        if (eng) {
          if (typeof eng.showMenu === 'function') {
            eng.showMenu();
          } else if (typeof eng.ShowMenu === 'function') {
            eng.ShowMenu();
          }
        }
        this.root.showScreen('modal-main-menu');
      });
    }
  }

  /**
   * Resumes the game simulation and dismisses modal overlays.
   */
  public resumeGame(): void {
    Services.Sound.playUi();
    this.saveSettings();
    const eng = this.root.engine;
    if (eng) {
      if (typeof eng.Resume === 'function') {
        eng.Resume();
      } else if (typeof eng.resume === 'function') {
        eng.resume();
      } else if (typeof eng.togglePause === 'function' && (eng.paused || eng.State === 2)) {
        eng.togglePause();
      }
    }
    this.root.closeAllModals();
  }

  protected onShow(): void {
    this.loadSettings();
    this.syncFormValues();
  }

  protected onHide(): void {
    this.saveSettings();
  }

  private syncFormValues(): void {
    if (this._sfxSlider) this._sfxSlider.value = `${this.settings.sfx}`;
    if (this._sfxValLabel) this._sfxValLabel.textContent = `${Math.round(this.settings.sfx * 100)}%`;
    if (this._musSlider) this._musSlider.value = `${this.settings.music}`;
    if (this._musValLabel) this._musValLabel.textContent = `${Math.round(this.settings.music * 100)}%`;
    if (this._muteCheck) this._muteCheck.checked = this.settings.mute;
    if (this._shakeSlider) this._shakeSlider.value = `${this.settings.shake}`;
    if (this._shakeValLabel) this._shakeValLabel.textContent = `${Math.round(this.settings.shake * 100)}%`;
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
          }
        }
      }
    } catch {}
  }
}
