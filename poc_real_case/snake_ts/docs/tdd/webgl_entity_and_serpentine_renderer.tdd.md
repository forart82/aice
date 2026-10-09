# Feature TDD Specification: WebGL Entity & Serpentine Renderer (100% ISO Parity)

> **Feature Identifier:** `docs/tdd/webgl_entity_and_serpentine_renderer.tdd.md`  
> **Status:** 100% Green & Verified  
> **Target Directory:** `/home/forart/dev/snake_ts`  
> **Rule Reference:** [`AGENTS.md#rule-2`](file:///home/forart/dev/snake_ts/AGENTS.md), [`AGENTS.md#rule-6`](file:///home/forart/dev/snake_ts/AGENTS.md), [`AGENTS.md#rule-10`](file:///home/forart/dev/snake_ts/AGENTS.md) & [`ORACLE.md`](file:///home/forart/dev/snake_ts/ORACLE.md)  

---

## 1. Feature Overview & Non-Regression ISO Parity Requirements

- **High Concept:** Complete, 100% non-regression, hardware-accelerated WebGL 2D entity and serpentine rendering pipeline matching the visual fidelity and mathematical formulation of Native Canvas2D (`Ctx2D`) across all entities, backdrops, menus, particles, and combat telegraphs.
- **Target Systems:** `src/render/webgl/WebGLGameRenderer.ts`, `src/render/webgl/GLBatch.ts`, `src/render/webgl/WebGLContext.ts`, `src/render/GameRenderer.ts`, `src/main.ts`
- **Mechanics & Aesthetics Reference:** [`ORACLE.md#visual-presentation`](file:///home/forart/dev/snake_ts/ORACLE.md)

### 100% ISO Parity Matrix:

1. **Snake Player (7.5-Pass Multi-Layer Cybernetic Serpentine Pipeline):**
   - **Pass 1:** Dark shell outline (`rgba(2, 5, 12, 0.85)`, width $2r_{\text{head}} + 4$).
   - **Pass 2:** Lit flesh core (width $1.85r_{\text{head}}$, glow 10).
   - **Pass 2B:** Oriented vertebrae carapaces (`drawRotatedQuad` along segment angle with size $(2.3r_{\text{seg}}, 2.0r_{\text{seg}})$ and accent outline).
   - **Pass 3:** Tail taper (6 LOD buckets with quadratic width $(1 - 0.9e)$ and shade decay `ColorX.shade(col, -0.06 - 0.5e)`).
   - **Pass 4:** Ventral shadow offset $(+0.16 r_{\text{head}}, +0.36 r_{\text{head}})$, width $0.85 r_{\text{head}}$, `rgba(2, 5, 12, 0.3)`.
   - **Pass 5:** Wet top ridge highlight offset $(-0.2 r_{\text{head}}, -0.34 r_{\text{head}})$, width $0.6 r_{\text{head}}$, `rgba(255, 255, 255, 0.18)`.
   - **Pass 6:** Scale cross-ticks along $\theta + \pi/2$ of length $2r_{\text{head}}(1 - 0.85t^2) \times 0.85$, `rgba(2, 5, 12, 0.35)`.
   - **Pass 7:** Bioluminescent accent nodes of radius $0.32r_{\text{head}}(1 - 0.35t)$.
   - **Pass 7.5:** Segment damage warning overlays: hit flash white discs ($>0.05$), critical warning rings (<35% HP `#ef4444`), moderate warning rings (35%-99% HP `#f59e0b`), 3-point jagged crack lines (<50% HP).
   - **Head Anatomy:** Elongated rotated skull with 3D sphere gradient, brow ridge & jaw shadow, cranial health radial arc (`#ffd166` / `#f59e0b` / `#ef4444`), mouth cavity (`#4a0d1a`) & tongue (`#ff3366`) opening animation with `mouthOpen`, blinking eyelids (closed eyelid lines when blinking; sclera + forward pupils when open).
   - **5 Class Crests:** Hydra tri-skull with secondary heads at local $(-6, \pm 15)$, Emerald diamond crown & nasal spine, Stalker swept fins, Storm electro-prongs, Solar radiant corona spikes.
   - **Relic Orbitals & Auras:** 3-point oriented fangs along $o.\text{a} + \pi/2$, shield bubble with dynamic opacity and pulse, Frostbite relic aura ring.
   - **6 Boss Helmet Models:** Centipede crown with mandibles, antennae with gold tip bulbs, brow plate, visor; Colossus angular steel plate, ear plates, ventilation louvers, chevron visor; Leviathan curved horns with azure ribs, dorsal crest fin; Chrono clockwork tiara dial arc, chevron, tachyon gem; Gorgon flared cobra hood, venom fangs; Void swept astral horn blades, hexagonal crown shroud, black hole singularity core with event horizon.

2. **Apex Bosses (8 Unique Procedural Boss Geometries):**
   - Boss attack telegraphs (`boss.telegraphs`: circles, cones, lines, rings).
   - Ambient bloom halo under boss head ($3.4r$).
   - Entrance alpha fade ($\text{clamp}(1 - t_{\text{entrance}}/1.4, 0.1, 1.0)$).
   - Per-archetype articulated body segments (Colossus stone squares with molten heart; Frostwyrm diamond ice crystals; Chronowyrm double concentric time dial rings; Gorgon galvanic capacitor discs; Leviathan/Centipede/Void organic chitin discs with dark dorsal ridges).
   - Continuous spine ribbon connecting boss head to all segment nodes with normal muscular foundation and additive glowing conduit.
   - Custom boss heads:
     - Colossus: rotating hexagonal furnace, inner dark cavity, pulsating molten heart.
     - Gorgon / Superconductor: 5-point pentagon chassis, central volt core, 3 orbiting neon spark nodes.
     - Frostwyrm: 8-point crystalline ice star, 4 crisscrossing ice crystal facet lines.
     - Leviathan: 3 concentric rotating vortex rings, 4 celestial orbital arcs.
     - Centipede / Ouroboros / Void: rotated elliptical skull, dual curved pincers/mandibles, glowing golden twin eyes.
   - Phase 2 overdrive aura ring with sinusoidal pulse.

3. **Enemies (6 Unique Procedural Hostile Archetypes):**
   - Spitter: oriented teardrop pod along angle + $\pi/2$, cannon nozzle aperture, glowing acid sac.
   - Drone: rotated cyber-scout fuselage, dark sensor cockpit, cyan sensor eye, vibrating charge ring ($1.6r + 3\sin(24t_{\text{shoot}})$).
   - Phantom: trailing ghost echo at $\alpha=0.3$, translucent wraith crescent head at $\alpha=0.82$, ethereal white eye glint.
   - Brute / Dasher: heavy ram hull, 3 spine armor ridges, dark vent, kinetic charge surge outline.
   - Swarmling: elliptical spore mite body, forward bioluminescent pod.
   - Scarab: 3D specular sphere carapace, dark dorsal chitin seam split, glowing chitin rim arc.
   - Spawning warp rings, cryo & burn status rings, dynamic HP bars with thresholds.

4. **Foods, Helmets, Telegraphs & Projectiles:**
   - Foods: Pre-rendered offscreen sprite stamp texture blitting with procedural 3D sphere fallback, spore halo, inner core, specular glints, normal blend mode for dark details (bomb core `#111827`, fuse line `#ffb703`), potion medical cross, chrono clock hands, golden dynamic corona pulse ($r+3+\sin(1.6t)\times 1.5$), shard faceted diamond, shield concentric ring, soul ghost aura, prism diamond.
   - Helmet drops: vertical tapered light pillar with $\sin(2.5t)$ alpha pulse, ground shadow ellipse in normal blend mode, $1.2\pi$ rotating energy ring with orbiting node circle at angle `pulse`, 5-point dark visor plate (`#0f172a`), visor aperture, specular glint, floating rarity tier badge, breathing scale pulse $(1 + \sin(3t)\times 0.06)$.
   - Universal telegraphs: circle warning + expanding fill, cone sector outline + expanding wedge fill, directional laser line with alpha, charge ring oscillation ($\sin(24t)\times 3$).
   - Projectiles: lifespan alpha fade ($\text{life}/\text{maxLife}$), trail alpha scaling, plasma glow, core, specular glint.

5. **Backdrop, Starfield & FX:**
   - Backdrop: Pre-rendered cosmic nebula canvas texture blit with procedural fallback (5-floor color palettes, rotated nebula dust gradient plane (-32° angle) and galactic core bulge, 120 static deep field micro-stars, 88x88 celestial checkerboard luminescence, 1px coordinate grid lines at $\alpha=0.048$ with 6px navigation micro-crosshairs at intersections, radial edge vignette).
   - 3-tier dynamic starfield: 180 pure white square micro-stars (layer 0); 70 spectral mid-stars with dual harmonic twinkle (layer 1); 16 diamond beacons / pulsars with power-4 bloom pulse, 4-pointed elongated diffraction crosshair arms ($3.4r \times \text{bloom}$), and white center core.
   - 3-pass multi-tier neon bloom on perimeter walls with frenzy alarm strobe.
   - **Menu / Idle State Ouroboros Animation**: Complete 180-segment 8-crossing isotropic Ouroboros engine ($R \in [280, 380]$, planetary rotation $0.00015\text{ rad}$, 12-cycle harmonic undulation, 3D depth sorting, drop shadows, muscular foundation ribbon, spinal conduit, and volumetric scale plates).
   - Particle FX: normal and additive particle shapes, multi-segment electric jitter beams using `b.offsets`, screen flash and vignette overlays, floating combat text floaters.

---

## 2. Test Plan & Assertions (Red Phase)

- **Test Suite Location:** `src/tests/WebGLGameRenderer.test.ts`, `src/tests/WebGLRenderer.test.ts`, `src/tests/WebGLRenderingPipelineAndFallback.test.ts`
- **Assertions:**
  1. `GLBatch` supports multi-pass serpentine ribbons, rotated quads, texture blitting, and blend mode switching.
  2. `WebGLGameRenderer.drawBackdrop` renders baked nebula texture blit, static micro-stars, checkerboard, 1px grid with crosshairs, 3-tier starfield with 4-point pulsar flares, and multi-tier perimeter bloom.
  3. `WebGLGameRenderer.drawIdleBackdrop` renders full 180-segment 8-crossing volumetric Ouroboros knot with depth sorting.
  4. `WebGLGameRenderer.drawFood` renders pre-rendered food stamp texture blits and procedural fallback with 3D sphere shading, dynamic golden corona, and normal blend mode for bomb core/fuse.
  5. `WebGLGameRenderer.drawHelmetDrop` renders tapered light pillar, ground shadow, rotating node, 5-point visor plate, and floating rarity badge.
  6. `WebGLGameRenderer.drawTelegraph` renders circle, cone, line, and warp ring telegraphs.
  7. `WebGLGameRenderer.drawProjectile` applies lifecycle alpha fade and scaled trails.
  8. `WebGLGameRenderer.drawEnemy` renders all 6 enemy archetypes with procedural anatomy, charge vibration, ghost echoes, armor ridges, and status rings.
  9. `WebGLGameRenderer.drawBoss` renders boss telegraphs, continuous spine ribbon, ambient bloom halo, entrance alpha fade, archetype segments, and custom heads for all 8 bosses.
  10. `WebGLGameRenderer.drawPlayer` renders 7.5-pass body ribbon, damage overlays, elongated skull, facial animations (mouth open, blinking eyelid slits), 5 class crests, orbitals, and all 6 boss helmets.
  11. `WebGLGameRenderer.drawFx` renders jitter beams, particles, overlays, and floating combat text floaters.
  12. Viewport culling correctly culls offscreen entities.
  13. `App` sets `WebGLGameRenderer.create(this.canvas)` as default primary renderer with zero-downtime headless fallback.

---

## 3. Implementation Details & Results (Green Phase)

- **Execution Results:**
  - Strict TypeScript Compilation: **0 Errors**
  - Vitest Conformance Suites: **120 / 120 Test Files Passed (1,550 Tests 100% Green)**
  - Production Bundle Build (`vite build`): **100% Passed**
  - WebGL Rendering Integration: **100% Verified**

