# Feature TDD Specification: Purge Lifetime Record Fallbacks & Strict In-Run Roguelite Reset

> **File:** `docs/tdd/purge_lifetime_record_fallbacks_and_in_run_reset.tdd.md`  
> **Status:** GREEN / COMPLETE  
> **Target Files:**  
> - `src/data/MetaProgression.ts`  
> - `src/sim/GameEngine.ts`  
> - `ORACLE.md`  
> - `src/data/CodexData.ts`  
> - `src/tests/StrictInRunChallengeReset.test.ts`  

---

## 1. Feature Description & Scope

Enforce strict roguelite in-run progression for Cranial Lab upgrades and challenge tier unlocks:
1. **Purge Lifetime Record Fallbacks:**
   - Challenge conditions across Tiers 1, 2, and 3 in `MetaProgression.getChallengeFor` evaluate exclusively against in-run state (`ChallengeContext` or `RunSummary`).
   - Removed all `|| (r ? ... : false)` lifetime record fallbacks.
   - `checkChallenge` passes `undefined` for `Records` (`ch.condition(undefined, ctx?.summary, ctx)`).
2. **Strict In-Run Reset:**
   - `MetaProgression.ResetRunUnlocks()` resets `UnlockedTiers` to strictly starter defaults (`{ turret: 1, tesla: 1, venom: 1, shield: 1, spikes: 1, fangs: 1 }`) and clears `CompletedChallenges = {}`.
   - `GameEngine.StartRun()` / `StartGame()` / `Init()` / `Reset()` ensures `ResetRunUnlocks()` executes and instantiates a fresh `SnakePlayer` with 0 head modules/augments and 0 in-run Ouro.
3. **Oracle & Codex Documentation:**
   - Updated `ORACLE.md` and `CodexData.ts` documenting the strict roguelite in-run reset rule.

---

## 2. Red-Green-Refactor Test Matrix

- [x] **Test 1:** High lifetime records (e.g. `TotalKills = 9999`, `TotalBosses = 999`, `HighestFloor = 20`, `TotalFoods = 9999`, `HighestCombo = 100`) do NOT automatically unlock locked tier 1/2/3 challenges when evaluated in an empty/fresh run context.
- [x] **Test 2:** Direct challenge condition execution ignores `Records` argument completely.
- [x] **Test 3:** In-run achievements (e.g. `kills: 100`, `floor: 3, bosses: 2`, `combo: 22`, `foods: 40`) unlock their respective challenge tiers as expected.
- [x] **Test 4:** `MetaProgression.ResetRunUnlocks()` resets `UnlockedTiers` strictly to `{ turret: 1, tesla: 1, venom: 1, shield: 1, spikes: 1, fangs: 1 }` and `CompletedChallenges` to `{}`.
- [x] **Test 5:** `GameEngine.StartRun()` (and aliases `StartGame()`, `Init()`, `Reset()`) triggers `ResetRunUnlocks()`, giving the player 0 installed head modules/augments and 0 Ouro.

---

## 3. Verification & Quality Gate Results

- **Strict Typecheck:** PASS (`npm run typecheck`)
- **Vitest Conformance:** PASS (60 test files, 774 tests passed)
- **Production Bundle:** PASS (`npm run build`)
- **Quality Gate:** 100% PASS on `./verify`
