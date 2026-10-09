# Feature TDD Specification: Helmet Image Assets and Gallery Presentation

> **Feature Identifier:** `docs/tdd/helmet_image_assets_and_gallery_presentation.tdd.md`  
> **Status:** Green  
> **Target Directory:** `/home/forart/dev/snake_ts`  
> **Rule Reference:** [`AGENTS.md#rule-1`](file:///home/forart/dev/snake_ts/AGENTS.md), [`AGENTS.md#rule-2`](file:///home/forart/dev/snake_ts/AGENTS.md), [`AGENTS.md#rule-3`](file:///home/forart/dev/snake_ts/AGENTS.md), [`AGENTS.md#rule-10`](file:///home/forart/dev/snake_ts/AGENTS.md), [`AGENTS.md#rule-12`](file:///home/forart/dev/snake_ts/AGENTS.md) & [`ORACLE.md`](file:///home/forart/dev/snake_ts/ORACLE.md)  
> **Created:** 2026-09-05  

---

## 1. Feature Overview & Requirements

- **High Concept**:
  Equip all 8 Unique Helmets and the 9th Omni-Helmet ("The Celestial Crown of the Eternal Ouroboros") with dedicated, authoritative high-resolution image asset filepaths (`.Image`).
  Update the presentation across `OuroborosGalleryScreen` to prominently render these image assets:
  1. Unlocked circumferential pedestal slots render `img.slot-helmet-img` with matching `src` attribute.
  2. The Galaxy Jump Outcome celebration modal renders `img.unique-helmet-manifest-img` on transcendence success.
  3. Interactive relic inspection (`showRelicDetail()`) displays the full inspection image (`img.relic-inspection-img`).
- **Target Systems**:
  - `src/data/Types.ts`: `HelmetDef` with `Image?: string; image?: string;`.
  - `src/data/UniqueHelmetsData.ts`: `UniqueHelmetDef` definitions with authoritative `.Image` / `.image` paths and `forgeOmniHelmet()`.
  - `src/ui/screens/OuroborosGalleryScreen.ts`: `refresh()`, `showOutcomeModal()`, and `showRelicDetail()`.
  - `src/tests/MockDom.ts`: DOM attribute and property parity for `img.src`.
  - `src/tests/OuroborosGalleryScreen.test.ts` & `src/tests/GalaxyJumpWarpAndResultFlow.test.ts`: Expanded TDD suites.

---

## 2. Test Plan & Assertions (Red Phase)

- **Test Suite Location**:
  - `src/tests/OuroborosGalleryScreen.test.ts`
  - `src/tests/GalaxyJumpWarpAndResultFlow.test.ts`
- **Assertions**:
  1. All 8 Unique Helmets and the 9th Omni-Helmet possess defined `.Image` paths (e.g. `/assets/helmets/chrono_singularity.jpg`, etc.).
  2. Unlocked pedestal slots in `OuroborosGalleryScreen` render `img.slot-helmet-img` with the correct `src` matching `arch.Image`.
  3. `showOutcomeModal()` on Galaxy Jump transcendence success renders `img.unique-helmet-manifest-img` with `src` matching the awarded helmet's `Image`.
  4. `showRelicDetail()` renders the inspection image (`img.relic-inspection-img`) when an unlocked pedestal is inspected.

---

## 3. Implementation Details (Green Phase)

- **Files Created/Modified**:
  - `src/data/Types.ts`: Added `Image?: string; image?: string;` to `HelmetDef`.
  - `src/data/UniqueHelmetsData.ts`: Added `Image` and `image` filepaths for all 8 Unique Helmets and the 9th Omni-Helmet (`forgeOmniHelmet()`).
  - `src/ui/screens/OuroborosGalleryScreen.ts`:
    - `refresh()` renders `img.slot-helmet-img` with `src="${arch.Image}"` for unlocked pedestals while preserving icon fallback.
    - `showOutcomeModal()` renders `img.unique-helmet-manifest-img` with `src="${h.Image}"` for transcendence success cards.
    - `showRelicDetail()` renders `img.relic-inspection-img relic-detail-img` with `src="${arch.Image}"` during unlocked relic inspection.
  - `src/tests/MockDom.ts`: Added `src` getter/setter and attribute handling to `MockElement`.
  - `src/tests/OuroborosGalleryScreen.test.ts`: Added 4 tests validating `.Image` paths, pedestal slot rendering, manifest outcome modal image, and relic detail inspection image (26/26 passed).
  - `src/tests/GalaxyJumpWarpAndResultFlow.test.ts`: Added 4 tests validating `.Image` paths, pedestal slot rendering, outcome modal image, and relic inspection image (11/11 passed).

---

## 4. Verification & Quality Check

```bash
npx vitest run src/tests/OuroborosGalleryScreen.test.ts src/tests/GalaxyJumpWarpAndResultFlow.test.ts
# Result: 37 passed (37) in 601ms

npm run typecheck
# Result: 0 errors (100% clean TypeScript 5.8+ compilation)
```
