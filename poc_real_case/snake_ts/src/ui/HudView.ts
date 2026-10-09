/**
 * Ouroboros Ascension — Cybernetic HUD & Touch Controls View (HudView.ts)
 *
 * Implements the comprehensive in-game HUD layer and on-screen touch gamepad controls:
 * 1. Top Header Row:
 *    - Left: Player Vitals (HP bar with layered segment health, Shield bar, In-run Ouro currency counter, Dash/Skill cooldown chips).
 *    - Center: Mission Progress (Floor title, Nourishment / Boss objective, dynamic progress bar).
 *    - Right: Action Buttons ([L] Cranial Mutation Lab, [P] Pause menu) + Combo badge, Frenzy indicator, Score & Shard counters.
 * 2. Responsive Mobile Reflow:
 *    - In mobile portrait viewports (e.g. 393x852, 360x640, isPortraitHud = true), .hud-mission reflows into a dedicated
 *      .hud-mission-portrait-row below .hud-top-row within .hud-header-group, preventing horizontal collision between vitals and top actions.
 * 3. Dedicated Touch Controls:
 *    - Virtual Joystick (.stick-pad / .touch-stick-pad): Radial drag steering with deadzone filtering.
 *    - Touch Action Buttons: Dash (.touch-btn.btn-dash) and Skill (.touch-btn.btn-skill) with independent touch boundaries and cancel safety.
 *    - Non-overlapping zones: Elevated bottom HUD row ensures hints and perks never collide with on-screen touch controls.
 *    - Lefty mode: Swaps joystick and action button docking horizontally.
 */

import { UiRoot } from './UiRoot';
import { ILayoutMetrics, ResponsiveLayout } from './ResponsiveLayout';
import { Widgets } from './Widgets';
import { MathX } from '../core/MathX';
import { Services } from '../core/Services';
import { InputManager } from '../input/InputManager';

export class HudView {
  public readonly element: HTMLElement;
  public readonly root: UiRoot;

  // DOM Elements
  private _topRow!: HTMLElement;
  private _missionRow!: HTMLElement;
  private _bottomRow!: HTMLElement;
  private _missionPanel!: HTMLElement;
  private _headerGroup!: HTMLElement;

  // Touch Controls
  private _touchLayer!: HTMLElement;
  private _stickPad!: HTMLElement;
  private _stickKnob!: HTMLElement;
  private _touchDashBtn!: HTMLElement;
  private _touchSkillBtn!: HTMLElement;
  private _touchDashSweep!: HTMLElement;
  private _touchSkillSweep!: HTMLElement;
  private _touchSkillIcon!: HTMLElement;
  private _touchSkillLabel!: HTMLElement;

  // Player Vitals
  private _lvlBadge!: HTMLElement;
  private _classTag!: HTMLElement;
  private _hpText!: HTMLElement;
  private _hpFill!: HTMLElement;
  private _shieldRow!: HTMLElement;
  private _shieldFill!: HTMLElement;
  private _xpWrap!: HTMLElement;
  private _xpBadge!: HTMLElement;
  private _xpVal!: HTMLElement;
  private _xpFill!: HTMLElement;
  private _lengthVal?: HTMLElement;
  private _dashSweep!: HTMLElement;
  private _skillSweep!: HTMLElement;
  private _skillIcon!: HTMLElement;
  private _skillName!: HTMLElement;

  // Mission Progress
  private _floorTitle!: HTMLElement;
  private _floorSub!: HTMLElement;
  private _floorFill!: HTMLElement;

  // Combo & Stats
  private _fpsTag!: HTMLElement;
  private _fpsWrap!: HTMLElement;
  private _comboWrap!: HTMLElement;
  private _comboCount!: HTMLElement;
  private _comboMult!: HTMLElement;
  private _comboTimerFill!: HTMLElement;
  private _scoreVal!: HTMLElement;
  private _shardsVal!: HTMLElement;

  // Boss
  private _bossBox!: HTMLElement;
  private _bossName!: HTMLElement;
  private _bossPhase!: HTMLElement;
  private _bossFill!: HTMLElement;
  private _bossLagFill!: HTMLElement;

  // Bottom
  private _perksList!: HTMLElement;
  private _controlsHint!: HTMLElement;
  private _steerHint!: HTMLElement;

  // State
  public showFps: boolean = true;
  private _isHpCritical: boolean = false;
  private _isFrenzy: boolean = false;
  private _currentMetrics?: ILayoutMetrics;

  // Window and Document Event Listeners
  private _boundOnMove: ((e: any) => void) | null = null;
  private _boundOnEnd: ((e?: any) => void) | null = null;
  private _boundOnBlur: (() => void) | null = null;
  private _boundOnVisibilityChange: (() => void) | null = null;
  private _boundOnKeyDown: ((e: KeyboardEvent) => void) | null = null;

  constructor(root: UiRoot) {
    this.root = root;
    if (typeof document !== 'undefined') {
      this.element = document.createElement('div');
      this.element.className = 'hud-layer';
      this.build();
    } else {
      this.element = {
        style: {},
        classList: { toggle: () => {} },
        querySelector: () => null
      } as any;
      const makeDummy = () => ({ textContent: '', style: {}, classList: { toggle: () => {} } });
      this._headerGroup = makeDummy() as any;
      this._touchLayer = makeDummy() as any;
      this._stickPad = makeDummy() as any;
      this._stickKnob = makeDummy() as any;
      this._touchDashBtn = makeDummy() as any;
      this._touchSkillBtn = makeDummy() as any;
      this._touchDashSweep = makeDummy() as any;
      this._touchSkillSweep = makeDummy() as any;
      this._touchSkillIcon = makeDummy() as any;
      this._touchSkillLabel = makeDummy() as any;
      this._topRow = makeDummy() as any;
      this._missionRow = makeDummy() as any;
      this._bottomRow = makeDummy() as any;
      this._missionPanel = makeDummy() as any;
      this._lvlBadge = makeDummy() as any;
      this._classTag = makeDummy() as any;
      this._hpText = makeDummy() as any;
      this._hpFill = makeDummy() as any;
      this._shieldRow = makeDummy() as any;
      this._shieldFill = makeDummy() as any;
      this._xpWrap = makeDummy() as any;
      this._xpBadge = makeDummy() as any;
      this._xpVal = makeDummy() as any;
      this._xpFill = makeDummy() as any;
      this._lengthVal = makeDummy() as any;
      this._dashSweep = makeDummy() as any;
      this._skillSweep = makeDummy() as any;
      this._skillIcon = makeDummy() as any;
      this._skillName = makeDummy() as any;
      this._floorTitle = makeDummy() as any;
      this._floorSub = makeDummy() as any;
      this._floorFill = makeDummy() as any;
      this._fpsTag = makeDummy() as any;
      this._fpsWrap = makeDummy() as any;
      this._comboWrap = makeDummy() as any;
      this._comboCount = makeDummy() as any;
      this._comboMult = makeDummy() as any;
      this._comboTimerFill = makeDummy() as any;
      this._scoreVal = makeDummy() as any;
      this._shardsVal = makeDummy() as any;
      this._bossBox = makeDummy() as any;
      this._bossName = makeDummy() as any;
      this._bossPhase = makeDummy() as any;
      this._bossFill = makeDummy() as any;
      this._bossLagFill = makeDummy() as any;
      this._perksList = makeDummy() as any;
      this._controlsHint = makeDummy() as any;
      this._steerHint = makeDummy() as any;
    }
  }

