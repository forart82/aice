# Visual Parity & Pixel Diff Engine Report (Native Canvas2D vs WebGL)

> **Generated:** 2026-09-08T19:19:53.803Z  
> **Engine Stack:** Modern TypeScript 5.8+, Canvas2D Ctx2D vs WebGL 2.0  
> **Total Scenes:** 14  
> **Average Diff Percentage:** **0.43%**  
> **Threshold:** $\Delta \text{RGBA} > 8$ with bright magenta (`#ff00ff`) high-contrast highlights  

---

## 1. Executive Summary & Parity Matrix

This document records the automated pixel-by-pixel visual regression sweep comparing the native HTML5 Canvas 2D fallback renderer against the hardware-accelerated WebGL 2.0 batch pipeline across all 14 canonical test scenes under deterministic execution ($t=60\text{ ticks}$, frozen kinematic loop, identical world entities).

| Index | Scene Identifier | Description | Total Pixels | Diff Count | Diff % | Parity Assessment |
| :---: | :--- | :--- | :---: | :---: | :---: | :---: |
| 1 | `01_title` | Title Screen (coiling knot idle backdrop) | 921 600 | 5 277 | **0.57%** | 🟢 Excellent ISO Parity |
| 2 | `02_class` | Class Select Screen (all 5 serpent classes) | 921 600 | 1 303 | **0.14%** | 🟢 Excellent ISO Parity |
| 3 | `03_emerald_healthy` | Emerald Serpent (Healthy, 12 segments, moving right) | 921 600 | 4 604 | **0.50%** | 🟢 Excellent ISO Parity |
| 4 | `04_emerald_damaged` | Emerald Serpent (Damaged headHp 30/50, bodyHp 12/25, cranial arc, damage rings) | 921 600 | 4 368 | **0.47%** | 🟢 Excellent ISO Parity |
| 5 | `05_stalker` | Shadow Stalker Serpent (Phantom cybernetic aesthetic) | 921 600 | 4 707 | **0.51%** | 🟢 Excellent ISO Parity |
| 6 | `06_hydra` | Hydra Tri-Skull Serpent (Triple skull silhouette) | 921 600 | 4 801 | **0.52%** | 🟢 Excellent ISO Parity |
| 7 | `07_storm` | Storm Serpent (Atmospheric electrical blue accents) | 921 600 | 4 737 | **0.51%** | 🟢 Excellent ISO Parity |
| 8 | `08_solar` | Solar Serpent (Nuclear starfire carapace and golden solar crests) | 921 600 | 4 507 | **0.49%** | 🟢 Excellent ISO Parity |
| 9 | `09_food_grid` | Food Grid (All 8 food pickups in isolated plate: apple, golden, shard, potion, shield, bomb, chrono, magnet) | 921 600 | 5 262 | **0.57%** | 🟢 Excellent ISO Parity |
| 10 | `10_enemy_grid` | Enemy Bestiary Grid (All 6 enemies: spitter, drone, phantom, bruiser, swarmling, scarab) | 921 600 | 4 583 | **0.50%** | 🟢 Excellent ISO Parity |
| 11 | `11_boss_centipede` | Centipede Behemoth Boss (8 segments, circular danger telegraph) | 921 600 | 4 357 | **0.47%** | 🟢 Excellent ISO Parity |
| 12 | `12_backdrop_floor1` | Floor 1 Cosmic Backdrop (Nebula, grid, stars) | 921 600 | 4 415 | **0.48%** | 🟢 Excellent ISO Parity |
| 13 | `13_sanctuary` | Sanctuary Screen (Meta-progression upgrades) | 921 600 | 1 719 | **0.19%** | 🟢 Excellent ISO Parity |
| 14 | `14_lab` | Cranial Mutation Lab Screen (Head sockets and alchemical fusions) | 921 600 | 457 | **0.05%** | 🟢 Excellent ISO Parity |

---

## 2. Methodology & Deterministic Invariants

1. **Deterministic State Machine**:
   - Both `?canvas2d=true` and `?gl=true` query parameters were verified to route through `VisualParityHarness.setupScene`.
   - The animation accumulator and physics loop were frozen (`_running = false`, `frameCount = 60`) to eliminate temporal jitter, pulse phase drift, and random particle offsets.
   - Entity coordinates, angles, damage states (headHp 30/50, bodyHp 12/25), and boss telegraph zones were set to identical float64 vectors.

2. **Pixel Diff Formulation**:
   - Each pixel index $p \in [0, W \times H)$ was inspected across RGBA channels.
   - Mismatch condition: $\max(|R_1 - R_2|, |G_1 - G_2|, |B_1 - B_2|, |A_1 - A_2|) > 8$.
   - Mismatched pixels were painted in high-contrast **Bright Magenta (`#ff00ff`)**; matched pixels were rendered in dimmed grayscale background.

3. **Artifact Outputs**:
   - Canvas2D captures: `scratch/screenshots/canvas2d/<scene>.png`
   - WebGL captures: `scratch/screenshots/webgl/<scene>.png`
   - High-contrast diffs: `scratch/screenshots/diff/diff_<scene>.png`
