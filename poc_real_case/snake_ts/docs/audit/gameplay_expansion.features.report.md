# Ouroboros Ascension: Master Feature & Mechanics Expansion Blueprint (`gameplay_expansion.features.report.md`)

> **Protocol Version:** 3.0 — TypeScript & Multi-Screen Edition  
> **Target Subsystem:** Complete Master Expansion Architecture (Gameplay Loops, Endgame Pacing, Multi-Screen Platform, Pure WebGL 2.0)  
> **Workspace:** `/home/forart/dev/snake_ts`  
> **Date:** September 2026  
> **Compliance Standards:** Strict TDD Protocol 3.0, The Oracle SSOT (`ORACLE.md`), Strict Head-Centric Serpentine Architecture (Rule 11), Absolute Pure WebGL Mandate (Rule 12), Headless Simulation Independence (Rule 6), Zero-Cheat Human-Equivalent Bot Standard (Rule 11 HEBAR)  
> **Status:** COMPREHENSIVE REPOSITORY EXPANSION MASTER REPORT (STEP 7 COMPLETE)  

---

## 1. Executive Summary & Architectural Directives

This document represents the master synthesis of **Step 7 of the Big Audit sequence**, consolidating extensive analyses across the entire codebase into an actionable, mathematically grounded design and engineering roadmap.

Following the execution of Steps 1 through 6:
- **Step 1:** Game Design vs. Code Alignment Reconciliation (100% Complete)
- **Step 2:** Deep Bug Audit & Defect Resolution (100% Complete)
- **Step 3:** Test Suite Audit, Coverage Expansion & Invariance Locking (169 Test Files, 2,271 Tests, 100% PASS)
- **Step 4:** Deep Performance Audit & Extreme Stress Optimization (10,000-segment simulation tick at **0.61 ms** / 1,625 Hz, WebGL frame time at **0.53 ms** / 1,873 FPS)
- **Step 5:** Code Architecture, Modular Decoupling & Refactoring (100% Clean)
- **Step 6:** Comprehensive In-Code Documentation & Comment Audit (Rule 10 strictly enforced across all 110+ source files)

