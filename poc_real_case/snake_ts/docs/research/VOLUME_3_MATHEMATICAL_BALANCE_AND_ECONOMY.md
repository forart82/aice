# 📊 Volume 3: Mathematical Game Balance, Power Curves & Dynamic Difficulty Adjustment (DDA)

> **Document Scope:** Mathematical Game Balance, Asymmetric Archetype Formulas, Calculation Buckets, Soft-Cap Curves, Wave Pacing Envelopes, and Segment Comeback Kinematics  
> **Target Application:** *Ouroboros Ascension* & 2D Action Roguelite Architecture  
> **Prepared for:** Deep Game Architecture & Retention Engineering  

---

## 1. Executive Summary: The Mathematics of Controlled Asymmetry

Balancing a roguelite is not about creating sterile mathematical equality; it is about **controlled asymmetry, compounding power fantasies, and dynamic tension**. Players want to feel that their build is "breaking the game," while the underlying simulation maintains tight mathematical bounds that prevent trivialization or catastrophic engine death spirals.

This volume formalizes the five interconnected mathematical frameworks governing *Ouroboros Ascension*:
1. **Asymmetric Archetype Triad:** Differentiated through Effective Health Pools ($\text{EHP}$), mobility evasion windows, and delivery mechanics.
2. **Calculation Bucket Architecture:** Structured additive vs. multiplicative stat layers and super-crit overflow logic.
3. **Rational & Hyperbolic Soft-Caps:** Preserving late-game challenge through asymptotic diminishing returns.
4. **Sinusoidal Wave Pacing & DDA:** Three-phase wave envelopes, elite spawn curves, and boss soft-enrage timers.
5. **Segment Health Balancing & Comeback Elasticity:** Ablative hull mechanics that turn segment loss into high-octane clutch moments.

---

## 2. Asymmetric Archetype Triad & The Power Invariant

```
                       [Glass Cannon / Agile]
                        (Speed, Crit, Burst)
                               ▲
                              / \
                             /   \
                            /     \
                           /       \
  [Armored Juggernaut] ◄──────────────► [Elemental Summoner / Zoner]
(EHP, Thorns, Contact Area)           (AoE, DoT, Autonomous Modules)
```

### 2.1 The Effective Health Pool (EHP) & Effective DPS (EDPS) Equations

#### Effective Health Pool ($\text{EHP}$):
$$\text{EHP} = \frac{\text{Base HP} + \text{Shield}}{1 - \text{Damage Reduction}} \times \frac{1}{1 - P(\text{Evasion})}$$

Where:
- $\text{Damage Reduction } (DR) = \min\left(0.85, \frac{\text{Armor}}{\text{Armor} + 100}\right)$.
- $P(\text{Evasion})$ is a function of forward velocity ($v$), dash cooldown ($\tau_{\text{dash}}$), and angular turn rate ($\omega$).

#### Effective DPS ($\text{EDPS}$):
$$\text{EDPS} = \left[ (\text{Base DPS} + \Delta \text{DPS}_{\text{flat}}) \times \left(1 + \sum d_{\text{add}}\right) \times \left(1 + c \cdot (M_{\text{crit}} - 1)\right) \right] \times \eta_{\text{uptime}}$$

Where $\eta_{\text{uptime}} \in [0.4, 0.95]$ represents spatial delivery efficiency (firing arc coverage, projectile speed, AoE radius).

---

### 2.2 The Archetype Power Budget Invariant ($\Phi = 100 \pm 3\%$)
To guarantee that no starting class is statistically obsolete or overpowered, every archetype conforms to the normalized **Power Budget Equation**:

$$\Phi = w_{\text{hp}} \left(\frac{\text{HP}}{\text{HP}_0}\right) + w_{\text{spd}} \left(\frac{v}{v_0}\right)^{1.5} + w_{\text{dash}} \left(\frac{\tau_0}{\tau}\right) + w_{\text{dmg}} \left(\frac{\text{DPS}}{\text{DPS}_0}\right) + w_{\text{crit}} (c \cdot M_{\text{crit}}) + w_{\text{def}} \left(\frac{1}{1 - DR}\right)$$

*Standard Calibration Weights:* $w_{\text{hp}} = 20, w_{\text{spd}} = 25, w_{\text{dash}} = 15, w_{\text{dmg}} = 20, w_{\text{crit}} = 10, w_{\text{def}} = 10$.

