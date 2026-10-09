# Feature TDD Specification: Starfield Background Layering & Depth Order

> **Feature Identifier:** `docs/tdd/starfield_background_layering_and_depth_order.tdd.md`  
> **Status:** Red  
> **Target Directory:** `/home/forart/dev/snake_ts`  
> **Rule Reference:** [`AGENTS.md#rule-2`](file:///home/forart/dev/snake_ts/AGENTS.md), [`AGENTS.md#rule-10`](file:///home/forart/dev/snake_ts/AGENTS.md), [`AGENTS.md#rule-12`](file:///home/forart/dev/snake_ts/AGENTS.md), & [`ORACLE.md`](file:///home/forart/dev/snake_ts/ORACLE.md)  

---

## 1. Feature Overview & Requirements

- **High Concept:** Fix the visual depth layering hierarchy in the WebGL 2.0 rendering pipeline so that the starfield is strictly anchored in the deep cosmic background behind all arena structures (borders, floor grids) and gameplay entities (apples, food pickups, hazards, player).
- **Target Systems:**
  - `src/render/webgl/WebGLGameRenderer.ts` (`drawBackdrop`, `drawFood`, `renderWithBatch`)
  - `src/render/webgl/WebGLAssetAtlas.ts` (`getProceduralFoodAtlasPixels`, `hexToRgb`)
- **Mechanics Reference:** [`ORACLE.md#visual-presentation`](file:///home/forart/dev/snake_ts/ORACLE.md)

### Detailed Requirements:
1. **Deep Background Starfield Layering:**
   - The dynamic starfield (all 266 stars: micro-stars, mid-stars, and diamond beacons) and static micro-stars must be rendered strictly BEFORE the checkered celestial grid (arena floor) and BEFORE the perimeter laser border walls.
   - Deep background order in `drawBackdrop`:
     1. Cosmic Void base quad (`NORMAL`)
     2. 2D SDF Galactic Nebula Spine & Bulge (`NORMAL`)
     3. Static Sub-Pixel Deep Field Micro-Stars (`NORMAL`)
     4. Dynamic Multi-Tier Starfield with 4-point diamond flares (`ADDITIVE`)
     5. Blend mode flush and reset to `NORMAL`
     6. Checkered Celestial Grid & Coordinate Laser Lines with Micro-Crosshairs (rendered ON TOP of stars)
     7. Multi-Tier Perimeter Laser Border Walls (rendered ON TOP of stars, with solid base line + neon aura)
2. **Perimeter Border Inset & Star Occlusion:**
   - Stars must never cross or bleed over the perimeter border walls into outer margins. Stars must be bounded/clipped inside the arena boundary (`[pad, w - pad]`), and border walls must have a solid foundation pass under the neon glow so stars do not shine through the border.
3. **Blend Mode Sanitization:**
   - At the conclusion of `drawBackdrop()`, the batch blend mode must be unconditionally reset to `GLBlendMode.NORMAL`.
4. **Food Core Opacity & True Bioluminescence:**
   - Fix `WebGLAssetAtlas.hexToRgb()` to correctly handle `rgb(r, g, b)` strings returned by `ColorX.shade()`, restoring the bright luminous inner core of food items and eliminating the pitch-black pupil artifact (`[0, 11, 17]`).
   - In both texture atlas and procedural/fallback `drawFood()`, the food core must have 100% opaque backing rendered in `GLBlendMode.NORMAL` before additive outer halos, preventing any background star from bleeding or showing through the food body.

---

## 2. Test Plan & Assertions (Red Phase)

- **Test Suite Location:** `src/tests/StarfieldLayeringAndDepthOrder.test.ts`
- **Assertions:**
  1. `drawBackdrop` renders dynamic starfield strictly BEFORE the checkered celestial grid and coordinate lines.
  2. `drawBackdrop` renders perimeter laser border walls strictly AFTER the dynamic starfield.
  3. `drawBackdrop` resets batch blend mode to `GLBlendMode.NORMAL` before returning.
  4. Dynamic starfield coordinates and diamond flares are bounded within arena walls (`[pad, w - pad]` and `[pad, h - pad]`), preventing stars outside the perimeter.
  5. `WebGLAssetAtlas.getProceduralFoodAtlasPixels` generates bright, non-black inner cores for all food varieties (alpha = 255, RGB matching lightened shade rather than pitch black `[0, 11, 17]`).
  6. `drawFood` renders food cores with opaque normal blending so background starfield light cannot shine through apple cores.
  7. Full scene render pass verifies starfield -> grid -> borders -> food -> player order.

---

## 3. Implementation Details (Green Phase)

- **Files Created/Modified:**
  - `src/tests/StarfieldLayeringAndDepthOrder.test.ts` (new dedicated test suite)
  - `src/render/webgl/WebGLGameRenderer.ts` (reorder passes, bound stars inside arena, border solid pass, blend mode reset, food core opaque backing)
  - `src/render/webgl/WebGLAssetAtlas.ts` (fix `hexToRgb` to support `rgb(...)` strings)

---

## 4. Verification & Quality Check

```bash
npx vitest run src/tests/StarfieldLayeringAndDepthOrder.test.ts
./verify
```
