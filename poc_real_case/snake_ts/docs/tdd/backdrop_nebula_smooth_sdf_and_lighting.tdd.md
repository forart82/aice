# Feature TDD Specification: Backdrop Nebula Smooth SDF, Pre-baked Texture & Arena Lighting

> **Feature Identifier:** `docs/tdd/backdrop_nebula_smooth_sdf_and_lighting.tdd.md`  
> **Status:** Green  
> **Target Directory:** `/home/forart/dev/snake_ts`  
> **Rule Reference:** [`AGENTS.md#rule-2`](file:///home/forart/dev/snake_ts/AGENTS.md), [`AGENTS.md#rule-10`](file:///home/forart/dev/snake_ts/AGENTS.md) & [`ORACLE.md`](file:///home/forart/dev/snake_ts/ORACLE.md)  

---

## 1. Feature Overview & Requirements

- **High Concept:** Fix the harsh diagonal band and hard straight parallel boundaries cutting across Floor 3 (and other floors) by guaranteeing pre-baked backdrop texture creation/upload for any floor and resolution, and replacing the 16-band stepped quad fallback with a continuous 2D SDF / dual-harmonic Gaussian nebula shader with exponential edge falloff.
- **Target Systems:**
  - `src/render/webgl/WebGLContext.ts`: Add `GLPrimitive.Nebula = 6` with continuous 2D SDF shader and dual-harmonic Gaussian falloff.
  - `src/render/webgl/WebGLAssetAtlas.ts`: Ensure `getBackdropTexture` creates, caches, and returns valid pre-baked `WebGLTexture` for any floor (1..5 and looping >5) and resolution $(w, h)$, resilient to window resize and dynamic canvas dimensions.
  - `src/render/webgl/WebGLGameRenderer.ts`: Hook into `resize()` to pre-bake textures for new dimensions; replace 16-strip `GLPrimitive.Quad` fallback with smooth continuous 2D SDF shader.
  - `src/render/ArenaBackdrop.ts`: Fix `bakeNebulaDust()` linear gradient stops to follow a smooth Gaussian bell curve (luminous peak at center 0.50 with `palette.accent`, decaying symmetrically to `palette.mid` and 0 at boundaries) eliminating the inverted center trough / double railroad track artifact.
- **Mechanics Reference:** [`ORACLE.md`](file:///home/forart/dev/snake_ts/ORACLE.md) & [`AGENTS.md`](file:///home/forart/dev/snake_ts/AGENTS.md) (Rule 6, Rule 10).

---

## 2. Test Plan & Assertions (Red Phase)

- **Test Suite Location:** `src/tests/BackdropNebulaSmoothSdfAndLighting.test.ts`
- **Assertions:**
  1. `WebGLAssetAtlas.getBackdropTexture(gl, floor, w, h)` produces a non-null texture for all floors (1..5 and extended floors 6, 8, 15, 25) and any resolution ($1280 \times 720$, $1920 \times 1080$, $800 \times 600$).
  2. `WebGLAssetAtlas.getBackdropTexture(gl, floor, w, h)` provides resilient fallback: if an exact resolution match is missing, it falls back to an available texture for the same floorIndex rather than returning null.
  3. `WebGLGameRenderer.resize(width, height)` triggers pre-baking of backdrop textures for the new resolution across floors 1..5.
  4. `GLPrimitive.Nebula` (value 6) is defined in `WebGLContext` and handled in fragment shader with exponential edge falloff $\exp(-y^2 / 2\sigma^2)$.
  5. `WebGLGameRenderer.drawBackdrop` fallback branch does NOT draw 16 sharp rotated rectangular quads with `GLPrimitive.Quad`, but draws continuous 2D SDF nebula geometry with zero hard straight parallel lines.
  6. `ArenaBackdrop.bakeNebulaDust` gradient stops have a unimodal bell curve (peak alpha at center 0.50 with `palette.accent` $\ge$ mantle alpha at 0.35/0.65) eliminating the inverted center valley / double railroad tracks.

---

## 3. Implementation Details (Green Phase)

- **Files Created/Modified:**
  - `src/tests/BackdropNebulaSmoothSdfAndLighting.test.ts`
  - `src/render/webgl/WebGLContext.ts`
  - `src/render/webgl/WebGLAssetAtlas.ts`
  - `src/render/webgl/WebGLGameRenderer.ts`
  - `src/render/ArenaBackdrop.ts`
  - `src/tests/EnemiesBossesAndCosmicNebulaVisualParity.test.ts`

---

## 4. Verification & Quality Check

```bash
npx vitest run src/tests/BackdropNebulaSmoothSdfAndLighting.test.ts
npm run typecheck
./verify
```

### Actual Results (100% PASS):
- `BackdropNebulaSmoothSdfAndLighting.test.ts`: 7/7 tests passed (0 failures).
- `EnemiesBossesAndCosmicNebulaVisualParity.test.ts`: 12/12 tests passed (0 failures).
- `VisualParityPixelDiff.test.ts`: 5/5 tests passed; backdrops match Canvas2D identically (<3.2% diff accounting for subpixel AA).
- `npm run typecheck`: 0 errors.
- `./verify`: 132 test files passed, 1636 tests passed, production build passed (100% PASS).
- Hard parallel boundaries and 16 stepped strips permanently eliminated. Smooth 2D SDF Gaussian falloff and resilient prebaked GPU texture caching confirmed across Floors 1..5.

