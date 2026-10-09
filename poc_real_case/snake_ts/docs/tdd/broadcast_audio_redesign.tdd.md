# Feature TDD Specification: Broadcast-Quality Audio Assets & Cybernetic Sound Design

> **Feature Identifier:** `docs/tdd/broadcast_audio_redesign.tdd.md`  
> **Status:** Green / Refactored  
> **Target Directory:** `/home/forart/dev/snake_ts`  
> **Rule Reference:** [`AGENTS.md#rule-2`](file:///home/forart/dev/snake_ts/AGENTS.md), [`AGENTS.md#rule-10`](file:///home/forart/dev/snake_ts/AGENTS.md) & [`ORACLE.md`](file:///home/forart/dev/snake_ts/ORACLE.md)  

---

## 1. Feature Overview & Requirements

- **High Concept:** Integrated broadcast-quality 44.1kHz 16-bit PCM WAV audio assets and high-fidelity cybernetic sound design into Ouroboros Ascension. The audio architecture incorporates pre-rendered broadcast audio buffers with seamless procedural DSP fallback, ensuring pristine acoustic presentation in the browser while maintaining 100% headless testability and deterministic offline execution.
- **Art Direction Alignment:** Cyber-emerald, obsidian, and neon chromatic aesthetic. Replaces harsh lo-fi square waves with warm bandpassed layers, FM synthesis, crystalline chimes, deep resonant sub-bass booms, and organic cybernetic transients.
- **Target Systems:**
  - `public/assets/audio/`: Pre-rendered broadcast WAV assets.
  - `src/audio/Synth.ts`: Web Audio buffer caching, buffer playback handle, and tuned procedural cybernetic voice specifications.
  - `src/audio/SoundEngine.ts`: Asset preloading, hybrid broadcast buffer dispatch with procedural DSP fallback, and volume routing.
  - `src/tests/ProfessionalAudioRedesign.test.ts`: TDD suite for buffer preloading, asset playback, fallback behavior, and zero-leak memory lifecycle.
  - `src/tests/GalaxyJumpAudioSynthesis.test.ts`: Hyperspace warp jump and helmet reveal audio verification.
- **Mechanics & Audio Mapping:**
  1. Warp Jump: `sfx_warp_jump.wav` (Cosmic acceleration, bandpass noise rush, sub-bass rift boom)
  2. Star / Shard Pickup: `sfx_star_ding.wav` (High-register crystalline chime)
  3. Golden Apple / Celestial Chime: `sfx_gem_chime.wav` (Harmonic crystal transient)
  4. Apple Eating Pop: `sfx_eat_pop.wav` (Crisp cyber-bite pop / crunch <50ms: transient click + 450Hz->850Hz->200Hz frequency-dropped thud)
  5. Forcefield / Shield Activate: `sfx_shield_on.wav` (Energy barrier harmonic swell)
  6. Shield Depleted / Break: `sfx_shield_break.wav` (Powerdown surge & resonant crack)
  7. Laser Standard Pew: `sfx_laser_pew.wav` (Focused plasma discharge)
  8. Laser Heavy Cannon: `sfx_laser_heavy.wav` (Hyper-velocity rail/cannon blast)
  9. UI Mechanical Click: `sfx_ui_click.wav` (Tactile mechanical switch)
  10. UI Tab Switch: `sfx_ui_tab.wav` (Crisp aerodynamic interface flick)
  11. Level Up Fanfare: `sfx_level_up.wav` (Ascending maj7 chord sparkle & brass lift)
  12. Victory Triumph Fanfare: `sfx_victory.wav` (Heroic orchestral brass fanfare)
  13. Game Over Somber Horns: `sfx_game_over.wav` (Sub-bass impact & dissonant horns)
  14. Alien Leviathan Boss Roar: `sfx_boss_roar.wav` (Guttural multi-head resonance)
  15. Afterburner Dash Roar: `sfx_dash.wav` (Combustion impulse & thruster burn)
  16. Exploration Music Track: `music_exploration.wav` (Tron digital frontier synth loop)
  17. Combat Music Track: `music_combat.wav` (Light cycle battle arena synth loop)
  18. Boss Music Track: `music_boss.wav` (Cluz armada war carrier synth loop)

---

## 2. Test Plan & Assertions (Red Phase)

- **Test Suite Location:**
  - `src/tests/ProfessionalAudioRedesign.test.ts`
  - `src/tests/GalaxyJumpAudioSynthesis.test.ts`
- **Assertions:**
  1. `loadAudioBuffer` safely attempts fetch/decode and caches decoded `AudioBuffer` in memory.
  2. `loadAudioBuffer` handles fetch failures and headless environments by returning `null` without throwing errors.
  3. `playAudioBuffer` plays a cached `AudioBuffer` through the audio graph and returns a valid `AudioPlaybackHandle` that properly disconnects nodes on `stop()` or `onended`.
  4. `SoundEngine.preloadBroadcastAudio()` initiates preloading for all 18 broadcast assets.
  5. `SoundEngine` dispatches broadcast audio buffers when loaded, and falls back to procedural `playVoices()` / `Synth.ts` when buffers are absent or running headlessly.
  6. `SoundEngine.playEat` separates standard apples (`eatPop: 'assets/audio/sfx_eat_pop.wav'`) from golden apples (`gemChime: 'assets/audio/sfx_gem_chime.wav'`), eliminating bell-wall clutter.
  7. Procedural `createEatVoices` produces a punchy, warm, organic cyber-bite crunch (<50ms) with combo-based pentatonic pitch ascension ($1..20$).
  8. `playShard()` triggers `starDing` and `playStar()` triggers `gemChime`.
  9. Broadcast music track paths (`musicExploration`, `musicCombat`, `musicBoss`) are registered in `BROADCAST_AUDIO_PATHS` and point to valid WAV assets.
  10. All sound dispatcher methods execute headlessly without exceptions or memory leaks.

---

## 3. Implementation Details (Green Phase)

- **Files Created/Modified:**
  - `public/assets/audio/sfx_eat_pop.wav`: 42ms crisp cyber-bite pop (44.1kHz 16-bit PCM).
  - `public/assets/audio/music_exploration.wav`: Tron digital frontier loop.
  - `public/assets/audio/music_combat.wav`: Tron light cycle arena loop.
  - `public/assets/audio/music_boss.wav`: Tron Cluz armada loop.
  - `src/audio/Synth.ts`: Added `eatPop`, `musicExploration`, `musicCombat`, `musicBoss` to `BROADCAST_AUDIO_PATHS`. Tuned `createEatVoices` for crisp <50ms body pop.
  - `src/audio/SoundEngine.ts`: Updated `playEat(combo, isGolden)` to route standard food to `eatPop` and golden food to `gemChime`. Ensured `playShard` / `playStar` maintain correct mapping.
  - `src/tests/ProfessionalAudioRedesign.test.ts`: Added assertions for `eatPop`, golden apple routing, music track registration, and buffer caching.

---

## 4. Verification & Quality Check

```bash
npx vitest run src/tests/ProfessionalAudioRedesign.test.ts
npm run typecheck
./verify
```
