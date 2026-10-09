# 🏛️ Deep Architectural Audit & System Consolidation Report
**Ouroboros Ascension (TypeScript Edition)**  
*Simulation Clock: 120 Hz Deterministic Fixed-Step | Target: 100% Non-Regression, Zero-Loss Functionality & Performance Optimization*

---

# 📋 PART 1: Comprehensive System Catalog

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                                 OUROBOROS ASCENSION                                    │
│                              CORE SYSTEM ARCHITECTURE                                  │
├─────────────────────────┬───────────────────────────┬──────────────────────────────────┤
│ 1. SIMULATION & MATH    │ 2. COMBAT & ARSENAL       │ 3. RENDERING & FX                │
│ • 120Hz Fixed Step      │ • 16 Weapons (8K + 8E)    │ • 12-Pass Game Compositor        │
│ • Gauss-Seidel IK Chain │ • 12 Defensive Bio-Organs │ • 8-Pass Ribbon & Vertebrae Body │
│ • Modular Head/Seg HP   │ • 28 Cross Fusions        │ • 266-Star Parallax Nebula       │
│ • Constriction Polygon  │ • 20 Apex Boss Guardians  │ • 8-Crossing Harmonic Knot Math  │
│ • Autotomy Sacrifice    │ • 5 Playable Classes      │ • Pooled Vector Particles & Text │
├─────────────────────────┼───────────────────────────┼──────────────────────────────────┤
│ 4. UI / UX ARCHITECTURE │ 5. INPUT & PLATFORM       │ 6. DATA & PROGRESSION (SSOT)     │
│ • UiRoot & Change-Cache │ • Timestamp Arbitration   │ • 36 Cards & 26 Relics Pool      │
│ • High-DPI Floating HUD │ • Virtual Touch Joystick  │ • 14 Sanctuary Meta-Blessings    │
│ • 11 Modal Screens      │ • CRC32 Persistent SaveIO │ • 12 Daily Cosmic Capacities     │
│ • Continuous Scaling    │ • Dual-Screen Broadcast   │ • 5-Tier Boss Helmet Affixes     │
│ • 3-Level Codex System  │ • WebRTC Companion Sync   │ • 7-Category Dev Diagnostic Data │
└─────────────────────────┴───────────────────────────┴──────────────────────────────────┘
```

---

## 1. Core Simulation & Mathematical Pipelines (`src/sim/`, `src/core/`)

1. **Fixed-Step Accumulator (120 Hz)** — [`GameEngine.ts`](file:///home/forart/dev/snake_ts/src/sim/GameEngine.ts):
   - Fixed slice $dt_{\text{fixed}} = 1/120\text{ s} \approx 0.008333\text{ s}$.
   - Max 6 catch-up steps per frame ($50\text{ ms}$ budget) with $0.25\text{ s}$ delta clamping to prevent the spiral-of-death upon tab re-focus.
2. **Gauss-Seidel Serpentine Kinematics & Trailing Segments** — [`SnakePlayer.ts`](file:///home/forart/dev/snake_ts/src/sim/SnakePlayer.ts):
   - Shortest angular difference steering with agility surge multiplier ($\omega = 9.5\text{–}13.78\text{ rad/s}$).
   - Gauss-Seidel distance constraint along historical trail buffer ($d_{\text{segment}} = 15\text{ px}$, tapered radius $r_i = 11 \times (1 - 0.4 \times i/N)$).
   - Tangential tail-whip kinematics: $v_{\text{tangential}}(i) = v_{\text{head}} + \omega \cdot (i \cdot d)$, scaling damage up to $+85\% \times (v_i / v_{\text{head}})^2$.
3. **Modular Health Chassis & Severing Cascade** — [`SnakePlayer.ts`](file:///home/forart/dev/snake_ts/src/sim/SnakePlayer.ts):
   - Dual-pool system: $\text{HeadMaxHp} = 2 \times \text{BaseSegmentHp}$; each body segment carries independent $\text{Hp}$, $\text{MaxHp}$, and $\text{ShieldHp}$.
   - Damage routing: Evasion $\to$ Armor ($85\%$ hard cap) $\to$ Global Shield $\to$ Segment Shield $\to$ Leading Segment HP $\to$ Head HP.
   - Destruction of segment $i$ instantly severs and jettisons all trailing segments $i \dots N-1$.
   - Sequential top-down healing restores Head first, then cascades anterior $\to$ posterior.
4. **Closed-Loop Ouroboros Constriction** — [`CombatSystem.ts`](file:///home/forart/dev/snake_ts/src/sim/CombatSystem.ts):
   - Closed-loop detection between head and trailing segments $k \ge 3$.
   - Zero-allocation Jordan Curve Theorem (ray-casting point-in-polygon) crushes enclosed hostiles for $(120 + 15N)\text{ dmg}$, inflicts $2.0\text{ s}$ stasis, and fuses $\ge 2$ enclosed fruits into an **Astral Prism** (🔮).
5. **Tactical Autotomy** — [`SnakePlayer.ts`](file:///home/forart/dev/snake_ts/src/sim/SnakePlayer.ts):
   - Jettisons trailing $50\%$ of body segments to spawn an ablative shockwave ($R=32$), grant $1.2\text{ s}$ invulnerability, and activate a $4.0\text{ s}$ $+45\%$ steering agility surge.
6. **Combo Overdrive & 8.0s Frenzy** — [`CombatSystem.ts`](file:///home/forart/dev/snake_ts/src/sim/CombatSystem.ts):
   - 6 Stepped Multiplier Tiers ($2\times \to 3\times \to 4\times \to 5\times \to 6\times \to 8\times$).
   - Dynamic decay window contracting from $4.0\text{ s}$ down to $1.9\text{ s}$ as combo count rises.
   - Overdrive Frenzy (Combo $\ge 10$) grants $2.0\times$ double damage multiplier and golden vignette screen bloom for $8.0\text{ s}$.

---

## 2. Combat, Arsenal Weapons, Defenses & Entity AI (`src/sim/`, `src/data/`)

1. **16 Head-Mounted Weapons (8 Kinetic + 8 Elemental)** — [`GameData.ts`](file:///home/forart/dev/snake_ts/src/data/GameData.ts), [`CombatSystem.ts`](file:///home/forart/dev/snake_ts/src/sim/CombatSystem.ts):
   - *8 Kinetic:* Attack Spitter (`turret`), Railgun Flak Cannon (`flak`), Scattershot Blunderbuss (`scattershot`), Seeker Needler (`needler`), Cluster Mortar (`mortar`), Sonic Prow Cannon (`sonic`), Rotary Minigun (`gatling`), Caltrop Dropper (`caltrop`).
   - *8 Elemental:* Bio-Arc Coil (`tesla`), Magma Vent (`magma`), Cryo Mortar (`cryo`), Venom Sprayer (`venom`), Tachyon Laser (`tachyon`), Plasma Arc Cannon (`plasma`), Singularity Vortex Gun (`singularity`), Solar Flare Mortar (`solar`).
2. **12 Defensive Bio-Organs** — [`GameData.ts`](file:///home/forart/dev/snake_ts/src/data/GameData.ts):
   - Carapace Shield (`shield`), Thorny Spine Armor (`spikes`), Regen Gland (`regen`), Bio-Magnet (`magnet`), Chrono Ward (`chrono`), Nanite Swarm (`nanite`), Reactive Blast Plating (`reactive`), Magnetic Aegis (`magnetic_aegis`), Cryo Frost Carapace (`cryo_carapace`), Volcanic Heat Sink (`heatsink`), Phase Cloak Emitter (`cloak`), EMP Discharge Coil (`emp_coil`).
3. **28 Alchemical Cross-Module Fusions** — [`GameData.ts`](file:///home/forart/dev/snake_ts/src/data/GameData.ts):
   - Evaluates combinations between offensive and defensive sockets (e.g. `Superconductor Surge`, `Obsidian Armor`, `Miasma Combustion`, `Prismatic Aegis`, `Temporal Singularity`, `Event Horizon Web`, `Thermobaric Mortar`).
4. **20 Apex Boss Guardians** — [`GameData.ts`](file:///home/forart/dev/snake_ts/src/data/GameData.ts), [`Boss.ts`](file:///home/forart/dev/snake_ts/src/sim/Boss.ts):
   - Complete 20-Floor gauntlet with Roman numeral cycle scaling ($C = \lfloor(\text{Floor}-1)/20\rfloor$, $+35\%$ HP per cycle), 2-phase rage transitions at $50\%$ HP, and telegraphed ground lasers/meteors/blizzards.
5. **6 Hostile Mob Archetypes** — [`Enemy.ts`](file:///home/forart/dev/snake_ts/src/sim/Enemy.ts):
   - Linear Chase (`scarab`), Sinusoidal Swarm (`swarmling`), Kiting Artillery (`spitter`), Phase Wave (`phantom`), Charging Spread Drone (`drone`), and Juggernaut Ram (`brute`).
6. **5-Tier Boss Helmet Vault** — [`Helmets.ts`](file:///home/forart/dev/snake_ts/src/data/Helmets.ts):
   - 5 Rarities (Common to Mythic, $1.0\times \to 2.5\times$ power) with 13 procedural stat affixes.
7. **12 Cosmic Capacities & 4-Tier Milestones** — [`CosmicCapacities.ts`](file:///home/forart/dev/snake_ts/src/data/CosmicCapacities.ts):
   - 24-hour seeded trials with escalating milestone boosts: Lv 5 ($+0\%$), Lv 10 ($+50\%$), Lv 15 ($+100\%$), Lv 20 ($+150\%$).

---

## 3. Rendering & Visual FX Pipeline (`src/render/`)

1. **Master Game Compositor (12 Passes)** — [`GameRenderer.ts`](file:///home/forart/dev/snake_ts/src/render/GameRenderer.ts):
   - Camera translation $\to$ Parallax Backdrop / Idle Knot $\to$ In-World Hazards $\to$ Food Drops $\to$ Helmet Drops $\to$ Projectiles $\to$ Mobs $\to$ Bosses $\to$ Player Serpent $\to$ Particle FX $\to$ Screen Shake Restore $\to$ Screen Flash Overlays.
2. **Layered Serpent Renderer (8 Passes)** — [`SnakeRenderer.ts`](file:///home/forart/dev/snake_ts/src/render/SnakeRenderer.ts):
   - Ghost Afterimages $\to$ Decimated Path Shell $\to$ Luminescent Core $\to$ Vertebrae Discs $\to$ Tail LOD Buckets $\to$ Ventral Shadow $\to$ Wet Ridge Highlight $\to$ Carapace Fracture Cracks $\to$ Cranial Head Core & 6 Boss Helmets.
3. **Cosmic Backdrop & Harmonic Knot** — [`ArenaBackdrop.ts`](file:///home/forart/dev/snake_ts/src/render/ArenaBackdrop.ts), [`OuroborosMenuAnimation.ts`](file:///home/forart/dev/snake_ts/src/render/OuroborosMenuAnimation.ts):
   - Baked offscreen nebula with 266-star parallax field (180 micro, 70 mid, 16 diamond beacons).
   - 8-crossing harmonic torus knot with 1024-entry arc-length LUT and 3D depth sorting.
4. **Pooled FX Engine** — [`FxManager.ts`](file:///home/forart/dev/snake_ts/src/render/FxManager.ts):
   - 700 pooled particles, 120 floating text items with collision avoidance, 32 lightning beams, and camera shake.

---

## 4. UI / UX Architecture & Screen Components (`src/ui/`, `src/ui/screens/`)

1. **Screen Manager & Navigation Stack** — [`UiRoot.ts`](file:///home/forart/dev/snake_ts/src/ui/UiRoot.ts):
   - Change-caching engine (`hudSet`/`hudWidth`) to eliminate DOM reflows; navigation history back-stack.
2. **In-Game High-DPI Floating HUD** — [`HudView.ts`](file:///home/forart/dev/snake_ts/src/ui/HudView.ts):
   - Vitals cluster (Head vs Body HP breakdown, Shield, XP state counter, Level badge), cooldown sweep meters, combo gauge, boss health bar with damage lag-fill, on-screen touch steering layer.
3. **11 Modal Screen Components**:
   - `MenuScreen`, `ClassSelectScreen`, `DraftScreen`, `FloorClearScreen`, `GameOverScreen`, `SanctuaryScreen`, `SettingsScreen`, `SnakeLabScreen`, `HelpScreen` (3-Level Drill-Down Codex), `MultiScreenModal`, `DevChecklistScreen`.
4. **Responsive Layout Engine** — [`ResponsiveLayout.ts`](file:///home/forart/dev/snake_ts/src/ui/ResponsiveLayout.ts):
   - Continuous scale factors $s \in [0.60, 3.05]$, device tier detection (`phone`, `tablet`, `desktop`), aspect modes, and safe-area inset dock compensations.

---

## 5. Input & Multi-Platform / Multi-Screen Architecture (`src/input/`, `src/platform/`)

1. **Unified Input Controller** — [`InputManager.ts`](file:///home/forart/dev/snake_ts/src/input/InputManager.ts):
   - Timestamp-based source arbitration (Keyboard, Touch, Gamepad) preventing input fighting; radial deadzones and dual haptic rumble.
2. **Dual-Backend Storage & Checksums** — [`SaveIO.ts`](file:///home/forart/dev/snake_ts/src/platform/SaveIO.ts):
   - LocalStorage synchronous read/write + Async IndexedDB with 256-entry CRC32 checksums and v1 $\to$ v2 schema migrations.
3. **Multi-Screen & Companion Wireless Sync** — [`MultiScreen.ts`](file:///home/forart/dev/snake_ts/src/platform/MultiScreen.ts), [`CompanionSync.ts`](file:///home/forart/dev/snake_ts/src/platform/CompanionSync.ts):
   - Local multi-monitor Window Management API + BroadcastChannel (`ouroboros_multiscreen_v1`); wireless mobile WebRTC DataChannel.

---

# 🧬 PART 2: Merging & Consolidation Blueprint

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                          UNIFICATION & MERGING BLUEPRINT                               │
├────────────────────────────────────────────────────────────────────────────────────────┤
│ 1. Core Sim: Multi-Layer Spatial Partition Grid (Unify all 5 entity collision scans)   │
│ 2. Combat: Data-Driven Module Action Registry (Eliminate 1,100 lines of switch cases) │
│ 3. Sim Cleanup: Delete orphaned CombatSystem.Auras.ts & CombatSystem.Skills.ts         │
│ 4. Rendering: Shared Ctx2D Sphere Lighting Gradient & Unified Telegraph Danger Drawer  │
│ 5. UI/UX: Merge GameOver + FloorClear into RunSummaryScreen & Pause into Settings     │
│ 6. Platform: Consolidate legacy MultiScreenSync.ts & Centralize all SaveIO serialization│
└────────────────────────────────────────────────────────────────────────────────────────┘
```

