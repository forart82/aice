# Feature TDD Specification: SnakeLabScreen Native Disabled Fix & Max Level Handling

> **Feature Identifier:** `docs/tdd/snake_lab_max_level_and_aria_disabled.tdd.md`  
> **Status:** Green  
> **Target Directory:** `/home/forart/dev/snake_ts`  
> **Rule Reference:** [`AGENTS.md#rule-2`](file:///home/forart/dev/snake_ts/AGENTS.md) & [`ORACLE.md`](file:///home/forart/dev/snake_ts/ORACLE.md)  

---

## 1. Feature Overview & Requirements

1. **Fix Native `btn.disabled` Suppressing Click Events:**
   - In `addHeadAugmentOption` and `addHeadModuleOption`:
     - Do NOT set `btn.disabled = !canAfford || !isTierUnlocked;` (because setting `disabled = true` prevents the browser from dispatching click events to show toasts and play sound!).
     - Instead, keep `btn.disabled = false` and set `btn.setAttribute('aria-disabled', String(!canAfford || !isTierUnlocked));` (or `aria-disabled="true"` when max level is reached).
     - In the click event listener:
       - If `curLvl >= maxLvl`: show toast `🌟 Module is already at Maximum Level!`.
       - If `!isTierUnlocked`: show toast `🔒 Tier ${nextLvl} Locked: ${chDesc}` and call `Services.Sound.playError()`.
       - If `!isAffordable`: show toast `⚠️ Insufficient Ouro: You have ${curOuro} 🪙, need ${cost} 🪙! (Need ${cost - curOuro} more)` and call `Services.Sound.playError()`.
       - If `canAfford`: execute purchase, update player stats/head modules, deduct Ouro, refresh lab, and trigger `Services.Sound.playLevelUp()`.

2. **Max Level Handling:**
   - Offense/Defense modules max level is 3 (`MaxModuleLevel = 3`).
   - Cranial Augments max level is 3 (`MaxAugmentLevel = 3`).
   - When max level is reached:
     - Display `[MAX LEVEL]` badge with golden border (`.cost-tag.max-level`, `.btn-max-level`).
     - Set `aria-disabled="true"`.
     - Clicking displays informational toast `🌟 Module is already at Maximum Level!`.

---

## 2. Test Plan & Assertions (Red Phase)

- **Test Suite Location:** `src/tests/SnakeLabPurchaseAffordance.test.ts`
- **Assertions:**
  1. Buttons for unaffordable and tier-locked upgrades maintain `btn.disabled === false` while having `aria-disabled === 'true'`.
  2. Clicking an unaffordable button triggers `Services.Sound.playError()` and displays toast banner with insufficient Ouro details.
  3. Clicking a tier-locked button triggers `Services.Sound.playError()` and displays toast banner with tier lock details.
  4. Offense/Defense modules and Augments enforce Max Level = 3:
     - At Max Level (3/3), button renders `.btn-max-level`, golden border / glow, `[MAX LEVEL]` badge, and `aria-disabled="true"`.
     - Clicking a maxed button shows toast `🌟 Module is already at Maximum Level!` and does not deduct Ouro or increase module level.
  5. Sequential upgrades from Level 0 -> 1 -> 2 -> 3 transition smoothly with level-up sound and state refresh.

---

## 3. Implementation Details (Green Phase)

- **Files Created/Modified:**
  - `src/ui/screens/SnakeLabScreen.ts`: Updated `addHeadAugmentOption` and `addHeadModuleOption` with `MaxModuleLevel` and `MaxAugmentLevel` constants, `btn.disabled = false`, `aria-disabled`, max level badge & styling, click listener hierarchy.
  - `src/sim/SnakePlayer.ts`: Added `GetHeadAugmentLevel` / `getHeadAugmentLevel` helper methods.
  - `index.html`: Added CSS rules for `.lab-docked-card-btn.btn-max-level` and `.cost-tag.max-level`.
  - `src/tests/`: Updated test assertions to verify `aria-disabled` and added max level test cases.

---

## 4. Verification & Quality Check

```bash
npx vitest run src/tests/SnakeLabPurchaseAffordance.test.ts
./verify
```
