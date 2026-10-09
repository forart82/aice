# Feature TDD Specification: Galaxy Jump Confirmation Modal, Warp Orchestration & Gold-Brown Holographic Sci-Fi Outcome Screen

> **Feature Identifier:** `docs/tdd/galaxy_jump_warp_outcome.tdd.md`  
> **Status:** Active / In-Progress (Overhaul)  
> **Target Directory:** `/home/forart/dev/snake_ts`  
> **Rule Reference:** [`AGENTS.md#rule-2`](file:///home/forart/dev/snake_ts/AGENTS.md), [`AGENTS.md#rule-3`](file:///home/forart/dev/snake_ts/AGENTS.md), [`AGENTS.md#rule-10`](file:///home/forart/dev/snake_ts/AGENTS.md), [`AGENTS.md#rule-12`](file:///home/forart/dev/snake_ts/AGENTS.md) & [`ORACLE.md`](file:///home/forart/dev/snake_ts/ORACLE.md)  

---

## 1. Feature Overview & Requirements

- **High Concept:**
  - Completely overhaul the presentation of all Galaxy Jump messages and dialogs in `OuroborosGalleryScreen` into a gorgeous, captivating holographic sci-fi presentation.
  - Whole-Game Warp Transition: The animation is not framed in a modal window. Instead, the entire game screen jumps into hyperspace!
  - Clicking Galaxy Jump with 0 standard helmets displays an informative toast/message and prevents proceeding.
  - Clicking with >= 1 standard helmets opens the **Holographic Galaxy Jump Confirmation Modal** (`.galaxy-jump-confirm-modal`):
    - Celestial glass panel with glowing gold-brown neon borders (`border: 1px solid rgba(212, 175, 55, 0.4); box-shadow: 0 0 30px rgba(212, 175, 55, 0.25); background: linear-gradient(135deg, rgba(20, 14, 6, 0.95), rgba(35, 24, 10, 0.92)); backdrop-filter: blur(16px)`).
    - Top header: "🌌 INITIATE GALAXY JUMP RITUAL" with glowing celestial icon and subtitle "Sacrifice standard boss helmets to bend spacetime into a new galaxy".
    - Energy Reactor Gauge (`.energy-reactor-gauge`): Animated progress bar showing Sacrifice Energy ($S$) filling up toward the 800-point saturation mark with glowing numeric readout (`.sacrifice-score`).
    - Holographic Probability Wheel (`.holographic-probability-wheel`): Circular percentage meter displaying the manifestation chance ($P = (1 - e^{-S/800}) \times 100\%$) with high-impact color coding (>75% gold, 40-75% amber, <40% cyan) and `.transcendence-chance` readout.
    - Sacrificed Helmets Grid/Tray (`.sacrificed-helmets-tray`): Visual chips (`.sacrificed-helmet-chip`) showing the helmets being channeled into the warp singularity with rarity borders and icons.
    - High-stakes warning pill (`.sacrifice-warning`): "⚠️ All standard boss helmets will be permanently consumed in this cosmic jump."
    - Grand Action Buttons: `<button class="cyber-btn btn-primary btn-confirm-jump" style="background: linear-gradient(135deg, #d4af37, #b8860b); color: #000; font-weight: 800; text-transform: uppercase; letter-spacing: 1px;">🌌 Engage Warp Jump</button>` and `<button class="cyber-btn btn-ghost btn-cancel-jump">Abort</button>`.
  - When the player confirms the Galaxy Jump:
    - Confirmation modal closes immediately.
    - Gallery modal container fades out / minimizes (`opacity: 0; pointer-events: none; transition: opacity 0.3s ease;`) so the player sees the entire game screen warp into hyperspace!
    - Full-screen cosmic warp overlay is mounted and launched directly on `document.body` via `GalaxyJumpWarpOverlay.play(document.body, ...)`.
    - Synchronized hyperspace warp audio (`Services.Sound.playWarpJump()`) triggers.
    - `meta.galaxyJump()` executes.
  - When the warp reaches completion:
    - Gallery modal container visibility is restored (`opacity: 1; pointer-events: auto;`).
    - Ouroboros ring is refreshed with updated state.
    - Outcome Modal (`.galaxy-jump-result-modal`) appears seamlessly:
      - **SUCCESS**: Gold-Brown celebration card with unique helmet details and claim button.
      - **FAILURE**: Collapsed cosmic rift void notice.
      - Full ceremonial artifact revelation with radiant golden-brown aura and background god-rays radiating outward (`background: radial-gradient(circle, rgba(212, 175, 55, 0.25) 0%, rgba(15, 10, 4, 0.98) 70%)`).
      - Floating 3D-angled metallic artifact pedestal (`.unique-helmet-card`) with gold-brown runic border (`#d4af37`, `#b8860b`, `#8c6239`).
      - Huge 80px glowing icon (`.unique-helmet-icon`) with celestial particle sparks.
      - Rarity Badge (`.unique-helmet-rarity`): `✦ UNIQUE MYTHIC ARTIFACT AWAKENED ✦` with pulsing glow.
      - Helmet Title (`.unique-helmet-name`) in gleaming metallic gold (`color: #ffd166; text-shadow: 0 0 15px rgba(255, 209, 102, 0.8)`).
      - Special Capacity Showcase (`.capacity-showcase-chip` / `.unique-helmet-capacity`): A prominent futuristic neon-bordered chip displaying the capacity name (e.g. `✨ HARVEST FEAST` or `🔥 TITAN GORGING`) with bold explanatory text.
      - Lore quotation (`.unique-helmet-lore`) in ethereal silver/gold italic.
      - Stat Boost Grid (`.unique-helmet-stats`): Sleek compact chips displaying maxHp, armor, speed, bitePower, thorns, etc.
      - Grand Claim Button: `<button class="cyber-btn btn-primary btn-claim-helmet" style="font-size: 14px; padding: 12px 28px; background: linear-gradient(135deg, #ffd166, #d4af37); color: #1e1204; font-weight: 800;">⚡ CLAIM & EMBED INTO OUROBOROS RING ⚡</button>`.
      - Clicking Claim dismisses modal and refreshes ring view showing the new glowing gold-brown pedestal.
    - **FAILURE (Cosmic Void Collapse Modal)**:
      - Deep cosmic void aesthetic (`.void-collapse-card`) with abyssal smoke and dark purple/violet cracked rune border (`border: 1px solid rgba(168, 85, 247, 0.5); box-shadow: 0 0 35px rgba(147, 51, 234, 0.3)`).
      - Title: "🌌 THE COSMIC RIFT COLLAPSED".
      - Message: "The void absorbed your sacrifice... but your resonance with the cosmos deepens."
      - Stardust progress / advice meter (`.void-resonance-guide`) guiding player on how to collect more boss helmets to reach high probability.
      - Button: `<button class="cyber-btn btn-secondary btn-dismiss-result">Return to Shrine</button>`.
  - Unlocked unique helmets on the Ouroboros Ring pedestals use the **gold-brown theme**: border `2px solid #d4af37`, shadow `0 0 16px rgba(212, 175, 55, 0.8)`, background `rgba(43, 29, 12, 0.8)`.

- **Target Systems:**
  - `src/ui/screens/OuroborosGalleryScreen.ts`
  - `index.html` (CSS styles and keyframes)
  - `src/tests/GalaxyJumpWarpAndResultFlow.test.ts`

---

## 2. Test Plan & Assertions (Red Phase)

- **Test Suite Location:** `src/tests/GalaxyJumpWarpAndResultFlow.test.ts`
- **Assertions:**
  1. Clicking Galaxy Jump button with 0 standard helmets displays inline alert/toast ("No standard helmets available to sacrifice! Defeat floor bosses in your runs to gather helmets.") and does NOT open confirmation modal.
  2. Clicking Galaxy Jump button with >= 1 standard helmets opens confirmation modal (`.galaxy-jump-confirm-modal`):
     - Displays accurate helmet count (`.sacrifice-count`), sacrifice score (`.sacrifice-score`), and transcendence chance (`.transcendence-chance`).
     - Contains Energy Reactor Gauge (`.energy-reactor-gauge`) and Holographic Probability Wheel (`.holographic-probability-wheel`).
     - Contains Sacrificed Helmets Tray (`.sacrificed-helmets-tray`) populated with chips (`.sacrificed-helmet-chip`) for each sacrificed helmet.
     - Contains permanent loss warning (`.sacrifice-warning`).
  3. Clicking "Abort" (`.btn-cancel-jump`) closes the confirmation modal without sacrificing helmets.
  4. Clicking "Engage Warp Jump" (`.btn-confirm-jump`) closes confirmation modal, triggers `Services.Sound.playWarpJump()`, launches warp animation overlay (`.galaxy-warp-overlay`), and calls `meta.galaxyJump()`.
  5. On Galaxy Jump SUCCESS:
     - Displays outcome modal (`.galaxy-jump-result-modal`) with gold-brown ceremonial card styling.
     - Plays `Services.Sound.playUniqueHelmetReveal()`.
     - Displays unlocked helmet icon, name, "✦ UNIQUE MYTHIC ARTIFACT AWAKENED ✦" badge, special capacity showcase chip (`.capacity-showcase-chip`), lore, and stat boost grid.
     - Contains `.btn-claim-helmet` button ("⚡ CLAIM & EMBED INTO OUROBOROS RING ⚡").
  6. On Galaxy Jump FAILURE:
     - Outcome modal displays collapsed rift text ("THE COSMIC RIFT COLLAPSED"), "The void absorbed your sacrifice... but your resonance with the cosmos deepens.", and cosmic resonance guide (`.void-resonance-guide`).
     - Plays subdued void sound (`playVoidCollapse`).
     - Contains `.btn-dismiss-result` button ("Return to Shrine").
  7. Clicking `.btn-claim-helmet` closes outcome modal and refreshes circumferential pedestals with glowing gold-brown styling.

---

## 3. Implementation Details (Green Phase)

- **Files Created/Modified:**
  - `src/core/Contracts.ts`: Added `playWarpJump?`, `playUniqueHelmetReveal?`, `playVoidCollapse?` to `ISound`, `NullSound`, and `MockSound`.
  - `src/audio/SoundEngine.ts`: Implemented procedural audio synthesizers for `PlayWarpJump()`, `PlayUniqueHelmetReveal()`, and `PlayVoidCollapse()`.
  - `src/render/webgl/GalaxyJumpWarpOverlay.ts`:
    - Fullscreen 100vw x 100vh whole-game immersion without letterbox film bars.
    - Added `galaxy-warp-overlay` alias class for backward and forward compatibility.
    - Updated `play(container, onComplete, result, duration)` with optional duration support.
    - Streamlined telemetry HUD and updated status messages.
  - `src/ui/screens/OuroborosGalleryScreen.ts`:
    - On jump confirmation: closes confirm modal immediately, fades out / minimizes gallery modal (`opacity: 0; pointer-events: none; transition: opacity 0.3s ease;`).
    - Mounts and launches `GalaxyJumpWarpOverlay.play(document.body, ...)` directly on `document.body` for whole-game transition.
    - Synchronized with `Services.Sound.playWarpJump()`.
    - On warp completion: restores gallery screen visibility (`opacity: 1; pointer-events: auto;`), refreshes ring state, and presents grand holographic outcome modal.
  - `src/tests/GalaxyJumpWarpAndResultFlow.test.ts`: Updated test 4 to verify fullscreen whole-game warp overlay mounted on `document.body` and modal opacity transitions.
  - `src/tests/OuroborosGalleryScreen.test.ts`: Added dedicated test verifying whole-game transition lifecycle.

---

## 4. Verification & Quality Check

```bash
npx vitest run src/tests/GalaxyJumpWarpAndResultFlow.test.ts
# Result: 11/11 PASS (100%)

npx vitest run src/tests/OuroborosGalleryScreen.test.ts
# Result: 30/30 PASS (100%)

npx vitest run src/tests/GalaxyJumpWarpAnimation.test.ts
# Result: 27/27 PASS (100%)

./verify
# Result: 100% PASS (150/150 test suites, 1924/1924 tests passed, Zero Typecheck Errors, Production Build OK)
```
