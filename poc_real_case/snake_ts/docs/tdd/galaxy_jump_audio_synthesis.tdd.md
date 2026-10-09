# Feature TDD Specification: Galaxy Jump Procedural Web Audio Synthesis & Fanfare

> **Feature Identifier:** `docs/tdd/galaxy_jump_audio_synthesis.tdd.md`  
> **Status:** Green / Refactored  
> **Target Directory:** `/home/forart/dev/snake_ts`  
> **Rule Reference:** [`AGENTS.md#rule-1`](file:///home/forart/dev/snake_ts/AGENTS.md), [`AGENTS.md#rule-2`](file:///home/forart/dev/snake_ts/AGENTS.md), [`AGENTS.md#rule-3`](file:///home/forart/dev/snake_ts/AGENTS.md), [`AGENTS.md#rule-10`](file:///home/forart/dev/snake_ts/AGENTS.md), [`AGENTS.md#rule-12`](file:///home/forart/dev/snake_ts/AGENTS.md) & [`ORACLE.md#the-grand-finale-the-9th-celestial-helmet-galaxy-jump--the-boss-rush-gauntlet`](file:///home/forart/dev/snake_ts/ORACLE.md)  
> **Created:** 2026-09-04  
> **Verified:** 2026-09-04 (10/10 tests PASS, Quality Gate 100% PASS)  

---

## 1. Feature Overview & Requirements

### 1.1 High Concept & Acoustic Design
- **Galaxy Jump Hyperspace Warp SFX (`playWarpJump`)**:
  - Simulates an escalating relativistic hyper-drive compression and cosmic rift transition.
  - **Oscillator Pitch Sweep**: Continuous pitch sweep from sub-rumble to hypersonic piercing tone ($f_0 = 80\text{ Hz} \to 880\text{ Hz}$) over $t_{\text{warp}} = 2.2\text{ s}$ utilizing dual sawtooth/triangle PolyBLEP anti-aliased oscillators with soft saturation.
  - **Bandpass Noise Rush**: Modulated white/pink noise stream filtered through an RBJ bandpass filter ($Q = 3.5$) with dynamic center frequency sweeping from $200\text{ Hz} \to 3500\text{ Hz}$ across the 2.2s acceleration phase, conveying the tearing of spacetime fabric.
  - **Sub-Bass Rift Transition Boom**: At the culmination of the warp sequence ($t \approx 2.1\text{ s} - 2.2\text{ s}$), triggers a deep resonant sub-bass detonation centered at $f_{\text{sub}} = 40\text{ Hz}$ decaying exponentially over $1.0\text{ s}$ ($t_{\text{total}} \approx 3.2\text{ s}$) marking the arrival through the celestial rift.
- **Unique Helmet Reveal Fanfare (`playUniqueHelmetReveal`)**:
  - Celebrates unlocking one of the 8 canonical Unique Boss Helmets or awakening the 9th Celestial Crown.
  - **Harmonious Celestial Chord**: Arpeggiated Cmaj9 fanfare voicing across 5 staggered harmonic registers:
    - $C_4$ ($261.63\text{ Hz}$) at $t = 0.00\text{ s}$
    - $E_4$ ($329.63\text{ Hz}$) at $t = 0.08\text{ s}$
    - $G_4$ ($392.00\text{ Hz}$) at $t = 0.16\text{ s}$
    - $B_4$ ($493.88\text{ Hz}$) at $t = 0.24\text{ s}$
    - $D_5$ ($587.33\text{ Hz}$) at $t = 0.32\text{ s}$
  - **Chorus & Reverb Aura**: Dual detuned partials ($\pm 4\text{ cents}$) and extended exponential ADSR release tail ($\tau_{\text{rel}} \approx 2.5\text{ s}$) simulating immense celestial acoustic space.
- **Architectural & Headless Safety**:
  - Complete zero-allocation sample generation support for offline DSP rendering (`bakeSoundToBuffer` / `renderVoice`).
  - Web Audio API node cleanup: Strict tracking and disconnection of all created `OscillatorNode`, `AudioBufferSourceNode`, `BiquadFilterNode`, and `GainNode` on `onended` events to guarantee zero memory leaks or phantom audio voices.
  - Universal contract integration: `ISound`, `NullSound`, and `MockSound` in `src/core/Contracts.ts` and `src/core/Services.ts`.

### 1.2 Target Systems
- `src/core/Contracts.ts`: Add `playWarpJump()` and `playUniqueHelmetReveal()` to `ISound`, with no-op implementations in `NullSound`.
- `src/core/Services.ts`: Export `MockSound` implementing `playWarpJump()` and `playUniqueHelmetReveal()` with call tracking.
- `src/audio/Synth.ts`: Implement Web Audio and offline DSP synthesis functions `playWarpJump()`, `playUniqueHelmetReveal()`, `createWarpJumpVoices()`, and `createUniqueHelmetRevealVoices()`.
- `src/audio/SoundEngine.ts`: Wire `playWarpJump()` and `playUniqueHelmetReveal()` methods into the active sound engine.
- `src/ui/screens/OuroborosGalleryScreen.ts`: Trigger `playWarpJump()` on galaxy jump activation and `playUniqueHelmetReveal()` upon successful unique helmet drop.

---

## 2. Test Plan & Assertions (Red Phase)

- **Test Suite Location:** `src/tests/GalaxyJumpAudioSynthesis.test.ts`
- **Assertions:**
  1. `ISound` contract defines `playWarpJump()` and `playUniqueHelmetReveal()`.
  2. `NullSound` implements `playWarpJump()` and `playUniqueHelmetReveal()` without throwing.
  3. `MockSound` in `Services.ts` implements both methods and accurately increments invocation counters.
  4. `Services.Sound.playWarpJump()` and `Services.Sound.playUniqueHelmetReveal()` can be invoked headlessly without throwing exceptions.
  5. `createWarpJumpVoices()` returns valid `VoiceSpec[]` containing sweeping pitch oscillator, bandpass noise rush, and sub-bass 40Hz boom.
  6. `createUniqueHelmetRevealVoices()` returns valid `VoiceSpec[]` containing 5-note arpeggiated Cmaj9 fanfare voicing ($C_4, E_4, G_4, B_4, D_5$).
  7. Offline DSP synthesis (`bakeSoundToBuffer`) renders non-empty, finite, non-NaN PCM audio buffers for both recipes.
  8. Web Audio API pipeline synthesis with a mock `AudioContext` creates oscillators, filters, gain nodes, and buffer sources, and guarantees all nodes are cleanly disconnected on termination with zero node leaks.

---

## 3. Implementation Details (Green Phase)

- **Files Created/Modified:**
  - `src/core/Contracts.ts`
  - `src/core/Services.ts`
  - `src/audio/Synth.ts`
  - `src/audio/SoundEngine.ts`
  - `src/ui/screens/OuroborosGalleryScreen.ts`
  - `src/tests/GalaxyJumpAudioSynthesis.test.ts`

---

## 4. Verification & Quality Check

```bash
npx vitest run src/tests/GalaxyJumpAudioSynthesis.test.ts
npm run typecheck
./verify
```
