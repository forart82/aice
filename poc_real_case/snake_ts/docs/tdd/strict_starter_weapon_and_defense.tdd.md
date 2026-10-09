# Feature TDD Specification: Strict 1-Starter Weapon & 1-Starter Defense Rule

> **Feature Identifier:** `docs/tdd/strict_starter_weapon_and_defense.tdd.md`  
> **Status:** Green  
> **Target Directory:** `/home/forart/dev/snake_ts`  
> **Rule Reference:** [`AGENTS.md#rule-2`](file:///home/forart/dev/snake_ts/AGENTS.md) & [`ORACLE.md`](file:///home/forart/dev/snake_ts/ORACLE.md)  

---

## 1. Feature Overview & Requirements

- **High Concept:** Enforce strictly 1 Starter Weapon (`turret` - Attack Spitter) and 1 Starter Defense (`shield` - Carapace Shield) unlocked at run start (`tier === 1`). Remove `tesla`, `venom`, `spikes`, and `fangs` from starter defaults and assign engaging, balanced Tier 1 in-run challenges.
- **Target Systems:**
  - `src/data/MetaProgression.ts`: `UnlockedTiers`, `UnlockedModules`, `IsTierUnlocked`, `getChallengeFor`, `ResetRunUnlocks`, `Load`/`applySaveData`.
  - `src/platform/SaveIO.ts`: `createDefaultMetaSave`, `validateAndNormalizeV2`.
  - `src/sim/SnakePlayer.ts` & `src/sim/CombatSystem.ts`: In-run challenge tracking and hardpoint validation.
  - `ORACLE.md`: Documentation updates for the single starter weapon / single starter defense rule.
- **Starter Defaults Matrix (Run Start):**
  - Unlocked by default: `turret: 1` (Attack Spitter) and `shield: 1` (Carapace Shield).
  - Locked items assigned Tier 1 challenges:
    - `tesla` (Bio-Arc Coil) [Tier 1]: Maintain a Combo Streak of 8x (`combo >= 8`)
    - `venom` (Venom Sprayer) [Tier 1]: Slay 20 Enemies in a run (`kills >= 20`)
    - `spikes` (Thorny Spikes) [Tier 1]: Slay 10 Armored Scarabs in a run (`scarabs >= 10 || kills >= 10`)
    - `fangs` (Venom Fangs) [Tier 1]: Maintain a Combo Streak of 15x (`combo >= 15`)

---

## 2. Test Plan & Assertions (Red Phase)

- **Test Suite Location:** `src/tests/StrictStarterWeaponAndDefense.test.ts`
- **Assertions:**
  1. `meta.IsTierUnlocked('turret', 1)` returns `true` and `meta.IsTierUnlocked('shield', 1)` returns `true` with zero challenge requirements.
  2. `meta.IsTierUnlocked(id, 1)` returns `false` for `tesla`, `venom`, `spikes`, and `fangs` on fresh run initialization.
  3. `tesla` Tier 1 unlocks when `combo >= 8` (and is locked when `combo < 8`).
  4. `venom` Tier 1 unlocks when `kills >= 20` (and is locked when `kills < 20`).
  5. `spikes` Tier 1 unlocks when `scarabs >= 10` or `killsByType['scarab'] >= 10` or `kills >= 10` (and is locked otherwise).
  6. `fangs` Tier 1 unlocks when `combo >= 15` (and is locked when `combo < 15`).
  7. `meta.ResetRunUnlocks()` resets `UnlockedTiers` strictly to `{ turret: 1, shield: 1 }`.
  8. Challenge descriptions for `tesla` T1, `venom` T1, `spikes` T1, and `fangs` T1 match specifications.

---

## 3. Implementation Details (Green Phase)

- **Files Created/Modified:**
  - `src/data/MetaProgression.ts`: Set `UnlockedModules` and `UnlockedTiers` defaults to `{ turret: 1, shield: 1 }`, updated `ResetRunUnlocks`, `IsTierUnlocked`, and `getChallengeFor` with Tier 1 challenges for `tesla`, `venom`, `spikes`, and `fangs`.
  - `src/platform/SaveIO.ts`: Updated `createDefaultMetaSave` with `unlockedModules: { turret: true, shield: true }` and `unlockedTiers: { turret: 1, shield: 1 }`.
  - `src/sim/SnakePlayer.ts`: Preserved modular hardpoint sockets and cranial lab interfaces.
  - `src/sim/CombatSystem.ts`: Evaluates in-run dynamic challenge unlocks for combat weapons/defenses.
  - `ORACLE.md`: Updated Section 3.11 Roguelite In-Run Reset Rule, Starter Defaults, and Table 3.11.1 Matrix.
  - Test suites updated to conform to strict 1 weapon / 1 defense starter rule.

---

## 4. Verification & Quality Check

```bash
npx vitest run src/tests/StrictStarterWeaponAndDefense.test.ts
./verify
```
All 84 test suites (1065 tests) pass with 100% type check and strict conformance.
