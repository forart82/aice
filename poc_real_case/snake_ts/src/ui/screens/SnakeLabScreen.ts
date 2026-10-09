/**
 * Ouroboros Ascension — 3 Segregated Views Cranial Mutation Lab & Expedition Hub (SnakeLabScreen.ts)
 *
 * Architecture & Design Specification:
 * 1. 3 Distinct, Segregated Tab Views:
 *    - Tab 1: 🧬 Mutations (.btn-tab-lab)
 *      Renders the clean, uncluttered Cranial Mutation & Challenge Cards Grid (Offensive Weapons,
 *      Defensive Bio-Organs, Cranial Bio-Augmentations).
 *      Strictly 1 starter weapon ('turret') and 1 starter defense ('shield') unlocked at start;
 *      all others locked with their respective in-card challenge tracks.
 *    - Tab 2: 🪖 Helmets (N) (.btn-tab-helmets)
 *      Dedicated Boss Helmet Vault & active equipped helmet showcase card with rarity borders,
 *      stat affixes, and instant equip/unequip toggles.
 *    - Tab 3: 📊 Statistics (.btn-tab-stats / .btn-tab-telemetry)
 *      Dedicated in-run expedition telemetry view with Serpent Vitals grid, Nourishment & Harvest
 *      breakdown, Hostile Bestiary kills, and Conquered Apex Bosses history.
 * 2. Tab Switcher Segregation:
 *    Toggles cleanly and only displays the active view within the scrollable viewport.
 * 3. Top Header:
 *    - Title: 🧬 CRANIAL MUTATION LAB & EXPEDITION HUB (FLOOR ${floor})
 *    - 6 Quick Chips Bar: Ouro 🪙, Floor 🏛️, Length 🐍, Score ⭐, HP ❤️, Combo ⚡.
 *    - 3-Button Segmented Tab Bar: [ 🧬 Mutations ] [ 🪖 Helmets (N) ] [ 📊 Statistics ].
 * 4. Bottom Bar:
 *    Prominent DEPLOY / RESUME EXPEDITION ⚡ action button (.btn-deploy-serpent).
 */

import { IScreen, UiRoot } from '../UiRoot.js';
import { Services } from '../../core/Services.js';
import { MetaProgression } from '../../data/MetaProgression.js';
import { SnakePlayer } from '../../sim/SnakePlayer.js';
import { GameState } from '../../sim/GameState.js';
import { formatHelmetStatDescription, HELMET_RARITY_COLORS } from '../../data/Helmets.js';
import { GameData } from '../../data/GameData.js';
import { MathX } from '../../core/MathX.js';
import { Widgets } from '../Widgets.js';

export type SnakeLabTab = 'lab' | 'helmets' | 'telemetry';

export class SnakeLabScreen implements IScreen {
  public readonly id: string = 'modal-snake-lab';
  public readonly element: HTMLElement;
  public readonly root: UiRoot;

  private _titleEl!: HTMLElement;
  private _subtitleEl!: HTMLElement;
  private _pointsLabel!: HTMLElement;
  private _dockedCardContainer!: HTMLElement;
  private _deployBtn!: HTMLButtonElement;
  private _toastBanner!: HTMLElement;
  private _toastTimer: number | null = null;

  public static readonly HeadAugmentBaseCost = 40;
  public static readonly ModuleBaseCost = 30;
  public static readonly MaxModuleLevel = 3;
  public static readonly MaxAugmentLevel = 3;

  private _activeTab: SnakeLabTab = 'lab';
  private _tabLabBtn!: HTMLButtonElement;
  private _tabHelmetsBtn!: HTMLButtonElement;
  private _tabStatsBtn!: HTMLButtonElement;

  public get activeTab(): SnakeLabTab {
    return this._activeTab;
  }

  constructor(root: UiRoot) {
    this.root = root;
    if (typeof document !== 'undefined') {
      this.element = document.createElement('div');
      this.element.className = 'modal-overlay snake-lab-modal';
      this.build();
    } else {
      this.element = {} as HTMLElement;
    }
  }

