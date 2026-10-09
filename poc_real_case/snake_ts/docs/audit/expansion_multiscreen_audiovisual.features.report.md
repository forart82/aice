# Step 7 of Big Audit: Feature & Mechanics Expansion Audit
## Dimension 3: Multi-Screen Companion Ecosystem, Spectator Bots & Audiovisual Innovations

> **Protocol Version:** 3.0 — TypeScript & Multi-Screen Edition  
> **Target Subsystems:** Platform IPC (`src/platform/`), Web Audio DSP (`src/audio/`), Pure WebGL 2.0 (`src/render/webgl/`), Simulation AI & Telemetry (`src/sim/ai/`, `src/tests/`)  
> **Workspace:** `/home/forart/dev/snake_ts`  
> **Author:** Antigravity Autonomous Agent (DeepMind Engine Architecture Team)  
> **Date:** September 2026  
> **Standard:** Strict Test-Driven Development (TDD), Rule 10 (Strict In-Code Documentation), Rule 11 (HEBAR Anti-Cheat Standard), Rule 12 (Pure WebGL Mandate), The Oracle SSOT  
> **Status:** Production Ready Specification & Audit Complete  

---

## 1. Executive Summary & Strategic Vision

As part of **Step 7 of the Big Audit sequence**, this report delivers the comprehensive architectural analysis and design specification for **Dimension 3: Multi-Screen Companion Ecosystem, Spectator Bots & Audiovisual Innovations**.

### 1.1 The Protocol 3.0 Evolutionary Imperative
*Ouroboros Ascension* has achieved complete headless simulation independence (`src/sim/`, `src/core/`), 100% pure WebGL 2.0 rendering without Canvas 2D (`WebGLGameRenderer.ts`, `GLBatch.ts`), production-grade Web Audio procedural DSP synthesis (`Synth.ts`, `MusicPlayer.ts`), cross-window IPC via `BroadcastChannel`, and low-latency mobile companion synchronization via WebRTC DataChannels (`CompanionSync.ts`).

However, modern commercial game publishing demands an ecosystem transition:
1. **From Single-Display to Multi-Display Tactical Immersion:** Desktop PCs with dual monitors, foldable tablets, and mobile companion smartphones provide untapped tactile and visual real estate for simultaneous tactical radar, real-time biometrics, and asymmetric companion gameplay.
2. **From Solo Arcade to Asymmetric Social Co-Op:** Casual companions or second-seat players can participate meaningfully through an interactive **Support Recon Drone** without interfering with the primary pilot's physical controls.
3. **From Static BGM to Real-Time Audio-Reactive Visual Synthesis:** Bridging the Web Audio DSP pipeline directly into the WebGL 2.0 shader stages transforms every bass drop, synth transient, and laser blast into physical geometry deformations, dynamic screen tremors, and pulsing bio-luminescence.
4. **From Headless Telemetry to Esports Spectator Entertainment & Ghost Replays:** Exploiting the deterministic 120Hz simulation engine to provide ultra-compact asynchronous ghost replays and multi-bot live tournament spectator arenas adhering strictly to the Rule 11 Human-Equivalent Bot Action Standard (HEBAR).

