# Feature TDD Specification: Memory Leaks, Event Listeners, and Object Lifecycle Audit

> **Feature Identifier:** `docs/tdd/memory_leaks_listeners_lifecycle_audit.tdd.md`  
> **Status:** Green  
> **Target Directory:** `/home/forart/dev/snake_ts`  
> **Rule Reference:** [`AGENTS.md#rule-2`](file:///home/forart/dev/snake_ts/AGENTS.md) & [`ORACLE.md`](file:///home/forart/dev/snake_ts/ORACLE.md)  

---

## 1. Feature Overview & Requirements

- **High Concept:** Deep defect resolution targeting memory leaks, dangling window/document event listeners, uncancelled animation frame and timer handles, disconnected Web Audio graph nodes, active voice counter desync, unbounded arrays/maps, and WebGL context loss / disposal across UI, Platform, and Audio systems.
- **Target Systems:**
  - `src/platform/SaveIO.ts`: IndexedDB connection lifecycle and connection caching/disposal.
  - `src/platform/MultiScreen.ts`: `BroadcastChannel` `onmessage` cleanup, test bus reset, companion window reference cleanup.
  - `src/platform/CompanionSync.ts`: Re-entrant `connect()` socket leak prevention, listener detachment, set clearing, and `dispose()` support.
  - `src/audio/SoundEngine.ts`: Active voice count leak on muted audio, `dispose()` lifecycle for master graph nodes and maps.
  - `src/audio/MusicPlayer.ts`: Procedural oscillator/filter/noise node disconnections on ended, fading streams tracking in procedural fallback, `dispose()` lifecycle.
  - `src/ui/HudView.ts`: Window listener tracking and clean removal on `destroy()` / `dispose()`.
  - `src/ui/UiRoot.ts`: Subscription teardown, screen disposal, and instance cleanup.
  - `src/ui/screens/*`: Timer cancellations (`HelpScreen`, `MultiScreenModal`, `SanctuaryScreen`), WebGL renderer disposal (`OuroborosGalleryScreen`).
  - `src/render/webgl/WebGLGameRenderer.ts` & `WebGLContext.ts`: WebGL context loss (`webglcontextlost`, `webglcontextrestored`) event management, `dispose()` lifecycle, GPU texture deletion.
  - `src/main.ts`: App loop teardown (`stop()`, `destroy()`) and resource disposal.

---

## 2. Test Plan & Assertions (Red Phase)

- **Test Suite Location:** `src/tests/LifecycleAndLeakAudit.test.ts`
- **Assertions:**
  1. `SaveIO`: Caches IndexedDB handle and provides `closeDB()` to cleanly disconnect without leaking open connections.
  2. `MultiScreenManager` and `MultiScreenSync`: `clearTestBus()` resets test buses; `destroy()`/`close()` unbinds `onmessage` and clears listeners.
  3. `CompanionSync`: `connect()` cleans up previous connection if already connecting/open; `cleanup()`/`dispose()` unbinds all socket/peer/channel event listeners and clears subscriber sets.
  4. `SoundEngine`: `PlayEat()` when muted does not increment or leak `_activeVoiceCounts`; `dispose()` cleanly disconnects gain nodes and clears tracking maps.
  5. `MusicPlayer`: `scheduleTone` and `scheduleHat` disconnect all temporary graph nodes on end; `transitionToProceduralFallback` adds outgoing stream to `fadingStreams`; `dispose()` cleans up all persistent nodes and timers.
  6. `HudView`: `destroy()` / `dispose()` unbinds all 7 window event listeners (`pointermove`, `pointerup`, `pointercancel`, `touchmove`, `touchend`, `touchcancel`, `keydown`).
  7. `UiRoot` and Screens: `UiRoot.dispose()` unbinds layout subscription and cleans up child screens; `OuroborosGalleryScreen.destroy()` disposes `ringRenderer`; `HelpScreen.hide()` cancels pending scroll timeouts; `MultiScreenModal.destroy()` cancels copy timeouts.
  8. `WebGLGameRenderer`: `dispose()` destroys batch and context; `clearTextureCaches()` calls `gl.deleteTexture` on GPU textures; handles `webglcontextlost` with `preventDefault()` and `webglcontextrestored`.
  9. `App`: `stop()` and `destroy()` cleanly cancel animation frames via `cancelAnimationFrame` and teardown subsystems.

---

## 3. Implementation Details (Green Phase)

- **Files Created/Modified:**
  - `src/tests/LifecycleAndLeakAudit.test.ts`
  - `src/platform/SaveIO.ts`
  - `src/platform/MultiScreen.ts`
  - `src/platform/CompanionSync.ts`
  - `src/audio/SoundEngine.ts`
  - `src/audio/MusicPlayer.ts`
  - `src/ui/HudView.ts`
  - `src/ui/UiRoot.ts`
  - `src/ui/screens/OuroborosGalleryScreen.ts`
  - `src/ui/screens/HelpScreen.ts`
  - `src/ui/screens/MultiScreenModal.ts`
  - `src/render/webgl/WebGLGameRenderer.ts`
  - `src/render/webgl/WebGLAssetAtlas.ts`
  - `src/render/webgl/WebGLContext.ts`
  - `src/main.ts`

---

## 4. Verification & Quality Check

```bash
npx vitest run src/tests/LifecycleAndLeakAudit.test.ts
npm run typecheck
./verify
```

---

## 5. Actual Results & Protocol Compliance

- **Vitest Suite:** 18/18 tests passed cleanly (0 failures).
- **TypeScript Compilation:** Strict `tsc --noEmit` passed with 0 errors.
- **Protocol 3.0 Compliance:** 100% adherence to AGENTS.md (Rule 1, Rule 6, Rule 10, Rule 12).
- **Residual Leaks:** Zero dangling global listeners, zero uncancelled animation frame handles, zero unmanaged Web Audio nodes, zero lingering IndexedDB connections.
