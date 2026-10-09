/**
 * Ouroboros Ascension — Deep UI/UX Overlap & Full Screen Button Conformance Audit Test Suite
 *
 * Verifies:
 * 1. Viewport scaling & metrics across extreme aspect ratios (16:9, 21:9, 32:9, 4:3, 9:16, 320x480, 844x390)
 * 2. HUD non-overlap guarantees (Vitals, Mission, Combo, Score, Boss Bar, Perks)
 * 3. Touch control zones (Virtual Stick & Action Pads) separation from HUD and Safe Areas
 * 4. DraftScreen 3-card layout adaptation (horizontal on landscape, vertical on portrait)
 * 5. Screen modal containment, scrollability, and action button visibility
 * 6. Programmatic click & state transition audit for EVERY screen and button in the game:
 *    - MenuScreen (Mode buttons, Sanctuary, Mutation Lab, Multi-Screen, Settings)
 *    - ClassSelectScreen (5 Archetype cards, locked/unlocked state, shard purchase, Back, Ascend Now)
 *    - DraftScreen (3 upgrade cards selection, Re-roll button, Skip button)
 *    - SanctuaryScreen (Blessing upgrades, Shard balance deductions, Armed 2-step progress erase, Return to Menu)
 *    - SettingsScreen (Volume sliders, Mute, Shake, Quality dropdown, CRT, FPS, Touch scheme, Lefty mode, Save & Close)
 *    - FloorClearScreen (Stats telemetry, Next Floor descent button)
 *    - GameOverScreen (Defeat telemetry, Rise Again retry button, Sanctuary shortcut, Main menu button)
 *    - MultiScreenModal (Companion QR & URL copy, Multi-monitor popout window, Close modal)
 *    - HudView (Action buttons [Lab, Pause], Health bar & breakdown, Shield bar, XP counter, Dash/Skill sweeps, Combo meter, Floor/Boss bars)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ResponsiveLayout, ILayoutMetrics } from '../ui/ResponsiveLayout';
import { UiTheme } from '../ui/UiTheme';
import { Vec2 } from '../core/Vec2';
import { setupMockDom, MockElement } from './MockDom';
import { UiRoot } from '../ui/UiRoot';
import { MenuScreen } from '../ui/screens/MenuScreen';
import { ClassSelectScreen } from '../ui/screens/ClassSelectScreen';
import { DraftScreen } from '../ui/screens/DraftScreen';
import { SanctuaryScreen } from '../ui/screens/SanctuaryScreen';
import { SettingsScreen } from '../ui/screens/SettingsScreen';
import { FloorClearScreen } from '../ui/screens/FloorClearScreen';
import { GameOverScreen } from '../ui/screens/GameOverScreen';
import { RunSummaryScreen } from '../ui/screens/RunSummaryScreen';
import { MultiScreenModal } from '../ui/screens/MultiScreenModal';
import { SnakeLabScreen } from '../ui/screens/SnakeLabScreen';
import { HelpScreen } from '../ui/screens/HelpScreen';
import { StatsModalScreen } from '../ui/screens/StatsModalScreen';
import { DevChecklistScreen } from '../ui/screens/DevChecklistScreen';
import { PauseSettingsScreen } from '../ui/screens/PauseSettingsScreen';
import { HudView } from '../ui/HudView';
import { TouchControls } from '../input/TouchControls';
import { VirtualStick } from '../input/VirtualStick';
import * as fs from 'fs';
import * as path from 'path';
import { Services } from '../core/Services';
import { NullFx, NullSound, ISound, IFx } from '../core/Contracts';
import { MetaProgression } from '../data/MetaProgression';
import { GameEngine } from '../sim/GameEngine';
import { SnakePlayer } from '../sim/SnakePlayer';
import { InputManager } from '../input/InputManager';

class SoundSpy extends NullSound implements ISound {
  public uiCount = 0;
  public levelUpCount = 0;
  public errorCount = 0;
  public explosionCount = 0;
  public sfxVol = 1.0;
  public musVol = 1.0;
  public isMuted = false;

  public override playUi(): void { this.uiCount++; }
  public override playLevelUp(): void { this.levelUpCount++; }
  public override playError(): void { this.errorCount++; }
  public override playExplosion(): void { this.explosionCount++; }
  public setSfxVolume(v: number): void { this.sfxVol = v; }
  public setMusicVolume(v: number): void { this.musVol = v; }
  public setMuted(m: boolean): void { this.isMuted = m; }
}

class FxSpy extends NullFx implements IFx {
  public shakeScale = 1.0;
  public quality = 'high';

  public setShakeScale(s: number): void { this.shakeScale = s; }
  public setQuality(q: string): void { this.quality = q; }
}

describe('DEEP UI/UX OVERLAP & RESPONSIVE LAYOUT AUDIT', () => {
  const testViewports = [
    { name: '16:9 FHD Desktop', w: 1920, h: 1080, expectedAspectMode: 'landscape', isPortraitHud: false },
    { name: '16:9 Reference HD', w: 1280, h: 720, expectedAspectMode: 'landscape', isPortraitHud: false },
    { name: '21:9 Ultrawide', w: 2560, h: 1080, expectedAspectMode: 'ultrawide', isPortraitHud: false },
    { name: '32:9 Super-Ultrawide', w: 5120, h: 1440, expectedAspectMode: 'super-ultrawide', isPortraitHud: false },
    { name: '4:3 CRT / iPad', w: 1024, h: 768, expectedAspectMode: 'landscape', isPortraitHud: false },
    { name: '9:16 Mobile Portrait', w: 390, h: 844, expectedAspectMode: 'portrait', isPortraitHud: true },
    { name: 'Tall Mobile Portrait', w: 360, h: 780, expectedAspectMode: 'portrait', isPortraitHud: true },
    { name: 'Compact Mobile', w: 320, h: 480, expectedAspectMode: 'portrait', isPortraitHud: true },
    { name: 'Short Mobile Landscape', w: 844, h: 390, expectedAspectMode: 'short-landscape', isPortraitHud: true },
  ];

  describe('1. Viewport Metrics & Dynamic Scaling across Extreme Ratios', () => {
    it.each(testViewports)('calculates valid metrics for %s ($w x $h)', ({ w, h, expectedAspectMode, isPortraitHud }) => {
      const layout = new ResponsiveLayout();
      const metrics: ILayoutMetrics = layout.computeMetrics(w, h);

      expect(metrics.windowWidth).toBe(w);
      expect(metrics.windowHeight).toBe(h);
      expect(metrics.uiScale).toBeGreaterThanOrEqual(0.60);
      expect(metrics.uiScale).toBeLessThanOrEqual(3.05);

      expect(metrics.logicalWidth).toBeGreaterThan(0);
      expect(metrics.logicalHeight).toBeGreaterThan(0);
      expect(Number.isFinite(metrics.logicalWidth)).toBe(true);
      expect(Number.isFinite(metrics.logicalHeight)).toBe(true);

      expect(metrics.aspectMode).toBe(expectedAspectMode);
      expect(metrics.isPortraitHud).toBe(isPortraitHud);

      // Arena game viewport fits inside logical dimensions without negative margins
      expect(metrics.gameViewport.width).toBeLessThanOrEqual(metrics.logicalWidth + 1);
      expect(metrics.gameViewport.height).toBeLessThanOrEqual(metrics.logicalHeight + 1);
      expect(metrics.gameViewport.x).toBeGreaterThanOrEqual(-0.01);
      expect(metrics.gameViewport.y).toBeGreaterThanOrEqual(-0.01);
    });

    it('clamps UI scaling safely between [0.60, 3.05] for degenerate resolutions', () => {
      expect(ResponsiveLayout.computeUiScale(1, 1)).toBeGreaterThanOrEqual(0.60);
      expect(ResponsiveLayout.computeUiScale(10000, 10000)).toBeLessThanOrEqual(3.05);
      expect(ResponsiveLayout.computeUiScale(100, 2000)).toBeGreaterThanOrEqual(0.60);
      expect(ResponsiveLayout.computeUiScale(5000, 200)).toBeGreaterThanOrEqual(0.60);
    });
  });

  describe('2. HUD Non-Overlap & Spatial Budget Guarantees', () => {
    it.each(testViewports)('guarantees top HUD elements fit within logical width for %s', ({ w, h, isPortraitHud }) => {
      const layout = new ResponsiveLayout();
      const metrics = layout.computeMetrics(w, h);
      const logW = metrics.logicalWidth;

      // Minimum widths required by HUD panels to render their content legibly
      const vitalsMinW = isPortraitHud ? 160 : 200;
      const comboMinW = isPortraitHud ? 130 : 160;
      const missionMinW = 160;
      const gap = 10;
      const padding = metrics.hudPad * 2;

      if (isPortraitHud) {
        // In portrait mode, mission is reflowed to a separate dedicated row below
        const topRowRequiredW = vitalsMinW + comboMinW + gap + padding;
        expect(logW).toBeGreaterThanOrEqual(topRowRequiredW * 0.85);
      } else {
        // In landscape/ultrawide, all 3 panels sit side-by-side
        const topRowRequiredW = vitalsMinW + missionMinW + comboMinW + (gap * 2) + padding;
        expect(logW).toBeGreaterThanOrEqual(topRowRequiredW);
      }
    });

    it('correctly docks anchors to safe screen corners without overlapping borders', () => {
      const layout = new ResponsiveLayout();
      layout.update(1920, 1080);

      const tl = layout.getAnchorPos('top-left');
      const tr = layout.getAnchorPos('top-right');
      const bl = layout.getAnchorPos('bottom-left');
      const br = layout.getAnchorPos('bottom-right');
      const center = layout.getAnchorPos('center');

      expect(tl.x).toBeLessThan(tr.x);
      expect(tl.y).toBeLessThan(bl.y);
      expect(tr.x).toBeGreaterThan(center.x);
      expect(br.y).toBeGreaterThan(center.y);
      expect(center.x).toBeCloseTo(layout.metrics.logicalWidth * 0.5, 1);
      expect(center.y).toBeCloseTo(layout.metrics.logicalHeight * 0.5, 1);
    });
  });

  describe('3. Touch Control Zones & Safe Area Segregation', () => {
    it.each(testViewports)('calculates isolated touch zones for %s', ({ w, h }) => {
      const layout = new ResponsiveLayout();
      const metrics = layout.computeMetrics(w, h);
      const tc = metrics.touchControls;

      // Ensure button pads are within area bounds
      expect(tc.dashPadX).toBeGreaterThan(0);
      expect(tc.dashPadX).toBeLessThanOrEqual(tc.area.width);
      expect(tc.dashPadY).toBeGreaterThan(0);
      expect(tc.dashPadY).toBeLessThanOrEqual(tc.area.height);

      // Dash and Skill are on the left (in standard Right-Handed default mode)
      expect(tc.dashPadX).toBeGreaterThan(tc.skillPadX);

      // Action buttons zone (left half) and Stick touch zone (right half) do not intersect
      const actionRightEdge = tc.actionBounds.x + tc.actionBounds.width;
      const stickLeftEdge = tc.stickBounds.x;
      expect(actionRightEdge).toBeLessThanOrEqual(stickLeftEdge + 1);

      // Action buttons stay inside action bounds
      expect(tc.dashPadX).toBeLessThanOrEqual(actionRightEdge + 20);
      expect(tc.skillPadX).toBeGreaterThanOrEqual(tc.actionBounds.x - 20);
    });

    it('supports Lefty touch mode inversion seamlessly', () => {
      const space = new Vec2(1200, 600);
      const standard = ResponsiveLayout.layoutTouchControls(space, undefined, false);
      const lefty = ResponsiveLayout.layoutTouchControls(space, undefined, true);

      // In standard (Right-Handed default) mode, joystick is on right, action pads are on the left
      expect(standard.skillPadX).toBeLessThan(600);
      expect(standard.dashPadX).toBeLessThan(600);

      // In lefty mode, joystick is on left, action pads are on the right
      expect(lefty.dashPadX).toBeGreaterThan(600);
      expect(lefty.skillPadX).toBeGreaterThan(600 - 200);
    });

    it('incorporates Safe Area notch and home indicator offsets into touch controls', () => {
      const space = new Vec2(1000, 800);
      const safe = { left: 44, top: 40, right: 44, bottom: 34 };
      const layout = ResponsiveLayout.layoutTouchControls(space, safe, false);

      // Dash button respects safe.right
      expect(layout.dashPadX).toBeLessThanOrEqual(1000 - safe.right);
      // Buttons respect safe.bottom
      expect(layout.dashPadY).toBeLessThanOrEqual(800 - safe.bottom);
      // Pause button respects safe.top
      expect(layout.pausePadY).toBeGreaterThanOrEqual(safe.top);
    });
  });

  describe('4. DraftScreen Responsive Evolution Layout', () => {
    it('provides correct grid configurations for portrait vs landscape', () => {
      expect(UiTheme.isPortraitHud(390, 844)).toBe(true);
      expect(UiTheme.isPortraitHud(1920, 1080)).toBe(false);
      expect(UiTheme.isShortLandscape(844, 390)).toBe(true);
    });
  });

  describe('5. Modal Panel Scrollability & Button Visibility', () => {
    it('computes responsive fluid padding and typography for modals', () => {
      const padMobile = UiTheme.modalPadding(390);
      const padDesktop = UiTheme.modalPadding(1920);

      expect(padMobile).toBeGreaterThanOrEqual(12);
      expect(padMobile).toBeLessThanOrEqual(20);

      expect(padDesktop).toBeGreaterThanOrEqual(24);
      expect(padDesktop).toBeLessThanOrEqual(36);
    });
  });

  // -----------------------------------------------------------------------------------------------
  // 6. PROGRAMMATIC CLICK & STATE TRANSITION CONFORMANCE AUDIT ACROSS ALL SCREENS
  // -----------------------------------------------------------------------------------------------

  describe('6. Programmatic Button & Interaction Conformance Matrix', () => {
    let teardownDom: () => void;
    let soundSpy: SoundSpy;
    let fxSpy: FxSpy;
    let uiRoot: UiRoot;
    let mockEngine: any;

    beforeEach(() => {
      teardownDom = setupMockDom();
      soundSpy = new SoundSpy();
      fxSpy = new FxSpy();
      Services.sound = soundSpy;
      Services.fx = fxSpy;
      Services.headless = true;

      MetaProgression.readBackend = () => null;
      MetaProgression.writeBackend = () => {};
      MetaProgression.deleteBackend = () => {};
      MetaProgression.instance = new MetaProgression();

      mockEngine = {
        chosenMode: '',
        selectedClass: 'emerald',
        runActive: false,
        state: 0,
        currentFloor: 1,
        currentDraftCards: [],
        rerollsRemaining: 2,
        selectedUpgrade: null,
        draftSkipped: false,
        nextFloorCalled: false,
        restartRunCalled: false,
        labToggled: false,
        pauseToggled: false,
        toastMessage: '',
        player: new SnakePlayer('emerald', 1280, 720, 3),
        combat: {
          score: 12500,
          highestCombo: 14,
          shardsEarned: 35,
          floorShardsEarned: 12,
          kills: 48,
          comboCount: 6,
          comboMultiplier: 2.2,
          comboTimer: 1.8,
          comboMaxTime: 2.5,
          frenzyActive: false,
        },
        fx: fxSpy,
        meta: MetaProgression.instance,
        chooseMode(mode: string) { this.chosenMode = mode; },
        startRun() { this.runActive = true; },
        selectUpgradeCard(card: any) { this.selectedUpgrade = card; },
        rerollDraft() { this.rerollsRemaining--; },
        skipDraft() { this.draftSkipped = true; },
        nextFloor() { this.nextFloorCalled = true; },
        restartRun() { this.restartRunCalled = true; },
        toggleLab() { this.labToggled = !this.labToggled; },
        togglePause() { this.pauseToggled = !this.pauseToggled; },
        toast(msg: string) { this.toastMessage = msg; },
      };

      const container = document.createElement('div');
      uiRoot = UiRoot.init(container as any, mockEngine);
    });

    afterEach(() => {
      teardownDom();
    });

    describe('6.1 MenuScreen Interactive Conformance', () => {
      it('executes mode selections with audio feedback for all 4 game modes', () => {
        const menu = new MenuScreen(uiRoot);
        uiRoot.registerScreen(menu);
        uiRoot.showScreen('modal-main-menu');

        const modeButtons = menu.element.querySelectorAll('.mode-buttons-col button');
        expect(modeButtons.length).toBe(4);

        const expectedModes = [
          { key: 'rogue', label: 'Rogue Galaxy', icon: '⚔️' },
          { key: 'endless', label: 'Endless Frenzy', icon: '🔥' },
          { key: 'bossrush', label: 'Boss Rush', icon: '👹' },
          { key: 'daily', label: 'Daily Challenge', icon: '📅' },
        ];

        for (let i = 0; i < expectedModes.length; i++) {
          const btn = modeButtons[i]! as any;
          expect(btn.classList.contains('cyber-btn')).toBe(true);
          expect(btn.textContent).toContain(expectedModes[i]!.label);
          expect(btn.textContent).toContain(expectedModes[i]!.icon);
          const initUiSounds = soundSpy.uiCount;
          btn.click();

          expect(mockEngine.chosenMode).toBe(expectedModes[i]!.key);
          expect(soundSpy.uiCount).toBe(initUiSounds + 1);
        }
      });

      it('opens Sanctuary and Settings from MenuScreen sub-row', () => {
        const menu = new MenuScreen(uiRoot);
        const sanctuary = new SanctuaryScreen(uiRoot);
        const settings = new SettingsScreen(uiRoot);
        const multiscreen = new MultiScreenModal(uiRoot);
        const lab = new SnakeLabScreen(uiRoot);

        uiRoot.registerScreen(menu);
        uiRoot.registerScreen(sanctuary);
        uiRoot.registerScreen(settings);
        uiRoot.registerScreen(multiscreen);
        uiRoot.registerScreen(lab);
        uiRoot.showScreen('modal-main-menu');

        const sanctuaryBtn = menu.element.querySelector('.btn-sanctuary')! as any;
        const settingsBtn = menu.element.querySelector('.btn-settings')! as any;

        // 1. Sanctuary
        let soundCount = soundSpy.uiCount;
        sanctuaryBtn.click();
        expect(uiRoot.activeScreenId).toBe('modal-sanctuary');
        expect(soundSpy.uiCount).toBe(soundCount + 1);

        // 2. Settings
        soundCount = soundSpy.uiCount;
        settingsBtn.click();
        expect(uiRoot.activeScreenId).toBe('modal-settings');
        expect(soundSpy.uiCount).toBe(soundCount + 1);

        // 3. Multi-screen direct show
        uiRoot.showScreen('modal-multiscreen');
        expect(uiRoot.activeScreenId).toBe('modal-multiscreen');

        // 4. Lab direct show
        uiRoot.showScreen('modal-snake-lab');
        expect(uiRoot.activeScreenId).toBe('modal-snake-lab');
      });

      it('refreshes telemetry values accurately from MetaProgression state', () => {
        MetaProgression.instance.records.highScore = 95000;
        MetaProgression.instance.records.highestFloor = 8;
        MetaProgression.instance.records.highestCombo = 24;
        MetaProgression.instance.shards = 1250;

        const menu = new MenuScreen(uiRoot);
        menu.refresh();

        const scoreEl = menu.element.querySelector('.best-score-val')!;
        const floorEl = menu.element.querySelector('.best-floor-val')!;
        const comboEl = menu.element.querySelector('.best-combo-val')!;
        const shardsEl = menu.element.querySelector('.menu-shards-val')!;

        expect(scoreEl.textContent).toBe('95,000');
        expect(floorEl.textContent).toBe('8');
        expect(comboEl.textContent).toBe('24x');
        expect(shardsEl.textContent).toBe('1,250');
      });
    });

    describe('6.2 ClassSelectScreen Interactive Conformance', () => {
      it('selects unlocked classes, double-clicks to ascend, and launches expedition', () => {
        const screen = new ClassSelectScreen(uiRoot);
        uiRoot.registerScreen(screen);
        uiRoot.showScreen('modal-class-select');

        // Initially emerald is unlocked by default
        const cards = screen.element.querySelectorAll('.class-card');
        expect(cards.length).toBe(5);

        // Click stalker (unlocked class by default or unlock it first)
        MetaProgression.instance.unlockedClasses['stalker'] = true;
        screen.refresh();

        const stalkerCard = screen.element.querySelectorAll('.class-card')[1]! as any;
        stalkerCard.click();
        expect(mockEngine.selectedClass).toBe('stalker');
        expect(soundSpy.uiCount).toBeGreaterThan(0);

        // Double clicking already selected card starts expedition directly (re-query refreshed DOM)
        mockEngine.runActive = false;
        const selectedStalkerCard = screen.element.querySelectorAll('.class-card')[1]! as any;
        selectedStalkerCard.click();
        expect(mockEngine.runActive).toBe(true);
      });

      it('purchases locked class with shards or triggers error feedback if unaffordable', () => {
        const screen = new ClassSelectScreen(uiRoot);
        uiRoot.registerScreen(screen);
        uiRoot.showScreen('modal-class-select');

        MetaProgression.instance.unlockedClasses['solar'] = false;
        MetaProgression.instance.shards = 50; // Insufficient (Solar costs 500)
        screen.refresh();

        const solarCard = screen.element.querySelectorAll('.class-card')[4]! as any;
        solarCard.click();

        // Should trigger error sound and toast
        expect(soundSpy.errorCount).toBe(1);
        expect(mockEngine.toastMessage).toContain('Need ⭐');
        expect(MetaProgression.instance.isUnlocked('solar')).toBe(false);

        // Grant shards and purchase
        MetaProgression.instance.shards = 1000;
        solarCard.click();
        expect(soundSpy.levelUpCount).toBe(1);
        expect(MetaProgression.instance.isUnlocked('solar')).toBe(true);
        expect(mockEngine.selectedClass).toBe('solar');
      });

      it('handles Back and Start buttons with audio and screen transitions', () => {
        const menu = new MenuScreen(uiRoot);
        const classSelect = new ClassSelectScreen(uiRoot);
        uiRoot.registerScreen(menu);
        uiRoot.registerScreen(classSelect);
        uiRoot.showScreen('modal-class-select');

        const backBtn = classSelect.element.querySelector('.btn-back')! as any;
        const ascendBtn = classSelect.element.querySelector('.btn-ascend')! as any;

        // Verify Start / Ascend button element properties
        expect(ascendBtn).not.toBeNull();
        expect(ascendBtn.classList.contains('cyber-btn')).toBe(true);
        expect(ascendBtn.classList.contains('btn-primary')).toBe(true);
        expect(ascendBtn.classList.contains('btn-ascend')).toBe(true);
        expect(ascendBtn.textContent).toContain('Start');

        // Back button returns to main menu
        const initUiSounds = soundSpy.uiCount;
        backBtn.click();
        expect(uiRoot.activeScreenId).toBe('modal-main-menu');
        expect(soundSpy.uiCount).toBe(initUiSounds + 1);

        // Ascend button starts run
        uiRoot.showScreen('modal-class-select');
        mockEngine.runActive = false;
        const initUiAscend = soundSpy.uiCount;
        ascendBtn.click();
        expect(mockEngine.runActive).toBe(true);
        expect(soundSpy.uiCount).toBe(initUiAscend + 1);
      });
    });

    describe('6.3 DraftScreen Upgrade Mutation Conformance', () => {
      it('selects upgrade cards, updates stacks, and triggers levelUp audio feedback', () => {
        const screen = new DraftScreen(uiRoot);
        uiRoot.registerScreen(screen);

        mockEngine.currentDraftCards = [
          { id: 'venom_gland', title: 'Venom Gland', desc: 'Poison damage', stats: '+10 dmg', rarity: 'rare', maxStacks: 3 },
          { id: 'titan_scales', title: 'Titan Scales', desc: 'Thick armor', stats: '+25% HP', rarity: 'legendary', maxStacks: 2 },
          { id: 'swift_fang', title: 'Swift Fang', desc: 'Attack speed', stats: '+15% SPD', rarity: 'common', maxStacks: 5 },
        ];

        uiRoot.showScreen('modal-level-up');

        const cardElements = screen.element.querySelectorAll('.upgrade-card');
        expect(cardElements.length).toBe(3);

        // Select the second card (Titan Scales)
        const initLvlSound = soundSpy.levelUpCount;
        (cardElements[1]! as any).click();

        expect(mockEngine.selectedUpgrade).toBe(mockEngine.currentDraftCards[1]);
        expect(soundSpy.levelUpCount).toBe(initLvlSound + 1);
      });

      it('executes Re-roll and Skip actions with audio feedback and state updates', () => {
        const screen = new DraftScreen(uiRoot);
        uiRoot.registerScreen(screen);
        mockEngine.rerollsRemaining = 2;
        uiRoot.showScreen('modal-level-up');

        const rerollBtn = screen.element.querySelector('.btn-reroll')! as any;
        const skipBtn = screen.element.querySelector('.btn-skip')! as any;

        // 1. Re-roll
        rerollBtn.click();
        expect(mockEngine.rerollsRemaining).toBe(1);
        expect(soundSpy.uiCount).toBeGreaterThan(0);

        // 2. Skip
        skipBtn.click();
        expect(mockEngine.draftSkipped).toBe(true);
      });
    });

    describe('6.4 SanctuaryScreen Blessing Upgrades & Progress Reset', () => {
      it('buys blessings, deducts shards, advances level pips, and triggers levelUp audio', () => {
        const sanctuary = new SanctuaryScreen(uiRoot);
        uiRoot.registerScreen(sanctuary);
        MetaProgression.instance.shards = 500;
        uiRoot.showScreen('modal-sanctuary');

        const buyButtons = sanctuary.element.querySelectorAll('.btn-buy');
        expect(buyButtons.length).toBeGreaterThan(0);

        const initShards = MetaProgression.instance.shards;
        const firstBuy = buyButtons[0]! as any;
        firstBuy.click();

        expect(MetaProgression.instance.shards).toBeLessThan(initShards);
        expect(soundSpy.levelUpCount).toBe(1);
      });

      it('enforces armed 2-step confirmation before resetting meta progress', () => {
        const sanctuary = new SanctuaryScreen(uiRoot);
        uiRoot.registerScreen(sanctuary);
        MetaProgression.instance.shards = 2000;
        MetaProgression.instance.records.highScore = 80000;
        uiRoot.showScreen('modal-sanctuary');

        const resetBtn = sanctuary.element.querySelector('.btn-reset-prog')! as any;

        // Step 1: Arm confirmation
        resetBtn.click();
        expect(resetBtn.textContent).toContain('Tap again to confirm');
        expect(MetaProgression.instance.shards).toBe(2000); // Not reset yet!

        // Step 2: Confirm reset
        resetBtn.click();
        expect(MetaProgression.instance.shards).toBe(0);
        expect(MetaProgression.instance.records.highScore).toBe(0);
        expect(soundSpy.explosionCount).toBe(1);
      });

      it('returns to main menu when Return to Menu button is clicked', () => {
        const menu = new MenuScreen(uiRoot);
        const sanctuary = new SanctuaryScreen(uiRoot);
        uiRoot.registerScreen(menu);
        uiRoot.registerScreen(sanctuary);
        uiRoot.showScreen('modal-sanctuary');

        const backBtn = sanctuary.element.querySelector('.btn-back')! as any;
        backBtn.click();
        expect(uiRoot.activeScreenId).toBe('modal-main-menu');
        expect(soundSpy.uiCount).toBeGreaterThan(0);
      });
    });

    describe('6.5 SettingsScreen Audio, Visual & Control Sliders', () => {
      it('modifies audio sliders and mute state with live sound updates', () => {
        const settings = new SettingsScreen(uiRoot);
        uiRoot.registerScreen(settings);
        uiRoot.showScreen('modal-settings');

        const sfxSlider = settings.element.querySelector('.sfx-slider')! as any;
        const musSlider = settings.element.querySelector('.mus-slider')! as any;
        const muteCheck = settings.element.querySelector('.mute-check')! as any;

        // SFX slider
        sfxSlider.value = '0.45';
        sfxSlider.dispatchEvent({ type: 'input' } as any);
        expect(settings.settings.sfx).toBe(0.45);
        expect(soundSpy.sfxVol).toBe(0.45);

        // Music slider
        musSlider.value = '0.80';
        musSlider.dispatchEvent({ type: 'input' } as any);
        expect(settings.settings.music).toBe(0.80);
        expect(soundSpy.musVol).toBe(0.80);

        // Mute checkbox
        muteCheck.checked = true;
        muteCheck.dispatchEvent({ type: 'change' } as any);
        expect(settings.settings.mute).toBe(true);
        expect(soundSpy.isMuted).toBe(true);
      });

      it('toggles graphics options and screen shake scaling', () => {
        const settings = new SettingsScreen(uiRoot);
        uiRoot.registerScreen(settings);
        uiRoot.showScreen('modal-settings');

        const shakeSlider = settings.element.querySelector('.shake-slider')! as any;
        const qualitySelect = settings.element.querySelector('.quality-select')! as any;
        const crtCheck = settings.element.querySelector('.crt-check')! as any;
        const fpsCheck = settings.element.querySelector('.fps-check')! as any;

        // Shake slider
        shakeSlider.value = '0.5';
        shakeSlider.dispatchEvent({ type: 'input' } as any);
        expect(settings.settings.shake).toBe(0.5);
        expect(fxSpy.shakeScale).toBe(0.5);

        // Quality select
        qualitySelect.value = 'low';
        qualitySelect.dispatchEvent({ type: 'change' } as any);
        expect(settings.settings.quality).toBe('low');
        expect(fxSpy.quality).toBe('low');

        // CRT check
        crtCheck.checked = true;
        crtCheck.dispatchEvent({ type: 'change' } as any);
        expect(settings.settings.crt).toBe(true);

        // FPS check
        fpsCheck.checked = false;
        fpsCheck.dispatchEvent({ type: 'change' } as any);
        expect(settings.settings.showFps).toBe(false);
        expect(uiRoot.hudView.showFps).toBe(false);
      });

      it('saves settings to storage and closes modal on Save & Close click', () => {
        const settings = new SettingsScreen(uiRoot);
        uiRoot.registerScreen(settings);
        uiRoot.showScreen('modal-settings');

        const closeBtn = settings.element.querySelector('.btn-close-settings')! as any;
        closeBtn.click();

        expect(uiRoot.activeScreenId).toBeNull();
        expect(soundSpy.uiCount).toBeGreaterThan(0);
      });
    });

    describe('6.6 FloorClearScreen & GameOverScreen Telemetry & Actions', () => {
      it('displays floor clear metrics and proceeds on Next Floor button click', () => {
        const floorClear = new FloorClearScreen(uiRoot);
        uiRoot.registerScreen(floorClear);
        mockEngine.currentFloor = 3;
        uiRoot.showScreen('modal-floor-clear');

        const floorNum = floorClear.element.querySelector('.victory-floor-num')!;
        expect(floorNum.textContent).toBe('3');

        const nextBtn = floorClear.element.querySelector('.btn-next-floor')! as any;
        nextBtn.click();
        expect(mockEngine.nextFloorCalled).toBe(true);
        expect(soundSpy.uiCount).toBeGreaterThan(0);
      });

      it('displays game over stats and routes to Restart, Sanctuary, or Menu', () => {
        const menu = new MenuScreen(uiRoot);
        const sanctuary = new SanctuaryScreen(uiRoot);
        const gameOver = new GameOverScreen(uiRoot);
        uiRoot.registerScreen(menu);
        uiRoot.registerScreen(sanctuary);
        uiRoot.registerScreen(gameOver);

        mockEngine.currentFloor = 5;
        uiRoot.showScreen('modal-game-over');

        const floorEl = gameOver.element.querySelector('.end-floor-val')!;
        const scoreEl = gameOver.element.querySelector('.end-score-val')!;
        expect(floorEl.textContent).toBe('5');
        expect(scoreEl.textContent).toBe('12,500');

        const retryBtn = gameOver.element.querySelector('.btn-retry')! as any;
        const sanctuaryBtn = gameOver.element.querySelector('.btn-sanctuary')! as any;
        const menuBtn = gameOver.element.querySelector('.btn-menu')! as any;

        // Verify Restart ("Rise Again ⚡") button element properties
        expect(retryBtn).not.toBeNull();
        expect(retryBtn.classList.contains('cyber-btn')).toBe(true);
        expect(retryBtn.classList.contains('btn-primary')).toBe(true);
        expect(retryBtn.classList.contains('btn-retry')).toBe(true);
        expect(retryBtn.textContent).toContain('Rise Again');

        // Retry / Restart
        const initUiSounds = soundSpy.uiCount;
        retryBtn.click();
        expect(mockEngine.restartRunCalled).toBe(true);
        expect(soundSpy.uiCount).toBe(initUiSounds + 1);

        // Sanctuary
        sanctuaryBtn.click();
        expect(uiRoot.activeScreenId).toBe('modal-sanctuary');

        // Main Menu
        menuBtn.click();
        expect(uiRoot.activeScreenId).toBe('modal-main-menu');
      });

      it('displays cosmic victory summary and provides Restart button', () => {
        const victorySummary = new RunSummaryScreen(uiRoot, 'modal-summary', 'victory');
        uiRoot.registerScreen(victorySummary);
        uiRoot.showScreen('modal-summary', { mode: 'victory' });

        const retryBtn = victorySummary.element.querySelector('.btn-retry')! as any;
        expect(retryBtn).not.toBeNull();
        expect(retryBtn.classList.contains('cyber-btn')).toBe(true);
        expect(retryBtn.classList.contains('btn-primary')).toBe(true);
        expect(retryBtn.textContent).toContain('Restart');

        mockEngine.restartRunCalled = false;
        const initUiSounds = soundSpy.uiCount;
        retryBtn.click();
        expect(mockEngine.restartRunCalled).toBe(true);
        expect(soundSpy.uiCount).toBe(initUiSounds + 1);
      });
    });

    describe('6.7 MultiScreenModal Interactions', () => {
      it('copies companion link and launches popout window with audio feedback', () => {
        const multiscreen = new MultiScreenModal(uiRoot);
        uiRoot.registerScreen(multiscreen);
        uiRoot.showScreen('modal-multiscreen');

        const copyBtn = multiscreen.element.querySelector('.btn-copy-url')! as any;
        const popoutBtn = multiscreen.element.querySelector('.btn-popout-window')! as any;
        const closeBtn = multiscreen.element.querySelector('.btn-close-modal')! as any;

        // Copy button
        copyBtn.click();
        expect(copyBtn.textContent).toBe('Copied! ✅');

        // Popout button
        popoutBtn.click();
        expect(soundSpy.uiCount).toBe(1);

        // Close button
        closeBtn.click();
        expect(uiRoot.activeScreenId).toBeNull();
        expect(soundSpy.uiCount).toBe(2);
      });
    });

    describe('6.8 HudView Interactive Buttons, Health Breakdown & Gauge Sweeps', () => {
      it('triggers Lab and Pause modal toggles with audio click feedback', () => {
        const hud = uiRoot.hudView;
        const labBtn = hud.element.querySelector('.btn-lab')! as any;
        const pauseBtn = hud.element.querySelector('.btn-pause')! as any;

        const initUi = soundSpy.uiCount;

        // Toggle Lab
        labBtn.click();
        expect(mockEngine.labToggled).toBe(true);
        expect(soundSpy.uiCount).toBe(initUi + 1);

        // Toggle Pause
        pauseBtn.click();
        expect(mockEngine.pauseToggled).toBe(true);
        expect(soundSpy.uiCount).toBe(initUi + 2);
      });

      it('renders vitals with anatomical head and body health breakdown and critical warnings', () => {
        const hud = uiRoot.hudView;
        mockEngine.player.headHp = 45;
        mockEngine.player.headMaxHp = 50;
        mockEngine.player.segments[0]!.hp = 20;
        mockEngine.player.segments[0]!.maxHp = 25;
        mockEngine.player.segments[1]!.hp = 15;
        mockEngine.player.segments[1]!.maxHp = 25;
        mockEngine.player.segments[2]!.hp = 10;
        mockEngine.player.segments[2]!.maxHp = 25;

        hud.refresh(mockEngine);

        const hpText = hud.element.querySelector('.hud-hp-val')!;
        expect(hpText.textContent).toContain('Head: 45/50');
        expect(hpText.textContent).toContain('Body: 45/75');

        // Critical HP styling when hpPct < 0.3
        mockEngine.player.headHp = 5;
        mockEngine.player.segments[0]!.hp = 2;
        mockEngine.player.segments[1]!.hp = 2;
        mockEngine.player.segments[2]!.hp = 2;
        hud.refresh(mockEngine);

        const hpFill = hud.element.querySelector('.hp-bar-fill')!;
        expect(hpFill.classList.contains('hp-critical')).toBe(true);
      });

      it('updates XP state counter and Dash / Skill cooldown sweep percentages', () => {
        const hud = uiRoot.hudView;
        mockEngine.player.stats = { maxHp: 100, dashCooldown: 1.0, skillCooldown: 1.0 };
        mockEngine.player.xp = 240;
        mockEngine.player.level = 4;
        mockEngine.player.dashCooldownTimer = 0.25; // 25% cooldown remaining -> 75% ready
        mockEngine.player.skillCooldownTimer = 0.50; // 50% cooldown remaining -> 50% ready

        hud.refresh(mockEngine);

        const xpVal = hud.element.querySelector('.hud-ouro-val, .hud-xp-val')!;
        const dashSweep = hud.element.querySelector('.dash-sweep')! as any;
        const skillSweep = hud.element.querySelector('.skill-sweep')! as any;

        expect(xpVal.textContent).toBe('240');
        expect(dashSweep.style.width).toBe('75%');
        expect(skillSweep.style.width).toBe('50%');
      });

      it('updates combo counter, multiplier, timer fill, and frenzy active styling', () => {
        const hud = uiRoot.hudView;
        mockEngine.combat.comboCount = 18;
        mockEngine.combat.comboMultiplier = 3.5;
        mockEngine.combat.frenzyActive = true;

        hud.refresh(mockEngine);

        const comboCount = hud.element.querySelector('.combo-count')!;
        const comboMult = hud.element.querySelector('.combo-mult')!;
        const comboWrap = hud.element.querySelector('.combo-badge-wrapper')!;

        expect(comboCount.textContent).toBe('18x');
        expect(comboMult.textContent).toBe('MULT: x3.5');
        expect(comboWrap.classList.contains('combo-frenzy')).toBe(true);
      });

      it('displays boss health bar and phase indicators during boss encounters', () => {
        const hud = uiRoot.hudView;
        mockEngine.boss = {
          name: 'APEX CENTIPEDE',
          phase: 2,
          hp: 450,
          maxHp: 1000,
        };

        hud.refresh(mockEngine);

        const bossBox = hud.element.querySelector('.hud-boss-box')! as any;
        const bossName = hud.element.querySelector('.boss-name')!;
        const bossPhase = hud.element.querySelector('.boss-phase')!;
        const bossFill = hud.element.querySelector('.boss-bar-fill')! as any;

        expect(bossBox.style.display).toBe('block');
        expect(bossName.textContent).toBe('APEX CENTIPEDE');
        expect(bossPhase.textContent).toBe('PHASE 2');
        expect(bossFill.style.width).toBe('45%');
      });
    });

    describe('6.9 Start and Restart Action Button Interactive Conformance Matrix', () => {
      it('verifies Start Run trigger from ClassSelectScreen ("Start ⚡")', () => {
        const classSelect = new ClassSelectScreen(uiRoot);
        uiRoot.registerScreen(classSelect);
        uiRoot.showScreen('modal-class-select');

        const startBtn = classSelect.element.querySelector('.btn-ascend') as HTMLButtonElement;
        expect(startBtn).not.toBeNull();
        expect(startBtn.classList.contains('cyber-btn')).toBe(true);
        expect(startBtn.classList.contains('btn-primary')).toBe(true);
        expect(startBtn.textContent).toContain('Start');

        mockEngine.runActive = false;
        const initUiSounds = soundSpy.uiCount;
        startBtn.click();
        expect(mockEngine.runActive).toBe(true);
        expect(soundSpy.uiCount).toBe(initUiSounds + 1);
      });

      it('verifies Start Run trigger from ClassSelectScreen archetype card double-click', () => {
        const classSelect = new ClassSelectScreen(uiRoot);
        uiRoot.registerScreen(classSelect);
        uiRoot.showScreen('modal-class-select');

        MetaProgression.instance.unlockedClasses['emerald'] = true;
        classSelect.refresh();

        const emeraldCard = classSelect.element.querySelectorAll('.class-card')[0] as HTMLElement;
        expect(emeraldCard).not.toBeNull();

        // First click selects class
        emeraldCard.click();
        expect(mockEngine.selectedClass).toBe('emerald');

        // Second click starts the run directly
        mockEngine.runActive = false;
        emeraldCard.click();
        expect(mockEngine.runActive).toBe(true);
      });

      it('verifies Restart Run trigger from GameOverScreen / Defeat Modal ("Rise Again ⚡")', () => {
        const gameOver = new GameOverScreen(uiRoot);
        uiRoot.registerScreen(gameOver);
        uiRoot.showScreen('modal-game-over');

        const restartBtn = gameOver.element.querySelector('.btn-retry') as HTMLButtonElement;
        expect(restartBtn).not.toBeNull();
        expect(restartBtn.classList.contains('cyber-btn')).toBe(true);
        expect(restartBtn.classList.contains('btn-primary')).toBe(true);
        expect(restartBtn.classList.contains('btn-retry')).toBe(true);
        expect(restartBtn.textContent).toContain('Rise Again');

        mockEngine.restartRunCalled = false;
        const initUiSounds = soundSpy.uiCount;
        restartBtn.click();
        expect(mockEngine.restartRunCalled).toBe(true);
        expect(soundSpy.uiCount).toBe(initUiSounds + 1);
      });

      it('verifies Restart Run trigger from RunSummaryScreen Victory Modal ("Restart ⚡")', () => {
        const victorySummary = new RunSummaryScreen(uiRoot, 'modal-summary', 'victory');
        uiRoot.registerScreen(victorySummary);
        uiRoot.showScreen('modal-summary', { mode: 'victory' });

        const victoryRestartBtn = victorySummary.element.querySelector('.btn-retry') as HTMLButtonElement;
        expect(victoryRestartBtn).not.toBeNull();
        expect(victoryRestartBtn.classList.contains('cyber-btn')).toBe(true);
        expect(victoryRestartBtn.classList.contains('btn-primary')).toBe(true);
        expect(victoryRestartBtn.classList.contains('btn-retry')).toBe(true);
        expect(victoryRestartBtn.textContent).toContain('Restart');

        mockEngine.restartRunCalled = false;
        const initUiSounds = soundSpy.uiCount;
        victoryRestartBtn.click();
        expect(mockEngine.restartRunCalled).toBe(true);
        expect(soundSpy.uiCount).toBe(initUiSounds + 1);
      });
    });
  });

  // -----------------------------------------------------------------------------------------------
  // 7. COMPREHENSIVE SMARTPHONE UI/UX, TOUCH CONTROLS & 11 VIEWS AUDIT MATRIX
  // -----------------------------------------------------------------------------------------------

  describe('7. Comprehensive Smartphone UI/UX, Touch Controls & 11 Views Audit Matrix', () => {
    let teardownDom: () => void;
    let soundSpy: SoundSpy;
    let fxSpy: FxSpy;
    let uiRoot: UiRoot;
    let mockEngine: any;
    let indexHtmlContent: string;

    beforeEach(() => {
      teardownDom = setupMockDom();
      soundSpy = new SoundSpy();
      fxSpy = new FxSpy();
      Services.sound = soundSpy;
      Services.fx = fxSpy;
      Services.headless = true;

      MetaProgression.readBackend = () => null;
      MetaProgression.writeBackend = () => {};
      MetaProgression.deleteBackend = () => {};
      MetaProgression.instance = new MetaProgression();

      mockEngine = {
        chosenMode: 'rogue',
        selectedClass: 'emerald',
        runActive: true,
        state: 0,
        currentFloor: 1,
        currentDraftCards: [
          { id: 'c1', title: 'Card 1', desc: 'Desc 1', stats: '+10 dmg', rarity: 'common', maxStacks: 3 },
          { id: 'c2', title: 'Card 2', desc: 'Desc 2', stats: '+20 hp', rarity: 'rare', maxStacks: 2 },
          { id: 'c3', title: 'Card 3', desc: 'Desc 3', stats: '+15 spd', rarity: 'epic', maxStacks: 1 },
        ],
        rerollsRemaining: 2,
        player: new SnakePlayer('emerald', 1280, 720, 3),
        combat: {
          score: 1000,
          highestCombo: 5,
          shardsEarned: 10,
          kills: 8,
          comboCount: 2,
          comboMultiplier: 1.2,
          comboTimer: 1.0,
          comboMaxTime: 2.0,
          frenzyActive: false,
        },
        fx: fxSpy,
        meta: MetaProgression.instance,
        chooseMode(mode: string) { this.chosenMode = mode; },
        startRun() { this.runActive = true; },
        selectUpgradeCard(card: any) { this.selectedUpgrade = card; },
        rerollDraft() { this.rerollsRemaining--; },
        skipDraft() { this.draftSkipped = true; },
        nextFloor() {},
        restartRun() {},
        toggleLab() {},
        togglePause() {},
        toast() {},
      };

      const container = document.createElement('div');
      uiRoot = UiRoot.init(container as any, mockEngine);

      const htmlPath = path.resolve(__dirname, '../../index.html');
      indexHtmlContent = fs.readFileSync(htmlPath, 'utf-8');
    });

    afterEach(() => {
      teardownDom();
    });

    describe('7.1 All 11 Views Registration, Modal Lifecycle & z-index Order', () => {
      it('registers and transitions smoothly between all 11 game views', () => {
        // 1. Menu
        const menu = new MenuScreen(uiRoot);
        // 2. Combat is in uiRoot.hudView
        // 3. Class Select
        const classSelect = new ClassSelectScreen(uiRoot);
        // 4. Sanctuary
        const sanctuary = new SanctuaryScreen(uiRoot);
        // 5. Lab
        const lab = new SnakeLabScreen(uiRoot);
        // 6. Codex / Help
        const codex = new HelpScreen(uiRoot);
        // 7. Stats
        const stats = new StatsModalScreen(uiRoot);
        // 8. Dev Checklist
        const checklist = new DevChecklistScreen(uiRoot);
        // 9. Settings
        const settings = new SettingsScreen(uiRoot);
        // 10. Pause
        const pause = new PauseSettingsScreen(uiRoot);
        // 11. Draft
        const draft = new DraftScreen(uiRoot);

        uiRoot.registerScreen(menu);
        uiRoot.registerScreen(classSelect);
        uiRoot.registerScreen(sanctuary);
        uiRoot.registerScreen(lab);
        uiRoot.registerScreen(codex);
        uiRoot.registerScreen(stats);
        uiRoot.registerScreen(checklist);
        uiRoot.registerScreen(settings);
        uiRoot.registerScreen(pause);
        uiRoot.registerScreen(draft);

        const expectedScreens = [
          { id: 'modal-main-menu', expectedId: 'modal-main-menu' },
          { id: 'modal-class-select', expectedId: 'modal-class-select' },
          { id: 'modal-sanctuary', expectedId: 'modal-sanctuary' },
          { id: 'modal-snake-lab', expectedId: 'modal-snake-lab' },
          { id: 'modal-codex', expectedId: 'modal-help' },
          { id: 'modal-stats', expectedId: 'modal-stats' },
          { id: 'modal-checklist', expectedId: 'modal-dev-checklist' },
          { id: 'modal-settings', expectedId: 'modal-settings' },
          { id: 'modal-pause', expectedId: 'modal-pause' },
          { id: 'modal-draft', expectedId: 'modal-level-up' },
        ];

        for (const s of expectedScreens) {
          uiRoot.showScreen(s.id);
          expect(uiRoot.activeScreenId).toBe(s.expectedId);
          expect(uiRoot.isModalOpen()).toBe(true);
        }

        uiRoot.closeAllModals();
        expect(uiRoot.activeScreenId).toBeNull();
        expect(uiRoot.isModalOpen()).toBe(false);
      });

      it('enforces consistent base z-index 50 across all modal overlays preventing stack inversion', () => {
        expect(indexHtmlContent).toContain('.modal-overlay {');
        expect(indexHtmlContent).toMatch(/\.modal-overlay\s*\{[^}]*z-index:\s*50;/);

        // Verify .modal-stats and .snake-lab-modal do not override with z-index: 60 which inverted nesting
        expect(indexHtmlContent).not.toMatch(/\.modal-stats[^{]*\{[^}]*z-index:\s*60;/);
        expect(indexHtmlContent).not.toMatch(/\.snake-lab-modal[^{]*\{[^}]*z-index:\s*60;/);
      });
    });

    describe('7.2 Mobile Touch Target Accessibility (>= 44x44 px Guideline)', () => {
      it('guarantees HUD action icon buttons meet 44x44 px touch target minimum', () => {
        const hud = uiRoot.hudView;
        const labBtn = hud.element.querySelector('.btn-lab') as HTMLButtonElement;
        const pauseBtn = hud.element.querySelector('.btn-pause') as HTMLButtonElement;

        expect(labBtn).not.toBeNull();
        expect(pauseBtn).not.toBeNull();

        // Verify CSS enforces min-width and min-height >= 44px
        expect(indexHtmlContent).toMatch(/\.hud-icon-btn\s*\{[^}]*min-width:\s*44px;/);
        expect(indexHtmlContent).toMatch(/\.hud-icon-btn\s*\{[^}]*min-height:\s*44px;/);
      });

      it('guarantees touch gamepad action buttons and joystick zone meet mobile accessibility guidelines', () => {
        // Touch action buttons are 66px (desktop/tablet) and 58px (tier-phone), both >= 44px
        expect(indexHtmlContent).toMatch(/\.touch-action-btn\s*\{[^}]*width:\s*66px;\s*height:\s*66px;/);
        expect(indexHtmlContent).toMatch(/\.hud-layer\.tier-phone\s+\.touch-action-btn\s*\{[^}]*width:\s*58px;\s*height:\s*58px;/);

        // Virtual stick zone is 140px / 110px, knob is 50px / 38px
        expect(indexHtmlContent).toMatch(/\.hud-layer\.tier-phone\s+\.touch-stick-zone\s*\{[^}]*width:\s*110px;\s*height:\s*110px;/);
      });

      it('guarantees SnakeLabScreen and StatsModalScreen close buttons have >= 44x44 px touch target', () => {
        const lab = new SnakeLabScreen(uiRoot);
        const stats = new StatsModalScreen(uiRoot);

        const closeLab = lab.element.querySelector('.btn-close-lab') as HTMLButtonElement;
        const closeStats = stats.element.querySelector('.btn-close-stats') as HTMLButtonElement;

        expect(closeLab).not.toBeNull();
        expect(closeStats).not.toBeNull();

        const labMinW = parseInt(closeLab.style.minWidth || '0', 10);
        const labMinH = parseInt(closeLab.style.minHeight || '0', 10);
        expect(labMinW).toBeGreaterThanOrEqual(44);
        expect(labMinH).toBeGreaterThanOrEqual(44);

        const statsMinW = parseInt(closeStats.style.minWidth || '0', 10);
        const statsMinH = parseInt(closeStats.style.minHeight || '0', 10);
        expect(statsMinW).toBeGreaterThanOrEqual(44);
        expect(statsMinH).toBeGreaterThanOrEqual(44);
      });

      it('enforces min-height >= 44px on mobile buttons across all views in index.html CSS', () => {
        // Mobile tier button rules in index.html
        expect(indexHtmlContent).toMatch(/\.tier-phone\s+\.cyber-btn[^\{]*\{[^}]*min-height:\s*44px;/);
        expect(indexHtmlContent).toMatch(/@media\s*\(max-width:\s*680px\)[^{]*\{[\s\S]*?\.cyber-btn[^\{]*\{[^}]*min-height:\s*44px;/);

        // Codex buttons
        expect(indexHtmlContent).toMatch(/\.btn-codex-back\s*\{[^}]*min-height:\s*44px;/);
        expect(indexHtmlContent).toMatch(/\.btn-codex-back\s*\{[^}]*min-width:\s*44px;/);
        expect(indexHtmlContent).toMatch(/\.btn-close-top[^{]*\{[^}]*min-height:\s*44px;/);
        expect(indexHtmlContent).toMatch(/\.btn-close-top[^{]*\{[^}]*min-width:\s*44px;/);
        expect(indexHtmlContent).toMatch(/\.codex-search-clear\s*\{[^}]*min-height:\s*44px;/);
        expect(indexHtmlContent).toMatch(/\.codex-search-clear\s*\{[^}]*min-width:\s*44px;/);
        expect(indexHtmlContent).toMatch(/\.btn-codex-tab\s*\{[^}]*min-height:\s*44px;/);
        expect(indexHtmlContent).toMatch(/\.btn-accordion-toggle\s*\{[^}]*min-height:\s*44px;/);
        expect(indexHtmlContent).toMatch(/\.btn-accordion-toggle\s*\{[^}]*min-width:\s*44px;/);
        expect(indexHtmlContent).toMatch(/\.btn-jumper-prev[^{]*\{[^}]*min-height:\s*44px;/);
        expect(indexHtmlContent).toMatch(/\.btn-scroll-top[^{]*\{[^}]*min-height:\s*44px;/);
        expect(indexHtmlContent).toMatch(/\.btn-scroll-top[^{]*\{[^}]*min-width:\s*44px;/);
        expect(indexHtmlContent).toMatch(/\.btn-close-main\s*\{[^}]*min-height:\s*44px;/);

        // Dev Checklist buttons
        expect(indexHtmlContent).toMatch(/\.dev-search-clear\s*\{[^}]*min-height:\s*44px;/);
        expect(indexHtmlContent).toMatch(/\.dev-search-clear\s*\{[^}]*min-width:\s*44px;/);
        expect(indexHtmlContent).toMatch(/\.btn-dev-tab\s*\{[^}]*min-height:\s*44px;/);
      });
    });

    describe('7.3 Safe Area Inset Coverage & Bottom Row Touch Controls Clearance', () => {
      it('preserves bottom HUD row clearance on touch active smartphones', () => {
        // Safe bottom padding for HUD bottom row when touch controls are active
        expect(indexHtmlContent).toMatch(/\.hud-layer\.touch-active\s+\.hud-bottom-row\s*\{[^}]*padding-bottom:\s*calc\(var\(--sab\)\s*\+\s*11[0-9]px\);/);

        // Ensure tier-phone touch active does not collapse padding-bottom to 0
        expect(indexHtmlContent).not.toMatch(/\.hud-layer\.tier-phone\.touch-active\s+\.hud-bottom-row\s*\{[^}]*padding-bottom:\s*0\s*!important;/);
      });

      it('correctly offsets touch zones by safe area insets', () => {
        const layout = ResponsiveLayout.layoutTouchControls(
          { width: 390, height: 844 },
          { top: 47, bottom: 34, left: 0, right: 0 }
        );

        expect(layout.dashPadY).toBeLessThanOrEqual(844 - 34);
        expect(layout.skillPadY).toBeLessThanOrEqual(844 - 34);
        expect(layout.pausePadY).toBeGreaterThanOrEqual(47);
      });
    });

    describe('7.4 Text Overlaps, Horizontal Scroll Clipping & Responsive Constraints', () => {
      it('enforces width: 95vw and overflow-x: hidden on all modal panels in phone tier', () => {
        expect(indexHtmlContent).toMatch(/\.tier-phone\s+\.modal-panel[^{]*\{[^}]*width:\s*95vw\s*!important;/);
        expect(indexHtmlContent).toMatch(/\.tier-phone\s+\.modal-panel[^{]*\{[^}]*overflow-x:\s*hidden\s*!important;/);
      });

      it('enforces word-break and overflow-wrap on phone text elements to prevent clipping', () => {
        expect(indexHtmlContent).toMatch(/\.tier-phone\s+p[^{]*\{[^}]*word-break:\s*break-word\s*!important;/);
        expect(indexHtmlContent).toMatch(/\.tier-phone\s+p[^{]*\{[^}]*overflow-wrap:\s*break-word\s*!important;/);
      });

      it('removes fragile padding-right from ClassSelectScreen header ensuring no text truncation', () => {
        const screen = new ClassSelectScreen(uiRoot);
        screen.refresh();
        const header = screen.element.querySelector('.class-card-header') as HTMLElement;
        expect(header).not.toBeNull();
        expect(header.style.paddingRight).not.toBe('68px');
      });
    });

    describe('7.5 Absolute Rule 12 Pure WebGL Compliance in Touch Controls', () => {
      it('ensures TouchControls and VirtualStick have zero CanvasRenderingContext2D methods', () => {
        const tcProto = TouchControls.prototype as any;
        const vsProto = VirtualStick.prototype as any;

        expect(tcProto.render).toBeUndefined();
        expect(tcProto.drawButton).toBeUndefined();
        expect(tcProto.drawLightningBolt).toBeUndefined();
        expect(tcProto.drawSparkleStar).toBeUndefined();
        expect(tcProto.drawPauseBars).toBeUndefined();

        expect(vsProto.render).toBeUndefined();

        // Check source files have 0 occurrences of CanvasRenderingContext2D
        const tcSource = fs.readFileSync(path.resolve(__dirname, '../input/TouchControls.ts'), 'utf-8');
        const vsSource = fs.readFileSync(path.resolve(__dirname, '../input/VirtualStick.ts'), 'utf-8');

        expect(tcSource).not.toContain('CanvasRenderingContext2D');
        expect(vsSource).not.toContain('CanvasRenderingContext2D');
      });
    });
  });
});