| Class ID | Archetype | Base HP | Speed ($v$) | Dash CD ($\tau$) | Bite Dmg | Crit ($c / M$) | Armor ($DR$) | Power Budget $\Phi$ |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `emerald` | Balanced / Regen | 110 ($1.0\times$) | $1.00\times$ | $3.2\text{s}$ | 26 | $8\% / 1.50\times$ | $0\%$ | **100.0%** (Baseline Anchor) |
| `stalker` | Glass Cannon | 85 ($0.77\times$) | $1.15\times$ | $2.4\text{s}$ | 34 | $25\% / 2.00\times$ | $0\%$ | **101.4%** (High Evasion/Burst) |
| `hydra` | Armored Tank | 170 ($1.55\times$) | $0.90\times$ | $4.0\text{s}$ | 42 | $5\% / 1.50\times$ | $25\%$ | **99.8%** (High EHP/Mass) |
| `storm` | Chain / Rhythm | 95 ($0.86\times$) | $1.22\times$ | $2.8\text{s}$ | 28 | $12\% / 1.75\times$ | $5\%$ | **100.6%** (Agility/AoE) |
| `solar` | Area Denial | 120 ($1.09\times$) | $1.05\times$ | $3.0\text{s}$ | 32 | $10\% / 1.60\times$ | $10\%$ | **101.1%** (DoT Control) |

---

## 3. Power Scaling: Multiplicative Calculation Buckets

To prevent either degenerate runaway exponential scaling ($10^{12}$ damage breaking 32-bit floats) or linear stagnation, output calculations are structured into three discrete **Calculation Buckets**:

$$\text{Final Damage} = \left[ (\text{Base} + \Delta \text{Flat}) \times \left(1 + \sum d_{\text{additive}}\right) \right] \times \prod_{k} (1 + m_{\text{mult}, k}) \times \text{CritFactor} \times M_{\text{combo}}$$

```
  [Base + Flat Upgrades]
           │
           ▼
  [x (1 + Additive Bucket)]  ◄── Standard Card Picks (+15% Bite, +12% Speed)
           │
           ▼
  [x (Multiplicative Relics)] ◄── Legendary Relics (Apex Predator x2.0, Echo Strike x1.55)
           │
           ▼
  [x (Super-Crit Factor)]     ◄── Tier 1 Crits (Yellow) & Tier 2 Super-Crits (Crimson)
           │
           ▼
  [x (Combo Multiplier)]      ◄── Overdrive Scaling M_combo = 1.0 + floor(C / 5) * 0.25
```

### 3.1 Super-Crit Overflow Calculus
When upgrade stacks push Critical Strike Chance above $100\%$ ($c > 1.0$):
- The first $100\%$ guarantees a standard **Tier 1 Critical Strike** (Yellow floating numbers).
- The overflow $(c - 1.0)$ rolls for a **Tier 2 Super-Crit** (Crimson floating numbers with screen shake):

$$\text{CritFactor} = \begin{cases}
1.0 + c \cdot (M_{\text{crit}} - 1.0) & \text{for } c \le 1.0 \\
M_{\text{crit}} + (c - 1.0) \times (M_{\text{crit}} - 1.0) \times 1.5 & \text{for } c > 1.0
\end{cases}$$

---

## 4. Asymptotic Soft-Caps & Diminishing Returns

Certain physical attributes break action combat if allowed to scale without bounds. The engine implements strict mathematical bounds:

```
Stat Multiplier
 ▲
 │                          / Linear (Unbounded: Damage, Flat HP)
 │                         /
 │                   .---'' Hyperbolic / Rational Asymptote (Armor DR, CDR, Speed)
 │                .-'
 │             .-'
 └────────────┴────────────────────────► Upgrade Stacks (N)
```

### 4.1 Hyperbolic Cooldown Reduction (CDR)
$$\tau(N) = \frac{\tau_0}{1 + k_{\text{cdr}} \cdot N}$$
*Properties:* Setting $k_{\text{cdr}} = 0.20$:
- 1 Stack $\to 0.833\times$ cooldown.
- 3 Stacks $\to 0.625\times$ cooldown.
- 5 Stacks $\to 0.500\times$ cooldown.
- $\infty$ Stacks $\to 0\text{s}$ asymptotically without ever reaching negative or zero cooldown.

### 4.2 Rational Damage Reduction / Armor
$$DR(A) = DR_{\max} \times \left( \frac{A}{A + K_{\text{armor}}} \right) = 0.85 \times \left( \frac{A}{A + 100} \right)$$
*Properties:* Guarantees that every point of armor provides linear Effective Health Pool ($\text{EHP}$) while preventing true physical invulnerability.

### 4.3 Logistic Movement Speed Soft-Cap
$$v(s) = \begin{cases}
v_0 \cdot (1 + s) & \text{for } s \le 0.50 \\
v_0 \cdot \left( 1.50 + (s - 0.50)^{0.65} \right) & \text{for } s > 0.50
\end{cases}$$
*Properties:* Prevents the serpent from moving faster than the viewport camera can pan or tunneling through collision boundaries.