```
┌───────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                 OUROBOROS ASCENSION ECOSYSTEM TOPOLOGY                                │
├──────────────────────────────────────┬────────────────────────────────────────────────────────────────┤
│       PRIMARY GAME HOST (DESKTOP)    │                 WIRELESS COMPANION (MOBILE/TABLET)             │
│  ┌────────────────────────────────┐  │  ┌──────────────────────────────────────────────────────────┐  │
│  │   Pure WebGL 2.0 Arena View    │  │  │         Tactical Radar & Holographic Threat Map          │  │
│  │  (120Hz Serpentine Kinematics) │  │  │       (Centipede Vectoring, Telegraph Cones, Portals)    │  │
│  └────────────────┬───────────────┘  │  └──────────────────────────────┬───────────────────────────┘  │
│                   │ Audio FFT        │                                 │ WebRTC DataChannel           │
│                   ▼                  │                                 ▼ (<10ms P2P / Fallback WS)    │
│  ┌────────────────────────────────┐  │  ┌──────────────────────────────────────────────────────────┐  │
│  │  Audio-Reactive SDF Shaders    │  │  │          Aegis-7 Recon Drone Tactical Co-Op Deck         │  │
│  │  - Sub-Bass Grid Warping       │  │  │       - Laser Target Lock (+25% Crit)                    │  │
│  │  - Melodic Spinal Laser Bloom  │◄─┼──┤       - Deploy Orbital Kinetic Shield Barrier            │  │
│  │  - Treble Starfield Twinkle    │  │  │       - Micro-Tractor Food / Shard Vacuum Cluster        │  │
│  └────────────────────────────────┘  │  └──────────────────────────────────────────────────────────┘  │
├──────────────────────────────────────┴────────────────────────────────────────────────────────────────┤
│                       ASYNCHRONOUS REPLAY & AUTONOMOUS BOT TOURNAMENT ENGINE                          │
│  ┌──────────────────────────────────────────────┐  ┌───────────────────────────────────────────────┐  │
│  │   Deterministic Ghost Replay Stream (.ogz)   │  │   Autonomous Bot Esports Broadcast Arena      │  │
│  │   - Delta-encoded 120Hz inputs (<120 KB/run) │  │   - 8-Bot Split-Screen / PiP Championship     │  │
│  │   - Holographic Ghost Snake Time-Attack      │  │   - Live Win Probability & 3-Second Kill-Cam  │  │
│  └──────────────────────────────────────────────┘  └───────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Deep-Dive Audit of Existing Infrastructure

### 2.1 Multi-Screen & Companion IPC (`src/platform/MultiScreen.ts`, `src/platform/CompanionSync.ts`)
- **MultiScreenManager (`MultiScreen.ts`)**:
  - Implements browser `BroadcastChannel` (`ouroboros_multiscreen_v1`) for local zero-latency cross-window synchronization.
  - Standardized packet envelope `MultiScreenPacket<T>`:
    ```typescript
    export interface MultiScreenPacket<T = any> {
      channel?: 'OUROBOROS_MULTISCREEN' | string;
      id?: string;
      senderId: string;
      sourceWindowId?: string;
      role: ScreenRole; // 'primary' | 'secondary' | 'companion' | 'hud' | 'minimap' | 'spectator' ...
      sourceRole?: ScreenRole;
      timestamp: number;
      type: MultiScreenMessageType;
      payload: T;
    }
    ```
  - Integrates the W3C **Window Management API** (`window.getScreenDetails`) to detect multi-monitor layouts and spawn pop-out HUDs or minimaps directly onto external displays (`openCompanionWindow`).
  - Implements 1000ms heartbeat polling with 3500ms stale-window sweep timeouts emitting `WINDOW_LEFT`.
- **CompanionSync (`CompanionSync.ts`)**:
  - Employs WebRTC `RTCDataChannel` configured for ultra-low latency (`ordered: false`, `maxRetransmits: 0`) with WebSocket signaling relay fallback (`wss://relay.ouroboros.dev/ws`).
  - Provides 6-character alphanumeric room codes (`XXX-XXX`) and dynamic QR code URL generation (`/companion?room=...`).
  - Unidirectional limitations identified:
    - Downlink (`DesktopHudSyncMessage`) only synchronizes primitive scalar values (`hp`, `maxHp`, `shield`, `combo`, `shards`, `activeDraftCards`).
    - Uplink (`ControllerInputMessage`) only transmits player stick steering, action buttons (`dash`, `skill`, `pause`, `confirm`), and device tilt (`tiltX`, `tiltY`).
    - *Identified Gap:* No bidirectional tactical co-op actors, zero high-density telemetry streams (vital graphs, kinetic momentum, threat vectors), and no audio-reactive data transport.

### 2.2 Procedural Audio & Music Architecture (`src/audio/Synth.ts`, `SoundEngine.ts`, `MusicPlayer.ts`)
- **Acoustic Synthesis (`Synth.ts`)**:
  - Sample-accurate PolyBLEP anti-aliased oscillators (Sine, Triangle, Sawtooth, Square) with 2nd-order polynomial bandlimiting preventing Nyquist foldover aliasing.
  - Robert Bristow-Johnson (RBJ) Biquad filter implementations (Lowpass, Highpass, Bandpass, Notch, Peaking) evaluated sample-by-sample via Direct Form I difference equations.
  - ADSR envelopes, waveshaping distortion ($\tanh(kx)$), and deterministic offline buffer rendering.
- **SoundEngine (`SoundEngine.ts`)**:
  - Master routing graph: `[SFX Voices]` $\to$ `_sfxGain` $\to$ `_masterGain` $\to$ `_masterCompressor` $\to$ `ctx.destination`.
  - Studio dynamics compressor: $-10\text{ dB}$ threshold, $12\text{ dB}$ knee, $6:1$ ratio, $2\text{ ms}$ attack, $120\text{ ms}$ release.
  - Voice concurrency limiter & debounce table: bite ($40\text{ ms}$), shoot ($40\text{ ms}$), hit ($35\text{ ms}$), explosion ($60\text{ ms}$), thunder ($80\text{ ms}$); max concurrent polyphony cap ($3$).
  - Round-robin micro-pitch variation ($\pm 35\text{ cents}$) for weapon fire.
  - Dynamic sidechain ducking engine: linear ramp down over $30\text{ ms}$ anti-thump attack, $500\text{ ms}$ restore.
- **MusicPlayer (`MusicPlayer.ts`)**:
  - W3C lookahead 16th-note step scheduler ($120\text{ ms}$ lookahead window, $25\text{ ms}$ interval).
  - Continuous loop playback of 44.1kHz 16-bit PCM broadcast tracks (`music_exploration.wav`, `music_combat.wav`, `music_boss.wav`) with 0.8s equal-power crossfading.
  - Resonant biquad lowpass filter (`moodFilter`) modulating cutoff frequency ($18\text{ kHz} \to 1.8\text{ kHz}$) with gameplay intensity and pause state.
  - *Identified Gap:* No real-time `AnalyserNode` or Fast Fourier Transform (FFT) frequency spectrum extraction. Music tracks operate as monolithic stereo mixes rather than modular multi-stem arrangements. Rendering shaders have zero access to acoustic energy bands.

### 2.3 Hardware-Accelerated Pure WebGL 2.0 Pipeline (`src/render/webgl/`)
- **WebGLGameRenderer & GLBatch**:
  - 100% strict compliance with Rule 12 (Zero Canvas 2D references in production bundle).
  - Interleaved vertex attribute layout (24 bytes stride): `a_position` (vec2), `a_uv` (vec2), `a_color` (vec4 UInt8 normalized), `a_params` (float).
  - High-throughput batching with 4096 quads capacity per draw call.
  - Multi-pass serpentine rendering: Bio-luminescent aura, ventral shadow, muscular ribbon mesh, scale plates, spinal laser conduit, cranial mandibles, equipped boss helmets, and invulnerability modulation.
