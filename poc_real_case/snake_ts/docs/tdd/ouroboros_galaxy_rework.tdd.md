# 🧪 Feature TDD Specification: Ouroboros Galaxy Rework

> **Feature Identifier:** `ouroboros_galaxy_rework`  
> **Rule Reference:** [`AGENTS.md#rule-1`](file:///home/forart/dev/snake_ts/AGENTS.md), [`AGENTS.md#rule-2`](file:///home/forart/dev/snake_ts/AGENTS.md), [`AGENTS.md#rule-3`](file:///home/forart/dev/snake_ts/AGENTS.md), [`ORACLE.md`](file:///home/forart/dev/snake_ts/ORACLE.md)  
> **Master Checklist:** [`docs/checklists/ouroboros_galaxy_rework_checklist.md`](file:///home/forart/dev/snake_ts/docs/checklists/ouroboros_galaxy_rework_checklist.md)  
> **Status:** 100% COMPLETE & VERIFIED (Quality Gate PASS)  
> **Created:** 2026-08-27  

---

## 1. Architectural Scope & Specifications

### 1.1 Serpentine Boss Guardians (All 8 Archetypes)
- **Problem Solved**: Previously, only `centipede` possessed trailing body segments while bosses 2–8 were single floating circles.
- **Serpentine Body Specification**:
  - Every boss instantiates articulated body segments ($N = 8 \dots 30$ based on archetype & floor).
  - Universal inverse kinematics (`UpdateSegments(dt)`) with distance-constrained follow physics and sinusoidal undulation.
  - `boss.parts()` returns the segment array for accurate player-boss collision and damage routing.
- **Escalated Combat Threat & Attack Movesets**:
  - **Bullet Hell Spirals**: Multi-arm Archimedean projectile spirals.
  - **Charging Dashes**: Telegraphed linear dashes with warning paths.
  - **360° Tail Sweeps**: Expanding shockwaves when player bites rear segments.
  - **Minion Swarms**: Spawning thematic minions (Swarmlings for Hivemind, Brutes for Colossus, Drones for Gorgon).
  - **Multi-Phase Enrage**: Phase 2 at $<50\%$ HP with faster attacks, increased speed, and red overdrive aura.
- **Archetype Visuals (`BossRenderer.ts`)**: Custom procedural vector shaders for Centipede, Gorgon, Colossus, Frostwyrm, Chronowyrm, Hivemind, Superconductor, and Leviathan.

### 1.2 Main Menu UI Streamlining & Multi-Screen Preservation
- Remove `.btn-lab` (Mutation Lab) and `.btn-multiscreen` (Multi-Screen) from the Main Menu DOM.
- Consolidate `.menu-sub-row` to cleanly center `🏛️ Sanctuary` and `⚙️ Settings`.
- Preserve 100% of underlying Multi-Screen platform code (`src/platform/MultiScreen.ts`, `src/platform/CompanionSync.ts`, `src/ui/screens/MultiScreenModal.ts`).

### 1.3 Game Rebranding to "Ouroboros Galaxy"
- Rebrand game title to **"Ouroboros Galaxy"** across `index.html`, `MenuScreen.ts`, `GameData.ts`, `main.ts`, `package.json`, `capacitor.config.json`, and `verify`.

### 1.4 Galactic Cosmic Background Engine (`ArenaBackdrop.ts`)
- Deep-space cosmic arena with multi-layered starfield:
  - 180 micro stars (batched rects)
  - 70 spectral mid stars (chromatic arcs)
  - 16 diamond beacons / pulsars with 4-point diffraction flares
- Diagonal Milky Way galaxy plane and floor-specific cosmic nebula dust baked into offscreen canvas.
- 0 runtime heap allocations per frame, sustained $>120$ FPS.

### 1.5 Challenge-Based Mutation Lab Unlocks & Tier Gating
- **Starter Defaults**: Tier 1 of 1 offensive weapon (`turret`/`venom`) and Tier 1 of 1 defense (`shield`) are unlocked by default on every new run.
- **Challenge Gating**: All other upgrades and higher tiers (Tier 2, Tier 3) are locked behind gameplay achievements (e.g. Defeat Boss X, Reach Length 50/100, Collect 15 Golden Apples, Achieve 25x Combo, etc.).
- **Lab UI Badging**: Displays `🔒 [TIER X LOCKED]` and `⚠️ UNLOCK: <Challenge Description>` on locked options, with disabled purchase buttons.

---

## 2. Test Plan (Red-Green-Refactor)

1. `src/tests/SerpentineApexBosses.test.ts`: Verify all 8 bosses instantiate with body segments, follow kinematics, and generate combat attack patterns.
2. `src/tests/GalaxyMainMenuAndMultiScreen.test.ts`: Verify Main Menu branding "OUROBOROS GALAXY", removal of Lab and MultiScreen buttons, and preservation of MultiScreenModal.
3. `src/tests/GalacticStarfieldPerformance.test.ts`: Verify offscreen backdrop baking, starfield generation, and zero-alloc execution budget $<1.5\text{ms}$.
4. `src/tests/MutationLabChallengeProgression.test.ts`: Verify default Tier 1 starters unlocked, advanced tiers locked by challenge, challenge evaluation logic, and Lab UI padlock badges.

---

## 3. Implementation Checklist

- [x] Create Master Checklist (`docs/checklists/ouroboros_galaxy_rework_checklist.md`).
- [x] Create Feature TDD Specification (`docs/tdd/ouroboros_galaxy_rework.tdd.md`).
- [x] Implement Rebranding and Menu UI clean-up.
- [x] Implement Challenge Progression and Tier Gating in `MetaProgression.ts` and `SnakeLabScreen.ts`.
- [x] Implement Galactic Starfield and Nebula Backdrop in `ArenaBackdrop.ts`.
- [x] Implement Serpentine Bodies and Combat Movesets for all 8 Bosses in `Boss.ts` and `BossRenderer.ts`.
- [x] Update `ORACLE.md` specifications.
- [x] Run full `./verify` quality gate.
