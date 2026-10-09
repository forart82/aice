import { IScreen, UiRoot } from '../UiRoot';
import { CardDef } from '../../data/Types';
import { Services } from '../../core/Services';
import { UiTheme } from '../UiTheme';

/**
 * Ouroboros Ascension — Upgrade Card Drafting Modal (DraftScreen.ts)
 *
 * Implements in-run roguelite card drafting on level-up or floor clearance:
 * - Displays 3 PRNG-offered upgrade cards with rarity styling (Common, Rare, Epic, Legendary).
 * - Handles card selection, reroll (spending reroll tokens), and skip actions.
 * - Human-Equivalent Bot standard: selections flow through `selectUpgradeCard()`.
 * - Zero memory leaks: registers tracked listeners in `_disposables` and unbinds them upon `dispose()`.
 */
export class DraftScreen implements IScreen {
  public readonly id: string = 'modal-level-up';
  public readonly element: HTMLElement;
  public readonly root: UiRoot;

  private _levelValueEl!: HTMLElement;
  private _deckEl!: HTMLElement;
  private _rerollBtn!: HTMLButtonElement;
  private _skipBtn!: HTMLButtonElement;
  private _disposables: Array<() => void> = [];

  /**
   * Constructs the upgrade card drafting modal and builds initial DOM tree.
   * @param root Parent UiRoot managing modal transitions
   */
  constructor(root: UiRoot) {
    this.root = root;
    if (typeof document !== 'undefined') {
      this.element = document.createElement('div');
      this.element.className = 'modal-overlay draft-modal';
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
      <div class="modal-panel draft-panel glass-panel" style="max-width: 900px; width: 95vw; max-height: min(94vh, 94dvh); display: flex; flex-direction: column; overflow: hidden;">
        <div class="modal-header" style="flex-shrink: 0;">
          <h2 class="draft-title">LEVEL <span class="draft-level-num">2</span> — EVOLUTION</h2>
          <p class="draft-subtitle">Select a genetic mutation to evolve your serpent</p>
        </div>

        <div class="cards-deck-grid" style="flex: 1 1 auto; min-height: 0; overflow-y: auto; -webkit-overflow-scrolling: touch; padding: 4px; padding-bottom: 12px;"></div>

        <div class="draft-actions-row" style="flex-shrink: 0; margin-top: auto; padding-top: 8px; border-top: 1px solid rgba(148, 163, 184, 0.15); display: flex; justify-content: center; gap: 10px; flex-wrap: wrap;">
          <button class="cyber-btn btn-secondary btn-reroll" style="flex: 1 1 auto; max-width: 200px; min-width: 130px;">🎲 Re-roll (1)</button>
          <button class="cyber-btn btn-ghost btn-skip" style="flex: 1 1 auto; max-width: 200px; min-width: 130px;">Skip → +25 HP</button>
        </div>
      </div>
    `;

    this._levelValueEl = this.element.querySelector('.draft-level-num')!;
    this._deckEl = this.element.querySelector('.cards-deck-grid')!;
    this._rerollBtn = this.element.querySelector('.btn-reroll') as HTMLButtonElement;
    this._skipBtn = this.element.querySelector('.btn-skip') as HTMLButtonElement;

    if (this._rerollBtn) {
      this.addTrackedListener(this._rerollBtn, 'click', () => {
        Services.Sound.playUi();
        if (this.root.engine && typeof this.root.engine.rerollDraft === 'function') {
          this.root.engine.rerollDraft();
        }
      });
    }

    if (this._skipBtn) {
      this.addTrackedListener(this._skipBtn, 'click', () => {
        Services.Sound.playUi();
        if (this.root.engine && typeof this.root.engine.skipDraft === 'function') {
          this.root.engine.skipDraft();
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
    // Unmount hook
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
    const engine = this.root.engine;
    if (!engine) return;

    if (engine.player && this._levelValueEl) {
      this._levelValueEl.textContent = `${engine.player.level || 2}`;
    }

    const rerolls = engine.rerollsRemaining !== undefined ? engine.rerollsRemaining : 1;
    if (this._rerollBtn) {
      this._rerollBtn.textContent = `🎲 Re-roll (${rerolls})`;
      this._rerollBtn.disabled = rerolls <= 0;
    }

    if (!this._deckEl) return;
    this._deckEl.innerHTML = '';
    const cards: CardDef[] = engine.currentDraftCards || [];

    for (let i = 0; i < cards.length; i++) {
      const card = cards[i]!;
      const cardId = card.id || card.Id || `card_${i}`;
      const rarity = (card.rarity || card.Rarity || 'common').toLowerCase();
      const icon = card.icon || card.Icon || '🧬';
      const title = card.title || card.Title || 'Mutation';
      const desc = card.desc || card.Desc || '';
      const stats = card.stats || card.Stats || '';
      const maxStacks = card.maxStacks || card.MaxStacks || 1;

      const owned = engine.player && engine.player.cardStacks
        ? (engine.player.cardStacks.get ? engine.player.cardStacks.get(cardId) : engine.player.cardStacks[cardId]) || 0
        : 0;

      const cardEl = document.createElement('div');
      cardEl.className = `upgrade-card rarity-${rarity}`;

      let rarityColor = UiTheme.Cyan;
      if (rarity === 'rare') rarityColor = UiTheme.Blue;
      else if (rarity === 'epic') rarityColor = UiTheme.Violet;
      else if (rarity === 'legendary') rarityColor = UiTheme.Gold;

      cardEl.innerHTML = `
        <div class="card-top-row" style="display: flex; justify-content: space-between; align-items: center; gap: 6px;">
          <span class="card-icon" style="font-size: 24px; line-height: 1;">${icon}</span>
          <div class="card-rarity-tag" style="color:${rarityColor}; font-weight: 700; font-size: 10px; letter-spacing: 0.08em;">${rarity.toUpperCase()}</div>
        </div>
        <div class="card-title" style="font-weight: 700; font-size: 14px; color: #f8fafc; margin-top: 2px; word-break: break-word;">${title}</div>
        <div class="card-desc" style="font-size: 11.5px; color: #94a3b8; line-height: 1.35; word-break: break-word;">${desc}</div>
        <div class="card-stats" style="font-size: 11.5px; color: var(--cyan); font-weight: 600; word-break: break-word;">${stats}</div>
        <div class="card-stack-tag" style="font-size: 10px; color: #94a3b8; margin-top: auto; padding-top: 4px; border-top: 1px solid rgba(148, 163, 184, 0.12);">Owned: ${owned} / ${maxStacks}</div>
      `;

      cardEl.addEventListener('click', () => {
        Services.Sound.playLevelUp();
        if (this.root.engine && typeof this.root.engine.selectUpgradeCard === 'function') {
          this.root.engine.selectUpgradeCard(card);
        }
        this.root.closeAllModals();
      });

      this._deckEl.appendChild(cardEl);
    }
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
