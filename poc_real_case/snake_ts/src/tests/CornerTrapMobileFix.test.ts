import { describe, it, expect, beforeEach } from 'vitest';
import { SnakePlayer } from '../sim/SnakePlayer';
import { VirtualStick } from '../input/VirtualStick';
import { InputManager } from '../input/InputManager';
import { Services } from '../core/Services';
import { NullSound, NullFx, ScriptedInput } from '../core/Contracts';
import { MetaProgression } from '../data/MetaProgression';

describe('Corner Trap Mobile Fix & 4-Corner Escape Conformance', () => {
  const arenaW = 960;
  const arenaH = 640;
  const dt = 1 / 120;

  beforeEach(() => {
    Services.Sound = new NullSound();
    Services.Fx = new NullFx();
    Services.Input = new ScriptedInput();
    MetaProgression.Instance.Reset();
  });

  describe('1. Bottom-Right Corner Reproduction & Escape Tests', () => {
    it('allows snake to steer inward towards arena center when placed at bottom-right corner', () => {
      const player = new SnakePlayer('emerald', 100, 100);
      const m = player.HeadRadius;

      // Position directly in bottom-right corner facing the corner
      player.X = arenaW - m;
      player.Y = arenaH - m;
      player.Angle = Math.PI / 4; // Facing directly into the bottom-right corner
      player.TargetAngle = Math.PI / 4;

      // Player steers up-left towards arena center
      const steer = { X: -1, Y: -1, Active: true };

      // Simulate 60 ticks (0.5 seconds of gameplay)
      for (let i = 0; i < 60; i++) {
        player.Update(dt, steer, arenaW, arenaH, null as any);
      }

      // Assert snake successfully moved away from both walls and towards arena center
      expect(player.X).toBeLessThan(arenaW - m - 5.0);
      expect(player.Y).toBeLessThan(arenaH - m - 5.0);
      // Angle should be oriented towards up-left (3rd quadrant: negative X and negative Y)
      expect(Math.cos(player.Angle)).toBeLessThan(0);
      expect(Math.sin(player.Angle)).toBeLessThan(0);
    });

    it('allows snake to passively deflect away from bottom-right corner without getting stuck', () => {
      const player = new SnakePlayer('emerald', 100, 100);
      const m = player.HeadRadius;

      // Position directly in bottom-right corner facing the corner, hands off controls
      player.X = arenaW - m;
      player.Y = arenaH - m;
      player.Angle = Math.PI / 4;
      player.TargetAngle = Math.PI / 4;

      const steer = { Active: false };

      // Simulate 60 ticks
      for (let i = 0; i < 60; i++) {
        player.Update(dt, steer, arenaW, arenaH, null as any);
      }

      // Must have escaped the trapped corner point (not still stuck exactly at (arenaW - m, arenaH - m))
      const distToCorner = Math.hypot((arenaW - m) - player.X, (arenaH - m) - player.Y);
      expect(distToCorner).toBeGreaterThan(15.0);
    });
  });

  describe('2. All 4 Arena Corners Conformance Matrix', () => {
    it('escapes Top-Left corner (m, m) under inward steering and passive deflection', () => {
      const player = new SnakePlayer('emerald', 100, 100);
      const m = player.HeadRadius;

      // Top-Left corner: facing top-left (-3pi/4)
      player.X = m;
      player.Y = m;
      player.Angle = -Math.PI * 0.75;
      player.TargetAngle = -Math.PI * 0.75;

      // Inward steering towards arena center (down-right: +1, +1)
      const steer = { X: 1, Y: 1, Active: true };
      for (let i = 0; i < 60; i++) {
        player.Update(dt, steer, arenaW, arenaH, null as any);
      }

      expect(player.X).toBeGreaterThan(m + 5.0);
      expect(player.Y).toBeGreaterThan(m + 5.0);
      expect(Math.cos(player.Angle)).toBeGreaterThan(0);
      expect(Math.sin(player.Angle)).toBeGreaterThan(0);
    });

    it('escapes Top-Right corner (arenaW - m, m) under inward steering and passive deflection', () => {
      const player = new SnakePlayer('emerald', 100, 100);
      const m = player.HeadRadius;

      // Top-Right corner: facing top-right (-pi/4)
      player.X = arenaW - m;
      player.Y = m;
      player.Angle = -Math.PI * 0.25;
      player.TargetAngle = -Math.PI * 0.25;

      // Inward steering towards arena center (down-left: -1, +1)
      const steer = { X: -1, Y: 1, Active: true };
      for (let i = 0; i < 60; i++) {
        player.Update(dt, steer, arenaW, arenaH, null as any);
      }

      expect(player.X).toBeLessThan(arenaW - m - 5.0);
      expect(player.Y).toBeGreaterThan(m + 5.0);
      expect(Math.cos(player.Angle)).toBeLessThan(0);
      expect(Math.sin(player.Angle)).toBeGreaterThan(0);
    });

    it('escapes Bottom-Left corner (m, arenaH - m) under inward steering and passive deflection', () => {
      const player = new SnakePlayer('emerald', 100, 100);
      const m = player.HeadRadius;

      // Bottom-Left corner: facing bottom-left (3pi/4)
      player.X = m;
      player.Y = arenaH - m;
      player.Angle = Math.PI * 0.75;
      player.TargetAngle = Math.PI * 0.75;

      // Inward steering towards arena center (up-right: +1, -1)
      const steer = { X: 1, Y: -1, Active: true };
      for (let i = 0; i < 60; i++) {
        player.Update(dt, steer, arenaW, arenaH, null as any);
      }

      expect(player.X).toBeGreaterThan(m + 5.0);
      expect(player.Y).toBeLessThan(arenaH - m - 5.0);
      expect(Math.cos(player.Angle)).toBeGreaterThan(0);
      expect(Math.sin(player.Angle)).toBeLessThan(0);
    });

    it('escapes all 4 corners under passive deflection without user steering', () => {
      const corners = [
        { name: 'Top-Left', x: 12, y: 12, angle: -Math.PI * 0.75 },
        { name: 'Top-Right', x: arenaW - 12, y: 12, angle: -Math.PI * 0.25 },
        { name: 'Bottom-Left', x: 12, y: arenaH - 12, angle: Math.PI * 0.75 },
        { name: 'Bottom-Right', x: arenaW - 12, y: arenaH - 12, angle: Math.PI * 0.25 },
      ];

      for (const c of corners) {
        const player = new SnakePlayer('emerald', 100, 100);
        player.HeadRadius = 12;
        player.X = c.x;
        player.Y = c.y;
        player.Angle = c.angle;
        player.TargetAngle = c.angle;

        for (let i = 0; i < 60; i++) {
          player.Update(dt, { Active: false }, arenaW, arenaH, null as any);
        }

        const dist = Math.hypot(player.X - c.x, player.Y - c.y);
        expect(dist, `Failed to escape ${c.name} passively`).toBeGreaterThan(15.0);
      }
    });
  });

  describe('3. Deflect Tangent & TargetAngle Preservation Invariants', () => {
    it('calculates true horizontal tangent when deflecting head-on against bottom wall (nx=0, ny=-1)', () => {
      const player = new SnakePlayer('emerald', 100, 100);
      player.Angle = Math.PI / 2; // Moving straight down
      player.TargetAngle = Math.PI / 2;

      // Bottom wall inward normal: (0, -1)
      player.Deflect(0, -1);

      // Tangent vector (-ny, nx) = (1, 0), so angle should be 0 (horizontal), NOT pi/4 (diagonal)
      expect(player.Angle).toBeCloseTo(0, 3);
      expect(Math.sin(player.Angle)).toBeCloseTo(0, 3);
    });

    it('preserves inward TargetAngle when deflecting head-on against bottom wall', () => {
      const player = new SnakePlayer('emerald', 100, 100);
      player.Angle = Math.PI / 2; // Heading down into bottom wall
      player.TargetAngle = -Math.PI / 2; // Player steering UP into open arena (inward)

      // Bottom wall inward normal: (0, -1)
      player.Deflect(0, -1);

      // TargetAngle should NOT be overridden since player is actively steering inward (tdot >= 0)
      expect(player.TargetAngle).toBeCloseTo(-Math.PI / 2, 3);
    });
  });

  describe('4. VirtualStick Mobile Touch Steering Integration', () => {
    it('drives snake out of bottom-right corner via VirtualStick analog input', () => {
      const inputManager = new InputManager();
      const stick = new VirtualStick({ radius: 60, deadzoneFrac: 0.1 });
      stick.bind(inputManager);

      const player = new SnakePlayer('emerald', 100, 100);
      const m = player.HeadRadius;
      player.X = arenaW - m;
      player.Y = arenaH - m;
      player.Angle = Math.PI / 4;
      player.TargetAngle = Math.PI / 4;

      // Simulate thumb drag up-left on virtual stick
      stick.onTouchStart(1, 200, 400);
      stick.onTouchMove(1, 150, 350); // Drag up-left (-50, -50)

      expect(stick.active).toBe(true);
      expect(stick.vectorX).toBeLessThan(0);
      expect(stick.vectorY).toBeLessThan(0);

      const steer = { X: inputManager.DirX, Y: inputManager.DirY, Active: inputManager.HasDirection };
      expect(steer.Active).toBe(true);

      for (let i = 0; i < 60; i++) {
        player.Update(dt, steer, arenaW, arenaH, null as any);
      }

      expect(player.X).toBeLessThan(arenaW - m - 5.0);
      expect(player.Y).toBeLessThan(arenaH - m - 5.0);
    });
  });
});
