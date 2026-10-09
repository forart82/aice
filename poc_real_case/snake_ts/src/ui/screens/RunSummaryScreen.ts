/**
 * Ouroboros Ascension — Polymorphic Run Summary Screen (RunSummaryScreen.ts)
 *
 * Consolidates run conclusion workflows (Defeat dissolution, Floor Clear descent,
 * and Cosmic Ascension victory) into a single polymorphic modal interface.
 *
 * Modes Supported:
 * - 'defeat': Serpent dissolution under severe strain; offers Retry ("Rise Again"), Sanctuary, and Menu.
 * - 'floor_clear': Biome cleansed; displays floor rewards and offers Next Floor descent.
 * - 'victory': All floor apexes conquered; displays full run victory telemetry and ascension options.
 *
 * Backwards Compatibility:
 * Retains all legacy CSS selectors (.defeat-title, .victory-floor-num, .end-floor-val, .end-score-val,
 * .btn-retry, .btn-next-floor, etc.) allowing seamless non-breaking integration with existing tests.
 */

import { BaseModalScreen } from '../BaseModalScreen';
import { UiRoot } from '../UiRoot';
import { Widgets } from '../Widgets';
import { Services } from '../../core/Services';
import { GameState } from '../../sim/GameState';

export type RunSummaryMode = 'defeat' | 'floor_clear' | 'victory';

export interface IRunSummaryPayload {
  mode?: RunSummaryMode;
  victory?: boolean;
  floor?: number;
  score?: number;
  combo?: number;
  shards?: number;
  kills?: number;
}

export class RunSummaryScreen extends BaseModalScreen {
  public readonly id: string;
  private _mode: RunSummaryMode = 'defeat';
  private _defaultMode?: RunSummaryMode;

  // DOM Containers
  private _panel!: HTMLElement;
  private _titleEl!: HTMLElement;
  private _subtitleEl!: HTMLElement;
  private _statsContainer!: HTMLElement;
  private _actionsContainer!: HTMLElement;

  /**
   * Constructs the RunSummaryScreen.
   * @param root The parent UiRoot instance.
   * @param id Screen ID (defaults to 'modal-summary').
   * @param defaultMode Optional fixed default mode (used when subclassing GameOverScreen or FloorClearScreen).
   */
  constructor(root: UiRoot, id: string = 'modal-summary', defaultMode?: RunSummaryMode) {
    super(root, 'run-summary-modal');
    this.id = id;
    this._defaultMode = defaultMode;
    if (defaultMode) {
      this._mode = defaultMode;
    }
    this.build();
  }

  public get currentMode(): RunSummaryMode {
    return this._mode;
  }

  /**
   * Builds the initial modal structure.
   */
  protected build(): void {
    this.element.innerHTML = '';

    this._panel = Widgets.createGlassPanel(580, 'summary-panel');
    this._panel.style.maxHeight = 'min(94vh, 94dvh)';
    this._panel.style.width = '95vw';
    this._panel.style.display = 'flex';
    this._panel.style.flexDirection = 'column';
    this._panel.style.overflow = 'hidden';
    this.element.appendChild(this._panel);

    const header = document.createElement('div');
    header.className = 'modal-header';
    header.style.flexShrink = '0';

    this._titleEl = document.createElement('h2');
    this._titleEl.className = 'cyber-modal-title summary-title';
    header.appendChild(this._titleEl);

    this._subtitleEl = document.createElement('p');
    this._subtitleEl.className = 'cyber-modal-subtitle summary-subtitle';
    header.appendChild(this._subtitleEl);

    this._panel.appendChild(header);

    this._statsContainer = document.createElement('div');
    this._statsContainer.className = 'stats-wrapper';
    this._statsContainer.style.flex = '1 1 auto';
    this._statsContainer.style.minHeight = '0';
    this._statsContainer.style.overflowY = 'auto';
    this._statsContainer.style.padding = '4px';
    this._panel.appendChild(this._statsContainer);

    this._actionsContainer = Widgets.createActionsRow();
    this._actionsContainer.style.flexShrink = '0';
    this._actionsContainer.style.marginTop = 'auto';
    this._actionsContainer.style.paddingTop = '8px';
    this._actionsContainer.style.borderTop = '1px solid rgba(148, 163, 184, 0.15)';
    this._panel.appendChild(this._actionsContainer);

    this.renderModeView();
  }

  /**
   * Renders the specific layout, metrics, and buttons for the active mode.
   */
  private renderModeView(): void {
    // Clean up previous mode DOM
    this._statsContainer.innerHTML = '';
    this._actionsContainer.innerHTML = '';

    if (this._mode === 'defeat') {
      this.renderDefeatView();
    } else if (this._mode === 'floor_clear') {
      this.renderFloorClearView();
    } else {
      this.renderVictoryView();
    }
  }

