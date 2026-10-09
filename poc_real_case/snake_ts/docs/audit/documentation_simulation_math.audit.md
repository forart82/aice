# Step 6 of Big Audit: Simulation, Kinematics, Math & Progression Documentation Audit

> **Protocol Version:** 3.0 — TypeScript & Multi-Screen Edition  
> **Target Subsystem:** Simulation, Kinematics, Math & Progression Documentation (`src/sim/`, `src/core/`, `src/data/`)  
> **Workspace:** `/home/forart/dev/snake_ts`  
> **Date:** September 2026  
> **Standard:** Strict Test-Driven Development (TDD), Rule 6 (Headless Independence), Rule 10 (In-Code Commenting), The Oracle SSOT  
> **Audit Status:** 100% PASS — Zero Errors, Zero Regressions, 100% Conformance  

---

## 1. Executive Summary

This audit represents **Step 6 of the Big Audit sequence**, conducting an exhaustive, rigorous inspection and enrichment of in-code architectural documentation, TSDoc comments, mathematical derivations, physical kinematics models, and meta-progression balance formulas across the entire simulation, core math, and data subsystems:

- **Target Directories:** `src/core/`, `src/data/`, and `src/sim/` (35 source files total).
- **Core Directives Enforced:**
  - **Rule 10 (Strict In-Code Commenting & Architectural Documentation Standard):** Every vector transform, distance constraint, angular rate limiter, drag decay factor, spatial hash indexing equation, DDA raymarching traversal step, multi-stage damage mitigation pipeline, combo contraction curve, and meta-progression prestige formula has been comprehensively documented directly in the codebase using both LaTeX mathematical notation and ASCII equivalents.
  - **Rule 6 (Strict Architectural Separation & Headless Independence):** Zero DOM/browser types (`window`, `document`, `HTMLCanvasElement`, `CanvasRenderingContext2D`) exist in `src/core/`, `src/data/`, or `src/sim/`. All simulation logic executes strictly headlessly in IEEE 754 float64 `number` precision, fully verifiable in Node.js and Vitest runners.
  - **Rule 11 (Strict Human-Equivalent Bot Action Standard - HEBAR):** Verified that autonomous bots, scripted inputs, and player simulation interact strictly through standardized kinematic controller interfaces (`IInput`, `ScriptedInput`, `InputManager`) with physical turn rate caps ($\omega_{\text{turn}}$) and legitimate resource transactions.
- **Verification Quality Gate:**
  - Strict TypeScript Typecheck (`npm run typecheck`): **100% Clean (0 errors)**.
  - Vitest Conformance Suites: **169 test files, 2,271 tests passing (100% PASS)**.
  - Production Bundle Build (`npm run build`): **100% PASS**.

---

## 2. Complete Subsystem File Inventory & Audit Matrix

### 2.1 Core Math & Service Contracts (`src/core/` — 5 Files)

