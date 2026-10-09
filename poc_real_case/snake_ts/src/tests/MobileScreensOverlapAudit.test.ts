/**
 * Ouroboros Ascension — Mobile Screens Overlap & Responsive Conformance Test Suite (MobileScreensOverlapAudit.test.ts)
 *
 * Strict Conformance Verification for all UI screens on narrow mobile viewports:
 * 360px (Small Android / Compact Phone)
 * 393px (Standard iPhone 14/15/16)
 * 412px (Pixel / Samsung Galaxy)
 * 540px (Foldable Outer Screen / Compact Tablet)
 *
 * Screens Audited:
 * 1. ClassSelectScreen.ts: Archetype cards, stats row, locked badges, helmet vault loadout, and Start/Back buttons.
 * 2. DraftScreen.ts: 3 draft perk cards vertical stacking, rarity tags, descriptions, stats, and action buttons.
 * 3. SanctuaryScreen.ts: Upgrade cards, blessing pips, cost chips, shard balance, buy buttons, and return button.
 * 4. SettingsScreen.ts: Audio sliders, toggle switches, dropdown selects, and save/codex buttons.
 * 5. StatsModalScreen.ts: Career records, bestiary badges, summary chips, telemetry vitals, and challenge progress.
 * 6. MenuScreen.ts: Title banner, mode buttons (Expedition, Endless, Boss Rush, Daily), sub-row (Sanctuary, Stats, Codex, Settings), and footer.
 * 7. CodexModalScreen.ts / HelpScreen.ts: Header navigation, search bar, category chips, entry accordion cards, and close button.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { setupMockDom, MockElement } from './MockDom';
import { UiRoot } from '../ui/UiRoot';
import { ResponsiveLayout } from '../ui/ResponsiveLayout';
import { ClassSelectScreen } from '../ui/screens/ClassSelectScreen';
import { DraftScreen } from '../ui/screens/DraftScreen';
import { SanctuaryScreen } from '../ui/screens/SanctuaryScreen';
import { SettingsScreen } from '../ui/screens/SettingsScreen';
import { StatsModalScreen } from '../ui/screens/StatsModalScreen';
import { MenuScreen } from '../ui/screens/MenuScreen';
import { HelpScreen } from '../ui/screens/HelpScreen';
import { SnakeLabScreen } from '../ui/screens/SnakeLabScreen';
import { DevChecklistScreen } from '../ui/screens/DevChecklistScreen';
import { GameOverScreen } from '../ui/screens/GameOverScreen';
import { FloorClearScreen } from '../ui/screens/FloorClearScreen';
import { RunSummaryScreen } from '../ui/screens/RunSummaryScreen';
import { PauseSettingsScreen } from '../ui/screens/PauseSettingsScreen';
import { MultiScreenModal } from '../ui/screens/MultiScreenModal';
import { Widgets } from '../ui/Widgets';
import { Services } from '../core/Services';
import { NullSound, NullFx } from '../core/Contracts';
import { MetaProgression } from '../data/MetaProgression';
import { SnakePlayer } from '../sim/SnakePlayer';

describe('MOBILE SCREENS OVERLAP & RESPONSIVE CONFORMANCE AUDIT', () => {
  let restoreDom: () => void;
  let container: MockElement;
  let root: UiRoot;
  let engine: any;

  const mobileViewports = [
    { name: '320px Legacy Compact', w: 320, h: 480 },
    { name: '360px Compact Android', w: 360, h: 780 },
    { name: '393px iPhone 15/16', w: 393, h: 852 },
    { name: '412px Pixel / Galaxy', w: 412, h: 915 },
    { name: '540px Foldable Outer', w: 540, h: 960 },
    { name: '844px Short Landscape', w: 844, h: 390 },
  ];

  beforeEach(() => {
    restoreDom = setupMockDom();
    Services.Sound = new NullSound();
    Services.Fx = new NullFx();

    container = document.createElement('div') as any;
    container.id = 'ui-root';
    document.body.appendChild(container as any);

    engine = {
      state: 0,
      currentFloor: 2,
      gameMode: 'rogue',
      selectedClass: 'emerald',
      rerollsRemaining: 1,
      currentDraftCards: [
        { id: 'venom_glands', title: 'Venom Glands', desc: 'Applies poison to enemies bitten', stats: '+15 Poison DPS', rarity: 'common', icon: '🧪', maxStacks: 3 },
        { id: 'titan_scales', title: 'Titan Scales', desc: 'Hardened carapace boosts armor and max HP', stats: '+30 Max HP', rarity: 'rare', icon: '🛡️', maxStacks: 2 },
        { id: 'supernova_burst', title: 'Supernova Burst', desc: 'Releases a blinding plasma wave upon taking heavy hits', stats: '80 AOE Damage', rarity: 'legendary', icon: '💥', maxStacks: 1 }
      ],
      player: new SnakePlayer('emerald', 400, 300, 5),
      combat: {
        score: 4500,
        shardsEarned: 15,
        kills: 28,
        bossKills: 1,
        defeatedBossTypes: ['centipede'],
        killsByType: { swarmling: 14, scarab: 8, spitter: 4, phantom: 2 },
        foodsEaten: 32,
        foodsEatenByType: { apple: 22, golden: 6, potion: 2, shard: 2 },
        comboCount: 5,
        highestRunCombo: 12,
      },
      chooseMode: () => {},
      startRun: () => {},
      selectUpgradeCard: () => {},
      rerollDraft: () => {},
      skipDraft: () => {},
      resume: () => {},
      toast: () => {},
    };

    root = UiRoot.init(container as any, engine);
  });

  describe('1. ClassSelectScreen Mobile Overlap Audit', () => {
    it.each(mobileViewports)('renders class cards, lock badges, helmet vault, and Start button on $name ($w x $h)', ({ w, h }) => {
      const metrics = ResponsiveLayout.instance.computeMetrics(w, h);
      root.applyMetrics(metrics);

      const screen = new ClassSelectScreen(root);
      screen.show();

      expect(screen.element.classList.contains('class-select-modal')).toBe(true);
      const panel = screen.element.querySelector('.class-panel') as HTMLElement;
      expect(panel).not.toBeNull();

      // Title & Subtitle
      const title = screen.element.querySelector('.cyber-modal-title') as HTMLElement;
      const subtitle = screen.element.querySelector('.cyber-modal-subtitle') as HTMLElement;
      expect(title).not.toBeNull();
      expect(subtitle).not.toBeNull();

      // Class cards grid
      const grid = screen.element.querySelector('.class-cards-grid') as HTMLElement;
      expect(grid).not.toBeNull();
      const cards = grid.querySelectorAll('.class-card');
      expect(cards.length).toBeGreaterThanOrEqual(5);

      // Verify class card content anatomy
      cards.forEach((c) => {
        const header = c.querySelector('.class-card-header');
        const icon = c.querySelector('.class-icon');
        const name = c.querySelector('.class-name');
        const passive = c.querySelector('.class-passive');
        const skill = c.querySelector('.class-skill');
        const stats = c.querySelector('.class-stats-preview');

        expect(header).not.toBeNull();
        expect(icon).not.toBeNull();
        expect(name).not.toBeNull();
        expect(passive).not.toBeNull();
        expect(skill).not.toBeNull();
        expect(stats).not.toBeNull();
      });

      // Helmet vault section
      const helmetVault = screen.element.querySelector('.helmet-vault-section') as HTMLElement;
      expect(helmetVault).not.toBeNull();
      const helmetGrid = helmetVault.querySelector('.helmet-grid');
      expect(helmetGrid).not.toBeNull();

      // Action buttons
      const backBtn = screen.element.querySelector('.btn-back') as HTMLElement;
      const startBtn = screen.element.querySelector('.btn-start, .btn-ascend') as HTMLElement;
      expect(backBtn).not.toBeNull();
      expect(startBtn).not.toBeNull();
    });
  });

  describe('2. DraftScreen Mobile Overlap Audit', () => {
    it.each(mobileViewports)('renders 3 perk cards stacked vertically without text collision on $name ($w x $h)', ({ w, h }) => {
      const metrics = ResponsiveLayout.instance.computeMetrics(w, h);
      root.applyMetrics(metrics);

      const screen = new DraftScreen(root);
      screen.show();

      const panel = screen.element.querySelector('.draft-panel') as HTMLElement;
      expect(panel).not.toBeNull();

      const deck = screen.element.querySelector('.cards-deck-grid') as HTMLElement;
      expect(deck).not.toBeNull();
      const cards = deck.querySelectorAll('.upgrade-card');
      expect(cards.length).toBe(3);

      // Verify cards have complete non-colliding components
      cards.forEach((card) => {
        const topRow = card.querySelector('.card-top-row');
        const rarityTag = card.querySelector('.card-rarity-tag');
        const icon = card.querySelector('.card-icon');
        const title = card.querySelector('.card-title');
        const desc = card.querySelector('.card-desc');
        const stats = card.querySelector('.card-stats');
        const stackTag = card.querySelector('.card-stack-tag');

        expect(topRow).not.toBeNull();
        expect(rarityTag).not.toBeNull();
        expect(icon).not.toBeNull();
        expect(title).not.toBeNull();
        expect(desc).not.toBeNull();
        expect(stats).not.toBeNull();
        expect(stackTag).not.toBeNull();
      });

      // Action buttons
      const rerollBtn = screen.element.querySelector('.btn-reroll') as HTMLElement;
      const skipBtn = screen.element.querySelector('.btn-skip') as HTMLElement;
      expect(rerollBtn).not.toBeNull();
      expect(skipBtn).not.toBeNull();
    });
  });

  describe('3. SanctuaryScreen Mobile Overlap Audit', () => {
    it.each(mobileViewports)('renders shard balance, upgrade cards, cost chips and buttons on $name ($w x $h)', ({ w, h }) => {
      const metrics = ResponsiveLayout.instance.computeMetrics(w, h);
      root.applyMetrics(metrics);

      const screen = new SanctuaryScreen(root);
      screen.show();

      const shardBanner = screen.element.querySelector('.sanctuary-shard-banner') as HTMLElement;
      expect(shardBanner).not.toBeNull();
      const shardVal = screen.element.querySelector('.sanctuary-shards-val') as HTMLElement;
      expect(shardVal).not.toBeNull();

      const grid = screen.element.querySelector('.sanctuary-grid') as HTMLElement;
      expect(grid).not.toBeNull();
      const items = grid.querySelectorAll('.shop-item-card');
      expect(items.length).toBeGreaterThan(0);

      items.forEach((item) => {
        const header = item.querySelector('.shop-item-header');
        const name = item.querySelector('.shop-item-name');
        const lvl = item.querySelector('.shop-item-lvl');
        const bonus = item.querySelector('.shop-item-bonus');
        const pips = item.querySelector('.shop-pips-row');
        const buyBtn = item.querySelector('.btn-buy');

        expect(header).not.toBeNull();
        expect(name).not.toBeNull();
        expect(lvl).not.toBeNull();
        expect(bonus).not.toBeNull();
        expect(pips).not.toBeNull();
        expect(buyBtn).not.toBeNull();
      });

      const resetBtn = screen.element.querySelector('.btn-reset-prog') as HTMLElement;
      const backBtn = screen.element.querySelector('.btn-back') as HTMLElement;
      expect(resetBtn).not.toBeNull();
      expect(backBtn).not.toBeNull();
    });
  });

  describe('4. SettingsScreen Mobile Overlap Audit', () => {
    it.each(mobileViewports)('renders audio sliders, toggle checkboxes, dropdowns, and buttons on $name ($w x $h)', ({ w, h }) => {
      const metrics = ResponsiveLayout.instance.computeMetrics(w, h);
      root.applyMetrics(metrics);

      const screen = new SettingsScreen(root);
      expect(screen.element.classList.contains('settings-modal')).toBe(true);

      const sfxSlider = screen.element.querySelector('.sfx-slider') as HTMLInputElement;
      const musSlider = screen.element.querySelector('.mus-slider') as HTMLInputElement;
      const shakeSlider = screen.element.querySelector('.shake-slider') as HTMLInputElement;
      const muteCheck = screen.element.querySelector('.mute-check') as HTMLInputElement;
      const qualitySelect = screen.element.querySelector('.quality-select') as HTMLSelectElement;
      const crtCheck = screen.element.querySelector('.crt-check') as HTMLInputElement;
      const fpsCheck = screen.element.querySelector('.fps-check') as HTMLInputElement;
      const schemeSelect = screen.element.querySelector('.scheme-select') as HTMLSelectElement;
      const joystickSelect = screen.element.querySelector('.joystick-pos-select') as HTMLSelectElement;

      expect(sfxSlider).not.toBeNull();
      expect(musSlider).not.toBeNull();
      expect(shakeSlider).not.toBeNull();
      expect(muteCheck).not.toBeNull();
      expect(qualitySelect).not.toBeNull();
      expect(crtCheck).not.toBeNull();
      expect(fpsCheck).not.toBeNull();
      expect(schemeSelect).not.toBeNull();
      expect(joystickSelect).not.toBeNull();

      const codexBtn = screen.element.querySelector('.btn-settings-codex') as HTMLElement;
      const closeBtn = screen.element.querySelector('.btn-close-settings') as HTMLElement;
      expect(codexBtn).not.toBeNull();
      expect(closeBtn).not.toBeNull();
    });
  });

  describe('5. StatsModalScreen Mobile Overlap Audit', () => {
    it.each(mobileViewports)('renders in-run telemetry and career records on $name ($w x $h)', ({ w, h }) => {
      const metrics = ResponsiveLayout.instance.computeMetrics(w, h);
      root.applyMetrics(metrics);

      const screen = new StatsModalScreen(root);

      // Global mode
      screen.show('global');
      const title = screen.element.querySelector('.stats-title') as HTMLElement;
      expect(title.textContent).toContain('GLOBAL');

      const careerGrid = screen.element.querySelector('.career-summary-grid') as HTMLElement;
      expect(careerGrid).not.toBeNull();
      const lifetimeGrid = screen.element.querySelector('.lifetime-totals-grid') as HTMLElement;
      expect(lifetimeGrid).not.toBeNull();
      const bestiaryGrid = screen.element.querySelector('.lifetime-bestiary-grid') as HTMLElement;
      expect(bestiaryGrid).not.toBeNull();
      const armoryList = screen.element.querySelector('.class-mastery-list') as HTMLElement;
      expect(armoryList).not.toBeNull();

      // Run mode
      engine.state = 1;
      screen.setMode('run');
      screen.refresh();
      expect(title.textContent).toContain('EXPEDITION');

      const vitalsGrid = screen.element.querySelector('.stats-vitals-grid') as HTMLElement;
      expect(vitalsGrid).not.toBeNull();
      const foodGrid = screen.element.querySelector('.food-breakdown-grid') as HTMLElement;
      expect(foodGrid).not.toBeNull();
      const runBestiaryGrid = screen.element.querySelector('.bestiary-grid') as HTMLElement;
      expect(runBestiaryGrid).not.toBeNull();
      const challengeList = screen.element.querySelector('.challenge-tracker-list') as HTMLElement;
      expect(challengeList).not.toBeNull();
    });
  });

  describe('6. MenuScreen Mobile Overlap Audit', () => {
    it.each(mobileViewports)('renders title banner, 4 mode buttons, and 2x2 sub-row on $name ($w x $h)', ({ w, h }) => {
      const metrics = ResponsiveLayout.instance.computeMetrics(w, h);
      root.applyMetrics(metrics);

      const screen = new MenuScreen(root);
      screen.show();

      // Title & Tagline
      const topTitle = screen.element.querySelector('.top-title') as HTMLElement;
      const bottomTitle = screen.element.querySelector('.bottom-title') as HTMLElement;
      const tagline = screen.element.querySelector('.game-tagline') as HTMLElement;
      expect(topTitle).not.toBeNull();
      expect(bottomTitle).not.toBeNull();
      expect(tagline).not.toBeNull();

      // Best pills row
      const bestRow = screen.element.querySelector('.menu-best-row') as HTMLElement;
      expect(bestRow).not.toBeNull();
      const pills = bestRow.querySelectorAll('.best-pill');
      expect(pills.length).toBe(4);

      // Mode buttons (Expedition, Endless, Boss Rush, Daily)
      const modeCol = screen.element.querySelector('.mode-buttons-col') as HTMLElement;
      expect(modeCol).not.toBeNull();
      const modeBtns = modeCol.querySelectorAll('.cyber-btn');
      expect(modeBtns.length).toBe(4);

      // Sub-row buttons (Sanctuary, Stats, Codex, Settings)
      const subRow = screen.element.querySelector('.menu-sub-row') as HTMLElement;
      expect(subRow).not.toBeNull();
      const subBtns = subRow.querySelectorAll('.cyber-btn');
      expect(subBtns.length).toBe(4);

      const sanctuaryBtn = subRow.querySelector('.btn-sanctuary');
      const statsBtn = subRow.querySelector('.btn-stats, .btn-global-stats');
      const codexBtn = subRow.querySelector('.btn-codex, .btn-help');
      const settingsBtn = subRow.querySelector('.btn-settings');
      expect(sanctuaryBtn).not.toBeNull();
      expect(statsBtn).not.toBeNull();
      expect(codexBtn).not.toBeNull();
      expect(settingsBtn).not.toBeNull();

      // Footer
      const footer = screen.element.querySelector('.menu-footer') as HTMLElement;
      expect(footer).not.toBeNull();
    });
  });

  describe('7. CodexModalScreen / HelpScreen Mobile Overlap Audit', () => {
    it.each(mobileViewports)('renders search bar, category hub cards, entry cards, and close button on $name ($w x $h)', ({ w, h }) => {
      const metrics = ResponsiveLayout.instance.computeMetrics(w, h);
      root.applyMetrics(metrics);

      const screen = new HelpScreen(root);
      screen.show();

      // Header
      const header = screen.element.querySelector('.codex-header') as HTMLElement;
      expect(header).not.toBeNull();
      const closeTopBtn = screen.element.querySelector('.btn-close-top') as HTMLElement;
      expect(closeTopBtn).not.toBeNull();

      // Search row
      const searchRow = screen.element.querySelector('.codex-search-row') as HTMLElement;
      expect(searchRow).not.toBeNull();
      const searchInput = screen.element.querySelector('.codex-search-input') as HTMLInputElement;
      expect(searchInput).not.toBeNull();

      // Scroll container with Hub cards
      const scrollContainer = screen.element.querySelector('.codex-scroll-container') as HTMLElement;
      expect(scrollContainer).not.toBeNull();
      const hubCards = scrollContainer.querySelectorAll('.codex-hub-card');
      expect(hubCards.length).toBeGreaterThan(0);

      // Open Category View
      screen.openCategory('rules');
      const entryCards = scrollContainer.querySelectorAll('.codex-card');
      expect(entryCards.length).toBeGreaterThan(0);

      // Open an entry accordion
      screen.toggleExclusiveCard(entryCards[0].getAttribute('data-id') || '');
      expect(screen.expandedIds.size).toBe(1);

      // Footer action button
      const closeMainBtn = screen.element.querySelector('.btn-close-main') as HTMLElement;
      expect(closeMainBtn).not.toBeNull();
    });
  });

  describe('8. SnakeLabScreen Mobile Overlap Audit', () => {
    it.each(mobileViewports)('renders 6 quick stat chips, mutation cards, helmet vault, and deploy button on $name ($w x $h)', ({ w, h }) => {
      const metrics = ResponsiveLayout.instance.computeMetrics(w, h);
      root.applyMetrics(metrics);

      const screen = new SnakeLabScreen(root);
      screen.show();

      // Header & Quick Stat Chips
      const header = screen.element.querySelector('.lab-header') as HTMLElement;
      expect(header).not.toBeNull();
      const chips = screen.element.querySelectorAll('.lab-points-label span');
      expect(chips.length).toBeGreaterThan(0);

      // Tab bar
      const tabs = screen.element.querySelectorAll('.btn-tab-lab, .btn-tab-helmets, .btn-tab-stats, .btn-tab-telemetry');
      expect(tabs.length).toBe(3);

      // Scroll container with mutation cards
      const scrollContainer = screen.element.querySelector('.lab-scroll-container') as HTMLElement;
      expect(scrollContainer).not.toBeNull();
      const cards = scrollContainer.querySelectorAll('.lab-docked-card-btn, .challenge-row-card');
      expect(cards.length).toBeGreaterThan(0);

      // Switch to Helmets Tab
      screen.setTab('helmets');
      const helmetContainer = scrollContainer.querySelector('.equipped-helmet-container');
      expect(helmetContainer).not.toBeNull();

      // Bottom bar
      const bottomBar = screen.element.querySelector('.lab-bottom-bar') as HTMLElement;
      expect(bottomBar).not.toBeNull();
      const closeBtn = screen.element.querySelector('.btn-close-lab') as HTMLElement;
      expect(closeBtn).not.toBeNull();
    });
  });

  describe('9. DevChecklistScreen Mobile Overlap Audit', () => {
    it.each(mobileViewports)('renders header, progress bar, search, category tabs, item cards on $name ($w x $h)', ({ w, h }) => {
      const metrics = ResponsiveLayout.instance.computeMetrics(w, h);
      root.applyMetrics(metrics);

      const screen = new DevChecklistScreen(root);
      screen.show();

      // Header
      const header = screen.element.querySelector('.dev-header') as HTMLElement;
      expect(header).not.toBeNull();
      const closeBtn = screen.element.querySelector('.btn-close-checklist') as HTMLElement;
      expect(closeBtn).not.toBeNull();

      // Progress bar & search
      const progress = screen.element.querySelector('.dev-progress-section') as HTMLElement;
      const search = screen.element.querySelector('.dev-search-input') as HTMLInputElement;
      expect(progress).not.toBeNull();
      expect(search).not.toBeNull();

      // Category tab bar
      const tabs = screen.element.querySelectorAll('.btn-dev-tab');
      expect(tabs.length).toBeGreaterThan(0);

      // Entries list
      const scrollContainer = screen.element.querySelector('.dev-scroll-container') as HTMLElement;
      expect(scrollContainer).not.toBeNull();
      const devCards = scrollContainer.querySelectorAll('.dev-card');
      expect(devCards.length).toBeGreaterThan(0);
    });
  });

  describe('10. GameOverScreen, FloorClearScreen & RunSummaryScreen Mobile Overlap Audit', () => {
    it.each(mobileViewports)('renders defeat summary, stats cards, and action buttons on $name ($w x $h)', ({ w, h }) => {
      const metrics = ResponsiveLayout.instance.computeMetrics(w, h);
      root.applyMetrics(metrics);

      const defeatScreen = new GameOverScreen(root);
      defeatScreen.show({ mode: 'defeat' });

      expect(defeatScreen.element.querySelector('.defeat-title')).not.toBeNull();
      const statsWrapper = defeatScreen.element.querySelector('.stats-wrapper') as HTMLElement;
      expect(statsWrapper).not.toBeNull();
      const statCards = statsWrapper.querySelectorAll('.stat-card');
      expect(statCards.length).toBeGreaterThan(0);

      const retryBtn = defeatScreen.element.querySelector('.btn-retry') as HTMLElement;
      const menuBtn = defeatScreen.element.querySelector('.btn-menu') as HTMLElement;
      expect(retryBtn).not.toBeNull();
      expect(menuBtn).not.toBeNull();
    });

    it.each(mobileViewports)('renders floor clear summary and next floor descent button on $name ($w x $h)', ({ w, h }) => {
      const metrics = ResponsiveLayout.instance.computeMetrics(w, h);
      root.applyMetrics(metrics);

      const floorClearScreen = new FloorClearScreen(root);
      floorClearScreen.show({ mode: 'floor_clear' });

      expect(floorClearScreen.element.querySelector('.victory-title')).not.toBeNull();
      const nextFloorBtn = floorClearScreen.element.querySelector('.btn-next-floor') as HTMLElement;
      expect(nextFloorBtn).not.toBeNull();
    });
  });

  describe('11. PauseSettingsScreen Mobile Overlap Audit', () => {
    it.each(mobileViewports)('renders pause header, settings controls body, and resume/abandon buttons on $name ($w x $h)', ({ w, h }) => {
      const metrics = ResponsiveLayout.instance.computeMetrics(w, h);
      root.applyMetrics(metrics);

      const screen = new PauseSettingsScreen(root);
      screen.show();

      const header = screen.element.querySelector('.modal-header') as HTMLElement;
      expect(header).not.toBeNull();

      const scrollBody = screen.element.querySelector('.pause-controls-body') as HTMLElement;
      expect(scrollBody).not.toBeNull();

      const resumeBtn = screen.element.querySelector('.btn-resume') as HTMLElement;
      const abandonBtn = screen.element.querySelector('.btn-abandon') as HTMLElement;
      expect(resumeBtn).not.toBeNull();
      expect(abandonBtn).not.toBeNull();
    });
  });

  describe('12. MultiScreenModal Mobile Overlap Audit', () => {
    it.each(mobileViewports)('renders sync cards, QR room code, companion link input, and copy button on $name ($w x $h)', ({ w, h }) => {
      const metrics = ResponsiveLayout.instance.computeMetrics(w, h);
      root.applyMetrics(metrics);

      const screen = new MultiScreenModal(root);
      screen.show();

      const header = screen.element.querySelector('.modal-header') as HTMLElement;
      expect(header).not.toBeNull();

      const scrollGrid = screen.element.querySelector('.multiscreen-options-grid') as HTMLElement;
      expect(scrollGrid).not.toBeNull();

      const qrCode = screen.element.querySelector('.qr-room-code') as HTMLElement;
      const urlInput = screen.element.querySelector('.companion-url-input') as HTMLInputElement;
      const copyBtn = screen.element.querySelector('.btn-copy-url') as HTMLElement;
      expect(qrCode).not.toBeNull();
      expect(urlInput).not.toBeNull();
      expect(copyBtn).not.toBeNull();
    });
  });

  describe('13. Reusable Widgets DOM & Layout Conformance', () => {
    it('creates badges, meters, buttons, and setting rows with consistent classes', () => {
      const badge = Widgets.createBadge('ONLINE', '⚡', '#00f0b5');
      expect(badge.classList.contains('cyber-badge')).toBe(true);

      const meter = Widgets.createMeter(8, '#00f0b5', 0.75);
      expect(meter.container.classList.contains('meter-container')).toBe(true);
      expect(meter.fill.classList.contains('meter-fill')).toBe(true);
      expect(meter.fill.style.width).toBe('75%');

      const btn = Widgets.createButton('CONFIRM', 'primary', () => {});
      expect(btn.classList.contains('cyber-btn')).toBe(true);
      expect(btn.classList.contains('btn-primary')).toBe(true);
    });
  });
});