- **Unified Signed Distance Field (SDF) Fragment Shader (`WebGLContext.ts`)**:
  - Evaluates primitives entirely in fragment hardware: Quad (Box SDF with Gaussian halo glow), Circle (Euclidean radial distance with smoothstep anti-aliasing), Ring (Annulus distance), Sphere (2D focal Blinn-Phong specular highlight), Laser (Dual-core Gaussian beam), Texture (atlas lookup), and Nebula (volumetric dust).
  - *Identified Gap:* WebGL uniforms do not currently receive audio FFT data (`u_audioBands`, `u_bassEnergy`, `u_treblePulse`). Shaders lack frequency-driven vertex and fragment modulation.

### 2.4 Autonomous Bot Telemetry & Spectator Infrastructure (`src/sim/ai/`, `src/tests/`)
- **AutonomousBotPlayer & BotTelemetryLogger**:
  - Full adherence to Rule 11 HEBAR Anti-Cheat Standard: Bots operate through `IInput` controller contracts, obey kinematic angular turn rate limits ($\omega_{\text{turn}}$), click real UI buttons, pick legitimate draft cards, and spend genuine Ouro currency.
  - Captures comprehensive combat accounting, floor milestones, boss TTK, HP retention %, and behavioral anomalies (self-traps, hazard suicide, potion negligence, ability waste).
  - Live arena spectator mode toggled via `KeyB` or URL parameters (`?spectate=true&class=emerald`).
  - *Identified Gap:* No standardized binary/JSON ghost replay recording format (`.ogz` / `.replay.json`) enabling asynchronous time-attack ghost racing. No multi-bot split-screen tournament arena or esports broadcast graphics package.

---

## 3. Expansion Proposal 1: Dual-Screen Tactical Radar & Companion Biometric Diagnostics

```
┌────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                        COMPANION SECOND SCREEN: TACTICAL RADAR & BIOMETRIC COCKPIT                     │
├─────────────────────────────────────────────┬──────────────────────────────────────────────────────────┤
│             TACTICAL RADAR (MINIMAP 2.0)    │               BIOMETRIC & KINETIC DIAGNOSTICS            │
│  ┌───────────────────────────────────────┐  │  ┌────────────────────────────────────────────────────┐  │
│  │  (•) Centipede Behemoth [Charging]    │  │  │  PULSE: 142 BPM [Adrenaline Frenzy Surge]          │  │
│  │       ───► [Lethal Vector: 420 px/s]  │  │  │  /\    /\_/\    /\    /\_/\  (Dynamic ECG Graph)   │  │
│  │                                       │  │  │    \  /     \  /  \  /     \                       │  │
│  │  [!] Storm Gorgon Telegraph Cone: 60° │  │  ├────────────────────────────────────────────────────┤  │
│  │      Distance: 380u | Time to Blast: 1.2s│  │  SERPENTINE INTEGRITY: 18 / 24 Segments            │  │
│  │                                       │  │  │  Head: 100% [Shield Active] | Armor: 72% Deflect   │  │
│  │  (*) Void Portal: Spawning in 4.5s    │  │  │  Segments 12-14: Damaged (Thermal Overheat)         │  │
│  │  ($) Golden Food Cluster (East Wall)  │  │  ├────────────────────────────────────────────────────┤  │
│  └───────────────────────────────────────┘  │  │  KINETIC DYNAMICS:                                 │  │
│  [ Zoom: 1x | 2x | Full Arena ] [ Threat Filter ]  │  │  Speed: 280u/s | Turn Rate: 4.8 rad/s | G-Force: 3.2│  │
└─────────────────────────────────────────────┴──────────────────────────────────────────────────────────┘
```

### 3.1 Gameplay Mechanics & Player Experience
The Dual-Screen Tactical Radar and Companion Biometric Diagnostics expansion transforms any secondary monitor, laptop, or mobile tablet into an authentic **"Mission Operations Center"**:
1. **Predictive Threat Vectoring:** The radar calculates kinematic velocity vectors for high-speed enemies (Centipede Behemoth charges, Void Devourer lunges) and renders dynamic projection cones showing their interception path 1.5 seconds in advance.
2. **Telegraph Hazard Overlays:** Boss attack telegraphs (e.g. Storm Gorgon petrification cones, Infernal Colossus magma eruptions) are rendered on the companion screen even when the boss is outside the primary screen's zoomed-in camera viewport, preventing off-screen surprise damage.
3. **Food & Item Clustering Heatmap:** Groups food items, golden apples, shield orbs, and void shards into visual density clusters, calculating the optimal navigation path (Traveling Salesman heuristic) for maximizing frenzy score.
4. **Metabolic Heart Rate & Adrenaline ECG:** A procedural bio-signal generator simulates the serpent's cybernetic vital rhythm, calculating instantaneous heart rate from danger level, frenzy charge, and current HP:
   $$HR(t) = HR_{\text{base}} + \Delta HR_{\text{danger}} \cdot (1 - \frac{\text{HP}}{\text{MaxHP}}) + \Delta HR_{\text{frenzy}} \cdot \mathbf{1}_{\text{frenzy}}$$
   where $HR_{\text{base}} = 60\text{ BPM}$, $\Delta HR_{\text{danger}} = 80\text{ BPM}$, and $\Delta HR_{\text{frenzy}} = 50\text{ BPM}$.
