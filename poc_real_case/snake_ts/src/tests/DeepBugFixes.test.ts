import { describe, it, expect, beforeEach } from 'vitest';
import { SnakePlayer } from '../sim/SnakePlayer';
import { SpatialHashGrid } from '../sim/SpatialHashGrid';
import { Hazard } from '../sim/Hazard';
import { Projectile } from '../sim/Projectile';
import { Boss } from '../sim/Boss';
import { MetaProgression } from '../data/MetaProgression';
import { SaveIO } from '../platform/SaveIO';
import { UiRoot } from '../ui/UiRoot';
import { Services } from '../core/Services';
import { NullSound, NullFx, ScriptedInput } from '../core/Contracts';

describe('Deep Bug Fixes Regression Suite (Step 1)', () => {
  beforeEach(() => {
    Services.Sound = new NullSound();
    Services.Fx = new NullFx();
    Services.Input = new ScriptedInput();
    MetaProgression.Instance.Reset();
  });

  describe('1. Simulation & Math Fixes', () => {
    it('SnakePlayer.Deflect slides away when hitting wall perpendicularly', () => {
      const player = new SnakePlayer('emerald', 100, 100);
      player.Angle = Math.PI; // Heading directly left
      player.TargetAngle = Math.PI;
      
      // Hit left wall with normal (1, 0)
      player.Deflect(1, 0);

      // Angle must have been deflected (no longer exactly Math.PI heading into wall)
      expect(Math.abs(Math.cos(player.Angle) - (-1))).toBeGreaterThan(0.01);
    });

    it('SpatialHashGrid does not place negative coordinates into cell 0', () => {
      const grid = new SpatialHashGrid(960, 640, 48);
      // Coordinate (-15, -15) should be outside or negative cell, not cell 0
      grid.insert(-15, -15, 99);
      // Cell (0, 0) spans [0..48, 0..48]. Querying (10, 10) with small radius should NOT find index 99
      const found: number[] = [];
      grid.queryRadius(10, 10, 5, idx => { found.push(idx); return false; });
      expect(found).not.toContain(99);
    });

    it('Hazard.or preserves explicit 0 values instead of overriding with fallback', () => {
      const h = new Hazard({
        Type: 'acid',
        X: 100,
        Y: 100,
        Radius: 40,
        Life: 0, // Explicit 0 life
      });
      expect(h.Life).toBe(0);
    });

    it('Projectile.or preserves explicit 0 values for Chill / Telegraph', () => {
      const p = new Projectile({
        Type: 'bullet',
        X: 50,
        Y: 50,
        Vx: 10,
        Vy: 0,
        Radius: 5,
        Life: 3,
        Damage: 10,
        Chill: 0, // Explicit 0
      });
      expect(p.Chill).toBe(0);
    });
  });

  describe('2. Combat, Bosses & Head Arsenal Fixes', () => {
    it('SnakePlayer.GetActiveAlchemicalFusions detects fusions installed in HeadModules', () => {
      const player = new SnakePlayer('emerald', 200, 200);
      // Install Tesla and Cryo onto Head
      player.installHeadModule('tesla');
      player.installHeadModule('cryo');

      const activeFusions = player.GetActiveAlchemicalFusions();
      expect(activeFusions).toContain('superconductor');
    });

    it('Boss Leviathan initializes MoveTimer to delay immediate tick-0 missile volley', () => {
      const boss = new Boss(8, 960, 640);
      expect(boss.Type).toBe('leviathan');
      expect(boss.MoveTimer).toBeGreaterThan(0);
    });

    it('Boss preserves archetype segment spacing in kinematics', () => {
      const colossus = new Boss(3, 960, 640);
      expect(colossus.Type).toBe('colossus');
      expect(colossus.SegmentSpacing).toBeGreaterThanOrEqual(22);
    });
  });

  describe('3. Meta-Progression & Persistence Fixes', () => {
    it('MetaProgression.CommitRun evaluates challenges and unlocks eligible tiers', () => {
      const meta = MetaProgression.Instance;
      expect(meta.IsTierUnlocked('plasma', 1)).toBe(false);

      // Serpent grew to Length 350
      meta.CommitRun({
        Victory: false,
        Kills: 30,
        Foods: 10,
        Bosses: 1,
        Floor: 2,
        Score: 5000,
        TimeSec: 120,
        Combo: 10,
        Level: 5,
        Length: 350,
      });

      // Plasma Tier 1 is unlocked upon reaching Length 350
      expect(meta.IsTierUnlocked('plasma', 1)).toBe(true);
    });

    it('SaveIO.validateAndNormalizeV2 preserves unlockedTiers and unlockedClasses array', () => {
      const rawSave = {
        version: 2,
        shards: 100,
        unlockedClasses: ['emerald', 'stalker', 'hydra'],
        upgrades: {},
        records: { highScore: 1000 },
        unlockedTiers: { turret: 2, venom: 2, cryo: 1 },
        completedChallenges: { ch_cryo_1: true },
      };

      const normalized = SaveIO.validateAndNormalizeV2(rawSave);
      expect(normalized.unlockedTiers?.turret).toBe(2);
      expect(normalized.unlockedTiers?.cryo).toBe(1);
      expect(normalized.completedChallenges?.ch_cryo_1).toBe(true);
      expect(normalized.unlockedClasses.emerald).toBe(true);
      expect(normalized.unlockedClasses.stalker).toBe(true);
      expect(normalized.unlockedClasses.hydra).toBe(true);
    });
  });

  describe('4. UI Navigation Fixes', () => {
    it('UiRoot.hideScreen resolves alias ID correctly', () => {
      const container = typeof document !== 'undefined' ? document.createElement('div') : ({} as any);
      const root = new UiRoot(container);
      root.showScreen('modal-pause');
      expect(root.isModalOpen()).toBe(true);
      expect(root.activeScreenId).toBe('modal-settings');

      // Closing by alias 'modal-pause' should successfully close the modal
      root.hideScreen('modal-pause');
      expect(root.isModalOpen()).toBe(false);
      expect(root.activeScreenId).toBeNull();
    });
  });
});
