# Feature TDD Specification: The Grand Finale — 8 Unique Helmets, Galaxy Jump & Boss Rush Gauntlet

> **Feature Identifier:** `docs/tdd/endgame_8unique_helmets_galaxy_jump_boss_rush.tdd.md`  
> **Status:** Draft / Red  
> **Target Directory:** `/home/forart/dev/snake_ts`  
> **Rule Reference:** [`AGENTS.md#rule-1`](file:///home/forart/dev/snake_ts/AGENTS.md), [`AGENTS.md#rule-2`](file:///home/forart/dev/snake_ts/AGENTS.md), [`AGENTS.md#rule-3`](file:///home/forart/dev/snake_ts/AGENTS.md), [`AGENTS.md#rule-10`](file:///home/forart/dev/snake_ts/AGENTS.md), [`AGENTS.md#rule-12`](file:///home/forart/dev/snake_ts/AGENTS.md) & [`ORACLE.md#the-grand-finale-the-9th-celestial-helmet-galaxy-jump--the-boss-rush-gauntlet`](file:///home/forart/dev/snake_ts/ORACLE.md)  
> **Created:** 2026-09-04  

---

## 1. Feature Overview & Requirements

### 1.1 High Concept & The "End" Mechanic
- **The Infinite Loop Terminus**: While *Ouroboros Ascension* provides an infinite cyclical rogue-lite loop across escalating sectors, this feature introduces the ultimate canonical terminus—an Ascension ending that allows players to permanently break the wheel of rebirth.
- **The 8 Unique Relic Helmets**:
  1. `unique_colossus_crown`: **Crown of the Colossus** (Titanic Armor & Tremor Knockback)
  2. `unique_gorgon_gaze`: **Gaze of the Gorgon** (Petrifying Stun & Poison Trail)
  3. `unique_behemoth_maw`: **Maw of the Behemoth** (Multi-Segment Bite & Lifesteal)
  4. `unique_leviathan_wings`: **Wings of the Leviathan** (Supersonic Dash & Hydro-Shockwaves)
  5. `unique_chronos_eye`: **Eye of Chronos** (Temporal Slowdown & Rewind Phasing)
  6. `unique_void_horns`: **Void Singularity Horns** (Gravitational Magnet & Dark Energy Pulses)
  7. `unique_solar_crest`: **Crest of the Solar Chimera** (Solar Flare Burn & Radiance Shields)
  8. `unique_hydra_visage`: **Visage of the Apex Hydra** (Multi-Head Split & Rapid Bio-Regen)
- **The 9th Omni-Helmet**: **The Celestial Crown of the Eternal Ouroboros** (`unique_eternal_ouroboros_crown`):
  - Fuses **ALL 8 unique capacities simultaneously**.
  - Grants +100% all base attributes and celestial immortality aura.
- **Galaxy Jump (Ascension / Prestige Mechanism)**:
  - Sacrifices all standard/procedural boss helmets currently stored in `MetaProgression.Helmets`.
  - Calculates Sacrifice Score:
    $$S = \sum_{h \in \text{Sacrificed}} (50 \times \text{AffixCount}(h) + 10 \times \text{Floor}(h) + \text{PowerRating}(h)) \times M_{\text{rarity}}(h)$$
  - Unique Helmet Drop Probability follows an exponential saturation curve:
    $$P(\text{Unique}) = 1 - \exp\left(-\frac{S}{1000}\right)$$
  - Successful roll awards **1 unowned Unique Helmet** drawn uniformly at random from the unowned pool.
  - **Unique Protection**: Acquired Unique Helmets are permanently protected against sacrifice during Galaxy Jumps.
- **The Ouroboros Circular Gallery**:
  - Interactive circular shrine ($R = 220\text{ px}$) displaying the world serpent coiled into a closed ring.
  - **8 Circumferential Sockets**: Positioned at $\theta_k = k \times \frac{2\pi}{8} - \frac{\pi}{2}$ for $k \in \{0 \dots 7\}$.
  - **Inward-Arcing Serpentine Head & 9th Central Socket**: The serpent's head arcs into the center $(0, 0)$ framing the central socket.
  - **Forge Gate**: Central socket remains sealed until all 8 circumferential sockets are filled ($8/8$ Unique Helmets). Unlocks the button: **"FORGE THE 9TH HELMET: ENTER THE CELESTIAL RIFT"**.
- **The Final Trial (8-Second Wave All-Boss Rush)**:
  - Teleports serpent into **Floor 99: The Celestial Rift Arena** ($1800 \times 1800\text{ px}$).
  - **8-Second Wave Cadence**: Every $\Delta t_{\text{wave}} = 8.0\text{ s}$, a new Apex Boss awakens in the arena regardless of prior boss deaths.
  - **Victory Condition**: Defeat all spawned bosses -> Win the game, permanently keep the 9th Celestial Crown in the vault, trigger Grand Ascension ending.
  - **High-Stakes Permaloss Defeat Condition**: If the player perishes inside the Celestial Rift, the volatile fusion collapses: **all 8 Unique Helmets are shattered and reset to 0**, requiring the player to restart the collection journey from scratch.

### 1.2 Target Systems
- **Simulation Layer (`src/sim/`)**:
  - `src/sim/GalaxyJumpEngine.ts`: Calculates sacrifice score, resolves probability roll, executes atomic sacrifice deductions, and selects unowned unique drops.
  - `src/sim/BossRushGauntlet.ts`: Manages Celestial Rift Floor 99 state machine, 8-second wave timer accumulator, multi-boss horde lifecycle, and victory/defeat resolution.
  - `src/sim/GameEngine.ts`: Coordinates rift transition, boss wave injection, and permaloss/victory hooks.
  - `src/sim/SnakePlayer.ts`: Applies 9th Omni-Helmet multi-capacities and stat bonuses.
- **Data Layer (`src/data/`)**:
  - `src/data/Types.ts`: Extends `HelmetDef` and `MetaProgression` schemas to support unique helmets and gallery state.
  - `src/data/UniqueHelmets.ts`: Authoritative registry of all 8 Unique Helmets and the 9th Celestial Crown.
  - `src/data/MetaProgression.ts`: Stores `UniqueHelmets: string[]`, `CelestialCrownUnlocked: boolean`, and handles persistence migrations.
- **Presentation & UI Layer (`src/ui/`, `src/render/`)**:
  - `src/ui/screens/OuroborosGalleryModal.ts`: Responsive interactive circular gallery modal with 8 circumferential sockets, central head socket, and forge action button.
  - `src/render/OuroborosGalleryRenderer.ts` & `src/render/SnakeRenderer.ts`: Pure WebGL 2.0 rendering of circular serpent ring, socket runic badges, central singularity accretion disk, and rainbow iridescent celestial aura.
- **Audio DSP Layer (`src/audio/`)**:
  - `src/audio/SoundEngine.ts`: Synthesizes procedural audio for Galaxy Jump warp chimes, celestial awakening horns, dark pulse detonations, and victory chords.

### 1.3 Mechanics Reference
- [`ORACLE.md#the-grand-finale-the-9th-celestial-helmet-galaxy-jump--the-boss-rush-gauntlet`](file:///home/forart/dev/snake_ts/ORACLE.md)
- [`ORACLE.md#authoritative-mathematical-formulas--constants`](file:///home/forart/dev/snake_ts/ORACLE.md) (`FORMULA_SACRIFICE_SCORE`, `FORMULA_GALAXY_DROP_PROB`, `FORMULA_BOSS_RUSH_INTERVAL`, `FORMULA_GALLERY_GEOMETRY`)

---

## 2. Test Plan & Assertions (Red Phase)

### 2.1 Test Suite Location
- **Primary Suite**: `src/tests/EndgameBossRushAndGalaxyJump.test.ts`
- **Secondary Integrations**: `src/tests/MetaProgression.test.ts`, `src/tests/CranialLabAndBossHelmets.test.ts`

### 2.2 Comprehensive Test Assertions

#### Suite 1: The 8 Unique Helmets Registry & Signature Capacities
1. **Registry Completeness**: Verifies all 8 Unique Helmets exist in `UNIQUE_HELMETS` registry with valid IDs, names, icons, aspects, and stat profiles.
2. **Stat Modifiers Integrity**: Validates each helmet's unique stat buffs conform strictly to `ORACLE.md` Section 10.2:
   - Crown of the Colossus: +45% Armor, +60 Head HP, +40 Thorns, -10% Speed.
   - Gaze of the Gorgon: +25% Crit, +0.6x CritMult, +15% Bite.
   - Maw of the Behemoth: +50% Bite, +3.5 HP/s Regen, +35 Segment HP.
   - Wings of the Leviathan: +35% Speed, -40% Dash CD, +50 Magnet.
   - Eye of Chronos: +20% Turn, +25% XP, +20 Starting Shield.
   - Void Singularity Horns: +120 Magnet, +30% Shard, +25 Max Shield.
   - Crest of the Solar Chimera: +30% Bite, +20% Armor, +0.5x CritMult.
   - Visage of the Apex Hydra: +80 Head HP, +5.0 HP/s Regen, +25% Segment HP.
3. **The 9th Celestial Crown**: Verifies `unique_eternal_ouroboros_crown` aggregates all 8 unique capacities and applies +100% to all base attributes.

#### Suite 2: Galaxy Jump Sacrifice Mechanics & Score Calculation
4. **Sacrifice Score Summation**: Asserts $S = \sum (\text{Value} \times M_{\text{rarity}})$ calculates exact calibrated score values across mixed rarity inventories.
5. **Rarity Multipliers SSOT**: Asserts multipliers: common ($1.0\times$), uncommon ($1.5\times$), rare ($2.5\times$), epic ($4.0\times$), mythic ($7.0\times$).
6. **Standard Inventory Purge**: Confirms executing `GalaxyJumpEngine.performGalaxyJump()` clears all standard helmets from `meta.Helmets`.
7. **Unique Helmet Preservation**: Confirms that already collected Unique Helmets in `meta.UniqueHelmets` are **never** sacrificed or purged during a Galaxy Jump.

#### Suite 3: Unique Helmet Drop Probability & Distribution
8. **Exponential Saturation Curve**: Validates $P(\text{Unique}) = 1 - \exp(-S / 1000)$ produces expected probability values:
   - $S = 0 \implies P = 0.0$
   - $S = 250 \implies P \approx 0.221$
   - $S = 500 \implies P \approx 0.393$
   - $S = 1000 \implies P \approx 0.632$
   - $S = 2000 \implies P \approx 0.865$
   - $S = 3000 \implies P \approx 0.950$
9. **Uniform Unowned Drawing**: Asserts the awarded helmet is selected uniformly from the remaining unowned pool with zero duplicates.
10. **Consolation Stardust Bonus**: Asserts that when a roll fails, the player receives compensation Ouro ($\lfloor S \times 2.5 \rfloor$) and Shards ($\lfloor S / 20 \rfloor$).
11. **All-8 Acquired Surge**: When all 8 are already owned, confirms Galaxy Jump yields $+10,000\text{ Ouro}$ and $+500\text{ Shards}$.

#### Suite 4: Ouroboros Circular Gallery Geometry & Forge Gate
12. **Equidistant Circular Sockets**: Asserts the 8 socket coordinates match $(R \cos \theta_k, R \sin \theta_k)$ with $R = 220\text{ px}$ and $\theta_k = k \times \frac{\pi}{4} - \frac{\pi}{2}$.
13. **Central Socket Inward Arc**: Validates 9th central socket is centered at $(0, 0)$ positioned at the serpent's head jaws.
14. **Forge Gate Latching**:
    - With $0 \dots 7$ unique helmets: `canForge9thHelmet()` returns `false`.
    - With exactly $8$ unique helmets: `canForge9thHelmet()` returns `true`.

#### Suite 5: Celestial Rift Arena & 8-Second Wave All-Boss Rush
15. **Celestial Rift Initialization**: Verifies initiating the trial transitions `GameEngine` to Floor 99 ($1800 \times 1800\text{ px}$) and starts the boss rush wave controller.
16. **8-Second Wave Cadence**: Validates that every $8.0\text{ s}$ of simulation time, a new Apex Boss is spawned into the arena until the full wave roster is deployed.
17. **Simultaneous Multi-Boss Entity Tracking**: Asserts multiple active bosses exist and update concurrently without engine state corruption.
18. **Victory Resolution**: Defeating all bosses triggers `onBossRushVictory()`:
    - Permanently adds `unique_eternal_ouroboros_crown` to `meta.Helmets` and unlocks `meta.CelestialCrownUnlocked = true`.
    - Preserves all 8 unique helmets in the gallery.
    - Sets victory game state and triggers Ascension ending epilogue.
19. **High-Stakes Permaloss Resolution**: Player death inside Celestial Rift triggers `onBossRushDefeat()`:
    - **Completely empties `meta.UniqueHelmets` (clears all 8 helmets, reset to `[]`)**.
    - Retains standard Ouro and meta-upgrades.
    - Gallery sockets revert to empty/locked state.

---

## 3. Implementation Details (Green Phase)

### 3.1 Files Created / Modified
- `src/data/Types.ts`:
  - Add `UniqueHelmetId` type and extend `MetaProgressionState` with `UniqueHelmets: string[]` and `CelestialCrownUnlocked: boolean`.
- `src/data/UniqueHelmets.ts` *(New)*:
  - Authoritative data registry of the 8 Unique Helmets + 9th Omni-Helmet with full stat blocks and capability callbacks.
- `src/sim/GalaxyJumpEngine.ts` *(New)*:
  - Implements `calculateSacrificeScore()`, `calculateUniqueDropProbability()`, and `performGalaxyJump()`.
- `src/sim/BossRushGauntlet.ts` *(New)*:
  - Implements 8-second wave timer accumulator, boss spawn sequences, victory gate, and permaloss reset handler.
- `src/data/MetaProgression.ts`:
  - Adds `UniqueHelmets` array getter/setter, persistence serialization, and reset methods.
- `src/sim/GameEngine.ts`:
  - Integrates `BossRushGauntlet` for Floor 99 and wires up victory and defeat hooks.
- `src/ui/screens/OuroborosGalleryModal.ts` *(New)*:
  - Renders circular responsive modal UI with 8 sockets, central head socket, and forge button.
- `src/render/SnakeRenderer.ts`:
  - Adds procedural rendering for the 9th Celestial Crown halo and chromatic rainbow aura.

---

## 4. Verification & Quality Check

```bash
# Execute dedicated test suite
npx vitest run src/tests/EndgameBossRushAndGalaxyJump.test.ts

# Run strict TypeScript typecheck
npm run typecheck

# Full repository quality gate
./verify
```
