# Feature TDD Specification: Ouroboros Helmet Gallery Screen & WebGL Circular Ring

> **Feature Identifier:** `docs/tdd/ouroboros_gallery_screen.tdd.md`  
> **Status:** Green (Iterative Enhancement: Generated Helmet Images & Cybernetic Presentation)  
> **Target Directory:** `/home/forart/dev/snake_ts`  
> **Rule Reference:** [`AGENTS.md#rule-1`](file:///home/forart/dev/snake_ts/AGENTS.md), [`AGENTS.md#rule-2`](file:///home/forart/dev/snake_ts/AGENTS.md), [`AGENTS.md#rule-3`](file:///home/forart/dev/snake_ts/AGENTS.md), [`AGENTS.md#rule-10`](file:///home/forart/dev/snake_ts/AGENTS.md), [`AGENTS.md#rule-12`](file:///home/forart/dev/snake_ts/AGENTS.md) & [`ORACLE.md`](file:///home/forart/dev/snake_ts/ORACLE.md)  
> **Updated:** 2026-09-05  

---

## 1. Feature Overview & Requirements

- **High Concept**:
  The **Ouroboros Gallery Screen** (`modal-ouroboros-gallery`) renders the legendary circular Ouroboros shrine showcasing the 8 Unique Boss Helmets positioned along its circumference, with the serpent's head arching inward to crown the 9th central pedestal.
  Once all 8 unique helmets are collected via Galaxy Jump sacrifice, the player awakens the central forge to craft **The Celestial Crown of the Eternal Ouroboros** and launch into the intense 8-Second Wave All-Boss Rush Arena.

- **Wonderful Ouroboros Ring Presentation & Visual Polish Requirements**:
  1. **OuroborosGalleryRingRenderer WebGL 2.0 Integration**:
     - Dedicated hardware-accelerated renderer (`src/render/webgl/OuroborosGalleryRingRenderer.ts`).
     - Obtains `WebGL2RenderingContext` from `.gallery-ring-canvas` (`canvas.getContext('webgl2')`) with standard fallback.
     - WebGL canvas properly initialized and sized (responsive coordinate mapping).
     - Renders dynamic serpentine ring coils with undulating scales and glowing spinal laser pulse.
     - Renders inward-curving serpentine head arching from the ring into the central 9th pedestal with cranial ridge, glowing eyes, and celestial aura.
     - Central 9th pedestal framed by the serpent head's celestial aura.
     - Passes elapsed time, `meta.UniqueHelmets.length`, and `meta.canForge9thHelmet()` to `render()`.
  2. **Animation Loop Lifecycle**:
     - Drives render loop via `requestAnimationFrame` while the modal is displayed.
     - When the modal is hidden or dismissed, cleanly pauses the animation loop (`cancelAnimationFrame`) to conserve battery/GPU.
  3. **High-Resolution Generated Helmet Image Integration & Cybernetic Polish**:
     - Unlocked 8 circumferential pedestal slots (`.pedestal-slot`) render `<img class="slot-helmet-img" src="${arch.Image || arch.image}" alt="${arch.Name}" style="width: 100%; height: 100%; object-fit: cover; border-radius: 50%; pointer-events: none;" />`.
     - Maintains glowing cybernetic rarity border and status tooltip (`title` and `data-tooltip`).
     - Graceful fallback to `arch.Icon` if image is missing or encounters a load failure.
     - Galaxy Jump outcome modal `showOutcomeModal()` replaces static text emoji `.unique-helmet-icon` with prominent high-resolution display `<img class="unique-helmet-manifest-img" src="${h.Image || h.image}" alt="${h.Name}" style="width: 110px; height: 110px; object-fit: cover; border-radius: 50%; border: 2px solid #00f0b5; box-shadow: 0 0 25px rgba(0, 240, 181, 0.7); margin: 12px auto; display: block;" />`.
     - Relic inspection modal `showRelicDetail()` displays the generated helmet image prominently at the top of the detail modal card (`img.relic-inspection-img.relic-detail-img`).
     - Ouroboros gallery background (`.gallery-ring-artwork`) uses `/ouroboros_gallery.jpg` with cybernetic neon aura and drop shadow.
     - Zero responsiveness regressions across mobile (360px portrait) up to desktop 4K ultrawide.

---

## 2. Test Plan & Assertions

- **Test Suite Locations**:
  - `src/tests/OuroborosGalleryScreen.test.ts`
  - `src/tests/GalaxyJumpWarpAndResultFlow.test.ts`
  - `src/tests/GalaxyJumpAndUniqueHelmets.test.ts`
- **Assertions**:
  1. Screen registers with ID `modal-ouroboros-gallery` and renders glassmorphic shell.
  2. WebGL canvas is properly initialized, sized, and bound to `OuroborosGalleryRingRenderer`.
  3. The 8 circumferential pedestals align along the serpentine ring coils at mathematical angles $0, \pi/4, \pi/2, 3\pi/4, \pi, 5\pi/4, 3\pi/2, 7\pi/4$ with radius $\approx 130\text{ px}$.
  4. Unlocked pedestals render `img.slot-helmet-img` with `src` matching `arch.Image`, retaining glowing gold-brown border and tooltips.
  5. Missing/erroring images gracefully fallback to `arch.Icon`.
  6. `showOutcomeModal()` renders `img.unique-helmet-manifest-img` with high-resolution cybernetic presentation (`#00f0b5` border, glow shadow).
  7. `showRelicDetail()` renders `img.relic-inspection-img.relic-detail-img` with high-resolution cybernetic presentation.
  8. Artwork backdrop `.gallery-ring-artwork` loads `/ouroboros_gallery.jpg`.
  9. Animation loop is managed cleanly across show/hide lifecycle.

---

## 3. Implementation Details

- **Files Created/Modified**:
  - `src/data/UniqueHelmetsData.ts`: Added `Image` and `image` property definitions and image paths for all 8 unique helmets and 9th omni-helmet.
  - `src/ui/screens/OuroborosGalleryScreen.ts`: Updated slot rendering in `refresh()`, `showOutcomeModal()`, `showRelicDetail()`, background artwork, and cybernetic styles.
  - `src/tests/MockDom.ts`: Corrected `src` attribute recursion.
  - `src/tests/OuroborosGalleryScreen.test.ts` & `src/tests/GalaxyJumpWarpAndResultFlow.test.ts`: TDD conformance suites.

---

## 4. Verification & Quality Check

```bash
npx vitest run src/tests/OuroborosGalleryScreen.test.ts
npx vitest run src/tests/GalaxyJumpWarpAndResultFlow.test.ts
npm run typecheck
./verify
```