  /**
   * Constructs the 3-tab segregated modal DOM structure:
   * - Top Header with modal title, cybernetic subtitle, close button, 6 quick stat chips, and toast alert banner.
   * - 3-Button Segmented Tab Bar: [ 🧬 Mutations ] [ 🪖 Helmets (N) ] [ 📊 Statistics ].
   * - Segregated scrollable viewport displaying ONLY the active tab content.
   * - Bottom Bar with prominent DEPLOY / RESUME EXPEDITION ⚡ action.
   */
  private build(): void {
    if (typeof document === 'undefined') return;
    this.element.innerHTML = `
      <div class="modal-panel lab-panel glass-panel" style="max-width: 1080px; width: 95vw; max-height: min(92vh, 92dvh); height: min(92vh, 92dvh); display: flex; flex-direction: column; gap: 8px; padding: 12px 14px; overflow: hidden;">
        <!-- Header Section -->
        <div class="lab-header" style="display: flex; flex-direction: column; gap: 6px; width: 100%; flex-shrink: 0;">
          <div style="display: flex; justify-content: space-between; align-items: flex-start; width: 100%;">
            <div style="text-align: left;">
              <h2 class="cyber-modal-title" style="margin: 0; font-size: clamp(14px, 2vw, 18px); letter-spacing: 0.06em;">🧬 CRANIAL MUTATION LAB & EXPEDITION HUB</h2>
              <p class="cyber-modal-subtitle lab-desc-text" style="margin: 0; font-size: clamp(10px, 1.2vw, 12px); color: #94a3b8;">Cranial augmentations, live tactical harvest, bestiary telemetry & cranial challenge tracking. Upgrade your Serpent Head with unlimited weapons & bio-organs, and equip Boss Helmets.</p>
            </div>
            <button class="cyber-btn btn-ghost btn-close-lab" style="padding: 4px 10px; font-size: 13px; border-radius: 6px; min-width: 44px; min-height: 44px;" aria-label="Close Lab">✕</button>
          </div>

          <!-- 6 Quick Stats Chips Bar: Ouro 🪙, Floor 🏛️, Length 🐍, Score ⭐, HP ❤️, Combo ⚡ -->
          <div class="lab-points-label" style="display: flex; gap: 6px; flex-wrap: wrap; align-items: center;"></div>

          <!-- In-Lab Purchase & Lock Warning Toast Banner -->
          <div class="lab-toast-banner" style="display: none; padding: 6px 12px; border-radius: 6px; font-size: 11px; font-weight: 700; text-align: center; margin: 2px 0; transition: all 0.2s ease-in-out;"></div>

          <!-- 3-Button Segmented Tab Bar: [ 🧬 Mutations ] [ 🪖 Helmets (N) ] [ 📊 Statistics ] -->
          <div class="lab-actions-row" style="display: flex; justify-content: space-between; align-items: center; gap: 8px; flex-wrap: wrap; margin-top: 2px;">
            <div class="lab-tab-group" style="display: flex; background: rgba(15, 23, 42, 0.8); border: 1px solid rgba(148, 163, 184, 0.2); border-radius: 8px; padding: 3px; gap: 4px; flex-wrap: wrap; flex: 1 1 auto;">
              <button class="cyber-btn btn-tab-lab btn-primary active" style="padding: 5px 14px; font-size: 11.5px; border-radius: 6px; flex: 1;">🧬 Mutations</button>
              <button class="cyber-btn btn-tab-helmets btn-secondary" style="padding: 5px 14px; font-size: 11.5px; border-radius: 6px; flex: 1;">🪖 Helmets (0)</button>
              <button class="cyber-btn btn-tab-stats btn-tab-telemetry btn-secondary" style="padding: 5px 14px; font-size: 11.5px; border-radius: 6px; flex: 1;">📊 Statistics</button>
            </div>
          </div>
        </div>

        <!-- Segregated Active Viewport: Houses ONLY the active tab content -->
        <div class="lab-docked-card-container lab-scroll-container" style="width: 100%; overflow-y: auto; flex: 1 1 auto; min-height: 0; max-height: none; display: flex; flex-direction: column; gap: 10px; padding-right: 4px; padding-bottom: 8px; -webkit-overflow-scrolling: touch;"></div>

        <!-- Bottom Bar: Prominent Deploy / Resume Action Button -->
        <div class="lab-bottom-bar" style="display: flex; justify-content: flex-end; align-items: center; gap: 8px; width: 100%; flex-shrink: 0; padding-top: 4px; border-top: 1px solid rgba(148, 163, 184, 0.15);">
          <button class="cyber-btn btn-primary btn-deploy-serpent" style="padding: 8px 24px; font-size: 12.5px; font-weight: 700; border-radius: 8px; box-shadow: 0 0 14px rgba(0, 240, 181, 0.35); width: 100%; max-width: 340px;">Deploy ⚡</button>
        </div>
      </div>
    `;

    this._titleEl = this.element.querySelector('.cyber-modal-title')!;
    this._subtitleEl = this.element.querySelector('.cyber-modal-subtitle')!;
    this._pointsLabel = this.element.querySelector('.lab-points-label')!;
    this._toastBanner = this.element.querySelector('.lab-toast-banner')!;
    this._dockedCardContainer = this.element.querySelector('.lab-docked-card-container')!;
    this._deployBtn = this.element.querySelector('.btn-deploy-serpent')!;
    this._tabLabBtn = this.element.querySelector('.btn-tab-lab')!;
    this._tabHelmetsBtn = this.element.querySelector('.btn-tab-helmets')!;
    this._tabStatsBtn = this.element.querySelector('.btn-tab-stats') || this.element.querySelector('.btn-tab-telemetry')!;

    const closeBtn = this.element.querySelector('.btn-close-lab') as HTMLButtonElement;
    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        Services.Sound.playUi();
        const eng = this.root.engine;
        if (
          eng &&
          (eng.state === GameState.LevelUp ||
            eng.State === GameState.LevelUp ||
            eng.state === 'LevelUp' ||
            eng.State === 'LevelUp')
        ) {
          eng.completeLevelUp();
          this.root.closeAllModals();
        } else if (
          eng &&
          (eng.state === GameState.Playing ||
            eng.State === GameState.Playing ||
            eng.state === GameState.Paused ||
            eng.State === GameState.Paused ||
            eng.state === 'Paused' ||
            eng.State === 'Paused')
        ) {
          eng.resume();
          this.root.closeAllModals();
        } else {
          this.root.hideScreen('modal-snake-lab');
        }
      });
    }

    // 3 Tab Switcher Listeners
    if (this._tabLabBtn) {
      this._tabLabBtn.addEventListener('click', () => {
        this.setTab('lab');
      });
    }

    if (this._tabHelmetsBtn) {
      this._tabHelmetsBtn.addEventListener('click', () => {
        this.setTab('helmets');
      });
    }

    if (this._tabStatsBtn) {
      this._tabStatsBtn.addEventListener('click', () => {
        this.setTab('telemetry');
      });
    }

    this._deployBtn.addEventListener('click', () => {
      Services.Sound.playUi();
      const eng = this.root.engine;
      if (eng) {
        if (
          eng.state === GameState.LevelUp ||
          eng.State === GameState.LevelUp ||
          eng.state === 'LevelUp' ||
          eng.State === 'LevelUp'
        ) {
          eng.completeLevelUp();
        } else {
          eng.resume();
        }
      }
      this.root.hideModals();
    });
  }

  /**
   * Switches the active tab view cleanly, plays UI sound, and re-renders ONLY the active view.
   */
  public setTab(tab: SnakeLabTab | 'mutations' | 'stats' | 'statistics' | 'challenges' | 'run'): void {
    if (tab === 'helmets') {
      this._activeTab = 'helmets';
    } else if (tab === 'telemetry' || tab === 'stats' || tab === 'statistics' || tab === 'run') {
      this._activeTab = 'telemetry';
    } else {
      this._activeTab = 'lab';
    }
    Services.Sound.playUi();
    this.refresh();
  }

  private _disposables: Array<() => void> = [];

  public mount(container?: HTMLElement): void {
    if (container && this.element && !this.element.parentElement && typeof container.appendChild === 'function') {
      container.appendChild(this.element);
    }
  }

  public render(): void {
    this.refresh();
  }

  public unmount(): void {
    if (this._toastTimer !== null) {
      clearTimeout(this._toastTimer);
      this._toastTimer = null;
    }
    if (this._toastBanner) {
      this._toastBanner.style.display = 'none';
    }
  }

  public show(payload?: unknown): void {
    if (typeof payload === 'string') {
      if (payload === 'helmets') this._activeTab = 'helmets';
      else if (payload === 'telemetry' || payload === 'stats' || payload === 'statistics' || payload === 'run') this._activeTab = 'telemetry';
      else this._activeTab = 'lab';
    } else if (payload && typeof payload === 'object') {
      const p = payload as Record<string, unknown>;
      if (p.tab === 'helmets') this._activeTab = 'helmets';
      else if (p.tab === 'telemetry' || p.tab === 'stats' || p.tab === 'statistics' || p.mode === 'run' || p.tab === 'run') this._activeTab = 'telemetry';
      else this._activeTab = 'lab';
    }
    if (this.element && this.element.style) {
      this.element.style.display = 'flex';
    }
    this.refresh();
    this.render();
  }

  /**
   * Resets timer states and hides temporary notifications when closing modal.
   */
  public hide(): void {
    if (this.element && this.element.style) {
      this.element.style.display = 'none';
    }
    this.unmount();
  }

  /**
   * Displays an interactive in-lab toast banner for purchase affordances, insufficient funds, or tier locks.
   * Auto-dismisses after 3500ms and provides distinct cybernetic visual feedback.
   * @param message Informational or error text string to display
   * @param isError True for insufficient funds or lock alerts, false for positive info
   */
  public showToast(message: string, isError: boolean = true): void {
    if (!this._toastBanner) return;
    if (this._toastTimer !== null) {
      clearTimeout(this._toastTimer);
      this._toastTimer = null;
    }
    this._toastBanner.textContent = message;
    this._toastBanner.className = `lab-toast-banner ${isError ? 'error' : 'info'}`;
    this._toastBanner.style.display = 'block';

    if (isError) {
      this._toastBanner.style.background = 'rgba(239, 68, 68, 0.2)';
      this._toastBanner.style.border = '1px solid #ef4444';
      this._toastBanner.style.color = '#fca5a5';
      this._toastBanner.style.boxShadow = '0 0 12px rgba(239, 68, 68, 0.3)';
    } else {
      this._toastBanner.style.background = 'rgba(0, 240, 181, 0.15)';
      this._toastBanner.style.border = '1px solid var(--cyan)';
      this._toastBanner.style.color = '#6ee7b7';
      this._toastBanner.style.boxShadow = '0 0 12px rgba(0, 240, 181, 0.3)';
    }

    if (typeof window !== 'undefined') {
      this._toastTimer = window.setTimeout(() => {
        if (this._toastBanner) {
          this._toastBanner.style.display = 'none';
        }
        this._toastTimer = null;
      }, 3500);
    }
  }

  /**
   * Synchronizes 3-button segmented tab button active state classes and labels.
   */
  private updateTabStyles(): void {
    const meta = MetaProgression.Instance;
    const helmCount = meta.Helmets ? meta.Helmets.length : (meta.helmets ? meta.helmets.length : 0);

    if (this._tabLabBtn) {
      this._tabLabBtn.className = `cyber-btn btn-tab-lab ${this._activeTab === 'lab' ? 'btn-primary active' : 'btn-secondary'}`;
      this._tabLabBtn.textContent = '🧬 Mutations';
    }
    if (this._tabHelmetsBtn) {
      this._tabHelmetsBtn.className = `cyber-btn btn-tab-helmets ${this._activeTab === 'helmets' ? 'btn-primary active' : 'btn-secondary'}`;
      this._tabHelmetsBtn.textContent = `🪖 Helmets (${helmCount})`;
    }
    if (this._tabStatsBtn) {
      this._tabStatsBtn.className = `cyber-btn btn-tab-stats btn-tab-telemetry ${this._activeTab === 'telemetry' ? 'btn-primary active' : 'btn-secondary'}`;
      this._tabStatsBtn.textContent = '📊 Statistics';
    }
  }

  /**
   * Refreshes the Cranial Mutation Lab & Expedition Hub:
   * 1. Top Header: Title with Floor, 6 Quick Vitals Chips.
   * 2. 3-Button Segmented Tab Bar: Updates active styles & helmet counter.
   * 3. Segregated Active Viewport: Renders ONLY the active tab view.
   */
  public refresh(): void {
    const player = this.root.engine?.player ?? this.root.engine?.Player;
    const combat = this.root.engine?.combat ?? this.root.engine?.Combat;
    const floor = this.root.engine?.currentFloor ?? this.root.engine?.CurrentFloor ?? 1;

    if (this._titleEl) {
      this._titleEl.textContent = `🧬 CRANIAL MUTATION LAB & EXPEDITION HUB (FLOOR ${floor})`;
    }
    if (this._subtitleEl) {
      this._subtitleEl.textContent = 'Cranial augmentations, live tactical harvest, bestiary telemetry & cranial challenge tracking. Upgrade your Serpent Head with unlimited weapons & bio-organs, and equip Boss Helmets.';
    }

    this.updateTabStyles();

    // 1. TOP HEADER: 6 Quick Stats Chips Bar
    if (this._pointsLabel) {
      const curOuro = Math.floor(player ? (player.ouro ?? player.xp ?? 0) : 0);
      const headHp = player?.headHp !== undefined ? player.headHp : (player?.HeadHp !== undefined ? player.HeadHp : 50);
      const headMaxHp = player?.headMaxHp !== undefined ? player.headMaxHp : (player?.HeadMaxHp !== undefined ? player.HeadMaxHp : 50);
      const segCount = (player?.segments ? player.segments.length : (player?.Segments ? player.Segments.length : 0)) + 1;
      const score = combat ? (combat.score ?? combat.Score ?? 0) : 0;
      const combo = combat ? (combat.comboCount ?? combat.ComboCount ?? 0) : 0;

      this._pointsLabel.innerHTML = `
        <span class="lab-stat-chip lab-stat-chip-ouro" style="font-size: 11px; font-weight: 800; color: var(--gold-soft); background: rgba(255, 209, 102, 0.12); padding: 4px 10px; border-radius: 6px; border: 1.5px solid var(--gold-soft); box-shadow: 0 0 12px rgba(255, 209, 102, 0.45), inset 0 0 6px rgba(255, 209, 102, 0.2);">🪙 ${curOuro} Ouro</span>
        <span class="lab-stat-chip" style="font-size: 11px; font-weight: 700; color: #38bdf8; background: rgba(15, 23, 42, 0.85); padding: 3px 8px; border-radius: 6px; border: 1px solid rgba(56, 189, 248, 0.3);">🏛️ Floor ${floor}</span>
        <span class="lab-stat-chip" style="font-size: 11px; font-weight: 700; color: #a78bfa; background: rgba(15, 23, 42, 0.85); padding: 3px 8px; border-radius: 6px; border: 1px solid rgba(167, 139, 250, 0.3);">🐍 Len ${segCount} (📏 ${segCount} Segs)</span>
        <span class="lab-stat-chip" style="font-size: 11px; font-weight: 700; color: #ffd166; background: rgba(15, 23, 42, 0.85); padding: 3px 8px; border-radius: 6px; border: 1px solid rgba(255, 209, 102, 0.3);">⭐ ${score}</span>
        <span class="lab-stat-chip" style="font-size: 11px; font-weight: 700; color: #4ade80; background: rgba(15, 23, 42, 0.85); padding: 3px 8px; border-radius: 6px; border: 1px solid rgba(74, 222, 128, 0.3);">❤️ ${Math.ceil(headHp)}/${headMaxHp}</span>
        <span class="lab-stat-chip" style="font-size: 11px; font-weight: 700; color: #f87171; background: rgba(15, 23, 42, 0.85); padding: 3px 8px; border-radius: 6px; border: 1px solid rgba(248, 113, 113, 0.3);">⚡ ${combo}x</span>
      `;
    }

    // 2. SEGREGATED ACTIVE VIEWPORT: Renders ONLY the active tab content
    if (this._dockedCardContainer) {
      this._dockedCardContainer.innerHTML = '';

      if (this._activeTab === 'lab') {
        // Tab 1: 🧬 Mutations (Cranial Mutation & Challenge Cards Grid)
        this.renderCranialMutationSection();
      } else if (this._activeTab === 'helmets') {
        // Tab 2: 🪖 Helmets (Boss Helmet Vault & Active Loadout Showcase)
        this.renderHelmetVaultSection();
      } else if (this._activeTab === 'telemetry') {
        // Tab 3: 📊 Statistics (Expedition Telemetry, Vitals, Nourishment, Bestiary, Boss Defeats)
        this.renderTelemetrySection();
      }
    }
  }

  /**
   * Tab 3: Dedicated In-Run Expedition Telemetry View.
   * Renders Serpent Vitals grid, Nourishment & Harvest breakdown, Hostile Bestiary kills, and Conquered Apex Bosses history.
   */
  private renderTelemetrySection(): void {
    if (!this._dockedCardContainer) return;
    const player = this.root.engine?.player ?? this.root.engine?.Player;
    const combat = this.root.engine?.combat ?? this.root.engine?.Combat;
    const floor = this.root.engine?.currentFloor ?? this.root.engine?.CurrentFloor ?? 1;

    const scoreVal = combat ? (combat.score ?? combat.Score ?? 0) : 0;
    const curOuro = Math.floor(player ? (player.ouro ?? player.xp ?? 0) : 0);
    const shardsVal = combat ? (combat.shardsEarned !== undefined ? combat.shardsEarned : (combat.ShardsEarned || 0)) : 0;
    const curLen = (player?.segments ? player.segments.length : (player?.Segments ? player.Segments.length : 0)) + 1;
    const peakLen = player?.peakLength ?? player?.PeakLength ?? curLen;
    const comboVal = combat ? (combat.comboCount ?? combat.ComboCount ?? 0) : 0;
    const highCombo = combat ? (combat.highestRunCombo ?? combat.HighestRunCombo ?? combat.highestCombo ?? combat.HighestCombo ?? comboVal) : 0;
    const headHp = player?.headHp !== undefined ? player.headHp : (player?.HeadHp !== undefined ? player.HeadHp : 50);
    const headMaxHp = player?.headMaxHp !== undefined ? player.headMaxHp : (player?.HeadMaxHp !== undefined ? player.HeadMaxHp : 50);
    const className = player?.classConfig?.name || player?.classConfig?.Name || 'Emerald Viper';
    const classIcon = player?.classConfig?.icon || player?.classConfig?.Icon || '🐍';

    const foodsByType = combat?.foodsEatenByType || combat?.FoodsEatenByType || {};
    const killsByType = combat?.killsByType || combat?.KillsByType || {};

    const card = this.createGlassCard('lab-section lab-section-telemetry lab-section-stats', 'lab-section-telemetry');
    const vbox = document.createElement('div');
    vbox.style.display = 'flex';
    vbox.style.flexDirection = 'column';
    vbox.style.gap = '8px';
    card.appendChild(vbox);

    // Section Header
    const hdr = this.createSectionHeader('📊 EXPEDITION VITALS & TELEMETRY HUB');
    vbox.appendChild(hdr);

    // Vitals Grid
    const vitalsGrid = document.createElement('div');
    vitalsGrid.className = 'stats-vitals-grid run-telemetry-grid run-telemetry-section stats-grid';
    vitalsGrid.style.display = 'grid';
    vitalsGrid.style.gridTemplateColumns = 'repeat(auto-fit, minmax(110px, 1fr))';
    vitalsGrid.style.gap = '6px';
    vitalsGrid.innerHTML = `
      <div class="stat-card">
        <span class="stat-label">FLOOR</span>
        <span class="stat-val stat-floor-val">${floor}</span>
      </div>
      <div class="stat-card">
        <span class="stat-label">CURRENT SCORE</span>
        <span class="stat-val stat-score stat-score-val" style="color: #38bdf8;">${Widgets.grouped(scoreVal)}</span>
      </div>
      <div class="stat-card">
        <span class="stat-label">OURO WALLET</span>
        <span class="stat-val stat-ouro stat-ouro-val" style="color: var(--gold-soft);">${curOuro} 🪙</span>
      </div>
      <div class="stat-card">
        <span class="stat-label">STARS BANKED</span>
        <span class="stat-val stat-shards-val" style="color: #ffd166;">+${shardsVal} ⭐</span>
      </div>
      <div class="stat-card">
        <span class="stat-label">SERPENT LENGTH</span>
        <span class="stat-val stat-length stat-length-val" style="color: #00f0b5;">${curLen}</span>
      </div>
      <div class="stat-card">
        <span class="stat-label">PEAK LENGTH</span>
        <span class="stat-val stat-peak-length" style="color: #c084fc;">${peakLen}</span>
      </div>
      <div class="stat-card">
        <span class="stat-label">CURRENT COMBO</span>
        <span class="stat-val stat-curcombo-val" style="color: var(--gold-soft);">${comboVal}x</span>
      </div>
      <div class="stat-card">
        <span class="stat-label">HIGH COMBO</span>
        <span class="stat-val stat-combo stat-combo-val" style="color: #f87171;">${highCombo}x</span>
      </div>
      <div class="stat-card">
        <span class="stat-label">HEAD HEALTH</span>
        <span class="stat-val stat-headhp-val" style="color: #f87171;">${Math.ceil(headHp)}/${headMaxHp}</span>
      </div>
      <div class="stat-card">
        <span class="stat-label">CLASS</span>
        <span class="stat-val stat-class-val" style="color: #a78bfa;">${classIcon} ${className}</span>
      </div>
    `;
    vbox.appendChild(vitalsGrid);

    // Nourishment Breakdown Grid
    const foodHdr = document.createElement('div');
    foodHdr.style.fontSize = '11px';
    foodHdr.style.fontWeight = '700';
    foodHdr.style.color = '#10b981';
    foodHdr.style.textAlign = 'left';
    foodHdr.style.marginTop = '2px';
    foodHdr.textContent = '🍏 NOURISHMENT & HARVEST BREAKDOWN';
    vbox.appendChild(foodHdr);

    const foodGrid = document.createElement('div');
    foodGrid.className = 'food-breakdown-grid';
    foodGrid.style.display = 'grid';
    foodGrid.style.gridTemplateColumns = 'repeat(auto-fit, minmax(105px, 1fr))';
    foodGrid.style.gap = '6px';
    foodGrid.innerHTML = `
      <div class="food-pill stat-card" style="display: flex; justify-content: space-between; align-items: center; padding: 5px 8px;">
        <span style="font-size: 11px;">🍏 Apples</span>
        <span class="food-apple-count" style="font-size: 11.5px; font-weight: 700; color: #10b981;">${foodsByType['apple'] || 0}</span>
      </div>
      <div class="food-pill stat-card" style="display: flex; justify-content: space-between; align-items: center; padding: 5px 8px;">
        <span style="font-size: 11px;">🌟 Golden</span>
        <span class="food-golden-count" style="font-size: 11.5px; font-weight: 700; color: #ffb703;">${foodsByType['golden'] || 0}</span>
      </div>
      <div class="food-pill stat-card" style="display: flex; justify-content: space-between; align-items: center; padding: 5px 8px;">
        <span style="font-size: 11px;">❤️ Potions</span>
        <span class="food-potion-count" style="font-size: 11.5px; font-weight: 700; color: #ff3366;">${foodsByType['potion'] || 0}</span>
      </div>
      <div class="food-pill stat-card" style="display: flex; justify-content: space-between; align-items: center; padding: 5px 8px;">
        <span style="font-size: 11px;">⭐ Stars</span>
        <span class="food-shard-count" style="font-size: 11.5px; font-weight: 700; color: #ffd166;">${foodsByType['shard'] || 0}</span>
      </div>
      <div class="food-pill stat-card" style="display: flex; justify-content: space-between; align-items: center; padding: 5px 8px;">
        <span style="font-size: 11px;">🔮 Prisms</span>
        <span class="food-prism-count" style="font-size: 11.5px; font-weight: 700; color: #f472b6;">${foodsByType['prism'] || 0}</span>
      </div>
    `;
    vbox.appendChild(foodGrid);

    // Hostile Bestiary Grid
    const bestiaryHdr = document.createElement('div');
    bestiaryHdr.style.fontSize = '11px';
    bestiaryHdr.style.fontWeight = '700';
    bestiaryHdr.style.color = '#f87171';
    bestiaryHdr.style.textAlign = 'left';
    bestiaryHdr.style.marginTop = '2px';
    bestiaryHdr.textContent = '👾 HOSTILE BESTIARY ELIMINATIONS';
    vbox.appendChild(bestiaryHdr);

    const bestiaryGrid = document.createElement('div');
    bestiaryGrid.className = 'bestiary-grid';
    bestiaryGrid.style.display = 'grid';
    bestiaryGrid.style.gridTemplateColumns = 'repeat(auto-fit, minmax(105px, 1fr))';
    bestiaryGrid.style.gap = '6px';
    bestiaryGrid.innerHTML = `
      <div class="bestiary-pill stat-card" style="display: flex; justify-content: space-between; align-items: center; padding: 5px 8px;">
        <span style="font-size: 11px;">👾 Swarmlings</span>
        <span class="kill-swarmling-count" style="font-size: 11.5px; font-weight: 700; color: #fb7185;">${killsByType['swarmling'] || 0}</span>
      </div>
      <div class="bestiary-pill stat-card" style="display: flex; justify-content: space-between; align-items: center; padding: 5px 8px;">
        <span style="font-size: 11px;">🪲 Scarabs</span>
        <span class="kill-scarab-count" style="font-size: 11.5px; font-weight: 700; color: #ef4444;">${killsByType['scarab'] || 0}</span>
      </div>
      <div class="bestiary-pill stat-card" style="display: flex; justify-content: space-between; align-items: center; padding: 5px 8px;">
        <span style="font-size: 11px;">🦂 Spitters</span>
        <span class="kill-spitter-count" style="font-size: 11.5px; font-weight: 700; color: #c084fc;">${killsByType['spitter'] || 0}</span>
      </div>
      <div class="bestiary-pill stat-card" style="display: flex; justify-content: space-between; align-items: center; padding: 5px 8px;">
        <span style="font-size: 11px;">👻 Phantoms</span>
        <span class="kill-phantom-count" style="font-size: 11.5px; font-weight: 700; color: #f43f5e;">${killsByType['phantom'] || 0}</span>
      </div>
      <div class="bestiary-pill stat-card" style="display: flex; justify-content: space-between; align-items: center; padding: 5px 8px;">
        <span style="font-size: 11px;">🛸 Arc Drones</span>
        <span class="kill-drone-count" style="font-size: 11.5px; font-weight: 700; color: #38bdf8;">${killsByType['drone'] || 0}</span>
      </div>
      <div class="bestiary-pill stat-card" style="display: flex; justify-content: space-between; align-items: center; padding: 5px 8px;">
        <span style="font-size: 11px;">👹 Magma Brutes</span>
        <span class="kill-brute-count" style="font-size: 11.5px; font-weight: 700; color: #f97316;">${killsByType['brute'] || 0}</span>
      </div>
    `;
    vbox.appendChild(bestiaryGrid);

    // Conquered Apex Bosses History
    const bossHdr = document.createElement('div');
    bossHdr.style.fontSize = '11px';
    bossHdr.style.fontWeight = '700';
    bossHdr.style.color = '#ffd166';
    bossHdr.style.textAlign = 'left';
    bossHdr.style.marginTop = '2px';
    bossHdr.textContent = '👑 CONQUERED APEX BOSSES';
    vbox.appendChild(bossHdr);

    const bossList = document.createElement('div');
    bossList.className = 'boss-defeats-list';
    bossList.style.display = 'flex';
    bossList.style.flexDirection = 'column';
    bossList.style.gap = '4px';
    bossList.style.background = 'rgba(15, 23, 42, 0.6)';
    bossList.style.border = '1px solid rgba(148, 163, 184, 0.2)';
    bossList.style.borderRadius = '8px';
    bossList.style.padding = '8px 10px';
    bossList.style.fontSize = '11px';

    const defeatedTypes: string[] = combat?.defeatedBossTypes || combat?.DefeatedBossTypes || [];
    if (defeatedTypes.length === 0) {
      bossList.innerHTML = '<span style="color: #64748b; font-style: italic;">No Apex Bosses conquered yet in this expedition.</span>';
    } else {
      defeatedTypes.forEach((type, idx) => {
        const bossDef = GameData.Bosses.find(b => b.Type === type || b.type === type);
        const name = bossDef ? (bossDef.Name || bossDef.name) : (type.charAt(0).toUpperCase() + type.slice(1));
        const row = document.createElement('div');
        row.style.display = 'flex';
        row.style.justifyContent = 'space-between';
        row.style.alignItems = 'center';
        row.innerHTML = `
          <span>👑 <strong>Floor ${idx + 1}:</strong> ${name}</span>
          <span style="color: #ffd166; font-size: 10.5px; font-weight: 700;">CLEARED ⚡</span>
        `;
        bossList.appendChild(row);
      });
    }
    vbox.appendChild(bossList);

    this._dockedCardContainer.appendChild(card);
  }

  /**
   * Tab 2: Dedicated Boss Helmet Vault & Active Loadout Showcase.
   * Renders active equipped helmet card with instant unequip toggle, and collected boss helmets grid with instant equip toggles.
   */
  private renderHelmetVaultSection(): void {
    if (!this._dockedCardContainer) return;
    const player = this.root.engine?.player ?? this.root.engine?.Player;
    const meta = MetaProgression.Instance;

    const card = this.createGlassCard('lab-section lab-section-helmets', 'lab-section-helmets');
    const vbox = document.createElement('div');
    vbox.style.display = 'flex';
    vbox.style.flexDirection = 'column';
    vbox.style.gap = '8px';
    card.appendChild(vbox);

    const hdr = this.createSectionHeader('🪖 BOSS HELMET VAULT & ACTIVE LOADOUT');
    vbox.appendChild(hdr);

    // Active Equipped Helmet Showcase
    const eqHelmet = (player as any)?.equippedHelmet || (player as any)?.EquippedHelmet || meta.GetEquippedHelmet();
    const equippedContainer = document.createElement('div');
    equippedContainer.className = 'equipped-helmet-container equipped-helmet-card';
    equippedContainer.style.background = 'rgba(15, 23, 42, 0.9)';
    equippedContainer.style.border = `1.5px solid ${eqHelmet ? (HELMET_RARITY_COLORS[eqHelmet.rarity as keyof typeof HELMET_RARITY_COLORS] || '#ffd166') : 'rgba(148, 163, 184, 0.3)'}`;
    equippedContainer.style.borderRadius = '8px';
    equippedContainer.style.padding = '8px 12px';
    equippedContainer.style.display = 'flex';
    equippedContainer.style.justifyContent = 'space-between';
    equippedContainer.style.alignItems = 'center';
    equippedContainer.style.gap = '10px';

    if (eqHelmet) {
      const rarityColor = HELMET_RARITY_COLORS[eqHelmet.rarity as keyof typeof HELMET_RARITY_COLORS] || '#ffd166';
      equippedContainer.innerHTML = `
        <div style="display: flex; align-items: center; gap: 10px; min-width: 0; flex: 1 1 200px;">
          <span style="font-size: 24px; flex-shrink: 0;">${eqHelmet.icon || '🪖'}</span>
          <div style="text-align: left; min-width: 0;">
            <div style="font-weight: 700; color: ${rarityColor}; font-size: 12.5px; display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
              <span>${eqHelmet.name || eqHelmet.Name} [${(eqHelmet.rarity || eqHelmet.Rarity || 'common').toUpperCase()}]</span>
              <span style="font-size: 9.5px; color: #38bdf8; font-weight: 700; background: rgba(56, 189, 248, 0.15); padding: 2px 6px; border-radius: 4px; border: 1px solid rgba(56, 189, 248, 0.3); white-space: nowrap;">ACTIVE HELMET</span>
            </div>
            <div style="font-size: 11px; color: #94a3b8; margin-top: 2px;">${formatHelmetStatDescription(eqHelmet.stats || eqHelmet.Stats || {})}</div>
            <div style="font-size: 9.5px; color: #64748b; font-style: italic; margin-top: 2px;">${eqHelmet.description || eqHelmet.Description || ''}</div>
          </div>
        </div>
      `;
      const unequipBtn = document.createElement('button');
      unequipBtn.className = 'cyber-btn btn-unequip-helmet btn-secondary';
      unequipBtn.style.padding = '6px 14px';
      unequipBtn.style.fontSize = '11px';
      unequipBtn.style.fontWeight = '700';
      unequipBtn.style.flexShrink = '0';
      unequipBtn.textContent = 'Unequip ✕';
      unequipBtn.addEventListener('click', () => {
        meta.EquipHelmet(null);
        if (player) {
          player.EquippedHelmet = null;
          player.equippedHelmet = null;
        }
        Services.Sound.playUi();
        this.refresh();
      });
      equippedContainer.appendChild(unequipBtn);
    } else {
      equippedContainer.innerHTML = `
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="font-size: 20px; flex-shrink: 0;">🪖</span>
          <div style="font-size: 11px; color: #94a3b8; text-align: left;">
            No Boss Helmet equipped. Select a helmet from your vault below to gain powerful persistent cybernetic affixes!
          </div>
        </div>
      `;
    }
    vbox.appendChild(equippedContainer);

    // Collected Boss Helmets Vault Grid
    const helmetsList = meta.Helmets || meta.helmets || [];
    const vaultSubtitle = document.createElement('div');
    vaultSubtitle.style.fontSize = '11px';
    vaultSubtitle.style.fontWeight = '700';
    vaultSubtitle.style.color = 'var(--gold-soft)';
    vaultSubtitle.style.textAlign = 'left';
    vaultSubtitle.textContent = `🪖 COLLECTED BOSS HELMETS (${helmetsList.length})`;
    vbox.appendChild(vaultSubtitle);

    const galleryBanner = document.createElement('div');
    galleryBanner.style.display = 'flex';
    galleryBanner.style.justifyContent = 'flex-start';
    galleryBanner.style.alignItems = 'center';
    galleryBanner.style.margin = '4px 0 8px 0';

    const galleryBtn = document.createElement('button');
    galleryBtn.className = 'cyber-btn btn-secondary btn-goto-gallery';
    galleryBtn.style.fontSize = '11px';
    galleryBtn.style.padding = '5px 12px';
    galleryBtn.textContent = '🌌 Ouroboros Gallery';
    galleryBtn.addEventListener('click', () => {
      Services.Sound.playUi();
      this.root.showScreen('modal-ouroboros-gallery');
    });
    galleryBanner.appendChild(galleryBtn);
    vbox.appendChild(galleryBanner);

    if (helmetsList.length === 0) {
      const emptyNotice = document.createElement('div');
      emptyNotice.style.background = 'rgba(6, 12, 24, 0.7)';
      emptyNotice.style.border = '1px dashed rgba(148, 163, 184, 0.25)';
      emptyNotice.style.borderRadius = '6px';
      emptyNotice.style.padding = '12px';
      emptyNotice.style.textAlign = 'center';
      emptyNotice.style.color = '#94a3b8';
      emptyNotice.style.fontSize = '11px';
      emptyNotice.innerHTML = `
        <div style="font-weight: 700; color: #f8fafc; margin-bottom: 2px;">HELMET VAULT EMPTY</div>
        <div>Defeat Floor Bosses during your runs to extract and forge procedural Boss Helmets!</div>
      `;
      vbox.appendChild(emptyNotice);
    } else {
      const grid = document.createElement('div');
      grid.className = 'helmet-grid lab-card-grid lab-docked-card-grid challenge-tracker-list';
      grid.style.display = 'grid';
      grid.style.gap = '8px';
      grid.style.width = '100%';
      vbox.appendChild(grid);

      for (const helm of helmetsList) {
        const hId = helm.id || helm.Id;
        const isEquipped = (meta.EquippedHelmetId === hId) || ((player as any)?.equippedHelmet?.id === hId) || ((player as any)?.EquippedHelmet?.id === hId);
        const rarityColor = HELMET_RARITY_COLORS[(helm.rarity || helm.Rarity) as keyof typeof HELMET_RARITY_COLORS] || '#ffd166';

        const helmCard = document.createElement('div');
        helmCard.className = 'helmet-card';
        helmCard.style.background = isEquipped ? 'rgba(0, 240, 181, 0.08)' : 'rgba(15, 23, 42, 0.85)';
        helmCard.style.border = `1px solid ${isEquipped ? 'var(--cyan)' : rarityColor}`;
        helmCard.style.borderRadius = '8px';
        helmCard.style.padding = '10px 12px';
        helmCard.style.display = 'flex';
        helmCard.style.flexDirection = 'column';
        helmCard.style.justifyContent = 'space-between';
        helmCard.style.gap = '6px';
        helmCard.style.width = '100%';
        helmCard.style.boxSizing = 'border-box';

        helmCard.innerHTML = `
          <!-- Row 1: Header with Icon + Title on left, Rarity badge on right -->
          <div class="helmet-header-row" style="display: flex; justify-content: space-between; align-items: center; width: 100%; gap: 8px;">
            <div style="display: flex; align-items: center; gap: 6px; min-width: 0; overflow: hidden;">
              <span style="font-size: 18px; flex-shrink: 0;">${helm.icon || helm.Icon || '🪖'}</span>
              <span style="font-weight: 700; color: ${rarityColor}; font-size: 12.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${helm.name || helm.Name}</span>
            </div>
            <span class="helmet-rarity-badge" style="font-size: 9.5px; padding: 2px 6px; border-radius: 4px; background: rgba(0,0,0,0.4); color: ${rarityColor}; border: 1px solid ${rarityColor}; font-weight: 700; flex-shrink: 0; white-space: nowrap;">${(helm.rarity || helm.Rarity || 'common').toUpperCase()}</span>
          </div>
          <!-- Row 2: Stat Preview -->
          <div style="font-size: 11px; color: #94a3b8; text-align: left; line-height: 1.35;">${formatHelmetStatDescription(helm.stats || helm.Stats || {})}</div>
          <!-- Row 3: Description -->
          <div style="font-size: 9.5px; color: #64748b; font-style: italic; text-align: left; line-height: 1.3;">${helm.description || helm.Description || ''}</div>
        `;

        const equipBtn = document.createElement('button');
        equipBtn.className = `cyber-btn btn-equip-helmet ${isEquipped ? 'btn-secondary' : 'btn-primary'}`;
        equipBtn.style.width = '100%';
        equipBtn.style.padding = '6px 10px';
        equipBtn.style.fontSize = '11px';
        equipBtn.style.fontWeight = '700';
        equipBtn.style.marginTop = '2px';
        equipBtn.textContent = isEquipped ? 'Equipped ✓' : 'Equip 🪖';

        equipBtn.addEventListener('click', () => {
          if (isEquipped) {
            meta.EquipHelmet(null);
            if (player) {
              player.EquippedHelmet = null;
              player.equippedHelmet = null;
            }
            Services.Sound.playUi();
          } else {
            meta.EquipHelmet(hId);
            if (player) {
              player.EquippedHelmet = meta.GetEquippedHelmet();
              player.equippedHelmet = meta.GetEquippedHelmet();
            }
            Services.Sound.playLevelUp();
          }
          this.refresh();
        });

        helmCard.appendChild(equipBtn);
        grid.appendChild(helmCard);
      }
    }

    this._dockedCardContainer.appendChild(card);
  }

  /**
   * Tab 1: Dedicated Cranial Mutation & Challenge Cards Grid.
   * Renders Offensive Weapons (10 cards), Defensive Bio-Organs (6 cards), and Cranial Bio-Augmentations (5 cards).
   * Strictly 1 starter weapon ('turret') and 1 starter defense ('shield') unlocked at start; all others locked with their challenge tracks.
   */
  private renderCranialMutationSection(): void {
    if (!this._dockedCardContainer) return;

    const card = this.createGlassCard('lab-section lab-section-lab lab-section-mutations', 'lab-section-lab');
    const vbox = document.createElement('div');
    vbox.style.display = 'flex';
    vbox.style.flexDirection = 'column';
    vbox.style.gap = '10px';
    card.appendChild(vbox);

    const hdr = this.createSectionHeader('🧬 UNIFIED CRANIAL MUTATIONS & CHALLENGES');
    vbox.appendChild(hdr);

    // 1. OFFENSIVE WEAPONS (Head Mounted - 10 Modules)
    const offTitle = document.createElement('div');
    offTitle.style.color = '#f87171';
    offTitle.style.fontWeight = '700';
    offTitle.style.fontSize = '12px';
    offTitle.style.textAlign = 'left';
    offTitle.textContent = '⚔️ OFFENSIVE WEAPONS (HEAD MOUNTED)';
    vbox.appendChild(offTitle);

    const offGrid = document.createElement('div');
    offGrid.className = 'lab-card-grid lab-docked-card-grid challenge-tracker-list';
    vbox.appendChild(offGrid);

    this.addIntegratedHeadModuleCard(offGrid, 'turret', '🏹 Attack Spitter');
    this.addIntegratedHeadModuleCard(offGrid, 'tesla', '⚡ Bio-Arc Coil');
    this.addIntegratedHeadModuleCard(offGrid, 'magma', '🔥 Magma Vent');
    this.addIntegratedHeadModuleCard(offGrid, 'venom', '☣️ Venom Sprayer');
    this.addIntegratedHeadModuleCard(offGrid, 'tachyon', '🔬 Tachyon Laser');
    this.addIntegratedHeadModuleCard(offGrid, 'cryo', '❄️ Cryo Mortar');
    this.addIntegratedHeadModuleCard(offGrid, 'plasma', '💥 Plasma Mortar');
    this.addIntegratedHeadModuleCard(offGrid, 'scattershot', '🎯 Scattershot');
    this.addIntegratedHeadModuleCard(offGrid, 'flak', '💣 Flak Cannon');
    this.addIntegratedHeadModuleCard(offGrid, 'needler', '📍 Needler');

    // 2. DEFENSIVE BIO-ORGANS (Head Mounted - 6 Modules)
    const defTitle = document.createElement('div');
    defTitle.style.color = '#38bdf8';
    defTitle.style.fontWeight = '700';
    defTitle.style.fontSize = '12px';
    defTitle.style.textAlign = 'left';
    defTitle.style.marginTop = '4px';
    defTitle.textContent = '🛡️ DEFENSIVE BIO-ORGANS (HEAD MOUNTED)';
    vbox.appendChild(defTitle);

    const defGrid = document.createElement('div');
    defGrid.className = 'lab-card-grid lab-docked-card-grid challenge-tracker-list';
    vbox.appendChild(defGrid);

    this.addIntegratedHeadModuleCard(defGrid, 'shield', '🛡️ Carapace Shield');
    this.addIntegratedHeadModuleCard(defGrid, 'spikes', '🦔 Thorny Spikes');
    this.addIntegratedHeadModuleCard(defGrid, 'regen', '🧪 Regen Gland');
    this.addIntegratedHeadModuleCard(defGrid, 'magnet', '🧲 Bio-Magnet');
    this.addIntegratedHeadModuleCard(defGrid, 'chrono', '⏳ Chrono Ward');
    this.addIntegratedHeadModuleCard(defGrid, 'nanite', '🧬 Nanite Swarm');

    // 3. CRANIAL BIO-AUGMENTATIONS (5 Augments)
    const augTitle = document.createElement('div');
    augTitle.id = 'lab-section-challenges';
    augTitle.style.color = 'var(--gold-soft)';
    augTitle.style.fontWeight = '700';
    augTitle.style.fontSize = '12px';
    augTitle.style.textAlign = 'left';
    augTitle.style.marginTop = '4px';
    augTitle.textContent = '🐲 CRANIAL BIO-AUGMENTATIONS';
    vbox.appendChild(augTitle);

    const augGrid = document.createElement('div');
    augGrid.className = 'lab-card-grid lab-docked-card-grid challenge-tracker-list';
    vbox.appendChild(augGrid);

    this.addIntegratedHeadAugmentCard(augGrid, 'fangs', '🐍 Venom Fangs');
    this.addIntegratedHeadAugmentCard(augGrid, 'maw', '🐲 Dragon Maw');
    this.addIntegratedHeadAugmentCard(augGrid, 'horns', '🦏 Ramming Horns');
    this.addIntegratedHeadAugmentCard(augGrid, 'laser', '👁️ Laser Optics');
    this.addIntegratedHeadAugmentCard(augGrid, 'crown', '☀️ Solar Crown');

    this._dockedCardContainer.appendChild(card);
  }

  /**
   * Evaluates whether a cranial module or augment tier is unlocked in the current run.
   * On a fresh run, exactly 1 offensive weapon ('turret') and 1 defensive bio-organ ('shield')
   * are unlocked at Tier 1. All other cards require their in-run challenge conditions to be fulfilled.
   */
  public isModuleTierUnlocked(type: string, tier: number): boolean {
    if (tier <= 0) return true;

    const player = this.root.engine?.player ?? this.root.engine?.Player;
    if (player) {
      if (typeof player.getHeadModuleLevel === 'function' && player.getHeadModuleLevel(type) >= tier) {
        return true;
      }
      if (player.headModules && (player.headModules[type] || 0) >= tier) {
        return true;
      }
      if (typeof player.getHeadAugmentLevel === 'function' && player.getHeadAugmentLevel(type) >= tier) {
        return true;
      }
      if (player.headAugment === type && (player.headAugmentLevel || 0) >= tier) {
        return true;
      }
    }

    // Check MetaProgression unlocks
    const meta = MetaProgression.Instance;
    if (meta) {
      if (meta.UpgradeLevels && (meta.UpgradeLevels['unlock_' + type] || 0) >= tier) {
        return true;
      }
      if (meta.UnlockedTiers && (meta.UnlockedTiers[type] || 0) >= tier) {
        return true;
      }
    }

    // Starter defaults on a fresh run: exactly 1 offensive weapon (turret) and 1 defensive bio-organ (shield)
    if (tier === 1) {
      if (type === 'turret' || type === 'shield') {
        return true;
      }
    }

    // Evaluate live challenge condition against active run metrics
    const chDesc = this.getChallengeDescription(type, tier);
    const { currentMetric, targetMetric } = this.extractChallengeProgress(chDesc);
    if (targetMetric > 0 && currentMetric >= targetMetric) {
      return true;
    }

    return false;
  }

  /**
   * Retrieves the authoritative in-run challenge unlock description for any module/augment and tier.
   */
  public getChallengeDescription(type: string, tier: number): string {
    const meta = MetaProgression.Instance;
    const metaDesc = meta?.GetUpgradeChallengeDescription ? meta.GetUpgradeChallengeDescription(type, tier) : null;
    if (metaDesc && metaDesc !== 'Complete Challenges to Unlock' && !metaDesc.includes('Starter Default')) {
      return metaDesc;
    }

    if (tier === 1) {
      switch (type) {
        case 'turret': return 'Starter Offensive Weapon (Unlocked)';
        case 'shield': return 'Starter Defensive Bio-Organ (Unlocked)';
        case 'tesla': return 'Maintain a Combo Streak of 8x';
        case 'magma': return 'Slay 15 Swarmlings in a run';
        case 'venom': return 'Slay 20 Enemies in a run';
        case 'tachyon': return 'Maintain a Combo Streak of 10x';
        case 'cryo': return 'Drink 2 Health Potions in a run';
        case 'plasma': {
          const req = meta?.GetScaledLengthRequirement ? meta.GetScaledLengthRequirement(35) : 35;
          return `Reach Serpent Length ${req} (scaled)`;
        }
        case 'scattershot': return 'Slay 25 Enemies in a run';
        case 'flak': return 'Defeat Storm Gorgon (Floor 2)';
        case 'needler': return 'Defeat Infernal Colossus (Floor 3)';
        case 'spikes': return 'Slay 10 Armored Scarabs in a run';
        case 'regen': return 'Eat 30 Crimson Apples in a run';
        case 'magnet': return 'Collect 2 Golden Apples in a run';
        case 'chrono': return 'Defeat Chrono Wyrm (Floor 5)';
        case 'nanite': return 'Collect 5 Astral Shards / Prisms in a run';
        case 'fangs': return 'Maintain a Combo Streak of 15x';
        case 'maw': return 'Defeat Centipede Behemoth (Floor 1)';
        case 'horns': return 'Slay 10 Armored Scarabs in a run';
        case 'laser': case 'visor': return 'Slay 8 Venom Spitters in a run';
        case 'crown': case 'crest': return 'Collect 45 Food items in a run';
        default: return `Complete Tier ${tier} Challenge to Unlock`;
      }
    }

    if (tier === 2) {
      switch (type) {
        case 'turret': return 'Defeat Apex Superconductor (Floor 7)';
        case 'tesla': return 'Maintain a Combo Streak of 20x';
        case 'magma': return 'Defeat Astral Leviathan (Floor 8)';
        case 'venom': return 'Slay 15 Arc Drones in a run';
        case 'tachyon': return 'Defeat Nanite Hive Titan (Floor 17)';
        case 'cryo': return 'Defeat Shadow Doppelgänger (Floor 10)';
        case 'plasma': return 'Grow Serpent to Length 800 (scaled)';
        case 'scattershot': return 'Grow Serpent to Length 650 (scaled)';
        case 'flak': return 'Maintain a Combo Streak of 25x';
        case 'needler': return 'Collect 80 Food items in a run';
        case 'shield': return 'Grow Serpent to Length 600 (scaled)';
        case 'spikes': return 'Slay 12 Phase Phantoms in a run';
        case 'regen': return 'Collect 120 Food items in a run';
        case 'magnet': return 'Maintain a Combo Streak of 18x';
        case 'chrono': return 'Defeat 8 Boss Guardians';
        case 'nanite': return 'Grow Serpent to Length 800 (scaled)';
        case 'fangs': return 'Maintain a Combo Streak of 20x';
        case 'maw': return 'Grow Serpent to Length 600 (scaled)';
        case 'horns': return 'Defeat 8 Boss Guardians';
        case 'laser': case 'visor': return 'Slay 110 Enemies in a run';
        case 'crown': case 'crest': return 'Collect 150 Food items in a run';
        default: return `Complete Tier ${tier} Challenge to Unlock`;
      }
    } else if (tier === 3) {
      switch (type) {
        case 'turret': return 'Defeat Prismatic Arachnid (Floor 15)';
        case 'tesla': return 'Maintain a Combo Streak of 40x';
        case 'magma': return 'Grow Serpent to Length 1350 (scaled)';
        case 'venom': return 'Slay 200 Enemies in a run';
        case 'tachyon': return 'Grow Serpent to Length 1500 (Legendary Titan)';
        case 'cryo': return 'Defeat The Eternal Ouroboros (Floor 20)';
        case 'plasma': return 'Grow Serpent to Length 1500 (scaled)';
        case 'scattershot': return 'Grow Serpent to Length 1200 (scaled)';
        case 'flak': return 'Defeat 15 Boss Guardians';
        case 'needler': return 'Collect 220 Food items in a run';
        case 'shield': return 'Grow Serpent to Length 1200 (scaled)';
        case 'spikes': return 'Defeat 18 Boss Guardians';
        case 'regen': return 'Collect 250 Food items in a run';
        case 'magnet': return 'Maintain a Combo Streak of 35x';
        case 'chrono': return 'Grow Serpent to Length 1500 (scaled)';
        case 'nanite': return 'Defeat 18 Boss Guardians';
        case 'fangs': return 'Slay 10 Magma Brutes in a run';
        case 'maw': return 'Grow Serpent to Length 1500 (scaled)';
        case 'horns': return 'Defeat 16 Boss Guardians';
        case 'laser': case 'visor': return 'Grow Serpent to Length 1800 (scaled)';
        case 'crown': case 'crest': return 'Collect 300 Food items in a run';
        default: return `Complete Tier ${tier} Challenge to Unlock`;
      }
    }

    return `Complete Tier ${tier} Challenge to Unlock`;
  }

  /**
   * Helper extracting challenge progress metrics given a challenge description string.
   */
  private extractChallengeProgress(chDesc: string): { currentMetric: number; targetMetric: number; metricLabel: string; pct: number } {
    const player = this.root.engine?.player ?? this.root.engine?.Player;
    const combat = this.root.engine?.combat ?? this.root.engine?.Combat;
    const currentFloor = this.root.engine?.currentFloor ?? this.root.engine?.CurrentFloor ?? 1;

    const curLen = (player?.segments ? player.segments.length : (player?.Segments ? player.Segments.length : (player?.length ?? player?.Length ?? 0))) + 1;
    const totalFoods = combat?.foodsEaten ?? combat?.FoodsEaten ?? ((combat?.foodsEatenByType?.apple || 0) + (combat?.foodsEatenByType?.golden || 0));
    const totalKills = combat?.kills ?? combat?.Kills ?? 0;
    const bossesCount = combat?.bossKills ?? combat?.BossKills ?? 0;
    const comboVal = combat?.comboCount ?? combat?.ComboCount ?? 0;
    const highCombo = combat?.highestRunCombo ?? combat?.HighestRunCombo ?? combat?.highestCombo ?? combat?.HighestCombo ?? comboVal;

    const killsByType = combat?.killsByType || combat?.KillsByType || {};
    const foodsByType = combat?.foodsEatenByType || combat?.FoodsEatenByType || combat?.foodsByType || combat?.FoodsByType || {};

    let currentMetric = 0;
    let targetMetric = 1;
    let metricLabel = 'Progress';

    if (chDesc.includes('Swarmling')) {
      const match = chDesc.match(/(\d+)\s+Swarmling/i) || chDesc.match(/Slay\s+(\d+)/i);
      targetMetric = match ? parseInt(match[1]!, 10) : 15;
      currentMetric = killsByType['swarmling'] || 0;
      metricLabel = 'Swarmlings';
    } else if (chDesc.includes('Scarab')) {
      const match = chDesc.match(/(\d+)\s+(?:Armored\s+)?Scarab/i) || chDesc.match(/Slay\s+(\d+)/i);
      targetMetric = match ? parseInt(match[1]!, 10) : 10;
      currentMetric = killsByType['scarab'] || 0;
      metricLabel = 'Scarabs';
    } else if (chDesc.includes('Spitter')) {
      const match = chDesc.match(/(\d+)\s+(?:Venom\s+)?Spitter/i) || chDesc.match(/Slay\s+(\d+)/i);
      targetMetric = match ? parseInt(match[1]!, 10) : 8;
      currentMetric = killsByType['spitter'] || 0;
      metricLabel = 'Spitters';
    } else if (chDesc.includes('Phantom')) {
      const match = chDesc.match(/(\d+)\s+(?:Phase\s+)?Phantom/i) || chDesc.match(/Slay\s+(\d+)/i);
      targetMetric = match ? parseInt(match[1]!, 10) : 12;
      currentMetric = killsByType['phantom'] || 0;
      metricLabel = 'Phantoms';
    } else if (chDesc.includes('Drone')) {
      const match = chDesc.match(/(\d+)\s+(?:Arc\s+)?Drone/i) || chDesc.match(/Slay\s+(\d+)/i);
      targetMetric = match ? parseInt(match[1]!, 10) : 15;
      currentMetric = killsByType['drone'] || killsByType['arc_drone'] || 0;
      metricLabel = 'Arc Drones';
    } else if (chDesc.includes('Brute')) {
      const match = chDesc.match(/(\d+)\s+(?:Magma\s+)?Brute/i) || chDesc.match(/Slay\s+(\d+)/i);
      targetMetric = match ? parseInt(match[1]!, 10) : 10;
      currentMetric = killsByType['brute'] || killsByType['magma_brute'] || 0;
      metricLabel = 'Magma Brutes';
    } else if (chDesc.includes('Apple')) {
      const match = chDesc.match(/(?:Eat|Collect)\s+(\d+)/i) || chDesc.match(/(\d+)\s+(?:Crimson\s+|Golden\s+)?Apple/i);
      targetMetric = match ? parseInt(match[1]!, 10) : 30;
      currentMetric = chDesc.includes('Golden') ? (foodsByType['golden'] || 0) : (foodsByType['apple'] || 0);
      metricLabel = chDesc.includes('Golden') ? 'Golden Apples' : 'Crimson Apples';
    } else if (chDesc.includes('Potion')) {
      const match = chDesc.match(/(?:Drink|Collect)\s+(\d+)/i) || chDesc.match(/(\d+)\s+(?:Health\s+)?Potion/i);
      targetMetric = match ? parseInt(match[1]!, 10) : 2;
      currentMetric = foodsByType['potion'] || 0;
      metricLabel = 'Potions';
    } else if (chDesc.includes('Shard') || chDesc.includes('Prism')) {
      const match = chDesc.match(/(?:Collect|Eat)\s+(\d+)/i) || chDesc.match(/(\d+)\s+Astral/i);
      targetMetric = match ? parseInt(match[1]!, 10) : 5;
      currentMetric = (foodsByType['shard'] || 0) + (foodsByType['prism'] || 0);
      metricLabel = 'Shards/Prisms';
    } else if (chDesc.includes('Length') || chDesc.includes('Grow') || chDesc.includes('Reach')) {
      const match = chDesc.match(/Length\s+(\d+)/i) || chDesc.match(/Grow.*?(\d+)/i) || chDesc.match(/Reach.*?(\d+)/i);
      targetMetric = match ? parseInt(match[1]!, 10) : 25;
      currentMetric = curLen;
      metricLabel = 'Length';
    } else if (chDesc.includes('Enemies') || chDesc.includes('Slay')) {
      const match = chDesc.match(/(\d+)\s+Enemies/i) || chDesc.match(/Slay\s+(\d+)/i);
      targetMetric = match ? parseInt(match[1]!, 10) : 20;
      currentMetric = totalKills;
      metricLabel = 'Kills';
    } else if (chDesc.includes('Food') || chDesc.includes('Collect')) {
      const match = chDesc.match(/(\d+)\s+Food/i) || chDesc.match(/Collect\s+(\d+)/i);
      targetMetric = match ? parseInt(match[1]!, 10) : 30;
      currentMetric = totalFoods;
      metricLabel = 'Foods';
    } else if (chDesc.includes('Combo') || chDesc.includes('Streak')) {
      const match = chDesc.match(/(\d+)x/i) || chDesc.match(/Streak.*?(\d+)x/i);
      targetMetric = match ? parseInt(match[1]!, 10) : 15;
      currentMetric = highCombo;
      metricLabel = 'Combo';
    } else if (chDesc.includes('Boss') || chDesc.includes('Defeat') || chDesc.includes('Eternal Ouroboros')) {
      const countMatch = chDesc.match(/(\d+)\s+Boss/i);
      const floorMatch = chDesc.match(/Floor\s+(\d+)/i);
      if (floorMatch) {
        targetMetric = parseInt(floorMatch[1]!, 10);
        currentMetric = currentFloor > targetMetric ? targetMetric : Math.max(0, Math.min(targetMetric, bossesCount));
        metricLabel = `Floor ${targetMetric}`;
      } else if (countMatch) {
        targetMetric = parseInt(countMatch[1]!, 10);
        currentMetric = bossesCount;
        metricLabel = 'Bosses';
      } else {
        targetMetric = 1;
        currentMetric = bossesCount;
        metricLabel = 'Bosses';
      }
    }

    const pct = MathX.clamp(Math.round((currentMetric / Math.max(1, targetMetric)) * 100), 0, 100);
    return { currentMetric, targetMetric, metricLabel, pct };
  }

  /**
   * Generates a Unified Head Module Card integrating Challenge & Reward with clean 4-row vertical stack:
   * - Row 1 (Header): Left Icon+Title (13px bold), Right Clean Level Badge (10px bold, flex-shrink: 0).
   * - Row 2 (Benefit): Single concise benefit line on full-width row (11px, #94a3b8).
   * - Row 3 (Challenge Track): Feat description label, sleek progress bar & metric count (when locked). Zero buttons.
   * - Row 4 (Purchase Action): Clean action button/cost tag ([ 💰 30 🪙 BUY TIER 1 ⚡ ] / [MAX LEVEL]).
   */
  private addIntegratedHeadModuleCard(parent: HTMLElement, modType: string, label: string): void {
    const player = this.root.engine?.player ?? this.root.engine?.Player;
    const maxLvl = SnakeLabScreen.MaxModuleLevel;
    const curLvl = player?.getHeadModuleLevel ? player.getHeadModuleLevel(modType) : ((player?.headModules && player.headModules[modType]) || 0);
    const isMax = curLvl >= maxLvl;
    const nextLvl = curLvl + 1;
    const isTierUnlocked = isMax ? true : this.isModuleTierUnlocked(modType, nextLvl);
    const cost = player?.getHeadModuleCost ? player.getHeadModuleCost(modType) : (SnakeLabScreen.ModuleBaseCost + (player?.headPurchaseCount || 0) * 15);
    const curOuro = Math.floor(player ? (player.ouro ?? player.xp ?? 0) : 0);
    const isAffordable = curOuro >= cost;
    const canAfford = !isMax && isAffordable && isTierUnlocked;
    const missing = Math.max(0, cost - curOuro);

    const isOffense = SnakePlayer.isOffenseModule(modType);
    const accentCol = isOffense ? '#f87171' : '#38bdf8';

    const btn = document.createElement('button');
    const stateClass = isMax
      ? 'btn-max-level'
      : (!isTierUnlocked
        ? 'btn-tier-locked'
        : (isAffordable ? 'btn-affordable' : 'btn-unaffordable'));
    btn.className = `cyber-btn lab-docked-card-btn challenge-row-card ${isTierUnlocked ? 'unlocked' : 'locked'} ${stateClass}`;
    btn.style.padding = '10px 12px';
    btn.style.display = 'flex';
    btn.style.flexDirection = 'column';
    btn.style.alignItems = 'stretch';
    btn.style.gap = '4px';
    btn.style.width = '100%';
    btn.style.boxSizing = 'border-box';

    if (isMax) {
      btn.style.background = 'rgba(255, 209, 102, 0.15)';
      btn.style.border = '1.5px solid var(--gold-soft)';
      btn.style.boxShadow = '0 0 10px rgba(255, 209, 102, 0.35)';
      btn.style.cursor = 'default';
    } else if (!isTierUnlocked) {
      btn.style.background = 'rgba(15, 23, 42, 0.7)';
      btn.style.border = '1px solid rgba(239, 68, 68, 0.45)';
      btn.style.cursor = 'not-allowed';
    } else if (!isAffordable) {
      btn.style.background = 'rgba(15, 23, 42, 0.7)';
      btn.style.border = '1px solid rgba(239, 68, 68, 0.35)';
      btn.style.cursor = 'not-allowed';
    } else {
      btn.style.background = curLvl > 0 ? (isOffense ? 'rgba(248, 113, 113, 0.12)' : 'rgba(56, 189, 248, 0.12)') : 'rgba(15, 23, 42, 0.85)';
      btn.style.border = `1px solid ${curLvl > 0 ? accentCol : 'rgba(148, 163, 184, 0.3)'}`;
      btn.style.cursor = 'pointer';
    }

    const titleColor = isMax ? 'var(--gold-soft)' : (!isTierUnlocked ? '#f8fafc' : (curLvl > 0 ? accentCol : '#f8fafc'));
    let badgeText = '';
    let badgeStyle = '';

    if (isMax) {
      badgeText = `[LVL ${curLvl}/${maxLvl}]`;
      badgeStyle = 'background: rgba(255,209,102,0.25); color: var(--gold-soft); border: 1px solid var(--gold-soft);';
    } else if (!isTierUnlocked) {
      badgeText = curLvl > 0 ? `[🔒 TIER ${nextLvl}]` : '[🔒 LOCKED]';
      badgeStyle = 'background: rgba(239,68,68,0.25); color: #f87171; border: 1px solid #f87171;';
    } else {
      badgeText = curLvl > 0 ? `[LVL ${curLvl}/${maxLvl}]` : '[🌟 UNLOCKED]';
      badgeStyle = 'background: rgba(0,240,181,0.18); color: #00f0b5; border: 1px solid rgba(0,240,181,0.4);';
    }

    const row1Html = `
      <div class="card-header-row" style="display: flex; justify-content: space-between; align-items: center; width: 100%; gap: 8px; line-height: 1.2; margin-bottom: 2px;">
        <div style="display: flex; align-items: center; gap: 6px; min-width: 0; overflow: hidden;">
          <span class="card-title" style="font-size: 13px; font-weight: 700; line-height: 1.2; color: ${titleColor}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: block;">${label}</span>
        </div>
        <span class="challenge-level-badge" style="font-size: 10px; font-weight: 700; padding: 2px 6px; border-radius: 4px; flex-shrink: 0; white-space: nowrap; ${badgeStyle}">${badgeText}</span>
      </div>
    `;

    const benefitDesc = this.formatHeadModulePreview(modType, curLvl, isMax ? curLvl : nextLvl);
    const row2Html = `
      <div class="card-benefit-row" style="font-size: 11px; color: ${isMax ? '#ffd166' : '#94a3b8'}; margin: 0 0 3px 0; width: 100%; text-align: left; line-height: 1.35;">
        ${curLvl > 0 && !isMax ? `[Level ${curLvl}] ` : ''}${benefitDesc}
      </div>
    `;

    let row3Html = '';
    if (!isTierUnlocked) {
      const chDesc = this.getChallengeDescription(modType, nextLvl);
      const { currentMetric, targetMetric, metricLabel, pct } = this.extractChallengeProgress(chDesc);
      row3Html = `
        <div class="card-challenge-row" style="display: flex; flex-direction: column; width: 100%; gap: 3px; margin: 2px 0;">
          <div class="challenge-feat-label" style="font-size: 10.5px; color: #fbbf24; text-align: left; width: 100%; font-weight: 600;">🎯 Feat: UNLOCK: ${chDesc}</div>
          <div class="challenge-bar-container" style="position: relative; width: 100%; height: 6px; background: rgba(2, 6, 23, 0.8); border-radius: 3px; overflow: hidden; margin-top: 1px;">
            <div class="challenge-progress-bar" style="width: ${pct}%; height: 100%; background: linear-gradient(90deg, #f59e0b, #ffd166, #00f0b5); transition: width 0.3s ease;"></div>
          </div>
          <div class="challenge-metric-row" style="display: flex; justify-content: space-between; width: 100%; font-size: 10px; color: #00f0b5; margin-top: 1px;">
            <span>${metricLabel}: ${currentMetric} / ${targetMetric}</span>
            <span style="font-weight: 700;">${pct}%</span>
          </div>
        </div>
      `;
    } else {
      row3Html = `
        <div class="card-challenge-row" style="display: flex; flex-direction: column; width: 100%; gap: 2px; margin: 1px 0;">
          <div class="challenge-bar-container" style="position: relative; width: 100%; height: 4px; background: rgba(2, 6, 23, 0.8); border-radius: 2px; overflow: hidden;">
            <div class="challenge-progress-bar" style="width: 100%; height: 100%; background: ${isMax ? 'linear-gradient(90deg, #f59e0b, #ffd166)' : 'linear-gradient(90deg, #00a880, #00f0b5)'}; transition: width 0.3s ease;"></div>
          </div>
        </div>
      `;
    }

    let row4Html = '';
    if (isMax) {
      row4Html = `<div class="cost-tag max-level challenge-status completed" style="width: 100%; text-align: center; font-size: 11px; font-weight: 700; background: rgba(255,209,102,0.25); color: var(--gold-soft); border: 1px solid var(--gold-soft); border-radius: 6px; padding: 5px 8px; box-sizing: border-box;">🌟 [MAX LEVEL]</div>`;
    } else if (!isTierUnlocked) {
      row4Html = `<div class="cost-tag tier-locked challenge-status in-progress" style="width: 100%; text-align: center; font-size: 10px; font-weight: 700; background: rgba(239,68,68,0.25); color: #f87171; border: 1px solid #f87171; border-radius: 6px; padding: 4px 6px; box-sizing: border-box;">🔒 [TIER ${nextLvl} LOCKED] 🪙 ${cost} Ouro${missing > 0 ? ` (Need ${missing} more)` : ''}</div>`;
    } else if (!isAffordable) {
      row4Html = `<div class="cost-tag unaffordable challenge-status completed" style="width: 100%; text-align: center; font-size: 10.5px; font-weight: 700; background: rgba(239,68,68,0.18); color: #f87171; border: 1px solid rgba(239,68,68,0.4); border-radius: 6px; padding: 5px 8px; box-sizing: border-box;">💰 ${cost} 🪙 (Need ${missing} more) [${curOuro}/${cost} 🪙]${curLvl === 0 ? ' [TIER 1 UNLOCKED]' : ''}</div>`;
    } else {
      row4Html = `<div class="cost-tag affordable challenge-status completed" style="width: 100%; text-align: center; font-size: 11px; font-weight: 700; background: rgba(0,240,181,0.18); color: #00f0b5; border: 1px solid #00f0b5; border-radius: 6px; padding: 5px 8px; box-shadow: 0 0 8px rgba(0,240,181,0.25); box-sizing: border-box;">💰 ${cost} 🪙 BUY ${curLvl > 0 ? `TIER ${nextLvl}` : 'TIER 1'} ⚡ (${cost} Ouro)${curLvl === 0 ? ' [TIER 1 UNLOCKED]' : ''}</div>`;
    }

    btn.disabled = false;
    btn.setAttribute('aria-disabled', String(isMax || !canAfford || !isTierUnlocked));
    btn.innerHTML = `${row1Html}${row2Html}${row3Html}${row4Html}`;

    btn.addEventListener('click', () => {
      if (curLvl >= maxLvl) {
        this.showToast('🌟 Module is already at Maximum Level!', false);
        return;
      }
      if (!isTierUnlocked) {
        const chDesc = this.getChallengeDescription(modType, nextLvl);
        this.showToast(`🔒 Tier ${nextLvl} Locked: ${chDesc}`, true);
        Services.Sound.playError();
        return;
      }
      const liveOuro = Math.floor(player ? (player.ouro ?? player.xp ?? 0) : 0);
      if (liveOuro < cost) {
        const missing = cost - liveOuro;
        this.showToast(`⚠️ Insufficient Ouro: You have ${liveOuro} 🪙, need ${cost} 🪙! (Need ${missing} more)`, true);
        Services.Sound.playError();
        return;
      }
      if (player) {
        const spent = typeof player.SpendOuro === 'function'
          ? player.SpendOuro(cost)
          : (typeof player.spendOuro === 'function' ? player.spendOuro(cost) : false);
        if (!spent) {
          const missing = cost - Math.floor(player.ouro ?? player.xp ?? 0);
          this.showToast(`⚠️ Insufficient Ouro: You have ${Math.floor(player.ouro ?? player.xp ?? 0)} 🪙, need ${cost} 🪙! (Need ${missing} more)`, true);
          Services.Sound.playError();
          return;
        }
        if (player.installHeadModule) {
          player.installHeadModule(modType);
        } else {
          if (!player.headModules) player.headModules = {};
          player.headModules[modType] = nextLvl;
          player.headPurchaseCount = (player.headPurchaseCount || 0) + 1;
        }
        Services.Sound.playLevelUp();
        this.refresh();
        if (this.root && this.root.hudView) {
          this.root.hudView.tick(player);
        }
      }
    });

    parent.appendChild(btn);
  }

  /**
   * Generates a Unified Cranial Bio-Augmentation Card integrating Challenge & Reward with clean 4-row vertical stack:
   * - Row 1 (Header): Left Icon+Title (13px bold), Right Clean Level Badge (10px bold, flex-shrink: 0).
   * - Row 2 (Benefit): Single concise benefit line on full-width row (11px, #94a3b8).
   * - Row 3 (Challenge Track): Feat description label, sleek progress bar & metric count (when locked). Zero buttons.
   * - Row 4 (Purchase Action): Clean action button/cost tag ([ 💰 40 🪙 BUY TIER 1 ⚡ ] / [MAX LEVEL]).
   */
  private addIntegratedHeadAugmentCard(parent: HTMLElement, augType: string, label: string): void {
    const player = this.root.engine?.player ?? this.root.engine?.Player;
    const maxLvl = SnakeLabScreen.MaxAugmentLevel;
    const curLvl = player?.getHeadAugmentLevel ? player.getHeadAugmentLevel(augType) : ((player?.headAugment === augType ? (player.headAugmentLevel || 0) : 0));
    const isMax = curLvl >= maxLvl;
    const nextLvl = curLvl + 1;
    const isTierUnlocked = isMax ? true : this.isModuleTierUnlocked(augType, nextLvl);
    const cost = player?.getHeadAugmentCost ? player.getHeadAugmentCost(augType) : (SnakeLabScreen.HeadAugmentBaseCost + (player?.headPurchaseCount || 0) * 20);
    const curOuro = Math.floor(player ? (player.ouro ?? player.xp ?? 0) : 0);
    const isAffordable = curOuro >= cost;
    const canAfford = !isMax && isAffordable && isTierUnlocked;
    const missing = Math.max(0, cost - curOuro);

    const btn = document.createElement('button');
    const stateClass = isMax
      ? 'btn-max-level'
      : (!isTierUnlocked
        ? 'btn-tier-locked'
        : (isAffordable ? 'btn-affordable' : 'btn-unaffordable'));
    btn.className = `cyber-btn lab-docked-card-btn challenge-row-card ${isTierUnlocked ? 'unlocked' : 'locked'} ${stateClass}`;
    btn.style.padding = '10px 12px';
    btn.style.display = 'flex';
    btn.style.flexDirection = 'column';
    btn.style.alignItems = 'stretch';
    btn.style.gap = '4px';
    btn.style.width = '100%';
    btn.style.boxSizing = 'border-box';

    if (isMax) {
      btn.style.background = 'rgba(255, 209, 102, 0.15)';
      btn.style.border = '1.5px solid var(--gold-soft)';
      btn.style.boxShadow = '0 0 10px rgba(255, 209, 102, 0.35)';
      btn.style.cursor = 'default';
    } else if (!isTierUnlocked) {
      btn.style.background = 'rgba(15, 23, 42, 0.7)';
      btn.style.border = '1px solid rgba(239, 68, 68, 0.45)';
      btn.style.cursor = 'not-allowed';
    } else if (!isAffordable) {
      btn.style.background = 'rgba(15, 23, 42, 0.7)';
      btn.style.border = '1px solid rgba(239, 68, 68, 0.35)';
      btn.style.cursor = 'not-allowed';
    } else {
      btn.style.background = curLvl > 0 ? 'rgba(255, 209, 102, 0.12)' : 'rgba(15, 23, 42, 0.85)';
      btn.style.border = `1px solid ${curLvl > 0 ? 'var(--gold-soft)' : 'rgba(148, 163, 184, 0.3)'}`;
      btn.style.cursor = 'pointer';
    }

    const titleColor = isMax ? 'var(--gold-soft)' : (!isTierUnlocked ? '#f8fafc' : (curLvl > 0 ? 'var(--gold-soft)' : '#f8fafc'));
    let badgeText = '';
    let badgeStyle = '';

    if (isMax) {
      badgeText = `[LVL ${curLvl}/${maxLvl}]`;
      badgeStyle = 'background: rgba(255,209,102,0.25); color: var(--gold-soft); border: 1px solid var(--gold-soft);';
    } else if (!isTierUnlocked) {
      badgeText = curLvl > 0 ? `[🔒 TIER ${nextLvl}]` : '[🔒 LOCKED]';
      badgeStyle = 'background: rgba(239,68,68,0.25); color: #f87171; border: 1px solid #f87171;';
    } else {
      badgeText = curLvl > 0 ? `[LVL ${curLvl}/${maxLvl}]` : '[🌟 UNLOCKED]';
      badgeStyle = 'background: rgba(0,240,181,0.18); color: #00f0b5; border: 1px solid rgba(0,240,181,0.4);';
    }

    const row1Html = `
      <div class="card-header-row" style="display: flex; justify-content: space-between; align-items: center; width: 100%; gap: 8px;">
        <div style="display: flex; align-items: center; gap: 6px; min-width: 0; overflow: hidden;">
          <span class="card-title" style="font-size: 13px; font-weight: 700; color: ${titleColor}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${label}</span>
        </div>
        <span class="challenge-level-badge" style="font-size: 10px; font-weight: 700; padding: 2px 6px; border-radius: 4px; flex-shrink: 0; white-space: nowrap; ${badgeStyle}">${badgeText}</span>
      </div>
    `;

    const benefitDesc = this.formatHeadAugmentPreview(augType, curLvl, isMax ? curLvl : nextLvl);
    const row2Html = `
      <div class="card-benefit-row" style="font-size: 11px; color: ${isMax ? '#ffd166' : '#94a3b8'}; margin: 4px 0; width: 100%; text-align: left; line-height: 1.35;">
        ${curLvl > 0 && !isMax ? `[Level ${curLvl}] ` : ''}${benefitDesc}
      </div>
    `;

    let row3Html = '';
    if (!isTierUnlocked) {
      const chDesc = this.getChallengeDescription(augType, nextLvl);
      const { currentMetric, targetMetric, metricLabel, pct } = this.extractChallengeProgress(chDesc);
      row3Html = `
        <div class="card-challenge-row" style="display: flex; flex-direction: column; width: 100%; gap: 3px; margin: 2px 0;">
          <div class="challenge-feat-label" style="font-size: 10.5px; color: #fbbf24; text-align: left; width: 100%; font-weight: 600;">🎯 Feat: UNLOCK: ${chDesc}</div>
          <div class="challenge-bar-container" style="position: relative; width: 100%; height: 6px; background: rgba(2, 6, 23, 0.8); border-radius: 3px; overflow: hidden; margin-top: 1px;">
            <div class="challenge-progress-bar" style="width: ${pct}%; height: 100%; background: linear-gradient(90deg, #f59e0b, #ffd166, #00f0b5); transition: width 0.3s ease;"></div>
          </div>
          <div class="challenge-metric-row" style="display: flex; justify-content: space-between; width: 100%; font-size: 10px; color: #00f0b5; margin-top: 1px;">
            <span>${metricLabel}: ${currentMetric} / ${targetMetric}</span>
            <span style="font-weight: 700;">${pct}%</span>
          </div>
        </div>
      `;
    } else {
      row3Html = `
        <div class="card-challenge-row" style="display: flex; flex-direction: column; width: 100%; gap: 2px; margin: 1px 0;">
          <div class="challenge-bar-container" style="position: relative; width: 100%; height: 4px; background: rgba(2, 6, 23, 0.8); border-radius: 2px; overflow: hidden;">
            <div class="challenge-progress-bar" style="width: 100%; height: 100%; background: ${isMax ? 'linear-gradient(90deg, #f59e0b, #ffd166)' : 'linear-gradient(90deg, #00a880, #00f0b5)'}; transition: width 0.3s ease;"></div>
          </div>
        </div>
      `;
    }

    let row4Html = '';
    if (isMax) {
      row4Html = `<div class="cost-tag max-level challenge-status completed" style="width: 100%; text-align: center; font-size: 11px; font-weight: 700; background: rgba(255,209,102,0.25); color: var(--gold-soft); border: 1px solid var(--gold-soft); border-radius: 6px; padding: 5px 8px; box-sizing: border-box;">🌟 [MAX LEVEL]</div>`;
    } else if (!isTierUnlocked) {
      row4Html = `<div class="cost-tag tier-locked challenge-status in-progress" style="width: 100%; text-align: center; font-size: 10px; font-weight: 700; background: rgba(239,68,68,0.25); color: #f87171; border: 1px solid #f87171; border-radius: 6px; padding: 4px 6px; box-sizing: border-box;">🔒 [TIER ${nextLvl} LOCKED] 🪙 ${cost} Ouro${missing > 0 ? ` (Need ${missing} more)` : ''}</div>`;
    } else if (!isAffordable) {
      row4Html = `<div class="cost-tag unaffordable challenge-status completed" style="width: 100%; text-align: center; font-size: 10.5px; font-weight: 700; background: rgba(239,68,68,0.18); color: #f87171; border: 1px solid rgba(239,68,68,0.4); border-radius: 6px; padding: 5px 8px; box-sizing: border-box;">💰 ${cost} 🪙 (Need ${missing} more) [${curOuro}/${cost} 🪙]${curLvl === 0 ? ' [TIER 1 UNLOCKED]' : ''}</div>`;
    } else {
      row4Html = `<div class="cost-tag affordable challenge-status completed" style="width: 100%; text-align: center; font-size: 11px; font-weight: 700; background: rgba(0,240,181,0.18); color: #00f0b5; border: 1px solid #00f0b5; border-radius: 6px; padding: 5px 8px; box-shadow: 0 0 8px rgba(0,240,181,0.25); box-sizing: border-box;">💰 ${cost} 🪙 BUY ${curLvl > 0 ? `TIER ${nextLvl}` : 'TIER 1'} ⚡ (${cost} Ouro)${curLvl === 0 ? ' [TIER 1 UNLOCKED]' : ''}</div>`;
    }

    btn.disabled = false;
    btn.setAttribute('aria-disabled', String(isMax || !canAfford || !isTierUnlocked));
    btn.innerHTML = `${row1Html}${row2Html}${row3Html}${row4Html}`;

    btn.addEventListener('click', () => {
      if (curLvl >= maxLvl) {
        this.showToast('🌟 Module is already at Maximum Level!', false);
        return;
      }
      if (!isTierUnlocked) {
        const chDesc = this.getChallengeDescription(augType, nextLvl);
        this.showToast(`🔒 Tier ${nextLvl} Locked: ${chDesc}`, true);
        Services.Sound.playError();
        return;
      }
      const liveOuro = Math.floor(player ? (player.ouro ?? player.xp ?? 0) : 0);
      if (liveOuro < cost) {
        const missing = cost - liveOuro;
        this.showToast(`⚠️ Insufficient Ouro: You have ${liveOuro} 🪙, need ${cost} 🪙! (Need ${missing} more)`, true);
        Services.Sound.playError();
        return;
      }
      if (player) {
        const spent = typeof player.SpendOuro === 'function'
          ? player.SpendOuro(cost)
          : (typeof player.spendOuro === 'function' ? player.spendOuro(cost) : false);
        if (!spent) {
          const missing = cost - Math.floor(player.ouro ?? player.xp ?? 0);
          this.showToast(`⚠️ Insufficient Ouro: You have ${Math.floor(player.ouro ?? player.xp ?? 0)} 🪙, need ${cost} 🪙! (Need ${missing} more)`, true);
          Services.Sound.playError();
          return;
        }
        if (player.installHeadAugment) {
          player.installHeadAugment(augType);
        } else {
          player.headAugment = augType;
          player.headAugmentLevel = nextLvl;
          player.headPurchaseCount = (player.headPurchaseCount || 0) + 1;
        }
        Services.Sound.playLevelUp();
        this.refresh();
        if (this.root && this.root.hudView) {
          this.root.hudView.tick(player);
        }
      }
    });

    parent.appendChild(btn);
  }

  private formatHeadAugmentPreview(type: string, curLvl: number, nextLvl: number): string {
    switch (type) {
      case 'fangs':
        return curLvl >= nextLvl
          ? `Poison Bite (Deals ${curLvl * 12} DPS)`
          : `Poison Bite (Deals ${curLvl * 12} -> ${nextLvl * 12} DPS)`;
      case 'maw':
        return curLvl >= nextLvl
          ? `Voracious Appetite (Bite Damage: +${curLvl * 15}%)`
          : `Voracious Appetite (Bite Damage: +${curLvl * 15}% -> +${nextLvl * 15}%)`;
      case 'horns':
        return curLvl >= nextLvl
          ? `Ramming Impact (Ram Damage: ${curLvl * 25})`
          : `Ramming Impact (Ram Damage: ${curLvl * 25} -> ${nextLvl * 25})`;
      case 'laser':
        return curLvl >= nextLvl
          ? `Ocular Beam (Damage: ${curLvl * 18} every 2s)`
          : `Ocular Beam (Damage: ${curLvl * 18} -> ${nextLvl * 18} every 2s)`;
      case 'crown':
        return curLvl >= nextLvl
          ? `Solar Radiance (Aura Burn: ${curLvl * 8} DPS)`
          : `Solar Radiance (Aura Burn: ${curLvl * 8} -> ${nextLvl * 8} DPS)`;
      default:
        return `Level ${curLvl >= nextLvl ? curLvl : nextLvl}`;
    }
  }

  private formatHeadModulePreview(type: string, curLvl: number, nextLvl: number): string {
    switch (type) {
      case 'turret':
        return curLvl >= nextLvl
          ? `Rapid Spitter (Fire Rate: ${curLvl * 1.5} shots/s)`
          : `Rapid Spitter (Fire Rate: ${curLvl * 1.5} -> ${nextLvl * 1.5} shots/s)`;
      case 'tesla':
        return curLvl >= nextLvl
          ? `Chain Lightning (Arcs: ${curLvl * 2} targets)`
          : `Chain Lightning (Arcs: ${curLvl * 2} -> ${nextLvl * 2} targets)`;
      case 'magma':
        return curLvl >= nextLvl
          ? `Magma Eruption (AOE Burn: ${curLvl * 20} dmg)`
          : `Magma Eruption (AOE Burn: ${curLvl * 20} -> ${nextLvl * 20} dmg)`;
      case 'venom':
        return curLvl >= nextLvl
          ? `Toxic Cloud (DPS: ${curLvl * 10})`
          : `Toxic Cloud (DPS: ${curLvl * 10} -> ${nextLvl * 10})`;
      case 'tachyon':
        return curLvl >= nextLvl
          ? `Piercing Tachyon Laser (Damage: ${curLvl * 30})`
          : `Piercing Tachyon Laser (Damage: ${curLvl * 30} -> ${nextLvl * 30})`;
      case 'cryo':
        return curLvl >= nextLvl
          ? `Frost Nova (Slows enemies by ${Math.min(80, curLvl * 25)}%)`
          : `Frost Nova (Slows enemies by ${Math.min(80, curLvl * 25)}% -> ${Math.min(80, nextLvl * 25)}%)`;
      case 'plasma':
        return curLvl >= nextLvl
          ? `Heavy Plasma Bomb (Damage: ${curLvl * 45})`
          : `Heavy Plasma Bomb (Damage: ${curLvl * 45} -> ${nextLvl * 45})`;
      case 'flak':
        return curLvl >= nextLvl
          ? `Flak Shrapnel Cannon (Shrapnel: ${curLvl * 4} fragments)`
          : `Flak Shrapnel Cannon (Shrapnel: ${curLvl * 4} -> ${nextLvl * 4} fragments)`;
      case 'scattershot':
        return curLvl >= nextLvl
          ? `Scatter Pellet Volley (Pellets: ${curLvl * 5})`
          : `Scatter Pellet Volley (Pellets: ${curLvl * 5} -> ${nextLvl * 5})`;
      case 'needler':
        return curLvl >= nextLvl
          ? `Kinetic Needler (Piercing spikes: ${curLvl * 3}/s)`
          : `Kinetic Needler (Piercing spikes: ${curLvl * 3} -> ${nextLvl * 3}/s)`;
      case 'shield':
        return curLvl >= nextLvl
          ? `Carapace Energy Barrier (+${curLvl * 25} Shield HP)`
          : `Carapace Energy Barrier (+${curLvl * 25} -> +${nextLvl * 25} Shield HP)`;
      case 'spikes':
        return curLvl >= nextLvl
          ? `Reflective Thorny Spikes (Reflects ${curLvl * 30}% contact damage)`
          : `Reflective Thorny Spikes (Reflects ${curLvl * 30}% -> ${nextLvl * 30}% contact damage)`;
      case 'regen':
        return curLvl >= nextLvl
          ? `Cellular Regeneration (+${curLvl * 1.5} HP/s)`
          : `Cellular Regeneration (+${curLvl * 1.5} -> +${nextLvl * 1.5} HP/s)`;
      case 'magnet':
        return curLvl >= nextLvl
          ? `Bio-Magnetic Pull (Food Attraction Radius: +${curLvl * 60}px)`
          : `Bio-Magnetic Pull (Food Attraction Radius: +${curLvl * 60} -> +${nextLvl * 60}px)`;
      case 'chrono':
        return curLvl >= nextLvl
          ? `Temporal Slow Field (Slows nearby bullets by ${curLvl * 20}%)`
          : `Temporal Slow Field (Slows nearby bullets by ${curLvl * 20}% -> ${nextLvl * 20}%)`;
      case 'nanite':
        return curLvl >= nextLvl
          ? `Nanite Repair Swarm (Repairs damaged segments by ${curLvl * 3} HP every 3s)`
          : `Nanite Repair Swarm (Repairs damaged segments by ${curLvl * 3} -> ${nextLvl * 3} HP every 3s)`;
      default:
        return `Level ${curLvl >= nextLvl ? curLvl : nextLvl}`;
    }
  }

  private createSectionHeader(title: string): HTMLElement {
    const hdr = document.createElement('div');
    hdr.className = 'stats-section-header';
    hdr.style.fontSize = '12px';
    hdr.style.fontWeight = '800';
    hdr.style.letterSpacing = '0.08em';
    hdr.style.color = '#38bdf8';
    hdr.style.borderBottom = '1px solid rgba(56, 189, 248, 0.25)';
    hdr.style.paddingBottom = '4px';
    hdr.style.marginTop = '2px';
    hdr.style.textAlign = 'left';
    hdr.textContent = title;
    return hdr;
  }

  private createGlassCard(customClass?: string, id?: string): HTMLElement {
    const card = document.createElement('div');
    card.className = `glass-card cyber-card ${customClass || ''}`;
    if (id) card.id = id;
    card.style.padding = '10px 12px';
    card.style.background = 'rgba(10, 20, 35, 0.9)';
    card.style.borderRadius = '8px';
    card.style.border = '1px solid rgba(0, 240, 181, 0.25)';
    return card;
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