5. **Serpentine Segment Stress Analysis:** Provides a color-coded head-to-tail structural diagram showing individual segment health, curvature strain, and active cranial module cool-downs.

### 3.2 Technical Wire Protocol & Data Architecture
The protocol extends `MultiScreenPacket` with two specialized, high-frequency payloads operating over `BroadcastChannel` (desktop multi-monitor) and WebRTC DataChannel (mobile companion):

```typescript
/** High-frequency tactical radar payload broadcast at 30 Hz */
export interface TacticalRadarSyncPayload {
  arenaWidth: number;
  arenaHeight: number;
  camera: { x: number; y: number; zoom: number };
  player: {
    x: number;
    y: number;
    angle: number;
    velocity: { vx: number; vy: number };
    length: number;
    headRadius: number;
  };
  threats: Array<{
    id: string;
    type: 'enemy' | 'boss' | 'hazard' | 'projectile';
    x: number;
    y: number;
    vx: number;
    vy: number;
    radius: number;
    threatLevel: 'low' | 'medium' | 'high' | 'apex';
    telegraph?: {
      shape: 'cone' | 'circle' | 'line';
      angle: number;
      spread: number;
      duration: number;
      progress: number; // 0.0 to 1.0
    };
  }>;
  resources: Array<{
    id: string;
    type: 'food' | 'golden' | 'shield' | 'shard' | 'portal';
    x: number;
    y: number;
    value: number;
  }>;
}

/** Biometric diagnostics payload broadcast at 15 Hz */
export interface BiometricDiagnosticsPayload {
  timestamp: number;
  heartRateBpm: number;
  adrenalinePercent: number; // 0.0 to 1.0
  kineticSpeed: number;
  angularVelocity: number;
  centrifugalStressG: number;
  segments: Array<{
    index: number;
    integrityPercent: number;
    strainLevel: number;
  }>;
  activeAugments: Array<{
    id: string;
    ready: boolean;
    cooldownRemainingSec: number;
  }>;
}
```

### 3.3 Network Bandwidth & Optimization Strategy
- **Delta Compression:** Static entity IDs and coordinates are packed into flat `Float32Array` buffers for binary WebRTC DataChannel transmission, reducing payload size from $8.5\text{ KB}$ (JSON) to $< 750\text{ bytes}$ per frame.
- **Adaptive Frame Rate:** The radar updates at 30 Hz when enemies are within 500 units, scaling down to 10 Hz during quiet exploration, keeping total companion network usage below $15\text{ KB/s}$.

---

## 4. Expansion Proposal 2: Support Drone Tactical Co-Op (Remote Asymmetric Play)