  /**
   * 1. Defeat Dissolution View
   */
  private renderDefeatView(): void {
    this._panel.className = 'modal-panel defeat-panel glass-panel summary-panel';

    this._titleEl.className = 'cyber-modal-title defeat-title';
    this._titleEl.textContent = 'SERPENT DISSOLUTION';

    this._subtitleEl.className = 'cyber-modal-subtitle defeat-subtitle';
    this._subtitleEl.textContent = 'Your physical coils collapsed under heavy strain';

    const grid = document.createElement('div');
    grid.className = 'defeat-stats-grid stats-grid';
    grid.innerHTML = `
      <div class="stat-card">
        <span class="stat-label">FINAL FLOOR</span>
        <span class="stat-val end-floor-val victory-floor-num">1</span>
      </div>
      <div class="stat-card">
        <span class="stat-label">TOTAL SCORE</span>
        <span class="stat-val end-score-val score-earned-val">0</span>
      </div>
      <div class="stat-card">
        <span class="stat-label">MAX COMBO</span>
        <span class="stat-val end-combo-val combo-peak-val">0x</span>
      </div>
      <div class="stat-card">
        <span class="stat-label">STARS COLLECTED</span>
        <span class="stat-val end-shards-val shards-earned-val" style="color:#ffd166;">+0 ⭐</span>
      </div>
      <div class="stat-card">
        <span class="stat-label">TOTAL KILLS</span>
        <span class="stat-val end-kills-val kills-val">0</span>
      </div>
    `;
    this._statsContainer.appendChild(grid);

    // Actions
    const menuBtn = Widgets.createButton('Main Menu', 'ghost', () => {
      Services.Sound.playUi();
      this.root.showScreen('modal-main-menu');
    }, 'btn-menu');

    const sanctuaryBtn = Widgets.createButton('Sanctuary 🏛️', 'secondary', () => {
      Services.Sound.playUi();
      this.root.showScreen('modal-sanctuary');
    }, 'btn-sanctuary');

    const retryBtn = Widgets.createButton('Rise Again ⚡', 'primary', () => {
      Services.Sound.playUi();
      if (this.root.engine && typeof this.root.engine.restartRun === 'function') {
        this.root.engine.restartRun();
      }
      this.root.closeAllModals();
    }, 'btn-retry');

    this._actionsContainer.appendChild(menuBtn);
    this._actionsContainer.appendChild(sanctuaryBtn);
    this._actionsContainer.appendChild(retryBtn);
  }

  /**
   * 2. Floor Cleared Descent View
   */
  private renderFloorClearView(): void {
    this._panel.className = 'modal-panel victory-panel glass-panel summary-panel';

    this._titleEl.className = 'cyber-modal-title victory-title';
    this._titleEl.innerHTML = `FLOOR <span class="victory-floor-num end-floor-val">1</span> CLEARED!`;

    this._subtitleEl.className = 'cyber-modal-subtitle victory-subtitle';
    this._subtitleEl.textContent = 'The biome has been cleansed of anomalies';

    const grid = document.createElement('div');
    grid.className = 'victory-stats-grid stats-grid';
    grid.innerHTML = `
      <div class="stat-card">
        <span class="stat-label">STARS EARNED</span>
        <span class="stat-val shards-earned-val end-shards-val" style="color:#ffd166;">+0 ⭐</span>
      </div>
      <div class="stat-card">
        <span class="stat-label">CURRENT SCORE</span>
        <span class="stat-val score-earned-val end-score-val">0</span>
      </div>
      <div class="stat-card">
        <span class="stat-label">HOSTILES ELIMINATED</span>
        <span class="stat-val kills-val end-kills-val">0</span>
      </div>
      <div class="stat-card">
        <span class="stat-label">MAX COMBO</span>
        <span class="stat-val combo-peak-val end-combo-val">0x</span>
      </div>
    `;
    this._statsContainer.appendChild(grid);

    // Actions
    const nextBtn = Widgets.createButton('Descend to Next Floor ⚡', 'primary', () => {
      Services.Sound.playUi();
      if (this.root.engine && typeof this.root.engine.nextFloor === 'function') {
        this.root.engine.nextFloor();
      }
      this.root.closeAllModals();
    }, 'btn-next-floor');

    this._actionsContainer.appendChild(nextBtn);
  }

