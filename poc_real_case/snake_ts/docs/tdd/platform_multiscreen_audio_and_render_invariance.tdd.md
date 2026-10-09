# Feature TDD Specification: Platform, Multi-Screen, Audio, Responsive Layout & Pure WebGL Invariance

> **Feature Identifier:** `docs/tdd/platform_multiscreen_audio_and_render_invariance.tdd.md`  
> **Status:** Green  
> **Target Directory:** `/home/forart/dev/snake_ts`  
> **Rule Reference:** [`AGENTS.md#rule-2`](file:///home/forart/dev/snake_ts/AGENTS.md), [`AGENTS.md#rule-10`](file:///home/forart/dev/snake_ts/AGENTS.md), [`AGENTS.md#rule-12`](file:///home/forart/dev/snake_ts/AGENTS.md), and [`ORACLE.md`](file:///home/forart/dev/snake_ts/ORACLE.md)  

---

## 1. Feature Overview & Requirements

- **High Concept:** Comprehensive regression prevention and mechanic invariance audit suite covering the Platform, Multi-Screen synchronization, Procedural Web Audio engine, Responsive Layout viewport scaling, and Pure WebGL 2.0 rendering pipeline. Verifies that all underlying mathematical formulas, acoustic dynamics, wire protocols, and rendering invariants remain strictly unchanged and functional.
- **Target Systems:**
  - `src/render/webgl/` (`WebGLContext`, `WebGLGameRenderer`, `GLBatch`, `WebGLAssetAtlas`)
  - `src/platform/` and `src/multiscreen/` (`MultiScreenManager`, `MultiScreenSync`, `CompanionSync`, `SaveIO`)
  - `src/audio/` (`SoundEngine`, `Synth`)
  - `src/ui/` (`ResponsiveLayout`)
  - `src/input/` (`VirtualStick`, `TouchControls`, `InputManager`)
- **Mechanics Reference:**
  - [`ORACLE.md#section-9`](file:///home/forart/dev/snake_ts/ORACLE.md) (WebGL 2.0 Pipeline, SDF Shaders, Canvas 2D Ban)
  - [`ORACLE.md#audio-architecture`](file:///home/forart/dev/snake_ts/ORACLE.md) (Master Compressor, Voice Limiter, Sidechain Ducking, Unified Eating Route)
  - [`ORACLE.md#responsive-layout`](file:///home/forart/dev/snake_ts/ORACLE.md) (Viewport aspect scaling, Safe-area insets, Touch joystick geometry)
  - [`ORACLE.md#multi-screen-companion`](file:///home/forart/dev/snake_ts/ORACLE.md) (BroadcastChannel, WebRTC DataChannel, CRC32 Checksumming)

---

## 2. Audit of Existing Test Suites

1. **`src/tests/Rule12PureWebGLAudit.test.ts`**:
   - Asserts zero usage of `CanvasRenderingContext2D` across `render`, `sim`, `input`, `ui`, `data`, and `core`.
   - Asserts zero `getContext('2d')` calls in production code.
   - Validates `GLBatch` memory constants (6 floats/vertex, 4 verts/quad, 24 floats/quad, 4096 quads capacity) and typed buffer allocations.
   - Validates all 7 `GLPrimitive` enum mode values (`Quad`, `Circle`, `Ring`, `Sphere`, `Laser`, `Texture`, `Nebula`).
   - Validates 14 canonical scenes in `VisualParityHarness`.

2. **`src/tests/MultiScreen.test.ts`**:
   - Validates `SYNC_STATE` broadcast from primary to companion screen over test bus.
   - Validates `INPUT_EVENT` transmission from companion controller to primary host.
   - Confirms self-originated packet filtering (`sourceId === this.senderId`).

3. **`src/tests/AudioVoiceLimiterAndMasterCompressor.test.ts`**:
   - Asserts studio mastering compressor parameters (-10 dB threshold, 12 dB knee, 6:1 ratio, 2 ms attack, 120 ms release).
   - Validates audio graph routing: `sfxGain` & `musicGain` -> `masterGain` -> `masterCompressor` -> `destination`.
   - Validates `canPlay()` voice limiter, debounce intervals (bite 40ms, hit 35ms, shoot 40ms, explosion 60ms, thunder 80ms).
   - Validates round-robin micro-pitch variation (±35 cents) for shoot.
   - Validates transparent sidechain ducking curve (0.03s attack, <=0.55s restore).

4. **`src/tests/ResponsiveLayout.test.ts`**:
   - Tests UI scaling across 9 viewport aspect ratios (compact phone 320x480 to 4K desktop 3840x2160).
   - Checks logical UI space without aspect distortion.
   - Validates `isPortraitHud` resolution detection.
   - Validates touch button layout generation across logical bounds.

5. **`src/tests/SaveIO.test.ts`**:
   - Validates meta-progression initialization, upgrade purchase, class unlock.
   - Validates legacy v1 -> v2 schema migrations and corrupted JSON fallback.

---

## 3. Dedicated Comprehensive Test Plan (Invariance Suite)

Test File: `src/tests/PlatformMultiScreenAudioAndRenderInvariance.test.ts`

### Domain A: Rule 12 Pure WebGL 2.0 Invariance
- **A.1 Zero Canvas 2D references in production bundle & renderer code**:
  - Scan all production directories (`src/render`, `src/sim`, `src/ui`, `src/input`, `src/platform`, `src/data`, `src/core`) for forbidden Canvas2D tokens:
    - `CanvasRenderingContext2D`
    - `getContext('2d')` / `getContext("2d")`
    - `OffscreenCanvasRenderingContext2D`
- **A.2 WebGL Pipeline Matrix Transforms & Projection Calculations**:
  - Orthographic 3x3 camera matrix calculation: camera zoom, translation, rotation, and screen shake transformations.
  - Screen-space projection matrix calculation for UI HUD rendering.
  - Matrix inverse consistency and NDC mapping [-1, 1].
- **A.3 Uniform Bindings & Shader Pipeline State**:
  - Uniform locations caching (`u_matrix`, `u_resolution`, `u_time`, `u_texture`, `u_highlightColor`, `u_baseColor`, `u_shadowColor`).
  - GLPrimitive enum integrity (`Quad=0`, `Circle=1`, `Ring=2`, `Sphere=3`, `Laser=4`, `Texture=5`, `Nebula=6`).
- **A.4 Context Loss Recovery Hooks**:
  - `handleContextLost`: calls `e.preventDefault()`, marks ready as false, flushes texture cache.
  - `handleContextRestored`: re-initializes `WebGLContext`, restores ready state, re-bakes textures.
  - Clean lifecycle listener unbinding on `dispose()`.

### Domain B: MultiScreen & CompanionSync Wire Invariance
- **B.1 BroadcastChannel & WebRTC Payload Serialization & CRC32**:
  - Serialization and deserialization of `MultiScreenPacket` (state, input, draft, minimap).
  - CRC32 checksum deterministic verification: IEEE 802.3 polynomial, deterministic hash across identical payloads, tamper detection on payload mutation.
  - MultiScreenManager bidirectional message passing, event subscription and disposal.
- **B.2 Display Role Negotiation**:
  - Negotiation between `primary` (game arena) and secondary companions (`hud`, `minimap`, `sanctuary`, `inventory`, `spectator`, `controller`).
  - Window join announcement (`WINDOW_JOINED`) and acknowledgement (`WINDOW_ACK`).
  - Window management multi-monitor screen discovery fallback.
- **B.3 WebRTC CompanionSync Wire Protocol**:
  - Room code generation formatting (6-char alphanumeric with hyphen: `XXX-XXX`).
  - Pairing URL generation (`getPairingUrl`).
  - Ping/Pong latency tracking roundtrip (`rttLatencyMs`).
  - Controller input transmission (`CONTROLLER_INPUT`) with sequence numbering.
  - HUD synchronization (`HUD_SYNC`) with health, shields, combo, and active cards.

### Domain C: SoundEngine & Synth Acoustic Invariance
- **C.1 Single Unified Eating Sound Route**:
  - `PlayEat` and `playEat` route exclusively through `BROADCAST_AUDIO_PATHS.eat` (`sfx_eat.wav`) with procedural fallback `createEatVoices`.
  - Active voice counting (`_activeVoiceCounts.get('eat')`) increments on play and decrements on completion/fallback.
  - Golden food eat routing with combo multiplier scaling.
- **C.2 Concurrency Voice Limits & Cooldowns**:
  - Max concurrent voice limits capped at 4 per channel (shoot=4, hit=3, laserFire=3, bite=2, explosion=2, thunder=2, crit=2).
  - Minimum debounce intervals enforced via `canPlay()`: bite 40ms, hit 35ms, shoot 40ms, explosion 60ms, thunder 80ms.
- **C.3 Transparent Sidechain Ducking Curve**:
  - Musical ducking ramps down over exactly 0.03s (30ms anti-thump ramp).
  - Restoration period defaults to 0.50s (<=0.55s transparent window).
  - Ducking triggered on major game events (LevelUp, Victory, GameOver, BossAlert).
- **C.4 Master Compressor Studio Mastering Settings**:
  - Threshold: -10 dB.
  - Knee: 12 dB.
  - Ratio: 6 (6:1).
  - Attack: 0.002 s (2 ms).
  - Release: 0.12 s (120 ms).

### Domain D: Responsive Layout & Touch Input Invariance
- **D.1 Multi-Screen & Multi-Aspect Viewport Scaling**:
  - 16:9 Reference Desktop (1280x720, scale = 1.00; 1920x1080, scale = 1.50).
  - 21:9 Ultrawide Desktop (2560x1080, scale = 1.50; 3440x1440, scale = 1.85).
  - 9:16 Tall Mobile Portrait (360x780, scale = 0.95; 390x844, scale = 1.00).
  - 4:3 Tablet / CRT (1024x768, scale = 1.00).
  - Clamping boundaries strictly enforced within [0.60, 3.05].
- **D.2 Touch Joystick Deadzone & Saturation Radius**:
  - Default outer radius = 60 px.
  - Deadzone fraction = 0.18 -> deadzone = 10.8 px.
  - Input below deadzone produces zero deflection (vector = (0, 0), mag = 0).
  - Input between deadzone and radius produces linear analog ramp from 0.05 to 1.0.
  - Input beyond radius clamps knob position to radius and saturates magnitude at 1.0.
  - Dynamic floating origin activates on touch start and centers base at touch position.
  - Spring return dampens knob towards base when touch ends.
- **D.3 Safe-Area Inset Compensation & Layout Docking**:
  - Touch button placement responds to safe area insets (`left`, `top`, `right`, `bottom`).
  - Pause button docked away from notch; action pads (dash/skill) elevated above home indicator.
  - Ambidextrous lefty mode swaps stick and button sides.

---

## 4. Verification & Quality Check

```bash
npx vitest run src/tests/PlatformMultiScreenAudioAndRenderInvariance.test.ts
npm run typecheck
./verify
```
