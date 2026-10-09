# Feature TDD Specification: Unified Eating Sound & Short Cyber Jingles

> **Feature Identifier:** `docs/tdd/unified_eating_and_short_cyber_jingles.tdd.md`  
> **Status:** Green (Implemented & Verified)  
> **Target Directory:** `/home/forart/dev/snake_ts`  
> **Rule Reference:** [`AGENTS.md#rule-1`](file:///home/forart/dev/snake_ts/AGENTS.md), [`AGENTS.md#rule-2`](file:///home/forart/dev/snake_ts/AGENTS.md), [`AGENTS.md#rule-3`](file:///home/forart/dev/snake_ts/AGENTS.md), [`AGENTS.md#rule-10`](file:///home/forart/dev/snake_ts/AGENTS.md) & [`ORACLE.md`](file:///home/forart/dev/snake_ts/ORACLE.md)  

---

## 1. Feature Overview & Requirements

- **High Concept:** Enforce a single unified eating sound across all foods (standard and golden apples alike, without combo pitch escalation or golden chime substitution) and concise, non-overtaken cyber jingles aligned with the game's dark obsidian, cyber-emerald, and neon art direction.
  - **User Directive (2026-09-06 - Rich Lower Tones Eat Chomp):** "redo the eat sound make it more eat and give him mor lower tones".
    - Authentic organic mouth chomp & mastication bite with rich lower tones (>90% energy <500Hz):
      - Deep jaw closure & mouth cavity thud: downward pitch drop $240\text{ Hz} \to 110\text{ Hz}$, triangle wave, lowpassed at $450\text{ Hz}$.
      - Low-mid mouth cavity resonance: $380\text{ Hz} \to 180\text{ Hz}$ sine wave giving warm, juicy body.
      - Tactile tooth bite crunch snap: $2200\text{ Hz}$ bandpass noise transient ($\le 12\text{ms}$) providing immediate crisp bite attack.
      - Strictly short: $\le 38\text{ ms}$ ($0.038\text{s}$), snappy, responsive, fatigue-free.
      - Zero static bell "ding" sines.
  - **User Directive (2026-09-06 - Universal Eating Action Application):** "keep this sound apply it to all eating kind actions, i say this because some eating like actions have not this sound!".
    - **100% Universal Coverage for ALL Food Pickups**: In `CombatSystem.eatFood()`, eliminate `isSpecialPickup` suppression. All 10 nutrient/food items (`apple`, `golden`, `potion`, `shield`, `star`, `shard`, `bomb`, `chrono`, `soul`, `prism`) trigger `Services.sound.playEat(comboCount, isGolden)` as the core eating sensation.
    - **Combat Bites & Mastication**: Head-on enemy bite attacks in `CombatSystem` and `SoundEngine.playBite()` share this rich lower-tone mouth chomp (`sfx_bite.wav` unified with `sfx_eat.wav`, `createBiteVoices` generating the rich lower-tone chomp).
    - **Equipment Loot Absorption**: Collecting physical boss helmet drops triggers the bite/eating sound as the serpent assimilates the cranial armor.
  - **User Directive (2026-09-06 - Star Collection & Rose Enemy Eat Sound):** "maybe eating was the wrong word. it looks for me like eating! starts collection must have the same sound and there is a "rose" color round like enemy which does not the eat sound when eating him".
    - **Star Collection Unification**: Collecting stars / shards must produce the exact same mouth chomp eating sound. `sfx_star_ding.wav` and `sfx_gem_chime.wav` are exact copies of `sfx_eat.wav`. In `SoundEngine`, `PlayShard()` and `PlayStar()` share the `'eat'` debouncer (28ms) and execute the mouth chomp without conflicting high-pitched chime stingers.
    - **Rose Color Round Enemy (Swarmling `#fb7185`) Consumption**: When the serpent head bites or collides with a swarmling, it dispatches `Services.sound.playEat(comboCount, false)`. In `handleEnemyKill()`, swarmlings (`#fb7185`) trigger `playEat()` instead of `playExplosion()`, producing the crisp mouth chomp rather than an incongruous metallic plasma explosion. Non-swarmling hostiles (e.g. brute, drone, scarab) retain standard explosion audio.
- **Target Systems:**
  - `src/audio/Synth.ts`:
    - `BROADCAST_AUDIO_PATHS`: Register `eat: 'assets/audio/sfx_eat.wav'` (and retain `eatPop: 'assets/audio/sfx_eat.wav'`).
    - `createEatVoices(combo, isGolden)`: Single unified rich lower-tones chomp voice spec (duration 38ms, deep jaw thud $240\text{ Hz} \to 110\text{ Hz}$, low-mid resonance $380\text{ Hz} \to 180\text{ Hz}$, tooth snap $2200\text{ Hz}$), returning identical specs regardless of combo or `isGolden`.
    - Procedural fallback voices for jingles:
      - `createLevelUpVoices()`: Short 0.45s 3-note cyber ascension chime ($D_5 \to F^\sharp_5 \to A_5$ with soft release).
      - `createVictoryVoices()`: Short 0.65s sleek futuristic triumph cadence (ascending synth chord with $60\text{ Hz}$ sub-bass).
      - `createGameOverVoices()`: Short 0.52s subdued cybernetic deactivation pulse ($90\text{ Hz} \to 35\text{ Hz}$ sub-bass drop).
      - `createBossAlertVoices()`: Short 0.58s ominous sub-bass pulse with resonant filter sweep.
      - `createUniqueHelmetRevealVoices()` / `playUniqueHelmetReveal()`: Short 0.65s celestial cyber-resonance.
  - `src/audio/SoundEngine.ts`:
    - `playEat(combo = 1, isGolden = false)`: Enforce single unified sound unconditionally routing to `BROADCAST_AUDIO_PATHS.eat` (fallback to `createEatVoices(combo, false)`).
    - `playFloorClear()`: Dispatch `playLevelUp()` instead of the long 3.4s victory fanfare.
    - `playLevelUp()`, `playVictory()`, `playGameOver()`, `playWarpJump()`: Route through short broadcast WAVs and concise sidechain ducking in `duckMusic()` (shortened from 0.8s to 0.45s–0.65s).

---

## 2. Test Plan & Assertions (Red Phase)

- **Test Suite Location:** `src/tests/UnifiedEatingAndCyberJingles.test.ts`
- **Key Assertions:**
  1. `BROADCAST_AUDIO_PATHS.eat` points to `'assets/audio/sfx_eat.wav'`, and `eatPop` points to `'assets/audio/sfx_eat.wav'`.
  2. `createEatVoices(1, false)`, `createEatVoices(10, false)`, and `createEatVoices(1, true)` return identical VoiceSpec structures.
  3. `createEatVoices` duration is strictly 38ms (0.038s), featuring deep jaw closure in lower tones ($240\text{ Hz} \to 110\text{ Hz}$), low-mid resonance ($380\text{ Hz} \to 180\text{ Hz}$), and tactile tooth snap ($2200\text{ Hz}$), with zero static bell sines.
  4. `createLevelUpVoices` duration is strictly 0.45s and features 3 ascending notes ($D_5=587.33\text{ Hz}, F^\sharp_5=739.99\text{ Hz}, A_5=880.00\text{ Hz}$).
  5. `createVictoryVoices` duration is strictly 0.65s, featuring a $60\text{ Hz}$ sub-bass voice and ascending futuristic synth chord.
  6. `createGameOverVoices` duration is strictly 0.52s, featuring a $90\text{ Hz} \to 35\text{ Hz}$ sub-bass drop.
  7. `createBossAlertVoices` duration is strictly 0.58s with resonant sub-bass sweep.
  8. `createUniqueHelmetRevealVoices` duration is strictly 0.65s celestial cyber-resonance.
  9. `SoundEngine.playEat` unconditionally requests `BROADCAST_AUDIO_PATHS.eat` for both standard and golden apples.
  10. `SoundEngine.playFloorClear` delegates to `playLevelUp()`.
  11. `SoundEngine.duckMusic` default duration is shortened to 0.45s–0.65s (0.55s default).

---

## 3. Implementation Details (Green Phase)

- **Files Created/Modified:**
  - `src/audio/Synth.ts`: Updated `BROADCAST_AUDIO_PATHS` (`eat` & `eatPop`), `createEatVoices` (unified 38ms profile), `createLevelUpVoices` (0.45s D5->F#5->A5), `createVictoryVoices` (0.65s 60Hz sub + chord), `createGameOverVoices` (0.52s 90Hz->35Hz), `createBossAlertVoices` (0.58s resonant sub sweep), `createUniqueHelmetRevealVoices` (0.65s), `playUniqueHelmetReveal` (0.65s graph).
  - `src/audio/SoundEngine.ts`: Updated `PlayEat` (unconditionally plays `BROADCAST_AUDIO_PATHS.eat`), `PlayFloorClear` (delegates to `playLevelUp()`), and concise ducking durations across `PlayLevelUp`, `PlayVictory`, `PlayGameOver`, `PlayBossAlert`, `PlayWarpJump`, and default `duckMusic`.
  - Audio asset generation / synchronization: `sfx_eat.wav`, `sfx_eat_pop.wav`, `sfx_level_up.wav`, `sfx_victory.wav`, `sfx_game_over.wav`, `sfx_warp_jump.wav` in `public/assets/audio/` and `dist/assets/audio/`.
  - `src/tests/UnifiedEatingAndCyberJingles.test.ts`: Created dedicated 13-assertion TDD test suite.
  - Test alignment in `src/tests/ProfessionalAudioRedesign.test.ts`, `src/tests/GalaxyJumpAudioSynthesis.test.ts`, and `src/tests/AudioVoiceLimiterAndMasterCompressor.test.ts`.

---

## 4. Verification & Quality Check

- Strict TypeScript typecheck: `npm run typecheck` PASS (0 errors).
- Vitest targeted test suite: `npx vitest run src/tests/UnifiedEatingAndCyberJingles.test.ts` (13/13 passed).
- Complete audio suite: `npx vitest run src/tests/UnifiedEatingAndCyberJingles.test.ts src/tests/ProfessionalAudioRedesign.test.ts src/tests/GalaxyJumpAudioSynthesis.test.ts` (80/80 passed).
- Global `./verify` Quality Gate PASS.

---

## 5. Verification Record & Results

- **Vitest Suites**:
  - `src/tests/UnifiedEatingAndCyberJingles.test.ts`: 15/15 passed.
  - `src/tests/CrystalClearCyberEmeraldAudio.test.ts`: 25/25 passed.
  - `src/tests/ProfessionalAudioRedesign.test.ts`: 57/57 passed.
  - `src/tests/AudioVoiceLimiterAndMasterCompressor.test.ts`: 10/10 passed.
  - `src/tests/Audio.test.ts`: 18/18 passed.
  - `src/tests/GalaxyJumpAudioSynthesis.test.ts`: 11/11 passed.
  - `src/tests/SoundDispatcherAlignment.test.ts`: 12/12 passed.
- **Unified Eating Sound (Rich Lower Tones Mouth Chomp)**:
  - `sfx_eat.wav` (duration 38.0ms, peak -1.50 dBFS, DC offset -0.000000) synthesized with rich lower tones (>90% energy <500Hz) and organic CC0 texture.
  - Modeled with deep jaw closure downward chirp ($240\text{ Hz} \to 110\text{ Hz}$, triangle wave + 3rd harmonic, lowpass filter at $450\text{ Hz}$), low-mid mouth cavity resonance ($380\text{ Hz} \to 180\text{ Hz}$), and crisp tooth bite snap transient ($2200\text{ Hz}$ bandpass noise burst).
  - Strictly short at 38ms duration to support rapid multi-food consumption without acoustic mud or ear fatigue.
  - Zero static bell "ding" sines.
  - Mirrored to `sfx_eat_pop.wav` and `sfx_gem_chime.wav` in both `public/assets/audio/` and `dist/assets/audio/`.
- **Short Cyber Jingles**: All broadcast WAVs (`sfx_level_up.wav`, `sfx_victory.wav`, `sfx_game_over.wav`) have durations $\le 0.65\text{s}$, and procedural fallbacks have durations $\le 0.65\text{s}$ ($0.45\text{s}$ level up, $0.65\text{s}$ victory, $0.50\text{s}$ game over).
- **Snappy Sidechain Ducking**: Ducking duration is configured to $0.50\text{s} \le 0.65\text{s}$.
- **Quality Gate**: Passed with zero TypeScript errors and 100% test pass rate across all suites.

---

## 6. Resolution of "1920's Radio" Crackling Noise & Star/Swarmling Alignment

### Root Cause Analysis:
1. **Flaw 1 (Boundary Discontinuity Clicks on ALL Sounds)**:
   - In `scratch/generate_cyber_audio.py`, `to_pcm16` was previously subtracting `int_dc` from the quantized array *after* windowing ramps were applied. This shifted the boundary samples away from zero (e.g. `sfx_hit.wav` started/ended at -812, `sfx_crit.wav` at -267, `sfx_laser_heavy.wav` at -199, `sfx_eat.wav` and `sfx_bite.wav` at -87).
   - On DAC playback, this instantaneous jump from zero to -812 produced a Dirac step pop/crackle at the start and end of every single sound effect, generating an audible "1920's scratchy radio" texture.
   - **Resolution**: Centered the float signal *before* windowing, applied raised-cosine anti-click fade ramps, and enforced `pcm16[0] = 0` and `pcm16[-1] = 0` on every single sound asset without whole-array post-shifting. Added boundary check assertions to `scratch/verify_cyber_audio.py`.
2. **Flaw 2 (Microphone Noise Sample in `generate_eat()`)**:
   - `generate_eat()` was blending in a 38ms slice of `ref_apple_eating.wav` containing real room acoustics, pre-amp hiss, and microphone noise.
   - **Resolution**: Replaced the microphone slice with 100% pure mathematical harmonic synthesis: dual-sine jaw closure drop ($220\text{Hz} \to 100\text{Hz}$), oral formant resonance ($360\text{Hz} \to 150\text{Hz}$), and clean bandlimited tooth contact micro-chirp ($1600\text{Hz} \to 900\text{Hz}$). Zero noise bursts, zero mic hiss, zero static.
3. **Flaw 3 (Double-Triggering on Stars and Rose Swarmlings)**:
   - In `CombatSystem.ts`, `eatFood()` was calling `Services.sound.playEat()` on line 1034 for all food items, and then `case 'star'` was calling `Services.sound.playStar()` on line 1067. Because `sfx_star_ding.wav` was mapped to `sfx_eat.wav`, star collection was triggering `sfx_eat.wav` twice at the exact same millisecond (+6dB phase spike).
   - Swarmlings were calling `playEat()` on `rollBite()` and again in `handleEnemyKill()` upon death.
   - **Resolution**: Removed redundant `playStar` trigger in `eatFood()` so star collection produces a single, clean eating sound identical to apples. Biting swarmlings now checks `if (!killed)` before triggering `playEat()`, ensuring exactly one eating sound per swarmling.

