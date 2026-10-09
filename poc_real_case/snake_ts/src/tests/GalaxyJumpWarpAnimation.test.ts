/**
 * Ouroboros Ascension — Pure WebGL Hyperspace Galaxy Jump Warp Animation Test Suite
 *
 * Strict TDD test suite validating:
 *  1. Pure WebGL 2.0 fullscreen hyperspace warp tunnel overlay initialization.
 *  2. Sequential 4-phase cinematic timeline progression (Charge -> Hyperspace -> Rift Flash -> Resolve).
 *  3. Deterministic ticking and phase boundary evaluations.
 *  4. Clean onComplete() invocation upon 3.0s timeline resolution.
 *  5. Immediate skip() support via API, skip button click, and keyboard triggers (ESC / Space).
 *  6. Headless / mock resilience (gracefully executing when WebGL is unavailable or mocked).
 *  7. Clear outcome presentation: informative feedback on whether the jump yielded a Unique Helmet.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupMockDom, MockElement } from './MockDom.js';
import { GalaxyJumpWarpOverlay, WarpPhase } from '../render/webgl/GalaxyJumpWarpOverlay.js';
import { UNIQUE_HELMETS } from '../data/UniqueHelmetsData.js';
import { Services } from '../core/Services.js';

describe('Pure WebGL Procedural Hyperspace Galaxy Jump Warp Animation (TDD)', () => {
  let restoreDom: () => void;
  let container: HTMLElement;

  beforeEach(() => {
    restoreDom = setupMockDom();
    container = document.createElement('div');
    container.id = 'game-root';
    document.body.appendChild(container);
  });

  afterEach(() => {
    restoreDom();
  });

  describe('1. Overlay Construction & DOM Hierarchy', () => {
    it('creates an overlay with canvas, skip button, and cinematic status container', () => {
      const overlay = new GalaxyJumpWarpOverlay({ container });
      expect(overlay.element).not.toBeNull();
      expect(overlay.element.classList.contains('galaxy-jump-warp-overlay')).toBe(true);

      const canvas = overlay.element.querySelector('.galaxy-warp-canvas') as HTMLCanvasElement;
      expect(canvas).not.toBeNull();

      const skipBtn = overlay.element.querySelector('.btn-warp-skip') as HTMLButtonElement;
      expect(skipBtn).not.toBeNull();
      expect(skipBtn.textContent?.toUpperCase()).toContain('SKIP');

      const statusEl = overlay.element.querySelector('.warp-cinematic-status');
      expect(statusEl).not.toBeNull();

      // Ensure 2.39:1 letterbox bars are completely eliminated from DOM
      const topBar = overlay.element.querySelector('.warp-letterbox-top');
      const bottomBar = overlay.element.querySelector('.warp-letterbox-bottom');
      expect(topBar).toBeNull();
      expect(bottomBar).toBeNull();

      overlay.destroy();
    });

    it('attaches to document.body if no container is provided', () => {
      const overlay = new GalaxyJumpWarpOverlay();
      expect(overlay.element.parentElement).toBe(document.body);
      overlay.destroy();
    });
  });

  describe('2. Four-Phase Timeline Progression', () => {
    it('initializes in Phase 1 (Charge-up & Acceleration) at t = 0.0s', () => {
      const overlay = new GalaxyJumpWarpOverlay({ container });
      overlay.start();

      expect(overlay.elapsedTime).toBe(0.0);
      expect(overlay.currentPhase).toBe(WarpPhase.Charge);
      expect(overlay.phaseName).toBe('charge');
      expect(overlay.statusMessage.toUpperCase()).toContain('CHARG');
      expect(overlay.statusMessage.toUpperCase()).toContain('GALACTIC WARP DRIVE ENGAGED');

      overlay.destroy();
    });

    it('transitions smoothly through all 4 chronological phases via deterministic tick(dt)', () => {
      const overlay = new GalaxyJumpWarpOverlay({ container });
      overlay.start();

      // Phase 1: Charge-up & acceleration (0.0s - 1.2s)
      overlay.tick(0.6);
      expect(overlay.elapsedTime).toBeCloseTo(0.6, 2);
      expect(overlay.currentPhase).toBe(WarpPhase.Charge);
      expect(overlay.phaseProgress).toBeCloseTo(0.6 / 1.2, 2);

      // Phase 2: Full Hyperspace Warp (1.2s - 2.2s)
      overlay.tick(0.8); // total = 1.4s
      expect(overlay.elapsedTime).toBeCloseTo(1.4, 2);
      expect(overlay.currentPhase).toBe(WarpPhase.Hyperspace);
      expect(overlay.phaseName).toBe('hyperspace');
      expect(overlay.statusMessage.toUpperCase()).toContain('HYPERSPACE');
      expect(overlay.statusMessage.toUpperCase()).toContain('SECTOR JUMP IN PROGRESS');
      expect(overlay.phaseProgress).toBeCloseTo((1.4 - 1.2) / 1.0, 2);

      // Phase 3: Galactic Rift Shockwave & Blinding Cosmic Flash (2.2s - 2.6s)
      overlay.tick(1.0); // total = 2.4s
      expect(overlay.elapsedTime).toBeCloseTo(2.4, 2);
      expect(overlay.currentPhase).toBe(WarpPhase.Flash);
      expect(overlay.phaseName).toBe('flash');
      expect(overlay.statusMessage.toUpperCase()).toMatch(/RIFT|FLASH|SHOCKWAVE/);
      expect(overlay.phaseProgress).toBeCloseTo((2.4 - 2.2) / 0.4, 2);

      // Phase 4: Resolution & Settling (2.6s - 3.0s)
      overlay.tick(0.3); // total = 2.7s
      expect(overlay.elapsedTime).toBeCloseTo(2.7, 2);
      expect(overlay.currentPhase).toBe(WarpPhase.Resolve);
      expect(overlay.phaseName).toBe('resolve');
      expect(overlay.statusMessage.toUpperCase()).toMatch(/RESOLV|ARRIV|SECTOR|STABILIZ/);
      expect(overlay.phaseProgress).toBeCloseTo((2.7 - 2.6) / 0.4, 2);

      overlay.destroy();
    });
  });

  describe('3. Timeline Completion & onComplete() Callback', () => {
    it('triggers onComplete() exactly once when reaching full duration (3.0s)', () => {
      const onComplete = vi.fn();
      const overlay = new GalaxyJumpWarpOverlay({ container, onComplete });
      overlay.start();

      overlay.tick(1.5);
      expect(onComplete).not.toHaveBeenCalled();

      overlay.tick(1.5); // total 3.0s
      expect(onComplete).toHaveBeenCalledTimes(1);
      expect(overlay.isFinished).toBe(true);

      // Subsequent ticks do not trigger callback again
      overlay.tick(0.5);
      expect(onComplete).toHaveBeenCalledTimes(1);

      overlay.destroy();
    });

    it('supports passing onComplete callback directly into start(onComplete)', () => {
      const dynamicOnComplete = vi.fn();
      const overlay = new GalaxyJumpWarpOverlay({ container });
      overlay.start(dynamicOnComplete);

      overlay.tick(3.1);
      expect(dynamicOnComplete).toHaveBeenCalledTimes(1);
      expect(overlay.isFinished).toBe(true);
    });

    it('unmounts overlay from DOM upon natural completion', () => {
      const overlay = new GalaxyJumpWarpOverlay({ container });
      overlay.start();

      expect(container.contains(overlay.element)).toBe(true);
      overlay.tick(3.1);

      expect(overlay.isFinished).toBe(true);
      expect(container.contains(overlay.element)).toBe(false);
    });
  });

  describe('4. Early Skip Functionality', () => {
    it('immediately finishes and invokes onComplete() when skip() is called', () => {
      const onComplete = vi.fn();
      const overlay = new GalaxyJumpWarpOverlay({ container, onComplete });
      overlay.start();

      overlay.tick(0.5); // Mid Phase 1
      overlay.skip();

      expect(overlay.isFinished).toBe(true);
      expect(onComplete).toHaveBeenCalledTimes(1);
      expect(container.contains(overlay.element)).toBe(false);
    });

    it('skips when the skip button is clicked', () => {
      const onComplete = vi.fn();
      const overlay = new GalaxyJumpWarpOverlay({ container, onComplete });
      overlay.start();

      const skipBtn = overlay.element.querySelector('.btn-warp-skip') as HTMLButtonElement;
      expect(skipBtn).not.toBeNull();
      skipBtn.click();

      expect(overlay.isFinished).toBe(true);
      expect(onComplete).toHaveBeenCalledTimes(1);
    });

    it('skips on Escape or Space keydown', () => {
      const onComplete = vi.fn();
      const overlay = new GalaxyJumpWarpOverlay({ container, onComplete });
      overlay.start();

      const escEvent = new KeyboardEvent('keydown', { key: 'Escape' });
      window.dispatchEvent(escEvent);

      expect(overlay.isFinished).toBe(true);
      expect(onComplete).toHaveBeenCalledTimes(1);
    });
  });

  describe('5. Static play() Helper', () => {
    it('mounts, plays, and invokes callback cleanly via GalaxyJumpWarpOverlay.play()', () => {
      const onComplete = vi.fn();
      const overlay = GalaxyJumpWarpOverlay.play(container, onComplete);

      expect(overlay).toBeInstanceOf(GalaxyJumpWarpOverlay);
      expect(container.contains(overlay.element)).toBe(true);

      overlay.skip();
      expect(onComplete).toHaveBeenCalledTimes(1);
      expect(container.contains(overlay.element)).toBe(false);
    });
  });

  describe('6. Headless / Mock Resilience', () => {
    it('handles headless execution without WebGL context without crashing', () => {
      const onComplete = vi.fn();
      // In mock DOM, getContext may return null or mock
      const overlay = new GalaxyJumpWarpOverlay({ container, onComplete });
      expect(() => {
        overlay.start();
        overlay.tick(1.0);
        overlay.render();
      }).not.toThrow();

      overlay.skip();
      expect(onComplete).toHaveBeenCalledTimes(1);
    });

    it('instantly invokes onComplete when duration is set to 0 for instant test runs', () => {
      const onComplete = vi.fn();
      const overlay = new GalaxyJumpWarpOverlay({ container, duration: 0, onComplete });
      overlay.start();
      expect(onComplete).toHaveBeenCalledTimes(1);
      expect(overlay.isFinished).toBe(true);
    });
  });

  describe('7. Unique Helmet Creation Outcome Presentation', () => {
    it('displays triumphant helmet manifestation information when jump succeeds', () => {
      const awardedHelmet = UNIQUE_HELMETS[0];
      const overlay = new GalaxyJumpWarpOverlay({
        container,
        result: {
          success: true,
          awardedHelmet,
          sacrificeScore: 850,
        },
      });
      overlay.start();

      // Tick to resolution phase where result banner is displayed
      overlay.tick(2.7);

      const resultEl = overlay.element.querySelector('.warp-result-panel');
      expect(resultEl).not.toBeNull();
      expect(resultEl?.textContent).toContain(awardedHelmet.Name);
      expect(resultEl?.textContent).toContain(awardedHelmet.Icon);
      expect(resultEl?.textContent?.toUpperCase()).toContain('UNIQUE HELMET');

      overlay.destroy();
    });

    it('displays clear void consumption information when jump fails to create a helmet', () => {
      const overlay = new GalaxyJumpWarpOverlay({
        container,
        result: {
          success: false,
          awardedHelmet: null,
          sacrificeScore: 120,
        },
      });
      overlay.start();

      overlay.tick(2.7);

      const resultEl = overlay.element.querySelector('.warp-result-panel');
      expect(resultEl).not.toBeNull();
      expect(resultEl?.textContent?.toUpperCase()).toMatch(/NO UNIQUE HELMET|CONSUMED|VOID/);
      expect(resultEl?.textContent).toContain('120');

      overlay.destroy();
    });
  });

  describe('8. Futuristic Sci-Fi Telemetry HUD & Relativistic Dynamics', () => {
    it('renders cybernetic telemetry HUD with dynamic warp factor, sector readout, and status', () => {
      const overlay = new GalaxyJumpWarpOverlay({ container });
      overlay.start();

      const telemetryHud = overlay.element.querySelector('.warp-telemetry-hud');
      expect(telemetryHud).not.toBeNull();

      const warpFactorEl = overlay.element.querySelector('.warp-telemetry-factor');
      expect(warpFactorEl).not.toBeNull();
      expect(warpFactorEl?.textContent?.toUpperCase()).toContain('WARP FACTOR');

      const sectorEl = overlay.element.querySelector('.warp-telemetry-sector');
      expect(sectorEl).not.toBeNull();
      expect(sectorEl?.textContent?.toUpperCase()).toMatch(/GALAXY SECTOR|DESTINATION/);

      // Verify status text in HUD
      expect(overlay.statusMessage.toUpperCase()).toContain('WARP');

      overlay.destroy();
    });

    it('dynamically calculates relativistic warp factor accelerating up to 9.8c in hyperspace', () => {
      const overlay = new GalaxyJumpWarpOverlay({ container });
      overlay.start();

      // At start: sub-light / initiating
      expect(overlay.warpFactor).toBeCloseTo(0.0, 1);

      // Mid Phase 1 (Charge & Acceleration: 0.6s): accelerating
      overlay.tick(0.6);
      expect(overlay.warpFactor).toBeGreaterThan(0.5);
      expect(overlay.warpFactor).toBeLessThan(5.0);

      // Phase 2 (Full Hyperspace: 1.7s): superluminal velocities reaching 9.8c
      overlay.tick(1.1); // total 1.7s
      expect(overlay.warpFactor).toBeGreaterThanOrEqual(7.0);
      expect(overlay.warpFactor).toBeLessThanOrEqual(10.0);

      // Phase 3 (Rift Shockwave & Flash: 2.3s): peak rupture velocity
      overlay.tick(0.6); // total 2.3s
      expect(overlay.warpFactor).toBeGreaterThanOrEqual(9.5);

      // Phase 4 (Resolve & Arrival: 2.8s): sub-light orbital insertion
      overlay.tick(0.5); // total 2.8s
      expect(overlay.warpFactor).toBeCloseTo(1.0, 1);

      overlay.destroy();
    });

    it('calculates procedural camera turbulence / shake during hyper-acceleration', () => {
      const overlay = new GalaxyJumpWarpOverlay({ container });
      overlay.start();

      expect(overlay.shakeIntensity).toBe(0.0);

      // Phase 1 (0.6s): turbulence begins
      overlay.tick(0.6);
      expect(overlay.shakeIntensity).toBeGreaterThan(0.0);

      // Phase 2 (1.7s): high hyperspace turbulence
      overlay.tick(1.1);
      expect(overlay.shakeIntensity).toBeGreaterThan(0.015);

      // Phase 4 (2.8s): smooth stabilization
      overlay.tick(1.1);
      expect(overlay.shakeIntensity).toBe(0.0);

      overlay.destroy();
    });

    it('calculates relativistic chromatic aberration intensifying with warp factor', () => {
      const overlay = new GalaxyJumpWarpOverlay({ container });
      overlay.start();

      // Starts at zero dispersion
      expect(overlay.chromaticAberration).toBe(0.0);

      // Accelerates in Phase 2
      overlay.tick(1.7);
      expect(overlay.chromaticAberration).toBeGreaterThan(0.5);
      expect(overlay.chromaticAberration).toBeLessThanOrEqual(1.0);

      overlay.destroy();
    });
  });

  describe('9. Fullscreen Immersion & Total Letterbox Elimination', () => {
    it('renders 100% fullscreen (100vw x 100vh) across arbitrary viewports with zero letterboxing', () => {
      const overlay = new GalaxyJumpWarpOverlay({ container });

      // 16:9 Standard 1080p Viewport (1920x1080)
      const dims16x9 = overlay.getFullscreenDimensions(1920, 1080);
      expect(dims16x9.width).toBe(1920);
      expect(dims16x9.height).toBe(1080);
      expect(dims16x9.isLetterboxed).toBe(false);
      expect(dims16x9.isFullscreen).toBe(true);

      // Exact Anamorphic Viewport (2390x1000)
      const dimsExact = overlay.getFullscreenDimensions(2390, 1000);
      expect(dimsExact.width).toBe(2390);
      expect(dimsExact.height).toBe(1000);
      expect(dimsExact.isLetterboxed).toBe(false);
      expect(dimsExact.isFullscreen).toBe(true);

      // Mobile Portrait 9:16 Viewport (1080x1920)
      const dimsPortrait = overlay.getFullscreenDimensions(1080, 1920);
      expect(dimsPortrait.width).toBe(1080);
      expect(dimsPortrait.height).toBe(1920);
      expect(dimsPortrait.isLetterboxed).toBe(false);
      expect(dimsPortrait.isFullscreen).toBe(true);

      overlay.destroy();
    });

    it('has zero letterbox bars in DOM element hierarchy', () => {
      const overlay = new GalaxyJumpWarpOverlay({ container });
      const topBar = overlay.element.querySelector('.warp-letterbox-top');
      const bottomBar = overlay.element.querySelector('.warp-letterbox-bottom');
      expect(topBar).toBeNull();
      expect(bottomBar).toBeNull();

      overlay.destroy();
    });

    it('getLetterboxDimensions returns zero barHeight and isLetterboxed false for compatibility', () => {
      const overlay = new GalaxyJumpWarpOverlay({ container });
      const dims = overlay.getLetterboxDimensions(1920, 1080);
      expect(dims.barHeight).toBe(0);
      expect(dims.viewportHeight).toBe(1080);
      expect(dims.isLetterboxed).toBe(false);

      overlay.destroy();
    });
  });

  describe('10. Procedural Audio Synchronization', () => {
    it('automatically invokes Services.Sound.playWarpJump() on start()', () => {
      const soundSpy = vi.fn();
      const originalPlay = (Services.Sound as any).playWarpJump;
      (Services.Sound as any).playWarpJump = soundSpy;

      try {
        const overlay = new GalaxyJumpWarpOverlay({ container });
        overlay.start();
        expect(soundSpy).toHaveBeenCalledTimes(1);
        overlay.destroy();
      } finally {
        (Services.Sound as any).playWarpJump = originalPlay;
      }
    });
  });

  describe('11. Pure WebGL Hardware Shaders & Uniform Pipeline', () => {
    it('initializes WebGL 2.0 / WebGL 1.0 shader program and binds all required uniforms', () => {
      const overlay = new GalaxyJumpWarpOverlay({ container });
      const gl = (overlay as any).gl;
      expect(gl).not.toBeNull();

      const program = (overlay as any).program;
      expect(program).not.toBeNull();

      // Verify uniform locations were queried
      expect((overlay as any).uTimeLoc).not.toBeNull();
      expect((overlay as any).uResolutionLoc).not.toBeNull();
      expect((overlay as any).uPhaseLoc).not.toBeNull();
      expect((overlay as any).uPhaseProgressLoc).not.toBeNull();
      expect((overlay as any).uFlashIntensityLoc).not.toBeNull();
      expect((overlay as any).uWarpFactorLoc).not.toBeNull();
      expect((overlay as any).uShakeIntensityLoc).not.toBeNull();
      expect((overlay as any).uChromaticAberrationLoc).not.toBeNull();

      // Verify Cyber-Emerald Art Direction Color Uniforms
      expect((overlay as any).uPrimaryColorLoc).not.toBeNull();
      expect((overlay as any).uSecondaryColorLoc).not.toBeNull();
      expect((overlay as any).uCoreColorLoc).not.toBeNull();
      expect((overlay as any).uGoldPlasmaColorLoc).not.toBeNull();
      expect((overlay as any).uDeepJadeColorLoc).not.toBeNull();
      expect((overlay as any).uDarkTealColorLoc).not.toBeNull();

      // Render a frame to verify zero exceptions
      expect(() => overlay.render()).not.toThrow();

      overlay.destroy();
    });
  });

  describe('12. Cyber-Emerald & Cosmic Neon Green Art Direction', () => {
    it('anchors primary and secondary colors in cyber-emerald (#00f0b5) and cosmic neon green (#05ffa1)', () => {
      const overlay = new GalaxyJumpWarpOverlay({ container });
      expect(overlay.primaryColor).toEqual([0.0, 0.941, 0.710]); // #00f0b5 Cyber-Emerald
      expect(overlay.secondaryColor).toEqual([0.020, 1.0, 0.631]); // #05ffa1 Cosmic Neon Green
      expect(overlay.coreColor).toEqual([0.008, 0.012, 0.024]); // #020306 Obsidian Core
      expect(overlay.goldPlasmaColor).toEqual([1.0, 0.82, 0.40]); // Mythic Gold Plasma
      expect(overlay.deepJadeColor).toEqual([0.04, 0.24, 0.18]); // Deep Jade Green
      expect(overlay.darkTealColor).toEqual([0.02, 0.18, 0.20]); // Dark Teal

      overlay.destroy();
    });

    it('streamlines cybernetic telemetry HUD with neon green titles and responsive skip button', () => {
      const overlay = new GalaxyJumpWarpOverlay({ container });
      const driveTitle = overlay.element.querySelector('.warp-drive-title');
      expect(driveTitle).not.toBeNull();
      expect(driveTitle?.textContent).toContain('✦ GALACTIC WARP DRIVE ENGAGED');

      const skipBtn = overlay.element.querySelector('.btn-warp-skip') as HTMLButtonElement;
      expect(skipBtn).not.toBeNull();
      expect(skipBtn.textContent).toContain('ESC / TAP TO SKIP');

      overlay.destroy();
    });

    it('displays sector jump telemetry message during Phase 2', () => {
      const overlay = new GalaxyJumpWarpOverlay({ container });
      overlay.start();
      overlay.tick(1.4); // Phase 2: Hyperspace
      expect(overlay.statusMessage).toContain('SECTOR JUMP IN PROGRESS');
      expect(overlay.phaseName).toBe('hyperspace');

      overlay.destroy();
    });
  });
});



