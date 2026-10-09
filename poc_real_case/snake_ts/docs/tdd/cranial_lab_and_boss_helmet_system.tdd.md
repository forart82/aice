# Feature TDD Specification: Cranial Lab Refactor & Boss Helmet Equipment System

> **Feature Identifier:** `docs/tdd/cranial_lab_and_boss_helmet_system.tdd.md`  
> **Status:** 100% Verified & Complete (Green)  
> **Target Directory:** `/home/forart/dev/snake_ts`  
> **Rule Reference:** [`AGENTS.md#rule-2`](file:///home/forart/dev/snake_ts/AGENTS.md) & [`ORACLE.md`](file:///home/forart/dev/snake_ts/ORACLE.md)  

---

## 1. Feature Overview & Requirements

### 1.1 Cranial Lab Simplification & Head-Only Upgrades
- **Removal of Body Segment Lab Upgrades:** To eliminate cognitive overload and micromanagement at large snake scales (10–50+ segments), the Mutation Lab no longer installs socket modules on individual trailing body segments.
- **Head as Single Tactical Hub:** All upgrades, weapons, defenses, and cranial mutations are installed directly onto the **Head**.
- **Unlimited Modular Capacity:** The head has no rigid socket/places limit; players can acquire and upgrade as many weapon and defense modules as they want.
- **Purchase Cost Escalation:** Each purchase/upgrade increases the XP cost of subsequent upgrades via the formula:
  $$\text{UpgradeCost}(\text{targetLevel}, \text{totalPurchases}) = \text{BaseCost} \times \text{targetLevel} + \text{totalPurchases} \times \text{CostScaling}$$
  where `BaseCost = 35` and `CostScaling = 15` (for modules) or `BaseCost = 40` and `CostScaling = 20` (for cranial augments).
- **Combat Simulation:** All offensive weapons (turrets, tesla coils, magma vents, venom sprayers, tachyon beams, cryo mortars, plasma mortars, flak, etc.) and defensive modules (shields, spikes, regen, magnets, chrono wards, nanites, etc.) fire and activate from the Snake Head position in `CombatSystem`.

### 1.2 Boss Helmets Meta-Progression & Equipment System
- **Boss Loot Drops:** Defeating floor bosses (Centipede Behemoth, Infernal Colossus, Astral Leviathan) generates and awards a procedural **Helmet**.
- **Rarity Tiers:** Helmets roll in 5 rarity tiers:
  1. `common` (1 affix, standard stats)
  2. `uncommon` (2 affixes, +20% roll range)
  3. `rare` (3 affixes, +50% roll range)
  4. `epic` (4 affixes, +90% roll range)
  5. `mythic` (5 affixes, +150% roll range & unique title)
- **Random Stat Modifiers:** Helmets roll random stat bonuses affecting:
  - Max HP bonus (`maxHp`)
  - Armor bonus (`armor`)
  - Speed bonus (`speed`)
  - Bite Power bonus (`bitePower`)
  - Crit Chance bonus (`critChance`)
  - Crit Multiplier bonus (`critMult`)
  - Health Regeneration (`hpRegen`)
  - Starting Shield (`shield`)
  - Magnet Radius (`magnetRadius`)
  - Dash Cooldown Reduction (`dashCooldown`)
  - XP Multiplier (`xpMultiplier`)
  - Shard Multiplier (`shardMultiplier`)
  - Thorns Contact Damage (`thorns`)
- **Permanent Collection & Persistence:** Collected helmets persist across runs and deaths in `MetaProgression` save storage (`SaveIO`).
- **Loadout Selection Before Runs:** Players can browse their helmet collection, inspect stats, and equip a helmet before starting a run (in `ClassSelectScreen`, `MenuScreen`, or dedicated Helmet Vault modal).
- **Head Equipment Rendering:** The equipped helmet is visually represented on the snake's head in `SnakeRenderer` and previewed in the Mutation Lab.

---

## 2. Test Plan & Assertions (Red Phase)

- **Test Suite Location:** `src/tests/CranialLabAndBossHelmets.test.ts`
- **Key Assertions:**
  1. **Helmet Generation & Rarities:**
     - Generates helmets with valid IDs, names, icons, rarities (`common`, `uncommon`, `rare`, `epic`, `mythic`), and non-empty stat pools.
     - Affix counts scale deterministically with rarity (1 for common, 2 for uncommon, 3 for rare, 4 for epic, 5 for mythic).
     - Rarity drop distribution weights shift toward higher tiers on deeper floors.
  2. **Helmet Persistence & MetaProgression:**
     - `MetaProgression.Instance.AddHelmet()` stores helmets into inventory.
     - `MetaProgression.Instance.EquipHelmet()` equips a helmet by ID.
     - `MetaProgression.Instance.Save()` and `Load()` serialize and deserialize helmets correctly across version migrations.
     - Helmets persist after player death and run completion (`CommitRun`).
  3. **Boss Loot Drop Integration:**
     - `GameEngine.OnBossDefeated()` generates a helmet, adds it to `MetaProgression`, and triggers loot feedback event.
  4. **SnakePlayer Helmet Stat Application:**
     - Initializing or equipping `SnakePlayer` with a helmet applies all rolled stat affixes (MaxHp, Armor, Speed, BitePower, CritChance, CritMult, MagnetRadius, DashCooldown, Thorns, Shield).
  5. **Head-Only Lab Mechanics:**
     - Head supports simultaneous installation of multiple offensive modules, defensive modules, and cranial augments.
     - `SnakePlayer.GetHeadModuleCost(moduleKey, nextLevel)` calculates escalated XP prices based on `HeadPurchaseCount`.
     - Purchasing an upgrade increments `HeadPurchaseCount` and scales subsequent upgrade prices.
     - Lab UI exclusively presents Head Arsenal & Cranial Augmentations, omitting body segment socket tabs.
  6. **Head Combat System Execution:**
     - Head-installed weapons (turrets, tesla, magma, venom, tachyon, etc.) fire and trigger properly from the head position `(px, py)`.
     - Head-installed defenses (shield, spikes, regen, magnet, chrono, nanite) protect and buff the snake head.
  7. **UI Helmet Selection Conformance:**
     - `ClassSelectScreen` and `HelmetVaultScreen` allow viewing collected helmets, filtering/inspecting stats, and toggling active equipment before run start.

---

## 3. Implementation Details (Green Phase)

- **Files Created/Modified:**
  - `src/data/Types.ts`: Added `HelmetRarity`, `HelmetStats`, `HelmetDef`, `AlchemicalFusionDef`.
  - `src/data/Helmets.ts`: Procedural generator for boss helmets with name/icon/rarity tables, stat formatting, rarity color mappings.
  - `src/data/MetaProgression.ts`: Persistent helmet inventory, equipped helmet ID, save/load migrations, helmet normalization.
  - `src/sim/SnakePlayer.ts`: Head module registry, `HeadPurchaseCount`, price escalation formulas, equipped helmet stat bindings.
  - `src/sim/CombatSystem.ts`: Execute offensive and defensive modules from head.
  - `src/sim/GameEngine.ts`: Drop helmets on boss defeat with loot banner/sound.
  - `src/render/SnakeRenderer.ts`: Visual rendering of equipped helmet/crest on serpent head.
  - `src/ui/screens/SnakeLabScreen.ts`: Redesigned Head Tactical Lab with scaled purchase costs and equipped helmet display.
  - `src/ui/screens/ClassSelectScreen.ts`: Helmet Vault equipment loadout selector.
  - `ORACLE.md`: Synchronized single source of truth documentation (Sections 3.11 & 3.12).

---

## 4. Verification & Quality Check Results

- **`src/tests/CranialLabAndBossHelmets.test.ts`:** 19/19 tests PASS (100%)
- **`src/tests/MutationLabAndDamageFeedback.test.ts`:** 18/18 tests PASS (100%)
- **`src/tests/SelfTest.test.ts`:** 23/23 conformance matrix tests PASS (100%)
- **`src/tests/SegmentHealthAndXp.test.ts`:** 22/22 segment & head vitals tests PASS (100%)
- **`src/tests/UiLayoutAudit.test.ts`:** 55/55 responsive layout tests PASS (100%)
- **`src/tests/ParityTest.test.ts`:** 15/15 golden replay traces PASS (100%)
- **TypeScript Typecheck:** `tsc --noEmit` 100% PASS (Zero Errors)
- **Production Build:** `vite build` 100% PASS
- **Dev Server:** Live and healthy on `http://localhost:3000/` (or `http://localhost:3001/`) with Hot Module Replacement (HMR).