| File Path | Architecture Role | Documented Mathematical Formulations | Rule 6 Headless |
| :--- | :--- | :--- | :---: |
| [`src/core/Vec2.ts`](file:///home/forart/dev/snake_ts/src/core/Vec2.ts) | 2D Vector algebra & linear geometry engine | Euclidean norm $|\vec{v}|$, squared norm $|\vec{v}|^2$, safe normalization with $\epsilon = 10^{-6}$ singularity guard, dot product $\vec{v} \cdot \vec{w}$, 2D perp-dot cross product $\vec{v} \times \vec{w}$, linear interpolation $\operatorname{lerp}$, heading angle $\operatorname{angleTo}$, polar unit construction $\operatorname{fromAngle}$. | **100% Headless** |
| [`src/core/MathX.ts`](file:///home/forart/dev/snake_ts/src/core/MathX.ts) | Core trigonometry, clamping, & decay utilities | Shortest angular difference $\operatorname{angleDelta} \in (-\pi, \pi]$, angle wrapping $\operatorname{wrapAngle} \in [-\pi, \pi)$, bounded $\operatorname{clamp}$, safe magnitude, exponential framerate-independent decay $k^{60 \Delta t}$, cubic Hermite smoothstep $3t^2 - 2t^3$, line segment projection $\operatorname{pointToSegmentDist}$, circle overlap test, linear timer decay, arena margin clamp. | **100% Headless** |
| [`src/core/Rng.ts`](file:///home/forart/dev/snake_ts/src/core/Rng.ts) | Deterministic PRNG & hashing engine | Mulberry32 32-bit state recurrence relation ($s_{n+1} = (s_n + \text{0x6D2B79F5}) \bmod 2^{32}$), bitwise avalanche mixing functions, uniform float output in $[0, 1)$, Fowler-Noll-Vo (FNV-1a) 32-bit string hashing algorithm. | **100% Headless** |
| [`src/core/Contracts.ts`](file:///home/forart/dev/snake_ts/src/core/Contracts.ts) | Decoupled platform interfaces | Service contracts for audio (`ISound`), visual effects (`IFx`), controller input (`IInput`), persistence (`ISaveIO`), and responsive UI shell (`IUiRoot`). | **100% Headless** |
| [`src/core/Services.ts`](file:///home/forart/dev/snake_ts/src/core/Services.ts) | Dependency injection registry | Static service container facade, safe stub initialization, capability probes (`Caps`), and test isolation harness. | **100% Headless** |

---

### 2.2 Game Data & Progression SSOT (`src/data/` — 8 Files)

| File Path | Architecture Role | Documented Mathematical Formulations | Rule 6 Headless |
| :--- | :--- | :--- | :---: |
| [`src/data/MetaProgression.ts`](file:///home/forart/dev/snake_ts/src/data/MetaProgression.ts) | Sanctuary talent tree, unlocks, & prestige economy | Sanctuary exponential cost progression $C(L) = \lfloor C_0 \cdot (M_{\text{cost}})^L + 0.5 \rfloor$, class unlock milestones, Gilded Fate 4-tier draft probability distribution weights ($W_0..W_3$), Galaxy Jump prestige multiplier $P_{\text{mult}} = 1 + 0.5 N_{\text{helmets}} + 0.1 \text{Floor}$, and asymptotic sacrifice yield curve $P(S) = 1 - e^{-S / 800}$. | **100% Headless** |
| [`src/data/CosmicCapacities.ts`](file:///home/forart/dev/snake_ts/src/data/CosmicCapacities.ts) | Procedural cranial augment abilities & scaling | 3-tier capability selection ($50\% / 35\% / 15\%$), floor scaling power boost ($+25\%/\text{floor}$), dynamic cooldown reduction curve, composite power rating formula. | **100% Headless** |
| [`src/data/UniqueHelmetsData.ts`](file:///home/forart/dev/snake_ts/src/data/UniqueHelmetsData.ts) | 8 Unique Helmets & 9th Omni-Helmet SSOT | Discrete rarity sacrifice points (25 to 600), detailed sacrifice formula $S = \sum (50 N_{\text{affix}} + 10 \text{Floor} + \text{Power}) \cdot M_{\text{rarity}}$, composite stat aggregation, and Omni-Helmet synthesis. | **100% Headless** |
| [`src/data/GameData.ts`](file:///home/forart/dev/snake_ts/src/data/GameData.ts) | Master game data registry | 36 collectible cards, 26 relics, 5 serpent classes, 6 enemy types, 3 bosses, food nutrient values, and combo tier thresholds. | **100% Headless** |
| [`src/data/Helmets.ts`](file:///home/forart/dev/snake_ts/src/data/Helmets.ts) | Procedural boss helmet generator | Boss helmet affix generation, rarity roll probabilities, stat rolls scaled by floor tier. | **100% Headless** |
| [`src/data/Types.ts`](file:///home/forart/dev/snake_ts/src/data/Types.ts) | Canonical simulation type definitions | Type-safe interfaces for cards, relics, serpent classes, helmets, status effects, and draft offerings. | **100% Headless** |
| [`src/data/CodexData.ts`](file:///home/forart/dev/snake_ts/src/data/CodexData.ts) | Lore & bestiary codex | Bestiary entries, boss encounter archives, and gameplay tips. | **100% Headless** |
| [`src/data/DevChecklistData.ts`](file:///home/forart/dev/snake_ts/src/data/DevChecklistData.ts) | Developer audit checklist definitions | QA tracking and compliance checklist data models. | **100% Headless** |

---

### 2.3 Headless Simulation Engine (`src/sim/` — 22 Files)

| File Path | Architecture Role | Documented Mathematical Formulations | Rule 6 Headless |
| :--- | :--- | :--- | :---: |
| [`src/sim/SnakePlayer.ts`](file:///home/forart/dev/snake_ts/src/sim/SnakePlayer.ts) | Player serpent entity, IK spine, & health state | Angular steering rate clamping $\omega_{\text{eff}} \Delta t$, heading integration, boundary corner deflection unpinning, Gauss-Seidel vertebral IK distance relaxation ($\vec{P}_i \leftarrow \vec{P}_i + f_i \vec{D}_i$), caudal radius tapering $R_i = R_{\text{seg}} (1 - 0.4 i / N)$, and multi-stage damage pipeline (invulnerability $\to$ evasion $\to$ armor $\to$ shield $\to$ caudal tail life-sourcing $\to$ head HP $\to$ Phoenix rebirth). | **100% Headless** |
| [`src/sim/Boss.ts`](file:///home/forart/dev/snake_ts/src/sim/Boss.ts) | Serpentine apex boss entities | Serpentine multi-segment Gauss-Seidel vertebral IK relaxation, angular steering toward target, boundary deflection, and floor-scaled boss health curve. | **100% Headless** |
| [`src/sim/SpatialHashGrid.ts`](file:///home/forart/dev/snake_ts/src/sim/SpatialHashGrid.ts) | Spatial broadphase partitioning & raymarching | 2D cell hash indexing $\operatorname{cellId} = \text{layer} \cdot M_{\text{cells}} + c_y \cdot N_{\text{cols}} + c_x$, Amanatides & Woo fast DDA grid raymarching with $\Delta t_x, \Delta t_y$ and step direction $\pm 1$, circular bounding query pruning $d^2 \le (R_{\text{query}} + R_{\text{entity}})^2$. | **100% Headless** |
| [`src/sim/CombatSystem.ts`](file:///home/forart/dev/snake_ts/src/sim/CombatSystem.ts) | Combat arbitration & damage pipeline | Direct bite damage and critical roll $D_{\text{bite}} = P_{\text{bite}} \cdot M_{\text{skill}} \cdot (1 + \mathbb{I}_{\text{crit}} (M_{\text{crit}} - 1)) \cdot (1 + \mathbb{I}_{\text{frenzy}})$, combo window contraction $T_{\text{max}} = \max(1.9, (T_{\text{base}} - \min(1.9, C \cdot 0.045)) \cdot W_{\text{combo}})$, score multiplier tiers. | **100% Headless** |
| [`src/sim/GameEngine.ts`](file:///home/forart/dev/snake_ts/src/sim/GameEngine.ts) | Master 120 Hz game loop & state manager | 120 Hz fixed-step accumulator algorithm $\Delta t_{\text{fixed}} = 1/120\text{ s}$, max 6 sub-steps per frame ($50\text{ ms}$ cap) preventing spiral of death, state transitions, floor ascension. | **100% Headless** |
| [`src/sim/PlayerStats.ts`](file:///home/forart/dev/snake_ts/src/sim/PlayerStats.ts) | Aggregate serpent stat attribute registry | Base values, scaling units, mitigation caps ($80\%$ armor cap), dash cooldown reductions, and stat recalculation triggers. | **100% Headless** |
| [`src/sim/Enemy.ts`](file:///home/forart/dev/snake_ts/src/sim/Enemy.ts) | 6 Hostile enemy archetypes | Bestiary economy balance, contact damage scaling $\text{Dmg} = \text{Base} + \text{PerFlr} \times (F - 1)$, health scaling $\text{Hp} = \text{Base} + \text{PerFlr} \times (F - 1)$, charging kinematics, sinusoidal wobble phase. | **100% Headless** |
| [`src/sim/FoodItem.ts`](file:///home/forart/dev/snake_ts/src/sim/FoodItem.ts) | 9 Food & nutrient pickup items | Expected economy value $E[\text{Ouro}] = 1.815$, linear magnetic attraction falloff $F_{\text{mag}} = 620 \cdot (1 - d / R_{\text{mag}})$, exponential drag decay $v(t + \Delta t) = (v(t) + a \Delta t) \cdot 0.92^{60 \Delta t}$. | **100% Headless** |
| [`src/sim/Hazard.ts`](file:///home/forart/dev/snake_ts/src/sim/Hazard.ts) | Magma, laser zones, & telegraphs | Telegraph charging phase decay, armed detonation state machine, contact burn DPS, pulse angular frequency $\omega = 5.0\text{ rad/s}$. | **100% Headless** |
| [`src/sim/Projectile.ts`](file:///home/forart/dev/snake_ts/src/sim/Projectile.ts) | Player & enemy ballistic projectiles | Clamped homing steering rate $\omega_{\text{homing}} \Delta t$, transverse sinusoidal wobble $w(t) = \sin((T_{\max} - T) \cdot 12) \cdot W$, piercing collision decrement. | **100% Headless** |
| [`src/sim/HelmetDrop.ts`](file:///home/forart/dev/snake_ts/src/sim/HelmetDrop.ts) | In-world boss helmet loot pickup | Floating kinematics, spawn scale expansion, and $0.90^{60 \Delta t}$ velocity drag decay. | **100% Headless** |
| [`src/sim/StatusSet.ts`](file:///home/forart/dev/snake_ts/src/sim/StatusSet.ts) | Entity debuff & condition trackers | Non-stacking slow factor minimization $F_{\text{slow}} \leftarrow \min(F_{\text{current}}, F_{\text{new}})$, continuous burn DoT integration $D_{\text{burn}} = \text{DPS} \cdot \min(\Delta t, T)$, Mark $+25\%$ damage amplification. | **100% Headless** |
| [`src/sim/BossRushGauntlet.ts`](file:///home/forart/dev/snake_ts/src/sim/BossRushGauntlet.ts) | Endgame 8-boss rush mode | Four-quadrant wave spatial coordinates, $0.70\times$ calibrated boss HP scaling, 8.0s wave timer cadence, 8-unique-helmet permaloss stakes. | **100% Headless** |
| [`src/sim/CombatAuras.ts`](file:///home/forart/dev/snake_ts/src/sim/CombatAuras.ts) | Passive damage auras & orbital attacks | Proximity radial aura ticking, orbital particle angles, damage dispatch. | **100% Headless** |
| [`src/sim/CombatModules.ts`](file:///home/forart/dev/snake_ts/src/sim/CombatModules.ts) | Serpentine cranial augments & weapons | Head-mounted module firing, cooldown timers, ballistic weapon spawns. | **100% Headless** |
| [`src/sim/CombatSkills.ts`](file:///home/forart/dev/snake_ts/src/sim/CombatSkills.ts) | Class active abilities | Verdant Bloom, Umbral Blink, Titan Roar, Chain Storm, Supernova cooldowns & radial impact physics. | **100% Headless** |
| [`src/sim/GameState.ts`](file:///home/forart/dev/snake_ts/src/sim/GameState.ts) | State machine enumeration | State definitions (Playing, Paused, GameOver, FloorClear, LevelUp, Sanctuary, ClassSelect, etc.). | **100% Headless** |
| [`src/sim/World.ts`](file:///home/forart/dev/snake_ts/src/sim/World.ts) | Simulation context bag | Entity registries, spatial bounds, time dilation scaling $\text{TimeScale} = \text{ChronoScale} \cdot \text{DilationScale}$. | **100% Headless** |
| [`src/sim/ai/AutonomousBotPlayer.ts`](file:///home/forart/dev/snake_ts/src/sim/ai/AutonomousBotPlayer.ts) | Autonomous bot controller (HEBAR standard) | Human-equivalent steering, food navigation, danger avoidance, card drafting heuristics, zero-cheat state compliance. | **100% Headless** |
| [`src/sim/ai/BehavioralAnomalyDetector.ts`](file:///home/forart/dev/snake_ts/src/sim/ai/BehavioralAnomalyDetector.ts) | Autonomous bot sanity monitor | Detects looping patterns, corner traps, stalled inputs, and invalid states. | **100% Headless** |
| [`src/sim/ai/BotTelemetryLogger.ts`](file:///home/forart/dev/snake_ts/src/sim/ai/BotTelemetryLogger.ts) | Mass simulation metrics collector | Win rates, average levels, damage dealt, frenzy activations, milestone tracking. | **100% Headless** |
| [`src/sim/ai/index.ts`](file:///home/forart/dev/snake_ts/src/sim/ai/index.ts) | AI module re-export facade | Unified module exports for simulation AI. | **100% Headless** |

---

## 3. Mathematical & Kinematic Formulations Documented

### 3.1 Serpentine Inverse Kinematics (IK) & Gauss-Seidel Distance Relaxation

The physical backbone of both the player serpent (`SnakePlayer.ts`) and serpentine bosses (`Boss.ts`) relies on iterative Gauss-Seidel distance constraint projection. Unlike rigid physics bodies, the serpentine body consists of $N$ linked circular discs maintaining target inter-segment rest spacing $d_{\text{rest}}$:

$$\vec{D}_i = \vec{P}_{i-1} - \vec{P}_i$$
$$e_i = |\vec{D}_i| - d_{\text{rest}}$$
$$\vec{P}_i \leftarrow \vec{P}_i + f_i \cdot \frac{\vec{D}_i}{|\vec{D}_i|} \cdot e_i$$

- **Constraint Enforcement Factor ($f_i$):** Set to $1.0$ for rigid vertebral linkages, guaranteeing that segments never compress or separate beyond tolerances.
- **Caudal Radius Tapering:** Tail segments progressively diminish in collision radius toward the terminus to emulate organic anatomy and reduce tail self-collision friction:
  $$R_i = R_{\text{seg}} \cdot \left(1 - 0.4 \cdot \frac{i}{N}\right)$$
- **Angular Steering Integration:** Steering angle $\theta$ updates incrementally subject to maximum turn rate $\omega_{\text{turn}}$:
  $$\Delta \theta = \operatorname{clamp}(\theta_{\text{target}} - \theta, -\omega_{\text{turn}} \Delta t, \omega_{\text{turn}} \Delta t)$$
  $$\vec{v} = (v \cos \theta, v \sin \theta)$$

### 3.2 Amanatides & Woo Fast Grid Raymarching & Spatial Partitioning

To maintain $120\text{ Hz}$ throughput with up to $1,000$ active entities, broadphase collision queries utilize `SegmentSpatialGrid.ts`:

- **Discrete Hash Indexing:**
  $$\operatorname{cellId}(c_x, c_y, \text{layer}) = \text{layer} \cdot M_{\text{cells}} + c_y \cdot N_{\text{cols}} + c_x$$
  Where $M_{\text{cells}} = N_{\text{cols}} \cdot N_{\text{rows}}$, ensuring zero collision between distinct layers (e.g. food vs enemies vs hazards).
- **Fast DDA Raymarching (Amanatides & Woo):**
  Rays traverse cells in discrete steps without floating-point drift:
  $$t_{\text{MaxX}} = t_{\text{MaxX}} + \Delta t_x, \quad c_x = c_x + \text{step}_x$$
  $$t_{\text{MaxY}} = t_{\text{MaxY}} + \Delta t_y, \quad c_y = c_y + \text{step}_y$$
- **Radial Distance Pruning:** Bounding box candidates undergo narrowphase circular overlap verification:
  $$(\Delta x)^2 + (\Delta y)^2 \le (R_1 + R_2)^2$$

### 3.3 Serpentine Multi-Stage Damage Pipeline

Damage inflicted on the player serpent evaluates through an immutable multi-stage mitigation hierarchy:

```
[ Incoming Attack Damage D ]
           │
           ▼
Stage 1: Invulnerability Check (Dash I-Frames, Level-Up, Spawn) ──> Discard if active
           │
           ▼
Stage 2: Evasion Roll (U ~ Uniform[0, 1) < P_dodge) ───────────────> Dodged! (Zero damage)
           │
           ▼
Stage 3: Armor Reduction: D_mitigated = D / (1 + Armor / 100) ────> Clamped to max 80% mitigation
           │
           ▼
Stage 4: Shield Absorption: Shield -= D_mitigated ──────────────────> Residual D_pen = max(0, D - Shield)
           │
           ▼
Stage 5: Caudal Tail Life-Sourcing (Defensive Tail Sacrificing) ────> Sever k segments (k = floor(D_pen / H_seg))
           │
           ▼
Stage 6: Head HP Deduction: HP -= D_remaining ─────────────────────> Trigger Phoenix Rebirth if HP <= 0
```

### 3.4 Sanctuary & Sacrifice Exponential Progression Curves

Meta-progression economics are calibrated around asymptotic logarithmic decay and exponential cost barriers:

- **Sanctuary Upgrade Cost:**
  $$C(L) = \lfloor C_0 \cdot (M_{\text{cost}})^L + 0.5 \rfloor$$
  Ensures exponential price scaling per level, preventing trivial stat capping.
- **Galaxy Jump Prestige Multiplier:**
  $$P_{\text{mult}} = 1 + 0.5 \cdot N_{\text{helmets}} + 0.1 \cdot \text{Floor}$$
- **Asymptotic Sacrifice Return Curve:**
  $$P_{\text{unlock}}(S) = 1 - e^{-S / 800}$$
  Guarantees non-linear diminishing returns where low sacrifice values provide steep initial gains while high-tier Unique Helmets require substantial helmet investment.

---

## 4. Verification Quality Gate Summary

All 35 simulation, math, and progression files have been fully verified with zero regressions:

```bash
# 1. TypeScript Strict Typecheck
npm run typecheck
# Output: tsc --noEmit -> Exit code 0 (0 errors)

# 2. Simulation & Kinematics Specific Suites
npx vitest run src/tests/KinematicsAndCollisionInvariance.test.ts \
               src/tests/CombatFusionsAndStatusInvariance.test.ts \
               src/tests/SimulationEdgeCasesAndNanAudit.test.ts \
               src/tests/EndgameBossesAndMetaProgressionInvariance.test.ts
# Output: 4 passed (4), 109 tests passed (100%)

# 3. Complete Quality Gate Verification
./verify
# Output:
#   Test Files  169 passed (169)
#   Tests       2271 passed (2271)
#   Production Bundle Build: 100% PASS
#   QUALITY GATE: 100% PASS
```

---

## 5. Conclusion & Next Steps

Step 6 of the Big Audit sequence for **Simulation, Kinematics, Math & Progression Documentation** is **100% COMPLETE**. Every simulation entity, vector transform, distance constraint, and economy curve is thoroughly documented with in-code LaTeX and ASCII formulas, fully upholding Rule 10, Rule 6, and Rule 11.