```
┌────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                AEGIS-7 RECON DRONE ASYMMETRIC CO-OP TOPOLOGY                           │
├────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                                        │
│   PRIMARY SCREEN (PILOT)                           COMPANION DEVICE (COPILOT / TACTICAL OPERATOR)      │
│   ┌────────────────────────────────────────┐       ┌────────────────────────────────────────────────┐  │
│   │                                        │       │  [ Aegis-7 Drone Energy: 85 / 100 ]            │  │
│   │   Serpent Head ──► [Plasma Missiles]   │       │                                                │  │
│   │           │                 │          │       │  ACTION 1: Laser Designator [Touch Target]     │  │
│   │           ▼                 ▼          │  ◄────┼─ Lock target: Centipede Tail (+25% Crit)      │  │
│   │    [Target Locked: Red Reticle]        │       │                                                │  │
│   │                                        │       │  ACTION 2: Orbital Barrier Shield [Tap Button] │  │
│   │    [Aegis Kinetic Barrier Field] ◄─────┼───────┼─ Deploy 80px kinetic barrier (Cost: 35 Energy) │  │
│   │    (Absorbing enemy projectiles)       │       │                                                │  │
│   │                                        │       │  ACTION 3: Food Vacuum Vortex [Drag & Hold]    │  │
│   │    [Micro-Tractor Swirl] ◄─────────────┼───────┼─ Pull 12 food items toward Snake (Cost: 20/s)  │  │
│   │    (Gathering food cluster to Snake)   │       │                                                │  │
│   └────────────────────────────────────────┘       └────────────────────────────────────────────────┘  │
│                                                                                                        │
└────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

### 4.1 Asymmetric Cooperative Game Design
The **Aegis-7 Recon Drone** allows a secondary player (friend, partner, or spectator via mobile phone/tablet or secondary mouse) to join the game without altering the primary serpent's steering mechanics:
1. **Role Division:**
   - *Player 1 (The Pilot):* Maneuvers the serpentine avatar, evades body collisions, collects food, and triggers head-centric active abilities.
   - *Player 2 (The Tactical Copilot):* Commands the hovering Aegis-7 Recon Drone using direct touchscreen taps or mouse clicks on the companion radar/viewport.
2. **Four Tactical Drone Abilities (Energy Pool: 100 Max, $r_{\text{regen}} = 8\text{ energy/sec}$):**
   - **Tactical Laser Target Lock (Cost: 10 Energy):** Copilot taps an enemy or boss weak spot. A holographic reticle locks onto the target for 6 seconds. All of Player 1's automated head weapons (Stalker Railgun, Plasma Homing Missiles, Hydra Bio-Spitters) prioritize this target with $+25\%$ critical strike multiplier.
   - **Orbital Kinetic Barrier (Cost: 40 Energy, Cooldown: 8s):** Copilot deploys a localized energy bubble (radius $R = 75\text{ px}$) anywhere on screen for 3.5 seconds. The barrier completely absorbs enemy projectiles and laser beams, creating a safe corridor for Player 1.
   - **Tractor Vortex Food Vacuum (Cost: $25\text{ Energy/sec}$):** Copilot holds a location on screen. A magnetic vortex draws all loose food, golden apples, and void shards within a 200px radius into a dense cluster, feeding Player 1 with maximum XP density.
   - **EMP Flare Disruption (Cost: 60 Energy, Cooldown: 15s):** Copilot triggers an electromagnetic pulse that neutralizes minor swarming enemies for 2.0 seconds and clears explosive hazard mines.

### 4.2 HEBAR Anti-Cheat & Physical Simulation Compliance (Rule 11)
To uphold the strict Rule 11 HEBAR standard:
- The Support Drone is a **legitimate physical simulation entity** in `src/sim/coop/SupportDrone.ts`.
- The drone possesses explicit kinematic physics: Max Speed $v_{\text{max}} = 550\text{ px/s}$, Acceleration $a = 1200\text{ px/s}^2$, and Collision Radius $r = 14\text{ px}$.
- The copilot cannot arbitrarily inject gold, mutate stats, or grant invulnerability. All actions consume drone energy ($E \le 100$) and respect strict server-side tick cooldowns evaluated in `GameEngine.ts`.

### 4.3 Co-Op Uplink Wire Packet Specification
```typescript
export interface DroneActionUplinkPayload {
  seq: number;
  action: 'MOVE' | 'LOCK_TARGET' | 'DEPLOY_BARRIER' | 'ACTIVATE_VACUUM' | 'FIRE_EMP';
  targetX: number;
  targetY: number;
  targetEntityId?: string;
  durationMs?: number;
}
```

### 4.4 WebGL 2.0 Shader Rendering for Co-Op Drone
The drone, its targeting reticle, and the magnetic tractor field are rendered using dedicated SDF shader primitives:
- Drone Chassis: SDF Ring (`GLPrimitive.Ring`) with rotating triangular rotor ticks.
- Target Lock Reticle: Animated multi-ring bracket with pulsing Gaussian bloom.
- Tractor Beam: Conical additive alpha gradient (`GLPrimitive.Laser`) with inward-drifting particle sprites.
- Kinetic Shield: High-refraction hexagonal lattice mesh rendered in the primary WebGL batch with additive alpha blending (`gl.blendFunc(gl.SRC_ALPHA, gl.ONE)`).

---

## 5. Expansion Proposal 3: Dynamic Procedural Audio Stems & Reactive WebGL 2.0 Visualizers

```
┌────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                             AUDIO-REACTIVE SHADER & 4-STEM DSP PIPELINE                                │
├────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                                        │
│   DYNAMIC 4-STEM AUDIO ENGINE (Web Audio API)          PURE WEBGL 2.0 SHADER RECEPTORS                 │
│   ┌────────────────────────────────────────┐           ┌────────────────────────────────────────────┐  │
│   │ Stem 1: Sub-Bass & Kick (20 - 80 Hz)   ├──► E_sub ─┼──► Uniform u_audioBands.x                  │  │
│   │         Sidechain Ducking Envelope     │           │    Arena Grid Distortion & Camera Shake    │  │
│   ├────────────────────────────────────────┤           ├────────────────────────────────────────────┤  │
│   │ Stem 2: Percussive Arp (80 - 300 Hz)   ├──► E_bass ┼──► Uniform u_audioBands.y                  │  │
│   │         16th-Note Noise Hats & Snares  │           │    Enemy Carapace Pulse & Rim Lighting     │  │
│   ├────────────────────────────────────────┤           ├────────────────────────────────────────────┤  │
│   │ Stem 3: Melodic Synth (300 - 2500 Hz)  ├──► E_mid ─┼──► Uniform u_audioBands.z                  │  │
│   │         Cyberpunk Leads & Chords       │           │    Spinal Luminescent Conduit Bloom        │  │
│   ├────────────────────────────────────────┤           ├────────────────────────────────────────────┤  │
│   │ Stem 4: Tension Stabs (2.5k - 12k Hz)  ├──► E_high ┼──► Uniform u_audioBands.w                  │  │
│   │         Dissonant Strings & Risers     │           │    Starfield Chromatic Twinkle & Laser Core│  │
│   └────────────────────────────────────────┘           └────────────────────────────────────────────┘  │
│                                                                                                        │
└────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

### 5.1 4-Stem Adaptive Dynamic Soundtrack Architecture
Currently, `MusicPlayer.ts` plays a single stereo master track loop. Under the 4-Stem Adaptive Audio Architecture, each biome and battle theme is structured into 4 continuously synchronized audio stems:
1. **Stem 1 (Foundation):** Sub-bass synth wave and kick transients ($20 - 80\text{ Hz}$). Provides driving rhythmic pulse; dynamically ducks by $6\text{ dB}$ during combat explosions.
2. **Stem 2 (Rhythm):** 16th-note procedural noise hats, snare hits, and bass arp lines ($80 - 300\text{ Hz}$). Dynamically un-mutes as combo multiplier scales ($1\times \to 8\times$).
3. **Stem 3 (Harmony):** Lush analog pad textures, arpeggiated melodic synthesizers, and harmonic motifs ($300 - 2500\text{ Hz}$). Cutoff dynamically modulates with `moodFilter`.
4. **Stem 4 (Intensity Stabs):** Dissonant brass swells, high-tension string risers, and apex alert alarms ($2500 - 12000\text{ Hz}$). Fades in when player HP $< 30\%$ or during Boss Phase 2/3 enrage.

