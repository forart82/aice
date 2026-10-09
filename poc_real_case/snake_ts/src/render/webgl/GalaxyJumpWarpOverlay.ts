/**
 * ============================================================================
 * Pure WebGL 2.0 Procedural Hyperspace Galaxy Jump Warp Animation Overlay
 * Ouroboros Ascension — Protocol 3.0 Commercial Engine Edition
 * ============================================================================
 *
 * Single Source of Truth (SSOT): ORACLE.md & AGENTS.md (Rule 6, Rule 10, Rule 12)
 *
 * ARCHITECTURAL SUMMARY:
 * ---------------------
 * `GalaxyJumpWarpOverlay` orchestrates a breathtaking, AAA cinematic sci-fi video-like
 * procedural hyperspace wormhole jump sequence when executing the Galaxy Jump sacrifice ritual.
 *
 * KEY ATTRIBUTES & COMPLIANCE:
 * 1. Rule 12 Absolute Pure WebGL Mandate: 100% WebGL 2.0 / WebGL 1.0 GLSL shader
 *    pipeline. Zero Canvas 2D contexts, shims, or fallbacks.
 * 2. AAA Cinematic Hyperspace Wormhole Tunnel:
 *    - 3D Perspective Wormhole: Ray-marched / multi-octave polar cylindrical warp tunnel
 *      with swirling cosmic nebula clouds, relativistic Doppler shift (blue/violet forward shift,
 *      red trailing shift), and hyper-dense starfield streaks flying past the camera.
 *    - Gravitational Lensing Vortex: Center singularity bending light and stars into an accretion disk.
 *    - Dynamic Relativistic Blur & Chromatic Dispersion: Radial RGB chromatic aberration that
 *      intensifies as warp factor accelerates up to 9.8c+.
 *    - Blinding Hypernova Rift Shockwave: Expanding plasma shockwave ring with radiant anamorphic
 *      lens flare and crepuscular god-rays as the rift ruptures into the new galaxy.
 *    - Arrival Panorama: Blinding flash dissipates into a stunning rotating logarithmic spiral
 *      galaxy backdrop with twinkling background stars.
 * 3. Cinematic Video Presentation Features:
 *    - 2.39:1 Anamorphic Widescreen Letterbox Bars (cinematic top/bottom film matte bars).
 *    - Camera Shake / Warp Turbulence: Procedural high-frequency vibration during hyper-acceleration.
 *    - Futuristic Sci-Fi Telemetry HUD: Sleek cybernetic readouts ("✦ WARP DRIVE ENGAGED",
 *      "WARP FACTOR: 9.8c", "WARPING SPACETIME CONTINUUM", "ENTERING GALAXY SECTOR 8").
 *    - Seamless Procedural Audio Integration: Automatically triggers `Services.Sound.playWarpJump()`
 *      for synchronized audio-visual crescendos.
 * 4. Human UX & Interactivity: Non-intrusive skip via Escape / Spacebar or UI button.
 * 5. Outcome Clarity: Displays prominent feedback informing the player whether their
 *    sacrifice manifested a Mythic Unique Helmet or was absorbed by the void.
 * 6. Headless Resilience: Gracefully falls back in headless/mocked test environments.
 */

import { UniqueHelmetDef } from '../../data/UniqueHelmetsData.js';
import { Services } from '../../core/Services.js';

/**
 * The 4 chronological phases of the Galaxy Jump Warp animation.
 */
export enum WarpPhase {
  Charge = 1,
  Hyperspace = 2,
  Flash = 3,
  Resolve = 4,
}

export type WarpPhaseName = 'charge' | 'hyperspace' | 'flash' | 'resolve';

/**
 * Result data passed to the overlay to present outcome feedback to the player.
 */
export interface IGalaxyJumpResult {
  success: boolean;
  awardedHelmet?: UniqueHelmetDef | null;
  sacrificeScore?: number;
  probability?: number;
}

/**
 * Configuration options for initializing the warp overlay.
 */
export interface IGalaxyJumpWarpOptions {
  container?: HTMLElement;
  duration?: number;
  onComplete?: () => void;
  result?: IGalaxyJumpResult;
}

/**
 * Fullscreen dimension specifications for 100vw x 100vh immersion.
 */
export interface IFullscreenDimensions {
  width: number;
  height: number;
  isFullscreen: boolean;
  isLetterboxed: boolean;
}

/**
 * Letterbox dimension specifications (retained for backward-compatibility).
 */
export interface ILetterboxDimensions {
  barHeight: number;
  viewportHeight: number;
  isLetterboxed: boolean;
  targetAspect: number;
}

export class GalaxyJumpWarpOverlay {
  public readonly element: HTMLElement;
  public readonly canvas: HTMLCanvasElement;
  private readonly container: HTMLElement;
  private readonly duration: number;
  private readonly onCompleteCb?: () => void;
  private dynamicOnComplete?: () => void;
  public readonly result?: IGalaxyJumpResult;

  // Core Art Direction Color Scheme Constants (Rule 6 & ORACLE.md)
  public readonly primaryColor: [number, number, number] = [0.0, 0.941, 0.710];    // #00f0b5 Cyber-Emerald
  public readonly secondaryColor: [number, number, number] = [0.020, 1.0, 0.631];  // #05ffa1 Cosmic Neon Green
  public readonly coreColor: [number, number, number] = [0.008, 0.012, 0.024];     // #020306 Obsidian Core
  public readonly goldPlasmaColor: [number, number, number] = [1.0, 0.82, 0.40];   // #ffd166 Mythic Gold Plasma
  public readonly deepJadeColor: [number, number, number] = [0.04, 0.24, 0.18];    // #0a3d2e Deep Jade Green
  public readonly darkTealColor: [number, number, number] = [0.02, 0.18, 0.20];    // #062e33 Dark Teal

  // Fullscreen State Indicators (Zero Letterboxing)
  public readonly isFullscreen: boolean = true;
  public readonly isLetterboxed: boolean = false;

  // WebGL 2.0 / WebGL 1.0 Hardware Pipeline
  private gl: WebGLRenderingContext | WebGL2RenderingContext | null = null;
  private program: WebGLProgram | null = null;
  private vertexBuffer: WebGLBuffer | null = null;
  private uTimeLoc: WebGLUniformLocation | null = null;
  private uResolutionLoc: WebGLUniformLocation | null = null;
  private uPhaseLoc: WebGLUniformLocation | null = null;
  private uPhaseProgressLoc: WebGLUniformLocation | null = null;
  private uFlashIntensityLoc: WebGLUniformLocation | null = null;
  private uWarpFactorLoc: WebGLUniformLocation | null = null;
  private uShakeIntensityLoc: WebGLUniformLocation | null = null;
  private uChromaticAberrationLoc: WebGLUniformLocation | null = null;

