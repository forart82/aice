# Feature TDD Document: Interactive Galactic Field Guide & Codex Help Screen

> **Feature Identifier:** `docs/tdd/interactive_codex_help_screen.tdd.md`  
> **Status:** Implementation / In-Progress  
> **Target Directory:** `/home/forart/dev/snake_ts`  
> **Standard:** Strict Test-Driven Development (TDD Protocol 3.0), The Oracle SSOT (`ORACLE.md`), Commercial Viability & Responsive Layout  

---

## 1. Feature Overview & Requirements

### 1.1 Goal & High Concept
Create an interactive, beautifully presented, neon cyberpunk **Galactic Field Guide / Help Codex Window (`HelpScreen`)** accessible from:
1. **Main Menu**: Direct access via the `📖 Codex` button in the secondary action bar.
2. **In-Game HUD**: Quick HUD header icon button `📖 [H]` with automatic safe gameplay pausing.
3. **Settings / Pause Screen**: In-run compendium lookup without corrupting the active navigation stack.

### 1.2 Two-Tier Information Architecture
- **Tier 1 (Glanceable Quick-Read Summary Cards):** Clean neon cards with high-visibility glyphs, concise summaries, and key stats allow players to understand any rule or mechanic in <3 seconds without getting lost.
- **Tier 2 (Expandable Deep Dive & Formulas Accordions):** Complex mechanics and exact mathematical formulations (Damage pipelines, Centripetal tail-whip $v = \omega \cdot r$, Closed-loop constriction crushing DPS, XP curves, 4-tier daily milestones, 28 alchemical fusions, 20 boss scaling formulas) are cleanly tucked away inside clickable expander drawers (`[▼ ⚡ Deep Dive & Formulas]`) that reveal full mathematical proofs on demand.

### 1.3 The 6 Categorized Compendium Tabs
1. 🎯 **Core Rules & Controls (`rules`)**: Slithering, Growth, Food Economy (9 drop types), Health Kinematics, Segment Severing, Self-Collision, Dash, Combo Overdrive (x2 to x8).
2. 🐍 **Serpent Classes & Vivarium (`classes`)**: 5 Playable Archetypes (Emerald Viper, Shadow Stalker, Hydra Behemoth, Storm Wyrm, Solar Drake) with passives, active skills, and Cranial Lab socketing.
3. ⚔️ **Combat, Weapons & Fusions (`combat`)**: 8 Kinetic Weapons, 8 Elemental Weapons, 12 Defensive Bio-Organs, 28 Alchemical Cross-Module Fusions, Centripetal Tail-Whip, and Closed-Loop Constriction.
4. 👹 **20 Apex Bosses & Bestiary (`bosses`)**: All 20 Boss Guardians (HP, attacks, tells), Bestiary mobs, and Boss Helmet Vault (5 rarity tiers).
5. 🌌 **Game Modes & Daily Challenge (`modes`)**: Rogue Galaxy (10 Floors), Boss Rush (20 Floors), Endless Frenzy ($\infty$), and Daily Challenge 4-Tier Milestones (Lv 5/10/15/20) with 12 Cosmic Capacities.
6. 📐 **Mathematical Codex (`formulas`)**: Simulation constants (120 Hz), damage formulas, armor mitigation, XP curve, and boss multi-cycle scaling.

---

## 2. Test Plan & Vitest Suites

**Test File:** `src/tests/InteractiveCodexHelpScreen.test.ts`

- **Suite 1: Component Instantiation & DOM Structure**
  - Instantiates `HelpScreen` with ID `modal-help`.
  - Renders search input, 6 category tabs, action buttons (`Expand All`, `Collapse All`), and entries container.
  - Defaults to `rules` tab on initial render.
- **Suite 2: Category Tab Navigation**
  - Tab switching between `rules`, `classes`, `combat`, `bosses`, `modes`, `formulas`.
  - Dynamic tab count badges and active class styling.
- **Suite 3: Search Filtering Logic**
  - Real-time keyword filtering across title, description, tags, formulas, and deep-dive content.
  - Partial substring and case-insensitive matching.
  - Empty state handling with Reset Search button.
- **Suite 4: Accordion Deep Dive Interactivity**
  - Individual card toggle (`[▶]` $\to$ `[▼]`) expanding formula drawers.
  - Global `Expand All` and `Collapse All` batch actions.
- **Suite 5: Game Lifecycle & Navigation Stack**
  - Menu $\to$ Codex $\to$ Menu.
  - In-Game HUD $\to$ Codex (pauses game) $\to$ Return (unpauses game).
  - Settings $\to$ Codex $\to$ Return (returns to Settings).
- **Suite 6: Multi-Device Responsive Layout & Hardware Input**
  - Keyboard: Arrow keys / Q/E for tabs, `/` for search focus, `Esc` to close.
  - Gamepad: LB/RB for tabs, B button to close.
  - Touch: Responsive single-column scroll with safe-area insets.

---

## 3. Implementation Plan

1. Create `src/data/CodexData.ts` containing the authoritative compendium registry.
2. Create `src/ui/screens/HelpScreen.ts` implementing `IScreen`.
3. Update `src/ui/UiRoot.ts`, `src/ui/screens/MenuScreen.ts`, `src/ui/screens/SettingsScreen.ts`, `src/ui/HudView.ts`, and `src/sim/GameEngine.ts`.
4. Add Cyberpunk Neon Glassmorphism CSS in `index.html`.
5. Run full verification suite `./verify`.
