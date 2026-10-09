# Feature TDD Specification: Procedural Cinematic Audio Redesign

> **Feature Identifier:** `docs/tdd/procedural_cinematic_audio_redesign.tdd.md`  
> **Status:** Red  
> **Target Directory:** `/home/forart/dev/snake_ts`  
> **Rule Reference:** [`AGENTS.md#rule-2`](file:///home/forart/dev/snake_ts/AGENTS.md), [`AGENTS.md#rule-7`](file:///home/forart/dev/snake_ts/AGENTS.md), [`AGENTS.md#rule-10`](file:///home/forart/dev/snake_ts/AGENTS.md) & [`ORACLE.md`](file:///home/forart/dev/snake_ts/ORACLE.md)  

---

## 1. Feature Overview & Requirements

- **High Concept:** Completely replace crude single-oscillator arcade beeps in `SoundEngine.ts` with professional, multi-voice, multi-oscillator layered procedural DSP sounds utilizing `Synth.ts` (PolyBLEP anti-aliased oscillators, RBJ Biquad filters, pink/white noise bursts, pitch envelopes, formant filters, and ADSR curves).
- **Target Systems:** `src/audio/Synth.ts`, `src/audio/SoundEngine.ts`, `src/core/Contracts.ts`.
- **Mechanics Reference:** [`ORACLE.md#audio-synthesis`](file:///home/forart/dev/snake_ts/ORACLE.md), Commercial Viability & 100% Procedural Web Audio Synthesis (Rule 7), Zero Leaks & Headless Safe Execution.

### Acoustic Architecture & Specifications:
1. **Eating & Nourishment**:
   - `playEat(combo, isGolden)`:
     - Organic food pop: highpass noise transient click (12ms) + snappy frequency-dropped pitch envelope ($450\text{ Hz} \to 850\text{ Hz} \to 200\text{ Hz}$). Pitch scales across an ascending diatonic/pentatonic scale based on combo multiplier ($1 \dots 20+$) creating an escalating musical progression.
     - Golden Apple: Crystalline celestial chime with dual harmonized bell overtones ($1200\text{ Hz} + 1796\text{ Hz}$) and shimmering exponential release.
   - `playShard()` / `playStar()`: Cosmic star chime ($C_6 + E_6 + G_6$ arpeggio at $1046.5\text{ Hz}, 1318.5\text{ Hz}, 1567.98\text{ Hz}$) with soft bandpass sparkle.
2. **Combat & Attacks**:
   - `playBite(damage, isCrit)`: Serpentine jaw snap: high-frequency tooth crunch ($1800\text{ Hz}$ noise impulse) + fleshy low-end body thud ($120\text{ Hz} \to 50\text{ Hz}$ sine sweep with soft saturation).
   - `playShoot(freq)`: Modern plasma blaster: FM-chirp ($880\text{ Hz} \to 220\text{ Hz}$ exponential sweep) + tight noise burst with $1.2\text{ kHz}$ lowpass filter.
   - `playLaserFire(freq)`: High-voltage beam crackle: fast modulated sawtooth ($1400\text{ Hz} \to 400\text{ Hz}$) through resonant bandpass filter ($Q=3.0$).
   - `playHit(intensity)`: Punchy impact: snappy metallic transient click ($2.5\text{ kHz}$) + punchy body resonance ($160\text{ Hz} \to 60\text{ Hz}$ decay).
   - `playCrit()`: Heavy critical strike: bright glass-shattering transient + heavy sub-bass drop ($1100\text{ Hz} \to 80\text{ Hz}$) with harmonic ring-modulation shimmer.
   - `playExplosion(intensity)`: Cinematic detonation: multi-layer rumble — initial blast spike (white noise through lowpass sweep $4\text{ kHz} \to 200\text{ Hz}$ with soft-clipping) + sub-bass tectonic boom ($65\text{ Hz} \to 30\text{ Hz}$) with long resonant decay.
   - `playThunder(intensity)`: High-voltage electric crackle ($3$ micro-bursts in $40\text{ ms}$) + rolling low-frequency thunder reverb tail.
   - `playFlame()`: Scorching flamethrower whoosh: warm filtered pink noise ($250\text{ Hz} - 1.2\text{ kHz}$) with dynamic breath envelope.
3. **Serpent Kinematics & Abilities**:
   - `playDash()`: Supersonic displacement: cinematic whoosh with pitch dive, low-end air displacement ($80\text{ Hz} \to 40\text{ Hz}$) + airy high-frequency slipstream.
   - `playSkill()`: Bio-energy surge: sweeping resonant bandpass filter ($300\text{ Hz} \to 2400\text{ Hz}$) over dual detuned sawtooth waves.
   - `playFrenzy()` / `playFrenzyStart()`: Adrenaline burst: rapid ascending power-up riser ($220\text{ Hz} \to 880\text{ Hz}$) + heart-thump sub kick ($90\text{ Hz} \to 45\text{ Hz}$).
   - `playShield()`: Holographic barrier activation: smooth dual-tone harmonic shimmer ($523\text{ Hz} + 659\text{ Hz}$) with soft attack.
   - `playShieldBreak()`: Energetic barrier shatter: resonant highpass noise burst ($3.2\text{ kHz}$) with rapid dissonant crystal decay ($440\text{ Hz} + 466\text{ Hz}$).
4. **Bosses, Health & Milestones**:
   - `playHurt(damage)`: Bio-chitin damage: low-frequency dull impact ($130\text{ Hz} \to 65\text{ Hz}$) with soft high-cut filter ($380\text{ Hz}$) to prevent ear fatigue.
   - `playDie()` / `playGameOver()`: Dramatic pitch-drop decelerating from $440\text{ Hz} \to 40\text{ Hz}$ into dark resonant sub-drone.
   - `playBossAlert(tier)` / `playBossRoar()`: Terrifying primal titan roar: multi-oscillator formant synthesis (vowel-filtered sawtooth at $55\text{ Hz}$ through dual peak filters at $450\text{ Hz}$ and $1100\text{ Hz}$) + sub-bass rumble.
   - `playLevelUp()`: Triumphant fanfare: 4-note ascending major-9th arpeggio ($C_5, E_5, G_5, D_6$) with shimmering PolyBLEP bell harmonics.
   - `playVictory()`: Full celestial cadence with majestic resolution chords and sparkling cosmic dust.
5. **UI Audio**:
   - `playUi()` / `playUiClick()`: Tactile micro-switch click ($1800\text{ Hz}$ highpass impulse, $12\text{ ms}$ decay) — crisp, premium, non-intrusive.
   - `playUiHover()`: Subtle airy blip ($880\text{ Hz}$, $8\text{ ms}$, soft gain $0.04$).
   - `playError()`: Subdued low-frequency double-pulse warning ($140\text{ Hz} \to 120\text{ Hz}$, $80\text{ ms}$).
6. **Auxiliary Game Events**:
   - `playCardPick(rarity)`: Celestial card draft chime with harmonic tiers based on rarity.
   - `playComboTick(combo)`: Resonant wooden/organic combo tick scaled by multiplier.
   - `playRevive()`: Rebirth celestial ascending chime.
   - `playVoidCollapse()`: Gravitational horizon collapse with crushed low-frequency noise.

---

## 2. Test Plan & Assertions (Red Phase)

- **Test Suite Location:** `src/tests/ProfessionalAudioRedesign.test.ts`
- **Assertions:**
  1. Procedural voice generator recipes return multi-layered `VoiceSpec[]` matching required frequencies, filters, and envelopes.
  2. Combo eating calculates ascending pentatonic scale frequencies across combos 1 to 20.
  3. Golden food and star pickups generate harmonized crystalline chord structures.
  4. Combat impacts, explosions, thunder, and bite synthesize transient noise clicks + low-frequency body booms.
  5. Boss roar employs dual formant filters at $450\text{ Hz}$ and $1100\text{ Hz}$ over $55\text{ Hz}$ fundamental.
  6. `SoundEngine` dispatches all 25+ procedural SFX recipes via `playVoiceSpecs` with zero memory leaks.
  7. Headless offline DSP rendering (`bakeSoundToBuffer`) renders non-empty audio signals for all recipes without NaN/Infinity.
  8. Audio graph lifecycle cleans up all allocated nodes upon completion.
  9. Headless safety: zero crashes when Web Audio context is null or unsupported.

---

## 3. Implementation Details (Green Phase)

- **Files Created/Modified:**
  - `src/audio/Synth.ts`: Added procedural voice spec builders for all sounds, real-time `playVoiceSpecs` audio graph compiler with full node lifecycle management and leak prevention.
  - `src/audio/SoundEngine.ts`: Refactored all sound methods to delegate to multi-layered procedural voice specs.
  - `src/tests/ProfessionalAudioRedesign.test.ts`: TDD test suite validating acoustic formulas, headless execution, and leak-free node lifecycles.

---

## 4. Verification & Quality Check

```bash
npx vitest run src/tests/ProfessionalAudioRedesign.test.ts
npm run typecheck
./verify
```
