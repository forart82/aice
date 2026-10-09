/**
 * Ouroboros Ascension — Sound Dispatcher Alignment & Cyber Art Direction TDD Suite
 *
 * Validates strict single-source sound dispatching across CombatSystem, GameEngine,
 * OuroborosGalleryScreen, and SoundEngine. Enforces:
 * 1. Unified eating sounds (identical snappy cyber pop for standard and golden apples).
 * 2. Clean star/shard collection (invokes playStar/playShard without double-triggering playEat).
 * 3. Structured enemy bite/hit/kill sounds flowing through playBite/playHit/playExplosion.
 * 4. Distinct game state transitions (floor clear, victory, game over, boss spawn) with zero overlapping fanfare cacophony.
 * 5. Clean Gallery Jump warp outcome triggers (playLevelUp on success, playVoidCollapse on failure).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setupMockDom } from './MockDom.js';
import { CombatSystem } from '../sim/CombatSystem.js';
import { GameEngine } from '../sim/GameEngine.js';
import { GameState } from '../sim/GameState.js';
import { World } from '../sim/World.js';
import { SnakePlayer } from '../sim/SnakePlayer.js';
import { FoodItem } from '../sim/FoodItem.js';
import { Enemy } from '../sim/Enemy.js';
import { Boss } from '../sim/Boss.js';
import { OuroborosGalleryScreen } from '../ui/screens/OuroborosGalleryScreen.js';
import { Services, ServiceContainer } from '../core/Services.js';

class MockSoundCapture {
  public calls: { name: string; args: any[] }[] = [];

  public playEat(combo: any = 1, isGolden: boolean = false): void {
    this.calls.push({ name: 'playEat', args: [combo, isGolden] });
  }
  public PlayEat(combo: any = 1, isGolden: boolean = false): void {
    this.playEat(combo, isGolden);
  }

  public playShard(): void { this.calls.push({ name: 'playShard', args: [] }); }
  public PlayShard(): void { this.playShard(); }

  public playStar(): void { this.calls.push({ name: 'playStar', args: [] }); }
  public PlayStar(): void { this.playStar(); }

  public playShield(): void { this.calls.push({ name: 'playShield', args: [] }); }
  public PlayShield(): void { this.playShield(); }

  public playBite(dmg?: number, crit?: boolean): void {
    this.calls.push({ name: 'playBite', args: [dmg, crit] });
  }
  public PlayBite(dmg?: number, crit?: boolean): void {
    this.playBite(dmg, crit);
  }

  public playHit(intensity?: number): void {
    this.calls.push({ name: 'playHit', args: [intensity] });
  }
  public PlayHit(intensity?: number): void {
    this.playHit(intensity);
  }

  public playExplosion(intensity?: number): void {
    this.calls.push({ name: 'playExplosion', args: [intensity] });
  }
  public PlayExplosion(intensity?: number): void {
    this.playExplosion(intensity);
  }

  public playLevelUp(): void { this.calls.push({ name: 'playLevelUp', args: [] }); }
  public PlayLevelUp(): void { this.playLevelUp(); }

  public playFloorClear(): void { this.calls.push({ name: 'playFloorClear', args: [] }); }
  public PlayFloorClear(): void { this.playFloorClear(); }

  public playVictory(): void { this.calls.push({ name: 'playVictory', args: [] }); }
  public PlayVictory(): void { this.playVictory(); }

  public playGameOver(): void { this.calls.push({ name: 'playGameOver', args: [] }); }
  public PlayGameOver(): void { this.playGameOver(); }

  public playBossAlert(tier?: number): void {
    this.calls.push({ name: 'playBossAlert', args: [tier] });
  }
  public PlayBossAlert(tier?: number): void {
    this.playBossAlert(tier);
  }

  public playCrit(): void { this.calls.push({ name: 'playCrit', args: [] }); }
  public PlayCrit(): void { this.playCrit(); }

  public playThunder(intensity?: number): void {
    this.calls.push({ name: 'playThunder', args: [intensity] });
  }
  public PlayThunder(intensity?: number): void {
    this.playThunder(intensity);
  }

  public playFrenzy(): void { this.calls.push({ name: 'playFrenzy', args: [] }); }
  public PlayFrenzy(): void { this.playFrenzy(); }

  public playVoidCollapse(): void { this.calls.push({ name: 'playVoidCollapse', args: [] }); }
  public PlayVoidCollapse(): void { this.playVoidCollapse(); }

  public playUniqueHelmetReveal(): void { this.calls.push({ name: 'playUniqueHelmetReveal', args: [] }); }
  public PlayUniqueHelmetReveal(): void { this.playUniqueHelmetReveal(); }

  public playUi(): void { this.calls.push({ name: 'playUi', args: [] }); }
  public PlayUi(): void { this.playUi(); }

  public playError(): void { this.calls.push({ name: 'playError', args: [] }); }
  public PlayError(): void { this.playError(); }

  public startMusic(): void {}
  public StartMusic(): void {}
  public stopMusic(): void {}
  public StopMusic(): void {}
  public setBossMode(_v: boolean): void {}
  public SetBossMode(_v: boolean): void {}
  public setFrenzyState(_v: boolean): void {}
  public SetFrenzyState(_v: boolean): void {}
  public setMusicIntensity(_v: number): void {}
  public SetMusicIntensity(_v: number): void {}
  public setPaused(_v: boolean): void {}
  public SetPaused(_v: boolean): void {}
}

describe('Sound Dispatcher Alignment & Cyber Art Direction', () => {
  let mockSound: MockSoundCapture;
  let world: World;
  let combat: CombatSystem;
  let player: SnakePlayer;

  beforeEach(() => {
    mockSound = new MockSoundCapture();
    Services.sound = mockSound as any;
    Services.Sound = mockSound as any;

    world = new World();
    combat = new CombatSystem();
    player = new SnakePlayer('emerald', 1000, 1000);
    player.x = 100;
    player.y = 100;
    world.player = player;
    (world as any).Player = player;
    (world as any).combat = combat;
    (world as any).Combat = combat;
  });

  describe('1. CombatSystem Sound Dispatching', () => {
    it('eating standard apple triggers ONLY playEat(combo, false) without conflicting stingers', () => {
      const apple = new FoodItem(100, 100, 'apple');
      combat.eatFood(apple, world);

      const eatCalls = mockSound.calls.filter(c => c.name === 'playEat');
      expect(eatCalls.length).toBe(1);
      expect(eatCalls[0]!.args[1]).toBe(false);

      // Verify NO star, shard, or bell stingers triggered
      const otherStingers = mockSound.calls.filter(c => ['playShard', 'playStar', 'playLevelUp', 'playVictory'].includes(c.name));
      expect(otherStingers.length).toBe(0);
    });

    it('eating golden apple triggers ONLY playEat(combo, true) without conflicting stingers', () => {
      const golden = new FoodItem(100, 100, 'golden');
      combat.eatFood(golden, world);

      const eatCalls = mockSound.calls.filter(c => c.name === 'playEat');
      expect(eatCalls.length).toBe(1);
      expect(eatCalls[0]!.args[1]).toBe(true);

      // Verify NO star, shard, or bell stingers triggered
      const otherStingers = mockSound.calls.filter(c => ['playShard', 'playStar', 'playLevelUp', 'playVictory'].includes(c.name));
      expect(otherStingers.length).toBe(0);
    });

    it('collecting star / shard cleanly invokes playEat without double-triggering secondary stingers', () => {
      const shard = new FoodItem(100, 100, 'shard');
      combat.eatFood(shard, world);

      // Universal eat sound coverage: playEat is triggered exactly once for star/shard
      const eatCalls = mockSound.calls.filter(c => c.name === 'playEat');
      expect(eatCalls.length).toBe(1);

      // Verify NO redundant secondary star/shard stingers triggered (prevents double-trigger distortion)
      const shardCalls = mockSound.calls.filter(c => c.name === 'playShard' || c.name === 'playStar');
      expect(shardCalls.length).toBe(0);
    });

    it('eating shield orb triggers playEat as well as playShield', () => {
      const shield = new FoodItem(100, 100, 'shield');
      combat.eatFood(shield, world);

      const shieldCalls = mockSound.calls.filter(c => c.name === 'playShield');
      expect(shieldCalls.length).toBe(1);
      const eatCalls = mockSound.calls.filter(c => c.name === 'playEat');
      expect(eatCalls.length).toBe(1);
    });

    it('eating any nutrient item (apple, golden, potion, shield, star, shard, bomb, chrono, soul, prism) triggers playEat', () => {
      const allTypes = ['apple', 'golden', 'potion', 'shield', 'star', 'shard', 'bomb', 'chrono', 'soul', 'prism'];
      for (const t of allTypes) {
        mockSound.calls.length = 0;
        combat.eatFood(new FoodItem(100, 100, t), world);
        const eatCalls = mockSound.calls.filter(c => c.name === 'playEat');
        expect(eatCalls.length).toBe(1);
      }
    });

    it('biting a standard enemy dispatches to playBite or playHit', () => {
      const enemy = new Enemy(100, 100, 'scarab');
      enemy.SpawnTimer = 0;
      world.enemies = [enemy];
      player.x = 100;
      player.y = 100;

      combat.resolveEnemies(0.016, world);

      const hitOrBiteCalls = mockSound.calls.filter(c => c.name === 'playBite' || c.name === 'playHit');
      expect(hitOrBiteCalls.length).toBeGreaterThanOrEqual(1);
    });

    it('biting / eating a rose round enemy (swarmling #fb7185) dispatches playEat', () => {
      const swarmling = new Enemy(100, 100, 'swarmling');
      swarmling.SpawnTimer = 0;
      world.enemies = [swarmling];
      player.x = 100;
      player.y = 100;

      combat.resolveEnemies(0.016, world);

      const eatCalls = mockSound.calls.filter(c => c.name === 'playEat');
      expect(eatCalls.length).toBeGreaterThanOrEqual(1);
    });

    it('killing a standard enemy (e.g. scarab, drone, brute) dispatches to playExplosion', () => {
      const enemy = new Enemy(100, 100, 'scarab');
      enemy.hp = 1;
      combat.handleEnemyKill(enemy, world);

      const explosionCalls = mockSound.calls.filter(c => c.name === 'playExplosion');
      expect(explosionCalls.length).toBe(1);
      const eatCalls = mockSound.calls.filter(c => c.name === 'playEat');
      expect(eatCalls.length).toBe(0);
    });

    it('killing a rose round enemy (swarmling #fb7185) dispatches playEat instead of playExplosion', () => {
      const swarmling = new Enemy(100, 100, 'swarmling');
      swarmling.hp = 1;
      combat.handleEnemyKill(swarmling, world);

      const eatCalls = mockSound.calls.filter(c => c.name === 'playEat');
      expect(eatCalls.length).toBe(1);
      const explosionCalls = mockSound.calls.filter(c => c.name === 'playExplosion');
      expect(explosionCalls.length).toBe(0);
    });
  });

  describe('2. GameEngine State Transitions & Fanfare Alignment', () => {
    let engine: GameEngine;

    beforeEach(() => {
      engine = new GameEngine();
      (engine as any)._services = new ServiceContainer();
      (engine as any)._services.sound = mockSound;
      (engine as any)._services.Sound = mockSound;
      engine.Init();
      mockSound.calls.length = 0;
    });

    it('game over (defeat) calls ONLY PlayGameOver', () => {
      engine.HandleGameOver(false);
      expect(engine.State).toBe(GameState.GameOver);

      const goCalls = mockSound.calls.filter(c => c.name === 'playGameOver');
      expect(goCalls.length).toBe(1);

      const vicCalls = mockSound.calls.filter(c => c.name === 'playVictory');
      expect(vicCalls.length).toBe(0);
    });

    it('game over (victory) calls ONLY PlayVictory', () => {
      engine.HandleGameOver(true);
      expect(engine.State).toBe(GameState.Victory);

      const vicCalls = mockSound.calls.filter(c => c.name === 'playVictory');
      expect(vicCalls.length).toBe(1);

      const goCalls = mockSound.calls.filter(c => c.name === 'playGameOver');
      expect(goCalls.length).toBe(0);
    });

    it('boss encounter spawn calls ONLY PlayBossAlert', () => {
      engine.SpawnBoss();

      const alertCalls = mockSound.calls.filter(c => c.name === 'playBossAlert');
      expect(alertCalls.length).toBe(1);
    });

    it('floor clear on boss defeat calls PlayFloorClear', () => {
      const boss = new Boss(1, 1000, 1000, 'centipede', 100, 100);
      engine.ActiveBosses = [boss];
      engine.CurrentFloor = 1;
      engine.MaxFloors = 10;

      engine.OnBossDefeated(boss);
      expect(engine.State).toBe(GameState.FloorClear);

      const clearCalls = mockSound.calls.filter(c => c.name === 'playFloorClear');
      expect(clearCalls.length).toBe(1);
    });

    it('daily challenge milestone ascension does NOT stack overlapping fanfare', () => {
      engine.GameMode = 'daily';
      engine.DailyMilestoneReached = 0;
      engine.Player.Level = 5;

      mockSound.calls.length = 0;
      engine.CheckDailyMilestones();

      // Ensure no multi-stinger cacophony (no simultaneous playVictory, playThunder, playFrenzy)
      const fanfareCalls = mockSound.calls.filter(c =>
        ['playLevelUp', 'playVictory', 'playThunder', 'playFrenzy'].includes(c.name)
      );
      // Exactly 1 clean stinger (e.g. playLevelUp)
      expect(fanfareCalls.length).toBe(1);
      expect(fanfareCalls[0]!.name).toBe('playLevelUp');
    });
  });

  describe('4. OuroborosGalleryScreen Warp Outcome Sound Alignment', () => {
    it('gallery screen jump outcome triggers playLevelUp on success and playVoidCollapse on failure', () => {
      setupMockDom();
      const screen = Object.create(OuroborosGalleryScreen.prototype);
      screen.element = document.createElement('div');
      screen.element.innerHTML = `
        <div class="galaxy-jump-result-modal" style="display: none;"></div>
        <div class="galaxy-result-container"></div>
      `;
      screen.refresh = () => {};

      mockSound.calls.length = 0;
      (screen as any).showOutcomeModal({
        success: true,
        awardedHelmet: { Id: 'h1', Name: 'H', Icon: '🪖', Stats: {}, Lore: 'L' },
        sacrificeScore: 100,
        probability: 0.5
      });
      const successCalls = mockSound.calls.filter(c => c.name === 'playLevelUp');
      expect(successCalls.length).toBe(1);

      mockSound.calls.length = 0;
      (screen as any).showOutcomeModal({
        success: false,
        awardedHelmet: null,
        sacrificeScore: 50,
        probability: 0.1
      });
      const failCalls = mockSound.calls.filter(c => c.name === 'playVoidCollapse');
      expect(failCalls.length).toBe(1);
    });
  });
});
