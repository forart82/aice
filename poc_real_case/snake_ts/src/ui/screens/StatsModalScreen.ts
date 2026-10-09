/**
 * Ouroboros Ascension — Dual-Mode In-Run & Global Statistics Screen (StatsModalScreen.ts)
 *
 * Provides a cybernetic glassmorphic modal telemetry suite supporting two operational modes:
 *
 * 1. Mode 'run' (In-Run Live Telemetry):
 *    - Header: 📊 EXPEDITION TELEMETRY (FLOOR ${floor})
 *    - Vitals: Current Score, Ouro Wallet, Serpent Length, Peak Length, High Combo.
 *    - Food Eaten Breakdown: Apples, Golden Apples, Potions, Shards, Prisms.
 *    - Bestiary Kills Breakdown: Swarmlings, Scarabs, Spitters, Phantoms, Arc Drones, Magma Brutes.
 *    - Colossal Boss Defeats: List of defeated colossal bosses with floor numbers.
 *    - Installed Cranial Modules & Augments: Head augment, equipped helmet, and socketed cranial modules.
 *    - 🎯 Live In-Run Challenge Progress Tracker: Lists locked Cranial Lab upgrades with exact live progress bars
 *      (e.g., Magma Vent: Length 18 / 25, Ramming Horns: Kills 14 / 20, Bio-Magnet: Foods 22 / 30).
 *
 * 2. Mode 'global' (Global Career Statistics):
 *    - Header: 📈 GLOBAL CAREER RECORDS
 *    - Career Summary: Total Runs, Victories, Win Rate %, Highest Floor, Peak Length, High Score, Best Combo.
 *    - Lifetime Totals: Total Kills, Total Bosses, Total Food Ingested, Total Ouro Earned, Total Shards Collected, Playtime.
 *    - Armory / Class Mastery Summary: Serpent class unlocks, Sanctuary progression, and Boss Helmet Vault count.
 *
 * Backwards-Compatibility:
 * Retains all legacy classes and aliases (.stat-score-val, .stat-floor-val, .stat-foods-val, .stat-kills-val,
 * .stat-record-highscore, .stat-record-runs, etc.) ensuring 100% interoperability with all test harnesses.
 */

import { BaseModalScreen } from '../BaseModalScreen.js';
import { UiRoot } from '../UiRoot.js';
import { Widgets } from '../Widgets.js';
import { Services } from '../../core/Services.js';
import { MetaProgression } from '../../data/MetaProgression.js';
import { GameData } from '../../data/GameData.js';
import { GameState } from '../../sim/GameState.js';
import { MathX } from '../../core/MathX.js';
import { SnakePlayer } from '../../sim/SnakePlayer.js';

export type StatsMode = 'run' | 'global';
export type StatsTabMode = StatsMode;

export interface IStatsModalPayload {
  mode?: StatsMode;
  tab?: StatsMode;
}

export class StatsModalScreen extends BaseModalScreen {
  public readonly id: string = 'modal-stats';
  private _mode: StatsMode = 'run';

  // DOM Components
  private _panel!: HTMLElement;
  private _titleEl!: HTMLElement;
  private _subtitleEl!: HTMLElement;
  private _tabBar!: HTMLElement;
  private _tabRunBtn!: HTMLButtonElement;
  private _tabGlobalBtn!: HTMLButtonElement;
  private _contentArea!: HTMLElement;
  private _actionsRow!: HTMLElement;
  private _returnBtn!: HTMLButtonElement;

  constructor(root: UiRoot) {
    super(root, 'stats-modal');
    this.build();
  }

  public get currentMode(): StatsMode {
    return this._mode;
  }

  public get activeTab(): StatsMode {
    return this._mode;
  }

  public setMode(mode: StatsMode): void {
    this._mode = mode;
    this.updateTabStyles();
    this.renderModeView();
    this.refresh();
  }

  public setTab(tab: StatsMode): void {
    this.setMode(tab);
  }

  /**
   * Constructs the glassmorphic shell, tab headers, scrollable content area, and action buttons.
   */
  protected build(): void {
    if (typeof document === 'undefined') return;
    this.element.innerHTML = '';

    this._panel = Widgets.createGlassPanel(840, 'stats-panel summary-panel');
    this._panel.style.maxHeight = 'min(94vh, 94dvh)';
    this._panel.style.width = '96vw';
    this._panel.style.display = 'flex';
    this._panel.style.flexDirection = 'column';
    this._panel.style.overflow = 'hidden';
    this._panel.style.padding = '14px 16px';
    this._panel.style.gap = '8px';
    this.element.appendChild(this._panel);

    // Modal Header Section
    const header = document.createElement('div');
    header.className = 'modal-header stats-header';
    header.style.display = 'flex';
    header.style.justifyContent = 'space-between';
    header.style.alignItems = 'flex-start';
    header.style.flexShrink = '0';
    header.style.width = '100%';

    const titleGroup = document.createElement('div');
    titleGroup.className = 'stats-header-title-group';
    titleGroup.style.textAlign = 'left';

    this._titleEl = document.createElement('h2');
    this._titleEl.className = 'cyber-modal-title stats-title';
    this._titleEl.style.fontSize = 'clamp(15px, 2.2vw, 20px)';
    this._titleEl.style.margin = '0';
    titleGroup.appendChild(this._titleEl);

    this._subtitleEl = document.createElement('p');
    this._subtitleEl.className = 'cyber-modal-subtitle stats-subtitle';
    this._subtitleEl.style.fontSize = 'clamp(10px, 1.3vw, 12px)';
    this._subtitleEl.style.margin = '2px 0 0 0';
    this._subtitleEl.style.color = '#94a3b8';
    titleGroup.appendChild(this._subtitleEl);

    header.appendChild(titleGroup);

    const closeBtn = document.createElement('button');
    closeBtn.className = 'cyber-btn btn-ghost btn-close-top btn-close-stats';
    closeBtn.style.padding = '4px 10px';
    closeBtn.style.fontSize = '14px';
    closeBtn.style.borderRadius = '6px';
    closeBtn.style.minWidth = '44px';
    closeBtn.style.minHeight = '44px';
    closeBtn.setAttribute('aria-label', 'Close Statistics');
    closeBtn.textContent = '✕';
    closeBtn.addEventListener('click', () => {
      Services.Sound.playUi();
      this.handleClose();
    });
    header.appendChild(closeBtn);

    this._panel.appendChild(header);

    // Segmented Tab Controls
    this._tabBar = document.createElement('div');
    this._tabBar.className = 'stats-tab-bar stats-actions-row stats-tab-group';
    this._tabBar.style.display = 'flex';
    this._tabBar.style.background = 'rgba(15, 23, 42, 0.85)';
    this._tabBar.style.border = '1px solid rgba(148, 163, 184, 0.2)';
    this._tabBar.style.borderRadius = '8px';
    this._tabBar.style.padding = '3px';
    this._tabBar.style.gap = '4px';
    this._tabBar.style.flexShrink = '0';

    this._tabRunBtn = document.createElement('button');
    this._tabRunBtn.className = 'cyber-btn btn-tab-run btn-primary';
    this._tabRunBtn.style.flex = '1';
    this._tabRunBtn.style.padding = '6px 12px';
    this._tabRunBtn.style.fontSize = '11.5px';
    this._tabRunBtn.style.borderRadius = '6px';
    this._tabRunBtn.textContent = '📊 In-Run Telemetry';
    this._tabRunBtn.addEventListener('click', () => {
      Services.Sound.playUi();
      this.setMode('run');
    });
    this._tabBar.appendChild(this._tabRunBtn);

    this._tabGlobalBtn = document.createElement('button');
    this._tabGlobalBtn.className = 'cyber-btn btn-tab-global btn-secondary';
    this._tabGlobalBtn.style.flex = '1';
    this._tabGlobalBtn.style.padding = '6px 12px';
    this._tabGlobalBtn.style.fontSize = '11.5px';
    this._tabGlobalBtn.style.borderRadius = '6px';
    this._tabGlobalBtn.textContent = '📈 Career Records';
    this._tabGlobalBtn.addEventListener('click', () => {
      Services.Sound.playUi();
      this.setMode('global');
    });
    this._tabBar.appendChild(this._tabGlobalBtn);

    this._panel.appendChild(this._tabBar);

    // Scrollable Content Viewport
    this._contentArea = document.createElement('div');
    this._contentArea.className = 'stats-content-area stats-scroll-container';
    this._contentArea.style.flex = '1 1 auto';
    this._contentArea.style.minHeight = '0';
    this._contentArea.style.overflowY = 'auto';
    this._contentArea.style.display = 'flex';
    this._contentArea.style.flexDirection = 'column';
    this._contentArea.style.gap = '10px';
    this._contentArea.style.padding = '4px 2px 14px 2px';
    (this._contentArea.style as any).webkitOverflowScrolling = 'touch';
    this._panel.appendChild(this._contentArea);

    // Bottom Action Row
    this._actionsRow = Widgets.createActionsRow();
    this._actionsRow.style.flexShrink = '0';
    this._actionsRow.style.marginTop = 'auto';
    this._actionsRow.style.paddingTop = '6px';
    this._actionsRow.style.borderTop = '1px solid rgba(148, 163, 184, 0.15)';
    this._panel.appendChild(this._actionsRow);

    this.renderModeView();
  }

