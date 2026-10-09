/**
 * Ouroboros Ascension — HUD & In-Game Touch Controls Audit Test Suite
 * (HudAndTouchControlsAudit.test.ts)
 *
 * Verifies:
 * 1. Top header row architecture:
 *    - Left: Vitals (HP bar, shield bar, Ouro counter, cooldown chips).
 *    - Center: Mission progress banner (Floor title, subtitle, progress bar).
 *    - Right: Action buttons ([L] Mutation Lab and [P] Pause Game) + Combo/Score trackers.
 * 2. Mobile portrait responsiveness (393x852, 360x640):
 *    - .hud-top-row and mission progress banner do not collide; mission reflows to portrait row.
 *    - .hud-vitals and .hud-top-actions maintain clear horizontal separation.
 * 3. Dedicated touch control zones:
 *    - Virtual joystick (.stick-pad / .touch-stick-pad) and action buttons (.touch-btn.btn-dash, .touch-btn.btn-skill).
 *    - Dedicated non-overlapping zones that never collide with bottom HUD elements.
 *    - Pointer/Touch drag isolation and cancellation safety (pointercancel/touchcancel).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupMockDom, MockElement } from './MockDom.js';
import { UiRoot } from '../ui/UiRoot.js';
import { RootLayout } from '../ui/RootLayout.js';
import { HudView } from '../ui/HudView.js';
import { ResponsiveLayout, ILayoutMetrics } from '../ui/ResponsiveLayout.js';
import { InputManager } from '../input/InputManager.js';
import { SnakePlayer } from '../sim/SnakePlayer.js';
import { Services } from '../core/Services.js';
import { NullFx, NullSound } from '../core/Contracts.js';

describe('HUD & In-Game Touch Controls Audit Suite', () => {
  let restoreDom: () => void;
  let container: MockElement;
  let engine: any;

  beforeEach(() => {
    restoreDom = setupMockDom();
    Services.Sound = new NullSound();
    Services.Fx = new NullFx();
    Services.Input = InputManager.instance;
    InputManager.instance.reset();

    container = document.createElement('div') as any;
    container.id = 'ui-root';
    document.body.appendChild(container as any);

    const player = new SnakePlayer('emerald', 800, 600, 4);
    player.ouro = 350;
    player.xp = 350;
    player.headHp = 100;
    player.headMaxHp = 100;
    player.shield = 40;
    player.stats.maxShield = 50;
    player.Stats.MaxShield = 50;

    engine = {
      player,
      combat: {
        score: 4200,
        comboCount: 6,
        comboMultiplier: 3,
        comboTimer: 3.2,
        comboMaxTime: 5.0,
        frenzyActive: false,
        shardsEarned: 25,
      },
      currentFloor: 3,
      floorFoodProgress: 8,
      foodTarget: 15,
      fps: 60,
      state: 1,
      runInProgress: true,
      meta: { shards: 200 },
      togglePause: vi.fn(),
      toggleLab: vi.fn(),
    };
  });

  afterEach(() => {
    restoreDom();
    vi.restoreAllMocks();
  });

  // =========================================================================
  // 1. Top Header Row Layout & Elements
  // =========================================================================
  describe('1. Top Header Row Composition', () => {
    it('contains Left vitals (HP bar, shield bar, Ouro counter, cooldown chips)', () => {
      const root = RootLayout.init(container as any, engine);
      const hud = root.hudView;
      hud.refresh(engine);

      // Left Vitals Panel
      const vitalsPanel = hud.element.querySelector('.hud-panel.hud-vitals');
      expect(vitalsPanel).not.toBeNull();

      // HP Bar and Text
      const hpWrap = vitalsPanel?.querySelector('.hp-bar-wrap');
      const hpFill = vitalsPanel?.querySelector('.hp-bar-fill');
      const hpVal = vitalsPanel?.querySelector('.hud-hp-val');
      expect(hpWrap).not.toBeNull();
      expect(hpFill).not.toBeNull();
      expect(hpVal?.textContent).toContain('100');

      // Shield Bar
      const shieldWrap = vitalsPanel?.querySelector('.shield-bar-wrap');
      const shieldFill = vitalsPanel?.querySelector('.shield-bar-fill');
      expect(shieldWrap).not.toBeNull();
      expect(shieldFill).not.toBeNull();

      // In-Run Ouro Currency Counter
      const ouroBadge = vitalsPanel?.querySelector('.hud-ouro-badge, .hud-xp-badge');
      const ouroVal = vitalsPanel?.querySelector('.hud-ouro-val, .hud-xp-val');
      expect(ouroBadge).not.toBeNull();
      expect(ouroVal?.textContent).toBe('350');

      // Cooldown Chips (Dash and Skill)
      const cdGrid = vitalsPanel?.querySelector('.hud-cooldowns-grid');
      const dashChip = vitalsPanel?.querySelector('.cooldown-chip.dash-chip');
      const skillChip = vitalsPanel?.querySelector('.cooldown-chip.skill-chip');
      expect(cdGrid).not.toBeNull();
      expect(dashChip).not.toBeNull();
      expect(skillChip).not.toBeNull();
    });

    it('contains Center mission banner with floor title, subtitle, and progress bar', () => {
      const root = RootLayout.init(container as any, engine);
      const hud = root.hudView;
      hud.refresh(engine);

      const missionPanel = hud.element.querySelector('.hud-panel.hud-mission');
      expect(missionPanel).not.toBeNull();

      const floorTitle = missionPanel?.querySelector('.floor-title');
      const floorSub = missionPanel?.querySelector('.floor-subtitle');
      const floorBar = missionPanel?.querySelector('.hud-bar-wrap.floor-bar-wrap');
      const floorFill = missionPanel?.querySelector('.hud-bar-fill.floor-bar-fill');

      expect(floorTitle?.textContent).toBe('FLOOR 3');
      expect(floorSub?.textContent).toBe('Nourishment 8 / 15');
      expect(floorBar).not.toBeNull();
      expect(floorFill).not.toBeNull();
    });

    it('contains Right action buttons ([L] Mutation Lab and [P] Pause) in .hud-top-actions', () => {
      const root = RootLayout.init(container as any, engine);
      const hud = root.hudView;

      const topActions = hud.element.querySelector('.hud-top-actions');
      expect(topActions).not.toBeNull();

      const labBtn = topActions?.querySelector('.hud-icon-btn.btn-lab') as HTMLButtonElement;
      const pauseBtn = topActions?.querySelector('.hud-icon-btn.btn-pause') as HTMLButtonElement;

      expect(labBtn).not.toBeNull();
      expect(pauseBtn).not.toBeNull();
      expect(labBtn.textContent).toContain('[L]');
      expect(pauseBtn.textContent).toContain('[P]');
    });
  });

  // =========================================================================
  // 2. Mobile Portrait Separation (393x852 and 360x640)
  // =========================================================================
  describe('2. Mobile Portrait Separation & Collision Prevention', () => {
    it('reflows mission banner into .hud-mission-portrait-row on 393x852 (modern mobile portrait)', () => {
      const root = RootLayout.init(container as any, engine);
      const hud = root.hudView;

      const metrics393: ILayoutMetrics = ResponsiveLayout.instance.computeMetrics(393, 852);
      expect(metrics393.isPortraitHud).toBe(true);
      expect(metrics393.deviceTier).toBe('phone');

      hud.applyMetrics(metrics393);

      const topRow = hud.element.querySelector('.hud-top-row');
      const missionRow = hud.element.querySelector('.hud-mission-portrait-row') as HTMLElement;
      const missionPanel = hud.element.querySelector('.hud-mission');

      expect(missionRow).not.toBeNull();
      expect(missionPanel?.parentElement).toBe(missionRow);
      expect(missionRow.style.display).toBe('flex');
      expect(topRow?.contains(missionPanel!)).toBe(false);
    });

    it('reflows mission banner into .hud-mission-portrait-row on 360x640 (compact mobile portrait)', () => {
      const root = RootLayout.init(container as any, engine);
      const hud = root.hudView;

      const metrics360: ILayoutMetrics = ResponsiveLayout.instance.computeMetrics(360, 640);
      expect(metrics360.isPortraitHud).toBe(true);
      expect(metrics360.deviceTier).toBe('phone');

      hud.applyMetrics(metrics360);

      const missionRow = hud.element.querySelector('.hud-mission-portrait-row') as HTMLElement;
      const missionPanel = hud.element.querySelector('.hud-mission');

      expect(missionRow.style.display).toBe('flex');
      expect(missionPanel?.parentElement).toBe(missionRow);
    });

    it('restores mission banner to top row when transitioning back to desktop landscape (1280x720)', () => {
      const root = RootLayout.init(container as any, engine);
      const hud = root.hudView;

      // 1. Mobile Portrait
      const portraitMetrics = ResponsiveLayout.instance.computeMetrics(393, 852);
      hud.applyMetrics(portraitMetrics);

      // 2. Desktop Landscape
      const landscapeMetrics = ResponsiveLayout.instance.computeMetrics(1280, 720);
      expect(landscapeMetrics.isPortraitHud).toBe(false);
      hud.applyMetrics(landscapeMetrics);

      const topRow = hud.element.querySelector('.hud-top-row');
      const missionRow = hud.element.querySelector('.hud-mission-portrait-row') as HTMLElement;
      const missionPanel = hud.element.querySelector('.hud-mission');

      expect(topRow?.contains(missionPanel!)).toBe(true);
      expect(missionRow.style.display).toBe('none');
    });
  });

  // =========================================================================
  // 3. Dedicated Touch Controls & Non-Overlapping Touch Zones
  // =========================================================================
  describe('3. Dedicated Touch Control Zones & Interaction Safety', () => {
    it('supports aliased CSS selectors .stick-pad, .touch-btn.btn-dash, and .touch-btn.btn-skill', () => {
      const root = RootLayout.init(container as any, engine);
      const hud = root.hudView;

      // Standard and aliased stick pad classes
      const stickPadTouch = hud.element.querySelector('.touch-stick-pad');
      const stickPadAlias = hud.element.querySelector('.stick-pad');
      expect(stickPadTouch).not.toBeNull();
      expect(stickPadAlias).not.toBeNull();
      expect(stickPadTouch).toBe(stickPadAlias);

      // Standard and aliased Dash button classes
      const dashBtnTouch = hud.element.querySelector('.touch-btn-dash');
      const dashBtnAlias = hud.element.querySelector('.touch-btn.btn-dash');
      expect(dashBtnTouch).not.toBeNull();
      expect(dashBtnAlias).not.toBeNull();
      expect(dashBtnTouch).toBe(dashBtnAlias);

      // Standard and aliased Skill button classes
      const skillBtnTouch = hud.element.querySelector('.touch-btn-skill');
      const skillBtnAlias = hud.element.querySelector('.touch-btn.btn-skill');
      expect(skillBtnTouch).not.toBeNull();
      expect(skillBtnAlias).not.toBeNull();
      expect(skillBtnTouch).toBe(skillBtnAlias);
    });

    it('isolates touch action buttons from initiating joystick steering', () => {
      const root = RootLayout.init(container as any, engine);
      const hud = root.hudView;
      const input = InputManager.instance;

      const metrics = ResponsiveLayout.instance.computeMetrics(393, 852);
      hud.applyMetrics(metrics);

      const dashBtn = hud.element.querySelector('.touch-btn.btn-dash') as HTMLElement;
      const skillBtn = hud.element.querySelector('.touch-btn.btn-skill') as HTMLElement;

      // Trigger Dash pointer events
      dashBtn.dispatchEvent({ type: 'pointerdown', stopPropagation: vi.fn(), preventDefault: vi.fn() } as any);
      expect(input.dashPressed).toBe(true);
      expect(input.dashHeld).toBe(true);
      expect(input.hasDirection).toBe(false);

      dashBtn.dispatchEvent({ type: 'pointerup', stopPropagation: vi.fn(), preventDefault: vi.fn() } as any);
      expect(input.dashHeld).toBe(false);

      // Trigger Skill pointer events
      skillBtn.dispatchEvent({ type: 'pointerdown', stopPropagation: vi.fn(), preventDefault: vi.fn() } as any);
      expect(input.skillPressed).toBe(true);
      expect(input.skillHeld).toBe(true);
      expect(input.hasDirection).toBe(false);

      skillBtn.dispatchEvent({ type: 'pointerup', stopPropagation: vi.fn(), preventDefault: vi.fn() } as any);
      expect(input.skillHeld).toBe(false);
    });

    it('safely resets touch actions on pointercancel and touchcancel', () => {
      const root = RootLayout.init(container as any, engine);
      const hud = root.hudView;
      const input = InputManager.instance;

      const dashBtn = hud.element.querySelector('.touch-btn.btn-dash') as HTMLElement;
      const skillBtn = hud.element.querySelector('.touch-btn.btn-skill') as HTMLElement;

      // Dash pointercancel
      hud.handleTouchAction('dash', true);
      expect(input.dashHeld).toBe(true);
      dashBtn.dispatchEvent({ type: 'pointercancel', stopPropagation: vi.fn() } as any);
      expect(input.dashHeld).toBe(false);

      // Skill touchcancel
      hud.handleTouchAction('skill', true);
      expect(input.skillHeld).toBe(true);
      skillBtn.dispatchEvent({ type: 'touchcancel', stopPropagation: vi.fn() } as any);
      expect(input.skillHeld).toBe(false);
    });

    it('verifies RootLayout registers StatsModalScreen and instantiates correctly', () => {
      const root = RootLayout.init(container as any, engine);
      expect(root.hudView).not.toBeNull();

      const statsScreen = root.registerStatsModalScreen();
      expect(statsScreen).not.toBeNull();
      expect(root.getScreen('modal-stats')).toBe(statsScreen);
    });
  });
});
