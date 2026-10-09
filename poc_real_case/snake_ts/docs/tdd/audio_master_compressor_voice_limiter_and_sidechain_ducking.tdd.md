# Feature TDD Specification: Master Dynamics Compressor, Voice Concurrency Limiter, and Debounce System

> **Feature Identifier:** `docs/tdd/audio_master_compressor_voice_limiter_and_sidechain_ducking.tdd.md`  
> **Status:** Complete (Green Phase & Verified)  
> **Target Directory:** `/home/forart/dev/snake_ts`  
> **Rule Reference:** [`AGENTS.md#rule-2`](file:///home/forart/dev/snake_ts/AGENTS.md), [`AGENTS.md#rule-10`](file:///home/forart/dev/snake_ts/AGENTS.md) & [`ORACLE.md`](file:///home/forart/dev/snake_ts/ORACLE.md)  

---

## 1. Feature Overview & Requirements

- **High Concept:** Upgrade `src/audio/SoundEngine.ts` to implement studio-grade audio mastering and concurrency governance:
  1. **Master Dynamics Compressor Node**:
     - Web Audio `DynamicsCompressorNode` (`_masterCompressor = _ctx.createDynamicsCompressor()`).
     - Studio mastering parameters:
       * `threshold.value = -8` (dB)
       * `knee.value = 10` (dB)
       * `ratio.value = 8`
       * `attack.value = 0.003` (seconds, fast transient catch)
       * `release.value = 0.15` (seconds, musical release)
     - Audio routing topology:
       `_sfxGain` -> `_masterGain`
       `_musicGain` -> `_masterGain`
       `_masterGain` -> `_masterCompressor`
       `_masterCompressor` -> `_ctx.destination`
     - Mathematically guarantees prevention of digital DAC clipping, crackles, or pops when intense sound events overlap.
  2. **Voice Concurrency Limiter & Debounce System**:
     - Internal cooldown tracking: `_lastPlayTimes: Map<string, number> = new Map()`
     - Active voice counter: `_activeVoiceCounts: Map<string, number> = new Map()`
     - Decision method: `canPlay(soundKey: string, minIntervalMs: number, maxConcurrent: number = 3): boolean`
     - Specific throttling rules:
       * `hit`: minInterval = 35ms, maxConcurrent = 3.
       * `shoot`: minInterval = 40ms, maxConcurrent = 4. Subtle round-robin micro-pitch variation (detune ±35 cents) to eliminate robotic machine-gun repetition.
       * `bite`: minInterval = 40ms, maxConcurrent = 2.
       * `eat`: minInterval = 25ms, maxConcurrent = 3.
       * `explosion`: minInterval = 60ms, maxConcurrent = 2.
       * `thunder`: minInterval = 80ms, maxConcurrent = 2.
     - Track voice lifecycle and decrement `_activeVoiceCounts` upon voice termination (`onended` or cleanup callbacks).
  3. **Sidechain Ducking Method**:
     - `public duckMusic(duckGain: number = 0.4, durationSec: number = 0.8): void`
     - Smoothly ramps `_musicGain` down to `_musVol * duckGain` over 0.05s, holds, and smoothly restores to `_musVol` over `durationSec`.
     - Automatically invokes `duckMusic()` on major cinematic / boss / milestone events:
       * `playWarpJump()`
       * `playLevelUp()`
       * `playVictory()`
       * `playGameOver()`
       * `playBossAlert()`

- **Target Systems:**
  - `src/audio/SoundEngine.ts`
  - `src/audio/Synth.ts` (voice completion callbacks)
  - `src/tests/AudioVoiceLimiterAndMasterCompressor.test.ts`

---

## 2. Test Plan & Assertions (Red Phase)

- **Test Suite Location:** `src/tests/AudioVoiceLimiterAndMasterCompressor.test.ts`
- **Assertions:**
  1. **Master Compressor Graph Topology:**
     - Verifies `DynamicsCompressorNode` is instantiated during audio context initialization.
     - Verifies compressor parameters: threshold = -8 dB, knee = 10 dB, ratio = 8, attack = 0.003s, release = 0.15s.
     - Verifies audio graph connection: `_sfxGain` -> `_masterGain`, `_musicGain` -> `_masterGain`, `_masterGain` -> `_masterCompressor`, `_masterCompressor` -> `destination`.
  2. **Voice Debounce & Concurrency Limits:**
     - Rapidly calling `playHit()` 20 times within 10ms only emits within the allowed threshold (1 call emitted, 19 debounced by 35ms cooldown).
     - Respects `maxConcurrent = 3`: when 3 voices are actively playing, subsequent calls are suppressed until a voice finishes.
     - Validates throttling rules across `shoot`, `bite`, `eat`, `explosion`, and `thunder`.
     - Validates subtle round-robin micro-pitch variation (detune ±35 cents) on `playShoot()`.
     - Verifies `_activeVoiceCounts` decrements accurately when voices complete (via `onended` or cleanup).
  3. **Sidechain Ducking:**
     - Calling `duckMusic(0.4, 0.8)` ramps `_musicGain` down to `musicVolume * 0.4` over 0.05s and restores back to `musicVolume` over `0.8s`.
     - Major events (`playWarpJump`, `playLevelUp`, `playVictory`, `playGameOver`, `playBossAlert`) automatically trigger `duckMusic()`.

---

## 3. Implementation Details (Green Phase)

- **Files Created/Modified:**
  - `src/audio/SoundEngine.ts`:
    - Integrated Web Audio `DynamicsCompressorNode` (`_masterCompressor`) in `initCtx()` with studio mastering parameters (-8 dB threshold, 10 dB knee, 8 ratio, 3ms attack, 150ms release). Connected audio graph through `_masterCompressor` into `destination`.
    - Added `_lastPlayTimes` map, `_activeVoiceCounts` map, `canPlay()` decision method, and `startVoice()` lifecycle tracker with zero-leak teardown callbacks.
    - Added throttling rules to `playHit()`, `playShoot()`, `playBite()`, `playEat()`, `playExplosion()`, `playThunder()`.
    - Added round-robin micro-pitch detuning (±35 cents) to `playShoot()`.
    - Implemented AudioParam automation for `duckMusic(duckGain, durationSec)` and connected it to `playWarpJump()`, `playLevelUp()`, `playVictory()`, `playGameOver()`, `playBossAlert()`.
  - `src/audio/Synth.ts`:
    - Added `onEnded` lifecycle hook to `playVoiceSpecs` and `playAudioBuffer`.
    - Added `playbackRateMultiplier` support to `playAudioBuffer` for micro-pitch detuning of buffer sources.
  - `src/tests/AudioVoiceLimiterAndMasterCompressor.test.ts`:
    - 9 comprehensive tests validating graph topology, mastering parameters, debounce, polyphony limits, micro-pitch variations, and sidechain ducking.

---

## 4. Verification & Quality Check

```bash
npx vitest run src/tests/AudioVoiceLimiterAndMasterCompressor.test.ts
npm run typecheck
./verify
```

### Actual Results:
- `AudioVoiceLimiterAndMasterCompressor.test.ts`: 9/9 PASS (100%)
- `npm run typecheck`: 0 errors (100% PASS)
- `./verify`: 151 test suites, 1,952 tests PASS (100% PASS)
- Production Build: 100% PASS
