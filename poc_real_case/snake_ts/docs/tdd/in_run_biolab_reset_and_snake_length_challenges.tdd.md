# Feature TDD Specification: In-Run Bio-Lab Reset & Snake Length Challenge Progression

> **Feature ID:** `in_run_biolab_reset_and_snake_length_challenges`  
> **Status:** Red $\rightarrow$ Green $\rightarrow$ Refactor  
> **Target Files:**
> - `src/data/MetaProgression.ts`
> - `src/sim/GameEngine.ts`
> - `src/ui/screens/SnakeLabScreen.ts`
> - `src/tests/InRunBioLabAndSnakeLengthChallenges.test.ts`

---

## 1. Problem Statement & User Requirements

1. **In-Run Bio-Lab Scope:**
   - Bio-Lab upgrades (cranial modules, weapons, augments) and tier unlocks must be **run-scoped**: reset at each new run.
   - Unlocks and purchases are made during the run using in-run XP and evaluated against in-run achievements.
   - Permanent meta-progression remains in Sanctuary meta-upgrades and the Helmet Vault.
2. **Snake Length Challenges:**
   - As a core Snake game mechanic, snake length must be a prominent, rewarding challenge requirement across Tier 1, Tier 2, and Tier 3 unlocks (e.g., Length 25, 35, 50, 70, 100, 150).

---

## 2. Technical Architecture & Challenge Rules

### 2.1 Run Lifecycle Reset:
- `MetaProgression.ResetRunUnlocks()`: Clears `UnlockedTiers` and in-run completed challenges.
- `GameEngine.StartRun()`: Invokes `MetaProgression.ResetRunUnlocks()` and instantiates fresh `SnakePlayer`.

### 2.2 Dynamic In-Run Evaluation:
- `IsTierUnlocked(upgradeId, tier, player?, engine?)` extracts:
  - `length`: `(player.segments.length + 1)`
  - `floor`: `engine.CurrentFloor`
  - `bosses`: `engine.Combat.BossKills`
  - `kills`: `engine.Combat.Kills`
  - `foods`: `engine.Combat.FoodsEaten`
  - `combo`: `engine.Combat.HighestRunCombo`
- Evaluates snake length challenges and persists in-run unlock into `UnlockedTiers[upgradeId]`.

---

## 3. Test Suite Matrix (`InRunBioLabAndSnakeLengthChallenges.test.ts`)

1. **Test 1:** Starting a new run resets Bio-Lab module purchases and locks non-starter Tier 1/2/3 modules.
2. **Test 2:** Growing snake length to milestone (e.g., Length 25 for Magma Vent, Length 35 for Cryo Mortar, Length 70 for Nanite Swarm) dynamically unlocks the corresponding module during the run.
3. **Test 3:** Defeating a Floor Boss or advancing floors dynamically satisfies in-run boss challenges.
4. **Test 4:** In-run module purchases deduct in-run XP and apply to `SnakePlayer.headModules` and `headAugment`.
5. **Test 5:** Subsequent new run cleanly re-initializes Bio-Lab without carrying over previous run's module unlocks or purchases, while preserving Sanctuary meta-upgrades and Helmet Vault inventory.

---

## 4. Verification & Results

- **Vitest Suite:** `src/tests/InRunBioLabAndSnakeLengthChallenges.test.ts` (5 tests, 100% PASS)
- **Quality Gate:** `./verify` (33 test files, 373 tests, 100% PASS)
- **Production Web Build:** Vite 6 production bundle 100% PASS
- **Android APK Package:** 100% SUCCESS (`android/app/build/outputs/apk/debug/app-debug.apk`)