  // Art Direction Shader Uniform Locations
  private uPrimaryColorLoc: WebGLUniformLocation | null = null;
  private uSecondaryColorLoc: WebGLUniformLocation | null = null;
  private uCoreColorLoc: WebGLUniformLocation | null = null;
  private uGoldPlasmaColorLoc: WebGLUniformLocation | null = null;
  private uDeepJadeColorLoc: WebGLUniformLocation | null = null;
  private uDarkTealColorLoc: WebGLUniformLocation | null = null;

  // Animation State Machine
  public elapsedTime: number = 0.0;
  public isFinished: boolean = false;
  private isRunning: boolean = false;
  private animFrameId: number | null = null;
  private lastFrameTimestamp: number = 0;

  // DOM Sub-components & Streamlined Telemetry
  private readonly telemetryHud: HTMLElement;
  private readonly warpFactorEl: HTMLElement;
  private readonly sectorEl: HTMLElement;
  private readonly statusEl: HTMLElement;
  private readonly subTelemetryEl: HTMLElement;
  private readonly skipBtn: HTMLButtonElement;
  private resultPanelEl: HTMLElement | null = null;

  // Event handler references for cleanup
  private keydownHandler?: (e: KeyboardEvent) => void;
  private resizeHandler?: () => void;

  constructor(options: IGalaxyJumpWarpOptions = {}) {
    this.container = options.container || document.body;
    this.duration = options.duration ?? 3.0;
    this.onCompleteCb = options.onComplete;
    this.result = options.result;

    // 1. Build Fullscreen Dark Overlay Shell (100vw x 100vh, zero letterbox bars)
    this.element = document.createElement('div');
    this.element.className = 'galaxy-jump-warp-overlay galaxy-warp-overlay';
    this.applyOverlayStyles();

    // 2. Build WebGL Rendering Canvas (stretches to full screen dimensions)
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'galaxy-warp-canvas';
    this.canvas.style.position = 'absolute';
    this.canvas.style.inset = '0';
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.canvas.style.pointerEvents = 'none';
    this.canvas.style.zIndex = '10000';
    this.element.appendChild(this.canvas);

    // 3. Streamlined Futuristic Sci-Fi Cybernetic Telemetry HUD (anchored in Cyber-Emerald)
    this.telemetryHud = document.createElement('div');
    this.telemetryHud.className = 'warp-telemetry-hud';
    this.telemetryHud.style.position = 'absolute';
    this.telemetryHud.style.inset = '0';
    this.telemetryHud.style.zIndex = '10002';
    this.telemetryHud.style.pointerEvents = 'none';
    this.telemetryHud.style.display = 'flex';
    this.telemetryHud.style.flexDirection = 'column';
    this.telemetryHud.style.justifyContent = 'space-between';
    this.telemetryHud.style.padding = '24px 32px';
    this.telemetryHud.style.boxSizing = 'border-box';
    this.telemetryHud.style.fontFamily = 'monospace, "Courier New", sans-serif';
    this.telemetryHud.style.color = '#e2e8f0';
    this.telemetryHud.style.userSelect = 'none';

    // 3A. Header Row (Top-Left Drive Telemetry + Top-Right Responsive Skip)
    const topRow = document.createElement('div');
    topRow.style.display = 'flex';
    topRow.style.justifyContent = 'space-between';
    topRow.style.alignItems = 'flex-start';

    const topLeftBlock = document.createElement('div');
    topLeftBlock.style.display = 'flex';
    topLeftBlock.style.flexDirection = 'column';
    topLeftBlock.style.gap = '4px';

    const driveTitle = document.createElement('div');
    driveTitle.className = 'warp-drive-title';
    driveTitle.style.fontSize = '12px';
    driveTitle.style.letterSpacing = '3px';
    driveTitle.style.fontWeight = 'bold';
    driveTitle.style.color = '#00f0b5';
    driveTitle.style.textShadow = '0 0 10px rgba(0, 240, 181, 0.8)';
    driveTitle.textContent = '✦ GALACTIC WARP DRIVE ENGAGED';
    topLeftBlock.appendChild(driveTitle);

    this.warpFactorEl = document.createElement('div');
    this.warpFactorEl.className = 'warp-telemetry-factor';
    this.warpFactorEl.style.fontSize = '15px';
    this.warpFactorEl.style.letterSpacing = '2px';
    this.warpFactorEl.style.fontWeight = '900';
    this.warpFactorEl.style.color = '#05ffa1';
    this.warpFactorEl.style.textShadow = '0 0 15px rgba(5, 255, 161, 0.9)';
    this.warpFactorEl.textContent = 'WARP FACTOR: 0.0c';
    topLeftBlock.appendChild(this.warpFactorEl);

    const curvatureInfo = document.createElement('div');
    curvatureInfo.style.fontSize = '10px';
    curvatureInfo.style.letterSpacing = '1px';
    curvatureInfo.style.color = '#00f0b5';
    curvatureInfo.style.opacity = '0.7';
    curvatureInfo.textContent = 'SPACETIME CURVATURE: κ = 4.82e18 m⁻²';
    topLeftBlock.appendChild(curvatureInfo);

    topRow.appendChild(topLeftBlock);

    // Responsive Interactive Skip Button [ESC / TAP TO SKIP]
    this.skipBtn = document.createElement('button');
    this.skipBtn.className = 'cyber-btn btn-ghost btn-warp-skip btn-skip-warp';
    this.skipBtn.textContent = 'SKIP [ESC / TAP TO SKIP]';
    this.skipBtn.style.pointerEvents = 'auto';
    this.skipBtn.style.padding = '8px 18px';
    this.skipBtn.style.fontSize = '11px';
    this.skipBtn.style.fontWeight = 'bold';
    this.skipBtn.style.letterSpacing = '1.5px';
    this.skipBtn.style.background = 'rgba(2, 3, 6, 0.85)';
    this.skipBtn.style.border = '1px solid rgba(0, 240, 181, 0.5)';
    this.skipBtn.style.borderRadius = '4px';
    this.skipBtn.style.color = '#00f0b5';
    this.skipBtn.style.boxShadow = '0 0 12px rgba(0, 240, 181, 0.3)';
    this.skipBtn.style.cursor = 'pointer';
    this.skipBtn.style.transition = 'all 0.2s ease';
    this.skipBtn.addEventListener('click', () => this.skip());
    topRow.appendChild(this.skipBtn);

    this.telemetryHud.appendChild(topRow);

    // 3B. Center Cinematic Status Banner
    const centerBanner = document.createElement('div');
    centerBanner.style.alignSelf = 'center';
    centerBanner.style.textAlign = 'center';
    centerBanner.style.padding = '8px 24px';
    centerBanner.style.background = 'rgba(2, 3, 6, 0.8)';
    centerBanner.style.border = '1px solid rgba(0, 240, 181, 0.4)';
    centerBanner.style.borderRadius = '4px';
    centerBanner.style.backdropFilter = 'blur(4px)';

    this.statusEl = document.createElement('div');
    this.statusEl.className = 'warp-cinematic-status';
    this.statusEl.style.fontSize = '13px';
    this.statusEl.style.letterSpacing = '3px';
    this.statusEl.style.fontWeight = 'bold';
    this.statusEl.style.color = '#00f0b5';
    this.statusEl.style.textShadow = '0 0 12px rgba(0, 240, 181, 0.9)';
    this.statusEl.textContent = '✦ GALACTIC WARP DRIVE ENGAGED — CHARGING SINGULARITY & ACCELERATION';
    centerBanner.appendChild(this.statusEl);

    this.telemetryHud.appendChild(centerBanner);

    // 3C. Bottom Row (Sub-Metrics & Sector Jump Readouts)
    const bottomRow = document.createElement('div');
    bottomRow.style.display = 'flex';
    bottomRow.style.justifyContent = 'space-between';
    bottomRow.style.alignItems = 'flex-end';

    this.subTelemetryEl = document.createElement('div');
    this.subTelemetryEl.className = 'warp-telemetry-sub';
    this.subTelemetryEl.style.fontSize = '10px';
    this.subTelemetryEl.style.letterSpacing = '1.5px';
    this.subTelemetryEl.style.color = '#00f0b5';
    this.subTelemetryEl.style.opacity = '0.75';
    this.subTelemetryEl.textContent = 'CHRONO DILATION: γ = 1.00 // CONTAINMENT FLUX: 99.98%';
    bottomRow.appendChild(this.subTelemetryEl);

    this.sectorEl = document.createElement('div');
    this.sectorEl.className = 'warp-telemetry-sector';
    this.sectorEl.style.fontSize = '11px';
    this.sectorEl.style.letterSpacing = '2px';
    this.sectorEl.style.fontWeight = 'bold';
    this.sectorEl.style.color = '#05ffa1';
    this.sectorEl.style.textShadow = '0 0 10px rgba(5, 255, 161, 0.7)';
    this.sectorEl.textContent = 'WARPING SPACETIME CONTINUUM // DESTINATION: GALAXY SECTOR 8';
    bottomRow.appendChild(this.sectorEl);

    this.telemetryHud.appendChild(bottomRow);

    this.element.appendChild(this.telemetryHud);

    // 4. Attach Overlay Shell to Container
    this.container.appendChild(this.element);

    // 5. Setup Global Keyboard & Window Resize Listeners
    this.setupListeners();

    // 6. Initialize WebGL 2.0 / WebGL 1.0 Hardware Shaders
    this.initWebGL();
    this.resize();
  }

