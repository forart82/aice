/**
 * Ouroboros Ascension — 20 Apex Bosses Calibration & Multi-Boss Scaling Test Suite
 *
 * Strict TDD test suite validating:
 * 1. Exact HP calibration for all 20 Apex Bosses across Floors 1–20.
 * 2. Contact and projectile damage curves scaling smoothly across Floors 1–20.
 * 3. Multi-boss shared health scaling on Floors 21+ with 0.75x individual HP modifier.
 * 4. Single-boss encounters retain 1.0x baseline HP modifier.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GameEngine } from '../sim/GameEngine.js';
import { Boss } from '../sim/Boss.js';
import { GameData } from '../data/GameData.js';
import { MetaProgression } from '../data/MetaProgression.js';
import { Services } from '../core/Services.js';
import { ScriptedInput, NullFx, NullSound } from '../core/Contracts.js';
import { setupMockDom } from './MockDom.js';
import { MathX } from '../core/MathX.js';

describe('20 Apex Bosses Calibration & Multi-Boss Scaling Test Suite', () => {
  let g: GameEngine;
  let teardownDom: () => void;

  beforeEach(() => {
    teardownDom = setupMockDom();

    const memStore = new Map<string, string>();
    MetaProgression.ReadBackend = (key) => memStore.get(key) ?? null;
    MetaProgression.WriteBackend = (key, val) => { memStore.set(key, val); };
    MetaProgression.DeleteBackend = (key) => { memStore.delete(key); };
    MetaProgression.Instance = new MetaProgression();

    g = new GameEngine();
    g.SetupCanvas(1280, 720, 1);
    Services.Input = new ScriptedInput();
    Services.Fx = new NullFx();
    Services.Sound = new NullSound();
    Services.Headless = true;
  });

  afterEach(() => {
    teardownDom();
  });

  /* ========================================================================= *
   * 1. CALIBRATED HP CURVE ACROSS FLOORS 1–20
   * ========================================================================= */
  describe('1. Calibrated HP Curve Across Floors 1–20', () => {
    const expectedFloorHps = [
      { floor: 1, type: 'centipede', name: 'Centipede Behemoth', hp: 450 },
      { floor: 2, type: 'gorgon', name: 'Storm Gorgon', hp: 650 },
      { floor: 3, type: 'colossus', name: 'Infernal Colossus', hp: 900 },
      { floor: 4, type: 'frostwyrm', name: 'Glacial Behemoth', hp: 1200 },
      { floor: 5, type: 'chronowyrm', name: 'Chrono Wyrm', hp: 1500 },
      { floor: 6, type: 'hivemind', name: 'Bio-Venom Hivemind', hp: 1900 },
      { floor: 7, type: 'superconductor_boss', name: 'Apex Superconductor', hp: 2400 },
      { floor: 8, type: 'leviathan', name: 'Astral Leviathan', hp: 3000 },
      { floor: 9, type: 'quantum_hydra', name: 'Quantum Hydra', hp: 3700 },
      { floor: 10, type: 'mirror_wyrm', name: 'Shadow Doppelgänger', hp: 4500 },
      { floor: 11, type: 'void_devourer', name: 'Void Devourer', hp: 5400 },
      { floor: 12, type: 'orbital_dreadnought', name: 'Magnetic Dreadnought', hp: 6400 },
      { floor: 13, type: 'iron_juggernaut', name: 'Aegis Juggernaut', hp: 7500 },
      { floor: 14, type: 'solar_archon', name: 'Dyson Archon', hp: 8700 },
      { floor: 15, type: 'crystal_monolith', name: 'Prismatic Arachnid', hp: 10000 },
      { floor: 16, type: 'tempest_siren', name: 'Tempest Siren', hp: 11500 },
      { floor: 17, type: 'nanite_titan', name: 'Nanite Hive Titan', hp: 13200 },
      { floor: 18, type: 'phase_specter', name: 'Plasma Phase Specter', hp: 15000 },
      { floor: 19, type: 'volcanic_chimera', name: 'Volcanic Chimera', hp: 17000 },
      { floor: 20, type: 'eternal_ouroboros', name: 'The Eternal Ouroboros', hp: 20000 },
    ];

    it('1.1 validates GameData.Bosses has calibrated BaseHp for all 20 bosses', () => {
      expect(GameData.Bosses.length).toBe(20);
      for (const expected of expectedFloorHps) {
        const bossDef = GameData.Bosses[expected.floor - 1]!;
        expect(bossDef.Type).toBe(expected.type);
        expect(bossDef.BaseHp).toBe(expected.hp);
        expect(bossDef.baseHp).toBe(expected.hp);
      }
    });

    it('1.2 validates Boss instances on Floors 1–20 spawn with exact calibrated HP', () => {
      for (const expected of expectedFloorHps) {
        const boss = new Boss(expected.floor, 1280, 720);
        expect(boss.Type).toBe(expected.type);
        expect(boss.MaxHp).toBe(expected.hp);
        expect(boss.maxHp).toBe(expected.hp);
        expect(boss.Hp).toBe(expected.hp);
        expect(boss.hp).toBe(expected.hp);
      }
    });

    it('1.3 validates SpawnBoss() on Floors 1–20 spawns single boss with exact calibrated HP', () => {
      for (const expected of expectedFloorHps) {
        g.CurrentFloor = expected.floor;
        g.ActiveBosses = [];
        g.SpawnBoss();

        expect(g.ActiveBosses.length).toBe(1);
        const b = g.ActiveBosses[0]!;
        expect(b.Type).toBe(expected.type);
        expect(b.MaxHp).toBe(expected.hp);
        expect(b.Hp).toBe(expected.hp);
      }
    });
  });

  /* ========================================================================= *
   * 2. DAMAGE CURVES ACROSS FLOORS 1–20
   * ========================================================================= */
  describe('2. Damage Curves Across Floors 1–20', () => {
    it('2.1 validates contact damage scales monotonically with floor level', () => {
      let prevContact = 0;
      for (let floor = 1; floor <= 20; floor++) {
        const boss = new Boss(floor, 1280, 720);
        expect(boss.ContactDamage).toBe(16 + floor * 3);
        expect(boss.ContactDamage).toBeGreaterThan(prevContact);
        prevContact = boss.ContactDamage;
      }
    });
  });

  /* ========================================================================= *
   * 3. MULTI-BOSS SHARED HEALTH SCALING (FLOORS 21+)
   * ========================================================================= */
  describe('3. Multi-Boss Shared Health Scaling on Floors 21+', () => {
    it('3.1 applies 0.75x individual HP modifier when multi-boss spawns on Floor 21+', () => {
      g.CurrentFloor = 21; // 2 bosses
      g.ActiveBosses = [];
      g.SpawnBoss();

      expect(g.ActiveBosses.length).toBe(2);
      for (const b of g.ActiveBosses) {
        const arch = GameData.Bosses.find(x => x.Type === b.Type)!;
        const cycle = Math.floor((21 - 1) / 20); // 1
        const cycleFloor = cycle * 20; // 20
        const unscaledHp = MathX.roundJs((arch.BaseHp + arch.HpPerFloor * cycleFloor) * (1 + cycle * 0.35));
        const expectedHp = MathX.roundJs(unscaledHp * 0.75);

        expect(b.MaxHp).toBe(expectedHp);
        expect(b.Hp).toBe(expectedHp);
      }
    });

    it('3.2 applies 0.75x individual HP modifier for tri-boss encounters (e.g. Floor 31)', () => {
      g.CurrentFloor = 31; // 3 bosses
      g.ActiveBosses = [];
      g.SpawnBoss();

      expect(g.ActiveBosses.length).toBe(3);
      for (const b of g.ActiveBosses) {
        const arch = GameData.Bosses.find(x => x.Type === b.Type)!;
        const cycle = Math.floor((31 - 1) / 20); // 1
        const cycleFloor = cycle * 20; // 20
        const unscaledHp = MathX.roundJs((arch.BaseHp + arch.HpPerFloor * cycleFloor) * (1 + cycle * 0.35));
        const expectedHp = MathX.roundJs(unscaledHp * 0.75);

        expect(b.MaxHp).toBe(expectedHp);
        expect(b.Hp).toBe(expectedHp);
      }
    });

    it('3.3 preserves 1.0x HP multiplier when Boss is constructed as single entity', () => {
      const bSingle = new Boss(21, 1280, 720, 'centipede', undefined, undefined, 1.0);
      const arch = GameData.Bosses[0]!;
      const cycle = 1;
      const cycleFloor = 20;
      const expectedSingleHp = MathX.roundJs((arch.BaseHp + arch.HpPerFloor * cycleFloor) * (1 + cycle * 0.35));

      expect(bSingle.MaxHp).toBe(expectedSingleHp);

      const bMulti = new Boss(21, 1280, 720, 'centipede', undefined, undefined, 0.75);
      const expectedMultiHp = MathX.roundJs(expectedSingleHp * 0.75);

      expect(bMulti.MaxHp).toBe(expectedMultiHp);
    });
  });
});
