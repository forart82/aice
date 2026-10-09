# Product Definition & Review (PDR): dogmax (Dark-Neon Horde ARPG)

> **Document Type:** Product Definition & Review (PDR) / Technical System Specification  
> **Project Identifier:** `dogmax`  
> **Source Authority:** [`ORACLE.md`](file:///home/forart/dev/dogMax/ORACLE.md), [`README.md`](file:///home/forart/dev/dogMax/README.md), [`GameDesign.md`](file:///home/forart/dev/dogMax/GameDesign.md), [`docs/GAME_PILLARS.md`](file:///home/forart/dev/dogMax/docs/GAME_PILLARS.md)  
> **Technology Stack:** C++23 / CMake / SFML 3 / Custom GLSL Shaders / Bespoke SFML UI Toolkit  
> **Target Platforms:** Linux Desktop (Primary), Native Desktop (Windows/macOS)  
> **Target Frame Rate:** Locked 60 FPS under 5,000+ simultaneous simulation entities  
> **Governance Standard:** Protocol 3.0 Enterprise Autonomous Agent Governance & Strict TDD  

---

## 1. Executive Summary & Concept Vision

### 1.1 One-Sentence Premise
**dogmax** is a dark-neon horde ARPG where the player survives overwhelming, screen-filling swarms by building broken-but-readable synergies across dice-socketed weapons, poker-like Dron combo multipliers, deep item quality tiers, and high-velocity evasion mechanics.

### 1.2 Core Feeling & Product Identity
The emotional core of dogmax is:
> *"The screen is full, I barely understand how I survived, but I know my weapon, dice, Dron pattern, and loot choices caused it."*

The player is constantly surrounded, under relentless swarm pressure, yet empowered through multiplicative mechanical synergy rather than simple incremental stat accumulation.

### 1.3 Reference Mix (Inspiration Matrix)
Rather than a direct clone of existing titles, dogmax synthesizes four distinct genres:
* **Vampire Survivors:** Unrelenting swarm pressure, readable screen-filling entity counts, rapid run momentum, and auto-attacking weapon cadences.
* **Path of Exile:** Deep itemization, multiplicative stat scaling, distinct build identities, and long-term theorycrafting depth.
* **Balatro:** Combinatorial surprise, simple discrete components (polyhedral dice faces) generating explosive poker-hand multipliers (Drons).
* **Dungeon Siege:** Authored continuous ARPG world exploration, physical environmental landmarks, and seamless traversal across bespoke regions.

### 1.4 Core Pillars & Anti-Pillars

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                             CORE GAME PILLARS                               │
├─────────────────────────────────────────────────────────────────────────────┤
│ 1. Readable Swarm Chaos      │ Thousands of enemies on screen; danger, hero │
│                              │ position, and combat feedback stay legible.   │
├──────────────────────────────┼──────────────────────────────────────────────┤
│ 2. Combinatorial Synergy     │ Dice, weapons, Dron tiers, and luck invite   │
│    Over Raw Accumulation     │ "What if I combine these?" not just "+10%".  │
├──────────────────────────────┼──────────────────────────────────────────────┤
│ 3. Frictionless Loot Flow    │ Deep itemization with rapid socketing,       │
│                              │ instant comparison, and fluid powdering.     │
├──────────────────────────────┼──────────────────────────────────────────────┤
│ 4. Authored Dark-Neon World  │ Meaningful routes, landmarks, and combat     │
│                              │ arenas over empty generated voids.           │
├──────────────────────────────┼──────────────────────────────────────────────┤
│ 5. Small Verified Slices     │ Strict TDD; zero speculative drift; 100%     │
│                              │ verified gameplay increments.                │
└──────────────────────────────┴──────────────────────────────────────────────┘
```

* **Anti-Pillars:**
  * ⛔ Never add complex systems merely because a reference game possesses them.
  * ⛔ Never introduce mechanics the player cannot intuitively exploit, understand, or counter.
  * ⛔ Never permit speculative architectural rewrites without an active verified vertical slice.
  * ⛔ Never compromise the 60 FPS horde fantasy for visual flair.

---

## 2. Visual Identity & Dark-Neon Aesthetic Architecture

### 2.1 The "Code-Drawn Dark-Neon" Art Directive
The visual language of dogmax is anchored in hard contrast: **pitch-black/near-black ground surfaces punctuated by razor-sharp, code-drawn neon strokes**. 
* **Dark Body First, Seam Light Only:** The hero and world actors are heavy silhouettes with internal light bleeding through panel gaps and edges, not soft, blurry light blobs.
* **Actor-Dominant Lighting Hierarchy:** Actors (hero, enemies, projectiles) emit intense, blooming light; the world environment remains strictly subordinate (`WORLD_NEON_SUBORDINATE_SCALE`), clamped below the bloom activation threshold.

### 2.2 Strict Three-Accent Hue Palette
To maintain instantaneous situational awareness in swarms of 5,000+ units, the game enforces an immutable three-accent color space:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          LOCKED THREE-ACCENT PALETTE                        │
├─────────────────┬─────────────────┬───────────────────┬─────────────────────┤
│ Visual Entity   │ Target Hue      │ Hex / Angle       │ Source Config Key   │
├─────────────────┼─────────────────┼───────────────────┼─────────────────────┤
│ Hero Outline    │ Cyber Orange    │ ~22° (Bright)     │ HERO_OUTLINE_R/G/B  │
│ Enemy Baseline  │ Electric Magenta│ ~338° (High Sat)  │ ENEMY_OUTLINE_*     │
│ Enemy (Rare)    │ Hot Pink / Rose │ ~329° (Vibrant)   │ ENEMY_OUTLINE_*_RARE│
│ World / Props   │ Ion Cyan        │ ~185° (Muted)     │ WORLD_NEON_ZONE_*   │
│ Health Status   │ Semantic Ramp   │ Green/Yellow/Red  │ INFOBAR_*           │
└─────────────────┴─────────────────┴───────────────────┴─────────────────────┘
```

> [!IMPORTANT]
> Gold was intentionally decommissioned from the enemy palette because it collided with the hero’s Cyber Orange in high-density swarms. Semantic health bars (green/yellow/red) exist on an orthogonal information channel and do not violate the three-accent rule.

### 2.3 Post-Processing & Shader Architecture
1. **Bloom Pipeline (Max-Channel Bright-Pass):**
   * Traditional Rec.601 luminance weighting fails on saturated colors: pure cyan/magenta would fail luminance thresholds despite being blindingly bright.
   * `dogmax` evaluates the bright-pass filter strictly via the maximum color channel:
     $$\text{Bright}(R, G, B) \iff \max(R, G, B) \ge \text{BLOOM\_BRIGHT\_THRESHOLD}$$
   * Followed by a two-pass separable Gaussian blur and additive blend onto the master render texture.
2. **Signed Distance Field (SDF) Neon Silhouettes:**
   * Enemy bodies and hero forms are drawn with mathematical SDF functions, enabling infinitely scalable, anti-aliased geometric rings, polygons, and stars without raster sprite artifacts.
3. **Dynamic Fog-of-War & Ground Shimmer:**
   * A dynamic GPU render-texture mask records movement reveal points with decay and teleport-safe boundaries, blended into procedural ground shaders with subtle animated noise.

---

## 3. Core Gameplay Loop & Mechanical Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           THE MINUTE-TO-MINUTE LOOP                         │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ 1. TRAVERSAL: Move through authored paths; trigger dynamic distance-spawns  │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ 2. AUTO-COMBAT: Weapons tick & fire automatically via dice countdown pacing │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ 3. EVADE & DODGE: Passive Doge rolls + active dash with invulnerability     │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ 4. HARVEST LOOT: Ingest dice, weapons, and powder drops into inventory      │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ 5. COMPOSE BUILD: Socket dice into weapons to unlock explosive Dron combos  │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 3.1 Hero Kinematics & Locomotion
* **Velocity-State Smoothing:** The hero utilizes continuous acceleration and deceleration where `velocity` itself serves as the persistent smoothing state.
* **Dead-Stop Epsilon:** Instantaneous snap-to-zero is gated strictly on a zero input vector (`input == (0,0)`), preventing stuttering during directional reversal maneuvers.
* **Hit-Stop Impact Pacing:** Mechanical impacts trigger a microscopic simulation freeze executed in real-world wall-clock time. Multiple simultaneous hits resolve under a **max-wins** contract (never additive), ensuring wide-arc swipes do not stall the game loop.

### 3.2 Auto-Attack Combat Pipeline
The hero auto-attacks using up to equipped weapon rows. Targeting is resolved headlessly through pure geometric spatial queries:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                             ATTACK MODE MATRIX                              │
├─────────────────┬───────────────────────────────────────────────────────────┤
│ SINGLE          │ Locks onto the nearest valid enemy within weapon range.   │
├─────────────────┼───────────────────────────────────────────────────────────┤
│ SWIPE           │ Cleaves every enemy within a configurable angular arc     │
│                 │ centred on the heading of the primary target.             │
├─────────────────┼───────────────────────────────────────────────────────────┤
│ MULTITARGET     │ Targets the N nearest distinct enemies simultaneously.    │
│                 │ If fewer than N exist, shortfalls repeat on closest.      │
├─────────────────┼───────────────────────────────────────────────────────────┤
│ MULTISINGLE     │ Discharges a high-speed focused salvo into a single enemy,│
│                 │ consolidating damage numbers into a single float.         │
├─────────────────┼───────────────────────────────────────────────────────────┤
│ AOE             │ Detonates radial burst damaging all entities in range.    │
└─────────────────┴───────────────────────────────────────────────────────────┘
```

### 3.3 The Doge & Active Dash Defense Systems
Defense operates on a two-tier paradigm: passive probability plus active manual execution:
1. **Passive Doge (Evasion):**
   * Granted by slotted dice. Combines across all active slots via a heterogeneous probability product:
     $$\text{Evasion} = \min\left(\text{EVASION\_CAP},\, 1 - \prod_{i=1}^n (1 - \text{evasion}_i)\right)$$
   * Caps at $75\%$ (`EVASION_CAP = 0.75`). Successful evasion triggers an instantaneous cyan ghost trail flash.
2. **Active Dash (Spacebar Kinematics):**
   * **Charge Pool:** 2 discrete charges (`DODGE_MAX_CHARGES = 2`).
   * **Pool-Wide Sequential Cooldown:** A unified 2.0-second cooldown timer refills one charge per cycle. Burning both charges requires two consecutive cycles (4.0s total).
   * **Kinematics & Invulnerability:** Burst velocity of $800\text{ px/s}$ over $0.18\text{ s}$ ($\approx 144\text{ px}$ displacement). Grants $0.22\text{ s}$ of absolute invulnerability frames (`i-frames`), cleanly covering the landing window.
   * **Dash-Through Kinetic Impact:** Enemies intercepted during the dash suffer fractional max-health damage and receive directional knockback.

---

## 4. Swarm & Enemy Ecosystem Architecture

### 4.1 3-Band Distance-to-Level Progression Curve
Enemy difficulty does not scale with elapsed run time; it scales strictly with **cumulative walked distance** ($d$), enforcing intentional spatial progression:

$$\text{SpawnLevel}(d) = \max \{ N \in [1, 99] : d \ge \text{Cumulative}[N] \}$$

```
Walked Distance (Cumulative Pixels)
 0 px ──[ Band 1: Linear Step ]──> 6,000,000 px (L2..L20)
       ──[ Band 2: Exp1 Factor ]──> 18,000,000 px (L21..L60)
       ──[ Band 3: Exp2 Factor ]──> ~28,000,000 px (L61..L99 Cap)
```

* **Band 1 (Linear):** Steady fixed-pixel steps ($N \le \text{LINEAR\_END}$).
* **Band 2 (Exp 1):** Moderate exponential step multiplier up to mid-game.
* **Band 3 (Exp 2):** Steep exponential escalation tuned to enforce an overall walk budget of $\approx 28\text{–}30\text{M pixels}$.
* **Enemy Speed Cap Invariant:** Enemy per-level speed multiplier is strictly bounded ($\approx 1.02$), ensuring enemies remain kitable by the hero even at Level 99.

### 4.2 5-Quintile Enemy Tier Cadence
Run progress is partitioned into 5 normalized progress bands ($Q_0 \dots Q_4$). Each spawn increments an internal sequence counter, evaluating against quintile-specific modulo thresholds:

$$\text{Spawn Tier} = \begin{cases} 
\text{Rare}, & \text{counter} \pmod{\text{Cadence}_{\text{rare}}(Q)} = 0 \\ 
\text{Uncommon}, & \text{counter} \pmod{\text{Cadence}_{\text{uncommon}}(Q)} = 0 \\ 
\text{Common}, & \text{otherwise} 
\end{cases}$$

### 4.3 Special Enemy Taxonomy & Authoritative Priority Gates
Special enemy identities override standard tier spawns using a strict, priority-ordered decision cascade:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       SPECIAL ENEMY SPAWN DECISION CASCADE                  │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
                   [ 1. Evaluate Glasswraith 1-in-N Gate ]
                   (Tier-independent; rolled before all tier gates)
                                       │ No
                                       ▼
                   [ 2. Is Spawn Tier == Rare? ]
                                       ├── Yes ──► [ 3. Inside Exclusion Zone? ]
                                       │           ├── Yes ──► VOIDCRAWLER (Wins Slot)
                                       │           └── No  ──► HEXARCHON (Ranged Sniper)
                                       │
                                       ▼ No
                   [ 4. Is Spawn Tier == Uncommon? ]
                                       ├── Yes ──► SHOCKER (Friendly Death AOE)
                                       └── No  ──► Standard Common Swarm Rusher
```

| Special Kind | Silhouette Archetype | Spawn Gate Condition | Distinct Combat Mechanic |
|---|---|---|---|
| **Glasswraith** | EtherLens (Pale Ice Shards) | 1-in-N random draw (evaluated **first**, tier-agnostic) | Fragile glass cannon; high burst damage, low HP pool. |
| **Voidcrawler** | EyeRift (Obsidian Core / Cyan Eye) | Rare-tier counter + active Exclusion Zone constraint | Drops guaranteed high-quality loot (overrides luck floor to 60+). |
| **Hexarchon** | Hexagram (Dual Orbiting Orbs) | Rare-tier counter (subordinate to Voidcrawler) | Maintains ranged standoff distance; **bypasses Doge/evasion** when hero HP $< 25\%$. |
| **Shocker** | Sunburst (Cyan / Pink Filigree) | Uncommon-tier counter gate | On death, detonates a friendly AOE blast damaging nearby foes based on **hero's** max HP. |
| **Tassidean Sentinel** | CosmicShield (Gold Ward Rings) | Authored map / editor placement | Heavy kinetic blocker; multi-phase shield buffer. |
| **Pact-Walker** | BipedRig (Earthen Silhouette) | Authored map / editor placement | Neutral occult wanderer; triggers hostile swarm frenzy upon being provoked. |

---

## 5. The Deep Combinatorial Dice & Dron Meta-Economy

The defining design innovation of dogmax is the hybridization of action RPG weapon combat with polyhedral dice rolling and poker-style combo multiplier logic.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         THE COMBINATORIAL DAMAGE PIPELINE                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  [ Base Weapon Damage ]                                                     │
│            │                                                                │
│            ▼                                                                │
│  [ × Sum of Slotted Dice Faces (Σfaces) ]                                    │
│            │                                                                │
│            ▼                                                                │
│  [ × Product of Dice Multipliers (Πmults) ]                                 │
│            │                                                                │
│            ▼                                                                │
│  [ × Dron Pattern Multiplier (1.0× to 40.0×) ]                              │
│            │                                                                │
│            ▼                                                                │
│  [ × Critical Multiplier (when Bernoulli(critChance) == true) ]             │
│            │                                                                │
│            ▼                                                                │
│  = FINAL DEALT DAMAGE (Floored at 1.0)                                      │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 5.1 The 10 Weapon Archetypes
Every weapon features base damage, native attack-per-second (APS), reach, critical scaling, and **2 to 6 polyhedral dice sockets**:

| Weapon Archetype | Attack Mode | Base Damage | Base APS | Range (px) | Native Crit% | Sockets |
|---|---|---|---|---|---|---|
| **Pitchfork** | SINGLE | 5–15 | 0.8 | 450 | 0% | 2–4 |
| **Long Sword** | SWIPE | 10–22 | 1.2 | 550 | 5% | 2–5 |
| **Great Sword** | SWIPE | 18–40 | 0.8 | 550 | 5% | 3–6 |
| **Halberd** | SWIPE | 14–30 | 0.9 | 600 | 8% | 2–5 |
| **Quarterstaff** | MULTITARGET | 8–18 | 1.4 | 400 | 4% | 2–6 |
| **Knives** | MULTISINGLE | 4–10 | 2.0 | 350 | 10% | 2–4 |
| **Dagger** | SINGLE | 12–25 | 1.5 | 300 | 15% | 2–4 |
| **Mace** | SINGLE | 15–32 | 1.0 | 450 | 6% | 2–5 |
| **Warhammer** | AOE | 25–55 | 0.6 | 500 | 12% | 3–6 |
| **Big Axe** | SWIPE | 22–48 | 0.7 | 520 | 10% | 3–6 |

> [!IMPORTANT]
> **Dice Pacing Invariant:** When any dice are socketed into a weapon, the weapon's static APS is completely suppressed. The weapon's firing cadence is dictated exclusively by the asynchronous countdown timers of its socketed dice.

### 5.2 The 10 Polyhedral Dice Catalog
Dice drop across 10 mathematical polyhedral shapes, rolling uniformly across their faces upon every firing cycle:
* **Catalog:** `d4`, `d6`, `d8`, `d12`, `d20`, `d24`, `d30`, `d42`, `d60`, `d100`.
* **Stat Affixes:** Each die carries roll duration, damage multipliers ($0.5\times\dots 3.5\times$), additive crit chance, multiplicative crit multiplier, and **Luck**.

### 5.3 The 15-Tier Dron Multiplier Ladder
At the moment of firing, the face values showing across all active dice in the weapon row are evaluated against an ordered predicate ladder. First match wins:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          THE 15-TIER DRON LADDER                            │
├────┬──────────────────┬───────┬─────────────────────────────────────────────┤
│Tier│ Dron Name        │ Mult  │ Exact Mathematical Predicate                │
├────┼──────────────────┼───────┼─────────────────────────────────────────────┤
│ 1  │ Hexadron         │ 40.0× │ 6-of-a-kind (requires 6 matched faces)      │
│ 2  │ Pentadron        │ 30.0× │ ≥5-of-a-kind                                │
│ 3  │ Twin-Tridron     │ 25.0× │ Two distinct 3-of-a-kinds (3 + 3)           │
│ 4  │ Quad-Duodron     │ 22.0× │ 4-of-a-kind plus a pair (4 + 2)             │
│ 5  │ Omidron          │ 20.0× │ Rainbow: exactly faces {1,2,3,4,5,6}        │
│ 6  │ Hemidron         │ 18.0× │ All faces > midpoint OR all faces ≤ midpoint│
│ 7  │ Triduo-Dron      │ 15.0× │ Three distinct pairs (2 + 2 + 2)            │
│ 8  │ Tetradron        │ 12.0× │ ≥4-of-a-kind                                │
│ 9  │ Lineadron        │ 10.0× │ 5 consecutive distinct values (straight)    │
│ 10 │ Split-Seqdron    │  8.0× │ Sets {1,2,3} AND {4,5,6} both present       │
│ 11 │ Mixdron          │  5.0× │ Full House (≥3 group + distinct ≥2 group)   │
│ 12 │ Minidron         │  3.0× │ 4 consecutive distinct values (short run)   │
│ 13 │ Tridron          │  2.5× │ ≥3-of-a-kind                                │
│ 14 │ Duodron          │  2.0× │ ≥2-of-a-kind (any pair)                     │
│ 15 │ Voidron          │  1.0× │ Fallback: no pattern match (silent, no float│
└────┴──────────────────┴───────┴─────────────────────────────────────────────┘
```

> [!TIP]
> **Relative Hemidron Split:** In earlier revisions, Hemidron used a static d6 split ($>3$), making d100 dice trivially trigger an 83% free multiplier. Hemidron is now strictly relative to each die’s individual face count ($F_i \times 0.5$).

### 5.4 The Loot, Quality & Luck Ecosystem
* **Three Quality Tiers:** Common ($1\dots 39$), Uncommon ($40\dots 79$), Rare ($80\dots 100$).
* **Universal Multiplier ($m$):**
  $$m = \left(\text{MIN} + (1 - \text{MIN}) \times \frac{q}{100}\right) \times \text{ItemLevel}$$
* **Independent Stat Rolls:** Each dropped item rolls 5 independent per-stat quality scores ($q_{\text{dmg}}, q_{\text{aps}}, q_{\text{range}}, q_{\text{crit}}, q_{\text{slots}}$), ensuring diverse and unique item drops.
* **Luck Scaling & Non-Linear Quality Floor:**
  $$\text{QualityFloor} = \text{clamp}\left(\left\lfloor \sqrt{\text{luckTotal}} \times 9.0 \right\rfloor,\, 0,\, 99\right)$$
  Using square-root scaling guarantees that early luck investments yield massive returns while preventing high-end builds from degenerating into trivial Rare-only drop loops.
* **Powder & Dice Crafter:** Surplus items dissolve into colored powders based on item stat weight. Powders are consumed in the in-game Dice Crafter to forge higher-tier polyhedrals.

---

## 6. Technical Architecture & High-Performance C++23 Engine

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                      MODULAR 4-TIER REPOSITORY TOPOLOGY                     │
├─────────────────────────────────────────────────────────────────────────────┤
│ 1. Core Domain Logic & Simulation Engine (Pure, Headless C++23, Zero SFML)  │
│    - Damage formulas, spatial partitioning, Dron detector, PRNG, state      │
├─────────────────────────────────────────────────────────────────────────────┤
│ 2. Abstraction & Configuration Layer (YAML ConfigLoader & Virtual Input)    │
│    - DeterministicRandom, ConfigLoader, virtual action bindings             │
├─────────────────────────────────────────────────────────────────────────────┤
│ 3. SFML Presentation & Rendering Shell (SFML 3 / Custom GLSL Shaders)       │
│    - SDF EnemyBodyPainter, BloomPipeline, FogOfWar, WorldEnvironmentRenderer│
├─────────────────────────────────────────────────────────────────────────────┤
│ 4. Authoring Tools & Debugging Shell (Modal In-Game Editors)                │
│    - WorldEditor (Ctrl+M), EnemyTemplateEditor (Ctrl+E), DebugPanel (F1)    │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 6.1 Deterministic Simulation Loop & PRNG
* **Decoupled 60 Hz Fixed Tick:** The simulation loop steps strictly at `SIM_TICK_HZ = 60 Hz` using a delta-time accumulator. Presentation rendering interpolates actor transforms between previous and current simulation ticks.
* **Platform-Independent PRNG:** Standard `std::mt19937_64` was discarded due to cross-platform standard library distribution divergences. The simulation uses **xoshiro128\*\* seeded by SplitMix64** (`DeterministicRandom`).
* **Bernoulli Call Invariant:** Probability checks draw from the PRNG stream even at boundary conditions ($p \le 0$ or $p \ge 1$) to prevent stream de-synchronization across minor balance adjustments.

### 6.2 Spatial Partitioning & 5,000-Entity Scaling
* High-density radius queries are handled via `core::SpatialGrid`.
* **Grid Invariant:** Cell dimension is tuned strictly to $2 \times \text{ENEMY\_COLLISION\_RADIUS}$.
* Entity allocation utilizes pre-allocated flat arrays and contiguous memory blocks, eliminating heap churn on inner combat loops.

---

## 7. World Generation, Authored Journeys & WorldEditor

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                 WORLD ENVIRONMENT AUTHORING PIPELINE (Ctrl+M)               │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ 1. Continuous Path Network (6x6 geometry-locked atlas, seamless ports)      │
├─────────────────────────────────────────────────────────────────────────────┤
│ 2. Stackable Polygon Floor Zones (Freeform vertices, explicit z-order)      │
├─────────────────────────────────────────────────────────────────────────────┤
│ 3. Dynamic Magnetic Snapping (Edge, center, and grid snapping)              │
├─────────────────────────────────────────────────────────────────────────────┤
│ 4. Asset Hierarchy Browser (Instant thumbnail indexing across assets/)      │
├─────────────────────────────────────────────────────────────────────────────┤
│ 5. Atomic Config Persistence (Flushes directly to configs/world_editor.yaml)│
└─────────────────────────────────────────────────────────────────────────────┘
```

* **Region 1 Starting Slice:** Rooted in the central farmstead (`docs/visuals/region1.png`), branching outward into winding corridors.
* **Atlas Path Resolver:** Freehand route nodes are resolved into seamless geometric tiles using a 6x6 track atlas. Shared port planes eliminate visual overlapping and texture seams.

---

## 8. Implementation Traps & Engineering Mitigations

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                   TECHNICAL TRAPS & VALIDATED MITIGATIONS                   │
├─────────────────────────────────────────────────────────────────────────────┤
│ Trap 1: Bloom Starvation on Saturated Cyberpunk Hues                        │
│ ──► Problem: Standard Rec.601 luminance weighting kills saturated magenta   │
│     and orange colors, rendering bloom completely inert.                    │
│ ──► Mitigation: Bright-pass extracted via max-channel: max(R,G,B) >= thresh. │
├─────────────────────────────────────────────────────────────────────────────┤
│ Trap 2: Weapon Desync on Slotted Dice Pacing                                │
│ ──► Problem: Firing when all dice finish without resetting the full set     │
│     causes asynchronous dice phase drift.                                   │
│ ──► Mitigation: Weapon reset re-derives effective duration and resets ALL   │
│     slotted dice countdowns simultaneously on every discharge.              │
├─────────────────────────────────────────────────────────────────────────────┤
│ Trap 3: Runaway Levelling from Unbounded Step Costs                         │
│ ──► Problem: Zero or negative XP thresholds trigger infinite level-up loops │
│ ──► Mitigation: XP steps strictly clamped to max(1, step) with Monotonic    │
│     step growth table.                                                      │
├─────────────────────────────────────────────────────────────────────────────┤
│ Trap 4: Hemidron Freebie with High-Polyhedral Dice                          │
│ ──► Problem: A static d6 midpoint (3.0) gives d100 an 83% auto-Hemidron.    │
│ ──► Mitigation: Midpoints dynamically calculated per die: faceCount * 0.5.  │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 9. Implementation Roadmap & Production Milestones

### 9.1 Phase Status & Core Horizon

* [x] **Phase 0: Build & Runtime Stabilization** — Off-box CMake compilation, `-Werror` conformance, stamped executable snapshot rotation (`dogmax-<timestamp>`).
* [x] **Phase A: Critical Combat & Inventory Mechanics** — Equipping level-rescaling, inventory capacity fail-safes, 5-quintile spawn cadence, dice countdown pacing.
* [x] **Phase B: Progression & Dron Rebalance** — Monotonic XP curve, relative Hemidron midpointing, 3-band distance curve calibration.
* [x] **Phase C: In-Game Authoring Suite** — WorldEditor (Ctrl+M) path/zone tools, Enemy Template Editor (Ctrl+E), live asset gallery.
* [ ] **Phase D: Current Active Slice (Region 1 World Validation)** — Authoring and approving the 5-minute farm/corridor loop; validating collision metadata and walkability boundaries.
* [ ] **Phase E: Loot Clarity & Spatial Audio Overhaul** — Fast item comparison tooltips, directional audio positioning, seamless BGM coexistence.
* [ ] **Phase F: Long-Run Meta-Progression & Outposts** — Tassidean outposts, NPC vendor economies (Blacksmith, Pharmacist, Collector), permanent Veros shard upgrades.

---

## 10. Quality Gate, Protocol 3.0 Governance & CI/CD Conformance

* **Automated Quality Gate (`./verify`):**
  Every code change must achieve a 100% clean, warning-free build under `-Werror` across test and release targets before commit:
  ```bash
  ./verify        # Runs doctest suite + strict compilation check
  ./bt            # Release build + timestamped root snapshot rotation
  ./runGame       # Launches the newest active snapshot with config mapping
  ```
* **Snapshot Retention Protocol:** `./bt` stamps every release binary (`dogmax-YYYYMMDDHHMMSS`), maintaining exactly the 5 most recent snapshots and pruning older artifacts.
* **Absolute SSOT Covenant:** [`ORACLE.md`](file:///home/forart/dev/dogMax/ORACLE.md) remains the binding legal source of truth. All game balancing variables reside in `configs/*.yaml` and are never hard-coded in C++ translation units.

---
*Document compiled and verified against the authoritative `dogmax` codebase and Oracle SSOT.*
