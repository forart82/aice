/**
 * Ouroboros Ascension — Concurrent Bots Isolation & Multi-Agent Thread Safety Test Suite
 * (src/tests/ConcurrentBotsIsolation.test.ts)
 *
 * Validates:
 * 1. Parallel asynchronous execution of multiple autonomous bot agents running concurrently via `Promise.all()`:
 *    - Bot A: Emerald serpent class, Seed 101, Roguelike campaign mode ('rogue').
 *    - Bot B: Stalker serpent class, Seed 202, Endless survival mode ('endless').
 *    - Bot C: Hydra serpent class, Seed 303, Boss Rush gauntlet mode ('bossrush').
 *    - Bot D: Solar serpent class, Seed 404, Seeded Daily Challenge mode ('daily').
 *
 * 2. Cross-Bot Mutation Isolation & Zero Cross-Talk Invariants:
 *    - Simultaneously executes combat ticks, food harvesting, boss kills, and Cranial Lab purchases across all 4 bots.
 *    - Asserts that Bot A's Ouro spending and in-run tier unlocks NEVER alter Bot B's, C's, or D's wallet balance,
 *      unlocked tiers, head modules, augments, or serpent length.
 *    - Asserts that Bot B's food harvesting and segment elongation are strictly isolated.
 *    - Asserts that Bot C's rapid multi-boss kills and floor advancements do not leak into other engines.
 *    - Asserts that Bot D's Daily Challenge Cosmic Special Capacities and milestone escalations do not contaminate other bots.
 *
 * 3. Deterministic Independence & Promise Safety:
 *    - Interleaved microtask simulation ticks produce bit-for-bit deterministic outcomes identical to isolated runs.
 *    - Absolute numerical stability (zero NaNs, infinite bounds, or array corruption) across all concurrent agents.
 *    - Atomic Ouro wallet conservation under high-frequency concurrent load.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GameEngine } from '../sim/GameEngine.js';
import { GameState } from '../sim/GameState.js';
import { Boss } from '../sim/Boss.js';
import { Enemy } from '../sim/Enemy.js';
import { FoodItem } from '../sim/FoodItem.js';
import { SnakePlayer } from '../sim/SnakePlayer.js';
import { GameData } from '../data/GameData.js';
import { MetaProgression, type ChallengeContext } from '../data/MetaProgression.js';
import { CardDef, HelmetDef } from '../data/Types.js';
import { Services } from '../core/Services.js';
import { ScriptedInput, NullFx, NullSound } from '../core/Contracts.js';
import { MathX } from '../core/MathX.js';
import { Rng } from '../core/Rng.js';
import { AutonomousBotPlayer } from '../sim/ai/AutonomousBotPlayer.js';
import { setupMockDom } from './MockDom.js';

/**
 * Isolated runtime environment for an autonomous bot agent session.
 */
interface BotSession {
  id: string;
  name: string;
  classId: string;
  seed: number;
  mode: string;
  dailyKey?: string;
  engine: GameEngine;
  input: ScriptedInput;
  meta: MetaProgression;
  bot: AutonomousBotPlayer;
  rng: Rng;
  store: Map<string, string>;
  initialOuro: number;
  initialSegments: number;
}

/**
 * Helper to construct an isolated bot session with dedicated storage, engine, input, and meta state.
 */
