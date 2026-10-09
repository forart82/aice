# Feature TDD Specification: Continuous Serpentine Mesh Ribbon & Bisector Extrusion

> **Feature Identifier:** `docs/tdd/continuous_serpentine_mesh_ribbon.tdd.md`  
> **Status:** Green / Verified  
> **Target Directory:** `/home/forart/dev/snake_ts`  
> **Rule Reference:** [`AGENTS.md#rule-2`](file:///home/forart/dev/snake_ts/AGENTS.md), [`AGENTS.md#rule-6`](file:///home/forart/dev/snake_ts/AGENTS.md), [`AGENTS.md#rule-10`](file:///home/forart/dev/snake_ts/AGENTS.md) & [`ORACLE.md`](file:///home/forart/dev/snake_ts/ORACLE.md)  

---

## 1. Feature Overview & Requirements

- **High Concept:** Replace disconnected line/laser quad segments in `GLBatch.ts` with continuous normal-extruded triangle-strip / quad-strip mesh generation using joint bisector normals and semicircular round end caps.
- **Target Systems:** `src/render/webgl/GLBatch.ts`, `src/render/webgl/WebGLGameRenderer.ts`, `src/render/webgl/WebGLContext.ts`
- **Key Geometric & Mechanical Invariants:**
  1. **Bisector Normal Derivation:** For centerline vertices $p_0, p_1, \dots, p_N$, calculate segment directions $\vec{d}_i = p_{i+1} - p_i$ and 2D left normals $\vec{n}_i = (-d_{i,y}, d_{i,x}) / \|\vec{d}_i\|$. At each interior joint $i$, calculate bisector normal $\vec{n}_{\text{bisect}} = \text{normalize}(\vec{n}_{i-1} + \vec{n}_i)$.
  2. **Miter Limiting:** Scale extrusion distance along bisector by miter factor $m = \min(1.5, 1.0 / \max(0.5, \vec{n}_{\text{bisect}} \cdot \vec{n}_{i-1}))$ to prevent sharp corner spikes or numerical singularities while maintaining uniform ribbon width.
  3. **Zero Seams / Zero Hotspots:** Contiguous quads share exact boundary vertices $(V_{L, i}, V_{R, i})$, eliminating joint gaps, overlapping interior seams, and additive blend mode double-exposure hotspots.
  4. **Round End Caps:** Semicircular round end caps at head ($p_0$) and tail ($p_N$) with radius $W/2$ matching Canvas 2D `lineCap = 'round'` parity.
  5. **Complete 7.5-Pass Cybernetic Serpentine Pipeline:**
     - **Pass 1 (Shell Outline):** Continuous ribbon mesh, width $2 \cdot headR + 4$, color `#02050c`, alpha 0.85, normal blend mode.
     - **Pass 2 (Lit Flesh Core):** Continuous ribbon mesh, width $1.85 \cdot headR$, glow 10, additive blend mode, `GLPrimitive.Laser` UV mapping ($u=0$ along spine, crossDist across width, zero segment fading).
     - **Pass 2B (Vertebrae Carapaces):** Batched oriented carapaces & accent rings with dynamic LOD.
     - **Pass 3 (Tail Taper):** Continuous ribbon sub-meshes across 6 LOD buckets with quadratic width decay $2 \cdot headR \cdot (1 - 0.9 e)$ and color shading.
     - **Pass 4 (Ventral Shadow):** Continuous ribbon mesh offset by $(+0.16 \cdot headR, +0.36 \cdot headR)$, width $0.85 \cdot headR$, alpha 0.3.
     - **Pass 5 (Wet Top Ridge Highlight):** Continuous ribbon mesh offset by $(-0.2 \cdot headR, -0.34 \cdot headR)$, width $0.6 \cdot headR$, alpha 0.18.
     - **Pass 6 (Scale Rings / Cross-Ticks):** Perpendicular ticks with dynamic LOD.
     - **Pass 7 (Bioluminescent Nodes):** Additive SDF circles with dynamic LOD.
     - **Pass 7.5 (Damage Warning Overlays):** Hit flashes, critical red rings (<35% HP), amber warning rings (35–99% HP), crack lines (<50% HP).
  6. **Zero-Allocation Typed Array Scratch Buffers:** Reusable pre-allocated typed arrays for continuous ribbon calculations to maintain 60/120 FPS without GC stutters.

---

## 2. Test Plan & Assertions (Red Phase)

- **Test Suite Location:** `src/tests/ContinuousSerpentineMeshRibbon.test.ts`
- **Assertions:**
  1. `1.1 computes exact perpendicular left/right extrusion on straight polylines without distortion`
  2. `1.2 computes 45-degree bisector normal on 90-degree corner joints with proper miter scaling`
  3. `1.3 safely handles degenerate zero-length segments and 180-degree hairpin foldbacks without NaN`
  4. `2.1 generates seamless contiguous quad strip with shared boundary vertices between adjacent segments`
  5. `2.2 adds semicircular round end caps at head and tail with radius matching ribbon half-width`
  6. `2.3 supports variable width along ribbon length via width function or array`
  7. `3.1 executes all 7.5 passes of serpentine multi-pass pipeline using continuous mesh generation`
  8. `3.2 eliminates additive blend mode double-exposure hotspots in glowing core pass`
  9. `3.3 executes with zero runtime heap allocations using pre-allocated scratch buffers`
  10. `3.4 flushes and splits ribbon cleanly when vertex count exceeds buffer maxQuads`

---

## 3. Implementation Details (Green Phase)

- **Files Created/Modified:**
  - `src/render/webgl/GLBatch.ts`: Implement `drawContinuousRibbon` and update `drawSerpentineMultiPass` and `drawSerpentineRibbon`.
  - `src/tests/ContinuousSerpentineMeshRibbon.test.ts`: Dedicated test suite.

---

## 4. Verification & Quality Check

```bash
npx vitest run src/tests/ContinuousSerpentineMeshRibbon.test.ts
npm run typecheck
./verify
```
