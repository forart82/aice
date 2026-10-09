# 🔮 THE ORACLE: Single Source of Truth (SSOT) — Ouroboros Galaxy (TypeScript Edition)

> **File Role:** Absolute Single Source of Truth (SSOT) for Game Design, Mechanics, Formulas, Architecture & Balance.  
> **Status:** Active & Authoritative  
> **Target Directory:** `/home/forart/dev/snake_ts`  
> **Technology:** Modern TypeScript (ES2022+ / Strict), Vite 6, Vitest 3, Pure WebGL 2.0 Engine (`WebGL2RenderingContext` / `GLBatch`), Web Audio API, Responsive Layout Engine & BroadcastChannel Multi-Screen  
> **Rule Level:** Mandatory & Co-Equal with [`AGENTS.md`](file:///home/forart/dev/snake_ts/AGENTS.md) TDD Protocol  

---

## 📜 1. The Oracle Covenant

1. **Absolute Authority**: If a mechanic is defined in this document, the game **must** implement and execute that mechanic. If a formula, constant, or algorithm is specified here, the game **must** use that exact mathematical formulation.
2. **Synchronized Implementation**: No gameplay logic, formula, or mechanic exists in production without first being documented here and verified via a dedicated TDD specification ([`docs/tdd/<feature>.tdd.md`](file:///home/forart/dev/snake_ts/docs/tdd/TEMPLATE.tdd.md)).
3. **Living Chronology**: This document preserves the entire history, rationale, mathematical models, balance parameters, and design decisions of the project.
4. **Publishing & Architecture Invariants**:
   - **Asset Provenance & Rights:** All assets cataloged in [`docs/ASSETS.md`](file:///home/forart/dev/snake_ts/docs/ASSETS.md) (100% procedural MIT/CC0/SIL OFL commercial-safe).
   - **Device & Viewport Standards:** Universal responsive layout adapting to 16:9, 21:9 ultrawide, 32:9, 4:3, 9:16 mobile portrait, and dual-window setups per [`docs/DEVICE_SPECS.md`](file:///home/forart/dev/snake_ts/docs/DEVICE_SPECS.md).
   - **Multi-Screen & Multi-Device:** Synchronized dual-window / companion device architecture per [`docs/MULTI_SCREEN_AND_DEVICE.md`](file:///home/forart/dev/snake_ts/docs/MULTI_SCREEN_AND_DEVICE.md).
   - **Input Normalization:** Abstracted virtual controller layer supporting Keyboard, Gamepad API, and dynamic Virtual Touch Joystick.
   - **Save Integrity & Migrations:** Versioned JSON save schema with CRC32 integrity checks per [`docs/SAVE_SCHEMA.md`](file:///home/forart/dev/snake_ts/docs/SAVE_SCHEMA.md).
   - **Performance Budget:** Steady 60/120+ FPS rendering with 120 Hz fixed-step physics accumulator (`FIXED_STEP = 1/120 s = 0.008333s`) and object pooling.
   - **Quality Verification:** 100% clean check on [`./verify`](file:///home/forart/dev/snake_ts/verify).
   - **Engine Independence:** Simulation layers in `src/core`, `src/sim`, `src/data` contain zero DOM / browser dependencies and run 100% headlessly in Vitest and Node.js.

---

## 🧭 2. Game Overview & Core Concept

### 2.1 Game Title & Concept
- **Title:** Ouroboros Ascension
- **Genre:** Roguelike RPG Combo Snake / Action Arena Crawler
- **High Concept:** A fast-paced serpent survival roguelike combining classic snake navigation with deep ARPG character classes, evolutionary perk draft cards, cranial mutation assembly and boss helmet loadouts in the Snake Lab, an escalating combo overdrive multiplier, dangerous arena hazards, and multi-phase floor bosses.

### 2.2 Art Direction & Visual Style
- **Visual Theme:** Cybernetic bioluminescence, dark neon arena borders, glowing particle burst FX, fluid smooth-coiling serpent bodies, and responsive floating combat text.
- **Rendering Technology:** 100% Pure WebGL 2.0 Engine (`WebGLGameRenderer` / `GLBatch`) with custom GLSL shaders, batched draw calls, procedural SDF curves, GPU texture atlas, and zero-allocation per-frame pipelines. HTML5 Canvas 2D (`CanvasRenderingContext2D`, `Ctx2D`) is permanently banished with zero tolerance.

### 2.3 Target Platforms & Performance Budget
- **Target Platforms:** PC (Linux, Windows, macOS via Web/Tauri), Mobile (Android, iOS via Capacitor/PWA), and Web (Offline PWA).
- **Target Frame Rate:** Rock-solid 60 FPS / 120 FPS high-refresh rate displays.
- **Simulation Clock:** Fixed 120 Hz time slices (`FIXED_STEP = 1/120 s = 0.008333s`).
- **Base Logical Resolution:** 1280 x 720 (16:9 dynamic responsive scaling across all ratios).

---

## ⚙️ 3. Authoritative Gameplay Mechanics

### 3.1 Snake Kinematics & Body Coiling
- The snake's head moves forward continuously along heading angle $\theta$.
- Body segments follow the path traversed by the head at fixed distance intervals ($d_{\text{segment}} = 15 \text{ px}$).
- Segments interpolate along historical position trail points recorded each fixed simulation tick.
- Self-collision is non-lethal by default in standard mode; head-to-enemy and head-to-hazard collisions inflict damage and trigger invulnerability frames (i-frames).

### 3.2 Combo Overdrive System
- Eating food or killing enemies increments the Combo counter ($C$).
- A combo decay timer starts after each gain ($\tau_{\text{decay}} = 4.0 \text{ s}$ base, scaling dynamically to $1.9 \text{ s}$ at high tiers). If no food or kill occurs within $\tau_{\text{decay}}$, combo counter resets to zero.
- Combo multiplier follows discrete stepped tiers (`GameData.ComboTiers`):
  - $C \ge 3 \implies 2\times$
  - $C \ge 8 \implies 3\times$
  - $C \ge 14 \implies 4\times$
  - $C \ge 22 \implies 5\times$
  - $C \ge 30 \implies 6\times$
  - $C \ge 40 \implies 8\times$
- Reaching Overdrive Frenzy ($C \ge 10$, or $C \ge 8$ with Overdrive Capacitor relic) triggers visual neon screen glow, increased movement speed (+20%), double damage multiplier, and doubled XP drops for $8.0 \text{ s}$.
- **Clutch Catch Combo Timer:** Eating a nutrient item when the active combo timer has $\le 0.6\text{ s}$ remaining triggers a Clutch Catch with a **+50% score bonus** ($\text{Score} = \lfloor \text{Score}_{\text{base}} \times M_{\text{combo}} \times 1.5 \rfloor$) and neon visual stinger (`⚡ CLUTCH CATCH! +50%`).

### 3.3 Food Economy & Drop Mechanics
- **Apple (🍏):** +1 Ouro, +100 Score, Radius 9px. (60.0% ambient spawn weight).
- **Golden Apple (🌟):** +4 Ouro, +300 Score, Radius 11px. (15.0% ambient spawn weight).
- **Health Potion (❤️):** +2 Ouro, +100 Score, Radius 10px, Heals 36 HP. (10.0% ambient spawn weight).
- **Shield Orb (💠):** +2 Ouro, +150 Score, Radius 10px, Grants +45 Shield buffer. (6.0% ambient spawn weight).
- **Bomb Fruit (💣):** +3 Ouro, +200 Score, Radius 10px, Detonates 110px AoE dealing 90 kinetic damage. (4.0% ambient spawn weight).
- **Chrono Shard (⏱️):** +3 Ouro, +150 Score, Radius 10px, Slows enemy time by 45% for 4.0s. (2.5% ambient spawn weight).
- **Essence Shard (💎):** +4 Ouro, +250 Score, Radius 9px, Grants base +5 persistent Sanctuary Essence. (2.5% ambient spawn weight).
- **Soul Remnant (👻):** +5 Ouro, +120 Score, Radius 8px, Heals 4 HP on ingestion. (Dropped on Soul Harvest kill proc).
- **Astral Prism (🔮):** +15 Ouro, +500 Score, Radius 13px, +300% Ouro bonus & instant Overdrive. (Formed via geometric Constriction loop fusion).

#### 3.3.0 Dynamic Low-Health Drop Pity & 21.5-Minute Pacing
- **Dynamic Low-Health Drop Pity ($\text{HP} < 35\%$):** When serpent HP drops below 35%, Health Potion spawn weight escalates to 22% and Shield Orb spawn weight escalates to 12% (remaining 66% proportionally redistributed). If $C_{\text{dry}} \ge 7$ consecutive non-recovery spawns occur during low HP, a recovery drop (Potion or Shield) is 100% guaranteed.
- **21.5-Minute Run Pacing:** Floor food requirements follow $\text{FoodTarget}(F) = \min(42, 16 + \lfloor 2.2 \times (F - 1) \rfloor)$ (0 for BossRush), totaling 669 items across 20 floors.

### 3.3.1 In-Run Ouro Economy & Cranial Lab Progression Calibration (Floors 1–20)

- **Authoritative Currency Standard:** In-run Ouro ($O$) is the spendable currency utilized exclusively during an active expedition to purchase and upgrade hardpoints in the Cranial Mutation Lab.
- **Three Balanced Currency Pillars (Per-Floor Target: 60–90 Ouro):**
  1. **Ambient Food Ingestion ($20–30\text{ Ouro/floor}$):** Weighted average ambient drop yields $E[\text{Ouro}] = 1.815\text{ Ouro/item}$. Players consume $\sim 12–16$ active items per floor during combat maneuvering.
  2. **Hostile Mob Defeats ($15–25\text{ Ouro/floor}$):** Slaying progressive wave spawns (Swarmling $+1$, Scarab $+2$, Spitter $+3$, Phantom $+3$, Drone $+4$, Brute $+6$) generates consistent currency.
  3. **Boss Guardian Defeat Reward ($+35\text{ Ouro/floor}$):** Defeating the floor's Apex Boss guardian directly grants a flat $+35\text{ Ouro}$ bounty along with 6 high-value nutrient drops ($3\times$ Shards $+ 3\times$ Golden Apples).
  - **Combined Floor Income:** Across all floors, combined generation reliably averages $\sim 75\text{ Ouro/floor}$ ($\text{range: } 60–90\text{ Ouro}$).

- **Cranial Lab Escalating Cost Curves:**
  - **Head Weapon Modules & Defensive Bio-Organs:**
    $$\text{Cost}_{\text{mod}}(\text{lvl}, p) = 30 \times \text{lvl} + p \times 15\text{ Ouro}$$
    *Base 30 Ouro (+15 per cumulative head purchase $p$).*
  - **Cranial Augments:**
    $$\text{Cost}_{\text{aug}}(\text{lvl}, p) = 40 \times \text{lvl} + p \times 20\text{ Ouro}$$
    *Base 40 Ouro (+20 per cumulative head purchase $p$).*

- **4-Stage Player Pacing & Wallet Accumulation Curve:**
  - **Stage 1: Floors 1–3 (Starter Phase — Cumulative Income: 180–240 Ouro):**
    - *Economic Capacity:* Player can purchase 1–2 starter modules (e.g. Attack Spitter Lv1 at 30 Ouro, Carapace Shield Lv1 at 45 Ouro) and 1 starter augment (e.g. Venom Fangs Lv1 at 80 Ouro), establishing their core weapon/defense hardpoints.
  - **Stage 2: Floors 4–8 (Tier 2 Unlock & Progression Phase — Cumulative Income: 500–640 Ouro):**
    - *Economic Capacity:* As in-run challenges unlock Tier 2 weapons and defenses, player accumulates $\sim 375\text{ Ouro}$ additional revenue, funding Tier 2 module upgrades ($105–120\text{ Ouro}$) and installing newly unlocked tactical slots (Magma, Needler, Scattershot, Chrono).
  - **Stage 3: Floors 9–15 (Specialized Synergy & Alchemical Fusion Phase — Cumulative Income: 1,000–1,250 Ouro):**
    - *Economic Capacity:* Player accumulates $\sim 525\text{ Ouro}$ additional revenue, funding specialized elemental weaponry (Cryo Mortar, Plasma Arc Cannon, Tachyon Laser at $120–135\text{ Ouro}$) and high-tier augments (Maw Lv2 at 220 Ouro) to activate 28-Synergy Alchemical Fusions (Superconductor Surge, Glacial Rot, Obsidian Armor).
  - **Stage 4: Floors 16–20+ (Endgame Mastery Gauntlet — Cumulative Income: 1,500–1,800+ Ouro):**
    - *Economic Capacity:* Total lifetime in-run Ouro reaches $1,500–1,800+\text{ Ouro}$, funding Tier 3 mastery capstones ($210–255\text{ Ouro}$) and Tier 3 legendary augments ($280–320\text{ Ouro}$) to defeat Floor 20 (*The Eternal Ouroboros*) and multi-boss hordes.

#### Authoritative 20-Floor Economy & Pacing Calibration SSOT Table

| Floor | Apex Boss Guardian | Food Income (avg) | Mob Kills Income | Boss Bounty | Total Floor Income | Cumulative In-Run Ouro | Strategic Cranial Lab Purchases & Milestones |
| :---: | :--- | :---: | :---: | :---: | :---: | :---: | :--- |
| **1** | Centipede Behemoth | 20 Ouro | 12 Ouro | +35 Ouro | **67 Ouro** | **67 Ouro** | Purchase #1: Attack Spitter Lv1 (30 Ouro). Wallet reserve: 37 Ouro. |
| **2** | Storm Gorgon | 21 Ouro | 14 Ouro | +35 Ouro | **70 Ouro** | **137 Ouro** | Purchase #2: Carapace Shield Lv1 (45 Ouro). Wallet reserve: 62 Ouro. |
| **3** | Infernal Colossus | 22 Ouro | 15 Ouro | +35 Ouro | **72 Ouro** | **209 Ouro** | Purchase #3: Venom Fangs Augment Lv1 (80 Ouro). Wallet reserve: 54 Ouro. |
| **4** | Glacial Behemoth | 23 Ouro | 16 Ouro | +35 Ouro | **74 Ouro** | **283 Ouro** | Challenge unlock: Tier 2 Weapons. Wallet accumulation for upgrades. |
| **5** | Chrono Wyrm | 24 Ouro | 17 Ouro | +35 Ouro | **76 Ouro** | **359 Ouro** | Purchase #4: Turret Lv2 Upgrade (105 Ouro). Wallet reserve: 99 Ouro. |
| **6** | Bio-Venom Hivemind | 24 Ouro | 18 Ouro | +35 Ouro | **77 Ouro** | **436 Ouro** | Purchase #5: Shield Lv2 Upgrade (120 Ouro). Wallet reserve: 56 Ouro. |
| **7** | Apex Superconductor | 25 Ouro | 19 Ouro | +35 Ouro | **79 Ouro** | **515 Ouro** | Purchase #6: Magma Vent Lv1 (105 Ouro). Wallet reserve: 30 Ouro. |
| **8** | Astral Leviathan | 25 Ouro | 20 Ouro | +35 Ouro | **80 Ouro** | **595 Ouro** | Tier 2 arsenal fully equipped; ready for mid-game gauntlet. |
| **9** | Quantum Hydra | 26 Ouro | 20 Ouro | +35 Ouro | **81 Ouro** | **676 Ouro** | Purchase #7: Cryo Mortar Lv1 (120 Ouro) -> Fusion: Superconductor Surge! |
| **10** | Shadow Doppelgänger | 26 Ouro | 21 Ouro | +35 Ouro | **82 Ouro** | **758 Ouro** | Purchase #8: Plasma Cannon Lv1 (135 Ouro). Wallet reserve: 88 Ouro. |
| **11** | Void Devourer | 27 Ouro | 21 Ouro | +35 Ouro | **83 Ouro** | **841 Ouro** | Wallet accumulation; challenge completions for Tier 2 Augments. |
| **12** | Magnetic Dreadnought | 27 Ouro | 22 Ouro | +35 Ouro | **84 Ouro** | **925 Ouro** | Purchase #9: Cryo Mortar Lv2 Upgrade (180 Ouro). Wallet reserve: 89 Ouro. |
| **13** | Aegis Juggernaut | 28 Ouro | 22 Ouro | +35 Ouro | **85 Ouro** | **1,010 Ouro** | Synergy mastery: Dual elemental hardpoints active. |
| **14** | Dyson Archon | 28 Ouro | 23 Ouro | +35 Ouro | **86 Ouro** | **1,096 Ouro** | Purchase #10: Maw Cranial Augment Lv2 (220 Ouro). Wallet reserve: 131 Ouro. |
| **15** | Prismatic Arachnid | 29 Ouro | 23 Ouro | +35 Ouro | **87 Ouro** | **1,183 Ouro** | Challenge unlock: Tier 3 Masteries unlocked across all hardpoints. |
| **16** | Tempest Siren | 29 Ouro | 24 Ouro | +35 Ouro | **88 Ouro** | **1,271 Ouro** | Purchase #11: Turret Lv3 Mastery (225 Ouro). Wallet reserve: 161 Ouro. |
| **17** | Nanite Hive Titan | 29 Ouro | 24 Ouro | +35 Ouro | **88 Ouro** | **1,359 Ouro** | Purchase #12: Shield Lv3 Mastery (240 Ouro). Wallet reserve: 9 Ouro. |
| **18** | Plasma Phase Specter | 29 Ouro | 25 Ouro | +35 Ouro | **89 Ouro** | **1,448 Ouro** | Final gauntlet preparation; banking Ouro for legendary augments. |
| **19** | Volcanic Chimera | 29 Ouro | 25 Ouro | +35 Ouro | **89 Ouro** | **1,537 Ouro** | Purchase #13: Venom Fangs Lv3 / Maw Lv3 Augment (280 Ouro). |
| **20** | **The Eternal Ouroboros** | 29 Ouro | 26 Ouro | +35 Ouro | **90 Ouro** | **1,627 Ouro** | **Apex Gauntlet:** Fully optimized Tier 3 loadout defeats Final Boss! |


### 3.4 Combat & Collision Resolution
- **Hit-Boxes:** Circle-circle overlap detection between snake head/segments, enemies, projectiles, and hazards.
- **Damage Pipeline:**
  $$\text{Final Damage} = (\text{Base Damage} + \text{Power Upgrades}) \times M_{\text{combo}} \times M_{\text{crit}}$$
- **Damage Routing Multipliers:**
  - Head hit: 100% incoming damage (`amount * 1.0`).
  - Body segment mob hit: 70% incoming damage (`amount * 0.7`).
  - Body segment boss hit: 55% incoming damage (`amount * 0.55`).
  - Projectile direct hit: 100% incoming damage (`amount * 1.0`).
- **Invulnerability Period:** Upon taking damage, the player gains $0.6 \text{ s}$ of i-frames with flashing sprite opacity.
- **Bite Interval:** Minimum interval between consecutive bites on the same target is strictly $0.28 \text{ s}$ (`BiteInterval = 0.28`).

### 3.5 Modular Segment & Head Health Kinematics
- **Modular Health Structure:** The serpent's health pool is an accumulation of its anatomical head and individual body segments.
  - **Head Health Capacity:** The head possesses its own dedicated health pool (`HeadHp`, `HeadMaxHp`), initialized with double the health capacity of a standard body segment ($\text{HeadMaxHp} = 2 \times \text{BaseSegmentHp}$).
  - **Individual Segment Health:** Each individual body segment possesses its own `Hp` and `MaxHp` attributes ($\text{BaseSegmentHp} = 25 \text{ HP}$, modified by class vitality and Sanctuary upgrades).
  - **Cumulative Total Health:** The serpent's total current health is the exact sum of the head health and all active body segments:
    $$HP_{\text{total}} = \text{HeadHp} + \sum_{i=0}^{N-1} \text{segment}[i].Hp$$
    $$HP_{\max} = \text{HeadMaxHp} + \sum_{i=0}^{N-1} \text{segment}[i].MaxHp$$
- **Top-to-Bottom Sequential Healing:** When receiving healing ($\text{Heal}(\text{amount})$), missing health is restored strictly sequentially from anterior (head) to posterior (tail):
  1. Head ($\text{HeadHp} \to \text{HeadMaxHp}$)
  2. Foremost body segment ($\text{segment}[0].Hp \to \text{segment}[0].MaxHp$)
  3. Subsequent segments ($\text{segment}[1], \dots, \text{segment}[N-1]$ in ascending order) until the heal pool is exhausted.
- **Full-Body Self-Collision Self-Damage:** When the serpent crosses over its own body:
  - **Head on Trailing Segment ($k \ge 3$):** Contact inflicts self-damage directly onto both the touched segment and the head.
  - **Body-on-Body Crossing ($|i - j| \ge 3$):** Contact between non-adjacent body segments $i$ and $j$ inflicts self-damage onto **BOTH** intersecting body segments.
  - **No Global Lockout:** Multi-segment loops process damage on every touched segment independently using per-segment hit cooldowns (`selfHitCooldown`), rather than halting on the first hit or blocking via global invulnerability.
  - **Feedback & Combo Break:** Triggers localized `SELF-BITE!` floating text, spark particles, hit sound, hurt event, and breaks active combo multiplier streaks.
- **Collision Damage Routing:**
  - Enemy head-to-head contact / bite $\to$ `player.damageHead(cdam)`
  - Enemy touching body segment $s$ $\to$ `player.damageSegment(s, cdam * 0.7)`
  - Enemy projectile hitting head $\to$ `player.damageHead(p.damage)`
  - Enemy projectile hitting body segment $s$ $\to$ `player.damageSegment(s, p.damage)`
  - Boss head-to-head contact $\to$ `player.damageHead(bcdam)`
  - Boss touching body segments $\to$ Damages **each player body part touched** independently (`player.damageSegment(s, bcdam * 0.7)` for boss head, `bcdam * 0.55` for boss body parts) with per-segment `bossHitCooldown = 0.5s`, mirroring player self-collision mechanics.
- **Boss Serpentine Health & Life-Sourcing Invariant:** Serpentine bosses mirror player vitality architecture: the boss head possesses its own dedicated health pool (`HeadHp`, `HeadMaxHp`), while trailing body segments possess individual hit points (`Hp`, `MaxHp`, `HitFlash`). When taking damage (`ApplyDamage` / `DamageHead`), life is sourced from the posterior-most segment (`Segments[Segments.length - 1]`) forward until all segments are consumed. If a segment is hit directly (`DamageSegment`), that segment and all trailing segments are severed. The boss **ONLY** dies if there are **no more body parts (`Segments.length === 0`)** **AND** the head has **0 or less life (`HeadHp <= 0`)** (`Dead = true`).
- **Individual Segment Damage & Severing Rule:** When a segment takes damage and its `Hp` drops to $\le 0$, that specific segment is destroyed, AND all attached trailing segments ($i \dots N-1$) are immediately severed and lost!
- **Body as Active Source of Life & Serpentine Defeat Condition:** The head possesses its own dedicated health pool (`HeadHp`, `HeadMaxHp`), while the entire body acts as an active, vital reservoir of life. When the head takes damage (from enemy bites, boss collisions, projectiles, or hazards), life is dynamically sourced starting from the posterior-most segment (the tail: `segment[N-1]`). That last body part absorbs the damage; if its HP drops to $\le 0$, it is consumed/severed and life sourcing cascades forward through preceding segments until all damage is absorbed or no body parts remain. If no body parts remain, remaining damage reduces `HeadHp`. The serpent **ONLY** dies if there are **no more body parts (`Segments.length === 0`)** **AND** the head has **0 or less life (`HeadHp <= 0`)**, unless protected by active Phoenix Rebirth charges.
- **Growth on Nourishment:** Eating food automatically triggers serpent growth ($N \leftarrow \min(N + 1, N_{\max})$). Each new segment is initialized with full health ($\text{Hp} = \text{MaxHp} = \text{BaseSegmentHp}$).
- **Strategic Head Defense Priority:** Because the Serpent Head serves as the tactical arsenal command center housing all offensive weapons, defensive bio-organs, cranial augments, and boss helmets, players are incentivized to protect the Head at all costs while utilizing trailing segments for kinetic tail-whip collisions and closed-loop constriction.

### 3.6 XP State Counter Telemetry
- The legacy XP progress bar is replaced by a high-contrast digital **XP State Counter** in the HUD vitals cluster, presenting the player's total accumulated and current XP reserve (`XP: <value>`) alongside the class level badge.

### 3.7 Tactical Autotomy (Voluntary Emergency Tail Jettison)
- **Mechanic:** When the serpent is in peril or trapped by surrounding hostiles, the player can trigger voluntary autotomy (`Autotomy()` / `autotomy()`).
- **Sacrifice & Clearance:** Jettisons all segments from index $k = \max(1, \lfloor N/2 \rfloor)$ to $N-1$. The jettisoned wagons immediately detonate in an **Ablative Shockwave** dealing $80 \text{ damage}$ in a $140\text{px}$ radius.
- **Agility Surge & i-Frames:** Grants $+1.2\text{s}$ invulnerability frames and an immediate $+45\%$ turning agility surge ($\omega_{\text{turn}}$) for $4.0\text{s}$.

### 3.8 Centripetal Tail-Whip Collisions ($v = \omega \cdot r$)
- **Kinematic Formulation:** During sharp angular turns, trailing body segments experience centripetal acceleration, scaling tangential velocity:
  $$v_i = \|\vec{v}_{\text{head}}\| + \omega \cdot (i \cdot d_{\text{segment}})$$
- **Blunt Kinetic Multiplier:** When a high-velocity trailing segment ($i \ge 2$) collides with an enemy, it inflicts **Kinetic Tail-Whip Damage**:
  $$\text{Damage}_{\text{whip}} = D_{\text{base}} \times \left(1.0 + 0.85 \cdot \left(\frac{v_i}{v_{\text{head}}}\right)^2\right)$$
  Knocks enemies back by $180\text{px}$ and deflects incoming light projectiles.

### 3.9 Closed-Loop Ouroboros Constriction (Point-in-Polygon Topology)
- **Topological Closure:** When the serpent's head approaches within $R_{\text{snap}} = 28\text{px}$ of any trailing segment $k \ge 3$, a **Topological Closed Loop** $\mathcal{P} = [S_0, S_1, \dots, S_k]$ is formed.
- **Winding Number Stasis:** Enclosed enemies ($W(P) \ne 0$) enter temporal stasis ($-80\%$ move speed) and suffer continuous perimeter crushing damage:
  $$\text{DPS}_{\text{crush}} = 45 \times \text{Lvl} \times \left(\frac{\text{Area}_0}{A(t) + 100}\right)^{0.65}$$
- **Singularity Fusion (Astral Prism):** All food/XP items captured within the loop are compressed into a single glowing **Astral Prism** (+300% XP value, instant Overdrive frenzy charge).

### 3.10 The 28-Synergy Alchemical Cross-Module Fusion Engine
When complementary cranial offensive weapons and defensive bio-organs are concurrently installed on the Serpent Head, they synthesize into potent Alchemical Fusions:

| # | Fusion ID | Fusion Name | Module A | Module B | Tactical Synergy Effect |
| :-: | :--- | :--- | :---: | :---: | :--- |
| 1 | `superconductor` | **Superconductor Surge** | `tesla` | `cryo` | Shocking chilled enemies shatters ice into piercing shards with +50% arc jump damage. |
| 2 | `obsidian` | **Obsidian Armor** | `magma` | `spikes` | Enemy collision triggers volcanic eruption (45 AoE dmg) and hardens segment with +15% armor. |
| 3 | `miasma` | **Miasma Combustion** | `venom` | `magma` | Poisoned enemies touching magma erupt into cascading chemical fireballs (60 dmg AoE). |
| 4 | `prismatic` | **Prismatic Aegis** | `tachyon` | `shield` | Carapace Shield break triggers an 8-way radial Tachyon laser burst (25 dmg each). |
| 5 | `temporal_singularity` | **Temporal Singularity** | `chrono` | `nanite` | Nanite repair runs at 3x speed in Chrono bubbles; micro-drones convert enemy bullets into healing. |
| 6 | `railgun_flak` | **Railgun Flak Battery** | `turret` | `tesla` | Turret darts become electrified piercing slugs that leave conductive lightning tethers. |
| 7 | `glacial_rot` | **Glacial Rot** | `cryo` | `venom` | Frozen enemies suffer +100% poison DoT ticks; death leaves an icy toxic sludge puddle. |
| 8 | `thermobaric_mortar` | **Thermobaric Mortar** | `magma` | `turret` | Turret launches explosive incendiary shells (40 dmg, 80px AoE) that ignite the arena. |
| 9 | `event_horizon` | **Event Horizon Web** | `chrono` | `tesla` | Bio-Arc lightning traps enemies in localized stasis fields for 1.8s, slowing them by 75%. |
| 10 | `biosteel_quill` | **Biosteel Quill Burst** | `spikes` | `turret` | Body collision fires a 12-way kinetic quill barrage (22 dmg) with +30% knockback. |
| 11 | `tachyon_overcharge` | **Tachyon Overcharge** | `tachyon` | `tesla` | Tachyon Laser beam splits into 3 branching lightning lasers upon striking first target. |
| 12 | `sublimation_shock` | **Sublimation Shock** | `cryo` | `magma` | Applying Magma to Frozen foes triggers thermal shock (85 true damage, bypassing armor). |
| 13 | `corrosive_needle` | **Corrosive Needle Carapace** | `venom` | `spikes` | Contact thorns inject neurotoxin stacks, reducing enemy armor by 10% per hit. |
| 14 | `photon_mirror` | **Photon Mirror Barricade** | `tachyon` | `spikes` | Physical collision creates a hard-light barrier that reflects hostile projectiles at 200% dmg. |
| 15 | `nanite_plague` | **Nanite Plague Vector** | `nanite` | `venom` | Nanite drones infect enemies; host death spawns 2 autonomous micro-nanites for 8s. |
| 16 | `kinetic_bastion` | **Kinetic Bastion Discharge** | `shield` | `spikes` | Absorbing damage charges a capacitor; on full shield regen, releases a 70 dmg shockwave. |
| 17 | `entropic_miasma` | **Entropic Miasma** | `chrono` | `venom` | Time dilation doubles the tick rate of all active poison debuffs. |
| 18 | `cryo_barrier` | **Cryo-Barrier Reflection** | `cryo` | `shield` | Shield projects a frost ward chilling nearby projectiles by 50% and freezing on hit. |
| 19 | `volcanic_bulwark` | **Volcanic Bulwark** | `magma` | `shield` | While shield is active, radiates a permanent 12 DPS heat aura; shield break sprays magma. |
| 20 | `auto_fabricator` | **Auto-Fabricator Turrets** | `nanite` | `turret` | Nanite drones build stationary micro-turrets on arena floor (lasting 12s, 8 dmg). |
| 21 | `tachyon_stutter` | **Tachyon Stutter Beam** | `tachyon` | `chrono` | Tachyon Laser freezes enemies inside beam line for 1.0s while ticking 28 dmg every 0.2s. |
| 22 | `absolute_zero` | **Absolute Zero Stasis** | `cryo` | `chrono` | Freezes non-boss enemies in solid ice blocks for 3.5s (+50% damage taken). |
| 23 | `electrified_hull` | **Electrified Hull** | `tesla` | `shield` | When shield takes damage, discharges a 24 dmg chain lightning bolt to 4 nearby hostiles. |
| 24 | `pyro_nanite` | **Pyro-Nanite Swarm** | `magma` | `nanite` | Nanite drones ignite into flaming suicide firebugs divebombing elites for 55 fire AoE dmg. |
| 25 | `thermal_ray` | **Thermal Ray Needle** | `tachyon` | `magma` | Tachyon Laser leaves molten magma lines along its path that burn for 22 DPS for 4 seconds. |
| 26 | `tesla_nanite` | **Tesla Nanite Cloud** | `nanite` | `tesla` | Nanite repair drones emit an electrical field shocking enemies within 80px for 14 dmg. |
| 27 | `cryo_tachyon` | **Cryo-Tachyon Lance** | `cryo` | `tachyon` | Tachyon beam transforms into a sub-zero lance (38 dmg) that leaves a chilling frost path. |
| 28 | `chrono_accelerator` | **Chrono Dart Accelerator** | `chrono` | `turret` | Turret darts fired through Chrono Ward accelerate to 300% velocity and deal +40% damage. |

### 3.11 Cranial Tactical Lab & Challenge-Gated Tier Progression
- **Head-Centric Evolution:** To eliminate cognitive micromanagement at scale (10–50+ segments), the Mutation Lab focuses exclusively on the **Serpent Head**. Body segment socketing in the lab is removed.
- **Strict Roguelite In-Run Reset Rule:** All Cranial Lab upgrades, tier unlock achievements (`CompletedChallenges`), and installed head modules/augments reset completely on every new expedition/run. Every run starts with a clean slate: 0 installed head modules/augments, 0 in-run Ouro balance, and `UnlockedTiers` set strictly to starter defaults (`{ turret: 1, shield: 1 }`). Lifetime records (total kills, highest floor, total bosses, etc.) are purely archival telemetry and **never bypass or auto-unlock** in-run challenge requirements.
- **Starter Defaults (Run-Start Unlocks):** On every new run, ONLY Tier 1 of starter offensive weapon (`turret`) and starter defense (`shield`) are unlocked by default without challenge requirements. All other modules and augments (`tesla`, `venom`, `spikes`, `fangs`, etc.) require completing their respective in-run challenge feats.
- **Challenge-Gated Upgrades & Tiers (Single-Challenge Rule):** All other upgrades and higher tiers (Tier 2, Tier 3) are locked by default and unlocked by completing **exactly one single challenge condition** per tier. Multiple/alternative conditions (e.g., "or Defeat Floor X", "or Defeat Boss") are strictly prohibited. Every condition evaluates exclusively against current in-run state (`ChallengeContext` or `RunSummary`).
- **Geometric Arena-to-Length Calibration ($d_{\text{segment}} = 15\text{ px}$, Arena $540 \times 960\text{ px} / 960 \times 960\text{ px}$):**
- **Dynamic Gameboard-to-Length Scaling & Strict 10ner-Step Rounding:**
  - **Dynamic Scaling Ratio Formula:**
    $$R = \text{clamp}\left(\frac{\text{ArenaW} \times \text{ArenaH}}{1600 \times 960}, 0.12, 1.0\right)$$
  - **Strict 10ner-Step Rounding Function:**
    $$\text{RoundToTen}(v) = \max(10, \lfloor v / 10 \rceil \times 10)$$
    $$\text{Length}_{\text{req}}(\text{BaseDesktopLength}) = \text{RoundToTen}(\text{BaseDesktopLength} \times R)$$
    *(Strictly yields clean integer multiples of 10 like 80, 100, 120, 200, 240, 600, 1800; never odd, fractional, or non-decimal values like 93 or 1834).*
   - **Thematic In-Run Challenge Categories & Mechanics:**
     - **Specific Bestiary Hunts:** Slaying distinct mutant enemy archetypes in a single run (Swarmlings, Armored Scarabs, Venom Spitters, Phase Phantoms, Arc Drones, Magma Brutes).
     - **Specific Food & Item Harvests:** Consuming particular floor items (Crimson Apples, Golden Apples, Health Potions, Astral Shards / Prisms, Total Foods).
     - **Combat Feats & Combo Streaks:** Maintaining execution precision combos (8x, 10x, 15x, 18x, 20x, 25x, 35x, 40x streaks) or scaled serpent length goals.
     - **Boss Guardians Defeats:** Overcoming key Floor Guardians (Floor 1 Centipede Behemoth, Floor 2 Storm Gorgon, Floor 3 Infernal Colossus, Floor 5 Chrono Wyrm, Floor 7 Apex Superconductor, Floor 8 Astral Leviathan, Floor 10 Shadow Doppelgänger, Floor 15 Prismatic Arachnid, Floor 17 Nanite Hive Titan, Floor 20 The Eternal Ouroboros).
   - **Cross-Platform Responsive Scaling:**
     - Desktop ($1600 \times 960$, $R=1.0$): Plasma T1 = 35, Shield T2 = 600, Laser T3 = 1800.
     - Default Simulation ($960 \times 640$, $R=0.40$): Plasma T1 = 14, Shield T2 = 240, Laser T3 = 720.
     - Mobile Portrait ($540 \times 960$, $R=0.3375$): Plasma T1 = 12, Shield T2 = 200, Laser T3 = 610.
     - Compact Mobile ($360 \times 540$, $R=0.1265$): Plasma T1 = 10, Shield T2 = 80, Laser T3 = 230.
- **Unlimited Tactical Capacity:** The head has no slot limit; players can acquire and stack any number of unlocked weapon modules, defensive bio-organs, and cranial augments up to their current unlocked meta tier.
- **Escalating Purchase Cost Tradeoff:** Each purchase on the head increases the price of subsequent upgrades:
  $$\text{Cost}(\text{level}, \text{purchases}) = \text{BaseCost} \times \text{level} + \text{purchases} \times \text{CostScaling}$$
  - Modules: $\text{BaseCost} = 30 \text{ Ouro}, \text{CostScaling} = 15 \text{ Ouro}$
  - Cranial Augments: $\text{BaseCost} = 40 \text{ Ouro}, \text{CostScaling} = 20 \text{ Ouro}$
- **Combat Firing Center:** All installed weapons and defensive auras trigger directly from the Head position $(x_{\text{head}}, y_{\text{head}}, \theta_{\text{head}})$.

#### 3.11.1 Authoritative Challenge-Gated Tier Unlock Matrix (Diverse Single-Condition SSOT)

*Note: Length requirements dynamically scale according to active arena dimensions via $\text{RoundToTen}(\text{BaseDesktopLength} \times R)$ (or $\max(10, \lfloor 35 \times R \rceil)$ for $L < 50$). Values shown below represent Reference Desktop ($1600 \times 960$, $R=1.0$) base requirements.*

| Upgrade / Augment Key | Category | Tier 1 Challenge (Single Condition) | Tier 2 Challenge (Single Condition) | Tier 3 Challenge (Single Condition) |
| :--- | :--- | :--- | :--- | :--- |
| `turret` | Offensive Weapon | **Starter Default** (Unlocked) | Defeat Apex Superconductor (Floor 7) | Defeat Prismatic Arachnid (Floor 15) |
| `tesla` | Offensive Weapon | Maintain a Combo Streak of 8x | Maintain a Combo Streak of 20x | Maintain a Combo Streak of 40x |
| `venom` | Offensive Weapon | Slay 20 Enemies in a run | Slay 15 Arc Drones in a run | Slay 200 Enemies in a run |
| `shield` | Defensive Organ | **Starter Default** (Unlocked) | Grow Serpent to Length 600 (scaled) | Grow Serpent to Length 1200 (scaled) |
| `spikes` | Defensive Organ | Slay 10 Armored Scarabs in a run | Slay 12 Phase Phantoms in a run | Defeat 18 Boss Guardians |
| `fangs` | Cranial Augment | Maintain a Combo Streak of 15x | Maintain a Combo Streak of 20x | Slay 10 Magma Brutes in a run |
| `magma` | Offensive Weapon | Slay 15 Swarmlings in a run | Defeat Astral Leviathan (Floor 8) | Grow Serpent to Length 1350 (scaled) |
| `cryo` | Offensive Weapon | Drink 2 Health Potions in a run | Defeat Shadow Doppelgänger (Floor 10) | Defeat The Eternal Ouroboros (Floor 20) |
| `plasma` | Offensive Weapon | Reach Serpent Length 35 (scaled) | Grow Serpent to Length 800 (scaled) | Grow Serpent to Length 1500 (scaled) |
| `chrono` | Defensive Organ | Defeat Chrono Wyrm (Floor 5) | Defeat 8 Boss Guardians | Grow Serpent to Length 1500 (scaled) |
| `tachyon` | Offensive Weapon | Maintain a Combo Streak of 10x | Defeat Nanite Hive Titan (Floor 17) | Grow Serpent to Length 1500 (Legendary Titan) |
| `regen` | Defensive Organ | Eat 30 Crimson Apples in a run | Collect 120 Food items in a run | Collect 250 Food items in a run |
| `magnet` | Defensive Organ | Collect 2 Golden Apples in a run | Maintain a Combo Streak of 18x | Maintain a Combo Streak of 35x |
| `nanite` | Defensive Organ | Collect 5 Astral Shards / Prisms in a run | Grow Serpent to Length 800 (scaled) | Defeat 18 Boss Guardians |
| `flak` | Offensive Weapon | Defeat Storm Gorgon (Floor 2) | Maintain a Combo Streak of 25x | Defeat 15 Boss Guardians |
| `scattershot` | Offensive Weapon | Slay 25 Enemies in a run | Grow Serpent to Length 650 (scaled) | Grow Serpent to Length 1200 (scaled) |
| `needler` | Offensive Weapon | Defeat Infernal Colossus (Floor 3) | Collect 80 Food items in a run | Collect 220 Food items in a run |
| `maw` | Cranial Augment | Defeat Centipede Behemoth (Floor 1) | Grow Serpent to Length 600 (scaled) | Grow Serpent to Length 1500 (scaled) |
| `horns` | Cranial Augment | Slay 10 Armored Scarabs in a run | Defeat 8 Boss Guardians | Defeat 16 Boss Guardians |
| `visor` / `laser` | Cranial Augment | Slay 8 Venom Spitters in a run | Slay 110 Enemies in a run | Grow Serpent to Length 1800 (scaled) |
| `crown` / `crest` | Cranial Augment | Collect 45 Food items in a run | Collect 150 Food items in a run | Collect 300 Food items in a run |

### 3.12 Boss Helmet Equipment & Persistent Meta-Progression
- **Boss Loot & Ouro Drops:** Defeating a floor boss grants **+35 Ouro** and drops a procedurally rolled **Helmet** added to the player's permanent collection.
- **5-Tier Rarity Scale:**
  1. `common` (1 affix, standard power)
  2. `uncommon` (2 affixes, +20% power range)
  3. `rare` (3 affixes, +50% power range)
  4. `epic` (4 affixes, +90% power range)
  5. `mythic` (5 affixes, +150% power range + unique title)
- **Random Stat Modifiers:** Max HP, Armor %, Move Speed %, Bite Power %, Crit Chance %, Crit Damage %, HP Regen, Starting Shield, Magnet Radius, Dash Cooldown, XP %, Shard %, and Thorns.
- **Run Start Loadout:** Players select an active helmet from their collection before starting an expedition; equipped helmets persist across deaths.

---

## 📐 4. Authoritative Mathematical Formulas & Constants

| Constant / Formula ID | Name | Mathematical Expression | Purpose & Unit |
| :--- | :--- | :--- | :--- |
| `FIXED_STEP` | Simulation Tick Interval | $\Delta t = \frac{1}{120} \approx 0.0083333333 \text{ s}$ | Fixed simulation timestep for bit-exact reproducibility |
| `MAX_STEPS_PER_FRAME` | Max Accumulator Steps | $\text{steps}_{\max} = 6$ | Prevents spiral of death on frame rate drops |
| `BITE_INTERVAL` | Target Hit Immunity | $\tau_{\text{bite}} = 0.28 \text{ s}$ | Rate-limits damage ticks on a single hostile entity |
| `FORMULA_HEAD_HP` | Head Max HP | $\text{HeadMaxHp} = 2 \times \text{BaseSegmentHp}$ | Head health capacity (2x body segment) |
| `FORMULA_SEGMENT_HP` | Segment Base Max HP | $\text{MaxHp}_{\text{seg}} = \max(15, \lfloor \text{ClassBaseHp} / 4 \rceil + \text{level}(\text{'vitality'}) \times 5)$ | Individual health capacity per body segment |
| `FORMULA_TOTAL_HP` | Total Player Health | $HP_{\text{total}} = \text{HeadHp} + \sum_{i=0}^{N-1} \text{segment}[i].Hp$ | Cumulative serpent health pool |
| `FORMULA_TOTAL_MAX_HP` | Total Player Max HP | $HP_{\max} = \text{HeadMaxHp} + \sum_{i=0}^{N-1} \text{segment}[i].MaxHp$ | Cumulative serpent maximum health capacity |
| `FORMULA_TOP_DOWN_HEAL` | Top-to-Bottom Sequential Heal | $\text{Head} \to \text{segment}[0] \to \dots \to \text{segment}[N-1]$ | Sequential missing health replenishment |
| `FORMULA_SELF_COLLISION` | Self-Collision Damage | $\text{if } \text{dist}(\text{Head}, \text{segment}[k \ge 3]) < R_{\text{head}} + R_{\text{seg}} \implies \text{damage}(\text{segment}[k])$ | Self-bite collision damage resolution |
| `FORMULA_SEVER_CONDITION` | Segment Severing | $\text{if } \text{segment}[k].Hp \le 0 \implies \text{sever}(k \dots N-1)$ | Destruction and loss of downstream chassis wagons |
| `FORMULA_SNAKE_SPEED` | Player Move Speed | $v = v_{\text{base}} \times (1 + \text{speedBonus}) \times (\text{isDashing} ? 2.5 : 1.0)$ | Linear forward head velocity ($\text{px/s}$) |
| `FORMULA_TURN_RATE` | Snake Turn Rate | $\omega = \omega_{\text{base}} \times (1 + \text{turnBonus}) \text{ rad/s}$ | Angular heading rotation speed |
| `FORMULA_XP_REQUIREMENT` | Calibrated Level-Up XP Threshold | $\text{Threshold}(L) = \lfloor 75 \times (L - 1)^{1.34} + 80 \times (L - 1) \rfloor$ | Calibrated cumulative XP required for level $L$ (Level 4 @ F5, Level 10 @ F20) |
| `FORMULA_FOOD_TARGET` | 21.5m Run Pacing Food Target | $\text{FoodTarget}(F) = \min\left(42, 16 + \lfloor 2.2 \times (F - 1) \rfloor\right)$ | Floor food ingestion quota (0 for BossRush, totaling 669 across 20 floors) |
| `FORMULA_CLUTCH_CATCH` | Clutch Catch Score Bonus | $\text{if } 0 < \tau_{\text{combo}} \le 0.6\text{ s} \implies \text{Score} = \lfloor \text{Score}_{\text{base}} \times M_{\text{combo}} \times 1.5 \rfloor$ | +50% score boost on clutch food ingestion |
| `FORMULA_COMBO_MULTIPLIER` | Combo Multiplier Tiers | $C \ge 3 \to 2\times, 8 \to 3\times, 14 \to 4\times, 22 \to 5\times, 30 \to 6\times, 40 \to 8\times$ | Stepped combo damage/score multiplier |
| `FORMULA_HEAD_UPGRADE_COST` | Cranial Module Scaled Cost | $\text{Cost}(\text{lvl}, p) = 30 \times \text{lvl} + p \times 15 \text{ Ouro}$ | Scaled upgrade cost on Head based on total purchases $p$ |
| `FORMULA_HEAD_AUGMENT_COST` | Cranial Augment Scaled Cost | $\text{Cost}(\text{lvl}, p) = 40 \times \text{lvl} + p \times 20 \text{ Ouro}$ | Scaled cranial augment cost on Head based on total purchases $p$ |
| `FORMULA_ARENA_LENGTH_RATIO` | Dynamic Gameboard-to-Length Scaling & 10ner Rounding | $R = \text{clamp}\left(\frac{\text{ArenaW} \times \text{ArenaH}}{1600 \times 960}, 0.12, 1.0\right)$<br>$\text{Req} = \max(10, \lfloor \text{BaseLength} \times R / 10 \rceil \times 10)$<br>$\text{T1 Base}: 250, \text{T2 Base}: [600, 800], \text{T3 Base}: [1200, 1800]$ | Dynamic viewport area scaling with strict 10ner-step rounding |
| `FORMULA_HELMET_RARITY` | Boss Helmet Drop Weights | $\text{Floor 1}: [60, 35, 5, 0, 0]\%$<br>$\text{Floor 2}: [0, 50, 35, 15, 0]\%$<br>$\text{Floor 3+}: [0, 0, 45, 40, 15]\%$ | Procedural helmet rarity distribution per floor |
| `FORMULA_SACRIFICE_SCORE` | Galaxy Jump Sacrifice Score | $S = \sum_{h \in \text{Sacrificed}} (50 \times \text{AffixCount}(h) + \text{FloorBonus}(h) + \text{PowerRating}(h)) \times M_{\text{rarity}}(h)$ | Cumulative sacrifice value of surrendered standard boss helmets |
| `FORMULA_GALAXY_DROP_PROB` | Unique Helmet Drop Probability | $P(\text{Unique}) = 1 - \exp\left(-\frac{S}{800}\right)$ | Asymptotic probability of rolling an unowned Unique Helmet upon Galaxy Jump (saturation threshold at $S = 800$) |
| `FORMULA_BOSS_RUSH_INTERVAL` | Celestial Rift Wave Interval | $\Delta t_{\text{wave}} = 8.0 \text{ s}$ | Fixed cadence between subsequent apex boss awakenings during the Final Trial |
| `FORMULA_GALLERY_GEOMETRY` | Ouroboros Gallery Sockets | $\theta_k = k \times \frac{2\pi}{8} - \frac{\pi}{2}, \quad (x_k, y_k) = (R \cos \theta_k, R \sin \theta_k), \quad R = 220\text{ px}$ | Circumferential socket coordinates for 8 Unique Helmets orbiting central 9th socket |

---

## 📊 5. Entities, Classes & Balance Tables

### 5.1 Playable Serpent Archetypes

| Class ID | Name | Base HP | Speed | Dash CD | Bite Power | Magnet Rad | Crit % | Crit Mult | Armor | Active Skill |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `emerald` | **Emerald Viper** | 110 | 1.00 | 3.2s | 26 | 78px | 8% | 1.50x | 0% | **Verdant Bloom** (Heal 20% max HP + 5 fruits) |
| `stalker` | **Shadow Stalker** | 85 | 1.15 | 2.4s | 34 | 58px | 25% | 2.00x | 0% | **Umbral Blink** (Blink 200px + decoy bomb) |
| `hydra` | **Hydra Behemoth** | 170 | 0.90 | 4.0s | 42 | 62px | 5% | 1.50x | 25% | **Titan Roar** (230px shockwave stun + 25% armor) |
| `storm` | **Storm Wyrm** | 95 | 1.22 | 2.8s | 28 | 68px | 12% | 1.75x | 5% | **Chain Storm** (Chain lightning bolt across 8 targets) |
| `solar` | **Solar Drake** | 120 | 1.05 | 3.0s | 32 | 72px | 10% | 1.60x | 10% | **Supernova** (Solar blast nova + gilds all fruits) |

### 5.2 Enemy Bestiary

| Enemy Key | Name | Base HP | HP/Floor | Speed | Radius | Base Dmg | Dmg/Floor | Ouro | Score | Min Floor |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `scarab` | Scarab Beetle | 46 | +16 | 96 px/s | 13px | 16 | +3 | 2 | 220 | Floor 1 |
| `swarmling` | Swarmling Mite | 20 | +7 | 155 px/s | 9px | 10 | +2 | 1 | 110 | Floor 1 |
| `spitter` | Venom Spitter | 38 | +15 | 74 px/s | 13px | 14 | +3 | 3 | 260 | Floor 2 |
| `phantom` | Phantom Shade | 30 | +11 | 118 px/s | 12px | 20 | +4 | 3 | 280 | Floor 2 |
| `drone` | Arc Drone | 62 | +21 | 56 px/s | 14px | 18 | +4 | 4 | 320 | Floor 3 |
| `brute` | Magma Brute | 130 | +45 | 62 px/s | 19px | 28 | +6 | 6 | 500 | Floor 4 |

### 5.3 Boss Guardians (20 Apex Bosses & Multi-Boss Escalation)

| Floor | Boss Archetype | Name | Base HP | HP/Floor | Segments | Radius | Signature Attacks & Abilities |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Floor 1** | `centipede` | **Centipede Behemoth** | 450 | +180 | 14–24 | 30px | Segmented chitinous body, forward spread projectile volleys, enrage charge. |
| **Floor 2** | `gorgon` | **Storm Gorgon** | 650 | +220 | 12–20 | 32px | Electrified coil body, 360° spark nova, targeted ground laser strikes. |
| **Floor 3** | `colossus` | **Infernal Colossus** | 900 | +280 | 10–16 | 34px | Molten magma carapace, 22-bullet ring barrage, multi-meteor bombardment. |
| **Floor 4** | `frostwyrm` | **Glacial Behemoth** | 1200 | +340 | 14–22 | 35px | Diamond ice crystal spines, frost nova volleys with chill slow, blizzard hazard zones. |
| **Floor 5** | `chronowyrm` | **Chrono Wyrm** | 1500 | +400 | 14–22 | 33px | Temporal flux dial rings, double-spiral temporal orbs, time dilation arena pulses. |
| **Floor 6** | `hivemind` | **Bio-Venom Hivemind** | 1900 | +460 | 16–26 | 36px | Segmented spore pods, virulent poison clouds, Swarmling mite summons. |
| **Floor 7** | `superconductor_boss` | **Apex Superconductor** | 2400 | +520 | 12–20 | 34px | Hyper-charged galvanic dynamo generating lightning cages and laser spirals. |
| **Floor 8** | `leviathan` | **Astral Leviathan** | 3000 | +580 | 18–30 | 35px | Celestial void discs, counter-rotating 4-arm void spirals, orbital starlight beacons. |
| **Floor 9** | `quantum_hydra` | **Quantum Hydra** | 3700 | +650 | 14–22 | 36px | Multiverse serpent splitting into probabilistic reality coils with quantum phase shift. |
| **Floor 10** | `mirror_wyrm` | **Shadow Doppelgänger** | 4500 | +720 | 14–22 | 33px | Mirror entity copying player trajectory with lethal inverse reflections and shadow daggers. |
| **Floor 11** | `void_devourer` | **Void Devourer** | 5400 | +800 | 16–26 | 37px | Abyssal gravity maw consuming arena matter and light with gravitational singularity pulls. |
| **Floor 12** | `orbital_dreadnought` | **Magnetic Dreadnought** | 6400 | +880 | 16–26 | 36px | Colossal floating fortress bristling with magnetized railgun turrets and EMP storms. |
| **Floor 13** | `iron_juggernaut` | **Aegis Juggernaut** | 7500 | +960 | 16–28 | 38px | Impervious adamantine colossus shattering arenas under kinetic momentum and shockwaves. |
| **Floor 14** | `solar_archon` | **Dyson Archon** | 8700 | +1050 | 14–22 | 35px | Stellar fusion incarnate casting sweeping solar laser corridors and solar flares. |
| **Floor 15** | `crystal_monolith` | **Prismatic Arachnid** | 10000 | +1150 | 14–22 | 34px | Resonating quartz arachnid refracting beams through rotating crystal prism matrices. |
| **Floor 16** | `tempest_siren` | **Tempest Siren** | 11500 | +1250 | 14–24 | 34px | Vortex mistress commanding hurricane eddies, torrential lightning, and squall barriers. |
| **Floor 17** | `nanite_titan` | **Nanite Hive Titan** | 13200 | +1350 | 16–28 | 36px | Self-replicating swarm entity regenerating broken segments in combat with nanite swarms. |
| **Floor 18** | `phase_specter` | **Plasma Phase Specter** | 15000 | +1450 | 14–22 | 33px | Ethereal high-energy apparition phasing through solid geometry with plasma discharges. |
| **Floor 19** | `volcanic_chimera` | **Volcanic Chimera** | 17000 | +1550 | 16–26 | 37px | Tri-headed subterranean beast erupting magma fountains, lava pools, and obsidian boulders. |
| **Floor 20** | `eternal_ouroboros` | **The Eternal Ouroboros** | 20000 | +1700 | 20–32 | 40px | Celestial cycle of rebirth and destruction holding eternity together; full bullet hell climax. |

#### 5.3.1 Multi-Boss Escalation Rule (Floors 21+)
- **Campaign Sequence (Floors 1–20):** Exactly 1 Apex Boss guardian spawns per floor according to `GameData.BossForFloor(floor)`. Defeating Floor 20 unlocks Game Victory.
- **Endless Multi-Boss Escalation (Floors 21+):**
  - **Floors 21–30:** 2 simultaneous random Apex Bosses.
  - **Floors 31–40:** 3 simultaneous random Apex Bosses.
  - **Floors 41–50:** 4 simultaneous random Apex Bosses.
  - **Floors 51–60:** 5 simultaneous random Apex Bosses.
  - **Floors 61+:** 6 simultaneous random Apex Bosses (capped at 6).
- **Cycle HP & Speed Scaling:** Cycle index $C = \lfloor (\text{Floor} - 1) / 20 \rfloor$, $\text{CycleFloor} = C \times 20$. Boss HP scales by $\text{MaxHp} = \lfloor (\text{BaseHp} + \text{HpPerFloor} \times \text{CycleFloor}) \times (1.0 + C \times 0.35) \times \text{MultiBossScale} \rceil$, accompanied by Roman numeral titles (e.g. *Centipede Behemoth II* on Floor 21).
- **Multi-Boss Shared Health Pool Modifier:** When $N \ge 2$ simultaneous bosses spawn (Floors 21+), each boss entity receives a calibrated $\text{MultiBossScale} = 0.75\times$ individual HP modifier. Single boss spawns use baseline $\text{MultiBossScale} = 1.0\times$.
- **Horde Defeat Gate:** The arena floor is only cleared when **ALL active bosses** in the horde are defeated. Each boss drops individual Ouro (+35) and a procedural Helmet.

### 5.4 Evolutionary Draft Cards Catalog (36 Cards)

| Card ID | Title | Rarity | Max Stacks | Stat / Relic Effect |
| :--- | :--- | :--- | :--- | :--- |
| `swift_scales` | Swift Scales | Common | 5 | +12% Movement Speed |
| `iron_belly` | Iron Belly | Common | 5 | +25 Max HP, heal 25 |
| `magnetic_coil` | Magnetic Coil | Common | 4 | +40% Magnet Range |
| `razor_fangs` | Razor Fangs | Common | 5 | +15 Bite Power, +5% Crit |
| `sprint_gland` | Sprint Gland | Common | 4 | -18% Dash Cooldown |
| `hardened_carapace` | Hardened Carapace | Common | 5 | +8% Damage Reduction |
| `keen_eye` | Keen Eye | Common | 4 | +30% Critical Damage |
| `gourmand` | Gourmand | Common | 4 | +20% XP Gained |
| `serpents_focus` | Serpent's Focus | Common | 3 | +25% Combo Window |
| `shard_lust` | Shard Lust | Common | 3 | +30% Shard Drops |
| `venom_spit` | Venom Spit | Rare | 3 | Auto-fires tracking venom darts (45 dmg) |
| `frostbite_aura` | Frostbite Aura | Rare | 2 | Slows nearby hostiles by 45% in aura |
| `shield_matrix` | Shield Matrix | Rare | 3 | +45 Energy Shield, recharges after 8s |
| `vampiric_feast` | Vampiric Feast | Rare | 3 | +3 HP per feast/kill, +15% Bite Power |
| `explosive_appetite` | Explosive Appetite | Rare | 2 | Eating erupts for 45 dmg in 90px AoE |
| `combo_surge` | Combo Surge | Rare | 2 | +50% Combo Window, +15% XP |
| `barbed_scales` | Barbed Scales | Rare | 3 | Reflects 40% contact damage back to attacker |
| `adrenal_surge` | Adrenal Surge | Rare | 2 | +35% Speed & +20% Bite below 40% HP |
| `seeker_venom` | Seeker Venom | Rare | 2 | Venom darts track enemies with homing |
| `glutton_growth` | Glutton Growth | Rare | 2 | Every 8 meals: +10 Max HP & healed |
| `orbital_fangs` | Orbital Fangs | Epic | 3 | +2 Orbiting fangs deal 55 contact DPS & block shots |
| `chain_reaction` | Chain Reaction | Epic | 2 | Slain enemies explode for 60 dmg in 95px AoE |
| `quantum_phase` | Quantum Phase | Epic | 1 | Immune to self-collision; Dash pierces enemies |
| `singularity_core` | Singularity Core | Epic | 2 | Gravitational pulse vacuums all food & shards |
| `overdrive_capacitor`| Overdrive Capacitor | Epic | 2 | Frenzy triggers at 8x combo, extends duration +4s |
| `molten_wake` | Molten Wake | Epic | 2 | Movement trail leaves burning magma puddles |
| `cryo_nova` | Cryo Nova | Epic | 2 | Taking damage blasts 160px frost nova (30 dmg + freeze) |
| `echo_strike` | Echo Strike | Epic | 2 | Bites trigger a 55% phantom echo strike |
| `soul_harvest` | Soul Harvest | Epic | 2 | Slain foes drop Soul Remnants (+35 XP, heal 4) |
| `dragons_breath` | Dragon's Breath | Legendary | 2 | Continuous conical flame stream (22 dmg + burn) |
| `god_of_thunder` | God of Thunder | Legendary | 2 | Lightning strikes hostiles for 80 dmg at 2x+ combo |
| `phoenix_rebirth` | Phoenix Rebirth | Legendary | 2 | Cheat death: full revival + 400 dmg wipe shockwave |
| `infinite_devourer` | Infinite Devourer | Legendary | 1 | Every 5 combo: +10 Max HP, +10 heal, +5% damage |
| `eternal_coil` | Eternal Coil | Legendary | 1 | Entire body length deals 30 contact DPS to hostiles |
| `time_dilation` | Time Dilation | Legendary | 1 | Time slows to 55% when below 30% HP |
| `apex_predator` | Apex Predator | Legendary | 1 | +100% Bite Power, -25% Max HP |

---

## 🏛️ 6. Sanctuary Meta-Progression Shop

| Upgrade Key | Name | Icon | Max Level | Base Cost | Cost Mult | Effect Description |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `vitality` | Vitality Essence | ❤️ | 6 | 40 💎 | 1.6x | +10 starting Max HP |
| `agility` | Agility Rune | 💨 | 5 | 55 💎 | 1.7x | +4% starting Speed |
| `ferocity` | Feral Instinct | 🦷 | 5 | 60 💎 | 1.7x | +6% starting Bite Power |
| `resilience` | Stonehide | 🛡️ | 5 | 70 💎 | 1.75x | +3% Damage Reduction |
| `magnet` | Magnetic Attunement | 🧲 | 5 | 35 💎 | 1.5x | +15% Magnet Range |
| `swiftness` | Quickened Sinew | ⚡ | 4 | 75 💎 | 1.8x | -0.15s Dash Cooldown |
| `rerolls` | Fate's Fortune | 🎲 | 3 | 90 💎 | 2.0x | +1 draft re-roll per run |
| `fortune` | Gilded Fate | 🍀 | 3 | 120 💎 | 2.1x | Better draft rarity odds |
| `greed` | Sharded Harvest | 💎 | 5 | 45 💎 | 1.6x | +15% Shards earned |
| `unlock_tachyon` | Tachyon Laser Blueprint | 📡 | 1 | 250 💎 | 1.0x | Unlocks Tachyon Laser offensive weapon in Lab |
| `unlock_cryo` | Cryo Mortar Blueprint | ❄️ | 1 | 320 💎 | 1.0x | Unlocks Cryo Mortar offensive weapon in Lab |
| `unlock_plasma` | Plasma Mortar Blueprint | 💥 | 1 | 380 💎 | 1.0x | Unlocks Plasma Mortar offensive weapon in Lab |
| `unlock_chrono` | Chrono Ward Blueprint | ⏳ | 1 | 400 💎 | 1.0x | Unlocks Chrono Ward defensive bio-organ in Lab |
| `unlock_nanite` | Nanite Swarm Blueprint | 🦠 | 1 | 450 💎 | 1.0x | Unlocks Nanite Swarm defensive bio-organ in Lab |

---

## 📱 7. Responsive Layout & Multi-Screen Engine

- **Aspect Ratio Adaptability**: Dynamic canvas scaling with virtual viewport math ($1280 \times 720$ nominal coordinate space).
- **Zero UI Overlap Invariant**: HUD top bars (Health, Score, Combo, Level) are anchored with non-colliding flex containers; Touch Virtual Sticks are confined to quadrant bounds with notch safe-area insets.
- **Multi-Screen Sync**: Web `BroadcastChannel` protocol synchronizes gameplay state to auxiliary browser windows (Minimap radar, live stats, secondary controls) with sub-millisecond local latency.

---

## 🤖 8. Autonomous Bot Controller & Human-Equivalent Action Standard (HEBAR)

- **Zero Cheating & Zero Direct State Mutation**: Autonomous bots must not mutate internal player or game state fields directly (no injecting free gold, free stats, unearned perks, or socket modules).
- **Physical Input Compliance**: All bot movement, steering, dashes, and active skills route strictly through standard controller interfaces (`IInput` / `ScriptedInput` / `InputManager`) obeying kinematic turn rates ($\omega_{\text{turn}}$) and real action cooldowns.
- **UI & Modal Interaction Parity**: Card drafting on floor progression must pick strictly from the active PRNG-offered cards in `CurrentDraftCards`. Cranial Mutation Lab purchases must validate challenge unlock requirements and execute atomic wallet deductions via `SpendOuro(cost)`. Boss helmets may only be equipped if legitimately unlocked in the `MetaProgression` vault.
- **Strict Head-Centric Serpentine Architecture**: Body segment sockets/wagon pod upgrades are permanently eliminated from the entire game engine. All weapons, defensive bio-organs, and cranial augments reside strictly on the Serpent Head.

---

## 🎮 9. Technical Architecture: 100% Pure WebGL 2.0 Engine Standard

### 9.1 Absolute Canvas 2D Ban & Pure WebGL Mandate
- **HTML5 Canvas 2D Banished**: The HTML5 Canvas 2D API (`CanvasRenderingContext2D`, `Ctx2D`, `canvas.getContext('2d')`, `OffscreenCanvas.getContext('2d')`) is permanently and unconditionally banished from the entire project.
- **Immediate Treatment on Sight**: Any AI agent or developer encountering Canvas 2D code, fallbacks, shims, or imports MUST immediately treat it with zero tolerance: rewrite it into pure WebGL 2.0 shaders/batches or suppress/delete it on the spot.
- **Exclusive WebGL 2.0 Rendering Pipeline**: All visuals—serpentine bodies, cranial augments, bosses, enemies, arena backdrops, nebulae, telegraphs, floating combat text, HUD, and the 3D Ouroboros knot—are rendered strictly via hardware-accelerated WebGL 2.0 (`WebGL2RenderingContext`).

### 9.2 Core WebGL Architecture Components
- **`WebGLGameRenderer.ts`**: The singular master renderer. Owns the WebGL context, camera matrix transformations, viewport dynamic scaling, and draw pass orchestration.
- **`GLBatch.ts`**: High-throughput dynamic vertex batcher. Batches lines, quads, textured quads, smooth serpentine ribbon strips, and procedural signed distance field (SDF) primitives with zero garbage collection overhead.
- **`src/render/webgl/`**: Houses specialized GLSL vertex/fragment shaders:
  - `GLPrimitive` shaders for laser telegraphs, glowing boundaries, and particles.
  - Nebula SDF shaders generating smooth procedural cosmic backgrounds directly on the GPU.
- **`WebGLAssetAtlas.ts`**: High-performance GPU texture atlas caching food pickups, runes, and icons with zero per-frame CPU-to-GPU memory uploads.

### 9.3 Zero Fallback Guarantee
- If a target runtime or browser lacks WebGL 2.0 support, the engine displays a clear, stylized WebGL 2.0 requirement screen. Under no circumstance does the engine degrade or fallback to Canvas 2D.

---

## The Grand Finale: The 9th Celestial Helmet, Galaxy Jump & The Boss Rush Gauntlet

### 10.1 Narrative Context & The "End" Mechanic in an Infinite Loop
- **Cosmological Premise**: *Ouroboros Ascension* is fundamentally structured as an infinite cyclical loop. The cosmic serpent is born, traverses escalating galactic sectors, consumes stellar matter, slays apex entities, perishes, and re-emerges from the cosmic egg.
- **The "End" Mechanic**: The Grand Finale introduces the definitive terminus—an ascension mechanism that shatters the cycle of eternal recurrence.
- **The Ultimate Pilgrimage**:
  1. The player must transcend standard galaxies by executing **Galaxy Jumps** (prestige sacrifices).
  2. Surrendering accrued standard boss helmets feeds the cosmic crucible to forge the **8 Unique Relic Helmets**.
  3. These 8 primordial relics are enshrined in the **Ouroboros Circular Gallery**, filling the 8 circumferential sockets of the world serpent.
  4. Socketing all 8 relics awakens the inward-turned Serpentine Head at the center of the ring, unlocking the ritual to forge the supreme **9th Celestial Crown: The Celestial Crown of the Eternal Ouroboros**.
  5. Forging the 9th crown instantly catapults the player into **The Celestial Rift Arena** to face the **Final Trial: The 8-Second Wave All-Boss Rush**.
  6. Defeating all awakened apex bosses crowns the player as the **Eternal Sovereign of the Ouroboros**, permanently preserving the 9th Omni-Helmet in their vault and concluding the campaign with true cosmic ascension.
  7. Failing the trial triggers **High-Stakes Permaloss**: the volatile celestial fusion destabilizes and catastrophically shatters all 8 Unique Helmets, resetting the unique helmet gallery inventory to zero!

---

### 10.2 The 8 Unique Relic Helmets (SSOT Specification)

The 8 Unique Helmets are singular cosmic artifacts dropped exclusively via the Galaxy Jump prestige sacrifice. Unlike procedurally generated helmets, the 8 Unique Helmets have fixed, legendary identities, transcendent baseline stat allocations, and game-altering signature capacities.

#### 10.2.1 Gold-Brown Cosmic Aesthetic Theme
All 8 Unique Helmets and the supreme 9th Omni-Helmet share an exclusive, authoritative **Gold-Brown Cosmic Aesthetic Theme**:
- **Chromatic Palette**:
  - Primary Metallic Gold: `#d4af37`
  - Deep Dark Goldenrod: `#b8860b`
  - Burnished Bronze-Brown / Cosmic Ochre: `#8c6239`
  - Astral Amber Highlight: `#ffd166`
  - Singularity Core White: `#fffdf0`
- **Procedural WebGL Visual Treatment**:
  - Distinctive anisotropic metallic specular shader highlights ($k_{\text{spec}} = 0.85$, $n = 32.0$).
  - Orbiting radiant gold-brown particle halos and stardust embers.
  - In both the Ouroboros Circular Gallery and during active gameplay runs, Unique Helmets exclusively display this prestigious gold-brown cosmic presentation, instantly differentiating them from common, rare, epic, and mythic procedural helmets.

#### 10.2.2 The 8 Primordial Relics & Game-Changing Signature Capacities

| Slot | Relic ID (Canonical & Alias) | Helmet Name | Primordial Aspect | Icon | Primary Stat Modifiers | Signature Active / Triggered Capacity |
| :---: | :--- | :--- | :--- | :---: | :--- | :--- |
| **1** | `unique_colossus_crown`<br>*(alias: `unique_helm_adamantine_juggernaut`)* | **Crown of the Colossus** | Titanic Earth & Magma | 🌋 | +45% Armor<br>+60 Head Max HP<br>+40 Thorns<br>-10% Speed | **Titanic Armor Shockwave**:<br>Direct collision damage received is reduced by 40%. Ramming hostiles or sustaining damage unleashes a tectonic seismic shockwave ($R = 160\text{ px}$, 180 physical damage) knocking enemies backward at $280\text{ px/s}$ with a 0.5s stun. |
| **2** | `unique_gorgon_gaze`<br>*(alias: `unique_helm_tempest_siren`)* | **Gaze of the Gorgon** | Galvanic Venom & Stasis | 👁️ | +25% Crit Chance<br>+0.60x Crit Multiplier<br>+15% Bite Power | **Gorgon Petrifying Stun**:<br>Biting or maintaining line-of-sight on enemies within $220\text{ px}$ inflicts a 35% chance of *Petrification* (complete freeze/immobilization for 1.8s, amplifying damage taken by +30%). Tail continuously excretes a virulent toxic mist ($45\text{ DPS}$, $4.0\text{ s}$ linger, 40% enemy slow). |
| **3** | `unique_behemoth_maw`<br>*(alias: `unique_helm_abyssal_leviathan`)* | **Maw of the Behemoth** *(Abyssal Titan)* | Chitinous Gluttony & Megalithic Growth | 🪱 | +50% Bite Power<br>+3.5 HP/s Regen<br>+35 Segment Max HP | **Titan Gorging**:<br>Eating food temporarily **doubles Head size and bite reach** ($\text{HeadRadius} \times 2.0$) for **3.0 seconds**! Consecutive food ingestion refreshes the 3.0s duration timer. Bite hitbox extends through Head and the first 3 body segments; biting an enemy leeches 8% of damage dealt as instant health replenishment. |
| **4** | `unique_leviathan_wings`<br>*(alias: `unique_helm_tempest_siren`)* | **Wings of the Leviathan** | Abyssal Hydrodynamics | 🌊 | +35% Move Speed<br>-40% Dash Cooldown<br>+50 Magnet Radius | **Leviathan Tidal Dash**:<br>Dashing propels serpent at $3.5\times$ base velocity and discharges dual lateral planar shockwaves ($250\text{ px}$ width, 140 damage, piercing all mobs and destroying projectile rings). Grants 0.4s phase-hazard invulnerability. |
| **5** | `unique_chronos_eye`<br>*(alias: `unique_helm_chrono_singularity`)* | **Eye of Chronos** | Spacetime Causality | ⏳ | +20% Turn Rate<br>+25% XP Multiplier<br>+20 Starting Shield | **Chronos Time Slowdown**:<br>Hostiles and hostile bullets within $300\text{ px}$ are dilated to 50% speed. Upon suffering lethal damage or segment severing, activates *Tachyon Rewind*: phases serpent into invulnerability for 2.0s and restores position/segment HP to state from 3.0s prior ($45\text{ s}$ cooldown). |
| **6** | `unique_void_horns`<br>*(alias: `unique_helm_prismatic_monolith`)* | **Void Singularity Horns** | Gravitational Collapse | 🕳️ | +120 Magnet Radius<br>+30% Shard Multiplier<br>+25 Max Shield | **Void Gravity Vortex**:<br>Generates an inexorable gravitational vortex pulling food, shards, and minor hostiles toward the Head within $350\text{ px}$. Consuming 5 food or reaching 4.0s emits a $360^\circ$ Dark Energy Pulse (160 void damage, converts enemy bullets into food matter). |
| **7** | `unique_solar_crest`<br>*(alias: `unique_helm_solar_archon`)* | **Crest of the Solar Chimera** | Stellar Fusion & Radiance | ☀️ | +30% Bite Power<br>+20% Armor<br>+0.50x Crit Multiplier | **Solar Flare Supernova**:<br>Serpent radiates a corona dealing $60\text{ fire DPS}$ within $120\text{ px}$. Eating food or landing critical bites charges a *Radiance Shield* (up to 150 buffer HP). Shield rupture unleashes a blinding solar nova, stunning all screen hostiles for 1.2s. |
| **8** | `unique_nanite_hivequeen`<br>*(alias: `unique_hydra_visage` / `unique_helm_nanite_hivequeen`)* | **Carapace of the Nanite Hivequeen** *(Golden Harvest)* | Bio-Nanite Swarm & Bountiful Mitosis | 🧬 | +80 Head Max HP<br>+5.0 HP/s Regen<br>+25% Segment Max HP | **Harvest Feast**:<br>**Defeated enemies burst into 2–3 extra apples!** Trillions of microscopic nanite constructors grant +3.5 HP/s rapid bio-regeneration and continuously reconstruct severed segments at a rate of 1 segment / 4.0s while total HP > 30%. |

---

### 10.3 The 9th Omni-Helmet: "The Celestial Crown of the Eternal Ouroboros"

- **Cosmic Classification**: Transcendent Godhead Artifact (`unique_eternal_ouroboros_crown` / `unique_helm_celestial_ouroboros`).
- **Visual Presentation**:
  - Procedural 3D-projected golden ouroboros halo hovering above the serpent head.
  - Features an accretion disk vortex with revolving tachyon gemstones representing each of the 8 sacrificed aspects.
  - Imbued with the signature **Gold-Brown Cosmic Aesthetic Theme** (`#d4af37`, `#b8860b`, `#8c6239`) combined with dynamic multi-phase chromatic iridescent ribbon shaders (`RainbowAura`).
- **All-Capacities Synthesis**:
  - The 9th Celestial Helmet **passively and actively executes ALL 8 unique capacities simultaneously**:
    1. *Titanic Armor Shockwave* (-40% impact damage + 180 dmg tectonic tremor).
    2. *Gorgon Petrifying Stun* (35% petrify on sight/bite + 45 DPS venom trail).
    3. *Titan Gorging* (Consuming food doubles head size and bite reach to $\text{HeadRadius} \times 2.0$ for 3.0s + 8% lifesteal bite reach).
    4. *Leviathan Tidal Dash* (3.5x dash + 140 dmg dual hydro-shockwaves).
    5. *Chronos Time Slowdown* (50% enemy dilation aura + lethal rewind rescue).
    6. *Void Gravity Vortex* (350px gravitational well + 160 dmg pulse converting bullets to food).
    7. *Solar Flare Supernova* (60 fire DPS corona + 150 HP radiance shield + flash stun).
    8. *Harvest Feast* (Defeated enemies burst into 2–3 extra apples + +3.5 HP/s rapid bio-regen & segment regrowth).
- **Ascension Multiplier**:
  - Grants a flat **+100% bonus to ALL core serpent attributes**: Max HP, Armor, Speed, Bite Power, Crit Chance, Crit Multiplier, HP Regen, and Shield Buffer.
  - Grants **Celestial Immortality**: Unlocks true ending sequence and remains a permanent loadout option in the player's MetaProgression vault upon winning the Boss Rush.

---

### 10.4 Galaxy Jump: The Cosmic Ascension & Prestige Mechanism

#### 10.4.1 Mechanics & Formulas
- **Prestige Trigger**:
  - The player initiates a **Galaxy Jump** from the Sanctuary or Cranial Mutation Lab.
  - Can be performed at any time once the player has reached or cleared Floor 1.
- **The Great Sacrifice (Standard Boss Helmets)**:
  - Performing a Galaxy Jump **destroys and sacrifices all currently owned standard/procedural boss helmets** in `MetaProgression.Helmets`.
  - **Unique Helmets Protection Invariant**: Any of the 8 Unique Helmets already unlocked and slotted in the Ouroboros Circular Gallery are **never sacrificed** during a Galaxy Jump. They remain safe and permanent within the gallery ring.
- **Sacrifice Score Calculation ($S$)**:
  $$S = \sum_{h \in \text{Sacrificed}} \text{HelmetValue}(h) \times M_{\text{rarity}}(h)$$
  Where the intrinsic value of each standard helmet is defined by:
  $$\text{HelmetValue}(h) = 50 \times \text{AffixCount}(h) + 10 \times \text{Floor}(h) + \text{PowerRating}(h)$$
  And the Rarity Multipliers $M_{\text{rarity}}$ are:
  - `common`: $1.0\times$ (nominal base ~60–80 points)
  - `uncommon`: $1.5\times$ (nominal base ~150–220 points)
  - `rare`: $2.5\times$ (nominal base ~350–500 points)
  - `epic`: $4.0\times$ (nominal base ~750–1,100 points)
  - `mythic`: $7.0\times$ (nominal base ~1,800–2,800 points)
- **Unique Helmet Drop Probability Formula**:
  The cosmic crucible converts total Sacrifice Score $S$ into the probability of manifesting an unowned Unique Helmet via an exponential saturation curve with characteristic parameter $S_0 = 800$:
  $$P(\text{Unique}) = 1 - \exp\left(-\frac{S}{800}\right)$$
  
  | Sacrifice Score ($S$) | Equivalent Sacrifices (Typical) | Probability $P(\text{Unique})$ | Outcome Expectation |
  | :---: | :--- | :---: | :--- |
  | **$50$** | 1 Common Helmet | **$6.1\%$** | Minimal gamble |
  | **$100$** | 1–2 Common Helmets | **$11.8\%$** | Early gamble chance |
  | **$250$** | 1 Rare or ~3 Uncommon Helmets | **$26.8\%$** | Early expedition prestige |
  | **$500$** | 1 Epic or ~3 Rare Helmets | **$46.5\%$** | Moderate expedition prestige |
  | **$800$** | 1 Mythic or 1 Epic + 2 Rares | **$63.2\%$** | **Characteristic Saturation Milestone ($1 - 1/e$)** |
  | **$1,200$** | 1 Mythic + 1 Epic Helmet | **$77.7\%$** | High-probability sacrifice threshold |
  | **$1,600$** | 1 High Mythic + 2 Epics | **$86.5\%$** | Strong guarantee prestige run ($1 - 1/e^2$) |
  | **$2,400$** | Multiple Mythic & Epic Helmets | **$95.0\%$** | Near certainty ($> 19/20$) |
  | **$4,000+$** | Veteran helmet stockpile sacrifice | **$99.3\%+$** | Guaranteed manifestation |

- **Uniform Unowned Roll & Safeguards**:
  - When $P(\text{Unique})$ succeeds, the engine filters the 8 Unique Helmets down to the unowned set:
    $$\text{UnownedPool} = \{ U_k \mid U_k \notin \text{GalleryOwnedUniqueHelmets}, k \in [1 \dots 8] \}$$
  - The granted Unique Helmet is drawn **uniformly at random** from $\text{UnownedPool}$.
  - **Duplicate Protection**: Players will **never** roll a duplicate Unique Helmet as long as unowned unique helmets remain.
  - If $|\text{UnownedPool}| = 0$ (all 8 already collected), Galaxy Jump grants an **Ascendant Crucible Surge**: $+10,000 \text{ Ouro}$ and $+500 \text{ Shards}$.
  - If the probability roll fails: All sacrificed standard helmets are consumed, but the player receives a **Consolation Stardust Bonus** ($\text{Ouro} = \lfloor S \times 2.5 \rfloor$, $\text{Shards} = \lfloor S / 20 \rfloor$) to jumpstart the new galaxy run.

- **Galaxy Jump Prestige Multiplier Calculation ($P_{\text{mult}}$)**:
  Upon completing a Galaxy Jump, the player's cosmic prestige multiplier is updated based on unique helmets held and highest floor reached, augmenting score and stardust gains:
  $$P_{\text{mult}} = 1 + 0.5 \times N_{\text{helmets}} + 0.1 \times \text{Floor}$$
  Where $N_{\text{helmets}}$ is the number of unlocked Unique Helmets in the Ouroboros Gallery ($0 \dots 8$) and $\text{Floor}$ is the expedition floor depth reached. Persistent shard and Ouro balances are strictly retained across all galaxy jumps.

#### 10.4.2 The Galaxy Jump Ritual User Experience (UX) Flow
To eliminate player ambiguity, provide full operational transparency, and deliver a visceral cosmic crescendo, the Galaxy Jump prestige sequence follows a mandatory 3-phase interactive pipeline:

```
┌─────────────────────────────────────────────────────────────┐
│ PHASE 1: CONFIRMATION MODAL                                 │
│ - Sacrificed Helmet Count & Total Sacrifice Score (S)        │
│ - Real-Time Manifestation Probability: P = 1 - exp(-S/800)   │
│ - High-Contrast Permaloss Warning (Standard Helmets Destroyed)│
│ - Abort / Commence Buttons                                  │
└──────────────────────────────┬──────────────────────────────┘
                               │ (Commence)
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ PHASE 2: CINEMATIC HYPERSPACE WARP ANIMATION (~2.5s)        │
│ - Pure WebGL 2.0 Procedural Warp & Star Streaks Pipeline    │
│   * 0.0s–0.6s: Singularity Charge (Radial star compression) │
│   * 0.6s–1.9s: Hyperspace Light-Speed Tunnel (Relativistic) │
│   * 1.9s–2.5s: Deceleration & White-Gold Shockwave Flash   │
│ - Web Audio Procedural Synth Soundscape (Sub-bass & Gong)   │
└──────────────────────────────┬──────────────────────────────┘
                               │ (Arrival)
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ PHASE 3: OUTCOME REVELATION SCREEN                          │
│ [SUCCESS]                                                   │
│ - Gold-Brown Cosmic Showcase Card (#d4af37, #b8860b, #8c6239)│
│ - Revealed Unique Helmet: Icon, Stats, Special Capacity     │
│ - Auto-Socketing Animation into Ouroboros Gallery Ring      │
│ [FAILURE]                                                   │
│ - Cosmic Void Collapse Notice + Consolation Stardust Bonus  │
│ - Tactical Guidance: Slay higher-tier bosses to boost S     │
└─────────────────────────────────────────────────────────────┘
```

1. **Phase 1: Confirmation Modal (Informed Consent & Stakes Transparency)**:
   - Clicking "Galaxy Jump Ritual" opens a dedicated modal overlay before executing any state changes.
   - **Key Metrics Rendered**:
     - **Sacrificed Standard Helmets Count**: Displays the exact number of inventory helmets queued for the crucible ($N_{\text{helmets}}$).
     - **Calculated Sacrifice Score ($S$)**: Total points accrued across all surrendered helmets.
     - **Calculated Manifestation Probability**: Displays the exact computed probability as a prominent percentage ($P = [1 - \exp(-S/800)] \times 100\%$).
     - **Permaloss Warning Banner**: Clear warning text emphasizing: *"SURRENDER WARNING: Commencing the Galaxy Jump will permanently vaporize all standard boss helmets in your inventory! Previously unlocked Unique Helmets in the Ouroboros Gallery are eternal and will NOT be sacrificed."*
   - **User Controls**:
     - `[COMMENCE GALAXY WARP]`: Locks the sacrifice, deducts standard helmets, commits the roll, and triggers Phase 2.
     - `[ABORT / PRESERVE GEAR]`: Safely closes the modal with zero mutations to player state or inventory.

2. **Phase 2: Cinematic Hyperspace Warp Animation (Pure WebGL Video-Like Spectacle)**:
   - A dedicated fullscreen procedural WebGL 2.0 animation running for exactly $2.50\text{ s}$ ($\tau_{\text{warp}} = 2.50\text{ s}$).
   - **Visual WebGL Shader Choreography**:
     - **$0.0\text{ s} \to 0.6\text{ s}$ (Singularity Gravitational Charge)**: Starfield accelerates radially inward toward the screen center $(x_c, y_c)$; screen perimeter darkens into an accretion vignette with twisting gold-amber energy arcs (`#d4af37`, `#b8860b`).
     - **$0.6\text{ s} \to 1.9\text{ s}$ (Hyperspace Light-Speed Tunnel)**: Relativistic star streak extrusion pipeline; star vertices stretch along velocity vectors ($v_{\text{warp}} \propto \Delta t^3$) into radiant chromatic beams rushing past the camera, with planar cosmic distortion shockwaves rippling across the viewport.
     - **$1.9\text{ s} \to 2.5\text{ s}$ (Deceleration & Shockwave Flash)**: Blinding white-gold chromatic aberration explosion, lens flare expansion, smooth deceleration dampening, settling seamlessly onto the destination galactic sector.
   - **Procedural Synth Web Audio Integration**:
     - Dynamic pitch-shifting sub-bass oscillator rising from $40\text{ Hz}$ to $180\text{ Hz}$.
     - Hypersonic white noise bandpass sweep simulating intergalactic slipstream.
     - Climactic resonant cosmic gong / cymbal crash upon shockwave detonation at $t = 1.9\text{ s}$.
   - **Rule 12 Pure WebGL Compliance**: Rendered exclusively via WebGL 2.0 shaders and vertex instance batches (`WebGLGameRenderer` / `GLBatch`). Strictly zero Canvas 2D APIs.

3. **Phase 3: Outcome Revelation Screen**:
   - Immediately following the 2.5s warp sequence, an outcome interface displays the result:
     - **Success Outcome (Unique Helmet Created)**:
       - Displays an opulent **Gold-Brown Cosmic Showcase Card** styled with the signature palette (`#d4af37` gold, `#b8860b` goldenrod, `#8c6239` bronze-brown).
       - Features an animated, glowing icon of the newly unlocked Unique Helmet with radiating amber particle embers.
       - Complete profile breakdown: Name, Lore Description, Primary Stat Modifiers, and its Signature Game-Changing Capacity (e.g. *"Harvest Feast: Defeated enemies burst into 2–3 extra apples!"* or *"Titan Gorging: Eating food temporarily doubles Head size and bite reach for 3.0 seconds!"*).
       - **Auto-Socketing Animation**: An automated, smooth visual flight path moves the newly manifested helmet from the showcase card directly into its designated circumferential socket on the Ouroboros Circular Gallery, accompanied by a triumphant celestial chime.
     - **Failure Outcome (Cosmic Void Collapse)**:
       - Displays a solemn, atmospheric cosmic collapse card: *"THE COSMIC CRUCIBLE DISSIPATES INTO STARDUST"*.
       - Itemized breakdown of awarded consolation rewards: Stardust Ouro ($\lfloor S \times 2.5 \rfloor$) and Shards ($\lfloor S / 20 \rfloor$).
       - **Tactical Guidance Notice**: Encourages the player: *"The crucible lacked sufficient mass. Defeat higher-tier floor bosses and surrender Epic and Mythic helmets to boost your Sacrifice Score toward the 800-point saturation milestone (P > 63%) before jumping again!"*
       - `[CONTINUE EXPEDITION]` button dismissing the modal and returning the player to the Sanctuary.

---

### 10.5 The Ouroboros Circular Gallery Architecture & UI

The Ouroboros Gallery is the visual and mechanical shrine within the Sanctuary and Snake Lab where players track, view, and interact with the cosmic relics.

```
                     [1. Colossus]
              [8. Hydra]       [2. Gorgon]
                   \               /
                    \             /
        [7. Chimera] —- (9. Omni) —- [3. Behemoth]
                    /    Head 🐍  \
                   /               \
              [6. Void]         [4. Leviathan]
                     [5. Chronos]
```

- **Ring Geometry**:
  - The gallery is rendered as a stylized, glowing Ouroboros serpent whose serpentine tail coils into a perfect circle of radius $R = 220\text{ px}$ centered at $(0, 0)$.
  - **8 Circumferential Sockets**: Spaced equidistant around the perimeter at angular coordinates:
    $$\theta_k = k \times \frac{2\pi}{8} - \frac{\pi}{2}, \quad k \in \{0, 1, 2, 3, 4, 5, 6, 7\}$$
    Corresponding to Cartesian positions:
    $$(x_k, y_k) = (R \cos \theta_k, R \sin \theta_k)$$
  - Each circumferential socket is assigned to its respective Unique Helmet (Slots 1 through 8).
- **Socket Display States**:
  - **Empty / Locked**: Rendered as a translucent runic silhouette with floating cosmic lock glyphs and a tooltip indicating the aspect's name and hint.
  - **Occupied / Slotted**: Rendered with high-intensity WebGL bloom, pulsing elemental border glow in the helmet's signature color, animated icon, and full inspectable stat breakdown.
- **The Inward-Curving Serpentine Head & Central 9th Socket**:
  - The anatomical head of the Ouroboros serpent does not swallow its tail at the ring perimeter; instead, the neck and head gracefully loop inward, opening its jaws at the exact epicenter $(0, 0)$.
  - Inside the open jaws sits the **9th Central Socket: The Celestial Core**.
  - **Central Forge Gate**:
    - If $\text{UniqueHelmetsCount} < 8$: The central socket remains sealed beneath astral chains, displaying a glowing lock glyph and counter: `[🔒 ASSEMBLE ALL 8 RELICS: N / 8]`.
    - If $\text{UniqueHelmetsCount} == 8$: The central socket bursts into a brilliant cosmic singularity with counter-rotating particle rings. The ritual button activates:
      **"🔥 FORGE THE 9TH HELMET: ENTER THE CELESTIAL RIFT"**.

---

### 10.6 The Final Trial: The Celestial Rift Arena & 8-Second Wave All-Boss Rush

Clicking the Forge button initiates the ultimate challenge. The Ouroboros in the gallery swallows the central singularity, triggering a reality-warping hyperjump to **Floor 99: The Celestial Rift Arena**.

- **Arena Dimensions & Environment**:
  - Dimensions: $1800 \times 1800\text{ px}$.
  - Pure WebGL cosmic background: A swirling celestial vortex with reality-tear event horizons and zero obstacle boundaries (pure open combat space).
- **The Rapid 8-Second Wave Awakening Cadence**:
  - Unlike standard floors where bosses appear one-by-one upon defeat, the Celestial Rift obeys a ruthless **time-driven awakening cadence**:
    $$\Delta t_{\text{wave}} = 8.0\text{ s}$$
  - **Awakening Timeline**:
    - **$t = 0.0\text{ s}$**: Boss 1 awakens at north rift (e.g. *Infernal Colossus*).
    - **$t = 8.0\text{ s}$**: Boss 2 awakens at northeast rift (e.g. *Storm Gorgon*).
    - **$t = 16.0\text{ s}$**: Boss 3 awakens at east rift (e.g. *Centipede Behemoth*).
    - **$t = 24.0\text{ s}$**: Boss 4 awakens at southeast rift (e.g. *Astral Leviathan*).
    - **$t = 32.0\text{ s}$**: Boss 5 awakens at south rift (e.g. *Chrono Wyrm*).
    - **$t = 40.0\text{ s}$**: Boss 6 awakens at southwest rift (e.g. *Void Devourer*).
    - **$t = 48.0\text{ s}$**: Boss 7 awakens at west rift (e.g. *Volcanic Chimera*).
    - **$t = 56.0\text{ s}$**: Boss 8 awakens at northwest rift (e.g. *Quantum Hydra*).
    - *(Additional apex bosses awaken every $8.0\text{ s}$ up to the full active apex roster!)*
  - **Simultaneous Multi-Boss Combat**:
    - Bosses awaken **regardless** of whether earlier bosses have been slain.
    - If the player fails to eliminate bosses swiftly, multiple Apex Bosses will occupy the arena simultaneously, generating an intense, climactic bullet-hell arena.
    - **Rift Calibration**: Rift bosses have calibrated health ($0.70\times$ baseline) and aggressive AI targeting, rewarding aggressive close-range biting, combo whipping, and fusion weapon mastery.

- **The Victory Condition (Ascension & True Ending)**:
  - **Requirement**: The player must defeat **ALL** spawned bosses until the arena is entirely cleared and no active bosses remain.
  - **Reward**:
    - The player permanently claims **"The Celestial Crown of the Eternal Ouroboros"**.
    - The 9th Helmet is permanently added to `MetaProgression.Helmets` and slotted into the center of the Ouroboros Gallery.
    - The Grand Ascension ending triggers: The serpent transcends physical space, ascending into the celestial firmament as a divine golden constellation.
    - Permanent gold laurel badge added to the player's profile with title: **"Eternal Sovereign of the Ouroboros"**.

- **The High-Stakes Permaloss Defeat Condition**:
  - **The Risk**: If the player's Head HP reaches zero (or the serpent is completely annihilated) during the Celestial Rift Boss Rush:
    - The volatile cosmic fusion undergoes catastrophic detonation.
    - **ALL 8 UNIQUE HELMETS ARE PERMANENTLY DESTROYED!**
    - The Ouroboros Gallery unique helmet inventory resets to **0 / 8**.
    - All 8 circumferential sockets become empty once again.
    - The player is returned to the Sanctuary with their standard meta-progression (Ouro, Shards, and basic upgrades preserved), but they **must collect the 8 Unique Helmets anew** through fresh Galaxy Jumps to attempt the ritual again.
  - **Game Design Purpose**: High-stakes tension elevates the final battle into a legendary, adrenaline-fueled climax where victory feels genuinely earned.


