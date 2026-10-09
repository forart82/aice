# 🧪 Feature TDD Specification: Ground-Up Rebuild of HelpScreen (3-Level Drill-Down Codex)

> **Feature Identifier:** `docs/tdd/help_screen_rebuild.tdd.md`  
> **Status:** GREEN (100% TDD Verified & Conformance Matrix Passing)  
> **Target Module:** `src/ui/screens/HelpScreen.ts`  
> **Test Suites:** `src/tests/InteractiveCodexHelpScreen.test.ts`, `src/tests/HelpScreenMobilePolishAndDevChecklist.test.ts`, `src/tests/UiScreenConsolidation.test.ts`  
> **Rule Reference:** [`AGENTS.md#rule-2`](file:///home/forart/dev/snake_ts/AGENTS.md), [`ORACLE.md`](file:///home/forart/dev/snake_ts/ORACLE.md)  

---

## 1. Feature Architecture & Specification

### 1.1 3-Level Drill-Down Master Architecture
The Galactic Field Guide & Compendium (`HelpScreen.ts`) is rebuilt from the ground up to eliminate clutter, redundant toolbars, and awkward title truncations across all viewports ($360\text{px} \times 800\text{px}$ up to $4\text{K}$ desktop):

```
┌────────────────────────────────────────────────────────────────────────┐
│                   LEVEL 1: FIELD GUIDE MASTER HUB                      │
│                                                                        │
│  [ 📖 HELP & CODEX                                            (✕) ]   │
│  [ 🔍 Search codex, mechanics, formulas, classes...              ]    │
│                                                                        │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │ 🎯 Core Rules & Basics                           (4 Articles) ▶  │  │
│  │    Slithering physics, modular health, food economy & combos     │  │
│  ├──────────────────────────────────────────────────────────────────┤  │
│  │ 🐍 Serpent Classes                               (2 Articles) ▶  │  │
│  │    5 serpent archetypes, base stats & Cranial Mutation Lab       │  │
│  ├──────────────────────────────────────────────────────────────────┤  │
│  │ ⚔️ Combat & Fusions                              (5 Articles) ▶  │  │
│  │    Tail-whip kinematics, constriction loops & 28 fusions         │  │
│  ├──────────────────────────────────────────────────────────────────┤  │
│  │ 👹 20 Apex Bosses & Bestiary                     (2 Articles) ▶  │  │
│  │    Gauntlet catalog, scaling formulas & boss helmet vault        │  │
│  ├──────────────────────────────────────────────────────────────────┤  │
│  │ 🌌 Game Modes & Daily Milestones                 (2 Articles) ▶  │  │
│  │    Rogue 10F, Boss Rush 20F, Daily 4-Tier Milestones             │  │
│  ├──────────────────────────────────────────────────────────────────┤  │
│  │ 📐 Mathematical Codex                            (1 Article)  ▶  │  │
│  │    Deterministic float64 curves, XP, armor caps & constants      │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                        │
│  [                     [ ✕ Return to Game ]                         ]  │
└────────────────────────────────────────────────────────────────────────┘
                                     │
                     Clicking any Level 1 Category Card
                                     ▼
┌────────────────────────────────────────────────────────────────────────┐
│               LEVEL 2: CATEGORY ARTICLE STREAM                         │
│                                                                        │
│  [ ◀ Back                     🎯 Core Rules                    (✕) ]   │
│                                                                        │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │ 🎮 Controls & Kinematic Navigation                           ▶  │  │
│  │    Keyboard, Gamepad API & Dynamic Touch Joystick                │  │
│  ├──────────────────────────────────────────────────────────────────┤  │
│  │ 🍏 Food Economy & Ambient Drops                              ▶  │  │
│  │    9 Unique Drops, Spawn Weights & Utility Synthesis             │  │
│  ├──────────────────────────────────────────────────────────────────┤  │
│  │ 💔 Modular Health & Segment Severing                         ▶  │  │
│  │    Head Command Priority, Top-to-Bottom Healing & Tail Severing  │  │
│  ├──────────────────────────────────────────────────────────────────┤  │
│  │ 🔥 Combo Overdrive & Frenzy System                           ▶  │  │
│  │    Stepped Multipliers from 2x to 8x and 8.0s Frenzy Surge       │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                        │
│  (NO category tabs, NO search bar, NO sub-headers, NO 4-button footer) │
└────────────────────────────────────────────────────────────────────────┘
                                     │
                     Clicking any Level 2 Article Card
                                     ▼
┌────────────────────────────────────────────────────────────────────────┐
│             LEVEL 3: FOCUSED ARTICLE READER DEEP DIVE                  │
│                                                                        │
│  [ ◀ Back                🎮 Controls & Kinematics              (✕) ]   │
│                                                                        │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │ 🎯 Gamer TL;DR Box                                               │  │
│  │    Steer through fluid 360° angles, boost dash, and fire skills! │  │
│  │                                                                  │  │
│  │ 📊 Stats Pills: [Forward Spd: 100%] [Dash: +75%] [i-Frames: 0.6s]│  │
│  │                                                                  │  │
│  │ 💡 Pro Gamer Rules & Tips:                                       │  │
│  │    • 360° Smooth Steering                                        │  │
│  │    • Tactical Dash Burst                                         │  │
│  │    • Universal Input Mapping Table                               │  │
│  │                                                                  │  │
│  │ 🔬 Formulas & Deep Dive Drawer:                                  │  │
│  │    v = v_base * (1 + SpeedBonus) * (isDashing ? 1.75 : 1.0)      │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                        │
│  [ ◀ Previous Article ]                       [ Next Article ▶ ]       │
└────────────────────────────────────────────────────────────────────────┘
```

### 1.2 View Level Specifications
1. **Level 1 (Hub)**:
   - Header: ONLY Top Header (`📖 HELP & CODEX` + `[✕]`).
   - Search Row: Visible search bar with real-time text input and clear button `[✕]`.
   - Category Grid: 6 Hero Cards with icon, label, description teaser, article count badge, and `▶` chevron.
   - Footer: ONLY `[✕ Return to Game]` button. No redundant 4-button bar.
2. **Level 2 (Category)**:
   - Header: `[◀ Back]` + Category Icon & Clean Title (e.g. `🎯 Core Rules`) + `[✕]`.
   - Stream: Full-height list of clean Article Cards (Icon, Title, 1-line teaser, `▶`).
   - Cleanliness: NO category tabs, NO search bar, NO sub-headers, NO 4-button footer.
3. **Level 3 (Article Detail)**:
   - Header: `[◀ Back]` + Concise Article Title (e.g. `🎮 Controls & Kinematics`) + `[✕]`.
   - Reader: Full-height deep-dive reader with TL;DR box, stats pills, bullet points, formula block, and bottom Next/Prev article jumpers.
   - Cleanliness: NO redundant toolbars or duplicate headers.
4. **Search Mode**:
   - Filtered cross-category list of matches when typing in search bar.
   - Clicking a search result drills directly into Level 3 Article Detail with `fromSearch: true`.
   - Back action from search-opened article returns directly to Search view with query retained.

### 1.3 Back Navigation Stack State Machine
- Sequential LIFO stack: Level 3 $\to$ Level 2 $\to$ Level 1 $\to$ Modal Exit.
- Hardware controls:
  - `Escape`: Blurs search input if active; otherwise pops navigation stack sequentially.
  - `Backspace`: Pops navigation stack when search input is not focused.
  - Gamepad `B`: Pops navigation stack sequentially.
  - Cycling keys (`Q/E`, `Left/Right Arrows`, Gamepad `LB/RB`): Cycles articles in Level 3 or categories in Level 2.

---

## 2. Test Verification Matrix

| Test Suite | Coverage Area | Status |
| :--- | :--- | :--- |
| `InteractiveCodexHelpScreen.test.ts` | 6 Category navigation, search filtering, accordion/drilldown, lifecycle unpause, hardware hotkeys | **PASS** |
| `HelpScreenMobilePolishAndDevChecklist.test.ts` | Mobile layout, 3-level navigation stack LIFO popping, direct search drilldown, DevChecklist integration | **PASS** |
| `UiScreenConsolidation.test.ts` | Screen registry, modal stack depth, close button selectors | **PASS** |

---
