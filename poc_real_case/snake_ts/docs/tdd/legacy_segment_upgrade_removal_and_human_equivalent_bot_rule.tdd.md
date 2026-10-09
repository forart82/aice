# Feature TDD Specification: Legacy Segment Socket Removal & Strict Human-Equivalent Bot Policy

> **Feature Identifier:** `docs/tdd/legacy_segment_upgrade_removal_and_human_equivalent_bot_rule.tdd.md`  
> **Status:** Completed & 100% Verified (PASS)  
> **Target Directory:** `/home/forart/dev/snake_ts`  
> **Rule Reference:** [`AGENTS.md#rule-1`](file:///home/forart/dev/snake_ts/AGENTS.md), [`AGENTS.md#rule-2`](file:///home/forart/dev/snake_ts/AGENTS.md), [`AGENTS.md#rule-3`](file:///home/forart/dev/snake_ts/AGENTS.md), [`AGENTS.md#rule-11`](file:///home/forart/dev/snake_ts/AGENTS.md), [`ORACLE.md#8-autonomous-bot-controller--human-equivalent-action-standard`](file:///home/forart/dev/snake_ts/ORACLE.md)  

---

## 1. Feature Overview & Requirements

### 1.1 High Concept
This feature completes the architectural cleanup and modernization of *Ouroboros Ascension* to **Head-Centric Serpentine Evolution** while establishing the strict **Human-Equivalent Bot Action Rule (HEBAR / Anti-Cheat Standard)**:
1. **Legacy Segment Sockets & Wagon Upgrades Elimination**:
   - Permanently removed legacy body segment hardpoints (`SegmentSocket`, `SocketPosition`, `SnakeSegment.Sockets`, `installSocketModule`, `InstallSegmentModule`, `executeSegmentSocketModules`, and `SnakeRenderer` Pass 8 wagon drawing).
   - Trailing body segments function purely as physical serpentine mass, centripetal tail-whip conductors ($v = \omega \cdot r$), and autotomy shockwave reservoirs ($\text{Autotomy}()$).
2. **Head Command Center (Cranial Mutation Lab) Arsenal Enforcement**:
   - The serpent head is the exclusive tactical command center. All weapons (kinetic & elemental) and defensive bio-organs are installed into `player.HeadModules` and execute directly at $(x_{\text{head}}, y_{\text{head}}, \theta_{\text{head}})$ via `executeHeadModules`.
   - All 28 Alchemical Cross-Module Fusions evaluate active pairs strictly from `player.HeadModules`.
   - Upgrades adhere to challenge-gated unlocks in `MetaProgression` and escalating Ouro cost scaling:
     $$\text{Cost}(\text{level}, \text{purchases}) = \text{BaseCost} \times \text{level} + \text{purchases} \times \text{CostScaling}$$
     - Modules: $\text{BaseCost} = 30\text{ Ouro}, \text{CostScaling} = 15\text{ Ouro}$
     - Cranial Augments: $\text{BaseCost} = 40\text{ Ouro}, \text{CostScaling} = 20\text{ Ouro}$
     - Strict Level Cap: Tier 3 maximum per module/augment.
3. **Strict Human-Equivalent Bot Action Rule (HEBAR / Anti-Cheat Rule)**:
   - **Zero Cheating & Zero Direct State Mutation**: Autonomous bots cannot mutate internal player fields directly (`player.Segments[i].Sockets`, `player.Hp`, `player.Ouro`, `player.X`, `player.Y`).
   - **Legitimate Card Drafting**: Level-up choices select cards strictly from `engine.CurrentDraftCards` via `engine.SelectUpgradeCard(card)`. Engine validates that drafted cards exist in the current draft roll.
   - **Legitimate Lab Purchasing & Helmet Equipping**: Cranial Lab purchases must call `player.SpendOuro()` and check challenge unlock state via `meta.IsTierUnlocked()`. Boss helmet equipping draws only from legitimately owned helmets in the meta-progression vault.
   - **Physical Input Compliance**: All movement and combat triggers flow strictly through `IInput` / `ScriptedInput` (`SetDirection`, `RequestDash`, `RequestSkill`, `RequestLab`), respecting angular turning limits ($\omega_{\text{turn}}$).

---

## 2. Completed Architecture Refactor

- **`src/core/Contracts.ts` & `src/input/InputManager.ts`**: Standardized `RequestDash()`, `RequestSkill()`, `RequestLab()`, `RequestPause()`, `RequestHelp()`, `RequestStats()` across `IInput`, `ScriptedInput`, and `InputManager`.
- **`src/sim/SnakePlayer.ts`**: Removed `SegmentSocket`, `SocketPosition`, `SnakeSegment.Sockets`, legacy segment installation methods. Updated `EffectiveArmor`, `TakeDamage`, and `GetActiveAlchemicalFusions` to operate purely on `HeadModules`.
- **`src/sim/CombatModules.ts` & `src/sim/CombatSystem.ts`**: Removed `executeSegmentSocketModules` and streamlined `ModuleActionContext` to execute head modules and passives.
- **`src/render/SnakeRenderer.ts`**: Removed Pass 8 wagon pod drawing loop and `drawModuleFast`.
- **`src/sim/GameEngine.ts`**: Added draft verification anti-cheat in `SelectUpgradeCard` to ensure drafted cards must be present in `CurrentDraftCards`.
- **`src/sim/ai/AutonomousBotPlayer.ts`**: Eliminated legacy socket equipping cheat in `handleLevelUp`, routed dashes and skills through `IInput`, and implemented legitimate helmet equipping (`equipBestHelmet`).
- **`ORACLE.md` & `AGENTS.md`**: Added Section 8 (HEBAR standard) and Rule 11 (No Cheating Rule) to SSOT and agent development guidelines.

---

## 3. Verification & Quality Gate Results

- **TypeScript Strict Compilation**: `npm run typecheck` — 0 errors (100% clean).
- **Automated Conformance Testing**: `npx vitest run` / `./verify`:
  - **102 / 102 Test Suites Passed** (100% PASS).
  - **1,335 / 1,335 Test Cases Passed** (100% PASS).
  - **Production Web Build**: Built successfully (`dist/index.html` & bundled assets).
