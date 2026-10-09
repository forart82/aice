# Feature TDD Specification: In-Run Reset & Challenge Progression

> **Feature Identifier:** `docs/tdd/in_run_reset_and_challenge_progression.tdd.md`  
> **Status:** Green  
> **Target Directory:** `/home/forart/dev/snake_ts`  
> **Rule Reference:** [`AGENTS.md#rule-2`](file:///home/forart/dev/snake_ts/AGENTS.md) & [`ORACLE.md`](file:///home/forart/dev/snake_ts/ORACLE.md)  

---

## 1. Feature Overview & Requirements

- **High Concept:** Ensure Cranial Mutation Lab module unlocks and tier progression are strictly in-run scoped. Starting a new run cleanly resets all non-starter modules back to locked state even if lifetime `meta.Records` contains high lifetime kills, high floors reached, or victories. In-run feats (food collection, enemy kills, serpent length growth, and boss defeats) dynamically unlock modules in real time during the run, and `ResetRunUnlocks()` returns all in-run state to starter defaults (`turret`, `tesla`, `venom`, `shield`, `spikes`, `fangs` at Tier 1; all others locked).
- **Target Systems:** `src/data/MetaProgression.ts`, `src/sim/GameEngine.ts`, `src/ui/screens/SnakeLabScreen.ts`
- **Mechanics Reference:** [`ORACLE.md#progression-and-upgrades`](file:///home/forart/dev/snake_ts/ORACLE.md)

---

## 2. Test Plan & Assertions (Red Phase)

- **Test Suite Location:** `src/tests/InRunResetAndChallengeProgression.test.ts`
- **Assertions:**
  1. Starting a new run locks all non-starter upgrades (e.g., Magma, Cryo, Plasma, Tachyon, Scattershot, Needler, Flak, Chrono, Nanite, Maw, Horns, Laser, Crown) even when `meta.Records` contains lifetime statistics (e.g. 5000 kills, Floor 20, 10 victories).
  2. Starter defaults (`turret`, `tesla`, `venom`, `shield`, `spikes`, `fangs`) are unlocked at Tier 1 at the start of a run, while their Tier 2/3 variants remain locked.
  3. In-run food collection in the active run dynamically unlocks food-based modules (e.g. Bio-Magnet at 30 foods, Regen Gland at 40 foods, Crown at 50 foods) in real-time.
  4. In-run enemy kills in the active run dynamically unlock kill-based modules (e.g. Ramming Horns at 25 kills, Scattershot at 30 kills, Thorny Spikes T2 at 90 kills, Venom Sprayer T2 at 100 kills) in real-time.
  5. In-run snake growth dynamically unlocks length-based modules (e.g. Magma Vent at scaled Length 250, Plasma Beam at scaled Length 300, Cryo Mortar at scaled Length 350, Nanite Swarm at scaled Length 350) in real-time.
  6. In-run boss defeats and floor progression dynamically unlock boss-gated modules (e.g. Dragon Maw on Floor 1 Centipede defeat, Railgun Flak Cannon on Floor 2 Storm Gorgon defeat, Seeker Needler on Floor 3 Infernal Colossus defeat, Chrono Ward on Floor 5 Chrono Wyrm defeat, Apex Superconductor on Floor 7 for Turret T2) in real-time.
  7. Invoking `ResetRunUnlocks()` explicitly resets all in-run unlocks back to starter defaults, locking previously unlocked non-starter tiers.
  8. Starting a subsequent run via `GameEngine.StartRun()` cleanly clears in-run unlocks while preserving meta-progression (Helmet Vault and Sanctuary upgrades).

---

## 3. Implementation Details (Green Phase)

- **Files Created/Modified:**
  - `src/data/MetaProgression.ts`: Configured `ResetRunUnlocks()` to set `UnlockedTiers` to `{ turret: 1, tesla: 1, venom: 1, shield: 1, spikes: 1, fangs: 1 }` and `CompletedChallenges = {}`. Removed lifetime `meta.Records` fallbacks from all challenge condition closures in `getChallengeFor` and `EvaluateChallenges`, ensuring challenge evaluations evaluate purely against active run `ChallengeContext` (`c`) or `RunSummary` (`s`).
  - `src/tests/InRunResetAndChallengeProgression.test.ts`: Authored comprehensive test suite covering all in-run reset guarantees, lifetime records isolation, real-time unlock triggers, and run transitions.
  - Test suites alignment: Verified `DiverseMixedChallengesAndProgression.test.ts`, `MultiBossEscalationAndFloor20.test.ts`, `DynamicGameboardLengthScaling.test.ts`, `InRunBioLabAndSnakeLengthChallenges.test.ts`, `MutationLabChallengeProgression.test.ts`.

---

## 4. Verification & Quality Check

```bash
npx vitest run src/tests/InRunResetAndChallengeProgression.test.ts
./verify
```
