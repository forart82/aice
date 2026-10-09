# 🌌 Master Checklist: Ouroboros Galaxy Rework

> **Project:** Ouroboros Galaxy (TypeScript 5.8+, Vite 6, Vitest 3, Canvas 2D, Web Audio API)  
> **Status:** 100% COMPLETE & VERIFIED (Quality Gate PASS)  
> **Rule Reference:** [`AGENTS.md`](file:///home/forart/dev/snake_ts/AGENTS.md), [`ORACLE.md`](file:///home/forart/dev/snake_ts/ORACLE.md)  
> **Location:** `docs/checklists/ouroboros_galaxy_rework_checklist.md`  
> **Completed:** 2026-08-27  

---

## 📋 Comprehensive Task Checklist

### 1. 🐉 Boss Rework & Serpentine Overhaul
- [x] **Serpentine Anatomy for ALL 8 Bosses**:
  - [x] Floor 1: *Centipede Behemoth* (14–24 chitinous segments with lateral mandibles)
  - [x] Floor 2: *Storm Gorgon* (12–18 electrified coil segments with lightning arcs)
  - [x] Floor 3: *Infernal Colossus* (10–16 molten magma carapace segments)
  - [x] Floor 4: *Glacial Frostwyrm* (14–20 cryo-crystal spine segments)
  - [x] Floor 5: *Chrono Wyrm* (16–22 temporal flux dial ring segments)
  - [x] Floor 6: *Bio-Venom Hivemind* (18–26 toxic sporepod segments with pustules)
  - [x] Floor 7: *Apex Superconductor* (12–18 hyper-conductive electromagnetic segments)
  - [x] Floor 8: *Astral Leviathan* (20–30 celestial void segments with starlight satellites)
- [x] **Vertebral Follow Kinematics (`src/sim/Boss.ts`)**:
  - [x] Implement distance-constrained IK with sinusoidal lateral undulation.
  - [x] Ensure `Boss.Parts()` / `boss.parts()` returns all segments for collision resolution.
- [x] **Escalated Combat AI & Threat Patterns**:
  - [x] Segment-mounted bullet hell projectile volleys and Archimedean spirals.
  - [x] Telegraphed charging dashes with red hazard trails.
  - [x] 360° tail-sweep shockwaves when player attacks rear segments.
  - [x] Minion summoning (e.g. Swarmlings for Hivemind, Brutes for Colossus, Drones for Gorgon).
  - [x] Multi-phase enrage at $<50\%$ HP (increased speed, projectile density, enraged aura).
- [x] **Procedural Segment Visual Shaders (`src/render/BossRenderer.ts`)**:
  - [x] Tail-to-head rendering with archetype-specific geometry, glowing cores, and hit flashes.

---

### 2. 📱 Main Menu UI Streamlining & Clean-up
- [x] **Remove Redundant Main Menu Buttons (`src/ui/screens/MenuScreen.ts`)**:
  - [x] Remove `.btn-lab` ("🧬 Mutation Lab") button from main menu DOM (Lab is accessed during level-up / in-game flow).
  - [x] Remove `.btn-multiscreen` ("📱 Multi-Screen") button from main menu DOM.
  - [x] Refactor `.menu-sub-row` to cleanly center `🏛️ Sanctuary` and `⚙️ Settings`.
- [x] **Preserve Multi-Screen Subsystem (`src/platform/`)**:
  - [x] Keep `src/platform/MultiScreen.ts` and `src/platform/CompanionSync.ts` intact.
  - [x] Keep `src/ui/screens/MultiScreenModal.ts` intact and accessible via settings or companion pairing.

---

### 3. 🌌 Rebranding to "Ouroboros Galaxy"
- [x] **Title & Metadata Updates**:
  - [x] `index.html`: Update `<title>` to `Ouroboros Galaxy: Cosmic Roguelike Snake RPG`.
  - [x] `src/ui/screens/MenuScreen.ts`: Update banner to `OUROBOROS GALAXY`.
  - [x] `package.json`, `capacitor.config.json`, `verify`, `GameData.ts`, `main.ts`, `emulator.html`, and UI header branding references.

---

### 4. ✨ Galactic Starfield & Cosmic Background Engine
- [x] **Procedural Cosmic Backdrop (`src/render/ArenaBackdrop.ts`)**:
  - [x] Multi-layer starfield (180 micro stars, 70 spectral mid stars, 16 diamond beacons/pulsars).
  - [x] Harmonic multi-octave twinkling with non-linear bloom shimmer.
  - [x] Diagonal Milky Way galaxy plane and floor-specific cosmic nebula dust clouds.
  - [x] Pre-baked offscreen canvas for zero GC allocations and $>120$ FPS rendering.

---

### 5. 🧬 Challenge-Based Mutation Lab Unlocks & Tier Gating
- [x] **Starter Defaults (Run-Start Unlocks)**:
  - [x] 1 Offensive Weapon Tier 1 unlocked by default: *Attack Spitter / Venom Needle* (`turret`/`venom`).
  - [x] 1 Defensive Bio-Organ Tier 1 unlocked by default: *Thick Scales / Carapace Shield* (`shield`).
- [x] **Challenge Progression Matrix (`src/data/MetaProgression.ts`)**:
  - [x] Higher tiers and advanced weapons/defenses/augments gated behind gameplay milestones:
    - [x] `cryo`: Defeat Floor 1 Boss (Centipede).
    - [x] `magma` & `magnet`: Defeat Floor 2 Boss (Storm Gorgon).
    - [x] `plasma`: Defeat Floor 3 Boss (Infernal Colossus).
    - [x] `chrono`: Defeat Floor 4 Boss (Frostwyrm).
    - [x] `tachyon`: Defeat Floor 5 Boss (Chrono Wyrm).
    - [x] `spikes` Tier 2: Reach length 50 segments or defeat 3 bosses.
    - [x] `horns` Tier 2: Reach length 75 segments or achieve 500 kills.
    - [x] `visor` Tier 2: Reach Floor 4 or achieve 25x combo.
    - [x] `laser` Tier 3: Achieve 30x Combo Overdrive in a single run.
    - [x] `shield` Tier 2: Reach Floor 3 or defeat 2 bosses.
- [x] **Lab UI Padlock & Challenge Badging (`src/ui/screens/SnakeLabScreen.ts`)**:
  - [x] Display `🔒 [TIER X LOCKED]` and `⚠️ UNLOCK: <Challenge Description>` on locked options.
  - [x] Disable purchase buttons until prerequisite challenges are achieved.

---

### 6. 🧪 TDD Quality Gate & Automated Verification
- [x] `src/tests/SerpentineApexBosses.test.ts` (All 8 bosses multi-segment & kinematics).
- [x] `src/tests/GalaxyMainMenuAndMultiScreen.test.ts` (Menu button cleanliness & MultiScreen preservation).
- [x] `src/tests/GalacticStarfieldPerformance.test.ts` (0-alloc & 60 FPS backdrop).
- [x] `src/tests/MutationLabChallengeProgression.test.ts` (Starter defaults & challenge unlock triggers).
- [x] Update existing suites (`ApexBossGuardians.test.ts`, `UiLayoutAudit.test.ts`, `CranialLabAndBossHelmets.test.ts`, `SelfTest.test.ts`, `SaveIO.test.ts`).
- [x] Execute `./verify` with 100% PASS (26/26 test suites, 261 tests, strict typecheck, production build).

### 7. 📱 Mobile Touch Controls, Joypad Handedness & Accessible Smartphone HUD
- [x] **Right-Handed Default Joypad Orientation**:
  - [x] Virtual Joystick positioned on the **Right Side** (bottom-right) for natural right-thumb steering.
  - [x] Action buttons (Dash ⚡ and Skill ✨) positioned on the **Left Side** (bottom-left) for left-thumb action triggering.
- [x] **Menu Setting for Handedness Switch (`src/ui/screens/SettingsScreen.ts`)**:
  - [x] Clear "Joystick Position" dropdown with "Right Side (Default)" and "Left Side" options.
  - [x] Seamless live sync with `InputManager.instance.setLefty()`, `UiRoot.applyMetrics()`, and persistent storage in `localStorage`.
- [x] **Smartphone-Accessible Lab & Pause Touch Controls**:
  - [x] Generous 44px × 44px minimum touch targets with glowing cyan glassmorphism.
  - [x] Tactile active-state compression (0.92x), audio clicks, and safe-area notch offsets.
  - [x] Touch events stop propagation to avoid accidental steering drag when tapping top buttons.
- [x] **Quality Gate & Android APK**:
  - [x] 100% PASS on `./verify` (262 tests across 26 suites, 0 typecheck errors).
  - [x] Android APK package rebuilt: [`ouroboros-galaxy.apk`](file:///home/forart/dev/snake_ts/ouroboros-galaxy.apk) (4.7 MB).

---

## 🏆 Final Verification Results

```bash
======================================================================
🎉 QUALITY GATE: 100% PASS — ALL CONFORMANCE TESTS & BUILDS PASSED
======================================================================
- Strict TypeScript Check: 0 Errors
- Vitest Conformance Matrix: 262/262 Tests Passed (26 Suites)
- Production Build: dist/index.html & bundled assets ready
- Android APK: ouroboros-galaxy.apk & ouroboros-ascension.apk (4.7 MB)
```
