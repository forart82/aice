# 🧪 Feature TDD Specification: Remove Obsolete Bodypart Selection from Snake Lab

> **Feature Identifier:** `remove_obsolete_bodypart_selection_lab`  
> **Rule Reference:** [`AGENTS.md#rule-1`](file:///home/forart/dev/snake_ts/AGENTS.md), [`AGENTS.md#rule-2`](file:///home/forart/dev/snake_ts/AGENTS.md), [`AGENTS.md#rule-3`](file:///home/forart/dev/snake_ts/AGENTS.md), [`ORACLE.md#3.11`](file:///home/forart/dev/snake_ts/ORACLE.md)  
> **Status:** 100% VERIFIED & CONFORMANCE PASSED  
> **Created:** 2026-08-27  

---

## 1. Executive Summary & Architectural Scope

With the transition of Ouroboros Ascension to the **Head-Only Evolution Model**, all offensive weapons, defensive bio-organs, cranial bio-augmentations, and boss helmets install directly onto the **Serpent Head** and empower the entire organism. 

Individual body segment socketing and micromanagement have been completely eliminated from gameplay. Consequently, the bodypart selection component, segment pagination buttons (`computeSegmentGroups`), multi-segment camera track math (`computeSerpentinePoses`), socket slot getters, and canvas segment raycasting in [`SnakeLabScreen.ts`](file:///home/forart/dev/snake_ts/src/ui/screens/SnakeLabScreen.ts) are obsolete and have been cleanly purged.

### Key Objectives Accomplished:
1. **Purged Obsolete State & Methods in `SnakeLabScreen.ts`:**
   - Removed `_selectedPartIndex`, `_selectedSocketIndex`, `_selectedSegmentGroup`, `_openT`, `_targetOpen`, `_hoveredPartIndex`, `_hoveredSocketIndex`, `_pendingReplacementType`.
   - Removed `selectPart()`, `selectNextPart()`, `selectPrevPart()`, `setSelectedSegmentGroup()`, `computeSegmentGroups()`, `zoomOutToOverview()`, `selectSocket()`, `getSocketName()`, `hitTestBodyNode()`, `distanceToLineSegment()`, `hitTestFocusedSegmentSockets()`, `computeSerpentinePoses()`.
   - Reduced `SnakeLabScreen.ts` codebase from 1332 lines to 486 clean, maintainable lines.
2. **Streamlined Living Vivarium Canvas:**
   - Canvas 2D preview now centers on the animated Serpent Skull, equipped Boss Helmet crest/visor, orbital weapon/defense modules with version badges, containment rings, and undulating neck vertebrae.
   - Smooth mouse wheel zooming and drag-panning without any body-segment raycasting overhead.
3. **Harmonized Test Suites & SSOT:**
   - Updated [`src/tests/MutationLabAndDamageFeedback.test.ts`](file:///home/forart/dev/snake_ts/src/tests/MutationLabAndDamageFeedback.test.ts) to validate Cranial Bio-Chamber viewport adapting, Head mutation arsenal, and Helmet Vault integration.
   - Reconciled [`ORACLE.md`](file:///home/forart/dev/snake_ts/ORACLE.md) §3.5 and §2.1 with §3.11.

---

## 2. Test Plan (Red-Green-Refactor)

1. **`test_cranial_lab_pure_head_focus`**:
   - Verified `SnakeLabScreen` initializes without requiring body part selection state.
   - Verified active tab defaults to `lab` and renders Head-mounted weapons, defenses, and augments.
2. **`test_cranial_lab_canvas_bio_chamber`**:
   - Verified preview canvas renders living skull, containment rings, and orbital modules.
   - Verified camera zoom and pan functions work smoothly on the bio-chamber.
3. **`test_helmet_vault_tab_integration`**:
   - Verified tab navigation between `[ 🧬 Cranial Lab ]` and `[ 🪖 Helmet Vault ]`.
   - Verified equipping/unequipping helmets directly updates `MetaProgression` and `player.EquippedHelmet`.
4. **`test_full_quality_gate`**:
   - 100% PASS on strict typecheck, all 21 Vitest test suites (242 tests), and production build via `./verify`.

---

## 3. Implementation Checklist

- [x] Draft TDD feature specification file.
- [x] Refactor [`src/tests/MutationLabAndDamageFeedback.test.ts`](file:///home/forart/dev/snake_ts/src/tests/MutationLabAndDamageFeedback.test.ts) to remove legacy bodypart selection tests and add Head Lab assertions.
- [x] Clean up [`src/ui/screens/SnakeLabScreen.ts`](file:///home/forart/dev/snake_ts/src/ui/screens/SnakeLabScreen.ts), removing all dead bodypart selection code and raycasting.
- [x] Update [`ORACLE.md`](file:///home/forart/dev/snake_ts/ORACLE.md) and [`README.md`](file:///home/forart/dev/snake_ts/README.md) to ensure SSOT alignment.
- [x] Run `./verify` to confirm 100% PASS across all 21 test suites.
