# Feature TDD Specification: SnakeLab Purchase Affordances & Feedback

> **Feature Identifier:** `docs/tdd/snake_lab_purchase_affordance.tdd.md`  
> **Status:** Green  
> **Target Directory:** `/home/forart/dev/snake_ts`  
> **Rule Reference:** [`AGENTS.md#rule-2`](file:///home/forart/dev/snake_ts/AGENTS.md) & [`ORACLE.md`](file:///home/forart/dev/snake_ts/ORACLE.md)  

---

## 1. Feature Overview & Requirements

1. **Visual Unaffordable Affordance:**
   - When the player cannot afford an upgrade (`curOuro < cost`):
     - Displays clear cost breakdown badge: `<span class="cost-tag unaffordable">🪙 ${cost} Ouro (Need ${cost - curOuro} more) [${curOuro}/${cost} 🪙]</span>`.
     - Styles unaffordable buttons with reduced brightness (`opacity: 0.65`), muted red/gray borders, and distinct disabled styling (`.btn-unaffordable`) so it is immediately obvious why the upgrade cannot be purchased.
     - When affordable, displays `.btn-affordable` and `.cost-tag.affordable`.
     - When tier-locked, displays `.btn-tier-locked` and `.cost-tag.tier-locked`.

2. **Interactive Insufficient Funds Feedback & In-Lab Warning Toast:**
   - Does NOT simply silently disable buttons with zero feedback.
   - When a player clicks an unaffordable or tier-locked button, displays an in-lab warning banner / toast: `⚠️ Insufficient Ouro: You have ${curOuro} 🪙, need ${cost} 🪙! (Need ${cost - curOuro} more)` (or challenge lock reason: `🔒 Tier ${nextLvl} Locked: ${chDesc}`) and triggers `Services.Sound.playError()`.
   - Toast banner in `SnakeLabScreen` auto-dismisses after 3500ms with error/info styling.

3. **Quick Stats Pill Bar:**
   - In `refresh()`, highlights the player's current Ouro balance `🪙 ${curOuro} Ouro` prominently with golden neon border and glow styling (`.lab-stat-chip-ouro`).

---

## 2. Test Plan & Assertions (Red Phase)

- **Test Suite Location:** `src/tests/SnakeLabPurchaseAffordance.test.ts`
- **Assertions:**
  1. Displays prominent golden neon border highlight for Ouro balance chip in Quick Stats Pill Bar (`.lab-stat-chip-ouro`).
  2. Renders unaffordable buttons with `.btn-unaffordable`, cost breakdown tag (`Need X more`), and progress badge when player has insufficient Ouro.
  3. Clicking an unaffordable button triggers `Services.Sound.playError()` and displays the warning toast banner with exact Ouro breakdown (`⚠️ Insufficient Ouro...`).
  4. Clicking a tier-locked button triggers `Services.Sound.playError()` and displays the tier lock toast banner (`🔒 Tier X Locked: ...`).
  5. Affordable upgrades render with `.btn-affordable`, allow smooth purchase, deduct Ouro, trigger `Services.Sound.playLevelUp()`, and refresh state.

---

## 3. Implementation Details (Green Phase)

- **Files Created/Modified:**
  - `src/ui/screens/SnakeLabScreen.ts`: Added `showToast()`, toast banner element, updated `addHeadAugmentOption()` and `addHeadModuleOption()` to render live affordance tags and click feedback, highlighted Ouro chip with golden neon border.
  - `index.html`: Added CSS rules for `.lab-stat-chip-ouro`, `.lab-docked-card-btn.btn-unaffordable`, `.lab-docked-card-btn.btn-tier-locked`, `.lab-docked-card-btn.btn-affordable`, `.cost-tag`, `.cost-tag.affordable`, `.cost-tag.unaffordable`, `.cost-tag.tier-locked`, and `.lab-toast-banner`.

---

## 4. Verification & Quality Check

```bash
npx vitest run src/tests/SnakeLabPurchaseAffordance.test.ts
./verify
```

- **Vitest Suite Results:** 53 test files passed (699 tests passed, 0 failed).
- **TypeScript Check:** Strict check passed with 0 errors.
- **Production Build:** Vite production bundle build passed 100%.