---

### 🔀 Merge Opportunity 1: Multi-Layered Spatial Partition Engine
- **Current Duplication:**
  - `SpatialHashGrid.ts` is currently used *only* for snake body segments.
  - Enemies, Boss parts, Projectiles, Hazards, and Food items are scanned via separate linear $O(N)$ loops. In `CombatSystem.updateSegmentModules`, 20 segments with 3 sockets each produce up to **60 linear scans per tick**.
- **Consolidated Design:**
  - Expand `SpatialHashGrid` to index **5 distinct layers** in flat contiguous `Int32Array` buffers:
    - `Layer 0`: Snake Segments
    - `Layer 1`: Enemies & Boss Hitboxes
    - `Layer 2`: Projectiles (Player & Enemy)
    - `Layer 3`: Hazards (Lasers, Fire, Poison)
    - `Layer 4`: Collectibles (Food, Shards, Helmets)
  - All weapon targeting, projectile impacts, aura ticks, and food suction execute in $O(1)$ grid queries (`queryRadius`, `queryNearest`, `queryRay`).

---

### 🔀 Merge Opportunity 2: Data-Driven Module & Weapon Action Registry
- **Current Duplication:**
  - [`CombatSystem.ts`](file:///home/forart/dev/snake_ts/src/sim/CombatSystem.ts) contains over **1,100 lines of hardcoded switch cases** duplicating weapon and defense execution between Head modules and Segment sockets.
  - Furthermore, 6 weapons (`mortar`, `sonic`, `gatling`, `caltrop`, `singularity`, `solar`) are missing from the Head module switch.
- **Consolidated Design:**
  - Replace the 1,100-line switch statement with a declarative `ModuleActionRegistry`:
    ```ts
    export interface ModuleActionDef {
      cooldown: (level: number) => number;
      category: 'offense' | 'defense' | 'utility';
      onTick?: (ctx: ModuleTickContext) => void;
      onFire?: (ctx: ModuleFireContext) => void;
      onHurt?: (ctx: ModuleHurtContext) => void;
    }
    ```
  - A single 30-line loop executes all Head modules and Body sockets identically, achieving 100% feature parity and cutting $>1,000$ lines of boilerplate.

---

### 🔀 Merge Opportunity 3: Deletion of Orphaned Sim Files
- **Current Redundancy:**
  - [`src/sim/CombatSystem.Auras.ts`](file:///home/forart/dev/snake_ts/src/sim/CombatSystem.Auras.ts) (240 lines) and [`src/sim/CombatSystem.Skills.ts`](file:///home/forart/dev/snake_ts/src/sim/CombatSystem.Skills.ts) (252 lines) are completely unimported and orphaned in the codebase.
  - `CombatSystem.ts` maintains duplicate inline implementations of all auras and skills.
- **Consolidation Design:**
  - Extract clean sub-engines (`CombatAuras.ts`, `CombatSkills.ts`, `CombatModules.ts`), import them directly into `CombatSystem.ts`, and delete the orphaned duplicates, reducing `CombatSystem.ts` from 3,244 lines to $<800$ lines.

---

### 🔀 Merge Opportunity 4: Unified Rendering Primitives & Danger Telegraphs
- **Current Duplication:**
  - The exact same 3D sphere lighting gradient `(-r*0.34, -r*0.38, r*0.08, 0, 0, r*1.1)` is duplicated in `SnakeRenderer.ts`, `BossRenderer.ts`, and `EnemyRenderer.ts`.
  - Danger indicators are fragmented across `BossRenderer.drawTelegraph`, `GameRenderer` hazard circles, and `EnemyRenderer` warp rings.
- **Consolidated Design:**
  - Add `Ctx2D.createSphereGradient(x, y, r, color)` to standardize lighting math.
  - Unify all danger indicators (circles, cones, lines, warp rings) into a single `TelegraphRenderer`.
  - Partition `FxManager` active particles into 4 shape buckets to replace 4 sequential full-array iterations with 1 batched pass.

---

### 🔀 Merge Opportunity 5: UI Screens Consolidation
- **Current Duplication:**
  - `GameOverScreen.ts` (114 lines) and `FloorClearScreen.ts` (91 lines) duplicate the exact same telemetry cards (Floor, Score, Combo, Shards, Kills).
  - Pausing opens `SettingsScreen.ts` with ad-hoc `engine.paused` branching rather than a clean pause overlay.
  - Every modal manually constructs `.modal-panel.glass-panel` wrappers and close handlers.
- **Consolidated Design:**
  - Merge `GameOverScreen` and `FloorClearScreen` into a polymorphic `RunSummaryScreen.ts` (`modal-summary`) handling Defeat, Floor Clear, and Victory.
  - Merge In-Game Pause and Settings into a unified `PauseSettingsScreen.ts` with quick resume/restart shortcuts during runs and full settings in menus.
  - Standardize `BaseModalScreen` / `ModalShell` to auto-generate glass headers, titles, and close buttons.

---

### 🔀 Merge Opportunity 6: Platform Persistence & Multi-Screen Consolidation
- **Current Duplication:**
  - `MetaProgression.ts` and `SaveIO.ts` duplicate v1 $\to$ v2 migration routines and JSON assembly.
  - `src/multiscreen/MultiScreenSync.ts` is an isolated duplicate of `src/platform/MultiScreen.ts` with divergent channel names (`ouroboros_multiscreen` vs `ouroboros_multiscreen_v1`).
- **Consolidated Design:**
  - Move 100% of JSON parsing, schema migration, sanitization, and CRC32 verification into `SaveIO.ts`, making `MetaProgression` a clean data consumer.
  - Delete `src/multiscreen/MultiScreenSync.ts` and standardize on `src/platform/MultiScreen.ts` using a unified packet envelope for both local BroadcastChannel and wireless WebRTC.

---

## 📊 Summary of Consolidation Impact

| Consolidation Target | Current Files Involved | Proposed Merged Solution | Estimated Code Reduction |
| :--- | :--- | :--- | :---: |
| **Spatial Collision Queries** | `SpatialHashGrid.ts`, `CombatSystem.ts` | 5-Layer Multi-Entity Spatial Hash Grid | **~400 lines & $60\times$ faster scans** |
| **Arsenal & Socket Execution** | `CombatSystem.ts` | Declarative `ModuleActionRegistry` | **~1,050 lines** |
| **Orphaned Sim Files** | `CombatSystem.Auras.ts`, `Skills.ts` | Integrated modular sub-engines | **~500 lines removed** |
| **Danger Telegraphs & Lighting** | `SnakeRenderer`, `BossRenderer`, `EnemyRenderer` | Shared `createSphereGradient` & `TelegraphRenderer` | **~250 lines** |
| **Run Summaries & Pause Modals** | `GameOverScreen`, `FloorClearScreen`, `SettingsScreen` | `RunSummaryScreen` & `PauseSettingsScreen` | **~350 lines** |
| **Multi-Screen & Save Persistence** | `SaveIO.ts`, `MetaProgression.ts`, `MultiScreenSync.ts` | Centralized `SaveIO` & `MultiScreen.ts` | **~300 lines** |
| **TOTAL CONSOLIDATION** | Across 18 files | **Unified Architecture** | **~2,850+ lines saved (100% DRY)** |