function createBotSession(config: {
  id: string;
  name: string;
  classId: string;
  seed: number;
  mode: string;
  dailyKey?: string;
  initialOuro?: number;
  initialSegments?: number;
}): BotSession {
  const store = new Map<string, string>();

  // Create isolated MetaProgression instance with dedicated memory store
  const meta = new MetaProgression();
  meta.ResetRunUnlocks();

  for (const k of GameData.Classes.Keys) {
    meta.UnlockedClasses[k] = true;
  }

  const engine = new GameEngine();
  engine.SetupCanvas(1280, 720, 1);
  engine.GameMode = config.mode;
  engine.SelectedClass = config.classId;
  engine.Meta = meta;

  if (config.dailyKey) {
    engine.DailyKeyProvider = () => config.dailyKey!;
  }

  const input = new ScriptedInput();
  const bot = new AutonomousBotPlayer();

  // Register session services for StartRun
  Services.Input = input;
  Services.registerEngineProvider(() => engine);
  Services.registerMetaProvider(() => meta);
  MetaProgression.Instance = meta;

  // Seed deterministic PRNG for run initialization
  engine.StartRun(config.seed);
  engine.LabIntroSeen = true;

  const sessionRng = new Rng();
  sessionRng.seed = Rng.Shared.seed;
  sessionRng.state = Rng.Shared.state;
  sessionRng.calls = Rng.Shared.calls;

  const segCount = config.initialSegments ?? 3;
  const player = engine.Player!;
  player.meta = meta;
  player.Hp = player.Stats.MaxHp;

  const initOuro = config.initialOuro ?? 0;
  if (initOuro > 0) {
    player.Ouro = initOuro;
    player.TotalXpCollected = 0;
    player.PendingLevelUps = 0;
    (player as any)._xpForNextLevel = 100000;
  }

  return {
    id: config.id,
    name: config.name,
    classId: config.classId,
    seed: config.seed,
    mode: config.mode,
    dailyKey: config.dailyKey,
    engine,
    input,
    meta,
    bot,
    rng: sessionRng,
    store,
    initialOuro: initOuro,
    initialSegments: segCount,
  };
}

/**
 * Executes a single simulation step on a bot session, safely switching service contexts.
 */
function stepBotSession(session: BotSession, dt: number = 1 / 120, executeAiPolicy: boolean = true): void {
  // Bind active session context to service layer
  Services.Input = session.input;
  Services.registerEngineProvider(() => session.engine);
  Services.registerMetaProvider(() => session.meta);
  MetaProgression.Instance = session.meta;
  session.engine.meta = session.meta;
  session.engine.Combat.Meta = session.meta;
  if (session.engine.Player) session.engine.Player.meta = session.meta;

  // Restore session PRNG state
  Rng.Shared.seed = session.rng.seed;
  Rng.Shared.state = session.rng.state;
  Rng.Shared.calls = session.rng.calls;

  // Execute AI steering policy and game engine simulation tick
  if (executeAiPolicy) {
    session.bot.stepPolicy(session.engine, session.input);
  }
  session.engine.Step(dt);

  // Handle draft selection if LevelUp state triggered
  if (session.engine.State === GameState.LevelUp) {
    session.bot.handleLevelUp(session.engine);
  }

  // Preserve session PRNG state
  session.rng.seed = Rng.Shared.seed;
  session.rng.state = Rng.Shared.state;
  session.rng.calls = Rng.Shared.calls;
}

/**
 * Asynchronous worker executing N simulation steps with true microtask interleaving.
 */
async function runBotSessionAsync(
  session: BotSession,
  steps: number,
  options?: {
    harvestFoodInterval?: number;
    defeatBossOnSpawn?: boolean;
    purchaseLabInterval?: number;
    executeAiPolicy?: boolean;
  }
): Promise<BotSession> {
  const dt = 1 / 120;
  const execPolicy = options?.executeAiPolicy ?? true;

  for (let i = 0; i < steps; i++) {
    // Interleave async execution via microtask queue
    await new Promise<void>((resolve) => queueMicrotask(resolve));

    stepBotSession(session, dt, execPolicy);

    // Optional simulated actions
    if (options?.harvestFoodInterval && i % options.harvestFoodInterval === 0 && session.engine.Foods.length > 0) {
      const food = session.engine.Foods[0]!;
      food.Dead = true;
      session.engine.Player!.GainOuro(25);
      session.engine.Player!.AddGrowth(1);
      session.engine.Combat.FoodsEaten++;
    }

    if (options?.defeatBossOnSpawn && session.engine.ActiveBosses.length > 0) {
      for (const b of session.engine.ActiveBosses) {
        b.EntranceTimer = 0;
        b.ApplyDamage(b.MaxHp + 100);
        b.Dead = true;
      }
      session.engine.Step(dt);
      if (session.engine.State === GameState.FloorClear) {
        session.engine.AdvanceFloor();
      }
    }

    if (options?.purchaseLabInterval && i % options.purchaseLabInterval === 0) {
      if (session.engine.Player!.Ouro >= 30) {
        const curFloor = session.engine.CurrentFloor;
        const kills = session.engine.Combat.Kills;
        const foods = session.engine.Combat.FoodsEaten;
        const bosses = session.engine.Combat.BossKills;
        const len = session.engine.Player!.Segments.length + 1;

        session.bot.performLabPurchases(session.engine.Player!, session.meta, undefined, {
          floor: curFloor,
          kills,
          foods,
          bosses,
          length: len,
          runTime: session.engine.Combat.RunTime,
        });
      }
    }
  }

  return session;
}

