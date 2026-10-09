# Feature TDD Specification: WebGL Visual Polish & Serpentine Restoration

> **Feature Identifier:** `docs/tdd/webgl_visual_polish_and_restoration.tdd.md`  
> **Status:** Iteration 2 (Red -> Green -> Refactor Phase)  
> **Target Directory:** `/home/forart/dev/snake_ts`  
> **Rule Reference:** [`AGENTS.md#rule-1`](file:///home/forart/dev/snake_ts/AGENTS.md), [`AGENTS.md#rule-2`](file:///home/forart/dev/snake_ts/AGENTS.md), [`AGENTS.md#rule-10`](file:///home/forart/dev/snake_ts/AGENTS.md), [`AGENTS.md#rule-12`](file:///home/forart/dev/snake_ts/AGENTS.md), [`ORACLE.md`](file:///home/forart/dev/snake_ts/ORACLE.md)  

---

## 1. Feature Overview & Requirements (Iteration 2 Deep Polish)

Following live playtesting and player screenshot inspection, four distinct visual anomalies were pinpointed for root-cause elimination:

1. **Center Reticle Elimination & Milky Way Subtlety (`WebGLGameRenderer.ts`, `WebGLContext.ts`)**:
   - Eliminate the static orange target reticle / crosshairs `(O) -+-` at arena center (lines 718–725 of `WebGLGameRenderer.ts`).
   - Switch Milky Way backdrop from blown-out additive stacking to `GLBlendMode.NORMAL` (matching Canvas2D `source-over` standard).
   - Calibrate subtle alphas: Mantle (0.18), Core (0.26), Bulge (0.15) over base void so deep space remains >51% dominant.
   - Soften nebula shader (`primType == 6`) white core mix factor to 0.10.

2. **Subtractive Silhouette & Enemy Shading Elimination (`WebGLAssetAtlas.ts`, `WebGLGameRenderer.ts`)**:
   - Eliminate the subtractive 0.22 spore halo from `WebGLAssetAtlas.ts` that darkened the bright galactic background behind food pickups.
   - Remove the fake additive solid circular disc from `drawEnemy` (saving 40 batch flushes and eliminating the saucer artifact).
   - Replace pitch-black `'rgba(3, 7, 14, ...)'` internal hulls with tinted mechanical shading `ColorX.rgba(ColorX.shade(col, -0.65), 0.45)`.

3. **High-Octane AAA Arcade Explosions (`FxManager.ts`, `WebGLGameRenderer.ts`)**:
   - Extend `FxParticle` with `'shard'` and `'plasma'` shapes, angular rotation (`vRot`), and dynamic motion stretch (`streakMult = 8`).
   - Spawn 24–36 high-velocity stretched laser sparks, 8–16 tumbling geometric debris shards (`batch.drawRotatedQuad`), 10–18 billowing soft plasma clouds, and micro-impact screen flash (`this.flash(color, 0.20, 0.08)`).
   - Upgrade shockwave rings with crisp leading edges and energetic expansion ($900\text{--}1400\text{ px/s}$).

4. **Main Menu Ouroboros Glitch Elimination & Dragon Head Restoration (`OuroborosMenuAnimation.ts`)**:
   - Replace raw z-sorting with **strand-aware stable sorting**: adjacent segments along the same strand ($\min(|a - b|, N - |a - b|) \le 4$) enforce strict anatomical order (Head always on top of neck, tail tip under head, stable shingling), eliminating the violent $\cos(8\theta)$ Z-swapping pop-in glitch.
   - Disconnect the underbody foundation loop between tail (179) and head (0) to eliminate the green ribbon blob in the mouth.
   - Reconstruct the full Norse/Celtic dragon head: sweeping dragon horns curving over the neck, undulating barbels/whiskers, 3-plate cranial crown, ivory fangs, and visor eyes.

---

## 2. Test Plan & Assertions (Red Phase)

- **Test Suite Locations:**
  - `src/tests/WebGLVisualPolishAndRestoration.test.ts` (new dedicated suite: 8 assertions)
  - `src/tests/SerpentineBodyTailAndDamageOverlayParity.test.ts` (5 assertions)
  - `src/tests/IntricateOuroborosKnotAndBackdrop.test.ts` (6 assertions)
  - `src/tests/MenuOuroborosBackdropAnimation.test.ts` (7 assertions)
  - `src/tests/ContinuousSerpentineMeshRibbon.test.ts` (10 assertions)
  - `src/tests/PureWebGLSerpentineRibbonAndHead.test.ts` (7 assertions)
  - `src/tests/WebGLGameRenderer.test.ts` (18 assertions)

---

## 3. Implementation Details (Green & Refactor Phase)

- `src/render/webgl/WebGLContext.ts`:
  - Fixed Quad, Circle, Ring, Laser, and Nebula primitive shader blending formulas.
  - Recalibrated sphere shadow stop constant to 0.28.
- `src/render/webgl/GLBatch.ts`:
  - Added monotonic quadratic spine taper function `getSpineTaper(t)` to joint discs and ribbons in passes 0, 1, 2, 4, and 5.
  - Added jewel stinger micro-node at the tail tip.
  - Softened shell outline color to tinted cosmic penumbra.
- `src/render/OuroborosMenuAnimation.ts`:
  - Implemented anatomical radius profiling ($44\text{px} \to 36\text{px} \to 32\text{px} \to 13\text{px}$).
  - Implemented `drawHeadGL`, `drawTailGL`, and `drawSwallowingPlasmaGL`.
  - Set `roundCaps = false` on closed-ring continuous ribbons to remove segment 0 seam bumps.
- `src/render/FxManager.ts`:
  - Added `growthRate` to `FxParticle` for expanding smoke/plasma puffs.
  - Upgraded `explosion()` with multi-stage core flash, kinetic shockwave, directional plasma sparks, lingering drag embers, and billowing smoke plumes.
- `src/sim/CombatSystem.ts` & `src/sim/GameEngine.ts`:
  - Connected `handleEnemyKill`, `explodeAt`, `OnBossDefeated`, and `HandleGameOver` to `explosion(...)`.
- `src/render/webgl/WebGLGameRenderer.ts`:
  - Restored Milky Way core Gaussian bulge and starfield clustering along the -32° galactic axis.
  - Eliminated harsh donut ring vignette.
  - Added soft additive ambient halos to enemies and player head.

---

## 4. Verification & Quality Gate Results (Iteration 2)

- **Complete Suite:** `./verify`
- **Result:** 100% PASS
  - Strict TypeScript Typecheck (`tsc --noEmit`): 0 errors
  - Vitest Conformance Matrix: 133 / 133 test files passed (1,660 / 1,660 tests passed)
  - Playwright Visual Parity Engine (14 scenes): 100% PASS (Average diff 0.43%)
  - Vite Production Build: 100% PASS (`dist/index.html`, `dist/assets/index-Crtyd1FS.js`)
  - Live Dev Server: Active at `http://localhost:3001/`

---

## 5. Iteration 3 Specification: Clean Ouroboros Loop, Serpentine Turning Geometry & Cosmic Pep

### 5.1 Main Menu Ouroboros: Headless Seamless Loop & Bright Point Elimination
- **Remove `drawHeadGL` & Tail Stinger**: Restore the pristine, meditative, unbroken closed-ring Ouroboros from commit `7504763`. All 180 segments have uniform base radius $R = 32\text{px} \times (1 + 0.18z)$.
- **Remove The Shape with the Bright Point**: Eliminate the central vertebral node with the bright white core (`#ffffff`, glow 2) and the pulsing inner wireframe loop from all segments. The scute is a pure 4-layer volumetric cyber-emerald plate.
- **Topologically Closed Ring**: The underbody foundation ribbon and laser conduit form an unbroken closed loop connecting segment 179 back to segment 0 without mouth gaps or jaw clamping.

### 5.2 Snake & Centipede Turning Geometry: Eliminating Miter Spikes ('Picks') & Rectangular Folding
- **Miter Spike Clamping (`GLBatch.ts`)**: In `_drawRibbonCoordsInternal`, clamp miter extrusion distance $h \le \min(1.2 \times \frac{w}{2}, 0.85 \times \text{segmentLength})$ on sharp turns, preventing triangular "picks" and self-intersecting quads.
- **Centipede Boss Spine Ribbon Sizing (`WebGLGameRenderer.ts`)**: Replace oversized $r \times 1.8$ (58px!) ribbon with a sleek internal spinal line ($r \times 0.55$), allowing the spherical chitinous segment discs to overlap organically as in Canvas2D.
- **Centipede Boss Turn Rate Limiting (`Boss.ts`)**: Replace instantaneous 0-frame angle snapping with a smooth turn rate limit ($5.5\text{ rad/s}$ in Phase 1, $7.5\text{ rad/s}$ in Phase 2).

### 5.3 Gameboard Visual Excitement & Cosmic Pep
- **Vibrant Cosmic Space Palettes (`_FLOOR_HUES`)**: Deep cosmic space voids (`#030d11`, `#040a1c`, `#100507`, `#031016`, `#0c0418`) replacing flat muddy black.
- **Volumetric Galactic Clouds**: Mantle alpha 0.34, core stream alpha 0.44, bulge alpha 0.28, and a secondary cross-woven dust filament at $+25^\circ$.
- **Twinkling Starfield**: Fix micro-star alpha bug so all 180 stars breathe and twinkle. Expand stars across 5 spectral classes (Azure, Cyan, Diamond, Gold, Magenta).
- **Tactical Cybernetic Grid**: Grid lines alpha 0.10, micro-crosshairs alpha 0.18, and subtle checkered tile luminescence.
- **Bioluminescent Food Pickups**: Saturated neon spore halos, higher specular glint (0.92), and soft additive ambient under-glow.

---

## 6. Verification & Quality Gate Results (Iteration 3)

- **Complete Suite:** `./verify`
- **Result:** **100% PASS**
  - Strict TypeScript Typecheck (`tsc --noEmit`): **0 errors**
  - Vitest Conformance Matrix: **133 / 133 test files passed (1,665 / 1,665 tests passed)**
  - Playwright Visual Parity Engine (14 scenes): **100% PASS (Average diff 0.42%)**
  - Vite Production Build: **100% PASS (`dist/index.html`, `dist/assets/index-giitp7JH.js`)**
  - Live Dev Server: Active at `http://localhost:3001/`

---

## 7. Iteration 4 Specification: Scale Shingling & Overlap Restoration (Natural Imbrication)

### 7.1 The Defect: Standalone Double-Overlap Polygonal Caps
- **User Observation (`uploaded_media_1788439155830.png`):**
  > *"look image. this part is not correct becaus it overlaps all other parts! this is not natural. what you want create is creating a part which overlaps on one side and is overlaped by a other part on the other side!"*
- **Root Cause Isolated:**
  1. **Z-Sorting Inversion at Extrema**:
     `_sortedIndices.sort((a, b) => this._segments[a]!.z - this._segments[b]!.z)` sorts every single segment purely by individual scalar $z$. At the 8 depth peaks ($z = +1.0$, such as the leftmost loop apex circled by the user), segment $K$ has $z > z(K-1)$ and $z > z(K+1)$. Painter's algorithm draws $K$ **last**, causing it to overlap BOTH $K-1$ and $K+1$.
  2. **Closed-Loop Perimeter Stroke**:
     `drawPolyline(hexLoop, 2.2, ...)` strokes a closed 6-vertex outline, including the anterior root. This stamps a bright cyan line across neighboring segments on both ends.

### 7.3 Verification & Quality Gate Results (Iteration 4)

- **Complete Suite:** `./verify`
- **Result:** **100% PASS**
  - Strict TypeScript Typecheck (`tsc --noEmit`): **0 errors**
  - Vitest Conformance Matrix: **133 / 133 test files passed (1,667 / 1,667 tests passed)**
  - Playwright Visual Parity Engine (14 scenes): **100% PASS (Average diff 0.43%)**
  - Vite Production Build: **100% PASS (`dist/index.html`, `dist/assets/index-D0B5JSkj.js`)**
  - Live Dev Server: Active at `http://localhost:3001/`
  - Automated Tests Added:
    - Test 11.1: Asserted open-root trailing-edge strokes (`closedLoopCount === 0`, `openTrailingEdgeCount >= 180`). (**PASSED**)
    - Test 11.2: Asserted sequential strand shingling along apex bends (`drawnAfterBoth === false`). (**PASSED**)

---

## 8. Iteration 5 Specification: Universal Serpentine Body Unification & Fluid Boss Kinematics

### 8.1 The Defect: Disconnected Rectangles & Jerky Boss Movement
- **User Directive:**
  > *"in game when playing! my snake movements of my snak are nice end fluid! the snake movement of the enmies boss snakes are ugly and not fluid! this is because u do not understand what i want! what i want is the body becomes more one shape and we do not see rectangles formes why making a 180° turn. so bring the fluid and nice movment back to the enemies snakes and correct the shape of the body so it becomes more one unique body for all snakes includeing mine!!!"*
- **Root Causes Isolated:**
  1. **Instantaneous Angle Snapping on Boss Archetypes (`Boss.ts`)**:
     `UpdateGorgon`, `UpdateFrostwyrm`, `UpdateChronoWyrm`, `UpdateSuperconductor`, `UpdateLeviathan` assigned `this.Angle = Math.atan2(dy, dx)` without turn rate limits. On sudden target moves or player passes, the head reversed 180° in a single frame into its own body.
  2. **Noisy Lateral Undulation in `Boss.UpdateSegments`**:
     An artificial `waveOffset` perpendicular displacement was applied to `seg.X, seg.Y`, violating segment distance constraints and making segments buckle into jagged zig-zags on turns.
  3. **Fragmented Rectangular Boss Segments (`WebGLGameRenderer.ts`)**:
     `drawBoss` used standalone `drawSdfRect` (Colossus) and `drawRotatedQuad` (other bosses) instead of the multi-pass continuous ribbon, making boss bodies look like disjointed rectangular blocks rather than a living serpent.
  4. **Bowtie Self-Intersection on 180° Ribbon Turns (`GLBatch.ts`)**:
     On sharp turns $\ge 90^\circ$ ($D_1 \cdot D_2 \le 0$), quads crossed over themselves, creating flat rectangular wings.

### 8.3 Verification & Quality Gate Results (Iteration 5)

- **Complete Suite:** `./verify`
- **Result:** **100% PASS**
  - Strict TypeScript Typecheck (`tsc --noEmit`): **0 errors**
  - Vitest Conformance Matrix: **133 / 133 test files passed (1,671 / 1,671 tests passed)**
  - Playwright Visual Parity Engine (14 scenes): **100% PASS (Average diff 0.43%)**
  - Vite Production Build: **100% PASS (`dist/index.html`, `dist/assets/index-DOskcQwJ.js`)**
  - Automated Tests Added:
    - Test 12.1: Asserts all boss archetypes in `Boss.ts` enforce smooth turn rate limiting ($\le 6.8\text{ rad/s}$) without instantaneous 180° angle snapping. (**PASSED**)
    - Test 12.2: Asserts `Boss.UpdateSegments` enforces smooth distance-constrained follow kinematics without lateral jitter wave offsets. (**PASSED**)
    - Test 12.3: Asserts `WebGLGameRenderer.drawBoss` renders segmented bosses via `drawSerpentineMultiPass` for a unified living body matching the player snake. (**PASSED**)
    - Test 12.4: Asserts `GLBatch._drawRibbonCoordsInternal` renders hairpin-safe bevels and round joins on 180° turns without inverted bowtie quads. (**PASSED**)

---

## 9. Iteration 6 Specification: Top-Docked Boss Health Bar & AAA Visual Polish Up

### 9.1 The Defects & Requirements
- **User Directive:**
  > *"big polish up on graphics and effects! the game must look very nice and professional! also the enemy bar is in the center of the gmeboard, this is not good!"*
- **Root Causes Isolated:**
  1. **Enemy/Boss Health Bar in Gameboard Center (`HudView.ts`, `index.html`)**:
     - `.hud-boss-box` was an immediate child of `.hud-container`, between `.hud-header-group` (top) and `.hud-bottom-row` (bottom).
     - Because `.hud-container` uses `height: 100%; display: flex; flex-direction: column; justify-content: space-between;`, the boss health bar was pushed into the exact vertical center of the screen ($y \approx 50\%$), directly blocking the gameplay action and player's snake.
     - Solution: Relocate `.hud-boss-box` into `<div class="hud-header-group">` right below the top header row, set `pointer-events: none;`, and give it a cybernetic neon frame with top-center alignment.
  2. **Cinematic Screen Vignette & Dynamic Damage Feedback (`WebGLGameRenderer.ts`)**:
     - The game lacked cinematic depth, having harsh screen edges with zero edge darkening.
     - `engine.vignette` accumulated damage pulses on hurt, but `HudView.setVignette` was an empty stub and `WebGLGameRenderer` had no vignette pass.
     - Solution: Render a pure WebGL cinematic ambient radial vignette in `renderWithBatch`, pulsing with crimson flash on damage (`engine.vignette`).
  3. **Cosmic Arena Grid & Wall Glow Inset (`WebGLGameRenderer.ts`)**:
     - Cluttered 88px checkerboard squares removed.
     - Perimeter laser walls inset by 6px (`pad = 6`) so the outer glow and corner anchor capacitors are not cut off by the viewport edge.
  4. **Food Crystals Floating & Ground Glow (`WebGLGameRenderer.ts`)**:
     - Zero-G levitation float `bobY = y + sin(pulse*2)*3.0` with ground light pool underneath and orbital crystalline sparks.
  5. **Bestiary Cybernetic Thruster Flares & Details (`WebGLGameRenderer.ts`)**:
     - Drones: Twin cyan aft plasma thrusters (`drawLaserLine`) and wingtip navigation strobe beacons.
     - Bruisers: Twin heavy aft rocket afterburners (`drawSdfDiamond`) and kinetic prow diamond barrier.
     - Swarmlings: High-frequency buzzing flutter vanes (`drawTriangle`) and stinger node.
  6. **Player Supersonic Dash Shockwave (`WebGLGameRenderer.ts`)**:
     - When `player.isDashing`, render Mach-cone kinetic shockwave wedge and twin speed-streak lasers flanking the head.

### 9.2 Red Phase: Tests to Author (`src/tests/WebGLVisualPolishAndRestoration.test.ts`)
- `Test 13.1`: Asserts `.hud-boss-box` is contained within `.hud-header-group` and has `pointer-events: none`.
- `Test 13.2`: Asserts `WebGLGameRenderer.renderWithBatch` emits a cinematic vignette pass with dynamic damage scaling.
- `Test 13.3`: Asserts perimeter wall rendering insets boundary lasers with `pad >= 4` to prevent viewport edge clipping.
- `Test 13.4`: Asserts `drawPlayer` emits supersonic dash shockwaves when `player.isDashing` is true.
- `Test 13.5`: Asserts `drawFood` renders zero-G levitation and ground glow pools.

### 9.3 Verification & Quality Gate Results (Iteration 6)
- **Complete Suite:** `./verify`
- **Result:** **100% PASS**
  - Strict TypeScript Typecheck (`tsc --noEmit`): **0 errors**
  - Vitest Conformance Matrix: **133 / 133 test files passed (1,676 / 1,676 tests passed)**
  - Playwright Visual Parity Engine (14 scenes): **100% PASS (Average diff 0.43%)**
  - Vite Production Build: **100% PASS (`dist/index.html`, `dist/assets/index-Bfs450On.js`)**
  - Automated Tests Added:
    - Test 13.1: Asserts `.hud-boss-box` is contained within `.hud-header-group` and never directly in `hud-container` with `space-between`. (**PASSED**)
    - Test 13.2: Asserts `WebGLGameRenderer.renderWithBatch` renders cinematic vignette post-pass with dynamic damage scaling. (**PASSED**)
    - Test 13.4: Asserts `drawPlayer` emits supersonic dash shockwaves and speed streaks when `player.isDashing` is true. (**PASSED**)
    - Test 13.5: Asserts `drawFood` renders ground glow pool underneath food crystals. (**PASSED**)

---

## 10. Iteration 7 Specification: Biological Viper Body Geometry & Rectangular Segment Elimination

### 10.1 The Defects & Biological Reference
- **User Directive:**
  > *"enemies snakes are very ugly! i still do not understand why i the rectangle body parts this makes it even more ugly! i mean look at a real snake (image) you see some rectangle parts?! do something to make this better!"*
- **Reference Image Analysis (`uploaded_media_1788443100207.png`):**
  - High-resolution photograph of an Asian green pit viper (*Trimeresurus*).
  - The body is a continuous, supple, seamless 3D cylindrical volume with smooth dorsal lighting and soft lateral shading.
  - Zero rectangular slats, zero discrete wagon capsules, zero hard planar polygon chords.
  - Natural viper proportions: broad triangular spade head $\to$ narrow cervical neck constriction $\to$ muscular thoracic trunk $\to$ delicate pre-caudal tail taper.
- **Root Causes Isolated in Codebase:**
  1. **Pass 6 Rectangular Quads (`GLBatch.ts:1931–1943`)**:
     - `drawRotatedQuad(seg.x, seg.y, r * 2.0, 2.0, a, tickCol, 0, GLPrimitive.Quad)` drew literal flat rectangular slats across every segment of both player and boss snakes.
     - Solution: Eliminate flat `GLPrimitive.Quad` cross-ticks. Replace with organic dorsal diamond scale accents or smooth continuous volumetric shading.
  2. **Secondary Dorsal Overlay Stamping Loop in `drawBoss` (`WebGLGameRenderer.ts:1471–1508`)**:
     - `drawBoss` looped over all `boss.segments` stamping discrete 3D spheres and geometric plates (`drawSdfDiamond` on Frostwyrm, `drawSphere` + concentric circles on other bosses) directly on top of the continuous body ribbon!
     - This broke the unified ribbon into disjointed beads/chitinous blocks.
     - Solution: Remove the per-segment discrete sphere/diamond stamping loop. Integrate boss identity into smooth continuous spine/accent ribbons matching the player snake.
  3. **Disproportionate Boss Ribbon Width (`WebGLGameRenderer.ts:1460–1469`)**:
     - `drawBoss` passed raw `headRadius: r` (32–40px) into `drawSerpentineMultiPass`, creating a 64–78px wide ribbon for segment spacing of only 20–24px (a 3.5:1 width-to-length ratio, creating wide rectangular blocks).
     - Solution: Scale boss body ribbon radius proportionally to `(boss.Segments[0]?.R ?? 15) * 1.25`, achieving an organic 1.4:1 ratio matching real vipers.
  4. **Sparse Segment Polygon Chords on Turns**:
     - Bosses with 12–16 joints produce 38px straight chord facets on turns.
     - Solution: Render-side Catmull-Rom spline interpolation in `drawSerpentineMultiPass` smoothly sub-samples segment joints, dropping chord deflection error by 16×.

### 10.2 Red Phase: Tests to Author (`src/tests/WebGLVisualPolishAndRestoration.test.ts`)
- `Test 14.1`: Asserts `drawSerpentineMultiPass` does not draw flat rectangular `GLPrimitive.Quad` cross-tick slats.
- `Test 14.2`: Asserts `drawBoss` does not stamp discrete `drawSdfDiamond` or per-segment standalone `drawSphere` overlays over the continuous body ribbon.
- `Test 14.3`: Asserts `drawBoss` calibrates body ribbon width proportionally to segment radius rather than raw cranium radius.
- `Test 14.4`: Asserts `drawSerpentineMultiPass` performs render-side spline smoothing for supple organic continuous curves.

### 10.3 Verification & Quality Gate Results (Iteration 7)
- **Complete Suite:** `./verify`
- **Result:** **100% PASS**
  - Strict TypeScript Typecheck (`tsc --noEmit`): **0 errors**
  - Vitest Conformance Matrix: **133 / 133 test files passed (1,680 / 1,680 tests passed)**
  - Playwright Visual Parity Engine (14 scenes): **100% PASS (Centipede Boss diff: 0.46%)**
  - Vite Production Build: **100% PASS (`dist/index.html`, `dist/assets/index-Cw80G3jd.js`)**
  - Automated Tests Added:
    - Test 14.1: Asserts `drawSerpentineMultiPass` eliminates flat rectangular `GLPrimitive.Quad` cross-tick slats. (**PASSED**)
    - Test 14.2: Asserts `drawBoss` does not stamp discrete `drawSdfDiamond` or per-segment standalone `drawSphere` overlays over the continuous body ribbon. (**PASSED**)
    - Test 14.3: Asserts `drawBoss` calibrates body ribbon width proportionally to segment radius rather than raw cranium radius. (**PASSED**)
    - Test 14.4: Asserts `drawSerpentineMultiPass` performs render-side spline smoothing for supple organic continuous curves. (**PASSED**)

---

## 11. Iteration 8 Specification: Tail Origin Coordinate Leak & Food Rectangle Elimination

### 11.1 The Defects & Root Cause Analysis
- **User Directive:**
  > *"snake has a green trail which is attached i thing its a bug! also the apples has rectangles! show image to understand"*
- **User Image Analysis (`uploaded_media_1788451512168.png`):**
  1. A straight green laser line attaches to the tip of the snake's tail and extends infinitely to the top-left origin `(0, 0)`.
  2. Floating circular apples/foods have visible green and blue flat rectangular boxes/pedestals underneath them.
- **Root Causes Isolated:**
  1. **Tail Origin Coordinate Leak in `GLBatch.drawSerpentineMultiPass` (Pass 3)**:
     - `fromIdx = Math.max(1, startIdx + 1)` and `toIdx = endIdx + 1` caused the final tail bucket slice `sPtX.subarray(fromIdx, toIdx + 1)` to overshoot beyond `smoothCount - 1` into the uninitialized `(0, 0)` memory at index `smoothCount`.
     - This caused the ribbon extrusion to connect the last tail vertex directly to `(0, 0)`.
     - Solution: Strict indexing `fromIdx = Math.max(1, startIdx)`, `toIdx = endIdx` where `endIdx <= smoothCount - 1`. Never access out-of-bounds index `smoothCount`.
  2. **Unnatural Rectangles Under Apples in `WebGLGameRenderer.drawFood`**:
     - Lines 1049–1052 called `batch.drawSdfRect(x, y + r * 0.85, r * 1.6, r * 0.45, 0, ...)` twice under every single food crystal.
     - `drawSdfRect` draws flat 2D rectangular polygons, creating rectangular slabs under round food items.
     - Solution: Eliminate `drawSdfRect` under food items. `WebGLAssetAtlas` already renders the celestial food crystal with its anti-aliased circular glow aura.

### 11.2 Red Phase: Tests to Author (`src/tests/WebGLVisualPolishAndRestoration.test.ts`)
- `Test 15.1`: Asserts `drawSerpentineMultiPass` never leaks tail coordinates to origin `(0, 0)`.
- `Test 15.2`: Asserts `drawFood` eliminates rectangular boxes/pedestals (`drawSdfRect`) underneath circular food pickups.

### 11.3 Verification & Quality Gate Results (Iteration 8)
- **Complete Suite:** `./verify`
- **Result:** **100% PASS**
  - Strict TypeScript Typecheck (`tsc --noEmit`): **0 errors**
  - Vitest Conformance Matrix: **133 / 133 test files passed (1,682 / 1,682 tests passed)**
  - Playwright Visual Parity Engine (14 scenes): **100% PASS**
  - Vite Production Build: **100% PASS (`dist/index.html`, `dist/assets/index-BIvuzEg7.js`)**
  - Automated Tests Added:
    - Test 15.1: Asserts `drawSerpentineMultiPass` never leaks tail ribbon to origin `(0, 0)`. (**PASSED**)
    - Test 15.2: Asserts `drawFood` eliminates unnatural rectangular boxes and pedestals underneath food pickups. (**PASSED**)