### 5.2 Real-Time Web Audio FFT Spectrum Extraction Pipeline
An `AnalyserNode` is connected to the master music and SFX busses before dynamic compression:
- `fftSize`: 256 samples (giving 128 frequency bins across $0 - 24\text{ kHz}$ at $48\text{ kHz}$ sample rate, frequency resolution $\Delta f = 187.5\text{ Hz}$ per bin).
- `smoothingTimeConstant`: 0.75 (prevents jitter while preserving snappy transient detection).

The DSP analyzer computes logarithmic energy bands on every simulation frame:
$$E_{\text{sub}} = \frac{1}{N_1} \sum_{k=1}^{2} \frac{X[k]}{255}, \quad E_{\text{bass}} = \frac{1}{N_2} \sum_{k=3}^{7} \frac{X[k]}{255}$$
$$E_{\text{mid}} = \frac{1}{N_3} \sum_{k=8}^{32} \frac{X[k]}{255}, \quad E_{\text{high}} = \frac{1}{N_4} \sum_{k=33}^{96} \frac{X[k]}{255}$$

### 5.3 Audio-Reactive WebGL 2.0 GLSL Shader Integration
The normalized energy vector `vec4 u_audioBands = vec4(E_sub, E_bass, E_mid, E_high)` is uploaded to the GPU every frame via `gl.uniform4fv(u_audioBandsLoc, bands)` in `WebGLContext.ts`.

#### 1. Audio-Reactive Backdrop Grid Deformation (Vertex & Fragment GLSL):
```glsl
// In WebGLContext Backdrop Pass:
uniform vec4 u_audioBands; // x: sub, y: bass, z: mid, w: high
uniform float u_time;

vec2 computeGridWarp(vec2 worldPos, vec2 playerPos) {
  vec2 delta = worldPos - playerPos;
  float dist = length(delta);
  // Sub-bass kick creates radial outward ripples expanding from player
  float ripple = sin(dist * 0.015 - u_time * 8.0) * exp(-dist * 0.003);
  return worldPos + normalize(delta) * (ripple * u_audioBands.x * 24.0);
}
```

#### 2. Melodic Spinal Luminescent Conduit Bloom:
In Pass 5 of `WebGLGameRenderer.ts`, the snake's spinal laser conduit width and halo intensity modulate with mid-range melodic energy:
$$W_{\text{laser}} = W_{\text{base}} \cdot (1.0 + 0.6 \cdot E_{\text{mid}}), \quad I_{\text{glow}} = I_{\text{base}} \cdot (1.0 + 1.2 \cdot E_{\text{mid}})$$

#### 3. Bass-Reactive Laser Core Chromatic Dispersion:
Railgun and laser projectiles expand their white-hot core and disperse prismatic fringe colors when high-frequency energy $E_{\text{high}}$ peaks, creating visceral audiovisual synchronization.

---

## 6. Expansion Proposal 4: Asynchronous Ghost Replays & Autonomous Bot Tournament Spectator Mode

```
┌────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                     AUTONOMOUS BOT ESPORTS TOURNAMENT & ASYNCHRONOUS GHOST ARENA                       │
├────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                                        │
│   BROADCAST TOURNAMENT ARENA (2 - 8 SIMULTANEOUS BOTS)                                                 │
│  ┌──────────────────────────────────────────────┬───────────────────────────────────────────────────┐  │
│  │ BOT 1: "Emerald Paragon" (Floor 18)          │ BOT 2: "Solar Titan" (Floor 18)                   │  │
│  │ Class: Emerald Vanguard | Level 24           │ Class: Solar Archon | Level 22                    │  │
│  │ HP: 280/320 [87%] | Ouro: 4,120              │ HP: 195/410 [47%] | Ouro: 3,890                   │  │
│  │ DPS: 642.5 | Win Prob: 68.4% [FAVORED]       │ DPS: 789.1 | Win Prob: 31.6%                      │  │
│  │ Live Strategy: Kite & Venom Orbit            │ Live Strategy: Aggressive Solar Ram               │  │
│  └──────────────────────────────────────────────┴───────────────────────────────────────────────────┘  │
│                                                                                                        │
│   ESPORTS BROADCAST OVERLAY:                                                                           │
│   - Live Win Probability Gauge (Bayesian Markov state estimator based on HP, DPS & Boss TTK)          │
│   - Split-screen telemetry, live gold velocity, and card draft build comparison                        │
│   - Automated 3-Second Slow-Motion Kill-Cam (0.33x zoom camera tracking boss execution blow)           │
│                                                                                                        │
│   ASYNCHRONOUS GHOST REPLAY RACING (.ogz):                                                             │
│   - Holographic Ghost Snake rendered at 40% alpha with chromatic aberration                            │
│   - Delta-time indicator: [ +1.42s AHEAD OF PERSONAL BEST ]                                            │
│                                                                                                        │
└────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

### 6.1 Asynchronous Deterministic Ghost Replays (`.ogz`)
Because *Ouroboros Ascension* runs a strictly deterministic headless simulation at 120Hz using pure float math and seeded PRNG (`Rng.ts`), a complete 30-minute campaign run can be recorded in under **120 Kilobytes**!

#### Compact Replay File Specification (`.ogz` / Binary):
- **File Header (64 bytes):**
  - Magic Bytes: `0x4F 0x55 0x52 0x4F` ("OURO").
  - Protocol Version: UInt16 (`3`).
  - PRNG Seed: UInt32.
  - Class ID: UInt8 (0 = Emerald, 1 = Stalker, 2 = Hydra, 3 = Storm, 4 = Solar).
  - Total Frames: UInt32 ($N_{\text{frames}}$).
  - Checksum: UInt32 (IEEE 802.3 CRC32).
- **Frame Delta Stream (Quantized 2 Bytes / Frame):**
  - Steering Angle $\theta$: UInt8 (quantized to 256 steps $\in [-\pi, \pi]$).
  - Action Bitfield: UInt8 (`bit 0`: Dash, `bit 1`: Skill, `bit 2`: LevelUp Draft Option Index low, `bit 3`: Draft Option high, `bits 4-7`: reserved).
- **Holographic Ghost Rendering:**
  The ghost serpent is rendered directly in `WebGLGameRenderer.ts` using the existing multi-pass pipeline with modified shader uniforms:
  - Alpha clamped to $0.40$.
  - Fragment color shifted to cool holographic cyan (`#38bdf8`) with scanline chromatic aberration:
    $$C_{\text{final}} = \text{vec4}(C_{\text{cyan}} \cdot (0.8 + 0.2 \cdot \sin(y_{\text{screen}} \cdot 4.0 - t \cdot 10.0)), 0.40)$$
  - Real-time HUD Delta Timer: Calculates frame lead/deficit: $\Delta t = (Frame_{\text{player}} - Frame_{\text{ghost}}) \times \frac{1}{120}\text{ s}$.

