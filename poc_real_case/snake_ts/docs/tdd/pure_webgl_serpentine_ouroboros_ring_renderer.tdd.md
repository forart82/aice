# Feature TDD Specification: Pure WebGL Serpentine Ouroboros Ring Renderer

> **Feature Identifier:** `docs/tdd/pure_webgl_serpentine_ouroboros_ring_renderer.tdd.md`  
> **Status:** Red  
> **Target Directory:** `/home/forart/dev/snake_ts`  
> **Rule Reference:** [`AGENTS.md#rule-1`](file:///home/forart/dev/snake_ts/AGENTS.md), [`AGENTS.md#rule-2`](file:///home/forart/dev/snake_ts/AGENTS.md), [`AGENTS.md#rule-3`](file:///home/forart/dev/snake_ts/AGENTS.md), [`AGENTS.md#rule-10`](file:///home/forart/dev/snake_ts/AGENTS.md), [`AGENTS.md#rule-12`](file:///home/forart/dev/snake_ts/AGENTS.md) & [`ORACLE.md`](file:///home/forart/dev/snake_ts/ORACLE.md)  
> **Created:** 2026-09-04  

---

## 1. Feature Overview & Requirements

- **High Concept:**
  A magnificent, hardware-accelerated pure WebGL 2.0 serpentine Ouroboros ring renderer (`OuroborosGalleryRingRenderer`) for the Ouroboros Gallery shrine.
  The player's helmet gallery represents an Ouroboros as a grand circular ring housing 8 pedestal places on its perimeter, with the body forming a continuous circle while its neck and head gracefully curve inward toward the center (180, 180) to frame and embrace the 9th central pedestal where the Celestial Crown is forged.

- **Target Systems:**
  - `src/render/webgl/OuroborosGalleryRingRenderer.ts`: WebGL 2.0 rendering pipeline with custom vertex and fragment shaders.
  - `src/ui/screens/OuroborosGalleryScreen.ts`: Gallery screen integration hosting the WebGL canvas.
  - `src/tests/OuroborosGalleryRingRenderer.test.ts`: TDD unit & integration test suite.

- **Visual & Mechanical Requirements:**
  1. **Circular Serpentine Body ($R \approx 130$ px, center at $(180, 180)$):**
     - Continuous ribbon geometry with procedural vertex attributes (`aPosition`, `aNormal`, `aSide`, `aProgress`, `aSegment`).
     - Tail seamlessly loops into the body on the outer perimeter.
     - Glowing scales, segmented bioluminescent ridges, and metallic anisotropic specular highlights.
  2. **Inward-Spiraling Neck & Framing Head:**
     - The serpent's neck transitions off the outer ring and gracefully curves inward toward $(180, 180)$.
     - Serpent head features glowing celestial eyes, horned cranial crests, and opened jaws framing the 9th central pedestal.
  3. **Cosmic Shading & Animations:**
     - GLSL shaders featuring anisotropic metallic specular glow (gold-brown `#d4af37` / `#b8860b` / cyan / emerald cosmic tinting).
     - Scale ripple waves traveling down the spine: $\sin(\text{scaleFreq} \cdot u - \text{time} \cdot v)$.
     - Breathing pulse modulating body width and aura intensity.
     - Orbiting stellar embers/particles spiraling toward the central singularity.
     - Awakened state trigger (`isAwakened = true`) unleashing golden solar flares when all 8 unique helmets are collected.
  4. **Strict Pure WebGL Compliance (AGENTS.md Rule 12):**
     - 100% WebGL 2.0 / WebGL 1.0 shader pipelines. Zero HTML5 Canvas 2D contexts or shims.
  5. **Headless & Mock Resilience:**
     - Safe execution in Node.js / Vitest headless environments without throwing errors when GL is mocked or null.

---

## 2. Test Plan & Assertions (Red Phase)

- **Test Suite Location:** `src/tests/OuroborosGalleryRingRenderer.test.ts`
- **Assertions:**
  1. **Geometry Construction:**
     - Ring spine points form a continuous circular loop around center $(180, 180)$ at radius $130 \pm 5$ px.
     - Inward neck and head vertices curve inward from the outer ring to the central socket ($< 50$ px from center).
     - Generated triangle mesh has valid vertices, indices, and normal coordinates.
  2. **Zero-Allocation Animation Tick Progression:**
     - Calling `render(timeSec, unlockedCount, isAwakened)` across hundreds of frames produces zero garbage collection allocations.
     - Updates dynamic uniforms (time, resolution, unlocked count, awakened state) in pre-allocated buffers.
  3. **Headless & Mock WebGL Safe Execution:**
     - Gracefully initializes, resizes, renders, and destroys with mocked WebGL context.
     - Safely no-op when canvas or WebGL context is null.
  4. **Awakened & Unlocked State Progression:**
     - Correctly reflects unlocked helmet count (0 to 8) and awakened mode in uniform states and shader parameters.

---

## 3. Implementation Details (Green Phase)

- **Files Created/Modified:**
  - `src/render/webgl/OuroborosGalleryRingRenderer.ts`: Pure WebGL 2.0 serpentine Ouroboros ring renderer.
  - `src/tests/OuroborosGalleryRingRenderer.test.ts`: Conformance test suite.
  - `src/ui/screens/OuroborosGalleryScreen.ts`: Mount and animate `OuroborosGalleryRingRenderer`.

---

## 4. Verification & Quality Check

```bash
npx vitest run src/tests/OuroborosGalleryRingRenderer.test.ts
npm run typecheck
./verify
```
