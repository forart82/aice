# Feature TDD Specification: Unified Sound Dispatchers & Cohesive Cyber Art Direction

> **Feature Identifier:** `docs/tdd/sound_dispatcher_and_cyber_art_alignment.tdd.md`  
> **Status:** Green (Completed & Verified)  
> **Target Directory:** `/home/forart/dev/snake_ts`  
> **Rule Reference:** [`AGENTS.md#rule-1`](file:///home/forart/dev/snake_ts/AGENTS.md), [`AGENTS.md#rule-2`](file:///home/forart/dev/snake_ts/AGENTS.md), [`AGENTS.md#rule-3`](file:///home/forart/dev/snake_ts/AGENTS.md), [`AGENTS.md#rule-10`](file:///home/forart/dev/snake_ts/AGENTS.md) & [`ORACLE.md`](file:///home/forart/dev/snake_ts/ORACLE.md)  

---

## 1. Feature Overview & Requirements

- **High Concept:** Reviewed, unified, and aligned all sound dispatchers across the simulation (`CombatSystem.ts`, `GameEngine.ts`), presentation/UI (`OuroborosGalleryScreen.ts`), and audio synthesis (`SoundEngine.ts`, `Synth.ts`).
  1. Eating sounds unified: both standard and golden apples trigger the same snappy cyber-bite pop sound (`sfx_eat.wav` / `eatPop`) with no extra conflicting stingers or crystalline chime replacements.
  2. Pickup sounds clean: collecting stars or shards calls `playStar()` or `playShard()` cleanly, suppressing `playEat()`. Shield orbs call `playShield()` without double-triggering `playEat()`.
  3. Combat sounds structured: enemy bites dispatch through `playBite()`, hits through `playHit()`, and kills through `playExplosion()`.
  4. Fanfare de-cacophonization: game state transitions invoke dedicated single sounds (floor clear -> `playFloorClear()`, victory -> `playVictory()`, defeat -> `playGameOver()`, boss spawn -> `playBossAlert()`). Milestone ascensions trigger a single clean `playLevelUp()` stinger instead of stacking 3-4 simultaneous fanfares.
  5. Gallery jump outcomes: warp success triggers `playLevelUp()` (concise stinger) and warp failure triggers `playVoidCollapse()` (subdued dark void implosion).

---

## 2. Test Plan & Assertions (Red -> Green)

- **Test Suite Location:** `src/tests/SoundDispatcherAlignment.test.ts` (12 tests) + `src/tests/ProfessionalAudioRedesign.test.ts` (56 tests) + `src/tests/UnifiedEatingAndCyberJingles.test.ts` (13 tests).
- **Key Assertions & Results:**
  1. `CombatSystem.eatFood` with standard apple invokes ONLY `playEat(combo, false)` without extra stingers (PASS).
  2. `CombatSystem.eatFood` with golden apple invokes ONLY `playEat(combo, true)` without extra stingers (PASS).
  3. `CombatSystem.eatFood` with star/shard items cleanly invokes `playStar()` / `playShard()` and suppresses `playEat()` (PASS).
  4. `CombatSystem.eatFood` with shield orb triggers `playShield()` without double-triggering `playEat()` (PASS).
  5. `CombatSystem` enemy melee bite dispatches to `playBite(roll.damage, roll.crit)` / `playHit()` (PASS).
  6. `CombatSystem` enemy kill dispatches to `playExplosion(0.55)` (PASS).
  7. `GameEngine.HandleGameOver` dispatches single `PlayGameOver()` on defeat and `PlayVictory()` on victory (PASS).
  8. `GameEngine.OnBossDefeated` transitions to `FloorClear` with single `PlayFloorClear()` (PASS).
  9. `GameEngine.CheckDailyMilestones` dispatches a single clean `PlayLevelUp()` without overlapping fanfare cacophony (PASS).
  10. `OuroborosGalleryScreen` warp outcome invokes `playLevelUp()` on success and `playVoidCollapse()` on failure (PASS).

---

## 3. Implementation Details

- **Files Modified:**
  - `src/sim/CombatSystem.ts`:
    - Dispatched `Services.sound.playEat(combo, isGolden)` only for nutrient foods.
    - Handled `'star'`, `'shard'`, and `'shield'` as special pickups without double-invoking `playEat()`.
    - Dispatched melee bite to `Services.sound.playBite(roll.damage, roll.crit)` with fallback to `playHit()`.
  - `src/sim/GameEngine.ts`:
    - Cleaned `CheckDailyMilestones` to fire a single clean `this.Sound.PlayLevelUp()` per milestone tier, eliminating simultaneous multi-stinger fanfare stacking.
  - `src/ui/screens/OuroborosGalleryScreen.ts`:
    - On warp success: invokes `Services.Sound.playLevelUp()`.
    - On warp failure: invokes `Services.Sound.playVoidCollapse()`.
  - `src/audio/Synth.ts` & `src/audio/SoundEngine.ts`:
    - Unified eating sound routing to `BROADCAST_AUDIO_PATHS.eat` for both standard and golden apples.
    - Procedural jingles updated to sleek cyber harmonics with durations <= 0.75s.
  - `src/tests/SoundDispatcherAlignment.test.ts`:
    - Authored 12 comprehensive unit and integration tests covering all dispatchers.

---

## 4. Quality Gate Verification

```bash
# Typecheck
npm run typecheck # 100% PASS (0 errors)

# Full Conformance Suite
./verify # 100% PASS (153 test files, 1979 tests, production bundle build PASS)
```
