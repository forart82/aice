# Feature TDD Specification: Crystal-Clear Cyber-Emerald Audio Engine Overhaul

> **Feature Identifier:** `docs/tdd/crystal_clear_cyber_emerald_audio_overhaul.tdd.md`  
> **Status:** Green / Refactored (100% Quality Gate PASS, 154/154 Suites, 1,999/1,999 Tests)  
> **Target Directory:** `/home/forart/dev/snake_ts`  
> **Rule Reference:** [`AGENTS.md#rule-1`](file:///home/forart/dev/snake_ts/AGENTS.md), [`AGENTS.md#rule-2`](file:///home/forart/dev/snake_ts/AGENTS.md), [`AGENTS.md#rule-3`](file:///home/forart/dev/snake_ts/AGENTS.md), [`AGENTS.md#rule-10`](file:///home/forart/dev/snake_ts/AGENTS.md) & [`ORACLE.md`](file:///home/forart/dev/snake_ts/ORACLE.md)  

---

## 1. Feature Overview & Acoustic Directives

### 1.1 Acoustic Principles
1. **Pure Harmonic Clarity**: Replace harsh, distorted, noisy oscillator stacks with pure sine and triangle waveforms, exact mathematical overtone ratios (octaves $2:1$, fifths $3:2$, major tenths $5:2$), micro-second attack envelopes ($\tau_{\text{att}} \le 2\text{ms}$), and silky exponential decays.
2. **Elimination of Muddy Resonance & Harsh Noise**: Banish muddy low-mids ($200\text{Hz} - 500\text{Hz}$) and sustained harsh static noise bursts across all procedural voice specifications.

### 1.2 Recipe Specifications (`src/audio/Synth.ts`)
- **`createEatVoices(combo, isGolden)`**: Unified 38ms organic-cyber "moim" mouth bite. Pure vocalic body sweep ($240\text{Hz} \to 380\text{Hz}$) + formant diphthong ($480\text{Hz} \to 220\text{Hz}$) with soft lip pop transient ($520\text{Hz}$ bandpass, $\le 8\text{ms}$). Zero bell "ding" frequencies! Identical for all food pickups!
- **`createStarVoices()`**: Crystalline celestial ping ($1760.00\text{Hz} + 2637.02\text{Hz}$, A6 + E7 $3:2$ fifth ratio, $80\text{ms}$).
- **`createLevelUpVoices()`**: Short 450ms ascending 3-note cyber ascension chime ($880.00\text{Hz} \to 1108.73\text{Hz} \to 1318.51\text{Hz} \to 1760.00\text{Hz}$) anchored by a clean $65\text{Hz}$ sub-bass foundation. Open, bright, clean frequency response.
- **`createVictoryVoices()`**: Short 650ms rising cyber-triumph cadence (E5 $659.25\text{Hz} \to$ B5 $987.77\text{Hz} \to$ E6 $1318.51\text{Hz} \to$ G#6 $1661.22\text{Hz}$) with $50\text{Hz}$ sub-bass anchor.
- **`createGameOverVoices()`**: Short 500ms clean deactivation pulse ($440.00\text{Hz} \to 55.00\text{Hz}$ pure sine glide down 3 octaves).
- **`createShootVoices(freq)`**: Tight 60ms FM laser chirp ($1400\text{Hz} \to 350\text{Hz}$) with $4.5\text{kHz}$ transient snap. Zero white noise (`isNoise: false` for all voices).
- **`createLaserFireVoices(freq)`**: Crisp 95ms heavy blaster chirp ($650\text{Hz} \to 180\text{Hz}$) with punchy $60\text{Hz}$ sub thud.
- **`createHitVoices(intensity)`**: Punchy 30ms tactile cyber-impact ($3.2\text{kHz}$ transient snap $+ 110\text{Hz}$ sub kick).
- **`createBiteVoices(damage, isCrit)`**: Quick 32ms chitin snap $+ 120\text{Hz}$ thud (clean, zero waveshaper distortion).
- **`createExplosionVoices(intensity)`**: Clean 250ms cyber-plasma detonation: bright $2.6\text{kHz}$ transient flash $+ 55\text{Hz}$ deep sub-bass boom (no 400ms distorted noise wash).
- **`createDashVoices()`**: Smooth 140ms aerodynamic slipstream whoosh with $60\text{Hz}$ sub-bass displacement.
- **`createShieldVoices()`**: 130ms dual harmonic swell ($659.25\text{Hz} + 987.77\text{Hz}$, E5 + B5).
- **`createShieldBreakVoices()`**: 140ms crystalline shatter ($2800\text{Hz} \to 1200\text{Hz}$ downward sweep).
- **`createBossAlertVoices(tier)`**: 580ms ominous sub-bass pulse ($45\text{Hz}$ sub $+ 880\text{Hz}$ harmonic).
- **`createUiClickVoices()` / `createUiHoverVoices()`**: 10ms pure tactile glass clicks ($3200\text{Hz} / 4000\text{Hz}$).
- **`createCritVoices()`**: Clean 90ms cyber-snap ($2400\text{Hz}$ snap $+ 120\text{Hz}$ sub).

---

## 2. Test Plan & Assertions (Red Phase)

- **Test File:** `src/tests/CrystalClearCyberEmeraldAudio.test.ts`
- **Unit & Conformance Checks:**
  1. Conformance of all 16 recipes to exact pitch, duration, and envelope bounds.
  2. Zero noise assertions on `createShootVoices`.
  3. Strict duration assertions verifying snappy responses:
     - `createEatVoices`: $\le 0.038\text{s}$ ($38\text{ms}$).
     - `createStarVoices`: $\le 0.080\text{s}$ ($80\text{ms}$).
     - `createLevelUpVoices`: $\le 0.450\text{s}$ ($450\text{ms}$).
     - `createVictoryVoices`: $\le 0.650\text{s}$ ($650\text{ms}$).
     - `createGameOverVoices`: $\le 0.500\text{s}$ ($500\text{ms}$).
     - `createShootVoices`: $\le 0.060\text{s}$ ($60\text{ms}$).
     - `createLaserFireVoices`: $\le 0.095\text{s}$ ($95\text{ms}$).
     - `createHitVoices`: $\le 0.030\text{s}$ ($30\text{ms}$).
     - `createBiteVoices`: $\le 0.032\text{s}$ ($32\text{ms}$).
     - `createExplosionVoices`: $\le 0.250\text{s}$ ($250\text{ms}$).
     - `createDashVoices`: $\le 0.140\text{s}$ ($140\text{ms}$).
     - `createShieldVoices`: $\le 0.130\text{s}$ ($130\text{ms}$).
     - `createShieldBreakVoices`: $\le 0.140\text{s}$ ($140\text{ms}$).
     - `createBossAlertVoices`: $\le 0.580\text{s}$ ($580\text{ms}$).
     - `createUiClickVoices` & `createUiHoverVoices`: $\le 0.010\text{s}$ ($10\text{ms}$).
     - `createCritVoices`: $\le 0.090\text{s}$ ($90\text{ms}$).
  4. Headless offline DSP rendering: `bakeSoundToBuffer` generates valid, non-zero, finite PCM without NaN or Infinity for all recipes.

---

## 3. SoundEngine Routing, Mixing & Audio Mastering Directives

### 3.1 Dispatcher Standardization
- Standardize all 18 dispatchers (`playEat`, `playStar`, `playShard`, `playShoot`, `playLaserFire`, `playHit`, `playBite`, `playCrit`, `playExplosion`, `playDash`, `playShield`, `playShieldBreak`, `playLevelUp`, `playVictory`, `playGameOver`, `playBossAlert`, `playUiClick`, `playUiHover`) on `playBroadcastOrFallback(BROADCAST_AUDIO_PATHS.<key>, () => this.playVoices(create<Key>Voices()))`.
- Enforce single unified eating sound `BROADCAST_AUDIO_PATHS.eat` for all `playEat(...)` calls.
- Support broadcast playback and concurrency limiters on `playCrit` and `playBite`.

### 3.2 Master Dynamics Compressor
- **Threshold**: `-10 dB` (catches excessive peaks without crushing signal)
- **Knee**: `12 dB` (smooth transition curve)
- **Ratio**: `6:1` (transparent, pristine cybernetic mastering curve preserving punch)
- **Attack**: `0.002 s` (2ms ultra-fast transient catch)
- **Release**: `0.12 s` (120ms natural musical release)

### 3.3 Gain Balancing & Sidechain Ducking
- **SFX Bus Volume**: `0.75`
- **Music Bus Volume**: `0.38` (creates clean acoustic headroom so SFX snaps punch through)
- **Ducking**: Quick `0.03 s` ramp-down to `40%` volume, smooth `0.50 s` recovery on combat/milestones.

---

## 4. MusicPlayer Clean Filter & Anti-Thump Directives

### 4.1 Master Mood Lowpass Filter Cutoff Frequencies
- **Exploration**: `18,000 Hz` (bright, sparkling, wide-open synthwave soundscape)
- **Combat / Boss / Frenzy**: `20,000 Hz` (fully open, unconstrained transient punch)
- **Paused**: `400 Hz` (muffled ambient immersion behind pause menu)

### 4.2 Sidechain Ducking Anti-Thump Engineering
- Utilize smooth `0.03 s` attack ramp and `cancelAndHoldAtTime` or scheduled ramp value capture to prevent DC steps or click pops.

---

## 5. Test Plan & Conformance Assertions

- **Test Suite:** `src/tests/CrystalClearCyberEmeraldAudio.test.ts`
  * Section 18: Master Dynamics Compressor settings verification (-10dB, 12dB, 6:1, 0.002s, 0.12s).
  * Section 19: Bus gain levels (SFX 0.75, Music 0.38).
  * Section 20: Sidechain ducking parameters (0.03s attack to 0.40, 0.50s release).
  * Section 21: Full 18-dispatcher standardization and broadcast/fallback routing.
  * Section 22: MusicPlayer `moodFilter` cutoff frequencies (18kHz, 20kHz, 400Hz) and click-free ducking.

---

## 6. Implementation Status
- **Current Phase:** Green / Fully Verified
- **Verification Summary:**
  - TypeScript compilation: 0 errors (`npm run typecheck` PASS).
  - Dedicated Conformance Suite: `src/tests/CrystalClearCyberEmeraldAudio.test.ts` (25/25 PASS, 100%).
  - Audio Conformance Suites: 6 suites (137/137 tests PASS, 100%).
  - Full Repository Quality Gate: `./verify` (154/154 test suites, 2,007/2,007 tests PASS, Production Bundle build PASS).

