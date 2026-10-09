import { IScreen, UiRoot } from '../UiRoot';
import { GameData } from '../../data/GameData';
import { MetaProgression } from '../../data/MetaProgression';
import { Widgets } from '../Widgets';
import { Services } from '../../core/Services';

/**
 * ============================================================================
 * OUROBOROS ASCENSION — PERMANENT META-SANCTUARY (SanctuaryScreen.ts)
 * ============================================================================
 *
 * Provides the interactive permanent progression hub where players invest
 * meta-currency (Ouroboros Stars ⭐ earned from floor clearances and boss kills)
 * into persistent upgrades that permanently enhance the serpent across all runs:
 *
 * 1. UPGRADE MATRIX (GameData.MetaUpgrades):
 *    - Max HP Boost (+Max Health pool across all serpent classes)
 *    - Initial Shield (+Absorption barrier on floor spawn)
 *    - Turn Agility (+Serpentine kinematic turn rate $\omega_{\text{turn}}$)
 *    - Dash Cooldown Reduction (-Dash recharge interval $\tau_{\text{dash}}$)
 *    - Golden Apple Frequency (+Spawn weight of high-tier radiant food)
 *    - Magnet Range (+Radial pickup reach $r_{\text{magnet}}$)
 *
 * 2. RESPEC STATE MACHINE & SAFETY CONFIRMATION:
 *    - Resetting permanent upgrades refunds 100% of invested Star currency.
 *    - Two-step armed confirmation pattern: Click 1 arms the button (`_resetArmed = true`)
 *      and starts a 4-second expiration timer (`_resetTimer`).
 *    - Click 2 within the 4-second window executes `meta.resetSanctuary()`, disarms, and refreshes.
 *
 * 3. TRACKED LISTENER & MEMORY LEAK PREVENTION:
 *    - All DOM event listeners are registered via `addTrackedListener()` into `_disposables`.
 *    - Cleaned up deterministically on `unmount()` and `dispose()`.
 * ============================================================================
 */
export class SanctuaryScreen implements IScreen {
  public readonly id: string = 'modal-sanctuary';
  public readonly element: HTMLElement;
  public readonly root: UiRoot;

  private _shardsValEl!: HTMLElement;
  private _gridEl!: HTMLElement;
  private _resetBtn!: HTMLButtonElement;
  private _resetArmed: boolean = false;
  private _resetTimer: number = 0;
  private _disposables: Array<() => void> = [];

