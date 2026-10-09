# Feature TDD Specification: SnakeLab Interactive Click Affordances & Verification

> **Feature Identifier:** `docs/tdd/snake_lab_interactive_click_affordance.tdd.md`  
> **Status:** Draft / Red  
> **Target Directory:** `/home/forart/dev/snake_ts`  
> **Rule Reference:** [`AGENTS.md#rule-2`](file:///home/forart/dev/snake_ts/AGENTS.md) & [`ORACLE.md`](file:///home/forart/dev/snake_ts/ORACLE.md)  

---

## 1. Feature Overview & Requirements

1. **Locked Buttons Affordance & Toast Feedback:**
   - When a player interacts with / clicks a tier-locked module or bio-augmentation button (e.g. Cryo Mortar, Plasma Mortar, Dragon Maw, Ramming Horns, Tachyon Laser):
     - Displays the challenge requirement toast: `🔒 Tier ${tier} Locked: ${challengeDescription}`.
     - Triggers the error audio feedback `Services.Sound.playError()`.
     - Ensures the toast banner is made visible (`display !== 'none'`), styled with `.error` styling.

2. **Unaffordable Buttons Affordance & Toast Feedback:**
   - When a player interacts with / clicks an unlocked module or bio-augmentation that cannot be afforded due to insufficient Ouro:
     - Displays the insufficient Ouro toast with the exact missing amount: `⚠️ Insufficient Ouro: You have ${currentOuro} 🪙, need ${cost} 🪙! (Need ${missing} more)`.
     - Triggers the error audio feedback `Services.Sound.playError()`.
     - Shows the exact live balance vs required cost.

3. **Affordable Buttons Purchase & Equipping:**
   - When a player clicks an unlocked, affordable module or augmentation button:
     - Deducts the module/augment cost from the player's Ouro balance (`player.ouro` and `player.xp`).
     - Successfully installs/equips the module (e.g., `player.getHeadModuleLevel(modType) === 1` or `player.headModules[modType] === 1`) or cranial augment.
     - Increments `headPurchaseCount` and scales subsequent upgrade pricing.
     - Triggers the level-up audio cue `Services.Sound.playLevelUp()`.
     - Immediately updates and synchronizes the in-game HUD Ouro counter via `hudView.tick(player)`.

---

## 2. Test Plan & Assertions (Red Phase)

- **Test Suite Location:** `src/tests/SnakeLabInteractiveClickAffordance.test.ts`
- **Assertions:**
  1. Clicking locked buttons displays the challenge requirement toast and triggers error sound.
  2. Clicking unaffordable buttons displays the insufficient Ouro toast with exact missing amount and triggers error sound.
  3. Clicking affordable buttons successfully purchases, deducts Ouro, installs module/augment, triggers levelUp sound, and synchronizes HUD Ouro.
  4. Consecutive purchases scale costs appropriately and maintain wallet synchronization.

---

## 3. Implementation Details (Green Phase)

- **Test Suite:** `src/tests/SnakeLabInteractiveClickAffordance.test.ts`
- **Component Under Test:** `src/ui/screens/SnakeLabScreen.ts`

---

## 4. Verification & Quality Check

```bash
npx vitest run src/tests/SnakeLabInteractiveClickAffordance.test.ts
./verify
```
