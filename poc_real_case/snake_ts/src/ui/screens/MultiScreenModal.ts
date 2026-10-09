/**
 * Ouroboros Ascension — Multi-Screen & Wireless Companion Modal (MultiScreenModal.ts)
 *
 * Provides interactive UI modal for pairing mobile smartphone companion controllers
 * and launching multi-monitor popout displays (dedicated HUD, minimap radar, or organ lab).
 * Directly consumes MultiScreenManager and CompanionSync platform services.
 *
 * Meets AGENTS.md Rule 10 In-Code Documentation Standards.
 */

import { IScreen, UiRoot } from '../UiRoot.js';
import { Services } from '../../core/Services.js';
import { MultiScreenManager } from '../../platform/MultiScreen.js';
import { CompanionSync } from '../../platform/CompanionSync.js';

export class MultiScreenModal implements IScreen {
  public readonly id: string = 'modal-multiscreen';
  public readonly element: HTMLElement;
  public readonly root: UiRoot;

  public multiScreenManager: MultiScreenManager;
  public companionSync: CompanionSync;

  private unsubMultiScreen: (() => void) | null = null;
  private unsubControllerInput: (() => void) | null = null;
  private _copyTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor(root: UiRoot) {
    this.root = root;
    this.element = document.createElement('div');
    this.element.className = 'modal-overlay multiscreen-modal';

    this.multiScreenManager = new MultiScreenManager('primary');
    this.companionSync = new CompanionSync({ role: 'host' });

    this.initSync();
    this.build();
  }

  /** Initializes bidirectional listeners across MultiScreenManager and CompanionSync. */
  private initSync(): void {
    // Listen for WebRTC companion controller events
    this.unsubControllerInput = this.companionSync.onControllerInput((input) => {
      this.handleCompanionInput(input);
    });

    // Listen for cross-window BroadcastChannel input events
    const unsubA = this.multiScreenManager.on('INPUT_EVENT', (input) => {
      this.handleCompanionInput(input);
    });
    const unsubB = this.multiScreenManager.on('CONTROLLER_INPUT', (input) => {
      this.handleCompanionInput(input);
    });

    this.unsubMultiScreen = () => {
      unsubA();
      unsubB();
    };
  }

  /**
   * Forwards mobile companion joystick, dash pad, and skill triggers directly to the active game engine.
   * @param input Normalized controller input object
   */
  public handleCompanionInput(input: any): void {
    if (!input) return;
    if (this.root.engine && typeof this.root.engine.onCompanionInput === 'function') {
      this.root.engine.onCompanionInput(input);
    }
  }

  /** Builds the visual cybernetic DOM structure of the MultiScreen modal dialog. */
  private build(): void {
    const companionUrl = this.companionSync.getPairingUrl();
    const roomCode = this.companionSync.roomCode;

    this.element.innerHTML = `
      <div class="modal-panel multiscreen-panel glass-panel" style="max-width: 820px; width: 95vw; max-height: min(92vh, 92dvh); display: flex; flex-direction: column; overflow: hidden;">
        <div class="modal-header" style="flex-shrink: 0;">
          <h2 class="cyber-modal-title">📱 DUAL-SCREEN & COMPANION SYNC</h2>
          <p class="cyber-modal-subtitle">Connect a second monitor or mobile smartphone as a dedicated live HUD & radar</p>
        </div>

        <div class="multiscreen-options-grid" style="flex: 1 1 auto; min-height: 0; overflow-y: auto; -webkit-overflow-scrolling: touch; padding: 4px; padding-bottom: 12px;">
          <!-- Option 1: Mobile Companion -->
          <div class="sync-card">
            <div class="sync-card-header">
              <span class="sync-icon">📱</span>
              <span class="sync-title">Mobile Phone Companion</span>
            </div>
            <p class="sync-desc">Use your smartphone as a dedicated touch steering wheel, tactile haptic dash pad, and live organ lab.</p>
            <div class="qr-placeholder">
              <div class="qr-code-box">
                <span class="qr-room-code" style="font-size:clamp(14px, 4.5vw, 24px); font-weight:bold; letter-spacing:2px; color:#00ffcc; word-break:break-all;">⚡ ROOM: ${roomCode} ⚡</span>
              </div>
            </div>
            <div class="companion-link-box">
              <input type="text" readonly value="${companionUrl}" class="companion-url-input">
              <button class="cyber-btn btn-sm btn-secondary btn-copy-url">Copy Link</button>
            </div>
          </div>

          <!-- Option 2: Multi-Monitor Window Split -->
          <div class="sync-card">
            <div class="sync-card-header">
              <span class="sync-icon">🖥️</span>
              <span class="sync-title">Second Monitor Split</span>
            </div>
            <p class="sync-desc">Spawn an external popout window on your second display for full-screen Telemetry & Radar.</p>
            <button class="cyber-btn btn-primary btn-popout-window" style="margin-top:20px;">
              Launch Popout Window ↗
            </button>
          </div>
        </div>

        <div class="modal-actions-row" style="flex-shrink: 0; margin-top: auto; padding-top: 8px; border-top: 1px solid rgba(148, 163, 184, 0.15);">
          <button class="cyber-btn btn-ghost btn-close-modal">Close</button>
        </div>
      </div>
    `;

    const closeBtn = this.element.querySelector('.btn-close-modal') as HTMLButtonElement;
    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        Services.Sound.playUi();
        this.root.hideScreen('modal-multiscreen');
      });
    }

    const copyBtn = this.element.querySelector('.btn-copy-url') as HTMLButtonElement;
    const urlInput = this.element.querySelector('.companion-url-input') as HTMLInputElement;
    if (copyBtn && urlInput) {
      copyBtn.addEventListener('click', () => {
        urlInput.select();
        navigator.clipboard?.writeText(urlInput.value);
        if (this._copyTimeout !== null) {
          clearTimeout(this._copyTimeout);
          this._copyTimeout = null;
        }
        copyBtn.textContent = 'Copied! ✅';
        this._copyTimeout = setTimeout(() => {
          this._copyTimeout = null;
          copyBtn.textContent = 'Copy Link';
        }, 2000);
      });
    }

    const popoutBtn = this.element.querySelector('.btn-popout-window') as HTMLButtonElement;
    if (popoutBtn) {
      popoutBtn.addEventListener('click', async () => {
        Services.Sound.playUi();
        await this.multiScreenManager.openCompanionWindow('hud');
      });
    }
  }

  public show(): void {
    // Attempt WebRTC signaling connection when modal opens
    this.companionSync.connect();
  }

  public hide(): void {
    if (this._copyTimeout !== null) {
      clearTimeout(this._copyTimeout);
      this._copyTimeout = null;
    }
  }

  public destroy(): void {
    if (this._copyTimeout !== null) {
      clearTimeout(this._copyTimeout);
      this._copyTimeout = null;
    }
    if (this.unsubControllerInput) {
      this.unsubControllerInput();
      this.unsubControllerInput = null;
    }
    if (this.unsubMultiScreen) {
      this.unsubMultiScreen();
      this.unsubMultiScreen = null;
    }
    this.multiScreenManager.destroy();
    this.companionSync.cleanup();
  }

  public dispose(): void {
    this.destroy();
  }
}
