# Feature TDD Specification: Serpent Head, Eyes & Cranial Damage Visual Parity

> **Feature Identifier:** `docs/tdd/serpent_head_eyes_cranial_parity.tdd.md`  
> **Status:** Green (100% PASS)  
> **Target Directory:** `/home/forart/dev/snake_ts`  
> **Rule Reference:** [`AGENTS.md#rule-1`](file:///home/forart/dev/snake_ts/AGENTS.md) & [`ORACLE.md`](file:///home/forart/dev/snake_ts/ORACLE.md)  

---

## 1. Feature Overview & Requirements

- **High Concept:** Achieve 100% visual parity between Canvas2D (`SnakeRenderer.ts`) and WebGL (`WebGLGameRenderer.ts`, `WebGLContext.ts`, `GLBatch.ts`) for the serpent skull, eyes, cranial damage feedback, and class crests.
- **Target Systems:**
  - `src/render/webgl/WebGLContext.ts`: Sphere shader (`primType == 3`) removal of artificial inner rim multiplier blowout `col.rgb += v_color.rgb * (glow * edgeAlpha)`, rendering exact smooth 2D radial gradient matching `Ctx2D.createSphereGradient`.
  - `src/render/webgl/GLBatch.ts`: Addition of `drawSdfArc` for drawing partial stroked arc ribbons in NORMAL blend mode without gaps.
  - `src/render/webgl/WebGLGameRenderer.ts`:
    - Removal of synthetic forehead diamond on Emerald.
    - Removal of synthetic class crests on Stalker, Storm, and Solar (preserving Hydra extra heads).
    - Removal of synthetic fangs in mouth opening.
    - Cranial HP indicator rendered as an exact partial arc matching Canvas2D from `-Math.PI / 2` to `-Math.PI / 2 + headHpPct * MathX.Tau` in NORMAL mode with 2.5px width and zero glow.
    - External diffuse glow halo when glow > 0 rendered via soft quad rather than blowing out the sphere interior.
  - `src/render/SnakeRenderer.ts`: Visual parity check on eye sclera (r=3.6), pupil (r=1.9), and specular glint (r=0.65).
- **Mechanics Reference:** [`ORACLE.md#visual-feedback`](file:///home/forart/dev/snake_ts/ORACLE.md) & [`SnakeRenderer.ts`](file:///home/forart/dev/snake_ts/src/render/SnakeRenderer.ts)

---

## 2. Test Plan & Assertions (Red Phase)

- **Test Suite Location:** `src/tests/SerpentHeadEyesCranialParity.test.ts`
- **Assertions:**
  1. `WebGLContext` sphere fragment shader does not contain inner rim multiplier `glow * edgeAlpha`. (PASS)
  2. `GLBatch.drawSdfArc` exists and generates correct ribbon geometry for partial arcs. (PASS)
  3. `WebGLGameRenderer.drawPlayer` does not render synthetic diamond crest for Emerald class. (PASS)
  4. `WebGLGameRenderer.drawPlayer` does not render synthetic fins/prongs/spikes for Stalker, Storm, or Solar classes. (PASS)
  5. `WebGLGameRenderer.drawPlayer` renders partial arc for cranial damage indicator matching Canvas2D angles and normal blend mode. (PASS)
  6. `SnakeRenderer` and `WebGLGameRenderer` share identical eye geometry (sclera r=3.6, pupil r=1.9, glint r=0.65). (PASS)
  7. Mouth opening in WebGL matches Canvas2D cavity wedge and tongue without synthetic fangs. (PASS)

---

## 3. Implementation Details (Green Phase)

- **Files Created/Modified:**
  - `src/render/webgl/WebGLContext.ts`: Replaced inner rim multiplier formula with smooth antialiased edge alpha fade, eliminating white-hot neon rim blowout.
  - `src/render/webgl/GLBatch.ts`: Implemented `drawSdfArc(cx, cy, radius, startAngle, endAngle, width, color, alpha, glow, segments)` using continuous scratch ribbon miter geometry.
  - `src/render/webgl/WebGLGameRenderer.ts`:
    - Skull sphere now rendered with glow=0 in NORMAL mode; outer glow halo rendered via soft additive quad.
    - Hydra secondary heads placed under main skull with zero dark pupils matching Canvas2D.
    - Cranial damage indicator strokes partial arc via `drawSdfArc` in NORMAL mode with 2.5px width and 0 glow.
    - Mouth opening retains only cavity wedge and tongue; removed synthetic laser fangs.
    - Removed synthetic class crests on Emerald (diamond), Stalker (fins), Storm (prongs), and Solar (corona).
  - `src/render/SnakeRenderer.ts`: Added batched specular eye glints (r=0.65) matching WebGL.
  - `src/render/ColorX.ts`: Added `lerp` alias for `lerpColor`.
  - `src/tests/SerpentHeadEyesCranialParity.test.ts`: Dedicated 8-test unit verification suite.

---

## 4. Verification & Quality Check

```bash
npx vitest run src/tests/SerpentHeadEyesCranialParity.test.ts # 8/8 PASS
npm run typecheck # EXIT 0, ZERO ERRORS
```