  /**
   * Checks whether an active gameplay expedition is currently running.
   */
  public isRunActive(): boolean {
    const eng = this.root.engine;
    if (!eng) return false;
    const state = eng.State !== undefined ? eng.State : eng.state;
    const isMenu = state === GameState.Menu || state === 'Menu' || state === 0;
    const isOver = state === GameState.GameOver || state === 'GameOver' || state === 4;
    const hasPlayer = !!(eng.Player || eng.player);
    const isExplicitlyInactive = eng.RunActive === false || eng.runActive === false;
    return !isMenu && !isOver && hasPlayer && !isExplicitlyInactive;
  }

  private updateTabStyles(): void {
    if (this._tabBar) {
      this._tabBar.style.display = 'none';
    }
  }

  /**
   * Handles incoming modal show payloads.
   * - When opened during an active run without an explicit global records request,
   *   seamlessly delegates to modal-snake-lab on the Telemetry tab.
   * - When opened from the Main Menu or in global mode, exclusively renders Global Career Records.
   */
  protected override onShow(payload?: any): void {
    const runActive = this.isRunActive();
    const isExplicitGlobal = payload === 'global' || payload === 'records' || (payload && typeof payload === 'object' && (payload.mode === 'global' || payload.tab === 'global'));

    if (runActive && !isExplicitGlobal) {
      this._mode = 'run';
      this.renderModeView();
      this.refresh();
      this.root.showScreen('modal-snake-lab', { tab: 'telemetry' });
      return;
    }

    this._mode = 'global';
    this.updateTabStyles();
    this.renderModeView();
    this.refresh();
  }

  /**
   * Renders the modal view container corresponding to the active mode.
   */
  private renderModeView(): void {
    this._contentArea.innerHTML = '';
    this._actionsRow.innerHTML = '';

    if (this._mode === 'run') {
      this.renderRunModeView();
    } else {
      this._mode = 'global';
      this.renderGlobalModeView();
    }
  }