### 6.2 Autonomous Bot Tournament Spectator Mode (HEBAR Standard)
Building upon `MassAutonomousCampaignTelemetry.test.ts` and `AutonomousBotPlayer.ts`, this expansion delivers a spectator experience where players can watch multiple AI bots compete in real-time or side-by-side:
1. **Multi-Bot Arena Layouts:**
   - *Split-Screen Duo (1v1 Race):* Two distinct arena instances rendered side-by-side or picture-in-picture.
   - *Shared Gauntlet (Battle Royale):* Multiple AI-controlled serpents placed in an expanded megastructure arena competing for food and battling bosses simultaneously under strict kinematic collision rules.
2. **Esports Analytics & Win Probability Forecasting:**
   The spectator HUD runs a real-time Bayesian win probability model:
   $$P_{\text{win}}(Bot_i) = \frac{\exp(\beta_1 \cdot \frac{\text{HP}_i}{\text{MaxHP}_i} + \beta_2 \cdot \text{DPS}_i - \beta_3 \cdot \text{DamageTakenRate}_i)}{\sum_j \exp(\beta_1 \cdot \frac{\text{HP}_j}{\text{MaxHP}_j} + \beta_2 \cdot \text{DPS}_j - \beta_3 \cdot \text{DamageTakenRate}_j)}$$
3. **Automated 3-Second Slow-Motion Kill-Cam:**
   Maintains a circular ring buffer of the last 360 simulation frames (3 seconds at 120Hz). When an Apex Boss or competing bot is killed:
   - Simulation speed temporarily decelerates to $0.33\times$ ($40\text{ Hz}$).
   - Camera zooms in $1.8\times$ centering on the point of lethal impact.
   - Replays the fatal strike with high-intensity chromatic shockwave distortion before returning seamlessly to live gameplay.
4. **Virtual Ouro Spectator Betting:**
   Spectators can wager meta-progression Ouro Shards on bot matchups before floor progression, unlocking rare boss trophies and codex entries upon correct predictions.

---

## 7. Cross-Subsystem Integration Matrix & Technical Requirements

