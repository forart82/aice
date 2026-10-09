# Feature TDD Specification: Serpentine Body, Tail Taper & Damage Overlay Parity

> **Feature Identifier:** `docs/tdd/serpentine_body_tail_and_damage_overlay_parity.tdd.md`  
> **Status:** Green / Refactored  
> **Target Directory:** `/home/forart/dev/snake_ts`  
> **Rule Reference:** [`AGENTS.md#rule-2`](file:///home/forart/dev/snake_ts/AGENTS.md) & [`ORACLE.md`](file:///home/forart/dev/snake_ts/ORACLE.md)  

---

## 1. Feature Overview & Requirements

- **High Concept:** Achieve 100% visual parity between Canvas2D (`SnakeRenderer.ts`) and WebGL (`GLBatch.ts`) for the multi-pass serpentine body pipeline:
  1. **Pass 7.5 Damage Warning Rings Parity:** Change warning rings to stroke in `GLBlendMode.NORMAL` with `glow = 0` and exact 1.8px line width (`#f59e0b` for moderate damage 35-99% HP, `#ef4444` for critical damage <35% HP). Eliminate blinding additive halos/glowing donuts.
  2. **Tail Tip Ball Elimination & Sleek Taper Parity:** Eliminate the massive glowing cyan circle at the tail tip drawn in Pass 2 (`wTail = headR * 1.85`, `glow = 10`). Allow Pass 3's sleek taper (down to 1.5px - 2px) to terminate cleanly with an exact tapered end cap (`Math.max(1.5, headR * 2 * (1 - 0.9)) * 0.5`) or omitted tail circle so Pass 3 is never obscured.
  3. **Pass 2B Vertebrae Carapaces Smoothing:** Replace `GLPrimitive.Sphere` (which created 3D specular/dark shadow steps and blocky lumps along the spine) with smooth flat `GLPrimitive.Circle` discs in `colPacked` plus the cybernetic accent border in `accentPacked` (`GLPrimitive.Ring`), matching Canvas2D's flat fill + 1.4px accent stroke.
  4. **Serpentine Tail Taper & Dynamic Spine Radius Parity:** Calculate joint disc radius `jointR(i)` and ribbon width dynamically along the snake spine parameter $t = i / \max(1, \text{totalPoints} - 1)$:
     - For $t \in [0, 0.3]$: full body width ($1.0$).
     - For $t \in (0.3, 1.0]$: smooth quadratic decay $\text{taper} = 1.0 - \left(\frac{t - 0.3}{0.7}\right)^2 \times 0.90$.
     - Minimum radius clamped to $\max(1.5, \text{baseR} \times 0.10)$.
     - In Pass 1 (Shell): draw join disc with radius `shellR * taper` and continuous ribbon with matching tapered width.
     - In Pass 2 (Lit Core): draw join disc with radius `litCoreR * taper` and continuous ribbon with matching tapered width.
     - In Pass 3 (Tail Taper): align 6 LOD buckets seamlessly with tapered joint discs, ending in a sleek, elegant serpentine point without blunt cutoffs or swollen spheres.
- **Target Systems:** `src/render/webgl/GLBatch.ts`, `src/render/SnakeRenderer.ts`
- **Mechanics Reference:** [`ORACLE.md#serpentine-rendering`](file:///home/forart/dev/snake_ts/ORACLE.md)

---

## 2. Test Plan & Assertions (Red Phase)

- **Test Suite Location:** `src/tests/SerpentineBodyTailAndDamageOverlayParity.test.ts`
- **Assertions:**
  1. `Pass 7.5`: Explicitly sets `GLBlendMode.NORMAL` for damage warning overlays.
  2. `Pass 7.5`: Moderate damage rings (35-99% HP) use `glow = 0`, line width 1.8, and `#f59e0b`.
  3. `Pass 7.5`: Critical damage rings (<35% HP) use `glow = 0`, line width 1.8, and `#ef4444`.
  4. `Tail End Cap`: Pass 1, 2, 4, 5 do NOT draw a massive circular end cap at the tail tip (`ptX[count - 1]`).
  5. `Tail Sleek Taper`: Pass 3 finishes with a sleek tapered end cap (`Math.max(1.5, headR * 2 * (1 - 0.9)) * 0.5`) with `glow = 0`.
  6. `Pass 2B Vertebrae`: Uses `GLPrimitive.Circle` (not `GLPrimitive.Sphere`) with `glow = 0` for seamless blending into the lit flesh ribbon.
  7. `Pass 2B Vertebrae`: Draws the cybernetic accent border using `accentPacked` in `GLBlendMode.NORMAL`.
  8. `Dynamic Joint Radius Taper`: Pass 1 & Pass 2 joint discs strictly decay quadratically for $t > 0.3$, reaching $\le \max(1.5, \text{baseR} \times 0.10)$ at the tail tip without bloated spheres.

---

## 3. Implementation Details (Green Phase)

- **Files Created/Modified:**
  - `src/render/webgl/GLBatch.ts`:
    - Added `roundTailCap: boolean = true` parameter to `_drawRibbonCoordsInternal` to allow selective omission of tail tip circles.
    - Updated `drawSerpentineMultiPass`:
      - Pass 1, Pass 2, Pass 4, Pass 5: Pass `roundTailCap = false` to eliminate the 22px glowing cyan sphere and large background discs at the tail tip.
      - Pass 2B: Switched from `GLPrimitive.Sphere` to `GLPrimitive.Circle` in `colPacked` and added cybernetic accent border in `accentPacked` with `GLPrimitive.Ring` in `GLBlendMode.NORMAL`, eliminating blocky 3D steps and achieving 100% visual parity with Canvas2D.
      - Pass 3: Added exact sleek tapered end cap of radius `Math.max(1.5, headR * 2 * (1 - 0.9)) * 0.5` with `glow = 0`.
      - Pass 7.5: Switched to `GLBlendMode.NORMAL`, `glow = 0`, and exact 1.8px line width for `#f59e0b` moderate damage rings and `#ef4444` critical damage rings.
    - Added `blendMode` getter to `GLBatch`.
  - `src/tests/SerpentineBodyTailAndDamageOverlayParity.test.ts`: 4 automated unit & integration tests covering all requirements.

---

## 4. Verification & Quality Check

```bash
npx vitest run src/tests/SerpentineBodyTailAndDamageOverlayParity.test.ts
npm run typecheck
```

- **Vitest Output:** 4/4 tests passed (100%).
- **TypeScript Typecheck:** 0 errors (strict mode).
- **Regression Suites:** `ContinuousSerpentineMeshRibbon.test.ts` (10/10 PASS), `PureWebGLSerpentineRibbonAndHead.test.ts` (7/7 PASS), `WebGLGameRenderer.test.ts` (18/18 PASS).