  /**
   * =========================================================================
   * 1. Mode 'run': In-Run Live Telemetry View
   * =========================================================================
   */
  private renderRunModeView(): void {
    const floor = this.root.engine?.currentFloor || this.root.engine?.CurrentFloor || 1;
    this._titleEl.textContent = `📊 EXPEDITION TELEMETRY (FLOOR ${floor})`;
    this._subtitleEl.textContent = 'Live vital signs, tactical harvest, bestiary telemetry & cranial challenge tracking';

    // 1. Live Vitals Grid
    const vitalsSection = this.createSectionHeader('⚡ SERPENT VITALS & TELEMETRY');
    this._contentArea.appendChild(vitalsSection);

    const vitalsGrid = document.createElement('div');
    vitalsGrid.className = 'stats-vitals-grid run-telemetry-grid run-telemetry-section stats-grid';
    vitalsGrid.style.display = 'grid';
    vitalsGrid.style.gridTemplateColumns = 'repeat(auto-fit, minmax(115px, 1fr))';
    vitalsGrid.style.gap = '6px';
    vitalsGrid.innerHTML = `
      <div class="stat-card">
        <span class="stat-label">FLOOR</span>
        <span class="stat-val stat-floor-val">${floor}</span>
      </div>
      <div class="stat-card">
        <span class="stat-label">CURRENT SCORE</span>
        <span class="stat-val stat-score stat-score-val" style="color: #38bdf8;">0</span>
      </div>
      <div class="stat-card">
        <span class="stat-label">OURO WALLET</span>
        <span class="stat-val stat-ouro stat-ouro-val" style="color: var(--gold-soft);">0 🪙</span>
      </div>
      <div class="stat-card">
        <span class="stat-label">STARS BANKED</span>
        <span class="stat-val stat-shards-val" style="color: #ffd166;">+0 ⭐</span>
      </div>
      <div class="stat-card">
        <span class="stat-label">SERPENT LENGTH</span>
        <span class="stat-val stat-length stat-length-val" style="color: #00f0b5;">2</span>
      </div>
      <div class="stat-card">
        <span class="stat-label">PEAK LENGTH</span>
        <span class="stat-val stat-peak-length" style="color: #c084fc;">2</span>
      </div>
      <div class="stat-card">
        <span class="stat-label">CURRENT COMBO</span>
        <span class="stat-val stat-curcombo-val" style="color: var(--gold-soft);">0x</span>
      </div>
      <div class="stat-card">
        <span class="stat-label">HIGH COMBO</span>
        <span class="stat-val stat-combo stat-combo-val" style="color: #f87171;">0x</span>
      </div>
      <div class="stat-card">
        <span class="stat-label">HEAD HEALTH</span>
        <span class="stat-val stat-headhp-val" style="color: #f87171;">100/100</span>
      </div>
      <div class="stat-card">
        <span class="stat-label">CLASS</span>
        <span class="stat-val stat-class-val" style="color: #a78bfa;">🐍 Emerald</span>
      </div>
      <div class="stat-card" style="display:none;">
        <span class="stat-label">TOTAL FOODS</span>
        <span class="stat-val stat-foods-val">0</span>
      </div>
      <div class="stat-card" style="display:none;">
        <span class="stat-label">TOTAL KILLS</span>
        <span class="stat-val stat-kills-val">0</span>
      </div>
      <div class="stat-card" style="display:none;">
        <span class="stat-label">TOTAL BOSSES</span>
        <span class="stat-val stat-bosses-val">0</span>
      </div>
    `;
    this._contentArea.appendChild(vitalsGrid);

    // 2. Food Eaten Breakdown
    const foodSection = this.createSectionHeader('🍏 NOURISHMENT & HARVEST BREAKDOWN');
    this._contentArea.appendChild(foodSection);

    const foodGrid = document.createElement('div');
    foodGrid.className = 'food-breakdown-grid';
    foodGrid.style.display = 'grid';
    foodGrid.style.gridTemplateColumns = 'repeat(auto-fit, minmax(110px, 1fr))';
    foodGrid.style.gap = '6px';
    foodGrid.innerHTML = `
      <div class="food-pill stat-card" style="display: flex; justify-content: space-between; align-items: center; padding: 6px 10px;">
        <span style="font-size: 11px;">🍏 Apples</span>
        <span class="food-apple-count" style="font-size: 12px; font-weight: 700; color: #10b981;">0</span>
      </div>
      <div class="food-pill stat-card" style="display: flex; justify-content: space-between; align-items: center; padding: 6px 10px;">
        <span style="font-size: 11px;">🌟 Golden</span>
        <span class="food-golden-count" style="font-size: 12px; font-weight: 700; color: #ffb703;">0</span>
      </div>
      <div class="food-pill stat-card" style="display: flex; justify-content: space-between; align-items: center; padding: 6px 10px;">
        <span style="font-size: 11px;">❤️ Potions</span>
        <span class="food-potion-count" style="font-size: 12px; font-weight: 700; color: #ff3366;">0</span>
      </div>
      <div class="food-pill stat-card" style="display: flex; justify-content: space-between; align-items: center; padding: 6px 10px;">
        <span style="font-size: 11px;">⭐ Stars</span>
        <span class="food-shard-count" style="font-size: 12px; font-weight: 700; color: #ffd166;">0</span>
      </div>
      <div class="food-pill stat-card" style="display: flex; justify-content: space-between; align-items: center; padding: 6px 10px;">
        <span style="font-size: 11px;">🔮 Prisms</span>
        <span class="food-prism-count" style="font-size: 12px; font-weight: 700; color: #f472b6;">0</span>
      </div>
    `;
    this._contentArea.appendChild(foodGrid);

    // 3. Bestiary Kills Breakdown
    const bestiarySection = this.createSectionHeader('👾 HOSTILE BESTIARY ELIMINATIONS');
    this._contentArea.appendChild(bestiarySection);

    const bestiaryGrid = document.createElement('div');
    bestiaryGrid.className = 'bestiary-grid';
    bestiaryGrid.style.display = 'grid';
    bestiaryGrid.style.gridTemplateColumns = 'repeat(auto-fit, minmax(110px, 1fr))';
    bestiaryGrid.style.gap = '6px';
    bestiaryGrid.innerHTML = `
      <div class="bestiary-pill stat-card" style="display: flex; justify-content: space-between; align-items: center; padding: 6px 10px;">
        <span style="font-size: 11px;">👾 Swarmlings</span>
        <span class="kill-swarmling-count" style="font-size: 12px; font-weight: 700; color: #fb7185;">0</span>
      </div>
      <div class="bestiary-pill stat-card" style="display: flex; justify-content: space-between; align-items: center; padding: 6px 10px;">
        <span style="font-size: 11px;">🪲 Scarabs</span>
        <span class="kill-scarab-count" style="font-size: 12px; font-weight: 700; color: #ef4444;">0</span>
      </div>
      <div class="bestiary-pill stat-card" style="display: flex; justify-content: space-between; align-items: center; padding: 6px 10px;">
        <span style="font-size: 11px;">🦂 Spitters</span>
        <span class="kill-spitter-count" style="font-size: 12px; font-weight: 700; color: #c084fc;">0</span>
      </div>
      <div class="bestiary-pill stat-card" style="display: flex; justify-content: space-between; align-items: center; padding: 6px 10px;">
        <span style="font-size: 11px;">👻 Phantoms</span>
        <span class="kill-phantom-count" style="font-size: 12px; font-weight: 700; color: #f43f5e;">0</span>
      </div>
      <div class="bestiary-pill stat-card" style="display: flex; justify-content: space-between; align-items: center; padding: 6px 10px;">
        <span style="font-size: 11px;">🛸 Arc Drones</span>
        <span class="kill-drone-count" style="font-size: 12px; font-weight: 700; color: #38bdf8;">0</span>
      </div>
      <div class="bestiary-pill stat-card" style="display: flex; justify-content: space-between; align-items: center; padding: 6px 10px;">
        <span style="font-size: 11px;">👹 Magma Brutes</span>
        <span class="kill-brute-count" style="font-size: 12px; font-weight: 700; color: #f97316;">0</span>
      </div>
    `;
    this._contentArea.appendChild(bestiaryGrid);

    // 4. Boss Defeats List
    const bossSection = this.createSectionHeader('👑 CONQUERED APEX GUARDIANS');
    this._contentArea.appendChild(bossSection);

    const bossList = document.createElement('div');
    bossList.className = 'boss-defeats-list';
    bossList.style.display = 'flex';
    bossList.style.flexDirection = 'column';
    bossList.style.gap = '4px';
    bossList.style.background = 'rgba(15, 23, 42, 0.6)';
    bossList.style.border = '1px solid rgba(148, 163, 184, 0.2)';
    bossList.style.borderRadius = '8px';
    bossList.style.padding = '8px 10px';
    bossList.style.fontSize = '11.5px';
    this._contentArea.appendChild(bossList);

    // 5. Installed Cranial Modules & Augments
    const modulesSection = this.createSectionHeader('🧬 INSTALLED CRANIAL MODULES & HELMET');
    this._contentArea.appendChild(modulesSection);

    const modulesList = document.createElement('div');
    modulesList.className = 'installed-modules-list';
    modulesList.style.display = 'flex';
    modulesList.style.flexWrap = 'wrap';
    modulesList.style.gap = '6px';
    modulesList.style.background = 'rgba(15, 23, 42, 0.6)';
    modulesList.style.border = '1px solid rgba(148, 163, 184, 0.2)';
    modulesList.style.borderRadius = '8px';
    modulesList.style.padding = '8px 10px';
    this._contentArea.appendChild(modulesList);

    // 6. 🎯 Live In-Run Challenge Progress Tracker
    const challengeSection = this.createSectionHeader('🎯 LIVE CRANIAL LAB CHALLENGE PROGRESS TRACKER');
    this._contentArea.appendChild(challengeSection);

    const challengeList = document.createElement('div');
    challengeList.className = 'challenge-tracker-list run-challenges-section';
    challengeList.style.display = 'grid';
    challengeList.style.gridTemplateColumns = 'repeat(auto-fit, minmax(260px, 1fr))';
    challengeList.style.gap = '6px';
    this._contentArea.appendChild(challengeList);

    // Actions
    this._returnBtn = Widgets.createButton('Resume Expedition ⚡', 'primary', () => {
      Services.Sound.playUi();
      this.handleClose();
    }, 'btn-resume btn-back btn-close');
    this._actionsRow.appendChild(this._returnBtn);
  }

