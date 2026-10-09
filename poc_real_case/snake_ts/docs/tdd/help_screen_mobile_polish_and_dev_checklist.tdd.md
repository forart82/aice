# 🧪 Feature TDD Specification: 3-Level Drill-Down Mobile HelpScreen & Interactive Dev Checklist System

> **Protocol:** Strict TDD (Red-Green-Refactor) — Version 3.2  
> **Target Module:** `src/ui/screens/HelpScreen.ts`, `src/ui/screens/DevChecklistScreen.ts`, `src/data/CodexData.ts`, `index.html`  
> **Test Files:** `src/tests/HelpScreenMobilePolishAndDevChecklist.test.ts`, `src/tests/InteractiveCodexHelpScreen.test.ts`  
> **Status:** GREEN (100% Verified)  

---

## 1. Executive Summary & 3-Level Information Architecture

To eliminate cognitive crowding, nested double scrollbars, and element overlapping on compact smartphone viewports ($360\text{px} \times 800\text{px}$ up to $430\text{px} \times 932\text{px}$), the Galactic Field Guide (`HelpScreen`) is structured into a **3-Level Hierarchical Drill-Down Flow**:

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
│  [ ◀ All Categories       ⚔️ COMBAT & FUSIONS                 (✕) ]   │
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
│  [ ◀ Back to Hub ]        [ ⬆ Top ]         [ Return to Game / Close ] │
└────────────────────────────────────────────────────────────────────────┘
                                     │
                     Tapping any Level 2 Article Card
                                     ▼
┌────────────────────────────────────────────────────────────────────────┐
│             LEVEL 3: FOCUSED ARTICLE DEEP DIVE & FORMULAS              │
│                                                                        │
│  [ ◀ Back to Combat       💫 CENTRIPETAL TAIL-WHIP            (✕) ]   │
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
│  [ ◀ Back to Combat ]     [ ◀ Prev / Next ▶ ]       [ ✕ Close Guide ] │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Technical & Layout Specifications

1. **Anti-Overlap CSS Architecture**:
   * `.codex-modal .modal-panel`: Sets `overflow: hidden; display: flex; flex-direction: column; max-height: 94vh; max-height: 94dvh;`.
   * Nested double scrollbars eliminated by overriding the global `.modal-panel { overflow-y: auto }`.
   * Only `.codex-scroll-container` has `overflow-y: auto; min-height: 0; flex: 1 1 auto;`.
   * Safe-area padding (`env(safe-area-inset-top)`, `env(safe-area-inset-bottom)`) strictly enforced.
2. **View State Machine & Navigation Stack**:
   * `_viewMode: 'hub' | 'category' | 'article' | 'search'`
   * `openCategory(catKey: CodexCategory)`: Transitions from Hub (Level 1) to Category List (Level 2).
   * `openArticle(articleId: string)`: Transitions from Category List (Level 2) to Article Detail (Level 3).
   * `showHub()`: Returns to Hub view (Level 1), clearing category/article focus.
   * `goBack()`:
     - When `_viewMode === 'article'`: Pops to Level 2 Category List (or search if opened from search).
     - When `_viewMode === 'category'`: Pops to Level 1 Hub.
     - When `_viewMode === 'search'`: Clears search and returns to previous level.
     - When `_viewMode === 'hub'`: Closes modal and returns to game.
   * `handleKeyDown()`: `Escape` / `Backspace` / `ArrowLeft` executes sequential `goBack()`.
   * `handleGamepadInput()`: `B` button executes sequential `goBack()`. `LB / RB` cycles categories or articles.

---

## 3. Conformance Test Matrix

| Suite | Component / Area | Verified Behaviors |
| :--- | :--- | :--- |
| **Suite 1** | 3-Level Drill-Down Navigation & Mobile Anti-Overlap | Level 1 Hub default, Level 1 $\to$ Level 2 $\to$ Level 3 transition, sequential back popping (Level 3 $\to$ Level 2 $\to$ Level 1 $\to$ Close), phone metrics $\ge 48\text{px}$ touch targets. |
| **Suite 2** | Search Direct Level 3 Jump & Universal Hardware Controls | Search filtering, direct jump to Level 3, back return to search results, Escape/Backspace/Gamepad B sequential popping, Gamepad LB/RB category/article cycling. |
| **Suite 3** | DevChecklistScreen Registration & UI Interactivity | 7 checklist categories, accordion toggle, status cycling, subtask checkboxes, status filter. |
| **Suite 4** | DevChecklistData Persistence & Fallback Safety | SaveIO persistence, corrupted JSON handling, state reset defaults. |
| **Suite 5** | Screen Switcher, Simulator URL Routing & Modal Navigation | UiRoot alias resolution (`modal-checklist`, `modal-codex`, `modal-guide`), Escape dismiss, stack integrity. |
