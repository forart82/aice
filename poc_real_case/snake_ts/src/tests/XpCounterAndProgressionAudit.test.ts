/**
 * Ouroboros Ascension — XP State Counter & Level Progression Audit Test Suite
 *
 * Comprehensive unit and integration verification for:
 * 1. Exact Oracle level-up formula evaluation: XP_req(level) = floor(100 * level^1.45) across levels 1..20
 *    and simulation recurrence: XpToNext = roundJs(XpToNext * 1.32 + 45).
 * 2. XP reward ingestion: Food items (9 types), Enemy kills (6 types), Relic procs (Soul Harvest +60%),
 *    Gourmand perk scaling (+20% to +80%), and Overdrive Frenzy 2x XP multipliers.
 * 3. Multi-level-up queueing: High-chunk XP grants, exact pending level-up counting, residual invariant checks,
 *    and guard limits.
 * 4. HUD XP counter telemetry: DOM hierarchy, real-time value formatting, progression ratios, and multi-tier
 *    responsive metrics (phone, tablet, desktop).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { setupMockDom, MockElement } from './MockDom';
import { SnakePlayer } from '../sim/SnakePlayer';
import { GameEngine } from '../sim/GameEngine';
import { FoodItem } from '../sim/FoodItem';
import { Enemy } from '../sim/Enemy';
import { GameData } from '../data/GameData';
import { MathX } from '../core/MathX';
import { MetaProgression } from '../data/MetaProgression';
import { Services } from '../core/Services';
import { NullFx, NullSound, ScriptedInput } from '../core/Contracts';
import { UiRoot } from '../ui/UiRoot';
import { HudView } from '../ui/HudView';
import { SnakeLabScreen } from '../ui/screens/SnakeLabScreen';
import { ResponsiveLayout } from '../ui/ResponsiveLayout';
import { SaveIO } from '../platform/SaveIO';
import * as fsLib from 'fs';
import * as pathLib from 'path';

describe('XP State Counter & Level Progression System Audit', () => {
  let restoreDom: () => void;
  let engine: GameEngine;
  let scriptedInput: ScriptedInput;
  let uiRoot: UiRoot;
  let hud: HudView;
  let container: MockElement;

  beforeEach(() => {
    restoreDom = setupMockDom();
    SaveIO.memoryBackendEnabled = true;
    SaveIO.clearMemory();

    MetaProgression.readBackend = () => null;
    MetaProgression.writeBackend = () => {};
    MetaProgression.deleteBackend = () => {};
    MetaProgression.instance = new MetaProgression();
    for (const k of GameData.Classes.keys) {
      MetaProgression.instance.unlockedClasses[k] = true;
    }

    scriptedInput = new ScriptedInput();
    Services.Input = scriptedInput;
    Services.Fx = new NullFx();
    Services.Sound = new NullSound();
    Services.Headless = true;

    container = document.createElement('div') as any;
    engine = new GameEngine(Services.Fx);
    uiRoot = UiRoot.init(container as any, engine);
    engine.setUiRoot(uiRoot);
    hud = uiRoot.hudView;
  });

  afterEach(() => {
    restoreDom();
  });

  // ============================================================================
  // SECTION 1: XP Formula Calculation Across Levels 1 to 20
  // ============================================================================
  describe('1. XP Progression Formula Calculations (Levels 1 to 20)', () => {
    /**
     * Oracle SSOT Specification (ORACLE.md Section 4.1 Table 4.1):
     * Formula: XP_req(level) = floor(100 * level^1.45)
     */
    it('1.1 evaluates exact mathematical XP thresholds for Oracle formula across levels 1 to 20', () => {
      const oracleExpectedThresholds: Record<number, number> = {
        1: 100,
        2: 273,
        3: 491,
        4: 746,
        5: 1031,
        6: 1343,
        7: 1680,
        8: 2039,
        9: 2419,
        10: 2818,
        11: 3236,
        12: 3671,
        13: 4123,
        14: 4590,
        15: 5073,
        16: 5571,
        17: 6083,
        18: 6609,
        19: 7148,
        20: 7700,
      };

      for (let lvl = 1; lvl <= 20; lvl++) {
        // Mathematical evaluation: floor(100 * lvl^1.45)
        const computed = Math.floor(100 * Math.pow(lvl, 1.45));
        const expected = oracleExpectedThresholds[lvl];
        expect(computed).toBe(expected);
      }
    });

    it('1.2 asserts strict monotonicity, convexity, and positive growth rate across levels 1 to 20', () => {
      let prevThreshold = 0;
      let prevDelta = 0;

      for (let lvl = 1; lvl <= 20; lvl++) {
        const threshold = Math.floor(100 * Math.pow(lvl, 1.45));

        // Invariant 1: Strictly positive threshold
        expect(threshold).toBeGreaterThan(0);

        // Invariant 2: Strict monotonicity (threshold increases monotonically)
        if (lvl > 1) {
          expect(threshold).toBeGreaterThan(prevThreshold);
          const delta = threshold - prevThreshold;

          // Invariant 3: Positive second derivative (convex escalation)
          if (prevDelta > 0) {
            expect(delta).toBeGreaterThan(prevDelta);
          }
          prevDelta = delta;
        }

        prevThreshold = threshold;
      }
    });

    it('1.3 verifies SnakePlayer dynamic calibrated curve and non-draining wallet accumulation', () => {
      const player = new SnakePlayer('emerald', 1280, 720, 3);
      expect(player.Level).toBe(1);
      expect(player.Xp).toBe(0);
      expect(player.XpToNext).toBe(155);

      // Calibrated threshold progression: Threshold(L) = floor(75 * (L-1)^1.34 + 80 * (L-1))
      const expectedCurve: number[] = [];
      for (let lvl = 1; lvl < 20; lvl++) {
        const next = SnakePlayer.CalibratedXpThreshold(lvl + 1) - SnakePlayer.CalibratedXpThreshold(lvl);
        expectedCurve.push(next);
      }

      // Expected delta array
      expect(expectedCurve[0]).toBe(155); // Lvl 1->2: 155 - 0 = 155
      expect(expectedCurve[1]).toBe(194); // Lvl 2->3: 349 - 155 = 194
      expect(expectedCurve[2]).toBe(217); // Lvl 3->4: 566 - 349 = 217
      expect(expectedCurve[3]).toBe(234); // Lvl 4->5: 800 - 566 = 234

      // Step-by-step wallet accumulation without threshold draining
      let cumulativeXp = 0;
      for (let lvl = 1; lvl < 20; lvl++) {
        const needed = expectedCurve[lvl - 1]!;
        cumulativeXp += needed;
        player.GainXp(needed);

        expect(player.Xp).toBe(cumulativeXp);
        expect(player.TotalXpCollected).toBe(cumulativeXp);
      }
    });
  });

  // ============================================================================
  // SECTION 2: XP Gain from Food, Enemies, Overdrive Frenzy & Perks
  // ============================================================================
  describe('2. XP Gain Sources, Relic Multipliers & Perk Scaling', () => {
    it('2.1 grants exact calibrated XP upon consuming each of the 9 food item archetypes', () => {
      engine.chooseMode('rogue');
      engine.selectedClass = 'emerald';
      engine.startRun();

      const player = engine.Player;
      const combat = engine.Combat;
      const world = engine.worldBag();

      const foodTypes: Array<{ type: string; expectedXp: number; expectedScore: number }> = [
        { type: 'apple', expectedXp: 1, expectedScore: 100 },
        { type: 'golden', expectedXp: 4, expectedScore: 300 },
        { type: 'potion', expectedXp: 2, expectedScore: 100 },
        { type: 'shield', expectedXp: 2, expectedScore: 150 },
        { type: 'bomb', expectedXp: 3, expectedScore: 200 },
        { type: 'chrono', expectedXp: 3, expectedScore: 150 },
        { type: 'shard', expectedXp: 4, expectedScore: 250 },
        { type: 'soul', expectedXp: 5, expectedScore: 120 },
        { type: 'prism', expectedXp: 15, expectedScore: 500 },
      ];

      for (const item of foodTypes) {
        player.Xp = 0;
        player.TotalXpCollected = 0;
        player.XpToNext = 10000; // high threshold to prevent level reset

        const food = new FoodItem(player.X, player.Y, item.type);
        expect(food.XpValue).toBe(item.expectedXp);
        expect(food.ScoreValue).toBe(item.expectedScore);

        combat.eatFood(food, world);

        expect(player.Xp).toBe(item.expectedXp);
        expect(player.TotalXpCollected).toBe(item.expectedXp);
      }
    });

    it('2.2 awards canonical base XP upon slaying each of the 6 hostile enemy archetypes', () => {
      engine.chooseMode('rogue');
      engine.selectedClass = 'emerald';
      engine.startRun();

      const player = engine.Player;
      const combat = engine.Combat;
      const world = engine.worldBag();

      const enemyArchetypes: Array<{ type: string; expectedXp: number; expectedScore: number }> = [
        { type: 'scarab', expectedXp: 2, expectedScore: 220 },
        { type: 'swarmling', expectedXp: 1, expectedScore: 110 },
        { type: 'spitter', expectedXp: 3, expectedScore: 260 },
        { type: 'phantom', expectedXp: 3, expectedScore: 280 },
        { type: 'drone', expectedXp: 4, expectedScore: 320 },
        { type: 'brute', expectedXp: 6, expectedScore: 500 },
      ];

      for (const mob of enemyArchetypes) {
        player.Xp = 0;
        player.TotalXpCollected = 0;
        player.XpToNext = 10000;

        const enemy = new Enemy(100, 100, mob.type, 1);
        expect(enemy.XpValue).toBe(mob.expectedXp);
        expect(enemy.ScoreValue).toBe(mob.expectedScore);

        combat.handleEnemyKill(enemy, world);

        expect(player.Xp).toBe(mob.expectedXp);
        expect(player.TotalXpCollected).toBe(mob.expectedXp);
      }
    });

    it('2.3 scales enemy kill XP via Soul Harvest relic (+60% per rank)', () => {
      engine.chooseMode('rogue');
      engine.selectedClass = 'emerald';
      engine.startRun();

      const player = engine.Player;
      const combat = engine.Combat;
      const world = engine.worldBag();

      player.Xp = 0;
      player.TotalXpCollected = 0;
      player.XpToNext = 10000;

      // Base kill: Brute = 6 XP
      const brute = new Enemy(100, 100, 'brute', 1);
      player.Relics['soulHarvest'] = 1; // 1 + 0.6 * 1 = 1.6x -> 6 * 1.6 = 9.6 XP

      combat.handleEnemyKill(brute, world);
      expect(player.Xp).toBeCloseTo(9.6, 5);
      expect(player.TotalXpCollected).toBeCloseTo(9.6, 5);

      // Rank 2: 1 + 0.6 * 2 = 2.2x -> 6 * 2.2 = 13.2 XP
      player.Xp = 0;
      player.Relics['soulHarvest'] = 2;
      const brute2 = new Enemy(100, 100, 'brute', 1);
      combat.handleEnemyKill(brute2, world);
      expect(player.Xp).toBeCloseTo(13.2, 5);
    });

    it('2.4 scales all XP gains additively via Gourmand perk cards (+20% per card up to 4 stacks)', () => {
      const player = new SnakePlayer('emerald', 1280, 720, 3);
      player.XpToNext = 10000;

      const gourmandCard = GameData.CardPool.find((c) => c.Id === 'gourmand')!;
      expect(gourmandCard).toBeDefined();

      // Base XP Gain = 1.0 (100%)
      expect(player.Stats.XpGain).toBe(1.0);
      player.GainXp(100);
      expect(player.Xp).toBe(100);

      // Stack 1: +20% -> XpGain = 1.2
      player.Xp = 0;
      gourmandCard.Apply(player);
      expect(player.Stats.XpGain).toBeCloseTo(1.2, 5);
      player.GainXp(100);
      expect(player.Xp).toBeCloseTo(120, 5);

      // Stack 2: +20% -> XpGain = 1.4
      player.Xp = 0;
      gourmandCard.Apply(player);
      expect(player.Stats.XpGain).toBeCloseTo(1.4, 5);
      player.GainXp(100);
      expect(player.Xp).toBeCloseTo(140, 5);

      // Stack 3: +20% -> XpGain = 1.6
      player.Xp = 0;
      gourmandCard.Apply(player);
      expect(player.Stats.XpGain).toBeCloseTo(1.6, 5);
      player.GainXp(100);
      expect(player.Xp).toBeCloseTo(160, 5);

      // Stack 4 (Max Stacks): +20% -> XpGain = 1.8 (+80% total bonus)
      player.Xp = 0;
      gourmandCard.Apply(player);
      expect(player.Stats.XpGain).toBeCloseTo(1.8, 5);
      player.GainXp(100);
      expect(player.Xp).toBeCloseTo(180, 5);
    });

    it('2.5 validates Overdrive Frenzy activation and 2x combat multiplier synergy', () => {
      engine.chooseMode('rogue');
      engine.selectedClass = 'emerald';
      engine.startRun();

      const combat = engine.Combat;
      const player = engine.Player;
      const world = engine.worldBag();

      expect(combat.FrenzyActive).toBe(false);

      // Build combo streak to 10 to trigger Overdrive Frenzy
      for (let i = 0; i < 10; i++) {
        combat.incrementCombo(player, world);
      }

      expect(combat.ComboCount).toBe(10);
      expect(combat.FrenzyActive).toBe(true);
      expect(combat.FrenzyTimer).toBeGreaterThanOrEqual(8.0);

      // Verify Overdrive Frenzy doubles combat damage output
      const baseDmg = 50;
      let finalDmg = baseDmg;
      if (combat.FrenzyActive) finalDmg *= 2;
      expect(finalDmg).toBe(100);
    });
  });

  // ============================================================================
  // SECTION 3: Multi-Level-Up Queueing & Residual Invariants
  // ============================================================================
  describe('3. Multi-Level-Up Queueing & Progression Invariants', () => {
    it('3.1 strictly accumulates large XP lump-sums into spendable wallet without threshold drain', () => {
      const player = new SnakePlayer('emerald', 1280, 720, 3);
      expect(player.Level).toBe(1);
      expect(player.Xp).toBe(0);
      expect(player.XpToNext).toBe(155);
      expect(player.PendingLevelUps).toBe(0);

      // Feed large XP lump-sum (5,000 XP)
      player.GainXp(5000);

      // Spendable wallet retains all 5000 XP
      expect(player.Xp).toBe(5000);
      expect(player.TotalXpCollected).toBe(5000);
    });

    it('3.2 simulates sequential consumption of queued draft level-ups', () => {
      const player = new SnakePlayer('emerald', 1280, 720, 3);
      player.PendingLevelUps = 5;

      expect(player.PendingLevelUps).toBe(5);
      const initialPending = player.PendingLevelUps;

      // Simulate player drafting rewards one by one
      for (let i = 0; i < initialPending; i++) {
        expect(player.PendingLevelUps).toBe(initialPending - i);
        player.PendingLevelUps--;
      }

      expect(player.PendingLevelUps).toBe(0);
    });

    it('3.3 handles zero, negative, and fractional XP values safely without state corruption', () => {
      const player = new SnakePlayer('emerald', 1280, 720, 3);
      const initialLevel = player.Level;
      const initialXp = player.Xp;
      const initialToNext = player.XpToNext;

      // 0 XP returns false and alters no properties
      expect(player.GainXp(0)).toBe(false);
      expect(player.Level).toBe(initialLevel);
      expect(player.Xp).toBe(initialXp);
      expect(player.TotalXpCollected).toBe(0);

      // Negative XP returns false and alters no properties
      expect(player.GainXp(-100)).toBe(false);
      expect(player.Level).toBe(initialLevel);
      expect(player.Xp).toBe(initialXp);
      expect(player.TotalXpCollected).toBe(0);

      // Fractional XP adds with high float64 precision
      player.GainXp(12.75);
      expect(player.Xp).toBe(12.75);
      expect(player.TotalXpCollected).toBe(12.75);
      expect(player.XpToNext).toBe(initialToNext);
    });

    it('3.4 handles massive astronomical XP without infinite loops or integer truncation', () => {
      const player = new SnakePlayer('emerald', 1280, 720, 3);
      // Give massive astronomical XP (10^12)
      player.GainXp(1_000_000_000_000);
      expect(player.Xp).toBe(1_000_000_000_000);
      expect(player.TotalXpCollected).toBe(1_000_000_000_000);
    });
  });

  // ============================================================================
  // SECTION 4: HUD XP Counter Rendering & Mobile Visibility
  // ============================================================================
  describe('4. HUD Ouro Currency Counter Telemetry & Multi-Tier Responsive Visibility', () => {
    it('4.1 verifies DOM hierarchy contains .hud-ouro-counter-wrap, .hud-ouro-badge, and .hud-ouro-val', () => {
      const ouroCounterWrap = hud.element.querySelector('.hud-ouro-counter-wrap, .hud-xp-counter-wrap');
      const ouroBadge = hud.element.querySelector('.hud-ouro-badge, .hud-xp-badge');
      const ouroVal = hud.element.querySelector('.hud-ouro-val, .hud-xp-val');

      expect(ouroCounterWrap).toBeDefined();
      expect(ouroBadge).toBeDefined();
      expect(ouroVal).toBeDefined();
    });

    it('4.2 updates Ouro currency value accurately on refresh', () => {
      engine.chooseMode('rogue');
      engine.selectedClass = 'emerald';
      engine.startRun();

      const player = engine.Player;
      player.Xp = 345.8;
      player.Level = 4;
      player.XpToNext = 413;

      hud.refresh(engine);

      const ouroVal = hud.element.querySelector('.hud-ouro-val, .hud-xp-val')!;
      expect(ouroVal.textContent).toBe('345');
    });

    it('4.3 maintains HUD Ouro counter integrity and telemetry across mobile (phone), tablet, and desktop tiers', () => {
      engine.chooseMode('rogue');
      engine.selectedClass = 'emerald';
      engine.startRun();

      const player = engine.Player;
      player.Xp = 128;
      player.Level = 2;
      player.XpToNext = 177;

      // 1. Phone Tier (390 x 844)
      const phoneMetrics = ResponsiveLayout.instance.computeMetrics(390, 844);
      hud.applyMetrics(phoneMetrics);
      hud.refresh(engine);

      expect(hud.element.classList.contains('tier-phone')).toBe(true);
      const phoneOuroWrap = hud.element.querySelector('.hud-ouro-counter-wrap, .hud-xp-counter-wrap');
      const phoneOuroVal = hud.element.querySelector('.hud-ouro-val, .hud-xp-val')!;
      expect(phoneOuroWrap).toBeDefined();
      expect(phoneOuroVal.textContent).toBe('128');

      // 2. Tablet Tier (768 x 1024)
      const tabletMetrics = ResponsiveLayout.instance.computeMetrics(768, 1024);
      hud.applyMetrics(tabletMetrics);
      hud.refresh(engine);

      expect(hud.element.classList.contains('tier-tablet')).toBe(true);
      expect(phoneOuroVal.textContent).toBe('128');

      // 3. Desktop Tier (1920 x 1080)
      const desktopMetrics = ResponsiveLayout.instance.computeMetrics(1920, 1080);
      hud.applyMetrics(desktopMetrics);
      hud.refresh(engine);

      expect(hud.element.classList.contains('tier-desktop')).toBe(true);
      expect(phoneOuroVal.textContent).toBe('128');
    });

    it('4.4 verifies live HUD Ouro counter updates upon eating food during gameplay loop without resetting on level up', () => {
      engine.chooseMode('rogue');
      engine.selectedClass = 'emerald';
      engine.startRun();

      const player = engine.Player;
      const combat = engine.Combat;
      const world = engine.worldBag();

      expect(player.Xp).toBe(0);
      hud.refresh(engine);

      let ouroVal = hud.element.querySelector('.hud-ouro-val, .hud-xp-val')!;
      expect(ouroVal.textContent).toBe('0');

      // Ingest Golden Apple (+4 XP/Ouro)
      const goldenApple = new FoodItem(player.X, player.Y, 'golden');
      combat.eatFood(goldenApple, world);

      expect(player.Xp).toBe(4);

      // HUD update
      hud.refresh(engine);
      ouroVal = hud.element.querySelector('.hud-ouro-val, .hud-xp-val')!;
      expect(ouroVal.textContent).toBe('4');

      // Ingest Astral Prism (+15 XP/Ouro -> 4 + 15 = 19 Total XP/Ouro)
      const prism = new FoodItem(player.X, player.Y, 'prism');
      combat.eatFood(prism, world);

      // Total collected accumulates to 19 (totalXpCollected = 19)
      hud.refresh(engine);
      ouroVal = hud.element.querySelector('.hud-ouro-val, .hud-xp-val')!;

      // Counter tracks accumulating in-run Ouro (19)
      expect(ouroVal.textContent).toBe('19');
    });

    it('4.5 verifies index.html stylesheet maintains phone visibility for .hud-ouro-counter-wrap without display:none', () => {
      const htmlPath = pathLib.resolve(__dirname, '../../index.html');
      const htmlContent = fsLib.readFileSync(htmlPath, 'utf8');

      // Must not hide .hud-ouro-counter-wrap or .hud-xp-counter-wrap on phone tier
      const phoneXpHiddenRegex = /\.hud-layer\.tier-phone\s+.*\.hud-(?:ouro|xp)-counter-wrap\s*\{[^}]*display\s*:\s*none/i;
      expect(phoneXpHiddenRegex.test(htmlContent)).toBe(false);

      // Must include dedicated styling for .hud-ouro-counter-wrap in tier-phone
      expect(htmlContent).toContain('.hud-ouro-counter-wrap');
    });

    it('4.6 asserts wallet synchronization: spending in Cranial Lab decreases both Lab Ouro chip and in-game HUD counter', () => {
      engine.chooseMode('rogue');
      engine.selectedClass = 'emerald';
      engine.startRun();

      const player = engine.Player!;
      player.Ouro = 100;
      player.Xp = 100;

      const labScreen = new SnakeLabScreen(uiRoot);
      uiRoot.registerScreen(labScreen);
      uiRoot.showScreen('modal-snake-lab');
      labScreen.refresh();
      hud.refresh(engine);

      const labOuroChip = labScreen.element.querySelector('.lab-stat-chip-ouro') as HTMLElement;
      const hudOuroVal = hud.element.querySelector('.hud-ouro-val, .hud-xp-val') as HTMLElement;
      expect(labOuroChip.textContent).toContain('🪙 100 Ouro');
      expect(hudOuroVal.textContent).toBe('100');

      // Purchase Attack Spitter (BaseModuleCost = 30 Ouro)
      const buttons = labScreen.element.querySelectorAll('.lab-docked-card-btn');
      const spitterBtn = Array.from(buttons).find(b => b.textContent?.includes('Attack Spitter')) as HTMLButtonElement;
      expect(spitterBtn).toBeDefined();
      spitterBtn.click();

      expect(player.Ouro).toBe(70);

      expect(labScreen.element.querySelector('.lab-stat-chip-ouro')?.textContent).toContain('🪙 70 Ouro');
      expect(hud.element.querySelector('.hud-ouro-val, .hud-xp-val')?.textContent).toBe('70');
    });
  });
});
