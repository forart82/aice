# Feature TDD Specification: 8 Unique Helmets, Galaxy Jump Sacrifice & 9th Omni-Helmet Synthesis Engine

> **Feature Identifier:** `docs/tdd/galaxy_jump_and_unique_helmets.tdd.md`  
> **Status:** Green  
> **Target Directory:** `/home/forart/dev/snake_ts`  
> **Rule Reference:** [`AGENTS.md#rule-2`](file:///home/forart/dev/snake_ts/AGENTS.md), [`AGENTS.md#rule-3`](file:///home/forart/dev/snake_ts/AGENTS.md) & [`ORACLE.md`](file:///home/forart/dev/snake_ts/ORACLE.md)  

---

## 1. Feature Overview & Requirements

- **High Concept:**
  - Standard boss helmets collected during roguelike runs can be sacrificed via the "Galaxy Jump" transcendence ritual.
  - All standard helmets in the sacrifice are destroyed from `meta.Helmets`.
  - A sacrifice score is calculated from the count and rarities of sacrificed helmets.
  - Galaxy Jump rolls probability $P = 1 - e^{-\text{score} / 800}$. On success, awards an unowned Unique Helmet from the 8-helmet pool and adds its ID to `meta.UniqueHelmets`.
  - When all 8 Unique Helmets are unlocked (`UniqueHelmets.length === 8`), the 9th Omni-Helmet ("The Celestial Crown of the Eternal Ouroboros") can be forged, combining all stats and special capacities of the 8 unique helmets.
  - If the player loses the final trial (Boss Rush defeat), all 8 unique helmets are wiped back to 0 (`resetUniqueHelmets()`).
- **Target Systems:**
  - `src/data/UniqueHelmetsData.ts`: Definitions of the 8 Unique Helmets and the 9th Omni-Helmet synthesis factory (`forgeOmniHelmet()`).
  - `src/data/MetaProgression.ts`: `UniqueHelmets: string[] = []`, `Has9thHelmet: boolean = false`, `galaxyJump()`, `canForge9thHelmet()`, `forge9thHelmet()`, `resetUniqueHelmets()`, `serialize()`, `deserialize()`.
  - `src/platform/SaveIO.ts`: `MetaSaveV2` schema extension with migration fallback for `uniqueHelmets` and `has9thHelmet`.
  - `src/tests/GalaxyJumpAndUniqueHelmets.test.ts`: Comprehensive TDD unit and integration test suite.
- **Mechanics Reference:** [`ORACLE.md#section-3.12`](file:///home/forart/dev/snake_ts/ORACLE.md)

---

## 2. Test Plan & Assertions (Red Phase)

- **Test Suite Location:** `src/tests/GalaxyJumpAndUniqueHelmets.test.ts`
- **Assertions:**
  1. `UniqueHelmetsData` exposes 8 unique helmets with unique IDs, names, icons, lore, stats, and special capacities.
  2. `CELESTIAL_OUROBOROS_HELMET` (or `forgeOmniHelmet()`) synthesizes the 9th Omni-Helmet with summed stats across all 8 helmets.
  3. Sacrifice value calculation accurately scales with count and helmet rarities (`common`, `uncommon`, `rare`, `epic`, `legendary`, `mythic`).
  4. `galaxyJump()` completely destroys/removes sacrificed helmets from `meta.Helmets` (and un-equips if equipped).
  5. `galaxyJump()` respects the exponential probability curve $P = 1 - e^{-\text{score} / 800}$, awarding an unowned Unique Helmet on success.
  6. Repeated successful galaxy jumps never award duplicate unique helmets, properly exhausting the 8-helmet pool.
  7. `canForge9thHelmet()` returns false when `< 8` unique helmets are unlocked, and true when exactly 8 unique helmets are unlocked.
  8. `forge9thHelmet()` sets `Has9thHelmet = true` and returns the omni-helmet with combined stats.
  9. `resetUniqueHelmets()` wipes all unlocked unique helmets back to `[]`, resets `Has9thHelmet` to false, and clears equipped helmet if it was unique.
  10. `serialize()` and `deserialize()` preserve `UniqueHelmets` and `Has9thHelmet` with robust backward-compatibility fallback migrations.

---

## 3. Implementation Details (Green Phase)

- **Files Created/Modified:**
  - `src/data/UniqueHelmetsData.ts`:
    - Defined 8 Unique Helmets (`UNIQUE_HELMETS`): `unique_helm_chrono_singularity`, `unique_helm_adamantine_juggernaut`, `unique_helm_abyssal_leviathan`, `unique_helm_solar_archon`, `unique_helm_nanite_hivequeen`, `unique_helm_volcanic_chimera`, `unique_helm_tempest_siren`, `unique_helm_prismatic_monolith`.
    - Defined `SACRIFICE_RARITY_VALUES`: mapping rarities (`common: 25`, `uncommon: 60`, `rare: 120`, `epic: 250`, `legendary: 400`, `mythic: 600`).
    - Implemented `calculateSacrificeScore(helmets)`.
    - Implemented `combineHelmetStats(helmets)`.
    - Implemented `forgeOmniHelmet()` constructing "The Celestial Crown of the Eternal Ouroboros" (`CELESTIAL_OUROBOROS_HELMET`).
  - `src/data/MetaProgression.ts`:
    - Added `UniqueHelmets: string[] = []` and `Has9thHelmet: boolean = false` with uppercase and lowercase accessors.
    - Implemented `galaxyJump(helmetsToSacrifice?: HelmetDef[], customRng?: Rng)` destroying sacrificed helmets and rolling probability $P = 1 - e^{-\text{score} / 800}$.
    - Implemented `canForge9thHelmet(): boolean`.
    - Implemented `forge9thHelmet(): UniqueHelmetDef`.
    - Implemented `resetUniqueHelmets(): void`.
    - Implemented `serialize(): string` and `deserialize(payload)` with fallback migration.
    - Updated `EquipHelmet` and `GetEquippedHelmet` to support unique helmets and the 9th Omni-Helmet.
    - Added `Ouro` and `PrestigeMultiplier` tracking, `SpendOuro()`, and `AddOuro()`.
    - Integrated Consolation Stardust Bonus ($\text{Ouro} += \lfloor S \times 2.5 \rfloor, \text{Shards} += \lfloor S / 20 \rfloor$) on failure.
    - Integrated Ascendant Crucible Surge ($+10,000 \text{ Ouro}, +500 \text{ Shards}$) when unowned pool is exhausted.
    - Added `isUniqueHelmetOwned()` helper and canonical ID resolution.
  - `src/platform/SaveIO.ts`:
    - Updated `MetaSaveV2` schema with `uniqueHelmets?: (HelmetDef | string)[]`, `has9thHelmet?: boolean`, `ouro?: number`, and `prestigeMultiplier?: number`.
    - Initialized defaults in `createDefaultMetaSave()`.
  - `src/tests/GalaxyJumpAndUniqueHelmets.test.ts`:
    - 19 comprehensive unit and integration tests covering all requirements, probability rolls, no-duplicate guarantees, synthesis, wipe on defeat, save migration, canonical ID resolution, prestige multiplier calculations, consolation bonuses, and persistent shard retention.

---

## 4. Verification & Quality Check

```bash
npx vitest run src/tests/GalaxyJumpAndUniqueHelmets.test.ts
# Result: 19 passed (19) in 35ms

npx vitest run src/tests/SerpentineApexBosses.test.ts src/tests/GalaxyJumpAndUniqueHelmets.test.ts src/tests/BossRushGauntlet.test.ts
# Result: 27 passed (27) in 177ms

./verify
# Result: 155 test files passed (155/155), 2029 tests passed (2029/2029), 100% Quality Gate PASS.
```
