/**
 * Ouroboros Ascension — In-Run Ouro Economy & Cranial Lab Rebalance Test Suite
 * (InRunOuroEconomyAndCranialLabRebalance.test.ts)
 *
 * Validates:
 * 1. Rebalanced Food Ouro Drops (Apple: 1, Golden: 4, Potion: 2, Shield: 2,
 *    Bomb: 3, Chrono: 3, Shard: 4, Soul: 5, Prism: 15).
 * 2. Rebalanced Enemy Kill Ouro (Swarmling: 1, Scarab: 2, Spitter: 3,
 *    Phantom: 3, Arc Drone: 4, Magma Brute: 6, Boss Defeat: 35).
 * 3. Rebalanced Cranial Mutation Lab Costs (ModuleBaseCost: 30, HeadAugmentBaseCost: 40,
 *    Module scaling +15/purchase, Augment scaling +20/purchase).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GameData } from '../data/GameData.js';
import { FoodItem } from '../sim/FoodItem.js';
import { Enemy } from '../sim/Enemy.js';
import { Boss } from '../sim/Boss.js';
import { SnakePlayer } from '../sim/SnakePlayer.js';
import { GameEngine } from '../sim/GameEngine.js';
import { SnakeLabScreen } from '../ui/screens/SnakeLabScreen.js';
import { UiRoot } from '../ui/UiRoot.js';
import { MetaProgression } from '../data/MetaProgression.js';
import { setupMockDom } from './MockDom.js';
import { Services } from '../core/Services.js';
import { NullFx, NullSound, ISound } from '../core/Contracts.js';

class LabSoundSpy extends NullSound implements ISound {
  public uiCount = 0;
  public levelUpCount = 0;
  public errorCount = 0;

  public override playUi(): void { this.uiCount++; }
  public override playLevelUp(): void { this.levelUpCount++; }
  public override playError(): void { this.errorCount++; }
}

describe('In-Run Ouro Economy & Cranial Mutation Lab Rebalance Test Suite', () => {
  let soundSpy: LabSoundSpy;
  let teardownDom: () => void;

  beforeEach(() => {
    teardownDom = setupMockDom();
    soundSpy = new LabSoundSpy();
    Services.fx = new NullFx();
    Services.sound = soundSpy;
    Services.headless = true;

    MetaProgression.readBackend = () => null;
    MetaProgression.writeBackend = () => {};
    MetaProgression.deleteBackend = () => {};
    MetaProgression.instance = new MetaProgression();
  });

  afterEach(() => {
    teardownDom();
  });

  describe('1. Rebalanced Food Ouro / XP Drop Values', () => {
    const expectedFoodOuro: Record<string, number> = {
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

    it('verifies GameData.Foods defines calibrated Ouro/XP values for all 9 foods', () => {
      for (const [key, expectedVal] of Object.entries(expectedFoodOuro)) {
        const def = GameData.Foods.Get(key);
        expect(def).toBeDefined();
        expect(def?.Xp).toBe(expectedVal);
        expect(def?.xp).toBe(expectedVal);
      }
    });

    it('verifies FoodItem entities initialize with exact rebalanced XpValue', () => {
      for (const [type, expectedVal] of Object.entries(expectedFoodOuro)) {
        const food = new FoodItem(100, 100, type);
        expect(food.XpValue).toBe(expectedVal);
        expect(food.xpValue).toBe(expectedVal);
      }
    });

    it('verifies cooking an apple transforms into a golden apple with +4 Ouro', () => {
      const food = new FoodItem(50, 50, 'apple');
      expect(food.XpValue).toBe(1);
      const cooked = food.Cook();
      expect(cooked).toBe(true);
      expect(food.Type).toBe('golden');
      expect(food.XpValue).toBe(4);
      expect(food.xpValue).toBe(4);
    });

    it('verifies eating food increments player Ouro by exact calibrated amount', () => {
      const g = new GameEngine();
      g.chooseMode('rogue');
      g.selectedClass = 'emerald';
      g.startRun();

      const p = g.Player!;
      const combat = g.Combat!;
      const world = g.worldBag();

      for (const [type, expectedVal] of Object.entries(expectedFoodOuro)) {
        p.Ouro = 0;
        p.TotalOuroCollected = 0;
        p.XpToNext = 10000;

        const food = new FoodItem(p.X, p.Y, type);
        combat.eatFood(food, world);

        expect(p.Ouro).toBe(expectedVal);
        expect(p.TotalOuroCollected).toBe(expectedVal);
      }
    });
  });

  describe('2. Rebalanced Enemy Kill Ouro & Boss Defeat Rewards', () => {
    const expectedEnemyOuro: Record<string, number> = {
      swarmling: 1,
      scarab: 2,
      spitter: 3,
      phantom: 3,
      drone: 4,
      brute: 6,
    };

    it('verifies GameData.Enemies defines calibrated Ouro/XP values for all 6 hostile types', () => {
      for (const [key, expectedVal] of Object.entries(expectedEnemyOuro)) {
        const def = GameData.Enemies.Get(key);
        expect(def).toBeDefined();
        expect(def?.Xp).toBe(expectedVal);
        expect(def?.xp).toBe(expectedVal);
      }
    });

    it('verifies Enemy instances initialize with exact rebalanced XpValue', () => {
      for (const [type, expectedVal] of Object.entries(expectedEnemyOuro)) {
        const enemy = new Enemy(200, 200, type, 1);
        expect(enemy.XpValue).toBe(expectedVal);
        expect(enemy.xpValue).toBe(expectedVal);
      }
    });

    it('verifies slaying an enemy awards calibrated Ouro to player', () => {
      const g = new GameEngine();
      g.chooseMode('rogue');
      g.selectedClass = 'emerald';
      g.startRun();

      const p = g.Player!;
      const combat = g.Combat!;
      const world = g.worldBag();

      for (const [type, expectedVal] of Object.entries(expectedEnemyOuro)) {
        p.Ouro = 0;
        p.TotalOuroCollected = 0;
        p.XpToNext = 10000;

        const enemy = new Enemy(200, 200, type, 1);
        combat.handleEnemyKill(enemy, world);

        expect(p.Ouro).toBe(expectedVal);
        expect(p.TotalOuroCollected).toBe(expectedVal);
      }
    });

    it('verifies defeating a Boss awards +35 Ouro to player', () => {
      const g = new GameEngine();
      g.chooseMode('rogue');
      g.selectedClass = 'emerald';
      g.startRun();

      g.spawnBoss();
      expect(g.Boss).not.toBeNull();

      const p = g.Player!;
      p.Ouro = 0;
      p.TotalOuroCollected = 0;
      p.XpToNext = 10000;

      g.onBossDefeated();

      expect(p.Ouro).toBe(35);
      expect(p.TotalOuroCollected).toBe(35);
    });
  });

  describe('3. Rebalanced Cranial Mutation Lab Costs & Formulas', () => {
    it('verifies SnakeLabScreen static base cost constants are 30 (modules) and 40 (augments)', () => {
      expect(SnakeLabScreen.ModuleBaseCost).toBe(30);
      expect(SnakeLabScreen.HeadAugmentBaseCost).toBe(40);
    });

    it('calculates escalated upgrade costs with ModuleBaseCost=30 (+15/purchase) and HeadAugmentBaseCost=40 (+20/purchase)', () => {
      const p = new SnakePlayer('emerald', 1280, 720, 2);

      // 0 purchases: Lv1 module cost = 30 * 1 + 0 * 15 = 30 Ouro (1st weapon)
      expect(p.getHeadModuleCost('turret')).toBe(30);
      expect(p.GetHeadModuleCost('turret')).toBe(30);

      // 0 purchases: Lv1 augment cost = 40 * 1 + 0 * 20 = 40 Ouro
      expect(p.getHeadAugmentCost('fangs')).toBe(40);
      expect(p.GetHeadAugmentCost('fangs')).toBe(40);

      // Purchase #1: Install Turret (purchases becomes 1)
      p.installHeadModule('turret');
      expect(p.headPurchaseCount).toBe(1);

      // 1 purchase: Lv1 tesla cost = 30 * 1 + 1 * 15 = 45 Ouro (2nd weapon)
      expect(p.getHeadModuleCost('tesla')).toBe(45);

      // 1 purchase: Lv2 turret cost = 30 * 2 + 1 * 15 = 75 Ouro
      expect(p.getHeadModuleCost('turret')).toBe(75);

      // 1 purchase: Lv1 augment cost = 40 * 1 + 1 * 20 = 60 Ouro
      expect(p.getHeadAugmentCost('fangs')).toBe(60);

      // Purchase #2: Install Turret Lv2 (purchases becomes 2)
      p.installHeadModule('turret');
      expect(p.headPurchaseCount).toBe(2);

      // 2 purchases: Lv1 shield cost = 30 * 1 + 2 * 15 = 60 Ouro (3rd weapon)
      expect(p.getHeadModuleCost('shield')).toBe(60);

      // 2 purchases: Lv1 augment cost = 40 * 1 + 2 * 20 = 80 Ouro
      expect(p.getHeadAugmentCost('fangs')).toBe(80);

      // 2 purchases: Lv2 augment cost = 40 * 2 + 2 * 20 = 120 Ouro
      expect(p.getHeadAugmentCost('fangs', 2)).toBe(120);
    });

    it('enforces unaffordability visual states (disabled attribute, not-allowed cursor) and audio rejection when player lacks Ouro', () => {
      const g = new GameEngine();
      g.chooseMode('rogue');
      g.selectedClass = 'emerald';
      g.startRun();

      const p = g.Player!;
      p.XpToNext = 10000;
      p.Ouro = 15; // Less than base module cost 30 Ouro and base augment cost 40 Ouro
      p.TotalOuroCollected = 15;
      p.Xp = 15;

      const container = document.createElement('div');
      const uiRoot = UiRoot.init(container as any, g);
      const lab = new SnakeLabScreen(uiRoot);
      uiRoot.registerScreen(lab);
      lab.show();
      lab.refresh();

      // Module button is not disabled (to preserve browser click event dispatch) and has aria-disabled=true
      const buttons = lab.element.querySelectorAll('.lab-docked-card-container button.cyber-btn');
      const spitterBtn = Array.from(buttons).find(b => b.textContent.includes('Attack Spitter')) as HTMLButtonElement;
      expect(spitterBtn).toBeDefined();
      expect(spitterBtn.disabled).toBe(false);
      expect(spitterBtn.getAttribute('aria-disabled')).toBe('true');
      expect(spitterBtn.style.cursor).toBe('not-allowed');

      const initialErrorSounds = soundSpy.errorCount;
      const initialPurchases = p.HeadPurchaseCount;

      // Attempt click while unaffordable
      spitterBtn.click();
      expect(soundSpy.errorCount).toBe(initialErrorSounds + 1);
      expect(p.HeadPurchaseCount).toBe(initialPurchases);
      expect(p.GetHeadModuleLevel('turret')).toBe(0);
      expect(p.Ouro).toBe(15);

      // Now grant sufficient Ouro (e.g. 60 Ouro)
      p.Ouro = 60;
      p.Xp = 60;
      lab.refresh();

      const refreshedButtons = lab.element.querySelectorAll('.lab-docked-card-container button.cyber-btn');
      const refreshedSpitterBtn = Array.from(refreshedButtons).find(b => b.textContent.includes('Attack Spitter')) as HTMLButtonElement;
      expect(refreshedSpitterBtn).toBeDefined();
      expect(refreshedSpitterBtn.disabled).toBe(false);
      expect(refreshedSpitterBtn.getAttribute('aria-disabled')).toBe('false');
      expect(refreshedSpitterBtn.style.cursor).toBe('pointer');

      // Successful purchase deducts 30 Ouro (BaseModuleCost) and plays level up sound
      refreshedSpitterBtn.click();
      expect(soundSpy.levelUpCount).toBeGreaterThan(0);
      expect(p.GetHeadModuleLevel('turret')).toBe(1);
      expect(p.HeadPurchaseCount).toBe(1);
      expect(p.Ouro).toBe(30); // 60 - 30 = 30 Ouro

      // With 30 Ouro remaining and next module costing 45 Ouro (30 + 15), button becomes aria-disabled again
      lab.refresh();
      const updatedButtons = lab.element.querySelectorAll('.lab-docked-card-container button.cyber-btn');
      const teslaBtn = Array.from(updatedButtons).find(b => b.textContent.includes('Bio-Arc Coil')) as HTMLButtonElement;
      expect(teslaBtn).toBeDefined();
      expect(teslaBtn.textContent).toContain('45 Ouro');
      expect(teslaBtn.disabled).toBe(false);
      expect(teslaBtn.getAttribute('aria-disabled')).toBe('true');
      expect(teslaBtn.style.cursor).toBe('not-allowed');
    });

    it('verifies SnakePlayer AddOuro and addOuro helper aliases', () => {
      const p = new SnakePlayer('emerald', 1280, 720, 2);
      p.XpToNext = 10000;
      p.Ouro = 0;
      p.TotalOuroCollected = 0;

      expect(typeof (p as any).addOuro).toBe('function');
      expect(typeof (p as any).AddOuro).toBe('function');

      (p as any).addOuro(100);
      expect(p.Ouro).toBe(100);
      expect(p.TotalOuroCollected).toBe(100);

      (p as any).AddOuro(50);
      expect(p.Ouro).toBe(150);
      expect(p.TotalOuroCollected).toBe(150);
    });

    it('verifies wallet synchronization: spending in the lab decreases both lab Ouro chip and in-game HUD counter', () => {
      const g = new GameEngine();
      g.chooseMode('rogue');
      g.selectedClass = 'emerald';
      g.startRun();

      const p = g.Player!;
      p.Ouro = 100;
      p.TotalOuroCollected = 100;

      const container = document.createElement('div');
      const uiRoot = UiRoot.init(container as any, g);
      g.setUiRoot(uiRoot);

      const lab = new SnakeLabScreen(uiRoot);
      (g.meta ?? MetaProgression.Instance).UnlockTier('fangs', 1);
      MetaProgression.Instance.UnlockTier('fangs', 1);
      lab.show();
      lab.refresh();

      const hud = uiRoot.hudView;
      hud.refresh(g);

      // Verify initial synchronized balances (100 Ouro)
      const labOuroChip = lab.element.querySelector('.lab-stat-chip-ouro') as HTMLElement;
      const hudOuroVal = hud.element.querySelector('.hud-ouro-val, .hud-xp-val') as HTMLElement;
      expect(labOuroChip.textContent).toContain('🪙 100 Ouro');
      expect(hudOuroVal.textContent).toBe('100');

      // Purchase Attack Spitter (Base Module Cost = 30 Ouro)
      const buttons = lab.element.querySelectorAll('.lab-docked-card-container button.cyber-btn');
      const spitterBtn = Array.from(buttons).find(b => b.textContent.includes('Attack Spitter')) as HTMLButtonElement;
      expect(spitterBtn).toBeDefined();
      spitterBtn.click();

      // Verify wallet synchronization after purchase (100 - 30 = 70 Ouro)
      expect(p.Ouro).toBe(70);
      const updatedLabChip = lab.element.querySelector('.lab-stat-chip-ouro') as HTMLElement;
      const updatedHudVal = hud.element.querySelector('.hud-ouro-val, .hud-xp-val') as HTMLElement;
      expect(updatedLabChip.textContent).toContain('🪙 70 Ouro');
      expect(updatedHudVal.textContent).toBe('70');

      // Purchase Venom Fangs Cranial Augment (Augment Cost at 1 purchase = 40 * 1 + 1 * 20 = 60 Ouro)
      const updatedButtons = lab.element.querySelectorAll('.lab-docked-card-container button.cyber-btn');
      const fangsBtn = Array.from(updatedButtons).find(b => b.textContent.includes('Venom Fangs')) as HTMLButtonElement;
      expect(fangsBtn).toBeDefined();
      expect(fangsBtn.textContent).toContain('60 Ouro');
      fangsBtn.click();

      // Verify wallet synchronization after augment purchase (70 - 60 = 10 Ouro)
      expect(p.Ouro).toBe(10);
      const finalLabChip = lab.element.querySelector('.lab-stat-chip-ouro') as HTMLElement;
      const finalHudVal = hud.element.querySelector('.hud-ouro-val, .hud-xp-val') as HTMLElement;
      expect(finalLabChip.textContent).toContain('🪙 10 Ouro');
      expect(finalHudVal.textContent).toBe('10');
    });
  });
});