---

## 5. Sinusoidal Wave Pacing & Dynamic Difficulty Adjustment (DDA)

```
Enemy Spawn Density S(t)
 ▲
 │            Peak Swarm & Elites
 │                 ╭──────────╮
 │   Build-Up     ╱            ╲       Relief & Harvest Window
 │     ╭─────────╯              ╰───────────────╮
 │    ╱                                          ╲
 └───┴────────────────────────────────────────────┴──► Wave Time (T_cycle ~ 45s)
```

### 5.1 The 3-Phase Wave Spawn Equation
$$\text{Spawn Rate } S(t, F) = S_{\text{base}} \times (1 + 0.35 \cdot F) \times \left[ 1.0 + 0.45 \cdot \sin\left(\frac{2\pi (t \bmod T_{\text{cycle}})}{T_{\text{cycle}}}\right) \right]$$

- **Phase 1: Build-Up ($0 - 40\%$ of cycle):** Fodder enemies (Scarab, Swarmling) spawn at moderate density, allowing the player to build combo multipliers ($M_{\text{combo}}$) and position themselves.
- **Phase 2: Climax & Elites ($40 - 75\%$ of cycle):** Peak spawn density $+ 1-2$ Elites. Tests burst active skills and defensive positioning.
- **Phase 3: Respite & Nutrient Harvest ($75 - 100\%$ of cycle):** Spawns cease. The player vacuums remaining food orbs and resets cooldowns.

### 5.2 Time-Weighted Elite Spawn Probability
$$P_{\text{elite}}(t, F) = \min\left(0.45, 0.04 + 0.06 \cdot F + 0.002 \cdot t\right)$$

$$\text{Elite Stat Vector}: \begin{cases}
\text{HP}_{\text{elite}} = \text{Base HP} \times (3.0 + 0.5 \cdot F) \\
\text{Damage}_{\text{elite}} = \text{Base Dmg} \times 1.35 \\
\text{Radius}_{\text{elite}} = \text{Base Radius} \times 1.25 \\
\text{XP Drop}_{\text{elite}} = \text{Base XP} \times 5.0 + \text{Guaranteed Consumable}
\end{cases}$$

### 5.3 Boss Soft-Enrage Escalation Curve
To prevent passive stalling / turtling, boss encounters escalate dynamically after $75\text{ seconds}$:

$$\tau_{\text{attack}}(t) = \max\left(0.8\text{s}, \tau_0 \times e^{-0.012 \cdot \max(0, t - 75)}\right)$$

$$\text{Damage}_{\text{boss}}(t) = \text{Base Dmg} \times \left(1.0 + 0.02 \cdot \max(0, t - 75)^{1.25}\right)$$

---

## 6. Segment Health Balancing & "Clutch Comeback" Kinematics

In a modular serpent roguelite, body segments act simultaneously as **weapons hardpoints**, **armor plating**, and **elongated hitboxes**. Balancing segment health and severing rules is essential to preventing the **Death Spiral Trap**.

```
                   THE COMEBACK ELASTICITY LOOP
┌─────────────────────────────────────────────────────────────┐
│ 1. Segment Depleted (Hp <= 0)                               │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. Severing Shockwave (80 dmg AoE + 1.0s i-frames)          │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. Agility Surge: Turn speed ω surges +45% (Shorter length) │
│    Adrenal Desperation: +30% Move Speed, +25% Bite Power    │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ 4. Regrowth Window: Eating food regrows segments & modules  │
└─────────────────────────────────────────────────────────────┘
```

### 6.1 Length-Dependent Angular Turning Speed ($\omega$)
As the serpent loses segments, its turning radius dramatically tightens, allowing agile slalom evasion through bullet curtains:

$$\omega_{\text{turn}}(N) = \omega_0 \times \left(1.0 + 0.45 \cdot \frac{N_{\max} - N}{N_{\max}}\right)$$

- At $N = 10$ segments: $\omega = 1.00\times$ (Wide, powerful sweeping turns).
- At $N = 1$ segment (near death): $\omega = 1.45\times$ (+45% razor-sharp turning agility).

### 6.2 Adrenal Desperation Buff
When $N_{\text{segments}} \le 2$ (or total HP $< 30\%$):
$$\begin{cases}
v_{\text{speed}} \leftarrow v_{\text{speed}} \times 1.30 \\
D_{\text{bite}} \leftarrow D_{\text{bite}} \times 1.25 \\
\text{Magnet Radius} \leftarrow \text{Magnet Radius} \times 1.50
\end{cases}$$

---

*Volume 3 of the Ouroboros Research Compendium.*