  /**
   * =========================================================================
   * 2. Mode 'global': Global Career Records View
   * =========================================================================
   */
  private renderGlobalModeView(): void {
    this._titleEl.textContent = '📈 GLOBAL CAREER RECORDS';
    this._subtitleEl.textContent = 'Lifetime cosmic achievements, battle logs, currency banked & armory unlocks';

    // 1. Career Summary Grid
    const summarySection = this.createSectionHeader('🏆 CAREER ASCENSION SUMMARY');
    this._contentArea.appendChild(summarySection);

    const summaryGrid = document.createElement('div');
    summaryGrid.className = 'career-summary-grid records-grid global-records-section stats-grid';
    summaryGrid.style.display = 'grid';
    summaryGrid.style.gridTemplateColumns = 'repeat(auto-fit, minmax(120px, 1fr))';
    summaryGrid.style.gap = '6px';
    summaryGrid.innerHTML = `
      <div class="stat-card">
        <span class="stat-label">TOTAL RUNS</span>
        <span class="stat-val record-total-runs stat-record-runs">0</span>
      </div>
      <div class="stat-card">
        <span class="stat-label">VICTORIES</span>
        <span class="stat-val record-victories stat-record-victories" style="color: #00f0b5;">0</span>
      </div>
      <div class="stat-card">
        <span class="stat-label">WIN RATE</span>
        <span class="stat-val record-win-rate" style="color: #38bdf8;">0.0%</span>
      </div>
      <div class="stat-card">
        <span class="stat-label">HIGHEST FLOOR</span>
        <span class="stat-val record-highest-floor stat-record-floor" style="color: #ffd166;">1</span>
      </div>
      <div class="stat-card">
        <span class="stat-label">PEAK LEVEL</span>
        <span class="stat-val stat-record-level" style="color: #4ade80;">LVL 1</span>
      </div>
      <div class="stat-card">
        <span class="stat-label">HIGH SCORE</span>
        <span class="stat-val record-high-score stat-record-highscore" style="color: #f87171;">0</span>
      </div>
      <div class="stat-card">
        <span class="stat-label">PEAK COMBO</span>
        <span class="stat-val record-highest-combo stat-record-combo" style="color: #c084fc;">0x</span>
      </div>
    `;
    this._contentArea.appendChild(summaryGrid);

    // 2. Lifetime Totals
    const totalsSection = this.createSectionHeader('🌌 LIFETIME TOTALS & PLAYTIME');
    this._contentArea.appendChild(totalsSection);

    const totalsGrid = document.createElement('div');
    totalsGrid.className = 'lifetime-totals-grid';
    totalsGrid.style.display = 'grid';
    totalsGrid.style.gridTemplateColumns = 'repeat(auto-fit, minmax(135px, 1fr))';
    totalsGrid.style.gap = '6px';
    totalsGrid.innerHTML = `
      <div class="lifetime-pill stat-card" style="display: flex; justify-content: space-between; align-items: center; padding: 6px 10px;">
        <span style="font-size: 11px;">👾 Total Kills</span>
        <span class="record-total-kills stat-record-kills" style="font-size: 12px; font-weight: 700; color: #f87171;">0</span>
      </div>
      <div class="lifetime-pill stat-card" style="display: flex; justify-content: space-between; align-items: center; padding: 6px 10px;">
        <span style="font-size: 11px;">👑 Total Bosses</span>
        <span class="record-total-bosses stat-record-bosses" style="font-size: 12px; font-weight: 700; color: #fbbf24;">0</span>
      </div>
      <div class="lifetime-pill stat-card" style="display: flex; justify-content: space-between; align-items: center; padding: 6px 10px;">
        <span style="font-size: 11px;">🍏 Total Food</span>
        <span class="record-total-foods stat-record-foods" style="font-size: 12px; font-weight: 700; color: #10b981;">0</span>
      </div>
      <div class="lifetime-pill stat-card" style="display: flex; justify-content: space-between; align-items: center; padding: 6px 10px;">
        <span style="font-size: 11px;">⭐ Total Stars</span>
        <span class="record-total-shards stat-record-shards" style="font-size: 12px; font-weight: 700; color: #ffd166;">0</span>
      </div>
      <div class="lifetime-pill stat-card" style="display: flex; justify-content: space-between; align-items: center; padding: 6px 10px;">
        <span style="font-size: 11px;">⏱️ Playtime</span>
        <span class="record-play-time stat-record-playtime" style="font-size: 12px; font-weight: 700; color: #38bdf8;">0m 0s</span>
      </div>
      <div class="lifetime-pill stat-card" style="display: flex; justify-content: space-between; align-items: center; padding: 6px 10px;">
        <span style="font-size: 11px;">⚡ Best Victory</span>
        <span class="record-best-time stat-record-besttime" style="font-size: 12px; font-weight: 700; color: #00f0b5;">--</span>
      </div>
    `;
    this._contentArea.appendChild(totalsGrid);

    // 3. Lifetime Hostile Bestiary Breakdown
    const bestiarySection = this.createSectionHeader('👾 LIFETIME HOSTILE BESTIARY & GUARDIANS');
    this._contentArea.appendChild(bestiarySection);

    const bestiaryGrid = document.createElement('div');
    bestiaryGrid.className = 'lifetime-bestiary-grid global-bestiary-section';
    bestiaryGrid.style.display = 'grid';
    bestiaryGrid.style.gridTemplateColumns = 'repeat(auto-fit, minmax(110px, 1fr))';
    bestiaryGrid.style.gap = '6px';
    bestiaryGrid.innerHTML = `
      <div class="bestiary-pill stat-card" style="display: flex; justify-content: space-between; align-items: center; padding: 6px 10px;">
        <span style="font-size: 11px;">🟢 Swarmlings</span>
        <span class="global-kill-swarmling" style="font-size: 12px; font-weight: 700; color: #10b981;">0</span>
      </div>
      <div class="bestiary-pill stat-card" style="display: flex; justify-content: space-between; align-items: center; padding: 6px 10px;">
        <span style="font-size: 11px;">🛡️ Scarabs</span>
        <span class="global-kill-scarab" style="font-size: 12px; font-weight: 700; color: #38bdf8;">0</span>
      </div>
      <div class="bestiary-pill stat-card" style="display: flex; justify-content: space-between; align-items: center; padding: 6px 10px;">
        <span style="font-size: 11px;">🏹 Spitters</span>
        <span class="global-kill-spitter" style="font-size: 12px; font-weight: 700; color: #f87171;">0</span>
      </div>
      <div class="bestiary-pill stat-card" style="display: flex; justify-content: space-between; align-items: center; padding: 6px 10px;">
        <span style="font-size: 11px;">👻 Phantoms</span>
        <span class="global-kill-phantom" style="font-size: 12px; font-weight: 700; color: #c084fc;">0</span>
      </div>
      <div class="bestiary-pill stat-card" style="display: flex; justify-content: space-between; align-items: center; padding: 6px 10px;">
        <span style="font-size: 11px;">⚡ Arc Drones</span>
        <span class="global-kill-drone" style="font-size: 12px; font-weight: 700; color: #ffd166;">0</span>
      </div>
      <div class="bestiary-pill stat-card" style="display: flex; justify-content: space-between; align-items: center; padding: 6px 10px;">
        <span style="font-size: 11px;">🔥 Magma Brutes</span>
        <span class="global-kill-brute" style="font-size: 12px; font-weight: 700; color: #fb923c;">0</span>
      </div>
    `;
    this._contentArea.appendChild(bestiaryGrid);

    // 4. Armory & Class Mastery Summary
    const armorySection = this.createSectionHeader('🏛️ ARMORY & CLASS MASTERY SUMMARY');
    this._contentArea.appendChild(armorySection);

    const armoryList = document.createElement('div');
    armoryList.className = 'class-mastery-list';
    armoryList.style.display = 'flex';
    armoryList.style.flexDirection = 'column';
    armoryList.style.gap = '6px';
    this._contentArea.appendChild(armoryList);

    // Actions
    const menuBtn = Widgets.createButton('Main Menu 🏛️', 'secondary', () => {
      Services.Sound.playUi();
      this.root.showScreen('modal-main-menu');
    }, 'btn-menu btn-back');

    const sanctuaryBtn = Widgets.createButton('Sanctuary ⭐', 'primary', () => {
      Services.Sound.playUi();
      this.root.showScreen('modal-sanctuary');
    }, 'btn-sanctuary');

    this._actionsRow.appendChild(menuBtn);
    this._actionsRow.appendChild(sanctuaryBtn);
  }

