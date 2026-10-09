import { describe, it, expect, beforeEach } from 'vitest';
import { MetaProgression } from '../data/MetaProgression';
import { Services } from '../core/Services';
import { NullFx, NullSound } from '../core/Contracts';

describe('Dynamic Gameboard-to-Length Scaling & Strict 10ner-Step Rounding', () => {
  let meta: MetaProgression;

  beforeEach(() => {
    Services.Sound = new NullSound();
    Services.Fx = new NullFx();
    Services.Headless = true;
    MetaProgression.ReadBackend = () => null;
    MetaProgression.WriteBackend = () => {};
    MetaProgression.DeleteBackend = () => {};
    MetaProgression.Instance = new MetaProgression();
    meta = MetaProgression.Instance;
  });

  describe('1. Strict 10ner-Step Rounding (RoundToTen)', () => {
    it('always rounds to the nearest multiple of 10 and clamps minimum to 10', () => {
      // Clamping to minimum 10:
      expect(MetaProgression.RoundToTen(0)).toBe(10);
      expect(MetaProgression.RoundToTen(-50)).toBe(10);
      expect(MetaProgression.RoundToTen(4)).toBe(10);
      expect(MetaProgression.RoundToTen(5)).toBe(10);
      expect(MetaProgression.RoundToTen(8)).toBe(10);
      expect(MetaProgression.RoundToTen(14)).toBe(10);

      // Rounding to nearest 10:
      expect(MetaProgression.RoundToTen(15)).toBe(20);
      expect(MetaProgression.RoundToTen(16)).toBe(20);
      expect(MetaProgression.RoundToTen(24)).toBe(20);
      expect(MetaProgression.RoundToTen(25)).toBe(30);
      expect(MetaProgression.RoundToTen(93)).toBe(90);
      expect(MetaProgression.RoundToTen(97)).toBe(100);
      expect(MetaProgression.RoundToTen(202.5)).toBe(200);
      expect(MetaProgression.RoundToTen(405)).toBe(410);
      expect(MetaProgression.RoundToTen(455.625)).toBe(460);
      expect(MetaProgression.RoundToTen(506.25)).toBe(510);
      expect(MetaProgression.RoundToTen(607.5)).toBe(610);
      expect(MetaProgression.RoundToTen(1834)).toBe(1830);

      // Verify strict divisibility:
      const testValues = [0, 7, 12, 33, 78, 125, 349, 999, 1532, 2048];
      for (const val of testValues) {
        const rounded = MetaProgression.RoundToTen(val);
        expect(rounded % 10).toBe(0);
        expect(rounded).toBeGreaterThanOrEqual(10);
      }
    });

    it('supports static roundToTen camelCase alias', () => {
      expect(MetaProgression.roundToTen(45)).toBe(50);
      expect(MetaProgression.roundToTen(2)).toBe(10);
    });
  });

  describe('2. Dynamic Gameboard-to-Length Scaling (GetScaledLengthRequirement)', () => {
    it('scales length according to area ratio against 1600x960 reference desktop', () => {
      // 1. Reference Desktop (1600x960, Area = 1,536,000, R = 1.0)
      const desktopCtx = { arenaW: 1600, arenaH: 960 };
      expect(meta.GetScaledLengthRequirement(35, desktopCtx)).toBe(35);
      expect(meta.GetScaledLengthRequirement(250, desktopCtx)).toBe(250);
      expect(meta.GetScaledLengthRequirement(300, desktopCtx)).toBe(300);
      expect(meta.GetScaledLengthRequirement(350, desktopCtx)).toBe(350);
      expect(meta.GetScaledLengthRequirement(600, desktopCtx)).toBe(600);
      expect(meta.GetScaledLengthRequirement(650, desktopCtx)).toBe(650);
      expect(meta.GetScaledLengthRequirement(800, desktopCtx)).toBe(800);
      expect(meta.GetScaledLengthRequirement(1200, desktopCtx)).toBe(1200);
      expect(meta.GetScaledLengthRequirement(1350, desktopCtx)).toBe(1350);
      expect(meta.GetScaledLengthRequirement(1500, desktopCtx)).toBe(1500);
      expect(meta.GetScaledLengthRequirement(1800, desktopCtx)).toBe(1800);

      // 2. Default Engine Arena (960x640, Area = 614,400, R = 0.4)
      const engineCtx = { arenaW: 960, arenaH: 640 };
      expect(meta.GetScaledLengthRequirement(35, engineCtx)).toBe(14);
      expect(meta.GetScaledLengthRequirement(250, engineCtx)).toBe(100);
      expect(meta.GetScaledLengthRequirement(300, engineCtx)).toBe(120);
      expect(meta.GetScaledLengthRequirement(350, engineCtx)).toBe(140);
      expect(meta.GetScaledLengthRequirement(600, engineCtx)).toBe(240);
      expect(meta.GetScaledLengthRequirement(650, engineCtx)).toBe(260);
      expect(meta.GetScaledLengthRequirement(800, engineCtx)).toBe(320);
      expect(meta.GetScaledLengthRequirement(1200, engineCtx)).toBe(480);
      expect(meta.GetScaledLengthRequirement(1350, engineCtx)).toBe(540);
      expect(meta.GetScaledLengthRequirement(1500, engineCtx)).toBe(600);
      expect(meta.GetScaledLengthRequirement(1800, engineCtx)).toBe(720);

      // 3. Mobile Portrait Arena (540x960, Area = 518,400, R = 0.3375)
      const mobileCtx = { arenaW: 540, arenaH: 960 };
      expect(meta.GetScaledLengthRequirement(35, mobileCtx)).toBe(12); // 35 * 0.3375 = 11.81 -> 12
      expect(meta.GetScaledLengthRequirement(250, mobileCtx)).toBe(80); // 250 * 0.3375 = 84.375 -> 80
      expect(meta.GetScaledLengthRequirement(300, mobileCtx)).toBe(100); // 300 * 0.3375 = 101.25 -> 100
      expect(meta.GetScaledLengthRequirement(350, mobileCtx)).toBe(120); // 350 * 0.3375 = 118.125 -> 120
      expect(meta.GetScaledLengthRequirement(600, mobileCtx)).toBe(200); // 600 * 0.3375 = 202.5 -> 200
      expect(meta.GetScaledLengthRequirement(650, mobileCtx)).toBe(220); // 650 * 0.3375 = 219.375 -> 220
      expect(meta.GetScaledLengthRequirement(800, mobileCtx)).toBe(270); // 800 * 0.3375 = 270 -> 270
      expect(meta.GetScaledLengthRequirement(1200, mobileCtx)).toBe(410); // 1200 * 0.3375 = 405 -> 410
      expect(meta.GetScaledLengthRequirement(1350, mobileCtx)).toBe(460); // 1350 * 0.3375 = 455.625 -> 460
      expect(meta.GetScaledLengthRequirement(1500, mobileCtx)).toBe(510); // 1500 * 0.3375 = 506.25 -> 510
      expect(meta.GetScaledLengthRequirement(1800, mobileCtx)).toBe(610); // 1800 * 0.3375 = 607.5 -> 610

      // 4. Clamping bounds: Minimum R = 0.12, Maximum R = 1.0
      const tinyCtx = { arenaW: 100, arenaH: 100 }; // area 10,000 -> ratio 0.0065 -> clamped to 0.12
      expect(meta.GetScaledLengthRequirement(35, tinyCtx)).toBe(10); // clamped minimum 10
      expect(meta.GetScaledLengthRequirement(250, tinyCtx)).toBe(30); // 250 * 0.12 = 30
      expect(meta.GetScaledLengthRequirement(1800, tinyCtx)).toBe(220); // 1800 * 0.12 = 216 -> 220

      const ultraWideCtx = { arenaW: 3840, arenaH: 2160 }; // area > 1,536,000 -> clamped to 1.0
      expect(meta.GetScaledLengthRequirement(35, ultraWideCtx)).toBe(35);
      expect(meta.GetScaledLengthRequirement(250, ultraWideCtx)).toBe(250);
      expect(meta.GetScaledLengthRequirement(1800, ultraWideCtx)).toBe(1800);
    });

    it('defaults to reference desktop dimensions when no engine or context is provided', () => {
      expect(meta.GetScaledLengthRequirement(35)).toBe(35);
      expect(meta.GetScaledLengthRequirement(250)).toBe(250);
      expect(meta.GetScaledLengthRequirement(350)).toBe(350);
      expect(meta.GetScaledLengthRequirement(600)).toBe(600);
      expect(meta.GetScaledLengthRequirement(1800)).toBe(1800);
    });
  });

  describe('3. Dynamic Challenge Descriptions & Tier Unlocks', () => {
    it('produces dynamic challenge description strings matching scaled requirements', () => {
      const desktopCtx = { arenaW: 1600, arenaH: 960 };
      const mobileCtx = { arenaW: 540, arenaH: 960 };

      // Plasma Mortar Tier 1 (Base 35)
      expect(meta.GetUpgradeChallengeDescription('plasma', 1, desktopCtx)).toBe('Reach Serpent Length 35 (scaled)');
      expect(meta.GetUpgradeChallengeDescription('plasma', 1, mobileCtx)).toBe('Reach Serpent Length 12 (scaled)');

      // Shield Tier 2 (Base 600)
      expect(meta.GetUpgradeChallengeDescription('shield', 2, desktopCtx)).toBe('Grow Serpent to Length 600');
      expect(meta.GetUpgradeChallengeDescription('shield', 2, mobileCtx)).toBe('Grow Serpent to Length 200');

      // Plasma Mortar Tier 2 (Base 800)
      expect(meta.GetUpgradeChallengeDescription('plasma', 2, desktopCtx)).toBe('Grow Serpent to Length 800');
      expect(meta.GetUpgradeChallengeDescription('plasma', 2, mobileCtx)).toBe('Grow Serpent to Length 270');

      // Shield Tier 3 (Base 1200)
      expect(meta.GetUpgradeChallengeDescription('shield', 3, desktopCtx)).toBe('Grow Serpent to Length 1200');
      expect(meta.GetUpgradeChallengeDescription('shield', 3, mobileCtx)).toBe('Grow Serpent to Length 410');

      // Laser Optics Tier 3 (Base 1800)
      expect(meta.GetUpgradeChallengeDescription('laser', 3, desktopCtx)).toBe('Grow Serpent to Length 1800');
      expect(meta.GetUpgradeChallengeDescription('laser', 3, mobileCtx)).toBe('Grow Serpent to Length 610');
    });

    it('evaluates unlock conditions using dynamic scaled thresholds', () => {
      const mobileCtx = { arenaW: 540, arenaH: 960 };

      // Plasma Tier 1 requires 12 on mobile
      expect(meta.IsTierUnlocked('plasma', 1, { ...mobileCtx, length: 11 })).toBe(false);
      expect(meta.IsTierUnlocked('plasma', 1, { ...mobileCtx, length: 12 })).toBe(true);

      meta.ResetRunUnlocks();
      // Shield Tier 2 requires 200 on mobile
      expect(meta.IsTierUnlocked('shield', 2, { ...mobileCtx, length: 199 })).toBe(false);
      expect(meta.IsTierUnlocked('shield', 2, { ...mobileCtx, length: 200 })).toBe(true);

      meta.ResetRunUnlocks();
      // Plasma Tier 2 requires 270 on mobile
      expect(meta.IsTierUnlocked('plasma', 2, { ...mobileCtx, length: 269 })).toBe(false);
      expect(meta.IsTierUnlocked('plasma', 2, { ...mobileCtx, length: 270 })).toBe(true);

      meta.ResetRunUnlocks();
      // Laser Tier 3 requires 610 on mobile
      expect(meta.IsTierUnlocked('laser', 3, { ...mobileCtx, length: 609 })).toBe(false);
      expect(meta.IsTierUnlocked('laser', 3, { ...mobileCtx, length: 610 })).toBe(true);
    });
  });
});
