# Feature TDD Specification: Daily Challenge 12 Special Capacities & 24h Cosmic Transcendence

> **Feature Identifier:** `docs/tdd/daily_challenge_special_capacities.tdd.md`  
> **Status:** Red (Test Suite Defined, Implementing Green Phase)  
> **Target Workspace:** `/home/forart/dev/snake_ts`  
> **Rule Reference:** `AGENTS.md` (Strict TDD Protocol 3.0), `ORACLE.md` (SSOT)  

---

## 1. Executive Summary & Game Design Specification

The **Daily Challenge Special Capacities System** introduces a unique, run-defining power-up mechanic exclusive to the Daily Challenge mode:
1. **24-Hour Unique Attempt Window**: Every calendar day has a unique deterministic seed derived from the UTC date string (`"YYYY-M-D"`).
2. **Level 5 In-Run Unlock Trigger**: When the player reaches **Level 5** during the Daily Challenge, they unlock the day's **Cosmic Special Capacity for 24 hours** (`expiresAt = Date.now() + 24 * 3600 * 1000`). This special capacity is not achievable anywhere else in the game!
3. **12 Distinct Special Capacities**: Exactly 12 unique cosmic capacities spanning offensive, defensive, and tactical playstyles.
4. **3 States per Capacity × 3 Rolling Range Brackets**: Each capacity has 3 operational parameters (State A, State B, State C), each rolled from 3 tier range brackets (Tier 1 Low, Tier 2 Mid, Tier 3 High) deterministically from the day's seed.
5. **Floor Escalation Scaling (+25% Power per Floor)**: For each subsequent floor reached in the Daily Challenge (Floor 1 $\to$ 2 $\to$ 3 $\to$ 4 $\to$ 5+), the capacity scales dynamically:
   $$\text{Multiplier}(F) = 1.0 + (F - 1) \times 0.25 \implies \text{Floor 1: } +0\%, \text{Floor 2: } +25\%, \text{Floor 3: } +50\%, \text{Floor 4: } +75\%, \text{Floor 5: } +100\%$$
6. **Persistence**: The active capacity and its 24h expiration timestamp persist in `MetaProgression` (`ouroboros_meta_v2`) across sessions and browser reloads.

---

## 2. Catalog of the 12 Cosmic Special Capacities

| ID | Name | Icon | State A (Param 1) | State B (Param 2) | State C (Param 3) |
|:---|:---|:---:|:---|:---|:---|
| `supernova_trail` | **Supernova Trail** | 🌠 | Burn DPS ($15\text{–}60$) | Trail Duration ($1.5\text{–}6.0\text{s}$) | Dash Blast Radius ($40\text{–}130\text{px}$) |
| `astral_singularity` | **Astral Singularity** | 🌌 | Pull Force ($80\text{–}240$) | Implosion Damage ($30\text{–}120$) | Pulse Interval ($6.0\text{–}2.5\text{s}$) |
| `chrono_paradox_clone` | **Chrono Paradox Clone** | ⏳ | Clone Damage ($30\text{–}90\%$) | Clone Lifetime ($3.0\text{–}12.0\text{s}$) | Spawn Interval on Dash ($8.0\text{–}3.0\text{s}$) |
| `prismatic_laser_orbit` | **Prismatic Laser Orbit** | 💎 | Laser DPS ($20\text{–}85$) | Orbit Radius ($60\text{–}180\text{px}$) | Prism Count ($2\text{–}4$) |
| `bio_venom_miasma_nova` | **Bio-Venom Miasma Nova** | 🧪 | Nova Radius ($70\text{–}220\text{px}$) | Poison Ticks ($20\text{–}80$) | Trigger Chance per Food ($25\text{–}100\%$) |
| `quantum_void_dash` | **Quantum Void Dash** | ⚡ | Void Damage ($40\text{–}160$) | Invulnerability Extension ($+0.3\text{–}1.5\text{s}$) | Cooldown Refund on Kill ($15\text{–}75\%$) |
| `nanite_overlord_swarm` | **Nanite Overlord Swarm** | 🦾 | Drone Count ($3\text{–}15$) | Drone Impact Dmg ($12\text{–}50$) | Heal per Hit ($1\text{–}7\text{ HP}$) |
| `magnetic_abyss_vortex` | **Magnetic Abyss Vortex** | 🧲 | Magnet Range ($+80\text{–}350\%$) | Bonus Shard Yield ($+20\text{–}100\%$) | Kinetic Impact Dmg ($15\text{–}65$) |
| `solar_flare_eruption` | **Solar Flare Eruption** | ☀️ | Solar Burst Dmg ($50\text{–}200$) | Blind/Stun Duration ($1.0\text{–}4.0\text{s}$) | Shield Recharge Kickback ($15\text{–}60\%$) |
| `frostfire_aurora` | **Frostfire Aurora** | ❄️ | Slow Percentage ($25\text{–}70\%$) | Elemental Vulnerability ($+20\text{–}85\%$) | Aura Radius ($80\text{–}240\text{px}$) |
| `kinetic_shockwave_pulser` | **Kinetic Shockwave Pulser** | 💥 | Shockwave Damage ($25\text{–}100$) | Knockback Force ($120\text{–}380$) | Turn Angle Threshold ($45^\circ\text{–}10^\circ$) |
| `leviathan_crystalline_carapace` | **Leviathan Crystal Carapace** | 🛡️ | Damage Reduction ($15\text{–}55\%$) | Projectile Deflection ($1.5\text{–}4.5\times$) | Max Crystal Stacks ($5\text{–}12$) |

---

## 3. Test Suite Specification (`src/tests/DailyChallengeSpecialCapacities.test.ts`)

- 12 Capacities Catalog integrity & deterministic seed generation ($3\text{ states} \times 3\text{ ranges}$).
- Level 5 in-run unlock trigger during Daily Challenge (and mode isolation).
- Floor escalation scaling ($+25\%$ power per floor).
- 24h expiration timestamp handling and persistence in `MetaProgression`.
- Combat simulation execution hooks.
