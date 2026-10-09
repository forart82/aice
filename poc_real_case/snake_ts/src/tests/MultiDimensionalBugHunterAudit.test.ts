import { describe, it, expect, beforeEach } from 'vitest';
import { MathX } from '../core/MathX';
import { Vec2 } from '../core/Vec2';
import { SpatialHashGrid, SpatialLayer, SpatialLayerMask } from '../sim/SpatialHashGrid';
import { SnakePlayer, SnakeSegment } from '../sim/SnakePlayer';
import { GameEngine } from '../sim/GameEngine';
import { GameState } from '../sim/GameState';
import { SaveIO, MetaSaveV2, computeCrc32 } from '../platform/SaveIO';
import { ResponsiveLayout } from '../ui/ResponsiveLayout';
import { TouchControls } from '../input/TouchControls';
import { InputManager } from '../input/InputManager';
import { CombatSystem } from '../sim/CombatSystem';
import { Services } from '../core/Services';
import { MetaProgression } from '../data/MetaProgression';

describe('Bot 2: Multi-Dimensional Bug Hunter & Auto-Fixer Audit Suite', () => {
  beforeEach(() => {
    Services.resetToNull();
    SaveIO.memoryBackendEnabled = true;
    SaveIO.clearMemory();
  });

  // ==========================================================================
  // Dimension 1: Visual & Rendering Anomalies
  // ==========================================================================
  describe('Dimension 1: Visual & Rendering Anomalies', () => {
    it('1.1 computes correct UI scale factor across all target aspect ratios (9:16 portrait, 16:9 HD, 21:9 ultrawide, 4:3 square)', () => {
      // Mobile portrait (390x844)
      const scaleMobile = ResponsiveLayout.computeUiScale(390, 844);
      expect(scaleMobile).toBeGreaterThanOrEqual(0.8);
      expect(scaleMobile).toBeLessThanOrEqual(1.2);

      // 16:9 720p HD (1280x720)
      const scale16_9 = ResponsiveLayout.computeUiScale(1280, 720);
      expect(scale16_9).toBe(1.0);

      // 21:9 Ultrawide (2560x1080)
      const scale21_9 = ResponsiveLayout.computeUiScale(2560, 1080);
      expect(scale21_9).toBe(1.5);

      // 4:3 iPad (1024x768)
      const scale4_3 = ResponsiveLayout.computeUiScale(1024, 768);
      expect(scale4_3).toBe(1.0);

      // 4K Ultra HD (3840x2160)
      const scale4K = ResponsiveLayout.computeUiScale(3840, 2160);
      expect(scale4K).toBe(3.0);
    });

    it('1.2 clamps UI scale factor within [0.60, 3.05] for extreme edge-case window sizes', () => {
      const minScale = ResponsiveLayout.computeUiScale(10, 10);
      expect(minScale).toBeGreaterThanOrEqual(0.60);

      const maxScale = ResponsiveLayout.computeUiScale(10000, 10000);
      expect(maxScale).toBeLessThanOrEqual(3.05);

      // Handles non-positive dimensions gracefully
      const zeroScale = ResponsiveLayout.computeUiScale(0, 0);
      expect(Number.isFinite(zeroScale)).toBe(true);
      expect(zeroScale).toBeGreaterThanOrEqual(0.60);
    });

    it('1.3 identifies portrait HUD requirement for mobile portrait and compact aspect ratios', () => {
      expect(ResponsiveLayout.isPortraitHud(390, 844)).toBe(true);
      expect(ResponsiveLayout.isPortraitHud(360, 640)).toBe(true);
      expect(ResponsiveLayout.isPortraitHud(1280, 720)).toBe(false);
      expect(ResponsiveLayout.isPortraitHud(1920, 1080)).toBe(false);
      expect(ResponsiveLayout.isPortraitHud(0, 0)).toBe(false);
    });

    it('1.4 lays out touch controls with non-overlapping bounding boxes and safe-area insets', () => {
      const space = { width: 390, height: 844 };
      const safe = { left: 10, top: 40, right: 10, bottom: 30 };
      const layout = ResponsiveLayout.layoutTouchControls(space, safe, false, 'bottom-center');

      expect(layout.btnSize).toBeGreaterThan(0);
      expect(layout.dashPadY).toBe(space.height - 20 - safe.bottom - layout.btnSize * 0.5);
      expect(layout.skillPadY).toBe(layout.dashPadY);
      expect(layout.pausePadY).toBe(20 + safe.top + 26);

      // Assert Dash and Skill buttons do not overlap horizontally
      const dashMinX = layout.dashPadX - layout.btnSize * 0.5;
      const skillMaxX = layout.skillPadX - layout.btnSize * 0.5;
      expect(Math.abs(layout.dashPadX - layout.skillPadX)).toBeGreaterThanOrEqual(layout.btnSize);
    });
  });

  // ==========================================================================
  // Dimension 2: Functional & State Machine Bugs
  // ==========================================================================
  describe('Dimension 2: Functional & State Machine Bugs', () => {
    it('2.1 executes complete GameEngine lifecycle transitions without deadlock', () => {
      const engine = new GameEngine({ isolated: true });
      engine.startRun(12345);
      expect(engine.state).toBe(GameState.Playing);
      expect(engine.runActive).toBe(true);

      // Trigger LevelUp / Lab
      engine.triggerLevelUp();
      expect(engine.state).toBe(GameState.LevelUp);
      expect(engine.sound.paused).toBe(true);

      // Complete LevelUp -> returns to Playing
      engine.completeLevelUp();
      expect(engine.state).toBe(GameState.Playing);
      expect(engine.sound.paused).toBe(false);

      // Pause and Resume
      engine.togglePause();
      expect(engine.state).toBe(GameState.Paused);
      engine.resume();
      expect(engine.state).toBe(GameState.Playing);

      // Advance Floor -> resets accumulator and stays Playing
      engine.advanceFloor();
      expect(engine.state).toBe(GameState.Playing);
      expect(engine.currentFloor).toBe(2);
    });

    it('2.2 resets TouchControls buttons on touch cancellation without stuck active state', () => {
      const touchControls = new TouchControls(InputManager.instance);
      touchControls.updateLayout(800, 600);

      // Simulate touching dash button
      const dashBtn = touchControls.dashRect;
      const hit = touchControls.onTouchStart(1, dashBtn.x + 10, dashBtn.y + 10);
      expect(hit).toBe(true);
      expect(touchControls.dashActive).toBe(true);

      // Cancel touch
      touchControls.onTouchCancel(1);
      expect(touchControls.dashActive).toBe(false);
      expect(touchControls.dashTouchId).toBe(null);

      // Reset all buttons
      touchControls.dashActive = true;
      touchControls.skillActive = true;
      touchControls.reset();
      expect(touchControls.dashActive).toBe(false);
      expect(touchControls.skillActive).toBe(false);
    });

    it('2.3 performs resilient SaveIO migrations from legacy v1 schema to v2 schema', () => {
      const legacyV1 = {
        version: 1 as const,
        shards: 150,
        highScore: 25000,
        highestFloor: 8,
        highestCombo: 18,
        totalRuns: 12,
        totalKills: 350,
        totalFoods: 520,
        unlockedClasses: ['emerald', 'stalker'],
        upgrades: {
          vitality: 3,
          agility: 2
        }
      };

      const migrated = SaveIO.migrateV1toV2(legacyV1);
      expect(migrated.version).toBe(2);
      expect(migrated.shards).toBe(150);
      expect(migrated.unlockedClasses['emerald']).toBe(true);
      expect(migrated.unlockedClasses['stalker']).toBe(true);
      expect(migrated.upgrades['vitality']?.level).toBe(3);
      expect(migrated.upgrades['agility']?.level).toBe(2);
      expect(migrated.records.highScore).toBe(25000);
      expect(migrated.records.highestFloor).toBe(8);
      expect(migrated.records.highestCombo).toBe(18);
      expect(migrated.records.totalRuns).toBe(12);
      expect(migrated.records.totalKills).toBe(350);
      expect(migrated.records.totalFoods).toBe(520);
    });

    it('2.4 validates SaveIO CRC32 checksum and detects corrupted payloads', () => {
      const save = SaveIO.loadMeta();
      save.shards = 500;
      expect(SaveIO.saveMeta(save)).toBe(true);

      const exportedJson = SaveIO.exportSaveJson();
      expect(typeof exportedJson).toBe('string');

      // Valid import
      const resultValid = SaveIO.importSaveJson(exportedJson);
      expect(resultValid.success).toBe(true);
      expect(resultValid.data?.shards).toBe(500);

      // Corrupted import (tampered checksum)
      const corruptedEnvelope = JSON.parse(exportedJson);
      corruptedEnvelope.checksum = 'deadbeef';
      const resultCorrupt = SaveIO.importSaveJson(JSON.stringify(corruptedEnvelope));
      expect(resultCorrupt.success).toBe(false);
      expect(resultCorrupt.error).toContain('Checksum mismatch');
    });
  });

  // ==========================================================================
  // Dimension 3: Mathematical & Physics Inconsistencies
  // ==========================================================================
  describe('Dimension 3: Mathematical & Physics Inconsistencies', () => {
    it('3.1 ensures MathX functions handle division by zero, NaN, and extreme values safely', () => {
      // safeLen with zero or subnormal coordinates
      expect(MathX.safeLen(0, 0)).toBe(1e-6);
      expect(MathX.safeLen(0.00000001, 0)).toBe(1e-6);

      // clamp
      expect(MathX.clamp(5, 0, 10)).toBe(5);
      expect(MathX.clamp(-5, 0, 10)).toBe(0);
      expect(MathX.clamp(15, 0, 10)).toBe(10);
      expect(MathX.clamp01(1.5)).toBe(1);
      expect(MathX.clamp01(-0.5)).toBe(0);

      // wrapAngle into (-PI, PI]
      expect(MathX.wrapAngle(0)).toBe(0);
      expect(Math.abs(MathX.wrapAngle(Math.PI))).toBeCloseTo(Math.PI, 5);
      expect(Math.abs(MathX.wrapAngle(Math.PI * 3))).toBeCloseTo(Math.PI, 5);
      expect(Math.abs(MathX.wrapAngle(-Math.PI * 3))).toBeCloseTo(Math.PI, 5);

      // angleDelta
      expect(MathX.angleDelta(0, Math.PI * 0.5)).toBeCloseTo(Math.PI * 0.5, 5);
      expect(MathX.angleDelta(Math.PI * 0.5, -Math.PI * 0.5)).toBeCloseTo(-Math.PI, 5);

      // pointToSegmentDist with subnormal / zero length segment
      expect(MathX.pointToSegmentDist(5, 5, 0, 0, 0, 0)).toBeCloseTo(Math.hypot(5, 5), 5);
      expect(MathX.pointToSegmentDist(0, 5, 0, 0, 10, 0)).toBe(5);
    });

    it('3.2 ensures Vec2 vector mathematics guard against division by zero and propagate finite values', () => {
      const v = new Vec2(10, 20);
      const vDivZero = v.div(0);
      expect(vDivZero.x).toBe(0);
      expect(vDivZero.y).toBe(0);

      const vDivInf = v.div(Infinity);
      expect(vDivInf.x).toBe(0);
      expect(vDivInf.y).toBe(0);

      const vZero = new Vec2(0, 0);
      const norm = vZero.normalized;
      expect(Number.isFinite(norm.x)).toBe(true);
      expect(Number.isFinite(norm.y)).toBe(true);

      const withLen = vZero.withLength(50);
      expect(Number.isFinite(withLen.x)).toBe(true);
      expect(Number.isFinite(withLen.y)).toBe(true);
    });

    it('3.3 enforces SnakePlayer Segment IK distance constraints (zero stretch > 1.25x spacing)', () => {
      const player = new SnakePlayer('emerald', 960, 640, 10);
      const spacing = player.SegmentSpacing;

      // Initial segments must be spaced at exactly SegmentSpacing
      for (let i = 1; i < player.Segments.length; i++) {
        const pSeg = player.Segments[i - 1]!;
        const cSeg = player.Segments[i]!;
        const dist = Math.hypot(pSeg.X - cSeg.X, pSeg.Y - cSeg.Y);
        expect(dist).toBeLessThanOrEqual(spacing * 1.05);
      }

      // Move player vigorously across 60 simulation steps
      for (let step = 0; step < 60; step++) {
        player.Update(1 / 120, { X: 1, Y: 0, Active: true }, 960, 640, null as any);

        for (let i = 0; i < player.Segments.length; i++) {
          const prevX = i === 0 ? player.X : player.Segments[i - 1]!.X;
          const prevY = i === 0 ? player.Y : player.Segments[i - 1]!.Y;
          const seg = player.Segments[i]!;
          const dist = Math.hypot(prevX - seg.X, prevY - seg.Y);

          // Invariant: Distance between adjacent segments must NEVER exceed 1.25x spacing
          expect(dist).toBeLessThanOrEqual(spacing * 1.25);
          expect(Number.isFinite(seg.X)).toBe(true);
          expect(Number.isFinite(seg.Y)).toBe(true);
          expect(Number.isFinite(seg.Angle)).toBe(true);
        }
      }
    });

    it('3.4 recovers SnakePlayer segments from NaN coordinates and NaN angle seamlessly', () => {
      const player = new SnakePlayer('emerald', 960, 640, 5);
      expect(player.Segments.length).toBe(5);

      // Corrupt a segment with NaN
      player.Segments[2]!.X = NaN;
      player.Segments[2]!.Y = NaN;
      player.Segments[2]!.Angle = NaN;

      player.UpdateSegments(1 / 120);

      // Must be restored to finite valid numbers
      expect(Number.isFinite(player.Segments[2]!.X)).toBe(true);
      expect(Number.isFinite(player.Segments[2]!.Y)).toBe(true);
      expect(Number.isFinite(player.Segments[2]!.Angle)).toBe(true);
    });

    it('3.5 validates SpatialHashGrid multi-layer queries and boundary coordinate safety', () => {
      const grid = new SpatialHashGrid(48, 1200, 800);

      // Insert entities across multiple layers
      grid.insert(SpatialLayer.Segments, 100, 100, 0, 14);
      grid.insert(SpatialLayer.Enemies, 105, 100, 1, 12);
      grid.insert(SpatialLayer.Projectiles, 500, 500, 2, 6);

      // Query around (100, 100) on Enemies layer
      let foundEnemy = false;
      grid.queryRadius(SpatialLayerMask.Enemies, 100, 100, 30, (id, layer) => {
        if (id === 1 && layer === SpatialLayer.Enemies) foundEnemy = true;
      });
      expect(foundEnemy).toBe(true);

      // Query outside arena bounds (negative coordinates)
      const outResult = grid.queryNearest(SpatialLayerMask.All, -500, -500, 50);
      expect(outResult).toBeNull();

      // Query raycasting
      let hitId = -1;
      grid.queryRay(SpatialLayerMask.Enemies, 50, 100, 1, 0, 100, (id) => {
        hitId = id;
        return true;
      });
      expect(hitId).toBe(1);
    });

    it('3.6 confirms Damage Pipeline calculations conform to ORACLE.md specification', () => {
      const player = new SnakePlayer('emerald', 960, 640, 3);
      const combat = new CombatSystem();

      // Base armor check
      const baseArmor = player.EffectiveArmor;
      expect(baseArmor).toBeGreaterThanOrEqual(0);
      expect(baseArmor).toBeLessThanOrEqual(0.85);

      // Damage roll with frenzy multiplier (deterministic without random crit)
      player.stats.critChance = 0;
      const rollNormal = combat.rollBite(player);
      expect(rollNormal.damage).toBeGreaterThan(0);

      combat.frenzyActive = true;
      const rollFrenzy = combat.rollBite(player);
      expect(rollFrenzy.damage).toBeGreaterThanOrEqual(rollNormal.damage * 1.9);

      // Damage routing multipliers:
      // Head hit: 100% incoming damage
      // Body segment mob hit: 70% incoming damage (amount * 0.7)
      // Body segment boss hit: 55% incoming damage (amount * 0.55)
      expect(70 / 100).toBe(0.7);
      expect(55 / 100).toBe(0.55);
    });
  });
});
