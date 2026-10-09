import { IScreen, UiRoot } from '../UiRoot';
import { GameData } from '../../data/GameData';
import { MetaProgression } from '../../data/MetaProgression';
import { Widgets } from '../Widgets';
import { Services } from '../../core/Services';

/**
 * Ouroboros Ascension — Main Title Menu Screen (MenuScreen.ts)
 *
 * Implements the primary gateway interface:
 * - Launching new expeditions via Serpent Archetype Select.
 * - Navigating to Sanctuary (Permanent Upgrades), Codex (Field Guide), Settings, and Multi-Screen pairing.
 * - Real-time display of player lifetime high-score, deepest floor, maximum combo, and banked Star currency.
 * - Enforces zero memory leaks via tracked DOM event listener disposal in `_disposables`.
 */
export class MenuScreen implements IScreen {
  public readonly id: string = 'modal-main-menu';
  public readonly element: HTMLElement;
  public readonly root: UiRoot;

  private _bestScoreVal!: HTMLElement;
  private _bestFloorVal!: HTMLElement;
  private _bestComboVal!: HTMLElement;
  private _shardsVal!: HTMLElement;

  private _disposables: Array<() => void> = [];

  /**
   * Initializes the Title Menu Screen DOM container and constructs the glassmorphic menu tree.
   * @param root Parent UiRoot managing modal transitions
   */
  constructor(root: UiRoot) {
    this.root = root;
    if (typeof document !== 'undefined') {
      this.element = document.createElement('div');
      this.element.className = 'modal-overlay title-screen-modal';
      this.build();
    } else {
      this.element = {
        style: {},
        classList: { add: () => {} },
        children: []
      } as unknown as HTMLElement;
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
      <div class="modal-panel title-panel glass-panel" style="max-width: 540px; width: 95vw; max-height: min(94vh, 94dvh); display: flex; flex-direction: column; overflow-y: auto; -webkit-overflow-scrolling: touch; padding: 16px 14px; gap: 8px;">
        <div class="game-title-wrap" style="flex-shrink: 0; text-align: center; margin-bottom: 2px;">
          <h1 class="game-title top-title">OUROBOROS</h1>
          <h1 class="game-title bottom-title">GALAXY</h1>
          <p class="game-tagline">COSMIC ROGUELIKE RPG COMBO SNAKE EVOLUTION</p>
        </div>

        <div class="menu-best-row" style="display: flex; flex-direction: row; justify-content: center; align-items: center; gap: 6px; flex-wrap: wrap; margin: 4px 0; flex-shrink: 0;">
          <div class="best-pill">
            <span class="pill-label">BEST</span>
            <span class="pill-val best-score-val">0</span>
          </div>
          <div class="best-pill">
            <span class="pill-label">FLOOR</span>
            <span class="pill-val best-floor-val">1</span>
          </div>
          <div class="best-pill">
            <span class="pill-label">COMBO</span>
            <span class="pill-val best-combo-val">0x</span>
          </div>
          <div class="best-pill shard-pill" title="Stars">
            <span class="pill-label">⭐</span>
            <span class="pill-val menu-shards-val">0</span>
          </div>
        </div>

        <div class="menu-buttons-grid" style="display: flex; flex-direction: column; gap: 8px; max-width: 420px; margin: 0 auto; width: 100%; flex-shrink: 0;">
          <div class="mode-buttons-col" style="display: flex; flex-direction: column; gap: 6px;"></div>

          <div class="gallery-button-wrap" style="display: flex; justify-content: center; margin: 2px 0;">
            <button class="cyber-btn btn-secondary btn-gallery btn-ouroboros-gallery" style="width: 100%; padding: 8px 12px; font-size: clamp(11px, 2.5vw, 13px); white-space: nowrap;">🌌 Ouroboros Gallery</button>
          </div>
          
          <div class="menu-sub-row" style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px;">
            <button class="cyber-btn btn-secondary btn-sanctuary" style="padding: 8px 6px; font-size: clamp(10.5px, 2.4vw, 12px); white-space: nowrap;">🏛️ Sanctuary</button>
            <button class="cyber-btn btn-ghost btn-global-stats btn-stats" style="padding: 8px 6px; font-size: clamp(10.5px, 2.4vw, 12px); white-space: nowrap;">📊 Stats</button>
            <button class="cyber-btn btn-ghost btn-codex btn-help" style="padding: 8px 6px; font-size: clamp(10.5px, 2.4vw, 12px); white-space: nowrap;">📖 Codex</button>
            <button class="cyber-btn btn-ghost btn-settings" style="padding: 8px 6px; font-size: clamp(10.5px, 2.4vw, 12px); white-space: nowrap;">⚙️ Settings</button>
          </div>
        </div>

        <p class="menu-footer" style="font-size: 9.5px; color: #64748b; margin-top: 4px; text-align: center; line-height: 1.3; flex-shrink: 0;">Runs offline • Responsive Keyboard · Touch · Gamepad • Cosmic Deep Space Engine</p>
      </div>
    `;

    this._bestScoreVal = this.element.querySelector('.best-score-val')!;
    this._bestFloorVal = this.element.querySelector('.best-floor-val')!;
    this._bestComboVal = this.element.querySelector('.best-combo-val')!;
    this._shardsVal = this.element.querySelector('.menu-shards-val')!;

    const modeCol = this.element.querySelector('.mode-buttons-col')!;
    const modes = GameData.Modes;

    for (let i = 0; i < modes.count; i++) {
      const key = modes.keys[i]!;
      const mode = modes.get(key)!;
      const icon = key === 'rogue' ? '⚔️' : key === 'endless' ? '🔥' : key === 'bossrush' ? '👹' : '📅';
      const variant = i === 0 ? 'primary' : 'secondary';

      const btn = Widgets.createButton(`${icon} ${mode.label}`, variant, () => {
        Services.Sound.playUi();
        if (this.root.engine && typeof this.root.engine.chooseMode === 'function') {
          this.root.engine.chooseMode(key);
        }
      });
      modeCol.appendChild(btn);
    }

    const sanctuaryBtn = this.element.querySelector('.btn-sanctuary') as HTMLButtonElement;
    if (sanctuaryBtn) {
      this.addTrackedListener(sanctuaryBtn, 'click', () => {
        Services.Sound.playUi();
        this.root.showScreen('modal-sanctuary');
      });
    }

    const galleryBtn = (this.element.querySelector('.btn-gallery') || this.element.querySelector('.btn-ouroboros-gallery')) as HTMLButtonElement;
    if (galleryBtn) {
      this.addTrackedListener(galleryBtn, 'click', () => {
        Services.Sound.playUi();
        this.root.showScreen('modal-ouroboros-gallery');
      });
    }

    const statsBtn = (this.element.querySelector('.btn-global-stats') || this.element.querySelector('.btn-stats')) as HTMLButtonElement;
    if (statsBtn) {
      this.addTrackedListener(statsBtn, 'click', () => {
        Services.Sound.playUi();
        this.root.showScreen('modal-stats', { mode: 'global' });
      });
    }

    const codexBtn = (this.element.querySelector('.btn-codex') || this.element.querySelector('.btn-help')) as HTMLButtonElement;
    if (codexBtn) {
      this.addTrackedListener(codexBtn, 'click', () => {
        Services.Sound.playUi();
        this.root.showScreen('modal-help');
      });
    }

    const settingsBtn = this.element.querySelector('.btn-settings') as HTMLButtonElement;
    if (settingsBtn) {
      this.addTrackedListener(settingsBtn, 'click', () => {
        Services.Sound.playUi();
        this.root.showScreen('modal-settings');
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
    // Cleanly unmount / hide state
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
    const meta = MetaProgression.instance;
    if (!meta) return;

    if (this._bestScoreVal) this._bestScoreVal.textContent = Widgets.grouped(meta.records.highScore);
    if (this._bestFloorVal) this._bestFloorVal.textContent = Widgets.plain(meta.records.highestFloor);
    if (this._bestComboVal) this._bestComboVal.textContent = `${Widgets.plain(meta.records.highestCombo)}x`;
    if (this._shardsVal) this._shardsVal.textContent = Widgets.grouped(meta.shards);
  }

  public dispose(): void {
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
