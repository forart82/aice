# Feature TDD Specification: 3 Segregated Views in Cranial Mutation Lab & Expedition Hub

> **Feature Identifier:** `docs/tdd/segregated_three_view_cranial_lab.tdd.md`  
> **Status:** Refactored / Green (100% Pass)  
> **Target Directory:** `/home/forart/dev/snake_ts`  
> **Target File:** `src/ui/screens/SnakeLabScreen.ts`  
> **Rule Reference:** [`AGENTS.md#rule-2`](file:///home/forart/dev/snake_ts/AGENTS.md) & [`ORACLE.md`](file:///home/forart/dev/snake_ts/ORACLE.md)  

---

## 1. Feature Overview & Requirements

- **High Concept:** Implemented 3 clean, segregated tab views inside the Cranial Mutation Lab modal in [`SnakeLabScreen.ts`](file:///home/forart/dev/snake_ts/src/ui/screens/SnakeLabScreen.ts).
- **Target Systems:** `src/ui/screens/SnakeLabScreen.ts`, `src/tests/SegregatedThreeViewSnakeLab.test.ts`, `src/tests/CranialMutationLabHubAndTelemetry.test.ts`, `src/tests/SinglePageUnifiedSnakeLab.test.ts`.
- **Mechanics Reference:** [`ORACLE.md`](file:///home/forart/dev/snake_ts/ORACLE.md) (Cranial Mutation Lab, Boss Helmets, In-Run Challenges, Telemetry & Affordances).

### Core Architectural Specifications:
1. **Top Header**:
   - Title: `🧬 CRANIAL MUTATION LAB & EXPEDITION HUB (FLOOR ${floor})`
   - Subtitle: `Cranial augmentations, live tactical harvest, bestiary telemetry & cranial challenge tracking. Upgrade your Serpent Head with unlimited weapons & bio-organs, and equip Boss Helmets.`
   - 6 Quick Chips Bar: Ouro 🪙 (`.lab-stat-chip-ouro`), Floor 🏛️, Length 🐍, Score ⭐, HP ❤️, Combo ⚡.
   - 3-Button Segmented Tab Bar:
     - Tab 1: `🧬 Mutations` (`.btn-tab-lab`)
     - Tab 2: `🪖 Helmets (N)` (`.btn-tab-helmets`)
     - Tab 3: `📊 Statistics` (`.btn-tab-stats` / `.btn-tab-telemetry`)
2. **3 Distinct, Segregated Tab Views**:
   - **Tab 1: `🧬 Mutations` (`activeTab === 'lab'`)**:
     - Clean, uncluttered Cranial Mutation & Challenge Cards Grid:
       - ⚔️ Offensive Weapons (Head Mounted - 10 modules: turret, tesla, magma, venom, tachyon, cryo, plasma, scattershot, flak, needler)
       - 🛡️ Defensive Bio-Organs (Head Mounted - 6 modules: shield, spikes, regen, magnet, chrono, nanite)
       - 🐲 Cranial Bio-Augmentations (5 augments: fangs, maw, horns, laser, crown)
     - Strictly 1 starter weapon (`turret`) and 1 starter defense (`shield`) unlocked at start; all others locked with their respective in-card challenge tracks.
     - Interactive purchase affordances (`[BUY ⚡]`, `[NEED X MORE OURO]`, `[MAX LEVEL]`).
   - **Tab 2: `🪖 Helmets (N)` (`activeTab === 'helmets'`)**:
     - Dedicated Boss Helmet Vault & active equipped helmet showcase card (`.equipped-helmet-container`) with rarity borders, stat affixes, and instant equip/unequip toggles.
     - Collected Boss Helmets Grid with rarity borders, stat affixes, and equip/unequip toggles (`.btn-equip-helmet`, `.btn-unequip-helmet`).
   - **Tab 3: `📊 Statistics` (`activeTab === 'telemetry'` / `'stats'`)**:
     - Dedicated in-run expedition telemetry view with:
       - Serpent Vitals grid (`.stats-vitals-grid` / `.run-telemetry-grid`)
       - Nourishment & Harvest breakdown (`.food-breakdown-grid`: Apples, Golden, Potions, Shards, Prisms)
       - Hostile Bestiary kills (`.bestiary-grid`: Swarmlings, Scarabs, Spitters, Phantoms, Arc Drones, Magma Brutes)
       - Conquered Apex Bosses history (`.boss-defeats-list`: Boss encounters with Floor number, boss name, icon, and cleared badge).
3. **Tab Switcher Behavior**:
   - Toggles cleanly and ONLY renders/displays the active view in `.lab-docked-card-container`.
4. **Bottom Bar**:
   - Prominent `DEPLOY / RESUME EXPEDITION ⚡` action button (`.btn-deploy-serpent`) that resumes gameplay or completes level-up.

---

## 2. Test Plan & Assertions (Red Phase)

- **Test Suite Location:** `src/tests/SegregatedThreeViewSnakeLab.test.ts`
- **Assertions:**
  1. Top Header renders active floor title, 6 quick chips, and 3-button segmented tab bar (`[ 🧬 Mutations ] [ 🪖 Helmets (N) ] [ 📊 Statistics ]`).
  2. Tab 1 (`🧬 Mutations` / `.btn-tab-lab`) renders exclusively the Cranial Mutation & Challenge Cards Grid (Offense, Defense, Augmentations) with 1 starter weapon (`turret`) and 1 starter defense (`shield`) unlocked at start.
  3. Tab 2 (`🪖 Helmets (N)` / `.btn-tab-helmets`) renders exclusively the Boss Helmet Vault & Active Loadout showcase with instant equip/unequip toggles.
  4. Tab 3 (`📊 Statistics` / `.btn-tab-stats` / `.btn-tab-telemetry`) renders exclusively the Serpent Vitals grid, Nourishment breakdown, Bestiary kills, and Conquered Apex Bosses history.
  5. Tab switching cleanly updates the viewport to display only the active view and synchronizes button active states.
  6. Bottom bar Deploy button unpauses/resumes the game engine and dismisses the modal.

---

## 3. Implementation Details (Green Phase)

- **Files Created/Modified:**
  - `src/ui/screens/SnakeLabScreen.ts`
  - `src/tests/SegregatedThreeViewSnakeLab.test.ts`
  - `src/tests/CranialMutationLabHubAndTelemetry.test.ts`
  - `src/tests/SinglePageUnifiedSnakeLab.test.ts`
  - `docs/tdd/segregated_three_view_cranial_lab.tdd.md`

---

## 4. Verification & Quality Check

```bash
npx vitest run src/tests/SegregatedThreeViewSnakeLab.test.ts
./verify
```

**Quality Gate Verification Results:**
- TypeScript Typecheck (`tsc --noEmit`): 100% PASS (0 errors)
- Vitest Automated Test Suites (87 test files, 1097 tests): 100% PASS (0 failures)
- Production Web Bundle Build (`npm run build`): 100% PASS