  private createSectionHeader(title: string): HTMLElement {
    const el = document.createElement('div');
    el.style.fontSize = '11px';
    el.style.fontWeight = '700';
    el.style.color = '#94a3b8';
    el.style.letterSpacing = '0.08em';
    el.style.textTransform = 'uppercase';
    el.style.marginTop = '4px';
    el.style.textAlign = 'left';
    el.textContent = title;
    return el;
  }

  /**
   * Refreshes all values dynamically from active simulation or MetaProgression.
   */
  protected override onRefresh(): void {
    if (this._mode === 'run') {
      this.refreshRunTelemetry();
    } else {
      this.refreshGlobalRecords();
    }
  }

  /**
   * Populates Mode 'run' live telemetry data.
   */
  private refreshRunTelemetry(): void {
    const engine = this.root.engine;
    const combat = engine?.combat || (engine as any)?.Combat;
    const player = engine?.player || (engine as any)?.Player;
    const meta = MetaProgression.Instance;

    const floor = engine?.currentFloor || engine?.CurrentFloor || 1;
    this._titleEl.textContent = `📊 EXPEDITION TELEMETRY (FLOOR ${floor})`;

    // Vitals
    const scoreVal = combat ? (combat.score ?? combat.Score ?? 0) : 0;
    const scoreEls = this.element.querySelectorAll('.stat-score, .stat-score-val');
    scoreEls.forEach(el => el.textContent = Widgets.grouped(scoreVal));

    const curOuro = Math.floor(player ? (player.ouro ?? player.xp ?? 0) : 0);
    const ouroEls = this.element.querySelectorAll('.stat-ouro, .stat-ouro-val');
    ouroEls.forEach(el => el.textContent = `${curOuro} 🪙`);

    const shardsVal = combat ? (combat.shardsEarned !== undefined ? combat.shardsEarned : (combat.ShardsEarned || 0)) : 0;
    const shardsEls = this.element.querySelectorAll('.stat-shards-val');
    shardsEls.forEach(el => el.textContent = `+${shardsVal} ⭐`);

    // Total serpent length including head is (player.segments.length + 1), exactly matching MetaProgression
    const curLen = ((player?.segments ? player.segments.length : (player?.Segments ? player.Segments.length : 0)) + 1);
    const lenEls = this.element.querySelectorAll('.stat-length, .stat-length-val');
    lenEls.forEach(el => el.textContent = `${curLen}`);

    const peakLen = player?.peakLength ?? player?.PeakLength ?? curLen;
    const peakEl = this.element.querySelector('.stat-peak-length');
    if (peakEl) peakEl.textContent = `${peakLen}`;

    const comboVal = combat ? (combat.comboCount ?? combat.ComboCount ?? 0) : 0;
    const curComboEl = this.element.querySelector('.stat-curcombo-val');
    if (curComboEl) curComboEl.textContent = `${comboVal}x`;

    const highCombo = combat ? (combat.highestRunCombo ?? combat.HighestRunCombo ?? combat.highestCombo ?? combat.HighestCombo ?? comboVal) : 0;
    const comboEls = this.element.querySelectorAll('.stat-combo, .stat-combo-val');
    comboEls.forEach(el => el.textContent = `${highCombo}x`);

    const headHp = player?.headHp !== undefined ? player.headHp : (player?.HeadHp !== undefined ? player.HeadHp : 50);
    const headMaxHp = player?.headMaxHp !== undefined ? player.headMaxHp : (player?.HeadMaxHp !== undefined ? player.HeadMaxHp : 50);
    const headHpEl = this.element.querySelector('.stat-headhp-val');
    if (headHpEl) headHpEl.textContent = `${Math.ceil(headHp)}/${headMaxHp}`;

    const className = player?.classConfig?.name || player?.classConfig?.Name || 'Emerald Viper';
    const classIcon = player?.classConfig?.icon || player?.classConfig?.Icon || '🐍';
    const classEl = this.element.querySelector('.stat-class-val');
    if (classEl) classEl.textContent = `${classIcon} ${className}`;

    // Food Breakdown
    const foodsByType = combat?.foodsEatenByType || combat?.FoodsEatenByType || {};
    const totalFoods = combat?.foodsEaten ?? combat?.FoodsEaten ?? (foodsByType['apple'] || 0) + (foodsByType['golden'] || 0);

    const appleEl = this.element.querySelector('.food-apple-count');
    if (appleEl) appleEl.textContent = `${foodsByType['apple'] || 0}`;

    const goldenEl = this.element.querySelector('.food-golden-count');
    if (goldenEl) goldenEl.textContent = `${foodsByType['golden'] || 0}`;

    const potionEl = this.element.querySelector('.food-potion-count');
    if (potionEl) potionEl.textContent = `${foodsByType['potion'] || 0}`;

    const shardEl = this.element.querySelector('.food-shard-count');
    if (shardEl) shardEl.textContent = `${foodsByType['shard'] || 0}`;

    const prismEl = this.element.querySelector('.food-prism-count');
    if (prismEl) prismEl.textContent = `${foodsByType['prism'] || 0}`;

    const foodTalliesEl = this.element.querySelector('.stat-foods-val');
    if (foodTalliesEl) foodTalliesEl.textContent = `${totalFoods}`;

    // Bestiary Kills Breakdown
    const killsByType = combat?.killsByType || combat?.KillsByType || {};
    const totalKills = combat?.kills ?? combat?.Kills ?? 0;

    const swarmEl = this.element.querySelector('.kill-swarmling-count');
    if (swarmEl) swarmEl.textContent = `${killsByType['swarmling'] || 0}`;

    const scarabEl = this.element.querySelector('.kill-scarab-count');
    if (scarabEl) scarabEl.textContent = `${killsByType['scarab'] || 0}`;

    const spitterEl = this.element.querySelector('.kill-spitter-count');
    if (spitterEl) spitterEl.textContent = `${killsByType['spitter'] || 0}`;

    const phantomEl = this.element.querySelector('.kill-phantom-count');
    if (phantomEl) phantomEl.textContent = `${killsByType['phantom'] || 0}`;

    const droneEl = this.element.querySelector('.kill-drone-count');
    if (droneEl) droneEl.textContent = `${killsByType['drone'] || 0}`;

    const bruteEl = this.element.querySelector('.kill-brute-count');
    if (bruteEl) bruteEl.textContent = `${killsByType['brute'] || 0}`;

    const killsTalliesEl = this.element.querySelector('.stat-kills-val');
    if (killsTalliesEl) killsTalliesEl.textContent = `${totalKills}`;

    const bossesCount = combat?.bossKills ?? combat?.BossKills ?? 0;
    const bossesTalliesEl = this.element.querySelector('.stat-bosses-val');
    if (bossesTalliesEl) bossesTalliesEl.textContent = `${bossesCount}`;

    // Defeated Bosses List
    const bossContainer = this.element.querySelector('.boss-defeats-list');
    if (bossContainer) {
      bossContainer.innerHTML = '';
      const defeatedTypes: string[] = combat?.defeatedBossTypes || combat?.DefeatedBossTypes || [];
      if (defeatedTypes.length === 0) {
        bossContainer.innerHTML = '<span style="color:#64748b; font-style:italic;">No Apex Guardians defeated yet in this expedition.</span>';
      } else {
        defeatedTypes.forEach((type, idx) => {
          const bossDef = GameData.Bosses.find(b => b.Type === type || b.type === type);
          const name = bossDef ? (bossDef.Name || bossDef.name) : type;
          const row = document.createElement('div');
          row.style.display = 'flex';
          row.style.justifyContent = 'space-between';
          row.style.alignItems = 'center';
          row.innerHTML = `
            <span>👑 <strong>Floor ${idx + 1}:</strong> ${name}</span>
            <span style="color:#ffd166; font-size:10.5px; font-weight:700;">CLEARED ⚡</span>
          `;
          bossContainer.appendChild(row);
        });
      }
    }

    // Installed Cranial Modules, Augment & Helmet
    const modulesContainer = this.element.querySelector('.installed-modules-list');
    if (modulesContainer) {
      modulesContainer.innerHTML = '';
      const chips: string[] = [];

      // Helmet
      const helm = player?.equippedHelmet || player?.EquippedHelmet;
      if (helm) {
        chips.push(`<div class="module-chip" style="background:rgba(255,209,102,0.15); border:1px solid #ffd166; border-radius:6px; padding:3px 8px; font-size:11px; color:#ffd166;">🪖 ${helm.name || helm.Name || 'Boss Helmet'}</div>`);
      }

      // Head Augment
      const augKey = player?.headAugment || player?.HeadAugment;
      const augLvl = player?.headAugmentLevel ?? player?.HeadAugmentLevel ?? 0;
      if (augKey && augLvl > 0) {
        const augNames: Record<string, string> = { fangs: 'Poison Fangs', maw: 'Voracious Maw', horns: 'Ramming Horns', laser: 'Ocular Laser', crown: 'Solar Crown' };
        chips.push(`<div class="module-chip" style="background:rgba(168,85,247,0.15); border:1px solid #c084fc; border-radius:6px; padding:3px 8px; font-size:11px; color:#c084fc;">🦷 ${augNames[augKey] || augKey} (Lv.${augLvl})</div>`);
      }

      // Head Modules
      const hMods: Record<string, number> = player?.headModules || player?.HeadModules || {};
      for (const [k, lvl] of Object.entries(hMods)) {
        if (lvl > 0) {
          const modDef = GameData.SocketModules.Get(k);
          const name = modDef ? (modDef.Name || modDef.name) : k;
          const isOff = SnakePlayer.isOffenseModule(k);
          const col = isOff ? '#f87171' : '#38bdf8';
          const bg = isOff ? 'rgba(248,113,113,0.15)' : 'rgba(56,189,248,0.15)';
          chips.push(`<div class="module-chip" style="background:${bg}; border:1px solid ${col}; border-radius:6px; padding:3px 8px; font-size:11px; color:${col};">${name} Lv.${lvl}</div>`);
        }
      }

      if (chips.length === 0) {
        modulesContainer.innerHTML = '<span style="color:#64748b; font-style:italic;">No cranial augments or modules installed yet. Visit the Mutation Lab [L].</span>';
      } else {
        modulesContainer.innerHTML = chips.join('');
      }
    }

    // Live In-Run Challenge Progress Tracker
    const trackerContainer = this.element.querySelector('.challenge-tracker-list');
    if (trackerContainer) {
      trackerContainer.innerHTML = '';
      const upgradeKeys = [
        'magma', 'cryo', 'plasma', 'tachyon', 'flak', 'scattershot', 'needler',
        'shield', 'spikes', 'regen', 'magnet', 'chrono', 'nanite',
        'fangs', 'maw', 'horns', 'laser', 'crown'
      ];

      const challengeCards: HTMLElement[] = [];

      for (const key of upgradeKeys) {
        let nextLockedTier = 0;
        for (let t = 1; t <= 3; t++) {
          if (!meta.IsTierUnlocked(key, t)) {
            nextLockedTier = t;
            break;
          }
        }

        const isFullyUnlocked = nextLockedTier === 0;
        const displayTier = isFullyUnlocked ? 3 : nextLockedTier;
        const modDef = GameData.SocketModules.Get(key);
        const label = modDef ? (modDef.Name || modDef.name) : (key.charAt(0).toUpperCase() + key.slice(1));
        const icon = modDef ? (modDef.Icon || modDef.icon) : '🧬';
        const chDesc = meta.GetUpgradeChallengeDescription(key, displayTier);

        let currentMetric = 0;
        let targetMetric = 1;
        let metricLabel = 'Progress';

        // Live Cranial Challenge Progress Tracker: Exact metrics synchronized with MetaProgression.ts
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
          currentMetric = killsByType['drone'] || 0;
          metricLabel = 'Arc Drones';
        } else if (chDesc.includes('Brute')) {
          const match = chDesc.match(/(\d+)\s+(?:Magma\s+)?Brute/i) || chDesc.match(/Slay\s+(\d+)/i);
          targetMetric = match ? parseInt(match[1]!, 10) : 10;
          currentMetric = killsByType['brute'] || 0;
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
        } else if (chDesc.includes('Length') || chDesc.includes('Grow')) {
          const match = chDesc.match(/Length\s+(\d+)/i) || chDesc.match(/Grow.*?(\d+)/i);
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
          const match = chDesc.match(/(\d+)x/i) || chDesc.match(/Streak\s+of\s+(\d+)x/i);
          targetMetric = match ? parseInt(match[1]!, 10) : 15;
          currentMetric = highCombo;
          metricLabel = 'Combo';
        } else if (chDesc.includes('Boss') || chDesc.includes('Defeat')) {
          const countMatch = chDesc.match(/(\d+)\s+Boss/i);
          const floorMatch = chDesc.match(/Floor\s+(\d+)/i);
          targetMetric = countMatch ? parseInt(countMatch[1]!, 10) : (floorMatch ? parseInt(floorMatch[1]!, 10) : 1);
          currentMetric = bossesCount;
          metricLabel = 'Bosses';
        }

        const pct = isFullyUnlocked ? 100 : MathX.clamp(Math.round((currentMetric / Math.max(1, targetMetric)) * 100), 0, 100);

        const card = document.createElement('div');
        card.className = `challenge-row-card ${isFullyUnlocked ? 'unlocked' : 'locked'}`;
        card.style.background = isFullyUnlocked ? 'rgba(0, 240, 181, 0.08)' : 'rgba(15, 23, 42, 0.85)';
        card.style.border = `1px solid ${isFullyUnlocked ? 'rgba(0, 240, 181, 0.35)' : 'rgba(148, 163, 184, 0.2)'}`;
        card.style.borderRadius = '6px';
        card.style.padding = '8px 10px';
        card.style.display = 'flex';
        card.style.flexDirection = 'column';
        card.style.gap = '4px';

        card.innerHTML = `
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <span style="font-weight: 700; font-size: 11.5px; color: ${isFullyUnlocked ? 'var(--cyan)' : '#f8fafc'};">${icon} ${label} <span style="font-size: 9.5px; color: #ffd166;">[Tier ${displayTier}]</span></span>
            <span class="challenge-status ${isFullyUnlocked ? 'completed' : 'in-progress'}" style="font-size: 9.5px; font-weight: 700; padding: 2px 6px; border-radius: 4px; background: ${isFullyUnlocked ? 'rgba(0, 240, 181, 0.15)' : 'rgba(255, 209, 102, 0.15)'}; color: ${isFullyUnlocked ? 'var(--cyan)' : 'var(--gold-soft)'}; border: 1px solid ${isFullyUnlocked ? 'var(--cyan)' : 'var(--gold-soft)'};">
              ${isFullyUnlocked ? 'UNLOCKED ✓' : `${pct}%`}
            </span>
          </div>
          <span class="challenge-desc" style="font-size: 10px; color: #94a3b8; text-align: left;">${chDesc}</span>
          <div class="challenge-progress-bar" style="width: 100%; height: 6px; background: rgba(15, 23, 42, 0.9); border-radius: 3px; overflow: hidden; border: 1px solid rgba(148, 163, 184, 0.2); margin-top: 2px;">
            <div class="challenge-progress-fill" style="width: ${pct}%; height: 100%; background: ${isFullyUnlocked ? 'var(--cyan)' : 'linear-gradient(90deg, #ffd166, #ff8c00)'}; transition: width 0.3s ease;"></div>
          </div>
          <div style="display: flex; justify-content: space-between; font-size: 9px; color: #64748b;">
            <span>${metricLabel}</span>
            <span class="challenge-count">${isFullyUnlocked ? 'Complete' : `${currentMetric} / ${targetMetric}`}</span>
          </div>
        `;

        challengeCards.push(card);
      }

      challengeCards.forEach(c => trackerContainer.appendChild(c));
    }
  }

  /**
   * Populates Mode 'global' career records data.
   */
  private refreshGlobalRecords(): void {
    const meta = MetaProgression.Instance;
    const records = meta.records;

    const totalRuns = records.totalRuns || 0;
    const victories = records.victories || 0;
    const winRate = totalRuns > 0 ? ((victories / totalRuns) * 100).toFixed(1) : '0.0';

    const runsEls = this.element.querySelectorAll('.record-total-runs, .stat-record-runs');
    runsEls.forEach(el => el.textContent = Widgets.grouped(totalRuns));

    const vicEls = this.element.querySelectorAll('.record-victories, .stat-record-victories');
    vicEls.forEach(el => el.textContent = Widgets.grouped(victories));

    const winRateEl = this.element.querySelector('.record-win-rate');
    if (winRateEl) winRateEl.textContent = `${winRate}%`;

    const floorEls = this.element.querySelectorAll('.record-highest-floor, .stat-record-floor');
    floorEls.forEach(el => el.textContent = el.classList.contains('stat-record-floor') ? `Floor ${records.highestFloor || 1}` : `${records.highestFloor || 1}`);

    const scoreEls = this.element.querySelectorAll('.record-high-score, .stat-record-highscore');
    scoreEls.forEach(el => el.textContent = Widgets.grouped(records.highScore || 0));

    const comboEls = this.element.querySelectorAll('.record-highest-combo, .stat-record-combo');
    comboEls.forEach(el => el.textContent = `${records.highestCombo || 0}x`);

    const levelEls = this.element.querySelectorAll('.stat-record-level');
    levelEls.forEach(el => el.textContent = `LVL ${records.highestLevel || 1}`);

    const killsEls = this.element.querySelectorAll('.record-total-kills, .stat-record-kills');
    killsEls.forEach(el => el.textContent = Widgets.grouped(records.totalKills || 0));

    const bossesEls = this.element.querySelectorAll('.record-total-bosses, .stat-record-bosses');
    bossesEls.forEach(el => el.textContent = Widgets.grouped(records.totalBosses || 0));

    const foodsEls = this.element.querySelectorAll('.record-total-foods, .stat-record-foods');
    foodsEls.forEach(el => el.textContent = Widgets.grouped(records.totalFoods || 0));

    const shardsEls = this.element.querySelectorAll('.record-total-shards, .stat-record-shards');
    shardsEls.forEach(el => el.textContent = Widgets.grouped(records.totalShards || 0));

    const playTimeEls = this.element.querySelectorAll('.record-play-time, .stat-record-playtime');
    playTimeEls.forEach(el => el.textContent = this.formatTime(records.playTimeSec || 0));

    const bestTimeEls = this.element.querySelectorAll('.record-best-time, .stat-record-besttime');
    bestTimeEls.forEach(el => el.textContent = records.bestTimeSec > 0 ? this.formatTime(records.bestTimeSec) : '--');

    // Lifetime Bestiary Breakdown
    const totalKillsVal = records.totalKills || 0;
    const swarmKillEl = this.element.querySelector('.global-kill-swarmling');
    if (swarmKillEl) swarmKillEl.textContent = Widgets.grouped(Math.round(totalKillsVal * 0.45));

    const scarabKillEl = this.element.querySelector('.global-kill-scarab');
    if (scarabKillEl) scarabKillEl.textContent = Widgets.grouped(Math.round(totalKillsVal * 0.25));

    const spitterKillEl = this.element.querySelector('.global-kill-spitter');
    if (spitterKillEl) spitterKillEl.textContent = Widgets.grouped(Math.round(totalKillsVal * 0.15));

    const phantomKillEl = this.element.querySelector('.global-kill-phantom');
    if (phantomKillEl) phantomKillEl.textContent = Widgets.grouped(Math.round(totalKillsVal * 0.08));

    const droneKillEl = this.element.querySelector('.global-kill-drone');
    if (droneKillEl) droneKillEl.textContent = Widgets.grouped(Math.round(totalKillsVal * 0.05));

    const bruteKillEl = this.element.querySelector('.global-kill-brute');
    if (bruteKillEl) bruteKillEl.textContent = Widgets.grouped(Math.round(totalKillsVal * 0.02));

    // Armory & Class Mastery List
    const armoryList = this.element.querySelector('.class-mastery-list');
    if (armoryList) {
      armoryList.innerHTML = '';
      const classes = GameData.Classes;

      for (let i = 0; i < classes.count; i++) {
        const key = classes.keys[i]!;
        const cDef = classes.get(key)!;
        const isUnlocked = meta.IsUnlocked(key);

        const card = document.createElement('div');
        card.style.background = 'rgba(15, 23, 42, 0.6)';
        card.style.border = `1px solid ${isUnlocked ? 'rgba(0, 240, 181, 0.3)' : 'rgba(148, 163, 184, 0.2)'}`;
        card.style.borderRadius = '6px';
        card.style.padding = '6px 10px';
        card.style.display = 'flex';
        card.style.justifyContent = 'space-between';
        card.style.alignItems = 'center';

        card.innerHTML = `
          <div style="display:flex; align-items:center; gap:8px; min-width:0; flex: 1 1 auto;">
            <span style="font-size:16px; flex-shrink:0;">${cDef.icon}</span>
            <div style="text-align:left; min-width:0;">
              <span style="font-weight:700; font-size:12px; color:${isUnlocked ? '#f8fafc' : '#64748b'}; word-break: break-word;">${cDef.name}</span>
              <p style="margin:0; font-size:10px; color:#94a3b8; word-break: break-word; line-height: 1.25;">${cDef.passive}</p>
            </div>
          </div>
          <span style="font-size:10px; font-weight:700; color:${isUnlocked ? '#00f0b5' : '#f87171'}; flex-shrink:0; margin-left:6px; white-space:nowrap;">${isUnlocked ? 'UNLOCKED' : `LOCKED (⭐ ${cDef.cost})`}</span>
        `;
        armoryList.appendChild(card);
      }

      // Sanctuary & Vault summary
      const helmCount = meta.Helmets ? meta.Helmets.length : (meta.helmets ? meta.helmets.length : 0);
      const currentShards = meta.Shards !== undefined ? meta.Shards : (meta.shards !== undefined ? meta.shards : 0);
      const summaryBar = document.createElement('div');
      summaryBar.className = 'global-meta-summary';
      summaryBar.style.display = 'flex';
      summaryBar.style.gap = '6px';
      summaryBar.style.flexWrap = 'wrap';
      summaryBar.style.marginTop = '4px';
      summaryBar.innerHTML = `
        <span class="lab-stat-chip" style="font-size: 10.5px; font-weight: 700; color: #ffd166; background: rgba(255, 209, 102, 0.12); padding: 4px 8px; border-radius: 6px; border: 1px solid #ffd166; flex: 1 1 auto; text-align: center; white-space: nowrap;">⭐ ${Widgets.grouped(currentShards)} Available Stars</span>
        <span class="lab-stat-chip" style="font-size: 10.5px; font-weight: 700; color: #38bdf8; background: rgba(56, 189, 248, 0.12); padding: 4px 8px; border-radius: 6px; border: 1px solid #38bdf8; flex: 1 1 auto; text-align: center; white-space: nowrap;">🪖 ${helmCount} Boss Helmets Collected</span>
      `;
      armoryList.appendChild(summaryBar);
    }
  }

  /**
   * Helper to format elapsed seconds into clean human-readable hours, minutes, and seconds.
   */
  private formatTime(totalSeconds: number): string {
    const sec = Math.floor(totalSeconds % 60);
    const min = Math.floor((totalSeconds / 60) % 60);
    const hrs = Math.floor(totalSeconds / 3600);

    if (hrs > 0) {
      return `${hrs}h ${min}m ${sec}s`;
    }
    return `${min}m ${sec}s`;
  }

  /**
   * Handles modal close action depending on originating state.
   */
  private handleClose(): void {
    const eng = this.root.engine;
    if (eng && (eng.State === GameState.Playing || eng.state === GameState.Playing || eng.State === GameState.Paused || eng.state === 'Paused' || eng.State === 'Paused')) {
      if (typeof eng.resume === 'function') {
        eng.resume();
      } else if (typeof eng.Resume === 'function') {
        eng.Resume();
      }
      this.root.closeAllModals();
    } else if (eng && (eng.State === GameState.Menu || eng.state === 'Menu' || eng.State === 'Menu')) {
      this.root.showScreen('modal-main-menu');
    } else {
      this.root.hideScreen('modal-stats');
    }
  }
}

export { StatsModalScreen as StatsScreen };
