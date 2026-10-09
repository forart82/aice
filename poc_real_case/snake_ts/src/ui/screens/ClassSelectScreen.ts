import { IScreen, UiRoot } from '../UiRoot';
import { GameData } from '../../data/GameData';
import { SnakeClassDef } from '../../data/Types';
import { MetaProgression } from '../../data/MetaProgression';
import { Widgets } from '../Widgets';
import { Services } from '../../core/Services';
import { formatHelmetStatDescription, HELMET_RARITY_COLORS } from '../../data/Helmets';

/**
 * Ouroboros Ascension — Serpent Archetype & Helmet Selection Modal (ClassSelectScreen.ts)
 *
 * Provides expedition pre-launch loadout configuration:
 * - Unlocking and choosing one of the 5 serpent archetypes (Emerald Viper, Shadow Stalker, Hydra, Storm Wyrm, Solar Drake).
 * - Equipping head helmets and cranial augments unlocked from the MetaProgression vault.
 * - Enforces tracked listener disposal via `_disposables` and lifecycle isolation.
 */
export class ClassSelectScreen implements IScreen {
  public readonly id: string = 'modal-class-select';
  public readonly element: HTMLElement;
  public readonly root: UiRoot;

  private _subtitleEl!: HTMLElement;
  private _gridEl!: HTMLElement;
  private _helmetVaultEl!: HTMLElement;
  private _selectedClassId: string = 'emerald';
  private _disposables: Array<() => void> = [];