  public setVisible(visible: boolean): void {
    this.element.style.display = visible ? 'block' : 'none';
  }

  public setTouchControlsVisible(visible: boolean): void {
    if (this._touchLayer && this._touchLayer.style) {
      this._touchLayer.style.display = visible ? 'block' : 'none';
    }
  }

  public get touchControlsVisible(): boolean {
    return this._touchLayer && this._touchLayer.style ? this._touchLayer.style.display !== 'none' : false;
  }

  public update(frameDt?: number, engine?: any): void {
    this.refresh(engine ?? this.root?.engine);
  }

  public onResize(metrics: ILayoutMetrics): void {
    this.applyMetrics(metrics);
  }

  /**
   * Continuous accumulating in-run Ouro telemetry updater.
   * Tracks in-run Ouro currency (never drops or resets to 0 across floor/level transitions).
   *
   * @param player The active player serpent instance or state snapshot.
   */
  public tick(player: any): void {
    if (!player) return;
    const curOuro = Math.floor(player.ouro !== undefined ? player.ouro : (player.xp !== undefined ? player.xp : 0));
    this.root.hudSet('hud-ouro-val', `${curOuro}`, (v) => {
      if (this._xpVal) this._xpVal.textContent = v;
    });
    this.root.hudSet('hud-xp-val', `${curOuro}`, (v) => {
      if (this._xpVal) this._xpVal.textContent = v;
    });

    // Serpent Length Telemetry
    // Total serpent length including head is (player.segments.length + 1), exactly matching MetaProgression & StatsModalScreen.
    const curLen = ((player.segments ? player.segments.length : (player.Segments ? player.Segments.length : 0)) + 1);
    this.root.hudSet('hud-length-val', `${curLen}`, (v) => {
      if (this._lengthVal) this._lengthVal.textContent = v;
      const lenEls = this.element.querySelectorAll?.('.hud-length-val, .hud-length, .stat-length, .stat-length-val');
      if (lenEls) lenEls.forEach((el) => (el.textContent = v));
    });
    this.root.hudSet('hud-length', `${curLen}`, (v) => {
      if (this._lengthVal) this._lengthVal.textContent = v;
      const lenEls = this.element.querySelectorAll?.('.hud-length-val, .hud-length, .stat-length, .stat-length-val');
      if (lenEls) lenEls.forEach((el) => (el.textContent = v));
    });
  }

  public showBanner(_text: string, _seconds: number): void {}
  public hideBanner(): void {}
  public showToast(_message: string, _seconds: number): void {}
  public setVignette(_opacity: number): void {}
  public setBossBox(visible: boolean, _name: string | null): void {
    if (this._bossBox) this._bossBox.style.display = visible ? 'block' : 'none';
  }
  public updatePerks(): void {
    this.refresh(this.root.engine);
  }

  public setInteractive(interactive: boolean): void {
    this.element.style.pointerEvents = interactive ? 'auto' : 'none';
  }

  public handleJoystickSteer(dirX: number, dirY: number): void {
    const input = Services.Input || InputManager.instance;
    const active = Math.abs(dirX) > 0.0001 || Math.abs(dirY) > 0.0001;
    if (input) {
      if (typeof (input as any).onStickUpdate === 'function') {
        (input as any).onStickUpdate(dirX, dirY, active);
      }
      if (typeof (input as any).setSource === 'function') {
        (input as any).setSource(1, dirX, dirY, active);
      }
    }
  }

  public handleJoystickRelease(): void {
    const input = Services.Input || InputManager.instance;
    if (input) {
      if (typeof (input as any).onStickUpdate === 'function') {
        (input as any).onStickUpdate(0, 0, false);
      }
      if (typeof (input as any).setSource === 'function') {
        (input as any).setSource(1, 0, 0, false);
      }
    }
  }

  public handleTouchAction(kind: 'dash' | 'skill', active: boolean): void {
    const input = Services.Input || InputManager.instance;
    if (input && typeof (input as any).onPadTouchAction === 'function') {
      (input as any).onPadTouchAction(kind, active);
    }
  }

