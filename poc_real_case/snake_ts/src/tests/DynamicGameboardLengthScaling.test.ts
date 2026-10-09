/**
 * Dynamic Gameboard Length Scaling & 10ner-Step Rounding Test Suite
 *
 * Validates dynamic gameboard-to-length ratio scaling across:
 * 1. Desktop arena (1600x960) producing base lengths (250, 600, 800, 1500, 1800).
 * 2. Mobile portrait arena (540x960) dynamically downscaling lengths (~80, ~200, ~270, ~610).
 * 3. Ultra-compact arena (360x640) scaling lengths appropriately (40, 90, 120, 230, 270).
 * 4. Invariant assertion that for ANY arbitrary arena width/height, result is ALWAYS a strict multiple of 10 (lengthReq % 10 === 0 && lengthReq >= 10).
 * 5. Cranial Lab unlock evaluations dynamically adapting when arena dimensions change.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MetaProgression } from '../data/MetaProgression';
import { Services } from '../core/Services';
import { NullFx, NullSound } from '../core/Contracts';
import { GameEngine } from '../sim/GameEngine';
import { SnakePlayer, SnakeSegment } from '../sim/SnakePlayer';
import { setupMockDom } from './MockDom';
import { UiRoot } from '../ui/UiRoot';
import { SnakeLabScreen } from '../ui/screens/SnakeLabScreen';

describe('Dynamic Gameboard Length Scaling Test Suite', () => {
  let meta: MetaProgression;
  let teardownDom: () => void;

  beforeEach(() => {
    teardownDom = setupMockDom();
    Services.Sound = new NullSound();
    Services.Fx = new NullFx();
    Services.Headless = true;

    MetaProgression.ReadBackend = () => null;
    MetaProgression.WriteBackend = () => {};
    MetaProgression.DeleteBackend = () => {};
    MetaProgression.Instance = new MetaProgression();
    meta = MetaProgression.Instance;
  });

  afterEach(() => {
    teardownDom();
  });

  /* -------------------------------------------------------------------------
   * 1. DESKTOP ARENA (1600x960) BASE LENGTHS
   * ------------------------------------------------------------------------- */
  describe('1. Desktop Arena (1600x960) Base Lengths', () => {
    const desktopArena = { arenaW: 1600, arenaH: 960 };

    it('produces calibrated base lengths (250, 600, 800, 1500, 1800) at 1600x960 reference area', () => {
      // Tier 1 Base Lengths
      expect(meta.GetScaledLengthRequirement(35, desktopArena)).toBe(35);
      expect(meta.GetScaledLengthRequirement(250, desktopArena)).toBe(250);
      expect(meta.GetScaledLengthRequirement(300, desktopArena)).toBe(300);
      expect(meta.GetScaledLengthRequirement(350, desktopArena)).toBe(350);

      // Tier 2 Base Lengths
      expect(meta.GetScaledLengthRequirement(600, desktopArena)).toBe(600);
      expect(meta.GetScaledLengthRequirement(650, desktopArena)).toBe(650);
      expect(meta.GetScaledLengthRequirement(800, desktopArena)).toBe(800);

      // Tier 3 Base Lengths
      expect(meta.GetScaledLengthRequirement(1200, desktopArena)).toBe(1200);
      expect(meta.GetScaledLengthRequirement(1350, desktopArena)).toBe(1350);
      expect(meta.GetScaledLengthRequirement(1500, desktopArena)).toBe(1500);
      expect(meta.GetScaledLengthRequirement(1800, desktopArena)).toBe(1800);
    });

    it('formats challenge descriptions using unattenuated desktop base lengths', () => {
      expect(meta.GetUpgradeChallengeDescription('plasma', 1, desktopArena)).toBe('Reach Serpent Length 35 (scaled)');
      expect(meta.GetUpgradeChallengeDescription('shield', 2, desktopArena)).toBe('Grow Serpent to Length 600');
      expect(meta.GetUpgradeChallengeDescription('plasma', 2, desktopArena)).toBe('Grow Serpent to Length 800');
      expect(meta.GetUpgradeChallengeDescription('shield', 3, desktopArena)).toBe('Grow Serpent to Length 1200');
      expect(meta.GetUpgradeChallengeDescription('laser', 3, desktopArena)).toBe('Grow Serpent to Length 1800');
    });

    it('evaluates unlock criteria strictly at full desktop thresholds on 1600x960', () => {
      // Plasma Tier 1: 35
      expect(meta.IsTierUnlocked('plasma', 1, { ...desktopArena, length: 34 })).toBe(false);
      expect(meta.IsTierUnlocked('plasma', 1, { ...desktopArena, length: 35 })).toBe(true);

      // Shield Tier 2: 600
      meta.ResetRunUnlocks();
      expect(meta.IsTierUnlocked('shield', 2, { ...desktopArena, length: 599 })).toBe(false);
      expect(meta.IsTierUnlocked('shield', 2, { ...desktopArena, length: 600 })).toBe(true);

      // Laser Tier 3: 1800
      meta.ResetRunUnlocks();
      expect(meta.IsTierUnlocked('laser', 3, { ...desktopArena, length: 1799 })).toBe(false);
      expect(meta.IsTierUnlocked('laser', 3, { ...desktopArena, length: 1800 })).toBe(true);
    });
  });

  /* -------------------------------------------------------------------------
   * 2. MOBILE PORTRAIT ARENA (540x960) DYNAMIC DOWNSCALING
   * ------------------------------------------------------------------------- */
  describe('2. Mobile Portrait Arena (540x960) Dynamic Length Downscaling', () => {
    const mobileArena = { arenaW: 540, arenaH: 960 }; // Area = 518,400, Area Ratio = 0.3375

    it('scales length requirements down dynamically (~80, ~200, ~270, ~610)', () => {
      // Base 35 -> 35 * 0.3375 = 11.81 -> 12
      expect(meta.GetScaledLengthRequirement(35, mobileArena)).toBe(12);

      // Base 250 -> 250 * 0.3375 = 84.375 -> 80
      expect(meta.GetScaledLengthRequirement(250, mobileArena)).toBe(80);

      // Base 300 -> 300 * 0.3375 = 101.25 -> 100
      expect(meta.GetScaledLengthRequirement(300, mobileArena)).toBe(100);

      // Base 350 -> 350 * 0.3375 = 118.125 -> 120
      expect(meta.GetScaledLengthRequirement(350, mobileArena)).toBe(120);

      // Base 600 -> 600 * 0.3375 = 202.5 -> 200
      expect(meta.GetScaledLengthRequirement(600, mobileArena)).toBe(200);

      // Base 650 -> 650 * 0.3375 = 219.375 -> 220
      expect(meta.GetScaledLengthRequirement(650, mobileArena)).toBe(220);

      // Base 800 -> 800 * 0.3375 = 270.0 -> 270
      expect(meta.GetScaledLengthRequirement(800, mobileArena)).toBe(270);

      // Base 1200 -> 1200 * 0.3375 = 405.0 -> 410
      expect(meta.GetScaledLengthRequirement(1200, mobileArena)).toBe(410);

      // Base 1350 -> 1350 * 0.3375 = 455.625 -> 460
      expect(meta.GetScaledLengthRequirement(1350, mobileArena)).toBe(460);

      // Base 1500 -> 1500 * 0.3375 = 506.25 -> 510
      expect(meta.GetScaledLengthRequirement(1500, mobileArena)).toBe(510);

      // Base 1800 -> 1800 * 0.3375 = 607.5 -> 610
      expect(meta.GetScaledLengthRequirement(1800, mobileArena)).toBe(610);
    });

    it('updates challenge description text to dynamically reflect mobile scaled requirements', () => {
      expect(meta.GetUpgradeChallengeDescription('plasma', 1, mobileArena)).toBe('Reach Serpent Length 12 (scaled)');
      expect(meta.GetUpgradeChallengeDescription('shield', 2, mobileArena)).toBe('Grow Serpent to Length 200');
      expect(meta.GetUpgradeChallengeDescription('plasma', 2, mobileArena)).toBe('Grow Serpent to Length 270');
      expect(meta.GetUpgradeChallengeDescription('shield', 3, mobileArena)).toBe('Grow Serpent to Length 410');
      expect(meta.GetUpgradeChallengeDescription('laser', 3, mobileArena)).toBe('Grow Serpent to Length 610');
    });

    it('unlocks tiers when serpent reaches mobile scaled milestones', () => {
      // Plasma Tier 1: 12 on mobile
      expect(meta.IsTierUnlocked('plasma', 1, { ...mobileArena, length: 11 })).toBe(false);
      expect(meta.IsTierUnlocked('plasma', 1, { ...mobileArena, length: 12 })).toBe(true);

      // Shield Tier 2: 200 on mobile
      meta.ResetRunUnlocks();
      expect(meta.IsTierUnlocked('shield', 2, { ...mobileArena, length: 199 })).toBe(false);
      expect(meta.IsTierUnlocked('shield', 2, { ...mobileArena, length: 200 })).toBe(true);

      // Plasma Tier 2: 270 on mobile
      meta.ResetRunUnlocks();
      expect(meta.IsTierUnlocked('plasma', 2, { ...mobileArena, length: 269 })).toBe(false);
      expect(meta.IsTierUnlocked('plasma', 2, { ...mobileArena, length: 270 })).toBe(true);

      // Laser Tier 3: 610 on mobile
      meta.ResetRunUnlocks();
      expect(meta.IsTierUnlocked('laser', 3, { ...mobileArena, length: 609 })).toBe(false);
      expect(meta.IsTierUnlocked('laser', 3, { ...mobileArena, length: 610 })).toBe(true);
    });
  });

  /* -------------------------------------------------------------------------
   * 3. ULTRA-COMPACT ARENA (360x640) SCALING
   * ------------------------------------------------------------------------- */
  describe('3. Ultra-Compact Arena (360x640) Scaling & Clamping', () => {
    const compactArena = { arenaW: 360, arenaH: 640 }; // Area = 230,400, Area Ratio = 0.15

    it('scales length requirements down appropriately on ultra-compact 360x640 display', () => {
      // Base 250 -> 250 * 0.15 = 37.5 -> 40
      expect(meta.GetScaledLengthRequirement(250, compactArena)).toBe(40);

      // Base 600 -> 600 * 0.15 = 90.0 -> 90
      expect(meta.GetScaledLengthRequirement(600, compactArena)).toBe(90);

      // Base 800 -> 800 * 0.15 = 120.0 -> 120
      expect(meta.GetScaledLengthRequirement(800, compactArena)).toBe(120);

      // Base 1500 -> 1500 * 0.15 = 225.0 -> 230
      expect(meta.GetScaledLengthRequirement(1500, compactArena)).toBe(230);

      // Base 1800 -> 1800 * 0.15 = 270.0 -> 270
      expect(meta.GetScaledLengthRequirement(1800, compactArena)).toBe(270);
    });

    it('clamps scaling ratio gracefully between minimum 0.12 and maximum 1.0', () => {
      // Extremely small viewport (100x100, Area = 10,000 -> ratio 0.0065 clamped to 0.12)
      const tiny = { arenaW: 100, arenaH: 100 };
      expect(meta.GetScaledLengthRequirement(250, tiny)).toBe(30); // 250 * 0.12 = 30
      expect(meta.GetScaledLengthRequirement(600, tiny)).toBe(70); // 600 * 0.12 = 72 -> 70
      expect(meta.GetScaledLengthRequirement(1800, tiny)).toBe(220); // 1800 * 0.12 = 216 -> 220

      // Super-ultrawide (3840x1080 -> ratio 2.7 clamped to 1.0)
      const ultrawide = { arenaW: 3840, arenaH: 1080 };
      expect(meta.GetScaledLengthRequirement(250, ultrawide)).toBe(250);
      expect(meta.GetScaledLengthRequirement(1800, ultrawide)).toBe(1800);
    });
  });

  /* -------------------------------------------------------------------------
   * 4. STRICT MULTIPLE OF 10 INVARIANT
   * ------------------------------------------------------------------------- */
  describe('4. Invariant: Strict Multiple of 10 for Any Arbitrary Arena Dimensions', () => {
    it('guarantees lengthReq % 10 === 0 and lengthReq >= 10 for ANY arbitrary arena width/height', () => {
      const testDimensions = [
        { w: 320, h: 480 },
        { w: 360, h: 640 },
        { w: 375, h: 667 },
        { w: 390, h: 844 },
        { w: 412, h: 915 },
        { w: 540, h: 960 },
        { w: 720, h: 1280 },
        { w: 768, h: 1024 },
        { w: 800, h: 600 },
        { w: 960, h: 640 },
        { w: 1024, h: 768 },
        { w: 1280, h: 720 },
        { w: 1366, h: 768 },
        { w: 1440, h: 900 },
        { w: 1600, h: 960 },
        { w: 1920, h: 1080 },
        { w: 2560, h: 1440 },
        { w: 3440, h: 1440 },
        { w: 3840, h: 2160 },
        // Arbitrary fractional/odd dimensions
        { w: 477.5, h: 833.3 },
        { w: 999, h: 666 },
        { w: 1234, h: 567 },
        { w: 111, h: 222 },
        { w: 1536, h: 2048 },
      ];

      const baseLengths = [100, 250, 300, 350, 600, 650, 800, 1000, 1200, 1350, 1500, 1800, 2500];

      for (const dims of testDimensions) {
        for (const baseLen of baseLengths) {
          const req = meta.GetScaledLengthRequirement(baseLen, { arenaW: dims.w, arenaH: dims.h });

          // Invariant 1: Must be a strict integer multiple of 10
          expect(req % 10).toBe(0);

          // Invariant 2: Must be at least 10
          expect(req).toBeGreaterThanOrEqual(10);

          // Invariant 3: Must be an exact integer
          expect(Number.isInteger(req)).toBe(true);
        }
      }
    });

    it('RoundToTen helper always rounds properly and clamps to at least 10', () => {
      expect(MetaProgression.RoundToTen(0)).toBe(10);
      expect(MetaProgression.RoundToTen(-100)).toBe(10);
      expect(MetaProgression.RoundToTen(3)).toBe(10);
      expect(MetaProgression.RoundToTen(7)).toBe(10);
      expect(MetaProgression.RoundToTen(14)).toBe(10);
      expect(MetaProgression.RoundToTen(15)).toBe(20);
      expect(MetaProgression.RoundToTen(24)).toBe(20);
      expect(MetaProgression.RoundToTen(25)).toBe(30);
      expect(MetaProgression.RoundToTen(84.375)).toBe(80);
      expect(MetaProgression.RoundToTen(202.5)).toBe(200);
      expect(MetaProgression.RoundToTen(607.5)).toBe(610);
      expect(MetaProgression.RoundToTen(1834)).toBe(1830);
    });
  });

  /* -------------------------------------------------------------------------
   * 5. CRANIAL LAB ADAPTABILITY ON ARENA DIMENSION CHANGES
   * ------------------------------------------------------------------------- */
  describe('5. Cranial Lab Dynamic Adaptability on Arena Dimension Changes', () => {
    let engine: GameEngine;
    let uiRoot: UiRoot;
    let labScreen: SnakeLabScreen;

    beforeEach(() => {
      engine = new GameEngine(Services.Fx);
      Services.registerEngineProvider(() => engine);

      const container = document.createElement('div');
      uiRoot = UiRoot.init(container as any, engine);
      labScreen = new SnakeLabScreen(uiRoot);
      uiRoot.registerScreen(labScreen);
    });

    it('dynamically adapts unlock evaluations when arena dimensions change during gameplay', () => {
      engine.chooseMode('rogue');
      engine.selectedClass = 'emerald';
      engine.startRun();

      const player = engine.player!;
      player.xp = 500;

      // 1. Configure to Desktop Arena (1600x960)
      engine.ArenaW = 1600;
      engine.ArenaH = 960;

      // Grow serpent to length 200
      while (player.segments.length < 199) {
        player.segments.push(new SnakeSegment(player.x, player.y, 10, 100));
      }
      expect(player.segments.length + 1).toBe(200);

      // On Desktop (1600x960), Shield Lv2 requires 600 -> NOT unlocked with length 200
      expect(meta.IsTierUnlocked('shield', 2)).toBe(false);
      expect(meta.GetUpgradeChallengeDescription('shield', 2)).toBe('Grow Serpent to Length 600');

      // 2. Switch arena dimensions to Mobile Portrait (540x960)
      engine.ArenaW = 540;
      engine.ArenaH = 960;

      // On Mobile (540x960), Shield Lv2 requirement scales down to 200 -> Now unlocked!
      expect(meta.GetUpgradeChallengeDescription('shield', 2)).toBe('Grow Serpent to Length 200');
      expect(meta.IsTierUnlocked('shield', 2)).toBe(true);

      // 3. Test Cranial Lab screen reflects the new dynamic unlock state
      labScreen.show();
      labScreen.refresh();

      const buttons = labScreen.element.querySelectorAll('.lab-docked-card-container button.cyber-btn');
      const shieldBtn = Array.from(buttons).find(b => b.textContent?.includes('Carapace Shield')) as HTMLButtonElement;
      expect(shieldBtn).toBeDefined();

      // Shield is now unlocked and available for purchase
      expect(shieldBtn.disabled).toBe(false);
      expect(shieldBtn.textContent).not.toContain('TIER 2 LOCKED');
    });

    it('adapts when switching to ultra-compact arena (360x640)', () => {
      engine.chooseMode('rogue');
      engine.selectedClass = 'emerald';
      engine.startRun();

      const player = engine.player!;
      player.xp = 500;

      // Configure to ultra-compact (360x640)
      engine.ArenaW = 360;
      engine.ArenaH = 640;

      // Grow serpent to length 90
      while (player.segments.length < 89) {
        player.segments.push(new SnakeSegment(player.x, player.y, 10, 100));
      }
      expect(player.segments.length + 1).toBe(90);

      // On compact (360x640), Shield Lv2 requirement is 90 -> Unlocked!
      expect(meta.GetUpgradeChallengeDescription('shield', 2)).toBe('Grow Serpent to Length 90');
      expect(meta.IsTierUnlocked('shield', 2)).toBe(true);

      // Plasma Tier 1 requirement is 10 on ultra-compact -> Unlocked!
      expect(meta.GetUpgradeChallengeDescription('plasma', 1)).toBe('Reach Serpent Length 10 (scaled)');
      expect(meta.IsTierUnlocked('plasma', 1)).toBe(true);
    });
  });
});
