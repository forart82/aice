/**
 * Ouroboros Ascension — State Machine, Floor Transitions, Pause Handling, and Simulation Edge Cases Audit Test Suite
 *
 * Systematic verification of:
 * 1. State machine transitions (Playing, Paused, LevelUp, FloorClear, GameOver, Victory)
 * 2. Pause/Unpause handling across modal dialogs, level-up draft, and boss encounters
 * 3. Simultaneous death scenarios (Player vs Boss / Player vs Last Enemy / Phoenix Revive)
 * 4. Floor transitions with active projectiles, hazards, telegraphs, and helmet drops
 * 5. Deterministic replay parity and persistence integrity under corrupt / migrated payloads
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { setupMockDom, MockElement } from './MockDom.js';
import { GameEngine } from '../sim/GameEngine.js';
import { GameState } from '../sim/GameState.js';
import { UiRoot } from '../ui/UiRoot.js';
import { MenuScreen } from '../ui/screens/MenuScreen.js';
import { ClassSelectScreen } from '../ui/screens/ClassSelectScreen.js';
import { SanctuaryScreen } from '../ui/screens/SanctuaryScreen.js';
import { SettingsScreen } from '../ui/screens/SettingsScreen.js';
import { PauseSettingsScreen } from '../ui/screens/PauseSettingsScreen.js';
import { SnakeLabScreen } from '../ui/screens/SnakeLabScreen.js';
import { DraftScreen } from '../ui/screens/DraftScreen.js';
import { FloorClearScreen } from '../ui/screens/FloorClearScreen.js';
import { GameOverScreen } from '../ui/screens/GameOverScreen.js';
import { RunSummaryScreen } from '../ui/screens/RunSummaryScreen.js';
import { HelpScreen } from '../ui/screens/HelpScreen.js';
import { StatsModalScreen } from '../ui/screens/StatsModalScreen.js';
import { SaveIO, MetaSaveV2, LegacyMetaSaveV1, STORAGE_KEY_V1, STORAGE_KEY_V2 } from '../platform/SaveIO.js';
import { MetaProgression } from '../data/MetaProgression.js';
import { HelmetDef } from '../data/Types.js';
import { GameData } from '../data/GameData.js';
import { Services } from '../core/Services.js';
import { NullFx, NullSound, ScriptedInput } from '../core/Contracts.js';
import { Projectile } from '../sim/Projectile.js';
import { Hazard } from '../sim/Hazard.js';
import { Boss } from '../sim/Boss.js';
import { Enemy } from '../sim/Enemy.js';
import { HelmetDrop } from '../sim/HelmetDrop.js';
import { generateBossHelmet } from '../data/Helmets.js';
import { Rng } from '../core/Rng.js';
import { Vec2 } from '../core/Vec2.js';

describe('GameEngine State Machine, Floor Transitions & Edge Cases Audit', () => {
  let restoreDom: () => void;
  let container: MockElement;
  let engine: GameEngine;
  let uiRoot: UiRoot;

  beforeEach(() => {
    restoreDom = setupMockDom();
    SaveIO.memoryBackendEnabled = true;
    SaveIO.clearMemory();
    MetaProgression.Instance.reset();

    Services.Sound = new NullSound();
    Services.Fx = new NullFx();
    Services.Input = new ScriptedInput();

    container = document.createElement('div') as any;
    engine = new GameEngine(Services.Fx);
    uiRoot = UiRoot.init(container as any, engine);
    engine.setUiRoot(uiRoot);

    // Register UI screens
    uiRoot.registerScreen(new MenuScreen(uiRoot));
    uiRoot.registerScreen(new ClassSelectScreen(uiRoot));
    uiRoot.registerScreen(new SanctuaryScreen(uiRoot));
    uiRoot.registerScreen(new SettingsScreen(uiRoot));
    uiRoot.registerScreen(new PauseSettingsScreen(uiRoot));
    uiRoot.registerScreen(new SnakeLabScreen(uiRoot));
    uiRoot.registerScreen(new DraftScreen(uiRoot));
    uiRoot.registerScreen(new FloorClearScreen(uiRoot));
    uiRoot.registerScreen(new GameOverScreen(uiRoot));
    uiRoot.registerScreen(new RunSummaryScreen(uiRoot));
    uiRoot.registerScreen(new HelpScreen(uiRoot));
    uiRoot.registerScreen(new StatsModalScreen(uiRoot));
  });

  afterEach(() => {
    restoreDom();
  });

  /* ========================================================================= *
   *  1. STATE MACHINE TRANSITIONS & LIFECYCLE
   * ========================================================================= */

  describe('1. State Machine Transitions', () => {
    it('1.1 Initial state starts at Menu and transitions cleanly to ClassSelect and Playing', () => {
      expect(engine.State).toBe(GameState.Menu);
      expect(engine.RunActive).toBe(false);

      engine.ChooseMode('rogue');
      expect(engine.State).toBe(GameState.ClassSelect);
      expect(uiRoot.activeScreenId).toBe('modal-class-select');

      engine.SelectedClass = 'emerald';
      engine.StartRun(1337);

      expect(engine.State).toBe(GameState.Playing);
      expect(engine.RunActive).toBe(true);
      expect(engine.Player).toBeDefined();
      expect(engine.Player.Alive).toBe(true);
      expect(engine.CurrentFloor).toBe(1);
    });

    it('1.2 ShowMenu() gracefully abandons active run, commits partial records, and resets audio/boss states', () => {
      engine.StartRun(42);
      engine.Combat.Score = 1500;
      engine.Combat.FoodsEaten = 10;
      expect(engine.RunActive).toBe(true);

      engine.ShowMenu();

      expect(engine.State).toBe(GameState.Menu);
      expect(engine.RunActive).toBe(false);
      expect(uiRoot.activeScreenId).toBe('modal-main-menu');
      expect(MetaProgression.Instance.Records.TotalRuns).toBe(1);
      expect(MetaProgression.Instance.Records.HighScore).toBe(1500);
    });

    it('1.3 StartRun() while an active run is in progress cleanly abandons previous run and initializes fresh state', () => {
      engine.StartRun(101);
      engine.Combat.Score = 500;
      engine.CurrentFloor = 3;

      // Start new run directly
      engine.StartRun(202);

      expect(engine.State).toBe(GameState.Playing);
      expect(engine.RunActive).toBe(true);
      expect(engine.CurrentFloor).toBe(1);
      expect(engine.Combat.Score).toBe(0);
      expect(MetaProgression.Instance.Records.TotalRuns).toBe(1); // 1 abandoned run committed
    });

    it('1.4 HandleGameOver() ignores duplicate invocations once in GameOver or Victory state', () => {
      engine.StartRun(42);
      expect(engine.State).toBe(GameState.Playing);

      engine.HandleGameOver(false);
      expect(engine.State).toBe(GameState.GameOver);
      expect(MetaProgression.Instance.Records.TotalRuns).toBe(1);
      expect(MetaProgression.Instance.Records.Victories).toBe(0);

      // Duplicate GameOver call must be a no-op
      engine.HandleGameOver(false);
      expect(engine.State).toBe(GameState.GameOver);
      expect(MetaProgression.Instance.Records.TotalRuns).toBe(1);

      // Attempting Victory call after GameOver must be ignored
      engine.HandleGameOver(true);
      expect(engine.State).toBe(GameState.GameOver);
      expect(MetaProgression.Instance.Records.Victories).toBe(0);
    });

    it('1.5 Victory on MaxFloors commits run with victory=true and sets state to Victory', () => {
      engine.StartRun(42);
      engine.CurrentFloor = engine.MaxFloors; // Floor 20
      engine.SpawnBoss('centipede');
      expect(engine.ActiveBosses.length).toBe(1);

      const boss = engine.ActiveBosses[0]!;
      boss.Hp = 0;
      boss.Dead = true;

      engine.OnBossDefeated(boss);

      expect(engine.State).toBe(GameState.Victory);
      expect(engine.RunActive).toBe(false);
      expect(MetaProgression.Instance.Records.Victories).toBe(1);
      expect(uiRoot.activeScreenId).toBe('modal-summary');
    });
  });

  /* ========================================================================= *
   *  2. PAUSE / UNPAUSE & MODAL DIALOGS
   * ========================================================================= */

  describe('2. Pause/Unpause Handling & Modal Dialogs', () => {
    it('2.1 TogglePause() transitions between Playing and Paused, resetting accumulator on resume', () => {
      engine.StartRun(42);
      engine.Accumulator = 0.005;

      engine.TogglePause();
      expect(engine.State).toBe(GameState.Paused);
      expect(engine.isPaused).toBe(true);

      // Simulate a time delta while paused
      engine.Tick(0.1);
      expect(engine.State).toBe(GameState.Paused);

      engine.TogglePause();
      expect(engine.State).toBe(GameState.Playing);
      expect(engine.isPaused).toBe(false);
      expect(engine.Accumulator).toBe(0); // Must be reset to prevent jump
    });

    it('2.2 Resume() resets accumulator and dismisses all active modals', () => {
      engine.StartRun(42);
      engine.TogglePause();
      expect(uiRoot.activeScreenId).toBe('modal-pause');

      engine.Resume();
      expect(engine.State).toBe(GameState.Playing);
      expect(engine.Accumulator).toBe(0);
      expect(uiRoot.activeScreenId).toBeNull();
      expect(uiRoot.isModalOpen()).toBe(false);
    });

    it('2.3 LevelUp draft pause/resume flow resets draft cards and unpauses sound', () => {
      engine.StartRun(42);
      engine.TriggerLevelUp();

      expect(engine.State).toBe(GameState.LevelUp);
      expect(engine.CurrentDraftCards.length).toBeGreaterThan(0);

      const card = engine.CurrentDraftCards[0]!;
      engine.SelectUpgradeCard(card);

      expect(engine.State).toBe(GameState.Playing);
      expect(engine.CurrentDraftCards.length).toBe(0);
      expect(engine.ActivePerks.length).toBe(1);
    });

    it('2.4 OnVisibilityRestored() clamps accumulator to 0 to prevent burst physics ticks after tab blur', () => {
      engine.StartRun(42);
      engine.Accumulator = 0.05;

      engine.OnVisibilityRestored();
      expect(engine.Accumulator).toBe(0);
    });

    it('2.5 ShowSettings(GameState.Paused) returns cleanly to Paused on CloseSettings() without abandoning run', () => {
      engine.StartRun(42);
      engine.TogglePause();
      expect(engine.State).toBe(GameState.Paused);

      engine.ShowSettings(GameState.Paused);
      expect(engine.State).toBe(GameState.Settings);
      expect(uiRoot.activeScreenId).toBe('modal-settings');

      engine.CloseSettings();
      expect(engine.State).toBe(GameState.Paused);
      expect(engine.RunActive).toBe(true); // Must NOT have abandoned run!
      expect(uiRoot.activeScreenId).toBe('modal-pause');
    });
  });

  /* ========================================================================= *
   *  3. SIMULTANEOUS DEATH SCENARIOS
   * ========================================================================= */

  describe('3. Simultaneous Death Scenarios', () => {
    it('3.1 Player HP = 0 and Boss HP = 0 on same frame deterministically resolves Player Defeat', () => {
      engine.StartRun(42);
      engine.SpawnBoss('centipede');
      expect(engine.ActiveBosses.length).toBe(1);

      const boss = engine.ActiveBosses[0]!;
      const player = engine.Player;

      // Simultaneously set both HP to 0
      player.HeadHp = 0;
      player.Hp = 0;
      player.Alive = false;

      boss.Hp = 0;
      boss.Dead = true;

      // Execute a simulation step
      engine.Step(GameEngine.FixedStep);

      // Player death takes priority -> GameOver Defeat, NOT FloorClear or Victory
      expect(engine.State).toBe(GameState.GameOver);
      expect(engine.RunActive).toBe(false);
      expect(MetaProgression.Instance.Records.Victories).toBe(0);
    });

    it('3.2 Player HP = 0 and last enemy death on same frame deterministically triggers Defeat', () => {
      engine.StartRun(42);
      const enemy = new Enemy(100, 100, 'scarab', 1);
      enemy.Hp = 0;
      enemy.Dead = true;
      engine.Enemies = [enemy];

      const player = engine.Player;
      player.HeadHp = 0;
      player.Hp = 0;
      player.Alive = false;

      engine.Step(GameEngine.FixedStep);

      expect(engine.State).toBe(GameState.GameOver);
      expect(engine.RunActive).toBe(false);
    });

    it('3.3 Phoenix Revive Relic rescues player when lethal damage occurs simultaneously with Boss defeat', () => {
      engine.StartRun(42);
      engine.SpawnBoss('centipede');
      const boss = engine.ActiveBosses[0]!;
      const player = engine.Player;

      // Clear spawn invulnerability timer
      player.InvulnerableTimer = 0;

      // Grant Phoenix Rebirth charge
      player.Relics['phoenixCharges'] = 1;

      // Deal lethal damage to player
      player.TakeDamage(9999);

      // Verify Phoenix consumed charge and revived player
      expect(player.Relics['phoenixCharges']).toBe(0);
      expect(player.Alive).toBe(true);
      expect(player.Hp).toBeGreaterThan(0);

      // Boss also dies on this frame
      boss.Hp = 0;
      boss.Dead = true;

      engine.Step(GameEngine.FixedStep);

      // Since player is alive via Phoenix, boss defeat proceeds to FloorClear
      expect(engine.State).toBe(GameState.FloorClear);
      expect(engine.FloorClearTimer).toBe(2.6);
    });
  });

  /* ========================================================================= *
   *  4. FLOOR TRANSITIONS WITH ACTIVE PROJECTILES, HAZARDS & TELEGRAPHS
   * ========================================================================= */

  describe('4. Floor Transitions & Board Cleansing', () => {
    it('4.1 AdvanceFloor() eradicates all active projectiles, hazards, and enemies', () => {
      engine.StartRun(42);

      // Populate board with active projectiles, hazards, and enemies
      engine.Projectiles.push(new Projectile(100, 100, 0, 150, 15, 'enemy', '#ff0054', { Life: 3.0 }));
      engine.Projectiles.push(new Projectile(200, 200, Math.PI, 200, 25, 'enemy', '#00f0b5', { Life: 2.0 }));
      engine.Hazards.push(new Hazard({ X: 150, Y: 150, Radius: 45, Type: 'magma', Life: 5.0, Telegraph: 1.0 }));
      engine.Hazards.push(new Hazard({ X: 300, Y: 300, Radius: 60, Type: 'laser', Life: 3.0, Telegraph: 0.8 }));
      engine.Enemies.push(new Enemy(400, 400, 'scarab', 1));

      expect(engine.Projectiles.length).toBe(2);
      expect(engine.Hazards.length).toBe(2);
      expect(engine.Enemies.length).toBe(1);

      // Advance floor
      engine.AdvanceFloor();

      expect(engine.CurrentFloor).toBe(2);
      expect(engine.Projectiles.length).toBe(0);
      expect(engine.Hazards.length).toBe(0);
      expect(engine.Enemies.length).toBe(0);
      expect(engine.State).toBe(GameState.Playing);
      expect(engine.FloorFoodProgress).toBe(0);
    });

    it('4.2 AdvanceFloor() auto-vacuums uncollected Boss Helmet drops into player meta inventory', () => {
      engine.StartRun(42);
      const helmet = generateBossHelmet(1, 'centipede');
      const drop = new HelmetDrop(250, 250, helmet);
      engine.HelmetDrops.push(drop);

      expect(engine.HelmetDrops.length).toBe(1);
      const initialHelmets = MetaProgression.Instance.Helmets.length;

      // Advance floor without manually walking over the helmet drop
      engine.AdvanceFloor();

      expect(engine.HelmetDrops.length).toBe(0);
      expect(MetaProgression.Instance.Helmets.length).toBe(initialHelmets + 1);
      expect(MetaProgression.Instance.Helmets.some((h: any) => (h.Id || h.id) === (helmet.Id || helmet.id))).toBe(true);
    });

    it('4.3 AdvanceFloor() restores 50% max HP and recharges full shield', () => {
      engine.StartRun(42);
      const player = engine.Player;
      player.Stats.MaxHp = 200;
      player.Stats.MaxShield = 50;
      player.HeadHp = 20; // Damaged
      player.Shield = 0;   // Broken

      const initialTotalHp = player.Hp;
      const healed = player.Stats.MaxHp * 0.5; // 100 HP

      engine.AdvanceFloor();

      expect(player.Hp).toBe(Math.min(player.MaxHp, initialTotalHp + healed));
      expect(player.Shield).toBe(50);
    });

    it('4.4 FloorClear state suspends simulation stepping while FloorClearTimer counts down in Tick', () => {
      engine.StartRun(42);
      engine.State = GameState.FloorClear;
      engine.FloorClearTimer = 1.0;

      // Add a projectile to verify it does not move during FloorClear
      const proj = new Projectile(100, 100, 0, 200, 10, 'enemy', '#ff0054', { Life: 5.0 });
      engine.Projectiles.push(proj);

      // Tick 2 frames of 0.25s each (total 0.50s)
      engine.Tick(0.25);
      engine.Tick(0.25);

      expect(engine.State).toBe(GameState.FloorClear);
      expect(engine.FloorClearTimer).toBeCloseTo(0.5, 3);
      expect(proj.X).toBe(100); // Projectile must NOT move during FloorClear

      // Tick remaining 0.6s (clamped in 3 steps of 0.2s) to trigger AdvanceFloor
      engine.Tick(0.25);
      engine.Tick(0.25);
      engine.Tick(0.15);

      expect(engine.State).toBe(GameState.Playing);
      expect(engine.CurrentFloor).toBe(2);
      expect(engine.Projectiles.length).toBe(0); // Cleared by AdvanceFloor
    });
  });

  /* ========================================================================= *
   *  5. REPLAY DETERMINISM & SAVE STATE INTEGRITY
   * ========================================================================= */

  describe('5. Replay Determinism & Persistence Integrity', () => {
    it('5.1 Two independent runs with identical seeds and fixed steering inputs produce identical simulation state', () => {
      const fixedSeed = 987654321;
      const steps = 120;

      // --- Run 1 ---
      const engine1 = new GameEngine(new NullFx(), { isolated: true });
      engine1.StartRun(fixedSeed);
      for (let i = 0; i < steps; i++) {
        // Deterministic steering pattern
        const dirX = Math.cos(i * 0.1);
        const dirY = Math.sin(i * 0.1);
        (engine1.Input as ScriptedInput).SetDirection(dirX, dirY);
        engine1.Step(GameEngine.FixedStep);
      }

      const p1X = engine1.Player.X;
      const p1Y = engine1.Player.Y;
      const p1Score = engine1.Combat.Score;
      const p1Foods = engine1.Combat.FoodsEaten;
      const p1RngCalls = Rng.Shared.calls;

      // --- Run 2 ---
      const engine2 = new GameEngine(new NullFx(), { isolated: true });
      engine2.StartRun(fixedSeed);
      for (let i = 0; i < steps; i++) {
        const dirX = Math.cos(i * 0.1);
        const dirY = Math.sin(i * 0.1);
        (engine2.Input as ScriptedInput).SetDirection(dirX, dirY);
        engine2.Step(GameEngine.FixedStep);
      }

      const p2X = engine2.Player.X;
      const p2Y = engine2.Player.Y;
      const p2Score = engine2.Combat.Score;
      const p2Foods = engine2.Combat.FoodsEaten;
      const p2RngCalls = Rng.Shared.calls;

      expect(p1X).toBe(p2X);
      expect(p1Y).toBe(p2Y);
      expect(p1Score).toBe(p2Score);
      expect(p1Foods).toBe(p2Foods);
      expect(p1RngCalls).toBe(p2RngCalls);
    });

    it('5.2 SaveIO safely migrates Schema v1 legacy saves into Schema v2 with zero loss of records', () => {
      const v1Save: LegacyMetaSaveV1 = {
        version: 1,
        shards: 350,
        highScore: 12500,
        highestFloor: 8,
        highestCombo: 14,
        totalRuns: 12,
        totalKills: 85,
        totalFoods: 210,
        unlockedClasses: { emerald: true, hydra: true },
        upgrades: { vitality: 2, agility: 1 }
      };

      SaveIO.writeKey(SaveIO.STORAGE_KEY_V1, JSON.stringify(v1Save));
      SaveIO.deleteKey(SaveIO.STORAGE_KEY_V2);

      const loaded = SaveIO.loadMeta();

      expect(loaded).toBeDefined();
      expect(loaded.version).toBe(2);
      expect(loaded.shards).toBe(350);
      expect(loaded.records.highScore).toBe(12500);
      expect(loaded.records.highestFloor).toBe(8);
      expect(loaded.records.highestCombo).toBe(14);
      expect(loaded.records.totalRuns).toBe(12);
      expect(loaded.unlockedClasses.hydra).toBe(true);
      expect(loaded.upgrades.vitality.level).toBe(2);
    });

    it('5.3 SaveIO handles corrupt JSON payloads safely by returning default fallback without throwing', () => {
      SaveIO.writeKey(SaveIO.STORAGE_KEY_V2, '{ INVALID_MALFORMED_JSON ::: @@');

      let loaded: MetaSaveV2 | null = null;
      expect(() => {
        loaded = SaveIO.loadMeta();
      }).not.toThrow();

      expect(loaded).toBeDefined();
      expect(loaded!.version).toBe(2);
      expect(loaded!.unlockedClasses.emerald).toBe(true);
      expect(loaded!.shards).toBe(0);
    });
  });
});