  private build(): void {
    this.element.innerHTML = `
      <div class="hud-container">
        <!-- Top Header Group (pins top row + portrait mission banner cleanly at the top) -->
        <div class="hud-header-group">
          <!-- Top Row -->
          <div class="hud-top-row">
            <!-- Left: Vitals -->
            <div class="hud-panel hud-vitals">
              <div class="hud-vitals-header">
                <span class="hud-class-tag">🐍 Emerald Viper</span>
                <span class="hud-hp-val">100 / 100</span>
              </div>
              <!-- Layered Health & Shield Bars -->
              <div class="hud-bar-wrap hp-bar-wrap">
                <div class="hud-bar-fill hp-bar-fill"></div>
              </div>
              <div class="hud-bar-wrap shield-bar-wrap" style="display:none;">
                <div class="hud-bar-fill shield-bar-fill"></div>
              </div>
              <!-- In-Run Ouro Currency Badge -->
              <div class="hud-ouro-counter-wrap hud-xp-counter-wrap">
                <span class="hud-ouro-badge hud-xp-badge">🪙 OURO <span class="hud-ouro-val hud-xp-val">0</span></span>
              </div>
              <div class="hud-cooldowns-grid">
                <div class="cooldown-chip dash-chip">
                  <span class="cd-icon">⚡</span>
                  <div class="cd-info">
                    <span class="cd-name">DASH</span>
                    <span class="cd-key">[SPACE]</span>
                  </div>
                  <div class="cd-sweep dash-sweep"></div>
                </div>
                <div class="cooldown-chip skill-chip">
                  <span class="cd-icon skill-icon">✴️</span>
                  <div class="cd-info">
                    <span class="cd-name skill-name">SKILL</span>
                    <span class="cd-key">[E]</span>
                  </div>
                  <div class="cd-sweep skill-sweep"></div>
                </div>
              </div>
            </div>

            <!-- Center: Mission (Landscape) -->
            <div class="hud-panel hud-mission">
              <div class="floor-title">FLOOR 1</div>
              <div class="floor-subtitle">Nourishment 0 / 15</div>
              <div class="hud-bar-wrap floor-bar-wrap">
                <div class="hud-bar-fill floor-bar-fill"></div>
              </div>
            </div>

            <!-- Right: Combo & Score -->
            <div class="hud-panel hud-combo-col">
              <div class="hud-top-actions">
                <div class="hud-fps-wrap" style="display:none;">
                  <span class="hud-fps-tag">60 FPS</span>
                  <span class="hud-bot-tag" style="display:none; color: #00f0b5; margin-left: 6px; font-weight: 700; cursor: pointer;" title="Bot AI active [B]">🤖 BOT</span>
                </div>
                <button class="hud-icon-btn btn-lab" type="button" aria-label="Mutation Lab" title="Mutation Lab [L]">🧬 <span class="btn-hotkey">[L]</span></button>
                <button class="hud-icon-btn btn-pause" type="button" aria-label="Pause Game" title="Pause [P]">⏸ <span class="btn-hotkey">[P]</span></button>
              </div>
              <div class="combo-badge-wrapper combo-tier-1">
                <div class="combo-header">
                  <span class="combo-tier-badge">🔥 COMBO</span>
                  <span class="combo-count">0x</span>
                </div>
                <div class="combo-mult">MULT: x1</div>
                <div class="combo-timer-wrap">
                  <div class="combo-timer-fill"></div>
                </div>
              </div>
              <div class="hud-score-tracker">
                <div class="score-pill">
                  <span class="pill-label">SCORE</span>
                  <span class="score-val">0</span>
                </div>
                <div class="score-pill shard-pill" title="Stars">
                  <span class="pill-label">⭐</span>
                  <span class="shards-val">0</span>
                </div>
              </div>
            </div>
          </div>

          <!-- Mission Row for Portrait / Compact HUD -->
          <div class="hud-mission-portrait-row" style="display:none;"></div>

          <!-- Boss Health Bar (Docked cleanly in top header group, out of combat arena) -->
          <div class="hud-boss-box" style="display:none;">
            <div class="boss-header">
              <span class="boss-title-wrap">
                <span class="boss-icon">💀</span>
                <span class="boss-name">CENTIPEDE BEHEMOTH</span>
              </span>
              <span class="boss-phase">PHASE 1</span>
            </div>
            <div class="boss-bar-wrap">
              <div class="boss-bar-lag"></div>
              <div class="boss-bar-fill"></div>
            </div>
          </div>
        </div>

        <!-- Spacer -->
        <div class="hud-spacer"></div>

        <!-- On-Screen Touch Controls Layer -->
        <div class="touch-controls-layer" style="display:none;">
          <div class="touch-stick-zone">
            <div class="touch-stick-pad stick-pad">
              <div class="touch-stick-dir dir-up">▲</div>
              <div class="touch-stick-dir dir-right">▶</div>
              <div class="touch-stick-dir dir-down">▼</div>
              <div class="touch-stick-dir dir-left">◀</div>
              <div class="touch-stick-center-cross"></div>
              <div class="touch-stick-knob"></div>
            </div>
          </div>

          <div class="touch-actions-zone">
            <button class="touch-action-btn touch-btn touch-btn-skill btn-skill" type="button" aria-label="Skill">
              <span class="touch-btn-icon skill-touch-icon">✨</span>
              <span class="touch-btn-label skill-touch-label">SKILL</span>
              <div class="touch-btn-cd-sweep skill-touch-cd"></div>
            </button>
            <button class="touch-action-btn touch-btn touch-btn-dash btn-dash" type="button" aria-label="Dash">
              <span class="touch-btn-icon">⚡</span>
              <span class="touch-btn-label">DASH</span>
              <div class="touch-btn-cd-sweep dash-touch-cd"></div>
            </button>
          </div>
        </div>

        <!-- Bottom Row -->
        <div class="hud-bottom-row">
          <div class="hud-perks-list"></div>
          <div class="hud-hints-col">
            <div class="hud-steer-hint" style="display:none;">DRAG JOYSTICK TO STEER • TAP BUTTONS FOR ACTIONS</div>
            <div class="hud-controls-hint">[WASD / ARROWS] Steer • [SPACE] Dash • [E] Skill • [T] Stats • [L] Lab • [P] Pause</div>
          </div>
        </div>
      </div>
    `;

    // Query elements
    this._headerGroup = this.element.querySelector('.hud-header-group')!;
    this._topRow = this.element.querySelector('.hud-top-row')!;
    this._missionRow = this.element.querySelector('.hud-mission-portrait-row')!;
    this._bottomRow = this.element.querySelector('.hud-bottom-row')!;
    this._missionPanel = this.element.querySelector('.hud-mission')!;

    this._touchLayer = this.element.querySelector('.touch-controls-layer')!;
    this._stickPad = this.element.querySelector('.touch-stick-pad, .stick-pad')!;
    this._stickKnob = this.element.querySelector('.touch-stick-knob')!;
    this._touchDashBtn = this.element.querySelector('.touch-btn-dash, .btn-dash')!;
    this._touchSkillBtn = this.element.querySelector('.touch-btn-skill, .btn-skill')!;
    this._touchDashSweep = this.element.querySelector('.dash-touch-cd')!;
    this._touchSkillSweep = this.element.querySelector('.skill-touch-cd')!;
    this._touchSkillIcon = this.element.querySelector('.skill-touch-icon')!;
    this._touchSkillLabel = this.element.querySelector('.skill-touch-label')!;

    this._lvlBadge = this.element.querySelector('.hud-lvl-badge') as HTMLElement;
    this._classTag = this.element.querySelector('.hud-class-tag')!;
    this._hpText = this.element.querySelector('.hud-hp-val')!;
    this._hpFill = this.element.querySelector('.hp-bar-fill')!;
    this._shieldRow = this.element.querySelector('.shield-bar-wrap')!;
    this._shieldFill = this.element.querySelector('.shield-bar-fill')!;
    this._xpWrap = this.element.querySelector('.hud-ouro-counter-wrap, .hud-xp-counter-wrap')!;
    this._xpBadge = this.element.querySelector('.hud-ouro-badge, .hud-xp-badge')!;
    this._xpVal = this.element.querySelector('.hud-ouro-val, .hud-xp-val')!;
    this._xpFill = this.element.querySelector('.xp-bar-fill') as HTMLElement;
    this._lengthVal = (this.element.querySelector('.hud-length-val, .hud-length, .stat-length-val, .stat-length') as HTMLElement) || undefined;
    this._dashSweep = this.element.querySelector('.dash-sweep')!;
    this._skillSweep = this.element.querySelector('.skill-sweep')!;
    this._skillIcon = this.element.querySelector('.skill-icon')!;
    this._skillName = this.element.querySelector('.skill-name')!;

    this._floorTitle = this.element.querySelector('.floor-title')!;
    this._floorSub = this.element.querySelector('.floor-subtitle')!;
    this._floorFill = this.element.querySelector('.floor-bar-fill')!;

    this._fpsTag = this.element.querySelector('.hud-fps-tag')!;
    this._fpsWrap = this.element.querySelector('.hud-fps-wrap')!;
    this._comboWrap = this.element.querySelector('.combo-badge-wrapper')!;
    this._comboCount = this.element.querySelector('.combo-count')!;
    this._comboMult = this.element.querySelector('.combo-mult')!;
    this._comboTimerFill = this.element.querySelector('.combo-timer-fill')!;
    this._scoreVal = this.element.querySelector('.score-val')!;
    this._shardsVal = this.element.querySelector('.shards-val')!;

    this._bossBox = this.element.querySelector('.hud-boss-box')!;
    this._bossName = this.element.querySelector('.boss-name')!;
    this._bossPhase = this.element.querySelector('.boss-phase')!;
    this._bossFill = this.element.querySelector('.boss-bar-fill')!;
    this._bossLagFill = this.element.querySelector('.boss-bar-lag')!;

    this._perksList = this.element.querySelector('.hud-perks-list')!;
    this._controlsHint = this.element.querySelector('.hud-controls-hint')!;
    this._steerHint = this.element.querySelector('.hud-steer-hint')!;

    // Primary Header Action Buttons: 🧬 Mutation Lab [L] and ⏸️ Pause Menu [P]
    const botTag = this.element.querySelector('.hud-bot-tag') as HTMLElement;
    if (botTag) {
      botTag.addEventListener('click', (e) => {
        if (e && e.stopPropagation) e.stopPropagation();
        Services.Sound.playUi();
        if (this.root.engine && typeof this.root.engine.toggleBot === 'function') {
          this.root.engine.toggleBot();
        }
      });
    }

    const labBtn = this.element.querySelector('.btn-lab') as HTMLButtonElement;
    if (labBtn) {
      labBtn.addEventListener('click', (e) => {
        if (e && e.stopPropagation) e.stopPropagation();
        Services.Sound.playUi();
        if (this.root.engine && typeof this.root.engine.toggleLab === 'function') {
          this.root.engine.toggleLab();
        }
        this.root.showScreen('modal-snake-lab', { tab: 'lab' });
      });
      labBtn.addEventListener('pointerdown', (e) => {
        if (e && e.stopPropagation) e.stopPropagation();
      });
      labBtn.addEventListener('touchstart', (e) => {
        if (e && e.stopPropagation) e.stopPropagation();
      });
    }

    const pauseBtn = this.element.querySelector('.btn-pause') as HTMLButtonElement;
    if (pauseBtn) {
      pauseBtn.addEventListener('click', (e) => {
        if (e && e.stopPropagation) e.stopPropagation();
        Services.Sound.playUi();
        if (this.root.engine && typeof this.root.engine.togglePause === 'function') {
          this.root.engine.togglePause();
        } else {
          this.root.showScreen('modal-pause');
        }
      });
      pauseBtn.addEventListener('pointerdown', (e) => {
        if (e && e.stopPropagation) e.stopPropagation();
      });
      pauseBtn.addEventListener('touchstart', (e) => {
        if (e && e.stopPropagation) e.stopPropagation();
      });
    }

    // Dynamic Full-Screen Steering Touch System
    if (this._touchLayer && this._stickPad && this._stickKnob) {
      let isDragging = false;
      let activePointerId: number | null = null;
      let originX = 0;
      let originY = 0;
      const maxRadius = 45;
      const deadzone = 6;

      const calcSteer = (clientX: number, clientY: number) => {
        const cx = Number.isFinite(clientX) ? clientX : originX;
        const cy = Number.isFinite(clientY) ? clientY : originY;
        const dx = cx - originX;
        const dy = cy - originY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist <= deadzone) {
          if (this._stickKnob?.style) this._stickKnob.style.transform = 'translate(0px, 0px)';
          this.handleJoystickSteer(0, 0);
          return;
        }
        const clampedDist = Math.min(dist, maxRadius);
        const mag = (clampedDist - deadzone) / (maxRadius - deadzone);
        const nx = (dx / dist) * mag;
        const ny = (dy / dist) * mag;

        if (this._stickKnob?.style) {
          this._stickKnob.style.transform = `translate(${nx * maxRadius}px, ${ny * maxRadius}px)`;
        }
        this.handleJoystickSteer(nx, ny);
      };

      const extractPointer = (e: any): { id: number; x: number; y: number } => {
        const id = e.pointerId !== undefined ? e.pointerId : (e.touches && e.touches[0] ? e.touches[0].identifier : 0);
        let x = e.clientX !== undefined && Number.isFinite(e.clientX) ? e.clientX : 0;
        let y = e.clientY !== undefined && Number.isFinite(e.clientY) ? e.clientY : 0;
        if (e.clientX === undefined && e.touches && e.touches[0]) {
          x = Number.isFinite(e.touches[0].clientX) ? e.touches[0].clientX : 0;
          y = Number.isFinite(e.touches[0].clientY) ? e.touches[0].clientY : 0;
        }
        return { id, x, y };
      };

      const onStart = (e: any) => {
        // Ignore if touching an action button or header panel
        if (e.target && (e.target.closest?.('.touch-actions-zone') || e.target.closest?.('.touch-btn') || e.target.closest?.('.hud-panel') || e.target.closest?.('button') || e.target.closest?.('.hud-top-actions'))) {
          return;
        }
        const pt = extractPointer(e);
        // If already dragging with another touch/pointer, ignore secondary touch
        if (isDragging && activePointerId !== null) {
          return;
        }

        isDragging = true;
        activePointerId = pt.id;
        originX = pt.x;
        originY = pt.y;

        if (e.target && typeof e.target.setPointerCapture === 'function' && e.pointerId !== undefined) {
          try { e.target.setPointerCapture(e.pointerId); } catch {}
        }

        if (this._stickPad?.style) {
          this._stickPad.style.display = 'flex';
          this._stickPad.classList.add('stick-active');
        }
        calcSteer(originX, originY);
      };

      const onMove = (e: any) => {
        if (!isDragging) return;
        const pt = extractPointer(e);
        if (activePointerId !== null && pt.id !== activePointerId) return;
        calcSteer(pt.x, pt.y);
      };

      const onEnd = (e?: any) => {
        if (!isDragging) return;
        if (e && activePointerId !== null) {
          const ptId = e.pointerId !== undefined ? e.pointerId : (e.changedTouches && e.changedTouches[0] ? e.changedTouches[0].identifier : activePointerId);
          if (ptId !== activePointerId) return;
        }

        isDragging = false;
        activePointerId = null;
        if (this._stickKnob?.style) {
          this._stickKnob.style.transform = 'translate(0px, 0px)';
        }
        if (this._stickPad?.style) {
          this._stickPad.classList.remove('stick-active');
        }
        this.handleJoystickRelease();
      };

      this._touchLayer.addEventListener('pointerdown', onStart);
      this._touchLayer.addEventListener('touchstart', onStart);
      this._touchLayer.addEventListener('lostpointercapture', onEnd);
      this._stickPad.addEventListener('pointerdown', onStart);
      this._stickPad.addEventListener('touchstart', onStart);
      this._stickPad.addEventListener('lostpointercapture', onEnd);

      this._boundOnMove = onMove;
      this._boundOnEnd = onEnd;
      this._boundOnBlur = () => {
        onEnd();
        this.handleTouchAction('dash', false);
        this.handleTouchAction('skill', false);
      };
      this._boundOnVisibilityChange = () => {
        if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
          onEnd();
          this.handleTouchAction('dash', false);
          this.handleTouchAction('skill', false);
        }
      };