  /**
   * Initializes the Class Selection Modal DOM container and triggers initial DOM layout.
   * @param root Parent UiRoot coordinating modal navigation stacks
   */
  constructor(root: UiRoot) {
    this.root = root;
    if (typeof document !== 'undefined') {
      this.element = document.createElement('div');
      this.element.className = 'modal-overlay class-select-modal';
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
      <div class="modal-panel class-panel glass-panel" style="max-width: 960px; width: 95vw; max-height: min(92vh, 92dvh); display: flex; flex-direction: column; overflow: hidden;">
        <div class="modal-header" style="flex-shrink: 0;">
          <h2 class="cyber-modal-title">SELECT SERPENT ARCHETYPE & HELMET</h2>
          <p class="cyber-modal-subtitle">Choose your form and head equipment for this expedition</p>
        </div>

        <div class="class-cards-scroll-container" style="flex: 1 1 auto; min-height: 0; overflow-y: auto; -webkit-overflow-scrolling: touch; padding-bottom: 14px;">
          <div class="class-cards-grid"></div>
          <!-- Boss Helmet Loadout Vault -->
          <div class="helmet-vault-section" style="margin-top: 14px; width: 100%; display: flex; flex-direction: column; gap: 6px;"></div>
        </div>

        <div class="modal-actions-row" style="flex-shrink: 0; margin-top: auto; padding-top: 8px; border-top: 1px solid rgba(148, 163, 184, 0.15);">
          <button class="cyber-btn btn-ghost btn-back">Back</button>
          <button class="cyber-btn btn-primary btn-start btn-ascend">Start ⚡</button>
        </div>
      </div>
    `;

    this._subtitleEl = this.element.querySelector('.cyber-modal-subtitle')!;
    this._gridEl = this.element.querySelector('.class-cards-grid')!;
    this._helmetVaultEl = this.element.querySelector('.helmet-vault-section')!;

    const backBtn = this.element.querySelector('.btn-back') as HTMLButtonElement;
    if (backBtn) {
      this.addTrackedListener(backBtn, 'click', () => {
        Services.Sound.playUi();
        this.root.showScreen('modal-main-menu');
      });
    }

    const startBtn = (this.element.querySelector('.btn-start') || this.element.querySelector('.btn-ascend')) as HTMLButtonElement;
    if (startBtn) {
      this.addTrackedListener(startBtn, 'click', () => {
        Services.Sound.playUi();
        if (this.root.engine && typeof this.root.engine.startRun === 'function') {
          this.root.engine.selectedClass = this._selectedClassId;
          this.root.engine.startRun();
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
    const engine = this.root.engine;
    if (engine && engine.selectedClass) {
      this._selectedClassId = engine.selectedClass;
    }
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
    const engine = this.root.engine;
    const mode = engine ? engine.gameMode : 'rogue';

    this._subtitleEl.textContent =
      mode === 'daily'
        ? 'Daily Challenge — everyone plays the same seed today'
        : 'Choose your primordial form for this expedition';

    this._gridEl.innerHTML = '';
    const classes = GameData.Classes;

    for (let i = 0; i < classes.count; i++) {
      const cls = classes.at(i);
      if (!cls) continue;

      const classId = cls.id || cls.Id || 'emerald';
      const className = cls.name || cls.Name || 'Viper';
      const classIcon = cls.icon || cls.Icon || '🐍';
      const classColor = cls.color || cls.Color || '#00f0b5';
      const classCost = cls.cost !== undefined ? cls.cost : cls.Cost !== undefined ? cls.Cost : 0;
      const classPassive = cls.passive || cls.Passive || '';
      const skill = cls.skill || cls.Skill || { name: 'Skill', icon: '⚡', desc: '', cooldown: 10 };
      const baseStats = cls.baseStats || cls.BaseStats || { maxHp: 100, speed: 1, bitePower: 25 };

      const isUnlocked = meta.isUnlocked(classId);
      const isSelected = classId === this._selectedClassId;

      const card = document.createElement('div');
      card.className = `class-card ${isSelected ? 'selected' : ''} ${!isUnlocked ? 'locked' : ''}`;
      card.style.borderColor = isSelected ? classColor : 'rgba(148, 163, 184, 0.18)';

      let lockBadgeHtml = '';
      if (!isUnlocked) {
        lockBadgeHtml = `<div class="class-lock-badge">⭐ ${Widgets.plain(classCost)}</div>`;
      }

      card.innerHTML = `
        <div class="class-card-header" style="display: flex; align-items: center; justify-content: space-between; gap: 8px;">
          <div style="display: flex; align-items: center; gap: 8px; min-width: 0;">
            <span class="class-icon" style="color:${classColor}">${classIcon}</span>
            <span class="class-name" style="color:${classColor}; min-width: 0; word-break: break-word;">${className}</span>
          </div>
          ${lockBadgeHtml}
        </div>
        <div class="class-passive" style="word-break: break-word;">${classPassive}</div>
        <div class="class-skill" style="word-break: break-word;">
          <strong>${skill.icon || '⚡'} ${skill.name || 'Skill'}</strong> — ${skill.desc || ''} 
          <em>(${skill.cooldown || 10}s)</em>
        </div>
        <div class="class-stats-preview" style="display: flex; flex-wrap: wrap; gap: 4px 8px; align-items: center;">
          <span style="white-space: nowrap;">HP: ${baseStats.maxHp || 100}</span> • 
          <span style="white-space: nowrap;">SPD: ${Math.round((baseStats.speed || 1) * 100)}%</span> • 
          <span style="white-space: nowrap;">ATK: ${baseStats.bitePower || 25}</span>
        </div>
      `;

      card.addEventListener('click', () => {
        this.onCardClicked(cls, isUnlocked, isSelected);
      });

      this._gridEl.appendChild(card);
    }

    // 2. Render Helmet Vault Selector
    if (this._helmetVaultEl) {
      this._helmetVaultEl.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 4px; margin-bottom: 4px;">
          <span style="color: var(--gold-soft); font-weight: 700; font-size: clamp(11px, 2.8vw, 13px);">🪖 HELMET VAULT (EQUIPMENT LOADOUT)</span>
          <span style="color: #94a3b8; font-size: 11px;">${meta.helmets.length} Collected</span>
        </div>
        ${meta.helmets.length === 0 ? `
          <div style="background: rgba(15, 23, 42, 0.6); border: 1px dashed rgba(148, 163, 184, 0.25); border-radius: 6px; padding: 8px 12px; font-size: 11px; color: #94a3b8; text-align: center; margin-bottom: 6px;">
            ⚔️ Defeat Floor Bosses (Centipede, Colossus, Leviathan) during runs to loot and forge procedural cranial helmets.
          </div>
        ` : ''}
      `;

      const vaultContainer = document.createElement('div');
      vaultContainer.className = 'helmet-grid lab-card-grid';

      // Option 0: No Helmet
      const noHelmSelected = !meta.equippedHelmetId;
      const noHelmCard = document.createElement('div');
      noHelmCard.className = `helmet-card ${noHelmSelected ? 'selected' : ''}`;
      noHelmCard.style.padding = '8px 10px';

      noHelmCard.style.borderColor = noHelmSelected ? '#00f0b5' : 'rgba(148, 163, 184, 0.18)';
      noHelmCard.style.cursor = 'pointer';
      noHelmCard.innerHTML = `
        <div style="display:flex; justify-content: space-between; align-items: center; gap: 6px;">
          <span style="font-weight:700; color:#94a3b8; font-size:12px; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">🐍 No Helmet (Default)</span>
          <span style="font-size:10px; color:${noHelmSelected ? '#00f0b5' : '#64748b'}; font-weight:700; flex-shrink: 0;">${noHelmSelected ? 'EQUIPPED' : 'SELECT'}</span>
        </div>
        <div style="font-size:10px; color:#64748b; margin-top:2px; word-break: break-word;">Standard serpent without cranial equipment</div>
      `;
      noHelmCard.addEventListener('click', () => {
        Services.Sound.playUi();
        meta.equipHelmet(null);
        this.refresh();
      });
      vaultContainer.appendChild(noHelmCard);

      for (let i = 0; i < meta.helmets.length; i++) {
        const helm = meta.helmets[i]!;
        const hId = helm.id || helm.Id || '';
        const isEquipped = meta.equippedHelmetId === hId;
        const hRarity = (helm.rarity || helm.Rarity || 'common') as keyof typeof HELMET_RARITY_COLORS;
        const color = HELMET_RARITY_COLORS[hRarity] || '#ffd166';
        const hIcon = helm.icon || helm.Icon || '🪖';
        const hName = helm.name || helm.Name || 'Helmet';
        const hStats = helm.stats || helm.Stats || {};

        const hCard = document.createElement('div');
        hCard.className = `helmet-card ${isEquipped ? 'selected' : ''}`;
        hCard.style.padding = '8px 10px';

        hCard.style.borderColor = isEquipped ? color : 'rgba(148, 163, 184, 0.18)';
        hCard.style.cursor = 'pointer';

        hCard.innerHTML = `
          <div style="display:flex; justify-content: space-between; align-items: center; gap: 6px;">
            <span style="font-weight:700; color:${color}; font-size:12px; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${hIcon} ${hName} [${String(hRarity).toUpperCase()}]</span>
            <span style="font-size:10px; color:${isEquipped ? color : '#64748b'}; font-weight:700; flex-shrink: 0;">${isEquipped ? 'EQUIPPED' : 'EQUIP'}</span>
          </div>
          <div style="font-size:10px; color:#cbd5e1; margin-top:4px; word-break: break-word;">${formatHelmetStatDescription(hStats)}</div>
        `;

        hCard.addEventListener('click', () => {
          Services.Sound.playUi();
          meta.equipHelmet(isEquipped ? null : hId);
          this.refresh();
        });

        vaultContainer.appendChild(hCard);
      }

      this._helmetVaultEl.appendChild(vaultContainer);
    }
  }


  private onCardClicked(cls: SnakeClassDef, isUnlocked: boolean, alreadySelected: boolean): void {
    Services.Sound.playUi();
    const meta = MetaProgression.instance;
    const classId = cls.id || cls.Id || 'emerald';
    const className = cls.name || cls.Name || 'Viper';
    const classCost = cls.cost !== undefined ? cls.cost : cls.Cost !== undefined ? cls.Cost : 0;

    if (isUnlocked) {
      if (alreadySelected && this.root.engine && typeof this.root.engine.startRun === 'function') {
        this.root.engine.selectedClass = classId;
        this.root.engine.startRun();
        return;
      }
      this._selectedClassId = classId;
      if (this.root.engine) this.root.engine.selectedClass = classId;
      this.refresh();
      return;
    }

    if (meta.unlockClass(classId)) {
      Services.Sound.playLevelUp();
      this._selectedClassId = classId;
      if (this.root.engine) this.root.engine.selectedClass = classId;
      this.refresh();
    } else {
      Services.Sound.playError();
      if (this.root.engine && typeof this.root.engine.toast === 'function') {
        this.root.engine.toast(`Need ⭐ ${classCost} stars to unlock ${className}`);
      }
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
