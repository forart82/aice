# Feature TDD Specification: Dynamic Gameboard-to-Length Ratio Scaling & Strict 10ner-Step Rounding

> **Feature Identifier:** `docs/tdd/dynamic_gameboard_length_scaling_and_10ner_rounding.tdd.md`  
> **Status:** Green / Verified  
> **Target Directory:** `/home/forart/dev/snake_ts`  
> **Rule Reference:** [`AGENTS.md#rule-2`](file:///home/forart/dev/snake_ts/AGENTS.md) & [`ORACLE.md`](file:///home/forart/dev/snake_ts/ORACLE.md)  

---

## 1. Feature Overview & Requirements

- **High Concept:** Implements dynamic gameboard-to-length ratio scaling and strict 10ner-step rounding across the meta progression challenge system. Length-based tier unlock challenges adapt dynamically to current arena dimensions relative to the reference desktop arena ($1600 \times 960$, Area = 1,536,000) and round to clean, satisfying multiples of 10 (minimum 10; e.g., 80, 100, 120, 200, 240, 600, 1800; never odd values like 93 or 1834).
- **Target Systems:** `src/data/MetaProgression.ts`, `src/data/CodexData.ts`, `src/data/DevChecklistData.ts`, `ORACLE.md`
- **Mechanics Reference:** [`ORACLE.md#3111`](file:///home/forart/dev/snake_ts/ORACLE.md)

### Mathematical Formulas & Specifications
1. **Strict 10ner-Step Rounding:**
   $$\text{RoundToTen}(v) = \max(10, \lfloor v / 10 \rceil \times 10)$$
2. **Dynamic Gameboard-to-Length Scaling Ratio:**
   $$R = \text{clamp}\left(\frac{\text{ArenaW} \times \text{ArenaH}}{1600 \times 960}, 0.12, 1.0\right)$$
3. **Scaled Length Requirement:**
   $$\text{Req}(\text{baseLength}) = \text{RoundToTen}(\text{baseLength} \times R)$$
4. **Base Desktop Length Calibration:**
   - **Tier 1 (Floors 1–5):** Base Desktop Lengths $\in [250, 350]$ (e.g., Magma: 250, Tachyon: 250, Plasma: 300, Laser/Visor: 300, Cryo: 350, Nanite: 350).
   - **Tier 2 (Floors 6–12):** Base Desktop Lengths $\in [600, 800]$ (e.g., Shield: 600, Maw: 600, Scattershot: 650, Plasma: 800, Nanite: 800).
   - **Tier 3 (Floors 13–20+):** Base Desktop Lengths $\in [1200, 1800]$ (e.g., Scattershot: 1200, Shield: 1200, Magma: 1350, Plasma: 1500, Tachyon: 1500, Chrono: 1500, Maw: 1500, Laser/Visor: 1800).

---

## 2. Test Plan & Assertions (Red Phase)

- **Test Suite Location:** `src/tests/DynamicGameboardLengthScalingAnd10nerRounding.test.ts`
- **Assertions:**
  1. `MetaProgression.RoundToTen(val)` strictly returns multiples of 10 and clamps to at least 10 (e.g. 0 -> 10, 4 -> 10, 8 -> 10, 14 -> 10, 16 -> 20, 93 -> 90, 1834 -> 1830).
  2. `GetScaledLengthRequirement(baseLength, customCtx)` computes correct scaling for Desktop ($1600 \times 960$, $R=1.0$), Default Engine ($960 \times 640$, $R=0.4$), Mobile Portrait ($540 \times 960$, $R=0.3375$), and Clamped Minimum ($360 \times 500$, $R=0.12$).
  3. All scaled length values are guaranteed to be divisible by 10 (`val % 10 === 0`) and $\ge 10$.
  4. Challenge descriptions dynamically reflect the scaled length requirement (e.g. `Grow Serpent to Length 100` on 960x640 vs `Grow Serpent to Length 250` on desktop).
  5. In-run and post-run evaluation unlocks tiers when player length meets or exceeds the dynamically scaled threshold.

---

## 3. Implementation Details (Green Phase)

- **Files Created/Modified:**
  - `src/data/MetaProgression.ts`: Added `RoundToTen`, `GetScaledLengthRequirement`, updated `IsTierUnlocked`, `GetUpgradeChallengeDescription`, `EvaluateChallenges`, and `getChallengeFor`.
  - `src/data/CodexData.ts`: Documented dynamic scaling formula and 10ner rounding.
  - `src/data/DevChecklistData.ts`: Updated `cranial_bio` checklist item.
  - `ORACLE.md`: Updated Section 3.11, 3.11.1, and Section 4 formulas table.
  - `src/tests/DynamicGameboardLengthScalingAnd10nerRounding.test.ts`: New comprehensive test suite.
  - Existing test suites updated for scaled length expectations.

---

## 4. Verification & Quality Check

```bash
npx vitest run src/tests/DynamicGameboardLengthScalingAnd10nerRounding.test.ts
./verify
```
