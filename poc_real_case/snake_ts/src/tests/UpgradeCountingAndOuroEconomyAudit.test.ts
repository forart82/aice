/**
 * Ouroboros Ascension — Upgrade Counting & Ouro Economy Audit Test Suite
 * (UpgradeCountingAndOuroEconomyAudit.test.ts)
 *
 * Comprehensive automated verification for:
 * 1. Spendable Ouro Economy & No Arbitrary Drain:
 *    - Eating food (9 food types) increases spendable Ouro without arbitrary drain/subtraction.
 *    - Slaying enemies (6 enemy types + Bosses) increases spendable Ouro without arbitrary drain.
 *    - Gaining Ouro across level thresholds strictly preserves the active spendable wallet.
 *    - Multipliers (Gourmand perk, Soul Harvest relic) scale spendable Ouro gains additively.
 * 2. Cranial Mutation Lab Atomic Deductions & HUD Synchronization:
 *    - SpendOuro / spendOuro atomic deduction validation and boundary safety.
 *    - Head augment and socket module purchases in SnakeLabScreen deduct exact cost and sync with HUD.
 *    - Rejection of insufficient funds without altering wallet balance or installing modules.
 * 3. Serpent Length Counting (segments + 1) Architectural Parity:
 *    - SnakePlayer length, Length, totalLength, TotalLength return Segments.length + 1.
 *    - Growth increments accurately update length across player, SnakeLabScreen, StatsModalScreen, and MetaProgression.
 * 4. StatsModalScreen & MetaProgression Challenge Parity:
 *    - Food, kill, boss, and combo telemetry in StatsModalScreen match MetaProgression challenge evaluation.
 *    - Live challenge progress bars and completion percentages reflect active combat statistics accurately.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SnakePlayer } from '../sim/SnakePlayer.js';
import { GameEngine } from '../sim/GameEngine.js';
import { FoodItem } from '../sim/FoodItem.js';
import { Enemy } from '../sim/Enemy.js';
import { GameData } from '../data/GameData.js';
import { MetaProgression } from '../data/MetaProgression.js';
import { UiRoot } from '../ui/UiRoot.js';
import { HudView } from '../ui/HudView.js';
import { SnakeLabScreen } from '../ui/screens/SnakeLabScreen.js';
import { StatsModalScreen } from '../ui/screens/StatsModalScreen.js';
import { Services } from '../core/Services.js';
import { NullFx, NullSound, ISound } from '../core/Contracts.js';
import { setupMockDom, MockElement } from './MockDom.js';

class LabAudioSpy extends NullSound implements ISound {
  public uiCount = 0;
  public levelUpCount = 0;
  public errorCount = 0;

  public override playUi(): void { this.uiCount++; }
  public override playLevelUp(): void { this.levelUpCount++; }
  public override playError(): void { this.errorCount++; }
}

describe('Upgrade Counting & Ouro Economy Comprehensive Audit Suite', () => {
  let restoreDom: () => void;
  let audioSpy: LabAudioSpy;
  let engine: GameEngine;
  let uiRoot: UiRoot;
  let hud: HudView;
  let labScreen: SnakeLabScreen;
  let statsModalScreen: StatsModalScreen;
  let container: MockElement;

  beforeEach(() => {
    restoreDom = setupMockDom();
    audioSpy = new LabAudioSpy();
    Services.Fx = new NullFx();
    Services.Sound = audioSpy;
    Services.Headless = true;

    MetaProgression.readBackend = () => null;
    MetaProgression.writeBackend = () => {};
    MetaProgression.deleteBackend = () => {};
    MetaProgression.instance = new MetaProgression();
    MetaProgression.Instance.reset();

    container = document.createElement('div') as any;
    engine = new GameEngine(Services.Fx);
    Services.registerEngineProvider(() => engine);
    uiRoot = UiRoot.init(container as any, engine);
    engine.setUiRoot(uiRoot);
    hud = uiRoot.hudView;

    labScreen = new SnakeLabScreen(uiRoot);
    statsModalScreen = new StatsModalScreen(uiRoot);
    uiRoot.registerScreen(labScreen);
    uiRoot.registerScreen(statsModalScreen);
  });

  afterEach(() => {
    restoreDom();
    vi.restoreAllMocks();
  });

  // ============================================================================
  // SECTION 1: Spendable Ouro Wallet Economy & No Arbitrary Drain
  // ============================================================================
  describe('1. Spendable Ouro Economy & No Arbitrary Drain', () => {
    it('1.1 eating food increases spendable Ouro without ANY arbitrary subtraction or reset', () => {
      engine.chooseMode('rogue');
      engine.selectedClass = 'emerald';
      engine.startRun();

      const player = engine.Player!;
      const combat = engine.Combat!;
      const world = engine.worldBag();

      player.Ouro = 0;
      player.TotalOuroCollected = 0;

      const foodDropValues: Record<string, number> = {
        apple: 1,
        golden: 4,
        potion: 2,
        shield: 2,
        bomb: 3,
        chrono: 3,
        shard: 4,
        soul: 5,
        prism: 15,
      };

      let cumulativeExpected = 0;

      for (const [ftype, expectedVal] of Object.entries(foodDropValues)) {
        const food = new FoodItem(player.X, player.Y, ftype);
        combat.eatFood(food, world);

        cumulativeExpected += expectedVal;

        // Spendable wallet balance must equal exact accumulated sum without drain
        expect(player.Ouro).toBe(cumulativeExpected);
        expect(player.ouro).toBe(cumulativeExpected);
        expect(player.Xp).toBe(cumulativeExpected);
        expect(player.TotalOuroCollected).toBe(cumulativeExpected);
      }
    });

    it('1.2 slaying hostile enemies increases spendable Ouro without ANY arbitrary subtraction or drain', () => {
      engine.chooseMode('rogue');
      engine.selectedClass = 'emerald';
      engine.startRun();

      const player = engine.Player!;
      const combat = engine.Combat!;
      const world = engine.worldBag();

      player.Ouro = 0;
      player.TotalOuroCollected = 0;

      const enemyDropValues: Record<string, number> = {
        swarmling: 1,
        scarab: 2,
        spitter: 3,
        phantom: 3,
        drone: 4,
        brute: 6,
      };

      let cumulativeExpected = 0;

      for (const [etype, expectedVal] of Object.entries(enemyDropValues)) {
        const enemy = new Enemy(150, 150, etype, 1);
        combat.handleEnemyKill(enemy, world);

        cumulativeExpected += expectedVal;

        // Spendable wallet balance must equal exact accumulated sum without drain
        expect(player.Ouro).toBe(cumulativeExpected);
        expect(player.ouro).toBe(cumulativeExpected);
        expect(player.Xp).toBe(cumulativeExpected);
        expect(player.TotalOuroCollected).toBe(cumulativeExpected);
      }
    });

    it('1.3 defeating Apex Bosses awards +35 Ouro directly to spendable wallet without drain', () => {
      engine.chooseMode('rogue');
      engine.selectedClass = 'emerald';
      engine.startRun();

      const player = engine.Player!;
      player.Ouro = 50;
      player.TotalOuroCollected = 50;

      engine.spawnBoss();
      engine.onBossDefeated();

      // +35 Ouro awarded on boss defeat (50 + 35 = 85 Ouro)
      expect(player.Ouro).toBe(85);
      expect(player.ouro).toBe(85);
      expect(player.Xp).toBe(85);
      expect(player.TotalOuroCollected).toBe(85);
    });

    it('1.4 crossing calibrated level thresholds increments level without draining spendable Ouro wallet', () => {
      const player = new SnakePlayer('emerald');
      expect(player.Level).toBe(1);
      expect(player.Ouro).toBe(0);
      expect(player.TotalOuroCollected).toBe(0);

      // Gain 40 Ouro (below level 2 threshold 155)
      player.GainOuro(40);
      expect(player.Level).toBe(1);
      expect(player.Ouro).toBe(40);
      expect(player.TotalOuroCollected).toBe(40);

      // Gain 120 more Ouro (Total = 160 >= 155 Level 2 threshold)
      const leveled = player.GainOuro(120);
      expect(leveled).toBe(true);
      expect(player.Level).toBe(2);
      expect(player.PendingLevelUps).toBe(1);

      // Purified Ouro Wallet Model: Player retains all 160 spendable Ouro!
      expect(player.Ouro).toBe(160);
      expect(player.ouro).toBe(160);
      expect(player.Xp).toBe(160);
      expect(player.TotalOuroCollected).toBe(160);

      // Gain 200 more Ouro (Total = 360 >= 349 Level 3 threshold)
      player.GainOuro(200);
      expect(player.Level).toBe(3);
      expect(player.PendingLevelUps).toBe(2);
      expect(player.Ouro).toBe(360);
      expect(player.ouro).toBe(360);
      expect(player.Xp).toBe(360);
      expect(player.TotalOuroCollected).toBe(360);
    });

    it('1.5 scales Ouro gains additively via Gourmand cards and Soul Harvest relics without drain', () => {
      engine.chooseMode('rogue');
      engine.selectedClass = 'emerald';
      engine.startRun();

      const player = engine.Player!;
      const combat = engine.Combat!;
      const world = engine.worldBag();

      player.Ouro = 0;
      player.TotalOuroCollected = 0;

      // Equip Soul Harvest rank 1 (+60% kill Ouro)
      player.Relics['soulHarvest'] = 1;

      // Kill Magma Brute (base 6 Ouro -> 6 * 1.6 = 9.6 Ouro)
      const brute = new Enemy(100, 100, 'brute', 1);
      combat.handleEnemyKill(brute, world);

      expect(player.Ouro).toBeCloseTo(9.6, 5);
      expect(player.TotalOuroCollected).toBeCloseTo(9.6, 5);

      // Apply Gourmand (+20% Ouro Gained -> XpGain = 1.2)
      const gourmandCard = GameData.CardPool.find((c) => c.Id === 'gourmand')!;
      expect(gourmandCard).toBeDefined();
      gourmandCard.Apply(player);

      player.GainOuro(100);
      // 9.6 + (100 * 1.2) = 129.6 Ouro
      expect(player.Ouro).toBeCloseTo(129.6, 5);
      expect(player.TotalOuroCollected).toBeCloseTo(129.6, 5);
    });
  });

  // ============================================================================
  // SECTION 2: Cranial Mutation Lab Atomic Deductions & HUD Synchronization
  // ============================================================================
  describe('2. Cranial Mutation Lab Atomic Deductions & HUD Synchronization', () => {
    it('2.1 SpendOuro and spendOuro validate bounds and deduct exact costs atomically', () => {
      const player = new SnakePlayer('emerald');
      player.Ouro = 100;
      player.TotalOuroCollected = 100;

      // 0 or negative cost returns true without altering wallet
      expect(player.SpendOuro(0)).toBe(true);
      expect(player.spendOuro(-15)).toBe(true);
      expect(player.Ouro).toBe(100);

      // Cost exceeding balance returns false without altering wallet
      expect(player.SpendOuro(150)).toBe(false);
      expect(player.spendOuro(100.5)).toBe(false);
      expect(player.Ouro).toBe(100);

      // Exact cost deduction
      expect(player.SpendOuro(30)).toBe(true);
      expect(player.Ouro).toBe(70);
      expect(player.ouro).toBe(70);
      expect(player.Xp).toBe(70);
      expect(player.TotalOuroCollected).toBe(100); // Lifetime collected is unchanged

      expect(player.spendOuro(70)).toBe(true);
      expect(player.Ouro).toBe(0);
      expect(player.ouro).toBe(0);
      expect(player.Xp).toBe(0);
      expect(player.TotalOuroCollected).toBe(100);
    });

    it('2.2 purchasing head socket modules in SnakeLabScreen deducts exact cost and synchronizes HUD and Lab chips', () => {
      engine.chooseMode('rogue');
      engine.selectedClass = 'emerald';
      engine.startRun();

      const player = engine.Player!;
      player.Ouro = 100;
      player.TotalOuroCollected = 100;

      labScreen.show();
      labScreen.refresh();
      hud.refresh(engine);

      // Verify initial UI telemetry
      expect(labScreen.element.querySelector('.lab-stat-chip-ouro')?.textContent).toContain('🪙 100 Ouro');
      expect(hud.element.querySelector('.hud-ouro-val')?.textContent).toBe('100');

      // Purchase Attack Spitter (BaseModuleCost = 30 Ouro)
      const buttons = Array.from(labScreen.element.querySelectorAll('.lab-docked-card-btn')) as HTMLButtonElement[];
      const spitterBtn = buttons.find((b) => b.textContent?.includes('Attack Spitter'))!;
      expect(spitterBtn).toBeDefined();

      spitterBtn.click();

      // Verify exact deduction: 100 - 30 = 70 Ouro
      expect(player.Ouro).toBe(70);
      expect(player.Xp).toBe(70);
      expect(player.GetHeadModuleLevel('turret')).toBe(1);
      expect(audioSpy.levelUpCount).toBeGreaterThan(0);

      // Verify immediate synchronization
      expect(labScreen.element.querySelector('.lab-stat-chip-ouro')?.textContent).toContain('🪙 70 Ouro');
      expect(hud.element.querySelector('.hud-ouro-val')?.textContent).toBe('70');
    });

    it('2.3 purchasing cranial augments in SnakeLabScreen deducts exact cost and synchronizes HUD and Lab chips', () => {
      engine.chooseMode('rogue');
      engine.selectedClass = 'emerald';
      engine.startRun();

      const player = engine.Player!;
      player.Ouro = 100;
      player.TotalOuroCollected = 100;

      (engine.meta ?? MetaProgression.Instance).UnlockTier('fangs', 1);
      MetaProgression.Instance.UnlockTier('fangs', 1);
      labScreen.show();
      labScreen.refresh();
      hud.refresh(engine);

      // Purchase Venom Fangs (HeadAugmentBaseCost = 40 Ouro)
      const buttons = Array.from(labScreen.element.querySelectorAll('.lab-docked-card-btn')) as HTMLButtonElement[];
      const fangsBtn = buttons.find((b) => b.textContent?.includes('Venom Fangs'))!;
      expect(fangsBtn).toBeDefined();

      fangsBtn.click();

      // Verify exact deduction: 100 - 40 = 60 Ouro
      expect(player.Ouro).toBe(60);
      expect(player.Xp).toBe(60);
      expect(player.GetHeadAugmentLevel('fangs')).toBe(1);
      expect(audioSpy.levelUpCount).toBeGreaterThan(0);

      // Verify immediate synchronization
      expect(labScreen.element.querySelector('.lab-stat-chip-ouro')?.textContent).toContain('🪙 60 Ouro');
      expect(hud.element.querySelector('.hud-ouro-val')?.textContent).toBe('60');
    });

    it('2.4 rejects purchase when player has insufficient Ouro, plays error sound, displays warning toast, and preserves balance', () => {
      engine.chooseMode('rogue');
      engine.selectedClass = 'emerald';
      engine.startRun();

      const player = engine.Player!;
      player.Ouro = 20; // Insufficient for 30 Ouro module
      player.TotalOuroCollected = 20;

      labScreen.show();
      labScreen.refresh();
      hud.refresh(engine);

      const buttons = Array.from(labScreen.element.querySelectorAll('.lab-docked-card-btn')) as HTMLButtonElement[];
      const spitterBtn = buttons.find((b) => b.textContent?.includes('Attack Spitter'))!;
      expect(spitterBtn).toBeDefined();

      const initialErrorSounds = audioSpy.errorCount;
      spitterBtn.click();

      // Verify rejection
      expect(audioSpy.errorCount).toBe(initialErrorSounds + 1);
      expect(player.Ouro).toBe(20);
      expect(player.GetHeadModuleLevel('turret')).toBe(0);

      // Toast feedback visible
      const toast = labScreen.element.querySelector('.lab-toast-banner') as HTMLElement;
      expect(toast.style.display).not.toBe('none');
      expect(toast.textContent).toContain('Insufficient Ouro');
    });
  });

  // ============================================================================
  // SECTION 3: Serpent Length Counting (segments + 1) Consistency
  // ============================================================================
  describe('3. Serpent Length Counting (segments + 1) Architectural Parity', () => {
    it('3.1 asserts SnakePlayer length getters (length, Length, totalLength, TotalLength) return segments.length + 1', () => {
      // 0 body segments -> length 1 (head)
      const p0 = new SnakePlayer('emerald', 1280, 720, 0);
      expect(p0.Segments.length).toBe(0);
      expect(p0.segments.length).toBe(0);
      expect(p0.length).toBe(1);
      expect(p0.Length).toBe(1);
      expect(p0.totalLength).toBe(1);
      expect(p0.TotalLength).toBe(1);

      // 2 body segments -> length 3 (head + 2 segments)
      const p2 = new SnakePlayer('emerald', 1280, 720, 2);
      expect(p2.Segments.length).toBe(2);
      expect(p2.segments.length).toBe(2);
      expect(p2.length).toBe(3);
      expect(p2.Length).toBe(3);
      expect(p2.totalLength).toBe(3);
      expect(p2.TotalLength).toBe(3);

      // Add growth
      p2.addGrowth(5);
      expect(p2.Segments.length).toBe(7);
      expect(p2.segments.length).toBe(7);
      expect(p2.length).toBe(8);
      expect(p2.Length).toBe(8);
      expect(p2.totalLength).toBe(8);
      expect(p2.TotalLength).toBe(8);
    });

    it('3.2 matches serpent length counting between SnakePlayer, SnakeLabScreen chip, and StatsModalScreen', () => {
      engine.chooseMode('rogue');
      engine.selectedClass = 'emerald';
      engine.startRun();

      const player = engine.Player!;
      // Default initial serpent has 2 segments -> total length = 3
      expect(player.segments.length).toBe(2);
      expect(player.length).toBe(3);

      labScreen.show();
      labScreen.refresh();

      statsModalScreen.show({ mode: 'run' });
      statsModalScreen.refresh();

      // SnakeLabScreen stat chip: 📏 3 Segs
      const labChips = Array.from(labScreen.element.querySelectorAll('.lab-stat-chip'));
      const segChip = labChips.find((c) => c.textContent?.includes('Segs'));
      expect(segChip).toBeDefined();
      expect(segChip?.textContent).toContain('📏 3 Segs');

      // StatsModalScreen vitals: SERPENT LENGTH: 3
      const lenVal = statsModalScreen.element.querySelector('.stat-length-val');
      expect(lenVal?.textContent).toBe('3');

      // Grow snake to 10 total length (9 segments + head)
      player.addGrowth(7);
      expect(player.segments.length).toBe(9);
      expect(player.length).toBe(10);

      labScreen.refresh();
      statsModalScreen.refresh();

      const labChipsAfter = Array.from(labScreen.element.querySelectorAll('.lab-stat-chip'));
      const segChipAfter = labChipsAfter.find((c) => c.textContent?.includes('Segs'));
      expect(segChipAfter?.textContent).toContain('📏 10 Segs');
      expect(statsModalScreen.element.querySelector('.stat-length-val')?.textContent).toBe('10');
    });

    it('3.3 verifies MetaProgression.IsTierUnlocked evaluates length challenge strictly matching player length (segments.length + 1)', () => {
      engine.chooseMode('rogue');
      engine.selectedClass = 'emerald';
      engine.startRun();

      const player = engine.Player!;
      const meta = MetaProgression.Instance;

      const req = meta.GetScaledLengthRequirement(35);
      expect(meta.IsTierUnlocked('plasma', 1)).toBe(false);

      // Grow player to req body segments (total length = req)
      while (player.length < req) {
        player.addGrowth(1);
      }
      expect(player.length).toBe(req);

      // Tier 1 unlock becomes true at required length
      expect(meta.IsTierUnlocked('plasma', 1)).toBe(true);
    });
  });

  // ============================================================================
  // SECTION 4: StatsModalScreen & MetaProgression Challenge Parity
  // ============================================================================
  describe('4. StatsModalScreen & MetaProgression Challenge Parity', () => {
    it('4.1 food counts in StatsModalScreen match MetaProgression challenge evaluation', () => {
      engine.chooseMode('rogue');
      engine.selectedClass = 'emerald';
      engine.startRun();

      const combat = engine.Combat!;
      const meta = MetaProgression.Instance;
      const world = engine.worldBag();

      // Ingest 30 apples
      for (let i = 0; i < 30; i++) {
        combat.eatFood(new FoodItem(100, 100, 'apple'), world);
      }

      expect(combat.FoodsEaten).toBe(30);
      expect(combat.FoodsEatenByType['apple']).toBe(30);

      statsModalScreen.show({ mode: 'run' });
      statsModalScreen.refresh();

      // StatsModalScreen displays exact food count
      expect(statsModalScreen.element.querySelector('.food-apple-count')?.textContent).toBe('30');
      expect(statsModalScreen.element.querySelector('.stat-foods-val')?.textContent).toBe('30');

      // Regen Gland Tier 1 requires 30 Apples Eaten
      expect(meta.IsTierUnlocked('regen', 1)).toBe(true);
    });

    it('4.2 hostile bestiary kills in StatsModalScreen match MetaProgression challenge evaluation', () => {
      engine.chooseMode('rogue');
      engine.selectedClass = 'emerald';
      engine.startRun();

      const combat = engine.Combat!;
      const meta = MetaProgression.Instance;
      const world = engine.worldBag();

      // Slay 15 swarmlings (Magma Tier 1 requires 15 swarmlings)
      for (let i = 0; i < 15; i++) {
        combat.handleEnemyKill(new Enemy(100, 100, 'swarmling', 1), world);
      }

      expect(combat.Kills).toBe(15);
      expect(combat.KillsByType['swarmling']).toBe(15);

      statsModalScreen.show({ mode: 'run' });
      statsModalScreen.refresh();

      expect(statsModalScreen.element.querySelector('.kill-swarmling-count')?.textContent).toBe('15');
      expect(statsModalScreen.element.querySelector('.stat-kills-val')?.textContent).toBe('15');

      // Magma Vent Tier 1 requires 15 Swarmlings Slain
      expect(meta.IsTierUnlocked('magma', 1)).toBe(true);
    });

    it('4.3 boss defeat counts in StatsModalScreen match MetaProgression challenge evaluation', () => {
      engine.chooseMode('rogue');
      engine.selectedClass = 'emerald';
      engine.startRun();

      const combat = engine.Combat!;
      const meta = MetaProgression.Instance;

      combat.bossKills = 1;
      combat.DefeatedBossTypes.push('centipede');

      statsModalScreen.show({ mode: 'run' });
      statsModalScreen.refresh();

      expect(statsModalScreen.element.querySelector('.stat-bosses-val')?.textContent).toBe('1');
      expect(statsModalScreen.element.querySelector('.boss-defeats-list')?.textContent).toContain('Floor 1');

      // Voracious Maw Tier 1 requires Defeat Centipede Behemoth (Floor 1)
      expect(meta.IsTierUnlocked('maw', 1)).toBe(true);
    });

    it('4.4 combo counts in StatsModalScreen match MetaProgression challenge evaluation', () => {
      engine.chooseMode('rogue');
      engine.selectedClass = 'emerald';
      engine.startRun();

      const combat = engine.Combat!;
      const player = engine.Player!;
      const meta = MetaProgression.Instance;
      const world = engine.worldBag();

      // Build combo streak to 20
      for (let i = 0; i < 20; i++) {
        combat.incrementCombo(player, world);
      }

      expect(combat.HighestRunCombo).toBe(20);

      statsModalScreen.show({ mode: 'run' });
      statsModalScreen.refresh();

      expect(statsModalScreen.element.querySelector('.stat-curcombo-val')?.textContent).toBe('20x');
      expect(statsModalScreen.element.querySelector('.stat-combo-val')?.textContent).toBe('20x');

      // Bio-Arc Coil (Tesla) Tier 2 requires 20x Combo Streak
      expect(meta.IsTierUnlocked('tesla', 2)).toBe(true);
    });

    it('4.5 renders live challenge progress bars in StatsModalScreen matching active metrics', () => {
      engine.chooseMode('rogue');
      engine.selectedClass = 'emerald';
      engine.startRun();

      const combat = engine.Combat!;
      const world = engine.worldBag();

      // 6 scarabs out of 10 needed for Horns Tier 1 (60% progress)
      for (let i = 0; i < 6; i++) {
        combat.handleEnemyKill(new Enemy(100, 100, 'scarab', 1), world);
      }

      statsModalScreen.show({ mode: 'run' });
      statsModalScreen.refresh();

      const tracker = statsModalScreen.element.querySelector('.challenge-tracker-list')!;
      expect(tracker).toBeDefined();

      const cards = Array.from(tracker.querySelectorAll('.challenge-row-card'));
      const hornsCard = cards.find((c) => c.textContent?.includes('Horns'));
      expect(hornsCard).toBeDefined();

      // Verify count text and progress percentage
      expect(hornsCard?.querySelector('.challenge-count')?.textContent).toBe('6 / 10');
      expect(hornsCard?.querySelector('.challenge-status')?.textContent).toContain('60%');
    });
  });
});
