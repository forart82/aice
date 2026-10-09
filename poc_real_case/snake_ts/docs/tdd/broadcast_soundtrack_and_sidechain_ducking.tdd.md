# Feature TDD Specification: Broadcast Soundtrack Streaming & Sidechain Ducking

> **Feature Identifier:** `docs/tdd/broadcast_soundtrack_and_sidechain_ducking.tdd.md`  
> **Status:** Green / Refactored (100% Passing & Verified)  
> **Target Directory:** `/home/forart/dev/snake_ts`  
> **Rule Reference:** [`AGENTS.md#rule-2`](file:///home/forart/dev/snake_ts/AGENTS.md), [`AGENTS.md#rule-10`](file:///home/forart/dev/snake_ts/AGENTS.md) & [`ORACLE.md`](file:///home/forart/dev/snake_ts/ORACLE.md)  

---

## 1. Feature Overview & Requirements

- **High Concept:** Upgrade `src/audio/MusicPlayer.ts` from a purely procedural 16th-note arcade arpeggiator to a Hybrid Music Engine. The engine supports seamless broadcast-quality soundtrack streaming with loop playback (`music_exploration.wav`, `music_combat.wav`, `music_boss.wav`), state-driven crossfading across game phases (exploration, combat/frenzy, boss battle), dynamic sidechain ducking under heavy SFX and UI pausing, and seamless fallback to the procedural step sequencer when running headlessly in Vitest or when buffers are unavailable.
- **Target Systems:**
  - `src/audio/MusicPlayer.ts`: Hybrid Music Engine, AudioBufferSourceNode looping, multi-track crossfader, dynamic sidechain ducking gain node, and procedural step sequencer fallback.
  - `src/audio/Synth.ts`: Definition of `BROADCAST_MUSIC_PATHS`, music track keys, audio buffer caching integration.
  - `src/audio/SoundEngine.ts`: Integration with sidechain ducking on loud events (explosions, boss alerts, warp jumps, victory, game over) and volume routing.
  - `src/tests/Audio.test.ts`: Conformance tests for music transport, crossfade transitions, ducking, and procedural fallback.
  - `src/tests/ProfessionalAudioRedesign.test.ts`: Web Audio node graph topology, leak-free disposal, crossfade automation, and sidechain attenuation verification.
- **Signal Flow Architecture:**
  ```
  [Broadcast AudioBufferSourceNode (loop=true)] ──┐
                                                  ├─► [Track Gain (0..1)] ──┐
  [Alternate Broadcast Source (crossfading)] ─────┘                         │
                                                                            ▼
  [Procedural Synth Voices (Fallback)] ──────────────────────────────► [Mood Lowpass Filter]
                                                                            │
                                                                            ▼
                                                                     [Sidechain Duck Gain]
                                                                            │
                                                                            ▼
                                                                     [Music Destination Gain]
                                                                            │
                                                                            ▼
                                                                     [Master Output]
  ```

---

## 2. Test Plan & Assertions (Red Phase)

- **Test Suites:**
  - `src/tests/Audio.test.ts`
  - `src/tests/ProfessionalAudioRedesign.test.ts`
- **Required Assertions:**
  1. **Broadcast Track Preload & Cache:** Calling `startMusic()` initiates preloading of all 3 broadcast soundtrack loops (`exploration`, `combat`, `boss`) via `loadAudioBuffer`.
  2. **Broadcast Loop Playback:** When a track buffer is cached in memory, `MusicPlayer` instantiates an `AudioBufferSourceNode` with `loop = true`, routes it through its track gain into `moodFilter`, and starts playback.
  3. **Seamless Crossfading across Game States:**
     - Baseline exploration plays `music_exploration.wav`.
     - When `isBossMode` activates, crossfades smoothly to `music_boss.wav`.
     - When `isFrenzy` or intensity > 0.6 activates, crossfades smoothly to `music_combat.wav`.
     - Crossfading automates outgoing track gain to 0 and incoming track gain to 1 without abrupt clicks or pops.
  4. **Headless Procedural Fallback:** When broadcast buffers are not cached (or running headlessly in Vitest/Node), `MusicPlayer` seamlessly runs the procedural lookahead step sequencer without throwing errors.
  5. **Dynamic Mood Filter Continuity:** Broadcast loops flow through `moodFilter`, retaining dynamic lowpass filtering when paused (350 Hz) or during intensity sweeps.
  6. **Sidechain Ducking:**
     - `duck(amount, duration)` smoothly attenuates `duckGain` to the specified amount and restores back to unity (1.0).
     - Heavy SFX (e.g. boss alert, explosion, warp jump) trigger dynamic ducking.
     - Pausing ducks music volume and lowers filter cutoff; resuming restores filter and volume.
  7. **Zero Memory Leaks & Transport Disposal:**
     - `stopMusic()` stops all active buffer sources, clears crossfading timeouts, and disconnects all allocated audio nodes.
     - Subsequent calls to `startMusic()` or state transitions do not retain dead source nodes.

---

## 3. Implementation Details (Green Phase)

- **Files Modified:**
  - `src/audio/Synth.ts`: Exported `BROADCAST_MUSIC_PATHS` and `BroadcastMusicTrack`. Added `eatPop`, `musicExploration`, `musicCombat`, `musicBoss` to `BROADCAST_AUDIO_PATHS`.
  - `src/audio/MusicPlayer.ts`: Refactored into Hybrid Music Engine with `AudioBufferSourceNode` pool, track crossfader, `duckGain` sidechain node, `duck()` API, pause ducking, and procedural fallback.
  - `src/audio/SoundEngine.ts`: Connected SFX events to sidechain ducking (`PlayExplosion`, `PlayBossAlert`, `PlayWarpJump`, `PlayGameOver`, `PlayVictory`, `PlayLevelUp`). Implemented `duckMusic()`.
  - `src/tests/Audio.test.ts`: Added tests for hybrid playback, ducking, crossfade, and procedural fallback.
  - `src/tests/ProfessionalAudioRedesign.test.ts`: Added Section 10 tests for Web Audio graph topology, loop flags, crossfader gains, and node cleanup.

---

## 4. Verification & Quality Check

- **Unit & Integration Tests:**
  - `src/tests/Audio.test.ts`: 18/18 tests passed (100% PASS)
  - `src/tests/ProfessionalAudioRedesign.test.ts`: 55/55 tests passed (100% PASS)
  - `src/tests/AudioVoiceLimiterAndMasterCompressor.test.ts`: 9/9 tests passed (100% PASS)
- **Type Checking:**
  - `npm run typecheck`: 0 errors (100% CLEAN)
- **Full Verification Suite:**
  - `./verify`: All 151 test suites and production build passing.