  constructor(root: UiRoot) {
    this.root = root;
    if (typeof document !== 'undefined') {
      this.element = document.createElement('div');
      this.element.className = 'modal-overlay sanctuary-modal';
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
      <div class="modal-panel sanctuary-panel glass-panel" style="max-width: 900px; width: 95vw; max-height: min(92vh, 92dvh); display: flex; flex-direction: column; overflow: hidden;">
        <div class="modal-header" style="flex-shrink: 0;">
          <h2 class="cyber-modal-title">OUROBOROS SANCTUARY</h2>
          <p class="cyber-modal-subtitle">Permanent blessings forged with Ouroboros Stars</p>
        </div>

        <div class="sanctuary-shard-banner" style="flex-shrink: 0;">
          <div class="shard-pill-lg" title="Stars">
            <span>⭐</span>
            <span class="sanctuary-shards-val">0</span>
          </div>
        </div>

        <div class="sanctuary-grid-scroll-container" style="flex: 1 1 auto; min-height: 0; overflow-y: auto; -webkit-overflow-scrolling: touch; padding-bottom: 14px;">
          <div class="sanctuary-grid"></div>
        </div>

        <div class="modal-actions-row" style="flex-shrink: 0; margin-top: auto; padding-top: 8px; border-top: 1px solid rgba(148, 163, 184, 0.15); display: flex; justify-content: center; gap: 10px; flex-wrap: wrap;">
          <button class="cyber-btn btn-danger btn-reset-prog" style="flex: 1 1 auto; max-width: 220px; min-width: 140px;">Erase All Progress</button>
          <button class="cyber-btn btn-ghost btn-back" style="flex: 1 1 auto; max-width: 220px; min-width: 140px;">Return to Menu</button>
        </div>
      </div>
    `;

    this._shardsValEl = this.element.querySelector('.sanctuary-shards-val')!;
    this._gridEl = this.element.querySelector('.sanctuary-grid')!;
    this._resetBtn = this.element.querySelector('.btn-reset-prog') as HTMLButtonElement;

    const backBtn = this.element.querySelector('.btn-back') as HTMLButtonElement;
    if (backBtn) {
      this.addTrackedListener(backBtn, 'click', () => {
        Services.Sound.playUi();
        this.root.showScreen('modal-main-menu');
      });
    }

    if (this._resetBtn) {
      this.addTrackedListener(this._resetBtn, 'click', () => {
        if (!this._resetArmed) {
          this._resetArmed = true;
          this._resetBtn.textContent = 'Tap again to confirm';
          if (typeof window !== 'undefined') {
            this._resetTimer = window.setTimeout(() => {
              this._resetArmed = false;
              this._resetBtn.textContent = 'Erase All Progress';
            }, 5000);
          }
        } else {
          if (this._resetTimer) {
            clearTimeout(this._resetTimer);
            this._resetTimer = 0;
          }
          this._resetArmed = false;
          this._resetBtn.textContent = 'Erase All Progress';
          MetaProgression.instance.resetProgress();
          Services.Sound.playExplosion();
          this.refresh();
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
    this._resetArmed = false;
    if (this._resetBtn) {
      this._resetBtn.textContent = 'Erase All Progress';
    }
    if (this._resetTimer) {
      clearTimeout(this._resetTimer);
      this._resetTimer = 0;
    }
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

    if (this._shardsValEl) {
      this._shardsValEl.textContent = Widgets.grouped(meta.shards);
    }
    if (!this._gridEl) return;
    this._gridEl.innerHTML = '';

    // Upgrades
    const upgrades = GameData.MetaUpgrades;
    for (let i = 0; i < upgrades.count; i++) {
      const up = upgrades.at(i)!;
      const maxLvl = up.maxLevel || 5;
      const lvl = meta.getUpgradeLevel(up.key);
      const isMax = lvl >= maxLvl;
      const cost = meta.getUpgradeCost(up.key);
      const canAfford = !isMax && meta.shards >= cost;

      const card = document.createElement('div');
      card.className = `shop-item-card ${isMax ? 'maxed' : ''}`;

      let pipsHtml = '<div class="shop-pips-row" style="display: flex; gap: 4px; margin: 3px 0; flex-wrap: wrap;">';
      for (let p = 0; p < maxLvl; p++) {
        pipsHtml += `<div class="pip ${p < lvl ? 'filled' : ''}"></div>`;
      }
      pipsHtml += '</div>';

      card.innerHTML = `
        <div class="shop-item-header" style="display: flex; justify-content: space-between; align-items: center; gap: 6px;">
          <div style="display: flex; align-items: center; gap: 6px; min-width: 0; flex: 1 1 auto;">
            <span class="shop-item-icon" style="font-size: 16px; flex-shrink: 0;">${up.icon}</span>
            <span class="shop-item-name" style="font-weight: 700; font-size: 13px; color: #f8fafc; word-break: break-word;">${up.name}</span>
          </div>
          <span class="shop-item-lvl" style="font-size: 10px; color: #94a3b8; font-weight: 600; flex-shrink: 0; white-space: nowrap;">LVL ${lvl}/${maxLvl}</span>
        </div>
        <div class="shop-item-bonus" style="font-size: 11.5px; color: var(--gold-soft); line-height: 1.35; word-break: break-word;">${up.bonus}</div>
        ${pipsHtml}
        <button class="cyber-btn btn-sm ${canAfford ? 'btn-primary' : 'btn-secondary'} btn-buy" style="width: 100%; margin-top: auto; padding: 6px 10px; font-size: 11.5px; font-weight: 700;" ${!canAfford || isMax ? 'disabled' : ''}>
          ${isMax ? 'MAX LEVEL' : `⭐ ${Widgets.plain(cost)}`}
        </button>
      `;

      const buyBtn = card.querySelector('.btn-buy') as HTMLButtonElement;
      if (buyBtn && canAfford && !isMax) {
        buyBtn.addEventListener('click', () => {
          if (meta.buyUpgrade(up.key)) {
            Services.Sound.playLevelUp();
            this.refresh();
          } else {
            Services.Sound.playError();
          }
        });
      }

      this._gridEl.appendChild(card);
    }
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