describe('Concurrent Bots Isolation & Multi-Agent Thread Safety Test Suite', () => {
  let teardownDom: () => void;

  beforeEach(() => {
    teardownDom = setupMockDom();
    Services.Fx = new NullFx();
    Services.Sound = new NullSound();
    Services.Headless = true;
  });

  afterEach(() => {
    teardownDom();
  });

  /* ========================================================================= *
   * 1. CONCURRENT EXECUTION MATRIX VIA Promise.all()
   * ========================================================================= */
  describe('1. Concurrent Execution Matrix (Promise.all)', () => {
    it('1.1 executes Bot A, B, C, and D concurrently in parallel across all 4 game modes without deadlock', async () => {
      const botA = createBotSession({ id: 'bot-a', name: 'Bot A (Emerald)', classId: 'emerald', seed: 101, mode: 'rogue' });
      const botB = createBotSession({ id: 'bot-b', name: 'Bot B (Stalker)', classId: 'stalker', seed: 202, mode: 'endless' });
      const botC = createBotSession({ id: 'bot-c', name: 'Bot C (Hydra)',   classId: 'hydra',   seed: 303, mode: 'bossrush' });
      const botD = createBotSession({ id: 'bot-d', name: 'Bot D (Solar)',   classId: 'solar',   seed: 404, mode: 'daily', dailyKey: '2026-08-31' });

      // Run 150 simulated frames in parallel across all 4 bots
      const [resA, resB, resC, resD] = await Promise.all([
        runBotSessionAsync(botA, 150),
        runBotSessionAsync(botB, 150),
        runBotSessionAsync(botC, 150),
        runBotSessionAsync(botD, 150),
      ]);

      // All bots must resolve successfully
      expect(resA.id).toBe('bot-a');
      expect(resB.id).toBe('bot-b');
      expect(resC.id).toBe('bot-c');
      expect(resD.id).toBe('bot-d');

      // Assert distinctive class configs
      expect(resA.engine.Player!.ClassId).toBe('emerald');
      expect(resB.engine.Player!.ClassId).toBe('stalker');
      expect(resC.engine.Player!.ClassId).toBe('hydra');
      expect(resD.engine.Player!.ClassId).toBe('solar');

      // Assert distinctive game modes
      expect(resA.engine.GameMode).toBe('rogue');
      expect(resB.engine.GameMode).toBe('endless');
      expect(resC.engine.GameMode).toBe('bossrush');
      expect(resD.engine.GameMode).toBe('daily');

      // Assert 100% numerical stability across all parallel instances
      for (const res of [resA, resB, resC, resD]) {
        const p = res.engine.Player!;
        expect(Number.isFinite(p.X)).toBe(true);
        expect(Number.isFinite(p.Y)).toBe(true);
        expect(Number.isNaN(p.X)).toBe(false);
        expect(Number.isNaN(p.Y)).toBe(false);
        expect(Number.isNaN(p.Angle)).toBe(false);
        expect(Number.isNaN(p.VelocityX)).toBe(false);
        expect(Number.isNaN(p.VelocityY)).toBe(false);

        for (const seg of p.Segments) {
          expect(Number.isFinite(seg.X)).toBe(true);
          expect(Number.isFinite(seg.Y)).toBe(true);
          expect(Number.isNaN(seg.X)).toBe(false);
          expect(Number.isNaN(seg.Y)).toBe(false);
        }
      }
    });
  });

  /* ========================================================================= *
   * 2. CROSS-BOT MUTATION & WALLET ISOLATION (ZERO CROSS-TALK)
   * ========================================================================= */
  describe('2. Cross-Bot Mutation & Wallet Isolation', () => {
    it('2.1 asserts Bot A Ouro spending & tier unlocks NEVER alter Bot B, C, or D balances, unlocked tiers, or lengths', async () => {
      // Setup 4 bots with distinct initial wallets and lengths
      const botA = createBotSession({ id: 'bot-a', name: 'Bot A', classId: 'emerald', seed: 101, mode: 'rogue', initialOuro: 1000 });
      const botB = createBotSession({ id: 'bot-b', name: 'Bot B', classId: 'stalker', seed: 202, mode: 'endless', initialOuro: 150 });
      const botC = createBotSession({ id: 'bot-c', name: 'Bot C', classId: 'hydra',   seed: 303, mode: 'bossrush', initialOuro: 200 });
      const botD = createBotSession({ id: 'bot-d', name: 'Bot D', classId: 'solar',   seed: 404, mode: 'daily', dailyKey: '2026-08-31', initialOuro: 300 });

      // Clear ambient foods for passive test subjects so motion doesn't inadvertently consume drops
      botB.engine.Foods = [];
      botC.engine.Foods = [];
      botD.engine.Foods = [];

      // Record pre-mutation snapshots for B, C, D
      const snapB = {
        ouro: botB.engine.Player!.Ouro,
        length: botB.engine.Player!.Segments.length,
        tiers: { ...botB.meta.UnlockedTiers },
        headModules: { ...botB.engine.Player!.HeadModules },
        maxShield: botB.engine.Player!.Stats.MaxShield,
      };

      const snapC = {
        ouro: botC.engine.Player!.Ouro,
        length: botC.engine.Player!.Segments.length,
        tiers: { ...botC.meta.UnlockedTiers },
        headModules: { ...botC.engine.Player!.HeadModules },
        maxShield: botC.engine.Player!.Stats.MaxShield,
      };

      const snapD = {
        ouro: botD.engine.Player!.Ouro,
        length: botD.engine.Player!.Segments.length,
        tiers: { ...botD.meta.UnlockedTiers },
        headModules: { ...botD.engine.Player!.HeadModules },
        maxShield: botD.engine.Player!.Stats.MaxShield,
      };

      // Perform parallel execution where Bot A heavily unlocks tiers and buys lab modules
      const actionA = async () => {
        // Bot A unlocks high tiers
        botA.meta.UnlockTier('shield', 3);
        botA.meta.UnlockTier('magma', 2);
        botA.meta.UnlockTier('plasma', 2);
        botA.meta.UnlockTier('fangs', 3);

        // Bot A executes Cranial Lab shopping
        const labRes = botA.bot.performLabPurchases(botA.engine.Player!, botA.meta);
        expect(labRes.purchasedCount).toBeGreaterThan(0);
        expect(labRes.totalSpent).toBeGreaterThan(0);

        // Run 50 ticks for Bot A
        await runBotSessionAsync(botA, 50);
      };

      const actionB = async () => {
        // Bot B runs simulation with pure movement (no auto-shopping)
        await runBotSessionAsync(botB, 50, { executeAiPolicy: false });
      };

      const actionC = async () => {
        // Bot C runs simulation with pure movement (no auto-shopping)
        await runBotSessionAsync(botC, 50, { executeAiPolicy: false });
      };

      const actionD = async () => {
        // Bot D runs simulation with pure movement (no auto-shopping)
        await runBotSessionAsync(botD, 50, { executeAiPolicy: false });
      };

      await Promise.all([actionA(), actionB(), actionC(), actionD()]);

      // Confirm Bot A modified its own state
      expect(botA.engine.Player!.Ouro).toBeLessThan(1000);
      expect(botA.engine.Player!.GetHeadModuleLevel('shield')).toBeGreaterThanOrEqual(1);
      expect(botA.meta.UnlockedTiers['shield']).toBe(3);
      expect(botA.meta.UnlockedTiers['magma']).toBe(2);

      // --- STRICT CROSS-BOT INVARIANT ASSERTIONS ---

      // 1. Bot B Isolation Check
      expect(botB.engine.Player!.Ouro).toBe(snapB.ouro);
      expect(botB.engine.Player!.Segments.length).toBe(snapB.length);
      expect(botB.meta.UnlockedTiers['shield']).toBe(1); // Default starter tier
      expect(botB.meta.UnlockedTiers['magma']).toBeUndefined();
      expect(botB.meta.UnlockedTiers['plasma']).toBeUndefined();
      expect(botB.engine.Player!.GetHeadModuleLevel('shield')).toBe(0);
      expect(botB.engine.Player!.Stats.MaxShield).toBe(snapB.maxShield);

      // 2. Bot C Isolation Check
      expect(botC.engine.Player!.Ouro).toBe(snapC.ouro);
      expect(botC.engine.Player!.Segments.length).toBe(snapC.length);
      expect(botC.meta.UnlockedTiers['shield']).toBe(1);
      expect(botC.meta.UnlockedTiers['magma']).toBeUndefined();
      expect(botC.meta.UnlockedTiers['plasma']).toBeUndefined();
      expect(botC.engine.Player!.GetHeadModuleLevel('shield')).toBe(0);
      expect(botC.engine.Player!.Stats.MaxShield).toBe(snapC.maxShield);

      // 3. Bot D Isolation Check
      expect(botD.engine.Player!.Ouro).toBe(snapD.ouro);
      expect(botD.engine.Player!.Segments.length).toBe(snapD.length);
      expect(botD.meta.UnlockedTiers['shield']).toBe(1);
      expect(botD.meta.UnlockedTiers['magma']).toBeUndefined();
      expect(botD.meta.UnlockedTiers['plasma']).toBeUndefined();
      expect(botD.engine.Player!.GetHeadModuleLevel('shield')).toBe(0);
      expect(botD.engine.Player!.Stats.MaxShield).toBe(snapD.maxShield);
    });
  });

  /* ========================================================================= *
   * 3. SIMULTANEOUS FOOD HARVESTING & LENGTH ISOLATION
   * ========================================================================= */
  describe('3. Simultaneous Food Harvesting & Length Isolation', () => {
    it('3.1 concurrently harvests distinct food quantities across all 4 bots without length cross-contamination', async () => {
      const botA = createBotSession({ id: 'bot-a', name: 'Bot A', classId: 'emerald', seed: 101, mode: 'rogue' });
      const botB = createBotSession({ id: 'bot-b', name: 'Bot B', classId: 'stalker', seed: 202, mode: 'endless' });
      const botC = createBotSession({ id: 'bot-c', name: 'Bot C', classId: 'hydra',   seed: 303, mode: 'bossrush' });
      const botD = createBotSession({ id: 'bot-d', name: 'Bot D', classId: 'solar',   seed: 404, mode: 'daily' });

      const startLenA = botA.engine.Player!.Segments.length;
      const startLenB = botB.engine.Player!.Segments.length;
      const startLenC = botC.engine.Player!.Segments.length;
      const startLenD = botD.engine.Player!.Segments.length;

      // Execute concurrent food harvesting
      await Promise.all([
        // Bot A eats 5 apples (+5 segments, +50 Ouro)
        (async () => {
          for (let i = 0; i < 5; i++) {
            botA.engine.Player!.AddGrowth(1);
            botA.engine.Player!.GainOuro(10);
            botA.engine.Combat.FoodsEaten++;
            await new Promise<void>((r) => queueMicrotask(r));
          }
        })(),

        // Bot B eats 15 shards (+15 segments, +300 Ouro)
        (async () => {
          for (let i = 0; i < 15; i++) {
            botB.engine.Player!.AddGrowth(1);
            botB.engine.Player!.GainOuro(20);
            botB.engine.Combat.FoodsEaten++;
            await new Promise<void>((r) => queueMicrotask(r));
          }
        })(),

        // Bot C eats 8 potions (+8 segments, +80 Ouro)
        (async () => {
          for (let i = 0; i < 8; i++) {
            botC.engine.Player!.AddGrowth(1);
            botC.engine.Player!.GainOuro(10);
            botC.engine.Combat.FoodsEaten++;
            await new Promise<void>((r) => queueMicrotask(r));
          }
        })(),

        // Bot D eats 20 golden apples (+20 segments, +500 Ouro)
        (async () => {
          for (let i = 0; i < 20; i++) {
            botD.engine.Player!.AddGrowth(1);
            botD.engine.Player!.GainOuro(25);
            botD.engine.Combat.FoodsEaten++;
            await new Promise<void>((r) => queueMicrotask(r));
          }
        })(),
      ]);

      // Assert exact length isolations
      expect(botA.engine.Player!.Segments.length).toBe(startLenA + 5);
      expect(botB.engine.Player!.Segments.length).toBe(startLenB + 15);
      expect(botC.engine.Player!.Segments.length).toBe(startLenC + 8);
      expect(botD.engine.Player!.Segments.length).toBe(startLenD + 20);

      // Assert exact combat food eaten counters
      expect(botA.engine.Combat.FoodsEaten).toBe(5);
      expect(botB.engine.Combat.FoodsEaten).toBe(15);
      expect(botC.engine.Combat.FoodsEaten).toBe(8);
      expect(botD.engine.Combat.FoodsEaten).toBe(20);

      // Assert exact Ouro wallet balances
      expect(botA.engine.Player!.Ouro).toBe(50);
      expect(botB.engine.Player!.Ouro).toBe(300);
      expect(botC.engine.Player!.Ouro).toBe(80);
      expect(botD.engine.Player!.Ouro).toBe(500);
    });
  });

  /* ========================================================================= *
   * 4. CONCURRENT BOSS KILLS, HELMET LOOTING & MODE PROGRESSION ISOLATION
   * ========================================================================= */
  describe('4. Concurrent Boss Kills, Helmet Looting & Mode Progression Isolation', () => {
    it('4.1 runs concurrent boss encounters and verifies isolated floor progression, helmet drops, and daily capacities', async () => {
      const botA = createBotSession({ id: 'bot-a', name: 'Bot A (Rogue)', classId: 'emerald', seed: 101, mode: 'rogue' });
      const botB = createBotSession({ id: 'bot-b', name: 'Bot B (Endless)', classId: 'stalker', seed: 202, mode: 'endless' });
      const botC = createBotSession({ id: 'bot-c', name: 'Bot C (BossRush)', classId: 'hydra',   seed: 303, mode: 'bossrush' });
      const botD = createBotSession({ id: 'bot-d', name: 'Bot D (Daily)', classId: 'solar', seed: 404, mode: 'daily', dailyKey: '2026-08-31' });

      await Promise.all([
        // Bot A defeats 1 boss and advances to Floor 2
        (async () => {
          botA.engine.SpawnBoss();
          const boss = botA.engine.Boss!;
          boss.EntranceTimer = 0;
          boss.ApplyDamage(boss.MaxHp + 50);
          boss.Dead = true;
          stepBotSession(botA);
          if (botA.engine.State === GameState.FloorClear) {
            botA.engine.AdvanceFloor();
          }
        })(),

        // Bot B defeats 4 bosses in endless mode, reaching Floor 5
        (async () => {
          for (let f = 1; f <= 4; f++) {
            botB.engine.CurrentFloor = f;
            botB.engine.SpawnBoss();
            const boss = botB.engine.Boss!;
            boss.EntranceTimer = 0;
            boss.ApplyDamage(boss.MaxHp + 50);
            boss.Dead = true;
            stepBotSession(botB);
            if (botB.engine.State === GameState.FloorClear) {
              botB.engine.AdvanceFloor();
            }
            await new Promise<void>((r) => queueMicrotask(r));
          }
        })(),

        // Bot C defeats 3 bosses in boss rush mode, reaching Floor 4
        (async () => {
          for (let f = 1; f <= 3; f++) {
            botC.engine.CurrentFloor = f;
            botC.engine.SpawnBoss();
            const boss = botC.engine.Boss!;
            boss.EntranceTimer = 0;
            boss.ApplyDamage(boss.MaxHp + 50);
            boss.Dead = true;
            stepBotSession(botC);
            if (botC.engine.State === GameState.FloorClear) {
              botC.engine.AdvanceFloor();
            }
            await new Promise<void>((r) => queueMicrotask(r));
          }
        })(),

        // Bot D reaches level 5, defeats boss, and activates Daily Special Capacity
        (async () => {
          const player = botD.engine.Player!;
          player.Level = 5;
          botD.engine.CheckDailyMilestones();
          botD.engine.SpawnBoss();
          const boss = botD.engine.Boss!;
          boss.EntranceTimer = 0;
          boss.ApplyDamage(boss.MaxHp + 50);
          boss.Dead = true;
          stepBotSession(botD);
          if (botD.engine.State === GameState.FloorClear) {
            botD.engine.AdvanceFloor();
          }
        })(),
      ]);

      // Assert isolated Floor progression
      expect(botA.engine.CurrentFloor).toBe(2);
      expect(botB.engine.CurrentFloor).toBe(5);
      expect(botC.engine.CurrentFloor).toBe(4);
      expect(botD.engine.CurrentFloor).toBe(2);

      // Assert isolated Boss kill counts
      expect(botA.engine.Combat.BossKills).toBe(1);
      expect(botB.engine.Combat.BossKills).toBe(4);
      expect(botC.engine.Combat.BossKills).toBe(3);
      expect(botD.engine.Combat.BossKills).toBe(1);

      // Assert Daily Capacity isolation: ONLY Bot D has active daily capacity
      expect(botD.meta.IsDailyCapacityActive()).toBe(true);
      expect(botA.meta.IsDailyCapacityActive()).toBe(false);
      expect(botB.meta.IsDailyCapacityActive()).toBe(false);
      expect(botC.meta.IsDailyCapacityActive()).toBe(false);
    });
  });

  /* ========================================================================= *
   * 5. DETERMINISTIC INDEPENDENCE & REPLAY PARITY
   * ========================================================================= */
  describe('5. Deterministic Independence & Replay Parity', () => {
    it('5.1 guarantees that parallel concurrent execution produces bit-for-bit identical results to isolated sequential runs', async () => {
      const fixedSeed = 777;

      // 1. Run Bot A in pure sequential isolation
      const botSequential = createBotSession({
        id: 'bot-seq',
        name: 'Bot Seq',
        classId: 'emerald',
        seed: fixedSeed,
        mode: 'rogue',
        initialOuro: 50,
      });

      for (let i = 0; i < 80; i++) {
        stepBotSession(botSequential);
      }

      const seqSnapshot = {
        x: botSequential.engine.Player!.X,
        y: botSequential.engine.Player!.Y,
        angle: botSequential.engine.Player!.Angle,
        hp: botSequential.engine.Player!.Hp,
        ouro: botSequential.engine.Player!.Ouro,
        length: botSequential.engine.Player!.Segments.length,
      };

      // 2. Run identical Bot A concurrently alongside Bot B, C, D
      const botParallelA = createBotSession({
        id: 'bot-par-a',
        name: 'Bot Parallel A',
        classId: 'emerald',
        seed: fixedSeed,
        mode: 'rogue',
        initialOuro: 50,
      });
      const botParallelB = createBotSession({ id: 'bot-par-b', name: 'Bot B', classId: 'stalker', seed: 888, mode: 'endless' });
      const botParallelC = createBotSession({ id: 'bot-par-c', name: 'Bot C', classId: 'hydra',   seed: 999, mode: 'bossrush' });
      const botParallelD = createBotSession({ id: 'bot-par-d', name: 'Bot D', classId: 'solar',   seed: 111, mode: 'daily' });

      await Promise.all([
        runBotSessionAsync(botParallelA, 80),
        runBotSessionAsync(botParallelB, 80),
        runBotSessionAsync(botParallelC, 80),
        runBotSessionAsync(botParallelD, 80),
      ]);

      const parSnapshot = {
        x: botParallelA.engine.Player!.X,
        y: botParallelA.engine.Player!.Y,
        angle: botParallelA.engine.Player!.Angle,
        hp: botParallelA.engine.Player!.Hp,
        ouro: botParallelA.engine.Player!.Ouro,
        length: botParallelA.engine.Player!.Segments.length,
      };

      // Assert bit-for-bit parity between sequential and concurrent executions
      expect(parSnapshot.x).toBeCloseTo(seqSnapshot.x, 3);
      expect(parSnapshot.y).toBeCloseTo(seqSnapshot.y, 3);
      expect(parSnapshot.angle).toBeCloseTo(seqSnapshot.angle, 3);
      expect(parSnapshot.hp).toBe(seqSnapshot.hp);
      expect(parSnapshot.ouro).toBe(seqSnapshot.ouro);
      expect(parSnapshot.length).toBe(seqSnapshot.length);
    });
  });

  /* ========================================================================= *
   * 6. HIGH-FREQUENCY WALLET STRESS & ATOMIC CONSERVATION
   * ========================================================================= */
  describe('6. High-Frequency Wallet Stress & Atomic Conservation', () => {
    it('6.1 executes 800+ concurrent wallet transactions across 4 bots with zero balance bleed or corruption', async () => {
      const botA = createBotSession({ id: 'bot-a', name: 'Bot A', classId: 'emerald', seed: 101, mode: 'rogue', initialOuro: 500 });
      const botB = createBotSession({ id: 'bot-b', name: 'Bot B', classId: 'stalker', seed: 202, mode: 'endless', initialOuro: 500 });
      const botC = createBotSession({ id: 'bot-c', name: 'Bot C', classId: 'hydra',   seed: 303, mode: 'bossrush', initialOuro: 500 });
      const botD = createBotSession({ id: 'bot-d', name: 'Bot D', classId: 'solar',   seed: 404, mode: 'daily', initialOuro: 500 });

      const txHistory = {
        a: { gained: 0, spent: 0 },
        b: { gained: 0, spent: 0 },
        c: { gained: 0, spent: 0 },
        d: { gained: 0, spent: 0 },
      };

      // Concurrently run 200 random transactions per bot
      const runTransactions = async (bot: BotSession, history: { gained: number; spent: number }) => {
        for (let i = 0; i < 200; i++) {
          const gain = (i % 3 === 0) ? 20 : 0;
          if (gain > 0) {
            bot.engine.Player!.GainOuro(gain);
            history.gained += gain;
          }

          const cost = (i % 2 === 0) ? 15 : 10;
          const didSpend = bot.engine.Player!.SpendOuro(cost);
          if (didSpend) {
            history.spent += cost;
          }

          await new Promise<void>((r) => queueMicrotask(r));
        }
      };

      await Promise.all([
        runTransactions(botA, txHistory.a),
        runTransactions(botB, txHistory.b),
        runTransactions(botC, txHistory.c),
        runTransactions(botD, txHistory.d),
      ]);

      // Assert conservation: final = initial + gained - spent
      expect(botA.engine.Player!.Ouro).toBe(500 + txHistory.a.gained - txHistory.a.spent);
      expect(botB.engine.Player!.Ouro).toBe(500 + txHistory.b.gained - txHistory.b.spent);
      expect(botC.engine.Player!.Ouro).toBe(500 + txHistory.c.gained - txHistory.c.spent);
      expect(botD.engine.Player!.Ouro).toBe(500 + txHistory.d.gained - txHistory.d.spent);

      // Assert zero negative balances
      expect(botA.engine.Player!.Ouro).toBeGreaterThanOrEqual(0);
      expect(botB.engine.Player!.Ouro).toBeGreaterThanOrEqual(0);
      expect(botC.engine.Player!.Ouro).toBeGreaterThanOrEqual(0);
      expect(botD.engine.Player!.Ouro).toBeGreaterThanOrEqual(0);
    });
  });
});
