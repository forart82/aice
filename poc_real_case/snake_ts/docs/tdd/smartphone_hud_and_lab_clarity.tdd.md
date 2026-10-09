# Feature TDD Specification: Smartphone Top HUD & Mutation Lab Clarity & De-Cluttering

> **Feature ID:** `smartphone_hud_and_lab_clarity`  
> **Status:** Red $\rightarrow$ Green $\rightarrow$ Refactor  
> **Target Files:**
> - `src/ui/HudView.ts`
> - `src/ui/screens/SnakeLabScreen.ts`
> - `index.html`
> - `src/tests/SmartphoneHudAndLabClarity.test.ts`

---

## 1. Problem Statement & User Feedback

1. **Top In-Game Smartphone HUD:**
   - On smartphones (portrait & landscape), the top HUD is cluttered: truncated class names (`Emeral...`), 3-row vertical stacking in the right column, small text overlapping, and clumping between action buttons (`[🧬]`, `[⏸]`) and stat pills (`Score`, `Combo`, `Shards`).
2. **Cranial Mutation Lab on Smartphone:**
   - Overly tall header with redundant multi-line subtitles, dense bulleted text strings, wrapping action buttons, and vertical notice blocks that compress the module cards into a narrow scroll area.

---

## 2. Design & Architecture Enhancements

### 2.1 Top HUD Modernization:
- **Left (Vitals):** Dedicated `[LVL 1]` badge + clean numeric `❤️ 196 / 196` + bold high-contrast HP/Shield bars. Suppress truncated class name on mobile tier for zero clipping.
- **Center (Mission):** Compact `🌌 F1 • 🍎 3/22` progress indicator.
- **Right (Controls & Stats):** Sleek single horizontal bar containing combo badge, score/shards pill, and dedicated glassmorphic `[🧬 LAB]` and `[⏸ PAUSE]` buttons with minimum 40px touch targets.

### 2.2 Mutation Lab Modernization:
- **Header:** Clean single-line title + distinct Stat Chips (`⚡ XP`, `❤️ HP`, `🛡️ DR`, `📏 Length`).
- **Segmented Controls:** Modern segmented tab pill (`[ 🧬 Bio-Lab ] [ 🪖 Helmets (N) ]`) and prominent glowing `[ Deploy ⚡ ]` button.
- **Module Cards:** Structured row layout (Icon + Title + Tier on left, Cost / Lock on right, 1-line benefit preview below) with high-contrast amber challenge tags.

---

## 3. Test Matrix Specifications (`SmartphoneHudAndLabClarity.test.ts`)

1. **Test 1:** Smartphone HUD top row layout does not truncate vitals or clip HP text.
2. **Test 2:** HUD buttons `[🧬]` and `[⏸]` meet touch accessibility standards ($\ge 40\text{px}$) with dedicated hotkeys/icons.
3. **Test 3:** Combo, Score, and Shards display cleanly without 3-row vertical clumping on phone tier.
4. **Test 4:** Mutation Lab header renders segmented tabs, stat chips, and Deploy button without text collisions.
5. **Test 5:** Mutation Lab module cards render structured rows with distinct cost/tier badges and clean unlock requirements.
