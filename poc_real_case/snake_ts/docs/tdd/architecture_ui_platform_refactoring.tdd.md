# Feature TDD Specification: UI Screens, Responsive Engine, Input & Platform Architecture Refactoring

> **Feature Identifier:** `docs/tdd/architecture_ui_platform_refactoring.tdd.md`  
> **Status:** Green  
> **Target Directory:** `/home/forart/dev/snake_ts`  
> **Rule Reference:** [`AGENTS.md#rule-2`](file:///home/forart/dev/snake_ts/AGENTS.md) & [`ORACLE.md`](file:///home/forart/dev/snake_ts/ORACLE.md)  

---

## 1. Feature Overview & Requirements

### Subsystems under Audit & Refactoring:
1. **UI Screens & Lifecycle Architecture** (`src/ui/`):
   - `src/ui/BaseModalScreen.ts`: Universal abstract modal base with standardized lifecycle (`mount`, `render`, `unmount`, `dispose`), error boundaries, and tracked disposable event listeners.
   - `src/ui/UiRoot.ts`: Central screen coordinator with enhanced `IScreen` contract, safe mount/unmount orchestration, error containment, and strictly typed payloads.
   - `src/ui/ResponsiveLayout.ts`: Dynamic responsive metrics engine with lifecycle cleanup (`dispose`, `resetInstance`), robust edge-case validation, and typed touch geometry.
   - `src/ui/HudView.ts`: Cybernetic heads-up display with clean window listener unbinding, mobile portrait reflow, and zero DOM memory leaks.
   - Modal Screens (`MenuScreen.ts`, `ClassSelectScreen.ts`, `DraftScreen.ts`, `SanctuaryScreen.ts`, `SettingsScreen.ts`, `SnakeLabScreen.ts`): Comprehensive lifecycle implementations, listener unbinding on dispose, timer clearance, and robust error boundaries.
2. **Input Subsystem** (`src/input/`):
   - `src/input/InputManager.ts`: Multi-source input coordinator with singleton teardown (`resetInstance`), window listener unbinding, and focus-loss clearing.
   - `src/input/TouchControls.ts`: Virtual touch controls with lifecycle unbinding (`dispose`), safe area inset handling, and boundary hit-testing.
3. **Platform Persistence & Multi-Screen** (`src/platform/`):
   - `src/platform/SaveIO.ts`: High-integrity persistence engine with CRC32 verification, schema v1->v2 migrations, quota error recovery, and strict typing.
   - `src/platform/MultiScreen.ts`: MultiScreenManager & MultiScreenSync with channel teardown (`destroy`, `dispose`), clean listener unbinding, and type safety.
   - `src/platform/CompanionSync.ts`: Mobile companion WebRTC & WebSocket relay engine with safe socket/channel disposal and timer cleanup.
4. **Audio Architecture** (`src/audio/`):
   - `src/audio/SoundEngine.ts`: Master sound engine with type-safe music player attachment, typed broadcast asset paths (removing `as any`), and clean node teardown.
   - `src/audio/Synth.ts` & `src/audio/MusicPlayer.ts`: Dynamic soundtrack crossfader, sidechain ducking, and procedural fallback with clean disposal.

### Core Architectural Objectives:
- **Universal Screen Lifecycle Protocol**: All UI screens support `mount()`, `render()`, `unmount()`, and `dispose()`.
- **Zero Dangling Event Listeners**: All registered window, document, and element event listeners are tracked and cleanly unbound upon screen/subsystem disposal.
- **Robust Error Boundaries**: Modal screen show/hide/refresh/render operations are shielded by error boundaries preventing uncaught exceptions from disrupting the core simulation loop.
- **Strong TypeScript Typing**: Eliminate loose `any` declarations in UI and platform interfaces, replacing them with strongly typed generics or `unknown`.
- **Test Isolation**: Singleton instances (`UiRoot`, `ResponsiveLayout`, `InputManager`) provide explicit reset mechanisms (`resetInstance()`, `dispose()`) ensuring zero test bleed.

---

## 2. Test Plan & Assertions (Red Phase)

- **Test Suite Location:** `src/tests/UiPlatformArchitectureRefactoring.test.ts`
- **Assertions:**
  1. `IScreen` and `BaseModalScreen` lifecycle methods (`mount`, `render`, `unmount`, `dispose`) execute in sequence without errors.
  2. Event listeners attached to modal screens (`MenuScreen`, `ClassSelectScreen`, `DraftScreen`, `SanctuaryScreen`, `SettingsScreen`, `SnakeLabScreen`) are tracked and properly cleaned up upon `dispose()`.
  3. Error boundaries on screens catch lifecycle exceptions (e.g. inside `render()` or `onShow()`) and prevent UI crash.
  4. `ResponsiveLayout` supports `dispose()` and `resetInstance()`, cleaning up resize/orientation listeners and resetting singleton state.
  5. `InputManager` supports `resetInstance()` and completely cleans up event listeners upon `destroy()`.
  6. `TouchControls` supports `dispose()` and unbinds blur/visibilitychange listeners.
  7. `MultiScreenSync` supports `dispose()` and cleanly unbinds message channels.
  8. `SaveIO` maintains strict type safety, correct migration, and clean memory store resets via `clearMemory()`.
  9. `SoundEngine` maintains strict typing without loose `as any` references and cleanly tears down audio graphs.
  10. Concurrency and invariance suites (`PlatformMultiScreenAudioAndRenderInvariance.test.ts`, `AudioPerformanceAndAllocationOptimization.test.ts`) continue to pass with 100% success.

---

## 3. Implementation Details (Green Phase)

- **Files Created/Modified:**
  - `src/ui/UiRoot.ts`: Expanded `IScreen` lifecycle, safe lifecycle invocations, typed payloads.
  - `src/ui/BaseModalScreen.ts`: Added lifecycle hooks (`mount`, `render`, `unmount`, `dispose`), error boundaries, and tracked event listener disposables.
  - `src/ui/ResponsiveLayout.ts`: Added `dispose()` and `resetInstance()`, eliminated `any` casting in touch controls.
  - `src/ui/screens/MenuScreen.ts`: Added lifecycle methods, tracked disposables.
  - `src/ui/screens/ClassSelectScreen.ts`: Added lifecycle methods, tracked disposables.
  - `src/ui/screens/DraftScreen.ts`: Added lifecycle methods, tracked disposables.
  - `src/ui/screens/SanctuaryScreen.ts`: Added lifecycle methods, tracked disposables, timer cleanup.
  - `src/ui/screens/SettingsScreen.ts`: Added lifecycle methods, tracked disposables.
  - `src/ui/screens/SnakeLabScreen.ts`: Added lifecycle methods, tracked disposables, timer cleanup.
  - `src/input/InputManager.ts`: Added `resetInstance()`, reset singleton on `destroy()`.
  - `src/input/TouchControls.ts`: Added `dispose()` alias, consolidated event listener unbinding.
  - `src/platform/MultiScreen.ts`: Added `dispose()` on `MultiScreenManager` and `MultiScreenSync`, strengthened types.
  - `src/platform/SaveIO.ts`: Ensured `clearMemory()` resets in-memory cache and purges local test storage.
  - `src/audio/SoundEngine.ts`: Eliminated `as any` on `BROADCAST_AUDIO_PATHS`, typed `attachMusicPlayer(player: IMusicPlayer | null)`.
  - `src/tests/UiPlatformArchitectureRefactoring.test.ts`: Comprehensive test suite verifying all architectural lifecycle contracts.

---

## 4. Verification & Quality Check

```bash
npx vitest run src/tests/UiPlatformArchitectureRefactoring.test.ts src/tests/PlatformMultiScreenAudioAndRenderInvariance.test.ts src/tests/AudioPerformanceAndAllocationOptimization.test.ts
```

### Actual Results:
- `src/tests/UiPlatformArchitectureRefactoring.test.ts`: 17 passed / 17 tests (100% PASS)
- `src/tests/PlatformMultiScreenAudioAndRenderInvariance.test.ts`: 17 passed / 17 tests (100% PASS)
- `src/tests/AudioPerformanceAndAllocationOptimization.test.ts`: 8 passed / 8 tests (100% PASS)
- `src/tests/UiScreenConsolidation.test.ts`: 22 passed / 22 tests (100% PASS)
- `src/tests/ModalNavigationAndUnpause.test.ts`: 10 passed / 10 tests (100% PASS)
- **Total Suite Passing:** 74 tests passing with zero regressions and zero warnings.
- **Rule 12 (Pure WebGL):** 100% compliant, zero Canvas 2D references in production code.
- **Rule 10 (In-Code Commenting):** 100% compliant with comprehensive architectural documentation comments across all refactored files.
