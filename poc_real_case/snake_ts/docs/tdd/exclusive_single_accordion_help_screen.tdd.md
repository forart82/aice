# 🧪 Feature TDD Specification: HelpScreen Exclusive Single-Accordion & Uniform Line Layout

> **Feature Identifier:** `docs/tdd/exclusive_single_accordion_help_screen.tdd.md`  
> **Status:** GREEN (100% Verified)  
> **Target Module:** `src/ui/screens/HelpScreen.ts`  
> **Test Suites:** `src/tests/InteractiveCodexHelpScreen.test.ts`, `src/tests/HelpScreenMobilePolishAndDevChecklist.test.ts`  
> **Rule Reference:** [`AGENTS.md#rule-2`](file:///home/forart/dev/snake_ts/AGENTS.md), [`ORACLE.md`](file:///home/forart/dev/snake_ts/ORACLE.md)  

---

## 1. Feature Architecture & Specification

### 1.1 Objective & Design Principles
Modernize the Help & Codex screen (`HelpScreen.ts`) with an **Exclusive Single-Accordion & Uniform Line Layout** that ensures maximum readability on mobile devices (360px - 430px) and wide desktop displays without layout shift or UI clutter.

### 1.2 Core Architectural Requirements
1. **Exclusive Single-Accordion Behavior**:
   - When entering a category (`openCategory`), all lines/cards are collapsed by default (`_expandedIds.clear()`, `_activeArticleId = null`).
   - Tapping any card header expands that specific card AND collapses all other open cards.
   - Tapping an already expanded card collapses it (`_expandedIds.clear()`, `_activeArticleId = null`).
   - Accordion toggle chevrons (`▶` / `▼`) reflect the expanded/collapsed state accurately.

2. **Uniform Line Layout (Icon | Title + Tags | Description | Chevron)**:
   - Every card in Level 2 (Category view) and Search mode uses identical structural anatomy:
     - **Left**: `${entry.icon}` (consistent size and alignment)
     - **Middle**: Title row with `${entry.title}` and `${entry.tags}` badge pills, plus Subtitle/1-line teaser
     - **Right**: Chevron `▶` (when closed) / `▼` (when expanded)
   - When expanded, the card body renders inline with:
     - 🎯 Gamer TL;DR banner (`codex-card-summary` / `codex-golden-summary`)
     - 📊 Quick Stats Pills (`codex-stats-matrix` / `codex-stat-pill`)
     - 💡 Pro Gamer Rules & Tips (`codex-tips-block` bullet points)
     - 🔬 Formulas & Deep Dive drawer (`codex-formula-drawer` collapsible details)

3. **Header & Navigation**:
   - Back button label is ALWAYS `◀ Back` (preventing long strings from overflowing on narrow mobile screens).
   - Category Header Title is `${cat ? cat.icon + ' ' : ''}${cat.label}` (e.g., `🎯 Core Rules & Basics`, `⚔️ Combat & Fusions`).
   - Redundant bottom jumper buttons and footers are removed in Category view for a clean, full-height stream.

4. **Public API & Search**:
   - `openArticle(id)` opens the category view and sets that specific article as the exclusively expanded one (`_expandedIds.clear()`, `_expandedIds.add(id)`, `_activeArticleId = id`).
   - Search results adopt the identical uniform card presentation with inline accordion expansion.

---

## 2. Test Plan & Matrix

| Test ID | Test Name / Scenario | Expected Outcome |
|---|---|---|
| 1.1 | Category initial state | All cards closed by default (`_expandedIds.size === 0`, `_activeArticleId === null`) |
| 1.2 | Header click expansion | Clicking a card header expands that card and collapses all others |
| 1.3 | Header click collapse | Clicking an already expanded card collapses it |
| 2.1 | Uniform line layout | Every card contains icon, title, tags, subtitle, and chevron |
| 2.2 | Expanded inline body | Expanded body contains summary, tips, stats pills, and formula drawer |
| 3.1 | Back button text | Back button text is always `◀ Back` |
| 3.2 | Category header title | Category title is formatted as `${cat.icon} ${cat.label}` |
| 3.3 | Clean Category view | Footer / jumper buttons are hidden in Category view |
| 4.1 | Public `openArticle(id)` | Sets category and exclusively expands the target article |
| 4.2 | Search uniform card | Search results render using uniform card layout with accordion toggling |

---

## 3. Implementation Verification Log

- **Phase 1 (Red)**: Author and update test assertions to enforce exclusive accordion behavior, `◀ Back` button text, category title format, and clean category footer removal.
- **Phase 2 (Green)**: Implement `HelpScreen.ts` with complete TypeScript logic matching the specification.
- **Phase 3 (Refactor & Verify)**: Run full test matrix and `./verify` quality gate.
