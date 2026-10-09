import { describe, it, expect, beforeEach } from 'vitest';
import { UNIQUE_HELMETS, forgeOmniHelmet, CELESTIAL_OUROBOROS_HELMET } from '../data/UniqueHelmetsData';
import { SnakePlayer } from '../sim/SnakePlayer';
import { CombatSystem } from '../sim/CombatSystem';
import { FoodItem } from '../sim/FoodItem';
import { Enemy } from '../sim/Enemy';
import { Services } from '../core/Services';
import { NullFx, NullSound, IFx } from '../core/Contracts';

class FxTextSpy extends NullFx implements IFx {
  public textPrompts: Array<{ text: string; color: string; x: number; y: number }> = [];

  public override addText(x: number, y: number, text: string, color: string = '#ffffff', _size: number = 14, _floating: boolean = true): void {
    this.textPrompts.push({ x, y, text, color });
  }
  public override AddText(x: number, y: number, text: string, color: string = '#ffffff', _size: number = 14, _floating: boolean = true): void {
    this.textPrompts.push({ x, y, text, color });
  }
}

describe('Unique Helmet Active Capacities & Gold-Brown Visual Theme (TDD)', () => {
  let fxSpy: FxTextSpy;

  beforeEach(() => {
    fxSpy = new FxTextSpy();
    Services.fx = fxSpy;
    Services.sound = new NullSound();
    Services.headless = true;
  });

  describe('1. Gold-Brown Visual Theme & Capacity Metadata in UniqueHelmetsData', () => {
    it('all 8 Unique Helmets define the gold-brown color scheme metadata', () => {
      expect(UNIQUE_HELMETS.length).toBe(8);

      for (const helm of UNIQUE_HELMETS) {
        expect(helm.color ?? helm.Color).toBe('#d4af37');
        expect(helm.glowColor ?? helm.GlowColor).toBe('#b8860b');
        expect(helm.borderColor ?? helm.BorderColor).toBe('#8c6239');
      }
    });

    it('Maw of the Behemoth / Abyssal Titan defines Titan Gorging capacity', () => {
      const titan = UNIQUE_HELMETS.find(h => h.Id === 'unique_helm_abyssal_leviathan' || h.id === 'unique_helm_abyssal_leviathan');
      expect(titan).toBeDefined();
      const cap = titan!.specialCapacity ?? titan!.SpecialCapacity;
      expect(cap).toContain('Titan Gorging: Eating food temporarily doubles head size and bite radius (2x HeadRadius) for 3.0 seconds.');
    });

    it('Carapace of the Nanite Hivequeen defines Harvest Feast capacity', () => {
      const hivequeen = UNIQUE_HELMETS.find(h => h.Id === 'unique_helm_nanite_hivequeen' || h.id === 'unique_helm_nanite_hivequeen');
      expect(hivequeen).toBeDefined();
      const cap = hivequeen!.specialCapacity ?? hivequeen!.SpecialCapacity;
      expect(cap).toContain('Harvest Feast: Defeated enemies burst into 2-3 juicy apples.');
    });

    it('9th Omni-Helmet defines gold-brown theme and combines both Titan Gorging and Harvest Feast', () => {
      const omni = forgeOmniHelmet();
      expect(omni.color ?? omni.Color).toBe('#d4af37');
      expect(omni.glowColor ?? omni.GlowColor).toBe('#b8860b');
      expect(omni.borderColor ?? omni.BorderColor).toBe('#8c6239');

      const cap = omni.specialCapacity ?? omni.SpecialCapacity;
      expect(cap).toContain('Titan Gorging');
      expect(cap).toContain('Harvest Feast');

      // Also static singleton CELESTIAL_OUROBOROS_HELMET
      expect(CELESTIAL_OUROBOROS_HELMET.color ?? CELESTIAL_OUROBOROS_HELMET.Color).toBe('#d4af37');
      const staticCap = CELESTIAL_OUROBOROS_HELMET.specialCapacity ?? CELESTIAL_OUROBOROS_HELMET.SpecialCapacity;
      expect(staticCap).toContain('Titan Gorging');
      expect(staticCap).toContain('Harvest Feast');
    });
  });

  describe('2. SnakePlayer Simulation: Titan Gorging Head Size Multiplier & Timer', () => {
    it('initializes with HeadRadiusMultiplier 1.0 and TitanGorgingTimer 0', () => {
      const player = new SnakePlayer('emerald', 1000, 1000, 3);
      expect(player.HeadRadiusMultiplier).toBe(1.0);
      expect(player.TitanGorgingTimer).toBe(0);
      expect(player.headRadius).toBe(player.HeadRadius);
    });

    it('triggerTitanGorging sets multiplier to 2.0 and timer to duration', () => {
      const player = new SnakePlayer('emerald', 1000, 1000, 3);
      const baseR = player.HeadRadius;
      player.triggerTitanGorging(3.0);

      expect(player.HeadRadiusMultiplier).toBe(2.0);
      expect(player.TitanGorgingTimer).toBe(3.0);
      expect(player.headRadius).toBe(baseR * 2.0);

      const biteHeads = player.BiteHeads();
      expect(biteHeads[0].R).toBe(baseR * 2.0);
      expect(biteHeads[0].r).toBe(baseR * 2.0);
    });

    it('Update(dt) counts down TitanGorgingTimer and resets multiplier to 1.0 upon expiration', () => {
      const player = new SnakePlayer('emerald', 1000, 1000, 3);
      const baseR = player.HeadRadius;
      player.triggerTitanGorging(3.0);

      // Advance 1.5 seconds
      player.Update(1.5, { Active: false }, 2000, 2000, null as any);
      expect(player.TitanGorgingTimer).toBeCloseTo(1.5, 3);
      expect(player.HeadRadiusMultiplier).toBe(2.0);
      expect(player.headRadius).toBe(baseR * 2.0);

      // Advance remaining 1.6 seconds (timer expires)
      player.Update(1.6, { Active: false }, 2000, 2000, null as any);
      expect(player.TitanGorgingTimer).toBe(0);
      expect(player.HeadRadiusMultiplier).toBe(1.0);
      expect(player.headRadius).toBe(baseR);

      const biteHeads = player.BiteHeads();
      expect(biteHeads[0].R).toBe(baseR);
    });
  });

  describe('3. CombatSystem: Titan Gorging Trigger upon Eating Food', () => {
    it('activates Titan Gorging and displays visual feedback text when wearing Maw of the Behemoth', () => {
      const combat = new CombatSystem();
      const player = new SnakePlayer('emerald', 500, 500, 3);
      const titanHelm = UNIQUE_HELMETS.find(h => h.Id === 'unique_helm_abyssal_leviathan' || h.id === 'unique_helm_abyssal_leviathan')!;
      player.equippedHelmet = titanHelm;

      const world = {
        player,
        Player: player,
        foods: [],
        Foods: [],
        enemies: [],
        Enemies: [],
      } as any;

      const food = new FoodItem(500, 500, 'apple');
      expect(player.HeadRadiusMultiplier).toBe(1.0);

      combat.eatFood(food, world);

      expect(player.HeadRadiusMultiplier).toBe(2.0);
      expect(player.TitanGorgingTimer).toBe(3.0);
      expect(player.headRadius).toBe(player.HeadRadius * 2.0);

      // Verify FX floating text
      const titanFx = fxSpy.textPrompts.find(p => p.text.includes('TITAN GORGING! 2X SIZE'));
      expect(titanFx).toBeDefined();
      expect(titanFx!.color).toBe('#ffd166');
    });

    it('does NOT activate Titan Gorging when wearing a helmet without that capacity', () => {
      const combat = new CombatSystem();
      const player = new SnakePlayer('emerald', 500, 500, 3);
      const standardHelm = UNIQUE_HELMETS.find(h => h.Id === 'unique_helm_adamantine_juggernaut')!;
      player.equippedHelmet = standardHelm;

      const world = {
        player,
        Player: player,
        foods: [],
        Foods: [],
        enemies: [],
        Enemies: [],
      } as any;

      const food = new FoodItem(500, 500, 'apple');
      combat.eatFood(food, world);

      expect(player.HeadRadiusMultiplier).toBe(1.0);
      expect(player.TitanGorgingTimer).toBe(0);
      const titanFx = fxSpy.textPrompts.find(p => p.text.includes('TITAN GORGING'));
      expect(titanFx).toBeUndefined();
    });
  });

  describe('4. CombatSystem: Harvest Feast Extra Apples upon Enemy Defeat', () => {
    it('spawns 2 to 3 extra apples when player equips Nanite Hivequeen helmet', () => {
      const combat = new CombatSystem();
      const player = new SnakePlayer('emerald', 500, 500, 3);
      const hivequeen = UNIQUE_HELMETS.find(h => h.Id === 'unique_helm_nanite_hivequeen' || h.id === 'unique_helm_nanite_hivequeen')!;
      player.equippedHelmet = hivequeen;

      const droppedFoods: FoodItem[] = [];
      const world = {
        player,
        Player: player,
        foods: droppedFoods,
        Foods: droppedFoods,
        enemies: [],
        Enemies: [],
      } as any;

      const enemy = new Enemy(300, 300, 'scarab', 1);
      combat.handleEnemyKill(enemy, world);

      // Standard kill drops 1 food (golden or apple) + optional soul/shard, plus Harvest Feast drops 2-3 extra apples
      const apples = droppedFoods.filter(f => f.type === 'apple');
      // At least 2 extra apples must be present from Harvest Feast
      expect(apples.length).toBeGreaterThanOrEqual(2);
      expect(droppedFoods.length).toBeGreaterThanOrEqual(3);
    });

    it('does NOT spawn Harvest Feast extra apples without Nanite Hivequeen equipped', () => {
      const combat = new CombatSystem();
      const player = new SnakePlayer('emerald', 500, 500, 3);
      player.equippedHelmet = null;

      const droppedFoods: FoodItem[] = [];
      const world = {
        player,
        Player: player,
        foods: droppedFoods,
        Foods: droppedFoods,
        enemies: [],
        Enemies: [],
      } as any;

      const enemy = new Enemy(300, 300, 'scarab', 1);
      combat.handleEnemyKill(enemy, world);

      // Without Hivequeen, only 1 primary drop (+ optional soul/shard)
      // Total dropped items should be at most 2 (1 standard + 0-1 relic/shard)
      expect(droppedFoods.length).toBeLessThanOrEqual(2);
    });
  });

  describe('5. 9th Omni-Helmet: Combines Both Titan Gorging and Harvest Feast Capacities', () => {
    it('executes both Titan Gorging on food eat AND Harvest Feast on enemy kill', () => {
      const combat = new CombatSystem();
      const player = new SnakePlayer('emerald', 500, 500, 3);
      const omni = forgeOmniHelmet();
      player.equippedHelmet = omni;

      const droppedFoods: FoodItem[] = [];
      const world = {
        player,
        Player: player,
        foods: droppedFoods,
        Foods: droppedFoods,
        enemies: [],
        Enemies: [],
      } as any;

      // 1. Food consumption triggers Titan Gorging
      const food = new FoodItem(500, 500, 'apple');
      combat.eatFood(food, world);
      expect(player.HeadRadiusMultiplier).toBe(2.0);
      expect(player.TitanGorgingTimer).toBe(3.0);
      expect(player.headRadius).toBe(player.HeadRadius * 2.0);

      // 2. Enemy defeat triggers Harvest Feast extra apples
      const enemy = new Enemy(300, 300, 'scarab', 1);
      combat.handleEnemyKill(enemy, world);
      const apples = droppedFoods.filter(f => f.type === 'apple');
      expect(apples.length).toBeGreaterThanOrEqual(2);
    });
  });
});
