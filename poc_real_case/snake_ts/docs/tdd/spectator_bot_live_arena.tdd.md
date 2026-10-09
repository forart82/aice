# Feature TDD Specification: Spectator Bot Live Arena Mode

> **Feature Identifier:** `docs/tdd/spectator_bot_live_arena.tdd.md`  
> **Status:** Complete / Green (100% Quality Gate PASS)  
> **Target Directory:** `/home/forart/dev/snake_ts`  
> **Rule Reference:** [`AGENTS.md#rule-2`](file:///home/forart/dev/snake_ts/AGENTS.md) & [`ORACLE.md`](file:///home/forart/dev/snake_ts/ORACLE.md)  

---

## 1. Feature Overview & Requirements

- **High Concept:** Enables a 1-click Spectator Bot mode in the web UI allowing the user to watch the Autonomous Bot Player fight live in the arena in real time in their browser.
- **Target Systems:** `src/input/InputManager.ts`, `src/sim/GameEngine.ts`, `src/ui/HudView.ts`, `src/ui/screens/MenuScreen.ts`, `src/main.ts`
- **Core Requirements:**
  1. **GameEngine Bot Integration**: `GameEngine` manages `isBotEnabled: boolean` and `botPlayer: AutonomousBotPlayer`. When active, `stepPolicy` drives player steering, dash, skill execution, and automated LevelUp draft selection.
  2. **Keyboard & Toggle Input**: Pressing `B` / `KeyB` toggles Bot AI mode in real-time. `InputManager` provides `consumeBotToggle()`.
  3. **Menu Screen Cleanliness**: The manual `🤖 Spectate Bot Run` button has been removed from `MenuScreen` to eliminate player-facing UI clutter and maintain a streamlined menu layout, while preserving full spectator/autoplay launch capabilities via URL parameters (`?bot=true`, `?spectate=true`, `?autoplay=true`) and live in-game toggle (`B` / `KeyB`).
  4. **HUD Spectator Badge**: In-game HUD displays an interactive `🤖 BOT AI [B]` badge indicating live autonomous bot control. Clicking the badge toggles between bot and manual control.
  5. **URL Parameter Activation**: Navigating to `?bot=true`, `?autoplay=true`, or `?spectate=true` immediately launches the bot spectator run.

---

## 2. Test Plan & Assertions (Red Phase)

- **Test Suite Location:** `src/tests/SpectatorBotLiveArena.test.ts`
- **Assertions:**
  1. `InputManager` tracks `KeyB` and edge-triggers `consumeBotToggle()`.
  2. `GameEngine` toggles `isBotEnabled` via `toggleBot()`.
  3. In `GameState.Playing` with bot enabled, `GameEngine.Tick()` delegates steering and actions to `botPlayer`.
  4. In `GameState.LevelUp` with bot enabled, `GameEngine.Tick()` automatically resolves draft card selection.
  5. `MenuScreen` has removed the manual Spectate Bot Run button from the title screen, while bot mode remains fully accessible via engine routing and URL parameters (`?bot=true`, `?spectate=true`).

---

## 3. Implementation Details (Green Phase)

- **Files Modified:**
  - `src/input/InputManager.ts`
  - `src/sim/GameEngine.ts`
  - `src/ui/HudView.ts`
  - `src/ui/screens/MenuScreen.ts`
  - `src/main.ts`
  - `src/tests/SpectatorBotLiveArena.test.ts`

---

## 4. Verification & Quality Check

```bash
npx vitest run src/tests/SpectatorBotLiveArena.test.ts
./verify
```
