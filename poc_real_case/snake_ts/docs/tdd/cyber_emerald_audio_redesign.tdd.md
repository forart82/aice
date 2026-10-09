# Feature TDD Specification: Cyber-Emerald Audio Redesign & Unified Broadcast Sound Assets

> **Feature Identifier:** `docs/tdd/cyber_emerald_audio_redesign.tdd.md`  
> **Status:** Green / Refactored (100% Verified)  
> **Target Directory:** `/home/forart/dev/snake_ts`  
> **Rule Reference:** [`AGENTS.md#rule-1`](file:///home/forart/dev/snake_ts/AGENTS.md), [`AGENTS.md#rule-2`](file:///home/forart/dev/snake_ts/AGENTS.md), [`AGENTS.md#rule-3`](file:///home/forart/dev/snake_ts/AGENTS.md), [`AGENTS.md#rule-10`](file:///home/forart/dev/snake_ts/AGENTS.md) & [`ORACLE.md`](file:///home/forart/dev/snake_ts/ORACLE.md)  

---

## 1. Feature Overview & Acoustic Art Direction

- **Core Mandate:** Eliminated prolonged fanfare cacophony, static hiss, muddy mid-range buildup (200-500Hz), and clipping distortion. Implemented 100% custom, broadcast-grade, short, high-fidelity 44.1kHz 16-bit PCM mono WAV assets tailored to the game's dark cyber-emerald, obsidian, and neon chromatic aesthetic.
- **Pure Harmonic Synthesis Architecture:**
  - Replaced all noise bursts with pristine harmonic synthesis: pure sine waves with precise musical overtone ratios, crystalline high-frequency transients (3.5kHz - 8kHz), and clean deep sub-bass (45Hz - 65Hz).
  - Guaranteed zero clipping, peak normalization to -1.50 dBFS, and zero DC offset (0.000000).
- **Unified Eating Paradigm (35ms):**
  - Single unified eating sound (`sfx_eat.wav` and backward-compatible copies `sfx_eat_pop.wav` & `sfx_gem_chime.wav`): exactly 35ms crystal-clear cyber-emerald drop. Pure dual-sine crystalline ping (D6 = 1174.66Hz + D7 = 2349.32Hz + subtle D5 = 587.33Hz) with ultra-fast 1.5ms attack and 30ms exponential decay, plus a tiny 0.5ms glass micro-transient (6200Hz). Zero noise, zero mud!
- **Crystalline Stellar Chime (80ms):**
  - `sfx_star_ding.wav`: 80ms celestial duo (A6 = 1760Hz + E7 = 2637Hz) with crystalline shimmer.
- **Short & Restrained Jingles (<0.70s):**
  - Level Up (`sfx_level_up.wav`): 450ms high-tech cyber-ascension stinger. Ascending 3-tone crystal chord (A5=880Hz -> C#6=1108.7Hz -> E6=1318.5Hz -> A6=1760Hz) with shimmering harmonic decay (E7=2637Hz & A7=3520Hz) and clean 65Hz sub-bass anchor. Zero lowpass muffling — bright, sparkling, futuristic.
  - Victory (`sfx_victory.wav`): 650ms cyber transcendence stinger. Pristine rising chord (E5=659Hz -> B5=988Hz -> E6=1319Hz -> G#6=1661Hz) with sparkling decay and warm 50Hz sub-bass anchor.
  - Game Over (`sfx_game_over.wav`): 500ms clean cybernetic de-synchronization pulse. Pure melodic glide from 440Hz -> 55Hz with smooth exponential dissipation. Zero distortion or glitch fuzz.
- **High-Tech Combat & Movement SFX:**
  - `sfx_laser_pew.wav`: 60ms laser-sharp plasma beam pulse (exponential FM chirp 1400Hz -> 350Hz with crisp 5kHz optical transient click, no white noise hiss).
  - `sfx_laser_heavy.wav`: 95ms heavy pulse blaster (resonant 650Hz -> 180Hz laser chirp with clean 60Hz punch and 4.2kHz transient snap).
  - `sfx_hit.wav`: 30ms tactile cyber impact (crisp 3.5kHz glass/chitin snap + punchy 110Hz sub kick).
  - `sfx_dash.wav`: 140ms relativistic slipstream whoosh with high-frequency air shimmer (4kHz-8.5kHz harmonic cluster) and 60Hz sub displacement.
  - `sfx_shield_on.wav`: 130ms holographic barrier hum (pure dual harmonic swell 659Hz + 987Hz with clean ionization envelope).
  - `sfx_shield_break.wav`: 140ms crystalline barrier shatter (resonant glass discharge 2800Hz -> 1200Hz with incommensurate chime modes).
  - `sfx_warp_jump.wav`: 800ms relativistic hyper-drive burst (rising emerald vortex sweep 160Hz -> 2800Hz + deep clean 48Hz sub-boom).
  - `sfx_boss_alert.wav` / `sfx_boss_roar.wav`: 580ms ominous titan emergence (deep 45Hz sub drone with eerie 880Hz harmonic swell).
  - `sfx_ui_click.wav`: 10ms ultra-premium tactile micro-click (pure 3200Hz high-Q glass impulse).
  - `sfx_ui_tab.wav`: 10ms tactile micro-tick (pure 4000Hz glass impulse).

---

## 2. Verification Metrics & Conformance Audit Results

- **Acoustic Audit (`scratch/verify_cyber_audio.py`):**
  - Primary Target: `public/assets/audio/` (18/18 files PASS, 100% Conformance)
  - Dist Target: `dist/assets/audio/` (18/18 files PASS, 100% Conformance)
  - Sample Rate: Exactly 44,100 Hz across all 18 files.
  - Bit Depth: 16-bit PCM mono (1 channel, 2 bytes/sample).
  - Peak Amplitude: Exactly -1.50 dBFS across all 18 files (tolerance: [-3.05 dBFS, -0.95 dBFS]).
  - Clipping: Exactly 0 clipped samples across all 18 files.
  - DC Offset: Exactly 0.000000 across all 18 files.
  - Durations: Match specifications down to 0.1ms.
