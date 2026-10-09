# Feature TDD Specification: Startup Audio Initialization and User-Gesture Unlocking

> **Feature Identifier:** `docs/tdd/startup_audio_initialization_and_gesture_unlock.tdd.md`  
> **Status:** Green  
> **Target Directory:** `/home/forart/dev/snake_ts`  
> **Rule Reference:** [`AGENTS.md#rule-2`](file:///home/forart/dev/snake_ts/AGENTS.md) & [`ORACLE.md`](file:///home/forart/dev/snake_ts/ORACLE.md)  

---

## 1. Feature Overview & Requirements

- **High Concept:** Ensure audio playback is initialized at startup and properly unlocked on the first user interaction gesture (pointerdown or keydown) in modern web browsers, addressing autoplay policy restrictions and missing `SoundEngine.init()` invocations.
- **Target Systems:** `src/main.ts`, `src/sim/GameEngine.ts`, `src/audio/SoundEngine.ts`, `src/audio/Synth.ts`
- **Mechanics Reference:** [`ORACLE.md`](file:///home/forart/dev/snake_ts/ORACLE.md)

### Specific Tasks:
1. In `src/main.ts`:
   - Call `this.sound.init()` immediately upon constructing/initializing the app.
   - Hook user interaction audio unlocking via `pointerdown` and `keydown` events:
     ```typescript
     const unlockAudio = () => {
       unlockAudioContext();
       if (this.sound) this.sound.init();
       window.removeEventListener('pointerdown', unlockAudio);
       window.removeEventListener('keydown', unlockAudio);
     };
     window.addEventListener('pointerdown', unlockAudio, { once: true, passive: true });
     window.addEventListener('keydown', unlockAudio, { once: true, passive: true });
     ```
   - Expose `OuroborosApp` and `App` classes, providing `init()` and `startRun()` workflows that ensure `this.sound.init()` is invoked and active when entering game runs.
   - Also ensure `GameEngine.StartRun` triggers `this.Sound.init?.()`.

---

## 2. Test Plan & Assertions (Red Phase)

- **Test Suite Location:** `src/tests/PlatformAndUiIntegrity.test.ts` & `src/tests/Audio.test.ts`
- **Assertions:**
  1. `App` / `OuroborosApp` invokes `this.sound.init()` during app construction/initialization.
  2. `App` registers `pointerdown` and `keydown` event listeners on `window` to unlock audio on first user gesture.
  3. Browser autoplay state is unlocked when `pointerdown` or `keydown` is dispatched: `unlockAudioContext()` is invoked, `sound.init()` is re-invoked, and event listeners are removed cleanly.
  4. Entering game runs (via `startRun` or URL parameters) ensures `sound.init()` is invoked and active.

---

## 3. Implementation Details (Green Phase)

- **Files Created/Modified:**
  - `src/main.ts`: Initialized `this.sound.init()` in constructor, implemented `hookAudioUnlock()`, `init()`, and `startRun()`, added URL param run entry audio initialization, exported `OuroborosApp` and `App`.
  - `src/sim/GameEngine.ts`: In `StartRun()`, explicitly invoke `this.Sound.init?.()` or `this.Sound.Init?.()`.
  - `src/core/Contracts.ts`: Added optional `init?(): void` and `Init?(): void` to `ISound` contract; implemented no-ops on `NullSound`.
  - `src/audio/SoundEngine.ts`: Added `Init(): void` alias to `init()`.
  - `src/tests/PlatformAndUiIntegrity.test.ts`: Added Section 5 test suite verifying startup audio initialization, gesture unlock, listener cleanup, and run entry contracts.
  - `src/tests/Audio.test.ts`: Added test suite confirming startup initialization.

---

## 4. Verification & Quality Check

```bash
npx vitest run src/tests/PlatformAndUiIntegrity.test.ts
npx vitest run src/tests/Audio.test.ts
npm run typecheck
./verify
```
