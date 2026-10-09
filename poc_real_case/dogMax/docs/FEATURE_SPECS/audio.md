# Audio Feature Spec

Updated: 2026-07-13

## Sound Art Direction

### Core Sonic Philosophy: Heavy and Minimalist

#### The Dark Body — Low-End Weight

The music is built on a massive, pure sine-wave sub-bass drone running
continuously between 30 Hz and 60 Hz. It should create a physical sensation of
heavy matter, suggesting either the immense weight of stone or a massive,
idling cybernetic power core.

#### The Neon Outline — Melodic Contrast

A solitary, mournful violin melody floats far above the deep bass floor. It is
the bright, sharp silhouette cutting through the black background, adding a
tragic and heroic contrast to the dark environment.

#### Silence as the Backdrop

There are no drums, fast electronic rhythms, or busy synthesizer patterns. The
music uses empty space and slow transitions like a pitch-black canvas where
only the most important elements are allowed to stand out.

### Mood and Spatial Atmosphere: Ancient Cyber-Crypt

#### Dungeon Siege Influence

The style rejects fast, retro-1980s arcade synthwave in favor of slow-burning,
ominous dark-fantasy dread. It should feel heavy, serious, and deeply
atmospheric.

#### Massive Spatial Depth

Every instrument is drenched in massive hall convolution reverb with an
8-to-10-second decay tail. The result should make the world feel colossally
empty and vast, as if the hero were exploring a giant, lonely subterranean
vault where every step echoes down a long hallway.

### Gameplay Function: A Zero-Distraction Loop

#### Seamless Integration

The track relies on smooth, slowly evolving legato string pads and sustained
drone notes. Its ending chords must match its opening so the infinite loop has
no sudden cut or volume jump.

#### Sonic Frequency Zoning

The midrange remains mostly empty and clean, leaving a large amount of sonic
space in the center of the mix. High-priority hero actions must cut through
immediately, including the sharp vacuum-suction dash and the deep, echoing
cyber-gong used for item pickups, even during intense horde combat.

## Runtime Mixing Contract

- Background music must continue seamlessly while pickup, dash, combat,
  level-up, death, and other one-shot sounds play.
- One-shot effects may occupy the deliberately open midrange, but must not stop,
  restart, or audibly cut the background stream.
- Repeated pickups must remain readable without stacking into a harsh or muddy
  peak.
- The mix must preserve the dark low-frequency body while ensuring important
  gameplay cues remain intelligible on ordinary speakers and headphones.
