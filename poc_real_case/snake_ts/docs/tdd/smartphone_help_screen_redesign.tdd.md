# 🧪 Feature TDD Specification: Smartphone HelpScreen Redesign & Ergonomic Codex Compendium

> **Feature Identifier:** `docs/tdd/smartphone_help_screen_redesign.tdd.md`  
> **Status:** GREEN (100% TDD Verified & Conformance Matrix Passing)  
> **Target Module:** `src/ui/screens/HelpScreen.ts`, `src/ui/screens/DevChecklistScreen.ts`, `src/data/CodexData.ts`, `index.html`  
> **Test Suites:** `src/tests/InteractiveCodexHelpScreen.test.ts`, `src/tests/HelpScreenMobilePolishAndDevChecklist.test.ts`  
> **Rule Reference:** [`AGENTS.md#rule-2`](file:///home/forart/dev/snake_ts/AGENTS.md) & [`ORACLE.md`](file:///home/forart/dev/snake_ts/ORACLE.md)  

---

## 1. Feature Overview & Requirements

### 1.1 High Concept & Ergonomic Architecture
The in-game Galactic Field Guide & Codex (`HelpScreen.ts`) is completely redesigned for compact smartphone viewports ($360\text{px} \times 780\text{px}$, $390\text{px} \times 844\text{px}$, $412\text{px} \times 915\text{px}$) and multi-platform publishing. It replaces crowded multi-column accordion views with a **3-Level Hierarchical Drill-Down Navigation State Machine**:

```
┌────────────────────────────────────────────────────────────────────────┐
│                   LEVEL 1: FIELD GUIDE MASTER HUB                      │
│                                                                        │
│  [ 📖 THE OUROBOROS CODEX                                     (✕) ]   │
│  [ 🔍 Search codex, mechanics, formulas, classes...              ]    │
│                                                                        │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │ 🎯 Core Rules & Basics                           (4 Articles) ▶  │  │
│  │    Slithering physics, modular health, food economy & combos     │  │
│  ├──────────────────────────────────────────────────────────────────┤  │
│  │ 🐍 Serpent Classes & Vivarium                    (2 Articles) ▶  │  │
│  │    Emerald, Stalker, Hydra, Storm, Solar stats & Cranial Lab     │  │
│  ├──────────────────────────────────────────────────────────────────┤  │
│  │ ⚔️ Combat, Weapons & Fusions                     (4 Articles) ▶  │  │
│  │    Tail-whip kinematics, constriction loops & 28 fusions         │  │
│  ├──────────────────────────────────────────────────────────────────┤  │
│  │ 👹 20 Apex Bosses & Bestiary                     (2 Articles) ▶  │  │
│  │    Gauntlet catalog, scaling formulas & boss helmet vault        │  │
│  ├──────────────────────────────────────────────────────────────────┤  │
│  │ 🌌 Game Modes & Daily Milestones                 (2 Articles) ▶  │  │
│  │    Rogue 10F, Boss Rush 20F, Daily 4-Tier Milestones             │  │
│  ├──────────────────────────────────────────────────────────────────┤  │
│  │ 📐 Mathematical Codex & Formulas                 (1 Article)  ▶  │  │
│  │    Deterministic float64 curves, XP, armor caps & constants      │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                        │
│  [                        [ ✕ Close Guide ]                         ]  │
└────────────────────────────────────────────────────────────────────────┘
                                     │
                     Tapping any Level 1 Category Card
                                     ▼
┌────────────────────────────────────────────────────────────────────────┐
│               LEVEL 2: CATEGORY ARTICLE INDEX / STREAM                 │
│                                                                        │
│  [ ◀ Categories           ⚔️ COMBAT & FUSIONS                 (✕) ]   │
│  [ 🔍 Search articles in Combat & Fusions...                     ]    │
│                                                                        │
│  [ 🎯 Rules ] [ 🐍 Classes ] [ ⚔️ Combat ] [ 👹 Bosses ] [ 🌌 Modes ] │
│                                                                        │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │ 💫 Centripetal Kinetic Tail-Whip             [COMBAT] [KINEMATICS│  │
│  │    High-speed angular turns transform trailing wagons into       │  │
│  │    kinetic bludgeons.                                            │  │
│  │                                                [ Read Article ▶ ] │  │
│  ├──────────────────────────────────────────────────────────────────┤  │
│  │ 🌀 Closed-Loop Ouroboros Constriction          [COMBAT] [SIGNATUR│  │
│  │    Topological point-in-polygon enemy stasis and Astral Prism... │  │
│  │                                                [ Read Article ▶ ] │  │
│  ├──────────────────────────────────────────────────────────────────┤  │
│  │ 🧪 Arsenal Weapons, Bio-Organs & 28 Fusions    [ARSENAL] [FUSIONS│  │
│  │    8 Kinetic, 8 Elemental, 12 Defenses & 28 Alchemical Fusions.  │  │
│  │                                                [ Read Article ▶ ] │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                        │
│  [ ◀ Categories ]        [ ⬆ Top ]          [ Return to Game / Close ] │
└────────────────────────────────────────────────────────────────────────┘
                                     │
                     Tapping any Level 2 Article Card
                                     ▼
┌────────────────────────────────────────────────────────────────────────┐
│             LEVEL 3: FOCUSED ARTICLE DEEP DIVE & FORMULAS              │
│                                                                        │
│  [ ◀ Combat               💫 CENTRIPETAL TAIL-WHIP            (✕) ]   │
│                                                                        │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │ 💫 Centripetal Kinetic Tail-Whip                                 │  │
│  │ High-speed angular turns transform trailing wagons into kinetic  │  │
│  │ bludgeons.                                                       │  │
│  │                                                                  │  │
│  │ [ Tags: Combat • Kinematics • Physics ]                          │  │
│  │                                                                  │  │
│  │ ⚡ Summary: Sharp turns accelerate trailing segments to extreme  │  │
│  │ tangential velocity, knocking enemies back 180px and deflecting  │  │
│  │ projectiles.                                                     │  │
│  │                                                                  │  │
│  │ ┌──────────────────────────────────────────────────────────────┐ │  │
│  │ │ 📐 Centripetal Tail-Whip Kinematic Formula                   │ │  │
│  │ │   v_i = ||v_head|| + \omega \cdot (i \cdot d_segment)        │ │  │
│  │ │   D_whip = D_base \times (1.0 + 0.85 \cdot (v_i / v_head)^2) │ │  │
│  │ └──────────────────────────────────────────────────────────────┘ │  │
│  │                                                                  │  │
│  │ 📖 Full Technical Description & In-Game Application:             │  │
│  │ Trailing wagons i >= 2 become devastating kinetic hammers during │  │
│  │ tight spirals, deflecting light enemy lasers and staggering.     │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                        │
│  [ ◀ Combat ]             [ ◀ Prev / Next ▶ ]       [ ✕ Close Guide ] │
└────────────────────────────────────────────────────────────────────────┘
```

### 1.2 Core Specifications
1. **Clean 3-Level Navigation Flow**:
   - **Level 1 (Hub)**: 6 master category tiles (`rules`, `classes`, `combat`, `bosses`, `modes`, `formulas`) with live article counts and descriptions.
   - **Level 2 (Category)**: Filtered article stream for the active category with horizontal chip selector bar.
   - **Level 3 (Article Detail)**: Focused single-article view with math formulas, technical documentation, tags, and sequential Next/Previous jumper buttons.
   - **Sequential Stack Popping**: Level 3 $\to$ Level 2 $\to$ Level 1 $\to$ Modal Exit.
2. **Search Jump & Return**:
   - Cross-category real-time keyword indexing.
   - Direct jump from Search Results into Level 3 Article Detail.
   - Back action from search-opened article returns directly to Search view with query and results intact.
3. **Anti-Overlap CSS & Single-Scroll Architecture**:
   - `.codex-modal .modal-panel`: `overflow: hidden; display: flex; flex-direction: column; max-height: 94dvh;`.
   - Single scrolling container `.codex-scroll-container` (`overflow-y: auto; flex: 1 1 auto; min-height: 0;`).
   - Zero nested scroll containers or double scrollbars.
4. **Touch Target Sizing**:
   - All interactive touch targets (back button, close button, category chips, hub cards, jumpers, return button) adhere to WCAG 2.5.5 touch target minimum ($\ge 44\text{px} \times 44\text{px}$).
5. **Universal Hardware Controls**:
   - Keyboard: `Escape` (blur search or go back), `Backspace` (go back when search not active), `/` (focus search), `Q/E` & `Left/Right Arrows` (cycle category or article).
   - Gamepad: `B` button (sequential `goBack()`), `LB / RB` bumpers (cycle categories or articles).
6. **Zero Regression**:
   - Seamless integration with game lifecycle (Main Menu, In-Game HUD pause/unpause, Settings Screen navigation stack).
