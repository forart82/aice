# TDD Feature Specification: Cranial Mutation Lab & In-Run Expedition Operations Hub

> **Feature Identifier:** `cranial_mutation_lab_telemetry_and_challenge_hub`  
> **Status:** `Refactored & Verified (GREEN)`  
> **Date:** 2026-08-31  
> **Target Files:**
> - [`src/ui/screens/SnakeLabScreen.ts`](file:///home/forart/dev/snake_ts/src/ui/screens/SnakeLabScreen.ts)
> - [`src/tests/CranialMutationLabHubAndTelemetry.test.ts`](file:///home/forart/dev/snake_ts/src/tests/CranialMutationLabHubAndTelemetry.test.ts)
> - [`index.html`](file:///home/forart/dev/snake_ts/index.html)

---

## 1. Overview & Mechanical Rationale

Consolidates all in-run operations (head weapon/defense installations, cranial bio-augmentations, boss helmet loadouts, live challenge tracker progress, and real-time expedition vitals/bestiary telemetry) directly inside the **Cranial Mutation Lab & Expedition Hub** modal (`modal-snake-lab`).

### 4 Unified Segmented Tabs:
1. **`🧬 Bio-Lab`**: Head Modules & Cranial Augments upgrade cards, level badges [LVL 1/3], affordance states, purchase actions.
2. **`🪖 Helmets (N)`**: Boss Helmet Vault, equipped helmet slot, passive descriptions.
3. **`🎯 Challenges`**: Complete Live Cranial Lab Challenge Progress Tracker with live progress bars, percentages, current vs target values, and category badges (`Length`, `Foods`, `Kills`, `Bosses`, `Combo`).
4. **`📊 Telemetry`**: In-run vital signs, score, length, high combo, Food Harvest Breakdown (`Apples`, `Golden Apples`, `Potions`, `Shards`, `Prisms`), Bestiary Kills Breakdown (`Swarmlings`, `Scarabs`, `Spitters`, `Phantoms`, `Arc Drones`, `Magma Brutes`), and Conquered Apex Bosses history.

### Header & Quick Stats Chips Bar:
- **Header Title:** `🧬 CRANIAL MUTATION LAB & EXPEDITION HUB (FLOOR ${floor})`
- **Subtitle:** `Cranial augmentations, live tactical harvest, bestiary telemetry & cranial challenge tracking. Upgrade your Serpent Head with unlimited weapons & bio-organs, and equip Boss Helmets.`
- **Quick Stats Chips Bar:**
  - `🪙 {ouro} Ouro`
  - `🏛️ Floor {floor}`
  - `🐍 Len {length} (📏 {length} Segs)`
  - `⭐ {score}`
  - `❤️ {hp}/{maxHp}`
  - `⚡ {combo}x`

---

## 2. Test Verification Matrix

- **Unit Suite:** [`src/tests/CranialMutationLabHubAndTelemetry.test.ts`](file:///home/forart/dev/snake_ts/src/tests/CranialMutationLabHubAndTelemetry.test.ts)
  - 8/8 Unit tests passing (Tab initialization, routing, header title & subtitle, quick chips bar, live challenge progress, vitals & harvest breakdown, bio-lab purchase & helmet equip).
- **CSS Suite:** [`src/tests/UnifiedCranialLabAndExpeditionHubCss.test.ts`](file:///home/forart/dev/snake_ts/src/tests/UnifiedCranialLabAndExpeditionHubCss.test.ts)
  - 5/5 CSS tests passing.
- **Quality Gate:** [`./verify`](file:///home/forart/dev/snake_ts/verify)
  - Strict TypeScript compilation (`tsc --noEmit`): 100% Zero Errors.
  - Vitest Conformance Matrix: 76/76 Test Files Passed (979 Tests Passed).
  - Production Bundle Build (`vite build`): 100% Passed.
