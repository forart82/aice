# Feature TDD Specification: E2E Playwright Bot Campaign Playtest & Live Browser Conformance

> **Feature Identifier:** `docs/tdd/bot_campaign_e2e_playtest.tdd.md`  
> **Status:** Red -> Green  
> **Target Directory:** `/home/forart/dev/snake_ts`  
> **Rule Reference:** [`AGENTS.md#rule-2`](file:///home/forart/dev/snake_ts/AGENTS.md), [`AGENTS.md#rule-6`](file:///home/forart/dev/snake_ts/AGENTS.md), [`AGENTS.md#rule-10`](file:///home/forart/dev/snake_ts/AGENTS.md) & [`ORACLE.md`](file:///home/forart/dev/snake_ts/ORACLE.md)  

---

## 1. Executive Summary & Objectives

This specification defines the End-to-End (E2E) Browser Playtest test suite in `e2e/bot-campaign-playtest.spec.ts` using Playwright. The test suite drives the real browser DOM, Canvas 2D renderer, Web Audio stack, and responsive UI engine in live headless Chromium, exercising:

1. **Title & Menu Navigation Lifecycle**:
   - Canvas mount, high-DPI sizing, and responsive layout calculation.
   - Title screen navigation, Codex modal accordion inspection, Sanctuary meta upgrades view, and Global Statistics table.
2. **Archetype Selection & Loadout Configuration**:
   - `ClassSelectScreen` rendering, class card selection (Emerald Viper / Hydra / Solar / Stalker / Storm), Boss Helmet equipping, and expedition launch.
3. **Autonomous Bot Steering & Real-Time Combat**:
   - Automated steering loop targeting real-time food entities and enemies using browser keyboard inputs (`ArrowUp`, `ArrowRight`, `ArrowDown`, `ArrowLeft`) and direct steering APIs.
   - Dash (`Space`) and Active Skill (`KeyE`) invocation.
   - Real-time HUD vitals synchronization (HP bar, Level badge, Ouro counter, Combo frenzy meter, Score tracker).
4. **Draft Mutation Evolution Flow**:
   - Level-up trigger handling, `DraftScreen` (`.draft-modal`) card inspection, card selection, re-roll, and perk stacking.
5. **Cranial Mutation Lab & Helmet Vault In-Run Interaction**:
   - In-run opening of Cranial Mutation Lab (`KeyL` / HUD Lab icon).
   - Real DOM button interaction for offensive weapons (Attack Spitter, Bio-Arc Coil, Venom Sprayer, Flak Cannon) and defensive bio-organs (Carapace Shield, Thorny Spikes, Regen Gland).
   - Affordance verification, live Ouro deduction, and level progression.
   - Boss Helmet Vault tab switching, helmet equipping, and deployment back to active combat (`.btn-deploy-serpent`).
6. **Pause, Settings & Run Lifecycle**:
   - Pause modal (`Escape` / `KeyP`), resume, and clean teardown.

---

## 2. Test Plan & Assertions (Red Phase)

- **Test Suite Location:** `e2e/bot-campaign-playtest.spec.ts`
- **Playwright Config:** `playwright.config.ts`
- **Key Assertions:**
  1. `browser-boot-and-menu-navigation`: Page mounts `#game-canvas` and `#ui-root`, displays title screen, and handles Codex, Sanctuary, and Stats modal openings and closures.
  2. `archetype-select-and-campaign-start`: Selects Serpent class from `ClassSelectScreen`, equips loadout, and transitions `GameState` from `Menu` to `Playing`.
  3. `bot-steering-and-food-consumption`: Bot steers toward food spawning points, consumes food, increases snake segments and Ouro balance, and maintains 60 FPS Canvas 2D render loop.
  4. `cranial-lab-real-dom-purchases`: Opens `.snake-lab-modal`, performs real DOM clicks to purchase unlocked modules, verifies Ouro deduction and level-up, switches to Helmet Vault tab, equips helmet, and deploys back to combat.
  5. `draft-mutation-selection`: Successfully selects upgrade mutation cards from `.draft-modal` and verifies perk application.
  6. `pause-modal-and-resume`: Verifies pause modal toggles, settings interaction, and seamless return to active combat.

---

## 3. Implementation Details & Architecture

- **Playwright Runner:** `@playwright/test` running headless Chromium against local Vite web server (`http://localhost:3001`).
- **Input Simulation:** Real keyboard key presses (`page.keyboard.press()`, `page.keyboard.down()`, `page.keyboard.up()`) combined with game engine state introspection (`page.evaluate()`).
- **DOM Selectors:** Standard cybernetic UI classes (`.modal-overlay`, `.lab-docked-card-btn`, `.btn-primary`, `.upgrade-card`, `.class-card`, `.btn-tab-helmets`, `.btn-deploy-serpent`).

---

## 4. Verification Quality Gate

```bash
# 1. Run Complete Playwright E2E Test Suite
npx playwright test

# 2. Run Quality Gate (Typecheck + 65 Vitest Suites + Production Build)
./verify
```
