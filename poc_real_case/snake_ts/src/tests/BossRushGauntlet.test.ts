/**
 * Ouroboros Ascension — Boss Rush Gauntlet Test Suite (BossRushGauntlet.test.ts)
 *
 * Strict TDD Verification for 8-Second Wave All-Boss Rush Arena
 * and High-Stakes Victory/Defeat Engine.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GameEngine } from '../sim/GameEngine.js';
import { MetaProgression } from '../data/MetaProgression.js';
import { BossRushGauntlet, GAUNTLET_BOSS_ARCHETYPES, BossRushGauntletState } from '../sim/BossRushGauntlet.js';
import { SaveIO } from '../platform/SaveIO.js';
import { Services } from '../core/Services.js';
import { ScriptedInput, NullFx, NullSound } from '../core/Contracts.js';

function createTestEngine(): GameEngine {
  Services.input = new ScriptedInput();
  Services.fx = new NullFx();
  Services.sound = new NullSound();
  Services.headless = true;
  const engine = new GameEngine();
  engine.setupCanvas(1600, 960, 1);
  return engine;
}

describe('Boss Rush Gauntlet: 8-Second Wave Arena & High-Stakes Victory/Defeat Engine', () => {
  beforeEach(() => {
    SaveIO.memoryBackendEnabled = true;
    SaveIO.clearMemory();
    MetaProgression.instance = MetaProgression.createIsolated({ isolated: true });
  });

  afterEach(() => {
    SaveIO.clearMemory();
    SaveIO.memoryBackendEnabled = false;
  });

  it('1. initializes BossRushGauntlet with valid initial state and first boss (Centipede)', () => {
    const engine = createTestEngine();
    engine.StartRun(42);

    const gauntlet = new BossRushGauntlet();
    gauntlet.start(engine);

    const state = gauntlet.state;
    expect(state.active).toBe(true);
    expect(state.waveIndex).toBe(0);
    expect(state.waveTimer).toBe(8.0);
    expect(state.bossesSpawned).toBe(1);
    expect(state.bossesDefeated).toBe(0);
    expect(state.totalBosses).toBe(8);
    expect(state.allSpawned).toBe(false);
    expect(state.victory).toBe(false);
    expect(state.defeat).toBe(false);

    expect(engine.ActiveBosses.length).toBe(1);
    expect(engine.ActiveBosses[0]!.Type.toLowerCase()).toContain('centipede');
  });

  it('2. 8-second wave timer triggers subsequent boss spawns through all 8 archetypes', () => {
    const engine = createTestEngine();
    engine.StartRun(42);

    const gauntlet = new BossRushGauntlet();
    gauntlet.start(engine);

    // Initial state: Wave 0 (Centipede) spawned
    expect(gauntlet.state.bossesSpawned).toBe(1);
    expect(gauntlet.state.waveIndex).toBe(0);
    expect(gauntlet.state.waveTimer).toBe(8.0);

    // 4 seconds elapsed -> wave timer at 4.0, no new spawn yet
    gauntlet.update(4.0, engine);
    expect(gauntlet.state.bossesSpawned).toBe(1);
    expect(gauntlet.state.waveTimer).toBeCloseTo(4.0, 3);
    expect(engine.ActiveBosses.length).toBe(1);

    // Another 4 seconds elapsed -> 8.0s elapsed total -> Wave 1 (Gorgon) triggers
    gauntlet.update(4.0, engine);
    expect(gauntlet.state.bossesSpawned).toBe(2);
    expect(gauntlet.state.waveIndex).toBe(1);
    expect(gauntlet.state.waveTimer).toBe(8.0);
    expect(engine.ActiveBosses.length).toBe(2);
    expect(engine.ActiveBosses[1]!.Type.toLowerCase()).toContain('gorgon');

    // Fast-forward through remaining 6 waves (waves 2 through 7)
    // Wave 2: Hydra Apex
    gauntlet.update(8.0, engine);
    expect(gauntlet.state.bossesSpawned).toBe(3);
    expect(gauntlet.state.waveIndex).toBe(2);

    // Wave 3: Colossus
    gauntlet.update(8.0, engine);
    expect(gauntlet.state.bossesSpawned).toBe(4);
    expect(gauntlet.state.waveIndex).toBe(3);

    // Wave 4: Leviathan
    gauntlet.update(8.0, engine);
    expect(gauntlet.state.bossesSpawned).toBe(5);
    expect(gauntlet.state.waveIndex).toBe(4);

    // Wave 5: Chrono
    gauntlet.update(8.0, engine);
    expect(gauntlet.state.bossesSpawned).toBe(6);
    expect(gauntlet.state.waveIndex).toBe(5);

    // Wave 6: Void Serpent
    gauntlet.update(8.0, engine);
    expect(gauntlet.state.bossesSpawned).toBe(7);
    expect(gauntlet.state.waveIndex).toBe(6);

    // Wave 7: Solar Chimera (8th and final boss)
    gauntlet.update(8.0, engine);
    expect(gauntlet.state.bossesSpawned).toBe(8);
    expect(gauntlet.state.waveIndex).toBe(7);
    expect(gauntlet.state.allSpawned).toBe(true);
    expect(gauntlet.state.waveTimer).toBe(0);
    expect(engine.ActiveBosses.length).toBe(8);

    // Verify all 8 archetypes are represented in active arena
    const expectedSubstrings = [
      'centipede',
      'gorgon',
      'hydra',
      'colossus',
      'leviathan',
      'chrono',
      'void',
      'chimera',
    ];
    for (let i = 0; i < 8; i++) {
      const boss = engine.ActiveBosses[i]!;
      const match = boss.Type.toLowerCase() + ' ' + boss.Name.toLowerCase();
      expect(match).toContain(expectedSubstrings[i]);
    }
  });

  it('3. gauntlet ends in defeat if player dies -> verifies MetaProgression.instance.UniqueHelmets is wiped to empty []', () => {
    const engine = createTestEngine();
    engine.StartRun(42);

    const meta = MetaProgression.instance;
    // Populate 8 unique helmets in meta progression
    meta.UniqueHelmets = [
      'helm_centipede',
      'helm_gorgon',
      'helm_hydra',
      'helm_colossus',
      'helm_leviathan',
      'helm_chrono',
      'helm_void',
      'helm_solar',
    ];
    expect(meta.UniqueHelmets.length).toBe(8);

    const gauntlet = new BossRushGauntlet();
    gauntlet.start(engine);
    expect(gauntlet.state.active).toBe(true);

    // Kill player
    engine.Player.Hp = 0;
    engine.Player.Alive = false;

    // Update gauntlet
    gauntlet.update(0.1, engine);

    // Gauntlet must record defeat
    expect(gauntlet.state.defeat).toBe(true);
    expect(gauntlet.state.active).toBe(false);

    // High-Stakes Permaloss: all 8 unique helmets MUST be wiped from MetaProgression
    expect(meta.UniqueHelmets).toEqual([]);
    expect(meta.UniqueHelmets.length).toBe(0);
  });

  it('4. gauntlet ends in victory when all 8 bosses are slain -> verifies MetaProgression.instance.Has9thHelmet is set to true', () => {
    const engine = createTestEngine();
    engine.StartRun(42);

    const meta = MetaProgression.instance;
    meta.UniqueHelmets = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'h7', 'h8'];
    meta.Has9thHelmet = false;

    const gauntlet = new BossRushGauntlet();
    gauntlet.start(engine);

    // Spawn all 8 waves
    for (let i = 0; i < 7; i++) {
      gauntlet.update(8.0, engine);
    }
    expect(gauntlet.state.allSpawned).toBe(true);
    expect(engine.ActiveBosses.length).toBe(8);

    // Slay each of the 8 bosses
    for (let i = 0; i < 8; i++) {
      const b = engine.ActiveBosses[i]!;
      b.Hp = 0;
      b.Dead = true;
    }

    // Run gauntlet update to process boss deaths
    gauntlet.update(0.1, engine);

    expect(gauntlet.state.bossesDefeated).toBe(8);
    expect(gauntlet.state.victory).toBe(true);
    expect(gauntlet.state.active).toBe(false);

    // Verifies 9th helmet permanently retained in meta-progression
    expect(meta.Has9thHelmet).toBe(true);
  });

  it('5. GameEngine correctly initializes and coordinates the Gauntlet mode', () => {
    const engine = createTestEngine();
    engine.StartRun(42);

    const meta = MetaProgression.instance;
    meta.UniqueHelmets = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'h7', 'h8'];

    // Initialize through GameEngine
    const gauntlet = engine.StartBossRushGauntlet();
    expect(engine.Gauntlet).toBe(gauntlet);
    expect(gauntlet.state.active).toBe(true);
    expect(engine.ActiveBosses.length).toBe(1);

    // Update through GameEngine simulation loop
    engine.Step(8.0);
    expect(gauntlet.state.bossesSpawned).toBe(2);
    expect(engine.ActiveBosses.length).toBe(2);

    // Simulate player death inside GameEngine simulation loop
    engine.Player.Hp = 0;
    engine.Player.Alive = false;
    engine.Step(0.1);

    expect(gauntlet.state.defeat).toBe(true);
    expect(meta.UniqueHelmets).toEqual([]);
  });
});
