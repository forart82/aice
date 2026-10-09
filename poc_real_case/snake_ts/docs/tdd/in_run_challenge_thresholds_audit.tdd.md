# Feature TDD Specification: In-Run Challenge Unlock Thresholds Audit & Fine-Tuning

> **Feature Identifier:** `docs/tdd/in_run_challenge_thresholds_audit.tdd.md`  
> **Status:** Green / Verified  
> **Target Directory:** `/home/forart/dev/snake_ts`  
> **Rule Reference:** [`AGENTS.md#rule-2`](file:///home/forart/dev/snake_ts/AGENTS.md) & [`ORACLE.md`](file:///home/forart/dev/snake_ts/ORACLE.md)  

---

## 1. Feature Overview & Requirements

- **High Concept:** Comprehensive audit and calibration of in-run challenge unlock thresholds across Tiers 1, 2, and 3 in `MetaProgression.ts` and `ORACLE.md`.
- **Target Systems:**
  - `src/data/MetaProgression.ts`: In-run challenge conditions, dynamically scaled serpent length gates, food milestones, kill thresholds, combo streaks, and boss defeat triggers.
  - `ORACLE.md`: Single Source of Truth (SSOT) documentation and challenge-gated tier progression tables.
  - `src/data/CodexData.ts` & `src/data/DevChecklistData.ts`: In-game codex and developer checklist challenge descriptions.
- **Pacing & Threshold Matrix:**
  - **Tier 1 (Floors 1–5):**
    - **Starter Defaults (Unlocked Tier 1):** `turret`, `tesla`, `venom`, `shield`, `spikes`, `fangs`.
    - **Length Gates (Scaled 250 Base):** `magma`, `tachyon`, `plasma`, `laser`, `visor`, `cryo`, `nanite` all calibrated to Base Desktop Length 250 (dynamically scaled via `RoundToTen(250 * R)`).
    - **Food Milestones:** `magnet` (30 foods), `regen` (40 foods), `crown` / `crest` (50 foods).
    - **Hostile Kills:** `horns` (25 hostiles), `scattershot` (30 hostiles).
    - **Specific Boss Defeats:** `maw` (Floor 1: Centipede Behemoth), `flak` (Floor 2: Storm Gorgon), `needler` (Floor 3: Infernal Colossus), `chrono` (Floor 5: Chrono Wyrm).
  - **Tier 2 (Floors 6–12):**
    - **Length Gates (Scaled 600–800 Base):** `shield` (600), `maw` (600), `scattershot` (650), `plasma` (800), `nanite` (800).
    - **Food Milestones:** `needler` (100 foods), `regen` (120 foods), `crown` / `crest` (150 foods).
    - **Hostile Kills:** `spikes` (90 hostiles), `venom` (100 hostiles), `laser` / `visor` (110 hostiles).
    - **Combo Streaks:** `magnet` (18x), `fangs` (20x), `tesla` (22x), `flak` (25x).
    - **Boss Milestones & Defeats:** `turret` (Floor 7: Apex Superconductor), `magma` (Floor 8: Astral Leviathan), `cryo` (Floor 10: Shadow Doppelgänger), `chrono` (8 Boss Guardians), `horns` (8 Boss Guardians), `tachyon` (Floor 17: Nanite Hive Titan).
  - **Tier 3 (Floors 13–20+):**
    - **Length Gates (Scaled 1200–1800 Base):** `scattershot` (1200), `shield` (1200), `magma` (1350), `plasma` (1500), `tachyon` (1500), `chrono` (1500), `maw` (1500), `laser` / `visor` (1800).
    - **Food Milestones:** `needler` (220 foods), `regen` (250 foods), `crown` / `crest` (300 foods).
    - **Hostile Kills:** `venom` (200 hostiles), `fangs` (220 hostiles).
    - **Combo Streaks:** `magnet` (35x), `tesla` (40x).
    - **Boss Milestones & Defeats:** `flak` (15 Boss Guardians), `horns` (16 Boss Guardians), `spikes` (18 Boss Guardians), `nanite` (18 Boss Guardians), `turret` (Floor 15: Prismatic Arachnid), `cryo` (Floor 20: The Eternal Ouroboros).
  - **Strict Single-Challenge Invariant:** Every tier enforces strictly ONE single in-run challenge condition without confusing duplicate/alternative requirements.

---

## 2. Test Plan & Assertions (Red Phase)

- **Test Suite Location:** `src/tests/InRunChallengeThresholdsAudit.test.ts` & updated existing test suites.
- **Assertions:**
  1. Verify Tier 1 length requirements are strictly 250 base desktop length for Magma, Tachyon, Plasma, Laser, Visor, Cryo, and Nanite.
  2. Verify Tier 1 food, kill, and specific boss defeat conditions match exact targets.
  3. Verify Tier 2 length (600, 650, 800), food (100, 120, 150), kill (90, 100, 110), combo (18x, 20x, 22x, 25x), and boss targets.
  4. Verify Tier 3 apex thresholds (1200–1800 length, 200–300 food, 200–220 kills, 35x–40x combo, 15–18 bosses, Floor 15 / 20 defeats).
  5. Verify strictly single condition per tier (no multiple or disjunctive requirements in descriptions).

---

## 3. Implementation Details (Green Phase)

- **Files Created/Modified:**
  - `src/data/MetaProgression.ts`: Updated `getChallengeFor` with calibrated Tier 1 length base (250) and verified all Tier 1–3 conditions.
  - `ORACLE.md`: Updated Section 3.11, Section 3.11.1 Matrix Table, and Section 4 Formulas.
  - `src/data/CodexData.ts`: Updated codex descriptions.
  - `src/data/DevChecklistData.ts`: Updated technical analysis.
  - Test suites: Updated existing tests to align with new Tier 1 base 250 length requirements.

---

## 4. Verification & Quality Check

```bash
# 1. Dedicated audit suite (16 tests)
npx vitest run src/tests/InRunChallengeThresholdsAudit.test.ts
# Output: 16 passed (16)

# 2. Strict TypeScript typecheck
npm run typecheck
# Output: 0 errors

# 3. Full Quality Gate Verification (76 test files, 983 tests, production build)
./verify
# Output: 100% PASS — ALL CONFORMANCE TESTS & BUILDS PASSED
```
