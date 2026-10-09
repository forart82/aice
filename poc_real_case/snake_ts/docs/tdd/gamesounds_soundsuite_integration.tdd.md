# Feature TDD Specification: Gamesounds Audio Suite Deep Integration & Complete Asset Deployment

> **Feature Identifier:** `docs/tdd/gamesounds_soundsuite_integration.tdd.md`  
> **Status:** Green (100% Quality Gate PASS)  
> **Target Directory:** `/home/forart/dev/snake_ts`  
> **Rule Reference:** [`AGENTS.md#rule-2`](file:///home/forart/dev/snake_ts/AGENTS.md) & [`ORACLE.md`](file:///home/forart/dev/snake_ts/ORACLE.md)  

---

## 1. Feature Overview & Requirements

- **High Concept:** Fully analyze, verify, and integrate the custom sound suite delivered in `/home/forart/dev/gamesounds/snake_ts` into the `snake_ts` Web Audio engine.
- **Target Systems:**
  - Assets: `public/assets/audio/` (28 WAV files + 28 `.audio.meta.json` sidecars)
  - Audio Engine: `src/audio/Synth.ts`, `src/audio/SoundEngine.ts`, `src/audio/MusicPlayer.ts`
  - Tests: `src/tests/GamesoundsAudioSuiteIntegration.test.ts`
- **Acoustic Standards:**
  - Peak Normalization: Strict $\le -1.0\text{ dBFS}$ on all 28 assets.
  - DC Bias: $0.00$ DC offset.
  - Zero Crackle: 3.0ms raised-cosine micro-fades at start/end of every buffer.
  - Multi-Take Anti-Machine-Gun: `eatPop01` through `eatPop04` multi-take variation support.
  - Seamless Music Loops: Loop seam score $S \le 0.025$, 0 dB amplitude step across loop boundaries.
  - 100% Commercial Viability (Rule 7) and Zero Canvas 2D (Rule 12).

---

## 2. Test Plan & Assertions (Red Phase)

- **Test Suite Location:** `src/tests/GamesoundsAudioSuiteIntegration.test.ts`
- **Assertions:**
  1. All 28 WAV files and 28 sidecars exist in `public/assets/audio/` with valid file sizes (> 100 bytes).
  2. `BROADCAST_AUDIO_PATHS` in `Synth.ts` contains all 28 canonical broadcast paths:
     - 5 UI sounds: `uiClick`, `uiTab`, `levelUp`, `victory`, `gameOver`.
     - 10 Combat sounds: `bite`, `hit`, `laserPew`, `laserHeavy`, `crit`, `explosion`, `shieldOn`, `shieldBreak`, `bossAlert`, `bossRoar`.
     - 10 Movement & Pickup sounds: `dash`, `warpJump`, `eat`, `eatPop`, `eatPop01`, `eatPop02`, `eatPop03`, `eatPop04`, `starDing`, `gemChime`.
     - 3 Music tracks: `musicExploration`, `musicCombat`, `musicBoss`.
  3. `EAT_POP_VARIATION_PATHS` array is exported with exactly 4 entries (`eatPop01` through `eatPop04`).
  4. `SoundEngine.PlayBossAlert()` dispatches `BROADCAST_AUDIO_PATHS.bossRoar` (or `bossAlert` where configured).
  5. `preloadBroadcastAudio()` properly preloads all registered paths in `BROADCAST_AUDIO_PATHS`.
  6. All 3 music tracks (`music_exploration.wav`, `music_combat.wav`, `music_boss.wav`) are recognized by `BROADCAST_MUSIC_PATHS` and `MusicPlayer`.
  7. Headless DSP offline bake verification: No NaN or infinite samples in any synthesized fallback voice.

---

## 3. Implementation Details (Green Phase)

- **Files Modified:**
  - `src/audio/Synth.ts`: Added `eatPop01`, `eatPop02`, `eatPop03`, `eatPop04` to `BROADCAST_AUDIO_PATHS`, exported `EAT_POP_VARIATION_PATHS`.
  - `src/audio/SoundEngine.ts`: Added `getEatPopVariationPath` anti-machine-gun round-robin helper.
  - `src/tests/GamesoundsAudioSuiteIntegration.test.ts`: Created comprehensive 9-test integration suite.

---

## 4. Verification & Quality Check

```bash
# Focused Audio Suites (125 tests)
npx vitest run src/tests/GamesoundsAudioSuiteIntegration.test.ts src/tests/UnifiedEatingAndCyberJingles.test.ts src/tests/ProfessionalAudioRedesign.test.ts src/tests/CrystalClearCyberEmeraldAudio.test.ts src/tests/AudioPerformanceAndAllocationOptimization.test.ts src/tests/AudioVoiceLimiterAndMasterCompressor.test.ts
# Result: 6/6 test files passed, 125/125 tests passed (100% PASS)

# Full Quality Gate
./verify
# Result: Strict TypeScript typecheck PASS, 170/170 Vitest test files passed, 2,280/2,280 tests passed, Production build PASS.
```
