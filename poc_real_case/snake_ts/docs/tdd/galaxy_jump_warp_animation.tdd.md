# Feature TDD Specification: Whole-Game Pure WebGL Hyperspace Galaxy Jump Warp Animation

> **Feature Identifier:** `docs/tdd/galaxy_jump_warp_animation.tdd.md`  
> **Status:** Red-Green-Refactor (Iteration 2: Whole-Game Hyperspace & Cyber-Emerald Art Direction)  
> **Target Directory:** `/home/forart/dev/snake_ts`  
> **Rule Reference:** [`AGENTS.md#rule-2`](file:///home/forart/dev/snake_ts/AGENTS.md), [`AGENTS.md#rule-6`](file:///home/forart/dev/snake_ts/AGENTS.md), [`AGENTS.md#rule-10`](file:///home/forart/dev/snake_ts/AGENTS.md), [`AGENTS.md#rule-12`](file:///home/forart/dev/snake_ts/AGENTS.md) & [`ORACLE.md`](file:///home/forart/dev/snake_ts/ORACLE.md)  

---

## 1. Feature Overview & Requirements

- **High Concept:**
  - A breathtaking, AAA whole-game hyperspace galaxy jump warp animation in Pure WebGL 2.0 accompanying the "Galaxy Jump" transcendence ritual.
  - **Whole-Game Immersion (Zero Letterboxing)**:
    - 2.39:1 letterbox bars are permanently eliminated! No black film bars, no "video in a frame" appearance.
    - Animation covers the 100% full screen / game window (100vw x 100vh) across all aspect ratios (16:9, ultrawide 21:9, mobile portrait 9:16).
  - **100% Art Direction Palette Anchoring**:
    - Primary hyperspace colors: **Cyber-Emerald (`#00f0b5`)** and **Cosmic Neon Green (`#05ffa1`)**.
    - Trailing relativistic shift: Deep jade green (`#0a3d2e`) and dark teal (`#062e33`).
    - Singularity & stars: Obsidian black core (`#020306`) with brilliant emerald relativistic light rays and mythic gold plasma accents (`#ffd166`).
    - Shockwave / Rift Flash: Radiant cosmic emerald & white light burst.
  - **Whole-Game Hyperspace Visual Systems (WebGL 2.0 Shaders)**:
    - **Relativistic Radial Star Streaks**: Multi-layered 3D perspective needles accelerating outward from the singularity core.
    - **Spacetime Grid Distortion**: The iconic neon rounded arena grid bends, warps, and flows directly into the central singularity vortex.
    - **Multi-Octave FBM Cyber-Nebula Plasma Clouds**: Fractal Brownian motion noise generating swirling filaments in neon green, cyan, deep jade, and dark teal.
    - **High-Speed Relativistic Motion Blur & Chromatic Dispersion**: Radial RGB spectral separation scaling with warp factor up to 9.8c+.
    - **Cosmic Rift Shockwave & Hypernova**: Expanding emerald plasma shockwave ring with crepuscular god-rays and horizontal anamorphic flare rupturing into the new galaxy sector.
    - **Arrival Panorama**: Blinding flash dissipates into a stunning rotating logarithmic spiral galaxy backdrop in deep emerald and cosmic jade with twinkling stars.
  - **Streamlined HUD & Telemetry**:
    - Sleek cybernetic telemetry in neon green (`#00f0b5`):
      - "✦ GALACTIC WARP DRIVE ENGAGED"
      - "SECTOR JUMP IN PROGRESS"
      - Relativistic warp factor readout accelerating up to 9.8c.
    - Responsive Interactive Skip: "[ESC / TAP TO SKIP]" button in cyber-emerald that resolves immediately.

---

## 2. Test Plan & Assertions (Red Phase)

- **Test Suite Location:** `src/tests/GalaxyJumpWarpAnimation.test.ts`
- **Assertions:**
  1. Fullscreen Immersion & Zero Letterboxing:
     - `getFullscreenDimensions(w, h)` confirms 100% fullscreen coverage (`isFullscreen: true`, `isLetterboxed: false`, `barHeight: 0`) across 16:9, 9:16 mobile portrait, and ultrawide.
     - DOM query confirms `.warp-letterbox-top` and `.warp-letterbox-bottom` do not exist.
  2. Art Direction & Color Uniforms:
     - Color properties `primaryColor` (`#00f0b5`), `secondaryColor` (`#05ffa1`), `coreColor` (`#020306`), `goldPlasmaColor`, `deepJadeColor`, and `darkTealColor` conform to game design.
     - WebGL shader binds `uPrimaryColor`, `uSecondaryColor`, `uCoreColor`, `uGoldPlasmaColor`, etc.
  3. Four-Phase Timeline Progression:
     - Transitions through Charge -> Hyperspace -> Flash -> Resolve.
     - Phase 1 status contains "GALACTIC WARP DRIVE ENGAGED" and "CHARG".
     - Phase 2 status contains "SECTOR JUMP IN PROGRESS" and "HYPERSPACE".
     - Phase 3 status contains "SHOCKWAVE" / "RIFT" / "FLASH".
     - Phase 4 status contains "ARRIV" / "SECTOR" / "STABILIZ".
  4. Streamlined HUD & Interactive Skip:
     - HUD displays cyber-emerald headers and "[ESC / TAP TO SKIP]" button.
     - Skip triggers via ESC, Space, or skip button.
  5. Relativistic Dynamics & Camera Turbulence:
     - `warpFactor`, `shakeIntensity`, and `chromaticAberration` scale smoothly across phases.
  6. Unique Helmet Outcome Presentation:
     - Presents awarded helmet details or cosmic void message in Phase 4.

---

## 3. Implementation Details (Green Phase)

- **Files Created/Modified:**
  - `src/render/webgl/GalaxyJumpWarpOverlay.ts`:
    - Completely removed letterbox bars from DOM and fragment shader.
    - Integrated spacetime grid distortion warping into singularity.
    - Multi-octave FBM cyber-nebula noise with Cyber-Emerald / Cosmic Neon Green palette.
    - Color uniforms `uPrimaryColor`, `uSecondaryColor`, `uCoreColor`, `uGoldPlasmaColor`.
    - Streamlined cyber-emerald telemetry HUD.
  - `src/tests/GalaxyJumpWarpAnimation.test.ts`:
    - Updated test cases to assert 100% fullscreen dimensions, absence of letterbox elements, cyber-emerald palette uniforms, and streamlined telemetry readouts.
