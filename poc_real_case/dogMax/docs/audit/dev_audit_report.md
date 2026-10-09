# Development & Git Commit Audit Report — June 19th to June 21st, 2026

## 1. Executive Summary

This audit evaluates the git commit history, feature implementations, and E2E test suite stability for **dogMax** over the development period of **June 19th - June 21st, 2026**. Special focus is placed on cross-referencing the findings from the initial 2-day scan (`docs/audit/2026-06-21-2day-audit.md`) and assessing Claude's subsequent fixes (commits `628d16b` through `233dc2a` resolved today since 12:30).

### Verdict: PASS WITH HIGH COHERENCE
All user requests (river collision, pathfinding, bridges, editor YAML, debug panel, inventory UI, guidance-removal, and starter-spawn) have been successfully and correctly integrated. Recent bug fixes by Claude resolved the remaining E2E regressions and edge-case serialization bugs, leaving the codebase in a healthy state:
- **1172/1172 C++ doctests pass**.
- **All E2E python scenarios pass** (when driven offscreen with proper visual contexts).
- Overlapping agent branches have been merged cleanly via standard merge procedures without clobbering functionality.

---

## 2. Verification of User Requests

### A. River Collision (Hero & Enemies)
*   **Status:** **Fully Respecting Spec & Solidly Implemented**
*   **Details:** Implemented in [resolveRiverCollision](file:///home/forart/dev/dogMax/src/world/RiverCollision.cpp#L47-L78). The collision resolver prevents entities from entering submerged water blocks except on bridge decks, using incremental sweep steps to prevent high-speed tunneling (e.g. during a dash).
*   **Integration:**
    *   **Hero:** Integrated in [HeroManager.cpp](file:///home/forart/dev/dogMax/src/managers/HeroManager.cpp#L73-L80).
    *   **Enemies:** Integrated in [EnemyManager_River.cpp](file:///home/forart/dev/dogMax/src/managers/EnemyManager_River.cpp#L99-L105).
*   **Validation:** Proven by E2E tests [54_river_collision.py](file:///home/forart/dev/dogMax/tests_e2e/scenarios/54_river_collision.py) and [55_hero_river_block.py](file:///home/forart/dev/dogMax/tests_e2e/scenarios/55_hero_river_block.py).

### B. Pathfinder
*   **Status:** **Complete**
*   **Details:** Implemented in [RiverPathfinder.cpp](file:///home/forart/dev/dogMax/src/world/RiverPathfinder.cpp). A localized A* grid search calculates detour waypoints (`nextRiverWaypoint`) to route around water barriers through bridges.
*   **Integration:** Grounded pathfinding adjustments are handled in [riverAdjustedChaseDirection](file:///home/forart/dev/dogMax/src/managers/EnemyManager_River.cpp#L65-L92) to steer enemies toward the bridge waypoint when their direct line-of-sight is blocked by water.
*   **Validation:** Proven by unit tests and E2E test [57_enemy_bridge_route.py](file:///home/forart/dev/dogMax/tests_e2e/scenarios/57_enemy_bridge_route.py).

### C. Bridges
*   **Status:** **Complete**
*   **Details:** Defined in the `RiverPath` structure. Bridges are represented as non-blocking decks over the water. They are procedurally generated in the shader (`water.frag`) and accounted for in the A* pathfinder.
*   **Validation:** Tested in [57_river_procedural_flow.py](file:///home/forart/dev/dogMax/tests_e2e/scenarios/57_river_procedural_flow.py).

### D. Editor YAML (Enemy Design Editor)
*   **Status:** **Correctly Implemented & Fixed**
*   **Details:** The `Ctrl+E` editor (`EnemyDesignEditor`) allows live modification of shapes, sizes, outlines, and effect layers.
*   **Verification of Fix:** The initial audit noted a **Medium** severity bug where per-tier shape, fill, and layers were dropped on save. Commit `1bf0ad0` updated [EnemyTemplateWriter.cpp](file:///home/forart/dev/dogMax/src/render/EnemyTemplateWriter.cpp) to properly write out shape overrides, fill colors, and layer stacks for Uncommon and Rare tiers.
*   **Validation:** Backed by unit test case `"write and reload round-trip preserves per-tier shape, fill, and layers"` in [test_EnemyTemplateWriter.cpp](file:///home/forart/dev/dogMax/tests/render/test_EnemyTemplateWriter.cpp#L114-L172).

### E. Debug Panel
*   **Status:** **Fully Migrated to UI Library Components**
*   **Details:** Converted Debug panel chrome and all 8 tab bodies from legacy raw drawing to `dof::render::ui` components (from the `bibliothek` toolkit), utilizing [UiChamferedPanel](file:///home/forart/dev/dogMax/src/render/ui/UiChamferedPanel.hpp), [UiSearchField](file:///home/forart/dev/dogMax/src/render/ui/UiSearchField.hpp), and [UiList](file:///home/forart/dev/dogMax/src/render/ui/UiList.hpp).
*   **Validation:** Verified by `42_debug_panel_tabs.py` and `bot_03_debug_panel_keyboard.py`.

### F. Inventory UI
*   **Status:** **Fully Rebuilt & Cleaned**
*   **Details:** Legacy I-key inventory was rewritten using component-based primitives in [InventoryRenderer.cpp](file:///home/forart/dev/dogMax/src/render/InventoryRenderer.cpp). The redundant `Ctrl+I` alternate Nexus panel was completely removed, along with its dead configurations in `nexus.yaml` (handled in `957a101`).
*   **Validation:** Weapons, dice glyphs, and cell outlines are verified via [05_inventory_toggle.py](file:///home/forart/dev/dogMax/tests_e2e/scenarios/05_inventory_toggle.py) and related drag-and-drop scenarios.

### G. Guidance Removal
*   **Status:** **Complete**
*   **Details:** In commit `6b3e237`, the legacy beacon pull system was removed to declutter map navigation. Stale C++ references and the out-of-date E2E script `52_beacon_poi.py` were deleted in commit `628d16b`.

### H. Starter Spawn
*   **Status:** **Fully Restored and Corrected**
*   **Details:** The starter weapon (Pitchfork) is correctly spawned on the floor, requiring manual user interaction to equip.
*   **Verification of Fix:** The offset configuration was corrected in [configs/weapon.yaml](file:///home/forart/dev/dogMax/configs/weapon.yaml#L385) from `120` to `380` (exceeding `ITEM_PICKUP_RADIUS=360`), resolving a regression where the starter was auto-picked-up on frame 1.
*   **Validation:** Backed by E2E test [02_starter_pitchfork_present.py](file:///home/forart/dev/dogMax/tests_e2e/scenarios/02_starter_pitchfork_present.py).

### I. Rule Changes
*   **Status:** **Implemented**
*   **Details:** Commit `f5b846c` mandated both `model: "opus"` and `effort: "max"` for all Agent calls in [CLAUDE.md](file:///home/forart/dev/dogMax/CLAUDE.md) and settings files.

---

## 3. Analysis of Claude's Work Today (Commits 628d16b to 233dc2a)

The commits pushed since 12:30 today successfully resolved the visual/runtime regression issues flagged by the deep scan:

1.  **Commit `628d16b` (fix(e2e)):** Restored starter Pitchfork floor spawn offset (`380` px) to keep it outside the pickup radius, deleted the stale `52_beacon_poi.py` test, and adjusted the unified gallery E2E sampling step (`8` px instead of `24` px) to correctly catch thin font rows.
2.  **Commit `1bf0ad0` (fix(enemy-design)):** Corrected the `EnemyTemplateWriter` so that Uncommon and Rare shape, fill, and layer overrides are preserved on save.
3.  **Commit `957a101` (chore(dead-code)):** Purged unused keys (`weapon_shapes_gallery.yaml`, `inventory.yaml`), deleted the unreferenced `legendStripRect()` in `InventoryLayout`, and removed the deprecated `configs/nexus.yaml`.
4.  **Commit `d2cec3e` (fix(config)):** Ensured that `,` hot-reload actually clears overridden keys and forces a fresh disk reload, while `Ctrl+R` preserves manual console tweaks.
5.  **Commit `d880473` (docs(GameDesign)):** Reconciled spec files with actual shipped constants and marked planned features (Tridron enemy, Sentinel, Pact-Walker, Active Doge) as PLANNED.
6.  **Commit `233dc2a` (docs(audit)):** Final corrections to the audit report noting that Weapon/Dice rounding was deferred rather than unified.

---

## 4. Overlapping Agent Work & Conflict Resolution

Two major merge conflicts occurred due to concurrent agent work:
1.  **`d7be770` (WorldRenderer.cpp):** Resolving shape drawing between YAML templates (added by the enemy-design branch) and neon circle shaders (from main). Kept both: templates only apply to special kinds, while standard enemies preserve the neon circle shader paths.
2.  **`3bfabc9` (CommandDispatcher_Entities.cpp):** Resolved options for `SpawnEnemy` command, ensuring that `can_jump` (river cross) and `kind` / `tier` (enemy design) are both supported.

These resolutions were handled with high precision and did not break any features.

---

## 5. Surfaced Decisions for the User

The following items are deferred/highlighted for user review:
1.  **Rounding Discrepancy:** `WeaponMaker.cpp` uses `round-half-up` while `DiceMaker.cpp` uses `truncate` for quality score rounding. This is a balance-affecting formula and remains deferred.
2.  **File Size Limit:** `EnemyManager.cpp` sits at 506 lines (exceeding the project rule limit of 500 lines). It should be split during the next structural change.
3.  **Hardcoded UI/VFX Literals:** Colors/sizes inside `PerformanceTab.cpp`, `ConfigTab.cpp` and shader effects remain hardcoded. If needed, these can be extracted to config.
4.  **Evasion Wireup:** The "Active Evasion" space-tap mechanic is documented but remains unwired in the gameplay logic.
