# Feature TDD Specification: Crystal-Clear Cyber Audio Redesign

> **Feature Identifier:** `docs/tdd/crystal_clear_cyber_audio_redesign.tdd.md`  
> **Status:** Green / Refactored (100% Conformance Verified)  
> **Target Directory:** `/home/forart/dev/snake_ts`  
> **Rule Reference:** [`AGENTS.md#rule-1`](file:///home/forart/dev/snake_ts/AGENTS.md), [`AGENTS.md#rule-2`](file:///home/forart/dev/snake_ts/AGENTS.md), [`AGENTS.md#rule-3`](file:///home/forart/dev/snake_ts/AGENTS.md), [`AGENTS.md#rule-6`](file:///home/forart/dev/snake_ts/AGENTS.md), [`AGENTS.md#rule-10`](file:///home/forart/dev/snake_ts/AGENTS.md) & [`ORACLE.md`](file:///home/forart/dev/snake_ts/ORACLE.md)  

---

## 1. Feature Overview & Acoustic Art Direction

### 1.1 Aesthetic Paradigm Shift
The audio architecture of **Ouroboros Ascension** has transitioned from legacy noisy/muddy synthesis into a **pure harmonic, crystal-clear cyber-emerald sound design**. Every sound effect, jingle, and UI transient now adheres to high-fidelity, studio-grade electroacoustic standards tailored to the game's dark obsidian, glowing neon, and serpentine aesthetic.

### 1.2 Core Acoustic Formulas & Physical Principles
1. **Pure Harmonic Overtone Ratios:**
   - Harmonic series synthesis utilizes fundamental frequencies coupled with integer overtones ($f_n = n \cdot f_0$) rather than inharmonic noise clusters:
     $$\text{Chime}(t) = \sum_{k=1}^{K} A_k \sin(2\pi \cdot k f_0 t + \phi_k) e^{-\alpha_k t}$$
   - Triads and celestial intervals adhere to Pythagorean and just intonation intervals:
     - Root ($1:1$), Perfect 5th ($3:2$), Major 3rd ($5:4$), Major 7th ($15:8$), Octave ($2:1$).
     - Example: Ascension chime (D5: $587.33\,\text{Hz} \to$ F#5: $739.99\,\text{Hz} \to$ A5: $880.00\,\text{Hz}$).
     - Example: Celestial helmet reveal (C4: $261.63\,\text{Hz} \to$ E4: $329.63\,\text{Hz} \to$ G4: $392.00\,\text{Hz} \to$ B4: $493.88\,\text{Hz} \to$ D5: $587.33\,\text{Hz}$).

2. **Crisp High-Frequency Transient Articulation ($3.2\,\text{kHz} - 5.0\,\text{kHz}$):**
   - Transients are sculpted using bandpass and highpass filtering centered between $3.2\,\text{kHz}$ and $5.0\,\text{kHz}$ with steep $Q$-factors ($1.5 \le Q \le 3.5$).
   - Transient duration is tightly constrained ($\tau_{\text{click}} \le 18\,\text{ms}$) to impart tactile, crystalline definition without fatigue or harsh high-frequency distortion.

3. **Sub-Bass Fundamentals ($45\,\text{Hz} - 65\,\text{Hz}$):**
   - Tectonic weight and kinetic momentum are driven by pure sine sub-bass foundations ($45\,\text{Hz} \le f_{\text{sub}} \le 65\,\text{Hz}$) with controlled exponential decay envelopes:
     $$S_{\text{sub}}(t) = A_0 \sin\left(2\pi \int_0^t f(\tau) d\tau\right) e^{-t / \tau_{\text{decay}}}$$
   - Mitigates acoustic mud by avoiding overlapping low-mid frequencies ($120\,\text{Hz} - 250\,\text{Hz}$) during high-energy collisions, boss roars, and victory cadences.

4. **Transparent Master Compression (Studio Mastering Parameters):**
   - Implemented via Web Audio `DynamicsCompressorNode` at the audio graph master stage:
     - **Threshold:** $-10.0\,\text{dB}$ (catches peak transients cleanly while maintaining dynamic range)
     - **Knee:** $10.0\,\text{dB}$ (soft-knee transition for natural dynamics)
     - **Ratio:** $6:1$ (transparent program compression preserving punch)
     - **Attack:** $0.002\,\text{s}$ ($2\,\text{ms}$, immediate transient catch preventing DAC clipping)
     - **Release:** $0.120\,\text{s}$ ($120\,\text{ms}$, rapid recovery preventing pumping or breathing artifacts)
   - Guaranteed dynamic safety: SFX Bus + Music Bus $\to$ Master Gain $\to$ Master Compressor $\to$ Destination.

5. **Transparent Sidechain Ducking Timing ($\le 0.55\,\text{s}$):**
   - Default ducking duration: $\tau_{\text{duck}} \le 0.55\,\text{s}$.
   - Fast attack ($50\,\text{ms}$ ramp down to $40\%$ volume) followed by smooth linear ramp recovery to unity gain in $\le 0.55\,\text{s}$, completely eliminating lingering music attenuation during combat and milestone events.

6. **Unified Eating Paradigm ($\le 38\,\text{ms}$):**
   - Single unified eating sound: duration $\le 38\,\text{ms}$ ($0.038\,\text{s}$).
   - Layer 1: Crystalline transient impulse (highpass $2400\,\text{Hz}$, duration $14\,\text{ms}$).
   - Layer 2: Harmonic body thud (triangle wave sweeping $480\,\text{Hz} \to 200\,\text{Hz}$, duration $38\,\text{ms}$).
   - 100% identical acoustic profile across standard apples, golden food, and all combo multipliers. Shards and stars trigger dedicated crystalline stingers (`sfx_star_ding.wav`, `sfx_gem_chime.wav`) without double-triggering `playEat`.

7. **Concise Cyber Jingles ($\le 0.68\,\text{s}$):**
   - All fanfare jingles (Level Up, Victory, Game Over, Boss Alert, Warp Jump) strictly capped at $\le 0.68\,\text{s}$.
   - Eliminates cartoon brass fanfares and prolonged audio clutter.

---

## 2. Test Plan & Conformance Assertions (Red -> Green Phase)

### 2.1 Test Suite 1: `src/tests/UnifiedEatingAndCyberJingles.test.ts`
- **Eating Sound Invariants:**
  - Single unified eating sound has duration $\le 38\,\text{ms}$ ($0.038\,\text{s}$).
  - Pure harmonic profile: highpass transient impulse + $480\,\text{Hz} \to 200\,\text{Hz}$ frequency sweep body thud.
  - Strictly identical `VoiceSpec[]` structure for combo multipliers $1 \dots 20$ and `isGolden = true/false`.
  - SoundEngine dispatches single unified buffer `sfx_eat.wav` across all eating events.
- **Concise Cyber Jingles:**
  - `createLevelUpVoices()`: duration $\le 0.68\,\text{s}$ (nominal $0.45\,\text{s}$), 3-note cyber ascension (D5 $\to$ F#5 $\to$ A5).
  - `createVictoryVoices()`: duration $\le 0.68\,\text{s}$ (nominal $0.65\,\text{s}$), $60\,\text{Hz}$ sub-bass foundation + shimmering resolution.
  - `createGameOverVoices()`: duration $\le 0.68\,\text{s}$ (nominal $0.52\,\text{s}$), $90\,\text{Hz} \to 35\,\text{Hz}$ sub-bass drop.
  - `createBossAlertVoices()`: duration $\le 0.68\,\text{s}$ (nominal $0.58\,\text{s}$), $55\,\text{Hz}$ sub-bass rumble + resonant filter.
  - `createUniqueHelmetRevealVoices()`: duration $\le 0.68\,\text{s}$ (nominal $0.65\,\text{s}$), celestial 5-note pentatonic chord.
  - Sidechain ducking for all milestone events adheres to transparent duration $\le 0.55\,\text{s}$.

### 2.2 Test Suite 2: `src/tests/ProfessionalAudioRedesign.test.ts`
- **Broadcast Assets Verification:**
  - All broadcast WAV files physically exist in `public/assets/audio/`.
  - All files load cleanly, have valid 44,100 Hz 16-bit PCM format, finite samples, and zero clipping.
  - Jingle broadcast WAV assets (`sfx_level_up.wav`, `sfx_victory.wav`, `sfx_game_over.wav`, `sfx_boss_alert.wav`, `sfx_boss_roar.wav`) have durations $\le 0.68\,\text{s}$.
- **Procedural DSP Fallbacks:**
  - All 28 procedural voice recipes synthesize finite, non-NaN, non-infinite PCM audio buffers via `bakeSoundToBuffer()`.
  - Null-safety and Web Audio node lifecycle disconnection on stop/ended to guarantee zero memory leaks.

### 2.3 Test Suite 3: `src/tests/AudioVoiceLimiterAndMasterCompressor.test.ts`
- **Master Compressor Studio Mastering Parameters:**
  - `threshold.value == -10` dB
  - `knee.value == 10` dB
  - `ratio.value == 6` (6:1 compression ratio)
  - `attack.value == 0.002` s ($2\,\text{ms}$)
  - `release.value == 0.120` s ($120\,\text{ms}$)
- **Transparent Ducking Timing:**
  - `duckMusic()` duration $\le 0.55\,\text{s}$.
  - Restore ramp completes within $\le 0.55\,\text{s}$.
  - Major milestone and alert events trigger ducking with duration $\le 0.55\,\text{s}$.
- **Voice Limiter & Concurrency Governance:**
  - Debounce cooldowns enforced: hit ($35\,\text{ms}$), shoot ($40\,\text{ms}$), bite ($40\,\text{ms}$), explosion ($60\,\text{ms}$), thunder ($80\,\text{ms}$).
  - Micro-pitch variation ($\pm 35$ cents) on rapid projectile fire.
  - Decrements active voice count upon voice completion.

### 2.4 Test Suite 4: `src/tests/SoundDispatcherAlignment.test.ts`
- **Clean Audio Routing:**
  - Standard food triggers ONLY `playEat(combo, false)`.
  - Golden food triggers ONLY `playEat(combo, true)`.
  - Star / shard items trigger `playStar` / `playShard` with zero double-triggering of `playEat`.
  - Shield items trigger `playShield` with zero double-triggering of `playEat`.
  - Combat impacts dispatch cleanly to `playBite` / `playHit` / `playExplosion`.
  - State transitions cleanly trigger solitary sound stingers (`playGameOver`, `playVictory`, `playBossAlert`, `playFloorClear`).
  - Galaxy Jump outcomes dispatch cleanly to `playLevelUp` (success) or `playVoidCollapse` (failure).

---

## 3. Implementation Details (Green Phase)

- **Modified Files:**
  - `src/audio/SoundEngine.ts`:
    - Updated master compressor parameters to $-10\,\text{dB}$ threshold, $6:1$ ratio, $2\,\text{ms}$ attack, $120\,\text{ms}$ release.
    - Updated default ducking timing and milestone event ducking durations to transparent timing ($\le 0.55\,\text{s}$).
  - `src/audio/Synth.ts`:
    - Verified and hardened acoustic voice specifications for crystal-clear harmonic profiles.
  - `src/tests/UnifiedEatingAndCyberJingles.test.ts`:
    - Updated and strengthened assertions for unified eating sound ($\le 38\,\text{ms}$, pure harmonic) and jingles ($\le 0.68\,\text{s}$).
  - `src/tests/ProfessionalAudioRedesign.test.ts`:
    - Hardened jingle duration assertions to $\le 0.68\,\text{s}$ and verified broadcast asset loading and pristine fallback voice specs.
  - `src/tests/AudioVoiceLimiterAndMasterCompressor.test.ts`:
    - Updated assertions to match studio mastering parameters ($-10\,\text{dB}$, $6:1$, $2\,\text{ms}$, $120\,\text{ms}$) and transparent ducking timing ($\le 0.55\,\text{s}$).
  - `src/tests/SoundDispatcherAlignment.test.ts`:
    - Validated and broadened clean routing assertions across combat, pickups, and state transitions.

---

## 4. Verification & Quality Gate Conformance

```bash
# 1. Target Audio Test Suites
npx vitest run src/tests/UnifiedEatingAndCyberJingles.test.ts
npx vitest run src/tests/ProfessionalAudioRedesign.test.ts
npx vitest run src/tests/AudioVoiceLimiterAndMasterCompressor.test.ts
npx vitest run src/tests/SoundDispatcherAlignment.test.ts

# 2. Automated Quality Gate
./verify
```

### 4.1 Actual Execution Results (100% Conformance Verified)
- **`UnifiedEatingAndCyberJingles.test.ts`**: 15 / 15 tests passed (100%).
- **`ProfessionalAudioRedesign.test.ts`**: 57 / 57 tests passed (100%).
- **`AudioVoiceLimiterAndMasterCompressor.test.ts`**: 10 / 10 tests passed (100%).
- **`SoundDispatcherAlignment.test.ts`**: 12 / 12 tests passed (100%).
- **Combined Audio Matrix**: 94 / 94 tests passed (100% PASS in 1.87s).
- **Full Project Quality Gate (`./verify`)**:
  - `npm run typecheck`: 100% PASS (0 type errors).
  - Vitest Conformance Matrix: **154 test files passed, 1999 tests passed (100% PASS)**.
  - Production Bundle Build (`vite build`): 100% PASS.

