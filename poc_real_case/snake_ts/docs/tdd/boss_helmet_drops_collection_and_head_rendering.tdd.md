# 🧪 Feature TDD Specification: Boss Helmet Drops, In-World Collection, Pre-Run Equipping & Procedural Head Rendering

> **Feature Identifier:** `boss_helmet_drops_collection_and_head_rendering`  
> **Rule Reference:** [`AGENTS.md#rule-1`](file:///home/forart/dev/snake_ts/AGENTS.md), [`AGENTS.md#rule-2`](file:///home/forart/dev/snake_ts/AGENTS.md), [`AGENTS.md#rule-3`](file:///home/forart/dev/snake_ts/AGENTS.md), [`ORACLE.md#312-boss-helmet-relics--head-customization`](file:///home/forart/dev/snake_ts/ORACLE.md)  
> **Status:** VERIFIED & COMPLETE (100% QUALITY GATE PASS)  
> **Created:** 2026-08-27  

---

## 1. Architectural Scope & Specifications

### 1.1 In-World Physical Boss Helmet Drop
- **Exclusive Boss Origin**: Helmets are strictly dropped by defeated Floor Bosses (`centipede`, `gorgon`, `colossus`, `frostwyrm`, `chronowyrm`, `hivemind`, `superconductor_boss`, `leviathan`). Regular enemies NEVER drop helmets.
- **Physical Entity (`HelmetDrop.ts`)**: Pure simulation entity with position $(X, Y)$, velocity, radius 22, pulse, spawn scale, rarity, and `HelmetDef` payload.
- **In-World Collection**: Snake head physically collides with the `HelmetDrop` in the arena:
  - Adds helmet to persistent `MetaProgression.Instance.Helmets`.
  - Plays level-up audio chime, particle burst, shockwave, and floating notification `[🪖 LOOTED: <Helmet Name>]`.
  - Auto-vacuum safety ensures no dropped helmet is lost if the floor transitions or run ends.

### 1.2 Pre-Run Helmet Selection & Persistent Equipping
- In `ClassSelectScreen` and `SnakeLabScreen` (Helmet Vault tab), players can browse their collected helmets and equip one prior to starting an expedition.
- `SnakePlayer` receives the equipped helmet and applies all 13 possible stat modifiers (`maxHp`, `armor`, `speed`, `bitePower`, `critChance`, `critMult`, `hpRegen`, `shield`, `magnetRadius`, `dashCooldown`, `xpMultiplier`, `shardMultiplier`, `thorns`).

### 1.3 Procedural Headpiece Visual Rendering (`SnakeRenderer.ts`)
- Dedicated procedural vector headpieces for all 6 boss archetypes:
  - **Centipede Crown**: Segmented chitinous mandibles, golden serrated brow plate, dual sensory antennae with bioluminescent bulbs.
  - **Colossus Visor / Bulwark**: Heavy steel chassis, horizontal energy visor slit, lateral blast shields with heat exhaust louvers.
  - **Leviathan Horns / Abyssal**: Swept-back aquatic horns with rib rings, luminescent azure dorsal crest fin, temporal gill slits.
  - **Chrono Crown / Temporal**: Spacetime distortion ripple arcs, concentric clockwork tiara dial with tick marks, violet tachyon diamond gem.
  - **Gorgon Crest / Ophidian**: Flared cobra hood wings with cybernetic circuit tracings, twin venom fangs, jade eye socket lenses.
  - **Void Helm / Singularity**: Dark obsidian cowl, ethereal cosmic horn spines, pulsing singularity black hole vortex with accretion disk.
- Scaled dynamically with `headRadius`, rotated with `snake.angle`, and styled using `HELMET_RARITY_COLORS`.

---

## 2. Test Execution & Verification Summary

- **Test Suite**: [`src/tests/BossHelmetAudit.test.ts`](file:///home/forart/dev/snake_ts/src/tests/BossHelmetAudit.test.ts) (9 comprehensive tests) + [`src/tests/CranialLabAndBossHelmets.test.ts`](file:///home/forart/dev/snake_ts/src/tests/CranialLabAndBossHelmets.test.ts) (20 tests).
- **Quality Gate Results**:
  - Strict TypeScript Typecheck: **100% PASS**
  - Vitest Conformance Matrix: **22 files, 250 tests PASS (100%)**
  - Production Bundle Build: **100% PASS**

---

## 3. Implementation Checklist

- [x] Draft TDD feature specification file.
- [x] Create `src/sim/HelmetDrop.ts` headless entity.
- [x] Update `src/sim/GameEngine.ts` to spawn `HelmetDrop` on boss defeat and resolve player collection.
- [x] Create `src/render/HelmetDropRenderer.ts` and integrate with `GameRenderer.ts`.
- [x] Implement procedural headpiece rendering (`drawSerpentHelmet`) in `src/render/SnakeRenderer.ts`.
- [x] Update `src/ui/screens/ClassSelectScreen.ts` and `src/ui/screens/SnakeLabScreen.ts` for clean pre-run navigation.
- [x] Author comprehensive `src/tests/BossHelmetAudit.test.ts`.
- [x] Run full `./verify` quality gate (22 test suites, 250 tests passing).
