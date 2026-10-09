# Feature TDD Specification: Diverse Mixed-Up Single Challenges per Tier & 20-Floor Multi-Boss Escalation

> **Feature Identifier:** `docs/tdd/diverse_mixed_challenges_and_twenty_floor_progression.tdd.md`  
> **Status:** Complete / Verified (Green Phase — 100% Quality Gate PASS)  
> **Target Directory:** `/home/forart/dev/snake_ts`  
> **Rule Reference:** [`AGENTS.md#rule-2`](file:///home/forart/dev/snake_ts/AGENTS.md) & [`ORACLE.md`](file:///home/forart/dev/snake_ts/ORACLE.md)  

---

## 1. Feature Overview & Requirements

- **High Concept:** Transform the challenge system into a geometrically calibrated, smoothly paced progression matrix across all 21 tactical modules and cranial augments based on the physical arena-to-length ratio ($d_{\text{segment}} = 15\text{ px}$, Arena $540 \times 960\text{ px}$). Enforce exactly one single challenge condition per tier across food collection (`foods >= X`), enemy kills (`kills >= X`), boss kills (`bosses >= X`), specific boss defeats (Floors 1, 2, 3, 5, 7, 8, 10, 15, 17, 20), combo streaks (`combo >= X`), and serpent length (`length >= X`).
- **Geometric Pacing Structure:**
  - **Tier 1 (Floors 1–5):** Lengths 25 to 40 (375px–600px; Tachyon: 25, Magma: 25, Plasma/Laser: 30, Cryo: 35, Nanite: 40; 30–50 foods, 20–40 kills, Floor 1–3 bosses; starter defaults unlocked).
  - **Tier 2 (Floors 6–12):** Lengths 60 to 100 (900px–1500px; Shield: 60, Maw: 60, Scattershot: 65, Plasma: 80, Nanite: 100; 18x–25x combos, 60–120 kills, 80–150 foods, 4–8 bosses).
  - **Tier 3 (Floors 13–20+ Apex):** Lengths 120 to 180 max (1800px–2700px; Scattershot: 100, Shield: 120, Magma: 135, Plasma/Chrono/Tachyon/Maw: 150, Laser/Visor: 180; 30x–40x combos, 150–250 kills, 200–300 foods, 12–18 bosses / F20).
- **Target Systems:**
  - `src/data/MetaProgression.ts`: Geometrically calibrated single-condition challenge definitions & evaluation logic.
  - `ORACLE.md`: Authoritative SSOT update for the geometric arena-to-length ratio formula, 20-floor progression, multi-boss escalation rule (Floors 21+), and 21-upgrade challenge matrix.
  - `src/data/CodexData.ts`: In-game galactic guide entries covering all 20 bosses, geometric arena ratio formulas, and challenge-gated cranial lab unlocks.
  - `src/data/DevChecklistData.ts`: Dev checklist synchronization for geometric arena ratio calibration and single-condition challenge matrices.

---

## 2. Test Plan & Assertions (Red Phase)

- **Test Suite Location:** `src/tests/DiverseMixedChallengesAndProgression.test.ts`
- **Assertions:**
  1. Starter defaults (`turret`, `tesla`, `venom`, `shield`, `spikes`, `fangs`) are unlocked at Tier 1 with `null` challenge.
  2. Diverse Tier 1 challenges unlock upon achieving specific criteria:
     - `maw` Tier 1 unlocks on Floor 1 Centipede defeat (`floor >= 2` or `bosses >= 1`).
     - `flak` Tier 1 unlocks on Floor 2 Gorgon defeat (`floor >= 3` or `bosses >= 2`).
     - `needler` Tier 1 unlocks on Floor 3 Colossus defeat (`floor >= 4` or `bosses >= 3`).
     - `chrono` Tier 1 unlocks on Floor 5 Chrono Wyrm defeat (`floor >= 6` or `bosses >= 5`).
     - `regen` Tier 1 unlocks on collecting 40 foods (`foods >= 40`).
     - `magnet` Tier 1 unlocks on collecting 30 foods (`foods >= 30`).
     - `horns` Tier 1 unlocks on slaying 25 enemies (`kills >= 25`).
     - `scattershot` Tier 1 unlocks on slaying 30 enemies (`kills >= 30`).
     - `magma` / `tachyon` Tier 1 unlock on reaching Length 25 (`length >= 25`).
     - `plasma` / `laser` Tier 1 unlock on reaching Length 30 (`length >= 30`).
     - `cryo` Tier 1 unlocks on reaching Length 35 (`length >= 35`).
     - `nanite` Tier 1 unlocks on reaching Length 40 (`length >= 40`).
  3. Diverse Tier 2 challenges unlock upon mid-game criteria:
     - `turret` Tier 2 unlocks on Floor 7 Superconductor defeat (`floor >= 8` or `bosses >= 7`).
     - `magma` Tier 2 unlocks on Floor 8 Leviathan defeat (`floor >= 9` or `bosses >= 8`).
     - `cryo` Tier 2 unlocks on Floor 10 Doppelgänger defeat (`floor >= 11` or `bosses >= 10`).
     - `tachyon` Tier 2 unlocks on Floor 17 Nanite Titan defeat (`floor >= 18` or `bosses >= 17`).
     - `tesla` Tier 2 unlocks on maintaining 22x combo (`combo >= 22`).
     - `fangs` Tier 2 unlocks on maintaining 20x combo (`combo >= 20`).
     - `flak` Tier 2 unlocks on maintaining 25x combo (`combo >= 25`).
     - `magnet` Tier 2 unlocks on maintaining 18x combo (`combo >= 18`).
     - `venom` Tier 2 unlocks on slaying 100 enemies (`kills >= 100`).
     - `spikes` Tier 2 unlocks on slaying 90 enemies (`kills >= 90`).
     - `laser` Tier 2 unlocks on slaying 110 enemies (`kills >= 110`).
     - `shield` / `maw` Tier 2 unlock on reaching Length 60 (`length >= 60`).
     - `scattershot` Tier 2 unlocks on reaching Length 65 (`length >= 65`).
     - `plasma` Tier 2 unlocks on reaching Length 80 (`length >= 80`).
     - `nanite` Tier 2 unlocks on reaching Length 100 (`length >= 100`).
     - `needler` Tier 2 unlocks on collecting 100 foods (`foods >= 100`).
     - `regen` Tier 2 unlocks on collecting 120 foods (`foods >= 120`).
     - `crown` Tier 2 unlocks on collecting 150 foods (`foods >= 150`).
     - `chrono` / `horns` Tier 2 unlock on defeating 8 boss guardians (`bosses >= 8`).
  4. Diverse Tier 3 challenges unlock upon endgame masteries:
     - `turret` Tier 3 unlocks on Floor 15 Prismatic Arachnid defeat (`floor >= 16` or `bosses >= 15`).
     - `cryo` Tier 3 unlocks on Floor 20 Eternal Ouroboros defeat (`floor >= 21` or `bosses >= 20` or `victory`).
     - `tesla` Tier 3 unlocks on maintaining 40x combo (`combo >= 40`).
     - `magnet` Tier 3 unlocks on maintaining 35x combo (`combo >= 35`).
     - `venom` Tier 3 unlocks on slaying 200 enemies (`kills >= 200`).
     - `fangs` Tier 3 unlocks on slaying 220 enemies (`kills >= 220`).
     - `flak` Tier 3 unlocks on defeating 15 boss guardians (`bosses >= 15`).
     - `horns` Tier 3 unlocks on defeating 16 boss guardians (`bosses >= 16`).
     - `spikes` / `nanite` Tier 3 unlock on defeating 18 boss guardians (`bosses >= 18`).
     - `scattershot` Tier 3 unlocks on reaching Length 100 (`length >= 100`).
     - `shield` Tier 3 unlocks on reaching Length 120 (`length >= 120`).
     - `magma` Tier 3 unlocks on reaching Length 135 (`length >= 135`).
     - `plasma` / `chrono` / `tachyon` / `maw` Tier 3 unlock on reaching Length 150 (`length >= 150`).
     - `laser` Tier 3 unlocks on reaching Length 180 (`length >= 180`).
     - `needler` Tier 3 unlocks on collecting 220 foods (`foods >= 220`).
     - `regen` Tier 3 unlocks on collecting 250 foods (`foods >= 250`).
     - `crown` Tier 3 unlocks on collecting 300 foods (`foods >= 300`).
  5. Each upgrade tier has strictly **ONE SINGLE** challenge description and condition.
  6. Post-run batch evaluation via `evaluateChallenges(summary)` correctly unlocks unlocked tiers in persistence.

---

## 3. Implementation Details (Green Phase)

- **Files Modified:**
  - `src/data/MetaProgression.ts`: Authoritative 21-upgrade single-condition challenge matrix implementation with `ignoreRecordsFallback` parameter for isolated custom context test assertions.
  - `ORACLE.md`: Authoritative SSOT update for 21-upgrade diverse single-condition challenges and 20 Apex Bosses with multi-boss horde escalation on Floors 21+.
  - `src/data/CodexData.ts`: Codex guide synchronized with 20 Apex Bosses and diverse single-condition cranial unlocks.
  - `src/data/DevChecklistData.ts`: Audit checklist synchronized with multi-boss escalation and single-condition challenge matrices.
  - `src/tests/DiverseMixedChallengesAndProgression.test.ts`: Dedicated unit test suite with 6 comprehensive test specifications.
  - `src/tests/MultiBossEscalationAndFloor20.test.ts`: Updated section 5 assertions to validate the single-condition matrix.

---

## 4. Verification & Quality Check

```bash
./verify
```

### Execution Results:
- **TypeScript Typecheck (`tsc --noEmit`):** Clean (0 errors).
- **Vitest Conformance Suites:** 56 test files passed, 741 tests passed (100% PASS).
- **Vite Production Bundle:** Built cleanly with 0 errors.
- **Result:** 🎉 QUALITY GATE: 100% PASS — ALL CONFORMANCE TESTS & BUILDS PASSED
