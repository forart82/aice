# Feature TDD Specification: Step 1 Deep Codebase Bug Fixes

> **Feature Identifier:** `step1_deep_bug_fixes`  
> **Target Subsystems:** Simulation, Spatial Grid, Combat, Bosses, Cranial Weapons, Meta-Progression, Persistence, UI Root, HUD, Audio, and Renderer  
> **Standard:** Strict Test-Driven Development (TDD)  

---

## 1. Description & Scope

Comprehensive correction of bugs uncovered during the multi-agent deep audit:
1. **Simulation & Math**:
   - `SnakePlayer.Deflect`: Perpendicular wall collision deflection lockout.
   - `SpatialHashGrid`: `| 0` bitwise truncation putting negative coordinates into cell 0 replaced by `Math.floor`. Symmetrical boundary clamping in `queryRadius`.
   - `CombatSystem`: Polygon ray-casting division edge cases and 120 Hz unthrottled constriction rate limit.
   - `Hazard.or` & `Projectile.or`: Fixed `v !== 0` check overriding explicit 0 values.
   - `GameEngine`: Fixed `ResumeFromDraft()` & `CompleteLevelUp()` accumulator zeroing; included `HelmetDrops` in `RescaleWorld()`.
2. **Combat & Bosses**:
   - `SnakePlayer`: Added `silent` parameter to `DamageHead` to prevent duplicate audio/FX on self-bite.
   - `CombatSystem`: Corrected segment crossing distance constraint to $|i - j| \ge 3$ per Oracle SSOT.
   - `CombatSystem`: Implemented Head Arsenal handlers for all 12 missing cranial weapons and defenses.
   - `SnakePlayer`: Updated `GetActiveAlchemicalFusions()` to inspect `HeadModules`.
   - `Boss`: Leviathan `MoveTimer` initialized to 5.0s to avoid tick-0 missile volley. Dynamic archetype segment spacing and segment arena boundary clamping.
   - `GameEngine`: Purged hostile projectiles on boss defeat.
3. **Meta-Progression & Persistence**:
   - `MetaProgression`: `CommitRun` now invokes `EvaluateChallenges()`. Added Tier 2/3 challenge definitions in `getChallengeFor`. Standardized starter defaults.
   - `SaveIO`: `validateAndNormalizeV2` now preserves `unlockedTiers` and `completedChallenges`, correctly parses `unlockedClasses` arrays, and decodes percent-encoded base64 fallback strings.
4. **UI & HUD**:
   - `UiRoot`: `hideScreen` resolves screen IDs before closing.
   - `HudView`: Deduplicated pointer/touch listeners, added window blur drag release, synced Lefty mode.
   - `SnakeLabScreen`: Fixed close button modal routing.
5. **Audio & Renderer**:
   - `SoundEngine`: Added dynamics compressor and polyphony capping.
   - `ArenaBackdrop`: Synced offscreen canvas with DPR.

---

## 2. Red-Green-Refactor Plan

1. **RED**: Write comprehensive regression test suite in `src/tests/DeepBugFixes.test.ts` covering the identified bug scenarios. Run and verify failures where applicable.
2. **GREEN**: Apply fixes across simulation, data, platform, UI, and audio source files.
3. **REFACTOR**: Ensure zero regressions on `./verify` (262+ tests passing, 0 TypeScript errors).
