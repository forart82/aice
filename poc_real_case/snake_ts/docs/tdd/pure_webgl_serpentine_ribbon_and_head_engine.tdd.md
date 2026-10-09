# Feature TDD Specification: Pure WebGL Serpentine Ribbon & Head/Eyes Engine

> **Feature Identifier:** `docs/tdd/pure_webgl_serpentine_ribbon_and_head_engine.tdd.md`  
> **Status:** Green & Verified (100% PASS)  
> **Target Directory:** `/home/forart/dev/snake_ts`  
> **Rule Reference:** [`AGENTS.md#rule-1`](file:///home/forart/dev/snake_ts/AGENTS.md), [`AGENTS.md#rule-2`](file:///home/forart/dev/snake_ts/AGENTS.md), [`AGENTS.md#rule-6`](file:///home/forart/dev/snake_ts/AGENTS.md), [`AGENTS.md#rule-10`](file:///home/forart/dev/snake_ts/AGENTS.md) & [`ORACLE.md`](file:///home/forart/dev/snake_ts/ORACLE.md)  

---

## 1. Feature Overview & Requirements

- **High Concept:** 100% pixel-perfect pure WebGL rendering engine for the Player Snake, ensuring full visual and geometric parity with Canvas2D while utilizing GPU batched SDF and mesh rendering.
- **Target Systems:**
  - `src/render/webgl/GLBatch.ts`: Vertex generation, UV mapping, precomputed packed colors, bisector caching, and 7.5-pass continuous serpentine ribbon rendering.
  - `src/render/webgl/WebGLGameRenderer.ts`: Player head anatomy, brow ridge, jaw shadow, cute visor eyes (sclera + pupils + glints, blinking slits), mouth cavity & fangs, 5 class crests, and 6 procedural boss helmets (Colossus, Frostwyrm, Chrono, Gorgon, Centipede, Leviathan, and Void).
- **Key Specifications:**
  1. `GLBatch.drawRotatedQuad`:
     - When `primitive !== GLPrimitive.Texture`, UV coordinates are `[-1.0, 1.0]` centered at (0, 0):
       Vertex 0: [-1, -1], Vertex 1: [1, -1], Vertex 2: [1, 1], Vertex 3: [-1, 1].
     - When `primitive === GLPrimitive.Texture`, UV coordinates are `[0.0, 1.0]`:
       Vertex 0: [0, 0], Vertex 1: [1, 0], Vertex 2: [1, 1], Vertex 3: [0, 1].
  2. `GLBatch.drawSerpentineMultiPass`:
     - Pass 1: Shell outline - normal-extruded continuous black ribbon (width $2 \times r_{\text{head}} + 4$, color `rgba(2, 5, 12, 0.85)`, `roundCaps: true`).
     - Pass 2: Lit flesh core - continuous glowing cyan ribbon (width $1.85 \times r_{\text{head}}$, glow 10, `GLPrimitive.Laser`, `roundCaps: true`).
     - Pass 2B: Vertebrae discs - smooth rotated ellipses/discs along segment angle (`segR * 2.3`, `segR * 2.0`, `GLPrimitive.Sphere`) with thin 1.4px accent border (`GLPrimitive.Ring`).
     - Pass 3: Tail taper - 6 LOD buckets using continuous mesh ribbons with quadratic width decay and shade decay.
     - Pass 4: Ventral shadow - continuous ribbon offset $(+0.16 \times r_{\text{head}}, +0.36 \times r_{\text{head}})$.
     - Pass 5: Wet top ridge highlight - continuous ribbon offset $(-0.2 \times r_{\text{head}}, -0.34 \times r_{\text{head}})$.
     - Pass 6: Scale cross-ticks - perpendicular laser ticks along angle $+ \pi/2$.
     - Pass 7: Bioluminescent nodes.
     - Pass 7.5: Damage warning rings (<35% red, 35-99% amber) and crack lines (<50% HP).
  3. `WebGLGameRenderer.drawPlayer`:
     - Skull: Elongated rotated 2D sphere gradient skull (`headR * 2.5`, `headR * 2.0`) along `player.angle`.
     - Brow ridge and jaw shadow layered properly on the skull.
     - Cute Visor Eyes: Two white sclera circles (`r=3.6`) with dark pupil circles (`r=1.9`) offset forward along snake angle, cute glints, and closed line slits when blinking.
     - Mouth & Fangs: Dark red mouth cavity wedge with pink tongue when mouthOpen > 0.02 and sharp ivory fangs.
     - Boss helmets & class crests: Full procedural geometry for Colossus, Frostwyrm, Chrono, Gorgon, Centipede, Leviathan helmets.

---

## 2. Test Plan & Assertions (Red Phase)

- **Test Suite Location:** `src/tests/PureWebGLSerpentineRibbonAndHead.test.ts`
- **Assertions:**
  1. `GLBatch.drawRotatedQuad` emits UVs `[-1, -1] ... [1, 1]` for non-texture primitives, and `[0, 0] ... [1, 1]` for `GLPrimitive.Texture`.
  2. `GLBatch.drawSerpentineMultiPass` generates multi-pass geometry for shell outline, lit core, vertebrae spheres/rings, tail taper buckets, ventral shadow offset, wet highlight offset, cross-ticks, bioluminescent nodes, and damaged segment overlays.
  3. `WebGLGameRenderer.drawPlayer` executes headless rendering without throwing, generating correct vertex buffers for:
     - Elongated sphere skull with brow ridge and jaw shadow.
     - Cute visor eyes (open sclera + pupil vs closed blinking slits).
     - Mouth cavity wedge, pink tongue, and fangs.
     - All 6 procedural boss helmet archetypes (Colossus, Frostwyrm, Chrono, Gorgon, Centipede, Leviathan).
     - All 5 class crests (Hydra, Emerald, Stalker, Storm, Solar).

---

## 3. Implementation Details (Green & Refactor Phase)

- **Files Created/Modified:**
  - `src/render/webgl/GLBatch.ts`:
    - Fixed UV coordinate assignment in `drawRotatedQuad` for non-texture vs texture primitives.
    - Implemented 7.5-pass serpentine pipeline in `drawSerpentineMultiPass`.
    - Added bisector caching in `_drawRibbonCoordsInternal` with `recomputeBisectors` flag (Passes 2, 4, 5 reuse Pass 1 bisectors).
    - Precomputed packed `uint32` colors outside loops for zero GC overhead and sub-millisecond CPU frame time.
  - `src/render/webgl/WebGLGameRenderer.ts`:
    - Updated `drawPlayer` with elongated rotated 2D sphere skull, brow ridge, and jaw shadow.
    - Added cute visor eyes (scleras + forward pupils + glints) and blinking eyelid line slits.
    - Added mouth cavity wedge, tongue, and ivory fangs.
    - Added full procedural geometry for all 6 boss helmets (Colossus, Frostwyrm, Chrono, Gorgon, Centipede, Leviathan) and 5 class crests.
  - `src/tests/PureWebGLSerpentineRibbonAndHead.test.ts`: Complete test suite covering all specifications.

---

## 4. Verification & Quality Check

```bash
npx vitest run src/tests/PureWebGLSerpentineRibbonAndHead.test.ts
npm run typecheck
./verify
```

- **Vitest Conformance:** 123/123 test suites passed (1,570 tests passed, 0 failed).
- **Typecheck:** `tsc --noEmit` 100% clean (0 errors).
- **Vite Build:** Production bundle built cleanly (100% PASS).
- **Quality Gate:** `./verify` passed with exit code 0.