  /**
   * Static convenience factory to launch and run the warp sequence in one call.
   */
  public static play(
    container: HTMLElement = document.body,
    onComplete?: () => void,
    result?: IGalaxyJumpResult,
    duration?: number
  ): GalaxyJumpWarpOverlay {
    const overlay = new GalaxyJumpWarpOverlay({
      container,
      duration,
      onComplete,
      result,
    });
    overlay.start();
    return overlay;
  }

  /**
   * Applies fullscreen obsidian void glassmorphic styling to the overlay.
   */
  private applyOverlayStyles(): void {
    const el = this.element;
    el.style.position = 'fixed';
    el.style.inset = '0';
    el.style.width = '100vw';
    el.style.height = '100vh';
    el.style.zIndex = '10000';
    el.style.backgroundColor = '#020306';
    el.style.display = 'flex';
    el.style.flexDirection = 'column';
    el.style.alignItems = 'center';
    el.style.justifyContent = 'center';
    el.style.overflow = 'hidden';
    el.style.userSelect = 'none';
  }

  /**
   * Binds global keyboard and window resize listeners.
   */
  private setupListeners(): void {
    this.keydownHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === ' ' || e.code === 'Space') {
        e.preventDefault();
        this.skip();
      }
    };
    window.addEventListener('keydown', this.keydownHandler);

    this.resizeHandler = () => {
      this.resize();
    };
    window.addEventListener('resize', this.resizeHandler);
  }

  /**
   * Provides full 100vw x 100vh dimensions across all viewports with zero letterboxing.
   */
  public getFullscreenDimensions(width: number, height: number): IFullscreenDimensions {
    return {
      width,
      height,
      isFullscreen: true,
      isLetterboxed: false,
    };
  }

  /**
   * Backward-compatibility helper for legacy callers expecting letterbox dimensions.
   * Consistently returns 0 barHeight and isLetterboxed = false.
   */
  public getLetterboxDimensions(width: number, height: number): ILetterboxDimensions {
    return {
      barHeight: 0,
      viewportHeight: height,
      isLetterboxed: false,
      targetAspect: width / (height || 1),
    };
  }

  /**
   * Compiles the Pure WebGL 2.0 / WebGL 1.0 Hyperspace Wormhole Hardware Shaders.
   */
  private initWebGL(): void {
    try {
      const gl = (this.canvas.getContext('webgl2', { alpha: false, antialias: true }) ||
                  this.canvas.getContext('webgl', { alpha: false, antialias: true }) ||
                  this.canvas.getContext('experimental-webgl', { alpha: false, antialias: true })) as WebGLRenderingContext | null;

      if (!gl) {
        return;
      }
      this.gl = gl;

      // Fullscreen Quad Vertex Shader (maps quad directly to NDC [-1, 1])
      const vsSource = `
        attribute vec2 aPosition;
        varying vec2 vUv;
        void main() {
          vUv = aPosition * 0.5 + 0.5;
          gl_Position = vec4(aPosition, 0.0, 1.0);
        }
      `;

      // Fullscreen Procedural Hyperspace Wormhole Fragment Shader
      const fsSource = `
        precision highp float;
        varying vec2 vUv;
        uniform float uTime;
        uniform vec2 uResolution;
        uniform float uPhase;
        uniform float uPhaseProgress;
        uniform float uFlashIntensity;
        uniform float uWarpFactor;
        uniform float uShakeIntensity;
        uniform float uChromaticAberration;

        // Art Direction Uniforms (Cyber-Emerald & Cosmic Neon Green)
        uniform vec3 uPrimaryColor;    // #00f0b5 Cyber-Emerald
        uniform vec3 uSecondaryColor;  // #05ffa1 Cosmic Neon Green
        uniform vec3 uCoreColor;       // #020306 Obsidian Core
        uniform vec3 uGoldPlasmaColor; // #ffd166 Mythic Gold
        uniform vec3 uDeepJadeColor;   // #0a3d2e Deep Jade
        uniform vec3 uDarkTealColor;   // #062e33 Dark Teal

        #define PI 3.14159265358979323846

        // Deterministic 2D hash for procedural starfields and noise seeds
        float hash12(vec2 p) {
          vec3 p3 = fract(vec3(p.xyx) * 0.1031);
          p3 += dot(p3, p3.yzx + 33.33);
          return fract((p3.x + p3.y) * p3.z);
        }

        // Procedural harmonic noise
        float nebulaNoise(vec2 p) {
          float v = 0.0;
          v += 0.500 * (sin(p.x * 2.0 + p.y * 1.5) * cos(p.y * 2.0 - p.x * 1.2));
          v += 0.250 * (sin(p.x * 4.1 - p.y * 2.7) * cos(p.y * 3.8 + p.x * 2.1));
          v += 0.125 * (sin(p.x * 8.3 + p.y * 5.4) * cos(p.y * 7.9 - p.x * 4.2));
          return v;
        }

        // Multi-octave FBM (Fractal Brownian Motion) for cosmic cyber-nebula plasma clouds
        float fbmPlasma(vec2 p) {
          float v = 0.0;
          float amp = 0.5;
          mat2 rot = mat2(cos(0.55), sin(0.55), -sin(0.55), cos(0.55));
          for (int i = 0; i < 4; i++) {
            v += amp * nebulaNoise(p);
            p = rot * p * 2.05 + vec2(17.3, 31.7);
            amp *= 0.5;
          }
          return v;
        }

        // Relativistic radial star streaks stretching outward in 3D perspective
        vec3 renderHyperStarfield(vec2 p, float speed, float stretch, float density) {
          float r = length(p);
          float angle = atan(p.y, p.x);
          vec3 accum = vec3(0.0);

          // Layer 1: Relativistic needle star streaks in Cyber-Emerald
          float n1 = 112.0;
          float s1 = floor(angle / (2.0 * PI) * n1);
          float sf1 = fract(angle / (2.0 * PI) * n1) - 0.5;
          float h1 = hash12(vec2(s1, 7.31));
          float z1 = fract((1.0 / (r + 0.005)) * 0.14 - uTime * speed * (0.8 + 0.8 * h1));
          float b1 = (1.0 - z1) * smoothstep(0.45, 0.0, abs(sf1));
          b1 *= smoothstep(0.03, stretch, r);
          accum += mix(uPrimaryColor, uSecondaryColor, h1) * b1 * 2.6;

          // Layer 2: Ultra-fine forward relativistic rays with gold plasma sparks
          float n2 = 160.0;
          float s2 = floor(angle / (2.0 * PI) * n2);
          float sf2 = fract(angle / (2.0 * PI) * n2) - 0.5;
          float h2 = hash12(vec2(s2, 19.87));
          float z2 = fract((1.0 / (r + 0.008)) * 0.24 - uTime * speed * 1.35 * (0.7 + 0.6 * h2));
          float b2 = pow(1.0 - z2, 2.0) * smoothstep(0.4, 0.0, abs(sf2));
          b2 *= smoothstep(0.04, stretch * 1.25, r);
          vec3 streakCol = mix(uSecondaryColor, uGoldPlasmaColor, step(0.8, h2) * 0.7);
          accum += streakCol * b2 * 2.2;

          return accum * density;
        }

        // Spacetime grid distortion bending the arena neon rounded grid into the warp vortex
        vec3 renderSpacetimeGrid(vec2 p) {
          float r = length(p);
          float angle = atan(p.y, p.x);

          // Gravitational metric curvature warping space exponentially toward the throat
          float vortexCurvature = 1.0 / (pow(r, 0.72) + 0.06);
          float vortexTwist = vortexCurvature * (0.35 + 0.25 * uWarpFactor) + uTime * 1.8;

          // Radial expansion & rotational twist mapping world grid coordinates
          vec2 warpedP = p * (1.0 + vortexCurvature * (0.45 + 0.35 * uWarpFactor));
          float c = cos(vortexTwist);
          float s = sin(vortexTwist);
          vec2 rotP = vec2(warpedP.x * c - warpedP.y * s, warpedP.x * s + warpedP.y * c);

          // The Neon Rounded Square Grid of Ouroboros Ascension
          vec2 gridUv = rotP * 3.4;
          vec2 cell = fract(gridUv) - 0.5;

          // Rounded square SDF
          vec2 dBox = abs(cell) - vec2(0.40);
          float d = length(max(dBox, 0.0)) + min(max(dBox.x, dBox.y), 0.0) - 0.04;

          // Glowing laser ribbons in Cyber-Emerald
          float lineIntensity = smoothstep(0.04, 0.0, abs(d));
          float laserGlow = exp(-abs(d) * 24.0) * 1.7;
          float totalGrid = (lineIntensity * 1.8 + laserGlow);

          // Fade out near singularity throat and far viewport perimeter
          totalGrid *= smoothstep(0.04, 0.16, r) * smoothstep(1.35, 0.25, r);

          // Grid color blending from Cyber-Emerald to Cosmic Neon Green
          vec3 gridColor = mix(uPrimaryColor, uSecondaryColor, sin(angle * 4.0 + uTime * 3.0) * 0.5 + 0.5);
          return gridColor * totalGrid * (0.7 + 0.3 * (uWarpFactor / 10.0));
        }

        // 3D Perspective Wormhole Tunnel with Swirling Cyber-Nebula & Singularity Core
        vec3 renderWormholeTunnel(vec2 p) {
          float r = length(p);
          float angle = atan(p.y, p.x);

          // Singularity gravitational vortex twist
          float vortexTwist = (1.0 / (r + 0.055)) * (0.60 + 0.40 * uWarpFactor);
          float angleWarped = angle + vortexTwist + uTime * 2.2;

          // Depth along cylindrical wormhole tunnel
          float tunnelZ = (1.0 / (r + 0.005)) - uTime * (uWarpFactor * 8.5 + 4.0);
          float tunnelU = angleWarped / PI * 5.0;

          // Swirling cosmic cyber-nebula plasma clouds lining the wormhole walls
          float plasma = fbmPlasma(vec2(tunnelZ * 0.16, tunnelU * 0.65));
          float filament = pow(max(0.0, plasma * 0.5 + 0.5), 3.0);

          // Relativistic Doppler shift:
          // Forward-propagating rays compress into intense Cyber-Emerald and Cosmic Neon Green
          // Outer boundary ripples redshift into Deep Jade Green and Dark Teal
          float shiftBlend = clamp(sin(tunnelZ * 0.25 + angleWarped * 2.0) * 0.5 + 0.5, 0.0, 1.0);
          vec3 forwardShift = mix(uPrimaryColor, uSecondaryColor, shiftBlend);
          vec3 trailingShift = mix(uDeepJadeColor, uDarkTealColor, shiftBlend);

          float redShiftFactor = smoothstep(0.20, 0.85, r) * 0.65;
          vec3 tunnelColor = mix(forwardShift, trailingShift, redShiftFactor);
          tunnelColor += uSecondaryColor * filament * 2.6;

          // Accretion disk & photon ring around the singularity throat
          float photonRing = exp(-pow((r - 0.075) / 0.016, 2.0)) * 3.5;
          float accretion = smoothstep(0.32, 0.10, r) * smoothstep(0.04, 0.10, r);
          float accretionFilaments = sin(angleWarped * 8.0 + uTime * 6.0) * cos(r * 45.0);

          // Accretion disk with Mythic Gold plasma accents
          vec3 accretionCol = mix(uPrimaryColor, uGoldPlasmaColor, sin(angleWarped * 3.0) * 0.5 + 0.5);
          tunnelColor += accretionCol * (accretion * (0.9 + 0.5 * accretionFilaments));
          tunnelColor += (uSecondaryColor * 0.8 + vec3(0.25)) * photonRing;

          // Relativistic light rays radiating from emerald singularity
          float rays = pow(max(0.0, sin(angle * 12.0 - uTime * 5.0) * cos(angle * 6.0 + uTime * 2.8)), 3.0);
          rays *= (0.16 / (r + 0.05)) * (0.8 + 0.4 * (uWarpFactor / 10.0));
          tunnelColor += uPrimaryColor * rays * 1.5;

          // Pure obsidian black singularity event horizon core (#020306)
          tunnelColor = mix(uCoreColor, tunnelColor, smoothstep(0.025, 0.085, r));
          return tunnelColor;
        }

        // Logarithmic Two-Armed Rotating Spiral Galaxy for Phase 4 Arrival
        vec3 renderArrivalGalaxy(vec2 p) {
          float r = length(p);
          float angle = atan(p.y, p.x) - uTime * 0.15;

          // Logarithmic spiral arms
          float spiralPhase = angle - 2.8 * log(r + 0.07);
          float arm1 = pow(max(0.0, cos(spiralPhase)), 5.0);
          float arm2 = pow(max(0.0, cos(spiralPhase + PI)), 5.0);
          float arms = (arm1 + arm2) * smoothstep(0.95, 0.25, r) * smoothstep(0.03, 0.18, r);

          // Core galactic bulge in Mythic Gold
          float core = 0.05 / (r + 0.035) * smoothstep(0.75, 0.0, r);
          vec3 coreColor = mix(uGoldPlasmaColor, vec3(0.95, 1.0, 0.98), smoothstep(0.0, 0.12, r));

          // Spiral arms: Cyber-Emerald and Cosmic Neon Green
          vec3 armColor = mix(uPrimaryColor, uSecondaryColor, sin(spiralPhase * 2.0) * 0.5 + 0.5);

          // Twinkling background stars
          float starSeed = hash12(floor(p * 220.0));
          float twinkle = sin(uTime * 7.0 + starSeed * 25.0) * 0.4 + 0.6;
          float star = step(0.992, starSeed) * twinkle;

          vec3 galaxy = coreColor * core + armColor * (arms * 1.8) + vec3(1.0) * star;

          // Ambient deep jade cosmic dust
          galaxy += uDeepJadeColor * smoothstep(0.9, 0.0, r) * 0.6;
          return galaxy;
        }

        void main() {
          // Whole-Game 100vw x 100vh Fullscreen Immersion (NO LETTERBOX BARS)
          vec2 uv = (gl_FragCoord.xy - 0.5 * uResolution.xy) / min(uResolution.x, uResolution.y);

          // Procedural Camera Vibration / Warp Turbulence
          vec2 shake = vec2(
            sin(uTime * 58.0) * cos(uTime * 37.0) * 0.7 + sin(uTime * 115.0) * 0.3,
            cos(uTime * 49.0) * sin(uTime * 43.0) * 0.7 + cos(uTime * 127.0) * 0.3
          ) * uShakeIntensity;
          vec2 p = uv + shake;
          float r = length(p);
          float angle = atan(p.y, p.x);

          vec3 sceneColor = uCoreColor; // Deep obsidian cosmos void base

          // Multi-Phase Rendering State Machine
          if (uPhase < 1.5) {
            // PHASE 1: Singularity Charge-Up & Relativistic Acceleration (0.0s - 1.2s)
            float speed = pow(uPhaseProgress, 2.2) * 3.5;
            float streakStretch = mix(0.02, 0.6, uPhaseProgress);
            vec3 streaks = renderHyperStarfield(p, speed, streakStretch, mix(0.5, 1.5, uPhaseProgress));

            // Spacetime arena grid distortion bending into the singularity
            vec3 grid = renderSpacetimeGrid(p);

            // Singularity gravitational core charging
            float coreGlow = 0.025 / (r + 0.018) * uPhaseProgress;
            vec3 coreColor = mix(uPrimaryColor, vec3(0.9, 1.0, 0.95), uPhaseProgress);

            // Event horizon accretion spin up
            float spin = (1.0 / (r + 0.05)) * uPhaseProgress * 0.8;
            float disk = smoothstep(0.3, 0.08, r) * smoothstep(0.03, 0.08, r) * sin(angle * 6.0 + spin + uTime * 4.0);
            vec3 diskCol = uSecondaryColor * max(0.0, disk) * uPhaseProgress * 1.6;

            sceneColor += streaks + grid * (0.8 + 0.4 * uPhaseProgress) + coreColor * coreGlow + diskCol;

          } else if (uPhase < 2.5) {
            // PHASE 2: Full Hyperspace Wormhole Tunnel & Relativistic Dispersion (1.2s - 2.2s)
            float disp = uChromaticAberration * 0.045;
            vec2 pR = p * (1.0 - disp);
            vec2 pG = p;
            vec2 pB = p * (1.0 + disp);

            vec3 tunnelR = renderWormholeTunnel(pR);
            vec3 tunnelG = renderWormholeTunnel(pG);
            vec3 tunnelB = renderWormholeTunnel(pB);
            vec3 tunnel = vec3(tunnelR.r, tunnelG.g, tunnelB.b);

            vec3 gridR = renderSpacetimeGrid(pR);
            vec3 gridG = renderSpacetimeGrid(pG);
            vec3 gridB = renderSpacetimeGrid(pB);
            vec3 warpedGrid = vec3(gridR.r, gridG.g, gridB.b);

            vec3 streaks = renderHyperStarfield(p, 5.0, 0.9, 1.8);

            // Singularity central throat beam in cyber-emerald
            float centralThroat = 0.018 / (r + 0.012);
            sceneColor = mix(tunnel, streaks, 0.30) + warpedGrid * 0.70 + uPrimaryColor * centralThroat;

          } else if (uPhase < 3.5) {
            // PHASE 3: Galactic Rift Shockwave & Blinding Hypernova Flash (2.2s - 2.6s)
            // 1. Expanding relativistic cosmic emerald plasma shockwave ring
            float ringRadius = uPhaseProgress * 2.2;
            float ringDist = abs(r - ringRadius);
            float shockRing = exp(-pow(ringDist / 0.045, 2.0)) * (1.0 - uPhaseProgress * 0.5);
            vec3 ringColor = mix(uPrimaryColor, uSecondaryColor, sin(angle * 4.0 + uTime * 10.0) * 0.5 + 0.5);
            ringColor += uGoldPlasmaColor * (shockRing * 0.5);

            // 2. Anamorphic horizontal lens flare streak in cosmic emerald & white
            float flareY = exp(-abs(p.y) * 45.0) * exp(-abs(p.x) * 1.2) * (1.0 - uPhaseProgress * 0.5);
            vec3 flareCol = mix(uPrimaryColor, vec3(1.0), 0.4) * flareY * 3.5;

            // 3. Radiant crepuscular god-rays radiating from rift breach
            float rays = pow(max(0.0, sin(angle * 14.0 - uTime * 6.0) * cos(angle * 7.0 + uTime * 3.0)), 3.0);
            rays *= (0.18 / (r + 0.06)) * (1.0 - uPhaseProgress * 0.5);
            vec3 raysCol = uPrimaryColor * rays * 2.0;

            // 4. Blinding Cosmic Emerald & White Hypernova Burst
            vec3 flashCol = mix(vec3(1.0, 1.0, 1.0), uSecondaryColor, uPhaseProgress * 0.6);

            sceneColor = ringColor * (shockRing * 3.2) + flareCol + raysCol + flashCol * uFlashIntensity;

          } else {
            // PHASE 4: Destination Galaxy Settling & Stabilization (2.6s - 3.0s)
            vec3 galaxy = renderArrivalGalaxy(p);

            // Dissipating flash residue in cyber-emerald
            vec3 residualGlow = uPrimaryColor * uFlashIntensity * 0.6;
            sceneColor = galaxy + residualGlow;
          }

          gl_FragColor = vec4(sceneColor, 1.0);
        }
      `;

      const vs = this.compileShader(gl.VERTEX_SHADER, vsSource);
      const fs = this.compileShader(gl.FRAGMENT_SHADER, fsSource);
      if (!vs || !fs) return;

      const program = gl.createProgram();
      if (!program) return;

      gl.attachShader(program, vs);
      gl.attachShader(program, fs);
      gl.linkProgram(program);

      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        gl.deleteProgram(program);
        return;
      }

      this.program = program;
      gl.useProgram(program);

      this.uTimeLoc = gl.getUniformLocation(program, 'uTime');
      this.uResolutionLoc = gl.getUniformLocation(program, 'uResolution');
      this.uPhaseLoc = gl.getUniformLocation(program, 'uPhase');
      this.uPhaseProgressLoc = gl.getUniformLocation(program, 'uPhaseProgress');
      this.uFlashIntensityLoc = gl.getUniformLocation(program, 'uFlashIntensity');
      this.uWarpFactorLoc = gl.getUniformLocation(program, 'uWarpFactor');
      this.uShakeIntensityLoc = gl.getUniformLocation(program, 'uShakeIntensity');
      this.uChromaticAberrationLoc = gl.getUniformLocation(program, 'uChromaticAberration');

      // Art Direction Uniform Bindings
      this.uPrimaryColorLoc = gl.getUniformLocation(program, 'uPrimaryColor');
      this.uSecondaryColorLoc = gl.getUniformLocation(program, 'uSecondaryColor');
      this.uCoreColorLoc = gl.getUniformLocation(program, 'uCoreColor');
      this.uGoldPlasmaColorLoc = gl.getUniformLocation(program, 'uGoldPlasmaColor');
      this.uDeepJadeColorLoc = gl.getUniformLocation(program, 'uDeepJadeColor');
      this.uDarkTealColorLoc = gl.getUniformLocation(program, 'uDarkTealColor');

      // Fullscreen 2D Quad [-1, -1] to [1, 1]
      const quadVertices = new Float32Array([
        -1.0, -1.0,
         1.0, -1.0,
        -1.0,  1.0,
        -1.0,  1.0,
         1.0, -1.0,
         1.0,  1.0,
      ]);

      const buffer = gl.createBuffer();
      if (buffer) {
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferData(gl.ARRAY_BUFFER, quadVertices, gl.STATIC_DRAW);
        const aPos = gl.getAttribLocation(program, 'aPosition');
        if (aPos >= 0) {
          gl.enableVertexAttribArray(aPos);
          gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
        }
        this.vertexBuffer = buffer;
      }
    } catch {
      // Graceful headless fallback
    }
  }

  private compileShader(type: number, source: string): WebGLShader | null {
    if (!this.gl) return null;
    const shader = this.gl.createShader(type);
    if (!shader) return null;
    this.gl.shaderSource(shader, source);
    this.gl.compileShader(shader);
    if (!this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS)) {
      this.gl.deleteShader(shader);
      return null;
    }
    return shader;
  }

  /**
   * Resizes viewport and canvas buffer to fill the entire container / screen window.
   */
  public resize(): void {
    const width = this.container.clientWidth || window.innerWidth || 1280;
    const height = this.container.clientHeight || window.innerHeight || 720;
    this.canvas.width = width;
    this.canvas.height = height;

    if (this.gl) {
      this.gl.viewport(0, 0, width, height);
    }
  }

  /**
   * Returns current Phase enum (1, 2, 3, or 4).
   */
  public get currentPhase(): WarpPhase {
    if (this.elapsedTime < 1.2) return WarpPhase.Charge;
    if (this.elapsedTime < 2.2) return WarpPhase.Hyperspace;
    if (this.elapsedTime < 2.6) return WarpPhase.Flash;
    return WarpPhase.Resolve;
  }

  /**
   * Returns current Phase string identifier.
   */
  public get phaseName(): WarpPhaseName {
    switch (this.currentPhase) {
      case WarpPhase.Charge: return 'charge';
      case WarpPhase.Hyperspace: return 'hyperspace';
      case WarpPhase.Flash: return 'flash';
      case WarpPhase.Resolve: return 'resolve';
    }
  }

  /**
   * Normalized progress [0, 1] within the current phase.
   */
  public get phaseProgress(): number {
    const t = this.elapsedTime;
    if (t < 1.2) {
      return Math.min(1.0, Math.max(0.0, t / 1.2));
    } else if (t < 2.2) {
      return Math.min(1.0, Math.max(0.0, (t - 1.2) / 1.0));
    } else if (t < 2.6) {
      return Math.min(1.0, Math.max(0.0, (t - 2.2) / 0.4));
    } else {
      return Math.min(1.0, Math.max(0.0, (t - 2.6) / 0.4));
    }
  }

  /**
   * Current cinematic status banner message anchored in Cyber-Emerald art direction.
   */
  public get statusMessage(): string {
    switch (this.currentPhase) {
      case WarpPhase.Charge:
        return '✦ GALACTIC WARP DRIVE ENGAGED — CHARGING SINGULARITY & ACCELERATION';
      case WarpPhase.Hyperspace:
        return '✦ SECTOR JUMP IN PROGRESS — HYPERSPACE TRANSCENDENCE';
      case WarpPhase.Flash:
        return '✦ GALACTIC RIFT RUPTURE & COSMIC SHOCKWAVE';
      case WarpPhase.Resolve:
        return '✦ ARRIVAL CONFIRMED — DESTINATION SECTOR STABILIZED';
    }
  }


  /**
   * Dynamic relativistic warp factor (multiples of c) accelerating to superluminal velocity.
   */
  public get warpFactor(): number {
    const t = this.elapsedTime;
    if (t < 1.2) {
      // Phase 1: Exponential acceleration from 0.0c to 4.5c
      const p = t / 1.2;
      return Math.pow(p, 2.0) * 4.5;
    } else if (t < 2.2) {
      // Phase 2: Superluminal warp acceleration from 4.5c to 9.8c
      const p = (t - 1.2) / 1.0;
      return 4.5 + 5.3 * Math.sin(p * Math.PI * 0.5);
    } else if (t < 2.6) {
      // Phase 3: Rift singularity rupture peak at ~10.0c decaying
      const p = (t - 2.2) / 0.4;
      return 9.8 + 0.2 * (1.0 - p);
    } else {
      // Phase 4: Sub-light orbital cruise velocity
      return 1.0;
    }
  }

  /**
   * Procedural camera turbulence / vibration intensity during high warp velocity.
   */
  public get shakeIntensity(): number {
    const t = this.elapsedTime;
    if (t < 1.2) {
      // Turbulence begins during charge
      const p = t / 1.2;
      return Math.pow(p, 2.0) * 0.02;
    } else if (t < 2.2) {
      // High hyperspace shear turbulence
      return 0.025;
    } else if (t < 2.6) {
      // Explosive shockwave peak decaying
      const p = (t - 2.2) / 0.4;
      return Math.max(0.0, 0.045 * (1.0 - p));
    } else {
      // Smooth arrival
      return 0.0;
    }
  }

  /**
   * Relativistic optical chromatic dispersion intensity [0, 1].
   */
  public get chromaticAberration(): number {
    const t = this.elapsedTime;
    if (t < 1.2) {
      const p = t / 1.2;
      return Math.pow(p, 2.0) * 0.4;
    } else if (t < 2.2) {
      const p = (t - 1.2) / 1.0;
      return 0.4 + 0.6 * p;
    } else if (t < 2.6) {
      const p = (t - 2.2) / 0.4;
      return Math.max(0.0, 1.0 - p);
    } else {
      return 0.0;
    }
  }

  /**
   * Calculates instantaneous flash intensity during Phase 3 & 4.
   */
  public get flashIntensity(): number {
    const t = this.elapsedTime;
    if (t < 2.2) {
      return 0.0;
    } else if (t < 2.28) {
      // Sudden blinding hypernova explosion ramp up
      return (t - 2.2) / 0.08;
    } else if (t < 2.6) {
      // Exponential decay
      return Math.max(0.0, 1.0 - (t - 2.28) / 0.32);
    } else if (t < 3.0) {
      // Residual dissipating stellar glow
      return Math.max(0.0, (1.0 - (t - 2.6) / 0.4) * 0.25);
    }
    return 0.0;
  }

  /**
   * Starts the animation loop and synchronizes procedural audio.
   */
  public start(onComplete?: () => void): void {
    if (this.isRunning) return;
    if (onComplete) {
      this.dynamicOnComplete = onComplete;
    }

    // Synchronize procedural audio with Services.Sound.playWarpJump()
    if (typeof (Services.Sound as any)?.playWarpJump === 'function') {
      try {
        (Services.Sound as any).playWarpJump();
      } catch {
        // Silently handle audio failure in headless / restricted environments
      }
    }

    if (this.duration <= 0) {
      this.complete();
      return;
    }

    this.isRunning = true;
    this.elapsedTime = 0.0;
    this.lastFrameTimestamp = performance.now ? performance.now() : Date.now();

    this.updateDom();

    const loop = (timestamp: number) => {
      if (!this.isRunning || this.isFinished || typeof document === 'undefined') return;
      const dt = Math.min(0.1, (timestamp - this.lastFrameTimestamp) / 1000.0);
      this.lastFrameTimestamp = timestamp;

      this.tick(dt);

      if (!this.isFinished && this.isRunning && typeof document !== 'undefined') {
        if (typeof requestAnimationFrame !== 'undefined') {
          this.animFrameId = requestAnimationFrame(loop);
        }
      }
    };

    if (typeof requestAnimationFrame !== 'undefined') {
      this.animFrameId = requestAnimationFrame(loop);
    }
  }

  /**
   * Deterministically steps the internal clock forward by dt seconds.
   */
  public tick(dt: number): void {
    if (this.isFinished) return;

    this.elapsedTime += dt;
    this.updateDom();
    this.render();

    if (this.elapsedTime >= this.duration) {
      this.complete();
    }
  }

  /**
   * Updates DOM status texts, cybernetic telemetry, and outcome presentation panel.
   */
  private updateDom(): void {
    if (this.statusEl) {
      this.statusEl.textContent = this.statusMessage;
    }

    if (this.warpFactorEl) {
      const factor = this.warpFactor.toFixed(1);
      this.warpFactorEl.textContent = `WARP FACTOR: ${factor}c`;
    }

    if (this.sectorEl) {
      if (this.currentPhase === WarpPhase.Resolve) {
        this.sectorEl.textContent = 'DESTINATION CONFIRMED: GALAXY SECTOR 8 // ASCENSION COORD: [49.2, -18.7, 882.4]';
      } else if (this.currentPhase === WarpPhase.Flash) {
        this.sectorEl.textContent = 'GALACTIC RIFT BREACH // SINGULARITY HYPERNOVA';
      } else if (this.currentPhase === WarpPhase.Hyperspace) {
        this.sectorEl.textContent = 'SECTOR JUMP IN PROGRESS // DESTINATION: GALAXY SECTOR 8';
      } else {
        this.sectorEl.textContent = 'WARPING SPACETIME CONTINUUM // DESTINATION: GALAXY SECTOR 8';
      }
    }

    if (this.subTelemetryEl) {
      const factor = this.warpFactor;
      const gamma = factor > 0.1 ? (1.0 / Math.sqrt(Math.max(0.001, 1.0 - Math.min(0.999, factor / 10.0)))).toFixed(2) : '1.00';
      this.subTelemetryEl.textContent = `CHRONO DILATION: γ = ${gamma} // CONTAINMENT FLUX: 99.98%`;
    }

    // Display result panel when entering Phase 4 or upon completion if result is provided
    if (this.result && this.currentPhase === WarpPhase.Resolve && !this.resultPanelEl) {
      this.createResultPanel();
    }
  }

  /**
   * Renders the result feedback panel showing unique helm creation status.
   */
  private createResultPanel(): void {
    if (this.resultPanelEl || !this.result || typeof document === 'undefined') return;

    const panel = document.createElement('div');
    panel.className = 'warp-result-panel glass-panel';
    panel.style.position = 'absolute';
    panel.style.zIndex = '10003';
    panel.style.maxWidth = '480px';
    panel.style.width = '90%';
    panel.style.padding = '24px';
    panel.style.borderRadius = '8px';
    panel.style.textAlign = 'center';
    panel.style.background = 'rgba(2, 3, 6, 0.94)';
    panel.style.border = '1px solid rgba(0, 240, 181, 0.6)';
    panel.style.boxShadow = '0 0 35px rgba(0, 240, 181, 0.4)';
    panel.style.animation = 'fadeIn 0.3s ease-out';

    if (this.result.success && this.result.awardedHelmet) {
      const helm = this.result.awardedHelmet;
      panel.innerHTML = `
        <div style="font-size: 36px; margin-bottom: 8px;">✨ ${helm.Icon} ✨</div>
        <h3 style="color: #ffd166; font-size: 20px; margin: 0 0 8px 0; letter-spacing: 2px;">
          UNIQUE HELMET MANIFESTED!
        </h3>
        <div style="font-size: 16px; font-weight: bold; color: #00f0b5; margin-bottom: 6px;">
          ${helm.Name}
        </div>
        <p style="font-size: 12.5px; color: #94a3b8; font-style: italic; margin-bottom: 12px; line-height: 1.4;">
          "${helm.Lore}"
        </p>
        <div style="font-size: 13px; color: #e2e8f0; background: rgba(0, 240, 181, 0.12); border: 1px solid rgba(0, 240, 181, 0.4); border-radius: 4px; padding: 8px 12px;">
          ⚡ <strong>${helm.SpecialCapacity}</strong>
        </div>
      `;
    } else {
      const score = this.result.sacrificeScore ?? 0;
      panel.innerHTML = `
        <div style="font-size: 36px; margin-bottom: 8px;">🌌 🌀 🌌</div>
        <h3 style="color: #94a3b8; font-size: 18px; margin: 0 0 8px 0; letter-spacing: 1.5px;">
          SACRIFICE CONSUMED BY THE VOID
        </h3>
        <p style="font-size: 13.5px; color: #e2e8f0; margin: 10px 0;">
          The cosmic rift stabilized, but no Unique Helmet manifested.
        </p>
        <div style="font-size: 12px; color: #64748b;">
          Sacrifice Score: <span style="color: #00f0b5; font-weight: bold;">${score}</span>.
          Sacrifice higher-rarity boss helmets to guarantee mythic manifestation!
        </div>
      `;
    }

    this.resultPanelEl = panel;
    this.element.appendChild(panel);
  }

  /**
   * Executes Pure WebGL 2.0 render pass.
   */
  public render(): void {
    if (!this.gl || !this.program) return;
    const gl = this.gl;

    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(this.coreColor[0], this.coreColor[1], this.coreColor[2], 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.useProgram(this.program);

    if (this.uTimeLoc) gl.uniform1f(this.uTimeLoc, this.elapsedTime);
    if (this.uResolutionLoc) gl.uniform2f(this.uResolutionLoc, this.canvas.width, this.canvas.height);
    if (this.uPhaseLoc) gl.uniform1f(this.uPhaseLoc, this.currentPhase);
    if (this.uPhaseProgressLoc) gl.uniform1f(this.uPhaseProgressLoc, this.phaseProgress);
    if (this.uFlashIntensityLoc) gl.uniform1f(this.uFlashIntensityLoc, this.flashIntensity);
    if (this.uWarpFactorLoc) gl.uniform1f(this.uWarpFactorLoc, this.warpFactor);
    if (this.uShakeIntensityLoc) gl.uniform1f(this.uShakeIntensityLoc, this.shakeIntensity);
    if (this.uChromaticAberrationLoc) gl.uniform1f(this.uChromaticAberrationLoc, this.chromaticAberration);

    // Bind Art Direction Color Uniforms
    if (this.uPrimaryColorLoc) gl.uniform3f(this.uPrimaryColorLoc, this.primaryColor[0], this.primaryColor[1], this.primaryColor[2]);
    if (this.uSecondaryColorLoc) gl.uniform3f(this.uSecondaryColorLoc, this.secondaryColor[0], this.secondaryColor[1], this.secondaryColor[2]);
    if (this.uCoreColorLoc) gl.uniform3f(this.uCoreColorLoc, this.coreColor[0], this.coreColor[1], this.coreColor[2]);
    if (this.uGoldPlasmaColorLoc) gl.uniform3f(this.uGoldPlasmaColorLoc, this.goldPlasmaColor[0], this.goldPlasmaColor[1], this.goldPlasmaColor[2]);
    if (this.uDeepJadeColorLoc) gl.uniform3f(this.uDeepJadeColorLoc, this.deepJadeColor[0], this.deepJadeColor[1], this.deepJadeColor[2]);
    if (this.uDarkTealColorLoc) gl.uniform3f(this.uDarkTealColorLoc, this.darkTealColor[0], this.darkTealColor[1], this.darkTealColor[2]);

    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  /**
   * Skips remaining animation immediately and invokes completion handler.
   */
  public skip(): void {
    if (this.isFinished) return;
    this.complete();
  }

  /**
   * Finalizes the animation, cleans up listeners/DOM, and executes onComplete.
   */
  private complete(): void {
    if (this.isFinished) return;
    this.isFinished = true;
    this.isRunning = false;

    if (this.animFrameId !== null && typeof cancelAnimationFrame !== 'undefined') {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }

    // Call onComplete callback
    if (typeof this.dynamicOnComplete === 'function') {
      this.dynamicOnComplete();
    } else if (typeof this.onCompleteCb === 'function') {
      this.onCompleteCb();
    }

    // Clean up DOM and listeners
    this.destroy();
  }

  /**
   * Frees WebGL resources and removes DOM elements.
   */
  public destroy(): void {
    this.isRunning = false;

    if (this.animFrameId !== null && typeof cancelAnimationFrame !== 'undefined') {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }

    if (this.keydownHandler) {
      window.removeEventListener('keydown', this.keydownHandler);
      this.keydownHandler = undefined;
    }

    if (this.resizeHandler) {
      window.removeEventListener('resize', this.resizeHandler);
      this.resizeHandler = undefined;
    }

    if (this.element.parentElement) {
      this.element.parentElement.removeChild(this.element);
    }

    if (this.gl && this.vertexBuffer) {
      this.gl.deleteBuffer(this.vertexBuffer);
      this.vertexBuffer = null;
    }

    if (this.gl && this.program) {
      this.gl.deleteProgram(this.program);
      this.program = null;
    }

    this.gl = null;
  }
}
