# Deep Scan Report — 2026-06-21

This report presents the findings of a comprehensive codebase scan of the **dogMax** project (spanning `src/`, `configs/`, `assets/`, and `tests/`) for bugs, unused/dead code, dead files, and dead config files/keys. These findings have been cross-referenced with the recent audit document: [2026-06-21-2day-audit.md](file:///home/forart/dev/dogMax/docs/audit/2026-06-21-2day-audit.md).

---

## 1. Bugs & Rule Violations

We verified several code and architectural issues, confirming their status relative to the 2-day audit recommendations:

### A. EnemyTemplateWriter Shape & Layer Serialization (Resolved)
- **Problem**: Previously, saving an enemy via the `Ctrl+E` editor only serialized tier-specific `bodySize` and `outline` settings. Detailed tier-specific overrides (`bodyShape`, `fill`, and `layers`) were silently lost on reload.
- **Verification**: We audited `src/render/EnemyTemplateWriter.cpp`. In `writeTierOverride`, the template writer now checks all fields against the common base:
  ```cpp
  bool tierDiffers(const EnemyTierDesign& tier, const EnemyTierDesign& base) {
      return tier.bodyShape != base.bodyShape || tier.bodySize != base.bodySize
          || tier.outline != base.outline || tier.fill != base.fill
          || layersDiffer(tier.layers, base.layers);
  }
  ```
  It successfully outputs tier-prefixed overrides (`ENEMY_UNCOMMON_...` and `ENEMY_RARE_...`) for shapes, sizes, outlines, fills, and custom layers. This round-trip capability is verified by the unit tests in `tests/render/test_EnemyTemplateWriter.cpp`.

### B. ConfigLoader Preserve-Reload Behavior (Resolved)
- **Problem**: The `loadDirectoryPreservingOverrides` method previously functioned identically to `loadDirectory` because it did not correctly respect the manual override set, clobbering console-tuned configurations.
- **Verification**: In `src/loaders/ConfigLoader.cpp`, the distinction is now clear:
  - `loadDirectory` clears the override set (`overriddenKeys.clear()`), forcing a clean baseline load from disk.
  - `loadDirectoryPreservingOverrides` leaves `overriddenKeys` intact, allowing manually edited variables to survive across reloading.
  This behavior is verified by the test coverage in `tests/loaders/test_ConfigLoader.cpp`.

### C. WeaponMaker vs DiceMaker Quality Rounding (Open Discrepancy)
- **Problem**: Discrepancy in calculating overall quality scores between weapons and dice:
  - **Weapons** (`src/makers/WeaponMaker.cpp:184`): Uses round-half-up:
    ```cpp
    const int overallQ = (qDamage + qAps + qRange + qCritMult + qCritChance + 2) / 5;
    ```
  - **Dice** (`src/makers/DiceMaker.cpp:179`): Uses truncation (round-down):
    ```cpp
    const int qualityScore = (qDmg + qCrit + qCritChance + qLuck + qEvasion) / 5;
    ```
- **Status**: This issue remains open/deferred to avoid shifting tier-boundary balance without explicit game balance review.

### D. File Length Rules (Rule Violation)
- **Violation**: The file limit rule of 500 lines is exceeded by one file:
  - `src/managers/EnemyManager.cpp` = **506 lines** (6 lines over limit).
- **Status**: To be refactored/split on the next active edit of enemy management logic. All other source files sit safely under the 500-line limit.

### E. Hardcoded Config Literals (Rule Violation)
- **Violation**: Several user-facing visual and layout elements remain hardcoded in C++ source rather than being delegated to configuration YAML files:
  - **Debug Tab Colors**: In `src/render/ConfigTab.cpp` and `src/render/PerformanceTab.cpp`, panel and text colors (e.g., `sf::Color{20, 20, 28, 220}`) are hardcoded.
  - **WorldRenderer VFX Parameter Literals**: In `src/render/WorldRenderer.cpp:227-287`, color and timing values for jump shadows, berserk aura pulses, leap target telegraphs, and landing shockwaves (e.g., telegraph circles coloring `sf::Color(255, 220, 0, alpha)`) are hardcoded.
  - **Inventory Colors**: Hardcoded colors and slot dimensions are still present inside `InventoryRenderer.cpp`.

---

## 2. Unused / Dead Code

We scanned all classes, structs, and functions in `src/` for dead logic.

### A. Active Evasion Mechanic (`combat/ActiveEvasion.hpp`)
- **Dead Logic**: `ActiveEvasion.hpp` contains `activeEvasionChance(...)`.
- **References**:
  - Included **0** times in production C++ files.
  - Only referenced in `tests/combat/test_ActiveEvasion.cpp` for unit verification.
- **Root Cause**: The Active Evasion skill-tap mechanic is currently unwired in production. The spacebar is bound to the movement dash.
- **Status**: The header remains in the repository as dead code until a decision is made to either wire it or remove it entirely.

---

## 3. Unused / Dead Files

We scanned all file systems under the target scope:

- **E2E Scenarios**: We verified that `tests_e2e/scenarios/52_beacon_poi.py` (which checked the deprecated beacon system) has been deleted.
- **Assets**: `assets/ui/inventory_proto.png` has been removed.
- **Source / Header Files**: No production `.cpp` or `.hpp` files are orphaned. The only unused file is the dead header `src/combat/ActiveEvasion.hpp` identified in §2.
- **Stray Artifacts**: The stray build files `GameSession_Events.dwo` and `GameSession_Events.o` in the repository root have been removed.

---

## 4. Unused / Dead Config Files & Keys

By mapping all YAML keys defined under `configs/` against string-literal queries and dynamic key patterns in the production codebase, we verified the following config states:

### A. Dead Config Files
- `configs/nexus.yaml` was confirmed to be **deleted** (whole file dead, 0 readers).

### B. Unused Keys in `configs/evasion.yaml`
- `ACTIVE_EVASION_WINDOW`
- `ACTIVE_EVASION_BONUS`
- *Reason*: These keys are defined but only read inside unit tests; they have no production code references due to the unwired Active Evasion mechanic.

### C. Unused Keys in `configs/inventory.yaml`
The inventory renderer rewrite left the following 34 config keys completely unread:
- `INVENTORY_PANEL_BG_ALPHA`
- `INVENTORY_SLOT_BG_R`/`G`/`B`/`ALPHA`
- `INVENTORY_SLOT_OUTLINE_R`/`G`/`B`/`A`
- `INVENTORY_DRAG_CURSOR_OFFSET_X`/`Y`
- `INVENTORY_SLOT_TIER_TINT_ALPHA`
- `INVENTORY_SLOT_TIER_OUTLINE_THICKNESS`
- `INVENTORY_SLOT_TIER_OUTLINE_ALPHA`
- `INVENTORY_POWDER_STACK_ROW_HEIGHT`
- `INVENTORY_POWDER_STACK_SWATCH_SIZE`
- `INVENTORY_SORT_BUTTON_BG_R`/`G`/`B`/`ALPHA`
- `INVENTORY_POWDER_HEADER_FONT_SIZE`
- `INVENTORY_POWDER_HEADER_R`/`G`/`B`
- `INVENTORY_POWDER_TOTAL_FONT_SIZE`
- `INVENTORY_POWDER_TOTAL_R`/`G`/`B`
- `INVENTORY_POWDER_STACK_NAME_FONT_SIZE`
- `INVENTORY_POWDER_STACK_COUNT_FONT_SIZE`
- `INVENTORY_COUNT_BADGE_FONT_SIZE`
- `INVENTORY_EQUIPPED_BADGE_SIZE`
- `INVENTORY_TITLE_DIAMOND_SIZE`/`GAP`

### D. False-Positive Keys (Verified Active)
Some keys are reported as unused by simple literal scanning but are actually accessed via dynamic formatting:
- **XP Scaling Keys** (`configs/xp.yaml`): Keys like `HERO_XP_LEVEL_1` through `HERO_XP_LEVEL_99` are dynamically resolved in `Levelable.cpp:14` (`"HERO_XP_LEVEL_" + std::to_string(level)`). They are all active.
- **Weapon Gallery Shapes** (`configs/weapon_shapes_gallery.yaml`): Keys starting with `WG_NN_` are resolved dynamically in `ComponentShowcaseRenderer.cpp:84` and are active.
- **Enemy Catalog Shapes** (`configs/enemy_shapes.yaml`): Keys starting with `SHAPE_NN_` are resolved dynamically in `EnemyShapeCatalog.cpp:131` and are active.
- **Theme UI Colors** (`configs/theme.yaml`): Keys like `UIR_CHIP_FILL_ALPHA` are resolved dynamically via utility color parsers such as `readRgba(config, "UIR_CHIP_FILL")` which construct the `_ALPHA` suffix at runtime. They are active.
