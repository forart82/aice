# Feature TDD Specification: Galaxy Jump Warp Animation, Confirmation Modal & Outcome Revelation Screen

> **Feature Identifier:** `docs/tdd/galaxy_jump_warp_animation_and_feedback.tdd.md`  
> **Status:** Draft (Red Phase Ready)  
> **Target Directory:** `/home/forart/dev/snake_ts`  
> **Rule Reference:** [`AGENTS.md#rule-2`](file:///home/forart/dev/snake_ts/AGENTS.md), [`AGENTS.md#rule-10`](file:///home/forart/dev/snake_ts/AGENTS.md), [`AGENTS.md#rule-12`](file:///home/forart/dev/snake_ts/AGENTS.md) & [`ORACLE.md#section-10.4`](file:///home/forart/dev/snake_ts/ORACLE.md)  

---

## 1. Feature Overview & Requirements

### 1.1 Problem Statement & User Feedback
Players executing the **Galaxy Jump** prestige mechanic require clear, visceral, and unambiguous feedback:
1. **Accidental Gear Sacrifices**: Surrendering standard boss helmets previously occurred with a single instant click, risking unintended destruction of high-tier standard equipment.
2. **Missing Stakes & Probability Transparency**: Players could not inspect their current sacrifice score $S$, the number of surrendered helmets, or the exact mathematical probability $P = 1 - \exp(-S/800)$ before committing.
3. **Lack of Cinematic Transition**: The jump between galaxies lacked visual weight and immersion. A video-like procedural WebGL hyperspace warp animation is required to dramatize the intergalactic transit.
4. **Ambiguous Outcome Revelation**: Players need explicit, celebrated feedback revealing whether their prestige jump successfully forged an unowned **Unique Helmet** or collapsed into cosmic stardust.
5. **Aesthetic & Mechanical Identity of Unique Helmets**:
   - Unique Helmets and the 9th Omni-Helmet must share a distinctive **Gold-Brown Cosmic Theme** (`#d4af37`, `#b8860b`, `#8c6239`).
   - Signature game-changing capacities must include:
     * **"Harvest Feast"** (Carapace of the Nanite Hivequeen / Golden Harvest): Defeated enemies burst into 2–3 bonus apples!
     * **"Titan Gorging"** (Maw of the Behemoth / Abyssal Titan): Eating food temporarily doubles Head size and bite reach ($\text{HeadRadius} \times 2.0$) for 3.0 seconds!
     * Plus the 6 existing abilities (Titanic Armor Shockwave, Gorgon Petrifying Stun, Leviathan Tidal Dash, Chronos Time Slowdown, Void Gravity Vortex, Solar Flare Supernova).
     * The supreme **9th Celestial Crown** possesses ALL 8 capacities combined!

### 1.2 The 3-Phase Galaxy Jump User Experience Pipeline

```
┌─────────────────────────────────────────────────────────────┐
│ PHASE 1: CONFIRMATION MODAL                                 │
│ - Sacrificed Helmet Count & Total Sacrifice Score (S)        │
│ - Real-Time Manifestation Probability: P = 1 - exp(-S/800)   │
│ - High-Contrast Permaloss Warning (Standard Helmets Destroyed)│
│ - Abort / Commence Action Buttons                           │
└──────────────────────────────┬──────────────────────────────┘
                               │ (Commence)
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ PHASE 2: CINEMATIC HYPERSPACE WARP ANIMATION (~2.5s)        │
│ - Pure WebGL 2.0 Procedural Warp & Star Streaks Pipeline    │
│   * 0.0s–0.6s: Singularity Charge (Radial star compression) │
│   * 0.6s–1.9s: Hyperspace Light-Speed Tunnel (Relativistic) │
│   * 1.9s–2.5s: Deceleration & White-Gold Shockwave Flash   │
│ - Web Audio Procedural Synth Soundscape (Sub-bass & Gong)   │
└──────────────────────────────┬──────────────────────────────┘
                               │ (Arrival)
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ PHASE 3: OUTCOME REVELATION SCREEN                          │
│ [SUCCESS]                                                   │
│ - Gold-Brown Cosmic Showcase Card (#d4af37, #b8860b, #8c6239)│
│ - Revealed Unique Helmet: Icon, Stats, Special Capacity     │
│ - Auto-Socketing Animation into Ouroboros Gallery Ring      │
│ [FAILURE]                                                   │
│ - Cosmic Void Collapse Notice + Consolation Stardust Bonus  │
│ - Tactical Guidance: Slay higher-tier bosses to boost S     │
└─────────────────────────────────────────────────────────────┘
```

### 1.3 Target Systems & Modules
- `src/ui/screens/OuroborosGalleryScreen.ts`: Modal overlays, confirmation controls, outcome cards, and auto-socketing choreography.
- `src/render/GalaxyWarpEffect.ts` / `src/render/webgl/`: Pure WebGL 2.0 relativistic star streak extrusion, radial focal point contraction, and chromatic aberration shockwave shader pipeline. Strictly **Zero Canvas 2D** ([`AGENTS.md#rule-12`](file:///home/forart/dev/snake_ts/AGENTS.md)).
- `src/audio/Synth.ts` & `src/audio/SoundEngine.ts`: Procedural DSP hyperspace slipstream pitch sweep ($40 \to 180\text{ Hz}$) and resonant celestial gong crash.
- `src/data/UniqueHelmetsData.ts`:
  - Gold-Brown theme palette constants (`GOLD_BROWN_THEME`).
  - Signature capacity data for **Harvest Feast** (`harvest_feast`) and **Titan Gorging** (`titan_gorging`).
  - Consolidated 9th Omni-Helmet synthesis factory updating all 8 combined capacities.
- `src/sim/combat/CombatSystem.ts` & `src/sim/entities/PlayerSnake.ts`:
  - Harvest Feast hook: on hostile entity death, spawn 2–3 additional food pickups.
  - Titan Gorging hook: on food ingestion, trigger 3.0s timer scaling `HeadRadius` and bite reach by $2.0\times$.
- `src/tests/GalaxyJumpWarpAndFeedback.test.ts`: Dedicated TDD test suite validating the entire flow headlessly.

---

## 2. Test Plan & Assertions (Red Phase)

- **Test Suite Location:** `src/tests/GalaxyJumpWarpAndFeedback.test.ts`
- **Assertions Matrix:**

### Suite A: Confirmation Modal & Stakes Transparency
1. **Modal Metrics Rendering**:
   - `renderConfirmationModal(helmets)` accurately computes and displays:
     - Sacrificed count $N = \text{helmets.length}$.
     - Total Sacrifice Score $S = \sum \text{Value}(h) \times M_{\text{rarity}}(h)$.
     - Drop Probability $P = 1 - \exp(-S/800)$ formatted as a percentage string (e.g., $S=800 \to 63.2\%$).
2. **Safe Abort Invariant**:
   - Triggering the `Abort` button dismisses the confirmation modal.
   - Asserts `meta.Helmets` count, `meta.UniqueHelmets` list, and `meta.EquippedHelmetId` undergo zero modifications.
3. **Commit & Surrender Execution**:
   - Triggering `Commence` destroys all standard helmets in `meta.Helmets`.
   - Asserts previously slotted Unique Helmets in `meta.UniqueHelmets` are 100% preserved (Protected Invariant).

### Suite B: Cinematic Hyperspace Warp Animation (Rule 12 Pure WebGL)
4. **Animation Duration & State Machine**:
   - Hyperspace warp animation progresses over a fixed duration $\tau_{\text{warp}} = 2.50\text{ s}$ ($\pm 0.05\text{ s}$).
   - Verifies discrete state transitions:
     * $0.0\text{ s} \le t < 0.6\text{ s}$: Singularity Gravitational Charge.
     * $0.6\text{ s} \le t < 1.9\text{ s}$: Hyperspace Light-Speed Tunnel.
     * $1.9\text{ s} \le t \le 2.5\text{ s}$: Deceleration & Shockwave Flash.
5. **Strict Rule 12 WebGL 2.0 Compliance**:
   - Warp effect instantiates exclusively via WebGL 2.0 shader program or `GLBatch` buffer instances.
   - Asserts zero calls to `HTMLCanvasElement.getContext('2d')` or `CanvasRenderingContext2D`.
6. **Procedural Web Audio Triggering**:
   - Warp sequence initiates procedural audio synthesis:
     - Sub-bass sweep rising from $40\text{ Hz}$ to $180\text{ Hz}$.
     - High-velocity bandpass white noise slipstream.
     - Resonant cosmic gong/cymbal at shockwave detonation ($t = 1.9\text{ s}$).

### Suite C: Outcome Revelation Screen & Auto-Socketing
7. **Success Outcome Presentation**:
   - When drop roll $r < P(S)$, reveals Gold-Brown Cosmic Showcase Card.
   - Card verifies theme colors (`#d4af37`, `#b8860b`, `#8c6239`).
   - Displays newly unlocked Unique Helmet ID, Name, Lore, Stats, and Signature Capacity text.
8. **Auto-Socketing Choreography**:
   - Newly awarded Unique Helmet is appended to `meta.UniqueHelmets`.
   - Fires visual interpolation event targeting its circumferential slot in the Ouroboros Gallery ring.
   - Updates slot dataset state to `unlocked` with glowing amber border.
9. **Failure Outcome Presentation**:
   - When drop roll $r \ge P(S)$, reveals Cosmic Void Collapse notice.
   - Correctly awards and credits Consolation Stardust Bonus:
     - $\text{Ouro} = \lfloor S \times 2.5 \rfloor$
     - $\text{Shards} = \lfloor S / 20 \rfloor$
   - Displays tactical guidance text pointing to the 800-point saturation threshold.

### Suite D: Special Capacities Simulation & Verification
10. **Gold-Brown Theme Data Export**:
    - `UNIQUE_HELMET_THEME` exports primary `#d4af37`, secondary `#b8860b`, and dark `#8c6239`.
11. **"Harvest Feast" Simulation**:
    - Defeating an enemy while `unique_nanite_hivequeen` is equipped spawns 2–3 additional apple/food pickups in the active arena.
12. **"Titan Gorging" Simulation**:
    - Eating food while `unique_behemoth_maw` is equipped activates the Titan Gorging buff for $3.0\text{ s}$.
    - Asserts `PlayerSnake.effectiveHeadRadius` equals $2.0 \times \text{baseHeadRadius}$ during the active window.
    - Expiration of 3.0s reverts head radius to $1.0\times$.
13. **9th Omni-Helmet All-Capacities Synthesis**:
    - `forgeOmniHelmet()` synthesizes an omni-artifact containing all 8 capacities, including Harvest Feast and Titan Gorging.
    - Simulating enemy kill and food consumption triggers both abilities simultaneously.

---

## 3. Implementation Details (Green Phase Plan)

### Step 1: Data Definitions & Color Constants (`src/data/UniqueHelmetsData.ts`)
- Export `GOLD_BROWN_THEME = { primary: '#d4af37', dark: '#b8860b', bronze: '#8c6239', amber: '#ffd166', core: '#fffdf0' }`.
- Update `UNIQUE_HELMETS` definitions:
  - Update `unique_helm_nanite_hivequeen`: add capacity `Harvest Feast: Defeated enemies burst into 2–3 extra apples! Regenerates 3.5 HP/s and reconstructs severed segments.`.
  - Update `unique_helm_abyssal_leviathan` / `unique_behemoth_maw`: add capacity `Titan Gorging: Eating food temporarily doubles Head size and bite reach (HeadRadius * 2.0) for 3.0 seconds! Leeches 8% health on bite.`.
- Update `forgeOmniHelmet()` to synthesize all 8 signature abilities into the 9th Omni-Helmet description.

### Step 2: Simulation Hooks for Special Capacities (`src/sim/`)
- In `PlayerSnake.ts`:
  - Add `titanGorgingTimer: number = 0`.
  - On food collection: if wearing Behemoth Maw or Omni-Helmet, set `titanGorgingTimer = 3.0`.
  - In `getHeadRadius()`: if `titanGorgingTimer > 0`, return `baseRadius * 2.0`.
  - In `update(dt)`: decrement `titanGorgingTimer` toward 0.
- In `CombatSystem.ts`:
  - On enemy defeat: if wearing Nanite Hivequeen or Omni-Helmet, spawn 2–3 extra food entities at enemy death position.

### Step 3: Pure WebGL Warp Effect (`src/render/GalaxyWarpEffect.ts`)
- Implement `GalaxyWarpEffect` utilizing pure WebGL 2.0 shaders:
  - Vertex shader generating star streak quads extruded by velocity vectors.
  - Fragment shader rendering relativistic chromatic shift and radial shockwave distortion.
  - Strict Rule 12 guarantee: no Canvas 2D fallback.

### Step 4: UI Screen & Feedback Modals (`src/ui/screens/OuroborosGalleryScreen.ts`)
- Implement Phase 1: Confirmation modal before committing `galaxyJump()`.
  - Displays count, score $S$, probability $P = 1 - \exp(-S/800)$, and permaloss warning.
  - Buttons: `Commence` vs `Abort`.
- Implement Phase 2: Hyperspace warp animation canvas trigger (~2.5s duration) with procedural synth audio.
- Implement Phase 3: Outcome Revelation Screen.
  - Success: Gold-Brown showcase card, icon, stats, capacity, auto-socketing into ring.
  - Failure: Cosmic void collapse card, consolation stardust award, tactical advice.

---

## 4. Verification & Quality Check

```bash
# Execute feature unit & integration test suite
npx vitest run src/tests/GalaxyJumpWarpAndFeedback.test.ts

# Execute full test suite (all 143 test files)
npm test

# Complete Quality Gate verification (strict typecheck + test suite)
./verify
```