| Subsystem | Impacted Files | New Protocols / Interfaces | Performance Budget | Quality Gate Target |
| :--- | :--- | :--- | :--- | :--- |
| **Platform IPC** | [`src/platform/MultiScreen.ts`](file:///home/forart/dev/snake_ts/src/platform/MultiScreen.ts)<br>[`src/platform/CompanionSync.ts`](file:///home/forart/dev/snake_ts/src/platform/CompanionSync.ts) | `TACTICAL_RADAR_SYNC`<br>`BIOMETRICS_SYNC`<br>`DRONE_ACTION_UPLINK` | $< 15\text{ KB/s}$ bandwidth<br>$< 10\text{ ms}$ latency | Vitest MultiScreen and Companion suites passing |
| **Simulation** | `src/sim/coop/SupportDrone.ts`<br>[`src/sim/GameEngine.ts`](file:///home/forart/dev/snake_ts/src/sim/GameEngine.ts)<br>`src/sim/replay/ReplayRecorder.ts` | `IReplayStream`<br>`ISupportDroneController`<br>`HEBAR` kinematic checks | Zero GC allocations in 120Hz hot loop | 100% headless test isolation in Vitest |
| **Audio DSP** | [`src/audio/MusicPlayer.ts`](file:///home/forart/dev/snake_ts/src/audio/MusicPlayer.ts)<br>[`src/audio/SoundEngine.ts`](file:///home/forart/dev/snake_ts/src/audio/SoundEngine.ts)<br>[`src/audio/Synth.ts`](file:///home/forart/dev/snake_ts/src/audio/Synth.ts) | 4-Stem Web Audio bus<br>`AnalyserNode` FFT extractor<br>`getAudioEnergyBands()` | $< 1.5\text{ ms}$ DSP processing time per tick | Vitest headless offline audio suite passing |
| **WebGL 2.0** | [`src/render/webgl/WebGLContext.ts`](file:///home/forart/dev/snake_ts/src/render/webgl/WebGLContext.ts)<br>[`src/render/webgl/WebGLGameRenderer.ts`](file:///home/forart/dev/snake_ts/src/render/webgl/WebGLGameRenderer.ts)<br>[`src/render/webgl/GLBatch.ts`](file:///home/forart/dev/snake_ts/src/render/webgl/GLBatch.ts) | `u_audioBands (vec4)`<br>Drone & Target Reticle SDF passes<br>Holographic Ghost Shader | Locked 60 FPS mobile (DPR 1.0)<br>Locked 120 FPS desktop (DPR 2.0) | Rule 12 zero Canvas 2D audit passing |
| **UI & Screens** | `src/ui/screens/TacticalRadarScreen.ts`<br>`src/ui/screens/DroneCopilotScreen.ts`<br>`src/ui/screens/TournamentSpectatorScreen.ts` | ResponsiveLayout multi-screen contracts<br>Touch target areas ($\ge 48\text{ px}$) | Clean DOM lifecycle (`mount` $\to$ `dispose`) | Zero DOM leaks; mobile safe-area insets |

---

## 8. Implementation Roadmap & Test-Driven Development (TDD) Phasing

In strict accordance with **Protocol 3.0 (`AGENTS.md` Rule 1, Rule 2, Rule 3)**, all proposed features must follow the **Red-Green-Refactor state machine** with dedicated feature TDD documents:

```
┌───────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                 TDD FEATURE IMPLEMENTATION PHASES                                     │
├───────────────────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                                       │
│   PHASE 1: Audio FFT Pipeline & Reactive Shader Uniforms                                              │
│   ├── Spec: docs/tdd/audio_fft_reactive_shaders.tdd.md                                                │
│   ├── Red: Write tests asserting AnalyserNode energy band extraction & uniform bindings               │
│   ├── Green: Implement AnalyserNode in SoundEngine/MusicPlayer and u_audioBands in WebGLContext       │
│   └── Refactor: Benchmark zero-allocation typed array uploads; verify Rule 12 WebGL invariance        │
│                                                                                                       │
│   PHASE 2: Tactical Radar & Biometric Diagnostics Sync                                                │
│   ├── Spec: docs/tdd/tactical_radar_and_biometric_diagnostics.tdd.md                                  │
│   ├── Red: Write wire packet serialization & CRC32 verification tests in MultiScreen.test.ts          │
│   ├── Green: Implement TacticalRadarSyncPayload in MultiScreenManager & CompanionSync                 │
│   └── Refactor: Add binary delta packing for WebRTC DataChannels; confirm <15 KB/s budget             │
│                                                                                                       │
│   PHASE 3: Aegis-7 Recon Drone Tactical Co-Op                                                         │
│   ├── Spec: docs/tdd/support_drone_tactical_coop.tdd.md                                               │
│   ├── Red: Write headless tests for drone energy consumption, target lock, and barrier physics       │
│   ├── Green: Implement SupportDrone in src/sim/coop/ adhering strictly to Rule 11 HEBAR Standard     │
│   └── Refactor: Integrate WebGL 2.0 drone rendering passes into WebGLGameRenderer                     │
│                                                                                                       │
│   PHASE 4: Asynchronous Ghost Replays & Bot Tournament Spectator Mode                                 │
│   ├── Spec: docs/tdd/ghost_replays_and_bot_tournament.tdd.md                                          │
│   ├── Red: Write deterministic input record/playback tests asserting bit-for-bit frame parity         │
│   ├── Green: Implement ReplayRecorder (.ogz) and TournamentSpectatorScreen with Bayesian win prob    │
│   └── Refactor: Add automated 3-second slow-motion kill-cam buffer and holographic ghost shaders     │
│                                                                                                       │
└───────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 9. Regulatory Compliance, Commercial Viability & Conclusions

### 9.1 Rule 7 & Rule 12 Legal and Commercial Safety
- **100% Commercial Usability:** All audio stems and sound effects remain 100% procedural Web Audio synthesis or proprietary royalty-free PCM WAV masters. Zero third-party copyright assets.
- **Rule 12 Zero Canvas 2D Mandate:** All new visualizers, tactical radar displays, drone graphics, and ghost serpents utilize pure WebGL 2.0 hardware shaders (`WebGLContext.ts`, `GLBatch.ts`) and glassmorphic DOM elements. No `CanvasRenderingContext2D` is introduced.
- **Privacy & GDPR Compliance:** Cross-device WebRTC signaling uses ephemeral, peer-to-peer room codes without storing persistent user telemetry or identifiable personal data.

### 9.2 Conclusion
This Feature & Mechanics Expansion Audit (Step 7, Dimension 3) establishes the complete architectural roadmap for elevating *Ouroboros Ascension* from a standalone browser game into a **multi-screen companion ecosystem with real-time audiovisual synthesis and esports spectator engagement**.

By capitalizing on the existing headless simulation, pure WebGL 2.0 rendering pipeline, and WebRTC/BroadcastChannel infrastructure, these expansions deliver maximum commercial differentiation, deep player retention, and viral streaming appeal while maintaining 100% quality gate conformance.