  /**
   * 3. Cosmic Ascension Victory View
   */
  private renderVictoryView(): void {
    this._panel.className = 'modal-panel victory-panel glass-panel summary-panel';

    this._titleEl.className = 'cyber-modal-title victory-title';
    this._titleEl.textContent = 'GREAT SERPENT VICTORY';

    this._subtitleEl.className = 'cyber-modal-subtitle victory-subtitle';
    this._subtitleEl.textContent = 'All floors conquered — The cosmic cycle is completed';

    const grid = document.createElement('div');
    grid.className = 'victory-stats-grid stats-grid';
    grid.innerHTML = `
      <div class="stat-card">
        <span class="stat-label">TOTAL FLOORS CLEARED</span>
        <span class="stat-val end-floor-val victory-floor-num">1</span>
      </div>
      <div class="stat-card">
        <span class="stat-label">FINAL SCORE</span>
        <span class="stat-val end-score-val score-earned-val">0</span>
      </div>
      <div class="stat-card">
        <span class="stat-label">MAX COMBO</span>
        <span class="stat-val end-combo-val combo-peak-val">0x</span>
      </div>
      <div class="stat-card">
        <span class="stat-label">STARS BANKED</span>
        <span class="stat-val end-shards-val shards-earned-val" style="color:#ffd166;">+0 ⭐</span>
      </div>
      <div class="stat-card">
        <span class="stat-label">TOTAL KILLS</span>
        <span class="stat-val end-kills-val kills-val">0</span>
      </div>
    `;
    this._statsContainer.appendChild(grid);

    // Actions
    const menuBtn = Widgets.createButton('Main Menu', 'ghost', () => {
      Services.Sound.playUi();
      this.root.showScreen('modal-main-menu');
    }, 'btn-menu');

    const sanctuaryBtn = Widgets.createButton('Sanctuary 🏛️', 'secondary', () => {
      Services.Sound.playUi();
      this.root.showScreen('modal-sanctuary');
    }, 'btn-sanctuary');

    const retryBtn = Widgets.createButton('Restart ⚡', 'primary', () => {
      Services.Sound.playUi();
      if (this.root.engine && typeof this.root.engine.restartRun === 'function') {
        this.root.engine.restartRun();
      }
      this.root.closeAllModals();
    }, 'btn-retry');

    this._actionsContainer.appendChild(menuBtn);
    this._actionsContainer.appendChild(sanctuaryBtn);
    this._actionsContainer.appendChild(retryBtn);
  }

  /**
   * Handles incoming show payload and dynamically swaps view mode if necessary.
   */
  protected onShow(payload?: any): void {
    let requestedMode: RunSummaryMode = this._defaultMode || this._mode;

    if (typeof payload === 'string') {
      requestedMode = payload as RunSummaryMode;
    } else if (payload && typeof payload === 'object') {
      if (payload.mode) {
        requestedMode = payload.mode;
      } else if (payload.victory === true) {
        requestedMode = 'victory';
      } else if (payload.victory === false) {
        requestedMode = 'defeat';
      }
    } else if (!this._defaultMode && this.root.engine) {
      if (this.root.engine.State === GameState.GameOver) {
        requestedMode = (this.root.engine as any).lastRunVictory ? 'victory' : 'defeat';
      }
    }

    if (this._mode !== requestedMode) {
      this._mode = requestedMode;
      this.renderModeView();
    }
  }

  /**
   * Populates telemetry values from GameEngine or active combat session.
   */
  protected onRefresh(): void {
    const engine = this.root.engine;
    if (!engine) return;

    const floor = engine.currentFloor || 1;
    const floorEls = this.element.querySelectorAll('.end-floor-val, .victory-floor-num');
    for (const el of floorEls) {
      el.textContent = `${floor}`;
    }

    const combat = engine.combat;
    if (combat) {
      const scoreStr = Widgets.grouped(combat.score || 0);
      const scoreEls = this.element.querySelectorAll('.end-score-val, .score-earned-val');
      for (const el of scoreEls) {
        el.textContent = scoreStr;
      }

      const comboStr = `${Widgets.plain(combat.highestCombo || 0)}x`;
      const comboEls = this.element.querySelectorAll('.end-combo-val, .combo-peak-val');
      for (const el of comboEls) {
        el.textContent = comboStr;
      }

      const shards = this._mode === 'floor_clear'
        ? (combat.floorShardsEarned !== undefined ? combat.floorShardsEarned : combat.shardsEarned || 0)
        : (combat.shardsEarned || 0);
      const shardsStr = `+${Widgets.plain(shards)} ⭐`;
      const shardsEls = this.element.querySelectorAll('.end-shards-val, .shards-earned-val');
      for (const el of shardsEls) {
        el.textContent = shardsStr;
      }

      const killsStr = Widgets.plain(combat.kills || 0);
      const killsEls = this.element.querySelectorAll('.end-kills-val, .kills-val');
      for (const el of killsEls) {
        el.textContent = killsStr;
      }
    }
  }
}