      if (typeof window !== 'undefined') {
        window.addEventListener('pointermove', this._boundOnMove);
        window.addEventListener('pointerup', this._boundOnEnd);
        window.addEventListener('pointercancel', this._boundOnEnd);
        window.addEventListener('touchmove', this._boundOnMove);
        window.addEventListener('touchend', this._boundOnEnd);
        window.addEventListener('touchcancel', this._boundOnEnd);
        window.addEventListener('blur', this._boundOnBlur);
        if (typeof document !== 'undefined') {
          document.addEventListener('visibilitychange', this._boundOnVisibilityChange);
        }
      }
    }

    // Touch Action Buttons (Dash and Skill)
    if (this._touchDashBtn) {
      this._touchDashBtn.addEventListener('pointerdown', (e: any) => {
        if (e && e.stopPropagation) e.stopPropagation();
        if (e && e.preventDefault) e.preventDefault();
        this.handleTouchAction('dash', true);
      });
      this._touchDashBtn.addEventListener('pointerup', (e: any) => {
        if (e && e.stopPropagation) e.stopPropagation();
        if (e && e.preventDefault) e.preventDefault();
        this.handleTouchAction('dash', false);
      });
      this._touchDashBtn.addEventListener('pointercancel', (e: any) => {
        if (e && e.stopPropagation) e.stopPropagation();
        if (e && e.preventDefault) e.preventDefault();
        this.handleTouchAction('dash', false);
      });
      this._touchDashBtn.addEventListener('touchstart', (e: any) => {
        if (e && e.stopPropagation) e.stopPropagation();
        this.handleTouchAction('dash', true);
      });
      this._touchDashBtn.addEventListener('touchend', (e: any) => {
        if (e && e.stopPropagation) e.stopPropagation();
        this.handleTouchAction('dash', false);
      });
      this._touchDashBtn.addEventListener('touchcancel', (e: any) => {
        if (e && e.stopPropagation) e.stopPropagation();
        this.handleTouchAction('dash', false);
      });
    }

    if (this._touchSkillBtn) {
      this._touchSkillBtn.addEventListener('pointerdown', (e: any) => {
        if (e && e.stopPropagation) e.stopPropagation();
        if (e && e.preventDefault) e.preventDefault();
        this.handleTouchAction('skill', true);
      });
      this._touchSkillBtn.addEventListener('pointerup', (e: any) => {
        if (e && e.stopPropagation) e.stopPropagation();
        if (e && e.preventDefault) e.preventDefault();
        this.handleTouchAction('skill', false);
      });
      this._touchSkillBtn.addEventListener('pointercancel', (e: any) => {
        if (e && e.stopPropagation) e.stopPropagation();
        if (e && e.preventDefault) e.preventDefault();
        this.handleTouchAction('skill', false);
      });
      this._touchSkillBtn.addEventListener('touchstart', (e: any) => {
        if (e && e.stopPropagation) e.stopPropagation();
        this.handleTouchAction('skill', true);
      });
      this._touchSkillBtn.addEventListener('touchend', (e: any) => {
        if (e && e.stopPropagation) e.stopPropagation();
        this.handleTouchAction('skill', false);
      });
      this._touchSkillBtn.addEventListener('touchcancel', (e: any) => {
        if (e && e.stopPropagation) e.stopPropagation();
        this.handleTouchAction('skill', false);
      });
    }

    // Global HUD Hotkeys (KeyL for Mutation Lab, KeyT for Telemetry / Challenges)
    this._boundOnKeyDown = (e: KeyboardEvent) => {
      this.handleKeyDown(e);
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', this._boundOnKeyDown);
    }
  }

  /**
   * Completely unbinds all window and document event listeners and detaches DOM.
   * Conforms to AGENTS.md lifecycle and memory leak prevention protocols.
   */
  public destroy(): void {
    if (typeof window !== 'undefined') {
      if (this._boundOnMove) {
        window.removeEventListener('pointermove', this._boundOnMove);
        window.removeEventListener('touchmove', this._boundOnMove);
      }
      if (this._boundOnEnd) {
        window.removeEventListener('pointerup', this._boundOnEnd);
        window.removeEventListener('pointercancel', this._boundOnEnd);
        window.removeEventListener('touchend', this._boundOnEnd);
        window.removeEventListener('touchcancel', this._boundOnEnd);
      }
      if (this._boundOnBlur) {
        window.removeEventListener('blur', this._boundOnBlur);
      }
      if (this._boundOnKeyDown) {
        window.removeEventListener('keydown', this._boundOnKeyDown);
      }
    }
    if (typeof document !== 'undefined' && this._boundOnVisibilityChange) {
      document.removeEventListener('visibilitychange', this._boundOnVisibilityChange);
    }
    this._boundOnMove = null;
    this._boundOnEnd = null;
    this._boundOnBlur = null;
    this._boundOnVisibilityChange = null;
    this._boundOnKeyDown = null;

    if (this.element && this.element.parentElement) {
      this.element.parentElement.removeChild(this.element);
    }
  }

  public dispose(): void {
    this.destroy();
  }

  /**
   * Dispatches keyboard hotkeys directly from the HUD layer when active.
   * - Hotkey KeyL: opens Cranial Mutation Lab on the 'lab' tab (mutations / augments).
   * - Hotkey KeyT: opens Cranial Mutation Lab on the 'telemetry' / 'stats' tab (expedition analytics & challenges).
   * - Hotkey KeyP / Escape: toggles the Pause Menu overlay (modal-pause).
   * - Hotkey KeyH: opens the Interactive Codex Guide (modal-help).
   *
   * @param e Active KeyboardEvent instance
   * @returns True if handled, false otherwise
   */
  public handleKeyDown(e: KeyboardEvent): boolean {
    if (!this.element || (this.element.style && this.element.style.display === 'none')) {
      return false;
    }
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || (target as any).isContentEditable)) {
      return false;
    }

    // 🧬 Cranial Mutation Lab Hub [L]
    if (e.code === 'KeyL') {
      Services.Sound.playUi();
      Services.Input?.ConsumeLab?.();
      if (this.root.engine && typeof this.root.engine.toggleLab === 'function') {
        this.root.engine.toggleLab();
      }
      this.root.showScreen('modal-snake-lab', { tab: 'lab' });
      return true;
    }

    // 📊 In-Run Telemetry & Stats [T]
    if (e.code === 'KeyT') {
      Services.Sound.playUi();
      Services.Input?.ConsumeStats?.();
      this.root.showScreen('modal-snake-lab', { tab: 'telemetry' });
      return true;
    }

    // ⏸️ Pause Menu Overlay [P] / [Escape]
    if (e.code === 'KeyP' || e.code === 'Escape') {
      Services.Sound.playUi();
      Services.Input?.ConsumePause?.();
      if (this.root.engine && typeof this.root.engine.togglePause === 'function') {
        this.root.engine.togglePause();
      } else {
        this.root.showScreen('modal-pause');
      }
      return true;
    }

    // 📖 Interactive Codex Guide [H]
    if (e.code === 'KeyH') {
      Services.Sound.playUi();
      Services.Input?.ConsumeHelp?.();
      if (this.root.engine && typeof this.root.engine.showHelp === 'function') {
        this.root.engine.showHelp();
      } else {
        this.root.showScreen('modal-help');
      }
      return true;
    }

    return false;
  }

  /**
   * Applies responsive layout metrics, adjusting HUD hierarchy and touch controls.
   *
   * Mobile Portrait Reflow Architecture:
   * In narrow viewports (e.g. 360x640, 393x852, where `metrics.isPortraitHud` is true):
   * Moves `_missionPanel` out of `_topRow` into `_missionRow` directly beneath the top header.
   * This completely eliminates horizontal text clipping and overlap between player vitals (HP/Shield)
   * on the left and expedition controls/combo counter on the right.
   *
   * Touch Controls Activation & Lefty Mode:
   * Automatically displays `_touchLayer` on mobile/touch screens and applies `.lefty-mode`
   * when left-handed controls are enabled, swapping stick and action button quadrants.
   *
   * @param metrics Calculated responsive layout metrics from ResponsiveLayout
   */
  public applyMetrics(metrics: ILayoutMetrics): void {
    this._currentMetrics = metrics;
    const isPortrait = metrics.isPortraitHud;
    const mission = this._missionPanel;

    if (isPortrait && mission && this._missionRow) {
      if (mission.parentElement !== this._missionRow && typeof this._missionRow.appendChild === 'function') {
        this._missionRow.appendChild(mission);
        this._missionRow.style.display = 'flex';
      }
    } else if (mission && this._topRow) {
      if (mission.parentElement !== this._topRow && typeof this._topRow.insertBefore === 'function') {
        const comboCol = typeof this.element.querySelector === 'function' ? this.element.querySelector('.hud-combo-col') : null;
        this._topRow.insertBefore(mission, comboCol);
        if (this._missionRow?.style) this._missionRow.style.display = 'none';
      }
    }

    const isTouchActive = metrics.isTouch || metrics.isMobile || metrics.isPortraitHud || (InputManager.instance && InputManager.instance.forceTouchUi);

    // Toggle touch and tier active classes
    if (this.element.classList && typeof this.element.classList.toggle === 'function') {
      this.element.classList.toggle('tier-phone', metrics.deviceTier === 'phone');
      this.element.classList.toggle('tier-tablet', metrics.deviceTier === 'tablet');
      this.element.classList.toggle('tier-desktop', metrics.deviceTier === 'desktop');
      this.element.classList.toggle('touch-active', isTouchActive);
      this.element.classList.toggle('short-landscape', metrics.aspectMode === 'short-landscape');
      this.element.classList.toggle('super-ultrawide', metrics.aspectMode === 'super-ultrawide');
    }

    if (this._touchLayer) {
      if (this._touchLayer.style) {
        this._touchLayer.style.display = isTouchActive ? 'block' : 'none';
      }
      if (this._touchLayer.classList && typeof this._touchLayer.classList.toggle === 'function') {
        const isLefty = InputManager.instance ? InputManager.instance.isLefty : false;
        this._touchLayer.classList.toggle('lefty-mode', isLefty);
      }
    }

    if (this._controlsHint?.style) {
      this._controlsHint.style.display = isTouchActive ? 'none' : 'block';
    }
    if (this._steerHint?.style) {
      this._steerHint.style.display = isTouchActive ? 'block' : 'none';
    }
  }

  public refresh(engine: any): void {
    if (!engine) return;
    const player = engine.player;
    if (!player) return;
    const combat = engine.combat;

    // Vitals with Head & Body parts breakdown
    const headHp = player.headHp !== undefined ? player.headHp : (player.HeadHp !== undefined ? player.HeadHp : 50);
    const headMaxHp = player.headMaxHp !== undefined ? player.headMaxHp : (player.HeadMaxHp !== undefined ? player.HeadMaxHp : 50);
    let bodyHp = 0;
    let bodyMaxHp = 0;
    if (player.segments) {
      for (let i = 0; i < player.segments.length; i++) {
        const seg = player.segments[i]!;
        bodyHp += seg.hp !== undefined ? seg.hp : (seg.Hp !== undefined ? seg.Hp : 25);
        bodyMaxHp += seg.maxHp !== undefined ? seg.maxHp : (seg.MaxHp !== undefined ? seg.MaxHp : 25);
      }
    }
    const maxHp = Math.max(1, (player.stats && player.stats.maxHp) || player.maxHp || (headMaxHp + bodyMaxHp));
    const curHp = player.hp !== undefined ? player.hp : (headHp + bodyHp);
    const hpPct = MathX.clamp01(curHp / maxHp);
    this.root.hudWidth('hud-hp-fill', hpPct, (w) => {
      if (this._hpFill?.style) this._hpFill.style.width = `${w * 100}%`;
    });
    const isPhone = (this._currentMetrics ? this._currentMetrics.deviceTier : ResponsiveLayout.instance?.metrics?.deviceTier) === 'phone';
    const hpString = isPhone
      ? `${Math.ceil(curHp)} / ${Math.round(maxHp)}`
      : `${Math.ceil(curHp)} / ${Math.round(maxHp)} (👑 Head: ${Math.ceil(headHp)}/${headMaxHp} • 🟢 Body: ${Math.ceil(bodyHp)}/${bodyMaxHp})`;

    this.root.hudSet(
      'hud-hp-val',
      hpString,
      (v) => {
        if (this._hpText) this._hpText.textContent = v;
      }
    );

    const isLowHp = hpPct < 0.3;
    if (isLowHp !== this._isHpCritical) {
      this._isHpCritical = isLowHp;
      this._hpFill.classList.toggle('hp-critical', isLowHp);
    }

    // Shield
    const maxShield = (player.stats && player.stats.maxShield) || player.maxShield || 0;
    if (maxShield > 0) {
      this._shieldRow.style.display = 'block';
      const curShield = player.shield || 0;
      const shieldPct = MathX.clamp01(curShield / maxShield);
      this.root.hudWidth('hud-shield-fill', shieldPct, (w) => {
        this._shieldFill.style.width = `${w * 100}%`;
      });
    } else {
      this._shieldRow.style.display = 'none';
    }

    // In-Run Ouro Currency Counter
    // Continuously accumulating in-run Ouro currency (never drops or resets on level up).
    this.tick(player);

    // Level & Pending Level-Up Animation Pulse
    // When pendingLevelUps > 0, triggers cybernetic gold/neon pulse animation on badge and Ouro wrapper
    const pendingLevelUps = (player.pendingLevelUps !== undefined ? player.pendingLevelUps : player.PendingLevelUps) || 0;
    const hasLevelUp = pendingLevelUps > 0;

    if (this._lvlBadge?.classList && typeof this._lvlBadge.classList.toggle === 'function') {
      this._lvlBadge.classList.toggle('level-up-ready', hasLevelUp);
    }
    if (this._xpWrap?.classList && typeof this._xpWrap.classList.toggle === 'function') {
      this._xpWrap.classList.toggle('level-up-ready', hasLevelUp);
    }

    const lvlText = hasLevelUp ? `LVL ${player.level || 1} ↑` : `LVL ${player.level || 1}`;
    this.root.hudSet('hud-lvl', lvlText, (v) => {
      if (this._lvlBadge) this._lvlBadge.textContent = v;
    });

    if (player.classConfig) {
      const icon = player.classConfig.icon || player.classConfig.Icon || '🐍';
      const name = player.classConfig.name || player.classConfig.Name || 'Serpent';
      this.root.hudSet(
        'hud-class',
        `${icon} ${name}`,
        (v) => (this._classTag.textContent = v)
      );
    }

    // Serpent Length Telemetry
    // Total serpent length including head is (player.segments.length + 1), exactly matching MetaProgression & StatsModalScreen.
    const curLen = ((player.segments ? player.segments.length : (player.Segments ? player.Segments.length : 0)) + 1);
    this.root.hudSet(
      'hud-length-val',
      `${curLen}`,
      (v) => {
        if (this._lengthVal) this._lengthVal.textContent = v;
        const lenEls = this.element.querySelectorAll?.('.hud-length-val, .hud-length, .stat-length, .stat-length-val');
        if (lenEls) lenEls.forEach((el) => (el.textContent = v));
      }
    );
    this.root.hudSet(
      'hud-length',
      `${curLen}`,
      (v) => {
        if (this._lengthVal) this._lengthVal.textContent = v;
        const lenEls = this.element.querySelectorAll?.('.hud-length-val, .hud-length, .stat-length, .stat-length-val');
        if (lenEls) lenEls.forEach((el) => (el.textContent = v));
      }
    );

    // Cooldowns
    const dashCooldown = Math.max(0.1, (player.stats && player.stats.dashCooldown) || 1);
    const dashTimer = player.dashCooldownTimer || 0;
    const dashPct = MathX.clamp01(1 - dashTimer / dashCooldown);
    this.root.hudWidth('hud-dash-cd', dashPct, (w) => {
      if (this._dashSweep?.style) this._dashSweep.style.width = `${w * 100}%`;
      if (this._touchDashSweep?.style) this._touchDashSweep.style.width = `${w * 100}%`;
    });

    const skillCooldown = Math.max(0.1, (player.stats && player.stats.skillCooldown) || 1);
    const skillTimer = player.skillCooldownTimer || 0;
    const skillPct = MathX.clamp01(1 - skillTimer / skillCooldown);
    this.root.hudWidth('hud-skill-cd', skillPct, (w) => {
      if (this._skillSweep?.style) this._skillSweep.style.width = `${w * 100}%`;
      if (this._touchSkillSweep?.style) this._touchSkillSweep.style.width = `${w * 100}%`;
    });

    const classSkill = player.classConfig && (player.classConfig.skill || player.classConfig.Skill);
    if (classSkill) {
      const sIcon = classSkill.icon || classSkill.Icon || '✴️';
      const sName = classSkill.name || classSkill.Name || 'SKILL';
      if (this._skillIcon) this._skillIcon.textContent = sIcon;
      if (this._skillName) this._skillName.textContent = sName.toUpperCase();
      if (this._touchSkillIcon) this._touchSkillIcon.textContent = sIcon;
      if (this._touchSkillLabel) this._touchSkillLabel.textContent = sName.toUpperCase();
    }

    // Mission
    const currentFloor = engine.currentFloor || 1;
    const isEndless = engine.gameMode === 'endless';
    this.root.hudSet(
      'hud-floor-title',
      isEndless ? `ENDLESS · FLOOR ${currentFloor}` : `FLOOR ${currentFloor}`,
      (v) => (this._floorTitle.textContent = v)
    );

    const bosses = (engine.activeBosses && engine.activeBosses.length > 0) ? engine.activeBosses : ((engine as any).ActiveBosses && (engine as any).ActiveBosses.length > 0 ? (engine as any).ActiveBosses : (engine.boss ? [engine.boss] : []));
    if (bosses.length > 0) {
      const subText = bosses.length > 1 ? `DEFEAT ${bosses.length} BOSSES` : 'DEFEAT THE BOSS';
      this.root.hudSet('hud-floor-sub', subText, (v) => (this._floorSub.textContent = v));
      this.root.hudWidth('hud-floor-fill', 1, (w) => (this._floorFill.style.width = `${w * 100}%`));
    } else {
      const foodProgress = engine.floorFoodProgress || 0;
      const foodTarget = Math.max(1, engine.foodTarget || 15);
      const foodPct = MathX.clamp01(foodProgress / foodTarget);
      this.root.hudSet(
        'hud-floor-sub',
        `Nourishment ${Math.min(foodProgress, foodTarget)} / ${foodTarget}`,
        (v) => (this._floorSub.textContent = v)
      );
      this.root.hudWidth('hud-floor-fill', foodPct, (w) => (this._floorFill.style.width = `${w * 100}%`));
    }

    // Combo & Frenzy
    if (combat) {
      this.root.hudSet('hud-combo-count', `${combat.comboCount || 0}x`, (v) => (this._comboCount.textContent = v));
      this.root.hudSet('hud-combo-mult', `MULT: x${combat.comboMultiplier || 1}`, (v) => (this._comboMult.textContent = v));

      const comboMax = Math.max(0.1, combat.comboMaxTime || 1);
      const comboTime = combat.comboTimer || 0;
      const comboPct = MathX.clamp01(comboTime / comboMax);
      this.root.hudWidth('hud-combo-time', comboPct, (w) => {
        this._comboTimerFill.style.width = `${w * 100}%`;
      });

      const isFrenzy = combat.frenzyActive || false;
      if (isFrenzy !== this._isFrenzy) {
        this._isFrenzy = isFrenzy;
        this._comboWrap.classList.toggle('combo-frenzy', isFrenzy);
      }

      this.root.hudSet('hud-score', Widgets.grouped(combat.score || 0), (v) => (this._scoreVal.textContent = v));

      const metaShards = (this.root.engine && this.root.engine.meta ? this.root.engine.meta.shards : 0) || 0;
      this.root.hudSet('hud-shards', Widgets.grouped(metaShards + (combat.shardsEarned || 0)), (v) => (this._shardsVal.textContent = v));
    }

    // Boss Bar
    if (bosses.length > 0) {
      this._bossBox.style.display = 'block';
      if (bosses.length === 1) {
        const primary = bosses[0]!;
        const php = primary.Hp ?? primary.hp;
        const pmax = primary.MaxHp ?? primary.maxHp ?? 1;
        const bossHpPct = MathX.clamp01(php / Math.max(1, pmax));
        const bName = primary.Name || primary.name || 'COLOSSAL BOSS';
        const bPhase = `PHASE ${primary.Phase ?? primary.phase ?? 1}`;
        this.root.hudSet('hud-boss-name', bName, (v) => (this._bossName.textContent = v));
        this.root.hudSet('hud-boss-phase', bPhase, (v) => (this._bossPhase.textContent = v));
        this.root.hudWidth('hud-boss-fill', bossHpPct, (w) => {
          this._bossFill.style.width = `${w * 100}%`;
        });
        this.root.hudWidth('hud-boss-lag', bossHpPct, (w) => {
          this._bossLagFill.style.width = `${w * 100}%`;
        });
      } else {
        // Multi-Boss Composite Health Bar
        let totalHp = 0;
        let totalMaxHp = 0;
        for (let i = 0; i < bosses.length; i++) {
          const b = bosses[i]!;
          totalHp += (b.Hp ?? b.hp);
          totalMaxHp += Math.max(1, (b.MaxHp ?? b.maxHp));
        }
        const bossHpPct = MathX.clamp01(totalHp / Math.max(1, totalMaxHp));
        const firstName = bosses[0]!.Name || bosses[0]!.name || 'APEX';
        const multiName = `${firstName} + ${bosses.length - 1} GUARDIANS`;
        const multiPhase = `${bosses.length} APEX HORDE`;
        this.root.hudSet('hud-boss-name', multiName, (v) => (this._bossName.textContent = v));
        this.root.hudSet('hud-boss-phase', multiPhase, (v) => (this._bossPhase.textContent = v));
        this.root.hudWidth('hud-boss-fill', bossHpPct, (w) => {
          this._bossFill.style.width = `${w * 100}%`;
        });
        this.root.hudWidth('hud-boss-lag', bossHpPct, (w) => {
          this._bossLagFill.style.width = `${w * 100}%`;
        });
      }
    } else {
      this._bossBox.style.display = 'none';
    }

    // FPS Counter & Bot Indicator
    if (this.showFps && engine.fps !== undefined) {
      this._fpsWrap.style.display = 'flex';
      this.root.hudSet('hud-fps', `${Math.round(engine.fps)} FPS`, (v) => (this._fpsTag.textContent = v));
    } else {
      this._fpsWrap.style.display = 'none';
    }

    const botTag = this.element.querySelector('.hud-bot-tag') as HTMLElement;
    if (botTag) {
      const isBot = engine.isBotEnabled || false;
      botTag.style.display = isBot ? 'inline' : 'none';
    }
  }
}