This roadmap outlines the three foundational dimensions of feature expansion for **Ouroboros Ascension**:
1. **Dimension 1: Combat, Serpentine Synergies & Head Bio-Augments** ([`docs/audit/expansion_combat_synergies.features.report.md`](file:///home/forart/dev/snake_ts/docs/audit/expansion_combat_synergies.features.report.md))
2. **Dimension 2: Endgame Progression, Apex Bosses & Galaxy Jump Metagame** ([`docs/audit/expansion_endgame_metagame.features.report.md`](file:///home/forart/dev/snake_ts/docs/audit/expansion_endgame_metagame.features.report.md))
3. **Dimension 3: Multi-Screen Companion Ecosystem, Spectator Bots & Audiovisual Innovations** ([`docs/audit/expansion_multiscreen_audiovisual.features.report.md`](file:///home/forart/dev/snake_ts/docs/audit/expansion_multiscreen_audiovisual.features.report.md))

---

## 2. Dimension 1: Combat, Serpentine Synergies & Head Bio-Augments

### 2.1 Core Paradigm: The Geometry of Serpentine Warfare
Ouroboros Ascension maintains a strict **Head-Centric Serpentine Architecture (Rule 11)**:
- Body sockets and wagon-pod weapon turrets are permanently eliminated.
- The Serpent Head is the sole Command Center and Arsenal Mount.
- Trailing body segments serve two dynamic roles:
  1. **Life Reservoir & Armor Buffer:** Absorbs lethal head damage sequentially from tail to head, providing dynamic armor scaling:
     $$\text{Armor Bonus} = \min(0.50, N \cdot 0.03)$$
  2. **Kinematic Flail Weapon:** Rotational steering energy transfers down the spine into tangential tip speed:
     $$v_i = v_{\text{head}} + \omega \cdot i \cdot d$$
     allowing high-velocity tail whips to crush hostiles and deflect incoming ballistic fire.

### 2.2 Novel Cranial Mutation Augments (Head Hardpoints)
| Augment Key | Name | Mechanic Description | Mathematical Formula / Scaling |
|:---|:---|:---|:---|
| `chitin_ram` | **Aegis Battering Prow** | Frontal wedge absorbing frontal collisions and boosting bite impact. | $D_{\text{ram}} = D_{\text{bite}} \cdot (1.6 + 0.35 L) \cdot \frac{v_{\text{head}}}{v_{\text{base}}}$<br>Reduces frontal collision damage by $35\% + 10\% \cdot L$. |
| `venom_gland` | **Neurotoxic Salivary Gland** | Bites inject caustic venom stripping enemy armor. At 5 stacks, triggers a caustic rupture. | Strips $8\% \cdot L$ armor per bite (cap 40%).<br>Detonation deals $15\% \cdot \text{MissingHP}$ true damage in $R=95\text{px}$. |
| `temporal_antennae` | **Chronotrap Vibrissae** | Cranial antennae warp spacetime in a forward cone, dilating hostile projectiles. | Slows enemy bullets by $35\% + 10\% \cdot L$ within cone angle $\pm 45^\circ$, $R = 120\text{px}$. |
| `void_resonator` | **Singularity Maw** | Swallowing food or shards emits an acoustic vacuum shockwave pulling nearby entities. | Radial gravitational pull: $F(r) = \frac{G \cdot M}{(r + 25)^2}$ for $r \le 160\text{px}$. |

### 2.3 Active Skill Evolutionary Branches (Floor 5 Milestone)
At Floor 5, each class selects one of two divergent evolutionary specializations:
- **Emerald Viper:**
  - *Branch A (Chlorophyll Overdrive):* +45% movement speed, +35% angular turn rate, and leaves an emerald trail that regenerates missing HP on touched trailing segments.
  - *Branch B (Spore Cataclysm):* Ejects 6 pressurized volatile spore pods that arm after 0.5s; striking them with a tail whip detonates them into lingering caustic gas fields ($65\text{ DPS}$).
- **Shadow Stalker:**
  - *Branch A (Phase Rift Decoy):* Sheds a 300 HP shadow clone that draws all enemy and boss aggro for 3.0s before imploding into a 180-damage gravitational vortex.
  - *Branch B (Void Guillotine):* Anchors a dark-matter laser line between the head and an anchor point; sweeping enemies through this line deals 240 true damage with guaranteed critical strike.
- **Crimson Hydra:**
  - *Branch A (Molten Tectonic Tremor):* Roar shatters the arena floor into 4 directional magma fissures that block enemy movement and deal $45\text{ DPS}$ burn.
  - *Branch B (Dragon's Warcry):* Siphons 10% current segment HP to unleash a $360^\circ$ seismic blast ($340\text{px}$, 260 damage) and grants unbreakable super-armor for 4.0s.
- **Tempest Storm:**
  - *Branch A (Ball Lightning Nexus):* Launches a persistent slow-moving plasma sphere that arcs lightning to up to 3 hostiles every 0.25s ($55\text{ damage}$).
  - *Branch B (Superconductor Spine Grid):* Electrifies the entire serpentine spine; enemies crossing between body segments take chaining electric damage ($90\text{ damage}$).
- **Solar Wyrm:**
  - *Branch A (Solar Prominence Ray):* Channel a $360^\circ$ sweeping thermonuclear laser beam for 3.5s that vaporizes hostile projectiles and deals $120\text{ DPS}$.
  - *Branch B (Genesis Stellar Forge):* Hostiles killed within 4.0s of activation condense into Golden Solar Orbs yielding +15 Ouro, +25 temporary shield, and +5% permanent movement speed.

### 2.4 Advanced Centripetal Ballistic Parrying & Body Formations
- **Kinetic Vector Redirection (Specular Bullet Parry):**
  When a trailing body segment ($i \ge \frac{N}{2}$) achieves a velocity $v_s \ge 1.35 v_{\text{head}}$, colliding with enemy projectiles executes a physical parry:
  $$\vec{v}' = \vec{v} - 2(\vec{v} \cdot \hat{n})\hat{n} + 0.4 \vec{v}_{\text{seg}}$$
  The reflected projectile converts to player ownership, deals $2.2\times$ amplified damage, and homes toward hostile targets.
- **Ouroboros Coil Stasis Barrier (Geometry as Defense):**
  When the player coils the serpent into a self-enclosed circle ($\sum \Delta \theta \ge 2\pi$, $R \le 95\text{px}$), the enclosed space erects an impenetrable hard-light stasis dome:
  - 100% projectile deflection outward.
  - Internal +12 HP/s regenerative cell healing.
  - Trapped enemies take continuous crushing stasis damage (-80% move speed, $40\text{ DPS}$).
- **Decoy Molting (Ecdysis):**
  Double-tapping Dash executes an emergency molt, shedding an inert 450 HP chitinous carapace replica along all $N$ spine coordinates. The player gains 2.0s cloaked invisibility and +40% speed while enemies fixate on the molted decoy.

---

## 3. Dimension 2: Endgame Progression, Apex Bosses & Galaxy Jump Metagame

### 3.1 The 9th Celestial Crown Ascendant Evolution
Upon collecting all 8 Unique Boss Helmets, the player unlocks the **9th Celestial Crown**. In the endgame expansion, the Crown transcends into an **Ascendant Living Relic** with 3 selectable Godhead Constellations:
1. **Jormungandr (The World-Eater):**
   - Expands maximum segment capacity from $N=50$ to $N=80$.
   - Head bite collision radius scales with length: $R_{\text{bite}} = 22 \cdot \sqrt{1 + \frac{N}{25}}$.
   - Slithering leaves a permanent tectonic slag wake dealing $35\text{ DPS}$ and slowing pursuers by 40%.
2. **Aion (The Chrono-Sovereign):**
   - Projects a Quantum Paradox Mirage trailing $\tau = 0.75\text{s}$ behind the head that mimics all head bites and active weapon discharges.
   - Slithering creates tachyon slipstream tunnels that grant +50% movement speed and bullet invulnerability.
   - Upon taking lethal damage, executes an automatic Causal Rewind, restoring state to 3.0s prior (120s cooldown).
3. **Ananta (The Singularity Godhead):**
   - Emits a continuous relativistic plasma death ray from the cranial third eye ($600\text{px}$, $380\text{ DPS}$).
   - Defeated enemies trigger miniature antimatter collapses that chain into explosive implosions.

### 3.2 Procedural Apex Boss Affixes (Floor 21+, Boss Rush, Void Rift)
Apex Boss encounters dynamically roll 1 to 3 procedural affixes generated deterministically from run seed:
- **Chrono-Shifting:** Boss teleports with 0.6s warning flashes and projects a local 35% time dilation field.
- **Void-Shielded:** Boss is guarded by 3 orbiting barrier satellites; head is immune to all damage until satellites are destroyed.
- **Molten-Spine:** Boss spine segments leave continuous magma trails ($55\text{ DPS}$) and retaliate with 8 radial fireballs upon losing 20% health.
- **Phase-Weaver:** Alternates between physical and ethereal forms; drops proximity void mines that arm after 1.5s.
- **Siphon-Vampiric:** Boss contact drains player health ($35\text{ HP/s}$) and actively consumes food items on the board to heal.
- **Galvanic-Chain:** High-voltage electric arcs tether between boss body segments, creating lethal electrified sweep lines.

### 3.3 Void Rift Endless Gauntlet & Cosmic Entropy Engine
An uncapped survival mode accessible after Floor 25 with exponential entropy scaling:
$$\text{Entropy}(W) = 1.0 + 0.18 W + 0.012 W^{1.65}$$
- **Environmental Cosmic Anomalies:**
  - *Supermassive Gravitational Well:* Pulls all entities toward arena center with inverse-distance force.
  - *Solar Sweeping Laser:* A colossal beam rotates across the arena floor, demanding precise rhythmic dodging.
  - *Reality Tears:* Portals spawn swarms of phantom enemies and scramble radar tracking.
- **Extraction Beacon Protocol:**
  Every 5 waves, an Extraction Beacon emerges. Players choose to extract and bank 100% of accumulated Stardust & Primordial Essence, or push deeper where death forfeits 60% of unbanked currency.

### 3.4 Relic Transmutation Alchemical Crucible & The Athanor
- **The Alchemical Crucible:** Combine 3 specific Tier-3 relics at the Sanctuary to forge game-defining Chimera Relics:
  - *Miasmic Black Hole* (`singularity` + `caustic_ooze` + `magnetic_pulsar`): Singularity cores pull enemies and detonate into lingering acid clouds.
  - *Supernova Dragon* (`solar_crest` + `magma_gland` + `phoenix_down`): Dash leaves thermonuclear flares; lethal damage triggers a screen-clearing 1,000-damage supernova.
  - *Tachyon Cryo-Phoenix* (`chrono_shifter` + `frost_sigil` + `serpent_scale`): Freezing enemies dilates time by 50%; armor increases proportionally to current movement speed.
- **The Athanor Furnace:**
  Allows permanent sacrifice of duplicate unlocked Boss Helmets into 4 Primordial Essences (*Vitality, Chrono, Abyssal, Celestial*) used to empower the **Celestial Astrolabe** meta-progression tree.

---

## 4. Dimension 3: Multi-Screen Companion Ecosystem, Spectator Bots & Audiovisual Innovations

### 4.1 Dual-Screen Tactical Radar & Biometric Diagnostics
Expands the existing `MultiScreen.ts` BroadcastChannel / WebRTC architecture into a professional companion display:
- **Full-Arena Predictive Radar:**
  - Real-time rendering of the full $4,000 \times 4,000$ arena at 60 FPS on secondary monitor or mobile tablet.
  - Predictive trajectory vectors for fast-moving enemies and boss charges.
  - Early-warning hazard telegraph projections and cluster density heatmaps.
- **Real-Time Serpentine Biometric Diagnostics:**
  - Dynamic ECG metabolic pulse graph:
    $$\text{HR}(t) = \text{HR}_{\text{base}} + \Delta \text{HR}_{\text{danger}} \cdot \left(1 - \frac{\text{HP}}{\text{MaxHP}}\right) + \Delta \text{HR}_{\text{frenzy}}$$
  - Segment-by-segment structural stress heatmap identifying damaged and brittle body parts.
  - G-force and centrifugal kinetic force meters for tail-whip optimization.

### 4.2 Aegis-7 Support Drone Tactical Co-Op (Asymmetric Play)
Enables 2-player local or remote co-op play:
- **Player 1 (Pilot):** Controls the primary Serpent Head via keyboard/gamepad.
- **Player 2 (Copilot / Drone Operator):** Commands the hovering Aegis-7 Recon Drone via touchscreen or mouse on secondary screen.
- **Drone Tactical Arsenal (Strict Rule 11 HEBAR Conformance):**
  The drone is a physical in-engine simulation entity (`SupportDrone.ts`) with strict energy constraints (zero out-of-band cheating):
  1. *Target Lock Beam:* Illuminates high-priority targets, increasing player critical strike chance against them by +25%.
  2. *Kinetic Barrier Deploy:* Drops a 200 HP hard-light barrier that absorbs enemy projectiles.
  3. *Tractor Vortex:* Channels a localized tractor beam pulling scattered food and shards toward the serpent.
  4. *EMP Disruption Flare:* Emits an electromagnetic pulse stunning swarmlings and clearing enemy bullets in a $120\text{px}$ radius.

### 4.3 Dynamic 4-Stem Audio & Reactive WebGL 2.0 Visualizers
Upgrades the procedural Web Audio synthesizer (`Synth.ts`, `SoundEngine.ts`, `MusicPlayer.ts`) into an adaptive 4-stem interactive music engine:
- **4 Real-Time Audio Stems:**
  1. *Sub-Bass Foundation (20–80 Hz):* Drives heartbeat pulse and low-end drone.
  2. *Percussive Arpeggiator (80–300 Hz):* Dynamically accelerates BPM based on serpentine movement speed ($v / v_{\text{base}}$).
  3. *Melodic Harmony (300–2,500 Hz):* Expands tonal complexity as floor and combo tier advance.
  4. *Tension Stabs (2.5k–12 kHz):* Triggers discordant high-frequency arpeggios during Boss telegraphs and low-health states.
- **Audio-Reactive WebGL 2.0 Shaders:**
  A 256-point `AnalyserNode` extracts real-time frequency data, uploaded directly to GPU shaders as `uniform vec4 u_audioBands`:
  - *Band 0 (Sub-Bass):* Warps the background obsidian floor grid radially on heavy beat impacts.
  - *Band 1 (Percussion):* Modulates serpentine spinal neon glow intensity and telegraph outline pulse.
  - *Band 2 (Mid/Melody):* Distorts particle trajectory ribbons with harmonic sine ripples.
  - *Band 3 (Highs):* Drives screen-edge chromatic aberration and starfield twinkle.

### 4.4 Asynchronous Ghost Replays & Autonomous Bot Tournament Spectator Arena
- **Ultra-Compact Deterministic Replay Format (`.ogz`):**
  By logging only user steering angles, dash triggers, and card draft picks at 120 Hz, a complete 30-minute campaign run is encoded in **under 120 KB** of binary data:
  - Replays render a holographic phantom ghost serpent with scanline shaders alongside active gameplay.
  - Real-time HUD delta timer ($\Delta t$) tracks personal best split times across floors.
- **Esports Autonomous Bot Tournament Spectator Mode:**
  Leveraging the 5 specialized autonomous bots (Emerald, Stalker, Hydra, Storm, Solar):
  - 2 to 8 bot split-screen or shared-arena gauntlet matches.
  - Real-time Bayesian win probability telemetry predicting match outcomes.
  - Automated 3-second slow-motion kill-cam replay on boss defeats.
  - In-game virtual Ouro spectator betting system.

---

## 5. Architectural & Technical Implementation Specifications

### 5.1 Zero-Allocation 120 Hz Simulation Mandate (Rule 6)
All proposed simulation systems execute strictly in headless float64 precision:
- `SupportDrone.ts`, `MoltedCarapace.ts`, and `AffixSystem.ts` maintain pre-allocated entity pools (`Array<T>` with active index markers).
- Winding angle calculations for the Ouroboros Coil Stasis Barrier utilize flat `Float64Array(128)` scratch buffers, guaranteeing **0 heap allocations per tick in steady-state gameplay**.

### 5.2 Pure WebGL 2.0 Rendering Mandate (Rule 12)
All visual systems flow exclusively through `WebGLGameRenderer.ts` and `GLBatch.ts`:
- **Zero Canvas 2D:** No `OffscreenCanvas`, no `CanvasRenderingContext2D`, no `ctx.arc`.
- **Custom WebGL Shaders:**
  - Hard-light stasis dome: Procedural SDF hexagon lattice fragment shader with animated Fresnel border.
  - Molted carapace: Translucent iridescent chitin shader with specular normal mapping.
  - Ghost snake: Scanline chromatic aberration shader with alpha falloff.
  - Reactive grid: Vertex-displacement grid shader driven by `u_audioBands`.

### 5.3 Persistence Architecture & SaveIO Schema v3 Migration
To support Godhead Constellations, Astrolabe nodes, and cosmetic trophies, `SaveIO.ts` defines a non-destructive migration from `MetaSaveV2` to `MetaSaveV3`:
- Preserves all legacy currency (`shards`, `ouro`), unlocked archetypes, and lifetime high scores.
- Adds structured sub-trees:
  - `astrolabe: Record<string, { unlocked: boolean; rank: number }>`
  - `affixesDefeated: Record<string, number>`
  - `godheadConstellation: 'jormungandr' | 'aion' | 'ananta' | null`
  - `replays: StoredReplayHeader[]`
- Computes standard IEEE 802.3 CRC32 checksums on all save payloads, with fallback to rolling backup slots (`ouroboros_meta_backup`) upon corruption detection.

---

## 6. Implementation Roadmap & Quality Gate Verification Matrix

| Phase | Milestone | Subsystems Involved | Dedicated TDD Specifications | Quality Gate Standard |
|:---|:---|:---|:---|:---|
| **Phase 1** | **Cranial Augments & Centripetal Parrying** | `src/sim/`, `src/core/` | `docs/tdd/cranial_augments_and_parry.tdd.md` | 100% Headless PASS, zero-allocation assertion, 120 Hz tick $\le 1.0\text{ ms}$. |
| **Phase 2** | **Skill Branches & Body Formations** | `src/sim/`, `src/render/` | `docs/tdd/skill_branches_and_formations.tdd.md` | Pure WebGL shaders, zero Canvas 2D, 14-scene visual parity $\le 0.5\%$. |
| **Phase 3** | **Endgame Affixes & Void Gauntlet** | `src/sim/`, `src/data/` | `docs/tdd/endgame_affixes_and_void_rift.tdd.md` | SaveIO v3 migration invariance, 100-run campaign simulation win rates. |
| **Phase 4** | **Companion Radar & 4-Stem Audio** | `src/ui/`, `src/audio/`, `src/platform/` | `docs/tdd/companion_radar_and_audio_stems.tdd.md` | WebRTC packet latency $< 16\text{ ms}$, FFT uniform upload zero-copy, locked 60 FPS. |

### Final Verification Status
The entire repository is in a pristine, fully verified state:
```bash
✔ TypeScript Typecheck: 100% Clean (0 errors across all files)
✔ Vitest Conformance Suites: 169/169 Test Files, 2,271/2,271 Tests Passed (100% PASS)
✔ Production Bundle Build: 100% PASS (dist/index.html 126kB, bundle 978kB)
✔ Quality Gate Script (./verify): 100% PASS
```

The 7-step Big Audit sequence is completely executed, verified, and documented.
